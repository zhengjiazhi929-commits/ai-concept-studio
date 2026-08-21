import { mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

import { resolveBrowserExecutable } from "../src/server/renderer.mjs";
import { readEpisode } from "../src/shared/store.mjs";
import { publicRoot, studioOutputRoot, videoRoot } from "../src/shared/paths.mjs";

const LOCAL_RENDER_PROVENANCE = Object.freeze({
  mode: "local-code-motion",
  paidApiCalls: 0,
  generatedImageCalls: 0,
  generatedVideoCalls: 0,
  externalInferenceCalls: 0,
  textUploadCalls: 0
});

const episodeId = process.argv[2] ?? "agent-skill-20260806";
if (episodeId !== "agent-skill-20260806") {
  throw new Error("这个完整成片抽帧脚本只允许用于 agent-skill-20260806");
}

const episode = await readEpisode(episodeId);
const candidateVersionArgument = process.argv.find((argument) => /^--version=\d+$/u.test(argument));
const candidateVersion = candidateVersionArgument
  ? Number(candidateVersionArgument.split("=")[1])
  : Number(episode.render?.version ?? 0) + 1;
if (!Number.isInteger(candidateVersion) || candidateVersion <= 0) {
  throw new Error("候选版本必须是正整数");
}
const outputDirectory = resolve(
  studioOutputRoot,
  episodeId,
  `full-video-v${String(candidateVersion).padStart(3, "0")}-design-qa`
);
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
  id: "ConceptPreview",
  inputProps: { episode },
  ...browser,
  logLevel: "warn"
});

const requestedSeconds = process.argv.slice(3)
  .filter((argument) => !argument.startsWith("--"))
  .map(Number);
const defaultSeconds = [
  1, 32, 70, 100, 138, 168, 206, 236, 274, 304, 342, 372, 410, 440, 478, 508, 546, 576, 594
];
const seconds = requestedSeconds.length > 0 ? requestedSeconds : defaultSeconds;
if (seconds.some((second) => !Number.isFinite(second) || second < 0 || second >= 600)) {
  throw new Error("抽查秒数必须位于 0 到 600 之间");
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

console.log(JSON.stringify({ candidateVersion, outputDirectory, outputs, generation: LOCAL_RENDER_PROVENANCE }, null, 2));
