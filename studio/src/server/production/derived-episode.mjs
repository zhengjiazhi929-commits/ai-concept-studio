import { PIPELINE_DEFINITIONS, validateEpisode } from "../../shared/schema.mjs";
import {
  createApprovalMap,
  currentGateArtifactHash
} from "../../shared/workflow.mjs";
import {
  createControlState,
  createReviewMap,
  ensureAgentArchitecture
} from "../../shared/agent-contracts.mjs";
import { approvalValidForGate } from "../control/policy-engine.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
import { integrityHash } from "../../shared/integrity.mjs";
import { SHORT_EXPLAINER_PROFILE_ID } from "../../shared/production-profiles.mjs";

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function approvedSourceSections(parentEpisode, sourceSectionIds) {
  const sections = parentEpisode.production?.scriptDraft?.content?.sections;
  if (!Array.isArray(sections)) throw new Error("父 Episode 缺少已批准的结构化脚本");
  if (!Array.isArray(sourceSectionIds) || sourceSectionIds.length === 0) {
    throw new Error("派生 Episode 至少需要一个已批准脚本段落");
  }
  return sourceSectionIds.map((sectionId) => {
    const section = sections.find((item) => item.id === sectionId);
    if (!section) throw new Error(`父 Episode 的已批准脚本中没有段落：${sectionId}`);
    return structuredClone(section);
  });
}

