import { VISUAL_SYSTEM_V1 } from "./tokens.mjs";

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function parseHexColor(color) {
  const match = /^#([0-9a-f]{6})$/iu.exec(color);
  if (!match) throw new TypeError(`边框颜色必须是六位十六进制：${color}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function visualSystemV1MixHexColors(from, to, progress, alpha = 1) {
  const fromRgb = parseHexColor(from);
  const toRgb = parseHexColor(to);
  const normalizedProgress = clamp01(progress);
  const normalizedAlpha = clamp01(alpha);
  const mixed = fromRgb.map((channel, index) =>
    Math.round(channel + (toRgb[index] - channel) * normalizedProgress)
  );
  return `rgba(${mixed[0]}, ${mixed[1]}, ${mixed[2]}, ${normalizedAlpha})`;
}

export function visualSystemV1InformationCardSurfaceAtFocus({
  accent = "mint",
  focusProgress = 0,
  variant = "flat"
} = {}) {
  if (!["mint", "purple"].includes(accent)) {
    throw new TypeError(`未知信息卡强调色：${accent}`);
  }
  if (!["flat", "semantic"].includes(variant)) {
    throw new TypeError(`未知信息卡表面变体：${variant}`);
  }
  const { informationCard } = VISUAL_SYSTEM_V1.surfaceBorder;
  const normalizedFocus = clamp01(focusProgress);
  const focusBorder = accent === "purple"
    ? informationCard.purpleFocusColor
    : informationCard.mintFocusColor;
  const focusSurface = accent === "purple"
    ? VISUAL_SYSTEM_V1.palette.purpleSoft
    : VISUAL_SYSTEM_V1.palette.mintSoft;
  const semantic = variant === "semantic";
  const borderFocus = normalizedFocus * (semantic
    ? informationCard.semanticBorderFocusScale
    : 1);
  const surfaceAlpha = semantic
    ? informationCard.semanticSurfaceAlpha
    : informationCard.flatSurfaceAlpha;
  return Object.freeze({
    borderColor: visualSystemV1MixHexColors(
      informationCard.restingColor,
      focusBorder,
      borderFocus
    ),
    backgroundColor: visualSystemV1MixHexColors(
      VISUAL_SYSTEM_V1.palette.paperWarm,
      focusSurface,
      normalizedFocus,
      surfaceAlpha
    )
  });
}
