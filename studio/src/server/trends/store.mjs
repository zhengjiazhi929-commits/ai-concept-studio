import { hostname } from "node:os";
import { readFile, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  conceptTaxonomyPath,
  trendRadarConfigPath,
  trendsDataRoot,
  trendSourcesConfigPath
} from "../../shared/paths.mjs";
import {
  normalizeSearchText,
  validateSignal,
  validateTaxonomy,
  validateTrendSources
} from "./schema.mjs";
import {
  assertNoDurableJsonStoreHooks,
  publishJsonDocumentSet,
  readJsonDocumentOr,
  readJsonDocumentSetPointer,
  recoverJsonDocumentSet,
  syncDirectory,
  withDurableJsonStoreLock,
  writeJsonDocumentAtomic
} from "../../shared/durable-json-store.mjs";

const TREND_PUBLICATION_JOURNAL = ".trend-publication.json";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function lockError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = code === "trend_store_lock_busy" ? 409 : 503;
  return error;
}

function validLockOwner(owner) {
  return Boolean(
    owner?.schemaVersion === 1 &&
      typeof owner.token === "string" &&
      owner.token &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      typeof owner.hostname === "string" &&
      owner.hostname &&
      typeof owner.createdAt === "string" &&
      !Number.isNaN(Date.parse(owner.createdAt))
  );
}

function lockOwnerIsAlive(owner) {
  if (owner.hostname !== hostname()) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function recoverLegacyTrendLock(root) {
  const legacyLockPath = resolve(root, ".store.lock");
  let legacyOwner;
  try {
    legacyOwner = await readJsonDocumentOr(legacyLockPath, null, { storeRoot: root });
  } catch (error) {
    throw lockError(
      "旧版热点数据锁无法验证，写入已安全停止",
      "trend_store_lock_invalid",
      error
    );
  }
  if (!legacyOwner) return;
  if (!validLockOwner(legacyOwner)) {
    throw lockError("旧版热点数据锁内容无效，写入已安全停止", "trend_store_lock_invalid");
  }
  if (lockOwnerIsAlive(legacyOwner)) {
    throw lockError("热点数据仍由旧版进程写入，请稍后重试", "trend_store_lock_busy");
  }
  await rm(legacyLockPath, { force: true });
  await syncDirectory(root);
}

async function withTrendStoreLock(paths, options, operation) {
  assertNoDurableJsonStoreHooks(options);
  try {
    return await withDurableJsonStoreLock(
      paths.root,
      {
        ...options,
        retryDelayMs: options.lockRetryDelayMs ?? options.retryDelayMs
      },
      async () => {
        await recoverLegacyTrendLock(paths.root);
        await recoverJsonDocumentSet(paths.root, TREND_PUBLICATION_JOURNAL);
        return operation();
      }
    );
  } catch (error) {
    if (error?.code === "durable_json_store_lock_busy") {
      throw lockError(
        "热点数据正由另一个进程写入，请稍后重试",
        "trend_store_lock_busy",
        error
      );
    }
    throw error;
  }
}

function resolveTrendDataPaths(options = {}) {
  const root = options.trendsRoot ? resolve(options.trendsRoot) : trendsDataRoot;
  return {
    root,
    latestRun: resolve(root, "latest.json"),
    runs: resolve(root, "runs"),
    selection: resolve(root, "selection.json"),
    signals: resolve(root, "signals.json")
  };
}

export async function readTrendRadarConfig() {
  return readJson(trendRadarConfigPath);
}

export async function readTrendSources() {
  const document = await readJson(trendSourcesConfigPath);
  const validation = validateTrendSources(document);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return document;
}

export async function readConceptTaxonomy() {
  const document = await readJson(conceptTaxonomyPath);
  const validation = validateTaxonomy(document);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return document;
}

export async function readTrendSignals(options = {}) {
  const paths = resolveTrendDataPaths(options);
  return readJsonDocumentOr(paths.signals, {
    schemaVersion: 1,
    updatedAt: null,
    importedSnapshots: [],
    signals: []
  }, { storeRoot: paths.root });
}

export async function importTrendSnapshot(snapshotPath, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const paths = resolveTrendDataPaths(options);
  const [snapshot, sources, taxonomy] = await Promise.all([
    readJson(snapshotPath),
    readTrendSources(),
    readConceptTaxonomy()
  ]);
  const creatorIds = new Set(sources.creators.map((creator) => creator.id));
  const conceptIds = new Set(taxonomy.concepts.map((concept) => concept.id));
  const errors = [];
  for (const signal of snapshot.signals ?? []) {
    const validation = validateSignal(signal, creatorIds, conceptIds);
    errors.push(...validation.errors);
  }
  if (errors.length > 0) throw new Error(errors.join("; "));

  return withTrendStoreLock(paths, options, async () => {
    const current = await readJsonDocumentOr(paths.signals, {
      schemaVersion: 1,
      updatedAt: null,
      importedSnapshots: [],
      signals: []
    }, { storeRoot: paths.root });
    const signalMap = new Map(current.signals.map((signal) => [signal.id, signal]));
    for (const signal of snapshot.signals ?? []) signalMap.set(signal.id, signal);
    const importedSnapshots = Array.from(
      new Set([...(current.importedSnapshots ?? []), snapshot.snapshotId || basename(snapshotPath)])
    );
    const document = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      importedSnapshots,
      signals: Array.from(signalMap.values()).sort((a, b) =>
        (b.publishedAt || b.observedAt).localeCompare(a.publishedAt || a.observedAt)
      )
    };
    await writeJsonDocumentAtomic(paths.signals, document, { storeRoot: paths.root });
    return {
      snapshotId: snapshot.snapshotId,
      imported: snapshot.signals?.length ?? 0,
      total: document.signals.length,
      document
    };
  });
}

