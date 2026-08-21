import test from "node:test";
import assert from "node:assert/strict";
import { integrityHash } from "../src/shared/integrity.mjs";
import { historicalApprovedStoryboardV3Episode } from
  "./historical-approved-storyboard-v3.fixture.mjs";
import { kernelSnapshot } from "../src/server/control/workflow-kernel.mjs";
import {
  HYBRID_GENERATION_PROFILES,
  adaptApprovedStoryboardToShortAssetPlan
} from "../src/server/production/short-asset-plan-adapter.mjs";
import {
  assetExecutionPreflightValid,
  beginAssetExecutionPreflight,
  recordAssetExecutionPreflight
} from "../src/server/reviews/asset-execution-checkpoint.mjs";
import {
  AIHUBMIX_GEMINI_COUNT_TOKENS_ENDPOINT,
  AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT,
  inspectAssetExecutionPreflight,
  probeAihubmixGeminiCredential
} from
  "../src/server/reviews/asset-execution-preflight.mjs";
import { runAssetExecutionPreflight } from
  "../src/server/reviews/asset-execution-preflight-runner.mjs";

const EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";
const PROVIDER_FACTS = Object.freeze({
  aihubmix: {
    available: true,
    modelId: "gpt-image-2",
    capabilities: ["image_generation", "llm"],
    supportedEndpoints: ["https://aihubmix.com/v1/images/generations"],
    pricingConfirmed: true,
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 30,
    checkedAt: "2026-08-14T01:30:00.000Z",
    source: "https://aihubmix.com/api/v1/models?model=gpt-image-2",
    endpointSource: "https://docs.aihubmix.com/en/api/Image-Gen"
  },
  volcengineArk: {
    available: true,
    modelId: "doubao-seedance-2-5-260628",
    supportedResolutions: ["480p", "720p"],
    pricingConfirmed: true,
    unitPriceCnyPerMillion: 70,
    checkedAt: "2026-08-14T01:30:00.000Z",
    source: "https://www.volcengine.com/docs/82379/2607688?lang=zh"
  }
});
const GEMINI_PROVIDER_FACTS = Object.freeze({
  aihubmix: {
    available: true,
    modelId: "gemini-3-pro-image",
    capabilities: ["image_generation", "multimodal_output"],
    supportedEndpoints: [
      "https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image:generateContent"
    ],
    pricingConfirmed: true,
    inputUsdPerMillion: 2,
    textOutputUsdPerMillion: 12,
    imageOutputUsdPerMillion: 120,
    approximateUsdPerImage2K: 0.134,
    lifecycleStatus: "ga",
    deprecated: false,
    shutdownDate: null,
    checkedAt: "2026-08-14T05:00:00.000Z",
    source: "https://aihubmix.com/model/gemini-3-pro-image",
    endpointSource: "https://docs.aihubmix.com/en/api/Gemini-Guides",
    lifecycleSource: "https://ai.google.dev/gemini-api/docs/deprecations"
  },
  volcengineArk: PROVIDER_FACTS.volcengineArk
});
const GEMINI_CREDENTIAL_VERIFICATION = Object.freeze({
  status: "passed",
  probeKind: "models.get",
  method: "GET",
  authScheme: "x-goog-api-key",
  endpoint: AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT,
  expectedModelId: "gemini-3-pro-image",
  responseModelId: "gemini-3-pro-image",
  supportedGenerationMethods: ["generateContent"],
  supportsGenerateContent: true,
  modelMatched: true,
  authenticated: true,
  httpStatus: 200,
  metadataRequestCount: 1,
  generationRequestCount: 0,
  responseHash: integrityHash({
    name: "models/gemini-3-pro-image",
    baseModelId: null,
    supportedGenerationMethods: ["generateContent"]
  }),
  modelEndpointBound: true,
  totalTokens: null,
  primaryAttempt: null,
  checkedAt: "2026-08-14T05:00:00.000Z"
});

function memoryStore(initialEpisode) {
  let stored = structuredClone(initialEpisode);
  const events = [];
  return {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async (event) => events.push(structuredClone(event)),
    get episode() {
      return structuredClone(stored);
    },
    events
  };
}

