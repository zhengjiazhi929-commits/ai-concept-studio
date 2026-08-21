import { integrityHash } from "../../shared/integrity.mjs";
import { assetExecutionApprovalValid } from "./asset-execution-checkpoint.mjs";

export const ASSET_EXECUTION_PREFLIGHT_VERSION = 4;

const AIHUBMIX_GPT_IMAGE_MODEL = "gpt-image-2";
const AIHUBMIX_GPT_IMAGE_ENDPOINT = "https://aihubmix.com/v1/images/generations";
const AIHUBMIX_GEMINI_IMAGE_MODEL = "gemini-3-pro-image";
const AIHUBMIX_GEMINI_IMAGE_ENDPOINT =
  "https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image:generateContent";
export const AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT =
  "https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image";
export const AIHUBMIX_GEMINI_COUNT_TOKENS_ENDPOINT =
  "https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image:countTokens";
const VOLCENGINE_VIDEO_MODEL = "doubao-seedance-2-5-260628";
const VOLCENGINE_VIDEO_ENDPOINT =
  "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks";

function check(id, label, passed, actual, expected, suggestedFix = "") {
  return {
    id,
    label,
    passed: Boolean(passed),
    actual,
    expected,
    suggestedFix
  };
}

function checkedAt(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function safeAihubmixCredentialVerification(value = {}) {
  return {
    status: value.status ?? null,
    probeKind: value.probeKind ?? null,
    method: value.method ?? null,
    authScheme: value.authScheme ?? null,
    endpoint: value.endpoint ?? null,
    expectedModelId: value.expectedModelId ?? null,
    responseModelId: value.responseModelId ?? null,
    supportedGenerationMethods: Array.isArray(value.supportedGenerationMethods)
      ? value.supportedGenerationMethods.filter((method) => typeof method === "string").slice(0, 20)
      : [],
    supportsGenerateContent: value.supportsGenerateContent === true,
    modelMatched: value.modelMatched === true,
    authenticated: typeof value.authenticated === "boolean"
      ? value.authenticated
      : null,
    httpStatus: Number.isInteger(value.httpStatus) ? value.httpStatus : null,
    metadataRequestCount: Number.isInteger(value.metadataRequestCount)
      ? value.metadataRequestCount
      : 0,
    generationRequestCount: Number.isInteger(value.generationRequestCount)
      ? value.generationRequestCount
      : 0,
    responseHash: typeof value.responseHash === "string" ? value.responseHash : null,
    modelEndpointBound: value.modelEndpointBound === true,
    totalTokens: Number.isInteger(value.totalTokens) ? value.totalTokens : null,
    primaryAttempt: value.primaryAttempt && typeof value.primaryAttempt === "object"
      ? {
          method: value.primaryAttempt.method ?? null,
          endpoint: value.primaryAttempt.endpoint ?? null,
          httpStatus: Number.isInteger(value.primaryAttempt.httpStatus)
            ? value.primaryAttempt.httpStatus
            : null,
          status: value.primaryAttempt.status ?? null
        }
      : null,
    checkedAt: typeof value.checkedAt === "string" ? value.checkedAt.slice(0, 64) : null
  };
}

async function requestWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return { response: await fetchImpl(url, { ...init, signal: controller.signal }) };
  } catch {
    return { response: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeGeminiCountTokens(base, credential, fetchImpl, options, primaryAttempt) {
  const endpoint = AIHUBMIX_GEMINI_COUNT_TOKENS_ENDPOINT;
  const request = await requestWithTimeout(fetchImpl, endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": credential,
      "content-type": "application/json",
      accept: "application/json"
    },
    redirect: "error",
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "preflight" }] }]
    })
  }, Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000);
  if (!request.response) {
    return {
      ...base,
      status: "ambiguous",
      probeKind: "countTokens",
      method: "POST",
      endpoint,
      authenticated: null,
      metadataRequestCount: 2,
      primaryAttempt
    };
  }
  const response = request.response;
  const httpStatus = Number(response.status ?? 0);
  const authenticationRejected = new Set([401, 403]).has(httpStatus);
  const transient = httpStatus === 429 || httpStatus >= 500;
  if (!response.ok) {
    return {
      ...base,
      status: authenticationRejected
        ? "rejected"
        : transient
          ? "transient"
          : "unavailable",
      probeKind: "countTokens",
      method: "POST",
      endpoint,
      authenticated: authenticationRejected ? false : null,
      httpStatus,
      metadataRequestCount: 2,
      primaryAttempt
    };
  }
  let value;
  try {
    value = await response.json();
  } catch {
    return {
      ...base,
      status: "unavailable",
      probeKind: "countTokens",
      method: "POST",
      endpoint,
      authenticated: true,
      httpStatus,
      metadataRequestCount: 2,
      primaryAttempt
    };
  }
  const totalTokens = Number(value?.totalTokens ?? value?.total_tokens);
  const validCount = Number.isInteger(totalTokens) && totalTokens > 0;
  return {
    ...base,
    status: validCount ? "passed" : "unavailable",
    probeKind: "countTokens",
    method: "POST",
    endpoint,
    authenticated: true,
    httpStatus,
    metadataRequestCount: 2,
    modelEndpointBound: true,
    totalTokens: validCount ? totalTokens : null,
    primaryAttempt,
    responseHash: integrityHash({ totalTokens: validCount ? totalTokens : null })
  };
}

