import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const V004B_FORMAL_QA_PROFILE = Object.freeze({
  schemaVersion: "agent-skill-v004b-no-box-formal-qa-profile-v2",
  jobId:
    "agent-skill-20260806-current-visual-upgrade-v014-v004b-no-box-formal-v001",
  candidateVersion: 1,
  manifestSchemaVersion: "agent-skill-v013-v004b-no-box-final-candidate-v1",
  receiptSchemaVersion: "agent-skill-v004b-no-box-publication-state-v1",
  finalMediaSchemaVersion: "agent-skill-v004b-no-box-final-media-v1",
  rebindSchemaVersion:
    "agent-skill-v004b-no-box-formal-candidate-rebind-v1",
  rebindRunner:
    "studio/scripts/rebind-agent-skill-v004b-no-box-formal-v001.mjs",
  rebindRunnerBytes: 31_339,
  rebindRunnerSha256:
    "42bf2035305463d3f5d627fe8ad81c3803d72611115526d180796e58a86c7b2b",
  visualSource: "v013@980c4f4be9c1f0bccdcd546873fa1a877c98aac8",
  sourceCandidateDirectoryName:
    "full-video-current-visual-upgrade-v014-natural-technical-v004b-no-box-v001",
  sourceCandidateJobId:
    "agent-skill-20260806-current-visual-upgrade-v014-v004b-no-box-v001",
  sourceCandidateMistaggedVersion: 14,
  sourceCandidateVideoBytes: 52_206_631,
  sourceCandidateVideoSha256:
    "b7e3a84b97c939ce2ee9972e06dfd5a6026aa0c7e1cabcdebfac7db64f03fa51",
  sourceCandidateManifestBytes: 44_429,
  sourceCandidateManifestSha256:
    "4a42a675e17a90de8aaf560f5e70448533335cc0e18636dc00b4474ab254c21d",
  sourceCandidateReceiptBytes: 986,
  sourceCandidateReceiptSha256:
    "6bf96e95fbe9c57721c405a8fcaa3756b538204d85ec375168f191eeb87acb4d",
  historicalBuilderBytes: 69_357,
  historicalBuilderSha256:
    "25cc86c5d8e7e17f545fb0eb2a822a3ea96c1d2ed068daf089468185c4d0ae58",
  renderBaseDirectoryName: "full-video-current-visual-upgrade-render-base-v014",
  renderBaseJobId:
    "agent-skill-20260806-current-visual-upgrade-render-base-v014",
  renderBaseCandidateVersion: 14,
  renderBaseVideoSha256:
    "07be95d120b8ce5d9d6bb37b42d05cce4ef3b01a7610312cc19f2d6adb5fefe3",
  renderBaseManifestSha256:
    "6cbcacf41324c4b49618baa1fd3506305ec3bc916a5ef0162b8ae4dd86a082f1",
  renderBaseReceiptSha256:
    "476dee2c32063b08364d8e5054d2f8b5f92c9193e3a80c161129711641ec60ae",
  overlayManifestSha256:
    "194d3ec6e00725ad3d0a1477522d3edfc07e67c17f4aec21d26060f215206d50",
  timelineSha256:
    "1a4fc03ab45ef2ca49c8e0e1cd0132c32ae6baddc723539eba3a7e001842f265",
  temporaryVoiceSha256:
    "438e2cf9b1b3a4fc4b029d1b8349018f5d47c984d03ce9a4c22c98cb1eb680c7",
  titleFirstOffsetsInFrames: Object.freeze([0, 6, 15, 30, 45, 60]),
  boundaryOffsetsInFrames: Object.freeze([-8, -1, 0, 1, 8]),
  chunkDurationInFrames: 900,
  chunkSeamOffsetsInFrames: Object.freeze([-8, -1, 0, 1, 8]),
  watermarkCadenceId: "continuous",
  watermarkCycleInFrames: 120,
  watermarkMotionSampleOffsetsInFrames: Object.freeze([
    0, 15, 30, 45, 60, 75, 90, 105, 119, 120
  ]),
  watermarkCropPixels: Object.freeze({
    left: 1760,
    top: 40,
    width: 120,
    height: 120
  }),
  watermarkMotionProofSchemaVersion:
    "agent-skill-v004b-watermark-motion-proof-v1",
  watermarkMinimumDistinctCropHashCount: 5,
  watermarkMinimumMateriallyChangedPhaseCount: 4,
  watermarkMaterialChangeDhashHammingMinimum: 128,
  watermarkCycleReturnDhashHammingMaximum: 96,
  finalTailOffsetsInFrames: Object.freeze([-120, -60, -30, -15, -1, 0]),
  sequentialExtractionBatchSize: 24,
  expectedFullSampleCount: 441,
  expectedPeriodicSampleCount: 301,
  expectedEvidenceFrameCount: 742,
  expectedContactSheetCount: 32
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

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

function hasExactKeys(value, keys) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    stableStringify(Object.keys(value).sort()) === stableStringify([...keys].sort())
  );
}

