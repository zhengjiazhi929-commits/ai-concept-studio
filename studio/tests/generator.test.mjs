import test from "node:test";
import assert from "node:assert/strict";
import {
  generateAssetPlan,
  readApprovedScriptInput,
  splitSubtitleText,
  splitTextNearMiddle
} from "../src/server/production/generator.mjs";
import { subtitleBoundaryIssues } from "../src/server/production/quality.mjs";
import {
  APPROVED_STORYBOARD_SHORT_ASSET_ADAPTER_VERSION,
  HYBRID_GENERATION_PROFILES,
  TECHNICAL_DIAGRAM_CONTRACT_VERSION
} from
  "../src/server/production/short-asset-plan-adapter.mjs";
import {
  CUMULATIVE_PATH_EMPHASIS_VERSION,
  PROGRESSIVE_KNOWLEDGE_MOTION_LEGACY_VERSION,
  PROGRESSIVE_KNOWLEDGE_MOTION_VERSION,
  TECHNICAL_DIAGRAM_LOCAL_SEMANTIC_LAYER,
  TECHNICAL_DIAGRAM_TRANSITION_DURATION_SECONDS,
  TECHNICAL_DIAGRAM_TRANSITION_EASING,
  localTechnicalDiagramPlanReview,
  progressiveTechnicalFlowPlanReview
} from
  "../src/shared/technical-diagram-contract.mjs";
import { integrityHash } from "../src/shared/integrity.mjs";
import { readFixtureEpisode } from "./episode-fixture.mjs";
import {
  HISTORICAL_ASSET_V13_FIXTURE_HASH,
  HISTORICAL_ASSET_V13_FIXTURE_ID,
  HISTORICAL_ASSET_V13_SOURCE_PLAN_HASH,
  historicalAssetV13Fixture
} from "./historical-asset-v13.fixture.mjs";
import { historicalApprovedStoryboardV3Episode } from
  "./historical-approved-storyboard-v3.fixture.mjs";

function approvedHistoricalEpisode() {
  return historicalApprovedStoryboardV3Episode();
}

test("导入的 Markdown 脚本可作为分镜驳回后的再生成输入", async () => {
  const episode = await readFixtureEpisode();
  delete episode.production.scriptDraft.content;
  episode.production.scriptDraft.source =
    "studio/tests/fixtures/episodes/golden-001-approved-script.md";
  const input = await readApprovedScriptInput(episode);
  assert.equal(input.format, "markdown");
  assert.equal(
    input.source,
    "studio/tests/fixtures/episodes/golden-001-approved-script.md"
  );
  assert.match(input.content, /Agentic Coding/u);
});

test("字幕拆分保留中文词语、英文词组和闭合标点边界", () => {
  const source = "Agent Skill 可以附带脚本、参考资料和资产。它解决团队方法如何沉淀。";
  const chunks = splitSubtitleText(source, 15);
  assert.equal(chunks.join(""), source);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 15));
  assert.deepEqual(
    subtitleBoundaryIssues(chunks.map((text, index) => ({ text, start: index, end: index + 1 }))),
    []
  );
  const halves = splitTextNearMiddle(source);
  assert.equal(halves.join(""), source);
  assert.deepEqual(
    subtitleBoundaryIssues(halves.map((text, index) => ({ text, start: index, end: index + 1 }))),
    []
  );
});

