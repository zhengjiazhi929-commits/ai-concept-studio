import { VISUAL_SYSTEM_V1 } from "./tokens.mjs";

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function interpolateNumber(from, to, progress) {
  return from + (to - from) * progress;
}

function freezeCard(card) {
  return Object.freeze({
    ...card,
    right: card.left + card.width,
    bottom: card.top + card.height
  });
}

function finiteConstraint(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} 必须是有限数值`);
  }
  return value;
}

function requiredFiniteConstraint(constraints, key, label) {
  if (!Object.hasOwn(constraints, key)) {
    throw new TypeError(`卡片布局缺少${label}约束`);
  }
  return finiteConstraint(constraints[key], undefined, label);
}

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

export function visualSystemV1AdaptiveCardTypography(cardWidth, cardHeight) {
  if (!Number.isFinite(cardWidth) || !Number.isFinite(cardHeight) || cardWidth <= 0 || cardHeight <= 0) {
    throw new TypeError("卡片文字比例需要有效的卡片宽高");
  }
  const policy = VISUAL_SYSTEM_V1.cardTypography;
  const heightProgress = clamp(
    (cardHeight - policy.compactHeightPx) /
      (policy.expandedHeightPx - policy.compactHeightPx),
    0,
    1
  );
  const widthProgress = clamp(
    (cardWidth - policy.compactWidthPx) /
      (policy.wideCompactWidthPx - policy.compactWidthPx),
    0,
    1
  );
  const wideCompactBoost = (1 - heightProgress) * widthProgress;
  const wideExpandedProgress = heightProgress * clamp(
    (cardWidth - policy.wideCompactWidthPx) /
      (policy.expandedWidthPx - policy.wideCompactWidthPx),
    0,
    1
  );
  const responsiveValue = ({
    compactPx,
    expandedPx,
    wideCompactBoostPx = 0,
    wideExpandedBoostPx = 0
  }) =>
    Math.round(
      compactPx +
      (expandedPx - compactPx) * heightProgress +
      wideCompactBoostPx * wideCompactBoost +
      wideExpandedBoostPx * wideExpandedProgress
    );
  const markerFontSizePx = responsiveValue(policy.marker);
  const labelFontSizePx = responsiveValue(policy.label);
  const detailFontSizePx = responsiveValue(policy.detail);
  const markerTitleGapPx = responsiveValue({
    compactPx: policy.spacing.markerTitleCompactPx,
    expandedPx: policy.spacing.markerTitleExpandedPx,
    wideCompactBoostPx: policy.spacing.markerTitleWideCompactBoostPx,
    wideExpandedBoostPx: policy.spacing.markerTitleWideExpandedBoostPx
  });
  const titleDetailGapPx = responsiveValue({
    compactPx: policy.spacing.titleDetailCompactPx,
    expandedPx: policy.spacing.titleDetailExpandedPx,
    wideExpandedBoostPx: policy.spacing.titleDetailWideExpandedBoostPx
  });
  const dotSizePx = responsiveValue({
    compactPx: policy.spacing.dotCompactPx,
    expandedPx: policy.spacing.dotExpandedPx,
    wideExpandedBoostPx: policy.spacing.dotWideExpandedBoostPx
  });
  const dotMarkerGapPx = responsiveValue({
    compactPx: policy.spacing.dotMarkerGapCompactPx,
    expandedPx: policy.spacing.dotMarkerGapExpandedPx,
    wideExpandedBoostPx: policy.spacing.dotMarkerGapWideExpandedBoostPx
  });
  const maximumContentHeightPx =
    markerFontSizePx * policy.marker.lineHeight +
    markerTitleGapPx +
    labelFontSizePx * policy.label.lineHeight * policy.label.maximumLines +
    titleDetailGapPx +
    detailFontSizePx * policy.detail.lineHeight * policy.detail.maximumLines;

  return Object.freeze({
    mode: policy.mode,
    heightProgress,
    widthProgress,
    wideCompactBoost,
    wideExpandedProgress,
    markerFontSizePx,
    labelFontSizePx,
    detailFontSizePx,
    markerTitleGapPx,
    titleDetailGapPx,
    dotSizePx,
    dotMarkerGapPx,
    maximumContentHeightPx,
    marker: policy.marker,
    label: policy.label,
    detail: policy.detail
  });
}

export function visualSystemV1AdaptiveCardLayout(width, height, itemCount, constraints) {
  const layout = visualSystemV1Layout(width, height);
  if (layout.vertical) {
    throw new Error("自适应卡片铺满只用于 visual-system-v1 横版");
  }
  const policy = VISUAL_SYSTEM_V1.cardDeck;
  if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > policy.maximumItems) {
    throw new TypeError(`同页卡片数量必须是 1–${policy.maximumItems} 的整数`);
  }
  if (constraints === null || typeof constraints !== "object" || Array.isArray(constraints)) {
    throw new TypeError("卡片布局约束必须是对象");
  }

  const copyBottomPx = requiredFiniteConstraint(constraints, "copyBottomPx", "标题区底部");
  const subtitleTopPx = requiredFiniteConstraint(constraints, "subtitleTopPx", "字幕区顶部");
  const minimumCardWidthPx = Math.max(
    policy.minimumCardWidthPx,
    requiredFiniteConstraint(constraints, "minimumCardWidthPx", "内容所需卡片宽度")
  );
  const minimumCardHeightPx = Math.max(
    policy.minimumCardHeightPx,
    requiredFiniteConstraint(constraints, "minimumCardHeightPx", "内容所需卡片高度")
  );
  const safeTop = Math.ceil(Math.max(policy.safeTopPx, copyBottomPx + policy.copyClearancePx));
  const safeBottom = Math.floor(Math.min(
    policy.safeBottomPx,
    subtitleTopPx - policy.subtitleClearancePx - VISUAL_SYSTEM_V1.motion.nodeEnterTranslateYPx
  ));
  if (safeBottom <= safeTop) {
    throw new Error("标题与字幕之间没有足够的卡片安全区，请拆分页面或缩短文案");
  }

  const rows = itemCount <= policy.singleRowMaximumItems ? 1 : 2;
  const columns = Math.ceil(itemCount / rows);
  const safeArea = Object.freeze({
    left: policy.safeLeftPx,
    top: safeTop,
    right: width - policy.safeRightPx,
    bottom: safeBottom,
    width: width - policy.safeLeftPx - policy.safeRightPx,
    height: safeBottom - safeTop
  });
  const gapX = clamp(
    Math.round(safeArea.width / (7 * columns)),
    policy.minimumGapXPx,
    policy.maximumGapXPx
  );
  const maximumCardWidth = columns === 1
    ? policy.maximumSingleCardWidthPx
    : columns === 2
      ? policy.maximumTwoColumnCardWidthPx
      : policy.maximumDefaultCardWidthPx;
  const rawCardWidth = (safeArea.width - gapX * (columns - 1)) / columns;
  const cardWidth = Math.min(rawCardWidth, maximumCardWidth);
  const cardHeight = Math.min(
    (safeArea.height - policy.gapYPx * (rows - 1)) / rows,
    policy.maximumCardHeightPx
  );
  if (cardWidth < minimumCardWidthPx || cardHeight < minimumCardHeightPx) {
    throw new Error("卡片无法同时满足安全区与内容可读尺寸，请拆分页面或缩短文案");
  }

  const groupHeight = rows * cardHeight + (rows - 1) * policy.gapYPx;
  const groupTop = safeArea.top + (safeArea.height - groupHeight) / 2;
  const cards = [];
  for (let row = 0; row < rows; row += 1) {
    const rowStartIndex = row * columns;
    const rowItemCount = Math.min(columns, itemCount - rowStartIndex);
    const rowWidth = rowItemCount * cardWidth + (rowItemCount - 1) * gapX;
    const rowLeft = safeArea.left + (safeArea.width - rowWidth) / 2;
    for (let column = 0; column < rowItemCount; column += 1) {
      cards.push(freezeCard({
        index: rowStartIndex + column,
        row,
        column,
        left: rowLeft + column * (cardWidth + gapX),
        top: groupTop + row * (cardHeight + policy.gapYPx),
        width: cardWidth,
        height: cardHeight
      }));
    }
  }

  return Object.freeze({
    mode: policy.mode,
    itemCount,
    rows,
    columns,
    gapX,
    gapY: policy.gapYPx,
    cardWidth,
    cardHeight,
    constraints: Object.freeze({
      copyBottomPx,
      subtitleTopPx,
      minimumCardWidthPx,
      minimumCardHeightPx
    }),
    safeArea,
    cards: Object.freeze(cards)
  });
}

export function visualSystemV1InterpolateCardDeck(fromDeck, toDeck, progress) {
  if (
    fromDeck === null || typeof fromDeck !== "object" ||
    toDeck === null || typeof toDeck !== "object" ||
    !Array.isArray(fromDeck.cards) || fromDeck.cards.length === 0 ||
    !Array.isArray(toDeck.cards) || toDeck.cards.length === 0
  ) {
    throw new TypeError("卡片重排需要有效的起止布局");
  }
  if (!Number.isFinite(progress)) {
    throw new TypeError("卡片重排进度必须是有限数值");
  }
  if (
    fromDeck.rows !== 1 ||
    toDeck.rows !== 1 ||
    toDeck.itemCount !== fromDeck.itemCount + 1
  ) {
    throw new TypeError("场景自适应重排只接受同一行且每次增加一张卡片");
  }
  if (JSON.stringify(fromDeck.safeArea) !== JSON.stringify(toDeck.safeArea)) {
    throw new TypeError("场景自适应重排的安全区必须保持一致");
  }

  const normalizedProgress = clamp(progress, 0, 1);
  const cardWidth = interpolateNumber(
    fromDeck.cardWidth,
    toDeck.cardWidth,
    normalizedProgress
  );
  const cardHeight = interpolateNumber(
    fromDeck.cardHeight,
    toDeck.cardHeight,
    normalizedProgress
  );
  const cards = toDeck.cards.map((targetCard, index) => {
    const sourceCard = fromDeck.cards[index];
    const targetCenterX = targetCard.left + targetCard.width / 2;
    const targetCenterY = targetCard.top + targetCard.height / 2;
    const sourceCenterX = sourceCard
      ? sourceCard.left + sourceCard.width / 2
      : targetCenterX;
    const sourceCenterY = sourceCard
      ? sourceCard.top + sourceCard.height / 2
      : targetCenterY;
    const centerX = interpolateNumber(sourceCenterX, targetCenterX, normalizedProgress);
    const centerY = interpolateNumber(sourceCenterY, targetCenterY, normalizedProgress);
    return freezeCard({
      index,
      row: targetCard.row,
      column: targetCard.column,
      left: centerX - cardWidth / 2,
      top: centerY - cardHeight / 2,
      width: cardWidth,
      height: cardHeight
    });
  });

  return Object.freeze({
    mode: `${toDeck.mode}-scene-adaptive-reflow`,
    itemCount: toDeck.itemCount,
    rows: toDeck.rows,
    columns: toDeck.columns,
    gapX: interpolateNumber(fromDeck.gapX, toDeck.gapX, normalizedProgress),
    gapY: toDeck.gapY,
    cardWidth,
    cardHeight,
    constraints: toDeck.constraints,
    safeArea: toDeck.safeArea,
    progress: normalizedProgress,
    cards: Object.freeze(cards)
  });
}

export function visualSystemV1HorizontalCardConnectors(cards) {
  if (!Array.isArray(cards) || cards.length < 2) {
    throw new TypeError("横向卡片连线至少需要两张卡片");
  }
  const top = cards[0].top;
  const height = cards[0].height;
  if (cards.some((card) => card.top !== top || card.height !== height)) {
    throw new TypeError("横向卡片连线只接受同一行且等高的卡片");
  }
  return Object.freeze(cards.slice(0, -1).map((card, index) => {
    const next = cards[index + 1];
    return Object.freeze({
      from: Object.freeze({ x: card.left + card.width, y: card.top + card.height / 2 }),
      to: Object.freeze({ x: next.left, y: next.top + next.height / 2 }),
      orientation: "horizontal"
    });
  }));
}
