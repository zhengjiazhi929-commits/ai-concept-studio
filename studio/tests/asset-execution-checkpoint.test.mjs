import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { historicalApprovedStoryboardV3Episode } from
  "./historical-approved-storyboard-v3.fixture.mjs";
import { kernelSnapshot } from "../src/server/control/workflow-kernel.mjs";
import { controlStopReason } from "../src/server/control/controlled-dispatch.mjs";
import {
  approveAssetExecutionCandidate,
  assetExecutionApprovalRecordValid,
  assetExecutionApprovalValid,
  assertAssetExecutionAuthorized,
  beginAssetExecutionPreflight,
  buildAssetExecutionCheckpoint,
  recordAssetExecutionPreflight,
  rejectAssetExecutionCandidate,
  reviseAssetExecutionStrategy,
  verifyAssetExecutionApproval
} from "../src/server/reviews/asset-execution-checkpoint.mjs";
import { inspectAssetExecutionPreflight } from
  "../src/server/reviews/asset-execution-preflight.mjs";
import {
  HYBRID_GENERATION_PROFILES,
  adaptApprovedStoryboardToShortAssetPlan
} from "../src/server/production/short-asset-plan-adapter.mjs";
import { inspectLocalCodeImplementation } from
  "../src/server/production/local-code-implementation.mjs";
import { integrityHash } from "../src/shared/integrity.mjs";

const EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";
const PLAN_PATH = `studio/data/production/episodes/${EPISODE_ID}/asset-plan-v001.json`;

