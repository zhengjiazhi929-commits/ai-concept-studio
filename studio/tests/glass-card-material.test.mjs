import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GLASS_CARD_MATERIAL, frostedCardStyle } from "../src/video/glass-card-preview/material.mjs";

const entry = fileURLToPath(new URL("../src/video/glass-card-preview/cards.jsx", import.meta.url));
const built = await build({ entryPoints: [entry], bundle: true, write: false, format: "cjs",
  platform: "node", packages: "external", logLevel: "silent" });
const module = { exports: {} };
vm.runInThisContext(`(function(module, exports, require) {\n${built.outputFiles[0].text}\n})`)(module, module.exports, createRequire(entry));
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test("glass material is immutable, uses mint theme and stays a non-production candidate", () => {
  assert.ok(Object.isFrozen(GLASS_CARD_MATERIAL));
  assert.equal(GLASS_CARD_MATERIAL.id, "mint-frosted-thin-v001");
  assert.equal(GLASS_CARD_MATERIAL.productionApproved, false);
  assert.equal(GLASS_CARD_MATERIAL.background, "#F2F6F3");
  assert.equal(GLASS_CARD_MATERIAL.ink, "#14211D");
  assert.throws(() => { GLASS_CARD_MATERIAL.blur = 99; }, TypeError);
});

test("all four edges, inset highlight and offset shadow remain present in each emphasis state", () => {
  for (const emphasis of [false, true]) {
    const style = frostedCardStyle({ width: 900, minHeight: 340, emphasis });
    assert.match(style.border, /^1\.5px solid /u);
    assert.match(style.boxShadow, /inset/u);
    assert.match(style.boxShadow, /0 18px 36px/u);
    assert.equal(style.backdropFilter, "blur(14px) saturate(1.08)");
    assert.equal(style.WebkitBackdropFilter, style.backdropFilter);
    assert.equal(style.boxSizing, "border-box");
    assert.equal(style.filter, undefined);
    assert.equal(style.opacity, undefined);
  }
});

test("cards grow with text instead of clipping content or reducing font size", () => {
  const style = frostedCardStyle({ width: 1360, minHeight: 380 });
  assert.equal(style.width, 1360);
  assert.equal(style.minHeight, 380);
  assert.equal(style.height, undefined);
  assert.equal(style.maxHeight, undefined);
  assert.equal(style.overflow, undefined);
  assert.equal(style.transform, undefined);
  const markup = render(module.exports.FrostedCard, { width: 1360, minHeight: 380,
    title: "Agent / 判断与验收", body: "先确认任务与能力边界，再选择执行顺序。\n检查结果、核对证据，最后决定采用或退回。" });
  assert.match(markup, /font-size:48px/u);
  assert.match(markup, /font-size:36px/u);
  assert.match(markup, /white-space:pre-line/u);
  assert.doesNotMatch(markup, /text-overflow|line-clamp|overflow:hidden|<svg|<img|✓|✔/u);
  assert.ok(markup.includes("Agent / 判断与验收"));
});

test("dark title and explanation maintain reading contrast across the candidate's light mint range", () => {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../gu).map((part) => parseInt(part, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const background of ["#F2F6F3", "#D3EADF", "#FFFFFF"]) {
    for (const foreground of [GLASS_CARD_MATERIAL.ink, GLASS_CARD_MATERIAL.secondary]) {
      assert.ok((luminance(background) + 0.05) / (luminance(foreground) + 0.05) >= 4.5);
    }
  }
});

test("invalid material geometry or emphasis fails before rendering", () => {
  for (const width of [0, -1, 300, 1900, Infinity, NaN, "900"]) {
    assert.throws(() => frostedCardStyle({ width, minHeight: 300 }), /width/u);
  }
  for (const minHeight of [0, -1, 170, 800, Infinity, NaN]) {
    assert.throws(() => frostedCardStyle({ width: 900, minHeight }), /minHeight/u);
  }
  assert.throws(() => frostedCardStyle({ width: 900, minHeight: 300, emphasis: "yes" }), /emphasis/u);
});

test("three-card sequence uses identical full card surfaces and only horizontal connections", () => {
  const markup = render(module.exports.GlassArtwork, { example: "flow" });
  assert.equal((markup.match(/data-glass-card="mint-frosted-thin-v001"/gu) ?? []).length, 3);
  assert.equal((markup.match(/data-glass-connection="horizontal"/gu) ?? []).length, 2);
  assert.equal((markup.match(/data-glass-title/gu) ?? []).length, 3);
  assert.doesNotMatch(markup, /✓|✔|<img/u);
  assert.throws(() => render(module.exports.GlassArtwork, { example: "unknown" }), /Unknown glass example/u);
});

test("every static preview retains local font entry, approved logo identity and no production replacement", async () => {
  const [root, index] = await Promise.all([
    readFile(new URL("../src/video/glass-card-preview/root.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/video/glass-card-preview/index.jsx", import.meta.url), "utf8")
  ]);
  assert.match(index, /import "\.\.\/load-video-fonts\.jsx"/u);
  assert.equal((root.match(/durationInFrames=\{1\}/gu) ?? []).length, 3);
  assert.match(root, /profile="approved-v013-stable-footprint"/u);
  assert.match(root, /motionCadence="continuous"/u);
  assert.doesNotMatch(root, /Math\.random|Date\.now|setInterval|setTimeout|ThreeCanvas/u);
});
