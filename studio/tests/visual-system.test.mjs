import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const studioRoot = resolve(import.meta.dirname, "..");

test("视觉系统配置固定16:9母版和9:16重构输出", async () => {
  const config = JSON.parse(
    await readFile(resolve(studioRoot, "config", "visual-system.json"), "utf8")
  );
  assert.deepEqual(
    [config.master.width, config.master.height, config.master.fps],
    [1920, 1080, 30]
  );
  assert.deepEqual(
    [config.derivatives.vertical.width, config.derivatives.vertical.height],
    [1080, 1920]
  );
  assert.equal(config.derivatives.vertical.strategy, "recompose-and-focus");
  assert.equal(config.id, "desktop-light-window-editorial-v3");
  assert.equal(config.motion.stageManager.mode, "single-window-two-phase");
  assert.equal(config.motion.stageManager.overlapFrames, 0);
  assert.equal(config.motion.stageManager.holdFrames, 3);
  assert.ok(config.motion.stageManager.enterScale >= 0.95);
  assert.ok(config.motion.stageManager.exitScale >= 0.9);
  assert.ok(config.motion.stageManager.exitScale < 1);
  assert.equal(config.colors.canvas, "#F2F2F4");
  assert.equal(config.diagram.theme, "light-control-plane");
  assert.ok(config.motion.references.some((item) => item.name === "Apple Stage Manager"));
  assert.ok(config.motion.references.some((item) => item.name === "Apple Keynote Magic Move"));
});

test("样片规范明确禁用播放器进度元素", async () => {
  const config = JSON.parse(
    await readFile(resolve(studioRoot, "config", "visual-system.json"), "utf8")
  );
  for (const item of ["progress-bar", "playhead", "elapsed-time", "total-time", "chapter-count"]) {
    assert.ok(config.forbidden.includes(item));
  }
  for (const item of ["dark-theme", "dual-window-overlap-transition", "window-blur-transition"]) {
    assert.ok(config.forbidden.includes(item));
  }
});

test("样片包含双比例Composition且不复用旧ProgressStrip", async () => {
  const root = await readFile(resolve(studioRoot, "src", "video", "root.jsx"), "utf8");
  const sample = await readFile(
    resolve(studioRoot, "src", "video", "visual-system-sample.jsx"),
    "utf8"
  );
  const components = await readFile(
    resolve(studioRoot, "src", "video", "components", "visual-system.jsx"),
    "utf8"
  );
  assert.match(root, /VisualSystemSampleWide/u);
  assert.match(root, /VisualSystemSampleVertical/u);
  assert.doesNotMatch(sample, /ProgressStrip/u);
  assert.match(sample, /stageWindowMotion/u);
  assert.match(sample, /activeSceneEntry/u);
  assert.doesNotMatch(sample, /scaleX\(/u);
  assert.doesNotMatch(components, /motion\.blur/u);
  assert.doesNotMatch(components, /transformOrigin: "0% 50%"/u);
});