const CURRENT_PROVIDER_FACTS = Object.freeze({
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

function evidenceHarness(episode, mutate = (plan) => plan) {
  const plan = mutate(adaptApprovedStoryboardToShortAssetPlan(episode));
  const document = {
    episodeId: episode.id,
    provider: "deterministic-local",
    model: "approved-storyboard-short-asset-plan-adapter-v7",
    plan
  };
  const text = JSON.stringify(document);
  const integrity = { bytes: Buffer.byteLength(text), sha256: "a".repeat(64) };
  return {
    plan,
    readFile: async () => text,
    inspectFileIntegrity: async () => structuredClone(integrity)
  };
}

function withCandidateEpisode(episode, plan) {
  const next = structuredClone(episode);
  next.production.assetPlan = {
    version: 1,
    artifactPath: PLAN_PATH,
    needsRevision: false,
    content: plan,
    versions: [{ version: 1, artifactPath: PLAN_PATH }]
  };
  const assetIndex = next.pipeline.findIndex((step) => step.agent === "asset-agent");
  next.pipeline = next.pipeline.map((step, index) => {
    if (index < assetIndex) return step;
    return {
      ...step,
      status: index === assetIndex ? "blocked" : "pending",
      requiresApproval: null,
      requiresHuman: false,
      lastError: null
    };
  });
  return next;
}

test("素材方案机器通过后 Kernel 只等待人工检查点，批准绑定当前哈希和 0 美元范围", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  base.production.assetPlanDirection = {
    strategy: "local-only",
    selectedBy: "human"
  };
  const evidence = evidenceHarness(base);
  const source = withCandidateEpisode(base, evidence.plan);
  const reviewed = await buildAssetExecutionCheckpoint(source, {
    artifactPath: PLAN_PATH,
    version: 1
  }, { ...evidence, now: "2026-08-13T09:00:00.000Z" });
  assert.equal(reviewed.checkpoint.status, "waiting_approval");
  assert.equal(reviewed.checkpoint.machineReview.status, "passed");
  assert.equal(reviewed.checkpoint.currentCandidate.summary.externalApiCallCount, 0);
  assert.equal(reviewed.checkpoint.currentCandidate.summary.maximumPaidCostUsd, 0);
  source.reviewCheckpoints.assetExecution = reviewed.checkpoint;

  const legal = kernelSnapshot(source).legalActions;
  assert.equal(
    legal.some((action) => action.action === "run_worker" && action.workerId === "asset-agent"),
    false
  );
  assert.equal(
    legal.some((action) => action.action === "wait_for_checkpoint" && action.checkpointId === "assetExecution"),
    true
  );
  assert.equal(controlStopReason(source).code, "human_checkpoint");

  const store = memoryStore(source);
  await assert.rejects(
    approveAssetExecutionCandidate(EPISODE_ID, {
      candidateHash: "f".repeat(64),
      machineReviewId: reviewed.checkpoint.machineReview.id,
      note: "不应通过"
    }, { ...store, ...evidence }),
    (error) => error.code === "asset_execution_review_conflict" && error.statusCode === 409
  );
  const approved = await approveAssetExecutionCandidate(EPISODE_ID, {
    candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
    machineReviewId: reviewed.checkpoint.machineReview.id,
    note: "Zhengjiazhi 批准 local-only、外部 API 0 次、最高费用 0 美元"
  }, {
    ...store,
    ...evidence,
    now: "2026-08-13T09:01:00.000Z"
  });
  assert.equal(approved.checkpoint.status, "approved");
  assert.equal(approved.checkpoint.humanApproval.maximumPaidCostUsd, 0);
  assert.equal(approved.checkpoint.humanApproval.externalApiCallCount, 0);
  assert.equal(
    store.episode.pipeline.find((step) => step.agent === "asset-agent").status,
    "ready"
  );
  const verified = await verifyAssetExecutionApproval(EPISODE_ID, { ...store, ...evidence });
  assert.equal(verified.valid, true);
  const localExecution = assertAssetExecutionAuthorized(store.episode, {
    itemId: "weekly-report-process",
    executor: "render.local",
    external: false
  });
  assert.equal(localExecution.authorized, true);
  assert.throws(
    () => assertAssetExecutionAuthorized(store.episode, {
      itemId: "weekly-report-process",
      callId: "unapproved-video-call",
      providerId: "provider-a",
      model: "video-model-a",
      maximumCostUsd: 1,
      external: true
    }),
    (error) => error.code === "asset_execution_scope_exceeded"
  );
  assert.equal(store.events.some((event) => event.type === "asset-execution.approved"), true);
});

test("新素材候选替换旧候选时保存可验证的最小 superseded 快照", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  base.production.assetPlanDirection = { strategy: "local-only", selectedBy: "human" };
  const firstEvidence = evidenceHarness(base);
  const source = withCandidateEpisode(base, firstEvidence.plan);
  const first = await buildAssetExecutionCheckpoint(source, {
    artifactPath: PLAN_PATH,
    version: 1
  }, { ...firstEvidence, now: "2026-08-13T09:00:00.000Z" });
  const historicalCandidate = structuredClone(first.checkpoint.currentCandidate);
  historicalCandidate.localCodeImplementation.schemaVersion = "local-code-implementation-v3";
  const historicalPaths = new Set([
    "studio/src/video/agent-skill-short.jsx",
    "studio/src/video/agent-skill-short-plan.mjs",
    "studio/src/video/components/chrome.jsx",
    "studio/src/video/episode-preview.jsx",
    "studio/src/shared/technical-diagram-contract.mjs"
  ]);
  historicalCandidate.localCodeImplementation.files = historicalCandidate
    .localCodeImplementation.files.filter((file) => historicalPaths.has(file.path));
  historicalCandidate.localCodeImplementation.sha256 = createHash("sha256")
    .update(`${JSON.stringify(historicalCandidate.localCodeImplementation.files, null, 2)}\n`)
    .digest("hex");
  const { candidateHash: _candidateHash, ...historicalCandidatePayload } = historicalCandidate;
  historicalCandidate.candidateHash = integrityHash(historicalCandidatePayload);
  source.reviewCheckpoints.assetExecution = {
    ...first.checkpoint,
    currentCandidate: historicalCandidate,
    machineReview: {
      ...first.checkpoint.machineReview,
      candidateHash: historicalCandidate.candidateHash
    }
  };

  const secondEvidence = evidenceHarness(base, (plan) => ({
    ...plan,
    risks: [...(plan.risks ?? []), "候选二新增的确定性风险说明"]
  }));
  source.production.assetPlan = {
    ...source.production.assetPlan,
    version: 2,
    content: secondEvidence.plan,
    versions: [
      ...(source.production.assetPlan.versions ?? []),
      { version: 2, artifactPath: PLAN_PATH }
    ]
  };
  const second = await buildAssetExecutionCheckpoint(source, {
    artifactPath: PLAN_PATH,
    version: 2
  }, { ...secondEvidence, now: "2026-08-13T09:05:00.000Z" });
  const superseded = second.checkpoint.history.find(
    (entry) => entry.type === "candidate-superseded"
  );
  assert.equal(superseded.candidate.version, 1);
  assert.equal(superseded.candidate.candidateHash, historicalCandidate.candidateHash);
  assert.deepEqual(superseded.candidate.artifact, historicalCandidate.artifact);
  assert.equal(superseded.candidate.planHash, historicalCandidate.planHash);
  assert.deepEqual(
    superseded.candidate.sourceStoryboard,
    historicalCandidate.sourceStoryboard
  );
  assert.deepEqual(
    superseded.candidate.localCodeImplementation,
    historicalCandidate.localCodeImplementation
  );
  assert.equal(
    superseded.candidate.localCodeImplementation.schemaVersion,
    "local-code-implementation-v3"
  );
  assert.deepEqual(superseded.candidate.summary, historicalCandidate.summary);
  assert.equal(superseded.supersededByVersion, 2);
  assert.equal(
    superseded.supersededByCandidateHash,
    second.checkpoint.currentCandidate.candidateHash
  );
});

