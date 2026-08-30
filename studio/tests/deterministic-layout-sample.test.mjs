import assert from "node:assert/strict";
import test from "node:test";

import { agents } from "../src/server/agents/registry.mjs";
import {
  deterministicLayoutRepresentativeFrame,
  finalizeDeterministicLayoutSampleSet,
  prepareDeterministicLayoutSamples
} from "../src/server/renderer.mjs";
import { evaluateProductionQuality } from "../src/server/production/quality.mjs";
import {
  DETERMINISTIC_LAYOUT_SAMPLE_SCHEMA_VERSION,
  DETERMINISTIC_LAYOUT_SAMPLE_TYPE,
  VISUAL_EXPRESSION_CONTRACT_VERSION,
  VISUAL_EXPRESSION_ERROR_CODES,
  VISUAL_EXPRESSION_RENDERER_CONTRACT_VERSION,
  VISUAL_EXPRESSION_STYLE_PROFILE_ID,
  createVisualExpressionIntent,
  resolveVisualExpressionPlan,
  validateDeterministicLayoutSampleSet
} from "../src/shared/visual-expression-contract.mjs";

const RENDER_SHA256 = "a".repeat(64);
const COMPOSITION = Object.freeze({
  id: "EpisodePreview",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 60
});

function contractScene() {
  const visualIntent = createVisualExpressionIntent({
    question: "准备与验收按什么顺序发生？",
    takeaway: "先准备，再验收。",
    role: "explanation",
    objective: "explain",
    informationNeed: "sequence",
    contribution: "show-order",
    contributionRationale: "删掉顺序结构后，两个阶段会被误读成没有先后的并列概念。",
    relationKind: "sequence",
    compositionProfile: "text-first",
    claims: [{
      id: "claim-order",
      text: "准备先于验收",
      visualRequired: true,
      evidenceRefs: []
    }],
    entities: [
      {
        id: "prepare",
        label: "准备",
        semanticRole: "step",
        importance: "primary",
        claimIds: ["claim-order"]
      },
      {
        id: "accept",
        label: "验收",
        semanticRole: "result",
        importance: "secondary",
        claimIds: ["claim-order"]
      }
    ],
    relations: [{
      id: "prepare-to-accept",
      from: "prepare",
      to: "accept",
      type: "then",
      label: "然后",
      directed: true,
      claimIds: ["claim-order"]
    }],
    evidenceRefs: [],
    mustNotShow: ["装饰箭头"]
  }, { sceneId: "S01" });
  return {
    id: "S01",
    start: 0,
    end: 2,
    visualIntent,
    visualPlan: resolveVisualExpressionPlan({
      sceneId: "S01",
      visualIntent,
      styleProfileId: VISUAL_EXPRESSION_STYLE_PROFILE_ID
    })
  };
}

function contractEpisode() {
  return {
    id: "deterministic-layout-sample-test",
    concept: "确定性布局样本",
    title: "渲染后布局合同",
    thesis: "每个合同场景都应在成片渲染后绑定确定性布局样本。",
    audience: "视频生产与审核团队",
    sourceDocs: [{ id: "a" }, { id: "b" }, { id: "c" }],
    production: {
      storyboardDraft: {
        artifactPath: "studio/data/production/test/storyboard-v001.json",
        visualContractVersion: VISUAL_EXPRESSION_CONTRACT_VERSION,
        visualStyleProfileId: VISUAL_EXPRESSION_STYLE_PROFILE_ID
      }
    },
    scenes: [contractScene()],
    subtitles: [],
    render: {
      compositionId: COMPOSITION.id,
      width: COMPOSITION.width,
      height: COMPOSITION.height,
      fps: COMPOSITION.fps,
      durationSeconds: 2,
      version: 1,
      versions: [],
      outputPath: "outputs/studio/test/preview-v001.mp4",
      bytes: 60_001,
      sha256: RENDER_SHA256
    },
    voice: { status: "missing" },
    previewMode: "visual-proof",
    approvals: {
      assets: { status: "approved" },
      final: { status: "pending" }
    },
    qa: { status: "pending", checks: [] }
  };
}

function finalizedSampleSet(episode = contractEpisode()) {
  return finalizeDeterministicLayoutSampleSet(
    prepareDeterministicLayoutSamples(episode, COMPOSITION),
    {
      compositionId: COMPOSITION.id,
      renderVersion: episode.render.version,
      renderedArtifactSha256: episode.render.sha256
    }
  );
}

function sampleReview(sampleSet, episode = contractEpisode()) {
  return validateDeterministicLayoutSampleSet(sampleSet, {
    scenes: episode.scenes,
    rendererContractVersion: VISUAL_EXPRESSION_RENDERER_CONTRACT_VERSION,
    styleProfileId: VISUAL_EXPRESSION_STYLE_PROFILE_ID,
    compositionId: episode.render.compositionId,
    renderVersion: episode.render.version,
    renderedArtifactSha256: episode.render.sha256,
    durationInFrames: COMPOSITION.durationInFrames
  });
}

function issueCodes(review) {
  return review.issues.map((item) => item.code);
}

