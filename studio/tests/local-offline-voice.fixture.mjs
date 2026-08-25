import { createHash } from "node:crypto";

import { integrityHash } from "../src/shared/integrity.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";
import { adaptApprovedStoryboardToShortAssetPlan } from
  "../src/server/production/short-asset-plan-adapter.mjs";
import {
  LOCAL_TTS_MODEL,
  LOCAL_TTS_VOICES
} from "../src/video/agent-skill-local-tts-plan.mjs";
import {
  SHORT_LOCAL_TTS_DURATION_SECONDS,
  SHORT_LOCAL_TTS_NETWORK_GUARDS,
  SHORT_LOCAL_TTS_PACING_PROFILE_VERSION,
  SHORT_LOCAL_TTS_VOICE_ID,
  buildShortLocalTtsSegments
} from "../src/video/agent-skill-short-local-tts-candidate.mjs";
import { historicalApprovedStoryboardV3Episode } from
  "./historical-approved-storyboard-v3.fixture.mjs";

export const LOCAL_OFFLINE_VOICE_FIXTURE_ROOT =
  "studio/tests/fixtures/local-offline-voice";

const SCRIPT_VERSION = 2;
const SCRIPT_REPORT_ID = "fixture-script-v2-machine-pass";
const SCRIPT_APPROVED_AT = "2026-08-13T05:42:41.327Z";
const STORYBOARD_V4_REPORT_ID = "fixture-storyboard-v4-machine-pass";
const STORYBOARD_V4_APPROVED_AT = "2026-08-17T11:38:18.288Z";
const ASSET_V9_APPROVED_AT = "2026-08-14T09:39:00.000Z";
const ASSET_V13_APPROVED_AT = "2026-08-17T16:38:14.435Z";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function createDeterministicPcmTestWav({
  amplitude = 2_048,
  activeRangesSeconds = [[0, SHORT_LOCAL_TTS_DURATION_SECONDS]]
} = {}) {
  if (!Number.isInteger(amplitude) || amplitude < 0 || amplitude > 32_767) {
    throw new Error("PCM fixture amplitude must be an integer from 0 through 32767");
  }
  if (!Array.isArray(activeRangesSeconds) || activeRangesSeconds.some((range) =>
    !Array.isArray(range)
    || range.length !== 2
    || !Number.isFinite(range[0])
    || !Number.isFinite(range[1])
    || range[0] < 0
    || range[1] <= range[0]
    || range[1] > SHORT_LOCAL_TTS_DURATION_SECONDS)) {
    throw new Error("PCM fixture active ranges must stay inside the 60-second timeline");
  }
  const sampleRate = 24_000;
  const dataBytes = SHORT_LOCAL_TTS_DURATION_SECONDS * sampleRate * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  const halfPeriodSamples = 60;
  for (let index = 0; index < dataBytes / 2; index += 1) {
    const active = activeRangesSeconds.some(([start, end]) =>
      index >= start * sampleRate && index < end * sampleRate);
    const sample = amplitude === 0 || !active
      ? 0
      : Math.floor(index / halfPeriodSamples) % 2 === 0
        ? amplitude
        : -amplitude;
    wav.writeInt16LE(sample, 44 + index * 2);
  }
  return wav;
}

function approveScript(episode) {
  const narration = episode.subtitles.map(({ text }) => text).join("");
  const artifactPath = `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/script-draft-v002.json`;
  const scriptDraft = {
    version: SCRIPT_VERSION,
    artifactPath,
    content: {
      title: episode.title,
      sections: [{ id: "S05", narration }]
    },
    needsRevision: false,
    versions: []
  };
  scriptDraft.versions = [structuredClone(scriptDraft)];
  scriptDraft.versions[0].versions = [];
  episode.production.scriptDraft = scriptDraft;
  const artifactHash = currentGateArtifactHash(episode, "script");
  const approval = {
    at: SCRIPT_APPROVED_AT,
    gate: "script",
    decision: "approved",
    note: "Immutable local-offline voice test fixture",
    version: SCRIPT_VERSION
  };
  episode.reviews.script = {
    status: "passed",
    artifactVersion: SCRIPT_VERSION,
    artifactHash,
    rubricVersion: "script-fixture-v1",
    revisionRounds: 0,
    latestReportId: SCRIPT_REPORT_ID,
    reports: [{
      id: SCRIPT_REPORT_ID,
      stage: "script",
      decision: "pass",
      artifactVersion: SCRIPT_VERSION,
      artifactHash,
      rubricVersion: "script-fixture-v1",
      confidence: 1,
      blockingIssues: [],
      warnings: [],
      passedChecks: ["immutable-fixture"]
    }]
  };
  episode.approvals.script = {
    status: "approved",
    at: SCRIPT_APPROVED_AT,
    note: approval.note,
    feedback: "",
    currentVersion: SCRIPT_VERSION,
    history: [approval],
    provenance: "reviewed-v2",
    reviewReportId: SCRIPT_REPORT_ID,
    artifactHash
  };
  episode.approvalHistory.push(approval);
  return {
    version: SCRIPT_VERSION,
    artifactPath,
    artifactHash,
    reviewReportId: SCRIPT_REPORT_ID
  };
}

