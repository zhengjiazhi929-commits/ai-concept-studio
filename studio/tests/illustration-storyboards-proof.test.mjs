import assert from "node:assert/strict";
import test from "node:test";
import { STORYBOARDS } from "../src/video/illustration-storyboards/plan.mjs";
import { integrityHash } from "../src/shared/integrity.mjs";
import { assertStoryboardComposition, auditStoryboardLogo, buildStoryboardManifest, buildStoryboardGallery } from "../scripts/render-illustration-storyboard-proof.mjs";

function fixture() {
  const files = [{ path: "synthetic.mjs", bytes: 12, sha256: integrityHash("synthetic source") }];
  return { source: { gitHead: "a".repeat(40), files, visualSourceHash: integrityHash(files) },
    runtime: { node: "fixture" }, generatedAt: "2026-09-08T00:00:00Z",
    stills: STORYBOARDS.flatMap((board) => [0, 1, 2].map((frame) => ({ id: board.id, frame,
      path: `${board.id}-${frame}.png`, bytes: 100, sha256: integrityHash(`${board.id}/${frame}`),
      pixels: { width: 1920, height: 1080, pixelSha256: integrityHash(`pixels/${board.id}/${frame}`) },
      watermark: { presencePassed: true, mintPixels: 900, minimumMintPixels: 504 } }))) };
}

test("manifest binds all nine synthetic evidence rows and never infers acceptance or video", () => {
  const manifest = buildStoryboardManifest(fixture());
  assert.equal(manifest.stills.length, 9);
  for (const key of ["userAccepted", "productionApproved", "finalAccepted", "videoGenerated", "authorizesPublication"]) {
    assert.equal(manifest[key], false);
  }
  const { candidateHash, ...payload } = manifest;
  assert.equal(candidateHash, integrityHash(payload));
});

test("missing, duplicated, reordered or corrupt evidence cannot pass", () => {
  for (const mutate of [
    (input) => input.stills.pop(),
    (input) => { input.stills[1] = input.stills[0]; },
    (input) => input.stills.reverse(),
    (input) => { input.stills[0].pixels.width = 960; },
    (input) => { input.source.visualSourceHash = "b".repeat(64); },
    (input) => { delete input.stills[0].watermark; }
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildStoryboardManifest(input));
  }
});

test("pixel gate rejects a missing logo even if the rest of the frame is bright", () => {
  const pixels = Buffer.alloc(40 * 40 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([242, 246, 243, 255], offset);
  const decoded = { width: 40, height: 40, pixels }, region = { x: 20, y: 0, width: 20, height: 20 };
  assert.throws(() => auditStoryboardLogo(decoded, region), /Missing visible storyboard logo/u);
  for (let y = 2; y < 8; y += 1) for (let x = 24; x < 30; x += 1) pixels.set([50, 170, 120, 255], (y * 40 + x) * 4);
  assert.equal(auditStoryboardLogo(decoded, region).presencePassed, true);
  assert.throws(() => auditStoryboardLogo(decoded, { ...region, x: 39 }), /Invalid/u);
});

test("composition identity and dimensions fail closed", () => {
  const valid = { id: STORYBOARDS[0].compositionId, width: 1920, height: 1080, fps: 30, durationInFrames: 3 };
  assert.doesNotThrow(() => assertStoryboardComposition(valid, valid.id));
  for (const patch of [{ width: 1280 }, { durationInFrames: 600 }, { id: "unrelated" }]) {
    assert.throws(() => assertStoryboardComposition({ ...valid, ...patch }, valid.id));
  }
});

test("offline gallery exposes nine actual PNG paths, phase controls and no video player", () => {
  const gallery = buildStoryboardGallery(buildStoryboardManifest(fixture()));
  assert.equal((gallery.match(/<figure /gu) ?? []).length, 9);
  assert.equal((gallery.match(/<button /gu) ?? []).length, 9);
  for (const still of fixture().stills) assert.ok(gallery.includes(`src="${still.path}"`));
  assert.doesNotMatch(gallery, /<video|https?:\/\//u);
  assert.match(gallery, /没有生成视频/u);
});
