import test from "node:test";
import assert from "node:assert/strict";
import { readFixtureEpisode } from "./episode-fixture.mjs";
import {
  confirmAssistedDispatch,
  controlStopReason,
  prepareAssistedDispatch,
  recoverInterruptedDispatch,
  runActiveCycle,
  setControlMode,
  transitionControlMode
} from "../src/server/control/controlled-dispatch.mjs";

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

async function schedulableEpisode(mode = "assisted", options = {}) {
  const episode = structuredClone(await readFixtureEpisode());
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
  episode.evaluationHistory = [];
  episode.dispatchHistory = [];
  return episode;
}

function memoryStore(initialEpisode) {
  let stored = structuredClone(initialEpisode);
  let writes = 0;
  const events = [];
  return {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      writes += 1;
      stored = structuredClone(episode);
    },
    appendEvent: async (event) => events.push(structuredClone(event)),
    get episode() {
      return structuredClone(stored);
    },
    get writeCount() {
      return writes;
    },
    mutate(mutator) {
      mutator(stored);
    },
    events
  };
}

function rejectsUnavailableAdmission(error, operation) {
  assert.equal(error.code, "control_mode_admission_unavailable");
  assert.equal(error.statusCode, 409);
  assert.equal(error.operation, operation);
  assert.equal(error.safeFallbackMode, "shadow");
  assert.match(error.message, /显式切换到 shadow/u);
  return true;
}

test("缺少可信 Runner attestation 时模式升级始终关闭，调用方不能伪造准入", async () => {
  const referenceSuite = {
    runtimeVerified: true,
    admission: { eligible: false, evidenceClass: "offline-reference-only" }
  };
  const callerForgedSuite = {
    ...referenceSuite,
    admission: {
      eligible: true,
      evidenceClass: "trusted-runner-attested",
      attestationVerified: true
    }
  };
  const source = await schedulableEpisode("shadow");
  assert.throws(
    () => transitionControlMode(source, "active"),
    /不允许从 shadow 直接切换到 active/u
  );
  assert.throws(
    () => transitionControlMode(source, "assisted", {
      evaluationSuite: referenceSuite
    }),
    (error) => error.code === "control_mode_admission_unavailable"
  );
  assert.throws(
    () => transitionControlMode(source, "assisted", {
      evaluationSuite: callerForgedSuite,
      verifyActiveAuthorization: () => true
    }),
    (error) => error.code === "control_mode_admission_unavailable"
  );
  assert.equal(source.control.mode, "shadow");
  assert.equal(source.control.mainAgentEnabled, true);

  const assistedSource = await schedulableEpisode("assisted");
  assert.throws(
    () => transitionControlMode(assistedSource, "active", {
      evaluationSuite: callerForgedSuite,
      activeAuthorization: {
        decision: "authorize_active",
        actorId: "human:release-owner"
      },
      verifyActiveAuthorization: () => true
    }),
    (error) => error.code === "control_mode_admission_unavailable"
  );
  assert.equal(assistedSource.control.mode, "assisted");
});

test("没有评测对象、陈旧证据或调用方注入对象都不能绕过模式锁", async () => {
  const source = await schedulableEpisode("shadow");
  assert.throws(
    () => transitionControlMode(source, "assisted"),
    (error) => error.code === "control_mode_admission_unavailable"
  );

  const stale = structuredClone(source);
  stale.evaluationHistory = [];
  assert.throws(
    () => transitionControlMode(stale, "assisted", {
      evaluationSuite: { runtimeVerified: true, admission: { eligible: true } }
    }),
    (error) => error.code === "control_mode_admission_unavailable"
  );
});

