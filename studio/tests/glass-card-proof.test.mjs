import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import {
  GLASS_CARD_PROOF, assertGlassComposition, buildGlassGalleryHtml,
  buildGlassManifest, captureGlassSources, parseGlassArguments, renderGlassStills
} from "../scripts/render-glass-card-proof.mjs";
import {
  assertSourceBindingUnchanged, createCandidateDirectory, publishFileExclusive,
  resolveProofOutputRoot, writeExclusive
} from "../scripts/render-illustration-system-proof.mjs";
import { integrityHash } from "../src/shared/integrity.mjs";

const head = "a".repeat(40);
const sha = "b".repeat(64);

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "glass-card-proof-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function stills() {
  return GLASS_CARD_PROOF.compositionIds.map((id) => ({ id, frame: 0,
    path: `${id}.png`, bytes: 100, sha256: sha,
    pixels: { width: 1920, height: 1080, pixelSha256: sha } }));
}

function manifestInput() {
  const files = [{ path: "src/scene.jsx", bytes: 3, sha256: sha }];
  return { source: { gitHead: head, files, visualSourceHash: integrityHash(files) },
    stills: stills(), runtime: { node: "fixture", browser: { version: "fixture", bytes: 3, sha256: sha } },
    generatedAt: "2026-09-08T00:00:00.000Z" };
}

test("glass proof CLI is PNG-only and bounded to the explicit three compositions", () => {
  assert.deepEqual(parseGlassArguments([]), { outputRoot: null, help: false });
  assert.deepEqual(parseGlassArguments(["--output-root", "outputs/glass"]), { outputRoot: "outputs/glass", help: false });
  for (const args of [["--output-root"], ["--output-root", "--help"], ["--video"],
    ["--stills-only"], ["--help", "--help"], ["--output-root", "a", "--output-root", "b"]]) {
    assert.throws(() => parseGlassArguments(args));
  }
  assert.deepEqual(GLASS_CARD_PROOF.compositionIds, ["GlassCardSingle", "GlassCardWide", "GlassCardFlow"]);
  assert.equal(GLASS_CARD_PROOF.durationInFrames, 1);
  assert.equal(GLASS_CARD_PROOF.frame, 0);
  assert.equal(GLASS_CARD_PROOF.concurrency, 1);
  assert.equal(GLASS_CARD_PROOF.imageFormat, "png");
});

test("every selected composition must be the exact 1080p single-frame composition", () => {
  const composition = { id: "GlassCardSingle", width: 1920, height: 1080, fps: 30, durationInFrames: 1 };
  assert.doesNotThrow(() => assertGlassComposition(composition, composition.id));
  for (const key of ["width", "height", "fps", "durationInFrames"]) {
    assert.throws(() => assertGlassComposition({ ...composition, [key]: 2 }, composition.id));
  }
  assert.throws(() => assertGlassComposition(composition, "Episode"));
});

test("candidate roots and publication cannot escape outputs or overwrite an existing file", async (t) => {
  const root = await fixture(t);
  const output = resolveProofOutputRoot(root, GLASS_CARD_PROOF.defaultOutputRoot);
  const first = await createCandidateDirectory(root, output);
  const second = await createCandidateDirectory(root, output);
  assert.notEqual(first, second);
  for (const path of [".", "../escape", "/", "outputs/../../escape"]) {
    assert.throws(() => resolveProofOutputRoot(root, path));
  }
  const final = resolve(first, "GlassCardSingle.png"), temporary = resolve(second, "frame.png");
  await writeExclusive(final, "old");
  await writeExclusive(temporary, "new");
  await assert.rejects(writeExclusive(final, "changed"), { code: "EEXIST" });
  await assert.rejects(publishFileExclusive(temporary, final), { code: "EEXIST" });
  assert.equal(await readFile(final, "utf8"), "old");
  assert.equal(await readFile(temporary, "utf8"), "new");
  await symlink(first, resolve(root, "outputs", "alias"));
  await assert.rejects(createCandidateDirectory(root, "outputs/alias"), /symlink/u);
});