function approvedEpisode(base, plan, version) {
  const episode = structuredClone(base);
  const artifactPath =
    `studio/data/production/episodes/${EPISODE_ID}/asset-plan-v${String(version).padStart(3, "0")}.json`;
  const planHash = integrityHash(plan);
  const candidateHash = integrityHash({ version, artifactPath, planHash });
  episode.production.assetPlan = {
    version,
    artifactPath,
    needsRevision: false,
    content: plan,
    versions: [{ version, artifactPath }]
  };
  episode.reviewCheckpoints.assetExecution = {
    schemaVersion: 1,
    status: "approved",
    currentCandidate: {
      version,
      candidateHash,
      planHash,
      artifact: {
        path: artifactPath,
        bytes: 1,
        sha256: "a".repeat(64)
      },
      summary: {}
    },
    machineReview: {
      id: `asset-execution-review-v${String(version).padStart(3, "0")}`,
      status: "passed",
      checkedAt: "2026-08-14T01:00:00.000Z",
      candidateHash,
      checks: []
    },
    humanApproval: {
      decision: "approved",
      at: "2026-08-14T01:05:00.000Z",
      note: `批准 v${version}`,
      version,
      candidateHash,
      machineReviewId: `asset-execution-review-v${String(version).padStart(3, "0")}`,
      authorizedToolIds: [
        "aihubmix.images.generate",
        "volcengine.video.generate"
      ]
    },
    history: []
  };
  const assetStep = episode.pipeline.find((step) => step.agent === "asset-agent");
  assetStep.status = "ready";
  assetStep.requiresHuman = false;
  return episode;
}

async function hybridPlan() {
  const episode = historicalApprovedStoryboardV3Episode();
  episode.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    generationProfile:
      HYBRID_GENERATION_PROFILES.AIHUBMIX_VOLCENGINE_SEEDANCE_2_5_720P,
    selectedBy: "human"
  };
  return { episode, plan: adaptApprovedStoryboardToShortAssetPlan(episode) };
}

async function geminiHybridPlan() {
  const episode = historicalApprovedStoryboardV3Episode();
  episode.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    generationProfile:
      HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P,
    selectedBy: "human"
  };
  return { episode, plan: adaptApprovedStoryboardToShortAssetPlan(episode) };
}

test("旧 Seedance 模型与嵌入 prompt 的参数在零生成预检中技术性退回", async () => {
  const { episode: base, plan } = await hybridPlan();
  const videoCall = plan.executionPolicy.externalApiCalls.find(
    (call) => call.providerId === "volcengine-ark"
  );
  videoCall.model = "doubao-seedance-2.5";
  videoCall.requestParameters = {
    model: "doubao-seedance-2.5",
    content: [{
      type: "text",
      text: `${videoCall.prompt} --ratio 9:16 --resolution 720p --dur 8`
    }]
  };
  plan.items.find(
    (item) => item.productionMethod.externalProvider === "volcengine-ark"
  ).productionMethod.externalModel = "doubao-seedance-2.5";
  const source = approvedEpisode(base, plan, 3);
  const store = memoryStore(source);
  const started = await beginAssetExecutionPreflight(EPISODE_ID, {
    candidateHash: source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
  }, { ...store, now: "2026-08-14T01:09:00.000Z", runId: "test-preflight-v3-invalid" });
  const report = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: started.run.runId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: false },
    providerFacts: PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 0,
    now: "2026-08-14T01:10:00.000Z"
  });
  assert.equal(report.status, "blocked");
  assert.equal(report.generationRequestCount, 0);
  assert.equal(report.credentialPresence.AIHUBMIX_API_KEY, true);
  assert.equal(report.credentialPresence.ARK_API_KEY, false);
  assert.equal(report.checks.find(
    (check) => check.id === "ark-credential-presence"
  ).passed, false);
  assert.equal(report.checks.find(
    (check) => check.id === "seedance-request-contract"
  ).passed, false);
  assert.equal(JSON.stringify(report).includes("Bearer "), false);

  const recorded = await recordAssetExecutionPreflight(EPISODE_ID, report, {
    ...store,
    now: "2026-08-14T01:10:00.000Z"
  });
  assert.equal(recorded.checkpoint.status, "blocked");
  assert.equal(recorded.checkpoint.humanApproval.decision, "approved");
  assert.equal(store.episode.production.assetPlan.needsRevision, true);
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "asset-agent"
  ).status, "ready");
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "voice-agent"
  ).status, "pending");
  assert.equal(store.events.at(-1).type, "asset-execution.preflight_failed");
});

