import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  EDITORIAL_TIMING_POLICY,
  compileEditorialTimeline,
  cueFrameForNarration
} from "../src/shared/editorial-timing.mjs";
import { subtitleBoundaryReasons } from "../src/server/production/subtitle-segmentation.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const paragraphs = [
  "这是一段合成的教学旁白，说明测试记录如何进入当前工作区。首先检查来源，再确认所属用户。",
  "接下来复制需要使用的信息，保留原始记录不变。最后检查处理结果，确认后续动作没有提前出现。"
];
function fixture(count = 12) {
  const shots = Array.from({ length: count }, (_, index) => ({
    id: `B${index + 1}`,
    narration: paragraphs.join("\n\n"),
    unitIds: [`U${index + 1}a`, `U${index + 1}b`],
    sourceUnits: paragraphs.map((text, unitIndex) => ({
      id: `U${index + 1}${unitIndex ? "b" : "a"}`, sha256: sha(text)
    })),
    evidenceRefs: ["synthetic-source"]
  }));
  const types = ["title", "evidence", "statement", "summary"];
  return {
    shots,
    groups: shots.map((shot, index) => ({
      id: `S${index + 1}`, title: `合成场景 ${index + 1}`, type: types[index % 4], unitIds: [...shot.unitIds]
    })),
    timingPolicy: { ...EDITORIAL_TIMING_POLICY }
  };
}
function changeFirstNarration(value, narration) {
  value.shots[0].narration = narration;
  value.shots[0].unitIds = ["U1a"];
  value.shots[0].sourceUnits = [{ id: "U1a", sha256: sha(narration) }];
  value.groups[0].unitIds = ["U1a"];
}

test("editorial timing preserves original units without targeting an artificial duration", () => {
  const input = fixture();
  const before = structuredClone(input);
  const timeline = compileEditorialTimeline(input);
  assert.deepEqual(input, before);
  assert.equal(timeline.scenes.length, 12);
  assert.equal(timeline.timingStatus, "editorial-estimate");
  assert.equal(timeline.audioAligned, false);
  assert.ok(timeline.durationSeconds < 480);
  assert.equal(timeline.durationSeconds, timeline.durationInFrames / 30);
  assert.deepEqual(timeline.scenes.flatMap(scene => scene.unitIds), input.shots.flatMap(shot => shot.unitIds));
  assert.equal(timeline.scenes[0].narration, paragraphs.join("\n\n"));
  assert.deepEqual(timeline.scenes[0].sourceShotIds, ["B1"]);
  assert.deepEqual(timeline.scenes[0].evidenceRefs, ["synthetic-source"]);
  assert.equal(timeline.subtitles.map(cue => cue.text).join(""), input.shots.map(shot => shot.narration.replace(/\n+/gu, "")).join(""));
});

test("scene and subtitle integer-frame boundaries share the cue prefix estimator", () => {
  const timeline = compileEditorialTimeline(fixture());
  let sceneFrame = 0;
  let subtitleFrame = 0;
  for (const scene of timeline.scenes) {
    assert.equal(scene.startFrame, sceneFrame);
    assert.equal(scene.start, scene.startFrame / 30);
    assert.equal(scene.end, scene.endFrame / 30);
    assert.ok(scene.end - scene.start >= 12 && scene.end - scene.start <= 60);
    const cues = timeline.subtitles.filter(cue => cue.sceneId === scene.id);
    assert.ok(cues.length <= 8);
    for (const [index, cue] of cues.entries()) {
      assert.equal(cue.startFrame, subtitleFrame);
      assert.equal(cue.start, cue.startFrame / 30);
      assert.equal(cue.end, cue.endFrame / 30);
      assert.equal(cue.startFrame - scene.startFrame,
        cueFrameForNarration(scene.narration, cue.text, EDITORIAL_TIMING_POLICY));
      assert.ok(cue.end - cue.start >= 0.75 && cue.end - cue.start <= 5.5);
      if (index > 0) assert.deepEqual(subtitleBoundaryReasons(cues[index - 1].text, cue.text), []);
      subtitleFrame = cue.endFrame;
    }
    sceneFrame = scene.endFrame;
  }
  assert.equal(sceneFrame, timeline.durationInFrames);
  assert.equal(subtitleFrame, timeline.durationInFrames);
});

test("cue offsets account for punctuation, paragraph normalization and repeated occurrences", () => {
  const narration = "检查来源，确认身份。\n\n检查来源，再读记录。";
  const expected = Math.round((8 / 5.5 + 0.14 + 0.32) * 30);
  assert.equal(cueFrameForNarration(narration, "检查来源", EDITORIAL_TIMING_POLICY, 0), 0);
  assert.equal(cueFrameForNarration(narration, "检查来源", EDITORIAL_TIMING_POLICY, 1), expected);
  assert.throws(() => cueFrameForNarration(narration, "不存在", EDITORIAL_TIMING_POLICY));
  for (const occurrence of [-1, 0.5, 2, Infinity]) {
    assert.throws(() => cueFrameForNarration(narration, "检查来源", EDITORIAL_TIMING_POLICY, occurrence));
  }
});

