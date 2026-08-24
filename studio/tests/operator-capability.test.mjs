import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createStudioServer } from "../src/server/app.mjs";
import {
  assertSideEffectGrant,
  consumeSideEffectGrantUsage,
  createCapabilityAuthority
} from "../src/server/security/side-effect-capability.mjs";
import {
  OperatorAuthorizationError,
  operatorSecurityOptionsFromEnvironment
} from "../src/server/security/operator-auth.mjs";
import {
  exactApprovalBinding,
  runAgent
} from "../src/server/orchestrator.mjs";
import { generateScriptDraft } from "../src/server/production/generator.mjs";
import { adjudicateAmbiguousExternalAssetReceipt } from
  "../src/server/production/external-assets.mjs";
import {
  AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION,
  reconcileAmbiguousProviderBudget
} from "../src/server/control/budget-ledger.mjs";
import { readFixtureEpisode } from "./episode-fixture.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";

const OPERATOR_TOKEN = "test-operator-token-20260824-at-least-thirty-two-bytes";
const CAPABILITY_SECRET = "test-capability-secret-20260824-at-least-thirty-two-bytes";

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

function capabilitySpec(overrides = {}) {
  return {
    episodeId: "fixture-episode",
    operation: "worker:script-agent",
    scopes: ["state.write", "model.invoke", "network.request", "paid.invoke"],
    maxCalls: 1,
    maxCostUsd: 0.25,
    ...overrides
  };
}

test("真实服务启动只从完整服务端环境装载 operator 与 Capability 策略", () => {
  assert.deepEqual(operatorSecurityOptionsFromEnvironment({}), {});
  assert.throws(
    () => operatorSecurityOptionsFromEnvironment({
      AI_CONCEPT_STUDIO_OPERATOR_ACTOR: "human:test-operator"
    }),
    (error) => error instanceof OperatorAuthorizationError &&
      error.code === "operator_security_config_incomplete" &&
      error.statusCode === 500
  );
  const options = operatorSecurityOptionsFromEnvironment({
    AI_CONCEPT_STUDIO_OPERATOR_ACTOR: "human:test-operator",
    AI_CONCEPT_STUDIO_OPERATOR_TOKEN: OPERATOR_TOKEN,
    AI_CONCEPT_STUDIO_CAPABILITY_SECRET: CAPABILITY_SECRET,
    AI_CONCEPT_STUDIO_CAPABILITY_MAX_CALLS: "2",
    AI_CONCEPT_STUDIO_CAPABILITY_MAX_COST_USD: "0.5",
    AI_CONCEPT_STUDIO_CAPABILITY_TTL_MS: "30000",
    AI_CONCEPT_STUDIO_CAPABILITY_MAXIMUM_TTL_MS: "60000"
  });
  assert.deepEqual(options, {
    operatorActor: "human:test-operator",
    operatorToken: OPERATOR_TOKEN,
    capabilitySecret: CAPABILITY_SECRET,
    capabilityMaximumCalls: 2,
    capabilityMaximumCostUsd: 0.5,
    capabilityTtlMs: 30_000,
    capabilityMaximumTtlMs: 60_000
  });
});

