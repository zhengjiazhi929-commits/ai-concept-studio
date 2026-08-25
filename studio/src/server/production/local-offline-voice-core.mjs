// Internal implementation. Production callers must use local-offline-voice.mjs.
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { inspectFileIntegrity, integrityHash } from "../../shared/integrity.mjs";
import {
  ensureInside,
  episodePublicDirectory,
  studioOutputRoot,
  workspaceRelativePath,
  workspaceRoot
} from "../../shared/paths.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
import {
  invalidateReviewForGate,
  nextAssetBundleRevision,
  resetApprovalForVersion
} from "../../shared/workflow.mjs";
import {
  LOCAL_TTS_MODEL,
  LOCAL_TTS_SAMPLE_RATE,
  LOCAL_TTS_VOICES
} from "../../video/agent-skill-local-tts-plan.mjs";
import {
  SHORT_LOCAL_TTS_DURATION_SECONDS,
  SHORT_LOCAL_TTS_EPISODE_ID,
  SHORT_LOCAL_TTS_NETWORK_GUARDS,
  SHORT_LOCAL_TTS_PACING_PROFILE_VERSION,
  SHORT_LOCAL_TTS_VOICE_ID,
  assertShortLocalTtsRenderedSegments,
  buildShortLocalTtsSegments
} from "../../video/agent-skill-short-local-tts-candidate.mjs";
import {
  acquireEpisodeOperation,
  claimPersistedEpisodeOperation,
  releasePersistedEpisodeOperation
} from "../control/episode-operation-lock.mjs";
import { approvalValidForGate } from "../control/policy-engine.mjs";
import { kernelSnapshot } from "../control/workflow-kernel.mjs";
import {
  assetExecutionApprovalRecordValid,
  assetExecutionApprovalValid
} from "../reviews/asset-execution-checkpoint.mjs";
import { wavDurationSeconds } from "./voice.mjs";

const CANDIDATE_VERIFIER_VERSION = "local-offline-tts-candidate-verifier-v1";
const REBIND_CANDIDATE_VERIFIER_VERSION = "local-offline-tts-rebind-verifier-v2";
const HUMAN_AUTHORIZATION_SCHEMA = "local-offline-tts-human-authorization-v1";
const KOKORO_LICENSE = "Apache-2.0";
const PCM_WINDOW_SECONDS = 1;
const PCM_ACTIVE_WINDOW_MIN_ROOT_MEAN_SQUARE_AMPLITUDE = 128;
// A 60-second narration must contain meaningful signal in at least half of its
// one-second windows. Regional coverage and the consecutive-silence limit below
// remain independent guards against clustering that signal into one short span.
const PCM_MIN_ACTIVE_WINDOW_RATIO = 0.5;
const PCM_REQUIRED_ACTIVE_REGIONS = 8;
const PCM_REGION_SECONDS = 6;
const PCM_MAX_CONSECUTIVE_INACTIVE_WINDOWS = 8;
const PCM_MIN_PEAK_AMPLITUDE = 256;
const PCM_MIN_PEAK_TO_PEAK_AMPLITUDE = 512;
const PCM_MIN_ROOT_MEAN_SQUARE_AMPLITUDE = 32;
const CANDIDATE_MANIFEST_MAX_BYTES = 1_048_576;
const EXPECTED_PCM_DATA_BYTES =
  SHORT_LOCAL_TTS_DURATION_SECONDS * LOCAL_TTS_SAMPLE_RATE * 2;
const CANDIDATE_WAV_MAX_HEADER_BYTES = 65_536;
const CANDIDATE_WAV_MAX_BYTES =
  EXPECTED_PCM_DATA_BYTES + CANDIDATE_WAV_MAX_HEADER_BYTES;
const JSON_ARTIFACT_MAX_BYTES = 8 * 1_048_576;
const VOICE_PLAN_MAX_BYTES = 1_048_576;
const PRIOR_REVIEW_MEDIA_MAX_BYTES = 64 * 1_048_576;
const SERVICE_POLICY = Symbol("local-offline-voice-service-policy");
const SERVICE_POLICY_OVERRIDE_KEYS = Object.freeze([
  "registration",
  "priorReview",
  "candidatePaths",
  "candidateRoot"
]);
const LOCAL_VOICE_PROVENANCE = Object.freeze({
  source: "pretrained-model-voice-package",
  sourceRepoId: LOCAL_TTS_MODEL.repoId,
  sourceRevision: LOCAL_TTS_MODEL.revision,
  license: KOKORO_LICENSE,
  cloneConsentRequired: false
});

export const LOCAL_OFFLINE_TTS_V002_REGISTRATION = Object.freeze({
  episodeId: SHORT_LOCAL_TTS_EPISODE_ID,
  candidateId: "agent-skill-short-local-tts-zm_010-v002",
  candidateVersion: 2,
  manifestFileName: "short-local-tts-zm_010-v002-manifest.json",
  manifestSha256: "683a56a0c555740447f1ab56a32d1bc082200ad5ca419e26185bb0a584aa4bfe",
  wavFileName: "short-local-tts-zm_010-v002.wav",
  wavSha256: "ee8374cd36dfe0503ebf8f6332595c024264ab79c52abd4302d24e232d89d612",
  confirmation: "register-approved-local-offline-tts-v002",
  approvedBy: "Zhengjiazhi",
  humanDecisionNote:
    "Zhengjiazhi 本轮明确批准精确 v002 候选，并授权正式登记；登记后只允许 Voice Agent 进入机器审核。"
});

export const LOCAL_OFFLINE_TTS_REBIND_INSPECTION = Object.freeze({
  schemaVersion: "local-offline-tts-rebind-candidate-v1",
  verifierVersion: REBIND_CANDIDATE_VERIFIER_VERSION,
  confirmation: "register-approved-local-offline-tts-rebind-v1"
});

const LOCAL_OFFLINE_TTS_REBIND_PRIOR_REVIEW = Object.freeze({
  manifestPath:
    "outputs/studio/agent-skill-tool-mcp-60s-20260813/review-candidates/storyboard-v004-transition-review-v001/review-manifest.json",
  manifestSha256: "bf769005322ebe8fe59d3257ebdccc7dd32fb5c9b78586e90be8ec6d37f7c12e",
  mediaPath:
    "outputs/studio/agent-skill-tool-mcp-60s-20260813/review-candidates/storyboard-v004-transition-review-v001/review-60s.mp4",
  mediaSha256: "977d16de9484991fd758fd6206cccb48eb00eaee83ac3155a0348639f734ebcb",
  mediaBytes: 3_306_304,
  storyboardVersion: 4
});

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function registrationError(message, code, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function assertEqual(actual, expected, message, code = "local_tts_candidate_invalid") {
  if (actual !== expected) throw registrationError(message, code);
}

function parseJson(data, label) {
  try {
    return JSON.parse(data.toString("utf8"));
  } catch {
    throw registrationError(`${label} 不是有效 JSON`, "local_tts_manifest_invalid");
  }
}

function createServicePolicy(input = {}) {
  const registration = Object.freeze({
    ...(input.registration ?? LOCAL_OFFLINE_TTS_V002_REGISTRATION)
  });
  const priorReview = Object.freeze({
    ...(input.priorReview ?? LOCAL_OFFLINE_TTS_REBIND_PRIOR_REVIEW)
  });
  const candidateRoot = resolve(input.candidateRoot ?? studioOutputRoot);
  const candidatePaths = input.candidatePaths
    ? Object.freeze({
        manifestPath: ensureInside(
          candidateRoot,
          resolve(input.candidatePaths.manifestPath)
        ),
        wavPath: ensureInside(candidateRoot, resolve(input.candidatePaths.wavPath))
      })
    : null;
  return Object.freeze({ registration, priorReview, candidateRoot, candidatePaths });
}

const DEFAULT_SERVICE_POLICY = createServicePolicy();

function assertNoServicePolicyOverrides(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw registrationError(
      "本地旁白调用选项无效",
      "local_tts_options_invalid",
      400
    );
  }
  const overrideKey = SERVICE_POLICY_OVERRIDE_KEYS.find((key) =>
    Object.prototype.hasOwnProperty.call(options, key));
  if (overrideKey) {
    throw registrationError(
      `生产本地旁白入口禁止覆盖固定策略：${overrideKey}`,
      "local_tts_policy_override_forbidden",
      400
    );
  }
}

function servicePolicy(options = {}) {
  return options[SERVICE_POLICY] ?? DEFAULT_SERVICE_POLICY;
}

function bindServicePolicy(options, policy) {
  assertNoServicePolicyOverrides(options);
  return { ...options, [SERVICE_POLICY]: policy };
}

function registrationConfig(options = {}) {
  return servicePolicy(options).registration;
}

function priorReviewConfig(options = {}) {
  return servicePolicy(options).priorReview;
}

function candidatePaths(options = {}) {
  const policy = servicePolicy(options);
  if (policy.candidatePaths) {
    return {
      manifestPath: policy.candidatePaths.manifestPath,
      wavPath: policy.candidatePaths.wavPath,
      allowedRoot: policy.candidateRoot
    };
  }
  const fixed = policy.registration;
  const directory = ensureInside(studioOutputRoot, resolve(studioOutputRoot, fixed.episodeId));
  return {
    manifestPath: ensureInside(studioOutputRoot, resolve(directory, fixed.manifestFileName)),
    wavPath: ensureInside(studioOutputRoot, resolve(directory, fixed.wavFileName)),
    allowedRoot: studioOutputRoot
  };
}

function pinnedModelPaths() {
  const cacheRoot = process.env.AI_CONCEPT_STUDIO_KOKORO_ROOT?.trim()
    ? resolve(process.env.AI_CONCEPT_STUDIO_KOKORO_ROOT)
    : resolve(homedir(), ".cache", "ai-concept-studio", "kokoro312");
  const directory = resolve(cacheRoot, "model-v1.1-zh");
  return {
    modelPath: resolve(directory, LOCAL_TTS_MODEL.fileName),
    configPath: resolve(directory, "config.json"),
    voicePath: resolve(directory, "voices", `${SHORT_LOCAL_TTS_VOICE_ID}.pt`)
  };
}

export async function assertNoSymlinkRegularFile(filePath, allowedRoot, options = {}) {
  const inspectLink = options.lstat ?? lstat;
  const resolveRealpath = options.realpath ?? realpath;
  const expectedPath = resolve(filePath);
  let file;
  let actualPath;
  try {
    file = await inspectLink(expectedPath);
    actualPath = resolve(await resolveRealpath(expectedPath));
  } catch {
    throw registrationError(
      "本地旁白候选文件不存在或无法读取",
      "local_tts_candidate_file_invalid"
    );
  }
  if (
    file.isSymbolicLink()
    || !file.isFile()
    || file.nlink !== 1
    || actualPath !== expectedPath
  ) {
    throw registrationError(
      "本地旁白候选及运行时文件必须是非符号链接的普通文件",
      "local_tts_candidate_symlink_rejected"
    );
  }
  if (allowedRoot) ensureInside(allowedRoot, actualPath);
  return { path: actualPath, bytes: file.size };
}

function assertCandidateReadSizeLimits(manifestFile, wavFile) {
  if (manifestFile.bytes > CANDIDATE_MANIFEST_MAX_BYTES) {
    throw registrationError(
      "本地旁白候选 manifest 超过 1 MiB 读取上限",
      "local_tts_candidate_file_too_large"
    );
  }
  if (wavFile.bytes > CANDIDATE_WAV_MAX_BYTES) {
    throw registrationError(
      "本地旁白候选 WAV 超过固定 PCM 数据与有限容器头的读取上限",
      "local_tts_candidate_file_too_large"
    );
  }
}

function assertPreReadFileSize(
  file,
  {
    label,
    expectedBytes = null,
    maxBytes
  }
) {
  if (!Number.isSafeInteger(file?.bytes) || file.bytes < 0) {
    throw registrationError(
      `${label} 缺少有效的读取前文件大小`,
      "local_tts_artifact_size_invalid"
    );
  }
  if (file.bytes > maxBytes) {
    throw registrationError(
      `${label} 超过读取前硬上限`,
      "local_tts_artifact_file_too_large"
    );
  }
  if (
    expectedBytes !== null
    && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)
  ) {
    throw registrationError(
      `${label} 缺少有效的已绑定文件大小`,
      "local_tts_artifact_size_invalid"
    );
  }
  if (
    expectedBytes !== null
    && file.bytes !== expectedBytes
  ) {
    throw registrationError(
      `${label} 读取前字节数与已绑定值不匹配`,
      "local_tts_artifact_size_mismatch"
    );
  }
}

