import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access, copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath,
  rm, unlink, writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { inspectFileIntegrity, integrityHash } from "../src/shared/integrity.mjs";
import { auditPngFrame } from "./ci-png-audit.mjs";

const execute = promisify(execFile);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const entryRelativePath = "studio/src/video/illustration-system/index.jsx";
const rasterRelativePath = "studio/public/assets/visual-system-v1/ai-watermark-v013/frames";
const fontRelativePath = "studio/node_modules/@fontsource-variable/noto-sans-sc";

export const ILLUSTRATION_PROOF = Object.freeze({
  schemaVersion: "illustration-system-proof-v1",
  compositionIds: Object.freeze([
    "IllustrationSelectLoad", "IllustrationRequestReturn", "IllustrationValidateRestore"
  ]),
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 360,
  concurrency: 1,
  renderTimeoutMs: 30_000,
  stillFrames: Object.freeze([0, 75, 150, 225, 300, 359])
});

const CATALOG_PROOF_PLAN = Object.freeze({
  ...ILLUSTRATION_PROOF, mode: "catalog", durationSeconds: 12,
  defaultOutputRoot: "outputs/studio/illustration-system"
});

export const EDITORIAL_PROOF = Object.freeze({
  ...ILLUSTRATION_PROOF, mode: "editorial", compositionIds: Object.freeze(["EditorialSelectLoad"]),
  durationInFrames: 600, durationSeconds: 20,
  renderTimeoutMs: 120_000,
  stillFrames: Object.freeze([0, 90, 180, 240, 285, 330, 390, 450, 599]),
  defaultOutputRoot: "outputs/studio/editorial-illustration"
});

export function illustrationProofPlan(options = {}) {
  return options.editorial ? EDITORIAL_PROOF : CATALOG_PROOF_PLAN;
}

export function proofFrameRenderOptions(proofPlan) {
  if (![30_000, 120_000].includes(proofPlan?.renderTimeoutMs)) {
    throw new Error("Unsupported proof frame timeout");
  }
  return { timeoutInMilliseconds: proofPlan.renderTimeoutMs };
}

export const PROOF_SOURCE_FILES = Object.freeze([
  ".node-version",
  "studio/package.json",
  "studio/pnpm-lock.yaml",
  "studio/pnpm-workspace.yaml",
  "studio/scripts/render-illustration-system-proof.mjs",
  "studio/scripts/ci-png-audit.mjs",
  "studio/src/shared/integrity.mjs",
  "studio/src/shared/illustration-system-contract.mjs",
  "studio/src/video/components/visual-system-v1/ai-watermark.jsx",
  "studio/src/video/components/visual-system-v1/ai-watermark.mjs",
  "studio/src/video/components/visual-system-v1/tokens.mjs",
  "studio/src/video/visual-system-v1-ai-watermark-proof-plan.mjs",
  "studio/src/video/font-system.mjs",
  "studio/src/video/load-video-fonts.jsx"
]);

export function parseProofArguments(argv) {
  const options = { outputRoot: null, stillsOnly: false, editorial: false, help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (seen.has(flag)) throw new Error(`Duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === "--stills-only") options.stillsOnly = true;
    else if (flag === "--editorial") options.editorial = true;
    else if (flag === "--help") options.help = true;
    else if (flag === "--output-root") {
      const value = argv[++index];
      if (typeof value !== "string" || !value.trim() || value.startsWith("--")) {
        throw new Error("--output-root requires a path under outputs/");
      }
      options.outputRoot = value;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  return options;
}

function isInside(root, target) {
  const suffix = relative(resolve(root), resolve(target));
  return suffix === "" || (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix));
}

export function resolveProofOutputRoot(root, requested) {
  const outputs = resolve(root, "outputs");
  const target = resolve(root, requested ?? "outputs/studio/illustration-system");
  if (!isInside(outputs, target)) throw new Error("Proof output root must be inside this workspace's outputs/");
  return target;
}

async function assertNoSymlinkPath(root, target) {
  if (!isInside(root, target)) throw new Error("Path escapes root");
  const parts = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const part of ["", ...parts]) {
    current = resolve(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symlink path: ${current}`);
  }
}

