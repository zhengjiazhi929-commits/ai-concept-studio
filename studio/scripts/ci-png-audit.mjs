import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paethPredictor(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function assertChunkBounds(png, offset, chunkLength) {
  if (offset + 12 + chunkLength > png.length) {
    throw new Error("PNG chunk 越界");
  }
}

export function decodePngPixels(pngBytes) {
  const png = Buffer.isBuffer(pngBytes) ? pngBytes : Buffer.from(pngBytes ?? []);
  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("不是有效 PNG");
  }
  let offset = PNG_SIGNATURE.length;
  let header = null;
  const imageDataChunks = [];
  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error("PNG chunk 头不完整");
    const chunkLength = png.readUInt32BE(offset);
    assertChunkBounds(png, offset, chunkLength);
    const chunkType = png.toString("ascii", offset + 4, offset + 8);
    const chunkData = png.subarray(offset + 8, offset + 8 + chunkLength);
    if (chunkType === "IHDR") {
      if (chunkData.length !== 13) throw new Error("PNG IHDR 长度无效");
      header = {
        width: chunkData.readUInt32BE(0),
        height: chunkData.readUInt32BE(4),
        bitDepth: chunkData[8],
        colorType: chunkData[9],
        compression: chunkData[10],
        filter: chunkData[11],
        interlace: chunkData[12]
      };
    } else if (chunkType === "IDAT") {
      imageDataChunks.push(chunkData);
    } else if (chunkType === "IEND") {
      break;
    }
    offset += 12 + chunkLength;
  }
  if (
    !header ||
    !Number.isInteger(header.width) ||
    !Number.isInteger(header.height) ||
    header.width < 1 ||
    header.height < 1 ||
    header.width > 10_000 ||
    header.height > 10_000 ||
    header.bitDepth !== 8 ||
    ![2, 6].includes(header.colorType) ||
    header.compression !== 0 ||
    header.filter !== 0 ||
    header.interlace !== 0 ||
    imageDataChunks.length === 0
  ) {
    throw new Error(`不支持的 PNG 格式：${JSON.stringify(header)}`);
  }

  const channels = header.colorType === 6 ? 4 : 3;
  const stride = header.width * channels;
  const inflated = inflateSync(Buffer.concat(imageDataChunks));
  const expectedInflatedLength = header.height * (stride + 1);
  if (inflated.length !== expectedInflatedLength) {
    throw new Error(
      `PNG 解压长度不匹配：期望 ${expectedInflatedLength}，实际 ${inflated.length}`
    );
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
      const upperLeft = row > 0 && column >= channels
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

export function auditPngFrame(pngBytes, options = {}) {
  const decoded = decodePngPixels(pngBytes);
  if (
    Number.isInteger(options.expectedWidth) &&
    decoded.width !== options.expectedWidth
  ) {
    throw new Error(`PNG 宽度不匹配：期望 ${options.expectedWidth}，实际 ${decoded.width}`);
  }
  if (
    Number.isInteger(options.expectedHeight) &&
    decoded.height !== options.expectedHeight
  ) {
    throw new Error(`PNG 高度不匹配：期望 ${options.expectedHeight}，实际 ${decoded.height}`);
  }

  const colors = new Set();
  let visiblePixels = 0;
  let nonBlackPixels = 0;
  let litPixels = 0;
  for (let offset = 0; offset < decoded.pixels.length; offset += 4) {
    const red = decoded.pixels[offset];
    const green = decoded.pixels[offset + 1];
    const blue = decoded.pixels[offset + 2];
    const alpha = decoded.pixels[offset + 3];
    if (alpha > 0) {
      colors.add((((red * 256 + green) * 256 + blue) * 256) + alpha);
      visiblePixels += 1;
      if (red > 0 || green > 0 || blue > 0) nonBlackPixels += 1;
      const luminance = (red * 2126 + green * 7152 + blue * 722) / 10_000;
      if (luminance >= 16) litPixels += 1;
    }
  }
  if (visiblePixels === 0) throw new Error("PNG 全透明");
  if (nonBlackPixels === 0) throw new Error("PNG 全黑");
  if (colors.size < 2) throw new Error("PNG 是单色帧");
  const nonBlackPixelRatio = nonBlackPixels / visiblePixels;
  const litPixelRatio = litPixels / visiblePixels;
  const minimumLitPixelRatio = options.minimumLitPixelRatio ?? 0.01;
  if (litPixelRatio < minimumLitPixelRatio) {
    throw new Error(
      `PNG 有效亮度面积过小：${litPixelRatio.toFixed(6)} < ${minimumLitPixelRatio}`
    );
  }
  return {
    width: decoded.width,
    height: decoded.height,
    visiblePixels,
    nonBlackPixels,
    litPixels,
    nonBlackPixelRatio,
    litPixelRatio,
    uniqueColors: colors.size,
    pixelSha256: createHash("sha256").update(decoded.pixels).digest("hex")
  };
}

export function auditPngFrameSet(frameBuffers, options = {}) {
  if (!Array.isArray(frameBuffers) || frameBuffers.length < 2) {
    throw new Error("CI render smoke 至少需要两帧代表帧");
  }
  const frames = frameBuffers.map(({ frame, bytes }) => ({
    frame,
    ...auditPngFrame(bytes, options)
  }));
  const distinctFrameCount = new Set(frames.map(({ pixelSha256 }) => pixelSha256)).size;
  if (distinctFrameCount !== frames.length) {
    throw new Error(
      `CI render smoke 代表帧没有全部发生变化：${distinctFrameCount}/${frames.length}`
    );
  }
  return { frames, distinctFrameCount };
}
