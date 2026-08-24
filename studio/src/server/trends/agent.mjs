import { resolve } from "node:path";
import { trendSnapshotsRoot } from "../../shared/paths.mjs";
import { appendEvent, listEpisodes } from "../../shared/store.mjs";
import { requireSideEffectGrant } from "../security/side-effect-capability.mjs";
import { createEpisodeFromTrendSelection } from "../research/episode.mjs";
import { normalizeSearchText } from "./schema.mjs";
import { discoverTrendCandidates } from "./engine.mjs";
import {
  appendTrendSignal,
  importTrendSnapshot,
  readConceptTaxonomy,
  readLatestTrendRun,
  readTrendRadarConfig,
  readTrendSignals,
  readTrendSources,
  selectTrendCandidate,
  writeTrendRun
} from "./store.mjs";

const DEFAULT_SNAPSHOT = resolve(trendSnapshotsRoot, "2026-08-03-public-signal-snapshot.json");

const trendSideEffectDependencyNames = Object.freeze([
  "appendEvent",
  "importTrendSnapshot",
  "listEpisodes",
  "readConceptTaxonomy",
  "readTrendRadarConfig",
  "readTrendSignals",
  "readTrendSources",
  "writeTrendRun"
]);

function trendDependencies(options = {}) {
  const injected = options.dependencies ?? {};
  const defaults = {
    appendEvent,
    importTrendSnapshot,
    listEpisodes,
    readConceptTaxonomy,
    readTrendRadarConfig,
    readTrendSignals,
    readTrendSources,
    writeTrendRun
  };
  return {
    values: Object.fromEntries(
      trendSideEffectDependencyNames.map((name) => [name, injected[name] ?? defaults[name]])
    ),
    fullyInjected: trendSideEffectDependencyNames.every(
      (name) => typeof injected[name] === "function"
    )
  };
}

function requireTrendSideEffects(options, fullyInjected, operation, scopes) {
  // Test-only seam: every side-effect dependency must be injected, and an
  // explicit capability requirement always wins. Default/HTTP paths cannot
  // enter this branch because at least one production dependency remains.
  if (fullyInjected && options.requireSideEffectCapability !== true) return null;
  return requireSideEffectGrant(options, {
    episodeId: options.episodeId ?? "studio",
    operation: options.capabilityOperation ?? operation,
    scopes,
    maxCalls: 0,
    maxCostUsd: 0
  });
}

async function ensureDefaultTrendSignalsWith(dependencies) {
  const current = await dependencies.readTrendSignals();
  if (current.signals.length > 0) return { imported: 0, total: current.signals.length };
  return dependencies.importTrendSnapshot(DEFAULT_SNAPSHOT);
}

export async function ensureDefaultTrendSignals(options = {}) {
  const { values: dependencies, fullyInjected } = trendDependencies(options);
  requireTrendSideEffects(
    options,
    fullyInjected,
    "trend:ensure-default-signals",
    ["filesystem.write"]
  );
  return ensureDefaultTrendSignalsWith(dependencies);
}

