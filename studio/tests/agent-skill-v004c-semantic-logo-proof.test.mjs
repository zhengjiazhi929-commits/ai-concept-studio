import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";

import {
  assertLowPriorityScheduling,
  buildProofAudioDecodeArgs,
  buildProofVideoDecodeArgs,
  buildV004cProofEvidenceSamples,
  buildV004cProofFrameExtractionArgs,
  buildV004cProofInputProps,
  buildV004cProofOverlayAndAudioFfmpegArgs,
  buildV004cSubtitleBoundaryProof,
  evaluateV004cProofMediaProbe,
  parseV004cSemanticLogoProofArguments,
  partitionV004cProofEvidenceSamples,
  V004C_SEMANTIC_LOGO_PROOF_CONTRACT,
  V004C_SEMANTIC_LOGO_PROOF_PATHS,
  v004cSemanticLogoProofUsageText,
} from "../scripts/render-agent-skill-v004c-semantic-logo-proof.mjs";


const STUDIO_ROOT = resolve(import.meta.dirname, "..");


function timelineFixture() {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  const rollingGroup = {
    id: "S35:0-22",
    sourceStart: 0,
    sourceEnd: 22,
    finalText: "机器审核负责挡住结构，证据也必须完整。",
    cueCount: 2,
  };
  const displayCues = [
    {
      index: 1,
      speechSegmentIndex: 35,
      sceneId: "S11",
      text: "机器审核负责挡住结构，",
      sourceText: "机器审核负责挡住结构，",
      sourceCharacterStart: 0,
      sourceCharacterEnd: 12,
      displayContextStart: 0,
      rollingCarryApplied: false,
      rollingGroup: {...rollingGroup, cueOrdinal: 1},
      start: 337,
      end: 340,
      startFrame: 10_110,
      endFrameExclusive: 10_200,
    },
    {
      index: 2,
      speechSegmentIndex: 35,
      sceneId: "S11",
      text: rollingGroup.finalText,
      sourceText: "证据也必须完整。",
      sourceCharacterStart: 12,
      sourceCharacterEnd: 22,
      displayContextStart: 0,
      rollingCarryApplied: true,
      rollingGroup: {...rollingGroup, cueOrdinal: 2},
      start: 340,
      end: 343,
      startFrame: 10_200,
      endFrameExclusive: 10_290,
    },
  ];
  return {
    schemaVersion: contract.timelineSchemaVersion,
    fps: 30,
    sampleRate: 48_000,
    durationInSamples: 28_800_000,
    durationInFrames: 18_000,
    acceptedPrefix: {reused: false},
    semanticSegmentation: {
      contractVersion: contract.segmentationContractVersion,
      sourceTimelineSha256: contract.sourceTimelineSha256,
      markerAligned: true,
      audioChanged: false,
      acceptedPrefixCuePngsReused: false,
      visualChunkFitsEnforced: true,
      maximumCueDurationSeconds: 5.5,
      visualFit: {
        verified: true,
        publicationEligible: true,
        measurementProvenance: "real-overlay-renderer",
        testDouble: false,
        allSelectedChunksFit: true,
        maximumActualCueDurationSeconds: 3,
        renderer: {
          builderSha256:
            "29ca4ed9705ab07c6dc2a273e1d6d6dbd238a0587b20dfbf4c4cd4bf98ffb71b",
          pythonSha256:
            "71720f1fc66989ebd691e81c96111b47ae6ff3f1a478666084d1cacbf0fccbf2",
          fontSha256:
            "f887295caf2881cab9554b14c5ab4c9ee624c3895599da152ec37416b5aefae0",
          fontFamily: "Hiragino Sans GB",
          fontWeight: "W3",
          fontSize: 40,
          overlaySize: [1480, 130],
          alphaAndSafeAreaThresholdsRelaxed: false,
          snapshotReverifiedAfterMeasurement: true,
        },
      },
    },
    displayCues,
  };
}


test("proof 合同固定 S35 20秒范围、attempt-005、单并发和不可覆盖路径", () => {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  assert.deepEqual(
    {
      start: contract.globalStartFrame,
      endInclusive: contract.globalEndFrameInclusive,
      endExclusive: contract.globalEndFrameExclusive,
      frames: contract.frameCount,
      seconds: contract.durationSeconds,
    },
    {start: 10_080, endInclusive: 10_679, endExclusive: 10_680, frames: 600, seconds: 20},
  );
  assert.equal(contract.timelineAttempt, 5);
  assert.equal(contract.concurrency, 1);
  assert.equal(contract.outputFileName, "review-05m36s-05m56s.mp4");
  assert.match(
    V004C_SEMANTIC_LOGO_PROOF_PATHS.candidateDirectory,
    /v004c-semantic-subtitle-continuous-logo-proof-v001$/u,
  );
  assert.equal(contract.proofOnly, true);
  assert.equal(contract.tenMinuteAcceptance, false);
});


