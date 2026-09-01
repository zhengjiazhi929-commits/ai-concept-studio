import {execFile, spawn} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {
  constants as fsConstants,
} from "node:fs";
import {
  access,
  appendFile,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import {basename, dirname, extname, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";

import {bundle} from "@remotion/bundler";
import {
  RenderInternals,
  makeCancelSignal,
  openBrowser,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";

import {
  assertWideV004InputsChanged,
  assertWideV004SnapshotsUnchanged,
  captureWideV004ProtectedBaselines,
  captureWideV004ReviewInputs,
} from "./render-agent-skill-long-review-wide-v004.mjs";
import {
  acquireLongReviewRenderJobLock,
  assertLongReviewRenderJobFilesystemSafety,
  bindLongReviewRenderWorkerToParent,
  captureContentAwareGitIdentity,
  LONG_REVIEW_RENDER_PARENT_BINDING_PROTOCOL,
  longReviewSourceInputs,
  syncLongReviewRenderDirectory,
  syncLongReviewRenderFile,
  validateLongReviewRenderJob,
} from "../src/server/production/long-render-job.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const PUBLIC_ROOT = resolve(STUDIO_ROOT, "public");
const VIDEO_ROOT = resolve(STUDIO_ROOT, "src", "video");
const RENDER_JOB_ENVIRONMENT_KEY = "AI_CONCEPT_STUDIO_LONG_REVIEW_RENDER_JOB";
const execFileAsync = promisify(execFile);
const RENDER_JOB_CONFIG_PATH = process.env[RENDER_JOB_ENVIRONMENT_KEY]
  ? resolve(process.env[RENDER_JOB_ENVIRONMENT_KEY])
  : null;
const CONFIGURED_RENDER_JOB = await (async () => {
  if (!RENDER_JOB_CONFIG_PATH) return null;
  assertInside(WORKSPACE_ROOT, RENDER_JOB_CONFIG_PATH, "render job config");
  const stat = await lstat(RENDER_JOB_CONFIG_PATH);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Render job config must be a regular, non-symlink file");
  }
  const job = validateLongReviewRenderJob(
    JSON.parse(await readFile(RENDER_JOB_CONFIG_PATH, "utf8")),
    {workspaceRoot: WORKSPACE_ROOT},
  );
  await assertLongReviewRenderJobFilesystemSafety(job, {
    workspaceRoot: WORKSPACE_ROOT,
    jobConfigPath: RENDER_JOB_CONFIG_PATH,
  });
  return job;
})();
const ENTRY_POINT = CONFIGURED_RENDER_JOB?.resolvedPaths.entryPoint ??
  resolve(VIDEO_ROOT, "agent-skill-long-review-index.jsx");
const EPISODE_PATH = CONFIGURED_RENDER_JOB?.resolvedPaths.episode ?? resolve(
  STUDIO_ROOT,
  "data",
  "episodes",
  "agent-skill-20260806",
  "episode.json",
);
const VOICE_PATH = CONFIGURED_RENDER_JOB?.resolvedPaths.voice ?? resolve(
  PUBLIC_ROOT,
  "episodes",
  "agent-skill-20260806",
  "voice-v001.wav",
);
const REVIEW_CANDIDATES_ROOT = CONFIGURED_RENDER_JOB
  ? dirname(CONFIGURED_RENDER_JOB.resolvedPaths.finalDirectory)
  : resolve(
      WORKSPACE_ROOT,
      "outputs",
      "studio",
      "agent-skill-20260806",
      "review-candidates",
    );
const FINAL_DIRECTORY = CONFIGURED_RENDER_JOB?.resolvedPaths.finalDirectory ?? resolve(
  REVIEW_CANDIDATES_ROOT,
  "full-video-current-visual-upgrade-v004",
);
const FINAL_OUTPUT_PATH = resolve(FINAL_DIRECTORY, "review-10m.mp4");
const WORK_DIRECTORY = CONFIGURED_RENDER_JOB?.resolvedPaths.workDirectory ?? resolve(
  REVIEW_CANDIDATES_ROOT,
  ".full-video-current-visual-upgrade-v004-chunked-work",
);
const CHUNKS_DIRECTORY = resolve(WORK_DIRECTORY, "chunks");
const STAGING_DIRECTORY = resolve(WORK_DIRECTORY, "staging");
const LOGS_DIRECTORY = resolve(WORK_DIRECTORY, "logs");
const BUNDLE_DIRECTORY = resolve(WORK_DIRECTORY, "bundle");
const RUN_MANIFEST_PATH = resolve(WORK_DIRECTORY, "render-manifest.json");
const CHROME_EXECUTABLE =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const CHUNKED_REMOTION_TIMEOUT_MS = 180_000;
export const CHUNKED_CHROMIUM_OPTIONS = Object.freeze({
  headless: true,
  darkMode: false,
});

export const CHUNKED_V004_CONTRACT = Object.freeze({
  schemaVersion: CONFIGURED_RENDER_JOB
    ? "agent-skill-long-review-chunked-v1"
    : "agent-skill-long-review-wide-v004-chunked-v1",
  jobId: CONFIGURED_RENDER_JOB?.jobId ?? "legacy-agent-skill-v004",
  candidateVersion: CONFIGURED_RENDER_JOB?.candidateVersion ?? 4,
  episodeId: CONFIGURED_RENDER_JOB?.episodeId ?? "agent-skill-20260806",
  compositionId: CONFIGURED_RENDER_JOB?.compositionId ?? "AgentSkillLongReview",
  width: CONFIGURED_RENDER_JOB?.width ?? 1920,
  height: CONFIGURED_RENDER_JOB?.height ?? 1080,
  fps: CONFIGURED_RENDER_JOB?.fps ?? 30,
  durationInFrames: CONFIGURED_RENDER_JOB?.durationInFrames ?? 18_000,
  durationSeconds: 600,
  defaultChunkFrames: 900,
  defaultInterChunkPauseMs: 5_000,
  remotionTimeoutMs: CHUNKED_REMOTION_TIMEOUT_MS,
  fontAssetDelivery: "bundled-resource",
  fontReadiness: "remotion-document-fonts-ready",
  renderBrowserExecutable: "system-google-chrome",
  renderChromeMode: "chrome-for-testing",
  renderBrowserSession: "one-worker-one-reused-browser",
  renderBrowserCapture: "from-surface",
  wallpaperCompositorPolicy: "no-viewport-filter-no-viewport-will-change",
  codec: "h264",
  pixelFormat: "yuv420p",
  crf: 22,
  concurrency: 1,
  muted: true,
  enforceAudioTrack: false,
  audioSampleRate: 48_000,
  audioSamples: 28_800_000,
  audioCodec: "aac",
  audioBitrate: "192k",
  outputFileName: "review-10m.mp4",
  temporaryVoice: CONFIGURED_RENDER_JOB?.temporaryVoice ?? true,
  temporaryVoiceIsFinalHumanRecording:
    CONFIGURED_RENDER_JOB?.temporaryVoiceIsFinalHumanRecording ?? false,
});

export const CHUNKED_V004_PATHS = Object.freeze({
  workDirectory: WORK_DIRECTORY,
  chunksDirectory: CHUNKS_DIRECTORY,
  stagingDirectory: STAGING_DIRECTORY,
  logsDirectory: LOGS_DIRECTORY,
  bundleDirectory: BUNDLE_DIRECTORY,
  runManifestPath: RUN_MANIFEST_PATH,
  finalDirectory: FINAL_DIRECTORY,
  finalOutputPath: FINAL_OUTPUT_PATH,
  voicePath: VOICE_PATH,
});

const SOURCE_INPUTS = Object.freeze(
  CONFIGURED_RENDER_JOB
    ? [
        ...longReviewSourceInputs(CONFIGURED_RENDER_JOB, {
          workspaceRoot: WORKSPACE_ROOT,
          scriptPath: SCRIPT_PATH,
          jobConfigPath: RENDER_JOB_CONFIG_PATH,
        }),
        resolve(dirname(SCRIPT_PATH), "render-agent-skill-long-review-chunked.mjs"),
      ]
    : [
        SCRIPT_PATH,
        resolve(dirname(SCRIPT_PATH), "render-agent-skill-long-review-wide-v004.mjs"),
        resolve(STUDIO_ROOT, "src"),
        PUBLIC_ROOT,
        resolve(WORKSPACE_ROOT, ".node-version"),
        resolve(STUDIO_ROOT, "package.json"),
        resolve(STUDIO_ROOT, "pnpm-lock.yaml"),
        resolve(STUDIO_ROOT, "config", "visual-system.json"),
        EPISODE_PATH,
      ],
);

const BUNDLE_CONTEXT_FILE = CONFIGURED_RENDER_JOB
  ? ".long-review-chunked-bundle-context.json"
  : ".v004-chunked-bundle-context.json";
const CHUNK_RECORD_SCHEMA_VERSION = CONFIGURED_RENDER_JOB
  ? "agent-skill-long-review-chunk-v1"
  : "agent-skill-long-review-wide-v004-chunk-v1";
const FINAL_MANIFEST_SCHEMA_VERSION = CONFIGURED_RENDER_JOB
  ? "agent-skill-long-review-chunked-final-v1"
  : "agent-skill-long-review-wide-v004-chunked-final-v1";
const CONCAT_RECORD_SCHEMA_VERSION = CONFIGURED_RENDER_JOB
  ? "agent-skill-long-review-concat-v1"
  : "agent-skill-long-review-wide-v004-concat-v1";
const FINAL_MEDIA_RECORD_SCHEMA_VERSION = CONFIGURED_RENDER_JOB
  ? "agent-skill-long-review-final-media-v1"
  : "agent-skill-long-review-wide-v004-final-media-v1";
const PUBLICATION_STATE_SCHEMA_VERSION = CONFIGURED_RENDER_JOB
  ? "agent-skill-long-review-publication-state-v1"
  : "agent-skill-long-review-wide-v004-publication-state-v1";
const PUBLICATION_PENDING_FILE_NAME = "publication-durability-unknown.json";
const PUBLICATION_RECEIPT_FILE_NAME = "publication-durable-receipt.json";
export const LONG_REVIEW_PUBLICATION_DURABILITY_UNKNOWN =
  "long_review_publication_durability_unknown";
const PUBLICATION_PART_PREFIX = CONFIGURED_RENDER_JOB
  ? ".long-review-publication"
  : ".v004-publication";
export const CHUNKED_LONG_REVIEW_SCHEMAS = Object.freeze({
  chunk: CHUNK_RECORD_SCHEMA_VERSION,
  finalManifest: FINAL_MANIFEST_SCHEMA_VERSION,
  concat: CONCAT_RECORD_SCHEMA_VERSION,
  finalMedia: FINAL_MEDIA_RECORD_SCHEMA_VERSION,
  publicationState: PUBLICATION_STATE_SCHEMA_VERSION,
  publicationPendingFileName: PUBLICATION_PENDING_FILE_NAME,
  publicationReceiptFileName: PUBLICATION_RECEIPT_FILE_NAME,
  publicationPartPrefix: PUBLICATION_PART_PREFIX,
});
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const activePartPaths = new Map();
const activeCancellations = new Set();
const activeBrowsers = new Set();
let activeWorker = null;
let activeAttemptCapability = null;
let browserOpening = false;
let terminating = false;
let terminationSignal = null;

function assertAttemptToken(attemptToken) {
  if (typeof attemptToken !== "string" || !/^[a-f0-9-]{8,80}$/u.test(attemptToken)) {
    throw new Error("A lowercase UUID-like render attempt token is required");
  }
  return attemptToken;
}

export function attemptScopedPartPath(filePath, attemptToken) {
  const token = assertAttemptToken(attemptToken);
  const extension = extname(filePath);
  return extension
    ? `${filePath.slice(0, -extension.length)}.attempt-${token}${extension}`
    : `${filePath}.attempt-${token}`;
}

function activateAttempt(attemptToken) {
  const token = assertAttemptToken(attemptToken);
  if (activeAttemptCapability !== null) {
    throw new Error("A render attempt is already active in this process");
  }
  const capability = Object.freeze({
    token,
    workDirectory: resolve(WORK_DIRECTORY),
  });
  activeAttemptCapability = capability;
  return capability;
}

function assertActiveAttempt(attemptToken) {
  const token = assertAttemptToken(attemptToken);
  if (
    activeAttemptCapability === null ||
    activeAttemptCapability.token !== token
  ) {
    throw new Error("Part path registration requires the active render attempt capability");
  }
  return activeAttemptCapability;
}

function assertAttemptPartPath(filePath, attemptToken) {
  const token = assertAttemptToken(attemptToken);
  const resolvedPath = assertInside(WORK_DIRECTORY, filePath, "attempt part");
  if (resolvedPath === resolve(WORK_DIRECTORY)) {
    throw new Error("Refusing to track the render work directory itself");
  }
  if (!basename(resolvedPath).includes(`.attempt-${token}`)) {
    throw new Error(`Refusing to track a part path not owned by attempt ${token}`);
  }
  return resolvedPath;
}

function registerActivePart(filePath, attemptToken) {
  const capability = assertActiveAttempt(attemptToken);
  const resolvedPath = assertAttemptPartPath(filePath, capability.token);
  const existingOwner = activePartPaths.get(resolvedPath);
  if (existingOwner && existingOwner !== capability) {
    throw new Error(`Part path is already owned by another render attempt: ${resolvedPath}`);
  }
  activePartPaths.set(resolvedPath, capability);
  return resolvedPath;
}

function unregisterActivePart(filePath, attemptToken) {
  const capability = assertActiveAttempt(attemptToken);
  const resolvedPath = assertAttemptPartPath(filePath, capability.token);
  if (activePartPaths.get(resolvedPath) !== capability) return false;
  activePartPaths.delete(resolvedPath);
  return true;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

const RUN_FINGERPRINT_PAYLOAD_KEYS = Object.freeze([
  "contract",
  "renderConfig",
  "renderJob",
  "source",
  "git",
  "runtime",
  "voice",
  "safety",
  "inputFingerprint",
  "runtimeFingerprint",
  "bundle",
  "tools",
  "ranges",
]);

function runFingerprintPayloadFromManifest(manifest) {
  return Object.fromEntries(
    RUN_FINGERPRINT_PAYLOAD_KEYS
      .filter((key) => Object.hasOwn(manifest, key))
      .map((key) => [key, manifest[key]]),
  );
}

export function assertResumableRunManifest(existing, expected) {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    throw new Error("Resume manifest must be a JSON object");
  }
  if (existing.schemaVersion !== expected.schemaVersion) {
    throw new Error("Resume manifest schema does not match this renderer");
  }
  if (Number.isNaN(Date.parse(existing.createdAt ?? ""))) {
    throw new Error("Resume manifest createdAt is invalid");
  }
  const pause = existing.scheduleConfig?.interChunkPauseMs;
  if (!Number.isSafeInteger(pause) || pause < 0 || pause > 60_000) {
    throw new Error("Resume manifest scheduleConfig is invalid");
  }
  const recomputedFingerprint = sha256Text(
    stableStringify(runFingerprintPayloadFromManifest(existing)),
  );
  if (recomputedFingerprint !== existing.runFingerprint) {
    throw new Error("Resume manifest payload does not match its runFingerprint");
  }
  const {
    createdAt: _existingCreatedAt,
    scheduleConfig: _existingScheduleConfig,
    ...existingImmutable
  } = existing;
  const {
    createdAt: _expectedCreatedAt,
    scheduleConfig: _expectedScheduleConfig,
    ...expectedImmutable
  } = expected;
  if (stableStringify(existingImmutable) !== stableStringify(expectedImmutable)) {
    throw new Error("Resume manifest immutable fields do not match current inputs");
  }
  return existing;
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function workspaceRelative(filePath) {
  return relative(WORKSPACE_ROOT, filePath).replaceAll("\\", "/");
}

function assertInside(parent, candidate, label = "path") {
  const resolvedParent = resolve(parent);
  const resolvedCandidate = resolve(candidate);
  if (
    resolvedCandidate !== resolvedParent &&
    !resolvedCandidate.startsWith(`${resolvedParent}${sep}`)
  ) {
    throw new Error(`${label} escapes its allowed directory: ${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertPlainFile(filePath, label = workspaceRelative(filePath)) {
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  return fileStat;
}

function sameStableFileStat(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs;
}

async function readStablePlainFileIfPresent(filePath, label) {
  let pathBefore;
  try {
    pathBefore = await lstat(filePath, {bigint: true});
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat({bigint: true});
    if (!opened.isFile() || !sameStableFileStat(pathBefore, opened)) {
      throw new Error(`${label} changed before it was opened`);
    }
    const contents = await handle.readFile();
    const [handleAfter, pathAfter] = await Promise.all([
      handle.stat({bigint: true}),
      lstat(filePath, {bigint: true}),
    ]);
    if (
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      !sameStableFileStat(opened, handleAfter) ||
      !sameStableFileStat(handleAfter, pathAfter) ||
      BigInt(contents.length) !== handleAfter.size
    ) {
      throw new Error(`${label} changed while being read`);
    }
    return contents;
  } finally {
    await handle.close();
  }
}

async function assertAbsent(filePath, label = workspaceRelative(filePath)) {
  if (await pathExists(filePath)) {
    throw new Error(`${label} already exists; refusing to overwrite it`);
  }
}

export async function inspectFile(filePath) {
  const label = workspaceRelative(filePath);
  const pathBefore = await lstat(filePath, {bigint: true});
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlink file`);
  }
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat({bigint: true});
    if (!opened.isFile() || !sameStableFileStat(pathBefore, opened)) {
      throw new Error(`File changed before hashing: ${label}`);
    }
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream({autoClose: false})) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    const [handleAfter, pathAfter] = await Promise.all([
      handle.stat({bigint: true}),
      lstat(filePath, {bigint: true}),
    ]);
    if (
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      !sameStableFileStat(opened, handleAfter) ||
      !sameStableFileStat(handleAfter, pathAfter) ||
      BigInt(bytes) !== handleAfter.size
    ) {
      throw new Error(`File changed while hashing: ${label}`);
    }
    return {bytes, sha256: hash.digest("hex")};
  } finally {
    await handle.close();
  }
}

async function listFiles(inputPath) {
  const inputStat = await lstat(inputPath);
  if (inputStat.isSymbolicLink()) {
    throw new Error(`Refusing to hash symlink: ${workspaceRelative(inputPath)}`);
  }
  if (inputStat.isFile()) return [inputPath];
  if (!inputStat.isDirectory()) {
    throw new Error(`Hash input is neither a file nor directory: ${inputPath}`);
  }
  const files = [];
  const entries = await readdir(inputPath, {withFileTypes: true});
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const child = resolve(inputPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to hash symlink: ${workspaceRelative(child)}`);
    }
    if (entry.isDirectory()) files.push(...(await listFiles(child)));
    if (entry.isFile()) files.push(child);
  }
  return files;
}

async function fingerprintPaths(inputPaths, {baseDirectory, includeFiles = true} = {}) {
  const discovered = (
    await Promise.all(inputPaths.map((inputPath) => listFiles(inputPath)))
  ).flat();
  const files = [...new Set(discovered.map((filePath) => resolve(filePath)))].sort();
  const aggregate = createHash("sha256");
  const records = [];
  let totalBytes = 0;
  for (const filePath of files) {
    const integrity = await inspectFile(filePath);
    const path = relative(baseDirectory ?? WORKSPACE_ROOT, filePath).replaceAll(
      "\\",
      "/",
    );
    aggregate.update(path);
    aggregate.update("\0");
    aggregate.update(integrity.sha256);
    aggregate.update("\0");
    totalBytes += integrity.bytes;
    if (includeFiles) records.push({path, ...integrity});
  }
  return {
    algorithm: "sha256",
    sha256: aggregate.digest("hex"),
    fileCount: files.length,
    totalBytes,
    ...(includeFiles ? {files: records} : {}),
  };
}

async function captureGitIdentity() {
  return captureContentAwareGitIdentity({workspaceRoot: WORKSPACE_ROOT});
}

export function buildChunkRanges({
  totalFrames = CHUNKED_V004_CONTRACT.durationInFrames,
  chunkFrames = CHUNKED_V004_CONTRACT.defaultChunkFrames,
} = {}) {
  if (!Number.isSafeInteger(totalFrames) || totalFrames <= 0) {
    throw new TypeError("totalFrames must be a positive safe integer");
  }
  if (!Number.isSafeInteger(chunkFrames) || chunkFrames <= 0) {
    throw new TypeError("chunkFrames must be a positive safe integer");
  }
  if (totalFrames % chunkFrames !== 0) {
    throw new Error(
      `chunkFrames=${chunkFrames} must divide totalFrames=${totalFrames} exactly`,
    );
  }
  return Array.from({length: totalFrames / chunkFrames}, (_, index) => {
    const start = index * chunkFrames;
    return Object.freeze({
      index,
      start,
      end: start + chunkFrames - 1,
      frameCount: chunkFrames,
      durationSeconds: chunkFrames / CHUNKED_V004_CONTRACT.fps,
    });
  });
}

function parseIntegerOption(name, rawValue, {minimum = 0, maximum} = {}) {
  const value = Number(rawValue);
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum ?? "Infinity"}`,
    );
  }
  return value;
}

