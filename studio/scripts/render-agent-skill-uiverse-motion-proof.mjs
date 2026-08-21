import { access, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import { getVideoMetadata, renderMedia, selectComposition } from "@remotion/renderer";

import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import {
  ensureInside,
  publicRoot,
  studioOutputRoot,
  videoRoot,
  workspaceRoot
} from "../src/shared/paths.mjs";
import { AGENT_SKILL_UIVERSE_MOTION_PROOF } from "../src/video/agent-skill-uiverse-motion-proof-plan.mjs";

export const UIIVERSE_MOTION_PROOF_RENDER_CONTRACT = Object.freeze({
  schemaVersion: "agent-skill-uiverse-motion-proof-render-v1",
  candidateDirectoryName: "uiverse-light-depth-motion-proof-v003",
  outputFileName: "uiverse-light-depth-motion-proof-8s.mp4",
  compositionId: AGENT_SKILL_UIVERSE_MOTION_PROOF.compositionId,
  width: AGENT_SKILL_UIVERSE_MOTION_PROOF.width,
  height: AGENT_SKILL_UIVERSE_MOTION_PROOF.height,
  fps: AGENT_SKILL_UIVERSE_MOTION_PROOF.fps,
  durationSeconds: AGENT_SKILL_UIVERSE_MOTION_PROOF.durationSeconds,
  durationInFrames: AGENT_SKILL_UIVERSE_MOTION_PROOF.durationInFrames,
  codec: "h264",
  pixelFormat: "yuv420p",
  crf: 18,
  concurrency: "25%",
  audioTrack: false
});

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ENTRY_POINT = resolve(videoRoot, "agent-skill-uiverse-motion-proof-index.jsx");
const CANDIDATE_PARENT = ensureInside(
  studioOutputRoot,
  resolve(studioOutputRoot, "design-system", "review-candidates")
);
const CANDIDATE_DIRECTORY = ensureInside(
  CANDIDATE_PARENT,
  resolve(CANDIDATE_PARENT, UIIVERSE_MOTION_PROOF_RENDER_CONTRACT.candidateDirectoryName)
);

const PROTECTED_PATHS = Object.freeze([
  "studio/data/episodes/agent-skill-20260806/episode.json",
  "outputs/studio/agent-skill-20260806/preview-v005.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v005.json",
  "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v003/review-10m.mp4",
  "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v006/01-soft-gradient-edge-swap-30s.mp4",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v001/uiverse-light-depth-motion-proof-8s.mp4",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v001/review-manifest.json",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v002/uiverse-light-depth-motion-proof-8s.mp4",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v002/review-manifest.json",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v002/qa/qa-summary.json"
]);

const SOURCE_PATHS = Object.freeze([
  "studio/src/video/agent-skill-uiverse-motion-proof-plan.mjs",
  "studio/src/video/agent-skill-uiverse-motion-proof.jsx",
  "studio/src/video/agent-skill-uiverse-motion-proof-root.jsx",
  "studio/src/video/agent-skill-uiverse-motion-proof-index.jsx",
  "studio/scripts/render-agent-skill-uiverse-motion-proof.mjs"
]);

const FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT = Object.freeze([
  "outputs/studio/agent-skill-20260806/preview-v006.mp4",
  "outputs/studio/agent-skill-20260806/preview-v006.rendering.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v006.json"
]);

function workspacePath(relativePath) {
  return ensureInside(workspaceRoot, resolve(workspaceRoot, relativePath));
}

async function assertAbsent(filePath, label = filePath) {
  try {
    await access(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`目标必须不存在，拒绝覆盖：${label}`);
}

async function snapshot(relativePath) {
  const absolutePath = workspacePath(relativePath);
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`只允许保护普通文件：${relativePath}`);
  }
  const integrity = await inspectFileIntegrity(absolutePath);
  const after = await lstat(absolutePath);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(`文件在快照期间变化：${relativePath}`);
  }
  return Object.freeze({
    path: relativePath,
    bytes: integrity.bytes,
    sha256: integrity.sha256,
    dev: after.dev,
    ino: after.ino,
    mtimeMs: after.mtimeMs
  });
}

async function capture(paths) {
  const entries = await Promise.all(paths.map(async (relativePath) => [relativePath, await snapshot(relativePath)]));
  return Object.fromEntries(entries);
}

function assertSameSnapshots(label, before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`${label} 在样片渲染期间发生变化`);
  }
}

async function assertFormalOutputsAbsent() {
  for (const relativePath of FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT) {
    await assertAbsent(workspacePath(relativePath), relativePath);
  }
}

function assertComposition(composition) {
  const contract = UIIVERSE_MOTION_PROOF_RENDER_CONTRACT;
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
    throw new Error(`Composition 合同不匹配：${JSON.stringify(actual)}`);
  }
}

function assertMedia(metadata, integrity) {
  const contract = UIIVERSE_MOTION_PROOF_RENDER_CONTRACT;
  if (
    metadata.width !== contract.width ||
    metadata.height !== contract.height ||
    metadata.fps !== contract.fps ||
    Math.abs(metadata.durationInSeconds - contract.durationSeconds) > 1 / contract.fps ||
    metadata.codec !== contract.codec ||
    metadata.pixelFormat !== contract.pixelFormat ||
    metadata.audioCodec != null ||
    integrity.bytes < 50_000
  ) {
    throw new Error(`样片媒体合同不匹配：${JSON.stringify({ metadata, integrity })}`);
  }
}