function storyboardArtifact(episode) {
  const scenes = structuredClone(episode.scenes);
  const subtitles = structuredClone(episode.subtitles);
  return {
    sourceScript: {
      version: SCRIPT_VERSION,
      artifactHash: episode.approvals.script.artifactHash,
      reviewReportId: SCRIPT_REPORT_ID
    },
    draft: {
      targetDurationSeconds: episode.render.durationSeconds,
      assetChecklist: structuredClone(episode.production.storyboardDraft.assetChecklist),
      visualRules: structuredClone(episode.production.storyboardDraft.visualRules),
      scenes: scenes.map((scene) => ({
        ...structuredClone(scene),
        subtitleLines: subtitles.filter((subtitle) =>
          subtitle.start >= scene.start && subtitle.end <= scene.end
        )
      }))
    },
    timeline: {
      durationSeconds: episode.render.durationSeconds,
      scenes,
      subtitles
    }
  };
}

function assetCheckpoint(episode, version, content, approvedAt) {
  const artifactPath =
    `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/asset-plan-v${String(version).padStart(3, "0")}.json`;
  const planHash = integrityHash(content);
  const candidateHash = integrityHash({
    episodeId: episode.id,
    version,
    artifactPath,
    planHash,
    purpose: "immutable-local-offline-voice-fixture"
  });
  const machineReviewId = `fixture-asset-review-v${String(version).padStart(3, "0")}`;
  return {
    artifactPath,
    planHash,
    candidateHash,
    approvedAt,
    machineReviewId,
    machineHistory: {
      type: "machine-review",
      at: approvedAt,
      version,
      candidateHash,
      reviewId: machineReviewId,
      status: "passed"
    },
    humanHistory: {
      type: "human-approval",
      at: approvedAt,
      version,
      candidateHash,
      machineReviewId,
      decision: "approved",
      note: "Immutable local-only fixture approval"
    }
  };
}

function applyAssetCheckpoint(episode, binding, content, history) {
  episode.production.assetPlanDirection = {
    strategy: "local-only",
    selectedBy: "human"
  };
  episode.production.assetPlan = {
    version: binding.version,
    artifactPath: binding.artifactPath,
    content: structuredClone(content),
    needsRevision: false
  };
  episode.reviewCheckpoints.assetExecution = {
    schemaVersion: 1,
    status: "approved",
    currentCandidate: {
      episodeId: episode.id,
      version: binding.version,
      artifact: {
        path: binding.artifactPath,
        bytes: 1,
        sha256: "9".repeat(64)
      },
      planHash: binding.planHash,
      candidateHash: binding.candidateHash,
      summary: {
        itemCount: content.items.length,
        requiredVisualItemCount: content.items.filter(
          (item) => item.required && item.assetType !== "voice"
        ).length,
        productionMethods: ["local-code-animation", "deferred-voice-agent"],
        externalApiCallCount: 0,
        externalApiCalls: [],
        maximumPaidCostUsd: 0,
        currency: "USD",
        billingCurrencies: [],
        nativeCurrencyCaps: [],
        budgetNormalization: null,
        costScope: "external-api-only",
        pricingConfirmed: true
      }
    },
    machineReview: {
      id: binding.machineReviewId,
      status: "passed",
      checkedAt: binding.approvedAt,
      candidateHash: binding.candidateHash,
      checks: []
    },
    humanApproval: {
      decision: "approved",
      at: binding.approvedAt,
      note: "Immutable local-only fixture approval",
      version: binding.version,
      candidateHash: binding.candidateHash,
      machineReviewId: binding.machineReviewId,
      maximumPaidCostUsd: 0,
      externalApiCallCount: 0,
      authorizedToolIds: []
    },
    history: structuredClone(history)
  };
  const assetStep = episode.pipeline.find((step) => step.agent === "asset-agent");
  Object.assign(assetStep, {
    status: "complete",
    progress: 1,
    message: `Fixture Asset v${binding.version} approved`,
    requiresApproval: null,
    requiresHuman: false,
    artifacts: [binding.artifactPath],
    lastError: null
  });
}

