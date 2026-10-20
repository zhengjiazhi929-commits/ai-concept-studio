// Internal factory for isolated tests. Production uses the sealed manual-selection wrapper.
import { resolve } from "node:path";
import {
  canonicalJsonDocumentContentSha256 as hash,
  readJsonDocumentOr,
  withDurableJsonStoreLock,
  writeImmutableJsonDocument,
  publishJsonDocumentSet,
  recoverJsonDocumentSet
} from "../../shared/durable-json-store.mjs";
import { ensureAgentArchitecture } from "../../shared/agent-contracts.mjs";
import { validateEpisode } from "../../shared/schema.mjs";
import { manualTopicCapabilitySpec, manualTopicDecisionId, manualTopicError, MANUAL_TOPIC_OPERATION, validateManualTopicRequest } from "../../shared/manual-topic-decision.mjs";
import { requireSideEffectGrant } from "../security/side-effect-capability.mjs";
import { buildEpisodeFromTrendSelection } from "../research/episode.mjs";
import { readLatestTrendRun, readTrendSignals, readTrendSelection } from "./store.mjs";

const journal = ".trend-publication.json";
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u;
const fail = (code, message) => {throw manualTopicError(code, message);};

function selectionFromDecision(request, snapshot, selectedAt) {
  const candidate = snapshot.run.candidates.find((item) => item.id === request.candidateId);
  const decisionId = manualTopicDecisionId(request);
  return {
    schemaVersion: 1, selectionMode: "manual", selectedAt, runId: request.runId,
    candidateId: request.candidateId, episodeId: `${request.candidateId}-manual-${decisionId.slice(0, 16)}`,
    concept: candidate.concept, recommendedTitle: candidate.recommendedTitle,
    productDecisions: candidate.productDecisions ?? [], primarySources: candidate.primarySources ?? [],
    creatorEvidence: candidate.creatorEvidence ?? [], evidenceSignals: candidate.evidenceSignals ?? [],
    note: request.reason, nextStep: "research-agent",
    manualDecision: {
      decisionId, actor: request.actor, reason: request.reason,
      authorityBasis: "explicit-local-cli-confirmation", snapshotHash: request.snapshotHash,
      originalPool: candidate.recommendedPool, originalScore: candidate.score,
      radarGeneratedAt: snapshot.run.generatedAt,
      evidenceCoverage: snapshot.evidenceCoverage,
      automaticThresholdPassed: candidate.recommendedPool === "formal_candidate"
    }
  };
}

function buildManualEpisode(selection) {
  const episode = buildEpisodeFromTrendSelection(selection, new Date(selection.selectedAt));
  episode.trendSelection = {
    ...episode.trendSelection, selectionMode: "manual", manualDecision: structuredClone(selection.manualDecision)
  };
  const trendStep = episode.pipeline.find((step) => step.id === "trend");
  trendStep.mode = "manually-specified-topic";
  trendStep.message = "用户人工指定选题；原始热度证据保留，不代表自动热度门槛达标";
  episode.history[0] = {
    at: selection.selectedAt, type: "manual-topic-selection", actor: selection.manualDecision.actor,
    decisionId: selection.manualDecision.decisionId,
    message: `人工指定“${selection.concept}”并创建研究草稿；${selection.note}`
  };
  episode.system.createdBy = "manual-topic-selection-v1";
  return ensureAgentArchitecture(episode);
}