test("修正后的 v4 在凭据和官方事实齐备时通过零生成预检并绑定批准候选", async () => {
  const { episode: base, plan } = await hybridPlan();
  const source = approvedEpisode(base, plan, 4);
  assert.equal(assetExecutionPreflightValid(source), false);
  const store = memoryStore(source);
  const started = await beginAssetExecutionPreflight(EPISODE_ID, {
    candidateHash: source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
  }, { ...store, now: "2026-08-14T01:19:00.000Z", runId: "test-preflight-v4-pass" });
  const report = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: started.run.runId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    providerFacts: PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 0,
    now: "2026-08-14T01:20:00.000Z"
  });
  assert.equal(report.status, "passed");
  assert.equal(report.checks.every((check) => check.passed), true);

  await recordAssetExecutionPreflight(EPISODE_ID, report, {
    ...store,
    now: "2026-08-14T01:20:00.000Z"
  });
  assert.equal(store.episode.reviewCheckpoints.assetExecution.status, "approved");
  assert.equal(assetExecutionPreflightValid(store.episode), true);
  assert.equal(store.events.at(-1).type, "asset-execution.preflight_passed");
});

test("Gemini 3 Pro Image v5 只在稳定生命周期、精确请求与价格事实全部匹配时通过预检", async () => {
  const { episode: base, plan } = await geminiHybridPlan();
  const source = approvedEpisode(base, plan, 5);
  const passed = inspectAssetExecutionPreflight(source, {
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    credentialVerification: { aihubmix: GEMINI_CREDENTIAL_VERIFICATION },
    providerFacts: GEMINI_PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 3,
    now: "2026-08-14T05:01:00.000Z"
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.schemaVersion, 4);
  assert.equal(passed.checks.every((check) => check.passed), true);

  const deprecatedFacts = structuredClone(GEMINI_PROVIDER_FACTS);
  deprecatedFacts.aihubmix.lifecycleStatus = "deprecated";
  deprecatedFacts.aihubmix.deprecated = true;
  deprecatedFacts.aihubmix.shutdownDate = "2026-08-17";
  const deprecated = inspectAssetExecutionPreflight(source, {
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    credentialVerification: { aihubmix: GEMINI_CREDENTIAL_VERIFICATION },
    providerFacts: deprecatedFacts,
    generationRequestCount: 0,
    now: "2026-08-14T05:02:00.000Z"
  });
  assert.equal(deprecated.status, "blocked");
  assert.equal(deprecated.blockerDisposition, "revision_required");
  assert.deepEqual(
    deprecated.checks.filter((check) => !check.passed).map((check) => check.id),
    ["aihubmix-model-lifecycle"]
  );

  const driftedPlan = structuredClone(plan);
  driftedPlan.executionPolicy.externalApiCalls.find(
    (call) => call.providerId === "aihubmix"
  ).requestParameters.generationConfig.imageConfig.aspectRatio = "1:1";
  const drifted = inspectAssetExecutionPreflight(approvedEpisode(base, driftedPlan, 5), {
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    credentialVerification: { aihubmix: GEMINI_CREDENTIAL_VERIFICATION },
    providerFacts: GEMINI_PROVIDER_FACTS,
    generationRequestCount: 0,
    now: "2026-08-14T05:03:00.000Z"
  });
  assert.equal(drifted.status, "blocked");
  assert.equal(drifted.checks.find(
    (check) => check.id === "aihubmix-request-contract"
  ).passed, false);
});

test("新的 Gemini 零生成预检开始时先撤权，仅 v4 成功报告恢复已批准工具", async () => {
  const { episode: base, plan } = await geminiHybridPlan();
  const source = approvedEpisode(base, plan, 5);
  source.control.allowedTools = [
    "aihubmix.images.generate",
    "volcengine.video.generate"
  ];
  source.production.assetExecutionPreflight = {
    schemaVersion: 2,
    status: "passed",
    blockerDisposition: null,
    candidateHash: source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash,
    version: 5,
    generationRequestCount: 0,
    metadataRequestCount: 0,
    checks: [{ id: "legacy-static-facts", passed: true }],
    reportHash: "legacy-v2-report"
  };
  assert.equal(assetExecutionPreflightValid(source), false);

  const store = memoryStore(source);
  const candidateHash = source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash;
  await beginAssetExecutionPreflight(EPISODE_ID, { candidateHash }, {
    ...store,
    now: "2026-08-14T05:04:00.000Z"
  });
  assert.equal(store.episode.production.assetExecutionPreflight, null);
  assert.deepEqual(store.episode.control.allowedTools, []);
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "asset-agent"
  ).status, "blocked");
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "asset-agent"
  ).requiresHuman, false);
  assert.equal(store.events.at(-1).type, "asset-execution.preflight_started");

  const report = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: store.episode.production.assetExecutionPreflightRun.runId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    credentialVerification: { aihubmix: GEMINI_CREDENTIAL_VERIFICATION },
    providerFacts: GEMINI_PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 1,
    now: "2026-08-14T05:05:00.000Z"
  });
  assert.equal(report.status, "passed");
  await recordAssetExecutionPreflight(EPISODE_ID, report, {
    ...store,
    now: "2026-08-14T05:05:00.000Z"
  });
  assert.equal(assetExecutionPreflightValid(store.episode), true);
  assert.deepEqual(store.episode.control.allowedTools.sort(), [
    "aihubmix.images.generate",
    "volcengine.video.generate"
  ]);
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "asset-agent"
  ).status, "ready");
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "asset-agent"
  ).requiresHuman, false);
});

