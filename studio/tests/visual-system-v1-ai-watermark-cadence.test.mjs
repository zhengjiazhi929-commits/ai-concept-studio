import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  VISUAL_SYSTEM_V1_AI_WATERMARK,
  VISUAL_SYSTEM_V1_AI_WATERMARK_CADENCES,
  VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_CADENCE_ID,
  visualSystemV1AiWatermarkCadence,
  visualSystemV1AiWatermarkCadenceState,
  visualSystemV1AiWatermarkDefaultLongformTransitions,
  visualSystemV1AiWatermarkGeometry
} from "../src/video/components/visual-system-v1/ai-watermark.mjs";

const cadenceState = ({
  frame,
  durationInFrames = 18000,
  cadenceId = "longform-quiet",
  transitionFrames
}) =>
  visualSystemV1AiWatermarkCadenceState({
    frame,
    durationInFrames,
    rasterFrameCount: 120,
    cadenceId,
    transitionFrames
  });

test("水印节奏合同把标准连续动效与长片安静正文分离", () => {
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_CADENCE_ID, "continuous");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.defaultCadenceId, "continuous");
  assert.equal(VISUAL_SYSTEM_V1_AI_WATERMARK.schemaVersion, "visual-system-v1-ai-watermark-v2");
  assert.equal(
    VISUAL_SYSTEM_V1_AI_WATERMARK.cadenceSelectionPolicy,
    "continuous-standard-longform-quiet-explicit-transitions"
  );
  assert.equal(visualSystemV1AiWatermarkCadence(), VISUAL_SYSTEM_V1_AI_WATERMARK_CADENCES.continuous);
  assert.deepEqual(VISUAL_SYSTEM_V1_AI_WATERMARK_CADENCES["longform-quiet"], {
    id: "longform-quiet",
    visibilityPolicy: "persistent-all-frames",
    bodyMotionPolicy: "static-approved-raster-frame",
    transitionMotionPolicy: "restrained-closed-raster-excursion-per-declared-transition",
    geometryPolicy: "immutable-approved-placement",
    idleRasterFrame: 0,
    transitionWindowFrames: 30,
    transitionRasterExcursionFrames: 10,
    defaultTransitionPolicy: "composition-entry-and-exit-only"
  });
  assert.throws(
    () => visualSystemV1AiWatermarkCadence("busy-longform"),
    /未知的 visual-system-v1 AI 水印 cadence/u
  );
});

test("标准节奏保留原120帧循环且不改变v013几何", () => {
  for (const frame of [0, 1, 119, 120, 241]) {
    const state = cadenceState({ frame, cadenceId: "continuous" });
    assert.equal(state.cadenceId, "continuous");
    assert.equal(state.visibilityPolicy, "persistent-all-frames");
    assert.equal(state.phase, "continuous-motion");
    assert.equal(state.motionActive, true);
    assert.equal(state.rasterFrame, frame % 120);
  }
  assert.deepEqual(visualSystemV1AiWatermarkGeometry(1920, 1080), {
    left: 1760,
    top: 40,
    right: 40,
    bottom: 920,
    width: 120,
    height: 120,
    zIndex: 6
  });
});

test("长片正文保持静态，只在声明的场景切换窗口播放闭合微动", () => {
  const transitionFrames = [300, 900];
  for (const frame of [0, 299, 330, 450, 899, 930, 1200, 17999]) {
    const state = cadenceState({ frame, transitionFrames });
    assert.equal(state.cadenceId, "longform-quiet");
    assert.equal(state.visibilityPolicy, "persistent-all-frames");
    assert.equal(state.phase, "quiet-body-hold");
    assert.equal(state.motionActive, false);
    assert.equal(state.rasterFrame, 0);
  }

  assert.deepEqual(cadenceState({ frame: 300, transitionFrames }), {
    cadenceId: "longform-quiet",
    visibilityPolicy: "persistent-all-frames",
    phase: "declared-transition-motion",
    motionActive: true,
    rasterFrame: 0,
    transitionFrame: 300,
    transitionOffset: 0
  });
  assert.equal(cadenceState({ frame: 314, transitionFrames }).rasterFrame, 10);
  assert.equal(cadenceState({ frame: 328, transitionFrames }).rasterFrame, 1);
  assert.equal(cadenceState({ frame: 329, transitionFrames }).rasterFrame, 0);
  assert.equal(cadenceState({ frame: 329, transitionFrames }).motionActive, true);
  assert.equal(cadenceState({ frame: 330, transitionFrames }).motionActive, false);
});

