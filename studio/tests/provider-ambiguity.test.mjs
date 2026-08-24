import test from "node:test";
import assert from "node:assert/strict";
import { createAiClient } from "../src/server/ai/client.mjs";
import { ensureAgentArchitecture } from "../src/shared/agent-contracts.mjs";
import {
  BudgetReservationError,
  createEpisodeBudgetLedger,
  getAmbiguousBudgetReservationIds
} from "../src/server/control/budget-ledger.mjs";
import { createCapabilityAuthority } from
  "../src/server/security/side-effect-capability.mjs";

const CAPABILITY_SECRET = "test-provider-capability-20260824-at-least-thirty-two-bytes";
const CAPABILITY_OPERATION = "worker:script-agent";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"]
};

function aiConfig(overrides = {}) {
  return {
    primaryProvider: "primary",
    fallbackProviders: ["fallback"],
    request: {
      timeoutMs: 1000,
      primaryAttempts: 3,
      fallbackAttempts: 1,
      retryBackoffMs: [0, 0, 0],
      maxOutputTokens: 100
    },
    tasks: {
      script: { model: "test-model", reasoningEffort: "low", verbosity: "low" }
    },
    providers: {
      primary: {
        label: "Primary",
        baseUrl: "https://primary.example/v1",
        apiKeyEnv: "STUDIO_PROVIDER_AMBIGUITY_PRIMARY_KEY",
        enabled: true
      },
      fallback: {
        label: "Fallback",
        baseUrl: "https://fallback.example/v1",
        apiKeyEnv: "STUDIO_PROVIDER_AMBIGUITY_FALLBACK_KEY",
        enabled: true
      }
    },
    ...overrides
  };
}

function routingRequest() {
  return {
    schemaName: "provider_ambiguity_test",
    schema,
    instructions: "Return the test shape",
    input: "test",
    routingContext: {
      episodeId: "provider-ambiguity-test",
      persistBudget: true,
      control: {
        budget: {
          maxCalls: 8,
          usedCalls: 0,
          reservedCalls: 0,
          maxCostUsd: 8,
          usedCostUsd: 0,
          reservedCostUsd: 0
        }
      }
    }
  };
}

function recordingBudgetLedger() {
  const lifecycle = [];
  const reservations = new Set();
  return {
    lifecycle,
    reservations,
    async reserve(input) {
      lifecycle.push({ operation: "reserve", ...input });
      reservations.add(input.reservationId);
    },
    async markDispatched(input) {
      lifecycle.push({ operation: "mark-dispatched", ...input });
    },
    async settle(input) {
      lifecycle.push({ operation: "settle", ...input });
      reservations.delete(input.reservationId);
    },
    async markAmbiguous(input) {
      lifecycle.push({ operation: "mark-ambiguous", ...input });
    },
    async recordDecision(input) {
      lifecycle.push({ operation: "record", ...input });
    }
  };
}

function inMemoryEpisodeLedger() {
  let episode = ensureAgentArchitecture({
    id: "provider-ambiguity-integration",
    control: {
      budget: {
        maxCalls: 8,
        usedCalls: 0,
        reservedCalls: 0,
        maxCostUsd: 8,
        usedCostUsd: 0,
        reservedCostUsd: 0
      }
    },
    routingHistory: []
  });
  return {
    get episode() {
      return episode;
    },
    ledger: createEpisodeBudgetLedger({
      readEpisode: async () => episode,
      writeEpisode: async (nextEpisode) => {
        episode = structuredClone(nextEpisode);
        return episode;
      }
    })
  };
}

