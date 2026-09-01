import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

import { RenderInternals } from "@remotion/renderer";

import {
  buildSingleFrameAbaLayerDropoutEvidencePlan,
  StreamingSingleFrameAbaLayerDropoutDetector,
  SINGLE_FRAME_ABA_LAYER_DROPOUT_DEFAULTS
} from "../src/shared/single-frame-aba-layer-dropout-detector.mjs";
import {
  analyzeLongReviewSingleFrameLayerDropout,
  buildLongReviewSingleFrameLayerDropoutFfmpegArgs,
  LONG_REVIEW_SINGLE_FRAME_LAYER_DROPOUT_SCAN
} from "../src/server/production/long-review-single-frame-layer-dropout-qa.mjs";

const execFileAsync = promisify(execFile);

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function solidRgbPng(width, height, value) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = value;
      row[2 + x * 3] = value;
      row[3 + x * 3] = value;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pixels(width, height, fill = 220) {
  return new Uint8Array(width * height).fill(fill);
}

function withPatch(source, indexes, value) {
  const result = Uint8Array.from(source);
  for (const index of indexes) result[index] = value;
  return result;
}

function detector({ width = 100, height = 10, sceneBoundaryFrames = [] } = {}) {
  return new StreamingSingleFrameAbaLayerDropoutDetector({
    width,
    height,
    fps: 30,
    sceneBoundaryFrames
  });
}

function pushFrames(instance, frames) {
  const events = [];
  for (const [frame, framePixels] of frames.entries()) {
    const event = instance.pushFrame({ frame, pixels: framePixels });
    if (event) events.push(event);
  }
  return { events, result: instance.finalize() };
}

test("single-frame A-B-A detector catches one-frame layer dropout", () => {
  const base = pixels(100, 10);
  const changedIndexes = Array.from({ length: 20 }, (_, index) => index);
  const dropout = withPatch(base, changedIndexes, 20);
  const { events, result } = pushFrames(detector(), [base, dropout, base]);

  assert.equal(result.status, "fail");
  assert.equal(result.blockingEventCount, 1);
  assert.equal(result.informationalEventCount, 0);
  assert.equal(result.analyzedTripleCount, 1);
  assert.equal(result.automaticFrameRepairAttempted, false);
  assert.equal(
    events[0].classification,
    "blocking_single_frame_aba_layer_dropout"
  );
  assert.equal(events[0].detectorPattern, "A-B-A");
  assert.equal(events[0].frameB, 1);
  assert.ok(events[0].pairDifferenceSum8Bit >= 1);
  assert.equal(events[0].closureRatio, 0);
  assert.equal(events[0].spikePixelRatio, 0.02);
});

test("normal one-direction motion does not satisfy the A-C closure", () => {
  const first = pixels(100, 10, 220);
  const second = pixels(100, 10, 150);
  const third = pixels(100, 10, 80);
  const { result } = pushFrames(detector(), [first, second, third]);
  assert.equal(result.status, "pass");
  assert.equal(result.detectedEventCount, 0);
});

test("small noise and stable frames do not cross the spike gate", () => {
  const first = pixels(100, 10, 120);
  const second = withPatch(first, [0, 1, 2, 3, 4], 138);
  const { result } = pushFrames(detector(), [first, second, first, first]);
  assert.equal(result.status, "pass");
  assert.equal(result.blockingEventCount, 0);
});

test("event evidence is capped without losing the exact blocking count", () => {
  const base = pixels(100, 10);
  const changed = withPatch(
    base,
    Array.from({ length: 20 }, (_, index) => index),
    20
  );
  const frames = Array.from(
    { length: 405 },
    (_, frame) => frame % 2 === 0 ? base : changed
  );
  const { result } = pushFrames(detector(), frames);
  assert.equal(result.blockingEventCount, 403);
  assert.equal(result.blockingEvents.length, 200);
  assert.equal(result.eventRecordsTruncated, true);
  assert.throws(() => result.blockingEvents.push({}), /not extensible/u);
});

test("blocking events produce exact A/B/C manual evidence triplets", () => {
  const base = pixels(100, 10);
  const changed = withPatch(
    base,
    Array.from({ length: 20 }, (_, index) => index),
    20
  );
  const { result } = pushFrames(detector(), [base, changed, base, base]);
  const evidence = buildSingleFrameAbaLayerDropoutEvidencePlan(result);
  assert.equal(
    evidence.schemaVersion,
    "single-frame-aba-layer-dropout-evidence-plan-v1"
  );
  assert.equal(evidence.totalBlockingEventCount, 1);
  assert.deepEqual(evidence.exactFrameNumbers, [0, 1, 2]);
  assert.deepEqual(
    evidence.events[0].exactFrames.map(({ role, frame }) => [role, frame]),
    [["A-before", 0], ["B-dropout", 1], ["A-after", 2]]
  );
  assert.equal(evidence.automaticFrameRepairAttempted, false);
});

