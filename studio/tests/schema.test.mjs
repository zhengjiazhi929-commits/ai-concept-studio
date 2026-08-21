import test from "node:test";
import assert from "node:assert/strict";
import { PIPELINE_DEFINITIONS, summarizePipeline, validateEpisode } from "../src/shared/schema.mjs";
import { readEpisode } from "../src/shared/store.mjs";

test("黄金样例符合系统数据契约", async () => {
  const episode = await readEpisode("golden-001");
  const validation = validateEpisode(episode);

  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.deepEqual(
    episode.pipeline.map((step) => step.id),
    PIPELINE_DEFINITIONS.map((step) => step.id)
  );
  assert.equal(episode.scenes.at(-1).end, episode.render.durationSeconds);
  assert.equal(episode.assets.every((asset) => asset.verified), true);
});

test("流水线摘要反映真实完成比例", async () => {
  const episode = await readEpisode("golden-001");
  const summary = summarizePipeline(episode.pipeline);

  assert.equal(summary.total, 8);
  assert.equal(summary.complete, 5);
  assert.equal(summary.percent, 63);
});

test("数据契约拒绝五道闸门之外的旧审批字段", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  episode.approvals.facts = { status: "approved", history: [] };
  const validation = validateEpisode(episode);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("unexpected approval gate: facts"));
});

test("视觉样片审核检查点独立于五道生产闸门并绑定机器与人工证据", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  const candidateHash = "a".repeat(64);
  const evidence = (path) => ({ path, bytes: 60_001, sha256: "b".repeat(64) });
  episode.reviewCheckpoints = {
    visualProof: {
      schemaVersion: 1,
      status: "approved",
      currentCandidate: {
        episodeId: episode.id,
        version: 14,
        sourceRenderVersion: 15,
        candidateHash,
        manifest: evidence("outputs/studio/golden-001/visual-proof-v014-manifest.json"),
        video: evidence("outputs/studio/golden-001/visual-proof-v014.mp4"),
        qa: { ...evidence("design-qa.md"), result: "passed" },
        comparison: evidence("outputs/studio/golden-001/visual-proof-v014-comparison.png")
      },
      machineReview: {
        id: "visual-proof-review-v014-test",
        status: "passed",
        checkedAt: "2026-08-13T00:00:00.000Z",
        candidateHash,
        checks: []
      },
      humanApproval: {
        decision: "approved",
        at: "2026-08-13T00:01:00.000Z",
        note: "approved",
        version: 14,
        candidateHash,
        machineReviewId: "visual-proof-review-v014-test"
      },
      history: []
    }
  };
  const validation = validateEpisode(episode);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.deepEqual(Object.keys(episode.approvals), [
    "research",
    "script",
    "storyboard",
    "assets",
    "final"
  ]);
  episode.reviewCheckpoints.fakeApproval = {};
  const invalid = validateEpisode(episode);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes("unexpected review checkpoint: fakeApproval"));
});

test("素材执行检查点独立于五道 Gate，并严格绑定候选、机器审核和人工决定", async () => {
  const episode = structuredClone(await readEpisode("golden-001"));
  const candidateHash = "c".repeat(64);
  episode.reviewCheckpoints.assetExecution = {
    schemaVersion: 1,
    status: "approved",
    currentCandidate: {
      episodeId: episode.id,
      version: 1,
      candidateHash,
      planHash: "d".repeat(64),
      artifact: {
        path: "studio/data/production/episodes/golden-001/asset-plan-v001.json",
        bytes: 100,
        sha256: "e".repeat(64)
      },
      sourceStoryboard: null,
      summary: { maximumPaidCostUsd: 0, externalApiCallCount: 0 }
    },
    machineReview: {
      id: "asset-execution-review-v001-test",
      status: "passed",
      checkedAt: "2026-08-13T09:00:00.000Z",
      candidateHash,
      checks: []
    },
    humanApproval: {
      decision: "approved",
      at: "2026-08-13T09:01:00.000Z",
      note: "local only",
      version: 1,
      candidateHash,
      machineReviewId: "asset-execution-review-v001-test"
    },
    history: []
  };
  const validation = validateEpisode(episode);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  episode.reviewCheckpoints.assetExecution.humanApproval.candidateHash = "f".repeat(64);
  const stale = validateEpisode(episode);
  assert.equal(stale.valid, false);
  assert.ok(
    stale.errors.includes("approved asset execution checkpoint must bind human and machine review")
  );
});
