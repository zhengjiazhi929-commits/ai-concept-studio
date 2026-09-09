import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import {
  captureContentAwareGitIdentity,
  longReviewSourceInputs
} from "./long-render-job.mjs";

export const LONG_REVIEW_QA_SCHEMA_VERSION = "agent-skill-long-review-qa-pipeline-v1";
export const LONG_REVIEW_FINAL_MANIFEST_SCHEMA_VERSION =
  "agent-skill-long-review-chunked-final-v1";
export const LONG_REVIEW_RENDER_CONTRACT_SCHEMA_VERSION =
  "agent-skill-long-review-chunked-v1";
export const LONG_REVIEW_FINAL_MEDIA_SCHEMA_VERSION =
  "agent-skill-long-review-final-media-v1";
export const LONG_REVIEW_PUBLICATION_STATE_SCHEMA_VERSION =
  "agent-skill-long-review-publication-state-v1";
export const LONG_REVIEW_PUBLICATION_RECEIPT_FILE_NAME =
  "publication-durable-receipt.json";
export const LONG_REVIEW_PUBLICATION_RECEIPT_POLICY = Object.freeze({
  genericJobProtocol: "required",
  legacyDirectWideV004: "historical_compatibility_only"
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hasExactKeys(value, keys) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    sameJson(Object.keys(value).sort(), [...keys].sort())
  );
}

function workspaceRelative(workspaceRoot, filePath) {
  return relative(resolve(workspaceRoot), resolve(filePath)).replaceAll("\\", "/");
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function inspectStablePlainFile(filePath, workspaceRoot) {
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`long-review QA source must be a plain file: ${workspaceRelative(workspaceRoot, filePath)}`);
  }
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  const after = await lstat(filePath);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(`long-review QA source changed while hashing: ${workspaceRelative(workspaceRoot, filePath)}`);
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function listPlainFiles(inputPath, workspaceRoot) {
  const inputStat = await lstat(inputPath);
  if (inputStat.isSymbolicLink()) {
    throw new Error(`long-review QA source must not be a symlink: ${workspaceRelative(workspaceRoot, inputPath)}`);
  }
  if (inputStat.isFile()) return [inputPath];
  if (!inputStat.isDirectory()) {
    throw new Error(`long-review QA source is not a file or directory: ${workspaceRelative(workspaceRoot, inputPath)}`);
  }
  const result = [];
  const entries = (await readdir(inputPath, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const child = resolve(inputPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`long-review QA source must not be a symlink: ${workspaceRelative(workspaceRoot, child)}`);
    }
    if (entry.isDirectory()) result.push(...await listPlainFiles(child, workspaceRoot));
    if (entry.isFile()) result.push(child);
  }
  return result;
}

async function fingerprintPaths(inputPaths, workspaceRoot) {
  const discovered = (await Promise.all(
    inputPaths.map((inputPath) => listPlainFiles(inputPath, workspaceRoot))
  )).flat();
  const files = [...new Set(discovered.map((filePath) => resolve(filePath)))].sort();
  const aggregate = createHash("sha256");
  const records = [];
  let totalBytes = 0;
  for (const filePath of files) {
    const integrity = await inspectStablePlainFile(filePath, workspaceRoot);
    const path = workspaceRelative(workspaceRoot, filePath);
    aggregate.update(path);
    aggregate.update("\0");
    aggregate.update(integrity.sha256);
    aggregate.update("\0");
    totalBytes += integrity.bytes;
    records.push({ path, ...integrity });
  }
  return {
    algorithm: "sha256",
    sha256: aggregate.digest("hex"),
    fileCount: files.length,
    totalBytes,
    files: records
  };
}

export async function captureLongReviewCandidateSourceIdentity({
  job,
  jobConfigPath,
  workspaceRoot
}) {
  const root = resolve(workspaceRoot);
  const sourcePaths = [
    ...longReviewSourceInputs(job, {
      workspaceRoot: root,
      scriptPath: resolve(
        root,
        "studio/scripts/render-agent-skill-long-review-wide-v004-chunked.mjs"
      ),
      jobConfigPath
    }),
    resolve(root, "studio/scripts/render-agent-skill-long-review-chunked.mjs")
  ];
  const [source, git, voice] = await Promise.all([
    fingerprintPaths(sourcePaths, root),
    captureContentAwareGitIdentity({ workspaceRoot: root }),
    inspectStablePlainFile(job.resolvedPaths.voice, root)
  ]);
  return {
    source,
    git,
    voice: {
      path: workspaceRelative(root, job.resolvedPaths.voice),
      ...voice
    }
  };
}

