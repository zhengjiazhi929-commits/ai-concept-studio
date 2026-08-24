import {
  ensureAgentArchitecture,
  validateMainAgentPlan
} from "../../shared/agent-contracts.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
import { createAiClient, getProviderHealthSnapshot } from "../ai/client.mjs";
import { buildMainAgentContext } from "./context-builder.mjs";
import { evaluateShadowPlan } from "./main-agent-evaluator.mjs";
import {
  beginPlanAttempt,
  completePlanAttempt,
  failPlanAttempt
} from "./plan-store.mjs";
import {
  recordRoutingOutcome,
  validateKernelPlan
} from "./workflow-kernel.mjs";
import {
  acquireEpisodeOperation,
  claimPersistedEpisodeOperation,
  releasePersistedEpisodeOperation
} from "./episode-operation-lock.mjs";
import { getAmbiguousBudgetReservationIds } from "./budget-ledger.mjs";
import { buildMainAgentInstructions } from "./main-agent-prompt.mjs";
import {
  requireSideEffectGrant,
  SideEffectAuthorizationError
} from "../security/side-effect-capability.mjs";

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const mainPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["run_worker", "wait_for_approval", "wait_for_checkpoint", "wait_for_input", "stop", "noop"] },
    workerId: nullableString,
    taskProfile: nullableString,
    reason: { type: "string" },
    acceptanceCriteria: { type: "array", items: { type: "string" } },
    reviewProfile: nullableString,
    toolIds: { type: "array", items: { type: "string" } },
    estimatedCalls: { type: "integer", minimum: 0 },
    estimatedCostUsd: { type: "number", minimum: 0 },
    limits: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxAttempts: { type: "integer", minimum: 1 },
        maxRevisionRounds: { type: "integer", minimum: 0 }
      },
      required: ["maxAttempts", "maxRevisionRounds"]
    },
    fallbackAction: { type: "string", enum: ["stop", "noop", "escalate_to_human"] }
  },
  required: [
    "action",
    "workerId",
    "taskProfile",
    "reason",
    "acceptanceCriteria",
    "reviewProfile",
    "toolIds",
    "estimatedCalls",
    "estimatedCostUsd",
    "limits",
    "fallbackAction"
  ]
};

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function combinedValidation(episode, plan, options = {}) {
  const contract = validateMainAgentPlan(plan);
  const kernel = validateKernelPlan(episode, plan, { activeRun: options.activeRun });
  return {
    valid: contract.valid && kernel.valid,
    errors: [...new Set([...contract.errors, ...kernel.errors])]
  };
}

function evaluatePlanAgainstEpisode(sourceEpisode, result, options = {}) {
  const context = buildMainAgentContext(sourceEpisode, {
    activeRun: options.activeRun,
    providerHealth: options.providerHealth ?? getProviderHealthSnapshot()
  });
  const validation = combinedValidation(sourceEpisode, result.plan, options);
  const evaluation = evaluateShadowPlan(context, result.plan, validation, {
    previousPlans: sourceEpisode.planHistory,
    actualCalls: options.actualCalls,
    actualCostUsd: options.actualCostUsd
  });
  return { ...result, context, validation, evaluation };
}

function successfulProviderSettlementsAfter(episode, since) {
  const sinceMs = Date.parse(since ?? "");
  if (!Number.isFinite(sinceMs)) return [];
  return (episode.history ?? []).filter((entry) => (
    entry?.type === "budget-reservation-settled" &&
    entry?.status === "settled" &&
    entry?.settlementStatus === "completed_success" &&
    Number.isFinite(Date.parse(entry.at ?? "")) &&
    Date.parse(entry.at) >= sinceMs
  ));
}

