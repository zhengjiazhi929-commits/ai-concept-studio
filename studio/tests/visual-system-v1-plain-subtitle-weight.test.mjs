import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { VISUAL_SYSTEM_V1 } from "../src/video/components/visual-system-v1/tokens.mjs";
import {
  VISUAL_SYSTEM_V1_SUBTITLE_VISUAL_WEIGHTS,
  visualSystemV1Layout,
  visualSystemV1SubtitleFontSize
} from "../src/video/components/visual-system-v1/layout.mjs";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("完整句字幕保持原字号，密集图解辅助字幕使用更低且横竖稳定的字号", () => {
  const wide = visualSystemV1Layout(1920, 1080);
  const vertical = visualSystemV1Layout(1080, 1920);

  assert.deepEqual(VISUAL_SYSTEM_V1_SUBTITLE_VISUAL_WEIGHTS, ["primary", "supporting"]);
  assert.equal(visualSystemV1SubtitleFontSize(wide), VISUAL_SYSTEM_V1.typography.subtitleWidePx);
  assert.equal(
    visualSystemV1SubtitleFontSize(vertical, "primary"),
    VISUAL_SYSTEM_V1.typography.subtitleVerticalPx
  );
  assert.equal(
    visualSystemV1SubtitleFontSize(wide, "supporting"),
    VISUAL_SYSTEM_V1.typography.subtitleSupportingWidePx
  );
  assert.equal(
    visualSystemV1SubtitleFontSize(vertical, "supporting"),
    VISUAL_SYSTEM_V1.typography.subtitleSupportingVerticalPx
  );
  assert.equal(VISUAL_SYSTEM_V1.typography.subtitleSupportingWidePx, 36);
  assert.equal(VISUAL_SYSTEM_V1.typography.subtitleSupportingVerticalPx, 34);
});

test("字幕视觉权重遇到未知值时 fail-closed", () => {
  const wide = visualSystemV1Layout(1920, 1080);
  assert.throws(
    () => visualSystemV1SubtitleFontSize(wide, "dense"),
    /只允许 primary\/supporting/u
  );
  assert.throws(
    () => visualSystemV1SubtitleFontSize(null, "primary"),
    /有效的 visual-system-v1 布局/u
  );
});

test("长片显式把字幕门控视觉权重交给纯字幕组件", async () => {
  const [component, longReview] = await Promise.all([
    source("../src/video/components/visual-system-v1/components.jsx"),
    source("../src/video/agent-skill-long-review.jsx")
  ]);
  const subtitle = component.slice(
    component.indexOf("export function VisualSystemV1PlainSubtitle")
  );

  assert.match(subtitle, /visualWeight = "primary"/u);
  assert.match(subtitle, /visualSystemV1SubtitleFontSize\(layout, visualWeight\)/u);
  assert.match(subtitle, /data-visual-system-subtitle-weight=\{visualWeight\}/u);
  assert.match(longReview, /visualWeight=\{subtitleGate\.visualWeight \?\? "primary"\}/u);
});
