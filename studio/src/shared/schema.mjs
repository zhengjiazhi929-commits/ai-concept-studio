import { validateProductionProfile } from "./production-profiles.mjs";

export const APPROVAL_GATES = [
  { id: "research", label: "研究证据", stepId: "research", restartStepId: "research" },
  { id: "script", label: "脚本", stepId: "script", restartStepId: "script" },
  { id: "storyboard", label: "分镜", stepId: "storyboard", restartStepId: "storyboard" },
  { id: "assets", label: "素材与声音", stepId: "voice", restartStepId: "assets" },
  { id: "final", label: "最终成片", stepId: "qa", restartStepId: "render" }
];

export const APPROVAL_GATE_IDS = new Set(APPROVAL_GATES.map((gate) => gate.id));

export const PIPELINE_DEFINITIONS = [
  { id: "trend", label: "热点发现", agent: "trend-agent", gate: null },
  { id: "research", label: "研究与事实", agent: "research-agent", gate: "research" },
  { id: "script", label: "脚本", agent: "script-agent", gate: "script" },
  { id: "storyboard", label: "分镜", agent: "storyboard-agent", gate: "storyboard" },
  { id: "assets", label: "素材", agent: "asset-agent", gate: null },
  { id: "voice", label: "旁白与素材确认", agent: "voice-agent", gate: "assets" },
  { id: "render", label: "视频渲染", agent: "render-agent", gate: null },
  { id: "qa", label: "质量检查", agent: "qa-agent", gate: "final" }
];

export const STEP_STATUSES = new Set([
  "pending",
  "ready",
  "running",
  "waiting_approval",
  "blocked",
  "complete",
  "failed"
]);