function exactPath(value, expected) {
  return typeof value === "string" && resolve(value) === resolve(expected);
}

function chunkChecks(chunks, runFingerprint) {
  if (!Array.isArray(chunks) || chunks.length !== 20) return false;
  return chunks.every((chunk, index) => {
    const startFrame = index * V004B_FORMAL_QA_PROFILE.chunkDurationInFrames;
    const expectedRange = {
      index,
      startFrame,
      endFrameExclusive:
        startFrame + V004B_FORMAL_QA_PROFILE.chunkDurationInFrames,
      endFrameInclusive:
        startFrame + V004B_FORMAL_QA_PROFILE.chunkDurationInFrames - 1,
      frameCount: V004B_FORMAL_QA_PROFILE.chunkDurationInFrames
    };
    return chunk?.schemaVersion === "agent-skill-v004b-no-box-overlay-chunk-v1" &&
      chunk?.runFingerprint === runFingerprint &&
      stableStringify(chunk?.range) === stableStringify(expectedRange) &&
      Number.isSafeInteger(chunk?.file?.bytes) &&
      chunk.file.bytes > 0 &&
      SHA256_PATTERN.test(chunk?.file?.sha256 ?? "") &&
      chunk?.decoding?.videoDecodedWithoutError === true;
  });
}

export function isV004bFormalQaJob(job) {
  return job?.jobId === V004B_FORMAL_QA_PROFILE.jobId &&
    job?.candidateVersion === V004B_FORMAL_QA_PROFILE.candidateVersion &&
    job?.episodeId === "agent-skill-20260806" &&
    job?.compositionId === "AgentSkillLongReview" &&
    job?.paths?.runner === V004B_FORMAL_QA_PROFILE.rebindRunner &&
    job?.paths?.episode ===
      "studio/data/render-inputs/full-v004b-attempt-001/episode.json" &&
    job?.paths?.voice ===
      "studio/public/episodes/agent-skill-20260806/voice-natural-technical-v004-full.wav" &&
    job?.paths?.finalDirectory ===
      "outputs/studio/agent-skill-20260806/review-candidates/" +
      "full-video-current-visual-upgrade-v014-natural-technical-v004b-no-box-formal-v001" &&
    job?.paths?.workDirectory ===
      "outputs/studio/agent-skill-20260806/review-candidates/" +
      ".full-video-current-visual-upgrade-v014-natural-technical-v004b-no-box-formal-v001-work" &&
    job?.temporaryVoice === true &&
    job?.temporaryVoiceIsFinalHumanRecording === false;
}

