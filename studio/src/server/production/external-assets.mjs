import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  episodePublicDirectory,
  ensureInside,
  publicRoot
} from "../../shared/paths.mjs";
import { loadLocalEnvironment } from "../../shared/env.mjs";
import { integrityHash } from "../../shared/integrity.mjs";
import {
  buildExternalGenerationRights,
  validateAssetRights,
  validateExternalRightsDeclaration
} from "../../shared/asset-rights.mjs";
import { fetchPublicHttps } from "../../shared/network.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
import { writeVersionedJson } from "../../shared/versioned-json-store.mjs";
import {
  acquireEpisodeOperation,
  claimPersistedEpisodeOperation,
  releasePersistedEpisodeOperation
} from "../control/episode-operation-lock.mjs";
import {
  assetExecutionApprovalValid,
  assetExecutionPreflightValid,
  assertAssetExecutionAuthorized
} from "../reviews/asset-execution-checkpoint.mjs";
import {
  consumeSideEffectGrantUsage,
  requireSideEffectGrant
} from "../security/side-effect-capability.mjs";

export const EXTERNAL_ASSET_EXECUTOR_VERSION = "approved-external-assets-v1";

export const EXTERNAL_ASSET_TOOL_IDS = Object.freeze({
  aihubmix: "aihubmix.images.generate",
  "volcengine-ark": "volcengine.video.generate"
});

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_IMAGE_PROVIDER_JSON_BYTES = 42 * 1024 * 1024;
const MAX_VIDEO_PROVIDER_JSON_BYTES = 1024 * 1024;
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;
const VIDEO_POLL_REQUEST_TIMEOUT_MS = 30_000;
const MEDIA_REQUEST_TIMEOUT_MS = 5 * 60_000;
const READER_CANCEL_TIMEOUT_MS = 50;

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeAtomic(path, data) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, path);
}

async function writeJournalVersioned(path, journal) {
  const expectedVersion = Number.isInteger(journal?.stateVersion)
    ? journal.stateVersion
    : 0;
  const written = await writeVersionedJson(path, journal, {
    expectedVersion,
    getVersion: (value) => Number.isInteger(value?.stateVersion)
      ? value.stateVersion
      : 0,
    setVersion: (value, version) => {
      value.stateVersion = version;
    }
  });
  Object.assign(journal, written.value);
  return written.value;
}

function executionError(message, code, extras = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extras);
  return error;
}

function requestTimeoutMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.trunc(parsed))
    : fallback;
}

function createRequestDeadline(value, fallback) {
  const controller = new AbortController();
  const timeoutMs = requestTimeoutMs(value, fallback);
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    const error = new Error(`request exceeded ${timeoutMs}ms deadline`);
    error.name = "TimeoutError";
    error.code = "external_asset_request_timeout";
    controller.abort(error);
  }, timeoutMs);
  return {
    signal: controller.signal,
    get expired() {
      return expired;
    },
    clear() {
      clearTimeout(timer);
    }
  };
}

function waitForAbortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolvePromise, rejectPromise) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      rejectPromise(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolvePromise(value);
      },
      (error) => {
        cleanup();
        rejectPromise(error);
      }
    );
  });
}

async function waitForCleanup(promise, timeoutMs = READER_CANCEL_TIMEOUT_MS) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve(promise).catch(() => undefined),
      new Promise((resolveTimeout) => {
        timer = setTimeout(resolveTimeout, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function cancelResponseBody(response, reason) {
  try {
    await waitForCleanup(response?.body?.cancel?.(reason));
  } catch {
    // The response is already being abandoned; cancellation errors are non-actionable.
  }
}

function ambiguousProviderRequest(code, timedOut = false, extras = {}) {
  return executionError(
    timedOut
      ? "Provider 请求超时且是否执行无法确认，禁止自动重试"
      : "Provider 请求没有得到可确认响应，禁止自动重试",
    code,
    {
      requiresHuman: true,
      ambiguous: true,
      timedOut,
      ...extras
    }
  );
}

function providerToolId(providerId) {
  return EXTERNAL_ASSET_TOOL_IDS[providerId] ?? null;
}

export function externalAssetItems(episode) {
  return (episode.production?.assetPlan?.content?.items ?? []).filter((item) =>
    new Set(["external-image-generation", "external-video-generation"])
      .has(item.productionMethod?.kind)
  );
}

export function requiredExternalAssetToolIds(episode) {
  return [...new Set(externalAssetItems(episode)
    .map((item) => providerToolId(item.productionMethod?.externalProvider))
    .filter(Boolean))];
}

function matchingCall(episode, item) {
  const calls = episode.production?.assetPlan?.content?.executionPolicy?.externalApiCalls ?? [];
  return calls.find((call) =>
    call.providerId === item.productionMethod?.externalProvider &&
    call.model === item.productionMethod?.externalModel &&
    (item.sceneIds ?? []).every((sceneId) => call.sceneIds?.includes(sceneId))
  ) ?? null;
}

function assertExecutionToolAllowed(episode, call, allowedToolIds = []) {
  const toolId = providerToolId(call.providerId);
  if (!toolId) {
    throw executionError("素材 Provider 没有声明受控执行工具", "external_asset_tool_unknown");
  }
  if (
    !episode.control?.allowedTools?.includes(toolId) ||
    !allowedToolIds.includes(toolId)
  ) {
    throw executionError(
      "素材生成工具没有同时获得 Episode 与本次 Worker 调度授权",
      "external_asset_tool_not_allowed",
      { requiresHuman: true }
    );
  }
  return toolId;
}

function authorizationRequest(item, call) {
  return {
    itemId: item.id,
    callId: call.id,
    providerId: call.providerId,
    model: call.model,
    maximumCostUsd: call.maximumCostUsd,
    billingCurrency: call.billing?.currency,
    maximumCost: call.billing?.maximumAmount,
    endpoint: call.endpoint,
    prompt: call.prompt,
    outputSpec: call.outputSpec,
    requestParameters: call.requestParameters,
    rightsDeclarationHash: integrityHash(call.rightsDeclaration ?? null),
    external: true
  };
}

function assertExternalRightsDeclared(call) {
  const validation = validateExternalRightsDeclaration(call?.rightsDeclaration);
  if (!validation.valid) {
    throw executionError(
      "外部素材调用缺少当前候选绑定、经人工核验的结构化权利声明",
      "external_asset_rights_declaration_required",
      { requiresHuman: true, statusCode: 409, details: validation.errors }
    );
  }
  return call.rightsDeclaration;
}

function credentialFor(call, credentials = {}) {
  const name = call.providerId === "aihubmix"
    ? "AIHUBMIX_API_KEY"
    : call.providerId === "volcengine-ark"
      ? "ARK_API_KEY"
      : null;
  const value = name ? credentials[name] : null;
  if (typeof value !== "string" || !value.trim()) {
    throw executionError(
      `缺少 ${name ?? "Provider"} 凭据`,
      "external_asset_credential_missing",
      { requiresHuman: true, credentialName: name }
    );
  }
  return value;
}

async function executionCredentials(options) {
  if (options.credentials) return options.credentials;
  if (options.environment) return options.environment;
  await (options.loadEnvironment ?? loadLocalEnvironment)();
  return process.env;
}

async function readProviderJsonResponse(response, maximumBytes, deadline, code) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await cancelResponseBody(response, "external-asset-provider-json-declared-too-large");
    throw ambiguousProviderRequest(code, false, {
      reasonCode: "external_asset_provider_json_too_large"
    });
  }
  let data;
  try {
    data = await readLimitedResponseBody(response, maximumBytes, deadline, {
      invalidCode: "external_asset_provider_json_body_invalid",
      invalidMessage: "Provider JSON 响应包含无效数据块",
      tooLargeCode: "external_asset_provider_json_too_large",
      tooLargeMessage: "Provider JSON 响应超过允许大小",
      readFailedCode: "external_asset_provider_json_read_failed",
      readFailedMessage: "Provider JSON 响应读取失败",
      emptyCode: "external_asset_provider_json_empty",
      emptyMessage: "Provider JSON 响应为空",
      cancelReason: "external-asset-provider-json"
    });
  } catch (error) {
    if (error?.code === code) throw error;
    throw ambiguousProviderRequest(code, deadline.expired, {
      reasonCode: error?.code ?? "external_asset_provider_json_read_failed"
    });
  }
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    throw executionError(
      "Provider 返回了无法解析的 JSON",
      "external_asset_provider_invalid_json"
    );
  }
}