test("评测绑定漂移不阻塞 shadow 同模式请求与高模式紧急降级", async () => {
  let evaluationReads = 0;
  const rejectDriftedSuite = async () => {
    evaluationReads += 1;
    throw new Error("agent-evaluation-suite 运行时绑定不匹配");
  };
  for (const [currentMode, requestedMode] of [
    ["active", "shadow"],
    ["assisted", "shadow"],
    ["shadow", "shadow"]
  ]) {
    const store = memoryStore(await schedulableEpisode(currentMode, {
      skipReleaseEvaluation: true
    }));
    const result = await setControlMode("golden-001", requestedMode, {
      ...store,
      readEvaluationSuite: rejectDriftedSuite,
      now: new Date("2026-08-06T03:05:00.000Z")
    });
    const normalizesLegacyShadow = currentMode === "shadow" && requestedMode === "shadow";
    assert.equal(result.episode.control.mode, requestedMode);
    assert.equal(result.changed, currentMode !== requestedMode || normalizesLegacyShadow);
    assert.equal(
      store.writeCount,
      currentMode !== requestedMode || normalizesLegacyShadow ? 1 : 0
    );
    if (requestedMode === "shadow") {
      assert.equal(result.episode.control.mainAgentEnabled, false);
      assert.equal(result.episode.control.modelRouterEnabled, false);
    }
  }

  for (const [currentMode, requestedMode] of [
    ["active", "active"],
    ["active", "assisted"],
    ["assisted", "assisted"]
  ]) {
    const store = memoryStore(await schedulableEpisode(currentMode));
    await assert.rejects(
      setControlMode("golden-001", requestedMode, {
        ...store,
        readEvaluationSuite: rejectDriftedSuite
      }),
      (error) => rejectsUnavailableAdmission(error, "control mode transition")
    );
    assert.equal(store.writeCount, 0);
    assert.equal(store.episode.control.mode, currentMode);
  }
  assert.equal(evaluationReads, 0);

  const upgradeStore = memoryStore(await schedulableEpisode("shadow", {
    skipReleaseEvaluation: true
  }));
  await assert.rejects(
    setControlMode("golden-001", "assisted", {
      ...upgradeStore,
      readEvaluationSuite: rejectDriftedSuite
    }),
    (error) => error.code === "control_mode_admission_unavailable"
  );
  assert.equal(evaluationReads, 0);
  assert.equal(upgradeStore.writeCount, 0);
  assert.equal(upgradeStore.episode.control.mode, "shadow");
});

test("旧持久化 assisted 即使伪造 admission 且执行开关开启，也不能 prepare", async () => {
  const store = memoryStore(await schedulableEpisode("assisted"));
  store.mutate((episode) => {
    episode.evaluationHistory = [{
      id: "forged-release-attestation",
      admissionEligible: true,
      attestationVerified: true,
      completedAt: "2026-08-01T00:00:00.000Z"
    }];
  });
  let plannerCalls = 0;
  let workerCalls = 0;
  await assert.rejects(
    prepareAssistedDispatch("golden-001", {
      ...store,
      evaluationSuite: {
        admission: {
          eligible: true,
          evidenceClass: "trusted-runner-attested",
          attestationVerified: true
        }
      },
      verifyControlModeAdmission: () => true,
      planner: async () => {
        plannerCalls += 1;
        return validPlan();
      },
      runWorker: async () => {
        workerCalls += 1;
      },
      now: new Date("2026-08-06T03:10:00.000Z")
    }),
    (error) => rejectsUnavailableAdmission(error, "assisted prepare")
  );
  assert.equal(plannerCalls, 0);
  assert.equal(workerCalls, 0);
  assert.equal(store.writeCount, 0);
  assert.equal(store.episode.control.mode, "assisted");
  assert.equal(store.episode.control.mainAgentEnabled, true);
  assert.equal(store.episode.control.modelRouterEnabled, true);
  assert.equal(store.episode.control.pendingDispatch, null);
});

test("旧持久化 assisted pending 即使人工确认也不会执行 Worker", async () => {
  const episode = await schedulableEpisode("assisted");
  const planRecord = {
    id: "plan-stale-assisted-v7",
    version: 7,
    mode: "assisted",
    status: "proposed",
    plan: validPlan()
  };
  episode.control.currentPlan = structuredClone(planRecord);
  episode.control.pendingDispatch = {
    id: "dispatch-plan-stale-assisted-v7",
    planId: planRecord.id,
    planVersion: planRecord.version,
    plan: structuredClone(planRecord.plan),
    status: "waiting_confirmation",
    createdAt: "2026-08-01T00:01:00.000Z"
  };
  const store = memoryStore(episode);
  let workerCalls = 0;
  await assert.rejects(
    confirmAssistedDispatch(
      "golden-001",
      episode.control.pendingDispatch.id,
      {
        ...store,
        activeAuthorization: { decision: "authorize_active" },
        verifyControlModeAdmission: () => true,
        runWorker: async () => {
          workerCalls += 1;
        },
        now: new Date("2026-08-06T03:11:00.000Z")
      }
    ),
    (error) => rejectsUnavailableAdmission(error, "assisted confirm")
  );
  assert.equal(workerCalls, 0);
  assert.equal(store.writeCount, 0);
  assert.equal(store.episode.control.pendingDispatch.status, "waiting_confirmation");
  assert.equal(store.episode.dispatchHistory.length, 0);
});

