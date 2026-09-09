import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  ILLUSTRATION_PROOF,
  assertComposition,
  assertProofDefinition,
  assertSourceBindingUnchanged,
  buildGalleryHtml,
  buildProofManifest,
  buildProofVideoDecodeArgs,
  createCandidateDirectory,
  illustrationProofPlan,
  parseProofArguments,
  proofFrameRenderOptions,
  proofPreviewEvidence,
  publishFileExclusive,
  resolveProofOutputRoot,
  snapshotSourceFiles,
  validateVideoProbe,
  withProofBrowser,
  writeExclusive
} from "../scripts/render-illustration-system-proof.mjs";

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "illustration-proof-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function validProbe() {
  return {
    streams: [{
      codec_type: "video", codec_name: "h264", width: 1920, height: 1080,
      avg_frame_rate: "30/1", r_frame_rate: "30/1", nb_read_frames: "360",
      nb_frames: "360", duration: "12.000000"
    }],
    format: { duration: "12.000000" }
  };
}

test("proof CLI has bounded defaults and rejects ambiguous or unknown flags", () => {
  assert.deepEqual(parseProofArguments([]), { outputRoot: null, stillsOnly: false, editorial: false, help: false });
  assert.deepEqual(parseProofArguments(["--output-root", "outputs/proofs", "--stills-only"]), {
    outputRoot: "outputs/proofs", stillsOnly: true, editorial: false, help: false
  });
  assert.equal(parseProofArguments(["--editorial", "--stills-only"]).editorial, true);
  for (const args of [["--output-root"], ["--output-root", "--stills-only"], ["--wat"],
    ["--stills-only", "--stills-only"], ["--editorial", "--editorial"],
    ["--output-root", "a", "--output-root", "b"]]) {
    assert.throws(() => parseProofArguments(args));
  }
});

test("editorial is explicit, single-composition, 20 seconds and gets a separate safe output root", () => {
  const original = illustrationProofPlan();
  const editorial = illustrationProofPlan({ editorial: true });
  assert.deepEqual(original.compositionIds, ILLUSTRATION_PROOF.compositionIds);
  assert.equal(original.durationInFrames, 360);
  assert.equal(original.defaultOutputRoot, "outputs/studio/illustration-system");
  assert.equal(editorial.mode, "editorial");
  assert.deepEqual(editorial.compositionIds, ["EditorialSelectLoad"]);
  assert.equal(editorial.durationInFrames, 600);
  assert.equal(editorial.durationSeconds, 20);
  assert.equal(editorial.fps, 30);
  assert.deepEqual(editorial.stillFrames, [0, 90, 180, 240, 285, 330, 390, 450, 599]);
  assert.equal(editorial.defaultOutputRoot, "outputs/studio/editorial-illustration");
  const root = resolve(tmpdir(), "editorial-test-workspace");
  assert.equal(resolveProofOutputRoot(root, editorial.defaultOutputRoot), resolve(root, "outputs/studio/editorial-illustration"));
  const composition = { id: "EditorialSelectLoad", width: 1920, height: 1080, fps: 30, durationInFrames: 600 };
  assert.doesNotThrow(() => assertComposition(composition, composition.id, editorial));
  assert.throws(() => assertComposition({ ...composition, durationInFrames: 360 }, composition.id, editorial));
  assert.throws(() => assertComposition(composition, composition.id));
});

test("background editorial rendering has a bounded longer frame wait without changing the original mode", () => {
  assert.deepEqual(proofFrameRenderOptions(illustrationProofPlan()), { timeoutInMilliseconds: 30_000 });
  const plan = illustrationProofPlan({ editorial: true });
  assert.deepEqual(proofFrameRenderOptions(plan), { timeoutInMilliseconds: 120_000 });
  assert.equal(plan.renderTimeoutMs, 120_000);
  assert.throws(() => proofFrameRenderOptions({ renderTimeoutMs: Infinity }), /timeout/u);
  assert.throws(() => proofFrameRenderOptions({ renderTimeoutMs: 0 }), /timeout/u);
  assert.equal(plan.concurrency, 1);
});

