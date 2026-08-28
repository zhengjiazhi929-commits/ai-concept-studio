import { VISUAL_SYSTEM_V1 } from "./tokens.mjs";
import { aiTechIconSize } from "../../../shared/ai-tech-icon-contract.mjs";

const ROUNDING_DIGITS = 4;
const FIT_TOLERANCE_PX = 0.0001;

export const VISUAL_SYSTEM_V1_CONTENT_LAYOUT_UNFIT = "visual-system-v1-content-layout-unfit";

export const VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS = deepFreeze({
  labelFontSizePx: 32,
  detailFontSizePx: 20,
  labelLetterSpacingPx: -0.8,
  detailLetterSpacingPx: 0,
  horizontalPaddingPx: 26,
  horizontalBorderPx: 6,
  minimumCardWidthPx: 180,
  labelSafetyPx: 4,
  gapPx: 32,
  rowGapPx: 32,
  rowHeightPx: 116,
  maximumRows: 2,
  labelLayout: {
    whiteSpace: "nowrap",
    wordBreak: "keep-all",
    overflowWrap: "normal"
  }
});

export const VISUAL_SYSTEM_V1_SEMANTIC_ICON_NODE_DEFAULTS = deepFreeze({
  iconSizePx: aiTechIconSize("support").sizePx,
  labelFontSizePx: 30,
  detailFontSizePx: 20,
  labelLetterSpacingPx: -0.6,
  detailLetterSpacingPx: -0.2,
  labelLineHeight: 1.06,
  detailLineHeight: 1.2,
  gapPx: 18,
  detailGapPx: 7,
  horizontalPaddingPx: 18,
  verticalPaddingPx: 14
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function round(value) {
  return Number(value.toFixed(ROUNDING_DIGITS));
}

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label}必须是有限数值`);
  }
  return value;
}

function finitePositive(value, label) {
  finiteNumber(value, label);
  if (value <= 0) throw new TypeError(`${label}必须大于 0`);
  return value;
}

function finiteNonNegative(value, label) {
  finiteNumber(value, label);
  if (value < 0) throw new TypeError(`${label}不能小于 0`);
  return value;
}

function finiteRatio(value, label) {
  finiteNumber(value, label);
  if (value < 0 || value > 1) throw new TypeError(`${label}必须在 0 到 1 之间`);
  return value;
}

function optionalFinite(value, fallback, label) {
  if (value === undefined) return fallback;
  return finiteNumber(value, label);
}

function optionalPositive(value, fallback, label) {
  if (value === undefined) return fallback;
  return finitePositive(value, label);
}

function optionalNonNegative(value, fallback, label) {
  if (value === undefined) return fallback;
  return finiteNonNegative(value, label);
}

function isCodePointIn(codePoint, start, end) {
  return codePoint >= start && codePoint <= end;
}

function isFullWidthContent(codePoint) {
  return (
    isCodePointIn(codePoint, 0x2e80, 0x303f) ||
    isCodePointIn(codePoint, 0x3040, 0x30ff) ||
    isCodePointIn(codePoint, 0x3100, 0x312f) ||
    isCodePointIn(codePoint, 0x31a0, 0x31bf) ||
    isCodePointIn(codePoint, 0x3400, 0x4dbf) ||
    isCodePointIn(codePoint, 0x4e00, 0x9fff) ||
    isCodePointIn(codePoint, 0xac00, 0xd7af) ||
    isCodePointIn(codePoint, 0xf900, 0xfaff) ||
    isCodePointIn(codePoint, 0xff01, 0xff60) ||
    isCodePointIn(codePoint, 0xffe0, 0xffe6) ||
    isCodePointIn(codePoint, 0x1f000, 0x1faff) ||
    isCodePointIn(codePoint, 0x20000, 0x2fa1f)
  );
}

function codePointWidthUnits(character) {
  const codePoint = character.codePointAt(0);
  if (
    codePoint === 0x200d ||
    isCodePointIn(codePoint, 0xfe00, 0xfe0f) ||
    /\p{Mark}/u.test(character)
  ) {
    return 0;
  }
  if (isFullWidthContent(codePoint)) return 1;
  if (/\s/u.test(character)) return 0.32;
  if (/[A-Z]/u.test(character)) return 0.68;
  if (/[a-z0-9]/u.test(character)) return 0.56;
  if (/[&@%#]/u.test(character)) return 0.72;
  if (/[.,:;!?'"`~\-_/\\|()[\]{}<>+*=]/u.test(character)) return 0.34;
  if (character === "·" || character === "•" || character === "—") return 0.46;
  if (/\p{Letter}|\p{Number}/u.test(character)) return 0.62;
  return 0.72;
}

