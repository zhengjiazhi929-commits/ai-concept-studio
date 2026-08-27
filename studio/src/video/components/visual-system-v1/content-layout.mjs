const ROUNDING_DIGITS = 4;
const FIT_TOLERANCE_PX = 0.0001;

export const VISUAL_SYSTEM_V1_CONTENT_LAYOUT_UNFIT = "visual-system-v1-content-layout-unfit";

export const VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS = deepFreeze({
  labelFontSizePx: 32,
  detailFontSizePx: 20,
  labelLetterSpacingPx: -0.8,
  detailLetterSpacingPx: 0,
  horizontalPaddingPx: 26,
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
  const horizontalChromePx = leadingOccupancyPx + trailingOccupancyPx;
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

export function visualSystemV1PackContentCards({
  items,
  safeArea,
  gapPx = VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.gapPx,
  rowGapPx = VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.rowGapPx,
  rowHeightPx = VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.rowHeightPx,
  maximumRows = VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.maximumRows,
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
  if (!Number.isInteger(maximumRows) || maximumRows < 1 || maximumRows > 2) {
    throw new TypeError("maximumRows 只能是 1 或 2");
  }

  const area = normalizeSafeArea(safeArea);
  const metrics = items.map((item) => visualSystemV1ContentCardMetrics(item, cardOptions));
  const selectedRows = chooseRows(metrics, area.width, gapPx, maximumRows);
  if (!selectedRows) {
    unfit(
      "卡片标题的单行最小宽度无法在最多两行内放入安全区，请减少同屏内容或拆分画面",
      {
        reason: "minimum-width-overflow",
        safeWidthPx: area.width,
        maximumRows,
        requiredMinimumWidthPx: rowWidthAt(metrics, "minWidth", gapPx),
        items: metrics.map((item) => ({ id: item.id, minWidth: item.minWidth }))
      }
    );
  }

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
    for (let column = 0; column < row.items.length; column += 1) {
      const item = row.items[column];
      const width = row.widths[column];
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
        shrinkPx: round(item.preferredWidth - width),
        labelLayout: item.labelLayout
      };
      cards.push(deepFreeze(card));
      rowCardIds.push(item.id);
      cursorPx += width + gapPx;
    }
    return deepFreeze({
      index: rowIndex,
      itemIds: rowCardIds,
      left: round(rowLeftPx),
      top: round(topPx),
      width: round(occupiedWidthPx),
      height: round(rowHeightPx),
      right: round(rowLeftPx + occupiedWidthPx),
      bottom: round(topPx + rowHeightPx),
      totalShrinkPx: round(row.totalShrinkPx)
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
    rowCount: rows.length,
    rows,
    cards,
    metrics,
    labelLayout: VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.labelLayout
  });
}
