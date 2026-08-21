import test from "node:test";
import assert from "node:assert/strict";
import { APPROVAL_GATES } from "../src/shared/schema.mjs";
import {
  currentGateArtifactHash,
  currentGateVersion,
  nextAssetBundleRevision,
  applyApprovalDecision,
  createApprovalMap,
  latestReviewFeedback,
  resetApprovalForVersion
} from "../src/shared/workflow.mjs";
import { readEpisode } from "../src/shared/store.mjs";

test("生产流程只有五个人工审批闸门", () => {
  assert.deepEqual(
    APPROVAL_GATES.map((gate) => gate.id),
    ["research", "script", "storyboard", "assets", "final"]
  );
  assert.deepEqual(Object.keys(createApprovalMap()), [
    "research",
    "script",
    "storyboard",
    "assets",
    "final"
  ]);
});

test("驳回脚本保留旧版本和意见，并只从脚本阶段重新开始", async () => {
  const source = await readEpisode("golden-001");
  source.production.scriptDraft = {
    ...(source.production.scriptDraft ?? {}),
    version: 3,
    versions: [
      { version: 1, artifactPath: "one.json" },
      { version: 2, artifactPath: "two.json" },
      { version: 3, artifactPath: "three.json" }
    ]
  };
  source.approvals.script.currentVersion = 3;
  source.reviews.script = {
    ...source.reviews.script,
    status: "passed",
    artifactVersion: 3,
    revisionRounds: 2
  };
  source.reviews.storyboard = {
    ...source.reviews.storyboard,
    status: "passed",
    artifactVersion: 1
  };

  const { episode, record } = applyApprovalDecision(source, {
    gate: "script",
    decision: "rejected",
    note: "开头太慢，先给出核心冲突",
    now: new Date("2026-08-05T08:00:00.000Z")
  });

  assert.equal(record.version, 3);
  assert.equal(episode.approvals.script.status, "rejected");
  assert.equal(episode.approvals.script.feedback, "开头太慢，先给出核心冲突");
  assert.equal(episode.approvals.script.history.length, 1);
  assert.equal(episode.production.scriptDraft.versions.length, 3);
  assert.equal(episode.production.scriptDraft.needsRevision, true);
  assert.equal(episode.pipeline.find((step) => step.id === "research").status, "complete");
  assert.equal(episode.pipeline.find((step) => step.id === "script").status, "ready");
  assert.equal(episode.pipeline.find((step) => step.id === "storyboard").status, "pending");
  assert.equal(episode.approvals.storyboard.status, "pending");
  assert.equal(episode.approvals.final.status, "pending");
  assert.equal(episode.reviews.script.status, "not_started");
  assert.equal(episode.reviews.script.artifactVersion, null);
  assert.equal(episode.reviews.script.revisionRounds, 0);
  assert.equal(episode.reviews.storyboard.status, "not_started");
});

test("新版本重置审批状态但不会删除历史决策", () => {
  const approval = {
    status: "rejected",
    at: "2026-08-05T08:00:00.000Z",
    note: "",
    feedback: "重写结尾",
    currentVersion: 2,
    history: [
      {
        at: "2026-08-05T08:00:00.000Z",
        gate: "script",
        decision: "rejected",
        note: "重写结尾",
        version: 2
      }
    ]
  };
  const next = resetApprovalForVersion(approval, 3);
  assert.equal(next.status, "pending");
  assert.equal(next.currentVersion, 3);
  assert.equal(next.feedback, "");
  assert.equal(next.history.length, 1);
});

test("产出 Agent 可以在重启后继续读取机器审核问题", () => {
  const issue = {
    code: "FACT_GAP",
    evidence: "第二节缺少一手来源",
    location: "script.sections[1]",
    suggestedFix: "补充来源或删除该主张"
  };
  const episode = {
    production: { feedback: {} },
    approvalHistory: [],
    reviews: {
      script: {
        latestReportId: "review-script-v2",
        reports: [{ id: "review-script-v2", blockingIssues: [issue] }]
      }
    }
  };
  assert.deepEqual(latestReviewFeedback(episode, "script"), [issue]);
});

test("素材 Bundle 修订号独立递增，不会因素材与旁白子版本相同而碰撞", () => {
  const episode = {
    production: {
      assetBundleRevision: 7,
      assetPlan: { version: 7 },
      voicePlan: { version: 6 },
      materialsVersion: 7
    },
    voice: { version: 7 }
  };
  assert.equal(currentGateVersion(episode, "assets"), 7);
  episode.production.assetBundleRevision = nextAssetBundleRevision(episode);
  assert.equal(currentGateVersion(episode, "assets"), 8);
  episode.production.assetBundleRevision = nextAssetBundleRevision(episode);
  assert.equal(currentGateVersion(episode, "assets"), 9);
});

test("下游素材绑定不会篡改已批准分镜的内容哈希", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  const before = currentGateArtifactHash(episode, "storyboard");
  episode.scenes[0].asset = "episodes/golden-001/materials/new.png";
  episode.scenes[0].audio = "episodes/golden-001/new.wav";
  assert.equal(currentGateArtifactHash(episode, "storyboard"), before);
});

test("最终成片批准后整期进入 approved 状态", async () => {
  const source = await readEpisode("golden-001");
  source.qa.status = "passed";
  const qaStep = source.pipeline.find((step) => step.id === "qa");
  qaStep.status = "waiting_approval";
  qaStep.requiresApproval = "final";
  const { episode } = applyApprovalDecision(source, {
    gate: "final",
    decision: "approved",
    note: "成片通过",
    now: new Date("2026-08-05T09:00:00.000Z")
  });
  assert.equal(episode.approvals.final.status, "approved");
  assert.equal(episode.status, "approved");
  assert.equal(episode.pipeline.find((step) => step.id === "qa").status, "complete");
  assert.equal(episode.approvalHistory.at(-1).decision, "approved");
});
