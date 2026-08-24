import {
  access,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { relative, resolve } from "node:path";
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
import { VISUAL_SYSTEM_V1 } from "../src/video/components/visual-system-v1/tokens.mjs";
import {
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES,
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF,
  visualSystemV1SkillAgentMcpProofLayout
} from "../src/video/visual-system-v1-skill-agent-mcp-proof-plan.mjs";

export const VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT = Object.freeze({
  schemaVersion: "visual-system-v1-skill-agent-mcp-render-v13",
  candidateVersion: 13,
  candidateDirectoryName: "visual-system-v1-skill-agent-mcp-proof-v013",
  fps: 30,
  durationSeconds: 12,
  durationInFrames: 360,
  codec: "h264",
  pixelFormat: "yuv420p",
  colorSpace: "bt709",
  crf: 18,
  concurrency: 1,
  audioTrack: false,
  outputs: Object.freeze({
    wide: Object.freeze({
      compositionId: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.compositions.wide.id,
      fileName: "skill-agent-mcp-flat-open-canvas-ai-watermark-black-subtitle-wide-12s.mp4",
      width: 1920,
      height: 1080
    })
  })
});

export const VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_WATERMARK_PROVENANCE = Object.freeze({
  motionCandidate:
    "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v012",
  motionCandidateVersion: 12,
  motionSchemaVersion: "visual-system-v1-ai-watermark-motion-proof-v12",
  sizeCandidate:
    "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-size-proof-v002",
  rasterAssetManifest:
    "studio/public/assets/visual-system-v1/ai-watermark-v012/manifest.json",
  rasterAssetVersion: 12,
  rasterAssetFrameCount: 120
});

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ENTRY_POINT = resolve(videoRoot, "visual-system-v1-skill-agent-mcp-proof-index.jsx");
const CANDIDATE_PARENT = ensureInside(
  studioOutputRoot,
  resolve(studioOutputRoot, "design-system", "review-candidates")
);
const CANDIDATE_DIRECTORY = ensureInside(
  CANDIDATE_PARENT,
  resolve(
    CANDIDATE_PARENT,
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.candidateDirectoryName
  )
);

const PROTECTED_PATHS = Object.freeze([
  "studio/data/episodes/agent-skill-20260806/episode.json",
  "studio/data/episodes/agent-skill-tool-mcp-60s-20260813/episode.json",
  "outputs/studio/agent-skill-20260806/preview-v005.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v005.json",
  "outputs/studio/agent-skill-tool-mcp-60s-20260813/preview-v001.mp4",
  "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v003/review-10m.mp4",
  "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v003/review-manifest.json",
  "outputs/studio/agent-skill-20260806/review-candidates/full-video-current-visual-upgrade-v003/qa/qa-summary.json",
  "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v006/01-soft-gradient-edge-swap-30s.mp4",
  "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v006/comparison-manifest.json",
  "outputs/studio/agent-skill-20260806/review-candidates/s10-background-comparison-v006/qa/qa-summary.json",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v001/uiverse-light-depth-motion-proof-8s.mp4",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v001/review-manifest.json",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v002/uiverse-light-depth-motion-proof-8s.mp4",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v002/review-manifest.json",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v002/qa/qa-summary.json",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v003/uiverse-light-depth-motion-proof-8s.mp4",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v003/review-manifest.json",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v003/qa/qa-summary.json",
  "studio/src/video/root.jsx",
  "studio/src/video/episode-preview.jsx"
]);

const PROTECTED_TREE_PATHS = Object.freeze([
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v001",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v002",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v003",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v004",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v005",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v006",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v007",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v010",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v011",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v012",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v011",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v012",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-size-proof-v002"
]);

const WATERMARK_RASTER_ASSET_PATHS = Object.freeze([
  "studio/public/assets/visual-system-v1/ai-watermark-v012/manifest.json",
  ...Array.from(
    { length: 120 },
    (_, frame) =>
      `studio/public/assets/visual-system-v1/ai-watermark-v012/frames/frame-${String(frame).padStart(3, "0")}.png`
  )
]);

const SOURCE_PATHS = Object.freeze([
  "studio/src/video/components/visual-system-v1/tokens.mjs",
  "studio/src/video/components/visual-system-v1/chapter-progress.mjs",
  "studio/src/video/components/visual-system-v1/layout.mjs",
  "studio/src/video/components/visual-system-v1/motion.mjs",
  "studio/src/video/components/visual-system-v1/ai-watermark.mjs",
  "studio/src/video/components/visual-system-v1/ai-watermark.jsx",
  "studio/src/video/components/visual-system-v1/components.jsx",
  "studio/src/video/components/visual-system-v1/index.jsx",
  "studio/src/video/visual-system-v1-ai-watermark-proof-plan.mjs",
  "studio/src/video/visual-system-v1-ai-watermark-raster-source-plan.mjs",
  "studio/src/video/visual-system-v1-ai-watermark-raster-source.jsx",
  "studio/src/video/visual-system-v1-ai-watermark-raster-source-root.jsx",
  "studio/src/video/visual-system-v1-ai-watermark-raster-source-index.jsx",
  "studio/src/video/visual-system-v1-skill-agent-mcp-proof-plan.mjs",
  "studio/src/video/visual-system-v1-skill-agent-mcp-scenes/scene-boundary.jsx",
  "studio/src/video/visual-system-v1-skill-agent-mcp-scenes/scene-execution.jsx",
  "studio/src/video/visual-system-v1-skill-agent-mcp-scenes/scene-review.jsx",
  "studio/src/video/visual-system-v1-skill-agent-mcp-scenes/workflow.jsx",
  "studio/src/video/visual-system-v1-skill-agent-mcp-proof.jsx",
  "studio/src/video/visual-system-v1-skill-agent-mcp-proof-root.jsx",
  "studio/src/video/visual-system-v1-skill-agent-mcp-proof-index.jsx",
  "studio/tests/visual-system-v1-skill-agent-mcp-proof.test.mjs",
  "studio/scripts/render-visual-system-v1-ai-watermark-raster-assets.mjs",
  "studio/scripts/render-visual-system-v1-skill-agent-mcp-proof.mjs",
  ...WATERMARK_RASTER_ASSET_PATHS
]);

const FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT = Object.freeze([
  "outputs/studio/agent-skill-20260806/preview-v006.mp4",
  "outputs/studio/agent-skill-20260806/preview-v006.rendering.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v006.json",
  "outputs/studio/agent-skill-tool-mcp-60s-20260813/preview-v002.mp4"
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
    throw new Error(`保护范围只允许普通文件：${relativePath}`);
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
  const entries = await Promise.all(
    paths.map(async (relativePath) => [relativePath, await snapshot(relativePath)])
  );
  return Object.fromEntries(entries);
}

async function snapshotTree(relativeDirectory) {
  const absoluteDirectory = workspacePath(relativeDirectory);
  const directoryStat = await lstat(absoluteDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`保护树必须是普通目录：${relativeDirectory}`);
  }
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const entryStat = await lstat(absolutePath);
      if (entryStat.isSymbolicLink()) {
        throw new Error(`保护树不允许符号链接：${relative(workspaceRoot, absolutePath)}`);
      }
      if (entryStat.isDirectory()) {
        await walk(absolutePath);
      } else if (entryStat.isFile()) {
        files.push(await snapshot(relative(workspaceRoot, absolutePath)));
      } else {
        throw new Error(`保护树包含非普通文件：${relative(workspaceRoot, absolutePath)}`);
      }
    }
  }
  await walk(absoluteDirectory);
  return Object.freeze({
    path: relativeDirectory,
    files: Object.freeze(files)
  });
}

