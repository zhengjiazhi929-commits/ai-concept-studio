import {execFile} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {createReadStream} from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import {getPriority} from "node:os";
import {dirname, relative, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {promisify} from "node:util";

import {
  buildSynchronizedPacingFilterGraph,
  pacedFrameCount
} from "../src/server/production/presentation-pacing.mjs";

const execute = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STUDIO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const PUBLIC_ROOT = resolve(STUDIO_ROOT, "public");
const REVIEW_ROOT = resolve(
  WORKSPACE_ROOT,
  "outputs/studio/agent-skill-20260806/review-candidates"
);
const CANDIDATE_NAME = "v004d-pacing-card-border-proof-v002";
const CANDIDATE_DIRECTORY = resolve(REVIEW_ROOT, CANDIDATE_NAME);
const OUTPUT_FILE_NAME = "review-05m36s-05m56s-at-1_15x.mp4";
const ENTRY_POINT = resolve(STUDIO_ROOT, "src/video/agent-skill-long-review-index.jsx");
const EPISODE_PATH = resolve(
  STUDIO_ROOT,
  "data/render-inputs/full-v004b-attempt-001/episode.json"
);
const TIMELINE_PATH = resolve(
  STUDIO_ROOT,
  "data/render-inputs/full-v004c-attempt-005/subtitle-timeline-v004c-semantic.json"
);
const VOICE_PATH = resolve(
  PUBLIC_ROOT,
  "episodes/agent-skill-20260806/voice-natural-technical-v004-full.wav"
);
const REUSED_OVERLAY_ROOT = resolve(
  REVIEW_ROOT,
  "v004c-semantic-subtitle-continuous-logo-proof-v001/caption-overlays"
);
const REUSED_OVERLAY_MANIFEST = resolve(
  REUSED_OVERLAY_ROOT,
  "overlay-manifest-v004c-no-box-proof.json"
);
const REUSED_OVERLAY_FRAMES = resolve(REUSED_OVERLAY_ROOT, "frames");
const FFMPEG_PATH = "/opt/homebrew/bin/ffmpeg";
const FFPROBE_PATH = "/opt/homebrew/bin/ffprobe";
const PYTHON =
  "/Users/zhengjiazhi/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const V004D_PACING_BORDER_PROOF = Object.freeze({
  schemaVersion: "agent-skill-v004d-pacing-border-proof-v1",
  candidateName: CANDIDATE_NAME,
  outputFileName: OUTPUT_FILE_NAME,
  compositionId: "AgentSkillLongReview",
  fps: 30,
  width: 1920,
  height: 1080,
  globalStartFrame: 10_080,
  globalEndFrameInclusive: 10_679,
  sourceFrameCount: 600,
  sourceDurationSeconds: 20,
  sourceStartSample: 16_128_000,
  sourceEndSampleExclusive: 17_088_000,
  playbackRate: 1.15,
  outputFrameCount: pacedFrameCount(600, 1.15),
  outputAudioSamples: 835_200,
  outputDurationSeconds: 17.4,
  overlayX: 220,
  overlayY: 870,
  equivalentSayRate: 198.95,
  timelineSha256:
    "49ca97cabff234500c610cb4461a9506ea4681bec10cbe5d83b5befbcd03f78f",
  voiceSha256:
    "438e2cf9b1b3a4fc4b029d1b8349018f5d47c984d03ce9a4c22c98cb1eb680c7",
  reusedOverlayManifestSha256:
    "57db3d9c58f36e79c2e7236efd92766782949095375793c85f85632824ddd0f0",
  temporaryVoice: true,
  finalHumanRecording: false,
  proofOnly: true,
  humanVisualApproval: false,
  acceptedForRelease: false
});