test("60 秒派生素材方案只承接批准分镜且不调用 Provider", async () => {
  const episode = approvedHistoricalEpisode();
  episode.production.assetPlanDirection = {
    strategy: "local-only",
    selectedBy: "human"
  };
  let providerCalls = 0;
  let written = null;
  const generated = await generateAssetPlan(episode, {
    client: {
      async generateStructured() {
        providerCalls += 1;
        throw new Error("确定性素材方案不应调用 Provider");
      }
    },
    writeArtifact: async (episodeId, prefix, document) => {
      written = { episodeId, prefix, document };
      return {
        version: 1,
        path: "/tmp/asset-plan-v001.json",
        relativePath: "studio/data/production/test/asset-plan-v001.json"
      };
    }
  });
  assert.equal(providerCalls, 0);
  assert.equal(generated.provider, "deterministic-local");
  assert.equal(generated.generationKind, "deterministic-approved-storyboard-asset-plan-adapter");
  assert.equal(generated.model, APPROVED_STORYBOARD_SHORT_ASSET_ADAPTER_VERSION);
  assert.equal(generated.model, "approved-storyboard-short-asset-plan-adapter-v10");
  assert.equal(generated.requestCount, 0);
  assert.equal(generated.value.executionPolicy.mode, "local-only");
  assert.equal(generated.value.executionPolicy.maximumPaidCostUsd, 0);
  assert.deepEqual(generated.value.executionPolicy.externalApiCalls, []);
  assert.equal("generationProfile" in generated.value, false);
  assert.equal("nativeCurrencyCaps" in generated.value.executionPolicy, false);
  const localItems = generated.value.items.filter(
    (item) => item.productionMethod.kind === "local-code-animation"
  );
  const technicalDiagrams = localItems.filter(
    (item) => item.assetType === "technical-diagram"
  );
  const uiOverlays = localItems.filter((item) => item.assetType === "ui-overlay");
  assert.equal(localItems.length, 5);
  assert.equal(technicalDiagrams.length, 4);
  assert.deepEqual(
    technicalDiagrams.map((item) => item.id),
    [
      "skill-tool-mcp-layers",
      "weekly-report-process",
      "tool-and-mcp-actions",
      "capability-boundary-contrast"
    ]
  );
  assert.deepEqual(uiOverlays.map((item) => item.id), ["subtitle-and-progress-chrome"]);
  assert.equal(
    technicalDiagrams.every(
      (item) =>
        item.visualContract?.schemaVersion === TECHNICAL_DIAGRAM_CONTRACT_VERSION &&
        item.visualContract.semanticLayer === TECHNICAL_DIAGRAM_LOCAL_SEMANTIC_LAYER &&
        item.visualContract.motionPolicy?.schemaVersion ===
          PROGRESSIVE_KNOWLEDGE_MOTION_VERSION
    ),
    true
  );
  assert.equal(uiOverlays.every((item) => item.visualContract == null), true);
  const architecture = technicalDiagrams.find(
    (item) => item.id === "skill-tool-mcp-layers"
  );
  assert.deepEqual(architecture.visualContract.motionPolicy.emphasisPolicy, {
    schemaVersion: CUMULATIVE_PATH_EMPHASIS_VERSION,
    sceneId: "S04",
    mode: "cumulative-path-highlight",
    fps: 30,
    sceneStartFrame: 523,
    sceneEndFrameExclusive: 764,
    retainHighlightedElements: true,
    neutralElements: {
      treatment: "base-style-throughout",
      nodeIds: ["tool-action"],
      edgeIds: ["agent-invokes-tool"]
    },
    transition: {
      nodeEnterFrames: 18,
      edgeDrawFrames: 14,
      arrowheadFadeFrames: 4,
      easing: "ease-in-out-smoothstep",
      bounce: false
    },
    stages: [
      { id: "skill-rule", order: 1, label: "Skill 规则", startFrameOffset: 0,
        highlightNodeIds: ["skill-knowledge"], highlightEdgeIds: [] },
      { id: "agent-decision", order: 2, label: "Agent 判断", startFrameOffset: 36,
        highlightNodeIds: ["agent"], highlightEdgeIds: ["skill-guides-agent"] },
      { id: "mcp-call", order: 3, label: "MCP 调用", startFrameOffset: 72,
        highlightNodeIds: ["mcp-protocol"], highlightEdgeIds: ["agent-uses-mcp"] },
      { id: "external-capability", order: 4, label: "外部能力", startFrameOffset: 114,
        highlightNodeIds: ["external-capability"],
        highlightEdgeIds: ["mcp-connects-capability"] }
    ],
    endBehavior: {
      mode: "hold-then-crossfade",
      holdStartFrameOffset: 132,
      crossfadeStartFrameOffset: 241,
      crossfadeDurationFrames: 9,
      outgoingDiagramId: "architecture",
      incomingDiagramId: "weeklyReport",
      retainHighlightThroughCrossfade: true,
      easing: "ease-in-out-smoothstep",
      bounce: false
    }
  });
  assert.equal(
    technicalDiagrams
      .filter((item) => item.id !== "skill-tool-mcp-layers")
      .every((item) => item.visualContract.motionPolicy.emphasisPolicy === null),
    true
  );
  assert.equal(localTechnicalDiagramPlanReview(generated.value).passed, true);
  for (const mutate of [
    (policy) => { policy.retainHighlightedElements = false; },
    (policy) => { policy.stages.pop(); },
    (policy) => { policy.neutralElements.nodeIds = ["agent"]; },
    (policy) => { policy.endBehavior.crossfadeStartFrameOffset = 240; },
    (policy) => { policy.endBehavior.retainHighlightThroughCrossfade = false; }
  ]) {
    const invalidPlan = structuredClone(generated.value);
    const invalidPolicy = invalidPlan.items.find(
      (item) => item.id === "skill-tool-mcp-layers"
    ).visualContract.motionPolicy.emphasisPolicy;
    mutate(invalidPolicy);
    assert.equal(localTechnicalDiagramPlanReview(invalidPlan).passed, false);
  }
  const downgradedPlan = structuredClone(generated.value);
  const downgradedMotion = downgradedPlan.items.find(
    (item) => item.id === "skill-tool-mcp-layers"
  ).visualContract.motionPolicy;
  downgradedMotion.schemaVersion = PROGRESSIVE_KNOWLEDGE_MOTION_LEGACY_VERSION;
  delete downgradedMotion.emphasisPolicy;
  const downgradedReview = localTechnicalDiagramPlanReview(downgradedPlan);
  assert.equal(downgradedReview.motionSchemaSetPassed, false);
  assert.equal(downgradedReview.passed, false);
  assert.equal(
    technicalDiagrams.every(
      (item) =>
        item.visualContract.motionPolicy.transition.durationSeconds ===
          TECHNICAL_DIAGRAM_TRANSITION_DURATION_SECONDS &&
        item.visualContract.motionPolicy.transition.easing ===
          TECHNICAL_DIAGRAM_TRANSITION_EASING &&
        item.visualContract.motionPolicy.transition.bounce === false &&
        item.visualContract.motionPolicy.transition.arrowheadReveal ===
          "continuous-fade"
    ),
    true
  );
  assert.equal(
    localItems.every((item) => item.estimatedCost.maximumCostUsd === 0),
    true
  );
  assert.equal(
    generated.value.sourceStoryboard.artifactHash,
    episode.approvals.storyboard.artifactHash
  );
  assert.equal(
    generated.value.items.every((item) => item.estimatedCost.maximumCostUsd === 0),
    true
  );
  assert.equal(written.episodeId, episode.id);
  assert.equal(written.prefix, "asset-plan");
  assert.equal(written.document.plan, generated.value);
});

