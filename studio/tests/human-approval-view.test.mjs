import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createReviewMap } from "../src/shared/agent-contracts.mjs";
import {
  createApprovalMap,
  currentGateArtifactHash,
  currentGateVersion
} from "../src/shared/workflow.mjs";
import { workspaceRoot } from "../src/shared/paths.mjs";
import { integrityHash } from "../src/shared/integrity.mjs";
import {
  buildHumanApprovalView,
  getHumanApprovalView
} from "../src/server/reviews/human-approval-view.mjs";
import { assertCurrentApprovalArtifactIntegrity } from
  "../src/server/reviews/approval-artifact-integrity.mjs";
import {
  approveGate,
  exactApprovalBinding,
  rejectGate
} from "../src/server/orchestrator.mjs";
import { acquireEpisodeOperation } from
  "../src/server/control/episode-operation-lock.mjs";
import { createStudioServer } from "../src/server/app.mjs";

const REPORT_AT = "2026-08-17T08:00:00.000Z";
const SENSITIVE_MARKER = ["fixture", "marker", "must", "not", "leak"].join("-");

function researchPack() {
  return {
    status: "ready_for_fact_approval",
    sources: [{
      id: "source-official",
      label: "官方规范",
      url: `https://example.test/spec?${["X-Amz", "Signature"].join("-")}=${SENSITIVE_MARKER}#private`,
      publisher: "Example",
      sourceType: "official-doc",
      evidenceStatus: "verified",
      evidenceSummary: ["Bearer", SENSITIVE_MARKER].join(" "),
      locator: "section 2",
      [["access", "Token"].join("")]: SENSITIVE_MARKER
    }],
    claims: [{
      id: "claim-boundary",
      text: "MCP 标准化外部能力的暴露和调用",
      category: "definition",
      importance: "critical",
      support: "supported",
      sourceIds: ["source-official"],
      boundary: "不等于业务流程本身"
    }],
    claimRequirements: [{ id: "definition", critical: true }],
    readiness: { readyForFactApproval: true, reasons: [] },
    marketContext: { purpose: "仅作热度背景" },
    productDecisions: ["只讲清技术分工"]
  };
}

function assetPlan() {
  return {
    visualSystem: "简约技术图解",
    sourceStoryboard: { version: 4, artifactHash: "3".repeat(64) },
    items: [{
      id: "diagram-1",
      sceneIds: ["S01"],
      assetType: "diagram",
      required: true,
      productionMethod: { kind: "local-code-animation", executor: "render.local" }
    }],
    executionPolicy: {
      mode: "mixed",
      maximumPaidCostUsd: 0.3,
      billingCurrencies: ["USD"],
      nativeCurrencyCaps: [{ currency: "CNY", maximumAmount: 13 }],
      humanApprovalRequiredBeforeExecution: true,
      invalidatesOnPlanChange: true,
      externalApiCalls: [{
        id: "image-1",
        providerId: "provider-a",
        model: "diagram-model",
        sceneIds: ["S01"],
        prompt: ["api", "Key", "=", SENSITIVE_MARKER].join(""),
        outputSpec: "vertical diagram, no text",
        maximumCostUsd: 0.3,
        billing: { currency: "USD", maximumAmount: 0.3 }
      }]
    },
    risks: ["模型价格或可用性变化时必须停止", "不得让生成内容反向修改脚本"]
  };
}

