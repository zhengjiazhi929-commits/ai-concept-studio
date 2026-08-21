import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  VISUAL_SYSTEM_V1,
  VISUAL_SYSTEM_V1_DEPTH_ROLES
} from "../src/video/components/visual-system-v1/tokens.mjs";
import {
  visualSystemV1Layout,
} from "../src/video/components/visual-system-v1/layout.mjs";
import {
  VISUAL_SYSTEM_V1_AI_WATERMARK,
  aiWatermarkMotionAtFrame,
  visualSystemV1AiWatermarkGeometry,
  visualSystemV1AiWatermarkScale
} from "../src/video/components/visual-system-v1/ai-watermark.mjs";
import {
  visualSystemV1ChapterProgressAtFrame,
  visualSystemV1DepthMotionAtFrame,
  visualSystemV1HoverProgressAtFrame,
  visualSystemV1SceneOpacityAtFrame,
  visualSystemV1SpringMotionAtFrame,
  visualSystemV1TextMotionAtFrame,
  visualSystemV1WallpaperMotionAtFrame
} from "../src/video/components/visual-system-v1/motion.mjs";
import {
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CAPTIONS,
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS,
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF,
  visualSystemV1SkillAgentMcpProofLayout
} from "../src/video/visual-system-v1-skill-agent-mcp-proof-plan.mjs";
import {
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT,
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_WATERMARK_PROVENANCE
} from "../scripts/render-visual-system-v1-skill-agent-mcp-proof.mjs";

const source = async (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("visual-system-v1 保留双画幅兼容能力，但新默认只输出横版开放画布", () => {
  assert.equal(VISUAL_SYSTEM_V1.schemaVersion, "visual-system-v1");
  assert.equal(VISUAL_SYSTEM_V1.fps, 30);
  assert.deepEqual(VISUAL_SYSTEM_V1.formats.wide, { width: 1920, height: 1080, aspect: "16:9" });
  assert.deepEqual(VISUAL_SYSTEM_V1.formats.vertical, { width: 1080, height: 1920, aspect: "9:16" });
  assert.deepEqual(VISUAL_SYSTEM_V1.balance, {
    flatPercent: 70,
    shallowDepthPercent: 30,
    primaryMintPercent: 80,
    secondaryPurplePercent: 20,
    maximumAccentColors: 2,
    maximumSimultaneousHighlights: 3,
    maximumDiagramNodes: 12
  });
  assert.deepEqual(VISUAL_SYSTEM_V1_DEPTH_ROLES, [
    "active-node",
    "key-result",
    "human-confirmation"
  ]);
  assert.equal(VISUAL_SYSTEM_V1.depth.maximumVisibleDepthPx, 2.5);
  assert.equal(VISUAL_SYSTEM_V1.wallpaper.driftPeriodSeconds, 20);
  assert.equal(VISUAL_SYSTEM_V1.wallpaper.maximumDriftFraction, 0.015);
  assert.deepEqual(VISUAL_SYSTEM_V1.defaults, {
    surfaceMode: "flat-only",
    sameLevelSurfaceUniform: true,
    shallowDepthOptInOnly: true,
    outputFormat: "wide-only",
    contentFrameMode: "open-canvas",
    largeContentWindowEnabled: false,
    topHeaderEnabled: false,
    subtitleColor: "#000000",
    subtitleMotion: "none"
  });
  assert.equal(VISUAL_SYSTEM_V1.depth.available, true);
  assert.equal(VISUAL_SYSTEM_V1.depth.enabledByDefault, false);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.durationInFrames, 360);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.durationSeconds, 12);
  assert.deepEqual(Object.keys(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.compositions), ["wide"]);
});

test("通用库仍能读取竖版兼容布局，但v5样片只允许横版", () => {
  const wide = visualSystemV1SkillAgentMcpProofLayout(1920, 1080);
  const verticalCompatibility = visualSystemV1Layout(1080, 1920);
  assert.equal(wide.orientation, "wide");
  assert.equal(verticalCompatibility.orientation, "vertical");
  assert.equal(wide.nodes.skill.top, wide.nodes.agent.top);
  assert.equal(wide.connectors[0].orientation, "horizontal");
  assert.equal(wide.connectors.length, 4);
  assert.throws(() => visualSystemV1SkillAgentMcpProofLayout(1080, 1920), /默认只生成/u);
  assert.throws(() => visualSystemV1SkillAgentMcpProofLayout(540, 960), /仅支持/u);
});

