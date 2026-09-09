import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { promisify } from "node:util";

import {
  isV004bFormalQaJob,
  V004B_FORMAL_QA_PROFILE,
  validateV004bFormalCandidateManifest,
  validateV004bFormalPublicationDurableReceipt,
  validateV004bFormalQaSourceBinding
} from "../src/server/production/long-review-v004b-qa.mjs";
import {
  evaluateV004bFormalMediaProbe,
  requiredLongReviewContactSheets,
  resolveLockedPythonRuntime
} from "../scripts/qa-agent-skill-long-review-wide-v004.mjs";
import { validateLongReviewRenderJob } from "../src/server/production/long-render-job.mjs";

const execFileAsync = promisify(execFile);
const STUDIO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
const CONFIG_RELATIVE =
  "studio/config/render-jobs/" +
  "full-video-current-visual-upgrade-v014-natural-technical-v004b-no-box-formal-v001.json";
const CONFIG_PATH = resolve(WORKSPACE_ROOT, CONFIG_RELATIVE);
const ANALYZER_PATH = resolve(
  STUDIO_ROOT,
  "scripts/qa-agent-skill-long-review-wide-v004.py"
);
const WATERMARK_FRAME_DIRECTORY = resolve(
  STUDIO_ROOT,
  "public/assets/visual-system-v1/ai-watermark-v013/frames"
);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

async function formalJob() {
  return validateLongReviewRenderJob(
    JSON.parse(await readFile(CONFIG_PATH, "utf8")),
    { workspaceRoot: WORKSPACE_ROOT }
  );
}