function assertRegistrationInput(
  input,
  verification,
  fixed = LOCAL_OFFLINE_TTS_V002_REGISTRATION
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw registrationError("本地旁白登记请求无效", "local_tts_registration_invalid", 400);
  }
  const allowed = new Set([
    "candidateId",
    "manifestSha256",
    "candidateHash",
    "machineVerificationId",
    "machineVerificationHash",
    "confirmation"
  ]);
  const unexpected = Object.keys(input).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw registrationError(
      `本地旁白登记请求包含未授权字段：${unexpected.join(", ")}`,
      "local_tts_registration_scope_invalid",
      400
    );
  }
  if (
    input.candidateId !== fixed.candidateId
    || input.manifestSha256 !== fixed.manifestSha256
    || input.confirmation !== fixed.confirmation
    || typeof input.candidateHash !== "string"
    || typeof input.machineVerificationId !== "string"
    || typeof input.machineVerificationHash !== "string"
  ) {
    throw registrationError(
      "只能登记当前机器验证且人工批准的本地离线 TTS v002 精确候选",
      "local_tts_candidate_conflict"
    );
  }
  if (
    verification
    && (
      input.candidateHash !== verification.candidateHash
      || input.machineVerificationId !== verification.machineVerificationId
      || input.machineVerificationHash !== verification.machineVerification.verificationHash
    )
  ) {
    throw registrationError(
      "登记请求未绑定当前 v002 的精确候选哈希与机器验证记录",
      "local_tts_candidate_verification_conflict"
    );
  }
}

function currentStageBinding(episode, stage, productionKey) {
  if (!approvalValidForGate(episode, stage)) {
    throw registrationError(
      `${stage} 不再是当前机器审核通过且人工批准的版本`,
      "local_tts_source_approval_stale"
    );
  }
  const artifact = episode.production?.[productionKey];
  const approval = episode.approvals?.[stage];
  return {
    version: artifact.version,
    artifactPath: artifact.artifactPath,
    artifactHash: approval.artifactHash,
    reviewReportId: approval.reviewReportId
  };
}

function assertAuthorizedVoiceGate(episode) {
  const voiceStep = episode.pipeline?.find((step) => step.agent === "voice-agent");
  const waitingInput = kernelSnapshot(episode).legalActions.some((action) =>
    action.action === "wait_for_input"
      && action.workerId === "voice-agent"
      && action.inputType === "authorized_voice_audio"
  );
  if (
    !waitingInput
    || voiceStep?.status !== "blocked"
    || voiceStep.requiresHuman !== true
    || episode.voice?.status !== "unconfigured"
    || episode.voice?.mode !== null
    || episode.voice?.audioPath !== null
  ) {
    throw registrationError(
      "Episode 不再停在 authorized_voice_audio 人工输入 Gate",
      "local_tts_voice_gate_conflict"
    );
  }
  return voiceStep;
}

