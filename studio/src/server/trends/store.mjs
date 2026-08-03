import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  conceptTaxonomyPath,
  trendLatestRunPath,
  trendRadarConfigPath,
  trendRunsRoot,
  trendSelectionPath,
  trendSignalsPath,
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

export async function readTrendSignals() {
  return readJsonOr(trendSignalsPath, {
    schemaVersion: 1,
    updatedAt: null,
    importedSnapshots: [],
    signals: []
  });
}

export async function importTrendSnapshot(snapshotPath) {
  const [snapshot, sources, taxonomy, current] = await Promise.all([
    readJson(snapshotPath),
    readTrendSources(),
    readConceptTaxonomy(),
    readTrendSignals()
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
  await mkdir(trendsDataRoot, { recursive: true });
  await writeJsonAtomic(trendSignalsPath, document);
  return {
    snapshotId: snapshot.snapshotId,
    imported: snapshot.signals?.length ?? 0,
    total: document.signals.length,
    document
  };
}

export async function appendTrendSignal(signal) {
  const result = await upsertTrendSignals([signal]);
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
  const [sources, taxonomy, current] = await Promise.all([
    readTrendSources(),
    readConceptTaxonomy(),
    readTrendSignals()
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
  await writeJsonAtomic(trendSignalsPath, document);
  return { document, added, updated, unchanged };
}

export async function writeTrendRun(run) {
  await mkdir(trendRunsRoot, { recursive: true });
  const runPath = resolve(trendRunsRoot, `${run.id}.json`);
  await writeJsonAtomic(runPath, run);
  await writeJsonAtomic(trendLatestRunPath, run);
  return runPath;
}

export async function readLatestTrendRun() {
  return readJsonOr(trendLatestRunPath, null);
}

export async function selectTrendCandidate(candidateId, note = "") {
  const run = await readLatestTrendRun();
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
  await writeTrendRun(run);

  const selection = {
    schemaVersion: 1,
    selectedAt,
    runId: run.id,
    candidateId,
    concept: candidate.concept,
    recommendedTitle: candidate.recommendedTitle,
    note,
    nextStep: "research-agent"
  };
  await writeJsonAtomic(trendSelectionPath, selection);
  return { run, selection };
}
