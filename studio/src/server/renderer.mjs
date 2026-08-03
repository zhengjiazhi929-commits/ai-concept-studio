import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import {
  publicRoot,
  studioOutputRoot,
  studioRoot,
  videoRoot,
  workspaceRoot,
  episodeOutputDirectory
} from "../shared/paths.mjs";
import { readConfig } from "../shared/store.mjs";
import { backupRenderedFile } from "../shared/cloud-backup.mjs";

let cachedBundle = null;

async function getBundle() {
  if (cachedBundle) return cachedBundle;
  cachedBundle = await bundle({
    entryPoint: resolve(videoRoot, "index.jsx"),
    publicDir: publicRoot,
    onProgress: () => undefined
  });
  return cachedBundle;
}

export async function renderPreview(episode, context = {}) {
  const config = await readConfig();
  const outputDirectory = episodeOutputDirectory(episode.id);
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, "preview-v001.mp4");
  const serveUrl = await getBundle();
  const inputProps = { episode };

  const composition = await selectComposition({
    serveUrl,
    id: episode.render.compositionId,
    inputProps,
    browserExecutable: config.browserExecutable,
    logLevel: "warn"
  });

  let lastReported = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: config.render.codec,
    outputLocation: outputPath,
    inputProps,
    browserExecutable: config.browserExecutable,
    concurrency: config.render.concurrency,
    crf: config.render.crf,
    imageFormat: "png",
    pixelFormat: "yuv420p",
    enforceAudioTrack: true,
    overwrite: true,
    logLevel: "warn",
    onProgress: ({ progress }) => {
      const rounded = Math.floor(progress * 20) / 20;
      if (rounded > lastReported) {
        lastReported = rounded;
        void context.onProgress?.(rounded, `正在生成预览 ${Math.round(rounded * 100)}%`);
      }
    }
  });

  const cloudBackup = await backupRenderedFile(outputPath).catch((error) => ({
    status: "failed",
    error: error instanceof Error ? error.message : "云端备份失败"
  }));

  return {
    outputPath,
    relativeOutputPath: relative(workspaceRoot, outputPath).replaceAll("\\", "/"),
    outputRoot: relative(workspaceRoot, studioOutputRoot).replaceAll("\\", "/"),
    cloudBackup
  };
}

export function clearBundleCache() {
  cachedBundle = null;
}