function successfulResponse() {
  return new Response(JSON.stringify({
    id: "response-test",
    output_text: JSON.stringify({ ok: true }),
    usage: { input_tokens: 2, output_tokens: 1 }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function providerGrant({ maxCalls, maxCostUsd }) {
  return createCapabilityAuthority({
    secret: CAPABILITY_SECRET,
    maximumCalls: maxCalls,
    maximumCostUsd: maxCostUsd
  }).authorize({
    episodeId: "provider-ambiguity-test",
    operation: CAPABILITY_OPERATION,
    scopes: ["model.invoke", "network.request", "paid.invoke"],
    maxCalls,
    maxCostUsd
  });
}

function capabilityRouter() {
  return {
    route: () => ({
      id: "route-provider-capability",
      at: "2026-08-24T00:00:00.000Z",
      taskId: "script",
      profile: "creative-structured",
      reason: "固定 Capability 测试路由",
      candidates: [],
      selected: { providerId: "primary", model: "test-model" },
      orderedRoutes: ["primary", "fallback"].map((providerId) => ({
        providerId,
        model: "test-model",
        reservationCostUsd: 0.1
      })),
      estimatedCostUsd: 0.1,
      pricingVersion: "test-pricing-v1",
      reservation: { calls: 1, costUsd: 0.1, safetyFactor: 1 },
      locked: false
    }),
    costForUsage: () => 0.1
  };
}

async function withProviderKeys(run) {
  process.env.STUDIO_PROVIDER_AMBIGUITY_PRIMARY_KEY = "test-only-placeholder";
  process.env.STUDIO_PROVIDER_AMBIGUITY_FALLBACK_KEY = "test-only-placeholder";
  try {
    return await run();
  } finally {
    delete process.env.STUDIO_PROVIDER_AMBIGUITY_PRIMARY_KEY;
    delete process.env.STUDIO_PROVIDER_AMBIGUITY_FALLBACK_KEY;
  }
}

test("默认 Provider 路径缺少 grant 时在预算派发和 fetch 前关闭", async () => {
  await withProviderKeys(async () => {
    const ledger = recordingBudgetLedger();
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      throw new Error("must not fetch without a capability grant");
    };
    try {
      const client = await createAiClient({
        config: aiConfig({ fallbackProviders: [] }),
        budgetLedger: ledger,
        providerHealth: { primary: { state: "healthy" } },
        capabilityOperation: CAPABILITY_OPERATION,
        proxyUrl: null
      });
      await assert.rejects(
        client.generateStructured("script", routingRequest()),
        (error) => error.code === "side_effect_capability_missing" &&
          error.statusCode === 403
      );
      assert.equal(providerCalls, 0);
      assert.equal(ledger.lifecycle.some((item) => item.operation === "reserve"), false);
      assert.equal(
        ledger.lifecycle.some((item) => item.operation === "mark-dispatched"),
        false
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("HTTP 503 的 retry 与 fallback 逐次消费 grant，次数耗尽时零 fetch 零派发", async () => {
  await withProviderKeys(async () => {
    const ledger = recordingBudgetLedger();
    const urls = [];
    const client = await createAiClient({
      config: aiConfig({
        request: {
          timeoutMs: 1000,
          primaryAttempts: 1,
          fallbackAttempts: 2,
          retryBackoffMs: [0, 0, 0],
          maxOutputTokens: 100
        }
      }),
      budgetLedger: ledger,
      router: capabilityRouter(),
      providerHealth: { primary: { state: "healthy" }, fallback: { state: "healthy" } },
      sleep: async () => {},
      sideEffectGrant: providerGrant({ maxCalls: 2, maxCostUsd: 0.2 }),
      capabilityOperation: CAPABILITY_OPERATION,
      fetchImpl: async (url) => {
        urls.push(url);
        return new Response(JSON.stringify({ error: { message: "temporary outage" } }), {
          status: 503,
          headers: { "content-type": "application/json" }
        });
      }
    });

    await assert.rejects(
      client.generateStructured("script", routingRequest()),
      (error) => error.code === "side_effect_capability_calls_exceeded" &&
        error.details.usedCalls === 2 &&
        error.details.remainingCalls === 0
    );

    assert.equal(urls.length, 2);
    assert.match(urls[0], /primary\.example/u);
    assert.match(urls[1], /fallback\.example/u);
    assert.equal(
      ledger.lifecycle.filter((item) => item.operation === "mark-dispatched").length,
      2
    );
    assert.deepEqual(
      ledger.lifecycle
        .filter((item) => item.operation === "settle")
        .map(({ usedCalls, usedCostUsd }) => ({ usedCalls, usedCostUsd })),
      [
        { usedCalls: 1, usedCostUsd: 0.1 },
        { usedCalls: 1, usedCostUsd: 0.1 },
        { usedCalls: 0, usedCostUsd: 0 }
      ]
    );
    assert.equal(ledger.reservations.size, 0);
  });
});

test("Provider attempt 的预留费用超过 grant 剩余额度时不 fetch 不派发", async () => {
  await withProviderKeys(async () => {
    const ledger = recordingBudgetLedger();
    let providerCalls = 0;
    const client = await createAiClient({
      config: aiConfig({
        request: {
          timeoutMs: 1000,
          primaryAttempts: 1,
          fallbackAttempts: 1,
          retryBackoffMs: [0, 0, 0],
          maxOutputTokens: 100
        }
      }),
      budgetLedger: ledger,
      router: capabilityRouter(),
      providerHealth: { primary: { state: "healthy" }, fallback: { state: "healthy" } },
      sleep: async () => {},
      sideEffectGrant: providerGrant({ maxCalls: 3, maxCostUsd: 0.15 }),
      capabilityOperation: CAPABILITY_OPERATION,
      fetchImpl: async () => {
        providerCalls += 1;
        return new Response(JSON.stringify({ error: { message: "temporary outage" } }), {
          status: 503,
          headers: { "content-type": "application/json" }
        });
      }
    });

    await assert.rejects(
      client.generateStructured("script", routingRequest()),
      (error) => error.code === "side_effect_capability_cost_exceeded" &&
        error.details.usedCostUsd === 0.1 &&
        error.details.remainingCostUsd === 0.05
    );
    assert.equal(providerCalls, 1);
    assert.equal(
      ledger.lifecycle.filter((item) => item.operation === "mark-dispatched").length,
      1
    );
    assert.equal(ledger.reservations.size, 0);
  });
});

for (const transportFailure of [
  {
    name: "POST 后连接重置",
    error() {
      const error = new Error("socket reset after write");
      error.cause = { code: "ECONNRESET" };
      return error;
    }
  },
  {
    name: "POST 后等待超时",
    error() {
      const error = new Error("request aborted after timeout");
      error.name = "AbortError";
      return error;
    }
  }
]) {
  test(`${transportFailure.name}冻结当前预留且禁止自动重试和 fallback`, async () => {
    await withProviderKeys(async () => {
      const ledger = recordingBudgetLedger();
      let providerCalls = 0;
      const client = await createAiClient({
        config: aiConfig(),
        budgetLedger: ledger,
        providerHealth: { primary: { state: "healthy" }, fallback: { state: "healthy" } },
        sleep: async () => {},
        fetchImpl: async () => {
          providerCalls += 1;
          throw transportFailure.error();
        }
      });

      await assert.rejects(
        client.generateStructured("script", routingRequest()),
        (error) => {
          assert.equal(error.code, "provider_call_ambiguous");
          assert.equal(error.requiresHuman, true);
          assert.equal(error.attempts.length, 1);
          assert.equal(error.attempts[0].status, "ambiguous");
          assert.equal(error.attempts[0].dispatchState, "ambiguous");
          assert.equal(error.routingDecision.outcome.status, "ambiguous");
          assert.equal(error.routingDecision.outcome.failureCode, "provider_call_ambiguous");
          assert.equal(error.routingDecision.outcome.budgetAccounted, true);
          return true;
        }
      );

      assert.equal(providerCalls, 1);
      assert.equal(ledger.lifecycle.filter((item) => item.operation === "reserve").length, 1);
      assert.equal(ledger.lifecycle.filter((item) => item.operation === "mark-dispatched").length, 1);
      assert.equal(ledger.lifecycle.filter((item) => item.operation === "settle").length, 0);
      assert.equal(ledger.lifecycle.filter((item) => item.operation === "mark-ambiguous").length, 1);
      assert.equal(ledger.lifecycle.filter((item) => item.operation === "record").length, 1);
      assert.equal(ledger.reservations.size, 1);
    });
  });
}

test("POST 已返回 2xx 但响应体丢失时仍按 Provider 调用不明冻结", async () => {
  await withProviderKeys(async () => {
    const ledger = recordingBudgetLedger();
    let providerCalls = 0;
    const client = await createAiClient({
      config: aiConfig(),
      budgetLedger: ledger,
      providerHealth: { primary: { state: "healthy" }, fallback: { state: "healthy" } },
      sleep: async () => {},
      fetchImpl: async () => {
        providerCalls += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            const error = new Error("response stream terminated");
            error.cause = { code: "ECONNRESET" };
            throw error;
          }
        };
      }
    });

    await assert.rejects(
      client.generateStructured("script", routingRequest()),
      (error) => error.code === "provider_call_ambiguous"
    );

    assert.equal(providerCalls, 1);
    assert.equal(ledger.lifecycle.filter((item) => item.operation === "settle").length, 0);
    assert.equal(ledger.lifecycle.filter((item) => item.operation === "mark-ambiguous").length, 1);
    assert.equal(ledger.reservations.size, 1);
  });
});

test("真实预算账本在连接重置后持久冻结，并阻止后续新预留", async () => {
  await withProviderKeys(async () => {
    const store = inMemoryEpisodeLedger();
    let providerCalls = 0;
    const client = await createAiClient({
      config: aiConfig(),
      budgetLedger: store.ledger,
      router: {
        route: () => ({
          id: "route-provider-ambiguity-integration",
          at: "2026-08-24T00:00:00.000Z",
          taskId: "script",
          profile: "creative-structured",
          reason: "固定测试路由",
          candidates: [],
          selected: { providerId: "primary", model: "test-model" },
          orderedRoutes: [{
            providerId: "primary",
            model: "test-model",
            reservationCostUsd: 0.2
          }],
          estimatedCostUsd: 0.16,
          pricingVersion: "test-pricing-v1",
          reservation: { calls: 1, costUsd: 0.2, safetyFactor: 1.25 },
          locked: false
        }),
        costForUsage: () => 0.16
      },
      providerHealth: { primary: { state: "healthy" }, fallback: { state: "healthy" } },
      sleep: async () => {},
      fetchImpl: async () => {
        providerCalls += 1;
        const error = new Error("socket reset after write");
        error.cause = { code: "ECONNRESET" };
        throw error;
      }
    });
    const request = routingRequest();
    request.routingContext.episodeId = "provider-ambiguity-integration";

    await assert.rejects(
      client.generateStructured("script", request),
      (error) => error.code === "provider_call_ambiguous"
    );

    assert.equal(providerCalls, 1);
    assert.equal(store.episode.control.budget.reservations.length, 1);
    assert.equal(store.episode.control.budget.reservedCalls, 1);
    assert.equal(store.episode.control.budget.usedCalls, 0);
    assert.equal(store.episode.control.budget.overrun, true);
    assert.deepEqual(
      getAmbiguousBudgetReservationIds(store.episode),
      [store.episode.control.budget.reservations[0].id]
    );
    assert.equal(store.episode.routingHistory.length, 1);
    assert.equal(store.episode.routingHistory[0].outcome.status, "ambiguous");
    await assert.rejects(
      store.ledger.reserve({
        episodeId: "provider-ambiguity-integration",
        reservationId: "later-route:attempt:1",
        calls: 1,
        costUsd: 0
      }),
      (error) => (
        error instanceof BudgetReservationError &&
        error.details.reasonCode === "budget_reconciliation_required"
      )
    );
  });
});

test("传输层明确证明尚未发出的同步失败以零用量释放预留后按策略重试", async () => {
  await withProviderKeys(async () => {
    const ledger = recordingBudgetLedger();
    let providerCalls = 0;
    const client = await createAiClient({
      config: aiConfig({ fallbackProviders: [] }),
      budgetLedger: ledger,
      providerHealth: { primary: { state: "healthy" } },
      sleep: async () => {},
      fetchImpl: () => {
        providerCalls += 1;
        if (providerCalls < 3) {
          const error = new Error("request options rejected before dispatch");
          error.requestDispatchState = "not_dispatched";
          throw error;
        }
        return Promise.resolve(successfulResponse());
      }
    });

    const result = await client.generateStructured("script", routingRequest());

    assert.deepEqual(result.value, { ok: true });
    assert.equal(providerCalls, 3);
    const settlements = ledger.lifecycle.filter((item) => item.operation === "settle");
    assert.equal(settlements.length, 3);
    assert.deepEqual(
      settlements.map(({ usedCalls, usedCostUsd }) => ({ usedCalls, usedCostUsd })),
      [
        { usedCalls: 0, usedCostUsd: 0 },
        { usedCalls: 0, usedCostUsd: 0 },
        { usedCalls: 1, usedCostUsd: 0 }
      ]
    );
    assert.equal(ledger.lifecycle.some((item) => item.operation === "mark-ambiguous"), false);
    assert.equal(ledger.reservations.size, 0);
  });
});

test("同步 transport 异常若未证明未派发则保守冻结且不重试", async () => {
  await withProviderKeys(async () => {
    const ledger = recordingBudgetLedger();
    let providerCalls = 0;
    const client = await createAiClient({
      config: aiConfig({ fallbackProviders: [] }),
      budgetLedger: ledger,
      providerHealth: { primary: { state: "healthy" } },
      sleep: async () => {},
      fetchImpl: () => {
        providerCalls += 1;
        const error = new Error("sync adapter disconnect");
        error.requestDispatchState = "ambiguous";
        error.code = "ECONNRESET";
        throw error;
      }
    });

    await assert.rejects(
      client.generateStructured("script", routingRequest()),
      (error) => error.code === "provider_call_ambiguous"
    );
    assert.equal(providerCalls, 1);
    assert.equal(ledger.lifecycle.some((item) => item.operation === "settle"), false);
    assert.equal(ledger.reservations.size, 1);
  });
});

test("歧义事件写入失败时，派发中状态仍持久冻结并阻止第二次 Provider 调用", async () => {
  await withProviderKeys(async () => {
    const store = inMemoryEpisodeLedger();
    const originalMarkAmbiguous = store.ledger.markAmbiguous;
    let providerCalls = 0;
    const ledger = {
      ...store.ledger,
      markAmbiguous: async () => {
        throw new Error("synthetic ambiguity event write failure");
      }
    };
    const client = await createAiClient({
      config: aiConfig({ fallbackProviders: [] }),
      budgetLedger: ledger,
      router: {
        route: () => ({
          id: `route-mark-failure-${providerCalls + 1}`,
          at: "2026-08-24T00:00:00.000Z",
          taskId: "script",
          profile: "creative-structured",
          reason: "固定测试路由",
          candidates: [],
          selected: { providerId: "primary", model: "test-model" },
          orderedRoutes: [{
            providerId: "primary",
            model: "test-model",
            reservationCostUsd: 0.2
          }],
          estimatedCostUsd: 0.16,
          pricingVersion: "test-pricing-v1",
          reservation: { calls: 1, costUsd: 0.2, safetyFactor: 1.25 },
          locked: false
        }),
        costForUsage: () => 0.16
      },
      providerHealth: { primary: { state: "healthy" } },
      sleep: async () => {},
      fetchImpl: async () => {
        providerCalls += 1;
        const error = new Error("socket reset after write");
        error.cause = { code: "ECONNRESET" };
        throw error;
      }
    });
    const request = routingRequest();
    request.routingContext.episodeId = "provider-ambiguity-integration";

    await assert.rejects(
      client.generateStructured("script", request),
      (error) => (
        error.code === "provider_call_ambiguous" &&
        error.details.ambiguityRecorded === false
      )
    );
    assert.equal(store.episode.control.budget.reservations[0].dispatchState, "dispatching");
    assert.equal(store.episode.control.budget.overrun, false);
    assert.equal(getAmbiguousBudgetReservationIds(store.episode).length, 1);

    await assert.rejects(
      client.generateStructured("script", request),
      (error) => error.code === "manual_intervention_required"
    );
    assert.equal(providerCalls, 1);
    assert.equal(typeof originalMarkAmbiguous, "function");
  });
});

test("Provider health 写入失败不丢弃已经结算的成功结果", async () => {
  await withProviderKeys(async () => {
    const ledger = recordingBudgetLedger();
    let providerCalls = 0;
    const client = await createAiClient({
      config: aiConfig({ fallbackProviders: [] }),
      budgetLedger: ledger,
      healthManager: {
        snapshot: () => ({ primary: { state: "healthy" } }),
        recordSuccess: async () => {
          throw new Error("synthetic health persistence failure");
        },
        recordFailure: async () => ({ state: "unavailable" })
      },
      sleep: async () => {},
      fetchImpl: async () => {
        providerCalls += 1;
        return successfulResponse();
      }
    });

    const result = await client.generateStructured("script", routingRequest());
    assert.deepEqual(result.value, { ok: true });
    assert.equal(providerCalls, 1);
    assert.equal(ledger.lifecycle.filter((item) => item.operation === "settle").length, 1);
    assert.equal(ledger.lifecycle.filter((item) => item.operation === "record").length, 1);
  });
});

test("明确 HTTP 503 仍结算该次尝试并按既有规则重试", async () => {
  await withProviderKeys(async () => {
    const ledger = recordingBudgetLedger();
    let providerCalls = 0;
    const client = await createAiClient({
      config: aiConfig({
        fallbackProviders: [],
        request: {
          timeoutMs: 1000,
          primaryAttempts: 2,
          fallbackAttempts: 1,
          retryBackoffMs: [0, 0, 0],
          maxOutputTokens: 100
        }
      }),
      budgetLedger: ledger,
      providerHealth: { primary: { state: "healthy" } },
      sleep: async () => {},
      fetchImpl: async () => {
        providerCalls += 1;
        if (providerCalls === 1) {
          return new Response(JSON.stringify({ error: { message: "temporary outage" } }), {
            status: 503,
            headers: { "content-type": "application/json" }
          });
        }
        return successfulResponse();
      }
    });

    const result = await client.generateStructured("script", routingRequest());

    assert.deepEqual(result.value, { ok: true });
    assert.equal(providerCalls, 2);
    assert.equal(ledger.lifecycle.filter((item) => item.operation === "settle").length, 2);
    assert.equal(ledger.lifecycle.some((item) => item.operation === "mark-ambiguous"), false);
    assert.equal(ledger.reservations.size, 0);
  });
});
