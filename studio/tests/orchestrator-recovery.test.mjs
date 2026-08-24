import test from "node:test";
import assert from "node:assert/strict";
import { readFixtureEpisode } from "./episode-fixture.mjs";
import {
  reconcileEpisodeArtifacts,
  recoverInterruptedEpisode
} from "../src/server/orchestrator.mjs";
import {
  AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
  createEpisodeBudgetLedger,
  getAmbiguousBudgetReservationIds
} from "../src/server/control/budget-ledger.mjs";
import { controlStopReason } from "../src/server/control/controlled-dispatch.mjs";
import { assertWorkerRunAllowed } from "../src/server/control/workflow-kernel.mjs";
import {
  currentGateArtifactHash,
  currentGateVersion
} from "../src/shared/workflow.mjs";

test("进程中断后的 running 步骤会恢复为可重试失败状态", async () => {
  const episode = structuredClone(await readFixtureEpisode());
  const voice = episode.pipeline.find((step) => step.agent === "voice-agent");
  voice.status = "running";
  voice.progress = 0.45;
  episode.reviews.assets = {
    ...episode.reviews.assets,
    status: "checking",
    artifactVersion: 1
  };
  episode.control.planVersion = 1;
  episode.control.currentPlan = {
    id: "plan-golden-001-v1",
    version: 1,
    mode: "shadow",
    status: "planning",
    startedAt: "2026-08-03T23:59:00.000Z"
  };
  episode.control.pendingDispatch = {
    id: "dispatch-plan-golden-001-v1",
    planId: "plan-golden-001-v1",
    planVersion: 1,
    plan: { action: "run_worker", workerId: "voice-agent" },
    status: "executing",
    createdAt: "2026-08-03T23:59:10.000Z",
    confirmedAt: "2026-08-03T23:59:20.000Z"
  };
  episode.control.activeOperation = {
    id: "operation:worker:golden-001:voice-agent:test",
    kind: "worker:voice-agent",
    startedAt: "2026-08-03T23:59:00.000Z"
  };
  episode.control.budget.reservedCalls = 1;
  episode.control.budget.reservedCostUsd = 0.25;
  episode.control.budget.reservations = [{
    id: "route-recovery:attempt:1",
    decisionId: "route-recovery",
    calls: 1,
    costUsd: 0.25,
    costKnown: true,
    reservedAt: "2026-08-03T23:59:30.000Z"
  }];
  const at = new Date("2026-08-04T00:00:00.000Z");
  const result = recoverInterruptedEpisode(episode, at);
  const recovered = result.episode.pipeline.find((step) => step.agent === "voice-agent");
  assert.deepEqual(result.recoveredAgents, ["voice-agent"]);
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.progress, 0);
  assert.equal(recovered.lastError, "provider_call_ambiguous");
  assert.equal(recovered.requiresHuman, true);
  assert.equal(result.episode.history.at(-1).type, "agent-recovered");
  assert.deepEqual(result.recoveredReviewStages, ["assets"]);
  assert.equal(result.episode.reviews.assets.status, "not_started");
  assert.equal(result.episode.reviews.assets.artifactVersion, 1);
  assert.equal(result.recoveredPlan, true);
  assert.equal(result.episode.control.currentPlan.status, "failed");
  assert.equal(result.episode.planHistory.at(-1).errorCode, "process_interrupted");
  assert.equal(result.recoveredDispatch, true);
  assert.equal(result.episode.control.pendingDispatch, null);
  assert.equal(result.episode.dispatchHistory.at(-1).reasonCode, "process_interrupted");
  assert.deepEqual(result.recoveredBudgetReservations, ["route-recovery:attempt:1"]);
  assert.equal(result.recoveredOperation.kind, "worker:voice-agent");
  assert.equal(result.episode.control.activeOperation, null);
  assert.equal(result.episode.control.budget.reservedCalls, 1);
  assert.equal(result.episode.control.budget.reservedCostUsd, 0.25);
  assert.equal(result.episode.control.budget.overrun, true);
  assert.deepEqual(
    result.episode.control.budget.reservations.map((item) => item.id),
    ["route-recovery:attempt:1"]
  );
  const ambiguity = result.episode.history.find(
    (entry) => entry.type === "budget-reservation-ambiguous"
  );
  assert.equal(ambiguity.status, "ambiguous");
  assert.deepEqual(ambiguity.reservationIds, ["route-recovery:attempt:1"]);

  const repeated = recoverInterruptedEpisode(
    result.episode,
    new Date("2026-08-04T00:01:00.000Z")
  );
  assert.deepEqual(repeated.recoveredBudgetReservations, []);
  assert.equal(
    repeated.episode.history.filter(
      (entry) => entry.type === "budget-reservation-ambiguous"
    ).length,
    1
  );
  assert.equal(repeated.episode.control.budget.reservedCalls, 1);

  let stored = structuredClone(result.episode);
  const ledger = createEpisodeBudgetLedger({
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (next) => {
      stored = structuredClone(next);
    }
  });
  assert.equal(controlStopReason(stored).code, "budget_reconciliation_required");
  await ledger.reconcileAmbiguous({
    episodeId: stored.id,
    reservationId: "route-recovery:attempt:1",
    actor: "human:recovery-reviewer",
    confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
    usedCalls: 1,
    usedCostUsd: 0.2,
    now: new Date("2026-08-04T00:02:00.000Z")
  });
  const reconciledVoice = stored.pipeline.find((step) => step.agent === "voice-agent");
  assert.deepEqual(getAmbiguousBudgetReservationIds(stored), []);
  assert.equal(stored.control.budget.overrun, false);
  assert.equal(reconciledVoice.status, "failed");
  assert.equal(reconciledVoice.requiresHuman, false);
  assert.equal(reconciledVoice.lastError, null);
  assert.equal(controlStopReason(stored), null);
  stored.control.reviewEnabled = false;
  for (const gate of ["research", "script", "storyboard"]) {
    stored.approvals[gate].status = "approved";
    stored.approvals[gate].currentVersion = currentGateVersion(stored, gate);
    stored.approvals[gate].artifactHash = currentGateArtifactHash(stored, gate);
  }
  assert.doesNotThrow(() => assertWorkerRunAllowed(stored, "voice-agent"));
  const reconciliation = stored.history.at(-1);
  assert.equal(reconciliation.actor, "human:recovery-reviewer");
  assert.deepEqual(reconciliation.unfrozenAgentIds, ["voice-agent"]);
});

