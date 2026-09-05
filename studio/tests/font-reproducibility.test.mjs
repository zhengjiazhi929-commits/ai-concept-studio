import assert from "node:assert/strict";
import { readFile, readdir, realpath } from "node:fs/promises";
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
  const chunkedRenderer = await readFile(
    resolve(
      studioRoot,
      "scripts/render-agent-skill-long-review-wide-v004-chunked.mjs"
    ),
    "utf8"
  );
  const packagedCss = await readFile(
    resolve(studioRoot, "node_modules/@fontsource-variable/noto-sans-sc/wght.css"),
    "utf8"
  );
  const fontFiles = (await readdir(
    resolve(studioRoot, "node_modules/@fontsource-variable/noto-sans-sc/files")
  )).filter((name) => name.endsWith(".woff2"));
  const rendererPackageRoot = await realpath(
    resolve(studioRoot, "node_modules/@remotion/renderer")
  );
  const seekToFrameSource = await readFile(
    resolve(rendererPackageRoot, "dist/seek-to-frame.js"),
    "utf8"
  );

  assert.equal(packageDocument.dependencies["@fontsource-variable/noto-sans-sc"], "5.3.0");
  assert.match(
    lockfile,
    /'@fontsource-variable\/noto-sans-sc@5\.3\.0':\n\s+resolution: \{integrity: sha512-/u
  );
  assert.equal(VIDEO_SANS_FONT_FAMILY_NAME, "Noto Sans SC Variable");
  assert.match(VIDEO_SANS_FONT_FAMILY, /^"Noto Sans SC Variable"/u);
  assert.equal(
    loader,
    'import "@fontsource-variable/noto-sans-sc/wght.css";\n'
  );
  assert.doesNotMatch(
    loader,
    /delayRender|continueRender|cancelRender|document\.fonts\.load/u
  );
  assert.doesNotMatch(chunkedRenderer, /inlineBundledFontsWebpackOverride/u);
  assert.doesNotMatch(chunkedRenderer, /type:\s*["']asset\/inline["']/u);
  assert.match(
    seekToFrameSource,
    /await page\.evaluateHandle\(['"]document\.fonts\.ready['"]\)/u
  );
  assert.match(packagedCss, /font-family: 'Noto Sans SC Variable'/u);
  assert.match(packagedCss, /font-weight: 100 900/u);
  assert.doesNotMatch(packagedCss, /https?:\/\//u);
  assert.equal((packagedCss.match(/@font-face/gu) ?? []).length, 101);
  assert.equal(fontFiles.length, 101);
  const cssFontFiles = [...packagedCss.matchAll(
    /url\(\.\/files\/([^)]+\.woff2)\)/gu
  )].map((match) => match[1]).sort();
  assert.deepEqual(cssFontFiles, [...fontFiles].sort());
  const fontHeaders = await Promise.all(cssFontFiles.map(async (name) => {
    const bytes = await readFile(resolve(
      studioRoot,
      "node_modules/@fontsource-variable/noto-sans-sc/files",
      name
    ));
    return bytes.subarray(0, 4).toString("ascii");
  }));
  assert.deepEqual(new Set(fontHeaders), new Set(["wOF2"]));

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
