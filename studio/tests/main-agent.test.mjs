import test from "node:test";
import assert from "node:assert/strict";
import { readFixtureEpisode } from "./episode-fixture.mjs";
import { buildMainAgentContext } from "../src/server/control/context-builder.mjs";
import {
  evaluateShadowPlan,
  summarizeShadowEvaluations
} from "../src/server/control/main-agent-evaluator.mjs";
import {
  generateShadowPlan,
  runShadowPlanning
} from "../src/server/control/main-agent.mjs";
import { createEpisodeBudgetLedger } from
  "../src/server/control/budget-ledger.mjs";
import { createCapabilityAuthority } from
  "../src/server/security/side-effect-capability.mjs";
import {
  MAIN_AGENT_PROMPT_VERSION,
  buildMainAgentInstructions
} from "../src/server/control/main-agent-prompt.mjs";
import { runAgent } from "../src/server/orchestrator.mjs";

function validPlan(overrides = {}) {
  return {
    action: "run_worker",
    workerId: "script-agent",
    taskProfile: "creative-structured",
    reason: "研究已批准且脚本步骤可运行",
    acceptanceCriteria: ["生成版本化脚本候选", "通过 script-v2 审核"],
    reviewProfile: "script-v2",
    toolIds: [],
    estimatedCalls: 1,
    estimatedCostUsd: 0,
    limits: { maxAttempts: 1, maxRevisionRounds: 2 },
    fallbackAction: "escalate_to_human",
    ...overrides
  };
}

function completedPlanningRoute(sequence) {
  return {
    id: `route-shadow-bootstrap-${sequence}`,
    profile: "creative-structured",
    reason: "测试本次 shadow planning route 的审计语义",
    candidates: [],
    selected: { providerId: "test-provider", model: "test-model" },
    estimatedCostUsd: 0,
    outcome: {
      status: "succeeded",
      actualCostUsd: 0,
      accountedCostUsd: 0,
      budgetAccounted: true
    }
  };
}

async function shadowEpisode() {
  const episode = await readFixtureEpisode();
  for (const step of episode.pipeline) step.status = "pending";
  episode.pipeline.find((step) => step.agent === "script-agent").status = "ready";
  episode.approvals.research.status = "approved";
  episode.approvals.script.status = "pending";
  return episode;
}

test("Main Agent 上下文只包含裁剪状态，并会清除疑似凭据文本", async () => {
  const episode = await shadowEpisode();
  const script = episode.pipeline.find((step) => step.agent === "script-agent");
  script.status = "failed";
  script.lastError = "Bearer sample123";
  const context = buildMainAgentContext(episode, {
    providerHealth: { primary: { state: "degraded", lastError: "password=sample123" } }
  });
  const serialized = JSON.stringify(context);
  assert.equal(serialized.includes("sample123"), false);
  assert.equal(Object.hasOwn(context.episode, "sourceDocs"), false);
  assert.equal(Object.hasOwn(context, "environment"), false);
  assert.match(context.contextHash, /^[a-f0-9]{64}$/u);
  assert.equal(context.contextVersion, "main-agent-context-v2");
  assert.equal(Number.isInteger(context.estimatedTokens), true);
  assert.ok(context.recentHistory.length <= 8);
});

test("影子对照只使用 Kernel 合法动作，不把缺少人工闸门的 ready 步骤当作基准", async () => {
  const episode = await shadowEpisode();
  for (const step of episode.pipeline) step.status = "pending";
  episode.pipeline.find((step) => step.agent === "storyboard-agent").status = "ready";
  episode.approvals.script.status = "pending";
  const context = buildMainAgentContext(episode);
  assert.deepEqual(context.fixedFallbackAction, { action: "noop" });
  assert.equal(
    context.legalActions.some((action) => action.workerId === "storyboard-agent"),
    false
  );
});

test("Main Agent 将缺少授权旁白识别为等待人工输入，而不是重跑 Worker", async () => {
  const episode = await shadowEpisode();
  for (const step of episode.pipeline) step.status = "complete";
  const voice = episode.pipeline.find((step) => step.agent === "voice-agent");
  voice.status = "blocked";
  voice.requiresHuman = true;
  const context = buildMainAgentContext(episode);
  assert.deepEqual(context.fixedFallbackAction, { action: "wait_for_input", stepId: "voice" });
  assert.equal(
    context.legalActions.some(
      (action) => action.action === "run_worker" && action.workerId === "voice-agent"
    ),
    false
  );
});

