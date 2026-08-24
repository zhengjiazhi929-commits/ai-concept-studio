import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const studioRoot = resolve(import.meta.dirname, "..");

test("视觉系统配置固定16:9母版和9:16重构输出", async () => {
  const config = JSON.parse(
    await readFile(resolve(studioRoot, "config", "visual-system.json"), "utf8")
  );
  assert.deepEqual(
    [config.master.width, config.master.height, config.master.fps],
    [1920, 1080, 30]
  );
  assert.deepEqual(
    [config.derivatives.vertical.width, config.derivatives.vertical.height],
    [1080, 1920]
  );
  assert.equal(config.derivatives.vertical.strategy, "recompose-and-focus");
  assert.equal(config.id, "desktop-light-window-editorial-v3");
  assert.equal(config.motion.stageManager.mode, "single-window-two-phase");
  assert.equal(config.motion.stageManager.overlapFrames, 0);
  assert.equal(config.motion.stageManager.holdFrames, 3);
  assert.ok(config.motion.stageManager.enterScale >= 0.95);
  assert.ok(config.motion.stageManager.exitScale >= 0.9);
  assert.ok(config.motion.stageManager.exitScale < 1);
  assert.equal(config.colors.canvas, "#F2F2F4");
  assert.equal(config.diagram.theme, "light-control-plane");
  assert.ok(config.motion.references.some((item) => item.name === "Apple Stage Manager"));
  assert.ok(config.motion.references.some((item) => item.name === "Apple Keynote Magic Move"));
});

test("样片规范禁用播放器时间元素但保留无秒数的语义章节进度", async () => {
  const config = JSON.parse(
    await readFile(resolve(studioRoot, "config", "visual-system.json"), "utf8")
  );
  for (const item of ["progress-bar", "playhead", "elapsed-time", "total-time", "chapter-count", "chapter-duration-text"]) {
    assert.ok(config.forbidden.includes(item));
  }
  assert.deepEqual(config.chapterProgress, {
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
  assert.deepEqual(config.cardDeck, {
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
  assert.deepEqual(config.cardTypography, {
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
  assert.equal(config.motion.cardReflowFrames, 8);
  assert.equal(config.motion.cardFocusFrames, 12);
  for (const item of ["dark-theme", "dual-window-overlap-transition", "window-blur-transition"]) {
    assert.ok(config.forbidden.includes(item));
  }
});

test("样片包含双比例Composition且不复用旧ProgressStrip", async () => {
  const root = await readFile(resolve(studioRoot, "src", "video", "root.jsx"), "utf8");
  const sample = await readFile(
    resolve(studioRoot, "src", "video", "visual-system-sample.jsx"),
    "utf8"
  );
  const components = await readFile(
    resolve(studioRoot, "src", "video", "components", "visual-system.jsx"),
    "utf8"
  );
  assert.match(root, /VisualSystemSampleWide/u);
  assert.match(root, /VisualSystemSampleVertical/u);
  assert.doesNotMatch(sample, /ProgressStrip/u);
  assert.match(sample, /stageWindowMotion/u);
  assert.match(sample, /activeSceneEntry/u);
  assert.doesNotMatch(sample, /scaleX\(/u);
  assert.doesNotMatch(components, /motion\.blur/u);
  assert.doesNotMatch(components, /transformOrigin: "0% 50%"/u);
});