test("历史 Asset v13 的 v2 motion contract 保持只读兼容", () => {
  const fixture = historicalAssetV13Fixture();
  assert.equal(
    fixture.fixtureId,
    "agent-skill-tool-mcp-60s-20260813/asset-plan-v013:legacy-motion-v2-minimal-v1"
  );
  assert.equal(fixture.fixtureId, HISTORICAL_ASSET_V13_FIXTURE_ID);
  assert.equal(fixture.source.artifactVersion, 13);
  assert.equal(
    fixture.source.sourcePlanIntegrityHash,
    "a776121354841411ab0d6f05570d0e3be9980c29a1a4b667a6c7595a3dc320d8"
  );
  assert.equal(
    fixture.source.sourcePlanIntegrityHash,
    HISTORICAL_ASSET_V13_SOURCE_PLAN_HASH
  );
  assert.equal(
    integrityHash(fixture),
    "a15da4728d04e65377042bc63af0318af6851b1710d721d54031708101e0a283"
  );
  assert.equal(integrityHash(fixture), HISTORICAL_ASSET_V13_FIXTURE_HASH);
  const plan = fixture.plan;
  const localReview = localTechnicalDiagramPlanReview(plan);
  const motionReview = progressiveTechnicalFlowPlanReview(plan);
  assert.equal(plan.sourceStoryboard.version, 4);
  assert.deepEqual(localReview.observedMotionSchemaVersions, [
    PROGRESSIVE_KNOWLEDGE_MOTION_LEGACY_VERSION
  ]);
  assert.equal(localReview.legacySchemaSet, true);
  assert.equal(localReview.currentSchemaSet, false);
  assert.deepEqual(localReview.itemIds, ["skill-tool-mcp-layers"]);
  assert.equal(localReview.passed, true);
  assert.equal(motionReview.passed, true);
});

