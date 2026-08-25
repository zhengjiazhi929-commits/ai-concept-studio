import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  redactSensitiveText,
  redactSensitiveValue
} from "../../shared/redaction.mjs";
import { integrityHash } from "../../shared/integrity.mjs";
import { APPROVAL_GATES, APPROVAL_GATE_IDS } from "../../shared/schema.mjs";
import {
  currentGateArtifactHash,
  currentGateVersion,
  storyboardGateScenes
} from "../../shared/workflow.mjs";
import {
  ensureInside,
  workspaceRoot
} from "../../shared/paths.mjs";
import { readEpisode } from "../../shared/store.mjs";
import { reviewPassedForGate } from "../control/policy-engine.mjs";
import { assetExecutionCheckpointState } from "./asset-execution-checkpoint.mjs";
import { inspectVisualProofCandidate } from "./visual-proof-checkpoint.mjs";
import { inspectInlineResearchEvidence } from "./approval-artifact-integrity.mjs";

export const HUMAN_APPROVAL_VIEW_VERSION = "human-approval-view-v1";

const gateDefinitions = new Map(APPROVAL_GATES.map((gate) => [gate.id, gate]));
const targets = new Set([...APPROVAL_GATE_IDS, "asset-execution", "visual-proof"]);
const sensitiveKeys = /(?:api.?key|private.?key|token|secret|password|authorization|cookie|credential|headers?|raw.?response|request.?body|signature|signed.?url|session)/iu;

function clone(value) {
  return value === undefined ? null : structuredClone(value);
}

function stripUrlQueryAndFragment(value) {
  const text = String(value ?? "");
  return text.replace(/https?:\/\/[^\s"'<>\])}]+/giu, (candidate) => {
    try {
      const parsed = new URL(candidate);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return candidate;
    }
  });
}

function safeText(value, maximumLength = 100_000) {
  return stripUrlQueryAndFragment(redactSensitiveText(value, maximumLength));
}

function safeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return safeText(value);
  }
}

function safeNestedValue(value, depth = 0) {
  if (depth > 16) return "[TRUNCATED]";
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) {
    return value.slice(0, 1_000).map((item) => safeNestedValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (sensitiveKeys.test(key)) return [];
      return [[key, safeNestedValue(item, depth + 1)]];
    }));
  }
  return value;
}

function issueView(issue = {}) {
  return {
    code: issue.code ?? issue.id ?? null,
    message: issue.message ?? issue.label ?? issue.evidence ?? null,
    location: issue.location ?? null,
    evidence: safeNestedValue(issue.evidence ?? null),
    suggestedFix: issue.suggestedFix ?? null,
    ownerAgentId: issue.ownerAgentId ?? null
  };
}

function checkView(check = {}) {
  return {
    id: check.id ?? check.code ?? null,
    label: check.label ?? check.message ?? null,
    passed: check.passed === true,
    severity: check.severity ?? null,
    location: check.location ?? null,
    actual: safeNestedValue(check.actual ?? null),
    expected: safeNestedValue(check.expected ?? null),
    suggestedFix: check.suggestedFix ?? null,
    ownerAgentId: check.ownerAgentId ?? null
  };
}

function machineReviewView(report) {
  if (!report) return null;
  return {
    id: report.id ?? null,
    stage: report.stage ?? null,
    status: report.status ?? null,
    decision: report.decision ?? null,
    agentId: report.agentId ?? null,
    checkedAt: report.checkedAt ?? null,
    candidateHash: report.candidateHash ?? null,
    artifactVersion: report.artifactVersion ?? null,
    artifactHash: report.artifactHash ?? null,
    rubricVersion: report.rubricVersion ?? null,
    reviewConfigVersion: report.reviewConfigVersion ?? null,
    reviewMode: report.reviewMode ?? null,
    confidence: report.confidence ?? null,
    revisionTargets: safeNestedValue(report.revisionTargets ?? []),
    passedChecks: safeNestedValue(report.passedChecks ?? []),
    blockingIssues: (report.blockingIssues ?? []).map(issueView),
    warnings: (report.warnings ?? []).map(issueView),
    checks: (report.checks ?? []).map(checkView)
  };
}

function compact(values) {
  return values.filter((value) => value !== null && value !== undefined && value !== "");
}

function artifactRecord(value = {}) {
  return {
    path: value.path ?? value.artifactPath ?? null,
    bytes: value.bytes ?? null,
    sha256: value.sha256 ?? null,
    title: value.title ?? null,
    source: value.source ?? null
  };
}

function currentReview(episode, gate) {
  const review = episode.reviews?.[gate] ?? null;
  const report = review?.reports?.find((item) => item.id === review.latestReportId)
    ?? review?.reports?.at(-1)
    ?? null;
  return { review, report };
}

function reviewDelta(review, report) {
  const previous = [...(review?.reports ?? [])]
    .reverse()
    .find((item) => item.id !== report?.id) ?? null;
  const currentBlocking = new Set((report?.blockingIssues ?? []).map((item) => item.code));
  const previousBlocking = new Set((previous?.blockingIssues ?? []).map((item) => item.code));
  return {
    previousReviewReportId: previous?.id ?? null,
    previousArtifactVersion: previous?.artifactVersion ?? null,
    previousDecision: previous?.decision ?? null,
    currentDecision: report?.decision ?? null,
    resolvedBlockingIssueCodes: [...previousBlocking].filter((code) => !currentBlocking.has(code)),
    newBlockingIssueCodes: [...currentBlocking].filter((code) => !previousBlocking.has(code))
  };
}

function versionRecords(episode, gate) {
  let versions = [];
  if (gate === "research") versions = episode.research?.versions ?? [];
  if (gate === "script") versions = episode.production?.scriptDraft?.versions ?? [];
  if (gate === "storyboard") versions = episode.production?.storyboardDraft?.versions ?? [];
  if (gate === "assets") {
    versions = [
      ...(episode.production?.assetPlan?.versions ?? []),
      ...(episode.production?.voicePlan?.versions ?? [])
    ];
  }
  if (gate === "final") versions = episode.qa?.history ?? [];
  return versions.slice(-10).map((item) => ({
    version: item.version ?? null,
    at: item.at ?? item.checkedAt ?? null,
    artifactPath: item.artifactPath ?? item.packPath ?? item.outputPath ?? null,
    sha256: item.sha256 ?? null,
    status: item.status ?? null
  }));
}

function formalBinding(episode, gate, report) {
  return {
    artifactVersion: currentGateVersion(episode, gate),
    artifactHash: currentGateArtifactHash(episode, gate),
    reviewReportId: report?.id ?? episode.reviews?.[gate]?.latestReportId ?? null
  };
}

function scriptText(content) {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return null;
  const sections = Array.isArray(content.sections) ? content.sections : [];
  const narration = sections
    .map((section) => section?.narration)
    .filter((value) => typeof value === "string" && value.trim());
  return narration.length > 0 ? narration.join("\n") : JSON.stringify(content, null, 2);
}

function currentDraft(draft = {}) {
  return {
    version: draft.version ?? null,
    artifactPath: draft.artifactPath ?? draft.source ?? null,
    bytes: draft.bytes ?? null,
    sha256: draft.sha256 ?? null,
    generationKind: draft.generationKind ?? null,
    provider: draft.provider ?? null,
    model: draft.model ?? null,
    needsRevision: draft.needsRevision ?? false,
    sourceScriptVersion: draft.sourceScriptVersion ?? null,
    sourceScriptArtifactHash: draft.sourceScriptArtifactHash ?? null,
    sourceScriptReviewReportId: draft.sourceScriptReviewReportId ?? null,
    sourceSnapshotHash: draft.sourceSnapshotHash ?? null,
    visualRules: clone(draft.visualRules ?? []),
    assetChecklist: clone(draft.assetChecklist ?? [])
  };
}