test("本地代码候选使用独立读取器绑定实现摘要，异常摘要 fail-closed", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  base.production.assetPlanDirection = {
    strategy: "local-only",
    selectedBy: "human"
  };
  const evidence = evidenceHarness(base);
  const source = withCandidateEpisode(base, evidence.plan);
  let planReads = 0;
  let implementationReads = 0;
  const reviewed = await buildAssetExecutionCheckpoint(source, {
    artifactPath: PLAN_PATH,
    version: 1
  }, {
    ...evidence,
    readFile: async (...args) => {
      planReads += 1;
      return evidence.readFile(...args);
    },
    readLocalCodeImplementationFile: async (filePath) => {
      implementationReads += 1;
      return Buffer.from(`local implementation: ${filePath}`, "utf8");
    }
  });
  const implementationCheck = reviewed.checkpoint.machineReview.checks.find(
    (check) => check.id === "local-code-implementation-binding"
  );
  assert.equal(reviewed.checkpoint.status, "waiting_approval");
  assert.equal(implementationCheck?.passed, true);
  assert.equal(planReads, 1);
  assert.equal(implementationReads, 13);
  assert.equal(
    reviewed.checkpoint.currentCandidate.localCodeImplementation.schemaVersion,
    "local-code-implementation-v5"
  );
  assert.deepEqual(
    reviewed.checkpoint.currentCandidate.localCodeImplementation.files.map((file) => file.path),
    [
      "studio/config/visual-system.json",
      "studio/src/video/index.jsx",
      "studio/src/video/root.jsx",
      "studio/src/video/episode-preview.jsx",
      "studio/src/video/production-semantic-preview.mjs",
      "studio/src/video/production-semantic-preview.jsx",
      "studio/src/video/agent-skill-short.jsx",
      "studio/src/video/agent-skill-short-plan.mjs",
      "studio/src/video/components/visual-system-v1/grammar-layout.mjs",
      "studio/src/video/components/chrome.jsx",
      "studio/src/video/text-layout.mjs",
      "studio/src/shared/visual-expression-contract.mjs",
      "studio/src/shared/technical-diagram-contract.mjs"
    ]
  );

  const baseline = await inspectLocalCodeImplementation({
    readFile: async (filePath) => Buffer.from(`local implementation: ${filePath}`, "utf8")
  });
  for (const changedPath of [
    "visual-system.json",
    "index.jsx",
    "root.jsx",
    "production-semantic-preview.jsx",
    "grammar-layout.mjs",
    "text-layout.mjs",
    "visual-expression-contract.mjs",
    "technical-diagram-contract.mjs"
  ]) {
    const changedImplementation = await inspectLocalCodeImplementation({
      readFile: async (filePath) => Buffer.from(
        filePath.endsWith(changedPath)
          ? `changed local implementation: ${filePath}`
          : `local implementation: ${filePath}`,
        "utf8"
      )
    });
    assert.notEqual(changedImplementation.sha256, baseline.sha256, changedPath);
  }

  const malformed = await inspectLocalCodeImplementation({
    readFile: async () => Buffer.from("malformed candidate", "utf8")
  });
  malformed.files[0].path = "../outside.jsx";
  const blocked = await buildAssetExecutionCheckpoint(source, {
    artifactPath: PLAN_PATH,
    version: 1
  }, {
    ...evidence,
    inspectLocalCodeImplementation: async () => malformed
  });
  const blockedCheck = blocked.checkpoint.machineReview.checks.find(
    (check) => check.id === "local-code-implementation-binding"
  );
  assert.equal(blocked.checkpoint.status, "blocked");
  assert.equal(blockedCheck?.passed, false);
  assert.notEqual(
    blocked.checkpoint.currentCandidate.candidateHash,
    reviewed.checkpoint.currentCandidate.candidateHash
  );
});

