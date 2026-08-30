import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
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

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonOr(path, fallback) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
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
  return readJsonOr(paths.signals, {
    schemaVersion: 1,
    updatedAt: null,
    importedSnapshots: [],
    signals: []
  });
}

export async function importTrendSnapshot(snapshotPath, options = {}) {
  const paths = resolveTrendDataPaths(options);
  const [snapshot, sources, taxonomy, current] = await Promise.all([
    readJson(snapshotPath),
    readTrendSources(),
    readConceptTaxonomy(),
    readTrendSignals(options)
  ]);
  const creatorIds = new Set(sources.creators.map((creator) => creator.id));
  const conceptIds = new Set(taxonomy.concepts.map((concept) => concept.id));
  const errors = [];
  for (const signal of snapshot.signals ?? []) {
    const validation = validateSignal(signal, creatorIds, conceptIds);
    errors.push(...validation.errors);
  }
  if (errors.length > 0) throw new Error(errors.join("; "));

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
  await mkdir(paths.root, { recursive: true });
  await writeJsonAtomic(paths.signals, document);
  return {
    snapshotId: snapshot.snapshotId,
    imported: snapshot.signals?.length ?? 0,
    total: document.signals.length,
    document
  };
}

export async function appendTrendSignal(signal, options = {}) {
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
  const paths = resolveTrendDataPaths(options);
  const [sources, taxonomy, current] = await Promise.all([
    readTrendSources(),
    readConceptTaxonomy(),
    readTrendSignals(options)
  ]);
  const creatorIds = new Set(sources.creators.map((creator) => creator.id));
  const conceptIds = new Set(taxonomy.concepts.map((concept) => concept.id));
  const errors = [];
  for (const signal of signals) {
    const validation = validateSignal(signal, creatorIds, conceptIds);
    errors.push(...validation.errors);
  }
  if (errors.length > 0) throw new Error(errors.join("; "));

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
  await writeJsonAtomic(paths.signals, document);
  return { document, added, updated, unchanged };
}

export async function writeTrendRun(run, options = {}) {
  const paths = resolveTrendDataPaths(options);
  await mkdir(paths.runs, { recursive: true });
  const runPath = resolve(paths.runs, `${run.id}.json`);
  await writeJsonAtomic(runPath, run);
  await writeJsonAtomic(paths.latestRun, run);
  return runPath;
}

export async function readLatestTrendRun(options = {}) {
  const paths = resolveTrendDataPaths(options);
  return readJsonOr(paths.latestRun, null);
}

export async function selectTrendCandidate(candidateId, note = "", options = {}) {
  const paths = resolveTrendDataPaths(options);
  const run = await readLatestTrendRun(options);
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
  await writeTrendRun(run, options);

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
  await writeJsonAtomic(paths.selection, selection);
  return { run, selection };
}