function researchContent(episode, artifact) {
  const research = episode.research ?? {};
  const sourceIntegrity = inspectInlineResearchEvidence(episode);
  const candidate = artifact ?? research.content ?? null;
  const pack = candidate && typeof candidate === "object" ? candidate : null;
  const claims = (pack?.claims ?? []).map((claim) => ({
    id: claim.id ?? null,
    text: claim.text ?? null,
    category: claim.category ?? null,
    importance: claim.importance ?? null,
    support: claim.support ?? null,
    sourceIds: safeNestedValue(claim.sourceIds ?? []),
    boundary: claim.boundary ?? null,
    importedFrom: claim.importedFrom ?? null
  }));
  return {
    research: {
      status: research.status ?? pack?.status ?? null,
      version: research.version ?? null,
      packPath: research.packPath ?? null,
      assistTaskPath: research.assistTaskPath ?? null,
      lastImportedBatch: research.lastImportedBatch ?? null,
      readiness: clone(research.readiness ?? pack?.readiness ?? null),
      needsRevision: research.needsRevision ?? false
    },
    conclusions: claims,
    boundaries: claims.map((claim) => ({
      claimId: claim.id ?? null,
      conclusion: claim.text ?? null,
      support: claim.support ?? null,
      boundary: claim.boundary ?? null,
      sourceIds: clone(claim.sourceIds ?? [])
    })),
    sources: (pack?.sources ?? []).map((source) => ({
      id: source.id ?? null,
      label: source.label ?? null,
      url: safeUrl(source.url),
      publisher: source.publisher ?? null,
      sourceType: source.sourceType ?? null,
      provenance: source.provenance ?? null,
      evidenceStatus: source.evidenceStatus ?? null,
      evidenceSummary: source.evidenceSummary ?? null,
      locator: source.locator ?? null,
      contentHash: source.contentHash ?? null,
      verifiedAt: source.verifiedAt ?? null,
      access: safeNestedValue(source.access ?? null)
    })),
    claimRequirements: safeNestedValue(pack?.claimRequirements ?? []),
    marketContext: safeNestedValue(pack?.marketContext ?? null),
    productDecisions: safeNestedValue(pack?.productDecisions ?? []),
    sourceDocuments: (episode.sourceDocs ?? []).map(artifactRecord),
    sourceIntegrity: safeNestedValue(sourceIntegrity),
    artifactReadable: Boolean(pack) && sourceIntegrity.passed
  };
}

function scriptContent(episode, artifact) {
  const draft = episode.production?.scriptDraft ?? {};
  const content = draft.content ?? artifact ?? null;
  return {
    draft: currentDraft(draft),
    fullText: scriptText(content),
    structuredScript: safeNestedValue(content),
    sources: (episode.sourceDocs ?? []).map(artifactRecord),
    artifactReadable: content !== null
  };
}

function storyboardContent(episode) {
  const draft = episode.production?.storyboardDraft ?? {};
  return {
    draft: currentDraft(draft),
    // Show exactly the logical storyboard fields covered by Gate 3. Physical
    // asset/audio paths are intentionally reviewed later in the assets Gate.
    scenes: safeNestedValue(storyboardGateScenes(episode.scenes ?? [])),
    subtitles: safeNestedValue(episode.subtitles ?? []),
    renderSpecification: {
      width: episode.render?.width ?? null,
      height: episode.render?.height ?? null,
      fps: episode.render?.fps ?? null,
      durationSeconds: episode.render?.durationSeconds ?? null,
      compositionId: episode.render?.compositionId ?? null
    },
    artifactReadable: (episode.scenes?.length ?? 0) > 0
  };
}

function externalCallView(call = {}) {
  return {
    id: call.id ?? null,
    providerId: call.providerId ?? null,
    model: call.model ?? null,
    purpose: call.purpose ?? null,
    sceneIds: safeNestedValue(call.sceneIds ?? []),
    estimatedCalls: call.estimatedCalls ?? null,
    maximumCostUsd: call.maximumCostUsd ?? null,
    pricingSource: safeUrl(call.pricingSource),
    pricingCheckedAt: call.pricingCheckedAt ?? null,
    endpoint: /^https?:\/\//iu.test(String(call.endpoint ?? ""))
      ? safeUrl(call.endpoint)
      : safeText(call.endpoint ?? ""),
    prompt: call.prompt ?? null,
    outputSpec: call.outputSpec ?? null,
    billing: safeNestedValue(call.billing ?? null),
    requestParameters: safeNestedValue(call.requestParameters ?? null),
    executionPreflight: safeNestedValue(call.executionPreflight ?? null),
    visualContract: safeNestedValue(call.visualContract ?? null)
  };
}

function planItemView(item = {}) {
  return {
    id: item.id ?? null,
    assetType: item.assetType ?? null,
    purpose: item.purpose ?? null,
    sceneIds: safeNestedValue(item.sceneIds ?? []),
    required: item.required ?? null,
    sourceRequirement: item.sourceRequirement ?? null,
    productionMethod: safeNestedValue(item.productionMethod ?? null),
    estimatedCost: safeNestedValue(item.estimatedCost ?? null),
    notes: item.notes ?? null,
    visualContract: safeNestedValue(item.visualContract ?? null)
  };
}

function executionPolicyView(policy = {}) {
  return {
    mode: policy.mode ?? null,
    costScope: policy.costScope ?? null,
    maximumPaidCostUsd: policy.maximumPaidCostUsd ?? null,
    currency: policy.currency ?? null,
    billingCurrencies: safeNestedValue(policy.billingCurrencies ?? []),
    nativeCurrencyCaps: safeNestedValue(policy.nativeCurrencyCaps ?? []),
    budgetNormalization: safeNestedValue(policy.budgetNormalization ?? null),
    pricingConfirmed: policy.pricingConfirmed ?? null,
    humanApprovalRequiredBeforeExecution:
      policy.humanApprovalRequiredBeforeExecution ?? null,
    invalidatesOnPlanChange: policy.invalidatesOnPlanChange ?? null,
    externalApiCalls: (policy.externalApiCalls ?? []).map(externalCallView)
  };
}

function assetPlanContentView(content) {
  if (!content || typeof content !== "object") return null;
  return {
    visualSystem: content.visualSystem ?? null,
    visualRules: safeNestedValue(content.visualRules ?? []),
    sourceStoryboard: safeNestedValue(content.sourceStoryboard ?? null),
    generationProfile: content.generationProfile ?? null,
    items: (content.items ?? []).map(planItemView),
    voiceDirection: safeNestedValue(content.voiceDirection ?? null),
    executionPolicy: executionPolicyView(content.executionPolicy ?? {}),
    risks: safeNestedValue(content.risks ?? [])
  };
}

function voiceProvenanceView(provenance = {}) {
  return {
    schemaVersion: provenance.schemaVersion ?? null,
    source: provenance.source ?? null,
    candidateId: provenance.candidateId ?? null,
    candidateVersion: provenance.candidateVersion ?? null,
    candidateHash: provenance.candidateHash ?? null,
    machineVerificationId: provenance.machineVerificationId ?? null,
    candidateManifestPath: provenance.candidateManifestPath ?? null,
    candidateManifestBytes: provenance.candidateManifestBytes ?? null,
    candidateManifestSha256: provenance.candidateManifestSha256 ?? null,
    candidateWavPath: provenance.candidateWavPath ?? null,
    candidateWavBytes: provenance.candidateWavBytes ?? null,
    candidateWavSha256: provenance.candidateWavSha256 ?? null,
    pacingProfileVersion: provenance.pacingProfileVersion ?? null,
    offlineVerified: provenance.offlineVerified ?? null,
    externalApiCalls: provenance.externalApiCalls ?? null,
    maximumPaidCostUsd: provenance.maximumPaidCostUsd ?? null,
    ledgerHash: provenance.ledgerHash ?? null
  };
}

function voiceVerificationView(verification = {}) {
  return {
    schemaVersion: verification.schemaVersion ?? null,
    id: verification.id ?? null,
    verifierVersion: verification.verifierVersion ?? null,
    status: verification.status ?? null,
    candidateHash: verification.candidateHash ?? null,
    machineVerificationId: verification.machineVerificationId ?? null,
    verificationHash: verification.verificationHash ?? null,
    ledgerHash: verification.ledgerHash ?? null,
    checks: (verification.checks ?? []).map((check) =>
      typeof check === "string"
        ? {
            id: check,
            label: check,
            passed: verification.status === "passed",
            severity: null,
            location: null,
            actual: null,
            expected: null,
            suggestedFix: null,
            ownerAgentId: null
          }
        : checkView(check)
    )
  };
}