test("合同升级后旧版静态 flow 审批不能继续授权生成执行", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  base.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    selectedBy: "human"
  };
  const evidence = evidenceHarness(base);
  const source = withCandidateEpisode(base, evidence.plan);
  const reviewed = await buildAssetExecutionCheckpoint(source, {
    artifactPath: PLAN_PATH,
    version: 1
  }, evidence);
  source.reviewCheckpoints.assetExecution = reviewed.checkpoint;
  const store = memoryStore(source);
  await approveAssetExecutionCandidate(EPISODE_ID, {
    candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
    machineReviewId: reviewed.checkpoint.machineReview.id,
    note: "批准测试用 v2 渐进式技术流程合同"
  }, { ...store, ...evidence });
  assert.equal(assetExecutionApprovalValid(store.episode), true);

  const legacy = store.episode;
  const flowCall = legacy.production.assetPlan.content.executionPolicy.externalApiCalls.find(
    (call) => call.visualContract?.kind === "technical-flow"
  );
  const flowItem = legacy.production.assetPlan.content.items.find(
    (item) => item.productionMethod?.kind === "external-video-generation"
  );
  flowCall.visualContract.schemaVersion = "technical-diagram-contract-v2";
  flowCall.visualContract.motionPolicy.schemaVersion = "progressive-knowledge-derivation-v1";
  delete flowCall.visualContract.motionPolicy.transition;
  flowItem.visualContract.schemaVersion = "technical-diagram-contract-v2";
  flowItem.visualContract.motionPolicy.schemaVersion = "progressive-knowledge-derivation-v1";
  delete flowItem.visualContract.motionPolicy.transition;
  legacy.reviewCheckpoints.assetExecution.currentCandidate.planHash = integrityHash(
    legacy.production.assetPlan.content
  );
  assert.equal(assetExecutionApprovalRecordValid(legacy), true);
  assert.equal(assetExecutionApprovalValid(legacy), false);
});

test("已批准方案可由人工切换到 Gemini 3 Pro Image 方向，旧批准和旧预检立即失效", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  const evidence = evidenceHarness(base);
  const source = withCandidateEpisode(base, evidence.plan);
  const reviewed = await buildAssetExecutionCheckpoint(source, {
    artifactPath: PLAN_PATH,
    version: 1
  }, evidence);
  source.reviewCheckpoints.assetExecution = {
    ...reviewed.checkpoint,
    status: "approved",
    humanApproval: {
      decision: "approved",
      at: "2026-08-13T09:01:00.000Z",
      note: "原 local-only 批准",
      version: 1,
      candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
      machineReviewId: reviewed.checkpoint.machineReview.id,
      maximumPaidCostUsd: 0,
      externalApiCallCount: 0
    },
    history: [
      ...reviewed.checkpoint.history,
      {
        type: "human-approval",
        at: "2026-08-13T09:01:00.000Z",
        version: 1,
        candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
        machineReviewId: reviewed.checkpoint.machineReview.id,
        decision: "approved",
        note: "原 local-only 批准"
      }
    ]
  };
  source.production.assetExecutionPreflight = {
    status: "passed",
    candidateHash: reviewed.checkpoint.currentCandidate.candidateHash
  };
  source.pipeline.find((step) => step.agent === "asset-agent").status = "complete";
  source.pipeline.find((step) => step.agent === "voice-agent").status = "blocked";
  const store = memoryStore(source);
  const result = await reviseAssetExecutionStrategy(EPISODE_ID, {
    candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
    strategy: "hybrid-api-selective",
    generationProfile:
      HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P,
    feedback: "Zhengjiazhi 选择 AIHubMix 内质量优先且仍在生命周期内的稳定生图模型"
  }, { ...store, now: "2026-08-13T10:30:00.000Z" });
  assert.equal(result.checkpoint.status, "rejected");
  assert.equal(store.episode.production.assetPlan.needsRevision, true);
  assert.equal(
    store.episode.production.assetPlanDirection.strategy,
    "hybrid-api-selective"
  );
  assert.equal(
    store.episode.production.assetPlanDirection.generationProfile,
    HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P
  );
  assert.equal(store.episode.production.assetExecutionPreflight, null);
  assert.equal(
    store.episode.pipeline.find((step) => step.agent === "asset-agent").status,
    "ready"
  );
  assert.equal(
    store.episode.pipeline.find((step) => step.agent === "voice-agent").status,
    "pending"
  );
  assert.equal(store.episode.reviewCheckpoints.assetExecution.history.some(
    (entry) => entry.type === "strategy-selection"
  ), true);
  assert.equal(store.events.some(
    (event) => event.type === "asset-execution.strategy_selected"
  ), true);
});

