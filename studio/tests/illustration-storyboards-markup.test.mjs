import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { STORYBOARDS } from "../src/video/illustration-storyboards/plan.mjs";

const entry = fileURLToPath(new URL("../src/video/illustration-storyboards/artwork.jsx", import.meta.url));
const built = await build({ entryPoints: [entry], bundle: true, write: false, format: "cjs",
  platform: "node", packages: "external", logLevel: "silent" });
const module = { exports: {} };
vm.runInThisContext(`(function(module, exports, require) {\n${built.outputFiles[0].text}\n})`)(module, module.exports, createRequire(entry));
const render = (id, phase) => renderToStaticMarkup(React.createElement(module.exports.StoryboardArtwork, { id, phase }));

test("all nine actual markups keep unstroked Chinese text and full object outlines", () => {
  for (const board of STORYBOARDS) {
    for (let phase = 0; phase < 3; phase += 1) {
      const markup = render(board.id, phase);
      for (const [, tag] of markup.matchAll(/<text\b([^>]*)>/gu)) assert.match(tag, /stroke="none"/u);
      assert.match(markup, /data-object-outline=/u);
      assert.doesNotMatch(markup, /✓|✔|<image|font-weight="[7-9]00"|text-overflow|clipPath/u);
    }
  }
});

test("all loading frames preserve sources and the copy appears only after matching", () => {
  for (let phase = 0; phase < 3; phase += 1) {
    const markup = render("load", phase);
    for (const id of ["image", "report", "data"]) assert.ok(markup.includes(`data-object-id="source-${id}"`));
    assert.equal(markup.includes("data-object-id=\"report-copy\""), phase > 0);
    assert.equal(markup.includes("完整内容尚未载入"), phase < 2);
  }
});

test("tool result and routing dispatch labels are not shown in earlier phases", () => {
  for (let phase = 0; phase < 3; phase += 1) {
    assert.equal(render("tool", phase).includes("收到返回值"), phase === 2);
    assert.equal(render("route", phase).includes("已接收任务"), phase === 2);
  }
});

test("scene families use object-level illustrations rather than the glass content-card component", () => {
  assert.match(render("load", 1), /data-illustration-object="document"/u);
  assert.match(render("tool", 1), /data-illustration-object="database"/u);
  for (const kind of ["image", "chart", "router"]) assert.ok(render("route", 1).includes(`data-illustration-object="${kind}"`));
  for (const board of STORYBOARDS) assert.doesNotMatch(render(board.id, 0), /data-glass-card/u);
});

test("catalog heading clears the phase text and unmatched router tracks have equal color", () => {
  for (let phase = 0; phase < 3; phase += 1) {
    const heading = [...render("load", phase).matchAll(/<text\b([^>]*)>能力目录<\/text>/gu)][0]?.[1];
    const baseline = Number(heading?.match(/\by="([\d.]+)"/u)?.[1]);
    // Phase starts at 265px with a 30px label. Allow its line box plus
    // a 36px heading ascender and an additional visible gap.
    assert.ok(baseline >= 350);
  }
  assert.match(render("route", 0), /data-router-primary-track="true"[^>]*stroke="#9ABEAB"/u);
  assert.match(render("route", 1), /data-router-primary-track="true"[^>]*stroke="#17795D"/u);
});

test("static roots preserve the pinned local font and watermark without replacing video entries", async () => {
  const [root, index] = await Promise.all([
    readFile(new URL("../src/video/illustration-storyboards/root.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/video/illustration-storyboards/index.jsx", import.meta.url), "utf8")
  ]);
  assert.match(index, /import "\.\.\/load-video-fonts\.jsx"/u);
  assert.match(root, /profile="approved-v013-stable-footprint"/u);
  assert.match(root, /motionCadence="continuous"/u);
  assert.match(root, /<StoryboardAssetsReady key=/u);
  assert.equal((root.match(/durationInFrames=\{3\}/gu) ?? []).length, 3);
  assert.doesNotMatch(root, /Math\.random|Date\.now|setInterval|setTimeout|ThreeCanvas|animation:|transition:/u);
});
