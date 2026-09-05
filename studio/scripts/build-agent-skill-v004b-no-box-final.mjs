import {execFile} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import {
  constants as fsConstants,
  copyFile,
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import {basename, dirname, isAbsolute, join, relative, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {promisify} from "node:util";

import {RenderInternals} from "@remotion/renderer";
import {
  acquireLongReviewRenderJobLock,
  syncLongReviewRenderDirectory,
  syncLongReviewRenderFile,
} from "../src/server/production/long-render-job.mjs";


const execFileAsync = promisify(execFile);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const REVIEW_CANDIDATES_DIRECTORY = resolve(
  WORKSPACE_ROOT,
  "outputs/studio/agent-skill-20260806/review-candidates",
);
const PYTHON_OVERLAY_BUILDER_PATH = resolve(
  dirname(SCRIPT_PATH),
  "build-agent-skill-v004b-no-box-overlays.py",
);
const LONG_RENDER_JOB_MODULE_PATH = resolve(
  STUDIO_ROOT,
  "src/server/production/long-render-job.mjs",
);
const FINAL_CANDIDATE_NAME =
  "full-video-current-visual-upgrade-v014-natural-technical-v004b-no-box-formal-v001";
const FINAL_CANDIDATE_JOB_ID =
  "agent-skill-20260806-current-visual-upgrade-v014-v004b-no-box-formal-v001";
export const V004B_FINAL_CANDIDATE_VERSION = 1;
export const V004B_FINAL_CANDIDATE_IDENTITY = Object.freeze({
  directoryName: FINAL_CANDIDATE_NAME,
  jobId: FINAL_CANDIDATE_JOB_ID,
  candidateVersion: V004B_FINAL_CANDIDATE_VERSION,
  renderBaseCandidateVersion: 14,
});
const PUBLICATION_STATE_SCHEMA_VERSION =
  "agent-skill-v004b-no-box-publication-state-v1";
const PUBLICATION_PENDING_FILE_NAME = "publication-durability-unknown.json";
const PUBLICATION_RECEIPT_FILE_NAME = "publication-durable-receipt.json";
export const V004B_FINAL_SCHEMA_VERSION =
  "agent-skill-v013-v004b-no-box-final-candidate-v1";
export const V004B_OVERLAY_SCHEMA_VERSION =
  "agent-skill-v013-caption-overlay-v004b-no-box-v1";
export const V004B_FINAL_CONTRACT = Object.freeze({
  fps: 30,
  durationSeconds: 600,
  durationInFrames: 18_000,
  chunkFrames: 900,
  chunkCount: 20,
  concurrency: 1,
  width: 1920,
  height: 1080,
  overlayWidth: 1480,
  overlayHeight: 130,
  overlayX: 220,
  overlayY: 870,
  fontFamily: "Hiragino Sans GB",
  fontWeight: "W3",
  fontSize: 40,
  videoCodec: "h264",
  pixelFormat: "yuv420p",
  audioCodec: "aac",
  audioSampleRate: 48_000,
  audioChannels: 1,
  audioSamples: 28_800_000,
});
export const V004B_FINAL_PATHS = Object.freeze({
  reviewCandidatesDirectory: REVIEW_CANDIDATES_DIRECTORY,
  renderBaseDirectory: resolve(
    REVIEW_CANDIDATES_DIRECTORY,
    "full-video-current-visual-upgrade-render-base-v014",
  ),
  overlayDirectory: resolve(
    REVIEW_CANDIDATES_DIRECTORY,
    "full-video-current-visual-upgrade-v014-natural-technical-v004b-no-box-overlay-input-v001",
  ),
  timeline: resolve(
    STUDIO_ROOT,
    "data/render-inputs/full-v004b-attempt-001/subtitle-timeline-v004-full.json",
  ),
  voice: resolve(
    STUDIO_ROOT,
    "public/episodes/agent-skill-20260806/voice-natural-technical-v004-full.wav",
  ),
  outputDirectory: resolve(REVIEW_CANDIDATES_DIRECTORY, FINAL_CANDIDATE_NAME),
  workDirectory: resolve(
    REVIEW_CANDIDATES_DIRECTORY,
    `.${FINAL_CANDIDATE_NAME}-work`,
  ),
  outputFileName: "review-10m.mp4",
  manifestFileName: "review-manifest.json",
});


export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}


export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}


async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}


async function assertPlainFile(path, label) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} 必须是普通文件且不能是符号链接：${path}`);
  }
  return details;
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


async function readPlainFileSnapshot(path, label) {
  const before = await lstat(path, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${label} 必须是普通文件且不能是符号链接：${path}`);
  }
  const contents = await readFile(path);
  const after = await lstat(path, {bigint: true});
  if (!samePlainFileIdentity(before, after) || BigInt(contents.length) !== after.size) {
    throw new Error(`${label} 在读取期间发生漂移：${path}`);
  }
  return {
    contents,
    integrity: {
      bytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
    },
  };
}


async function assertPlainDirectory(path, label) {
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label} 必须是普通目录且不能是符号链接：${path}`);
  }
  return details;
}


async function assertReadOnlyPlainFile(path, label) {
  const details = await assertPlainFile(path, label);
  if ((details.mode & 0o222) !== 0) {
    throw new Error(`${label} 必须在合成前冻结为只读：${path}`);
  }
  return details;
}


async function assertReadOnlyPlainDirectory(path, label) {
  const details = await assertPlainDirectory(path, label);
  if ((details.mode & 0o222) !== 0) {
    throw new Error(`${label} 必须在合成前冻结为只读：${path}`);
  }
  return details;
}


export function assertInside(parent, child, label) {
  const traversal = relative(resolve(parent), resolve(child));
  if (traversal === "" || (!traversal.startsWith("..") && !isAbsolute(traversal))) {
    return resolve(child);
  }
  throw new Error(`${label} 越出允许目录：${child}`);
}


export async function inspectFile(path) {
  const before = await lstat(path, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`输入/产物 必须是普通文件且不能是符号链接：${path}`);
  }
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    digest.update(chunk);
  }
  const after = await lstat(path, {bigint: true});
  if (!samePlainFileIdentity(before, after) || BigInt(bytes) !== after.size) {
    throw new Error(`输入/产物 在哈希期间发生漂移：${path}`);
  }
  return {bytes, sha256: digest.digest("hex")};
}


function parseJsonBytes(contents, path, label) {
  let value;
  try {
    value = JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON：${path}`, {cause: error});
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 顶层必须是对象：${path}`);
  }
  return value;
}


async function readJsonSnapshot(path, label) {
  const snapshot = await readPlainFileSnapshot(path, label);
  return {
    ...snapshot,
    value: parseJsonBytes(snapshot.contents, path, label),
  };
}


async function readJsonFile(path, label) {
  return (await readJsonSnapshot(path, label)).value;
}


function assertHash(value, label) {
  if (!HASH_PATTERN.test(value ?? "")) {
    throw new Error(`${label} 必须是 64 位小写 SHA-256`);
  }
  return value;
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


export function parseCliArguments(argumentsList) {
  const options = {
    fps: V004B_FINAL_CONTRACT.fps,
    durationSeconds: V004B_FINAL_CONTRACT.durationSeconds,
    durationInFrames: V004B_FINAL_CONTRACT.durationInFrames,
    chunkFrames: V004B_FINAL_CONTRACT.chunkFrames,
    ffmpeg: null,
    ffprobe: null,
    dryRun: false,
    help: false,
  };
  const stringOptions = new Map([
    ["--render-base", "renderBase"],
    ["--render-base-manifest", "renderBaseManifest"],
    ["--render-base-receipt", "renderBaseReceipt"],
    ["--expected-render-base-manifest-sha256", "expectedRenderBaseManifestSha256"],
    ["--overlay-manifest", "overlayManifest"],
    ["--expected-overlay-manifest-sha256", "expectedOverlayManifestSha256"],
    [
      "--expected-accepted-prefix-manifest-sha256",
      "expectedAcceptedPrefixManifestSha256",
    ],
    ["--timeline", "timeline"],
    ["--expected-timeline-sha256", "expectedTimelineSha256"],
    ["--voice", "voice"],
    ["--expected-voice-sha256", "expectedVoiceSha256"],
    ["--work-directory", "workDirectory"],
    ["--output-directory", "outputDirectory"],
    ["--ffmpeg", "ffmpeg"],
    ["--ffprobe", "ffprobe"],
  ]);
  const integerOptions = new Map([
    ["--fps", "fps"],
    ["--duration-seconds", "durationSeconds"],
    ["--duration-in-frames", "durationInFrames"],
    ["--chunk-frames", "chunkFrames"],
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
    if (matched) continue;
    for (const [name, key] of integerOptions) {
      const taken = takeArgumentValue(argumentsList, index, name);
      if (!taken) continue;
      const value = Number(taken.value);
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} 必须是正整数`);
      }
      options[key] = value;
      index = taken.nextIndex;
      matched = true;
      break;
    }
    if (!matched) throw new Error(`未知参数：${argument}`);
  }
  return options;
}


