import assert from "node:assert/strict";
import test from "node:test";

import {
  VISUAL_SYSTEM_V1_CONTENT_LAYOUT_DEFAULTS,
  VISUAL_SYSTEM_V1_CONTENT_LAYOUT_UNFIT,
  visualSystemV1ContentCardMetrics,
  visualSystemV1ContentTextWidthUnits,
  visualSystemV1EstimateContentTextWidthPx,
  visualSystemV1PackContentCards
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

function assertWithinSafeArea(layout) {
  for (const card of layout.cards) {
    assert.ok(card.left >= layout.safeArea.left);
    assert.ok(card.top >= layout.safeArea.top);
    assert.ok(card.right <= layout.safeArea.right);
    assert.ok(card.bottom <= layout.safeArea.bottom);
    assert.ok(card.width >= card.minWidth);
    assert.ok(card.width <= card.preferredWidth);
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
  assert.equal(baseline.horizontalChromePx, 20);
  assert.equal(diagram.horizontalChromePx, 60);
  assert.equal(diagram.leadingOccupancyPx, 48);
  assert.equal(diagram.trailingOccupancyPx, 12);
  assert.equal(diagram.labelRequiredWidthPx - baseline.labelRequiredWidthPx, 40);
  assert.equal(diagram.iconOccupancyPx, 0);
  assert.deepEqual(diagram.visualOccupancy, { leadingPx: 48, trailingPx: 12 });
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
