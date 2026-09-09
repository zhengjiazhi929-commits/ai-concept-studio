import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, link, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function ensureInside(root, target) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  if (
    normalizedTarget !== normalizedRoot &&
    !normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw new Error(`Path escapes durable JSON store: ${normalizedTarget}`);
  }
  return normalizedTarget;
}

function relativeStorePath(root, target) {
  const path = relative(resolve(root), ensureInside(root, target));
  if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) {
    throw new Error(`Durable JSON document must be below its store root: ${target}`);
  }
  return path;
}

async function lstatOrNull(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function assertDurableStorePath(root, target) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = ensureInside(normalizedRoot, target);
  const rootStats = await lstatOrNull(normalizedRoot);
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
    throw lockError(
      "Durable JSON store root must be a real directory",
      "durable_json_store_path_unsafe"
    );
  }
  const canonicalRoot = await realpath(normalizedRoot);
  const relativePath = relative(normalizedRoot, normalizedTarget);
  const parts = relativePath ? relativePath.split(sep).filter(Boolean) : [];
  let cursor = normalizedRoot;
  for (const part of parts) {
    cursor = resolve(cursor, part);
    const stats = await lstatOrNull(cursor);
    if (!stats) break;
    if (stats.isSymbolicLink()) {
      throw lockError(
        `Durable JSON store path contains a symbolic link: ${cursor}`,
        "durable_json_store_path_unsafe"
      );
    }
  }
  const existingTarget = await lstatOrNull(normalizedTarget);
  if (existingTarget) {
    const canonicalTarget = await realpath(normalizedTarget);
    if (
      canonicalTarget !== canonicalRoot &&
      !canonicalTarget.startsWith(`${canonicalRoot}${sep}`)
    ) {
      throw lockError(
        `Durable JSON store path resolves outside its root: ${normalizedTarget}`,
        "durable_json_store_path_unsafe"
      );
    }
  }
  return normalizedTarget;
}

function serializedJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function jsonDocumentContentSha256(value) {
  return sha256(serializedJson(value));
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJsonValue(value[key])])
    );
  }
  return value;
}

export function canonicalJsonDocumentContentSha256(value) {
  return sha256(serializedJson(canonicalJsonValue(value)));
}

function lockError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = code === "durable_json_store_lock_busy" ? 409 : 503;
  return error;
}

export function assertNoDurableJsonStoreHooks(options = {}) {
  for (const hookName of [
    "onPublicationStage",
    "onDocumentSetStage",
    "onStaleLockObserved"
  ]) {
    if (
      options !== null &&
      (typeof options === "object" || typeof options === "function") &&
      hookName in options
    ) {
      throw lockError(
        `Durable JSON store does not accept caller-controlled ${hookName} hooks`,
        "durable_json_store_hook_forbidden"
      );
    }
  }
}

