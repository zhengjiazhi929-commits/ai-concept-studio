import test from "node:test";
import assert from "node:assert/strict";
import {
  createModelRouter,
  RoutingPausedError
} from "../src/server/control/model-router.mjs";
import { createAiClient } from "../src/server/ai/client.mjs";
import { BudgetReservationError } from "../src/server/control/budget-ledger.mjs";

const registry = {
  profiles: {
    "creative-structured": { requires: ["structured-output", "creative-writing"] },
    "critical-review": { requires: ["structured-output", "reasoning"] },
    deterministic: { requires: [], providerRequired: false }
  },
  models: {
    "model-a": {
      capabilities: ["structured-output", "creative-writing", "reasoning"],
      profiles: ["creative-structured", "critical-review"],
      qualityTier: 2,
      costTier: 1,
      pricing: {
        status: "confirmed",
        version: "test-pricing-v1",
        inputUsdPerMillion: 1,
        cachedInputUsdPerMillion: 0.5,
        outputUsdPerMillion: 2,
        reasoningOutputUsdPerMillion: 3
      }
    },
    "locked-review-model": {
      capabilities: ["structured-output", "reasoning"],
      profiles: ["critical-review"],
      qualityTier: 3,
      costTier: 2,
      pricing: {
        status: "confirmed",
        version: "test-pricing-v1",
        inputUsdPerMillion: 2,
        outputUsdPerMillion: 4
      }
    }
  }
};

const policy = {
  providerPreference: ["primary", "fallback"],
  pauseWhenBudgetUnknown: false,
  budgetSafetyFactor: 1.25,
  taskProfiles: { script: "creative-structured", review: "critical-review" }
};

function aiConfig() {
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
      script: {
        profile: "creative-structured",
        model: "model-a",
        reasoningEffort: "low",
        verbosity: "low"
      },
      review: {
        profile: "critical-review",
        model: "model-a",
        reasoningEffort: "low",
        verbosity: "low"
      }
    },
    providers: {
      primary: {
        label: "Primary",
        baseUrl: "https://primary.example/v1",
        apiKeyEnv: "ROUTER_PRIMARY_TEST_KEY",
        enabled: true
      },
      fallback: {
        label: "Fallback",
        baseUrl: "https://fallback.example/v1",
        apiKeyEnv: "ROUTER_FALLBACK_TEST_KEY",
        enabled: true
      }
    }
  };
}

test("Model Router 按能力与健康度选择健康的备用 Provider", async () => {
  const router = await createModelRouter({
    aiConfig: aiConfig(),
    registry,
    policy,
    providerAvailability: { primary: true, fallback: true },
    providerHealth: { primary: { state: "degraded" }, fallback: { state: "healthy" } },
    now: new Date("2026-08-06T01:00:00.000Z")
  });
  const decision = router.route({
    taskId: "script",
    profile: "creative-structured",
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 1000
  });
  assert.deepEqual(decision.selected, { providerId: "fallback", model: "model-a" });
  assert.equal(decision.estimatedCostUsd, 0.003);
  assert.equal(Number.isFinite(decision.selectedScore), true);
  assert.equal(Number.isFinite(decision.candidates.find((item) => item.eligible).score), true);
  assert.equal(decision.candidates.some((candidate) => Object.hasOwn(candidate, "apiKeyEnv")), false);
});

test("未知 Provider 健康状态按不可用处理，不会被误当作健康通道", async () => {
  const router = await createModelRouter({
    aiConfig: aiConfig(),
    registry,
    policy,
    providerAvailability: { primary: true, fallback: true },
    providerHealth: { primary: { state: "corrupted" }, fallback: { state: "healthy" } }
  });
  const decision = router.route({ taskId: "script", profile: "creative-structured" });
  assert.deepEqual(decision.selected, { providerId: "fallback", model: "model-a" });
  assert.equal(decision.candidates[0].health, "unavailable");
});

test("路由策略会执行 degraded 开关和 Reviewer 隔离，而不是忽略配置", async () => {
  const strictPolicy = {
    ...policy,
    allowDegradedFallback: false,
    reviewIsolation: { enabled: true, profiles: ["critical-review"] }
  };
  const unavailable = await createModelRouter({
    aiConfig: aiConfig(),
    registry,
    policy: strictPolicy,
    providerAvailability: { primary: true, fallback: true },
    providerHealth: {
      primary: { state: "degraded" },
      fallback: { state: "unavailable" }
    }
  });
  assert.throws(
    () => unavailable.route({ taskId: "script", profile: "creative-structured" }),
    /没有满足能力/u
  );

  const isolated = await createModelRouter({
    aiConfig: aiConfig(),
    registry,
    policy: strictPolicy,
    providerAvailability: { primary: true, fallback: true }
  });
  const decision = isolated.route({
    taskId: "review",
    profile: "critical-review",
    producerRoute: { providerId: "primary", model: "model-a" }
  });
  assert.deepEqual(decision.selected, { providerId: "fallback", model: "model-a" });
  assert.equal(decision.isolationApplied, true);
});

