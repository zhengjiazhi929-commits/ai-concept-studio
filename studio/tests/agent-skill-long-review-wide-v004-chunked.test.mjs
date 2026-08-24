import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";

import {
  CHUNKED_V004_CONTRACT,
  buildChunkRanges,
  buildConcatFfmpegArgs,
  buildMuxFfmpegArgs,
  evaluateChunkProbe,
  evaluateConcatenatedProbe,
  evaluateFinalProbe,
  isChunkResumeEligible,
  parseCliArguments,
  publishValidatedOutputAtomically,
  sha256Text,
  stableStringify,
  usageText,
} from "../scripts/render-agent-skill-long-review-wide-v004-chunked.mjs";

function validProbe({frames = 1_800, seconds = 60, withAudio = false} = {}) {
  const streams = [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      codec_long_name: "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
      profile: "High",
      codec_tag_string: "avc1",
      codec_tag: "0x31637661",
      width: 1920,
      height: 1080,
      coded_width: 1920,
      coded_height: 1080,
      has_b_frames: 2,
      pix_fmt: "yuv420p",
      level: 40,
      color_range: "tv",
      color_space: "bt709",
      color_transfer: "bt709",
      color_primaries: "bt709",
      chroma_location: "left",
      field_order: "progressive",
      refs: 1,
      is_avc: "true",
      nal_length_size: "4",
      bits_per_raw_sample: "8",
      r_frame_rate: "30/1",
      avg_frame_rate: "30/1",
      time_base: "1/15360",
      duration: String(seconds),
      nb_frames: String(frames),
      nb_read_frames: String(frames),
    },
  ];
  if (withAudio) {
    streams.push({
      index: 1,
      codec_type: "audio",
      codec_name: "aac",
      sample_rate: "48000",
    });
  }
  return {
    format: {format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: String(seconds)},
    streams,
  };
}

test("default ranges are 10 absolute inclusive 1800-frame chunks", () => {
  const ranges = buildChunkRanges();
  assert.equal(ranges.length, 10);
  assert.deepEqual(ranges[0], {
    index: 0,
    start: 0,
    end: 1_799,
    frameCount: 1_800,
    durationSeconds: 60,
  });
  assert.deepEqual(ranges.at(-1), {
    index: 9,
    start: 16_200,
    end: 17_999,
    frameCount: 1_800,
    durationSeconds: 60,
  });
  for (let index = 1; index < ranges.length; index += 1) {
    assert.equal(ranges[index - 1].end + 1, ranges[index].start);
  }
});

test("900 frame CLI mode creates 20 exact 30-second chunks and records pause", () => {
  const options = parseCliArguments([
    "--chunk-frames",
    "900",
    "--inter-chunk-pause-ms=2500",
  ]);
  assert.equal(options.chunkFrames, 900);
  assert.equal(options.interChunkPauseMs, 2_500);
  const ranges = buildChunkRanges({chunkFrames: options.chunkFrames});
  assert.equal(ranges.length, 20);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[0].end, 899);
  assert.equal(ranges[0].durationSeconds, 30);
  assert.equal(ranges.at(-1).start, 17_100);
  assert.equal(ranges.at(-1).end, 17_999);
  assert.throws(() => buildChunkRanges({chunkFrames: 1_001}), /must divide/u);
  assert.match(usageText(), /taskpolicy -b nice -n 20/u);
});

test("chunk validation requires exact frames, duration, codec, dimensions and no audio", () => {
  const range = buildChunkRanges()[0];
  const valid = evaluateChunkProbe(validProbe(), range);
  assert.equal(valid.valid, true);
  assert.equal(valid.media.frameCount, 1_800);
  assert.equal(valid.media.audioStreamCount, 0);

  const audio = evaluateChunkProbe(validProbe({withAudio: true}), range);
  assert.equal(audio.valid, false);
  assert.equal(audio.checks.noAudio, false);

  const short = evaluateChunkProbe(validProbe({frames: 1_799}), range);
  assert.equal(short.valid, false);
  assert.equal(short.checks.exactFrames, false);

  const differentCodec = structuredClone(validProbe());
  differentCodec.streams[0].profile = "Main";
  const mismatch = evaluateChunkProbe(
    differentCodec,
    range,
    valid.media.codecMetadata,
  );
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.checks.sameCodecMetadata, false);
});

test("concat and final predicates require exactly 18000 frames/600s and final AAC 48k", () => {
  const videoOnly = validProbe({frames: 18_000, seconds: 600});
  const concatenated = evaluateConcatenatedProbe(videoOnly);
  assert.equal(concatenated.valid, true);
  const final = evaluateFinalProbe(
    validProbe({frames: 18_000, seconds: 600, withAudio: true}),
    concatenated.media.codecMetadata,
  );
  assert.equal(final.valid, true);
  const wrongRate = validProbe({frames: 18_000, seconds: 600, withAudio: true});
  wrongRate.streams[1].sample_rate = "44100";
  const invalidFinal = evaluateFinalProbe(
    wrongRate,
    concatenated.media.codecMetadata,
  );
  assert.equal(invalidFinal.valid, false);
  assert.equal(invalidFinal.checks.audio48k, false);
});

