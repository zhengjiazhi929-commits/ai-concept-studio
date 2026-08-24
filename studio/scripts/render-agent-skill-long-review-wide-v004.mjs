import { constants as fsConstants } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  readFile,
  rmdir,
  unlink,
  writeFile
} from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import {
  getVideoMetadata,
  renderMedia,
  selectComposition
} from "@remotion/renderer";

import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import {
  ensureInside,
  publicRoot,
  studioOutputRoot,
  studioRoot,
  videoRoot,
  workspaceRoot
} from "../src/shared/paths.mjs";

export const REVIEW_WIDE_V004_RENDER_CONTRACT = Object.freeze({
  episodeId: "agent-skill-20260806",
  compositionId: "AgentSkillLongReview",
  width: 1920,
  height: 1080,
  fps: 30,
  durationSeconds: 600,
  durationInFrames: 18_000,
  codec: "h264",
  audioCodec: "aac",
  pixelFormat: "yuv420p",
  crf: 22,
  concurrency: "25%",
  sampleRate: 48_000,
  candidateVersion: 4,
  candidateDirectoryName: "full-video-current-visual-upgrade-v004",
  outputFileName: "review-10m.mp4",
  temporaryOutputFileName: "review-10m.rendering.mp4",
  manifestFileName: "review-manifest.json",
  temporaryManifestFileName: "review-manifest.rendering.json"
});

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PREVIOUS_CANDIDATE_DIRECTORY_NAME = "full-video-current-visual-upgrade-v003";
const PREVIOUS_REVIEW_SOURCE_HASHES = Object.freeze({
  "studio/src/video/agent-skill-long-review-root.jsx":
    "878fcd51cc75a443735c3c2e28c5e3b24ed9f7594b02e736f48b026b09072537",
  "studio/src/video/agent-skill-long-review.jsx":
    "ecf6308c261b359a3756f9d68714a03bf52aacdca01237ee83a17e091b993672",
  "studio/src/video/agent-skill-long-review-plan.mjs":
    "5c2721823d086f0ca174dc9684ceb1714e36286720304668646d11946284ea21"
});
const REVIEW_ENTRY_POINT = resolve(videoRoot, "agent-skill-long-review-index.jsx");
const EPISODE_OUTPUT_ROOT = ensureInside(
  studioOutputRoot,
  resolve(studioOutputRoot, REVIEW_WIDE_V004_RENDER_CONTRACT.episodeId)
);
const REVIEW_CANDIDATES_ROOT = ensureInside(
  EPISODE_OUTPUT_ROOT,
  resolve(EPISODE_OUTPUT_ROOT, "review-candidates")
);
const CANDIDATE_DIRECTORY = ensureInside(
  REVIEW_CANDIDATES_ROOT,
  resolve(
    REVIEW_CANDIDATES_ROOT,
    REVIEW_WIDE_V004_RENDER_CONTRACT.candidateDirectoryName
  )
);

function workspaceRelative(filePath) {
  return relative(workspaceRoot, filePath).replaceAll("\\", "/");
}

export const REVIEW_WIDE_V004_PATHS = Object.freeze({
  candidateDirectory: CANDIDATE_DIRECTORY,
  candidateDirectoryRelative: workspaceRelative(CANDIDATE_DIRECTORY),
  outputPath: resolve(
    CANDIDATE_DIRECTORY,
    REVIEW_WIDE_V004_RENDER_CONTRACT.outputFileName
  ),
  outputPathRelative: workspaceRelative(resolve(
    CANDIDATE_DIRECTORY,
    REVIEW_WIDE_V004_RENDER_CONTRACT.outputFileName
  )),
  manifestPath: resolve(
    CANDIDATE_DIRECTORY,
    REVIEW_WIDE_V004_RENDER_CONTRACT.manifestFileName
  ),
  manifestPathRelative: workspaceRelative(resolve(
    CANDIDATE_DIRECTORY,
    REVIEW_WIDE_V004_RENDER_CONTRACT.manifestFileName
  ))
});

const protectedFile = (id, path, bytes, sha256) => Object.freeze({
  id,
  path: ensureInside(workspaceRoot, resolve(workspaceRoot, path)),
  bytes,
  sha256
});

