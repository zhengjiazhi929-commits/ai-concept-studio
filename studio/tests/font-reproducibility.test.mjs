import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  VIDEO_SANS_FONT_FAMILY,
  VIDEO_SANS_FONT_FAMILY_NAME
} from "../src/video/font-system.mjs";
import { studioRoot } from "../src/shared/paths.mjs";

const videoRoot = resolve(studioRoot, "src/video");

test("视频入口统一加载锁定的本地 Noto Sans SC variable font", async () => {
  const packageDocument = JSON.parse(
    await readFile(resolve(studioRoot, "package.json"), "utf8")
  );
  const lockfile = await readFile(resolve(studioRoot, "pnpm-lock.yaml"), "utf8");
  const loader = await readFile(resolve(videoRoot, "load-video-fonts.jsx"), "utf8");
  const packagedCss = await readFile(
    resolve(studioRoot, "node_modules/@fontsource-variable/noto-sans-sc/wght.css"),
    "utf8"
  );

  assert.equal(packageDocument.dependencies["@fontsource-variable/noto-sans-sc"], "5.3.0");
  assert.match(
    lockfile,
    /'@fontsource-variable\/noto-sans-sc@5\.3\.0':\n\s+resolution: \{integrity: sha512-/u
  );
  assert.equal(VIDEO_SANS_FONT_FAMILY_NAME, "Noto Sans SC Variable");
  assert.match(VIDEO_SANS_FONT_FAMILY, /^"Noto Sans SC Variable"/u);
  assert.match(loader, /@fontsource-variable\/noto-sans-sc\/wght\.css/u);
  assert.match(loader, /delayRender/u);
  assert.match(loader, /document\.fonts\.load/u);
  assert.match(loader, /cancelRender/u);
  assert.match(packagedCss, /font-family: 'Noto Sans SC Variable'/u);
  assert.match(packagedCss, /font-weight: 100 900/u);

  const videoFiles = (await readdir(videoRoot, { recursive: true }))
    .filter((path) => /\.(?:js|jsx|mjs|ts|tsx)$/u.test(path));
  const entrypoints = [];
  const forbiddenSystemFallbacks = [];
  for (const relativePath of videoFiles) {
    const source = await readFile(resolve(videoRoot, relativePath), "utf8");
    if (source.includes("registerRoot(")) entrypoints.push({ relativePath, source });
    if (/PingFang SC|HarmonyOS Sans SC|Microsoft YaHei|Noto Sans CJK SC/u.test(source)) {
      forbiddenSystemFallbacks.push(relativePath);
    }
  }

  assert.equal(entrypoints.length, 8);
  for (const { relativePath, source } of entrypoints) {
    assert.match(
      source,
      /load-video-fonts\.jsx/u,
      `${relativePath} 必须在 registerRoot 前加载锁定字体`
    );
  }
  assert.deepEqual(forbiddenSystemFallbacks, []);
});