test("Gemini 凭据只通过元数据或 countTokens 验证，401 与网络不确定均不触发生成", async () => {
  const requests = [];
  const passed = await probeAihubmixGeminiCredential({
    credential: "test-only-key",
    fetch: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            name: "models/gemini-3-pro-image",
            supportedGenerationMethods: ["generateContent"]
          };
        }
      };
    },
    now: "2026-08-14T05:10:00.000Z"
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.authenticated, true);
  assert.equal(passed.generationRequestCount, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT);
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.body, undefined);
  assert.equal(requests[0].init.headers["x-goog-api-key"], "test-only-key");
  assert.equal(requests[0].init.headers.accept, "application/json");
  assert.equal(requests[0].init.redirect, "error");

  const fallbackRequests = [];
  const countTokens = await probeAihubmixGeminiCredential({
    credential: "count-token-test-key",
    fetch: async (url, init) => {
      fallbackRequests.push({ url, init });
      if (fallbackRequests.length === 1) return { ok: false, status: 404 };
      return {
        ok: true,
        status: 200,
        async json() {
          return { totalTokens: 2 };
        }
      };
    },
    now: "2026-08-14T05:10:30.000Z"
  });
  assert.equal(countTokens.status, "passed");
  assert.equal(countTokens.probeKind, "countTokens");
  assert.equal(countTokens.authenticated, true);
  assert.equal(countTokens.metadataRequestCount, 2);
  assert.equal(countTokens.generationRequestCount, 0);
  assert.equal(countTokens.totalTokens, 2);
  assert.deepEqual(fallbackRequests.map((item) => ({
    url: item.url,
    method: item.init.method,
    hasBody: item.init.body !== undefined
  })), [
    {
      url: AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT,
      method: "GET",
      hasBody: false
    },
    {
      url: AIHUBMIX_GEMINI_COUNT_TOKENS_ENDPOINT,
      method: "POST",
      hasBody: true
    }
  ]);
  assert.deepEqual(JSON.parse(fallbackRequests[1].init.body), {
    contents: [{ role: "user", parts: [{ text: "preflight" }] }]
  });

  const rejected = await probeAihubmixGeminiCredential({
    credential: "rejected-test-key",
    fetch: async () => ({ ok: false, status: 401 }),
    now: "2026-08-14T05:11:00.000Z"
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.authenticated, false);
  assert.equal(rejected.httpStatus, 401);
  assert.equal(rejected.generationRequestCount, 0);

  const ambiguous = await probeAihubmixGeminiCredential({
    credential: "network-test-key",
    fetch: async () => {
      throw new Error("network unavailable");
    },
    now: "2026-08-14T05:12:00.000Z"
  });
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.authenticated, null);
  assert.equal(ambiguous.generationRequestCount, 0);
  assert.equal(JSON.stringify([passed, countTokens, rejected, ambiguous])
    .includes("test-only-key"), false);
  assert.equal(JSON.stringify([passed, countTokens, rejected, ambiguous])
    .includes("count-token-test-key"), false);
});

