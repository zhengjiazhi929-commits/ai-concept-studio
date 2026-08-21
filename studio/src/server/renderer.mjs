import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
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
import { inspectFileIntegrity } from "../shared/integrity.mjs";

let cachedBundle = null;

export function nextRenderFileName(files) {
  const highest = files.reduce((current, file) => {
    const match = /^preview-v(\d{3})\.mp4$/u.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return `preview-v${String(highest + 1).padStart(3, "0")}.mp4`;
}

function browserCandidates(platform, environment) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ];
  }
  if (platform === "win32") {
    return [
      environment.PROGRAMFILES && resolve(environment.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
      environment["PROGRAMFILES(X86)"] && resolve(environment["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
      environment.LOCALAPPDATA && resolve(environment.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe")
    ].filter(Boolean);
  }
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge"
  ];
}

export async function resolveBrowserExecutable(configured, options = {}) {
  const canAccess = options.access ?? access;
  if (configured) {
    try {
      await canAccess(configured);
      return configured;
    } catch {
      throw new Error(`配置的浏览器不存在：${configured}`);
    }
  }
  const candidates = browserCandidates(
    options.platform ?? process.platform,
    options.environment ?? process.env
  );
  for (const candidate of candidates) {
    try {
      await canAccess(candidate);
      return candidate;
    } catch {
      // Try the next platform-native browser before allowing Remotion to download one.
    }
  }
  return null;
}

async function browserOptions(browserExecutable) {
  const detected = await resolveBrowserExecutable(browserExecutable);
  return detected ? { browserExecutable: detected } : {};
}

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
  const outputPath = resolve(outputDirectory, nextRenderFileName(await readdir(outputDirectory)));
  const temporaryOutputPath = outputPath.replace(/\.mp4$/u, ".rendering.mp4");
  const serveUrl = await getBundle();
  const inputProps = { episode };
  const browser = await browserOptions(config.browserExecutable);

  const composition = await selectComposition({
    serveUrl,
    id: episode.render.compositionId,
    inputProps,
    ...browser,
    logLevel: "warn"
  });

  let lastReported = -1;
  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: config.render.codec,
      outputLocation: temporaryOutputPath,
      inputProps,
      ...browser,
      concurrency: config.render.concurrency,
      crf: config.render.crf,
      imageFormat: "png",
      pixelFormat: "yuv420p",
      enforceAudioTrack: true,
      overwrite: false,
      logLevel: "warn",
      onProgress: ({ progress }) => {
        const rounded = Math.floor(progress * 20) / 20;
        if (rounded > lastReported) {
          lastReported = rounded;
          void context.onProgress?.(rounded, `正在生成预览 ${Math.round(rounded * 100)}%`);
        }
      }
    });
    await rename(temporaryOutputPath, outputPath);
  } catch (error) {
    await rm(temporaryOutputPath, { force: true }).catch(() => undefined);
    throw error;
  }

  const integrity = await inspectFileIntegrity(outputPath);
  const cloudBackup = await backupRenderedFile(outputPath).catch((error) => ({
    status: "failed",
    error: error instanceof Error ? error.message : "云端备份失败"
  }));

  return {
    outputPath,
    relativeOutputPath: relative(workspaceRoot, outputPath).replaceAll("\\", "/"),
    outputRoot: relative(workspaceRoot, studioOutputRoot).replaceAll("\\", "/"),
    bytes: integrity.bytes,
    sha256: integrity.sha256,
    cloudBackup
  };
}

export function clearBundleCache() {
  cachedBundle = null;
}