test("A-B-B-A remains an explicit unsupported semantic boundary", () => {
  const base = pixels(100, 10);
  const changed = withPatch(
    base,
    Array.from({ length: 20 }, (_, index) => index),
    20
  );
  const { result } = pushFrames(detector(), [base, changed, changed, base]);
  assert.equal(result.status, "pass");
  assert.equal(result.detectedEventCount, 0);
  assert.ok(result.knownLimitations.some((item) => item.includes("A-B-B-A")));
});

test("scene boundary +/-8 frames is informational while distance 9 fails", () => {
  const base = pixels(100, 10);
  const changed = withPatch(
    base,
    Array.from({ length: 20 }, (_, index) => index),
    20
  );
  const informationalFrames = Array.from({ length: 11 }, () => base);
  informationalFrames[9] = changed;
  const informational = pushFrames(
    detector({ sceneBoundaryFrames: [1] }),
    informationalFrames
  ).result;
  assert.equal(informational.status, "pass");
  assert.equal(informational.informationalEventCount, 1);
  assert.equal(informational.informationalEvents[0].sceneBoundaryDistanceFrames, 8);

  const blocking = pushFrames(
    detector({ sceneBoundaryFrames: [0] }),
    informationalFrames
  ).result;
  assert.equal(blocking.status, "fail");
  assert.equal(blocking.blockingEventCount, 1);
  assert.equal(blocking.blockingEvents[0].sceneBoundaryDistanceFrames, 9);
});

test("detector rejects skipped frames, wrong frame size and pushes after finalize", () => {
  const instance = detector({ width: 2, height: 2 });
  assert.throws(
    () => instance.pushFrame({ frame: 1, pixels: pixels(2, 2) }),
    /must be contiguous/u
  );
  assert.throws(
    () => instance.pushFrame({ frame: 0, pixels: pixels(3, 2) }),
    /pixel length mismatch/u
  );
  instance.pushFrame({ frame: 0, pixels: pixels(2, 2) });
  instance.finalize();
  assert.throws(
    () => instance.pushFrame({ frame: 1, pixels: pixels(2, 2) }),
    /after detector finalization/u
  );
});

test("formal ffmpeg scan is sequential, read-only grayscale streaming", () => {
  const args = buildLongReviewSingleFrameLayerDropoutFfmpegArgs({
    videoPath: "/fixture/review.mp4",
    width: 320,
    height: 180
  });
  assert.equal(args.includes("-ss"), false);
  assert.equal(args.includes("-y"), false);
  assert.equal(args.includes("-frames:v"), false);
  assert.equal(args.at(-1), "pipe:1");
  assert.match(args[args.indexOf("-vf") + 1], /scale=320:180:flags=area,format=gray/u);
  assert.equal(
    LONG_REVIEW_SINGLE_FRAME_LAYER_DROPOUT_SCAN.thresholds,
    SINGLE_FRAME_ABA_LAYER_DROPOUT_DEFAULTS
  );
});

test("ffmpeg wrapper streams every decoded frame and reports no false positives", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "acs-single-frame-layer-dropout-"));
  const width = 32;
  const height = 18;
  const frameCount = 12;
  const videoPath = resolve(directory, "stable.mp4");
  const ffmpegPath = RenderInternals.getExecutablePath({
    type: "ffmpeg",
    indent: false,
    logLevel: "error",
    binariesDirectory: null
  });
  const env = {
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    ...(process.platform === "darwin"
      ? { DYLD_LIBRARY_PATH: dirname(ffmpegPath) }
      : {})
  };
  try {
    await Promise.all(
      Array.from({ length: frameCount }, (_, frame) =>
        writeFile(
          resolve(directory, `stable-${String(frame).padStart(3, "0")}.png`),
          solidRgbPng(width, height, 100 + frame)
        )
      )
    );
    await execFileAsync(ffmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-framerate", "30",
      "-i", resolve(directory, "stable-%03d.png"),
      "-frames:v", String(frameCount),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath
    ], { env });
    const result = await analyzeLongReviewSingleFrameLayerDropout({
      ffmpegPath,
      videoPath,
      fps: 30,
      expectedFrameCount: frameCount,
      sceneBoundaryFrames: [],
      env,
      width,
      height
    });
    assert.equal(result.frameCount, frameCount);
    assert.equal(result.analyzedTripleCount, frameCount - 2);
    assert.equal(result.status, "pass");
    assert.equal(result.detectedEventCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