test("Provider 已成功结算但产物提交状态不明时，恢复必须冻结而不能称为安全重试", async () => {
  const episode = structuredClone(await readFixtureEpisode());
  const script = episode.pipeline.find((step) => step.agent === "script-agent");
  script.status = "running";
  script.startedAt = "2026-08-24T07:00:00.000Z";
  script.requiresHuman = false;
  episode.control.activeOperation = {
    id: "operation:worker:golden-001:script-agent:commit-window",
    kind: "worker:script-agent",
    startedAt: script.startedAt
  };
  episode.control.budget.usedCalls = 1;
  episode.control.budget.usedCostUsd = 0.15;
  episode.control.budget.reservedCalls = 0;
  episode.control.budget.reservedCostUsd = 0;
  episode.control.budget.reservations = [];
  episode.history.push({
    at: "2026-08-24T07:00:01.000Z",
    type: "budget-reservation-settled",
    status: "settled",
    settlementStatus: "completed_success",
    reservationId: "route-commit-window:attempt:1",
    reservationIds: ["route-commit-window:attempt:1"],
    decisionId: "route-commit-window",
    providerId: "provider-test",
    model: "model-test",
    attempt: 1,
    usedCalls: 1,
    usedCostUsd: 0.15
  });

  const recovered = recoverInterruptedEpisode(
    episode,
    new Date("2026-08-24T07:01:00.000Z")
  );
  const recoveredScript = recovered.episode.pipeline.find(
    (step) => step.agent === "script-agent"
  );
  assert.deepEqual(recovered.ambiguousBudgetReservations, []);
  assert.deepEqual(
    recovered.uncommittedProviderResultIds,
    ["route-commit-window:attempt:1"]
  );
  assert.equal(recoveredScript.status, "failed");
  assert.equal(recoveredScript.requiresHuman, true);
  assert.equal(recoveredScript.lastError, "provider_result_commit_unknown");
  assert.deepEqual(
    recoveredScript.uncommittedProviderResultIds,
    ["route-commit-window:attempt:1"]
  );
  assert.match(recoveredScript.message, /不能自动重试/u);
  assert.throws(
    () => assertWorkerRunAllowed(recovered.episode, "script-agent"),
    /等待人工输入/u
  );
});