export function validateLongReviewCandidateManifest({
  manifest,
  job,
  videoIntegrity,
  videoPath,
  workspaceRoot,
  currentInputIdentity,
  requireCurrentInputIdentity = true
}) {
  if (!job?.resolvedPaths) {
    throw new TypeError("validated long-review render job is required");
  }
  const expectedVideoPath = resolve(job.resolvedPaths.finalDirectory, "review-10m.mp4");
  const checks = {
    finalManifestSchema:
      manifest?.schemaVersion === LONG_REVIEW_FINAL_MANIFEST_SCHEMA_VERSION,
    renderContractSchema:
      manifest?.contract?.schemaVersion === LONG_REVIEW_RENDER_CONTRACT_SCHEMA_VERSION,
    renderJobSchema: manifest?.renderJob?.schemaVersion === job.schemaVersion,
    jobId: manifest?.contract?.jobId === job.jobId
      && manifest?.renderJob?.jobId === job.jobId,
    candidateVersion: manifest?.contract?.candidateVersion === job.candidateVersion
      && manifest?.renderJob?.candidateVersion === job.candidateVersion,
    episodeId: manifest?.contract?.episodeId === job.episodeId,
    compositionId: manifest?.contract?.compositionId === job.compositionId,
    dimensions: manifest?.contract?.width === job.width
      && manifest?.contract?.height === job.height,
    timeline: manifest?.contract?.fps === job.fps
      && manifest?.contract?.durationInFrames === job.durationInFrames,
    renderJobPaths: sameJson(manifest?.renderJob?.paths, job.paths),
    voiceStatus: manifest?.renderJob?.temporaryVoice === job.temporaryVoice
      && manifest?.renderJob?.temporaryVoiceIsFinalHumanRecording ===
        job.temporaryVoiceIsFinalHumanRecording,
    finalMediaSchema:
      manifest?.finalMedia?.schemaVersion === LONG_REVIEW_FINAL_MEDIA_SCHEMA_VERSION,
    finalMediaBytes: manifest?.finalMedia?.file?.bytes === videoIntegrity?.bytes,
    finalMediaSha256: manifest?.finalMedia?.file?.sha256 === videoIntegrity?.sha256,
    exactCandidateVideoPath: resolve(videoPath) === expectedVideoPath,
    publishedOutputPath:
      manifest?.publication?.outputPath === workspaceRelative(workspaceRoot, expectedVideoPath),
    manifestFinalDirectory:
      manifest?.paths?.finalDirectory ===
        workspaceRelative(workspaceRoot, job.resolvedPaths.finalDirectory),
    manifestFinalOutput:
      manifest?.paths?.finalOutput === workspaceRelative(workspaceRoot, expectedVideoPath),
    ...(requireCurrentInputIdentity
      ? {
          currentSourceIdentity: sameJson(manifest?.source, currentInputIdentity?.source),
          currentGitIdentity: sameJson(manifest?.git, currentInputIdentity?.git),
          currentVoiceIdentity: sameJson(manifest?.voice, currentInputIdentity?.voice)
        }
      : {})
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`candidate manifest is not bound to the explicit render job: ${failed.join(", ")}`);
  }
  return {
    passed: true,
    checks,
    job: {
      schemaVersion: job.schemaVersion,
      jobId: job.jobId,
      episodeId: job.episodeId,
      candidateVersion: job.candidateVersion,
      compositionId: job.compositionId,
      temporaryVoice: job.temporaryVoice,
      temporaryVoiceIsFinalHumanRecording: job.temporaryVoiceIsFinalHumanRecording
    }
  };
}

