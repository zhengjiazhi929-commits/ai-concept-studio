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
          reservedAt: timestamp(input.now)
        };
        budget.reservations.push(reservation);
        budget.reservedCalls += calls;
        budget.reservedCostUsd = Number((budget.reservedCostUsd + costUsd).toFixed(6));
        return { changed: true, reservation };
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
        budget.overrun = Boolean(
          budget.overrun ||
          input.overrun ||
          (budget.maxCalls !== null && budget.usedCalls > budget.maxCalls) ||
          (budget.maxCostUsd !== null && budget.usedCostUsd > budget.maxCostUsd)
        );
        return { changed: true, settled: true, reservation };
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