export function createManualSelectionService({trendsRoot, readEpisode, writeEpisode, listEpisodes}) {
  const root = resolve(trendsRoot);
  const storeOptions = {trendsRoot: root};

  async function readSnapshot(candidateId) {
    if (typeof candidateId !== "string" || !idPattern.test(candidateId)) fail("manual_topic_request_invalid", "候选 ID 无效");
    const run = await readLatestTrendRun(storeOptions);
    const candidate = run?.candidates?.find((item) => item.id === candidateId);
    if (!candidate || typeof candidate.concept !== "string" || !candidate.concept.trim() ||
      typeof candidate.recommendedTitle !== "string" || !candidate.recommendedTitle.trim()) {
      fail("manual_topic_candidate_missing", "当前 Radar 中找不到可研究的候选");
    }
    if (!["observation_pool", "continue_watching", "formal_candidate"].includes(candidate.recommendedPool) ||
      candidate.productionState && candidate.productionState !== "new") {
      fail("manual_topic_already_in_production", "候选已覆盖或已有生产任务，不重复创建");
    }
    const signalDocument = await readTrendSignals(storeOptions);
    const summaries = candidate.evidenceSignals;
    if (!Array.isArray(summaries) || !summaries.length || new Set(summaries.map((item) => item.id)).size !== summaries.length) {
      fail("manual_topic_evidence_missing", "候选缺少可绑定的原始证据");
    }
    const signals = summaries.map((summary) => {
      const matches = signalDocument.signals.filter((item) => item.id === summary.id);
      if (matches.length !== 1) fail("manual_topic_evidence_missing", "原始信号缺失或重复，需重新核验");
      const signal = matches[0];
      if (["creatorId", "title", "sourceUrl", "publishedAt", "datePrecision"].some((field) => signal[field] !== summary[field]) ||
        !signal.conceptIds?.includes(candidateId)) {
        fail("manual_topic_snapshot_changed", "原始信号与 Radar 摘要不一致，需重新预览");
      }
      return structuredClone(signal);
    });
    return {
      schemaVersion: 1, run, signals,
      evidenceCoverage: {
        kind: "radar-displayed-evidence-signals", includedCount: signals.length,
        radarSignalCount: candidate.signalCount ?? null,
        note: "保留 Radar 展示的最多 10 条信号的完整原始记录；不声称覆盖全部作品或全部窗口信号"
      }
    };
  }

  async function previewManualTopic(candidateId) {
    const snapshot = await readSnapshot(candidateId);
    return {
      runId: snapshot.run.id, snapshotHash: hash(snapshot),
      candidate: snapshot.run.candidates.find((item) => item.id === candidateId),
      radarGeneratedAt: snapshot.run.generatedAt, evidenceCoverage: snapshot.evidenceCoverage,
      warning: "人工指定不等于自动热度达标；创建研究草稿不批准任何生产 gate"
    };
  }

  async function approveManualTopic(input, options = {}) {
    const request = validateManualTopicRequest(input);
    // The actual sink and subject are derived from the full request, never caller overrides.
    requireSideEffectGrant(options, manualTopicCapabilitySpec(request), MANUAL_TOPIC_OPERATION);
    const decisionId = manualTopicDecisionId(request);
    const decisionPath = resolve(root, "manual-selections", `${decisionId}.json`);
    return withDurableJsonStoreLock(root, {}, async () => {
      await recoverJsonDocumentSet(root, journal);
      let record = await readJsonDocumentOr(decisionPath, null, {storeRoot: root});
      if (!record) {
        const snapshot = await readSnapshot(request.candidateId);
        if (snapshot.run.id !== request.runId || hash(snapshot) !== request.snapshotHash) {
          fail("manual_topic_snapshot_changed", "选题或证据已变化，请重新预览并确认");
        }
        if ((await listEpisodes()).some((episode) => episode.conceptId === request.candidateId)) {
          fail("manual_topic_already_in_production", "该概念已有 Episode，拒绝重复创建");
        }
        const previous = await readTrendSelection(storeOptions);
        if (previous?.candidateId === request.candidateId) {
          fail("manual_topic_already_in_production", "已有同概念选题预留，不能在其 Episode 创建期间重复选择");
        }
        record = {
          schemaVersion: 1, decisionId, request, snapshot,
          previousSelectionHash: hash(previous), createdAt: new Date().toISOString()
        };
        record.selection = selectionFromDecision(request, snapshot, record.createdAt);
        // The immutable intent is durable before Episode CAS. Retry resumes this exact intent.
        await writeImmutableJsonDocument(decisionPath, record, {storeRoot: root});
      } else if (record.decisionId !== decisionId || hash(record.request) !== hash(request) ||
        hash(record.snapshot) !== request.snapshotHash || record.snapshot.run.id !== request.runId ||
        !Number.isFinite(Date.parse(record.createdAt)) ||
        hash(record.selection) !== hash(selectionFromDecision(request, record.snapshot, record.createdAt))) {
        fail("manual_topic_decision_conflict", "已记录决定与请求不一致，停止恢复");
      }

      const selection = record.selection;
      let episode = null;
      try {episode = await readEpisode(selection.episodeId);} catch (error) {if (error.code !== "ENOENT") throw error;}
      if (episode && (episode.id !== selection.episodeId || episode.conceptId !== request.candidateId ||
        hash(episode.trendSelection) !== hash(buildManualEpisode(selection).trendSelection))) {
        fail("manual_topic_episode_conflict", "目标 Episode 不属于该决定，禁止覆盖");
      }
      const pointer = await readTrendSelection(storeOptions);
      const pointerMatches = pointer?.manualDecision?.decisionId === decisionId;
      if (pointerMatches && hash(pointer) !== hash(selection)) {
        fail("manual_topic_selection_conflict", "选题指针与不可变决定不一致，停止恢复");
      }
      if (!pointerMatches && hash(pointer) !== record.previousSelectionHash) {
        if (episode) return {status: "committed_selection_superseded", episodeId: episode.id, decisionPath, selection};
        fail("manual_topic_selection_changed", "当前选题已被另一次决定替换，停止旧请求");
      }
      const existed = Boolean(episode);
      if (!episode) {
        if ((await listEpisodes(selection.episodeId)).some((item) => item.conceptId === request.candidateId)) {
          fail("manual_topic_already_in_production", "恢复前发现同概念已有 Episode，停止重复创建");
        }
        episode = buildManualEpisode(selection);
        const validation = validateEpisode(episode);
        if (!validation.valid) fail("manual_topic_episode_invalid", "研究草稿未通过 Episode 合同校验");
        await writeEpisode(episode);
      }
      // Episode is authoritative. This pointer is derived state; publishing failure
      // cannot roll it back, and retry must never rewrite later Episode progress.
      if (!pointerMatches) {
        try {
          await publishJsonDocumentSet({root, journalName: journal, documents: [{path: resolve(root, "selection.json"), value: selection}]});
        } catch (error) {
          return {status: "committed_with_warning", episodeId: episode.id, decisionPath, selection, warning: "selection_pointer_pending", errorCode: error.code ?? "publication_failed"};
        }
      }
      return {status: existed ? "already_committed" : "committed", episodeId: episode.id, decisionPath, selection};
    });
  }

  return Object.freeze({previewManualTopic, approveManualTopic});
}
