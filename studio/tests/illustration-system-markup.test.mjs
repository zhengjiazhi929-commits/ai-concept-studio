import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const entryPoint = fileURLToPath(new URL("../src/video/illustration-system/components.jsx", import.meta.url));
const bundled = await build({
  entryPoints: [entryPoint], bundle: true, write: false, format: "cjs",
  platform: "node", packages: "external", logLevel: "silent"
});
const cjsModule = { exports: {} };
vm.runInNewContext(bundled.outputFiles[0].text, {
  module: cjsModule, exports: cjsModule.exports,
  require: createRequire(entryPoint), structuredClone,
  TextEncoder, Uint8Array, crypto: globalThis.crypto
}, { filename: "illustration-components-markup-bundle.cjs" });
const {
  ObjectLabel, OrthogonalConnector, DocumentObject, ContextObject, DataPacket, DatabaseObject, VersionDocument
} = cjsModule.exports;

function render(Component, props, children) {
  return renderToStaticMarkup(React.createElement("svg", { xmlns: "http://www.w3.org/2000/svg" },
    React.createElement(Component, props, children)));
}

// Inspect actual React-generated SVG markup, not the JSX source text.
function tags(markup, name) {
  return Array.from(markup.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gu")), ([, attributes]) =>
    Object.fromEntries(Array.from(attributes.matchAll(/([\w:-]+)="([^"]*)"/gu), ([, key, value]) => [key, value])));
}

function labelsHaveNoStroke(markup, expectedCount) {
  const labels = tags(markup, "text");
  assert.equal(labels.length, expectedCount);
  for (const label of labels) {
    assert.equal(label.stroke, "none", "Every label must override inherited connector or object strokes");
    assert.ok(label.fill && label.fill !== "none", "Labels must also override a parent's fill=none");
  }
}

function hasVisibleOutline(element) {
  assert.ok(element.stroke && element.stroke !== "none");
  assert.ok(Number(element["stroke-width"]) > 0);
}

function pathBounds(path) {
  const tokens = path.match(/[MLHVQCZ]|-?\d+(?:\.\d+)?/gu);
  const points = [];
  let x = 0;
  let y = 0;
  let offset = 0;
  while (offset < tokens.length) {
    const command = tokens[offset++];
    if (command === "Z") continue;
    if (command === "H") x = Number(tokens[offset++]);
    else if (command === "V") y = Number(tokens[offset++]);
    else {
      const count = { M: 1, L: 1, Q: 2, C: 3 }[command];
      assert.ok(count, `Unsupported outline command: ${command}`);
      for (let index = 0; index < count; index += 1) {
        x = Number(tokens[offset++]);
        y = Number(tokens[offset++]);
        points.push([x, y]);
      }
    }
    points.push([x, y]);
  }
  return {
    left: Math.min(...points.map(([px]) => px)), right: Math.max(...points.map(([px]) => px)),
    top: Math.min(...points.map(([, py]) => py)), bottom: Math.max(...points.map(([, py]) => py))
  };
}

test("ObjectLabel explicitly overrides a thick inherited SVG stroke and escapes replacement text", () => {
  const markup = renderToStaticMarkup(React.createElement("svg", null,
    React.createElement("g", { stroke: "#ff0000", strokeWidth: 12, fill: "none" },
      React.createElement(ObjectLabel, { x: 15, y: 35, color: "#123456", size: 24 }, "替换 <标签> & 数据"))));
  labelsHaveNoStroke(markup, 1);
  const [label] = tags(markup, "text");
  assert.equal(label.fill, "#123456");
  assert.equal(label["font-size"], "24");
  assert.ok(markup.includes("替换 &lt;标签&gt; &amp; 数据"));
  assert.ok(!markup.includes("<标签>"));
});

test("rendered orthogonal connectors retain their stroked route without outlining their labels", () => {
  const markup = render(OrthogonalConnector, {
    points: [[40, 80], [220, 80], [220, 170]],
    label: "查询 B42", labelX: 130, labelY: 60, active: true
  });
  const [group] = tags(markup, "g");
  hasVisibleOutline(group);
  assert.equal(tags(markup, "polyline")[0].points, "40,80 220,80 220,170");
  assert.equal(tags(markup, "path")[0].transform, "translate(220 170) rotate(90)");
  labelsHaveNoStroke(markup, 1);
  assert.ok(markup.includes("查询 B42"));
  assert.throws(() => render(OrthogonalConnector, { points: [[40, 80], [220, 170]] }), /Diagonal/u);
});

test("DocumentObject renders a closed full-size page outline and replacement title and body", () => {
  const markup = render(DocumentObject, {
    x: 35, y: 55, width: 410, height: 260, title: "新材料目录", active: true
  }, React.createElement(ObjectLabel, { x: 28, y: 125 }, "只展示这次输入"));
  const [outline] = tags(markup, "path");
  hasVisibleOutline(outline);
  assert.match(outline.d, /Z$/u);
  assert.deepEqual(pathBounds(outline.d), { left: 0, right: 410, top: 0, bottom: 260 });
  assert.equal(tags(markup, "g")[0].transform, "translate(35 55)");
  labelsHaveNoStroke(markup, 2);
  assert.ok(markup.includes("新材料目录") && markup.includes("只展示这次输入"));
});

test("ContextObject keeps a four-sided rectangle when width, title and child content change", () => {
  const markup = render(ContextObject, {
    x: 70, y: 90, width: 510, height: 330, title: "备用接收窗口"
  }, React.createElement(ObjectLabel, { x: 28, y: 155 }, "另一组返回值"));
  const [outline] = tags(markup, "rect");
  hasVisibleOutline(outline);
  assert.equal(outline.width, "510");
  assert.equal(outline.height, "330");
  assert.equal(tags(markup, "g")[0].transform, "translate(70 90)");
  labelsHaveNoStroke(markup, 2);
  assert.ok(markup.includes("备用接收窗口") && markup.includes("另一组返回值"));
});

test("DataPacket honors replacement payload and width while preserving its requested center", () => {
  const markup = render(DataPacket, { x: 600, y: 420, width: 240, text: "新的查询结果" });
  assert.equal(tags(markup, "g")[0].transform, "translate(480 388)");
  const [outline] = tags(markup, "rect");
  hasVisibleOutline(outline);
  assert.equal(outline.width, "240");
  assert.equal(outline.height, "64");
  const [label] = tags(markup, "text");
  assert.equal(label.x, "120");
  assert.equal(label["text-anchor"], "middle");
  labelsHaveNoStroke(markup, 1);
  assert.ok(markup.includes("新的查询结果"));
});

test("DatabaseObject renders supplied records and highlights only the requested row", () => {
  const props = { x: 90, y: 110, width: 420,
    records: [["B41", "已签收"], ["B42", "待出库"]], matchedIndex: 1, highlight: true };
  const markup = render(DatabaseObject, props);
  labelsHaveNoStroke(markup, 4);
  for (const value of props.records.flat()) assert.ok(markup.includes(value));
  assert.ok(!markup.includes("A17") && !markup.includes("已发货"));
  const highlights = tags(markup, "rect");
  assert.equal(highlights.length, 1);
  assert.equal(highlights[0].y, "219");
  assert.equal(highlights[0].width, "376");
  hasVisibleOutline(highlights[0]);
  assert.equal(tags(render(DatabaseObject, { ...props, highlight: false }), "rect").length, 0);
});

test("comparison scan is a translucent background before text, never a line over glyphs", () => {
  const props = { x: 265, title: "对照版本", copy: { before: "读取材料", after: "输出报告" }, value: "保留验收" };
  for (const scanProgress of [0, 0.25, 0.74, 1]) {
    const markup = render(VersionDocument, { ...props, scanProgress });
    const scan = tags(markup, "rect").find((rect) => rect["data-illustration-scan"]);
    assert.equal(scan.stroke, "none");
    assert.ok(Number(scan.opacity) < 1);
    assert.equal(Number(scan.height), 48);
    assert.ok(markup.indexOf("data-illustration-scan") < markup.indexOf(">读取材料</text>"));
    assert.ok(markup.indexOf("data-illustration-scan") < markup.indexOf(">输出报告</text>"));
    assert.equal(tags(markup, "path").length, 3, "Only page outline, folded corner and title separator remain");
  }
  assert.equal(tags(render(VersionDocument, props), "rect").length, 0);
});
