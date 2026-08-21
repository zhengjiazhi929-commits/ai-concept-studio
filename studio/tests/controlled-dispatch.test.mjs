import test from "node:test";
import assert from "node:assert/strict";
import { readEpisode } from "../src/shared/store.mjs";
import {
  confirmAssistedDispatch,
  controlStopReason,
  prepareAssistedDispatch,
  recoverInterruptedDispatch,
  runActiveCycle,
  transitionControlMode
} from "../src/server/control/controlled-dispatch.mjs";
import {
  contentHash,
  createEvaluationEvidence,
  DEFAULT_EVALUATION_SUITE
} from "../src/server/control/evaluation-suite.mjs";

function validPlan(overrides = {}) {
  return {
    action: "run_worker",
    workerId: "script-agent",
    taskProfile: "creative-structured",
    reason: "研究闸门已批准，脚本 Worker 当前合法",
    acceptanceCriteria: ["生成新候选版本", "通过脚本审核"],
    reviewProfile: "script-v2",
    toolIds: [],
    estimatedCalls: 1,
    estimatedCostUsd: 0,
    limits: { maxAttempts: 1, maxRevisionRounds: 2 },
    fallbackAction: "escalate_to_human",
    ...overrides
  };
}

function passingShadowRecords() {
  return ["golden", "rejection", "boundary"].map((id, index) => ({
    id: `shadow-${id}`,
    version: index + 1,
    mode: "shadow",
    status: "proposed",
    evaluation: {
      policyValid: true,
      wrongNextStep: false,
      duplicateRun: false,
      ignoredHumanFeedback: false
    }
  }));
}

function passingReleaseEvidence() {
  return DEFAULT_EVALUATION_SUITE.cases.map((definition, index) => createEvaluationEvidence({
    caseId: definition.caseId,
    runId: `test-run-${index + 1}`,
    contextHash: contentHash({ caseId: definition.caseId, context: "fixture" }),
    expectedActionHash: contentHash({ action: "expected", caseId: definition.caseId }),
    actualActionHash: contentHash({ action: "expected", caseId: definition.caseId }),
    passed: true,
    completedAt: `2026-08-06T02:0${index}:00.000Z`
  }));
}

async function schedulableEpisode(mode = "assisted") {
  const episode = structuredClone(await readEpisode("golden-001"));
  for (const step of episode.pipeline) {
    step.status = "pending";
    step.requiresApproval = null;
    step.requiresHuman = false;
  }
  episode.pipeline.find((step) => step.agent === "script-agent").status = "ready";
  for (const approval of Object.values(episode.approvals)) approval.status = "pending";
  episode.approvals.research.status = "approved";
  for (const review of Object.values(episode.reviews)) {
    review.status = "not_started";
    review.revisionRounds = 0;
    review.latestReportId = null;
    review.reports = [];
  }
  episode.control.mode = mode;
  episode.control.mainAgentEnabled = true;
  episode.control.modelRouterEnabled = true;
  episode.control.fixedFallbackEnabled = true;
  episode.control.stopRequested = false;
  episode.control.pendingDispatch = null;
  episode.control.budget = {
    maxCalls: 20,
    maxCostUsd: 10,
    usedCalls: 0,
    usedCostUsd: 0
  };
  episode.planHistory = passingShadowRecords();
  episode.evaluationHistory = passingReleaseEvidence();
  episode.dispatchHistory = [];
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
    mutate(mutator) {
      mutator(stored);
    },
    events
  };
}

test("模式只能 shadow -> assisted -> active，且升级依赖影子评测和固定回退", async () => {
  const source = await schedulableEpisode("shadow");
  assert.throws(
    () => transitionControlMode(source, "active"),
    /不允许从 shadow 直接切换到 active/u
  );

  const notReady = structuredClone(source);
  notReady.planHistory[1].evaluation.duplicateRun = true;
  assert.throws(
    () => transitionControlMode(notReady, "assisted"),
    /影子评测尚未达到/u
  );

  const missingFormalEvidence = structuredClone(source);
  missingFormalEvidence.evaluationHistory = [];
  assert.throws(
    () => transitionControlMode(missingFormalEvidence, "assisted"),
    /独立正式评测集尚未达到/u
  );

  const assisted = transitionControlMode(source, "assisted", {
    now: new Date("2026-08-06T03:00:00.000Z")
  });
  assert.equal(assisted.changed, true);
  assert.equal(assisted.evaluation.passed, true);
  assert.equal(assisted.evaluation.release.passedCases, DEFAULT_EVALUATION_SUITE.cases.length);
  assert.equal(assisted.episode.control.fixedFallbackEnabled, true);
  assert.equal(assisted.episode.control.mode, "assisted");

  const active = transitionControlMode(assisted.episode, "active", {
    now: new Date("2026-08-06T03:01:00.000Z")
  });
  assert.equal(active.episode.control.mode, "active");
  assert.equal(active.evaluation.passed, true);
});

