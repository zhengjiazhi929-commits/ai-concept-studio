import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  VISUAL_SYSTEM_V1,
  VISUAL_SYSTEM_V1_DEPTH_ROLES
} from "../src/video/components/visual-system-v1/tokens.mjs";
import { visualSystemV1ChapterDisplayLabel } from "../src/video/components/visual-system-v1/chapter-progress.mjs";
import {
  visualSystemV1AdaptiveCardTypography,
  visualSystemV1AdaptiveCardLayout,
  visualSystemV1HorizontalCardConnectors,
  visualSystemV1InterpolateCardDeck,
  visualSystemV1Layout
} from "../src/video/components/visual-system-v1/layout.mjs";
import {
  VISUAL_SYSTEM_V1_AI_WATERMARK,
  aiWatermarkMotionAtFrame,
  visualSystemV1AiWatermarkGeometry,
  visualSystemV1AiWatermarkScale
} from "../src/video/components/visual-system-v1/ai-watermark.mjs";
import {
  visualSystemV1ChapterProgressAtFrame,
  visualSystemV1ConnectorMotionAtFrame,
  visualSystemV1DepthMotionAtFrame,
  visualSystemV1HoverProgressAtFrame,
  visualSystemV1SceneOpacityAtFrame,
  visualSystemV1SequentialSceneOpacityAtFrame,
  visualSystemV1SpringMotionAtFrame,
  visualSystemV1TextMotionAtFrame,
  visualSystemV1WallpaperMotionAtFrame
} from "../src/video/components/visual-system-v1/motion.mjs";
import {
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CAPTIONS,
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS,
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES,
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF,
  visualSystemV1SkillAgentMcpProofLayout,
  visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame
} from "../src/video/visual-system-v1-skill-agent-mcp-proof-plan.mjs";
import {
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT,
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_WATERMARK_PROVENANCE
} from "../scripts/render-visual-system-v1-skill-agent-mcp-proof.mjs";

const source = async (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");
const almostEqual = (actual, expected, tolerance = 1e-9) =>
  Math.abs(actual - expected) <= tolerance;

test("visual-system-v1 保留双画幅兼容能力，但新默认只输出横版开放画布", () => {
  assert.equal(VISUAL_SYSTEM_V1.schemaVersion, "visual-system-v1");
  assert.equal(VISUAL_SYSTEM_V1.fps, 30);
  assert.deepEqual(VISUAL_SYSTEM_V1.formats.wide, { width: 1920, height: 1080, aspect: "16:9" });
  assert.deepEqual(VISUAL_SYSTEM_V1.formats.vertical, { width: 1080, height: 1920, aspect: "9:16" });
  assert.deepEqual(VISUAL_SYSTEM_V1.balance, {
    flatPercent: 70,
    shallowDepthPercent: 30,
    primaryMintPercent: 80,
    secondaryPurplePercent: 20,
    maximumAccentColors: 2,
    maximumSimultaneousHighlights: 3,
    maximumDiagramNodes: 12
  });
  assert.deepEqual(VISUAL_SYSTEM_V1_DEPTH_ROLES, [
    "active-node",
    "key-result",
    "human-confirmation"
  ]);
  assert.equal(VISUAL_SYSTEM_V1.depth.maximumVisibleDepthPx, 2.5);
  assert.equal(VISUAL_SYSTEM_V1.wallpaper.driftPeriodSeconds, 20);
  assert.equal(VISUAL_SYSTEM_V1.wallpaper.maximumDriftFraction, 0.015);
  assert.equal(VISUAL_SYSTEM_V1.wallpaper.feathering, "radial-gradient-stops");
  assert.equal(
    VISUAL_SYSTEM_V1.wallpaper.compositorPolicy,
    "no-viewport-filter-no-viewport-will-change"
  );
  assert.deepEqual(VISUAL_SYSTEM_V1.defaults, {
    surfaceMode: "flat-only",
    sameLevelSurfaceUniform: true,
    shallowDepthOptInOnly: true,
    outputFormat: "wide-only",
    contentFrameMode: "open-canvas",
    largeContentWindowEnabled: false,
    topHeaderEnabled: false,
    subtitleColor: "#000000",
    subtitleMotion: "none"
  });
  assert.deepEqual(VISUAL_SYSTEM_V1.chapterProgress, {
    enabled: true,
    placement: "bottom",
    mode: "duration-proportional-segmented",
    segmentBreaks: true,
    labelFormat: "index-and-title",
    showDurationText: false,
    showElapsedTime: false,
    showTotalTime: false,
    themeColorCount: 1
  });
  assert.deepEqual(VISUAL_SYSTEM_V1.cardDeck, {
    mode: "fill-safe-viewport",
    compositionMode: "visible-node-count",
    sceneAdaptive: true,
    outputFormat: "wide-only",
    sameLevelEqualSize: true,
    contentVerticalAlignment: "center",
    safeLeftPx: 90,
    safeRightPx: 90,
    safeTopPx: 342,
    safeBottomPx: 837,
    copyClearancePx: 24,
    subtitleClearancePx: 24,
    contentFitRequired: true,
    minimumGapXPx: 36,
    maximumGapXPx: 56,
    gapYPx: 36,
    maximumSingleCardWidthPx: 920,
    maximumTwoColumnCardWidthPx: 760,
    maximumDefaultCardWidthPx: 620,
    minimumCardWidthPx: 240,
    minimumCardHeightPx: 219,
    maximumCardHeightPx: 520,
    singleRowMaximumItems: 5,
    maximumItems: 12
  });
  assert.deepEqual(VISUAL_SYSTEM_V1.cardTypography, {
    mode: "geometry-responsive-uniform-per-deck",
    sameLevelUniform: true,
    compactHeightPx: 229,
    expandedHeightPx: 494,
    compactWidthPx: 256,
    wideCompactWidthPx: 543,
    expandedWidthPx: 920,
    marker: {
      compactPx: 13,
      expandedPx: 16,
      wideCompactBoostPx: 1,
      wideExpandedBoostPx: 2,
      lineHeight: 1.2,
      letterSpacingEm: 0.08,
      maximumLines: 1
    },
    label: {
      compactPx: 30,
      expandedPx: 42,
      wideCompactBoostPx: 2,
      wideExpandedBoostPx: 14,
      lineHeight: 1.12,
      letterSpacingEm: -0.025,
      maximumLines: 2
    },
    detail: {
      compactPx: 18,
      expandedPx: 24,
      wideCompactBoostPx: 1,
      wideExpandedBoostPx: 4,
      lineHeight: 1.35,
      maximumLines: 2
    },
    spacing: {
      markerTitleCompactPx: 11,
      markerTitleExpandedPx: 20,
      markerTitleWideCompactBoostPx: 1,
      markerTitleWideExpandedBoostPx: 4,
      titleDetailCompactPx: 7,
      titleDetailExpandedPx: 12,
      titleDetailWideExpandedBoostPx: 2,
      dotCompactPx: 8,
      dotExpandedPx: 10,
      dotWideExpandedBoostPx: 2,
      dotMarkerGapCompactPx: 10,
      dotMarkerGapExpandedPx: 12,
      dotMarkerGapWideExpandedBoostPx: 2
    }
  });
  assert.ok(VISUAL_SYSTEM_V1.forbidden.includes("chapter-duration-text"));
  assert.ok(VISUAL_SYSTEM_V1.forbidden.includes("viewport-scale-filter-blur"));
  assert.ok(VISUAL_SYSTEM_V1.forbidden.includes("viewport-scale-will-change"));
  assert.equal(VISUAL_SYSTEM_V1.depth.available, true);
  assert.equal(VISUAL_SYSTEM_V1.depth.enabledByDefault, false);
  assert.equal(VISUAL_SYSTEM_V1.motion.cardReflowFrames, 8);
  assert.equal(VISUAL_SYSTEM_V1.motion.cardFocusFrames, 12);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.durationInFrames, 360);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.durationSeconds, 12);
  assert.deepEqual(Object.keys(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.compositions), ["wide"]);
});

