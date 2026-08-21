import { loadLocalEnvironment } from "../../shared/env.mjs";
import { readEpisode } from "../../shared/store.mjs";
import { acquireEpisodeOperation } from "../control/episode-operation-lock.mjs";
import {
  beginAssetExecutionPreflight,
  recordAssetExecutionPreflight
} from "./asset-execution-checkpoint.mjs";
import {
  inspectAssetExecutionPreflight,
  probeAihubmixGeminiCredential
} from "./asset-execution-preflight.mjs";

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

const GPT_IMAGE_PROVIDER_FACTS = Object.freeze({
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
  volcengineArk: GEMINI_PROVIDER_FACTS.volcengineArk
});

function credentialsPresent(credentials = {}) {
  return {
    AIHUBMIX_API_KEY: Boolean(credentials.AIHUBMIX_API_KEY?.trim()),
    ARK_API_KEY: Boolean(credentials.ARK_API_KEY?.trim())
  };
}

async function localCredentials(options = {}) {
  if (options.credentials) return options.credentials;
  await (options.loadEnvironment ?? loadLocalEnvironment)();
  return process.env;
}

export async function runAssetExecutionPreflight(episodeId, input = {}, options = {}) {
  const releaseOperation = acquireEpisodeOperation(
    episodeId,
    "asset-execution-preflight",
    { conflictMessage: "这一期已有 Agent 操作在运行，不能并发执行零生成预检" }
  );
  try {
    const readState = options.readEpisode ?? readEpisode;
    const source = await readState(episodeId);
    const candidateHash = String(input.candidateHash ?? "");
    if (!candidateHash || candidateHash !==
      source.reviewCheckpoints?.assetExecution?.currentCandidate?.candidateHash) {
      const error = new Error("零生成预检没有绑定当前候选");
      error.code = "asset_execution_preflight_candidate_conflict";
      throw error;
    }
    const started = await beginAssetExecutionPreflight(
      episodeId,
      { candidateHash },
      options
    );
    const credentials = await localCredentials(options);
    const presence = credentialsPresent(credentials);
    const episode = started.episode;
    const imageCall = episode.production?.assetPlan?.content?.executionPolicy
      ?.externalApiCalls?.find((call) => call?.providerId === "aihubmix");
    const verification = imageCall?.endpoint?.startsWith(
      "https://aihubmix.com/gemini/"
    )
      ? await probeAihubmixGeminiCredential({
          credential: credentials.AIHUBMIX_API_KEY,
          generationEndpoint: imageCall.endpoint,
          modelId: imageCall.model,
          fetch: options.fetch,
          timeoutMs: options.timeoutMs,
          now: options.now
        })
      : undefined;
    const report = inspectAssetExecutionPreflight(episode, {
      preflightRunId: started.run.runId,
      credentialPresence: presence,
      credentialVerification: { aihubmix: verification },
      providerFacts: structuredClone(options.providerFacts ?? (
        imageCall?.model === "gpt-image-2"
          ? GPT_IMAGE_PROVIDER_FACTS
          : GEMINI_PROVIDER_FACTS
      )),
      generationRequestCount: 0,
      metadataRequestCount: verification?.metadataRequestCount ?? 0,
      now: options.now
    });
    const recorded = await recordAssetExecutionPreflight(episodeId, report, options);
    return {
      episode: recorded.episode,
      checkpoint: recorded.checkpoint,
      report: recorded.report,
      run: structuredClone(recorded.episode.production.assetExecutionPreflightRun),
      unchanged: recorded.unchanged
    };
  } finally {
    releaseOperation();
  }
}
