import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF_V002,
  aiWatermarkSizeProofV002Geometry
} from "../src/video/visual-system-v1-ai-watermark-size-proof-v002-plan.mjs";

test("v002 uses the selected 120px size and 40px corner margins", () => {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF_V002;
  assert.equal(contract.option.size, 120);
  assert.deepEqual(contract.anchor, { top: 40, right: 40 });
  assert.deepEqual(aiWatermarkSizeProofV002Geometry(), {
    left: 1760,
    top: 40,
    width: 120,
    height: 120,
    right: 40,
    bottom: 920
  });
});

test("v002 stays still-only and review-only", async () => {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF_V002;
  assert.equal(contract.reviewOnly, true);
  assert.equal(contract.registered, false);
  assert.equal(contract.actualWatermarkIncluded, false);
  assert.equal(contract.videoOutput, false);
  const source = await readFile(
    resolve(import.meta.dirname, "..", "scripts", "render-visual-system-v1-ai-watermark-size-proof-v002.mjs"),
    "utf8"
  );
  assert.match(source, /renderStill/u);
  assert.doesNotMatch(source, /renderMedia/u);
  assert.doesNotMatch(source, /\.mp4/u);
});
