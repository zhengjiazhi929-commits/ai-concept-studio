import { readAiConfig } from "../../shared/ai-config.mjs";
import { loadLocalEnvironment } from "../../shared/env.mjs";
import { resolveProxyUrl } from "../../shared/network.mjs";
import { ProxyAgent } from "undici";
import {
  completeRoutingDecision,
  createModelRouter,
  RoutingPausedError
} from "../control/model-router.mjs";
import { redactSensitiveText } from "../../shared/redaction.mjs";
import {
  createProviderHealthManager,
  getCachedProviderHealthSnapshot,
  loadPersistentProviderHealthManager
} from "../control/provider-health.mjs";
import {
  BudgetReservationError,
  createEpisodeBudgetLedger
} from "../control/budget-ledger.mjs";

export function getProviderHealthSnapshot() {
  return structuredClone(getCachedProviderHealthSnapshot());
}

function extractOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("AI 响应没有可读取的文本结果");
}

function requestError(provider, status, body) {
  const detail = redactSensitiveText(body?.error?.message || body?.message || `HTTP ${status}`);
  const error = new Error(`${provider.label} 请求失败：${detail}`);
  error.status = status;
  error.code = body?.error?.code ?? body?.error?.type ?? null;
  error.usage = body?.usage && typeof body.usage === "object" ? body.usage : null;
  return error;
}

export class AiGenerationPausedError extends Error {
  constructor(message, attempts = []) {
    super(message);
    this.name = "AiGenerationPausedError";
    this.code = "manual_intervention_required";
    this.requiresHuman = true;
    this.attempts = attempts;
  }
}

function isRetryable(error) {
  const nonRetryableCodes = new Set([
    "insufficient_quota",
    "invalid_api_key",
    "model_not_found",
    "permission_denied"
  ]);
  return (
    !nonRetryableCodes.has(error.code) &&
    (!error.status || error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500)
  );
}

function resolvedModel(provider, task) {
  const environmentOverride = provider.modelEnv ? process.env[provider.modelEnv] : null;
  return environmentOverride || provider.modelOverrides?.[task.model] || task.model;
}

