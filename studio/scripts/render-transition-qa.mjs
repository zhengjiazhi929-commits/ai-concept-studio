import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { publicRoot, studioOutputRoot, videoRoot } from "../src/shared/paths.mjs";
import { resolveBrowserExecutable } from "../src/server/renderer.mjs";

const outputDirectory = resolve(studioOutputRoot, "visual-system-sample-v3", "transition-qa");
await mkdir(outputDirectory, { recursive: true });

const browserExecutable = await resolveBrowserExecutable(null);
const browser = browserExecutable ? { browserExecutable } : {};
const serveUrl = await bundle({
  entryPoint: resolve(videoRoot, "index.jsx"),
  publicDir: publicRoot,
  onProgress: () => undefined
});

const transitions = [
  {
    name: "handoff-1",
    frames: [228, 232, 236, 240, 244, 248, 249, 250, 251, 252, 253, 254, 257, 261, 265, 269, 273]
  },
  {
    name: "handoff-2",
    frames: [658, 662, 666, 670, 674, 678, 679, 680, 681, 682, 683, 684, 687, 691, 695, 699, 703]
  }
];

const targets = [
  { id: "VisualSystemSampleWide", label: "wide" },
  { id: "VisualSystemSampleVertical", label: "vertical" }
];

for (const target of targets) {
  const composition = await selectComposition({
    serveUrl,
    id: target.id,
    ...browser,
    logLevel: "warn"
  });

  for (const transition of transitions) {
    for (const frame of transition.frames) {
      await renderStill({
        composition,
        serveUrl,
        output: resolve(
          outputDirectory,
          `${target.label}-${transition.name}-frame-${String(frame).padStart(3, "0")}.png`
        ),
        frame,
        imageFormat: "png",
        overwrite: true,
        ...browser,
        logLevel: "warn"
      });
    }
  }
}

console.log(`rendered transition QA frames -> ${outputDirectory}`);