test("editorial media and candidate definitions cannot pass using a 12-second contract", () => {
  const editorial = illustrationProofPlan({ editorial: true });
  const media = validProbe();
  media.streams[0].nb_frames = "600";
  media.streams[0].nb_read_frames = "600";
  media.streams[0].duration = "20";
  media.format.duration = "20";
  assert.equal(validateVideoProbe(media, editorial).frameCount, 600);
  assert.throws(() => validateVideoProbe(validProbe(), editorial), /probe/u);
  assert.throws(() => validateVideoProbe(media), /probe/u);
  assert.doesNotThrow(() => assertProofDefinition({ fps: 30, durationInFrames: 600 }, editorial));
  assert.throws(() => assertProofDefinition({ fps: 30, durationInFrames: 360 }, editorial));
  assert.throws(() => assertProofDefinition({ fps: 24, durationInFrames: 600 }, editorial));
  const preview = proofPreviewEvidence({ id: "EditorialSelectLoad", video: null,
    stills: [{ frame: 285, path: "EditorialSelectLoad-frame-285.png", bytes: 20, sha256: "3".repeat(64) }] }, editorial, true);
  assert.deepEqual(preview[0].renderSettings, { mode: "editorial", compositionId: "EditorialSelectLoad",
    durationInFrames: 600, fps: 30, stillsOnly: true });
  assert.equal(preview[0].frame, 285);
});

test("proof compositions and still frames are explicit and fixed", () => {
  assert.deepEqual(ILLUSTRATION_PROOF.compositionIds, [
    "IllustrationSelectLoad", "IllustrationRequestReturn", "IllustrationValidateRestore"
  ]);
  assert.deepEqual(ILLUSTRATION_PROOF.stillFrames, [0, 75, 150, 225, 300, 359]);
  assert.equal(ILLUSTRATION_PROOF.concurrency, 1);
  const composition = { id: ILLUSTRATION_PROOF.compositionIds[0], width: 1920, height: 1080,
    fps: 30, durationInFrames: 360 };
  assert.doesNotThrow(() => assertComposition(composition, composition.id));
  assert.throws(() => assertComposition({ ...composition, durationInFrames: 361 }, composition.id));
  assert.throws(() => assertComposition(composition, "Unbounded"));
});

test("output root stays under this workspace's ignored outputs boundary", () => {
  const workspace = resolve(tmpdir(), "proof-workspace");
  assert.equal(resolveProofOutputRoot(workspace, null), resolve(workspace, "outputs/studio/illustration-system"));
  assert.equal(resolveProofOutputRoot(workspace, "outputs/proofs"), resolve(workspace, "outputs/proofs"));
  for (const value of [".", "studio", "../elsewhere", "outputs/../../escape", "/", "outputs-other"]) {
    assert.throws(() => resolveProofOutputRoot(workspace, value), /outputs/u);
  }
});

test("candidate directories are unique and do not follow symlinks", async (t) => {
  const workspace = await fixture(t);
  const outputRoot = resolveProofOutputRoot(workspace, "outputs/proofs");
  const first = await createCandidateDirectory(workspace, outputRoot);
  const second = await createCandidateDirectory(workspace, outputRoot);
  assert.notEqual(first, second);
  await mkdir(resolve(workspace, "elsewhere"));
  await symlink(resolve(workspace, "elsewhere"), resolve(workspace, "outputs/linked"));
  await assert.rejects(createCandidateDirectory(workspace, resolve(workspace, "outputs/linked/proofs")), /symlink/u);
});

test("exclusive publication cannot replace an existing output or a symlink", async (t) => {
  const directory = await fixture(t);
  const source = resolve(directory, "rendered.mp4");
  const target = resolve(directory, "candidate.mp4");
  await writeFile(source, "new-render");
  await publishFileExclusive(source, target);
  assert.equal(await readFile(target, "utf8"), "new-render");
  await writeFile(source, "second-render");
  await assert.rejects(publishFileExclusive(source, target), { code: "EEXIST" });
  assert.equal(await readFile(target, "utf8"), "new-render");
  await symlink(source, resolve(directory, "source-link"));
  await assert.rejects(publishFileExclusive(resolve(directory, "source-link"), resolve(directory, "other")), /regular file/u);
  await assert.rejects(writeExclusive(target, "replace"), { code: "EEXIST" });
});

