import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { prepareAndWriteGoldenM1UpstreamGate } from
  "../scripts/prepare-golden-m1-upstream-gate.mjs";
import { prepareGoldenM1UpstreamGate } from
  "../src/server/production/golden-m1-gate-preparation.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";
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

test("准备脚本只产出机器审核 dossier，保持人工批准 pending", async () => {
  const outputDirectory = await mkdtemp(resolve(tmpdir(), "golden-upstream-gate-test-"));
  let stored = await legacyGolden();
  const events = [];
  try {
    const result = await prepareAndWriteGoldenM1UpstreamGate({
      outputDirectory,
      now: new Date("2026-08-25T14:00:00.000Z"),
      readEpisode: async () => structuredClone(stored),
      writeEpisode: async (episode) => {
        stored = structuredClone(episode);
        return resolve(outputDirectory, "episode.json");
      },
      appendEvent: async (event) => events.push(structuredClone(event)),
      recheckGateReview: async (_episodeId, gate) => {
        const hash = currentGateArtifactHash(stored, gate);
        const reportId = `review-${gate}-fixture`;
        stored.reviews[gate] = {
          ...stored.reviews[gate],
          status: "passed",
          artifactVersion: 1,
          artifactHash: hash,
          latestReportId: reportId,
          reports: [{
            id: reportId,
            decision: "pass",
            artifactVersion: 1,
            artifactHash: hash,
            reviewConfigVersion: "review-rubrics-v10",
            rubricVersion: "research-v2",
            checks: [],
            blockingIssues: []
          }]
        };
        return { episode: structuredClone(stored) };
      },
      getHumanApprovalView: async (_episodeId, gate) => ({
        status: { readyForHumanApproval: true },
        binding: {
          artifactVersion: 1,
          artifactHash: currentGateArtifactHash(stored, gate),
          reviewReportId: stored.reviews[gate].latestReportId
        },
        machineReview: {
          decision: "pass",
          checks: [],
          blockingIssues: []
        },
        content: {
          scenes: stored.scenes,
          subtitles: stored.subtitles,
          renderSpecification: stored.render
        }
      })
    });
    assert.equal(result.gate, "research");
    assert.equal(stored.approvals.research.status, "pending");
    assert.equal(stored.approvals.script.status, "pending");
    assert.equal(stored.approvals.script.artifactHash, null);
    assert.equal(events.length, 1);
    const dossier = JSON.parse(await readFile(resolve(outputDirectory,
      "upstream-research-gate-dossier-v001.json"), "utf8"));
    assert.equal(dossier.status, "ready-for-human-approval");
    assert.equal(dossier.content.sourceDocs.length, 7);
    const markdown = await readFile(
      resolve(outputDirectory, "upstream-research-gate-dossier-v001.md"),
      "utf8"
    );
    assert.match(markdown, /这不是人工批准/u);
    assert.match(markdown, /本片将使用的六项结论/u);
    assert.match(markdown, /测试通过是重要反馈/u);
    assert.match(markdown, /结论引用的一手来源/u);
    assert.match(markdown, /Introducing Codex/u);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("Rubric 版本变化时旧 pass 报告必须重审后才能生成 dossier", async () => {
  const outputDirectory = await mkdtemp(resolve(tmpdir(), "golden-upstream-rubric-test-"));
  let stored = prepareGoldenM1UpstreamGate(await legacyGolden()).episode;
  const hash = currentGateArtifactHash(stored, "research");
  stored.reviews.research = {
    status: "passed",
    artifactVersion: 1,
    artifactHash: hash,
    latestReportId: "review-research-stale",
    reports: [{
      id: "review-research-stale",
      decision: "pass",
      artifactVersion: 1,
      artifactHash: hash,
      reviewConfigVersion: "review-rubrics-v9",
      rubricVersion: "research-v1"
    }]
  };
  let rechecks = 0;
  try {
    const result = await prepareAndWriteGoldenM1UpstreamGate({
      outputDirectory,
      readEpisode: async () => structuredClone(stored),
      writeEpisode: async (episode) => {
        stored = structuredClone(episode);
      },
      appendEvent: async () => undefined,
      recheckGateReview: async () => {
        rechecks += 1;
        stored.reviews.research = {
          ...stored.reviews.research,
          latestReportId: "review-research-current",
          reports: [...stored.reviews.research.reports, {
            id: "review-research-current",
            decision: "pass",
            artifactVersion: 1,
            artifactHash: hash,
            reviewConfigVersion: "review-rubrics-v10",
            rubricVersion: "research-v2",
            checks: [],
            blockingIssues: []
          }]
        };
        return { episode: structuredClone(stored) };
      },
      getHumanApprovalView: async () => ({
        status: { readyForHumanApproval: true },
        binding: {
          artifactVersion: 1,
          artifactHash: hash,
          reviewReportId: "review-research-current"
        },
        machineReview: { decision: "pass", checks: [], blockingIssues: [] }
      })
    });
    assert.equal(rechecks, 1);
    assert.equal(result.reviewReportId, "review-research-current");
    assert.equal(stored.approvals.research.status, "pending");
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