test("通用画布背景只用渐变羽化，禁止全屏模糊合成层", async () => {
  const components = await source("../src/video/components/visual-system-v1/components.jsx");
  const canvasStart = components.indexOf("export function VisualSystemV1Canvas");
  const canvasEnd = components.indexOf(
    "export function VisualSystemV1OpenCanvasHeader",
    canvasStart
  );
  assert.ok(canvasStart >= 0 && canvasEnd > canvasStart);
  const canvasSource = components.slice(canvasStart, canvasEnd);
  assert.match(canvasSource, /radial-gradient/gu);
  assert.doesNotMatch(canvasSource, /filter\s*:/u);
  assert.doesNotMatch(canvasSource, /willChange\s*:/u);
});

test("通用库仍能读取竖版兼容布局，但v9样片只允许横版", () => {
  const wide = visualSystemV1SkillAgentMcpProofLayout(1920, 1080);
  const verticalCompatibility = visualSystemV1Layout(1080, 1920);
  assert.equal(wide.orientation, "wide");
  assert.equal(verticalCompatibility.orientation, "vertical");
  assert.equal(wide.nodes.skill.top, wide.nodes.agent.top);
  assert.equal(wide.connectors[0].orientation, "horizontal");
  assert.equal(wide.connectors.length, 4);
  assert.throws(() => visualSystemV1SkillAgentMcpProofLayout(1080, 1920), /默认只生成/u);
  assert.throws(() => visualSystemV1SkillAgentMcpProofLayout(540, 960), /仅支持/u);
});

test("1到12张同级卡片在横版安全区内自适应铺满并保持等宽等高", () => {
  const constraints = Object.freeze({
    copyBottomPx: 318.28,
    subtitleTopPx: 873,
    minimumCardWidthPx: 240,
    minimumCardHeightPx: 200
  });
  for (let itemCount = 1; itemCount <= 12; itemCount += 1) {
    const deck = visualSystemV1AdaptiveCardLayout(1920, 1080, itemCount, constraints);
    assert.equal(deck.rows, itemCount <= 5 ? 1 : 2);
    assert.equal(deck.columns, Math.ceil(itemCount / deck.rows));
    assert.equal(deck.cards.length, itemCount);
    assert.equal(deck.safeArea.left, 90);
    assert.equal(deck.safeArea.right, 1830);
    assert.equal(deck.safeArea.top, 343);
    assert.equal(deck.safeArea.bottom, 837);
    assert.ok(deck.cardWidth >= VISUAL_SYSTEM_V1.cardDeck.minimumCardWidthPx);
    assert.ok(deck.cardHeight >= VISUAL_SYSTEM_V1.cardDeck.minimumCardHeightPx);
    assert.ok(deck.cards.every((card) => card.width === deck.cardWidth));
    assert.ok(deck.cards.every((card) => card.height === deck.cardHeight));
    for (const card of deck.cards) {
      assert.ok(card.left >= deck.safeArea.left - 1e-9);
      assert.ok(card.right <= deck.safeArea.right + 1e-9);
      assert.ok(card.top >= deck.safeArea.top - 1e-9);
      assert.ok(card.bottom <= deck.safeArea.bottom + 1e-9);
    }
    for (let leftIndex = 0; leftIndex < deck.cards.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < deck.cards.length; rightIndex += 1) {
        const left = deck.cards[leftIndex];
        const right = deck.cards[rightIndex];
        const separatedHorizontally = left.right <= right.left || right.right <= left.left;
        const separatedVertically = left.bottom <= right.top || right.bottom <= left.top;
        assert.ok(separatedHorizontally || separatedVertically);
      }
    }
    for (let row = 0; row < deck.rows; row += 1) {
      const cards = deck.cards.filter((card) => card.row === row);
      const rowCenter = (cards[0].left + cards.at(-1).right) / 2;
      assert.ok(almostEqual(rowCenter, (deck.safeArea.left + deck.safeArea.right) / 2));
    }
  }
  assert.throws(() => visualSystemV1AdaptiveCardLayout(1920, 1080, 0), /1–12/u);
  assert.throws(() => visualSystemV1AdaptiveCardLayout(1920, 1080, 13), /1–12/u);
  assert.throws(() => visualSystemV1AdaptiveCardLayout(1080, 1920, 5), /只用于/u);
  assert.throws(() => visualSystemV1AdaptiveCardLayout(1920, 1080, 5, null), /必须是对象/u);
  assert.throws(
    () => visualSystemV1AdaptiveCardLayout(1920, 1080, 5, { copyBottomPx: 318.28 }),
    /缺少字幕区顶部/u
  );
});

test("卡片安全区跟随实际标题字幕边界且内容放不下时要求拆页", () => {
  const baseline = {
    copyBottomPx: 318.28,
    subtitleTopPx: 873,
    minimumCardWidthPx: 240,
    minimumCardHeightPx: 200
  };
  const shifted = visualSystemV1AdaptiveCardLayout(1920, 1080, 5, {
    copyBottomPx: 360,
    subtitleTopPx: 900,
    minimumCardWidthPx: 300,
    minimumCardHeightPx: 240
  });
  assert.equal(shifted.safeArea.top, 384);
  assert.equal(shifted.safeArea.bottom, 837);
  assert.deepEqual(shifted.constraints, {
    copyBottomPx: 360,
    subtitleTopPx: 900,
    minimumCardWidthPx: 300,
    minimumCardHeightPx: 240
  });
  assert.throws(
    () => visualSystemV1AdaptiveCardLayout(1920, 1080, 5, { ...baseline, minimumCardWidthPx: 320 }),
    /内容可读尺寸/u
  );
  assert.throws(
    () => visualSystemV1AdaptiveCardLayout(1920, 1080, 12, {
      copyBottomPx: 560,
      subtitleTopPx: 800,
      minimumCardWidthPx: 240,
      minimumCardHeightPx: 200
    }),
    /内容可读尺寸/u
  );
  assert.throws(
    () => visualSystemV1AdaptiveCardLayout(1920, 1080, 5, {
      copyBottomPx: 790,
      subtitleTopPx: 820,
      minimumCardWidthPx: 240,
      minimumCardHeightPx: 200
    }),
    /没有足够/u
  );
});