export async function appendTrendSignal(signal, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const result = await upsertTrendSignals([signal], options);
  return result.document;
}

function signalContentKey(signal) {
  const day = (signal.publishedAt || signal.observedAt || "").slice(0, 10);
  return `${signal.creatorId}|${normalizeSearchText(signal.title)}|${day}`;
}

function mergeSignal(existing, incoming) {
  return {
    ...incoming,
    ...existing,
    sourceUrl: incoming.sourceUrl || existing.sourceUrl,
    observedAt:
      (incoming.observedAt || "") > (existing.observedAt || "")
        ? incoming.observedAt
        : existing.observedAt,
    metrics: {
      ...(existing.metrics ?? {}),
      ...(incoming.metrics ?? {})
    },
    externalId: incoming.externalId ?? existing.externalId,
    collector: incoming.collector ?? existing.collector
  };
}

export async function upsertTrendSignals(signals, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const paths = resolveTrendDataPaths(options);
  const [sources, taxonomy] = await Promise.all([
    readTrendSources(),
    readConceptTaxonomy()
  ]);
  const creatorIds = new Set(sources.creators.map((creator) => creator.id));
  const conceptIds = new Set(taxonomy.concepts.map((concept) => concept.id));
  const errors = [];
  for (const signal of signals) {
    const validation = validateSignal(signal, creatorIds, conceptIds);
    errors.push(...validation.errors);
  }
  if (errors.length > 0) throw new Error(errors.join("; "));

  return withTrendStoreLock(paths, options, async () => {
    const current = await readJsonDocumentOr(paths.signals, {
      schemaVersion: 1,
      updatedAt: null,
      importedSnapshots: [],
      signals: []
    }, { storeRoot: paths.root });
    const signalMap = new Map(current.signals.map((item) => [item.id, item]));
    const contentKeyMap = new Map(
      current.signals.map((item) => [signalContentKey(item), item.id])
    );
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    for (const signal of signals) {
      const matchedId = signalMap.has(signal.id)
        ? signal.id
        : contentKeyMap.get(signalContentKey(signal));
      if (!matchedId) {
        signalMap.set(signal.id, signal);
        contentKeyMap.set(signalContentKey(signal), signal.id);
        added += 1;
        continue;
      }
      const existing = signalMap.get(matchedId);
      const merged = mergeSignal(existing, signal);
      if (JSON.stringify(existing) === JSON.stringify(merged)) unchanged += 1;
      else updated += 1;
      signalMap.set(matchedId, merged);
    }
    const document = {
      ...current,
      updatedAt: new Date().toISOString(),
      importedSnapshots: options.importTag
        ? Array.from(new Set([...(current.importedSnapshots ?? []), options.importTag]))
        : current.importedSnapshots,
      signals: Array.from(signalMap.values()).sort((a, b) =>
        (b.publishedAt || b.observedAt).localeCompare(a.publishedAt || a.observedAt)
      )
    };
    await writeJsonDocumentAtomic(paths.signals, document, { storeRoot: paths.root });
    return { document, added, updated, unchanged };
  });
}

