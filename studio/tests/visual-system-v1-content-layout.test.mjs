import assert from "node:assert/strict";
import test from "node:test";

import {
  VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS,
  VISUAL_SYSTEM_V1_CONTENT_LAYOUT_UNFIT,
  VISUAL_SYSTEM_V1_SEMANTIC_ICON_NODE_DEFAULTS,
  visualSystemV1ContentCardMetrics,
  visualSystemV1ContentTextWidthUnits,
  visualSystemV1EstimateContentTextWidthPx,
  visualSystemV1PackContentCards,
  visualSystemV1SemanticIconNodeMetrics,
  visualSystemV1SemanticTextConnectorMetrics,
  visualSystemV1SemanticTextBoxMetrics
} from "../src/video/components/visual-system-v1/content-layout.mjs";

const COMPACT_METRICS = Object.freeze({
  labelFontSizePx: 20,
  detailFontSizePx: 14,
  labelLetterSpacingPx: 0,
  detailLetterSpacingPx: 0,
  horizontalPaddingPx: 10,
  minimumCardWidthPx: 60,
  labelSafetyPx: 0
});

function assertWithinSafeArea(layout, { allowExpansion = false } = {}) {
  for (const card of layout.cards) {
    assert.ok(card.left >= layout.safeArea.left);
    assert.ok(card.top >= layout.safeArea.top);
    assert.ok(card.right <= layout.safeArea.right);
    assert.ok(card.bottom <= layout.safeArea.bottom);
    assert.ok(card.width >= card.minWidth);
    if (!allowExpansion) assert.ok(card.width <= card.preferredWidth);
  }
}

test("中英文字符按确定性权重估算宽度", () => {
  assert.equal(visualSystemV1ContentTextWidthUnits("中文"), 2);
  assert.equal(visualSystemV1ContentTextWidthUnits("AA"), 1.36);
  assert.equal(visualSystemV1ContentTextWidthUnits("aa"), 1.12);
  assert.equal(visualSystemV1ContentTextWidthUnits("12"), 1.12);
  assert.equal(visualSystemV1ContentTextWidthUnits("A 中"), 2);
  assert.equal(
    visualSystemV1EstimateContentTextWidthPx("中A", { fontSizePx: 20, letterSpacingPx: -1 }),
    32.6
  );
  assert.equal(
    visualSystemV1EstimateContentTextWidthPx("中A", { fontSizePx: 20, letterSpacingPx: -1 }),
    visualSystemV1EstimateContentTextWidthPx("中A", { fontSizePx: 20, letterSpacingPx: -1 })
  );
});