test("人工锁定 Provider/模型后不会自动回退或覆盖", async () => {
  const router = await createModelRouter({
    aiConfig: aiConfig(),
    registry,
    policy,
    providerAvailability: { primary: true, fallback: true }
  });
  const decision = router.route({
    taskId: "review",
    profile: "critical-review",
    control: {
      lockedRoute: { providerId: "fallback", model: "locked-review-model" },
      budget: { maxCalls: null, usedCalls: 0, maxCostUsd: null, usedCostUsd: 0 }
    }
  });
  assert.deepEqual(decision.selected, {
    providerId: "fallback",
    model: "locked-review-model"
  });
  assert.equal(decision.locked, true);
  assert.deepEqual(
    decision.orderedRoutes.map(({ providerId, model }) => ({ providerId, model })),
    [decision.selected]
  );
});

test("预算不足、Provider 不可用或能力不匹配时安全暂停", async () => {
  const router = await createModelRouter({
    aiConfig: aiConfig(),
    registry,
    policy,
    providerAvailability: { primary: true, fallback: false }
  });
  assert.throws(
    () => router.route({
      taskId: "script",
      profile: "creative-structured",
      control: {
        lockedRoute: { providerId: "fallback", model: null },
        budget: { maxCalls: 1, usedCalls: 1, maxCostUsd: null, usedCostUsd: 0 }
      }
    }),
    (error) => error instanceof RoutingPausedError && error.requiresHuman
  );
});

test("确定性档位不需要 Provider，也不会产生费用", async () => {
  const config = aiConfig();
  config.tasks.local = { profile: "deterministic", model: "deterministic" };
  const router = await createModelRouter({
    aiConfig: config,
    registry,
    policy,
    providerAvailability: { primary: false, fallback: false }
  });
  const decision = router.route({ taskId: "local", profile: "deterministic" });
  assert.deepEqual(decision.selected, { providerId: "local", model: "deterministic" });
  assert.equal(decision.estimatedCostUsd, 0);
});