function formalManifest(
  job,
  videoIntegrity,
  rebinderSha256 = V004B_FORMAL_QA_PROFILE.rebindRunnerSha256
) {
  const runFingerprint = "a".repeat(64);
  const finalVideoPath = resolve(job.resolvedPaths.finalDirectory, "review-10m.mp4");
  const renderBaseDirectory = resolve(
    job.resolvedPaths.finalDirectory,
    "..",
    V004B_FORMAL_QA_PROFILE.renderBaseDirectoryName
  );
  const sourceCandidateDirectory = resolve(
    job.resolvedPaths.finalDirectory,
    "..",
    V004B_FORMAL_QA_PROFILE.sourceCandidateDirectoryName
  );
  return {
    schemaVersion: V004B_FORMAL_QA_PROFILE.manifestSchemaVersion,
    status: "machine-validated-awaiting-visual-qa",
    reviewStatus: "formal-candidate-awaiting-continuous-1x-visual-qa",
    warning: "v004-full 旁白是临时声音，不是最终真人录音。",
    runFingerprint,
    renderJob: {
      jobId: job.jobId,
      candidateVersion: 1
    },
    contract: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 600,
      durationInFrames: 18_000,
      chunkFrames: 900,
      chunkCount: 20,
      concurrency: 1,
      videoCodec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioSampleRate: 48_000,
      audioChannels: 1,
      episodeId: job.episodeId,
      compositionId: job.compositionId,
      artifactRole: "formal-candidate",
      formalCandidate: true,
      visualSource: V004B_FORMAL_QA_PROFILE.visualSource,
      voice: "v004-full",
      voiceIsTemporary: true,
      subtitleStyle: "v004b-no-box",
      subtitleDelivery: "external-overlay-applied",
      burnInSubtitle: false,
      overlayEncoding: "20x900-frame-serial",
      machineValidation: true,
      humanVisualApproval: false,
      continuousOneXWatchCompleted: false,
      finalHumanRecording: false,
      acceptedForRelease: false
    },
    renderBase: {
      artifactRole: "render-base",
      formalCandidate: false,
      jobId: V004B_FORMAL_QA_PROFILE.renderBaseJobId,
      candidateVersion: 14,
      subtitleDelivery: "external-overlay-required",
      path: resolve(renderBaseDirectory, "review-10m.mp4"),
      bytes: 10_000,
      sha256: V004B_FORMAL_QA_PROFILE.renderBaseVideoSha256,
      manifestPath: resolve(renderBaseDirectory, "review-manifest.json"),
      manifestSha256: V004B_FORMAL_QA_PROFILE.renderBaseManifestSha256,
      durableReceiptPath: resolve(
        renderBaseDirectory,
        "publication-durable-receipt.json"
      ),
      durableReceiptSha256: V004B_FORMAL_QA_PROFILE.renderBaseReceiptSha256
    },
    overlay: {
      sha256: V004B_FORMAL_QA_PROFILE.overlayManifestSha256,
      timelineSha256: V004B_FORMAL_QA_PROFILE.timelineSha256
    },
    builder: {
      path: resolve(WORKSPACE_ROOT, "studio/scripts/build-agent-skill-v004b-no-box-final.mjs"),
      bytes: V004B_FORMAL_QA_PROFILE.historicalBuilderBytes,
      sha256: V004B_FORMAL_QA_PROFILE.historicalBuilderSha256
    },
    voice: {
      profile: "v004-full",
      temporary: true,
      finalHumanRecording: false,
      sha256: V004B_FORMAL_QA_PROFILE.temporaryVoiceSha256
    },
    chunks: Array.from({ length: 20 }, (_, index) => {
      const startFrame = index * 900;
      return {
        schemaVersion: "agent-skill-v004b-no-box-overlay-chunk-v1",
        runFingerprint,
        range: {
          index,
          startFrame,
          endFrameExclusive: startFrame + 900,
          endFrameInclusive: startFrame + 899,
          frameCount: 900
        },
        file: { bytes: 1_000 + index, sha256: "c".repeat(64) },
        decoding: { videoDecodedWithoutError: true }
      };
    }),
    finalMedia: {
      schemaVersion: V004B_FORMAL_QA_PROFILE.finalMediaSchemaVersion,
      runFingerprint,
      file: {
        path: finalVideoPath,
        ...videoIntegrity
      },
      published: { path: finalVideoPath, ...videoIntegrity },
      decoding: {
        videoDecodedWithoutError: true,
        audioDecodedWithoutError: true
      }
    },
    publication: {
      atomicDirectoryRename: true,
      nonOverwriting: true,
      durabilityProtocol: "file-and-directory-fsync-with-durable-receipt-v1",
      outputPath: finalVideoPath
    },
    republication: {
      schemaVersion: V004B_FORMAL_QA_PROFILE.rebindSchemaVersion,
      method: "byte-identical-copy-no-reencode",
      sourceArtifact: {
        directory: sourceCandidateDirectory,
        video: {
          path: resolve(sourceCandidateDirectory, "review-10m.mp4"),
          bytes: V004B_FORMAL_QA_PROFILE.sourceCandidateVideoBytes,
          sha256: V004B_FORMAL_QA_PROFILE.sourceCandidateVideoSha256
        },
        manifest: {
          path: resolve(sourceCandidateDirectory, "review-manifest.json"),
          bytes: V004B_FORMAL_QA_PROFILE.sourceCandidateManifestBytes,
          sha256: V004B_FORMAL_QA_PROFILE.sourceCandidateManifestSha256
        },
        durableReceipt: {
          path: resolve(sourceCandidateDirectory, "publication-durable-receipt.json"),
          bytes: V004B_FORMAL_QA_PROFILE.sourceCandidateReceiptBytes,
          sha256: V004B_FORMAL_QA_PROFILE.sourceCandidateReceiptSha256
        }
      },
      versionBinding: {
        sourceMistaggedCandidateVersion:
          V004B_FORMAL_QA_PROFILE.sourceCandidateMistaggedVersion,
        formalCandidateVersion: 1,
        renderBaseCandidateVersion: 14,
        formalJobId: job.jobId
      },
      verification: {
        validatedAt: "2026-09-02T00:00:00.000Z",
        probeSha256: "9".repeat(64),
        ffprobe: { checks: { duration: true, zeroStart: true } },
        fullDecode: {
          videoDecodedWithoutError: true,
          audioDecodedWithoutError: true,
          videoMode: "sequential-rawvideo-null",
          audioMode: "sequential-pcm-s16le-null"
        }
      },
      rebinder: {
        path: job.resolvedPaths.runner,
        bytes: V004B_FORMAL_QA_PROFILE.rebindRunnerBytes,
        sha256: rebinderSha256
      },
      sourceCandidatePreserved: true,
      mediaReencoded: false
    },
    prohibitions: {
      oldOutputsOverwritten: false,
      sourceCandidateModified: false,
      sourceCandidateDeleted: false,
      videoReencoded: false
    }
  };
}