test("卡片文字按最终几何统一响应且五卡片放大为16比42比24", () => {
  const expanded = visualSystemV1AdaptiveCardTypography(308, 494);
  assert.deepEqual(
    {
      marker: expanded.markerFontSizePx,
      label: expanded.labelFontSizePx,
      detail: expanded.detailFontSizePx,
      markerTitleGap: expanded.markerTitleGapPx,
      titleDetailGap: expanded.titleDetailGapPx,
      dot: expanded.dotSizePx,
      dotMarkerGap: expanded.dotMarkerGapPx
    },
    {
      marker: 16,
      label: 42,
      detail: 24,
      markerTitleGap: 20,
      titleDetailGap: 12,
      dot: 10,
      dotMarkerGap: 12
    }
  );
  assert.ok(almostEqual(expanded.maximumContentHeightPx, 210.08));

  const singleCardType = visualSystemV1AdaptiveCardTypography(920, 494);
  assert.deepEqual(
    [
      singleCardType.markerFontSizePx,
      singleCardType.labelFontSizePx,
      singleCardType.detailFontSizePx,
      singleCardType.markerTitleGapPx,
      singleCardType.titleDetailGapPx
    ],
    [18, 56, 28, 24, 14]
  );
  assert.equal(singleCardType.wideExpandedProgress, 1);

  const twoCardType = visualSystemV1AdaptiveCardTypography(760, 494);
  assert.deepEqual(
    [twoCardType.markerFontSizePx, twoCardType.labelFontSizePx, twoCardType.detailFontSizePx],
    [17, 50, 26]
  );
  assert.ok(twoCardType.wideExpandedProgress > 0.57);
  assert.ok(twoCardType.wideExpandedProgress < 0.58);

  const sixCardDeck = visualSystemV1AdaptiveCardLayout(1920, 1080, 6, {
    copyBottomPx: 318.28,
    subtitleTopPx: 873,
    minimumCardWidthPx: 240,
    minimumCardHeightPx: 219
  });
  const sixCardType = visualSystemV1AdaptiveCardTypography(
    sixCardDeck.cardWidth,
    sixCardDeck.cardHeight
  );
  assert.deepEqual(
    [sixCardType.markerFontSizePx, sixCardType.labelFontSizePx, sixCardType.detailFontSizePx],
    [14, 32, 19]
  );

  const twelveCardDeck = visualSystemV1AdaptiveCardLayout(1920, 1080, 12, {
    copyBottomPx: 318.28,
    subtitleTopPx: 873,
    minimumCardWidthPx: 240,
    minimumCardHeightPx: 219
  });
  const compact = visualSystemV1AdaptiveCardTypography(
    twelveCardDeck.cardWidth,
    twelveCardDeck.cardHeight
  );
  assert.deepEqual(
    [compact.markerFontSizePx, compact.labelFontSizePx, compact.detailFontSizePx],
    [13, 30, 18]
  );
  const compactPaddingY = Math.max(24, Math.min(44, twelveCardDeck.cardHeight * 0.1));
  assert.ok(compact.maximumContentHeightPx + compactPaddingY * 2 <= twelveCardDeck.cardHeight);

  const longestCurrentLabelWidth =
    6 * expanded.labelFontSizePx +
    5 * expanded.label.letterSpacingEm * expanded.labelFontSizePx;
  const currentCardInnerWidth = 308 - 2 * Math.max(24, Math.min(36, 308 * 0.08));
  assert.ok(currentCardInnerWidth - longestCurrentLabelWidth >= 8);
  assert.throws(() => visualSystemV1AdaptiveCardTypography(0, 494), /有效/u);
});

test("当前五卡片页使用308乘494铺满几何且连线跟随边缘中点", () => {
  const layout = visualSystemV1SkillAgentMcpProofLayout(1920, 1080);
  const deck = layout.cardDeck;
  assert.equal(deck.rows, 1);
  assert.equal(deck.columns, 5);
  assert.equal(deck.gapX, 50);
  assert.equal(deck.cardWidth, 308);
  assert.equal(deck.cardHeight, 494);
  assert.deepEqual(deck.cards.map((card) => card.left), [90, 448, 806, 1164, 1522]);
  assert.ok(deck.cards.every((card) => card.top === 343 && card.bottom === 837));
  assert.deepEqual(
    Object.values(layout.nodes).map(({ width, height }) => ({ width, height })),
    Array.from({ length: 5 }, () => ({ width: 308, height: 494 }))
  );
  assert.deepEqual(layout.connectors, visualSystemV1HorizontalCardConnectors(deck.cards));
  assert.deepEqual(
    [
      layout.cardTypography.markerFontSizePx,
      layout.cardTypography.labelFontSizePx,
      layout.cardTypography.detailFontSizePx
    ],
    [16, 42, 24]
  );
  assert.deepEqual(
    layout.connectors.map(({ from, to }) => ({ from, to })),
    [
      { from: { x: 398, y: 590 }, to: { x: 448, y: 590 } },
      { from: { x: 756, y: 590 }, to: { x: 806, y: 590 } },
      { from: { x: 1114, y: 590 }, to: { x: 1164, y: 590 } },
      { from: { x: 1472, y: 590 }, to: { x: 1522, y: 590 } }
    ]
  );
  const supportBottom = layout.copy.supportTop + VISUAL_SYSTEM_V1.typography.supportingWidePx * 1.42;
  const twoLineSubtitleTop = 1080 - 92 -
    VISUAL_SYSTEM_V1.typography.subtitleWidePx * VISUAL_SYSTEM_V1.typography.subtitleLineHeight * 2;
  assert.ok(deck.safeArea.top - supportBottom >= 24);
  assert.equal(twoLineSubtitleTop - (deck.safeArea.bottom + VISUAL_SYSTEM_V1.motion.nodeEnterTranslateYPx), 24);
});

