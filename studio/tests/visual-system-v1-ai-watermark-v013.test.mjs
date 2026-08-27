import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { inflateSync } from "node:zlib";

import {
  VISUAL_SYSTEM_V1_AI_WATERMARK,
  VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_PROFILE_ID,
  VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILE_ALIASES,
  VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILES,
  visualSystemV1AiWatermarkProfile
} from "../src/video/components/visual-system-v1/ai-watermark.mjs";

const studioRoot = resolve(import.meta.dirname, "..");
const assetRoot = resolve(
  studioRoot,
  "public",
  "assets",
  "visual-system-v1",
  "ai-watermark-v013"
);
const sourceAssetRoot = resolve(
  studioRoot,
  "public",
  "assets",
  "visual-system-v1",
  "ai-watermark-v012"
);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function paethPredictor(left, above, upperLeft) {
  const candidate = left + above - upperLeft;
  const leftDistance = Math.abs(candidate - left);
  const aboveDistance = Math.abs(candidate - above);
  const upperLeftDistance = Math.abs(candidate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function decodeRgbaPng(buffer) {
  assert.deepEqual(
    buffer.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    "PNG signature"
  );
  let cursor = 8;
  let width;
  let height;
  const compressed = [];
  while (cursor < buffer.length) {
    const length = buffer.readUInt32BE(cursor);
    const type = buffer.toString("ascii", cursor + 4, cursor + 8);
    const data = buffer.subarray(cursor + 8, cursor + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "8-bit channels");
      assert.equal(data[9], 6, "RGBA color type");
      assert.equal(data[10], 0, "standard compression");
      assert.equal(data[11], 0, "standard filter method");
      assert.equal(data[12], 0, "non-interlaced PNG");
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    cursor += 12 + length;
  }
  assert.ok(Number.isInteger(width) && Number.isInteger(height));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(compressed));
  assert.equal(raw.length, height * (stride + 1));
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const encoded = raw[rawOffset + x];
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[rowOffset + x - stride] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[rowOffset + x - stride - bytesPerPixel]
        : 0;
      let decoded;
      if (filter === 0) decoded = encoded;
      else if (filter === 1) decoded = encoded + left;
      else if (filter === 2) decoded = encoded + above;
      else if (filter === 3) decoded = encoded + Math.floor((left + above) / 2);
      else if (filter === 4) decoded = encoded + paethPredictor(left, above, upperLeft);
      else assert.fail(`unsupported PNG filter ${filter}`);
      pixels[rowOffset + x] = decoded & 0xff;
    }
    rawOffset += stride;
  }
  return { width, height, pixels };
}

function alphaMetrics(decoded, threshold = 16) {
  let left = decoded.width;
  let top = decoded.height;
  let rightExclusive = 0;
  let bottomExclusive = 0;
  let transparentPixelCount = 0;
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      const alpha = decoded.pixels[(y * decoded.width + x) * 4 + 3];
      if (alpha === 0) transparentPixelCount += 1;
      if (alpha >= threshold) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        rightExclusive = Math.max(rightExclusive, x + 1);
        bottomExclusive = Math.max(bottomExclusive, y + 1);
      }
    }
  }
  assert.ok(rightExclusive > left && bottomExclusive > top, "visible alpha bbox");
  const width = rightExclusive - left;
  const height = bottomExclusive - top;
  return {
    left,
    top,
    rightExclusive,
    bottomExclusive,
    width,
    height,
    longEdge: Math.max(width, height),
    centerX: (left + rightExclusive) / 2,
    centerY: (top + bottomExclusive) / 2,
    transparentPixelCount
  };
}

test("approved v013 is the default while approved v012 remains explicitly available", async () => {
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_PROFILE_ID, "approved-v013-stable-footprint");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.defaultProfileId, "approved-v013-stable-footprint");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.rasterSequence.assetVersion, 13);
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.rasterSequence.assetRoot, "assets/visual-system-v1/ai-watermark-v013/frames");

  const approved = visualSystemV1AiWatermarkProfile();
  assert.equal(approved, VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILES["approved-v013-stable-footprint"]);
  assert.equal(approved.approvalStatus, "approved");
  assert.equal(approved.reviewOnly, false);
  assert.equal(approved.rasterSequence.assetVersion, 13);

  const v012 = visualSystemV1AiWatermarkProfile("approved-v012");
  assert.equal(v012.approvalStatus, "approved");
  assert.equal(v012.reviewOnly, false);
  assert.equal(v012.rasterSequence.assetVersion, 12);
  assert.equal(v012.rasterSequence.assetRoot, "assets/visual-system-v1/ai-watermark-v012/frames");

  assert.deepEqual(VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILE_ALIASES, {
    "review-v013-stable-footprint": "approved-v013-stable-footprint"
  });
  assert.equal(
    visualSystemV1AiWatermarkProfile("review-v013-stable-footprint"),
    approved
  );
  assert.throws(() => visualSystemV1AiWatermarkProfile("v013"), /未知/u);

  const component = await readFile(
    resolve(studioRoot, "src/video/components/visual-system-v1/ai-watermark.jsx"),
    "utf8"
  );
  const brandLayer = await readFile(
    resolve(studioRoot, "src/video/components/visual-system-v1/brand-layer.jsx"),
    "utf8"
  );
  assert.match(component, /profile = VISUAL_SYSTEM_V1_AI_WATERMARK\.defaultProfileId/u);
  assert.match(component, /visualSystemV1AiWatermarkProfile\(profile\)/u);
  assert.match(component, /data-ai-watermark-profile=\{resolvedProfile\.id\}/u);
  assert.match(component, /rasterFramePath\(frame, resolvedProfile\)/u);
  assert.match(brandLayer, /profile = VISUAL_SYSTEM_V1_AI_WATERMARK\.defaultProfileId/u);
  assert.match(brandLayer, /<VisualSystemV1AiWatermark profile=\{profile\} \/>/u);
});

