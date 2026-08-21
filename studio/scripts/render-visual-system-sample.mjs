import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { publicRoot, studioOutputRoot, videoRoot } from "../src/shared/paths.mjs";
import { resolveBrowserExecutable } from "../src/server/renderer.mjs";

const outputDirectory = resolve(studioOutputRoot, "visual-system-sample-v3");
await mkdir(outputDirectory, { recursive: true });

const browserExecutable = await resolveBrowserExecutable(null);
const browser = browserExecutable ? { browserExecutable } : {};
const serveUrl = await bundle({
  entryPoint: resolve(videoRoot, "index.jsx"),
  publicDir: publicRoot,
  onProgress: () => undefined
});

const targets = [
  {
    id: "VisualSystemSampleWide",
    file: "visual-system-sample-wide-v003.mp4",
    stills: [
      ["wide-operation.png", 150],
      ["wide-transition-1-outgoing-start.png", 232],
      ["wide-transition-1-outgoing-mid.png", 240],
      ["wide-transition-1-wallpaper-hold.png", 251],
      ["wide-transition-1-incoming-mid.png", 261],
      ["wide-transition-1-incoming-settled.png", 272],
      ["wide-concept.png", 520],
      ["wide-transition-2-outgoing-start.png", 662],
      ["wide-transition-2-outgoing-mid.png", 670],
      ["wide-transition-2-wallpaper-hold.png", 681],
      ["wide-transition-2-incoming-mid.png", 691],
      ["wide-transition-2-incoming-settled.png", 702],
      ["wide-acceptance.png", 800]
    ]
  },
  {
    id: "VisualSystemSampleVertical",
    file: "visual-system-sample-vertical-v003.mp4",
    stills: [
      ["vertical-operation.png", 150],
      ["vertical-transition-1-outgoing-start.png", 232],
      ["vertical-transition-1-outgoing-mid.png", 240],
      ["vertical-transition-1-wallpaper-hold.png", 251],
      ["vertical-transition-1-incoming-mid.png", 261],
      ["vertical-transition-1-incoming-settled.png", 272],
      ["vertical-concept.png", 520],
      ["vertical-transition-2-outgoing-start.png", 662],
      ["vertical-transition-2-outgoing-mid.png", 670],
      ["vertical-transition-2-wallpaper-hold.png", 681],
      ["vertical-transition-2-incoming-mid.png", 691],
      ["vertical-transition-2-incoming-settled.png", 702],
      ["vertical-acceptance.png", 800]
    ]
  }
];

const requestedTarget = process.argv[2];
const stillsOnly = process.argv[3] === "stills";
const selectedTargets = requestedTarget
  ? targets.filter((target) => target.id.toLowerCase().includes(requestedTarget.toLowerCase()))
  : targets;

if (selectedTargets.length === 0) {
  throw new Error(`Unknown render target: ${requestedTarget}`);
}

async function renderMediaWithRetry(options) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await renderMedia(options);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        console.warn(`render attempt ${attempt} failed; retrying once: ${error.message}`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
      }
    }
  }
  throw lastError;
}

for (const target of selectedTargets) {
  const composition = await selectComposition({
    serveUrl,
    id: target.id,
    ...browser,
    logLevel: "warn"
  });
  for (const [file, frame] of target.stills) {
    await renderStill({
      composition,
      serveUrl,
      output: resolve(outputDirectory, file),
      frame,
      imageFormat: "png",
      overwrite: true,
      ...browser,
      logLevel: "warn"
    });
  }
  if (!stillsOnly) {
    await renderMediaWithRetry({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: resolve(outputDirectory, target.file),
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: 92,
      crf: 20,
      concurrency: "25%",
      overwrite: true,
      ...browser,
      logLevel: "warn"
    });
    console.log(`rendered ${target.id} -> ${target.file}`);
  } else {
    console.log(`rendered stills for ${target.id}`);
  }
}
