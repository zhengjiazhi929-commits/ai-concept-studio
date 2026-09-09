import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {promisify} from "node:util";
import test from "node:test";

import {
  V004D_PACING_BORDER_PROOF,
  captureV004dOverlayAssets,
  consumeV004dOverlayAssets
} from "../scripts/render-agent-skill-v004d-pacing-border-proof.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function overlayFixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "v004d-overlay-binding-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const frames = resolve(directory, "frames");
  await mkdir(frames);
  // Byte-binding tests use synthetic PNG payloads; no live media or renderer.
  const blank = Buffer.from("synthetic blank PNG");
  const cue = Buffer.from("synthetic cue PNG");
  await writeFile(resolve(directory, "blank.png"), blank);
  await writeFile(resolve(directory, "cue-007.png"), cue);
  const owners = Array.from({length: 600}, (_, frame) => frame < 300 ? 7 : null);
  for (let frame = 0; frame < owners.length; frame += 1) {
    await symlink(owners[frame] === null ? "../blank.png" : "../cue-007.png",
      resolve(frames, `frame-${String(frame).padStart(5, "0")}.png`));
  }
  const manifest = {
    schemaVersion: "agent-skill-v004c-no-box-proof-overlay-v1",
    proofRange: {fps: 30, globalStartFrame: 10080, globalEndFrameExclusive: 10680,
      localStartFrame: 0, localEndFrameExclusive: 600, frameCount: 600,
      frameOwnerDomain: "global-frame-index", frameFileDomain: "proof-local-frame-index"},
    displayCueCount: 1,
    displayCues: [{index: 7, startFrame: 10070, endFrameExclusive: 10380,
      proofGlobalStartFrame: 10080, proofGlobalEndFrameExclusive: 10380,
      proofLocalStartFrame: 0, proofLocalEndFrameExclusive: 300,
      imageFile: "cue-007.png", imageSha256: hash(cue)}],
    frameOwnerSha256: hash(JSON.stringify(owners)),
    captionFrameCount: 300, blankFrameCount: 300,
    blankImageFile: "blank.png", blankImageSha256: hash(blank), frameDirectory: "frames"
  };
  const manifestPath = resolve(directory, "overlay-manifest.json");
  const manifestBytes = JSON.stringify(manifest);
  await writeFile(manifestPath, manifestBytes);
  return {directory, frames, manifestPath, expectedHash: hash(manifestBytes)};
}

test("v004d reuse binds all 600 local frame owners and actual cue/blank bytes", async (t) => {
  const fixture = await overlayFixture(t);
  const snapshot = await captureV004dOverlayAssets(fixture.manifestPath, fixture.expectedHash);
  assert.equal(snapshot.evidence.frameCount, 600);
  assert.equal(snapshot.evidence.cues.length, 1);
  assert.equal(snapshot.evidence.manifest.sha256, fixture.expectedHash);
  assert.equal(snapshot.evidence.blank.sha256, hash("synthetic blank PNG"));
  assert.equal(snapshot.evidence.cues[0].sha256, hash("synthetic cue PNG"));
  let consumed = false;
  const result = await consumeV004dOverlayAssets(snapshot, async (framePattern) => {
    consumed = true;
    assert.equal(framePattern, resolve(fixture.frames, "frame-%05d.png"));
    return "consumed";
  });
  assert.equal(consumed, true);
  assert.equal(result, "consumed");
});

for (const file of ["cue-007.png", "blank.png"]) {
  test(`v004d rejects changed ${file} even when the accepted manifest is unchanged`, async (t) => {
    const fixture = await overlayFixture(t);
    await writeFile(resolve(fixture.directory, file), "different synthetic pixels");
    assert.equal(hash(await readFile(fixture.manifestPath)), fixture.expectedHash,
      "the historical manifest-only preflight still accepts this tampered asset");
    await assert.rejects(captureV004dOverlayAssets(fixture.manifestPath, fixture.expectedHash), /SHA-256/u);
  });
}

test("v004d rejects a frame symlink assigned to the wrong correctly hashed PNG target", async (t) => {
  const fixture = await overlayFixture(t);
  const frame = resolve(fixture.frames, "frame-00000.png");
  await unlink(frame);
  await symlink("../blank.png", frame);
  assert.equal(hash(await readFile(fixture.manifestPath)), fixture.expectedHash);
  await assert.rejects(captureV004dOverlayAssets(fixture.manifestPath, fixture.expectedHash), /frame 0.*owner/u);
});