test("Main Agent 未启用时 shadow bootstrap 只保存建议且可持续积累影子证据", async () => {
  let stored = await shadowEpisode();
  const pipelineBefore = JSON.stringify(stored.pipeline);
  const events = [];
  let modelPlanningCalls = 0;
  let modelInstructions = null;
  const client = {
    generateStructured: async (_taskId, request) => {
      modelPlanningCalls += 1;
      modelInstructions = request.instructions;
      assert.equal(request.routingContext.persistBudget, true);
      return {
        value: validPlan(),
        routingDecision: completedPlanningRoute(modelPlanningCalls),
        attempts: [{ status: "succeeded" }]
      };
    }
  };
  const result = await runShadowPlanning(stored.id, {
    client,
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = JSON.parse(JSON.stringify(episode));
    },
    appendEvent: async (event) => events.push(structuredClone(event)),
    now: new Date("2026-08-06T02:00:00.000Z")
  });
  assert.equal(result.record.status, "proposed");
  assert.equal(result.record.evaluation.matchesFixedFallback, true);
  assert.equal(result.record.bootstrap, true);
  assert.equal(result.record.planningOnly, true);
  assert.equal(result.record.routingUsed, true);
  assert.equal(stored.control.planVersion, 1);
  assert.equal(stored.planHistory.length, 1);
  assert.equal(JSON.stringify(stored.pipeline), pipelineBefore);
  assert.equal(stored.control.mainAgentEnabled, false);
  assert.equal(stored.control.modelRouterEnabled, false);
  assert.equal(stored.control.fixedFallbackEnabled, true);
  assert.equal(stored.control.pendingDispatch, null);
  assert.equal(MAIN_AGENT_PROMPT_VERSION, "main-agent-planner-prompt-v1");
  assert.equal(modelInstructions, buildMainAgentInstructions("shadow"));
  assert.equal(
    events.at(-1).message,
    "shadow bootstrap 计划已记录；Model Router 仅用于本次受预算约束的规划选路，Main Agent 控制开关保持关闭，未派发 Worker"
  );
  assert.equal(events.at(-1).routingUsed, true);

  await runShadowPlanning(stored.id, {
    client,
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = JSON.parse(JSON.stringify(episode));
    },
    appendEvent: async (event) => events.push(structuredClone(event)),
    now: new Date("2026-08-06T02:00:01.000Z")
  });
  assert.equal(modelPlanningCalls, 2);
  assert.equal(stored.planHistory.length, 2);
  assert.equal(stored.control.mainAgentEnabled, false);
  assert.equal(stored.control.modelRouterEnabled, false);
  assert.equal(stored.control.pendingDispatch, null);
  assert.equal(JSON.stringify(stored.pipeline), pipelineBefore);
  assert.equal(stored.routingHistory.length, 2);
});

