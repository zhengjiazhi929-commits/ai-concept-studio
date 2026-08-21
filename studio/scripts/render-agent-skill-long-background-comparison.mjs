import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
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
import {
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_DURATION_SECONDS,
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FPS,
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FRAME_COUNT,
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME,
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_SECOND,
  AGENT_SKILL_LONG_BACKGROUND_SELECTED_CANDIDATE
} from "../src/video/agent-skill-long-background-comparison-plan.mjs";
import { AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY } from "../src/video/agent-skill-long-background-motion.mjs";
import { validateAgentSkillLongReviewEpisode } from "../src/video/agent-skill-long-review-plan.mjs";

export const BACKGROUND_COMPARISON_RENDER_CONTRACT = Object.freeze({
  episodeId: "agent-skill-20260806",
  compositionId: "AgentSkillLongReview",
  candidateDirectoryName: "s10-background-comparison-v006",
  width: 540,
  height: 960,
  fps: AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FPS,
  durationSeconds: AGENT_SKILL_LONG_BACKGROUND_COMPARISON_DURATION_SECONDS,
  durationInFrames: AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FRAME_COUNT,
  sourceDurationInFrames: 18_000,
  startFrame: AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME,
  startSecond: AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_SECOND,
  codec: "h264",
  audioCodec: "aac",
  pixelFormat: "yuv420p",
  sampleRate: 48_000,
  crf: 18,
  concurrency: "25%"
});

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ENTRY_POINT = resolve(videoRoot, "agent-skill-long-review-index.jsx");
const EPISODE_PATH = resolve(studioRoot, "data", "episodes", "agent-skill-20260806", "episode.json");
const CANDIDATE_DIRECTORY = ensureInside(
  studioOutputRoot,
  resolve(
    studioOutputRoot,
    BACKGROUND_COMPARISON_RENDER_CONTRACT.episodeId,
    "review-candidates",
    BACKGROUND_COMPARISON_RENDER_CONTRACT.candidateDirectoryName
  )
);

const protectedFile = (id, path, bytes, sha256) => Object.freeze({
  id,
  path: ensureInside(workspaceRoot, resolve(workspaceRoot, path)),
  bytes,
  sha256
});