test("resume skips only when file, probe metadata, run hash, range, chunk size and pause all match", () => {
  const range = buildChunkRanges()[0];
  const validation = evaluateChunkProbe(validProbe(), range);
  const integrity = {bytes: 123_456, sha256: "a".repeat(64)};
  const record = {
    schemaVersion: "agent-skill-long-review-wide-v004-chunk-v1",
    runFingerprint: "b".repeat(64),
    chunkFrames: 1_800,
    interChunkPauseMs: 2_500,
    range,
    file: integrity,
    probeSha256: validation.probeSha256,
    codecMetadata: validation.media.codecMetadata,
  };
  const arguments_ = {
    record,
    runFingerprint: record.runFingerprint,
    range,
    integrity,
    validation,
    expectedCodecMetadata: validation.media.codecMetadata,
    chunkFrames: 1_800,
    interChunkPauseMs: 2_500,
  };
  assert.equal(isChunkResumeEligible(arguments_), true);
  assert.equal(
    isChunkResumeEligible({...arguments_, integrity: {...integrity, bytes: 1}}),
    false,
  );
  assert.equal(
    isChunkResumeEligible({...arguments_, runFingerprint: "c".repeat(64)}),
    false,
  );
  assert.equal(
    isChunkResumeEligible({...arguments_, chunkFrames: 900}),
    false,
  );
  assert.equal(
    isChunkResumeEligible({...arguments_, interChunkPauseMs: 0}),
    false,
  );
  assert.equal(
    isChunkResumeEligible({
      ...arguments_,
      record: {...record, probeSha256: "d".repeat(64)},
    }),
    false,
  );
});

test("ffmpeg contracts use concat stream copy and exact 48k/28800000-sample AAC mux", () => {
  const concat = buildConcatFfmpegArgs("list.txt", "video.part.mp4").join(" ");
  assert.match(concat, /-f concat/u);
  assert.match(concat, /-c:v copy/u);
  assert.match(concat, /-an/u);
  const mux = buildMuxFfmpegArgs(
    "video.mp4",
    "voice.wav",
    "review.part.mp4",
  ).join(" ");
  assert.match(
    mux,
    /aresample=48000,apad=whole_len=28800000,atrim=end_sample=28800000,asetpts=N\/SR\/TB/u,
  );
  assert.match(mux, /-c:v copy/u);
  assert.match(mux, /-c:a aac/u);
  assert.match(mux, /-b:a 192k/u);
  assert.match(mux, /-movflags \+faststart/u);
  assert.match(mux, /-t 600/u);
});

test("output publication appears only after an integrity-checked atomic directory rename", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004-chunked-publish-"));
  try {
    const staging = resolve(root, "staging");
    const finalDirectory = resolve(root, "formal-v004");
    const stagedVideo = resolve(staging, "validated.mp4");
    await mkdir(staging);
    const bytes = Buffer.from("validated-media-fixture");
    await writeFile(stagedVideo, bytes);
    const expectedIntegrity = {
      bytes: bytes.length,
      sha256: sha256Text(bytes),
    };
    await assert.rejects(
      publishValidatedOutputAtomically({
        stagedVideoPath: stagedVideo,
        finalDirectory,
        stagingDirectory: staging,
        manifest: {runFingerprint: "a".repeat(64)},
        expectedIntegrity: {...expectedIntegrity, sha256: "0".repeat(64)},
      }),
      /integrity changed/u,
    );
    await assert.rejects(readFile(resolve(finalDirectory, "review-10m.mp4")), {
      code: "ENOENT",
    });

    const published = await publishValidatedOutputAtomically({
      stagedVideoPath: stagedVideo,
      finalDirectory,
      stagingDirectory: staging,
      manifest: {runFingerprint: "a".repeat(64)},
      expectedIntegrity,
    });
    assert.equal(published.outputPath, resolve(finalDirectory, "review-10m.mp4"));
    assert.deepEqual(await readFile(published.outputPath), bytes);
    assert.deepEqual(
      JSON.parse(await readFile(resolve(finalDirectory, "review-manifest.json"), "utf8")),
      {runFingerprint: "a".repeat(64)},
    );

    await assert.rejects(
      publishValidatedOutputAtomically({
        stagedVideoPath: stagedVideo,
        finalDirectory,
        stagingDirectory: staging,
        manifest: {},
        expectedIntegrity,
      }),
      /already exists/u,
    );
    assert.deepEqual(await readFile(published.outputPath), bytes);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("contract remains fixed at 1920x1080, 30fps, 18000 frames and low-memory render settings", () => {
  assert.deepEqual(
    {
      width: CHUNKED_V004_CONTRACT.width,
      height: CHUNKED_V004_CONTRACT.height,
      fps: CHUNKED_V004_CONTRACT.fps,
      durationInFrames: CHUNKED_V004_CONTRACT.durationInFrames,
      codec: CHUNKED_V004_CONTRACT.codec,
      pixelFormat: CHUNKED_V004_CONTRACT.pixelFormat,
      concurrency: CHUNKED_V004_CONTRACT.concurrency,
      muted: CHUNKED_V004_CONTRACT.muted,
      enforceAudioTrack: CHUNKED_V004_CONTRACT.enforceAudioTrack,
    },
    {
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 18_000,
      codec: "h264",
      pixelFormat: "yuv420p",
      concurrency: 1,
      muted: true,
      enforceAudioTrack: false,
    },
  );
  assert.equal(
    sha256Text(stableStringify({chunkFrames: 900, interChunkPauseMs: 2500})),
    sha256Text(stableStringify({interChunkPauseMs: 2500, chunkFrames: 900})),
  );
});
