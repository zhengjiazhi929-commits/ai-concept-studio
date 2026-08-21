import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF,
  aiWatermarkSizeProofGeometry
} from "../src/video/visual-system-v1-ai-watermark-size-proof-plan.mjs";

const studioRoot = resolve(import.meta.dirname, "..");

test("AI watermark size proof is static, wide-only, and review-only", () => {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF;
  assert.equal(contract.reviewOnly, true);
  assert.equal(contract.registered, false);
  assert.equal(contract.actualWatermarkIncluded, false);
  assert.equal(contract.videoOutput, false);
  assert.deepEqual(contract.outline, {
    width: 2,
    style: "dashed",
    color: "rgba(20, 54, 47, 0.66)",
    fill: "transparent",
    shadow: "none",
    cornerRadius: 0
  });
  assert.deepEqual(
    { width: contract.width, height: contract.height },
    { width: 1920, height: 1080 }
  );
  assert.equal(contract.durationInFrames, 1);
});

test("all three options share one anchor and differ only by size", () => {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF;
  assert.deepEqual(contract.options.map(({ size }) => size), [192, 160, 224]);
  assert.equal(new Set(contract.options.map(({ fileName }) => fileName)).size, 3);
  const geometries = contract.options.map(aiWatermarkSizeProofGeometry);
  assert.ok(geometries.every(({ top }) => top === 72));
  assert.ok(geometries.every(({ right }) => right === 96));
  assert.ok(geometries.every(({ width, height }) => width === height));
});

test("renderer contains no video render path", async () => {
  const source = await readFile(
    resolve(studioRoot, "scripts", "render-visual-system-v1-ai-watermark-size-proof.mjs"),
    "utf8"
  );
  assert.match(source, /renderStill/u);
  assert.doesNotMatch(source, /renderMedia/u);
  assert.doesNotMatch(source, /\.mp4/u);
});

test("pixel QA rejects any change outside the expected outline", async () => {
  const source = await readFile(
    resolve(studioRoot, "scripts", "qa-visual-system-v1-ai-watermark-size-proof.mjs"),
    "utf8"
  );
  assert.match(source, /pixelsOutsideExpectedOutlineUnchanged: true/u);
  assert.match(source, /actualAiObjectRendered: false/u);
  assert.match(source, /videoGenerated: false/u);
});
