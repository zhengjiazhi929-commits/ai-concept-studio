import test from "node:test";
import assert from "node:assert/strict";
import { ensureAgentArchitecture } from "../src/shared/agent-contracts.mjs";
import {
  AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
  BudgetReconciliationError,
  BudgetReservationError,
  MAX_RECONCILIATION_COST_USD,
  createEpisodeBudgetLedger,
  getAmbiguousBudgetReservationIds,
  markInterruptedBudgetReservationsAmbiguous
} from "../src/server/control/budget-ledger.mjs";
import { recordRoutingOutcome } from "../src/server/control/workflow-kernel.mjs";

function memoryStore(budgetOverrides = {}) {
  let episode = ensureAgentArchitecture({
    id: "budget-case",
    control: {
      budget: {
        maxCalls: 1,
        maxCostUsd: 1,
        usedCalls: 0,
        usedCostUsd: 0,
        ...budgetOverrides
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
    usedCostUsd: 0.15,
    settlementStatus: "completed_success",
    providerId: "test",
    model: "model-a",
    attempt: 1
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
  const settlement = settled.history.find(
    (entry) => entry.type === "budget-reservation-settled"
  );
  assert.equal(settlement.settlementStatus, "completed_success");
  assert.equal(settlement.usedCalls, 1);
  assert.equal(settlement.usedCostUsd, 0.15);

  const duplicate = recordRoutingOutcome(settled, completedDecision(), {
    callCount: 1,
    costUsd: 0.15
  });
  assert.equal(duplicate.control.budget.usedCalls, 1);
  assert.equal(duplicate.control.budget.usedCostUsd, 0.15);
});

test("中断的 Provider 预算预留保持冻结，人工显式对账前不能重试或按默认值释放", async () => {
  const store = memoryStore();
  const ledger = createEpisodeBudgetLedger(store);
  await ledger.reserve({
    episodeId: "budget-case",
    reservationId: "route-ambiguous:attempt:1",
    decisionId: "route-ambiguous",
    calls: 1,
    costUsd: 0.2,
    now: new Date("2026-08-06T06:10:00.000Z")
  });
  const marked = markInterruptedBudgetReservationsAmbiguous(store.episode, {
    now: new Date("2026-08-06T06:11:00.000Z")
  });
  await store.writeEpisode(marked.episode);

  assert.deepEqual(marked.reservationIds, ["route-ambiguous:attempt:1"]);
  assert.deepEqual(
    getAmbiguousBudgetReservationIds(store.episode),
    ["route-ambiguous:attempt:1"]
  );
  assert.equal(store.episode.control.budget.reservedCalls, 1);
  assert.equal(store.episode.control.budget.reservedCostUsd, 0.2);
  assert.equal(store.episode.control.budget.overrun, true);

  await assert.rejects(
    ledger.reserve({
      episodeId: "budget-case",
      reservationId: "route-retry:attempt:1",
      calls: 1,
      costUsd: 0.2
    }),
    (error) => (
      error instanceof BudgetReservationError &&
      error.details.reasonCode === "budget_reconciliation_required"
    )
  );
  await assert.rejects(
    ledger.settle({
      episodeId: "budget-case",
      reservationId: "route-ambiguous:attempt:1",
      reconciled: true,
      usedCalls: 0,
      usedCostUsd: 0
    }),
    (error) => (
      error instanceof BudgetReconciliationError &&
      error.code === "budget_reconciliation_required"
    )
  );

  await assert.rejects(
    ledger.reconcileAmbiguous({
      episodeId: "budget-case",
      reservationId: "route-ambiguous:attempt:1",
      actor: "human:test-reviewer",
      confirmation: "wrong",
      usedCalls: 1,
      usedCostUsd: 0.17
    }),
    (error) => (
      error instanceof BudgetReconciliationError &&
      error.code === "budget_reconciliation_confirmation_required"
    )
  );

  for (const invalidUsage of [
    { usedCalls: Number.MAX_SAFE_INTEGER + 1, usedCostUsd: 0.17 },
    { usedCalls: 1, usedCostUsd: 1e308 }
  ]) {
    const beforeInvalidUsage = JSON.stringify(store.episode);
    await assert.rejects(
      ledger.reconcileAmbiguous({
        episodeId: "budget-case",
        reservationId: "route-ambiguous:attempt:1",
        actor: "human:test-reviewer",
        confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
        ...invalidUsage
      }),
      (error) => (
        error instanceof BudgetReconciliationError &&
        error.code === "budget_reconciliation_usage_invalid"
      )
    );
    assert.equal(JSON.stringify(store.episode), beforeInvalidUsage);
  }

  await ledger.reconcileAmbiguous({
    episodeId: "budget-case",
    reservationId: "route-ambiguous:attempt:1",
    actor: "human:test-reviewer",
    confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
    usedCalls: 1,
    usedCostUsd: 0.17,
    now: new Date("2026-08-06T06:12:00.000Z")
  });
  assert.equal(store.episode.control.budget.reservedCalls, 0);
  assert.equal(store.episode.control.budget.reservedCostUsd, 0);
  assert.equal(store.episode.control.budget.usedCalls, 1);
  assert.equal(store.episode.control.budget.usedCostUsd, 0.17);
  assert.equal(store.episode.control.budget.overrun, false);
  assert.deepEqual(getAmbiguousBudgetReservationIds(store.episode), []);
  assert.equal(store.episode.history.at(-1).type, "budget-reservation-reconciled");
  assert.equal(store.episode.history.at(-1).actor, "human:test-reviewer");
  assert.equal(store.episode.history.at(-1).confirmed, true);
  assert.equal(store.episode.history.at(-1).actualOverrun, false);

  await assert.rejects(
    ledger.reconcileAmbiguous({
      episodeId: "budget-case",
      reservationId: "route-ambiguous:attempt:1",
      actor: "human:test-reviewer",
      confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
      usedCalls: 1,
      usedCostUsd: 0.17
    }),
    (error) => (
      error instanceof BudgetReconciliationError &&
      error.code === "budget_reconciliation_already_settled" &&
      error.statusCode === 409
    )
  );
});

test("运行中的 Provider 调用一旦结果不明就原子标记歧义并保留预算预留", async () => {
  const store = memoryStore();
  const ledger = createEpisodeBudgetLedger(store);
  await ledger.reserve({
    episodeId: "budget-case",
    reservationId: "route-runtime-ambiguous:attempt:1",
    decisionId: "route-runtime-ambiguous",
    calls: 1,
    costUsd: 0.2,
    now: new Date("2026-08-06T07:00:00.000Z")
  });

  const dispatched = await ledger.markDispatched({
    episodeId: "budget-case",
    reservationId: "route-runtime-ambiguous:attempt:1",
    providerId: "provider-test",
    model: "model-test",
    attempt: 1,
    now: new Date("2026-08-06T07:00:30.000Z")
  });
  assert.equal(dispatched.reservation.dispatchState, "dispatching");
  assert.deepEqual(
    getAmbiguousBudgetReservationIds(store.episode),
    ["route-runtime-ambiguous:attempt:1"]
  );

  const marked = await ledger.markAmbiguous({
    episodeId: "budget-case",
    reservationId: "route-runtime-ambiguous:attempt:1",
    providerId: "provider-test",
    model: "model-test",
    attempt: 1,
    failureCode: "provider_call_ambiguous",
    now: new Date("2026-08-06T07:01:00.000Z")
  });
  const repeated = await ledger.markAmbiguous({
    episodeId: "budget-case",
    reservationId: "route-runtime-ambiguous:attempt:1",
    providerId: "provider-test",
    model: "model-test",
    attempt: 1,
    failureCode: "provider_call_ambiguous",
    now: new Date("2026-08-06T07:02:00.000Z")
  });

  assert.equal(marked.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(store.episode.control.budget.reservedCalls, 1);
  assert.equal(store.episode.control.budget.reservedCostUsd, 0.2);
  assert.equal(store.episode.control.budget.usedCalls, 0);
  assert.equal(store.episode.control.budget.usedCostUsd, 0);
  assert.equal(store.episode.control.budget.overrun, true);
  assert.deepEqual(
    getAmbiguousBudgetReservationIds(store.episode),
    ["route-runtime-ambiguous:attempt:1"]
  );
  const ambiguityEvents = store.episode.history.filter(
    (entry) => entry.type === "budget-reservation-ambiguous"
  );
  assert.equal(ambiguityEvents.length, 1);
  assert.equal(ambiguityEvents[0].failureCode, "provider_call_ambiguous");
  assert.equal(ambiguityEvents[0].providerId, "provider-test");
  assert.equal(ambiguityEvents[0].model, "model-test");
  assert.equal(ambiguityEvents[0].attempt, 1);
});

test("人工对账累计调用数或六位小数费用溢出时拒绝写入", async () => {
  for (const scenario of [
    {
      id: "calls",
      budget: { usedCalls: Number.MAX_SAFE_INTEGER, usedCostUsd: 0 },
      usage: { usedCalls: 1, usedCostUsd: 0 }
    },
    {
      id: "cost",
      budget: { usedCalls: 0, usedCostUsd: MAX_RECONCILIATION_COST_USD },
      usage: { usedCalls: 0, usedCostUsd: 1 }
    }
  ]) {
    const store = memoryStore({
      maxCalls: null,
      maxCostUsd: null,
      ...scenario.budget
    });
    const reservationId = `route-total-overflow-${scenario.id}:attempt:1`;
    const source = store.episode;
    source.control.budget.reservations = [{
      id: reservationId,
      decisionId: `route-total-overflow-${scenario.id}`,
      calls: 1,
      costUsd: 0.1,
      costKnown: true,
      reservedAt: "2026-08-06T07:00:00.000Z"
    }];
    source.control.budget.reservedCalls = 1;
    source.control.budget.reservedCostUsd = 0.1;
    const marked = markInterruptedBudgetReservationsAmbiguous(source, {
      now: new Date("2026-08-06T07:01:00.000Z")
    });
    await store.writeEpisode(marked.episode);
    const ledger = createEpisodeBudgetLedger(store);
    const before = JSON.stringify(store.episode);
    await assert.rejects(
      ledger.reconcileAmbiguous({
        episodeId: "budget-case",
        reservationId,
        actor: "human:test-reviewer",
        confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
        ...scenario.usage
      }),
      (error) => (
        error instanceof BudgetReconciliationError &&
        error.code === "budget_reconciliation_total_unsafe" &&
        error.statusCode === 409
      )
    );
    assert.equal(JSON.stringify(store.episode), before);
  }
});

test("多笔中断预留逐笔对账时不会丢失先前已经确认的真实超额", async () => {
  const store = memoryStore({ maxCalls: 10, maxCostUsd: 10 });
  const ledger = createEpisodeBudgetLedger(store);
  for (const [index, costUsd] of [0.2, 0.2].entries()) {
    await ledger.reserve({
      episodeId: "budget-case",
      reservationId: `route-multiple:attempt:${index + 1}`,
      decisionId: "route-multiple",
      calls: 1,
      costUsd,
      now: new Date(`2026-08-06T06:2${index}:00.000Z`)
    });
  }
  const marked = markInterruptedBudgetReservationsAmbiguous(store.episode, {
    now: new Date("2026-08-06T06:22:00.000Z")
  });
  await store.writeEpisode(marked.episode);

  await ledger.reconcileAmbiguous({
    episodeId: "budget-case",
    reservationId: "route-multiple:attempt:1",
    actor: "human:test-reviewer",
    confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
    usedCalls: 1,
    usedCostUsd: 0.3,
    now: new Date("2026-08-06T06:23:00.000Z")
  });
  assert.equal(store.episode.control.budget.overrun, true);
  assert.equal(store.episode.history.at(-1).actualOverrun, true);

  await ledger.reconcileAmbiguous({
    episodeId: "budget-case",
    reservationId: "route-multiple:attempt:2",
    actor: "human:test-reviewer",
    confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
    usedCalls: 1,
    usedCostUsd: 0.1,
    now: new Date("2026-08-06T06:24:00.000Z")
  });
  assert.equal(store.episode.control.budget.reservedCalls, 0);
  assert.equal(store.episode.control.budget.reservedCostUsd, 0);
  assert.equal(store.episode.control.budget.usedCalls, 2);
  assert.equal(store.episode.control.budget.usedCostUsd, 0.4);
  assert.equal(store.episode.control.budget.overrun, true);
  assert.deepEqual(getAmbiguousBudgetReservationIds(store.episode), []);
  assert.deepEqual(
    store.episode.history
      .filter((entry) => entry.type === "budget-reservation-reconciled")
      .map((entry) => entry.actualOverrun),
    [true, false]
  );
});

test("中断前已经存在的真实 overrun 不会被纯歧义对账清除", async () => {
  const store = memoryStore({ maxCalls: 10, maxCostUsd: 10 });
  const ledger = createEpisodeBudgetLedger(store);
  await ledger.reserve({
    episodeId: "budget-case",
    reservationId: "route-existing-overrun:attempt:1",
    calls: 1,
    costUsd: 0.2
  });
  const beforeRecovery = store.episode;
  beforeRecovery.control.budget.overrun = true;
  const marked = markInterruptedBudgetReservationsAmbiguous(beforeRecovery, {
    now: new Date("2026-08-06T06:30:00.000Z")
  });
  await store.writeEpisode(marked.episode);
  assert.equal(
    store.episode.history.find(
      (entry) => entry.type === "budget-reservation-ambiguous"
    ).previousOverrun,
    true
  );

  await ledger.reconcileAmbiguous({
    episodeId: "budget-case",
    reservationId: "route-existing-overrun:attempt:1",
    actor: "human:test-reviewer",
    confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
    usedCalls: 1,
    usedCostUsd: 0.1
  });
  assert.equal(store.episode.control.budget.overrun, true);
  assert.equal(store.episode.history.at(-1).actualOverrun, false);
});
