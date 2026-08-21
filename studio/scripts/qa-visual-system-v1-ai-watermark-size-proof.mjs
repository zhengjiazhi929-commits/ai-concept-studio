import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import {
  ensureInside,
  studioOutputRoot,
  videoRoot,
  workspaceRoot
} from "../src/shared/paths.mjs";
import {
  VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF,
  aiWatermarkSizeProofGeometry
} from "../src/video/visual-system-v1-ai-watermark-size-proof-plan.mjs";

const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF;
const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ENTRY_POINT = resolve(videoRoot, "visual-system-v1-ai-watermark-size-proof-index.jsx");
const candidateDirectory = ensureInside(
  studioOutputRoot,
  resolve(
    studioOutputRoot,
    "design-system",
    "review-candidates",
    "visual-system-v1-ai-watermark-size-proof-v001"
  )
);

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
    throw new Error("不是有效 PNG");
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
    throw new Error(`不支持的 PNG 格式：${JSON.stringify(header)}`);
  }

  const channels = header.colorType === 6 ? 4 : 3;
  const stride = header.width * channels;
  const inflated = inflateSync(Buffer.concat(imageDataChunks));
  if (inflated.length !== header.height * (stride + 1)) {
    throw new Error("PNG 解压长度不匹配");
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
      else throw new Error(`不支持的 PNG 滤镜：${filter}`);
      decoded[targetOffset + column] = value & 255;
    }
  }
  if (channels === 4) return { ...header, pixels: decoded };
  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let source = 0, target = 0; source < decoded.length; source += 3, target += 4) {
    rgba[target] = decoded[source];
    rgba[target + 1] = decoded[source + 1];
    rgba[target + 2] = decoded[source + 2];
    rgba[target + 3] = 255;
  }
  return { ...header, pixels: rgba };
}

function pixelDiffers(left, right, byteOffset) {
  return (
    left[byteOffset] !== right[byteOffset] ||
    left[byteOffset + 1] !== right[byteOffset + 1] ||
    left[byteOffset + 2] !== right[byteOffset + 2] ||
    left[byteOffset + 3] !== right[byteOffset + 3]
  );
}

function isOutlineBand(x, y, geometry, strokeWidth) {
  const insideX = x >= geometry.left && x < geometry.left + geometry.width;
  const insideY = y >= geometry.top && y < geometry.top + geometry.height;
  if (!insideX || !insideY) return false;
  const edgeX =
    x < geometry.left + strokeWidth ||
    x >= geometry.left + geometry.width - strokeWidth;
  const edgeY =
    y < geometry.top + strokeWidth ||
    y >= geometry.top + geometry.height - strokeWidth;
  return edgeX || edgeY;
}

function auditOutput(base, output, option) {
  if (output.width !== contract.width || output.height !== contract.height) {
    throw new Error(`${option.id} 不是 1920×1080`);
  }
  const geometry = aiWatermarkSizeProofGeometry(option);
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
  const sideChanges = { top: 0, right: 0, bottom: 0, left: 0 };
  let changedPixels = 0;
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const byteOffset = (y * output.width + x) * 4;
      if (!pixelDiffers(base.pixels, output.pixels, byteOffset)) continue;
      if (!isOutlineBand(x, y, geometry, contract.outline.width)) {
        throw new Error(`${option.id} 在占位描边之外改动了像素：${x},${y}`);
      }
      changedPixels += 1;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
      if (y < geometry.top + contract.outline.width) sideChanges.top += 1;
      if (x >= geometry.left + geometry.width - contract.outline.width) sideChanges.right += 1;
      if (y >= geometry.top + geometry.height - contract.outline.width) sideChanges.bottom += 1;
      if (x < geometry.left + contract.outline.width) sideChanges.left += 1;
    }
  }
  if (changedPixels === 0 || Object.values(sideChanges).some((count) => count === 0)) {
    throw new Error(`${option.id} 的四边描边没有完整出现`);
  }
  const expectedBounds = {
    minX: geometry.left,
    minY: geometry.top,
    maxX: geometry.left + geometry.width - 1,
    maxY: geometry.top + geometry.height - 1
  };
  if (JSON.stringify(bounds) !== JSON.stringify(expectedBounds)) {
    throw new Error(
      `${option.id} 描边外接框不匹配：${JSON.stringify({ bounds, expectedBounds })}`
    );
  }
  return { geometry, changedPixels, changedBounds: bounds, sideChanges };
}

