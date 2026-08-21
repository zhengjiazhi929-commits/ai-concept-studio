import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { bundle } from "@remotion/bundler";
import {
  getVideoMetadata,
  renderMedia,
  renderStill,
  selectComposition
} from "@remotion/renderer";

import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import {
  ensureInside,
  publicRoot,
  studioOutputRoot,
  videoRoot,
  workspaceRoot
} from "../src/shared/paths.mjs";
import {
  AI_CUBE_FACES,
  AI_WATERMARK_TURNS,
  VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF,
  aiCubeFaceVisibilityAtFrame,
  aiWatermarkMotionAtFrame,
  visibleAiSolidGapAtCubeCorner
} from "../src/video/visual-system-v1-ai-watermark-proof-plan.mjs";

export const AI_WATERMARK_PROOF_RENDER_CONTRACT = Object.freeze({
  schemaVersion: "visual-system-v1-ai-watermark-proof-render-v12",
  candidateVersion: 12,
  candidateDirectoryName: "visual-system-v1-ai-watermark-motion-proof-v012",
  outputFileName: "six-face-ai-cube-reference-cadence.mp4",
  compositionId: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.compositionId,
  width: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.width,
  height: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.height,
  fps: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.fps,
  durationInFrames: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.durationInFrames,
  durationSeconds: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.durationSeconds,
  cycleFrames: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cycleFrames,
  codec: "h264",
  pixelFormat: "yuv420p",
  colorSpace: "bt709",
  crf: 1,
  gopSize: 1,
  concurrency: 2,
  audioTrack: false
});

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ENTRY_POINT = resolve(videoRoot, "visual-system-v1-ai-watermark-proof-index.jsx");
const CANDIDATE_PARENT = ensureInside(
  studioOutputRoot,
  resolve(studioOutputRoot, "design-system", "review-candidates")
);
const CANDIDATE_DIRECTORY = ensureInside(
  CANDIDATE_PARENT,
  resolve(CANDIDATE_PARENT, AI_WATERMARK_PROOF_RENDER_CONTRACT.candidateDirectoryName)
);

const PROTECTED_PATHS = Object.freeze([
  "studio/data/episodes/agent-skill-20260806/episode.json",
  "studio/data/episodes/agent-skill-tool-mcp-60s-20260813/episode.json",
  "outputs/studio/agent-skill-20260806/preview-v005.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v005.json",
  "outputs/studio/agent-skill-tool-mcp-60s-20260813/preview-v001.mp4",
  "studio/src/video/root.jsx",
  "studio/src/video/episode-preview.jsx",
  "studio/package.json",
  "studio/pnpm-lock.yaml"
]);

const PROTECTED_TREE_PATHS = Object.freeze([
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v001",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v002",
  "outputs/studio/design-system/review-candidates/uiverse-light-depth-motion-proof-v003",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v001",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v002",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v003",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v004",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v001",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v002",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v003",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v004",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v005",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v006",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v007",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v008",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v009",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v010",
  "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v011"
]);

const SOURCE_PATHS = Object.freeze([
  "studio/src/video/visual-system-v1-ai-watermark-proof-plan.mjs",
  "studio/src/video/visual-system-v1-ai-watermark-proof.jsx",
  "studio/src/video/visual-system-v1-ai-watermark-proof-root.jsx",
  "studio/src/video/visual-system-v1-ai-watermark-proof-index.jsx",
  "studio/tests/visual-system-v1-ai-watermark-proof.test.mjs",
  "studio/scripts/render-visual-system-v1-ai-watermark-proof.mjs"
]);

const FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT = Object.freeze([
  "outputs/studio/agent-skill-20260806/preview-v006.mp4",
  "outputs/studio/agent-skill-20260806/preview-v006.rendering.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v006.json",
  "outputs/studio/agent-skill-20260806/preview-v007.mp4",
  "outputs/studio/agent-skill-20260806/preview-v007.rendering.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v007.json",
  "outputs/studio/agent-skill-20260806/preview-v008.mp4",
  "outputs/studio/agent-skill-20260806/preview-v008.rendering.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v008.json",
  "outputs/studio/agent-skill-20260806/preview-v009.mp4",
  "outputs/studio/agent-skill-20260806/preview-v009.rendering.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v009.json",
  "outputs/studio/agent-skill-20260806/preview-v010.mp4",
  "outputs/studio/agent-skill-20260806/preview-v010.rendering.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v010.json",
  "outputs/studio/agent-skill-20260806/preview-v011.mp4",
  "outputs/studio/agent-skill-20260806/preview-v011.rendering.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v011.json",
  "outputs/studio/agent-skill-20260806/preview-v012.mp4",
  "outputs/studio/agent-skill-20260806/preview-v012.rendering.mp4",
  "outputs/studio/agent-skill-20260806/preview-qa-v012.json",
  "outputs/studio/design-system/review-candidates/visual-system-v1-skill-agent-mcp-proof-v005",
  "outputs/studio/agent-skill-tool-mcp-60s-20260813/preview-v002.mp4"
]);

const STILL_FRAMES = Object.freeze([
  0, 3, 4, 5, 6, 8, 10, 12, 14, 15, 18, 19, 20, 22, 23, 24, 29, 30, 33, 34,
  35, 36, 38, 41, 42, 45, 48, 50, 52, 53, 54, 59, 60, 68, 72, 75, 76, 77,
  78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90,
  94, 95, 98, 102, 105, 110, 119, 120
]);
const FLICKER_INSPECTION_FRAMES = Object.freeze(
  Array.from({ length: 13 }, (_, index) => 78 + index)
);
const FLICKER_ROI = Object.freeze({ left: 190, top: 210, width: 80, height: 140 });
const MAX_FLICKER_NORMALIZED_RGB_MAE = 2.4;
const MAX_LEFT_EXTRUSION_DEPTH_STEP_PX = 2.1;
const EXACT_ORIENTATION_FRAME_PAIRS = Object.freeze([
  Object.freeze([0, 30]),
  Object.freeze([0, 60]),
  Object.freeze([0, 90]),
  Object.freeze([0, 120])
]);
const DIRECTIONALLY_DISTINCT_FRAME_PAIRS = Object.freeze([
  Object.freeze([15, 75]),
  Object.freeze([45, 105])
]);

function workspacePath(relativePath) {
  return ensureInside(workspaceRoot, resolve(workspaceRoot, relativePath));
}

async function assertAbsent(target, label = target) {
  try {
    await access(target);
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
  return Object.freeze({ path: relativePath, ...integrity, mtimeMs: after.mtimeMs });
}

async function capture(paths) {
  const entries = await Promise.all(
    paths.map(async (relativePath) => [relativePath, await snapshot(relativePath)])
  );
  return Object.fromEntries(entries);
}

async function snapshotTree(relativeDirectory) {
  const absoluteDirectory = workspacePath(relativeDirectory);
  const stat = await lstat(absoluteDirectory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
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
      if (entryStat.isDirectory()) await walk(absolutePath);
      else if (entryStat.isFile()) files.push(await snapshot(relative(workspaceRoot, absolutePath)));
      else throw new Error(`保护树包含非普通文件：${relative(workspaceRoot, absolutePath)}`);
    }
  }
  await walk(absoluteDirectory);
  return Object.freeze({ path: relativeDirectory, files: Object.freeze(files) });
}

async function captureTrees(paths) {
  const entries = await Promise.all(
    paths.map(async (relativePath) => [relativePath, await snapshotTree(relativePath)])
  );
  return Object.fromEntries(entries);
}

function assertSameSnapshots(label, before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`${label} 在AI水印样片渲染期间发生变化`);
  }
}

async function assertFormalOutputsAbsent() {
  for (const relativePath of FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT) {
    await assertAbsent(workspacePath(relativePath), relativePath);
  }
}

function assertComposition(composition) {
  const contract = AI_WATERMARK_PROOF_RENDER_CONTRACT;
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
    throw new Error(`Composition 合同不匹配：${JSON.stringify({ actual, expected })}`);
  }
}