async function fetchJson(fetchImpl, url, init, code, timeoutMs, maximumBytes) {
  const deadline = createRequestDeadline(timeoutMs, PROVIDER_REQUEST_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await waitForAbortable(
        Promise.resolve().then(() => fetchImpl(url, {
          ...init,
          redirect: "manual",
          signal: deadline.signal
        })),
        deadline.signal
      );
    } catch {
      throw ambiguousProviderRequest(code, deadline.expired);
    }
    const status = Number(response?.status ?? 0);
    if (status >= 300 && status < 400) {
      await cancelResponseBody(response, "provider-redirect-forbidden");
      throw ambiguousProviderRequest(code, false, {
        reasonCode: "external_asset_provider_redirect",
        status
      });
    }
    if (!response?.ok) {
      const authenticationRejected = new Set([401, 403]).has(status);
      await cancelResponseBody(response, "provider-non-success-status");
      throw executionError(
        `Provider 返回 HTTP ${status}`,
        "external_asset_provider_http_error",
        {
          status,
          requiresHuman: authenticationRejected,
          explicitProviderRejection: authenticationRejected
        }
      );
    }
    return await readProviderJsonResponse(response, maximumBytes, deadline, code);
  } finally {
    deadline.clear();
  }
}

async function cancelReader(reader, reason) {
  try {
    await waitForCleanup(reader?.cancel?.(reason));
  } catch {
    // The stream is already being abandoned; cancellation errors are non-actionable.
  }
}

function releaseReader(reader) {
  try {
    reader.releaseLock();
  } catch {
    // Releasing a failed stream must not replace the primary security error.
  }
}

async function readLimitedResponseBody(response, maximumBytes, deadline, profile) {
  const reader = response?.body?.getReader?.();
  if (!reader) {
    throw executionError(
      profile.invalidMessage,
      profile.invalidCode
    );
  }
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await waitForAbortable(reader.read(), deadline.signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        await cancelReader(reader, `${profile.cancelReason}-chunk-invalid`);
        throw executionError(
          profile.invalidMessage,
          profile.invalidCode
        );
      }
      if (value.byteLength === 0) continue;
      if (totalBytes + value.byteLength > maximumBytes) {
        await cancelReader(reader, `${profile.cancelReason}-too-large`);
        throw executionError(
          profile.tooLargeMessage,
          profile.tooLargeCode
        );
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      totalBytes += chunk.length;
    }
  } catch (error) {
    if (deadline.expired) {
      await cancelReader(reader, `${profile.cancelReason}-read-timeout`);
      if (profile.timeoutError) throw profile.timeoutError();
      throw deadline.signal.reason ?? error;
    }
    if (error?.code?.startsWith?.("external_asset_")) throw error;
    await cancelReader(reader, `${profile.cancelReason}-read-failed`);
    throw executionError(profile.readFailedMessage, profile.readFailedCode);
  } finally {
    releaseReader(reader);
  }
  if (totalBytes === 0) {
    throw executionError(profile.emptyMessage, profile.emptyCode);
  }
  return Buffer.concat(chunks, totalBytes);
}

function publicHttpsCause(error, maximumDepth = 6) {
  const seen = new Set();
  let current = error;
  for (let depth = 0; current && depth < maximumDepth; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (
      current.unsafeNetworkTarget === true ||
      current.code?.startsWith?.("public_https_")
    ) {
      return current;
    }
    try {
      current = current.cause;
    } catch {
      break;
    }
  }
  return null;
}

function mediaNetworkError(error, deadline) {
  if (deadline.expired) {
    return executionError(
      "Provider 素材下载超时，未登记不完整文件",
      "external_asset_download_timeout",
      { requiresHuman: true, timedOut: true }
    );
  }
  const networkCause = publicHttpsCause(error) ?? error;
  if (networkCause?.code === "public_https_url_invalid") {
    return executionError(
      "Provider 没有返回有效素材地址",
      "external_asset_media_url_invalid",
      { networkCode: networkCause.code, requiresHuman: true }
    );
  }
  if (networkCause?.unsafeNetworkTarget) {
    return executionError(
      "Provider 素材地址不满足安全下载规则",
      "external_asset_media_url_unsafe",
      { networkCode: networkCause.code ?? null, requiresHuman: true }
    );
  }
  return executionError(
    "Provider 素材下载失败",
    "external_asset_download_failed",
    {
      networkCode: networkCause?.code?.startsWith?.("public_https_")
        ? networkCause.code
        : null
    }
  );
}

