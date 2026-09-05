import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  LONG_REVIEW_FINAL_MANIFEST_SCHEMA_VERSION,
  LONG_REVIEW_FINAL_MEDIA_SCHEMA_VERSION,
  LONG_REVIEW_PUBLICATION_RECEIPT_FILE_NAME,
  LONG_REVIEW_PUBLICATION_RECEIPT_POLICY,
  LONG_REVIEW_PUBLICATION_STATE_SCHEMA_VERSION,
  LONG_REVIEW_QA_SCHEMA_VERSION,
  LONG_REVIEW_RENDER_CONTRACT_SCHEMA_VERSION,
  parseLongReviewQaCliArguments,
  validateLongReviewCandidateManifest,
  validateLongReviewPublicationDurableReceipt
} from "../src/server/production/long-review-qa.mjs";
import {
  LONG_REVIEW_RENDER_JOB_SCHEMA_VERSION,
  validateLongReviewRenderJob
} from "../src/server/production/long-render-job.mjs";
import {
  captureQaCandidatePathGuards,
  qaArtifactPaths,
  runAgentSkillLongReviewQa,
  validateLongReviewAnalyzerArtifacts,
  verifyQaCandidatePathGuards
} from "../scripts/qa-agent-skill-long-review-wide-v004.mjs";