test("人工选择混合方案后 Asset Agent 只生成待批计划，不调用生图或生视频 API", async () => {
  const episode = approvedHistoricalEpisode();
  episode.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    selectedBy: "human",
    feedback: "本地动画加生图 API 和少量生视频 API"
  };
  let providerCalls = 0;
  const generated = await generateAssetPlan(episode, {
    client: {
      async generateStructured() {
        providerCalls += 1;
        throw new Error("确定性混合素材方案不应调用 Provider");
      }
    },
    writeArtifact: async () => ({
      version: 2,
      path: "/tmp/asset-plan-v002.json",
      relativePath: "studio/data/production/test/asset-plan-v002.json"
    })
  });
  assert.equal(providerCalls, 0);
  assert.equal(generated.requestCount, 0);
  assert.equal(generated.value.executionPolicy.mode, "mixed");
  assert.equal(generated.value.executionPolicy.externalApiCalls.length, 3);
  assert.equal(generated.value.executionPolicy.maximumPaidCostUsd, 1);
  assert.deepEqual(
    generated.value.executionPolicy.externalApiCalls.map((call) => call.model),
    ["gpt-image-2-2026-04-21", "sora-2", "gpt-image-2-2026-04-21"]
  );
  assert.equal(
    generated.value.executionPolicy.externalApiCalls.every(
      (call) => call.prompt && call.endpoint && call.outputSpec
    ),
    true
  );
  assert.equal(
    generated.value.items.filter((item) =>
      item.productionMethod.kind.startsWith("external-")
    ).length,
    3
  );
});