async function captureTrees(paths) {
  const entries = await Promise.all(
    paths.map(async (relativePath) => [relativePath, await snapshotTree(relativePath)])
  );
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

function assertComposition(composition, expected) {
  const actual = {
    id: composition.id,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames
  };
  const contract = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT;
  const wanted = {
    id: expected.compositionId,
    width: expected.width,
    height: expected.height,
    fps: contract.fps,
    durationInFrames: contract.durationInFrames
  };
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`Composition 合同不匹配：${JSON.stringify({ actual, wanted })}`);
  }
}

function assertMedia(metadata, integrity, expected) {
  const contract = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT;
  if (
    metadata.width !== expected.width ||
    metadata.height !== expected.height ||
    metadata.fps !== contract.fps ||
    metadata.durationInSeconds == null ||
    Math.abs(metadata.durationInSeconds - contract.durationSeconds) > 1 / contract.fps ||
    metadata.codec !== contract.codec ||
    metadata.pixelFormat !== contract.pixelFormat ||
    metadata.colorSpace !== contract.colorSpace ||
    metadata.audioCodec !== null ||
    metadata.canPlayInVideoTag !== true ||
    metadata.supportsSeeking !== true ||
    integrity.bytes < 50_000
  ) {
    throw new Error(`样片媒体合同不匹配：${JSON.stringify({ metadata, integrity, expected })}`);
  }
}

function denyBrowserDownload() {
  throw new Error("禁止下载浏览器；只允许使用已安装 Chrome");
}

