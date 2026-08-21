import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { resolve } from "node:path";

import {
  LOCAL_OFFLINE_TTS_V002_REGISTRATION,
  inspectRegisteredLocalOfflineTtsRebindCandidate
} from "../src/server/production/local-offline-voice.mjs";
import { workspaceRoot } from "../src/shared/paths.mjs";

const episodeId = LOCAL_OFFLINE_TTS_V002_REGISTRATION.episodeId;
const versionLabel = "voice-v001-storyboard-v004-asset-v013-rebind-v001";
const outputRoot = resolve(
  workspaceRoot,
  "outputs",
  "studio",
  episodeId,
  "voice-rebind-candidates"
);
const outputDirectory = resolve(outputRoot, versionLabel);
const stagingDirectory = resolve(outputRoot, `.${versionLabel}.rendering`);

const sourceFiles = Object.freeze({
  episode: resolve(
    workspaceRoot,
    "studio",
    "data",
    "episodes",
    episodeId,
    "episode.json"
  ),
  sourceManifest: resolve(
    workspaceRoot,
    "outputs",
    "studio",
    episodeId,
    LOCAL_OFFLINE_TTS_V002_REGISTRATION.manifestFileName
  ),
  sourceWav: resolve(
    workspaceRoot,
    "outputs",
    "studio",
    episodeId,
    LOCAL_OFFLINE_TTS_V002_REGISTRATION.wavFileName
  ),
  registeredWav: resolve(
    workspaceRoot,
    "studio",
    "public",
    "episodes",
    episodeId,
    "voice-v001.wav"
  ),
  priorReviewManifest: resolve(
    workspaceRoot,
    "outputs",
    "studio",
    episodeId,
    "review-candidates",
    "storyboard-v004-transition-review-v001",
    "review-manifest.json"
  ),
  priorReviewVideo: resolve(
    workspaceRoot,
    "outputs",
    "studio",
    episodeId,
    "review-candidates",
    "storyboard-v004-transition-review-v001",
    "review-60s.mp4"
  )
});

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function snapshotFiles() {
  return Object.fromEntries(await Promise.all(Object.entries(sourceFiles).map(
    async ([name, path]) => {
      const data = await readFile(path);
      return [name, { path, bytes: data.length, sha256: sha256(data) }];
    }
  )));
}

function assertSnapshotsEqual(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("只读候选生成期间 live Episode 或历史旁白证据发生变化");
  }
}

function dossierMarkdown(result) {
  const comparison = result.dossier.comparison;
  const delta = comparison.subtitleDelta.scenes[0];
  const sync = comparison.syncCaveat;
  const checks = result.machineVerification.checks
    .map((check) => `- ${check.passed ? "通过" : "失败"}：${check.label}`)
    .join("\n");
  const before = delta.before
    .map((item) => `  - ${item.start.toFixed(3)}–${item.end.toFixed(3)}s：${item.text}`)
    .join("\n");
  const after = delta.after
    .map((item) => `  - ${item.start.toFixed(3)}–${item.end.toFixed(3)}s：${item.text}`)
    .join("\n");
  return `# voice-v001 零调用重绑定审批单

状态：仅供人工审核，尚未批准、尚未登记。

## 要批准的对象

- 保留不可变生成来源：Storyboard v3 + Asset v9 + 原 v002 manifest/WAV。
- 建议新增当前使用范围：已批准的 Storyboard v4 + Asset v13。
- WAV 不重新生成、不改字节；旁白全文、九镜时间和语音分段均不变。
- 候选哈希：\`${result.candidateHash}\`
- 机器验证 ID：\`${result.machineVerificationId}\`
- 机器验证哈希：\`${result.machineVerification.verificationHash}\`
- 当前使用绑定哈希：\`${result.humanDecisionBinding.currentUseBindingHash}\`

## 唯一内容变化：S03 字幕断句

原 Storyboard v3：

${before}

当前 Storyboard v4：

${after}

字幕边界由 ${sync.sourceSubtitleBoundarySecond.toFixed(3)}s 改为 ${sync.currentSubtitleBoundarySecond.toFixed(3)}s，后移 ${sync.sourceToCurrentBoundaryShiftSeconds.toFixed(3)}s。

## 必须知道的同步风险

- 严格逐词/逐音同步状态：**未验证**。
- 按本地合成渲染方案，S03 第二句约在 ${sync.audioSecondPhraseStartsAtSecond.toFixed(3)}s 开始。
- 当前字幕在 ${sync.currentSubtitleBoundarySecond.toFixed(3)}s 才切换，相差 ${sync.audioToCurrentSubtitleBoundaryDeltaSeconds.toFixed(3)}s。
- 因此只能确认 WAV、逐字旁白和九镜语音方案未变，不能声称字幕已与每个词精确同步。

## 试听与既有审阅证据

- 正式已登记音频：\`${result.dossier.playablePreview.path}\`
- WAV：${result.dossier.playablePreview.bytes} bytes，SHA-256 \`${result.dossier.playablePreview.sha256}\`，60 秒。
- 之前观看的 Storyboard v4 审阅视频使用同一 WAV；视频 SHA-256 \`${result.dossier.priorReviewEvidence.media.sha256}\`。

## 机器检查

${checks}

## API、工具和费用

- 外部 API：0
- 外部推理：0
- 网络调用：0
- 最高付费：USD 0
- 本次只生成本地审批材料，不运行 Voice / Render / QA Agent。

## 批准后也不会自动发生的事

- 当前没有登记实现，批准本候选本身不会写入 Episode。
- 不会自动通过素材总审、最终审核或发布。
- 后续若实现登记，仍须对本审批单的候选、机器验证、WAV 和当前绑定做精确哈希校验。
`;
}