function fixtureEpisode() {
  const researchText = JSON.stringify(researchPack());
  const episode = {
    id: "approval-fixture-001",
    title: "Agent 审批单测试",
    concept: "Agent Skill",
    status: "in_production",
    control: { reviewEnabled: true, allowedTools: [] },
    pipeline: [
      { id: "research", gate: "research", agent: "research-agent", status: "waiting_approval" },
      { id: "script", gate: "script", agent: "script-agent", status: "waiting_approval" },
      { id: "storyboard", gate: "storyboard", agent: "storyboard-agent", status: "waiting_approval" },
      { id: "voice", gate: "assets", agent: "voice-agent", status: "waiting_approval" },
      { id: "qa", gate: "final", agent: "qa-agent", status: "waiting_approval" },
      { id: "assets", gate: null, agent: "asset-agent", status: "blocked" }
    ],
    research: {
      status: "ready_for_fact_approval",
      version: 2,
      versions: [{ version: 1, packPath: "research-v1.json" }, { version: 2, packPath: "research-v2.json" }],
      packPath: "research-v2.json",
      assistTaskPath: "research-task-v2.json",
      lastImportedBatch: "batch-2",
      readiness: { readyForFactApproval: true, reasons: [] },
      needsRevision: false
    },
    sourceDocs: [{
      path: "research-v2.json",
      bytes: Buffer.byteLength(researchText),
      sha256: createHash("sha256").update(researchText).digest("hex")
    }],
    production: {
      scriptDraft: {
        version: 3,
        artifactPath: "script-v3.json",
        sha256: "2".repeat(64),
        needsRevision: false,
        content: {
          sections: [{
            id: "S01",
            narration: "Skill 规定过程知识；Tool 执行动作；MCP 连接外部能力。",
            evidenceRefs: ["source-official"]
          }]
        },
        versions: [{ version: 2, artifactPath: "script-v2.json" }, { version: 3, artifactPath: "script-v3.json" }]
      },
      storyboardDraft: {
        version: 4,
        artifactPath: "storyboard-v4.json",
        sha256: "3".repeat(64),
        needsRevision: false,
        visualRules: ["同级节点统一使用简约卡片"],
        assetChecklist: ["S01 技术架构图"],
        versions: [{ version: 3, artifactPath: "storyboard-v3.json" }, { version: 4, artifactPath: "storyboard-v4.json" }]
      },
      assetBundleRevision: 5,
      materialsVersion: 5,
      assetPlan: {
        version: 5,
        artifactPath: "asset-plan-v5.json",
        bytes: 2_048,
        sha256: "4".repeat(64),
        needsRevision: false,
        content: assetPlan(),
        versions: [{ version: 4, artifactPath: "asset-plan-v4.json" }, { version: 5, artifactPath: "asset-plan-v5.json" }]
      },
      voicePlan: {
        version: 5,
        artifactPath: "voice-plan-v5.json",
        narration: "完整旁白",
        content: { narration: "完整旁白" },
        versions: [{ version: 5, artifactPath: "voice-plan-v5.json" }]
      },
      assetPlanDirection: { strategy: "hybrid-api-selective", generationProfile: "diagram-first" },
      feedback: {}
    },
    scenes: [{
      id: "S01",
      start: 0,
      end: 10,
      index: "01",
      title: "三层架构",
      subtitle: "Skill、Tool 与 MCP 分属不同层",
      evidenceRef: "diagram-1",
      asset: "diagram.png",
      audio: "voice.wav"
    }],
    subtitles: [{ id: "sub-1", sceneId: "S01", start: 0, end: 5, text: "Skill、Tool 与 MCP 分属不同层" }],
    assets: [{
      id: "diagram-1",
      planItemId: "diagram-1",
      type: "image",
      path: "diagram.png",
      source: "generated",
      bytes: 4_096,
      sha256: "5".repeat(64),
      privacy: "internal",
      verified: true
    }],
    voice: {
      status: "ready",
      version: 5,
      mode: "local-offline",
      audioPath: "voice.wav",
      bytes: 9_999,
      sha256: "6".repeat(64),
      durationSeconds: 60,
      sampleRate: 48_000,
      channels: 1,
      bitsPerSample: 16,
      provenance: { source: "local", offlineVerified: true },
      verification: { status: "passed", checks: [{ id: "wav", passed: true }] },
      authorization: { decision: "approved", approvedBy: "Zhengjiazhi" }
    },
    render: {
      version: 6,
      outputPath: "preview-v006.mp4",
      status: "ready",
      bytes: 100_000,
      sha256: "7".repeat(64),
      width: 540,
      height: 960,
      fps: 30,
      durationSeconds: 60,
      compositionId: "ConceptPreview",
      muted: false
    },
    qa: {
      status: "passed",
      reportPath: "qa-v006.json",
      checkedAt: REPORT_AT,
      checks: [{ id: "duration", passed: true }],
      quality: { score: 96 },
      history: [{ version: 5, outputPath: "preview-v005.mp4", status: "passed" }]
    },
    approvals: createApprovalMap(),
    reviews: createReviewMap(),
    reviewCheckpoints: {},
    approvalHistory: [],
    history: []
  };

  for (const gate of ["research", "script", "storyboard", "assets", "final"]) {
    const version = currentGateVersion(episode, gate);
    episode.approvals[gate].currentVersion = version;
    const artifactHash = currentGateArtifactHash(episode, gate);
    const reportId = `review-${gate}-v${version}`;
    episode.reviews[gate] = {
      status: "passed",
      artifactVersion: version,
      artifactHash,
      rubricVersion: `${gate}-v1`,
      revisionRounds: 1,
      latestReportId: reportId,
      reports: [{
        id: `review-${gate}-previous`,
        decision: "revise",
        artifactVersion: Math.max(1, version - 1),
        artifactHash: "8".repeat(64),
        blockingIssues: [{ code: "old-blocker", message: "旧问题" }],
        warnings: [],
        checks: []
      }, {
        id: reportId,
        stage: gate,
        decision: "pass",
        artifactVersion: version,
        artifactHash,
        checkedAt: REPORT_AT,
        blockingIssues: [],
        warnings: gate === "final" ? [{ code: "publish-boundary", message: "仍需单独发布" }] : [],
        checks: [{
          id: `${gate}-integrity`,
          passed: true,
          actual: { [["private", "Key"].join("")]: SENSITIVE_MARKER }
        }]
      }]
    };
  }

  const candidateHash = "9".repeat(64);
  episode.reviewCheckpoints.assetExecution = {
    schemaVersion: 1,
    status: "waiting_approval",
    currentCandidate: {
      episodeId: episode.id,
      version: 5,
      candidateHash,
      planHash: integrityHash(episode.production.assetPlan.content),
      artifact: { path: "asset-plan-v5.json", bytes: 2_048, sha256: "4".repeat(64) },
      summary: {
        itemCount: 1,
        externalApiCallCount: 1,
        maximumPaidCostUsd: 0.3,
        billingCurrencies: ["USD"],
        nativeCurrencyCaps: [{ currency: "CNY", maximumAmount: 13 }]
      }
    },
    machineReview: {
      id: "asset-execution-review-v5",
      status: "passed",
      candidateHash,
      checkedAt: REPORT_AT,
      checks: [{ id: "cost-cap", label: "费用上限", passed: true }]
    },
    humanApproval: null,
    history: [{ type: "machine-review", version: 4 }, { type: "machine-review", version: 5 }]
  };
  const visualCandidateHash = "b".repeat(64);
  episode.reviewCheckpoints.visualProof = {
    schemaVersion: 1,
    status: "waiting_approval",
    currentCandidate: {
      episodeId: episode.id,
      version: 14,
      sourceRenderVersion: 6,
      candidateHash: visualCandidateHash,
      manifest: { path: "visual-proof-v014.json", bytes: 1_024, sha256: "c".repeat(64) },
      video: { path: "visual-proof-v014.mp4", bytes: 100_000, sha256: "d".repeat(64) },
      qa: { path: "visual-proof-qa-v014.txt", bytes: 512, sha256: "e".repeat(64), result: "passed" },
      comparison: { path: "visual-proof-comparison-v014.png", bytes: 5_000, sha256: "f".repeat(64) }
    },
    machineReview: {
      id: "visual-proof-review-v014",
      status: "passed",
      candidateHash: visualCandidateHash,
      checkedAt: REPORT_AT,
      checks: [{ id: "video-integrity", label: "样片完整性", passed: true }]
    },
    humanApproval: null,
    history: []
  };
  return episode;
}