export function parseCliArguments(argv) {
  const options = {
    help: false,
    worker: false,
    chunkFrames: CHUNKED_V004_CONTRACT.defaultChunkFrames,
    interChunkPauseMs: CHUNKED_V004_CONTRACT.defaultInterChunkPauseMs,
    manifestPath: null,
    expectedManifestSha256: null,
    chunkIndex: null,
    expectedCodecBase64: null,
    attemptToken: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const takeValue = (name) => {
      const inline = argument.startsWith(`${name}=`)
        ? argument.slice(name.length + 1)
        : null;
      if (inline !== null) return inline;
      index += 1;
      if (index >= argv.length) throw new Error(`${name} requires a value`);
      return argv[index];
    };
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--worker") options.worker = true;
    else if (argument === "--chunk-frames" || argument.startsWith("--chunk-frames=")) {
      options.chunkFrames = parseIntegerOption(
        "--chunk-frames",
        takeValue("--chunk-frames"),
        {minimum: 1, maximum: CHUNKED_V004_CONTRACT.durationInFrames},
      );
    } else if (
      argument === "--inter-chunk-pause-ms" ||
      argument.startsWith("--inter-chunk-pause-ms=")
    ) {
      options.interChunkPauseMs = parseIntegerOption(
        "--inter-chunk-pause-ms",
        takeValue("--inter-chunk-pause-ms"),
        {minimum: 0, maximum: 60_000},
      );
    } else if (argument === "--manifest" || argument.startsWith("--manifest=")) {
      options.manifestPath = resolve(takeValue("--manifest"));
    } else if (
      argument === "--expected-manifest-sha256" ||
      argument.startsWith("--expected-manifest-sha256=")
    ) {
      options.expectedManifestSha256 = takeValue("--expected-manifest-sha256");
    } else if (
      argument === "--chunk-index" ||
      argument.startsWith("--chunk-index=")
    ) {
      options.chunkIndex = parseIntegerOption(
        "--chunk-index",
        takeValue("--chunk-index"),
        {minimum: 0},
      );
    } else if (
      argument === "--expected-codec-base64" ||
      argument.startsWith("--expected-codec-base64=")
    ) {
      options.expectedCodecBase64 = takeValue("--expected-codec-base64");
    } else if (
      argument === "--attempt-token" ||
      argument.startsWith("--attempt-token=")
    ) {
      options.attemptToken = assertAttemptToken(takeValue("--attempt-token"));
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  buildChunkRanges({chunkFrames: options.chunkFrames});
  return options;
}

export function usageText() {
  return [
    "Low-memory resumable Remotion renderer for the 10-minute v004 review candidate.",
    "",
    `Usage: node ${workspaceRelative(SCRIPT_PATH)} [options]`,
    "",
    "Options:",
    "  --chunk-frames <frames>          Frames per child process (default: 900).",
    "  --inter-chunk-pause-ms <ms>      Pause between child processes (default: 5000).",
    "  --help                            Show this help.",
    "",
    "For lower scheduling priority, launch this script externally with:",
    `  taskpolicy -b nice -n 20 node ${workspaceRelative(SCRIPT_PATH)} --chunk-frames 900 --inter-chunk-pause-ms 5000`,
    "The script itself never invokes taskpolicy or nice.",
  ].join("\n");
}

function rationalToNumber(value) {
  if (typeof value !== "string") return Number.NaN;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return Number.NaN;
  }
  return numerator / denominator;
}

function exactFrameCount(video) {
  for (const candidate of [video?.nb_read_frames, video?.nb_frames]) {
    const value = Number(candidate);
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  return Number.NaN;
}

export function codecMetadataFromProbe(video) {
  const keys = [
    "codec_name",
    "codec_long_name",
    "profile",
    "codec_tag_string",
    "codec_tag",
    "width",
    "height",
    "coded_width",
    "coded_height",
    "has_b_frames",
    "pix_fmt",
    "level",
    "color_range",
    "color_space",
    "color_transfer",
    "color_primaries",
    "chroma_location",
    "field_order",
    "refs",
    "is_avc",
    "nal_length_size",
    "bits_per_raw_sample",
    "r_frame_rate",
    "avg_frame_rate",
    "time_base",
  ];
  return Object.fromEntries(keys.map((key) => [key, video?.[key] ?? null]));
}

export function normalizeProbe(rawProbe) {
  const streams = Array.isArray(rawProbe?.streams) ? rawProbe.streams : [];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const video = videoStreams[0] ?? null;
  const durationSeconds = Number(rawProbe?.format?.duration ?? video?.duration);
  const frameCount = exactFrameCount(video);
  const fps = rationalToNumber(video?.avg_frame_rate ?? video?.r_frame_rate);
  const codecMetadata = codecMetadataFromProbe(video);
  return {
    formatName: rawProbe?.format?.format_name ?? null,
    durationSeconds,
    frameCount,
    fps,
    videoStreamCount: videoStreams.length,
    audioStreamCount: audioStreams.length,
    video,
    audio: audioStreams[0] ?? null,
    codecMetadata,
    codecMetadataSha256: sha256Text(stableStringify(codecMetadata)),
  };
}

function sameCodecMetadata(left, right) {
  return stableStringify(left) === stableStringify(right);
}

export function evaluateChunkProbe(
  rawProbe,
  range,
  expectedCodecMetadata = null,
) {
  const media = normalizeProbe(rawProbe);
  const expectedDuration = range.frameCount / CHUNKED_V004_CONTRACT.fps;
  const checks = {
    mp4: media.formatName?.split(",").includes("mp4") === true,
    oneVideoStream: media.videoStreamCount === 1,
    noAudio: media.audioStreamCount === 0,
    exactFrames: media.frameCount === range.frameCount,
    exactDuration:
      Number.isFinite(media.durationSeconds) &&
      Math.abs(media.durationSeconds - expectedDuration) <= 0.02,
    fps30: Number.isFinite(media.fps) && Math.abs(media.fps - 30) <= 0.0001,
    width1920: media.video?.width === CHUNKED_V004_CONTRACT.width,
    height1080: media.video?.height === CHUNKED_V004_CONTRACT.height,
    h264: media.video?.codec_name === CHUNKED_V004_CONTRACT.codec,
    yuv420p: media.video?.pix_fmt === CHUNKED_V004_CONTRACT.pixelFormat,
    sameCodecMetadata:
      expectedCodecMetadata === null ||
      sameCodecMetadata(media.codecMetadata, expectedCodecMetadata),
  };
  return {
    valid: Object.values(checks).every(Boolean),
    checks,
    media,
    probeSha256: sha256Text(stableStringify(rawProbe)),
  };
}

export function evaluateConcatenatedProbe(rawProbe) {
  const range = {
    frameCount: CHUNKED_V004_CONTRACT.durationInFrames,
  };
  const result = evaluateChunkProbe(rawProbe, range);
  return {
    ...result,
    checks: {
      ...result.checks,
      exactDuration:
        Number.isFinite(result.media.durationSeconds) &&
        Math.abs(
          result.media.durationSeconds - CHUNKED_V004_CONTRACT.durationSeconds,
        ) <= 0.02,
    },
    get valid() {
      return Object.values(this.checks).every(Boolean);
    },
  };
}

export function evaluateFinalProbe(rawProbe, expectedCodecMetadata = null) {
  const media = normalizeProbe(rawProbe);
  const audioStreams = (rawProbe?.streams ?? []).filter(
    (stream) => stream.codec_type === "audio",
  );
  const checks = {
    mp4: media.formatName?.split(",").includes("mp4") === true,
    oneVideoStream: media.videoStreamCount === 1,
    oneAudioStream: audioStreams.length === 1,
    exactFrames: media.frameCount === CHUNKED_V004_CONTRACT.durationInFrames,
    exactDuration:
      Number.isFinite(media.durationSeconds) &&
      Math.abs(media.durationSeconds - CHUNKED_V004_CONTRACT.durationSeconds) <= 0.05,
    fps30: Number.isFinite(media.fps) && Math.abs(media.fps - 30) <= 0.0001,
    width1920: media.video?.width === CHUNKED_V004_CONTRACT.width,
    height1080: media.video?.height === CHUNKED_V004_CONTRACT.height,
    h264: media.video?.codec_name === CHUNKED_V004_CONTRACT.codec,
    yuv420p: media.video?.pix_fmt === CHUNKED_V004_CONTRACT.pixelFormat,
    codecMetadataUnchanged:
      expectedCodecMetadata === null ||
      sameCodecMetadata(media.codecMetadata, expectedCodecMetadata),
    aac: audioStreams[0]?.codec_name === CHUNKED_V004_CONTRACT.audioCodec,
    audio48k:
      Number(audioStreams[0]?.sample_rate) ===
      CHUNKED_V004_CONTRACT.audioSampleRate,
  };
  return {
    valid: Object.values(checks).every(Boolean),
    checks,
    media,
    probeSha256: sha256Text(stableStringify(rawProbe)),
  };
}

export function isChunkResumeEligible({
  record,
  runFingerprint,
  range,
  integrity,
  validation,
  expectedCodecMetadata = null,
  chunkFrames,
}) {
  if (!record || !validation?.valid) return false;
  const sameRange =
    record.range?.index === range.index &&
    record.range?.start === range.start &&
    record.range?.end === range.end &&
    record.range?.frameCount === range.frameCount;
  return (
    record.schemaVersion === CHUNK_RECORD_SCHEMA_VERSION &&
    record.runFingerprint === runFingerprint &&
    record.chunkFrames === chunkFrames &&
    sameRange &&
    record.file?.bytes === integrity?.bytes &&
    record.file?.sha256 === integrity?.sha256 &&
    HASH_PATTERN.test(record.file?.sha256 ?? "") &&
    record.probeSha256 === validation.probeSha256 &&
    sameCodecMetadata(record.codecMetadata, validation.media.codecMetadata) &&
    (expectedCodecMetadata === null ||
      sameCodecMetadata(record.codecMetadata, expectedCodecMetadata))
  );
}

function chunkStem(range) {
  const digits = String(CHUNKED_V004_CONTRACT.durationInFrames - 1).length;
  return [
    `chunk-${String(range.index).padStart(2, "0")}`,
    String(range.start).padStart(digits, "0"),
    String(range.end).padStart(digits, "0"),
  ].join("-");
}

function chunkPaths(range, attemptToken = null) {
  const stem = chunkStem(range);
  const part = resolve(CHUNKS_DIRECTORY, `${stem}.part.mp4`);
  const metadataPart = resolve(CHUNKS_DIRECTORY, `${stem}.metadata.part.json`);
  return {
    output: resolve(CHUNKS_DIRECTORY, `${stem}.mp4`),
    part: attemptToken ? attemptScopedPartPath(part, attemptToken) : part,
    metadata: resolve(CHUNKS_DIRECTORY, `${stem}.metadata.json`),
    metadataPart: attemptToken
      ? attemptScopedPartPath(metadataPart, attemptToken)
      : metadataPart,
    log: resolve(LOGS_DIRECTORY, `${stem}.log`),
  };
}

async function assertSafeAttemptPartParent(filePath, attemptToken) {
  const resolvedPath = assertAttemptPartPath(filePath, attemptToken);
  const resolvedWorkDirectory = resolve(WORK_DIRECTORY);
  const workStat = await lstat(resolvedWorkDirectory);
  if (!workStat.isDirectory() || workStat.isSymbolicLink()) {
    throw new Error("Render work directory must be a regular, non-symlink directory");
  }
  const parentPath = dirname(resolvedPath);
  const relativeParent = relative(resolvedWorkDirectory, parentPath);
  let currentPath = resolvedWorkDirectory;
  for (const segment of relativeParent.split(sep).filter(Boolean)) {
    currentPath = resolve(currentPath, segment);
    const currentStat = await lstat(currentPath);
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
      throw new Error(`Attempt part parent must be a regular directory: ${currentPath}`);
    }
  }
  return resolvedPath;
}

async function removeExactPart(filePath, capability) {
  if (activeAttemptCapability !== capability) {
    throw new Error("Attempt cleanup requires the active render attempt capability");
  }
  const resolvedPath = assertAttemptPartPath(filePath, capability.token);
  if (activePartPaths.get(resolvedPath) !== capability) return false;
  try {
    await assertSafeAttemptPartParent(resolvedPath, capability.token);
    const fileStat = await lstat(resolvedPath);
    if (fileStat.isSymbolicLink()) {
      throw new Error(`Refusing to remove symlink part: ${resolvedPath}`);
    }
    if (fileStat.isDirectory()) await rm(resolvedPath, {recursive: true});
    else if (fileStat.isFile()) await unlink(resolvedPath);
    else throw new Error(`Refusing to remove non-file part: ${resolvedPath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  } finally {
    unregisterActivePart(resolvedPath, capability.token);
  }
  return true;
}

async function cleanupActiveParts(capability) {
  if (activeAttemptCapability !== capability) {
    throw new Error("Attempt cleanup requires the active render attempt capability");
  }
  for (const [partPath, ownerToken] of [...activePartPaths]) {
    if (ownerToken !== capability) continue;
    await removeExactPart(partPath, capability);
  }
}

async function closeTrackedBrowser(browser) {
  if (!activeBrowsers.delete(browser)) return;
  await browser.close({silent: true});
}

function deactivateAttempt(capability) {
  if (activeAttemptCapability !== capability) {
    throw new Error("Cannot deactivate a different render attempt");
  }
  activeAttemptCapability = null;
}

async function terminate(signal) {
  if (terminating) return;
  terminating = true;
  terminationSignal = signal;
  for (const cancel of activeCancellations) cancel();
  if (activeWorker && !activeWorker.killed) activeWorker.kill(signal);
  const browserClosures = [...activeBrowsers].map(async (browser) => {
    try {
      await closeTrackedBrowser(browser);
    } catch (error) {
      process.stderr.write(`browser cleanup failed: ${error.stack ?? error}\n`);
    }
  });
  await Promise.all(browserClosures);
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  if (
    activeCancellations.size === 0 &&
    activeWorker === null &&
    activeBrowsers.size === 0 &&
    !browserOpening
  ) {
    try {
      if (activeAttemptCapability) await cleanupActiveParts(activeAttemptCapability);
    } catch (error) {
      process.stderr.write(`part cleanup failed: ${error.stack ?? error}\n`);
    } finally {
      process.exit(process.exitCode);
    }
  }
}

export function assertLongReviewFromSurfaceEnvironment(environment = process.env) {
  if (environment.DISABLE_FROM_SURFACE) {
    throw new Error(
      "DISABLE_FROM_SURFACE is incompatible with the immutable from-surface render contract",
    );
  }
}

function installSignalHandlers() {
  process.once("SIGINT", () => void terminate("SIGINT"));
  process.once("SIGTERM", () => void terminate("SIGTERM"));
}

async function writeJsonAtomically(filePath, value, partPath, attemptToken) {
  await assertAbsent(partPath, workspaceRelative(partPath));
  registerActivePart(partPath, attemptToken);
  await writeFile(partPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await assertAbsent(filePath, workspaceRelative(filePath));
  await rename(partPath, filePath);
  unregisterActivePart(partPath, attemptToken);
}

async function callBundledTool(bin, args, logPath = null) {
  const {cancel, cancelSignal} = makeCancelSignal();
  activeCancellations.add(cancel);
  try {
    const result = await RenderInternals.callFf({
      bin,
      args,
      indent: false,
      logLevel: "warn",
      binariesDirectory: null,
      cancelSignal,
      options: {stdout: "pipe", stderr: "pipe"},
    });
    if (logPath) {
      await appendFile(
        logPath,
        `$ ${bin} ${args.join(" ")}\n${result.stderr ?? ""}\n`,
        "utf8",
      );
    }
    return result;
  } catch (error) {
    if (logPath) {
      await appendFile(
        logPath,
        `$ ${bin} ${args.join(" ")}\n${error?.stderr ?? error?.message ?? error}\n`,
        "utf8",
      );
    }
    throw error;
  } finally {
    activeCancellations.delete(cancel);
  }
}

export async function probeMedia(filePath, logPath = null) {
  const {stdout} = await callBundledTool(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-show_entries",
      "format=format_name,start_time,duration,size:stream=index,codec_type,codec_name,codec_long_name,profile,codec_tag_string,codec_tag,width,height,coded_width,coded_height,has_b_frames,pix_fmt,level,color_range,color_space,color_transfer,color_primaries,chroma_location,field_order,refs,is_avc,nal_length_size,bits_per_raw_sample,r_frame_rate,avg_frame_rate,time_base,start_time,duration,nb_frames,nb_read_frames,sample_rate,channels,channel_layout",
      "-of",
      "json",
      filePath,
    ],
    logPath,
  );
  return JSON.parse(stdout);
}

function assertValidation(label, validation) {
  if (validation.valid) return;
  const failures = Object.entries(validation.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  throw new Error(`${label} failed media validation: ${failures.join(", ")}`);
}

async function captureRuntimeContext(renderConfig) {
  const [source, git, voice, chrome] = await Promise.all([
    fingerprintPaths(SOURCE_INPUTS, {baseDirectory: WORKSPACE_ROOT}),
    captureGitIdentity(),
    inspectFile(VOICE_PATH),
    captureLocalChromeIdentity(),
  ]);
  const {
    defaultInterChunkPauseMs: _defaultInterChunkPauseMs,
    ...mediaContract
  } = CHUNKED_V004_CONTRACT;
  const context = {
    contract: mediaContract,
    renderConfig: {chunkFrames: renderConfig.chunkFrames},
    ...(CONFIGURED_RENDER_JOB
      ? {
          renderJob: {
            schemaVersion: CONFIGURED_RENDER_JOB.schemaVersion,
            jobId: CONFIGURED_RENDER_JOB.jobId,
            candidateVersion: CONFIGURED_RENDER_JOB.candidateVersion,
            paths: CONFIGURED_RENDER_JOB.paths,
            temporaryVoice: CONFIGURED_RENDER_JOB.temporaryVoice,
            temporaryVoiceIsFinalHumanRecording:
              CONFIGURED_RENDER_JOB.temporaryVoiceIsFinalHumanRecording,
          },
        }
      : {}),
    source,
    git,
    runtime: {
      node: {
        executable: process.execPath,
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      chrome,
    },
    voice: {
      path: workspaceRelative(VOICE_PATH),
      ...voice,
    },
  };
  return {
    ...context,
    scheduleConfig: {interChunkPauseMs: renderConfig.interChunkPauseMs},
    runtimeFingerprint: sha256Text(stableStringify(context)),
  };
}

async function captureConfiguredProtectedArtifacts() {
  const records = [];
  for (const artifact of CONFIGURED_RENDER_JOB.protectedArtifacts) {
    const integrity = await inspectFile(artifact.path);
    if (
      integrity.bytes !== artifact.bytes ||
      integrity.sha256 !== artifact.sha256
    ) {
      throw new Error(
        `Protected render artifact changed: ${workspaceRelative(artifact.path)}`,
      );
    }
    records.push({
      path: workspaceRelative(artifact.path),
      ...integrity,
    });
  }
  return records;
}

async function captureBaseContext(renderConfig) {
  if (CONFIGURED_RENDER_JOB) {
    const [runtime, protectedArtifacts] = await Promise.all([
      captureRuntimeContext(renderConfig),
      captureConfiguredProtectedArtifacts(),
    ]);
    const {scheduleConfig, ...runtimeMedia} = runtime;
    const context = {
      ...runtimeMedia,
      safety: {protectedArtifacts},
    };
    return {
      ...context,
      scheduleConfig,
      inputFingerprint: sha256Text(stableStringify(context)),
    };
  }
  const [runtime, protectedBaselines, reviewInputs] = await Promise.all([
    captureRuntimeContext(renderConfig),
    captureWideV004ProtectedBaselines(),
    captureWideV004ReviewInputs(),
  ]);
  const changedPathsFromV003 = assertWideV004InputsChanged(reviewInputs);
  const {scheduleConfig, ...runtimeMedia} = runtime;
  const context = {
    ...runtimeMedia,
    safety: {
      protectedBaselines,
      reviewInputs,
      changedPathsFromV003,
    },
  };
  return {
    ...context,
    scheduleConfig,
    inputFingerprint: sha256Text(stableStringify(context)),
  };
}

async function assertLocalChrome() {
  const chromeStat = await lstat(CHROME_EXECUTABLE);
  if (!chromeStat.isFile() || chromeStat.isSymbolicLink()) {
    throw new Error("The configured local Chrome executable is not a regular file");
  }
  await access(CHROME_EXECUTABLE, fsConstants.R_OK | fsConstants.X_OK);
}

async function captureLocalChromeIdentity() {
  await assertLocalChrome();
  const details = await lstat(CHROME_EXECUTABLE);
  const {stdout, stderr} = await execFileAsync(CHROME_EXECUTABLE, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  const version = `${stdout ?? ""}${stderr ?? ""}`.trim();
  if (!version) throw new Error("Local Chrome did not report a version");
  return {
    path: CHROME_EXECUTABLE,
    version,
    bytes: details.size,
    modifiedAt: details.mtime.toISOString(),
  };
}

function assertLocalMediaDownload(src) {
  let url;
  try {
    url = new URL(src);
  } catch {
    throw new Error(`Render requested an unverifiable media URL: ${src}`);
  }
  if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname)) {
    throw new Error(`External media download is disabled: ${src}`);
  }
}

async function ensureBundle(baseContext, attemptToken) {
  const sentinelPath = resolve(BUNDLE_DIRECTORY, BUNDLE_CONTEXT_FILE);
  if (await pathExists(BUNDLE_DIRECTORY)) {
    const sentinel = JSON.parse(await readFile(sentinelPath, "utf8"));
    if (sentinel.runtimeFingerprint !== baseContext.runtimeFingerprint) {
      throw new Error(
        "Existing reusable bundle belongs to different source/git/voice/render settings",
      );
    }
  } else {
    const partDirectory = attemptScopedPartPath(`${BUNDLE_DIRECTORY}.part`, attemptToken);
    assertInside(WORK_DIRECTORY, partDirectory, "bundle part");
    await assertAbsent(partDirectory);
    registerActivePart(partDirectory, attemptToken);
    await bundle({
      entryPoint: ENTRY_POINT,
      publicDir: PUBLIC_ROOT,
      outDir: partDirectory,
      symlinkPublicDir: false,
      onProgress: (progress) => {
        const percent = Math.floor(progress);
        if (percent % 20 === 0) process.stdout.write(`bundle ${percent}%\n`);
      },
    });
    await writeFile(
      resolve(partDirectory, BUNDLE_CONTEXT_FILE),
      `${JSON.stringify(
        {
          schemaVersion: CHUNKED_V004_CONTRACT.schemaVersion,
          runtimeFingerprint: baseContext.runtimeFingerprint,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await rename(partDirectory, BUNDLE_DIRECTORY);
    unregisterActivePart(partDirectory, attemptToken);
  }
  return fingerprintPaths([BUNDLE_DIRECTORY], {
    baseDirectory: BUNDLE_DIRECTORY,
    includeFiles: false,
  });
}

async function mediaToolIdentity() {
  const [ffmpeg, ffprobe] = await Promise.all([
    callBundledTool("ffmpeg", ["-version"]),
    callBundledTool("ffprobe", ["-version"]),
  ]);
  const firstLine = (value) => value.split(/\r?\n/u)[0] ?? "";
  return {
    source: "@remotion/renderer RenderInternals.callFf",
    ffmpeg: firstLine(ffmpeg.stdout),
    ffprobe: firstLine(ffprobe.stdout),
    versionsSha256: sha256Text(`${ffmpeg.stdout}\0${ffprobe.stdout}`),
  };
}

async function loadOrCreateRunManifest(renderConfig, attemptToken) {
  const baseContext = await captureBaseContext(renderConfig);
  const bundleFingerprint = await ensureBundle(baseContext, attemptToken);
  const tools = await mediaToolIdentity();
  const ranges = buildChunkRanges({chunkFrames: renderConfig.chunkFrames});
  const {scheduleConfig, ...immutableBaseContext} = baseContext;
  const fingerprintPayload = {
    ...immutableBaseContext,
    bundle: bundleFingerprint,
    tools,
    ranges,
  };
  const runFingerprint = sha256Text(stableStringify(fingerprintPayload));
  const expected = {
    schemaVersion: CHUNKED_V004_CONTRACT.schemaVersion,
    createdAt: new Date().toISOString(),
    runFingerprint,
    ...fingerprintPayload,
    scheduleConfig,
    paths: {
      workDirectory: workspaceRelative(WORK_DIRECTORY),
      chunksDirectory: workspaceRelative(CHUNKS_DIRECTORY),
      stagingDirectory: workspaceRelative(STAGING_DIRECTORY),
      logsDirectory: workspaceRelative(LOGS_DIRECTORY),
      finalDirectory: workspaceRelative(FINAL_DIRECTORY),
      finalOutput: workspaceRelative(FINAL_OUTPUT_PATH),
    },
    codecParameters: {
      chunkRender: {
        codec: CHUNKED_V004_CONTRACT.codec,
        pixelFormat: CHUNKED_V004_CONTRACT.pixelFormat,
        crf: CHUNKED_V004_CONTRACT.crf,
        concurrency: 1,
        muted: true,
        enforceAudioTrack: false,
      },
      concat: {demuxer: "concat", videoCodec: "copy", audio: "none"},
      mux: {
        videoCodec: "copy",
        audioCodec: "aac",
        audioBitrate: "192k",
        audioSampleRate: 48_000,
        audioFilter:
          "aresample=48000,apad=whole_len=28800000,atrim=end_sample=28800000,asetpts=N/SR/TB",
        durationSeconds: 600,
        movflags: "+faststart",
      },
    },
  };
  if (await pathExists(RUN_MANIFEST_PATH)) {
    const existing = JSON.parse(await readFile(RUN_MANIFEST_PATH, "utf8"));
    return assertResumableRunManifest(existing, expected);
  }
  await writeJsonAtomically(
    RUN_MANIFEST_PATH,
    expected,
    attemptScopedPartPath(`${RUN_MANIFEST_PATH}.part`, attemptToken),
    attemptToken,
  );
  return expected;
}

async function assertManifestStillCurrent(manifest) {
  const current = await captureRuntimeContext(manifest.renderConfig);
  if (current.runtimeFingerprint !== manifest.runtimeFingerprint) {
    throw new Error("Source, Git status, voice, or render settings changed during the run");
  }
  const bundleFingerprint = await fingerprintPaths([BUNDLE_DIRECTORY], {
    baseDirectory: BUNDLE_DIRECTORY,
    includeFiles: false,
  });
  if (bundleFingerprint.sha256 !== manifest.bundle.sha256) {
    throw new Error("Reusable bundle hash changed during the run");
  }
}

async function assertSafetyStillCurrent(manifest) {
  if (CONFIGURED_RENDER_JOB) {
    const protectedArtifacts = await captureConfiguredProtectedArtifacts();
    if (
      stableStringify(protectedArtifacts) !==
      stableStringify(manifest.safety.protectedArtifacts)
    ) {
      throw new Error("Protected render artifacts changed during the run");
    }
    return;
  }
  const [protectedBaselines, reviewInputs] = await Promise.all([
    captureWideV004ProtectedBaselines(),
    captureWideV004ReviewInputs(),
  ]);
  assertWideV004SnapshotsUnchanged(
    "Protected episode, voice, v001-v003 candidates, and formal previews",
    manifest.safety.protectedBaselines,
    protectedBaselines,
  );
  assertWideV004SnapshotsUnchanged(
    "v004 review inputs",
    manifest.safety.reviewInputs,
    reviewInputs,
  );
  assertWideV004InputsChanged(reviewInputs);
}

async function preserveStale(paths, label) {
  const staleDirectory = resolve(STAGING_DIRECTORY, "stale");
  await mkdir(staleDirectory, {recursive: true});
  for (const filePath of paths) {
    if (!(await pathExists(filePath))) continue;
    await assertPlainFile(filePath);
    const suffix = `${Date.now()}-${process.pid}`;
    const destination = resolve(
      staleDirectory,
      `${basename(filePath)}.${label}.${suffix}`,
    );
    await rename(filePath, destination);
  }
}

async function inspectChunkForResume(
  manifest,
  range,
  expectedCodecMetadata,
) {
  const paths = chunkPaths(range);
  if (!(await pathExists(paths.output)) || !(await pathExists(paths.metadata))) {
    return {eligible: false, paths};
  }
  try {
    const [record, integrity, rawProbe] = await Promise.all([
      readFile(paths.metadata, "utf8").then(JSON.parse),
      inspectFile(paths.output),
      probeMedia(paths.output, paths.log),
    ]);
    const validation = evaluateChunkProbe(
      rawProbe,
      range,
      expectedCodecMetadata,
    );
    return {
      eligible: isChunkResumeEligible({
        record,
        runFingerprint: manifest.runFingerprint,
        range,
        integrity,
        validation,
        expectedCodecMetadata,
        chunkFrames: manifest.renderConfig.chunkFrames,
      }),
      paths,
      record,
      integrity,
      validation,
    };
  } catch (error) {
    return {eligible: false, paths, error};
  }
}

function buildChunkRecord(manifest, range, integrity, validation) {
  return {
    schemaVersion: CHUNK_RECORD_SCHEMA_VERSION,
    runFingerprint: manifest.runFingerprint,
    chunkFrames: manifest.renderConfig.chunkFrames,
    range,
    file: {
      path: workspaceRelative(chunkPaths(range).output),
      ...integrity,
    },
    probeSha256: validation.probeSha256,
    codecMetadata: validation.media.codecMetadata,
    media: {
      durationSeconds: validation.media.durationSeconds,
      frameCount: validation.media.frameCount,
      fps: validation.media.fps,
      width: validation.media.video.width,
      height: validation.media.video.height,
      codec: validation.media.video.codec_name,
      pixelFormat: validation.media.video.pix_fmt,
      audioStreamCount: validation.media.audioStreamCount,
    },
    validatedAt: new Date().toISOString(),
  };
}

async function runChunkWorker(
  manifest,
  range,
  expectedCodecMetadata,
  attemptToken,
  jobLock,
) {
  const paths = chunkPaths(range, attemptToken);
  await preserveStale(
    [paths.output, paths.metadata],
    "not-resumable",
  );
  await assertAbsent(paths.part, workspaceRelative(paths.part));
  await assertAbsent(paths.metadataPart, workspaceRelative(paths.metadataPart));
  registerActivePart(paths.part, attemptToken);
  registerActivePart(paths.metadataPart, attemptToken);
  const codecArgument = expectedCodecMetadata
    ? Buffer.from(JSON.stringify(expectedCodecMetadata)).toString("base64url")
    : "none";
  const rawManifest = await readFile(RUN_MANIFEST_PATH);
  const currentManifest = JSON.parse(rawManifest.toString("utf8"));
  if (stableStringify(currentManifest) !== stableStringify(manifest)) {
    throw new Error("Immutable run manifest changed before worker dispatch");
  }
  const manifestSha256 = sha256Text(rawManifest);
  const logHandle = await open(paths.log, "a");
  let child = null;
  try {
    await appendFile(
      paths.log,
      `\n=== worker start ${new Date().toISOString()} range ${range.start}-${range.end} ===\n`,
      "utf8",
    );
    child = spawn(
      process.execPath,
      [
        SCRIPT_PATH,
        "--worker",
        "--manifest",
        RUN_MANIFEST_PATH,
        "--expected-manifest-sha256",
        manifestSha256,
        "--chunk-index",
        String(range.index),
        "--chunk-frames",
        String(manifest.renderConfig.chunkFrames),
        "--expected-codec-base64",
        codecArgument,
        "--attempt-token",
        attemptToken,
      ],
      {
        cwd: STUDIO_ROOT,
        stdio: ["ignore", logHandle.fd, logHandle.fd, "ipc"],
      },
    );
    activeWorker = child;
    const exitPromise = new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) reject(new Error(`Chunk worker stopped by ${signal}`));
        else resolveExit(code);
      });
    });
    const bindingPromise = new Promise((resolveBinding, rejectBinding) => {
      child.send(
        {
          protocol: LONG_REVIEW_RENDER_PARENT_BINDING_PROTOCOL,
          attemptToken,
        },
        (error) => error ? rejectBinding(error) : resolveBinding(),
      );
    });
    const [exitCode] = await Promise.all([exitPromise, bindingPromise]);
    if (exitCode !== 0) {
      throw new Error(
        `Chunk ${range.index} worker exited with ${exitCode}; see ${workspaceRelative(paths.log)}`,
      );
    }
    jobLock.assertOwned();
    await assertManifestStillCurrent(manifest);
    const rawProbe = await probeMedia(paths.part, paths.log);
    const validation = evaluateChunkProbe(
      rawProbe,
      range,
      expectedCodecMetadata,
    );
    assertValidation(`Chunk ${range.index}`, validation);
    const integrity = await inspectFile(paths.part);
    const record = buildChunkRecord(manifest, range, integrity, validation);
    await writeFile(paths.metadataPart, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    jobLock.assertOwned();
    await jobLock.publishAttemptPair({
      attemptToken,
      videoPartPath: paths.part,
      videoPath: paths.output,
      metadataPartPath: paths.metadataPart,
      metadataPath: paths.metadata,
    });
    unregisterActivePart(paths.part, attemptToken);
    unregisterActivePart(paths.metadataPart, attemptToken);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    activeWorker = null;
    await logHandle.close();
  }
}

async function renderChunkWorker(options) {
  if (!options.manifestPath || options.chunkIndex === null) {
    throw new Error("Worker mode requires --manifest and --chunk-index");
  }
  if (resolve(options.manifestPath) !== RUN_MANIFEST_PATH) {
    throw new Error("Worker --manifest must match the configured immutable run manifest");
  }
  await assertPlainFile(RUN_MANIFEST_PATH, "worker run manifest");
  if (!HASH_PATTERN.test(options.expectedManifestSha256 ?? "")) {
    throw new Error("Worker mode requires --expected-manifest-sha256");
  }
  const attemptToken = assertAttemptToken(options.attemptToken);
  const attemptCapability = activateAttempt(attemptToken);
  const parentBinding = bindLongReviewRenderWorkerToParent({
    attemptToken,
    handshakeTimeoutMs: 30_000,
    onParentLost() {
      terminating = true;
      terminationSignal = "PARENT_DISCONNECT";
      for (const cancel of activeCancellations) cancel();
    },
  });
  try {
    await parentBinding.ready;
    parentBinding.assertConnected();
    return await renderBoundChunkWorker(options, attemptToken, parentBinding);
  } finally {
    parentBinding.dispose();
    if (process.connected) process.disconnect();
    try {
      await cleanupActiveParts(attemptCapability);
    } finally {
      deactivateAttempt(attemptCapability);
    }
  }
}

async function renderBoundChunkWorker(options, attemptToken, parentBinding) {
  assertLongReviewFromSurfaceEnvironment();
  const rawManifest = await readFile(RUN_MANIFEST_PATH);
  if (sha256Text(rawManifest) !== options.expectedManifestSha256) {
    throw new Error("Worker run manifest changed after parent validation");
  }
  const manifest = JSON.parse(rawManifest.toString("utf8"));
  if (
    manifest.renderConfig?.chunkFrames !== options.chunkFrames
  ) {
    throw new Error("Worker CLI settings do not match the immutable run manifest");
  }
  const range = manifest.ranges?.[options.chunkIndex];
  if (!range) throw new Error(`Unknown chunk index ${options.chunkIndex}`);
  const expectedCodecMetadata =
    options.expectedCodecBase64 && options.expectedCodecBase64 !== "none"
      ? JSON.parse(
          Buffer.from(options.expectedCodecBase64, "base64url").toString("utf8"),
        )
      : null;
  const paths = chunkPaths(range, attemptToken);
  assertInside(CHUNKS_DIRECTORY, paths.part, "chunk part");
  registerActivePart(paths.part, attemptToken);
  installSignalHandlers();
  await assertManifestStillCurrent(manifest);
  await assertLocalChrome();
  await assertAbsent(paths.part);
  parentBinding.assertConnected();

  const episode = JSON.parse(await readFile(EPISODE_PATH, "utf8"));
  const inputProps = {episode};
  browserOpening = true;
  let browser;
  try {
    browser = await openBrowser("chrome", {
      browserExecutable: CHROME_EXECUTABLE,
      chromeMode: "chrome-for-testing",
      chromiumOptions: CHUNKED_CHROMIUM_OPTIONS,
      logLevel: "warn",
    });
    activeBrowsers.add(browser);
  } finally {
    browserOpening = false;
  }
  try {
    if (terminating) {
      throw new Error(`Render worker interrupted by ${terminationSignal ?? "signal"}`);
    }
    const composition = await selectComposition({
      serveUrl: BUNDLE_DIRECTORY,
      id: CHUNKED_V004_CONTRACT.compositionId,
      inputProps,
      browserExecutable: CHROME_EXECUTABLE,
      chromeMode: "chrome-for-testing",
      chromiumOptions: CHUNKED_CHROMIUM_OPTIONS,
      puppeteerInstance: browser,
      timeoutInMilliseconds: CHUNKED_REMOTION_TIMEOUT_MS,
      onBrowserDownload: () => {
        throw new Error("Browser download is disabled; local Chrome is required");
      },
      logLevel: "warn",
    });
    const compositionContract = {
      id: composition.id,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      durationInFrames: composition.durationInFrames,
    };
    const expectedComposition = {
      id: CHUNKED_V004_CONTRACT.compositionId,
      width: CHUNKED_V004_CONTRACT.width,
      height: CHUNKED_V004_CONTRACT.height,
      fps: CHUNKED_V004_CONTRACT.fps,
      durationInFrames: CHUNKED_V004_CONTRACT.durationInFrames,
    };
    if (stableStringify(compositionContract) !== stableStringify(expectedComposition)) {
      throw new Error(`Composition contract changed: ${JSON.stringify(compositionContract)}`);
    }

    const {cancel, cancelSignal} = makeCancelSignal();
    activeCancellations.add(cancel);
    try {
      parentBinding.assertConnected();
      await renderMedia({
        composition,
        serveUrl: BUNDLE_DIRECTORY,
        outputLocation: paths.part,
        inputProps,
        browserExecutable: CHROME_EXECUTABLE,
        chromeMode: "chrome-for-testing",
        chromiumOptions: CHUNKED_CHROMIUM_OPTIONS,
        puppeteerInstance: browser,
        timeoutInMilliseconds: CHUNKED_REMOTION_TIMEOUT_MS,
        onBrowserDownload: () => {
          throw new Error("Browser download is disabled; local Chrome is required");
        },
        codec: "h264",
        pixelFormat: "yuv420p",
        crf: CHUNKED_V004_CONTRACT.crf,
        concurrency: 1,
        frameRange: [range.start, range.end],
        imageFormat: "png",
        hardwareAcceleration: "disable",
        muted: true,
        enforceAudioTrack: false,
        onDownload: assertLocalMediaDownload,
        overwrite: false,
        logLevel: "warn",
        cancelSignal,
      });
    } finally {
      activeCancellations.delete(cancel);
    }
  } finally {
    await closeTrackedBrowser(browser);
  }

  parentBinding.assertConnected();
  const rawProbe = await probeMedia(paths.part, paths.log);
  const validation = evaluateChunkProbe(
    rawProbe,
    range,
    expectedCodecMetadata,
  );
  assertValidation(`Chunk ${range.index}`, validation);
  await inspectFile(paths.part);
  parentBinding.assertConnected();
  unregisterActivePart(paths.part, attemptToken);
}

function concatEscape(filePath) {
  return filePath.replaceAll("'", "'\\''");
}

export function buildConcatFfmpegArgs(concatListPath, outputPartPath) {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-map",
    "0:v:0",
    "-c:v",
    "copy",
    "-an",
    "-n",
    outputPartPath,
  ];
}