test("Gemini 元数据鉴权 401 只要求人工更新凭据，不会技术性废弃 v5", async () => {
  const { episode: base, plan } = await geminiHybridPlan();
  const source = approvedEpisode(base, plan, 5);
  const rejectedVerification = {
    ...GEMINI_CREDENTIAL_VERIFICATION,
    status: "rejected",
    responseModelId: null,
    modelMatched: false,
    authenticated: false,
    httpStatus: 401
  };
  const report = inspectAssetExecutionPreflight(source, {
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    credentialVerification: { aihubmix: rejectedVerification },
    providerFacts: GEMINI_PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 1,
    now: "2026-08-14T05:13:00.000Z"
  });
  assert.equal(report.status, "blocked");
  assert.equal(report.blockerDisposition, "input_required");
  assert.deepEqual(
    report.checks.filter((item) => !item.passed).map((item) => item.id),
    ["aihubmix-credential-authentication"]
  );
  assert.equal(JSON.stringify(report).includes("rejected-test-key"), false);
});

test("AIHubMix 未明确支持批准的文字生图端点时技术性退回 Asset Agent", async () => {
  const { episode: base, plan } = await hybridPlan();
  const source = approvedEpisode(base, plan, 4);
  const providerFacts = structuredClone(PROVIDER_FACTS);
  providerFacts.aihubmix.supportedEndpoints = ["https://aihubmix.com/v1/images/edits"];
  providerFacts.aihubmix.endpointSource = "https://docs.aihubmix.com/en/api/Image-Gen";
  const store = memoryStore(source);
  const started = await beginAssetExecutionPreflight(EPISODE_ID, {
    candidateHash: source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
  }, { ...store, now: "2026-08-14T03:19:00.000Z", runId: "test-preflight-endpoint-drift" });
  const report = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: started.run.runId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    providerFacts,
    generationRequestCount: 0,
    metadataRequestCount: 0,
    now: "2026-08-14T03:20:00.000Z"
  });
  assert.equal(report.status, "blocked");
  assert.equal(report.blockerDisposition, "revision_required");
  assert.deepEqual(
    report.checks.filter((check) => !check.passed).map((check) => check.id),
    ["aihubmix-generation-endpoint-availability"]
  );

  const recorded = await recordAssetExecutionPreflight(EPISODE_ID, report, {
    ...store,
    now: "2026-08-14T03:20:00.000Z"
  });
  assert.equal(recorded.checkpoint.status, "blocked");
  assert.equal(store.episode.production.assetPlan.needsRevision, true);
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "asset-agent"
  ).status, "ready");
  assert.equal(store.events.at(-1).type, "asset-execution.preflight_failed");
});