test("混合素材方案机器审核要求完整提示词、技术图结构契约并形成 3 次 API 和 1 美元硬上限", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  base.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    selectedBy: "human"
  };
  const evidence = evidenceHarness(base);
  const source = withCandidateEpisode(base, evidence.plan);
  source.production.assetPlan.version = 2;
  source.production.assetPlan.artifactPath = PLAN_PATH.replace("v001", "v002");
  source.production.assetPlan.versions = [{
    version: 2,
    artifactPath: source.production.assetPlan.artifactPath
  }];
  const reviewed = await buildAssetExecutionCheckpoint(source, {
    artifactPath: source.production.assetPlan.artifactPath,
    version: 2
  }, evidence);
  assert.equal(reviewed.inspected.passed, true);
  assert.equal(reviewed.checkpoint.status, "waiting_approval");
  assert.equal(reviewed.checkpoint.currentCandidate.summary.externalApiCallCount, 3);
  assert.equal(reviewed.checkpoint.currentCandidate.summary.maximumPaidCostUsd, 1);
  assert.equal(reviewed.checkpoint.currentCandidate.summary.productionMethods.includes(
    "external-image-generation"
  ), true);
  assert.equal(reviewed.checkpoint.currentCandidate.summary.productionMethods.includes(
    "external-video-generation"
  ), true);
  assert.equal(reviewed.inspected.checks.find(
    (check) => check.id === "external-prompt-safety"
  ).passed, true);
  assert.equal(reviewed.inspected.checks.find(
    (check) => check.id === "technical-diagram-contract"
  ).passed, true);
  assert.equal(reviewed.inspected.checks.find(
    (check) => check.id === "technical-diagram-motion-contract"
  ).passed, true);

  const unsafeEvidence = evidenceHarness(base, (plan) => {
    plan.executionPolicy.externalApiCalls[0].prompt = "Draw a branded UI with labels";
    return plan;
  });
  const unsafeSource = withCandidateEpisode(base, unsafeEvidence.plan);
  const unsafeReviewed = await buildAssetExecutionCheckpoint(unsafeSource, {
    artifactPath: PLAN_PATH,
    version: 1
  }, unsafeEvidence);
  assert.equal(unsafeReviewed.inspected.passed, false);
  assert.equal(unsafeReviewed.inspected.checks.find(
    (check) => check.id === "external-prompt-safety"
  ).passed, false);
});

test("技术图解外部调用删除 visualContract 后不能进入人工批准", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  base.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    selectedBy: "human"
  };
  const evidence = evidenceHarness(base, (plan) => {
    delete plan.executionPolicy.externalApiCalls[0].visualContract;
    return plan;
  });
  const reviewed = await buildAssetExecutionCheckpoint(
    withCandidateEpisode(base, evidence.plan),
    { artifactPath: PLAN_PATH, version: 1 },
    evidence
  );
  const check = reviewed.inspected.checks.find(
    (item) => item.id === "technical-diagram-contract"
  );
  assert.equal(reviewed.checkpoint.status, "blocked");
  assert.equal(check.passed, false);
  assert.deepEqual(check.actual.invalidCallIds, [
    evidence.plan.executionPolicy.externalApiCalls[0].id
  ]);
});

test("技术图解 visualContract 的边引用未知节点时不能进入人工批准", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  base.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    selectedBy: "human"
  };
  const evidence = evidenceHarness(base, (plan) => {
    plan.executionPolicy.externalApiCalls[0].visualContract.edges[0].to = "unknown-node";
    return plan;
  });
  const reviewed = await buildAssetExecutionCheckpoint(
    withCandidateEpisode(base, evidence.plan),
    { artifactPath: PLAN_PATH, version: 1 },
    evidence
  );
  assert.equal(reviewed.checkpoint.status, "blocked");
  assert.equal(reviewed.inspected.checks.find(
    (item) => item.id === "technical-diagram-contract"
  ).passed, false);
});