test("probe requires fully counted 12 second 1080p30 video without another stream", () => {
  const report = validateVideoProbe(validProbe());
  assert.equal(report.passed, true);
  assert.equal(report.frameCount, 360);
  assert.equal(report.durationSeconds, 12);
  const invalid = [
    (probe) => { probe.streams.push({ codec_type: "audio" }); },
    (probe) => { probe.streams.push({ codec_type: "video" }); },
    (probe) => { probe.streams[0].width = 1280; },
    (probe) => { probe.streams[0].height = 720; },
    (probe) => { probe.streams[0].avg_frame_rate = "0/0"; },
    (probe) => { probe.streams[0].r_frame_rate = "60/1"; },
    (probe) => { probe.streams[0].nb_read_frames = "359"; },
    (probe) => { delete probe.streams[0].nb_read_frames; },
    (probe) => { probe.streams[0].nb_frames = "361"; },
    (probe) => { probe.streams[0].duration = "11.9"; },
    (probe) => { delete probe.format.duration; },
    (probe) => { probe.format.duration = "NaN"; }
  ];
  for (const mutate of invalid) {
    const probe = validProbe();
    mutate(probe);
    assert.throws(() => validateVideoProbe(probe), /probe/u);
  }
});

test("full decode selects the packaged rawvideo encoder and consumes every video frame", () => {
  const path = "candidate with spaces/IllustrationSelectLoad.mp4";
  const args = buildProofVideoDecodeArgs(path);
  assert.equal(args[args.indexOf("-i") + 1], path);
  assert.equal(args[args.indexOf("-map") + 1], "0:v:0");
  assert.equal(args[args.indexOf("-c:v") + 1], "rawvideo");
  assert.equal(args[args.indexOf("-f") + 1], "null");
  assert.equal(args.at(-1), "-");
  assert.ok(args.includes("-xerror"));
  assert.ok(args.includes("-an"));
  assert.equal(args[args.indexOf("-err_detect") + 1], "explode");
  assert.ok(!args.some((arg) => ["copy", "-t", "-ss", "-frames:v", "-vn"].includes(arg)));
  for (const value of ["", null, undefined]) assert.throws(() => buildProofVideoDecodeArgs(value));
});

test("source binding is stable by path and detects byte, path, and HEAD changes", async (t) => {
  const root = await fixture(t);
  await writeFile(resolve(root, "a.mjs"), "export const a = 1;\n");
  await writeFile(resolve(root, "b.mjs"), "export const b = 2;\n");
  const head = "1".repeat(40);
  const first = await snapshotSourceFiles(root, ["b.mjs", "a.mjs"], head);
  const reordered = await snapshotSourceFiles(root, ["a.mjs", "b.mjs"], head);
  assert.deepEqual(first, reordered);
  assert.match(first.visualSourceHash, /^[a-f0-9]{64}$/u);
  assert.equal(first.gitHead, head);
  assert.deepEqual(first.files.map(({ path }) => path), ["a.mjs", "b.mjs"]);
  assert.doesNotThrow(() => assertSourceBindingUnchanged(first, reordered));
  await writeFile(resolve(root, "b.mjs"), "export const b = 3;\n");
  const changed = await snapshotSourceFiles(root, ["a.mjs", "b.mjs"], head);
  assert.notEqual(first.visualSourceHash, changed.visualSourceHash);
  assert.throws(() => assertSourceBindingUnchanged(first, changed), /changed/u);
  assert.throws(() => assertSourceBindingUnchanged(first, { ...first, gitHead: "2".repeat(40) }), /changed/u);
  await assert.rejects(snapshotSourceFiles(root, ["../outside"], head), /source path/u);
  await symlink(resolve(root, "a.mjs"), resolve(root, "link.mjs"));
  await assert.rejects(snapshotSourceFiles(root, ["link.mjs"], head), /symlink/u);
});