function contentCharacters(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label}必须是字符串`);
  return Array.from(value);
}

export function visualSystemV1ContentTextWidthUnits(text) {
  const characters = contentCharacters(text, "待测文本");
  return round(characters.reduce((total, character) => total + codePointWidthUnits(character), 0));
}

export function visualSystemV1EstimateContentTextWidthPx(text, {
  fontSizePx,
  letterSpacingPx = 0
} = {}) {
  finitePositive(fontSizePx, "文字字号");
  finiteNumber(letterSpacingPx, "字间距");
  const characters = contentCharacters(text, "待测文本");
  const glyphWidth = characters.reduce(
    (total, character) => total + codePointWidthUnits(character) * fontSizePx,
    0
  );
  const spacingWidth = Math.max(0, characters.length - 1) * letterSpacingPx;
  return round(Math.max(0, glyphWidth + spacingWidth));
}

export function visualSystemV1SemanticIconNodeMetrics({
  id = "semantic-icon-node",
  label,
  detail = "",
  anchorGeometry,
  iconSizePx = VISUAL_SYSTEM_V1_SEMANTIC_ICON_NODE_DEFAULTS.iconSizePx
} = {}) {
  contentCharacters(label, `${id} 的标题`);
  contentCharacters(detail, `${id} 的详情`);
  finitePositive(iconSizePx, `${id} 的图标尺寸`);
  if (!anchorGeometry || typeof anchorGeometry !== "object" || Array.isArray(anchorGeometry)) {
    throw new TypeError(`${id} 的 anchorGeometry 必须是对象`);
  }
  const anchorX = anchorGeometry.x ?? anchorGeometry.left;
  const anchorY = anchorGeometry.y ?? anchorGeometry.top;
  finiteNumber(anchorX, `${id} 的 anchorGeometry.x`);
  finiteNumber(anchorY, `${id} 的 anchorGeometry.y`);
  const anchorWidth = finitePositive(anchorGeometry.width, `${id} 的 anchorGeometry.width`);
  const anchorHeight = finitePositive(anchorGeometry.height, `${id} 的 anchorGeometry.height`);
  const defaults = VISUAL_SYSTEM_V1_SEMANTIC_ICON_NODE_DEFAULTS;
  const labelTextWidthPx = visualSystemV1EstimateContentTextWidthPx(label, {
    fontSizePx: defaults.labelFontSizePx,
    letterSpacingPx: defaults.labelLetterSpacingPx
  });
  const detailTextWidthPx = detail.length === 0
    ? 0
    : visualSystemV1EstimateContentTextWidthPx(detail, {
      fontSizePx: defaults.detailFontSizePx,
      letterSpacingPx: defaults.detailLetterSpacingPx
    });
  const textWidthPx = Math.max(labelTextWidthPx, detailTextWidthPx);
  const textHeightPx = defaults.labelFontSizePx * defaults.labelLineHeight + (
    detail.length === 0
      ? 0
      : defaults.detailGapPx + defaults.detailFontSizePx * defaults.detailLineHeight
  );
  const requiredWidthPx = defaults.horizontalPaddingPx * 2 + iconSizePx +
    defaults.gapPx + textWidthPx;
  const requiredHeightPx = defaults.verticalPaddingPx * 2 +
    Math.max(iconSizePx, textHeightPx);
  const connectorWidthPx = Math.min(anchorWidth, requiredWidthPx);
  const connectorHeightPx = Math.min(anchorHeight, requiredHeightPx);
  const anchorCenterX = anchorX + anchorWidth / 2;
  const anchorCenterY = anchorY + anchorHeight / 2;
  const x = round(anchorCenterX - connectorWidthPx / 2);
  const y = round(anchorCenterY - connectorHeightPx / 2);
  const width = round(connectorWidthPx);
  const height = round(connectorHeightPx);
  const connectorGeometry = deepFreeze({
    x,
    y,
    left: x,
    top: y,
    width,
    height,
    right: round(x + width),
    bottom: round(y + height),
    centerX: round(x + width / 2),
    centerY: round(y + height / 2)
  });
  return deepFreeze({
    id,
    iconSizePx: round(iconSizePx),
    labelTextWidthPx,
    detailTextWidthPx,
    textWidthPx: round(textWidthPx),
    requiredWidthPx: round(requiredWidthPx),
    requiredHeightPx: round(requiredHeightPx),
    connectorGeometry,
    fitsAnchor: requiredWidthPx <= anchorWidth + FIT_TOLERANCE_PX &&
      requiredHeightPx <= anchorHeight + FIT_TOLERANCE_PX
  });
}

function normalizeCardConceptKind(value, itemId) {
  if (value === undefined || value === null || value === "none") return "none";
  throw new TypeError(`${itemId} 是文字内容容器，不能为卡片标题预留或嵌入图标`);
}

function normalizeVisualOccupancy(value, itemId) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${itemId} 的 visualOccupancy 必须是对象`);
  }
  return deepFreeze({
    leadingPx: finiteNonNegative(
      value.leadingPx,
      `${itemId} 的 visualOccupancy.leadingPx`
    ),
    trailingPx: finiteNonNegative(
      value.trailingPx,
      `${itemId} 的 visualOccupancy.trailingPx`
    )
  });
}

function contentCardOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("内容卡片尺寸选项必须是对象");
  }
  return {
    labelFontSizePx: optionalPositive(
      options.labelFontSizePx,
      VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.labelFontSizePx,
      "标题字号"
    ),
    detailFontSizePx: optionalPositive(
      options.detailFontSizePx,
      VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.detailFontSizePx,
      "详情字号"
    ),
    labelLetterSpacingPx: optionalFinite(
      options.labelLetterSpacingPx,
      VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.labelLetterSpacingPx,
      "标题字间距"
    ),
    detailLetterSpacingPx: optionalFinite(
      options.detailLetterSpacingPx,
      VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.detailLetterSpacingPx,
      "详情字间距"
    ),
    horizontalPaddingPx: optionalNonNegative(
      options.horizontalPaddingPx,
      VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.horizontalPaddingPx,
      "卡片水平内边距"
    ),
    horizontalBorderPx: optionalNonNegative(
      options.horizontalBorderPx,
      VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.horizontalBorderPx,
      "卡片水平边框占用"
    ),
    minimumCardWidthPx: optionalPositive(
      options.minimumCardWidthPx,
      VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.minimumCardWidthPx,
      "卡片全局最小宽度"
    ),
    labelSafetyPx: optionalNonNegative(
      options.labelSafetyPx,
      VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.labelSafetyPx,
      "标题宽度安全余量"
    )
  };
}

export function visualSystemV1ContentCardMetrics(item, options = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new TypeError("内容卡片必须是对象");
  }
  if (typeof item.id !== "string" || item.id.length === 0) {
    throw new TypeError("内容卡片必须具有非空字符串 id");
  }
  if (typeof item.label !== "string" || item.label.trim().length === 0) {
    throw new TypeError(`${item.id} 的 label 必须是非空字符串`);
  }
  if (item.detail !== undefined && item.detail !== null && typeof item.detail !== "string") {
    throw new TypeError(`${item.id} 的 detail 必须是字符串`);
  }

  const resolved = contentCardOptions(options);
  const conceptKind = normalizeCardConceptKind(item.conceptKind, item.id);
  const visualOccupancy = normalizeVisualOccupancy(item.visualOccupancy, item.id);
  const labelTextWidthPx = visualSystemV1EstimateContentTextWidthPx(item.label, {
    fontSizePx: resolved.labelFontSizePx,
    letterSpacingPx: resolved.labelLetterSpacingPx
  });
  const detail = item.detail ?? "";
  const detailTextWidthPx = detail.length === 0
    ? 0
    : visualSystemV1EstimateContentTextWidthPx(detail, {
        fontSizePx: resolved.detailFontSizePx,
        letterSpacingPx: resolved.detailLetterSpacingPx
      });
  const iconOccupancyPx = 0;
  const leadingOccupancyPx = visualOccupancy?.leadingPx ?? resolved.horizontalPaddingPx;
  const trailingOccupancyPx = visualOccupancy?.trailingPx ?? resolved.horizontalPaddingPx;
  const horizontalChromePx =
    leadingOccupancyPx + trailingOccupancyPx + resolved.horizontalBorderPx;
  const labelRequiredWidthPx = Math.ceil(
    horizontalChromePx + iconOccupancyPx + labelTextWidthPx + resolved.labelSafetyPx
  );
  const detailPreferredWidthPx = Math.ceil(horizontalChromePx + detailTextWidthPx);
  const requestedMinWidth = item.minWidth === undefined
    ? 0
    : finitePositive(item.minWidth, `${item.id} 的 minWidth`);
  const minWidth = Math.ceil(Math.max(
    resolved.minimumCardWidthPx,
    requestedMinWidth,
    labelRequiredWidthPx
  ));
  const requestedPreferredWidth = item.preferredWidth === undefined
    ? 0
    : finitePositive(item.preferredWidth, `${item.id} 的 preferredWidth`);
  const preferredWidth = Math.ceil(Math.max(
    minWidth,
    requestedPreferredWidth,
    detailPreferredWidthPx
  ));

  return deepFreeze({
    id: item.id,
    label: item.label,
    detail,
    conceptKind,
    hasIcon: false,
    iconOccupancyPx,
    horizontalBorderPx: resolved.horizontalBorderPx,
    visualOccupancy,
    leadingOccupancyPx,
    trailingOccupancyPx,
    horizontalChromePx,
    labelTextWidthPx,
    detailTextWidthPx,
    labelRequiredWidthPx,
    detailPreferredWidthPx,
    minWidth,
    preferredWidth,
    shrinkCapacityPx: preferredWidth - minWidth,
    labelLayout: VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.labelLayout
  });
}