const PROTECTED_BASELINES = Object.freeze([
  protectedFile(
    "episode",
    "studio/data/episodes/agent-skill-20260806/episode.json",
    426_756,
    "beab25b1bf1515616bf42baea48d376ba78d26e009841124c5faf997a0f86d4b"
  ),
  protectedFile(
    "script-v003",
    "studio/data/production/episodes/agent-skill-20260806/script-draft-v003.json",
    10_430,
    "2b0063c3967fe5e1950cc56637d80e735c358761946c6cd0f0bdb6e9352b42ff"
  ),
  protectedFile(
    "storyboard-v003",
    "studio/data/production/episodes/agent-skill-20260806/storyboard-draft-v003.json",
    50_447,
    "5381a7176cb07118cf363a4cf6637154fa0ea978539310a1d474b085a5ed85c8"
  ),
  protectedFile(
    "voice-v001",
    "studio/public/episodes/agent-skill-20260806/voice-v001.wav",
    26_227_376,
    "643b7f68d0561e73d5f6177a4ea682c8cbe6339824b7cd5a1aa811069beaa6da"
  ),
  protectedFile(
    "v003-video",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v003/review-10m.mp4",
    29_921_407,
    "56d3be4fc048c37cc08d303b804890be15b39a2353aeef7233e6b8393a007001"
  ),
  protectedFile(
    "v003-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v003/review-manifest.json",
    21_845,
    "c5416143d4c5d27ac8ed596c9944569ad477df7daece6644ffb4f31ade5de32b"
  ),
  protectedFile(
    "v003-qa-summary",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v003/qa/qa-summary.json",
    6_900,
    "8438d6bb07e8ab0c0ac2926e7b462b4e37fcdd709c9138e0584c948b5e36046c"
  ),
  protectedFile(
    "material-v003",
    "studio/public/episodes/agent-skill-20260806/materials/material-v003.png",
    932_674,
    "8e26f3553bd1707e2bac64c7dc76058972b6139f90a8f76106f0f4f0d202a951"
  ),
  protectedFile(
    "background-comparison-v001-blurred",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/01-blurred-material.mp4",
    346_568,
    "e1eeb96f17da81427a48597baf6ff19b0a60fce9460744e697adadf6754d8b36"
  ),
  protectedFile(
    "background-comparison-v001-gradient",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/02-soft-gradient.mp4",
    345_010,
    "7e37c7a3c35999927cab9daa6474b5902e7daa288dfb3979be29f50f52c99a8b"
  ),
  protectedFile(
    "background-comparison-v001-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/comparison-manifest.json",
    12_127,
    "c6f796e914c619fb15d515f968d85d1450b3d91baabbf78b49ffa5109a94f391"
  ),
  protectedFile(
    "background-comparison-v001-blurred-media",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/qa/01-blurred-material-media.json",
    685,
    "f564ac4dd86014f91da7fc46e4893d5a47e4da85fa80cb7c12b5e9b0f3866eed"
  ),
  protectedFile(
    "background-comparison-v001-gradient-media",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/qa/02-soft-gradient-media.json",
    685,
    "be7cf0176ee2069fad3c7695f9e62b86338df37eb9654b32f83d1dccfc0f5a6a"
  ),
  protectedFile(
    "background-comparison-v001-blurred-start",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/qa/frames/01-blurred-material-start.png",
    144_771,
    "9efdba3d99a2b0957e223f4f831d01d5754d4e9929f69666d6ddc7782578076d"
  ),
  protectedFile(
    "background-comparison-v001-blurred-mid",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/qa/frames/01-blurred-material-mid.png",
    139_548,
    "161be0b68f5233757617818bf40cc74271fa4e2d5868c1d86c0736984ee30739"
  ),
  protectedFile(
    "background-comparison-v001-blurred-end",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/qa/frames/01-blurred-material-end.png",
    163_000,
    "f21c8fc5961dfda48b6f366e17d531d9ebe5ad430a7185273d165dc2d749f0ca"
  ),
  protectedFile(
    "background-comparison-v001-gradient-start",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/qa/frames/02-soft-gradient-start.png",
    153_605,
    "39da7d36ec0d106b488324304f3475c786a2712ae28953f640b2373ba931e5e9"
  ),
  protectedFile(
    "background-comparison-v001-gradient-mid",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/qa/frames/02-soft-gradient-mid.png",
    144_340,
    "5c323adda269f02eebb142f1203e17b776602af78c81e6f96143e8e5cd4290b7"
  ),
  protectedFile(
    "background-comparison-v001-gradient-end",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v001/qa/frames/02-soft-gradient-end.png",
    168_328,
    "2d84fd7a65f34924b6915a06a6e7bcac7131f6237983c05d942fde62347bdd0b"
  ),
  protectedFile(
    "background-comparison-v002-video",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v002/01-blurred-material-moving-glow.mp4",
    390_767,
    "08c3f8c4e1c19570c8ba1197c6c83437f3bb94493443b381f06cc10290cabf06"
  ),
  protectedFile(
    "background-comparison-v002-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v002/comparison-manifest.json",
    23_283,
    "e1c1d00676ad2f6b01c865731356010a3e068b87f143db41eec25f99a8d1210c"
  ),
  protectedFile(
    "background-comparison-v002-media-probe",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v002/qa/media-probe.json",
    898,
    "29587e38ee4b8c43af53f525783d76ae8674e7e7e8bd4a5a8702bd883e3c56d6"
  ),
  protectedFile(
    "background-comparison-v002-frame-000",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v002/qa/frames/frame-000.png",
    146_718,
    "a2efac4bc2270729cb36ba118c84534c70bce78fead206bee4dcbb77291e2e18"
  ),
  protectedFile(
    "background-comparison-v002-frame-045",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v002/qa/frames/frame-045.png",
    162_944,
    "fd58d0def1a209983a05b3df623619580d04d8199015ed3a0203ca77125071d9"
  ),
  protectedFile(
    "background-comparison-v002-frame-090",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v002/qa/frames/frame-090.png",
    166_159,
    "c7ad36b1288da87f468099856a241de047460f76d881c8d478fe4caf33f66f09"
  ),
  protectedFile(
    "background-comparison-v002-frame-135",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v002/qa/frames/frame-135.png",
    181_597,
    "f6c50fa7c5cc022a668f998e311b5a9f18d3809e95d907b44edc2a66212dbf7f"
  ),
  protectedFile(
    "background-comparison-v002-frame-174",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v002/qa/frames/frame-174.png",
    182_226,
    "c0ea2a2284bfae3f8b9d12f0306a26f3fa8096d2bc0a4b84e7b348ae1d6e8c9a"
  ),
  protectedFile(
    "background-comparison-v002-frame-179",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v002/qa/frames/frame-179.png",
    182_228,
    "3310dc6c256f19e67b69155e5a5293ab330e762b5b4bffc8d9300a19cb83815d"
  ),
  protectedFile(
    "background-comparison-v003-video",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v003/01-soft-gradient-moving-glow.mp4",
    393_261,
    "d679814a841e9e557d3ef6984ad8032d5c9edfad8579fb9a6c5fd522a46ab149"
  ),
  protectedFile(
    "background-comparison-v003-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v003/comparison-manifest.json",
    29_312,
    "a190d686ec4db57434f2c0a86f2e335fef80402b9bb4cc550eae0f1be2a124ce"
  ),
  protectedFile(
    "background-comparison-v003-media-probe",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v003/qa/media-probe.json",
    898,
    "5517afbe68aa507f9ae410377af8dcdd1a1162e20cb0e37063dd7ed0afcee9a2"
  ),
  protectedFile(
    "background-comparison-v003-frame-000",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v003/qa/frames/frame-000.png",
    153_936,
    "eea98f3960a155848c2cca11ffb072ebedf2c77fc235d1b5dc5d74cffa7f34f7"
  ),
  protectedFile(
    "background-comparison-v003-frame-045",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v003/qa/frames/frame-045.png",
    161_129,
    "0313e666a83ecfd62f0a7fd8033eca06abaf01681d2b09d64f6812f35c1b35ce"
  ),
  protectedFile(
    "background-comparison-v003-frame-090",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v003/qa/frames/frame-090.png",
    164_977,
    "8a65101bceefb85a5533fc6f4ec15de7ff9a722058d0db37fd3ec9f5ce790b7a"
  ),
  protectedFile(
    "background-comparison-v003-frame-135",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v003/qa/frames/frame-135.png",
    180_105,
    "d25c7b31c334b16f5037fd863ec036770dd2619b2ebe277a48d70d7122fdd28b"
  ),
  protectedFile(
    "background-comparison-v003-frame-174",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v003/qa/frames/frame-174.png",
    181_003,
    "5eb7c37c1d1ace2d2d8f218cc3e035966c1be221e9b5b29086c9c5ba66b46622"
  ),
  protectedFile(
    "background-comparison-v004-video",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v004/01-soft-gradient-moving-glow-30s.mp4",
    1_936_150,
    "25ed895077ad639c72e0193660a07432417b07359116589d0708a08925062673"
  ),
  protectedFile(
    "background-comparison-v004-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v004/comparison-manifest.json",
    35_769,
    "e417442d3a81973bf6d847a67d59b4dc5c4b7c90750d44286b0ea8a3f7b0a9c4"
  ),
  protectedFile(
    "background-comparison-v004-qa-summary",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v004/qa/qa-summary.json",
    1_543,
    "340e12510e3bd02fb6991a29e0a1ee6fb90cc44923c6e2d5e167d65525efe0ae"
  ),
  protectedFile(
    "background-comparison-v004-qa-artifacts",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v004/qa/qa-artifacts.sha256",
    2_207,
    "186918bd6945a49dece3e01536d4de606af776360eb9b4d2870f734b399b491c"
  ),
  protectedFile(
    "background-comparison-v004-seam-analysis",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v004/qa/seam-analysis.json",
    1_217,
    "1fec134a1bde2e620508fc561e9f2046af2b371ef8da42c9bea0a39126389785"
  ),
  protectedFile(
    "background-comparison-v005-video",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v005/01-soft-gradient-position-swap-30s.mp4",
    3_152_731,
    "bdba520600fc12b7af88b20774b5fcc42d336825dc8d7272fdda3788d582d269"
  ),
  protectedFile(
    "background-comparison-v005-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v005/comparison-manifest.json",
    39_692,
    "6e1cbc6e35b72db9d794755e8a9455355cffd91623da0dee795938e08d6fd637"
  ),
  protectedFile(
    "background-comparison-v005-qa-summary",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v005/qa/qa-summary.json",
    1_530,
    "ff58d855ddb69c5be51602da9e96cdde474b3d5354959117eecd0cf88c53b0c8"
  ),
  protectedFile(
    "background-comparison-v005-qa-artifacts",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v005/qa/qa-artifacts.sha256",
    6_262,
    "679ba9d43f851fb6625fb2c387a28a2894583a3aff7b2d71f568c36845ca9e2f"
  ),
  protectedFile(
    "background-comparison-v005-seam-analysis",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v005/qa/seam-analysis.json",
    1_101,
    "f307c79733ba82e8938bf0bbe2d03b0c4c8105698a2b5f713496824ec41a93b9"
  ),
  protectedFile(
    "background-comparison-v005-visual-review",
    "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v005/qa/visual-review.json",
    760,
    "8681c07b03a87de69be1ac134b0143c687e0107526bd65d75f2e2ea275e358b1"
  )
]);

