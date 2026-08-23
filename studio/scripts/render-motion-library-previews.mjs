import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import {
  AMICRO_UPSTREAM,
  MOTION_LIBRARY_ITEMS
} from "../src/video/motion-library/catalog.mjs";
import { resolveBrowserExecutable } from "../src/server/renderer.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(studioRoot, "..");
const entryPoint = resolve(studioRoot, "src/video/motion-library/index.jsx");
const publicDirectory = resolve(studioRoot, "public");
const previewRoot = resolve(workspaceRoot, "docs/assets/motion-library");
const manifestPath = resolve(previewRoot, "manifest.json");

const RENDER_CONTRACT = Object.freeze({
  sourceWidth: 960,
  sourceHeight: 540,
  sourceFps: 30,
  width: 480,
  height: 270,
  fps: 15,
  everyNthFrame: 2,
  scale: 0.5,
  codec: "gif",
  numberOfGifLoops: null,
  maxBytesPerGif: 1_500_000,
  maxTotalBytes: 50_000_000
});

function workspaceRelative(path) {
  return relative(workspaceRoot, path).replaceAll("\\", "/");
}

function ensureInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new Error(`路径越过允许目录：${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

function outputPathForItem(item) {
  const outputPath = ensureInside(workspaceRoot, resolve(workspaceRoot, item.previewPath));
  return ensureInside(previewRoot, outputPath);
}

function parseArguments(argumentsList) {
  const ids = new Set();
  const categories = new Set();
  let all = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--all") {
      all = true;
      continue;
    }
    if (argument === "--id" || argument === "--category") {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) {
        throw new TypeError(`${argument} 需要一个值`);
      }
      (argument === "--id" ? ids : categories).add(value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--id=")) {
      ids.add(argument.slice("--id=".length));
      continue;
    }
    if (argument.startsWith("--category=")) {
      categories.add(argument.slice("--category=".length));
      continue;
    }
    throw new TypeError(`未知参数：${argument}`);
  }

  if (all && (ids.size > 0 || categories.size > 0)) {
    throw new TypeError("--all 不能与 --id 或 --category 同时使用");
  }
  if (!all && ids.size === 0 && categories.size === 0) all = true;

  const knownIds = new Set(MOTION_LIBRARY_ITEMS.map((item) => item.id));
  const knownCategories = new Set(MOTION_LIBRARY_ITEMS.map((item) => item.category));
  for (const id of ids) {
    if (!knownIds.has(id)) throw new TypeError(`未知动效 ID：${id}`);
  }
  for (const category of categories) {
    if (!knownCategories.has(category)) {
      throw new TypeError(`未知动效分类：${category}`);
    }
  }

  const selectedItems = all
    ? [...MOTION_LIBRARY_ITEMS]
    : MOTION_LIBRARY_ITEMS.filter(
        (item) => ids.has(item.id) || categories.has(item.category)
      );
  if (selectedItems.length === 0) throw new Error("没有选中任何动效");

  return { all, ids: [...ids], categories: [...categories], selectedItems };
}

function decodeGifHeader(data, label) {
  if (data.length < 10) throw new Error(`${label} 不是完整 GIF`);
  const signature = data.subarray(0, 6).toString("ascii");
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error(`${label} 的 GIF Header 无效：${JSON.stringify(signature)}`);
  }
  return {
    signature,
    width: data.readUInt16LE(6),
    height: data.readUInt16LE(8)
  };
}

async function inspectGif(path, item) {
  const data = await readFile(path);
  const header = decodeGifHeader(data, item.id);
  if (header.width !== RENDER_CONTRACT.width || header.height !== RENDER_CONTRACT.height) {
    throw new Error(
      `${item.id} 输出尺寸错误：${header.width}x${header.height}，预期 ${RENDER_CONTRACT.width}x${RENDER_CONTRACT.height}`
    );
  }
  if (data.length > RENDER_CONTRACT.maxBytesPerGif) {
    throw new Error(
      `${item.id} GIF 体积 ${data.length} 超过 ${RENDER_CONTRACT.maxBytesPerGif}`
    );
  }
  return {
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    ...header
  };
}

async function replaceFileSafely(temporaryPath, outputPath) {
  const backupPath = `${outputPath}.previous-${randomUUID()}`;
  let movedExisting = false;
  try {
    await access(outputPath);
    await rename(outputPath, backupPath);
    movedExisting = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    await rename(temporaryPath, outputPath);
    if (movedExisting) await rm(backupPath, { force: true });
  } catch (error) {
    if (movedExisting) {
      await rename(backupPath, outputPath).catch(() => undefined);
    }
    throw error;
  }
}

async function renderItem({ item, serveUrl, browser }) {
  const outputPath = outputPathForItem(item);
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = resolve(
    dirname(outputPath),
    `.${item.id}.rendering-${process.pid}-${randomUUID()}.gif`
  );
  ensureInside(previewRoot, temporaryPath);

  try {
    const composition = await selectComposition({
      serveUrl,
      id: `Motion-${item.id}`,
      ...browser,
      logLevel: "warn"
    });
    const actualContract = {
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      durationInFrames: composition.durationInFrames
    };
    const expectedContract = {
      width: item.previewWidth,
      height: item.previewHeight,
      fps: item.fps,
      durationInFrames: item.previewDurationInFrames
    };
    if (JSON.stringify(actualContract) !== JSON.stringify(expectedContract)) {
      throw new Error(
        `${item.id} Composition 合同不匹配：${JSON.stringify({ actualContract, expectedContract })}`
      );
    }
    if (
      composition.width !== RENDER_CONTRACT.sourceWidth ||
      composition.height !== RENDER_CONTRACT.sourceHeight ||
      composition.fps !== RENDER_CONTRACT.sourceFps ||
      composition.fps / RENDER_CONTRACT.everyNthFrame !== RENDER_CONTRACT.fps
    ) {
      throw new Error(`${item.id} 无法按统一 480x270/15fps 合同渲染`);
    }

    await renderMedia({
      composition,
      serveUrl,
      codec: RENDER_CONTRACT.codec,
      outputLocation: temporaryPath,
      imageFormat: "png",
      everyNthFrame: RENDER_CONTRACT.everyNthFrame,
      numberOfGifLoops: RENDER_CONTRACT.numberOfGifLoops,
      scale: RENDER_CONTRACT.scale,
      muted: true,
      concurrency: "25%",
      overwrite: false,
      ...browser,
      logLevel: "warn"
    });

    const integrity = await inspectGif(temporaryPath, item);
    await replaceFileSafely(temporaryPath, outputPath);
    process.stdout.write(
      `${JSON.stringify({ event: "motion-preview-rendered", id: item.id, path: workspaceRelative(outputPath), ...integrity })}\n`
    );
    return { item, outputPath, ...integrity };
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function collectAvailablePreviews() {
  const entries = [];
  for (const item of MOTION_LIBRARY_ITEMS) {
    const outputPath = outputPathForItem(item);
    try {
      const integrity = await inspectGif(outputPath, item);
      entries.push({
        id: item.id,
        title: item.title,
        titleZh: item.titleZh,
        category: item.category,
        compositionId: `Motion-${item.id}`,
        previewPath: item.previewPath,
        previewLoop: item.previewLoop,
        durationInFrames: item.previewDurationInFrames,
        sourceFps: item.fps,
        outputFps: RENDER_CONTRACT.fps,
        width: integrity.width,
        height: integrity.height,
        bytes: integrity.bytes,
        sha256: integrity.sha256
      });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return entries;
}

async function writeManifest(selection) {
  const items = await collectAvailablePreviews();
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  if (totalBytes > RENDER_CONTRACT.maxTotalBytes) {
    throw new Error(
      `动效 GIF 总体积 ${totalBytes} 超过 ${RENDER_CONTRACT.maxTotalBytes}`
    );
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generator: "studio/scripts/render-motion-library-previews.mjs",
    upstream: AMICRO_UPSTREAM,
    selection: {
      all: selection.all,
      ids: selection.ids,
      categories: selection.categories
    },
    contract: RENDER_CONTRACT,
    catalogItemCount: MOTION_LIBRARY_ITEMS.length,
    renderedItemCount: items.length,
    totalBytes,
    items
  };

  await mkdir(previewRoot, { recursive: true });
  const temporaryManifestPath = resolve(
    previewRoot,
    `.manifest.rendering-${process.pid}-${randomUUID()}.json`
  );
  try {
    await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await replaceFileSafely(temporaryManifestPath, manifestPath);
  } finally {
    await rm(temporaryManifestPath, { force: true }).catch(() => undefined);
  }
  return manifest;
}

async function main() {
  const selection = parseArguments(process.argv.slice(2));
  await access(entryPoint).catch(() => {
    throw new Error(`找不到动效库 Remotion 入口：${workspaceRelative(entryPoint)}`);
  });

  const browserExecutable = await resolveBrowserExecutable(null);
  const browser = browserExecutable ? { browserExecutable } : {};
  const serveUrl = await bundle({
    entryPoint,
    publicDir: publicDirectory,
    onProgress: () => undefined
  });

  for (const item of selection.selectedItems) {
    await renderItem({ item, serveUrl, browser });
  }

  const manifest = await writeManifest(selection);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      selectedItemCount: selection.selectedItems.length,
      renderedItemCount: manifest.renderedItemCount,
      totalBytes: manifest.totalBytes,
      manifestPath: workspaceRelative(manifestPath)
    }, null, 2)}\n`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
