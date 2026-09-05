import {execFile} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import {homedir, getPriority} from "node:os";
import {basename, dirname, relative, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {promisify} from "node:util";

import {
  assertRequiredOverlayFiltersText,
  inspectFile,
  probeMedia,
  resolveMediaTool,
} from "./build-agent-skill-v004b-no-box-final.mjs";
import {
  subtitleBoundaryIssues,
  subtitleDurationIssues,
} from "../src/server/production/quality.mjs";
import {V004B_FORMAL_QA_PROFILE} from "../src/server/production/long-review-v004b-qa.mjs";


const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const PUBLIC_ROOT = resolve(STUDIO_ROOT, "public");
const REVIEW_CANDIDATES_ROOT = resolve(
  WORKSPACE_ROOT,
  "outputs/studio/agent-skill-20260806/review-candidates",
);
const CANDIDATE_DIRECTORY_NAME =
  "v004c-semantic-subtitle-continuous-logo-proof-v001";
const CANDIDATE_DIRECTORY = resolve(
  REVIEW_CANDIDATES_ROOT,
  CANDIDATE_DIRECTORY_NAME,
);
const OUTPUT_FILE_NAME = "review-05m36s-05m56s.mp4";
const OUTPUT_PATH = resolve(CANDIDATE_DIRECTORY, OUTPUT_FILE_NAME);
const ENTRY_POINT = resolve(
  STUDIO_ROOT,
  "src/video/agent-skill-long-review-index.jsx",
);
const EPISODE_PATH = resolve(
  STUDIO_ROOT,
  "data/render-inputs/full-v004b-attempt-001/episode.json",
);
const TIMELINE_PATH = resolve(
  STUDIO_ROOT,
  "data/render-inputs/full-v004c-attempt-005/subtitle-timeline-v004c-semantic.json",
);
const VOICE_PATH = resolve(
  PUBLIC_ROOT,
  "episodes/agent-skill-20260806/voice-natural-technical-v004-full.wav",
);
const OVERLAY_BUILDER_PATH = resolve(
  STUDIO_ROOT,
  "scripts/build-agent-skill-v004c-no-box-overlays.py",
);
const BASE_OVERLAY_BUILDER_PATH = resolve(
  STUDIO_ROOT,
  "scripts/build-agent-skill-v004b-no-box-overlays.py",
);
const FINAL_MEDIA_BUILDER_PATH = resolve(
  STUDIO_ROOT,
  "scripts/build-agent-skill-v004b-no-box-final.mjs",
);
const QA_ANALYZER_PATH = resolve(
  STUDIO_ROOT,
  "scripts/qa-agent-skill-long-review-wide-v004.py",
);
const CONTACT_SHEET_BUILDER_PATH = resolve(
  STUDIO_ROOT,
  "scripts/build-agent-skill-v004c-contact-sheet.py",
);
const QA_PROFILE_PATH = resolve(
  STUDIO_ROOT,
  "src/server/production/long-review-v004b-qa.mjs",
);
const CHROME_EXECUTABLE =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";


export const V004C_SEMANTIC_LOGO_PROOF_CONTRACT = Object.freeze({
  schemaVersion: "agent-skill-v004c-semantic-logo-proof-v1",
  manifestSchemaVersion: "agent-skill-v004c-semantic-logo-proof-manifest-v1",
  status: "proof-only-awaiting-human-visual-confirmation",
  compositionId: "AgentSkillLongReview",
  width: 1920,
  height: 1080,
  fps: 30,
  fullDurationInFrames: 18_000,
  fullDurationInSamples: 28_800_000,
  globalStartFrame: 10_080,
  globalEndFrameInclusive: 10_679,
  globalEndFrameExclusive: 10_680,
  frameCount: 600,
  durationSeconds: 20,
  startTimestamp: "05:36.000",
  endTimestampExclusive: "05:56.000",
  concurrency: 1,
  codec: "h264",
  pixelFormat: "yuv420p",
  crf: 18,
  outputFileName: "review-05m36s-05m56s.mp4",
  candidateDirectoryName: CANDIDATE_DIRECTORY_NAME,
  timelineAttempt: 5,
  timelineSchemaVersion: "agent-skill-subtitle-timeline-v004c-semantic-v7",
  segmentationContractVersion: "subtitle-semantic-segmentation-v7",
  timelineSha256:
    "49ca97cabff234500c610cb4461a9506ea4681bec10cbe5d83b5befbcd03f78f",
  sourceTimelineSha256:
    "1a4fc03ab45ef2ca49c8e0e1cd0132c32ae6baddc723539eba3a7e001842f265",
  voiceSha256:
    "438e2cf9b1b3a4fc4b029d1b8349018f5d47c984d03ce9a4c22c98cb1eb680c7",
  audio: Object.freeze({
    sampleRate: 48_000,
    channels: 1,
    startSample: 16_128_000,
    endSampleExclusive: 17_088_000,
    sampleCount: 960_000,
    codec: "aac",
    bitrate: "192k",
    temporaryVoice: true,
    voiceProfile: "v004-full Tingting",
    finalHumanRecording: false,
  }),
  subtitle: Object.freeze({
    attempt: 5,
    maximumCueDurationSeconds: 5.5,
    burnInSubtitle: false,
    externalOverlay: true,
    x: 220,
    y: 870,
    width: 1480,
    height: 130,
    fontSize: 40,
    fontWeight: "W3",
    noContainer: true,
    reuseHistoricalCuePngs: false,
  }),
  semanticMeasurement: Object.freeze({
    provenance: "real-overlay-renderer",
    testDouble: false,
    publicationEligible: true,
    pythonSha256:
      "71720f1fc66989ebd691e81c96111b47ae6ff3f1a478666084d1cacbf0fccbf2",
    builderSha256:
      "29ca4ed9705ab07c6dc2a273e1d6d6dbd238a0587b20dfbf4c4cd4bf98ffb71b",
    fontSha256:
      "f887295caf2881cab9554b14c5ab4c9ee624c3895599da152ec37416b5aefae0",
    snapshotReverifiedAfterMeasurement: true,
  }),
  watermark: Object.freeze({
    cadenceId: "continuous",
    cycleInFrames: 120,
    sampleOffsetsInFrames: Object.freeze([
      0, 15, 30, 45, 60, 75, 90, 105, 119, 120,
    ]),
    cropPixels: Object.freeze({left: 1760, top: 40, width: 120, height: 120}),
    minimumDistinctCropHashCount:
      V004B_FORMAL_QA_PROFILE.watermarkMinimumDistinctCropHashCount,
    minimumMateriallyChangedPhaseCount:
      V004B_FORMAL_QA_PROFILE.watermarkMinimumMateriallyChangedPhaseCount,
    materialChangeDhashHammingMinimum:
      V004B_FORMAL_QA_PROFILE.watermarkMaterialChangeDhashHammingMinimum,
    cycleReturnDhashHammingMaximum:
      V004B_FORMAL_QA_PROFILE.watermarkCycleReturnDhashHammingMaximum,
  }),
  contactSheet: Object.freeze({
    builderSchemaVersion: "agent-skill-v004c-contact-sheet-builder-v1",
    fontPath: "/System/Library/Fonts/Hiragino Sans GB.ttc",
    fontSha256:
      "f887295caf2881cab9554b14c5ab4c9ee624c3895599da152ec37416b5aefae0",
    fontFamily: "Hiragino Sans GB",
    regular: Object.freeze({index: 0, weight: "W3"}),
    bold: Object.freeze({index: 2, weight: "W6"}),
    cjkGlyphProbe: "中文标题字幕语义锚点",
  }),
  requiredOutputFiles: Object.freeze([
    OUTPUT_FILE_NAME,
    "proof-manifest.json",
    "qa/media-probe.json",
    "qa/watermark-motion-proof.json",
    "qa/subtitle-boundary-proof.json",
    "qa/contact-sheet.png",
  ]),
  externalSchedulingPrefix: Object.freeze([
    "/usr/sbin/taskpolicy",
    "-b",
    "/usr/bin/nice",
    "-n",
    "20",
  ]),
  proofOnly: true,
  tenMinuteAcceptance: false,
  continuousOneXWatchCompleted: false,
  humanVisualApproval: false,
  acceptedForRelease: false,
});


export const V004C_SEMANTIC_LOGO_PROOF_PATHS = Object.freeze({
  workspaceRoot: WORKSPACE_ROOT,
  studioRoot: STUDIO_ROOT,
  candidateDirectory: CANDIDATE_DIRECTORY,
  outputPath: OUTPUT_PATH,
  timelinePath: TIMELINE_PATH,
  episodePath: EPISODE_PATH,
  voicePath: VOICE_PATH,
  overlayBuilderPath: OVERLAY_BUILDER_PATH,
  baseOverlayBuilderPath: BASE_OVERLAY_BUILDER_PATH,
  finalMediaBuilderPath: FINAL_MEDIA_BUILDER_PATH,
  qaAnalyzerPath: QA_ANALYZER_PATH,
  contactSheetBuilderPath: CONTACT_SHEET_BUILDER_PATH,
  qaProfilePath: QA_PROFILE_PATH,
  entryPoint: ENTRY_POINT,
});


function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}


