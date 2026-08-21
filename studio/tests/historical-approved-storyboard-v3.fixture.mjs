import { ensureAgentArchitecture } from "../src/shared/agent-contracts.mjs";
import { PIPELINE_DEFINITIONS } from "../src/shared/schema.mjs";
import {
  createApprovalMap,
  currentGateArtifactHash
} from "../src/shared/workflow.mjs";

export const HISTORICAL_SHORT_EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";

const STORYBOARD_VERSION = 3;
const STORYBOARD_REVIEW_ID =
  "review-storyboard-v3-4-2026-08-13T07-44-58-746Z";
const SOURCE_SNAPSHOT_HASH =
  "3639d4707a1798cc276b4c0fa3924fd3da2dae9c37f168541e41fb3fa1c952e4";
const SOURCE_SCRIPT_HASH =
  "d920c44f9a5d743a99638902069d993a06115ac2f780dbdab25a71f5e77ef8c2";
const SOURCE_SCRIPT_REVIEW_ID =
  "review-script-v2-3-2026-08-13T05-42-41-327Z";
const APPROVED_AT = "2026-08-13T08:31:12.338Z";
const APPROVAL_NOTE =
  "Zhengjiazhi 已人工审阅并批准 60 秒派生分镜 v3；素材阶段必须忠于该分镜，真实生图、生视频或付费 API 调用必须在素材方案、版权来源和费用范围再次人工确认后进行。";

const ASSET_CHECKLIST = Object.freeze([
  "三层架构图本地矢量动画：过程知识、执行动作、连接协议",
  "周报任务流程本地矢量动画：核对指标定义、检查异常、固定结构写结论",
  "Tool 动作动画：数据库查询、文档写入",
  "MCP 连接动画：外部能力被 Agent 发现和调用",
  "9:16 安全区、透明字幕层与按实际时长分段的底部矩形文字进度条"
]);

const VISUAL_RULES = Object.freeze([
  "全片以关系动画、结构图和过程演示为主，禁止用连续大字卡片代替概念解释。",
  "同层级元素使用统一的简约扁平样式；液态玻璃只用于少量强调层，不用于底部进度条。",
  "底部使用全宽低矮矩形文字进度条，分段宽度按场景实际时长，不显示当前阶段特殊标记，右上角不显示进度数字。",
  "字幕尽量单行、小字号、贴齐左右与底部，背景透明且不得使用黑色底板。",
  "画面不显示左上角小字、来源行或重复元数据；所有卡片文字必须完整可见。"
]);