export function buildDerivedShortEpisode(parentSource, options = {}) {
  const parentEpisode = ensureAgentArchitecture(parentSource);
  if (!approvalValidForGate(parentEpisode, "research")) {
    throw new Error("父 Episode 的研究证据没有有效的机器审核与人工批准绑定");
  }
  if (!approvalValidForGate(parentEpisode, "script")) {
    throw new Error("父 Episode 的源脚本没有有效的机器审核与人工批准绑定");
  }

  const id = String(options.id ?? "").trim();
  if (!/^[a-z0-9-]+$/u.test(id)) throw new Error("派生 Episode id 无效");
  const createdAt = timestamp(options.now);
  const sourceSections = approvedSourceSections(parentEpisode, options.sourceSectionIds);
  const researchArtifactHash = currentGateArtifactHash(parentEpisode, "research");
  const scriptArtifactHash = currentGateArtifactHash(parentEpisode, "script");
  const inheritedResearchApproval = structuredClone(parentEpisode.approvals.research);
  inheritedResearchApproval.history = inheritedResearchApproval.history.map((record) => ({
    ...record,
    inheritedFromEpisodeId: parentEpisode.id
  }));

  const episode = ensureAgentArchitecture({
    schemaVersion: 1,
    id,
    title: options.title ?? `60 秒讲清：${sourceSections.map((item) => item.heading).join("、")}`,
    concept: parentEpisode.concept,
    conceptId: parentEpisode.conceptId,
    audience: parentEpisode.audience,
    thesis:
      options.thesis ??
      "在不改变已批准事实和概念关系的前提下，用 60 秒准确讲清 Skill、Tool 与 MCP 的职责边界。",
    status: "in_production",
    createdAt,
    updatedAt: createdAt,
    previewMode: "production-short",
    productionProfile: {
      id: SHORT_EXPLAINER_PROFILE_ID,
      targetDurationSeconds: 60
    },
    derivation: {
      kind: "approved-script-section-v1",
      parentEpisodeId: parentEpisode.id,
      parentResearchVersion: parentEpisode.research?.version ?? null,
      parentResearchArtifactHash: researchArtifactHash,
      parentResearchReviewReportId: parentEpisode.approvals.research.reviewReportId,
      parentScriptVersion: parentEpisode.production?.scriptDraft?.version ?? null,
      parentScriptArtifactHash: scriptArtifactHash,
      parentScriptReviewReportId: parentEpisode.approvals.script.reviewReportId,
      sourceSectionIds: sourceSections.map((item) => item.id),
      sourceSections,
      constraints: [
        "只允许压缩、重排或澄清已批准脚本，不得新增未经研究支持的事实",
        "不得为了视觉风格发明会改变脚本含义的比喻",
        "新的脚本、分镜、素材与成片必须分别重新经过机器审核和人工 Gate"
      ],
      sourceSnapshotHash: integrityHash({
        parentEpisodeId: parentEpisode.id,
        researchArtifactHash,
        scriptArtifactHash,
        sourceSections
      }),
      createdAt
    },
    approvals: createApprovalMap({ research: inheritedResearchApproval }),
    approvalHistory: (parentEpisode.approvalHistory ?? [])
      .filter((record) => record.gate === "research" && record.decision === "approved")
      .map((record) => ({ ...structuredClone(record), inheritedFromEpisodeId: parentEpisode.id })),
    pipeline: PIPELINE_DEFINITIONS.map((definition) => {
      if (definition.id === "trend") {
        return {
          ...definition,
          status: "complete",
          mode: "derived-from-approved-episode",
          lastRunAt: createdAt,
          message: `派生自 ${parentEpisode.id}`
        };
      }
      if (definition.id === "research") {
        return {
          ...definition,
          status: "complete",
          mode: "inherited-unchanged-approved-artifact",
          lastRunAt: createdAt,
          message: `继承 ${parentEpisode.id} 已批准且内容未改变的研究 v${parentEpisode.research.version}`
        };
      }
      if (definition.id === "script") {
        return {
          ...definition,
          status: "ready",
          mode: null,
          lastRunAt: null,
          message: "可以由 Script Agent 生成新的 60 秒候选脚本"
        };
      }
      return {
        ...definition,
        status: "pending",
        mode: null,
        lastRunAt: null,
        message: "等待上一步及人工 Gate"
      };
    }),
    trendSelection: structuredClone(parentEpisode.trendSelection ?? null),
    research: structuredClone(parentEpisode.research),
    sourceDocs: structuredClone(parentEpisode.sourceDocs ?? []),
    assets: [],
    production: {
      ai: { requestCount: 0, attempts: [] },
      feedback: {},
      quality: {}
    },
    voice: {
      status: "unconfigured",
      mode: null,
      audioPath: null,
      note: "短样片仍需在素材与声音人工 Gate 前上传并核验旁白。"
    },
    render: {
      width: 540,
      height: 960,
      fps: 30,
      durationSeconds: null,
      compositionId: "ConceptPreview",
      outputPath: null,
      status: "pending",
      progress: 0,
      renderedAt: null,
      muted: false
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
        type: "derived-episode-created",
        message: `从 ${parentEpisode.id} 的已批准段落 ${sourceSections.map((item) => item.id).join("、")} 创建 60 秒派生 Episode`
      }
    ],
    system: {
      studioRoot: "studio",
      createdBy: "derived-episode-workflow-v1"
    },
    control: createControlState({
      mode: "shadow",
      reviewEnabled: true,
      modelRouterEnabled: false,
      mainAgentEnabled: false,
      fixedFallbackEnabled: true,
      allowedTools: []
    }),
    reviews: createReviewMap({ research: structuredClone(parentEpisode.reviews.research) }),
    planHistory: [],
    routingHistory: [],
    dispatchHistory: [],
    evaluationHistory: [],
    reviewCheckpoints: {}
  });

  if (currentGateArtifactHash(episode, "research") !== researchArtifactHash) {
    throw new Error("派生 Episode 改变了继承研究证据的内容哈希");
  }
  if (!approvalValidForGate(episode, "research")) {
    throw new Error("派生 Episode 的继承研究批准未能通过 Policy Engine 校验");
  }
  const validation = validateEpisode(episode);
  if (!validation.valid) throw new Error(`派生 Episode 合同无效：${validation.errors.join("；")}`);
  return episode;
}

export async function createDerivedShortEpisode(parentEpisodeId, options = {}) {
  try {
    const existing = await readEpisode(options.id);
    if (
      existing.derivation?.parentEpisodeId !== parentEpisodeId ||
      existing.productionProfile?.id !== SHORT_EXPLAINER_PROFILE_ID
    ) {
      throw new Error(`Episode ${options.id} 已存在，但不是指定父 Episode 的短样片`);
    }
    return { episode: existing, created: false };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const parentEpisode = await readEpisode(parentEpisodeId);
  const episode = buildDerivedShortEpisode(parentEpisode, options);
  await writeEpisode(episode);
  await appendEvent({
    type: "episode.derived_created",
    episodeId: episode.id,
    parentEpisodeId,
    message: `已创建独立 60 秒派生 Episode，研究 Gate 继承未变批准，脚本及下游 Gate 全部重新开始`
  });
  return { episode: await readEpisode(episode.id), created: true };
}
