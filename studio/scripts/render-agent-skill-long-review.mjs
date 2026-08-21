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

export const REVIEW_RENDER_CONTRACT = Object.freeze({
  episodeId: "agent-skill-20260806",
  compositionId: "AgentSkillLongReview",
  width: 540,
  height: 960,
  fps: 30,
  durationSeconds: 600,
  durationInFrames: 18_000,
  codec: "h264",
  audioCodec: "aac",
  pixelFormat: "yuv420p",
  crf: 22,
  concurrency: "25%",
  sampleRate: 48_000,
  candidateDirectoryName: "full-video-current-visual-upgrade-v003",
  outputFileName: "review-10m.mp4",
  temporaryOutputFileName: "review-10m.rendering.mp4",
  manifestFileName: "review-manifest.json",
  temporaryManifestFileName: "review-manifest.rendering.json"
});

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PREVIOUS_CANDIDATE_DIRECTORY_NAME = "full-video-current-visual-upgrade-v002";
const PREVIOUS_REVIEW_SOURCE_HASHES = Object.freeze({
  "studio/src/video/agent-skill-long-review.jsx":
    "ecf6308c261b359a3756f9d68714a03bf52aacdca01237ee83a17e091b993672",
  "studio/src/video/agent-skill-long-review-plan.mjs":
    "cac78395f323956107392d749c126b1031c88768673c3f29ba27a182d64f4249"
});
const REVIEW_ENTRY_POINT = resolve(videoRoot, "agent-skill-long-review-index.jsx");
const EPISODE_OUTPUT_ROOT = ensureInside(
  studioOutputRoot,
  resolve(studioOutputRoot, REVIEW_RENDER_CONTRACT.episodeId)
);
const REVIEW_CANDIDATES_ROOT = ensureInside(
  EPISODE_OUTPUT_ROOT,
  resolve(EPISODE_OUTPUT_ROOT, "review-candidates")
);
const CANDIDATE_DIRECTORY = ensureInside(
  REVIEW_CANDIDATES_ROOT,
  resolve(REVIEW_CANDIDATES_ROOT, REVIEW_RENDER_CONTRACT.candidateDirectoryName)
);

const protectedFile = (id, path, bytes, sha256) => Object.freeze({
  id,
  path: ensureInside(workspaceRoot, resolve(workspaceRoot, path)),
  bytes,
  sha256
});

export const PROTECTED_BASELINES = Object.freeze([
  protectedFile(
    "episode",
    "studio/data/episodes/agent-skill-20260806/episode.json",
    426_756,
    "beab25b1bf1515616bf42baea48d376ba78d26e009841124c5faf997a0f86d4b"
  ),
  protectedFile(
    "preview-v005",
    "outputs/studio/agent-skill-20260806/preview-v005.mp4",
    27_970_244,
    "16c098964d8e99ce68ba9e930583fa981ff31095cfa29088b9f0c5feb10789c1"
  ),
  protectedFile(
    "preview-qa-v005",
    "outputs/studio/agent-skill-20260806/preview-qa-v005.json",
    18_403,
    "fcdc5a1f0c59cfb676b2bcd0c4f6a60490dead5683fb0293a54318f292cf698c"
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
    "unregistered-review-v001-video",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v001/review-10m.mp4",
    31_279_449,
    "ffc4f8ec057f95f8b28002cf9fd76f8382b2a38f17e4e6f7b0f4e7b814abbba5"
  ),
  protectedFile(
    "unregistered-review-v001-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v001/review-manifest.json",
    15_888,
    "f66d9e46447fc085fa8e34189544c15d6e3ca648599e214a4b9626b78fecccf7"
  ),
  protectedFile(
    "unregistered-review-v001-qa-summary",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v001/qa/qa-summary.json",
    2_372,
    "66fbd426d8b52ca8c242a8c2b38288b5a2df04951fe2c7c16879c00cad23517c"
  ),
  protectedFile(
    "unregistered-review-v002-video",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v002/review-10m.mp4",
    29_925_030,
    "75df865cfd80309d4d063b1efa47ac5b17ff77e29fba0e14ac0c2958604a773a"
  ),
  protectedFile(
    "unregistered-review-v002-manifest",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v002/review-manifest.json",
    19_327,
    "cee09fab00789aa7de0b323dc55e9ea6b2ee74f959863e91fae42f428296557e"
  ),
  protectedFile(
    "unregistered-review-v002-qa-summary",
    "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v002/qa/qa-summary.json",
    5_084,
    "04d13c86b1510ccb0af5c75d37230b7323177ec86a4bfbb8d80ebe9140e9d51c"
  )
]);