const SCENES = Object.freeze([
  {
    id: "S01",
    start: 0,
    end: 4.782,
    type: "title",
    kicker: "",
    title: "Skill、Tool 与 MCP 的分工",
    statement: "消除最常见混淆",
    subtitle: "Skill 主要告诉 Agent 怎样完成一类任务；",
    label: "",
    assetHint:
      "三层架构图：过程知识、执行动作、连接协议；高亮过程知识层并展示任务步骤展开；以关系和过程动画为主，不用大字卡片代替说明"
  },
  {
    id: "S02",
    start: 4.782,
    end: 8.708,
    type: "evidence",
    kicker: "",
    title: "Tool 执行动作",
    statement: "执行动作",
    subtitle: "Tool 提供一个可执行动作；",
    label: "",
    assetHint:
      "三层架构图：过程知识、执行动作、连接协议；高亮执行动作层并展示动作触发；以关系和过程动画为主，不用大字卡片代替说明"
  },
  {
    id: "S03",
    start: 8.708,
    end: 17.402,
    type: "statement",
    kicker: "",
    title: "MCP 连接协议",
    statement: "统一发现和调用",
    subtitle: "MCP 标准化 prompts、resources 和 ",
    label: "",
    assetHint:
      "三层架构图：过程知识、执行动作、连接协议；外部能力通过 MCP 连接线被 Agent 发现和调用；以关系和过程动画为主，不用大字卡片代替说明"
  },
  {
    id: "S04",
    start: 17.402,
    end: 25.443,
    type: "evidence",
    kicker: "",
    title: "Skill 与 MCP",
    statement: "不是同一层问题",
    subtitle: "一个 Skill 完全可以规定何时调用某个 MCP 工具，",
    label: "",
    assetHint:
      "三层架构图：过程知识、执行动作、连接协议；外部能力通过 MCP 连接线被 Agent 发现和调用；以关系和过程动画为主，不用大字卡片代替说明"
  },
  {
    id: "S05",
    start: 25.443,
    end: 36.745,
    type: "statement",
    kicker: "",
    title: "周报任务",
    statement: "核对指标定义 → 检查异常 → 固定结构写结论",
    subtitle: "可以把三者放进同一个任务看：用户要求整理一份周报，",
    label: "",
    assetHint:
      "三层架构图：过程知识、执行动作、连接协议；周报任务依次流经核对指标定义、检查异常、固定结构写结论；以关系和过程动画为主，不用大字卡片代替说明"
  },
  {
    id: "S06",
    start: 36.745,
    end: 41.526,
    type: "evidence",
    kicker: "",
    title: "Tool 执行动作",
    statement: "数据库查询 / 文档写入",
    subtitle: "数据库查询或文档写入 Tool 负责执行具体动作；",
    label: "",
    assetHint:
      "三层架构图：过程知识、执行动作、连接协议；数据库查询与文档写入动作节点依次响应；以关系和过程动画为主，不用大字卡片代替说明"
  },
  {
    id: "S07",
    start: 41.526,
    end: 47.395,
    type: "statement",
    kicker: "",
    title: "MCP 连接协议",
    statement: "统一发现和调用",
    subtitle: "MCP 则让这些外部能力以统一方式被 Agent 发现和调用。",
    label: "",
    assetHint:
      "三层架构图：过程知识、执行动作、连接协议；外部能力通过 MCP 连接线被 Agent 发现和调用；以关系和过程动画为主，不用大字卡片代替说明"
  },
  {
    id: "S08",
    start: 47.395,
    end: 52.828,
    type: "evidence",
    kicker: "",
    title: "只有 Tool",
    statement: "正确顺序和验收标准",
    subtitle: "如果只有工具，Agent 可能不知道正确顺序和验收标准；",
    label: "",
    assetHint:
      "三层架构图：过程知识、执行动作、连接协议；保留 Tool 层并显出正确顺序和验收标准缺失；以关系和过程动画为主，不用大字卡片代替说明"
  },
  {
    id: "S09",
    start: 52.828,
    end: 60,
    type: "summary",
    kicker: "",
    title: "只有 Skill",
    statement: "没有获准的执行能力",
    subtitle: "如果只有 Skill，没有获准的执行能力，它也只能给建议，",
    label: "",
    assetHint:
      "三层架构图：过程知识、执行动作、连接协议；保留 Skill 层并显出执行能力未获准、外部操作未完成；以关系和过程动画为主，不用大字卡片代替说明"
  }
]);

const SUBTITLES = Object.freeze([
  { start: 0, end: 4.782, text: "Skill 主要告诉 Agent 怎样完成一类任务；" },
  { start: 4.782, end: 8.708, text: "Tool 提供一个可执行动作；" },
  { start: 8.708, end: 13.707, text: "MCP 标准化 prompts、resources 和 " },
  { start: 13.707, end: 17.402, text: "tools 如何被外部系统暴露和调用。" },
  { start: 17.402, end: 22.618, text: "一个 Skill 完全可以规定何时调用某个 MCP 工具，" },
  { start: 22.618, end: 25.443, text: "但两者解决的不是同一层问题。" },
  { start: 25.443, end: 30.442, text: "可以把三者放进同一个任务看：用户要求整理一份周报，" },
  { start: 30.442, end: 35.658, text: "Skill 规定先核对指标定义、再检查异常、最后按固定" },
  { start: 35.658, end: 36.745, text: "结构写结论；" },
  { start: 36.745, end: 41.526, text: "数据库查询或文档写入 Tool 负责执行具体动作；" },
  { start: 41.526, end: 47.395, text: "MCP 则让这些外部能力以统一方式被 Agent 发现和调用。" },
  { start: 47.395, end: 52.828, text: "如果只有工具，Agent 可能不知道正确顺序和验收标准；" },
  { start: 52.828, end: 58.261, text: "如果只有 Skill，没有获准的执行能力，它也只能给建议，" },
  { start: 58.261, end: 60, text: "不能完成外部操作。" }
]);

