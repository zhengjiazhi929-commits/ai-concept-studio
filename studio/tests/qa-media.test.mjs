import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import test from "node:test";

import { RenderInternals } from "@remotion/renderer";

import {
  inspectRenderedMedia,
  publishQaReport,
  renderedMediaTechnicalChecks
} from "../src/server/qa.mjs";

const executeFile = promisify(execFile);

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodeRgbPng(width, height, pixelAt) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue] = pixelAt(x, y);
      row[1 + x * 3] = red;
      row[2 + x * 3] = green;
      row[3 + x * 3] = blue;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function encodeGrayPng(width, height, value) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      row[x + 1] = typeof value === "function" ? value(x, y) : value;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function monoPcmWav(samples) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function sparseMonoPcmWav(sampleCount, audibleSampleIndex) {
  const samples = new Int16Array(sampleCount);
  samples[audibleSampleIndex] = 16_384;
  return monoPcmWav(samples);
}

function mediaExecutable(type) {
  return RenderInternals.getExecutablePath({
    type,
    indent: false,
    logLevel: "error",
    binariesDirectory: null
  });
}

async function runMediaTool(type, args) {
  const executable = mediaExecutable(type);
  return executeFile(executable, args, {
    cwd: dirname(executable),
    maxBuffer: 16 * 1024 * 1024,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
      ...(process.platform === "darwin"
        ? { DYLD_LIBRARY_PATH: dirname(executable) }
        : {})
    }
  });
}

async function createSyntheticVideo(directory, { frozen, silent }) {
  const frameDirectory = resolve(directory, `${frozen ? "frozen" : "moving"}-frames`);
  await mkdir(frameDirectory);
  const width = 96;
  const height = 54;
  const frameCount = 20;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const png = encodeRgbPng(width, height, (x, y) => frozen
      ? [42, 126, 92]
      : [
          (x * 3 + frame * 19) % 256,
          (y * 5 + frame * 31) % 256,
          ((x + y) * 2 + frame * 47) % 256
        ]);
    await writeFile(resolve(frameDirectory, `frame-${String(frame).padStart(3, "0")}.png`), png);
  }
  const outputPath = resolve(directory, `${frozen ? "frozen" : "moving"}-${silent ? "silent" : "audible"}.mp4`);
  const audioSource = silent
    ? "anullsrc=channel_layout=mono:sample_rate=48000"
    : "sine=frequency=440:sample_rate=48000:duration=2";
  await runMediaTool("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    "-framerate", "10",
    "-i", resolve(frameDirectory, "frame-%03d.png"),
    "-f", "lavfi",
    "-i", audioSource,
    "-t", "2",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath
  ]);
  return outputPath;
}