test("技术图解 visualContract 的 sourceSceneIds 与调用 sceneIds 漂移时不能进入人工批准", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  base.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    selectedBy: "human"
  };
  const evidence = evidenceHarness(base, (plan) => {
    plan.executionPolicy.externalApiCalls[0].visualContract.sourceSceneIds = ["S99"];
    return plan;
  });
  const reviewed = await buildAssetExecutionCheckpoint(
    withCandidateEpisode(base, evidence.plan),
    { artifactPath: PLAN_PATH, version: 1 },
    evidence
  );
  assert.equal(reviewed.checkpoint.status, "blocked");
  assert.equal(reviewed.inspected.checks.find(
    (item) => item.id === "technical-diagram-contract"
  ).passed, false);
});

test("技术流程视频缺少或伪造逐步推导时序时不能进入人工批准", async (context) => {
  const cases = [
    {
      name: "删除 motionPolicy",
      mutate(plan) {
        const call = plan.executionPolicy.externalApiCalls.find(
          (item) => item.visualContract?.kind === "technical-flow"
        );
        delete call.visualContract.motionPolicy;
      }
    },
    {
      name: "阶段时间出现空隙",
      mutate(plan) {
        const call = plan.executionPolicy.externalApiCalls.find(
          (item) => item.visualContract?.kind === "technical-flow"
        );
        call.visualContract.motionPolicy.phases[2].startSecond = 2.2;
      }
    },
    {
      name: "过渡时长被重新拉满整个语义阶段",
      mutate(plan) {
        const call = plan.executionPolicy.externalApiCalls.find(
          (item) => item.visualContract?.kind === "technical-flow"
        );
        call.visualContract.motionPolicy.transition.durationSeconds = 4.4;
      }
    },
    {
      name: "箭头恢复为单帧跳出",
      mutate(plan) {
        const call = plan.executionPolicy.externalApiCalls.find(
          (item) => item.visualContract?.kind === "technical-flow"
        );
        call.visualContract.motionPolicy.transition.arrowheadReveal = "hard-threshold";
      }
    },
    {
      name: "连线在目标节点出现前激活",
      mutate(plan) {
        const call = plan.executionPolicy.externalApiCalls.find(
          (item) => item.visualContract?.kind === "technical-flow"
        );
        call.visualContract.motionPolicy.phases[0].activateEdgeIds = ["request-to-mcp"];
        call.visualContract.motionPolicy.phases[3].activateEdgeIds = [];
      }
    },
    {
      name: "请求提示词没有绑定精确时间表",
      mutate(plan) {
        const call = plan.executionPolicy.externalApiCalls.find(
          (item) => item.visualContract?.kind === "technical-flow"
        );
        call.prompt = call.prompt.replace(
          "0.0-0.9 seconds: reveal only agent-request",
          "0.0-0.8 seconds: reveal only agent-request"
        );
        if (call.requestParameters?.content?.[0]) {
          call.requestParameters.content[0].text = call.prompt;
        }
      }
    },
    {
      name: "素材条目与实际调用的时序合同漂移",
      mutate(plan) {
        const item = plan.items.find(
          (candidate) => candidate.productionMethod?.kind === "external-video-generation"
        );
        item.visualContract.motionPolicy.phases[1].endSecond = 2;
      }
    }
  ];

  for (const scenario of cases) {
    await context.test(scenario.name, async () => {
      const base = historicalApprovedStoryboardV3Episode();
      base.production.assetPlanDirection = {
        strategy: "hybrid-api-selective",
        selectedBy: "human"
      };
      const evidence = evidenceHarness(base, (plan) => {
        scenario.mutate(plan);
        return plan;
      });
      const reviewed = await buildAssetExecutionCheckpoint(
        withCandidateEpisode(base, evidence.plan),
        { artifactPath: PLAN_PATH, version: 1 },
        evidence
      );
      const motionCheck = reviewed.inspected.checks.find(
        (item) => item.id === "technical-diagram-motion-contract"
      );
      assert.equal(reviewed.checkpoint.status, "blocked");
      assert.equal(motionCheck.passed, false);
    });
  }
});

