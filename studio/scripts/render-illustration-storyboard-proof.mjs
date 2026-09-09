import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { STORYBOARDS } from "../src/video/illustration-storyboards/plan.mjs";
import { inspectFileIntegrity, integrityHash, isSha256 } from "../src/shared/integrity.mjs";
import { captureGlassSources, GLASS_SOURCE_FILES, parseGlassArguments } from "./render-glass-card-proof.mjs";
import { auditPngFrame, decodePngPixels } from "./ci-png-audit.mjs";
import { visualSystemV1AiWatermarkGeometry } from "../src/video/components/visual-system-v1/ai-watermark.mjs";
import { assertSourceBindingUnchanged, createCandidateDirectory, publishFileExclusive,
  resolveProofOutputRoot, withProofBrowser, writeExclusive } from "./render-illustration-system-proof.mjs";

const execute = promisify(execFile);
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sceneDirectory = "studio/src/video/illustration-storyboards";
const rasterDirectory = "studio/public/assets/visual-system-v1/ai-watermark-v013/frames";

export const STORYBOARD_PROOF = Object.freeze({
  schemaVersion: "illustration-storyboard-proof-v1", width: 1920, height: 1080, fps: 30,
  durationInFrames: 3, phases: Object.freeze([0, 1, 2]), imageFormat: "png", concurrency: 1,
  renderTimeoutMs: 120_000, defaultOutputRoot: "outputs/studio/illustration-storyboards"
});

export const captureStoryboardSources = () => captureGlassSources({
  sourceFiles: [...GLASS_SOURCE_FILES, "studio/scripts/render-illustration-storyboard-proof.mjs"],
  sourceDirectories: [sceneDirectory, rasterDirectory]
});

export function assertStoryboardComposition(composition, id) {
  if (!STORYBOARDS.some((board) => board.compositionId === id)) throw new Error("Unknown storyboard composition");
  for (const [key, expected] of Object.entries({ id, width: 1920, height: 1080, fps: 30, durationInFrames: 3 })) {
    if (composition?.[key] !== expected) throw new Error(`Unexpected storyboard ${key}`);
  }
}

export function auditStoryboardLogo(decoded, region) {
  const geometry = visualSystemV1AiWatermarkGeometry(1920, 1080);
  const roi = region ?? { x: 1920 - geometry.right - geometry.width, y: geometry.top,
    width: geometry.width, height: geometry.height };
  if (!decoded?.pixels || decoded.pixels.length !== decoded.width * decoded.height * 4 ||
    ![roi.x, roi.y, roi.width, roi.height].every(Number.isInteger) || roi.x < 0 || roi.y < 0 ||
    roi.width < 1 || roi.height < 1 || roi.x + roi.width > decoded.width || roi.y + roi.height > decoded.height) {
    throw new Error("Invalid decoded watermark region");
  }
  let mintPixels = 0;
  for (let y = roi.y; y < roi.y + roi.height; y += 1) {
    for (let x = roi.x; x < roi.x + roi.width; x += 1) {
      const offset = (y * decoded.width + x) * 4;
      const [r, g, b, a] = decoded.pixels.subarray(offset, offset + 4);
      if (a > 240 && g - r > 18 && g - b > 8) mintPixels += 1;
    }
  }
  const minimumMintPixels = Math.ceil(roi.width * roi.height * 0.035);
  if (mintPixels < minimumMintPixels) throw new Error(`Missing visible storyboard logo: ${mintPixels} < ${minimumMintPixels}`);
  return { region: roi, mintPixels, minimumMintPixels, presencePassed: true,
    limit: "Reserved-area mint pixel presence only; not an identity or animation approval." };
}