export function validateLongReviewPublicationDurableReceipt({
  receipt,
  manifest,
  manifestIntegrity,
  videoIntegrity,
  job
}) {
  if (!job?.resolvedPaths) {
    throw new TypeError("validated long-review render job is required");
  }
  const jobBinding = {
    finalManifestSchemaVersion: LONG_REVIEW_FINAL_MANIFEST_SCHEMA_VERSION,
    runFingerprint: manifest?.runFingerprint ?? null,
    jobId: job.jobId,
    candidateVersion: job.candidateVersion,
    episodeId: job.episodeId,
    compositionId: job.compositionId
  };
  const expectedJobBindingSha256 = createHash("sha256")
    .update(stableStringify(jobBinding))
    .digest("hex");
  const checks = {
    receiptObject: hasExactKeys(receipt, [
      "schemaVersion",
      "kind",
      "attemptToken",
      "output",
      "manifest",
      "jobBinding",
      "jobBindingSha256",
      "recordedAt"
    ]),
    receiptSchema:
      receipt?.schemaVersion === LONG_REVIEW_PUBLICATION_STATE_SCHEMA_VERSION,
    receiptKind: receipt?.kind === "durable_receipt",
    attemptToken:
      typeof receipt?.attemptToken === "string" && UUID_PATTERN.test(receipt.attemptToken),
    recordedAt:
      typeof receipt?.recordedAt === "string" &&
      !Number.isNaN(Date.parse(receipt.recordedAt)),
    outputObject: hasExactKeys(receipt?.output, ["fileName", "bytes", "sha256"]),
    outputFileName: receipt?.output?.fileName === "review-10m.mp4",
    outputBytes:
      Number.isSafeInteger(videoIntegrity?.bytes) &&
      videoIntegrity.bytes >= 0 &&
      receipt?.output?.bytes === videoIntegrity.bytes,
    outputSha256:
      SHA256_PATTERN.test(videoIntegrity?.sha256 ?? "") &&
      receipt?.output?.sha256 === videoIntegrity.sha256,
    manifestObject: hasExactKeys(receipt?.manifest, ["fileName", "sha256"]),
    manifestFileName: receipt?.manifest?.fileName === "review-manifest.json",
    manifestSha256:
      SHA256_PATTERN.test(manifestIntegrity?.sha256 ?? "") &&
      receipt?.manifest?.sha256 === manifestIntegrity.sha256,
    manifestRunFingerprint: SHA256_PATTERN.test(manifest?.runFingerprint ?? ""),
    jobBindingObject: hasExactKeys(receipt?.jobBinding, [
      "finalManifestSchemaVersion",
      "runFingerprint",
      "jobId",
      "candidateVersion",
      "episodeId",
      "compositionId"
    ]),
    jobBinding: stableStringify(receipt?.jobBinding) === stableStringify(jobBinding),
    jobBindingSha256:
      receipt?.jobBindingSha256 === expectedJobBindingSha256 &&
      SHA256_PATTERN.test(receipt?.jobBindingSha256 ?? "")
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    const error = new Error(
      `candidate does not have a valid positive durable publication receipt: ${failed.join(", ")}`
    );
    error.code = "long_review_publication_receipt_invalid";
    error.failedChecks = failed;
    throw error;
  }
  return {
    passed: true,
    checks,
    receipt: {
      schemaVersion: receipt.schemaVersion,
      kind: receipt.kind,
      attemptToken: receipt.attemptToken,
      recordedAt: receipt.recordedAt,
      jobBindingSha256: receipt.jobBindingSha256
    },
    jobBinding
  };
}

export function resolveLongReviewQaJobConfigPath(workspaceRoot, value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    isAbsolute(value) ||
    value.split(/[\\/]/u).includes("..")
  ) {
    throw new TypeError("--job-config must be a relative workspace path");
  }
  const root = resolve(workspaceRoot);
  const candidate = resolve(root, value);
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("--job-config escapes the workspace");
  }
  return candidate;
}

export function parseLongReviewQaCliArguments(argv) {
  const options = {
    help: false,
    jobConfigPath: null,
    qaDirectoryName: "qa",
    videoFileName: "review-10m.mp4"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const takeValue = (name) => {
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
      index += 1;
      if (index >= argv.length) throw new Error(`${name} requires a value`);
      return argv[index];
    };
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--job-config" || argument.startsWith("--job-config=")) {
      options.jobConfigPath = takeValue("--job-config");
    } else if (argument === "--qa-dir-name" || argument.startsWith("--qa-dir-name=")) {
      options.qaDirectoryName = takeValue("--qa-dir-name");
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!/^qa(?:-v[0-9]{3})?$/u.test(options.qaDirectoryName)) {
    throw new Error("--qa-dir-name only allows qa or qa-vNNN");
  }
  if (!options.help && !options.jobConfigPath) {
    throw new Error("--job-config is required for versioned long-review QA");
  }
  return options;
}
