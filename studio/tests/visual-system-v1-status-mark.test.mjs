import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { VISUAL_SYSTEM_V1 } from "../src/video/components/visual-system-v1/tokens.mjs";
import {
  VISUAL_SYSTEM_V1_STATUS_MARK_MOTION,
  VISUAL_SYSTEM_V1_STATUS_MARK_REFERENCE,
  VISUAL_SYSTEM_V1_STATUS_MARK_SIZE_ROLES,
  VISUAL_SYSTEM_V1_STATUS_MARK_STATUSES,
  VISUAL_SYSTEM_V1_STATUS_MARK_TOKENS,
  VISUAL_SYSTEM_V1_STATUS_MARK_VARIANTS,
  visualSystemV1StatusMarkProgressAtFrame,
  visualSystemV1StatusMarkState
} from "../src/video/components/visual-system-v1/status-mark.mjs";

const JSX_PATH = new URL(
  "../src/video/components/visual-system-v1/status-mark.jsx",
  import.meta.url
);

test("状态对号记录 Uiverse MIT 来源和独立 Remotion 改写边界", () => {
  assert.equal(VISUAL_SYSTEM_V1_STATUS_MARK_REFERENCE.source, "Uiverse");
  assert.equal(
    VISUAL_SYSTEM_V1_STATUS_MARK_REFERENCE.url,
    "https://uiverse.io/cssbuttons-io/short-shrimp-54"
  );
  assert.equal(VISUAL_SYSTEM_V1_STATUS_MARK_REFERENCE.author, "cssbuttons-io");
  assert.equal(VISUAL_SYSTEM_V1_STATUS_MARK_REFERENCE.license, "MIT");
  assert.deepEqual(VISUAL_SYSTEM_V1_STATUS_MARK_REFERENCE.original, {
    widthPx: 27,
    heightPx: 27,
    borderRadiusPx: 3,
    checkedBackground: "#6871f1",
    checkColor: "#ffffff",
    checkDelaySeconds: 0.15,
    jellyDurationSeconds: 0.6
  });
  assert.equal(VISUAL_SYSTEM_V1_STATUS_MARK_REFERENCE.secondaryReference.checkDrawSeconds, 0.2);
  assert.deepEqual(VISUAL_SYSTEM_V1_STATUS_MARK_REFERENCE.adaptation, {
    mode: "independent-remotion-frame-driven-reimplementation",
    copiedComponentCode: false,
    cssAnimation: false,
    cssTransition: false,
    continuousLoop: false,
    palette: "visual-system-v1"
  });
});

test("状态、变体、尺寸角色和运行时颜色均属于 visual-system-v1", () => {
  assert.deepEqual(VISUAL_SYSTEM_V1_STATUS_MARK_VARIANTS, ["quiet", "celebrate"]);
  assert.deepEqual(VISUAL_SYSTEM_V1_STATUS_MARK_STATUSES, [
    "complete",
    "pending",
    "disabled"
  ]);
  assert.deepEqual(Object.keys(VISUAL_SYSTEM_V1_STATUS_MARK_SIZE_ROLES), [
    "inline",
    "support",
    "focus"
  ]);
  assert.equal(
    VISUAL_SYSTEM_V1_STATUS_MARK_TOKENS.complete.backgroundColor,
    VISUAL_SYSTEM_V1.palette.mintDeep
  );
  assert.equal(
    VISUAL_SYSTEM_V1_STATUS_MARK_TOKENS.complete.checkColor,
    VISUAL_SYSTEM_V1.palette.whiteHighlight
  );
  assert.equal(
    VISUAL_SYSTEM_V1_STATUS_MARK_TOKENS.pending.borderColor,
    VISUAL_SYSTEM_V1.palette.lineStrong
  );
  assert.equal(
    VISUAL_SYSTEM_V1_STATUS_MARK_TOKENS.disabled.borderColor,
    VISUAL_SYSTEM_V1.palette.faint
  );
});

test("frame helper 提供可截断的外部 progress 且完成后稳定", () => {
  assert.equal(visualSystemV1StatusMarkProgressAtFrame({ frame: 9, startFrame: 10 }), 0);
  assert.equal(visualSystemV1StatusMarkProgressAtFrame({ frame: 10, startFrame: 10 }), 0);
  assert.equal(
    visualSystemV1StatusMarkProgressAtFrame({
      frame: 13,
      startFrame: 10,
      variant: "quiet",
      durationInFrames: 7
    }),
    0.5
  );
  assert.equal(
    visualSystemV1StatusMarkProgressAtFrame({
      frame: 13,
      startFrame: 10,
      variant: "celebrate",
      durationInFrames: 7
    }),
    0.5
  );
  assert.equal(
    visualSystemV1StatusMarkProgressAtFrame({ frame: 15, startFrame: 10 }),
    1
  );
  assert.equal(
    visualSystemV1StatusMarkProgressAtFrame({ frame: 100, startFrame: 10 }),
    1
  );
  assert.equal(VISUAL_SYSTEM_V1_STATUS_MARK_MOTION.quietDurationInFrames, 6);
  assert.equal(VISUAL_SYSTEM_V1_STATUS_MARK_MOTION.celebrateDurationInFrames, 18);
  assert.throws(
    () => visualSystemV1StatusMarkProgressAtFrame({ frame: 1, durationInFrames: 0 }),
    /greater than zero/u
  );
});