const REVIEW_INPUT_PATHS = Object.freeze([
  ENTRY_POINT,
  resolve(videoRoot, "agent-skill-long-review-root.jsx"),
  resolve(videoRoot, "agent-skill-long-backgrounds.jsx"),
  resolve(videoRoot, "agent-skill-long-background-motion.mjs"),
  resolve(videoRoot, "agent-skill-long-background-comparison-plan.mjs"),
  resolve(videoRoot, "agent-skill-long-review.jsx"),
  resolve(videoRoot, "agent-skill-long-review-plan.mjs"),
  resolve(videoRoot, "components", "chrome.jsx"),
  resolve(videoRoot, "text-layout.mjs")
]);

const FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT = Object.freeze([
  resolve(studioOutputRoot, BACKGROUND_COMPARISON_RENDER_CONTRACT.episodeId, "preview-v006.mp4"),
  resolve(studioOutputRoot, BACKGROUND_COMPARISON_RENDER_CONTRACT.episodeId, "preview-v006.rendering.mp4"),
  resolve(studioOutputRoot, BACKGROUND_COMPARISON_RENDER_CONTRACT.episodeId, "preview-qa-v006.json")
]);

function workspaceRelative(filePath) {
  return relative(workspaceRoot, filePath).replaceAll("\\", "/");
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
  if (await pathExists(filePath)) throw new Error(`${label} 已存在；拒绝覆盖`);
}