export const PROTECTED_WIDE_V004_BASELINES = Object.freeze([
  protectedFile(
    "episode",
    "studio/data/episodes/agent-skill-20260806/episode.json",
    426_756,
    "beab25b1bf1515616bf42baea48d376ba78d26e009841124c5faf997a0f86d4b"
  ),
  protectedFile(
    "approved-script-v003",
    "studio/data/production/episodes/agent-skill-20260806/script-draft-v003.json",
    10_430,
    "2b0063c3967fe5e1950cc56637d80e735c358761946c6cd0f0bdb6e9352b42ff"
  ),
  protectedFile(
    "approved-storyboard-v003",
    "studio/data/production/episodes/agent-skill-20260806/storyboard-draft-v003.json",
    50_447,
    "5381a7176cb07118cf363a4cf6637154fa0ea978539310a1d474b085a5ed85c8"
  ),
  protectedFile(
    "temporary-system-voice-v001",
    "studio/public/episodes/agent-skill-20260806/voice-v001.wav",
    26_227_376,
    "643b7f68d0561e73d5f6177a4ea682c8cbe6339824b7cd5a1aa811069beaa6da"
  ),
  protectedFile(
    "review-v001-video",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v001/review-10m.mp4",
    31_279_449,
    "ffc4f8ec057f95f8b28002cf9fd76f8382b2a38f17e4e6f7b0f4e7b814abbba5"
  ),
  protectedFile(
    "review-v001-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v001/review-manifest.json",
    15_888,
    "f66d9e46447fc085fa8e34189544c15d6e3ca648599e214a4b9626b78fecccf7"
  ),
  protectedFile(
    "review-v001-qa-summary",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v001/qa/qa-summary.json",
    2_372,
    "66fbd426d8b52ca8c242a8c2b38288b5a2df04951fe2c7c16879c00cad23517c"
  ),
  protectedFile(
    "review-v002-video",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v002/review-10m.mp4",
    29_925_030,
    "75df865cfd80309d4d063b1efa47ac5b17ff77e29fba0e14ac0c2958604a773a"
  ),
  protectedFile(
    "review-v002-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v002/review-manifest.json",
    19_327,
    "cee09fab00789aa7de0b323dc55e9ea6b2ee74f959863e91fae42f428296557e"
  ),
  protectedFile(
    "review-v002-qa-summary",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v002/qa/qa-summary.json",
    5_084,
    "04d13c86b1510ccb0af5c75d37230b7323177ec86a4bfbb8d80ebe9140e9d51c"
  ),
  protectedFile(
    "review-v003-video",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v003/review-10m.mp4",
    29_921_407,
    "56d3be4fc048c37cc08d303b804890be15b39a2353aeef7233e6b8393a007001"
  ),
  protectedFile(
    "review-v003-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v003/review-manifest.json",
    21_845,
    "c5416143d4c5d27ac8ed596c9944569ad477df7daece6644ffb4f31ade5de32b"
  ),
  protectedFile(
    "review-v003-qa-summary",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v003/qa/qa-summary.json",
    6_900,
    "8438d6bb07e8ab0c0ac2926e7b462b4e37fcdd709c9138e0584c948b5e36046c"
  ),
  protectedFile(
    "formal-preview-v001-video",
    "outputs/studio/agent-skill-20260806/preview-v001.mp4",
    34_053_833,
    "c3e9a1f6594c562e7ff25cba66c0aabde7a3a94d420d629ca200bdcf8e25788f"
  ),
  protectedFile(
    "formal-preview-v001-qa",
    "outputs/studio/agent-skill-20260806/preview-qa-v001.json",
    15_779,
    "0da13f86bcf82325189eb679f8cb4d3d5ef76104ebd73a40616e16823aae07d8"
  ),
  protectedFile(
    "formal-preview-v002-video",
    "outputs/studio/agent-skill-20260806/preview-v002.mp4",
    34_068_653,
    "68fb9ab771c524e7e218df29c718f8cbffac096f3c2db9217d5f78f59a7c65e4"
  ),
  protectedFile(
    "formal-preview-v002-qa",
    "outputs/studio/agent-skill-20260806/preview-qa-v002.json",
    17_251,
    "e83a63c1217dbc7b81b03f99b46340d7d1698c4b1102eb2cfcfbe3376df2480a"
  ),
  protectedFile(
    "formal-preview-v003-video",
    "outputs/studio/agent-skill-20260806/preview-v003.mp4",
    34_060_244,
    "ecde2c062958af4ae53d531334ed74cb19abfe47adba95aeaceb154d141ca4e1"
  ),
  protectedFile(
    "formal-preview-v003-qa",
    "outputs/studio/agent-skill-20260806/preview-qa-v003.json",
    17_251,
    "616e14e2ccb814753c662726192d0b3b0fced99c7424353c9e0e2990624e8524"
  ),
  protectedFile(
    "formal-preview-v003-qa-r002",
    "outputs/studio/agent-skill-20260806/preview-qa-v003-r002.json",
    18_403,
    "f784b7a60c3dd4a61bdfe0ec464fb3545fb46a34a04494a9ea66c96e5a3fe92f"
  ),
  protectedFile(
    "formal-preview-v004-video",
    "outputs/studio/agent-skill-20260806/preview-v004.mp4",
    33_992_667,
    "f697082723c626e719a2ae447d3784f3466e8b09c4ab827212485498b12b2204"
  ),
  protectedFile(
    "formal-preview-v004-qa",
    "outputs/studio/agent-skill-20260806/preview-qa-v004.json",
    18_403,
    "7007e89bc73cccdba9d322a588c29ec45dd4d21f6babe26cf0958f745b2cb7c8"
  ),
  protectedFile(
    "formal-preview-v005-video",
    "outputs/studio/agent-skill-20260806/preview-v005.mp4",
    27_970_244,
    "16c098964d8e99ce68ba9e930583fa981ff31095cfa29088b9f0c5feb10789c1"
  ),
  protectedFile(
    "formal-preview-v005-qa",
    "outputs/studio/agent-skill-20260806/preview-qa-v005.json",
    18_403,
    "fcdc5a1f0c59cfb676b2bcd0c4f6a60490dead5683fb0293a54318f292cf698c"
  )
]);

