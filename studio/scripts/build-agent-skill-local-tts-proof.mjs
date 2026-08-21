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
import { relative, resolve } from "node:path";
import { promisify } from "node:util";

import { wavDurationSeconds } from "../src/server/production/voice.mjs";
import { studioOutputRoot, studioRoot, workspaceRoot } from "../src/shared/paths.mjs";
import {
  LOCAL_TTS_CANDIDATE_TEXT,
  LOCAL_TTS_DEFAULT_VOICE,
  LOCAL_TTS_DIRECTION,
  LOCAL_TTS_MODEL,
  LOCAL_TTS_PROOF_DURATION_SECONDS,
  LOCAL_TTS_SAMPLE_RATE,
  LOCAL_TTS_SEGMENTS,
  LOCAL_TTS_VOICES,
  nextLocalTtsProofVersion,
  nextLocalTtsScreenVersion
} from "../src/video/agent-skill-local-tts-plan.mjs";

const execute = promisify(execFile);
const episodeId = "agent-skill-20260806";
const outputDirectory = resolve(studioOutputRoot, episodeId);
const cacheRoot = process.env.AI_CONCEPT_STUDIO_KOKORO_ROOT?.trim()
  ? resolve(process.env.AI_CONCEPT_STUDIO_KOKORO_ROOT)
  : resolve(homedir(), ".cache", "ai-concept-studio", "kokoro312");
const modelDirectory = resolve(cacheRoot, "model-v1.1-zh");
const modelPath = resolve(modelDirectory, LOCAL_TTS_MODEL.fileName);
const configPath = resolve(modelDirectory, "config.json");
const pythonPath = resolve(cacheRoot, "venv", "bin", "python");
const generatorPath = resolve(studioRoot, "scripts", "generate-agent-skill-local-tts.py");
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "agent-skill-local-tts-"));

