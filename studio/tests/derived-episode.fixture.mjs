import { ensureAgentArchitecture } from "../src/shared/agent-contracts.mjs";
import { PIPELINE_DEFINITIONS } from "../src/shared/schema.mjs";
import {
  createApprovalMap,
  currentGateArtifactHash
} from "../src/shared/workflow.mjs";

const FIXTURE_NOW = "2026-08-13T08:00:00.000Z";

export const APPROVED_SOURCE_NARRATION =
  "Skill 主要告诉 Agent 怎样完成一类任务；Tool 提供一个可执行动作；MCP 标准化 prompts、resources 和 tools 如何被外部系统暴露和调用。一个 Skill 完全可以规定何时调用某个 MCP 工具，但两者解决的不是同一层问题。可以把三者放进同一个任务看：用户要求整理一份周报，Skill 规定先核对指标定义、再检查异常、最后按固定结构写结论；数据库查询或文档写入 Tool 负责执行具体动作；MCP 则让这些外部能力以统一方式被 Agent 发现和调用。如果只有工具，Agent 可能不知道正确顺序和验收标准；如果只有 Skill，没有获准的执行能力，它也只能给建议，不能完成外部操作。";

function fixturePipeline() {
  return PIPELINE_DEFINITIONS.map((definition) => ({
    ...definition,
    status: new Set(["trend", "research", "script"]).has(definition.id)
      ? "complete"
      : definition.id === "storyboard"
        ? "ready"
        : "pending",
    requiresApproval: null,
    requiresHuman: false,
    progress: 0,
    lastError: null
  }));
}

function bindApprovedGate(episode, gate, version) {
  const reportId = `fixture-review-${gate}-v${version}`;
  const artifactHash = currentGateArtifactHash(episode, gate);
  const approvalRecord = {
    at: FIXTURE_NOW,
    gate,
    decision: "approved",
    note: "deterministic tracked fixture",
    version
  };
  episode.reviews[gate] = {
    status: "passed",
    artifactVersion: version,
    artifactHash,
    rubricVersion: `${gate}-fixture-v1`,
    revisionRounds: 0,
    latestReportId: reportId,
    reports: [{
      id: reportId,
      stage: gate,
      agentId: `${gate}-agent`,
      decision: "pass",
      artifactVersion: version,
      artifactHash,
      rubricVersion: `${gate}-fixture-v1`,
      reviewConfigVersion: "tracked-fixture-v1",
      reviewMode: "deterministic",
      confidence: 1,
      blockingIssues: [],
      warnings: [],
      passedChecks: ["artifact-binding"],
      checkedAt: FIXTURE_NOW
    }]
  };
  episode.approvals[gate] = {
    status: "approved",
    at: FIXTURE_NOW,
    note: "deterministic tracked fixture",
    feedback: "",
    currentVersion: version,
    history: [approvalRecord],
    provenance: "reviewed-v2",
    reviewReportId: reportId,
    artifactHash
  };
  episode.approvalHistory.push(approvalRecord);
}

export function approvedDerivedEpisodeParentFixture() {
  const episode = ensureAgentArchitecture({
    schemaVersion: 1,
    id: "fixture-approved-parent",
    title: "Agent Skill 长片测试父 Episode",
    concept: "Agent Skill",
    conceptId: "agent-skill",
    audience: "理解 AI 基础概念的产品经理与技术邻近人群",
    thesis: "Skill、Tool 与 MCP 分别约束方法、动作和标准连接。",
    status: "in_production",
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
    pipeline: fixturePipeline(),
    scenes: [],
    subtitles: [],
    assets: [],
    sourceDocs: [
      { id: "source-skill", path: "fixtures/source-skill.md" },
      { id: "source-tool", path: "fixtures/source-tool.md" },
      { id: "source-mcp", path: "fixtures/source-mcp.md" }
    ],
    research: {
      version: 1,
      artifactPath: "studio/tests/fixtures/research-v001.json",
      readiness: { readyForFactApproval: true, reasons: [] },
      findings: [{ id: "fixture-finding", statement: "fixture evidence" }],
      versions: []
    },
    production: {
      scriptDraft: {
        version: 1,
        artifactPath: "studio/tests/fixtures/script-v001.json",
        content: {
          title: "Agent Skill",
          thesis: "准确区分方法、动作与连接层。",
          targetDurationSeconds: 600,
          hook: "",
          sections: [{
            id: "S05",
            heading: "Skill、Tool 与 MCP 的分工",
            purpose: "消除最常见混淆",
            narration: APPROVED_SOURCE_NARRATION,
            evidenceRefs: ["source-skill", "source-tool", "source-mcp"],
            visualDirection: "三层架构图：过程知识、执行动作、连接协议"
          }],
          closing: "",
          factCheckNotes: []
        },
        versions: []
      },
      ai: { requestCount: 0, attempts: [] },
      feedback: {},
      quality: {}
    },
    approvals: createApprovalMap(),
    approvalHistory: [],
    voice: { status: "unconfigured", version: null, mode: null, audioPath: null },
    render: {
      width: 540,
      height: 960,
      fps: 30,
      durationSeconds: 0,
      compositionId: "ConceptPreview",
      outputPath: null,
      status: "pending",
      progress: 0,
      muted: false
    },
    qa: { status: "pending", reportPath: null, checks: [], checkedAt: null },
    history: [],
    system: { studioRoot: "studio", createdBy: "tracked-test-fixture" }
  });
  bindApprovedGate(episode, "research", 1);
  bindApprovedGate(episode, "script", 1);
  return episode;
}