const VISUAL_SYSTEM_INPUT_PATHS = Object.freeze([
  "ai-watermark.jsx",
  "ai-watermark.mjs",
  "chapter-progress.mjs",
  "components.jsx",
  "index.jsx",
  "layout.mjs",
  "motion.mjs",
  "tokens.mjs"
].map((fileName) => resolve(
  videoRoot,
  "components",
  "visual-system-v1",
  fileName
)));

const WATERMARK_FRAME_INPUT_PATHS = Object.freeze(Array.from(
  { length: 120 },
  (_, frame) => resolve(
    publicRoot,
    "assets",
    "visual-system-v1",
    "ai-watermark-v012",
    "frames",
    `frame-${String(frame).padStart(3, "0")}.png`
  )
));

const REVIEW_INPUT_PATHS = Object.freeze([
  REVIEW_ENTRY_POINT,
  resolve(videoRoot, "agent-skill-long-review-root.jsx"),
  resolve(videoRoot, "agent-skill-long-review.jsx"),
  resolve(videoRoot, "agent-skill-long-review-plan.mjs"),
  resolve(videoRoot, "visual-system-v1-ai-watermark-proof-plan.mjs"),
  resolve(studioRoot, "config", "visual-system.json"),
  resolve(studioRoot, "src", "shared", "technical-diagram-contract.mjs"),
  ...VISUAL_SYSTEM_INPUT_PATHS,
  ...[1, 2, 3, 4, 5].map((version) => resolve(
    publicRoot,
    "episodes",
    REVIEW_WIDE_V004_RENDER_CONTRACT.episodeId,
    "materials",
    `material-v${String(version).padStart(3, "0")}.png`
  )),
  resolve(
    publicRoot,
    "assets",
    "visual-system-v1",
    "ai-watermark-v012",
    "manifest.json"
  ),
  ...WATERMARK_FRAME_INPUT_PATHS
]);

const FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT = Object.freeze([
  resolve(EPISODE_OUTPUT_ROOT, "preview-v006.mp4"),
  resolve(EPISODE_OUTPUT_ROOT, "preview-v006.rendering.mp4"),
  resolve(EPISODE_OUTPUT_ROOT, "preview-qa-v006.json")
]);