function assertMedia(metadata, integrity) {
  const contract = AI_WATERMARK_PROOF_RENDER_CONTRACT;
  if (
    metadata.width !== contract.width ||
    metadata.height !== contract.height ||
    metadata.fps !== contract.fps ||
    metadata.durationInSeconds == null ||
    Math.abs(metadata.durationInSeconds - contract.durationSeconds) > 1 / contract.fps ||
    metadata.codec !== contract.codec ||
    metadata.pixelFormat !== contract.pixelFormat ||
    metadata.colorSpace !== contract.colorSpace ||
    metadata.audioCodec !== null ||
    metadata.canPlayInVideoTag !== true ||
    metadata.supportsSeeking !== true ||
    integrity.bytes < 25_000
  ) {
    throw new Error(`样片媒体合同不匹配：${JSON.stringify({ metadata, integrity })}`);
  }
}

function denyBrowserDownload() {
  throw new Error("禁止下载浏览器；只允许使用已安装 Chrome");
}

function stillFileName(frame) {
  return `frame-${String(frame).padStart(4, "0")}.png`;
}

function paethPredictor(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function decodePngPixels(png) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, signature.length).equals(signature)) {
    throw new Error("源帧不是有效PNG");
  }
  let offset = signature.length;
  let header;
  const imageDataChunks = [];
  while (offset < png.length) {
    const chunkLength = png.readUInt32BE(offset);
    const chunkType = png.toString("ascii", offset + 4, offset + 8);
    const chunkData = png.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === "IHDR") {
      header = {
        width: chunkData.readUInt32BE(0),
        height: chunkData.readUInt32BE(4),
        bitDepth: chunkData[8],
        colorType: chunkData[9],
        interlace: chunkData[12]
      };
    } else if (chunkType === "IDAT") imageDataChunks.push(chunkData);
    else if (chunkType === "IEND") break;
    offset += 12 + chunkLength;
  }
  if (
    !header ||
    header.bitDepth !== 8 ||
    ![2, 6].includes(header.colorType) ||
    header.interlace !== 0 ||
    imageDataChunks.length === 0
  ) {
    throw new Error(`不支持的PNG源帧格式：${JSON.stringify(header)}`);
  }

  const channels = header.colorType === 6 ? 4 : 3;
  const stride = header.width * channels;
  const inflated = inflateSync(Buffer.concat(imageDataChunks));
  if (inflated.length !== header.height * (stride + 1)) {
    throw new Error("PNG源帧解压长度不匹配");
  }
  const decoded = Buffer.alloc(header.height * stride);
  for (let row = 0; row < header.height; row += 1) {
    const filter = inflated[row * (stride + 1)];
    const sourceOffset = row * (stride + 1) + 1;
    const targetOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const encoded = inflated[sourceOffset + column];
      const left = column >= channels ? decoded[targetOffset + column - channels] : 0;
      const up = row > 0 ? decoded[targetOffset + column - stride] : 0;
      const upperLeft =
        row > 0 && column >= channels
          ? decoded[targetOffset + column - stride - channels]
          : 0;
      let value;
      if (filter === 0) value = encoded;
      else if (filter === 1) value = encoded + left;
      else if (filter === 2) value = encoded + up;
      else if (filter === 3) value = encoded + Math.floor((left + up) / 2);
      else if (filter === 4) value = encoded + paethPredictor(left, up, upperLeft);
      else throw new Error(`不支持的PNG滤镜：${filter}`);
      decoded[targetOffset + column] = value & 255;
    }
  }
  if (channels === 4) return Object.freeze({ ...header, pixels: decoded });
  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let source = 0, target = 0; source < decoded.length; source += 3, target += 4) {
    rgba[target] = decoded[source];
    rgba[target + 1] = decoded[source + 1];
    rgba[target + 2] = decoded[source + 2];
    rgba[target + 3] = 255;
  }
  return Object.freeze({ ...header, pixels: rgba });
}