async function snapshotFile(filePath, expected = null) {
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
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(`文件在快照期间变化：${workspaceRelative(filePath)}`);
  }
  if (expected && (integrity.bytes !== expected.bytes || integrity.sha256 !== expected.sha256)) {
    throw new Error(`${expected.id} 与受保护基线不一致`);
  }
  return {
    path: workspaceRelative(filePath),
    bytes: integrity.bytes,
    sha256: integrity.sha256,
    dev: after.dev,
    ino: after.ino,
    mtimeMs: after.mtimeMs
  };
}

async function captureProtectedBaselines() {
  return Object.fromEntries(await Promise.all(PROTECTED_BASELINES.map(async (expected) => [
    expected.id,
    await snapshotFile(expected.path, expected)
  ])));
}

async function captureReviewInputs() {
  return Object.fromEntries(await Promise.all(REVIEW_INPUT_PATHS.map(async (filePath) => [
    workspaceRelative(filePath),
    await snapshotFile(filePath)
  ])));
}

function assertSnapshotsEqual(label, before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`${label} 在渲染期间变化`);
  }
}

async function assertFormalOutputsStillAbsent() {
  for (const filePath of FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT) {
    await assertAbsent(filePath, `正式产物 ${workspaceRelative(filePath)}`);
  }
}

function denyBrowserDownload() {
  throw new Error("禁止下载 Chrome/Chromium；必须使用已安装的本机 Chrome");
}