export async function createCandidateDirectory(root, outputRoot) {
  const target = resolveProofOutputRoot(root, outputRoot);
  let current = resolve(root);
  if ((await lstat(current)).isSymbolicLink()) throw new Error("Workspace must not be a symlink");
  for (const segment of relative(current, target).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Refusing symlink output directory: ${current}`);
    if (!info.isDirectory()) throw new Error("Output parent must be a directory");
  }
  return mkdtemp(resolve(target, "candidate-"));
}

export async function writeExclusive(path, contents) {
  await writeFile(path, contents, { flag: "wx", encoding: "utf8" });
}

export async function publishFileExclusive(source, destination) {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Rendered output must be a regular file");
  // Hard-link publication is atomic and fails with EEXIST. rename() can overwrite.
  await link(source, destination);
  await unlink(source);
}

export function assertComposition(composition, id, proofPlan = ILLUSTRATION_PROOF) {
  if (!proofPlan.compositionIds.includes(id)) throw new Error("Unknown proof composition");
  for (const [key, expected] of Object.entries({ id,
    width: proofPlan.width, height: proofPlan.height,
    fps: proofPlan.fps, durationInFrames: proofPlan.durationInFrames })) {
    if (composition?.[key] !== expected) throw new Error(`Unexpected composition ${key}: ${composition?.[key]}`);
  }
}

export function assertProofDefinition(definition, proofPlan) {
  if (definition?.fps !== proofPlan.fps || definition?.durationInFrames !== proofPlan.durationInFrames) {
    throw new Error(`Candidate definition must match ${proofPlan.mode}: ${proofPlan.durationInFrames} frames at ${proofPlan.fps}fps`);
  }
}

export function proofPreviewEvidence(result, proofPlan, stillsOnly) {
  return [result.video, ...result.stills].filter(Boolean).map(({ path, bytes, sha256, frame }) => ({
    path, bytes, sha256,
    ...(proofPlan.mode === "editorial" ? {
      ...(frame === undefined ? {} : { frame }),
      renderSettings: { mode: "editorial", compositionId: result.id,
        durationInFrames: proofPlan.durationInFrames, fps: proofPlan.fps, stillsOnly }
    } : {})
  }));
}

function number(value) {
  if (value === null || value === undefined || value === "") return NaN;
  return Number(value);
}

function rate(value) {
  if (typeof value !== "string" || !/^\d+\/\d+$/u.test(value)) return NaN;
  const [numerator, denominator] = value.split("/").map(Number);
  return denominator > 0 ? numerator / denominator : NaN;
}

export function validateVideoProbe(probe, proofPlan = ILLUSTRATION_PROOF) {
  const streams = probe?.streams;
  const video = streams?.[0];
  const frameCount = number(video?.nb_read_frames);
  const durationSeconds = number(probe?.format?.duration);
  const expectedDurationSeconds = proofPlan.durationInFrames / proofPlan.fps;
  const checks = {
    videoOnly: Array.isArray(streams) && streams.length === 1 && video?.codec_type === "video",
    codec: video?.codec_name === "h264",
    dimensions: video?.width === proofPlan.width && video?.height === proofPlan.height,
    averageFps: rate(video?.avg_frame_rate) === proofPlan.fps,
    nominalFps: rate(video?.r_frame_rate) === proofPlan.fps,
    decodedFrames: frameCount === proofPlan.durationInFrames,
    declaredFrames: number(video?.nb_frames) === proofPlan.durationInFrames,
    streamDuration: Math.abs(number(video?.duration) - expectedDurationSeconds) <= 0.001,
    containerDuration: Math.abs(durationSeconds - expectedDurationSeconds) <= 0.001
  };
  const failed = Object.keys(checks).filter((key) => !checks[key]);
  if (failed.length) throw new Error(`Video probe failed: ${failed.join(", ")}`);
  return { passed: true, checks, frameCount, durationSeconds,
    width: proofPlan.width, height: proofPlan.height, fps: proofPlan.fps };
}

export function buildProofVideoDecodeArgs(path) {
  if (typeof path !== "string" || !path.trim()) throw new Error("Video decode requires an input path");
  // The packaged FFmpeg omits wrapped_avframe, the null muxer's default encoder.
  // rawvideo forces actual decoding of the whole stream without writing media.
  return [
    "-nostdin", "-hide_banner", "-v", "error", "-xerror", "-err_detect", "explode",
    "-threads", "1", "-i", path, "-map", "0:v:0", "-an",
    "-c:v", "rawvideo", "-threads", "1", "-f", "null", "-"
  ];
}

function sourcePath(root, path) {
  if (typeof path !== "string" || path.includes("\\") || isAbsolute(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe source path: ${path}`);
  }
  const target = resolve(root, path);
  if (!isInside(root, target)) throw new Error(`Unsafe source path: ${path}`);
  return target;
}