const REVIEW_INPUT_PATHS = Object.freeze([
  REVIEW_ENTRY_POINT,
  resolve(videoRoot, "agent-skill-long-review-root.jsx"),
  resolve(videoRoot, "agent-skill-long-review.jsx"),
  resolve(videoRoot, "agent-skill-long-review-plan.mjs"),
  resolve(videoRoot, "components", "chrome.jsx"),
  resolve(videoRoot, "text-layout.mjs"),
  resolve(studioRoot, "src", "shared", "technical-diagram-contract.mjs"),
  ...[1, 2, 3, 4, 5].map((version) => resolve(
    publicRoot,
    "episodes",
    REVIEW_RENDER_CONTRACT.episodeId,
    "materials",
    `material-v${String(version).padStart(3, "0")}.png`
  ))
]);

const FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT = Object.freeze([
  resolve(EPISODE_OUTPUT_ROOT, "preview-v006.mp4"),
  resolve(EPISODE_OUTPUT_ROOT, "preview-v006.rendering.mp4"),
  resolve(EPISODE_OUTPUT_ROOT, "preview-qa-v006.json")
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
  if (await pathExists(filePath)) throw new Error(`${label} 已存在；为避免覆盖，审阅渲染已停止`);
}

async function snapshotFile(filePath, options = {}) {
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`只允许读取普通文件：${workspaceRelative(filePath)}`);
  }
  const integrity = await inspectFileIntegrity(filePath);
  const stat = await lstat(filePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    before.dev !== stat.dev ||
    before.ino !== stat.ino ||
    before.size !== stat.size ||
    before.mtimeMs !== stat.mtimeMs ||
    before.ctimeMs !== stat.ctimeMs
  ) {
    throw new Error(`文件在快照期间发生变化：${workspaceRelative(filePath)}`);
  }
  const snapshot = {
    path: workspaceRelative(filePath),
    bytes: integrity.bytes,
    sha256: integrity.sha256,
    dev: stat.dev,
    ino: stat.ino,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs
  };
  if (options.expected) {
    if (
      snapshot.bytes !== options.expected.bytes ||
      snapshot.sha256 !== options.expected.sha256
    ) {
      throw new Error(
        `${options.expected.id} 与受保护基线不一致：` +
        `${snapshot.bytes} bytes / ${snapshot.sha256}`
      );
    }
  }
  return snapshot;
}

export async function captureProtectedBaselines() {
  const entries = await Promise.all(PROTECTED_BASELINES.map(async (expected) => [
    expected.id,
    await snapshotFile(expected.path, { expected })
  ]));
  return Object.fromEntries(entries);
}

export async function captureReviewInputs() {
  const entries = await Promise.all(REVIEW_INPUT_PATHS.map(async (filePath) => [
    workspaceRelative(filePath),
    await snapshotFile(filePath)
  ]));
  return Object.fromEntries(entries);
}