function baselineById(id) {
  const baseline = PROTECTED_WIDE_V004_BASELINES.find((item) => item.id === id);
  if (!baseline) throw new Error(`缺少受保护基线：${id}`);
  return baseline;
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

async function assertAbsent(filePath, label = workspaceRelative(filePath)) {
  if (await pathExists(filePath)) {
    throw new Error(`${label} 已存在；为避免覆盖，横版 v004 渲染已停止`);
  }
}

async function snapshotFile(filePath, options = {}) {
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`只允许读取普通文件：${workspaceRelative(filePath)}`);
  }
  const integrity = await inspectFileIntegrity(filePath);
  const after = await lstat(filePath);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  ) {
    throw new Error(`文件在快照期间发生变化：${workspaceRelative(filePath)}`);
  }
  const snapshot = {
    path: workspaceRelative(filePath),
    bytes: integrity.bytes,
    sha256: integrity.sha256,
    dev: after.dev,
    ino: after.ino,
    mtimeMs: after.mtimeMs,
    ctimeMs: after.ctimeMs
  };
  if (
    options.expected &&
    (
      snapshot.bytes !== options.expected.bytes ||
      snapshot.sha256 !== options.expected.sha256
    )
  ) {
    throw new Error(
      `${options.expected.id} 与受保护基线不一致：` +
      `${snapshot.bytes} bytes / ${snapshot.sha256}`
    );
  }
  return snapshot;
}

export async function captureWideV004ProtectedBaselines() {
  const entries = await Promise.all(PROTECTED_WIDE_V004_BASELINES.map(async (expected) => [
    expected.id,
    await snapshotFile(expected.path, { expected })
  ]));
  return Object.fromEntries(entries);
}

export async function captureWideV004ReviewInputs() {
  const entries = await Promise.all(REVIEW_INPUT_PATHS.map(async (filePath) => [
    workspaceRelative(filePath),
    await snapshotFile(filePath)
  ]));
  return Object.fromEntries(entries);
}

export function assertWideV004InputsChanged(reviewInputs) {
  const sourcePaths = Object.keys(PREVIOUS_REVIEW_SOURCE_HASHES);
  const missingPaths = sourcePaths.filter((sourcePath) => {
    const sha256 = reviewInputs?.[sourcePath]?.sha256;
    return typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256);
  });
  if (missingPaths.length > 0) {
    throw new Error(`无法验证 v003 审阅源文件：${missingPaths.join(", ")}`);
  }
  const changedPaths = sourcePaths.filter(
    (sourcePath) => reviewInputs[sourcePath].sha256 !== PREVIOUS_REVIEW_SOURCE_HASHES[sourcePath]
  );
  if (changedPaths.length === 0) {
    throw new Error("v004 的审阅源仍全部等于 v003；拒绝只更换候选目录名");
  }
  return changedPaths;
}

function sameSnapshot(before, after) {
  return (
    before.path === after.path &&
    before.bytes === after.bytes &&
    before.sha256 === after.sha256 &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

export function assertWideV004SnapshotsUnchanged(label, before, after) {
  const beforeKeys = Object.keys(before).sort();
  const afterKeys = Object.keys(after).sort();
  if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) {
    throw new Error(`${label} 文件集合在渲染期间发生变化`);
  }
  for (const key of beforeKeys) {
    if (!sameSnapshot(before[key], after[key])) {
      throw new Error(`${label} 在渲染期间发生变化：${key}`);
    }
  }
}

async function assertFormalOutputsStillAbsent() {
  for (const filePath of FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT) {
    await assertAbsent(filePath, `正式产物 ${workspaceRelative(filePath)}`);
  }
}

function assertLocalChrome() {
  return lstat(CHROME_EXECUTABLE).then(async (stat) => {
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("本机 Google Chrome 路径不是普通可执行文件");
    }
    await access(CHROME_EXECUTABLE, fsConstants.R_OK | fsConstants.X_OK);
  });
}