export function buildMuxFfmpegArgs(videoPath, voicePath, outputPartPath) {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-i",
    videoPath,
    "-i",
    voicePath,
    "-filter_complex",
    "[1:a:0]aresample=48000,apad=whole_len=28800000,atrim=end_sample=28800000,asetpts=N/SR/TB[a]",
    "-map",
    "0:v:0",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    "-t",
    "600",
    "-n",
    outputPartPath,
  ];
}

async function prepareConcatenatedVideo(
  manifest,
  chunkRecords,
  codecMetadata,
  attemptToken,
) {
  const listPath = resolve(STAGING_DIRECTORY, "chunks.concat.txt");
  const listPartPath = attemptScopedPartPath(
    resolve(STAGING_DIRECTORY, "chunks.concat.part.txt"),
    attemptToken,
  );
  const outputPath = resolve(STAGING_DIRECTORY, "video-concat.mp4");
  const outputPartPath = attemptScopedPartPath(
    resolve(STAGING_DIRECTORY, "video-concat.part.mp4"),
    attemptToken,
  );
  const recordPath = resolve(STAGING_DIRECTORY, "video-concat.metadata.json");
  const orderedHash = sha256Text(
    stableStringify(chunkRecords.map((record) => record.file.sha256)),
  );

  if ((await pathExists(outputPath)) && (await pathExists(recordPath))) {
    try {
      const [record, integrity, rawProbe] = await Promise.all([
        readFile(recordPath, "utf8").then(JSON.parse),
        inspectFile(outputPath),
        probeMedia(outputPath, resolve(LOGS_DIRECTORY, "concat.log")),
      ]);
      const validation = evaluateConcatenatedProbe(rawProbe);
      if (
        validation.valid &&
        record.schemaVersion === CONCAT_RECORD_SCHEMA_VERSION &&
        record.runFingerprint === manifest.runFingerprint &&
        record.orderedChunkSha256 === orderedHash &&
        record.file.sha256 === integrity.sha256 &&
        record.file.bytes === integrity.bytes &&
        record.probeSha256 === validation.probeSha256 &&
        sameCodecMetadata(validation.media.codecMetadata, codecMetadata)
      ) {
        return {path: outputPath, integrity, validation, record};
      }
    } catch {
      // Preserve the invalid staging artifact below and rebuild it.
    }
  }
  await preserveStale(
    [listPath, listPartPath, outputPath, outputPartPath, recordPath],
    "concat-invalid",
  );
  const listContents = `${manifest.ranges
    .map((range) => `file '${concatEscape(chunkPaths(range).output)}'`)
    .join("\n")}\n`;
  registerActivePart(listPartPath, attemptToken);
  await writeFile(listPartPath, listContents, {encoding: "utf8", flag: "wx"});
  await rename(listPartPath, listPath);
  unregisterActivePart(listPartPath, attemptToken);
  registerActivePart(outputPartPath, attemptToken);
  await callBundledTool(
    "ffmpeg",
    buildConcatFfmpegArgs(listPath, outputPartPath),
    resolve(LOGS_DIRECTORY, "concat.log"),
  );
  const [integrity, rawProbe] = await Promise.all([
    inspectFile(outputPartPath),
    probeMedia(outputPartPath, resolve(LOGS_DIRECTORY, "concat.log")),
  ]);
  const validation = evaluateConcatenatedProbe(rawProbe);
  assertValidation("Concatenated video", validation);
  if (!sameCodecMetadata(validation.media.codecMetadata, codecMetadata)) {
    throw new Error("Concatenation changed H.264 codec metadata");
  }
  await rename(outputPartPath, outputPath);
  unregisterActivePart(outputPartPath, attemptToken);
  const record = {
    schemaVersion: CONCAT_RECORD_SCHEMA_VERSION,
    runFingerprint: manifest.runFingerprint,
    orderedChunkSha256: orderedHash,
    file: {path: workspaceRelative(outputPath), ...integrity},
    probeSha256: validation.probeSha256,
    codecMetadata: validation.media.codecMetadata,
    validatedAt: new Date().toISOString(),
  };
  await writeJsonAtomically(
    recordPath,
    record,
    attemptScopedPartPath(`${recordPath}.part`, attemptToken),
    attemptToken,
  );
  return {path: outputPath, integrity, validation, record};
}