test("服务端 Capability 校验可重复，真实用量按调用与费用同步消费", () => {
  let nowMs = Date.parse("2026-08-24T06:00:00.000Z");
  const authority = createCapabilityAuthority({
    secret: CAPABILITY_SECRET,
    now: () => nowMs,
    maximumCalls: 2,
    maximumCostUsd: 0.5,
    defaultTtlMs: 30_000
  });
  const expected = capabilitySpec();
  const token = authority.issue(expected);
  const grant = authority.consume(token, expected);
  assert.throws(
    () => grant.scopes.push("filesystem.write"),
    TypeError
  );
  assert.equal(assertSideEffectGrant(grant, expected).episodeId, expected.episodeId);
  assert.equal(assertSideEffectGrant(grant, expected), grant);
  const usage = consumeSideEffectGrantUsage(grant, expected, {
    calls: 1,
    costUsd: 0.2
  });
  assert.deepEqual(usage, {
    usedCalls: 1,
    usedCostUsd: 0.2,
    remainingCalls: 0,
    remainingCostUsd: 0.05
  });
  assert.throws(
    () => consumeSideEffectGrantUsage(grant, expected, {
      calls: 1,
      costUsd: 0
    }),
    (error) => error.code === "side_effect_capability_calls_exceeded" &&
      error.details.usedCalls === 1 &&
      error.details.remainingCalls === 0
  );
  assert.throws(
    () => consumeSideEffectGrantUsage(grant, expected, {
      calls: 0,
      costUsd: 0.06
    }),
    (error) => error.code === "side_effect_capability_cost_exceeded" &&
      error.details.usedCostUsd === 0.2 &&
      error.details.remainingCostUsd === 0.05
  );
  assert.equal(assertSideEffectGrant(grant, expected), grant);
  assert.equal(JSON.stringify(token).includes(CAPABILITY_SECRET), false);

  assert.throws(
    () => authority.consume(token, expected),
    (error) => error.code === "side_effect_capability_replayed" && error.statusCode === 403
  );

  const wrongEpisodeToken = authority.issue(expected);
  assert.throws(
    () => authority.consume(wrongEpisodeToken, {
      ...expected,
      episodeId: "different-episode"
    }),
    (error) => error.code === "side_effect_capability_episode_mismatch"
  );

  const insufficientToken = authority.issue(expected);
  assert.throws(
    () => authority.consume(insufficientToken, {
      ...expected,
      maxCalls: 2
    }),
    (error) => error.code === "side_effect_capability_calls_exceeded"
  );

  const expiring = authority.issue({ ...expected, ttlMs: 1_000 });
  nowMs += 1_001;
  assert.throws(
    () => authority.consume(expiring, expected),
    (error) => error.code === "side_effect_capability_expired"
  );
});