test("v4 只缺 ARK 凭据时保留批准方案等待人工输入，补齐后同一候选可通过", async () => {
  const { episode: base, plan } = await hybridPlan();
  const source = approvedEpisode(base, plan, 4);
  const store = memoryStore(source);
  const firstRun = await beginAssetExecutionPreflight(EPISODE_ID, {
    candidateHash: source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
  }, { ...store, now: "2026-08-14T01:21:00.000Z", runId: "test-preflight-v4-missing-ark" });
  const blocked = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: firstRun.run.runId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: false },
    providerFacts: PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 0,
    now: "2026-08-14T01:22:00.000Z"
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.blockerDisposition, "input_required");
  assert.deepEqual(
    blocked.checks.filter((check) => !check.passed).map((check) => check.id),
    ["ark-credential-presence"]
  );

  const waiting = await recordAssetExecutionPreflight(EPISODE_ID, blocked, {
    ...store,
    now: "2026-08-14T01:22:00.000Z"
  });
  assert.equal(waiting.checkpoint.status, "approved");
  assert.equal(waiting.checkpoint.humanApproval.decision, "approved");
  assert.equal(store.episode.production.assetPlan.needsRevision, false);
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "asset-agent"
  ).requiresHuman, true);
  assert.equal(kernelSnapshot(store.episode).legalActions.some(
    (action) => action.action === "wait_for_input" && action.workerId === "asset-agent"
  ), true);
  assert.equal(store.events.at(-1).type, "asset-execution.preflight_input_required");

  const secondRun = await beginAssetExecutionPreflight(EPISODE_ID, {
    candidateHash: source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
  }, { ...store, now: "2026-08-14T01:22:30.000Z", runId: "test-preflight-v4-ark-ready" });
  const passed = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: secondRun.run.runId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    providerFacts: PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 0,
    now: "2026-08-14T01:23:00.000Z"
  });
  assert.equal(passed.status, "passed");
  await recordAssetExecutionPreflight(EPISODE_ID, passed, {
    ...store,
    now: "2026-08-14T01:23:00.000Z"
  });
  assert.equal(assetExecutionPreflightValid(store.episode), true);
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "asset-agent"
  ).status, "ready");
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "asset-agent"
  ).requiresHuman, false);
});

test("预检报告只接受零生成请求并拒绝篡改后的报告哈希", async () => {
  const { episode: base, plan } = await hybridPlan();
  const source = approvedEpisode(base, plan, 4);
  const store = memoryStore(source);
  const started = await beginAssetExecutionPreflight(EPISODE_ID, {
    candidateHash: source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
  }, { ...store, now: "2026-08-14T01:24:00.000Z", runId: "test-preflight-tamper" });
  const report = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: started.run.runId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    providerFacts: PROVIDER_FACTS,
    generationRequestCount: 0,
    now: "2026-08-14T01:25:00.000Z"
  });
  report.generationRequestCount = 1;
  await assert.rejects(
    recordAssetExecutionPreflight(EPISODE_ID, report, store),
    (error) => error.code === "asset_execution_preflight_invalid"
  );
  assert.equal(store.events.length, 1);
  assert.equal(store.events[0].type, "asset-execution.preflight_started");
});

test("未先 begin、错误 runId 或缺失完整检查集的报告都不能恢复生成工具", async () => {
  const { episode: base, plan } = await geminiHybridPlan();
  const source = approvedEpisode(base, plan, 5);
  source.control.allowedTools = [];
  const forged = inspectAssetExecutionPreflight(source, {
    preflightRunId: "forged-run-without-begin",
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    credentialVerification: { aihubmix: GEMINI_CREDENTIAL_VERIFICATION },
    providerFacts: GEMINI_PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 1,
    now: "2026-08-14T05:30:00.000Z"
  });
  const store = memoryStore(source);
  await assert.rejects(
    recordAssetExecutionPreflight(EPISODE_ID, forged, store),
    (error) => error.code === "asset_execution_preflight_run_conflict"
  );
  assert.deepEqual(store.episode.control.allowedTools, []);

  const started = await beginAssetExecutionPreflight(EPISODE_ID, {
    candidateHash: source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
  }, { ...store, now: "2026-08-14T05:31:00.000Z", runId: "trusted-current-run" });
  const wrongRun = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: "stale-other-run",
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    credentialVerification: { aihubmix: GEMINI_CREDENTIAL_VERIFICATION },
    providerFacts: GEMINI_PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 1,
    now: "2026-08-14T05:32:00.000Z"
  });
  await assert.rejects(
    recordAssetExecutionPreflight(EPISODE_ID, wrongRun, store),
    (error) => error.code === "asset_execution_preflight_run_conflict"
  );
  assert.equal(started.run.runId, "trusted-current-run");

  const incomplete = inspectAssetExecutionPreflight(store.episode, {
    preflightRunId: started.run.runId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    credentialVerification: { aihubmix: GEMINI_CREDENTIAL_VERIFICATION },
    providerFacts: GEMINI_PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: 1,
    now: "2026-08-14T05:33:00.000Z"
  });
  incomplete.checks = [];
  delete incomplete.reportHash;
  incomplete.reportHash = integrityHash(incomplete);
  await assert.rejects(
    recordAssetExecutionPreflight(EPISODE_ID, incomplete, store),
    (error) => error.code === "asset_execution_preflight_invalid"
  );
  assert.deepEqual(store.episode.control.allowedTools, []);
});