async function downloadMedia(fetchImpl, url, maximumBytes, options = {}) {
  const deadline = createRequestDeadline(
    options.mediaRequestTimeoutMs,
    MEDIA_REQUEST_TIMEOUT_MS
  );
  try {
    let response;
    try {
      const fetched = await waitForAbortable(fetchPublicHttps(url, {
        fetchImpl,
        lookupImpl: options.lookupImpl,
        maximumRedirects: options.maximumMediaRedirects ?? 5,
        init: {
          method: "GET",
          signal: deadline.signal
        }
      }), deadline.signal);
      response = fetched.response;
    } catch (error) {
      throw mediaNetworkError(error, deadline);
    }
    if (!response?.ok) {
      await cancelResponseBody(response, "external-asset-media-http-error");
      throw executionError(
        `Provider 素材下载返回 HTTP ${Number(response?.status ?? 0)}`,
        "external_asset_download_http_error"
      );
    }
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      await cancelResponseBody(response, "external-asset-declared-media-too-large");
      throw executionError("Provider 素材超过允许大小", "external_asset_media_too_large");
    }
    return await readLimitedResponseBody(response, maximumBytes, deadline, {
      invalidCode: "external_asset_download_body_invalid",
      invalidMessage: "Provider 素材流包含无效数据块",
      tooLargeCode: "external_asset_media_too_large",
      tooLargeMessage: "Provider 素材超过允许大小",
      readFailedCode: "external_asset_download_failed",
      readFailedMessage: "Provider 素材流读取失败",
      emptyCode: "external_asset_media_invalid_size",
      emptyMessage: "Provider 素材为空",
      cancelReason: "external-asset-media",
      timeoutError: () => executionError(
        "Provider 素材下载超时，未登记不完整文件",
        "external_asset_download_timeout",
        { requiresHuman: true, timedOut: true }
      )
    });
  } catch (error) {
    if (deadline.expired && error?.code === "external_asset_request_timeout") {
      throw mediaNetworkError(error, deadline);
    }
    if (error?.code?.startsWith?.("external_asset_")) throw error;
    throw mediaNetworkError(error, deadline);
  } finally {
    deadline.clear();
  }
}

function decodeImage(value) {
  const candidateParts = value?.candidates?.[0]?.content?.parts ?? [];
  const inlinePart = Array.isArray(candidateParts)
    ? candidateParts.find((part) => part?.inlineData?.data || part?.inline_data?.data)
    : null;
  const encoded = value?.data?.[0]?.b64_json ??
    value?.output?.[0]?.b64_json ??
    value?.predictions?.[0]?.bytesBase64Encoded ??
    value?.generatedImages?.[0]?.image?.imageBytes ??
    inlinePart?.inlineData?.data ??
    inlinePart?.inline_data?.data ??
    null;
  if (typeof encoded !== "string") return null;
  const normalized = encoded.trim();
  if (!normalized) return null;
  const maximumEncodedLength = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
  if (normalized.length > maximumEncodedLength) {
    throw executionError(
      "AIHubMix 内联 Base64 图片超过允许大小",
      "external_asset_image_base64_too_large",
      { requiresHuman: true, ambiguous: true }
    );
  }
  const data = Buffer.from(normalized, "base64");
  if (data.length === 0 || data.length > MAX_IMAGE_BYTES) {
    throw executionError("AIHubMix 生图结果为空或超过允许大小", "external_asset_image_invalid_size");
  }
  return data;
}

function imageUrl(value) {
  const output = value?.output?.[0];
  return value?.data?.[0]?.url ??
    (typeof output === "string" ? output : output?.url) ??
    value?.predictions?.[0]?.url ??
    null;
}

function taskId(value) {
  return value?.id ?? value?.task_id ?? value?.taskId ?? null;
}

function taskStatus(value) {
  return String(value?.status ?? value?.Status ?? "").toLowerCase();
}

function taskVideoUrl(value) {
  return value?.content?.video_url ??
    value?.content?.videoUrl ??
    value?.Content?.VideoURL ??
    value?.output?.video_url ??
    value?.output?.videoUrl ??
    null;
}

function completionTokens(value) {
  const raw = value?.usage?.completion_tokens ?? value?.Usage?.CompletionTokens;
  if (!new Set(["number", "string"]).has(typeof raw)) return null;
  if (typeof raw === "string" && !/^(?:0|[1-9]\d*)$/u.test(raw.trim())) return null;
  const tokens = Number(raw);
  return Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null;
}

async function executeImage(call, credential, options) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const usesGeminiNative = call.endpoint.startsWith("https://aihubmix.com/gemini/");
  options.consumePaidAttempt?.();
  const value = await fetchJson(fetchImpl, call.endpoint, {
    method: "POST",
    headers: usesGeminiNative
      ? {
          "x-goog-api-key": credential,
          "content-type": "application/json"
        }
      : {
          authorization: `Bearer ${credential}`,
          "content-type": "application/json"
        },
    body: JSON.stringify(usesGeminiNative
      ? call.requestParameters
      : { ...call.requestParameters, prompt: call.prompt })
  },
  "external_asset_image_response_ambiguous",
  options.providerRequestTimeoutMs,
  MAX_IMAGE_PROVIDER_JSON_BYTES
  );
  const embedded = decodeImage(value);
  const data = embedded ?? await downloadMedia(
    fetchImpl,
    imageUrl(value),
    MAX_IMAGE_BYTES,
    options
  );
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!data.subarray(0, 8).equals(pngSignature)) {
    throw executionError("AIHubMix 返回的素材不是 PNG", "external_asset_image_format_invalid");
  }
  return {
    data,
    extension: ".png",
    type: "image",
    providerExecutionId: value?.id ?? value?.created ?? null,
    usage: value?.usage ?? null,
    executedCalls: 1
  };
}