test("CLI 接受固定值并拒绝任何范围、并发、timeline和输出漂移", () => {
  const parsed = parseV004cSemanticLogoProofArguments([]);
  assert.equal(parsed.startFrame, 10_080);
  assert.equal(parsed.frameCount, 600);
  assert.equal(parsed.concurrency, 1);
  assert.equal(parsed.mode, "proof");
  for (const argumentsList of [
    ["--start-frame", "10081"],
    ["--frame-count", "601"],
    ["--concurrency", "2"],
    ["--mode", "full"],
    ["--timeline", "full-v004c-attempt-002.json"],
    ["--output-directory", "other-proof"],
    ["--overwrite"],
  ]) {
    assert.throws(
      () => parseV004cSemanticLogoProofArguments(argumentsList),
      /fixed contract mismatch|Unknown option/u,
    );
  }
});


test("启动合同要求 taskpolicy -b + nice -n20，并实际门禁 nice 19/20", () => {
  const usage = v004cSemanticLogoProofUsageText();
  assert.match(usage, /\/usr\/sbin\/taskpolicy -b \/usr\/bin\/nice -n 20/u);
  assert.match(usage, /--start-frame 10080 --frame-count 600 --concurrency 1/u);
  assert.equal(assertLowPriorityScheduling(19).niceRequirementPassed, true);
  assert.equal(assertLowPriorityScheduling(20).niceRequirementPassed, true);
  assert.throws(() => assertLowPriorityScheduling(0), /must run through/u);
});


test("Remotion props 使用 attempt-005 cumulative display，但关闭内烧字幕和内部音频", () => {
  const timeline = timelineFixture();
  const props = buildV004cProofInputProps(
    {id: "episode", subtitles: [{text: "stale"}], voice: {publicPath: "stale.wav"}},
    timeline,
  );
  assert.equal(props.burnInSubtitle, false);
  assert.equal(props.renderAudio, false);
  assert.deepEqual(
    props.episode.subtitles.map((cue) => cue.text),
    timeline.displayCues.map((cue) => cue.text),
  );
  assert.notEqual(props.episode.subtitles[0].text, "stale");
});


test("合成 timeline 验证固定 renderer provenance 绑定，不读取历史输入或作为正式证据", () => {
  for (const key of ["builderSha256", "pythonSha256", "fontSha256"]) {
    const timeline = timelineFixture();
    timeline.semanticSegmentation.visualFit.renderer[key] = "a".repeat(64);
    assert.throws(
      () => buildV004cProofInputProps({id: "synthetic-fixture"}, timeline),
      /realRendererMeasurement/u,
    );
  }
});


test("fake visualFit provenance 即使 verified=true 也必须 fail closed", () => {
  const fakeTimeline = timelineFixture();
  fakeTimeline.semanticSegmentation.visualFit.measurementProvenance =
    "test-double";
  fakeTimeline.semanticSegmentation.visualFit.testDouble = true;
  assert.throws(
    () => buildV004cProofInputProps({id: "episode"}, fakeTimeline),
    /realRendererMeasurement/u,
  );
});


test("单次 CRF18 外置字幕编码同时做精确 48k 样本裁切", () => {
  const args = buildV004cProofOverlayAndAudioFfmpegArgs({
    renderBase: "base.mp4",
    framePattern: "frame-%05d.png",
    voice: "voice.wav",
    output: "proof.mp4",
  });
  const command = args.join(" ");
  assert.match(command, /overlay=220:870:format=auto:shortest=1/u);
  assert.match(
    command,
    /atrim=start_sample=16128000:end_sample=17088000,asetpts=N\/SR\/TB/u,
  );
  assert.match(command, /-frames:v 600/u);
  assert.match(command, /-crf 18/u);
  assert.match(command, /-c:a aac -b:a 192k -ar 48000 -ac 1/u);
  assert.match(command, /-t 20\.000000/u);
  assert.ok(args.includes("-n"));
  assert.ok(!args.includes("-y"));
});


test("完整音视频解码合同都启用 xerror 而非抽帧代替解码", () => {
  const video = buildProofVideoDecodeArgs("proof.mp4").join(" ");
  const audio = buildProofAudioDecodeArgs("proof.mp4").join(" ");
  assert.match(video, /-xerror/u);
  assert.match(video, /-c:v rawvideo -f null -$/u);
  assert.match(audio, /-xerror/u);
  assert.match(audio, /-c:a pcm_s16le -f null -$/u);
});


test("ffprobe 门禁要求 600帧、20秒、H264 yuv420p 和 48k mono AAC", () => {
  const result = evaluateV004cProofMediaProbe({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        pix_fmt: "yuv420p",
        width: 1920,
        height: 1080,
        avg_frame_rate: "30/1",
        nb_read_frames: "600",
        start_time: "0.000000",
        duration: "20.000000",
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 1,
        start_time: "0.000000",
        duration: "20.000000",
      },
    ],
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      start_time: "0.000000",
      duration: "20.000000",
    },
  });
  assert.equal(result.passed, true);
  assert.ok(Object.values(result.checks).every(Boolean));
  assert.equal(
    evaluateV004cProofMediaProbe({streams: [], format: {}}).passed,
    false,
  );
});


