import test from "node:test";
import assert from "node:assert/strict";
import { readFixtureEpisode } from "./episode-fixture.mjs";
import {
  assertWorkerRunAllowed,
  kernelSnapshot,
  recordRoutingOutcome,
  validateKernelPlan
} from "../src/server/control/workflow-kernel.mjs";
import { runAgent, runNextReadyAgent } from "../src/server/orchestrator.mjs";
import {
  HYBRID_GENERATION_PROFILES,
  adaptApprovedStoryboardToShortAssetPlan
} from "../src/server/production/short-asset-plan-adapter.mjs";
import {
  approveAssetExecutionCandidate,
  beginAssetExecutionPreflight,
  buildAssetExecutionCheckpoint,
  recordAssetExecutionPreflight
} from "../src/server/reviews/asset-execution-checkpoint.mjs";
import { inspectAssetExecutionPreflight } from
  "../src/server/reviews/asset-execution-preflight.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";
import { historicalApprovedStoryboardV3Episode } from
  "./historical-approved-storyboard-v3.fixture.mjs";

const WORKFLOW_PREFLIGHT_FACTS = Object.freeze({
  aihubmix: {
    available: true,
    modelId: "gpt-image-2",
    capabilities: ["image_generation", "llm"],
    supportedEndpoints: ["https://aihubmix.com/v1/images/generations"],
    pricingConfirmed: true,
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 30,
    checkedAt: "2026-08-14T01:30:00.000Z",
    source: "https://aihubmix.com/api/v1/models?model=gpt-image-2",
    endpointSource: "https://docs.aihubmix.com/en/api/Image-Gen"
  },
  volcengineArk: {
    available: true,
    modelId: "doubao-seedance-2-5-260628",
    supportedResolutions: ["480p", "720p"],
    pricingConfirmed: true,
    unitPriceCnyPerMillion: 70,
    checkedAt: "2026-08-14T01:30:00.000Z",
    source: "https://www.volcengine.com/docs/82379/2607688?lang=zh"
  }
});

function memoryStore(initialEpisode, evidence = {}) {
  let stored = structuredClone(initialEpisode);
  return {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {},
    ...evidence,
    get episode() {
      return structuredClone(stored);
    }
  };
}

function approveReviewedFixtureGate(episode, gate, version, reportId) {
  const artifactHash = currentGateArtifactHash(episode, gate);
  const approval = {
    at: "2026-08-13T08:00:00.000Z",
    gate,
    decision: "approved",
    note: "Immutable Workflow Kernel test fixture",
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
      decision: "pass",
      artifactVersion: version,
      artifactHash,
      rubricVersion: `${gate}-fixture-v1`,
      confidence: 1,
      blockingIssues: [],
      warnings: [],
      passedChecks: ["immutable-fixture"]
    }]
  };
  episode.approvals[gate] = {
    status: "approved",
    at: approval.at,
    note: approval.note,
    feedback: "",
    currentVersion: version,
    history: [approval],
    provenance: "reviewed-v2",
    reviewReportId: reportId,
    artifactHash
  };
  episode.approvalHistory.push(approval);
}

function addApprovedKernelPrerequisites(episode) {
  episode.research = {
    version: 3,
    artifactPath: "studio/tests/fixtures/workflow-kernel/research-snapshot-v003.json",
    content: { claims: [], sources: [] },
    versions: []
  };
  episode.production.scriptDraft = {
    version: 2,
    artifactPath: "studio/tests/fixtures/workflow-kernel/script-draft-v002.json",
    content: {
      title: episode.title,
      sections: structuredClone(episode.derivation.sourceSections)
    },
    needsRevision: false,
    versions: []
  };
  approveReviewedFixtureGate(
    episode,
    "research",
    3,
    "workflow-kernel-fixture-research-v3-pass"
  );
  approveReviewedFixtureGate(
    episode,
    "script",
    2,
    "workflow-kernel-fixture-script-v2-pass"
  );
}