test("高模式被锁定后可显式降级到 shadow，pending 取消且证据历史保留", async () => {
  const episode = await schedulableEpisode("assisted");
  const planRecord = {
    id: "plan-stale-assisted-v8",
    version: 8,
    mode: "assisted",
    status: "proposed",
    plan: validPlan()
  };
  episode.control.currentPlan = structuredClone(planRecord);
  episode.control.pendingDispatch = {
    id: "dispatch-plan-stale-assisted-v8",
    planId: planRecord.id,
    planVersion: planRecord.version,
    plan: structuredClone(planRecord.plan),
    status: "waiting_confirmation",
    createdAt: "2026-08-01T00:02:00.000Z"
  };
  episode.evaluationHistory = [{ id: "old-evidence-must-remain" }];
  const originalPlanHistory = structuredClone(episode.planHistory);
  const originalEvaluationHistory = structuredClone(episode.evaluationHistory);
  const store = memoryStore(episode);

  const downgraded = await setControlMode("golden-001", "shadow", {
    ...store,
    now: new Date("2026-08-06T03:12:00.000Z")
  });

  assert.equal(downgraded.changed, true);
  assert.equal(downgraded.episode.control.mode, "shadow");
  assert.equal(downgraded.episode.control.mainAgentEnabled, false);
  assert.equal(downgraded.episode.control.modelRouterEnabled, false);
  assert.equal(downgraded.episode.control.pendingDispatch, null);
  assert.deepEqual(downgraded.episode.planHistory, originalPlanHistory);
  assert.deepEqual(downgraded.episode.evaluationHistory, originalEvaluationHistory);
  assert.equal(downgraded.episode.dispatchHistory.at(-1).status, "cancelled");
  assert.equal(downgraded.episode.dispatchHistory.at(-1).reasonCode, "mode_changed");
  assert.equal(store.writeCount, 1);
  assert.equal(store.events.at(-1).type, "control.mode_changed");
  assert.equal(store.events.at(-1).mode, "shadow");
});

test("旧持久化 active 即使伪造 admission 且执行开关开启，也不会规划或执行", async () => {
  const store = memoryStore(await schedulableEpisode("active"));
  let plannerCalls = 0;
  let workerCalls = 0;
  await assert.rejects(
    runActiveCycle("golden-001", {
      ...store,
      evaluationSuite: {
        admission: {
          eligible: true,
          evidenceClass: "trusted-runner-attested",
          attestationVerified: true
        }
      },
      activeAuthorization: {
        decision: "authorize_active",
        actorId: "human:release-owner"
      },
      verifyControlModeAdmission: () => true,
      planner: async () => {
        plannerCalls += 1;
        return validPlan();
      },
      runWorker: async () => {
        workerCalls += 1;
      },
      now: new Date("2026-08-06T03:30:00.000Z")
    }),
    (error) => rejectsUnavailableAdmission(error, "active run")
  );
  assert.equal(plannerCalls, 0);
  assert.equal(workerCalls, 0);
  assert.equal(store.writeCount, 0);
  assert.equal(store.episode.control.mode, "active");
  assert.equal(store.episode.control.mainAgentEnabled, true);
  assert.equal(store.episode.control.modelRouterEnabled, true);
  assert.equal(store.episode.dispatchHistory.length, 0);
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

  const ambiguousBudget = structuredClone(base);
  ambiguousBudget.control.budget.reservations = [{
    id: "route-ambiguous:attempt:1",
    decisionId: "route-ambiguous",
    calls: 1,
    costUsd: 0.2,
    costKnown: true,
    reservedAt: "2026-08-06T03:29:00.000Z"
  }];
  ambiguousBudget.control.budget.reservedCalls = 1;
  ambiguousBudget.control.budget.reservedCostUsd = 0.2;
  ambiguousBudget.control.budget.overrun = true;
  ambiguousBudget.pipeline.find((step) => step.agent === "script-agent").requiresHuman = true;
  ambiguousBudget.history.push({
    type: "budget-reservation-ambiguous",
    status: "ambiguous",
    reservationIds: ["route-ambiguous:attempt:1"]
  });
  const reconciliation = controlStopReason(ambiguousBudget);
  assert.equal(reconciliation.code, "budget_reconciliation_required");
  assert.deepEqual(
    reconciliation.ambiguousReservationIds,
    ["route-ambiguous:attempt:1"]
  );

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