/**
 * Mirrors the semantic-node CSS box model so layout validation measures the
 * text that will actually render, including borders, adaptive compact type,
 * wrapping, markers and vertical padding. This deliberately fails closed:
 * a declared node rectangle is not considered safe merely because it does
 * not overlap another declared rectangle.
 */
export function visualSystemV1SemanticTextBoxMetrics({
  id,
  label,
  detail = "",
  marker = null,
  surfaceRole,
  textWrapMode = "break-word",
  width,
  height,
  typographyProfile = "standard"
}) {
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("语义文字盒必须具有非空字符串 id");
  }
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new TypeError(`${id} 的语义文字盒 label 必须是非空字符串`);
  }
  if (typeof detail !== "string") throw new TypeError(`${id} 的 detail 必须是字符串`);
  if (!["information-card", "open-canvas"].includes(surfaceRole)) {
    throw new TypeError(`${id} 的 surfaceRole 不受支持：${surfaceRole}`);
  }
  if (!["break-word", "phrase-safe"].includes(textWrapMode)) {
    throw new TypeError(`${id} 的 textWrapMode 不受支持：${textWrapMode}`);
  }
  finitePositive(width, `${id} 的文字盒宽度`);
  finitePositive(height, `${id} 的文字盒高度`);
  const semanticTypography = VISUAL_SYSTEM_V1.semanticNode[typographyProfile];
  if (!semanticTypography || typographyProfile === "marker") {
    throw new TypeError(`${id} 的 typographyProfile 不受支持：${typographyProfile}`);
  }

  const informationCard = surfaceRole === "information-card";
  const compactInformationCard = informationCard &&
    height < semanticTypography.informationCard.compactHeightThresholdPx;
  const labelFontSizePx = informationCard
    ? compactInformationCard
      ? semanticTypography.informationCard.compactLabelFontSizePx
      : semanticTypography.informationCard.labelFontSizePx
    : Math.max(
        semanticTypography.openCanvas.minimumLabelFontSizePx,
        Math.min(semanticTypography.openCanvas.maximumLabelFontSizePx, height * 0.3, width * 0.12)
      );
  const detailFontSizePx = informationCard
    ? compactInformationCard
      ? semanticTypography.informationCard.compactDetailFontSizePx
      : semanticTypography.informationCard.detailFontSizePx
    : Math.max(
        semanticTypography.openCanvas.minimumDetailFontSizePx,
        Math.min(semanticTypography.openCanvas.maximumDetailFontSizePx, height * 0.19, width * 0.068)
      );
  const horizontalPaddingPx = informationCard
    ? semanticTypography.informationCard.horizontalPaddingPx
    : Math.max(18, Math.min(semanticTypography.openCanvas.horizontalPaddingPx, width * 0.07));
  const verticalPaddingPx = compactInformationCard
    ? semanticTypography.informationCard.compactVerticalPaddingPx
    : Math.max(informationCard ? 7 : 10, Math.min(26, height * 0.1));
  const borderWidthPx = informationCard ? 3 : 0;
  const availableWidthPx = width - horizontalPaddingPx * 2 - borderWidthPx * 2;
  const availableHeightPx = height - verticalPaddingPx * 2 - borderWidthPx * 2;
  const labelTextWidthPx = visualSystemV1EstimateContentTextWidthPx(label, {
    fontSizePx: labelFontSizePx,
    letterSpacingPx: semanticTypography.labelLetterSpacingPx
  });
  const detailTextWidthPx = detail.length === 0
    ? 0
    : visualSystemV1EstimateContentTextWidthPx(detail, { fontSizePx: detailFontSizePx });
  const wrappedLineCount = (textWidthPx, forceSingleLine = false) => {
    if (textWidthPx <= 0) return 0;
    if (forceSingleLine) return 1;
    if (availableWidthPx <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(1, Math.ceil((textWidthPx - FIT_TOLERANCE_PX) / availableWidthPx));
  };
  const labelLineCount = wrappedLineCount(labelTextWidthPx, informationCard);
  const detailLineCount = wrappedLineCount(detailTextWidthPx, false);
  const markerVisible = Boolean(marker) &&
    height >= VISUAL_SYSTEM_V1.semanticNode.marker.minimumContainerHeightPx;
  const markerHeightPx = markerVisible
    ? VISUAL_SYSTEM_V1.semanticNode.marker.fontSizePx * 1.1 + 7
    : 0;
  const requiredContentHeightPx =
    markerHeightPx +
    labelLineCount * labelFontSizePx * 1.08 +
    (detailLineCount > 0
      ? 7 + detailLineCount * detailFontSizePx * semanticTypography.detailLineHeight
      : 0);
  const labelFitsWidth = !informationCard ||
    labelTextWidthPx <= availableWidthPx + FIT_TOLERANCE_PX;
  const fitsHeight = requiredContentHeightPx <= availableHeightPx + FIT_TOLERANCE_PX;

  return deepFreeze({
    id,
    typographyProfile,
    informationCard,
    compactInformationCard,
    textWrapMode,
    markerVisible,
    labelFontSizePx: round(labelFontSizePx),
    detailFontSizePx: round(detailFontSizePx),
    horizontalPaddingPx: round(horizontalPaddingPx),
    verticalPaddingPx: round(verticalPaddingPx),
    borderWidthPx,
    availableWidthPx: round(availableWidthPx),
    availableHeightPx: round(availableHeightPx),
    labelTextWidthPx,
    detailTextWidthPx,
    labelLineCount,
    detailLineCount,
    requiredContentHeightPx: round(requiredContentHeightPx),
    labelFitsWidth,
    fitsHeight,
    fits: availableWidthPx > 0 && availableHeightPx > 0 && labelFitsWidth && fitsHeight
  });
}

