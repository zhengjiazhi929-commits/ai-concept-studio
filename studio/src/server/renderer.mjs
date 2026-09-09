import { access, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import {
  publicRoot,
  videoRoot,
  episodeOutputDirectory
} from "../shared/paths.mjs";
import { readConfig } from "../shared/store.mjs";
import { backupRenderedFile } from "../shared/cloud-backup.mjs";
import { inspectFileIntegrity } from "../shared/integrity.mjs";
import {
  DETERMINISTIC_LAYOUT_SAMPLE_ASSURANCE,
  DETERMINISTIC_LAYOUT_SAMPLE_SCHEMA_VERSION,
  DETERMINISTIC_LAYOUT_SAMPLE_TYPE,
  VISUAL_EXPRESSION_RENDERER_CONTRACT_VERSION,
  VISUAL_EXPRESSION_STYLE_PROFILE_ID
} from "../shared/visual-expression-contract.mjs";
import {
  visualSystemV1GrammarLayout
} from "../video/components/visual-system-v1/grammar-layout.mjs";
import {
  bundleVideoProjectForRenderCore,
  createRendererService,
  createVideoBundleSnapshotCore
} from "./renderer-core.mjs";

export function nextRenderFileName(files) {
  const highest = files.reduce((current, file) => {
    const match = /^preview-v(\d{3})(?:\.rendering)?\.mp4$/u.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return `preview-v${String(highest + 1).padStart(3, "0")}.mp4`;
}

function usesVisualExpressionContract(episode) {
  return episode.production?.storyboardDraft?.visualContractVersion != null ||
    (episode.scenes ?? []).some((scene) => scene?.visualIntent != null);
}

export function deterministicLayoutRepresentativeFrame(scene, composition) {
  const fps = Number(composition?.fps);
  const durationInFrames = Number(composition?.durationInFrames);
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isInteger(durationInFrames) || durationInFrames < 1) {
    throw new TypeError("确定性布局样本需要有效的 fps 与 durationInFrames");
  }
  const startFrame = Number.isInteger(scene?.startFrame)
    ? scene.startFrame
    : Math.floor(Number(scene?.start ?? scene?.startSecond ?? 0) * fps);
  const endFrameExclusive = Number.isInteger(scene?.endFrame)
    ? scene.endFrame
    : Number.isFinite(Number(scene?.end ?? scene?.endSecond))
      ? Math.ceil(Number(scene.end ?? scene.endSecond) * fps)
      : durationInFrames;
  const clampedStart = Math.max(0, Math.min(durationInFrames - 1, startFrame));
  return Math.max(
    clampedStart,
    Math.min(durationInFrames - 1, Math.max(clampedStart + 1, endFrameExclusive) - 1)
  );
}

export function prepareDeterministicLayoutSamples(episode, composition) {
  if (!usesVisualExpressionContract(episode)) return null;
  const width = Number(composition?.width);
  const height = Number(composition?.height);
  const compositionId = composition?.id ?? episode.render?.compositionId ?? null;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new TypeError("确定性布局样本需要实际渲染 composition 的宽高");
  }
  if (typeof compositionId !== "string" || !compositionId.trim()) {
    throw new TypeError("确定性布局样本需要实际渲染 compositionId");
  }
  const styleProfileId = episode.production?.storyboardDraft?.visualStyleProfileId ??
    VISUAL_EXPRESSION_STYLE_PROFILE_ID;
  const scenes = (episode.scenes ?? []).map((scene) => {
    if (typeof scene?.id !== "string" || !scene.id.trim() || !scene.visualPlan) {
      throw new TypeError("合同分镜必须为每个场景提供 id 与 visualPlan 才能渲染");
    }
    if (scene.visualPlan.styleProfileId !== styleProfileId) {
      throw new TypeError(
        `场景 ${scene.id} 的风格 profile 与 Storyboard 不一致：${scene.visualPlan.styleProfileId ?? "missing"}`
      );
    }
    const layout = visualSystemV1GrammarLayout({
      width,
      height,
      visualPlan: scene.visualPlan,
      visibleElementIds: scene.visualPlan.semanticElements.map((element) => element.id)
    });
    return {
      sceneId: scene.id,
      layoutSamples: [{
        ...structuredClone(layout.layoutSample),
        frame: deterministicLayoutRepresentativeFrame(scene, composition)
      }]
    };
  });
  return {
    rendererContractVersion: VISUAL_EXPRESSION_RENDERER_CONTRACT_VERSION,
    styleProfileId,
    compositionId,
    durationInFrames: composition.durationInFrames,
    scenes
  };
}

export function finalizeDeterministicLayoutSampleSet(prepared, renderEvidence = {}) {
  if (prepared == null) return null;
  const renderVersion = Number(renderEvidence.renderVersion);
  const renderedArtifactSha256 = renderEvidence.renderedArtifactSha256;
  const compositionId = renderEvidence.compositionId ?? prepared.compositionId;
  if (!Number.isInteger(renderVersion) || renderVersion < 1) {
    throw new TypeError("确定性布局样本需要正整数 renderVersion");
  }
  if (typeof renderedArtifactSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(renderedArtifactSha256)) {
    throw new TypeError("确定性布局样本必须绑定渲染完成后的 SHA-256");
  }
  if (compositionId !== prepared.compositionId) {
    throw new TypeError("确定性布局样本的 compositionId 与实际渲染不一致");
  }
  const sharedMetadata = {
    sampleType: DETERMINISTIC_LAYOUT_SAMPLE_TYPE,
    schemaVersion: DETERMINISTIC_LAYOUT_SAMPLE_SCHEMA_VERSION,
    rendererContractVersion: prepared.rendererContractVersion,
    styleProfileId: prepared.styleProfileId,
    compositionId,
    renderVersion,
    renderedArtifactSha256,
    assurance: DETERMINISTIC_LAYOUT_SAMPLE_ASSURANCE,
    finalizedAfterRender: true,
    pixelInspection: false,
    humanVisualQa: false
  };
  return {
    ...sharedMetadata,
    scenes: prepared.scenes.map((entry) => ({
      sceneId: entry.sceneId,
      layoutSamples: entry.layoutSamples.map((sample) => ({
        ...structuredClone(sample),
        deterministicLayoutSample: {
          ...sharedMetadata,
          sceneId: entry.sceneId
        }
      }))
    }))
  };
}

function browserCandidates(platform, environment) {
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ];
  }
  if (platform === "win32") {
    return [
      environment.PROGRAMFILES && resolve(environment.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
      environment["PROGRAMFILES(X86)"] && resolve(environment["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
      environment.LOCALAPPDATA && resolve(environment.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe")
    ].filter(Boolean);
  }
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge"
  ];
}

export async function resolveBrowserExecutable(configured, options = {}) {
  const canAccess = options.access ?? access;
  if (configured) {
    try {
      await canAccess(configured);
      return configured;
    } catch {
      throw new Error(`配置的浏览器不存在：${configured}`);
    }
  }
  const candidates = browserCandidates(
    options.platform ?? process.platform,
    options.environment ?? process.env
  );
  for (const candidate of candidates) {
    try {
      await canAccess(candidate);
      return candidate;
    } catch {
      // Try the next platform-native browser before allowing Remotion to download one.
    }
  }
  return null;
}

async function browserOptions(browserExecutable) {
  const detected = await resolveBrowserExecutable(browserExecutable);
  return detected ? { browserExecutable: detected } : {};
}

export async function bundleVideoProjectForRender(options = {}) {
  assertNoDependencyInjection(options, ["bundleProject"], "bundleVideoProjectForRender");
  return bundleVideoProjectForRenderCore({
    entryPoint: options.entryPoint ?? resolve(videoRoot, "index.jsx"),
    publicDirectory: options.publicDirectory ?? publicRoot,
    ...(options.outDirectory ? { outDirectory: options.outDirectory } : {})
  }, { bundleProject: bundle });
}

export async function createVideoBundleSnapshot(options = {}) {
  // Remotion copies publicDir into the bundle by default. Reusing a process-wide
  // bundle would therefore render stale voice or visual assets after an approved
  // asset revision changes. A formal render gets a fresh immutable snapshot.
  assertNoDependencyInjection(
    options,
    ["mkdtemp", "rm", "bundleProject"],
    "createVideoBundleSnapshot"
  );
  return createVideoBundleSnapshotCore({
    entryPoint: options.entryPoint ?? resolve(videoRoot, "index.jsx"),
    publicDirectory: options.publicDirectory ?? publicRoot
  }, { bundleProject: bundle, mkdtemp, rm });
}

const productionRenderer = createRendererService({
  dependencies: {
    backupRenderedFile,
    browserOptions,
    createVideoBundleSnapshot,
    episodeOutputDirectory,
    inspectFileIntegrity,
    mkdir,
    readConfig,
    readdir,
    rename,
    renderMedia,
    rm,
    selectComposition
  },
  nextRenderFileName,
  prepareDeterministicLayoutSamples,
  finalizeDeterministicLayoutSampleSet
});

function hasProperty(value, property) {
  return Boolean(
    value != null &&
    (typeof value === "object" || typeof value === "function") &&
    Reflect.has(value, property)
  );
}

function assertNoDependencyInjection(options, properties, entryPoint) {
  if (properties.some((property) => hasProperty(options, property))) {
    throw new TypeError(
      `production ${entryPoint} does not accept dependency injection`
    );
  }
}

export async function renderPreview(episode, context = {}) {
  // This guard intentionally precedes readConfig, path resolution and all I/O.
  assertNoDependencyInjection(context, ["dependencies"], "renderPreview");
  return productionRenderer.renderPreview(episode, context);
}

export function clearBundleCache() {
  // Kept as a compatibility hook for callers that used to clear the old cache.
  // Formal renders no longer retain a process-wide bundle.
}