const execFileAsync = promisify(execFile);
const STUDIO_ROOT = resolve(import.meta.dirname, "..");
const WORKSPACE_ROOT = resolve(STUDIO_ROOT, "..");
async function fileIntegrity(filePath) {
  const contents = await readFile(filePath);
  return {
    bytes: contents.length,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

function jobFixture({ episodeId = "agent-skill-current", candidateVersion = 8 } = {}) {
  const token = `v${String(candidateVersion).padStart(3, "0")}`;
  const finalName = `full-video-current-${token}`;
  return {
    schemaVersion: LONG_REVIEW_RENDER_JOB_SCHEMA_VERSION,
    jobId: `${episodeId}-${token}`,
    episodeId,
    candidateVersion,
    compositionId: "AgentSkillLongReview",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 18_000,
    paths: {
      entryPoint: "studio/src/video/agent-skill-long-review-index.jsx",
      episode: `studio/data/episodes/${episodeId}/episode.json`,
      voice: `studio/public/episodes/${episodeId}/voice-review.wav`,
      finalDirectory:
        `outputs/studio/${episodeId}/review-candidates/${finalName}`,
      workDirectory:
        `outputs/studio/${episodeId}/review-candidates/.${finalName}-work`
    },
    protectedArtifacts: [],
    temporaryVoice: true,
    temporaryVoiceIsFinalHumanRecording: false
  };
}

function inputIdentity(job) {
  return {
    source: {
      algorithm: "sha256",
      sha256: "1".repeat(64),
      fileCount: 2,
      totalBytes: 20,
      files: []
    },
    git: {
      headSha: "2".repeat(40),
      statusSha256: "3".repeat(64),
      trackedDiffSha256: "4".repeat(64),
      untracked: { algorithm: "sha256", sha256: "5".repeat(64), fileCount: 0, files: [] }
    },
    voice: {
      path: job.paths.voice,
      bytes: 10,
      sha256: "6".repeat(64)
    }
  };
}

function candidateManifest(job, integrity, identity = inputIdentity(job)) {
  return {
    schemaVersion: LONG_REVIEW_FINAL_MANIFEST_SCHEMA_VERSION,
    runFingerprint: "9".repeat(64),
    contract: {
      schemaVersion: LONG_REVIEW_RENDER_CONTRACT_SCHEMA_VERSION,
      jobId: job.jobId,
      candidateVersion: job.candidateVersion,
      episodeId: job.episodeId,
      compositionId: job.compositionId,
      width: job.width,
      height: job.height,
      fps: job.fps,
      durationInFrames: job.durationInFrames
    },
    renderJob: {
      schemaVersion: job.schemaVersion,
      jobId: job.jobId,
      candidateVersion: job.candidateVersion,
      paths: job.paths,
      temporaryVoice: job.temporaryVoice,
      temporaryVoiceIsFinalHumanRecording: job.temporaryVoiceIsFinalHumanRecording
    },
    paths: {
      finalDirectory: job.paths.finalDirectory,
      finalOutput: `${job.paths.finalDirectory}/review-10m.mp4`
    },
    ...identity,
    finalMedia: {
      schemaVersion: LONG_REVIEW_FINAL_MEDIA_SCHEMA_VERSION,
      file: { ...integrity }
    },
    publication: {
      outputPath: `${job.paths.finalDirectory}/review-10m.mp4`
    }
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function durableReceiptFixture({job, manifest, videoIntegrity, manifestIntegrity}) {
  const jobBinding = {
    finalManifestSchemaVersion: LONG_REVIEW_FINAL_MANIFEST_SCHEMA_VERSION,
    runFingerprint: manifest.runFingerprint,
    jobId: job.jobId,
    candidateVersion: job.candidateVersion,
    episodeId: job.episodeId,
    compositionId: job.compositionId
  };
  return {
    schemaVersion: LONG_REVIEW_PUBLICATION_STATE_SCHEMA_VERSION,
    kind: "durable_receipt",
    attemptToken: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    output: {
      fileName: "review-10m.mp4",
      bytes: videoIntegrity.bytes,
      sha256: videoIntegrity.sha256
    },
    manifest: {
      fileName: "review-manifest.json",
      sha256: manifestIntegrity.sha256
    },
    jobBinding,
    jobBindingSha256: createHash("sha256")
      .update(JSON.stringify(stableValue(jobBinding)))
      .digest("hex"),
    recordedAt: "2026-08-31T10:00:00.000Z"
  };
}

test("versioned QA CLI requires one explicit render job and immutable QA output naming", () => {
  assert.deepEqual(LONG_REVIEW_PUBLICATION_RECEIPT_POLICY, {
    genericJobProtocol: "required",
    legacyDirectWideV004: "historical_compatibility_only"
  });
  assert.deepEqual(
    parseLongReviewQaCliArguments([
      "--job-config", "studio/config/render-jobs/current-v008.json",
      "--qa-dir-name=qa-v002"
    ]),
    {
      help: false,
      jobConfigPath: "studio/config/render-jobs/current-v008.json",
      qaDirectoryName: "qa-v002",
      videoFileName: "review-10m.mp4"
    }
  );
  assert.throws(() => parseLongReviewQaCliArguments([]), /--job-config/u);
  assert.throws(
    () => parseLongReviewQaCliArguments(["--job-config=x", "--video=other.mp4"]),
    /Unknown option/u
  );
  assert.throws(
    () => parseLongReviewQaCliArguments(["--job-config=x", "--candidate-dir=other"]),
    /Unknown option/u
  );
});

test("generic candidate manifest binds v005+ job, exact candidate path and MP4 bytes", () => {
  const rawJob = jobFixture({ candidateVersion: 8 });
  const job = validateLongReviewRenderJob(rawJob, { workspaceRoot: WORKSPACE_ROOT });
  const integrity = { bytes: 4_096, sha256: "a".repeat(64) };
  const videoPath = resolve(job.resolvedPaths.finalDirectory, "review-10m.mp4");
  const manifest = candidateManifest(rawJob, integrity);
  const identity = inputIdentity(rawJob);
  const result = validateLongReviewCandidateManifest({
    manifest,
    job,
    videoIntegrity: integrity,
    videoPath,
    workspaceRoot: WORKSPACE_ROOT,
    currentInputIdentity: identity
  });
  assert.equal(result.passed, true);
  assert.equal(result.job.candidateVersion, 8);
  assert.equal(LONG_REVIEW_QA_SCHEMA_VERSION, "agent-skill-long-review-qa-pipeline-v1");

  assert.throws(() => validateLongReviewCandidateManifest({
    manifest: {
      ...manifest,
      contract: { ...manifest.contract, candidateVersion: 7 }
    },
    job,
    videoIntegrity: integrity,
    videoPath,
    workspaceRoot: WORKSPACE_ROOT,
    currentInputIdentity: identity
  }), /candidateVersion/u);
  assert.throws(() => validateLongReviewCandidateManifest({
    manifest,
    job,
    videoIntegrity: { ...integrity, sha256: "b".repeat(64) },
    videoPath,
    workspaceRoot: WORKSPACE_ROOT,
    currentInputIdentity: identity
  }), /finalMediaSha256/u);
  assert.throws(() => validateLongReviewCandidateManifest({
    manifest,
    job,
    videoIntegrity: integrity,
    videoPath: resolve(job.resolvedPaths.finalDirectory, "other.mp4"),
    workspaceRoot: WORKSPACE_ROOT,
    currentInputIdentity: identity
  }), /exactCandidateVideoPath/u);
  assert.throws(() => validateLongReviewCandidateManifest({
    manifest: { ...manifest, schemaVersion: "legacy-or-unknown" },
    job,
    videoIntegrity: integrity,
    videoPath,
    workspaceRoot: WORKSPACE_ROOT,
    currentInputIdentity: identity
  }), /finalManifestSchema/u);
  assert.throws(() => validateLongReviewCandidateManifest({
    manifest,
    job,
    videoIntegrity: integrity,
    videoPath,
    workspaceRoot: WORKSPACE_ROOT,
    currentInputIdentity: {
      ...identity,
      voice: { ...identity.voice, sha256: "7".repeat(64) }
    }
  }), /currentVoiceIdentity/u);
});

test("generic QA accepts only a positive durable receipt bound to exact media, manifest and job", () => {
  const rawJob = jobFixture({candidateVersion: 8});
  const job = validateLongReviewRenderJob(rawJob, {workspaceRoot: WORKSPACE_ROOT});
  const videoIntegrity = {bytes: 4_096, sha256: "a".repeat(64)};
  const manifest = candidateManifest(rawJob, videoIntegrity);
  const manifestIntegrity = {bytes: 8_192, sha256: "b".repeat(64)};
  const receipt = durableReceiptFixture({
    job: rawJob,
    manifest,
    videoIntegrity,
    manifestIntegrity
  });
  const result = validateLongReviewPublicationDurableReceipt({
    receipt,
    manifest,
    manifestIntegrity,
    videoIntegrity,
    job
  });
  assert.equal(result.passed, true);
  assert.equal(result.receipt.kind, "durable_receipt");
  assert.equal(
    LONG_REVIEW_PUBLICATION_RECEIPT_FILE_NAME,
    "publication-durable-receipt.json"
  );

  const rejected = [
    null,
    {...receipt, kind: "durability_unknown"},
    {...receipt, schemaVersion: "legacy-or-unknown"},
    {...receipt, attemptToken: "not-a-uuid"},
    {...receipt, output: {...receipt.output, sha256: "c".repeat(64)}},
    {...receipt, manifest: {...receipt.manifest, sha256: "d".repeat(64)}},
    {...receipt, jobBinding: {...receipt.jobBinding, jobId: "other-job"}},
    {...receipt, jobBindingSha256: "e".repeat(64)},
    {...receipt, extra: true}
  ];
  for (const candidate of rejected) {
    assert.throws(
      () => validateLongReviewPublicationDurableReceipt({
        receipt: candidate,
        manifest,
        manifestIntegrity,
        videoIntegrity,
        job
      }),
      (error) => error?.code === "long_review_publication_receipt_invalid"
    );
  }
});

test("actual generic QA entry fails closed on an unbound manifest before writing qa artifacts", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const episodeId = `qa-entry-${suffix}`;
  const rawJob = jobFixture({ episodeId, candidateVersion: 905 });
  const configPath = resolve(STUDIO_ROOT, "config", "render-jobs", `${episodeId}-v905.json`);
  const episodeDirectory = resolve(STUDIO_ROOT, "data", "episodes", episodeId);
  const voiceDirectory = resolve(STUDIO_ROOT, "public", "episodes", episodeId);
  const outputRoot = resolve(WORKSPACE_ROOT, "outputs", "studio", episodeId);
  const candidateDirectory = resolve(WORKSPACE_ROOT, rawJob.paths.finalDirectory);
  const videoContents = "not-a-real-mp4";
  try {
    await Promise.all([
      mkdir(resolve(configPath, ".."), { recursive: true }),
      mkdir(episodeDirectory, { recursive: true }),
      mkdir(voiceDirectory, { recursive: true }),
      mkdir(candidateDirectory, { recursive: true })
    ]);
    await Promise.all([
      writeFile(configPath, `${JSON.stringify(rawJob, null, 2)}\n`, "utf8"),
      writeFile(resolve(episodeDirectory, "episode.json"), "{}\n", "utf8"),
      writeFile(resolve(voiceDirectory, "voice-review.wav"), "not-a-real-wave", "utf8"),
      writeFile(resolve(candidateDirectory, "review-10m.mp4"), videoContents, "utf8"),
      writeFile(resolve(candidateDirectory, "review-manifest.json"), "{}\n", "utf8")
    ]);
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "scripts/qa-agent-skill-long-review.mjs",
          "--job-config",
          `studio/config/render-jobs/${episodeId}-v905.json`
        ],
        { cwd: STUDIO_ROOT, encoding: "utf8" }
      ),
      (error) => {
        assert.match(error.stderr, /candidate manifest is not bound to the explicit render job/u);
        return true;
      }
    );
    await assert.rejects(readFile(resolve(candidateDirectory, "qa", "run-manifest.json")), {
      code: "ENOENT"
    });

    const integrity = {
      bytes: Buffer.byteLength(videoContents),
      sha256: createHash("sha256").update(videoContents).digest("hex")
    };
    const validManifest = candidateManifest(rawJob, integrity);
    const validManifestPath = resolve(candidateDirectory, "review-manifest.json");
    await writeFile(
      validManifestPath,
      `${JSON.stringify(validManifest, null, 2)}\n`,
      "utf8"
    );
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "scripts/qa-agent-skill-long-review.mjs",
          "--job-config",
          `studio/config/render-jobs/${episodeId}-v905.json`
        ],
        { cwd: STUDIO_ROOT, encoding: "utf8" }
      ),
      (error) => {
        assert.match(error.stderr, /requires publication-durable-receipt\.json/u);
        return true;
      }
    );
    const manifestIntegrity = await fileIntegrity(validManifestPath);
    const validReceipt = durableReceiptFixture({
      job: rawJob,
      manifest: validManifest,
      videoIntegrity: integrity,
      manifestIntegrity
    });
    await writeFile(
      resolve(candidateDirectory, LONG_REVIEW_PUBLICATION_RECEIPT_FILE_NAME),
      `${JSON.stringify({...validReceipt, kind: "durability_unknown"}, null, 2)}\n`,
      "utf8"
    );
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "scripts/qa-agent-skill-long-review.mjs",
          "--job-config",
          `studio/config/render-jobs/${episodeId}-v905.json`
        ],
        { cwd: STUDIO_ROOT, encoding: "utf8" }
      ),
      (error) => {
        assert.match(error.stderr, /valid positive durable publication receipt/u);
        return true;
      }
    );
    await writeFile(
      resolve(candidateDirectory, LONG_REVIEW_PUBLICATION_RECEIPT_FILE_NAME),
      `${JSON.stringify(validReceipt, null, 2)}\n`,
      "utf8"
    );
    await mkdir(resolve(candidateDirectory, "qa"));
    await writeFile(resolve(candidateDirectory, "qa", "existing.txt"), "preserve\n", "utf8");
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "scripts/qa-agent-skill-long-review.mjs",
          "--job-config",
          `studio/config/render-jobs/${episodeId}-v905.json`
        ],
        { cwd: STUDIO_ROOT, encoding: "utf8" }
      ),
      (error) => {
        assert.match(error.stderr, /拒绝覆盖/u);
        return true;
      }
    );
    assert.equal(
      await readFile(resolve(candidateDirectory, "qa", "existing.txt"), "utf8"),
      "preserve\n"
    );
  } finally {
    await Promise.all([
      rm(configPath, { force: true }),
      rm(episodeDirectory, { recursive: true, force: true }),
      rm(voiceDirectory, { recursive: true, force: true }),
      rm(outputRoot, { recursive: true, force: true })
    ]);
  }
});

