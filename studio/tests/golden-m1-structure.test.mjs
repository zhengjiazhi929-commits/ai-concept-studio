import assert from "node:assert/strict";
import test from "node:test";

import {
  bindGoldenM1LogicalEvidence,
  buildGoldenM1ScriptContent,
  buildGoldenM1ScriptDraft,
  buildGoldenM1StoryboardDraft,
  goldenM1ProductionProfile
} from "../src/server/production/golden-m1-structure.mjs";

function timeline() {
  const boundaries = [[0, 5], [5, 11], [11, 17], [17, 23], [23, 30], [30, 36]];
  return {
    scenes: boundaries.map(([start, end], index) => ({
      id: `S0${index + 1}`,
      start,
      end,
      type: index === 1 || index === 3 || index === 4 ? "evidence" : "statement"
    })),
    subtitles: boundaries.map(([start, end], index) => ({
      start,
      end,
      text: `第 ${index + 1} 段旁白内容用于固定结构测试`
    }))
  };
}

test("golden M1 短脚本逐段绑定时间轴、研究 claim 与逻辑证据", () => {
  const { scenes, subtitles } = timeline();
  const bound = bindGoldenM1LogicalEvidence(scenes);
  assert.equal(bound.find((scene) => scene.id === "S02").evidenceRef,
    "demo-baseline-export-failed");
  assert.equal(bound.find((scene) => scene.id === "S01").evidenceRef, undefined);

  const content = buildGoldenM1ScriptContent(bound, subtitles);
  assert.equal(content.targetDurationSeconds, 36);
  assert.equal(content.sections.length, 6);
  assert.deepEqual(content.sections[3].evidenceRefs, ["C06"]);
  assert.equal(content.sections[5].end, 36);
  assert.equal(buildGoldenM1ScriptDraft(bound, subtitles).content.kind,
    "golden-m1-short-script-v1");
  assert.equal(buildGoldenM1StoryboardDraft().sourceKind,
    "episode-scenes-subtitles-render-v1");
  assert.deepEqual(goldenM1ProductionProfile(), {
    id: "m1-golden-36s-v1",
    targetDurationSeconds: 36
  });
});

test("golden M1 短脚本拒绝场景与旁白时间错位", () => {
  const { scenes, subtitles } = timeline();
  subtitles[2].end = 18;
  assert.throws(
    () => buildGoldenM1ScriptContent(scenes, subtitles),
    (error) => error.code === "golden_m1_structure_invalid"
  );
});