function durableReceipt(job, manifest, videoIntegrity, manifestIntegrity) {
  const jobBinding = {
    finalManifestSchemaVersion: V004B_FORMAL_QA_PROFILE.manifestSchemaVersion,
    runFingerprint: manifest.runFingerprint,
    jobId: job.jobId,
    candidateVersion: 1,
    episodeId: job.episodeId,
    compositionId: job.compositionId
  };
  return {
    schemaVersion: V004B_FORMAL_QA_PROFILE.receiptSchemaVersion,
    kind: "durable_receipt",
    attemptToken: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    output: { fileName: "review-10m.mp4", ...videoIntegrity },
    manifest: {
      fileName: "review-manifest.json",
      sha256: manifestIntegrity.sha256
    },
    jobBinding,
    jobBindingSha256: createHash("sha256")
      .update(stableStringify(jobBinding))
      .digest("hex"),
    recordedAt: "2026-09-02T00:00:00.000Z"
  };
}

test("formal v004b QA config keeps candidate v001 separate from visual v013 and render-base v014", async () => {
  const job = await formalJob();
  assert.equal(isV004bFormalQaJob(job), true);
  assert.equal(job.candidateVersion, 1);
  assert.match(job.jobId, /formal-v001$/u);
  assert.match(job.paths.finalDirectory, /no-box-formal-v001$/u);
  assert.equal(V004B_FORMAL_QA_PROFILE.renderBaseCandidateVersion, 14);
  assert.equal(
    V004B_FORMAL_QA_PROFILE.visualSource,
    "v013@980c4f4be9c1f0bccdcd546873fa1a877c98aac8"
  );
  assert.equal(
    V004B_FORMAL_QA_PROFILE.renderBaseJobId,
    "agent-skill-20260806-current-visual-upgrade-render-base-v014"
  );
  assert.deepEqual(V004B_FORMAL_QA_PROFILE.titleFirstOffsetsInFrames, [0, 6, 15, 30, 45, 60]);
  assert.deepEqual(V004B_FORMAL_QA_PROFILE.boundaryOffsetsInFrames, [-8, -1, 0, 1, 8]);
  assert.equal(V004B_FORMAL_QA_PROFILE.watermarkCadenceId, "continuous");
  assert.deepEqual(
    V004B_FORMAL_QA_PROFILE.watermarkMotionSampleOffsetsInFrames,
    [0, 15, 30, 45, 60, 75, 90, 105, 119, 120]
  );
  assert.equal(V004B_FORMAL_QA_PROFILE.expectedEvidenceFrameCount, 742);

  assert.equal(isV004bFormalQaJob({
    ...job,
    candidateVersion: 14
  }), false);
  assert.equal(isV004bFormalQaJob({
    ...job,
    paths: { ...job.paths, finalDirectory: job.paths.finalDirectory.replace("formal-", "") }
  }), false);
});