async function writeTrendRunUnlocked(run, paths) {
  const runPath = resolve(paths.runs, `${run.id}.json`);
  await publishJsonDocumentSet({
    root: paths.root,
    journalName: TREND_PUBLICATION_JOURNAL,
    documents: [
      { path: runPath, value: run },
      { path: paths.latestRun, value: run }
    ]
  });
  return runPath;
}

export async function writeTrendRun(run, options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const paths = resolveTrendDataPaths(options);
  return withTrendStoreLock(paths, options, () =>
    writeTrendRunUnlocked(run, paths)
  );
}

export async function readLatestTrendRun(options = {}) {
  const paths = resolveTrendDataPaths(options);
  return readJsonDocumentSetPointer(
    paths.root,
    TREND_PUBLICATION_JOURNAL,
    paths.latestRun,
    null
  );
}

export async function readTrendSelection(options = {}) {
  const paths = resolveTrendDataPaths(options);
  return readJsonDocumentSetPointer(
    paths.root,
    TREND_PUBLICATION_JOURNAL,
    paths.selection,
    null
  );
}

export async function selectTrendCandidate(candidateId, note = "", options = {}) {
  assertNoDurableJsonStoreHooks(options);
  const paths = resolveTrendDataPaths(options);
  return withTrendStoreLock(paths, options, async () => {
    const run = await readJsonDocumentSetPointer(
      paths.root,
      TREND_PUBLICATION_JOURNAL,
      paths.latestRun,
      null
    );
    if (!run) throw new Error("还没有热点发现运行结果");
    const candidate = run.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new Error(`找不到候选概念：${candidateId}`);
    if (candidate.recommendedPool !== "formal_candidate") {
      throw new Error(`候选概念 ${candidate.concept} 还没有通过正式候选门槛`);
    }

    const selectedAt = new Date().toISOString();
    run.candidates = run.candidates.map((item) => ({
      ...item,
      selectionStatus: item.id === candidateId ? "selected_for_research" : "not_selected"
    }));
    run.selectedCandidateId = candidateId;
    run.selectedAt = selectedAt;
    const selection = {
      schemaVersion: 1,
      selectedAt,
      runId: run.id,
      candidateId,
      episodeId: `${candidate.id}-${selectedAt.slice(0, 10).replaceAll("-", "")}`,
      concept: candidate.concept,
      recommendedTitle: candidate.recommendedTitle,
      productDecisions: candidate.productDecisions,
      primarySources: candidate.primarySources,
      creatorEvidence: candidate.creatorEvidence,
      evidenceSignals: candidate.evidenceSignals,
      note,
      nextStep: "research-agent"
    };
    const runPath = resolve(paths.runs, `${run.id}.json`);
    await publishJsonDocumentSet({
      root: paths.root,
      journalName: TREND_PUBLICATION_JOURNAL,
      documents: [
        { path: runPath, value: run },
        { path: paths.latestRun, value: run },
        { path: paths.selection, value: selection }
      ]
    });
    return { run, selection };
  });
}