function planningAuthorization(sourceEpisode, options = {}) {
  const planningMode = options.mode ?? sourceEpisode.control?.mode ?? "shadow";
  const ambiguousReservationIds = getAmbiguousBudgetReservationIds(sourceEpisode);
  if (ambiguousReservationIds.length > 0) {
    const error = new Error(
      "存在中断后尚未人工核对的 Provider 调用，Main Agent 规划和预算保持冻结"
    );
    error.code = "budget_reconciliation_required";
    error.requiresHuman = true;
    error.ambiguousReservationIds = ambiguousReservationIds;
    throw error;
  }
  if (sourceEpisode.control?.budget?.overrun === true) {
    const error = new Error(
      "预算存在超额或 Provider 结果提交不明记录，Main Agent 规划保持冻结"
    );
    error.code = "cost_budget_overrun";
    error.requiresHuman = true;
    throw error;
  }
  if (sourceEpisode.control?.mainAgentEnabled) {
    return { bootstrap: false, planningMode };
  }
  const bootstrapAllowed = Boolean(
    planningMode === "shadow" &&
    sourceEpisode.control?.mode === "shadow" &&
    sourceEpisode.control?.fixedFallbackEnabled === true &&
    !sourceEpisode.control?.pendingDispatch
  );
  if (!bootstrapAllowed) {
    const error = new Error(
      "Main Agent 尚未启用；只有保留固定回退且没有待执行动作的 shadow 模式可以进行只规划 bootstrap"
    );
    error.code = "main_agent_bootstrap_not_allowed";
    throw error;
  }
  return { bootstrap: true, planningMode };
}

function realPlanningBudget(sourceEpisode) {
  const budget = sourceEpisode.control?.budget;
  if (!Number.isInteger(budget?.maxCalls) || !Number.isFinite(budget?.maxCostUsd)) {
    throw new SideEffectAuthorizationError(
      "真实 Main Agent 规划必须先配置有限的调用次数和费用预算",
      "side_effect_capability_budget_unbounded",
      {},
      403
    );
  }
  const remainingCalls = budget.maxCalls
    - (budget.usedCalls ?? 0)
    - (budget.reservedCalls ?? 0);
  const remainingCostUsd = Number((
    budget.maxCostUsd
    - (budget.usedCostUsd ?? 0)
    - (budget.reservedCostUsd ?? 0)
  ).toFixed(6));
  if (remainingCalls < 1 || remainingCostUsd <= 0) {
    throw new SideEffectAuthorizationError(
      "真实 Main Agent 规划的调用次数或费用预算已经耗尽",
      "side_effect_capability_budget_exhausted",
      {},
      403
    );
  }
  return { maxCalls: 1, maxCostUsd: remainingCostUsd };
}

function assertRealPlanningEnabled(sourceEpisode) {
  if (
    sourceEpisode.control?.mainAgentEnabled !== true ||
    sourceEpisode.control?.modelRouterEnabled !== true
  ) {
    const error = new Error(
      "真实 Main Agent 规划要求 Main Agent 与 Model Router 开关同时启用"
    );
    error.code = "main_agent_real_planning_disabled";
    error.statusCode = 403;
    throw error;
  }
}

function requirePlanningCapability(
  sourceEpisode,
  options = {},
  includeStateWrite = false,
  includeModelSideEffects = true
) {
  const usesRealClient = includeModelSideEffects &&
    options.planner === undefined &&
    options.client === undefined;
  const scopes = new Set(includeStateWrite ? ["state.write"] : []);
  let budget = { maxCalls: 0, maxCostUsd: 0 };
  if (usesRealClient) {
    assertRealPlanningEnabled(sourceEpisode);
    budget = realPlanningBudget(sourceEpisode);
    scopes.add("model.invoke");
    scopes.add("network.request");
    scopes.add("paid.invoke");
  }
  if (scopes.size === 0) return null;
  if (!options.sideEffectGrant && typeof options.authorizeSideEffect !== "function") {
    throw new SideEffectAuthorizationError(
      "缺少服务端签发的副作用 Capability",
      "side_effect_capability_missing",
      {},
      403
    );
  }
  return requireSideEffectGrant(options, {
    episodeId: sourceEpisode.id,
    operation: options.capabilityOperation ?? "main-agent:shadow-plan",
    scopes: [...scopes],
    ...budget
  });
}

