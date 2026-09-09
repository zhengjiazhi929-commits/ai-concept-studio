import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { inspectFileIntegrity, integrityHash, isSha256 } from "../src/shared/integrity.mjs";
import { auditPngFrame } from "./ci-png-audit.mjs";
import {
  assertSourceBindingUnchanged, createCandidateDirectory, publishFileExclusive,
  resolveProofOutputRoot, snapshotSourceFiles, withProofBrowser, writeExclusive
} from "./render-illustration-system-proof.mjs";

const execute = promisify(execFile);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sceneDirectory = "studio/src/video/glass-card-preview";
const rasterDirectory = "studio/public/assets/visual-system-v1/ai-watermark-v013/frames";
const fontDirectory = "studio/node_modules/@fontsource-variable/noto-sans-sc";

export const GLASS_CARD_PROOF = Object.freeze({
  schemaVersion: "glass-card-still-proof-v1",
  compositionIds: Object.freeze(["GlassCardSingle", "GlassCardWide", "GlassCardFlow"]),
  width: 1920, height: 1080, fps: 30, durationInFrames: 1, frame: 0,
  imageFormat: "png", concurrency: 1, renderTimeoutMs: 120_000,
  defaultOutputRoot: "outputs/studio/glass-card-preview"
});

export const GLASS_SOURCE_FILES = Object.freeze([
  ".node-version", "studio/package.json", "studio/pnpm-lock.yaml", "studio/pnpm-workspace.yaml",
  "studio/scripts/render-glass-card-proof.mjs",
  "studio/scripts/render-illustration-system-proof.mjs", "studio/scripts/ci-png-audit.mjs",
  "studio/src/shared/integrity.mjs",
  "studio/src/video/components/visual-system-v1/ai-watermark.jsx",
  "studio/src/video/components/visual-system-v1/ai-watermark.mjs",
  "studio/src/video/components/visual-system-v1/tokens.mjs",
  "studio/src/video/visual-system-v1-ai-watermark-proof-plan.mjs",
  "studio/src/video/font-system.mjs", "studio/src/video/load-video-fonts.jsx"
]);

export const GLASS_PACKAGE_NAMES = Object.freeze([
  "@remotion/bundler", "@remotion/renderer", "remotion", "react", "react-dom"
]);

export function parseGlassArguments(argv) {
  const options = { outputRoot: null, help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === "--help") options.help = true;
    else if (flag === "--output-root") {
      const path = argv[++index];
      if (typeof path !== "string" || !path.trim() || path.startsWith("--")) {
        throw new Error("--output-root requires a path under outputs/");
      }
      options.outputRoot = path;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  return options;
}

export function assertGlassComposition(composition, id) {
  if (!GLASS_CARD_PROOF.compositionIds.includes(id)) throw new Error(`Unknown glass composition: ${id}`);
  for (const [key, expected] of Object.entries({ id, width: 1920, height: 1080, fps: 30, durationInFrames: 1 })) {
    if (composition?.[key] !== expected) throw new Error(`Unexpected glass composition ${key}: ${composition?.[key]}`);
  }
}

function safeRelativePath(path) {
  if (typeof path !== "string" || isAbsolute(path) || path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe source path: ${path}`);
  }
  return path;
}

async function listFiles(root, directory = root, skipNodeModules = false) {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Source directories must not be symlinks");
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipNodeModules && entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing source symlink: ${path}`);
    if (entry.isDirectory()) files.push(...await listFiles(root, path, skipNodeModules));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
  }
  return files.sort();
}