export async function runTrendRadarAgent(options = {}) {
  const { values: dependencies, fullyInjected } = trendDependencies(options);
  requireTrendSideEffects(
    options,
    fullyInjected,
    "trend:run",
    ["state.write", "filesystem.write"]
  );
  await dependencies.appendEvent({
    type: "agent.started",
    agentId: "trend-radar-agent",
    message: "热点概念发现开始运行"
  });
  try {
    await ensureDefaultTrendSignalsWith(dependencies);
    const [signalDocument, sources, taxonomy, config, episodes] = await Promise.all([
      dependencies.readTrendSignals(),
      dependencies.readTrendSources(),
      dependencies.readConceptTaxonomy(),
      dependencies.readTrendRadarConfig(),
      dependencies.listEpisodes()
    ]);
    const coveredConceptIds = episodes
      .map((episode) => {
        if (episode.conceptId) return episode.conceptId;
        const episodeConcept = normalizeSearchText(episode.concept);
        return taxonomy.concepts.find(
          (concept) =>
            normalizeSearchText(concept.name) === episodeConcept ||
            concept.aliases.some((alias) => normalizeSearchText(alias) === episodeConcept)
        )?.id;
      })
      .filter(Boolean);
    const result = discoverTrendCandidates({
      signals: signalDocument.signals,
      sources,
      taxonomy,
      config,
      coveredConceptIds,
      now: options.now ?? new Date()
    });
    const run = {
      schemaVersion: 1,
      id: `trend-${result.generatedAt.replaceAll(/[:.]/gu, "-")}`,
      agentId: "trend-radar-agent",
      status: "complete",
      generatedAt: result.generatedAt,
      sourceSnapshotIds: signalDocument.importedSnapshots,
      selectedCandidateId: null,
      selectedAt: null,
      ...result
    };
    const runPath = await dependencies.writeTrendRun(run);
    await dependencies.appendEvent({
      type: "agent.finished",
      agentId: "trend-radar-agent",
      status: "complete",
      message: `热点概念发现完成：${run.summary.formalCandidateCount} 个正式候选`
    });
    return { run, runPath };
  } catch (error) {
    await dependencies.appendEvent({
      type: "agent.failed",
      agentId: "trend-radar-agent",
      message: error instanceof Error ? error.message : "热点概念发现失败"
    });
    throw error;
  }
}

export async function getTrendRadarState() {
  const [run, signalDocument, sources] = await Promise.all([
    readLatestTrendRun(),
    readTrendSignals(),
    readTrendSources()
  ]);
  return {
    run,
    signalSummary: {
      count: signalDocument.signals.length,
      updatedAt: signalDocument.updatedAt,
      importedSnapshots: signalDocument.importedSnapshots
    },
    sourceSummary: {
      enabled: sources.creators.filter((creator) => creator.enabled !== false).length,
      platforms: Array.from(new Set(sources.creators.map((creator) => creator.platform)))
    }
  };
}

export async function approveTrendCandidate(candidateId, note = "", options = {}) {
  const injected = options.dependencies ?? {};
  const fullyInjected = [
    "appendEvent",
    "createEpisodeFromTrendSelection",
    "selectTrendCandidate"
  ].every((name) => typeof injected[name] === "function");
  requireTrendSideEffects(
    options,
    fullyInjected,
    "trend:approve-candidate",
    ["state.write", "filesystem.write"]
  );
  const selectCandidate = injected.selectTrendCandidate ?? selectTrendCandidate;
  const createEpisode = injected.createEpisodeFromTrendSelection ?? createEpisodeFromTrendSelection;
  const recordEvent = injected.appendEvent ?? appendEvent;
  const result = await selectCandidate(candidateId, note);
  const episode = await createEpisode(result.selection);
  await recordEvent({
    type: "trend.candidate-selected",
    agentId: "trend-radar-agent",
    candidateId,
    message: `已选择 ${result.selection.concept} 进入研究阶段`
  });
  return { ...result, episode };
}

export async function ingestTrendSignal(signal, options = {}) {
  const injected = options.dependencies ?? {};
  const fullyInjected = ["appendEvent", "appendTrendSignal"].every(
    (name) => typeof injected[name] === "function"
  );
  requireTrendSideEffects(
    options,
    fullyInjected,
    "trend:ingest-signal",
    ["state.write", "filesystem.write"]
  );
  const appendSignal = injected.appendTrendSignal ?? appendTrendSignal;
  const recordEvent = injected.appendEvent ?? appendEvent;
  const document = await appendSignal(signal);
  await recordEvent({
    type: "trend.signal-ingested",
    agentId: "trend-radar-agent",
    signalId: signal.id,
    creatorId: signal.creatorId,
    message: `已写入创作者信号：${signal.title}`
  });
  return {
    signal,
    signalSummary: {
      count: document.signals.length,
      updatedAt: document.updatedAt
    }
  };
}
