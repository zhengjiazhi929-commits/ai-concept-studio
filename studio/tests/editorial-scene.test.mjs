import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { visualSystemV1AiWatermarkProfile } from "../src/video/components/visual-system-v1/ai-watermark.mjs";

const entryPoint = fileURLToPath(new URL("../src/video/illustration-system/editorial-scene.jsx", import.meta.url));
const result = await build({ entryPoints: [entryPoint], bundle: true, write: false,
  format: "cjs", platform: "node", packages: "external", logLevel: "silent" });
const module = { exports: {} };
// Keep cloned contract objects and Object.prototype in the same realm. Passing
// host structuredClone into a separate VM realm falsely rejects valid JSON.
vm.runInThisContext(`(function(module, exports, require) {\n${result.outputFiles[0].text}\n})`,
  { filename: "editorial-markup-test.cjs" })(module, module.exports, createRequire(entryPoint));
const { EditorialArtwork, IndexPage, UnfoldingPage, ContextWindow } = module.exports;
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const tags = (markup, name) => [...markup.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gu"))]
  .map(([, attributes]) => Object.fromEntries([...attributes.matchAll(/([\w:-]+)="([^"]*)"/gu)].map(([, key, value]) => [key, value])));

test("metadata pages keep a full closed outline, 44px labels and unchanged source identity at both sizes", () => {
  for (const height of [280, 240, 180, 125]) {
    const markup = render(IndexPage, { item: { x: 140, y: 355, width: 430, height, index: 0, label: "图片处理", selected: false, retained: true }, description: "适用：图片任务" });
    const outline = tags(markup, "path").find((path) => path["data-editorial-outline"]);
    assert.match(outline.d, /Z$/u);
    assert.equal(outline.stroke, "#5A8A77");
    assert.equal(outline["stroke-width"], "3");
    const title = tags(markup, "text").find((label) => label["data-editorial-label"] === "name");
    assert.equal(title["font-size"], "44");
    assert.equal(title.stroke, "none");
    assert.ok(Number(title.y) < height - 30);
    assert.ok(markup.includes("图片处理") && markup.includes("适用：图片任务"));
  }
});

test("unfolding waits for enough room before rendering either content row", () => {
  for (const frame of [210, 240, 255, 262, 285, 300, 419, 420]) {
    const markup = render(EditorialArtwork, { frame });
    for (const label of tags(markup, "text")) assert.equal(label.stroke, "none");
    if (frame <= 255) {
      assert.ok(!markup.includes(">执行步骤</text>"));
      assert.ok(!markup.includes(">验收标准</text>"));
    }
    if (frame >= 300) {
      assert.ok(markup.includes(">执行步骤</text>"));
      assert.ok(markup.includes(">验收标准</text>"));
    }
  }
});

test("context has four opaque outlined sides and no icon prefixed to its title", () => {
  const markup = render(ContextWindow, { rect: { x: 1140, y: 325, width: 640, height: 485 }, loaded: false, waiting: true });
  const outline = tags(markup, "rect").find((rect) => rect["data-editorial-outline"] === "context");
  assert.equal(outline.width, "640");
  assert.equal(outline.height, "485");
  assert.equal(outline["stroke-width"], "3");
  assert.equal(outline.stroke, "#5A8A77");
  assert.ok(markup.includes("上下文"));
  assert.ok(!markup.includes("<image") && !markup.includes("check"));
});

test("all sampled phases retain three sources and never display success before arrival", () => {
  for (const frame of [0, 90, 180, 210, 240, 285, 330, 390, 419, 420, 599]) {
    const markup = render(EditorialArtwork, { frame });
    assert.equal(tags(markup, "g").filter((group) => group["data-editorial-object"] === "index-page").length, 3);
    assert.equal(tags(markup, "g").filter((group) => group["data-editorial-object"] === "content-copy").length, frame >= 210 ? 1 : 0);
    assert.equal(markup.includes(">完整内容已载入</text>"), frame >= 420);
    assert.ok(!markup.includes("✓") && !markup.includes("✔"));
  }
});

test("copy body is inside its expanding page and inherits no SVG stroke", () => {
  const markup = render(UnfoldingPage, { rect: { x: 660, y: 450, width: 430, height: 280 }, title: "替换内容", expansion: 1, stepsVisible: true, qaVisible: true });
  assert.ok(markup.includes("替换内容") && !markup.includes("报告整理"));
  for (const label of tags(markup, "text")) {
    assert.equal(label.stroke, "none");
    assert.ok(Number(label.y) < 264);
    assert.ok(Number(label.x) >= 28 && Number(label.x) <= 390);
  }
});

test("scene keeps locked theme/font, continuous approved watermark and deterministic frame animation", async () => {
  const source = await readFile(entryPoint, "utf8");
  assert.match(source, /VIDEO_SANS_FONT_FAMILY/u);
  assert.match(source, /motionCadence="continuous"/u);
  const profile = source.match(/profile="([^"]+)"/u)?.[1];
  assert.equal(profile, "approved-v013-stable-footprint");
  assert.equal(visualSystemV1AiWatermarkProfile(profile).id, profile);
  assert.match(source, /editorialFrameState\(frame\)/u);
  assert.doesNotMatch(source, /Math\.random|Date\.now|setInterval|setTimeout|useFrame\(|ThreeCanvas|CSS.*animation/u);
});