function voiceApprovalView(approval = {}) {
  return {
    schemaVersion: approval.schemaVersion ?? null,
    decision: approval.decision ?? null,
    approvedBy: approval.approvedBy ?? null,
    approvedAt: approval.approvedAt ?? null,
    scope: approval.scope ?? null,
    note: approval.note ?? null,
    candidateId: approval.candidateId ?? null,
    candidateHash: approval.candidateHash ?? null,
    candidateManifestSha256: approval.candidateManifestSha256 ?? null,
    candidateWavSha256: approval.candidateWavSha256 ?? null,
    machineVerificationId: approval.machineVerificationId ?? null,
    machineVerificationHash: approval.machineVerificationHash ?? null,
    verificationId: approval.verificationId ?? null
  };
}

function planArtifactContent(artifact) {
  return artifact?.plan ?? artifact?.content ?? artifact ?? null;
}

function planRecord(plan = {}, artifact = null, options = {}) {
  const artifactContent = planArtifactContent(artifact);
  const rawContent = options.artifactFirst
    ? artifactContent ?? plan.content ?? null
    : plan.content ?? artifactContent;
  return {
    version: plan.version ?? null,
    artifactPath: plan.artifactPath ?? null,
    bytes: plan.bytes ?? null,
    sha256: plan.sha256 ?? null,
    needsRevision: plan.needsRevision ?? false,
    content: assetPlanContentView(rawContent)
  };
}

function assetsContent(episode, artifact) {
  const plan = planRecord(episode.production?.assetPlan, artifact);
  const voicePlan = episode.production?.voicePlan ?? null;
  return {
    assetBundleRevision: episode.production?.assetBundleRevision ?? null,
    materialsVersion: episode.production?.materialsVersion ?? null,
    assetPlan: plan,
    voicePlan: voicePlan ? {
      ...currentDraft(voicePlan),
      content: clone(voicePlan.content ?? null),
      narration: voicePlan.narration ?? voicePlan.content?.narration ?? null
    } : null,
    assets: clone((episode.assets ?? []).map((asset) => ({
      id: asset.id ?? null,
      planItemId: asset.planItemId ?? null,
      type: asset.type ?? null,
      path: asset.path ?? null,
      source: asset.source ?? null,
      bytes: asset.bytes ?? null,
      sha256: asset.sha256 ?? null,
      privacy: asset.privacy ?? null,
      verified: asset.verified ?? null,
      verifiedAt: asset.verifiedAt ?? null,
      provenance: asset.provenance ?? null
    }))),
    voiceIntegrity: clone({
      status: episode.voice?.status ?? null,
      version: episode.voice?.version ?? null,
      mode: episode.voice?.mode ?? null,
      audioPath: episode.voice?.audioPath ?? null,
      publicPath: episode.voice?.publicPath ?? null,
      bytes: episode.voice?.bytes ?? null,
      sha256: episode.voice?.sha256 ?? null,
      durationSeconds: episode.voice?.durationSeconds ?? null,
      sampleRate: episode.voice?.sampleRate ?? null,
      channels: episode.voice?.channels ?? null,
      bitsPerSample: episode.voice?.bitsPerSample ?? null,
      provenance: voiceProvenanceView(episode.voice?.provenance),
      verification: voiceVerificationView(episode.voice?.verification),
      humanApproval: voiceApprovalView(episode.voice?.authorization)
    }),
    sceneBindings: (episode.scenes ?? []).map((scene) => ({
      id: scene.id ?? null,
      asset: clone(scene.asset ?? null),
      audio: clone(scene.audio ?? null)
    })),
    apiCost: clone({
      mode: plan.content?.executionPolicy?.mode ?? null,
      maximumPaidCostUsd: plan.content?.executionPolicy?.maximumPaidCostUsd ?? null,
      billingCurrencies: plan.content?.executionPolicy?.billingCurrencies ?? [],
      nativeCurrencyCaps: plan.content?.executionPolicy?.nativeCurrencyCaps ?? [],
      externalApiCalls: (plan.content?.executionPolicy?.externalApiCalls ?? [])
        .map(externalCallView)
    }),
    artifactReadable: Boolean(plan.content)
  };
}

function finalContent(episode) {
  return {
    video: {
      version: episode.render?.version ?? null,
      outputPath: episode.render?.outputPath ?? null,
      status: episode.render?.status ?? null,
      bytes: episode.render?.bytes ?? null,
      sha256: episode.render?.sha256 ?? null,
      width: episode.render?.width ?? null,
      height: episode.render?.height ?? null,
      fps: episode.render?.fps ?? null,
      durationSeconds: episode.render?.durationSeconds ?? null,
      compositionId: episode.render?.compositionId ?? null,
      muted: episode.render?.muted ?? null
    },
    qa: {
      status: episode.qa?.status ?? null,
      reportPath: episode.qa?.reportPath ?? null,
      checkedAt: episode.qa?.checkedAt ?? null,
      checks: clone(episode.qa?.checks ?? []),
      quality: clone(episode.qa?.quality ?? null)
    },
    artifactReadable: Boolean(episode.render?.outputPath && episode.render?.sha256)
  };
}

function formalContent(episode, gate, artifact) {
  if (gate === "research") return researchContent(episode, artifact);
  if (gate === "script") return scriptContent(episode, artifact);
  if (gate === "storyboard") return storyboardContent(episode);
  if (gate === "assets") return assetsContent(episode, artifact);
  return finalContent(episode);
}

function formalEvidence(episode, gate, content) {
  if (gate === "research") {
    return {
      artifact: artifactRecord({ path: content.research.packPath }),
      playablePreview: null,
      sources: clone(content.sources),
      files: clone(content.sourceDocuments)
    };
  }
  if (gate === "script") {
    return {
      artifact: artifactRecord({ path: content.draft.artifactPath }),
      playablePreview: null,
      sourceReferences: clone(content.sources)
    };
  }
  if (gate === "storyboard") {
    return {
      artifact: artifactRecord({ path: content.draft.artifactPath }),
      playablePreview: null,
      sceneCount: content.scenes.length,
      subtitleCount: content.subtitles.length
    };
  }
  if (gate === "assets") {
    return {
      artifact: artifactRecord({
        path: content.assetPlan.artifactPath,
        bytes: content.assetPlan.bytes,
        sha256: content.assetPlan.sha256
      }),
      playablePreview: content.voiceIntegrity.audioPath ? {
        kind: "audio",
        path: content.voiceIntegrity.audioPath,
        bytes: content.voiceIntegrity.bytes,
        sha256: content.voiceIntegrity.sha256,
        durationSeconds: content.voiceIntegrity.durationSeconds
      } : null,
      materials: clone(content.assets),
      voice: clone(content.voiceIntegrity)
    };
  }
  return {
    artifact: artifactRecord(content.video),
    playablePreview: content.video.outputPath ? {
      kind: "video",
      path: content.video.outputPath,
      bytes: content.video.bytes,
      sha256: content.video.sha256,
      durationSeconds: content.video.durationSeconds
    } : null,
    video: clone(content.video),
    qaReportPath: content.qa.reportPath
  };
}

function failedChecks(report) {
  return (report?.checks ?? []).filter((check) => check?.passed === false);
}

