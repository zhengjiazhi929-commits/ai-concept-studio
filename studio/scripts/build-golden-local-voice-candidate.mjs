import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { readEpisode } from "../src/shared/store.mjs";
import {
  episodeOutputDirectory,
  publicRoot,
  resolveExistingPathInside,
  studioRoot,
  workspaceRelativePath
} from "../src/shared/paths.mjs";
import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import { inspectPcm16MonoWav } from "../src/server/production/local-media-inspection.mjs";
import {
  LOCAL_TTS_MODEL,
  LOCAL_TTS_SAMPLE_RATE,
  LOCAL_TTS_VOICES
} from "../src/video/agent-skill-local-tts-plan.mjs";
import {
  SHORT_LOCAL_TTS_NETWORK_GUARDS,
  assertShortLocalTtsRenderedSegments
} from "../src/video/agent-skill-short-local-tts-candidate.mjs";
import {
  GOLDEN_LOCAL_VOICE_DURATION_SECONDS,
  GOLDEN_LOCAL_VOICE_EPISODE_ID,
  GOLDEN_LOCAL_VOICE_ID,
  buildGoldenLocalVoicePlan,
  nextGoldenLocalVoiceCandidateVersion
} from "../src/video/golden-local-voice-plan.mjs";

const execute = promisify(execFile);
const cacheRoot = process.env.AI_CONCEPT_STUDIO_KOKORO_ROOT?.trim()
  ? resolve(process.env.AI_CONCEPT_STUDIO_KOKORO_ROOT)
  : resolve(homedir(), ".cache", "ai-concept-studio", "kokoro312");
const modelDirectory = resolve(cacheRoot, "model-v1.1-zh");
const modelPath = resolve(modelDirectory, LOCAL_TTS_MODEL.fileName);
const configPath = resolve(modelDirectory, "config.json");
const voice = LOCAL_TTS_VOICES.find((item) => item.id === GOLDEN_LOCAL_VOICE_ID);
const voicePath = resolve(modelDirectory, "voices", `${GOLDEN_LOCAL_VOICE_ID}.pt`);
const pythonPath = resolve(cacheRoot, "venv", "bin", "python");
const generatorPath = resolve(studioRoot, "scripts", "generate-agent-skill-local-tts.py");
const runtimeLockPath = resolve(studioRoot, "config", "local-tts-python-runtime.lock.json");

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function requirePinnedFile(path, expectedHash, label) {
  await access(path);
  const data = await readFile(path);
  const actual = sha256(data);
  if (actual !== expectedHash) throw new Error(`${label} SHA-256 校验失败`);
  return { path, bytes: data.length, sha256: actual };
}

export async function verifyEpisodeAssets(episode, options = {}) {
  const allowedPublicRoot = options.publicRoot ?? publicRoot;
  const inspect = options.inspectFileIntegrity ?? inspectFileIntegrity;
  const verified = [];
  for (const asset of episode.assets ?? []) {
    const path = await resolveExistingPathInside(
      allowedPublicRoot,
      resolve(allowedPublicRoot, asset.path)
    );
    const integrity = await inspect(path);
    if (integrity.bytes !== asset.bytes || integrity.sha256 !== asset.sha256) {
      throw new Error(`素材 ${asset.id} 当前字节与 Episode 登记不一致`);
    }
    verified.push({
      id: asset.id,
      path: asset.path,
      bytes: integrity.bytes,
      sha256: integrity.sha256,
      source: asset.source ?? null,
      privacy: asset.privacy ?? null
    });
  }
  return verified;
}