export function validateV004bFormalCandidateManifest({
  manifest,
  job,
  videoIntegrity,
  videoPath
}) {
  if (!isV004bFormalQaJob(job) || !job?.resolvedPaths) {
    throw new TypeError("the exact v004b formal QA render job is required");
  }
  const expectedVideoPath = resolve(job.resolvedPaths.finalDirectory, "review-10m.mp4");
  const expectedRenderBaseDirectory = resolve(
    job.resolvedPaths.finalDirectory,
    "..",
    V004B_FORMAL_QA_PROFILE.renderBaseDirectoryName
  );
  const expectedSourceCandidateDirectory = resolve(
    job.resolvedPaths.finalDirectory,
    "..",
    V004B_FORMAL_QA_PROFILE.sourceCandidateDirectoryName
  );
  const expectedSourceVideoPath = resolve(
    expectedSourceCandidateDirectory,
    "review-10m.mp4"
  );
  const expectedSourceManifestPath = resolve(
    expectedSourceCandidateDirectory,
    "review-manifest.json"
  );
  const expectedSourceReceiptPath = resolve(
    expectedSourceCandidateDirectory,
    "publication-durable-receipt.json"
  );
  const published = manifest?.finalMedia?.published;
  const contract = manifest?.contract;
  const renderBase = manifest?.renderBase;
  const republication = manifest?.republication;
  const sourceArtifact = republication?.sourceArtifact;
  const rebinder = republication?.rebinder;
  const verification = republication?.verification;
  const ffprobeChecks = verification?.ffprobe?.checks;
  const checks = {
    finalManifestSchema:
      manifest?.schemaVersion === V004B_FORMAL_QA_PROFILE.manifestSchemaVersion,
    status:
      manifest?.status === "machine-validated-awaiting-visual-qa" &&
      manifest?.reviewStatus ===
        "formal-candidate-awaiting-continuous-1x-visual-qa",
    runFingerprint: SHA256_PATTERN.test(manifest?.runFingerprint ?? ""),
    finalMediaRunFingerprint:
      manifest?.finalMedia?.runFingerprint === manifest?.runFingerprint,
    formalJobId: manifest?.renderJob?.jobId === job.jobId,
    formalCandidateVersion:
      manifest?.renderJob?.candidateVersion === job.candidateVersion &&
      job.candidateVersion === 1,
    episodeAndComposition:
      contract?.episodeId === job.episodeId &&
      contract?.compositionId === job.compositionId,
    mediaContract:
      contract?.width === job.width &&
      contract?.height === job.height &&
      contract?.fps === job.fps &&
      contract?.durationSeconds === 600 &&
      contract?.durationInFrames === job.durationInFrames &&
      contract?.videoCodec === "h264" &&
      contract?.pixelFormat === "yuv420p" &&
      contract?.audioCodec === "aac" &&
      contract?.audioSampleRate === 48_000 &&
      contract?.audioChannels === 1,
    formalCandidateRole:
      contract?.artifactRole === "formal-candidate" &&
      contract?.formalCandidate === true &&
      contract?.machineValidation === true &&
      contract?.humanVisualApproval === false &&
      contract?.continuousOneXWatchCompleted === false &&
      contract?.acceptedForRelease === false,
    visualSource:
      contract?.visualSource === V004B_FORMAL_QA_PROFILE.visualSource,
    renderBaseIsSeparateProvenance:
      renderBase?.artifactRole === "render-base" &&
      renderBase?.formalCandidate === false &&
      renderBase?.jobId === V004B_FORMAL_QA_PROFILE.renderBaseJobId &&
      renderBase?.candidateVersion ===
        V004B_FORMAL_QA_PROFILE.renderBaseCandidateVersion &&
      renderBase?.subtitleDelivery === "external-overlay-required" &&
      exactPath(renderBase?.path, resolve(expectedRenderBaseDirectory, "review-10m.mp4")) &&
      exactPath(
        renderBase?.manifestPath,
        resolve(expectedRenderBaseDirectory, "review-manifest.json")
      ) &&
      exactPath(
        renderBase?.durableReceiptPath,
        resolve(expectedRenderBaseDirectory, "publication-durable-receipt.json")
      ) &&
      renderBase?.sha256 === V004B_FORMAL_QA_PROFILE.renderBaseVideoSha256 &&
      renderBase?.manifestSha256 ===
        V004B_FORMAL_QA_PROFILE.renderBaseManifestSha256 &&
      renderBase?.durableReceiptSha256 ===
        V004B_FORMAL_QA_PROFILE.renderBaseReceiptSha256,
    byteIdenticalRepublication:
      republication?.schemaVersion ===
        V004B_FORMAL_QA_PROFILE.rebindSchemaVersion &&
      republication?.method === "byte-identical-copy-no-reencode" &&
      republication?.sourceCandidatePreserved === true &&
      republication?.mediaReencoded === false,
    sourceCandidateDirectory:
      exactPath(sourceArtifact?.directory, expectedSourceCandidateDirectory),
    sourceCandidateVideo:
      exactPath(sourceArtifact?.video?.path, expectedSourceVideoPath) &&
      sourceArtifact?.video?.bytes ===
        V004B_FORMAL_QA_PROFILE.sourceCandidateVideoBytes &&
      sourceArtifact?.video?.sha256 ===
        V004B_FORMAL_QA_PROFILE.sourceCandidateVideoSha256,
    sourceCandidateManifest:
      exactPath(sourceArtifact?.manifest?.path, expectedSourceManifestPath) &&
      sourceArtifact?.manifest?.bytes ===
        V004B_FORMAL_QA_PROFILE.sourceCandidateManifestBytes &&
      sourceArtifact?.manifest?.sha256 ===
        V004B_FORMAL_QA_PROFILE.sourceCandidateManifestSha256,
    sourceCandidateReceipt:
      exactPath(sourceArtifact?.durableReceipt?.path, expectedSourceReceiptPath) &&
      sourceArtifact?.durableReceipt?.bytes ===
        V004B_FORMAL_QA_PROFILE.sourceCandidateReceiptBytes &&
      sourceArtifact?.durableReceipt?.sha256 ===
        V004B_FORMAL_QA_PROFILE.sourceCandidateReceiptSha256,
    republicationVersionBinding:
      republication?.versionBinding?.sourceMistaggedCandidateVersion ===
        V004B_FORMAL_QA_PROFILE.sourceCandidateMistaggedVersion &&
      republication?.versionBinding?.formalCandidateVersion === 1 &&
      republication?.versionBinding?.renderBaseCandidateVersion ===
        V004B_FORMAL_QA_PROFILE.renderBaseCandidateVersion &&
      republication?.versionBinding?.formalJobId === job.jobId,
    frozenHistoricalBuilder:
      manifest?.builder?.bytes ===
        V004B_FORMAL_QA_PROFILE.historicalBuilderBytes &&
      manifest?.builder?.sha256 ===
        V004B_FORMAL_QA_PROFILE.historicalBuilderSha256,
    frozenRebinder:
      exactPath(rebinder?.path, job.resolvedPaths.runner) &&
      rebinder?.bytes === V004B_FORMAL_QA_PROFILE.rebindRunnerBytes &&
      rebinder?.sha256 === V004B_FORMAL_QA_PROFILE.rebindRunnerSha256,
    freshRepublicationVerification:
      typeof verification?.validatedAt === "string" &&
      !Number.isNaN(Date.parse(verification.validatedAt)) &&
      SHA256_PATTERN.test(verification?.probeSha256 ?? "") &&
      ffprobeChecks &&
      typeof ffprobeChecks === "object" &&
      Object.keys(ffprobeChecks).length > 0 &&
      Object.values(ffprobeChecks).every((passed) => passed === true) &&
      verification?.fullDecode?.videoDecodedWithoutError === true &&
      verification?.fullDecode?.audioDecodedWithoutError === true &&
      verification?.fullDecode?.videoMode === "sequential-rawvideo-null" &&
      verification?.fullDecode?.audioMode === "sequential-pcm-s16le-null",
    sourceAndFormalMediaAreByteIdentical:
      sourceArtifact?.video?.bytes === videoIntegrity?.bytes &&
      sourceArtifact?.video?.sha256 === videoIntegrity?.sha256,
    noBoxSubtitle:
      contract?.subtitleStyle === "v004b-no-box" &&
      contract?.subtitleDelivery === "external-overlay-applied" &&
      contract?.burnInSubtitle === false &&
      contract?.overlayEncoding === "20x900-frame-serial",
    serialChunks:
      contract?.chunkFrames === 900 &&
      contract?.chunkCount === 20 &&
      contract?.concurrency === 1 &&
      chunkChecks(manifest?.chunks, manifest?.runFingerprint),
    temporaryVoiceDisclosure:
      contract?.voice === "v004-full" &&
      contract?.voiceIsTemporary === true &&
      contract?.finalHumanRecording === false &&
      manifest?.voice?.profile === "v004-full" &&
      manifest?.voice?.temporary === true &&
      manifest?.voice?.finalHumanRecording === false &&
      manifest?.voice?.sha256 === V004B_FORMAL_QA_PROFILE.temporaryVoiceSha256 &&
      typeof manifest?.warning === "string" &&
      manifest.warning.includes("不是最终真人录音"),
    overlayAndTimelineProvenance:
      manifest?.overlay?.sha256 ===
        V004B_FORMAL_QA_PROFILE.overlayManifestSha256 &&
      manifest?.overlay?.timelineSha256 ===
        V004B_FORMAL_QA_PROFILE.timelineSha256,
    finalMediaSchema:
      manifest?.finalMedia?.schemaVersion ===
        V004B_FORMAL_QA_PROFILE.finalMediaSchemaVersion,
    finalMediaValidatedBytes:
      manifest?.finalMedia?.file?.bytes === videoIntegrity?.bytes &&
      manifest?.finalMedia?.file?.sha256 === videoIntegrity?.sha256 &&
      manifest?.finalMedia?.file?.bytes === published?.bytes &&
      manifest?.finalMedia?.file?.sha256 === published?.sha256,
    finalMediaValidatedPath:
      exactPath(manifest?.finalMedia?.file?.path, expectedVideoPath),
    finalMediaPublishedPath: exactPath(published?.path, expectedVideoPath),
    finalMediaPublishedBytes:
      Number.isSafeInteger(videoIntegrity?.bytes) &&
      videoIntegrity.bytes > 0 &&
      published?.bytes === videoIntegrity.bytes,
    finalMediaPublishedSha256:
      SHA256_PATTERN.test(videoIntegrity?.sha256 ?? "") &&
      published?.sha256 === videoIntegrity.sha256,
    fullDecodeRecorded:
      manifest?.finalMedia?.decoding?.videoDecodedWithoutError === true &&
      manifest?.finalMedia?.decoding?.audioDecodedWithoutError === true,
    exactCandidateVideoPath: resolve(videoPath) === expectedVideoPath,
    publication:
      manifest?.publication?.atomicDirectoryRename === true &&
      manifest?.publication?.nonOverwriting === true &&
      manifest?.publication?.durabilityProtocol ===
        "file-and-directory-fsync-with-durable-receipt-v1" &&
      exactPath(manifest?.publication?.outputPath, expectedVideoPath),
    prohibitions:
      manifest?.prohibitions?.oldOutputsOverwritten === false &&
      manifest?.prohibitions?.sourceCandidateModified === false &&
      manifest?.prohibitions?.sourceCandidateDeleted === false &&
      manifest?.prohibitions?.videoReencoded === false
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(
      `v004b formal candidate manifest is not bound to candidateVersion=1: ${failed.join(", ")}`
    );
  }
  return {
    passed: true,
    profile: V004B_FORMAL_QA_PROFILE.schemaVersion,
    checks,
    job: {
      jobId: job.jobId,
      candidateVersion: job.candidateVersion,
      visualSource: contract.visualSource,
      renderBaseCandidateVersion: V004B_FORMAL_QA_PROFILE.renderBaseCandidateVersion,
      temporaryVoice: true,
      temporaryVoiceIsFinalHumanRecording: false
    }
  };
}