// Injected roots keep unit tests independent of ignored media and live Episodes.
export async function captureGlassSources(options = {}) {
  const root = resolve(options.root ?? workspaceRoot);
  const gitHead = options.gitHead ?? (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  const paths = [...(options.sourceFiles ?? GLASS_SOURCE_FILES)];
  for (const directory of options.sourceDirectories ?? [sceneDirectory, rasterDirectory]) {
    safeRelativePath(directory);
    paths.push(...(await listFiles(resolve(root, directory))).map((path) => `${directory}/${path}`));
  }
  if (options.installedLock !== false) {
    const lock = "studio/pnpm-lock.yaml", installed = "studio/node_modules/.pnpm/lock.yaml";
    if (!(await readFile(resolve(root, lock))).equals(await readFile(resolve(root, installed)))) {
      throw new Error("Installed pnpm lock does not match the frozen source lock");
    }
    paths.push(lock, installed);
  }
  const source = await snapshotSourceFiles(root, paths, gitHead);
  const fontPath = Object.hasOwn(options, "fontDirectory") ? options.fontDirectory : fontDirectory;
  if (fontPath) {
    safeRelativePath(fontPath);
    // pnpm links are intentional. Fingerprint actual font CSS and asset bytes.
    const fontRoot = await realpath(resolve(root, fontPath));
    for (const path of (await listFiles(fontRoot)).filter((path) => /\.(css|woff2?|json)$/u.test(path))) {
      source.files.push({ path: `${fontPath}/${path}`, ...await inspectFileIntegrity(resolve(fontRoot, path)) });
    }
  }
  const packageNames = options.packageNames ?? GLASS_PACKAGE_NAMES;
  const dependencyIdentities = [];
  if (packageNames.length) {
    const packageDocument = JSON.parse(await readFile(resolve(root, "studio/package.json"), "utf8"));
    const requireFromStudio = createRequire(resolve(root, "studio/package.json"));
    packageNames.forEach(safeRelativePath);
    // Resolve import conditions from the injected studio root without loading
    // or executing package code. require.resolve alone selects the wrong entry
    // for packages whose exports distinguish CommonJS and ESM.
    const importEntryUrls = JSON.parse((await execute(process.execPath, ["--input-type=module", "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1).map(name => import.meta.resolve(name))));",
      ...packageNames], { cwd: resolve(root, "studio"), timeout: 30_000 })).stdout);
    for (const [index, name] of packageNames.entries()) {
      const logicalRoot = `studio/node_modules/${name}`;
      const packageRoot = await realpath(resolve(root, logicalRoot));
      const installed = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
      if (installed.name !== name || installed.version !== packageDocument.dependencies?.[name]) {
        throw new Error(`Installed dependency is not the exact pinned version: ${name}`);
      }
      const entry = await realpath(requireFromStudio.resolve(name));
      const entryRelative = safeRelativePath(relative(packageRoot, entry).split(sep).join("/"));
      const importEntry = await realpath(fileURLToPath(importEntryUrls[index]));
      const importRelative = safeRelativePath(relative(packageRoot, importEntry).split(sep).join("/"));
      const packagePaths = await listFiles(packageRoot, packageRoot, true);
      if (![entryRelative, importRelative].every((path) => packagePaths.includes(path))) {
        throw new Error(`Resolved package entry escaped the direct package file scope: ${name}`);
      }
      const packageEvidence = [];
      for (const path of packagePaths) {
        packageEvidence.push({ path: `${logicalRoot}/${path}`, ...await inspectFileIntegrity(resolve(packageRoot, path)) });
      }
      source.files.push(...packageEvidence);
      dependencyIdentities.push({ name, version: installed.version, entry: `${logicalRoot}/${entryRelative}`,
        importEntry: `${logicalRoot}/${importRelative}`, packageFiles: packageEvidence.length,
        packageSha256: integrityHash(packageEvidence) });
    }
  }
  source.files.sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(source.files.map(({ path }) => path)).size !== source.files.length) {
    throw new Error("Duplicate source evidence paths");
  }
  return { ...source, visualSourceHash: integrityHash(source.files), dependencyIdentities,
    dependencyBindingScope: {
      directPackages: "Complete actual package files, including ESM/CJS entries; nested node_modules excluded.",
      transitiveDependencies: "Pinned lockfile identities only; not an exhaustive fingerprint of transitive runtime bytes."
    } };
}

function assertArtifact(artifact) {
  safeRelativePath(artifact?.path);
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || !isSha256(artifact.sha256)) {
    throw new Error("Artifact requires actual bytes and SHA-256");
  }
}

