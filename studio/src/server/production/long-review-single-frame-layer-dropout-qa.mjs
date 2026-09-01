import { spawn } from "node:child_process";

import {
  StreamingSingleFrameAbaLayerDropoutDetector,
  SINGLE_FRAME_ABA_LAYER_DROPOUT_DEFAULTS
} from "../../shared/single-frame-aba-layer-dropout-detector.mjs";

export const LONG_REVIEW_SINGLE_FRAME_LAYER_DROPOUT_SCAN = Object.freeze({
  width: 320,
  height: 180,
  pixelFormat: "gray",
  scaleFlags: "area",
  thresholds: SINGLE_FRAME_ABA_LAYER_DROPOUT_DEFAULTS
});

export function buildLongReviewSingleFrameLayerDropoutFfmpegArgs({
  videoPath,
  width,
  height
}) {
  if (typeof videoPath !== "string" || videoPath.length === 0) {
    throw new TypeError("videoPath is required");
  }
  if (!Number.isSafeInteger(width) || width < 1) {
    throw new TypeError("width must be a positive safe integer");
  }
  if (!Number.isSafeInteger(height) || height < 1) {
    throw new TypeError("height must be a positive safe integer");
  }
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    "-filter_threads", "1",
    "-i", videoPath,
    "-map", "0:v:0",
    "-vf", `scale=${width}:${height}:flags=${LONG_REVIEW_SINGLE_FRAME_LAYER_DROPOUT_SCAN.scaleFlags},format=gray`,
    "-an",
    "-sn",
    "-dn",
    "-fps_mode", "passthrough",
    "-f", "image2pipe",
    "-c:v", "rawvideo",
    "-pix_fmt", LONG_REVIEW_SINGLE_FRAME_LAYER_DROPOUT_SCAN.pixelFormat,
    "pipe:1"
  ];
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

export async function analyzeLongReviewSingleFrameLayerDropout({
  ffmpegPath,
  videoPath,
  fps,
  expectedFrameCount,
  sceneBoundaryFrames,
  env = process.env,
  width = LONG_REVIEW_SINGLE_FRAME_LAYER_DROPOUT_SCAN.width,
  height = LONG_REVIEW_SINGLE_FRAME_LAYER_DROPOUT_SCAN.height,
  thresholds = LONG_REVIEW_SINGLE_FRAME_LAYER_DROPOUT_SCAN.thresholds,
  signal = undefined,
  timeoutMs = 15 * 60 * 1000
}) {
  if (typeof ffmpegPath !== "string" || ffmpegPath.length === 0) {
    throw new TypeError("ffmpegPath is required");
  }
  if (!Number.isSafeInteger(expectedFrameCount) || expectedFrameCount < 1) {
    throw new TypeError("expectedFrameCount must be a positive safe integer");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive safe integer");
  }
  const frameByteLength = width * height;
  const detector = new StreamingSingleFrameAbaLayerDropoutDetector({
    width,
    height,
    fps,
    sceneBoundaryFrames,
    thresholds
  });
  const child = spawn(
    ffmpegPath,
    buildLongReviewSingleFrameLayerDropoutFfmpegArgs({
      videoPath,
      width,
      height
    }),
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      signal
    }
  );
  const exit = childExit(child);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  timeout.unref();
  const stderrChunks = [];
  let stderrByteLength = 0;
  child.stderr.on("data", (chunk) => {
    if (stderrByteLength >= 1024 * 1024) return;
    const accepted = chunk.subarray(0, 1024 * 1024 - stderrByteLength);
    stderrChunks.push(accepted);
    stderrByteLength += accepted.length;
  });

  let frame = Buffer.allocUnsafe(frameByteLength);
  let frameOffset = 0;
  let frameCount = 0;
  try {
    for await (const chunk of child.stdout) {
      let chunkOffset = 0;
      while (chunkOffset < chunk.length) {
        const byteCount = Math.min(
          frameByteLength - frameOffset,
          chunk.length - chunkOffset
        );
        chunk.copy(frame, frameOffset, chunkOffset, chunkOffset + byteCount);
        frameOffset += byteCount;
        chunkOffset += byteCount;
        if (frameOffset === frameByteLength) {
          detector.pushFrame({ frame: frameCount, pixels: frame });
          frameCount += 1;
          frame = Buffer.allocUnsafe(frameByteLength);
          frameOffset = 0;
        }
      }
    }
  } catch (error) {
    clearTimeout(timeout);
    child.kill("SIGTERM");
    await exit.catch(() => {});
    throw error;
  }

  const result = await exit.finally(() => clearTimeout(timeout));
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
  if (timedOut) {
    throw new Error(`single-frame A-B-A layer-dropout decode timed out after ${timeoutMs}ms`);
  }
  if (result.code !== 0) {
    throw new Error(
      `single-frame A-B-A layer-dropout decode failed: code=${result.code} signal=${result.signal ?? "none"}` +
      `${stderr ? ` stderr=${stderr}` : ""}`
    );
  }
  if (frameOffset !== 0) {
    throw new Error(
      `single-frame A-B-A layer-dropout decode ended with a partial frame: bytes=${frameOffset}/${frameByteLength}`
    );
  }
  if (frameCount !== expectedFrameCount) {
    throw new Error(
      `single-frame A-B-A layer-dropout decode count mismatch: expected=${expectedFrameCount} actual=${frameCount}`
    );
  }
  return detector.finalize();
}