async function compareSourceFramePairs(records, pairs, { expectIdentical, label }) {
  const comparisons = [];
  for (const [leftFrame, rightFrame] of pairs) {
    const [leftPng, rightPng] = await Promise.all([
      readFile(workspacePath(records[leftFrame].path)),
      readFile(workspacePath(records[rightFrame].path))
    ]);
    const left = decodePngPixels(leftPng);
    const right = decodePngPixels(rightPng);
    const sameDimensions = left.width === right.width && left.height === right.height;
    const pixelsIdentical = sameDimensions && left.pixels.equals(right.pixels);
    let changedPixels = 0;
    if (sameDimensions && !pixelsIdentical) {
      for (let offset = 0; offset < left.pixels.length; offset += 4) {
        const maxChannelDifference = Math.max(
          Math.abs(left.pixels[offset] - right.pixels[offset]),
          Math.abs(left.pixels[offset + 1] - right.pixels[offset + 1]),
          Math.abs(left.pixels[offset + 2] - right.pixels[offset + 2]),
          Math.abs(left.pixels[offset + 3] - right.pixels[offset + 3])
        );
        if (maxChannelDifference > 2) changedPixels += 1;
      }
    }
    const changedPixelRatio = sameDimensions
      ? changedPixels / (left.width * left.height)
      : 1;
    if (expectIdentical && !pixelsIdentical) {
      throw new Error(`${label}源帧像素不完全一致：${leftFrame} != ${rightFrame}`);
    }
    if (!expectIdentical && (pixelsIdentical || changedPixelRatio <= 0.002)) {
      throw new Error(
        `${label}源帧没有体现反向差异：${leftFrame} == ${rightFrame}, ratio=${changedPixelRatio}`
      );
    }
    comparisons.push(
      Object.freeze({
        leftFrame,
        rightFrame,
        pixelsIdentical,
        changedPixelRatio,
        pngBytesIdentical: records[leftFrame].sha256 === records[rightFrame].sha256
      })
    );
  }
  return Object.freeze(comparisons);
}