test("场景自适应构图按1到5张可见卡片重排并保持平面同级一致", () => {
  const base = visualSystemV1SkillAgentMcpProofLayout(1920, 1080);
  assert.deepEqual(
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES.map(
      ({ itemCount, reflowStartFrame, nodeEnterFrame }) => ({
        itemCount,
        reflowStartFrame,
        nodeEnterFrame
      })
    ),
    [
      { itemCount: 1, reflowStartFrame: 20, nodeEnterFrame: 20 },
      { itemCount: 2, reflowStartFrame: 36, nodeEnterFrame: 44 },
      { itemCount: 3, reflowStartFrame: 68, nodeEnterFrame: 76 },
      { itemCount: 4, reflowStartFrame: 100, nodeEnterFrame: 108 },
      { itemCount: 5, reflowStartFrame: 208, nodeEnterFrame: 216 }
    ]
  );

  const expectedStableLayouts = [
    { frame: 35, count: 1, width: 920, left: [500], type: [18, 56, 28], focus: "skill" },
    { frame: 67, count: 2, width: 760, left: [172, 988], type: [17, 50, 26], focus: "agent" },
    {
      frame: 99,
      count: 3,
      width: 1628 / 3,
      left: [90, 2066 / 3, 3862 / 3],
      type: [16, 42, 24],
      focus: "mcp"
    },
    {
      frame: 150,
      count: 4,
      width: 393,
      left: [90, 539, 988, 1437],
      type: [16, 42, 24],
      focus: "result"
    },
    {
      frame: 240,
      count: 5,
      width: 308,
      left: [90, 448, 806, 1164, 1522],
      type: [16, 42, 24],
      focus: "human"
    }
  ];

  for (const expected of expectedStableLayouts) {
    const current = visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame(base, expected.frame);
    assert.equal(current.visibleCount, expected.count);
    assert.equal(current.targetCount, expected.count);
    assert.equal(current.reflowProgress, 1);
    assert.ok(almostEqual(current.cardDeck.cardWidth, expected.width));
    assert.equal(current.cardDeck.cardHeight, 494);
    assert.equal(current.cardDeck.cards.length, expected.count);
    expected.left.forEach((left, index) => {
      assert.ok(almostEqual(current.cardDeck.cards[index].left, left));
    });
    const first = current.cardDeck.cards[0];
    const last = current.cardDeck.cards.at(-1);
    assert.ok(almostEqual((first.left + last.right) / 2, 960));
    assert.ok(current.cardDeck.cards.every((card) => card.top === 343 && card.height === 494));
    assert.deepEqual(
      [
        current.cardTypography.markerFontSizePx,
        current.cardTypography.labelFontSizePx,
        current.cardTypography.detailFontSizePx
      ],
      expected.type
    );
    assert.equal(current.connectors.length, expected.count - 1);
    assert.equal(current.focusId, expected.focus);
    assert.equal(current.focusProgressByNode[expected.focus], 1);
  }
});

test("八帧预重排连续无超调且连接线始终从当前卡片边缘向右生长", () => {
  const base = visualSystemV1SkillAgentMcpProofLayout(1920, 1080);
  const windows = [
    { start: 36, end: 43, fromCount: 1, toCount: 2 },
    { start: 68, end: 75, fromCount: 2, toCount: 3 },
    { start: 100, end: 107, fromCount: 3, toCount: 4 },
    { start: 208, end: 215, fromCount: 4, toCount: 5 }
  ];

  for (const { start, end, fromCount, toCount } of windows) {
    const before = visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame(base, start - 1);
    const first = visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame(base, start);
    const last = visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame(base, end);
    assert.equal(first.reflowProgress, 0);
    assert.equal(last.reflowProgress, 1);
    assert.ok(almostEqual(first.nodes.skill.left, before.nodes.skill.left));
    assert.ok(almostEqual(first.cardDeck.cardWidth, base.cardDecksByCount[fromCount].cardWidth));
    assert.ok(almostEqual(last.cardDeck.cardWidth, base.cardDecksByCount[toCount].cardWidth));

    let previousWidth = Infinity;
    let previousProgress = -1;
    for (let frame = start; frame <= end; frame += 1) {
      const current = visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame(base, frame);
      assert.ok(current.reflowProgress >= previousProgress);
      assert.ok(current.cardDeck.cardWidth <= previousWidth + 1e-9);
      assert.ok(current.cardDeck.cardWidth >= base.cardDecksByCount[toCount].cardWidth - 1e-9);
      assert.ok(current.cardDeck.cardWidth <= base.cardDecksByCount[fromCount].cardWidth + 1e-9);
      const visibleCards = current.cardDeck.cards.slice(0, current.visibleCount);
      for (let index = 0; index < visibleCards.length - 1; index += 1) {
        assert.ok(visibleCards[index].right <= visibleCards[index + 1].left + 1e-9);
      }
      for (const connector of current.connectors) {
        assert.ok(connector.to.x >= connector.from.x - 1e-9);
        assert.equal(connector.from.y, 590);
        assert.equal(connector.to.y, 590);
      }
      previousWidth = current.cardDeck.cardWidth;
      previousProgress = current.reflowProgress;
    }
  }

  assert.throws(
    () => visualSystemV1InterpolateCardDeck(base.cardDecksByCount[1], base.cardDecksByCount[3], 0.5),
    /每次增加一张/u
  );
  assert.throws(
    () => visualSystemV1InterpolateCardDeck(base.cardDecksByCount[1], base.cardDecksByCount[2], Number.NaN),
    /有限数值/u
  );
  assert.throws(
    () => visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame(base, Number.NaN),
    /有限帧号/u
  );
});

test("右上角AI品牌水印固定120px与40px安全边距并完整循环三次", () => {
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.schemaVersion, "visual-system-v1-ai-watermark-v2");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.outputFormat, "wide-only");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.role, "persistent-brand-watermark");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.contentSurfacePolicyExempt, true);
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.renderMode, "validated-transparent-png-sequence");
  assert.equal(
    VISUAL_SYSTEM_V1_AI_WATERMARK.defaultProfileId,
    "approved-v013-stable-footprint"
  );
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.rasterSequence.assetVersion, 13);
  assert.equal(
    VISUAL_SYSTEM_V1_AI_WATERMARK.rasterSequence.assetRoot,
    "assets/visual-system-v1/ai-watermark-v013/frames"
  );
  assert.equal(
    VISUAL_SYSTEM_V1_AI_WATERMARK.motionSchemaVersion,
    "visual-system-v1-ai-watermark-motion-proof-v12"
  );
  assert.deepEqual(VISUAL_SYSTEM_V1_AI_WATERMARK.placement, {
    size: 120,
    top: 40,
    right: 40,
    zIndex: 6
  });
  assert.deepEqual(visualSystemV1AiWatermarkGeometry(1920, 1080), {
    left: 1760,
    top: 40,
    right: 40,
    bottom: 920,
    width: 120,
    height: 120,
    zIndex: 6
  });
  assert.equal(visualSystemV1AiWatermarkScale(120), 0.46);
  assert.throws(() => visualSystemV1AiWatermarkGeometry(1080, 1920), /默认只允许/u);

  const watermark = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark;
  assert.equal(watermark.enabled, true);
  assert.equal(watermark.component, "six-face-extruded-ai");
  assert.equal(watermark.contentSurfacePolicyExempt, true);
  assert.equal(watermark.completeCycles, 3);
  assert.equal(watermark.motionSchemaVersion, VISUAL_SYSTEM_V1_AI_WATERMARK.motionSchemaVersion);
  assert.deepEqual(watermark.rasterSequence, VISUAL_SYSTEM_V1_AI_WATERMARK.rasterSequence);
  assert.deepEqual(watermark.placement, VISUAL_SYSTEM_V1_AI_WATERMARK.placement);
  assert.deepEqual(watermark.motion.directionPattern, [
    "x-forward",
    "y-forward",
    "x-reverse",
    "y-reverse"
  ]);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.durationInFrames, 360);
  assert.equal(360 / watermark.motion.cycleFrames, 3);
  for (const frame of [0, 120, 240, 360]) {
    assert.deepEqual(aiWatermarkMotionAtFrame(frame), aiWatermarkMotionAtFrame(0));
  }
  assert.notDeepEqual(aiWatermarkMotionAtFrame(15), aiWatermarkMotionAtFrame(75));
  assert.notDeepEqual(aiWatermarkMotionAtFrame(45), aiWatermarkMotionAtFrame(105));
});

