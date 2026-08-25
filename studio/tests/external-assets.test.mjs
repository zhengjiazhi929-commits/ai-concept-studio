import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { episodePublicDirectory, publicRoot } from "../src/shared/paths.mjs";
import { integrityHash } from "../src/shared/integrity.mjs";
import {
  validateApprovedExternalAssetReceipt,
  validateAssetRights
} from "../src/shared/asset-rights.mjs";
import { historicalApprovedStoryboardV3Episode } from
  "./historical-approved-storyboard-v3.fixture.mjs";
import { validateWorkerMutation } from "../src/shared/agent-contracts.mjs";
import { agents } from "../src/server/agents/registry.mjs";
import { createCapabilityAuthority } from
  "../src/server/security/side-effect-capability.mjs";
import {
  HYBRID_GENERATION_PROFILES
} from "../src/server/production/short-asset-plan-adapter.mjs";
import { adaptStoryboardWithSyntheticExternalRights } from
  "./synthetic-external-rights.fixture.mjs";
import {
  AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT,
  inspectAssetExecutionPreflight
} from "../src/server/reviews/asset-execution-preflight.mjs";
import {
  EXTERNAL_ASSET_TOOL_IDS,
  adjudicateAmbiguousExternalAssetReceipt,
  buildApprovedExternalAssets,
  executeApprovedExternalAssetCall,
  requiredExternalAssetToolIds
} from "../src/server/production/external-assets.mjs";
import { inspectLocalCodeImplementation } from
  "../src/server/production/local-code-implementation.mjs";
import { validateAssetsForReview } from
  "../src/server/reviews/validators/assets.mjs";

const EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("safe-test-png")
]);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypmp42safe-test-video")
]);
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];
const PROVIDER_FACTS = {
  aihubmix: {
    available: true,
    modelId: "gpt-image-2",
    capabilities: ["image_generation"],
    supportedEndpoints: ["https://aihubmix.com/v1/images/generations"],
    pricingConfirmed: true,
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 30,
    checkedAt: "2026-08-14T02:40:00.000Z",
    source: "https://aihubmix.com/models?lang=en",
    endpointSource: "https://docs.aihubmix.com/en/api/Image-Gen"
  },
  volcengineArk: {
    available: true,
    modelId: "doubao-seedance-2-5-260628",
    supportedResolutions: ["480p", "720p"],
    pricingConfirmed: true,
    unitPriceCnyPerMillion: 70,
    checkedAt: "2026-08-14T02:40:00.000Z",
    source: "https://docs.volcengine.com/docs/82379/2607688?lang=zh"
  }
};
const GEMINI_PROVIDER_FACTS = {
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
};
const GEMINI_CREDENTIAL_VERIFICATION = {
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
};

function jsonResponse(value, status = 200) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body))
    }
  });
}

function binaryResponse(value, status = 200) {
  return new Response(value, {
    status,
    headers: { "content-length": String(value.length) }
  });
}

function abortingFetch(init = {}) {
  assert.ok(init.signal instanceof AbortSignal);
  return new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
}

async function approvedEpisode(options = {}) {
  const episode = historicalApprovedStoryboardV3Episode();
  const generationProfile = options.generationProfile ??
    HYBRID_GENERATION_PROFILES.AIHUBMIX_VOLCENGINE_SEEDANCE_2_5_720P;
  episode.production.assetPlanDirection = {
    strategy: "hybrid-api-selective",
    generationProfile,
    selectedBy: "human"
  };
  const plan = adaptStoryboardWithSyntheticExternalRights(episode);
  const version = options.version ?? 4;
  const artifactPath =
    `studio/data/production/episodes/${EPISODE_ID}/asset-plan-v${String(version).padStart(3, "0")}.json`;
  const planHash = integrityHash(plan);
  const localCodeImplementation = await inspectLocalCodeImplementation();
  const candidateHash = integrityHash({
    artifactPath,
    planHash,
    version,
    localCodeImplementation
  });
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
      artifact: { path: artifactPath, bytes: 1, sha256: "a".repeat(64) },
      localCodeImplementation,
      summary: {}
    },
    machineReview: {
      id: `asset-execution-review-v${String(version).padStart(3, "0")}-test`,
      status: "passed",
      checkedAt: "2026-08-14T02:35:00.000Z",
      candidateHash,
      checks: []
    },
    humanApproval: {
      decision: "approved",
      at: "2026-08-14T02:36:00.000Z",
      note: "测试批准",
      version,
      candidateHash,
      machineReviewId: `asset-execution-review-v${String(version).padStart(3, "0")}-test`,
      authorizedToolIds: [...Object.values(EXTERNAL_ASSET_TOOL_IDS)]
    },
    history: []
  };
  episode.control.allowedTools = [...Object.values(EXTERNAL_ASSET_TOOL_IDS)];
  episode.assets = [];
  const isGemini = generationProfile ===
    HYBRID_GENERATION_PROFILES
      .AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P;
  const preflightRunId = `test-external-assets-preflight-v${version}`;
  episode.production.assetExecutionPreflight = inspectAssetExecutionPreflight(episode, {
    preflightRunId,
    credentialPresence: { AIHUBMIX_API_KEY: true, ARK_API_KEY: true },
    ...(isGemini
      ? { credentialVerification: { aihubmix: GEMINI_CREDENTIAL_VERIFICATION } }
      : {}),
    providerFacts: options.providerFacts ?? PROVIDER_FACTS,
    generationRequestCount: 0,
    metadataRequestCount: isGemini ? 1 : 0,
    now: "2026-08-14T02:40:00.000Z"
  });
  episode.production.assetExecutionPreflightRun = {
    schemaVersion: 1,
    runId: preflightRunId,
    status: "completed",
    candidateHash,
    version,
    startedAt: "2026-08-14T02:39:00.000Z",
    completedAt: "2026-08-14T02:40:00.000Z",
    reportHash: episode.production.assetExecutionPreflight.reportHash,
    disposition: null,
    generationRequestCount: 0
  };
  return episode;
}

function trustedExternalDirectory(episode) {
  const candidateHash = episode.reviewCheckpoints.assetExecution.currentCandidate.candidateHash;
  return resolve(
    episodePublicDirectory(episode.id),
    "generated-assets",
    candidateHash.slice(0, 16)
  );
}