test("timing policy is closed and cannot claim alignment, slow speech or arbitrary duration", () => {
  for (const patch of [
    { audioAligned: true }, { fps: 25 }, { charactersPerSecond: 2 },
    { minorPauseSeconds: 1 }, { majorPauseSeconds: 1 },
    { version: "other" }, { targetDurationSeconds: 480 }
  ]) {
    const input = fixture();
    Object.assign(input.timingPolicy, patch);
    assert.throws(() => compileEditorialTimeline(input));
  }
  const input = fixture();
  Object.defineProperty(input.timingPolicy, "fps", { get() { throw new Error("getter executed"); }, enumerable: true });
  assert.throws(() => compileEditorialTimeline(input), error => error.message !== "getter executed");
});

test("groups reject omitted, duplicate, reordered and unknown source units", () => {
  const mutations = [
    input => input.groups[0].unitIds.pop(),
    input => input.groups[0].unitIds.push(input.groups[0].unitIds[0]),
    input => input.groups[0].unitIds.reverse(),
    input => { input.groups[0].unitIds[0] = "unknown"; },
    input => input.groups.reverse()
  ];
  for (const mutate of mutations) {
    const input = fixture(); mutate(input);
    assert.throws(() => compileEditorialTimeline(input));
  }
});

test("closed scene groups reject unknown fields, duplicate ids and invalid scene types", () => {
  for (const mutate of [
    input => { input.groups[0].duration = 20; },
    input => { input.groups[0].type = "animation"; },
    input => { input.groups[0].id = input.groups[1].id; },
    input => { input.groups[0].unitIds = []; },
    input => { input.groups[0].title = ""; }
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => compileEditorialTimeline(input));
  }
});

test("source unit shape and original shot identity must be coherent", () => {
  for (const mutate of [
    input => { input.shots[0].sourceUnits[0].id = "wrong"; },
    input => { input.shots[0].sourceUnits[0].sha256 = "wrong"; },
    input => input.shots[0].sourceUnits.pop(),
    input => { input.shots[0].id = input.shots[1].id; },
    input => { input.shots[0].narration = paragraphs[0]; },
    input => { input.shots[0].evidenceRefs = [""]; }
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => compileEditorialTimeline(input));
  }
});

test("scene count remains between twelve and twenty four", () => {
  assert.throws(() => compileEditorialTimeline(fixture(11)));
  assert.throws(() => compileEditorialTimeline(fixture(25)));
});

test("short and long scenes fail instead of stretching or compressing narration", () => {
  for (const narration of ["合成测试。", paragraphs.join("").repeat(5)]) {
    const input = fixture(); changeFirstNarration(input, narration);
    assert.throws(() => compileEditorialTimeline(input), { code: "editorial_scene_duration_invalid" });
  }
});

test("more than eight natural subtitle cues is a hard failure", () => {
  const input = fixture();
  changeFirstNarration(input, "这是一段合成的教学旁白，说明测试记录如何进入当前工作区。".repeat(9));
  assert.throws(() => compileEditorialTimeline(input), { code: "editorial_scene_subtitle_count_invalid" });
});

test("source shots may split or combine only through complete consecutive units", () => {
  const input = fixture();
  const combined = {
    ...input.shots[0],
    unitIds: [...input.shots[0].unitIds, ...input.shots[1].unitIds],
    sourceUnits: [...input.shots[0].sourceUnits, ...input.shots[1].sourceUnits],
    narration: [input.shots[0].narration, input.shots[1].narration].join("\n\n")
  };
  input.shots.splice(0, 2, combined);
  const output = compileEditorialTimeline(input);
  assert.deepEqual(output.scenes[0].sourceShotIds, ["B1"]);
  assert.deepEqual(output.scenes[1].sourceShotIds, ["B1"]);
});

test("paragraph display normalization never joins two English words", () => {
  const input = fixture();
  const first = `${paragraphs[0]} Read`;
  const second = `record. ${paragraphs[1]}`;
  input.shots[0].narration = `${first}\n\n${second}`;
  input.shots[0].sourceUnits[0].sha256 = sha(first);
  input.shots[0].sourceUnits[1].sha256 = sha(second);
  const timeline = compileEditorialTimeline(input);
  assert.match(timeline.subtitles.filter(cue => cue.sceneId === "S1").map(cue => cue.text).join(""), /Read record/u);
  assert.equal(timeline.scenes[0].narration, `${first}\n\n${second}`);
  assert.equal(cueFrameForNarration(input.shots[0].narration, "Read record", EDITORIAL_TIMING_POLICY),
    cueFrameForNarration(input.shots[0].narration, "Read\n\nrecord", EDITORIAL_TIMING_POLICY));
});

test("editorial timing and existing semantic segmenter bundle for a browser without Node shims", async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/shared/editorial-timing.mjs", import.meta.url))],
    bundle: true, platform: "browser", write: false, logLevel: "silent", format: "esm"
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.outputFiles.length, 1);
});
