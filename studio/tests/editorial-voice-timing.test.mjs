import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {buildEditorialVoiceSpeechPlan, buildEditorialVoiceTiming,
  serializeEditorialVoiceSrt} from "../src/shared/editorial-voice-timing.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
function scenes() {
  return [
    {id: "S01", unitIds: ["hook", "S01:p1"], narration:
      "比如用户问客服：“这笔订单能退吗？”一句“你是专业客服”，只说明了角色。\n\n任务要求、处理规则、查到的资料、工具返回的结果，都进入本次输入。"},
    {id: "S02", unitIds: ["closing"], narration: "最后检查所有的记录，确认字幕完整保留原文。"}
  ];
}

test("speech plan preserves source paragraphs, punctuation and exact text", () => {
  const source = scenes();
  const before = structuredClone(source);
  const plan = buildEditorialVoiceSpeechPlan(source);
  assert.deepEqual(source, before);
  assert.equal(plan.schemaVersion, "editorial-voice-speech-plan-v1");
  assert.equal(plan.voiceId, "zm_010");
  assert.equal(plan.speed, 1.1);
  assert.equal(plan.sampleRate, 24000);
  const text = source.map(scene => scene.narration.replace(/[\r\n]/gu, "")).join("");
  assert.equal(plan.segments.map(item => item.text).join(""), text);
  assert.equal(plan.sourceTextSha256, sha(text));
  assert.equal(new Set(plan.segments.map(item => item.id)).size, plan.segments.length);
  for (const segment of plan.segments) {
    assert.equal(segment.textSha256, sha(segment.text));
    assert.ok([...segment.text].length <= 28);
    assert.ok(!/^[”’」』）》】]/u.test(segment.text));
    assert.ok(!/、$/u.test(segment.text));
  }
  const ends = plan.segments.filter((item, index, list) => item.unitId !== list[index + 1]?.unitId);
  assert.deepEqual(ends.map(item => item.pauseAfterSamples), [2880, 4800, 0]);
  assert.ok(plan.segments.filter(item => !ends.includes(item)).every(item => item.pauseAfterSamples === 0));
  assert.deepEqual(plan, buildEditorialVoiceSpeechPlan(scenes()));
});

test("speech plan rejects invalid identity, missing paragraphs and unapproved voices", () => {
  for (const source of [[], [{...scenes()[0], unitIds: ["one"]}],
    [scenes()[0], {...scenes()[1], id: "S01"}],
    [scenes()[0], {...scenes()[1], unitIds: ["hook"]}],
    [{...scenes()[0], narration: "第一段。\n\n\n\n尾段。"}],
    [{...scenes()[1], narration: "坏\u0000文本。"}]]) {
    assert.throws(() => buildEditorialVoiceSpeechPlan(source));
  }
  assert.throws(() => buildEditorialVoiceSpeechPlan(scenes(), {voiceId: "other"}));
  assert.throws(() => buildEditorialVoiceSpeechPlan(scenes(), {speed: 2}));
});

test("timing uses exact PCM samples and separate explicit silence, never glyph proportions", () => {
  const plan = buildEditorialVoiceSpeechPlan(scenes());
  const measurements = plan.segments.map((segment, index) => ({id: segment.id, sampleCount: 48001 + index}));
  const result = buildEditorialVoiceTiming(plan, measurements);
  let cursor = 0;
  for (const [index, segment] of result.segments.entries()) {
    assert.equal(segment.startSample, cursor);
    assert.equal(segment.endSample, cursor + measurements[index].sampleCount);
    assert.deepEqual(result.captions[index], {text: segment.text, startMs: cursor / 24,
      endMs: segment.endSample / 24, timestampMs: null, confidence: null});
    cursor = segment.endSample + segment.pauseAfterSamples;
    assert.equal(segment.nextSample, cursor);
  }
  assert.equal(result.totalSamples, cursor);
  assert.equal(result.durationSeconds, cursor / 24000);
  assert.deepEqual(result.scenes.map(scene => scene.id), ["S01", "S02"]);
  assert.deepEqual(result.units.map(unit => unit.id), ["hook", "S01:p1", "closing"]);
  assert.equal(result.scenes.at(-1).endSample, cursor);
  assert.equal(result.units.at(-1).endSample, cursor);
  assert.equal(result.alignmentMethod, "synthesis-segment-sample-boundaries-v1");
});

test("timing rejects changed plans, missing, extra, reordered or invalid measurements", () => {
  const plan = buildEditorialVoiceSpeechPlan(scenes());
  const measured = plan.segments.map(item => ({id: item.id, sampleCount: 48000}));
  for (const inputs of [measured.slice(1), [...measured, measured[0]], [...measured].reverse(),
    measured.map((item, index) => index ? item : {...item, sampleCount: 0}),
    measured.map((item, index) => index ? item : {...item, sampleCount: 1.5}),
    measured.map((item, index) => index ? item : {...item, sampleCount: Infinity}),
    measured.map((item, index) => index ? item : {...item, sampleCount: 24000 * 66})]) {
    assert.throws(() => buildEditorialVoiceTiming(plan, inputs));
  }
  for (const change of [p => p.segments[0].text += "改", p => p.sourceTextSha256 = "0".repeat(64),
    p => p.segments[0].pauseAfterSamples = 24000, p => p.segments[0].extra = true,
    p => p.sampleRate = 44100, p => p.segments[1].id = p.segments[0].id]) {
    const copy = structuredClone(plan); change(copy);
    assert.throws(() => buildEditorialVoiceTiming(copy, measured));
  }
});

test("real long and short audio remains measurable but is explicitly flagged, never padded", () => {
  const plan = buildEditorialVoiceSpeechPlan(scenes());
  const measured = plan.segments.map((item, index) => ({id: item.id,
    sampleCount: index === 0 ? 24000 * 6 : index === 1 ? 12000 : 48000}));
  const result = buildEditorialVoiceTiming(plan, measured);
  assert.deepEqual(result.captionDurationIssues, [
    {id: plan.segments[0].id, durationSeconds: 6, code: "subtitle-duration-out-of-range"},
    {id: plan.segments[1].id, durationSeconds: 0.5, code: "subtitle-duration-out-of-range"}
  ]);
  assert.equal(result.segments[0].sampleCount, 144000);
  assert.equal(result.segments[1].sampleCount, 12000);
});

test("SRT rounds absolute millisecond boundaries and rejects invalid captions", () => {
  const input = [{text: "测试原文。", startMs: 0, endMs: 2000.49, timestampMs: null, confidence: null},
    {text: "继续。", startMs: 2120.51, endMs: 3678.9, timestampMs: null, confidence: null}];
  assert.equal(serializeEditorialVoiceSrt(input),
    "1\n00:00:00,000 --> 00:00:02,000\n测试原文。\n\n2\n00:00:02,121 --> 00:00:03,679\n继续。\n");
  for (const captions of [[{...input[0], endMs: 0}], [{...input[0], startMs: -1}],
    [input[1], input[0]], [{...input[0], text: "坏\n\n字幕"}]]) {
    assert.throws(() => serializeEditorialVoiceSrt(captions));
  }
});