async function writeAtomic(path, data) {
  await writeFile(`${path}.tmp`, data, { flag: "wx" });
  await rename(`${path}.tmp`, path);
}

await mkdir(outputRoot, { recursive: true });
await rm(stagingDirectory, { recursive: true, force: true });
await access(outputDirectory).then(
  () => {
    throw new Error(`候选目录已存在，禁止覆盖：${outputDirectory}`);
  },
  () => undefined
);

const before = await snapshotFiles();
const inspection = await inspectRegisteredLocalOfflineTtsRebindCandidate(episodeId);
const artifact = {
  schemaVersion: "local-offline-tts-rebind-review-artifact-v1",
  generatedAt: new Date().toISOString(),
  status: "human-review-candidate",
  episodeId,
  candidateId: inspection.candidateId,
  candidateHash: inspection.candidateHash,
  machineVerification: inspection.machineVerification,
  humanDecisionBinding: inspection.humanDecisionBinding,
  humanApproval: null,
  normalizedCandidate: inspection.normalizedCandidate,
  dossier: inspection.dossier,
  registrationRequestPreview: inspection.registrationRequest,
  registrationImplemented: false,
  liveStateModified: false
};

try {
  await mkdir(stagingDirectory);
  const candidatePath = resolve(stagingDirectory, "candidate.json");
  const dossierPath = resolve(stagingDirectory, "approval-dossier.md");
  const candidateData = `${JSON.stringify(artifact, null, 2)}\n`;
  const dossierData = dossierMarkdown(inspection);
  await writeAtomic(candidatePath, candidateData);
  await writeAtomic(dossierPath, dossierData);

  const after = await snapshotFiles();
  assertSnapshotsEqual(before, after);
  const repeated = await inspectRegisteredLocalOfflineTtsRebindCandidate(episodeId);
  if (
    repeated.candidateHash !== inspection.candidateHash
    || repeated.machineVerificationId !== inspection.machineVerificationId
    || repeated.machineVerification.verificationHash
      !== inspection.machineVerification.verificationHash
  ) {
    throw new Error("候选复算哈希发生变化");
  }

  const candidateBytes = await readFile(candidatePath);
  const dossierBytes = await readFile(dossierPath);
  const manifest = {
    schemaVersion: "local-offline-tts-rebind-review-manifest-v1",
    generatedAt: artifact.generatedAt,
    episodeId,
    candidateId: inspection.candidateId,
    candidateHash: inspection.candidateHash,
    machineVerificationId: inspection.machineVerificationId,
    machineVerificationHash: inspection.machineVerification.verificationHash,
    humanApproval: null,
    registrationImplemented: false,
    liveStateModified: false,
    artifacts: {
      candidate: {
        path: "candidate.json",
        bytes: candidateBytes.length,
        sha256: sha256(candidateBytes)
      },
      dossier: {
        path: "approval-dossier.md",
        bytes: dossierBytes.length,
        sha256: sha256(dossierBytes)
      }
    },
    protectedSourceSnapshots: before
  };
  const manifestPath = resolve(stagingDirectory, "artifact-manifest.json");
  const manifestData = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeAtomic(manifestPath, manifestData);
  const hashes = [
    `${manifest.artifacts.candidate.sha256}  candidate.json`,
    `${manifest.artifacts.dossier.sha256}  approval-dossier.md`,
    `${sha256(Buffer.from(manifestData))}  artifact-manifest.json`
  ].join("\n");
  await writeAtomic(resolve(stagingDirectory, "artifacts.sha256"), `${hashes}\n`);
  assertSnapshotsEqual(before, await snapshotFiles());
  await rename(stagingDirectory, outputDirectory);
  console.log(JSON.stringify({
    outputDirectory,
    candidateHash: inspection.candidateHash,
    machineVerificationId: inspection.machineVerificationId,
    machineVerificationHash: inspection.machineVerification.verificationHash,
    candidateArtifactSha256: manifest.artifacts.candidate.sha256,
    dossierSha256: manifest.artifacts.dossier.sha256,
    registrationImplemented: false,
    liveStateModified: false
  }, null, 2));
} catch (error) {
  await rm(stagingDirectory, { recursive: true, force: true });
  throw error;
}