test("shadow bootstrap 通过真实 AI client 依赖路径完成只规划且保持控制开关关闭", async () => {
  let stored = await shadowEpisode();
  stored.control.budget.maxCalls = 4;
  stored.control.budget.maxCostUsd = 4;
  let providerCalls = 0;
  const budgetLedger = createEpisodeBudgetLedger({
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    }
  });
  const capabilityAuthority = createCapabilityAuthority({
    secret: "main-agent-shadow-bootstrap-test-secret-at-least-32-bytes",
    maximumCalls: 4,
    maximumCostUsd: 4
  });
  const router = {
    route: () => ({
      id: "route-shadow-bootstrap-real-client",
      at: "2026-08-31T01:00:00.000Z",
      taskId: "main-agent",
      profile: "planner",
      reason: "覆盖正式 AI client、预算、Capability 与 Provider 边界",
      candidates: [],
      selected: { providerId: "test-provider", model: "test-model" },
      orderedRoutes: [{
        providerId: "test-provider",
        model: "test-model",
        reservationCostUsd: 0.1
      }],
      estimatedCostUsd: 0.1,
      pricingVersion: "test-pricing-v1",
      reservation: { calls: 1, costUsd: 0.1, safetyFactor: 1 },
      locked: false
    }),
    costForUsage: () => 0.1
  };
  process.env.STUDIO_MAIN_AGENT_BOOTSTRAP_TEST_KEY = "test-only-placeholder";
  try {
    const result = await runShadowPlanning(stored.id, {
      readEpisode: async () => structuredClone(stored),
      writeEpisode: async (episode) => {
        stored = structuredClone(episode);
      },
      appendEvent: async () => {},
      authorizeSideEffect: (spec) => capabilityAuthority.authorize(spec),
      aiClientOptions: {
        config: {
          primaryProvider: "test-provider",
          fallbackProviders: [],
          request: {
            timeoutMs: 1000,
            primaryAttempts: 1,
            fallbackAttempts: 0,
            retryBackoffMs: [0],
            maxOutputTokens: 1200
          },
          tasks: {
            "main-agent": {
              model: "test-model",
              reasoningEffort: "low",
              verbosity: "low",
              profile: "planner"
            }
          },
          providers: {
            "test-provider": {
              label: "Test Provider",
              baseUrl: "https://provider.invalid/v1",
              apiKeyEnv: "STUDIO_MAIN_AGENT_BOOTSTRAP_TEST_KEY",
              enabled: true
            }
          }
        },
        router,
        budgetLedger,
        providerHealth: { "test-provider": { state: "healthy" } },
        proxyUrl: null,
        fetchImpl: async () => {
          providerCalls += 1;
          return new Response(JSON.stringify({
            id: "response-shadow-bootstrap",
            output_text: JSON.stringify(validPlan()),
            usage: { input_tokens: 20, output_tokens: 10 }
          }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
      },
      now: new Date("2026-08-31T01:00:00.000Z")
    });

    assert.equal(providerCalls, 1);
    assert.equal(result.record.bootstrap, true);
    assert.equal(result.record.planningOnly, true);
    assert.equal(result.record.routingUsed, true);
    assert.equal(stored.control.mainAgentEnabled, false);
    assert.equal(stored.control.modelRouterEnabled, false);
    assert.equal(stored.control.pendingDispatch, null);
    assert.equal(stored.pipeline.some((step) => step.status === "running"), false);
    assert.equal(stored.control.budget.usedCalls, 1);
    assert.equal(stored.control.budget.usedCostUsd, 0.1);
  } finally {
    delete process.env.STUDIO_MAIN_AGENT_BOOTSTRAP_TEST_KEY;
  }
});

test("注入 planner 的 shadow bootstrap 明确记录未使用 Model Router", async () => {
  let stored = await shadowEpisode();
  const events = [];
  const result = await runShadowPlanning(stored.id, {
    planner: async () => validPlan(),
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async (event) => events.push(structuredClone(event)),
    now: new Date("2026-08-06T02:00:02.000Z")
  });
  assert.equal(result.record.bootstrap, true);
  assert.equal(result.record.planningOnly, true);
  assert.equal(result.record.routingUsed, false);
  assert.equal(events.at(-1).routingUsed, false);
  assert.equal(
    events.at(-1).message,
    "shadow bootstrap 计划已记录；本次使用注入 planner 且未使用 Model Router，Main Agent 控制开关保持关闭，未派发 Worker"
  );
  assert.equal(stored.routingHistory.length, 0);
  assert.equal(stored.control.mainAgentEnabled, false);
  assert.equal(stored.control.modelRouterEnabled, false);
  assert.equal(stored.control.pendingDispatch, null);
});

test("shadow bootstrap 在非 shadow、关闭固定回退或存在待派发动作时失败关闭", async () => {
  const assisted = await shadowEpisode();
  assisted.control.mode = "assisted";
  await assert.rejects(
    generateShadowPlan(assisted, { planner: async () => validPlan() }),
    (error) => error.code === "main_agent_bootstrap_not_allowed"
  );

  const noFallback = await shadowEpisode();
  noFallback.control.fixedFallbackEnabled = false;
  await assert.rejects(
    generateShadowPlan(noFallback, { planner: async () => validPlan() }),
    (error) => error.code === "main_agent_bootstrap_not_allowed"
  );

  const pending = await shadowEpisode();
  pending.control.pendingDispatch = { id: "pending-bootstrap-test" };
  await assert.rejects(
    generateShadowPlan(pending, { planner: async () => validPlan() }),
    (error) => error.code === "main_agent_bootstrap_not_allowed"
  );
});

test("未对账 Provider 调用会在写入新计划或发起模型请求前冻结 shadow 重试", async () => {
  let stored = await shadowEpisode();
  stored.control.budget.reservations = [{
    id: "route-shadow-ambiguous:attempt:1",
    decisionId: "route-shadow-ambiguous",
    calls: 1,
    costUsd: 0.2,
    costKnown: true,
    reservedAt: "2026-08-06T02:00:00.000Z"
  }];
  stored.control.budget.reservedCalls = 1;
  stored.control.budget.reservedCostUsd = 0.2;
  stored.control.budget.overrun = true;
  stored.history.push({
    at: "2026-08-06T02:00:01.000Z",
    type: "budget-reservation-ambiguous",
    status: "ambiguous",
    reservationIds: ["route-shadow-ambiguous:attempt:1"]
  });
  let modelPlanningCalls = 0;
  await assert.rejects(
    runShadowPlanning(stored.id, {
      client: {
        generateStructured: async () => {
          modelPlanningCalls += 1;
          return { value: validPlan(), routingDecision: null, attempts: [] };
        }
      },
      readEpisode: async () => structuredClone(stored),
      writeEpisode: async (episode) => {
        stored = structuredClone(episode);
      },
      appendEvent: async () => {}
    }),
    (error) => error.code === "budget_reconciliation_required" && error.requiresHuman
  );
  assert.equal(modelPlanningCalls, 0);
  assert.equal(stored.control.planVersion, 0);
  assert.equal(stored.control.currentPlan, null);
  assert.equal(stored.control.activeOperation, null);
  assert.equal(stored.control.budget.reservedCalls, 1);
});

test("Provider 成功结算后计划落盘失败会冻结 Main Agent，禁止再次付费规划", async () => {
  let stored = await shadowEpisode();
  let failCompletedPlanWrite = true;
  let modelPlanningCalls = 0;
  const now = new Date("2026-08-06T02:00:10.000Z");
  const dependencies = {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      if (
        failCompletedPlanWrite &&
        episode.control?.currentPlan?.status === "proposed"
      ) {
        failCompletedPlanWrite = false;
        const error = new Error("模拟计划最终写入失败");
        error.code = "fixture_plan_write_failed";
        throw error;
      }
      stored = structuredClone(episode);
    },
    appendEvent: async () => {},
    now
  };
  await assert.rejects(
    runShadowPlanning(stored.id, {
      ...dependencies,
      client: {
        generateStructured: async () => {
          modelPlanningCalls += 1;
          stored.history.push({
            at: now.toISOString(),
            type: "budget-reservation-settled",
            status: "settled",
            settlementStatus: "completed_success",
            reservationId: "route-shadow-commit-window:attempt:1"
          });
          return {
            value: validPlan(),
            routingDecision: completedPlanningRoute(modelPlanningCalls),
            attempts: [{ status: "succeeded" }]
          };
        }
      }
    }),
    (error) => error.code === "provider_result_commit_unknown" &&
      error.requiresHuman === true
  );
  assert.equal(modelPlanningCalls, 1);
  assert.equal(stored.control.currentPlan.status, "failed");
  assert.equal(
    stored.control.currentPlan.errorCode,
    "provider_result_commit_unknown"
  );
  assert.deepEqual(
    stored.control.currentPlan.uncommittedProviderResultIds,
    ["route-shadow-commit-window:attempt:1"]
  );
  assert.equal(stored.control.budget.overrun, true);
  assert.equal(stored.control.activeOperation, null);
  assert.equal(
    stored.history.some((entry) => (
      entry.type === "provider-result-commit-unknown" &&
      entry.status === "blocked"
    )),
    true
  );

  await assert.rejects(
    runShadowPlanning(stored.id, {
      ...dependencies,
      planner: async () => {
        modelPlanningCalls += 1;
        return validPlan();
      }
    }),
    (error) => error.code === "cost_budget_overrun" && error.requiresHuman === true
  );
  assert.equal(modelPlanningCalls, 1);
});

test("规划期间的新停止请求不会被旧 Episode 覆盖，计划会按最新状态重新校验", async () => {
  let stored = await shadowEpisode();
  const result = await runShadowPlanning(stored.id, {
    planner: async () => {
      stored.control.stopRequested = true;
      return validPlan();
    },
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {},
    now: new Date("2026-08-06T02:00:30.000Z")
  });
  assert.equal(stored.control.stopRequested, true);
  assert.equal(result.record.status, "rejected");
  assert.ok(result.record.validation.errors.includes("episode has a stop request"));
});

test("同一期 Main Agent 规划互斥，避免两个计划互相覆盖", async () => {
  let stored = await shadowEpisode();
  let releasePlanner;
  let markStarted;
  const started = new Promise((resolveStarted) => {
    markStarted = resolveStarted;
  });
  const release = new Promise((resolveRelease) => {
    releasePlanner = resolveRelease;
  });
  const dependencies = {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {}
  };
  const first = runShadowPlanning(stored.id, {
    ...dependencies,
    planner: async () => {
      markStarted();
      await release;
      return validPlan();
    }
  });
  await started;
  await assert.rejects(
    runShadowPlanning(stored.id, {
      ...dependencies,
      planner: async () => validPlan()
    }),
    /已有 Main Agent 正在规划/u
  );
  await assert.rejects(
    runAgent(stored.id, "script-agent", {
      ...dependencies,
      agent: { run: async () => ({ status: "complete", message: "should not run" }) }
    }),
    /已有 Agent 正在运行/u
  );
  releasePlanner();
  const result = await first;
  assert.equal(result.record.status, "proposed");
  assert.equal(stored.planHistory.length, 1);
});

test("另一个进程留下的持久化操作锁会同时阻止 Main Agent 和 Worker", async () => {
  let stored = await shadowEpisode();
  stored.control.activeOperation = {
    id: "operation:other-process",
    kind: "worker:storyboard-agent",
    startedAt: "2026-08-06T02:00:00.000Z"
  };
  let plannerCalled = false;
  const dependencies = {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async () => {}
  };
  await assert.rejects(
    runShadowPlanning(stored.id, {
      ...dependencies,
      planner: async () => {
        plannerCalled = true;
        return validPlan();
      }
    }),
    /已有持久化 Agent 操作/u
  );
  await assert.rejects(
    runAgent(stored.id, "script-agent", {
      ...dependencies,
      agent: { run: async () => ({ status: "complete", message: "should not run" }) }
    }),
    /已有持久化 Agent 操作/u
  );
  assert.equal(plannerCalled, false);
  assert.equal(stored.control.activeOperation.id, "operation:other-process");
});

test("越权影子计划会记录为 rejected，不能指定模型或状态补丁", async () => {
  let stored = await shadowEpisode();
  const pipelineBefore = JSON.stringify(stored.pipeline);
  const result = await runShadowPlanning(stored.id, {
    planner: async () => validPlan({ model: "arbitrary-model", statePatch: { status: "approved" } }),
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = JSON.parse(JSON.stringify(episode));
    },
    appendEvent: async () => {},
    now: new Date("2026-08-06T02:01:00.000Z")
  });
  assert.equal(result.record.status, "rejected");
  assert.ok(result.record.validation.errors.includes("main plan cannot set model"));
  assert.ok(result.record.validation.errors.includes("main plan cannot set statePatch"));
  assert.equal(JSON.stringify(stored.pipeline), pipelineBefore);
});