async function approvedAndPreflightPassedAssetEpisode() {
  const source = historicalApprovedStoryboardV3Episode();
  addApprovedKernelPrerequisites(source);
  source.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    generationProfile:
      HYBRID_GENERATION_PROFILES.AIHUBMIX_VOLCENGINE_SEEDANCE_2_5_720P,
    selectedBy: "human"
  };
  const plan = adaptApprovedStoryboardToShortAssetPlan(source);
  source.production.assetPlan = {
    version: 1,
    artifactPath: "studio/tests/fixtures/workflow-kernel/asset-plan-v001.json",
    content: plan,
    needsRevision: false
  };
  const document = JSON.stringify({ episodeId: source.id, plan });
  const evidence = {
    readFile: async () => document,
    inspectFileIntegrity: async () => ({
      bytes: Buffer.byteLength(document),
      sha256: "d".repeat(64)
    })
  };
  const reviewed = await buildAssetExecutionCheckpoint(source, {
    artifactPath: source.production.assetPlan.artifactPath,
    version: source.production.assetPlan.version
  }, evidence);
  source.reviewCheckpoints.assetExecution = reviewed.checkpoint;
  const checkpoint = source.reviewCheckpoints.assetExecution;
  checkpoint.status = "waiting_approval";
  checkpoint.humanApproval = null;
  source.production.assetPlan.needsRevision = false;
  source.control.allowedTools = source.control.allowedTools.filter(
    (toolId) => !new Set([
      "aihubmix.images.generate",
      "volcengine.video.generate"
    ]).has(toolId)
  );
  source.control.activeOperation = null;
  const assetStep = source.pipeline.find((step) => step.agent === "asset-agent");
  assetStep.status = "blocked";
  assetStep.requiresHuman = true;
  const store = memoryStore(source, evidence);
  await approveAssetExecutionCandidate(source.id, {
    candidateHash: checkpoint.currentCandidate.candidateHash,
    machineReviewId: checkpoint.machineReview.id,
    note: "Workflow Kernel 工具授权专项夹具"
  }, store);
  const begun = await beginAssetExecutionPreflight(source.id, {
    candidateHash: checkpoint.currentCandidate.candidateHash
  }, {
    ...store,
    runId: `workflow-kernel-preflight:${checkpoint.currentCandidate.candidateHash}`
  });
  const report = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: begun.run.runId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    providerFacts: WORKFLOW_PREFLIGHT_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 0,
    now: "2026-08-14T08:30:00.000Z"
  });
  assert.equal(report.schemaVersion, 4);
  assert.equal(report.status, "passed");
  await recordAssetExecutionPreflight(source.id, report, store);
  return store.episode;
}

test("Kernel 只给 Main Agent 暴露通过人工前置闸门的合法动作", async () => {
  const episode = await readFixtureEpisode();
  for (const step of episode.pipeline) step.status = "pending";
  episode.pipeline.find((step) => step.agent === "storyboard-agent").status = "ready";
  episode.approvals.script.status = "pending";
  let snapshot = kernelSnapshot(episode);
  assert.equal(snapshot.legalActions.some((action) => action.workerId === "storyboard-agent"), false);
  episode.approvals.script.status = "approved";
  snapshot = kernelSnapshot(episode);
  assert.equal(snapshot.legalActions.some((action) => action.workerId === "storyboard-agent"), true);
});

test("固定回退路径可以显式重跑已完成步骤，Main Agent 不可以", async () => {
  const episode = await readFixtureEpisode();
  const script = episode.pipeline.find((step) => step.agent === "script-agent");
  script.status = "complete";
  assert.equal(assertWorkerRunAllowed(episode, "script-agent").agent, "script-agent");
  assert.throws(
    () => assertWorkerRunAllowed(episode, "script-agent", { initiator: "main-agent" }),
    /不能运行/u
  );
});