function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}


function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}


function workspaceRelative(path) {
  return relative(WORKSPACE_ROOT, path);
}


function assertInside(parent, child, label) {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))) {
    return resolve(child);
  }
  throw new Error(`${label} escapes the fixed proof root: ${child}`);
}


async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}


async function assertAbsent(path, label) {
  if (await pathExists(path)) throw new Error(`${label} 已存在；拒绝覆盖：${path}`);
}


async function assertPlainFile(path, label) {
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} 必须是普通文件且不能是符号链接：${path}`);
  }
  return details;
}


function takeValue(argumentsList, index, name) {
  const argument = argumentsList[index];
  if (argument === name) {
    if (index + 1 >= argumentsList.length) throw new Error(`${name} requires a value`);
    return {value: argumentsList[index + 1], nextIndex: index + 1};
  }
  if (argument.startsWith(`${name}=`)) {
    return {value: argument.slice(name.length + 1), nextIndex: index};
  }
  return null;
}


export function parseV004cSemanticLogoProofArguments(argumentsList) {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  const options = {
    help: false,
    timeline: TIMELINE_PATH,
    expectedTimelineSha256: contract.timelineSha256,
    outputDirectory: CANDIDATE_DIRECTORY,
    startFrame: contract.globalStartFrame,
    frameCount: contract.frameCount,
    concurrency: contract.concurrency,
    mode: "proof",
    ffmpeg: null,
    ffprobe: null,
    python: null,
  };
  const stringOptions = new Map([
    ["--timeline", "timeline"],
    ["--expected-timeline-sha256", "expectedTimelineSha256"],
    ["--output-directory", "outputDirectory"],
    ["--mode", "mode"],
    ["--ffmpeg", "ffmpeg"],
    ["--ffprobe", "ffprobe"],
    ["--python", "python"],
  ]);
  const integerOptions = new Map([
    ["--start-frame", "startFrame"],
    ["--frame-count", "frameCount"],
    ["--concurrency", "concurrency"],
  ]);
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    let matched = false;
    for (const [name, key] of stringOptions) {
      const taken = takeValue(argumentsList, index, name);
      if (!taken) continue;
      options[key] = taken.value;
      index = taken.nextIndex;
      matched = true;
      break;
    }
    if (matched) continue;
    for (const [name, key] of integerOptions) {
      const taken = takeValue(argumentsList, index, name);
      if (!taken) continue;
      const value = Number(taken.value);
      if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
      options[key] = value;
      index = taken.nextIndex;
      matched = true;
      break;
    }
    if (!matched) throw new Error(`Unknown option: ${argument}`);
  }
  const checks = {
    timeline: resolve(options.timeline) === TIMELINE_PATH,
    expectedTimelineSha256:
      options.expectedTimelineSha256 === contract.timelineSha256,
    outputDirectory: resolve(options.outputDirectory) === CANDIDATE_DIRECTORY,
    startFrame: options.startFrame === contract.globalStartFrame,
    frameCount: options.frameCount === contract.frameCount,
    concurrency: options.concurrency === 1,
    mode: options.mode === "proof",
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`v004c proof fixed contract mismatch: ${failed.join(", ")}`);
  }
  return Object.freeze(options);
}


export function v004cSemanticLogoProofUsageText() {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  return [
    "Immutable 20-second proof for v004c semantic subtitles and continuous Logo motion.",
    "",
    "Required low-priority launch:",
    `  ${[
      ...contract.externalSchedulingPrefix,
      process.execPath,
      workspaceRelative(SCRIPT_PATH),
      "--mode",
      "proof",
      "--start-frame",
      String(contract.globalStartFrame),
      "--frame-count",
      String(contract.frameCount),
      "--concurrency",
      "1",
    ].join(" ")}`,
    "",
    `Fixed range: ${contract.startTimestamp}-${contract.endTimestampExclusive} ` +
      `(global frames ${contract.globalStartFrame}-${contract.globalEndFrameInclusive}).`,
    "This is proof-only, uses temporary Tingting system narration, and is not a 10-minute acceptance candidate.",
    "The script validates nice priority; taskpolicy -b remains an explicit external launch requirement.",
  ].join("\n");
}


export function assertLowPriorityScheduling(observedNice = getPriority()) {
  if (!Number.isSafeInteger(observedNice) || observedNice < 19) {
    throw new Error(
      "proof render must run through /usr/sbin/taskpolicy -b /usr/bin/nice -n 20 " +
        `(observed nice=${observedNice})`,
    );
  }
  return Object.freeze({
    observedNice,
    niceRequirementPassed: true,
    taskpolicyBackgroundMode:
      "required-by-external-launch-contract-not-queryable-from-child-process",
  });
}


export function validateV004cProofTimeline(timeline) {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  const segmentation = timeline?.semanticSegmentation;
  const visualFit = segmentation?.visualFit;
  const checks = {
    schema: timeline?.schemaVersion === contract.timelineSchemaVersion,
    segmentationContract:
      segmentation?.contractVersion === contract.segmentationContractVersion,
    fps: timeline?.fps === contract.fps,
    duration: timeline?.durationInFrames === contract.fullDurationInFrames,
    sampleRate: timeline?.sampleRate === contract.audio.sampleRate,
    sampleDuration:
      timeline?.durationInSamples === contract.fullDurationInSamples,
    sourceHash:
      segmentation?.sourceTimelineSha256 === contract.sourceTimelineSha256,
    markerAligned: segmentation?.markerAligned === true,
    audioUnchanged: segmentation?.audioChanged === false,
    noAcceptedPrefixReuse:
      timeline?.acceptedPrefix?.reused === false &&
      segmentation?.acceptedPrefixCuePngsReused === false,
    visualFitEnforced: segmentation?.visualChunkFitsEnforced === true,
    visualFitVerified: visualFit?.verified === true,
    visualFitPublicationEligible: visualFit?.publicationEligible === true,
    realRendererMeasurement:
      visualFit?.measurementProvenance ===
        contract.semanticMeasurement.provenance &&
      visualFit?.testDouble === contract.semanticMeasurement.testDouble &&
      visualFit?.renderer?.builderSha256 ===
        contract.semanticMeasurement.builderSha256 &&
      visualFit?.renderer?.pythonSha256 ===
        contract.semanticMeasurement.pythonSha256 &&
      visualFit?.renderer?.fontSha256 ===
        contract.semanticMeasurement.fontSha256 &&
      visualFit?.renderer?.snapshotReverifiedAfterMeasurement ===
        contract.semanticMeasurement.snapshotReverifiedAfterMeasurement &&
      visualFit?.renderer?.fontFamily === "Hiragino Sans GB" &&
      visualFit?.renderer?.fontWeight === "W3" &&
      visualFit?.renderer?.fontSize === contract.subtitle.fontSize &&
      stableStringify(visualFit?.renderer?.overlaySize) ===
        stableStringify([contract.subtitle.width, contract.subtitle.height]),
    everyChunkFit: visualFit?.allSelectedChunksFit === true,
    thresholdsNotRelaxed:
      visualFit?.renderer?.alphaAndSafeAreaThresholdsRelaxed === false,
    durationCap:
      Number(segmentation?.maximumCueDurationSeconds) <=
        contract.subtitle.maximumCueDurationSeconds &&
      Number(visualFit?.maximumActualCueDurationSeconds) <=
        contract.subtitle.maximumCueDurationSeconds,
    displayCues: Array.isArray(timeline?.displayCues) && timeline.displayCues.length > 0,
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(`attempt-005 timeline contract failed: ${failed.join(", ")}`);
  }
  // Rolling display cues intentionally repeat the already-spoken prefix.  The
  // semantic boundary contract must therefore evaluate sourceText (the newly
  // spoken suffix), while rendering continues to use cue.text (the cumulative
  // display string).
  const semanticCues = timeline.displayCues.map((cue) => ({
    ...cue,
    text: cue.sourceText ?? cue.text,
  }));
  const boundaryIssues = subtitleBoundaryIssues(semanticCues);
  const durationIssues = subtitleDurationIssues(timeline.displayCues, {
    minimumSeconds: 0.75,
    maximumSeconds: contract.subtitle.maximumCueDurationSeconds,
  });
  if (boundaryIssues.length > 0 || durationIssues.length > 0) {
    throw new Error(
      `attempt-005 subtitle QA failed: boundaries=${boundaryIssues.length} ` +
        `durations=${durationIssues.length}`,
    );
  }
  const selected = timeline.displayCues.filter(
    (cue) =>
      cue.endFrameExclusive > contract.globalStartFrame &&
      cue.startFrame < contract.globalEndFrameExclusive,
  );
  if (selected.length === 0) throw new Error("proof range has no v004c cues");
  return Object.freeze({checks, boundaryIssues, durationIssues, selected});
}


export function buildV004cProofInputProps(episode, timeline) {
  validateV004cProofTimeline(timeline);
  if (!episode || typeof episode !== "object" || Array.isArray(episode)) {
    throw new TypeError("proof episode must be an object");
  }
  const subtitles = timeline.displayCues.map((cue) =>
    Object.freeze({start: cue.start, end: cue.end, text: cue.text}),
  );
  return Object.freeze({
    episode: Object.freeze({...episode, subtitles: Object.freeze(subtitles)}),
    burnInSubtitle: false,
    renderAudio: false,
  });
}


function seconds(frame, fps = V004C_SEMANTIC_LOGO_PROOF_CONTRACT.fps) {
  return (frame / fps).toFixed(6);
}


export function buildV004cProofOverlayAndAudioFfmpegArgs({
  renderBase,
  framePattern,
  voice,
  output,
}) {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-n",
    "-i",
    renderBase,
    "-framerate",
    String(contract.fps),
    "-start_number",
    "0",
    "-i",
    framePattern,
    "-i",
    voice,
    "-filter_complex_threads",
    "1",
    "-filter_complex",
    `[0:v:0]setpts=PTS-STARTPTS[base];` +
      `[1:v:0]setpts=PTS-STARTPTS[caption];` +
      `[base][caption]overlay=${contract.subtitle.x}:${contract.subtitle.y}:` +
      `format=auto:shortest=1[v];` +
      `[2:a:0]atrim=start_sample=${contract.audio.startSample}:` +
      `end_sample=${contract.audio.endSampleExclusive},asetpts=N/SR/TB[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-frames:v",
    String(contract.frameCount),
    "-r",
    String(contract.fps),
    "-fps_mode",
    "cfr",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    String(contract.crf),
    "-profile:v",
    "high",
    "-level:v",
    "4.0",
    "-pix_fmt",
    contract.pixelFormat,
    "-g",
    "60",
    "-keyint_min",
    "60",
    "-sc_threshold",
    "0",
    "-c:a",
    contract.audio.codec,
    "-b:a",
    contract.audio.bitrate,
    "-ar",
    String(contract.audio.sampleRate),
    "-ac",
    String(contract.audio.channels),
    "-t",
    seconds(contract.frameCount),
    "-movflags",
    "+faststart",
    output,
  ];
}