async function analyzeThirdTurnLeftFaceFlicker(records) {
  const leftFace = AI_CUBE_FACES.find((face) => face.id === "left");
  if (!leftFace) throw new Error("AI水印缺少left面");

  const faceStates = FLICKER_INSPECTION_FRAMES.map((frame) => {
    const state = aiCubeFaceVisibilityAtFrame(frame, leftFace);
    return Object.freeze({
      frame,
      visible: state.visible,
      facing: state.facing,
      extrusionProgress: state.extrusionProgress,
      extrusionDepthPx: state.extrusionDepthPx,
      extrusionLayerCount: state.extrusionLayerCount
    });
  });
  let maximumExtrusionDepthStepPx = 0;
  for (let index = 1; index < faceStates.length; index += 1) {
    const previous = faceStates[index - 1];
    const current = faceStates[index];
    const step = current.extrusionDepthPx - previous.extrusionDepthPx;
    if (step < -1e-12 || step > MAX_LEFT_EXTRUSION_DEPTH_STEP_PX) {
      throw new Error(
        `第三次旋转左侧AI厚度跳动：${previous.frame}->${current.frame}, step=${step}`
      );
    }
    maximumExtrusionDepthStepPx = Math.max(maximumExtrusionDepthStepPx, step);
  }

  const pixelPairs = [];
  for (let index = 1; index < FLICKER_INSPECTION_FRAMES.length; index += 1) {
    const leftFrame = FLICKER_INSPECTION_FRAMES[index - 1];
    const rightFrame = FLICKER_INSPECTION_FRAMES[index];
    const [leftPng, rightPng] = await Promise.all([
      readFile(workspacePath(records[leftFrame].path)),
      readFile(workspacePath(records[rightFrame].path))
    ]);
    const left = decodePngPixels(leftPng);
    const right = decodePngPixels(rightPng);
    if (left.width !== right.width || left.height !== right.height) {
      throw new Error(`跳动检查源帧尺寸不同：${leftFrame}->${rightFrame}`);
    }
    if (
      FLICKER_ROI.left + FLICKER_ROI.width > left.width ||
      FLICKER_ROI.top + FLICKER_ROI.height > left.height
    ) {
      throw new Error("跳动检查ROI超出源帧");
    }

    let rgbDifference = 0;
    let changedPixels = 0;
    for (let y = FLICKER_ROI.top; y < FLICKER_ROI.top + FLICKER_ROI.height; y += 1) {
      for (let x = FLICKER_ROI.left; x < FLICKER_ROI.left + FLICKER_ROI.width; x += 1) {
        const offset = (y * left.width + x) * 4;
        const red = Math.abs(left.pixels[offset] - right.pixels[offset]);
        const green = Math.abs(left.pixels[offset + 1] - right.pixels[offset + 1]);
        const blue = Math.abs(left.pixels[offset + 2] - right.pixels[offset + 2]);
        rgbDifference += red + green + blue;
        if (Math.max(red, green, blue) > 2) changedPixels += 1;
      }
    }
    const roiPixels = FLICKER_ROI.width * FLICKER_ROI.height;
    const rgbMae = rgbDifference / (roiPixels * 3);
    const leftMotion = aiWatermarkMotionAtFrame(leftFrame);
    const rightMotion = aiWatermarkMotionAtFrame(rightFrame);
    const angularStepDegrees = Math.abs(rightMotion.rotateX - leftMotion.rotateX);
    const normalizedRgbMae = rgbMae / angularStepDegrees;
    if (normalizedRgbMae > MAX_FLICKER_NORMALIZED_RGB_MAE) {
      throw new Error(
        `第三次旋转左侧AI像素跳动：${leftFrame}->${rightFrame}, normalized=${normalizedRgbMae}`
      );
    }
    pixelPairs.push(
      Object.freeze({
        leftFrame,
        rightFrame,
        angularStepDegrees,
        changedPixelRatio: changedPixels / roiPixels,
        rgbMae,
        normalizedRgbMae
      })
    );
  }

  return Object.freeze({
    frames: FLICKER_INSPECTION_FRAMES,
    roi: FLICKER_ROI,
    faceStates: Object.freeze(faceStates),
    maximumExtrusionDepthStepPx,
    maximumAllowedExtrusionDepthStepPx: MAX_LEFT_EXTRUSION_DEPTH_STEP_PX,
    maximumNormalizedRgbMae: Math.max(...pixelPairs.map((pair) => pair.normalizedRgbMae)),
    maximumAllowedNormalizedRgbMae: MAX_FLICKER_NORMALIZED_RGB_MAE,
    pixelPairs: Object.freeze(pixelPairs)
  });
}

async function renderStillWithRetry(options, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await renderStill(options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await rm(options.output, { force: true });
        console.warn(`source still retry ${attempt}/${attempts}: ${error.message}`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1200));
      }
    }
  }
  throw lastError;
}

async function renderSourceStills({ composition, serveUrl, sourceFramesDirectory }) {
  const records = {};
  for (const frame of STILL_FRAMES) {
    const output = resolve(sourceFramesDirectory, stillFileName(frame));
    await renderStillWithRetry({
      composition,
      serveUrl,
      output,
      frame,
      imageFormat: "png",
      browserExecutable: CHROME_EXECUTABLE,
      onBrowserDownload: denyBrowserDownload,
      overwrite: false,
      timeoutInMilliseconds: 120_000,
      logLevel: "warn"
    });
    records[frame] = Object.freeze({
      frame,
      path: relative(workspaceRoot, output),
      ...(await inspectFileIntegrity(output))
    });
  }
  return Object.freeze({
    records: Object.freeze(records),
    exactOrientationComparisons: await compareSourceFramePairs(
      records,
      EXACT_ORIENTATION_FRAME_PAIRS,
      { expectIdentical: true, label: "相位边界" }
    ),
    directionallyDistinctComparisons: await compareSourceFramePairs(
      records,
      DIRECTIONALLY_DISTINCT_FRAME_PAIRS,
      { expectIdentical: false, label: "正反方向" }
    ),
    thirdTurnLeftFaceFlicker: await analyzeThirdTurnLeftFaceFlicker(records)
  });
}