export function buildStoryboardManifest({ source, stills, runtime, generatedAt, gallery }) {
  if (!source?.files?.length || !/^[a-f0-9]{40,64}$/u.test(source.gitHead) ||
    integrityHash(source.files) !== source.visualSourceHash) throw new Error("Invalid source binding");
  if (!Array.isArray(stills) || stills.length !== 9) throw new Error("Exactly nine storyboard stills are required");
  const expected = STORYBOARDS.flatMap((board) => STORYBOARD_PROOF.phases.map((phase) => ({ board, phase })));
  stills.forEach((still, index) => {
    const { board, phase } = expected[index];
    if (still.id !== board.id || still.frame !== phase || still.path !== `${board.id}-${phase}.png` ||
      !Number.isSafeInteger(still.bytes) || still.bytes <= 0 || !isSha256(still.sha256) ||
      still.pixels?.width !== 1920 || still.pixels?.height !== 1080 || !isSha256(still.pixels?.pixelSha256) ||
      still.watermark?.presencePassed !== true || !Number.isFinite(still.watermark?.mintPixels) ||
      still.watermark.mintPixels < still.watermark.minimumMintPixels) {
      throw new Error("Invalid storyboard PNG or phase binding");
    }
  });
  if (new Set(stills.map((still) => still.sha256)).size !== 9) throw new Error("Storyboard phases must produce distinct PNGs");
  const payload = {
    schemaVersion: STORYBOARD_PROOF.schemaVersion, generatedAt,
    status: "static-storyboard-candidate", source, runtime, render: STORYBOARD_PROOF,
    storyboardPlan: STORYBOARDS, stills, ...(gallery ? { gallery } : {}),
    userAccepted: false, productionApproved: false, finalAccepted: false,
    videoGenerated: false, formalEpisodeStateTouched: false, authorizesPublication: false,
    bindings: { sourceSha256: source.visualSourceHash, planSha256: integrityHash(STORYBOARDS),
      previewSha256: integrityHash(stills), runtimeSha256: integrityHash(runtime) },
    limits: ["Nine static key poses, not an animation or timing approval.",
      "Machine checks cover file bindings and pixel decoding, not visual acceptance.",
      "Query and routing examples use authored synthetic data."]
  };
  return { ...payload, candidateHash: integrityHash(payload) };
}