test("未声明场景边界时长片只在片头片尾运动且正文仍全程存在", () => {
  assert.deepEqual(visualSystemV1AiWatermarkDefaultLongformTransitions(18000), [0, 17970]);
  for (const frame of [0, 29, 17970, 17999]) {
    const state = cadenceState({ frame });
    assert.equal(state.motionActive, true);
    assert.equal(state.visibilityPolicy, "persistent-all-frames");
  }
  for (const frame of [30, 300, 9000, 17969]) {
    const state = cadenceState({ frame });
    assert.equal(state.phase, "quiet-body-hold");
    assert.equal(state.motionActive, false);
    assert.equal(state.rasterFrame, 0);
    assert.equal(state.visibilityPolicy, "persistent-all-frames");
  }
  assert.equal(cadenceState({ frame: 29 }).rasterFrame, 0);
  assert.equal(cadenceState({ frame: 17999 }).rasterFrame, 0);
  assert.deepEqual(
    cadenceState({ frame: 17999, transitionFrames: null }),
    cadenceState({ frame: 17999 })
  );
});

test("长片切换帧输入错误时fail closed", () => {
  assert.throws(
    () => cadenceState({ frame: 0, transitionFrames: "300" }),
    /场景切换帧必须是数组/u
  );
  assert.throws(
    () => cadenceState({ frame: 0, transitionFrames: [-1] }),
    /场景切换帧必须是非负整数/u
  );
  assert.throws(
    () => cadenceState({ frame: 0, transitionFrames: [1.5] }),
    /场景切换帧必须是非负整数/u
  );
  assert.throws(
    () => cadenceState({ frame: 0, transitionFrames: [18000] }),
    /场景切换窗口必须完整位于成片范围内/u
  );
  assert.throws(
    () => cadenceState({ frame: 17999, transitionFrames: [17990] }),
    /场景切换窗口必须完整位于成片范围内/u
  );
  assert.throws(
    () => cadenceState({ frame: 310, transitionFrames: [300, 310] }),
    /场景切换窗口不能重叠/u
  );
  assert.throws(
    () => cadenceState({ frame: 300, transitionFrames: [300, 300] }),
    /场景切换帧不能重复/u
  );
  assert.throws(
    () => cadenceState({ frame: 0, transitionFrames: [] }),
    /场景切换帧不能为空数组/u
  );
  assert.throws(
    () => cadenceState({ frame: 0, durationInFrames: 20 }),
    /成片帧数不能短于闭合切换窗口/u
  );
});

test("正式组件用Remotion当前帧选择素材，不使用CSS循环或随机时间", async () => {
  const source = await readFile(
    new URL("../src/video/components/visual-system-v1/ai-watermark.jsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /useCurrentFrame\(\)/u);
  assert.match(source, /visualSystemV1AiWatermarkCadenceState\(\{/u);
  assert.match(source, /rasterFramePath\(cadenceState\.rasterFrame, resolvedProfile\)/u);
  assert.match(source, /data-ai-watermark-visibility-policy=\{cadenceState\.visibilityPolicy\}/u);
  assert.match(source, /data-ai-watermark-motion-cadence=\{cadenceState\.cadenceId\}/u);
  assert.match(source, /data-ai-watermark-motion-active=/u);
  assert.doesNotMatch(
    source,
    /animation\s*:|transition\s*:|@keyframes|requestAnimationFrame|Math\.random|Date\.now/u
  );
});
