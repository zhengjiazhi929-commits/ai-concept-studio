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
import {
  assertSideEffectGrant,
  consumeSideEffectGrantUsage,
  SideEffectAuthorizationError
} from "../security/side-effect-capability.mjs";

const PROVIDER_SIDE_EFFECT_SCOPES = Object.freeze([
  "model.invoke",
  "network.request",
  "paid.invoke"
]);

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
  error.requestDispatchState = "completed";
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

export class ProviderCallAmbiguousError extends AiGenerationPausedError {
  constructor(message, attempts = [], details = {}) {
    super(message, attempts);
    this.name = "ProviderCallAmbiguousError";
    this.code = "provider_call_ambiguous";
    this.requiresHuman = true;
    this.reconciliationRequired = true;
    this.details = details;
  }
}

const PRE_DISPATCH_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT"
]);

function transportCode(error) {
  return String(error?.cause?.code ?? error?.code ?? "").trim().toUpperCase();
}

function dispatchedError(error, state) {
  const source = error instanceof Error ? error : new Error(String(error ?? "Provider request failed"));
  try {
    source.requestDispatchState = state;
    return source;
  } catch {
    const wrapped = new Error(source.message, { cause: source });
    wrapped.name = source.name;
    wrapped.requestDispatchState = state;
    return wrapped;
  }
}