export async function buildGoldenLocalVoiceCandidate(options = {}) {
  const episode = await (options.readEpisode ?? readEpisode)(GOLDEN_LOCAL_VOICE_EPISODE_ID);
  const plan = buildGoldenLocalVoicePlan(episode);
  if (!voice) throw new Error(`固定音色 ${GOLDEN_LOCAL_VOICE_ID} 未登记`);

  const runtimeLockData = await readFile(runtimeLockPath);
  const runtimeLock = JSON.parse(runtimeLockData.toString("utf8"));

  const [model, config, voicePackage, generator, runtimeLockIntegrity, python, assets] =
    await Promise.all([
    requirePinnedFile(modelPath, LOCAL_TTS_MODEL.sha256, "Kokoro 中文模型"),
    requirePinnedFile(configPath, LOCAL_TTS_MODEL.configSha256, "Kokoro 中文配置"),
    requirePinnedFile(voicePath, voice.sha256, `${GOLDEN_LOCAL_VOICE_ID} 音色包`),
    inspectFileIntegrity(generatorPath),
    inspectFileIntegrity(runtimeLockPath),
    requirePinnedFile(pythonPath, runtimeLock.executableSha256, "本地 TTS Python 解释器"),
    verifyEpisodeAssets(episode)
  ]);

  const outputDirectory = episodeOutputDirectory(episode.id);
  await mkdir(outputDirectory, { recursive: true });
  const version = nextGoldenLocalVoiceCandidateVersion(await readdir(outputDirectory));
  const versionLabel = String(version).padStart(3, "0");
  const outputPath = resolve(
    outputDirectory,
    `golden-local-voice-${GOLDEN_LOCAL_VOICE_ID}-v${versionLabel}.wav`
  );
  const temporaryOutputPath = resolve(
    outputDirectory,
    `golden-local-voice-${GOLDEN_LOCAL_VOICE_ID}-v${versionLabel}.rendering.wav`
  );
  const manifestPath = resolve(
    outputDirectory,
    `golden-local-voice-${GOLDEN_LOCAL_VOICE_ID}-v${versionLabel}-manifest.json`
  );
  const reservationPath = resolve(
    outputDirectory,
    `golden-local-voice-${GOLDEN_LOCAL_VOICE_ID}-v${versionLabel}.lock`
  );
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "golden-local-voice-"));
  const requestPath = resolve(temporaryDirectory, "request.json");
  const resultPath = resolve(temporaryDirectory, "result.json");

  let outputPublished = false;
  try {
    await writeFile(reservationPath, `${process.pid}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    const request = {
      schemaVersion: 1,
      sampleRate: LOCAL_TTS_SAMPLE_RATE,
      model: {
        repoId: LOCAL_TTS_MODEL.repoId,
        languageCode: LOCAL_TTS_MODEL.languageCode,
        modelPath,
        configPath
      },
      runtimeLock,
      candidates: [],
      proof: {
        durationSeconds: GOLDEN_LOCAL_VOICE_DURATION_SECONDS,
        voiceId: GOLDEN_LOCAL_VOICE_ID,
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
      || result.candidates?.length !== 0
      || JSON.stringify(result.runtime) !== JSON.stringify(runtimeLock)
    ) {
      throw new Error("本地 TTS 没有返回完整的 Python socket 应用层阻断证明");
    }
    assertShortLocalTtsRenderedSegments(plan, result.proof?.segments);

    const outputData = await readFile(temporaryOutputPath);
    const mediaInspection = inspectPcm16MonoWav(outputData, {
      sampleRate: LOCAL_TTS_SAMPLE_RATE,
      durationSeconds: GOLDEN_LOCAL_VOICE_DURATION_SECONDS,
      maximumInactiveWindowRun: 4
    });
    await link(temporaryOutputPath, outputPath);
    outputPublished = true;
    await rm(temporaryOutputPath, { force: true });

    const generatedAt = new Date().toISOString();
    const manifest = {
      schemaVersion: 1,
      id: `golden-local-voice-${GOLDEN_LOCAL_VOICE_ID}-v${versionLabel}`,
      episodeId: episode.id,
      version,
      generatedAt,
      status: "human-review-candidate",
      source: {
        ...plan.source,
        sourceBindingHash: plan.sourceBindingHash,
        assetBytesVerifiedAtGeneration: assets
      },
      narration: {
        sha256: sha256(Buffer.from(plan.narration, "utf8")),
        pacingProfileVersion: plan.pacingProfileVersion,
        segments: result.proof.segments
      },
      model: {
        ...LOCAL_TTS_MODEL,
        pathPolicy: "local-cache-not-distributed",
        verifiedBytes: model.bytes,
        verifiedSha256: model.sha256,
        verifiedConfigBytes: config.bytes,
        verifiedConfigSha256: config.sha256,
        license: "Apache-2.0"
      },
      voice: {
        id: GOLDEN_LOCAL_VOICE_ID,
        packageBytes: voicePackage.bytes,
        packageSha256: voicePackage.sha256,
        licenseReviewStatus: "voice-package-license-not-independently-verified",
        useBoundary: "local-internal-review-only",
        releaseEligible: false
      },
      generator: {
        path: workspaceRelativePath(generatorPath),
        bytes: generator.bytes,
        sha256: generator.sha256
      },
      runtime: {
        lockPath: workspaceRelativePath(runtimeLockPath),
        lockBytes: runtimeLockIntegrity.bytes,
        lockSha256: runtimeLockIntegrity.sha256,
        pythonBytes: python.bytes,
        pythonSha256: python.sha256,
        fingerprint: result.runtime
      },
      audio: {
        outputPath: workspaceRelativePath(outputPath),
        bytes: outputData.length,
        sha256: sha256(outputData),
        durationSeconds: mediaInspection.durationSeconds,
        sampleRate: mediaInspection.sampleRate,
        channels: mediaInspection.channels,
        bitsPerSample: mediaInspection.bitsPerSample,
        energy: {
          peakAmplitude: mediaInspection.peakAmplitude,
          rootMeanSquareAmplitude: mediaInspection.rootMeanSquareAmplitude,
          activeWindowCount: mediaInspection.activeWindowCount,
          windowCount: mediaInspection.windowCount,
          activeWindowRatio: mediaInspection.activeWindowRatio,
          longestInactiveWindowRun: mediaInspection.longestInactiveWindowRun
        }
      },
      machineChecks: [
        "approved-research-script-storyboard-bound",
        "six-scene-subtitle-timeline-continuous",
        "episode-assets-current-bytes-verified",
        "pinned-local-model-config-and-voice",
        "python-socket-api-guard-during-inference",
        "pcm-16-mono-24khz-duration-and-energy-passed"
      ],
      generation: {
        mode: "local-offline-kokoro",
        inferenceDevice: result.device,
        offlineEnvironmentVerified: true,
        networkPolicy: "python-socket-api-deny",
        networkGuard: result.networkGuard,
        networkGuards: result.networkGuards,
        networkGuardScope: "generator-process-python-socket-apis",
        osLevelNetworkAttestation: false,
        configuredPaidApiCalls: 0,
        configuredExternalInferenceCalls: 0,
        configuredModelDownloadCallsDuringGeneration: 0,
        configuredTextUploadCalls: 0,
        maximumPaidCostUsd: 0,
        elapsedSeconds: result.elapsedSeconds
      },
      usage: "仅供 golden-001 素材/声音 Gate 试听；人工选择并通过安全登记前不写入 Episode",
      generatorStderr: execution.stderr.trim() || null
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    return {
      manifest,
      manifestPath: workspaceRelativePath(manifestPath)
    };
  } catch (error) {
    if (outputPublished) await rm(outputPath, { force: true });
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    await rm(temporaryOutputPath, { force: true }).catch(() => undefined);
    await rm(reservationPath, { force: true }).catch(() => undefined);
  }
}

async function main() {
  const result = await buildGoldenLocalVoiceCandidate();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
