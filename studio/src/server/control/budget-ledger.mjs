import { ensureAgentArchitecture, validateRoutingDecision } from "../../shared/agent-contracts.mjs";
import { readEpisode, writeEpisode } from "../../shared/store.mjs";
import { recordRoutingOutcome } from "./workflow-kernel.mjs";

export class BudgetReservationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "BudgetReservationError";
    this.code = "budget_reservation_denied";
    this.requiresHuman = true;
    this.details = details;
  }
}

export const AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION =
  "CONFIRM_AMBIGUOUS_PROVIDER_BUDGET_RECONCILIATION";
const USD_MICRO_SCALE = 1_000_000;
export const MAX_RECONCILIATION_COST_USD = Math.floor(
  Number.MAX_SAFE_INTEGER / USD_MICRO_SCALE
);

export class BudgetReconciliationError extends Error {
  constructor(message, code, details = {}, statusCode = 400) {
    super(message);
    this.name = "BudgetReconciliationError";
    this.code = code;
    this.requiresHuman = true;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function conflict(error) {
  return error?.code === "state_version_conflict" || error?.code === "state_lock_timeout";
}

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function nonNegativeInteger(value, fallback = 0) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function nonNegativeNumber(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function reservationIds(episode) {
  return new Set((episode.control?.budget?.reservations ?? []).map((item) => item.id));
}

function reservationIsProvablyUndispatched(reservation) {
  return Boolean(
    reservation?.dispatchState === "reserved" &&
    Number.isInteger(reservation.calls) &&
    reservation.calls >= 0 &&
    Number.isFinite(reservation.costUsd) &&
    reservation.costUsd >= 0 &&
    typeof reservation.costKnown === "boolean" &&
    (reservation.costKnown || reservation.costUsd === 0) &&
    typeof reservation.reservedAt === "string" &&
    !Number.isNaN(Date.parse(reservation.reservedAt)) &&
    reservation.dispatchedAt === null &&
    reservation.providerId === null &&
    reservation.model === null &&
    reservation.attempt === null
  );
}

function ambiguityEvents(episode) {
  return (episode.history ?? []).filter((entry) => (
    entry?.type === "budget-reservation-ambiguous" &&
    entry?.status === "ambiguous" &&
    Array.isArray(entry.reservationIds)
  ));
}

function reservationRequiresReconciliation(episode, reservationId) {
  const reservation = episode.control?.budget?.reservations
    ?.find((item) => item.id === reservationId);
  return Boolean(
    reservation?.dispatchState === "ambiguous" ||
    ambiguityEvents(episode).some((entry) => entry.reservationIds.includes(reservationId))
  );
}

function hasHistoricalActualOverrun(episode) {
  return (episode.history ?? []).some((entry) => (
    entry?.type === "budget-reservation-reconciled" &&
    entry?.status === "settled" &&
    entry?.actualOverrun === true
  ));
}

function hasHistoricalPriorOverrun(episode) {
  return ambiguityEvents(episode).some((entry) => entry.previousOverrun === true);
}

function actualReservationOverrun(budget, reservation, usedCalls, usedCostUsd) {
  return Boolean(
    usedCalls > reservation.calls ||
    (reservation.costKnown && usedCostUsd > reservation.costUsd) ||
    (budget.maxCalls !== null && budget.usedCalls > budget.maxCalls) ||
    (budget.maxCostUsd !== null && budget.usedCostUsd > budget.maxCostUsd)
  );
}

function releaseRecoveredWorkerFreezes(episode, reconciledReservationId) {
  const releasedAgentIds = [];
  for (const record of episode.history ?? []) {
    if (
      !new Set(["agent-recovered", "agent-run"]).has(record?.type) ||
      record?.failureCode !== "provider_call_ambiguous" ||
      record?.requiresHumanAdded !== true ||
      !Array.isArray(record.reservationIds) ||
      !record.reservationIds.includes(reconciledReservationId)
    ) continue;
    const step = episode.pipeline.find((item) => item.agent === record.agentId);
    if (
      !step ||
      !new Set(["failed", "blocked"]).has(step.status) ||
      step.requiresHuman !== true ||
      step.lastError !== "provider_call_ambiguous" ||
      step.lastRunAt !== record.at
    ) continue;
    step.requiresHuman = false;
    step.lastError = null;
    delete step.ambiguousReservationIds;
    step.message = "中断的 Provider 调用已由人工完成预算对账，可以安全重试";
    if (!releasedAgentIds.includes(step.agent)) releasedAgentIds.push(step.agent);
  }
  return releasedAgentIds;
}

function reconciliationActor(value) {
  const actor = typeof value === "string" ? value.trim() : "";
  if (!actor || actor.length > 128 || /[\u0000-\u001f\u007f]/u.test(actor)) {
    throw new BudgetReconciliationError(
      "人工预算对账必须提供 1-128 字符的非空操作者标识",
      "budget_reconciliation_actor_invalid"
    );
  }
  return actor;
}

function explicitUsage(input) {
  if (!Number.isSafeInteger(input.usedCalls) || input.usedCalls < 0) {
    throw new BudgetReconciliationError(
      "人工预算对账必须显式提供非负安全整数 usedCalls",
      "budget_reconciliation_usage_invalid"
    );
  }
  if (
    !Number.isFinite(input.usedCostUsd) ||
    input.usedCostUsd < 0 ||
    input.usedCostUsd > MAX_RECONCILIATION_COST_USD
  ) {
    throw new BudgetReconciliationError(
      `人工预算对账 usedCostUsd 必须位于 0-${MAX_RECONCILIATION_COST_USD} 且可安全保持 6 位小数`,
      "budget_reconciliation_usage_invalid"
    );
  }
  const usedCostMicros = Math.round(input.usedCostUsd * USD_MICRO_SCALE);
  if (!Number.isSafeInteger(usedCostMicros)) {
    throw new BudgetReconciliationError(
      "人工预算对账 usedCostUsd 超出安全 6 位小数范围",
      "budget_reconciliation_usage_invalid"
    );
  }
  return {
    usedCalls: input.usedCalls,
    usedCostUsd: usedCostMicros / USD_MICRO_SCALE,
    usedCostMicros
  };
}

function reconciliationTotals(budget, usage) {
  if (!Number.isSafeInteger(budget.usedCalls) || budget.usedCalls < 0) {
    throw new BudgetReconciliationError(
      "现有 usedCalls 不是可安全累加的非负整数，拒绝对账写入",
      "budget_reconciliation_total_unsafe",
      {},
      409
    );
  }
  const currentCostMicros = Math.round(budget.usedCostUsd * USD_MICRO_SCALE);
  if (
    !Number.isFinite(budget.usedCostUsd) ||
    budget.usedCostUsd < 0 ||
    budget.usedCostUsd > MAX_RECONCILIATION_COST_USD ||
    !Number.isSafeInteger(currentCostMicros)
  ) {
    throw new BudgetReconciliationError(
      "现有 usedCostUsd 不是可安全保持 6 位小数的数值，拒绝对账写入",
      "budget_reconciliation_total_unsafe",
      {},
      409
    );
  }
  const usedCalls = budget.usedCalls + usage.usedCalls;
  const usedCostMicros = currentCostMicros + usage.usedCostMicros;
  if (!Number.isSafeInteger(usedCalls) || !Number.isSafeInteger(usedCostMicros)) {
    throw new BudgetReconciliationError(
      "人工预算对账累计结果超出安全数值范围，拒绝写入",
      "budget_reconciliation_total_unsafe",
      {},
      409
    );
  }
  return {
    usedCalls,
    usedCostUsd: usedCostMicros / USD_MICRO_SCALE
  };
}

export function getAmbiguousBudgetReservationIds(sourceEpisode) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const currentIds = reservationIds(episode);
  const uncertainDispatchIds = (episode.control?.budget?.reservations ?? [])
    .filter((item) => !reservationIsProvablyUndispatched(item))
    .map((item) => item.id);
  return [...new Set(
    [
      ...uncertainDispatchIds,
      ...ambiguityEvents(episode).flatMap((entry) => entry.reservationIds)
    ]
      .filter((id) => currentIds.has(id))
  )];
}

export function markInterruptedBudgetReservationsAmbiguous(sourceEpisode, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const currentReservations = episode.control.budget.reservations ?? [];
  if (currentReservations.length === 0) {
    return {
      episode,
      changed: false,
      reservationIds: [],
      releasedReservationIds: [],
      ambiguousReservationIds: []
    };
  }
  const alreadyAmbiguous = new Set(
    ambiguityEvents(episode).flatMap((entry) => entry.reservationIds)
  );
  const releasedReservations = currentReservations.filter((reservation) => (
    reservationIsProvablyUndispatched(reservation) &&
    !alreadyAmbiguous.has(reservation.id)
  ));
  const newlyAmbiguous = currentReservations
    .filter((reservation) => (
      !reservationIsProvablyUndispatched(reservation)
    ))
    .map((reservation) => reservation.id)
    .filter((id) => !alreadyAmbiguous.has(id));
  if (releasedReservations.length === 0 && newlyAmbiguous.length === 0) {
    return {
      episode,
      changed: false,
      reservationIds: [],
      releasedReservationIds: [],
      ambiguousReservationIds: []
    };
  }
  const at = timestamp(options.now);
  const releasedReservationIds = releasedReservations.map((reservation) => reservation.id);
  const releasedReservationIdSet = new Set(releasedReservationIds);
  if (releasedReservations.length > 0) {
    const releasedCalls = releasedReservations.reduce(
      (sum, reservation) => sum + reservation.calls,
      0
    );
    const releasedCostUsd = releasedReservations.reduce(
      (sum, reservation) => sum + reservation.costUsd,
      0
    );
    episode.control.budget.reservations = currentReservations.filter(
      (reservation) => !releasedReservationIdSet.has(reservation.id)
    );
    episode.control.budget.reservedCalls = Math.max(
      0,
      episode.control.budget.reservedCalls - releasedCalls
    );
    episode.control.budget.reservedCostUsd = Number(
      Math.max(
        0,
        episode.control.budget.reservedCostUsd - releasedCostUsd
      ).toFixed(6)
    );
    episode.history ??= [];
    for (const reservation of releasedReservations) {
      episode.history.push({
        at,
        type: "budget-reservation-settled",
        status: "settled",
        settlementStatus: "not_dispatched",
        reservationId: reservation.id,
        reservationIds: [reservation.id],
        decisionId: reservation.decisionId,
        providerId: reservation.providerId,
        model: reservation.model,
        attempt: reservation.attempt,
        usedCalls: 0,
        usedCostUsd: 0,
        message:
          "进程中断发生在 Provider 派发标记前；已按未派发零用量安全释放预算预留"
      });
    }
  }
  const previousOverrun = episode.control.budget.overrun;
  if (newlyAmbiguous.length > 0) episode.control.budget.overrun = true;
  const newlyAmbiguousIdSet = new Set(newlyAmbiguous);
  for (const reservation of currentReservations) {
    if (newlyAmbiguousIdSet.has(reservation.id)) {
      reservation.dispatchState = "ambiguous";
    }
  }
  if (newlyAmbiguous.length > 0) {
    episode.history ??= [];
    episode.history.push({
      at,
      type: "budget-reservation-ambiguous",
      status: "ambiguous",
      failureCode: "provider_usage_unknown_after_process_interruption",
      reservationIds: newlyAmbiguous,
      previousOverrun,
      message:
        `进程中断时有 ${newlyAmbiguous.length} 项 Provider 调用的派发状态或用量不明；预算预留已冻结，必须人工核对调用结果和费用`
    });
  }
  episode.updatedAt = at;
  return {
    episode,
    changed: true,
    reservationIds: [...releasedReservationIds, ...newlyAmbiguous],
    releasedReservationIds,
    ambiguousReservationIds: newlyAmbiguous
  };
}

export function createEpisodeBudgetLedger(options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const maximumAttempts = Math.max(1, options.maximumAttempts ?? 5);

  async function mutate(episodeId, mutation) {
    let lastConflict = null;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const episode = ensureAgentArchitecture(await readState(episodeId));
      const result = mutation(episode);
      if (result.changed === false) return { episode, ...result };
      try {
        await writeState(episode);
        return { episode, ...result };
      } catch (error) {
        if (!conflict(error) || attempt === maximumAttempts) throw error;
        lastConflict = error;
      }
    }
    throw lastConflict;
  }

  return {
    async reserve(input) {
      const reservationId = String(input.reservationId ?? "").trim();
      const episodeId = String(input.episodeId ?? "").trim();
      if (!episodeId || !reservationId) {
        throw new BudgetReservationError("预算预留缺少 Episode 或预留编号");
      }
      const calls = nonNegativeInteger(input.calls, 1);
      const costKnown = Number.isFinite(input.costUsd) && input.costUsd >= 0;
      const costUsd = costKnown ? input.costUsd : 0;
      return mutate(episodeId, (episode) => {
        const budget = episode.control.budget;
        const ambiguousReservationIds = getAmbiguousBudgetReservationIds(episode);
        if (ambiguousReservationIds.length > 0) {
          throw new BudgetReservationError(
            "存在中断后尚未人工核对的 Provider 调用，预算和后续重试保持冻结",
            {
              episodeId,
              reservationId,
              reasonCode: "budget_reconciliation_required",
              ambiguousReservationIds
            }
          );
        }
        const existing = budget.reservations.find((item) => item.id === reservationId);
        if (existing) return { changed: false, reservation: existing };
        if (
          budget.maxCalls !== null &&
          budget.usedCalls + budget.reservedCalls + calls > budget.maxCalls
        ) {
          throw new BudgetReservationError("本期模型调用预算不足，未发起模型请求", {
            episodeId,
            reservationId
          });
        }
        if (budget.maxCostUsd !== null && !costKnown) {
          throw new BudgetReservationError("模型价格未知，无法在费用预算内预留请求", {
            episodeId,
            reservationId
          });
        }
        if (
          budget.maxCostUsd !== null &&
          budget.usedCostUsd + budget.reservedCostUsd + costUsd > budget.maxCostUsd
        ) {
          throw new BudgetReservationError("本期费用预算不足，未发起模型请求", {
            episodeId,
            reservationId
          });
        }
        const reservation = {
          id: reservationId,
          decisionId: String(input.decisionId ?? "").trim() || null,
          calls,
          costUsd,
          costKnown,
          reservedAt: timestamp(input.now),
          dispatchState: "reserved",
          dispatchedAt: null,
          providerId: null,
          model: null,
          attempt: null
        };
        budget.reservations.push(reservation);
        budget.reservedCalls += calls;
        budget.reservedCostUsd = Number((budget.reservedCostUsd + costUsd).toFixed(6));
        return { changed: true, reservation };
      });
    },

    async markDispatched(input) {
      const reservationId = String(input?.reservationId ?? "").trim();
      const episodeId = String(input?.episodeId ?? "").trim();
      if (!episodeId || !reservationId) {
        throw new BudgetReservationError(
          "Provider 调用派发标记缺少 Episode 或预留编号",
          { episodeId, reservationId }
        );
      }
      return mutate(episodeId, (episode) => {
        const reservation = episode.control.budget.reservations
          .find((item) => item.id === reservationId);
        if (!reservation) {
          throw new BudgetReservationError(
            "Provider 调用派发前的预算预留不存在，拒绝发起请求",
            { episodeId, reservationId }
          );
        }
        if (reservationRequiresReconciliation(episode, reservationId)) {
          throw new BudgetReconciliationError(
            "Provider 调用已处于结果不明状态，拒绝重复派发",
            "budget_reconciliation_required",
            { episodeId, reservationId },
            409
          );
        }
        if (reservation.dispatchState === "dispatching") {
          throw new BudgetReconciliationError(
            "Provider 调用已标记为派发中，拒绝重复派发",
            "budget_reconciliation_required",
            { episodeId, reservationId },
            409
          );
        }
        reservation.dispatchState = "dispatching";
        reservation.dispatchedAt = timestamp(input.now);
        reservation.providerId = String(input.providerId ?? "").trim().slice(0, 120) || null;
        reservation.model = String(input.model ?? "").trim().slice(0, 160) || null;
        reservation.attempt = Number.isInteger(input.attempt) && input.attempt > 0
          ? input.attempt
          : null;
        episode.updatedAt = reservation.dispatchedAt;
        return { changed: true, dispatched: true, reservation };
      });
    },

    async settle(input) {
      const reservationId = String(input.reservationId ?? "").trim();
      const episodeId = String(input.episodeId ?? "").trim();
      if (!episodeId || !reservationId) {
        throw new BudgetReservationError("预算结算缺少 Episode 或预留编号");
      }
      return mutate(episodeId, (episode) => {
        const budget = episode.control.budget;
        const index = budget.reservations.findIndex((item) => item.id === reservationId);
        if (index < 0) {
          throw new BudgetReservationError("预算预留不存在，拒绝把模型调用标记为已结算", {
            episodeId,
            reservationId
          });
        }
        if (reservationRequiresReconciliation(episode, reservationId)) {
          throw new BudgetReconciliationError(
            "中断的 Provider 调用只能通过专用人工预算对账操作结算，普通自动结算不能释放",
            "budget_reconciliation_required",
            { episodeId, reservationId },
            409
          );
        }
        const [reservation] = budget.reservations.splice(index, 1);
        const usedCalls = nonNegativeInteger(input.usedCalls, reservation.calls);
        const usedCostUsd = nonNegativeNumber(
          input.usedCostUsd,
          reservation.costKnown ? reservation.costUsd : 0
        );
        budget.reservedCalls = Math.max(0, budget.reservedCalls - reservation.calls);
        budget.reservedCostUsd = Number(
          Math.max(0, budget.reservedCostUsd - reservation.costUsd).toFixed(6)
        );
        budget.usedCalls += usedCalls;
        budget.usedCostUsd = Number((budget.usedCostUsd + usedCostUsd).toFixed(6));
        const actualOverrun = Boolean(
          input.overrun ||
          actualReservationOverrun(budget, reservation, usedCalls, usedCostUsd)
        );
        budget.overrun = Boolean(budget.overrun || actualOverrun);
        const at = timestamp(input.now);
        const settlementStatus = new Set([
          "not_dispatched",
          "completed_failure",
          "completed_success",
          "completed_unknown"
        ]).has(input.settlementStatus)
          ? input.settlementStatus
          : "completed_unknown";
        episode.history ??= [];
        episode.history.push({
          at,
          type: "budget-reservation-settled",
          status: "settled",
          settlementStatus,
          reservationId,
          reservationIds: [reservationId],
          decisionId: reservation.decisionId,
          providerId: String(input.providerId ?? reservation.providerId ?? "")
            .trim().slice(0, 120) || null,
          model: String(input.model ?? reservation.model ?? "").trim().slice(0, 160) || null,
          attempt: Number.isInteger(input.attempt) && input.attempt > 0
            ? input.attempt
            : reservation.attempt,
          usedCalls,
          usedCostUsd,
          message: settlementStatus === "completed_success"
            ? "Provider 已成功结算；调用方仍需完成产物和 Episode 提交"
            : "Provider 尝试已完成预算结算"
        });
        episode.updatedAt = at;
        return { changed: true, settled: true, reservation };
      });
    },

    async markAmbiguous(input) {
      const reservationId = String(input?.reservationId ?? "").trim();
      const episodeId = String(input?.episodeId ?? "").trim();
      if (!episodeId || !reservationId) {
        throw new BudgetReservationError("Provider 调用歧义标记缺少 Episode 或预留编号", {
          episodeId,
          reservationId
        });
      }
      return mutate(episodeId, (episode) => {
        const budget = episode.control.budget;
        const reservation = budget.reservations.find((item) => item.id === reservationId);
        if (!reservation) {
          throw new BudgetReservationError(
            "待冻结的 Provider 预算预留不存在，拒绝写入无来源的歧义记录",
            { episodeId, reservationId }
          );
        }
        if (reservationRequiresReconciliation(episode, reservationId)) {
          return { changed: false, marked: false, reservation };
        }
        const at = timestamp(input.now);
        const previousOverrun = budget.overrun;
        reservation.dispatchState = "ambiguous";
        budget.overrun = true;
        episode.history ??= [];
        episode.history.push({
          at,
          type: "budget-reservation-ambiguous",
          status: "ambiguous",
          failureCode: "provider_call_ambiguous",
          reservationId,
          reservationIds: [reservationId],
          decisionId: reservation.decisionId,
          providerId: String(input.providerId ?? "").trim().slice(0, 120) || null,
          model: String(input.model ?? "").trim().slice(0, 160) || null,
          attempt: Number.isInteger(input.attempt) && input.attempt > 0
            ? input.attempt
            : null,
          previousOverrun,
          message:
            "Provider 请求已经发出但调用结果或费用不明；预算预留保持冻结，禁止自动重试，必须人工对账"
        });
        episode.updatedAt = at;
        return { changed: true, marked: true, reservation };
      });
    },

    async reconcileAmbiguous(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new BudgetReconciliationError(
          "人工预算对账输入必须是对象",
          "budget_reconciliation_input_invalid"
        );
      }
      const reservationId = String(input.reservationId ?? "").trim();
      const episodeId = String(input.episodeId ?? "").trim();
      if (!episodeId || !reservationId) {
        throw new BudgetReconciliationError(
          "人工预算对账缺少 Episode 或预留编号",
          "budget_reconciliation_input_invalid"
        );
      }
      const actor = reconciliationActor(input.actor);
      const usage = explicitUsage(input);
      if (input.confirmation !== AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION) {
        throw new BudgetReconciliationError(
          `人工预算对账必须输入确认词 ${AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION}`,
          "budget_reconciliation_confirmation_required"
        );
      }
      return mutate(episodeId, (episode) => {
        episode.history ??= [];
        const priorReconciliation = episode.history.find((entry) => (
          entry?.type === "budget-reservation-reconciled" &&
          entry?.status === "settled" &&
          entry?.reservationId === reservationId
        ));
        const budget = episode.control.budget;
        const index = budget.reservations.findIndex((item) => item.id === reservationId);
        if (index < 0) {
          throw new BudgetReconciliationError(
            priorReconciliation
              ? "该中断 Provider 预算预留已经完成对账，拒绝重复结算"
              : "待对账的 Provider 预算预留不存在",
            priorReconciliation
              ? "budget_reconciliation_already_settled"
              : "budget_reconciliation_reservation_missing",
            { episodeId, reservationId },
            409
          );
        }
        const ambiguousReservationIds = getAmbiguousBudgetReservationIds(episode);
        if (!ambiguousReservationIds.includes(reservationId)) {
          throw new BudgetReconciliationError(
            "该预算预留没有中断歧义，不能使用人工歧义对账操作",
            "budget_reconciliation_not_ambiguous",
            { episodeId, reservationId },
            409
          );
        }

        const nextTotals = reconciliationTotals(budget, usage);
        const [reservation] = budget.reservations.splice(index, 1);
        budget.reservedCalls = Math.max(0, budget.reservedCalls - reservation.calls);
        budget.reservedCostUsd = Number(
          Math.max(0, budget.reservedCostUsd - reservation.costUsd).toFixed(6)
        );
        budget.usedCalls = nextTotals.usedCalls;
        budget.usedCostUsd = nextTotals.usedCostUsd;
        const actualOverrun = actualReservationOverrun(
          budget,
          reservation,
          usage.usedCalls,
          usage.usedCostUsd
        );
        const remainingAmbiguousReservationIds = ambiguousReservationIds.filter(
          (id) => id !== reservationId && budget.reservations.some((item) => item.id === id)
        );
        const historicalActualOverrun = hasHistoricalActualOverrun(episode);
        const historicalPriorOverrun = hasHistoricalPriorOverrun(episode);
        budget.overrun = Boolean(
          remainingAmbiguousReservationIds.length > 0 ||
          historicalActualOverrun ||
          historicalPriorOverrun ||
          actualOverrun
        );
        const canReleaseRecoveryFreeze = Boolean(
          remainingAmbiguousReservationIds.length === 0 &&
          !historicalActualOverrun &&
          !historicalPriorOverrun &&
          !actualOverrun
        );
        const unfrozenAgentIds = canReleaseRecoveryFreeze
          ? releaseRecoveredWorkerFreezes(episode, reservationId)
          : [];
        const at = timestamp(input.now);
        const reconciliation = {
          at,
          type: "budget-reservation-reconciled",
          status: "settled",
          reservationId,
          reservationIds: [reservationId],
          decisionId: reservation.decisionId,
          actor,
          confirmed: true,
          reservedCalls: reservation.calls,
          reservedCostUsd: reservation.costUsd,
          costKnown: reservation.costKnown,
          usedCalls: usage.usedCalls,
          usedCostUsd: usage.usedCostUsd,
          actualOverrun,
          historicalActualOverrun,
          historicalPriorOverrun,
          remainingAmbiguousReservationIds,
          unfrozenAgentIds,
          message: canReleaseRecoveryFreeze
            ? "人工已核对中断的 Provider 调用并完成预算结算；恢复冻结已按审计记录解除"
            : "人工已核对中断的 Provider 调用并完成预算结算；仍有歧义或超额，继续失败关闭"
        };
        episode.history.push(reconciliation);
        episode.updatedAt = at;
        return {
          changed: true,
          reconciled: true,
          reservation,
          reconciliation
        };
      });
    },

    async recordDecision(input) {
      const episodeId = String(input.episodeId ?? "").trim();
      const validation = validateRoutingDecision(input.decision);
      if (!episodeId || !validation.valid) {
        throw new Error(`预算路由记录无效：${validation.errors.join("；")}`);
      }
      return mutate(episodeId, (episode) => {
        if (episode.routingHistory.some((item) => item.id === input.decision.id)) {
          return { changed: false, recorded: false };
        }
        const recorded = recordRoutingOutcome(episode, input.decision, {
          callCount: 0,
          costUsd: 0
        });
        Object.assign(episode, recorded);
        return { changed: true, recorded: true };
      });
    }
  };
}

export async function reconcileAmbiguousProviderBudget(episodeId, input = {}, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BudgetReconciliationError(
      "人工预算对账输入必须是对象",
      "budget_reconciliation_input_invalid"
    );
  }
  const ledger = createEpisodeBudgetLedger(options);
  return ledger.reconcileAmbiguous({ ...input, episodeId });
}
