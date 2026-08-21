import { VISUAL_SYSTEM_V1 } from "./tokens.mjs";

export function visualSystemV1Orientation(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new TypeError("画幅尺寸必须是正数");
  }
  return height > width ? "vertical" : "wide";
}
export function visualSystemV1Layout(width, height) {
  const orientation = visualSystemV1Orientation(width, height);
  const expected = VISUAL_SYSTEM_V1.formats[orientation];
  if (width !== expected.width || height !== expected.height) {
    throw new Error(`visual-system-v1 仅支持 ${expected.width}x${expected.height}，收到 ${width}x${height}`);
  }
  return Object.freeze({
    orientation,
    vertical: orientation === "vertical",
    format: expected,
    window: VISUAL_SYSTEM_V1.window[orientation],
    headlineFontSize: orientation === "vertical"
      ? VISUAL_SYSTEM_V1.typography.headlineVerticalPx
      : VISUAL_SYSTEM_V1.typography.headlineWidePx,
    supportingFontSize: orientation === "vertical"
      ? VISUAL_SYSTEM_V1.typography.supportingVerticalPx
      : VISUAL_SYSTEM_V1.typography.supportingWidePx,
    subtitleFontSize: orientation === "vertical"
      ? VISUAL_SYSTEM_V1.typography.subtitleVerticalPx
      : VISUAL_SYSTEM_V1.typography.subtitleWidePx
  });
}