test("generic QA rejects candidate-directory rename/symlink swap with zero outside writes", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const episodeId = `qa-swap-${suffix}`;
  const rawJob = jobFixture({ episodeId, candidateVersion: 906 });
  const configPath = resolve(STUDIO_ROOT, "config", "render-jobs", `${episodeId}-v906.json`);
  const episodeDirectory = resolve(STUDIO_ROOT, "data", "episodes", episodeId);
  const voiceDirectory = resolve(STUDIO_ROOT, "public", "episodes", episodeId);
  const outputRoot = resolve(WORKSPACE_ROOT, "outputs", "studio", episodeId);
  const candidateDirectory = resolve(WORKSPACE_ROOT, rawJob.paths.finalDirectory);
  const backupDirectory = `${candidateDirectory}.original`;
  const outsideDirectory = resolve(WORKSPACE_ROOT, "..", `qa-outside-${suffix}`);
  const videoPath = resolve(candidateDirectory, "review-10m.mp4");
  let swapped = false;
  try {
    await Promise.all([
      mkdir(resolve(configPath, ".."), { recursive: true }),
      mkdir(episodeDirectory, { recursive: true }),
      mkdir(voiceDirectory, { recursive: true }),
      mkdir(resolve(candidateDirectory, "qa-v001"), { recursive: true }),
      mkdir(outsideDirectory, { recursive: true })
    ]);
    await Promise.all([
      writeFile(configPath, `${JSON.stringify(rawJob, null, 2)}\n`, "utf8"),
      writeFile(resolve(episodeDirectory, "episode.json"), "{}\n", "utf8"),
      writeFile(resolve(voiceDirectory, "voice-review.wav"), "voice", "utf8"),
      writeFile(videoPath, "video", "utf8"),
      writeFile(resolve(candidateDirectory, "qa-v001", "old.txt"), "old-qa\n", "utf8"),
      writeFile(resolve(outsideDirectory, "sentinel.txt"), "outside\n", "utf8")
    ]);
    const integrity = await fileIntegrity(videoPath);
    await writeFile(
      resolve(candidateDirectory, "review-manifest.json"),
      `${JSON.stringify(candidateManifest(rawJob, integrity), null, 2)}\n`,
      "utf8"
    );
    const guards = await captureQaCandidatePathGuards({
      reviewCandidatesRoot: dirname(candidateDirectory),
      candidateDirectory,
      videoPath,
      manifestPath: resolve(candidateDirectory, "review-manifest.json")
    });
    await rename(candidateDirectory, backupDirectory);
    await symlink(outsideDirectory, candidateDirectory, "dir");
    swapped = true;
    await assert.rejects(
      verifyQaCandidatePathGuards(guards),
      /符号链接|inode 或元数据/u
    );
    assert.equal(await readlink(candidateDirectory), outsideDirectory);
    assert.deepEqual(await readdir(outsideDirectory), ["sentinel.txt"]);
    assert.equal(
      await readFile(resolve(backupDirectory, "qa-v001", "old.txt"), "utf8"),
      "old-qa\n"
    );
  } finally {
    try {
      if ((await lstat(candidateDirectory)).isSymbolicLink()) {
        await unlink(candidateDirectory);
        swapped = true;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (swapped) {
      try {
        await rename(backupDirectory, candidateDirectory);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await Promise.all([
      rm(configPath, { force: true }),
      rm(episodeDirectory, { recursive: true, force: true }),
      rm(voiceDirectory, { recursive: true, force: true }),
      rm(outputRoot, { recursive: true, force: true }),
      rm(outsideDirectory, { recursive: true, force: true })
    ]);
  }
});

test("generic QA path guard rejects durable receipt replacement", async () => {
  const root = resolve(WORKSPACE_ROOT, "outputs", `.qa-receipt-swap-${randomUUID()}`);
  const candidateDirectory = resolve(root, "candidate");
  const videoPath = resolve(candidateDirectory, "review-10m.mp4");
  const manifestPath = resolve(candidateDirectory, "review-manifest.json");
  const receiptPath = resolve(
    candidateDirectory,
    LONG_REVIEW_PUBLICATION_RECEIPT_FILE_NAME
  );
  try {
    await mkdir(candidateDirectory, {recursive: true});
    await Promise.all([
      writeFile(videoPath, "video", "utf8"),
      writeFile(manifestPath, "{}\n", "utf8"),
      writeFile(receiptPath, "{\"first\":true}\n", "utf8")
    ]);
    const guards = await captureQaCandidatePathGuards({
      reviewCandidatesRoot: root,
      candidateDirectory,
      videoPath,
      manifestPath,
      publicationReceiptPath: receiptPath
    });
    await unlink(receiptPath);
    await writeFile(receiptPath, "{\"second\":true}\n", "utf8");
    await assert.rejects(
      verifyQaCandidatePathGuards(guards),
      /inode 或元数据/u
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("production QA exports reject dependency injection before fake media can create qa", async () => {
  const { runVersionedLongReviewQa } = await import(
    "../scripts/qa-agent-skill-long-review.mjs"
  );
  await assert.rejects(
    runVersionedLongReviewQa(
      ["--job-config", "studio/config/long-review-render-job.example.json"],
      { dependencies: { probeMedia: async () => ({ status: "pass" }) } }
    ),
    /does not accept dependency injection/u
  );
  const productionModule = await import(
    "../scripts/qa-agent-skill-long-review-wide-v004.mjs"
  );
  assert.equal(Object.hasOwn(productionModule, "publishQaArtifactDirectory"), false);
  await assert.rejects(
    runAgentSkillLongReviewQa([], {
      hooks: { afterInitialCandidateValidation: async () => {} },
      dependencies: { probeMedia: async () => ({ status: "pass" }) }
    }),
    /does not accept dependency injection/u
  );
});

test("analyzer protocol rejects accepted output and accepts only strictly pending evidence", async () => {
  const directory = resolve(
    WORKSPACE_ROOT,
    "outputs",
    `.qa-malicious-${randomUUID()}`
  );
  const candidateDirectory = resolve(directory, "candidate-v907");
  const paths = qaArtifactPaths({
    candidateDirectory,
    qaDirectoryName: "qa",
    runId: "malicious"
  });
  const { temporaryQaDirectory, finalQaDirectory } = paths;
  const sourceVideo = { path: "candidate/review-10m.mp4", bytes: 5, sha256: "1".repeat(64) };
  const sourceManifest = { path: "candidate/review-manifest.json", bytes: 6, sha256: "2".repeat(64) };
  const sourcePublicationReceipt = {
    path: "candidate/publication-durable-receipt.json",
    bytes: 7,
    sha256: "3".repeat(64)
  };
  const binding = { passed: true, checks: { fixture: true } };
  const publicationReceiptBinding = {
    passed: true,
    checks: { positiveReceipt: true }
  };
  const contract = {
    schemaVersion: LONG_REVIEW_QA_SCHEMA_VERSION,
    candidateVersion: 907
  };
  try {
    await Promise.all([
      mkdir(candidateDirectory, { recursive: true }),
      mkdir(temporaryQaDirectory, { recursive: true })
    ]);
    const artifacts = {
      "run-manifest.json": {
        schemaVersion: contract.schemaVersion,
        contract,
        candidateManifestBinding: binding,
        publicationReceiptBinding,
        sourceVideo,
        sourceManifest,
        sourcePublicationReceipt,
        guarantees: { manualVisualJudgmentsRemainPending: true }
      },
      "media-integrity-evidence.json": {
        machineOnly: true,
        manualPlaybackRequired: true,
        passed: true
      },
      "frame-index.json": { candidateVersion: 907 },
      "single-frame-aba-layer-dropout.json": {
        schemaVersion: "single-frame-aba-layer-dropout-analysis-v1",
        candidateVersion: 907,
        sourceVideo,
        status: "pass",
        blockingEvents: [],
        blockingEventCount: 0,
        informationalEventCount: 0,
        automaticFrameRepairAttempted: false
      },
      "single-frame-aba-layer-dropout-evidence-plan.json": {
        schemaVersion: "single-frame-aba-layer-dropout-evidence-plan-v1",
        candidateVersion: 907,
        sourceVideo,
        totalBlockingEventCount: 0,
        recordedBlockingEventCount: 0,
        exactFrameNumbers: [],
        events: [],
        automaticFrameRepairAttempted: false
      },
      "frame-metrics.json": {
        schemaVersion: "agent-skill-long-review-frame-analysis-v1",
        candidateVersion: 907
      },
      "qa-summary.json": {
        schemaVersion: "agent-skill-long-review-qa-summary-v1",
        candidateVersion: 907,
        candidate: {
          video: sourceVideo,
          manifest: sourceManifest,
          registered: true,
          approvalStatus: "approved"
        },
        status: "accepted",
        manualReview: {
          status: "approved",
          categories: [{ id: "composition", status: "approved" }]
        }
      }
    };
    await Promise.all([
      ...Object.entries(artifacts).map(([name, value]) => writeFile(
        resolve(temporaryQaDirectory, name),
        `${JSON.stringify(value)}\n`,
        "utf8"
      )),
      writeFile(
        resolve(temporaryQaDirectory, "QA-REPORT.md"),
        "# 横版完整视频 v907 · 视觉 QA 报告\n\napproved\n",
        "utf8"
      )
    ]);
    await assert.rejects(
      validateLongReviewAnalyzerArtifacts({
        qaDirectory: temporaryQaDirectory,
        contract,
        candidateManifestBinding: binding,
        sourceVideo,
        sourceManifest,
        sourcePublicationReceipt,
        publicationReceiptBinding
      }),
      /pending 绑定/u
    );
    await assert.rejects(lstat(finalQaDirectory), { code: "ENOENT" });

    const pendingSummary = {
      schemaVersion: "agent-skill-long-review-qa-summary-v1",
      candidateVersion: 907,
      candidate: {
        video: sourceVideo,
        manifest: sourceManifest,
        registered: false,
        approvalStatus: "not_approved"
      },
      status: "pending_manual_visual_review",
      automatedChecks: {
        singleFrameAbaLayerDropout: {
          status: "pass",
          blockingEventCount: 0,
          informationalEventCount: 0
        }
      },
      manualReview: {
        status: "pending",
        categories: [{ id: "composition", status: "pending" }]
      }
    };
    await Promise.all([
      writeFile(
        resolve(temporaryQaDirectory, "qa-summary.json"),
        `${JSON.stringify(pendingSummary)}\n`,
        "utf8"
      ),
      writeFile(
        resolve(temporaryQaDirectory, "QA-REPORT.md"),
        "# 横版完整视频 v907 · 视觉 QA 报告\n\n待人工视觉审查。本报告不代表视觉批准。\n",
        "utf8"
      )
    ]);
    assert.equal((await validateLongReviewAnalyzerArtifacts({
      qaDirectory: temporaryQaDirectory,
      contract,
      candidateManifestBinding: binding,
      sourceVideo,
      sourceManifest,
      sourcePublicationReceipt,
      publicationReceiptBinding
    })).passed, true);

    const blockingLayerDropout = {
      ...artifacts["single-frame-aba-layer-dropout.json"],
      status: "fail",
      blockingEventCount: 1,
      blockingEvents: [{
        detectorPattern: "A-B-A",
        classification: "blocking_single_frame_aba_layer_dropout",
        frameA: 10,
        frameB: 11,
        frameC: 12
      }]
    };
    const blockingEvidencePlan = {
      ...artifacts["single-frame-aba-layer-dropout-evidence-plan.json"],
      totalBlockingEventCount: 1,
      recordedBlockingEventCount: 1,
      exactFrameNumbers: [10, 11, 12],
      events: [{
        eventIndex: 0,
        classification: "blocking_single_frame_aba_layer_dropout",
        centerFrame: 11,
        exactFrames: [
          { role: "A-before", frame: 10 },
          { role: "B-dropout", frame: 11 },
          { role: "A-after", frame: 12 }
        ],
        metrics: {}
      }]
    };
    const blockingSummary = {
      ...pendingSummary,
      status: "blocking_visual_integrity_issue",
      automatedChecks: {
        singleFrameAbaLayerDropout: {
          status: "fail",
          blockingEventCount: 1,
          informationalEventCount: 0
        }
      }
    };
    await Promise.all([
      writeFile(
        resolve(temporaryQaDirectory, "single-frame-aba-layer-dropout.json"),
        `${JSON.stringify(blockingLayerDropout)}\n`,
        "utf8"
      ),
      writeFile(
        resolve(
          temporaryQaDirectory,
          "single-frame-aba-layer-dropout-evidence-plan.json"
        ),
        `${JSON.stringify(blockingEvidencePlan)}\n`,
        "utf8"
      ),
      writeFile(
        resolve(temporaryQaDirectory, "qa-summary.json"),
        `${JSON.stringify(blockingSummary)}\n`,
        "utf8"
      )
    ]);
    assert.equal((await validateLongReviewAnalyzerArtifacts({
      qaDirectory: temporaryQaDirectory,
      contract,
      candidateManifestBinding: binding,
      sourceVideo,
      sourceManifest,
      sourcePublicationReceipt,
      publicationReceiptBinding
    })).passed, true);
    await assert.rejects(lstat(finalQaDirectory), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generic QA package command is wired and help does not claim v004-only support", async () => {
  const packageJson = JSON.parse(await readFile(resolve(STUDIO_ROOT, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["qa:long-review"],
    "node scripts/qa-agent-skill-long-review.mjs"
  );
  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/qa-agent-skill-long-review.mjs", "--help"],
    { cwd: STUDIO_ROOT, encoding: "utf8" }
  );
  assert.match(stdout, /--job-config/u);
  assert.match(stdout, /not human visual acceptance/u);
  assert.doesNotMatch(stdout, /v004/iu);
});

test("published single-frame layer-dropout evidence remains durable before CLI exits non-zero", async () => {
  const qaDirectory = resolve(
    WORKSPACE_ROOT,
    "outputs",
    `.qa-published-layer-dropout-${randomUUID()}`
  );
  const sourceVideo = {
    path: "fixture/review-10m.mp4",
    bytes: 1_024,
    sha256: "a".repeat(64)
  };
  const analysis = {
    schemaVersion: "single-frame-aba-layer-dropout-analysis-v1",
    detectorScope: "single-frame A-B-A layer-dropout only",
    candidateVersion: 13,
    sourceVideo,
    status: "fail",
    blockingEventCount: 1,
    informationalEventCount: 0,
    blockingEvents: [{
      detectorPattern: "A-B-A",
      classification: "blocking_single_frame_aba_layer_dropout",
      frameA: 67,
      frameB: 68,
      frameC: 69
    }],
    automaticFrameRepairAttempted: false
  };
  const evidence = {
    schemaVersion: "single-frame-aba-layer-dropout-evidence-plan-v1",
    candidateVersion: 13,
    sourceVideo,
    totalBlockingEventCount: 1,
    recordedBlockingEventCount: 1,
    exactFrameNumbers: [67, 68, 69],
    events: [{
      eventIndex: 0,
      classification: "blocking_single_frame_aba_layer_dropout",
      centerFrame: 68,
      exactFrames: [
        { role: "A-before", frame: 67 },
        { role: "B-dropout", frame: 68 },
        { role: "A-after", frame: 69 }
      ],
      metrics: {}
    }],
    automaticFrameRepairAttempted: false
  };
  const summary = {
    status: "blocking_visual_integrity_issue",
    automatedChecks: {
      singleFrameAbaLayerDropout: {
        status: "fail",
        blockingEventCount: 1,
        informationalEventCount: 0
      }
    }
  };
  try {
    await mkdir(qaDirectory, { recursive: true });
    const payloads = new Map([
      ["single-frame-aba-layer-dropout.json", analysis],
      ["single-frame-aba-layer-dropout-evidence-plan.json", evidence],
      ["qa-summary.json", summary]
    ]);
    await Promise.all([...payloads].map(([name, payload]) => writeFile(
      resolve(qaDirectory, name),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8"
    )));
    const artifacts = [];
    for (const name of payloads.keys()) {
      artifacts.push({ name, ...await fileIntegrity(resolve(qaDirectory, name)) });
    }
    await writeFile(
      resolve(qaDirectory, "artifact-index.json"),
      `${JSON.stringify({
        schemaVersion: "fixture-artifact-index-v1",
        artifacts: artifacts.map(({ name, ...integrity }) => ({
          path: name,
          ...integrity
        }))
      }, null, 2)}\n`,
      "utf8"
    );
    const indexedFiles = [...payloads.keys(), "artifact-index.json"];
    const integrityBefore = new Map();
    for (const name of indexedFiles) {
      integrityBefore.set(name, await fileIntegrity(resolve(qaDirectory, name)));
    }
    await writeFile(
      resolve(qaDirectory, "qa-artifacts.sha256"),
      `${indexedFiles.map((name) =>
        `${integrityBefore.get(name).sha256}  ${name}`
      ).join("\n")}\n`,
      "utf8"
    );
    integrityBefore.set(
      "qa-artifacts.sha256",
      await fileIntegrity(resolve(qaDirectory, "qa-artifacts.sha256"))
    );

    await assert.rejects(
      execFileAsync(process.execPath, [
        resolve(
          STUDIO_ROOT,
          "tests/helpers/long-review-layer-dropout-cli-fixture.mjs"
        ),
        qaDirectory
      ]),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /single-frame A-B-A layer-dropout gate failed/u);
        return true;
      }
    );
    for (const [name, expected] of integrityBefore) {
      assert.deepEqual(
        await fileIntegrity(resolve(qaDirectory, name)),
        expected,
        `${name} must remain unchanged after the blocking CLI exit`
      );
    }
    assert.equal(
      (await readdir(qaDirectory)).some((name) => name.endsWith(".incomplete.json")),
      false
    );
  } finally {
    await rm(qaDirectory, { recursive: true, force: true });
  }
});