export function usageText() {
  return [
    "Usage: node build-agent-skill-v004b-no-box-final.mjs \\",
    "  --render-base <review-10m.mp4> \\",
    "  --render-base-manifest <review-manifest.json> \\",
    "  --render-base-receipt <publication-durable-receipt.json> \\",
    "  --expected-render-base-manifest-sha256 <sha256> \\",
    "  --overlay-manifest <overlay-manifest-v004b-no-box.json> \\",
    "  --expected-overlay-manifest-sha256 <sha256> \\",
    "  --expected-accepted-prefix-manifest-sha256 <sha256> \\",
    "  --timeline <full-timeline.json> --expected-timeline-sha256 <sha256> \\",
    "  --voice <full-voice.wav> --expected-voice-sha256 <sha256> \\",
    "  --work-directory <resumable-work-dir> --output-directory <new-candidate-dir>",
    "",
    "Fixed formal contract: 1920x1080, 30fps, 18000 frames, 20x900-frame serial overlay chunks.",
    `Fixed output: ${V004B_FINAL_PATHS.outputDirectory}`,
    `Fixed resumable work directory: ${V004B_FINAL_PATHS.workDirectory}`,
    "Run this FFmpeg stage through /usr/sbin/taskpolicy -b /usr/bin/nice -n 20.",
  ].join("\n");
}


function requireFormalOptions(options) {
  const required = [
    "renderBase",
    "renderBaseManifest",
    "renderBaseReceipt",
    "expectedRenderBaseManifestSha256",
    "overlayManifest",
    "expectedOverlayManifestSha256",
    "expectedAcceptedPrefixManifestSha256",
    "timeline",
    "expectedTimelineSha256",
    "voice",
    "expectedVoiceSha256",
    "workDirectory",
    "outputDirectory",
  ];
  for (const key of required) {
    if (!options[key]) throw new Error(`缺少必需参数：${key}`);
  }
  for (const key of [
    "expectedRenderBaseManifestSha256",
    "expectedOverlayManifestSha256",
    "expectedAcceptedPrefixManifestSha256",
    "expectedTimelineSha256",
    "expectedVoiceSha256",
  ]) {
    assertHash(options[key], key);
  }
  if (
    options.fps !== V004B_FINAL_CONTRACT.fps ||
    options.durationSeconds !== V004B_FINAL_CONTRACT.durationSeconds ||
    options.durationInFrames !== V004B_FINAL_CONTRACT.durationInFrames ||
    options.chunkFrames !== V004B_FINAL_CONTRACT.chunkFrames ||
    options.durationInFrames !== options.fps * options.durationSeconds ||
    options.durationInFrames % options.chunkFrames !== 0
  ) {
    throw new Error("正式 v004b 合成必须恰好为 30fps / 18000帧 / 600秒 / 20×900帧");
  }
}


export function assertFormalOutputLayout({workDirectory, outputDirectory}) {
  const resolvedWork = resolve(workDirectory);
  const resolvedOutput = resolve(outputDirectory);
  if (
    resolvedWork !== V004B_FINAL_PATHS.workDirectory ||
    resolvedOutput !== V004B_FINAL_PATHS.outputDirectory ||
    dirname(resolvedWork) !== REVIEW_CANDIDATES_DIRECTORY ||
    dirname(resolvedOutput) !== REVIEW_CANDIDATES_DIRECTORY
  ) {
    throw new Error(
      "正式 v004b 候选必须使用独立固定 work/output 目录，拒绝覆盖或误写其他版本",
    );
  }
  return {workDirectory: resolvedWork, outputDirectory: resolvedOutput};
}


export function assertFormalInputLayout({
  renderBase,
  renderBaseManifest,
  renderBaseReceipt,
  overlayManifest,
  timeline,
  voice,
}) {
  const expectedRenderBaseDirectory = V004B_FINAL_PATHS.renderBaseDirectory;
  const checks = {
    renderBase:
      resolve(renderBase) === resolve(expectedRenderBaseDirectory, "review-10m.mp4"),
    renderBaseManifest:
      resolve(renderBaseManifest) ===
      resolve(expectedRenderBaseDirectory, "review-manifest.json"),
    renderBaseReceipt:
      resolve(renderBaseReceipt) ===
      resolve(expectedRenderBaseDirectory, "publication-durable-receipt.json"),
    overlayManifest:
      resolve(overlayManifest) ===
        resolve(
          V004B_FINAL_PATHS.overlayDirectory,
          "overlay-manifest-v004b-no-box.json",
        ) &&
      assertInside(
        REVIEW_CANDIDATES_DIRECTORY,
        resolve(overlayManifest),
        "overlay manifest",
      ) === resolve(overlayManifest),
    timeline: resolve(timeline) === V004B_FINAL_PATHS.timeline,
    voice: resolve(voice) === V004B_FINAL_PATHS.voice,
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`正式 v004b 输入路径合同不匹配：${failed.join(", ")}`);
  }
  return true;
}


export function buildChunkRanges({
  durationInFrames = V004B_FINAL_CONTRACT.durationInFrames,
  chunkFrames = V004B_FINAL_CONTRACT.chunkFrames,
} = {}) {
  if (
    !Number.isSafeInteger(durationInFrames) ||
    !Number.isSafeInteger(chunkFrames) ||
    durationInFrames <= 0 ||
    chunkFrames <= 0 ||
    durationInFrames % chunkFrames !== 0
  ) {
    throw new Error("总帧数必须被 chunkFrames 整除");
  }
  return Array.from({length: durationInFrames / chunkFrames}, (_, index) => {
    const startFrame = index * chunkFrames;
    return {
      index,
      startFrame,
      endFrameExclusive: startFrame + chunkFrames,
      endFrameInclusive: startFrame + chunkFrames - 1,
      frameCount: chunkFrames,
    };
  });
}


function secondsFromFrame(frame, fps) {
  return (frame / fps).toFixed(6);
}


export function buildOverlayChunkFfmpegArgs({
  renderBase,
  framePattern,
  output,
  range,
  fps = V004B_FINAL_CONTRACT.fps,
  overlayX = V004B_FINAL_CONTRACT.overlayX,
  overlayY = V004B_FINAL_CONTRACT.overlayY,
}) {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-n",
    "-ss",
    secondsFromFrame(range.startFrame, fps),
    "-i",
    renderBase,
    "-framerate",
    String(fps),
    "-start_number",
    String(range.startFrame),
    "-i",
    framePattern,
    "-filter_complex",
    `[0:v:0]setpts=PTS-STARTPTS[base];[1:v:0]setpts=PTS-STARTPTS[caption];[base][caption]overlay=${overlayX}:${overlayY}:format=auto:shortest=1[v]`,
    "-map",
    "[v]",
    "-frames:v",
    String(range.frameCount),
    "-r",
    String(fps),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-profile:v",
    "high",
    "-level:v",
    "4.0",
    "-pix_fmt",
    V004B_FINAL_CONTRACT.pixelFormat,
    "-g",
    "60",
    "-keyint_min",
    "60",
    "-sc_threshold",
    "0",
    "-movflags",
    "+faststart",
    output,
  ];
}


function concatEscape(path) {
  return path.replaceAll("'", "'\\''");
}


export function buildConcatList(chunkPaths) {
  return `${chunkPaths.map((path) => `file '${concatEscape(path)}'`).join("\n")}\n`;
}


export function buildConcatFfmpegArgs(listPath, output) {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-n",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-map",
    "0:v:0",
    "-c:v",
    "copy",
    "-an",
    "-movflags",
    "+faststart",
    output,
  ];
}


export function buildAudioMuxFfmpegArgs(video, voice, output) {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-n",
    "-i",
    video,
    "-i",
    voice,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-af",
    "aresample=48000,apad=whole_len=28800000,atrim=end_sample=28800000,asetpts=N/SR/TB",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "1",
    "-t",
    "600",
    "-movflags",
    "+faststart",
    output,
  ];
}


export function buildVideoDecodeFfmpegArgs(path) {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-xerror",
    "-i",
    path,
    "-map",
    "0:v:0",
    "-an",
    "-c:v",
    "rawvideo",
    "-f",
    "null",
    "-",
  ];
}


export function buildAudioDecodeFfmpegArgs(path) {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-xerror",
    "-i",
    path,
    "-map",
    "0:a:0",
    "-vn",
    "-c:a",
    "pcm_s16le",
    "-f",
    "null",
    "-",
  ];
}


function rationalToNumber(value) {
  const [numerator, denominator] = String(value ?? "").split("/").map(Number);
  return denominator ? numerator / denominator : Number.NaN;
}


function exactFrameCount(video) {
  for (const value of [video?.nb_read_frames, video?.nb_frames]) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}