test("source closure binds current files and actual symlinked font bytes without live episodes", async (t) => {
  const root = await fixture(t);
  await mkdir(resolve(root, "src"));
  await mkdir(resolve(root, "installed-font"));
  await writeFile(resolve(root, "src", "scene.jsx"), "scene");
  await writeFile(resolve(root, "installed-font", "font.woff2"), "font bytes");
  await symlink(resolve(root, "installed-font"), resolve(root, "font-package"));
  const options = { root, gitHead: head, sourceFiles: [], sourceDirectories: ["src"],
    fontDirectory: "font-package", packageNames: [], installedLock: false };
  const before = await captureGlassSources(options);
  assert.deepEqual(before.files.map((f) => f.path), ["font-package/font.woff2", "src/scene.jsx"]);
  assert.equal(before.visualSourceHash, integrityHash(before.files));
  await writeFile(resolve(root, "installed-font", "font.woff2"), "different font");
  const after = await captureGlassSources(options);
  assert.throws(() => assertSourceBindingUnchanged(before, after), /changed/u);
  await assert.rejects(captureGlassSources({ ...options, sourceDirectories: ["../escape"] }), /Unsafe/u);
  await symlink(resolve(root, "installed-font"), resolve(root, "src", "aliased"));
  await assert.rejects(captureGlassSources(options), /symlink/u);
});

test("installed dependency identity requires matching pinned package and installed lock", async (t) => {
  const root = await fixture(t);
  await mkdir(resolve(root, "studio/node_modules/.pnpm"), { recursive: true });
  await mkdir(resolve(root, "studio/node_modules/example"), { recursive: true });
  await writeFile(resolve(root, "studio/package.json"), JSON.stringify({ dependencies: { example: "1.0.0" } }));
  await writeFile(resolve(root, "studio/node_modules/example/package.json"), JSON.stringify({ name: "example", version: "1.0.0",
    exports: { import: "./index.mjs", require: "./index.cjs" } }));
  await writeFile(resolve(root, "studio/node_modules/example/index.cjs"), "module.exports = require('./internal.cjs');");
  await writeFile(resolve(root, "studio/node_modules/example/index.mjs"), "export {default} from './internal.cjs';");
  await writeFile(resolve(root, "studio/node_modules/example/internal.cjs"), "module.exports = 1;");
  await mkdir(resolve(root, "studio/node_modules/example/node_modules/nested"), { recursive: true });
  await writeFile(resolve(root, "studio/node_modules/example/node_modules/nested/index.cjs"), "must not recurse");
  await writeFile(resolve(root, "studio/pnpm-lock.yaml"), "lock");
  await writeFile(resolve(root, "studio/node_modules/.pnpm/lock.yaml"), "lock");
  const options = { root, gitHead: head, sourceFiles: ["studio/package.json"], sourceDirectories: [],
    fontDirectory: null, packageNames: ["example"] };
  const source = await captureGlassSources(options);
  assert.equal(source.dependencyIdentities[0].entry, "studio/node_modules/example/index.cjs");
  assert.equal(source.dependencyIdentities[0].importEntry, "studio/node_modules/example/index.mjs");
  assert.equal(source.dependencyIdentities[0].name, "example");
  assert.equal(source.dependencyIdentities[0].version, "1.0.0");
  assert.equal(source.dependencyIdentities[0].packageFiles, 4);
  for (const name of ["index.cjs", "index.mjs", "internal.cjs"]) {
    assert(source.files.some((f) => f.path === `studio/node_modules/example/${name}`));
  }
  assert(!source.files.some((f) => f.path.includes("/nested/")));
  assert.match(source.dependencyBindingScope.transitiveDependencies, /not.*exhaustive/u);
  await writeFile(resolve(root, "studio/node_modules/example/index.mjs"), "export const changed = true;");
  const esmChanged = await captureGlassSources(options);
  assert.notEqual(esmChanged.visualSourceHash, source.visualSourceHash);
  assert.throws(() => assertSourceBindingUnchanged(source, esmChanged), /changed/u);
  await writeFile(resolve(root, "studio/node_modules/example/internal.cjs"), "module.exports = 2;");
  const internalChanged = await captureGlassSources(options);
  assert.notEqual(internalChanged.visualSourceHash, esmChanged.visualSourceHash);
  assert.notEqual(internalChanged.dependencyIdentities[0].packageSha256, esmChanged.dependencyIdentities[0].packageSha256);
  await writeFile(resolve(root, "studio/node_modules/.pnpm/lock.yaml"), "stale");
  await assert.rejects(captureGlassSources(options), /lock/u);
  await writeFile(resolve(root, "studio/node_modules/.pnpm/lock.yaml"), "lock");
  await writeFile(resolve(root, "studio/node_modules/example/package.json"), JSON.stringify({ name: "example", version: "2.0.0", main: "index.cjs" }));
  await assert.rejects(captureGlassSources(options), /pinned/u);
});