test("v013 manifest and every encoded frame satisfy the stable visible-footprint contract", async () => {
  const manifestBuffer = await readFile(resolve(assetRoot, "manifest.json"));
  const manifest = JSON.parse(manifestBuffer.toString("utf8"));
  assert.equal(manifest.schemaVersion, "visual-system-v1-ai-watermark-stable-footprint-assets-v1");
  assert.equal(manifest.assetVersion, 13);
  assert.equal(manifest.status, "approved-default");
  assert.equal(manifest.reviewOnly, false);
  assert.equal(manifest.approved, true);
  assert.deepEqual(manifest.approval, {
    acceptedDirection: "v002",
    approvedBy: "Zhengjiazhi",
    approvedOn: "2026-08-26",
    approvedProfileId: "approved-v013-stable-footprint",
    scope: "stable-visible-footprint-watermark-profile"
  });
  assert.equal(
    manifest.integrationMode,
    "default-approved-profile-frame-indexed-transparent-png-sequence"
  );
  assert.equal(manifest.source.assetVersion, 12);
  assert.equal(manifest.algorithm.alphaThresholdInclusive, 16);
  assert.equal(manifest.algorithm.targetVisibleLongEdge, 108);
  assert.equal(manifest.algorithm.visibleLongEdgeTolerance, 2);
  assert.equal(manifest.algorithm.centerTolerance, 1);
  assert.equal(manifest.frameCount, 120);
  assert.deepEqual(Object.keys(manifest.frames).map(Number), Array.from({ length: 120 }, (_, index) => index));

  const builderBuffer = await readFile(resolve(studioRoot, manifest.algorithm.builderPath.replace("studio/", "")));
  assert.equal(sha256(builderBuffer), manifest.algorithm.builderSha256);
  const sourceManifestBuffer = await readFile(resolve(sourceAssetRoot, "manifest.json"));
  assert.equal(sha256(sourceManifestBuffer), manifest.source.manifestSha256);

  for (let frame = 0; frame < 120; frame += 1) {
    const key = String(frame);
    const record = manifest.frames[key];
    const fileName = `frame-${String(frame).padStart(3, "0")}.png`;
    const [outputBuffer, sourceBuffer] = await Promise.all([
      readFile(resolve(assetRoot, "frames", fileName)),
      readFile(resolve(sourceAssetRoot, "frames", fileName))
    ]);
    assert.equal(sha256(outputBuffer), record.outputSha256, `${fileName} output sha256`);
    assert.equal(sha256(sourceBuffer), record.sourceSha256, `${fileName} source sha256`);

    const output = decodeRgbaPng(outputBuffer);
    const source = decodeRgbaPng(sourceBuffer);
    assert.deepEqual([output.width, output.height], [120, 120], `${fileName} dimensions`);
    const outputMetrics = alphaMetrics(output);
    const sourceMetrics = alphaMetrics(source);
    assert.deepEqual(
      { ...outputMetrics, transparentPixelCount: undefined },
      { ...record.outputAlphaBBox, transparentPixelCount: undefined },
      `${fileName} output bbox`
    );
    assert.deepEqual(
      { ...sourceMetrics, transparentPixelCount: undefined },
      { ...record.inputAlphaBBox, transparentPixelCount: undefined },
      `${fileName} input bbox`
    );
    assert.equal(outputMetrics.transparentPixelCount, record.transparentPixelCount);
    assert.ok(outputMetrics.transparentPixelCount > 0, `${fileName} transparent background`);
    assert.ok(outputMetrics.longEdge >= 106 && outputMetrics.longEdge <= 110, `${fileName} long edge`);
    assert.ok(Math.abs(outputMetrics.centerX - 60) <= 1, `${fileName} center x`);
    assert.ok(Math.abs(outputMetrics.centerY - 60) <= 1, `${fileName} center y`);

    const scale = 108 / sourceMetrics.longEdge;
    const expectedWidth = Math.max(1, Math.floor(sourceMetrics.width * scale + 0.5));
    const expectedHeight = Math.max(1, Math.floor(sourceMetrics.height * scale + 0.5));
    assert.equal(record.transform.targetRasterWidth, expectedWidth, `${fileName} isotropic width`);
    assert.equal(record.transform.targetRasterHeight, expectedHeight, `${fileName} isotropic height`);
    assert.ok(Math.abs(outputMetrics.width - expectedWidth) <= 2, `${fileName} width rounding`);
    assert.ok(Math.abs(outputMetrics.height - expectedHeight) <= 2, `${fileName} height rounding`);
    for (const [x, y] of [[0, 0], [119, 0], [0, 119], [119, 119]]) {
      assert.equal(output.pixels[(y * 120 + x) * 4 + 3], 0, `${fileName} transparent corner`);
    }
  }
});

test("the builder is write-once and never deletes or overwrites v012/v013", async () => {
  const builder = await readFile(
    resolve(studioRoot, "scripts/build-visual-system-v1-ai-watermark-v013.py"),
    "utf8"
  );
  assert.match(builder, /SOURCE_ASSET_ROOT = [^\n]+ai-watermark-v012/u);
  assert.match(builder, /OUTPUT_ASSET_ROOT = [^\n]+ai-watermark-v013/u);
  assert.match(builder, /os\.path\.lexists\(OUTPUT_ASSET_ROOT\)/u);
  assert.match(builder, /refusing to overwrite existing asset directory/u);
  assert.match(builder, /staging_root\.rename\(OUTPUT_ASSET_ROOT\)/u);
  assert.doesNotMatch(builder, /rmtree|\.unlink\(|os\.remove\(/u);
});