export function buildProofVideoDecodeArgs(path) {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
    "-i", path, "-map", "0:v:0", "-an", "-c:v", "rawvideo",
    "-f", "null", "-",
  ];
}


export function buildProofAudioDecodeArgs(path) {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
    "-i", path, "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le",
    "-f", "null", "-",
  ];
}


function rational(value) {
  const [numerator, denominator] = String(value ?? "").split("/").map(Number);
  return denominator ? numerator / denominator : Number.NaN;
}


function decodedFrames(video) {
  for (const value of [video?.nb_read_frames, video?.nb_frames]) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  return null;
}


export function evaluateV004cProofMediaProbe(raw) {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  const videoStreams = raw?.streams?.filter((stream) => stream.codec_type === "video") ?? [];
  const audioStreams = raw?.streams?.filter((stream) => stream.codec_type === "audio") ?? [];
  const video = videoStreams[0] ?? null;
  const audio = audioStreams[0] ?? null;
  const formatDuration = Number(raw?.format?.duration);
  const videoDuration = Number(video?.duration);
  const audioDuration = Number(audio?.duration);
  const checks = {
    mp4: raw?.format?.format_name?.split(",").includes("mp4") === true,
    exactlyOneVideo: videoStreams.length === 1,
    exactlyOneAudio: audioStreams.length === 1,
    h264: video?.codec_name === contract.codec,
    yuv420p: video?.pix_fmt === contract.pixelFormat,
    width1920: video?.width === contract.width,
    height1080: video?.height === contract.height,
    fps30: Math.abs(rational(video?.avg_frame_rate) - contract.fps) < 0.0001,
    frames600: decodedFrames(video) === contract.frameCount,
    aac: audio?.codec_name === contract.audio.codec,
    sampleRate48000: Number(audio?.sample_rate) === contract.audio.sampleRate,
    mono: Number(audio?.channels) === contract.audio.channels,
    formatStartsAtZero: Math.abs(Number(raw?.format?.start_time)) < 0.001,
    videoStartsAtZero: Math.abs(Number(video?.start_time)) < 0.001,
    audioStartsAtZero: Math.abs(Number(audio?.start_time)) < 0.001,
    formatDuration20:
      Number.isFinite(formatDuration) &&
      Math.abs(formatDuration - contract.durationSeconds) <= 0.02,
    videoDuration20:
      Number.isFinite(videoDuration) &&
      Math.abs(videoDuration - contract.durationSeconds) <= 1 / contract.fps,
    audioDuration20:
      Number.isFinite(audioDuration) &&
      Math.abs(audioDuration - contract.durationSeconds) <= 0.02,
  };
  return Object.freeze({
    passed: Object.values(checks).every(Boolean),
    checks,
    video,
    audio,
    format: raw?.format ?? null,
    actual: {
      fps: rational(video?.avg_frame_rate),
      frames: decodedFrames(video),
      formatDuration,
      videoDuration,
      audioDuration,
    },
  });
}