test("render 完成后为每个合同场景生成绑定成片 SHA 的 deterministic-layout-sample", () => {
  const episode = contractEpisode();
  const prepared = prepareDeterministicLayoutSamples(episode, COMPOSITION);
  assert.equal(prepared.scenes.length, episode.scenes.length);
  assert.equal(deterministicLayoutRepresentativeFrame(episode.scenes[0], COMPOSITION), 59);

  const sampleSet = finalizedSampleSet(episode);
  assert.equal(sampleSet.sampleType, DETERMINISTIC_LAYOUT_SAMPLE_TYPE);
  assert.equal(sampleSet.schemaVersion, DETERMINISTIC_LAYOUT_SAMPLE_SCHEMA_VERSION);
  assert.equal(sampleSet.rendererContractVersion, VISUAL_EXPRESSION_RENDERER_CONTRACT_VERSION);
  assert.equal(sampleSet.styleProfileId, VISUAL_EXPRESSION_STYLE_PROFILE_ID);
  assert.equal(sampleSet.renderedArtifactSha256, RENDER_SHA256);
  assert.equal(sampleSet.finalizedAfterRender, true);
  assert.equal(sampleSet.pixelInspection, false);
  assert.equal(sampleSet.humanVisualQa, false);
  assert.equal(sampleSet.scenes[0].layoutSamples[0].frame, 59);
  assert.equal(
    sampleSet.scenes[0].layoutSamples[0].deterministicLayoutSample.sceneId,
    "S01"
  );
  assert.equal(sampleReview(sampleSet, episode).passed, true);
});

test("历史无视觉合同 Episode 不伪造或强制 deterministic-layout-sample", () => {
  const legacy = contractEpisode();
  delete legacy.production.storyboardDraft.visualContractVersion;
  delete legacy.production.storyboardDraft.visualStyleProfileId;
  delete legacy.scenes[0].visualIntent;
  delete legacy.scenes[0].visualPlan;
  assert.equal(prepareDeterministicLayoutSamples(legacy, COMPOSITION), null);

  const quality = evaluateProductionQuality(legacy, { stage: "qa" });
  assert.equal(
    quality.checks.some((check) => check.id === "deterministic-layout-samples"),
    false
  );
});

test("当前 Worker 或确定性适配器生成的分镜缺少视觉合同必须 fail closed", () => {
  for (const currentGeneratorBinding of [
    {
      promptBinding: {
        id: "acs.worker.storyboard-draft",
        version: "1.1.0",
        hash: "a".repeat(64),
        renderedHash: "b".repeat(64)
      }
    },
    { generationKind: "deterministic-approved-script-storyboard-adapter" }
  ]) {
    const episode = contractEpisode();
    delete episode.production.storyboardDraft.visualContractVersion;
    delete episode.production.storyboardDraft.visualStyleProfileId;
    delete episode.scenes[0].visualIntent;
    delete episode.scenes[0].visualPlan;
    Object.assign(episode.production.storyboardDraft, currentGeneratorBinding);

    const quality = evaluateProductionQuality(episode, { stage: "storyboard" });
    const check = quality.checks.find((item) => item.id === "visual-expression-contract");
    assert.equal(check?.passed, false);
    assert.notEqual(check?.actual, "legacy-storyboard");
  }
});

test("样本验证拒绝缺失、旧版本、错误 renderer/style 与旧成片绑定", () => {
  const episode = contractEpisode();
  const valid = finalizedSampleSet(episode);
  assert.ok(issueCodes(sampleReview(null, episode)).includes(
    VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLES_MISSING
  ));

  for (const [field, value, expectedCode] of [
    ["schemaVersion", "deterministic-layout-sample-v0", VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_VERSION_MISMATCH],
    ["rendererContractVersion", "other-renderer-v1", VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_RENDERER_MISMATCH],
    ["styleProfileId", "other-style-v1", VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_STYLE_MISMATCH],
    ["renderedArtifactSha256", "b".repeat(64), VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_RENDER_BINDING_MISMATCH]
  ]) {
    const invalid = structuredClone(valid);
    invalid[field] = value;
    const review = sampleReview(invalid, episode);
    assert.equal(review.passed, false, field);
    assert.ok(issueCodes(review).includes(expectedCode), field);
  }
});

test("QA 只接受当前 render 记录中的样本并拒绝版本或风格漂移", () => {
  const episode = contractEpisode();
  episode.render.deterministicLayoutSampleSet = finalizedSampleSet(episode);
  let quality = evaluateProductionQuality(episode, { stage: "qa" });
  assert.equal(
    quality.checks.find((check) => check.id === "deterministic-layout-samples")?.passed,
    true
  );
  assert.equal(
    quality.checks.find((check) => check.id === "visual-expression-contract")?.passed,
    true
  );

  delete episode.render.deterministicLayoutSampleSet;
  quality = evaluateProductionQuality(episode, { stage: "qa" });
  assert.equal(
    quality.checks.find((check) => check.id === "deterministic-layout-samples")?.passed,
    false
  );

  episode.render.deterministicLayoutSampleSet = finalizedSampleSet(episode);
  episode.render.deterministicLayoutSampleSet.styleProfileId = "other-style-v1";
  quality = evaluateProductionQuality(episode, { stage: "qa" });
  assert.equal(
    quality.checks.find((check) => check.id === "deterministic-layout-samples")?.passed,
    false
  );
});

test("render-agent 将样本同时写入当前 render 与对应版本历史", async () => {
  const episode = contractEpisode();
  const deterministicLayoutSampleSet = finalizedSampleSet(episode);
  const output = await agents["render-agent"].run(episode, {
    renderPreview: async () => ({
      outputPath: "/tmp/preview-v001.mp4",
      relativeOutputPath: "outputs/studio/test/preview-v001.mp4",
      outputRoot: "outputs/studio",
      bytes: 60_001,
      sha256: RENDER_SHA256,
      deterministicLayoutSampleSet,
      cloudBackup: { status: "skipped" }
    })
  });
  assert.equal(output.status, "complete");
  assert.deepEqual(
    output.patch.render.deterministicLayoutSampleSet,
    deterministicLayoutSampleSet
  );
  assert.deepEqual(
    output.patch.render.versions.at(-1).deterministicLayoutSampleSet,
    deterministicLayoutSampleSet
  );
});