export const APPROVAL_STATUSES = new Set(["pending", "approved", "rejected"]);
const VISUAL_PROOF_CHECKPOINT_STATUSES = new Set([
  "not_started",
  "blocked",
  "waiting_approval",
  "approved"
]);
const ASSET_EXECUTION_CHECKPOINT_STATUSES = new Set([
  "not_started",
  "blocked",
  "waiting_approval",
  "approved",
  "rejected"
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validateVisualProofCheckpoint(checkpoint, errors) {
  if (!isRecord(checkpoint)) {
    errors.push("visual proof checkpoint must be an object");
    return;
  }
  if (!VISUAL_PROOF_CHECKPOINT_STATUSES.has(checkpoint.status)) {
    errors.push("invalid visual proof checkpoint status");
  }
  if (!Array.isArray(checkpoint.history)) {
    errors.push("visual proof checkpoint history must be an array");
  }
  if (checkpoint.status === "not_started") return;
  const candidate = checkpoint.currentCandidate;
  if (!isRecord(candidate)) {
    errors.push("visual proof checkpoint requires a current candidate");
    return;
  }
  if (!Number.isInteger(candidate.version) || candidate.version < 1) {
    errors.push("visual proof candidate version must be positive");
  }
  if (!isSha256(candidate.candidateHash)) {
    errors.push("visual proof candidate hash must be SHA-256");
  }
  for (const field of ["manifest", "video", "qa", "comparison"]) {
    const evidence = candidate[field];
    if (
      !isRecord(evidence)
      || typeof evidence.path !== "string"
      || !Number.isSafeInteger(evidence.bytes)
      || evidence.bytes < 0
      || !isSha256(evidence.sha256)
    ) {
      errors.push(`invalid visual proof ${field} evidence`);
    }
  }
  if (
    !isRecord(checkpoint.machineReview)
    || !new Set(["passed", "blocked"]).has(checkpoint.machineReview.status)
    || !Array.isArray(checkpoint.machineReview.checks)
    || checkpoint.machineReview.candidateHash !== candidate.candidateHash
  ) {
    errors.push("invalid visual proof machine review");
  }
  if (checkpoint.status === "waiting_approval" && checkpoint.machineReview?.status !== "passed") {
    errors.push("waiting visual proof checkpoint requires passed machine review");
  }
  if (checkpoint.status === "approved") {
    if (
      checkpoint.machineReview?.status !== "passed"
      || checkpoint.humanApproval?.decision !== "approved"
      || checkpoint.humanApproval?.candidateHash !== candidate.candidateHash
      || checkpoint.humanApproval?.machineReviewId !== checkpoint.machineReview?.id
    ) {
      errors.push("approved visual proof checkpoint must bind human and machine review");
    }
  }
}

function validateAssetExecutionCheckpoint(checkpoint, errors) {
  if (!isRecord(checkpoint)) {
    errors.push("asset execution checkpoint must be an object");
    return;
  }
  if (!ASSET_EXECUTION_CHECKPOINT_STATUSES.has(checkpoint.status)) {
    errors.push("invalid asset execution checkpoint status");
  }
  if (!Array.isArray(checkpoint.history)) {
    errors.push("asset execution checkpoint history must be an array");
  }
  if (checkpoint.status === "not_started") return;
  const candidate = checkpoint.currentCandidate;
  if (!isRecord(candidate)) {
    errors.push("asset execution checkpoint requires a current candidate");
    return;
  }
  if (!Number.isInteger(candidate.version) || candidate.version < 1) {
    errors.push("asset execution candidate version must be positive");
  }
  if (!isSha256(candidate.candidateHash) || !isSha256(candidate.planHash)) {
    errors.push("asset execution candidate hashes must be SHA-256");
  }
  if (
    !isRecord(candidate.artifact)
    || typeof candidate.artifact.path !== "string"
    || !Number.isSafeInteger(candidate.artifact.bytes)
    || candidate.artifact.bytes < 0
    || !isSha256(candidate.artifact.sha256)
  ) {
    errors.push("invalid asset execution artifact evidence");
  }
  if (!isRecord(candidate.summary)) {
    errors.push("asset execution candidate summary must be an object");
  }
  if (
    !isRecord(checkpoint.machineReview)
    || !new Set(["passed", "blocked"]).has(checkpoint.machineReview.status)
    || !Array.isArray(checkpoint.machineReview.checks)
    || checkpoint.machineReview.candidateHash !== candidate.candidateHash
  ) {
    errors.push("invalid asset execution machine review");
  }
  if (
    checkpoint.status === "waiting_approval" &&
    checkpoint.machineReview?.status !== "passed"
  ) {
    errors.push("waiting asset execution checkpoint requires passed machine review");
  }
  if (checkpoint.status === "approved") {
    if (
      checkpoint.machineReview?.status !== "passed"
      || checkpoint.humanApproval?.decision !== "approved"
      || checkpoint.humanApproval?.candidateHash !== candidate.candidateHash
      || checkpoint.humanApproval?.machineReviewId !== checkpoint.machineReview?.id
    ) {
      errors.push("approved asset execution checkpoint must bind human and machine review");
    }
  }
  if (
    checkpoint.status === "rejected" &&
    (
      checkpoint.humanApproval?.decision !== "rejected"
      || checkpoint.humanApproval?.candidateHash !== candidate.candidateHash
      || typeof checkpoint.humanApproval?.note !== "string"
      || !checkpoint.humanApproval.note.trim()
    )
  ) {
    errors.push("rejected asset execution checkpoint must bind human feedback");
  }
}

export function validateEpisode(episode) {
  const errors = [];

  if (!episode || typeof episode !== "object") errors.push("episode must be an object");
  if (!episode?.id || !/^[a-z0-9-]+$/.test(episode.id)) errors.push("invalid episode id");
  if (!episode?.title) errors.push("title is required");
  if (!Array.isArray(episode?.pipeline)) errors.push("pipeline must be an array");
  if (!Array.isArray(episode?.scenes)) errors.push("scenes must be an array");
  if (!episode?.approvals || typeof episode.approvals !== "object") {
    errors.push("approvals must be an object");
  }
  if (!Array.isArray(episode?.approvalHistory)) errors.push("approvalHistory must be an array");
  errors.push(...validateProductionProfile(episode?.productionProfile));

  if (episode?.derivation !== undefined) {
    const derivation = episode.derivation;
    if (!isRecord(derivation)) {
      errors.push("derivation must be an object");
    } else {
      if (derivation.kind !== "approved-script-section-v1") {
        errors.push("invalid derivation kind");
      }
      if (!/^[a-z0-9-]+$/u.test(derivation.parentEpisodeId ?? "")) {
        errors.push("invalid derivation parent episode id");
      }
      if (!Array.isArray(derivation.sourceSectionIds) || derivation.sourceSectionIds.length === 0) {
        errors.push("derivation must list source section ids");
      }
      if (!Array.isArray(derivation.sourceSections) || derivation.sourceSections.length === 0) {
        errors.push("derivation must snapshot approved source sections");
      }
      for (const field of [
        "parentResearchArtifactHash",
        "parentScriptArtifactHash",
        "sourceSnapshotHash"
      ]) {
        if (!isSha256(derivation[field])) errors.push(`invalid derivation ${field}`);
      }
    }
  }

  if (episode?.voice?.mode === "local-offline-tts") {
    const voice = episode.voice;
    const provenance = voice.provenance;
    const authorization = voice.authorization;
    const verification = voice.verification;
    const expectedVoiceFileName = Number.isInteger(voice.version)
      ? `voice-v${String(voice.version).padStart(3, "0")}.wav`
      : null;
    if (
      voice.status !== "ready"
      || !Number.isInteger(voice.version)
      || voice.version < 1
      || typeof voice.audioPath !== "string"
      || !/^studio\/public\/episodes\/[a-z0-9-]+\/voice-v\d{3}\.wav$/u.test(voice.audioPath)
      || voice.audioPath !== `studio/public/episodes/${episode.id}/${expectedVoiceFileName}`
      || typeof voice.publicPath !== "string"
      || !/^episodes\/[a-z0-9-]+\/voice-v\d{3}\.wav$/u.test(voice.publicPath)
      || voice.publicPath !== `episodes/${episode.id}/${expectedVoiceFileName}`
      || voice.durationSeconds !== 60
      || voice.sampleRate !== 24000
      || voice.channels !== 1
      || voice.bitsPerSample !== 16
      || !Number.isSafeInteger(voice.bytes)
      || voice.bytes <= 44
      || !isSha256(voice.sha256)
    ) {
      errors.push("invalid local-offline-tts voice media contract");
    }
    if (
      !isRecord(provenance)
      || provenance.schemaVersion !== 1
      || provenance.source !== "local-offline-tts"
      || provenance.candidateId !== "agent-skill-short-local-tts-zm_010-v002"
      || provenance.candidateVersion !== 2
      || !isSha256(provenance.candidateHash)
      || !isSha256(provenance.machineVerificationId)
      || !Number.isSafeInteger(provenance.candidateManifestBytes)
      || provenance.candidateManifestBytes <= 0
      || !isSha256(provenance.candidateManifestSha256)
      || !Number.isSafeInteger(provenance.candidateWavBytes)
      || provenance.candidateWavBytes !== voice.bytes
      || !isSha256(provenance.candidateWavSha256)
      || provenance.candidateWavSha256 !== voice.sha256
      || provenance.voice?.id !== "zm_010"
      || !isSha256(provenance.voice?.packageSha256)
      || provenance.voice?.source !== "pretrained-model-voice-package"
      || provenance.voice?.sourceRepoId !== "hexgrad/Kokoro-82M-v1.1-zh"
      || !/^[a-f0-9]{40}$/u.test(provenance.voice?.sourceRevision ?? "")
      || provenance.voice?.license !== "Apache-2.0"
      || provenance.voice?.cloneConsentRequired !== false
      || !isSha256(provenance.model?.sha256)
      || !isSha256(provenance.model?.configSha256)
      || provenance.model?.codeRepoId !== "hexgrad/kokoro"
      || !/^[a-f0-9]{40}$/u.test(provenance.model?.codeRevision ?? "")
      || provenance.model?.license !== "Apache-2.0"
      || !isRecord(provenance.sourceBindings)
      || !isRecord(provenance.generation)
      || provenance.generation.networkPolicy !== "deny-all"
      || provenance.generation.paidApiCalls !== 0
      || provenance.generation.externalInferenceCalls !== 0
      || provenance.generation.modelDownloadCallsDuringGeneration !== 0
      || provenance.generation.textUploadCalls !== 0
      || !isRecord(provenance.machineVerification)
      || provenance.machineVerification.id !== provenance.machineVerificationId
      || provenance.machineVerification.status !== "passed"
      || provenance.machineVerification.candidateHash !== provenance.candidateHash
      || !isSha256(provenance.machineVerification.verificationHash)
      || provenance.pacingProfileVersion !== "short-local-tts-pacing-v2"
      || provenance.offlineVerified !== true
      || provenance.externalApiCalls !== 0
      || provenance.maximumPaidCostUsd !== 0
      || !isSha256(provenance.ledgerHash)
    ) {
      errors.push("invalid local-offline-tts provenance contract");
    }
    if (
      !isRecord(verification)
      || verification.schemaVersion !== 1
      || verification.id !== provenance?.machineVerificationId
      || verification.status !== "passed"
      || verification.candidateHash !== provenance?.candidateHash
      || verification.machineVerificationId !== provenance?.machineVerificationId
      || verification.verificationHash !== provenance?.machineVerification?.verificationHash
      || !Array.isArray(verification.checks)
      || verification.checks.length === 0
      || verification.ledgerHash !== provenance?.ledgerHash
      || typeof verification.verifiedAt !== "string"
    ) {
      errors.push("invalid local-offline-tts machine verification contract");
    }
    if (
      !isRecord(authorization)
      || authorization.schemaVersion !== 1
      || authorization.decision !== "approved"
      || authorization.approvedBy !== "Zhengjiazhi"
      || authorization.scope !== "register-approved-local-offline-tts-v002"
      || authorization.candidateId !== provenance?.candidateId
      || authorization.candidateHash !== provenance?.candidateHash
      || authorization.candidateManifestSha256 !== provenance?.candidateManifestSha256
      || authorization.candidateWavSha256 !== provenance?.candidateWavSha256
      || authorization.machineVerificationId !== provenance?.machineVerificationId
      || authorization.machineVerificationHash !== provenance?.machineVerification?.verificationHash
      || !isSha256(authorization.verificationId)
      || typeof authorization.approvedAt !== "string"
      || typeof authorization.recordedAt !== "string"
      || authorization.recordedAt !== authorization.approvedAt
      || typeof authorization.note !== "string"
      || JSON.stringify(provenance?.humanSelection) !== JSON.stringify(authorization)
    ) {
      errors.push("invalid local-offline-tts authorization contract");
    }
  }

  if (episode?.control !== undefined) {
    if (!episode.control || typeof episode.control !== "object" || Array.isArray(episode.control)) {
      errors.push("control must be an object");
    } else {
      if (!CONTROL_MODES.has(episode.control.mode)) errors.push("invalid control mode");
      if (!Number.isInteger(episode.control.revisionLimit) || episode.control.revisionLimit < 0) {
        errors.push("control revisionLimit must be a non-negative integer");
      }
      if (!Number.isInteger(episode.control.planVersion) || episode.control.planVersion < 0) {
        errors.push("control planVersion must be a non-negative integer");
      }
      if (!Number.isInteger(episode.control.stateVersion) || episode.control.stateVersion < 0) {
        errors.push("control stateVersion must be a non-negative integer");
      }
      if (!Array.isArray(episode.control.allowedTools)) errors.push("control allowedTools must be an array");
    }
  }
  if (episode?.reviews !== undefined) {
    if (!episode.reviews || typeof episode.reviews !== "object" || Array.isArray(episode.reviews)) {
      errors.push("reviews must be an object");
    } else {
      for (const stage of Object.keys(episode.reviews)) {
        if (!REVIEW_STAGE_IDS.includes(stage)) errors.push(`unexpected review stage: ${stage}`);
      }
      for (const stage of REVIEW_STAGE_IDS) {
        const review = episode.reviews[stage];
        if (!review) {
          errors.push(`missing review stage: ${stage}`);
          continue;
        }
        if (!REVIEW_STATUSES.has(review.status)) errors.push(`invalid review status for ${stage}`);
        if (!Array.isArray(review.reports)) {
          errors.push(`review reports must be an array for ${stage}`);
          continue;
        }
        const reportIds = new Set();
        for (const report of review.reports) {
          const result = validateReviewResult(report);
          if (!result.valid) errors.push(...result.errors.map((error) => `${stage}: ${error}`));
          if (report?.stage !== stage) errors.push(`review report stage mismatch for ${stage}`);
          if (report?.id && reportIds.has(report.id)) errors.push(`duplicate review report id: ${report.id}`);
          if (report?.id) reportIds.add(report.id);
        }
        if (
          review.status === "passed" &&
          (!Number.isInteger(review.artifactVersion) || review.artifactVersion < 1)
        ) {
          errors.push(`passed review must bind an artifact version for ${stage}`);
        }
      }
    }
  }
  if (episode?.planHistory !== undefined && !Array.isArray(episode.planHistory)) {
    errors.push("planHistory must be an array");
  }
  if (episode?.routingHistory !== undefined && !Array.isArray(episode.routingHistory)) {
    errors.push("routingHistory must be an array");
  }
  if (episode?.dispatchHistory !== undefined && !Array.isArray(episode.dispatchHistory)) {
    errors.push("dispatchHistory must be an array");
  }
  if (episode?.evaluationHistory !== undefined && !Array.isArray(episode.evaluationHistory)) {
    errors.push("evaluationHistory must be an array");
  }
  if (episode?.reviewCheckpoints !== undefined) {
    if (!isRecord(episode.reviewCheckpoints)) {
      errors.push("reviewCheckpoints must be an object");
    } else {
      for (const checkpointId of Object.keys(episode.reviewCheckpoints)) {
        if (!new Set(["visualProof", "assetExecution"]).has(checkpointId)) {
          errors.push(`unexpected review checkpoint: ${checkpointId}`);
        }
      }
      if (episode.reviewCheckpoints.visualProof !== undefined) {
        validateVisualProofCheckpoint(episode.reviewCheckpoints.visualProof, errors);
      }
      if (episode.reviewCheckpoints.assetExecution !== undefined) {
        validateAssetExecutionCheckpoint(episode.reviewCheckpoints.assetExecution, errors);
      }
    }
  }

  for (const gateId of Object.keys(episode?.approvals ?? {})) {
    if (!APPROVAL_GATE_IDS.has(gateId)) errors.push(`unexpected approval gate: ${gateId}`);
  }

  for (const gate of APPROVAL_GATES) {
    const approval = episode?.approvals?.[gate.id];
    if (!approval) {
      errors.push(`missing approval gate: ${gate.id}`);
    } else if (!APPROVAL_STATUSES.has(approval.status)) {
      errors.push(`invalid approval status for ${gate.id}`);
    } else if (!Array.isArray(approval.history)) {
      errors.push(`approval history must be an array for ${gate.id}`);
    }
  }

  const pipelineIds = new Set(episode?.pipeline?.map((step) => step.id) ?? []);
  for (const definition of PIPELINE_DEFINITIONS) {
    if (!pipelineIds.has(definition.id)) errors.push(`missing pipeline step: ${definition.id}`);
  }

  for (const step of episode?.pipeline ?? []) {
    if (!STEP_STATUSES.has(step.status)) errors.push(`invalid status for ${step.id}`);
    const definition = PIPELINE_DEFINITIONS.find((item) => item.id === step.id);
    if (definition && step.gate !== definition.gate) {
      errors.push(`invalid approval gate for ${step.id}`);
    }
    if (step.requiresApproval && !APPROVAL_GATE_IDS.has(step.requiresApproval)) {
      errors.push(`invalid required approval for ${step.id}`);
    }
    if (
      step.status === "waiting_approval" &&
      definition?.gate &&
      step.requiresApproval !== definition.gate
    ) {
      errors.push(`waiting step ${step.id} must require ${definition.gate}`);
    }
  }

  const storyboardStep = episode?.pipeline?.find((step) => step.id === "storyboard");
  if (storyboardStep?.status === "complete" && episode?.scenes?.length === 0) {
    errors.push("completed storyboard requires at least one scene");
  }

  let previousEnd = 0;
  for (const scene of episode?.scenes ?? []) {
    if (scene.start !== previousEnd) errors.push(`scene ${scene.id} does not continue timeline`);
    if (scene.end <= scene.start) errors.push(`scene ${scene.id} has invalid duration`);
    previousEnd = scene.end;
  }

  if (episode?.render?.durationSeconds && previousEnd !== episode.render.durationSeconds) {
    errors.push("scene timeline does not match render duration");
  }

  return { valid: errors.length === 0, errors };
}

export function summarizePipeline(pipeline) {
  const complete = pipeline.filter((step) => step.status === "complete").length;
  return {
    complete,
    total: pipeline.length,
    percent: Math.round((complete / Math.max(1, pipeline.length)) * 100)
  };
}
import {
  CONTROL_MODES,
  REVIEW_STAGE_IDS,
  REVIEW_STATUSES,
  validateReviewResult
} from "./agent-contracts.mjs";