async function prepareMuxedVideo(manifest, concatenated, codecMetadata, attemptToken) {
  const outputPath = resolve(STAGING_DIRECTORY, "review-10m.validated.mp4");
  const outputPartPath = attemptScopedPartPath(
    resolve(STAGING_DIRECTORY, "review-10m.part.mp4"),
    attemptToken,
  );
  const recordPath = resolve(STAGING_DIRECTORY, "review-10m.metadata.json");
  if ((await pathExists(outputPath)) && (await pathExists(recordPath))) {
    try {
      const [record, integrity, rawProbe] = await Promise.all([
        readFile(recordPath, "utf8").then(JSON.parse),
        inspectFile(outputPath),
        probeMedia(outputPath, resolve(LOGS_DIRECTORY, "mux.log")),
      ]);
      const validation = evaluateFinalProbe(rawProbe, codecMetadata);
      if (
        validation.valid &&
        record.schemaVersion === FINAL_MEDIA_RECORD_SCHEMA_VERSION &&
        record.runFingerprint === manifest.runFingerprint &&
        record.concatSha256 === concatenated.integrity.sha256 &&
        record.voiceSha256 === manifest.voice.sha256 &&
        record.file.sha256 === integrity.sha256 &&
        record.file.bytes === integrity.bytes &&
        record.probeSha256 === validation.probeSha256
      ) {
        return {path: outputPath, integrity, validation, record};
      }
    } catch {
      // Preserve the invalid staging artifact below and rebuild it.
    }
  }
  await preserveStale(
    [outputPath, outputPartPath, recordPath],
    "mux-invalid",
  );
  registerActivePart(outputPartPath, attemptToken);
  await callBundledTool(
    "ffmpeg",
    buildMuxFfmpegArgs(concatenated.path, VOICE_PATH, outputPartPath),
    resolve(LOGS_DIRECTORY, "mux.log"),
  );
  const [integrity, rawProbe] = await Promise.all([
    inspectFile(outputPartPath),
    probeMedia(outputPartPath, resolve(LOGS_DIRECTORY, "mux.log")),
  ]);
  const validation = evaluateFinalProbe(rawProbe, codecMetadata);
  assertValidation("Final muxed video", validation);
  await rename(outputPartPath, outputPath);
  unregisterActivePart(outputPartPath, attemptToken);
  const record = {
    schemaVersion: FINAL_MEDIA_RECORD_SCHEMA_VERSION,
    runFingerprint: manifest.runFingerprint,
    concatSha256: concatenated.integrity.sha256,
    voiceSha256: manifest.voice.sha256,
    file: {path: workspaceRelative(outputPath), ...integrity},
    probeSha256: validation.probeSha256,
    codecMetadata: validation.media.codecMetadata,
    audio: {codec: "aac", sampleRate: 48_000, bitrate: "192k"},
    validatedAt: new Date().toISOString(),
  };
  await writeJsonAtomically(
    recordPath,
    record,
    attemptScopedPartPath(`${recordPath}.part`, attemptToken),
    attemptToken,
  );
  return {path: outputPath, integrity, validation, record};
}

