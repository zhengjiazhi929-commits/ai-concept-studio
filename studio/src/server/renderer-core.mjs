// Internal implementation. Production callers must use renderer.mjs.
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { studioOutputRoot, workspaceRoot } from "../shared/paths.mjs";

function renderVersionFromPath(outputPath) {
  return Number(/preview-v(\d{3})\.mp4$/u.exec(outputPath)?.[1] ?? 0);
}

export async function bundleVideoProjectForRenderCore(options = {}, dependencies) {
  const entryPoint = options.entryPoint;
  const publicDirectory = options.publicDirectory;
  return dependencies.bundleProject({
    entryPoint,
    publicDir: publicDirectory,
    ...(options.outDirectory ? { outDir: options.outDirectory } : {}),
    symlinkPublicDir: false,
    onProgress: () => undefined
  });
}

export async function createVideoBundleSnapshotCore(options = {}, dependencies) {
  const temporaryRoot = await dependencies.mkdtemp(join(tmpdir(), "acs-render-bundle-"));
  try {
    const serveUrl = await bundleVideoProjectForRenderCore({
      ...options,
      outDirectory: resolve(temporaryRoot, "bundle")
    }, dependencies);
    let cleaned = false;
    return {
      serveUrl,
      temporaryRoot,
      async cleanup() {
        if (cleaned) return false;
        cleaned = true;
        await dependencies.rm(temporaryRoot, { recursive: true, force: true });
        return true;
      }
    };
  } catch (error) {
    await dependencies.rm(temporaryRoot, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
}

export function createRendererService({
  dependencies,
  nextRenderFileName,
  prepareDeterministicLayoutSamples,
  finalizeDeterministicLayoutSampleSet
}) {
  async function renderPreview(episode, context = {}) {
    const config = await dependencies.readConfig();
    const outputDirectory = dependencies.episodeOutputDirectory(episode.id);
    await dependencies.mkdir(outputDirectory, { recursive: true });
    const outputPath = resolve(
      outputDirectory,
      nextRenderFileName(await dependencies.readdir(outputDirectory))
    );
    const temporaryOutputPath = outputPath.replace(/\.mp4$/u, ".rendering.mp4");
    const inputProps = { episode };
    let bundleSnapshot = null;
    let result = null;

    try {
      bundleSnapshot = await dependencies.createVideoBundleSnapshot();
      const { serveUrl } = bundleSnapshot;
      const browser = await dependencies.browserOptions(config.browserExecutable);
      const composition = await dependencies.selectComposition({
        serveUrl,
        id: episode.render.compositionId,
        inputProps,
        ...browser,
        logLevel: "warn"
      });
      const preparedDeterministicLayouts = prepareDeterministicLayoutSamples(
        episode,
        composition
      );
      let lastReported = -1;
      await dependencies.renderMedia({
        composition,
        serveUrl,
        codec: config.render.codec,
        outputLocation: temporaryOutputPath,
        inputProps,
        ...browser,
        concurrency: config.render.concurrency,
        crf: config.render.crf,
        imageFormat: "png",
        pixelFormat: "yuv420p",
        enforceAudioTrack: true,
        overwrite: false,
        logLevel: "warn",
        onProgress: ({ progress }) => {
          const rounded = Math.floor(progress * 20) / 20;
          if (rounded > lastReported) {
            lastReported = rounded;
            void context.onProgress?.(rounded, `正在生成预览 ${Math.round(rounded * 100)}%`);
          }
        }
      });
      await dependencies.rename(temporaryOutputPath, outputPath);
      const integrity = await dependencies.inspectFileIntegrity(outputPath);
      const deterministicLayoutSampleSet = finalizeDeterministicLayoutSampleSet(
        preparedDeterministicLayouts,
        {
          compositionId: composition.id,
          renderVersion: renderVersionFromPath(outputPath),
          renderedArtifactSha256: integrity.sha256
        }
      );
      const cloudBackup = await dependencies.backupRenderedFile(outputPath).catch((error) => ({
        status: "failed",
        error: error instanceof Error ? error.message : "云端备份失败"
      }));

      result = {
        outputPath,
        relativeOutputPath: relative(workspaceRoot, outputPath).replaceAll("\\", "/"),
        outputRoot: relative(workspaceRoot, studioOutputRoot).replaceAll("\\", "/"),
        bytes: integrity.bytes,
        sha256: integrity.sha256,
        deterministicLayoutSampleSet,
        cloudBackup
      };
    } catch (error) {
      await dependencies.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      if (bundleSnapshot) {
        await bundleSnapshot.cleanup().catch(async (error) => {
          const message = error instanceof Error
            ? error.message
            : "正式 render bundle 临时目录清理失败";
          if (typeof context.onCleanupWarning === "function") {
            await Promise.resolve(context.onCleanupWarning(message)).catch(() => undefined);
          } else {
            console.warn(`正式 render bundle 临时目录清理失败：${message}`);
          }
        });
      }
    }
    return result;
  }

  return Object.freeze({ renderPreview });
}