export function buildV004cProofEvidenceSamples(timeline) {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  const validated = validateV004cProofTimeline(timeline);
  const samples = new Map();
  const add = (localFrame, tag) => {
    if (!Number.isSafeInteger(localFrame) || localFrame < 0 || localFrame >= contract.frameCount) {
      throw new Error(`invalid proof evidence frame: ${localFrame}`);
    }
    const existing = samples.get(localFrame) ?? {
      frame: localFrame,
      globalFrame: contract.globalStartFrame + localFrame,
      second: (contract.globalStartFrame + localFrame) / contract.fps,
      filename:
        `frame-local-${String(localFrame).padStart(5, "0")}-` +
        `global-${String(contract.globalStartFrame + localFrame).padStart(5, "0")}.png`,
      tags: [],
    };
    existing.tags.push(tag);
    samples.set(localFrame, existing);
  };
  for (const offset of contract.watermark.sampleOffsetsInFrames) {
    add(offset, `watermark-motion-sample:chunk-01:offset:${offset}`);
  }
  for (const cue of validated.selected) {
    const clippedStart = Math.max(cue.startFrame, contract.globalStartFrame);
    const clippedEnd = Math.min(cue.endFrameExclusive, contract.globalEndFrameExclusive);
    const globalMidpoint = Math.floor((clippedStart + clippedEnd - 1) / 2);
    add(globalMidpoint - contract.globalStartFrame, `subtitle-cue:${cue.index}`);
    if (cue.rollingCarryApplied === true) {
      const localAfter = cue.startFrame - contract.globalStartFrame;
      if (localAfter > 0 && localAfter < contract.frameCount) {
        add(localAfter - 1, `rolling-boundary:${cue.index}:before`);
        add(localAfter, `rolling-boundary:${cue.index}:after`);
      }
    }
  }
  return Object.freeze([...samples.values()].sort((left, right) => left.frame - right.frame));
}


export function partitionV004cProofEvidenceSamples(samples, maximum = 24) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("proof evidence samples must not be empty");
  }
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 24) {
    throw new Error("proof evidence extraction batch must be 1..24");
  }
  const batches = [];
  for (let index = 0; index < samples.length; index += maximum) {
    batches.push(samples.slice(index, index + maximum));
  }
  return batches;
}


export function buildV004cProofFrameExtractionArgs({videoPath, samples, outputPaths}) {
  if (
    !Array.isArray(samples) ||
    samples.length < 1 ||
    samples.length > 24 ||
    !Array.isArray(outputPaths) ||
    outputPaths.length !== samples.length
  ) {
    throw new Error("proof extraction requires 1..24 samples and matching outputs");
  }
  const filters = [];
  if (samples.length === 1) {
    filters.push(
      `[0:v:0]trim=start_frame=${samples[0].frame}:` +
        `end_frame=${samples[0].frame + 1},setpts=PTS-STARTPTS[o000]`,
    );
  } else {
    const labels = samples
      .map((_, index) => `[s${String(index).padStart(3, "0")}]`)
      .join("");
    filters.push(`[0:v:0]split=${samples.length}${labels}`);
    samples.forEach((sample, index) => {
      const label = String(index).padStart(3, "0");
      filters.push(
        `[s${label}]trim=start_frame=${sample.frame}:` +
          `end_frame=${sample.frame + 1},setpts=PTS-STARTPTS[o${label}]`,
      );
    });
  }
  const args = [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
    "-i", videoPath, "-an", "-filter_complex_threads", "1",
    "-filter_complex", filters.join(";"),
  ];
  outputPaths.forEach((outputPath, index) => {
    args.push(
      "-map", `[o${String(index).padStart(3, "0")}]`,
      "-frames:v", "1", "-c:v", "png", "-threads:v", "1", outputPath,
    );
  });
  return args;
}