function localOnlyAssetDownloadTracker(downloads) {
  return (src) => {
    const url = new URL(src);
    if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname)) {
      throw new Error(`背景对照渲染尝试访问外部媒体：${src}`);
    }
    downloads.add(src);
  };
}

function assertComposition(candidate, composition) {
  const contract = BACKGROUND_COMPARISON_RENDER_CONTRACT;
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
    durationInFrames: contract.sourceDurationInFrames
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`背景对照 Composition 不符合合同：${JSON.stringify(actual)}`);
  }
}

function assertMedia(metadata, integrity) {
  const contract = BACKGROUND_COMPARISON_RENDER_CONTRACT;
  const findings = [
    [metadata.width === contract.width, `width=${metadata.width}`],
    [metadata.height === contract.height, `height=${metadata.height}`],
    [Math.abs(metadata.fps - contract.fps) < 0.1, `fps=${metadata.fps}`],
    [Math.abs(metadata.durationInSeconds - contract.durationSeconds) < 0.2, `duration=${metadata.durationInSeconds}`],
    [metadata.codec === contract.codec, `codec=${metadata.codec}`],
    [metadata.audioCodec === contract.audioCodec, `audioCodec=${metadata.audioCodec}`],
    [metadata.pixelFormat === contract.pixelFormat, `pixelFormat=${metadata.pixelFormat}`],
    [metadata.canPlayInVideoTag === true, `canPlay=${metadata.canPlayInVideoTag}`],
    [metadata.supportsSeeking === true, `seek=${metadata.supportsSeeking}`],
    [integrity.bytes > 50_000, `bytes=${integrity.bytes}`]
  ].filter(([passed]) => !passed).map(([, finding]) => finding);
  if (findings.length > 0) throw new Error(`背景对照媒体合同未通过：${findings.join(", ")}`);
}

