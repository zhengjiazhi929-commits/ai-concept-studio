import { readFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { resolveBrowserExecutable } from "../src/server/renderer.mjs";
import { videoRoot } from "../src/shared/paths.mjs";
import { validateVisualExpressionScene } from "../src/shared/visual-expression-contract.mjs";
import { auditPngFrameSet } from "./ci-png-audit.mjs";

export const CI_RENDER_SMOKE_COMPOSITION = "ConceptPreview";
export const CI_RENDER_SMOKE_FRAMES = Object.freeze([0, 17, 29, 55]);
export const CI_RENDER_SMOKE_TIMEOUT_MS = 120_000;
export const CI_RENDER_SMOKE_CHROME_MODE = "chrome-for-testing";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const semanticElements = [
  {
    id: "prepare",
    label: "准备",
    semanticRole: "step",
    importance: "primary",
    claimIds: ["claim-main"]
  },
  {
    id: "execute",
    label: "执行",
    semanticRole: "step",
    importance: "primary",
    claimIds: ["claim-main"]
  },
  {
    id: "verify",
    label: "验收",
    semanticRole: "result",
    importance: "primary",
    claimIds: ["claim-main"]
  }
];

const semanticRelations = [
  {
    id: "prepare-execute",
    from: "prepare",
    to: "execute",
    type: "then",
    label: "然后",
    directed: true,
    claimIds: ["claim-main"]
  },
  {
    id: "execute-verify",
    from: "execute",
    to: "verify",
    type: "then",
    label: "最后",
    directed: true,
    claimIds: ["claim-main"]
  }
];

export const CI_RENDER_SMOKE_EPISODE = deepFreeze({
  id: "ci-production-semantic-smoke",
  title: "CI 生产语义渲染验证",
  render: {
    compositionId: CI_RENDER_SMOKE_COMPOSITION,
    width: 640,
    height: 360,
    fps: 30,
    durationSeconds: 3
  },
  scenes: [{
    id: "ci-semantic-flow",
    start: 0,
    end: 3,
    type: "statement",
    kicker: "PRODUCTION SEMANTIC FIXTURE",
    title: "标题先建立结论",
    statement: "再用图形说清步骤关系。",
    subtitle: "内联确定性 Fixture，不读取任何 live Episode。",
    visualIntent: {
      schemaVersion: "visual-expression-contract-v1",
      question: "三步如何完成？",
      takeaway: "先准备，再执行，最后验收。",
      role: "explanation",
      objective: "explain",
      informationNeed: "sequence",
      contribution: "show-order",
      contributionRationale: "删掉流程结构后，步骤顺序无法识别。",
      relationKind: "sequence",
      compositionProfile: "text-first",
      claims: [{
        id: "claim-main",
        text: "三步有先后",
        visualRequired: true,
        evidenceRefs: []
      }],
      entities: semanticElements,
      relations: semanticRelations,
      evidenceRefs: [],
      mustNotShow: ["装饰元素"]
    },
    visualPlan: {
      schemaVersion: "visual-expression-contract-v1",
      sceneId: "ci-semantic-flow",
      visualMode: "graphic",
      structure: "flow",
      readingDirection: "left-to-right",
      compositionProfile: "text-first",
      styleProfileId: "desktop-light-window-editorial-v3",
      claimIds: ["claim-main"],
      semanticElements,
      semanticRelations,
      timing: {
        headlineStartFrame: 0,
        supportingCopyStartFrame: 18,
        graphicStartFrame: 28,
        detailCopyStartFrame: 42,
        subtitleStartFrame: 18,
        minimumHeadlineLeadFrames: 12,
        mode: "frame-driven-semantic"
      },
      acceptance: {
        paletteMode: "semantic-token-roles",
        maximumAccentColors: 2,
        maximumVisibleEntities: 12,
        maximumSimultaneousHighlights: 3,
        maximumSimultaneousMotionObjects: 3,
        minimumRegionGapPx: 24,
        minimumBodyFontPx: 28,
        minimumStageTitleFontPx: 46,
        informationCardSurfaceRole: "information-card",
        informationCardContentMode: "text-only",
        informationCardBorderMode: "full-outline",
        minimumInformationCardBorderWidthPx: 2,
        maximumInformationCardBorderWidthPx: 3,
        allowedInformationCardBorderColorRoles: [
          "line-primary",
          "accent-primary",
          "accent-secondary"
        ],
        minimumInformationCardBorderRadiusPx: 14,
        maximumInformationCardBorderRadiusPx: 24,
        informationCardShadowMode: "none",
        minimumTextAreaRatio: 0.6,
        maximumGraphicAreaRatio: 0.4
      }
    }
  }],
  subtitles: []
});

const fixtureReview = validateVisualExpressionScene(CI_RENDER_SMOKE_EPISODE.scenes[0], {
  requireResolvedPlans: true
});
if (!fixtureReview.passed) {
  throw new Error(
    `CI render smoke 内联 visualPlan 不再符合生产合同：${JSON.stringify(fixtureReview.issues)}`
  );
}

const defaultDependencies = Object.freeze({
  bundle,
  mkdtemp,
  readFile,
  renderStill,
  resolveBrowserExecutable,
  rm,
  selectComposition,
  stat
});

export async function runCiRenderSmoke(options = {}) {
  const dependencies = { ...defaultDependencies, ...(options.dependencies ?? {}) };
  const temporaryRoot = await dependencies.mkdtemp(join(tmpdir(), "acs-ci-render-"));
  const bundleDirectory = resolve(temporaryRoot, "bundle");
  try {
    const browserExecutable = options.browserExecutable
      ?? await dependencies.resolveBrowserExecutable(null);
    if (!browserExecutable) {
      throw new Error(
        "CI render smoke requires an installed local Chrome/Chromium; automatic download is disabled"
      );
    }
    const serveUrl = await dependencies.bundle({
      entryPoint: resolve(videoRoot, "index.jsx"),
      outDir: bundleDirectory,
      publicDir: null,
      symlinkPublicDir: false,
      onProgress: () => undefined
    });
    const inputProps = { episode: CI_RENDER_SMOKE_EPISODE };
    const composition = await dependencies.selectComposition({
      serveUrl,
      id: CI_RENDER_SMOKE_COMPOSITION,
      inputProps,
      browserExecutable,
      chromeMode: CI_RENDER_SMOKE_CHROME_MODE,
      timeoutInMilliseconds: CI_RENDER_SMOKE_TIMEOUT_MS,
      logLevel: "warn"
    });
    const frameBuffers = [];
    const fileBytesByFrame = new Map();
    for (const frame of CI_RENDER_SMOKE_FRAMES) {
      const output = resolve(temporaryRoot, `smoke-frame-${frame}.png`);
      await dependencies.renderStill({
        composition,
        serveUrl,
        output,
        frame,
        inputProps,
        imageFormat: "png",
        overwrite: false,
        browserExecutable,
        chromeMode: CI_RENDER_SMOKE_CHROME_MODE,
        timeoutInMilliseconds: CI_RENDER_SMOKE_TIMEOUT_MS,
        logLevel: "warn"
      });
      const rendered = await dependencies.stat(output);
      if (!rendered.isFile() || rendered.size <= 8) {
        throw new Error(`CI render smoke 第 ${frame} 帧未生成有效 PNG`);
      }
      fileBytesByFrame.set(frame, rendered.size);
      frameBuffers.push({ frame, bytes: await dependencies.readFile(output) });
    }
    const audit = auditPngFrameSet(frameBuffers, {
      expectedWidth: composition.width,
      expectedHeight: composition.height
    });
    return {
      compositionId: CI_RENDER_SMOKE_COMPOSITION,
      fixtureId: CI_RENDER_SMOKE_EPISODE.id,
      semanticStructure: CI_RENDER_SMOKE_EPISODE.scenes[0].visualPlan.structure,
      frames: audit.frames.map((frame) => ({
        ...frame,
        bytes: fileBytesByFrame.get(frame.frame)
      })),
      distinctFrameCount: audit.distinctFrameCount
    };
  } finally {
    await dependencies.rm(temporaryRoot, { recursive: true, force: true });
  }
}

const isDirectRun = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isDirectRun) {
  const result = await runCiRenderSmoke();
  console.log(JSON.stringify(result));
}
