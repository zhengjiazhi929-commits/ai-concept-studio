import { mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

import { resolveBrowserExecutable } from "../src/server/renderer.mjs";
import { readEpisode } from "../src/shared/store.mjs";
import { publicRoot, studioOutputRoot, videoRoot } from "../src/shared/paths.mjs";

const episodeId = process.argv[2] ?? "agent-skill-20260806";
if (episodeId !== "agent-skill-20260806") {
  throw new Error("这个画面抽查脚本只允许用于 agent-skill-20260806");
}

const episode = await readEpisode(episodeId);
const outputDirectory = resolve(studioOutputRoot, episodeId, "visual-qa");
await mkdir(outputDirectory, { recursive: true });

const browserExecutable = await resolveBrowserExecutable(null);
const browser = browserExecutable ? { browserExecutable } : {};
const serveUrl = await bundle({
  entryPoint: resolve(videoRoot, "index.jsx"),
  publicDir: publicRoot,
  onProgress: () => undefined
});
const composition = await selectComposition({
  serveUrl,
  id: episode.render.compositionId,
  inputProps: { episode },
  ...browser,
  logLevel: "warn"
});

const requestedSeconds = process.argv.slice(3).map(Number);
const seconds = requestedSeconds.length > 0 ? requestedSeconds : [1, 90, 180, 300, 450, 590];
if (seconds.some((second) => !Number.isFinite(second) || second < 0 || second >= episode.render.durationSeconds)) {
  throw new Error(`抽查秒数必须位于 0 到 ${episode.render.durationSeconds} 之间`);
}

async function renderStillWithRetry(options, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await renderStill(options);
      return attempt;
    } catch (error) {
      lastError = error;
      await rm(options.output, { force: true }).catch(() => undefined);
      if (attempt < attempts) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
    }
  }
  throw lastError;
}

const outputs = [];
for (const second of seconds) {
  const output = resolve(outputDirectory, `second-${String(second).padStart(3, "0")}.png`);
  const temporaryOutput = output.replace(/\.png$/u, ".rendering.png");
  const attempts = await renderStillWithRetry({
    composition,
    serveUrl,
    output: temporaryOutput,
    frame: Math.min(composition.durationInFrames - 1, Math.round(second * episode.render.fps)),
    inputProps: { episode },
    imageFormat: "png",
    overwrite: true,
    ...browser,
    logLevel: "warn"
  });
  await rename(temporaryOutput, output);
  outputs.push({ second, output, attempts });
}

console.log(JSON.stringify({ outputDirectory, outputs }, null, 2));