test("AI 客户端使用路由决策并保留既有重试/回退边界", async () => {
  process.env.ROUTER_PRIMARY_TEST_KEY = "test-placeholder";
  process.env.ROUTER_FALLBACK_TEST_KEY = "test-placeholder";
  const calls = [];
  const client = await createAiClient({
    config: aiConfig(),
    modelRegistry: registry,
    routingPolicy: policy,
    providerAvailability: { primary: true, fallback: true },
    providerHealth: { primary: { state: "degraded" }, fallback: { state: "healthy" } },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        output_text: JSON.stringify({ ok: true }),
        usage: { input_tokens: 2, output_tokens: 1 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  try {
    const result = await client.generateStructured("script", {
      schemaName: "router_test",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean" } },
        required: ["ok"]
      },
      instructions: "test",
      input: "test"
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /fallback\.example/u);
    assert.equal(calls[0].body.model, "model-a");
    assert.equal(result.routingDecision.outcome.status, "succeeded");
    assert.equal(result.routingDecision.outcome.actualCostUsd, 0.000004);
    assert.equal(result.routingDecision.outcome.pricingVersion, "test-pricing-v1");
    assert.equal(result.routingDecision.outcome.fallbackUsed, false);
  } finally {
    delete process.env.ROUTER_PRIMARY_TEST_KEY;
    delete process.env.ROUTER_FALLBACK_TEST_KEY;
  }
});

test("AI 客户端严格按预留、请求、结算、审计顺序执行", async () => {
  process.env.ROUTER_PRIMARY_TEST_KEY = "test-placeholder";
  process.env.ROUTER_FALLBACK_TEST_KEY = "test-placeholder";
  const lifecycle = [];
  const client = await createAiClient({
    config: aiConfig(),
    modelRegistry: registry,
    routingPolicy: policy,
    providerAvailability: { primary: true, fallback: true },
    providerHealth: { primary: { state: "healthy" }, fallback: { state: "healthy" } },
    budgetLedger: {
      reserve: async () => lifecycle.push("reserve"),
      markDispatched: async () => lifecycle.push("dispatch"),
      settle: async () => lifecycle.push("settle"),
      recordDecision: async () => lifecycle.push("record")
    },
    fetchImpl: async () => {
      lifecycle.push("request");
      return new Response(JSON.stringify({
        output_text: JSON.stringify({ ok: true }),
        usage: { input_tokens: 2, output_tokens: 1 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  try {
    const result = await client.generateStructured("script", {
      schemaName: "budget_lifecycle_test",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { ok: { type: "boolean" } },
        required: ["ok"]
      },
      instructions: "test",
      input: "test",
      routingContext: {
        episodeId: "budget-lifecycle",
        persistBudget: true,
        control: {
          budget: {
            maxCalls: 2,
            usedCalls: 0,
            reservedCalls: 0,
            maxCostUsd: 1,
            usedCostUsd: 0,
            reservedCostUsd: 0
          }
        }
      }
    });
    assert.deepEqual(lifecycle, ["reserve", "dispatch", "request", "settle", "record"]);
    assert.equal(result.routingDecision.outcome.budgetAccounted, true);
  } finally {
    delete process.env.ROUTER_PRIMARY_TEST_KEY;
    delete process.env.ROUTER_FALLBACK_TEST_KEY;
  }
});

test("预算预留被拒绝时不会触发 Provider 请求", async () => {
  process.env.ROUTER_PRIMARY_TEST_KEY = "test-placeholder";
  process.env.ROUTER_FALLBACK_TEST_KEY = "test-placeholder";
  let providerCalls = 0;
  const client = await createAiClient({
    config: aiConfig(),
    modelRegistry: registry,
    routingPolicy: policy,
    providerAvailability: { primary: true, fallback: true },
    providerHealth: { primary: { state: "healthy" }, fallback: { state: "healthy" } },
    budgetLedger: {
      reserve: async () => {
        throw new BudgetReservationError("test budget denied");
      },
      settle: async () => {},
      recordDecision: async () => {}
    },
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("must not be called");
    }
  });
  try {
    await assert.rejects(
      client.generateStructured("script", {
        schemaName: "budget_denied_test",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { ok: { type: "boolean" } },
          required: ["ok"]
        },
        instructions: "test",
        input: "test",
        routingContext: {
          episodeId: "budget-denied",
          persistBudget: true,
          control: {
            budget: {
              maxCalls: 1,
              usedCalls: 0,
              reservedCalls: 0,
              maxCostUsd: 1,
              usedCostUsd: 0,
              reservedCostUsd: 0
            }
          }
        }
      }),
      /test budget denied/u
    );
    assert.equal(providerCalls, 0);
  } finally {
    delete process.env.ROUTER_PRIMARY_TEST_KEY;
    delete process.env.ROUTER_FALLBACK_TEST_KEY;
  }
});

test("费用预算启用时，未经确认的价格会暂停而不是按零成本运行", async () => {
  const unconfirmedRegistry = structuredClone(registry);
  unconfirmedRegistry.models["model-a"].pricing.status = "unconfirmed";
  unconfirmedRegistry.models["model-a"].pricing.version = null;
  const router = await createModelRouter({
    aiConfig: aiConfig(),
    registry: unconfirmedRegistry,
    policy: { ...policy, pauseWhenBudgetUnknown: true },
    providerAvailability: { primary: true, fallback: true }
  });
  assert.throws(
    () => router.route({
      taskId: "script",
      control: {
        budget: { maxCostUsd: 1, usedCostUsd: 0, maxCalls: 10, usedCalls: 0 }
      }
    }),
    /模型价格未知/u
  );
});

test("模拟 Provider 错误中的疑似凭据不会进入异常和尝试记录", async () => {
  process.env.ROUTER_PRIMARY_TEST_KEY = "test-placeholder";
  process.env.ROUTER_FALLBACK_TEST_KEY = "test-placeholder";
  const marker = ["sk", "proj", "unit", "marker", "12345678"].join("-");
  const client = await createAiClient({
    config: aiConfig(),
    modelRegistry: registry,
    routingPolicy: policy,
    providerAvailability: { primary: true, fallback: true },
    providerHealth: { primary: { state: "healthy" }, fallback: { state: "healthy" } },
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: `request rejected ${marker}`, code: marker }
    }), { status: 401, headers: { "content-type": "application/json" } })
  });
  try {
    await assert.rejects(
      client.generateStructured("script", {
        schemaName: "redaction_test",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { ok: { type: "boolean" } },
          required: ["ok"]
        },
        instructions: "test",
        input: "test"
      }),
      (error) => {
        assert.equal(error.message.includes(marker), false);
        assert.equal(JSON.stringify(error.attempts).includes(marker), false);
        assert.equal(error.message.includes("[REDACTED]"), true);
        return true;
      }
    );
  } finally {
    delete process.env.ROUTER_PRIMARY_TEST_KEY;
    delete process.env.ROUTER_FALLBACK_TEST_KEY;
  }
});