function assertEpisodeContract(episode) {
  const contract = REVIEW_WIDE_V004_RENDER_CONTRACT;
  if (episode?.id !== contract.episodeId) throw new Error("Episode ID 与横版 v004 合同不一致");
  if (!Array.isArray(episode.scenes) || episode.scenes.length !== 18) {
    throw new Error("10 分钟横版审阅输入必须包含 18 个正式场景");
  }
  if (episode.scenes[0]?.start !== 0 || episode.scenes.at(-1)?.end !== 600) {
    throw new Error("正式场景没有连续覆盖 0–600 秒");
  }
  if (!Array.isArray(episode.subtitles) || episode.subtitles.length !== 107) {
    throw new Error("10 分钟横版审阅输入必须包含 107 条正式字幕");
  }
  if (
    episode.render?.version !== 5 ||
    episode.render?.outputPath !== "outputs/studio/agent-skill-20260806/preview-v005.mp4" ||
    episode.render?.sha256 !== baselineById("formal-preview-v005-video").sha256
  ) {
    throw new Error("Episode 当前渲染记录不再精确绑定受保护的 preview-v005");
  }
  if (
    episode.voice?.publicPath !== "episodes/agent-skill-20260806/voice-v001.wav" ||
    episode.voice?.durationSeconds !== 594.632 ||
    episode.voice?.sha256 !== baselineById("temporary-system-voice-v001").sha256
  ) {
    throw new Error("临时系统旁白不再精确绑定受保护的 voice-v001.wav");
  }
  if (episode.approvals?.final?.status !== "pending" || episode.approvals?.final?.currentVersion !== 5) {
    throw new Error("正式 Final Gate 状态已变化；横版 v004 审阅渲染拒绝继续");
  }
}

export function assertWideV004Composition(composition) {
  const contract = REVIEW_WIDE_V004_RENDER_CONTRACT;
  const actual = {
    id: composition.id,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames
  };
  const expected = {
    id: contract.compositionId,
    width: contract.width,
    height: contract.height,
    fps: contract.fps,
    durationInFrames: contract.durationInFrames
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`横版 v004 Composition 不符合固定合同：${JSON.stringify(actual)}`);
  }
}

const MP4A_BOX_TYPE = Buffer.from("mp4a", "ascii");

export function parseMp4AudioSampleRate(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("MP4 数据必须是 Buffer");
  let typeOffset = buffer.indexOf(MP4A_BOX_TYPE);
  while (typeOffset >= 4) {
    const boxStart = typeOffset - 4;
    const boxSize = buffer.readUInt32BE(boxStart);
    const sampleRateOffset = boxStart + 32;
    if (boxSize >= 36 && boxStart + boxSize <= buffer.length && sampleRateOffset + 4 <= buffer.length) {
      const channelCount = buffer.readUInt16BE(boxStart + 24);
      const sampleSize = buffer.readUInt16BE(boxStart + 26);
      const fixedPointSampleRate = buffer.readUInt32BE(sampleRateOffset);
      const sampleRate = fixedPointSampleRate / 65_536;
      if (
        channelCount >= 1 &&
        channelCount <= 32 &&
        sampleSize >= 8 &&
        sampleSize <= 64 &&
        Number.isInteger(sampleRate) &&
        sampleRate >= 8_000 &&
        sampleRate <= 384_000
      ) {
        return sampleRate;
      }
    }
    typeOffset = buffer.indexOf(MP4A_BOX_TYPE, typeOffset + MP4A_BOX_TYPE.length);
  }
  throw new Error("无法从 MP4 的 mp4a sample entry 读取音频采样率");
}

async function readMp4AudioSampleRate(filePath) {
  return parseMp4AudioSampleRate(await readFile(filePath));
}

export function assertWideV004Media(metadata, integrity, audioSampleRate) {
  const contract = REVIEW_WIDE_V004_RENDER_CONTRACT;
  const failures = [
    [metadata.width === contract.width, `width=${metadata.width}`],
    [metadata.height === contract.height, `height=${metadata.height}`],
    [Math.abs(metadata.fps - contract.fps) < 0.1, `fps=${metadata.fps}`],
    [
      Math.abs(metadata.durationInSeconds - contract.durationSeconds) < 0.35,
      `duration=${metadata.durationInSeconds}`
    ],
    [metadata.codec === contract.codec, `codec=${metadata.codec}`],
    [metadata.audioCodec === contract.audioCodec, `audioCodec=${metadata.audioCodec}`],
    [metadata.pixelFormat === contract.pixelFormat, `pixelFormat=${metadata.pixelFormat}`],
    [audioSampleRate === contract.sampleRate, `sampleRate=${audioSampleRate}`],
    [metadata.canPlayInVideoTag === true, `canPlayInVideoTag=${metadata.canPlayInVideoTag}`],
    [metadata.supportsSeeking === true, `supportsSeeking=${metadata.supportsSeeking}`],
    [Number.isSafeInteger(integrity.bytes) && integrity.bytes > 50_000, `bytes=${integrity.bytes}`],
    [/^[a-f0-9]{64}$/u.test(integrity.sha256), `sha256=${integrity.sha256}`]
  ].filter(([passed]) => !passed).map(([, finding]) => finding);
  if (failures.length > 0) {
    throw new Error(`横版 v004 媒体合同未通过：${failures.join(", ")}`);
  }
}