function dedupeRisks(risks) {
  const seen = new Set();
  return risks.filter((risk) => {
    const key = `${risk.code ?? "unknown"}\u0000${risk.location ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formalRisks(gate, content, report) {
  const risks = [
    ...(report?.blockingIssues ?? []).map((issue) => ({ level: "blocking", ...issueView(issue) })),
    ...(report?.warnings ?? []).map((warning) => ({ level: "warning", ...issueView(warning) })),
    ...failedChecks(report).map((check) => ({
      level: check.severity === "warning" ? "warning" : "blocking",
      code: check.code ?? check.id ?? "machine-check-failed",
      message: check.message ?? check.label ?? "机器检查未通过",
      location: check.location ?? null,
      suggestedFix: check.suggestedFix ?? null
    }))
  ];
  if (gate === "research") {
    for (const boundary of content.boundaries.filter((item) => item.support !== "supported")) {
      risks.push({
        level: "boundary",
        code: `research-${boundary.claimId ?? "claim"}`,
        message: boundary.conclusion,
        boundary: boundary.boundary,
        support: boundary.support
      });
    }
    if (!content.artifactReadable) {
      risks.push({ level: "blocking", code: "research-artifact-unreadable", message: "完整研究证据包不可读" });
    }
    for (const issue of content.sourceIntegrity?.issues ?? []) {
      risks.push({ level: "blocking", code: issue.code, message: issue.message });
    }
  }
  if (gate === "script" && !content.artifactReadable) {
    risks.push({ level: "blocking", code: "script-artifact-unreadable", message: "完整脚本正文不可读" });
  }
  if (gate === "storyboard" && !content.artifactReadable) {
    risks.push({ level: "blocking", code: "storyboard-empty", message: "分镜没有可审阅场景" });
  }
  if (gate === "assets") {
    for (const [index, risk] of (content.assetPlan.content?.risks ?? []).entries()) {
      risks.push({
        level: "plan",
        code: `asset-plan-risk-${index + 1}`,
        message: typeof risk === "string" ? risk : safeNestedValue(risk)
      });
    }
    if (!content.artifactReadable) {
      risks.push({ level: "blocking", code: "asset-plan-unreadable", message: "完整素材执行方案不可读" });
    }
    if (content.voiceIntegrity.status !== "ready") {
      risks.push({ level: "blocking", code: "voice-not-ready", message: "旁白尚未达到可试听、可校验状态" });
    }
    if ((content.apiCost.externalApiCalls?.length ?? 0) > 0) {
      risks.push({
        level: "cost",
        code: "external-api-cost",
        message: "批准素材 Gate 不等于批准付费 API 执行",
        maximumPaidCostUsd: content.apiCost.maximumPaidCostUsd,
        nativeCurrencyCaps: clone(content.apiCost.nativeCurrencyCaps)
      });
    }
  }
  if (gate === "final" && content.qa.status !== "passed") {
    risks.push({ level: "blocking", code: "final-qa-not-passed", message: "最终成片 QA 尚未通过" });
  }
  return dedupeRisks(risks);
}

function consequencesFor(gate) {
  const values = {
    research: {
      onApprove: ["锁定当前研究证据版本，并允许 Script Agent 继续"],
      doesNotHappen: ["不会调用生图、生视频或付费 API", "不会批准脚本、分镜、素材或成片"]
    },
    script: {
      onApprove: ["锁定当前脚本正文，并允许 Storyboard Agent 继续"],
      doesNotHappen: ["不会改写已批准研究结论", "不会生成素材、调用付费 API或发布视频"]
    },
    storyboard: {
      onApprove: ["锁定当前场景、字幕和视觉规则，并允许素材规划继续"],
      doesNotHappen: ["不会执行素材方案或产生费用", "不会批准素材、声音或最终成片"]
    },
    assets: {
      onApprove: ["锁定已登记素材和旁白，并允许渲染继续"],
      doesNotHappen: ["不会越过独立的素材执行费用检查点", "不会批准最终成片或自动发布"]
    },
    final: {
      onApprove: ["把当前哈希绑定的成片标记为项目内最终批准版本"],
      doesNotHappen: ["不会自动上传、发布、分享或覆盖外部平台内容"]
    }
  };
  return values[gate];
}

function gatePath(episodeId, gate, suffix = "") {
  return `/api/episodes/${episodeId}/approvals/${gate}${suffix}`;
}

function formalContentSummary(gate, content) {
  if (gate === "research") {
    return {
      sourceCount: content.sources.length,
      sourceIds: content.sources.map((item) => item.id ?? null),
      conclusionCount: content.conclusions.length,
      conclusionIds: content.conclusions.map((item) => item.id ?? null),
      boundaryCount: content.boundaries.length
    };
  }
  if (gate === "script") {
    return {
      characterCount: content.fullText?.length ?? 0,
      sectionIds: (content.structuredScript?.sections ?? []).map((item) => item.id ?? null),
      sourceReferenceCount: content.sources.length
    };
  }
  if (gate === "storyboard") {
    return {
      sceneCount: content.scenes.length,
      sceneIds: content.scenes.map((item) => item.id ?? null),
      subtitleCount: content.subtitles.length,
      subtitleIds: content.subtitles.map((item) => item.id ?? null),
      visualRuleCount: content.draft.visualRules.length
    };
  }
  if (gate === "assets") {
    return {
      itemIds: (content.assetPlan.content?.items ?? []).map((item) => item.id ?? null),
      productionMethods: [...new Set((content.assetPlan.content?.items ?? [])
        .map((item) => item.productionMethod?.kind)
        .filter(Boolean))],
      externalCallIds: (content.assetPlan.content?.executionPolicy?.externalApiCalls ?? [])
        .map((item) => item.id ?? null),
      maximumPaidCostUsd:
        content.assetPlan.content?.executionPolicy?.maximumPaidCostUsd ?? null,
      sourceStoryboard: safeNestedValue(content.assetPlan.content?.sourceStoryboard ?? null),
      materialIds: content.assets.map((item) => item.id ?? null),
      voiceSha256: content.voiceIntegrity.sha256
    };
  }
  return {
    outputPath: content.video.outputPath,
    sha256: content.video.sha256,
    bytes: content.video.bytes,
    width: content.video.width,
    height: content.video.height,
    fps: content.video.fps,
    durationSeconds: content.video.durationSeconds,
    qaStatus: content.qa.status,
    qaCheckIds: content.qa.checks.map((item) => item.id ?? item.code ?? null)
  };
}

function formalActions(episode, gate, binding, approveAllowed, rejectAllowed) {
  return [
    {
      id: "approve",
      label: "批准当前版本",
      method: "POST",
      path: gatePath(episode.id, gate),
      allowed: approveAllowed,
      requiresExactBinding: true,
      request: { ...binding, note: "" }
    },
    {
      id: "reject",
      label: "退回上层 Agent 修改",
      method: "POST",
      path: gatePath(episode.id, gate, "/reject"),
      allowed: rejectAllowed,
      requiresExactBinding: true,
      request: { ...binding, feedback: "" }
    }
  ];
}

function buildFormalView(episode, gate, artifact) {
  const definition = gateDefinitions.get(gate);
  const { review, report } = currentReview(episode, gate);
  const binding = formalBinding(episode, gate, report);
  const content = formalContent(episode, gate, artifact);
  const step = episode.pipeline?.find((item) => item.gate === gate) ?? null;
  const machinePassed = reviewPassedForGate(episode, gate);
  const awaitingHuman = step?.status === "waiting_approval"
    || (gate === "final" && episode.qa?.status === "passed");
  const completeForHumanReview = content.artifactReadable !== false;
  const bindingComplete = Boolean(
    Number.isInteger(binding.artifactVersion)
    && /^[a-f0-9]{64}$/u.test(String(binding.artifactHash ?? ""))
    && typeof binding.reviewReportId === "string"
    && binding.reviewReportId.trim()
  );
  const ready = machinePassed && awaitingHuman && completeForHumanReview && bindingComplete;
  const rejectAllowed = bindingComplete && (
    awaitingHuman || episode.approvals?.[gate]?.status === "approved"
  );
  const feedback = episode.production?.feedback?.[gate] ?? null;
  const feedbackAppliesToCurrentVersion = Boolean(
    feedback
    && Number.isInteger(feedback.version)
    && feedback.version === binding.artifactVersion
  );
  return {
    schemaVersion: HUMAN_APPROVAL_VIEW_VERSION,
    type: gate,
    episode: {
      id: episode.id,
      title: episode.title ?? null,
      concept: episode.concept ?? null
    },
    status: {
      approvalStatus: episode.approvals?.[gate]?.status ?? "pending",
      workflowStatus: step?.status ?? null,
      machineStatus: review?.status ?? "not_started",
      completeForHumanReview,
      bindingComplete,
      readyForHumanApproval: ready,
      needsRevision: Boolean(
        feedbackAppliesToCurrentVersion
        || content.research?.needsRevision
        || content.draft?.needsRevision
        || content.assetPlan?.needsRevision
      )
    },
    binding,
    approvalObject: {
      kind: "gate-artifact",
      label: definition.label,
      version: binding.artifactVersion,
      artifactHash: binding.artifactHash,
      summary: `审批 ${definition.label} v${binding.artifactVersion ?? "?"}，仅对当前哈希有效`
    },
    content,
    changes: {
      currentVersion: binding.artifactVersion,
      versionRecords: versionRecords(episode, gate),
      feedback: clone(episode.production?.feedback?.[gate] ?? episode.approvals?.[gate]?.feedback ?? null),
      contentComparisonAvailable: false,
      comparisonReason: "未安全加载上一版完整产物；本审批单不暗示已进行内容级前后比较",
      currentContentSummary: formalContentSummary(gate, content),
      previousContentSummary: null,
      changedIds: null,
      ...reviewDelta(review, report)
    },
    evidence: formalEvidence(episode, gate, content),
    risks: formalRisks(gate, content, report),
    machineReview: machineReviewView(report ?? {
      id: review?.latestReportId ?? null,
      status: review?.status ?? "not_started",
      artifactVersion: review?.artifactVersion ?? null,
      artifactHash: review?.artifactHash ?? null
    }),
    consequences: consequencesFor(gate),
    nextActions: formalActions(episode, gate, binding, ready, rejectAllowed)
  };
}

function assetExecutionContent(episode, checkpoint, artifact) {
  const currentPlan = episode.production?.assetPlan ?? {};
  const candidate = checkpoint.currentCandidate ?? {};
  const artifactContent = planArtifactContent(artifact);
  const currentContentHash = currentPlan.content ? integrityHash(currentPlan.content) : null;
  const artifactContentHash = artifactContent ? integrityHash(artifactContent) : null;
  const optionalFileMetadataMatches = Boolean(
    (!Number.isSafeInteger(currentPlan.bytes) || currentPlan.bytes === candidate.artifact?.bytes)
    && (!/^[a-f0-9]{64}$/u.test(String(currentPlan.sha256 ?? ""))
      || currentPlan.sha256 === candidate.artifact?.sha256)
  );
  const candidateMatchesCurrentPlan = Boolean(
    Number.isInteger(candidate.version)
    && currentPlan.version === candidate.version
    && currentPlan.artifactPath === candidate.artifact?.path
    && optionalFileMetadataMatches
    && currentContentHash === candidate.planHash
    && artifactContentHash === candidate.planHash
  );
  const displayedPlan = {
    ...currentPlan,
    version: candidate.version ?? null,
    artifactPath: candidate.artifact?.path ?? null,
    bytes: candidate.artifact?.bytes ?? null,
    sha256: candidate.artifact?.sha256 ?? null,
    content: candidateMatchesCurrentPlan ? artifactContent : null
  };
  const plan = planRecord(displayedPlan, artifact, { artifactFirst: true });
  return {
    candidate: assetExecutionCandidateView(checkpoint.currentCandidate),
    plan,
    items: safeNestedValue(plan.content?.items ?? []),
    executionPolicy: safeNestedValue(plan.content?.executionPolicy ?? null),
    prompts: (plan.content?.executionPolicy?.externalApiCalls ?? []).map(externalCallView),
    voicePlan: episode.production?.voicePlan ? {
      ...currentDraft(episode.production.voicePlan),
      narration: episode.production.voicePlan.narration
        ?? episode.production.voicePlan.content?.narration
        ?? null
    } : null,
    voiceIntegrity: clone({
      status: episode.voice?.status ?? null,
      version: episode.voice?.version ?? null,
      audioPath: episode.voice?.audioPath ?? null,
      bytes: episode.voice?.bytes ?? null,
      sha256: episode.voice?.sha256 ?? null,
      durationSeconds: episode.voice?.durationSeconds ?? null,
      verification: voiceVerificationView(episode.voice?.verification),
      humanApproval: voiceApprovalView(episode.voice?.authorization)
    }),
    artifactReadable: Boolean(plan.content),
    candidateMatchesCurrentPlan,
    contentHashes: {
      candidatePlanHash: candidate.planHash ?? null,
      currentPlanHash: currentContentHash,
      displayedArtifactPlanHash: artifactContentHash
    }
  };
}

function assetExecutionCandidateView(candidate = {}) {
  return {
    episodeId: candidate.episodeId ?? null,
    version: candidate.version ?? null,
    candidateHash: candidate.candidateHash ?? null,
    planHash: candidate.planHash ?? null,
    artifact: artifactRecord(candidate.artifact ?? {}),
    sourceStoryboard: safeNestedValue(candidate.sourceStoryboard ?? null),
    localCodeImplementation: candidate.localCodeImplementation ? {
      schemaVersion: candidate.localCodeImplementation.schemaVersion ?? null,
      componentId: candidate.localCodeImplementation.componentId ?? null,
      sha256: candidate.localCodeImplementation.sha256 ?? null,
      files: (candidate.localCodeImplementation.files ?? []).map(artifactRecord)
    } : null,
    summary: {
      itemCount: candidate.summary?.itemCount ?? null,
      requiredVisualItemCount: candidate.summary?.requiredVisualItemCount ?? null,
      productionMethods: safeNestedValue(candidate.summary?.productionMethods ?? []),
      externalApiCallCount: candidate.summary?.externalApiCallCount ?? null,
      externalApiCalls: (candidate.summary?.externalApiCalls ?? []).map(externalCallView),
      maximumPaidCostUsd: candidate.summary?.maximumPaidCostUsd ?? null,
      currency: candidate.summary?.currency ?? null,
      billingCurrencies: safeNestedValue(candidate.summary?.billingCurrencies ?? []),
      nativeCurrencyCaps: safeNestedValue(candidate.summary?.nativeCurrencyCaps ?? []),
      budgetNormalization: safeNestedValue(candidate.summary?.budgetNormalization ?? null),
      costScope: candidate.summary?.costScope ?? null,
      pricingConfirmed: candidate.summary?.pricingConfirmed ?? null
    }
  };
}

function assetPlanStructure(content) {
  if (!content) return null;
  const policy = content.executionPolicy ?? {};
  return {
    sourceStoryboard: safeNestedValue(content.sourceStoryboard ?? null),
    items: (content.items ?? []).map((item) => ({
      id: item.id ?? null,
      sceneIds: safeNestedValue(item.sceneIds ?? []),
      productionMethod: safeNestedValue(item.productionMethod ?? null)
    })),
    executionPolicy: {
      mode: policy.mode ?? null,
      maximumPaidCostUsd: policy.maximumPaidCostUsd ?? null,
      currency: policy.currency ?? null,
      billingCurrencies: safeNestedValue(policy.billingCurrencies ?? []),
      nativeCurrencyCaps: safeNestedValue(policy.nativeCurrencyCaps ?? []),
      externalApiCalls: (policy.externalApiCalls ?? []).map((call) => ({
        id: call.id ?? null,
        providerId: call.providerId ?? null,
        model: call.model ?? null,
        sceneIds: safeNestedValue(call.sceneIds ?? []),
        estimatedCalls: call.estimatedCalls ?? null,
        maximumCostUsd: call.maximumCostUsd ?? null,
        billing: safeNestedValue(call.billing ?? null)
      }))
    },
    risks: safeNestedValue(content.risks ?? [])
  };
}

function changedRecordIds(previousRecords, currentRecords) {
  const previous = new Map(previousRecords.map((item) => [item.id, item]));
  const current = new Map(currentRecords.map((item) => [item.id, item]));
  return {
    added: [...current.keys()].filter((id) => !previous.has(id)),
    removed: [...previous.keys()].filter((id) => !current.has(id)),
    changed: [...current.keys()].filter(
      (id) => previous.has(id) && integrityHash(previous.get(id)) !== integrityHash(current.get(id))
    )
  };
}

function assetPlanStructuralDiff(previousContent, currentContent) {
  const previous = assetPlanStructure(previousContent);
  const current = assetPlanStructure(currentContent);
  if (!previous || !current) return null;
  const itemIds = changedRecordIds(previous.items, current.items);
  const callIds = changedRecordIds(
    previous.executionPolicy.externalApiCalls,
    current.executionPolicy.externalApiCalls
  );
  const sourceStoryboardChanged =
    integrityHash(previous.sourceStoryboard) !== integrityHash(current.sourceStoryboard);
  const executionPolicyChanged =
    integrityHash(previous.executionPolicy) !== integrityHash(current.executionPolicy);
  const risksChanged = integrityHash(previous.risks) !== integrityHash(current.risks);
  const unchanged = Boolean(
    itemIds.added.length === 0
    && itemIds.removed.length === 0
    && itemIds.changed.length === 0
    && callIds.added.length === 0
    && callIds.removed.length === 0
    && callIds.changed.length === 0
    && !sourceStoryboardChanged
    && !executionPolicyChanged
    && !risksChanged
  );
  return {
    unchanged,
    summary: unchanged
      ? "结构内容无变化，仅候选版本或审核状态重建"
      : "结构内容存在可验证变化，请逐项核对新增、删除和修改记录",
    itemIds,
    externalCallIds: callIds,
    sourceStoryboardChanged,
    executionPolicyChanged,
    risksChanged,
    previous,
    current
  };
}

function buildAssetExecutionView(episode, artifact, previousArtifact = null, previousCandidate = null) {
  const checkpoint = assetExecutionCheckpointState(episode.reviewCheckpoints?.assetExecution);
  const content = assetExecutionContent(episode, checkpoint, artifact);
  const candidate = checkpoint.currentCandidate;
  const machineReview = checkpoint.machineReview;
  const binding = {
    candidateVersion: candidate?.version ?? null,
    candidateHash: candidate?.candidateHash ?? null,
    machineReviewId: machineReview?.id ?? null,
    planHash: candidate?.planHash ?? null
  };
  const bindingComplete = Boolean(
    Number.isInteger(binding.candidateVersion)
    && /^[a-f0-9]{64}$/u.test(String(binding.candidateHash ?? ""))
    && typeof binding.machineReviewId === "string"
    && binding.machineReviewId.trim()
    && /^[a-f0-9]{64}$/u.test(String(binding.planHash ?? ""))
  );
  const ready = Boolean(
    checkpoint.status === "waiting_approval"
    && machineReview?.status === "passed"
    && machineReview.candidateHash === candidate?.candidateHash
    && bindingComplete
    && content.artifactReadable
    && content.candidateMatchesCurrentPlan
  );
  const summary = candidate?.summary ?? {};
  const structuralDiff = assetPlanStructuralDiff(
    planArtifactContent(previousArtifact),
    planArtifactContent(artifact) ?? episode.production?.assetPlan?.content ?? null
  );
  const risks = [
    ...(machineReview?.checks ?? []).filter((check) => check?.passed === false).map((check) => ({
      level: "blocking",
      code: check.id ?? "machine-check-failed",
      message: check.label ?? "素材执行机器检查未通过",
      actual: safeNestedValue(check.actual),
      expected: safeNestedValue(check.expected),
      suggestedFix: check.suggestedFix ?? null
    }))
  ];
  for (const [index, risk] of (content.plan.content?.risks ?? []).entries()) {
    risks.push({
      level: "plan",
      code: `asset-execution-plan-risk-${index + 1}`,
      message: typeof risk === "string" ? risk : safeNestedValue(risk)
    });
  }
  if (!content.artifactReadable) {
    risks.push({ level: "blocking", code: "asset-plan-unreadable", message: "完整素材执行方案不可读" });
  }
  if (!content.candidateMatchesCurrentPlan) {
    risks.push({
      level: "blocking",
      code: "asset-execution-current-plan-mismatch",
      message: "当前 Episode 素材方案与机器审核候选的版本、路径、文件摘要或内容哈希不一致，必须重新审核"
    });
  }
  if ((summary.externalApiCallCount ?? 0) > 0) {
    risks.push({
      level: "cost",
      code: "paid-api-execution",
      message: "批准后仅授权清单内的外部调用与费用上限",
      externalApiCallCount: summary.externalApiCallCount,
      maximumPaidCostUsd: summary.maximumPaidCostUsd,
      nativeCurrencyCaps: clone(summary.nativeCurrencyCaps ?? [])
    });
  }
  const path = `/api/episodes/${episode.id}/asset-execution-review`;
  return {
    schemaVersion: HUMAN_APPROVAL_VIEW_VERSION,
    type: "assetExecution",
    episode: { id: episode.id, title: episode.title ?? null, concept: episode.concept ?? null },
    status: {
      approvalStatus: checkpoint.status,
      workflowStatus: episode.pipeline?.find((step) => step.agent === "asset-agent")?.status ?? null,
      machineStatus: machineReview?.status ?? "not_started",
      completeForHumanReview: content.artifactReadable,
      bindingComplete,
      candidateMatchesCurrentPlan: content.candidateMatchesCurrentPlan,
      readyForHumanApproval: ready,
      needsRevision: Boolean(episode.production?.assetPlan?.needsRevision)
    },
    binding,
    approvalObject: {
      kind: "asset-execution-candidate",
      label: "素材执行与费用授权",
      version: binding.candidateVersion,
      artifactHash: binding.candidateHash,
      summary: `审批素材执行候选 v${binding.candidateVersion ?? "?"}，仅授权列明的工具、调用与费用上限`
    },
    content,
    changes: {
      currentVersion: binding.candidateVersion,
      previousVersion: [...checkpoint.history].reverse().find(
        (item) => (item.candidate?.version ?? item.version) !== binding.candidateVersion
      )?.candidate?.version
        ?? [...checkpoint.history].reverse().find(
          (item) => item.version !== binding.candidateVersion
        )?.version
        ?? null,
      feedback: clone(episode.production?.feedback?.assetExecution ?? null),
      strategy: episode.production?.assetPlanDirection?.strategy ?? null,
      generationProfile: episode.production?.assetPlanDirection?.generationProfile ?? null,
      contentComparisonAvailable: Boolean(structuralDiff),
      comparisonReason: structuralDiff
        ? null
        : "未安全加载并校验上一版完整素材方案；本审批单不暗示已进行内容级前后比较",
      currentContentSummary: {
        itemIds: content.items.map((item) => item.id ?? null),
        productionMethods: [...new Set(content.items
          .map((item) => item.productionMethod?.kind)
          .filter(Boolean))],
        externalCallIds: (content.executionPolicy?.externalApiCalls ?? [])
          .map((item) => item.id ?? null),
        maximumPaidCostUsd: content.executionPolicy?.maximumPaidCostUsd ?? null,
        sourceStoryboard: safeNestedValue(content.plan.content?.sourceStoryboard ?? null),
        planHash: binding.planHash
      },
      previousContentSummary: structuralDiff?.previous ?? null,
      changedIds: structuralDiff ? {
        items: structuralDiff.itemIds,
        externalCalls: structuralDiff.externalCallIds
      } : null,
      deterministicDiff: structuralDiff ? {
        unchanged: structuralDiff.unchanged,
        summary: structuralDiff.summary,
        sourceStoryboardChanged: structuralDiff.sourceStoryboardChanged,
        executionPolicyChanged: structuralDiff.executionPolicyChanged,
        risksChanged: structuralDiff.risksChanged,
        previousCandidate: assetExecutionCandidateView(previousCandidate)
      } : null
    },
    evidence: {
      planArtifact: artifactRecord({
        path: content.plan.artifactPath,
        bytes: content.plan.bytes,
        sha256: content.plan.sha256
      }),
      playablePreview: null,
      candidateArtifact: artifactRecord(candidate?.artifact ?? {}),
      localCodeImplementation: clone(content.candidate.localCodeImplementation),
      voice: clone(content.voiceIntegrity)
    },
    risks,
    machineReview: machineReviewView(machineReview),
    consequences: {
      onApprove: ["仅授权当前候选列明的执行器、外部调用次数和费用上限", "允许 Asset Agent 继续执行已批准方案"],
      doesNotHappen: ["不会授权方案之外的模型、请求或费用", "不会批准素材 Gate、最终成片或自动发布"]
    },
    nextActions: [
      {
        id: "approve",
        label: "批准当前执行方案",
        method: "POST",
        path: `${path}/approve`,
        allowed: ready,
        requiresExactBinding: true,
        request: { candidateHash: binding.candidateHash, machineReviewId: binding.machineReviewId, note: "" }
      },
      {
        id: "reject",
        label: "退回 Asset Agent 修改",
        method: "POST",
        path: `${path}/reject`,
        allowed: bindingComplete && new Set(["waiting_approval", "approved"]).has(checkpoint.status),
        requiresExactBinding: true,
        request: { candidateHash: binding.candidateHash, machineReviewId: binding.machineReviewId, feedback: "" }
      }
    ]
  };
}

function visualProofCandidateView(candidate = {}) {
  return {
    episodeId: candidate.episodeId ?? null,
    version: candidate.version ?? null,
    sourceRenderVersion: candidate.sourceRenderVersion ?? null,
    candidateHash: candidate.candidateHash ?? null,
    manifest: artifactRecord(candidate.manifest ?? {}),
    video: artifactRecord(candidate.video ?? {}),
    qa: {
      ...artifactRecord(candidate.qa ?? {}),
      result: candidate.qa?.result ?? null
    },
    comparison: artifactRecord(candidate.comparison ?? {})
  };
}

function buildVisualProofView(episode, inspection = null) {
  const checkpoint = episode.reviewCheckpoints?.visualProof ?? {};
  const candidate = checkpoint.currentCandidate ?? null;
  const machineReview = checkpoint.machineReview ?? null;
  const binding = {
    candidateVersion: candidate?.version ?? null,
    candidateHash: candidate?.candidateHash ?? null,
    machineReviewId: machineReview?.id ?? null
  };
  const bindingComplete = Boolean(
    Number.isInteger(binding.candidateVersion)
    && /^[a-f0-9]{64}$/u.test(String(binding.candidateHash ?? ""))
    && typeof binding.machineReviewId === "string"
    && binding.machineReviewId.trim()
  );
  const inspectionVerified = Boolean(
    inspection?.passed === true
    && inspection.candidate?.candidateHash === candidate?.candidateHash
  );
  const ready = Boolean(
    checkpoint.status === "waiting_approval"
    && machineReview?.status === "passed"
    && machineReview.candidateHash === candidate?.candidateHash
    && bindingComplete
    && inspectionVerified
  );
  const risks = (machineReview?.checks ?? [])
    .filter((check) => check?.passed === false)
    .map((check) => ({
      level: "blocking",
      code: check.id ?? "visual-proof-check-failed",
      message: check.label ?? "视觉样片机器检查未通过",
      actual: safeNestedValue(check.actual ?? null),
      expected: safeNestedValue(check.expected ?? null)
    }));
  risks.push({
    level: "workflow-boundary",
    code: "visual-proof-reject-route-unavailable",
    message: "当前视觉样片 checkpoint 尚无安全的人工退回路由；发现问题时不得批准，应关闭并由编排器重新生成或重审"
  });
  if (!inspectionVerified) {
    risks.push({
      level: "blocking",
      code: "visual-proof-evidence-unverified",
      message: "视觉样片文件尚未按当前候选哈希完成完整性复核"
    });
  }
  const displayedCandidate = inspectionVerified ? inspection.candidate : candidate;
  const content = {
    candidate: visualProofCandidateView(displayedCandidate),
    artifactReadable: Boolean(inspectionVerified
      &&
      candidate?.manifest?.path
      && candidate?.video?.path
      && candidate?.qa?.path
      && candidate?.comparison?.path
    )
  };
  const path = `/api/episodes/${episode.id}/visual-proof-review/approve`;
  return {
    schemaVersion: HUMAN_APPROVAL_VIEW_VERSION,
    type: "visualProof",
    episode: { id: episode.id, title: episode.title ?? null, concept: episode.concept ?? null },
    status: {
      approvalStatus: checkpoint.status ?? "not_started",
      workflowStatus: null,
      machineStatus: machineReview?.status ?? "not_started",
      completeForHumanReview: content.artifactReadable,
      bindingComplete,
      readyForHumanApproval: ready && content.artifactReadable,
      canReject: false,
      rejectReason: "尚未定义不会误伤正式 Final Gate 的视觉样片人工退回 owner 与状态迁移"
    },
    binding,
    approvalObject: {
      kind: "visual-proof-candidate",
      label: "视觉样片证明",
      version: binding.candidateVersion,
      artifactHash: binding.candidateHash,
      summary: `审批视觉样片候选 v${binding.candidateVersion ?? "?"}，只作用于视觉样片 checkpoint`
    },
    content,
    changes: {
      currentVersion: binding.candidateVersion,
      contentComparisonAvailable: false,
      comparisonReason: "视觉样片 checkpoint 尚未保存可验证的上一版内容快照",
      currentContentSummary: {
        sourceRenderVersion: displayedCandidate?.sourceRenderVersion ?? null,
        videoPath: displayedCandidate?.video?.path ?? null,
        videoSha256: displayedCandidate?.video?.sha256 ?? null,
        qaResult: displayedCandidate?.qa?.result ?? null
      },
      previousContentSummary: null,
      changedIds: null
    },
    evidence: {
      artifact: artifactRecord(displayedCandidate?.manifest ?? {}),
      playablePreview: inspectionVerified && displayedCandidate?.video?.path ? {
        kind: "video",
        path: displayedCandidate.video.path,
        bytes: displayedCandidate.video.bytes ?? null,
        sha256: displayedCandidate.video.sha256 ?? null,
        durationSeconds: null
      } : null,
      qa: clone(content.candidate.qa),
      comparison: clone(content.candidate.comparison)
    },
    risks,
    machineReview: machineReviewView(machineReview),
    consequences: {
      onApprove: ["只把当前哈希绑定的视觉样片 checkpoint 标记为人工通过"],
      doesNotHappen: ["不会批准素材 Gate 或最终成片", "不会自动上传、发布或调用付费 API"]
    },
    nextActions: [{
      id: "approve",
      label: "批准当前视觉样片",
      method: "POST",
      path,
      allowed: ready && content.artifactReadable,
      requiresExactBinding: true,
      request: {
        candidateHash: binding.candidateHash,
        machineReviewId: binding.machineReviewId,
        note: ""
      }
    }]
  };
}

async function defaultReadArtifact(path) {
  if (typeof path !== "string" || !path.trim()) return null;
  const lexicalPath = ensureInside(workspaceRoot, resolve(workspaceRoot, path));
  const lexicalDetails = await lstat(lexicalPath);
  if (lexicalDetails.isSymbolicLink()) {
    const error = new Error("待审批产物不能是符号链接");
    error.code = "approval_artifact_symlink_forbidden";
    throw error;
  }
  const [realRoot, realTarget] = await Promise.all([
    realpath(workspaceRoot),
    realpath(lexicalPath)
  ]);
  ensureInside(realRoot, realTarget);
  const handle = await open(
    realTarget,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  );
  try {
    const details = await handle.stat();
    if (!details.isFile()) {
      const error = new Error("待审批产物不是普通文件");
      error.code = "approval_artifact_not_regular_file";
      throw error;
    }
    if (details.size > 10 * 1024 * 1024) {
      const error = new Error("待审批文本产物超过 10 MB 展示上限");
      error.code = "approval_artifact_too_large";
      throw error;
    }
    const body = await handle.readFile();
    if (body.length !== details.size) {
      const error = new Error("待审批产物在读取期间发生变化");
      error.code = "approval_artifact_changed_during_read";
      throw error;
    }
    return {
      text: body.toString("utf8"),
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex")
    };
  } finally {
    await handle.close();
  }
}

function normalizedArtifactRead(value) {
  let text;
  if (typeof value === "string") text = value;
  else if (Buffer.isBuffer(value)) text = value.toString("utf8");
  else if (typeof value?.text === "string") text = value.text;
  else text = JSON.stringify(value);
  const body = Buffer.from(text, "utf8");
  return {
    text,
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex")
  };
}

function registeredArtifactIntegrity(episode, target, path) {
  if (target === "research") {
    const source = (episode.sourceDocs ?? []).find((item) => item.path === path);
    return source ? artifactRecord(source) : null;
  }
  if (target === "script") {
    const draft = episode.production?.scriptDraft;
    return draft?.artifactPath === path ? artifactRecord(draft) : null;
  }
  if (target === "asset-execution") {
    const candidate = episode.reviewCheckpoints?.assetExecution?.currentCandidate?.artifact;
    if (candidate?.path === path) return artifactRecord(candidate);
  }
  if (target === "assets") {
    const plan = episode.production?.assetPlan;
    if (plan?.artifactPath !== path) return null;
    if (
      Number.isSafeInteger(plan.bytes)
      && plan.bytes > 0
      && /^[a-f0-9]{64}$/u.test(String(plan.sha256 ?? ""))
    ) {
      return artifactRecord(plan);
    }
    const checkpoint = episode.reviewCheckpoints?.assetExecution;
    const candidate = checkpoint?.status === "approved"
      ? checkpoint.currentCandidate?.artifact
      : null;
    return candidate?.path === path ? artifactRecord(candidate) : null;
  }
  return null;
}

function assertRegisteredArtifactIntegrity(episode, target, path, actual) {
  const expected = registeredArtifactIntegrity(episode, target, path);
  if (
    !expected
    || !Number.isSafeInteger(expected.bytes)
    || expected.bytes < 1
    || !/^[a-f0-9]{64}$/u.test(String(expected.sha256 ?? ""))
  ) {
    const error = new Error("待审批完整产物尚未登记可核对的字节数和 SHA-256");
    error.code = "approval_artifact_integrity_unregistered";
    throw error;
  }
  if (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
    const error = new Error("待审批完整产物与 Episode 登记的完整性摘要不一致");
    error.code = "approval_artifact_integrity_mismatch";
    throw error;
  }
}

function assertSnapshotArtifactIntegrity(candidate, actual) {
  const expected = candidate?.artifact;
  if (
    !expected
    || !Number.isSafeInteger(expected.bytes)
    || expected.bytes < 1
    || !/^[a-f0-9]{64}$/u.test(String(expected.sha256 ?? ""))
    || !/^[a-f0-9]{64}$/u.test(String(candidate?.planHash ?? ""))
  ) {
    const error = new Error("上一版候选没有完整的文件与内容摘要");
    error.code = "previous_asset_candidate_integrity_unregistered";
    throw error;
  }
  if (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256) {
    const error = new Error("上一版候选文件与保存的摘要不一致");
    error.code = "previous_asset_candidate_integrity_mismatch";
    throw error;
  }
}

function artifactPathFor(episode, target) {
  if (target === "research") return episode.research?.packPath ?? null;
  if (target === "script") {
    const draft = episode.production?.scriptDraft;
    return draft?.content === null || draft?.content === undefined
      ? draft?.artifactPath ?? null
      : null;
  }
  if (target === "asset-execution") {
    return episode.reviewCheckpoints?.assetExecution?.currentCandidate?.artifact?.path ?? null;
  }
  if (target === "assets") {
    const plan = episode.production?.assetPlan;
    return plan?.content === null || plan?.content === undefined
      ? plan?.artifactPath ?? null
      : null;
  }
  return null;
}

function parseArtifact(target, text) {
  if (text === null || text === undefined) return null;
  if (typeof text !== "string") return clone(text);
  if (target === "script" && !text.trim().startsWith("{")) return text;
  try {
    return JSON.parse(text);
  } catch {
    return target === "script" ? text : null;
  }
}

function redactView(view) {
  return redactSensitiveValue(safeNestedValue(view), {
    maximumArrayLength: 1_000,
    maximumStringLength: 100_000,
    maximumDepth: 24
  });
}

export function buildHumanApprovalView(episode, target, options = {}) {
  if (!targets.has(target)) {
    const error = new Error(`未知人工审批对象：${target}`);
    error.code = "human_approval_view_not_found";
    error.statusCode = 404;
    throw error;
  }
  const artifact = options.artifact ?? null;
  const view = target === "asset-execution"
    ? buildAssetExecutionView(
        episode,
        artifact,
        options.previousArtifact ?? null,
        options.previousCandidate ?? null
      )
    : target === "visual-proof"
      ? buildVisualProofView(episode, options.visualProofInspection ?? null)
      : buildFormalView(episode, target, artifact);
  return redactView(view);
}

export async function getHumanApprovalView(episodeId, target, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const episode = await readState(episodeId);
  let visualProofInspection = options.visualProofInspection ?? null;
  let visualProofInspectionError = null;
  if (target === "visual-proof" && visualProofInspection === null) {
    const checkpoint = episode.reviewCheckpoints?.visualProof;
    const candidate = checkpoint?.currentCandidate;
    try {
      if (!candidate || !checkpoint?.machineReview) {
        const error = new Error("视觉样片尚无可复核候选");
        error.code = "visual_proof_review_missing";
        throw error;
      }
      const inspectProof = options.inspectVisualProofCandidate ?? inspectVisualProofCandidate;
      visualProofInspection = await inspectProof(episodeId, {
        manifestPath: candidate.manifest?.path,
        qaReportPath: candidate.qa?.path,
        comparisonPath: candidate.comparison?.path
      }, options);
      if (
        !visualProofInspection?.passed
        || visualProofInspection.candidate?.candidateHash !== candidate.candidateHash
        || checkpoint.machineReview.status !== "passed"
        || checkpoint.machineReview.candidateHash !== candidate.candidateHash
      ) {
        const error = new Error("视觉样片文件或机器审核绑定已变化");
        error.code = "visual_proof_review_stale";
        throw error;
      }
    } catch (error) {
      visualProofInspection = null;
      visualProofInspectionError = {
        code: error?.code ?? "visual_proof_evidence_unreadable",
        message: "视觉样片证据无法按当前机器审核绑定安全复核"
      };
    }
  }
  const path = artifactPathFor(episode, target);
  let artifact = options.artifact ?? null;
  let artifactLoadError = null;
  const readArtifact = options.readApprovalArtifact ?? defaultReadArtifact;
  if (artifact === null && path) {
    try {
      const artifactRead = normalizedArtifactRead(await readArtifact(path));
      assertRegisteredArtifactIntegrity(episode, target, path, artifactRead);
      artifact = parseArtifact(target, artifactRead.text);
    } catch (error) {
      artifactLoadError = {
        code: error?.code ?? "approval_artifact_unreadable",
        message: "待审批完整产物无法安全读取"
      };
    }
  }
  let previousArtifact = options.previousArtifact ?? null;
  let previousCandidate = options.previousCandidate ?? null;
  let previousArtifactLoadError = null;
  if (target === "asset-execution" && previousCandidate === null) {
    previousCandidate = [...(episode.reviewCheckpoints?.assetExecution?.history ?? [])]
      .reverse()
      .find((entry) => entry.type === "candidate-superseded" && entry.candidate)?.candidate
      ?? null;
  }
  if (
    target === "asset-execution"
    && previousArtifact === null
    && previousCandidate?.artifact?.path
  ) {
    try {
      const previousRead = normalizedArtifactRead(
        await readArtifact(previousCandidate.artifact.path)
      );
      assertSnapshotArtifactIntegrity(previousCandidate, previousRead);
      previousArtifact = parseArtifact(target, previousRead.text);
      const previousContent = planArtifactContent(previousArtifact);
      if (!previousContent || integrityHash(previousContent) !== previousCandidate.planHash) {
        const error = new Error("上一版素材方案内容哈希与候选快照不一致");
        error.code = "previous_asset_candidate_plan_hash_mismatch";
        throw error;
      }
    } catch (error) {
      previousArtifact = null;
      previousArtifactLoadError = {
        code: error?.code ?? "previous_asset_candidate_unreadable",
        message: "上一版素材候选无法安全读取，未展示内容级差异"
      };
    }
  }
  const view = buildHumanApprovalView(episode, target, {
    artifact,
    visualProofInspection,
    previousArtifact,
    previousCandidate
  });
  if (artifactLoadError) {
    view.status.completeForHumanReview = false;
    view.status.readyForHumanApproval = false;
    view.risks.push({ level: "blocking", ...artifactLoadError });
    const approveAction = view.nextActions.find((action) => action.id === "approve");
    if (approveAction) approveAction.allowed = false;
  }
  if (visualProofInspectionError) {
    view.status.completeForHumanReview = false;
    view.status.readyForHumanApproval = false;
    view.evidence.playablePreview = null;
    view.risks.push({ level: "blocking", ...visualProofInspectionError });
    const approveAction = view.nextActions.find((action) => action.id === "approve");
    if (approveAction) approveAction.allowed = false;
  }
  if (previousArtifactLoadError) {
    view.risks.push({ level: "warning", ...previousArtifactLoadError });
  }
  return view;
}