async function executeVideo(call, credential, options) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let id = options.existingTaskId ?? null;
  let executedCalls = 0;
  if (!id) {
    options.consumePaidAttempt?.();
    const submitted = await fetchJson(fetchImpl, call.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(call.requestParameters)
    },
    "external_asset_video_submission_ambiguous",
    options.providerRequestTimeoutMs,
    MAX_VIDEO_PROVIDER_JSON_BYTES
    );
    id = taskId(submitted);
    if (typeof id !== "string" || !id.trim()) {
      throw executionError("火山方舟没有返回任务 ID", "external_asset_video_task_missing");
    }
    executedCalls = 1;
    await options.onSubmitted?.(id);
  }
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const maxPollAttempts = options.maxPollAttempts ?? 240;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  }));
  let completed = null;
  for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
    const value = await fetchJson(fetchImpl, `${call.endpoint}/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${credential}` }
    },
    "external_asset_video_poll_ambiguous",
    options.videoPollRequestTimeoutMs,
    MAX_VIDEO_PROVIDER_JSON_BYTES
    );
    const status = taskStatus(value);
    if (new Set(["succeeded", "success", "completed", "done"]).has(status)) {
      completed = value;
      break;
    }
    if (new Set(["failed", "cancelled", "canceled", "expired"]).has(status)) {
      throw executionError("火山方舟视频任务未成功", "external_asset_video_task_failed");
    }
    if (attempt + 1 < maxPollAttempts) await sleep(pollIntervalMs);
  }
  if (!completed) {
    throw executionError("火山方舟视频任务轮询超时，保留任务 ID 等待恢复", "external_asset_video_poll_timeout", {
      requiresHuman: true,
      resumable: true
    });
  }
  const tokens = completionTokens(completed);
  if (tokens === null) {
    throw executionError(
      "火山方舟成功响应缺少有效的非负整数 completion_tokens",
      "external_asset_video_usage_missing"
    );
  }
  const actualCny = tokens * call.billing.unitPrice / call.billing.unitPriceBasis;
  if (actualCny > call.billing.maximumAmount) {
    throw executionError("火山方舟实际用量超过批准的人民币上限", "external_asset_native_budget_exceeded", {
      requiresHuman: true
    });
  }
  const data = await downloadMedia(
    fetchImpl,
    taskVideoUrl(completed),
    MAX_VIDEO_BYTES,
    options
  );
  if (data.length < 12 || data.subarray(4, 8).toString("ascii") !== "ftyp") {
    throw executionError("火山方舟返回的素材不是 MP4", "external_asset_video_format_invalid");
  }
  return {
    data,
    extension: ".mp4",
    type: "video",
    providerExecutionId: id,
    usage: { completion_tokens: tokens },
    actualNativeAmount: actualCny,
    executedCalls
  };
}

export async function executeApprovedExternalAssetCall(
  episode,
  input,
  options = {}
) {
  const item = externalAssetItems(episode).find((candidate) => candidate.id === input.itemId);
  const call = item ? matchingCall(episode, item) : null;
  if (!item || !call || call.id !== input.callId) {
    throw executionError("外部素材调用不在当前批准方案中", "external_asset_call_not_approved");
  }
  assertExternalRightsDeclared(call);
  if (!assetExecutionPreflightValid(episode)) {
    throw executionError(
      "当前候选尚未通过零生成预检",
      "asset_execution_preflight_required"
    );
  }
  assertAssetExecutionAuthorized(episode, authorizationRequest(item, call));
  const toolId = assertExecutionToolAllowed(episode, call, options.allowedToolIds ?? []);
  const providerSupported = new Set(["aihubmix", "volcengine-ark"]).has(call.providerId);
  if (!providerSupported) {
    throw executionError("外部素材 Provider 不受支持", "external_asset_provider_unsupported");
  }
  const injectedExternalBoundary = typeof options.fetch === "function";
  const capabilityRequired = options.requireSideEffectCapability === true ||
    !injectedExternalBoundary ||
    Boolean(options.sideEffectGrant) ||
    typeof options.authorizeSideEffect === "function";
  let sideEffectGrant = null;
  let consumePaidAttempt = null;
  if (capabilityRequired) {
    const attemptCostUsd = Number(call.maximumCostUsd);
    if (!Number.isFinite(attemptCostUsd) || attemptCostUsd < 0) {
      throw executionError(
        "外部素材批准没有有限费用上限",
        "side_effect_capability_budget_unbounded",
        { statusCode: 403 }
      );
    }
    const capabilitySpec = {
      episodeId: episode.id,
      operation: options.capabilityOperation ?? "external-asset:execute",
      scopes: ["network.request", "paid.invoke"],
      maxCalls: 1,
      maxCostUsd: attemptCostUsd
    };
    sideEffectGrant = requireSideEffectGrant(options, capabilitySpec);
    consumePaidAttempt = () => consumeSideEffectGrantUsage(
      sideEffectGrant,
      capabilitySpec,
      { calls: 1, costUsd: attemptCostUsd }
    );
  }
  const credential = credentialFor(call, await executionCredentials(options));
  const result = call.providerId === "aihubmix"
    ? await executeImage(call, credential, { ...options, consumePaidAttempt })
    : call.providerId === "volcengine-ark"
      ? await executeVideo(call, credential, { ...options, consumePaidAttempt })
      : null;
  return {
    ...result,
    toolId,
    item: structuredClone(item),
    call: structuredClone(call)
  };
}

function completedAssetValid(journal, media, call) {
  const declarationHash = integrityHash(call?.rightsDeclaration ?? null);
  let expectedRights;
  try {
    expectedRights = {
      ...buildExternalGenerationRights(call?.rightsDeclaration, {
        acquiredAt: journal?.asset?.createdAt
      }),
      declarationHash
    };
  } catch {
    return false;
  }
  return Boolean(
    journal?.status === "completed" &&
    journal.asset &&
    media.length === journal.asset.bytes &&
    sha256(media) === journal.asset.sha256 &&
    journal.asset.rightsDeclarationHash === declarationHash &&
    integrityHash(journal.asset.rights) === integrityHash(expectedRights) &&
    validateAssetRights(journal.asset).valid
  );
}