function storyboardVersion(version, generatedAt) {
  return {
    version,
    artifactPath:
      `studio/data/production/episodes/${HISTORICAL_SHORT_EPISODE_ID}/storyboard-draft-v${String(version).padStart(3, "0")}.json`,
    provider: "deterministic-local",
    model: "approved-script-short-storyboard-adapter-v1",
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    generatedAt,
    generationKind: "deterministic-approved-script-storyboard-adapter",
    sourceSnapshotHash: SOURCE_SNAPSHOT_HASH,
    sourceScriptVersion: 2,
    sourceScriptArtifactHash: SOURCE_SCRIPT_HASH,
    sourceScriptReviewReportId: SOURCE_SCRIPT_REVIEW_ID,
    assetChecklist: [...ASSET_CHECKLIST],
    visualRules: [...VISUAL_RULES]
  };
}

function storyboardDraft() {
  return {
    ...storyboardVersion(STORYBOARD_VERSION, "2026-08-13T07:44:58.738Z"),
    needsRevision: false,
    versions: [
      storyboardVersion(1, "2026-08-13T07:37:55.168Z"),
      storyboardVersion(2, "2026-08-13T07:41:02.587Z"),
      storyboardVersion(3, "2026-08-13T07:44:58.738Z")
    ]
  };
}

function pipeline() {
  return PIPELINE_DEFINITIONS.map((definition) => ({
    ...definition,
    status: new Set(["trend", "research", "script", "storyboard"]).has(definition.id)
      ? "complete"
      : definition.id === "assets"
        ? "ready"
        : "pending",
    requiresApproval: null,
    requiresHuman: false,
    progress: 0,
    lastError: null
  }));
}

function historicalEpisodeBase() {
  return {
    schemaVersion: 1,
    id: HISTORICAL_SHORT_EPISODE_ID,
    title: "60 秒讲清 Skill、Tool 与 MCP 的分工",
    concept: "Agent Skill",
    conceptId: "agent-skill",
    audience: "理解 AI 基础概念、关注产品落地的 AI 产品经理及技术邻近人群",
    thesis: "Skill 规定做事方法，Tool 提供执行动作，MCP 标准化外部能力的暴露与调用。",
    status: "in_production",
    previewMode: "production-short",
    productionProfile: {
      id: "short-explainer-60s-v1",
      targetDurationSeconds: 60
    },
    derivation: {
      kind: "approved-script-section-v1",
      parentEpisodeId: "agent-skill-20260806",
      parentResearchVersion: 3,
      parentResearchArtifactHash:
        "48d3d28b577584a05cd4d86a47c388c759dd61d9a55ba509919c6d0765a31363",
      parentResearchReviewReportId:
        "review-research-v3-1-2026-08-06T09-53-27-485Z",
      parentScriptVersion: 3,
      parentScriptArtifactHash:
        "0dbef94d19d95dd479b10316e5612ccba66cf3ace678b1d618f4ca9a365a61bf",
      parentScriptReviewReportId:
        "review-script-v3-4-2026-08-06T10-14-03-532Z",
      sourceSectionIds: ["S05"],
      sourceSections: [{
        id: "S05",
        heading: "Skill、Tool 与 MCP 的分工",
        purpose: "消除最常见混淆",
        narration:
          "Skill 主要告诉 Agent 怎样完成一类任务；Tool 提供一个可执行动作；MCP 标准化 prompts、resources 和 tools 如何被外部系统暴露和调用。一个 Skill 完全可以规定何时调用某个 MCP 工具，但两者解决的不是同一层问题。可以把三者放进同一个任务看：用户要求整理一份周报，Skill 规定先核对指标定义、再检查异常、最后按固定结构写结论；数据库查询或文档写入 Tool 负责执行具体动作；MCP 则让这些外部能力以统一方式被 Agent 发现和调用。如果只有工具，Agent 可能不知道正确顺序和验收标准；如果只有 Skill，没有获准的执行能力，它也只能给建议，不能完成外部操作。",
        evidenceRefs: [
          "source-cabdd0de1a74",
          "source-mcp-overview",
          "source-openai-plugins"
        ],
        visualDirection: "三层架构图：过程知识、执行动作、连接协议"
      }],
      constraints: [
        "只允许压缩、重排或澄清已批准脚本，不得新增未经研究支持的事实",
        "不得为了视觉风格发明会改变脚本含义的比喻",
        "新的脚本、分镜、素材与成片必须分别重新经过机器审核和人工 Gate"
      ],
      sourceSnapshotHash: SOURCE_SNAPSHOT_HASH,
      createdAt: "2026-08-13T05:36:26.488Z"
    },
    pipeline: pipeline(),
    scenes: structuredClone(SCENES),
    subtitles: structuredClone(SUBTITLES),
    assets: [],
    sourceDocs: [],
    voice: {
      status: "unconfigured",
      version: null,
      mode: null,
      audioPath: null
    },
    render: {
      width: 540,
      height: 960,
      fps: 30,
      durationSeconds: 60,
      compositionId: "ConceptPreview",
      outputPath: null,
      status: "pending",
      progress: 0,
      muted: false
    },
    qa: { status: "pending", reportPath: null, checks: [], checkedAt: null },
    production: {
      storyboardDraft: storyboardDraft(),
      ai: { requestCount: 0, attempts: [] },
      feedback: {},
      quality: {}
    },
    approvals: createApprovalMap(),
    approvalHistory: [],
    history: [],
    reviewCheckpoints: {},
    system: { studioRoot: "studio", createdBy: "test-fixture" }
  };
}