test("v004d checks drift before consuming and again after consumption", async (t) => {
  const fixture = await overlayFixture(t);
  const snapshot = await captureV004dOverlayAssets(fixture.manifestPath, fixture.expectedHash);
  await assert.rejects(consumeV004dOverlayAssets(snapshot, async () => {
    await writeFile(resolve(fixture.directory, "cue-007.png"), "changed during consumption");
  }), /SHA-256/u);
  let consumedAgain = false;
  await assert.rejects(consumeV004dOverlayAssets(snapshot, async () => {
    consumedAgain = true;
  }), /SHA-256/u);
  assert.equal(consumedAgain, false);
});

test("v004d rejects frame-owner drift after consumption", async (t) => {
  const fixture = await overlayFixture(t);
  const snapshot = await captureV004dOverlayAssets(fixture.manifestPath, fixture.expectedHash);
  await assert.rejects(consumeV004dOverlayAssets(snapshot, async () => {
    const frame = resolve(fixture.frames, "frame-00599.png");
    await unlink(frame);
    await symlink("../cue-007.png", frame);
  }), /frame 599.*owner/u);
});

test("v004d rejects consumed bytes rewritten and restored before the final check", async (t) => {
  const fixture = await overlayFixture(t);
  const snapshot = await captureV004dOverlayAssets(fixture.manifestPath, fixture.expectedHash);
  await assert.rejects(consumeV004dOverlayAssets(snapshot, async () => {
    const file = resolve(fixture.directory, "cue-007.png");
    const accepted = await readFile(file);
    await writeFile(file, "temporary different pixels");
    await writeFile(file, accepted);
  }), /changed since preflight/u);
});

test("v004d rejects a changed manifest after consumption", async (t) => {
  const fixture = await overlayFixture(t);
  const snapshot = await captureV004dOverlayAssets(fixture.manifestPath, fixture.expectedHash);
  await assert.rejects(consumeV004dOverlayAssets(snapshot, async () => {
    await writeFile(fixture.manifestPath, "{}");
  }), /SHA-256/u);
});

test("仅导入 v004d 合同不读取或解析本机 Homebrew 媒体工具", async () => {
  const moduleUrl = new URL("../scripts/render-agent-skill-v004d-pacing-border-proof.mjs", import.meta.url);
  const program = [
    "import assert from 'node:assert/strict';",
    "import {realpathSync} from 'node:fs';",
    "assert.equal(process.permission.has('fs.read', '/opt/homebrew/bin/ffmpeg'), false);",
    "assert.throws(() => realpathSync('/opt/homebrew/bin/ffmpeg'), (error) => ['ERR_ACCESS_DENIED', 'ENOENT'].includes(error.code));",
    `const {V004D_PACING_BORDER_PROOF: contract} = await import(${JSON.stringify(moduleUrl.href)});`,
    "process.stdout.write(JSON.stringify({proofOnly: contract.proofOnly, frames: contract.outputFrameCount}));"
  ].join("\n");
  const {stdout} = await promisify(execFile)(process.execPath, [
    "--permission",
    `--allow-fs-read=${resolve(import.meta.dirname, "..")}`,
    "--input-type=module",
    "--eval",
    program
  ], {timeout: 30_000});
  assert.deepEqual(JSON.parse(stdout), {proofOnly: true, frames: 522});
});

test("v004d 样片固定验证 S11 边框并同步提速所有时间媒体", async () => {
  const contract = V004D_PACING_BORDER_PROOF;
  assert.equal(contract.candidateName, "v004d-pacing-card-border-proof-v002");
  assert.equal(contract.globalStartFrame, 10_080);
  assert.equal(contract.globalEndFrameInclusive, 10_679);
  assert.equal(contract.sourceFrameCount, 600);
  assert.equal(contract.playbackRate, 1.15);
  assert.equal(contract.outputFrameCount, 522);
  assert.equal(contract.outputAudioSamples, 835_200);
  assert.equal(contract.outputDurationSeconds, 17.4);
  assert.equal(contract.temporaryVoice, true);
  assert.equal(contract.finalHumanRecording, false);
  assert.equal(contract.proofOnly, true);

  const source = await readFile(
    new URL("../scripts/render-agent-skill-v004d-pacing-border-proof.mjs", import.meta.url),
    "utf8"
  );
  assert.match(source, /buildSynchronizedPacingFilterGraph/u);
  assert.match(source, /captions: "composited-before-retime"/u);
  assert.match(source, /concurrency: 1/u);
  assert.match(source, /assertLowPriority/u);
  assert.match(source, /atomicPublishDirectoryNoReplace/u);
  assert.match(source, /fullVideoDecodePassed: true/u);
  assert.match(source, /fullAudioDecodePassed: true/u);
  assert.doesNotMatch(source, /overwrite: true/u);
});
