import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { readEpisode } from "../src/shared/store.mjs";
import {
  ensureInside,
  episodeOutputDirectory,
  studioRoot,
  workspaceRelativePath,
  workspaceRoot
} from "../src/shared/paths.mjs";
import { wavDurationSeconds } from "../src/server/production/voice.mjs";
import {
  assetExecutionApprovalRecordValid,
  assetExecutionApprovalValid
} from
  "../src/server/reviews/asset-execution-checkpoint.mjs";
import { approvalValidForGate } from "../src/server/control/policy-engine.mjs";
import {
  LOCAL_TTS_MODEL,
  LOCAL_TTS_SAMPLE_RATE,
  LOCAL_TTS_VOICES
} from "../src/video/agent-skill-local-tts-plan.mjs";
import {
  SHORT_LOCAL_TTS_DURATION_SECONDS,
  SHORT_LOCAL_TTS_EPISODE_ID,
  SHORT_LOCAL_TTS_NETWORK_GUARDS,
  SHORT_LOCAL_TTS_PACING_PROFILE_VERSION,
  SHORT_LOCAL_TTS_VOICE_ID,
  assertShortLocalTtsRenderedSegments,
  buildShortLocalTtsSegments,
  nextShortLocalTtsCandidateVersion
} from "../src/video/agent-skill-short-local-tts-candidate.mjs";

const execute = promisify(execFile);
const cacheRoot = process.env.AI_CONCEPT_STUDIO_KOKORO_ROOT?.trim()
  ? resolve(process.env.AI_CONCEPT_STUDIO_KOKORO_ROOT)
  : resolve(homedir(), ".cache", "ai-concept-studio", "kokoro312");
const modelDirectory = resolve(cacheRoot, "model-v1.1-zh");
const modelPath = resolve(modelDirectory, LOCAL_TTS_MODEL.fileName);
const configPath = resolve(modelDirectory, "config.json");
const voice = LOCAL_TTS_VOICES.find(({ id }) => id === SHORT_LOCAL_TTS_VOICE_ID);
const voicePath = resolve(modelDirectory, "voices", `${SHORT_LOCAL_TTS_VOICE_ID}.pt`);
const pythonPath = resolve(cacheRoot, "venv", "bin", "python");
const generatorPath = resolve(studioRoot, "scripts", "generate-agent-skill-local-tts.py");

