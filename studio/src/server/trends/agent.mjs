import { resolve } from "node:path";
import { trendSnapshotsRoot } from "../../shared/paths.mjs";
import { appendEvent, listEpisodes } from "../../shared/store.mjs";
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

export async function ensureDefaultTrendSignals() {
  const current = await readTrendSignals();
  if (current.signals.length > 0) return { imported: 0, total: current.signals.length };
  return importTrendSnapshot(DEFAULT_SNAPSHOT);
}

export async function runTrendRadarAgent(options = {}) {
  await appendEvent({
    type: "agent.started",
    agentId: "trend-radar-agent",
    message: "热点概念发现开始运行"
  });
  try {
    await ensureDefaultTrendSignals();
    const [signalDocument, sources, taxonomy, config, episodes] = await Promise.all([
      readTrendSignals(),
      readTrendSources(),
      readConceptTaxonomy(),
      readTrendRadarConfig(),
      listEpisodes()
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
    const runPath = await writeTrendRun(run);
    await appendEvent({
      type: "agent.finished",
      agentId: "trend-radar-agent",
      status: "complete",
      message: `热点概念发现完成：${run.summary.formalCandidateCount} 个正式候选`
    });
    return { run, runPath };
  } catch (error) {
    await appendEvent({
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

export async function approveTrendCandidate(candidateId, note = "") {
  const result = await selectTrendCandidate(candidateId, note);
  await appendEvent({
    type: "trend.candidate-selected",
    agentId: "trend-radar-agent",
    candidateId,
    message: `已选择 ${result.selection.concept} 进入研究阶段`
  });
  return result;
}

export async function ingestTrendSignal(signal) {
  const document = await appendTrendSignal(signal);
  await appendEvent({
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