function publicationJobBinding(manifest) {
  return {
    finalManifestSchemaVersion: manifest?.schemaVersion ?? null,
    runFingerprint: manifest?.runFingerprint ?? null,
    jobId: manifest?.renderJob?.jobId ?? manifest?.contract?.jobId ?? null,
    candidateVersion:
      manifest?.renderJob?.candidateVersion ?? manifest?.contract?.candidateVersion ?? null,
    episodeId: manifest?.contract?.episodeId ?? null,
    compositionId: manifest?.contract?.compositionId ?? null,
  };
}

function publicationIdentity({manifest, manifestBytes, integrity, attemptToken}) {
  const jobBinding = publicationJobBinding(manifest);
  return {
    attemptToken: assertAttemptToken(attemptToken),
    output: {
      fileName: CHUNKED_V004_CONTRACT.outputFileName,
      bytes: integrity.bytes,
      sha256: integrity.sha256,
    },
    manifest: {
      fileName: "review-manifest.json",
      sha256: sha256Text(manifestBytes),
    },
    jobBinding,
    jobBindingSha256: sha256Text(stableStringify(jobBinding)),
  };
}

function publicationMarker(kind, identity, timestamp = new Date().toISOString()) {
  return {
    schemaVersion: PUBLICATION_STATE_SCHEMA_VERSION,
    kind,
    ...identity,
    recordedAt: timestamp,
  };
}