test("正式预检 runner 在 GET 404 时只回退 countTokens，并在同一 runId 中完成撤权与恢复", async () => {
  const { episode: base, plan } = await geminiHybridPlan();
  const source = approvedEpisode(base, plan, 5);
  source.control.allowedTools = [
    "aihubmix.images.generate",
    "volcengine.video.generate"
  ];
  const store = memoryStore(source);
  const requests = [];
  const result = await runAssetExecutionPreflight(EPISODE_ID, {
    candidateHash: source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
  }, {
    ...store,
    credentials: {
      AIHUBMIX_API_KEY: "runner-test-key",
      ARK_API_KEY: "runner-ark-key"
    },
    fetch: async (url, init) => {
      requests.push({ url, method: init.method, hasBody: init.body !== undefined });
      if (url === AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT) {
        return { ok: false, status: 404 };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { totalTokens: 2 };
        }
      };
    },
    providerFacts: GEMINI_PROVIDER_FACTS,
    now: "2026-08-14T05:34:00.000Z",
    runId: "runner-bound-preflight"
  });
  assert.deepEqual(requests, [
    {
      url: AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT,
      method: "GET",
      hasBody: false
    },
    {
      url: AIHUBMIX_GEMINI_COUNT_TOKENS_ENDPOINT,
      method: "POST",
      hasBody: true
    }
  ]);
  assert.equal(result.report.status, "passed");
  assert.equal(result.report.preflightRunId, "runner-bound-preflight");
  assert.equal(result.report.metadataRequestCount, 2);
  assert.equal(result.report.generationRequestCount, 0);
  assert.equal(result.run.status, "completed");
  assert.equal(assetExecutionPreflightValid(store.episode), true);
  assert.equal(JSON.stringify(result).includes("runner-test-key"), false);
});

test("正式预检 runner 收到 401 时保留候选批准、撤销工具并等待人工更新凭据", async () => {
  const { episode: base, plan } = await geminiHybridPlan();
  const source = approvedEpisode(base, plan, 5);
  source.control.allowedTools = [
    "aihubmix.images.generate",
    "volcengine.video.generate"
  ];
  const store = memoryStore(source);
  let requestCount = 0;
  const result = await runAssetExecutionPreflight(EPISODE_ID, {
    candidateHash: source.reviewCheckpoints.assetExecution.currentCandidate.candidateHash
  }, {
    ...store,
    credentials: {
      AIHUBMIX_API_KEY: "runner-rejected-key",
      ARK_API_KEY: "runner-ark-key"
    },
    fetch: async () => {
      requestCount += 1;
      return { ok: false, status: 401 };
    },
    providerFacts: GEMINI_PROVIDER_FACTS,
    now: "2026-08-14T05:35:00.000Z",
    runId: "runner-rejected-preflight"
  });
  assert.equal(requestCount, 1);
  assert.equal(result.report.status, "blocked");
  assert.equal(result.report.blockerDisposition, "input_required");
  assert.equal(result.report.generationRequestCount, 0);
  assert.equal(result.checkpoint.status, "approved");
  assert.equal(result.checkpoint.humanApproval.decision, "approved");
  assert.equal(store.episode.production.assetPlan.needsRevision, false);
  assert.deepEqual(store.episode.control.allowedTools, []);
  assert.equal(store.episode.pipeline.find(
    (step) => step.agent === "asset-agent"
  ).requiresHuman, true);
  assert.equal(JSON.stringify(result).includes("runner-rejected-key"), false);
});
