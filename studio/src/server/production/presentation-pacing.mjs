const DEFAULT_PLAYBACK_RATE = 1.15;
const DEFAULT_TAIL_HOLD_SECONDS = 3.5;
const MINIMUM_PLAYBACK_RATE = 1;
const MAXIMUM_PLAYBACK_RATE = 1.25;

export const PRESENTATION_PACING_POLICY = Object.freeze({
  schemaVersion: "content-driven-presentation-pacing-v1",
  mode: "content-driven-not-target-duration",
  defaultPlaybackRate: DEFAULT_PLAYBACK_RATE,
  defaultTailHoldSeconds: DEFAULT_TAIL_HOLD_SECONDS,
  minimumPlaybackRate: MINIMUM_PLAYBACK_RATE,
  maximumPlaybackRate: MAXIMUM_PLAYBACK_RATE,
  preservePitch: true,
  synchronizeVideoAudioAndCaptions: true,
  captionOrder: "composite-before-uniform-time-scale",
  tailHoldDomain: "presentation-time-after-pacing"
});

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a finite positive number`);
  }
  return value;
}

function nonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
  return value;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

export function validatePresentationPlaybackRate(value) {
  const rate = finitePositive(value, "playbackRate");
  if (rate < MINIMUM_PLAYBACK_RATE || rate > MAXIMUM_PLAYBACK_RATE) {
    throw new RangeError(
      `playbackRate must be between ${MINIMUM_PLAYBACK_RATE} and ${MAXIMUM_PLAYBACK_RATE}`
    );
  }
  return rate;
}

export function deriveContentDrivenPresentation({
  timeline,
  playbackRate = DEFAULT_PLAYBACK_RATE,
  tailHoldSeconds = DEFAULT_TAIL_HOLD_SECONDS
}) {
  if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) {
    throw new TypeError("timeline must be an object");
  }
  const rate = validatePresentationPlaybackRate(playbackRate);
  const hold = nonNegative(tailHoldSeconds, "tailHoldSeconds");
  const fps = finitePositive(Number(timeline.fps), "timeline.fps");
  const sampleRate = positiveSafeInteger(Number(timeline.sampleRate), "timeline.sampleRate");
  const durationInFrames = Number(timeline.durationInFrames);
  const durationInSamples = Number(timeline.durationInSamples);
  if (!Number.isSafeInteger(durationInFrames) || durationInFrames <= 0) {
    throw new TypeError("timeline.durationInFrames must be a positive safe integer");
  }
  if (!Number.isSafeInteger(durationInSamples) || durationInSamples <= 0) {
    throw new TypeError("timeline.durationInSamples must be a positive safe integer");
  }
  if (Math.abs(durationInSamples / sampleRate - durationInFrames / fps) > 1 / fps) {
    throw new RangeError("timeline audio and video durations must be synchronized within one frame");
  }
  if (!Array.isArray(timeline.speechSegments) || timeline.speechSegments.length === 0) {
    throw new TypeError("timeline.speechSegments must be a non-empty array");
  }
  const speechEndSamples = timeline.speechSegments.map((segment, index) => {
    const value = Number(segment?.endSampleExclusive);
    if (!Number.isSafeInteger(value) || value <= 0 || value > durationInSamples) {
      throw new TypeError(`speechSegments[${index}].endSampleExclusive is invalid`);
    }
    return value;
  });
  const lastSpeechEndSampleExclusive = Math.max(...speechEndSamples);
  const requestedEndSampleExclusive = positiveSafeInteger(
    lastSpeechEndSampleExclusive + Math.round(hold * rate * sampleRate),
    "requestedEndSampleExclusive"
  );
  const sourceEndSampleExclusive = Math.min(durationInSamples, requestedEndSampleExclusive);
  const sourceEndSeconds = sourceEndSampleExclusive / sampleRate;
  const sourceFrameCount = Math.min(
    durationInFrames,
    Math.max(1, Math.ceil(sourceEndSeconds * fps))
  );
  const outputFrameCount = positiveSafeInteger(
    Math.max(1, Math.ceil(((lastSpeechEndSampleExclusive / sampleRate) / rate + hold) * fps)),
    "outputFrameCount"
  );
  const outputAudioSamples = positiveSafeInteger(
    Math.ceil((outputFrameCount / fps) * sampleRate),
    "outputAudioSamples"
  );
  return Object.freeze({
    schemaVersion: PRESENTATION_PACING_POLICY.schemaVersion,
    mode: PRESENTATION_PACING_POLICY.mode,
    playbackRate: rate,
    preservePitch: true,
    fps,
    sampleRate,
    lastSpeechEndSampleExclusive,
    tailHoldSeconds: hold,
    sourceEndSampleExclusive,
    sourceEndSeconds,
    sourceFrameCount,
    outputFrameCount,
    outputDurationSeconds: outputFrameCount / fps,
    outputAudioSamples,
    trimmedTrailingSamples: durationInSamples - sourceEndSampleExclusive,
    trimmedTrailingSeconds: (durationInSamples - sourceEndSampleExclusive) / sampleRate
  });
}

function ffmpegNumber(value) {
  return Number(value.toFixed(9)).toString();
}

export function buildSynchronizedPacingFilterGraph({
  playbackRate = DEFAULT_PLAYBACK_RATE,
  overlayX,
  overlayY,
  audioStartSample,
  audioEndSampleExclusive,
  outputAudioSamples
}) {
  const rate = validatePresentationPlaybackRate(playbackRate);
  for (const [label, value] of [
    ["overlayX", overlayX],
    ["overlayY", overlayY],
    ["audioStartSample", audioStartSample],
    ["audioEndSampleExclusive", audioEndSampleExclusive],
    ["outputAudioSamples", outputAudioSamples]
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${label} must be a non-negative safe integer`);
    }
  }
  if (audioEndSampleExclusive <= audioStartSample) {
    throw new RangeError("audioEndSampleExclusive must be greater than audioStartSample");
  }
  positiveSafeInteger(outputAudioSamples, "outputAudioSamples");
  const formattedRate = ffmpegNumber(rate);
  return (
    "[0:v:0]setpts=PTS-STARTPTS[base];" +
    "[1:v:0]setpts=PTS-STARTPTS[caption];" +
    `[base][caption]overlay=${overlayX}:${overlayY}:format=auto:shortest=1[captioned];` +
    `[captioned]setpts=(PTS-STARTPTS)/${formattedRate}[v];` +
    `[2:a:0]atrim=start_sample=${audioStartSample}:` +
    `end_sample=${audioEndSampleExclusive},asetpts=N/SR/TB,` +
    `atempo=${formattedRate},apad=whole_len=${outputAudioSamples},` +
    `atrim=end_sample=${outputAudioSamples},asetpts=N/SR/TB[a]`
  );
}

export function pacedFrameCount(sourceFrameCount, playbackRate = DEFAULT_PLAYBACK_RATE) {
  if (!Number.isSafeInteger(sourceFrameCount) || sourceFrameCount <= 0) {
    throw new TypeError("sourceFrameCount must be a positive safe integer");
  }
  return Math.ceil(sourceFrameCount / validatePresentationPlaybackRate(playbackRate));
}
