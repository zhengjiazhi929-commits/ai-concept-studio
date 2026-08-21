import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_CANDIDATES,
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_DURATION_SECONDS,
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FPS,
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FRAME_COUNT,
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_MATERIAL,
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME,
  AGENT_SKILL_LONG_BACKGROUND_SELECTED_CANDIDATE
} from "../src/video/agent-skill-long-background-comparison-plan.mjs";
import {
  AGENT_SKILL_LONG_BACKGROUND_MOTION_POLICY,
  AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY,
  agentSkillLongBackgroundMotionAtFrame,
  agentSkillLongSoftGradientMotionAtFrame
} from "../src/video/agent-skill-long-background-motion.mjs";
import { AGENT_SKILL_LONG_REVIEW_SCENE_SPECS } from "../src/video/agent-skill-long-review-plan.mjs";

const componentSource = await readFile(
  new URL("../src/video/agent-skill-long-review.jsx", import.meta.url),
  "utf8"
);
const backgroundsSource = await readFile(
  new URL("../src/video/agent-skill-long-backgrounds.jsx", import.meta.url),
  "utf8"
);
const renderSource = await readFile(
  new URL("../scripts/render-agent-skill-long-background-comparison.mjs", import.meta.url),
  "utf8"
);

test("S10 背景对照固定为30秒、30fps、900帧源窗口", () => {
  const s10 = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((scene) => scene.id === "S10");
  assert.equal(AGENT_SKILL_LONG_BACKGROUND_COMPARISON_DURATION_SECONDS, 30);
  assert.equal(AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FPS, 30);
  assert.equal(AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FRAME_COUNT, 900);
  assert.ok(AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME >= s10.startFrame);
  assert.ok(
    AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME +
      AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FRAME_COUNT <=
      s10.endFrame
  );
});

test("原始两个候选与已选动态方案共用同一素材与 Composition 尺寸", () => {
  assert.deepEqual(
    AGENT_SKILL_LONG_BACKGROUND_COMPARISON_CANDIDATES.map((candidate) => candidate.variant),
    ["blurred-material", "soft-gradient"]
  );
  assert.equal(
    AGENT_SKILL_LONG_BACKGROUND_SELECTED_CANDIDATE.variant,
    "soft-gradient-moving"
  );
  assert.equal(
    AGENT_SKILL_LONG_BACKGROUND_SELECTED_CANDIDATE.outputFileName,
    "01-soft-gradient-edge-swap-30s.mp4"
  );
  assert.equal(AGENT_SKILL_LONG_BACKGROUND_SELECTED_CANDIDATE.requiresMaterial, false);
  assert.equal(
    AGENT_SKILL_LONG_BACKGROUND_COMPARISON_MATERIAL,
    "episodes/agent-skill-20260806/materials/material-v003.png"
  );
  assert.match(renderSource, /compositionId: "AgentSkillLongReview"/u);
  assert.match(renderSource, /width: 540/u);
  assert.match(renderSource, /height: 960/u);
  assert.match(renderSource, /frameRange:/u);
});

test("方案一为全屏低透明度模糊素材，不创建内嵌卡片或视频边框", () => {
  assert.match(backgroundsSource, /AGENT_SKILL_LONG_BACKGROUND_VARIANTS\.blurredMaterial/u);
  assert.match(backgroundsSource, /<CanvasImage/u);
  assert.match(backgroundsSource, /inset: -38/u);
  assert.match(backgroundsSource, /filter: "blur\(22px\) saturate\(0\.72\) contrast\(0\.9\)"/u);
  assert.match(backgroundsSource, /opacity: 0\.18/u);
  assert.doesNotMatch(backgroundsSource, /data-background-video-frame/u);
});

