import test from "node:test";
import assert from "node:assert/strict";
import { readEpisode } from "../src/shared/store.mjs";
import {
  reconcileEpisodeArtifacts,
  recoverInterruptedEpisode
} from "../src/server/orchestrator.mjs";

test("进程中断后的 running 步骤会恢复为可重试失败状态", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  const voice = episode.pipeline.find((step) => step.agent === "voice-agent");
  voice.status = "running";
  voice.progress = 0.45;
  episode.reviews.assets = {
    ...episode.reviews.assets,
    status: "checking",
    artifactVersion: 1
  };
  episode.control.planVersion = 1;
  episode.control.currentPlan = {
    id: "plan-golden-001-v1",
    version: 1,
    mode: "shadow",
    status: "planning",
    startedAt: "2026-08-03T23:59:00.000Z"
  };
  episode.control.pendingDispatch = {
    id: "dispatch-plan-golden-001-v1",
    planId: "plan-golden-001-v1",
    planVersion: 1,
    plan: { action: "run_worker", workerId: "voice-agent" },
    status: "executing",
    createdAt: "2026-08-03T23:59:10.000Z",
    confirmedAt: "2026-08-03T23:59:20.000Z"
  };
  episode.control.activeOperation = {
    id: "operation:worker:golden-001:voice-agent:test",
    kind: "worker:voice-agent",
    startedAt: "2026-08-03T23:59:00.000Z"
  };
  episode.control.budget.reservedCalls = 1;
  episode.control.budget.reservedCostUsd = 0.25;
  episode.control.budget.reservations = [{
    id: "route-recovery:attempt:1",
    decisionId: "route-recovery",
    calls: 1,
    costUsd: 0.25,
    costKnown: true,
    reservedAt: "2026-08-03T23:59:30.000Z"
  }];
  const at = new Date("2026-08-04T00:00:00.000Z");
  const result = recoverInterruptedEpisode(episode, at);
  const recovered = result.episode.pipeline.find((step) => step.agent === "voice-agent");
  assert.deepEqual(result.recoveredAgents, ["voice-agent"]);
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.progress, 0);
  assert.equal(recovered.lastError, "process_interrupted");
  assert.equal(result.episode.history.at(-1).type, "agent-recovered");
  assert.deepEqual(result.recoveredReviewStages, ["assets"]);
  assert.equal(result.episode.reviews.assets.status, "not_started");
  assert.equal(result.episode.reviews.assets.artifactVersion, 1);
  assert.equal(result.recoveredPlan, true);
  assert.equal(result.episode.control.currentPlan.status, "failed");
  assert.equal(result.episode.planHistory.at(-1).errorCode, "process_interrupted");
  assert.equal(result.recoveredDispatch, true);
  assert.equal(result.episode.control.pendingDispatch, null);
  assert.equal(result.episode.dispatchHistory.at(-1).reasonCode, "process_interrupted");
  assert.deepEqual(result.recoveredBudgetReservations, ["route-recovery:attempt:1"]);
  assert.equal(result.recoveredOperation.kind, "worker:voice-agent");
  assert.equal(result.episode.control.activeOperation, null);
  assert.equal(result.episode.control.budget.reservedCalls, 0);
  assert.equal(result.episode.control.budget.reservedCostUsd, 0);
  assert.deepEqual(result.episode.control.budget.reservations, []);
});

test("状态登记为完成但成片缺失时会撤销旧 QA", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  episode.render.status = "complete";
  episode.render.outputPath = "outputs/studio/golden-001/missing-preview.mp4";
  episode.qa.status = "passed";
  episode.pipeline.find((step) => step.agent === "render-agent").status = "complete";
  episode.pipeline.find((step) => step.agent === "qa-agent").status = "complete";
  const result = await reconcileEpisodeArtifacts(episode, {
    now: new Date("2026-08-04T00:00:00.000Z"),
    access: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
  });
  assert.equal(result.changed, true);
  assert.equal(result.episode.render.status, "missing");
  assert.equal(result.episode.qa.status, "stale");
  assert.equal(
    result.episode.pipeline.find((step) => step.agent === "render-agent").status,
    "failed"
  );
  assert.equal(
    result.episode.pipeline.find((step) => step.agent === "qa-agent").status,
    "blocked"
  );
});

test("恢复检查发现同路径成片被替换时会撤销旧 QA、机器审核和人工终审", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  episode.status = "approved";
  episode.render = {
    ...episode.render,
    version: 1,
    status: "complete",
    outputPath: "outputs/studio/golden-001/preview-v001.mp4",
    bytes: 60_001,
    sha256: "a".repeat(64)
  };
  episode.qa.status = "passed";
  episode.approvals.final.status = "approved";
  episode.approvals.final.currentVersion = 1;
  episode.reviews.final.status = "passed";
  episode.pipeline.find((step) => step.agent === "render-agent").status = "complete";
  episode.pipeline.find((step) => step.agent === "qa-agent").status = "complete";
  const result = await reconcileEpisodeArtifacts(episode, {
    now: new Date("2026-08-04T00:00:00.000Z"),
    access: async () => undefined,
    inspectFileIntegrity: async () => ({ bytes: 60_001, sha256: "b".repeat(64) })
  });
  assert.equal(result.changed, true);
  assert.equal(result.missingRender, false);
  assert.equal(result.invalidRenderIntegrity, true);
  assert.equal(result.episode.render.status, "invalid");
  assert.equal(result.episode.qa.status, "stale");
  assert.equal(result.episode.approvals.final.status, "pending");
  assert.equal(result.episode.reviews.final.status, "not_started");
  assert.equal(result.episode.status, "in_production");
});