export function assertV3ReviewInputsChanged(reviewInputs) {
  const sourcePaths = Object.keys(PREVIOUS_REVIEW_SOURCE_HASHES);
  const missingPaths = sourcePaths.filter((sourcePath) => {
    const sha256 = reviewInputs?.[sourcePath]?.sha256;
    return typeof sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sha256);
  });
  if (missingPaths.length > 0) {
    throw new Error(`无法验证 v002 审阅源文件：${missingPaths.join(", ")}`);
  }

  const unchangedPaths = sourcePaths.filter(
    (sourcePath) => reviewInputs[sourcePath].sha256 === PREVIOUS_REVIEW_SOURCE_HASHES[sourcePath]
  );
  if (unchangedPaths.length === sourcePaths.length) {
    throw new Error("v003 的 plan 与 component 仍同时等于 v002；拒绝只更换候选目录名");
  }
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

export function assertSnapshotsUnchanged(label, before, after) {
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

function assertEpisodeContract(episode) {
  const contract = REVIEW_RENDER_CONTRACT;
  if (episode?.id !== contract.episodeId) throw new Error("Episode ID 与审阅合同不一致");
  if (!Array.isArray(episode.scenes) || episode.scenes.length !== 18) {
    throw new Error("10 分钟审阅输入必须包含 18 个正式场景");
  }
  if (episode.scenes[0]?.start !== 0 || episode.scenes.at(-1)?.end !== 600) {
    throw new Error("正式场景没有连续覆盖 0–600 秒");
  }
  if (!Array.isArray(episode.subtitles) || episode.subtitles.length !== 107) {
    throw new Error("10 分钟审阅输入必须包含 107 条正式字幕");
  }
  if (
    episode.render?.version !== 5 ||
    episode.render?.outputPath !== "outputs/studio/agent-skill-20260806/preview-v005.mp4" ||
    episode.render?.sha256 !== PROTECTED_BASELINES.find((item) => item.id === "preview-v005")?.sha256
  ) {
    throw new Error("Episode 当前渲染记录不再精确绑定受保护的 preview-v005");
  }
  if (
    episode.voice?.publicPath !== "episodes/agent-skill-20260806/voice-v001.wav" ||
    episode.voice?.durationSeconds !== 594.632 ||
    episode.voice?.sha256 !== PROTECTED_BASELINES.find((item) => item.id === "temporary-system-voice-v001")?.sha256
  ) {
    throw new Error("临时系统旁白不再精确绑定受保护的 voice-v001.wav");
  }
  if (episode.approvals?.final?.status !== "pending" || episode.approvals?.final?.currentVersion !== 5) {
    throw new Error("正式 Final Gate 状态已变化；审阅渲染拒绝继续");
  }
}

export function assertReviewComposition(composition) {
  const contract = REVIEW_RENDER_CONTRACT;
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
    throw new Error(`审阅 Composition 不符合固定合同：${JSON.stringify(actual)}`);
  }
}

export function assertReviewMedia(metadata, integrity) {
  const contract = REVIEW_RENDER_CONTRACT;
  const failures = [
    [metadata.width === contract.width, `width=${metadata.width}`],
    [metadata.height === contract.height, `height=${metadata.height}`],
    [Math.abs(metadata.fps - contract.fps) < 0.1, `fps=${metadata.fps}`],
    [Math.abs(metadata.durationInSeconds - contract.durationSeconds) < 0.35, `duration=${metadata.durationInSeconds}`],
    [metadata.codec === contract.codec, `codec=${metadata.codec}`],
    [metadata.audioCodec === contract.audioCodec, `audioCodec=${metadata.audioCodec}`],
    [metadata.pixelFormat === contract.pixelFormat, `pixelFormat=${metadata.pixelFormat}`],
    [metadata.canPlayInVideoTag === true, `canPlayInVideoTag=${metadata.canPlayInVideoTag}`],
    [metadata.supportsSeeking === true, `supportsSeeking=${metadata.supportsSeeking}`],
    [Number.isSafeInteger(integrity.bytes) && integrity.bytes > 50_000, `bytes=${integrity.bytes}`],
    [/^[a-f0-9]{64}$/u.test(integrity.sha256), `sha256=${integrity.sha256}`]
  ].filter(([passed]) => !passed).map(([, finding]) => finding);
  if (failures.length > 0) {
    throw new Error(`审阅视频媒体合同未通过：${failures.join(", ")}`);
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
  await assertAbsent(CANDIDATE_DIRECTORY, `审阅候选目录 ${workspaceRelative(CANDIDATE_DIRECTORY)}`);
  await mkdir(REVIEW_CANDIDATES_ROOT, { recursive: true });
  const rootStat = await lstat(REVIEW_CANDIDATES_ROOT);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("review-candidates 必须是普通目录，不能是符号链接");
  }
  await mkdir(CANDIDATE_DIRECTORY, { recursive: false });
}