test("右上角AI品牌水印固定120px与40px安全边距并完整循环三次", () => {
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.schemaVersion, "visual-system-v1-ai-watermark-v1");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.outputFormat, "wide-only");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.role, "persistent-brand-watermark");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.contentSurfacePolicyExempt, true);
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.renderMode, "validated-transparent-png-sequence");
  assert.equal(
    VISUAL_SYSTEM_V1_AI_WATERMARK.motionSchemaVersion,
    "visual-system-v1-ai-watermark-motion-proof-v12"
  );
  assert.deepEqual(VISUAL_SYSTEM_V1_AI_WATERMARK.placement, {
    size: 120,
    top: 40,
    right: 40,
    zIndex: 6
  });
  assert.deepEqual(visualSystemV1AiWatermarkGeometry(1920, 1080), {
    left: 1760,
    top: 40,
    right: 40,
    bottom: 920,
    width: 120,
    height: 120,
    zIndex: 6
  });
  assert.equal(visualSystemV1AiWatermarkScale(120), 0.46);
  assert.throws(() => visualSystemV1AiWatermarkGeometry(1080, 1920), /默认只允许/u);

  const watermark = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.watermark;
  assert.equal(watermark.enabled, true);
  assert.equal(watermark.component, "six-face-extruded-ai");
  assert.equal(watermark.contentSurfacePolicyExempt, true);
  assert.equal(watermark.completeCycles, 3);
  assert.equal(watermark.motionSchemaVersion, VISUAL_SYSTEM_V1_AI_WATERMARK.motionSchemaVersion);
  assert.deepEqual(watermark.rasterSequence, VISUAL_SYSTEM_V1_AI_WATERMARK.rasterSequence);
  assert.deepEqual(watermark.placement, VISUAL_SYSTEM_V1_AI_WATERMARK.placement);
  assert.deepEqual(watermark.motion.directionPattern, [
    "x-forward",
    "y-forward",
    "x-reverse",
    "y-reverse"
  ]);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.durationInFrames, 360);
  assert.equal(360 / watermark.motion.cycleFrames, 3);
  for (const frame of [0, 120, 240, 360]) {
    assert.deepEqual(aiWatermarkMotionAtFrame(frame), aiWatermarkMotionAtFrame(0));
  }
  assert.notDeepEqual(aiWatermarkMotionAtFrame(15), aiWatermarkMotionAtFrame(75));
  assert.notDeepEqual(aiWatermarkMotionAtFrame(45), aiWatermarkMotionAtFrame(105));
});

test("样片五个同层级节点全部平面，浅立体能力保留但默认不实例化", () => {
  const inventory = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.componentInventory;
  assert.equal(inventory.flatWorkflow.length, 5);
  assert.deepEqual(inventory.shallowDepthRuntime, []);
  assert.deepEqual(inventory.shallowDepthAvailable, VISUAL_SYSTEM_V1_DEPTH_ROLES);
  assert.deepEqual(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.surfacePolicy, {
    defaultMode: "flat-only",
    sameLevelSurfaceUniform: true,
    outputFormat: "wide-only",
    contentFrameMode: "open-canvas",
    topHeaderRuntimeCount: 0,
    largeContentWindowRuntimeCount: 0,
    runtimeShallowDepthCount: 0,
    shallowDepthCapabilityRetained: true
  });
});

test("文字12帧轻弹精确落稳且全程单调无超调", () => {
  assert.deepEqual(visualSystemV1TextMotionAtFrame(10, 10), {
    progress: 0,
    opacity: 0,
    translateY: 6,
    scale: 0.985
  });
  assert.deepEqual(visualSystemV1TextMotionAtFrame(21, 10), {
    progress: 1,
    opacity: 1,
    translateY: 0,
    scale: 1
  });
  let previous = visualSystemV1TextMotionAtFrame(10, 10);
  for (let frame = 11; frame <= 21; frame += 1) {
    const current = visualSystemV1TextMotionAtFrame(frame, 10);
    assert.ok(current.opacity >= previous.opacity);
    assert.ok(current.translateY <= previous.translateY);
    assert.ok(current.scale >= previous.scale && current.scale <= 1);
    previous = current;
  }
});

