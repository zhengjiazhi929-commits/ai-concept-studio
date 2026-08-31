import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import test from "node:test";

import { RenderInternals } from "@remotion/renderer";

import {
  buildExactFrameExtractionArgs,
  captureQaSourceIdentity,
  decodedVideoFrameCount,
  evaluateWideV004MediaProbe,
  probeMedia,
  PYTHON_REQUIREMENTS_LOCK_PATH,
  PYTHON_RUNTIME_LOCK_PATH,
  qaArtifactPaths,
  resolveLockedPythonRuntime,
  validateWideV004CandidateManifest,
  validatePythonRuntimeIdentity,
  WIDE_V004_QA_CONTRACT
} from "../scripts/qa-agent-skill-long-review-wide-v004.mjs";

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

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function solidPng(width, height, [red, green, blue]) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
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
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function executable(type) {
  return RenderInternals.getExecutablePath({
    type,
    indent: false,
    logLevel: "error",
    binariesDirectory: null
  });
}

async function runTool(type, args) {
  const file = executable(type);
  return executeFile(file, args, {
    cwd: dirname(file),
    maxBuffer: 8 * 1024 * 1024,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
      ...(process.platform === "darwin" ? { DYLD_LIBRARY_PATH: dirname(file) } : {})
    }
  });
}

test("long-review exact extraction uses one sequential split/trim decode and no timestamp seek", () => {
  const samples = [0, 2, 5].map((frame) => ({
    frame,
    filename: `frames/frame-${frame}.png`
  }));
  const args = buildExactFrameExtractionArgs({
    samples,
    videoPath: "/fixture/input.mp4",
    qaDirectory: "/fixture/qa",
    periodic: false
  });
  assert.equal(WIDE_V004_QA_CONTRACT.frameExtractionStrategy,
    "sequential-decode-split-trim-by-frame-index");
  assert.equal(args.filter((argument) => argument === "-i").length, 1);
  assert.equal(args.includes("-ss"), false);
  const graph = args[args.indexOf("-filter_complex") + 1];
  assert.match(graph, /\[0:v:0\]split=3/u);
  assert.match(graph, /trim=start_frame=0:end_frame=1/u);
  assert.match(graph, /trim=start_frame=2:end_frame=3/u);
  assert.match(graph, /trim=start_frame=5:end_frame=6/u);
});

test("exact extraction command selects distinct indexed frames from a six-frame fixture", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "acs-long-qa-exact-frame-"));
  try {
    const colors = [
      [220, 30, 30],
      [30, 220, 30],
      [30, 30, 220],
      [220, 220, 30],
      [220, 30, 220],
      [30, 220, 220]
    ];
    for (const [frame, color] of colors.entries()) {
      await writeFile(
        resolve(directory, `source-${String(frame).padStart(3, "0")}.png`),
        solidPng(96, 54, color)
      );
    }
    const videoPath = resolve(directory, "fixture.mp4");
    await runTool("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel", "error",
      "-framerate", "10",
      "-i", resolve(directory, "source-%03d.png"),
      "-frames:v", "6",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      videoPath
    ]);

    const samples = [0, 2, 5].map((frame) => ({ frame, filename: `exact-${frame}.png` }));
    await runTool("ffmpeg", buildExactFrameExtractionArgs({
      samples,
      videoPath,
      qaDirectory: directory,
      periodic: false
    }));
    const outputs = await Promise.all(samples.map(({ filename }) => readFile(resolve(directory, filename))));
    assert.ok(outputs.every((output) => output.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )));
    assert.equal(new Set(outputs.map((output) => createHash("sha256").update(output).digest("hex"))).size, 3);
    for (const { frame, filename } of samples) {
      const reference = resolve(directory, `reference-${frame}.png`);
      await runTool("ffmpeg", [
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-i", videoPath,
        "-vf", `trim=start_frame=${frame}:end_frame=${frame + 1}`,
        "-frames:v", "1",
        "-c:v", "png",
        reference
      ]);
      assert.deepEqual(
        await readFile(resolve(directory, filename)),
        await readFile(reference),
        `split/trim 输出必须精确对应目标 frame ${frame}`
      );
    }

    const { stdout } = await runTool("ffprobe", [
      "-v", "error",
      "-count_frames",
      "-select_streams", "v:0",
      "-show_entries", "stream=nb_frames,nb_read_frames,nb_read_packets",
      "-of", "json",
      videoPath
    ]);
    const stream = JSON.parse(stdout).streams[0];
    assert.equal(decodedVideoFrameCount(stream), 6);
    const ffprobe = executable("ffprobe");
    const metadata = await probeMedia({
      videoPath,
      manifestPath: null,
      ffprobe,
      env: {
        ...process.env,
        ...(process.platform === "darwin" ? { DYLD_LIBRARY_PATH: dirname(ffprobe) } : {})
      }
    });
    assert.equal(metadata.normalized.videoFrameCount, 6);
    assert.equal(metadata.normalized.width, 96);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("decoded frame count trusts nb_read_frames, not declared frames or packet count", () => {
  assert.equal(decodedVideoFrameCount({
    nb_frames: "18000",
    nb_read_frames: "17999",
    nb_read_packets: "18000"
  }), 17999);
  assert.ok(Number.isNaN(decodedVideoFrameCount({ nb_frames: "18000" })));
});