function memoryStore(initialEpisode) {
  let stored = structuredClone(initialEpisode);
  const events = [];
  return {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async (event) => events.push(structuredClone(event)),
    get episode() {
      return structuredClone(stored);
    },
    events
  };
}

test("七类待审批对象都输出白名单完整审批单、精确绑定和后果边界", () => {
  const episode = fixtureEpisode();
  const before = structuredClone(episode);
  const cases = [
    ["research", "conclusions"],
    ["script", "fullText"],
    ["storyboard", "scenes"],
    ["assets", "voiceIntegrity"],
    ["final", "video"],
    ["asset-execution", "executionPolicy"],
    ["visual-proof", "candidate"]
  ];

  for (const [target, requiredContentKey] of cases) {
    const view = buildHumanApprovalView(episode, target, {
      artifact: target === "research"
        ? researchPack()
        : target === "asset-execution"
          ? { plan: structuredClone(episode.production.assetPlan.content) }
          : null,
      visualProofInspection: target === "visual-proof" ? {
        passed: true,
        candidate: structuredClone(episode.reviewCheckpoints.visualProof.currentCandidate)
      } : null
    });
    assert.equal(view.schemaVersion, "human-approval-view-v1");
    assert.equal(view.episode.id, episode.id);
    assert.equal(view.status.readyForHumanApproval, true, target);
    assert.equal(view.status.bindingComplete, true, target);
    assert.equal(Object.hasOwn(view.content, requiredContentKey), true, target);
    assert.equal(Object.hasOwn(view, "approvalObject"), true, target);
    assert.equal(Object.hasOwn(view, "changes"), true, target);
    assert.equal(view.changes.contentComparisonAvailable, false, target);
    assert.equal(Object.hasOwn(view, "evidence"), true, target);
    assert.equal(Array.isArray(view.risks), true, target);
    assert.equal(Object.hasOwn(view, "machineReview"), true, target);
    assert.equal(view.consequences.onApprove.length > 0, true, target);
    assert.equal(view.consequences.doesNotHappen.length > 0, true, target);
    assert.equal(view.nextActions.every((action) => action.requiresExactBinding), true, target);
    assert.equal(view.nextActions.every((action) => action.request), true, target);
    assert.equal(Object.hasOwn(view, "control"), false, target);
    assert.equal(Object.hasOwn(view, "history"), false, target);
    assert.equal(JSON.stringify(view).includes(SENSITIVE_MARKER), false, target);
  }

  const final = buildHumanApprovalView(episode, "final");
  assert.match(final.consequences.doesNotHappen.join(" "), /不会自动上传、发布/);
  assert.equal(final.evidence.playablePreview.path, "preview-v006.mp4");
  const storyboard = buildHumanApprovalView(episode, "storyboard");
  assert.equal(storyboard.evidence.playablePreview, null);
  assert.equal(storyboard.changes.currentContentSummary.sceneCount, 1);
  assert.equal(storyboard.content.scenes[0].index, "01");
  assert.equal(storyboard.content.scenes[0].evidenceRef, "diagram-1");
  assert.equal(Object.hasOwn(storyboard.content.scenes[0], "asset"), false);
  assert.equal(Object.hasOwn(storyboard.content.scenes[0], "audio"), false);
  const assets = buildHumanApprovalView(episode, "assets");
  assert.equal(assets.content.apiCost.maximumPaidCostUsd, 0.3);
  assert.equal(assets.content.voiceIntegrity.sha256, "6".repeat(64));
  assert.equal(assets.risks.filter((risk) => risk.level === "plan").length, 2);
  const execution = buildHumanApprovalView(episode, "asset-execution", {
    artifact: { plan: structuredClone(episode.production.assetPlan.content) }
  });
  assert.equal(execution.binding.machineReviewId, "asset-execution-review-v5");
  assert.equal(execution.binding.planHash, integrityHash(episode.production.assetPlan.content));
  assert.equal(execution.content.items.length, 1);
  assert.equal(execution.content.prompts.length, 1);
  assert.equal(execution.risks.filter((risk) => risk.level === "plan").length, 2);
  assert.deepEqual(episode, before);
  const research = buildHumanApprovalView(episode, "research", { artifact: researchPack() });
  assert.equal(research.content.sources[0].url, "https://example.test/spec");
  const visualProof = buildHumanApprovalView(episode, "visual-proof", {
    visualProofInspection: {
      passed: true,
      candidate: structuredClone(episode.reviewCheckpoints.visualProof.currentCandidate)
    }
  });
  assert.equal(visualProof.type, "visualProof");
  assert.equal(visualProof.status.canReject, false);
  assert.equal(visualProof.nextActions.some((action) => action.id === "reject"), false);
  assert.equal(visualProof.evidence.playablePreview.path, "visual-proof-v014.mp4");
  assert.match(visualProof.consequences.doesNotHappen.join(" "), /不会批准素材 Gate 或最终成片/);
});