async function readStableJsonIfPresent(filePath, label) {
  const contents = await readStablePlainFileIfPresent(filePath, label);
  if (contents === null) return null;
  return JSON.parse(contents.toString("utf8"));
}

function markerMatchesPublication(marker, kind, identity) {
  const binding = identity.jobBinding;
  const validJobBinding = Boolean(
    binding?.finalManifestSchemaVersion === FINAL_MANIFEST_SCHEMA_VERSION &&
      HASH_PATTERN.test(binding?.runFingerprint ?? "") &&
      binding?.jobId === CHUNKED_V004_CONTRACT.jobId &&
      binding?.candidateVersion === CHUNKED_V004_CONTRACT.candidateVersion &&
      binding?.episodeId === CHUNKED_V004_CONTRACT.episodeId &&
      binding?.compositionId === CHUNKED_V004_CONTRACT.compositionId
  );
  return Boolean(
    validJobBinding &&
    marker?.schemaVersion === PUBLICATION_STATE_SCHEMA_VERSION &&
      marker?.kind === kind &&
      marker?.attemptToken === identity.attemptToken &&
      stableStringify(marker?.output) === stableStringify(identity.output) &&
      stableStringify(marker?.manifest) === stableStringify(identity.manifest) &&
      stableStringify(marker?.jobBinding) === stableStringify(identity.jobBinding) &&
      marker?.jobBindingSha256 === identity.jobBindingSha256 &&
      marker?.jobBindingSha256 ===
        sha256Text(stableStringify(marker?.jobBinding ?? null)) &&
      !Number.isNaN(Date.parse(marker?.recordedAt ?? ""))
  );
}

