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
  VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF,
  aiWatermarkSizeProofGeometry
} from "../src/video/visual-system-v1-ai-watermark-size-proof-plan.mjs";

const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ENTRY_POINT = resolve(videoRoot, "visual-system-v1-ai-watermark-size-proof-index.jsx");
const CANDIDATE_PARENT = ensureInside(
  studioOutputRoot,
  resolve(studioOutputRoot, "design-system", "review-candidates")
);
const CANDIDATE_DIRECTORY = ensureInside(
  CANDIDATE_PARENT,
  resolve(CANDIDATE_PARENT, "visual-system-v1-ai-watermark-size-proof-v001")
);
const TEMPORARY_DIRECTORY = ensureInside(
  CANDIDATE_PARENT,
  resolve(CANDIDATE_PARENT, "visual-system-v1-ai-watermark-size-proof-v001.rendering")
);

async function assertAbsent(path, label) {
  try {
    await access(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} 已存在；为避免覆盖，静态尺寸图渲染已停止`);
}

function assertSourceIntegrity(actual) {
  const expected = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF.sourceFrame;
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
    throw new Error(
      `横版代表帧与预期不一致：${actual.bytes} bytes / ${actual.sha256}`
    );
  }
}

function assertComposition(composition) {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF;
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
    throw new Error(`静态尺寸图 composition 不一致：${JSON.stringify(actual)}`);
  }
}

async function main() {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF;
  if (!contract.reviewOnly || contract.registered || contract.actualWatermarkIncluded) {
    throw new Error("尺寸图必须保持 reviewOnly、未注册且不含 AI 实物");
  }
  if (contract.videoOutput) throw new Error("本任务只允许输出静态 PNG");

  await assertAbsent(CANDIDATE_DIRECTORY, "目标候选目录");
  await assertAbsent(TEMPORARY_DIRECTORY, "临时候选目录");

  const sourcePath = ensureInside(
    workspaceRoot,
    resolve(workspaceRoot, contract.sourceFrame.relativePath)
  );
  const sourceIntegrityBefore = await inspectFileIntegrity(sourcePath);
  assertSourceIntegrity(sourceIntegrityBefore);
  const sourceBytes = await readFile(sourcePath);
  const sourceDataUrl = `data:image/png;base64,${sourceBytes.toString("base64")}`;

  await mkdir(TEMPORARY_DIRECTORY, { recursive: false });
  try {
    const serveUrl = await bundle({ entryPoint: ENTRY_POINT });
    const outputs = [];
    for (const option of contract.options) {
      const outputPath = resolve(TEMPORARY_DIRECTORY, option.fileName);
      const inputProps = {
        sourceDataUrl,
        size: option.size,
        top: contract.anchor.top,
        right: contract.anchor.right,
        guideVisible: true
      };
      const composition = await selectComposition({
        serveUrl,
        id: contract.compositionId,
        inputProps,
        browserExecutable: CHROME_EXECUTABLE
      });
      assertComposition(composition);
      await renderStill({
        serveUrl,
        composition,
        output: outputPath,
        imageFormat: "png",
        frame: 0,
        inputProps,
        browserExecutable: CHROME_EXECUTABLE
      });
      outputs.push({
        id: option.id,
        label: option.label,
        fileName: option.fileName,
        geometry: aiWatermarkSizeProofGeometry(option),
        integrity: await inspectFileIntegrity(outputPath)
      });
    }
    if (new Set(outputs.map(({ integrity }) => integrity.sha256)).size !== outputs.length) {
      throw new Error("三张尺寸图的像素结果没有全部区分；拒绝交付");
    }

    const sourceIntegrityAfter = await inspectFileIntegrity(sourcePath);
    if (JSON.stringify(sourceIntegrityBefore) !== JSON.stringify(sourceIntegrityAfter)) {
      throw new Error("横版代表帧在尺寸图渲染期间发生变化");
    }

    const manifest = {
      schemaVersion: contract.schemaVersion,
      generatedAt: new Date().toISOString(),
      reviewOnly: contract.reviewOnly,
      registered: contract.registered,
      actualWatermarkIncluded: contract.actualWatermarkIncluded,
      actualAiObjectRendered: false,
      guideMode: "outline-only",
      videoGenerated: false,
      formalEpisodeStateTouched: false,
      formalRenderOrQaUpdated: false,
      authorizesPublication: false,
      externalCalls: {
        provider: 0,
        paid: 0,
        generative: 0
      },
      canvas: { width: contract.width, height: contract.height },
      comparisonRule: "三图使用同一底图与同一右上锚点，只改变正方形占位尺寸",
      outlineIsFinalWatermarkBorder: false,
      sourceFrame: {
        path: contract.sourceFrame.relativePath,
        integrity: sourceIntegrityBefore
      },
      anchor: contract.anchor,
      outline: contract.outline,
      outputs
    };
    await writeFile(
      resolve(TEMPORARY_DIRECTORY, "review-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );
    await rename(TEMPORARY_DIRECTORY, CANDIDATE_DIRECTORY);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    await rm(TEMPORARY_DIRECTORY, { recursive: true, force: true });
    throw error;
  }
}

await main();
