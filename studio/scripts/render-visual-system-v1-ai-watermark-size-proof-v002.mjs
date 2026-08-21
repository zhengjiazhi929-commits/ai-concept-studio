import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import {
  ensureInside,
  studioOutputRoot,
  videoRoot,
  workspaceRoot
} from "../src/shared/paths.mjs";
import {
  VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF_V002,
  aiWatermarkSizeProofV002Geometry
} from "../src/video/visual-system-v1-ai-watermark-size-proof-v002-plan.mjs";

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ENTRY_POINT = resolve(videoRoot, "visual-system-v1-ai-watermark-size-proof-index.jsx");
const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF_V002;
const candidateParent = ensureInside(
  studioOutputRoot,
  resolve(studioOutputRoot, "design-system", "review-candidates")
);
const candidateDirectory = ensureInside(
  candidateParent,
  resolve(candidateParent, contract.candidateDirectoryName)
);
const temporaryDirectory = ensureInside(
  candidateParent,
  resolve(candidateParent, `${contract.candidateDirectoryName}.rendering`)
);

async function assertAbsent(path, label) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} 已存在；拒绝覆盖`);
}

function assertComposition(composition) {
  const actual = {
    id: composition.id,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames
  };
  const expected = {
    id: contract.compositionId,
    width: contract.width,
    height: contract.height,
    fps: contract.fps,
    durationInFrames: contract.durationInFrames
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`composition 不一致：${JSON.stringify(actual)}`);
  }
}

async function main() {
  if (!contract.reviewOnly || contract.registered || contract.actualWatermarkIncluded) {
    throw new Error("尺寸图必须保持 reviewOnly、未注册且不含 AI 实物");
  }
  if (contract.videoOutput) throw new Error("本任务只允许输出静态 PNG");
  await assertAbsent(candidateDirectory, "目标候选目录");
  await assertAbsent(temporaryDirectory, "临时候选目录");
  await access(CHROME_EXECUTABLE);

  const sourcePath = ensureInside(
    workspaceRoot,
    resolve(workspaceRoot, contract.sourceFrame.relativePath)
  );
  const sourceIntegrityBefore = await inspectFileIntegrity(sourcePath);
  if (
    sourceIntegrityBefore.bytes !== contract.sourceFrame.bytes ||
    sourceIntegrityBefore.sha256 !== contract.sourceFrame.sha256
  ) {
    throw new Error("横版代表帧完整性不匹配");
  }
  const sourceBytes = await readFile(sourcePath);
  const inputProps = {
    sourceDataUrl: `data:image/png;base64,${sourceBytes.toString("base64")}`,
    size: contract.option.size,
    top: contract.anchor.top,
    right: contract.anchor.right,
    guideVisible: true
  };

  await mkdir(temporaryDirectory, { recursive: false });
  try {
    const serveUrl = await bundle({ entryPoint: ENTRY_POINT });
    const composition = await selectComposition({
      serveUrl,
      id: contract.compositionId,
      inputProps,
      browserExecutable: CHROME_EXECUTABLE
    });
    assertComposition(composition);

    const outputPath = resolve(temporaryDirectory, contract.option.fileName);
    await renderStill({
      serveUrl,
      composition,
      output: outputPath,
      imageFormat: "png",
      frame: 0,
      inputProps,
      browserExecutable: CHROME_EXECUTABLE,
      overwrite: false
    });
    const outputIntegrity = await inspectFileIntegrity(outputPath);
    if (outputIntegrity.bytes < 100_000) throw new Error("静态尺寸图文件异常偏小");

    const sourceIntegrityAfter = await inspectFileIntegrity(sourcePath);
    if (JSON.stringify(sourceIntegrityBefore) !== JSON.stringify(sourceIntegrityAfter)) {
      throw new Error("横版代表帧在渲染期间发生变化");
    }

    const manifest = {
      schemaVersion: contract.schemaVersion,
      generatedAt: new Date().toISOString(),
      reviewOnly: true,
      registered: false,
      guideMode: "outline-only",
      actualAiObjectRendered: false,
      videoGenerated: false,
      formalEpisodeStateTouched: false,
      formalRenderOrQaUpdated: false,
      authorizesPublication: false,
      canvas: { width: contract.width, height: contract.height },
      sourceFrame: {
        path: contract.sourceFrame.relativePath,
        integrity: sourceIntegrityBefore
      },
      anchor: contract.anchor,
      outline: contract.outline,
      output: {
        id: contract.option.id,
        label: contract.option.label,
        fileName: contract.option.fileName,
        geometry: aiWatermarkSizeProofV002Geometry(),
        integrity: outputIntegrity
      }
    };
    await writeFile(
      resolve(temporaryDirectory, "review-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
    await rename(temporaryDirectory, candidateDirectory);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

await main();
