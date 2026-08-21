import { readFile } from "node:fs/promises";
import { TASK_PROFILES } from "../../shared/agent-contracts.mjs";
import {
  modelRegistryConfigPath,
  routingPolicyConfigPath
} from "../../shared/paths.mjs";
import { assertVersionedConfig } from "../../shared/config-integrity.mjs";

let routingSequence = 0;

function routeId(taskId, now) {
  routingSequence += 1;
  return `route-${taskId}-${now.toISOString()}-${routingSequence}`;
}

export class RoutingPausedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RoutingPausedError";
    this.code = "manual_intervention_required";
    this.requiresHuman = true;
    this.details = details;
  }
}

function unique(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function healthState(health) {
  if (!health) return "healthy";
  return new Set(["healthy", "degraded", "unavailable", "half-open"]).has(health.state)
    ? health.state
    : "unavailable";
}

function resolvedTaskModel(provider, task, environment) {
  const environmentOverride = provider.modelEnv ? environment[provider.modelEnv] : null;
  return environmentOverride || provider.modelOverrides?.[task.model] || task.model;
}

function pricingDetails(model) {
  if (!model || model.pricing?.status !== "confirmed" || !model.pricing?.version) return null;
  const pricing = model.pricing;
  if (!Number.isFinite(pricing.inputUsdPerMillion) || !Number.isFinite(pricing.outputUsdPerMillion)) {
    return null;
  }
  return pricing;
}

function usageTokens(usage = {}) {
  usage = usage && typeof usage === "object" ? usage : {};
  return {
    input: Math.max(0, usage.input_tokens ?? usage.inputTokens ?? 0),
    cachedInput: Math.max(
      0,
      usage.input_tokens_details?.cached_tokens ?? usage.cachedInputTokens ?? 0
    ),
    output: Math.max(0, usage.output_tokens ?? usage.outputTokens ?? 0),
    reasoningOutput: Math.max(
      0,
      usage.output_tokens_details?.reasoning_tokens ?? usage.reasoningOutputTokens ?? 0
    )
  };
}

export function calculateUsageCost(model, usage) {
  const pricing = pricingDetails(model);
  if (!pricing) return null;
  const tokens = usageTokens(usage);
  const cachedInput = Math.min(tokens.input, tokens.cachedInput);
  const uncachedInput = tokens.input - cachedInput;
  const reasoningOutput = Math.min(tokens.output, tokens.reasoningOutput);
  const regularOutput = tokens.output - reasoningOutput;
  const cachedRate = Number.isFinite(pricing.cachedInputUsdPerMillion)
    ? pricing.cachedInputUsdPerMillion
    : pricing.inputUsdPerMillion;
  const reasoningRate = Number.isFinite(pricing.reasoningOutputUsdPerMillion)
    ? pricing.reasoningOutputUsdPerMillion
    : pricing.outputUsdPerMillion;
  const total = (
    uncachedInput * pricing.inputUsdPerMillion +
    cachedInput * cachedRate +
    regularOutput * pricing.outputUsdPerMillion +
    reasoningOutput * reasoningRate
  ) / 1_000_000;
  return Number(total.toFixed(6));
}

function estimateCost(model, inputTokens, outputTokens) {
  return calculateUsageCost(model, {
    input_tokens: inputTokens,
    output_tokens: outputTokens
  });
}

function candidateSummary(candidate) {
  return {
    providerId: candidate.providerId,
    model: candidate.model,
    health: candidate.health,
    configured: candidate.configured,
    eligible: candidate.eligible,
    reasons: candidate.reasons,
    score: candidate.score ?? null,
    scoreComponents: candidate.scoreComponents ?? null
  };
}

function scoreCandidate(candidate, isolationPenalty = false) {
  const healthScore = { healthy: 100, "half-open": 70, degraded: 40, unavailable: -1000 };
  const components = {
    health: healthScore[candidate.health] ?? -1000,
    providerPreference: -candidate.providerIndex * 5,
    quality: (candidate.modelRecord?.qualityTier ?? 0) * 4,
    cost: -(candidate.modelRecord?.costTier ?? 0) * 2,
    isolation: isolationPenalty ? -200 : 0
  };
  return {
    score: Object.values(components).reduce((sum, value) => sum + value, 0),
    components
  };
}

export async function readModelRoutingConfig(options = {}) {
  const registry = options.registry ?? JSON.parse(await readFile(modelRegistryConfigPath, "utf8"));
  const policy = options.policy ?? JSON.parse(await readFile(routingPolicyConfigPath, "utf8"));
  const registryIntegrity = options.registry
    ? null
    : assertVersionedConfig("model-registry", registry);
  const policyIntegrity = options.policy
    ? null
    : assertVersionedConfig("routing-policy", policy);
  return { registry, policy, registryIntegrity, policyIntegrity };
}

export async function createModelRouter(options = {}) {
  const { registry, policy, registryIntegrity, policyIntegrity } = await readModelRoutingConfig(options);
  const aiConfig = options.aiConfig;
  if (!aiConfig?.providers || !aiConfig?.tasks) throw new Error("Model Router 缺少 AI 配置");
  const environment = options.environment ?? process.env;
  const providerAvailability = options.providerAvailability ?? null;
  const providerHealth = options.providerHealth ?? {};

  return {
    registry,
    policy,
    costForUsage(model, usage) {
      return calculateUsageCost(registry.models?.[model], usage);
    },
    route(input) {
      const task = aiConfig.tasks[input.taskId];
      if (!task) throw new RoutingPausedError(`未知 AI 任务：${input.taskId}`);
      const profile = input.profile ?? task.profile ?? policy.taskProfiles?.[input.taskId];
      if (!TASK_PROFILES.has(profile) || !registry.profiles?.[profile]) {
        throw new RoutingPausedError(`未知或未注册的能力档位：${profile ?? "missing"}`);
      }
      const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
      if (profile === "deterministic") {
        return {
          id: routeId(input.taskId, now),
          at: now.toISOString(),
          taskId: input.taskId,
          profile,
          reason: "确定性任务使用本地代码，不调用模型 Provider",
          candidates: [{ providerId: "local", model: "deterministic", health: "healthy", configured: true, eligible: true, reasons: [] }],
          selected: { providerId: "local", model: "deterministic" },
          orderedRoutes: [{ providerId: "local", model: "deterministic" }],
          estimatedCostUsd: 0,
          locked: false
        };
      }

      const control = input.control ?? {};
      const budget = control.budget ?? input.budget ?? {};
      const lockedRoute = control.lockedRoute ?? input.lockedRoute ?? {};
      const providerIds = unique([
        aiConfig.primaryProvider,
        ...(aiConfig.fallbackProviders ?? []),
        ...(policy.providerPreference ?? [])
      ]);
      const requiredCapabilities = new Set(registry.profiles[profile].requires ?? []);
      const candidates = providerIds.map((providerId, providerIndex) => {
        const provider = aiConfig.providers[providerId];
        const defaultModel = provider ? resolvedTaskModel(provider, task, environment) : task.model;
        const model = lockedRoute.model && (!lockedRoute.providerId || lockedRoute.providerId === providerId)
          ? lockedRoute.model
          : defaultModel;
        const modelRecord = registry.models?.[model];
        const health = healthState(providerHealth[providerId]);
        const configured = providerAvailability
          ? providerAvailability[providerId] === true
          : Boolean(provider && environment[provider.apiKeyEnv]);
        const reasons = [];
        if (!provider) reasons.push("unknown-provider");
        if (provider?.enabled === false) reasons.push("provider-disabled");
        if (!configured) reasons.push("provider-not-configured");
        if (health === "unavailable") reasons.push("provider-unavailable");
        if (health === "degraded" && policy.allowDegradedFallback === false) {
          reasons.push("provider-degraded-disallowed");
        }
        if (!modelRecord) reasons.push("unregistered-model");
        if (modelRecord && !modelRecord.profiles?.includes(profile)) reasons.push("profile-not-supported");
        if (
          modelRecord &&
          [...requiredCapabilities].some((capability) => !modelRecord.capabilities?.includes(capability))
        ) reasons.push("capability-mismatch");
        if (lockedRoute.providerId && lockedRoute.providerId !== providerId) reasons.push("provider-locked-elsewhere");
        if (lockedRoute.model && lockedRoute.model !== model) reasons.push("model-locked-elsewhere");
        return {
          providerId,
          providerIndex,
          model,
          modelRecord,
          health,
          configured,
          eligible: reasons.length === 0,
          reasons
        };
      });
      let eligible = candidates.filter((candidate) => candidate.eligible);
      if (eligible.length === 0) {
        throw new RoutingPausedError("没有满足能力、健康、配置和人工锁定条件的模型路由", {
          taskId: input.taskId,
          profile,
          candidates: candidates.map(candidateSummary)
        });
      }
      const isolationApplied = Boolean(
        input.producerRoute &&
        policy.reviewIsolation?.enabled &&
        policy.reviewIsolation.profiles?.includes(profile) &&
        !lockedRoute.providerId &&
        !lockedRoute.model
      );
      for (const candidate of candidates) {
        const isolated = isolationApplied &&
          candidate.providerId === input.producerRoute.providerId &&
          candidate.model === input.producerRoute.model;
        const scored = scoreCandidate(candidate, isolated);
        candidate.score = scored.score;
        candidate.scoreComponents = scored.components;
      }
      eligible = eligible.sort((left, right) => {
        return (
          right.score - left.score ||
          left.providerIndex - right.providerIndex
        );
      });
      const selected = eligible[0];
      const estimatedInputTokens = Math.max(0, input.estimatedInputTokens ?? 0);
      const estimatedOutputTokens = Math.max(0, input.estimatedOutputTokens ?? 0);
      const estimatedCostUsd = estimateCost(
        selected.modelRecord,
        estimatedInputTokens,
        estimatedOutputTokens
      );
      const safetyFactor = Number.isFinite(policy.budgetSafetyFactor)
        ? Math.max(1, policy.budgetSafetyFactor)
        : 1.25;
      const reservedCostUsd = estimatedCostUsd === null
        ? null
        : Number((estimatedCostUsd * safetyFactor).toFixed(6));
      if (
        budget.maxCalls !== null &&
        budget.maxCalls !== undefined &&
        (budget.usedCalls ?? 0) + (budget.reservedCalls ?? 0) + 1 > budget.maxCalls
      ) {
        throw new RoutingPausedError("本期模型调用预算不足", { profile, taskId: input.taskId });
      }
      if (
        reservedCostUsd !== null &&
        budget.maxCostUsd !== null &&
        budget.maxCostUsd !== undefined &&
        (budget.usedCostUsd ?? 0) + (budget.reservedCostUsd ?? 0) + reservedCostUsd > budget.maxCostUsd
      ) {
        throw new RoutingPausedError("本期费用预算不足", { profile, taskId: input.taskId });
      }
      if (
        estimatedCostUsd === null &&
        policy.pauseWhenBudgetUnknown &&
        budget.maxCostUsd !== null &&
        budget.maxCostUsd !== undefined
      ) {
        throw new RoutingPausedError("模型价格未知，无法在费用预算内安全路由", {
          profile,
          taskId: input.taskId
        });
      }
      const locked = Boolean(lockedRoute.providerId || lockedRoute.model);
      const ordered = locked ? [selected] : eligible;
      const orderedRoutes = ordered.map((candidate) => {
        const routeEstimatedCostUsd = estimateCost(
          candidate.modelRecord,
          estimatedInputTokens,
          estimatedOutputTokens
        );
        return {
          providerId: candidate.providerId,
          model: candidate.model,
          estimatedCostUsd: routeEstimatedCostUsd,
          reservationCostUsd: routeEstimatedCostUsd === null
            ? null
            : Number((routeEstimatedCostUsd * safetyFactor).toFixed(6))
        };
      });
      return {
        id: routeId(input.taskId, now),
        at: now.toISOString(),
        taskId: input.taskId,
        profile,
        reason: locked
          ? "严格使用用户锁定的 Provider/模型"
          : `按能力档位、Provider 健康度、顺序和预算选择 ${selected.providerId}/${selected.model}${isolationApplied ? "，并优先与生产模型隔离" : ""}`,
        candidates: candidates.map(candidateSummary),
        selected: { providerId: selected.providerId, model: selected.model },
        selectedScore: selected.score,
        orderedRoutes,
        estimatedCostUsd,
        pricingVersion: pricingDetails(selected.modelRecord)?.version ?? null,
        configVersions: {
          registry: registry.version ?? null,
          policy: policy.version ?? null
        },
        configHashes: {
          registry: registryIntegrity?.hash ?? null,
          policy: policyIntegrity?.hash ?? null
        },
        reservation: { calls: 1, costUsd: reservedCostUsd, safetyFactor },
        locked,
        isolationApplied
      };
    }
  };
}

export function completeRoutingDecision(decision, details = {}) {
  return {
    ...decision,
    outcome: {
      status: details.status ?? "unknown",
      providerId: details.providerId ?? decision.selected.providerId,
      model: details.model ?? decision.selected.model,
      usage: details.usage ?? null,
      estimatedCostUsd: details.estimatedCostUsd ?? decision.estimatedCostUsd,
      actualCostUsd: details.actualCostUsd ?? null,
      accountedCostUsd: details.accountedCostUsd
        ?? details.actualCostUsd
        ?? details.estimatedCostUsd
        ?? decision.estimatedCostUsd,
      pricingVersion: details.pricingVersion ?? decision.pricingVersion ?? null,
      budgetOverrun: Boolean(details.budgetOverrun),
      budgetAccounted: Boolean(details.budgetAccounted),
      durationMs: details.durationMs ?? null,
      failureCode: details.failureCode ?? null,
      fallbackUsed: Boolean(
        details.providerId && details.providerId !== decision.selected.providerId
      )
    }
  };
}