async function removeIncompleteCandidate() {
  const expected = resolve(
    REVIEW_CANDIDATES_ROOT,
    REVIEW_RENDER_CONTRACT.candidateDirectoryName
  );
  if (CANDIDATE_DIRECTORY !== expected) throw new Error("拒绝清理未验证的候选路径");
  await rm(CANDIDATE_DIRECTORY, { recursive: true, force: true });
}

export async function renderAgentSkillLongReview() {
  const contract = REVIEW_RENDER_CONTRACT;
  const startedAt = new Date().toISOString();
  const temporaryOutputPath = resolve(CANDIDATE_DIRECTORY, contract.temporaryOutputFileName);
  const outputPath = resolve(CANDIDATE_DIRECTORY, contract.outputFileName);
  const temporaryManifestPath = resolve(CANDIDATE_DIRECTORY, contract.temporaryManifestFileName);
  const manifestPath = resolve(CANDIDATE_DIRECTORY, contract.manifestFileName);
  let candidateDirectoryCreated = false;

  await access(CHROME_EXECUTABLE, fsConstants.R_OK | fsConstants.X_OK);
  await assertFormalOutputsStillAbsent();
  const protectedBefore = await captureProtectedBaselines();
  const reviewInputsBefore = await captureReviewInputs();
  assertV3ReviewInputsChanged(reviewInputsBefore);
  const episode = JSON.parse(await readFile(PROTECTED_BASELINES[0].path, "utf8"));
  assertEpisodeContract(episode);

  try {
    await ensureCandidateDirectory();
    candidateDirectoryCreated = true;
    for (const filePath of [temporaryOutputPath, outputPath, temporaryManifestPath, manifestPath]) {
      await assertAbsent(filePath);
    }

    const serveUrl = await bundle({
      entryPoint: REVIEW_ENTRY_POINT,
      publicDir: publicRoot,
      onProgress: () => undefined
    });
    const inputProps = { episode: structuredClone(episode) };
    const composition = await selectComposition({
      serveUrl,
      id: contract.compositionId,
      inputProps,
      browserExecutable: CHROME_EXECUTABLE,
      onBrowserDownload: denyBrowserDownload,
      logLevel: "warn"
    });
    assertReviewComposition(composition);

    const localAssetDownloads = new Set();
    let lastReportedPercent = -5;
    await renderMedia({
      composition,
      serveUrl,
      outputLocation: temporaryOutputPath,
      inputProps,
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
      logLevel: "warn",
      onProgress: ({ progress }) => {
        const percent = Math.floor(progress * 100);
        if (percent >= lastReportedPercent + 5) {
          lastReportedPercent = percent;
          console.log(`未登记 10 分钟审阅版：${percent}%`);
        }
      }
    });

    const [metadata, stagedIntegrity] = await Promise.all([
      getVideoMetadata(temporaryOutputPath, { logLevel: "warn" }),
      inspectFileIntegrity(temporaryOutputPath)
    ]);
    assertReviewMedia(metadata, stagedIntegrity);

    const protectedAfterRender = await captureProtectedBaselines();
    const reviewInputsAfterRender = await captureReviewInputs();
    assertSnapshotsUnchanged("受保护正式产物", protectedBefore, protectedAfterRender);
    assertSnapshotsUnchanged("审阅渲染输入", reviewInputsBefore, reviewInputsAfterRender);
    await assertFormalOutputsStillAbsent();

    await rename(temporaryOutputPath, outputPath);
    const finalIntegrity = await inspectFileIntegrity(outputPath);
    if (
      finalIntegrity.bytes !== stagedIntegrity.bytes ||
      finalIntegrity.sha256 !== stagedIntegrity.sha256
    ) {
      throw new Error("原子重命名后审阅视频摘要发生变化");
    }

    const protectedAfter = await captureProtectedBaselines();
    const reviewInputsAfter = await captureReviewInputs();
    assertSnapshotsUnchanged("受保护正式产物", protectedBefore, protectedAfter);
    assertSnapshotsUnchanged("审阅渲染输入", reviewInputsBefore, reviewInputsAfter);
    await assertFormalOutputsStillAbsent();

    const manifest = {
      schemaVersion: "agent-skill-unregistered-long-review-v1",
      kind: "unregistered-review-candidate",
      registered: false,
      episodeId: contract.episodeId,
      compositionId: contract.compositionId,
      candidateVersion: 3,
      supersedes: {
        candidateVersion: 2,
        candidateDirectoryName: PREVIOUS_CANDIDATE_DIRECTORY_NAME,
        video: {
          path: protectedBefore["unregistered-review-v002-video"].path,
          bytes: protectedBefore["unregistered-review-v002-video"].bytes,
          sha256: protectedBefore["unregistered-review-v002-video"].sha256
        },
        manifest: {
          path: protectedBefore["unregistered-review-v002-manifest"].path,
          bytes: protectedBefore["unregistered-review-v002-manifest"].bytes,
          sha256: protectedBefore["unregistered-review-v002-manifest"].sha256
        },
        qaSummary: {
          path: protectedBefore["unregistered-review-v002-qa-summary"].path,
          bytes: protectedBefore["unregistered-review-v002-qa-summary"].bytes,
          sha256: protectedBefore["unregistered-review-v002-qa-summary"].sha256
        }
      },
      createdAt: new Date().toISOString(),
      startedAt,
      disclaimer: "本片使用 macOS Tingting 临时系统旁白，仅用于检查节奏与音画同步；它不是真人录音，也不是最终声音批准。",
      approvalBoundary: {
        mutatesEpisode: false,
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
        sampleRate: contract.sampleRate,
        canPlayInVideoTag: metadata.canPlayInVideoTag,
        supportsSeeking: metadata.supportsSeeking,
        bytes: finalIntegrity.bytes,
        sha256: finalIntegrity.sha256
      },
      environment: {
        browserExecutable: CHROME_EXECUTABLE,
        browserDownloadAllowed: false,
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
    await rename(temporaryManifestPath, manifestPath);

    const protectedFinal = await captureProtectedBaselines();
    const reviewInputsFinal = await captureReviewInputs();
    assertSnapshotsUnchanged("受保护正式产物", protectedBefore, protectedFinal);
    assertSnapshotsUnchanged("审阅渲染输入", reviewInputsBefore, reviewInputsFinal);
    await assertFormalOutputsStillAbsent();

    return {
      outputPath,
      manifestPath,
      bytes: finalIntegrity.bytes,
      sha256: finalIntegrity.sha256,
      metadata
    };
  } catch (error) {
    if (candidateDirectoryCreated) await removeIncompleteCandidate();
    throw error;
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  renderAgentSkillLongReview()
    .then((result) => {
      console.log(JSON.stringify({
        ok: true,
        registered: false,
        outputPath: workspaceRelative(result.outputPath),
        manifestPath: workspaceRelative(result.manifestPath),
        bytes: result.bytes,
        sha256: result.sha256,
        metadata: result.metadata
      }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
