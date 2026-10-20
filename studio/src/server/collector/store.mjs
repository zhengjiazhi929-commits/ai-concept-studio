import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  collectorAssistTaskPath,
  collectorConfigPath,
  collectorDataRoot,
  collectorLatestRunPath,
  collectorRunsRoot,
  collectorSourceHealthPath,
  ensureInside
} from "../../shared/paths.mjs";
import {
  assertNoDurableJsonStoreHooks,
  publishImmutableJsonWithPointers,
  readJsonDocument,
  readJsonDocumentOr,
  readJsonPublicationPointer,
  recoverJsonPublication,
  withDurableJsonStoreLock,
  writeImmutableJsonDocument,
  writeJsonDocumentAtomic
} from "../../shared/durable-json-store.mjs";
import { validateCollectorConfig } from "./schema.mjs";

const COLLECTOR_PUBLICATION_JOURNAL = ".collector-publication.json";

function assertCollectorRunId(runId) {
  if (typeof runId !== "string" || !/^[a-z0-9-]{1,160}$/u.test(runId)) {
    throw Object.assign(new Error("Collector run id 无效"), { code: "collector_run_id_invalid" });
  }
}

function resolveCollectorDataPaths(options = {}) {
  if (!options.collectorRoot) {
    return {
      root: collectorDataRoot,
      runs: collectorRunsRoot,
      latestRun: collectorLatestRunPath,
      sourceHealth: collectorSourceHealthPath,
      assistTask: collectorAssistTaskPath
    };
  }
  const root = resolve(options.collectorRoot);
  return {
    root,
    runs: resolve(root, "runs"),
    latestRun: resolve(root, "latest.json"),
    sourceHealth: resolve(root, "source-health.json"),
    assistTask: resolve(root, "assist-task.json")
  };
}

async function withCollectorStoreLock(options, operation) {
  assertNoDurableJsonStoreHooks(options);
  const paths = resolveCollectorDataPaths(options);
  return withDurableJsonStoreLock(paths.root, options, async () => {
    await recoverJsonPublication(paths.root, COLLECTOR_PUBLICATION_JOURNAL);
    return operation(paths);
  });
}

export async function readCollectorConfig() {
  const document = await readJsonDocument(collectorConfigPath);
  const validation = validateCollectorConfig(document);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return document;
}

export async function readLatestCollectorRun(options = {}) {
  const paths = resolveCollectorDataPaths(options);
  return readJsonPublicationPointer(
    paths.root,
    COLLECTOR_PUBLICATION_JOURNAL,
    paths.latestRun,
    null
  );
}

export async function readCollectorRun(runId, options = {}) {
  assertCollectorRunId(runId);
  const paths = resolveCollectorDataPaths(options);
  const runPath = ensureInside(paths.runs, resolve(paths.runs, `${runId}.json`));
  return readJsonDocumentOr(runPath, null, { storeRoot: paths.root });
}

// Claims precede signal/health writes and survive failures. A repeated id must
// be inspected against its recorded batch and run; it is never auto-replayed.
export async function claimCollectorBatch(batch, options = {}) {
  assertCollectorRunId(batch?.batchId);
  if (batch.schemaVersion !== 2) {
    throw Object.assign(new Error("Collector discovery claim只接受v2批次"), {
      code: "collector_batch_claim_invalid"
    });
  }
  const snapshot = structuredClone(batch);
  return withCollectorStoreLock(options, async (paths) => {
    const claimPath = ensureInside(paths.root, resolve(paths.root, "claims", `${snapshot.batchId}.json`));
    const previous = await readJsonDocumentOr(claimPath, null, { storeRoot: paths.root });
    if (previous) {
      throw Object.assign(new Error("该批次已声明；请核对claim与run，禁止自动重放"), {
        code: "collector_batch_already_claimed"
      });
    }
    const claim = {
      schemaVersion: 1,
      batchId: snapshot.batchId,
      claimedAt: new Date().toISOString(),
      batchSha256: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
      batch: snapshot
    };
    await writeImmutableJsonDocument(claimPath, claim, { storeRoot: paths.root });
    return claim;
  });
}

export async function readCollectorSourceHealth(options = {}) {
  const paths = resolveCollectorDataPaths(options);
  return readJsonDocumentOr(paths.sourceHealth, {
    schemaVersion: 1,
    updatedAt: null,
    sources: []
  }, { storeRoot: paths.root });
}

export async function readCollectorAssistTask(options = {}) {
  const paths = resolveCollectorDataPaths(options);
  return readJsonDocumentOr(paths.assistTask, null, { storeRoot: paths.root });
}

export async function writeCollectorRun(run, options = {}) {
  return withCollectorStoreLock(options, async (paths) => {
    const runPath = ensureInside(paths.runs, resolve(paths.runs, `${run.id}.json`));
    return publishImmutableJsonWithPointers({
      root: paths.root,
      journalName: COLLECTOR_PUBLICATION_JOURNAL,
      runPath,
      value: run,
      pointerPaths: [paths.latestRun]
    });
  });
}

export async function updateCollectorSourceHealth(entries, updatedAt, options = {}) {
  return withCollectorStoreLock(options, async (paths) => {
    const current = await readJsonDocumentOr(paths.sourceHealth, {
      schemaVersion: 1,
      updatedAt: null,
      sources: []
    }, { storeRoot: paths.root });
    const sourceMap = new Map(current.sources.map((source) => [source.creatorId, source]));
    for (const entry of entries) {
      sourceMap.set(entry.creatorId, {
        ...(sourceMap.get(entry.creatorId) ?? {}),
        ...entry
      });
    }
    const document = {
      schemaVersion: 1,
      updatedAt,
      sources: Array.from(sourceMap.values()).sort((a, b) =>
        a.creatorId.localeCompare(b.creatorId)
      )
    };
    await writeJsonDocumentAtomic(paths.sourceHealth, document, { storeRoot: paths.root });
    return document;
  });
}

export async function writeCollectorAssistTask(task, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const paths = resolveCollectorDataPaths(options);
  await mkdir(paths.root, { recursive: true });
  await writeJsonDocumentAtomic(paths.assistTask, task, { storeRoot: paths.root });
  return paths.assistTask;
}