export async function renderVisualSystemV1AiWatermarkProof() {
  const contract = AI_WATERMARK_PROOF_RENDER_CONTRACT;
  const bundleDirectory = resolve(CANDIDATE_DIRECTORY, "bundle");
  const qaDirectory = resolve(CANDIDATE_DIRECTORY, "qa");
  const sourceFramesDirectory = resolve(qaDirectory, "source-frames");
  const outputPath = resolve(CANDIDATE_DIRECTORY, contract.outputFileName);
  const temporaryOutputPath = resolve(CANDIDATE_DIRECTORY, `${contract.outputFileName}.rendering.mp4`);
  const manifestPath = resolve(CANDIDATE_DIRECTORY, "review-manifest.json");
  const qaSummaryPath = resolve(qaDirectory, "qa-summary.json");
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
    await mkdir(sourceFramesDirectory, { recursive: true });

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

    const sourceFrameQa = await renderSourceStills({
      composition,
      serveUrl,
      sourceFramesDirectory
    });
    const sourceFrames = sourceFrameQa.records;

    let lastReported = -1;
    await renderMedia({
      composition,
      serveUrl,
      outputLocation: temporaryOutputPath,
      browserExecutable: CHROME_EXECUTABLE,
      onBrowserDownload: denyBrowserDownload,
      codec: contract.codec,
      pixelFormat: contract.pixelFormat,
      colorSpace: contract.colorSpace,
      crf: contract.crf,
      gopSize: contract.gopSize,
      concurrency: contract.concurrency,
      disallowParallelEncoding: true,
      hardwareAcceleration: "disable",
      imageFormat: "png",
      muted: true,
      enforceAudioTrack: false,
      overwrite: false,
      logLevel: "warn",
      onProgress: ({ progress }) => {
        const percent = Math.floor(progress * 10) * 10;
        if (percent > lastReported) {
          lastReported = percent;
          console.log(`AI watermark render ${percent}%`);
        }
      }
    });

    await rm(bundleDirectory, { recursive: true, force: true });
    const [metadata, stagedIntegrity] = await Promise.all([
      getVideoMetadata(temporaryOutputPath, { logLevel: "error" }),
      inspectFileIntegrity(temporaryOutputPath)
    ]);
    assertMedia(metadata, stagedIntegrity);

    const [protectedAfterRender, protectedTreesAfterRender, sourceAfterRender] = await Promise.all([
      capture(PROTECTED_PATHS),
      captureTrees(PROTECTED_TREE_PATHS),
      capture(SOURCE_PATHS)
    ]);
    assertSameSnapshots("正式与入口文件", protectedBefore, protectedAfterRender);
    assertSameSnapshots("历史候选树", protectedTreesBefore, protectedTreesAfterRender);
    assertSameSnapshots("AI水印样片源码", sourceBefore, sourceAfterRender);
    await assertFormalOutputsAbsent();

    await rename(temporaryOutputPath, outputPath);
    const finalIntegrity = await inspectFileIntegrity(outputPath);
    if (JSON.stringify(finalIntegrity) !== JSON.stringify(stagedIntegrity)) {
      throw new Error("AI水印样片原子改名后完整性变化");
    }

    const qaSummary = {
      schemaVersion: "visual-system-v1-ai-watermark-proof-qa-v12",
      status: "pass",
      sourceFrameContract: {
        checkedFrames: STILL_FRAMES,
        exactOrientationPairs: sourceFrameQa.exactOrientationComparisons,
        directionallyDistinctPairs: sourceFrameQa.directionallyDistinctComparisons,
        phaseBoundaryFramesIdentical: true,
        firstMiddleLastIdentical: true,
        firstFrameSha256: sourceFrames[0].sha256,
        middleFrameSha256: sourceFrames[60].sha256,
        lastFrameSha256: sourceFrames[120].sha256
      },
      motionContract: {
        cycleFrames: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cycleFrames,
        turnFrames: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.turnFrames,
        turnCount: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.turnCount,
        turns: AI_WATERMARK_TURNS
      },
      flickerContract: sourceFrameQa.thirdTurnLeftFaceFlicker,
      media: {
        path: relative(workspaceRoot, outputPath),
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        durationInSeconds: metadata.durationInSeconds,
        codec: metadata.codec,
        pixelFormat: metadata.pixelFormat,
        colorSpace: metadata.colorSpace,
        audioCodec: metadata.audioCodec,
        canPlayInVideoTag: metadata.canPlayInVideoTag,
        supportsSeeking: metadata.supportsSeeking,
        ...finalIntegrity
      }
    };
    await writeFile(qaSummaryPath, `${JSON.stringify(qaSummary, null, 2)}\n`, { flag: "wx" });

    const manifest = {
      schemaVersion: "visual-system-v1-ai-watermark-proof-manifest-v12",
      candidateVersion: contract.candidateVersion,
      reviewOnly: true,
      registered: false,
      formalEpisodeStateTouched: false,
      formalRenderOrQaUpdated: false,
      authorizesPublication: false,
      createdAt: new Date().toISOString(),
      supersedes: {
        candidateVersion: 11,
        candidateDirectoryName: "visual-system-v1-ai-watermark-motion-proof-v011",
        reason: "Remove the third-turn left-face extrusion jump while retaining cadence, direction, geometry, and loop closure"
      },
      reference: {
        url: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.reference.url,
        license: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.reference.license,
        observedCadence: "2s CSS ease; first second one X turn, second second one Y turn",
        adaptedDirectionPattern:
          VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.reference.adaptedDirectionPattern,
        copiedGeometry: false,
        copiedComponentCode: false,
        adaptedElement: "rotation cadence only"
      },
      content: {
        object: "open cube made from six extruded SVG AI faces",
        faceCount: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.faceCount,
        panelMode: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.panelMode,
        backfaceMode: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.backfaceMode,
        minimumVisibleFacing: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.minimumVisibleFacing,
        extrusionTaperFacingStart:
          VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.extrusionTaperFacingStart,
        extrusionFullFacing:
          VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.extrusionFullFacing,
        nearProfileExtrusionMode: "continuous-layer-opacity-taper",
        flickerInspectionFrames: FLICKER_INSPECTION_FRAMES,
        flickerInspectionRoi: FLICKER_ROI,
        aFrontSurfaceMode: "single-nonzero-compound-path",
        layoutMode: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.layoutMode,
        visibleSolidGap: visibleAiSolidGapAtCubeCorner(),
        targetVisibleSolidGapRangePx:
          VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.targetVisibleSolidGapRangePx,
        targetProjectedVisibleGapPx:
          VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.targetProjectedVisibleGapPx,
        extrusionLayersPerFace: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.extrusion.layerCount,
        totalExtrusionLayers:
          VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cube.faceCount *
          VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.extrusion.layerCount,
        primaryMintLayers: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.extrusion.primaryMintLayers,
        secondaryPurpleLayers: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.extrusion.secondaryPurpleLayers,
        opaqueCubeOrCardShell: false,
        cycleFrames: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cycleFrames,
        referenceCycleFrames: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.referenceCycleFrames,
        turnFrames: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.turnFrames,
        turnCount: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.turnCount,
        turns: AI_WATERMARK_TURNS,
        displayedCompleteCycles: 1,
        closingProofFrameIncluded: true
      },
      renderContract: contract,
      output: qaSummary.media,
      qa: {
        path: relative(workspaceRoot, qaSummaryPath),
        status: qaSummary.status,
        sourceFrames
      },
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
    assertSameSnapshots("正式与入口文件", protectedBefore, protectedFinal);
    assertSameSnapshots("历史候选树", protectedTreesBefore, protectedTreesFinal);
    assertSameSnapshots("AI水印样片源码", sourceBefore, sourceFinal);
    await assertFormalOutputsAbsent();

    return Object.freeze({
      candidateDirectory: CANDIDATE_DIRECTORY,
      outputPath,
      manifestPath,
      qaSummaryPath,
      metadata,
      ...finalIntegrity
    });
  } catch (error) {
    if (candidateCreated) await rm(CANDIDATE_DIRECTORY, { recursive: true, force: true });
    throw error;
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  renderVisualSystemV1AiWatermarkProof()
    .then((result) => console.log(JSON.stringify({ ok: true, ...result }, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : String(error));
      process.exitCode = 1;
    });
}