async function main() {
  const sourcePath = ensureInside(
    workspaceRoot,
    resolve(workspaceRoot, contract.sourceFrame.relativePath)
  );
  const [sourcePng, sourceIntegrity] = await Promise.all([
    readFile(sourcePath),
    inspectFileIntegrity(sourcePath)
  ]);
  if (
    sourceIntegrity.bytes !== contract.sourceFrame.bytes ||
    sourceIntegrity.sha256 !== contract.sourceFrame.sha256
  ) {
    throw new Error("QA 前横版代表帧完整性不匹配");
  }
  const source = decodePngPixels(sourcePng);
  if (source.width !== contract.width || source.height !== contract.height) {
    throw new Error("横版代表帧不是 1920×1080");
  }

  const sourceDataUrl = `data:image/png;base64,${sourcePng.toString("base64")}`;
  const cleanInputProps = {
    sourceDataUrl,
    size: contract.options[0].size,
    top: contract.anchor.top,
    right: contract.anchor.right,
    guideVisible: false
  };
  const serveUrl = await bundle({ entryPoint: ENTRY_POINT });
  const cleanComposition = await selectComposition({
    serveUrl,
    id: contract.compositionId,
    inputProps: cleanInputProps,
    browserExecutable: CHROME_EXECUTABLE
  });
  const cleanRender = await renderStill({
    serveUrl,
    composition: cleanComposition,
    imageFormat: "png",
    frame: 0,
    inputProps: cleanInputProps,
    browserExecutable: CHROME_EXECUTABLE
  });
  if (!cleanRender.buffer) throw new Error("未得到无框内存基准帧");
  const base = decodePngPixels(cleanRender.buffer);
  if (base.width !== contract.width || base.height !== contract.height) {
    throw new Error("无框内存基准帧不是 1920×1080");
  }

  const outputs = [];
  for (const option of contract.options) {
    const outputPath = ensureInside(candidateDirectory, resolve(candidateDirectory, option.fileName));
    const [outputPng, integrity] = await Promise.all([
      readFile(outputPath),
      inspectFileIntegrity(outputPath)
    ]);
    outputs.push({
      id: option.id,
      fileName: option.fileName,
      integrity,
      ...auditOutput(base, decodePngPixels(outputPng), option)
    });
  }
  if (new Set(outputs.map(({ integrity }) => integrity.sha256)).size !== outputs.length) {
    throw new Error("三张尺寸图哈希没有全部区分");
  }

  const sourceIntegrityAfter = await inspectFileIntegrity(sourcePath);
  if (JSON.stringify(sourceIntegrity) !== JSON.stringify(sourceIntegrityAfter)) {
    throw new Error("QA 期间横版代表帧发生变化");
  }
  const summary = {
    schemaVersion: "visual-system-v1-ai-watermark-size-proof-qa-v1",
    status: "pass",
    reviewOnly: true,
    guideMode: "outline-only",
    canvas: { width: contract.width, height: contract.height },
    sourceIntegrity,
    assertions: {
      outputCount: outputs.length,
      exactDimensions: true,
      hashesDistinct: true,
      cleanReferenceRenderedInMemoryOnly: true,
      pixelsOutsideExpectedOutlineUnchanged: true,
      transparentInteriorUnchanged: true,
      actualAiObjectRendered: false,
      videoGenerated: false
    },
    outputs
  };
  await writeFile(
    resolve(candidateDirectory, "qa-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