test("节点保留18帧 Remotion spring，浅立体厚度不超过2.5px", () => {
  assert.deepEqual(visualSystemV1SpringMotionAtFrame(44, 44), {
    progress: 0,
    opacity: 0,
    translateY: 12,
    scale: 0.985
  });
  assert.deepEqual(visualSystemV1SpringMotionAtFrame(61, 44), {
    progress: 1,
    opacity: 1,
    translateY: 0,
    scale: 1
  });
  let previous = 0;
  for (let frame = 44; frame <= 61; frame += 1) {
    const current = visualSystemV1SpringMotionAtFrame(frame, 44);
    assert.ok(current.progress >= previous);
    assert.ok(current.progress >= 0 && current.progress <= 1);
    previous = current.progress;
  }
  for (let frame = 0; frame < 360; frame += 1) {
    const current = visualSystemV1DepthMotionAtFrame(frame, 108);
    assert.ok(current.depthPx >= 0 && current.depthPx <= 2.5);
  }
});

test("场景首尾8帧淡化且两个内部切点透明度守恒", () => {
  const master = (frame) => visualSystemV1SceneOpacityAtFrame(frame, {
    startFrame: 0,
    endFrame: 360
  });
  assert.equal(master(0), 0);
  assert.equal(master(7), 1);
  assert.equal(master(352), 1);
  assert.equal(master(359), 0);
  const [a, b, c] = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.scenes;
  for (let frame = 64; frame <= 71; frame += 1) {
    const sum = visualSystemV1SceneOpacityAtFrame(frame, a) +
      visualSystemV1SceneOpacityAtFrame(frame, b);
    assert.ok(Math.abs(sum - 1) < 1e-12);
  }
  for (let frame = 184; frame <= 191; frame += 1) {
    const sum = visualSystemV1SceneOpacityAtFrame(frame, b) +
      visualSystemV1SceneOpacityAtFrame(frame, c);
    assert.ok(Math.abs(sum - 1) < 1e-12);
  }
});

