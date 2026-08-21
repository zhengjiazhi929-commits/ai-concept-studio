import test from "node:test";
import assert from "node:assert/strict";
import { ensureAgentArchitecture } from "../src/shared/agent-contracts.mjs";
import { summarizeAgentOperations } from "../src/server/control/agent-observability.mjs";
import { replayPolicyCases } from "../src/server/control/policy-simulator.mjs";

function plan(cost = 0) {
  return {
    action: "noop",
    workerId: null,
    taskProfile: null,
    reason: "test",
    acceptanceCriteria: [],
    reviewProfile: null,
    toolIds: [],
    estimatedCalls: 0,
    estimatedCostUsd: cost,
    limits: { maxAttempts: 1, maxRevisionRounds: 0 },
    fallbackAction: "noop"
  };
}

test("Agent 指标同时覆盖计划、审核、派发、预算与恢复健康度", () => {
  const episode = ensureAgentArchitecture({
    id: "metrics-episode",
    planHistory: [
      { status: "proposed", evaluation: { wrongNextStep: false, duplicateRun: false } },
      { status: "rejected", evaluation: { wrongNextStep: true, duplicateRun: true } }
    ],
    dispatchHistory: [
      { status: "completed" },
      { status: "failed", reasonCode: "process_interrupted" }
    ],
    reviews: {
      script: {
        status: "revision_required",
        reports: [{ decision: "revise" }]
      }
    },
    control: {
      mode: "shadow",
      stateVersion: 3,
      budget: { maxCostUsd: 1, usedCostUsd: 0.5, usedCalls: 2 }
    }
  });
  const metrics = summarizeAgentOperations(episode);
  assert.equal(metrics.plans.rejectionRate, 0.5);
  assert.equal(metrics.plans.wrongNextStepRate, 0.5);
  assert.equal(metrics.reviews.revised, 1);
  assert.equal(metrics.dispatches.failureRate, 0.5);
  assert.equal(metrics.budget.utilization, 0.5);
  assert.equal(metrics.recovery.interruptedDispatches, 1);
  assert.equal(metrics.slo.healthy, false);
});

test("策略回放明确列出新放行、新阻断和成本变化", () => {
  const cases = [
    { caseId: "cheap", episode: ensureAgentArchitecture({ id: "cheap", pipeline: [] }), plan: plan(0) },
    { caseId: "expensive", episode: ensureAgentArchitecture({ id: "expensive", pipeline: [] }), plan: plan(2) }
  ];
  const currentValidator = () => ({ valid: true, errors: [] });
  const proposedValidator = (_episode, candidate) => candidate.estimatedCostUsd <= 1
    ? { valid: true, errors: [] }
    : { valid: false, errors: ["proposed cost cap"] };
  const replay = replayPolicyCases(cases, { currentValidator, proposedValidator });
  assert.equal(replay.newlyBlocked, 1);
  assert.equal(replay.newlyAllowed, 0);
  assert.equal(replay.results.find((item) => item.caseId === "expensive").change, "newly-blocked");
});