test("formal v004b manifest binds finalMedia.published, immutable provenance and 20 exact chunks", async () => {
  const job = await formalJob();
  const videoIntegrity = {
    bytes: V004B_FORMAL_QA_PROFILE.sourceCandidateVideoBytes,
    sha256: V004B_FORMAL_QA_PROFILE.sourceCandidateVideoSha256
  };
  const videoPath = resolve(job.resolvedPaths.finalDirectory, "review-10m.mp4");
  const manifest = formalManifest(job, videoIntegrity);
  const result = validateV004bFormalCandidateManifest({
    manifest,
    job,
    videoIntegrity,
    videoPath
  });
  assert.equal(result.passed, true);
  assert.equal(result.job.candidateVersion, 1);
  assert.equal(result.job.renderBaseCandidateVersion, 14);

  assert.throws(() => validateV004bFormalCandidateManifest({
    manifest: {
      ...manifest,
      renderJob: { ...manifest.renderJob, candidateVersion: 14 }
    },
    job,
    videoIntegrity,
    videoPath
  }), /formalCandidateVersion/u);
  assert.throws(() => validateV004bFormalCandidateManifest({
    manifest: {
      ...manifest,
      finalMedia: {
        ...manifest.finalMedia,
        published: { ...manifest.finalMedia.published, sha256: "e".repeat(64) }
      }
    },
    job,
    videoIntegrity,
    videoPath
  }), /finalMediaPublishedSha256|finalMediaValidatedBytes/u);
  assert.throws(() => validateV004bFormalCandidateManifest({
    manifest: {
      ...manifest,
      finalMedia: {
        ...manifest.finalMedia,
        published: {
          ...manifest.finalMedia.published,
          path: resolve(job.resolvedPaths.finalDirectory, "wrong.mp4")
        }
      }
    },
    job,
    videoIntegrity,
    videoPath
  }), /finalMediaPublishedPath/u);
  assert.throws(() => validateV004bFormalCandidateManifest({
    manifest: {
      ...manifest,
      renderBase: { ...manifest.renderBase, candidateVersion: 1 }
    },
    job,
    videoIntegrity,
    videoPath
  }), /renderBaseIsSeparateProvenance/u);
  assert.throws(() => validateV004bFormalCandidateManifest({
    manifest: {
      ...manifest,
      finalMedia: { ...manifest.finalMedia, runFingerprint: "f".repeat(64) }
    },
    job,
    videoIntegrity,
    videoPath
  }), /finalMediaRunFingerprint/u);
  assert.throws(() => validateV004bFormalCandidateManifest({
    manifest: {
      ...manifest,
      republication: {
        ...manifest.republication,
        mediaReencoded: true
      }
    },
    job,
    videoIntegrity,
    videoPath
  }), /byteIdenticalRepublication/u);
});

test("formal v004b durable receipt independently binds candidateVersion=1 manifest and media", async () => {
  const job = await formalJob();
  const videoIntegrity = { bytes: 8_192, sha256: "d".repeat(64) };
  const manifest = formalManifest(job, videoIntegrity);
  const manifestIntegrity = { bytes: 16_384, sha256: "e".repeat(64) };
  const receipt = durableReceipt(job, manifest, videoIntegrity, manifestIntegrity);
  assert.equal(validateV004bFormalPublicationDurableReceipt({
    receipt,
    manifest,
    manifestIntegrity,
    videoIntegrity,
    job
  }).passed, true);

  assert.throws(() => validateV004bFormalPublicationDurableReceipt({
    receipt: {
      ...receipt,
      schemaVersion: "agent-skill-long-review-publication-state-v1"
    },
    manifest,
    manifestIntegrity,
    videoIntegrity,
    job
  }), (error) => error?.code === "v004b_formal_publication_receipt_invalid");
  assert.throws(() => validateV004bFormalPublicationDurableReceipt({
    receipt,
    manifest: {
      ...manifest,
      renderJob: { ...manifest.renderJob, candidateVersion: 14 }
    },
    manifestIntegrity,
    videoIntegrity,
    job
  }), /manifestFormalJob/u);
});