test("外部素材执行必须同时绑定批准、预检、Worker 工具和精确请求体", async () => {
  const episode = await approvedEpisode();
  const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];
  const requests = [];
  const result = await executeApprovedExternalAssetCall(episode, {
    itemId: "generated-architecture-depth-plate",
    callId: call.id
  }, {
    allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
    credentials: { AIHUBMIX_API_KEY: "test-only-key" },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
    }
  });
  assert.equal(result.type, "image");
  assert.deepEqual(result.data, PNG);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, call.endpoint);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    ...call.requestParameters,
    prompt: call.prompt
  });
  assert.equal(requests[0].init.headers.authorization, "Bearer test-only-key");

  const withoutPreflight = structuredClone(episode);
  delete withoutPreflight.production.assetExecutionPreflight;
  await assert.rejects(
    executeApprovedExternalAssetCall(withoutPreflight, {
      itemId: "generated-architecture-depth-plate",
      callId: call.id
    }, {
      allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
      credentials: { AIHUBMIX_API_KEY: "test-only-key" },
      fetch: async () => {
        throw new Error("不应请求 Provider");
      }
    }),
    (error) => error.code === "asset_execution_preflight_required"
  );

  const withoutHumanToolScope = structuredClone(episode);
  withoutHumanToolScope.reviewCheckpoints.assetExecution
    .humanApproval.authorizedToolIds = [];
  await assert.rejects(
    executeApprovedExternalAssetCall(withoutHumanToolScope, {
      itemId: "generated-architecture-depth-plate",
      callId: call.id
    }, {
      allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
      credentials: { AIHUBMIX_API_KEY: "test-only-key" },
      fetch: async () => {
        throw new Error("不应请求 Provider");
      }
    }),
    (error) => error.code === "asset_execution_preflight_required"
  );
});

test("外部权利声明缺失或在批准后篡改时零 fetch、零付费失败关闭", async () => {
  const episode = await approvedEpisode();
  const originalCall = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];

  for (const testCase of [
    {
      name: "missing",
      expectedCode: "external_asset_rights_declaration_required",
      mutate(call) {
        delete call.rightsDeclaration;
      }
    },
    {
      name: "approval binding tampered",
      expectedCode: "asset_execution_preflight_required",
      mutate(call) {
        call.rightsDeclaration.license = "synthetic-test-fixture-tampered-after-approval";
      }
    }
  ]) {
    const changed = structuredClone(episode);
    const changedCall = changed.production.assetPlan.content.executionPolicy.externalApiCalls[0];
    testCase.mutate(changedCall);
    let fetches = 0;
    await assert.rejects(
      executeApprovedExternalAssetCall(changed, {
        itemId: "generated-architecture-depth-plate",
        callId: originalCall.id
      }, {
        allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
        credentials: { AIHUBMIX_API_KEY: "test-only-key" },
        fetch: async () => {
          fetches += 1;
          throw new Error(`fetch must not run for ${testCase.name}`);
        }
      }),
      (error) => error.code === testCase.expectedCode
    );
    assert.equal(fetches, 0);
  }
});

test("外部付费素材每次 POST 前原子消费 Capability 的 calls 与 cost", async () => {
  const episode = await approvedEpisode();
  const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];
  const operation = "worker:asset-agent";
  const scopes = ["network.request", "paid.invoke"];
  const perAttemptCost = Number(call.maximumCostUsd.toFixed(6));
  const maximumCost = Number((perAttemptCost * 2).toFixed(6));
  const authority = createCapabilityAuthority({
    secret: "external-asset-capability-test-secret-at-least-thirty-two-bytes",
    maximumCalls: 2,
    maximumCostUsd: maximumCost
  });
  const request = {
    itemId: "generated-architecture-depth-plate",
    callId: call.id
  };
  const baseOptions = {
    allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
    credentials: { AIHUBMIX_API_KEY: "test-only-key" },
    capabilityOperation: operation,
    requireSideEffectCapability: true
  };

  const directSpecs = [];
  let directAuthorityFetches = 0;
  await executeApprovedExternalAssetCall(episode, request, {
    ...baseOptions,
    authorizeSideEffect(spec) {
      directSpecs.push(structuredClone(spec));
      return authority.authorize(spec);
    },
    fetch: async () => {
      directAuthorityFetches += 1;
      return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
    }
  });
  assert.equal(directAuthorityFetches, 1);
  assert.deepEqual(directSpecs, [{
    episodeId: episode.id,
    operation,
    scopes,
    maxCalls: 1,
    maxCostUsd: perAttemptCost
  }]);

  let callLimitedFetches = 0;
  const callLimitedGrant = authority.authorize({
    episodeId: episode.id,
    operation,
    scopes,
    maxCalls: 1,
    maxCostUsd: maximumCost
  });
  const callLimitedOptions = {
    ...baseOptions,
    sideEffectGrant: callLimitedGrant,
    fetch: async () => {
      callLimitedFetches += 1;
      return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
    }
  };
  await executeApprovedExternalAssetCall(episode, request, callLimitedOptions);
  await assert.rejects(
    executeApprovedExternalAssetCall(episode, request, callLimitedOptions),
    (error) => error.code === "side_effect_capability_calls_exceeded"
  );
  assert.equal(callLimitedFetches, 1);

  let costLimitedFetches = 0;
  const costLimitedGrant = authority.authorize({
    episodeId: episode.id,
    operation,
    scopes,
    maxCalls: 2,
    maxCostUsd: perAttemptCost
  });
  const costLimitedOptions = {
    ...baseOptions,
    sideEffectGrant: costLimitedGrant,
    fetch: async () => {
      costLimitedFetches += 1;
      return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
    }
  };
  await executeApprovedExternalAssetCall(episode, request, costLimitedOptions);
  await assert.rejects(
    executeApprovedExternalAssetCall(episode, request, costLimitedOptions),
    (error) => error.code === "side_effect_capability_cost_exceeded"
  );
  assert.equal(costLimitedFetches, 1);
});

test("Gemini 3 Pro Image 执行器原样发送已批准 JSON 并解析原生图像响应", async () => {
  const episode = await approvedEpisode({
    generationProfile:
      HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P,
    providerFacts: GEMINI_PROVIDER_FACTS,
    version: 5
  });
  const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls.find(
    (item) => item.providerId === "aihubmix"
  );
  const requests = [];
  const result = await executeApprovedExternalAssetCall(episode, {
    itemId: "generated-architecture-depth-plate",
    callId: call.id
  }, {
    allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
    credentials: { AIHUBMIX_API_KEY: "test-only-key" },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        candidates: [{
          content: {
            parts: [{ inlineData: { mimeType: "image/png", data: PNG.toString("base64") } }]
          }
        }]
      });
    }
  });
  assert.deepEqual(result.data, PNG);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, call.endpoint);
  assert.deepEqual(JSON.parse(requests[0].init.body), call.requestParameters);
  assert.equal(Object.hasOwn(JSON.parse(requests[0].init.body), "prompt"), false);
  assert.equal(requests[0].init.headers["x-goog-api-key"], "test-only-key");
  assert.equal(Object.hasOwn(requests[0].init.headers, "authorization"), false);
});

