import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AMICRO_UPSTREAM,
  MOTION_LIBRARY_ITEMS
} from "../src/video/motion-library/catalog.mjs";

const EXPECTED_REPOSITORY = "https://github.com/Subhan-code/Amicro--Micro-transitions-";
const EXPECTED_COMMIT = "07adc1640084940f045875e2bb1b682c90f30c3c";
const RAW_REPOSITORY = "https://raw.githubusercontent.com/Subhan-code/Amicro--Micro-transitions-";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 6;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_ATTEMPTS = 3;

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(scriptsRoot, "..");
const motionLibraryRoot = resolve(studioRoot, "src", "video", "motion-library");
const archiveParent = resolve(motionLibraryRoot, "upstream");
const archiveRoot = resolve(archiveParent, "amicro");

function compareAscii(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function ensureInside(root, target) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  if (
    normalizedTarget !== normalizedRoot &&
    !normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw new Error(`Path escapes archive root: ${normalizedTarget}`);
  }
  return normalizedTarget;
}

function assertPinnedSource() {
  if (AMICRO_UPSTREAM.repository !== EXPECTED_REPOSITORY) {
    throw new Error(`Unexpected Amicro repository: ${AMICRO_UPSTREAM.repository}`);
  }
  if (AMICRO_UPSTREAM.commit !== EXPECTED_COMMIT) {
    throw new Error(`Unexpected Amicro commit: ${AMICRO_UPSTREAM.commit}`);
  }
  if (!/^[a-f0-9]{40}$/u.test(AMICRO_UPSTREAM.commit)) {
    throw new Error(`Amicro commit is not a full SHA: ${AMICRO_UPSTREAM.commit}`);
  }
  if (AMICRO_UPSTREAM.license !== "MIT") {
    throw new Error(`Unexpected Amicro license: ${AMICRO_UPSTREAM.license}`);
  }
}

function assertSafeSourcePath(sourcePath) {
  if (
    typeof sourcePath !== "string" ||
    sourcePath.length === 0 ||
    sourcePath.length > 512 ||
    sourcePath.startsWith("/") ||
    sourcePath.includes("\\") ||
    posix.normalize(sourcePath) !== sourcePath ||
    sourcePath.split("/").some((part) => part === "" || part === "." || part === "..") ||
    !/^[A-Za-z0-9._/-]+$/u.test(sourcePath)
  ) {
    throw new Error(`Unsafe upstream source path: ${String(sourcePath)}`);
  }
}

function assertCatalogIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function buildSelections() {
  const seenCatalogIds = new Set();
  const selections = [];

  for (const item of MOTION_LIBRARY_ITEMS) {
    assertCatalogIdentifier(item.id, "catalog id");
    if (seenCatalogIds.has(item.id)) {
      throw new Error(`Duplicate motion catalog id: ${item.id}`);
    }
    seenCatalogIds.add(item.id);
    if (!Array.isArray(item.upstream) || item.upstream.length === 0) {
      throw new Error(`Catalog item has no upstream references: ${item.id}`);
    }

    const seenReferences = new Set();
    for (const reference of item.upstream) {
      assertSafeSourcePath(reference.path);
      assertCatalogIdentifier(reference.symbol, `symbol for ${item.id}`);
      const referenceKey = `${reference.path}\0${reference.symbol}`;
      if (seenReferences.has(referenceKey)) {
        throw new Error(`Duplicate upstream reference for ${item.id}: ${reference.path}`);
      }
      seenReferences.add(referenceKey);
      selections.push({
        catalogId: item.id,
        category: item.category,
        title: item.title,
        titleZh: item.titleZh,
        sourcePath: reference.path,
        symbol: reference.symbol,
        selectedReason: item.summary,
        useWhen: [...item.useWhen]
      });
    }
  }

  return selections;
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

async function fetchPinnedFileAttempt(sourcePath) {
  assertSafeSourcePath(sourcePath);
  const url = `${RAW_REPOSITORY}/${AMICRO_UPSTREAM.commit}/${sourcePath}`;
  const response = await fetch(url, {
    headers: {
      accept: "text/plain, application/octet-stream;q=0.9",
      "user-agent": "AI-Concept-Studio-Amicro-Archive/1.0"
    },
    redirect: "error",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  });
  if (response.status === 429 || response.status >= 500) {
    const error = new Error(`Temporary download failure for ${sourcePath}: HTTP ${response.status}`);
    error.retryable = true;
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Failed to download ${sourcePath}: HTTP ${response.status}`);
  }
  if (response.url !== url) {
    throw new Error(`Unexpected download URL for ${sourcePath}: ${response.url}`);
  }

  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_FILE_BYTES) {
    throw new Error(`Upstream file is too large: ${sourcePath} (${declaredBytes} bytes)`);
  }

  const content = Buffer.from(await response.arrayBuffer());
  if (content.length === 0 || content.length > MAX_FILE_BYTES) {
    throw new Error(`Invalid upstream file size: ${sourcePath} (${content.length} bytes)`);
  }
  if (content.includes(0)) {
    throw new Error(`Expected text but received binary content: ${sourcePath}`);
  }
  return { sourcePath, url, content, bytes: content.length, sha256: sha256(content) };
}

async function fetchPinnedFile(sourcePath) {
  let lastError = null;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await fetchPinnedFileAttempt(sourcePath);
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable === true || error?.name === "TimeoutError" || error instanceof TypeError;
      if (!retryable || attempt === DOWNLOAD_ATTEMPTS) break;
      await wait(250 * attempt);
    }
  }
  throw new Error(
    `Unable to download pinned upstream file after ${DOWNLOAD_ATTEMPTS} attempts: ${sourcePath}`,
    { cause: lastError }
  );
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}

async function writeExclusive(filePath, content) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, { flag: "wx" });
}

function markdownCode(value) {
  return `\`${String(value).replaceAll("`", "\\`")}\``;
}

function buildNotice() {
  return `# Amicro selected upstream snapshot

This directory contains a curated, byte-for-byte source snapshot used to trace the motion components selected for AI Concept Studio.

- Upstream repository: ${AMICRO_UPSTREAM.repository}
- Pinned commit: ${AMICRO_UPSTREAM.commit}
- Upstream license: ${AMICRO_UPSTREAM.license}
- Copyright notice: ${AMICRO_UPSTREAM.copyright}

This is **not** a complete copy of the Amicro repository. Only the source paths referenced by \`motion-library/catalog.mjs\` are archived under \`selected/\`. Shared source files are stored once even when more than one catalog item selects a symbol from the same file.

Files under \`selected/\` are retained unchanged for provenance and license review. AI Concept Studio's frame-driven Remotion adaptations live outside this upstream snapshot and must not import these archived files as production runtime code.

See \`selection-manifest.json\` for catalog IDs, symbols, source URLs, byte counts, and SHA-256 checksums. See \`LICENSE\` for the upstream MIT license and \`THIRD_PARTY.md\` for the human-readable selection list.

Generated by \`studio/scripts/archive-motion-library-upstream.mjs\`. Do not edit generated files by hand.
`;
}

function buildThirdParty(selections) {
  const rows = selections.map((selection) =>
    `| ${markdownCode(selection.catalogId)} | ${selection.titleZh} | ${markdownCode(selection.sourcePath)} | ${markdownCode(selection.symbol)} |`
  );
  return `# Third-party motion sources

## Amicro — Micro Transitions

- Repository: ${AMICRO_UPSTREAM.repository}
- Pinned commit: ${markdownCode(AMICRO_UPSTREAM.commit)}
- License: ${AMICRO_UPSTREAM.license} (full text in [LICENSE](./LICENSE))
- Copyright: ${AMICRO_UPSTREAM.copyright}

The following AI Concept Studio catalog entries reference selected symbols from the pinned upstream source. Repeated source paths are archived only once.

| Catalog ID | Selection | Upstream path | Symbol |
| --- | --- | --- | --- |
${rows.join("\n")}

This inventory covers only the curated selection, not every component or asset in the upstream repository. The adapted Remotion components are separate works and may differ from the browser-oriented upstream implementation.
`;
}

function buildManifest(selections, downloadedFiles, licenseFile) {
  const filesByPath = new Map(downloadedFiles.map((file) => [file.sourcePath, file]));
  const files = downloadedFiles.map((file) => {
    const related = selections.filter((selection) => selection.sourcePath === file.sourcePath);
    return {
      sourcePath: file.sourcePath,
      archivePath: `selected/${file.sourcePath}`,
      sourceUrl: file.url,
      bytes: file.bytes,
      sha256: file.sha256,
      catalogIds: [...new Set(related.map((selection) => selection.catalogId))],
      symbols: [...new Set(related.map((selection) => selection.symbol))]
    };
  });
  const selectedBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (selectedBytes + licenseFile.bytes > MAX_ARCHIVE_BYTES) {
    throw new Error(`Selected archive exceeds size limit: ${selectedBytes + licenseFile.bytes} bytes`);
  }

  return {
    schemaVersion: "motion-library-upstream-selection-v1",
    generatedBy: "studio/scripts/archive-motion-library-upstream.mjs",
    source: {
      repository: AMICRO_UPSTREAM.repository,
      commit: AMICRO_UPSTREAM.commit,
      license: AMICRO_UPSTREAM.license,
      copyright: AMICRO_UPSTREAM.copyright,
      licensePath: "LICENSE",
      licenseBytes: licenseFile.bytes,
      licenseSha256: licenseFile.sha256
    },
    summary: {
      catalogItemCount: MOTION_LIBRARY_ITEMS.length,
      selectionReferenceCount: selections.length,
      selectedFileCount: files.length,
      selectedBytes,
      archiveBytesIncludingLicense: selectedBytes + licenseFile.bytes
    },
    selections: selections.map((selection) => {
      const file = filesByPath.get(selection.sourcePath);
      if (!file) throw new Error(`Downloaded file missing from manifest: ${selection.sourcePath}`);
      return {
        ...selection,
        archivePath: `selected/${selection.sourcePath}`,
        upstreamCommit: AMICRO_UPSTREAM.commit,
        license: AMICRO_UPSTREAM.license,
        bytes: file.bytes,
        sha256: file.sha256
      };
    }),
    files
  };
}

async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) => compareAscii(left.name, right.name))) {
    const entryPath = ensureInside(root, resolve(current, entry.name));
    if (entry.isSymbolicLink()) {
      throw new Error(`Symlinks are not allowed in the archive: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      paths.push(...await walkFiles(root, entryPath));
    } else if (entry.isFile()) {
      paths.push(entryPath.slice(resolve(root).length + 1).split(sep).join("/"));
    } else {
      throw new Error(`Unsupported archive entry: ${entryPath}`);
    }
  }
  return paths;
}

async function verifyStagedArchive(stagedRoot, manifest) {
  const expectedPaths = [
    "LICENSE",
    "NOTICE.md",
    "THIRD_PARTY.md",
    "selection-manifest.json",
    ...manifest.files.map((file) => file.archivePath)
  ].sort(compareAscii);
  const actualPaths = (await walkFiles(stagedRoot)).sort(compareAscii);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("Staged archive contains missing or unexpected files");
  }

  for (const file of manifest.files) {
    const content = await readFile(ensureInside(stagedRoot, resolve(stagedRoot, file.archivePath)));
    if (content.length !== file.bytes || sha256(content) !== file.sha256) {
      throw new Error(`Staged checksum mismatch: ${file.archivePath}`);
    }
  }

  const license = await readFile(resolve(stagedRoot, "LICENSE"));
  if (
    license.length !== manifest.source.licenseBytes ||
    sha256(license) !== manifest.source.licenseSha256
  ) {
    throw new Error("Staged LICENSE checksum mismatch");
  }
  const parsedManifest = JSON.parse(await readFile(resolve(stagedRoot, "selection-manifest.json"), "utf8"));
  if (JSON.stringify(parsedManifest) !== JSON.stringify(manifest)) {
    throw new Error("Staged selection manifest does not match in-memory manifest");
  }
}

async function snapshotDirectory(root) {
  const paths = await walkFiles(root);
  const entries = [];
  for (const relativePath of paths.sort(compareAscii)) {
    const content = await readFile(ensureInside(root, resolve(root, relativePath)));
    entries.push({ path: relativePath, bytes: content.length, sha256: sha256(content) });
  }
  return entries;
}

async function pathState(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function installArchive(stagedRoot) {
  const existing = await pathState(archiveRoot);
  if (existing?.isSymbolicLink() || (existing && !existing.isDirectory())) {
    throw new Error(`Archive destination is not a safe directory: ${archiveRoot}`);
  }
  if (existing) {
    const [currentSnapshot, stagedSnapshot] = await Promise.all([
      snapshotDirectory(archiveRoot),
      snapshotDirectory(stagedRoot)
    ]);
    if (JSON.stringify(currentSnapshot) === JSON.stringify(stagedSnapshot)) {
      await rm(stagedRoot, { recursive: true });
      return "unchanged";
    }
  }

  if (!existing) {
    await rename(stagedRoot, archiveRoot);
    return "created";
  }

  const backupRoot = ensureInside(
    archiveParent,
    resolve(archiveParent, `.amicro-previous-${process.pid}-${Date.now()}`)
  );
  await rename(archiveRoot, backupRoot);
  try {
    await rename(stagedRoot, archiveRoot);
  } catch (error) {
    await rename(backupRoot, archiveRoot).catch(() => undefined);
    throw error;
  }
  await rm(backupRoot, { recursive: true });
  return "updated";
}

export async function archiveMotionLibraryUpstream() {
  assertPinnedSource();
  const selections = buildSelections();
  const sourcePaths = [...new Set(selections.map((selection) => selection.sourcePath))]
    .sort(compareAscii);

  await mkdir(archiveParent, { recursive: true });
  const stagedRoot = await mkdtemp(resolve(archiveParent, ".amicro-archive-"));
  try {
    const [downloadedFiles, licenseFile] = await Promise.all([
      mapWithConcurrency(sourcePaths, DOWNLOAD_CONCURRENCY, fetchPinnedFile),
      fetchPinnedFile("LICENSE")
    ]);
    const manifest = buildManifest(selections, downloadedFiles, licenseFile);

    for (const file of downloadedFiles) {
      await writeExclusive(
        ensureInside(stagedRoot, resolve(stagedRoot, "selected", file.sourcePath)),
        file.content
      );
    }
    await writeExclusive(resolve(stagedRoot, "LICENSE"), licenseFile.content);
    await writeExclusive(resolve(stagedRoot, "NOTICE.md"), buildNotice());
    await writeExclusive(resolve(stagedRoot, "THIRD_PARTY.md"), buildThirdParty(selections));
    await writeExclusive(
      resolve(stagedRoot, "selection-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    await verifyStagedArchive(stagedRoot, manifest);
    const result = await installArchive(stagedRoot);
    console.log(JSON.stringify({ result, archiveRoot, ...manifest.summary }, null, 2));
    return { result, archiveRoot, manifest };
  } catch (error) {
    await rm(stagedRoot, { recursive: true }).catch(() => undefined);
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await archiveMotionLibraryUpstream();
}