function renderedSegments(segmentPlan) {
  return segmentPlan.segments.map((segment) => {
    const explicitPauseSeconds = (segment.speechParts ?? []).reduce(
      (total, part) => total + part.pauseAfterSeconds,
      0
    );
    const durationSeconds = segment.id === "S03"
      ? 8
      : Number(Math.max(0.5, segment.end - segment.start - 0.25).toFixed(3));
    const speechDurationSeconds = Number((durationSeconds - explicitPauseSeconds).toFixed(3));
    return {
      ...structuredClone(segment),
      durationSeconds,
      speechDurationSeconds,
      explicitPauseSeconds,
      speechPartMetrics: (segment.speechParts ?? []).map((part, index) => ({
        index,
        text: part.text,
        durationSeconds: segment.id === "S03"
          ? (index === 0 ? 2.675 : 4.825)
          : Number((speechDurationSeconds / segment.speechParts.length).toFixed(3)),
        pauseAfterSeconds: part.pauseAfterSeconds
      })),
      speed: segment.maximumSpeed ?? segment.preferredSpeed,
      trailingSilenceSeconds: segment.id === "S03"
        ? 0.694
        : segment.id === "S06" ? 0.25 : 0.25
    };
  });
}

export function createLocalOfflineVoiceFixture(registrationBase) {
  const episode = historicalApprovedStoryboardV3Episode();
  const scriptBinding = approveScript(episode);
  episode.control.reviewEnabled = true;

  episode.production.storyboardDraft = {
    ...episode.production.storyboardDraft,
    artifactPath: `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/storyboard-draft-v003.json`,
    versions: episode.production.storyboardDraft.versions.map((entry) => ({
      ...entry,
      artifactPath:
        `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/storyboard-draft-v${String(entry.version).padStart(3, "0")}.json`
    }))
  };
  const relocatedStoryboardHash = currentGateArtifactHash(episode, "storyboard");
  episode.reviews.storyboard.artifactHash = relocatedStoryboardHash;
  episode.reviews.storyboard.reports = episode.reviews.storyboard.reports.map((report) => ({
    ...report,
    artifactHash: relocatedStoryboardHash
  }));
  episode.approvals.storyboard.artifactHash = relocatedStoryboardHash;

  const voicePlanPath = `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/voice-plan-v001.json`;
  const voicePlan = {
    schemaVersion: 1,
    episodeId: episode.id,
    version: 1,
    durationSeconds: SHORT_LOCAL_TTS_DURATION_SECONDS,
    narration: episode.subtitles.map(({ text }) => text).join("")
  };
  const voicePlanData = jsonBuffer(voicePlan);
  episode.production.voicePlan = {
    version: 1,
    artifactPath: voicePlanPath
  };

  const storyboardV3Artifact = storyboardArtifact(episode);
  const storyboardV3Path = episode.production.storyboardDraft.artifactPath;
  const storyboardBinding = {
    version: episode.production.storyboardDraft.version,
    artifactPath: storyboardV3Path,
    artifactHash: episode.approvals.storyboard.artifactHash,
    reviewReportId: episode.approvals.storyboard.reviewReportId
  };

  const assetPlanV9 = adaptApprovedStoryboardToShortAssetPlan(episode);
  const assetV9 = {
    version: 9,
    ...assetCheckpoint(episode, 9, assetPlanV9, ASSET_V9_APPROVED_AT)
  };
  const v9History = [assetV9.machineHistory, assetV9.humanHistory];
  applyAssetCheckpoint(episode, assetV9, assetPlanV9, v9History);

  episode.voice = {
    status: "unconfigured",
    mode: null,
    audioPath: null,
    note: "Fixture waits for authorized voice input"
  };
  const voiceStep = episode.pipeline.find((step) => step.agent === "voice-agent");
  Object.assign(voiceStep, {
    status: "blocked",
    progress: 0,
    message: "Fixture waits for authorized voice input",
    requiresApproval: null,
    requiresHuman: true,
    artifacts: [],
    findings: [],
    finishedAt: null,
    lastError: null
  });
  episode.production.assetBundleRevision = 10;
  episode.approvals.assets = {
    ...episode.approvals.assets,
    status: "pending",
    at: null,
    note: "",
    feedback: "",
    currentVersion: 10,
    provenance: null,
    reviewReportId: null,
    artifactHash: null
  };

  const segmentPlan = buildShortLocalTtsSegments(episode, voicePlan);
  const wavData = createDeterministicPcmTestWav();
  const wavSha256 = sha256(wavData);
  const candidateRelativeRoot = `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/candidate`;
  const wavRelativePath = `${candidateRelativeRoot}/${registrationBase.wavFileName}`;
  const manifestRelativePath =
    `${candidateRelativeRoot}/${registrationBase.manifestFileName}`;
  const manifest = {
    schemaVersion: 1,
    id: registrationBase.candidateId,
    episodeId: episode.id,
    version: registrationBase.candidateVersion,
    generatedAt: "2026-08-14T11:34:00.000Z",
    status: "human-review-candidate",
    source: {
      script: scriptBinding,
      storyboard: storyboardBinding,
      voicePlan: {
        version: 1,
        artifactPath: voicePlanPath,
        sha256: sha256(voicePlanData),
        narrationSha256: sha256(segmentPlan.narration)
      },
      subtitlesSha256: sha256(JSON.stringify(episode.subtitles)),
      segmentPlanSha256: sha256(JSON.stringify(segmentPlan.segments)),
      pacingProfileVersion: SHORT_LOCAL_TTS_PACING_PROFILE_VERSION,
      assetExecution: {
        version: assetV9.version,
        candidateHash: assetV9.candidateHash,
        planHash: assetV9.planHash,
        approvedAt: assetV9.approvedAt,
        authorizedToolIds: []
      }
    },
    model: {
      repoId: LOCAL_TTS_MODEL.repoId,
      revision: LOCAL_TTS_MODEL.revision,
      fileName: LOCAL_TTS_MODEL.fileName,
      sha256: LOCAL_TTS_MODEL.sha256,
      verifiedSha256: LOCAL_TTS_MODEL.sha256,
      configSha256: LOCAL_TTS_MODEL.configSha256,
      verifiedConfigSha256: LOCAL_TTS_MODEL.configSha256,
      codeRepoId: LOCAL_TTS_MODEL.codeRepoId,
      codeRevision: LOCAL_TTS_MODEL.codeRevision,
      license: "Apache-2.0"
    },
    voice: {
      id: SHORT_LOCAL_TTS_VOICE_ID,
      packageSha256: LOCAL_TTS_VOICES.find(
        ({ id }) => id === SHORT_LOCAL_TTS_VOICE_ID
      ).sha256
    },
    audio: {
      outputPath: wavRelativePath,
      bytes: wavData.length,
      sha256: wavSha256,
      durationSeconds: SHORT_LOCAL_TTS_DURATION_SECONDS,
      sampleRate: 24_000,
      channels: 1,
      segments: renderedSegments(segmentPlan)
    },
    generation: {
      mode: "local-offline-kokoro",
      offlineEnvironmentVerified: true,
      networkPolicy: "deny-all",
      networkGuards: [...SHORT_LOCAL_TTS_NETWORK_GUARDS],
      paidApiCalls: 0,
      externalInferenceCalls: 0,
      modelDownloadCallsDuringGeneration: 0,
      textUploadCalls: 0,
      maximumPaidCostUsd: 0
    }
  };
  const manifestData = jsonBuffer(manifest);
  const registration = Object.freeze({
    ...registrationBase,
    manifestSha256: sha256(manifestData),
    wavSha256
  });

  const priorReviewMediaPath = `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/prior-review.mp4`;
  const priorReviewMediaData = Buffer.from("immutable prior review media fixture", "utf8");
  const priorReviewManifestPath =
    `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/prior-review-manifest.json`;
  const priorReviewManifest = {
    storyboardVersion: 4,
    media: { sha256: sha256(priorReviewMediaData) },
    sourceHashesBeforeAndAfter: { voiceV1: wavSha256 },
    reviewOnly: true,
    registered: false
  };
  const priorReviewManifestData = jsonBuffer(priorReviewManifest);
  const priorReview = Object.freeze({
    manifestPath: priorReviewManifestPath,
    manifestSha256: sha256(priorReviewManifestData),
    mediaPath: priorReviewMediaPath,
    mediaSha256: sha256(priorReviewMediaData),
    mediaBytes: priorReviewMediaData.length,
    storyboardVersion: 4
  });

  const files = new Map([
    [voicePlanPath, voicePlanData],
    [storyboardV3Path, jsonBuffer(storyboardV3Artifact)],
    [assetV9.artifactPath, jsonBuffer({ plan: assetPlanV9 })],
    [manifestRelativePath, manifestData],
    [wavRelativePath, wavData],
    [priorReviewManifestPath, priorReviewManifestData],
    [priorReviewMediaPath, priorReviewMediaData]
  ]);

  function createRebindEpisode(registeredEpisode) {
    const current = structuredClone(registeredEpisode);
    const previousStoryboard = structuredClone(current.production.storyboardDraft);
    const currentSubtitles = structuredClone(current.subtitles);
    const s03Index = currentSubtitles.findIndex(({ start }) => start === 8.708);
    currentSubtitles.splice(s03Index, 2,
      {
        start: 8.708,
        end: 14.794,
        text: "MCP 标准化 prompts、resources 和 tools "
      },
      {
        start: 14.794,
        end: 17.402,
        text: "如何被外部系统暴露和调用。"
      });
    current.subtitles = currentSubtitles;
    current.scenes = current.scenes.map((scene) => scene.id === "S03"
      ? { ...scene, subtitle: currentSubtitles[s03Index].text }
      : scene);
    const storyboardV4Path = `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/storyboard-draft-v004.json`;
    const version4 = {
      ...structuredClone(previousStoryboard),
      version: 4,
      artifactPath: storyboardV4Path,
      generatedAt: "2026-08-17T11:38:18.280Z"
    };
    delete version4.versions;
    current.production.storyboardDraft = {
      ...version4,
      versions: [
        ...structuredClone(previousStoryboard.versions ?? []),
        structuredClone(version4)
      ]
    };
    const storyboardV4Hash = currentGateArtifactHash(current, "storyboard");
    const storyboardApproval = {
      at: STORYBOARD_V4_APPROVED_AT,
      gate: "storyboard",
      decision: "approved",
      note: "Immutable Storyboard v4 fixture approval",
      version: 4
    };
    current.reviews.storyboard = {
      ...current.reviews.storyboard,
      status: "passed",
      artifactVersion: 4,
      artifactHash: storyboardV4Hash,
      latestReportId: STORYBOARD_V4_REPORT_ID,
      reports: [
        ...current.reviews.storyboard.reports,
        {
          id: STORYBOARD_V4_REPORT_ID,
          stage: "storyboard",
          decision: "pass",
          artifactVersion: 4,
          artifactHash: storyboardV4Hash
        }
      ]
    };
    current.approvals.storyboard = {
      ...current.approvals.storyboard,
      status: "approved",
      at: STORYBOARD_V4_APPROVED_AT,
      note: storyboardApproval.note,
      currentVersion: 4,
      history: [...current.approvals.storyboard.history, storyboardApproval],
      provenance: "reviewed-v2",
      reviewReportId: STORYBOARD_V4_REPORT_ID,
      artifactHash: storyboardV4Hash
    };
    files.set(storyboardV4Path, jsonBuffer(storyboardArtifact(current)));

    const assetPlanV13 = adaptApprovedStoryboardToShortAssetPlan(current);
    const assetV13 = {
      version: 13,
      ...assetCheckpoint(current, 13, assetPlanV13, ASSET_V13_APPROVED_AT)
    };
    applyAssetCheckpoint(current, assetV13, assetPlanV13, [
      ...v9History,
      assetV13.machineHistory,
      assetV13.humanHistory
    ]);
    current.production.assetBundleRevision = 13;
    files.set(assetV13.artifactPath, jsonBuffer({ plan: assetPlanV13 }));
    return {
      episode: current,
      storyboardBinding: {
        version: 4,
        artifactPath: storyboardV4Path,
        artifactHash: storyboardV4Hash,
        reviewReportId: STORYBOARD_V4_REPORT_ID
      },
      assetBinding: {
        version: 13,
        candidateHash: assetV13.candidateHash,
        planHash: assetV13.planHash,
        approvedAt: assetV13.approvedAt,
        authorizedToolIds: []
      }
    };
  }

  return {
    episode,
    registration,
    priorReview,
    files,
    candidateRelativePaths: {
      manifestPath: manifestRelativePath,
      wavPath: wavRelativePath
    },
    storyboardBinding,
    assetBinding: {
      version: 9,
      candidateHash: assetV9.candidateHash,
      planHash: assetV9.planHash,
      approvedAt: assetV9.approvedAt,
      authorizedToolIds: []
    },
    createRebindEpisode
  };
}
