import assert from "node:assert/strict";
import test from "node:test";

import { currentGateArtifactHash } from "../src/shared/workflow.mjs";
import { prepareGoldenM1UpstreamGate } from
  "../src/server/production/golden-m1-gate-preparation.mjs";
import { readFixtureEpisode } from "./episode-fixture.mjs";

async function legacyGolden() {
  const episode = structuredClone(await readFixtureEpisode());
  delete episode.research;
  delete episode.productionProfile;
  episode.production.scriptDraft = {
    version: 1,
    source: "episodes/golden-001/07-script.md"
  };
  episode.production.storyboardDraft = {
    version: 1,
    source: "episodes/golden-001/08-storyboard.md"
  };
  for (const scene of episode.scenes) delete scene.evidenceRef;
  episode.system = {
    ...episode.system,
    importedBy: "golden-sample-importer-v0.1",
    trustedFixture: true
  };
  for (const gate of ["research", "script", "storyboard"]) {
    episode.approvals[gate].provenance = "trusted-fixture";
    episode.approvals[gate].reviewReportId = null;
  }
  episode.approvals.script.artifactHash = currentGateArtifactHash(episode, "script");
  episode.approvals.storyboard.artifactHash = currentGateArtifactHash(episode, "storyboard");
  return episode;
}

test("legacy golden 先移除 trusted 例外并停在 research Gate", async () => {
  const source = await legacyGolden();
  const result = prepareGoldenM1UpstreamGate(source, {
    now: new Date("2026-08-25T13:00:00.000Z")
  });
  assert.equal(result.changed, true);
  assert.equal(result.nextGate, "research");
  assert.equal(result.episode.system.trustedFixture, false);
  assert.equal(result.episode.research.version, 1);
  assert.equal(result.episode.productionProfile.id, "m1-golden-36s-v1");
  assert.equal(result.episode.production.scriptDraft.content.sections.length, 6);
  assert.equal(result.episode.production.scriptDraft.artifactPath, undefined);
  assert.equal(result.episode.production.storyboardDraft.artifactPath, undefined);
  assert.equal(result.episode.approvals.research.status, "pending");
  assert.equal(result.episode.approvals.script.status, "pending");
  assert.equal(result.episode.approvals.storyboard.status, "pending");
  assert.equal(result.episode.pipeline.find((step) => step.id === "research").status,
    "waiting_approval");
  assert.equal(result.episode.pipeline.find((step) => step.id === "script").status,
    "pending");
  assert.equal(result.episode.pipeline.find((step) => step.id === "storyboard").status,
    "pending");
  assert.equal(result.episode.approvalHistory.length, source.approvalHistory.length);
});

test("已准备的 research Gate 重跑不删除机器报告或追加失效历史", async () => {
  const first = prepareGoldenM1UpstreamGate(await legacyGolden()).episode;
  first.reviews.research.status = "passed";
  first.reviews.research.artifactVersion = 1;
  first.reviews.research.artifactHash = currentGateArtifactHash(first, "research");
  first.reviews.research.latestReportId = "review-research-current";
  first.reviews.research.reports = [{
    id: "review-research-current",
    decision: "pass",
    artifactVersion: 1,
    artifactHash: currentGateArtifactHash(first, "research")
  }];
  const historyLength = first.history.length;
  const second = prepareGoldenM1UpstreamGate(first);
  assert.equal(second.changed, false);
  assert.equal(second.nextGate, "research");
  assert.equal(second.episode.reviews.research.latestReportId, "review-research-current");
  assert.equal(second.episode.history.length, historyLength);
});

test("非 legacy 候选不被准备脚本静默覆盖", async () => {
  const source = await legacyGolden();
  source.production.scriptDraft = {
    version: 2,
    generationKind: "human-edited",
    content: { sections: [{ narration: "人工候选" }] }
  };
  assert.throws(
    () => prepareGoldenM1UpstreamGate(source),
    (error) => error.code === "golden_m1_existing_candidate_conflict"
  );
});