export async function generateShadowPlan(sourceEpisode, options = {}) {
  const authorization = planningAuthorization(sourceEpisode, options);
  const capabilityOperation = options.capabilityOperation ?? "main-agent:shadow-plan";
  const sideEffectGrant = requirePlanningCapability(sourceEpisode, options, false);
  const planningMode = authorization.planningMode;
  const initialContext = buildMainAgentContext(sourceEpisode, {
    activeRun: options.activeRun,
    providerHealth: options.providerHealth ?? getProviderHealthSnapshot()
  });
  let plan;
  let routingDecision = null;
  let attempts = [];
  if (options.planner) {
    plan = await options.planner(structuredClone(initialContext));
  } else {
    const client = options.client ?? (await createAiClient({
      sideEffectGrant,
      capabilityOperation,
      requireSideEffectCapability: true
    }));
    const result = await client.generateStructured("main-agent", {
      schemaName: "main_agent_shadow_plan",
      schema: mainPlanSchema,
      instructions: buildMainAgentInstructions(planningMode),
      input: JSON.stringify(initialContext),
      taskProfile: "planner",
      routingContext: {
        episodeId: sourceEpisode.id,
        control: sourceEpisode.control,
        persistBudget: true,
        capabilityOperation
      },
      estimatedInputTokens: Math.ceil(JSON.stringify(initialContext).length / 4),
      maxOutputTokens: 1200
    });
    plan = result.value;
    routingDecision = result.routingDecision ?? null;
    attempts = result.attempts ?? [];
  }
  return evaluatePlanAgainstEpisode(
    sourceEpisode,
    {
      plan,
      routingDecision,
      attempts,
      routingUsed: Boolean(routingDecision),
      bootstrap: authorization.bootstrap,
      planningOnly: planningMode === "shadow"
    },
    options
  );
}