function denyBrowserDownload() {
  throw new Error("禁止下载浏览器；只允许使用已安装 Chrome");
}

export async function renderAgentSkillUiverseMotionProof() {
  const contract = UIIVERSE_MOTION_PROOF_RENDER_CONTRACT;
  const outputPath = resolve(CANDIDATE_DIRECTORY, contract.outputFileName);
  const temporaryOutputPath = resolve(CANDIDATE_DIRECTORY, `${contract.outputFileName}.rendering.mp4`);
  const manifestPath = resolve(CANDIDATE_DIRECTORY, "review-manifest.json");
  const bundleDirectory = resolve(CANDIDATE_DIRECTORY, "bundle");
  let candidateCreated = false;

  await assertAbsent(CANDIDATE_DIRECTORY, contract.candidateDirectoryName);
  await assertFormalOutputsAbsent();
  const [protectedBefore, sourceBefore] = await Promise.all([
    capture(PROTECTED_PATHS),
    capture(SOURCE_PATHS)
  ]);

  try {
    await mkdir(CANDIDATE_PARENT, { recursive: true });
    await mkdir(CANDIDATE_DIRECTORY);
    candidateCreated = true;

    const serveUrl = await bundle({
      entryPoint: ENTRY_POINT,
      publicDir: publicRoot,
      outDir: bundleDirectory,
      enableCaching: false,
      onProgress: () => undefined
    });
    const composition = await selectComposition({
      serveUrl,
      id: contract.compositionId,
      browserExecutable: CHROME_EXECUTABLE,
      onBrowserDownload: denyBrowserDownload,
      logLevel: "warn"
    });
    assertComposition(composition);

    await renderMedia({
      composition,
      serveUrl,
      outputLocation: temporaryOutputPath,
      browserExecutable: CHROME_EXECUTABLE,
      onBrowserDownload: denyBrowserDownload,
      codec: contract.codec,
      pixelFormat: contract.pixelFormat,
      crf: contract.crf,
      concurrency: contract.concurrency,
      imageFormat: "png",
      muted: true,
      overwrite: false,
      logLevel: "warn"
    });

    await rm(bundleDirectory, { recursive: true, force: true });
    const [metadata, stagedIntegrity] = await Promise.all([
      getVideoMetadata(temporaryOutputPath, { logLevel: "error" }),
      inspectFileIntegrity(temporaryOutputPath)
    ]);
    assertMedia(metadata, stagedIntegrity);

    const [protectedAfterRender, sourceAfterRender] = await Promise.all([
      capture(PROTECTED_PATHS),
      capture(SOURCE_PATHS)
    ]);
    assertSameSnapshots("正式产物", protectedBefore, protectedAfterRender);
    assertSameSnapshots("样片源码", sourceBefore, sourceAfterRender);
    await assertFormalOutputsAbsent();

    await rename(temporaryOutputPath, outputPath);
    const finalIntegrity = await inspectFileIntegrity(outputPath);
    if (JSON.stringify(finalIntegrity) !== JSON.stringify(stagedIntegrity)) {
      throw new Error("样片原子改名后完整性变化");
    }

    const manifest = {
      schemaVersion: "agent-skill-uiverse-motion-proof-manifest-v1",
      candidateVersion: 3,
      registered: false,
      formalRenderOrQaUpdated: false,
      createdAt: new Date().toISOString(),
      reference: {
        source: "Uiverse Battery Widget text entrance rhythm only",
        adaptation: "Battery reference is limited to subtle text entrance; component geometry, outlines, progress structures and connectors are independently designed",
        copiedComponentCode: false
      },
      supersedes: {
        candidateVersion: 2,
        candidateDirectoryName: "uiverse-light-depth-motion-proof-v002",
        reason: "用户澄清 Battery Widget 仅用于文字弹出参考；删除充电式轮廓、分段进度和曲线，改为同屏平面骨架加三个浅立体重点"
      },
      render: {
        path: outputPath.slice(workspaceRoot.length + 1),
        ...contract,
        durationSeconds: metadata.durationInSeconds,
        bytes: finalIntegrity.bytes,
        sha256: finalIntegrity.sha256,
        audioCodec: metadata.audioCodec ?? null
      },
      calls: {
        externalApiCalls: 0,
        paidApiCalls: 0,
        providerCalls: 0,
        browserDownloads: 0
      },
      approvalBoundary: {
        mutatesEpisode: false,
        mutatesFormalRender: false,
        mutatesFormalQa: false,
        mutatesApproval: false,
        authorizesPublication: false
      },
      sources: sourceBefore,
      protectedBaselines: protectedBefore
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });

    const [protectedFinal, sourceFinal] = await Promise.all([
      capture(PROTECTED_PATHS),
      capture(SOURCE_PATHS)
    ]);
    assertSameSnapshots("正式产物", protectedBefore, protectedFinal);
    assertSameSnapshots("样片源码", sourceBefore, sourceFinal);
    await assertFormalOutputsAbsent();

    return { outputPath, manifestPath, metadata, ...finalIntegrity };
  } catch (error) {
    if (candidateCreated) await rm(CANDIDATE_DIRECTORY, { recursive: true, force: true });
    throw error;
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  renderAgentSkillUiverseMotionProof()
    .then((result) => console.log(JSON.stringify({ ok: true, ...result }, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