test("formal v004b QA source identity binds the exact rebinder and frozen source artifact", async () => {
  const job = await formalJob();
  const runnerSha256 = V004B_FORMAL_QA_PROFILE.rebindRunnerSha256;
  const manifest = formalManifest(
    job,
    { bytes: 8_192, sha256: "d".repeat(64) },
    runnerSha256
  );
  const qaSourceIdentity = {
    worktreeSha256: "f".repeat(64),
    sourceFiles: [
      {
        path: job.paths.runner,
        bytes: V004B_FORMAL_QA_PROFILE.rebindRunnerBytes,
        sha256: runnerSha256
      },
      {
        path:
          `outputs/studio/agent-skill-20260806/review-candidates/` +
          `${V004B_FORMAL_QA_PROFILE.sourceCandidateDirectoryName}/review-10m.mp4`,
        bytes: V004B_FORMAL_QA_PROFILE.sourceCandidateVideoBytes,
        sha256: V004B_FORMAL_QA_PROFILE.sourceCandidateVideoSha256
      },
      {
        path:
          `outputs/studio/agent-skill-20260806/review-candidates/` +
          `${V004B_FORMAL_QA_PROFILE.sourceCandidateDirectoryName}/review-manifest.json`,
        bytes: V004B_FORMAL_QA_PROFILE.sourceCandidateManifestBytes,
        sha256: V004B_FORMAL_QA_PROFILE.sourceCandidateManifestSha256
      },
      {
        path:
          `outputs/studio/agent-skill-20260806/review-candidates/` +
          `${V004B_FORMAL_QA_PROFILE.sourceCandidateDirectoryName}/publication-durable-receipt.json`,
        bytes: V004B_FORMAL_QA_PROFILE.sourceCandidateReceiptBytes,
        sha256: V004B_FORMAL_QA_PROFILE.sourceCandidateReceiptSha256
      }
    ]
  };
  assert.equal(validateV004bFormalQaSourceBinding({
    manifest,
    job,
    qaSourceIdentity
  }).passed, true);
  assert.throws(() => validateV004bFormalQaSourceBinding({
    manifest,
    job,
    qaSourceIdentity: {
      ...qaSourceIdentity,
      sourceFiles: [
        { ...qaSourceIdentity.sourceFiles[0], sha256: "0".repeat(64) },
        ...qaSourceIdentity.sourceFiles.slice(1)
      ]
    }
  }), /runnerSha256/u);
  assert.notEqual(manifest.builder.sha256, manifest.republication.rebinder.sha256);
  assert.equal(
    manifest.builder.sha256,
    V004B_FORMAL_QA_PROFILE.historicalBuilderSha256
  );
});

test("formal v004b media probe requires zero starts, exact 600s, 18000 frames and mono AAC", () => {
  const probe = {
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      start_time: "0.000000",
      duration: "600.000000"
    },
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        pix_fmt: "yuv420p",
        avg_frame_rate: "30/1",
        start_time: "0.000000",
        nb_read_frames: "18000"
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 1,
        start_time: "0.000000",
        duration: "600.000000"
      }
    ]
  };
  assert.ok(Object.values(evaluateV004bFormalMediaProbe(probe).checks).every(Boolean));
  assert.equal(evaluateV004bFormalMediaProbe({
    ...probe,
    streams: [probe.streams[0], { ...probe.streams[1], channels: 2 }]
  }).checks.monoAudio, false);
  assert.equal(evaluateV004bFormalMediaProbe({
    ...probe,
    format: { ...probe.format, start_time: "0.033333" }
  }).checks.formatStartsAtZero, false);
  assert.equal(evaluateV004bFormalMediaProbe({
    ...probe,
    format: { ...probe.format, duration: "599.950000" }
  }).checks.durationExactly600Seconds, false);
  assert.equal(evaluateV004bFormalMediaProbe({
    ...probe,
    streams: [{ ...probe.streams[0], nb_read_frames: "17999" }, probe.streams[1]]
  }).checks.exactly18000VideoFrames, false);
  assert.equal(evaluateV004bFormalMediaProbe({
    ...probe,
    streams: [probe.streams[0], probe.streams[0], probe.streams[1]]
  }).checks.exactlyOneVideoTrack, false);
});