export function validateV004bFormalQaSourceBinding({
  manifest,
  job,
  qaSourceIdentity
}) {
  if (!isV004bFormalQaJob(job)) {
    throw new TypeError("the exact v004b formal QA render job is required");
  }
  const sourceFiles = qaSourceIdentity?.sourceFiles;
  const findSourceFile = (path) => sourceFiles?.find((file) => file?.path === path);
  const runner = findSourceFile(job.paths.runner);
  const sourceBase =
    "outputs/studio/agent-skill-20260806/review-candidates/" +
    V004B_FORMAL_QA_PROFILE.sourceCandidateDirectoryName;
  const sourceVideo = findSourceFile(`${sourceBase}/review-10m.mp4`);
  const sourceManifest = findSourceFile(`${sourceBase}/review-manifest.json`);
  const sourceReceipt = findSourceFile(
    `${sourceBase}/publication-durable-receipt.json`
  );
  const matchesFrozenFile = (file, bytes, sha256) =>
    file?.bytes === bytes && file?.sha256 === sha256;
  const checks = {
    qaSourceIdentity:
      SHA256_PATTERN.test(qaSourceIdentity?.worktreeSha256 ?? "") &&
      Array.isArray(sourceFiles),
    runnerIncluded:
      matchesFrozenFile(
        runner,
        V004B_FORMAL_QA_PROFILE.rebindRunnerBytes,
        V004B_FORMAL_QA_PROFILE.rebindRunnerSha256
      ),
    runnerPath: exactPath(manifest?.republication?.rebinder?.path, job.resolvedPaths.runner),
    runnerSha256: manifest?.republication?.rebinder?.sha256 === runner?.sha256,
    sourceVideoIncluded: matchesFrozenFile(
      sourceVideo,
      V004B_FORMAL_QA_PROFILE.sourceCandidateVideoBytes,
      V004B_FORMAL_QA_PROFILE.sourceCandidateVideoSha256
    ),
    sourceManifestIncluded: matchesFrozenFile(
      sourceManifest,
      V004B_FORMAL_QA_PROFILE.sourceCandidateManifestBytes,
      V004B_FORMAL_QA_PROFILE.sourceCandidateManifestSha256
    ),
    sourceReceiptIncluded: matchesFrozenFile(
      sourceReceipt,
      V004B_FORMAL_QA_PROFILE.sourceCandidateReceiptBytes,
      V004B_FORMAL_QA_PROFILE.sourceCandidateReceiptSha256
    ),
    sourceArtifactMatchesIdentity:
      manifest?.republication?.sourceArtifact?.video?.sha256 === sourceVideo?.sha256 &&
      manifest?.republication?.sourceArtifact?.manifest?.sha256 ===
        sourceManifest?.sha256 &&
      manifest?.republication?.sourceArtifact?.durableReceipt?.sha256 ===
        sourceReceipt?.sha256
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    throw new Error(
      `v004b formal candidate rebind/source provenance is not bound to QA source identity: ${failed.join(", ")}`
    );
  }
  return { passed: true, checks };
}