test("rendered-media QA fully decodes a synthetic moving MP4 with audible aligned audio", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "acs-rendered-media-qa-"));
  try {
    const videoPath = await createSyntheticVideo(directory, { frozen: false, silent: false });
    const evidence = await inspectRenderedMedia(videoPath);
    assert.equal(evidence.machineOnly, true);
    assert.equal(evidence.manualPlaybackRequired, true);
    assert.equal(evidence.fullDecode.passed, true, JSON.stringify(evidence.fullDecode));
    assert.equal(evidence.audio.present, true);
    assert.equal(evidence.audio.channelsValid, true);
    assert.equal(evidence.audio.notSilent, true, JSON.stringify(evidence.audio));
    assert.equal(evidence.audio.avDurationAligned, true);
    assert.equal(
      evidence.representativeFrames.allSamplesNonBlack,
      true,
      JSON.stringify(evidence.representativeFrames)
    );
    assert.equal(evidence.representativeFrames.hasVisualChange, true);
    assert.ok(renderedMediaTechnicalChecks(evidence).every((item) => item.passed));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rendered-media QA rejects a synthetic frozen MP4 with a silent audio track", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "acs-rendered-media-qa-"));
  try {
    const videoPath = await createSyntheticVideo(directory, { frozen: true, silent: true });
    const evidence = await inspectRenderedMedia(videoPath);
    assert.equal(evidence.fullDecode.passed, true, JSON.stringify(evidence.fullDecode));
    assert.equal(evidence.audio.present, true);
    assert.equal(evidence.audio.notSilent, false);
    assert.equal(
      evidence.representativeFrames.allSamplesNonBlack,
      true,
      JSON.stringify(evidence.representativeFrames)
    );
    assert.equal(evidence.representativeFrames.hasVisualChange, false);
    const checks = new Map(renderedMediaTechnicalChecks(evidence).map((item) => [item.id, item]));
    assert.equal(checks.get("audio-not-silent").passed, false);
    assert.equal(checks.get("representative-frames-change").passed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("media command execution is injectable and the full-decode contract is fail closed", async () => {
  const calls = [];
  const frames = Buffer.concat(Array.from({ length: 7 }, (_, frame) => encodeGrayPng(
    64,
    36,
    20 + frame * 20
  )));
  const evidence = await inspectRenderedMedia("/fixture/video.mp4", {
    extractRepresentativeFrames: async () => frames,
    runMediaTool: async (type, args) => {
      calls.push({ type, args });
      if (type === "ffprobe") {
        return {
          stdout: JSON.stringify({
            format: { duration: "2.000000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
            streams: [
              {
                codec_type: "video",
                avg_frame_rate: "10/1",
                duration: "2.000000",
                nb_read_frames: "20"
              },
              { codec_type: "audio", duration: "2.000000", channels: 1 }
            ]
          }),
          stderr: ""
        };
      }
      if (args.includes("wav") && args.includes("pipe:1")) {
        return { stdout: monoPcmWav([8192, 0, -8192, 0]), stderr: "" };
      }
      throw Object.assign(new Error("synthetic decode failure"), { code: "EDECODE" });
    }
  });
  assert.equal(evidence.fullDecode.passed, false);
  assert.equal(evidence.audio.notSilent, true);
  assert.equal(evidence.representativeFrames.passed, true);
  const fullDecodeCall = calls.find(({ args }) => args.includes("-xerror"));
  assert.ok(fullDecodeCall);
  assert.deepEqual(fullDecodeCall.args.slice(-2), ["null", "-"]);
});

test("representative evidence includes endpoints and rejects a black frame with one bright pixel", async () => {
  const blackWithWatermark = encodeGrayPng(64, 36, (x, y) => x === 63 && y === 0 ? 255 : 0);
  const visibleFrames = Array.from({ length: 6 }, (_, index) => encodeGrayPng(
    64,
    36,
    40 + index * 20
  ));
  const finalFrame = encodeGrayPng(64, 36, 180);
  const evidence = await inspectRenderedMedia("/fixture/endpoints.mp4", {
    extractRepresentativeFrames: async ({ frameNumbers }) => {
      assert.deepEqual(frameNumbers, [0, 1, 2, 4, 5, 6, 7]);
      return Buffer.concat([blackWithWatermark, ...visibleFrames.slice(0, 5), finalFrame]);
    },
    runMediaTool: async (type, args) => {
      if (type === "ffprobe") {
        return {
          stdout: JSON.stringify({
            format: { duration: "0.800000", format_name: "mp4" },
            streams: [
              {
                codec_type: "video",
                avg_frame_rate: "10/1",
                duration: "0.800000",
                nb_read_frames: "8"
              },
              { codec_type: "audio", channels: 1 }
            ]
          }),
          stderr: ""
        };
      }
      if (args.includes("wav")) return { stdout: monoPcmWav([4096, -4096]), stderr: "" };
      return { stdout: "", stderr: "" };
    }
  });
  assert.equal(evidence.representativeFrames.frameNumbers[0], 0);
  assert.equal(evidence.representativeFrames.frameNumbers.at(-1), 7);
  assert.equal(evidence.representativeFrames.samples[0].maximumLuma, 255);
  assert.ok(evidence.representativeFrames.samples[0].blackPixelRatio > 0.99);
  assert.equal(evidence.representativeFrames.allSamplesNonBlack, false);
  assert.equal(evidence.audio.durationSource, "decoded_pcm_samples");
  assert.equal(evidence.audio.avDurationAligned, false);
});

test("a long mostly-silent track with one loud transient fails audio coverage", async () => {
  const frames = Buffer.concat(Array.from({ length: 7 }, (_, frame) => encodeGrayPng(
    64,
    36,
    30 + frame * 20
  )));
  const evidence = await inspectRenderedMedia("/fixture/mostly-silent.mp4", {
    extractRepresentativeFrames: async () => frames,
    runMediaTool: async (type, args) => {
      if (type === "ffprobe") {
        return {
          stdout: JSON.stringify({
            format: { duration: "100.000000", format_name: "mp4" },
            streams: [
              {
                codec_type: "video",
                avg_frame_rate: "1/1",
                duration: "100.000000",
                nb_read_frames: "100"
              },
              { codec_type: "audio", channels: 1 }
            ]
          }),
          stderr: ""
        };
      }
      if (args.includes("wav")) {
        return { stdout: sparseMonoPcmWav(8000 * 100, 4000), stderr: "" };
      }
      return { stdout: "", stderr: "" };
    }
  });
  assert.equal(evidence.audio.durationSeconds, 100);
  assert.equal(evidence.audio.avDurationAligned, true);
  assert.equal(evidence.audio.volumeInspection.peakVolumeDb > -50, true);
  assert.equal(evidence.audio.volumeInspection.audibleWindowFraction, 0.01);
  assert.equal(evidence.audio.volumeInspection.maximumConsecutiveSilentSeconds, 99);
  assert.equal(evidence.audio.notSilent, false);
});

test("concurrent QA reports allocate immutable revisions without overwriting", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "acs-qa-reports-"));
  try {
    const reports = Array.from({ length: 20 }, (_, id) => ({ id }));
    const paths = await Promise.all(reports.map((report) => publishQaReport({
      outputDirectory: directory,
      renderVersion: "007",
      report
    })));
    assert.equal(new Set(paths).size, reports.length);
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
    assert.equal(files.length, reports.length);
    const ids = await Promise.all(files.map(async (file) => JSON.parse(
      await readFile(resolve(directory, file), "utf8")
    ).id));
    assert.deepEqual(ids.sort((left, right) => left - right), reports.map(({ id }) => id));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