export async function snapshotSourceFiles(root, paths, gitHead) {
  if (!/^[a-f0-9]{40,64}$/u.test(gitHead)) throw new Error("Invalid Git HEAD");
  const files = [];
  for (const path of [...new Set(paths)].sort()) {
    const target = sourcePath(root, path);
    await assertNoSymlinkPath(root, target);
    if (!(await lstat(target)).isFile()) throw new Error(`Source is not a file: ${path}`);
    files.push({ path, ...await inspectFileIntegrity(target) });
  }
  if (!files.length) throw new Error("Source evidence must not be empty");
  return { gitHead, visualSourceHash: integrityHash(files), files };
}

export function assertSourceBindingUnchanged(before, after) {
  if (before.gitHead !== after.gitHead || before.visualSourceHash !== after.visualSourceHash) {
    throw new Error("Git HEAD or visual sources changed during rendering; candidate evidence is invalid");
  }
}

async function listFiles(root, directory) {
  await assertNoSymlinkPath(root, directory);
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing source symlink: ${path}`);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
  }
  return files;
}

async function captureSources() {
  const { stdout } = await execute("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot });
  const paths = [...PROOF_SOURCE_FILES,
    ...await listFiles(workspaceRoot, resolve(workspaceRoot, "studio/src/video/illustration-system")),
    ...await listFiles(workspaceRoot, resolve(workspaceRoot, rasterRelativePath))];
  const snapshot = await snapshotSourceFiles(workspaceRoot, paths, stdout.trim());
  // pnpm intentionally symlinks packages. Bind the actual installed font bytes,
  // while keeping portable package-relative names in the evidence.
  const fontRoot = await realpath(resolve(workspaceRoot, fontRelativePath));
  const fontPaths = (await listFiles(fontRoot, fontRoot)).filter((path) => /\.(css|woff2?|json)$/u.test(path));
  for (const path of fontPaths) {
    snapshot.files.push({ path: `${fontRelativePath}/${path}`, ...await inspectFileIntegrity(resolve(fontRoot, path)) });
  }
  snapshot.files.sort((a, b) => a.path.localeCompare(b.path));
  snapshot.visualSourceHash = integrityHash(snapshot.files);
  return snapshot;
}

export function buildProofManifest({ source, compositions, stillsOnly, generatedAt, runtime,
  proofPlan = illustrationProofPlan() }) {
  return {
    schemaVersion: ILLUSTRATION_PROOF.schemaVersion,
    mode: proofPlan.mode,
    generatedAt,
    status: {
      machine_status: stillsOnly ? "stills_checked_video_not_rendered" : "proof_media_checks_passed",
      technical_status: "local_candidate_evidence",
      business_acceptance_status: "pending_human_review",
      release_status: "not_released"
    },
    authorizesPublication: false,
    formalEpisodeStateTouched: false,
    videoGenerated: !stillsOnly,
    source,
    runtime,
    render: { ...proofPlan, codec: "h264", audio: false, stillsOnly },
    machineCheckLimits: [
      "Metadata, full video decode, and representative PNG pixel checks only.",
      "No semantic, motion quality, full-frame black/freeze analysis, or human approval is inferred."
    ],
    compositions
  };
}

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function buildGalleryHtml(manifest) {
  const title = manifest.mode === "editorial" ? "二维动作插画 · 20 秒 · 无旁白" : "动画插图系统 · 本地候选";
  const sections = manifest.compositions.map((composition) => `<section><h2>${html(composition.id)}</h2>
${composition.video ? `<video controls preload="metadata" src="${html(composition.video.path)}"></video>
<p class="hash">MP4 SHA-256: ${html(composition.video.sha256)}</p>` : "<p>仅有代表帧；尚未生成视频。</p>"}
<div class="stills">${composition.stills.map((still) => `<figure><a href="${html(still.path)}"><img loading="lazy" src="${html(still.path)}" alt="${html(composition.id)} 第 ${still.frame} 帧"></a><figcaption>帧 ${still.frame} · ${(still.frame / 30).toFixed(2)} 秒</figcaption></figure>`).join("\n")}</div></section>`).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(title)}</title><style>
body{max-width:1240px;margin:48px auto;padding:0 24px;background:#f3f6f2;color:#15251e;font:16px/1.6 system-ui,sans-serif}h1{font-size:32px}section{margin:48px 0}video{display:block;width:100%;background:#17251f}code,.hash{overflow-wrap:anywhere;font-size:13px}.stills{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}figure{margin:0}img{display:block;width:100%;height:auto}figcaption{font-size:13px}a{color:#196448}.notice{border-left:4px solid #7257a8;padding:12px 20px;background:#fff}
</style></head><body><h1>${html(title)}</h1>
<p class="notice">机器检查不等于人工验收。请以正常 1× 速度完整观看每段视频，检查动作含义、连续性与文字可读性。本候选未获人工认可，未发布。</p>
<p>生成时间：${html(manifest.generatedAt)} · ${html(manifest.status.machine_status)}</p>
<p>Git HEAD：<code>${html(manifest.source.gitHead)}</code><br>视觉源码 SHA-256：<code>${html(manifest.source.visualSourceHash)}</code></p>
<p><a href="manifest.json">完整来源、文件哈希与检查结果</a></p>${sections}</body></html>\n`;
}