test("底部三段章节进度按3比5比7真实时长连续单调推进", () => {
  assert.deepEqual(
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS.map(({ id, startFrame, endFrame }) => ({
      id,
      startFrame,
      endFrame
    })),
    [
      { id: "boundary", startFrame: 0, endFrame: 72 },
      { id: "execution", startFrame: 72, endFrame: 192 },
      { id: "review", startFrame: 192, endFrame: 360 }
    ]
  );
  assert.deepEqual(
    visualSystemV1ChapterProgressAtFrame(0, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments.map(({ status, progress }) => ({ status, progress })),
    [
      { status: "active", progress: 0 },
      { status: "future", progress: 0 },
      { status: "future", progress: 0 }
    ]
  );
  assert.equal(visualSystemV1ChapterProgressAtFrame(71, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments[0].progress, 1);
  assert.deepEqual(
    visualSystemV1ChapterProgressAtFrame(72, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments.map(({ status, progress }) => ({ status, progress })),
    [
      { status: "done", progress: 1 },
      { status: "active", progress: 0 },
      { status: "future", progress: 0 }
    ]
  );
  assert.equal(visualSystemV1ChapterProgressAtFrame(191, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments[1].progress, 1);
  assert.equal(visualSystemV1ChapterProgressAtFrame(192, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments[2].progress, 0);
  assert.equal(visualSystemV1ChapterProgressAtFrame(359, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS).segments[2].progress, 1);
  assert.deepEqual(
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS.map((chapter) => chapter.endFrame - chapter.startFrame),
    [72, 120, 168]
  );
  assert.deepEqual(
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS.map((chapter) => chapter.label),
    ["规则边界 · 2.4s", "受控执行 · 4.0s", "人工确认 · 5.6s"]
  );
  let previous = -1;
  for (let frame = 0; frame < 360; frame += 1) {
    const state = visualSystemV1ChapterProgressAtFrame(frame, VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS);
    const cumulative = state.segments.reduce((sum, segment) => sum + segment.progress, 0);
    assert.ok(cumulative >= previous);
    previous = cumulative;
  }
});

test("章节完成切点保持满亮，不在71到72或191到192帧闪暗", async () => {
  const components = await source("../src/video/components/visual-system-v1/components.jsx");
  const progress = components.slice(
    components.indexOf("export function VisualSystemV1ChapterProgress"),
    components.indexOf("export function VisualSystemV1PlainSubtitle")
  );
  assert.match(progress, /opacity: 1/u);
  assert.match(progress, /left: layout\.vertical \? 54 : 90/u);
  assert.match(progress, /right: layout\.vertical \? 54 : 90/u);
  assert.match(progress, /bottom: layout\.vertical \? 18 : 16/u);
  assert.match(progress, /gap: layout\.vertical \? 8 : 15/u);
  assert.match(progress, /color: palette\.muted/u);
  assert.match(progress, /fontWeight: 600/u);
  assert.match(progress, /backgroundColor: palette\.mint/u);
  assert.doesNotMatch(progress, /segment\.status === "done"[^\n]*opacity|opacity:\s*segment\.status/u);
  assert.doesNotMatch(progress, /chapter\.accent|labelColor|palette\.purple/u);
});

test("浅立体只执行一次2px轻悬浮并永久回到静止", () => {
  assert.equal(visualSystemV1HoverProgressAtFrame(277), 0);
  assert.equal(visualSystemV1HoverProgressAtFrame(278), 0);
  assert.equal(visualSystemV1HoverProgressAtFrame(287), 1);
  assert.equal(visualSystemV1HoverProgressAtFrame(291), 1);
  assert.equal(visualSystemV1HoverProgressAtFrame(305), 0);
  assert.equal(visualSystemV1HoverProgressAtFrame(359), 0);
  for (let frame = 0; frame < 360; frame += 1) {
    const state = visualSystemV1DepthMotionAtFrame(frame, 252, { hover: true });
    assert.ok(state.hoverProgress >= 0 && state.hoverProgress <= 1);
    assert.ok(state.translateY >= -2 && state.translateY <= 12);
  }
});

test("壁纸使用全局20秒周期且位移不超过画幅1.5%", () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    assert.deepEqual(
      visualSystemV1WallpaperMotionAtFrame(0, width, height),
      visualSystemV1WallpaperMotionAtFrame(600, width, height)
    );
    for (let frame = 0; frame <= 600; frame += 1) {
      const state = visualSystemV1WallpaperMotionAtFrame(frame, width, height);
      for (const layer of Object.values(state)) {
        assert.ok(Math.abs(layer.x) <= width * 0.015);
        assert.ok(Math.abs(layer.y) <= height * 0.015);
      }
    }
  }
});

test("字幕为稳定纯黑文字、无阴影、透明无描边且没有闪烁动效", async () => {
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CAPTIONS.length, 3);
  for (const caption of VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CAPTIONS) {
    assert.deepEqual(Object.keys(caption), [
      "text",
      "startMs",
      "endMs",
      "timestampMs",
      "confidence"
    ]);
    assert.ok(caption.endMs > caption.startMs);
    assert.doesNotMatch(caption.text, /\n/u);
  }
  const component = await source("../src/video/components/visual-system-v1/components.jsx");
  const subtitle = component.slice(component.indexOf("export function VisualSystemV1PlainSubtitle"));
  assert.match(subtitle, /data-visual-system-subtitle="stable-black-no-container"/u);
  assert.match(subtitle, /color: VISUAL_SYSTEM_V1\.defaults\.subtitleColor/u);
  assert.match(subtitle, /WebkitLineClamp: typography\.subtitleMaximumLines/u);
  assert.match(subtitle, /textShadow: "none"/u);
  assert.match(subtitle, /WebkitTextStroke: "0"/u);
  assert.doesNotMatch(subtitle, /visualSystemV1TextMotionAtFrame|state\.opacity|state\.translateY|state\.scale/u);
});

test("v5开放画布加入一个独立AI品牌水印且五个同层级内容节点仍全部平面", async () => {
  const [component, workflow, root, mainRoot, index, watermarkComponent] = await Promise.all([
    source("../src/video/visual-system-v1-skill-agent-mcp-proof.jsx"),
    source("../src/video/visual-system-v1-skill-agent-mcp-scenes/workflow.jsx"),
    source("../src/video/visual-system-v1-skill-agent-mcp-proof-root.jsx"),
    source("../src/video/root.jsx"),
    source("../src/video/components/visual-system-v1/index.jsx"),
    source("../src/video/components/visual-system-v1/ai-watermark.jsx")
  ]);
  assert.equal((component.match(/<VisualSystemV1SingleContentWindow\b/gu) ?? []).length, 0);
  assert.equal((component.match(/<VisualSystemV1OpenCanvasHeader\b/gu) ?? []).length, 0);
  assert.doesNotMatch(component, /VisualSystemV1OpenCanvasHeader/u);
  assert.match(component, /data-visual-system-content="open-canvas"/u);
  assert.equal((workflow.match(/<VisualSystemV1FlatNode\b/gu) ?? []).length, 5);
  assert.doesNotMatch(workflow, /VisualSystemV1ActiveNode|VisualSystemV1KeyResult|VisualSystemV1HumanConfirmation/u);
  assert.match(index, /VisualSystemV1ActiveNode/u);
  assert.match(index, /VisualSystemV1KeyResult/u);
  assert.match(index, /VisualSystemV1HumanConfirmation/u);
  assert.match(index, /VisualSystemV1OpenCanvasHeader/u);
  assert.match(index, /VisualSystemV1AiWatermark/u);
  assert.equal((component.match(/<VisualSystemV1AiWatermark\b/gu) ?? []).length, 1);
  assert.ok(
    component.indexOf("<VisualSystemV1AiWatermark") >
      component.indexOf("<VisualSystemV1SkillAgentMcpWorkflow")
  );
  assert.ok(
    component.indexOf("<VisualSystemV1AiWatermark") <
      component.indexOf("<VisualSystemV1PlainSubtitle")
  );
  assert.match(watermarkComponent, /data-visual-system-ai-watermark="persistent-six-face-ai"/u);
  assert.match(watermarkComponent, /data-ai-watermark-open-cube="six-extruded-ai-faces"/u);
  assert.match(watermarkComponent, /overflow: "hidden"/u);
  assert.match(watermarkComponent, /pointerEvents: "none"/u);
  assert.match(watermarkComponent, /useCurrentFrame/u);
  assert.doesNotMatch(
    watermarkComponent,
    /ProofBackground|640|animation\s*:|transition\s*:|@keyframes|requestAnimationFrame|Math\.random/u
  );
  assert.match(component, /<VisualSystemV1ChapterProgress/u);
  assert.ok(component.indexOf("<VisualSystemV1ChapterProgress") > component.indexOf("</div>"));
  assert.doesNotMatch(component, /<VisualSystemV1PlainSubtitle[\s\S]*opacity=/u);
  assert.match(root, /compositions\.wide\.id/u);
  assert.doesNotMatch(root, /compositions\.vertical/u);
  assert.doesNotMatch(mainRoot, /VisualSystemV1SkillAgentMcpProof/u);
  const all = `${component}\n${workflow}`;
  assert.doesNotMatch(all, /CanvasImage|<Img|<Video|staticFile|battery|charging|percentage|orange|#F2783A|#5276E6/iu);
  assert.doesNotMatch(all, /animation\s*:|transition\s*:|@keyframes|Math\.random|requestAnimationFrame/iu);
});

test("统一平面节点使用完整1px边框且没有阴影或伪立体底托", async () => {
  const components = await source("../src/video/components/visual-system-v1/components.jsx");
  const flatNode = components.slice(
    components.indexOf("export function VisualSystemV1FlatNode"),
    components.indexOf("function VisualSystemV1ShallowDepthObject")
  );
  assert.match(flatNode, /border: `1px solid \$\{palette\.line\}`/u);
  assert.match(flatNode, /borderRadius: 18/u);
  assert.match(flatNode, /boxShadow: "none"/u);
  assert.match(flatNode, /backgroundImage: "none"/u);
  assert.match(flatNode, /filter: "none"/u);
  assert.doesNotMatch(flatNode, /borderTop|borderBottom|linear-gradient|depthPx/u);
});

test("透明水印序列固定120张RGBA帧并由正式组件逐帧读取", async () => {
  const manifestUrl = new URL(
    "../public/assets/visual-system-v1/ai-watermark-v012/manifest.json",
    import.meta.url
  );
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  assert.equal(manifest.sourceMotionSchemaVersion, "visual-system-v1-ai-watermark-motion-proof-v12");
  assert.equal(manifest.frameCount, 120);
  assert.equal(manifest.transparentBackgroundRequired, true);
  assert.deepEqual(Object.keys(manifest.frames).map(Number), Array.from({ length: 120 }, (_, i) => i));
  const frames = await Promise.all(
    Array.from({ length: 120 }, (_, frame) =>
      readFile(
        new URL(
          `../public/assets/visual-system-v1/ai-watermark-v012/frames/frame-${String(frame).padStart(3, "0")}.png`,
          import.meta.url
        )
      )
    )
  );
  for (const frame of frames) {
    assert.equal(frame.toString("ascii", 1, 4), "PNG");
    assert.equal(frame.readUInt32BE(16), 120);
    assert.equal(frame.readUInt32BE(20), 120);
    assert.equal(frame[25], 6);
  }
  const component = await source("../src/video/components/visual-system-v1/ai-watermark.jsx");
  const persistent = component.slice(component.indexOf("export function VisualSystemV1AiWatermark({"));
  assert.match(persistent, /data-ai-watermark-raster-sequence="approved-v012-120-frame-cycle"/u);
  assert.match(persistent, /staticFile\(rasterFramePath\(frame\)\)/u);
  assert.doesNotMatch(persistent, /<AiOpenCube/u);
  assert.match(component, /data-ai-watermark-live-object="css-3d-raster-source-only"/u);
});

test("安全直渲合同固定单一横版、静音和独立v007水印候选", async () => {
  assert.equal(
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.candidateDirectoryName,
    "visual-system-v1-skill-agent-mcp-proof-v007"
  );
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.candidateVersion, 7);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.concurrency, 1);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.durationInFrames, 360);
  assert.equal(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.audioTrack, false);
  assert.deepEqual(Object.keys(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.outputs), ["wide"]);
  assert.deepEqual(
    [
      VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.outputs.wide.width,
      VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_RENDER_CONTRACT.outputs.wide.height
    ],
    [1920, 1080]
  );
  const renderer = await source("../scripts/render-visual-system-v1-skill-agent-mcp-proof.mjs");
  assert.match(renderer, /muted: true/u);
  assert.match(renderer, /enforceAudioTrack: false/u);
  assert.match(renderer, /overwrite: false/u);
  assert.match(renderer, /onBrowserDownload: denyBrowserDownload/u);
  assert.match(renderer, /formalEpisodeStateTouched: false/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v001/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v002/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v003/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v004/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v005/u);
  assert.match(renderer, /visual-system-v1-skill-agent-mcp-proof-v006/u);
  assert.match(renderer, /visual-system-v1-ai-watermark-motion-proof-v011/u);
  assert.match(renderer, /visual-system-v1-ai-watermark-motion-proof-v012/u);
  assert.match(renderer, /visual-system-v1-ai-watermark-size-proof-v002/u);
  assert.deepEqual(VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_WATERMARK_PROVENANCE, {
    motionCandidate:
      "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-motion-proof-v012",
    motionCandidateVersion: 12,
    motionSchemaVersion: "visual-system-v1-ai-watermark-motion-proof-v12",
    sizeCandidate:
      "outputs/studio/design-system/review-candidates/visual-system-v1-ai-watermark-size-proof-v002",
    rasterAssetManifest:
      "studio/public/assets/visual-system-v1/ai-watermark-v012/manifest.json",
    rasterAssetVersion: 12,
    rasterAssetFrameCount: 120
  });
  assert.match(renderer, /watermarkApprovalProvenance/u);
  assert.match(renderer, /protectedTrees/u);
  assert.doesNotMatch(renderer, /runAgent|runNextReadyAgent|renderPreview|runPreviewQa|cloudBackup/u);
});