test("读取研究审批单可完全注入内存，不接触 live Episode 或文件", async () => {
  const episode = fixtureEpisode();
  const reads = [];
  const view = await getHumanApprovalView(episode.id, "research", {
    readEpisode: async (id) => {
      assert.equal(id, episode.id);
      return structuredClone(episode);
    },
    readApprovalArtifact: async (path) => {
      reads.push(path);
      return JSON.stringify(researchPack());
    }
  });
  assert.deepEqual(reads, ["research-v2.json"]);
  assert.equal(view.content.conclusions.length, 1);
  assert.equal(view.content.boundaries[0].boundary, "不等于业务流程本身");
  assert.equal(view.status.completeForHumanReview, true);
});

test("完整待审批产物读取失败时只禁止批准，仍允许精确绑定退回", async () => {
  const episode = fixtureEpisode();
  const view = await getHumanApprovalView(episode.id, "research", {
    readEpisode: async () => structuredClone(episode),
    readApprovalArtifact: async () => {
      const error = new Error(["unreadable", SENSITIVE_MARKER].join(":"));
      error.code = "fixture_read_failed";
      throw error;
    }
  });
  assert.equal(view.status.completeForHumanReview, false);
  assert.equal(view.status.readyForHumanApproval, false);
  assert.equal(view.nextActions.find((action) => action.id === "approve").allowed, false);
  assert.equal(view.nextActions.find((action) => action.id === "reject").allowed, true);
  assert.equal(JSON.stringify(view).includes(SENSITIVE_MARKER), false);
  assert.equal(view.risks.some((risk) => risk.code === "fixture_read_failed"), true);
});