test("缺少 operator 认证或 Capability authority 时敏感 HTTP 请求零读取零写入", async () => {
  for (const serverOptions of [
    {},
    { operatorToken: OPERATOR_TOKEN, operatorActor: "human:test-operator" }
  ]) {
    let reads = 0;
    let writes = 0;
    const { server } = await createStudioServer({
      recoverOnStart: false,
      ...serverOptions,
      readEpisode: async () => {
        reads += 1;
        return readFixtureEpisode();
      },
      writeEpisode: async () => {
        writes += 1;
      }
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/episodes/golden-001/approvals/script`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(serverOptions.operatorToken
              ? { "x-operator-token": OPERATOR_TOKEN }
              : {})
          },
          body: JSON.stringify({ note: "不得到达审批逻辑" })
        }
      );
      assert.equal(response.status, 403);
      assert.equal(
        (await response.json()).code,
        serverOptions.operatorToken
          ? "side_effect_capability_disabled"
          : "operator_auth_forbidden"
      );
      assert.equal(reads, 0);
      assert.equal(writes, 0);
    } finally {
      await closeServer(server);
    }
  }
});

test("localhost operator session 要求一次性解锁、HttpOnly cookie、CSRF 与有效期", async () => {
  let nowMs = Date.parse("2026-08-24T06:10:00.000Z");
  let stored = await readFixtureEpisode();
  stored.control.reviewEnabled = false;
  stored.approvals.research.artifactHash = currentGateArtifactHash(
    stored,
    "research"
  );
  const step = stored.pipeline.find((item) => item.agent === "script-agent");
  step.status = "waiting_approval";
  step.requiresApproval = "script";
  stored.approvals.script.status = "pending";
  stored.reviews.script.latestReportId = "review-script-session-v1";
  let reads = 0;
  let writes = 0;
  const created = await createStudioServer({
    recoverOnStart: false,
    operatorToken: OPERATOR_TOKEN,
    operatorActor: "human:session-operator",
    capabilitySecret: CAPABILITY_SECRET,
    operatorSessionNow: () => nowMs,
    operatorSessionTtlMs: 1_000,
    operatorUnlockTtlMs: 5_000,
    readEpisode: async () => {
      reads += 1;
      return structuredClone(stored);
    },
    writeEpisode: async (episode) => {
      writes += 1;
      stored = structuredClone(episode);
    },
    appendEvent: async () => {}
  });
  const { server, config, operatorUnlockCode } = created;
  assert.equal(typeof operatorUnlockCode, "string");
  assert.equal(operatorUnlockCode.includes(OPERATOR_TOKEN), false);
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const origin = `http://127.0.0.1:${config.port}`;
    const unlock = (unlockCode, includeOrigin = true) => fetch(
      `${base}/api/operator/session`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(includeOrigin ? { origin } : {})
        },
        body: JSON.stringify({ unlockCode })
      }
    );

    const missingOrigin = await unlock(operatorUnlockCode, false);
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json()).code, "forbidden_origin");

    const wrongUnlock = await unlock("wrong-one-time-code");
    assert.equal(wrongUnlock.status, 403);
    assert.equal(
      (await wrongUnlock.json()).code,
      "operator_session_unlock_forbidden"
    );

    const unlocked = await unlock(operatorUnlockCode);
    assert.equal(unlocked.status, 201);
    const setCookie = unlocked.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /acs_operator_session=[^;,]+; HttpOnly; SameSite=Strict/u);
    assert.match(setCookie, /acs_operator_csrf=[^;,]+; SameSite=Strict/u);
    const sessionCookie = /acs_operator_session=([^;,]+)/u.exec(setCookie)?.[1];
    const unlockedBody = await unlocked.json();
    assert.equal(unlockedBody.actor, "human:session-operator");
    assert.equal(typeof unlockedBody.csrfToken, "string");
    assert.equal(JSON.stringify(unlockedBody).includes(OPERATOR_TOKEN), false);
    assert.equal(setCookie.includes(OPERATOR_TOKEN), false);

    const replayedUnlock = await unlock(operatorUnlockCode);
    assert.equal(replayedUnlock.status, 403);
    assert.equal(
      (await replayedUnlock.json()).code,
      "operator_session_unlock_forbidden"
    );

    const binding = exactApprovalBinding(stored, "script");
    const endpoint = `${base}/api/episodes/${stored.id}/approvals/script`;
    const approveWithSession = (csrfToken, cookie = sessionCookie) => fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie: `acs_operator_session=${cookie}` } : {}),
        ...(csrfToken ? { "x-operator-csrf": csrfToken } : {})
      },
      body: JSON.stringify({ ...binding, note: "session 批准" })
    });

    const noSession = await approveWithSession(unlockedBody.csrfToken, null);
    assert.equal(noSession.status, 403);
    assert.equal((await noSession.json()).code, "operator_auth_forbidden");
    assert.equal(reads, 0);
    assert.equal(writes, 0);

    const noCsrf = await approveWithSession(null);
    assert.equal(noCsrf.status, 403);
    assert.equal((await noCsrf.json()).code, "operator_session_csrf_forbidden");
    assert.equal(reads, 0);
    assert.equal(writes, 0);

    const wrongCsrf = await approveWithSession("wrong-csrf-token");
    assert.equal(wrongCsrf.status, 403);
    assert.equal((await wrongCsrf.json()).code, "operator_session_csrf_forbidden");
    assert.equal(reads, 0);
    assert.equal(writes, 0);

    const approved = await approveWithSession(unlockedBody.csrfToken);
    assert.equal(approved.status, 200);
    assert.equal(writes, 1);
    assert.equal(stored.approvalHistory.at(-1).actor, "human:session-operator");

    const readsBeforeExpiry = reads;
    const writesBeforeExpiry = writes;
    nowMs += 1_001;
    const expired = await approveWithSession(unlockedBody.csrfToken);
    assert.equal(expired.status, 403);
    assert.equal((await expired.json()).code, "operator_session_expired");
    assert.equal(reads, readsBeforeExpiry);
    assert.equal(writes, writesBeforeExpiry);
  } finally {
    await closeServer(server);
  }
});

test("Web API 写请求只使用短期 session CSRF，不持久化长期 operator token", async () => {
  const source = await readFile(
    new URL("../src/web/app.js", import.meta.url),
    "utf8"
  );
  const recoveryCodesMatch = source.match(
    /const operatorSessionRecoveryCodes = new Set\(\[([\s\S]*?)\]\);/u
  );
  assert.ok(recoveryCodesMatch);
  assert.deepEqual(
    [...recoveryCodesMatch[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]),
    [
      "operator_auth_forbidden",
      "operator_session_expired",
      "operator_session_csrf_forbidden"
    ]
  );
  assert.match(source, /headers\["x-operator-csrf"\] = operatorCsrfToken/u);
  assert.match(source, /fetch\("\/api\/operator\/session"/u);
  assert.match(source, /document\.cookie = "acs_operator_csrf=; Path=\/; SameSite=Strict; Max-Age=0"/u);
  assert.match(source, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/u);
  assert.match(
    source,
    /mutating &&\s*attempt === 0 &&\s*operatorSessionRecoveryCodes\.has\(body\.code\)/u
  );
  assert.equal(source.includes("x-operator-token"), false);
  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("sessionStorage"), false);
});