function normalizeSafeArea(safeArea) {
  if (!safeArea || typeof safeArea !== "object" || Array.isArray(safeArea)) {
    throw new TypeError("内容布局必须提供 safeArea");
  }
  const left = safeArea.left ?? safeArea.x;
  const top = safeArea.top ?? safeArea.y;
  finiteNumber(left, "safeArea.left");
  finiteNumber(top, "safeArea.top");
  const width = safeArea.width ?? (
    Number.isFinite(safeArea.right) ? safeArea.right - left : undefined
  );
  const height = safeArea.height ?? (
    Number.isFinite(safeArea.bottom) ? safeArea.bottom - top : undefined
  );
  finitePositive(width, "safeArea.width");
  finitePositive(height, "safeArea.height");
  const right = left + width;
  const bottom = top + height;
  if (Number.isFinite(safeArea.right) && Math.abs(safeArea.right - right) > FIT_TOLERANCE_PX) {
    throw new TypeError("safeArea.right 与 left + width 不一致");
  }
  if (Number.isFinite(safeArea.bottom) && Math.abs(safeArea.bottom - bottom) > FIT_TOLERANCE_PX) {
    throw new TypeError("safeArea.bottom 与 top + height 不一致");
  }
  return deepFreeze({
    x: round(left),
    y: round(top),
    left: round(left),
    top: round(top),
    width: round(width),
    height: round(height),
    right: round(right),
    bottom: round(bottom)
  });
}

function unfit(message, details) {
  const error = new RangeError(message);
  error.code = VISUAL_SYSTEM_V1_CONTENT_LAYOUT_UNFIT;
  error.details = deepFreeze(details);
  throw error;
}

