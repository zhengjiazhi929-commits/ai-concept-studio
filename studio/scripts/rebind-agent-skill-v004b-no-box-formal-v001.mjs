import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {lstat, mkdir, readFile, realpath} from "node:fs/promises";
import {basename, dirname, relative, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {promisify} from "node:util";

import {
  V004B_FINAL_CANDIDATE_IDENTITY,
  V004B_FINAL_CONTRACT,
  V004B_FINAL_PATHS,
  V004B_FINAL_SCHEMA_VERSION,
  decodeAudio,
  decodeVideo,
  evaluateFinalProbe,
  inspectFile,
  probeMedia,
  publishFinalCandidateAtomically,
  resolveMediaTool,
  sha256Text,
  stableStringify,
} from "./build-agent-skill-v004b-no-box-final.mjs";
import {acquireLongReviewRenderJobLock} from
  "../src/server/production/long-render-job.mjs";


const execFileAsync = promisify(execFile);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const REVIEW_CANDIDATES_DIRECTORY = resolve(
  WORKSPACE_ROOT,
  "outputs/studio/agent-skill-20260806/review-candidates",
);
const SOURCE_CANDIDATE_NAME =
  "full-video-current-visual-upgrade-v014-natural-technical-v004b-no-box-v001";
const SOURCE_JOB_ID =
  "agent-skill-20260806-current-visual-upgrade-v014-v004b-no-box-v001";
const SOURCE_MISTAGGED_CANDIDATE_VERSION = 14;
const RENDER_BASE_JOB_ID =
  "agent-skill-20260806-current-visual-upgrade-render-base-v014";
const VIDEO_FILE_NAME = "review-10m.mp4";
const MANIFEST_FILE_NAME = "review-manifest.json";
const RECEIPT_FILE_NAME = "publication-durable-receipt.json";
const REBIND_SCHEMA_VERSION =
  "agent-skill-v004b-no-box-formal-candidate-rebind-v1";

export const V004B_FORMAL_REBIND_PATHS = Object.freeze({
  sourceDirectory: resolve(REVIEW_CANDIDATES_DIRECTORY, SOURCE_CANDIDATE_NAME),
  sourceVideo: resolve(
    REVIEW_CANDIDATES_DIRECTORY,
    SOURCE_CANDIDATE_NAME,
    VIDEO_FILE_NAME,
  ),
  sourceManifest: resolve(
    REVIEW_CANDIDATES_DIRECTORY,
    SOURCE_CANDIDATE_NAME,
    MANIFEST_FILE_NAME,
  ),
  sourceReceipt: resolve(
    REVIEW_CANDIDATES_DIRECTORY,
    SOURCE_CANDIDATE_NAME,
    RECEIPT_FILE_NAME,
  ),
  outputDirectory: V004B_FINAL_PATHS.outputDirectory,
  outputVideo: resolve(V004B_FINAL_PATHS.outputDirectory, VIDEO_FILE_NAME),
  workDirectory: V004B_FINAL_PATHS.workDirectory,
});


function assertHash(value, label) {
  if (!HASH_PATTERN.test(value ?? "")) {
    throw new Error(`${label} 必须是 64 位小写 SHA-256`);
  }
  return value;
}


function hasExactKeys(value, keys) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      stableStringify(Object.keys(value).sort()) ===
        stableStringify([...keys].sort()),
  );
}


function exactPath(value, expected) {
  return typeof value === "string" && resolve(value) === resolve(expected);
}


function assertDirectChild(parent, candidate, expectedName, label) {
  const resolvedParent = resolve(parent);
  const resolvedCandidate = resolve(candidate);
  if (
    dirname(resolvedCandidate) !== resolvedParent ||
    basename(resolvedCandidate) !== expectedName
  ) {
    throw new Error(`${label} 必须是固定 review-candidates 直接子目录`);
  }
  return resolvedCandidate;
}