export async function renderAgentSkillLongBackgroundComparison() {
  const contract = BACKGROUND_COMPARISON_RENDER_CONTRACT;
  await access(CHROME_EXECUTABLE, fsConstants.R_OK | fsConstants.X_OK);
  await assertAbsent(CANDIDATE_DIRECTORY, `背景对照目录 ${workspaceRelative(CANDIDATE_DIRECTORY)}`);
  await assertFormalOutputsStillAbsent();
  const protectedBefore = await captureProtectedBaselines();
  const inputsBefore = await captureReviewInputs();
  const episode = JSON.parse(await readFile(EPISODE_PATH, "utf8"));
  if (!validateAgentSkillLongReviewEpisode(episode)) throw new Error("Episode 不符合 10 分钟长片合同");

  await mkdir(resolve(CANDIDATE_DIRECTORY, ".."), { recursive: true });
  await mkdir(CANDIDATE_DIRECTORY, { recursive: false });
  const localAssetDownloads = new Set();

  try {
    const serveUrl = await bundle({
      entryPoint: ENTRY_POINT,
      publicDir: publicRoot,
      onProgress: () => undefined
    });
    const results = [];
    for (const candidate of [AGENT_SKILL_LONG_BACKGROUND_SELECTED_CANDIDATE]) {
      const inputProps = {
        episode: structuredClone(episode),
        backgroundVariant: candidate.variant,
        backgroundMaterial: null,
        backgroundFrameOffset: contract.startFrame
      };
      const composition = await selectComposition({
        serveUrl,
        id: contract.compositionId,
        inputProps,
        browserExecutable: CHROME_EXECUTABLE,
        onBrowserDownload: denyBrowserDownload,
        logLevel: "warn"
      });
      assertComposition(candidate, composition);
      const temporaryPath = resolve(
        CANDIDATE_DIRECTORY,
        candidate.outputFileName.replace(/\.mp4$/u, ".rendering.mp4")
      );
      const outputPath = resolve(CANDIDATE_DIRECTORY, candidate.outputFileName);
      await assertAbsent(temporaryPath);
      await assertAbsent(outputPath);
      await renderMedia({
        composition,
        serveUrl,
        inputProps,
        outputLocation: temporaryPath,
        browserExecutable: CHROME_EXECUTABLE,
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
        frameRange: [
          contract.startFrame,
          contract.startFrame + contract.durationInFrames - 1
        ],
        logLevel: "warn"
      });
      const [metadata, stagedIntegrity] = await Promise.all([
        getVideoMetadata(temporaryPath, { logLevel: "error" }),
        inspectFileIntegrity(temporaryPath)
      ]);
      assertMedia(metadata, stagedIntegrity);
      await rename(temporaryPath, outputPath);
      const finalIntegrity = await inspectFileIntegrity(outputPath);
      if (
        stagedIntegrity.bytes !== finalIntegrity.bytes ||
        stagedIntegrity.sha256 !== finalIntegrity.sha256
      ) throw new Error(`${candidate.id} 原子重命名后摘要变化`);
      results.push({
        id: candidate.id,
        variant: candidate.variant,
        label: candidate.label,
        outputPath: workspaceRelative(outputPath),
        bytes: finalIntegrity.bytes,
        sha256: finalIntegrity.sha256,
        metadata: {
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          durationSeconds: metadata.durationInSeconds,
          codec: metadata.codec,
          audioCodec: metadata.audioCodec,
          pixelFormat: metadata.pixelFormat
        }
      });
    }

    const protectedAfter = await captureProtectedBaselines();
    const inputsAfter = await captureReviewInputs();
    assertSnapshotsEqual("受保护正式/历史产物", protectedBefore, protectedAfter);
    assertSnapshotsEqual("背景对照渲染输入", inputsBefore, inputsAfter);
    await assertFormalOutputsStillAbsent();

    const manifestPath = resolve(CANDIDATE_DIRECTORY, "comparison-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: "agent-skill-long-background-comparison-v6",
      kind: "unregistered-selected-background-30s-edge-swap-preview",
      registered: false,
      episodeId: contract.episodeId,
      sceneId: "S10",
      exactSourceWindow: {
        startFrame: contract.startFrame,
        endFrameExclusive: contract.startFrame + contract.durationInFrames,
        startSecond: contract.startSecond,
        durationSeconds: contract.durationSeconds
      },
      controlledVariable:
        "frame-driven three-color edge-anchor swap and 85%-115% scale cycle; no raster material",
      candidates: results,
      selectedDirection: {
        variant: "soft-gradient-moving",
        materialUsed: false,
        motionPolicy: AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY,
        loopPreview: {
          durationSeconds: contract.durationSeconds,
          durationInFrames: contract.durationInFrames,
          cycleSeconds: AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.cycleSeconds,
          cycleFrames: AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.cycleFrames,
          firstCycleStartSourceFrame: contract.startFrame,
          secondCycleStartSourceFrame:
            contract.startFrame + AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.cycleFrames,
          backgroundFrameOffset: contract.startFrame,
          firstCycleStartMotionFrame: 0,
          secondCycleStartMotionFrame:
            AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.cycleFrames,
          phaseAtFirstAndSecondCycleStartIdentical: true,
          secondCycleVisibleSeconds:
            contract.durationSeconds - AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.cycleSeconds
        },
        formalTenMinuteRenderUpdated: false
      },
      material: null,
      calls: {
        externalApiCalls: 0,
        paidApiCalls: 0,
        generatedImageCalls: 0,
        generatedVideoCalls: 0,
        browserDownloads: 0,
        localMediaDownloads: [...localAssetDownloads].sort()
      },
      voice: {
        mode: "temporary-local-system-voice",
        finalApproved: false
      },
      approvalBoundary: {
        mutatesEpisode: false,
        mutatesPipeline: false,
        mutatesApproval: false,
        runsFormalAgent: false,
        runsFormalQa: false,
        authorizesPublication: false
      },
      protectedBaselines: { before: protectedBefore, after: protectedAfter, unchanged: true },
      reviewInputs: { before: inputsBefore, after: inputsAfter, unchanged: true }
    }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

    return { directory: CANDIDATE_DIRECTORY, manifestPath, results };
  } catch (error) {
    await rm(CANDIDATE_DIRECTORY, { recursive: true, force: true });
    throw error;
  }
}

const isEntrypoint = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isEntrypoint) {
  renderAgentSkillLongBackgroundComparison()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
