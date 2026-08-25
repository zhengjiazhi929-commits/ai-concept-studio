import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { resolveBrowserExecutable } from "../src/server/renderer.mjs";
import { videoRoot } from "../src/shared/paths.mjs";

export const CI_RENDER_SMOKE_COMPOSITION = "ConceptPreview";
export const CI_RENDER_SMOKE_FRAME = 0;
export const CI_RENDER_SMOKE_TIMEOUT_MS = 120_000;
export const CI_RENDER_SMOKE_CHROME_MODE = "chrome-for-testing";

const defaultDependencies = Object.freeze({
  bundle,
  mkdtemp,
  renderStill,
  resolveBrowserExecutable,
  rm,
  selectComposition,
  stat
});

export async function runCiRenderSmoke(options = {}) {
  const dependencies = { ...defaultDependencies, ...(options.dependencies ?? {}) };
  const temporaryRoot = await dependencies.mkdtemp(join(tmpdir(), "acs-ci-render-"));
  const bundleDirectory = resolve(temporaryRoot, "bundle");
  const output = resolve(temporaryRoot, "smoke-frame.png");
  try {
    const browserExecutable = options.browserExecutable
      ?? await dependencies.resolveBrowserExecutable(null);
    if (!browserExecutable) {
      throw new Error(
        "CI render smoke requires an installed local Chrome/Chromium; automatic download is disabled"
      );
    }
    const serveUrl = await dependencies.bundle({
      entryPoint: resolve(videoRoot, "index.jsx"),
      outDir: bundleDirectory,
      onProgress: () => undefined
    });
    const composition = await dependencies.selectComposition({
      serveUrl,
      id: CI_RENDER_SMOKE_COMPOSITION,
      browserExecutable,
      chromeMode: CI_RENDER_SMOKE_CHROME_MODE,
      timeoutInMilliseconds: CI_RENDER_SMOKE_TIMEOUT_MS,
      logLevel: "warn"
    });
    await dependencies.renderStill({
      composition,
      serveUrl,
      output,
      frame: CI_RENDER_SMOKE_FRAME,
      imageFormat: "png",
      overwrite: false,
      browserExecutable,
      chromeMode: CI_RENDER_SMOKE_CHROME_MODE,
      timeoutInMilliseconds: CI_RENDER_SMOKE_TIMEOUT_MS,
      logLevel: "warn"
    });
    const rendered = await dependencies.stat(output);
    if (!rendered.isFile() || rendered.size <= 8) {
      throw new Error("CI render smoke did not produce a valid PNG file");
    }
    return {
      compositionId: CI_RENDER_SMOKE_COMPOSITION,
      frame: CI_RENDER_SMOKE_FRAME,
      bytes: rendered.size,
      externalCalls: 0,
      liveEpisodesRead: 0
    };
  } finally {
    await dependencies.rm(temporaryRoot, { recursive: true, force: true });
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const result = await runCiRenderSmoke();
  console.log(JSON.stringify(result));
}