async function exists(path) {
  try {
    await access(path);
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
}

async function fileSha256(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function assertHash(path, expected, label) {
  await assertPlainFile(path, label);
  const actual = await fileSha256(path);
  if (actual !== expected) {
    throw new Error(`${label} SHA-256 漂移：expected=${expected} actual=${actual}`);
  }
  return actual;
}

async function run(command, args, timeout = 600_000) {
  return execute(command, args, {timeout, maxBuffer: 64 * 1024 * 1024});
}

function assertLowPriority() {
  const observedNice = getPriority();
  if (!Number.isSafeInteger(observedNice) || observedNice < 19) {
    throw new Error(
      `必须从 taskpolicy -b nice -n 20 启动样片渲染；当前 nice=${observedNice}`
    );
  }
  return observedNice;
}

async function atomicPublishDirectoryNoReplace(source, target) {
  const code = [
    "import ctypes, errno, os, sys",
    "source, target = os.fsencode(sys.argv[1]), os.fsencode(sys.argv[2])",
    "if os.path.lexists(sys.argv[2]): raise FileExistsError(sys.argv[2])",
    "lib = ctypes.CDLL(None, use_errno=True)",
    "fn = lib.renamex_np",
    "fn.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]",
    "result = fn(source, target, 0x00000004)",
    "if result != 0:",
    "  number = ctypes.get_errno()",
    "  if number in (errno.EEXIST, errno.ENOTEMPTY): raise FileExistsError(sys.argv[2])",
    "  raise OSError(number, os.strerror(number), sys.argv[2])"
  ].join("\n");
  await run(PYTHON, ["-I", "-c", code, source, target], 30_000);
}

function buildInputProps(episode, timeline) {
  const subtitles = timeline.displayCues.map((cue) => ({
    start: cue.start,
    end: cue.end,
    text: cue.text
  }));
  return {
    episode: {...episode, subtitles},
    burnInSubtitle: false,
    renderAudio: false
  };
}

async function renderBase(stagingDirectory, inputProps) {
  const {bundle} = await import("@remotion/bundler");
  const {renderMedia, selectComposition} = await import("@remotion/renderer");
  const bundleDirectory = resolve(stagingDirectory, "bundle");
  const outputLocation = resolve(stagingDirectory, "render-base.mp4");
  const serveUrl = await bundle({
    entryPoint: ENTRY_POINT,
    publicDir: PUBLIC_ROOT,
    outDir: bundleDirectory,
    enableCaching: false,
    onProgress: () => undefined
  });
  const composition = await selectComposition({
    serveUrl,
    id: V004D_PACING_BORDER_PROOF.compositionId,
    inputProps,
    browserExecutable: CHROME,
    onBrowserDownload: () => {
      throw new Error("禁止下载浏览器；必须使用已安装 Chrome");
    },
    timeoutInMilliseconds: 180_000,
    logLevel: "warn"
  });
  await renderMedia({
    composition,
    serveUrl,
    outputLocation,
    inputProps,
    browserExecutable: CHROME,
    onBrowserDownload: () => {
      throw new Error("禁止下载浏览器；必须使用已安装 Chrome");
    },
    timeoutInMilliseconds: 180_000,
    codec: "h264",
    pixelFormat: "yuv420p",
    crf: 18,
    concurrency: 1,
    frameRange: [
      V004D_PACING_BORDER_PROOF.globalStartFrame,
      V004D_PACING_BORDER_PROOF.globalEndFrameInclusive
    ],
    imageFormat: "png",
    hardwareAcceleration: "disable",
    muted: true,
    enforceAudioTrack: false,
    overwrite: false,
    logLevel: "warn"
  });
  return {bundleDirectory, outputLocation, composition};
}

function finalFfmpegArguments(renderBasePath, outputPath) {
  const contract = V004D_PACING_BORDER_PROOF;
  const filter = buildSynchronizedPacingFilterGraph({
    playbackRate: contract.playbackRate,
    overlayX: contract.overlayX,
    overlayY: contract.overlayY,
    audioStartSample: contract.sourceStartSample,
    audioEndSampleExclusive: contract.sourceEndSampleExclusive,
    outputAudioSamples: contract.outputAudioSamples
  });
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
    "-i", renderBasePath,
    "-framerate", String(contract.fps), "-start_number", "0",
    "-i", resolve(REUSED_OVERLAY_FRAMES, "frame-%05d.png"),
    "-i", VOICE_PATH,
    "-filter_complex_threads", "1",
    "-filter_complex", filter,
    "-map", "[v]", "-map", "[a]",
    "-frames:v", String(contract.outputFrameCount),
    "-r", String(contract.fps), "-fps_mode", "cfr",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-profile:v", "high", "-level:v", "4.0", "-pix_fmt", "yuv420p",
    "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "1",
    "-t", contract.outputDurationSeconds.toFixed(6),
    "-movflags", "+faststart",
    outputPath
  ];
}

async function probe(path, ffprobe) {
  const {stdout} = await run(ffprobe, [
    "-v", "error", "-count_frames", "-show_format", "-show_streams",
    "-of", "json", path
  ], 120_000);
  return JSON.parse(stdout);
}

async function extractContactSheet(videoPath, qaDirectory, ffmpeg) {
  const timestamps = [0.6, 3.4, 6.2, 9.2, 12.4, 16.2];
  const stills = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const path = resolve(qaDirectory, `frame-${String(index + 1).padStart(2, "0")}.png`);
    await run(ffmpeg, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
      "-ss", timestamps[index].toFixed(3), "-i", videoPath,
      "-frames:v", "1", "-c:v", "png", path
    ], 120_000);
    stills.push(path);
  }
  const filter = [
    "[0:v]scale=640:360[s0]", "[1:v]scale=640:360[s1]",
    "[2:v]scale=640:360[s2]", "[3:v]scale=640:360[s3]",
    "[4:v]scale=640:360[s4]", "[5:v]scale=640:360[s5]",
    "[s0][s1][s2]hstack=inputs=3[top]",
    "[s3][s4][s5]hstack=inputs=3[bottom]",
    "[top][bottom]vstack=inputs=2[sheet]"
  ].join(";");
  const contactSheetPath = resolve(qaDirectory, "contact-sheet.png");
  await run(ffmpeg, [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
    ...stills.flatMap((path) => ["-i", path]),
    "-filter_complex", filter, "-map", "[sheet]", "-frames:v", "1",
    "-c:v", "png", contactSheetPath
  ], 120_000);
  return {timestamps, stills, contactSheetPath};
}