test("方案二为抽象柔光渐变且不读取第二张素材图", () => {
  assert.match(backgroundsSource, /AGENT_SKILL_LONG_BACKGROUND_VARIANTS\.softGradient/u);
  assert.match(backgroundsSource, /radial-gradient\(ellipse 72% 46%/u);
  assert.match(backgroundsSource, /radial-gradient\(ellipse 68% 50%/u);
  assert.match(backgroundsSource, /radial-gradient\(ellipse 58% 42%/u);
  assert.equal((backgroundsSource.match(/<CanvasImage/gu) ?? []).length, 1);
});

test("已选方案使用25秒无缝帧驱动柔光且位移保持克制", () => {
  assert.equal(AGENT_SKILL_LONG_BACKGROUND_MOTION_POLICY.cycleSeconds, 25);
  assert.equal(AGENT_SKILL_LONG_BACKGROUND_MOTION_POLICY.cycleFrames, 750);
  assert.equal(18_000 % AGENT_SKILL_LONG_BACKGROUND_MOTION_POLICY.cycleFrames, 0);
  assert.deepEqual(
    agentSkillLongBackgroundMotionAtFrame(0),
    agentSkillLongBackgroundMotionAtFrame(750)
  );
  let previous = agentSkillLongBackgroundMotionAtFrame(0);
  for (let frame = 1; frame <= 750; frame += 1) {
    const state = agentSkillLongBackgroundMotionAtFrame(frame);
    assert.ok(Number.isFinite(state.x));
    assert.ok(Number.isFinite(state.y));
    assert.ok(Math.abs(state.x) <= 18);
    assert.ok(Math.abs(state.y) <= 11);
    assert.ok(Math.abs(state.x - previous.x) <= 0.151);
    assert.ok(Math.abs(state.y - previous.y) <= 0.093);
    previous = state;
  }
  const sampleStart = agentSkillLongBackgroundMotionAtFrame(
    AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME
  );
  const sampleEnd = agentSkillLongBackgroundMotionAtFrame(
    AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME +
      AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FRAME_COUNT -
      1
  );
  assert.notDeepEqual(sampleStart, sampleEnd);
  assert.match(backgroundsSource, /data-background-moving-soft-glow="subtle-25s"/u);
  assert.match(backgroundsSource, /willChange: "translate"/u);
});

test("方案二动态版只移动三层抽象柔光且不读取素材图", () => {
  assert.equal(AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.cycleSeconds, 25);
  assert.equal(AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.cycleFrames, 750);
  assert.equal(
    AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.schemaVersion,
    "agent-skill-long-soft-gradient-motion-v3"
  );
  assert.deepEqual(
    AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.edgeAnchorCenters,
    [
      { id: "right-upper", x: 540, y: 180 },
      { id: "left-middle", x: 0, y: 480 },
      { id: "bottom-right", x: 360, y: 960 }
    ]
  );
  assert.deepEqual(AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.scaleRange, {
    minimum: 0.85,
    maximum: 1.15
  });
  assert.deepEqual(
    agentSkillLongSoftGradientMotionAtFrame(0),
    agentSkillLongSoftGradientMotionAtFrame(750)
  );
  const firstCycleStart = agentSkillLongSoftGradientMotionAtFrame(
    AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME
  );
  const secondCycleStart = agentSkillLongSoftGradientMotionAtFrame(
    AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME +
      AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.cycleFrames
  );
  assert.deepEqual(firstCycleStart, secondCycleStart);
  const seamBefore = agentSkillLongSoftGradientMotionAtFrame(
    AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME +
      AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.cycleFrames -
      1
  );
  const firstStepBefore = agentSkillLongSoftGradientMotionAtFrame(
    AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME - 1
  );
  for (const id of ["purple", "mint", "orange"]) {
    assert.ok(Math.abs((secondCycleStart[id].x - seamBefore[id].x) -
      (firstCycleStart[id].x - firstStepBefore[id].x)) < 1e-12);
    assert.ok(Math.abs((secondCycleStart[id].y - seamBefore[id].y) -
      (firstCycleStart[id].y - firstStepBefore[id].y)) < 1e-12);
  }
  const at0 = agentSkillLongSoftGradientMotionAtFrame(0);
  const atOneThird = agentSkillLongSoftGradientMotionAtFrame(250);
  const atTwoThirds = agentSkillLongSoftGradientMotionAtFrame(500);
  for (const key of ["x", "y", "scale"]) {
    assert.ok(Math.abs(atOneThird.purple[key] - at0.mint[key]) < 1e-12);
    assert.ok(Math.abs(atOneThird.mint[key] - at0.orange[key]) < 1e-12);
    assert.ok(Math.abs(atOneThird.orange[key] - at0.purple[key]) < 1e-12);
    assert.ok(Math.abs(atTwoThirds.purple[key] - at0.orange[key]) < 1e-12);
    assert.ok(Math.abs(atTwoThirds.mint[key] - at0.purple[key]) < 1e-12);
    assert.ok(Math.abs(atTwoThirds.orange[key] - at0.mint[key]) < 1e-12);
  }
  assert.deepEqual(
    [at0.purple, at0.mint, at0.orange].map(({ centerX, centerY }) => ({
      centerX: Math.round(centerX),
      centerY: Math.round(centerY)
    })),
    [
      { centerX: 540, centerY: 180 },
      { centerX: 0, centerY: 480 },
      { centerX: 360, centerY: 960 }
    ]
  );
  let previous = agentSkillLongSoftGradientMotionAtFrame(0);
  let minimumScale = Infinity;
  let maximumScale = -Infinity;
  let minimumCenterDistance = Infinity;
  for (let frame = 1; frame <= 750; frame += 1) {
    const state = agentSkillLongSoftGradientMotionAtFrame(frame);
    for (const id of ["purple", "mint", "orange"]) {
      assert.ok(Number.isFinite(state[id].centerX));
      assert.ok(Number.isFinite(state[id].centerY));
      assert.ok(state[id].scale >= 0.85);
      assert.ok(state[id].scale <= 1.15);
      assert.ok(Math.abs(state[id].x - previous[id].x) < 2.7);
      assert.ok(Math.abs(state[id].y - previous[id].y) < 3.9);
      assert.ok(Math.abs(state[id].scale - previous[id].scale) < 0.0013);
      minimumScale = Math.min(minimumScale, state[id].scale);
      maximumScale = Math.max(maximumScale, state[id].scale);
    }
    const ids = ["purple", "mint", "orange"];
    for (let left = 0; left < ids.length; left += 1) {
      for (let right = left + 1; right < ids.length; right += 1) {
        minimumCenterDistance = Math.min(
          minimumCenterDistance,
          Math.hypot(
            state[ids[left]].centerX - state[ids[right]].centerX,
            state[ids[left]].centerY - state[ids[right]].centerY
          )
        );
      }
    }
    previous = state;
  }
  assert.ok(minimumScale < 0.851);
  assert.ok(maximumScale > 1.149);
  assert.ok(minimumCenterDistance > 500);
  assert.match(backgroundsSource, /data-background-moving-soft-gradient="three-color-swap-25s"/u);
  assert.match(backgroundsSource, /data-soft-gradient-layer=\{layer\.id\}/u);
  assert.match(backgroundsSource, /data-soft-gradient-blob=\{layer\.id\}/u);
  assert.match(backgroundsSource, /ellipse 60% 46% at 50% 50%/u);
  assert.match(backgroundsSource, /ellipse 58% 50% at 50% 50%/u);
  assert.match(backgroundsSource, /scale: motion\[layer\.id\]\.scale/u);
  assert.doesNotMatch(backgroundsSource, /1\.05 \* motion\[layer\.id\]\.scale/u);
  assert.match(backgroundsSource, /width: 640/u);
  assert.match(backgroundsSource, /height: 640/u);
  assert.match(backgroundsSource, /overflow: "hidden"/u);
  assert.equal((backgroundsSource.match(/<CanvasImage/gu) ?? []).length, 1);
  assert.match(renderSource, /backgroundMaterial: null/u);
  assert.match(renderSource, /materialUsed: false/u);
  assert.match(renderSource, /material: null/u);
});

test("对照动画继续逐帧驱动，不引入 CSS animation、transition 或 spring", () => {
  const source = `${componentSource}\n${backgroundsSource}`;
  assert.doesNotMatch(source, /\banimation\s*:/u);
  assert.doesNotMatch(source, /\btransition\s*:/u);
  assert.doesNotMatch(source, /\bspring\s*\(/u);
  assert.match(componentSource, /longReviewSceneLayersAtFrame\(frame\)/u);
});

test("渲染脚本只写独立未登记 v006 并保护 v005 与正式 v006 边界", () => {
  assert.match(renderSource, /candidateDirectoryName: "s10-background-comparison-v006"/u);
  assert.match(renderSource, /s10-background-comparison-v001\/comparison-manifest\.json/u);
  assert.match(renderSource, /s10-background-comparison-v002\/comparison-manifest\.json/u);
  assert.match(renderSource, /s10-background-comparison-v003\/comparison-manifest\.json/u);
  assert.match(renderSource, /s10-background-comparison-v004\/comparison-manifest\.json/u);
  assert.match(renderSource, /s10-background-comparison-v004\/qa\/qa-summary\.json/u);
  assert.match(renderSource, /s10-background-comparison-v005\/comparison-manifest\.json/u);
  assert.match(renderSource, /s10-background-comparison-v005\/qa\/qa-summary\.json/u);
  assert.match(renderSource, /agent-skill-long-background-comparison-v6/u);
  assert.match(renderSource, /backgroundFrameOffset: contract\.startFrame/u);
  assert.match(renderSource, /phaseAtFirstAndSecondCycleStartIdentical: true/u);
  assert.match(renderSource, /AGENT_SKILL_LONG_BACKGROUND_SELECTED_CANDIDATE/u);
  assert.match(renderSource, /full-video-current-visual-upgrade-v003\/review-10m\.mp4/u);
  assert.match(renderSource, /preview-v006\.mp4/u);
  assert.match(renderSource, /registered: false/u);
  assert.match(renderSource, /externalApiCalls: 0/u);
  assert.match(renderSource, /mutatesEpisode: false/u);
  assert.doesNotMatch(renderSource, /runNextReadyAgent|runAgent\(|renderPreview\(|runPreviewQa\(/u);
});
