import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {basename} from "node:path";
import test from "node:test";

import {
  V004B_FINAL_CANDIDATE_IDENTITY,
  V004B_FINAL_PATHS,
  V004B_FINAL_SCHEMA_VERSION,
} from "../scripts/build-agent-skill-v004b-no-box-final.mjs";
import {
  V004B_FORMAL_REBIND_PATHS,
  buildReboundFormalManifest,
  parseRebindCliArguments,
  rebindUsageText,
  validateReboundFormalManifest,
  validateReboundPublicationBinding,
  validateSourceCandidateBinding,
} from "../scripts/rebind-agent-skill-v004b-no-box-formal-v001.mjs";


function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}


function jsonIntegrity(value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  return {bytes: bytes.length, sha256: sha256(bytes)};
}


function sourceFixture() {
  const videoIntegrity = {bytes: 52_206_631, sha256: "a".repeat(64)};
  const runFingerprint = "b".repeat(64);
  const chunks = Array.from({length: 20}, (_, index) => {
    const startFrame = index * 900;
    return {
      schemaVersion: "agent-skill-v004b-no-box-overlay-chunk-v1",
      runFingerprint,
      range: {
        index,
        startFrame,
        endFrameExclusive: startFrame + 900,
        endFrameInclusive: startFrame + 899,
        frameCount: 900,
      },
      file: {bytes: 1_000 + index, sha256: String(index).padStart(64, "0")},
      decoding: {videoDecodedWithoutError: true},
    };
  });
  const manifest = {
    schemaVersion: V004B_FINAL_SCHEMA_VERSION,
    status: "machine-validated-awaiting-visual-qa",
    reviewStatus: "formal-candidate-awaiting-continuous-1x-visual-qa",
    completedAt: "2026-09-02T11:30:00.000Z",
    runFingerprint,
    renderJob: {
      jobId:
        "agent-skill-20260806-current-visual-upgrade-v014-v004b-no-box-v001",
      candidateVersion: 14,
    },
    contract: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 18_000,
      durationSeconds: 600,
      episodeId: "agent-skill-20260806",
      compositionId: "AgentSkillLongReview",
      artifactRole: "formal-candidate",
      formalCandidate: true,
      visualSource: "v013@980c4f4be9c1f0bccdcd546873fa1a877c98aac8",
      subtitleStyle: "v004b-no-box",
      subtitleDelivery: "external-overlay-applied",
      burnInSubtitle: false,
      voice: "v004-full",
      voiceIsTemporary: true,
      finalHumanRecording: false,
    },
    renderBase: {
      artifactRole: "render-base",
      formalCandidate: false,
      subtitleDelivery: "external-overlay-required",
      sha256: "c".repeat(64),
      manifestSha256: "d".repeat(64),
      durableReceiptSha256: "e".repeat(64),
    },
    chunks,
    finalMedia: {
      schemaVersion: "agent-skill-v004b-no-box-final-media-v1",
      runFingerprint,
      file: {path: "/old/work/review-10m.mp4", ...videoIntegrity},
      decoding: {
        videoDecodedWithoutError: true,
        audioDecodedWithoutError: true,
      },
      published: {path: V004B_FORMAL_REBIND_PATHS.sourceVideo, ...videoIntegrity},
    },
    publication: {
      atomicDirectoryRename: true,
      nonOverwriting: true,
      outputPath: V004B_FORMAL_REBIND_PATHS.sourceVideo,
    },
    prohibitions: {oldOutputsOverwritten: false},
  };
  const manifestIntegrity = jsonIntegrity(manifest);
  const jobBinding = {
    finalManifestSchemaVersion: manifest.schemaVersion,
    runFingerprint,
    jobId: manifest.renderJob.jobId,
    candidateVersion: manifest.renderJob.candidateVersion,
    episodeId: manifest.contract.episodeId,
    compositionId: manifest.contract.compositionId,
  };
  const receipt = {
    schemaVersion: "agent-skill-v004b-no-box-publication-state-v1",
    kind: "durable_receipt",
    attemptToken: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    output: {fileName: "review-10m.mp4", ...videoIntegrity},
    manifest: {
      fileName: "review-manifest.json",
      sha256: manifestIntegrity.sha256,
    },
    jobBinding,
    jobBindingSha256: sha256(JSON.stringify(stableValue(jobBinding))),
    recordedAt: "2026-09-02T11:30:30.000Z",
  };
  const receiptIntegrity = jsonIntegrity(receipt);
  return {
    videoIntegrity,
    manifest,
    manifestIntegrity,
    receipt,
    receiptIntegrity,
  };
}


function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}