function relativePath(path) {
  return relative(WORKSPACE_ROOT, path);
}

export async function renderV004dPacingBorderProof() {
  const contract = V004D_PACING_BORDER_PROOF;
  const observedNice = assertLowPriority();
  const [ffmpeg, ffprobe] = await Promise.all([
    realpath(FFMPEG_PATH),
    realpath(FFPROBE_PATH)
  ]);
  await mkdir(REVIEW_ROOT, {recursive: true});
  if (await exists(CANDIDATE_DIRECTORY)) {
    throw new Error(`拒绝覆盖既有样片：${CANDIDATE_DIRECTORY}`);
  }
  await Promise.all([
    assertPlainFile(ENTRY_POINT, "Remotion entry"),
    assertPlainFile(EPISODE_PATH, "episode"),
    assertHash(TIMELINE_PATH, contract.timelineSha256, "v004c timeline"),
    assertHash(VOICE_PATH, contract.voiceSha256, "临时 Tingting 旁白"),
    assertHash(
      REUSED_OVERLAY_MANIFEST,
      contract.reusedOverlayManifestSha256,
      "已验收字幕图层 manifest"
    ),
    assertPlainFile(ffmpeg, "ffmpeg"),
    assertPlainFile(ffprobe, "ffprobe"),
    assertPlainFile(PYTHON, "python"),
    assertPlainFile(CHROME, "Chrome")
  ]);
  const [episodeRaw, timelineRaw] = await Promise.all([
    readFile(EPISODE_PATH, "utf8"),
    readFile(TIMELINE_PATH, "utf8")
  ]);
  const episode = JSON.parse(episodeRaw);
  const timeline = JSON.parse(timelineRaw);
  const inputProps = buildInputProps(episode, timeline);
  const stagingDirectory = resolve(REVIEW_ROOT, `.${CANDIDATE_NAME}.part-${randomUUID()}`);
  await mkdir(stagingDirectory, {recursive: false});
  const qaDirectory = resolve(stagingDirectory, "qa");
  await mkdir(qaDirectory);
  const sourceFiles = [
    SCRIPT_PATH,
    ENTRY_POINT,
    resolve(STUDIO_ROOT, "src/video/agent-skill-long-review-root.jsx"),
    resolve(STUDIO_ROOT, "src/video/agent-skill-long-review.jsx"),
    resolve(STUDIO_ROOT, "src/video/agent-skill-long-review-plan.mjs"),
    resolve(STUDIO_ROOT, "src/video/components/visual-system-v1/brand-layer.jsx"),
    resolve(STUDIO_ROOT, "src/video/components/visual-system-v1/components.jsx"),
    resolve(STUDIO_ROOT, "src/video/components/visual-system-v1/surface-border.mjs"),
    resolve(STUDIO_ROOT, "src/video/components/visual-system-v1/technical-artifact.jsx"),
    resolve(STUDIO_ROOT, "src/video/components/visual-system-v1/tokens.mjs"),
    resolve(STUDIO_ROOT, "src/server/production/presentation-pacing.mjs"),
    TIMELINE_PATH,
    VOICE_PATH,
    REUSED_OVERLAY_MANIFEST
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(sourceFiles.map(async (path) => [relativePath(path), await fileSha256(path)]))
  );
  try {
    const base = await renderBase(stagingDirectory, inputProps);
    const outputPath = resolve(stagingDirectory, OUTPUT_FILE_NAME);
    await run(ffmpeg, finalFfmpegArguments(base.outputLocation, outputPath), 900_000);
    const mediaProbe = await probe(outputPath, ffprobe);
    await run(ffmpeg, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
      "-i", outputPath, "-map", "0:v:0", "-an", "-c:v", "rawvideo",
      "-f", "null", "-"
    ], 900_000);
    await run(ffmpeg, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
      "-i", outputPath, "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le",
      "-f", "null", "-"
    ], 900_000);
    const contactSheet = await extractContactSheet(outputPath, qaDirectory, ffmpeg);
    await writeFile(
      resolve(qaDirectory, "media-probe.json"),
      `${JSON.stringify(mediaProbe, null, 2)}\n`,
      {encoding: "utf8", flag: "wx"}
    );
    await rm(base.bundleDirectory, {recursive: true, force: false});
    await rm(base.outputLocation, {force: false});
    const outputSha256 = await fileSha256(outputPath);
    const {stdout: gitHeadRaw} = await run("git", ["rev-parse", "HEAD"], 30_000);
    const manifest = {
      schemaVersion: contract.schemaVersion,
      status: "proof-only-awaiting-human-visual-and-pacing-confirmation",
      warning: "临时 Tingting 系统旁白，不是最终真人录音；本片仅验证1.15倍节奏和卡片/分组边框。",
      contract,
      output: {
        path: relativePath(resolve(CANDIDATE_DIRECTORY, OUTPUT_FILE_NAME)),
        sha256: outputSha256
      },
      sourceRange: {
        globalStartFrame: contract.globalStartFrame,
        globalEndFrameInclusive: contract.globalEndFrameInclusive,
        startTimestamp: "05:36.000",
        endTimestampExclusive: "05:56.000"
      },
      pacing: {
        strategy: "uniform-pitch-preserving-retime",
        video: "setpts",
        audio: "atempo",
        captions: "composited-before-retime",
        playbackRate: contract.playbackRate,
        sourceEquivalentSayRate: 173,
        outputEquivalentSayRate: contract.equivalentSayRate,
        sourceDurationSeconds: contract.sourceDurationSeconds,
        outputDurationSeconds: contract.outputDurationSeconds
      },
      subtitles: {
        timelineSha256: contract.timelineSha256,
        noContainer: true,
        overlayManifestSha256: contract.reusedOverlayManifestSha256,
        reuseReason: "字幕文字与source-frame时序未变；先合成后等速缩放，避免重新分段引入漂移。"
      },
      qa: {
        fullVideoDecodePassed: true,
        fullAudioDecodePassed: true,
        mediaProbe: "qa/media-probe.json",
        contactSheet: "qa/contact-sheet.png",
        contactSheetTimestamps: contactSheet.timestamps
      },
      source: {gitHead: gitHeadRaw.trim(), files: sourceHashes},
      scheduling: {
        requiredPrefix: ["/usr/sbin/taskpolicy", "-b", "/usr/bin/nice", "-n", "20"],
        observedNice,
        concurrency: 1
      },
      acceptanceBoundary: {
        proofOnly: true,
        fullVideoAcceptance: false,
        humanVisualApproval: false,
        finalHumanRecording: false,
        authorizesGitCommitPushPrOrMerge: false
      }
    };
    await writeFile(
      resolve(stagingDirectory, "proof-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      {encoding: "utf8", flag: "wx"}
    );
    if (await exists(CANDIDATE_DIRECTORY)) {
      throw new Error(`发布前发现同名样片，拒绝覆盖：${CANDIDATE_DIRECTORY}`);
    }
    await atomicPublishDirectoryNoReplace(stagingDirectory, CANDIDATE_DIRECTORY);
    return {
      outputPath: resolve(CANDIDATE_DIRECTORY, OUTPUT_FILE_NAME),
      contactSheetPath: resolve(CANDIDATE_DIRECTORY, "qa/contact-sheet.png"),
      manifestPath: resolve(CANDIDATE_DIRECTORY, "proof-manifest.json"),
      sha256: outputSha256
    };
  } catch (error) {
    error.stagingDirectory = stagingDirectory;
    throw error;
  }
}

async function main() {
  const result = await renderV004dPacingBorderProof();
  process.stdout.write(`${JSON.stringify({ok: true, ...result}, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    if (error.stagingDirectory) {
      process.stderr.write(`失败输入已保留：${error.stagingDirectory}\n`);
    }
    process.exitCode = 1;
  });
}