function rowWidthAt(items, widthKey, gapPx) {
  if (items.length === 0) return 0;
  return items.reduce((total, item) => total + item[widthKey], 0) + gapPx * (items.length - 1);
}

function allocateRow(items, availableWidthPx, gapPx) {
  const cardSpacePx = availableWidthPx - gapPx * Math.max(0, items.length - 1);
  const totalMinWidthPx = items.reduce((total, item) => total + item.minWidth, 0);
  if (totalMinWidthPx - cardSpacePx > FIT_TOLERANCE_PX) return null;

  const totalPreferredWidthPx = items.reduce((total, item) => total + item.preferredWidth, 0);
  if (totalPreferredWidthPx <= cardSpacePx + FIT_TOLERANCE_PX) {
    return {
      widths: items.map((item) => item.preferredWidth),
      totalShrinkPx: 0
    };
  }

  const shrinkRequiredPx = totalPreferredWidthPx - cardSpacePx;
  const totalShrinkCapacityPx = items.reduce(
    (total, item) => total + item.shrinkCapacityPx,
    0
  );
  if (shrinkRequiredPx - totalShrinkCapacityPx > FIT_TOLERANCE_PX) return null;

  let remainingWidthPx = cardSpacePx;
  let remainingShrinkCapacityPx = totalShrinkCapacityPx;
  const widths = items.map((item, index) => {
    if (index === items.length - 1) return remainingWidthPx;
    const proportionalShrinkPx = remainingShrinkCapacityPx <= FIT_TOLERANCE_PX
      ? 0
      : shrinkRequiredPx * (item.shrinkCapacityPx / totalShrinkCapacityPx);
    const width = Math.max(item.minWidth, item.preferredWidth - proportionalShrinkPx);
    remainingWidthPx -= width;
    remainingShrinkCapacityPx -= item.shrinkCapacityPx;
    return width;
  });
  if (widths.some((width, index) => width + FIT_TOLERANCE_PX < items[index].minWidth)) {
    return null;
  }
  return { widths, totalShrinkPx: shrinkRequiredPx };
}

function allocationScore(rows, gapPx) {
  const shrink = rows.reduce((total, row) => total + row.totalShrinkPx, 0);
  const occupied = rows.map((row) => row.widths.reduce((total, width) => total + width, 0) +
    gapPx * Math.max(0, row.widths.length - 1));
  return [
    round(shrink),
    round(Math.abs(occupied[0] - occupied[1])),
    Math.abs(rows[0].items.length - rows[1].items.length),
    rows[0].items.length
  ];
}

