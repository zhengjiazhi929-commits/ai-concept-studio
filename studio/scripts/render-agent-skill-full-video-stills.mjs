import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { renderStill, selectComposition } from "@remotion/renderer";

import { inspectFileIntegrity, integrityHash } from "../src/shared/integrity.mjs";
import {
  publicRoot,
  studioOutputRoot,
  studioRoot,
  videoRoot,
  workspaceRoot
} from "../src/shared/paths.mjs";
import {
  createVideoBundleSnapshot,
  resolveBrowserExecutable
} from "../src/server/renderer.mjs";
import { readEpisode } from "../src/shared/store.mjs";

const executeFile = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const require = createRequire(import.meta.url);

export const FULL_VIDEO_STILLS_ARTIFACT_SCHEMA_VERSION =
  "agent-skill-full-video-stills-artifact-v3";

export const FULL_VIDEO_COMPOSITION_CONTRACT = Object.freeze({
  id: "ConceptPreview",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 18_000
});

const LOCAL_RENDER_PROVENANCE = Object.freeze({
  mode: "local-code-motion",
  claimScope: "static-script-plan-not-runtime-network-measurement",
  runtimeNetworkInstrumentation: false,
  paidApiCalls: 0,
  generatedImageCalls: 0,
  generatedVideoCalls: 0,
  externalInferenceCalls: 0,
  textUploadCalls: 0
});

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function stillsArtifactPaths({
  outputRoot = studioOutputRoot,
  episodeId,
  candidateVersion,
  runId = `${process.pid}-${randomUUID()}`
}) {
  const directoryName = `full-video-v${String(candidateVersion).padStart(3, "0")}-design-qa`;
  const episodeRoot = resolve(outputRoot, episodeId);
  return {
    finalDirectory: resolve(episodeRoot, directoryName),
    temporaryDirectory: resolve(episodeRoot, `.${directoryName}.rendering-${runId}`),
    publicationLockDirectory: resolve(episodeRoot, `.${directoryName}.publish-lock`)
  };
}

export async function assertOutputDirectoryAvailable(finalDirectory) {
  if (await pathExists(finalDirectory)) {
    throw new Error(`同版本静帧产物已存在，拒绝覆盖：${finalDirectory}`);
  }
}