test("正式 v004b builder 将 v014 保留为 render-base provenance，候选版本固定为 v001", async () => {
  assert.deepEqual(V004B_FINAL_CANDIDATE_IDENTITY, {
    directoryName:
      "full-video-current-visual-upgrade-v014-natural-technical-v004b-no-box-formal-v001",
    jobId:
      "agent-skill-20260806-current-visual-upgrade-v014-v004b-no-box-formal-v001",
    candidateVersion: 1,
    renderBaseCandidateVersion: 14,
  });
  assert.equal(
    basename(V004B_FINAL_PATHS.outputDirectory),
    V004B_FINAL_CANDIDATE_IDENTITY.directoryName,
  );
  assert.equal(
    V004B_FORMAL_REBIND_PATHS.workDirectory,
    V004B_FINAL_PATHS.workDirectory,
  );
  assert.equal(
    basename(V004B_FORMAL_REBIND_PATHS.workDirectory),
    `.${V004B_FINAL_CANDIDATE_IDENTITY.directoryName}-work`,
  );
  const builder = await readFile(
    new URL("../scripts/build-agent-skill-v004b-no-box-final.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    builder,
    /candidateVersion: V004B_FINAL_CANDIDATE_VERSION/u,
  );
  assert.match(builder, /jobId: baseBinding\.manifest\.renderJob\.jobId/u);
  assert.match(
    builder,
    /candidateVersion: baseBinding\.manifest\.renderJob\.candidateVersion/u,
  );
});


test("源候选必须由固定 MP4、manifest、durable receipt 三方哈希与旧误标绑定", () => {
  const fixture = sourceFixture();
  const result = validateSourceCandidateBinding({
    ...fixture,
    expectedVideoSha256: fixture.videoIntegrity.sha256,
    expectedManifestSha256: fixture.manifestIntegrity.sha256,
    expectedReceiptSha256: fixture.receiptIntegrity.sha256,
  });
  assert.equal(result.passed, true);
  assert.equal(result.sourceJobBinding.candidateVersion, 14);

  assert.throws(
    () =>
      validateSourceCandidateBinding({
        ...fixture,
        expectedVideoSha256: fixture.videoIntegrity.sha256,
        expectedManifestSha256: fixture.manifestIntegrity.sha256,
        expectedReceiptSha256: "f".repeat(64),
      }),
    /expectedReceiptSha/u,
  );
  const drifted = structuredClone(fixture);
  drifted.manifest.finalMedia.published.path = "/wrong/review-10m.mp4";
  assert.throws(
    () =>
      validateSourceCandidateBinding({
        ...drifted,
        expectedVideoSha256: fixture.videoIntegrity.sha256,
        expectedManifestSha256: fixture.manifestIntegrity.sha256,
        expectedReceiptSha256: fixture.receiptIntegrity.sha256,
      }),
    /publishedPath/u,
  );
});


test("rebind 只改正式身份和发布路径，保留相同媒体、run fingerprint 与20段证据", () => {
  const fixture = sourceFixture();
  const sourceBefore = JSON.stringify(fixture.manifest);
  const verification = {
    validatedAt: "2026-09-02T12:00:00.000Z",
    ffprobe: {path: "/tool/ffprobe", version: "ffprobe 9", checks: {ok: true}},
    ffmpeg: {path: "/tool/ffmpeg", version: "ffmpeg 9"},
    probeSha256: "f".repeat(64),
    fullDecode: {
      videoDecodedWithoutError: true,
      audioDecodedWithoutError: true,
      videoMode: "sequential-rawvideo-null",
      audioMode: "sequential-pcm-s16le-null",
    },
  };
  const manifest = buildReboundFormalManifest({
    sourceManifest: fixture.manifest,
    sourceVideoIntegrity: fixture.videoIntegrity,
    sourceManifestIntegrity: fixture.manifestIntegrity,
    sourceReceiptIntegrity: fixture.receiptIntegrity,
    rebinderIntegrity: {bytes: 1234, sha256: "9".repeat(64)},
    verification,
    completedAt: verification.validatedAt,
  });
  assert.equal(JSON.stringify(fixture.manifest), sourceBefore);
  assert.equal(manifest.renderJob.candidateVersion, 1);
  assert.equal(manifest.renderJob.jobId.endsWith("-v001"), true);
  assert.equal(manifest.runFingerprint, fixture.manifest.runFingerprint);
  assert.deepEqual(manifest.chunks, fixture.manifest.chunks);
  assert.equal(manifest.finalMedia.published.sha256, fixture.videoIntegrity.sha256);
  assert.equal(manifest.renderBase.candidateVersion, 14);
  assert.equal(
    manifest.renderBase.jobId,
    "agent-skill-20260806-current-visual-upgrade-render-base-v014",
  );
  assert.equal(
    manifest.republication.sourceArtifact.manifest.sha256,
    fixture.manifestIntegrity.sha256,
  );
  assert.equal(
    manifest.republication.sourceArtifact.durableReceipt.sha256,
    fixture.receiptIntegrity.sha256,
  );
  assert.equal(manifest.republication.mediaReencoded, false);
  assert.equal(
    validateReboundFormalManifest({
      manifest,
      sourceManifest: fixture.manifest,
      sourceVideoIntegrity: fixture.videoIntegrity,
      sourceManifestIntegrity: fixture.manifestIntegrity,
      sourceReceiptIntegrity: fixture.receiptIntegrity,
    }).passed,
    true,
  );

  manifest.finalMedia.published.sha256 = "0".repeat(64);
  assert.throws(
    () =>
      validateReboundFormalManifest({
        manifest,
        sourceManifest: fixture.manifest,
        sourceVideoIntegrity: fixture.videoIntegrity,
        sourceManifestIntegrity: fixture.manifestIntegrity,
        sourceReceiptIntegrity: fixture.receiptIntegrity,
      }),
    /targetPublished/u,
  );
});


test("新 manifest 与 durable receipt 必须绑定 formal-v001 published path 和相同 MP4 字节", () => {
  const fixture = sourceFixture();
  const verification = {
    validatedAt: "2026-09-02T12:00:00.000Z",
    ffprobe: {path: "/tool/ffprobe", version: "ffprobe 9", checks: {ok: true}},
    ffmpeg: {path: "/tool/ffmpeg", version: "ffmpeg 9"},
    probeSha256: "f".repeat(64),
    fullDecode: {
      videoDecodedWithoutError: true,
      audioDecodedWithoutError: true,
    },
  };
  const manifest = buildReboundFormalManifest({
    sourceManifest: fixture.manifest,
    sourceVideoIntegrity: fixture.videoIntegrity,
    sourceManifestIntegrity: fixture.manifestIntegrity,
    sourceReceiptIntegrity: fixture.receiptIntegrity,
    rebinderIntegrity: {bytes: 1234, sha256: "9".repeat(64)},
    verification,
    completedAt: verification.validatedAt,
  });
  const manifestIntegrity = jsonIntegrity(manifest);
  const jobBinding = {
    finalManifestSchemaVersion: manifest.schemaVersion,
    runFingerprint: manifest.runFingerprint,
    jobId: manifest.renderJob.jobId,
    candidateVersion: manifest.renderJob.candidateVersion,
    episodeId: manifest.contract.episodeId,
    compositionId: manifest.contract.compositionId,
  };
  const receipt = {
    schemaVersion: "agent-skill-v004b-no-box-publication-state-v1",
    kind: "durable_receipt",
    attemptToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    output: {fileName: "review-10m.mp4", ...fixture.videoIntegrity},
    manifest: {
      fileName: "review-manifest.json",
      sha256: manifestIntegrity.sha256,
    },
    jobBinding,
    jobBindingSha256: sha256(JSON.stringify(stableValue(jobBinding))),
    recordedAt: "2026-09-02T12:00:01.000Z",
  };
  assert.equal(
    validateReboundPublicationBinding({
      manifest,
      receipt,
      videoIntegrity: fixture.videoIntegrity,
      manifestIntegrity,
      expectedManifest: manifest,
      sourceManifest: fixture.manifest,
      sourceVideoIntegrity: fixture.videoIntegrity,
      sourceManifestIntegrity: fixture.manifestIntegrity,
      sourceReceiptIntegrity: fixture.receiptIntegrity,
    }).passed,
    true,
  );

  receipt.jobBinding.candidateVersion = 14;
  assert.throws(
    () =>
      validateReboundPublicationBinding({
        manifest,
        receipt,
        videoIntegrity: fixture.videoIntegrity,
        manifestIntegrity,
        expectedManifest: manifest,
        sourceManifest: fixture.manifest,
        sourceVideoIntegrity: fixture.videoIntegrity,
        sourceManifestIntegrity: fixture.manifestIntegrity,
        sourceReceiptIntegrity: fixture.receiptIntegrity,
      }),
    /receiptJobBinding/u,
  );
});


test("rebind CLI 强制三项源哈希，且实现只完整验证和字节复制，不包含媒体编码", async () => {
  const options = parseRebindCliArguments([
    `--expected-source-video-sha256=${"a".repeat(64)}`,
    `--expected-source-manifest-sha256=${"b".repeat(64)}`,
    `--expected-source-receipt-sha256=${"c".repeat(64)}`,
    "--ffmpeg=/tool/ffmpeg",
    "--ffprobe=/tool/ffprobe",
    "--dry-run",
  ]);
  assert.equal(options.expectedSourceVideoSha256, "a".repeat(64));
  assert.equal(options.expectedSourceManifestSha256, "b".repeat(64));
  assert.equal(options.expectedSourceReceiptSha256, "c".repeat(64));
  assert.equal(options.dryRun, true);
  assert.match(rebindUsageText(), /byte-identical copy/u);
  assert.match(rebindUsageText(), /taskpolicy -b/u);
  const source = await readFile(
    new URL(
      "../scripts/rebind-agent-skill-v004b-no-box-formal-v001.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /decodeVideo\(ffmpeg/u);
  assert.match(source, /decodeAudio\(ffmpeg/u);
  assert.match(source, /publishFinalCandidateAtomically/u);
  assert.doesNotMatch(source, /libx264|buildOverlayChunkFfmpegArgs|buildAudioMuxFfmpegArgs/u);
});