function compareScores(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function chooseRows(items, safeWidthPx, gapPx, maximumRows) {
  const singleAllocation = allocateRow(items, safeWidthPx, gapPx);
  if (singleAllocation) {
    return [{ items, ...singleAllocation }];
  }
  if (maximumRows === 1 || items.length < 2) return null;

  const candidates = [];
  for (let splitIndex = 1; splitIndex < items.length; splitIndex += 1) {
    const firstItems = items.slice(0, splitIndex);
    const secondItems = items.slice(splitIndex);
    const firstAllocation = allocateRow(firstItems, safeWidthPx, gapPx);
    const secondAllocation = allocateRow(secondItems, safeWidthPx, gapPx);
    if (!firstAllocation || !secondAllocation) continue;
    const rows = [
      { items: firstItems, ...firstAllocation },
      { items: secondItems, ...secondAllocation }
    ];
    candidates.push({ rows, score: allocationScore(rows, gapPx) });
  }
  candidates.sort((left, right) => compareScores(left.score, right.score));
  return candidates[0]?.rows ?? null;
}

function normalizeExplicitRowGroups(metrics, rowGroups) {
  if (rowGroups == null) return null;
  if (!Array.isArray(rowGroups) || rowGroups.length === 0 || rowGroups.length > 3) {
    throw new TypeError("rowGroups 必须是 1 到 3 个非空语义行");
  }
  const knownIds = new Set(metrics.map((item) => item.id));
  const flattened = rowGroups.flatMap((row, rowIndex) => {
    if (!Array.isArray(row) || row.length === 0) {
      throw new TypeError(`rowGroups[${rowIndex}] 必须是非空数组`);
    }
    return row;
  });
  if (
    flattened.some((id) => typeof id !== "string" || !knownIds.has(id)) ||
    new Set(flattened).size !== flattened.length ||
    flattened.length !== metrics.length
  ) {
    throw new TypeError("rowGroups 必须无重复、无遗漏地覆盖全部内容卡片 id");
  }
  return rowGroups.map((row) => row.map((id) =>
    metrics.find((item) => item.id === id)
  ));
}

function normalizeRowDirections(rowCount, rowDirections) {
  if (rowDirections == null) return Array.from({ length: rowCount }, () => "ltr");
  if (
    !Array.isArray(rowDirections) ||
    rowDirections.length !== rowCount ||
    rowDirections.some((direction) => !["ltr", "rtl"].includes(direction))
  ) {
    throw new TypeError("rowDirections 必须逐行声明 ltr 或 rtl");
  }
  return [...rowDirections];
}

function expandRowToTarget({
  row,
  safeWidthPx,
  gapPx,
  targetRowFillRatio,
  maximumCardWidthPx,
  singletonMaximumWidthPx
}) {
  const widths = [...row.widths];
  const occupiedWidthPx = widths.reduce((total, width) => total + width, 0) +
    gapPx * Math.max(0, widths.length - 1);
  const targetWidthPx = Math.min(safeWidthPx, safeWidthPx * targetRowFillRatio);
  let remainingExpandPx = Math.max(0, targetWidthPx - occupiedWidthPx);
  const perCardMaximum = widths.length === 1
    ? singletonMaximumWidthPx
    : maximumCardWidthPx;
  const capacities = widths.map((width) => Math.max(0, perCardMaximum - width));
  const totalCapacityPx = capacities.reduce((total, capacity) => total + capacity, 0);
  remainingExpandPx = Math.min(remainingExpandPx, totalCapacityPx);
  const requestedExpandPx = remainingExpandPx;
  let active = capacities.map((capacity, index) => ({ capacity, index }))
    .filter((item) => item.capacity > FIT_TOLERANCE_PX);
  while (remainingExpandPx > FIT_TOLERANCE_PX && active.length > 0) {
    const evenSharePx = remainingExpandPx / active.length;
    let appliedPx = 0;
    const nextActive = [];
    for (const item of active) {
      const addedPx = Math.min(item.capacity, evenSharePx);
      widths[item.index] += addedPx;
      item.capacity -= addedPx;
      appliedPx += addedPx;
      if (item.capacity > FIT_TOLERANCE_PX) nextActive.push(item);
    }
    if (appliedPx <= FIT_TOLERANCE_PX) break;
    remainingExpandPx -= appliedPx;
    active = nextActive;
  }
  return {
    ...row,
    widths,
    totalExpandPx: requestedExpandPx - Math.max(0, remainingExpandPx)
  };
}

export function visualSystemV1PackContentCards({
  items,
  safeArea,
  gapPx = VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.gapPx,
  rowGapPx = VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.rowGapPx,
  rowHeightPx = VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.rowHeightPx,
  maximumRows = VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.maximumRows,
  rowGroups = null,
  rowDirections = null,
  targetRowFillRatio = 0,
  maximumCardWidthPx = Number.POSITIVE_INFINITY,
  singletonMaximumWidthPx = maximumCardWidthPx,
  cardOptions = {}
} = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError("内容布局 items 必须是非空数组");
  }
  const ids = items.map((item) => item?.id);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("内容布局卡片 id 不能重复");
  }
  finiteNonNegative(gapPx, "卡片水平间距");
  finiteNonNegative(rowGapPx, "卡片行间距");
  finitePositive(rowHeightPx, "卡片行高");
  if (!Number.isInteger(maximumRows) || maximumRows < 1 || maximumRows > 3) {
    throw new TypeError("maximumRows 只能是 1、2 或 3");
  }
  finiteRatio(targetRowFillRatio, "目标行宽占比");
  if (maximumCardWidthPx !== Number.POSITIVE_INFINITY) {
    finitePositive(maximumCardWidthPx, "卡片最大宽度");
  }
  if (singletonMaximumWidthPx !== Number.POSITIVE_INFINITY) {
    finitePositive(singletonMaximumWidthPx, "单卡行最大宽度");
  }

  const area = normalizeSafeArea(safeArea);
  const metrics = items.map((item) => visualSystemV1ContentCardMetrics(item, cardOptions));
  const explicitGroups = normalizeExplicitRowGroups(metrics, rowGroups);
  let selectedRows = explicitGroups == null
    ? chooseRows(metrics, area.width, gapPx, maximumRows)
    : explicitGroups.map((rowItems) => {
        const allocation = allocateRow(rowItems, area.width, gapPx);
        return allocation ? { items: rowItems, ...allocation } : null;
      });
  if (Array.isArray(selectedRows) && selectedRows.some((row) => row == null)) {
    selectedRows = null;
  }
  if (!selectedRows) {
    unfit(
      `卡片标题的单行最小宽度无法在最多 ${maximumRows} 行内放入安全区，请减少同屏内容或拆分画面`,
      {
        reason: "minimum-width-overflow",
        safeWidthPx: area.width,
        maximumRows,
        requiredMinimumWidthPx: rowWidthAt(metrics, "minWidth", gapPx),
        items: metrics.map((item) => ({ id: item.id, minWidth: item.minWidth }))
      }
    );
  }
  const resolvedRowDirections = normalizeRowDirections(selectedRows.length, rowDirections);
  selectedRows = selectedRows.map((row) => expandRowToTarget({
    row,
    safeWidthPx: area.width,
    gapPx,
    targetRowFillRatio,
    maximumCardWidthPx,
    singletonMaximumWidthPx
  }));

  const groupHeightPx = selectedRows.length * rowHeightPx +
    Math.max(0, selectedRows.length - 1) * rowGapPx;
  if (groupHeightPx - area.height > FIT_TOLERANCE_PX) {
    unfit(
      "卡片行高无法放入安全区，请减小行高、增加安全区或拆分画面",
      {
        reason: "row-height-overflow",
        safeHeightPx: area.height,
        requiredHeightPx: groupHeightPx,
        rows: selectedRows.length
      }
    );
  }

  const groupTopPx = area.top + (area.height - groupHeightPx) / 2;
  const cards = [];
  const rows = selectedRows.map((row, rowIndex) => {
    const occupiedWidthPx = row.widths.reduce((total, width) => total + width, 0) +
      gapPx * Math.max(0, row.items.length - 1);
    const rowLeftPx = area.left + (area.width - occupiedWidthPx) / 2;
    const topPx = groupTopPx + rowIndex * (rowHeightPx + rowGapPx);
    let cursorPx = rowLeftPx;
    const rowCardIds = [];
    const allocatedItems = row.items.map((item, index) => ({ item, width: row.widths[index] }));
    const visualItems = resolvedRowDirections[rowIndex] === "rtl"
      ? [...allocatedItems].reverse()
      : allocatedItems;
    for (let column = 0; column < visualItems.length; column += 1) {
      const { item, width } = visualItems[column];
      const card = {
        id: item.id,
        index: metrics.findIndex((candidate) => candidate.id === item.id),
        row: rowIndex,
        column,
        left: round(cursorPx),
        top: round(topPx),
        width: round(width),
        height: round(rowHeightPx),
        right: round(cursorPx + width),
        bottom: round(topPx + rowHeightPx),
        minWidth: item.minWidth,
        preferredWidth: item.preferredWidth,
        shrinkPx: round(Math.max(0, item.preferredWidth - width)),
        expandPx: round(Math.max(0, width - item.preferredWidth)),
        labelLayout: item.labelLayout
      };
      cards.push(deepFreeze(card));
      rowCardIds.push(item.id);
      cursorPx += width + gapPx;
    }
    return deepFreeze({
      index: rowIndex,
      itemIds: rowCardIds,
      semanticItemIds: row.items.map((item) => item.id),
      direction: resolvedRowDirections[rowIndex],
      left: round(rowLeftPx),
      top: round(topPx),
      width: round(occupiedWidthPx),
      height: round(rowHeightPx),
      right: round(rowLeftPx + occupiedWidthPx),
      bottom: round(topPx + rowHeightPx),
      totalShrinkPx: round(row.totalShrinkPx),
      totalExpandPx: round(row.totalExpandPx)
    });
  });

  cards.sort((left, right) => left.index - right.index);
  return deepFreeze({
    mode: "content-driven-nowrap-row-pack",
    safeArea: area,
    gapPx: round(gapPx),
    rowGapPx: round(rowGapPx),
    rowHeightPx: round(rowHeightPx),
    maximumRows,
    rowLayoutMode: explicitGroups == null ? "automatic" : "explicit-semantic-rows",
    targetRowFillRatio: round(targetRowFillRatio),
    maximumCardWidthPx,
    singletonMaximumWidthPx,
    rowCount: rows.length,
    rows,
    cards,
    metrics,
    labelLayout: VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.labelLayout
  });
}
