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

export async function generateShadowPlan(sourceEpisode, options = {}) {
  if (!options.planner && !sourceEpisode.control?.mainAgentEnabled) {
    throw new Error("Main Agent 尚未启用，不能发起模型规划");
  }
  const planningMode = options.mode ?? sourceEpisode.control?.mode ?? "shadow";
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
    const client = options.client ?? (await createAiClient());
    const result = await client.generateStructured("main-agent", {
      schemaName: "main_agent_shadow_plan",
      schema: mainPlanSchema,
      instructions:
        `你是受 Workflow Kernel 约束的 Main Agent。只能从 legalActions 中选择，不能批准人工闸门、不能指定 Provider 或模型、不能直接写状态或文件。当前为 ${planningMode} 模式：只提出一条结构化建议，是否执行由受控调度器决定。遇到审批、人工输入、停止、预算或证据冲突时选择等待或停止。`,
      input: JSON.stringify(initialContext),
      taskProfile: "planner",
      routingContext: {
        episodeId: sourceEpisode.id,
        control: sourceEpisode.control,
        persistBudget: true
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
    { plan, routingDecision, attempts },
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
    attemptId = episode.control.currentPlan.id;
    await writeState(episode);
    operationClaimed = true;
    await recordEvent({
      type: `main-agent.${planningMode}.started`,
      episodeId,
      message: `Main Agent 开始生成 ${planningMode} 计划`
    });
    const generated = await generateShadowPlan(episode, options);
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
    episode = completed.episode;
    releasePersistedEpisodeOperation(episode, operationId);
    await writeState(episode);
    operationClaimed = false;
    await recordEvent({
      type: `main-agent.${planningMode}.completed`,
      episodeId,
      status: completed.record.status,
      message: result.validation.valid
        ? `${planningMode} 计划已记录，尚未执行`
        : "越权或非法计划已拒绝并记录"
    });
    return { episode, record: completed.record, context: result.context };
  } catch (error) {
    const latest = await readState(episodeId).catch(() => null);
    let failed = null;
    let recoveryEpisode = latest ? ensureAgentArchitecture(latest) : null;
    if (
      latest &&
      attemptId &&
      latest.control?.currentPlan?.id === attemptId &&
      latest.control.currentPlan.status === "planning"
    ) {
      failed = failPlanAttempt(latest, error, {
        now: options.now,
        mode: planningMode
      });
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
      message: error instanceof Error ? error.message : "Main Agent 规划失败"
    });
    throw error;
  } finally {
    releaseOperation();
  }
}

export { mainPlanSchema };