export async function runShadowPlanning(episodeId, options = {}) {
  const releaseOperation = acquireEpisodeOperation(episodeId, "main-agent-planning", {
    conflictMessage: "这一期已有 Main Agent 正在规划，或有 Worker 正在运行，请等待它完成"
  });
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const planningMode = options.mode ?? "shadow";
  let episode;
  let attemptId = null;
  let operationId = null;
  let operationClaimed = false;
  try {
    episode = ensureAgentArchitecture(await readState(episodeId));
    const authorization = planningAuthorization(episode, {
      ...options,
      mode: planningMode
    });
    const defaultStateDependencies =
      options.writeEpisode === undefined || options.appendEvent === undefined;
    const stateCapabilityRequired = defaultStateDependencies ||
      options.requireSideEffectCapability === true;
    if (stateCapabilityRequired) {
      requirePlanningCapability(
        episode,
        {
          ...options,
          capabilityOperation: `${options.capabilityOperation ??
            "main-agent:shadow-plan"}:state`
        },
        true,
        false
      );
    }
    operationId = `operation:plan-${episodeId}-v${episode.control.planVersion + 1}`;
    claimPersistedEpisodeOperation(episode, {
      id: operationId,
      kind: "main-agent-planning",
      now: options.now
    });
    episode = beginPlanAttempt(episode, {
      now: options.now,
      mode: planningMode
    });
    const bootstrap = authorization.bootstrap;
    episode.control.currentPlan.bootstrap = bootstrap;
    episode.control.currentPlan.planningOnly = planningMode === "shadow";
    episode.control.currentPlan.routingUsed = null;
    attemptId = episode.control.currentPlan.id;
    await writeState(episode);
    operationClaimed = true;
    await recordEvent({
      type: `main-agent.${planningMode}.started`,
      episodeId,
      message: `Main Agent 开始生成 ${planningMode} 计划`
    });
    const generated = await generateShadowPlan(episode, {
      ...options,
      sideEffectGrant: stateCapabilityRequired
        ? undefined
        : options.sideEffectGrant
    });
    episode = ensureAgentArchitecture(await readState(episodeId));
    if (
      episode.control.currentPlan?.id !== attemptId ||
      episode.control.currentPlan?.status !== "planning"
    ) {
      const error = new Error("Main Agent 计划已被更新的状态取代，不会覆盖新状态");
      error.code = "planning_superseded";
      throw error;
    }
    const result = evaluatePlanAgainstEpisode(episode, generated, options);
    if (result.routingDecision) {
      episode = recordRoutingOutcome(episode, result.routingDecision, {
        callCount: result.attempts.length,
        costUsd: result.routingDecision.outcome?.actualCostUsd
          ?? result.routingDecision.outcome?.accountedCostUsd
          ?? result.routingDecision.outcome?.estimatedCostUsd
          ?? 0
      });
    }
    const completed = completePlanAttempt(episode, result, {
      now: options.now,
      mode: planningMode
    });
    completed.record.bootstrap = Boolean(result.bootstrap);
    completed.record.planningOnly = planningMode === "shadow";
    completed.record.routingUsed = Boolean(result.routingUsed);
    episode = completed.episode;
    releasePersistedEpisodeOperation(episode, operationId);
    await writeState(episode);
    operationClaimed = false;
    await recordEvent({
      type: `main-agent.${planningMode}.completed`,
      episodeId,
      status: completed.record.status,
      bootstrap: Boolean(result.bootstrap),
      planningOnly: planningMode === "shadow",
      routingUsed: Boolean(result.routingUsed),
      message: result.validation.valid
        ? result.bootstrap
          ? result.routingUsed
            ? "shadow bootstrap 计划已记录；Model Router 仅用于本次受预算约束的规划选路，Main Agent 控制开关保持关闭，未派发 Worker"
            : "shadow bootstrap 计划已记录；本次使用注入 planner 且未使用 Model Router，Main Agent 控制开关保持关闭，未派发 Worker"
          : `${planningMode} 计划已记录，尚未执行`
        : "越权或非法计划已拒绝并记录"
    });
    return { episode, record: completed.record, context: result.context };
  } catch (error) {
    const latest = await readState(episodeId).catch(() => null);
    let failed = null;
    let recoveryEpisode = latest ? ensureAgentArchitecture(latest) : null;
    const planningStartedAt = latest?.control?.currentPlan?.id === attemptId
      ? latest.control.currentPlan.startedAt
      : null;
    const uncommittedProviderResults = successfulProviderSettlementsAfter(
      recoveryEpisode ?? {},
      planningStartedAt
    );
    const providerResultCommitUnknown = Boolean(
      attemptId &&
      latest?.control?.currentPlan?.id === attemptId &&
      latest.control.currentPlan.status === "planning" &&
      uncommittedProviderResults.length > 0
    );
    const recordedError = providerResultCommitUnknown
      ? Object.assign(
          new Error(
            "Provider 已成功结算，但 Main Agent 计划是否完成提交无法确认；已禁止自动重试，必须人工核对"
          ),
          {
            code: "provider_result_commit_unknown",
            requiresHuman: true,
            reservationIds: uncommittedProviderResults.map(
              (entry) => entry.reservationId
            )
          }
        )
      : error;
    if (
      latest &&
      attemptId &&
      latest.control?.currentPlan?.id === attemptId &&
      latest.control.currentPlan.status === "planning"
    ) {
      failed = failPlanAttempt(latest, recordedError, {
        now: options.now,
        mode: planningMode
      });
      failed.record.bootstrap = Boolean(latest.control.currentPlan.bootstrap);
      failed.record.planningOnly = planningMode === "shadow";
      failed.record.routingUsed = Boolean(error?.routingDecision);
      if (providerResultCommitUnknown) {
        const at = timestamp(options.now);
        const reservationIds = uncommittedProviderResults.map(
          (entry) => entry.reservationId
        );
        failed.record.requiresHuman = true;
        failed.record.uncommittedProviderResultIds = reservationIds;
        failed.episode.control.budget.overrun = true;
        failed.episode.history.push({
          at,
          type: "provider-result-commit-unknown",
          status: "blocked",
          agentId: "main-agent",
          failureCode: "provider_result_commit_unknown",
          reservationIds,
          message:
            "Main Agent 的 Provider 结果已成功结算，但计划是否完成提交无法确认；已禁止自动重试"
        });
        failed.episode.updatedAt = at;
      }
      recoveryEpisode = failed.episode;
    }
    if (recoveryEpisode && operationClaimed) {
      releasePersistedEpisodeOperation(recoveryEpisode, operationId);
      await writeState(recoveryEpisode);
      operationClaimed = false;
    }
    await recordEvent({
      type: `main-agent.${planningMode}.failed`,
      episodeId,
      status: "failed",
      failureCode: recordedError?.code ?? "planning_failed",
      requiresHuman: recordedError?.requiresHuman === true,
      message: recordedError instanceof Error
        ? recordedError.message
        : "Main Agent 规划失败"
    });
    throw recordedError;
  } finally {
    releaseOperation();
  }
}

export { mainPlanSchema };