test("quiet 只描边长出，不改变共同方形底", () => {
  const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map((progress) =>
    visualSystemV1StatusMarkState({ progress, variant: "quiet", sizeRole: "inline" })
  );

  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index].checkProgress >= samples[index - 1].checkProgress);
  }
  for (const sample of samples) {
    assert.equal(sample.scaleX, 1);
    assert.equal(sample.scaleY, 1);
    assert.equal(sample.checkScale, 1);
  }
  assert.equal(samples[0].checkProgress, 0);
  assert.equal(samples.at(-1).checkProgress, 1);
  assert.deepEqual(
    visualSystemV1StatusMarkState({ progress: 1, variant: "quiet" }),
    visualSystemV1StatusMarkState({ progress: 30, variant: "quiet" })
  );
});

test("celebrate 只执行一次 jelly，延迟显示对号并在末帧稳定", () => {
  const early = visualSystemV1StatusMarkState({ progress: 0.2, variant: "celebrate" });
  const delayed = visualSystemV1StatusMarkState({ progress: 0.25, variant: "celebrate" });
  const entering = visualSystemV1StatusMarkState({ progress: 0.45, variant: "celebrate" });
  const horizontal = visualSystemV1StatusMarkState({ progress: 0.2, variant: "celebrate" });
  const vertical = visualSystemV1StatusMarkState({ progress: 0.38, variant: "celebrate" });
  const final = visualSystemV1StatusMarkState({ progress: 1, variant: "celebrate" });
  const afterFinal = visualSystemV1StatusMarkState({ progress: 12, variant: "celebrate" });

  assert.equal(early.checkProgress, 0);
  assert.equal(delayed.checkProgress, 0);
  assert.ok(entering.checkProgress > 0);
  assert.ok(horizontal.scaleX > 1 && horizontal.scaleY < 1);
  assert.ok(vertical.scaleX < 1 && vertical.scaleY > 1);
  assert.equal(final.scaleX, 1);
  assert.equal(final.scaleY, 1);
  assert.equal(final.checkProgress, 1);
  assert.equal(final.settled, true);
  assert.deepEqual(afterFinal, final);
});

test("pending 和 disabled 均无对号、无 jelly，且共用同一尺寸几何", () => {
  const pending = visualSystemV1StatusMarkState({
    progress: 0.38,
    variant: "celebrate",
    sizeRole: "support",
    status: "pending"
  });
  const disabled = visualSystemV1StatusMarkState({
    progress: 0.38,
    variant: "celebrate",
    sizeRole: "support",
    status: "disabled"
  });

  for (const state of [pending, disabled]) {
    assert.equal(state.checkProgress, 0);
    assert.equal(state.checkOpacity, 0);
    assert.equal(state.scaleX, 1);
    assert.equal(state.scaleY, 1);
    assert.equal(state.settled, true);
    assert.equal(state.sizePx, 36);
    assert.equal(state.borderRadiusPx, 6);
  }
  assert.ok(disabled.opacity < pending.opacity);
});

test("无效公开 API fail closed", () => {
  assert.throws(
    () => visualSystemV1StatusMarkState({ progress: Number.NaN }),
    /finite number/u
  );
  assert.throws(
    () => visualSystemV1StatusMarkState({ variant: "loop" }),
    /Unknown status mark variant/u
  );
  assert.throws(
    () => visualSystemV1StatusMarkState({ sizeRole: "tiny" }),
    /Unknown status mark size role/u
  );
  assert.throws(
    () => visualSystemV1StatusMarkState({ status: "error" }),
    /Unknown status mark status/u
  );
});

test("JSX 只由 progress 驱动 SVG 描边与独立 scale 属性", async () => {
  const source = await readFile(JSX_PATH, "utf8");

  for (const prop of ["progress", "variant", "sizeRole", "status"]) {
    assert.match(source, new RegExp(`${prop} =`, "u"));
  }
  assert.match(source, /strokeDasharray="1"/u);
  assert.match(source, /strokeDashoffset=\{1 - state\.checkProgress\}/u);
  assert.match(source, /scale: `\$\{state\.scaleX\} \$\{state\.scaleY\}`/u);
  assert.match(source, /scale: state\.checkScale/u);
  assert.match(source, /data-status-mark-motion=\{VISUAL_SYSTEM_V1_STATUS_MARK_MOTION\.mode\}/u);
  assert.doesNotMatch(source, /(?:animation|transition)\s*:/u);
  assert.doesNotMatch(source, /@keyframes|requestAnimationFrame|setInterval|Math\.random|spring\(/u);
  assert.doesNotMatch(source, /#6871f1|#fff(?:fff)?/iu);
});
