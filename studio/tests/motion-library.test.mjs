import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MOTION_LIBRARY_CATEGORIES,
  MOTION_LIBRARY_ITEMS
} from "../src/video/motion-library/catalog.mjs";
import { segmentChineseWords } from "../src/video/motion-library/motion.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const studioDirectory = path.resolve(testDirectory, "..");
const libraryDirectory = path.join(studioDirectory, "src", "video", "motion-library");

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute);
    return [absolute];
  }));
  return nested.flat();
}

test("motion library exposes 35 curated, deterministic horizontal effects", () => {
  assert.equal(MOTION_LIBRARY_ITEMS.length, 35);
  assert.equal(new Set(MOTION_LIBRARY_ITEMS.map((item) => item.id)).size, 35);
  const categories = new Set(MOTION_LIBRARY_CATEGORIES.map((category) => category.id));
  for (const item of MOTION_LIBRARY_ITEMS) {
    assert.equal(item.format, "16:9-only", item.id);
    assert.equal(item.frameDriven, true, item.id);
    assert.equal(item.deterministic, true, item.id);
    assert.equal(item.subtitleSafe, false, item.id);
    assert.equal(categories.has(item.category), true, item.id);
    assert.equal(item.upstream.length > 0, true, item.id);
    assert.equal(item.useWhen.length > 0, true, item.id);
    assert.equal(item.avoidWhen.length > 0, true, item.id);
  }
});

test("registry and catalog expose exactly the same effect IDs", async () => {
  const registry = await readFile(path.join(libraryDirectory, "registry.jsx"), "utf8");
  const block = registry.slice(
    registry.indexOf("export const MOTION_LIBRARY_EFFECTS"),
    registry.indexOf("export const MOTION_LIBRARY_EFFECT_IDS")
  );
  const registered = [...block.matchAll(/^\s+"([^"]+)":\s+[A-Za-z]+Effect,?$/gm)].map((match) => match[1]);
  assert.deepEqual(registered.sort(), MOTION_LIBRARY_ITEMS.map((item) => item.id).sort());
});

test("Chinese word reveal segments phrases instead of requiring whitespace", () => {
  const words = segmentChineseWords("规则连接执行结果人工确认");
  assert.equal(words.length > 1, true);
  assert.equal(words.join(""), "规则连接执行结果人工确认");
});

test("adapted components are frame-driven and contain no browser-timed animation", async () => {
  const files = (await collectFiles(libraryDirectory))
    .filter((file) => /\.(jsx|mjs)$/.test(file))
    .filter((file) => !file.includes(`${path.sep}upstream${path.sep}`));
  const forbidden = [
    /Math\.random\s*\(/,
    /requestAnimationFrame\s*\(/,
    /setInterval\s*\(/,
    /\banimation\s*:/,
    /\btransition\s*:/
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, `${path.relative(studioDirectory, file)} contains ${pattern}`);
    }
  }
});