test("研究产物内容与 Episode 登记摘要不一致时禁止批准", async () => {
  const episode = fixtureEpisode();
  const view = await getHumanApprovalView(episode.id, "research", {
    readEpisode: async () => structuredClone(episode),
    readApprovalArtifact: async () => JSON.stringify({
      ...researchPack(),
      claims: [{ ...researchPack().claims[0], text: "磁盘内容已被替换" }]
    })
  });
  assert.equal(view.status.readyForHumanApproval, false);
  assert.equal(
    view.risks.some((risk) => risk.code === "approval_artifact_integrity_mismatch"),
    true
  );
  assert.equal(view.nextActions.find((action) => action.id === "approve").allowed, false);
  assert.equal(view.nextActions.find((action) => action.id === "reject").allowed, true);
});

test("素材执行 dossier 只展示候选 A，Episode 当前方案变成 B 时禁止批准", () => {
  const episode = fixtureEpisode();
  const candidatePlan = structuredClone(episode.production.assetPlan.content);
  episode.production.assetPlan.content = {
    ...episode.production.assetPlan.content,
    items: [{
      id: "unreviewed-plan-b",
      sceneIds: ["S01"],
      productionMethod: { kind: "unreviewed" }
    }]
  };
  const view = buildHumanApprovalView(episode, "asset-execution", {
    artifact: { plan: candidatePlan }
  });
  assert.equal(view.status.candidateMatchesCurrentPlan, false);
  assert.equal(view.status.readyForHumanApproval, false);
  assert.equal(view.content.items[0].id, "diagram-1");
  assert.equal(JSON.stringify(view).includes("unreviewed-plan-b"), false);
  assert.equal(
    view.risks.some((risk) => risk.code === "asset-execution-current-plan-mismatch"),
    true
  );
});

test("内嵌脚本与素材方案不要求未登记文件摘要，live null metadata 仍可审批", async () => {
  const episode = fixtureEpisode();
  episode.production.scriptDraft.sha256 = null;
  episode.production.assetPlan.bytes = null;
  episode.production.assetPlan.sha256 = null;
  for (const gate of ["script", "assets"]) {
    const artifactHash = currentGateArtifactHash(episode, gate);
    episode.reviews[gate].artifactHash = artifactHash;
    const report = episode.reviews[gate].reports.find(
      (item) => item.id === episode.reviews[gate].latestReportId
    );
    report.artifactHash = artifactHash;
  }
  const reads = [];
  const options = {
    readEpisode: async () => structuredClone(episode),
    readApprovalArtifact: async (path) => {
      reads.push(path);
      throw new Error("内嵌内容不应读取文件");
    }
  };
  const [script, assets] = await Promise.all([
    getHumanApprovalView(episode.id, "script", options),
    getHumanApprovalView(episode.id, "assets", options)
  ]);
  assert.deepEqual(reads, []);
  assert.equal(script.status.completeForHumanReview, true);
  assert.equal(script.status.readyForHumanApproval, true);
  assert.equal(assets.status.completeForHumanReview, true);
  assert.equal(assets.status.readyForHumanApproval, true);
});

test("本地旁白的字符串检查 ID 在审批单中保持为已通过检查，不伪装成失败项", () => {
  const episode = fixtureEpisode();
  episode.voice.verification = {
    status: "passed",
    checks: ["candidate-manifest-and-wav-integrity", "zero-network-zero-external-calls"]
  };
  const view = buildHumanApprovalView(episode, "assets");
  assert.deepEqual(
    view.content.voiceIntegrity.verification.checks.map((check) => ({
      id: check.id,
      passed: check.passed
    })),
    [
      { id: "candidate-manifest-and-wav-integrity", passed: true },
      { id: "zero-network-zero-external-calls", passed: true }
    ]
  );
});