function denyBrowserDownload() {
  throw new Error("禁止下载 Chrome/Chromium；必须使用已验证的本机 Google Chrome");
}

function localOnlyAssetDownloadTracker(downloads) {
  return (src) => {
    let url;
    try {
      url = new URL(src);
    } catch {
      throw new Error(`渲染尝试下载无法验证的媒体：${src}`);
    }
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (!localHosts.has(url.hostname)) {
      throw new Error(`渲染尝试访问外部媒体，已阻断：${src}`);
    }
    downloads.add(src);
  };
}

async function ensureCandidateDirectory() {
  await assertAbsent(
    CANDIDATE_DIRECTORY,
    `横版 v004 候选目录 ${workspaceRelative(CANDIDATE_DIRECTORY)}`
  );
  await mkdir(REVIEW_CANDIDATES_ROOT, { recursive: true });
  const rootStat = await lstat(REVIEW_CANDIDATES_ROOT);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("review-candidates 必须是普通目录，不能是符号链接");
  }
  await mkdir(CANDIDATE_DIRECTORY, { recursive: false });
}

async function unlinkOwnedFileIfPresent(filePath) {
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`拒绝清理非普通文件：${workspaceRelative(filePath)}`);
    }
    await unlink(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

async function removeIncompleteCandidate(ownedPaths) {
  const expected = resolve(
    REVIEW_CANDIDATES_ROOT,
    REVIEW_WIDE_V004_RENDER_CONTRACT.candidateDirectoryName
  );
  if (CANDIDATE_DIRECTORY !== expected) {
    throw new Error("拒绝清理未验证的候选路径");
  }
  for (const filePath of ownedPaths) await unlinkOwnedFileIfPresent(filePath);
  await rmdir(CANDIDATE_DIRECTORY);
}

async function publishFileWithoutOverwrite(temporaryPath, finalPath) {
  const sourceStat = await lstat(temporaryPath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`拒绝发布非普通临时文件：${workspaceRelative(temporaryPath)}`);
  }
  await assertAbsent(finalPath);
  await link(temporaryPath, finalPath);
  await unlink(temporaryPath);
}

function bundleProgressReporter() {
  let lastPercent = -10;
  return (progress) => {
    const percent = Math.max(0, Math.min(100, Math.floor(progress)));
    if (percent >= lastPercent + 10 || percent === 100) {
      lastPercent = percent;
      console.log(`横版 v004 打包：${percent}%`);
    }
  };
}

function renderProgressReporter() {
  let lastPercent = -5;
  return ({ progress }) => {
    const percent = Math.max(0, Math.min(100, Math.floor(progress * 100)));
    if (percent >= lastPercent + 5 || percent === 100) {
      lastPercent = percent;
      console.log(`横版 v004 10 分钟审阅版：${percent}%`);
    }
  };
}