test("已有 ambiguity 再次恢复仍冻结；部分对账、真实超额和原人工原因都不会误解冻", async () => {
  const source = structuredClone(await readFixtureEpisode());
  const voice = source.pipeline.find((step) => step.agent === "voice-agent");
  voice.status = "running";
  voice.requiresHuman = false;
  source.control.budget.reservations = [
    {
      id: "route-partial:attempt:1",
      decisionId: "route-partial",
      calls: 1,
      costUsd: 0.2,
      costKnown: true,
      reservedAt: "2026-08-04T01:00:00.000Z"
    },
    {
      id: "route-partial:attempt:2",
      decisionId: "route-partial",
      calls: 1,
      costUsd: 0.2,
      costKnown: true,
      reservedAt: "2026-08-04T01:00:01.000Z"
    }
  ];
  source.control.budget.reservedCalls = 2;
  source.control.budget.reservedCostUsd = 0.4;
  let stored = recoverInterruptedEpisode(
    source,
    new Date("2026-08-04T01:01:00.000Z")
  ).episode;
  const ledger = createEpisodeBudgetLedger({
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (next) => {
      stored = structuredClone(next);
    }
  });
  await ledger.reconcileAmbiguous({
    episodeId: stored.id,
    reservationId: "route-partial:attempt:1",
    actor: "human:recovery-reviewer",
    confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
    usedCalls: 1,
    usedCostUsd: 0.1
  });
  assert.deepEqual(getAmbiguousBudgetReservationIds(stored), ["route-partial:attempt:2"]);
  assert.equal(stored.pipeline.find((step) => step.agent === "voice-agent").requiresHuman, true);
  assert.equal(controlStopReason(stored).code, "budget_reconciliation_required");

  const existingAmbiguity = structuredClone(stored);
  const render = existingAmbiguity.pipeline.find((step) => step.agent === "render-agent");
  render.status = "running";
  render.requiresHuman = false;
  const repeatedRecovery = recoverInterruptedEpisode(
    existingAmbiguity,
    new Date("2026-08-04T01:02:00.000Z")
  );
  const recoveredRender = repeatedRecovery.episode.pipeline.find(
    (step) => step.agent === "render-agent"
  );
  assert.deepEqual(repeatedRecovery.recoveredBudgetReservations, []);
  assert.deepEqual(
    repeatedRecovery.ambiguousBudgetReservations,
    ["route-partial:attempt:2"]
  );
  assert.equal(recoveredRender.lastError, "provider_call_ambiguous");
  assert.equal(recoveredRender.requiresHuman, true);
  assert.match(recoveredRender.message, /必须先人工核对/u);

  stored = repeatedRecovery.episode;
  await ledger.reconcileAmbiguous({
    episodeId: stored.id,
    reservationId: "route-partial:attempt:2",
    actor: "human:recovery-reviewer",
    confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
    usedCalls: 1,
    usedCostUsd: 0.3
  });
  assert.deepEqual(getAmbiguousBudgetReservationIds(stored), []);
  assert.equal(stored.control.budget.overrun, true);
  assert.equal(stored.history.at(-1).actualOverrun, true);
  assert.deepEqual(stored.history.at(-1).unfrozenAgentIds, []);
  assert.equal(stored.pipeline.find((step) => step.agent === "voice-agent").requiresHuman, true);
  assert.equal(stored.pipeline.find((step) => step.agent === "render-agent").requiresHuman, true);
  assert.throws(() => assertWorkerRunAllowed(stored, "voice-agent"), /等待人工输入/u);

  const originalHuman = structuredClone(await readFixtureEpisode());
  const originalVoice = originalHuman.pipeline.find((step) => step.agent === "voice-agent");
  originalVoice.status = "running";
  originalVoice.requiresHuman = true;
  originalHuman.control.budget.reservations = [{
    id: "route-original-human:attempt:1",
    decisionId: "route-original-human",
    calls: 1,
    costUsd: 0.2,
    costKnown: true,
    reservedAt: "2026-08-04T02:00:00.000Z"
  }];
  originalHuman.control.budget.reservedCalls = 1;
  originalHuman.control.budget.reservedCostUsd = 0.2;
  let originalStored = recoverInterruptedEpisode(
    originalHuman,
    new Date("2026-08-04T02:01:00.000Z")
  ).episode;
  const originalLedger = createEpisodeBudgetLedger({
    readEpisode: async () => structuredClone(originalStored),
    writeEpisode: async (next) => {
      originalStored = structuredClone(next);
    }
  });
  await originalLedger.reconcileAmbiguous({
    episodeId: originalStored.id,
    reservationId: "route-original-human:attempt:1",
    actor: "human:recovery-reviewer",
    confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
    usedCalls: 1,
    usedCostUsd: 0.1
  });
  assert.equal(
    originalStored.pipeline.find((step) => step.agent === "voice-agent").requiresHuman,
    true
  );
  assert.deepEqual(originalStored.history.at(-1).unfrozenAgentIds, []);
});

