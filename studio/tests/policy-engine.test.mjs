import test from "node:test";
import assert from "node:assert/strict";
import { readEpisode } from "../src/shared/store.mjs";
import {
  approvalValidForGate,
  legalWorkerActions,
  reviewPassedForGate,
  validatePlanAgainstPolicy
} from "../src/server/control/policy-engine.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";
import { kernelSnapshot } from "../src/server/control/workflow-kernel.mjs";

function plan(overrides = {}) {
  return {
    action: "run_worker",
    workerId: "script-agent",
    taskProfile: "creative-structured",
    reason: "研究已经批准，可以生成脚本候选",
    acceptanceCriteria: ["结构化脚本"],
    estimatedCalls: 1,
    estimatedCostUsd: 0.1,
    toolIds: [],
    ...overrides
  };
}

test("Policy 只暴露当前可运行 Worker，不重复调度已完成步骤", async () => {
  const episode = await readEpisode("golden-001");
  for (const step of episode.pipeline) step.status = "complete";
  episode.pipeline.find((step) => step.agent === "script-agent").status = "ready";
  assert.deepEqual(legalWorkerActions(episode).map((item) => item.workerId), ["script-agent"]);
});

test("Policy 同时执行调用、费用和工具权限边界", async () => {
  const episode = await readEpisode("golden-001");
  episode.pipeline.find((step) => step.agent === "script-agent").status = "ready";
  episode.control.allowedTools = ["artifact.read"];
  episode.control.budget = {
    maxCalls: 2,
    usedCalls: 1,
    maxCostUsd: 0.2,
    usedCostUsd: 0.15
  };
  const result = validatePlanAgainstPolicy(
    episode,
    plan({ estimatedCalls: 2, estimatedCostUsd: 0.1, toolIds: ["episode.write"] })
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("episode model-call budget is exhausted"));
  assert.ok(result.errors.includes("episode cost budget is exhausted"));
  assert.ok(result.errors.includes("tool is not allowed: episode.write"));
});

test("停止请求和不存在的人工审批都会被拒绝", async () => {
  const episode = await readEpisode("golden-001");
  episode.control.stopRequested = true;
  assert.equal(validatePlanAgainstPolicy(episode, plan()).valid, false);
  episode.control.stopRequested = false;
  for (const step of episode.pipeline) step.status = "complete";
  const waiting = validatePlanAgainstPolicy(
    episode,
    plan({ action: "wait_for_approval", workerId: undefined, estimatedCalls: 0 })
  );
  assert.equal(waiting.valid, false);
  assert.ok(waiting.errors.includes("no human approval is currently pending"));
});

test("人工批准只接受与当前审批版本严格绑定的通过报告", async () => {
  const episode = await readEpisode("golden-001");
  episode.id = "review-binding-case";
  episode.system.trustedFixture = false;
  const artifactVersion = episode.production.scriptDraft.version;
  const artifactHash = currentGateArtifactHash(episode, "script");
  episode.approvals.script = {
    ...episode.approvals.script,
    status: "approved",
    currentVersion: artifactVersion,
    provenance: "reviewed-v2",
    reviewReportId: "review-script-1",
    artifactHash
  };
  episode.reviews.script = {
    ...episode.reviews.script,
    status: "passed",
    artifactVersion,
    artifactHash,
    latestReportId: "review-script-1",
    reports: [{
      id: "review-script-1",
      decision: "pass",
      artifactVersion,
      artifactHash
    }]
  };
  assert.equal(reviewPassedForGate(episode, "script"), true);
  assert.equal(approvalValidForGate(episode, "script"), true);

  episode.production.scriptDraft.content = { changedWithoutVersionBump: true };
  assert.equal(reviewPassedForGate(episode, "script"), false);
  assert.equal(approvalValidForGate(episode, "script"), false);
});

test("旧式 approved 状态没有审核证据时不能解锁下游 Worker", async () => {
  const episode = await readEpisode("golden-001");
  episode.id = "legacy-approval-case";
  episode.system.trustedFixture = false;
  for (const step of episode.pipeline) step.status = "pending";
  episode.pipeline.find((step) => step.agent === "script-agent").status = "ready";
  episode.approvals.research = {
    ...episode.approvals.research,
    status: "approved",
    provenance: "legacy-approval",
    reviewReportId: null,
    artifactHash: null
  };
  assert.equal(approvalValidForGate(episode, "research"), false);
  assert.equal(
    kernelSnapshot(episode).legalActions.some(
      (action) => action.workerId === "script-agent"
    ),
    false
  );
});