test("外部素材人工重试在缺少 scoped Capability 时零读取零写入", async () => {
  let reads = 0;
  let writes = 0;
  await assert.rejects(
    adjudicateAmbiguousExternalAssetReceipt("golden-001", {}, {
      actor: "human:test-operator",
      requireSideEffectCapability: true,
      readEpisode: async () => {
        reads += 1;
        return readFixtureEpisode();
      },
      writeEpisode: async () => {
        writes += 1;
      },
      appendEvent: async () => {
        writes += 1;
      }
    }),
    (error) => error.code === "side_effect_capability_missing" &&
      error.statusCode === 403
  );
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test("敏感 HTTP 请求拒绝客户端伪造 actor，并用服务端身份记录真实批准", async () => {
  let stored = await readFixtureEpisode();
  stored.control.reviewEnabled = false;
  const step = stored.pipeline.find((item) => item.agent === "script-agent");
  step.status = "waiting_approval";
  step.requiresApproval = "script";
  stored.approvals.script.status = "pending";
  stored.reviews.script.latestReportId = "review-script-operator-auth-v1";
  let writes = 0;
  const { server } = await createStudioServer({
    recoverOnStart: false,
    operatorToken: OPERATOR_TOKEN,
    operatorActor: "human:trusted-operator",
    capabilitySecret: CAPABILITY_SECRET,
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      writes += 1;
      stored = structuredClone(episode);
    },
    appendEvent: async () => {}
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const endpoint =
      `http://127.0.0.1:${server.address().port}/api/episodes/${stored.id}/approvals/script`;
    const binding = exactApprovalBinding(stored, "script");
    const request = (body, token = OPERATOR_TOKEN) => fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-operator-token": token } : {})
      },
      body: JSON.stringify(body)
    });

    const forged = await request({
      ...binding,
      actor: "human:forged-client",
      note: "伪造身份"
    });
    assert.equal(forged.status, 400);
    assert.equal((await forged.json()).code, "operator_actor_client_forbidden");
    assert.equal(writes, 0);

    const wrongToken = await request({ ...binding, note: "错误 token" }, "x".repeat(40));
    assert.equal(wrongToken.status, 403);
    assert.equal((await wrongToken.json()).code, "operator_auth_forbidden");
    assert.equal(writes, 0);

    const approved = await request({ ...binding, note: "批准当前版本" });
    assert.equal(approved.status, 200);
    assert.equal(writes, 1);
    assert.equal(stored.approvalHistory.at(-1).actor, "human:trusted-operator");
    assert.equal(stored.approvals.script.history.at(-1).actor, "human:trusted-operator");
    assert.equal(JSON.stringify(stored).includes(OPERATOR_TOKEN), false);
    assert.equal(JSON.stringify(stored).includes(CAPABILITY_SECRET), false);
  } finally {
    await closeServer(server);
  }
});

test("默认 Generator 模型路径缺少 Capability 时在模型与文件副作用前关闭", async () => {
  const episode = await readFixtureEpisode();
  episode.production.ai = { ...(episode.production.ai ?? {}), requestCount: 0 };
  let writes = 0;
  await assert.rejects(
    generateScriptDraft(episode, {
      writeArtifact: async () => {
        writes += 1;
        throw new Error("不应写入");
      }
    }),
    (error) => error.code === "side_effect_capability_missing"
  );
  assert.equal(writes, 0);
});