test("语义图标节点按图标与文字真实占位生成居中的连线命中几何", () => {
  const anchorGeometry = {
    x: 288,
    y: 504,
    width: 576,
    height: 132,
    right: 864,
    bottom: 636,
    centerX: 576,
    centerY: 570
  };
  const metrics = visualSystemV1SemanticIconNodeMetrics({
    id: "S10/mcp",
    label: "MCP",
    detail: "暴露并连接能力",
    anchorGeometry
  });
  assert.equal(VISUAL_SYSTEM_V1_SEMANTIC_ICON_NODE_DEFAULTS.iconSizePx, 56);
  assert.equal(metrics.fitsAnchor, true);
  assert.ok(metrics.renderGeometry.width < anchorGeometry.width);
  assert.ok(metrics.renderGeometry.height < anchorGeometry.height);
  assert.ok(metrics.connectorGeometry.width < anchorGeometry.width);
  assert.ok(metrics.connectorGeometry.height < anchorGeometry.height);
  assert.ok(metrics.connectorGeometry.width < metrics.renderGeometry.width);
  assert.ok(metrics.connectorGeometry.height < metrics.renderGeometry.height);
  assert.equal(metrics.renderGeometry.centerX, anchorGeometry.centerX);
  assert.equal(metrics.renderGeometry.centerY, anchorGeometry.centerY);
  assert.equal(metrics.connectorGeometry.centerX, anchorGeometry.centerX);
  assert.equal(metrics.connectorGeometry.centerY, anchorGeometry.centerY);
  assert.equal(
    metrics.connectorGeometry.left - metrics.renderGeometry.left,
    VISUAL_SYSTEM_V1_SEMANTIC_ICON_NODE_DEFAULTS.horizontalPaddingPx
  );
  assert.equal(
    metrics.connectorGeometry.top - metrics.renderGeometry.top,
    VISUAL_SYSTEM_V1_SEMANTIC_ICON_NODE_DEFAULTS.verticalPaddingPx
  );
  assert.equal(metrics.connectorGeometry.width, metrics.visibleContentWidthPx);
  assert.equal(metrics.connectorGeometry.height, metrics.visibleContentHeightPx);
  assert.equal(metrics.connectorGeometry.left, metrics.connectorGeometry.x);
  assert.equal(metrics.connectorGeometry.top, metrics.connectorGeometry.y);
  assert.ok(Math.abs(
    metrics.connectorGeometry.right -
      (metrics.connectorGeometry.x + metrics.connectorGeometry.width)
  ) < 1e-9);
  const longformMetrics = visualSystemV1SemanticIconNodeMetrics({
    id: "longform-node",
    label: "上下文窗口",
    detail: "只聚焦当前任务",
    anchorGeometry,
    iconSizePx: 88
  });
  assert.equal(
    longformMetrics.requiredWidthPx -
      visualSystemV1SemanticIconNodeMetrics({
        id: "support-node",
        label: "上下文窗口",
        detail: "只聚焦当前任务",
        anchorGeometry,
        iconSizePx: 56
      }).requiredWidthPx,
    32
  );
  assert.equal(longformMetrics.fitsAnchor, true);
});

test("标题完整宽度决定 minWidth，详情完整宽度决定 preferredWidth", () => {
  const metrics = visualSystemV1ContentCardMetrics({
    id: "agent",
    label: "Agent / 判断",
    detail: "选择正确顺序与验收"
  });
  assert.equal(metrics.hasIcon, false);
  assert.ok(metrics.minWidth >= metrics.labelRequiredWidthPx);
  assert.ok(metrics.preferredWidth >= metrics.detailPreferredWidthPx);
  assert.ok(metrics.preferredWidth >= metrics.minWidth);
  assert.deepEqual(metrics.labelLayout, {
    whiteSpace: "nowrap",
    wordBreak: "keep-all",
    overflowWrap: "normal"
  });
});

test("内容卡片拒绝 conceptKind，不再为标题前图标预留空间", () => {
  assert.throws(
    () => visualSystemV1ContentCardMetrics({
      id: "icon",
      label: "执行",
      detail: "动作",
      conceptKind: "tool"
    }, COMPACT_METRICS),
    /不能为卡片标题预留或嵌入图标/u
  );
  const plain = visualSystemV1ContentCardMetrics({
    id: "plain",
    label: "执行",
    detail: "动作"
  }, COMPACT_METRICS);
  assert.equal(plain.iconOccupancyPx, 0);
  assert.equal(plain.hasIcon, false);
});

test("visualOccupancy 只为开放图解几何预留空间，不叠加卡片图标槽", () => {
  const baseline = visualSystemV1ContentCardMetrics({
    id: "baseline",
    label: "开放图解"
  }, COMPACT_METRICS);
  const diagram = visualSystemV1ContentCardMetrics({
    id: "diagram",
    label: "开放图解",
    visualOccupancy: { leadingPx: 48, trailingPx: 12 }
  }, COMPACT_METRICS);
  assert.equal(baseline.horizontalChromePx, 26);
  assert.equal(diagram.horizontalChromePx, 66);
  assert.equal(diagram.leadingOccupancyPx, 48);
  assert.equal(diagram.trailingOccupancyPx, 12);
  assert.equal(diagram.labelRequiredWidthPx - baseline.labelRequiredWidthPx, 40);
  assert.equal(diagram.iconOccupancyPx, 0);
  assert.deepEqual(diagram.visualOccupancy, { leadingPx: 48, trailingPx: 12 });
});