test("样片五个同层级节点全部平面，浅立体能力保留但默认不实例化", () => {
  const inventory = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.componentInventory;
  assert.equal(inventory.flatWorkflow.length, 5);
  assert.deepEqual(inventory.shallowDepthRuntime, []);
  assert.deepEqual(inventory.shallowDepthAvailable, VISUAL_SYSTEM_V1_DEPTH_ROLES);
  assert.deepEqual(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.surfacePolicy, {
    defaultMode: "flat-only",
    sameLevelSurfaceUniform: true,
    outputFormat: "wide-only",
    contentFrameMode: "open-canvas",
    topHeaderRuntimeCount: 0,
    largeContentWindowRuntimeCount: 0,
    runtimeShallowDepthCount: 0,
    shallowDepthCapabilityRetained: true
  });
});

test("文字12帧轻弹精确落稳且全程单调无超调", () => {
  assert.deepEqual(visualSystemV1TextMotionAtFrame(10, 10), {
    progress: 0,
    opacity: 0,
    translateY: 6,
    scale: 0.985
  });
  assert.deepEqual(visualSystemV1TextMotionAtFrame(21, 10), {
    progress: 1,
    opacity: 1,
    translateY: 0,
    scale: 1
  });
  let previous = visualSystemV1TextMotionAtFrame(10, 10);
  for (let frame = 11; frame <= 21; frame += 1) {
    const current = visualSystemV1TextMotionAtFrame(frame, 10);
    assert.ok(current.opacity >= previous.opacity);
    assert.ok(current.translateY <= previous.translateY);
    assert.ok(current.scale >= previous.scale && current.scale <= 1);
    previous = current;
  }
});

test("节点保留18帧 Remotion spring，浅立体厚度不超过2.5px", () => {
  assert.deepEqual(visualSystemV1SpringMotionAtFrame(44, 44), {
    progress: 0,
    opacity: 0,
    translateY: 12,
    scale: 0.985
  });
  assert.deepEqual(visualSystemV1SpringMotionAtFrame(61, 44), {
    progress: 1,
    opacity: 1,
    translateY: 0,
    scale: 1
  });
  let previous = 0;
  for (let frame = 44; frame <= 61; frame += 1) {
    const current = visualSystemV1SpringMotionAtFrame(frame, 44);
    assert.ok(current.progress >= previous);
    assert.ok(current.progress >= 0 && current.progress <= 1);
    previous = current.progress;
  }
  for (let frame = 0; frame < 360; frame += 1) {
    const current = visualSystemV1DepthMotionAtFrame(frame, 108);
    assert.ok(current.depthPx >= 0 && current.depthPx <= 2.5);
  }
});

test("场景首尾8帧淡化且内部标题顺序交接不产生叠字", () => {
  const master = (frame) => visualSystemV1SceneOpacityAtFrame(frame, {
    startFrame: 0,
    endFrame: 360
  });
  assert.equal(master(0), 0);
  assert.equal(master(7), 1);
  assert.equal(master(352), 1);
  assert.equal(master(359), 0);
  const [a, b, c] = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.scenes;
  const firstHandoffTotals = [];
  for (let frame = 64; frame <= 71; frame += 1) {
    const outgoing = visualSystemV1SequentialSceneOpacityAtFrame(frame, a);
    const incoming = visualSystemV1SequentialSceneOpacityAtFrame(frame, b);
    assert.equal(outgoing * incoming, 0);
    assert.ok(outgoing + incoming <= 1);
    firstHandoffTotals.push(outgoing + incoming);
  }
  [1, 20 / 27, 7 / 27, 0, 7 / 27, 20 / 27, 1, 1].forEach((expected, index) => {
    assert.ok(almostEqual(firstHandoffTotals[index], expected));
  });
  for (let frame = 184; frame <= 191; frame += 1) {
    const outgoing = visualSystemV1SequentialSceneOpacityAtFrame(frame, b);
    const incoming = visualSystemV1SequentialSceneOpacityAtFrame(frame, c);
    assert.equal(outgoing * incoming, 0);
    assert.ok(outgoing + incoming <= 1);
  }
  assert.equal(visualSystemV1SequentialSceneOpacityAtFrame(0, a), 1);
  assert.equal(visualSystemV1SequentialSceneOpacityAtFrame(359, c), 1);
  assert.throws(
    () => visualSystemV1SequentialSceneOpacityAtFrame(0, { ...a, fadeFrames: 7 }),
    /偶数帧数/u
  );
});

test("每条连接线与目标卡片同帧启动，重排期间不会先露出悬空短线", () => {
  const timeline = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline;
  const pairs = [
    [timeline.skillToAgentFrame, timeline.agentEnterFrame],
    [timeline.agentToMcpFrame, timeline.mcpEnterFrame],
    [timeline.mcpToResultFrame, timeline.resultEnterFrame],
    [timeline.resultToHumanFrame, timeline.humanEnterFrame]
  ];
  for (const [connectorStartFrame, targetEnterFrame] of pairs) {
    assert.equal(connectorStartFrame, targetEnterFrame);
    assert.equal(
      visualSystemV1ConnectorMotionAtFrame(connectorStartFrame - 1, connectorStartFrame).progress,
      0
    );
    assert.equal(
      visualSystemV1SpringMotionAtFrame(targetEnterFrame - 1, targetEnterFrame).progress,
      0
    );
    assert.equal(
      visualSystemV1ConnectorMotionAtFrame(connectorStartFrame, connectorStartFrame).progress,
      0
    );
    assert.equal(
      visualSystemV1SpringMotionAtFrame(targetEnterFrame, targetEnterFrame).progress,
      0
    );
    assert.ok(
      visualSystemV1ConnectorMotionAtFrame(connectorStartFrame + 1, connectorStartFrame).progress > 0
    );
    assert.ok(visualSystemV1SpringMotionAtFrame(targetEnterFrame + 1, targetEnterFrame).progress > 0);
  }
});