export async function renderAgentSkillLongReviewWideV004() {
  const contract = REVIEW_WIDE_V004_RENDER_CONTRACT;
  const startedAt = new Date().toISOString();
  const temporaryOutputPath = resolve(CANDIDATE_DIRECTORY, contract.temporaryOutputFileName);
  const outputPath = resolve(CANDIDATE_DIRECTORY, contract.outputFileName);
  const temporaryManifestPath = resolve(CANDIDATE_DIRECTORY, contract.temporaryManifestFileName);
  const manifestPath = resolve(CANDIDATE_DIRECTORY, contract.manifestFileName);
  const ownedPaths = [temporaryManifestPath, manifestPath, temporaryOutputPath, outputPath];
  let candidateDirectoryCreated = false;

  await assertAbsent(
    CANDIDATE_DIRECTORY,
    `横版 v004 候选目录 ${workspaceRelative(CANDIDATE_DIRECTORY)}`
  );
  await assertLocalChrome();
  await assertFormalOutputsStillAbsent();
  console.log("横版 v004 安全预检：正在核对 episode、voice、v001-v003 和正式 preview 基线");
  const protectedBefore = await captureWideV004ProtectedBaselines();
  const reviewInputsBefore = await captureWideV004ReviewInputs();
  const changedPathsFromV003 = assertWideV004InputsChanged(reviewInputsBefore);
  const episode = JSON.parse(await readFile(baselineById("episode").path, "utf8"));
  assertEpisodeContract(episode);

  try {
    await ensureCandidateDirectory();
    candidateDirectoryCreated = true;
    for (const filePath of ownedPaths) await assertAbsent(filePath);

    const serveUrl = await bundle({
      entryPoint: REVIEW_ENTRY_POINT,
      publicDir: publicRoot,
      onProgress: bundleProgressReporter()
    });
    const inputProps = { episode: structuredClone(episode) };
    const composition = await selectComposition({
      serveUrl,
      id: contract.compositionId,
      inputProps,
      browserExecutable: CHROME_EXECUTABLE,
      chromeMode: "chrome-for-testing",
      onBrowserDownload: denyBrowserDownload,
      logLevel: "warn"
    });
    assertWideV004Composition(composition);

    const localAssetDownloads = new Set();
    await renderMedia({
      composition,
      serveUrl,
      outputLocation: temporaryOutputPath,
      inputProps,
      browserExecutable: CHROME_EXECUTABLE,
      chromeMode: "chrome-for-testing",
      onBrowserDownload: denyBrowserDownload,
      onDownload: localOnlyAssetDownloadTracker(localAssetDownloads),
      codec: contract.codec,
      audioCodec: contract.audioCodec,
      pixelFormat: contract.pixelFormat,
      crf: contract.crf,
      concurrency: contract.concurrency,
      sampleRate: contract.sampleRate,
      imageFormat: "png",
      enforceAudioTrack: true,
      muted: false,
      overwrite: false,
      logLevel: "warn",
      onProgress: renderProgressReporter()
    });

    const [metadata, stagedIntegrity, audioSampleRate] = await Promise.all([
      getVideoMetadata(temporaryOutputPath, { logLevel: "warn" }),
      inspectFileIntegrity(temporaryOutputPath),
      readMp4AudioSampleRate(temporaryOutputPath)
    ]);
    assertWideV004Media(metadata, stagedIntegrity, audioSampleRate);

    const protectedAfterRender = await captureWideV004ProtectedBaselines();
    const reviewInputsAfterRender = await captureWideV004ReviewInputs();
    assertWideV004SnapshotsUnchanged(
      "受保护 episode、voice、旧候选与正式 preview",
      protectedBefore,
      protectedAfterRender
    );
    assertWideV004SnapshotsUnchanged(
      "横版 v004 审阅渲染输入",
      reviewInputsBefore,
      reviewInputsAfterRender
    );
    await assertFormalOutputsStillAbsent();

    await publishFileWithoutOverwrite(temporaryOutputPath, outputPath);
    const finalIntegrity = await inspectFileIntegrity(outputPath);
    if (
      finalIntegrity.bytes !== stagedIntegrity.bytes ||
      finalIntegrity.sha256 !== stagedIntegrity.sha256
    ) {
      throw new Error("原子发布后横版 v004 视频摘要发生变化");
    }

    const protectedAfter = await captureWideV004ProtectedBaselines();
    const reviewInputsAfter = await captureWideV004ReviewInputs();
    assertWideV004SnapshotsUnchanged(
      "受保护 episode、voice、旧候选与正式 preview",
      protectedBefore,
      protectedAfter
    );
    assertWideV004SnapshotsUnchanged(
      "横版 v004 审阅渲染输入",
      reviewInputsBefore,
      reviewInputsAfter
    );
    await assertFormalOutputsStillAbsent();

    const previousVideo = protectedBefore["review-v003-video"];
    const previousManifest = protectedBefore["review-v003-manifest"];
    const previousQaSummary = protectedBefore["review-v003-qa-summary"];
    const manifest = {
      schemaVersion: "agent-skill-unregistered-long-review-v2",
      kind: "unregistered-review-candidate",
      registered: false,
      episodeId: contract.episodeId,
      compositionId: contract.compositionId,
      candidateVersion: contract.candidateVersion,
      supersedes: {
        candidateVersion: 3,
        candidateDirectoryName: PREVIOUS_CANDIDATE_DIRECTORY_NAME,
        video: previousVideo,
        manifest: previousManifest,
        qaSummary: previousQaSummary
      },
      sourceDeltaFromV003: {
        changedPaths: changedPathsFromV003,
        previousSha256ByPath: PREVIOUS_REVIEW_SOURCE_HASHES,
        currentSha256ByPath: Object.fromEntries(
          Object.keys(PREVIOUS_REVIEW_SOURCE_HASHES).map((sourcePath) => [
            sourcePath,
            reviewInputsBefore[sourcePath].sha256
          ])
        )
      },
      createdAt: new Date().toISOString(),
      startedAt,
      disclaimer: "本片保留现有 macOS Tingting 临时系统旁白，仅用于完整横版视觉与节奏检查；它不是真人录音，也不是最终声音批准。",
      approvalBoundary: {
        mutatesEpisode: false,
        mutatesVoice: false,
        mutatesPipeline: false,
        mutatesApproval: false,
        runsFormalAgent: false,
        runsFormalQa: false,
        performsCloudBackup: false,
        authorizesPublication: false
      },
      calls: {
        aiProviderCalls: 0,
        externalApiCalls: 0,
        paidApiCalls: 0,
        generatedImageCalls: 0,
        generatedVideoCalls: 0,
        browserDownloads: 0,
        localMediaDownloads: [...localAssetDownloads].sort()
      },
      voice: {
        mode: "temporary-local-system-voice",
        name: "Tingting",
        publicPath: episode.voice.publicPath,
        durationSeconds: episode.voice.durationSeconds,
        bytes: protectedBefore["temporary-system-voice-v001"].bytes,
        sha256: protectedBefore["temporary-system-voice-v001"].sha256,
        sampleRateAfterRender: audioSampleRate,
        finalApproved: false
      },
      render: {
        outputPath: workspaceRelative(outputPath),
        width: contract.width,
        height: contract.height,
        fps: contract.fps,
        durationSeconds: metadata.durationInSeconds,
        durationInFrames: contract.durationInFrames,
        codec: metadata.codec,
        audioCodec: metadata.audioCodec,
        pixelFormat: metadata.pixelFormat,
        crf: contract.crf,
        concurrency: contract.concurrency,
        sampleRate: audioSampleRate,
        canPlayInVideoTag: metadata.canPlayInVideoTag,
        supportsSeeking: metadata.supportsSeeking,
        bytes: finalIntegrity.bytes,
        sha256: finalIntegrity.sha256
      },
      environment: {
        browserExecutable: CHROME_EXECUTABLE,
        chromeMode: "chrome-for-testing",
        browserDownloadAllowed: false,
        externalMediaAllowed: false,
        entryPoint: workspaceRelative(REVIEW_ENTRY_POINT)
      },
      protectedBaselines: {
        before: protectedBefore,
        after: protectedAfter,
        unchanged: true
      },
      reviewInputs: {
        before: reviewInputsBefore,
        after: reviewInputsAfter,
        unchanged: true
      }
    };

    await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await publishFileWithoutOverwrite(temporaryManifestPath, manifestPath);

    const protectedFinal = await captureWideV004ProtectedBaselines();
    const reviewInputsFinal = await captureWideV004ReviewInputs();
    assertWideV004SnapshotsUnchanged(
      "受保护 episode、voice、旧候选与正式 preview",
      protectedBefore,
      protectedFinal
    );
    assertWideV004SnapshotsUnchanged(
      "横版 v004 审阅渲染输入",
      reviewInputsBefore,
      reviewInputsFinal
    );
    await assertFormalOutputsStillAbsent();

    return {
      outputPath,
      manifestPath,
      bytes: finalIntegrity.bytes,
      sha256: finalIntegrity.sha256,
      audioSampleRate,
      metadata
    };
  } catch (error) {
    if (candidateDirectoryCreated) {
      try {
        await removeIncompleteCandidate(ownedPaths);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "横版 v004 渲染失败，且安全清理未能完整结束"
        );
      }
    }
    throw error;
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  renderAgentSkillLongReviewWideV004()
    .then((result) => {
      console.log(JSON.stringify({
        ok: true,
        registered: false,
        outputPath: workspaceRelative(result.outputPath),
        manifestPath: workspaceRelative(result.manifestPath),
        bytes: result.bytes,
        sha256: result.sha256,
        audioSampleRate: result.audioSampleRate,
        metadata: result.metadata
      }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