test("真实文字盒把边框、自适应紧凑字号、换行和 marker 一起纳入 fit 判定", () => {
  const compactCard = visualSystemV1SemanticTextBoxMetrics({
    id: "compact-card",
    label: "版本如何验证？",
    detail: "比较 · 回归 · 回退",
    surfaceRole: "information-card",
    width: 380,
    height: 79.904,
    typographyProfile: "standard"
  });
  assert.equal(compactCard.compactInformationCard, true);
  assert.equal(compactCard.borderWidthPx, 3);
  assert.equal(compactCard.labelFontSizePx, 30);
  assert.equal(compactCard.detailFontSizePx, 18);
  assert.equal(compactCard.fits, true);

  const openDiagram = visualSystemV1SemanticTextBoxMetrics({
    id: "open-diagram",
    label: "只有一段长文字",
    detail: "没有触发、目录和完成标准，仍只是 Prompt",
    marker: "边界",
    surfaceRole: "open-canvas",
    textWrapMode: "break-word",
    width: 276.352,
    height: 113.4,
    typographyProfile: "standard"
  });
  assert.equal(openDiagram.detailLineCount, 2);
  assert.equal(openDiagram.markerVisible, false);
  assert.equal(openDiagram.fits, true);

  const undersized = visualSystemV1SemanticTextBoxMetrics({
    id: "undersized",
    label: "只有一段长文字",
    detail: "没有触发、目录和完成标准，仍只是 Prompt",
    surfaceRole: "open-canvas",
    textWrapMode: "break-word",
    width: 276.352,
    height: 80,
    typographyProfile: "standard"
  });
  assert.equal(undersized.fits, false);
});

test("连接线绑定真实可见承载：卡片取完整边框，开放文字取左对齐紧边界", () => {
  const anchorGeometry = {
    x: 288,
    y: 510,
    width: 576,
    height: 120
  };
  const openText = visualSystemV1SemanticTextConnectorMetrics({
    id: "open-text",
    label: "重新评测",
    detail: "固定样例比较新旧",
    surfaceRole: "open-canvas",
    anchorGeometry,
    typographyProfile: "longformEmphasis"
  });
  assert.equal(openText.bindingMode, "visible-text-content");
  assert.equal(openText.fitsAnchor, true);
  assert.ok(openText.connectorGeometry.width < anchorGeometry.width / 2);
  assert.ok(openText.connectorGeometry.left >= anchorGeometry.x);
  assert.ok(openText.connectorGeometry.right <= anchorGeometry.x + anchorGeometry.width);
  assert.ok(openText.connectorGeometry.top >= anchorGeometry.y);
  assert.ok(openText.connectorGeometry.bottom <= anchorGeometry.y + anchorGeometry.height);

  const mixedText = visualSystemV1SemanticTextConnectorMetrics({
    id: "feedback-mixed-text",
    label: "反馈给同一 Agent",
    detail: "修订并保留版本史",
    surfaceRole: "open-canvas",
    anchorGeometry: { x: 287.2, y: 590, width: 434.2, height: 164 },
    typographyProfile: "longformEmphasis"
  });
  const mixedVisibleTextWidth = Math.max(
    mixedText.textBoxMetrics.labelTextWidthPx,
    mixedText.textBoxMetrics.detailTextWidthPx,
    16
  );
  const expectedMixedRight = Number((
    287.2 +
    mixedText.textBoxMetrics.horizontalPaddingPx +
    mixedVisibleTextWidth +
    8
  ).toFixed(4));
  assert.equal(mixedText.bindingMode, "visible-text-content");
  assert.equal(mixedText.connectorGeometry.right, expectedMixedRight);
  assert.equal(mixedText.connectorGeometry.right, 609.84);
  assert.ok(mixedText.connectorGeometry.right < 287.2 + 434.2 - 100);

  const card = visualSystemV1SemanticTextConnectorMetrics({
    id: "card",
    label: "重新启用",
    detail: "证据通过",
    surfaceRole: "information-card",
    anchorGeometry,
    typographyProfile: "longformEmphasis"
  });
  assert.equal(card.bindingMode, "full-visible-surface");
  assert.deepEqual(card.connectorGeometry, {
    x: 288,
    y: 510,
    left: 288,
    top: 510,
    width: 576,
    height: 120,
    right: 864,
    bottom: 630,
    centerX: 576,
    centerY: 570
  });

  const fullSurfaceOpenNode = visualSystemV1SemanticTextConnectorMetrics({
    id: "full-surface-open",
    label: "时间锚点",
    detail: "可见横贯表面",
    surfaceRole: "open-canvas",
    anchorGeometry,
    typographyProfile: "longformEmphasis",
    bindToFullAnchor: true
  });
  assert.equal(fullSurfaceOpenNode.bindingMode, "full-visible-surface");
  assert.deepEqual(fullSurfaceOpenNode.connectorGeometry, card.connectorGeometry);
});

