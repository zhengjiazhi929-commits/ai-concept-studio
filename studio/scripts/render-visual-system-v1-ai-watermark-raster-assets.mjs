import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import {
  ensureInside,
  publicRoot,
  studioOutputRoot,
  videoRoot,
  workspaceRoot
} from "../src/shared/paths.mjs";
import { VISUAL_SYSTEM_V1_AI_WATERMARK } from "../src/video/components/visual-system-v1/ai-watermark.mjs";
import { VISUAL_SYSTEM_V1_AI_WATERMARK_RASTER_SOURCE } from "../src/video/visual-system-v1-ai-watermark-raster-source-plan.mjs";

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ENTRY_POINT = resolve(videoRoot, "visual-system-v1-ai-watermark-raster-source-index.jsx");
const ASSET_PARENT = ensureInside(
  publicRoot,
  resolve(publicRoot, "assets", "visual-system-v1")
);
const ASSET_DIRECTORY = ensureInside(ASSET_PARENT, resolve(ASSET_PARENT, "ai-watermark-v012"));
const TEMPORARY_DIRECTORY = ensureInside(
  studioOutputRoot,
  resolve(studioOutputRoot, "design-system", ".ai-watermark-v012-assets.rendering")
);

async function assertAbsent(path, label) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`目标必须不存在，拒绝覆盖：${label}`);
}

function denyBrowserDownload() {
  throw new Error("禁止下载浏览器；只允许使用已安装 Chrome");
}

async function renderStillWithRetry(options) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await renderStill(options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
    }
  }
  throw lastError;
}

export async function renderVisualSystemV1AiWatermarkRasterAssets() {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_RASTER_SOURCE;
  const bundleDirectory = resolve(TEMPORARY_DIRECTORY, "bundle");
  const framesDirectory = resolve(TEMPORARY_DIRECTORY, "frames");
  let temporaryCreated = false;

  await assertAbsent(ASSET_DIRECTORY, "ai-watermark-v012");
  await assertAbsent(TEMPORARY_DIRECTORY, ".ai-watermark-v012-assets.rendering");
  await access(CHROME_EXECUTABLE);

  try {
    await mkdir(ASSET_PARENT, { recursive: true });
    await mkdir(framesDirectory, { recursive: true });
    temporaryCreated = true;

    const serveUrl = await bundle({
      entryPoint: ENTRY_POINT,
      publicDir: publicRoot,
      outDir: bundleDirectory,
      enableCaching: false,
      onProgress: () => undefined
    });
    const composition = await selectComposition({
      serveUrl,
      id: contract.compositionId,
      browserExecutable: CHROME_EXECUTABLE,
      onBrowserDownload: denyBrowserDownload,
      logLevel: "warn"
    });
    const actual = {
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      durationInFrames: composition.durationInFrames
    };
    const expected = {
      width: contract.width,
      height: contract.height,
      fps: contract.fps,
      durationInFrames: contract.durationInFrames
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`水印栅格源合同不匹配：${JSON.stringify({ actual, expected })}`);
    }

    const frames = {};
    for (let frame = 0; frame < contract.durationInFrames; frame += 1) {
      const fileName = `frame-${String(frame).padStart(3, "0")}.png`;
      const output = resolve(framesDirectory, fileName);
      await renderStillWithRetry({
        composition,
        serveUrl,
        output,
        frame,
        imageFormat: "png",
        browserExecutable: CHROME_EXECUTABLE,
        onBrowserDownload: denyBrowserDownload,
        overwrite: false,
        timeoutInMilliseconds: 120_000,
        logLevel: "warn"
      });
      frames[frame] = {
        path: `assets/visual-system-v1/ai-watermark-v012/frames/${fileName}`,
        ...(await inspectFileIntegrity(output))
      };
    }

    await rm(bundleDirectory, { recursive: true, force: true });
    await writeFile(
      resolve(TEMPORARY_DIRECTORY, "manifest.json"),
      `${JSON.stringify({
        schemaVersion: "visual-system-v1-ai-watermark-raster-assets-v1",
        sourceMotionSchemaVersion: VISUAL_SYSTEM_V1_AI_WATERMARK.motionSchemaVersion,
        composition: contract,
        frameCount: contract.durationInFrames,
        transparentBackgroundRequired: true,
        integrationMode: "frame-indexed-transparent-png-sequence",
        frames
      }, null, 2)}\n`,
      { flag: "wx" }
    );
    await rename(TEMPORARY_DIRECTORY, ASSET_DIRECTORY);
    return Object.freeze({
      assetDirectory: relative(workspaceRoot, ASSET_DIRECTORY),
      frameCount: contract.durationInFrames
    });
  } catch (error) {
    if (temporaryCreated) {
      await rm(TEMPORARY_DIRECTORY, { recursive: true, force: true });
    }
    throw error;
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  renderVisualSystemV1AiWatermarkRasterAssets()
    .then((result) => console.log(JSON.stringify({ ok: true, ...result }, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
