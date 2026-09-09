import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  assertOutputDirectoryAvailable,
  assertStillsInputsUnchanged,
  buildStillsArtifactManifest,
  FULL_VIDEO_COMPOSITION_CONTRACT,
  FULL_VIDEO_STILLS_ARTIFACT_SCHEMA_VERSION,
  publishStillsDirectory,
  stillsArtifactPaths,
  validateFullVideoComposition
} from "../scripts/render-agent-skill-full-video-stills.mjs";

test("versioned still paths use a unique private temporary directory", () => {
  const first = stillsArtifactPaths({
    outputRoot: "/fixture/outputs",
    episodeId: "episode-1",
    candidateVersion: 7,
    runId: "run-a"
  });
  const second = stillsArtifactPaths({
    outputRoot: "/fixture/outputs",
    episodeId: "episode-1",
    candidateVersion: 7,
    runId: "run-b"
  });
  assert.equal(first.finalDirectory, second.finalDirectory);
  assert.notEqual(first.temporaryDirectory, second.temporaryDirectory);
  assert.equal(first.publicationLockDirectory, second.publicationLockDirectory);
  assert.match(first.finalDirectory, /full-video-v007-design-qa$/u);
  assert.match(first.temporaryDirectory, /\.full-video-v007-design-qa\.rendering-run-a$/u);
});

test("artifact manifest binds HEAD, input identity, frame plan, and output hashes", () => {
  const inputs = {
    gitHead: "a".repeat(40),
    episode: { id: "episode-1", sha256: "b".repeat(64) },
    framePlan: [{ second: 1, frame: 30, filename: "second-001.png" }],
    inputSha256: "c".repeat(64)
  };
  const outputs = [{
    second: 1,
    frame: 30,
    renderedFrame: 30,
    filename: "second-001.png",
    bytes: 123,
    sha256: "d".repeat(64)
  }];
  const manifest = buildStillsArtifactManifest({
    episodeId: "episode-1",
    candidateVersion: 7,
    inputs,
    composition: { id: "ConceptPreview", width: 1920, height: 1080, fps: 30, durationInFrames: 18000 },
    outputs,
    generatedAt: "2026-08-31T00:00:00.000Z"
  });
  assert.equal(manifest.schemaVersion, FULL_VIDEO_STILLS_ARTIFACT_SCHEMA_VERSION);
  assert.equal(manifest.inputs.gitHead, "a".repeat(40));
  assert.equal(manifest.inputs.inputSha256, "c".repeat(64));
  assert.deepEqual(manifest.inputs.framePlan, inputs.framePlan);
  assert.equal(manifest.outputs[0].sha256, "d".repeat(64));
  assert.match(manifest.outputSetSha256, /^[0-9a-f]{64}$/u);
  assert.equal(manifest.publication.overwriteAllowed, false);
});

test("full-video stills reject a wrong or short composition instead of clamping frames", () => {
  const valid = { ...FULL_VIDEO_COMPOSITION_CONTRACT };
  assert.equal(validateFullVideoComposition(valid, [
    { frame: 0, filename: "first.png" },
    { frame: 17_999, filename: "last.png" }
  ]), true);
  assert.throws(
    () => validateFullVideoComposition({ ...valid, fps: 29.97 }, []),
    /composition fps 不符合契约/u
  );
  assert.throws(
    () => validateFullVideoComposition({ ...valid, durationInFrames: 900 }, []),
    /durationInFrames 不符合契约/u
  );
  assert.throws(
    () => validateFullVideoComposition(valid, [{ frame: 18_000, filename: "overflow.png" }]),
    /越界/u
  );
});

test("source drift during bundle or rendering fails closed", () => {
  assert.equal(assertStillsInputsUnchanged(
    { inputSha256: "a".repeat(64) },
    { inputSha256: "a".repeat(64) },
    "bundle"
  ), true);
  assert.throws(() => assertStillsInputsUnchanged(
    { inputSha256: "a".repeat(64) },
    { inputSha256: "b".repeat(64) },
    "Remotion bundle 生成"
  ), /Remotion bundle 生成期间.*发生变化/u);
});

test("stills publish is atomic and refuses an existing version", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "acs-stills-artifact-"));
  try {
    const temporaryDirectory = resolve(directory, ".v001.rendering-run");
    const finalDirectory = resolve(directory, "v001");
    const publicationLockDirectory = resolve(directory, ".v001.publish-lock");
    await mkdir(temporaryDirectory);
    await writeFile(resolve(temporaryDirectory, "artifact-manifest.json"), "fixture\n", "utf8");
    await publishStillsDirectory({ temporaryDirectory, finalDirectory, publicationLockDirectory });
    assert.equal(await readFile(resolve(finalDirectory, "artifact-manifest.json"), "utf8"), "fixture\n");
    await assert.rejects(
      assertOutputDirectoryAvailable(finalDirectory),
      /同版本静帧产物已存在，拒绝覆盖/u
    );

    const secondTemporary = resolve(directory, ".v001.rendering-second");
    await mkdir(secondTemporary);
    await assert.rejects(
      publishStillsDirectory({
        temporaryDirectory: secondTemporary,
        finalDirectory,
        publicationLockDirectory
      }),
      /拒绝覆盖/u
    );

    const thirdTemporary = resolve(directory, ".v001.rendering-third");
    const differentFinal = resolve(directory, "v002");
    await mkdir(thirdTemporary);
    await mkdir(publicationLockDirectory);
    await assert.rejects(
      publishStillsDirectory({
        temporaryDirectory: thirdTemporary,
        finalDirectory: differentFinal,
        publicationLockDirectory
      }),
      /拒绝并发覆盖/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