test("AIHubMix 与 Seedance 2.5 方案逐币种审核并把精确请求参数绑定到人工批准", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  base.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    generationProfile:
      HYBRID_GENERATION_PROFILES.AIHUBMIX_VOLCENGINE_SEEDANCE_2_5_720P,
    selectedBy: "human"
  };
  const evidence = evidenceHarness(base);
  const source = withCandidateEpisode(base, evidence.plan);
  source.production.assetPlan.version = 3;
  source.production.assetPlan.artifactPath = PLAN_PATH.replace("v001", "v003");
  source.production.assetPlan.versions = [{
    version: 3,
    artifactPath: source.production.assetPlan.artifactPath
  }];
  const reviewed = await buildAssetExecutionCheckpoint(source, {
    artifactPath: source.production.assetPlan.artifactPath,
    version: 3
  }, evidence);
  assert.equal(reviewed.inspected.passed, true);
  assert.equal(reviewed.checkpoint.status, "waiting_approval");
  assert.equal(reviewed.checkpoint.currentCandidate.summary.maximumPaidCostUsd, 2.25);
  assert.deepEqual(
    reviewed.checkpoint.currentCandidate.summary.nativeCurrencyCaps,
    [
      { currency: "USD", maximumAmount: 0.12 },
      { currency: "CNY", maximumAmount: 13 }
    ]
  );
  assert.deepEqual(
    reviewed.checkpoint.currentCandidate.summary.externalApiCalls.map((call) => call.providerId),
    ["aihubmix", "volcengine-ark", "aihubmix"]
  );
  assert.deepEqual(
    reviewed.checkpoint.currentCandidate.summary.externalApiCalls.map((call) => call.model),
    ["gpt-image-2", "doubao-seedance-2-5-260628", "gpt-image-2"]
  );
  assert.equal(reviewed.inspected.checks.find(
    (check) => check.id === "native-currency-contract"
  ).passed, true);
  assert.equal(reviewed.inspected.checks.find(
    (check) => check.id === "budget-normalization"
  ).passed, true);

  const underfundedEvidence = evidenceHarness(base, (plan) => {
    plan.executionPolicy.nativeCurrencyCaps.find(
      (entry) => entry.currency === "CNY"
    ).maximumAmount = 12;
    return plan;
  });
  const underfundedSource = withCandidateEpisode(base, underfundedEvidence.plan);
  const underfundedReview = await buildAssetExecutionCheckpoint(underfundedSource, {
    artifactPath: PLAN_PATH,
    version: 1
  }, underfundedEvidence);
  assert.equal(underfundedReview.inspected.passed, false);
  assert.equal(underfundedReview.inspected.checks.find(
    (check) => check.id === "native-currency-contract"
  ).passed, false);

  source.reviewCheckpoints.assetExecution = reviewed.checkpoint;
  const store = memoryStore(source);
  const approved = await approveAssetExecutionCandidate(EPISODE_ID, {
    candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
    machineReviewId: reviewed.checkpoint.machineReview.id,
    note: "测试批准双币种 v3"
  }, { ...store, ...evidence, now: "2026-08-13T13:00:00.000Z" });
  assert.deepEqual(approved.checkpoint.humanApproval.nativeCurrencyCaps, [
    { currency: "USD", maximumAmount: 0.12 },
    { currency: "CNY", maximumAmount: 13 }
  ]);
  assert.deepEqual(approved.checkpoint.humanApproval.authorizedToolIds, [
    "aihubmix.images.generate",
    "volcengine.video.generate"
  ]);
  assert.equal(store.episode.control.allowedTools.includes(
    "aihubmix.images.generate"
  ), true);
  assert.equal(store.episode.control.allowedTools.includes(
    "volcengine.video.generate"
  ), true);
  const started = await beginAssetExecutionPreflight(EPISODE_ID, {
    candidateHash: reviewed.checkpoint.currentCandidate.candidateHash
  }, {
    ...store,
    now: "2026-08-13T13:00:30.000Z",
    runId: "checkpoint-test-preflight-v3"
  });
  const preflight = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: started.run.runId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    providerFacts: CURRENT_PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 0,
    now: "2026-08-13T13:01:00.000Z"
  });
  assert.equal(preflight.status, "passed");
  await recordAssetExecutionPreflight(EPISODE_ID, preflight, {
    ...store,
    now: "2026-08-13T13:01:00.000Z"
  });
  const videoCall = evidence.plan.executionPolicy.externalApiCalls.find(
    (call) => call.providerId === "volcengine-ark"
  );
  const authorized = assertAssetExecutionAuthorized(store.episode, {
    itemId: "generated-mcp-data-flow-clip",
    callId: videoCall.id,
    providerId: videoCall.providerId,
    model: videoCall.model,
    maximumCostUsd: 2,
    billingCurrency: "CNY",
    maximumCost: 13,
    endpoint: videoCall.endpoint,
    prompt: videoCall.prompt,
    outputSpec: videoCall.outputSpec,
    requestParameters: videoCall.requestParameters,
    external: true
  });
  assert.equal(authorized.authorized, true);
  assert.throws(
    () => assertAssetExecutionAuthorized(store.episode, {
      itemId: "generated-mcp-data-flow-clip",
      callId: videoCall.id,
      providerId: videoCall.providerId,
      model: videoCall.model,
      maximumCostUsd: 2,
      billingCurrency: "CNY",
      maximumCost: 13,
      endpoint: videoCall.endpoint,
      prompt: videoCall.prompt,
      outputSpec: videoCall.outputSpec,
      requestParameters: {
        ...videoCall.requestParameters,
        content: [{ type: "text", text: "changed unapproved prompt parameters" }]
      },
      external: true
    }),
    (error) => error.code === "asset_execution_scope_exceeded"
  );
});