export async function inspectLongReviewPublication(finalDirectory) {
  if (arguments.length !== 1) {
    throw new TypeError("inspectLongReviewPublication accepts only a final-directory path");
  }
  const resolvedFinalDirectory = resolve(finalDirectory);
  if (!(await pathExists(resolvedFinalDirectory))) {
    return {exists: false, valid: false, recoverable: false};
  }
  const finalDirectoryStat = await lstat(resolvedFinalDirectory, {bigint: true});
  if (!finalDirectoryStat.isDirectory() || finalDirectoryStat.isSymbolicLink()) {
    return {
      exists: true,
      valid: false,
      recoverable: false,
      error: {code: "publication_directory_unsafe", message: "Publication is not a plain directory"},
    };
  }
  const outputPath = resolve(
    resolvedFinalDirectory,
    CHUNKED_V004_CONTRACT.outputFileName,
  );
  const manifestPath = resolve(resolvedFinalDirectory, "review-manifest.json");
  const pendingPath = resolve(resolvedFinalDirectory, PUBLICATION_PENDING_FILE_NAME);
  const receiptPath = resolve(resolvedFinalDirectory, PUBLICATION_RECEIPT_FILE_NAME);
  try {
    const [integrity, manifestBytes, pending, receipt] = await Promise.all([
      inspectFile(outputPath),
      readStablePlainFileIfPresent(manifestPath, "publication manifest"),
      readStableJsonIfPresent(pendingPath, "publication pending marker"),
      readStableJsonIfPresent(receiptPath, "publication durable receipt"),
    ]);
    if (manifestBytes === null) throw new Error("publication manifest is missing");
    const finalDirectoryAfter = await lstat(resolvedFinalDirectory, {bigint: true});
    if (
      finalDirectoryAfter.isSymbolicLink() ||
      !finalDirectoryAfter.isDirectory() ||
      !sameStableFileStat(finalDirectoryStat, finalDirectoryAfter)
    ) {
      throw new Error("publication directory changed while being inspected");
    }
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    const identityMarker = receipt ?? pending;
    if (!identityMarker) {
      return {
        exists: true,
        valid: false,
        recoverable: false,
        outputPath,
        manifestPath,
        pendingPath,
        receiptPath,
        error: {code: "publication_marker_missing", message: "Publication marker is missing"},
      };
    }
    const identity = publicationIdentity({
      manifest,
      manifestBytes,
      integrity,
      attemptToken: identityMarker.attemptToken,
    });
    const pendingValid = markerMatchesPublication(
      pending,
      "durability_unknown",
      identity,
    );
    const durableReceiptValid = markerMatchesPublication(
      receipt,
      "durable_receipt",
      identity,
    );
    const valid = pendingValid || durableReceiptValid;
    return {
      exists: true,
      valid,
      recoverable: valid && pendingValid,
      status: durableReceiptValid ? "durable_receipt_present" : "durability_unknown",
      pendingValid,
      durableReceiptValid,
      finalDirectory: resolvedFinalDirectory,
      outputPath,
      manifestPath,
      pendingPath,
      receiptPath,
      integrity,
      manifest,
      identity,
      ...(valid
        ? {}
        : {
            error: {
              code: "publication_binding_invalid",
              message: "Publication media, manifest, and marker binding do not match",
            },
          }),
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      recoverable: false,
      finalDirectory: resolvedFinalDirectory,
      outputPath,
      manifestPath,
      pendingPath,
      receiptPath,
      error: {
        code: error?.code ?? "publication_inspection_failed",
        message: error?.message ?? "Publication inspection failed",
      },
    };
  }
}

function durableReceiptPartPath(finalDirectory, attemptToken) {
  const resolvedFinalDirectory = resolve(finalDirectory);
  return attemptScopedPartPath(
    resolve(resolvedFinalDirectory, `${PUBLICATION_RECEIPT_FILE_NAME}.part`),
    attemptToken,
  );
}