export function buildV004cSubtitleBoundaryProof({timeline, overlayManifest, samples}) {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  const validation = validateV004cProofTimeline(timeline);
  const sampleByCue = new Map();
  for (const sample of samples) {
    for (const tag of sample.tags) {
      if (tag.startsWith("subtitle-cue:")) {
        sampleByCue.set(Number(tag.split(":").at(-1)), sample);
      }
    }
  }
  const overlayRecords = overlayManifest?.displayCues ?? [];
  const recordByIndex = new Map(overlayRecords.map((record) => [record.index, record]));
  const cues = validation.selected.map((cue) => {
    const record = recordByIndex.get(cue.index);
    const sample = sampleByCue.get(cue.index);
    if (!record || !sample) throw new Error(`proof evidence missing cue ${cue.index}`);
    return {
      index: cue.index,
      sceneId: cue.sceneId,
      text: cue.text,
      start: cue.start,
      end: cue.end,
      durationSeconds: cue.end - cue.start,
      globalStartFrame: cue.startFrame,
      globalEndFrameExclusive: cue.endFrameExclusive,
      proofLocalMidpointFrame: sample.frame,
      evidenceFrame: sample.filename,
      lines: record.lines,
      imageSha256: record.imageSha256,
      alphaBoundingBox: record.alphaBoundingBox,
      globalAlphaBoundingBox: record.globalAlphaBoundingBox,
      noContainer:
        record.containerLikeAlpha === false && record.borderAlphaMax === 0,
      insideCaptionSafeArea: record.insideCaptionSafeArea === true,
    };
  });
  const rollingEvidence = [];
  for (const sample of samples) {
    for (const tag of sample.tags) {
      if (!tag.startsWith("rolling-boundary:")) continue;
      const [, rawCueIndex, side] = tag.split(":");
      rollingEvidence.push({
        cueIndex: Number(rawCueIndex),
        side,
        localFrame: sample.frame,
        globalFrame: sample.globalFrame,
        filename: sample.filename,
      });
    }
  }
  const rollingGroups = overlayManifest?.rollingLayoutGroups ?? [];
  const allTimelineRollingAudits =
    overlayManifest?.allTimelineRollingLayoutAudits ?? [];
  const checks = {
    immutableAttempt005:
      overlayManifest?.timeline?.attempt === 5 &&
      overlayManifest?.timeline?.sha256 === contract.timelineSha256 &&
      overlayManifest?.timeline?.schemaVersion === contract.timelineSchemaVersion,
    visualFitVerifiedByRealRenderer:
      overlayManifest?.timeline?.visualFitVerified === true &&
      overlayManifest?.timeline?.publicationEligible === true &&
      overlayManifest?.timeline?.measurementProvenance ===
        "real-overlay-renderer" &&
      overlayManifest?.timeline?.testDouble === false,
    noSemanticBoundaryIssues: validation.boundaryIssues.length === 0,
    durationAtMost5_5Seconds: validation.durationIssues.length === 0,
    allProofCuesBound: cues.length === validation.selected.length,
    allFreshlyRendered:
      overlayManifest?.reuse?.historicalCuePngsReused === false &&
      overlayManifest?.reuse?.allSelectedCuesFreshlyRendered === true,
    noSubtitleContainer: cues.every((cue) => cue.noContainer),
    insideSubtitleSafeArea: cues.every((cue) => cue.insideCaptionSafeArea),
    exactOverlayPlacement:
      overlayManifest?.style?.targetX === contract.subtitle.x &&
      overlayManifest?.style?.targetY === contract.subtitle.y,
    rollingGroupsCovered: rollingGroups.length > 0,
    rollingPrefixAnchorsStable:
      rollingGroups.length > 0 &&
      rollingGroups.every((group) => group.prefixAnchorStable === true),
    allTimelineRollingGroupsAudited:
      stableStringify(allTimelineRollingAudits.map((audit) => audit.id).sort()) ===
        stableStringify(["S09:0-39", "S35:65-96"]) &&
      allTimelineRollingAudits.every(
        (audit) =>
          audit.passed === true &&
          Object.values(audit.checks ?? {}).every(Boolean),
      ),
    rollingBoundaryFramesPaired:
      rollingGroups.every((group) =>
        group.cueIndexes.slice(1).every((cueIndex) =>
          rollingEvidence.some(
            (item) => item.cueIndex === cueIndex && item.side === "before",
          ) &&
          rollingEvidence.some(
            (item) => item.cueIndex === cueIndex && item.side === "after",
          ),
        ),
      ),
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`subtitle proof failed: ${JSON.stringify(checks)}`);
  }
  return {
    schemaVersion: "agent-skill-v004c-subtitle-boundary-proof-v1",
    status: "pass",
    proofOnly: true,
    timelineAttempt: 5,
    timelineSha256: contract.timelineSha256,
    sourceTimelineSha256: contract.sourceTimelineSha256,
    range: {
      startTimestamp: contract.startTimestamp,
      endTimestampExclusive: contract.endTimestampExclusive,
      globalStartFrame: contract.globalStartFrame,
      globalEndFrameExclusive: contract.globalEndFrameExclusive,
    },
    checks,
    fullTimelineBoundaryIssueCount: validation.boundaryIssues.length,
    fullTimelineDurationIssueCount: validation.durationIssues.length,
    cues,
    rollingLayoutGroups: rollingGroups,
    allTimelineRollingLayoutAudits: allTimelineRollingAudits,
    rollingBoundaryEvidence: rollingEvidence,
    warning: "机器字幕边界/排版证据不是人工连续观看验收。",
  };
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
    throw new Error(`${basename(tool.path)} failed: ${detail}`, {cause: error});
  }
}


async function resolveProofPython(override) {
  const candidate = override
    ? resolve(override)
    : process.env.QA_PYTHON
      ? resolve(process.env.QA_PYTHON)
      : resolve(
          homedir(),
          ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
        );
  const path = await realpath(candidate);
  await assertPlainFile(path, "proof Python runtime");
  const integrity = await inspectFile(path);
  if (
    integrity.sha256 !==
    V004C_SEMANTIC_LOGO_PROOF_CONTRACT.semanticMeasurement.pythonSha256
  ) {
    throw new Error("proof Python runtime does not match attempt-005 measurement provenance");
  }
  const {stdout} = await execFileAsync(path, [
    "-I",
    "-c",
    "import json,platform; import PIL,numpy; print(json.dumps({" +
      "'python':platform.python_version(),'Pillow':PIL.__version__,'numpy':numpy.__version__},sort_keys=True))",
  ]);
  return {path, identity: JSON.parse(stdout), integrity};
}


async function readJsonSnapshot(path, label, expectedHash = null) {
  await assertPlainFile(path, label);
  const bytes = await readFile(path);
  const actualHash = sha256(bytes);
  if (expectedHash && actualHash !== expectedHash) {
    throw new Error(`${label} SHA-256 drift: expected=${expectedHash} actual=${actualHash}`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, {cause: error});
  }
  return Object.freeze({path, bytes, sha256: actualHash, value});
}


async function captureFiles(paths) {
  const entries = [];
  for (const path of paths) {
    await assertPlainFile(path, workspaceRelative(path));
    const bytes = await readFile(path);
    const details = await lstat(path);
    entries.push([
      workspaceRelative(path),
      {
        bytes: bytes.length,
        sha256: sha256(bytes),
        dev: details.dev,
        ino: details.ino,
        mtimeMs: details.mtimeMs,
      },
    ]);
  }
  return Object.freeze(Object.fromEntries(entries));
}


async function assertSnapshotsUnchanged(before, paths) {
  const after = await captureFiles(paths);
  if (stableStringify(before) !== stableStringify(after)) {
    throw new Error("proof source inputs changed during render; refusing publication");
  }
}