test("manifest binds image frame/settings, source, runtime and gallery without granting approval", () => {
  const input = manifestInput();
  const manifest = buildGlassManifest(input);
  assert.equal(manifest.videoGenerated, false);
  assert.equal(manifest.userAccepted, false);
  assert.equal(manifest.productionApproved, false);
  assert.equal(manifest.authorizesPublication, false);
  assert.equal(manifest.status.business_acceptance_status, "pending_human_review");
  assert.deepEqual(manifest.stills.map((s) => s.frame), [0, 0, 0]);
  assert.equal(manifest.bindings.sourceSha256, input.source.visualSourceHash);
  const { candidateHash, ...payload } = manifest;
  assert.equal(candidateHash, integrityHash(payload));
  const changed = buildGlassManifest({ ...input, stills: stills().map((s, i) => i ? s : { ...s, sha256: "c".repeat(64) }) });
  assert.notEqual(changed.candidateHash, candidateHash);
  const withGallery = buildGlassManifest({ ...input, gallery: { path: "index.html", bytes: 50, sha256: sha } });
  assert.notEqual(withGallery.candidateHash, candidateHash);
  assert.throws(() => buildGlassManifest({ ...input, stills: stills().slice(1) }), /three|Three/u);
  assert.throws(() => buildGlassManifest({ ...input, stills: stills().map((s) => ({ ...s, frame: 1 })) }), /frame/u);
});

test("offline gallery exposes only three PNGs and explicit still-only candidate status", () => {
  const manifest = buildGlassManifest(manifestInput());
  const gallery = buildGlassGalleryHtml(manifest);
  assert.equal((gallery.match(/<img /gu) ?? []).length, 3);
  assert(!/<video|<script|https?:\/\//u.test(gallery));
  assert(gallery.includes("静态样张"));
  assert(gallery.includes("未生成视频"));
  assert(gallery.includes(manifest.source.visualSourceHash));
  assert(gallery.includes("manifest.json"));
});

test("render loop is single-browser sequential PNG-only and closes browser after failure", async () => {
  const events = [];
  const browser = { close: async () => events.push("close") };
  const renderer = {
    openBrowser: async () => { events.push("open"); return browser; },
    selectComposition: async ({ id, puppeteerInstance }) => {
      assert.equal(puppeteerInstance, browser);
      return { id, width: 1920, height: 1080, fps: 30, durationInFrames: 1 };
    },
    renderStill: async (options) => {
      assert.equal(options.puppeteerInstance, browser);
      assert.equal(options.imageFormat, "png");
      assert.equal(options.frame, 0);
      assert.equal(options.overwrite, false);
      assert.equal(options.timeoutInMilliseconds, GLASS_CARD_PROOF.renderTimeoutMs);
      events.push(options.composition.id);
    },
    renderMedia: () => { throw new Error("Video render is forbidden"); }
  };
  const completed = [];
  await renderGlassStills({ renderer, browserExecutable: "fixture", serveUrl: "fixture", scratch: "/fixture",
    onStill: async ({ id }) => { completed.push(id); } });
  assert.deepEqual(events, ["open", ...GLASS_CARD_PROOF.compositionIds, "close"]);
  assert.deepEqual(completed, GLASS_CARD_PROOF.compositionIds);
  events.length = 0;
  renderer.renderStill = async () => { throw new Error("frame failure"); };
  await assert.rejects(renderGlassStills({ renderer, browserExecutable: "fixture", serveUrl: "fixture", scratch: "/fixture", onStill: async () => {} }), /frame failure/u);
  assert.deepEqual(events, ["open", "close"]);
});

test("import and help require neither browser discovery nor a rendering environment", async () => {
  const url = pathToFileURL(resolve(import.meta.dirname, "../scripts/render-glass-card-proof.mjs")).href;
  const execute = promisify(execFile);
  const imported = await execute(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)});`], { env: { PATH: "/nonexistent" } });
  assert.equal(imported.stdout, "");
  const help = await execute(process.execPath, [resolve(import.meta.dirname, "../scripts/render-glass-card-proof.mjs"), "--help"], { env: { PATH: "/nonexistent" } });
  assert.match(help.stdout, /PNG/u);
});