test("状态登记为完成但成片缺失时会撤销旧 QA", async () => {
  const episode = structuredClone(await readFixtureEpisode());
  episode.render.status = "complete";
  episode.render.outputPath = "outputs/studio/golden-001/missing-preview.mp4";
  episode.qa.status = "passed";
  episode.pipeline.find((step) => step.agent === "render-agent").status = "complete";
  episode.pipeline.find((step) => step.agent === "qa-agent").status = "complete";
  const result = await reconcileEpisodeArtifacts(episode, {
    now: new Date("2026-08-04T00:00:00.000Z"),
    access: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
  });
  assert.equal(result.changed, true);
  assert.equal(result.episode.render.status, "missing");
  assert.equal(result.episode.qa.status, "stale");
  assert.equal(
    result.episode.pipeline.find((step) => step.agent === "render-agent").status,
    "failed"
  );
  assert.equal(
    result.episode.pipeline.find((step) => step.agent === "qa-agent").status,
    "blocked"
  );
});

test("恢复检查发现同路径成片被替换时会撤销旧 QA、机器审核和人工终审", async () => {
  const episode = structuredClone(await readFixtureEpisode());
  episode.status = "approved";
  episode.render = {
    ...episode.render,
    version: 1,
    status: "complete",
    outputPath: "outputs/studio/golden-001/preview-v001.mp4",
    bytes: 60_001,
    sha256: "a".repeat(64)
  };
  episode.qa.status = "passed";
  episode.approvals.final.status = "approved";
  episode.approvals.final.currentVersion = 1;
  episode.reviews.final.status = "passed";
  episode.pipeline.find((step) => step.agent === "render-agent").status = "complete";
  episode.pipeline.find((step) => step.agent === "qa-agent").status = "complete";
  const result = await reconcileEpisodeArtifacts(episode, {
    now: new Date("2026-08-04T00:00:00.000Z"),
    access: async () => undefined,
    inspectFileIntegrity: async () => ({ bytes: 60_001, sha256: "b".repeat(64) })
  });
  assert.equal(result.changed, true);
  assert.equal(result.missingRender, false);
  assert.equal(result.invalidRenderIntegrity, true);
  assert.equal(result.episode.render.status, "invalid");
  assert.equal(result.episode.qa.status, "stale");
  assert.equal(result.episode.approvals.final.status, "pending");
  assert.equal(result.episode.reviews.final.status, "not_started");
  assert.equal(result.episode.status, "in_production");
});