test("影子评测记录错误下一步、重复运行、预算误差与忽略人工意见", async () => {
  const episode = await shadowEpisode();
  episode.approvals.script.feedback = "按意见重写脚本开头";
  const context = buildMainAgentContext(episode);
  const wrongPlan = validPlan({ workerId: "storyboard-agent", estimatedCalls: 4, estimatedCostUsd: 1 });
  const evaluation = evaluateShadowPlan(
    context,
    wrongPlan,
    { valid: false, errors: ["worker is not currently legal: storyboard-agent"] },
    {
      previousPlans: [{ plan: wrongPlan }],
      actualCalls: 1,
      actualCostUsd: 0.2
    }
  );
  assert.equal(evaluation.wrongNextStep, true);
  assert.equal(evaluation.duplicateRun, true);
  assert.equal(evaluation.budgetCallError, 3);
  assert.equal(evaluation.budgetCostErrorUsd, 0.8);
  assert.equal(evaluation.ignoredHumanFeedback, true);
});

test("黄金、拒绝和边界样例必须共同达到影子退出门槛", async () => {
  const golden = await shadowEpisode();
  const rejected = await shadowEpisode();
  rejected.approvals.script.feedback = "按人工意见重写脚本";
  const stopped = await shadowEpisode();
  stopped.control.stopRequested = true;
  const results = await Promise.all([
    generateShadowPlan(golden, { planner: async () => validPlan() }),
    generateShadowPlan(rejected, { planner: async () => validPlan() }),
    generateShadowPlan(stopped, {
      planner: async () => validPlan({
        action: "stop",
        workerId: null,
        taskProfile: null,
        estimatedCalls: 0,
        limits: { maxAttempts: 1, maxRevisionRounds: 0 },
        fallbackAction: "stop"
      })
    })
  ]);
  const records = results.map((result) => ({ evaluation: result.evaluation }));
  assert.equal(summarizeShadowEvaluations(records).passed, true);
  records[2].evaluation.policyValid = false;
  assert.equal(summarizeShadowEvaluations(records).passed, false);
});
