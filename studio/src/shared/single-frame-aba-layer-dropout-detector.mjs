export const SINGLE_FRAME_ABA_LAYER_DROPOUT_SCHEMA_VERSION =
  "single-frame-aba-layer-dropout-analysis-v1";
export const SINGLE_FRAME_ABA_LAYER_DROPOUT_EVIDENCE_SCHEMA_VERSION =
  "single-frame-aba-layer-dropout-evidence-plan-v1";

export const SINGLE_FRAME_ABA_LAYER_DROPOUT_DEFAULTS = Object.freeze({
  pairDifferenceSumMinimum8Bit: 1,
  closureRatioMaximum: 0.15,
  spikePixelRatioMinimum: 0.001,
  spikePairDeltaMinimum8BitExclusive: 24,
  spikeClosureDeltaMaximum8BitExclusive: 8,
  sceneBoundaryInformationalRadiusFrames: 8,
  maximumRecordedEventsPerClassification: 200
});

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function assertFiniteNumber(value, label, { minimum = -Infinity, maximum = Infinity } = {}) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be a finite number between ${minimum} and ${maximum}`
    );
  }
}

function normalizeThresholds(overrides = {}) {
  const thresholds = {
    ...SINGLE_FRAME_ABA_LAYER_DROPOUT_DEFAULTS,
    ...overrides
  };
  assertFiniteNumber(
    thresholds.pairDifferenceSumMinimum8Bit,
    "pairDifferenceSumMinimum8Bit",
    { minimum: 0 }
  );
  assertFiniteNumber(thresholds.closureRatioMaximum, "closureRatioMaximum", {
    minimum: 0,
    maximum: 1
  });
  assertFiniteNumber(
    thresholds.spikePixelRatioMinimum,
    "spikePixelRatioMinimum",
    { minimum: 0, maximum: 1 }
  );
  assertFiniteNumber(
    thresholds.spikePairDeltaMinimum8BitExclusive,
    "spikePairDeltaMinimum8BitExclusive",
    { minimum: 0, maximum: 255 }
  );
  assertFiniteNumber(
    thresholds.spikeClosureDeltaMaximum8BitExclusive,
    "spikeClosureDeltaMaximum8BitExclusive",
    { minimum: 0, maximum: 255 }
  );
  assertNonNegativeInteger(
    thresholds.sceneBoundaryInformationalRadiusFrames,
    "sceneBoundaryInformationalRadiusFrames"
  );
  assertPositiveInteger(
    thresholds.maximumRecordedEventsPerClassification,
    "maximumRecordedEventsPerClassification"
  );
  return Object.freeze(thresholds);
}

function normalizeBoundaryFrames(boundaries) {
  if (!Array.isArray(boundaries)) {
    throw new TypeError("sceneBoundaryFrames must be an array");
  }
  const normalized = [...new Set(boundaries)];
  for (const frame of normalized) {
    assertNonNegativeInteger(frame, "scene boundary frame");
  }
  return Object.freeze(normalized.sort((left, right) => left - right));
}

function nearestBoundary(frame, boundaries) {
  let nearestFrame = null;
  let nearestDistance = Infinity;
  for (const boundary of boundaries) {
    const distance = Math.abs(frame - boundary);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestFrame = boundary;
    }
    if (boundary > frame && distance > nearestDistance) break;
  }
  return { frame: nearestFrame, distance: nearestDistance };
}

function rounded(value) {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function pixelView(pixels, expectedLength) {
  if (!(pixels instanceof Uint8Array)) {
    throw new TypeError("frame pixels must be a Uint8Array or Buffer");
  }
  if (pixels.byteLength !== expectedLength) {
    throw new RangeError(
      `frame pixel length mismatch: expected=${expectedLength} actual=${pixels.byteLength}`
    );
  }
  return Uint8Array.from(pixels);
}

export class StreamingSingleFrameAbaLayerDropoutDetector {
  #width;
  #height;
  #fps;
  #pixelCount;
  #thresholds;
  #sceneBoundaryFrames;
  #nextFrame;
  #previousFrames = [];
  #previousPairDelta = null;
  #previousPairMean = null;
  #tripleCount = 0;
  #blockingEventCount = 0;
  #informationalEventCount = 0;
  #blockingEvents = [];
  #informationalEvents = [];
  #frameCount = 0;
  #finalized = false;

  constructor({
    width,
    height,
    fps,
    startFrame = 0,
    sceneBoundaryFrames = [],
    thresholds = {}
  }) {
    assertPositiveInteger(width, "width");
    assertPositiveInteger(height, "height");
    assertFiniteNumber(fps, "fps", { minimum: Number.EPSILON });
    assertNonNegativeInteger(startFrame, "startFrame");
    this.#width = width;
    this.#height = height;
    this.#fps = fps;
    this.#pixelCount = width * height;
    this.#thresholds = normalizeThresholds(thresholds);
    this.#sceneBoundaryFrames = normalizeBoundaryFrames(sceneBoundaryFrames);
    this.#nextFrame = startFrame;
  }

  pushFrame({ frame, pixels }) {
    if (this.#finalized) {
      throw new Error("cannot push a frame after detector finalization");
    }
    if (frame !== this.#nextFrame) {
      throw new Error(
        `layer-dropout scan frames must be contiguous: expected=${this.#nextFrame} actual=${frame}`
      );
    }
    const current = pixelView(pixels, this.#pixelCount);
    this.#nextFrame += 1;
    this.#frameCount += 1;

    if (this.#previousFrames.length === 0) {
      this.#previousFrames.push({ frame, pixels: current });
      return null;
    }

    if (this.#previousFrames.length === 1) {
      const previous = this.#previousFrames[0];
      const pair = this.#pairDelta(previous.pixels, current);
      this.#previousPairDelta = pair.delta;
      this.#previousPairMean = pair.mean;
      this.#previousFrames.push({ frame, pixels: current });
      return null;
    }

    const [left, middle] = this.#previousFrames;
    const event = this.#evaluateTriple(left, middle, { frame, pixels: current });
    this.#previousFrames = [middle, { frame, pixels: current }];
    return event;
  }

  #pairDelta(left, right) {
    const delta = new Uint8Array(this.#pixelCount);
    let sum = 0;
    for (let index = 0; index < this.#pixelCount; index += 1) {
      const value = Math.abs(left[index] - right[index]);
      delta[index] = value;
      sum += value;
    }
    return { delta, mean: sum / this.#pixelCount };
  }

  #evaluateTriple(left, middle, right) {
    const previousPairMean = this.#previousPairMean;
    const currentPairDelta = new Uint8Array(this.#pixelCount);
    let currentPairSum = 0;
    let closureSum = 0;
    let spikePixelCount = 0;
    const pairDeltaMinimum =
      this.#thresholds.spikePairDeltaMinimum8BitExclusive;
    const closureDeltaMaximum =
      this.#thresholds.spikeClosureDeltaMaximum8BitExclusive;

    for (let index = 0; index < this.#pixelCount; index += 1) {
      const currentPair = Math.abs(middle.pixels[index] - right.pixels[index]);
      const closure = Math.abs(left.pixels[index] - right.pixels[index]);
      currentPairDelta[index] = currentPair;
      currentPairSum += currentPair;
      closureSum += closure;
      if (
        this.#previousPairDelta[index] > pairDeltaMinimum &&
        currentPair > pairDeltaMinimum &&
        closure < closureDeltaMaximum
      ) {
        spikePixelCount += 1;
      }
    }

    const currentPairMean = currentPairSum / this.#pixelCount;
    const closureMean = closureSum / this.#pixelCount;
    const pairDifferenceSum = previousPairMean + currentPairMean;
    const closureRatio = pairDifferenceSum === 0
      ? 0
      : closureMean / pairDifferenceSum;
    const spikePixelRatio = spikePixelCount / this.#pixelCount;
    const triggered =
      pairDifferenceSum >= this.#thresholds.pairDifferenceSumMinimum8Bit &&
      closureRatio <= this.#thresholds.closureRatioMaximum &&
      spikePixelRatio >= this.#thresholds.spikePixelRatioMinimum;

    this.#previousPairDelta = currentPairDelta;
    this.#previousPairMean = currentPairMean;
    this.#tripleCount += 1;
    if (!triggered) return null;

    const boundary = nearestBoundary(middle.frame, this.#sceneBoundaryFrames);
    const informational =
      boundary.frame !== null &&
      boundary.distance <=
        this.#thresholds.sceneBoundaryInformationalRadiusFrames;
    const event = Object.freeze({
      detectorPattern: "A-B-A",
      classification: informational
        ? "scene_boundary_informational"
        : "blocking_single_frame_aba_layer_dropout",
      frameA: left.frame,
      frameB: middle.frame,
      frameC: right.frame,
      centerSecond: rounded(middle.frame / this.#fps),
      meanAbsDifferenceAB8Bit: rounded(previousPairMean),
      meanAbsDifferenceBC8Bit: rounded(currentPairMean),
      meanAbsClosureAC8Bit: rounded(closureMean),
      pairDifferenceSum8Bit: rounded(pairDifferenceSum),
      closureRatio: rounded(closureRatio),
      spikePixelCount,
      spikePixelRatio: rounded(spikePixelRatio),
      nearestSceneBoundaryFrame: boundary.frame,
      sceneBoundaryDistanceFrames: Number.isFinite(boundary.distance)
        ? boundary.distance
        : null
    });

    if (informational) {
      this.#informationalEventCount += 1;
      if (
        this.#informationalEvents.length <
        this.#thresholds.maximumRecordedEventsPerClassification
      ) {
        this.#informationalEvents.push(event);
      }
    } else {
      this.#blockingEventCount += 1;
      if (
        this.#blockingEvents.length <
        this.#thresholds.maximumRecordedEventsPerClassification
      ) {
        this.#blockingEvents.push(event);
      }
    }
    return event;
  }

  finalize() {
    if (this.#finalized) {
      throw new Error("detector has already been finalized");
    }
    this.#finalized = true;
    return Object.freeze({
      schemaVersion: SINGLE_FRAME_ABA_LAYER_DROPOUT_SCHEMA_VERSION,
      detectorScope: "single-frame A-B-A layer-dropout only",
      status: this.#blockingEventCount === 0 ? "pass" : "fail",
      frameCount: this.#frameCount,
      analyzedTripleCount: this.#tripleCount,
      dimensions: Object.freeze({ width: this.#width, height: this.#height }),
      fps: this.#fps,
      thresholds: this.#thresholds,
      sceneBoundaryFrames: this.#sceneBoundaryFrames,
      boundaryPolicy:
        "center frame within +/-" +
        `${this.#thresholds.sceneBoundaryInformationalRadiusFrames} frames ` +
        "is informational and non-failing",
      inputSignal:
        "full decoded grayscale frame; watermark and caption regions are not cropped",
      knownLimitations: Object.freeze([
        "A-B-B-A and longer dropouts are not classified because the same pixel sequence can be an intentional multi-frame pulse",
        "non-returning corruption and gradual opacity changes are outside the A-B-A closure contract",
        "player, display, or image-preview compositor defects that are absent from decoded pixels are not detectable"
      ]),
      blockingEventCount: this.#blockingEventCount,
      informationalEventCount: this.#informationalEventCount,
      detectedEventCount:
        this.#blockingEventCount + this.#informationalEventCount,
      blockingEvents: Object.freeze([...this.#blockingEvents]),
      informationalEvents: Object.freeze([...this.#informationalEvents]),
      eventRecordsTruncated:
        this.#blockingEventCount > this.#blockingEvents.length ||
        this.#informationalEventCount > this.#informationalEvents.length,
      automaticFrameRepairAttempted: false
    });
  }
}

export function buildSingleFrameAbaLayerDropoutEvidencePlan(analysis) {
  if (analysis?.schemaVersion !== SINGLE_FRAME_ABA_LAYER_DROPOUT_SCHEMA_VERSION) {
    throw new TypeError("analysis must be a single-frame A-B-A layer-dropout result");
  }
  if (!Array.isArray(analysis.blockingEvents)) {
    throw new TypeError("analysis blockingEvents must be an array");
  }
  const events = analysis.blockingEvents.map((event, eventIndex) => {
    if (
      event?.detectorPattern !== "A-B-A" ||
      !Number.isSafeInteger(event.frameA) ||
      !Number.isSafeInteger(event.frameB) ||
      !Number.isSafeInteger(event.frameC) ||
      event.frameB !== event.frameA + 1 ||
      event.frameC !== event.frameB + 1
    ) {
      throw new TypeError("blocking event is not an exact contiguous A-B-A triplet");
    }
    return Object.freeze({
      eventIndex,
      classification: event.classification,
      centerFrame: event.frameB,
      centerSecond: event.centerSecond,
      exactFrames: Object.freeze([
        Object.freeze({ role: "A-before", frame: event.frameA }),
        Object.freeze({ role: "B-dropout", frame: event.frameB }),
        Object.freeze({ role: "A-after", frame: event.frameC })
      ]),
      metrics: Object.freeze({
        pairDifferenceSum8Bit: event.pairDifferenceSum8Bit,
        closureRatio: event.closureRatio,
        spikePixelRatio: event.spikePixelRatio
      })
    });
  });
  const exactFrameNumbers = [...new Set(
    events.flatMap((event) => event.exactFrames.map(({ frame }) => frame))
  )].sort((left, right) => left - right);
  return Object.freeze({
    schemaVersion: SINGLE_FRAME_ABA_LAYER_DROPOUT_EVIDENCE_SCHEMA_VERSION,
    detectorScope: analysis.detectorScope,
    totalBlockingEventCount: analysis.blockingEventCount,
    recordedBlockingEventCount: events.length,
    eventRecordsTruncated: analysis.eventRecordsTruncated,
    exactFrameNumbers: Object.freeze(exactFrameNumbers),
    events: Object.freeze(events),
    extractionInstruction:
      "Decode these exact frame numbers from the bound source MP4 and review each A-before/B-dropout/A-after triplet in order.",
    automaticFrameRepairAttempted: false
  });
}