test("manifest and offline gallery expose candidate limits and source/file hashes", () => {
  const source = { gitHead: "1".repeat(40), visualSourceHash: "2".repeat(64), files: [] };
  const compositions = [{ id: "IllustrationSelectLoad", video: null,
    stills: [{ frame: 0, path: "select-000.png", bytes: 123, sha256: "3".repeat(64) }] }];
  const manifest = buildProofManifest({ source, compositions, stillsOnly: true,
    generatedAt: "2026-09-07T00:00:00.000Z", runtime: { node: "v24.19.0" } });
  assert.equal(manifest.status.business_acceptance_status, "pending_human_review");
  assert.equal(manifest.status.release_status, "not_released");
  assert.equal(manifest.status.machine_status, "stills_checked_video_not_rendered");
  assert.equal(manifest.authorizesPublication, false);
  assert.equal(manifest.videoGenerated, false);
  assert.equal(manifest.source, source);
  const html = buildGalleryHtml(manifest);
  assert.match(html, /<html[^>]+lang="zh-CN"/u);
  assert.match(html, /人工/u);
  assert.match(html, /manifest\.json/u);
  assert.match(html, /select-000\.png/u);
  assert.match(html, new RegExp(source.visualSourceHash, "u"));
  assert.doesNotMatch(html, /https?:\/\/|<script/u);
  const videoHtml = buildGalleryHtml({ ...manifest, compositions: [{ ...compositions[0],
    id: "<script>bad</script>", video: { path: "proof.mp4", sha256: "4".repeat(64) } }] });
  assert.match(videoHtml, /<video controls/u);
  assert.doesNotMatch(videoHtml, /<script>/u);
  assert.match(videoHtml, /&lt;script&gt;/u);
});

test("editorial manifest and gallery bind the selected 20-second silent mode", () => {
  const proofPlan = illustrationProofPlan({ editorial: true });
  const manifest = buildProofManifest({ proofPlan, source: { gitHead: "1".repeat(40), visualSourceHash: "2".repeat(64), files: [] },
    compositions: [{ id: "EditorialSelectLoad", video: null, stills: [] }], stillsOnly: true,
    runtime: { node: "v24.19.0" }, generatedAt: "2026-09-07T00:00:00.000Z" });
  assert.equal(manifest.mode, "editorial");
  assert.equal(manifest.render.durationInFrames, 600);
  assert.equal(manifest.render.durationSeconds, 20);
  assert.equal(manifest.render.audio, false);
  assert.equal(manifest.status.business_acceptance_status, "pending_human_review");
  assert.equal(manifest.videoGenerated, false);
  const gallery = buildGalleryHtml(manifest);
  assert.match(gallery, /二维动作插画/u);
  assert.match(gallery, /20 秒/u);
  assert.match(gallery, /无旁白/u);
  assert.match(gallery, /尚未生成视频/u);
});

test("import has no rendering, filesystem writes, or system runtime discovery", async (t) => {
  const directory = await fixture(t);
  const script = resolve(import.meta.dirname, "../scripts/render-illustration-system-proof.mjs");
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--permission", `--allow-fs-read=${resolve(import.meta.dirname, "../..")}`, "--input-type=module", "-e",
    `await import(${JSON.stringify(pathToFileURL(script).href)}); console.log('pure-import');`
  ], { cwd: directory, env: { PATH: "", NODE_NO_WARNINGS: "1" } });
  assert.equal(stdout.trim(), "pure-import");
});

test("proof browser opens once and closes after successful work or a render failure", async () => {
  for (const fails of [false, true]) {
    const events = [];
    const browser = { close: async (options) => { events.push(["close", options]); } };
    const renderer = { openBrowser: async (type, options) => {
      events.push(["open", type, options]);
      return browser;
    } };
    const operation = withProofBrowser(renderer, "test-browser", async (instance) => {
      assert.equal(instance, browser);
      events.push(["render"]);
      if (fails) throw new Error("render failed");
      return "done";
    });
    if (fails) await assert.rejects(operation, /render failed/u);
    else assert.equal(await operation, "done");
    assert.deepEqual(events, [
      ["open", "chrome", { browserExecutable: "test-browser", logLevel: "warn" }],
      ["render"], ["close", { silent: true }]
    ]);
  }
});