export function historicalApprovedStoryboardV3Episode() {
  const episode = ensureAgentArchitecture(historicalEpisodeBase());
  const artifactHash = currentGateArtifactHash(episode, "storyboard");
  const approvalRecord = {
    at: APPROVED_AT,
    gate: "storyboard",
    decision: "approved",
    note: APPROVAL_NOTE,
    version: STORYBOARD_VERSION
  };
  episode.reviews.storyboard = {
    status: "passed",
    artifactVersion: STORYBOARD_VERSION,
    artifactHash,
    rubricVersion: "storyboard-v3",
    revisionRounds: 0,
    latestReportId: STORYBOARD_REVIEW_ID,
    reports: [{
      id: STORYBOARD_REVIEW_ID,
      stage: "storyboard",
      agentId: "storyboard-agent",
      decision: "pass",
      artifactVersion: STORYBOARD_VERSION,
      artifactHash,
      rubricVersion: "storyboard-v3",
      reviewConfigVersion: "review-rubrics-v6",
      reviewMode: "deterministic",
      revisionTargets: [],
      confidence: 0.98,
      checkedAt: "2026-08-13T07:44:58.746Z",
      blockingIssues: [],
      warnings: [{
        code: "evidence-assets",
        location: "scenes",
        evidence: "分镜阶段可先用素材提示，最终 QA 必须绑定真实素材",
        suggestedFix: "由 Asset Agent 补齐素材清单映射，并确保每个 evidence 场景绑定已登记文件",
        ownerAgentId: "asset-agent"
      }],
      passedChecks: [
        "artifact-version",
        "episode-contract",
        "scene-count",
        "subtitle-timeline",
        "subtitle-boundaries",
        "storyboard-script-coverage",
        "storyboard-derived-script-binding",
        "storyboard-derived-script-fidelity",
        "storyboard-derived-visual-contract",
        "storyboard-derived-display-chrome",
        "scene-timeline"
      ],
      checks: []
    }]
  };
  episode.approvals.storyboard = {
    status: "approved",
    at: APPROVED_AT,
    note: APPROVAL_NOTE,
    feedback: "",
    currentVersion: STORYBOARD_VERSION,
    history: [approvalRecord],
    provenance: "reviewed-v2",
    reviewReportId: STORYBOARD_REVIEW_ID,
    artifactHash
  };
  episode.approvalHistory = [approvalRecord];
  return episode;
}