test("编排器显式要求 Capability 时，缺失授权不会启动 Worker 或写状态", async () => {
  let stored = await readFixtureEpisode();
  stored.pipeline.find((item) => item.agent === "script-agent").status = "ready";
  let writes = 0;
  let workerRuns = 0;
  await assert.rejects(
    runAgent(stored.id, "script-agent", {
      requireSideEffectCapability: true,
      readEpisode: async () => structuredClone(stored),
      writeEpisode: async (episode) => {
        writes += 1;
        stored = structuredClone(episode);
      },
      appendEvent: async () => {},
      agent: {
        async run() {
          workerRuns += 1;
          return { status: "complete", message: "不应运行" };
        }
      }
    }),
    (error) => error.code === "side_effect_capability_missing"
  );
  assert.equal(writes, 0);
  assert.equal(workerRuns, 0);
});

test("Worker 只收到 Manifest 收窄的 grant，不能取得或夹带权限签发 authority", async () => {
  let stored = await readFixtureEpisode();
  stored.pipeline.find((item) => item.agent === "script-agent").status = "ready";
  stored.control.reviewEnabled = false;
  stored.approvals.research.artifactHash = currentGateArtifactHash(
    stored,
    "research"
  );
  stored.control.budget = {
    maxCalls: 1,
    maxCostUsd: 0.25,
    usedCalls: 0,
    usedCostUsd: 0,
    reservedCalls: 0,
    reservedCostUsd: 0,
    overrun: false,
    reservations: []
  };
  const authority = createCapabilityAuthority({
    secret: CAPABILITY_SECRET,
    maximumCalls: 1,
    maximumCostUsd: 0.25
  });
  let authorizations = 0;
  let workerRuns = 0;
  const result = await runAgent(stored.id, "script-agent", {
    requireSideEffectCapability: true,
    authorizeSideEffect(spec) {
      authorizations += 1;
      return authority.authorize(spec);
    },
    externalAssetOptions: {
      authorizeSideEffect() {
        throw new Error("Worker 不应取得嵌套的 authority");
      },
      sideEffectGrant: { forged: true },
      fetch: async () => {
        throw new Error("本测试不应 fetch");
      }
    },
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {},
    agent: {
      async run(_episode, context) {
        workerRuns += 1;
        assert.equal(Object.hasOwn(context, "authorizeSideEffect"), false);
        assert.equal(
          Object.hasOwn(context.externalAssetOptions, "authorizeSideEffect"),
          false
        );
        assert.equal(
          Object.hasOwn(context.externalAssetOptions, "sideEffectGrant"),
          false
        );
        assert.equal(typeof context.externalAssetOptions.fetch, "function");
        assert.throws(
          () => assertSideEffectGrant(context.sideEffectGrant, {
            episodeId: "another-episode",
            operation: "worker:asset-agent",
            scopes: ["paid.invoke"],
            maxCalls: 0,
            maxCostUsd: 0
          }),
          (error) => error.code === "side_effect_capability_episode_mismatch"
        );
        return {
          status: "complete",
          message: "测试 Worker 未取得权限签发 authority"
        };
      }
    }
  });
  assert.equal(result.output.status, "complete");
  assert.equal(workerRuns, 1);
  assert.equal(authorizations, 1);
});