function codecMetadata(video) {
  const keys = [
    "codec_name",
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
  const videos = streams.filter((stream) => stream.codec_type === "video");
  const audios = streams.filter((stream) => stream.codec_type === "audio");
  const video = videos[0] ?? null;
  const audio = audios[0] ?? null;
  return {
    formatName: rawProbe?.format?.format_name ?? null,
    durationSeconds: Number(rawProbe?.format?.duration ?? video?.duration ?? audio?.duration),
    frameCount: exactFrameCount(video),
    fps: rationalToNumber(video?.avg_frame_rate ?? video?.r_frame_rate),
    videoStreamCount: videos.length,
    audioStreamCount: audios.length,
    video,
    audio,
    codecMetadata: codecMetadata(video),
  };
}


function baseVideoChecks(media, expectedFrames, expectedDuration, allowAudio) {
  return {
    mp4: media.formatName?.split(",").includes("mp4") === true,
    oneVideoStream: media.videoStreamCount === 1,
    audioPolicy: allowAudio ? media.audioStreamCount <= 1 : media.audioStreamCount === 0,
    exactFrames: media.frameCount === expectedFrames,
    exactDuration:
      Number.isFinite(media.durationSeconds) &&
      Math.abs(media.durationSeconds - expectedDuration) <= 0.05,
    fps30: Number.isFinite(media.fps) && Math.abs(media.fps - 30) <= 0.0001,
    width1920: media.video?.width === V004B_FINAL_CONTRACT.width,
    height1080: media.video?.height === V004B_FINAL_CONTRACT.height,
    h264: media.video?.codec_name === V004B_FINAL_CONTRACT.videoCodec,
    yuv420p: media.video?.pix_fmt === V004B_FINAL_CONTRACT.pixelFormat,
  };
}


export function evaluateRenderBaseProbe(rawProbe) {
  const media = normalizeProbe(rawProbe);
  const checks = {
    ...baseVideoChecks(
      media,
      V004B_FINAL_CONTRACT.durationInFrames,
      V004B_FINAL_CONTRACT.durationSeconds,
      true,
    ),
    exactlyOneAudio: media.audioStreamCount === 1,
    aac: media.audio?.codec_name === V004B_FINAL_CONTRACT.audioCodec,
    audio48k:
      Number(media.audio?.sample_rate) === V004B_FINAL_CONTRACT.audioSampleRate,
    audioMono: Number(media.audio?.channels) === V004B_FINAL_CONTRACT.audioChannels,
  };
  return {valid: Object.values(checks).every(Boolean), checks, media};
}


export function evaluateChunkProbe(rawProbe, range, expectedCodecMetadata = null) {
  const media = normalizeProbe(rawProbe);
  const checks = {
    ...baseVideoChecks(media, range.frameCount, range.frameCount / 30, false),
    codecMetadataStable:
      expectedCodecMetadata === null ||
      stableStringify(media.codecMetadata) === stableStringify(expectedCodecMetadata),
  };
  return {valid: Object.values(checks).every(Boolean), checks, media};
}


export function evaluateConcatProbe(rawProbe, expectedCodecMetadata = null) {
  const media = normalizeProbe(rawProbe);
  const checks = {
    ...baseVideoChecks(
      media,
      V004B_FINAL_CONTRACT.durationInFrames,
      V004B_FINAL_CONTRACT.durationSeconds,
      false,
    ),
    codecMetadataStable:
      expectedCodecMetadata === null ||
      stableStringify(media.codecMetadata) === stableStringify(expectedCodecMetadata),
  };
  return {valid: Object.values(checks).every(Boolean), checks, media};
}


export function evaluateFinalProbe(rawProbe, expectedCodecMetadata = null) {
  const media = normalizeProbe(rawProbe);
  const checks = {
    ...baseVideoChecks(
      media,
      V004B_FINAL_CONTRACT.durationInFrames,
      V004B_FINAL_CONTRACT.durationSeconds,
      true,
    ),
    exactlyOneAudio: media.audioStreamCount === 1,
    aac: media.audio?.codec_name === V004B_FINAL_CONTRACT.audioCodec,
    audio48k: Number(media.audio?.sample_rate) === V004B_FINAL_CONTRACT.audioSampleRate,
    audioMono: Number(media.audio?.channels) === V004B_FINAL_CONTRACT.audioChannels,
    codecMetadataStable:
      expectedCodecMetadata === null ||
      stableStringify(media.codecMetadata) === stableStringify(expectedCodecMetadata),
  };
  return {valid: Object.values(checks).every(Boolean), checks, media};
}


function assertValidation(label, validation) {
  if (validation.valid) return;
  const failures = Object.entries(validation.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  throw new Error(`${label} 媒体门禁失败：${failures.join(", ")}`);
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


export async function validateRenderBaseBinding({
  renderBase,
  manifestPath,
  receiptPath,
  expectedManifestSha256,
}) {
  assertHash(expectedManifestSha256, "expected render-base manifest SHA");
  if (
    dirname(resolve(renderBase)) !== dirname(resolve(manifestPath)) ||
    dirname(resolve(renderBase)) !== dirname(resolve(receiptPath))
  ) {
    throw new Error("render-base MP4、manifest 与 durable receipt 必须来自同一发布目录");
  }
  const [baseIntegrity, manifestSnapshot, receiptSnapshot] = await Promise.all([
    inspectFile(renderBase),
    readJsonSnapshot(manifestPath, "render-base manifest"),
    readJsonSnapshot(receiptPath, "render-base durable receipt"),
  ]);
  const manifestIntegrity = manifestSnapshot.integrity;
  const receiptIntegrity = receiptSnapshot.integrity;
  const manifest = manifestSnapshot.value;
  const receipt = receiptSnapshot.value;
  if (manifestIntegrity.sha256 !== expectedManifestSha256) {
    throw new Error("render-base manifest SHA 与冻结值不一致");
  }
  if (
    manifest.schemaVersion !== "agent-skill-long-review-chunked-final-v1" ||
    manifest.reviewStatus !== "render-base-requires-external-subtitle-overlay" ||
    manifest.renderJob?.jobId !==
      "agent-skill-20260806-current-visual-upgrade-render-base-v014" ||
    manifest.renderJob?.candidateVersion !== 14 ||
    manifest.publication?.atomicDirectoryRename !== true ||
    receipt.schemaVersion !== "agent-skill-long-review-publication-state-v1"
  ) {
    throw new Error("render-base manifest/receipt 不是冻结的 v014 render-base 发布合同");
  }
  const contract = manifest.contract ?? {};
  for (const [key, expected] of Object.entries({
    artifactRole: "render-base",
    formalCandidate: false,
    visualSource: "v013@980c4f4be9c1f0bccdcd546873fa1a877c98aac8",
    voice: "v004-full",
    subtitleStyle: "v004b-no-box",
    subtitleDelivery: "external-overlay-required",
    burnInSubtitle: false,
  })) {
    if (contract[key] !== expected) {
      throw new Error(`render-base contract 不匹配：${key}`);
    }
  }
  const recordedBase = manifest.finalMedia?.file;
  if (
    recordedBase?.sha256 !== baseIntegrity.sha256 ||
    recordedBase?.bytes !== baseIntegrity.bytes ||
    receipt.kind !== "durable_receipt" ||
    receipt.output?.fileName !== basename(renderBase) ||
    receipt.output?.sha256 !== baseIntegrity.sha256 ||
    receipt.output?.bytes !== baseIntegrity.bytes ||
    receipt.manifest?.fileName !== basename(manifestPath) ||
    receipt.manifest?.sha256 !== manifestIntegrity.sha256
  ) {
    throw new Error("render-base MP4、manifest 与 durable receipt 未形成一致绑定");
  }
  const expectedBinding = publicationJobBinding(manifest);
  if (
    !HASH_PATTERN.test(expectedBinding.runFingerprint ?? "") ||
    stableStringify(receipt.jobBinding) !== stableStringify(expectedBinding) ||
    receipt.jobBindingSha256 !== sha256Text(stableStringify(expectedBinding))
  ) {
    throw new Error("render-base durable receipt job binding 无效");
  }
  if (
    manifest.finalMedia?.decoding?.videoDecodedWithoutError !== true ||
    manifest.finalMedia?.decoding?.audioDecodedWithoutError !== true
  ) {
    throw new Error("render-base manifest 缺少完整音视频解码证据");
  }
  return {baseIntegrity, manifestIntegrity, receiptIntegrity, manifest, receipt};
}


function strictTimelineCue(rawCue, expectedIndex, label) {
  if (
    !rawCue ||
    typeof rawCue !== "object" ||
    Array.isArray(rawCue) ||
    rawCue.index !== expectedIndex ||
    typeof rawCue.text !== "string" ||
    rawCue.text.trim() === "" ||
    typeof rawCue.start !== "number" ||
    !Number.isFinite(rawCue.start) ||
    typeof rawCue.end !== "number" ||
    !Number.isFinite(rawCue.end) ||
    rawCue.end <= rawCue.start ||
    !Number.isSafeInteger(rawCue.startFrame) ||
    !Number.isSafeInteger(rawCue.endFrameExclusive)
  ) {
    throw new Error(`${label} cue-${expectedIndex} 字段类型/范围无效`);
  }
  return rawCue;
}


function assertOverlayCuesMatchTimeline(overlayCues, timelineCues) {
  if (
    !Array.isArray(overlayCues) ||
    !Array.isArray(timelineCues) ||
    overlayCues.length !== timelineCues.length
  ) {
    throw new Error("overlay cues 与 full timeline 数量不一致");
  }
  const fields = ["index", "text", "start", "end", "startFrame", "endFrameExclusive"];
  for (let position = 0; position < overlayCues.length; position += 1) {
    const index = position + 1;
    const overlayCue = strictTimelineCue(overlayCues[position], index, "overlay");
    const timelineCue = strictTimelineCue(timelineCues[position], index, "timeline");
    for (const field of fields) {
      if (overlayCue[field] !== timelineCue[field]) {
        throw new Error(`overlay cue-${index} 偏离 full timeline：${field}`);
      }
    }
  }
}


export function validateOverlayManifest(
  manifest,
  expectedTimelineSha256,
  {
    timeline = null,
    expectedAcceptedPrefixManifestSha256 = null,
    expectedBuilderSha256 = null,
  } = {},
) {
  assertHash(expectedTimelineSha256, "expected timeline SHA");
  if (manifest.schemaVersion !== V004B_OVERLAY_SCHEMA_VERSION) {
    throw new Error("overlay manifest schema 不匹配");
  }
  if (
    manifest.status !== "full-input" ||
    manifest.fps !== 30 ||
    manifest.durationSeconds !== 600 ||
    manifest.durationInFrames !== 18_000 ||
    manifest.timelineSha256 !== expectedTimelineSha256
  ) {
    throw new Error("overlay manifest 不是完整 600 秒冻结输入");
  }
  if (
    !HASH_PATTERN.test(manifest.builder?.scriptSha256 ?? "") ||
    (expectedBuilderSha256 !== null &&
      manifest.builder.scriptSha256 !== expectedBuilderSha256) ||
    manifest.parameters?.mode !== "full" ||
    manifest.parameters?.fps !== 30 ||
    manifest.parameters?.durationSeconds !== 600 ||
    manifest.parameters?.durationInFrames !== 18_000 ||
    manifest.parameters?.reusePrefixCount !== 24
  ) {
    throw new Error("overlay builder 源码或 full 参数合同未冻结");
  }
  const overlay = manifest.overlay ?? {};
  const expectedOverlay = {
    width: 1480,
    height: 130,
    targetX: 220,
    targetY: 870,
    background: "transparent",
    backgroundAlpha: 0,
    fill: null,
    outline: null,
    borderWidth: 0,
    rectangle: false,
    noContainer: true,
    fontSize: 40,
    fontFamily: "Hiragino Sans GB",
    fontWeight: "W3",
  };
  for (const [key, expected] of Object.entries(expectedOverlay)) {
    if (overlay[key] !== expected) throw new Error(`overlay 样式不匹配：${key}`);
  }
  for (const key of [
    "blankFullyTransparent",
    "allCueFontSizesExactly40",
    "allCueFontWeightsW3",
    "allCueBordersAbsent",
    "allAlphaLocalizedNearGlyphs",
    "allCueAlphaInsideSafeArea",
    "allCuePngsRgba1480x130",
    "acceptedPrefixCuePngsByteExact",
    "noOverlappingCues",
    "noContainer",
  ]) {
    if (manifest.assertions?.[key] !== true) {
      throw new Error(`overlay assertion 未通过：${key}`);
    }
  }
  if (
    manifest.acceptedPrefix?.reusePrefixCount !== 24 ||
    !HASH_PATTERN.test(manifest.acceptedPrefix?.manifestSha256 ?? "") ||
    (expectedAcceptedPrefixManifestSha256 !== null &&
      manifest.acceptedPrefix.manifestSha256 !==
        expectedAcceptedPrefixManifestSha256) ||
    manifest.acceptedPrefix?.allCuePngByteExact !== true ||
    manifest.acceptedPrefix?.blankPngByteExact !== true ||
    !Array.isArray(manifest.acceptedPrefix?.cuePngSha256) ||
    manifest.acceptedPrefix.cuePngSha256.length !== 24
  ) {
    throw new Error("overlay 未逐文件复用 accepted 前 24 个 PNG");
  }
  if (!Array.isArray(manifest.displayCues) || manifest.displayCues.length < 24) {
    throw new Error("overlay displayCues 不完整");
  }
  if (
    manifest.displayCueCount !== manifest.displayCues.length ||
    manifest.reusedCueCount !== 24 ||
    manifest.generatedCueCount !== manifest.displayCues.length - 24
  ) {
    throw new Error("overlay cue 计数合同不一致");
  }
  for (const hash of manifest.acceptedPrefix.cuePngSha256) {
    if (!HASH_PATTERN.test(hash)) throw new Error("accepted prefix cue PNG SHA 无效");
  }
  if (timeline !== null) {
    assertOverlayCuesMatchTimeline(manifest.displayCues, timeline.displayCues);
  }
  return manifest;
}


export async function validateOverlayAssets(manifestPath, manifest) {
  const overlayDirectory = dirname(manifestPath);
  await assertReadOnlyPlainDirectory(overlayDirectory, "overlay 根目录");
  await assertReadOnlyPlainFile(manifestPath, "overlay manifest");
  const frameDirectory = assertInside(
    overlayDirectory,
    resolve(overlayDirectory, manifest.frameDirectory),
    "overlay frame directory",
  );
  await assertReadOnlyPlainDirectory(frameDirectory, "overlay frame directory");
  const blankPath = assertInside(
    overlayDirectory,
    resolve(overlayDirectory, manifest.blankImageFile),
    "overlay blank PNG",
  );
  await assertReadOnlyPlainFile(blankPath, "overlay blank PNG");
  const blankIntegrity = await inspectFile(blankPath);
  if (blankIntegrity.sha256 !== manifest.blankImageSha256) {
    throw new Error("overlay blank PNG 哈希漂移");
  }
  const owners = Array(V004B_FINAL_CONTRACT.durationInFrames).fill(null);
  const images = new Map();
  for (let position = 0; position < manifest.displayCues.length; position += 1) {
    const record = manifest.displayCues[position];
    const index = position + 1;
    if (
      record?.index !== index ||
      record.imageFile !== `cue-${String(index).padStart(3, "0")}.png` ||
      !HASH_PATTERN.test(record.imageSha256 ?? "") ||
      !Number.isSafeInteger(record.startFrame) ||
      !Number.isSafeInteger(record.endFrameExclusive) ||
      record.startFrame < 0 ||
      record.endFrameExclusive > owners.length ||
      record.endFrameExclusive <= record.startFrame ||
      record.fontSize !== 40 ||
      record.fontWeight !== "W3" ||
      record.provenance !==
        (index <= 24
          ? "byte-exact-accepted-v004b-proof"
          : "generated-with-accepted-v004b-style") ||
      record.borderAlphaMax !== 0 ||
      record.alphaCoverageRatio >= 0.30 ||
      record.insideCaptionSafeArea !== true
    ) {
      throw new Error(`overlay cue-${index} 记录不合格`);
    }
    const imagePath = assertInside(
      overlayDirectory,
      resolve(overlayDirectory, record.imageFile),
      `overlay cue-${index} PNG`,
    );
    await assertReadOnlyPlainFile(imagePath, `overlay cue-${index} PNG`);
    const integrity = await inspectFile(imagePath);
    if (integrity.sha256 !== record.imageSha256) {
      throw new Error(`overlay cue-${index} PNG 哈希漂移`);
    }
    if (
      index <= 24 &&
      integrity.sha256 !== manifest.acceptedPrefix.cuePngSha256[index - 1]
    ) {
      throw new Error(`overlay cue-${index} 不再逐字节匹配 accepted prefix`);
    }
    images.set(index, imagePath);
    for (let frame = record.startFrame; frame < record.endFrameExclusive; frame += 1) {
      if (owners[frame] !== null) throw new Error(`overlay cues 重叠于 frame ${frame}`);
      owners[frame] = index;
    }
  }
  if (sha256Text(stableStringify(owners)) !== manifest.frameOwnerSha256) {
    throw new Error("overlay frame owner 映射哈希漂移");
  }
  const entries = await readdir(frameDirectory);
  if (entries.length !== owners.length) {
    throw new Error(`overlay frame 数量必须恰好为 ${owners.length}`);
  }
  for (let frame = 0; frame < owners.length; frame += 1) {
    const framePath = resolve(frameDirectory, `frame-${String(frame).padStart(5, "0")}.png`);
    const details = await lstat(framePath);
    if (!details.isSymbolicLink()) throw new Error(`overlay frame ${frame} 必须是符号链接`);
    const target = resolve(frameDirectory, await readlink(framePath));
    const expected = owners[frame] === null ? blankPath : images.get(owners[frame]);
    if (target !== expected) throw new Error(`overlay frame ${frame} 指向错误 PNG`);
  }
  return {overlayDirectory, frameDirectory, blankIntegrity};
}


export async function resolveMediaTool(type, override) {
  let path;
  if (override) {
    path = resolve(override);
  } else {
    const systemCandidates = process.platform === "darwin"
      ? [`/opt/homebrew/bin/${type}`, `/usr/local/bin/${type}`]
      : [`/usr/bin/${type}`, `/usr/local/bin/${type}`];
    path = null;
    for (const candidate of systemCandidates) {
      if (await pathExists(candidate)) {
        path = candidate;
        break;
      }
    }
    path ??= RenderInternals.getExecutablePath({
      type,
      indent: false,
      logLevel: "error",
      binariesDirectory: null,
    });
  }
  // Homebrew exposes versioned binaries through /opt/homebrew/bin symlinks.
  // Resolve once, then freeze and execute the ordinary Cellar file so later
  // symlink retargeting cannot change the tool used by this run.
  path = await realpath(path);
  await assertPlainFile(path, type);
  return {path, directory: dirname(path)};
}


function mediaEnvironment(tool) {
  return {
    ...process.env,
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    ...(process.platform === "darwin" ? {DYLD_LIBRARY_PATH: tool.directory} : {}),
  };
}


async function runTool(tool, args, timeout = 600_000) {
  try {
    return await execFileAsync(tool.path, args, {
      cwd: tool.directory,
      env: mediaEnvironment(tool),
      timeout,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim();
    throw new Error(`${tool.path.split("/").at(-1)} 失败：${detail}`, {cause: error});
  }
}


export function assertRequiredOverlayFiltersText(filtersText) {
  if (typeof filtersText !== "string") {
    throw new TypeError("FFmpeg filter listing must be text");
  }
  const missing = [
    ["setpts", /\bsetpts\s+V->V\b/u],
    ["overlay", /\boverlay\s+VV->V\b/u],
  ]
    .filter(([, pattern]) => !pattern.test(filtersText))
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `字幕合成 FFmpeg 缺少必需视频过滤器：${missing.join(", ")}；` +
        "请使用完整系统 FFmpeg，而不是 Remotion 裁剪版",
    );
  }
  return true;
}


async function assertOverlayFfmpegCapabilities(ffmpeg) {
  const {stdout, stderr} = await runTool(
    ffmpeg,
    ["-hide_banner", "-filters"],
    10_000,
  );
  assertRequiredOverlayFiltersText(`${stdout}${stderr}`);
}


export async function probeMedia(ffprobe, path) {
  const {stdout} = await runTool(ffprobe, [
    "-v",
    "error",
    "-count_frames",
    "-show_entries",
    "format=format_name,start_time,duration,size:stream=index,codec_type,codec_name,profile,codec_tag_string,codec_tag,width,height,coded_width,coded_height,has_b_frames,pix_fmt,level,color_range,color_space,color_transfer,color_primaries,chroma_location,field_order,refs,is_avc,nal_length_size,bits_per_raw_sample,r_frame_rate,avg_frame_rate,time_base,start_time,duration,nb_frames,nb_read_frames,sample_rate,channels,channel_layout",
    "-of",
    "json",
    path,
  ]);
  return JSON.parse(stdout);
}


export async function decodeVideo(ffmpeg, path) {
  await runTool(ffmpeg, buildVideoDecodeFfmpegArgs(path), 900_000);
}


export async function decodeAudio(ffmpeg, path) {
  await runTool(ffmpeg, buildAudioDecodeFfmpegArgs(path), 900_000);
}


async function publishPartExclusively(partPath, stablePath) {
  if (await pathExists(stablePath)) throw new Error(`拒绝覆盖既有产物：${stablePath}`);
  await link(partPath, stablePath);
  await unlink(partPath);
}


async function writeJsonExclusive(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}


async function preserveIncompletePair(jobLock, paths, reason) {
  const token = `${Date.now()}-${randomUUID()}`;
  const preserved = [];
  for (const sourcePath of paths) {
    if (!(await pathExists(sourcePath))) continue;
    const destinationPath = `${sourcePath}.preserved-${reason}-${token}`;
    await whileOwned(jobLock, () => rename(sourcePath, destinationPath));
    preserved.push(destinationPath);
  }
  if (preserved.length > 0) {
    await whileOwned(jobLock, () =>
      syncLongReviewRenderDirectory(dirname(preserved[0])),
    );
  }
  return preserved;
}


function chunkName(range) {
  return `chunk-${String(range.startFrame).padStart(5, "0")}-${String(range.endFrameInclusive).padStart(5, "0")}`;
}


async function inspectOrCreateChunk({
  jobLock,
  ffmpeg,
  ffprobe,
  renderBase,
  framePattern,
  chunksDirectory,
  range,
  runFingerprint,
  expectedCodecMetadata,
}) {
  await whileOwned(jobLock, () =>
    assertPlainDirectory(chunksDirectory, "overlay chunks 目录"),
  );
  const stem = chunkName(range);
  const outputPath = resolve(chunksDirectory, `${stem}.mp4`);
  const recordPath = resolve(chunksDirectory, `${stem}.json`);
  let outputExists = await pathExists(outputPath);
  let recordExists = await pathExists(recordPath);
  if (outputExists !== recordExists) {
    await preserveIncompletePair(
      jobLock,
      [outputPath, recordPath],
      "incomplete-chunk",
    );
    outputExists = false;
    recordExists = false;
  }
  if (!outputExists) {
    const partPath = resolve(chunksDirectory, `${stem}.part-${randomUUID()}.mp4`);
    await whileOwned(jobLock, () =>
      runTool(
        ffmpeg,
        buildOverlayChunkFfmpegArgs({
          renderBase,
          framePattern,
          output: partPath,
          range,
        }),
      ),
    );
    const [integrity, rawProbe] = await whileOwned(jobLock, () =>
      Promise.all([inspectFile(partPath), probeMedia(ffprobe, partPath)]),
    );
    const validation = evaluateChunkProbe(rawProbe, range, expectedCodecMetadata);
    assertValidation(stem, validation);
    await whileOwned(jobLock, () => decodeVideo(ffmpeg, partPath));
    await whileOwned(jobLock, () =>
      publishPartExclusively(partPath, outputPath),
    );
    await whileOwned(jobLock, () => writeJsonExclusive(recordPath, {
      schemaVersion: "agent-skill-v004b-no-box-overlay-chunk-v1",
      runFingerprint,
      range,
      file: {path: outputPath, ...integrity},
      probeSha256: sha256Text(stableStringify(rawProbe)),
      codecMetadata: validation.media.codecMetadata,
      decoding: {videoDecodedWithoutError: true, mode: "sequential-rawvideo-null"},
      validatedAt: new Date().toISOString(),
    }));
  }
  const [record, integrity, rawProbe] = await Promise.all([
    readJsonFile(recordPath, `${stem} record`),
    inspectFile(outputPath),
    probeMedia(ffprobe, outputPath),
  ]);
  const validation = evaluateChunkProbe(rawProbe, range, expectedCodecMetadata);
  assertValidation(stem, validation);
  if (
    record.runFingerprint !== runFingerprint ||
    stableStringify(record.range) !== stableStringify(range) ||
    record.file?.sha256 !== integrity.sha256 ||
    record.file?.bytes !== integrity.bytes ||
    record.decoding?.videoDecodedWithoutError !== true
  ) {
    throw new Error(`${stem} 不满足可续跑绑定，拒绝覆盖`);
  }
  await whileOwned(jobLock, () => decodeVideo(ffmpeg, outputPath));
  return {outputPath, record, integrity, validation};
}


async function inspectOrCreateConcat({
  jobLock,
  ffmpeg,
  ffprobe,
  chunkResults,
  stagingDirectory,
  runFingerprint,
  expectedCodecMetadata,
}) {
  await whileOwned(jobLock, () =>
    assertPlainDirectory(stagingDirectory, "overlay staging 目录"),
  );
  const outputPath = resolve(stagingDirectory, "video-overlay-concat.mp4");
  const recordPath = resolve(stagingDirectory, "video-overlay-concat.json");
  let outputExists = await pathExists(outputPath);
  let recordExists = await pathExists(recordPath);
  if (outputExists !== recordExists) {
    await preserveIncompletePair(
      jobLock,
      [outputPath, recordPath],
      "incomplete-concat",
    );
    outputExists = false;
    recordExists = false;
  }
  const orderedChunkSha256 = sha256Text(
    stableStringify(chunkResults.map((item) => item.integrity.sha256)),
  );
  if (!outputExists) {
    const token = randomUUID();
    const listPath = resolve(stagingDirectory, `chunks-${token}.concat.txt`);
    const partPath = resolve(stagingDirectory, `video-overlay-concat.part-${token}.mp4`);
    await writeFile(
      listPath,
      buildConcatList(chunkResults.map((item) => item.outputPath)),
      {encoding: "utf8", flag: "wx"},
    );
    await whileOwned(jobLock, () =>
      runTool(ffmpeg, buildConcatFfmpegArgs(listPath, partPath)),
    );
    const [integrity, rawProbe] = await whileOwned(jobLock, () =>
      Promise.all([inspectFile(partPath), probeMedia(ffprobe, partPath)]),
    );
    const validation = evaluateConcatProbe(rawProbe, expectedCodecMetadata);
    assertValidation("lossless concat", validation);
    await whileOwned(jobLock, () => decodeVideo(ffmpeg, partPath));
    await whileOwned(jobLock, () =>
      publishPartExclusively(partPath, outputPath),
    );
    await whileOwned(jobLock, () => writeJsonExclusive(recordPath, {
      schemaVersion: "agent-skill-v004b-no-box-overlay-concat-v1",
      runFingerprint,
      orderedChunkSha256,
      file: {path: outputPath, ...integrity},
      probeSha256: sha256Text(stableStringify(rawProbe)),
      codecMetadata: validation.media.codecMetadata,
      decoding: {videoDecodedWithoutError: true, mode: "sequential-rawvideo-null"},
      validatedAt: new Date().toISOString(),
    }));
  }
  const [record, integrity, rawProbe] = await Promise.all([
    readJsonFile(recordPath, "concat record"),
    inspectFile(outputPath),
    probeMedia(ffprobe, outputPath),
  ]);
  const validation = evaluateConcatProbe(rawProbe, expectedCodecMetadata);
  assertValidation("lossless concat", validation);
  if (
    record.runFingerprint !== runFingerprint ||
    record.orderedChunkSha256 !== orderedChunkSha256 ||
    record.file?.sha256 !== integrity.sha256 ||
    record.file?.bytes !== integrity.bytes ||
    record.decoding?.videoDecodedWithoutError !== true
  ) {
    throw new Error("concat 不满足可续跑绑定，拒绝覆盖");
  }
  await whileOwned(jobLock, () => decodeVideo(ffmpeg, outputPath));
  return {outputPath, record, integrity, validation};
}


async function inspectOrCreateFinalMux({
  jobLock,
  ffmpeg,
  ffprobe,
  concat,
  voice,
  voiceIntegrity,
  stagingDirectory,
  runFingerprint,
  expectedCodecMetadata,
}) {
  await whileOwned(jobLock, () =>
    assertPlainDirectory(stagingDirectory, "overlay staging 目录"),
  );
  const outputPath = resolve(stagingDirectory, "review-10m-v004b-no-box.validated.mp4");
  const recordPath = resolve(stagingDirectory, "review-10m-v004b-no-box.json");
  let outputExists = await pathExists(outputPath);
  let recordExists = await pathExists(recordPath);
  if (outputExists !== recordExists) {
    await preserveIncompletePair(
      jobLock,
      [outputPath, recordPath],
      "incomplete-final-mux",
    );
    outputExists = false;
    recordExists = false;
  }
  if (!outputExists) {
    const partPath = resolve(
      stagingDirectory,
      `review-10m-v004b-no-box.part-${randomUUID()}.mp4`,
    );
    await whileOwned(jobLock, () =>
      runTool(ffmpeg, buildAudioMuxFfmpegArgs(concat.outputPath, voice, partPath)),
    );
    const [integrity, rawProbe] = await whileOwned(jobLock, () =>
      Promise.all([inspectFile(partPath), probeMedia(ffprobe, partPath)]),
    );
    const validation = evaluateFinalProbe(rawProbe, expectedCodecMetadata);
    assertValidation("final overlay/audio mux", validation);
    await whileOwned(jobLock, () => decodeVideo(ffmpeg, partPath));
    await whileOwned(jobLock, () => decodeAudio(ffmpeg, partPath));
    await whileOwned(jobLock, () =>
      publishPartExclusively(partPath, outputPath),
    );
    await whileOwned(jobLock, () => writeJsonExclusive(recordPath, {
      schemaVersion: "agent-skill-v004b-no-box-final-media-v1",
      runFingerprint,
      concatSha256: concat.integrity.sha256,
      voiceSha256: voiceIntegrity.sha256,
      file: {path: outputPath, ...integrity},
      probeSha256: sha256Text(stableStringify(rawProbe)),
      codecMetadata: validation.media.codecMetadata,
      audio: {codec: "aac", sampleRate: 48_000, channels: 1, bitrate: "192k"},
      decoding: {
        videoDecodedWithoutError: true,
        audioDecodedWithoutError: true,
        videoMode: "sequential-rawvideo-null",
        audioMode: "sequential-pcm-s16le-null",
      },
      validatedAt: new Date().toISOString(),
    }));
  }
  const [record, integrity, rawProbe] = await Promise.all([
    readJsonFile(recordPath, "final mux record"),
    inspectFile(outputPath),
    probeMedia(ffprobe, outputPath),
  ]);
  const validation = evaluateFinalProbe(rawProbe, expectedCodecMetadata);
  assertValidation("final overlay/audio mux", validation);
  if (
    record.runFingerprint !== runFingerprint ||
    record.concatSha256 !== concat.integrity.sha256 ||
    record.voiceSha256 !== voiceIntegrity.sha256 ||
    record.file?.sha256 !== integrity.sha256 ||
    record.file?.bytes !== integrity.bytes ||
    record.decoding?.videoDecodedWithoutError !== true ||
    record.decoding?.audioDecodedWithoutError !== true
  ) {
    throw new Error("最终 mux 不满足可续跑绑定，拒绝覆盖");
  }
  await whileOwned(jobLock, () => decodeVideo(ffmpeg, outputPath));
  await whileOwned(jobLock, () => decodeAudio(ffmpeg, outputPath));
  return {outputPath, record, integrity, validation};
}


async function assertFrozenInput(path, expectedSha256, label) {
  const integrity = await inspectFile(path);
  if (integrity.sha256 !== expectedSha256) {
    throw new Error(`${label} SHA 与冻结值不一致`);
  }
  return integrity;
}


async function validateTimeline(path, expectedSha256) {
  await assertReadOnlyPlainFile(path, "full timeline");
  const snapshot = await readJsonSnapshot(path, "full timeline");
  const {integrity, value: timeline} = snapshot;
  if (integrity.sha256 !== expectedSha256) {
    throw new Error("timeline SHA 与冻结值不一致");
  }
  if (
    timeline.fps !== 30 ||
    timeline.durationInFrames !== 18_000 ||
    Math.abs(Number(timeline.durationSeconds) - 600) > 0.001 ||
    !Array.isArray(timeline.displayCues) ||
    timeline.displayCues.length < 24
  ) {
    throw new Error("full timeline 不是 30fps / 18000帧 / 600秒完整输入");
  }
  let previousEndFrame = 0;
  for (let position = 0; position < timeline.displayCues.length; position += 1) {
    const cue = strictTimelineCue(
      timeline.displayCues[position],
      position + 1,
      "timeline",
    );
    if (
      cue.startFrame < previousEndFrame ||
      cue.startFrame < 0 ||
      cue.endFrameExclusive > V004B_FINAL_CONTRACT.durationInFrames ||
      cue.endFrameExclusive <= cue.startFrame ||
      Math.abs(cue.start - cue.startFrame / 30) > 1 / 30 + 1e-6 ||
      Math.abs(cue.end - cue.endFrameExclusive / 30) > 1 / 30 + 1e-6
    ) {
      throw new Error(`timeline cue-${position + 1} 帧范围/秒数无效或重叠`);
    }
    previousEndFrame = cue.endFrameExclusive;
  }
  return {integrity, timeline};
}


async function validateVoice(ffprobe, path, expectedSha256) {
  await assertReadOnlyPlainFile(path, "full voice");
  const integrity = await assertFrozenInput(path, expectedSha256, "full voice");
  const rawProbe = await probeMedia(ffprobe, path);
  const media = normalizeProbe(rawProbe);
  const duration = Number(rawProbe?.format?.duration ?? media.audio?.duration);
  if (
    media.audioStreamCount !== 1 ||
    media.videoStreamCount !== 0 ||
    Number(media.audio?.sample_rate) !== 48_000 ||
    Number(media.audio?.channels) !== 1 ||
    !Number.isFinite(duration) ||
    Math.abs(duration - 600) > 0.02
  ) {
    throw new Error("full voice 必须是 48kHz mono 且精确 600 秒");
  }
  return {integrity, rawProbe};
}


function publicationMarker(kind, identity) {
  return {
    schemaVersion: PUBLICATION_STATE_SCHEMA_VERSION,
    kind,
    ...identity,
    recordedAt: new Date().toISOString(),
  };
}


async function whileOwned(jobLock, operation) {
  jobLock.assertOwned();
  const result = await operation();
  jobLock.assertOwned();
  return result;
}


export async function publishFinalCandidateAtomically({
  jobLock,
  finalMedia,
  finalManifest,
  stagingDirectory,
  outputDirectory,
}) {
  await assertPlainDirectory(stagingDirectory, "最终候选 staging 目录");
  if (await pathExists(outputDirectory)) {
    throw new Error(`正式候选目录已存在，拒绝覆盖：${outputDirectory}`);
  }
  const publicationPart = resolve(
    stagingDirectory,
    `.v004b-no-box-publication.attempt-${jobLock.token}.${randomUUID()}.part`,
  );
  await whileOwned(jobLock, () => mkdir(publicationPart, {recursive: false}));
  const partVideo = resolve(publicationPart, V004B_FINAL_PATHS.outputFileName);
  const partManifest = resolve(publicationPart, V004B_FINAL_PATHS.manifestFileName);
  const partPending = resolve(publicationPart, PUBLICATION_PENDING_FILE_NAME);
  await whileOwned(jobLock, () =>
    copyFile(finalMedia.outputPath, partVideo, fsConstants.COPYFILE_EXCL),
  );
  const copiedIntegrity = await whileOwned(jobLock, () => inspectFile(partVideo));
  if (
    copiedIntegrity.sha256 !== finalMedia.integrity.sha256 ||
    copiedIntegrity.bytes !== finalMedia.integrity.bytes
  ) {
    throw new Error("正式候选 staging copy 与已验证 mux 产物不一致");
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(finalManifest, null, 2)}\n`);
  await whileOwned(jobLock, () =>
    writeFile(partManifest, manifestBytes, {flag: "wx"}),
  );
  const jobBinding = publicationJobBinding(finalManifest);
  const identity = {
    attemptToken: jobLock.token,
    output: {
      fileName: V004B_FINAL_PATHS.outputFileName,
      ...copiedIntegrity,
    },
    manifest: {
      fileName: V004B_FINAL_PATHS.manifestFileName,
      sha256: sha256Text(manifestBytes),
    },
    jobBinding,
    jobBindingSha256: sha256Text(stableStringify(jobBinding)),
  };
  await whileOwned(jobLock, () =>
    writeFile(
      partPending,
      `${JSON.stringify(publicationMarker("durability_unknown", identity), null, 2)}\n`,
      {encoding: "utf8", flag: "wx"},
    ),
  );
  await whileOwned(jobLock, async () => {
    await Promise.all([
      syncLongReviewRenderFile(partVideo),
      syncLongReviewRenderFile(partManifest),
      syncLongReviewRenderFile(partPending),
    ]);
    await syncLongReviewRenderDirectory(publicationPart);
    await syncLongReviewRenderDirectory(stagingDirectory);
  });
  if (await pathExists(outputDirectory)) {
    throw new Error(`正式候选目录已出现，拒绝覆盖：${outputDirectory}`);
  }
  await whileOwned(jobLock, () => rename(publicationPart, outputDirectory));
  const publishedVideo = resolve(
    outputDirectory,
    V004B_FINAL_PATHS.outputFileName,
  );
  const finalManifestPath = resolve(
    outputDirectory,
    V004B_FINAL_PATHS.manifestFileName,
  );
  const pendingPath = resolve(outputDirectory, PUBLICATION_PENDING_FILE_NAME);
  await whileOwned(jobLock, async () => {
    await Promise.all([
      syncLongReviewRenderFile(publishedVideo),
      syncLongReviewRenderFile(finalManifestPath),
      syncLongReviewRenderFile(pendingPath),
    ]);
    await syncLongReviewRenderDirectory(outputDirectory);
    await syncLongReviewRenderDirectory(dirname(outputDirectory));
  });
  const receiptPath = resolve(outputDirectory, PUBLICATION_RECEIPT_FILE_NAME);
  await whileOwned(jobLock, () =>
    writeJsonExclusive(receiptPath, publicationMarker("durable_receipt", identity)),
  );
  await whileOwned(jobLock, async () => {
    await syncLongReviewRenderFile(receiptPath);
    await syncLongReviewRenderDirectory(outputDirectory);
  });
  let cleanupWarning = null;
  try {
    await whileOwned(jobLock, () => unlink(pendingPath));
    await whileOwned(jobLock, () => syncLongReviewRenderDirectory(outputDirectory));
  } catch (error) {
    cleanupWarning = {
      code: error?.code ?? "pending_marker_cleanup_failed",
      message: String(error?.message ?? error),
    };
  }
  const publishedIntegrity = await whileOwned(jobLock, () =>
    inspectFile(publishedVideo),
  );
  if (stableStringify(publishedIntegrity) !== stableStringify(copiedIntegrity)) {
    throw new Error("正式候选在 durable publication 后发生漂移");
  }
  return {
    publishedVideo,
    publishedIntegrity,
    finalManifestPath,
    receiptPath,
    cleanupWarning,
  };
}


async function prepareDirectories(workDirectory, outputDirectory) {
  assertFormalOutputLayout({workDirectory, outputDirectory});
  await assertPlainDirectory(REVIEW_CANDIDATES_DIRECTORY, "review-candidates 根目录");
  if (await pathExists(outputDirectory)) {
    throw new Error(`正式候选目录已存在，拒绝覆盖：${outputDirectory}`);
  }
  if (await pathExists(workDirectory)) {
    await assertPlainDirectory(workDirectory, "可续跑工作目录");
  } else {
    await mkdir(workDirectory, {recursive: false});
  }
  const chunksDirectory = resolve(workDirectory, "chunks");
  const stagingDirectory = resolve(workDirectory, "staging");
  for (const [directory, label] of [
    [chunksDirectory, "overlay chunks 目录"],
    [stagingDirectory, "overlay staging 目录"],
  ]) {
    if (await pathExists(directory)) await assertPlainDirectory(directory, label);
    else await mkdir(directory, {recursive: false});
  }
  return {chunksDirectory, stagingDirectory};
}


export async function buildAgentSkillV004bNoBoxFinal(options) {
  requireFormalOptions(options);
  const resolved = Object.fromEntries(
    [
      "renderBase",
      "renderBaseManifest",
      "renderBaseReceipt",
      "overlayManifest",
      "timeline",
      "voice",
      "workDirectory",
      "outputDirectory",
    ].map((key) => [key, resolve(options[key])]),
  );
  if (resolved.workDirectory === resolved.outputDirectory) {
    throw new Error("work-directory 与 output-directory 必须隔离");
  }
  assertFormalOutputLayout({
    workDirectory: resolved.workDirectory,
    outputDirectory: resolved.outputDirectory,
  });
  assertFormalInputLayout(resolved);
  const [ffmpeg, ffprobe] = await Promise.all([
    resolveMediaTool("ffmpeg", options.ffmpeg),
    resolveMediaTool("ffprobe", options.ffprobe),
  ]);
  await assertOverlayFfmpegCapabilities(ffmpeg);
  const [
    baseBinding,
    overlaySnapshot,
    timelineResult,
    voiceResult,
    overlayBuilderIntegrity,
    finalBuilderIntegrity,
    longRenderJobIntegrity,
  ] =
    await Promise.all([
      validateRenderBaseBinding({
        renderBase: resolved.renderBase,
        manifestPath: resolved.renderBaseManifest,
        receiptPath: resolved.renderBaseReceipt,
        expectedManifestSha256: options.expectedRenderBaseManifestSha256,
      }),
      readJsonSnapshot(resolved.overlayManifest, "overlay manifest"),
      validateTimeline(resolved.timeline, options.expectedTimelineSha256),
      validateVoice(ffprobe, resolved.voice, options.expectedVoiceSha256),
      inspectFile(PYTHON_OVERLAY_BUILDER_PATH),
      inspectFile(SCRIPT_PATH),
      inspectFile(LONG_RENDER_JOB_MODULE_PATH),
    ]);
  const overlayIntegrity = overlaySnapshot.integrity;
  const overlayManifest = overlaySnapshot.value;
  if (overlayIntegrity.sha256 !== options.expectedOverlayManifestSha256) {
    throw new Error("overlay manifest SHA 与冻结值不一致");
  }
  validateOverlayManifest(overlayManifest, timelineResult.integrity.sha256, {
    timeline: timelineResult.timeline,
    expectedAcceptedPrefixManifestSha256:
      options.expectedAcceptedPrefixManifestSha256,
    expectedBuilderSha256: overlayBuilderIntegrity.sha256,
  });
  const overlayAssets = await validateOverlayAssets(
    resolved.overlayManifest,
    overlayManifest,
  );
  const baseProbe = await probeMedia(ffprobe, resolved.renderBase);
  const baseValidation = evaluateRenderBaseProbe(baseProbe);
  assertValidation("render-base", baseValidation);
  await decodeVideo(ffmpeg, resolved.renderBase);

  const ranges = buildChunkRanges();
  if (ranges.length !== 20) throw new Error("正式字幕合成必须恰好为 20 段");
  const toolIdentity = {};
  for (const [name, tool] of [["ffmpeg", ffmpeg], ["ffprobe", ffprobe]]) {
    const {stdout, stderr} = await runTool(tool, ["-version"], 10_000);
    toolIdentity[name] = {
      path: tool.path,
      version: `${stdout}${stderr}`.split(/\r?\n/u)[0],
    };
  }
  const fingerprintPayload = {
    schemaVersion: V004B_FINAL_SCHEMA_VERSION,
    contract: V004B_FINAL_CONTRACT,
    inputs: {
      renderBase: baseBinding.baseIntegrity,
      renderBaseManifest: baseBinding.manifestIntegrity,
      renderBaseReceipt: baseBinding.receiptIntegrity,
      overlayManifest: overlayIntegrity,
      overlayBuilder: overlayBuilderIntegrity,
      finalBuilder: finalBuilderIntegrity,
      ownerLockAndDurabilityModule: longRenderJobIntegrity,
      acceptedPrefixManifest: {
        sha256: options.expectedAcceptedPrefixManifestSha256,
      },
      timeline: timelineResult.integrity,
      voice: voiceResult.integrity,
    },
    tools: toolIdentity,
    ranges,
  };
  const runFingerprint = sha256Text(stableStringify(fingerprintPayload));
  const plan = {
    runFingerprint,
    ranges,
    contract: V004B_FINAL_CONTRACT,
    paths: resolved,
    inputs: fingerprintPayload.inputs,
    tools: toolIdentity,
    overlayAssets: {
      frameDirectory: overlayAssets.frameDirectory,
      frameCount: V004B_FINAL_CONTRACT.durationInFrames,
    },
  };
  if (options.dryRun) return {dryRun: true, plan};

  const {chunksDirectory, stagingDirectory} = await prepareDirectories(
    resolved.workDirectory,
    resolved.outputDirectory,
  );
  const jobLock = await acquireLongReviewRenderJobLock(resolved.workDirectory, {
    jobId: FINAL_CANDIDATE_JOB_ID,
    publicationDirectory: resolved.workDirectory,
  });
  try {
    jobLock.assertOwned();
    const runManifestPath = resolve(resolved.workDirectory, "run-manifest.json");
    if (await pathExists(runManifestPath)) {
      const existing = await readJsonFile(runManifestPath, "existing run manifest");
      if (existing.runFingerprint !== runFingerprint) {
        throw new Error("既有可续跑工作目录属于不同输入，拒绝覆盖");
      }
    } else {
      await writeJsonExclusive(runManifestPath, {
        ...plan,
        schemaVersion: "agent-skill-v004b-no-box-overlay-run-v1",
        createdAt: new Date().toISOString(),
      });
    }

    const framePattern = resolve(overlayAssets.frameDirectory, "frame-%05d.png");
    const chunkResults = [];
    let expectedCodecMetadata = null;
    for (const range of ranges) {
      jobLock.assertOwned();
      process.stdout.write(
        `overlay chunk ${range.index + 1}/${ranges.length} frames ${range.startFrame}-${range.endFrameInclusive}\n`,
      );
      const result = await inspectOrCreateChunk({
        jobLock,
        ffmpeg,
        ffprobe,
        renderBase: resolved.renderBase,
        framePattern,
        chunksDirectory,
        range,
        runFingerprint,
        expectedCodecMetadata,
      });
      jobLock.assertOwned();
      expectedCodecMetadata ??= result.validation.media.codecMetadata;
      chunkResults.push(result);
    }
    jobLock.assertOwned();
    const concatenated = await inspectOrCreateConcat({
      jobLock,
      ffmpeg,
      ffprobe,
      chunkResults,
      stagingDirectory,
      runFingerprint,
      expectedCodecMetadata,
    });
    jobLock.assertOwned();
    const finalMedia = await inspectOrCreateFinalMux({
      jobLock,
      ffmpeg,
      ffprobe,
      concat: concatenated,
      voice: resolved.voice,
      voiceIntegrity: voiceResult.integrity,
      stagingDirectory,
      runFingerprint,
      expectedCodecMetadata,
    });
    jobLock.assertOwned();

    for (const [path, expected] of [
      [resolved.renderBaseManifest, options.expectedRenderBaseManifestSha256],
      [resolved.overlayManifest, options.expectedOverlayManifestSha256],
      [resolved.timeline, options.expectedTimelineSha256],
      [resolved.voice, options.expectedVoiceSha256],
      [PYTHON_OVERLAY_BUILDER_PATH, overlayBuilderIntegrity.sha256],
      [SCRIPT_PATH, finalBuilderIntegrity.sha256],
      [LONG_RENDER_JOB_MODULE_PATH, longRenderJobIntegrity.sha256],
    ]) {
      await assertFrozenInput(path, expected, "发布前冻结输入");
    }
    const currentBase = await inspectFile(resolved.renderBase);
    if (currentBase.sha256 !== baseBinding.baseIntegrity.sha256) {
      throw new Error("发布前 render-base MP4 已漂移");
    }
    await validateOverlayAssets(resolved.overlayManifest, overlayManifest);
    jobLock.assertOwned();
    const publishedVideoPath = resolve(
      resolved.outputDirectory,
      V004B_FINAL_PATHS.outputFileName,
    );
    const finalManifest = {
      schemaVersion: V004B_FINAL_SCHEMA_VERSION,
      status: "machine-validated-awaiting-visual-qa",
      reviewStatus: "formal-candidate-awaiting-continuous-1x-visual-qa",
      warning: "该正式候选尚未完成连续 1x 人工视觉验收；v004-full 旁白是临时声音，不是最终真人录音。",
      completedAt: new Date().toISOString(),
      runFingerprint,
      renderJob: {
        jobId: FINAL_CANDIDATE_JOB_ID,
        candidateVersion: V004B_FINAL_CANDIDATE_VERSION,
      },
      contract: {
        ...V004B_FINAL_CONTRACT,
        episodeId: "agent-skill-20260806",
        compositionId: "AgentSkillLongReview",
        artifactRole: "formal-candidate",
        formalCandidate: true,
        visualSource: "v013@980c4f4be9c1f0bccdcd546873fa1a877c98aac8",
        voice: "v004-full",
        voiceIsTemporary: true,
        subtitleStyle: "v004b-no-box",
        subtitleDelivery: "external-overlay-applied",
        burnInSubtitle: false,
        overlayEncoding: "20x900-frame-serial",
        concat: "ffmpeg-concat-stream-copy",
        audioMux: "single-final-mux",
        machineValidation: true,
        humanVisualApproval: false,
        continuousOneXWatchCompleted: false,
        finalHumanRecording: false,
        acceptedForRelease: false,
      },
      renderBase: {
        jobId: baseBinding.manifest.renderJob.jobId,
        candidateVersion: baseBinding.manifest.renderJob.candidateVersion,
        artifactRole: baseBinding.manifest.contract.artifactRole,
        formalCandidate: baseBinding.manifest.contract.formalCandidate,
        subtitleDelivery: baseBinding.manifest.contract.subtitleDelivery,
        path: resolved.renderBase,
        ...baseBinding.baseIntegrity,
        manifestPath: resolved.renderBaseManifest,
        manifestSha256: baseBinding.manifestIntegrity.sha256,
        durableReceiptPath: resolved.renderBaseReceipt,
        durableReceiptSha256: baseBinding.receiptIntegrity.sha256,
      },
      overlay: {
        artifactRole: "v004b-no-box-overlay-input",
        manifestPath: resolved.overlayManifest,
        ...overlayIntegrity,
        builderPath: PYTHON_OVERLAY_BUILDER_PATH,
        builderSha256: overlayBuilderIntegrity.sha256,
        acceptedPrefixManifestSha256:
          options.expectedAcceptedPrefixManifestSha256,
        timelinePath: resolved.timeline,
        timelineSha256: timelineResult.integrity.sha256,
      },
      builder: {
        path: SCRIPT_PATH,
        ...finalBuilderIntegrity,
        dependencies: {
          ownerLockAndDurabilityModulePath: LONG_RENDER_JOB_MODULE_PATH,
          ownerLockAndDurabilityModuleSha256: longRenderJobIntegrity.sha256,
        },
      },
      voice: {
        path: resolved.voice,
        ...voiceResult.integrity,
        profile: "v004-full",
        temporary: true,
        finalHumanRecording: false,
      },
      chunks: chunkResults.map((item) => item.record),
      concat: concatenated.record,
      finalMedia: {
        ...finalMedia.record,
        published: {path: publishedVideoPath, ...finalMedia.integrity},
      },
      publication: {
        atomicDirectoryRename: true,
        nonOverwriting: true,
        durabilityProtocol: "file-and-directory-fsync-with-durable-receipt-v1",
        outputPath: publishedVideoPath,
      },
      prohibitions: {
        oldOutputsOverwritten: false,
        singleTenMinuteOverlayEncode: false,
        productionDirtyWorktreeModified: false,
        gitCommitted: false,
      },
    };
    const publication = await publishFinalCandidateAtomically({
      jobLock,
      finalMedia,
      finalManifest,
      stagingDirectory,
      outputDirectory: resolved.outputDirectory,
    });
    return {dryRun: false, ...publication, finalManifest};
  } finally {
    jobLock.release();
  }
}


async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usageText()}\n`);
    return;
  }
  const result = await buildAgentSkillV004bNoBoxFinal(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}


if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