async function inspectTree(root, label) {
  if (!(await pathExists(root))) return { label, root: relative(studioRoot, root), files: [] };
  const files = [];
  const visit = async (directory) => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${label} 中不允许符号链接：${path}`);
      if (entry.isDirectory()) await visit(path);
      if (entry.isFile()) {
        files.push({
          path: relative(studioRoot, path).replaceAll("\\", "/"),
          ...await inspectFileIntegrity(path)
        });
      }
    }
  };
  await visit(root);
  return {
    label,
    root: relative(studioRoot, root).replaceAll("\\", "/"),
    files,
    sha256: integrityHash(files)
  };
}

async function gitHead() {
  const { stdout } = await executeFile("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8"
  });
  const head = stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error(`Git HEAD 无效：${head}`);
  return head;
}

async function inspectProvenanceFile(path) {
  return {
    path: relative(workspaceRoot, path).replaceAll("\\", "/"),
    ...await inspectFileIntegrity(path)
  };
}

async function captureRenderRuntime(browserExecutable) {
  if (!browserExecutable) {
    throw new Error("未解析到固定浏览器可执行文件；拒绝生成无法绑定浏览器身份的正式静帧证据");
  }
  const rendererPackage = resolve(dirname(require.resolve("@remotion/renderer")), "../package.json");
  const bundlerPackage = resolve(dirname(require.resolve("@remotion/bundler")), "../package.json");
  const { stdout } = await executeFile(browserExecutable, ["--version"], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024
  });
  return {
    node: { version: process.version, versions: { ...process.versions } },
    browser: {
      version: stdout.trim(),
      ...await inspectProvenanceFile(browserExecutable)
    },
    remotionPackages: await Promise.all([
      inspectProvenanceFile(rendererPackage),
      inspectProvenanceFile(bundlerPackage)
    ])
  };
}

export function validateFullVideoComposition(composition, framePlan) {
  for (const [field, expected] of Object.entries(FULL_VIDEO_COMPOSITION_CONTRACT)) {
    if (composition?.[field] !== expected) {
      throw new Error(
        `完整成片 composition ${field} 不符合契约：expected=${expected} actual=${composition?.[field]}`
      );
    }
  }
  for (const item of framePlan) {
    if (!Number.isSafeInteger(item.frame) || item.frame < 0 || item.frame >= composition.durationInFrames) {
      throw new Error(`抽帧 ${item.filename} 越界：frame=${item.frame}`);
    }
  }
  return true;
}

export async function captureStillsInputs({ episodeId, episode, framePlan, runtime }) {
  const generatorPaths = [
    SCRIPT_PATH,
    resolve(studioRoot, "package.json"),
    resolve(studioRoot, "pnpm-lock.yaml"),
    resolve(studioRoot, "config/studio.json")
  ];
  const [head, sourceTree, publicAssets, generatorFiles] = await Promise.all([
    gitHead(),
    inspectTree(resolve(studioRoot, "src"), "studio-source"),
    inspectTree(publicRoot, "public-assets"),
    Promise.all(generatorPaths.map(inspectProvenanceFile))
  ]);
  const payload = {
    gitHead: head,
    episode: {
      id: episodeId,
      sha256: integrityHash(episode)
    },
    framePlan,
    sourceTree,
    publicAssets,
    generatorFiles,
    runtime
  };
  return { ...payload, inputSha256: integrityHash(payload) };
}

export function assertStillsInputsUnchanged(before, after, phase) {
  if (before?.inputSha256 !== after?.inputSha256) {
    throw new Error(
      `${phase}期间 Git HEAD、Episode、生成脚本、依赖锁、运行时、视频源码或公开素材发生变化，拒绝发布`
    );
  }
  return true;
}

export function buildStillsArtifactManifest({
  episodeId,
  candidateVersion,
  inputs,
  composition,
  outputs,
  generatedAt = new Date().toISOString()
}) {
  const normalizedOutputs = outputs.map((output) => ({ ...output }));
  return {
    schemaVersion: FULL_VIDEO_STILLS_ARTIFACT_SCHEMA_VERSION,
    generatedAt,
    episodeId,
    candidateVersion,
    publication: {
      strategy: "unique-temporary-directory-then-atomic-rename",
      overwriteAllowed: false,
      evidenceScope: "source-composition-rendered-stills-not-encoded-mp4",
      manualFinalMp4PlaybackRequired: true
    },
    inputs,
    composition,
    outputs: normalizedOutputs,
    outputSetSha256: integrityHash(normalizedOutputs),
    generation: LOCAL_RENDER_PROVENANCE
  };
}

export async function publishStillsDirectory({
  temporaryDirectory,
  finalDirectory,
  publicationLockDirectory = `${finalDirectory}.publish-lock`
}) {
  try {
    await mkdir(publicationLockDirectory, { recursive: false });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`同版本静帧正在发布或留有待人工核对的发布锁，拒绝并发覆盖：${publicationLockDirectory}`);
    }
    throw error;
  }
  try {
    await assertOutputDirectoryAvailable(finalDirectory);
    await rename(temporaryDirectory, finalDirectory);
  } finally {
    await rm(publicationLockDirectory, { recursive: true, force: true }).catch((error) => {
      process.stderr.write(
        `警告：静帧发布锁清理失败，但不会把已完成的原子发布误报为失败：${error.message}\n`
      );
    });
  }
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

async function main() {
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
  if (new Set(seconds).size !== seconds.length) throw new Error("抽查秒数不能重复");

  const paths = stillsArtifactPaths({ episodeId, candidateVersion });
  await assertOutputDirectoryAvailable(paths.finalDirectory);
  if (await pathExists(paths.temporaryDirectory)) {
    throw new Error(`唯一临时目录意外存在，拒绝复用：${paths.temporaryDirectory}`);
  }
  await mkdir(resolve(studioOutputRoot, episodeId), { recursive: true });
  await mkdir(paths.temporaryDirectory, { recursive: false });

  let bundleSnapshot = null;
  try {
    const browserExecutable = await resolveBrowserExecutable(null);
    const runtimeBefore = await captureRenderRuntime(browserExecutable);
    const browser = { browserExecutable };
    const framePlan = seconds.map((second) => ({
      second,
      frame: Math.round(second * FULL_VIDEO_COMPOSITION_CONTRACT.fps),
      filename: `second-${String(second).padStart(3, "0")}.png`
    }));
    validateFullVideoComposition(FULL_VIDEO_COMPOSITION_CONTRACT, framePlan);
    const inputsBefore = await captureStillsInputs({
      episodeId,
      episode,
      framePlan,
      runtime: runtimeBefore
    });
    bundleSnapshot = await createVideoBundleSnapshot({
      entryPoint: resolve(videoRoot, "index.jsx"),
      publicDirectory: publicRoot
    });
    const runtimeAfterBundle = await captureRenderRuntime(browserExecutable);
    const inputsAfterBundle = await captureStillsInputs({
      episodeId,
      episode,
      framePlan,
      runtime: runtimeAfterBundle
    });
    assertStillsInputsUnchanged(inputsBefore, inputsAfterBundle, "Remotion bundle 生成");
    const serveUrl = bundleSnapshot.serveUrl;
    const composition = await selectComposition({
      serveUrl,
      id: FULL_VIDEO_COMPOSITION_CONTRACT.id,
      inputProps: { episode },
      ...browser,
      logLevel: "warn"
    });
    validateFullVideoComposition(composition, framePlan);

    const outputs = [];
    for (const item of framePlan) {
      const output = resolve(paths.temporaryDirectory, item.filename);
      const attempts = await renderStillWithRetry({
        composition,
        serveUrl,
        output,
        frame: item.frame,
        inputProps: { episode },
        imageFormat: "png",
        overwrite: false,
        ...browser,
        logLevel: "warn"
      });
      outputs.push({
        ...item,
        renderedFrame: item.frame,
        attempts,
        ...await inspectFileIntegrity(output)
      });
    }

    const runtimeAfter = await captureRenderRuntime(browserExecutable);
    const inputsAfter = await captureStillsInputs({
      episodeId,
      episode,
      framePlan,
      runtime: runtimeAfter
    });
    assertStillsInputsUnchanged(inputsBefore, inputsAfter, "静帧生成");
    const manifest = buildStillsArtifactManifest({
      episodeId,
      candidateVersion,
      inputs: inputsBefore,
      composition: {
        id: composition.id,
        width: composition.width,
        height: composition.height,
        fps: composition.fps,
        durationInFrames: composition.durationInFrames
      },
      outputs
    });
    await writeFile(
      resolve(paths.temporaryDirectory, "artifact-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    await publishStillsDirectory(paths);
    process.stdout.write(`${JSON.stringify({
      candidateVersion,
      outputDirectory: paths.finalDirectory,
      manifest: resolve(paths.finalDirectory, "artifact-manifest.json"),
      outputCount: outputs.length,
      inputSha256: inputsBefore.inputSha256,
      outputSetSha256: manifest.outputSetSha256,
      generation: LOCAL_RENDER_PROVENANCE
    }, null, 2)}\n`);
  } catch (error) {
    await rm(paths.temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    if (bundleSnapshot) {
      await bundleSnapshot.cleanup().catch((error) => {
        process.stderr.write(
          `警告：Remotion 临时 bundle 清理失败；静帧发布状态保持不变：${error.message}\n`
        );
      });
    }
  }
}

const invokedAsCli = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;
if (invokedAsCli) await main();