test("formal v004 media contract rejects wrong audio codec or sample rate", () => {
  const probe = {
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "600.000" },
    streams: [
      {
        codec_type: "video", codec_name: "h264", width: 1920, height: 1080,
        pix_fmt: "yuv420p", avg_frame_rate: "30/1", nb_read_frames: "18000"
      },
      { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 }
    ]
  };
  assert.ok(Object.values(evaluateWideV004MediaProbe(probe).checks).every(Boolean));
  assert.equal(evaluateWideV004MediaProbe({
    ...probe,
    streams: [probe.streams[0], { ...probe.streams[1], codec_name: "mp3" }]
  }).checks.aacAudio, false);
  assert.equal(evaluateWideV004MediaProbe({
    ...probe,
    streams: [probe.streams[0], { ...probe.streams[1], sample_rate: "44100" }]
  }).checks.audioSampleRate48k, false);
});

test("formal v004 manifest must bind the exact published MP4 bytes and SHA-256", () => {
  const videoPath = resolve(
    process.cwd(),
    "../outputs/studio/agent-skill-20260806/review-candidates/" +
      "full-video-current-visual-upgrade-v004/review-10m.mp4"
  );
  const integrity = { bytes: 1234, sha256: "a".repeat(64) };
  const manifest = {
    schemaVersion: "agent-skill-long-review-wide-v004-chunked-final-v1",
    contract: {
      schemaVersion: "agent-skill-long-review-wide-v004-chunked-v1",
      candidateVersion: 4,
      episodeId: "agent-skill-20260806",
      compositionId: "AgentSkillLongReview",
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 18000
    },
    finalMedia: {
      schemaVersion: "agent-skill-long-review-wide-v004-final-media-v1",
      file: { ...integrity }
    },
    publication: {
      outputPath: "outputs/studio/agent-skill-20260806/review-candidates/" +
        "full-video-current-visual-upgrade-v004/review-10m.mp4"
    }
  };
  assert.equal(validateWideV004CandidateManifest(
    manifest, integrity, videoPath
  ).passed, true);
  assert.throws(() => validateWideV004CandidateManifest(
    manifest, { ...integrity, sha256: "b".repeat(64) }, videoPath
  ), /finalMediaSha256/u);
  assert.throws(() => validateWideV004CandidateManifest(
    { ...manifest, contract: { ...manifest.contract, candidateVersion: 3 } },
    integrity,
    videoPath
  ), /candidateVersion/u);
});

test("Python analyzer runtime identity is pinned by a repository lock", async () => {
  const lock = JSON.parse(await readFile(PYTHON_RUNTIME_LOCK_PATH, "utf8"));
  const requirements = await readFile(PYTHON_REQUIREMENTS_LOCK_PATH, "utf8");
  assert.equal(lock.requirementsLock, "qa-agent-skill-long-review-wide-v004-requirements.lock.txt");
  assert.match(requirements, /numpy==2\.3\.5/u);
  assert.match(requirements, /Pillow==12\.3\.0/u);
  assert.equal((requirements.match(/--hash=sha256:/gu) ?? []).length, 5);
  assert.equal(validatePythonRuntimeIdentity({
    pythonVersion: lock.pythonVersion,
    implementation: lock.implementation,
    packages: { ...lock.packages }
  }, lock), true);
  assert.throws(() => validatePythonRuntimeIdentity({
    pythonVersion: lock.pythonVersion,
    implementation: lock.implementation,
    packages: { ...lock.packages, Pillow: "0.0.0" }
  }, lock), /Pillow expected=.* actual=0\.0\.0/u);
  const runtime = await resolveLockedPythonRuntime();
  assert.ok(["QA_PYTHON", "codex-bundled-runtime"].includes(runtime.source));
  assert.equal(runtime.identity.pythonVersion, lock.pythonVersion);
  assert.equal(runtime.identity.implementation, lock.implementation);
  assert.deepEqual(runtime.identity.packages, lock.packages);
  assert.match(runtime.lockFile.sha256, /^[0-9a-f]{64}$/u);
  assert.match(runtime.requirementsLockFile.sha256, /^[0-9a-f]{64}$/u);
});

test("formal QA provenance binds the JavaScript media inspector implementation", async () => {
  const identity = await captureQaSourceIdentity();
  assert.match(identity.gitHead, /^[0-9a-f]{40}$/u);
  assert.match(identity.worktreeSha256, /^[0-9a-f]{64}$/u);
  assert.ok(identity.sourceFiles.some(({ path }) => path === "studio/src/server/qa.mjs"));
  assert.ok(identity.sourceFiles.some(({ path }) =>
    path === "studio/scripts/qa-agent-skill-long-review-wide-v004.py"
  ));
});

test("QA artifacts use per-run sibling staging and expose no unvalidated publication primitive", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "acs-long-qa-publish-"));
  try {
    const first = qaArtifactPaths({
      candidateDirectory: directory,
      qaDirectoryName: "qa",
      runId: "first"
    });
    const second = qaArtifactPaths({
      candidateDirectory: directory,
      qaDirectoryName: "qa",
      runId: "second"
    });
    assert.notEqual(first.temporaryQaDirectory, second.temporaryQaDirectory);
    assert.equal(first.finalQaDirectory, second.finalQaDirectory);
    assert.equal(first.publicationLockDirectory, second.publicationLockDirectory);
    assert.equal(dirname(first.temporaryQaDirectory), dirname(directory));
    assert.equal(first.finalQaDirectory, resolve(directory, "qa"));
    const productionModule = await import(
      "../scripts/qa-agent-skill-long-review-wide-v004.mjs"
    );
    assert.equal(Object.hasOwn(productionModule, "publishQaArtifactDirectory"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
