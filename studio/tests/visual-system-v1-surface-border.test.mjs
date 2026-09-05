import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { VISUAL_SYSTEM_V1 } from "../src/video/components/visual-system-v1/tokens.mjs";
import {
  visualSystemV1InformationCardSurfaceAtFocus
} from "../src/video/components/visual-system-v1/surface-border.mjs";

const source = async (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

function hexRgb(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function rgba(value) {
  const match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/u.exec(value);
  if (!match) throw new TypeError(`无法解析颜色：${value}`);
  return {
    rgb: match.slice(1, 4).map(Number),
    alpha: Number(match[4])
  };
}

function composite(foreground, alpha, background) {
  return foreground.map((channel, index) =>
    Math.round(channel * alpha + background[index] * (1 - alpha))
  );
}

function relativeLuminance(rgb) {
  const channels = rgb.map((channel) => channel / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(left, right) {
  const luminances = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

test("信息卡和语义分组使用分层但都清晰可见的完整四边框", () => {
  const { surfaceBorder, palette } = VISUAL_SYSTEM_V1;
  assert.equal(surfaceBorder.minimumContrastRatio, 3);
  assert.deepEqual(surfaceBorder.informationCard, {
    mode: "full-outline",
    widthPx: 3,
    restingColor: "#5A8A77",
    mintFocusColor: "#17795D",
    purpleFocusColor: "#5B45AA",
    flatSurfaceAlpha: 0.76,
    semanticSurfaceAlpha: 0.92,
    semanticBorderFocusScale: 0.82
  });
  assert.deepEqual(surfaceBorder.semanticGroup, {
    mode: "full-outline",
    widthPx: 2,
    contextualColor: "#5F927D",
    completeBoundaryColor: "#17795D"
  });
  assert.ok(surfaceBorder.informationCard.widthPx > surfaceBorder.semanticGroup.widthPx);
  for (const background of [palette.paper, palette.paperWarm]) {
    for (const foreground of [
      surfaceBorder.informationCard.restingColor,
      surfaceBorder.informationCard.mintFocusColor,
      surfaceBorder.informationCard.purpleFocusColor,
      surfaceBorder.semanticGroup.contextualColor,
      surfaceBorder.semanticGroup.completeBoundaryColor
    ]) {
      assert.ok(
        contrastRatio(hexRgb(background), hexRgb(foreground)) >= surfaceBorder.minimumContrastRatio,
        `${foreground} 在 ${background} 上的边界对比不足`
      );
    }
  }
});

test("信息卡全焦点插值在真实半透明与渐变背景上始终达到 3 比 1", () => {
  const { palette, wallpaper, surfaceBorder } = VISUAL_SYSTEM_V1;
  const paper = hexRgb(palette.paper);
  const mintBackdrop = composite(hexRgb(palette.mintSoft), wallpaper.mintOpacity, paper);
  const purpleBackdrop = composite(hexRgb(palette.purpleSoft), wallpaper.purpleOpacity, paper);
  const overlappingGradientBackdrop = composite(
    hexRgb(palette.purpleSoft),
    wallpaper.purpleOpacity,
    mintBackdrop
  );
  const backdrops = [paper, mintBackdrop, purpleBackdrop, overlappingGradientBackdrop];
  for (const variant of ["flat", "semantic"]) {
    for (const accent of ["mint", "purple"]) {
      for (const focusProgress of [0, 0.25, 0.5, 0.75, 1]) {
        const surface = visualSystemV1InformationCardSurfaceAtFocus({
          accent,
          focusProgress,
          variant
        });
        const border = rgba(surface.borderColor);
        const cardBackground = rgba(surface.backgroundColor);
        assert.equal(border.alpha, 1);
        for (const backdrop of backdrops) {
          const renderedBackground = composite(
            cardBackground.rgb,
            cardBackground.alpha,
            backdrop
          );
          assert.ok(
            contrastRatio(border.rgb, renderedBackground) >= surfaceBorder.minimumContrastRatio,
            `${variant}/${accent}/${focusProgress} 的实际合成边框对比不足`
          );
        }
      }
    }
  }
});

test("内容窗口和浅立体卡片也使用公共边框，真实窗口与渐变面不低于 3 比 1", async () => {
  const { palette, surfaceBorder, wallpaper } = VISUAL_SYSTEM_V1;
  const paper = hexRgb(palette.paper);
  const backdrops = [
    paper,
    composite(hexRgb(palette.mintSoft), wallpaper.mintOpacity, paper),
    composite(hexRgb(palette.purpleSoft), wallpaper.purpleOpacity, paper)
  ];
  const windowSurface = rgba(palette.window);
  for (const backdrop of backdrops) {
    const renderedWindow = composite(windowSurface.rgb, windowSurface.alpha, backdrop);
    assert.ok(
      contrastRatio(hexRgb(surfaceBorder.semanticGroup.contextualColor), renderedWindow) >=
        surfaceBorder.minimumContrastRatio
    );
  }
  for (const [borderColor, faceColor] of [
    [surfaceBorder.informationCard.mintFocusColor, palette.mintSoft],
    [surfaceBorder.informationCard.purpleFocusColor, palette.purpleSoft]
  ]) {
    const face = hexRgb(faceColor);
    const translucentWhiteGradientStop = composite([255, 255, 255], 0.78, face);
    assert.ok(contrastRatio(hexRgb(borderColor), face) >= surfaceBorder.minimumContrastRatio);
    assert.ok(
      contrastRatio(hexRgb(borderColor), translucentWhiteGradientStop) >=
        surfaceBorder.minimumContrastRatio
    );
  }

  const components = await source("../src/video/components/visual-system-v1/components.jsx");
  const windowComponent = components.slice(
    components.indexOf("export function VisualSystemV1SingleContentWindow"),
    components.indexOf("export function VisualSystemV1PopText")
  );
  const depthComponent = components.slice(
    components.indexOf("function VisualSystemV1ShallowDepthObject"),
    components.indexOf("export function VisualSystemV1ActiveNode")
  );
  assert.match(windowComponent, /data-visual-system-group-border/u);
  assert.match(windowComponent, /surfaceBorder\.semanticGroup\.widthPx/u);
  assert.doesNotMatch(windowComponent, /border:\s*`1px/u);
  assert.match(depthComponent, /data-visual-system-depth-side-border/u);
  assert.match(depthComponent, /data-visual-system-card-border/u);
  assert.match(depthComponent, /surfaceBorder\.semanticGroup\.widthPx/u);
  assert.match(depthComponent, /surfaceBorder\.informationCard\.widthPx/u);
  assert.doesNotMatch(depthComponent, /border:\s*`1px|rgba\([^)]*\.2[257]\).*border/iu);
});

test("长片分组不再用单条上边线冒充容器，卡片与分组都绑定公共边框 token", async () => {
  const [longReview, components] = await Promise.all([
    source("../src/video/agent-skill-long-review.jsx"),
    source("../src/video/components/visual-system-v1/components.jsx")
  ]);
  const groupComponent = longReview.slice(
    longReview.indexOf("function AdaptiveSemanticGroups"),
    longReview.indexOf("function AdaptiveConnectors")
  );
  assert.match(groupComponent, /data-visual-system-group-border/u);
  assert.match(groupComponent, /surfaceBorder\.semanticGroup\.widthPx/u);
  assert.match(groupComponent, /border: `\$\{surfaceBorder\.semanticGroup\.widthPx\}px solid \$\{groupBorderColor\}`/u);
  assert.doesNotMatch(groupComponent, /borderTop/u);
  assert.doesNotMatch(groupComponent, /border:\s*isCompleteBoundary/u);
  assert.match(components, /data-visual-system-card-border/u);
  assert.match(components, /visualSystemV1InformationCardSurfaceAtFocus/u);
  assert.match(components, /surfaceBorder\.informationCard\.widthPx/u);
  const flatNode = components.slice(
    components.indexOf("export function VisualSystemV1FlatNode"),
    components.indexOf("function semanticPrimitiveSurface")
  );
  assert.ok(
    flatNode.lastIndexOf("border:") > flatNode.indexOf("...style"),
    "调用方 style 不能覆盖信息卡完整边框"
  );
});