test("Kernel 拒绝并发计划和缺少人工闸门的 Worker", async () => {
  const episode = await readFixtureEpisode();
  episode.pipeline.find((step) => step.agent === "storyboard-agent").status = "ready";
  episode.approvals.script.status = "pending";
  const result = validateKernelPlan(episode, {
    action: "run_worker",
    workerId: "storyboard-agent",
    taskProfile: "creative-structured",
    reason: "生成分镜",
    acceptanceCriteria: [],
    estimatedCalls: 1
  }, { activeRun: true });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("episode already has an active run"));
  assert.ok(result.errors.includes("missing human gate: script"));
});

test("Kernel 追加路由历史并累计实际调用与费用，不重复写同一决策", async () => {
  const episode = await readFixtureEpisode();
  const decision = {
    id: "route-test-1",
    profile: "creative-structured",
    reason: "test route",
    candidates: [],
    selected: { providerId: "fallback", model: "model-a" },
    estimatedCostUsd: 0.01,
    outcome: { estimatedCostUsd: 0.008 }
  };
  const first = recordRoutingOutcome(episode, decision, { callCount: 2, costUsd: 0.008 });
  const second = recordRoutingOutcome(first, decision, { callCount: 0, costUsd: 0 });
  assert.equal(second.routingHistory.filter((entry) => entry.id === decision.id).length, 1);
  assert.equal(second.control.budget.usedCalls, 2);
  assert.equal(second.control.budget.usedCostUsd, 0.008);
});

test("固定回退调度器会按 Kernel 把机器审核问题交回 blocked Worker", async () => {
  let stored = await readFixtureEpisode();
  for (const step of stored.pipeline) step.status = "pending";
  stored.pipeline.find((step) => step.agent === "script-agent").status = "blocked";
  stored.approvals.script.status = "pending";
  let called = false;
  const result = await runNextReadyAgent(stored.id, {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {},
    agent: {
      async run() {
        called = true;
        return { status: "failed", message: "测试已确认 blocked Worker 被重新调度" };
      }
    }
  });
  assert.equal(called, true);
  assert.equal(result.output.status, "failed");
});

test("固定回退调度器只把当前批准且预检通过的素材工具授权给 Asset Agent", async () => {
  let stored = await approvedAndPreflightPassedAssetEpisode();
  const assetStep = stored.pipeline.find((step) => step.agent === "asset-agent");
  assetStep.status = "ready";
  assetStep.requiresHuman = false;
  assetStep.lastError = null;
  const expectedToolIds = [
    "aihubmix.images.generate",
    "volcengine.video.generate"
  ];
  let receivedToolIds = null;
  const result = await runNextReadyAgent(stored.id, {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {},
    agent: {
      async run(_episode, context) {
        receivedToolIds = [...context.toolIds];
        return {
          status: "blocked",
          message: "专项测试在 Provider 调用前停止",
          artifacts: [],
          findings: [],
          requiresHuman: true
        };
      }
    }
  });
  assert.equal(result.output.status, "blocked");
  assert.deepEqual(receivedToolIds.sort(), expectedToolIds.sort());
});

test("固定回退在调用 Worker 前拒绝缺失或扩大的素材工具集合", async () => {
  let stored = await approvedAndPreflightPassedAssetEpisode();
  const assetStep = stored.pipeline.find((step) => step.agent === "asset-agent");
  assetStep.status = "ready";
  assetStep.requiresHuman = false;
  let called = false;
  const options = {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {},
    agent: { run: async () => {
      called = true;
      return { status: "complete", message: "不应运行" };
    } }
  };
  await assert.rejects(
    runNextReadyAgent(stored.id, { ...options, toolIds: [] }),
    (error) => error.code === "worker_tool_authorization_mismatch"
  );
  await assert.rejects(
    runNextReadyAgent(stored.id, { ...options, toolIds: ["render.local"] }),
    (error) => error.code === "worker_tool_authorization_mismatch"
  );
  assert.equal(called, false);
  assert.equal(assetStep.status, "ready");
});