async function postResponse({ providerId, provider, model, task, request, config, fetchImpl, proxyUrl }) {
  const key = process.env[provider.apiKeyEnv];
  if (!key) throw new Error(`${provider.label} 尚未配置 ${provider.apiKeyEnv}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.request.timeoutMs);
  const selectedModel = model ?? resolvedModel(provider, task);
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;

  try {
    const response = await fetchImpl(`${provider.baseUrl.replace(/\/$/u, "")}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: selectedModel,
        store: false,
        instructions: request.instructions,
        input: request.input,
        reasoning: { effort: task.reasoningEffort },
        text: {
          verbosity: task.verbosity,
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.schema
          }
        },
        max_output_tokens: Math.min(
          request.maxOutputTokens ?? config.request.maxOutputTokens,
          config.request.maxOutputTokens
        )
      }),
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {})
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw requestError(provider, response.status, body);
    return {
      provider: providerId,
      model: selectedModel,
      responseId: body.id ?? null,
      usage: body.usage ?? null,
      value: JSON.parse(extractOutputText(body))
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`${provider.label} 请求超时`);
    if (error?.cause?.code) {
      throw new Error(`${provider.label} 网络连接失败（${error.cause.code}）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    await dispatcher?.close().catch(() => undefined);
  }
}

export async function createAiClient(options = {}) {
  await loadLocalEnvironment();
  const config = options.config ?? (await readAiConfig());
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const proxyUrl =
    options.proxyUrl !== undefined
      ? options.proxyUrl
      : fetchImpl === globalThis.fetch
        ? await resolveProxyUrl()
        : null;
  const healthManager = options.healthManager ?? (
    options.providerHealth
      ? createProviderHealthManager({ initial: options.providerHealth })
      : await loadPersistentProviderHealthManager()
  );
  const providerHealth = healthManager.snapshot();
  const shouldUseRouter = Boolean(
    options.router || Object.values(config.tasks ?? {}).every((task) => task.profile)
  );
  const router = options.router ?? (
    shouldUseRouter
      ? await createModelRouter({
          aiConfig: config,
          registry: options.modelRegistry,
          policy: options.routingPolicy,
          environment: process.env,
          providerHealth,
          providerAvailability: options.providerAvailability
        })
      : null
  );
  const budgetLedger = options.budgetLedger ?? createEpisodeBudgetLedger();

  return {
    async generateStructured(taskId, request) {
      const task = config.tasks[taskId];
      if (!task) throw new Error(`未知 AI 任务：${taskId}`);
      let routingDecision;
      try {
        routingDecision = router
          ? router.route({
              taskId,
              profile: request.taskProfile ?? task.profile,
              control: request.routingContext?.control,
              producerRoute: request.producerRoute,
              estimatedInputTokens: request.estimatedInputTokens ?? Math.ceil(String(request.input ?? "").length / 3),
              estimatedOutputTokens: request.maxOutputTokens ?? config.request.maxOutputTokens
            })
          : {
              id: `legacy-route-${taskId}-${new Date().toISOString()}`,
              at: new Date().toISOString(),
              taskId,
              profile: request.taskProfile ?? task.profile ?? "creative-structured",
              reason: "兼容旧测试或旧配置的固定 Provider 回退路径",
              candidates: [],
              selected: {
                providerId: config.primaryProvider,
                model: resolvedModel(config.providers[config.primaryProvider], task)
              },
              orderedRoutes: [config.primaryProvider, ...(config.fallbackProviders ?? []).slice(0, 1)]
                .map((providerId) => ({
                  providerId,
                  model: resolvedModel(config.providers[providerId], task)
                })),
              estimatedCostUsd: null,
              locked: false
            };
      } catch (error) {
        if (error instanceof RoutingPausedError) {
          throw new AiGenerationPausedError(error.message);
        }
        throw error;
      }
      const attempts = [];
      const episodeId = request.routingContext?.episodeId;
      const durableBudget = Boolean(
        request.routingContext?.persistBudget === true && episodeId
      );
      const requestBudget = request.routingContext?.control?.budget;
      const remainingCallBudget = requestBudget?.maxCalls === null || requestBudget?.maxCalls === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(
            0,
            requestBudget.maxCalls -
              (requestBudget.usedCalls ?? 0) -
              (requestBudget.reservedCalls ?? 0)
          );
      const remainingCostBudget = requestBudget?.maxCostUsd === null || requestBudget?.maxCostUsd === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(
            0,
            requestBudget.maxCostUsd -
              (requestBudget.usedCostUsd ?? 0) -
              (requestBudget.reservedCostUsd ?? 0)
          );
      const selectedReservedCostPerAttempt = routingDecision.reservation?.costUsd;
      let actualCostUsd = 0;
      let accountedCostUsd = 0;
      let actualCostKnown = true;
      let budgetBlocked = false;
      let budgetBlockedMessage = null;
      let reservationSequence = 0;
      const configuredRoutes = routingDecision.orderedRoutes.filter((route, index, routes) => {
        const provider = config.providers[route.providerId];
        return (
          routes.findIndex((candidate) => candidate.providerId === route.providerId && candidate.model === route.model) === index &&
          provider &&
          provider.enabled !== false &&
          process.env[provider.apiKeyEnv]
        );
      });

      async function settleAttempt(reservationId, attemptCost, reservedCostPerAttempt) {
        if (!durableBudget || !reservationId) return;
        const accountedCost = attemptCost ?? (
          Number.isFinite(reservedCostPerAttempt) ? reservedCostPerAttempt : 0
        );
        await budgetLedger.settle({
          episodeId,
          reservationId,
          usedCalls: 1,
          usedCostUsd: accountedCost,
          overrun: Number.isFinite(reservedCostPerAttempt) && accountedCost > reservedCostPerAttempt
        });
      }

      function accountingPaused(message, decision = null) {
        const error = new AiGenerationPausedError(message, attempts);
        error.routingDecision = decision ?? completeRoutingDecision(routingDecision, {
          status: "accounting_failed",
          providerId: attempts.at(-1)?.provider,
          model: attempts.at(-1)?.model,
          actualCostUsd: actualCostKnown ? actualCostUsd : null,
          accountedCostUsd,
          pricingVersion: routingDecision.pricingVersion,
          budgetAccounted: true,
          failureCode: "budget_accounting_failed"
        });
        return error;
      }

      async function persistDecision(decision) {
        if (!durableBudget) return;
        try {
          await budgetLedger.recordDecision({ episodeId, decision });
        } catch {
          throw accountingPaused("模型调用预算已结算，但路由审计记录失败；流水线已安全暂停", decision);
        }
      }

      providerLoop: for (let providerIndex = 0; providerIndex < configuredRoutes.length; providerIndex += 1) {
        const route = configuredRoutes[providerIndex];
        const providerId = route.providerId;
        const provider = config.providers[providerId];
        const maximumAttempts =
          providerId === config.primaryProvider
            ? Math.max(1, config.request.primaryAttempts ?? 3)
            : Math.max(1, config.request.fallbackAttempts ?? 1);
        const reservedCostPerAttempt = Object.hasOwn(route, "reservationCostUsd")
          ? route.reservationCostUsd
          : selectedReservedCostPerAttempt;
        for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
          if (!durableBudget && attempts.length >= remainingCallBudget) break providerLoop;
          if (
            !durableBudget &&
            Number.isFinite(reservedCostPerAttempt) &&
            actualCostUsd + reservedCostPerAttempt > remainingCostBudget
          ) {
            budgetBlocked = true;
            break providerLoop;
          }
          let reservationId = null;
          if (durableBudget) {
            reservationSequence += 1;
            reservationId = `${routingDecision.id}:attempt:${reservationSequence}`;
            try {
              await budgetLedger.reserve({
                episodeId,
                reservationId,
                decisionId: routingDecision.id,
                calls: routingDecision.reservation?.calls ?? 1,
                costUsd: reservedCostPerAttempt
              });
            } catch (error) {
              if (!(error instanceof BudgetReservationError)) throw error;
              budgetBlocked = true;
              budgetBlockedMessage = error.message;
              break providerLoop;
            }
          }
          const startedAt = Date.now();
          let result;
          try {
            result = await postResponse({
              providerId,
              provider,
              model: route.model,
              task,
              request,
              config,
              fetchImpl,
              proxyUrl
            });
          } catch (error) {
            const attemptCost = router?.costForUsage?.(route.model, error.usage) ?? null;
            if (error.usage && attemptCost === null) actualCostKnown = false;
            if (attemptCost !== null) actualCostUsd = Number((actualCostUsd + attemptCost).toFixed(6));
            const accountedAttemptCost = attemptCost ?? (
              Number.isFinite(reservedCostPerAttempt) ? reservedCostPerAttempt : 0
            );
            accountedCostUsd = Number((accountedCostUsd + accountedAttemptCost).toFixed(6));
            attempts.push({
              provider: providerId,
              model: route.model,
              attempt,
              status: "failed",
              code: error.code === null || error.code === undefined
                ? null
                : redactSensitiveText(error.code, 120),
              httpStatus: error.status ?? null,
              message: redactSensitiveText(error.message),
              actualCostUsd: attemptCost,
              durationMs: Date.now() - startedAt
            });
            try {
              await settleAttempt(reservationId, attemptCost, reservedCostPerAttempt);
            } catch {
              throw accountingPaused("模型请求已结束，但预算结算失败；预留仍保持并已安全暂停");
            }
            providerHealth[providerId] = await healthManager.recordFailure(providerId, error, {
              latencyMs: Date.now() - startedAt,
              errorCode: error.code === null || error.code === undefined
                ? String(error.status ?? "request_failed")
                : redactSensitiveText(error.code, 120)
            });
            if (!isRetryable(error) || attempt === maximumAttempts) break;
            const backoff = config.request.retryBackoffMs?.[attempt] ?? 0;
            if (backoff > 0) await sleep(backoff);
            continue;
          }

          const attemptCost = router?.costForUsage?.(result.model, result.usage) ?? null;
          if (attemptCost === null) actualCostKnown = false;
          else actualCostUsd = Number((actualCostUsd + attemptCost).toFixed(6));
          const accountedAttemptCost = attemptCost ?? (
            Number.isFinite(reservedCostPerAttempt) ? reservedCostPerAttempt : 0
          );
          accountedCostUsd = Number((accountedCostUsd + accountedAttemptCost).toFixed(6));
          attempts.push({
            provider: providerId,
            model: result.model,
            attempt,
            status: "succeeded",
            actualCostUsd: attemptCost,
            durationMs: Date.now() - startedAt
          });
          try {
            await settleAttempt(reservationId, attemptCost, reservedCostPerAttempt);
          } catch {
            throw accountingPaused("模型请求已完成，但预算结算失败；预留仍保持并已安全暂停");
          }
          providerHealth[providerId] = await healthManager.recordSuccess(providerId, {
            latencyMs: Date.now() - startedAt
          });
          const completedDecision = completeRoutingDecision(routingDecision, {
            status: "succeeded",
            providerId,
            model: result.model,
            usage: result.usage,
            estimatedCostUsd: routingDecision.estimatedCostUsd,
            actualCostUsd: actualCostKnown ? actualCostUsd : null,
            accountedCostUsd,
            pricingVersion: routingDecision.pricingVersion,
            budgetAccounted: durableBudget,
            budgetOverrun: accountedCostUsd > remainingCostBudget,
            durationMs: Date.now() - startedAt
          });
          await persistDecision(completedDecision);
          return {
            ...result,
            attempts,
            routingDecision: completedDecision
          };
        }
      }
      const completedDecision = completeRoutingDecision(routingDecision, {
        status: budgetBlocked ? "budget_blocked" : "failed",
        providerId: attempts.at(-1)?.provider,
        model: attempts.at(-1)?.model,
        durationMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
        actualCostUsd: actualCostKnown ? actualCostUsd : null,
        accountedCostUsd,
        pricingVersion: routingDecision.pricingVersion,
        budgetAccounted: durableBudget,
        budgetOverrun: accountedCostUsd > remainingCostBudget,
        failureCode: budgetBlocked
          ? "budget_reservation_denied"
          : attempts.at(-1)?.code ?? attempts.at(-1)?.httpStatus ?? "request_failed"
      });
      await persistDecision(completedDecision);
      if (attempts.length === 0) {
        if (budgetBlocked) {
          const paused = new AiGenerationPausedError(
            budgetBlockedMessage ?? "剩余预算不足以安全预留下一次模型调用"
          );
          paused.routingDecision = completedDecision;
          throw paused;
        }
        const paused = new AiGenerationPausedError(
          "没有已配置且启用的 AI 通道，请人工检查本地密钥和主通道设置"
        );
        paused.routingDecision = completedDecision;
        throw paused;
      }
      const lastFailure = attempts.at(-1)?.message;
      const paused = new AiGenerationPausedError(
        `AI 已按策略尝试 ${attempts.length} 次仍未成功，流水线已暂停，请人工检查通道、额度或模型权限${lastFailure ? `。最后错误：${lastFailure}` : ""}`,
        attempts
      );
      paused.routingDecision = completedDecision;
      throw paused;
    }
  };
}