function ambiguousProviderError(provider, error, message) {
  const code = transportCode(error);
  const ambiguous = new Error(
    `${provider.label} ${message}${code ? `（${redactSensitiveText(code, 80)}）` : ""}`,
    { cause: error instanceof Error ? error : undefined }
  );
  ambiguous.name = "ProviderTransportAmbiguousError";
  ambiguous.code = "provider_call_ambiguous";
  ambiguous.requiresHuman = true;
  ambiguous.requestDispatchState = "ambiguous";
  ambiguous.transportCode = code || null;
  return ambiguous;
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
  if (!key) {
    throw dispatchedError(
      new Error(`${provider.label} 尚未配置 ${provider.apiKeyEnv}`),
      "not_dispatched"
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.request.timeoutMs);
  const selectedModel = model ?? resolvedModel(provider, task);
  let dispatcher = null;
  let requestInvoked = false;
  let responseReceived = false;

  try {
    dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : null;
    let responsePromise;
    try {
      responsePromise = fetchImpl(`${provider.baseUrl.replace(/\/$/u, "")}/responses`, {
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
    } catch (error) {
      if (error?.requestDispatchState) throw error;
      throw ambiguousProviderError(
        provider,
        error,
        "请求交给传输层时异常，Provider 是否收到无法确认"
      );
    }
    requestInvoked = true;
    const response = await responsePromise;
    responseReceived = true;
    let body;
    try {
      body = await response.json();
    } catch (error) {
      if (response.ok) {
        throw ambiguousProviderError(provider, error, "已返回成功状态，但响应体在完整读取前丢失");
      }
      body = {};
    }
    if (!response.ok) throw requestError(provider, response.status, body);
    try {
      return {
        provider: providerId,
        model: selectedModel,
        responseId: body.id ?? null,
        usage: body.usage ?? null,
        value: JSON.parse(extractOutputText(body))
      };
    } catch (error) {
      error.usage = body.usage && typeof body.usage === "object" ? body.usage : null;
      error.code ??= "provider_response_invalid";
      throw dispatchedError(error, "completed");
    }
  } catch (error) {
    if (error?.requestDispatchState) throw error;
    if (!requestInvoked) throw dispatchedError(error, "not_dispatched");
    if (responseReceived) throw dispatchedError(error, "completed");
    if (PRE_DISPATCH_NETWORK_CODES.has(transportCode(error))) {
      throw dispatchedError(error, "not_dispatched");
    }
    if (error?.name === "AbortError") {
      throw ambiguousProviderError(provider, error, "请求超时且 Provider 是否执行无法确认");
    }
    throw ambiguousProviderError(provider, error, "连接中断且 Provider 是否执行无法确认");
  } finally {
    clearTimeout(timer);
    await dispatcher?.close().catch(() => undefined);
  }
}

export async function createAiClient(options = {}) {
  await loadLocalEnvironment();
  const config = options.config ?? (await readAiConfig());
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const usesExplicitInjectedFetch = Object.hasOwn(options, "fetchImpl") &&
    fetchImpl !== globalThis.fetch;
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
      const providerCapabilityRequired = options.requireSideEffectCapability === true ||
        Boolean(options.sideEffectGrant) ||
        !usesExplicitInjectedFetch;
      const providerCapabilitySpec = {
        episodeId,
        operation: request.routingContext?.capabilityOperation ?? options.capabilityOperation,
        scopes: PROVIDER_SIDE_EFFECT_SCOPES,
        maxCalls: 0,
        maxCostUsd: 0
      };
      if (providerCapabilityRequired) {
        assertSideEffectGrant(options.sideEffectGrant, providerCapabilitySpec);
      }
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

      async function settleAttempt(
        reservationId,
        attemptCost,
        reservedCostPerAttempt,
        usedCalls = 1,
        settlement = {}
      ) {
        if (!durableBudget || !reservationId) return;
        const accountedCost = usedCalls === 0
          ? 0
          : attemptCost ?? (
              Number.isFinite(reservedCostPerAttempt) ? reservedCostPerAttempt : 0
            );
        await budgetLedger.settle({
          episodeId,
          reservationId,
          usedCalls,
          usedCostUsd: accountedCost,
          overrun: Number.isFinite(reservedCostPerAttempt) && accountedCost > reservedCostPerAttempt,
          settlementStatus: settlement.status ?? "completed_unknown",
          providerId: settlement.providerId,
          model: settlement.model,
          attempt: settlement.attempt
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
          if (
            providerCapabilityRequired &&
            (!Number.isFinite(reservedCostPerAttempt) || reservedCostPerAttempt < 0)
          ) {
            throw new SideEffectAuthorizationError(
              "Provider 调用缺少可验证的本次预留费用，已在派发前拒绝",
              "side_effect_capability_cost_unknown",
              { providerId, model: route.model, attempt },
              403
            );
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
          if (providerCapabilityRequired) {
            try {
              consumeSideEffectGrantUsage(
                options.sideEffectGrant,
                providerCapabilitySpec,
                { calls: 1, costUsd: reservedCostPerAttempt }
              );
            } catch (error) {
              if (durableBudget && reservationId) {
                try {
                  await settleAttempt(reservationId, 0, reservedCostPerAttempt, 0, {
                    status: "not_dispatched",
                    providerId,
                    model: route.model,
                    attempt
                  });
                } catch {
                  throw accountingPaused(
                    "Capability 在 Provider 派发前拒绝请求，但预算预留释放失败；预留保持并已安全暂停"
                  );
                }
              }
              throw error;
            }
          }
          if (durableBudget && reservationId) {
            try {
              await budgetLedger.markDispatched({
                episodeId,
                reservationId,
                decisionId: routingDecision.id,
                providerId,
                model: route.model,
                attempt
              });
            } catch {
              try {
                await settleAttempt(reservationId, 0, reservedCostPerAttempt, 0, {
                  status: "not_dispatched",
                  providerId,
                  model: route.model,
                  attempt
                });
              } catch {
                throw accountingPaused(
                  "Provider 请求尚未发出，但派发状态和预算释放都未能持久化；预留保持并已安全暂停"
                );
              }
              throw accountingPaused(
                "Provider 请求尚未发出，但派发状态无法持久化；已按零用量释放预留并安全暂停"
              );
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
            const dispatchState = error.requestDispatchState ?? "completed";
            if (dispatchState === "ambiguous") {
              actualCostKnown = false;
              attempts.push({
                provider: providerId,
                model: route.model,
                attempt,
                status: "ambiguous",
                dispatchState,
                code: "provider_call_ambiguous",
                httpStatus: null,
                message: redactSensitiveText(error.message),
                actualCostUsd: null,
                durationMs: Date.now() - startedAt
              });
              let ambiguityRecorded = !durableBudget;
              let ambiguityRecordingError = null;
              if (durableBudget && reservationId) {
                try {
                  await budgetLedger.markAmbiguous({
                    episodeId,
                    reservationId,
                    decisionId: routingDecision.id,
                    providerId,
                    model: route.model,
                    attempt
                  });
                  ambiguityRecorded = true;
                } catch (recordError) {
                  ambiguityRecordingError = redactSensitiveText(recordError?.message, 300);
                }
              }
              try {
                providerHealth[providerId] = await healthManager.recordFailure(providerId, error, {
                  latencyMs: Date.now() - startedAt,
                  errorCode: "provider_call_ambiguous"
                });
              } catch {
                // Provider health is advisory; ambiguity and the frozen reservation remain authoritative.
              }
              const ambiguousDecision = completeRoutingDecision(routingDecision, {
                status: "ambiguous",
                providerId,
                model: route.model,
                durationMs: attempts.reduce((sum, item) => sum + item.durationMs, 0),
                actualCostUsd: null,
                accountedCostUsd,
                pricingVersion: routingDecision.pricingVersion,
                budgetAccounted: durableBudget,
                budgetOverrun: true,
                failureCode: "provider_call_ambiguous"
              });
              let decisionRecorded = false;
              if (durableBudget) {
                try {
                  await budgetLedger.recordDecision({ episodeId, decision: ambiguousDecision });
                  decisionRecorded = true;
                } catch {
                  decisionRecorded = false;
                }
              }
              const paused = new ProviderCallAmbiguousError(
                "模型请求已经发出，但 Provider 结果与费用无法确认；预算预留保持冻结，已禁止自动重试和备用通道切换，必须人工对账",
                attempts,
                {
                  episodeId: episodeId ?? null,
                  reservationId,
                  providerId,
                  model: route.model,
                  attempt,
                  ambiguityRecorded,
                  ambiguityRecordingError,
                  decisionRecorded
                }
              );
              paused.routingDecision = ambiguousDecision;
              throw paused;
            }
            const notDispatched = dispatchState === "not_dispatched";
            const attemptCost = notDispatched
              ? 0
              : router?.costForUsage?.(route.model, error.usage) ?? null;
            if (error.usage && attemptCost === null) actualCostKnown = false;
            if (attemptCost !== null) actualCostUsd = Number((actualCostUsd + attemptCost).toFixed(6));
            const accountedAttemptCost = notDispatched
              ? 0
              : attemptCost ?? (
                  Number.isFinite(reservedCostPerAttempt) ? reservedCostPerAttempt : 0
                );
            accountedCostUsd = Number((accountedCostUsd + accountedAttemptCost).toFixed(6));
            attempts.push({
              provider: providerId,
              model: route.model,
              attempt,
              status: "failed",
              dispatchState,
              code: error.code === null || error.code === undefined
                ? null
                : redactSensitiveText(error.code, 120),
              httpStatus: error.status ?? null,
              message: redactSensitiveText(error.message),
              actualCostUsd: attemptCost,
              durationMs: Date.now() - startedAt
            });
            try {
              await settleAttempt(
                reservationId,
                attemptCost,
                reservedCostPerAttempt,
                notDispatched ? 0 : 1,
                {
                  status: notDispatched ? "not_dispatched" : "completed_failure",
                  providerId,
                  model: route.model,
                  attempt
                }
              );
            } catch {
              throw accountingPaused("模型请求已结束，但预算结算失败；预留仍保持并已安全暂停");
            }
            try {
              providerHealth[providerId] = await healthManager.recordFailure(providerId, error, {
                latencyMs: Date.now() - startedAt,
                errorCode: error.code === null || error.code === undefined
                  ? String(error.status ?? "request_failed")
                  : redactSensitiveText(error.code, 120)
              });
            } catch {
              // Provider health is advisory; accounting and retry state are authoritative.
            }
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
            dispatchState: "completed",
            actualCostUsd: attemptCost,
            durationMs: Date.now() - startedAt
          });
          try {
            await settleAttempt(reservationId, attemptCost, reservedCostPerAttempt, 1, {
              status: "completed_success",
              providerId,
              model: result.model,
              attempt
            });
          } catch {
            throw accountingPaused("模型请求已完成，但预算结算失败；预留仍保持并已安全暂停");
          }
          try {
            providerHealth[providerId] = await healthManager.recordSuccess(providerId, {
              latencyMs: Date.now() - startedAt
            });
          } catch {
            // Provider health is advisory; a settled successful result must not be retried.
          }
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