async function removeDurableReceiptPart(finalDirectory, filePath, attemptToken) {
  const resolvedFinalDirectory = resolve(finalDirectory);
  const expectedPath = durableReceiptPartPath(resolvedFinalDirectory, attemptToken);
  const resolvedPath = resolve(filePath);
  if (resolvedPath !== expectedPath || dirname(resolvedPath) !== resolvedFinalDirectory) {
    throw new Error("Refusing to remove an unexpected durable receipt part path");
  }
  const finalDirectoryStat = await lstat(resolvedFinalDirectory);
  if (!finalDirectoryStat.isDirectory() || finalDirectoryStat.isSymbolicLink()) {
    throw new Error("Publication directory must be a regular, non-symlink directory");
  }
  try {
    const fileStat = await lstat(resolvedPath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error("Durable receipt part must be a regular, non-symlink file");
    }
    await unlink(resolvedPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function ensureDurablePublicationReceipt(
  inspection,
  {syncFile, syncDirectory},
) {
  const receipt = publicationMarker(
    "durable_receipt",
    inspection.identity,
  );
  if (await pathExists(inspection.receiptPath)) {
    const existing = await readStableJsonIfPresent(
      inspection.receiptPath,
      "publication durable receipt",
    );
    if (!markerMatchesPublication(existing, "durable_receipt", inspection.identity)) {
      throw new Error("Existing durable publication receipt does not match media and manifest");
    }
    await syncFile(inspection.receiptPath);
    await syncDirectory(inspection.finalDirectory);
    return {committed: true, cleanupWarnings: []};
  }

  const receiptAttemptToken = randomUUID();
  const receiptPartPath = durableReceiptPartPath(
    inspection.finalDirectory,
    receiptAttemptToken,
  );
  let linked = false;
  try {
    await writeFile(receiptPartPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await syncFile(receiptPartPath);
    await link(receiptPartPath, inspection.receiptPath);
    linked = true;
    await syncFile(inspection.receiptPath);
    await syncDirectory(inspection.finalDirectory);
    const cleanupWarnings = [];
    try {
      await unlink(receiptPartPath);
      await syncDirectory(inspection.finalDirectory);
    } catch (error) {
      cleanupWarnings.push({
        stage: "durable_receipt_part_cleanup",
        code: error?.code ?? "publication_receipt_part_cleanup_failed",
        message: error?.message ?? "Durable receipt part cleanup failed",
      });
    }
    return {committed: true, cleanupWarnings};
  } catch (error) {
    if (!linked) {
      await removeDurableReceiptPart(
        inspection.finalDirectory,
        receiptPartPath,
        receiptAttemptToken,
      ).catch(() => undefined);
    }
    throw error;
  }
}

function publicationResult(inspection, {durable, commitWarnings = []}) {
  return {
    finalDirectory: inspection.finalDirectory,
    outputPath: inspection.outputPath,
    integrity: inspection.integrity,
    commitStatus: commitWarnings.length > 0
      ? "committed_with_warnings"
      : "committed",
    commitWarnings,
    durability: {
      durable,
      status: durable ? "durable" : "durability_unknown",
      protocol: "positive-receipt-and-directory-fsync-v1",
      pendingPath: inspection.pendingPath,
      receiptPath: inspection.receiptPath,
    },
  };
}

function createLongReviewPublicationDurabilityUnknownError(publication) {
  const finalDirectory = publication?.finalDirectory ?? null;
  const outputPath = publication?.outputPath ?? null;
  const error = new Error(
    [
      LONG_REVIEW_PUBLICATION_DURABILITY_UNKNOWN,
      "the final directory rename committed, but a positive durable receipt was not confirmed",
      finalDirectory ? `finalDirectory=${finalDirectory}` : null,
      "inspect the existing publication read-only, then rerun the identical render command to confirm it in place; do not render, delete, or overwrite the committed media",
    ].filter(Boolean).join(": "),
  );
  error.name = "LongReviewPublicationDurabilityUnknownError";
  error.code = LONG_REVIEW_PUBLICATION_DURABILITY_UNKNOWN;
  error.committed = true;
  error.durable = false;
  error.finalDirectory = finalDirectory;
  error.outputPath = outputPath;
  error.commitWarnings = publication?.commitWarnings ?? [];
  error.recovery = Object.freeze({
    inspectionMode: "read_only",
    inspectionFunction: "inspectLongReviewPublication",
    confirmationMode: "confirm_existing_publication_in_place",
    instruction:
      "Rerun the identical render command. It must inspect and confirm the existing publication without rendering or overwriting media.",
    forbiddenActions: Object.freeze(["render", "overwrite", "delete"]),
  });
  return error;
}

function requireDurableLongReviewPublicationResult(publication) {
  if (publication?.durability?.durable === true) return publication;
  throw createLongReviewPublicationDurabilityUnknownError(publication);
}

export async function reportPublishedLongReviewPublication(finalDirectory) {
  if (arguments.length !== 1 || typeof finalDirectory !== "string" || !finalDirectory) {
    throw new TypeError(
      "reportPublishedLongReviewPublication requires exactly one final-directory path",
    );
  }
  const inspection = await inspectLongReviewPublication(finalDirectory);
  if (!inspection.valid || !inspection.durableReceiptValid) {
    throw createLongReviewPublicationDurabilityUnknownError({
      finalDirectory: resolve(finalDirectory),
      outputPath: inspection.outputPath ?? null,
      commitWarnings: inspection.error ? [inspection.error] : [],
    });
  }
  const durablePublication = publicationResult(inspection, {durable: true});
  process.stdout.write(
    `published ${workspaceRelative(durablePublication.outputPath)} (${durablePublication.integrity.sha256})\n`,
  );
  return durablePublication;
}

async function finishLongReviewPublication(
  publication,
  warningPrefix = "publication committed with warnings",
) {
  if (publication?.commitWarnings?.length > 0) {
    process.stderr.write(`${warningPrefix}: ${JSON.stringify(publication.commitWarnings)}\n`);
  }
  requireDurableLongReviewPublicationResult(publication);
  const verified = await reportPublishedLongReviewPublication(publication.finalDirectory);
  if (
    verified.outputPath !== publication.outputPath ||
    stableStringify(verified.integrity) !== stableStringify(publication.integrity)
  ) {
    throw createLongReviewPublicationDurabilityUnknownError(publication);
  }
  return {
    ...verified,
    commitStatus: publication.commitStatus,
    commitWarnings: publication.commitWarnings,
  };
}

export async function confirmLongReviewPublicationDurability(finalDirectory) {
  if (arguments.length !== 1) {
    throw new TypeError(
      "confirmLongReviewPublicationDurability does not accept dependency injection",
    );
  }
  const syncFile = syncLongReviewRenderFile;
  const syncDirectory = syncLongReviewRenderDirectory;
  const before = await inspectLongReviewPublication(finalDirectory);
  if (!before.valid) {
    throw new Error(
      `Cannot confirm invalid long-review publication: ${before.error?.message ?? "unknown"}`,
    );
  }
  let receiptCommitted = false;
  const commitWarnings = [];
  try {
    await Promise.all([
      syncFile(before.outputPath),
      syncFile(before.manifestPath),
      ...(before.pendingValid ? [syncFile(before.pendingPath)] : []),
      ...(before.durableReceiptValid ? [syncFile(before.receiptPath)] : []),
    ]);
    await syncDirectory(before.finalDirectory);
    await syncDirectory(dirname(before.finalDirectory));
    const verified = await inspectLongReviewPublication(finalDirectory);
    if (!verified.valid || stableStringify(verified.identity) !== stableStringify(before.identity)) {
      throw new Error("Publication changed during durability confirmation");
    }
    const receiptResult = await ensureDurablePublicationReceipt(verified, {
      syncFile,
      syncDirectory,
    });
    receiptCommitted = receiptResult.committed;
    commitWarnings.push(...receiptResult.cleanupWarnings);
    if (verified.pendingValid) {
      try {
        await unlink(verified.pendingPath);
        await syncDirectory(verified.finalDirectory);
      } catch (error) {
        commitWarnings.push({
          stage: "durability_unknown_marker_cleanup",
          code: error?.code ?? "publication_pending_cleanup_failed",
          message: error?.message ?? "Durability-unknown marker cleanup failed",
        });
      }
    }
  } catch (error) {
    commitWarnings.push({
      stage: "durability_confirmation",
      code: error?.code ?? "publication_durability_confirmation_failed",
      message: error?.message ?? "Publication durability confirmation failed",
    });
  }
  const after = await inspectLongReviewPublication(finalDirectory);
  return publicationResult(after.valid ? after : before, {
    durable: receiptCommitted,
    commitWarnings,
  });
}

async function publishValidatedOutputAtomically(publicationOptions) {
  if (arguments.length !== 1 || !publicationOptions || typeof publicationOptions !== "object") {
    throw new TypeError(
      "publishValidatedOutputAtomically requires exactly one publication options object",
    );
  }
  const allowedOptionKeys = new Set([
    "stagedVideoPath",
    "finalDirectory",
    "stagingDirectory",
    "manifest",
    "expectedIntegrity",
    "attemptToken",
  ]);
  const unsupportedOption = Object.keys(publicationOptions)
    .find((key) => !allowedOptionKeys.has(key));
  if (unsupportedOption) {
    throw new TypeError(
      `publishValidatedOutputAtomically does not accept dependency injection: ${unsupportedOption}`,
    );
  }
  const {
    stagedVideoPath,
    finalDirectory,
    stagingDirectory,
    manifest,
    expectedIntegrity,
    attemptToken = "00000000-0000-4000-8000-000000000000",
  } = publicationOptions;
  assertAttemptToken(attemptToken);
  const syncPreRenameFile = syncLongReviewRenderFile;
  const syncPreRenameDirectory = syncLongReviewRenderDirectory;
  const syncPostRenameFile = syncLongReviewRenderFile;
  const syncPostRenameDirectory = syncLongReviewRenderDirectory;
  const resolvedFinalDirectory = resolve(finalDirectory);
  const resolvedStagingDirectory = resolve(stagingDirectory);
  await assertAbsent(resolvedFinalDirectory, resolvedFinalDirectory);
  await syncPreRenameFile(stagedVideoPath);
  const stagedIntegrity = await inspectFile(stagedVideoPath);
  if (
    stagedIntegrity.bytes !== expectedIntegrity.bytes ||
    stagedIntegrity.sha256 !== expectedIntegrity.sha256
  ) {
    throw new Error("Validated staging video integrity changed before publication");
  }
  await mkdir(resolvedStagingDirectory, {recursive: true});
  const publicationPart = attemptScopedPartPath(
    resolve(resolvedStagingDirectory, `${PUBLICATION_PART_PREFIX}.part`),
    attemptToken,
  );
  registerActivePart(publicationPart, attemptToken);
  await mkdir(publicationPart, {recursive: false});
  const publishedVideoPath = resolve(
    publicationPart,
    CHUNKED_V004_CONTRACT.outputFileName,
  );
  await copyFile(stagedVideoPath, publishedVideoPath, fsConstants.COPYFILE_EXCL);
  const copiedIntegrity = await inspectFile(publishedVideoPath);
  if (
    copiedIntegrity.bytes !== stagedIntegrity.bytes ||
    copiedIntegrity.sha256 !== stagedIntegrity.sha256
  ) {
    throw new Error("Publication copy does not match the validated staging video");
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const publishedManifestPath = resolve(publicationPart, "review-manifest.json");
  await writeFile(publishedManifestPath, manifestBytes, {flag: "wx"});
  const identity = publicationIdentity({
    manifest,
    manifestBytes,
    integrity: copiedIntegrity,
    attemptToken,
  });
  const pendingPath = resolve(publicationPart, PUBLICATION_PENDING_FILE_NAME);
  await writeFile(
    pendingPath,
    `${JSON.stringify(publicationMarker("durability_unknown", identity), null, 2)}\n`,
    {encoding: "utf8", flag: "wx"},
  );
  await Promise.all([
    syncPreRenameFile(publishedVideoPath),
    syncPreRenameFile(publishedManifestPath),
    syncPreRenameFile(pendingPath),
  ]);
  await syncPreRenameDirectory(publicationPart);
  await syncPreRenameDirectory(resolvedStagingDirectory);
  await assertAbsent(resolvedFinalDirectory, resolvedFinalDirectory);
  await rename(publicationPart, resolvedFinalDirectory);
  unregisterActivePart(publicationPart, attemptToken);

  const initialInspection = await inspectLongReviewPublication(resolvedFinalDirectory);
  const commitWarnings = [];
  let receiptCommitted = false;
  try {
    await Promise.all([
      syncPostRenameFile(initialInspection.outputPath),
      syncPostRenameFile(initialInspection.manifestPath),
      syncPostRenameFile(initialInspection.pendingPath),
    ]);
    await syncPostRenameDirectory(initialInspection.finalDirectory);
    for (const directoryPath of new Set([
      resolvedStagingDirectory,
      dirname(resolvedFinalDirectory),
    ])) {
      await syncPostRenameDirectory(directoryPath);
    }
    const verified = await inspectLongReviewPublication(resolvedFinalDirectory);
    if (!verified.valid || !verified.pendingValid) {
      throw new Error("Publication changed after final directory rename");
    }
    const receiptResult = await ensureDurablePublicationReceipt(verified, {
      syncFile: syncPostRenameFile,
      syncDirectory: syncPostRenameDirectory,
    });
    receiptCommitted = receiptResult.committed;
    commitWarnings.push(...receiptResult.cleanupWarnings);
    try {
      await unlink(verified.pendingPath);
      await syncPostRenameDirectory(verified.finalDirectory);
    } catch (error) {
      commitWarnings.push({
        stage: "durability_unknown_marker_cleanup",
        code: error?.code ?? "publication_pending_cleanup_failed",
        message: error?.message ?? "Durability-unknown marker cleanup failed",
      });
    }
  } catch (error) {
    commitWarnings.push({
      stage: "post_rename_durability",
      code: error?.code ?? "publication_post_rename_durability_failed",
      message: error?.message ?? "Publication post-rename durability failed",
    });
  }
  const finalInspection = await inspectLongReviewPublication(resolvedFinalDirectory);
  return publicationResult(finalInspection.valid ? finalInspection : initialInspection, {
    durable: receiptCommitted,
    commitWarnings,
  });
}

async function sleep(milliseconds) {
  if (milliseconds === 0) return;
  await new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

export async function renderAgentSkillLongReviewWideV004Chunked(options = {}) {
  if (arguments.length > 1 || !options || typeof options !== "object") {
    throw new TypeError("long-review renderer accepts one options object");
  }
  const unsupportedOption = Object.keys(options)
    .find((key) => !["chunkFrames", "interChunkPauseMs"].includes(key));
  if (unsupportedOption) {
    throw new TypeError(
      `long-review renderer does not accept dependency injection: ${unsupportedOption}`,
    );
  }
  assertLongReviewFromSurfaceEnvironment();
  const {
    chunkFrames = CHUNKED_V004_CONTRACT.defaultChunkFrames,
    interChunkPauseMs = CHUNKED_V004_CONTRACT.defaultInterChunkPauseMs,
  } = options;
  const ranges = buildChunkRanges({chunkFrames});
  const renderConfig = {chunkFrames, interChunkPauseMs};
  parseIntegerOption("interChunkPauseMs", interChunkPauseMs, {
    minimum: 0,
    maximum: 60_000,
  });
  installSignalHandlers();
  await mkdir(WORK_DIRECTORY, {recursive: true});
  const jobLock = await acquireLongReviewRenderJobLock(WORK_DIRECTORY, {
    jobId: CHUNKED_V004_CONTRACT.jobId,
    publicationDirectory: CHUNKS_DIRECTORY,
  });
  const attemptToken = jobLock.token;
  const attemptCapability = activateAttempt(attemptToken);
  try {
    if (await pathExists(FINAL_DIRECTORY)) {
      const existingPublication = await inspectLongReviewPublication(FINAL_DIRECTORY);
      if (existingPublication.valid && existingPublication.pendingValid) {
        jobLock.assertOwned();
        const recovered = await confirmLongReviewPublicationDurability(FINAL_DIRECTORY);
        jobLock.assertOwned();
        return finishLongReviewPublication(
          recovered,
          "publication durability confirmation completed with warnings",
        );
      }
      await assertAbsent(FINAL_DIRECTORY, workspaceRelative(FINAL_DIRECTORY));
    }
    await Promise.all([
      mkdir(STAGING_DIRECTORY, {recursive: true}),
      mkdir(LOGS_DIRECTORY, {recursive: true}),
    ]);
    if (CONFIGURED_RENDER_JOB) {
      await assertLongReviewRenderJobFilesystemSafety(CONFIGURED_RENDER_JOB, {
        workspaceRoot: WORKSPACE_ROOT,
        jobConfigPath: RENDER_JOB_CONFIG_PATH,
      });
    }
    const manifest = await loadOrCreateRunManifest(renderConfig, attemptToken);
    let codecMetadata = null;
    const chunkRecords = [];
    for (const range of ranges) {
      if (terminating) throw new Error("Render interrupted");
      jobLock.assertOwned();
      await assertManifestStillCurrent(manifest);
      let inspected = await inspectChunkForResume(manifest, range, codecMetadata);
      if (!inspected.eligible) {
        process.stdout.write(
          `render chunk ${range.index + 1}/${ranges.length} frames ${range.start}-${range.end}\n`,
        );
        await runChunkWorker(
          manifest,
          range,
          codecMetadata,
          attemptToken,
          jobLock,
        );
        inspected = await inspectChunkForResume(manifest, range, codecMetadata);
        if (!inspected.eligible) {
          throw new Error(`Freshly rendered chunk ${range.index} is not resumable`);
        }
      } else {
        process.stdout.write(
          `resume chunk ${range.index + 1}/${ranges.length} frames ${range.start}-${range.end}\n`,
        );
      }
      codecMetadata ??= inspected.record.codecMetadata;
      if (!sameCodecMetadata(inspected.record.codecMetadata, codecMetadata)) {
        throw new Error(`Chunk ${range.index} codec metadata differs from chunk 0`);
      }
      chunkRecords.push(inspected.record);
      if (range.index < ranges.length - 1) await sleep(interChunkPauseMs);
    }
    jobLock.assertOwned();
    await assertManifestStillCurrent(manifest);
    const concatenated = await prepareConcatenatedVideo(
      manifest,
      chunkRecords,
      codecMetadata,
      attemptToken,
    );
    const muxed = await prepareMuxedVideo(
      manifest,
      concatenated,
      codecMetadata,
      attemptToken,
    );
    jobLock.assertOwned();
    await assertManifestStillCurrent(manifest);
    await assertSafetyStillCurrent(manifest);
    if (CONFIGURED_RENDER_JOB) {
      await assertLongReviewRenderJobFilesystemSafety(CONFIGURED_RENDER_JOB, {
        workspaceRoot: WORKSPACE_ROOT,
        jobConfigPath: RENDER_JOB_CONFIG_PATH,
      });
    }
    const finalManifest = {
      ...manifest,
      schemaVersion: FINAL_MANIFEST_SCHEMA_VERSION,
      completedAt: new Date().toISOString(),
      effectiveScheduleConfig: {interChunkPauseMs},
      chunks: chunkRecords,
      concat: concatenated.record,
      finalMedia: muxed.record,
      publication: {
        atomicDirectoryRename: true,
        preservesWorkDirectories: ["chunks", "staging", "logs", "bundle"],
        outputPath: workspaceRelative(FINAL_OUTPUT_PATH),
      },
    };
    jobLock.assertOwned();
    const publication = await publishValidatedOutputAtomically({
      stagedVideoPath: muxed.path,
      finalDirectory: FINAL_DIRECTORY,
      stagingDirectory: STAGING_DIRECTORY,
      manifest: finalManifest,
      expectedIntegrity: muxed.integrity,
      attemptToken,
    });
    return finishLongReviewPublication(publication);
  } finally {
    try {
      await cleanupActiveParts(attemptCapability);
    } finally {
      deactivateAttempt(attemptCapability);
      jobLock.release();
    }
  }
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usageText()}\n`);
    return;
  }
  if (options.worker) {
    await renderChunkWorker(options);
    return;
  }
  await renderAgentSkillLongReviewWideV004Chunked({
    chunkFrames: options.chunkFrames,
    interChunkPauseMs: options.interChunkPauseMs,
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  main().catch(async (error) => {
    try {
      if (activeAttemptCapability) {
        const attemptCapability = activeAttemptCapability;
        try {
          await cleanupActiveParts(attemptCapability);
        } finally {
          deactivateAttempt(attemptCapability);
        }
      }
    } catch (cleanupError) {
      process.stderr.write(`part cleanup failed: ${cleanupError.stack ?? cleanupError}\n`);
    }
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = terminationSignal === "SIGINT"
      ? 130
      : terminationSignal === "SIGTERM"
        ? 143
        : 1;
  });
}