async function atomicPublishDirectoryNoReplace(python, source, target) {
  const code = [
    "import ctypes, errno, os, sys",
    "source, target = os.fsencode(sys.argv[1]), os.fsencode(sys.argv[2])",
    "if os.path.lexists(sys.argv[2]): raise FileExistsError(sys.argv[2])",
    "lib = ctypes.CDLL(None, use_errno=True)",
    "if sys.platform == 'darwin':",
    "  fn = lib.renamex_np",
    "  fn.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]",
    "  result = fn(source, target, 0x00000004)",
    "elif sys.platform.startswith('linux'):",
    "  fn = lib.renameat2",
    "  fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]",
    "  result = fn(-100, source, -100, target, 0x00000001)",
    "else: raise RuntimeError('unsupported atomic no-replace platform')",
    "if result != 0:",
    "  number = ctypes.get_errno()",
    "  if number in (errno.EEXIST, errno.ENOTEMPTY): raise FileExistsError(sys.argv[2])",
    "  raise OSError(number, os.strerror(number), sys.argv[2])",
  ].join("\n");
  await execFileAsync(python.path, ["-I", "-c", code, source, target], {
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}


function watermarkFrameIndex(samples) {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  return {
    schemaVersion: "agent-skill-v004c-proof-frame-index-v1",
    sourceVideo: workspaceRelative(OUTPUT_PATH),
    proofGlobalStartFrame: contract.globalStartFrame,
    proofGlobalEndFrameExclusive: contract.globalEndFrameExclusive,
    watermarkCadenceId: contract.watermark.cadenceId,
    watermarkCycleInFrames: contract.watermark.cycleInFrames,
    watermarkMotionSampleOffsetsInFrames:
      contract.watermark.sampleOffsetsInFrames,
    watermarkCropPixels: contract.watermark.cropPixels,
    watermarkMotionProof: {
      schemaVersion: "agent-skill-v004c-watermark-motion-proof-v1",
      minimumDistinctCropHashCount:
        contract.watermark.minimumDistinctCropHashCount,
      minimumMateriallyChangedPhaseCount:
        contract.watermark.minimumMateriallyChangedPhaseCount,
      materialChangeDhashHammingMinimum:
        contract.watermark.materialChangeDhashHammingMinimum,
      cycleReturnDhashHammingMaximum:
        contract.watermark.cycleReturnDhashHammingMaximum,
    },
    chunkCount: 1,
    chunkDurationInFrames: contract.frameCount,
    fullSamples: samples,
  };
}


async function analyzeEvidenceWithPython({python, qaDirectory, samples, timeline}) {
  const frameIndex = watermarkFrameIndex(samples);
  frameIndex.subtitleEvidence = validateV004cProofTimeline(timeline).selected.map((cue) => ({
    cueIndex: cue.index,
    text: cue.text,
  }));
  const frameIndexPath = resolve(qaDirectory, "frame-index.json");
  await writeFile(frameIndexPath, `${JSON.stringify(frameIndex, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  const {stdout} = await execFileAsync(
    python.path,
    [
      "-I",
      CONTACT_SHEET_BUILDER_PATH,
      "--analyzer",
      QA_ANALYZER_PATH,
      "--qa-dir",
      qaDirectory,
      "--frame-index",
      frameIndexPath,
      "--output",
      resolve(qaDirectory, "contact-sheet.png"),
    ],
    {timeout: 120_000, maxBuffer: 32 * 1024 * 1024},
  );
  const proof = JSON.parse(stdout);
  if (proof.status !== "pass") {
    throw new Error("decoded Logo crop motion gate failed");
  }
  const typography = proof.contactSheet?.typography;
  const expectedTypography = V004C_SEMANTIC_LOGO_PROOF_CONTRACT.contactSheet;
  if (
    proof.contactSheet?.schemaVersion !== expectedTypography.builderSchemaVersion ||
    typography?.path !== expectedTypography.fontPath ||
    typography?.sha256 !== expectedTypography.fontSha256 ||
    typography?.family !== expectedTypography.fontFamily ||
    typography?.regular?.index !== expectedTypography.regular.index ||
    typography?.regular?.weight !== expectedTypography.regular.weight ||
    typography?.bold?.index !== expectedTypography.bold.index ||
    typography?.bold?.weight !== expectedTypography.bold.weight ||
    typography?.cjkGlyphProbe?.text !== expectedTypography.cjkGlyphProbe ||
    typography?.cjkGlyphProbe?.passed !== true ||
    proof.contactSheet?.chineseLabelsReadableByContract !== true
  ) {
    throw new Error("contact-sheet CJK font contract failed");
  }
  const proofPath = resolve(qaDirectory, "watermark-motion-proof.json");
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return {proof, frameIndexPath};
}


async function invokeOverlayBuilder({python, stagingDirectory}) {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  const outputDirectory = resolve(stagingDirectory, "caption-overlays");
  const {stdout} = await execFileAsync(
    python.path,
    [
      "-I",
      OVERLAY_BUILDER_PATH,
      "--timeline",
      TIMELINE_PATH,
      "--expected-timeline-sha256",
      contract.timelineSha256,
      "--output-directory",
      outputDirectory,
      "--start-frame",
      String(contract.globalStartFrame),
      "--frame-count",
      String(contract.frameCount),
      "--mode",
      "proof",
    ],
    {timeout: 120_000, maxBuffer: 32 * 1024 * 1024},
  );
  return JSON.parse(stdout);
}


async function renderProofBase({stagingDirectory, inputProps}) {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  const {bundle} = await import("@remotion/bundler");
  const {renderMedia, selectComposition} = await import("@remotion/renderer");
  const bundleDirectory = resolve(stagingDirectory, "bundle");
  const renderBase = resolve(stagingDirectory, "proof-render-base.mp4");
  await assertAbsent(renderBase, "proof render-base");
  const serveUrl = await bundle({
    entryPoint: ENTRY_POINT,
    publicDir: PUBLIC_ROOT,
    outDir: bundleDirectory,
    enableCaching: false,
    onProgress: () => undefined,
  });
  const composition = await selectComposition({
    serveUrl,
    id: contract.compositionId,
    inputProps,
    browserExecutable: CHROME_EXECUTABLE,
    onBrowserDownload: () => {
      throw new Error("browser download is forbidden; use installed Chrome");
    },
    timeoutInMilliseconds: 180_000,
    logLevel: "warn",
  });
  const actual = {
    id: composition.id,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
  };
  const expected = {
    id: contract.compositionId,
    width: contract.width,
    height: contract.height,
    fps: contract.fps,
    durationInFrames: contract.fullDurationInFrames,
  };
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(`proof composition drift: ${JSON.stringify(actual)}`);
  }
  await renderMedia({
    composition,
    serveUrl,
    outputLocation: renderBase,
    inputProps,
    browserExecutable: CHROME_EXECUTABLE,
    onBrowserDownload: () => {
      throw new Error("browser download is forbidden; use installed Chrome");
    },
    timeoutInMilliseconds: 180_000,
    codec: contract.codec,
    pixelFormat: contract.pixelFormat,
    crf: contract.crf,
    concurrency: 1,
    frameRange: [contract.globalStartFrame, contract.globalEndFrameInclusive],
    imageFormat: "png",
    hardwareAcceleration: "disable",
    muted: true,
    enforceAudioTrack: false,
    overwrite: false,
    logLevel: "warn",
  });
  return {renderBase, bundleDirectory, composition: actual};
}


export async function renderV004cSemanticLogoProof(options = {}) {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  const scheduling = assertLowPriorityScheduling();
  await Promise.all([
    assertPlainFile(ENTRY_POINT, "Remotion entry point"),
    assertPlainFile(EPISODE_PATH, "frozen episode"),
    assertPlainFile(TIMELINE_PATH, "immutable attempt-005 timeline"),
    assertPlainFile(VOICE_PATH, "temporary Tingting voice"),
    assertPlainFile(OVERLAY_BUILDER_PATH, "v004c overlay builder"),
    assertPlainFile(BASE_OVERLAY_BUILDER_PATH, "v004b base overlay builder"),
    assertPlainFile(FINAL_MEDIA_BUILDER_PATH, "v004b final media helpers"),
    assertPlainFile(QA_ANALYZER_PATH, "QA analyzer"),
    assertPlainFile(CONTACT_SHEET_BUILDER_PATH, "fixed-font contact-sheet builder"),
    assertPlainFile(QA_PROFILE_PATH, "QA profile"),
    assertPlainFile(contract.contactSheet.fontPath, "pinned contact-sheet font"),
    assertPlainFile(CHROME_EXECUTABLE, "installed Chrome"),
  ]);
  await mkdir(REVIEW_CANDIDATES_ROOT, {recursive: true});
  const reviewRootDetails = await lstat(REVIEW_CANDIDATES_ROOT);
  if (!reviewRootDetails.isDirectory() || reviewRootDetails.isSymbolicLink()) {
    throw new Error("review-candidates root must be a regular directory");
  }
  await assertAbsent(CANDIDATE_DIRECTORY, "fixed proof-v001 candidate");

  const python = await resolveProofPython(options.python ?? null);
  const [ffmpeg, ffprobe] = await Promise.all([
    resolveMediaTool("ffmpeg", options.ffmpeg ?? null),
    resolveMediaTool("ffprobe", options.ffprobe ?? null),
  ]);
  const filters = await runTool(ffmpeg, ["-hide_banner", "-filters"], 15_000);
  assertRequiredOverlayFiltersText(`${filters.stdout}${filters.stderr}`);

  const [timelineSnapshot, episodeSnapshot, voiceIntegrity] = await Promise.all([
    readJsonSnapshot(TIMELINE_PATH, "attempt-005 timeline", contract.timelineSha256),
    readJsonSnapshot(EPISODE_PATH, "frozen episode"),
    inspectFile(VOICE_PATH),
  ]);
  if (voiceIntegrity.sha256 !== contract.voiceSha256) {
    throw new Error("temporary Tingting voice hash drifted");
  }
  validateV004cProofTimeline(timelineSnapshot.value);
  const sourcePaths = [
    SCRIPT_PATH,
    OVERLAY_BUILDER_PATH,
    BASE_OVERLAY_BUILDER_PATH,
    FINAL_MEDIA_BUILDER_PATH,
    QA_ANALYZER_PATH,
    CONTACT_SHEET_BUILDER_PATH,
    QA_PROFILE_PATH,
    ENTRY_POINT,
    resolve(STUDIO_ROOT, "src/video/agent-skill-long-review-root.jsx"),
    resolve(STUDIO_ROOT, "src/video/agent-skill-long-review.jsx"),
    resolve(STUDIO_ROOT, "src/video/components/visual-system-v1/brand-layer.jsx"),
    resolve(STUDIO_ROOT, "src/video/components/visual-system-v1/ai-watermark.jsx"),
    resolve(STUDIO_ROOT, "src/video/components/visual-system-v1/ai-watermark.mjs"),
    resolve(STUDIO_ROOT, "src/server/production/subtitle-segmentation.mjs"),
    resolve(STUDIO_ROOT, "src/server/production/quality.mjs"),
    TIMELINE_PATH,
    EPISODE_PATH,
    VOICE_PATH,
  ];
  const sourceSnapshots = await captureFiles(sourcePaths);
  const {stdout: gitHeadOutput} = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: WORKSPACE_ROOT,
  });
  const gitHead = gitHeadOutput.trim();

  const stagingDirectory = resolve(
    REVIEW_CANDIDATES_ROOT,
    `.${CANDIDATE_DIRECTORY_NAME}.part-${randomUUID()}`,
  );
  assertInside(REVIEW_CANDIDATES_ROOT, stagingDirectory, "proof staging directory");
  await assertAbsent(stagingDirectory, "proof staging directory");
  await mkdir(stagingDirectory, {recursive: false});
  let published = false;
  try {
    const qaDirectory = resolve(stagingDirectory, "qa");
    await mkdir(qaDirectory);
    const overlayBuild = await invokeOverlayBuilder({python, stagingDirectory});
    const overlayManifestSnapshot = await readJsonSnapshot(
      overlayBuild.manifestPath,
      "v004c proof overlay manifest",
      overlayBuild.manifestSha256,
    );
    const inputProps = buildV004cProofInputProps(
      episodeSnapshot.value,
      timelineSnapshot.value,
    );
    const renderBase = await renderProofBase({stagingDirectory, inputProps});
    const finalVideoPath = resolve(stagingDirectory, OUTPUT_FILE_NAME);
    const framePattern = resolve(
      stagingDirectory,
      "caption-overlays/frames/frame-%05d.png",
    );
    await runTool(
      ffmpeg,
      buildV004cProofOverlayAndAudioFfmpegArgs({
        renderBase: renderBase.renderBase,
        framePattern,
        voice: VOICE_PATH,
        output: finalVideoPath,
      }),
      900_000,
    );
    const rawProbe = await probeMedia(ffprobe, finalVideoPath);
    const mediaProbe = evaluateV004cProofMediaProbe(rawProbe);
    if (!mediaProbe.passed) {
      throw new Error(`proof media contract failed: ${JSON.stringify(mediaProbe.checks)}`);
    }
    await runTool(ffmpeg, buildProofVideoDecodeArgs(finalVideoPath), 900_000);
    await runTool(ffmpeg, buildProofAudioDecodeArgs(finalVideoPath), 900_000);
    const videoIntegrity = await inspectFile(finalVideoPath);
    await writeFile(
      resolve(qaDirectory, "media-probe.json"),
      `${JSON.stringify({
        schemaVersion: "agent-skill-v004c-proof-media-probe-v1",
        status: "pass",
        sourceVideo: workspaceRelative(OUTPUT_PATH),
        file: videoIntegrity,
        fullDecode: {
          videoDecodedWithoutError: true,
          audioDecodedWithoutError: true,
          videoMode: "sequential-rawvideo-null-xerror",
          audioMode: "sequential-pcm-s16le-null-xerror",
        },
        ...mediaProbe,
        rawProbe,
      }, null, 2)}\n`,
      {encoding: "utf8", flag: "wx"},
    );

    const samples = buildV004cProofEvidenceSamples(timelineSnapshot.value);
    for (const batch of partitionV004cProofEvidenceSamples(samples)) {
      const outputPaths = batch.map((sample) => resolve(qaDirectory, sample.filename));
      await runTool(
        ffmpeg,
        buildV004cProofFrameExtractionArgs({
          videoPath: finalVideoPath,
          samples: batch,
          outputPaths,
        }),
        180_000,
      );
      await Promise.all(outputPaths.map((path) => assertPlainFile(path, "proof evidence frame")));
    }
    const watermarkAnalysis = await analyzeEvidenceWithPython({
      python,
      qaDirectory,
      samples,
      timeline: timelineSnapshot.value,
    });
    const subtitleProof = buildV004cSubtitleBoundaryProof({
      timeline: timelineSnapshot.value,
      overlayManifest: overlayManifestSnapshot.value,
      samples,
    });
    await writeFile(
      resolve(qaDirectory, "subtitle-boundary-proof.json"),
      `${JSON.stringify(subtitleProof, null, 2)}\n`,
      {encoding: "utf8", flag: "wx"},
    );
    await Promise.all(
      contract.requiredOutputFiles
        .filter((path) => path !== "proof-manifest.json")
        .map((path) => assertPlainFile(resolve(stagingDirectory, path), path)),
    );
    const evidenceIntegrity = {};
    for (const path of contract.requiredOutputFiles.filter(
      (path) => path !== OUTPUT_FILE_NAME && path !== "proof-manifest.json",
    )) {
      evidenceIntegrity[path] = await inspectFile(resolve(stagingDirectory, path));
    }
    await rm(renderBase.bundleDirectory, {recursive: true, force: false});
    await rm(renderBase.renderBase, {force: false});
    await assertSnapshotsUnchanged(sourceSnapshots, sourcePaths);
    const proofManifest = {
      schemaVersion: contract.manifestSchemaVersion,
      status: contract.status,
      createdAt: new Date().toISOString(),
      warning:
        "本样片使用临时 Tingting 系统旁白，不是最终真人录音；" +
        "它仅验证05:36–05:56字幕、rolling锚点与Logo方向，不构成十分钟成片验收。",
      contract,
      output: {
        path: workspaceRelative(OUTPUT_PATH),
        ...videoIntegrity,
      },
      range: {
        startTimestamp: contract.startTimestamp,
        endTimestampExclusive: contract.endTimestampExclusive,
        globalStartFrame: contract.globalStartFrame,
        globalEndFrameInclusive: contract.globalEndFrameInclusive,
        frameCount: contract.frameCount,
      },
      remotion: {
        composition: renderBase.composition,
        frameRange: [contract.globalStartFrame, contract.globalEndFrameInclusive],
        inputProps: {
          subtitleTimelineReplacedWithAttempt005: true,
          burnInSubtitle: false,
          renderAudio: false,
        },
        concurrency: 1,
      },
      subtitle: {
        timeline: {
          path: workspaceRelative(TIMELINE_PATH),
          sha256: timelineSnapshot.sha256,
          attempt: 5,
          visualFitVerified: true,
          publicationEligible: true,
          measurementProvenance: contract.semanticMeasurement.provenance,
          testDouble: false,
        },
        overlay: {
          manifestPath: workspaceRelative(
            resolve(CANDIDATE_DIRECTORY, "caption-overlays", basename(overlayBuild.manifestPath)),
          ),
          manifestSha256: overlayBuild.manifestSha256,
          x: contract.subtitle.x,
          y: contract.subtitle.y,
          crf: contract.crf,
          historicalCuePngsReused: false,
        },
      },
      audio: {
        path: workspaceRelative(VOICE_PATH),
        sha256: voiceIntegrity.sha256,
        startSample: contract.audio.startSample,
        endSampleExclusive: contract.audio.endSampleExclusive,
        sampleCount: contract.audio.sampleCount,
        sampleRate: contract.audio.sampleRate,
        exactSampleTrim: true,
        temporary: true,
        profile: contract.audio.voiceProfile,
        finalHumanRecording: false,
      },
      machineQa: {
        mediaProbe: "qa/media-probe.json",
        watermarkMotionProof: "qa/watermark-motion-proof.json",
        watermarkStatus: watermarkAnalysis.proof.status,
        subtitleBoundaryProof: "qa/subtitle-boundary-proof.json",
        subtitleStatus: subtitleProof.status,
        contactSheet: "qa/contact-sheet.png",
        contactSheetTypography: watermarkAnalysis.proof.contactSheet.typography,
        contactSheetChineseLabelsReadable:
          watermarkAnalysis.proof.contactSheet.chineseLabelsReadableByContract,
        fullVideoDecodePassed: true,
        fullAudioDecodePassed: true,
      },
      evidenceIntegrity,
      source: {
        gitHead,
        files: sourceSnapshots,
      },
      runtime: {
        node: process.version,
        python: python.identity,
        pythonPath: python.path,
        pythonSha256: python.integrity.sha256,
        ffmpeg: ffmpeg.path,
        ffprobe: ffprobe.path,
        chrome: CHROME_EXECUTABLE,
      },
      scheduling: {
        requiredExternalPrefix: contract.externalSchedulingPrefix,
        ...scheduling,
        concurrency: 1,
      },
      acceptanceBoundary: {
        proofOnly: true,
        tenMinuteCandidate: false,
        tenMinuteVisualAcceptance: false,
        continuousOneXWatchCompleted: false,
        humanVisualApproval: false,
        finalHumanRecording: false,
        acceptedForRelease: false,
        authorizesGitCommitPushPrOrMerge: false,
      },
      publication: {
        stagingDirectorySiblingOfCandidate: true,
        atomicNoReplaceDirectoryRename: true,
        overwritingAllowed: false,
        oldOutputsModifiedOrDeleted: false,
      },
    };
    await writeFile(
      resolve(stagingDirectory, "proof-manifest.json"),
      `${JSON.stringify(proofManifest, null, 2)}\n`,
      {encoding: "utf8", flag: "wx"},
    );
    await Promise.all(
      contract.requiredOutputFiles.map((path) =>
        assertPlainFile(resolve(stagingDirectory, path), path),
      ),
    );
    await assertSnapshotsUnchanged(sourceSnapshots, sourcePaths);
    await assertAbsent(CANDIDATE_DIRECTORY, "fixed proof-v001 candidate before publish");
    await atomicPublishDirectoryNoReplace(python, stagingDirectory, CANDIDATE_DIRECTORY);
    published = true;
    const publishedIntegrity = await inspectFile(OUTPUT_PATH);
    if (stableStringify(publishedIntegrity) !== stableStringify(videoIntegrity)) {
      throw new Error("published proof video integrity changed after atomic rename");
    }
    return {
      outputPath: OUTPUT_PATH,
      manifestPath: resolve(CANDIDATE_DIRECTORY, "proof-manifest.json"),
      qaDirectory: resolve(CANDIDATE_DIRECTORY, "qa"),
      ...publishedIntegrity,
    };
  } catch (error) {
    if (!published && (await pathExists(stagingDirectory))) {
      const failedDirectory = resolve(
        REVIEW_CANDIDATES_ROOT,
        `.${CANDIDATE_DIRECTORY_NAME}.failed-${Date.now()}-${randomUUID()}`,
      );
      try {
        await atomicPublishDirectoryNoReplace(python, stagingDirectory, failedDirectory);
      } catch (preserveError) {
        error.preserveError = String(preserveError?.stack ?? preserveError);
      }
    }
    throw error;
  }
}


async function main() {
  const options = parseV004cSemanticLogoProofArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${v004cSemanticLogoProofUsageText()}\n`);
    return;
  }
  const result = await renderV004cSemanticLogoProof(options);
  process.stdout.write(`${JSON.stringify({ok: true, ...result}, null, 2)}\n`);
}


if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
