import { readFile } from "node:fs/promises";
import {
  createReviewMap,
  createReviewState,
  ensureAgentArchitecture,
  validateReviewResult
} from "../../shared/agent-contracts.mjs";
import { reviewRubricsConfigPath } from "../../shared/paths.mjs";
import {
  currentGateArtifactHash,
  currentGateVersion
} from "../../shared/workflow.mjs";
import { issueFromCheck, reviewCheck } from "./checks.mjs";
import { runStageRubric } from "./rubrics/index.mjs";
import { validateEpisodeForReview } from "./validators/episode.mjs";
import { validateTimelineForReview } from "./validators/timeline.mjs";
import { validateAssetsForReview } from "./validators/assets.mjs";
import { validateMediaForReview } from "./validators/media.mjs";
import { assertVersionedConfig } from "../../shared/config-integrity.mjs";
import { buildSemanticReviewContext } from "./context.mjs";

function mergePatch(target, patch) {
  const result = { ...(target ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    result[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? mergePatch(target?.[key] ?? {}, value)
        : value;
  }
  return result;
}

export async function readReviewConfig(options = {}) {
  if (options.config) return options.config;
  const config = JSON.parse(await readFile(reviewRubricsConfigPath, "utf8"));
  assertVersionedConfig("review-rubrics", config);
  return config;
}

function revisionPatch(stage, issues = []) {
  if (stage === "research") return { research: { needsRevision: true } };
  if (stage === "script") return { production: { scriptDraft: { needsRevision: true } } };
  if (stage === "storyboard") {
    return { production: { storyboardDraft: { needsRevision: true } } };
  }
  if (stage === "assets") {
    const owners = new Set(issues.map((issue) => issue.ownerAgentId).filter(Boolean));
    const reviseStoryboard = owners.has("storyboard-agent");
    const reviseAssets = owners.size === 0 || owners.has("asset-agent");
    const reviseVoice = owners.size === 0 || owners.has("voice-agent");
    return mergePatch(
      reviseStoryboard ? { production: { storyboardDraft: { needsRevision: true } } } : {},
      mergePatch(
        reviseAssets ? { production: { assetPlan: { needsRevision: true } } } : {},
        reviseVoice ? { voice: { needsRevision: true } } : {}
      )
    );
  }
  if (stage === "final") {
    const owners = new Set(issues.map((issue) => issue.ownerAgentId).filter(Boolean));
    return mergePatch(
      owners.has("storyboard-agent")
        ? { production: { storyboardDraft: { needsRevision: true } } }
        : {},
      mergePatch(
        owners.has("asset-agent")
          ? { production: { assetPlan: { needsRevision: true } } }
          : {},
        mergePatch(
          owners.has("voice-agent") ? { voice: { needsRevision: true } } : {},
          {
            render: { needsRevision: true },
            qa: { status: "stale" }
          }
        )
      )
    );
  }
  return {};
}

function defaultIssueOwner(stage, code, currentAgentId) {
  if (!new Set(["assets", "final"]).has(stage)) return currentAgentId;
  if (
    code === "subtitle-boundaries" ||
    code === "subtitle-timeline" ||
    code.startsWith("storyboard-") ||
    code.startsWith("scene-")
  ) {
    return "storyboard-agent";
  }
  if (code === "evidence-assets" || code === "asset-count" || code.startsWith("asset-")) {
    return "asset-agent";
  }
  if (code === "voice-plan" || code === "voice-file" || code === "voice-duration" || code === "voice-file-exists") {
    return "voice-agent";
  }
  if (
    stage === "final" &&
    (code.startsWith("render-") || code.startsWith("qa-"))
  ) {
    return "render-agent";
  }
  return null;
}

async function deterministicChecks(stage, episode, artifactVersion, stageConfig, options) {
  const checks = [
    reviewCheck("artifact-version", "候选产物版本已绑定", Number.isInteger(artifactVersion) && artifactVersion > 0, {
      actual: artifactVersion,
      expected: "正整数版本",
      location: stage,
      suggestedFix: "为候选产物生成新版本，并同步重置对应人工审批版本"
    }),
    ...validateEpisodeForReview(episode),
    ...runStageRubric(stage, episode)
  ];
  if (["storyboard", "assets", "final"].includes(stage)) {
    checks.push(...validateTimelineForReview(episode));
  }
  if (stage === "assets") checks.push(...(await validateAssetsForReview(episode, options)));
  if (stage === "final") checks.push(...validateMediaForReview(episode));
  const availableCodes = new Set(checks.map((check) => check.code));
  for (const requiredCode of stageConfig.requiredChecks ?? []) {
    checks.push(
      reviewCheck(
        `rubric-required-${requiredCode}`,
        `审核规则包含必检项 ${requiredCode}`,
        availableCodes.has(requiredCode),
        {
          actual: availableCodes.has(requiredCode) ? requiredCode : null,
          expected: requiredCode,
          location: stage,
          suggestedFix: "修复 Rubric 配置或补回对应确定性检查"
        }
      )
    );
  }
  return checks;
}

function statusForDecision(decision) {
  if (decision === "pass") return "passed";
  if (decision === "revise") return "revision_required";
  return "escalated";
}

function reportId(stage, artifactVersion, sequence, now) {
  return `review-${stage}-v${artifactVersion}-${sequence}-${now.toISOString().replaceAll(/[:.]/gu, "-")}`;
}

function issueCodes(items = []) {
  return new Set(items.map((item) => item.code));
}

function intersects(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

export async function reviewAgentOutput(input, options = {}) {
  const { sourceEpisode, candidateEpisode, agentId, output } = input;
  if (output.status !== "waiting_approval" || !output.requiresApproval) return null;

  const stage = output.requiresApproval;
  const config = await readReviewConfig(options);
  const stageConfig = config.stages?.[stage];
  if (!stageConfig) throw new Error(`审核配置缺少阶段：${stage}`);
  if (options.expectedReviewProfile && options.expectedReviewProfile !== stageConfig.version) {
    throw new Error(
      `Main Agent 审核规则不匹配：请求 ${options.expectedReviewProfile}，实际 ${stageConfig.version}`
    );
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const source = ensureAgentArchitecture(sourceEpisode);
  const candidate = ensureAgentArchitecture(candidateEpisode);
  const previous = createReviewState(source.reviews?.[stage]);
  const artifactVersion = currentGateVersion(candidate, stage);
  const artifactHash = currentGateArtifactHash(candidate, stage);
  const checks = (await deterministicChecks(stage, candidate, artifactVersion, stageConfig, options))
    .map((check) => ({
      ...check,
      ownerAgentId: check.ownerAgentId ?? defaultIssueOwner(stage, check.code, agentId)
    }));
  const failedErrors = checks.filter((check) => !check.passed && check.severity === "error");
  const failedWarnings = checks.filter((check) => !check.passed && check.severity === "warning");
  const previousReport = previous.reports.find((report) => report.id === previous.latestReportId)
    ?? previous.reports.at(-1);
  const previousBlockingCodes = issueCodes(previousReport?.blockingIssues);
  const configuredEscalationCodes = new Set(stageConfig.escalateOnCodes ?? []);
  const maxRevisionRounds = Math.min(
    config.maxAutomaticRevisionRounds ?? 2,
    stageConfig.maxAutomaticRevisionRounds ?? Number.POSITIVE_INFINITY,
    source.control?.revisionLimit ?? 2
  );

  let decision = "pass";
  let confidence = 0.98;
  if (failedErrors.length > 0) {
    const currentCodes = issueCodes(failedErrors);
    const repeatedBlocker = previous.revisionRounds > 0 && intersects(currentCodes, previousBlockingCodes);
    const forcedEscalation = intersects(currentCodes, configuredEscalationCodes);
    decision = (
      stageConfig.automaticRevision === false ||
      previous.revisionRounds >= maxRevisionRounds ||
      repeatedBlocker ||
      forcedEscalation
    ) ? "escalate" : "revise";
    confidence = decision === "escalate" ? 0.95 : 0.92;
  }

  if (stageConfig.semanticReview && options.semanticReviewer && failedErrors.length === 0) {
    const semanticContext = buildSemanticReviewContext(stage, candidate, checks);
    const semantic = await options.semanticReviewer({ stage, context: semanticContext, checks });
    const semanticValidation = validateReviewResult(semantic);
    if (!semanticValidation.valid) {
      throw new Error(`语义审核结果无效：${semanticValidation.errors.join("；")}`);
    }
    if (semantic.stage !== stage) throw new Error(`语义审核阶段不匹配：${semantic.stage}`);
    if (semantic.rubricVersion !== stageConfig.version) {
      throw new Error(`语义审核规则版本不匹配：${semantic.rubricVersion}`);
    }
    if (semantic.artifactVersion !== artifactVersion) {
      throw new Error(`语义审核产物版本不匹配：${semantic.artifactVersion}`);
    }
    decision = semantic.decision;
    confidence = semantic.confidence;
    failedErrors.push(
      ...semantic.blockingIssues.map((issue) => ({
        code: issue.code,
        label: issue.code,
        passed: false,
        severity: "error",
        message: issue.evidence,
        actual: null,
        expected: null,
        location: issue.location ?? stage,
        suggestedFix: issue.suggestedFix ?? "",
        ownerAgentId: issue.ownerAgentId ?? defaultIssueOwner(stage, issue.code, agentId)
      }))
    );
    failedWarnings.push(
      ...semantic.warnings.map((warning) => ({
        code: warning.code ?? "semantic-warning",
        label: warning.label ?? "语义审核警告",
        passed: false,
        severity: "warning",
        message: warning.evidence,
        actual: null,
        expected: null,
        location: warning.location ?? stage,
        suggestedFix: warning.suggestedFix ?? "",
        ownerAgentId: warning.ownerAgentId ?? defaultIssueOwner(stage, warning.code, agentId)
      }))
    );
    const semanticCodes = issueCodes(semantic.blockingIssues);
    if (
      confidence < (stageConfig.lowConfidenceThreshold ?? config.lowConfidenceThreshold) ||
      intersects(semanticCodes, configuredEscalationCodes) ||
      (previous.revisionRounds > 0 && intersects(semanticCodes, previousBlockingCodes)) ||
      (decision === "revise" && stageConfig.automaticRevision === false) ||
      (decision === "revise" && previous.revisionRounds >= maxRevisionRounds)
    ) {
      decision = "escalate";
    }
  }

  const revisionTargets = [...new Set(failedErrors.map((issue) => issue.ownerAgentId).filter(Boolean))];
  if (decision === "revise") {
    const allowedRevisionAgents = new Set(stageConfig.revisionAgents ?? [agentId]);
    if (
      revisionTargets.length === 0 ||
      revisionTargets.some((target) => !allowedRevisionAgents.has(target))
    ) {
      decision = "escalate";
    }
  }

  if (decision === "escalate" && failedErrors.length === 0) {
    const lowConfidenceThreshold = stageConfig.lowConfidenceThreshold ?? config.lowConfidenceThreshold;
    const lowConfidence = Number.isFinite(lowConfidenceThreshold) && confidence < lowConfidenceThreshold;
    failedErrors.push(
      reviewCheck(
        lowConfidence ? "LOW_REVIEW_CONFIDENCE" : "SEMANTIC_REVIEW_ESCALATION",
        lowConfidence ? "语义审核置信度不足" : "语义审核需要人工判断",
        false,
        {
          actual: confidence,
          expected: lowConfidence ? `>= ${lowConfidenceThreshold}` : "明确的自动审核结论",
          message: lowConfidence
            ? `语义审核置信度 ${confidence} 低于阈值 ${lowConfidenceThreshold}`
            : "语义审核主动升级人工处理",
          location: stage,
          suggestedFix: "由人工核对候选产物和审核证据后决定是否继续"
        }
      )
    );
  }

  const id = reportId(stage, artifactVersion, previous.reports.length + 1, now);
  const report = {
    id,
    stage,
    agentId,
    decision,
    artifactVersion,
    artifactHash,
    rubricVersion: stageConfig.version,
    reviewConfigVersion: config.version ?? null,
    reviewConfigHash: assertVersionedConfig("review-rubrics", config).hash,
    reviewMode: stageConfig.semanticReview && options.semanticReviewer
      ? "deterministic+semantic"
      : "deterministic",
    semanticReviewerId: stageConfig.semanticReview && options.semanticReviewer
      ? String(options.semanticReviewerId ?? "injected-semantic-reviewer")
      : null,
    semanticReviewerKind: stageConfig.semanticReview && options.semanticReviewer
      ? String(options.semanticReviewerKind ?? "injected")
      : null,
    semanticContextHash: stageConfig.semanticReview
      ? buildSemanticReviewContext(stage, candidate, checks).contextHash
      : null,
    revisionTargets,
    confidence,
    checkedAt: now.toISOString(),
    blockingIssues: failedErrors.map(issueFromCheck),
    warnings: failedWarnings.map(issueFromCheck),
    passedChecks: checks.filter((check) => check.passed).map((check) => check.code),
    checks
  };
  const validation = validateReviewResult(report);
  if (!validation.valid) throw new Error(`审核结果无效：${validation.errors.join("；")}`);

  const nextReview = {
    ...previous,
    status: statusForDecision(decision),
    artifactVersion,
    artifactHash,
    rubricVersion: stageConfig.version,
    revisionRounds: decision === "revise" ? previous.revisionRounds + 1 : previous.revisionRounds,
    latestReportId: id,
    reports: [...previous.reports, report]
  };
  const reviews = createReviewMap(candidate.reviews);
  reviews[stage] = nextReview;

  let adjustedOutput = {
    ...output,
    patch: mergePatch(output.patch, { reviews })
  };
  if (decision !== "pass") {
    const summary = report.blockingIssues.map((issue) => issue.evidence).join("；");
    adjustedOutput = {
      ...adjustedOutput,
      status: "blocked",
      message:
        decision === "escalate"
          ? `机器审核连续未通过，已暂停等待人工处理：${summary}`
          : `机器审核要求修改：${summary}`,
      requiresApproval: null,
      requiresHuman: decision === "escalate",
      findings: [...(output.findings ?? []), ...report.blockingIssues.map((issue) => issue.evidence)],
      patch: mergePatch(adjustedOutput.patch, revisionPatch(stage, failedErrors))
    };
  }

  return {
    report,
    reviewState: nextReview,
    output: adjustedOutput,
    revisionTargets,
    shouldAutoRevise:
      decision === "revise" &&
      stageConfig.automaticRevision !== false &&
      revisionTargets.length === 1 &&
      revisionTargets[0] === agentId
  };
}