test("直接运行 Worker 会按最新 Episode 和 Manifest 重新检查工具授权", async () => {
  let stored = await readFixtureEpisode();
  stored.pipeline.find((step) => step.agent === "script-agent").status = "ready";
  stored.control.allowedTools = [];
  let called = false;
  await assert.rejects(
    runAgent(stored.id, "script-agent", {
      toolIds: ["artifact.read"],
      readEpisode: async () => structuredClone(stored),
      writeEpisode: async (episode) => {
        stored = structuredClone(episode);
      },
      appendEvent: async () => {},
      agent: { run: async () => {
        called = true;
        return { status: "complete", message: "不应运行" };
      } }
    }),
    (error) => error.code === "worker_tool_not_allowed_for_episode"
  );
  assert.equal(called, false);
  assert.equal(stored.pipeline.find((step) => step.agent === "script-agent").status, "ready");
});

test("素材执行方案等待人工审批时 Kernel 不会重复运行 Asset Agent", async () => {
  const episode = await readFixtureEpisode();
  for (const step of episode.pipeline) step.status = "pending";
  episode.pipeline.find((step) => step.agent === "asset-agent").status = "blocked";
  episode.approvals.storyboard.status = "approved";
  episode.reviewCheckpoints.assetExecution = {
    status: "waiting_approval",
    machineReview: { status: "passed" },
    currentCandidate: { candidateHash: "a".repeat(64) }
  };
  const snapshot = kernelSnapshot(episode);
  assert.equal(snapshot.legalActions.some((action) => action.workerId === "asset-agent"), false);
  assert.equal(
    snapshot.legalActions.some((action) => action.action === "wait_for_checkpoint"),
    true
  );
  assert.throws(
    () => assertWorkerRunAllowed(episode, "asset-agent"),
    /等待人工审批/u
  );
});

test("素材候选已批准但预检失效时 Kernel 只允许运行预检检查点", async () => {
  const episode = await approvedAndPreflightPassedAssetEpisode();
  const checkpoint = episode.reviewCheckpoints.assetExecution;
  checkpoint.status = "approved";
  checkpoint.machineReview.status = "passed";
  checkpoint.humanApproval = {
    decision: "approved",
    at: "2026-08-14T06:00:00.000Z",
    note: "Kernel 专项测试",
    version: checkpoint.currentCandidate.version,
    candidateHash: checkpoint.currentCandidate.candidateHash,
    machineReviewId: checkpoint.machineReview.id,
    authorizedToolIds: [
      "aihubmix.images.generate",
      "volcengine.video.generate"
    ]
  };
  episode.production.assetPlan.needsRevision = false;
  episode.production.assetExecutionPreflight = null;
  episode.production.assetExecutionPreflightRun = null;
  const asset = episode.pipeline.find((step) => step.agent === "asset-agent");
  asset.status = "failed";
  asset.requiresHuman = false;
  const snapshot = kernelSnapshot(episode);
  assert.equal(snapshot.legalActions.some((action) =>
    action.action === "run_worker" && action.workerId === "asset-agent"
  ), false);
  assert.equal(snapshot.legalActions.some((action) =>
    action.action === "run_checkpoint" &&
    action.checkpointId === "assetExecutionPreflight" &&
    action.generationRequestCount === 0
  ), true);
  assert.throws(
    () => assertWorkerRunAllowed(episode, "asset-agent"),
    /零生成预检/u
  );
});

test("旁白缺少人工授权音频时 Kernel 只等待输入，不重复运行 Voice Agent", async () => {
  const episode = await readFixtureEpisode();
  for (const step of episode.pipeline) step.status = "complete";
  const voice = episode.pipeline.find((step) => step.agent === "voice-agent");
  voice.status = "blocked";
  voice.requiresHuman = true;
  const snapshot = kernelSnapshot(episode);
  assert.equal(snapshot.legalActions.some((action) => action.workerId === "voice-agent" && action.action === "run_worker"), false);
  assert.equal(
    snapshot.legalActions.some(
      (action) => action.action === "wait_for_input" && action.stepId === "voice"
    ),
    true
  );
  assert.throws(
    () => assertWorkerRunAllowed(episode, "voice-agent"),
    /等待人工输入/u
  );
});