function html(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function buildStoryboardGallery(manifest) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI 直通车 · 三组插画分镜</title><style>
*{box-sizing:border-box}body{margin:0;background:#F2F6F3;color:#14211D;font:17px/1.65 system-ui,sans-serif}main{max-width:1480px;margin:0 auto;padding:48px 32px 64px}h1{font-size:38px;font-weight:550;margin:0 0 12px}h2{font-size:26px;font-weight:550;margin:0 0 14px}.intro{color:#53685E;max-width:920px}nav{display:flex;gap:24px;flex-wrap:wrap;margin:26px 0 44px}a{color:#17795D}article{margin:0 0 62px;scroll-margin-top:24px}.phases{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}button{font:inherit;border:1px solid #5A8A77;background:transparent;color:#365B49;padding:9px 18px;border-radius:10px;cursor:pointer}button[aria-pressed=true]{background:#DDF1E8;border-color:#17795D;color:#14211D}button:focus-visible,a:focus-visible{outline:3px solid #17795D;outline-offset:4px}figure{margin:0}figure[hidden]{display:none}img{display:block;width:100%;height:auto;border:1px solid #CADDD1;border-radius:12px}figcaption{display:flex;gap:20px;justify-content:space-between;padding:12px 2px;color:#53685E}details{border-top:1px solid #CADDD1;padding-top:18px}code{overflow-wrap:anywhere;font-size:13px}@media(max-width:640px){main{padding:28px 14px}h1{font-size:28px}h2{font-size:23px}figcaption{display:block}.phases{gap:7px}button{padding:7px 11px;font-size:15px}}
</style></head><body><main><h1>同一套画风，三种解释方式</h1>
<p class="intro">Zhengjiazhi，这里是三组插画的「开始 → 变化 → 结果」。点击阶段切换完整画面，点击图片查看原尺寸。只评审静态画法与表达；本轮没有生成视频，也没有替换正式视频。</p>
<nav>${STORYBOARDS.map((board, index) => `<a href="#${board.id}">${index + 1}. ${html(board.title)}</a>`).join("")}</nav>
${STORYBOARDS.map((board, index) => `<article id="${board.id}"><h2>${String(index + 1).padStart(2, "0")} / ${html(board.title)}</h2>
<div class="phases" role="group" aria-label="${html(board.title)}的阶段">${board.phases.map((phase, phaseIndex) => `<button type="button" aria-pressed="${phaseIndex === 0}" data-phase="${phaseIndex}" aria-controls="${board.id}-phase-${phaseIndex}">${html(phase.label)}</button>`).join("")}</div>
${board.phases.map((phase, phaseIndex) => `<figure id="${board.id}-phase-${phaseIndex}" data-phase="${phaseIndex}" ${phaseIndex ? "hidden" : ""}><a href="${board.id}-${phaseIndex}.png" target="_blank" rel="noopener"><img src="${board.id}-${phaseIndex}.png" alt="${html(board.title)}：${html(phase.label)}"></a><figcaption><span>${html(phase.caption)}</span><span>1920 × 1080 · 静态分镜</span></figcaption></figure>`).join("")}</article>`).join("")}
<details><summary>来源与检查记录（未获视觉批准）</summary><p>Git HEAD：<code>${html(manifest.source.gitHead)}</code><br>视觉源码：<code>${html(manifest.source.visualSourceHash)}</code></p><a href="manifest.json">九张图片与源码绑定清单</a></details>
</main><script>document.querySelectorAll('article').forEach(article=>{article.querySelectorAll('button[data-phase]').forEach(button=>{button.addEventListener('click',()=>{article.querySelectorAll('button[data-phase]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));article.querySelectorAll('figure[data-phase]').forEach(f=>{f.hidden=f.dataset.phase!==button.dataset.phase;});});});});</script></body></html>\n`;
}

export async function runStoryboardProof(options = {}) {
  const expectedNode = (await readFile(resolve(workspaceRoot, ".node-version"), "utf8")).trim().replace(/^v/u, "");
  if (process.versions.node !== expectedNode) throw new Error(`Expected Node ${expectedNode}`);
  const outputRoot = resolveProofOutputRoot(workspaceRoot, options.outputRoot ?? STORYBOARD_PROOF.defaultOutputRoot);
  const browserExecutable = await realpath(process.env.REMOTION_BROWSER_EXECUTABLE ??
    (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/chromium"));
  await access(browserExecutable, constants.X_OK);
  const source = await captureStoryboardSources();
  const [{ bundle }, renderer] = await Promise.all([import("@remotion/bundler"), import("@remotion/renderer")]);
  const runtime = { node: process.version, platform: process.platform, arch: process.arch,
    browser: { version: (await execute(browserExecutable, ["--version"])).stdout.trim(),
      ...await inspectFileIntegrity(browserExecutable) }, browserLogs: [] };
  const directory = await createCandidateDirectory(workspaceRoot, outputRoot);
  const scratch = await mkdtemp(resolve(directory, ".render-work-"));
  process.stdout.write(`Static storyboard candidate: ${directory}\n`);
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
    const stills = await withProofBrowser(renderer, browserExecutable, async (puppeteerInstance) => {
      const evidence = [];
      for (const board of STORYBOARDS) {
        const composition = await renderer.selectComposition({ serveUrl, id: board.compositionId, puppeteerInstance,
          timeoutInMilliseconds: STORYBOARD_PROOF.renderTimeoutMs, logLevel: "warn" });
        assertStoryboardComposition(composition, board.compositionId);
        for (const frame of STORYBOARD_PROOF.phases) {
          const name = `${board.id}-${frame}.png`, output = resolve(scratch, name);
          await renderer.renderStill({ serveUrl, composition, output, frame, imageFormat: "png", puppeteerInstance,
            timeoutInMilliseconds: STORYBOARD_PROOF.renderTimeoutMs, overwrite: false, logLevel: "warn",
            onBrowserLog: (event) => runtime.browserLogs.push({ type: event.type, text: event.text }) });
          const png = await readFile(output);
          const pixels = auditPngFrame(png, { expectedWidth: 1920, expectedHeight: 1080 });
          const watermark = auditStoryboardLogo(decodePngPixels(png));
          await publishFileExclusive(output, resolve(directory, name));
          evidence.push({ id: board.id, compositionId: board.compositionId, frame, path: name,
            ...await inspectFileIntegrity(resolve(directory, name)), pixels, watermark });
          process.stdout.write(`${name}: full PNG decode + logo presence passed (${watermark.mintPixels} pixels)\n`);
        }
      }
      return evidence;
    });
    assertSourceBindingUnchanged(source, await captureStoryboardSources());
    const browserAfter = await inspectFileIntegrity(browserExecutable);
    if (browserAfter.sha256 !== runtime.browser.sha256) throw new Error("Browser changed during render");
    const input = { source, stills, runtime, generatedAt: new Date().toISOString() };
    const galleryPath = resolve(directory, "index.html");
    await writeExclusive(galleryPath, buildStoryboardGallery(buildStoryboardManifest(input)));
    const manifest = buildStoryboardManifest({ ...input, gallery: { path: "index.html", ...await inspectFileIntegrity(galleryPath) } });
    await writeExclusive(resolve(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`Nine static storyboards ready: ${galleryPath}\n`);
    return { directory, manifest };
  } catch (error) {
    await writeExclusive(resolve(directory, "failure.json"), `${JSON.stringify({ source, runtime,
      status: "incomplete-static-candidate", userAccepted: false, error: String(error?.stack ?? error) }, null, 2)}\n`);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseGlassArguments(process.argv.slice(2));
    if (options.help) process.stdout.write("Usage: node scripts/render-illustration-storyboard-proof.mjs [--output-root outputs/path]\nNine static PNGs only. No MP4 or production approval.\n");
    else await runStoryboardProof(options);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}
