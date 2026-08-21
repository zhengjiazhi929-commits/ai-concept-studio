import { runAgent } from "../src/server/orchestrator.mjs";
import { readReviewConfig } from "../src/server/reviews/coordinator.mjs";
import {
  splitSubtitleText,
  splitTextNearMiddle
} from "../src/server/production/generator.mjs";

const episodeId = process.argv[2] ?? "agent-skill-20260806";
if (episodeId !== "agent-skill-20260806") {
  throw new Error("这个离线夹具只允许用于 agent-skill-20260806");
}

function chunkText(value, maximumCharacters = 24) {
  return splitSubtitleText(value, maximumCharacters).map((text) => ({
    text,
    weight: Math.max(1, Array.from(text).length)
  }));
}

function splitInHalf(value) {
  return splitTextNearMiddle(value);
}

function scene(type, durationSeconds, input, revised) {
  const assetHint = revised
    ? `9:16 竖屏安全区重构：${input.assetHint}`
    : input.assetHint;
  return {
    type,
    durationSeconds,
    kicker: input.kicker,
    title: input.title,
    statement: input.statement,
    subtitle: Array.from(input.narration).slice(0, 28).join(""),
    label: input.label,
    assetHint,
    subtitleLines: chunkText(input.narration)
  };
}

function storyboardDraft(script, reviewFeedback) {
  const revised = Array.isArray(reviewFeedback) && reviewFeedback.length > 0;
  const scenes = [
    scene("title", 30, {
      kicker: "Agent Skill",
      title: script.title,
      statement: script.thesis,
      narration: script.hook,
      label: "开场问题",
      assetHint: "标题、聊天框与 Skill 目录的对照动效"
    }, revised)
  ];

  for (const [index, item] of script.sections.entries()) {
    const [evidenceNarration, statementNarration] = splitInHalf(item.narration);
    const evidenceLabel = `来源：${(item.evidenceRefs ?? []).join("、")}`;
    scenes.push(
      scene("evidence", 34, {
        kicker: `证据 ${String(index + 1).padStart(2, "0")}`,
        title: item.heading,
        statement: item.purpose,
        narration: evidenceNarration,
        label: evidenceLabel,
        assetHint: `真实文档或规范摘录，支持“${item.heading}”的核心定义`
      }, revised),
      scene("statement", 34, {
        kicker: `解释 ${String(index + 1).padStart(2, "0")}`,
        title: item.heading,
        statement: item.visualDirection,
        narration: statementNarration,
        label: "基于已批准脚本的解释",
        assetHint: item.visualDirection
      }, revised)
    );
  }

  scenes.push(
    scene("summary", 26, {
      kicker: "上线前检查",
      title: "先定义边界，再把方法变成 Skill",
      statement: script.thesis,
      narration: script.closing,
      label: "结论",
      assetHint: "五项检查卡片与人工审批门收束"
    }, revised)
  );

  return {
    targetDurationSeconds: script.targetDurationSeconds,
    scenes,
    assetChecklist: [
      "Agent Skills 规范目录结构截图",
      "官方 Skills 文档中的发现与加载说明",
      "MCP prompts、resources、tools 分层图",
      "发布、授权、审计、更新、回退治理闭环图",
      "9:16 竖屏安全区和字幕安全区模板"
    ]
  };
}

let generationCalls = 0;
const receivedFeedback = [];
const aiClient = {
  async generateStructured(taskId, request) {
    if (taskId !== "storyboard") throw new Error(`离线分镜夹具不支持任务：${taskId}`);
    generationCalls += 1;
    const input = JSON.parse(request.input);
    receivedFeedback.push(structuredClone(input.reviewFeedback));
    return {
      provider: "offline-fixture",
      model: "agent-skill-storyboard-fixture-v1",
      responseId: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      value: storyboardDraft(input.script, input.reviewFeedback),
      attempts: []
    };
  }
};

const reviewConfig = await readReviewConfig();
reviewConfig.stages.storyboard.semanticReview = true;
const semanticReviewer = async ({ context }) => {
  const scenes = context.artifact?.scenes ?? [];
  const hasVerticalComposition = scenes.length > 0 && scenes.every(
    (item) => String(item.assetHint ?? "").includes("9:16")
  );
  const common = {
    stage: "storyboard",
    artifactVersion: context.artifact?.draft?.version,
    rubricVersion: "storyboard-v3",
    confidence: 0.96,
    warnings: [],
    passedChecks: ["narrative-continuity", "evidence-visibility", "human-reviewability"]
  };
  if (hasVerticalComposition) {
    return { ...common, decision: "pass", blockingIssues: [] };
  }
  return {
    ...common,
    decision: "revise",
    blockingIssues: [{
      code: "MISSING_VERTICAL_COMPOSITION",
      evidence: "分镜已有画面方向，但没有逐场说明如何落入 9:16 竖屏安全区，存在桌面构图直接缩小后不可读的风险。",
      location: "storyboard.scenes[*].assetHint",
      suggestedFix: "由 Storyboard Agent 为每个场景补充 9:16 竖屏重构与字幕安全区要求。"
    }]
  };
};

const result = await runAgent(episodeId, "storyboard-agent", {
  aiClient,
  limits: { maxAttempts: 2, maxRevisionRounds: 1 },
  review: {
    config: reviewConfig,
    semanticReviewer,
    semanticReviewerId: "offline-agent-skill-storyboard-reviewer-v1",
    semanticReviewerKind: "test-double"
  }
});

console.log(JSON.stringify({
  episodeId,
  generationCalls,
  firstCallFeedback: receivedFeedback[0],
  revisionFeedback: receivedFeedback[1],
  output: {
    status: result.output.status,
    message: result.output.message,
    requiresApproval: result.output.requiresApproval
  },
  review: {
    decision: result.review?.report.decision,
    reportId: result.review?.report.id,
    rubricVersion: result.review?.report.rubricVersion,
    reviewMode: result.review?.report.reviewMode,
    semanticReviewerId: result.review?.report.semanticReviewerId,
    semanticReviewerKind: result.review?.report.semanticReviewerKind,
    artifactVersion: result.review?.report.artifactVersion,
    blockingIssues: result.review?.report.blockingIssues,
    warnings: result.review?.report.warnings
  }
}, null, 2));