test("Logo 解码证据固定120x120与完整120帧周期，rolling边界成对抽帧", () => {
  const contract = V004C_SEMANTIC_LOGO_PROOF_CONTRACT;
  assert.deepEqual(
    contract.watermark.sampleOffsetsInFrames,
    [0, 15, 30, 45, 60, 75, 90, 105, 119, 120],
  );
  assert.deepEqual(contract.watermark.cropPixels, {
    left: 1760,
    top: 40,
    width: 120,
    height: 120,
  });
  const samples = buildV004cProofEvidenceSamples(timelineFixture());
  const tags = samples.flatMap((sample) => sample.tags);
  assert.equal(
    tags.filter((tag) => tag.startsWith("watermark-motion-sample:")).length,
    10,
  );
  assert.ok(tags.includes("rolling-boundary:2:before"));
  assert.ok(tags.includes("rolling-boundary:2:after"));
  const batches = partitionV004cProofEvidenceSamples(samples);
  assert.ok(batches.every((batch) => batch.length <= 24));
  const args = buildV004cProofFrameExtractionArgs({
    videoPath: "proof.mp4",
    samples: batches[0],
    outputPaths: batches[0].map((sample) => sample.filename),
  });
  assert.match(args.join(" "), /trim=start_frame=/u);
  assert.ok(args.includes("-n"));
});


test("字幕 proof 同时门禁语义、5.5秒、无框、安全区和 rolling 固定锚点", () => {
  const timeline = timelineFixture();
  const samples = buildV004cProofEvidenceSamples(timeline);
  const rollingGroup = timeline.displayCues[0].rollingGroup;
  const overlayManifest = {
    timeline: {
      attempt: 5,
      sha256: V004C_SEMANTIC_LOGO_PROOF_CONTRACT.timelineSha256,
      schemaVersion: V004C_SEMANTIC_LOGO_PROOF_CONTRACT.timelineSchemaVersion,
      visualFitVerified: true,
      publicationEligible: true,
      measurementProvenance: "real-overlay-renderer",
      testDouble: false,
    },
    style: {targetX: 220, targetY: 870},
    reuse: {
      historicalCuePngsReused: false,
      allSelectedCuesFreshlyRendered: true,
    },
    displayCues: timeline.displayCues.map((cue) => ({
      index: cue.index,
      lines: [cue.text],
      imageSha256: String(cue.index).repeat(64),
      alphaBoundingBox: [200, 40, 800, 90],
      globalAlphaBoundingBox: [420, 910, 1020, 960],
      containerLikeAlpha: false,
      borderAlphaMax: 0,
      insideCaptionSafeArea: true,
    })),
    rollingLayoutGroups: [
      {
        id: rollingGroup.id,
        cueIndexes: [1, 2],
        finalText: rollingGroup.finalText,
        fixedFirstLineAnchorByCue: [
          {cueIndex: 1, anchor: [200, 40]},
          {cueIndex: 2, anchor: [200, 40]},
        ],
        prefixAnchorStable: true,
      },
    ],
    allTimelineRollingLayoutAudits: [
      {
        id: "S09:0-39",
        passed: true,
        checks: {
          fixedFirstLineAnchorStable: true,
          leadingGlyphAlphaLeftStable: true,
          finalLineLayoutStable: true,
          prefixGrowsOnlyRightward: true,
        },
      },
      {
        id: "S35:65-96",
        passed: true,
        checks: {
          fixedFirstLineAnchorStable: true,
          leadingGlyphAlphaLeftStable: true,
          finalLineLayoutStable: true,
          prefixGrowsOnlyRightward: true,
        },
      },
    ],
  };
  const proof = buildV004cSubtitleBoundaryProof({timeline, overlayManifest, samples});
  assert.equal(proof.status, "pass");
  assert.equal(proof.checks.rollingPrefixAnchorsStable, true);
  assert.equal(proof.checks.rollingBoundaryFramesPaired, true);
  assert.equal(proof.checks.allTimelineRollingGroupsAudited, true);
  assert.equal(proof.checks.noSubtitleContainer, true);
});


test("实现源码固定 Remotion frameRange、staging no-replace 与 proof-only manifest", async () => {
  const source = await readFile(
    resolve(STUDIO_ROOT, "scripts/render-agent-skill-v004c-semantic-logo-proof.mjs"),
    "utf8",
  );
  assert.match(
    source,
    /frameRange:\s*\[contract\.globalStartFrame, contract\.globalEndFrameInclusive\]/u,
  );
  assert.match(source, /burnInSubtitle:\s*false/u);
  assert.match(source, /renderAudio:\s*false/u);
  assert.match(source, /atomicPublishDirectoryNoReplace/u);
  assert.match(source, /authorizesGitCommitPushPrOrMerge:\s*false/u);
  assert.match(source, /temporary Tingting/u);
  assert.doesNotMatch(source, /overwrite:\s*true/u);
  assert.doesNotMatch(source, /review-10m\.mp4/u);
});