test("素材执行仅把 plan bytes/sha 当可选冗余，候选文件与内容绑定仍是强约束", () => {
  const episode = fixtureEpisode();
  episode.production.assetPlan.bytes = null;
  episode.production.assetPlan.sha256 = null;
  const view = buildHumanApprovalView(episode, "asset-execution", {
    artifact: { plan: structuredClone(episode.production.assetPlan.content) }
  });
  assert.equal(view.status.candidateMatchesCurrentPlan, true);
  assert.equal(view.status.readyForHumanApproval, true);
});

test("素材执行审批单安全读取上一候选，并给出确定性结构差异", async () => {
  async function dossier(previousPlan) {
    const episode = fixtureEpisode();
    const currentPlan = structuredClone(episode.production.assetPlan.content);
    const currentText = JSON.stringify({ plan: currentPlan });
    const previousText = JSON.stringify({ plan: previousPlan });
    const currentIntegrity = {
      bytes: Buffer.byteLength(currentText),
      sha256: createHash("sha256").update(currentText).digest("hex")
    };
    const previousIntegrity = {
      bytes: Buffer.byteLength(previousText),
      sha256: createHash("sha256").update(previousText).digest("hex")
    };
    episode.production.assetPlan.bytes = null;
    episode.production.assetPlan.sha256 = null;
    episode.reviewCheckpoints.assetExecution.currentCandidate.artifact = {
      path: "asset-plan-v5.json",
      ...currentIntegrity
    };
    episode.reviewCheckpoints.assetExecution.history.push({
      type: "candidate-superseded",
      candidate: {
        version: 4,
        candidateHash: "0".repeat(64),
        artifact: { path: "asset-plan-v4.json", ...previousIntegrity },
        planHash: integrityHash(previousPlan),
        sourceStoryboard: structuredClone(previousPlan.sourceStoryboard),
        localCodeImplementation: {
          schemaVersion: "local-code-implementation-v3",
          componentId: "AgentSkillShortExplainer",
          sha256: "1".repeat(64),
          files: [{
            path: "studio/src/video/agent-skill-short.jsx",
            bytes: 10_970,
            sha256: "2".repeat(64)
          }]
        },
        summary: { itemCount: previousPlan.items.length }
      }
    });
    const bodies = new Map([
      ["asset-plan-v5.json", currentText],
      ["asset-plan-v4.json", previousText]
    ]);
    return getHumanApprovalView(episode.id, "asset-execution", {
      readEpisode: async () => structuredClone(episode),
      readApprovalArtifact: async (path) => bodies.get(path)
    });
  }

  const same = await dossier(assetPlan());
  assert.equal(same.status.readyForHumanApproval, true);
  assert.equal(same.changes.previousVersion, 4);
  assert.equal(same.changes.contentComparisonAvailable, true);
  assert.equal(same.changes.deterministicDiff.unchanged, true);
  assert.match(same.changes.deterministicDiff.summary, /结构内容无变化/);
  assert.equal(
    same.changes.deterministicDiff.previousCandidate.localCodeImplementation.schemaVersion,
    "local-code-implementation-v3"
  );
  assert.deepEqual(
    same.changes.deterministicDiff.previousCandidate.localCodeImplementation.files.map(
      (file) => file.path
    ),
    ["studio/src/video/agent-skill-short.jsx"]
  );
  assert.equal(same.binding.candidateVersion, 5);

  const changedPrevious = assetPlan();
  changedPrevious.items = [{
    ...changedPrevious.items[0],
    id: "old-diagram",
    productionMethod: { kind: "old-local-render" }
  }];
  const changed = await dossier(changedPrevious);
  assert.equal(changed.changes.deterministicDiff.unchanged, false);
  assert.deepEqual(changed.changes.changedIds.items.added, ["diagram-1"]);
  assert.deepEqual(changed.changes.changedIds.items.removed, ["old-diagram"]);
});

test("旧版反馈不误标当前 Storyboard，机器风险按 code 与 location 去重", () => {
  const episode = fixtureEpisode();
  episode.production.feedback.storyboard = {
    version: 3,
    text: "这是 v3 的旧反馈"
  };
  const report = episode.reviews.storyboard.reports.find(
    (item) => item.id === episode.reviews.storyboard.latestReportId
  );
  report.warnings.push({ code: "evidence-assets", location: "S03", message: "证据不足" });
  report.checks.push({
    id: "evidence-assets",
    location: "S03",
    label: "证据不足",
    passed: false,
    severity: "warning"
  });
  const view = buildHumanApprovalView(episode, "storyboard");
  assert.equal(view.status.needsRevision, false);
  assert.equal(
    view.risks.filter((risk) => risk.code === "evidence-assets" && risk.location === "S03").length,
    1
  );
});

