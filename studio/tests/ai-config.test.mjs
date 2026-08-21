import test from "node:test";
import assert from "node:assert/strict";
import { AiGenerationPausedError, createAiClient } from "../src/server/ai/client.mjs";
import { providerStatus } from "../src/shared/ai-config.mjs";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: { ok: { type: "boolean" } },
  required: ["ok"]
};

test("AI 状态只暴露是否已配置，不暴露密钥", () => {
  const config = {
    primaryProvider: "one",
    providers: {
      one: {
        label: "One",
        enabled: true,
        baseUrl: "https://example.com/v1",
        apiKeyEnv: "STUDIO_TEST_KEY"
      }
    }
  };
  const status = providerStatus(config, { STUDIO_TEST_KEY: "secret-value" });
  assert.equal(status[0].configured, true);
  assert.equal(JSON.stringify(status).includes("secret-value"), false);
  assert.equal(Object.hasOwn(status[0], "apiKeyEnv"), false);
});

test("AI 客户端在主通道未配置时使用备用通道和模型映射", async () => {
  process.env.STUDIO_FALLBACK_TEST_KEY = "test-only-secret";
  let request;
  const config = {
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
      script: { model: "draft-model", reasoningEffort: "low", verbosity: "low" }
    },
    providers: {
      primary: {
        label: "Primary",
        baseUrl: "https://primary.example/v1",
        apiKeyEnv: "STUDIO_PRIMARY_TEST_KEY",
        enabled: true
      },
      fallback: {
        label: "Fallback",
        baseUrl: "https://fallback.example/v1",
        apiKeyEnv: "STUDIO_FALLBACK_TEST_KEY",
        enabled: true,
        modelOverrides: { "draft-model": "mapped-model" }
      }
    }
  };
  const client = await createAiClient({
    config,
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        id: "response-test",
        output_text: JSON.stringify({ ok: true }),
        usage: { input_tokens: 12, output_tokens: 4 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  try {
    const result = await client.generateStructured("script", {
      schemaName: "test_shape",
      schema,
      instructions: "Return the test shape",
      input: "test"
    });
    assert.equal(result.provider, "fallback");
    assert.equal(result.model, "mapped-model");
    assert.deepEqual(result.value, { ok: true });
    assert.equal(request.url, "https://fallback.example/v1/responses");
    assert.equal(request.body.text.format.type, "json_schema");
  } finally {
    delete process.env.STUDIO_FALLBACK_TEST_KEY;
  }
});

test("API 额度耗尽不会被当成普通限流反复重试", async () => {
  process.env.STUDIO_QUOTA_TEST_KEY = "test-only-secret";
  let calls = 0;
  const config = {
    primaryProvider: "only",
    fallbackProviders: [],
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
      only: {
        label: "Only",
        baseUrl: "https://example.com/v1",
        apiKeyEnv: "STUDIO_QUOTA_TEST_KEY",
        enabled: true
      }
    }
  };
  const client = await createAiClient({
    config,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        error: { code: "insufficient_quota", message: "No credits" }
      }), { status: 429, headers: { "content-type": "application/json" } });
    }
  });
  try {
    await assert.rejects(
      client.generateStructured("script", {
        schemaName: "test_shape",
        schema,
        instructions: "test",
        input: "test"
      }),
      /No credits/u
    );
    assert.equal(calls, 1);
  } finally {
    delete process.env.STUDIO_QUOTA_TEST_KEY;
  }
});

test("临时失败严格执行主通道三次、备用通道一次", async () => {
  process.env.STUDIO_PRIMARY_RETRY_KEY = "test-only-secret";
  process.env.STUDIO_FALLBACK_RETRY_KEY = "test-only-secret";
  const calls = [];
  const config = {
    primaryProvider: "primary",
    fallbackProviders: ["fallback", "never-used"],
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
        apiKeyEnv: "STUDIO_PRIMARY_RETRY_KEY",
        enabled: true
      },
      fallback: {
        label: "Fallback",
        baseUrl: "https://fallback.example/v1",
        apiKeyEnv: "STUDIO_FALLBACK_RETRY_KEY",
        enabled: true
      },
      "never-used": {
        label: "Never used",
        baseUrl: "https://never.example/v1",
        apiKeyEnv: "STUDIO_FALLBACK_RETRY_KEY",
        enabled: true
      }
    }
  };
  const client = await createAiClient({
    config,
    sleep: async () => {},
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ error: { message: "temporary outage" } }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    }
  });
  try {
    await assert.rejects(
      client.generateStructured("script", {
        schemaName: "test_shape",
        schema,
        instructions: "test",
        input: "test"
      }),
      (error) => {
        assert.equal(error instanceof AiGenerationPausedError, true);
        assert.equal(error.code, "manual_intervention_required");
        assert.equal(error.attempts.length, 4);
        assert.deepEqual(
          error.attempts.map(({ provider, attempt }) => ({ provider, attempt })),
          [
            { provider: "primary", attempt: 1 },
            { provider: "primary", attempt: 2 },
            { provider: "primary", attempt: 3 },
            { provider: "fallback", attempt: 1 }
          ]
        );
        return true;
      }
    );
    assert.equal(calls.filter((url) => url.includes("primary.example")).length, 3);
    assert.equal(calls.filter((url) => url.includes("fallback.example")).length, 1);
    assert.equal(calls.some((url) => url.includes("never.example")), false);
  } finally {
    delete process.env.STUDIO_PRIMARY_RETRY_KEY;
    delete process.env.STUDIO_FALLBACK_RETRY_KEY;
  }
});

test("主通道三次失败后可由备用通道的一次尝试恢复", async () => {
  process.env.STUDIO_PRIMARY_RECOVERY_KEY = "test-only-secret";
  process.env.STUDIO_FALLBACK_RECOVERY_KEY = "test-only-secret";
  let calls = 0;
  const config = {
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
        apiKeyEnv: "STUDIO_PRIMARY_RECOVERY_KEY",
        enabled: true
      },
      fallback: {
        label: "Fallback",
        baseUrl: "https://fallback.example/v1",
        apiKeyEnv: "STUDIO_FALLBACK_RECOVERY_KEY",
        enabled: true
      }
    }
  };
  const client = await createAiClient({
    config,
    sleep: async () => {},
    fetchImpl: async (url) => {
      calls += 1;
      if (url.includes("primary.example")) {
        return new Response(JSON.stringify({ error: { message: "temporary outage" } }), {
          status: 503,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ output_text: JSON.stringify({ ok: true }) }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  try {
    const result = await client.generateStructured("script", {
      schemaName: "test_shape",
      schema,
      instructions: "test",
      input: "test"
    });
    assert.equal(result.provider, "fallback");
    assert.equal(result.attempts.length, 4);
    assert.equal(calls, 4);
  } finally {
    delete process.env.STUDIO_PRIMARY_RECOVERY_KEY;
    delete process.env.STUDIO_FALLBACK_RECOVERY_KEY;
  }
});