export function inspectPcmWav(data) {
  wavDurationSeconds(data);
  let format = null;
  let dataSize = null;
  let dataStart = null;
  for (let offset = 12; offset + 8 <= data.length;) {
    const chunkId = data.toString("ascii", offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkSize;
    if (end > data.length) {
      throw registrationError("WAV 数据块超出文件范围", "local_tts_wav_invalid");
    }
    if (chunkId === "fmt ") {
      format = {
        audioFormat: data.readUInt16LE(start),
        channels: data.readUInt16LE(start + 2),
        sampleRate: data.readUInt32LE(start + 4),
        byteRate: data.readUInt32LE(start + 8),
        blockAlign: data.readUInt16LE(start + 12),
        bitsPerSample: data.readUInt16LE(start + 14)
      };
    }
    if (chunkId === "data") {
      dataSize = chunkSize;
      dataStart = start;
    }
    offset = end + (chunkSize % 2);
  }
  if (
    format?.audioFormat !== 1
    || format.channels !== 1
    || format.sampleRate !== LOCAL_TTS_SAMPLE_RATE
    || format.bitsPerSample !== 16
    || format.blockAlign !== 2
    || format.byteRate !== LOCAL_TTS_SAMPLE_RATE * 2
    || dataSize !== SHORT_LOCAL_TTS_DURATION_SECONDS * LOCAL_TTS_SAMPLE_RATE * 2
  ) {
    throw registrationError(
      "正式旁白必须为 60 秒、24 kHz、单声道、PCM 16-bit WAV",
      "local_tts_wav_contract_invalid"
    );
  }
  const sampleCount = dataSize / 2;
  let minimumSample = 32_767;
  let maximumSample = -32_768;
  let peakAmplitude = 0;
  let sumOfSquares = 0;
  const samplesPerWindow = format.sampleRate * PCM_WINDOW_SECONDS;
  const windowCount = Math.ceil(sampleCount / samplesPerWindow);
  const windows = Array.from({ length: windowCount }, () => ({
    count: 0,
    minimumSample: 32_767,
    maximumSample: -32_768,
    sumOfSquares: 0
  }));
  for (let offset = dataStart; offset < dataStart + dataSize; offset += 2) {
    const sample = data.readInt16LE(offset);
    const amplitude = Math.abs(sample);
    if (sample < minimumSample) minimumSample = sample;
    if (sample > maximumSample) maximumSample = sample;
    if (amplitude > peakAmplitude) peakAmplitude = amplitude;
    sumOfSquares += sample * sample;
    const sampleIndex = (offset - dataStart) / 2;
    const window = windows[Math.floor(sampleIndex / samplesPerWindow)];
    window.count += 1;
    if (sample < window.minimumSample) window.minimumSample = sample;
    if (sample > window.maximumSample) window.maximumSample = sample;
    window.sumOfSquares += sample * sample;
  }
  const peakToPeakAmplitude = maximumSample - minimumSample;
  const rootMeanSquareAmplitude = Math.sqrt(sumOfSquares / sampleCount);
  const activeWindows = windows.map((window) => {
    const windowRootMeanSquareAmplitude = Math.sqrt(
      window.sumOfSquares / window.count
    );
    const windowPeakToPeakAmplitude = window.maximumSample - window.minimumSample;
    return windowRootMeanSquareAmplitude
      >= PCM_ACTIVE_WINDOW_MIN_ROOT_MEAN_SQUARE_AMPLITUDE
      && windowPeakToPeakAmplitude >= PCM_MIN_PEAK_TO_PEAK_AMPLITUDE;
  });
  const activeWindowCount = activeWindows.filter(Boolean).length;
  const activeWindowRatio = activeWindowCount / activeWindows.length;
  const windowsPerRegion = PCM_REGION_SECONDS / PCM_WINDOW_SECONDS;
  const activeRegionCount = new Set(
    activeWindows.flatMap((active, index) =>
      active ? [Math.floor(index / windowsPerRegion)] : [])
  ).size;
  let longestInactiveWindowRun = 0;
  let inactiveWindowRun = 0;
  for (const active of activeWindows) {
    inactiveWindowRun = active ? 0 : inactiveWindowRun + 1;
    if (inactiveWindowRun > longestInactiveWindowRun) {
      longestInactiveWindowRun = inactiveWindowRun;
    }
  }
  if (
    peakAmplitude < PCM_MIN_PEAK_AMPLITUDE
    || peakToPeakAmplitude < PCM_MIN_PEAK_TO_PEAK_AMPLITUDE
    || rootMeanSquareAmplitude < PCM_MIN_ROOT_MEAN_SQUARE_AMPLITUDE
    || activeWindowRatio < PCM_MIN_ACTIVE_WINDOW_RATIO
    || activeRegionCount < PCM_REQUIRED_ACTIVE_REGIONS
    || longestInactiveWindowRun > PCM_MAX_CONSECUTIVE_INACTIVE_WINDOWS
  ) {
    throw registrationError(
      "正式旁白 PCM 能量、时间覆盖或连续静音段不符合固定门禁",
      "local_tts_wav_energy_invalid"
    );
  }
  return { ...format, dataSize, durationSeconds: wavDurationSeconds(data) };
}

async function assertPinnedRuntimeFiles(options = {}) {
  const inspect = options.inspectFileIntegrity ?? inspectFileIntegrity;
  const paths = pinnedModelPaths();
  const voice = LOCAL_TTS_VOICES.find(({ id }) => id === SHORT_LOCAL_TTS_VOICE_ID);
  await Promise.all([
    assertNoSymlinkRegularFile(paths.modelPath, null, options),
    assertNoSymlinkRegularFile(paths.configPath, null, options),
    assertNoSymlinkRegularFile(paths.voicePath, null, options)
  ]);
  const [model, config, voicePackage] = await Promise.all([
    inspect(paths.modelPath),
    inspect(paths.configPath),
    inspect(paths.voicePath)
  ]);
  assertEqual(model.sha256, LOCAL_TTS_MODEL.sha256, "Kokoro 模型哈希已变化");
  assertEqual(config.sha256, LOCAL_TTS_MODEL.configSha256, "Kokoro 配置哈希已变化");
  assertEqual(voicePackage.sha256, voice?.sha256, "zm_010 音色包哈希已变化");
  return { model, config, voicePackage };
}

function normalizedOfflineGeneration(generation) {
  return {
    mode: generation.mode,
    offlineEnvironmentVerified: generation.offlineEnvironmentVerified,
    networkPolicy: generation.networkPolicy,
    networkGuards: [...generation.networkGuards],
    paidApiCalls: generation.paidApiCalls,
    externalInferenceCalls: generation.externalInferenceCalls,
    modelDownloadCallsDuringGeneration: generation.modelDownloadCallsDuringGeneration,
    textUploadCalls: generation.textUploadCalls,
    maximumPaidCostUsd: generation.maximumPaidCostUsd
  };
}

function assertManifestGeneration(manifest) {
  const generation = manifest.generation;
  if (
    generation?.mode !== "local-offline-kokoro"
    || generation.offlineEnvironmentVerified !== true
    || generation.networkPolicy !== "deny-all"
    || !Array.isArray(generation.networkGuards)
    || !SHORT_LOCAL_TTS_NETWORK_GUARDS.every((guard) => generation.networkGuards.includes(guard))
    || generation.paidApiCalls !== 0
    || generation.externalInferenceCalls !== 0
    || generation.modelDownloadCallsDuringGeneration !== 0
    || generation.textUploadCalls !== 0
    || generation.maximumPaidCostUsd !== 0
  ) {
    throw registrationError(
      "v002 manifest 缺少完整的零网络、零外部调用或零费用证明",
      "local_tts_offline_proof_invalid"
    );
  }
}

function currentAssetExecutionBinding(episode, options = {}) {
  const recordValid = assetExecutionApprovalRecordValid(episode);
  const approvalValidator = options.validateAssetExecutionApproval
    ?? assetExecutionApprovalValid;
  const valid = recordValid && (
    options.recordOnly === true || approvalValidator(episode)
  );
  if (!valid) {
    throw registrationError(
      "素材执行批准记录已经失效",
      "local_tts_asset_approval_stale"
    );
  }
  const checkpoint = episode.reviewCheckpoints.assetExecution;
  return {
    version: checkpoint.currentCandidate.version,
    candidateHash: checkpoint.currentCandidate.candidateHash,
    planHash: checkpoint.currentCandidate.planHash,
    approvedAt: checkpoint.humanApproval.at,
    authorizedToolIds: [...(checkpoint.humanApproval.authorizedToolIds ?? [])]
  };
}

function sameAssetExecutionBinding(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertHistoricalAssetExecutionBinding(episode, binding) {
  const history = episode.reviewCheckpoints?.assetExecution?.history ?? [];
  const machineReview = history.find((entry) =>
    entry?.type === "machine-review"
      && entry.version === binding?.version
      && entry.candidateHash === binding?.candidateHash
      && entry.status === "passed"
      && typeof entry.reviewId === "string"
  );
  const humanApproval = history.find((entry) =>
    entry?.type === "human-approval"
      && entry.version === binding?.version
      && entry.candidateHash === binding?.candidateHash
      && entry.machineReviewId === machineReview?.reviewId
      && entry.decision === "approved"
      && entry.at === binding?.approvedAt
  );
  if (
    !machineReview
    || !humanApproval
    || !Number.isInteger(binding?.version)
    || !/^[a-f0-9]{64}$/u.test(String(binding?.candidateHash ?? ""))
    || !/^[a-f0-9]{64}$/u.test(String(binding?.planHash ?? ""))
    || !Array.isArray(binding?.authorizedToolIds)
    || binding.authorizedToolIds.length !== 0
  ) {
    throw registrationError(
      "本地旁白绑定的原始素材执行批准记录无法核验",
      "local_tts_source_asset_approval_invalid"
    );
  }
}

function assertCurrentAssetExecutionAllowsVoiceReuse(episode, sourceBinding, options = {}) {
  const currentBinding = currentAssetExecutionBinding(episode, {
    validateAssetExecutionApproval: options.validateAssetExecutionApproval
  });
  const policy = episode.production?.assetPlan?.content?.executionPolicy;
  const items = episode.production?.assetPlan?.content?.items;
  const unsafeItemIds = Array.isArray(items)
    ? items.filter((item) =>
        item?.productionMethod?.externalProvider != null
        || item?.productionMethod?.externalModel != null
        || !new Set(["local-code-animation", "deferred-voice-agent"])
          .has(item?.productionMethod?.kind)
        || item?.estimatedCost?.maximumCostUsd !== 0
      ).map((item) => item?.id ?? "unknown")
    : ["missing-items"];
  if (
    policy?.mode !== "local-only"
    || !Array.isArray(policy.externalApiCalls)
    || policy.externalApiCalls.length !== 0
    || policy.maximumPaidCostUsd !== 0
    || currentBinding.authorizedToolIds.length !== 0
    || episode.production?.assetPlan?.content?.generationProfile != null
    || (policy.billingCurrencies?.length ?? 0) !== 0
    || (policy.nativeCurrencyCaps?.length ?? 0) !== 0
    || policy.budgetNormalization != null
    || unsafeItemIds.length !== 0
  ) {
    throw registrationError(
      "已登记旁白只允许复用于新的本地零调用素材候选",
      "local_tts_asset_reuse_scope_invalid"
    );
  }
  const reused = !sameAssetExecutionBinding(currentBinding, sourceBinding);
  const attestation = {
    schemaVersion: "local-offline-voice-asset-reuse-v1",
    sourceAssetExecution: structuredClone(sourceBinding),
    currentAssetExecution: structuredClone(currentBinding),
    reused,
    policy: {
      mode: policy.mode,
      externalApiCallCount: policy.externalApiCalls.length,
      maximumPaidCostUsd: policy.maximumPaidCostUsd,
      authorizedToolIds: [...currentBinding.authorizedToolIds],
      unsafeItemIds
    }
  };
  attestation.verificationHash = integrityHash(attestation);
  return { currentBinding, attestation };
}

async function inspectCandidateForEpisode(episode, options = {}) {
  const fixed = registrationConfig(options);
  if (episode.id !== fixed.episodeId) {
    throw registrationError("v002 候选未绑定这个 Episode", "local_tts_episode_conflict");
  }
  if (options.requireVoiceGate !== false) assertAuthorizedVoiceGate(episode);
  const script = currentStageBinding(episode, "script", "scriptDraft");
  const storyboard = currentStageBinding(episode, "storyboard", "storyboardDraft");
  const sourceAssetBinding = options.sourceAssetExecutionBinding
    ? structuredClone(options.sourceAssetExecutionBinding)
    : currentAssetExecutionBinding(episode, {
        validateAssetExecutionApproval: options.validateAssetExecutionApproval
      });
  const readBytes = options.readFile ?? readFile;
  const paths = candidatePaths(options);
  const [manifestFile, wavFile] = await Promise.all([
    assertNoSymlinkRegularFile(paths.manifestPath, paths.allowedRoot, options),
    assertNoSymlinkRegularFile(paths.wavPath, paths.allowedRoot, options)
  ]);
  assertCandidateReadSizeLimits(manifestFile, wavFile);
  const [manifestData, wavData] = await Promise.all([
    readBytes(paths.manifestPath),
    readBytes(paths.wavPath)
  ]);
  assertEqual(manifestFile.bytes, manifestData.length, "v002 manifest 读取期间发生变化");
  assertEqual(wavFile.bytes, wavData.length, "v002 WAV 读取期间发生变化");
  assertEqual(sha256(manifestData), fixed.manifestSha256, "v002 manifest 哈希不匹配");
  assertEqual(sha256(wavData), fixed.wavSha256, "v002 WAV 哈希不匹配");

  const manifest = parseJson(manifestData, "v002 manifest");
  assertEqual(manifest.id, fixed.candidateId, "v002 candidate ID 不匹配");
  assertEqual(manifest.episodeId, episode.id, "v002 manifest 未绑定当前 Episode");
  assertEqual(manifest.version, fixed.candidateVersion, "v002 manifest 版本不匹配");
  assertEqual(manifest.status, "human-review-candidate", "v002 不再是人工试听候选");
  assertEqual(manifest.audio?.outputPath, workspaceRelativePath(paths.wavPath), "v002 WAV 路径不匹配");
  assertEqual(manifest.audio?.bytes, wavData.length, "v002 WAV 字节数不匹配");
  assertEqual(manifest.audio?.sha256, fixed.wavSha256, "v002 WAV 来源哈希不匹配");
  assertEqual(manifest.audio?.durationSeconds, SHORT_LOCAL_TTS_DURATION_SECONDS, "v002 时长不匹配");
  assertEqual(manifest.audio?.sampleRate, LOCAL_TTS_SAMPLE_RATE, "v002 采样率不匹配");
  assertEqual(manifest.audio?.channels, 1, "v002 声道数不匹配");
  const wav = inspectPcmWav(wavData);

  assertEqual(JSON.stringify(manifest.source?.script), JSON.stringify(script), "v002 脚本绑定已失效");
  assertEqual(
    JSON.stringify(manifest.source?.storyboard),
    JSON.stringify(storyboard),
    "v002 分镜绑定已失效"
  );
  const voicePlanRecord = episode.production?.voicePlan;
  const voicePlanPath = ensureInside(
    workspaceRoot,
    resolve(workspaceRoot, voicePlanRecord?.artifactPath ?? "")
  );
  const voicePlanFile = await assertNoSymlinkRegularFile(voicePlanPath, workspaceRoot, options);
  assertPreReadFileSize(voicePlanFile, {
    label: "voice plan",
    expectedBytes: manifest.source?.voicePlan?.bytes,
    maxBytes: VOICE_PLAN_MAX_BYTES
  });
  const voicePlanData = await readBytes(voicePlanPath);
  assertEqual(voicePlanFile.bytes, voicePlanData.length, "voice plan 读取期间发生变化");
  const voicePlan = parseJson(voicePlanData, "voice plan");
  const segmentPlan = buildShortLocalTtsSegments(episode, voicePlan);
  const voicePlanHash = sha256(voicePlanData);
  const narrationHash = sha256(segmentPlan.narration);
  const subtitlesHash = sha256(JSON.stringify(episode.subtitles));
  const segmentPlanHash = sha256(JSON.stringify(segmentPlan.segments));
  assertEqual(manifest.source?.voicePlan?.version, voicePlanRecord.version, "voice plan 版本不匹配");
  assertEqual(
    manifest.source?.voicePlan?.artifactPath,
    voicePlanRecord.artifactPath,
    "voice plan 路径不匹配"
  );
  assertEqual(manifest.source?.voicePlan?.sha256, voicePlanHash, "voice plan 哈希不匹配");
  assertEqual(
    manifest.source?.voicePlan?.narrationSha256,
    narrationHash,
    "voice plan 旁白哈希不匹配"
  );
  assertEqual(manifest.source?.subtitlesSha256, subtitlesHash, "字幕哈希不匹配");
  assertEqual(manifest.source?.segmentPlanSha256, segmentPlanHash, "九镜旁白方案哈希不匹配");
  assertEqual(
    manifest.source?.pacingProfileVersion,
    SHORT_LOCAL_TTS_PACING_PROFILE_VERSION,
    "节奏配置版本不匹配"
  );
  assertEqual(
    JSON.stringify(manifest.source?.assetExecution),
    JSON.stringify(sourceAssetBinding),
    "本地旁白的原始素材执行候选绑定不匹配"
  );

  assertEqual(manifest.model?.repoId, LOCAL_TTS_MODEL.repoId, "Kokoro repo 不匹配");
  assertEqual(manifest.model?.revision, LOCAL_TTS_MODEL.revision, "Kokoro revision 不匹配");
  assertEqual(manifest.model?.fileName, LOCAL_TTS_MODEL.fileName, "Kokoro 文件名不匹配");
  assertEqual(manifest.model?.sha256, LOCAL_TTS_MODEL.sha256, "Kokoro 模型哈希不匹配");
  assertEqual(manifest.model?.verifiedSha256, LOCAL_TTS_MODEL.sha256, "Kokoro 实测哈希不匹配");
  assertEqual(manifest.model?.configSha256, LOCAL_TTS_MODEL.configSha256, "Kokoro 配置哈希不匹配");
  assertEqual(
    manifest.model?.verifiedConfigSha256,
    LOCAL_TTS_MODEL.configSha256,
    "Kokoro 实测配置哈希不匹配"
  );
  assertEqual(manifest.model?.codeRepoId, LOCAL_TTS_MODEL.codeRepoId, "Kokoro 代码仓库不匹配");
  assertEqual(manifest.model?.codeRevision, LOCAL_TTS_MODEL.codeRevision, "Kokoro 代码版本不匹配");
  assertEqual(manifest.model?.license, KOKORO_LICENSE, "Kokoro 许可证不匹配");
  const voice = LOCAL_TTS_VOICES.find(({ id }) => id === SHORT_LOCAL_TTS_VOICE_ID);
  assertEqual(manifest.voice?.id, SHORT_LOCAL_TTS_VOICE_ID, "本地音色 ID 不匹配");
  assertEqual(manifest.voice?.packageSha256, voice?.sha256, "本地音色哈希不匹配");
  assertManifestGeneration(manifest);
  assertShortLocalTtsRenderedSegments(segmentPlan, manifest.audio?.segments);
  const runtime = await assertPinnedRuntimeFiles(options);
  const episodeZeroCallLedger = assertZeroCallLedger(episode);

  const normalizedCandidate = {
    schemaVersion: 1,
    verifierVersion: CANDIDATE_VERIFIER_VERSION,
    episodeId: episode.id,
    candidateId: fixed.candidateId,
    candidateVersion: fixed.candidateVersion,
    manifest: {
      path: workspaceRelativePath(paths.manifestPath),
      bytes: manifestData.length,
      sha256: fixed.manifestSha256
    },
    wav: {
      path: workspaceRelativePath(paths.wavPath),
      bytes: wavData.length,
      sha256: fixed.wavSha256,
      ...wav,
      renderedSegmentsSha256: sha256(JSON.stringify(manifest.audio.segments))
    },
    source: {
      script,
      storyboard,
      voicePlan: {
        version: voicePlanRecord.version,
        artifactPath: voicePlanRecord.artifactPath,
        bytes: voicePlanData.length,
        sha256: voicePlanHash,
        narrationSha256: narrationHash
      },
      subtitlesSha256: subtitlesHash,
      segmentPlanSha256: segmentPlanHash,
      pacingProfileVersion: SHORT_LOCAL_TTS_PACING_PROFILE_VERSION,
      assetExecution: sourceAssetBinding
    },
    model: {
      repoId: LOCAL_TTS_MODEL.repoId,
      revision: LOCAL_TTS_MODEL.revision,
      fileName: LOCAL_TTS_MODEL.fileName,
      sha256: LOCAL_TTS_MODEL.sha256,
      bytes: runtime.model.bytes,
      configSha256: LOCAL_TTS_MODEL.configSha256,
      configBytes: runtime.config.bytes,
      codeRepoId: LOCAL_TTS_MODEL.codeRepoId,
      codeRevision: LOCAL_TTS_MODEL.codeRevision,
      license: KOKORO_LICENSE
    },
    voice: {
      id: SHORT_LOCAL_TTS_VOICE_ID,
      packageSha256: voice.sha256,
      packageBytes: runtime.voicePackage.bytes,
      ...LOCAL_VOICE_PROVENANCE
    },
    generation: normalizedOfflineGeneration(manifest.generation),
    episodeZeroCallLedger
  };
  const candidateHash = integrityHash(normalizedCandidate);
  const checks = [
    "current-script-approval",
    "current-storyboard-approval",
    "current-v9-asset-execution-approval",
    "voice-plan-subtitles-nine-scenes-exact",
    "candidate-files-no-symlink",
    "candidate-manifest-and-wav-integrity",
    "pcm-wav-60s-contract",
    "pcm-wav-energy-floor",
    "pinned-model-config-voice-integrity",
    "license-and-code-revision-bound",
    "zero-network-zero-external-calls",
    "episode-zero-call-ledger"
  ];
  const machineVerificationId = integrityHash({
    schemaVersion: 1,
    verifierVersion: CANDIDATE_VERIFIER_VERSION,
    candidateHash,
    checks
  });
  const machineVerification = {
    schemaVersion: 1,
    id: machineVerificationId,
    status: "passed",
    verifierVersion: CANDIDATE_VERIFIER_VERSION,
    candidateHash,
    checks: [...checks]
  };
  machineVerification.verificationHash = integrityHash(machineVerification);
  return {
    candidateHash,
    machineVerificationId,
    machineVerification,
    checks,
    normalizedCandidate,
    manifest,
    manifestData,
    wavData,
    wav,
    paths,
    runtime
  };
}

function inspectionResponse(verified, fixed = LOCAL_OFFLINE_TTS_V002_REGISTRATION) {
  return {
    episodeId: fixed.episodeId,
    candidateId: fixed.candidateId,
    candidateVersion: fixed.candidateVersion,
    manifestSha256: fixed.manifestSha256,
    wavSha256: fixed.wavSha256,
    candidateHash: verified.candidateHash,
    machineVerificationId: verified.machineVerificationId,
    machineVerification: structuredClone(verified.machineVerification),
    verifierVersion: CANDIDATE_VERIFIER_VERSION,
    checks: [...verified.checks],
    audio: {
      bytes: verified.wavData.length,
      durationSeconds: verified.wav.durationSeconds,
      sampleRate: verified.wav.sampleRate,
      channels: verified.wav.channels,
      bitsPerSample: verified.wav.bitsPerSample
    },
    registrationRequest: {
      candidateId: fixed.candidateId,
      manifestSha256: fixed.manifestSha256,
      candidateHash: verified.candidateHash,
      machineVerificationId: verified.machineVerificationId,
      machineVerificationHash: verified.machineVerification.verificationHash,
      confirmation: fixed.confirmation
    }
  };
}

async function inspectLocalOfflineTtsCandidateInternal(episodeId, options = {}) {
  const fixed = registrationConfig(options);
  if (episodeId !== fixed.episodeId) {
    throw registrationError("v002 候选只绑定当前短片 Episode", "local_tts_episode_conflict");
  }
  const episode = options.episode ?? await (options.readEpisode ?? readEpisode)(episodeId);
  return inspectionResponse(await inspectCandidateForEpisode(episode, options), fixed);
}

function nextVoiceFileName(files) {
  const highest = files.reduce((current, file) => {
    const match = /^voice-v(\d{3})\.wav$/u.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return `voice-v${String(highest + 1).padStart(3, "0")}.wav`;
}

function ledgerSnapshotHash(episode) {
  return integrityHash({
    budget: episode.control?.budget ?? null,
    controlMetrics: episode.control?.metrics ?? null,
    ai: episode.production?.ai ?? null,
    assetExecutionCheckpoint: episode.reviewCheckpoints?.assetExecution ?? null,
    externalAssetExecutions: episode.production?.externalAssetExecutions ?? null,
    routingHistory: episode.routingHistory ?? [],
    dispatchHistory: episode.dispatchHistory ?? [],
    metrics: episode.metrics ?? null
  });
}

function assertZeroCallLedger(episode) {
  const snapshot = {
    usedCalls: episode.control?.budget?.usedCalls ?? null,
    usedCostUsd: episode.control?.budget?.usedCostUsd ?? null,
    reservedCalls: episode.control?.budget?.reservedCalls ?? null,
    reservedCostUsd: episode.control?.budget?.reservedCostUsd ?? null,
    aiRequestCount: episode.production?.ai?.requestCount ?? null,
    aiAttemptCount: episode.production?.ai?.attempts?.length ?? null,
    routingHistoryCount: episode.routingHistory?.length ?? null
  };
  if (Object.values(snapshot).some((value) => value !== 0)) {
    throw registrationError(
      "当前 Episode 的调用或费用账本不是零，不能登记零调用候选",
      "local_tts_zero_call_ledger_invalid"
    );
  }
  return snapshot;
}

function assertRebindZeroCallLedger(episode, providerLedger) {
  const dispatchHistoryCount = episode.dispatchHistory?.length ?? null;
  if (dispatchHistoryCount !== 0) {
    throw registrationError(
      "当前 Episode 已出现新的 Agent 调度记录，旁白重绑定候选必须重新检查",
      "local_tts_zero_call_ledger_invalid"
    );
  }
  return {
    ...structuredClone(providerLedger),
    dispatchHistoryCount,
    ledgerSnapshotHash: ledgerSnapshotHash(episode)
  };
}

function humanVerificationId(authorization) {
  return integrityHash({
    schema: HUMAN_AUTHORIZATION_SCHEMA,
    decision: authorization.decision,
    approvedBy: authorization.approvedBy,
    approvedAt: authorization.approvedAt,
    scope: authorization.scope,
    note: authorization.note,
    candidateId: authorization.candidateId,
    candidateHash: authorization.candidateHash,
    candidateManifestSha256: authorization.candidateManifestSha256,
    candidateWavSha256: authorization.candidateWavSha256,
    machineVerificationId: authorization.machineVerificationId,
    machineVerificationHash: authorization.machineVerificationHash
  });
}

function assertRegisteredVoiceBinding(
  episode,
  verified,
  expectedPath,
  expectedPublicPath,
  fixed = LOCAL_OFFLINE_TTS_V002_REGISTRATION
) {
  const voice = episode.voice;
  const provenance = voice?.provenance;
  const authorization = voice?.authorization;
  const verification = voice?.verification;
  const expectedVersion = Number(/^voice-v(\d{3})\.wav$/u.exec(expectedPath.split("/").at(-1))?.[1]);
  if (
    voice?.status !== "ready"
    || voice.mode !== "local-offline-tts"
    || voice.version !== expectedVersion
    || voice.audioPath !== expectedPath
    || voice.publicPath !== expectedPublicPath
    || voice.bytes !== verified.wavData.length
    || voice.sha256 !== fixed.wavSha256
    || voice.durationSeconds !== verified.wav.durationSeconds
    || voice.sampleRate !== verified.wav.sampleRate
    || voice.channels !== verified.wav.channels
    || voice.bitsPerSample !== verified.wav.bitsPerSample
  ) {
    throw registrationError("已登记旁白媒体合同失效", "local_tts_registered_media_invalid");
  }
  if (
    provenance?.schemaVersion !== 1
    || provenance.source !== "local-offline-tts"
    || provenance.candidateId !== fixed.candidateId
    || provenance.candidateVersion !== fixed.candidateVersion
    || provenance.candidateHash !== verified.candidateHash
    || provenance.machineVerificationId !== verified.machineVerificationId
    || JSON.stringify(provenance.machineVerification) !== JSON.stringify(verified.machineVerification)
    || provenance.candidateManifestPath !== verified.normalizedCandidate.manifest.path
    || provenance.candidateManifestBytes !== verified.normalizedCandidate.manifest.bytes
    || provenance.candidateManifestSha256 !== fixed.manifestSha256
    || provenance.candidateWavPath !== verified.normalizedCandidate.wav.path
    || provenance.candidateWavBytes !== verified.normalizedCandidate.wav.bytes
    || provenance.candidateWavSha256 !== fixed.wavSha256
    || JSON.stringify(provenance.sourceBindings) !== JSON.stringify(verified.normalizedCandidate.source)
    || JSON.stringify(provenance.model) !== JSON.stringify(verified.normalizedCandidate.model)
    || JSON.stringify(provenance.voice) !== JSON.stringify(verified.normalizedCandidate.voice)
    || JSON.stringify(provenance.generation) !== JSON.stringify(verified.normalizedCandidate.generation)
    || provenance.pacingProfileVersion !== SHORT_LOCAL_TTS_PACING_PROFILE_VERSION
    || provenance.offlineVerified !== true
    || provenance.externalApiCalls !== 0
    || provenance.maximumPaidCostUsd !== 0
    || JSON.stringify(provenance.humanSelection) !== JSON.stringify(authorization)
  ) {
    throw registrationError("已登记旁白来源证明失效", "local_tts_registered_provenance_invalid");
  }
  if (
    verification?.schemaVersion !== 1
    || verification.id !== verified.machineVerification.id
    || verification.verifierVersion !== CANDIDATE_VERIFIER_VERSION
    || verification.status !== "passed"
    || verification.candidateHash !== verified.candidateHash
    || verification.machineVerificationId !== verified.machineVerificationId
    || verification.verificationHash !== verified.machineVerification.verificationHash
    || JSON.stringify(verification.checks) !== JSON.stringify(verified.checks)
    || verification.ledgerHash !== provenance.ledgerHash
  ) {
    throw registrationError("已登记旁白机器验证记录失效", "local_tts_registered_verification_invalid");
  }
  if (
    authorization?.schemaVersion !== 1
    || authorization.decision !== "approved"
    || authorization.approvedBy !== fixed.approvedBy
    || authorization.scope !== fixed.confirmation
    || authorization.note !== fixed.humanDecisionNote
    || authorization.candidateId !== fixed.candidateId
    || authorization.candidateHash !== verified.candidateHash
    || authorization.candidateManifestSha256 !== fixed.manifestSha256
    || authorization.candidateWavSha256 !== fixed.wavSha256
    || authorization.machineVerificationId !== verified.machineVerificationId
    || authorization.machineVerificationHash !== verified.machineVerification.verificationHash
    || authorization.verificationId !== humanVerificationId(authorization)
  ) {
    throw registrationError("已登记旁白人工授权记录失效", "local_tts_registered_authorization_invalid");
  }
}

function assertHistoricalStageBinding(episode, stage, productionKey, binding) {
  const current = episode.production?.[productionKey];
  const versions = [current, ...(current?.versions ?? [])];
  const versionRecord = versions.find((entry) =>
    entry?.version === binding?.version
      && entry.artifactPath === binding?.artifactPath
  );
  const report = (episode.reviews?.[stage]?.reports ?? []).find((entry) =>
    entry?.id === binding?.reviewReportId
      && entry.stage === stage
      && entry.decision === "pass"
      && entry.artifactVersion === binding?.version
      && entry.artifactHash === binding?.artifactHash
  );
  const approval = (episode.approvals?.[stage]?.history ?? []).find((entry) =>
    entry?.gate === stage
      && entry.decision === "approved"
      && entry.version === binding?.version
  );
  if (
    !versionRecord
    || !report
    || !approval
    || !Number.isInteger(binding?.version)
    || typeof binding?.artifactPath !== "string"
    || !/^[a-f0-9]{64}$/u.test(String(binding?.artifactHash ?? ""))
    || typeof binding?.reviewReportId !== "string"
  ) {
    throw registrationError(
      `本地旁白绑定的历史 ${stage} 审核与批准记录无法核验`,
      "local_tts_source_stage_approval_invalid"
    );
  }
  return structuredClone(versionRecord);
}

async function readJsonArtifact(
  relativePath,
  label,
  options = {},
  {
    expectedBytes = null,
    maxBytes = JSON_ARTIFACT_MAX_BYTES
  } = {}
) {
  const path = ensureInside(workspaceRoot, resolve(workspaceRoot, relativePath ?? ""));
  const file = await assertNoSymlinkRegularFile(path, workspaceRoot, options);
  assertPreReadFileSize(file, { label, expectedBytes, maxBytes });
  const data = await (options.readFile ?? readFile)(path);
  assertEqual(file.bytes, data.length, `${label} 读取期间发生变化`);
  return { path, file, data, value: parseJson(data, label) };
}

function storyboardWithoutSubtitleLayout(artifact) {
  return {
    sourceScript: structuredClone(artifact?.sourceScript ?? null),
    draft: {
      targetDurationSeconds: artifact?.draft?.targetDurationSeconds ?? null,
      assetChecklist: structuredClone(artifact?.draft?.assetChecklist ?? []),
      visualRules: structuredClone(artifact?.draft?.visualRules ?? []),
      scenes: (artifact?.draft?.scenes ?? []).map((scene) => {
        const { subtitle: _subtitle, subtitleLines: _subtitleLines, ...rest } = scene;
        return rest;
      })
    },
    timeline: {
      durationSeconds: artifact?.timeline?.durationSeconds ?? null,
      scenes: (artifact?.timeline?.scenes ?? []).map((scene) => {
        const { subtitle: _subtitle, ...rest } = scene;
        return rest;
      })
    }
  };
}

function subtitleLayoutByScene(artifact) {
  const subtitles = artifact?.timeline?.subtitles ?? [];
  return Object.fromEntries((artifact?.timeline?.scenes ?? []).map((scene) => [
    scene.id,
    subtitles.filter((subtitle) =>
      subtitle.start >= scene.start
        && subtitle.end <= scene.end
    ).map((subtitle) => ({
      start: subtitle.start,
      end: subtitle.end,
      text: subtitle.text
    }))
  ]));
}

function changedSubtitleSceneIds(sourceArtifact, currentArtifact) {
  const source = subtitleLayoutByScene(sourceArtifact);
  const current = subtitleLayoutByScene(currentArtifact);
  return [...new Set([...Object.keys(source), ...Object.keys(current)])].filter(
    (sceneId) => JSON.stringify(source[sceneId] ?? null) !== JSON.stringify(current[sceneId] ?? null)
  );
}

function voiceTimelineScenes(scenes = []) {
  return scenes.map((scene) => ({
    id: scene?.id ?? null,
    start: scene?.start ?? null,
    end: scene?.end ?? null,
    type: scene?.type ?? null,
    kicker: scene?.kicker ?? null,
    title: scene?.title ?? null,
    statement: scene?.statement ?? null,
    subtitle: scene?.subtitle ?? null,
    label: scene?.label ?? null,
    assetHint: scene?.assetHint ?? null
  }));
}

function machineVerificationHash(verification) {
  const payload = structuredClone(verification);
  delete payload.verificationHash;
  return integrityHash(payload);
}

async function inspectImmutableRegisteredVoiceSource(episode, options = {}) {
  const fixed = registrationConfig(options);
  const voice = episode.voice;
  const provenance = voice?.provenance;
  if (voice?.status !== "ready" || voice.mode !== "local-offline-tts") {
    throw registrationError(
      "Episode 没有可重绑定的已登记本地离线旁白",
      "local_tts_rebind_source_missing"
    );
  }
  const sourceBindings = provenance?.sourceBindings;
  if (!sourceBindings || typeof sourceBindings !== "object") {
    throw registrationError(
      "已登记旁白缺少不可变生成来源绑定",
      "local_tts_registered_provenance_invalid"
    );
  }
  assertHistoricalStageBinding(episode, "script", "scriptDraft", sourceBindings.script);
  assertHistoricalStageBinding(
    episode,
    "storyboard",
    "storyboardDraft",
    sourceBindings.storyboard
  );
  assertHistoricalAssetExecutionBinding(episode, sourceBindings.assetExecution);

  const paths = candidatePaths(options);
  const readBytes = options.readFile ?? readFile;
  const [manifestFile, wavFile] = await Promise.all([
    assertNoSymlinkRegularFile(paths.manifestPath, paths.allowedRoot, options),
    assertNoSymlinkRegularFile(paths.wavPath, paths.allowedRoot, options)
  ]);
  assertCandidateReadSizeLimits(manifestFile, wavFile);
  const [manifestData, wavData] = await Promise.all([
    readBytes(paths.manifestPath),
    readBytes(paths.wavPath)
  ]);
  assertEqual(manifestFile.bytes, manifestData.length, "v002 manifest 读取期间发生变化");
  assertEqual(wavFile.bytes, wavData.length, "v002 WAV 读取期间发生变化");
  assertEqual(sha256(manifestData), fixed.manifestSha256, "v002 manifest 哈希不匹配");
  assertEqual(sha256(wavData), fixed.wavSha256, "v002 WAV 哈希不匹配");

  const manifest = parseJson(manifestData, "v002 manifest");
  assertEqual(manifest.id, fixed.candidateId, "v002 candidate ID 不匹配");
  assertEqual(manifest.episodeId, episode.id, "v002 manifest 未绑定当前 Episode");
  assertEqual(manifest.version, fixed.candidateVersion, "v002 manifest 版本不匹配");
  assertEqual(manifest.status, "human-review-candidate", "v002 不再是人工试听候选");
  assertEqual(manifest.audio?.outputPath, workspaceRelativePath(paths.wavPath), "v002 WAV 路径不匹配");
  assertEqual(manifest.audio?.bytes, wavData.length, "v002 WAV 字节数不匹配");
  assertEqual(manifest.audio?.sha256, fixed.wavSha256, "v002 WAV 来源哈希不匹配");
  assertEqual(manifest.audio?.durationSeconds, SHORT_LOCAL_TTS_DURATION_SECONDS, "v002 时长不匹配");
  assertEqual(manifest.audio?.sampleRate, LOCAL_TTS_SAMPLE_RATE, "v002 采样率不匹配");
  assertEqual(manifest.audio?.channels, 1, "v002 声道数不匹配");
  const wav = inspectPcmWav(wavData);

  assertEqual(
    JSON.stringify(manifest.source?.script),
    JSON.stringify(sourceBindings.script),
    "v002 不可变脚本来源与已登记证明不一致"
  );
  assertEqual(
    JSON.stringify(manifest.source?.storyboard),
    JSON.stringify(sourceBindings.storyboard),
    "v002 不可变分镜来源与已登记证明不一致"
  );
  assertEqual(
    JSON.stringify(manifest.source?.assetExecution),
    JSON.stringify(sourceBindings.assetExecution),
    "v002 不可变素材执行来源与已登记证明不一致"
  );

  const voicePlanRecord = episode.production?.voicePlan;
  assertEqual(
    voicePlanRecord?.version,
    sourceBindings.voicePlan?.version,
    "当前 voice plan 版本不再等于原始生成来源"
  );
  assertEqual(
    voicePlanRecord?.artifactPath,
    sourceBindings.voicePlan?.artifactPath,
    "当前 voice plan 路径不再等于原始生成来源"
  );
  const voicePlanArtifact = await readJsonArtifact(
    sourceBindings.voicePlan?.artifactPath,
    "voice plan",
    options,
    {
      expectedBytes: sourceBindings.voicePlan?.bytes,
      maxBytes: VOICE_PLAN_MAX_BYTES
    }
  );
  const voicePlanHash = sha256(voicePlanArtifact.data);
  assertEqual(voicePlanArtifact.data.length, sourceBindings.voicePlan?.bytes, "voice plan 字节数不匹配");
  assertEqual(voicePlanHash, sourceBindings.voicePlan?.sha256, "voice plan 哈希不匹配");
  assertEqual(manifest.source?.voicePlan?.version, sourceBindings.voicePlan?.version, "v002 voice plan 版本不匹配");
  assertEqual(manifest.source?.voicePlan?.artifactPath, sourceBindings.voicePlan?.artifactPath, "v002 voice plan 路径不匹配");
  assertEqual(manifest.source?.voicePlan?.sha256, voicePlanHash, "v002 voice plan 哈希不匹配");
  assertEqual(
    manifest.source?.voicePlan?.narrationSha256,
    sourceBindings.voicePlan?.narrationSha256,
    "v002 旁白逐字哈希不匹配"
  );
  assertEqual(manifest.source?.subtitlesSha256, sourceBindings.subtitlesSha256, "v002 字幕来源哈希不匹配");
  assertEqual(manifest.source?.segmentPlanSha256, sourceBindings.segmentPlanSha256, "v002 九镜方案来源哈希不匹配");
  assertEqual(
    manifest.source?.pacingProfileVersion,
    sourceBindings.pacingProfileVersion,
    "v002 节奏配置来源不匹配"
  );

  assertEqual(manifest.model?.repoId, LOCAL_TTS_MODEL.repoId, "Kokoro repo 不匹配");
  assertEqual(manifest.model?.revision, LOCAL_TTS_MODEL.revision, "Kokoro revision 不匹配");
  assertEqual(manifest.model?.fileName, LOCAL_TTS_MODEL.fileName, "Kokoro 文件名不匹配");
  assertEqual(manifest.model?.sha256, LOCAL_TTS_MODEL.sha256, "Kokoro 模型哈希不匹配");
  assertEqual(manifest.model?.verifiedSha256, LOCAL_TTS_MODEL.sha256, "Kokoro 实测哈希不匹配");
  assertEqual(manifest.model?.configSha256, LOCAL_TTS_MODEL.configSha256, "Kokoro 配置哈希不匹配");
  assertEqual(manifest.model?.verifiedConfigSha256, LOCAL_TTS_MODEL.configSha256, "Kokoro 实测配置哈希不匹配");
  assertEqual(manifest.model?.codeRepoId, LOCAL_TTS_MODEL.codeRepoId, "Kokoro 代码仓库不匹配");
  assertEqual(manifest.model?.codeRevision, LOCAL_TTS_MODEL.codeRevision, "Kokoro 代码版本不匹配");
  assertEqual(manifest.model?.license, KOKORO_LICENSE, "Kokoro 许可证不匹配");
  const voicePackage = LOCAL_TTS_VOICES.find(({ id }) => id === SHORT_LOCAL_TTS_VOICE_ID);
  assertEqual(manifest.voice?.id, SHORT_LOCAL_TTS_VOICE_ID, "本地音色 ID 不匹配");
  assertEqual(manifest.voice?.packageSha256, voicePackage?.sha256, "本地音色哈希不匹配");
  assertManifestGeneration(manifest);
  const runtime = await assertPinnedRuntimeFiles(options);
  assertEqual(runtime.model.bytes, provenance.model?.bytes, "Kokoro 模型字节数与已登记证明不一致");
  assertEqual(runtime.config.bytes, provenance.model?.configBytes, "Kokoro 配置字节数与已登记证明不一致");
  assertEqual(runtime.voicePackage.bytes, provenance.voice?.packageBytes, "音色包字节数与已登记证明不一致");
  const episodeZeroCallLedger = assertZeroCallLedger(episode);

  const normalizedCandidate = {
    schemaVersion: 1,
    verifierVersion: CANDIDATE_VERIFIER_VERSION,
    episodeId: episode.id,
    candidateId: fixed.candidateId,
    candidateVersion: fixed.candidateVersion,
    manifest: {
      path: workspaceRelativePath(paths.manifestPath),
      bytes: manifestData.length,
      sha256: fixed.manifestSha256
    },
    wav: {
      path: workspaceRelativePath(paths.wavPath),
      bytes: wavData.length,
      sha256: fixed.wavSha256,
      ...wav,
      renderedSegmentsSha256: sha256(JSON.stringify(manifest.audio.segments))
    },
    source: structuredClone(sourceBindings),
    model: {
      repoId: LOCAL_TTS_MODEL.repoId,
      revision: LOCAL_TTS_MODEL.revision,
      fileName: LOCAL_TTS_MODEL.fileName,
      sha256: LOCAL_TTS_MODEL.sha256,
      bytes: runtime.model.bytes,
      configSha256: LOCAL_TTS_MODEL.configSha256,
      configBytes: runtime.config.bytes,
      codeRepoId: LOCAL_TTS_MODEL.codeRepoId,
      codeRevision: LOCAL_TTS_MODEL.codeRevision,
      license: KOKORO_LICENSE
    },
    voice: {
      id: SHORT_LOCAL_TTS_VOICE_ID,
      packageSha256: voicePackage.sha256,
      packageBytes: runtime.voicePackage.bytes,
      ...LOCAL_VOICE_PROVENANCE
    },
    generation: normalizedOfflineGeneration(manifest.generation),
    episodeZeroCallLedger
  };
  const candidateHash = integrityHash(normalizedCandidate);
  assertEqual(candidateHash, provenance.candidateHash, "已登记 v002 candidateHash 无法复算");
  const machineVerification = structuredClone(provenance.machineVerification);
  const expectedMachineVerificationId = integrityHash({
    schemaVersion: 1,
    verifierVersion: CANDIDATE_VERIFIER_VERSION,
    candidateHash,
    checks: machineVerification.checks
  });
  assertEqual(machineVerification.id, expectedMachineVerificationId, "原始机器验证 ID 无法复算");
  assertEqual(
    machineVerification.verificationHash,
    machineVerificationHash(machineVerification),
    "原始机器验证哈希无法复算"
  );

  const registeredPath = ensureInside(
    workspaceRoot,
    resolve(workspaceRoot, voice.audioPath ?? "")
  );
  const expectedPath = workspaceRelativePath(registeredPath);
  const expectedPublicPath = `episodes/${episode.id}/voice-v${String(voice.version).padStart(3, "0")}.wav`;
  const verified = {
    candidateHash,
    machineVerificationId: machineVerification.id,
    machineVerification,
    checks: [...machineVerification.checks],
    normalizedCandidate,
    manifest,
    manifestData,
    wavData,
    wav,
    paths,
    runtime
  };
  assertRegisteredVoiceBinding(episode, verified, expectedPath, expectedPublicPath, fixed);
  const registeredFile = await assertNoSymlinkRegularFile(registeredPath, workspaceRoot, options);
  assertPreReadFileSize(registeredFile, {
    label: "voice-v001",
    expectedBytes: wavData.length,
    maxBytes: CANDIDATE_WAV_MAX_BYTES
  });
  const registeredData = await readBytes(registeredPath);
  assertEqual(registeredFile.bytes, registeredData.length, "voice-v001 读取期间发生变化");
  assertEqual(registeredData.length, wavData.length, "voice-v001 字节数与原始 WAV 不一致");
  assertEqual(sha256(registeredData), fixed.wavSha256, "voice-v001 与原始 WAV 哈希不一致");
  assertEqual(JSON.stringify(inspectPcmWav(registeredData)), JSON.stringify(wav), "voice-v001 WAV 合同不一致");

  return {
    fixed,
    voice,
    provenance,
    sourceBindings: structuredClone(sourceBindings),
    normalizedCandidate,
    candidateHash,
    machineVerification,
    manifest,
    manifestData,
    wavData,
    wav,
    voicePlan: voicePlanArtifact.value,
    voicePlanData: voicePlanArtifact.data,
    voicePlanHash,
    episodeZeroCallLedger,
    registeredPath,
    registeredData
  };
}

function rebindCheck(id, label, actual, expected) {
  return {
    id,
    label,
    passed: true,
    severity: "error",
    actual: structuredClone(actual),
    expected: structuredClone(expected)
  };
}

async function inspectRegisteredLocalOfflineTtsRebindCandidateInternal(
  episodeId,
  options = {}
) {
  const fixed = registrationConfig(options);
  const priorReview = priorReviewConfig(options);
  if (episodeId !== fixed.episodeId) {
    throw registrationError(
      "本地离线旁白重绑定候选只适用于当前短片 Episode",
      "local_tts_episode_conflict"
    );
  }
  const episode = options.episode ?? await (options.readEpisode ?? readEpisode)(episodeId);
  const source = await inspectImmutableRegisteredVoiceSource(episode, options);
  const currentScript = currentStageBinding(episode, "script", "scriptDraft");
  const currentStoryboard = currentStageBinding(episode, "storyboard", "storyboardDraft");
  assertEqual(
    JSON.stringify(currentScript),
    JSON.stringify(source.sourceBindings.script),
    "当前批准脚本已改变，不能零调用复用原始旁白"
  );
  if (JSON.stringify(currentStoryboard) === JSON.stringify(source.sourceBindings.storyboard)) {
    throw registrationError(
      "当前分镜仍是原始旁白绑定版本，不需要重绑定",
      "local_tts_rebind_not_required"
    );
  }
  const assetReuse = assertCurrentAssetExecutionAllowsVoiceReuse(
    episode,
    source.sourceBindings.assetExecution,
    options
  );

  const [sourceStoryboardArtifact, currentStoryboardArtifact] = await Promise.all([
    readJsonArtifact(
      source.sourceBindings.storyboard.artifactPath,
      "原始 Storyboard",
      options
    ),
    readJsonArtifact(currentStoryboard.artifactPath, "当前 Storyboard", options)
  ]);
  const priorReviewManifestArtifact = await readJsonArtifact(
    priorReview.manifestPath,
    "Storyboard v4 未登记审阅件 manifest",
    options
  );
  assertEqual(
    sha256(priorReviewManifestArtifact.data),
    priorReview.manifestSha256,
    "Storyboard v4 未登记审阅件 manifest 哈希不匹配"
  );
  const priorReviewMediaPath = ensureInside(
    workspaceRoot,
    resolve(workspaceRoot, priorReview.mediaPath)
  );
  const priorReviewMediaFile = await assertNoSymlinkRegularFile(
    priorReviewMediaPath,
    workspaceRoot,
    options
  );
  assertPreReadFileSize(priorReviewMediaFile, {
    label: "Storyboard v4 未登记审阅件",
    expectedBytes: priorReview.mediaBytes,
    maxBytes: PRIOR_REVIEW_MEDIA_MAX_BYTES
  });
  const priorReviewMediaData = await (options.readFile ?? readFile)(priorReviewMediaPath);
  assertEqual(
    priorReviewMediaFile.bytes,
    priorReviewMediaData.length,
    "Storyboard v4 未登记审阅件读取期间发生变化"
  );
  assertEqual(
    priorReviewMediaData.length,
    priorReview.mediaBytes,
    "Storyboard v4 未登记审阅件字节数不匹配"
  );
  assertEqual(
    sha256(priorReviewMediaData),
    priorReview.mediaSha256,
    "Storyboard v4 未登记审阅件视频哈希不匹配"
  );
  const priorReviewManifest = priorReviewManifestArtifact.value;
  assertEqual(
    priorReviewManifest.storyboardVersion,
    priorReview.storyboardVersion,
    "未登记审阅件没有绑定 Storyboard v4"
  );
  assertEqual(
    priorReviewManifest.media?.sha256,
    priorReview.mediaSha256,
    "未登记审阅件 manifest 的视频哈希不匹配"
  );
  assertEqual(
    priorReviewManifest.sourceHashesBeforeAndAfter?.voiceV1,
    source.fixed.wavSha256,
    "未登记审阅件没有证明使用相同的 voice-v001"
  );
  assertEqual(
    JSON.stringify(voiceTimelineScenes(currentStoryboardArtifact.value.timeline?.scenes)),
    JSON.stringify(voiceTimelineScenes(episode.scenes)),
    "当前 Episode 场景与 Storyboard 产物不一致"
  );
  assertEqual(
    JSON.stringify(currentStoryboardArtifact.value.timeline?.subtitles),
    JSON.stringify(episode.subtitles),
    "当前 Episode 字幕与 Storyboard 产物不一致"
  );
  assertEqual(
    JSON.stringify(storyboardWithoutSubtitleLayout(sourceStoryboardArtifact.value)),
    JSON.stringify(storyboardWithoutSubtitleLayout(currentStoryboardArtifact.value)),
    "Storyboard 除字幕布局外还有内容变化，不能零调用复用原始旁白"
  );

  const sourceEpisode = structuredClone(episode);
  sourceEpisode.scenes = structuredClone(sourceStoryboardArtifact.value.timeline?.scenes ?? []);
  sourceEpisode.subtitles = structuredClone(
    sourceStoryboardArtifact.value.timeline?.subtitles ?? []
  );
  const sourceSegmentPlan = buildShortLocalTtsSegments(sourceEpisode, source.voicePlan);
  const currentSegmentPlan = buildShortLocalTtsSegments(episode, source.voicePlan);
  const sourceNarrationHash = sha256(sourceSegmentPlan.narration);
  const currentNarrationHash = sha256(currentSegmentPlan.narration);
  const sourceSegmentPlanHash = sha256(JSON.stringify(sourceSegmentPlan.segments));
  const currentSegmentPlanHash = sha256(JSON.stringify(currentSegmentPlan.segments));
  const sourceSubtitlesHash = sha256(JSON.stringify(sourceEpisode.subtitles));
  const currentSubtitlesHash = sha256(JSON.stringify(episode.subtitles));
  assertEqual(
    sourceNarrationHash,
    source.sourceBindings.voicePlan.narrationSha256,
    "原始 Storyboard 旁白逐字哈希与生成来源不一致"
  );
  assertEqual(
    currentNarrationHash,
    sourceNarrationHash,
    "当前 Storyboard 改变了旁白逐字内容"
  );
  assertEqual(
    sourceSegmentPlanHash,
    source.sourceBindings.segmentPlanSha256,
    "原始九镜语音分段哈希与生成来源不一致"
  );
  assertEqual(
    currentSegmentPlanHash,
    sourceSegmentPlanHash,
    "当前 Storyboard 改变了九镜语音分段"
  );
  assertEqual(
    sourceSubtitlesHash,
    source.sourceBindings.subtitlesSha256,
    "原始字幕哈希与生成来源不一致"
  );
  if (currentSubtitlesHash === sourceSubtitlesHash) {
    throw registrationError(
      "当前字幕布局没有变化，不需要建立重绑定候选",
      "local_tts_rebind_not_required"
    );
  }
  assertShortLocalTtsRenderedSegments(sourceSegmentPlan, source.manifest.audio?.segments);
  assertShortLocalTtsRenderedSegments(currentSegmentPlan, source.manifest.audio?.segments);
  const subtitleChangedSceneIds = changedSubtitleSceneIds(
    sourceStoryboardArtifact.value,
    currentStoryboardArtifact.value
  );
  if (subtitleChangedSceneIds.length === 0) {
    throw registrationError(
      "无法定位 Storyboard 的字幕布局变化",
      "local_tts_rebind_storyboard_delta_invalid"
    );
  }
  assertEqual(
    JSON.stringify(subtitleChangedSceneIds),
    JSON.stringify(["S03"]),
    "本次零调用重绑定只允许 S03 字幕断句变化"
  );
  const sourceSubtitleLayout = subtitleLayoutByScene(sourceStoryboardArtifact.value);
  const currentSubtitleLayout = subtitleLayoutByScene(currentStoryboardArtifact.value);
  const subtitleDelta = {
    changedSceneIds: [...subtitleChangedSceneIds],
    scenes: subtitleChangedSceneIds.map((sceneId) => ({
      sceneId,
      before: structuredClone(sourceSubtitleLayout[sceneId] ?? []),
      after: structuredClone(currentSubtitleLayout[sceneId] ?? [])
    }))
  };
  const sourceS03Segment = source.manifest.audio?.segments?.find(({ id }) => id === "S03");
  const sourceS03FirstPartMetric = sourceS03Segment?.speechPartMetrics?.[0];
  const sourceS03FirstPart = sourceS03Segment?.speechParts?.[0];
  const currentS03Subtitles = currentSubtitleLayout.S03 ?? [];
  const sourceS03Subtitles = sourceSubtitleLayout.S03 ?? [];
  if (
    !sourceS03Segment
    || !Number.isFinite(sourceS03FirstPartMetric?.durationSeconds)
    || !Number.isFinite(sourceS03FirstPart?.pauseAfterSeconds)
    || currentS03Subtitles.length !== 2
    || sourceS03Subtitles.length !== 2
  ) {
    throw registrationError(
      "无法复算 S03 音频停顿与字幕边界",
      "local_tts_rebind_storyboard_delta_invalid"
    );
  }
  assertEqual(
    sourceS03Subtitles.map(({ text }) => text).join(""),
    sourceS03Segment.text,
    "原始 S03 字幕拼接内容与已渲染旁白不一致"
  );
  assertEqual(
    currentS03Subtitles.map(({ text }) => text).join(""),
    sourceS03Segment.text,
    "当前 S03 字幕拼接内容与已渲染旁白不一致"
  );
  const audioSecondPhraseStartsAtSecond = Number((
    sourceS03Segment.start
    + sourceS03FirstPartMetric.durationSeconds
    + sourceS03FirstPart.pauseAfterSeconds
  ).toFixed(3));
  const sourceSubtitleBoundarySecond = sourceS03Subtitles[1].start;
  const currentSubtitleBoundarySecond = currentS03Subtitles[1].start;
  const syncCaveat = {
    strictAlignmentStatus: "not-verified",
    evidenceBasis: "render-plan-boundary-not-acoustic-word-alignment",
    audioSecondPhraseStartsAtSecond,
    sourceSubtitleBoundarySecond,
    currentSubtitleBoundarySecond,
    sourceToCurrentBoundaryShiftSeconds: Number((
      currentSubtitleBoundarySecond - sourceSubtitleBoundarySecond
    ).toFixed(3)),
    audioToCurrentSubtitleBoundaryDeltaSeconds: Number((
      currentSubtitleBoundarySecond - audioSecondPhraseStartsAtSecond
    ).toFixed(3)),
    disclosure:
      "WAV、逐字旁白和九镜语音方案未变；字幕显示断句已变化，但这不代表逐词或逐音同步已经通过。"
  };

  const sourceGeneration = {
    schemaVersion: "local-offline-voice-generation-source-v1",
    candidateId: source.fixed.candidateId,
    candidateVersion: source.fixed.candidateVersion,
    candidateHash: source.candidateHash,
    manifest: {
      path: source.normalizedCandidate.manifest.path,
      bytes: source.manifestData.length,
      sha256: source.fixed.manifestSha256
    },
    wav: {
      path: source.normalizedCandidate.wav.path,
      bytes: source.wavData.length,
      sha256: source.fixed.wavSha256,
      durationSeconds: source.wav.durationSeconds,
      sampleRate: source.wav.sampleRate,
      channels: source.wav.channels,
      bitsPerSample: source.wav.bitsPerSample
    },
    bindings: structuredClone(source.sourceBindings),
    model: structuredClone(source.normalizedCandidate.model),
    voice: structuredClone(source.normalizedCandidate.voice),
    generation: structuredClone(source.normalizedCandidate.generation),
    machineVerification: structuredClone(source.machineVerification),
    humanAuthorization: {
      decision: source.voice.authorization.decision,
      approvedBy: source.voice.authorization.approvedBy,
      approvedAt: source.voice.authorization.approvedAt,
      scope: source.voice.authorization.scope,
      verificationId: source.voice.authorization.verificationId
    }
  };
  const currentUseBinding = {
    schemaVersion: "local-offline-voice-current-use-binding-v1",
    script: structuredClone(currentScript),
    storyboard: structuredClone(currentStoryboard),
    assetExecution: structuredClone(assetReuse.currentBinding),
    voicePlan: {
      version: source.sourceBindings.voicePlan.version,
      artifactPath: source.sourceBindings.voicePlan.artifactPath,
      bytes: source.voicePlanData.length,
      sha256: source.voicePlanHash,
      narrationSha256: currentNarrationHash
    },
    subtitlesSha256: currentSubtitlesHash,
    segmentPlanSha256: currentSegmentPlanHash,
    pacingProfileVersion: source.sourceBindings.pacingProfileVersion,
    assetReuseAttestation: structuredClone(assetReuse.attestation)
  };
  const priorReviewEvidence = {
    schemaVersion: "local-offline-voice-prior-review-evidence-v1",
    manifest: {
      path: priorReview.manifestPath,
      bytes: priorReviewManifestArtifact.data.length,
      sha256: priorReview.manifestSha256
    },
    media: {
      path: priorReview.mediaPath,
      bytes: priorReviewMediaData.length,
      sha256: priorReview.mediaSha256,
      storyboardVersion: priorReviewManifest.storyboardVersion,
      sourceVoiceSha256: priorReviewManifest.sourceHashesBeforeAndAfter.voiceV1,
      reviewOnly: priorReviewManifest.reviewOnly,
      registered: priorReviewManifest.registered
    }
  };
  const sceneTimingUnchanged = JSON.stringify(
    sourceStoryboardArtifact.value.timeline?.scenes?.map(({ id, start, end }) => ({
      id,
      start,
      end
    })) ?? []
  ) === JSON.stringify(
    currentStoryboardArtifact.value.timeline?.scenes?.map(({ id, start, end }) => ({
      id,
      start,
      end
    })) ?? []
  );
  assertEqual(sceneTimingUnchanged, true, "当前 Storyboard 改变了九镜起止时间");
  const equivalence = {
    sameRegisteredWav: sha256(source.registeredData) === source.fixed.wavSha256,
    sameNarration: currentNarrationHash === sourceNarrationHash,
    sameNineSceneSegmentPlan: currentSegmentPlanHash === sourceSegmentPlanHash,
    sameNonSubtitleStoryboardContent:
      JSON.stringify(storyboardWithoutSubtitleLayout(sourceStoryboardArtifact.value))
        === JSON.stringify(storyboardWithoutSubtitleLayout(currentStoryboardArtifact.value)),
    subtitleLayoutChanged: currentSubtitlesHash !== sourceSubtitlesHash,
    subtitleChangedSceneIds,
    sourceSubtitlesSha256: sourceSubtitlesHash,
    currentSubtitlesSha256: currentSubtitlesHash,
    sourceStoryboardVersion: source.sourceBindings.storyboard.version,
    currentStoryboardVersion: currentStoryboard.version,
    sourceAssetExecutionVersion: source.sourceBindings.assetExecution.version,
    currentAssetExecutionVersion: assetReuse.currentBinding.version,
    wavByteIdentical: sha256(source.registeredData) === source.fixed.wavSha256,
    narrationUnchanged: currentNarrationHash === sourceNarrationHash,
    sceneTimingUnchanged,
    segmentPlanUnchanged: currentSegmentPlanHash === sourceSegmentPlanHash,
    onlySubtitleBoundaryChanged: subtitleChangedSceneIds.length === 1,
    audioRegenerationRequired: false,
    subtitleDelta,
    syncCaveat
  };
  const candidateId = [
    episode.id,
    `voice-v${String(source.voice.version).padStart(3, "0")}`,
    `storyboard-v${String(currentStoryboard.version).padStart(3, "0")}`,
    `asset-v${String(assetReuse.currentBinding.version).padStart(3, "0")}`,
    "rebind"
  ].join("-");
  const normalizedCandidate = {
    schemaVersion: LOCAL_OFFLINE_TTS_REBIND_INSPECTION.schemaVersion,
    verifierVersion: LOCAL_OFFLINE_TTS_REBIND_INSPECTION.verifierVersion,
    episodeId: episode.id,
    candidateId,
    sourceGeneration,
    registeredVoice: {
      version: source.voice.version,
      audioPath: source.voice.audioPath,
      publicPath: source.voice.publicPath,
      bytes: source.voice.bytes,
      sha256: source.voice.sha256,
      durationSeconds: source.voice.durationSeconds,
      sampleRate: source.voice.sampleRate,
      channels: source.voice.channels,
      bitsPerSample: source.voice.bitsPerSample
    },
    currentUseBinding,
    priorReviewEvidence,
    equivalence,
    zeroCallLedger: assertRebindZeroCallLedger(
      episode,
      source.episodeZeroCallLedger
    )
  };
  const candidateHash = integrityHash(normalizedCandidate);
  const checks = [
    rebindCheck("immutable-generation-source", "原始 v002 生成来源 v3/v9、manifest 与授权可复算", {
      candidateHash: source.candidateHash,
      storyboardVersion: source.sourceBindings.storyboard.version,
      assetExecutionVersion: source.sourceBindings.assetExecution.version,
      authorizationVerificationId: source.voice.authorization.verificationId
    }, "immutable v002 source"),
    rebindCheck("registered-wav-integrity", "已登记 voice-v001 与原始 WAV 完全一致", {
      bytes: source.registeredData.length,
      sha256: sha256(source.registeredData),
      durationSeconds: source.wav.durationSeconds
    }, {
      bytes: source.wavData.length,
      sha256: source.fixed.wavSha256,
      durationSeconds: SHORT_LOCAL_TTS_DURATION_SECONDS
    }),
    rebindCheck("pinned-model-and-license", "模型、配置、音色、代码版本与许可证仍可核验", {
      modelSha256: source.normalizedCandidate.model.sha256,
      configSha256: source.normalizedCandidate.model.configSha256,
      voicePackageSha256: source.normalizedCandidate.voice.packageSha256,
      codeRevision: source.normalizedCandidate.model.codeRevision,
      license: source.normalizedCandidate.model.license
    }, "pinned local Kokoro runtime"),
    rebindCheck("current-approved-bindings", "新使用范围精确绑定当前批准的 Storyboard 与素材候选", {
      storyboard: currentStoryboard,
      assetExecution: assetReuse.currentBinding
    }, "current approved v4/v13 bindings"),
    rebindCheck("narration-exact", "当前旁白逐字内容未变化", currentNarrationHash, sourceNarrationHash),
    rebindCheck("nine-scene-segment-plan-exact", "当前九镜语音分段与已渲染分段完全一致", currentSegmentPlanHash, sourceSegmentPlanHash),
    rebindCheck("subtitle-layout-only-delta", "WAV、旁白与九镜语音方案未变；精确披露 S03 字幕断句变化", {
      sourceSubtitlesHash,
      currentSubtitlesHash,
      subtitleDelta
    }, "S03-only subtitle boundary delta with identical narration and segment plan"),
    rebindCheck("s03-sync-caveat-disclosed", "明确披露 S03 未通过逐词或逐音同步验证", syncCaveat, {
      strictAlignmentStatus: "not-verified",
      audioSecondPhraseStartsAtSecond: 11.883,
      currentSubtitleBoundarySecond: 14.794,
      audioToCurrentSubtitleBoundaryDeltaSeconds: 2.911
    }),
    rebindCheck("prior-v4-review-same-wav", "此前 Storyboard v4 审阅件使用同一 voice-v001", {
      mediaSha256: priorReviewEvidence.media.sha256,
      storyboardVersion: priorReviewEvidence.media.storyboardVersion,
      sourceVoiceSha256: priorReviewEvidence.media.sourceVoiceSha256,
      reviewOnly: priorReviewEvidence.media.reviewOnly
    }, {
      mediaSha256: priorReview.mediaSha256,
      storyboardVersion: 4,
      sourceVoiceSha256: source.fixed.wavSha256,
      reviewOnly: true
    }),
    rebindCheck("zero-network-zero-cost", "重绑定候选不产生网络、推理调用或费用", {
      externalApiCalls: 0,
      externalInferenceCalls: 0,
      maximumPaidCostUsd: 0,
      ledger: normalizedCandidate.zeroCallLedger
    }, "all zero")
  ];
  const machineVerificationId = integrityHash({
    schemaVersion: 1,
    verifierVersion: LOCAL_OFFLINE_TTS_REBIND_INSPECTION.verifierVersion,
    candidateHash,
    checks
  });
  const machineVerification = {
    schemaVersion: 1,
    id: machineVerificationId,
    status: "passed",
    verifierVersion: LOCAL_OFFLINE_TTS_REBIND_INSPECTION.verifierVersion,
    candidateHash,
    checks
  };
  machineVerification.verificationHash = integrityHash(machineVerification);
  const currentUseBindingHash = integrityHash(currentUseBinding);
  const humanDecisionBinding = {
    schemaVersion: "local-offline-tts-rebind-human-decision-binding-v1",
    status: "pending",
    scope: "approve-versioned-current-use-rebinding-only",
    candidateId,
    candidateHash,
    machineVerificationId,
    machineVerificationHash: machineVerification.verificationHash,
    sourceVoiceVersion: source.voice.version,
    sourceVoiceSha256: source.voice.sha256,
    currentUseBindingHash,
    registrationImplemented: false
  };
  const registrationRequest = {
    schemaVersion: "local-offline-tts-rebind-registration-request-preview-v1",
    nonExecutablePreview: true,
    registrationImplemented: false,
    candidateId,
    candidateHash,
    machineVerificationId,
    machineVerificationHash: machineVerification.verificationHash,
    sourceVoiceVersion: source.voice.version,
    sourceVoiceSha256: source.voice.sha256,
    currentStoryboardVersion: currentStoryboard.version,
    currentStoryboardArtifactHash: currentStoryboard.artifactHash,
    currentAssetExecutionVersion: assetReuse.currentBinding.version,
    currentAssetExecutionCandidateHash: assetReuse.currentBinding.candidateHash,
    confirmation: LOCAL_OFFLINE_TTS_REBIND_INSPECTION.confirmation
  };
  const dossier = {
    title: "沿用 voice-v001 的零调用旁白重绑定候选",
    status: "ready_for_human_review",
    summary: "保留真实生成来源 v3/v9，不改写旧 manifest；仅建议把已登记 voice-v001 的当前使用范围绑定到已批准 v4/v13。",
    playablePreview: {
      kind: "audio",
      path: source.voice.audioPath,
      publicPath: source.voice.publicPath,
      bytes: source.voice.bytes,
      sha256: source.voice.sha256,
      durationSeconds: source.voice.durationSeconds
    },
    sourceGeneration: structuredClone(sourceGeneration),
    currentUseBinding: structuredClone(currentUseBinding),
    currentUseBindingHash,
    priorReviewEvidence: structuredClone(priorReviewEvidence),
    comparison: structuredClone(equivalence),
    machineChecks: structuredClone(checks),
    humanDecisionBinding: structuredClone(humanDecisionBinding),
    humanApproval: null,
    apiAndCost: {
      mode: "local-read-only-rebind-inspection",
      networkCalls: 0,
      externalApiCalls: 0,
      externalInferenceCalls: 0,
      maximumPaidCostUsd: 0
    },
    consequencesIfLaterRegistered: [
      "只更新 voice-v001 的当前使用绑定证明，并重新打开素材总审。",
      "保留原始 v002、Storyboard v3、Asset v9、原始机器验证和人工授权作为不可变生成历史。"
    ],
    notAuthorizedByThisCandidate: [
      "本次只读检查不会登记或修改 Episode。",
      "不运行 Voice Agent、Render Agent、QA Agent，也不批准素材总审或最终发布。",
      "不调用任何外部 API、模型推理、声音合成或付费服务。"
    ],
    risks: [
      "若脚本、九镜语音分段、WAV、当前批准或零调用账本发生变化，未来登记必须以 409 拒绝并重新展示候选。",
      "不能把 v4/v13 写成原始生成来源；它们只能记录为 currentUseBinding。",
      "S03 音频第二句按渲染方案约在 11.883 秒开始，而当前字幕在 14.794 秒切换，相差 2.911 秒；逐词或逐音同步未验证。"
    ]
  };
  return {
    episodeId: episode.id,
    candidateId,
    candidateHash,
    machineVerificationId,
    machineVerification,
    normalizedCandidate,
    dossier,
    humanDecisionBinding,
    humanApproval: null,
    registrationRequest,
    registrationImplemented: false,
    liveStateModified: false
  };
}

async function verifyRegisteredLocalOfflineVoiceForAssetsInternal(episode, options = {}) {
  const fixed = registrationConfig(options);
  const sourceAssetExecution = episode.voice?.provenance?.sourceBindings?.assetExecution;
  assertHistoricalAssetExecutionBinding(episode, sourceAssetExecution);
  const reuse = assertCurrentAssetExecutionAllowsVoiceReuse(
    episode,
    sourceAssetExecution,
    options
  );
  const verified = await inspectCandidateForEpisode(episode, {
    ...options,
    requireVoiceGate: false,
    sourceAssetExecutionBinding: sourceAssetExecution
  });
  const voice = episode.voice;
  const fileName = `voice-v${String(voice?.version ?? 0).padStart(3, "0")}.wav`;
  const directory = ensureInside(
    workspaceRoot,
    resolve((options.episodePublicDirectory ?? episodePublicDirectory)(episode.id))
  );
  const destination = ensureInside(directory, resolve(directory, fileName));
  const expectedPath = workspaceRelativePath(destination);
  const expectedPublicPath = `episodes/${episode.id}/${fileName}`;
  assertRegisteredVoiceBinding(episode, verified, expectedPath, expectedPublicPath, fixed);
  const destinationFile = await assertNoSymlinkRegularFile(destination, workspaceRoot, options);
  assertPreReadFileSize(destinationFile, {
    label: "已登记本地旁白",
    expectedBytes: voice.bytes,
    maxBytes: CANDIDATE_WAV_MAX_BYTES
  });
  const data = await (options.readFile ?? readFile)(destination);
  if (
    destinationFile.bytes !== data.length
    || data.length !== voice.bytes
    || sha256(data) !== voice.sha256
    || voice.sha256 !== fixed.wavSha256
  ) {
    throw registrationError(
      "已登记的本地旁白文件与 v002 来源不一致",
      "local_tts_registered_file_invalid"
    );
  }
  const wav = inspectPcmWav(data);
  return {
    candidateHash: verified.candidateHash,
    machineVerificationId: verified.machineVerificationId,
    machineVerification: structuredClone(verified.machineVerification),
    machineVerificationHash: verified.machineVerification.verificationHash,
    verificationId: voice.authorization.verificationId,
    path: destination,
    bytes: data.length,
    sha256: sha256(data),
    wav,
    sourceAssetExecution: structuredClone(sourceAssetExecution),
    currentAssetExecution: structuredClone(reuse.currentBinding),
    reusedAcrossAssetExecutionCandidate: reuse.attestation.reused,
    reuseAttestation: structuredClone(reuse.attestation)
  };
}

function isLocalOfflineRegistration(episode) {
  return episode.voice?.mode === "local-offline-tts";
}

async function registerApprovedLocalOfflineTtsInternal(episodeId, input, options = {}) {
  const fixed = registrationConfig(options);
  if (episodeId !== fixed.episodeId) {
    throw registrationError(
      "本地离线 TTS v002 只允许登记到其绑定的 Episode",
      "local_tts_episode_conflict"
    );
  }
  assertRegistrationInput(input, undefined, fixed);
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const publicDirectoryFor = options.episodePublicDirectory ?? episodePublicDirectory;
  const listDirectory = options.readdir ?? readdir;
  const releaseOperation = acquireEpisodeOperation(
    episodeId,
    "register-local-offline-tts-v002",
    { conflictMessage: "这一期已有 Agent 或旁白登记操作正在运行" }
  );
  const operationId = `operation:register-local-offline-tts:${episodeId}:${randomUUID()}`;
  let operationClaimed = false;
  let destination = null;
  let destinationCreated = false;
  let temporary = null;
  let committed = false;
  try {
    let episode = await readState(episodeId);
    if (isLocalOfflineRegistration(episode)) {
      const existing = await verifyRegisteredLocalOfflineVoiceForAssetsInternal(
        episode,
        options
      );
      assertRegistrationInput(input, existing, fixed);
      await recordEvent({
        type: "voice.local_offline_tts_registered",
        episodeId,
        candidateId: fixed.candidateId,
        candidateHash: existing.candidateHash,
        machineVerificationId: existing.machineVerificationId,
        machineVerificationHash: existing.machineVerificationHash,
        verificationId: existing.verificationId,
        candidateManifestSha256: fixed.manifestSha256,
        approvedBy: fixed.approvedBy,
        idempotencyKey: `voice.local_offline_tts_registered:${episodeId}:${existing.candidateHash}`,
        message: "本地离线 TTS v002 已正式登记，尚未运行 Voice Agent"
      });
      return {
        episode,
        candidateId: fixed.candidateId,
        candidateHash: existing.candidateHash,
        machineVerificationId: existing.machineVerificationId,
        machineVerificationHash: existing.machineVerificationHash,
        verificationId: existing.verificationId,
        unchanged: true
      };
    }

    const verified = await inspectCandidateForEpisode(episode, options);
    assertRegistrationInput(input, verified, fixed);
    const ledgerHash = ledgerSnapshotHash(episode);
    claimPersistedEpisodeOperation(episode, {
      id: operationId,
      kind: "register-local-offline-tts-v002",
      now: options.now
    });
    await writeState(episode);
    operationClaimed = true;

    const directory = ensureInside(workspaceRoot, resolve(publicDirectoryFor(episodeId)));
    await mkdir(directory, { recursive: true });
    const fileName = nextVoiceFileName(await listDirectory(directory));
    destination = ensureInside(directory, resolve(directory, fileName));
    temporary = `${destination}.registering`;
    await writeFile(temporary, verified.wavData, { flag: "wx" });
    await link(temporary, destination);
    destinationCreated = true;
    await rm(temporary);
    temporary = null;

    const copiedFile = await assertNoSymlinkRegularFile(destination, workspaceRoot, options);
    assertPreReadFileSize(copiedFile, {
      label: "版本化本地旁白副本",
      expectedBytes: verified.wavData.length,
      maxBytes: CANDIDATE_WAV_MAX_BYTES
    });
    const copiedData = await (options.readFile ?? readFile)(destination);
    const copiedWav = inspectPcmWav(copiedData);
    if (
      copiedFile.bytes !== copiedData.length
      || copiedData.length !== verified.wavData.length
      || sha256(copiedData) !== fixed.wavSha256
      || JSON.stringify(copiedWav) !== JSON.stringify(verified.wav)
    ) {
      throw registrationError(
        "旁白版本化复制后的文件复验失败",
        "local_tts_copy_verification_failed"
      );
    }

    episode = await readState(episodeId);
    if (episode.control?.activeOperation?.id !== operationId) {
      throw registrationError("旁白登记操作所有权已失效", "local_tts_operation_lost");
    }
    const currentVerification = await inspectCandidateForEpisode(episode, options);
    assertRegistrationInput(input, currentVerification, fixed);
    assertEqual(
      currentVerification.candidateHash,
      verified.candidateHash,
      "复制期间 v002 候选或上游批准发生变化"
    );
    assertEqual(ledgerSnapshotHash(episode), ledgerHash, "复制期间费用或调用账本发生变化");

    const registeredAt = timestamp(options.now);
    const version = Number(/^voice-v(\d{3})\.wav$/u.exec(fileName)?.[1]);
    const publicPath = `episodes/${episodeId}/${fileName}`;
    const authorization = {
      schemaVersion: 1,
      decision: "approved",
      approvedBy: fixed.approvedBy,
      approvedAt: registeredAt,
      recordedAt: registeredAt,
      scope: fixed.confirmation,
      note: fixed.humanDecisionNote,
      candidateId: fixed.candidateId,
      candidateHash: verified.candidateHash,
      candidateManifestSha256: fixed.manifestSha256,
      candidateWavSha256: fixed.wavSha256,
      machineVerificationId: verified.machineVerificationId,
      machineVerificationHash: verified.machineVerification.verificationHash
    };
    authorization.verificationId = humanVerificationId(authorization);
    episode.voice = {
      status: "ready",
      version,
      mode: "local-offline-tts",
      audioPath: workspaceRelativePath(destination),
      publicPath,
      bytes: copiedData.length,
      durationSeconds: copiedWav.durationSeconds,
      sampleRate: copiedWav.sampleRate,
      channels: copiedWav.channels,
      bitsPerSample: copiedWav.bitsPerSample,
      sha256: fixed.wavSha256,
      registeredAt,
      note: "已登记人工批准的本地离线 TTS v002，等待 Voice Agent 机器审核。",
      needsRevision: false,
      provenance: {
        schemaVersion: 1,
        source: "local-offline-tts",
        candidateId: fixed.candidateId,
        candidateVersion: fixed.candidateVersion,
        candidateHash: verified.candidateHash,
        machineVerificationId: verified.machineVerificationId,
        machineVerification: structuredClone(verified.machineVerification),
        candidateManifestPath: verified.normalizedCandidate.manifest.path,
        candidateManifestBytes: verified.normalizedCandidate.manifest.bytes,
        candidateManifestSha256: fixed.manifestSha256,
        candidateWavPath: verified.normalizedCandidate.wav.path,
        candidateWavBytes: verified.normalizedCandidate.wav.bytes,
        candidateWavSha256: fixed.wavSha256,
        sourceBindings: verified.normalizedCandidate.source,
        model: verified.normalizedCandidate.model,
        voice: verified.normalizedCandidate.voice,
        generation: verified.normalizedCandidate.generation,
        pacingProfileVersion: SHORT_LOCAL_TTS_PACING_PROFILE_VERSION,
        offlineVerified: true,
        externalApiCalls: 0,
        maximumPaidCostUsd: 0,
        ledgerHash
      },
      verification: {
        schemaVersion: 1,
        id: verified.machineVerification.id,
        verifierVersion: CANDIDATE_VERIFIER_VERSION,
        status: "passed",
        verifiedAt: registeredAt,
        candidateHash: verified.candidateHash,
        machineVerificationId: verified.machineVerificationId,
        verificationHash: verified.machineVerification.verificationHash,
        checks: [...verified.checks],
        ledgerHash
      },
      authorization
    };
    episode.voice.provenance.humanSelection = structuredClone(authorization);
    const assetBundleRevision = nextAssetBundleRevision(episode);
    episode.production = { ...(episode.production ?? {}), assetBundleRevision };
    episode.approvals.assets = resetApprovalForVersion(
      episode.approvals.assets,
      assetBundleRevision
    );
    episode.approvals.final = resetApprovalForVersion(
      episode.approvals.final,
      episode.render?.version ?? null
    );
    invalidateReviewForGate(episode, "assets");
    invalidateReviewForGate(episode, "final");
    const voiceIndex = episode.pipeline.findIndex((step) => step.agent === "voice-agent");
    if (voiceIndex < 0) {
      throw registrationError("Episode 缺少 Voice Agent", "local_tts_voice_agent_missing");
    }
    episode.pipeline[voiceIndex] = {
      ...episode.pipeline[voiceIndex],
      status: "ready",
      progress: 0,
      message: "本地离线 TTS v002 已正式登记，可以由 Voice Agent 机器审核",
      requiresApproval: null,
      requiresHuman: false,
      artifacts: [workspaceRelativePath(destination)],
      findings: [],
      finishedAt: null,
      lastError: null
    };
    for (let index = voiceIndex + 1; index < episode.pipeline.length; index += 1) {
      episode.pipeline[index] = {
        ...episode.pipeline[index],
        status: "pending",
        progress: 0,
        requiresApproval: null,
        requiresHuman: false,
        message: "等待新旁白通过素材总审"
      };
    }
    episode.render = { ...episode.render, status: "stale", progress: 0 };
    episode.qa = { ...episode.qa, status: "stale", checkedAt: registeredAt };
    episode.status = "in_production";
    episode.updatedAt = registeredAt;
    episode.history = [
      ...(episode.history ?? []),
      {
        at: registeredAt,
        type: "local-offline-tts-registered",
        candidateId: fixed.candidateId,
        candidateHash: verified.candidateHash,
        machineVerificationId: verified.machineVerificationId,
        machineVerificationHash: verified.machineVerification.verificationHash,
        verificationId: authorization.verificationId,
        candidateManifestSha256: fixed.manifestSha256,
        approvedBy: fixed.approvedBy,
        message: "人工批准的本地离线 TTS v002 已登记，等待 Voice Agent 审核"
      }
    ];
    assertEqual(ledgerSnapshotHash(episode), ledgerHash, "登记操作改变了费用或调用账本");
    releasePersistedEpisodeOperation(episode, operationId);
    await writeState(episode);
    operationClaimed = false;
    committed = true;
    await recordEvent({
      type: "voice.local_offline_tts_registered",
      episodeId,
      candidateId: fixed.candidateId,
      candidateHash: verified.candidateHash,
      machineVerificationId: verified.machineVerificationId,
      machineVerificationHash: verified.machineVerification.verificationHash,
      verificationId: authorization.verificationId,
      candidateManifestSha256: fixed.manifestSha256,
      approvedBy: fixed.approvedBy,
      idempotencyKey: `voice.local_offline_tts_registered:${episodeId}:${verified.candidateHash}`,
      message: "本地离线 TTS v002 已正式登记，尚未运行 Voice Agent"
    });
    return {
      episode,
      candidateId: fixed.candidateId,
      candidateHash: verified.candidateHash,
      machineVerificationId: verified.machineVerificationId,
      machineVerificationHash: verified.machineVerification.verificationHash,
      verificationId: authorization.verificationId,
      unchanged: false
    };
  } catch (error) {
    if (!committed) {
      if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
      if (destinationCreated && destination) {
        await rm(destination, { force: true }).catch(() => undefined);
      }
      if (operationClaimed) {
        const current = await readState(episodeId).catch(() => null);
        if (current && releasePersistedEpisodeOperation(current, operationId)) {
          current.updatedAt = timestamp(options.now);
          await writeState(current).catch(() => undefined);
        }
      }
    }
    throw error;
  } finally {
    releaseOperation();
  }
}

export function createLocalOfflineVoiceService(policyInput = {}) {
  const policy = createServicePolicy(policyInput);
  return Object.freeze({
    inspectLocalOfflineTtsCandidate(episodeId, options = {}) {
      return inspectLocalOfflineTtsCandidateInternal(
        episodeId,
        bindServicePolicy(options, policy)
      );
    },
    inspectRegisteredLocalOfflineTtsRebindCandidate(episodeId, options = {}) {
      return inspectRegisteredLocalOfflineTtsRebindCandidateInternal(
        episodeId,
        bindServicePolicy(options, policy)
      );
    },
    verifyRegisteredLocalOfflineVoiceForAssets(episode, options = {}) {
      return verifyRegisteredLocalOfflineVoiceForAssetsInternal(
        episode,
        bindServicePolicy(options, policy)
      );
    },
    registerApprovedLocalOfflineTts(episodeId, input, options = {}) {
      return registerApprovedLocalOfflineTtsInternal(
        episodeId,
        input,
        bindServicePolicy(options, policy)
      );
    }
  });
}
