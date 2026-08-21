import test from "node:test";
import assert from "node:assert/strict";
import { ensureAgentArchitecture } from "../src/shared/agent-contracts.mjs";
import {
  BudgetReservationError,
  createEpisodeBudgetLedger
} from "../src/server/control/budget-ledger.mjs";
import { recordRoutingOutcome } from "../src/server/control/workflow-kernel.mjs";

function memoryStore() {
  let episode = ensureAgentArchitecture({
    id: "budget-case",
    control: {
      budget: {
        maxCalls: 1,
        maxCostUsd: 1,
        usedCalls: 0,
        usedCostUsd: 0
      }
    },
    routingHistory: []
  });
  return {
    readEpisode: async () => structuredClone(episode),
    writeEpisode: async (next) => {
      episode = ensureAgentArchitecture(next);
    },
    get episode() {
      return structuredClone(episode);
    }
  };
}

function completedDecision() {
  return {
    id: "route-budget-case",
    profile: "creative-structured",
    reason: "test durable budget accounting",
    candidates: [],
    selected: { providerId: "test", model: "model-a" },
    estimatedCostUsd: 0.2,
    outcome: {
      status: "succeeded",
      actualCostUsd: 0.15,
      accountedCostUsd: 0.15,
      budgetAccounted: true
    }
  };
}

test("模型请求前会持久化预算预留，并以实时状态阻止并发超额请求", async () => {
  const store = memoryStore();
  const ledger = createEpisodeBudgetLedger(store);
  await ledger.reserve({
    episodeId: "budget-case",
    reservationId: "route-1:attempt:1",
    decisionId: "route-1",
    calls: 1,
    costUsd: 0.25,
    now: new Date("2026-08-06T06:00:00.000Z")
  });
  assert.equal(store.episode.control.budget.reservedCalls, 1);
  assert.equal(store.episode.control.budget.reservedCostUsd, 0.25);
  assert.equal(store.episode.control.budget.reservations.length, 1);

  await assert.rejects(
    ledger.reserve({
      episodeId: "budget-case",
      reservationId: "route-2:attempt:1",
      decisionId: "route-2",
      calls: 1,
      costUsd: 0.25
    }),
    (error) => error instanceof BudgetReservationError && error.requiresHuman
  );
});

test("模型请求后原子结算已用预算，路由重复记录不会二次计费", async () => {
  const store = memoryStore();
  const ledger = createEpisodeBudgetLedger(store);
  await ledger.reserve({
    episodeId: "budget-case",
    reservationId: "route-budget-case:attempt:1",
    decisionId: "route-budget-case",
    calls: 1,
    costUsd: 0.2
  });
  await ledger.settle({
    episodeId: "budget-case",
    reservationId: "route-budget-case:attempt:1",
    usedCalls: 1,
    usedCostUsd: 0.15
  });
  await ledger.recordDecision({
    episodeId: "budget-case",
    decision: completedDecision()
  });
  const settled = store.episode;
  assert.equal(settled.control.budget.reservedCalls, 0);
  assert.equal(settled.control.budget.reservedCostUsd, 0);
  assert.equal(settled.control.budget.usedCalls, 1);
  assert.equal(settled.control.budget.usedCostUsd, 0.15);
  assert.equal(settled.routingHistory.length, 1);

  const duplicate = recordRoutingOutcome(settled, completedDecision(), {
    callCount: 1,
    costUsd: 0.15
  });
  assert.equal(duplicate.control.budget.usedCalls, 1);
  assert.equal(duplicate.control.budget.usedCostUsd, 0.15);
});