test("首选宽度能放下时保持单行、原顺序与首选宽度", () => {
  const layout = visualSystemV1PackContentCards({
    items: [
      { id: "a", label: "输入", preferredWidth: 120 },
      { id: "b", label: "路由", preferredWidth: 160 },
      { id: "c", label: "执行", preferredWidth: 140 }
    ],
    safeArea: { x: 100, y: 200, width: 600, height: 180 },
    gapPx: 20,
    rowHeightPx: 100,
    cardOptions: COMPACT_METRICS
  });
  assert.equal(layout.rowCount, 1);
  assert.deepEqual(layout.rows[0].itemIds, ["a", "b", "c"]);
  assert.deepEqual(layout.cards.map((card) => card.width), [120, 160, 140]);
  assert.equal(layout.rows[0].left, 170);
  assertWithinSafeArea(layout);
});

test("单行可行时按可收缩空间确定性缩至 minWidth 以上", () => {
  const input = [
    { id: "a", label: "输入", minWidth: 100, preferredWidth: 180 },
    { id: "b", label: "路由", minWidth: 120, preferredWidth: 200 },
    { id: "c", label: "执行", minWidth: 80, preferredWidth: 120 }
  ];
  const options = {
    items: input,
    safeArea: { left: 0, top: 0, right: 400, bottom: 160 },
    gapPx: 20,
    rowHeightPx: 100,
    cardOptions: COMPACT_METRICS
  };
  const first = visualSystemV1PackContentCards(options);
  const second = visualSystemV1PackContentCards(options);
  assert.equal(first.rowCount, 1);
  assert.deepEqual(first, second);
  assert.equal(first.rows[0].width, 400);
  assert.equal(first.cards.reduce((sum, card) => sum + card.width, 0), 360);
  assert.ok(first.cards.every((card) => card.width >= card.minWidth));
  assert.deepEqual(input, [
    { id: "a", label: "输入", minWidth: 100, preferredWidth: 180 },
    { id: "b", label: "路由", minWidth: 120, preferredWidth: 200 },
    { id: "c", label: "执行", minWidth: 80, preferredWidth: 120 }
  ]);
  assertWithinSafeArea(first);
});