test("底部三段章节进度按3比5比7真实时长连续单调推进", () => {
  assert.deepEqual(
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS.map(({ id, startFrame, endFrame }) => ({
      id,
      startFrame,
      endFrame
    })),
    [
      { id: "boundary", startFrame: 0, endFrame: 72 },
      { id: "execution", startFrame: 72, endFrame: 192 },
      { id: "review", startFrame: 192, endFrame: 360 }
    ]
  );
  assert.deepEqual(
    visualSystemV1ChapterProgressAtFrame(0, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments.map(({ status, progress }) => ({ status, progress })),
    [
      { status: "active", progress: 0 },
      { status: "future", progress: 0 },
      { status: "future", progress: 0 }
    ]
  );
  assert.equal(visualSystemV1ChapterProgressAtFrame(71, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments[0].progress, 1);
  assert.deepEqual(
    visualSystemV1ChapterProgressAtFrame(72, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments.map(({ status, progress }) => ({ status, progress })),
    [
      { status: "done", progress: 1 },
      { status: "active", progress: 0 },
      { status: "future", progress: 0 }
    ]
  );
  assert.equal(visualSystemV1ChapterProgressAtFrame(191, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments[1].progress, 1);
  assert.equal(visualSystemV1ChapterProgressAtFrame(192, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments[2].progress, 0);
  assert.equal(visualSystemV1ChapterProgressAtFrame(359, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments[2].progress, 1);
  assert.deepEqual(
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS.map((chapter) => chapter.endFrame - chapter.startFrame),
    [72, 120, 168]
  );
  assert.deepEqual(
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS.map((chapter) => chapter.label),
    ["规则边界", "受控执行", "人工确认"]
  );
  let previous = -1;
  for (let frame = 0; frame < 360; frame += 1) {
    const state = visualSystemV1ChapterProgressAtFrame(frame, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS);
    const cumulative = state.segments.reduce((sum, segment) => sum + segment.progress, 0);
    assert.ok(cumulative >= previous);
    previous = cumulative;
  }
});

test("章节标签统一只显示序号和名称并防御性移除尾部秒数", async () => {
  assert.equal(visualSystemV1ChapterDisplayLabel("规则边界", 0), "01 · 规则边界");
  assert.equal(visualSystemV1ChapterDisplayLabel("规则边界 · 2.4s", 0), "01 · 规则边界");
  assert.equal(visualSystemV1ChapterDisplayLabel("受控执行•4秒", 1), "02 · 受控执行");
  assert.equal(visualSystemV1ChapterDisplayLabel("iPhone 3S", 2), "03 · iPhone 3S");
  assert.equal(visualSystemV1ChapterDisplayLabel("S3 模型", 9), "10 · S3 模型");
  assert.throws(() => visualSystemV1ChapterDisplayLabel("", 0), /非空文本/u);
  assert.throws(() => visualSystemV1ChapterDisplayLabel("· 2.4s", 0), /不能只包含时长/u);
  assert.throws(() => visualSystemV1ChapterDisplayLabel("2.4s", 0), /不得包含时长/u);
  assert.throws(() => visualSystemV1ChapterDisplayLabel("人工确认 5.6 秒", 0), /不得包含时长/u);
  assert.throws(() => visualSystemV1ChapterDisplayLabel("关键第3秒", 0), /不得包含时长/u);
  assert.throws(() => visualSystemV1ChapterDisplayLabel("规则边界-2.4s", 0), /不得包含时长/u);
  assert.throws(() => visualSystemV1ChapterDisplayLabel("规则边界", -1), /非负整数/u);

  const sharedComponent = await source("../src/video/components/visual-system-v1/components.jsx");
  assert.ok(
    (sharedComponent.match(/visualSystemV1ChapterDisplayLabel/gu) ?? []).length >= 2,
    "V1 公共章节进度必须导入并调用统一章节标签格式器"
  );
});

test("章节完成切点保持满亮，不在71到72或191到192帧闪暗", async () => {
  const components = await source("../src/video/components/visual-system-v1/components.jsx");
  const progress = components.slice(
    components.indexOf("export function VisualSystemV1ChapterProgress"),
    components.indexOf("export function VisualSystemV1PlainSubtitle")
  );
  assert.match(progress, /opacity: 1/u);
  assert.match(progress, /left: layout\.vertical \? 54 : 90/u);
  assert.match(progress, /right: layout\.vertical \? 54 : 90/u);
  assert.match(progress, /bottom: layout\.vertical \? 18 : 16/u);
  assert.match(progress, /gap: layout\.vertical \? 8 : 15/u);
  assert.match(progress, /color: palette\.muted/u);
  assert.match(progress, /fontWeight: typography\.fontWeights\.navigation/u);
  assert.match(progress, /backgroundColor: palette\.mint/u);
  assert.match(progress, /visualSystemV1ChapterDisplayLabel\(chapter\.label, index\)/u);
  assert.doesNotMatch(progress, /segment\.status === "done"[^\n]*opacity|opacity:\s*segment\.status/u);
  assert.doesNotMatch(progress, /chapter\.accent|labelColor|palette\.purple/u);
});

test("浅立体只执行一次2px轻悬浮并永久回到静止", () => {
  assert.equal(visualSystemV1HoverProgressAtFrame(277), 0);
  assert.equal(visualSystemV1HoverProgressAtFrame(278), 0);
  assert.equal(visualSystemV1HoverProgressAtFrame(287), 1);
  assert.equal(visualSystemV1HoverProgressAtFrame(291), 1);
  assert.equal(visualSystemV1HoverProgressAtFrame(305), 0);
  assert.equal(visualSystemV1HoverProgressAtFrame(359), 0);
  for (let frame = 0; frame < 360; frame += 1) {
    const state = visualSystemV1DepthMotionAtFrame(frame, 252, { hover: true });
    assert.ok(state.hoverProgress >= 0 && state.hoverProgress <= 1);
    assert.ok(state.translateY >= -2 && state.translateY <= 12);
  }
});

test("壁纸使用全局20秒周期且位移不超过画幅1.5%", () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    assert.deepEqual(
      visualSystemV1WallpaperMotionAtFrame(0, width, height),
      visualSystemV1WallpaperMotionAtFrame(600, width, height)
    );
    for (let frame = 0; frame <= 600; frame += 1) {
      const state = visualSystemV1WallpaperMotionAtFrame(frame, width, height);
      for (const layer of Object.values(state)) {
        assert.ok(Math.abs(layer.x) <= width * 0.015);
        assert.ok(Math.abs(layer.y) <= height * 0.015);
      }
    }
  }
});

test("字幕为稳定纯黑文字、无阴影、透明无描边且没有闪烁动效", async () => {
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CAPTIONS.length, 3);
  for (const caption of VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CAPTIONS) {
    assert.deepEqual(Object.keys(caption), [
      "text",
      "startMs",
      "endMs",
      "timestampMs",
      "confidence"
    ]);
    assert.ok(caption.endMs > caption.startMs);
    assert.doesNotMatch(caption.text, /\n/u);
  }
  const component = await source("../src/video/components/visual-system-v1/components.jsx");
  const subtitle = component.slice(component.indexOf("export function VisualSystemV1PlainSubtitle"));
  assert.match(subtitle, /data-visual-system-subtitle="stable-black-no-container"/u);
  assert.match(subtitle, /color: VISUAL_SYSTEM_V1\.defaults\.subtitleColor/u);
  assert.match(subtitle, /WebkitLineClamp: typography\.subtitleMaximumLines/u);
  assert.match(subtitle, /textShadow: "none"/u);
  assert.match(subtitle, /WebkitTextStroke: "0"/u);
  assert.doesNotMatch(subtitle, /visualSystemV1TextMotionAtFrame|state\.opacity|state\.translateY|state\.scale/u);
});

test("v9开放画布使用场景自适应平面流程且保留独立AI品牌水印", async () => {
  const [component, workflow, root, mainRoot, index, watermarkComponent] = await Promise.all([
    source("../src/video/visual-system-v1-skill-agent-mcp-proof.jsx"),
    source("../src/video/visual-system-v1-skill-agent-mcp-scenes/workflow.jsx"),
    source("../src/video/visual-system-v1-skill-agent-mcp-proof-root.jsx"),
    source("../src/video/root.jsx"),
    source("../src/video/components/visual-system-v1/index.jsx"),
    source("../src/video/components/visual-system-v1/ai-watermark.jsx")
  ]);
  assert.equal((component.match(/<VisualSystemV1SingleContentWindow\b/gu) ?? []).length, 0);
  assert.equal((component.match(/<VisualSystemV1OpenCanvasHeader\b/gu) ?? []).length, 0);
  assert.doesNotMatch(component, /VisualSystemV1OpenCanvasHeader/u);
  assert.match(component, /data-visual-system-content="open-canvas"/u);
  assert.match(component, /data-visual-system-master-fade="paint-overlay"/u);
  assert.match(component, /backgroundColor: `rgba\(242, 246, 243, \$\{1 - masterOpacity\}\)`/u);
  assert.doesNotMatch(component, /style=\{\{ position: "absolute", inset: 0, opacity: masterOpacity \}\}/u);
  assert.equal((workflow.match(/<VisualSystemV1FlatNode\b/gu) ?? []).length, 5);
  assert.equal((workflow.match(/layoutMode="fill-safe-viewport"/gu) ?? []).length, 5);
  assert.equal((workflow.match(/focusProgress=\{/gu) ?? []).length, 5);
  assert.equal((workflow.match(/nodeId="/gu) ?? []).length, 5);
  assert.match(workflow, /useCurrentFrame/u);
  assert.match(workflow, /visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame/u);
  assert.match(workflow, /data-scene-adaptive-layout="visible-node-count"/u);
  assert.match(workflow, /data-visible-card-count=\{adaptiveLayout\.visibleCount\}/u);
  assert.match(workflow, /adaptiveLayout\.connectors\.map/u);
  assert.match(workflow, /style=\{\{ position: "absolute", inset: 0, zIndex: 2 \}\}/u);
  assert.equal((component.match(/style=\{\{ zIndex: 1 \}\}/gu) ?? []).length, 3);
  assert.equal((component.match(/transitionMode="sequential-copy"/gu) ?? []).length, 3);
  assert.doesNotMatch(`${component}\n${workflow}`, /contain: "paint"|isolation: "isolate"/u);
  assert.doesNotMatch(workflow, /VisualSystemV1ActiveNode|VisualSystemV1KeyResult|VisualSystemV1HumanConfirmation/u);
  assert.match(index, /VisualSystemV1ActiveNode/u);
  assert.match(index, /VisualSystemV1KeyResult/u);
  assert.match(index, /VisualSystemV1HumanConfirmation/u);
  assert.match(index, /VisualSystemV1OpenCanvasHeader/u);
  assert.match(index, /VisualSystemV1AiWatermark/u);
  assert.equal((component.match(/<VisualSystemV1AiWatermark\b/gu) ?? []).length, 1);
  assert.ok(
    component.indexOf("<VisualSystemV1AiWatermark") >
      component.indexOf("<VisualSystemV1SkillAgentMcpWorkflow")
  );
  assert.ok(
    component.indexOf("<VisualSystemV1AiWatermark") <
      component.indexOf("<VisualSystemV1PlainSubtitle")
  );
  assert.match(watermarkComponent, /data-visual-system-ai-watermark="persistent-six-face-ai"/u);
  assert.match(watermarkComponent, /data-ai-watermark-open-cube="six-extruded-ai-faces"/u);
  assert.match(watermarkComponent, /overflow: "hidden"/u);
  assert.match(watermarkComponent, /pointerEvents: "none"/u);
  assert.match(watermarkComponent, /useCurrentFrame/u);
  assert.doesNotMatch(
    watermarkComponent,
    /ProofBackground|640|animation\s*:|transition\s*:|@keyframes|requestAnimationFrame|Math\.random/u
  );
  assert.match(component, /<VisualSystemV1ChapterProgress/u);
  assert.ok(component.indexOf("<VisualSystemV1ChapterProgress") > component.indexOf("</div>"));
  assert.doesNotMatch(component, /<VisualSystemV1PlainSubtitle[\s\S]*opacity=/u);
  assert.match(root, /compositions\.wide\.id/u);
  assert.doesNotMatch(root, /compositions\.vertical/u);
  assert.doesNotMatch(mainRoot, /VisualSystemV1SkillAgentMcpProof/u);
  const all = `${component}\n${workflow}`;
  assert.doesNotMatch(all, /CanvasImage|<Img|<Video|staticFile|battery|charging|percentage|orange|#F2783A|#5276E6/iu);
  assert.doesNotMatch(all, /animation\s*:|transition\s*:|@keyframes|Math\.random|requestAnimationFrame/iu);
});

test("统一平面节点使用清晰完整3px边框且没有阴影或伪立体底托", async () => {
  const components = await source("../src/video/components/visual-system-v1/components.jsx");
  const flatNode = components.slice(
    components.indexOf("export function VisualSystemV1FlatNode"),
    components.indexOf("function semanticPrimitiveSurface")
  );
  assert.match(flatNode, /border: `3px solid \$\{mixHexColors\(palette\.lineStrong, focusBorder, normalizedFocus\)\}`/u);
  assert.match(flatNode, /data-visual-system-card-border="full-outline-3px"/u);
  assert.match(flatNode, /borderRadius: 18/u);
  assert.match(flatNode, /boxShadow: "none"/u);
  assert.match(flatNode, /backgroundImage: "none"/u);
  assert.match(flatNode, /data-visual-system-focus=\{normalizedFocus >= 0\.5 \? "primary" : "context"\}/u);
  assert.match(flatNode, /backgroundColor: mixHexColors\(palette\.paperWarm, focusSurface, normalizedFocus, 0\.76\)/u);
  assert.match(flatNode, /data-visual-system-card-layout=\{layoutMode\}/u);
  assert.match(flatNode, /visualSystemV1AdaptiveCardTypography\(cardWidth, cardHeight\)/u);
  assert.match(flatNode, /data-visual-system-card-typography=\{cardTypography\?\.mode/u);
  assert.match(flatNode, /fontSize: cardTypography\?\.markerFontSizePx \?\? 13/u);
  assert.match(flatNode, /fontSize: cardTypography\?\.labelFontSizePx \?\? 28/u);
  assert.match(flatNode, /fontSize: cardTypography\?\.detailFontSizePx \?\? 18/u);
  assert.match(flatNode, /const settled = state\.progress >= 1/u);
  assert.match(flatNode, /if \(state\.progress <= 0\) return null/u);
  assert.match(flatNode, /const animatedTop = Number\.isFinite\(style\.top\) && !settled/u);
  assert.match(flatNode, /top: animatedTop/u);
  assert.doesNotMatch(flatNode, /opacity: state\.opacity|translate:|scale:|transform:/u);
  assert.match(flatNode, /justifyContent: fillsSafeViewport \? "center" : undefined/u);
  assert.match(flatNode, /filter: "none"/u);
  assert.doesNotMatch(flatNode, /borderTop|borderBottom|linear-gradient|depthPx/u);
});

test("语义信息卡使用完整外框，时间锚点与数量条仍保留非卡片图解形态", async () => {
  const components = await source("../src/video/components/visual-system-v1/components.jsx");
  const semanticSurface = components.slice(
    components.indexOf("function semanticPrimitiveSurface"),
    components.indexOf("export function VisualSystemV1SemanticNode")
  );
  assert.match(semanticSurface, /const fullOutline = \{/u);
  assert.match(semanticSurface, /border: `3px solid \$\{mixHexColors\(/u);
  assert.match(semanticSurface, /palette\.lineStrong/u);
  assert.match(semanticSurface, /borderRadius: 18/u);
  assert.match(semanticSurface, /boxShadow: "none"/u);
  assert.match(semanticSurface, /if \(surfaceRole === "information-card"\) return fullOutline/u);
  assert.doesNotMatch(semanticSurface, /primitive === "flow-step"[\s\S]*\.\.\.fullOutline/u);
  assert.match(semanticSurface, /primitive === "timeline-anchor"[\s\S]*\.\.\.openDiagram/u);
  assert.match(semanticSurface, /primitive === "quantity-bar"[\s\S]*\.\.\.openDiagram/u);
  assert.match(components, /data-visual-system-surface-border=\{surface\.border === "none" \? "open-diagram" : "full-outline"\}/u);
});

test("标题弹出用逐帧位置和颜色通道而不创建透明变换合成层", async () => {
  const components = await source("../src/video/components/visual-system-v1/components.jsx");
  const popText = components.slice(
    components.indexOf("export function VisualSystemV1PopText"),
    components.indexOf("export function VisualSystemV1SceneLayer")
  );
  assert.match(popText, /if \(state\.progress <= 0\) return null/u);
  assert.match(popText, /const settled = state\.progress >= 1/u);
  assert.match(popText, /const animatedTop = Number\.isFinite\(style\.top\) && !settled/u);
  assert.match(popText, /top: animatedTop/u);
  assert.match(popText, /color: colorWithAlpha\(style\.color, state\.opacity \* sceneOpacity\)/u);
  assert.doesNotMatch(popText, /opacity:|translate:|scale:|transform:/u);
});

test("场景8帧淡化通过文字颜色通道而不是全屏透明合成面", async () => {
  const components = await source("../src/video/components/visual-system-v1/components.jsx");
  const sceneLayer = components.slice(
    components.indexOf("export function VisualSystemV1SceneLayer"),
    components.indexOf("export function VisualSystemV1FlatNode")
  );
  assert.match(sceneLayer, /<SceneOpacityContext\.Provider value=\{opacity\}>/u);
  assert.match(sceneLayer, /data-scene-opacity=\{opacity\}/u);
  assert.match(sceneLayer, /visualSystemV1SequentialSceneOpacityAtFrame/u);
  assert.match(sceneLayer, /scene-copy-sequential-fade-8f/u);
  assert.doesNotMatch(sceneLayer, /style=\{\{[^}]*opacity/u);
});

test("旧v012透明水印序列完整保留且正式组件仍支持按profile逐帧读取", async () => {
  const manifestUrl = new URL(
    "../public/assets/visual-system-v1/ai-watermark-v012/manifest.json",
    import.meta.url
  );
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  assert.equal(manifest.sourceMotionSchemaVersion, "visual-system-v1-ai-watermark-motion-proof-v12");
  assert.equal(manifest.frameCount, 120);
  assert.equal(manifest.transparentBackgroundRequired, true);
  assert.deepEqual(Object.keys(manifest.frames).map(Number), Array.from({ length: 120 }, (_, i) => i));
  const frames = await Promise.all(
    Array.from({ length: 120 }, (_, frame) =>
      readFile(
        new URL(
          `../public/assets/visual-system-v1/ai-watermark-v012/frames/frame-${String(frame).padStart(3, "0")}.png`,
          import.meta.url
        )
      )
    )
  );
  for (const frame of frames) {
    assert.equal(frame.toString("ascii", 1, 4), "PNG");
    assert.equal(frame.readUInt32BE(16), 120);
    assert.equal(frame.readUInt32BE(20), 120);
    assert.equal(frame[25], 6);
  }
  const component = await source("../src/video/components/visual-system-v1/ai-watermark.jsx");
  const persistent = component.slice(component.indexOf("export function VisualSystemV1AiWatermark({"));
  assert.match(persistent, /profile = VISUAL_SYSTEM_V1_AI_WATERMARK\.defaultProfileId/u);
  assert.match(persistent, /data-ai-watermark-raster-sequence=\{resolvedProfile\.rasterSequenceLabel\}/u);
  assert.match(
    persistent,
    /staticFile\(rasterFramePath\(cadenceState\.rasterFrame, resolvedProfile\)\)/u
  );
  assert.doesNotMatch(persistent, /<AiOpenCube/u);
  assert.match(component, /data-ai-watermark-live-object="css-3d-raster-source-only"/u);
});

test("安全直渲合同固定单一横版、静音和独立v013场景自适应候选", async () => {
  assert.equal(
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.candidateDirectoryName,
    "visual-system-v1-skill-agent-mcp-proof-v013"
  );
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.candidateVersion, 13);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.concurrency, 1);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.durationInFrames, 360);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.audioTrack, false);
  assert.deepEqual(Object.keys(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.outputs), ["wide"]);
  assert.deepEqual(
    [
      VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.outputs.wide.width,
      VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.outputs.wide.height
    ],
    [1920, 1080]
  );
  const renderer = await source("../scripts/render-visual-system-v1-skill-agent-mcp-proof.mjs");
  assert.match(renderer, /muted: true/u);
  assert.match(renderer, /enforceAudioTrack: false/u);
  assert.match(renderer, /overwrite: false/u);
  assert.match(renderer, /onBrowserDownload: denyBrowserDownload/u);
  assert.match(renderer, /formalEpisodeStateTouched: false/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v001/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v002/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v003/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v004/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v005/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v006/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v007/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v010/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v011/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v012/u);
  assert.match(renderer, /visual-system-v1-ai-watermark-motion-proof-v011/u);
  assert.match(renderer, /visual-system-v1-ai-watermark-motion-proof-v012/u);
  assert.match(renderer, /visual-system-v1-ai-watermark-size-proof-v002/u);
  assert.deepEqual(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_WATERMARK_PROVENANCE, {
    motionCandidate:
      "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v012",
    motionCandidateVersion: 12,
    motionSchemaVersion: "visual-system-v1-ai-watermark-motion-proof-v12",
    sizeCandidate:
      "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-size-proof-v002",
    rasterAssetManifest:
      "studio/public/assets/visual-system-v1/ai-watermark-v012/manifest.json",
    rasterAssetVersion: 12,
    rasterAssetFrameCount: 120
  });
  assert.match(renderer, /watermarkApprovalProvenance/u);
  assert.match(renderer, /adaptiveCardDeck/u);
  assert.match(renderer, /scene-adaptive-visible-node-count/u);
  assert.match(renderer, /layoutsByVisibleCount/u);
  assert.match(renderer, /cardTypography/u);
  assert.match(renderer, /sameLevelEqualSize/u);
  assert.match(renderer, /protectedTrees/u);
  assert.doesNotMatch(renderer, /runAgent|runNextReadyAgent|renderPreview|runPreviewQa|cloudBackup/u);
});
