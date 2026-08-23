import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MOTION_LIBRARY_CATEGORIES,
  MOTION_LIBRARY_ITEMS
} from "../src/video/motion-library/catalog.mjs";

const EXPECTED_ITEM_COUNT = 35;
const EXPECTED_WIDTH = 480;
const EXPECTED_HEIGHT = 270;
const MAX_BYTES_PER_GIF = 1_500_000;
const MAX_TOTAL_GIF_BYTES = 50_000_000;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(scriptDirectory, "..");
const workspaceRoot = resolve(studioRoot, "..");
const previewRoot = resolve(workspaceRoot, "docs/assets/motion-library");
const manifestPath = resolve(previewRoot, "manifest.json");
const upstreamRoot = resolve(
  studioRoot,
  "src/video/motion-library/upstream/amicro/selected"
);

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

function gifHeader(data) {
  if (data.length < 10) return null;
  const signature = data.subarray(0, 6).toString("ascii");
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;
  return {
    signature,
    width: data.readUInt16LE(6),
    height: data.readUInt16LE(8)
  };
}

async function allGifFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await allGifFiles(path)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".gif")) files.push(path);
  }
  return files;
}

async function main() {
  const findings = [];
  const addFinding = (code, message, path = null) => {
    findings.push({ code, message, ...(path ? { path: workspaceRelative(path) } : {}) });
  };

  if (MOTION_LIBRARY_ITEMS.length !== EXPECTED_ITEM_COUNT) {
    addFinding(
      "catalog-count",
      `目录包含 ${MOTION_LIBRARY_ITEMS.length} 项，预期 ${EXPECTED_ITEM_COUNT} 项`
    );
  }

  const ids = new Set();
  const categoryIds = new Set(MOTION_LIBRARY_CATEGORIES.map((category) => category.id));
  const expectedGifPaths = new Set();
  const inspectedItems = [];

  for (const item of MOTION_LIBRARY_ITEMS) {
    if (ids.has(item.id)) addFinding("duplicate-id", `重复动效 ID：${item.id}`);
    ids.add(item.id);
    if (!categoryIds.has(item.category)) {
      addFinding("unknown-category", `${item.id} 使用未知分类 ${item.category}`);
    }

    let previewPath = null;
    try {
      previewPath = ensureInside(workspaceRoot, resolve(workspaceRoot, item.previewPath));
      ensureInside(previewRoot, previewPath);
      expectedGifPaths.add(previewPath);
    } catch (error) {
      addFinding("preview-path", `${item.id}: ${error.message}`);
    }

    if (previewPath) {
      try {
        const data = await readFile(previewPath);
        const header = gifHeader(data);
        if (!header) {
          addFinding("gif-header", `${item.id} 不是有效 GIF87a/GIF89a`, previewPath);
        } else {
          if (header.width !== EXPECTED_WIDTH || header.height !== EXPECTED_HEIGHT) {
            addFinding(
              "gif-dimensions",
              `${item.id} 为 ${header.width}x${header.height}，预期 ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}`,
              previewPath
            );
          }
          if (data.length > MAX_BYTES_PER_GIF) {
            addFinding(
              "gif-size",
              `${item.id} 为 ${data.length} bytes，超过 ${MAX_BYTES_PER_GIF}`,
              previewPath
            );
          }
          inspectedItems.push({
            id: item.id,
            previewPath: item.previewPath,
            width: header.width,
            height: header.height,
            bytes: data.length,
            sha256: createHash("sha256").update(data).digest("hex")
          });
        }
      } catch (error) {
        addFinding(
          "gif-missing",
          `${item.id} 缺少预览 GIF：${error.message}`,
          previewPath
        );
      }
    }

    for (const source of item.upstream) {
      let sourcePath;
      try {
        sourcePath = ensureInside(upstreamRoot, resolve(upstreamRoot, source.path));
      } catch (error) {
        addFinding("upstream-path", `${item.id}: ${error.message}`);
        continue;
      }
      try {
        const sourceStat = await stat(sourcePath);
        if (!sourceStat.isFile()) {
          addFinding("upstream-not-file", `${item.id} 的归档源不是文件`, sourcePath);
        }
      } catch (error) {
        addFinding(
          "upstream-missing",
          `${item.id} 缺少归档源 ${source.path}: ${error.message}`,
          sourcePath
        );
      }
    }
  }

  const gifFiles = await allGifFiles(previewRoot);
  let totalGifBytes = 0;
  for (const path of gifFiles) {
    totalGifBytes += (await stat(path)).size;
    if (!expectedGifPaths.has(path)) {
      addFinding("stale-gif", "存在目录之外的 GIF", path);
    }
  }
  if (totalGifBytes > MAX_TOTAL_GIF_BYTES) {
    addFinding(
      "gif-total-size",
      `全部 GIF 为 ${totalGifBytes} bytes，超过 ${MAX_TOTAL_GIF_BYTES}`,
      previewRoot
    );
  }

  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    addFinding("manifest-missing", `无法读取 manifest：${error.message}`, manifestPath);
  }

  if (manifest) {
    if (manifest.catalogItemCount !== EXPECTED_ITEM_COUNT) {
      addFinding(
        "manifest-catalog-count",
        `manifest catalogItemCount=${manifest.catalogItemCount}，预期 ${EXPECTED_ITEM_COUNT}`,
        manifestPath
      );
    }
    if (!Array.isArray(manifest.items) || manifest.items.length !== EXPECTED_ITEM_COUNT) {
      addFinding(
        "manifest-item-count",
        `manifest 包含 ${Array.isArray(manifest.items) ? manifest.items.length : 0} 项，预期 ${EXPECTED_ITEM_COUNT}`,
        manifestPath
      );
    } else {
      const actualById = new Map(inspectedItems.map((item) => [item.id, item]));
      for (const manifestItem of manifest.items) {
        const actual = actualById.get(manifestItem.id);
        if (!actual) {
          addFinding("manifest-orphan", `manifest 项 ${manifestItem.id} 没有有效 GIF`, manifestPath);
          continue;
        }
        for (const key of ["previewPath", "width", "height", "bytes", "sha256"]) {
          if (manifestItem[key] !== actual[key]) {
            addFinding(
              "manifest-mismatch",
              `${manifestItem.id} 的 ${key} 与实际 GIF 不一致`,
              manifestPath
            );
          }
        }
      }
    }
    if (manifest.totalBytes !== totalGifBytes) {
      addFinding(
        "manifest-total-size",
        `manifest totalBytes=${manifest.totalBytes}，实际 ${totalGifBytes}`,
        manifestPath
      );
    }
  }

  const summary = {
    ok: findings.length === 0,
    expectedItemCount: EXPECTED_ITEM_COUNT,
    catalogItemCount: MOTION_LIBRARY_ITEMS.length,
    validGifCount: inspectedItems.length,
    gifFileCount: gifFiles.length,
    totalGifBytes,
    maxBytesPerGif: MAX_BYTES_PER_GIF,
    maxTotalGifBytes: MAX_TOTAL_GIF_BYTES,
    findings
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