export async function probeAihubmixGeminiCredential(options = {}) {
  const credential = typeof options.credential === "string"
    ? options.credential.trim()
    : "";
  const generationEndpoint = options.generationEndpoint ?? AIHUBMIX_GEMINI_IMAGE_ENDPOINT;
  const endpoint = generationEndpoint === AIHUBMIX_GEMINI_IMAGE_ENDPOINT
    ? generationEndpoint.replace(/:generateContent$/u, "")
    : null;
  const expectedModelId = options.modelId ?? AIHUBMIX_GEMINI_IMAGE_MODEL;
  const base = {
    status: endpoint ? "missing" : "unavailable",
    probeKind: "models.get",
    method: "GET",
    authScheme: "x-goog-api-key",
    endpoint,
    expectedModelId,
    responseModelId: null,
    supportedGenerationMethods: [],
    supportsGenerateContent: false,
    modelMatched: false,
    authenticated: null,
    httpStatus: null,
    metadataRequestCount: 0,
    generationRequestCount: 0,
    responseHash: null,
    modelEndpointBound: false,
    totalTokens: null,
    primaryAttempt: null,
    checkedAt: checkedAt(options.now)
  };
  if (!endpoint) return base;
  if (!credential) return base;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const request = await requestWithTimeout(fetchImpl, endpoint, {
    method: "GET",
    headers: {
      "x-goog-api-key": credential,
      accept: "application/json"
    },
    redirect: "error"
  }, Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000);
  if (!request.response) {
    return { ...base, status: "ambiguous", metadataRequestCount: 1 };
  }
  const response = request.response;
  const httpStatus = Number(response?.status ?? 0);
  const authenticationRejected = new Set([401, 403]).has(httpStatus);
  const transient = httpStatus === 429 || httpStatus >= 500;
  const authenticated = authenticationRejected ? false : null;
  if (!response?.ok) {
    if (new Set([404, 405]).has(httpStatus)) {
      return probeGeminiCountTokens(base, credential, fetchImpl, options, {
        method: "GET",
        endpoint,
        httpStatus,
        status: "unavailable"
      });
    }
    return {
      ...base,
      status: authenticationRejected
        ? "rejected"
        : transient
          ? "transient"
          : "unavailable",
      authenticated,
      httpStatus,
      metadataRequestCount: 1
    };
  }
  let value;
  try {
    value = await response.json();
  } catch {
    return {
      ...base,
      status: "unavailable",
      authenticated: true,
      httpStatus,
      metadataRequestCount: 1
    };
  }
  const responseModelId = String(value?.name ?? value?.baseModelId ?? value?.model ?? "")
    .replace(/^models\//u, "");
  const supportedGenerationMethods = Array.isArray(value?.supportedGenerationMethods)
    ? value.supportedGenerationMethods
        .filter((method) => typeof method === "string")
        .slice(0, 20)
    : [];
  const modelMatched = responseModelId === expectedModelId;
  const supportsGenerateContent = supportedGenerationMethods.includes("generateContent");
  const normalizedResponse = {
    name: typeof value?.name === "string" ? value.name : null,
    baseModelId: typeof value?.baseModelId === "string" ? value.baseModelId : null,
    supportedGenerationMethods
  };
  return {
    ...base,
    status: modelMatched && supportsGenerateContent ? "passed" : "unavailable",
    probeKind: "models.get",
    responseModelId: responseModelId || null,
    supportedGenerationMethods,
    supportsGenerateContent,
    modelMatched,
    modelEndpointBound: true,
    authenticated: true,
    httpStatus,
    metadataRequestCount: 1,
    responseHash: integrityHash(normalizedResponse)
  };
}

function gptImageRequestValid(call) {
  const parameters = call?.requestParameters;
  return Boolean(
    call?.providerId === "aihubmix" &&
    call?.model === AIHUBMIX_GPT_IMAGE_MODEL &&
    call?.endpoint === AIHUBMIX_GPT_IMAGE_ENDPOINT &&
    parameters?.model === AIHUBMIX_GPT_IMAGE_MODEL &&
    parameters?.n === 1 &&
    parameters?.size === "1024x1536" &&
    parameters?.quality === "medium" &&
    parameters?.background === "opaque" &&
    parameters?.output_format === "png"
  );
}

function geminiImageRequestValid(call) {
  const parameters = call?.requestParameters;
  return Boolean(
    call?.providerId === "aihubmix" &&
    call?.model === AIHUBMIX_GEMINI_IMAGE_MODEL &&
    call?.endpoint === AIHUBMIX_GEMINI_IMAGE_ENDPOINT &&
    integrityHash(parameters) === integrityHash({
      contents: [{ role: "user", parts: [{ text: call.prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: "9:16",
          imageSize: "2K"
        }
      }
    })
  );
}

function imageContractFor(calls) {
  const models = new Set(calls.map((call) => call?.model));
  if (models.size !== 1) return null;
  const model = [...models][0];
  if (model === AIHUBMIX_GPT_IMAGE_MODEL) {
    return {
      kind: "gpt-image",
      model,
      endpoint: AIHUBMIX_GPT_IMAGE_ENDPOINT,
      requestValid: gptImageRequestValid,
      expectedRequest: {
        model,
        endpoint: AIHUBMIX_GPT_IMAGE_ENDPOINT,
        size: "1024x1536",
        quality: "medium",
        output_format: "png"
      }
    };
  }
  if (model === AIHUBMIX_GEMINI_IMAGE_MODEL) {
    return {
      kind: "gemini-image",
      model,
      endpoint: AIHUBMIX_GEMINI_IMAGE_ENDPOINT,
      requestValid: geminiImageRequestValid,
      expectedRequest: {
        model,
        endpoint: AIHUBMIX_GEMINI_IMAGE_ENDPOINT,
        responseModalities: ["IMAGE"],
        aspectRatio: "9:16",
        imageSize: "2K"
      }
    };
  }
  return null;
}

function videoRequestValid(call) {
  const parameters = call?.requestParameters;
  return Boolean(
    call?.providerId === "volcengine-ark" &&
    call?.model === VOLCENGINE_VIDEO_MODEL &&
    call?.endpoint === VOLCENGINE_VIDEO_ENDPOINT &&
    parameters?.model === VOLCENGINE_VIDEO_MODEL &&
    Array.isArray(parameters?.content) &&
    parameters.content.length === 1 &&
    parameters.content[0]?.type === "text" &&
    parameters.content[0]?.text === call.prompt &&
    parameters.generate_audio === false &&
    parameters.ratio === "9:16" &&
    parameters.resolution === "720p" &&
    parameters.duration === 8 &&
    parameters.watermark === false
  );
}

function billingPrice(call) {
  return Number(call?.billing?.unitPrice ?? Number.NaN);
}

export function inspectAssetExecutionPreflight(episode, options = {}) {
  const checkpoint = episode.reviewCheckpoints?.assetExecution ?? {};
  const plan = episode.production?.assetPlan?.content ?? {};
  const calls = Array.isArray(plan.executionPolicy?.externalApiCalls)
    ? plan.executionPolicy.externalApiCalls
    : [];
  const imageCalls = calls.filter((call) => call.providerId === "aihubmix");
  const videoCalls = calls.filter((call) => call.providerId === "volcengine-ark");
  const imageContract = imageContractFor(imageCalls);
  const requiresGeminiCredentialProbe = Boolean(
    imageCalls.length > 0 && imageContract?.kind === "gemini-image"
  );
  const credentialPresence = {
    AIHUBMIX_API_KEY: options.credentialPresence?.AIHUBMIX_API_KEY === true,
    ARK_API_KEY: options.credentialPresence?.ARK_API_KEY === true
  };
  const facts = options.providerFacts ?? {};
  const aihubmix = facts.aihubmix ?? {};
  const volcengine = facts.volcengineArk ?? {};
  const aihubmixCredentialVerification = safeAihubmixCredentialVerification(
    options.credentialVerification?.aihubmix
  );
  const generationRequestCount = Number.isInteger(options.generationRequestCount)
    ? options.generationRequestCount
    : 0;
  const metadataRequestCount = Number.isInteger(options.metadataRequestCount)
    ? options.metadataRequestCount
    : 0;
  const checks = [
    check(
      "approval-binding",
      "预检绑定当前机器通过且人工批准的素材方案",
      assetExecutionApprovalValid(episode),
      checkpoint.currentCandidate?.candidateHash ?? null,
      checkpoint.humanApproval?.candidateHash ?? null,
      "重新对当前素材方案执行机器审核和人工审批"
    ),
    check(
      "external-call-shape",
      "外部生成范围仍为两次生图和一次生视频",
      calls.length === 3 && imageCalls.length === 2 && videoCalls.length === 1,
      {
        total: calls.length,
        image: imageCalls.length,
        video: videoCalls.length
      },
      { total: 3, image: 2, video: 1 },
      "由 Asset Agent 重新生成受限的三次调用方案"
    ),
    check(
      "zero-generation-requests",
      "预检没有调用任何生图或生视频端点",
      generationRequestCount === 0,
      generationRequestCount,
      0,
      "立即停止并废弃本次预检记录"
    ),
    check(
      "aihubmix-credential-presence",
      "AIHubMix 凭据只做存在性检查",
      imageCalls.length === 0 || credentialPresence.AIHUBMIX_API_KEY,
      credentialPresence.AIHUBMIX_API_KEY,
      imageCalls.length > 0,
      "只在本地环境配置 AIHUBMIX_API_KEY，不写入产物或日志"
    ),
    check(
      "aihubmix-credential-authentication",
      "AIHubMix 凭据已通过同一 Gemini 原生网关的无生成鉴权",
      !requiresGeminiCredentialProbe || Boolean(
        credentialPresence.AIHUBMIX_API_KEY &&
        aihubmixCredentialVerification.authenticated === true
      ),
      aihubmixCredentialVerification,
      {
        status: "passed",
        authenticated: true,
        method: "GET",
        authScheme: "x-goog-api-key",
        generationRequestCount: 0
      },
      "重新签发或更新 AIHubMix Key 后，只运行模型元数据鉴权探针"
    ),
    check(
      "aihubmix-auth-probe-zero-generation",
      "AIHubMix 鉴权探针只请求模型元数据或计数且没有触发生成",
      !requiresGeminiCredentialProbe || !credentialPresence.AIHUBMIX_API_KEY || Boolean(
        aihubmixCredentialVerification.generationRequestCount === 0 && (
          (
            aihubmixCredentialVerification.probeKind === "models.get" &&
            aihubmixCredentialVerification.method === "GET" &&
            aihubmixCredentialVerification.endpoint ===
              AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT &&
            aihubmixCredentialVerification.metadataRequestCount === 1
          ) || (
            aihubmixCredentialVerification.probeKind === "countTokens" &&
            aihubmixCredentialVerification.method === "POST" &&
            aihubmixCredentialVerification.endpoint ===
              AIHUBMIX_GEMINI_COUNT_TOKENS_ENDPOINT &&
            aihubmixCredentialVerification.metadataRequestCount === 2 &&
            aihubmixCredentialVerification.primaryAttempt?.method === "GET" &&
            aihubmixCredentialVerification.primaryAttempt?.endpoint ===
              AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT &&
            new Set([404, 405]).has(
              aihubmixCredentialVerification.primaryAttempt?.httpStatus
            )
          )
        )
      ),
      {
        probeKind: aihubmixCredentialVerification.probeKind,
        method: aihubmixCredentialVerification.method,
        metadataRequestCount: aihubmixCredentialVerification.metadataRequestCount,
        generationRequestCount: aihubmixCredentialVerification.generationRequestCount
      },
      {
        acceptedProbeKinds: ["models.get", "countTokens"],
        metadataRequestCount: "1 or 2",
        generationRequestCount: 0
      },
      "禁止使用生成端点验证凭据；只允许模型元数据或 countTokens 请求"
    ),
    check(
      "aihubmix-model-metadata-probe",
      "AIHubMix 无生成探针绑定当前批准的 Gemini 模型路由",
      !requiresGeminiCredentialProbe ||
        !credentialPresence.AIHUBMIX_API_KEY ||
        aihubmixCredentialVerification.authenticated === false || Boolean(
          aihubmixCredentialVerification.status === "passed" &&
          aihubmixCredentialVerification.expectedModelId === imageContract?.model &&
          aihubmixCredentialVerification.modelEndpointBound === true &&
          (
            (
              aihubmixCredentialVerification.probeKind === "models.get" &&
              aihubmixCredentialVerification.endpoint ===
                AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT &&
              aihubmixCredentialVerification.responseModelId === imageContract?.model &&
              aihubmixCredentialVerification.modelMatched === true &&
              aihubmixCredentialVerification.supportsGenerateContent === true &&
              aihubmixCredentialVerification.supportedGenerationMethods
                .includes("generateContent")
            ) || (
              aihubmixCredentialVerification.probeKind === "countTokens" &&
              aihubmixCredentialVerification.endpoint ===
                AIHUBMIX_GEMINI_COUNT_TOKENS_ENDPOINT &&
              Number.isInteger(aihubmixCredentialVerification.totalTokens) &&
              aihubmixCredentialVerification.totalTokens > 0
            )
          ) &&
          typeof aihubmixCredentialVerification.responseHash === "string"
        ),
      aihubmixCredentialVerification,
      {
        status: "passed",
        endpoints: [
          AIHUBMIX_GEMINI_MODEL_METADATA_ENDPOINT,
          AIHUBMIX_GEMINI_COUNT_TOKENS_ENDPOINT
        ],
        modelId: imageContract?.model ?? null,
        result: "model-bound non-generation probe"
      },
      "元数据与 countTokens 都无法绑定批准模型时退回 Asset Agent，不得试调用生成端点"
    ),
    check(
      "aihubmix-model-availability",
      "AIHubMix 当前目录仍提供批准的生图模型与图像输出能力",
      imageCalls.length === 0 || Boolean(
        imageContract &&
        aihubmix.available === true &&
        aihubmix.modelId === imageContract.model &&
        aihubmix.capabilities?.includes("image_generation")
      ),
      {
        available: aihubmix.available === true,
        modelId: aihubmix.modelId ?? null,
        capabilities: Array.isArray(aihubmix.capabilities)
          ? aihubmix.capabilities
          : []
      },
      { modelId: imageContract?.model ?? null, capability: "image_generation" },
      "刷新 AIHubMix 模型目录；不得自动换用其他模型"
    ),
    check(
      "aihubmix-model-lifecycle",
      "批准的 AIHubMix 生图模型没有已公布停用日期",
      imageCalls.length === 0 || imageContract?.kind !== "gemini-image" || Boolean(
        aihubmix.lifecycleStatus === "ga" &&
        aihubmix.deprecated === false &&
        (aihubmix.shutdownDate === null || aihubmix.shutdownDate === undefined)
      ),
      {
        modelId: aihubmix.modelId ?? null,
        lifecycleStatus: aihubmix.lifecycleStatus ?? null,
        deprecated: aihubmix.deprecated ?? null,
        shutdownDate: aihubmix.shutdownDate ?? null,
        lifecycleSource: aihubmix.lifecycleSource ?? null
      },
      {
        modelId: imageContract?.model ?? null,
        lifecycleStatus: "ga",
        deprecated: false,
        shutdownDate: null
      },
      "模型已弃用或存在停用日期时由 Asset Agent 选择新的稳定模型并生成新版本"
    ),
    check(
      "aihubmix-generation-endpoint-availability",
      "AIHubMix 当前官方文档明确支持批准的文字生图端点",
      imageCalls.length === 0 || Boolean(
        imageContract &&
        Array.isArray(aihubmix.supportedEndpoints) &&
        imageCalls.every((call) => aihubmix.supportedEndpoints.includes(call.endpoint))
      ),
      {
        modelId: aihubmix.modelId ?? null,
        supportedEndpoints: Array.isArray(aihubmix.supportedEndpoints)
          ? aihubmix.supportedEndpoints
          : [],
        endpointSource: aihubmix.endpointSource ?? null
      },
      {
        modelId: imageContract?.model ?? null,
        endpoint: imageContract?.endpoint ?? null
      },
      "由 Asset Agent 选择当前官方明确支持的文字生图合同并生成新版本；不得试调用或假定兼容"
    ),
    check(
      "aihubmix-request-contract",
      "AIHubMix 生图端点与输出参数精确匹配方案",
      imageCalls.length === 2 && Boolean(imageContract) &&
        imageCalls.every(imageContract?.requestValid ?? (() => false)),
      imageCalls.map((call) => ({
        id: call.id,
        model: call.model,
        endpoint: call.endpoint,
        requestParameters: call.requestParameters
      })),
      imageContract?.expectedRequest ?? { supportedImageContract: true },
      "由 Asset Agent 修正端点和完整请求参数后生成新版本"
    ),
    check(
      "aihubmix-pricing",
      "AIHubMix 模型价格证据已刷新且仍在批准上限内",
      imageCalls.length === 0 || Boolean(
        imageContract &&
        aihubmix.pricingConfirmed === true &&
        (imageContract.kind === "gpt-image"
          ? aihubmix.inputUsdPerMillion === 5 &&
            aihubmix.outputUsdPerMillion === 30 &&
            imageCalls.every((call) => call.billing?.maximumAmount <= 0.06)
          : aihubmix.inputUsdPerMillion === 2 &&
            aihubmix.textOutputUsdPerMillion === 12 &&
            aihubmix.imageOutputUsdPerMillion === 120 &&
            aihubmix.approximateUsdPerImage2K === 0.134 &&
            imageCalls.every((call) =>
              call.billing?.estimatedAmount === 0.134 &&
              call.billing?.maximumAmount === 0.15
            ))
      ),
      {
        pricingConfirmed: aihubmix.pricingConfirmed === true,
        inputUsdPerMillion: aihubmix.inputUsdPerMillion ?? null,
        outputUsdPerMillion: aihubmix.outputUsdPerMillion ?? null,
        textOutputUsdPerMillion: aihubmix.textOutputUsdPerMillion ?? null,
        imageOutputUsdPerMillion: aihubmix.imageOutputUsdPerMillion ?? null,
        approximateUsdPerImage2K: aihubmix.approximateUsdPerImage2K ?? null
      },
      imageContract?.kind === "gemini-image"
        ? {
            inputUsdPerMillion: 2,
            textOutputUsdPerMillion: 12,
            imageOutputUsdPerMillion: 120,
            approximateUsdPerImage2K: 0.134,
            maximumPerImageUsd: 0.15
          }
        : { inputUsdPerMillion: 5, outputUsdPerMillion: 30, maximumPerImageUsd: 0.06 },
      "刷新价格证据；价格漂移时生成新方案并重新审批"
    ),
    check(
      "ark-credential-presence",
      "火山方舟凭据只做存在性检查",
      videoCalls.length === 0 || credentialPresence.ARK_API_KEY,
      credentialPresence.ARK_API_KEY,
      videoCalls.length > 0,
      "只在本地环境配置 ARK_API_KEY，不写入产物或日志"
    ),
    check(
      "seedance-model-availability",
      "火山方舟当前文档仍提供指定 Seedance 2.5 模型",
      videoCalls.length === 0 || Boolean(
        volcengine.available === true &&
        volcengine.modelId === VOLCENGINE_VIDEO_MODEL &&
        volcengine.supportedResolutions?.includes("720p")
      ),
      {
        available: volcengine.available === true,
        modelId: volcengine.modelId ?? null,
        supportedResolutions: Array.isArray(volcengine.supportedResolutions)
          ? volcengine.supportedResolutions
          : []
      },
      { modelId: VOLCENGINE_VIDEO_MODEL, resolution: "720p" },
      "刷新官方模型说明；不得自动回退到其他 Seedance 版本"
    ),
    check(
      "seedance-request-contract",
      "Seedance 模型与顶层视频参数精确匹配官方请求结构",
      videoCalls.length === 1 && videoCalls.every(videoRequestValid),
      videoCalls.map((call) => ({
        id: call.id,
        model: call.model,
        endpoint: call.endpoint,
        requestParameters: call.requestParameters
      })),
      {
        model: VOLCENGINE_VIDEO_MODEL,
        endpoint: VOLCENGINE_VIDEO_ENDPOINT,
        generate_audio: false,
        ratio: "9:16",
        resolution: "720p",
        duration: 8,
        watermark: false
      },
      "由 Asset Agent 使用官方模型 ID 和顶层参数生成新版本"
    ),
    check(
      "seedance-pricing",
      "Seedance 价格证据已刷新且仍在批准原币种上限内",
      videoCalls.length === 0 || Boolean(
        volcengine.pricingConfirmed === true &&
        volcengine.unitPriceCnyPerMillion === 70 &&
        videoCalls.every((call) =>
          billingPrice(call) === 70 && call.billing?.maximumAmount <= 13
        )
      ),
      {
        pricingConfirmed: volcengine.pricingConfirmed === true,
        unitPriceCnyPerMillion: volcengine.unitPriceCnyPerMillion ?? null
      },
      { unitPriceCnyPerMillion: 70, maximumCny: 13 },
      "刷新价格证据；价格漂移时生成新方案并重新审批"
    )
  ];
  const passed = checks.every((item) => item.passed);
  const failedCheckIds = checks
    .filter((item) => !item.passed)
    .map((item) => item.id);
  const inputOnlyCheckIds = new Set([
    "aihubmix-credential-presence",
    "aihubmix-credential-authentication",
    "ark-credential-presence"
  ]);
  const ambiguousCredentialProbe =
    requiresGeminiCredentialProbe &&
    new Set(["ambiguous", "transient"]).has(aihubmixCredentialVerification.status);
  const blockerDisposition = passed
    ? null
    : failedCheckIds.every((id) => inputOnlyCheckIds.has(id)) ||
        (ambiguousCredentialProbe && failedCheckIds.every((id) =>
          inputOnlyCheckIds.has(id) || id === "aihubmix-model-metadata-probe"
        ))
      ? "input_required"
      : "revision_required";
  const reportCheckedAt = checkedAt(options.now);
  const report = {
    schemaVersion: ASSET_EXECUTION_PREFLIGHT_VERSION,
    preflightRunId: typeof options.preflightRunId === "string"
      ? options.preflightRunId
      : null,
    status: passed ? "passed" : "blocked",
    blockerDisposition,
    checkedAt: reportCheckedAt,
    candidateHash: checkpoint.currentCandidate?.candidateHash ?? null,
    version: checkpoint.currentCandidate?.version ?? null,
    generationRequestCount,
    metadataRequestCount,
    credentialPresence,
    credentialVerification: {
      aihubmix: aihubmixCredentialVerification
    },
    providerEvidence: {
      aihubmix: {
        checkedAt: aihubmix.checkedAt ?? null,
        source: aihubmix.source ?? null,
        endpointSource: aihubmix.endpointSource ?? null,
        lifecycleSource: aihubmix.lifecycleSource ?? null
      },
      volcengineArk: {
        checkedAt: volcengine.checkedAt ?? null,
        source: volcengine.source ?? null
      }
    },
    checks,
    failureSummary: checks
      .filter((item) => !item.passed)
      .map((item) => `${item.label}：${item.suggestedFix || item.expected}`)
  };
  report.reportHash = integrityHash(report);
  return report;
}
