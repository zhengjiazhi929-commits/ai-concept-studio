import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readEpisode } from "../src/shared/store.mjs";
import { studioRoot } from "../src/shared/paths.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";
import { readReviewConfig } from "../src/server/reviews/coordinator.mjs";
import { runStageRubric } from "../src/server/reviews/rubrics/index.mjs";
import { validateTimelineForReview } from "../src/server/reviews/validators/timeline.mjs";
import { validateAssetsForReview } from "../src/server/reviews/validators/assets.mjs";
import { validateMediaForReview } from "../src/server/reviews/validators/media.mjs";
import {
  HYBRID_GENERATION_PROFILES,
  adaptApprovedStoryboardToShortAssetPlan
} from "../src/server/production/short-asset-plan-adapter.mjs";

const SHORT_EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";
const HISTORICAL_STORYBOARD_V3_HASH =
  "29f0914a188c5d17d7bf9e4f0adafb0fdbb1ce7b0665498e5d390c9e9e4bf182";

async function withApprovedHistoricalStoryboardV3(source) {
  const episode = structuredClone(source);
  const artifact = JSON.parse(await readFile(resolve(
    studioRoot,
    "data",
    "production",
    "episodes",
    SHORT_EPISODE_ID,
    "storyboard-draft-v003.json"
  ), "utf8"));
  const versions = episode.production.storyboardDraft.versions
    .filter(({ version }) => version <= 3)
    .map((entry) => structuredClone(entry));
  const version = versions.find((entry) => entry.version === 3);
  assert.ok(version, "测试夹具必须保留历史 Storyboard v3 元数据");
  episode.production.storyboardDraft = {
    ...version,
    needsRevision: false,
    versions
  };
  episode.scenes = structuredClone(artifact.timeline.scenes);
  episode.subtitles = structuredClone(artifact.timeline.subtitles);
  episode.render.durationSeconds = artifact.timeline.durationSeconds;
  const artifactHash = currentGateArtifactHash(episode, "storyboard");
  assert.equal(artifactHash, HISTORICAL_STORYBOARD_V3_HASH);
  const reportId = "test-storyboard-v3-machine-pass";
  episode.control.reviewEnabled = true;
  episode.reviews.storyboard = {
    status: "passed",
    artifactVersion: 3,
    artifactHash,
    rubricVersion: "storyboard-v3",
    revisionRounds: 0,
    latestReportId: reportId,
    reports: [{
      id: reportId,
      stage: "storyboard",
      decision: "pass",
      artifactVersion: 3,
      artifactHash
    }]
  };
  episode.approvals.storyboard = {
    ...episode.approvals.storyboard,
    status: "approved",
    currentVersion: 3,
    provenance: "reviewed-v2",
    reviewReportId: reportId,
    artifactHash
  };
  const storyboardStep = episode.pipeline.find((step) => step.gate === "storyboard");
  storyboardStep.status = "complete";
  storyboardStep.requiresHuman = false;
  return episode;
}

test("五个阶段加载独立且版本化的审核规则", async () => {
  const config = await readReviewConfig();
  assert.equal(config.version, "review-rubrics-v9");
  assert.deepEqual(Object.keys(config.stages), [
    "research",
    "script",
    "storyboard",
    "assets",
    "final"
  ]);
  for (const [stage, rule] of Object.entries(config.stages)) {
    assert.match(rule.version, new RegExp(`^${stage}-v\\d+$`, "u"));
    assert.ok(rule.requiredChecks.includes("artifact-version"));
  }
  assert.equal(config.stages.script.automaticRevision, true);
  assert.equal(config.stages.script.version, "script-v2");
  assert.ok(config.stages.script.requiredChecks.includes("script-narration-density"));
  assert.equal(config.stages.storyboard.version, "storyboard-v3");
  assert.ok(config.stages.storyboard.requiredChecks.includes("storyboard-script-coverage"));
  assert.ok(config.stages.storyboard.requiredChecks.includes("subtitle-boundaries"));
  assert.equal(config.stages.assets.version, "assets-v6");
  assert.ok(config.stages.assets.requiredChecks.includes("voice-duration"));
  assert.ok(config.stages.assets.requiredChecks.includes("progressive-technical-explanation"));
  assert.ok(config.stages.assets.requiredChecks.includes("voice-local-offline-provenance"));
  assert.ok(config.stages.assets.requiredChecks.includes("voice-local-offline-integrity"));
  assert.ok(config.stages.assets.requiredChecks.includes("voice-local-offline-authorization"));
  assert.equal(config.stages.final.version, "final-v3");
  assert.ok(config.stages.final.requiredChecks.includes("render-integrity"));
  assert.equal(config.stages.final.automaticRevision, true);
  assert.deepEqual(config.stages.final.revisionAgents, [
    "storyboard-agent",
    "asset-agent",
    "voice-agent",
    "render-agent"
  ]);
});