test("assisted 只生成待确认调度，人工确认后才运行一次 Worker", async () => {
  const store = memoryStore(await schedulableEpisode("assisted"));
  let workerCalls = 0;
  const prepared = await prepareAssistedDispatch("golden-001", {
    ...store,
    planner: async () => validPlan(),
    runWorker: async () => {
      workerCalls += 1;
    },
    now: new Date("2026-08-06T03:10:00.000Z")
  });
  assert.equal(prepared.status, "waiting_confirmation");
  assert.equal(workerCalls, 0);
  assert.equal(store.episode.control.pendingDispatch.status, "waiting_confirmation");

  const confirmed = await confirmAssistedDispatch(
    "golden-001",
    prepared.pending.id,
    {
      ...store,
      runWorker: async (episodeId, workerId, runOptions) => {
        workerCalls += 1;
        assert.equal(episodeId, "golden-001");
        assert.equal(workerId, "script-agent");
        assert.equal(runOptions.initiator, "main-agent");
        assert.equal(runOptions.taskProfile, "creative-structured");
        assert.equal(runOptions.reviewProfile, "script-v2");
        assert.deepEqual(runOptions.toolIds, []);
        assert.deepEqual(runOptions.limits, { maxAttempts: 1, maxRevisionRounds: 2 });
        assert.match(runOptions.idempotencyKey, /^golden-001:\d+:script-agent:1$/u);
        store.mutate((episode) => {
          episode.pipeline.find((step) => step.agent === workerId).status = "complete";
        });
      },
      now: new Date("2026-08-06T03:11:00.000Z")
    }
  );
  assert.equal(confirmed.status, "completed");
  assert.equal(workerCalls, 1);
  assert.equal(store.episode.control.pendingDispatch, null);
  assert.equal(store.episode.dispatchHistory.at(-1).humanConfirmed, true);
  assert.equal(store.episode.dispatchHistory.at(-1).status, "completed");
  assert.equal(store.episode.dispatchHistory.at(-1).reviewProfile, "script-v2");
});

test("assisted 确认前会重新经 Kernel 校验，过期动作不会执行", async () => {
  const store = memoryStore(await schedulableEpisode("assisted"));
  const prepared = await prepareAssistedDispatch("golden-001", {
    ...store,
    planner: async () => validPlan(),
    now: new Date("2026-08-06T03:20:00.000Z")
  });
  let workerCalls = 0;
  store.mutate((episode) => {
    episode.pipeline.find((step) => step.agent === "script-agent").status = "pending";
  });
  await assert.rejects(
    confirmAssistedDispatch("golden-001", prepared.pending.id, {
      ...store,
      runWorker: async () => {
        workerCalls += 1;
      }
    }),
    /Workflow Kernel 拒绝计划/u
  );
  assert.equal(workerCalls, 0);
});

test("active 仅运行闸门之间的合法动作，到人工审批立即暂停", async () => {
  const store = memoryStore(await schedulableEpisode("active"));
  let workerCalls = 0;
  const result = await runActiveCycle("golden-001", {
    ...store,
    planner: async () => validPlan(),
    runWorker: async (_episodeId, workerId, runOptions) => {
      workerCalls += 1;
      assert.equal(runOptions.initiator, "main-agent");
      assert.equal(runOptions.taskProfile, "creative-structured");
      assert.equal(runOptions.reviewProfile, "script-v2");
      assert.deepEqual(runOptions.toolIds, []);
      store.mutate((episode) => {
        const step = episode.pipeline.find((item) => item.agent === workerId);
        step.status = "waiting_approval";
        step.requiresApproval = "script";
      });
    },
    now: new Date("2026-08-06T03:30:00.000Z")
  });
  assert.equal(workerCalls, 1);
  assert.equal(result.status, "paused");
  assert.equal(result.stop.code, "human_approval");
  assert.equal(result.dispatches.length, 1);
  assert.equal(store.episode.dispatchHistory.at(-1).status, "completed");
});

test("停止、证据冲突、预算、Provider 与连续审核失败都会形成明确暂停原因", async () => {
  const base = await schedulableEpisode("active");

  const stopped = structuredClone(base);
  stopped.control.stopRequested = true;
  assert.equal(controlStopReason(stopped).code, "stop_requested");

  const conflict = structuredClone(base);
  conflict.reviews.research.latestReportId = "report-conflict";
  conflict.reviews.research.reports = [{
    id: "report-conflict",
    blockingIssues: [{ code: "EVIDENCE_CONFLICT" }],
    warnings: []
  }];
  assert.equal(controlStopReason(conflict).code, "evidence_conflict");

  const budget = structuredClone(base);
  budget.control.budget.maxCalls = 0;
  assert.equal(controlStopReason(budget).code, "call_budget_exhausted");

  assert.equal(
    controlStopReason(base, {
      providerHealth: {
        primary: { state: "unavailable" },
        fallback: { state: "unavailable" }
      }
    }).code,
    "provider_unavailable"
  );

  const reviews = structuredClone(base);
  reviews.reviews.script.status = "revision_required";
  reviews.reviews.script.revisionRounds = reviews.control.revisionLimit;
  assert.equal(controlStopReason(reviews).code, "review_revision_limit");
});

test("执行中断会落失败审计并清除 pending，避免重启后重复执行", async () => {
  const episode = await schedulableEpisode("assisted");
  episode.control.pendingDispatch = {
    id: "dispatch-plan-golden-001-v4",
    planId: "plan-golden-001-v4",
    planVersion: 4,
    plan: validPlan(),
    status: "executing",
    createdAt: "2026-08-06T03:40:00.000Z",
    confirmedAt: "2026-08-06T03:41:00.000Z"
  };
  const result = recoverInterruptedDispatch(episode, {
    now: new Date("2026-08-06T03:42:00.000Z")
  });
  assert.equal(result.recovered, true);
  assert.equal(result.episode.control.pendingDispatch, null);
  assert.equal(result.episode.dispatchHistory.at(-1).status, "failed");
  assert.equal(result.episode.dispatchHistory.at(-1).reasonCode, "process_interrupted");
});
