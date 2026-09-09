import assert from "node:assert/strict";
import test from "node:test";

import {
  PRESENTATION_PACING_POLICY,
  buildSynchronizedPacingFilterGraph,
  deriveContentDrivenPresentation,
  pacedFrameCount,
  validatePresentationPlaybackRate
} from "../src/server/production/presentation-pacing.mjs";

test("内容驱动节奏不再把 600 秒当成目标时长", () => {
  const timeline = {
    fps: 30,
    sampleRate: 48_000,
    durationInFrames: 18_000,
    durationInSamples: 28_800_000,
    speechSegments: [
      {endSampleExclusive: 4_800_000},
      {endSampleExclusive: 27_978_829}
    ]
  };
  const result = deriveContentDrivenPresentation({timeline});
  assert.equal(result.mode, "content-driven-not-target-duration");
  assert.equal(result.playbackRate, 1.15);
  assert.equal(result.lastSpeechEndSampleExclusive, 27_978_829);
  assert.equal(result.sourceEndSampleExclusive, 28_172_029);
  assert.equal(result.trimmedTrailingSamples, 627_971);
  assert.equal(result.outputFrameCount, 15_311);
  assert.equal(result.outputAudioSamples, 24_497_600);
  assert.ok(result.outputDurationSeconds > 509 && result.outputDurationSeconds < 511);
  assert.ok(result.outputDurationSeconds < 600);
  assert.equal("targetDurationSeconds" in result, false);
});

test("画面、字幕和音频使用同一个等速变换且字幕先合成", () => {
  const graph = buildSynchronizedPacingFilterGraph({
    playbackRate: 1.15,
    overlayX: 220,
    overlayY: 870,
    audioStartSample: 16_128_000,
    audioEndSampleExclusive: 17_088_000,
    outputAudioSamples: 835_200
  });
  assert.match(graph, /\[base\]\[caption\]overlay=220:870:format=auto:shortest=1\[captioned\]/u);
  assert.match(graph, /\[captioned\]setpts=\(PTS-STARTPTS\)\/1\.15\[v\]/u);
  assert.match(graph, /atrim=start_sample=16128000:end_sample=17088000/u);
  assert.match(
    graph,
    /asetpts=N\/SR\/TB,atempo=1\.15,apad=whole_len=835200,atrim=end_sample=835200,asetpts=N\/SR\/TB\[a\]/u
  );
  assert.ok(graph.indexOf("overlay=") < graph.indexOf("[captioned]setpts="));
  assert.equal(PRESENTATION_PACING_POLICY.preservePitch, true);
  assert.equal(PRESENTATION_PACING_POLICY.synchronizeVideoAudioAndCaptions, true);
});

test("语速限制防止不可听的极端加速", () => {
  assert.equal(validatePresentationPlaybackRate(1), 1);
  assert.equal(validatePresentationPlaybackRate(1.25), 1.25);
  assert.throws(() => validatePresentationPlaybackRate(0.99), /between 1 and 1\.25/u);
  assert.throws(() => validatePresentationPlaybackRate(1.26), /between 1 and 1\.25/u);
  assert.equal(pacedFrameCount(600, 1.15), 522);
});

test("节奏规划拒绝不同步的源时间轴和无法安全表示的输出长度", () => {
  const timeline = {
    fps: 30,
    sampleRate: 48_000,
    durationInFrames: 300,
    durationInSamples: 480_000,
    speechSegments: [{endSampleExclusive: 480_000}]
  };
  for (const durationInFrames of [30, 600]) {
    assert.throws(
      () => deriveContentDrivenPresentation({timeline: {...timeline, durationInFrames}}),
      /timeline.*duration.*synchron/iu
    );
  }
  assert.throws(
    () => deriveContentDrivenPresentation({timeline, tailHoldSeconds: Number.MAX_VALUE}),
    /safe integer/iu
  );
  assert.throws(
    () => deriveContentDrivenPresentation({timeline: {...timeline, sampleRate: 48_000.5}}),
    /sampleRate.*safe integer/iu
  );
});

test("同步滤镜拒绝零长度音频输出", () => {
  assert.throws(() => buildSynchronizedPacingFilterGraph({
    overlayX: 0,
    overlayY: 0,
    audioStartSample: 0,
    audioEndSampleExclusive: 48_000,
    outputAudioSamples: 0
  }), /outputAudioSamples.*positive/iu);
});