test("人工锁定 AIHubMix 与 Seedance 2.5 后 Asset Agent 生成双币种 v4 而不调用 Provider", async () => {
  const episode = approvedHistoricalEpisode();
  episode.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    generationProfile:
      HYBRID_GENERATION_PROFILES.AIHUBMIX_VOLCENGINE_SEEDANCE_2_5_720P,
    selectedBy: "human",
    feedback: "AIHubMix GPT Image 2 + 火山方舟 Seedance 2.5 720p"
  };
  let providerCalls = 0;
  const generated = await generateAssetPlan(episode, {
    client: {
      async generateStructured() {
        providerCalls += 1;
        throw new Error("素材计划阶段不得调用 Provider");
      }
    },
    writeArtifact: async () => ({
      version: 3,
      path: "/tmp/asset-plan-v003.json",
      relativePath: "studio/data/production/test/asset-plan-v003.json"
    })
  });
  assert.equal(providerCalls, 0);
  assert.equal(generated.requestCount, 0);
  assert.equal(generated.model, APPROVED_STORYBOARD_SHORT_ASSET_ADAPTER_VERSION);
  assert.equal(generated.model, "approved-storyboard-short-asset-plan-adapter-v10");
  assert.equal(
    generated.value.generationProfile,
    HYBRID_GENERATION_PROFILES.AIHUBMIX_VOLCENGINE_SEEDANCE_2_5_720P
  );
  assert.equal(generated.value.executionPolicy.maximumPaidCostUsd, 2.25);
  assert.deepEqual(generated.value.executionPolicy.nativeCurrencyCaps, [
    { currency: "USD", maximumAmount: 0.12 },
    { currency: "CNY", maximumAmount: 13 }
  ]);
  assert.deepEqual(
    generated.value.executionPolicy.externalApiCalls.map((call) => call.providerId),
    ["aihubmix", "volcengine-ark", "aihubmix"]
  );
  assert.deepEqual(
    generated.value.executionPolicy.externalApiCalls.map((call) => call.model),
    ["gpt-image-2", "doubao-seedance-2-5-260628", "gpt-image-2"]
  );
  const imageCalls = generated.value.executionPolicy.externalApiCalls.filter(
    (call) => call.providerId === "aihubmix"
  );
  assert.equal(imageCalls.every(
    (call) => call.requestParameters.output_format === "png"
  ), true);
  const videoCall = generated.value.executionPolicy.externalApiCalls.find(
    (call) => call.providerId === "volcengine-ark"
  );
  assert.deepEqual(videoCall.requestParameters, {
    model: "doubao-seedance-2-5-260628",
    content: [{ type: "text", text: videoCall.prompt }],
    generate_audio: false,
    ratio: "9:16",
    resolution: "720p",
    duration: 8,
    watermark: false
  });
  assert.equal(
    generated.value.executionPolicy.externalApiCalls.every(
      (call) => call.executionPreflight?.noGenerationAllowed === true
    ),
    true
  );
  assert.equal(
    generated.value.executionPolicy.externalApiCalls.every(
      (call) => call.visualContract?.schemaVersion === TECHNICAL_DIAGRAM_CONTRACT_VERSION
    ),
    true
  );
  assert.equal(imageCalls.every((call) => call.visualContract.motionPolicy === null), true);
  assert.equal(videoCall.id, "volcengine-seedance-video-mcp-flow-v3");
  assert.equal(videoCall.visualContract.kind, "technical-flow");
  assert.equal(
    videoCall.visualContract.motionPolicy.schemaVersion,
    PROGRESSIVE_KNOWLEDGE_MOTION_VERSION
  );
  assert.equal(videoCall.visualContract.motionPolicy.durationSeconds, 8);
  assert.deepEqual(videoCall.visualContract.motionPolicy.initialVisibleNodeIds, []);
  assert.equal(videoCall.visualContract.motionPolicy.retainRevealedElements, true);
  assert.equal(videoCall.visualContract.motionPolicy.allowCompleteDiagramAtStart, false);
  assert.equal(videoCall.visualContract.motionPolicy.maxNewNodesPerPhase, 1);
  assert.deepEqual(videoCall.visualContract.motionPolicy.transition, {
    schemaVersion: "technical-diagram-transition-v1",
    durationSeconds: 0.6,
    easing: "ease-in-out-smoothstep",
    bounce: false,
    arrowheadReveal: "continuous-fade"
  });
  assert.deepEqual(
    videoCall.visualContract.nodes.map((node) => node.id),
    [
      "agent-request",
      "database-query",
      "document-write",
      "mcp-protocol",
      "external-capability",
      "result"
    ]
  );
  assert.deepEqual(
    videoCall.visualContract.motionPolicy.phases.map((phase) => ({
      order: phase.order,
      kind: phase.kind,
      startSecond: phase.startSecond,
      endSecond: phase.endSecond,
      revealNodeIds: phase.revealNodeIds,
      activateEdgeIds: phase.activateEdgeIds
    })),
    [
      { order: 1, kind: "reveal", startSecond: 0, endSecond: 0.901,
        revealNodeIds: ["agent-request"], activateEdgeIds: [] },
      { order: 2, kind: "reveal", startSecond: 0.901, endSecond: 2.254,
        revealNodeIds: ["database-query"], activateEdgeIds: ["request-to-database"] },
      { order: 3, kind: "reveal", startSecond: 2.254, endSecond: 3.606,
        revealNodeIds: ["document-write"], activateEdgeIds: ["request-to-document"] },
      { order: 4, kind: "reveal", startSecond: 3.606, endSecond: 4.958,
        revealNodeIds: ["mcp-protocol"], activateEdgeIds: ["request-to-mcp"] },
      { order: 5, kind: "reveal", startSecond: 4.958, endSecond: 6.16,
        revealNodeIds: ["external-capability"], activateEdgeIds: ["mcp-to-external"] },
      { order: 6, kind: "reveal", startSecond: 6.16, endSecond: 7.211,
        revealNodeIds: ["result"],
        activateEdgeIds: ["external-to-result", "result-to-agent"] },
      { order: 7, kind: "hold", startSecond: 7.211, endSecond: 8,
        revealNodeIds: [], activateEdgeIds: [] }
    ]
  );
  assert.match(videoCall.prompt, /Begin from a clean minimal canvas/iu);
  assert.match(videoCall.prompt, /0\.0-0\.9 seconds: reveal only agent-request/iu);
  assert.match(videoCall.prompt, /7\.2-8\.0 seconds: hold the complete diagram unchanged/iu);
  assert.match(videoCall.prompt, /Do not show the complete architecture in the first frame/iu);
  assert.match(videoCall.prompt, /0\.60-second smooth ease-in\/ease-out transitions with no bounce/iu);
  assert.doesNotMatch(videoCall.prompt, /Keep five stable unlabeled rectangular modules visible/iu);
});