export function buildGlassManifest({ source, stills, runtime, generatedAt, gallery }) {
  if (!Array.isArray(stills) || stills.length !== 3) throw new Error("Exactly three glass stills are required");
  if (!/^[a-f0-9]{40,64}$/u.test(source?.gitHead) || !source.files?.length ||
    integrityHash(source.files) !== source.visualSourceHash) throw new Error("Invalid source binding");
  const preview = stills.map((still, index) => {
    if (still.id !== GLASS_CARD_PROOF.compositionIds[index] || still.frame !== 0 ||
      still.path !== `${still.id}.png`) throw new Error("Unexpected glass still composition or frame");
    assertArtifact(still);
    if (still.pixels?.width !== 1920 || still.pixels?.height !== 1080 || !isSha256(still.pixels?.pixelSha256)) {
      throw new Error("Glass PNG requires complete pixel decode evidence");
    }
    return { ...still, renderSettings: { compositionId: still.id, frame: 0, imageFormat: "png",
      width: 1920, height: 1080, fps: 30, compositionDurationInFrames: 1 } };
  });
  if (gallery) assertArtifact(gallery);
  const payload = {
    schemaVersion: GLASS_CARD_PROOF.schemaVersion, generatedAt,
    status: { machine_status: "three_pngs_decoded_and_bound", technical_status: "local_static_candidate",
      business_acceptance_status: "pending_human_review", release_status: "not_released" },
    productionApproved: false, userAccepted: false, finalAccepted: false,
    authorizesPublication: false, formalEpisodeStateTouched: false, videoGenerated: false,
    render: { ...GLASS_CARD_PROOF }, source, runtime, stills: preview,
    machineCheckLimits: ["Three PNG byte hashes, full pixel decode and current source bindings only.",
      "No video, animation timing, typography quality or human approval is inferred."],
    bindings: { sourceSha256: source.visualSourceHash, renderSettingsSha256: integrityHash(GLASS_CARD_PROOF),
      previewSha256: integrityHash(preview), runtimeSha256: integrityHash(runtime) },
    ...(gallery ? { gallery } : {})
  };
  return { ...payload, candidateHash: integrityHash(payload) };
}

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function buildGlassGalleryHtml(manifest) {
  const labels = { GlassCardSingle: "单卡 · 真实内容", GlassCardWide: "宽卡 · 内容布局", GlassCardFlow: "流程卡 · 内容关系" };
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>薄荷微磨砂卡片 · 三张静态样张</title><style>
body{margin:40px auto;max-width:1280px;padding:0 24px;background:#edf6f1;color:#193c33;font:16px/1.6 system-ui,sans-serif}h1{font-size:30px}figure{margin:36px 0}img{display:block;width:100%;height:auto;border-radius:14px}code{overflow-wrap:anywhere;font-size:12px}.notice{padding:16px 20px;background:#fff;border-left:3px solid #6a9986}a{color:#245f4d}figcaption{padding:12px 0}
</style></head><body><h1>薄荷微磨砂卡片 · 三张静态样张</h1>
<p class="notice">仅用于轻薄微磨砂、细亮边、柔和投影与真实内容布局复核。未生成视频；机器检查不等于人工认可，也不批准生产或发布。</p>
<p>生成时间：${html(manifest.generatedAt)}<br>Git HEAD：<code>${html(manifest.source.gitHead)}</code><br>视觉源码 SHA-256：<code>${html(manifest.source.visualSourceHash)}</code></p>
<p><a href="manifest.json">完整来源与检查记录</a></p>
${manifest.stills.map((still) => `<figure><a href="${html(still.path)}"><img src="${html(still.path)}" alt="${html(labels[still.id] ?? still.id)}"></a><figcaption>${html(labels[still.id] ?? still.id)} · 1920 × 1080 · 帧 0<br><code>SHA-256: ${html(still.sha256)}</code></figcaption></figure>`).join("\n")}
</body></html>\n`;
}

async function localBrowser() {
  const configured = process.env.REMOTION_BROWSER_EXECUTABLE;
  const candidates = configured ? [configured] : process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ] : process.platform === "win32" ? [process.env.PROGRAMFILES &&
    resolve(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe")].filter(Boolean) :
    ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return realpath(path); }
    catch (error) { if (configured) throw error; }
  }
  throw new Error("A local browser is required; set REMOTION_BROWSER_EXECUTABLE. Browser download is not authorized.");
}

export async function renderGlassStills({ renderer, browserExecutable, serveUrl, scratch, onStill,
  onBrowserLog = () => {} }) {
  return withProofBrowser(renderer, browserExecutable, async (puppeteerInstance) => {
    const results = [];
    for (const id of GLASS_CARD_PROOF.compositionIds) {
      const composition = await renderer.selectComposition({ serveUrl, id, puppeteerInstance,
        timeoutInMilliseconds: GLASS_CARD_PROOF.renderTimeoutMs, onBrowserLog, logLevel: "warn" });
      assertGlassComposition(composition, id);
      const path = resolve(scratch, `${id}.png`);
      await renderer.renderStill({ serveUrl, composition, output: path, frame: 0, imageFormat: "png",
        puppeteerInstance, timeoutInMilliseconds: GLASS_CARD_PROOF.renderTimeoutMs,
        onBrowserLog, overwrite: false, logLevel: "warn" });
      results.push(await onStill({ id, frame: 0, path }));
    }
    return results;
  });
}

export async function runGlassCardProof(options = {}) {
  const expectedNode = (await readFile(resolve(workspaceRoot, ".node-version"), "utf8")).trim().replace(/^v/u, "");
  if (process.versions.node !== expectedNode) throw new Error(`Expected Node ${expectedNode}, got ${process.versions.node}`);
  const outputRoot = resolveProofOutputRoot(workspaceRoot, options.outputRoot ?? GLASS_CARD_PROOF.defaultOutputRoot);
  const source = await captureGlassSources();
  const browserExecutable = await localBrowser();
  const [{ bundle }, renderer] = await Promise.all([import("@remotion/bundler"), import("@remotion/renderer")]);
  const runtime = { node: process.version, platform: process.platform, arch: process.arch,
    browser: { version: (await execute(browserExecutable, ["--version"])).stdout.trim(),
      ...await inspectFileIntegrity(browserExecutable) }, browserLogs: [] };
  const directory = await createCandidateDirectory(workspaceRoot, outputRoot);
  const scratch = await mkdtemp(resolve(directory, ".render-work-"));
  process.stdout.write(`Glass card static candidate: ${directory}\n`);
  try {
    const publicDir = resolve(scratch, "public");
    await mkdir(publicDir);
    for (const file of source.files.filter(({ path }) => path.startsWith(`${rasterDirectory}/`))) {
      const destination = resolve(publicDir, relative("studio/public", file.path));
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(workspaceRoot, file.path), destination, constants.COPYFILE_EXCL);
    }
    const serveUrl = await bundle({ entryPoint: resolve(workspaceRoot, sceneDirectory, "index.jsx"),
      publicDir, outDir: resolve(scratch, "bundle"), enableCaching: false });
    const stills = await renderGlassStills({ renderer, browserExecutable, serveUrl, scratch,
      onBrowserLog: (event) => runtime.browserLogs.push({ type: event.type, text: event.text }),
      onStill: async ({ id, frame, path }) => {
        const pixels = auditPngFrame(await readFile(path), { expectedWidth: 1920, expectedHeight: 1080 });
        const destination = resolve(directory, `${id}.png`);
        await publishFileExclusive(path, destination);
        process.stdout.write(`${id}: PNG complete (frame 0)\n`);
        return { id, frame, path: `${id}.png`, ...await inspectFileIntegrity(destination), pixels };
      } });
    assertSourceBindingUnchanged(source, await captureGlassSources());
    const browserAfter = await inspectFileIntegrity(browserExecutable);
    if (browserAfter.bytes !== runtime.browser.bytes || browserAfter.sha256 !== runtime.browser.sha256) {
      throw new Error("Local browser changed during still rendering");
    }
    const input = { source, stills, runtime, generatedAt: new Date().toISOString() };
    const galleryPath = resolve(directory, "index.html");
    await writeExclusive(galleryPath, buildGlassGalleryHtml(buildGlassManifest(input)));
    const manifest = buildGlassManifest({ ...input, gallery: { path: "index.html", ...await inspectFileIntegrity(galleryPath) } });
    await writeExclusive(resolve(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(scratch, { recursive: true, force: true });
    process.stdout.write(`Three static PNGs ready for human review: ${galleryPath}\n`);
    return { directory, manifest };
  } catch (error) {
    await writeExclusive(resolve(directory, "failure.json"), `${JSON.stringify({
      source, render: GLASS_CARD_PROOF, runtime, status: "incomplete-static-candidate",
      userAccepted: false, authorizesPublication: false, error: String(error?.stack ?? error)
    }, null, 2)}\n`);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseGlassArguments(process.argv.slice(2));
    if (options.help) process.stdout.write("Usage: node scripts/render-glass-card-proof.mjs [--output-root outputs/path]\nThree local 1920x1080 PNG stills only; no video or approval.\n");
    else await runGlassCardProof(options);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
