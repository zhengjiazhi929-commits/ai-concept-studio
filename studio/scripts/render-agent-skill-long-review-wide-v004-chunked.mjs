import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {constants as fsConstants, createReadStream} from "node:fs";
import {
  access,
  appendFile,
  copyFile,
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
import {basename, dirname, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {execFile} from "node:child_process";

import {bundle} from "@remotion/bundler";
import {
  RenderInternals,
  makeCancelSignal,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";

import {
  assertWideV004InputsChanged,
  assertWideV004SnapshotsUnchanged,
  captureWideV004ProtectedBaselines,
  captureWideV004ReviewInputs,
} from "./render-agent-skill-long-review-wide-v004.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const PUBLIC_ROOT = resolve(STUDIO_ROOT, "public");
const VIDEO_ROOT = resolve(STUDIO_ROOT, "src", "video");
const ENTRY_POINT = resolve(VIDEO_ROOT, "agent-skill-long-review-index.jsx");
const EPISODE_PATH = resolve(
  STUDIO_ROOT,
  "data",
  "episodes",
  "agent-skill-20260806",
  "episode.json",
);
const VOICE_PATH = resolve(
  PUBLIC_ROOT,
  "episodes",
  "agent-skill-20260806",
  "voice-v001.wav",
);
const REVIEW_CANDIDATES_ROOT = resolve(
  WORKSPACE_ROOT,
  "outputs",
  "studio",
  "agent-skill-20260806",
  "review-candidates",
);
const FINAL_DIRECTORY = resolve(
  REVIEW_CANDIDATES_ROOT,
  "full-video-current-visual-upgrade-v004",
);
const FINAL_OUTPUT_PATH = resolve(FINAL_DIRECTORY, "review-10m.mp4");
const WORK_DIRECTORY = resolve(
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

export const CHUNKED_V004_CONTRACT = Object.freeze({
  schemaVersion: "agent-skill-long-review-wide-v004-chunked-v1",
  episodeId: "agent-skill-20260806",
  compositionId: "AgentSkillLongReview",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 18_000,
  durationSeconds: 600,
  defaultChunkFrames: 1_800,
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

const SOURCE_INPUTS = Object.freeze([
  SCRIPT_PATH,
  resolve(dirname(SCRIPT_PATH), "render-agent-skill-long-review-wide-v004.mjs"),
  VIDEO_ROOT,
  resolve(STUDIO_ROOT, "config", "visual-system.json"),
  resolve(STUDIO_ROOT, "src", "shared", "technical-diagram-contract.mjs"),
  EPISODE_PATH,
]);

const BUNDLE_CONTEXT_FILE = ".v004-chunked-bundle-context.json";
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const activePartPaths = new Set();
const activeCancellations = new Set();
let activeWorker = null;
let terminating = false;
let terminationSignal = null;

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

async function assertAbsent(filePath, label = workspaceRelative(filePath)) {
  if (await pathExists(filePath)) {
    throw new Error(`${label} already exists; refusing to overwrite it`);
  }
}

export async function inspectFile(filePath) {
  const before = await assertPlainFile(filePath);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  const after = await assertPlainFile(filePath);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(`File changed while hashing: ${workspaceRelative(filePath)}`);
  }
  return {bytes, sha256: hash.digest("hex")};
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
  const [{stdout: headOutput}, {stdout: statusOutput}] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: WORKSPACE_ROOT,
      encoding: "utf8",
    }),
    execFileAsync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      {cwd: WORKSPACE_ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024},
    ),
  ]);
  const headSha = headOutput.trim();
  if (!/^[a-f0-9]{40,64}$/u.test(headSha)) {
    throw new Error(`Unexpected Git HEAD hash: ${headSha}`);
  }
  return {
    headSha,
    statusSha256: sha256Text(statusOutput),
  };
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
    interChunkPauseMs: 0,
    manifestPath: null,
    chunkIndex: null,
    expectedCodecBase64: null,
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
    "  --chunk-frames <frames>          Frames per child process (default: 1800).",
    "                                    Use 900 for 20 chunks of 30 seconds.",
    "  --inter-chunk-pause-ms <ms>      Pause between child processes (0..60000).",
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
  interChunkPauseMs,
}) {
  if (!record || !validation?.valid) return false;
  const sameRange =
    record.range?.index === range.index &&
    record.range?.start === range.start &&
    record.range?.end === range.end &&
    record.range?.frameCount === range.frameCount;
  return (
    record.schemaVersion === "agent-skill-long-review-wide-v004-chunk-v1" &&
    record.runFingerprint === runFingerprint &&
    record.chunkFrames === chunkFrames &&
    record.interChunkPauseMs === interChunkPauseMs &&
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

function chunkPaths(range) {
  const stem = chunkStem(range);
  return {
    output: resolve(CHUNKS_DIRECTORY, `${stem}.mp4`),
    part: resolve(CHUNKS_DIRECTORY, `${stem}.part.mp4`),
    metadata: resolve(CHUNKS_DIRECTORY, `${stem}.metadata.json`),
    metadataPart: resolve(CHUNKS_DIRECTORY, `${stem}.metadata.part.json`),
    log: resolve(LOGS_DIRECTORY, `${stem}.log`),
  };
}

async function removeExactPart(filePath) {
  if (!activePartPaths.has(filePath)) return;
  try {
    const fileStat = await lstat(filePath);
    if (fileStat.isSymbolicLink()) {
      throw new Error(`Refusing to remove symlink part: ${filePath}`);
    }
    if (fileStat.isDirectory()) await rm(filePath, {recursive: true});
    else if (fileStat.isFile()) await unlink(filePath);
    else throw new Error(`Refusing to remove non-file part: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  } finally {
    activePartPaths.delete(filePath);
  }
}

async function cleanupActiveParts() {
  for (const partPath of [...activePartPaths]) {
    await removeExactPart(partPath);
  }
}

async function terminate(signal) {
  if (terminating) return;
  terminating = true;
  terminationSignal = signal;
  for (const cancel of activeCancellations) cancel();
  if (activeWorker && !activeWorker.killed) activeWorker.kill(signal);
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  if (activeCancellations.size === 0 && activeWorker === null) {
    try {
      await cleanupActiveParts();
    } catch (error) {
      process.stderr.write(`part cleanup failed: ${error.stack ?? error}\n`);
    } finally {
      process.exit(process.exitCode);
    }
  }
}

function installSignalHandlers() {
  process.once("SIGINT", () => void terminate("SIGINT"));
  process.once("SIGTERM", () => void terminate("SIGTERM"));
}

async function writeJsonAtomically(filePath, value, partPath) {
  await assertAbsent(partPath, workspaceRelative(partPath));
  activePartPaths.add(partPath);
  await writeFile(partPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await assertAbsent(filePath, workspaceRelative(filePath));
  await rename(partPath, filePath);
  activePartPaths.delete(partPath);
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
  const [source, git, voice] = await Promise.all([
    fingerprintPaths(SOURCE_INPUTS, {baseDirectory: WORKSPACE_ROOT}),
    captureGitIdentity(),
    inspectFile(VOICE_PATH),
  ]);
  const context = {
    contract: CHUNKED_V004_CONTRACT,
    renderConfig,
    source,
    git,
    voice: {
      path: workspaceRelative(VOICE_PATH),
      ...voice,
    },
  };
  return {
    ...context,
    runtimeFingerprint: sha256Text(stableStringify(context)),
  };
}

async function captureBaseContext(renderConfig) {
  const [runtime, protectedBaselines, reviewInputs] = await Promise.all([
    captureRuntimeContext(renderConfig),
    captureWideV004ProtectedBaselines(),
    captureWideV004ReviewInputs(),
  ]);
  const changedPathsFromV003 = assertWideV004InputsChanged(reviewInputs);
  const context = {
    ...runtime,
    safety: {
      protectedBaselines,
      reviewInputs,
      changedPathsFromV003,
    },
  };
  return {
    ...context,
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

async function ensureBundle(baseContext) {
  const sentinelPath = resolve(BUNDLE_DIRECTORY, BUNDLE_CONTEXT_FILE);
  if (await pathExists(BUNDLE_DIRECTORY)) {
    const sentinel = JSON.parse(await readFile(sentinelPath, "utf8"));
    if (sentinel.runtimeFingerprint !== baseContext.runtimeFingerprint) {
      throw new Error(
        "Existing reusable bundle belongs to different source/git/voice/render settings",
      );
    }
  } else {
    const partDirectory = `${BUNDLE_DIRECTORY}.part-${process.pid}`;
    assertInside(WORK_DIRECTORY, partDirectory, "bundle part");
    await assertAbsent(partDirectory);
    activePartPaths.add(partDirectory);
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
    activePartPaths.delete(partDirectory);
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

async function loadOrCreateRunManifest(renderConfig) {
  const baseContext = await captureBaseContext(renderConfig);
  const bundleFingerprint = await ensureBundle(baseContext);
  const tools = await mediaToolIdentity();
  const ranges = buildChunkRanges({chunkFrames: renderConfig.chunkFrames});
  const fingerprintPayload = {
    ...baseContext,
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
    if (
      existing.runFingerprint !== runFingerprint ||
      existing.renderConfig?.chunkFrames !== renderConfig.chunkFrames ||
      existing.renderConfig?.interChunkPauseMs !== renderConfig.interChunkPauseMs
    ) {
      throw new Error(
        "Resume manifest does not match source/git/bundle/voice/chunk/pause settings",
      );
    }
    return existing;
  }
  await writeJsonAtomically(
    RUN_MANIFEST_PATH,
    expected,
    `${RUN_MANIFEST_PATH}.part-${process.pid}`,
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
        interChunkPauseMs: manifest.renderConfig.interChunkPauseMs,
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

async function runChunkWorker(manifest, range, expectedCodecMetadata) {
  const paths = chunkPaths(range);
  await preserveStale(
    [paths.output, paths.metadata, paths.part, paths.metadataPart],
    "not-resumable",
  );
  const codecArgument = expectedCodecMetadata
    ? Buffer.from(JSON.stringify(expectedCodecMetadata)).toString("base64url")
    : "none";
  const logHandle = await open(paths.log, "a");
  try {
    await appendFile(
      paths.log,
      `\n=== worker start ${new Date().toISOString()} range ${range.start}-${range.end} ===\n`,
      "utf8",
    );
    const child = spawn(
      process.execPath,
      [
        SCRIPT_PATH,
        "--worker",
        "--manifest",
        RUN_MANIFEST_PATH,
        "--chunk-index",
        String(range.index),
        "--chunk-frames",
        String(manifest.renderConfig.chunkFrames),
        "--inter-chunk-pause-ms",
        String(manifest.renderConfig.interChunkPauseMs),
        "--expected-codec-base64",
        codecArgument,
      ],
      {
        cwd: STUDIO_ROOT,
        stdio: ["ignore", logHandle.fd, logHandle.fd],
      },
    );
    activeWorker = child;
    const exitCode = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) reject(new Error(`Chunk worker stopped by ${signal}`));
        else resolveExit(code);
      });
    });
    if (exitCode !== 0) {
      throw new Error(
        `Chunk ${range.index} worker exited with ${exitCode}; see ${workspaceRelative(paths.log)}`,
      );
    }
  } finally {
    activeWorker = null;
    await logHandle.close();
  }
}

async function renderChunkWorker(options) {
  if (!options.manifestPath || options.chunkIndex === null) {
    throw new Error("Worker mode requires --manifest and --chunk-index");
  }
  const manifest = JSON.parse(await readFile(options.manifestPath, "utf8"));
  if (
    manifest.renderConfig?.chunkFrames !== options.chunkFrames ||
    manifest.renderConfig?.interChunkPauseMs !== options.interChunkPauseMs
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
  const paths = chunkPaths(range);
  assertInside(CHUNKS_DIRECTORY, paths.part, "chunk part");
  activePartPaths.add(paths.part);
  activePartPaths.add(paths.metadataPart);
  installSignalHandlers();
  await assertManifestStillCurrent(manifest);
  await assertLocalChrome();
  await assertAbsent(paths.output);
  await assertAbsent(paths.metadata);
  await assertAbsent(paths.part);
  await assertAbsent(paths.metadataPart);

  const episode = JSON.parse(await readFile(EPISODE_PATH, "utf8"));
  const inputProps = {episode};
  const composition = await selectComposition({
    serveUrl: BUNDLE_DIRECTORY,
    id: CHUNKED_V004_CONTRACT.compositionId,
    inputProps,
    browserExecutable: CHROME_EXECUTABLE,
    chromeMode: "chrome-for-testing",
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
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 18_000,
  };
  if (stableStringify(compositionContract) !== stableStringify(expectedComposition)) {
    throw new Error(`Composition contract changed: ${JSON.stringify(compositionContract)}`);
  }

  const {cancel, cancelSignal} = makeCancelSignal();
  activeCancellations.add(cancel);
  try {
    await renderMedia({
      composition,
      serveUrl: BUNDLE_DIRECTORY,
      outputLocation: paths.part,
      inputProps,
      browserExecutable: CHROME_EXECUTABLE,
      chromeMode: "chrome-for-testing",
      onBrowserDownload: () => {
        throw new Error("Browser download is disabled; local Chrome is required");
      },
      codec: "h264",
      pixelFormat: "yuv420p",
      crf: CHUNKED_V004_CONTRACT.crf,
      concurrency: 1,
      frameRange: [range.start, range.end],
      imageFormat: "png",
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

  const rawProbe = await probeMedia(paths.part, paths.log);
  const validation = evaluateChunkProbe(
    rawProbe,
    range,
    expectedCodecMetadata,
  );
  assertValidation(`Chunk ${range.index}`, validation);
  const integrity = await inspectFile(paths.part);
  await rename(paths.part, paths.output);
  activePartPaths.delete(paths.part);
  const record = {
    schemaVersion: "agent-skill-long-review-wide-v004-chunk-v1",
    runFingerprint: manifest.runFingerprint,
    chunkFrames: manifest.renderConfig.chunkFrames,
    interChunkPauseMs: manifest.renderConfig.interChunkPauseMs,
    range,
    file: {
      path: workspaceRelative(paths.output),
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
  await writeJsonAtomically(paths.metadata, record, paths.metadataPart);
  activePartPaths.delete(paths.metadataPart);
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

async function prepareConcatenatedVideo(manifest, chunkRecords, codecMetadata) {
  const listPath = resolve(STAGING_DIRECTORY, "chunks.concat.txt");
  const listPartPath = resolve(STAGING_DIRECTORY, "chunks.concat.part.txt");
  const outputPath = resolve(STAGING_DIRECTORY, "video-concat.mp4");
  const outputPartPath = resolve(STAGING_DIRECTORY, "video-concat.part.mp4");
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
  activePartPaths.add(listPartPath);
  await writeFile(listPartPath, listContents, {encoding: "utf8", flag: "wx"});
  await rename(listPartPath, listPath);
  activePartPaths.delete(listPartPath);
  activePartPaths.add(outputPartPath);
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
  activePartPaths.delete(outputPartPath);
  const record = {
    schemaVersion: "agent-skill-long-review-wide-v004-concat-v1",
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
    `${recordPath}.part-${process.pid}`,
  );
  return {path: outputPath, integrity, validation, record};
}

async function prepareMuxedVideo(manifest, concatenated, codecMetadata) {
  const outputPath = resolve(STAGING_DIRECTORY, "review-10m.validated.mp4");
  const outputPartPath = resolve(STAGING_DIRECTORY, "review-10m.part.mp4");
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
  activePartPaths.add(outputPartPath);
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
  activePartPaths.delete(outputPartPath);
  const record = {
    schemaVersion: "agent-skill-long-review-wide-v004-final-media-v1",
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
    `${recordPath}.part-${process.pid}`,
  );
  return {path: outputPath, integrity, validation, record};
}

export async function publishValidatedOutputAtomically({
  stagedVideoPath,
  finalDirectory,
  stagingDirectory,
  manifest,
  expectedIntegrity,
}) {
  const resolvedFinalDirectory = resolve(finalDirectory);
  const resolvedStagingDirectory = resolve(stagingDirectory);
  await assertAbsent(resolvedFinalDirectory, resolvedFinalDirectory);
  const stagedIntegrity = await inspectFile(stagedVideoPath);
  if (
    stagedIntegrity.bytes !== expectedIntegrity.bytes ||
    stagedIntegrity.sha256 !== expectedIntegrity.sha256
  ) {
    throw new Error("Validated staging video integrity changed before publication");
  }
  await mkdir(resolvedStagingDirectory, {recursive: true});
  const publicationPart = resolve(
    resolvedStagingDirectory,
    `.v004-publication-${process.pid}-${Date.now()}.part`,
  );
  activePartPaths.add(publicationPart);
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
  await writeFile(
    resolve(publicationPart, "review-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    {encoding: "utf8", flag: "wx"},
  );
  await assertAbsent(resolvedFinalDirectory, resolvedFinalDirectory);
  await rename(publicationPart, resolvedFinalDirectory);
  activePartPaths.delete(publicationPart);
  return {
    finalDirectory: resolvedFinalDirectory,
    outputPath: resolve(
      resolvedFinalDirectory,
      CHUNKED_V004_CONTRACT.outputFileName,
    ),
    integrity: copiedIntegrity,
  };
}

async function sleep(milliseconds) {
  if (milliseconds === 0) return;
  await new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

export async function renderAgentSkillLongReviewWideV004Chunked({
  chunkFrames = CHUNKED_V004_CONTRACT.defaultChunkFrames,
  interChunkPauseMs = 0,
} = {}) {
  const ranges = buildChunkRanges({chunkFrames});
  const renderConfig = {chunkFrames, interChunkPauseMs};
  parseIntegerOption("interChunkPauseMs", interChunkPauseMs, {
    minimum: 0,
    maximum: 60_000,
  });
  installSignalHandlers();
  await assertAbsent(FINAL_DIRECTORY, workspaceRelative(FINAL_DIRECTORY));
  await Promise.all([
    mkdir(CHUNKS_DIRECTORY, {recursive: true}),
    mkdir(STAGING_DIRECTORY, {recursive: true}),
    mkdir(LOGS_DIRECTORY, {recursive: true}),
  ]);
  const manifest = await loadOrCreateRunManifest(renderConfig);
  let codecMetadata = null;
  const chunkRecords = [];
  for (const range of ranges) {
    if (terminating) throw new Error("Render interrupted");
    await assertManifestStillCurrent(manifest);
    let inspected = await inspectChunkForResume(manifest, range, codecMetadata);
    if (!inspected.eligible) {
      process.stdout.write(
        `render chunk ${range.index + 1}/${ranges.length} frames ${range.start}-${range.end}\n`,
      );
      await runChunkWorker(manifest, range, codecMetadata);
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
  await assertManifestStillCurrent(manifest);
  const concatenated = await prepareConcatenatedVideo(
    manifest,
    chunkRecords,
    codecMetadata,
  );
  const muxed = await prepareMuxedVideo(manifest, concatenated, codecMetadata);
  await assertManifestStillCurrent(manifest);
  await assertSafetyStillCurrent(manifest);
  const finalManifest = {
    ...manifest,
    schemaVersion: "agent-skill-long-review-wide-v004-chunked-final-v1",
    completedAt: new Date().toISOString(),
    chunks: chunkRecords,
    concat: concatenated.record,
    finalMedia: muxed.record,
    publication: {
      atomicDirectoryRename: true,
      preservesWorkDirectories: ["chunks", "staging", "logs", "bundle"],
      outputPath: workspaceRelative(FINAL_OUTPUT_PATH),
    },
  };
  const publication = await publishValidatedOutputAtomically({
    stagedVideoPath: muxed.path,
    finalDirectory: FINAL_DIRECTORY,
    stagingDirectory: STAGING_DIRECTORY,
    manifest: finalManifest,
    expectedIntegrity: muxed.integrity,
  });
  process.stdout.write(
    `published ${workspaceRelative(publication.outputPath)} (${publication.integrity.sha256})\n`,
  );
  return publication;
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
      await cleanupActiveParts();
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