test("人工选择 AIHubMix 质量优先稳定模型后 Asset Agent 生成 Gemini 3 Pro Image 技术图合同且零调用", async () => {
  const episode = approvedHistoricalEpisode();
  episode.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    generationProfile:
      HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P,
    selectedBy: "human",
    feedback: "AIHubMix 内选择仍在生命周期内的质量优先生图模型"
  };
  let providerCalls = 0;
  const generated = await generateAssetPlan(episode, {
    client: {
      async generateStructured() {
        providerCalls += 1;
        throw new Error("素材计划阶段不得调用 Provider");
      }
    },
    writeArtifact: async () => ({
      version: 5,
      path: "/tmp/asset-plan-v005.json",
      relativePath: "studio/data/production/test/asset-plan-v005.json"
    })
  });
  assert.equal(providerCalls, 0);
  assert.equal(generated.requestCount, 0);
  assert.equal(
    generated.value.generationProfile,
    HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P
  );
  assert.equal(generated.value.executionPolicy.maximumPaidCostUsd, 2.35);
  assert.deepEqual(generated.value.executionPolicy.nativeCurrencyCaps, [
    { currency: "USD", maximumAmount: 0.3 },
    { currency: "CNY", maximumAmount: 13 }
  ]);
  assert.deepEqual(
    generated.value.executionPolicy.externalApiCalls.map((call) => call.model),
    ["gemini-3-pro-image", "doubao-seedance-2-5-260628", "gemini-3-pro-image"]
  );
  const imageCalls = generated.value.executionPolicy.externalApiCalls.filter(
    (call) => call.providerId === "aihubmix"
  );
  for (const call of imageCalls) {
    assert.equal(
      call.endpoint,
      "https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image:generateContent"
    );
    assert.deepEqual(call.requestParameters, {
      contents: [{ role: "user", parts: [{ text: call.prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "9:16", imageSize: "2K" }
      }
    });
    assert.equal(call.billing.estimatedAmount, 0.134);
    assert.equal(call.billing.maximumAmount, 0.15);
    assert.equal(call.visualContract.style, "ai-research-paper-system-diagram");
    assert.deepEqual(call.visualContract.sourceSceneIds, call.sceneIds);
    assert.equal(call.visualContract.sourceRequirements.length > 0, true);
    assert.equal(call.visualContract.nodes.length >= 5, true);
    assert.equal(call.visualContract.edges.length >= 4, true);
  }
  const architectureCall = imageCalls.find((call) =>
    call.visualContract.kind === "technical-architecture"
  );
  assert.match(architectureCall.prompt, /AI research-paper-style system architecture diagram/iu);
  assert.match(architectureCall.prompt, /directed branch/iu);
  assert.match(architectureCall.prompt, /No text/iu);
  assert.match(architectureCall.prompt, /abstract blobs/iu);
  assert.doesNotMatch(
    architectureCall.prompt,
    /premium vertical editorial technology illustration/iu
  );
  assert.deepEqual(
    architectureCall.visualContract.edges.map((edge) => [edge.from, edge.to]),
    [
      ["skill-knowledge", "agent"],
      ["agent", "tool-action"],
      ["agent", "mcp-protocol"],
      ["mcp-protocol", "external-capability"]
    ]
  );
});