test("单行容不下最小宽度时连续分成两行且不改输入顺序", () => {
  const layout = visualSystemV1PackContentCards({
    items: [
      { id: "a", label: "输入", minWidth: 180, preferredWidth: 220 },
      { id: "b", label: "判断", minWidth: 180, preferredWidth: 220 },
      { id: "c", label: "动作", minWidth: 180, preferredWidth: 220 },
      { id: "d", label: "连接", minWidth: 180, preferredWidth: 220 }
    ],
    safeArea: { x: 50, y: 100, width: 440, height: 260 },
    gapPx: 20,
    rowGapPx: 20,
    rowHeightPx: 100,
    cardOptions: COMPACT_METRICS
  });
  assert.equal(layout.rowCount, 2);
  assert.deepEqual(layout.rows.map((row) => row.itemIds), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(layout.cards.map((card) => card.id), ["a", "b", "c", "d"]);
  assert.equal(layout.rows[0].top, 120);
  assert.equal(layout.rows[1].top, 240);
  assertWithinSafeArea(layout);
});

test("显式语义行可用三行、受限增宽与逐行方向建立长视频阅读秩序", () => {
  const layout = visualSystemV1PackContentCards({
    items: ["a", "b", "c", "d", "e", "f"].map((id) => ({
      id,
      label: id.toUpperCase(),
      minWidth: 80,
      preferredWidth: 100
    })),
    safeArea: { x: 100, y: 200, width: 1000, height: 400 },
    gapPx: 20,
    rowGapPx: 20,
    rowHeightPx: 100,
    maximumRows: 3,
    rowGroups: [["a", "b", "c"], ["d"], ["e", "f"]],
    rowDirections: ["ltr", "ltr", "rtl"],
    targetRowFillRatio: 0.78,
    maximumCardWidthPx: 300,
    singletonMaximumWidthPx: 320,
    cardOptions: COMPACT_METRICS
  });
  assert.equal(layout.rowLayoutMode, "explicit-semantic-rows");
  assert.equal(layout.rowCount, 3);
  assert.deepEqual(layout.rows.map((row) => row.semanticItemIds), [
    ["a", "b", "c"], ["d"], ["e", "f"]
  ]);
  assert.deepEqual(layout.rows.map((row) => row.itemIds), [
    ["a", "b", "c"], ["d"], ["f", "e"]
  ]);
  assert.deepEqual(layout.rows.map((row) => row.direction), ["ltr", "ltr", "rtl"]);
  assert.equal(layout.rows[0].width, 780);
  assert.equal(layout.rows[1].width, 320);
  assert.equal(layout.rows[2].width, 620);
  assert.ok(layout.cards.some((card) => card.expandPx > 0));
  assertWithinSafeArea(layout, { allowExpansion: true });

  assert.throws(
    () => visualSystemV1PackContentCards({
      items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      safeArea: { x: 0, y: 0, width: 400, height: 200 },
      rowGroups: [["a"]],
      rowDirections: ["ltr"],
      cardOptions: COMPACT_METRICS
    }),
    /无重复、无遗漏/u
  );
});

test("任何两行都容不下标题最小宽度时 fail closed", () => {
  assert.throws(
    () => visualSystemV1PackContentCards({
      items: [
        { id: "a", label: "很长的标题一", minWidth: 260 },
        { id: "b", label: "很长的标题二", minWidth: 260 },
        { id: "c", label: "很长的标题三", minWidth: 260 }
      ],
      safeArea: { x: 0, y: 0, width: 240, height: 300 },
      gapPx: 20,
      rowHeightPx: 100,
      cardOptions: COMPACT_METRICS
    }),
    (error) => {
      assert.equal(error instanceof RangeError, true);
      assert.equal(error.code, VISUAL_SYSTEM_V1_CONTENT_LAYOUT_UNFIT);
      assert.equal(error.details.reason, "minimum-width-overflow");
      return true;
    }
  );
});

test("两行高度超出 safeArea 时 fail closed", () => {
  assert.throws(
    () => visualSystemV1PackContentCards({
      items: [
        { id: "a", label: "输入", minWidth: 180 },
        { id: "b", label: "判断", minWidth: 180 },
        { id: "c", label: "执行", minWidth: 180 }
      ],
      safeArea: { x: 0, y: 0, width: 380, height: 200 },
      gapPx: 20,
      rowGapPx: 30,
      rowHeightPx: 100,
      cardOptions: COMPACT_METRICS
    }),
    (error) => {
      assert.equal(error.code, VISUAL_SYSTEM_V1_CONTENT_LAYOUT_UNFIT);
      assert.equal(error.details.reason, "row-height-overflow");
      return true;
    }
  );
});

test("默认单行标题策略是冻结的不可词内断行合同", () => {
  assert.equal(Object.isFrozen(VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS), true);
  assert.equal(Object.isFrozen(VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.labelLayout), true);
  assert.deepEqual(VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS.labelLayout, {
    whiteSpace: "nowrap",
    wordBreak: "keep-all",
    overflowWrap: "normal"
  });
});
