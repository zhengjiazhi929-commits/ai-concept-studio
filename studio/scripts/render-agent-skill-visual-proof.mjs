import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import {
  publicRoot,
  studioOutputRoot,
  videoRoot,
  workspaceRoot
} from "../src/shared/paths.mjs";
import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import { resolveBrowserExecutable } from "../src/server/renderer.mjs";
import {
  VISUAL_PROOF_DURATION_SECONDS,
  VISUAL_PROOF_FPS,
  nextVisualProofVersion
} from "../src/video/agent-skill-visual-proof-plan.mjs";

const episodeId = "agent-skill-20260806";
const compositionId = "AgentSkillLocalTtsVisualProof";
const outputDirectory = resolve(studioOutputRoot, episodeId);
const voiceProofPath = resolve(outputDirectory, "local-tts-proof-v002.wav");
const voiceProofManifestPath = resolve(outputDirectory, "local-tts-proof-v002-manifest.json");
const publicVoiceProofPath = resolve(
  publicRoot,
  "episodes",
  episodeId,
  "local-tts-proof-v002.wav"
);
await mkdir(outputDirectory, { recursive: true });
await mkdir(resolve(publicRoot, "episodes", episodeId), { recursive: true });
const voiceProofManifest = JSON.parse(await readFile(voiceProofManifestPath, "utf8"));
const voiceProofIntegrity = await inspectFileIntegrity(voiceProofPath);
if (
  voiceProofManifest.voice !== "zm_010"
  || voiceProofIntegrity.sha256 !== voiceProofManifest.sha256
  || voiceProofIntegrity.bytes !== voiceProofManifest.bytes
) {
  throw new Error("选定的 zm_010 本地旁白与已校验清单不一致");
}
try {
  await copyFile(voiceProofPath, publicVoiceProofPath, constants.COPYFILE_EXCL);
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  const existingPublicVoiceIntegrity = await inspectFileIntegrity(publicVoiceProofPath);
  if (
    existingPublicVoiceIntegrity.sha256 !== voiceProofIntegrity.sha256
    || existingPublicVoiceIntegrity.bytes !== voiceProofIntegrity.bytes
  ) {
    throw new Error("公开预览目录已有同名但内容不同的本地旁白，拒绝覆盖");
  }
}
const version = nextVisualProofVersion(await readdir(outputDirectory));
const versionLabel = String(version).padStart(3, "0");
const outputPath = resolve(outputDirectory, `visual-proof-v${versionLabel}.mp4`);
const temporaryOutputPath = resolve(
  outputDirectory,
  `visual-proof-v${versionLabel}.rendering.mp4`
);
const stillDirectory = resolve(outputDirectory, `visual-proof-v${versionLabel}-stills`);
const manifestPath = resolve(outputDirectory, `visual-proof-v${versionLabel}-manifest.json`);
await mkdir(stillDirectory, { recursive: false });

const browserExecutable = await resolveBrowserExecutable(null);
const browser = browserExecutable ? { browserExecutable } : {};
const serveUrl = await bundle({
  entryPoint: resolve(videoRoot, "index.jsx"),
  publicDir: publicRoot,
  onProgress: () => undefined
});
const composition = await selectComposition({
  serveUrl,
  id: compositionId,
  ...browser,
  logLevel: "warn"
});

const auditFrames = Array.from(
  { length: VISUAL_PROOF_DURATION_SECONDS / 2 },
  (_, index) => (index * 2 + 1) * VISUAL_PROOF_FPS
);
const flickerFrames = [1018, 1019, 1020, 1021, 1022];
const stillFrames = [...new Set([...auditFrames, ...flickerFrames])].sort((a, b) => a - b);
const stills = [];
for (const frame of stillFrames) {
  const fileName = `frame-${String(frame).padStart(4, "0")}.png`;
  const stillPath = resolve(stillDirectory, fileName);
  await renderStill({
    composition,
    serveUrl,
    output: stillPath,
    frame,
    imageFormat: "png",
    overwrite: false,
    ...browser,
    logLevel: "warn"
  });
  stills.push(relative(workspaceRoot, stillPath).replaceAll("\\", "/"));
}

let lastProgress = -1;
let renderError = null;
for (let attempt = 1; attempt <= 2; attempt += 1) {
  try {
    await rm(temporaryOutputPath, { force: true });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: temporaryOutputPath,
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: 92,
      crf: 18,
      concurrency: "25%",
      overwrite: false,
      ...browser,
      logLevel: "warn",
      onProgress: ({ progress }) => {
        const rounded = Math.floor(progress * 10) * 10;
        if (rounded > lastProgress) {
          lastProgress = rounded;
          console.log(`visual proof render ${rounded}%`);
        }
      }
    });
    renderError = null;
    break;
  } catch (error) {
    renderError = error;
    await rm(temporaryOutputPath, { force: true }).catch(() => undefined);
    if (attempt < 2) {
      console.warn(`visual proof render attempt ${attempt} failed; retrying once`);
    }
  }
}
if (renderError) throw renderError;

await rename(temporaryOutputPath, outputPath);
const integrity = await inspectFileIntegrity(outputPath);
const manifest = {
  schemaVersion: 1,
  id: `agent-skill-visual-proof-v${versionLabel}`,
  episodeId,
  sourceRenderVersion: 15,
  generatedAt: new Date().toISOString(),
  compositionId,
  durationSeconds: VISUAL_PROOF_DURATION_SECONDS,
  fps: VISUAL_PROOF_FPS,
  width: composition.width,
  height: composition.height,
  audio: {
    mode: "local-open-source-kokoro",
    voice: voiceProofManifest.voice,
    sourcePath: relative(workspaceRoot, voiceProofPath).replaceAll("\\", "/"),
    bytes: voiceProofIntegrity.bytes,
    sha256: voiceProofIntegrity.sha256,
    subtitleTrack: "local-tts-zm-010"
  },
  outputPath: relative(workspaceRoot, outputPath).replaceAll("\\", "/"),
  bytes: integrity.bytes,
  sha256: integrity.sha256,
  stills,
  generation: {
    mode: "local-code-motion",
    paidApiCalls: 0,
    externalInferenceCalls: 0,
    generatedImageCalls: 0,
    generatedVideoCalls: 0,
    textUploadCalls: 0
  }
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx"
});
console.log(JSON.stringify(manifest, null, 2));