test("真实 runAgent 到 Registry 与 Generator 共用同一操作额度 Capability", async () => {
  let stored = await readFixtureEpisode();
  stored.pipeline.find((item) => item.agent === "script-agent").status = "ready";
  stored.approvals.script = {
    ...stored.approvals.script,
    status: "pending",
    approvedAt: null,
    approvedBy: null
  };
  stored.sourceDocs = stored.sourceDocs.filter(
    (source) => !String(source.path).endsWith("07-script.md")
  );
  stored.production.scriptDraft = null;
  stored.control.reviewEnabled = false;
  stored.approvals.research.artifactHash = currentGateArtifactHash(
    stored,
    "research"
  );
  stored.control.budget = {
    maxCalls: 4,
    maxCostUsd: 1,
    usedCalls: 0,
    usedCostUsd: 0,
    reservedCalls: 0,
    reservedCostUsd: 0,
    overrun: false,
    reservations: []
  };
  const authority = createCapabilityAuthority({
    secret: CAPABILITY_SECRET,
    maximumCalls: 4,
    maximumCostUsd: 1
  });
  const issuedSpecs = [];
  const issuedGrants = [];
  let modelCalls = 0;
  let artifactWrites = 0;
  const result = await runAgent(stored.id, "script-agent", {
    requireSideEffectCapability: true,
    authorizeSideEffect(spec) {
      issuedSpecs.push(structuredClone(spec));
      const grant = authority.authorize(spec);
      issuedGrants.push(grant);
      return grant;
    },
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {},
    aiClient: {
      async generateStructured() {
        modelCalls += 1;
        return {
          provider: "injected-test-provider",
          model: "injected-test-model",
          responseId: "synthetic-response",
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
          attempts: [],
          value: {
            title: "安全 Capability 测试脚本",
            thesis: "每个真实副作用边界都需要独立的一次性授权",
            targetDurationSeconds: 180,
            hook: "一个授权不能被重复使用。",
            sections: Array.from({ length: 6 }, (_, index) => ({
              id: `section-${index + 1}`,
              heading: `章节 ${index + 1}`,
              purpose: "验证授权链路",
              narration: "只使用测试夹具中的合成证据。",
              evidenceRefs: ["fixture-evidence"],
              visualDirection: "本地测试卡片"
            })),
            closing: "所有副作用均已绑定一次性服务端授权。",
            factCheckNotes: []
          }
        };
      }
    },
    writeArtifact: async () => {
      artifactWrites += 1;
      return {
        version: 2,
        path: "/synthetic/script-draft-v002.json",
        relativePath: "studio/tests/fixtures/script-draft-v002.json"
      };
    }
  });
  assert.equal(result.output.status, "waiting_approval");
  assert.equal(modelCalls, 1);
  assert.equal(artifactWrites, 1);
  assert.equal(issuedSpecs.length, 1);
  assert.equal(issuedSpecs[0].scopes.includes("state.write"), true);
  assert.equal(issuedSpecs[0].scopes.includes("model.invoke"), true);
  assert.equal(issuedSpecs[0].scopes.includes("filesystem.write"), true);
  for (let index = 0; index < issuedGrants.length; index += 1) {
    assert.equal(
      assertSideEffectGrant(issuedGrants[index], issuedSpecs[index]),
      issuedGrants[index]
    );
  }
});

test("运行时 Provider 歧义绑定 reservation，且仅在对应人工对账后解除冻结", async () => {
  let stored = await readFixtureEpisode();
  const reservationId = "runtime-ambiguous:attempt:1";
  stored.pipeline.find((item) => item.agent === "script-agent").status = "ready";
  stored.control.budget = {
    maxCalls: 2,
    maxCostUsd: 0.5,
    usedCalls: 0,
    usedCostUsd: 0,
    reservedCalls: 1,
    reservedCostUsd: 0.2,
    overrun: true,
    reservations: [{
      id: reservationId,
      decisionId: "runtime-ambiguous",
      calls: 1,
      costUsd: 0.2,
      costKnown: true,
      reservedAt: "2026-08-24T06:20:00.000Z"
    }]
  };
  stored.history.push({
    at: "2026-08-24T06:20:01.000Z",
    type: "budget-reservation-ambiguous",
    status: "ambiguous",
    failureCode: "provider_call_ambiguous",
    reservationId,
    reservationIds: [reservationId],
    previousOverrun: false
  });
  const store = {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {}
  };
  await assert.rejects(
    runAgent(stored.id, "script-agent", {
      ...store,
      agent: {
        async run() {
          const error = new Error("Provider result unknown");
          error.code = "provider_call_ambiguous";
          error.requiresHuman = true;
          error.details = { reservationId };
          throw error;
        }
      }
    }),
    (error) => error.code === "provider_call_ambiguous"
  );
  const blocked = stored.pipeline.find((item) => item.agent === "script-agent");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.requiresHuman, true);
  assert.equal(blocked.lastError, "provider_call_ambiguous");
  const failure = stored.history.at(-1);
  assert.equal(failure.failureCode, "provider_call_ambiguous");
  assert.deepEqual(failure.reservationIds, [reservationId]);

  const reconciled = await reconcileAmbiguousProviderBudget(stored.id, {
    reservationId,
    usedCalls: 1,
    usedCostUsd: 0.1,
    actor: "human:trusted-operator",
    confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION
  }, store);
  assert.deepEqual(reconciled.reconciliation.unfrozenAgentIds, ["script-agent"]);
  const released = stored.pipeline.find((item) => item.agent === "script-agent");
  assert.equal(released.requiresHuman, false);
  assert.equal(released.lastError, null);
});