async function readJournal(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function journalIdentity(episode, item, call, at) {
  const candidateHash = episode.reviewCheckpoints.assetExecution.currentCandidate.candidateHash;
  const rightsDeclarationHash = integrityHash(call.rightsDeclaration);
  return {
    schemaVersion: EXTERNAL_ASSET_EXECUTOR_VERSION,
    stateVersion: 0,
    attempt: 1,
    history: [],
    status: "started",
    episodeId: episode.id,
    candidateHash,
    assetPlanVersion: episode.production.assetPlan.version,
    planItemId: item.id,
    callId: call.id,
    providerId: call.providerId,
    model: call.model,
    endpoint: call.endpoint,
    promptHash: sha256(call.prompt),
    requestParametersHash: integrityHash(call.requestParameters),
    rightsDeclarationHash,
    rightsDeclaration: structuredClone(call.rightsDeclaration),
    startedAt: at,
    submittedAt: null,
    completedAt: null,
    providerExecutionId: null,
    usage: null,
    asset: null
  };
}

function externalAssetLocations(episode, options = {}) {
  const candidateHash = episode.reviewCheckpoints.assetExecution.currentCandidate.candidateHash;
  const candidatePrefix = candidateHash.slice(0, 16);
  return {
    candidateHash,
    outputRoot: options.outputDirectory
      ? ensureInside(publicRoot, resolve(publicRoot, options.outputDirectory))
      : resolve(episodePublicDirectory(episode.id), "generated-assets", candidatePrefix),
    publicPrefix: options.publicPrefix
      ? String(options.publicPrefix).replace(/^\/+|\/+$/gu, "")
      : `episodes/${episode.id}/generated-assets/${candidatePrefix}`
  };
}

function journalBoundToCall(journal, episode, item, call) {
  const rightsDeclarationHash = integrityHash(call?.rightsDeclaration ?? null);
  return Boolean(
    journal?.episodeId === episode.id &&
    journal?.candidateHash ===
      episode.reviewCheckpoints.assetExecution.currentCandidate.candidateHash &&
    journal?.assetPlanVersion === episode.production.assetPlan.version &&
    journal?.planItemId === item.id &&
    journal?.callId === call.id &&
    journal?.providerId === call.providerId &&
    journal?.model === call.model &&
    journal?.endpoint === call.endpoint &&
    journal?.promptHash === sha256(call.prompt) &&
    journal?.requestParametersHash === integrityHash(call.requestParameters) &&
    journal?.rightsDeclarationHash === rightsDeclarationHash &&
    integrityHash(journal?.rightsDeclaration ?? null) === rightsDeclarationHash
  );
}

function retrySafeRejectedJournal(journal, episode, item, call) {
  return Boolean(
    journalBoundToCall(journal, episode, item, call) &&
    journal.status === "rejected" &&
    journal.retrySafe === true &&
    new Set([401, 403]).has(journal.providerHttpStatus) &&
    journal.submittedAt === null &&
    journal.providerExecutionId === null &&
    journal.asset === null
  );
}

function manualRetryAuthorizedJournal(journal, episode, item, call) {
  const review = journal?.manualAdjudication;
  const observations = review?.observations;
  return Boolean(
    journalBoundToCall(journal, episode, item, call) &&
    journal.status === "retry_authorized" &&
    journal.retrySafe === true &&
    Number.isInteger(journal.stateVersion) &&
    journal.stateVersion >= 1 &&
    journal.attempt === 1 &&
    journal.submittedAt === null &&
    journal.completedAt === null &&
    journal.providerExecutionId === null &&
    journal.asset === null &&
    review?.schemaVersion === 1 &&
    typeof review.id === "string" &&
    review.id.length > 0 &&
    review.decision === "provider_no_record_no_charge" &&
    review.sourceAttempt === journal.attempt &&
    /^[a-f0-9]{64}$/u.test(String(review.sourceReceiptHash ?? "")) &&
    review.oneTime === true &&
    review.consumedAt === null &&
    review.consumedByAttempt === null &&
    observations?.providerActivityChecked === true &&
    observations?.providerBillingChecked === true &&
    observations?.providerRecordFound === false &&
    observations?.chargeFound === false &&
    !(journal.history ?? []).some((entry) => entry?.manualAdjudication)
  );
}

function retryAuthorizedJournal(journal, episode, item, call) {
  return retrySafeRejectedJournal(journal, episode, item, call) ||
    manualRetryAuthorizedJournal(journal, episode, item, call);
}

function resumableSubmittedJournal(journal, episode, item, call) {
  return Boolean(
    journalBoundToCall(journal, episode, item, call) &&
    journal.status === "submitted" &&
    typeof journal.providerExecutionId === "string" &&
    journal.providerExecutionId.trim() &&
    typeof journal.submittedAt === "string" &&
    journal.asset === null
  );
}

function markJournalRejected(journal, httpStatus, now) {
  return {
    ...journal,
    status: "rejected",
    rejectedAt: timestamp(now),
    retrySafe: true,
    failureCode: "external_asset_provider_http_error",
    providerHttpStatus: httpStatus
  };
}

const MANUAL_RETRY_CONFIRMATION = "I_CONFIRM_NO_PROVIDER_RECORD_AND_NO_CHARGE";

function validatedManualRetryObservations(value, receiptStartedAt) {
  const observations = value && typeof value === "object" ? value : {};
  const checkedAt = String(observations.checkedAt ?? "");
  const windowStartAt = String(observations.windowStartAt ?? "");
  const windowEndAt = String(observations.windowEndAt ?? "");
  const checkedAtMs = Date.parse(checkedAt);
  const windowStartMs = Date.parse(windowStartAt);
  const windowEndMs = Date.parse(windowEndAt);
  const receiptStartedMs = Date.parse(receiptStartedAt);
  if (
    observations.providerActivityChecked !== true ||
    observations.providerBillingChecked !== true ||
    observations.providerRecordFound !== false ||
    observations.chargeFound !== false ||
    !Number.isFinite(checkedAtMs) ||
    !Number.isFinite(windowStartMs) ||
    !Number.isFinite(windowEndMs) ||
    !Number.isFinite(receiptStartedMs) ||
    windowStartMs > receiptStartedMs ||
    windowEndMs < receiptStartedMs ||
    checkedAtMs < windowEndMs ||
    checkedAtMs - receiptStartedMs < 60_000
  ) {
    throw executionError(
      "人工重试裁决缺少请求日志与账单的完整时间窗证据",
      "external_asset_retry_observations_invalid",
      { statusCode: 400 }
    );
  }
  const latestProviderLogAt = observations.latestProviderLogAt == null
    ? null
    : String(observations.latestProviderLogAt);
  if (
    latestProviderLogAt !== null &&
    (!Number.isFinite(Date.parse(latestProviderLogAt)) ||
      Date.parse(latestProviderLogAt) > checkedAtMs)
  ) {
    throw executionError(
      "人工重试裁决的 Provider 日志时间无效",
      "external_asset_retry_observations_invalid",
      { statusCode: 400 }
    );
  }
  return {
    providerActivityChecked: true,
    providerBillingChecked: true,
    providerRecordFound: false,
    chargeFound: false,
    checkedAt,
    windowStartAt,
    windowEndAt,
    latestProviderLogAt
  };
}

function assertManualRetryInput(input) {
  const note = String(input.note ?? "").trim();
  if (
    input.decision !== "provider_no_record_no_charge" ||
    input.confirmation !== MANUAL_RETRY_CONFIRMATION ||
    !note ||
    note.length > 500 ||
    !/^[a-f0-9]{64}$/u.test(String(input.expectedReceiptHash ?? "")) ||
    !Number.isInteger(input.expectedReceiptStateVersion) ||
    input.expectedReceiptStateVersion < 0
  ) {
    throw executionError(
      "人工重试裁决没有完整确认当前收据与残余重复扣费风险",
      "external_asset_retry_confirmation_invalid",
      { statusCode: 400 }
    );
  }
  return note;
}

export async function adjudicateAmbiguousExternalAssetReceipt(
  episodeId,
  input = {},
  options = {}
) {
  const actor = String(options.actor ?? "").trim();
  if (!actor.startsWith("human:") || actor.length > 128) {
    throw executionError(
      "人工重试裁决缺少可信服务端操作者身份",
      "external_asset_retry_operator_required",
      { statusCode: 403 }
    );
  }
  const injectedSideEffectDependencies = Boolean(
    options.outputDirectory &&
    typeof options.readEpisode === "function" &&
    typeof options.writeEpisode === "function" &&
    typeof options.appendEvent === "function"
  );
  if (options.requireSideEffectCapability === true || !injectedSideEffectDependencies) {
    requireSideEffectGrant(options, {
      episodeId,
      operation: options.capabilityOperation ??
        "external-asset:retry-adjudication",
      scopes: ["state.write", "filesystem.write"],
      maxCalls: 0,
      maxCostUsd: 0
    });
  }
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const releaseOperation = acquireEpisodeOperation(
    episodeId,
    "external-asset-retry-adjudication",
    { conflictMessage: "这一期已有 Agent 或人工裁决正在运行，请等待完成" }
  );
  const operationId =
    `operation:external-asset-retry-adjudication:${episodeId}:${randomUUID()}`;
  let operationClaimed = false;
  try {
    const episode = await readState(episodeId);
    const candidateHash = String(input.candidateHash ?? "");
    const itemId = String(input.itemId ?? "");
    const callId = String(input.callId ?? "");
    const note = assertManualRetryInput(input);
    const checkpoint = episode.reviewCheckpoints?.assetExecution;
    if (
      !assetExecutionApprovalValid(episode) ||
      !assetExecutionPreflightValid(episode) ||
      candidateHash !== checkpoint?.currentCandidate?.candidateHash
    ) {
      throw executionError(
        "人工重试裁决没有绑定当前已批准并通过预检的候选",
        "external_asset_retry_candidate_conflict",
        { statusCode: 409 }
      );
    }
    const item = externalAssetItems(episode).find((candidate) => candidate.id === itemId);
    const call = item ? matchingCall(episode, item) : null;
    if (!item || !call || call.id !== callId || call.providerId !== "aihubmix") {
      throw executionError(
        "人工重试裁决没有绑定当前 AIHubMix 生图调用",
        "external_asset_retry_call_conflict",
        { statusCode: 409 }
      );
    }
    if ((episode.assets ?? []).some((asset) => asset.planItemId === itemId)) {
      throw executionError(
        "该素材已经登记产物，不能再次授权生成",
        "external_asset_retry_asset_exists",
        { statusCode: 409 }
      );
    }
    const assetStep = episode.pipeline.find((step) => step.agent === "asset-agent");
    const awaitingAdjudication = assetStep?.status === "blocked" &&
      assetStep.requiresHuman === true &&
      (assetStep.findings ?? []).includes("external_asset_image_response_ambiguous");
    const alreadyAdjudicated = assetStep?.status === "ready" &&
      assetStep.requiresHuman === false &&
      (assetStep.findings ?? []).includes("external_asset_manual_retry_authorized");
    if (!awaitingAdjudication && !alreadyAdjudicated) {
      throw executionError(
        "Asset Agent 当前不处于首张图网络不确定人工处置状态",
        "external_asset_retry_pipeline_conflict",
        { statusCode: 409 }
      );
    }

    claimPersistedEpisodeOperation(episode, {
      id: operationId,
      kind: "external-asset-retry-adjudication",
      now: options.now
    });
    await writeState(episode);
    operationClaimed = true;

    const { outputRoot } = externalAssetLocations(episode, options);
    const journalPath = ensureInside(outputRoot, resolve(outputRoot, `${item.id}.receipt.json`));
    const raw = await readFile(journalPath);
    const journal = JSON.parse(raw.toString("utf8"));
    const sourceReceiptHash = sha256(raw);
    const existingReview = journal?.manualAdjudication;
    let adjudicatedJournal = journal;
    let unchanged = false;
    if (
      manualRetryAuthorizedJournal(journal, episode, item, call) &&
      existingReview.sourceReceiptHash === input.expectedReceiptHash &&
      existingReview.decision === input.decision
    ) {
      unchanged = true;
    } else {
      const actualStateVersion = Number.isInteger(journal?.stateVersion)
        ? journal.stateVersion
        : 0;
      if (
        !journalBoundToCall(journal, episode, item, call) ||
        journal.status !== "started" ||
        journal.attempt !== 1 ||
        journal.submittedAt !== null ||
        journal.completedAt !== null ||
        journal.providerExecutionId !== null ||
        journal.asset !== null ||
        (journal.history ?? []).some((entry) => entry?.manualAdjudication) ||
        actualStateVersion !== input.expectedReceiptStateVersion ||
        sourceReceiptHash !== input.expectedReceiptHash
      ) {
        throw executionError(
          "外部素材收据已经变化或不能安全授权重试",
          "external_asset_retry_receipt_conflict",
          { statusCode: 409 }
        );
      }
      const observations = validatedManualRetryObservations(
        input.observations,
        journal.startedAt
      );
      const at = timestamp(options.now);
      const review = {
        schemaVersion: 1,
        id: `external-asset-retry:${episodeId}:${randomUUID()}`,
        decision: "provider_no_record_no_charge",
        actor: actor.slice(0, 80),
        decidedAt: at,
        note,
        sourceAttempt: journal.attempt,
        sourceReceiptHash,
        observations,
        oneTime: true,
        consumedAt: null,
        consumedByAttempt: null
      };
      adjudicatedJournal = {
        ...journal,
        stateVersion: actualStateVersion,
        status: "retry_authorized",
        retrySafe: true,
        retryAuthorizedAt: at,
        failureCode: "external_asset_provider_no_record_no_charge",
        manualAdjudication: review
      };
      adjudicatedJournal = await writeJournalVersioned(journalPath, adjudicatedJournal);
    }

    const review = adjudicatedJournal.manualAdjudication;
    const reviewAlreadyRecorded = (episode.production?.assetExecutionReceiptReviews ?? [])
      .some((entry) => entry.id === review.id);
    if (!reviewAlreadyRecorded) {
      episode.production.assetExecutionReceiptReviews = [
        ...(episode.production?.assetExecutionReceiptReviews ?? []),
        {
          id: review.id,
          decision: review.decision,
          actor: review.actor,
          decidedAt: review.decidedAt,
          candidateHash,
          itemId,
          callId,
          sourceAttempt: review.sourceAttempt,
          sourceReceiptHash: review.sourceReceiptHash,
          receiptStateVersion: adjudicatedJournal.stateVersion
        }
      ];
      episode.history = [
        ...(episode.history ?? []),
        {
          at: review.decidedAt,
          type: "external-asset-manual-retry-adjudication",
          status: "retry_authorized",
          candidateHash,
          itemId,
          callId,
          adjudicationId: review.id,
          message: "人工核对 Provider 请求日志与账单后，授权该不确定调用仅重试一次"
        }
      ];
    }
    const assetIndex = episode.pipeline.findIndex((step) => step.agent === "asset-agent");
    episode.pipeline[assetIndex] = {
      ...episode.pipeline[assetIndex],
      status: "ready",
      progress: 0,
      message: "首张图无 Provider 记录与扣费的人工裁决已完成，可以进行一次受控重试",
      findings: ["external_asset_manual_retry_authorized"],
      requiresApproval: null,
      requiresHuman: false,
      finishedAt: null,
      lastError: null
    };
    releasePersistedEpisodeOperation(episode, operationId);
    episode.updatedAt = timestamp(options.now);
    await writeState(episode);
    operationClaimed = false;
    await recordEvent({
      type: "external-asset.retry_authorized",
      episodeId,
      candidateHash,
      itemId,
      callId,
      adjudicationId: review.id,
      sourceAttempt: review.sourceAttempt,
      sourceReceiptHash: review.sourceReceiptHash,
      receiptStateVersion: adjudicatedJournal.stateVersion,
      idempotencyKey: `external-asset.retry_authorized:${episodeId}:${review.id}`
    });
    return {
      episode,
      journal: structuredClone(adjudicatedJournal),
      adjudication: structuredClone(review),
      unchanged
    };
  } catch (error) {
    if (operationClaimed) {
      const current = await readState(episodeId).catch(() => null);
      if (current && releasePersistedEpisodeOperation(current, operationId)) {
        current.updatedAt = timestamp(options.now);
        await writeState(current).catch(() => undefined);
      }
    }
    throw error;
  } finally {
    releaseOperation();
  }
}

export async function buildApprovedExternalAssets(episode, options = {}) {
  const items = externalAssetItems(episode);
  for (const item of items) {
    const call = matchingCall(episode, item);
    if (!call) {
      throw executionError("外部素材条目没有唯一调用合同", "external_asset_call_missing");
    }
    assertExternalRightsDeclared(call);
  }
  if (!assetExecutionPreflightValid(episode)) {
    throw executionError(
      "当前候选尚未通过零生成预检",
      "asset_execution_preflight_required"
    );
  }
  const candidateSummary = episode.reviewCheckpoints?.assetExecution
    ?.currentCandidate?.summary;
  const maximumCalls = Number.isInteger(candidateSummary?.externalApiCallCount)
    ? candidateSummary.externalApiCallCount
    : items.length;
  const maximumCostUsd = Number.isFinite(candidateSummary?.maximumPaidCostUsd)
    ? Number(candidateSummary.maximumPaidCostUsd.toFixed(6))
    : Number.POSITIVE_INFINITY;
  const injectedExternalBoundary = Boolean(
    options.outputDirectory && typeof options.fetch === "function"
  );
  const capabilityRequired = options.requireSideEffectCapability === true ||
    !injectedExternalBoundary ||
    Boolean(options.sideEffectGrant) ||
    typeof options.authorizeSideEffect === "function";
  let sideEffectGrant = null;
  if (capabilityRequired) {
    if (!Number.isFinite(maximumCostUsd)) {
      throw executionError(
        "外部素材批准没有有限费用上限",
        "side_effect_capability_budget_unbounded",
        { statusCode: 403 }
      );
    }
    sideEffectGrant = requireSideEffectGrant(options, {
      episodeId: episode.id,
      operation: options.capabilityOperation ?? "external-asset:execute",
      scopes: ["filesystem.write", "network.request", "paid.invoke"],
      maxCalls: maximumCalls,
      maxCostUsd: maximumCostUsd
    });
  }
  const executionOptions = { ...options };
  delete executionOptions.authorizeSideEffect;
  delete executionOptions.sideEffectGrant;
  const existingByItem = new Map((episode.assets ?? [])
    .filter((asset) => asset.planItemId)
    .map((asset) => [asset.planItemId, asset]));
  const { candidateHash, outputRoot, publicPrefix } = externalAssetLocations(episode, options);
  await mkdir(outputRoot, { recursive: true });
  const assets = [];
  const receipts = [];
  let executedCalls = 0;
  let accountedCalls = 0;
  let accountedCostUsd = 0;
  const accountedCallIds = [];
  for (const item of items) {
    const call = matchingCall(episode, item);
    if (!call) {
      throw executionError("外部素材条目没有唯一调用合同", "external_asset_call_missing");
    }
    const extension = item.productionMethod.kind === "external-image-generation"
      ? ".png"
      : ".mp4";
    const mediaPath = ensureInside(outputRoot, resolve(outputRoot, `${item.id}${extension}`));
    const journalPath = ensureInside(outputRoot, resolve(outputRoot, `${item.id}.receipt.json`));
    const journal = await readJournal(journalPath);
    if (journal?.status === "completed") {
      if (!journalBoundToCall(journal, episode, item, call)) {
        throw executionError(
          "外部素材完成收据与当前批准调用不一致",
          "external_asset_receipt_integrity_failed",
          { requiresHuman: true }
        );
      }
      const media = await readFile(mediaPath);
      if (!completedAssetValid(journal, media, call)) {
        throw executionError(
          "外部素材收据与文件完整性不一致",
          "external_asset_receipt_integrity_failed",
          { requiresHuman: true }
        );
      }
      assets.push(structuredClone(journal.asset));
      receipts.push(`${publicPrefix}/${item.id}.receipt.json`);
      const registered = existingByItem.get(item.id);
      const alreadyAccounted = Boolean(
        registered?.candidateHash === candidateHash &&
        registered?.externalCallId === call.id &&
        registered?.sha256 === journal.asset.sha256
      );
      if (!alreadyAccounted) {
        accountedCalls += journal.asset.externalApiCalls ?? 1;
        accountedCostUsd += journal.asset.maximumPaidCostUsd ?? call.maximumCostUsd;
        accountedCallIds.push(call.id);
      }
      continue;
    }
    if (journal?.status === "submitted" && !resumableSubmittedJournal(
      journal,
      episode,
      item,
      call
    )) {
      throw executionError(
        "外部素材已提交收据无法安全绑定 Provider 任务，禁止自动重复付费请求",
        "external_asset_execution_ambiguous",
        { requiresHuman: true }
      );
    }
    if (
      journal &&
      !resumableSubmittedJournal(journal, episode, item, call) &&
      !retryAuthorizedJournal(journal, episode, item, call)
    ) {
      throw executionError(
        "外部素材调用状态不确定，禁止自动重复付费请求",
        "external_asset_execution_ambiguous",
        { requiresHuman: true }
      );
    }
    const at = timestamp(options.now);
    const providerRejected = retrySafeRejectedJournal(journal, episode, item, call);
    const manuallyAuthorized = manualRetryAuthorizedJournal(journal, episode, item, call);
    const retryHistory = providerRejected
      ? [
          ...(journal.history ?? []),
          {
            status: "rejected",
            rejectedAt: journal.rejectedAt,
            failureCode: journal.failureCode,
            providerHttpStatus: journal.providerHttpStatus,
            retrySafe: true
          }
        ]
      : manuallyAuthorized
        ? [
            ...(journal.history ?? []),
            {
              status: "started",
              startedAt: journal.startedAt,
              failureCode: "external_asset_image_response_ambiguous",
              retrySafe: false,
              manualAdjudication: {
                ...journal.manualAdjudication,
                consumedAt: at,
                consumedByAttempt: Number(journal.attempt ?? 1) + 1
              }
            }
          ]
        : [];
    const activeJournal = providerRejected || manuallyAuthorized
      ? {
          ...journalIdentity(episode, item, call, at),
          stateVersion: Number.isInteger(journal.stateVersion) ? journal.stateVersion : 0,
          attempt: Number(journal.attempt ?? 1) + 1,
          history: retryHistory,
          ...(manuallyAuthorized
            ? {
                manualAdjudication: {
                  ...journal.manualAdjudication,
                  consumedAt: at,
                  consumedByAttempt: Number(journal.attempt ?? 1) + 1
                }
              }
            : {})
        }
      : journal ?? journalIdentity(episode, item, call, at);
    if (!journal || retryHistory.length > 0) {
      await writeJournalVersioned(journalPath, activeJournal);
    }
    let result;
    try {
      result = await executeApprovedExternalAssetCall(episode, {
        itemId: item.id,
        callId: call.id
      }, {
        ...executionOptions,
        sideEffectGrant: sideEffectGrant ?? undefined,
        requireSideEffectCapability: Boolean(sideEffectGrant),
        existingTaskId: activeJournal.status === "submitted"
          ? activeJournal.providerExecutionId
          : null,
        onSubmitted: async (id) => {
          activeJournal.status = "submitted";
          activeJournal.submittedAt = timestamp(options.now);
          activeJournal.providerExecutionId = id;
          await writeJournalVersioned(journalPath, activeJournal);
          await options.onSubmitted?.(id, { item, call });
        }
      });
    } catch (error) {
      if (
        error?.code === "external_asset_provider_http_error" &&
        error?.explicitProviderRejection === true &&
        new Set([401, 403]).has(error?.status) &&
        activeJournal.status === "started" &&
        activeJournal.submittedAt === null &&
        activeJournal.providerExecutionId === null
      ) {
        Object.assign(activeJournal, markJournalRejected(
          activeJournal,
          error.status,
          options.now
        ));
        await writeJournalVersioned(journalPath, activeJournal);
      }
      throw error;
    }
    await writeAtomic(mediaPath, result.data);
    const previousVersion = Number(existingByItem.get(item.id)?.version ?? 0);
    const asset = {
      id: `external-${item.id}-v${previousVersion + 1}`,
      planItemId: item.id,
      version: previousVersion + 1,
      type: result.type,
      path: `${publicPrefix}/${item.id}${result.extension}`,
      source: "approved-external-generation",
      executor: item.productionMethod.executor,
      providerId: call.providerId,
      model: call.model,
      externalCallId: call.id,
      candidateHash,
      promptHash: sha256(call.prompt),
      requestParametersHash: integrityHash(call.requestParameters),
      rightsDeclarationHash: integrityHash(call.rightsDeclaration),
      providerExecutionId: result.providerExecutionId,
      bytes: result.data.length,
      sha256: sha256(result.data),
      createdAt: at,
      rights: {
        ...buildExternalGenerationRights(call.rightsDeclaration, { acquiredAt: at }),
        declarationHash: integrityHash(call.rightsDeclaration)
      },
      privacy: "requires-human-review",
      verified: false,
      externalApiCalls: 1,
      maximumPaidCostUsd: call.maximumCostUsd,
      billingCurrency: call.billing?.currency ?? "USD",
      maximumNativeCost: call.billing?.maximumAmount ?? call.maximumCostUsd,
      actualNativeAmount: result.actualNativeAmount ?? null,
      usage: result.usage ?? null,
      receiptPath: `${publicPrefix}/${item.id}.receipt.json`
    };
    activeJournal.status = "completed";
    activeJournal.completedAt = timestamp(options.now);
    activeJournal.providerExecutionId = result.providerExecutionId;
    activeJournal.usage = result.usage ?? null;
    activeJournal.asset = asset;
    await writeJournalVersioned(journalPath, activeJournal);
    assets.push(asset);
    receipts.push(asset.receiptPath);
    executedCalls += result.executedCalls;
    const registered = existingByItem.get(item.id);
    const alreadyAccounted = Boolean(
      registered?.candidateHash === candidateHash &&
      registered?.externalCallId === call.id &&
      registered?.sha256 === asset.sha256
    );
    if (!alreadyAccounted) {
      accountedCalls += asset.externalApiCalls;
      accountedCostUsd += call.maximumCostUsd;
      accountedCallIds.push(call.id);
    }
  }
  return {
    assets,
    receipts,
    executedCalls,
    accountedCalls,
    accountedCallIds,
    accountedCostUsd: Number(accountedCostUsd.toFixed(6))
  };
}