test("素材 Rubric 把渐进式技术讲解合同作为稳定必检项", async () => {
  const localOnlyEpisode = await readEpisode("golden-001");
  const localOnlyChecks = await validateAssetsForReview(localOnlyEpisode, {
    access: async () => undefined
  });
  const localOnlyMotion = localOnlyChecks.find(
    (check) => check.code === "progressive-technical-explanation"
  );
  assert.equal(localOnlyMotion.passed, true);
  assert.equal(localOnlyMotion.actual.required, false);
  const localOfflineNarrowChecks = localOnlyChecks.filter((check) =>
    check.code.startsWith("voice-local-offline-")
  );
  assert.equal(localOfflineNarrowChecks.length, 3);
  assert.equal(localOfflineNarrowChecks.every((check) => check.passed), true);
  assert.equal(localOfflineNarrowChecks.every((check) => check.actual.applicable === false), true);

  const localTechnicalEpisode = await withApprovedHistoricalStoryboardV3(
    await readEpisode(SHORT_EPISODE_ID)
  );
  localTechnicalEpisode.production.assetPlanDirection = {
    strategy: "local-only",
    selectedBy: "human"
  };
  localTechnicalEpisode.production.assetPlan.content =
    adaptApprovedStoryboardToShortAssetPlan(localTechnicalEpisode);
  const validLocalMotion = (await validateAssetsForReview(localTechnicalEpisode, {
    access: async () => undefined
  })).find((check) => check.code === "progressive-technical-explanation");
  assert.equal(validLocalMotion.passed, true);
  assert.equal(validLocalMotion.actual.required, true);
  assert.equal(validLocalMotion.actual.localItemIds.length, 4);

  const invalidEmphasisEpisode = structuredClone(localTechnicalEpisode);
  const invalidEmphasisItem = invalidEmphasisEpisode.production.assetPlan.content.items.find(
    (item) => item.id === "skill-tool-mcp-layers"
  );
  invalidEmphasisItem.visualContract.motionPolicy.emphasisPolicy
    .retainHighlightedElements = false;
  const invalidEmphasisMotion = (await validateAssetsForReview(invalidEmphasisEpisode, {
    access: async () => undefined
  })).find((check) => check.code === "progressive-technical-explanation");
  assert.equal(invalidEmphasisMotion.passed, false);
  assert.deepEqual(
    invalidEmphasisMotion.actual.invalidLocalItemIds,
    [invalidEmphasisItem.id]
  );

  const invalidLocalItem = localTechnicalEpisode.production.assetPlan.content.items.find(
    (item) => item.assetType === "technical-diagram"
  );
  invalidLocalItem.visualContract.motionPolicy = null;
  const invalidLocalMotion = (await validateAssetsForReview(localTechnicalEpisode, {
    access: async () => undefined
  })).find((check) => check.code === "progressive-technical-explanation");
  assert.equal(invalidLocalMotion.passed, false);
  assert.deepEqual(invalidLocalMotion.actual.invalidLocalItemIds, [invalidLocalItem.id]);

  const episode = await withApprovedHistoricalStoryboardV3(
    await readEpisode(SHORT_EPISODE_ID)
  );
  episode.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    generationProfile:
      HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P,
    selectedBy: "human"
  };
  episode.production.assetPlan.content = adaptApprovedStoryboardToShortAssetPlan(episode);
  const flowCall = episode.production.assetPlan.content.executionPolicy.externalApiCalls.find(
    (call) => call.visualContract?.kind === "technical-flow"
  );
  flowCall.visualContract.motionPolicy = null;
  const currentMotion = (await validateAssetsForReview(episode, {
    access: async () => undefined
  })).find((check) => check.code === "progressive-technical-explanation");
  assert.equal(currentMotion.passed, false);
  assert.equal(currentMotion.actual.required, true);
  assert.equal(currentMotion.actual.invalidCallIds.length, 1);
});

test("不同阶段 Rubric 运行不同的必过项", async () => {
  const episode = await readEpisode("golden-001");
  const researchCodes = runStageRubric("research", episode).map((check) => check.code);
  const scriptCodes = runStageRubric("script", episode).map((check) => check.code);
  const storyboardCodes = runStageRubric("storyboard", episode).map((check) => check.code);
  assert.ok(researchCodes.includes("research-ready"));
  assert.ok(scriptCodes.includes("script-draft"));
  assert.ok(scriptCodes.includes("script-section-count"));
  assert.ok(scriptCodes.includes("script-narration-density"));
  assert.ok(scriptCodes.includes("script-evidence-refs"));
  assert.ok(storyboardCodes.includes("scene-count"));
  assert.ok(storyboardCodes.includes("scene-type-statement"));
  assert.ok(storyboardCodes.includes("storyboard-script-coverage"));
  assert.ok(storyboardCodes.includes("subtitle-boundaries"));
  assert.equal(researchCodes.includes("script-draft"), false);
});

test("时间轴问题带稳定定位，成片检查覆盖渲染和 QA", async () => {
  const episode = await readEpisode("golden-001");
  episode.subtitles[0].start = 1;
  const timeline = validateTimelineForReview(episode);
  assert.equal(timeline.find((check) => check.code === "subtitle-timeline").passed, false);
  episode.render.status = "missing";
  episode.render.outputPath = null;
  episode.qa.status = "stale";
  const media = validateMediaForReview(episode);
  assert.deepEqual(
    media.filter((check) => !check.passed).map((check) => check.code),
    ["render-complete", "render-output", "render-integrity", "qa-passed"]
  );
});

test("最终审核要求渲染记录与 QA 绑定同一份成片摘要", async () => {
  const episode = await readEpisode("golden-001");
  const sha256 = "a".repeat(64);
  episode.render = {
    ...episode.render,
    status: "complete",
    outputPath: "outputs/studio/golden-001/preview-v001.mp4",
    bytes: 60_001,
    sha256
  };
  episode.qa = {
    ...episode.qa,
    status: "passed",
    checks: [
      { id: "render-bytes", passed: true, actual: 60_001, expected: 60_001 },
      { id: "render-sha256", passed: true, actual: sha256, expected: sha256 }
    ]
  };
  assert.equal(
    validateMediaForReview(episode).find((item) => item.code === "render-integrity").passed,
    true
  );

  episode.qa.checks[1].actual = "b".repeat(64);
  assert.equal(
    validateMediaForReview(episode).find((item) => item.code === "render-integrity").passed,
    false
  );
});
