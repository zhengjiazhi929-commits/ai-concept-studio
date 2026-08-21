import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGENT_SKILL_UIVERSE_MOTION_PROOF,
  activeNodeMotionAtFrame,
  shallowTileMotionAtFrame,
  textMotionAtFrame
} from "../src/video/agent-skill-uiverse-motion-proof-plan.mjs";

const componentSource = await readFile(
  new URL("../src/video/agent-skill-uiverse-motion-proof.jsx", import.meta.url),
  "utf8"
);

test("8秒竖屏纠正版同屏使用平面70浅立体30与薄荷80紫20", () => {
  assert.equal(AGENT_SKILL_UIVERSE_MOTION_PROOF.schemaVersion, "agent-skill-uiverse-motion-proof-v2");
  assert.equal(AGENT_SKILL_UIVERSE_MOTION_PROOF.width, 540);
  assert.equal(AGENT_SKILL_UIVERSE_MOTION_PROOF.height, 960);
  assert.equal(AGENT_SKILL_UIVERSE_MOTION_PROOF.fps, 30);
  assert.equal(AGENT_SKILL_UIVERSE_MOTION_PROOF.durationInFrames, 240);
  assert.deepEqual(AGENT_SKILL_UIVERSE_MOTION_PROOF.balance, {
    flatPercent: 70,
    shallowDepthPercent: 30,
    primaryMintPercent: 80,
    secondaryPurplePercent: 20
  });
  assert.equal(AGENT_SKILL_UIVERSE_MOTION_PROOF.motion.maximumVisibleDepthPx, 2.5);
});

test("只有文字轻弹与三个浅层对象入场，全部单调且无超调", () => {
  const series = [
    Array.from({ length: 20 }, (_, frame) => textMotionAtFrame(frame, 2).progress),
    Array.from({ length: 40 }, (_, frame) => activeNodeMotionAtFrame(56 + frame).enterProgress),
    Array.from({ length: 30 }, (_, frame) => shallowTileMotionAtFrame(frame, 3).progress)
  ];
  for (const values of series) {
    for (let index = 0; index < values.length; index += 1) {
      assert.ok(values[index] >= 0 && values[index] <= 1);
      if (index > 0) assert.ok(values[index] >= values[index - 1]);
    }
  }
  assert.deepEqual(textMotionAtFrame(2, 2), {
    progress: 0,
    opacity: 0,
    translateY: 6,
    scale: 0.985
  });
  assert.deepEqual(textMotionAtFrame(14, 2), {
    progress: 1,
    opacity: 1,
    translateY: 0,
    scale: 1
  });
});

test("当前节点只进行一次轻聚焦并在210帧后稳定", () => {
  assert.equal(activeNodeMotionAtFrame(164).hoverProgress, 0);
  assert.equal(activeNodeMotionAtFrame(180).hoverProgress, 1);
  assert.equal(activeNodeMotionAtFrame(210).hoverProgress, 0);
  assert.deepEqual(activeNodeMotionAtFrame(210), activeNodeMotionAtFrame(239));
  let maximumStep = 0;
  let previous = activeNodeMotionAtFrame(62).translateY;
  for (let frame = 63; frame <= 239; frame += 1) {
    const current = activeNodeMotionAtFrame(frame).translateY;
    maximumStep = Math.max(maximumStep, Math.abs(current - previous));
    previous = current;
  }
  assert.ok(maximumStep < 1.05);
});

test("同屏恰好三个浅立体角色，其余结构保持平面", () => {
  const roles = [...componentSource.matchAll(/data-proof-depth-role="([^"]+)"/gu)]
    .map((match) => match[1]);
  assert.deepEqual(roles, ["active-node", "key-result", "human-approval"]);
  assert.match(componentSource, /data-proof-flat-layer="structure"/u);
  assert.equal((componentSource.match(/perspective:/gu) ?? []).length, 3);
});

test("Battery参考只允许文字节奏，禁用充电结构、发光轮廓与曲线路径", () => {
  assert.doesNotMatch(componentSource, /strokeDasharray|strokeDashoffset|pathLength|<svg|CONTROLLED RUN|repeat\(5|translateZ|percentage|charging|battery/iu);
  assert.doesNotMatch(componentSource, /animation\s*:|transition\s*:|@keyframes|spring\(|Math\.random|requestAnimationFrame/u);
  assert.doesNotMatch(componentSource, /#F2783A|#5276E6|orange|blueSoft/u);
  assert.match(componentSource, /useCurrentFrame/u);
});
