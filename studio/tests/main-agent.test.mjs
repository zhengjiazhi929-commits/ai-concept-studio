import test from "node:test";
import assert from "node:assert/strict";
import { readEpisode } from "../src/shared/store.mjs";
import { buildMainAgentContext } from "../src/server/control/context-builder.mjs";
import {
  evaluateShadowPlan,
  summarizeShadowEvaluations
} from "../src/server/control/main-agent-evaluator.mjs";
import {
  generateShadowPlan,
  runShadowPlanning
} from "../src/server/control/main-agent.mjs";
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

async function shadowEpisode() {
  const episode = await readEpisode("golden-001");
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

test("影子模式保存合法建议但不改变流水线状态", async () => {
  let stored = await shadowEpisode();
  const pipelineBefore = JSON.stringify(stored.pipeline);
  const events = [];
  const result = await runShadowPlanning(stored.id, {
    planner: async (context) => {
      assert.equal(context.fixedFallbackAction.workerId, "script-agent");
      return validPlan();
    },
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = JSON.parse(JSON.stringify(episode));
    },
    appendEvent: async (event) => events.push(structuredClone(event)),
    now: new Date("2026-08-06T02:00:00.000Z")
  });
  assert.equal(result.record.status, "proposed");
  assert.equal(result.record.evaluation.matchesFixedFallback, true);
  assert.equal(stored.control.planVersion, 1);
  assert.equal(stored.planHistory.length, 1);
  assert.equal(JSON.stringify(stored.pipeline), pipelineBefore);
  assert.equal(events.at(-1).message, "shadow 计划已记录，尚未执行");
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