async function writeDurableExclusiveFile(path, contents) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EBADF"].includes(error?.code)) throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function readJsonDocument(path, options = {}) {
  if (options.storeRoot) await assertDurableStorePath(options.storeRoot, path);
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readJsonDocumentOr(path, fallback, options = {}) {
  if (options.storeRoot && !(await lstatOrNull(resolve(options.storeRoot)))) {
    return fallback;
  }
  try {
    return await readJsonDocument(path, options);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJsonDocumentAtomic(path, value, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const contents = serializedJson(value);
  const parent = dirname(path);
  if (options.storeRoot) await assertDurableStorePath(options.storeRoot, path);
  await mkdir(parent, { recursive: true });
  if (options.storeRoot) {
    await assertDurableStorePath(options.storeRoot, parent);
    await assertDurableStorePath(options.storeRoot, path);
  }
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeDurableExclusiveFile(temporary, contents);
    if (options.storeRoot) await assertDurableStorePath(options.storeRoot, path);
    await rename(temporary, path);
    await syncDirectory(parent);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return path;
}

export async function writeImmutableJsonDocument(path, value, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const contents = serializedJson(value);
  const parent = dirname(path);
  if (options.storeRoot) await assertDurableStorePath(options.storeRoot, path);
  await mkdir(parent, { recursive: true });
  if (options.storeRoot) {
    await assertDurableStorePath(options.storeRoot, parent);
    await assertDurableStorePath(options.storeRoot, path);
  }
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeDurableExclusiveFile(temporary, contents);
    try {
      // link(2) publishes without replacing an existing immutable run. Because
      // the temporary file is in the same directory, this is one filesystem
      // operation and cannot expose a partially-written JSON document.
      if (options.storeRoot) await assertDurableStorePath(options.storeRoot, path);
      await link(temporary, path);
      await rm(temporary, { force: true });
      await syncDirectory(parent);
      return path;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    const existing = await readFile(path, "utf8");
    if (existing !== contents) {
      const error = new Error(`Immutable JSON run already exists with different content: ${path}`);
      error.code = "immutable_json_conflict";
      error.statusCode = 409;
      throw error;
    }
    return path;
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function withDurableJsonStoreLock(root, options = {}, operation) {
  assertNoDurableJsonStoreHooks(options);
  const normalizedRoot = resolve(root);
  await mkdir(normalizedRoot, { recursive: true });
  const databasePath = resolve(normalizedRoot, ".store-lock.sqlite");
  await assertDurableStorePath(normalizedRoot, databasePath);
  const parsedTimeoutMs = Number(options.lockTimeoutMs ?? 10000);
  const parsedRetryDelayMs = Number(options.lockRetryDelayMs ?? 10);
  const timeoutMs = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs >= 0
    ? parsedTimeoutMs
    : 10000;
  const retryDelayMs = Number.isFinite(parsedRetryDelayMs) && parsedRetryDelayMs >= 1
    ? parsedRetryDelayMs
    : 10;
  const deadline = Date.now() + timeoutMs;
  let database;
  let transactionOpen = false;

  try {
    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA busy_timeout = 0");
    while (true) {
      try {
        // SQLite owns crash recovery and releases this OS-backed writer mutex
        // when a process exits. JSON remains the source of truth.
        database.exec("BEGIN IMMEDIATE");
        transactionOpen = true;
        break;
      } catch (error) {
        if (!/database is (?:locked|busy)/iu.test(error?.message ?? "")) throw error;
      }
      if (Date.now() >= deadline) {
        throw lockError(
          "Durable JSON store is being updated by another process",
          "durable_json_store_lock_busy"
        );
      }
      await delay(Math.min(retryDelayMs, Math.max(1, deadline - Date.now())));
    }

    try {
      return await operation();
    } finally {
      if (transactionOpen) {
        database.exec("ROLLBACK");
        transactionOpen = false;
      }
      database.close();
      database = undefined;
    }
  } catch (error) {
    if (transactionOpen) {
      try {
        database?.exec("ROLLBACK");
      } catch {
        // Preserve the original operation or lock error.
      }
    }
    try {
      database?.close();
    } catch {
      // Preserve the original operation or lock error.
    }
    throw error;
  }
}

function validatePublicationJournal(root, journal) {
  if (
    journal?.schemaVersion !== 1 ||
    typeof journal.publicationId !== "string" ||
    !journal.publicationId ||
    typeof journal.runPath !== "string" ||
    !journal.runPath ||
    !Array.isArray(journal.pointerPaths) ||
    journal.pointerPaths.length === 0 ||
    typeof journal.runSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(journal.runSha256)
  ) {
    throw lockError(
      "Durable JSON publication journal is invalid; recovery stopped safely",
      "durable_json_publication_invalid"
    );
  }
  const runPath = ensureInside(root, resolve(root, journal.runPath));
  const pointerPaths = journal.pointerPaths.map((path) =>
    ensureInside(root, resolve(root, path))
  );
  return { runPath, pointerPaths };
}

async function readValidatedPublicationRun(root, journal) {
  const { runPath, pointerPaths } = validatePublicationJournal(root, journal);
  await assertDurableStorePath(root, runPath);
  for (const pointerPath of pointerPaths) {
    await assertDurableStorePath(root, pointerPath);
  }
  let runContents;
  try {
    runContents = await readFile(runPath, "utf8");
  } catch (error) {
    throw lockError(
      "Durable JSON publication references a missing run; recovery stopped safely",
      "durable_json_publication_invalid",
      error
    );
  }
  if (sha256(runContents) !== journal.runSha256) {
    throw lockError(
      "Durable JSON publication run hash does not match; recovery stopped safely",
      "durable_json_publication_invalid"
    );
  }
  let run;
  try {
    run = JSON.parse(runContents);
  } catch (error) {
    throw lockError(
      "Durable JSON publication run is not valid JSON; recovery stopped safely",
      "durable_json_publication_invalid",
      error
    );
  }
  return { run, runPath, pointerPaths };
}

export async function readJsonPublicationPointer(
  root,
  journalName,
  pointerPath,
  fallback = null
) {
  const normalizedRoot = resolve(root);
  const normalizedPointerPath = ensureInside(normalizedRoot, pointerPath);
  const journalPath = ensureInside(normalizedRoot, resolve(normalizedRoot, journalName));
  if (!(await lstatOrNull(normalizedRoot))) return fallback;
  await assertDurableStorePath(normalizedRoot, journalPath);
  await assertDurableStorePath(normalizedRoot, normalizedPointerPath);
  const journal = await readJsonDocumentOr(journalPath, null, { storeRoot: normalizedRoot });
  if (!journal) {
    return readJsonDocumentOr(normalizedPointerPath, fallback, { storeRoot: normalizedRoot });
  }

  // A durable journal is the publication intent. Readers can return its fully
  // fsynced immutable run without mutating the store or creating a lock DB,
  // even if the writer exited between two pointer renames.
  const publication = await readValidatedPublicationRun(normalizedRoot, journal);
  if (!publication.pointerPaths.includes(normalizedPointerPath)) {
    return readJsonDocumentOr(normalizedPointerPath, fallback);
  }
  return publication.run;
}

export async function recoverJsonPublication(root, journalName, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const normalizedRoot = resolve(root);
  const journalPath = ensureInside(normalizedRoot, resolve(normalizedRoot, journalName));
  await assertDurableStorePath(normalizedRoot, journalPath);
  const journal = await readJsonDocumentOr(journalPath, null, { storeRoot: normalizedRoot });
  if (!journal) return null;

  const { run, runPath, pointerPaths } = await readValidatedPublicationRun(
    normalizedRoot,
    journal
  );

  for (const pointerPath of pointerPaths) {
    await writeJsonDocumentAtomic(pointerPath, run, { storeRoot: normalizedRoot });
  }
  await rm(journalPath);
  await syncDirectory(normalizedRoot);
  return { publicationId: journal.publicationId, runPath, pointerPaths };
}

export async function publishImmutableJsonWithPointers({
  root,
  journalName,
  runPath,
  value,
  pointerPaths,
  options = {}
}) {
  assertNoDurableJsonStoreHooks(options);
  const normalizedRoot = resolve(root);
  const normalizedRunPath = ensureInside(normalizedRoot, runPath);
  const normalizedPointerPaths = pointerPaths.map((path) => ensureInside(normalizedRoot, path));
  const journalPath = ensureInside(normalizedRoot, resolve(normalizedRoot, journalName));

  await assertDurableStorePath(normalizedRoot, normalizedRunPath);
  await assertDurableStorePath(normalizedRoot, journalPath);
  for (const pointerPath of normalizedPointerPaths) {
    await assertDurableStorePath(normalizedRoot, pointerPath);
  }

  await recoverJsonPublication(normalizedRoot, journalName);
  await writeImmutableJsonDocument(normalizedRunPath, value, { storeRoot: normalizedRoot });

  const journal = {
    schemaVersion: 1,
    publicationId: randomUUID(),
    runPath: relativeStorePath(normalizedRoot, normalizedRunPath),
    pointerPaths: normalizedPointerPaths.map((path) => relativeStorePath(normalizedRoot, path)),
    runSha256: jsonDocumentContentSha256(value)
  };
  await writeJsonDocumentAtomic(journalPath, journal, { storeRoot: normalizedRoot });

  for (const pointerPath of normalizedPointerPaths) {
    await writeJsonDocumentAtomic(pointerPath, value, { storeRoot: normalizedRoot });
  }
  await rm(journalPath);
  await syncDirectory(normalizedRoot);
  return normalizedRunPath;
}

function validateDocumentSetJournal(root, journal) {
  if (
    journal?.schemaVersion !== 1 ||
    typeof journal.publicationId !== "string" ||
    !journal.publicationId ||
    !Array.isArray(journal.documents) ||
    journal.documents.length === 0
  ) {
    throw lockError(
      "Durable JSON document-set journal is invalid; recovery stopped safely",
      "durable_json_publication_invalid"
    );
  }

  const seenTargets = new Set();
  const documents = journal.documents.map((document) => {
    if (
      typeof document?.targetPath !== "string" ||
      !document.targetPath ||
      typeof document?.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(document.sha256) ||
      !("value" in document)
    ) {
      throw lockError(
        "Durable JSON document-set entry is invalid; recovery stopped safely",
        "durable_json_publication_invalid"
      );
    }
    const targetPath = ensureInside(root, resolve(root, document.targetPath));
    if (seenTargets.has(targetPath)) {
      throw lockError(
        "Durable JSON document-set contains a duplicate target",
        "durable_json_publication_invalid"
      );
    }
    seenTargets.add(targetPath);
    if (jsonDocumentContentSha256(document.value) !== document.sha256) {
      throw lockError(
        "Durable JSON document-set value hash does not match",
        "durable_json_publication_invalid"
      );
    }
    return { targetPath, value: document.value };
  });
  return documents;
}

async function readValidatedDocumentSetJournal(root, journalName) {
  const normalizedRoot = resolve(root);
  const journalPath = ensureInside(normalizedRoot, resolve(normalizedRoot, journalName));
  await assertDurableStorePath(normalizedRoot, journalPath);
  const journal = await readJsonDocumentOr(journalPath, null, {
    storeRoot: normalizedRoot
  });
  if (!journal) return null;
  const documents = validateDocumentSetJournal(normalizedRoot, journal);
  for (const document of documents) {
    await assertDurableStorePath(normalizedRoot, document.targetPath);
  }
  return { journal, journalPath, documents };
}

export async function readJsonDocumentSetPointer(
  root,
  journalName,
  pointerPath,
  fallback = null
) {
  const normalizedRoot = resolve(root);
  const normalizedPointerPath = ensureInside(normalizedRoot, pointerPath);
  if (!(await lstatOrNull(normalizedRoot))) return fallback;
  await assertDurableStorePath(normalizedRoot, normalizedPointerPath);
  const publication = await readValidatedDocumentSetJournal(
    normalizedRoot,
    journalName
  );
  if (publication) {
    const pending = publication.documents.find(
      (document) => document.targetPath === normalizedPointerPath
    );
    if (pending) return structuredClone(pending.value);
  }
  return readJsonDocumentOr(normalizedPointerPath, fallback, {
    storeRoot: normalizedRoot
  });
}

export async function recoverJsonDocumentSet(root, journalName, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const normalizedRoot = resolve(root);
  const publication = await readValidatedDocumentSetJournal(
    normalizedRoot,
    journalName
  );
  if (!publication) return null;

  for (const document of publication.documents) {
    await writeJsonDocumentAtomic(document.targetPath, document.value, {
      storeRoot: normalizedRoot
    });
  }
  await rm(publication.journalPath);
  await syncDirectory(normalizedRoot);
  return {
    publicationId: publication.journal.publicationId,
    targetPaths: publication.documents.map((document) => document.targetPath)
  };
}

export async function publishJsonDocumentSet({
  root,
  journalName,
  documents,
  options = {}
}) {
  assertNoDurableJsonStoreHooks(options);
  const normalizedRoot = resolve(root);
  await mkdir(normalizedRoot, { recursive: true });
  const journalPath = ensureInside(normalizedRoot, resolve(normalizedRoot, journalName));
  await assertDurableStorePath(normalizedRoot, journalPath);
  await recoverJsonDocumentSet(normalizedRoot, journalName);

  const normalizedDocuments = documents.map(({ path, value }) => ({
    targetPath: ensureInside(normalizedRoot, path),
    value
  }));
  const uniqueTargets = new Set(
    normalizedDocuments.map((document) => document.targetPath)
  );
  if (normalizedDocuments.length === 0 || uniqueTargets.size !== normalizedDocuments.length) {
    throw lockError(
      "Durable JSON document-set must contain unique targets",
      "durable_json_publication_invalid"
    );
  }
  for (const document of normalizedDocuments) {
    await assertDurableStorePath(normalizedRoot, document.targetPath);
  }

  const journal = {
    schemaVersion: 1,
    publicationId: randomUUID(),
    documents: normalizedDocuments.map((document) => ({
      targetPath: relativeStorePath(normalizedRoot, document.targetPath),
      sha256: jsonDocumentContentSha256(document.value),
      value: document.value
    }))
  };
  // The journal is the commit point. Before it exists no target has changed;
  // after it exists readers and recovery observe the complete intended set.
  await writeJsonDocumentAtomic(journalPath, journal, { storeRoot: normalizedRoot });

  for (const document of normalizedDocuments) {
    await writeJsonDocumentAtomic(document.targetPath, document.value, {
      storeRoot: normalizedRoot
    });
  }
  await rm(journalPath);
  await syncDirectory(normalizedRoot);
  return {
    publicationId: journal.publicationId,
    targetPaths: normalizedDocuments.map((document) => document.targetPath)
  };
}