test("视觉样片 GET 重验失败时移除可播放预览并禁止批准", async () => {
  const episode = fixtureEpisode();
  const view = await getHumanApprovalView(episode.id, "visual-proof", {
    readEpisode: async () => structuredClone(episode),
    inspectVisualProofCandidate: async () => ({
      passed: false,
      candidate: structuredClone(episode.reviewCheckpoints.visualProof.currentCandidate),
      checks: [{ id: "video-integrity", passed: false }]
    })
  });
  assert.equal(view.status.readyForHumanApproval, false);
  assert.equal(view.status.completeForHumanReview, false);
  assert.equal(view.evidence.playablePreview, null);
  assert.equal(view.nextActions.find((action) => action.id === "approve").allowed, false);
  assert.equal(view.risks.some((risk) => risk.code === "visual_proof_review_stale"), true);
});

test("默认审批产物读取器拒绝工作区内指向外部的符号链接", async () => {
  const episode = fixtureEpisode();
  const outside = await mkdtemp(resolve(tmpdir(), "approval-view-outside-"));
  const externalPath = resolve(outside, "research.json");
  const linkName = `.approval-view-link-${process.pid}-${Date.now()}.json`;
  const linkPath = resolve(workspaceRoot, linkName);
  await writeFile(externalPath, JSON.stringify({ marker: SENSITIVE_MARKER }));
  await symlink(externalPath, linkPath);
  episode.research.packPath = linkName;
  try {
    const view = await getHumanApprovalView(episode.id, "research", {
      readEpisode: async () => structuredClone(episode)
    });
    assert.equal(view.status.readyForHumanApproval, false);
    assert.equal(
      view.risks.some((risk) => risk.code === "approval_artifact_symlink_forbidden"),
      true
    );
    assert.equal(JSON.stringify(view).includes(SENSITIVE_MARKER), false);
  } finally {
    await rm(linkPath, { force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("普通 Gate 批准和驳回都只接受当前版本、哈希与机器报告的精确绑定", async () => {
  const source = fixtureEpisode();
  source.control.reviewEnabled = false;
  const store = memoryStore(source);
  await assert.rejects(
    approveGate(source.id, "script", { note: "缺少绑定" }, store),
    (error) => error.code === "script_approval_binding_conflict" && error.statusCode === 409
  );
  await assert.rejects(
    approveGate(source.id, "script", {
      ...exactApprovalBinding(store.episode, "script"),
      artifactHash: "f".repeat(64),
      note: "旧哈希"
    }, store),
    (error) => error.code === "script_approval_binding_conflict" && error.statusCode === 409
  );
  const binding = exactApprovalBinding(store.episode, "script");
  await approveGate(source.id, "script", { ...binding, note: "批准当前脚本" }, store);
  assert.equal(store.episode.approvals.script.status, "approved");
  await assert.rejects(
    rejectGate(source.id, "script", {
      ...binding,
      reviewReportId: "stale-review",
      feedback: "旧页面退回"
    }, store),
    (error) => error.code === "script_approval_binding_conflict" && error.statusCode === 409
  );
  await rejectGate(source.id, "script", {
    ...exactApprovalBinding(store.episode, "script"),
    feedback: "请让开头更直接"
  }, store);
  assert.equal(store.episode.approvals.script.status, "rejected");
});

test("人工 Gate 在正文完整性重读失败时零写入", async () => {
  const source = fixtureEpisode();
  source.control.reviewEnabled = false;
  const store = memoryStore(source);
  const binding = exactApprovalBinding(store.episode, "script");
  await assert.rejects(
    approveGate(source.id, "script", { ...binding, note: "批准当前脚本" }, {
      ...store,
      assertCurrentApprovalArtifactIntegrity: async () => {
        const error = new Error("正文漂移");
        error.code = "script_approval_artifact_integrity_mismatch";
        error.statusCode = 409;
        throw error;
      }
    }),
    (error) => error.code === "script_approval_artifact_integrity_mismatch"
  );
  assert.equal(store.episode.approvals.script.status, "pending");
  assert.equal(store.events.length, 0);
});

test("人工 Gate 首次正文校验后文件被替换时零批准、零写入、零事件", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "approval-artifact-race-"));
  const artifactPath = resolve(temporaryRoot, "script-v3.json");
  const approvedBody = JSON.stringify({ sections: [{ narration: "当前人工看到的脚本" }] });
  const approvedBytes = Buffer.byteLength(approvedBody);
  const approvedSha256 = createHash("sha256").update(approvedBody).digest("hex");
  const source = fixtureEpisode();
  source.control.reviewEnabled = false;
  source.production.scriptDraft = {
    version: 3,
    artifactPath,
    bytes: approvedBytes,
    sha256: approvedSha256
  };
  source.approvals.script.status = "pending";
  source.approvals.script.currentVersion = 3;
  source.reviews.script.latestReportId = "review-script-current";
  const before = structuredClone(source);
  let integrityAttempts = 0;
  let writes = 0;
  const events = [];

  try {
    await writeFile(artifactPath, approvedBody);
    await assert.rejects(
      approveGate(source.id, "script", {
        ...exactApprovalBinding(source, "script"),
        note: "批准当前脚本"
      }, {
        actor: "human:approval-race-test",
        readEpisode: async () => structuredClone(source),
        writeEpisode: async () => {
          writes += 1;
        },
        appendEvent: async (event) => events.push(structuredClone(event)),
        resolveExistingPathInside: async (_root, target) => target,
        assertCurrentApprovalArtifactIntegrity: async (episode, gate, options) => {
          integrityAttempts += 1;
          const result = await assertCurrentApprovalArtifactIntegrity(episode, gate, options);
          if (integrityAttempts === 1) {
            await writeFile(artifactPath, "首次校验后被替换的正文");
          }
          return result;
        }
      }),
      (error) => error.code === "script_approval_artifact_integrity_mismatch"
        && error.statusCode === 409
    );
    assert.equal(integrityAttempts, 2);
    assert.equal(writes, 0);
    assert.equal(events.length, 0);
    assert.deepEqual(source, before);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("Agent 状态变更锁持有期间人工批准 fail closed 且零副作用", async () => {
  const source = fixtureEpisode();
  source.control.reviewEnabled = false;
  const store = memoryStore(source);
  const releaseOperation = acquireEpisodeOperation(source.id, "worker:script-agent");
  try {
    await assert.rejects(
      approveGate(source.id, "script", exactApprovalBinding(source, "script"), store),
      (error) => error.code === "episode_operation_active"
        && error.activeKind === "worker:script-agent"
    );
    assert.equal(store.episode.approvals.script.status, source.approvals.script.status);
    assert.equal(store.events.length, 0);
  } finally {
    releaseOperation();
  }
});

test("HTTP 审批单 GET 可读，所有正式缺绑定批准和驳回均返回 409", async () => {
  const episode = fixtureEpisode();
  const operatorToken = "human-approval-http-test-operator-token-20260824";
  const { server } = await createStudioServer({
    recoverOnStart: false,
    operatorActor: "human:approval-http-test",
    operatorToken,
    allowServiceTokenMutations: true,
    capabilitySecret: "human-approval-http-test-capability-secret-20260824",
    readEpisode: async () => structuredClone(episode),
    writeEpisode: async () => {
      throw new Error("409 路径不应写状态");
    },
    appendEvent: async () => {
      throw new Error("409 路径不应写事件");
    },
    readApprovalArtifact: async () => JSON.stringify(researchPack())
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const reviewResponse = await fetch(
      `${base}/api/episodes/${episode.id}/approval-review/research`
    );
    assert.equal(reviewResponse.status, 200);
    const reviewBody = await reviewResponse.json();
    assert.equal(reviewBody.review.content.conclusions.length, 1);
    assert.equal(reviewBody.review.binding.reviewReportId, "review-research-v2");

    const cases = [
      [`/api/episodes/${episode.id}/approvals/script`, { note: "缺少绑定" }, "script_approval_binding_conflict"],
      [`/api/episodes/${episode.id}/approvals/script/reject`, { feedback: "缺少绑定" }, "script_approval_binding_conflict"],
      [`/api/episodes/${episode.id}/asset-execution-review/approve`, {
        candidateHash: episode.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
      }, "asset_execution_review_conflict"],
      [`/api/episodes/${episode.id}/asset-execution-review/reject`, {
        candidateHash: episode.reviewCheckpoints.assetExecution.currentCandidate.candidateHash,
        feedback: "缺少机器审核绑定"
      }, "asset_execution_review_conflict"]
    ];
    for (const [path, body, code] of cases) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-operator-token": operatorToken
        },
        body: JSON.stringify(body)
      });
      assert.equal(response.status, 409, path);
      assert.equal((await response.json()).code, code, path);
    }
  } finally {
    if (server.listening) {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  }
});