test("明确的 401 鉴权拒绝写入可恢复收据，下一次显式运行才允许重试", async () => {
  const episode = await approvedEpisode();
  const directory = await mkdtemp(resolve(publicRoot, "external-rejected-test-"));
  let phase = "rejected";
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ phase, url, method: init.method ?? "GET" });
    if (phase === "rejected") return jsonResponse({}, 401);
    if (url === "https://aihubmix.com/v1/images/generations") {
      return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
    }
    if (url.endsWith("/contents/generations/tasks") && init.method === "POST") {
      return jsonResponse({ id: "task-retry-safe" });
    }
    if (url.endsWith("/tasks/task-retry-safe")) {
      return jsonResponse({
        status: "succeeded",
        content: { video_url: "https://media.example.com/retry-safe.mp4" },
        usage: { completion_tokens: 172800 }
      });
    }
    if (url === "https://media.example.com/retry-safe.mp4") return binaryResponse(MP4);
    throw new Error(`unexpected request: ${url}`);
  };
  const options = {
    outputDirectory: directory,
    publicPrefix: "episodes/test/generated-assets/retry-safe",
    allowedToolIds: requiredExternalAssetToolIds(episode),
    credentials: {
      AIHUBMIX_API_KEY: "rejected-test-key",
      ARK_API_KEY: "video-test-key"
    },
    fetch,
    lookupImpl: PUBLIC_LOOKUP,
    sleep: async () => {},
    pollIntervalMs: 0,
    maxPollAttempts: 2,
    now: "2026-08-14T05:20:00.000Z"
  };
  try {
    await assert.rejects(
      buildApprovedExternalAssets(episode, options),
      (error) => error.code === "external_asset_provider_http_error" &&
        error.status === 401 && error.requiresHuman === true
    );
    assert.equal(requests.length, 1);
    const receiptPath = resolve(
      directory,
      "generated-architecture-depth-plate.receipt.json"
    );
    const rejected = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.retrySafe, true);
    assert.equal(rejected.providerHttpStatus, 401);
    assert.equal(rejected.submittedAt, null);
    assert.equal(rejected.providerExecutionId, null);
    assert.equal(JSON.stringify(rejected).includes("rejected-test-key"), false);

    phase = "success";
    const completed = await buildApprovedExternalAssets(episode, options);
    assert.equal(completed.assets.length, 3);
    assert.equal(completed.executedCalls, 3);
    const finalReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(finalReceipt.status, "completed");
    assert.equal(finalReceipt.attempt, 2);
    assert.deepEqual(finalReceipt.history.map((entry) => entry.status), ["rejected"]);
    assert.equal(requests.filter((request) =>
      request.url === "https://aihubmix.com/v1/images/generations"
    ).length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("明确的 403 也只标记当前未提交请求为 retry-safe", async () => {
  const episode = await approvedEpisode();
  const directory = await mkdtemp(resolve(publicRoot, "external-403-test-"));
  let requests = 0;
  try {
    await assert.rejects(
      buildApprovedExternalAssets(episode, {
        outputDirectory: directory,
        publicPrefix: "episodes/test/generated-assets/403",
        allowedToolIds: requiredExternalAssetToolIds(episode),
        credentials: { AIHUBMIX_API_KEY: "forbidden-test-key", ARK_API_KEY: "ark-test-key" },
        fetch: async () => {
          requests += 1;
          return jsonResponse({}, 403);
        },
        now: "2026-08-14T05:20:30.000Z"
      }),
      (error) => error.code === "external_asset_provider_http_error" &&
        error.status === 403 && error.explicitProviderRejection === true
    );
    assert.equal(requests, 1);
    const receipt = JSON.parse(await readFile(resolve(
      directory,
      "generated-architecture-depth-plate.receipt.json"
    ), "utf8"));
    assert.equal(receipt.status, "rejected");
    assert.equal(receipt.retrySafe, true);
    assert.equal(receipt.providerHttpStatus, 403);
    assert.equal(JSON.stringify(receipt).includes("forbidden-test-key"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("网络无响应保持 started 且第二次运行在 fetch 前 fail closed", async () => {
  const episode = await approvedEpisode();
  const directory = await mkdtemp(resolve(publicRoot, "external-ambiguous-test-"));
  let firstRequests = 0;
  const options = {
    outputDirectory: directory,
    publicPrefix: "episodes/test/generated-assets/ambiguous",
    allowedToolIds: requiredExternalAssetToolIds(episode),
    credentials: { AIHUBMIX_API_KEY: "network-test-key", ARK_API_KEY: "video-test-key" },
    fetch: async () => {
      firstRequests += 1;
      throw new Error("connection closed without response");
    },
    now: "2026-08-14T05:21:00.000Z"
  };
  try {
    await assert.rejects(
      buildApprovedExternalAssets(episode, options),
      (error) => error.code === "external_asset_image_response_ambiguous"
    );
    assert.equal(firstRequests, 1);
    const receiptPath = resolve(
      directory,
      "generated-architecture-depth-plate.receipt.json"
    );
    const started = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(started.status, "started");
    let retryRequests = 0;
    await assert.rejects(
      buildApprovedExternalAssets(episode, {
        ...options,
        fetch: async () => {
          retryRequests += 1;
          return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
        }
      }),
      (error) => error.code === "external_asset_execution_ambiguous"
    );
    assert.equal(retryRequests, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Provider POST 的 3xx 不跟随且按结算不明冻结后续重试", async () => {
  const episode = await approvedEpisode();
  const directory = await mkdtemp(resolve(publicRoot, "external-redirect-test-"));
  const requests = [];
  const options = {
    outputDirectory: directory,
    publicPrefix: "episodes/test/generated-assets/redirect",
    allowedToolIds: requiredExternalAssetToolIds(episode),
    credentials: { AIHUBMIX_API_KEY: "redirect-test-key", ARK_API_KEY: "video-test-key" },
    fetch: async (url, init = {}) => {
      requests.push({
        url,
        redirect: init.redirect,
        hasBody: typeof init.body === "string",
        hasAuthorization: typeof init.headers?.authorization === "string"
      });
      return new Response(null, {
        status: 307,
        headers: { location: "https://attacker.example.org/capture" }
      });
    },
    now: "2026-08-14T05:21:15.000Z"
  };
  try {
    await assert.rejects(
      buildApprovedExternalAssets(episode, options),
      (error) => error.code === "external_asset_image_response_ambiguous" &&
        error.ambiguous === true &&
        error.reasonCode === "external_asset_provider_redirect"
    );
    assert.deepEqual(requests, [{
      url: "https://aihubmix.com/v1/images/generations",
      redirect: "manual",
      hasBody: true,
      hasAuthorization: true
    }]);
    const receipt = JSON.parse(await readFile(resolve(
      directory,
      "generated-architecture-depth-plate.receipt.json"
    ), "utf8"));
    assert.equal(receipt.status, "started");

    let retryRequests = 0;
    await assert.rejects(
      buildApprovedExternalAssets(episode, {
        ...options,
        fetch: async () => {
          retryRequests += 1;
          throw new Error("redirected Provider call must not retry");
        }
      }),
      (error) => error.code === "external_asset_execution_ambiguous"
    );
    assert.equal(retryRequests, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("人工核对 Provider 无记录无扣费后仅授权一次并在 fetch 前消费", async () => {
  const episode = await approvedEpisode({
    version: 6,
    generationProfile: HYBRID_GENERATION_PROFILES
      .AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P,
    providerFacts: GEMINI_PROVIDER_FACTS
  });
  const item = episode.production.assetPlan.content.items.find((candidate) =>
    candidate.id === "generated-architecture-depth-plate"
  );
  const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls.find(
    (candidate) => candidate.providerId === item.productionMethod.externalProvider &&
      candidate.model === item.productionMethod.externalModel &&
      item.sceneIds.every((sceneId) => candidate.sceneIds.includes(sceneId))
  );
  const assetStep = episode.pipeline.find((step) => step.agent === "asset-agent");
  Object.assign(assetStep, {
    status: "blocked",
    requiresHuman: true,
    findings: ["external_asset_image_response_ambiguous"],
    message: "Provider 请求没有得到可确认响应，禁止自动重试"
  });
  const directory = await mkdtemp(resolve(publicRoot, "external-manual-retry-test-"));
  const receiptPath = resolve(directory, `${item.id}.receipt.json`);
  const started = {
    schemaVersion: "approved-external-assets-v1",
    stateVersion: 0,
    attempt: 1,
    history: [],
    status: "started",
    episodeId: episode.id,
    candidateHash: episode.reviewCheckpoints.assetExecution.currentCandidate.candidateHash,
    assetPlanVersion: episode.production.assetPlan.version,
    planItemId: item.id,
    callId: call.id,
    providerId: call.providerId,
    model: call.model,
    endpoint: call.endpoint,
    promptHash: createHash("sha256").update(call.prompt).digest("hex"),
    requestParametersHash: integrityHash(call.requestParameters),
    rightsDeclarationHash: integrityHash(call.rightsDeclaration),
    rightsDeclaration: structuredClone(call.rightsDeclaration),
    startedAt: "2026-08-14T05:21:00.000Z",
    submittedAt: null,
    completedAt: null,
    providerExecutionId: null,
    usage: null,
    asset: null
  };
  await writeFile(receiptPath, `${JSON.stringify(started, null, 2)}\n`);
  const raw = await readFile(receiptPath);
  const expectedReceiptHash = createHash("sha256").update(raw).digest("hex");
  let stored = structuredClone(episode);
  const events = [];
  const input = {
    candidateHash: episode.reviewCheckpoints.assetExecution.currentCandidate.candidateHash,
    itemId: item.id,
    callId: call.id,
    expectedReceiptStateVersion: 0,
    expectedReceiptHash,
    decision: "provider_no_record_no_charge",
    observations: {
      providerActivityChecked: true,
      providerBillingChecked: true,
      providerRecordFound: false,
      chargeFound: false,
      checkedAt: "2026-08-14T05:24:00.000Z",
      windowStartAt: "2026-08-14T05:20:00.000Z",
      windowEndAt: "2026-08-14T05:23:00.000Z",
      latestProviderLogAt: "2026-08-14T05:20:30.000Z"
    },
    confirmation: "I_CONFIRM_NO_PROVIDER_RECORD_AND_NO_CHARGE",
    note: "人工只读核对 Provider 活动和交易记录后，接受一次残余重复扣费风险"
  };
  const serviceOptions = {
    outputDirectory: directory,
    publicPrefix: "episodes/test/generated-assets/manual-retry",
    actor: "human:Zhengjiazhi",
    now: "2026-08-14T05:24:00.000Z",
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (value) => {
      stored = structuredClone(value);
    },
    appendEvent: async (event) => {
      events.push(structuredClone(event));
    }
  };
  try {
    const adjudicated = await adjudicateAmbiguousExternalAssetReceipt(
      episode.id,
      input,
      serviceOptions
    );
    assert.equal(adjudicated.journal.status, "retry_authorized");
    assert.equal(adjudicated.journal.stateVersion, 1);
    assert.equal(adjudicated.journal.manualAdjudication.sourceReceiptHash,
      expectedReceiptHash);
    assert.equal(stored.pipeline.find((step) => step.agent === "asset-agent").status,
      "ready");
    assert.equal(events.length, 1);
    assert.equal(JSON.stringify(adjudicated).includes("test-key"), false);

    const repeated = await adjudicateAmbiguousExternalAssetReceipt(
      episode.id,
      input,
      serviceOptions
    );
    assert.equal(repeated.unchanged, true);
    assert.equal(repeated.adjudication.id, adjudicated.adjudication.id);

    const requests = [];
    const completed = await buildApprovedExternalAssets(stored, {
      outputDirectory: directory,
      publicPrefix: "episodes/test/generated-assets/manual-retry",
      allowedToolIds: requiredExternalAssetToolIds(stored),
      credentials: {
        AIHUBMIX_API_KEY: "manual-retry-image-key",
        ARK_API_KEY: "manual-retry-video-key"
      },
      fetch: async (url, init = {}) => {
        requests.push({ url, method: init.method ?? "GET" });
        if (url === call.endpoint) {
          return jsonResponse({
            candidates: [{ content: { parts: [{ inlineData: {
              data: PNG.toString("base64")
            } }] } }]
          });
        }
        if (url === "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks") {
          return jsonResponse({ id: "task-manual-retry" });
        }
        if (url.endsWith("/tasks/task-manual-retry")) {
          return jsonResponse({
            status: "succeeded",
            content: { video_url: "https://media.example.com/manual-retry.mp4" },
            usage: { completion_tokens: 172800 }
          });
        }
        if (url === "https://media.example.com/manual-retry.mp4") {
          return binaryResponse(MP4);
        }
        throw new Error(`unexpected request: ${url}`);
      },
      lookupImpl: PUBLIC_LOOKUP,
      sleep: async () => {},
      pollIntervalMs: 0,
      maxPollAttempts: 2,
      now: "2026-08-14T05:25:00.000Z"
    });
    assert.equal(completed.assets.length, 3);
    const finalReceipt = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(finalReceipt.status, "completed");
    assert.equal(finalReceipt.attempt, 2);
    assert.equal(finalReceipt.manualAdjudication.consumedByAttempt, 2);
    assert.equal(finalReceipt.history.filter((entry) => entry.manualAdjudication).length, 1);
    assert.equal(requests.filter((request) => request.url === call.endpoint).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTTP 500 保持 started 且不得在下一次执行中重发", async () => {
  const episode = await approvedEpisode();
  const directory = await mkdtemp(resolve(publicRoot, "external-500-test-"));
  const baseOptions = {
    outputDirectory: directory,
    publicPrefix: "episodes/test/generated-assets/500",
    allowedToolIds: requiredExternalAssetToolIds(episode),
    credentials: { AIHUBMIX_API_KEY: "server-error-key", ARK_API_KEY: "ark-test-key" },
    now: "2026-08-14T05:21:30.000Z"
  };
  try {
    await assert.rejects(
      buildApprovedExternalAssets(episode, {
        ...baseOptions,
        fetch: async () => jsonResponse({}, 500)
      }),
      (error) => error.code === "external_asset_provider_http_error" && error.status === 500
    );
    const receipt = JSON.parse(await readFile(resolve(
      directory,
      "generated-architecture-depth-plate.receipt.json"
    ), "utf8"));
    assert.equal(receipt.status, "started");
    let retryRequests = 0;
    await assert.rejects(
      buildApprovedExternalAssets(episode, {
        ...baseOptions,
        fetch: async () => {
          retryRequests += 1;
          return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
        }
      }),
      (error) => error.code === "external_asset_execution_ambiguous"
    );
    assert.equal(retryRequests, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("视频已提交后轮询 401 保留 task ID，恢复时只 GET 且空 ID fail closed", async () => {
  const episode = await approvedEpisode();
  const directory = await mkdtemp(resolve(publicRoot, "external-video-resume-test-"));
  const initialRequests = [];
  const options = {
    outputDirectory: directory,
    publicPrefix: "episodes/test/generated-assets/video-resume",
    allowedToolIds: requiredExternalAssetToolIds(episode),
    credentials: { AIHUBMIX_API_KEY: "image-test-key", ARK_API_KEY: "video-test-key" },
    fetch: async (url, init = {}) => {
      initialRequests.push({ url, method: init.method ?? "GET" });
      if (url === "https://aihubmix.com/v1/images/generations") {
        return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
      }
      if (url === "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks") {
        return jsonResponse({ id: "task-resume-401" });
      }
      if (url.endsWith("/tasks/task-resume-401")) return jsonResponse({}, 401);
      throw new Error(`unexpected request: ${url}`);
    },
    lookupImpl: PUBLIC_LOOKUP,
    sleep: async () => {},
    pollIntervalMs: 0,
    maxPollAttempts: 1,
    now: "2026-08-14T05:22:00.000Z"
  };
  const receiptPath = resolve(directory, "generated-mcp-data-flow-clip.receipt.json");
  try {
    await assert.rejects(
      buildApprovedExternalAssets(episode, options),
      (error) => error.code === "external_asset_provider_http_error" && error.status === 401
    );
    const submitted = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(submitted.status, "submitted");
    assert.equal(submitted.providerExecutionId, "task-resume-401");
    assert.equal(initialRequests.filter((item) =>
      item.url === "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks" &&
      item.method === "POST"
    ).length, 1);

    await writeFile(receiptPath, `${JSON.stringify({
      ...submitted,
      providerExecutionId: "   "
    }, null, 2)}\n`);
    let invalidIdRequests = 0;
    await assert.rejects(
      buildApprovedExternalAssets(episode, {
        ...options,
        fetch: async () => {
          invalidIdRequests += 1;
          throw new Error("fetch must not run for invalid task id");
        }
      }),
      (error) => error.code === "external_asset_execution_ambiguous"
    );
    assert.equal(invalidIdRequests, 0);

    await writeFile(receiptPath, `${JSON.stringify(submitted, null, 2)}\n`);
    const resumedRequests = [];
    const resumed = await buildApprovedExternalAssets(episode, {
      ...options,
      fetch: async (url, init = {}) => {
        resumedRequests.push({ url, method: init.method ?? "GET" });
        if (url === "https://aihubmix.com/v1/images/generations") {
          return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
        }
        if (url.endsWith("/tasks/task-resume-401")) {
          return jsonResponse({
            status: "succeeded",
            content: { video_url: "https://media.example.com/resumed.mp4" },
            usage: { completion_tokens: 172800 }
          });
        }
        if (url === "https://media.example.com/resumed.mp4") return binaryResponse(MP4);
        throw new Error(`unexpected resumed request: ${url}`);
      },
      lookupImpl: PUBLIC_LOOKUP
    });
    assert.equal(resumed.assets.length, 3);
    assert.equal(resumedRequests.some((item) =>
      item.url === "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks" &&
      item.method === "POST"
    ), false);
    assert.equal(resumedRequests.filter((item) =>
      item.url.endsWith("/tasks/task-resume-401") && item.method === "GET"
    ).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("两图一视频生成写入无秘密收据，完成收据可避免重复付费请求", async () => {
  const episode = await approvedEpisode({ version: 91 });
  const directory = trustedExternalDirectory(episode);
  const requests = [];
  const fakeFetch = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? "GET" });
    if (url === "https://aihubmix.com/v1/images/generations") {
      return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
    }
    if (
      url === "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks" &&
      init.method === "POST"
    ) {
      return jsonResponse({ id: "task-safe-001" });
    }
    if (url.endsWith("/tasks/task-safe-001")) {
      return jsonResponse({
        status: "succeeded",
        content: { video_url: "https://media.example.com/result.mp4" },
        usage: { completion_tokens: 172800 }
      });
    }
    if (url === "https://media.example.com/result.mp4") return binaryResponse(MP4);
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const options = {
      outputDirectory: directory,
      allowedToolIds: requiredExternalAssetToolIds(episode),
      credentials: {
        AIHUBMIX_API_KEY: "test-image-key",
        ARK_API_KEY: "test-video-key"
      },
      fetch: fakeFetch,
      lookupImpl: PUBLIC_LOOKUP,
      sleep: async () => {},
      pollIntervalMs: 0,
      maxPollAttempts: 2,
      now: "2026-08-14T02:45:00.000Z"
    };
    const first = await buildApprovedExternalAssets(episode, options);
    assert.equal(first.assets.length, 3);
    assert.equal(first.executedCalls, 3);
    assert.equal(first.accountedCalls, 3);
    assert.equal(first.accountedCallIds.length, 3);
    assert.equal(first.accountedCostUsd, 2.12);
    assert.equal(first.assets.every((asset) => asset.verified === false), true);
    assert.equal(first.assets.every((asset) => validateAssetRights(asset).valid), true);
    assert.equal(first.assets.every(
      (asset) => asset.rights.declarationHash === asset.rightsDeclarationHash
    ), true);
    assert.equal(first.assets.find((asset) => asset.type === "video").actualNativeAmount, 12.096);
    const mutation = validateWorkerMutation(episode, "asset-agent", {
      status: "complete",
      message: "外部素材已生成",
      artifacts: first.assets.map((asset) => asset.path),
      findings: [],
      patch: { assets: first.assets }
    });
    assert.equal(mutation.valid, true, mutation.errors.join("; "));
    for (const testCase of [
      {
        name: "model",
        mutate(asset) {
          asset.model = "unapproved-model";
        }
      },
      {
        name: "rights declaration hash",
        mutate(asset) {
          asset.rightsDeclarationHash = "f".repeat(64);
        }
      },
      {
        name: "rights content",
        mutate(asset) {
          asset.rights.license = "forged-license";
        }
      },
      {
        name: "rights extra field",
        mutate(asset) {
          asset.rights.unapprovedClaim = "forged";
        }
      },
      {
        name: "receipt path",
        mutate(asset) {
          asset.receiptPath = "episodes/forged/completed.receipt.json";
        }
      }
    ]) {
      const tampered = structuredClone(first.assets);
      testCase.mutate(tampered[0]);
      const validation = validateWorkerMutation(episode, "asset-agent", {
        status: "complete",
        message: `篡改 ${testCase.name}`,
        artifacts: [],
        findings: [],
        patch: { assets: tampered }
      });
      assert.equal(validation.valid, false, testCase.name);
    }
    const firstRequestCount = requests.length;

    const receipts = await Promise.all(first.assets.map((asset) =>
      readFile(resolve(directory, `${asset.planItemId}.receipt.json`), "utf8")
    ));
    assert.equal(receipts.some((receipt) => receipt.includes("test-image-key")), false);
    assert.equal(receipts.some((receipt) => receipt.includes("test-video-key")), false);

    const firstReceiptPath = resolve(
      directory,
      `${first.assets[0].planItemId}.receipt.json`
    );
    const originalReceipt = await readFile(firstReceiptPath, "utf8");
    const reviewEpisode = structuredClone(episode);
    reviewEpisode.assets = structuredClone(first.assets);
    const malformedCallEpisode = structuredClone(reviewEpisode);
    delete malformedCallEpisode.production.assetPlan.content.executionPolicy
      .externalApiCalls[0].prompt;
    assert.equal(validateApprovedExternalAssetReceipt(
      malformedCallEpisode,
      first.assets[0],
      JSON.parse(originalReceipt)
    ).valid, false);
    let receiptCheck = (await validateAssetsForReview(reviewEpisode)).find(
      (check) => check.code === "external-asset-receipts"
    );
    assert.equal(receiptCheck.passed, true, JSON.stringify(receiptCheck.actual));

    const forgedSnapshot = JSON.parse(originalReceipt);
    forgedSnapshot.asset.rights.license = "forged-receipt-snapshot";
    await writeFile(firstReceiptPath, `${JSON.stringify(forgedSnapshot, null, 2)}\n`);
    receiptCheck = (await validateAssetsForReview(reviewEpisode)).find(
      (check) => check.code === "external-asset-receipts"
    );
    assert.equal(receiptCheck.passed, false);
    await writeFile(firstReceiptPath, originalReceipt);

    await rm(firstReceiptPath);
    receiptCheck = (await validateAssetsForReview(reviewEpisode)).find(
      (check) => check.code === "external-asset-receipts"
    );
    assert.equal(receiptCheck.passed, false);
    await writeFile(firstReceiptPath, originalReceipt);

    const tamperedReceipt = JSON.parse(originalReceipt);
    tamperedReceipt.rightsDeclaration.license = "tampered-receipt-license";
    await writeFile(firstReceiptPath, `${JSON.stringify(tamperedReceipt, null, 2)}\n`);
    await assert.rejects(
      buildApprovedExternalAssets(episode, options),
      (error) => error.code === "external_asset_receipt_integrity_failed"
    );
    assert.equal(requests.length, firstRequestCount);
    await writeFile(firstReceiptPath, originalReceipt);

    const second = await buildApprovedExternalAssets(episode, options);
    assert.equal(second.assets.length, 3);
    assert.equal(second.executedCalls, 0);
    assert.equal(second.accountedCalls, 3);
    assert.equal(second.accountedCallIds.length, 3);
    assert.equal(second.accountedCostUsd, 2.12);
    assert.equal(requests.length, firstRequestCount);
    assert.deepEqual(
      second.assets.map((asset) => asset.sha256),
      first.assets.map((asset) => asset.sha256)
    );

    const persistedEpisode = structuredClone(episode);
    persistedEpisode.assets = first.assets;
    const third = await buildApprovedExternalAssets(persistedEpisode, options);
    assert.equal(third.executedCalls, 0);
    assert.equal(third.accountedCalls, 0);
    assert.deepEqual(third.accountedCallIds, []);
    assert.equal(third.accountedCostUsd, 0);
    assert.equal(requests.length, firstRequestCount);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Provider 返回本机 IPv6 素材地址时在下载前拒绝", async () => {
  const episode = await approvedEpisode();
  const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];
  let requests = 0;
  await assert.rejects(
    executeApprovedExternalAssetCall(episode, {
      itemId: "generated-architecture-depth-plate",
      callId: call.id
    }, {
      allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
      environment: { AIHUBMIX_API_KEY: "test-only-key" },
      fetch: async () => {
        requests += 1;
        if (requests === 1) return jsonResponse({ data: [{ url: "https://[::1]/asset.png" }] });
        throw new Error("不应下载本机地址");
      }
    }),
    (error) => error.code === "external_asset_media_url_unsafe"
  );
  assert.equal(requests, 1);
});

test("Provider 素材域名解析到私网时在媒体请求前拒绝", async () => {
  const episode = await approvedEpisode();
  const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];
  let requests = 0;
  await assert.rejects(
    executeApprovedExternalAssetCall(episode, {
      itemId: "generated-architecture-depth-plate",
      callId: call.id
    }, {
      allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
      environment: { AIHUBMIX_API_KEY: "test-only-key" },
      lookupImpl: async () => [{ address: "10.0.0.7", family: 4 }],
      fetch: async () => {
        requests += 1;
        return jsonResponse({ data: [{ url: "https://cdn.example.org/asset.png" }] });
      }
    }),
    (error) => error.code === "external_asset_media_url_unsafe" &&
      error.networkCode === "public_https_address_forbidden"
  );
  assert.equal(requests, 1);
});

test("Provider 素材公开 URL 重定向到私网域名时不发出第二次媒体请求", async () => {
  const episode = await approvedEpisode();
  const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];
  const requests = [];
  await assert.rejects(
    executeApprovedExternalAssetCall(episode, {
      itemId: "generated-architecture-depth-plate",
      callId: call.id
    }, {
      allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
      environment: { AIHUBMIX_API_KEY: "test-only-key" },
      lookupImpl: async (hostname) => [{
        address: hostname === "internal.example.org" ? "192.168.1.8" : "93.184.216.34",
        family: 4
      }],
      fetch: async (url) => {
        requests.push(url);
        if (url === call.endpoint) {
          return jsonResponse({ data: [{ url: "https://cdn.example.org/asset.png" }] });
        }
        return new Response(null, {
          status: 302,
          headers: { location: "https://internal.example.org/asset.png" }
        });
      }
    }),
    (error) => error.code === "external_asset_media_url_unsafe" &&
      error.networkCode === "public_https_address_forbidden"
  );
  assert.deepEqual(requests, [call.endpoint, "https://cdn.example.org/asset.png"]);
});

test("媒体请求包装错误的有限 cause 链仍保留公网安全分类", async () => {
  const episode = await approvedEpisode();
  const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];
  const unsafeCause = new Error("dispatcher rejected target");
  unsafeCause.code = "public_https_address_forbidden";
  unsafeCause.unsafeNetworkTarget = true;
  const wrapped = new TypeError("fetch failed", {
    cause: new Error("connection failed", { cause: unsafeCause })
  });
  let requests = 0;
  await assert.rejects(
    executeApprovedExternalAssetCall(episode, {
      itemId: "generated-architecture-depth-plate",
      callId: call.id
    }, {
      allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
      environment: { AIHUBMIX_API_KEY: "test-only-key" },
      lookupImpl: PUBLIC_LOOKUP,
      fetch: async () => {
        requests += 1;
        if (requests === 1) {
          return jsonResponse({ data: [{ url: "https://cdn.example.org/asset.png" }] });
        }
        throw wrapped;
      }
    }),
    (error) => error.code === "external_asset_media_url_unsafe" &&
      error.networkCode === "public_https_address_forbidden"
  );
  assert.equal(requests, 2);
});

test("素材流在无或伪造 Content-Length 时仍按真实字节立即中止", async (context) => {
  for (const declaredLength of [null, "1"]) {
    await context.test(declaredLength === null ? "无 Content-Length" : "伪造 Content-Length", async () => {
      const episode = await approvedEpisode();
      const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];
      let requests = 0;
      let pulledChunks = 0;
      let cancelled = false;
      const body = new ReadableStream({
        pull(controller) {
          pulledChunks += 1;
          if (pulledChunks > 12) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(5 * 1024 * 1024));
        },
        cancel() {
          cancelled = true;
        }
      });
      const headers = declaredLength === null ? {} : { "content-length": declaredLength };
      await assert.rejects(
        executeApprovedExternalAssetCall(episode, {
          itemId: "generated-architecture-depth-plate",
          callId: call.id
        }, {
          allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
          environment: { AIHUBMIX_API_KEY: "test-only-key" },
          lookupImpl: PUBLIC_LOOKUP,
          fetch: async () => {
            requests += 1;
            if (requests === 1) {
              return jsonResponse({ data: [{ url: "https://cdn.example.org/large.png" }] });
            }
            return new Response(body, { status: 200, headers });
          }
        }),
        (error) => error.code === "external_asset_media_too_large"
      );
      assert.equal(requests, 2);
      assert.equal(cancelled, true);
      assert.ok(pulledChunks < 12, `expected early cancellation, pulled ${pulledChunks} chunks`);
    });
  }
});

test("Provider JSON 在无、伪造或 chunked 长度下均按响应类型硬限流", async (context) => {
  const variants = [
    { name: "无 Content-Length", headers: {} },
    { name: "伪造 Content-Length", headers: { "content-length": "1" } },
    { name: "chunked", headers: { "transfer-encoding": "chunked" }, slowCancel: true }
  ];
  for (const variant of variants) {
    await context.test(variant.name, { timeout: 1000 }, async () => {
      const episode = await approvedEpisode();
      const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls.find(
        (candidate) => candidate.providerId === "volcengine-ark"
      );
      let pulledChunks = 0;
      let cancelled = false;
      const body = new ReadableStream({
        pull(controller) {
          pulledChunks += 1;
          if (pulledChunks > 8) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(256 * 1024));
        },
        cancel() {
          cancelled = true;
          if (!variant.slowCancel) return undefined;
          return new Promise(() => {});
        }
      });
      await assert.rejects(
        executeApprovedExternalAssetCall(episode, {
          itemId: "generated-mcp-data-flow-clip",
          callId: call.id
        }, {
          allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS["volcengine-ark"]],
          environment: { ARK_API_KEY: "test-only-key" },
          fetch: async (_url, init) => {
            assert.equal(init.redirect, "manual");
            return new Response(body, { status: 200, headers: variant.headers });
          }
        }),
        (error) => error.code === "external_asset_video_submission_ambiguous" &&
          error.ambiguous === true &&
          error.reasonCode === "external_asset_provider_json_too_large"
      );
      assert.equal(cancelled, true);
      assert.ok(pulledChunks < 8, `expected early cancellation, pulled ${pulledChunks} chunks`);
    });
  }
});

test("内联 Base64 图片在解码分配前按 30 MiB 上限拒绝", async () => {
  const episode = await approvedEpisode();
  const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];
  const oversizedEncoded = "A".repeat(Math.ceil((30 * 1024 * 1024 + 1) / 3) * 4);
  await assert.rejects(
    executeApprovedExternalAssetCall(episode, {
      itemId: "generated-architecture-depth-plate",
      callId: call.id
    }, {
      allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
      environment: { AIHUBMIX_API_KEY: "test-only-key" },
      fetch: async () => jsonResponse({ data: [{ b64_json: oversizedEncoded }] })
    }),
    (error) => error.code === "external_asset_image_base64_too_large" &&
      error.requiresHuman === true
  );
});

test("Provider JSON、媒体下载和视频轮询请求分别受 AbortSignal 超时约束", async (context) => {
  await context.test("Provider JSON 超时保持付费调用不确定", async () => {
    const episode = await approvedEpisode();
    const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];
    let observedSignal = null;
    await assert.rejects(
      executeApprovedExternalAssetCall(episode, {
        itemId: "generated-architecture-depth-plate",
        callId: call.id
      }, {
        allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
        environment: { AIHUBMIX_API_KEY: "test-only-key" },
        providerRequestTimeoutMs: 100,
        fetch: async (_url, init) => {
          observedSignal = init.signal;
          return abortingFetch(init);
        }
      }),
      (error) => error.code === "external_asset_image_response_ambiguous" &&
        error.ambiguous === true && error.requiresHuman === true
    );
    assert.ok(observedSignal instanceof AbortSignal);
    assert.equal(observedSignal.aborted, true);
  });

  await context.test("媒体下载超时中止读取且不伪装为成功", async () => {
    const episode = await approvedEpisode();
    const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls[0];
    let requests = 0;
    let mediaSignal = null;
    let bodyCancelled = false;
    let bodyPulls = 0;
    const stalledBody = new ReadableStream({
      pull(controller) {
        bodyPulls += 1;
        if (bodyPulls === 1) {
          controller.enqueue(new Uint8Array(PNG.subarray(0, 8)));
          return;
        }
        return new Promise(() => {});
      },
      async cancel() {
        bodyCancelled = true;
        await Promise.resolve();
      }
    });
    await assert.rejects(
      executeApprovedExternalAssetCall(episode, {
        itemId: "generated-architecture-depth-plate",
        callId: call.id
      }, {
        allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS.aihubmix],
        environment: { AIHUBMIX_API_KEY: "test-only-key" },
        lookupImpl: PUBLIC_LOOKUP,
        mediaRequestTimeoutMs: 100,
        fetch: async (_url, init) => {
          requests += 1;
          if (requests === 1) {
            return jsonResponse({ data: [{ url: "https://cdn.example.org/slow.png" }] });
          }
          mediaSignal = init.signal;
          return new Response(stalledBody, { status: 200 });
        }
      }),
      (error) => error.code === "external_asset_download_timeout" &&
        error.requiresHuman === true
    );
    assert.equal(requests, 2);
    assert.ok(mediaSignal instanceof AbortSignal);
    assert.equal(mediaSignal.aborted, true);
    assert.equal(bodyCancelled, true);
    assert.equal(bodyPulls, 2);
  });

  await context.test("视频轮询单次请求超时保留可恢复任务语义", async () => {
    const episode = await approvedEpisode();
    const call = episode.production.assetPlan.content.executionPolicy.externalApiCalls.find(
      (candidate) => candidate.providerId === "volcengine-ark"
    );
    let requests = 0;
    let pollSignal = null;
    await assert.rejects(
      executeApprovedExternalAssetCall(episode, {
        itemId: "generated-mcp-data-flow-clip",
        callId: call.id
      }, {
        allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS["volcengine-ark"]],
        environment: { ARK_API_KEY: "test-only-key" },
        videoPollRequestTimeoutMs: 100,
        fetch: async (_url, init) => {
          requests += 1;
          if (requests === 1) return jsonResponse({ id: "task-timeout-001" });
          pollSignal = init.signal;
          return abortingFetch(init);
        }
      }),
      (error) => error.code === "external_asset_video_poll_ambiguous" &&
        error.ambiguous === true && error.requiresHuman === true
    );
    assert.equal(requests, 2);
    assert.ok(pollSignal instanceof AbortSignal);
    assert.equal(pollSignal.aborted, true);
  });
});

test("视频实际 completion_tokens 超出人民币批准上限时停止登记", async () => {
  const episode = await approvedEpisode();
  const videoCall = episode.production.assetPlan.content.executionPolicy.externalApiCalls.find(
    (call) => call.providerId === "volcengine-ark"
  );
  await assert.rejects(
    executeApprovedExternalAssetCall(episode, {
      itemId: "generated-mcp-data-flow-clip",
      callId: videoCall.id
    }, {
      allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS["volcengine-ark"]],
      credentials: { ARK_API_KEY: "test-video-key" },
      fetch: async (url, init = {}) => {
        if (init.method === "POST") return jsonResponse({ id: "task-over-budget" });
        return jsonResponse({
          status: "succeeded",
          content: { video_url: "https://media.example.com/result.mp4" },
          usage: { completion_tokens: 200000 }
        });
      },
      sleep: async () => {},
      pollIntervalMs: 0,
      maxPollAttempts: 1
    }),
    (error) => error.code === "external_asset_native_budget_exceeded"
  );
});

test("视频计费量缺失或无效时不得按零费用接受素材", async (context) => {
  const cases = [
    { name: "字段缺失", usage: undefined },
    { name: "null", usage: { completion_tokens: null } },
    { name: "空字符串", usage: { completion_tokens: "" } },
    { name: "负数", usage: { completion_tokens: -1 } },
    { name: "小数", usage: { completion_tokens: 0.5 } }
  ];

  for (const scenario of cases) {
    await context.test(scenario.name, async () => {
      const episode = await approvedEpisode();
      const videoCall = episode.production.assetPlan.content.executionPolicy.externalApiCalls.find(
        (call) => call.providerId === "volcengine-ark"
      );
      const requests = [];
      await assert.rejects(
        executeApprovedExternalAssetCall(episode, {
          itemId: "generated-mcp-data-flow-clip",
          callId: videoCall.id
        }, {
          allowedToolIds: [EXTERNAL_ASSET_TOOL_IDS["volcengine-ark"]],
          credentials: { ARK_API_KEY: "test-video-key" },
          fetch: async (url, init = {}) => {
            requests.push({ url, method: init.method ?? "GET" });
            if (init.method === "POST") return jsonResponse({ id: "task-invalid-usage" });
            if (url.endsWith("/tasks/task-invalid-usage")) {
              return jsonResponse({
                status: "succeeded",
                content: { video_url: "https://media.example.com/invalid-usage.mp4" },
                ...(scenario.usage === undefined ? {} : { usage: scenario.usage })
              });
            }
            throw new Error("无效计费量不得进入媒体下载");
          },
          sleep: async () => {},
          pollIntervalMs: 0,
          maxPollAttempts: 1
        }),
        (error) => error.code === "external_asset_video_usage_missing"
      );
      assert.equal(requests.length, 2);
    });
  }
});

test("Asset Agent 在双重工具授权下组合本地动画与三项外部素材并原子提交补丁", async () => {
  const episode = await approvedEpisode({ version: 92 });
  const directory = await mkdtemp(resolve(publicRoot, "external-agent-test-"));
  const externalDirectory = trustedExternalDirectory(episode);
  const publicPrefix = relative(publicRoot, directory).replaceAll("\\", "/");
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? "GET" });
    if (url === "https://aihubmix.com/v1/images/generations") {
      return jsonResponse({ data: [{ b64_json: PNG.toString("base64") }] });
    }
    if (url.endsWith("/contents/generations/tasks") && init.method === "POST") {
      return jsonResponse({ id: "task-agent-001" });
    }
    if (url.endsWith("/tasks/task-agent-001")) {
      return jsonResponse({
        status: "succeeded",
        content: { video_url: "https://media.example.com/agent.mp4" },
        usage: { completion_tokens: 172800 }
      });
    }
    if (url === "https://media.example.com/agent.mp4") return binaryResponse(MP4);
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const result = await agents["asset-agent"].run(episode, {
      toolIds: requiredExternalAssetToolIds(episode),
      localCodeAssetOptions: {
        outputDirectory: directory,
        publicPrefix
      },
      externalAssetOptions: {
        outputDirectory: externalDirectory,
        credentials: {
          AIHUBMIX_API_KEY: "test-image-key",
          ARK_API_KEY: "test-video-key"
        },
        fetch,
        lookupImpl: PUBLIC_LOOKUP,
        sleep: async () => {},
        pollIntervalMs: 0,
        maxPollAttempts: 2
      },
      now: "2026-08-14T02:50:00.000Z"
    });
    assert.equal(result.status, "complete", JSON.stringify(result));
    assert.equal(result.patch.assets.length, 8);
    assert.equal(result.patch.assets.filter(
      (asset) => asset.source === "approved-external-generation"
    ).length, 3);
    assert.equal(result.patch.production.ai.requestCount, 3);
    assert.equal(result.patch.control.budget.usedCalls, 3);
    assert.equal(result.patch.control.budget.usedCostUsd, 2.12);
    assert.equal(result.patch.scenes.slice(0, 4).every(
      (scene) => scene.asset.endsWith("generated-architecture-depth-plate.png")
    ), true);
    assert.equal(result.patch.scenes.slice(5, 7).every(
      (scene) => scene.asset.endsWith("generated-mcp-data-flow-clip.mp4")
    ), true);
    assert.equal(result.patch.scenes.slice(7).every(
      (scene) => scene.asset.endsWith("generated-capability-boundary-plate.png")
    ), true);
    const validation = validateWorkerMutation(episode, "asset-agent", result);
    assert.equal(validation.valid, true, validation.errors.join("; "));
    assert.equal(requests.filter((request) => request.method === "POST").length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(externalDirectory, { recursive: true, force: true });
  }
});
