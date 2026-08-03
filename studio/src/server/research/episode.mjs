import { PIPELINE_DEFINITIONS } from "../../shared/schema.mjs";
import { readEpisode, writeEpisode } from "../../shared/store.mjs";

export function buildEpisodeFromTrendSelection(selection, now = new Date()) {
  const createdAt = now.toISOString();
  return {
    schemaVersion: 1,
    id: selection.episodeId,
    title: selection.recommendedTitle,
    concept: selection.concept,
    conceptId: selection.candidateId,
    audience: "理解 AI 基础概念、关注产品落地的 AI 产品经理及技术邻近人群",
    thesis: `围绕“${selection.concept}”验证定义、机制、边界与产品决策影响。`,
    status: "researching",
    createdAt,
    updatedAt: createdAt,
    previewMode: "production-draft",
    approvals: {
      topic: { status: "approved", at: selection.selectedAt, note: selection.note || "" },
      facts: { status: "pending", at: null },
      script: { status: "pending", at: null },
      visual: { status: "pending", at: null },
      voice: { status: "pending", at: null },
      final: { status: "pending", at: null }
    },
    pipeline: PIPELINE_DEFINITIONS.map((definition) => ({
      ...definition,
      status:
        definition.id === "trend"
          ? "complete"
          : definition.id === "research"
            ? "ready"
            : "pending",
      mode: definition.id === "trend" ? "selected-from-trend-radar" : null,
      lastRunAt: definition.id === "trend" ? selection.selectedAt : null,
      message:
        definition.id === "trend"
          ? "已从正式候选中人工选定"
          : definition.id === "research"
            ? "可以建立一手资料与事实证据包"
            : "等待上一步完成"
    })),
    trendSelection: {
      runId: selection.runId,
      candidateId: selection.candidateId,
      selectedAt: selection.selectedAt,
      note: selection.note || "",
      productDecisions: selection.productDecisions,
      primarySources: selection.primarySources,
      creatorEvidence: selection.creatorEvidence,
      evidenceSignals: selection.evidenceSignals
    },
    research: {
      status: "pending",
      packPath: null,
      assistTaskPath: null,
      readiness: {
        readyForFactApproval: false,
        verifiedSourceCount: 0,
        supportedClaimCount: 0,
        reasons: ["尚未运行研究 Agent"]
      }
    },
    sourceDocs: [],
    assets: [],
    voice: {
      status: "unconfigured",
      mode: null,
      audioPath: null,
      note: "正式样片必须先选择并批准旁白方案。"
    },
    render: {
      width: 540,
      height: 960,
      fps: 15,
      durationSeconds: null,
      compositionId: "ConceptPreview",
      outputPath: null,
      status: "pending",
      progress: 0,
      renderedAt: null,
      muted: true
    },
    scenes: [],
    subtitles: [],
    qa: {
      status: "pending",
      reportPath: null,
      checks: [],
      checkedAt: null
    },
    history: [
      {
        at: createdAt,
        type: "trend-selection",
        message: `从热点雷达选择“${selection.concept}”并创建一期草稿`
      }
    ],
    system: {
      studioRoot: "studio",
      createdBy: "trend-selection-v0.1"
    }
  };
}

export async function createEpisodeFromTrendSelection(selection, options = {}) {
  try {
    return await readEpisode(selection.episodeId);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const episode = buildEpisodeFromTrendSelection(
    selection,
    options.now instanceof Date ? options.now : new Date(options.now ?? Date.now())
  );
  await writeEpisode(episode);
  return episode;
}