export function validateV004bFormalPublicationDurableReceipt({
  receipt,
  manifest,
  manifestIntegrity,
  videoIntegrity,
  job
}) {
  if (!isV004bFormalQaJob(job)) {
    throw new TypeError("the exact v004b formal QA render job is required");
  }
  const jobBinding = {
    finalManifestSchemaVersion: V004B_FORMAL_QA_PROFILE.manifestSchemaVersion,
    runFingerprint: manifest?.runFingerprint ?? null,
    jobId: job.jobId,
    candidateVersion: job.candidateVersion,
    episodeId: job.episodeId,
    compositionId: job.compositionId
  };
  const expectedBindingSha256 = createHash("sha256")
    .update(stableStringify(jobBinding))
    .digest("hex");
  const checks = {
    receiptObject: hasExactKeys(receipt, [
      "schemaVersion",
      "kind",
      "attemptToken",
      "output",
      "manifest",
      "jobBinding",
      "jobBindingSha256",
      "recordedAt"
    ]),
    receiptSchema:
      receipt?.schemaVersion === V004B_FORMAL_QA_PROFILE.receiptSchemaVersion,
    receiptKind: receipt?.kind === "durable_receipt",
    manifestFormalJob:
      manifest?.schemaVersion === V004B_FORMAL_QA_PROFILE.manifestSchemaVersion &&
      manifest?.renderJob?.jobId === job.jobId &&
      manifest?.renderJob?.candidateVersion === job.candidateVersion,
    attemptToken:
      typeof receipt?.attemptToken === "string" && UUID_PATTERN.test(receipt.attemptToken),
    recordedAt:
      typeof receipt?.recordedAt === "string" &&
      !Number.isNaN(Date.parse(receipt.recordedAt)),
    outputObject: hasExactKeys(receipt?.output, ["fileName", "bytes", "sha256"]),
    outputFileName: receipt?.output?.fileName === "review-10m.mp4",
    outputBytes: receipt?.output?.bytes === videoIntegrity?.bytes,
    outputSha256:
      SHA256_PATTERN.test(videoIntegrity?.sha256 ?? "") &&
      receipt?.output?.sha256 === videoIntegrity.sha256,
    manifestObject: hasExactKeys(receipt?.manifest, ["fileName", "sha256"]),
    manifestFileName: receipt?.manifest?.fileName === "review-manifest.json",
    manifestSha256:
      SHA256_PATTERN.test(manifestIntegrity?.sha256 ?? "") &&
      receipt?.manifest?.sha256 === manifestIntegrity.sha256,
    jobBindingObject: hasExactKeys(receipt?.jobBinding, [
      "finalManifestSchemaVersion",
      "runFingerprint",
      "jobId",
      "candidateVersion",
      "episodeId",
      "compositionId"
    ]),
    jobBinding: stableStringify(receipt?.jobBinding) === stableStringify(jobBinding),
    jobBindingSha256:
      SHA256_PATTERN.test(receipt?.jobBindingSha256 ?? "") &&
      receipt?.jobBindingSha256 === expectedBindingSha256
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failed.length > 0) {
    const error = new Error(
      `v004b formal candidate does not have a valid durable receipt: ${failed.join(", ")}`
    );
    error.code = "v004b_formal_publication_receipt_invalid";
    error.failedChecks = failed;
    throw error;
  }
  return {
    passed: true,
    profile: V004B_FORMAL_QA_PROFILE.schemaVersion,
    checks,
    receipt: {
      schemaVersion: receipt.schemaVersion,
      kind: receipt.kind,
      attemptToken: receipt.attemptToken,
      recordedAt: receipt.recordedAt,
      jobBindingSha256: receipt.jobBindingSha256
    },
    jobBinding
  };
}