test("formal v004b plan includes decoded watermark motion and full-cycle return evidence", async (context) => {
  // Loading the production job validates its files. Supply an isolated source
  // checkout with explicitly synthetic input files, never the live episode.
  const root = await mkdtemp(resolve(await realpath(tmpdir()), "v004b-qa-plan-fixture-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const studio = resolve(root, "studio");
  const job = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  await mkdir(resolve(studio, "scripts"), { recursive: true });
  await cp(resolve(STUDIO_ROOT, "src"), resolve(studio, "src"), { recursive: true });
  await symlink(resolve(STUDIO_ROOT, "node_modules"), resolve(studio, "node_modules"), "dir");
  for (const source of [
    "studio/scripts/qa-agent-skill-long-review-wide-v004.mjs",
    job.paths.runner,
    CONFIG_RELATIVE
  ]) {
    await mkdir(dirname(resolve(root, source)), { recursive: true });
    await copyFile(resolve(WORKSPACE_ROOT, source), resolve(root, source));
  }
  for (const input of [job.paths.episode, job.paths.voice]) {
    await mkdir(dirname(resolve(root, input)), { recursive: true });
    await writeFile(resolve(root, input), "synthetic plan-only fixture\n", { flag: "wx" });
  }
  const program = [
    "const qa = await import('./scripts/qa-agent-skill-long-review-wide-v004.mjs');",
    "const plan = qa.buildFramePlan();",
    "const outputs = plan.fullSamples.map((sample) => `/tmp/${sample.frame}.png`);",
    "const batches = qa.partitionSequentialExtractionBatches({samples: plan.fullSamples, outputPaths: outputs});",
    "const periodicOutputs = plan.periodicSamples.map((sample) => `/tmp/periodic-${sample.frame}.png`);",
    "const periodicBatches = qa.partitionSequentialExtractionBatches({samples: plan.periodicSamples, outputPaths: periodicOutputs});",
    "const args = qa.buildSequentialExtractionFfmpegArgs({samples: batches[0].samples, outputPaths: batches[0].outputPaths, videoPath: '/tmp/input.mp4'});",
    "console.log(JSON.stringify({",
    "  contract: qa.WIDE_V004_QA_CONTRACT,",
    "  full: plan.fullSamples.length,",
    "  periodic: plan.periodicSamples.length,",
    "  tagCounts: Object.fromEntries(['representative:','title-first:','boundary:','chunk-seam:','watermark-motion-sample:','final-tail:'].map((prefix) => [prefix, plan.fullSamples.flatMap((sample) => sample.tags).filter((tag) => tag.startsWith(prefix)).length])),",
    "  batchCount: batches.length,",
    "  maximumBatch: Math.max(...batches.map((batch) => batch.samples.length)),",
    "  periodicBatchCount: periodicBatches.length,",
    "  periodicMaximumBatch: Math.max(...periodicBatches.map((batch) => batch.samples.length)),",
    "  fullStrictlyIncreasing: plan.fullSamples.every((sample, index) => index === 0 || sample.frame > plan.fullSamples[index - 1].frame),",
    "  periodicStrictlyIncreasing: plan.periodicSamples.every((sample, index) => index === 0 || sample.frame > plan.periodicSamples[index - 1].frame),",
    "  sheets: qa.requiredLongReviewContactSheets(),",
    "  args",
    "}));"
  ].join("\n");
  const { stdout } = await execFileAsync(process.execPath, [
    "--input-type=module",
    "-e",
    program
  ], {
    cwd: studio,
    encoding: "utf8",
    env: {
      ...process.env,
      AI_CONCEPT_STUDIO_LONG_REVIEW_QA_JOB: resolve(root, CONFIG_RELATIVE)
    },
    maxBuffer: 16 * 1024 * 1024
  });
  const result = JSON.parse(stdout);
  assert.equal(result.contract.candidateVersion, 1);
  assert.equal(result.contract.qaProfile, V004B_FORMAL_QA_PROFILE.schemaVersion);
  assert.equal(result.contract.frameExtractionStrategy, "batched-sequential-decode-no-seek");
  assert.equal(result.contract.watermarkCadenceId, "continuous");
  assert.deepEqual(
    result.contract.watermarkMotionSampleOffsetsInFrames,
    [0, 15, 30, 45, 60, 75, 90, 105, 119, 120]
  );
  assert.equal(result.full, 441);
  assert.equal(result.periodic, 301);
  assert.deepEqual(result.tagCounts, {
    "representative:": 18,
    "title-first:": 108,
    "boundary:": 85,
    "chunk-seam:": 95,
    "watermark-motion-sample:": 200,
    "final-tail:": 6
  });
  assert.equal(result.batchCount, 19);
  assert.equal(result.maximumBatch, 24);
  assert.equal(result.periodicBatchCount, 13);
  assert.equal(result.periodicMaximumBatch, 24);
  assert.equal(result.fullStrictlyIncreasing, true);
  assert.equal(result.periodicStrictlyIncreasing, true);
  assert.equal(result.sheets.length, 32);
  assert.equal(result.args.filter((argument) => argument === "-i").length, 1);
  assert.equal(result.args.includes("-ss"), false);
  assert.equal(result.args.some((argument) => String(argument).includes("select=")), false);
  assert.ok(result.args.filter((argument) => argument === "-threads:v").length <= 24);
});

test("Python analyzer has a decoded-crop continuous-motion gate without replacing A-B-A", async () => {
  const source = await readFile(
    resolve(STUDIO_ROOT, "scripts/qa-agent-skill-long-review-wide-v004.py"),
    "utf8"
  );
  for (const name of [
    "contact-title-first-",
    "contact-scene-boundaries-",
    "contact-chunk-seams-",
    "contact-final-tail.png",
    "contact-watermark-motion-",
    "contact-periodic-2s-"
  ]) {
    assert.match(source, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(source, /single-frame-aba-layer-dropout/u);
  assert.match(source, /def analyze_watermark_continuous_motion/u);
  assert.match(source, /multipleDecodedCropHashesChanged/u);
  assert.match(source, /multipleMaterialMotionPhasesDetected/u);
  assert.match(source, /fullCycleReturned/u);
  assert.match(source, /watermark-motion-proof\.json/u);
  assert.match(source, /full_sample_count != 441/u);
  assert.match(source, /periodic_sample_count != 301/u);
  assert.equal(requiredLongReviewContactSheets({ formalV004b: true }).length, 32);
});

test("decoded watermark crop gate accepts a 120-frame cycle and rejects a static logo", async () => {
  const python = await resolveLockedPythonRuntime();
  const program = String.raw`
import importlib.util
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image

spec = importlib.util.spec_from_file_location("long_review_qa", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
asset_root = Path(sys.argv[2])
offsets = [0, 15, 30, 45, 60, 75, 90, 105, 119, 120]

def analyze(static):
    with TemporaryDirectory() as raw_directory:
        directory = Path(raw_directory)
        samples = []
        for offset in offsets:
            asset_frame = 0 if static else offset % 120
            watermark = Image.open(asset_root / f"frame-{asset_frame:03d}.png").convert("RGBA")
            alpha = watermark.getchannel("A").point(lambda value: round(value * 0.76))
            watermark.putalpha(alpha)
            frame = Image.new("RGBA", (1920, 1080), (238, 243, 240, 255))
            frame.alpha_composite(watermark, (1760, 40))
            filename = f"frame-{offset:03d}.png"
            frame.convert("RGB").save(directory / filename)
            samples.append({
                "frame": offset,
                "second": offset / 30,
                "filename": filename,
                "tags": [f"watermark-motion-sample:chunk-01:offset:{offset}"],
            })
        index = {
            "watermarkCadenceId": "continuous",
            "watermarkCycleInFrames": 120,
            "watermarkMotionSampleOffsetsInFrames": offsets,
            "watermarkCropPixels": {"left": 1760, "top": 40, "width": 120, "height": 120},
            "watermarkMotionProof": {
                "schemaVersion": "agent-skill-v004b-watermark-motion-proof-v1",
                "minimumDistinctCropHashCount": 5,
                "minimumMateriallyChangedPhaseCount": 4,
                "materialChangeDhashHammingMinimum": 128,
                "cycleReturnDhashHammingMaximum": 96,
            },
            "chunkCount": 1,
            "chunkDurationInFrames": 900,
            "fullSamples": samples,
        }
        return module.analyze_watermark_continuous_motion(directory, index)

moving = analyze(False)
static = analyze(True)
print(json.dumps({
    "movingStatus": moving["status"],
    "movingChanged": moving["chunks"][0]["materiallyChangedPhaseCount"],
    "movingReturnDistance": moving["chunks"][0]["cycleReturnDhashHammingDistance"],
    "staticStatus": static["status"],
    "staticChanged": static["chunks"][0]["materiallyChangedPhaseCount"],
}))
`;
  const { stdout } = await execFileAsync(python.path, [
    "-I",
    "-c",
    program,
    ANALYZER_PATH,
    WATERMARK_FRAME_DIRECTORY
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const result = JSON.parse(stdout);

  assert.equal(result.movingStatus, "pass");
  assert.ok(result.movingChanged >= 4);
  assert.ok(result.movingReturnDistance <= 96);
  assert.equal(result.staticStatus, "fail");
  assert.equal(result.staticChanged, 0);
});