async function localBrowser() {
  const configured = process.env.REMOTION_BROWSER_EXECUTABLE;
  const candidates = configured ? [configured] : process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ] : process.platform === "win32" ? [
    process.env.PROGRAMFILES && resolve(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe")
  ].filter(Boolean) : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const path of candidates) {
    try { await access(path, constants.X_OK); return realpath(path); }
    catch (error) { if (configured) throw error; }
  }
  throw new Error("A local browser is required; set REMOTION_BROWSER_EXECUTABLE. No browser download is authorized.");
}

async function runMediaTool(executable, args) {
  return execute(executable, args, {
    cwd: dirname(executable), timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C",
      ...(process.platform === "darwin" ? { DYLD_LIBRARY_PATH: dirname(executable) } : {}) }
  });
}

async function recordFile(directory, path) {
  return { path: relative(directory, path).split(sep).join("/"), ...await inspectFileIntegrity(path) };
}

export async function withProofBrowser(renderer, browserExecutable, operation) {
  const browser = await renderer.openBrowser("chrome", { browserExecutable, logLevel: "warn" });
  try {
    return await operation(browser);
  } finally {
    await browser.close({ silent: true });
  }
}

export async function runIllustrationProof(options = {}) {
  const stillsOnly = options.stillsOnly === true;
  const proofPlan = illustrationProofPlan(options);
  const expectedNode = (await readFile(resolve(workspaceRoot, ".node-version"), "utf8")).trim().replace(/^v/u, "");
  if (process.versions.node !== expectedNode) throw new Error(`Expected Node ${expectedNode}, got ${process.versions.node}`);
  const outputRoot = resolveProofOutputRoot(workspaceRoot, options.outputRoot ?? proofPlan.defaultOutputRoot);
  const source = await captureSources();
  const [{ bundle }, renderer, { createIllustrationProofCandidate }, planModule] = await Promise.all([
    import("@remotion/bundler"), import("@remotion/renderer"),
    import("../src/shared/illustration-system-contract.mjs"),
    options.editorial ? import("../src/video/illustration-system/editorial-plan.mjs") :
      import("../src/video/illustration-system/catalog.mjs")
  ]);
  const editorialPlan = planModule.EDITORIAL_PLAN;
  if (options.editorial && (editorialPlan?.compositionId !== "EditorialSelectLoad" ||
    editorialPlan?.durationInFrames !== 600 || editorialPlan?.fps !== 30)) {
    throw new Error("Expected the independent 600-frame EditorialSelectLoad plan");
  }
  const examples = options.editorial ? [{ compositionId: editorialPlan.compositionId,
    definition: editorialPlan.definition }] : planModule.ILLUSTRATION_EXAMPLES;
  for (const id of proofPlan.compositionIds) {
    const example = examples.find((item) => item.compositionId === id);
    if (!example) throw new Error(`Missing illustration definition: ${id}`);
    assertProofDefinition(example.definition, proofPlan);
  }
  const browserExecutable = await localBrowser();
  const tools = {};
  if (!stillsOnly) {
    for (const type of ["ffmpeg", "ffprobe"]) {
      tools[type] = await realpath(renderer.RenderInternals.getExecutablePath({
        type, indent: false, logLevel: "error", binariesDirectory: null
      }));
    }
  }
  const browserVersion = await execute(browserExecutable, ["--version"]);
  const runtime = { node: process.version, platform: process.platform, arch: process.arch,
    browser: { version: browserVersion.stdout.trim(), ...await inspectFileIntegrity(browserExecutable) },
    mediaTools: {} };
  for (const [type, executable] of Object.entries(tools)) {
    const version = await runMediaTool(executable, ["-version"]);
    runtime.mediaTools[type] = { version: version.stdout.split("\n")[0], ...await inspectFileIntegrity(executable) };
  }
  const directory = await createCandidateDirectory(workspaceRoot, outputRoot);
  const scratch = await mkdtemp(resolve(directory, ".render-work-"));
  process.stdout.write(`Proof candidate (${proofPlan.mode}): ${directory}\n`);
  try {
    const publicDir = resolve(scratch, "public");
    await mkdir(publicDir);
    for (const file of source.files.filter(({ path }) => path.startsWith(`${rasterRelativePath}/`))) {
      const destination = resolve(publicDir, relative("studio/public", file.path));
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(workspaceRoot, file.path), destination, constants.COPYFILE_EXCL);
    }
    const serveUrl = await bundle({ entryPoint: resolve(workspaceRoot, entryRelativePath),
      publicDir, outDir: resolve(scratch, "bundle"), enableCaching: false });
    const compositions = await withProofBrowser(renderer, browserExecutable, async (puppeteerInstance) => {
      const rendered = [];
      for (const id of proofPlan.compositionIds) {
        process.stdout.write(`Rendering ${id}${stillsOnly ? " stills" : " video + stills"}\n`);
        const composition = await renderer.selectComposition({ serveUrl, id, puppeteerInstance,
          ...proofFrameRenderOptions(proofPlan) });
        assertComposition(composition, id, proofPlan);
        const result = { id, video: null, stills: [] };
        if (!stillsOnly) {
          const temporary = resolve(scratch, `${id}.mp4`);
          const output = resolve(directory, `${id}.mp4`);
          let reportedPercent = 0;
          await renderer.renderMedia({ serveUrl, composition, outputLocation: temporary,
            ...proofFrameRenderOptions(proofPlan),
            codec: "h264", pixelFormat: "yuv420p", crf: 18, concurrency: 1,
            muted: true, overwrite: false, disallowParallelEncoding: true,
            puppeteerInstance, logLevel: "warn",
            onProgress: ({ progress }) => {
              const percent = Math.min(100, Math.floor(progress * 100));
              while (reportedPercent + 25 <= percent) {
                reportedPercent += 25;
                process.stdout.write(`${id}: ${reportedPercent}%\n`);
              }
            } });
          const { stdout } = await runMediaTool(tools.ffprobe, ["-v", "error", "-count_frames",
            "-show_streams", "-show_format", "-of", "json", temporary]);
          const probe = JSON.parse(stdout);
          const validation = validateVideoProbe(probe, proofPlan);
          await runMediaTool(tools.ffmpeg, buildProofVideoDecodeArgs(temporary));
          await publishFileExclusive(temporary, output);
          result.video = { ...await recordFile(directory, output), validation, fullDecode: "passed", probe };
        }
        for (const frame of proofPlan.stillFrames) {
          const name = `${id}-frame-${String(frame).padStart(3, "0")}.png`;
          const temporary = resolve(scratch, name);
          const output = resolve(directory, name);
          await renderer.renderStill({ serveUrl, composition, output: temporary, frame,
            ...proofFrameRenderOptions(proofPlan),
            imageFormat: "png", puppeteerInstance, overwrite: false, logLevel: "warn" });
          const pixels = auditPngFrame(await readFile(temporary), { expectedWidth: 1920, expectedHeight: 1080 });
          await publishFileExclusive(temporary, output);
          result.stills.push({ frame, ...await recordFile(directory, output), pixels });
          process.stdout.write(`${id}: still ${result.stills.length}/${proofPlan.stillFrames.length} complete (frame ${frame})\n`);
        }
        if (new Set(result.stills.map(({ pixels }) => pixels.pixelSha256)).size < 2) {
          throw new Error(`Representative frames do not change: ${id}`);
        }
        const example = examples.find((item) => item.compositionId === id);
        if (!example) throw new Error(`Missing illustration definition: ${id}`);
        const previewEvidence = proofPreviewEvidence(result, proofPlan, stillsOnly);
        const candidate = await createIllustrationProofCandidate({ definition: example.definition,
          sourceEvidence: source.files,
          styleEvidence: source.files.filter(({ path }) =>
            /tokens\.mjs|watermark|font-system|load-video-fonts|@fontsource/u.test(path) ||
            /illustration-system\/(catalog\.mjs|components\.jsx|editorial-[^/]+\.(mjs|jsx))$/u.test(path)),
          previewEvidence });
        const candidatePath = resolve(directory, `${id}-candidate.json`);
        await writeExclusive(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
        result.candidate = await recordFile(directory, candidatePath);
        rendered.push(result);
      }
      return rendered;
    });
    assertSourceBindingUnchanged(source, await captureSources());
    const manifest = buildProofManifest({ source, compositions, stillsOnly, proofPlan,
      generatedAt: new Date().toISOString(), runtime });
    if (options.editorial) manifest.editorialPlan = editorialPlan;
    manifest.invocation = { cwd: "studio", executable: "node",
      args: ["scripts/render-illustration-system-proof.mjs", "--output-root",
        relative(workspaceRoot, outputRoot).split(sep).join("/"),
        ...(options.editorial ? ["--editorial"] : []),
        ...(stillsOnly ? ["--stills-only"] : [])] };
    await writeExclusive(resolve(directory, "index.html"), buildGalleryHtml(manifest));
    manifest.gallery = await recordFile(directory, resolve(directory, "index.html"));
    await writeExclusive(resolve(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(scratch, { recursive: true, force: true });
    process.stdout.write(`Candidate ready for human review: ${resolve(directory, "index.html")}\n`);
    return { directory, manifest };
  } catch (error) {
    await writeExclusive(resolve(directory, "failure.json"), `${JSON.stringify({
      status: "failed_candidate", source, proofPlan, generatedAt: new Date().toISOString(),
      error: String(error.message), authorizesPublication: false
    }, null, 2)}\n`);
    throw error;
  }
}

async function main() {
  const options = parseProofArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write("Usage: node scripts/render-illustration-system-proof.mjs [--editorial] [--output-root outputs/... ] [--stills-only]\nEach run creates a new candidate directory. Default: three 12-second 1080p30 videos and 18 PNG stills. --editorial: one silent 20-second EditorialSelectLoad video and 9 PNG stills under outputs/studio/editorial-illustration.\n");
    return;
  }
  await runIllustrationProof(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