test("隐藏外部生成方式、未确认价格或超出费用上限都不能进入人工批准", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  for (const mutate of [
    (plan) => {
      plan.items[0].productionMethod.externalProvider = "hidden-provider";
      plan.items[0].productionMethod.externalModel = "hidden-model";
      return plan;
    },
    (plan) => {
      plan.executionPolicy.mode = "external-generation";
      plan.executionPolicy.pricingConfirmed = false;
      plan.executionPolicy.maximumPaidCostUsd = 1;
      plan.executionPolicy.externalApiCalls = [{
        id: "call-1",
        providerId: "provider-a",
        model: "video-model-a",
        purpose: "生成解释动画",
        sceneIds: ["S01"],
        estimatedCalls: 1,
        maximumCostUsd: 1,
        pricingSource: "",
        pricingCheckedAt: ""
      }];
      return plan;
    },
    (plan) => {
      plan.executionPolicy.maximumPaidCostUsd = 0;
      plan.items[0].estimatedCost.maximumCostUsd = 2;
      return plan;
    }
  ]) {
    const evidence = evidenceHarness(base, mutate);
    const source = withCandidateEpisode(base, evidence.plan);
    const reviewed = await buildAssetExecutionCheckpoint(source, {
      artifactPath: PLAN_PATH,
      version: 1
    }, evidence);
    assert.equal(reviewed.checkpoint.status, "blocked");
    assert.equal(reviewed.inspected.passed, false);
  }
});

test("只替换 Episode 内的方案内容会使候选文件绑定和批准失效", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  const evidence = evidenceHarness(base);
  const source = withCandidateEpisode(base, structuredClone(evidence.plan));
  source.production.assetPlan.content.visualSystem = "未写回候选文件的篡改视觉系统";
  const reviewed = await buildAssetExecutionCheckpoint(source, {
    artifactPath: PLAN_PATH,
    version: 1
  }, evidence);
  assert.equal(reviewed.checkpoint.status, "blocked");
  assert.equal(
    reviewed.inspected.checks.find((check) => check.id === "current-content-binding").passed,
    false
  );
});

test("人工驳回会把问题退回 Asset Agent，并使下游保持等待", async () => {
  const base = historicalApprovedStoryboardV3Episode();
  const evidence = evidenceHarness(base);
  const source = withCandidateEpisode(base, evidence.plan);
  const reviewed = await buildAssetExecutionCheckpoint(source, {
    artifactPath: PLAN_PATH,
    version: 1
  }, evidence);
  source.reviewCheckpoints.assetExecution = reviewed.checkpoint;
  const store = memoryStore(source);
  const rejected = await rejectAssetExecutionCandidate(EPISODE_ID, {
    candidateHash: reviewed.checkpoint.currentCandidate.candidateHash,
    machineReviewId: reviewed.checkpoint.machineReview.id,
    feedback: "S05 需要更清楚的流程动画拆分"
  }, { ...store, ...evidence, now: "2026-08-13T09:02:00.000Z" });
  assert.equal(rejected.checkpoint.status, "rejected");
  assert.equal(store.episode.production.assetPlan.needsRevision, true);
  assert.equal(
    store.episode.pipeline.find((step) => step.agent === "asset-agent").status,
    "ready"
  );
  assert.equal(
    store.episode.pipeline.find((step) => step.agent === "voice-agent").status,
    "pending"
  );
  assert.equal(store.events.some((event) => event.type === "asset-execution.rejected"), true);
});