function relativeToWorkspace(path) {
  return relative(workspaceRoot, path).replaceAll("\\", "/");
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function requirePinnedFile(path, expectedHash, label) {
  await access(path);
  const actualHash = await sha256(path);
  if (actualHash !== expectedHash) {
    throw new Error(`${label} SHA-256 校验失败`);
  }
  return actualHash;
}

await mkdir(outputDirectory, { recursive: true });
const outputNames = await readdir(outputDirectory);
const proofVersion = nextLocalTtsProofVersion(outputNames);
const proofVersionLabel = String(proofVersion).padStart(3, "0");
const screenVersion = nextLocalTtsScreenVersion(outputNames);
const screenVersionLabel = String(screenVersion).padStart(3, "0");
const proofPath = resolve(outputDirectory, `local-tts-proof-v${proofVersionLabel}.wav`);
const temporaryProofPath = resolve(
  outputDirectory,
  `local-tts-proof-v${proofVersionLabel}.rendering.wav`
);
const proofManifestPath = resolve(
  outputDirectory,
  `local-tts-proof-v${proofVersionLabel}-manifest.json`
);
const screenDirectory = resolve(
  outputDirectory,
  `local-tts-voice-screen-v${screenVersionLabel}`
);
const temporaryScreenDirectory = `${screenDirectory}.rendering`;
const requestPath = resolve(temporaryDirectory, "request.json");
const resultPath = resolve(temporaryDirectory, "result.json");

try {
  await requirePinnedFile(modelPath, LOCAL_TTS_MODEL.sha256, "Kokoro 中文模型");
  await requirePinnedFile(configPath, LOCAL_TTS_MODEL.configSha256, "Kokoro 中文配置");
  await access(pythonPath);
  await access(generatorPath);
  const verifiedVoices = [];
  for (const voice of LOCAL_TTS_VOICES) {
    const voicePath = resolve(modelDirectory, "voices", `${voice.id}.pt`);
    verifiedVoices.push({
      ...voice,
      path: voicePath,
      verifiedSha256: await requirePinnedFile(voicePath, voice.sha256, `${voice.id} 声音包`)
    });
  }

  await mkdir(temporaryScreenDirectory, { recursive: false });
  const request = {
    schemaVersion: 1,
    sampleRate: LOCAL_TTS_SAMPLE_RATE,
    model: {
      repoId: LOCAL_TTS_MODEL.repoId,
      languageCode: LOCAL_TTS_MODEL.languageCode,
      modelPath,
      configPath
    },
    candidateText: LOCAL_TTS_CANDIDATE_TEXT,
    candidates: verifiedVoices.map((voice) => ({
      voiceId: voice.id,
      voicePath: voice.path,
      speed: 1,
      outputPath: resolve(temporaryScreenDirectory, `${voice.id}.wav`)
    })),
    proof: {
      durationSeconds: LOCAL_TTS_PROOF_DURATION_SECONDS,
      voiceId: LOCAL_TTS_DEFAULT_VOICE,
      voicePath: verifiedVoices.find((voice) => voice.id === LOCAL_TTS_DEFAULT_VOICE)?.path,
      outputPath: temporaryProofPath,
      segments: LOCAL_TTS_SEGMENTS
    }
  };
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
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
  if (!result.offlineEnvironmentVerified || result.networkGuard !== "python-socket-connect-blocked") {
    throw new Error("本地 TTS 未返回网络隔离证明");
  }

  const proofData = await readFile(temporaryProofPath);
  const proofDurationSeconds = wavDurationSeconds(proofData);
  if (Math.abs(proofDurationSeconds - LOCAL_TTS_PROOF_DURATION_SECONDS) > 0.01) {
    throw new Error(`本地 TTS 试听时长 ${proofDurationSeconds}s 不等于 60s`);
  }
  await rename(temporaryProofPath, proofPath);
  await rename(temporaryScreenDirectory, screenDirectory);

  const candidateFiles = [];
  for (const voice of verifiedVoices) {
    const path = resolve(screenDirectory, `${voice.id}.wav`);
    const data = await readFile(path);
    candidateFiles.push({
      voiceId: voice.id,
      path: relativeToWorkspace(path),
      bytes: data.length,
      durationSeconds: wavDurationSeconds(data),
      sha256: createHash("sha256").update(data).digest("hex"),
      voicePackageSha256: voice.verifiedSha256
    });
  }
  const generatedAt = new Date().toISOString();
  const commonGeneration = {
    mode: "local-open-source-kokoro",
    inferenceDevice: result.device,
    offlineEnvironmentVerified: true,
    networkGuard: result.networkGuard,
    paidApiCalls: 0,
    externalInferenceCalls: 0,
    modelDownloadCallsDuringGeneration: 0,
    textUploadCalls: 0
  };
  const model = {
    ...LOCAL_TTS_MODEL,
    verifiedSha256: LOCAL_TTS_MODEL.sha256,
    verifiedConfigSha256: LOCAL_TTS_MODEL.configSha256,
    license: "Apache-2.0"
  };
  const candidateManifest = {
    schemaVersion: 1,
    id: `agent-skill-local-tts-voice-screen-v${screenVersionLabel}`,
    episodeId,
    generatedAt,
    direction: LOCAL_TTS_DIRECTION,
    candidateText: LOCAL_TTS_CANDIDATE_TEXT,
    defaultVoice: LOCAL_TTS_DEFAULT_VOICE,
    model,
    generation: commonGeneration,
    elapsedSeconds: result.elapsedSeconds,
    candidates: candidateFiles,
    usage: "本地男声横向试听；未写入 Episode，未替换已审批旁白"
  };
  await writeFile(
    resolve(screenDirectory, "manifest.json"),
    `${JSON.stringify(candidateManifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" }
  );
  const finalProofData = await readFile(proofPath);
  const proofManifest = {
    schemaVersion: 1,
    id: `agent-skill-local-tts-proof-v${proofVersionLabel}`,
    episodeId,
    generatedAt,
    direction: LOCAL_TTS_DIRECTION,
    voice: LOCAL_TTS_DEFAULT_VOICE,
    model,
    durationSeconds: proofDurationSeconds,
    sampleRate: LOCAL_TTS_SAMPLE_RATE,
    channels: 1,
    outputPath: relativeToWorkspace(proofPath),
    bytes: finalProofData.length,
    sha256: createHash("sha256").update(finalProofData).digest("hex"),
    segments: result.proof.segments,
    generation: commonGeneration,
    usage: "仅用于 60 秒本地开源声音方向人工试听；未写入 Episode，未替换已审批旁白"
  };
  await writeFile(proofManifestPath, `${JSON.stringify(proofManifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx"
  });
  console.log(JSON.stringify({
    proof: proofManifest,
    voiceScreen: {
      manifestPath: relativeToWorkspace(resolve(screenDirectory, "manifest.json")),
      candidates: candidateFiles
    },
    generatorStderr: execution.stderr.trim() || null
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
  await rm(temporaryProofPath, { force: true }).catch(() => undefined);
  await rm(temporaryScreenDirectory, { recursive: true, force: true }).catch(() => undefined);
}