function sha256Data(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function sha256File(path) {
  return sha256Data(await readFile(path));
}

async function requirePinnedFile(path, expectedHash, label) {
  await access(path);
  const actualHash = await sha256File(path);
  if (actualHash !== expectedHash) throw new Error(`${label} SHA-256 校验失败`);
  return actualHash;
}

function requireApprovedStage(episode, stage, productionKey) {
  const approval = episode.approvals?.[stage];
  const artifact = episode.production?.[productionKey];
  if (
    !approvalValidForGate(episode, stage)
    || !Number.isInteger(artifact?.version)
    || approval.currentVersion !== artifact.version
  ) {
    throw new Error(`${stage} 必须是当前机器审核通过且人工批准的精确版本`);
  }
  return {
    version: artifact.version,
    artifactPath: artifact.artifactPath,
    artifactHash: approval.artifactHash,
    reviewReportId: approval.reviewReportId
  };
}

export function assertShortLocalTtsCandidateApprovals(episode, options = {}) {
  const script = requireApprovedStage(episode, "script", "scriptDraft");
  const storyboard = requireApprovedStage(episode, "storyboard", "storyboardDraft");
  const checkpoint = episode.reviewCheckpoints?.assetExecution;
  const candidate = checkpoint?.currentCandidate;
  const policy = episode.production?.assetPlan?.content?.executionPolicy;
  if (
    !assetExecutionApprovalRecordValid(episode)
    || !(options.validateAssetExecutionApproval ?? assetExecutionApprovalValid)(episode)
    || checkpoint?.status !== "approved"
    || !Number.isInteger(candidate?.version)
    || candidate.version <= 0
    || checkpoint?.humanApproval?.candidateHash !== candidate?.candidateHash
    || policy?.mode !== "local-only"
    || !Array.isArray(policy.externalApiCalls)
    || policy.externalApiCalls.length !== 0
    || policy.maximumPaidCostUsd !== 0
    || (checkpoint.humanApproval.authorizedToolIds ?? []).length !== 0
  ) {
    throw new Error("素材执行方案必须保持当前本地零调用候选的机器审核和人工批准状态");
  }
  const voiceStep = episode.pipeline?.find((step) => step.agent === "voice-agent");
  if (
    voiceStep?.status !== "blocked"
    || voiceStep.requiresHuman !== true
    || episode.voice?.status !== "unconfigured"
    || episode.voice?.mode !== null
    || episode.voice?.audioPath !== null
  ) {
    throw new Error("当前 Episode 必须停在等待人工授权音频的 Voice Agent Gate");
  }
  return {
    script,
    storyboard,
    assetExecution: {
      version: candidate.version,
      candidateHash: candidate.candidateHash,
      planHash: candidate.planHash,
      approvedAt: checkpoint.humanApproval.at,
      authorizedToolIds: [...(checkpoint.humanApproval.authorizedToolIds ?? [])]
    }
  };
}

async function readCurrentVoicePlan(episode) {
  const record = episode.production?.voicePlan;
  if (!Number.isInteger(record?.version) || typeof record?.artifactPath !== "string") {
    throw new Error("当前 Episode 没有版本化 voice plan");
  }
  const path = ensureInside(workspaceRoot, resolve(workspaceRoot, record.artifactPath));
  const data = await readFile(path);
  return {
    record,
    path,
    data,
    value: JSON.parse(data.toString("utf8")),
    sha256: sha256Data(data)
  };
}

export async function buildAgentSkillShortLocalTtsCandidate(options = {}) {
  const episode = await (options.readEpisode ?? readEpisode)(SHORT_LOCAL_TTS_EPISODE_ID);
  const approvals = assertShortLocalTtsCandidateApprovals(episode);
  const voicePlan = await readCurrentVoicePlan(episode);
  const plan = buildShortLocalTtsSegments(episode, voicePlan.value);
  if (!voice) throw new Error(`固定音色 ${SHORT_LOCAL_TTS_VOICE_ID} 未登记`);

  const verifiedModelSha256 = await requirePinnedFile(
    modelPath,
    LOCAL_TTS_MODEL.sha256,
    "Kokoro 中文模型"
  );
  const verifiedConfigSha256 = await requirePinnedFile(
    configPath,
    LOCAL_TTS_MODEL.configSha256,
    "Kokoro 中文配置"
  );
  const verifiedVoiceSha256 = await requirePinnedFile(
    voicePath,
    voice.sha256,
    SHORT_LOCAL_TTS_VOICE_ID
  );
  await access(pythonPath);
  await access(generatorPath);

  const outputDirectory = episodeOutputDirectory(episode.id);
  await mkdir(outputDirectory, { recursive: true });
  const version = nextShortLocalTtsCandidateVersion(await readdir(outputDirectory));
  const versionLabel = String(version).padStart(3, "0");
  const outputPath = resolve(
    outputDirectory,
    `short-local-tts-${SHORT_LOCAL_TTS_VOICE_ID}-v${versionLabel}.wav`
  );
  const temporaryOutputPath = resolve(
    outputDirectory,
    `short-local-tts-${SHORT_LOCAL_TTS_VOICE_ID}-v${versionLabel}.rendering.wav`
  );
  const manifestPath = resolve(
    outputDirectory,
    `short-local-tts-${SHORT_LOCAL_TTS_VOICE_ID}-v${versionLabel}-manifest.json`
  );
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "agent-skill-short-local-tts-"));
  const requestPath = resolve(temporaryDirectory, "request.json");
  const resultPath = resolve(temporaryDirectory, "result.json");

  try {
    const request = {
      schemaVersion: 1,
      sampleRate: LOCAL_TTS_SAMPLE_RATE,
      model: {
        repoId: LOCAL_TTS_MODEL.repoId,
        languageCode: LOCAL_TTS_MODEL.languageCode,
        modelPath,
        configPath
      },
      candidates: [],
      proof: {
        durationSeconds: SHORT_LOCAL_TTS_DURATION_SECONDS,
        voiceId: SHORT_LOCAL_TTS_VOICE_ID,
        voicePath,
        outputPath: temporaryOutputPath,
        segments: plan.segments
      }
    };
    await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    const execution = await execute(pythonPath, [
      generatorPath,
      "--request", requestPath,
      "--result", resultPath
    ], {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        TMPDIR: tmpdir(),
        LANG: process.env.LANG ?? "en_US.UTF-8",
        LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        HF_DATASETS_OFFLINE: "1",
        HF_HOME: resolve(temporaryDirectory, "hf-cache"),
        XDG_CACHE_HOME: resolve(temporaryDirectory, "xdg-cache"),
        DO_NOT_TRACK: "1",
        PYTHONHASHSEED: "0",
        PYTHONNOUSERSITE: "1",
        TOKENIZERS_PARALLELISM: "false"
      },
      timeout: 20 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024
    });
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    if (
      result.offlineEnvironmentVerified !== true
      || result.networkGuard !== "python-socket-connect-blocked"
      || !SHORT_LOCAL_TTS_NETWORK_GUARDS.every((guard) => result.networkGuards?.includes(guard))
    ) {
      throw new Error("本地 TTS 未返回完整的 DNS、TCP 和 UDP 网络隔离证明");
    }
    if (
      result.candidates?.length !== 0
    ) {
      throw new Error("当前稿试听任务不得返回额外音色候选");
    }
    assertShortLocalTtsRenderedSegments(plan, result.proof?.segments);

    const outputData = await readFile(temporaryOutputPath);
    const durationSeconds = wavDurationSeconds(outputData);
    if (Math.abs(durationSeconds - SHORT_LOCAL_TTS_DURATION_SECONDS) > 0.01) {
      throw new Error(`本地 TTS 试听时长 ${durationSeconds}s 不等于 60s`);
    }
    await rename(temporaryOutputPath, outputPath);

    const generatedAt = new Date().toISOString();
    const segmentPlanSha256 = sha256Data(JSON.stringify(plan.segments));
    const manifest = {
      schemaVersion: 1,
      id: `agent-skill-short-local-tts-${SHORT_LOCAL_TTS_VOICE_ID}-v${versionLabel}`,
      episodeId: episode.id,
      version,
      generatedAt,
      status: "human-review-candidate",
      source: {
        script: approvals.script,
        storyboard: approvals.storyboard,
        voicePlan: {
          version: voicePlan.record.version,
          artifactPath: voicePlan.record.artifactPath,
          sha256: voicePlan.sha256,
          narrationSha256: sha256Data(plan.narration)
        },
        subtitlesSha256: sha256Data(JSON.stringify(episode.subtitles)),
        segmentPlanSha256,
        pacingProfileVersion: SHORT_LOCAL_TTS_PACING_PROFILE_VERSION,
        assetExecution: approvals.assetExecution
      },
      model: {
        ...LOCAL_TTS_MODEL,
        verifiedSha256: verifiedModelSha256,
        verifiedConfigSha256,
        license: "Apache-2.0"
      },
      voice: {
        id: SHORT_LOCAL_TTS_VOICE_ID,
        packageSha256: verifiedVoiceSha256
      },
      audio: {
        outputPath: workspaceRelativePath(outputPath),
        bytes: outputData.length,
        sha256: sha256Data(outputData),
        durationSeconds,
        sampleRate: LOCAL_TTS_SAMPLE_RATE,
        channels: 1,
        segments: result.proof.segments
      },
      generation: {
        mode: "local-offline-kokoro",
        inferenceDevice: result.device,
        offlineEnvironmentVerified: true,
        networkPolicy: "deny-all",
        networkGuard: result.networkGuard,
        networkGuards: result.networkGuards,
        paidApiCalls: 0,
        externalInferenceCalls: 0,
        modelDownloadCallsDuringGeneration: 0,
        textUploadCalls: 0,
        maximumPaidCostUsd: 0
      },
      usage: "仅供当前批准脚本的本地离线音色试听；人工通过前不登记为正式旁白",
      generatorStderr: execution.stderr.trim() || null
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    return { manifest, manifestPath: workspaceRelativePath(manifestPath) };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    await rm(temporaryOutputPath, { force: true }).catch(() => undefined);
  }
}

async function main() {
  const result = await buildAgentSkillShortLocalTtsCandidate();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