async function renderOne({ serveUrl, key, expected, outputPath, temporaryOutputPath }) {
  const composition = await selectComposition({
    serveUrl,
    id: expected.compositionId,
    browserExecutable: CHROME_EXECUTABLE,
    onBrowserDownload: denyBrowserDownload,
    logLevel: "warn"
  });
  assertComposition(composition, expected);
  let lastReported = -1;
  await renderMedia({
    composition,
    serveUrl,
    outputLocation: temporaryOutputPath,
    browserExecutable: CHROME_EXECUTABLE,
    onBrowserDownload: denyBrowserDownload,
    codec: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.codec,
    pixelFormat: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.pixelFormat,
    colorSpace: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.colorSpace,
    crf: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.crf,
    concurrency: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.concurrency,
    imageFormat: "png",
    muted: true,
    enforceAudioTrack: false,
    overwrite: false,
    logLevel: "warn",
    onProgress: ({ progress }) => {
      const percent = Math.floor(progress * 10) * 10;
      if (percent > lastReported) {
        lastReported = percent;
        console.log(`${key} render ${percent}%`);
      }
    }
  });
  const [metadata, integrity] = await Promise.all([
    getVideoMetadata(temporaryOutputPath, { logLevel: "error" }),
    inspectFileIntegrity(temporaryOutputPath)
  ]);
  assertMedia(metadata, integrity, expected);
  await rename(temporaryOutputPath, outputPath);
  const finalIntegrity = await inspectFileIntegrity(outputPath);
  if (JSON.stringify(finalIntegrity) !== JSON.stringify(integrity)) {
    throw new Error(`${key} 样片原子改名后完整性变化`);
  }
  return Object.freeze({
    path: relative(workspaceRoot, outputPath),
    compositionId: expected.compositionId,
    width: expected.width,
    height: expected.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
    durationInSeconds: metadata.durationInSeconds,
    codec: metadata.codec,
    pixelFormat: metadata.pixelFormat,
    colorSpace: metadata.colorSpace,
    audioCodec: metadata.audioCodec,
    canPlayInVideoTag: metadata.canPlayInVideoTag,
    supportsSeeking: metadata.supportsSeeking,
    ...finalIntegrity
  });
}