async function assertNoSymlinkComponentsInside(parent, candidate, label) {
  const resolvedParent = resolve(parent);
  const resolvedCandidate = resolve(candidate);
  const traversal = relative(resolvedParent, resolvedCandidate);
  if (traversal.startsWith(`..${sep}`) || traversal === "..") {
    throw new Error(`${label} 越出 review-candidates`);
  }
  let current = resolvedParent;
  const rootStat = await lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("review-candidates 根目录必须是普通目录且不能是符号链接");
  }
  for (const segment of traversal.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} 路径组件不能是符号链接：${current}`);
    }
  }
  return resolvedCandidate;
}


function samePlainFileIdentity(before, after) {
  return (
    before.isFile() &&
    after.isFile() &&
    !before.isSymbolicLink() &&
    !after.isSymbolicLink() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}


async function readJsonSnapshot(path, label) {
  const before = await lstat(path, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${label} 必须是普通文件且不能是符号链接`);
  }
  const contents = await readFile(path);
  const after = await lstat(path, {bigint: true});
  if (!samePlainFileIdentity(before, after) || BigInt(contents.length) !== after.size) {
    throw new Error(`${label} 在读取期间发生漂移`);
  }
  let value;
  try {
    value = JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON`, {cause: error});
  }
  return {
    value,
    integrity: {
      bytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
    },
  };
}


function publicationJobBinding(manifest) {
  return {
    finalManifestSchemaVersion: manifest?.schemaVersion ?? null,
    runFingerprint: manifest?.runFingerprint ?? null,
    jobId: manifest?.renderJob?.jobId ?? null,
    candidateVersion: manifest?.renderJob?.candidateVersion ?? null,
    episodeId: manifest?.contract?.episodeId ?? null,
    compositionId: manifest?.contract?.compositionId ?? null,
  };
}


function strictChunkBinding(chunks, runFingerprint) {
  if (!Array.isArray(chunks) || chunks.length !== V004B_FINAL_CONTRACT.chunkCount) {
    return false;
  }
  return chunks.every((chunk, index) => {
    const startFrame = index * V004B_FINAL_CONTRACT.chunkFrames;
    return (
      chunk?.schemaVersion === "agent-skill-v004b-no-box-overlay-chunk-v1" &&
      chunk?.runFingerprint === runFingerprint &&
      stableStringify(chunk?.range) ===
        stableStringify({
          index,
          startFrame,
          endFrameExclusive: startFrame + V004B_FINAL_CONTRACT.chunkFrames,
          endFrameInclusive:
            startFrame + V004B_FINAL_CONTRACT.chunkFrames - 1,
          frameCount: V004B_FINAL_CONTRACT.chunkFrames,
        }) &&
      Number.isSafeInteger(chunk?.file?.bytes) &&
      chunk.file.bytes > 0 &&
      HASH_PATTERN.test(chunk?.file?.sha256 ?? "") &&
      chunk?.decoding?.videoDecodedWithoutError === true
    );
  });
}


export function validateSourceCandidateBinding({
  manifest,
  receipt,
  videoIntegrity,
  manifestIntegrity,
  receiptIntegrity,
  expectedVideoSha256,
  expectedManifestSha256,
  expectedReceiptSha256,
  sourceVideoPath = V004B_FORMAL_REBIND_PATHS.sourceVideo,
}) {
  for (const [value, label] of [
    [expectedVideoSha256, "expected source video SHA"],
    [expectedManifestSha256, "expected source manifest SHA"],
    [expectedReceiptSha256, "expected source receipt SHA"],
  ]) {
    assertHash(value, label);
  }
  const published = manifest?.finalMedia?.published;
  const renderBase = manifest?.renderBase;
  const expectedBinding = publicationJobBinding(manifest);
  const checks = {
    expectedVideoBytes:
      Number.isSafeInteger(videoIntegrity?.bytes) && videoIntegrity.bytes > 0,
    expectedVideoSha: videoIntegrity?.sha256 === expectedVideoSha256,
    expectedManifestSha: manifestIntegrity?.sha256 === expectedManifestSha256,
    expectedReceiptSha: receiptIntegrity?.sha256 === expectedReceiptSha256,
    manifestSchema: manifest?.schemaVersion === V004B_FINAL_SCHEMA_VERSION,
    sourceStatus:
      manifest?.status === "machine-validated-awaiting-visual-qa" &&
      manifest?.reviewStatus ===
        "formal-candidate-awaiting-continuous-1x-visual-qa",
    sourceMistagIsExact:
      manifest?.renderJob?.jobId === SOURCE_JOB_ID &&
      manifest?.renderJob?.candidateVersion === SOURCE_MISTAGGED_CANDIDATE_VERSION,
    renderFingerprint: HASH_PATTERN.test(manifest?.runFingerprint ?? ""),
    mediaContract:
      manifest?.contract?.width === V004B_FINAL_CONTRACT.width &&
      manifest?.contract?.height === V004B_FINAL_CONTRACT.height &&
      manifest?.contract?.fps === V004B_FINAL_CONTRACT.fps &&
      manifest?.contract?.durationInFrames ===
        V004B_FINAL_CONTRACT.durationInFrames &&
      manifest?.contract?.durationSeconds ===
        V004B_FINAL_CONTRACT.durationSeconds &&
      manifest?.contract?.artifactRole === "formal-candidate" &&
      manifest?.contract?.formalCandidate === true,
    v004bContract:
      manifest?.contract?.visualSource ===
        "v013@980c4f4be9c1f0bccdcd546873fa1a877c98aac8" &&
      manifest?.contract?.subtitleStyle === "v004b-no-box" &&
      manifest?.contract?.subtitleDelivery === "external-overlay-applied" &&
      manifest?.contract?.burnInSubtitle === false &&
      manifest?.contract?.voice === "v004-full" &&
      manifest?.contract?.voiceIsTemporary === true &&
      manifest?.contract?.finalHumanRecording === false,
    chunksBound: strictChunkBinding(manifest?.chunks, manifest?.runFingerprint),
    renderBaseProvenance:
      renderBase?.artifactRole === "render-base" &&
      renderBase?.formalCandidate === false &&
      renderBase?.subtitleDelivery === "external-overlay-required" &&
      HASH_PATTERN.test(renderBase?.sha256 ?? "") &&
      HASH_PATTERN.test(renderBase?.manifestSha256 ?? "") &&
      HASH_PATTERN.test(renderBase?.durableReceiptSha256 ?? ""),
    finalMediaSchema:
      manifest?.finalMedia?.schemaVersion ===
        "agent-skill-v004b-no-box-final-media-v1",
    validatedMediaBytes:
      manifest?.finalMedia?.file?.bytes === videoIntegrity?.bytes &&
      manifest?.finalMedia?.file?.sha256 === videoIntegrity?.sha256,
    publishedMediaBytes:
      published?.bytes === videoIntegrity?.bytes &&
      published?.sha256 === videoIntegrity?.sha256,
    publishedPath: exactPath(published?.path, sourceVideoPath),
    decodeEvidence:
      manifest?.finalMedia?.decoding?.videoDecodedWithoutError === true &&
      manifest?.finalMedia?.decoding?.audioDecodedWithoutError === true,
    publication:
      manifest?.publication?.atomicDirectoryRename === true &&
      manifest?.publication?.nonOverwriting === true &&
      exactPath(manifest?.publication?.outputPath, sourceVideoPath),
    receiptShape: hasExactKeys(receipt, [
      "schemaVersion",
      "kind",
      "attemptToken",
      "output",
      "manifest",
      "jobBinding",
      "jobBindingSha256",
      "recordedAt",
    ]),
    receiptSchema:
      receipt?.schemaVersion ===
        "agent-skill-v004b-no-box-publication-state-v1",
    receiptKind: receipt?.kind === "durable_receipt",
    receiptAttemptToken: UUID_PATTERN.test(receipt?.attemptToken ?? ""),
    receiptOutput:
      receipt?.output?.fileName === VIDEO_FILE_NAME &&
      receipt?.output?.bytes === videoIntegrity?.bytes &&
      receipt?.output?.sha256 === videoIntegrity?.sha256,
    receiptManifest:
      receipt?.manifest?.fileName === MANIFEST_FILE_NAME &&
      receipt?.manifest?.sha256 === manifestIntegrity?.sha256,
    receiptJobBinding:
      stableStringify(receipt?.jobBinding) === stableStringify(expectedBinding),
    receiptJobBindingSha:
      receipt?.jobBindingSha256 ===
      sha256Text(stableStringify(expectedBinding)),
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    const error = new Error(`源候选绑定验证失败：${failed.join(", ")}`);
    error.code = "v004b_source_candidate_binding_invalid";
    error.failedChecks = failed;
    throw error;
  }
  return {passed: true, checks, sourceJobBinding: expectedBinding};
}


export function buildReboundFormalManifest({
  sourceManifest,
  sourceVideoIntegrity,
  sourceManifestIntegrity,
  sourceReceiptIntegrity,
  rebinderIntegrity,
  publishedVideoPath = V004B_FORMAL_REBIND_PATHS.outputVideo,
  verification,
  completedAt = new Date().toISOString(),
}) {
  const rebound = structuredClone(sourceManifest);
  rebound.completedAt = completedAt;
  rebound.renderJob = {
    jobId: V004B_FINAL_CANDIDATE_IDENTITY.jobId,
    candidateVersion: V004B_FINAL_CANDIDATE_IDENTITY.candidateVersion,
  };
  rebound.renderBase = {
    ...rebound.renderBase,
    jobId: RENDER_BASE_JOB_ID,
    candidateVersion:
      V004B_FINAL_CANDIDATE_IDENTITY.renderBaseCandidateVersion,
  };
  rebound.finalMedia = {
    ...rebound.finalMedia,
    file: {path: publishedVideoPath, ...sourceVideoIntegrity},
    probeSha256: verification.probeSha256,
    decoding: {
      videoDecodedWithoutError: true,
      audioDecodedWithoutError: true,
      videoMode: "sequential-rawvideo-null",
      audioMode: "sequential-pcm-s16le-null",
    },
    validatedAt: verification.validatedAt,
    published: {path: publishedVideoPath, ...sourceVideoIntegrity},
  };
  rebound.publication = {
    ...rebound.publication,
    outputPath: publishedVideoPath,
  };
  rebound.republication = {
    schemaVersion: REBIND_SCHEMA_VERSION,
    method: "byte-identical-copy-no-reencode",
    sourceArtifact: {
      directory: V004B_FORMAL_REBIND_PATHS.sourceDirectory,
      video: {
        path: V004B_FORMAL_REBIND_PATHS.sourceVideo,
        ...sourceVideoIntegrity,
      },
      manifest: {
        path: V004B_FORMAL_REBIND_PATHS.sourceManifest,
        ...sourceManifestIntegrity,
      },
      durableReceipt: {
        path: V004B_FORMAL_REBIND_PATHS.sourceReceipt,
        ...sourceReceiptIntegrity,
      },
    },
    versionBinding: {
      sourceMistaggedCandidateVersion: SOURCE_MISTAGGED_CANDIDATE_VERSION,
      formalCandidateVersion: V004B_FINAL_CANDIDATE_IDENTITY.candidateVersion,
      renderBaseCandidateVersion:
        V004B_FINAL_CANDIDATE_IDENTITY.renderBaseCandidateVersion,
      formalJobId: V004B_FINAL_CANDIDATE_IDENTITY.jobId,
    },
    verification: structuredClone(verification),
    rebinder: {path: SCRIPT_PATH, ...rebinderIntegrity},
    sourceCandidatePreserved: true,
    mediaReencoded: false,
  };
  rebound.prohibitions = {
    ...rebound.prohibitions,
    oldOutputsOverwritten: false,
    sourceCandidateModified: false,
    sourceCandidateDeleted: false,
    videoReencoded: false,
  };
  return rebound;
}


export function validateReboundFormalManifest({
  manifest,
  sourceManifest,
  sourceVideoIntegrity,
  sourceManifestIntegrity,
  sourceReceiptIntegrity,
  publishedVideoPath = V004B_FORMAL_REBIND_PATHS.outputVideo,
}) {
  const provenance = manifest?.republication?.sourceArtifact;
  const checks = {
    schema: manifest?.schemaVersion === V004B_FINAL_SCHEMA_VERSION,
    sameRunFingerprint:
      manifest?.runFingerprint === sourceManifest?.runFingerprint &&
      HASH_PATTERN.test(manifest?.runFingerprint ?? ""),
    sameChunks:
      stableStringify(manifest?.chunks) === stableStringify(sourceManifest?.chunks),
    formalIdentity:
      manifest?.renderJob?.jobId === V004B_FINAL_CANDIDATE_IDENTITY.jobId &&
      manifest?.renderJob?.candidateVersion ===
        V004B_FINAL_CANDIDATE_IDENTITY.candidateVersion,
    renderBaseIdentity:
      manifest?.renderBase?.jobId === RENDER_BASE_JOB_ID &&
      manifest?.renderBase?.candidateVersion ===
        V004B_FINAL_CANDIDATE_IDENTITY.renderBaseCandidateVersion &&
      HASH_PATTERN.test(manifest?.renderBase?.sha256 ?? "") &&
      HASH_PATTERN.test(manifest?.renderBase?.manifestSha256 ?? "") &&
      HASH_PATTERN.test(manifest?.renderBase?.durableReceiptSha256 ?? ""),
    targetFile:
      exactPath(manifest?.finalMedia?.file?.path, publishedVideoPath) &&
      manifest?.finalMedia?.file?.bytes === sourceVideoIntegrity?.bytes &&
      manifest?.finalMedia?.file?.sha256 === sourceVideoIntegrity?.sha256,
    targetPublished:
      exactPath(manifest?.finalMedia?.published?.path, publishedVideoPath) &&
      manifest?.finalMedia?.published?.bytes === sourceVideoIntegrity?.bytes &&
      manifest?.finalMedia?.published?.sha256 === sourceVideoIntegrity?.sha256,
    targetPublication:
      exactPath(manifest?.publication?.outputPath, publishedVideoPath) &&
      manifest?.publication?.atomicDirectoryRename === true &&
      manifest?.publication?.nonOverwriting === true,
    sourceVideoProvenance:
      exactPath(provenance?.video?.path, V004B_FORMAL_REBIND_PATHS.sourceVideo) &&
      provenance?.video?.bytes === sourceVideoIntegrity?.bytes &&
      provenance?.video?.sha256 === sourceVideoIntegrity?.sha256,
    sourceManifestProvenance:
      exactPath(
        provenance?.manifest?.path,
        V004B_FORMAL_REBIND_PATHS.sourceManifest,
      ) &&
      provenance?.manifest?.bytes === sourceManifestIntegrity?.bytes &&
      provenance?.manifest?.sha256 === sourceManifestIntegrity?.sha256,
    sourceReceiptProvenance:
      exactPath(
        provenance?.durableReceipt?.path,
        V004B_FORMAL_REBIND_PATHS.sourceReceipt,
      ) &&
      provenance?.durableReceipt?.bytes === sourceReceiptIntegrity?.bytes &&
      provenance?.durableReceipt?.sha256 === sourceReceiptIntegrity?.sha256,
    noReencode:
      manifest?.republication?.method === "byte-identical-copy-no-reencode" &&
      manifest?.republication?.mediaReencoded === false &&
      manifest?.republication?.sourceCandidatePreserved === true,
    freshDecodeEvidence:
      manifest?.republication?.verification?.fullDecode
        ?.videoDecodedWithoutError === true &&
      manifest?.republication?.verification?.fullDecode
        ?.audioDecodedWithoutError === true,
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`新正式候选 manifest 重绑定失败：${failed.join(", ")}`);
  }
  return {passed: true, checks};
}


export function validateReboundPublicationBinding({
  manifest,
  receipt,
  videoIntegrity,
  manifestIntegrity,
  expectedManifest,
  sourceManifest,
  sourceVideoIntegrity,
  sourceManifestIntegrity,
  sourceReceiptIntegrity,
  publishedVideoPath = V004B_FORMAL_REBIND_PATHS.outputVideo,
}) {
  validateReboundFormalManifest({
    manifest,
    sourceManifest,
    sourceVideoIntegrity,
    sourceManifestIntegrity,
    sourceReceiptIntegrity,
    publishedVideoPath,
  });
  const expectedBinding = publicationJobBinding(manifest);
  const checks = {
    exactManifestBytes:
      stableStringify(manifest) === stableStringify(expectedManifest),
    copiedVideoBytes:
      videoIntegrity?.bytes === sourceVideoIntegrity?.bytes &&
      videoIntegrity?.sha256 === sourceVideoIntegrity?.sha256,
    receiptShape: hasExactKeys(receipt, [
      "schemaVersion",
      "kind",
      "attemptToken",
      "output",
      "manifest",
      "jobBinding",
      "jobBindingSha256",
      "recordedAt",
    ]),
    receiptSchema:
      receipt?.schemaVersion ===
        "agent-skill-v004b-no-box-publication-state-v1",
    receiptKind: receipt?.kind === "durable_receipt",
    receiptAttemptToken: UUID_PATTERN.test(receipt?.attemptToken ?? ""),
    receiptOutput:
      receipt?.output?.fileName === VIDEO_FILE_NAME &&
      receipt?.output?.bytes === videoIntegrity?.bytes &&
      receipt?.output?.sha256 === videoIntegrity?.sha256,
    receiptManifest:
      receipt?.manifest?.fileName === MANIFEST_FILE_NAME &&
      receipt?.manifest?.sha256 === manifestIntegrity?.sha256,
    receiptJobBinding:
      stableStringify(receipt?.jobBinding) === stableStringify(expectedBinding),
    receiptJobBindingSha:
      receipt?.jobBindingSha256 ===
      sha256Text(stableStringify(expectedBinding)),
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`新正式候选 durable publication 绑定失败：${failed.join(", ")}`);
  }
  return {passed: true, checks, jobBinding: expectedBinding};
}


function takeArgumentValue(argumentsList, index, name) {
  const argument = argumentsList[index];
  if (argument === name) {
    if (index + 1 >= argumentsList.length) throw new Error(`${name} 缺少值`);
    return {value: argumentsList[index + 1], nextIndex: index + 1};
  }
  if (argument.startsWith(`${name}=`)) {
    return {value: argument.slice(name.length + 1), nextIndex: index};
  }
  return null;
}


export function parseRebindCliArguments(argumentsList) {
  const options = {ffmpeg: null, ffprobe: null, dryRun: false, help: false};
  const stringOptions = new Map([
    ["--expected-source-video-sha256", "expectedSourceVideoSha256"],
    ["--expected-source-manifest-sha256", "expectedSourceManifestSha256"],
    ["--expected-source-receipt-sha256", "expectedSourceReceiptSha256"],
    ["--ffmpeg", "ffmpeg"],
    ["--ffprobe", "ffprobe"],
  ]);
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    let matched = false;
    for (const [name, key] of stringOptions) {
      const taken = takeArgumentValue(argumentsList, index, name);
      if (!taken) continue;
      options[key] = taken.value;
      index = taken.nextIndex;
      matched = true;
      break;
    }
    if (!matched) throw new Error(`未知参数：${argument}`);
  }
  return options;
}


function requireRebindOptions(options) {
  for (const key of [
    "expectedSourceVideoSha256",
    "expectedSourceManifestSha256",
    "expectedSourceReceiptSha256",
  ]) {
    assertHash(options[key], key);
  }
}


export function rebindUsageText() {
  return [
    "Usage: node rebind-agent-skill-v004b-no-box-formal-v001.mjs \\",
    "  --expected-source-video-sha256 <sha256> \\",
    "  --expected-source-manifest-sha256 <sha256> \\",
    "  --expected-source-receipt-sha256 <sha256> \\",
    "  --ffmpeg <full-system-ffmpeg> --ffprobe <matching-ffprobe>",
    "",
    `Frozen source: ${V004B_FORMAL_REBIND_PATHS.sourceDirectory}`,
    `New non-overwriting output: ${V004B_FORMAL_REBIND_PATHS.outputDirectory}`,
    "This path re-probes and fully decodes the source, then performs a byte-identical copy; it never re-encodes video.",
    "Run through /usr/sbin/taskpolicy -b /usr/bin/nice -n 20.",
  ].join("\n");
}


async function toolVersion(tool) {
  const {stdout, stderr} = await execFileAsync(tool.path, ["-version"], {
    cwd: tool.directory,
    env: {
      ...process.env,
      PATH: "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
      ...(process.platform === "darwin"
        ? {DYLD_LIBRARY_PATH: tool.directory}
        : {}),
    },
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  return `${stdout}${stderr}`.split(/\r?\n/u)[0];
}


async function inspectSourceCandidate(options) {
  await assertNoSymlinkComponentsInside(
    REVIEW_CANDIDATES_DIRECTORY,
    V004B_FORMAL_REBIND_PATHS.sourceDirectory,
    "source candidate",
  );
  const [videoIntegrity, manifestSnapshot, receiptSnapshot] = await Promise.all([
    inspectFile(V004B_FORMAL_REBIND_PATHS.sourceVideo),
    readJsonSnapshot(V004B_FORMAL_REBIND_PATHS.sourceManifest, "source manifest"),
    readJsonSnapshot(V004B_FORMAL_REBIND_PATHS.sourceReceipt, "source receipt"),
  ]);
  const binding = validateSourceCandidateBinding({
    manifest: manifestSnapshot.value,
    receipt: receiptSnapshot.value,
    videoIntegrity,
    manifestIntegrity: manifestSnapshot.integrity,
    receiptIntegrity: receiptSnapshot.integrity,
    expectedVideoSha256: options.expectedSourceVideoSha256,
    expectedManifestSha256: options.expectedSourceManifestSha256,
    expectedReceiptSha256: options.expectedSourceReceiptSha256,
  });
  return {videoIntegrity, manifestSnapshot, receiptSnapshot, binding};
}


async function assertOutputLayoutAvailable() {
  assertDirectChild(
    REVIEW_CANDIDATES_DIRECTORY,
    V004B_FORMAL_REBIND_PATHS.outputDirectory,
    V004B_FINAL_CANDIDATE_IDENTITY.directoryName,
    "formal output directory",
  );
  const parent = await realpath(REVIEW_CANDIDATES_DIRECTORY);
  if (parent !== REVIEW_CANDIDATES_DIRECTORY) {
    throw new Error("review-candidates 根目录不能经符号链接解析到其他位置");
  }
  try {
    await lstat(V004B_FORMAL_REBIND_PATHS.outputDirectory);
    throw new Error(
      `新正式候选目录已存在，拒绝覆盖：${V004B_FORMAL_REBIND_PATHS.outputDirectory}`,
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}


export async function rebindAgentSkillV004bFormalCandidate(options) {
  requireRebindOptions(options);
  await assertOutputLayoutAvailable();
  const source = await inspectSourceCandidate(options);
  const [ffmpeg, ffprobe] = await Promise.all([
    resolveMediaTool("ffmpeg", options.ffmpeg),
    resolveMediaTool("ffprobe", options.ffprobe),
  ]);
  const [ffmpegVersion, ffprobeVersion] = await Promise.all([
    toolVersion(ffmpeg),
    toolVersion(ffprobe),
  ]);
  const rawProbe = await probeMedia(ffprobe, V004B_FORMAL_REBIND_PATHS.sourceVideo);
  const probeValidation = evaluateFinalProbe(
    rawProbe,
    source.manifestSnapshot.value?.finalMedia?.codecMetadata ?? null,
  );
  if (!probeValidation.valid) {
    const failed = Object.entries(probeValidation.checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    throw new Error(`源候选重新 ffprobe 失败：${failed.join(", ")}`);
  }
  await decodeVideo(ffmpeg, V004B_FORMAL_REBIND_PATHS.sourceVideo);
  await decodeAudio(ffmpeg, V004B_FORMAL_REBIND_PATHS.sourceVideo);

  const afterDecode = await inspectSourceCandidate(options);
  if (
    stableStringify(afterDecode.videoIntegrity) !==
      stableStringify(source.videoIntegrity) ||
    stableStringify(afterDecode.manifestSnapshot.integrity) !==
      stableStringify(source.manifestSnapshot.integrity) ||
    stableStringify(afterDecode.receiptSnapshot.integrity) !==
      stableStringify(source.receiptSnapshot.integrity)
  ) {
    throw new Error("源候选在重新 probe/decode 期间发生漂移");
  }
  const rebinderIntegrity = await inspectFile(SCRIPT_PATH);
  const validatedAt = new Date().toISOString();
  const verification = {
    validatedAt,
    ffprobe: {
      path: ffprobe.path,
      version: ffprobeVersion,
      checks: probeValidation.checks,
    },
    ffmpeg: {path: ffmpeg.path, version: ffmpegVersion},
    probeSha256: sha256Text(stableStringify(rawProbe)),
    fullDecode: {
      videoDecodedWithoutError: true,
      audioDecodedWithoutError: true,
      videoMode: "sequential-rawvideo-null",
      audioMode: "sequential-pcm-s16le-null",
    },
  };
  const finalManifest = buildReboundFormalManifest({
    sourceManifest: source.manifestSnapshot.value,
    sourceVideoIntegrity: source.videoIntegrity,
    sourceManifestIntegrity: source.manifestSnapshot.integrity,
    sourceReceiptIntegrity: source.receiptSnapshot.integrity,
    rebinderIntegrity,
    verification,
    completedAt: validatedAt,
  });
  validateReboundFormalManifest({
    manifest: finalManifest,
    sourceManifest: source.manifestSnapshot.value,
    sourceVideoIntegrity: source.videoIntegrity,
    sourceManifestIntegrity: source.manifestSnapshot.integrity,
    sourceReceiptIntegrity: source.receiptSnapshot.integrity,
  });
  const plan = {
    source: {
      video: source.videoIntegrity,
      manifest: source.manifestSnapshot.integrity,
      receipt: source.receiptSnapshot.integrity,
    },
    target: {
      jobId: V004B_FINAL_CANDIDATE_IDENTITY.jobId,
      candidateVersion: V004B_FINAL_CANDIDATE_IDENTITY.candidateVersion,
      outputDirectory: V004B_FORMAL_REBIND_PATHS.outputDirectory,
      video: source.videoIntegrity,
    },
    verification,
    mediaReencoded: false,
  };
  if (options.dryRun) return {dryRun: true, plan};

  await mkdir(V004B_FORMAL_REBIND_PATHS.workDirectory, {recursive: true});
  const workStat = await lstat(V004B_FORMAL_REBIND_PATHS.workDirectory);
  if (!workStat.isDirectory() || workStat.isSymbolicLink()) {
    throw new Error("rebind work directory 必须是普通目录且不能是符号链接");
  }
  const jobLock = await acquireLongReviewRenderJobLock(
    V004B_FORMAL_REBIND_PATHS.workDirectory,
    {
      jobId: V004B_FINAL_CANDIDATE_IDENTITY.jobId,
      publicationDirectory: V004B_FORMAL_REBIND_PATHS.workDirectory,
    },
  );
  try {
    jobLock.assertOwned();
    await assertOutputLayoutAvailable();
    const currentRebinderIntegrity = await inspectFile(SCRIPT_PATH);
    if (
      stableStringify(currentRebinderIntegrity) !==
      stableStringify(rebinderIntegrity)
    ) {
      throw new Error("rebind 脚本在发布前发生漂移");
    }
    const finalSource = await inspectSourceCandidate(options);
    if (
      stableStringify(finalSource.videoIntegrity) !==
      stableStringify(source.videoIntegrity)
    ) {
      throw new Error("源候选 MP4 在发布前发生漂移");
    }
    const publication = await publishFinalCandidateAtomically({
      jobLock,
      finalMedia: {
        outputPath: V004B_FORMAL_REBIND_PATHS.sourceVideo,
        integrity: source.videoIntegrity,
      },
      finalManifest,
      stagingDirectory: V004B_FORMAL_REBIND_PATHS.workDirectory,
      outputDirectory: V004B_FORMAL_REBIND_PATHS.outputDirectory,
    });
    await assertNoSymlinkComponentsInside(
      REVIEW_CANDIDATES_DIRECTORY,
      V004B_FORMAL_REBIND_PATHS.outputDirectory,
      "published formal candidate",
    );
    const [publishedVideoIntegrity, publishedManifest, publishedReceipt] =
      await Promise.all([
        inspectFile(publication.publishedVideo),
        readJsonSnapshot(publication.finalManifestPath, "published manifest"),
        readJsonSnapshot(publication.receiptPath, "published durable receipt"),
      ]);
    const publishedBinding = validateReboundPublicationBinding({
      manifest: publishedManifest.value,
      receipt: publishedReceipt.value,
      videoIntegrity: publishedVideoIntegrity,
      manifestIntegrity: publishedManifest.integrity,
      expectedManifest: finalManifest,
      sourceManifest: source.manifestSnapshot.value,
      sourceVideoIntegrity: source.videoIntegrity,
      sourceManifestIntegrity: source.manifestSnapshot.integrity,
      sourceReceiptIntegrity: source.receiptSnapshot.integrity,
    });
    return {
      dryRun: false,
      plan,
      publication,
      publishedBinding,
      published: {
        video: publishedVideoIntegrity,
        manifest: publishedManifest.integrity,
        receipt: publishedReceipt.integrity,
      },
    };
  } finally {
    jobLock.release();
  }
}


async function main() {
  const options = parseRebindCliArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${rebindUsageText()}\n`);
    return;
  }
  const result = await rebindAgentSkillV004bFormalCandidate(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}


if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