export async function renderVisualSystemV1SkillAgentMcpProof() {
  const contract = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT;
  const bundleDirectory = resolve(CANDIDATE_DIRECTORY, "bundle");
  const manifestPath = resolve(CANDIDATE_DIRECTORY, "review-manifest.json");
  let candidateCreated = false;

  await assertAbsent(CANDIDATE_DIRECTORY, contract.candidateDirectoryName);
  await assertFormalOutputsAbsent();
  await access(CHROME_EXECUTABLE);
  const [protectedBefore, protectedTreesBefore, sourceBefore] = await Promise.all([
    capture(PROTECTED_PATHS),
    captureTrees(PROTECTED_TREE_PATHS),
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

    const rendered = {};
    for (const [key, expected] of Object.entries(contract.outputs)) {
      const outputPath = resolve(CANDIDATE_DIRECTORY, expected.fileName);
      const temporaryOutputPath = resolve(
        CANDIDATE_DIRECTORY,
        `${expected.fileName}.rendering.mp4`
      );
      await assertAbsent(outputPath, expected.fileName);
      await assertAbsent(temporaryOutputPath, `${expected.fileName}.rendering.mp4`);
      rendered[key] = await renderOne({
        serveUrl,
        key,
        expected,
        outputPath,
        temporaryOutputPath
      });
    }

    await rm(bundleDirectory, { recursive: true, force: true });
    const [protectedAfterRender, protectedTreesAfterRender, sourceAfterRender] = await Promise.all([
      capture(PROTECTED_PATHS),
      captureTrees(PROTECTED_TREE_PATHS),
      capture(SOURCE_PATHS)
    ]);
    assertSameSnapshots("正式与历史产物", protectedBefore, protectedAfterRender);
    assertSameSnapshots("历史与已批准水印候选树", protectedTreesBefore, protectedTreesAfterRender);
    assertSameSnapshots("visual-system-v1 样片源码", sourceBefore, sourceAfterRender);
    await assertFormalOutputsAbsent();

    const manifest = {
      schemaVersion: "visual-system-v1-skill-agent-mcp-proof-manifest-v13",
      candidateVersion: contract.candidateVersion,
      reviewOnly: true,
      registered: false,
      formalEpisodeStateTouched: false,
      formalRenderOrQaUpdated: false,
      authorizesPublication: false,
      createdAt: new Date().toISOString(),
      supersedes: {
        candidateVersion: 12,
        candidateDirectoryName: "visual-system-v1-skill-agent-mcp-proof-v012",
        reason:
          "Keep visible-node-count scene-adaptive composition while synchronizing each connector with its target card and replacing overlapping title crossfades with an eight-frame sequential copy handoff"
      },
      visualSystem: {
        schemaVersion: VISUAL_SYSTEM_V1.schemaVersion,
        balance: VISUAL_SYSTEM_V1.balance,
        defaults: VISUAL_SYSTEM_V1.defaults,
        chapterProgress: VISUAL_SYSTEM_V1.chapterProgress,
        cardDeck: VISUAL_SYSTEM_V1.cardDeck,
        cardTypography: VISUAL_SYSTEM_V1.cardTypography,
        depthRoles: VISUAL_SYSTEM_V1.depth.roles,
        motion: VISUAL_SYSTEM_V1.motion,
        forbidden: VISUAL_SYSTEM_V1.forbidden
      },
      content: {
        topic: "Skill → Agent → MCP → 外部能力",
        silent: true,
        outputFormat: "wide-only",
        contentFrameMode: "open-canvas",
        topHeaderRuntimeCount: 0,
        largeContentWindowRuntimeCount: 0,
        independentSmallModuleCount: 5,
        surfaceMode: "flat-only",
        runtimeShallowDepthCount: 0,
        shallowDepthCapabilityRetained: true,
        watermark: {
          enabled: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark.enabled,
          role: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark.role,
          component: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark.component,
          placement: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark.placement,
          motion: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark.motion,
          motionSchemaVersion:
            VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark.motionSchemaVersion,
          renderMode: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark.renderMode,
          rasterSequence: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark.rasterSequence,
          completeCycles: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark.completeCycles,
          contentSurfacePolicyExempt:
            VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark.contentSurfacePolicyExempt
        },
        watermarkApprovalProvenance:
          VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_WATERMARK_PROVENANCE,
        chapterProgress: {
          mode: "duration-proportional-segmented",
          segmentFrames: [72, 120, 168],
          ratio: "3:5:7",
          labels: true,
          labelFormat: "index-and-title",
          durationText: false,
          elapsedTime: false,
          totalTime: false,
          breakpoints: 2,
          themeColorCount: 1,
          visualStateDifference: "fill-length-only"
        },
        adaptiveCardDeck: (() => {
          const proofLayout = visualSystemV1SkillAgentMcpProofLayout(1920, 1080);
          const layoutsByVisibleCount = Object.fromEntries(
            Object.entries(proofLayout.cardDecksByCount).map(([itemCount, layout]) => [
              itemCount,
              {
                itemCount: layout.itemCount,
                rows: layout.rows,
                columns: layout.columns,
                gapX: layout.gapX,
                gapY: layout.gapY,
                cardWidth: layout.cardWidth,
                cardHeight: layout.cardHeight,
                safeArea: layout.safeArea,
                cards: layout.cards,
                typography: proofLayout.cardTypographyByCount[itemCount]
              }
            ])
          );
          return {
            mode: "scene-adaptive-visible-node-count",
            reflowFrames: VISUAL_SYSTEM_V1.motion.cardReflowFrames,
            focusFrames: VISUAL_SYSTEM_V1.motion.cardFocusFrames,
            stages: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES,
            layoutsByVisibleCount,
            contentVerticalAlignment: VISUAL_SYSTEM_V1.cardDeck.contentVerticalAlignment,
            sameLevelEqualSize: VISUAL_SYSTEM_V1.cardDeck.sameLevelEqualSize
          };
        })(),
        subtitleStyle: "stable-black-no-shadow",
        semanticContentSource: "single-wide-composition"
      },
      renderContract: contract,
      outputs: rendered,
      calls: {
        externalApiCalls: 0,
        paidApiCalls: 0,
        providerCalls: 0,
        browserDownloads: 0
      },
      sources: sourceBefore,
      protectedBaselines: protectedBefore,
      protectedTrees: protectedTreesBefore
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });

    const [protectedFinal, protectedTreesFinal, sourceFinal] = await Promise.all([
      capture(PROTECTED_PATHS),
      captureTrees(PROTECTED_TREE_PATHS),
      capture(SOURCE_PATHS)
    ]);
    assertSameSnapshots("正式与历史产物", protectedBefore, protectedFinal);
    assertSameSnapshots("历史与已批准水印候选树", protectedTreesBefore, protectedTreesFinal);
    assertSameSnapshots("visual-system-v1 样片源码", sourceBefore, sourceFinal);
    await assertFormalOutputsAbsent();

    return Object.freeze({
      candidateDirectory: CANDIDATE_DIRECTORY,
      manifestPath,
      outputs: rendered
    });
  } catch (error) {
    if (candidateCreated) {
      await rm(CANDIDATE_DIRECTORY, { recursive: true, force: true });
    }
    throw error;
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  renderVisualSystemV1SkillAgentMcpProof()
    .then((result) => console.log(JSON.stringify({ ok: true, ...result }, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
