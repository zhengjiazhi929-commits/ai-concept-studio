import { WORKER_MANIFESTS } from "./worker-manifests.mjs";
import { createHash } from "node:crypto";
import { integrityHash } from "./integrity.mjs";
import { validateApprovedExternalAssetBinding } from "./asset-rights.mjs";

export const CONTROL_MODES = new Set(["shadow", "assisted", "active"]);
export const MAIN_AGENT_ACTIONS = new Set([
  "run_worker",
  "wait_for_approval",
  "wait_for_checkpoint",
  "wait_for_input",
  "stop",
  "noop"
]);
export const REVIEW_DECISIONS = new Set(["pass", "revise", "escalate"]);
export const REVIEW_STATUSES = new Set([
  "not_started",
  "checking",
  "passed",
  "revision_required",
  "escalated"
]);
export const REVIEW_STAGE_IDS = ["research", "script", "storyboard", "assets", "final"];
export const TASK_PROFILES = new Set([
  "planner",
  "fast-structured",
  "deep-research",
  "creative-structured",
  "critical-review",
  "vision-review",
  "deterministic"
]);

const MAIN_AGENT_PLAN_FIELDS = new Set([
  "action",
  "workerId",
  "taskProfile",
  "reason",
  "acceptanceCriteria",
  "reviewProfile",
  "toolIds",
  "estimatedCalls",
  "estimatedCostUsd",
  "limits",
  "fallbackAction"
]);
const MAIN_AGENT_FALLBACK_ACTIONS = new Set(["stop", "noop", "escalate_to_human"]);
const WORKER_GATE = new Map(
  Object.entries(WORKER_MANIFESTS).map(([id, manifest]) => [id, manifest.gate])
);
const WORKER_APPROVAL_RESET_GATE = new Map(
  Object.entries(WORKER_MANIFESTS).map(([id, manifest]) => [id, manifest.approvalResetGate])
);
const WORKER_PATCH_FIELDS = new Map(
  Object.entries(WORKER_MANIFESTS).map(([id, manifest]) => [id, new Set(manifest.patchFields)])
);
const WORKER_PRODUCTION_FIELDS = new Map(
  Object.entries(WORKER_MANIFESTS).map(([id, manifest]) => [id, new Set(manifest.productionFields)])
);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function booleanControl(value, fallback, malformedFallback = fallback) {
  if (value === undefined) return fallback;
  return typeof value === "boolean" ? value : malformedFallback;
}

function nullableNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function budgetReservations(value) {
  if (!Array.isArray(value)) return [];
  const dispatchStates = new Set(["reserved", "dispatching", "ambiguous"]);
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) return [];
    return [{
      id: item.id,
      decisionId: nullableNonEmptyString(item.decisionId),
      calls: Number.isInteger(item.calls) && item.calls >= 0 ? item.calls : 0,
      costUsd: finiteNonNegative(item.costUsd),
      costKnown: booleanControl(item.costKnown, false, true),
      reservedAt: typeof item.reservedAt === "string" ? item.reservedAt : null,
      dispatchState: dispatchStates.has(item.dispatchState)
        ? item.dispatchState
        : "reserved",
      dispatchedAt: typeof item.dispatchedAt === "string" ? item.dispatchedAt : null,
      providerId: nullableNonEmptyString(item.providerId),
      model: nullableNonEmptyString(item.model),
      attempt: Number.isInteger(item.attempt) && item.attempt > 0 ? item.attempt : null
    }];
  });
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safeRelativeArtifactPath(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(value)) return false;
  return !value.split(/[\\/]/u).includes("..");
}

function sensitiveDecisionFields(value, path = "routingDecision") {
  if (!value || typeof value !== "object") return [];
  const sensitiveNames = new Set([
    "apikey",
    "authorization",
    "credential",
    "password",
    "secret",
    "bearertoken",
    "accesstoken",
    "refreshtoken",
    "prompt",
    "inputtext",
    "instructions"
  ]);
  const errors = [];
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z]/gu, "");
    if (sensitiveNames.has(normalized)) errors.push(`${path}.${key}`);
    if (item && typeof item === "object") {
      errors.push(...sensitiveDecisionFields(item, `${path}.${key}`));
    }
  }
  return errors;
}

function unsafeWorkerPathFields(value, path = "patch") {
  if (!value || typeof value !== "object") return [];
  const errors = [];
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}.${key}`;
    if (/Path$/u.test(key) && item !== null && !safeRelativeArtifactPath(item)) {
      errors.push(itemPath);
    }
    if (item && typeof item === "object") {
      errors.push(...unsafeWorkerPathFields(item, itemPath));
    }
  }
  return errors;
}

export function createControlState(initial = {}) {
  initial = isRecord(initial) ? initial : {};
  const budget = isRecord(initial.budget) ? initial.budget : {};
  const reservations = budgetReservations(budget.reservations);
  const recordedReservedCalls = reservations.reduce((sum, item) => sum + item.calls, 0);
  const recordedReservedCostUsd = reservations.reduce((sum, item) => sum + item.costUsd, 0);
  return {
    mode: CONTROL_MODES.has(initial.mode) ? initial.mode : "shadow",
    reviewEnabled: booleanControl(initial.reviewEnabled, true, true),
    modelRouterEnabled: booleanControl(initial.modelRouterEnabled, false, false),
    mainAgentEnabled: booleanControl(initial.mainAgentEnabled, false, false),
    fixedFallbackEnabled: booleanControl(initial.fixedFallbackEnabled, true, true),
    stopRequested: booleanControl(initial.stopRequested, false, true),
    revisionLimit: Number.isInteger(initial.revisionLimit)
      ? Math.max(0, initial.revisionLimit)
      : 2,
    planVersion: Number.isInteger(initial.planVersion) ? Math.max(0, initial.planVersion) : 0,
    stateVersion: Number.isInteger(initial.stateVersion) ? Math.max(0, initial.stateVersion) : 0,
    currentPlan: isRecord(initial.currentPlan) ? initial.currentPlan : null,
    pendingDispatch: isRecord(initial.pendingDispatch) ? initial.pendingDispatch : null,
    activeOperation:
      isRecord(initial.activeOperation) &&
      typeof initial.activeOperation.id === "string" &&
      initial.activeOperation.id.trim() &&
      typeof initial.activeOperation.kind === "string" &&
      initial.activeOperation.kind.trim()
        ? {
            id: initial.activeOperation.id,
            kind: initial.activeOperation.kind,
            startedAt: typeof initial.activeOperation.startedAt === "string"
              ? initial.activeOperation.startedAt
              : null
          }
        : null,
    allowedTools: Array.isArray(initial.allowedTools)
      ? [...new Set(initial.allowedTools.filter((toolId) => typeof toolId === "string" && toolId.trim()))]
      : [],
    lockedRoute: {
      providerId: nullableNonEmptyString(initial.lockedRoute?.providerId),
      model: nullableNonEmptyString(initial.lockedRoute?.model)
    },
    budget: {
      maxCostUsd: Number.isFinite(budget.maxCostUsd) ? Math.max(0, budget.maxCostUsd) : null,
      maxCalls: Number.isInteger(budget.maxCalls) ? Math.max(0, budget.maxCalls) : null,
      usedCostUsd: finiteNonNegative(budget.usedCostUsd),
      usedCalls: Number.isFinite(budget.usedCalls) && budget.usedCalls >= 0
        ? Math.ceil(budget.usedCalls)
        : 0,
      reservedCostUsd: Math.max(
        finiteNonNegative(budget.reservedCostUsd),
        Number(recordedReservedCostUsd.toFixed(6))
      ),
      reservedCalls: Number.isFinite(budget.reservedCalls) && budget.reservedCalls >= 0
        ? Math.max(Math.ceil(budget.reservedCalls), recordedReservedCalls)
        : recordedReservedCalls,
      reservations,
      overrun: booleanControl(budget.overrun, false, true)
    }
  };
}

export function createReviewState(initial = {}) {
  initial = isRecord(initial) ? initial : {};
  return {
    status: REVIEW_STATUSES.has(initial.status) ? initial.status : "not_started",
    artifactVersion: initial.artifactVersion ?? null,
    artifactHash: initial.artifactHash ?? null,
    rubricVersion: initial.rubricVersion ?? null,
    revisionRounds: Number.isInteger(initial.revisionRounds)
      ? Math.max(0, initial.revisionRounds)
      : 0,
    latestReportId: initial.latestReportId ?? null,
    reports: Array.isArray(initial.reports) ? initial.reports : []
  };
}

export function createReviewMap(initial = {}) {
  initial = isRecord(initial) ? initial : {};
  return Object.fromEntries(
    REVIEW_STAGE_IDS.map((stage) => [stage, createReviewState(initial[stage])])
  );
}

export function ensureAgentArchitecture(sourceEpisode) {
  const episode = structuredClone(sourceEpisode);
  episode.control = createControlState(episode.control);
  episode.reviews = createReviewMap(episode.reviews);
  episode.planHistory = Array.isArray(episode.planHistory) ? episode.planHistory : [];
  episode.routingHistory = Array.isArray(episode.routingHistory) ? episode.routingHistory : [];
  episode.dispatchHistory = Array.isArray(episode.dispatchHistory) ? episode.dispatchHistory : [];
  episode.evaluationHistory = Array.isArray(episode.evaluationHistory) ? episode.evaluationHistory : [];
  episode.reviewCheckpoints = isRecord(episode.reviewCheckpoints)
    ? episode.reviewCheckpoints
    : {};
  return episode;
}

export function validateWorkerResult(result) {
  const errors = [];
  const statuses = new Set(["blocked", "complete", "failed", "waiting_approval"]);
  if (!isRecord(result)) return { valid: false, errors: ["worker result must be an object"] };
  if (!statuses.has(result.status)) errors.push(`invalid worker status: ${result.status}`);
  if (typeof result.message !== "string" || !result.message.trim()) {
    errors.push("worker result message is required");
  }
  if (result.artifacts !== undefined && !Array.isArray(result.artifacts)) {
    errors.push("worker artifacts must be an array");
  }
  for (const artifact of result.artifacts ?? []) {
    if (!safeRelativeArtifactPath(artifact)) {
      errors.push("worker artifacts must contain safe workspace-relative paths");
      break;
    }
  }
  if (result.findings !== undefined && !Array.isArray(result.findings)) {
    errors.push("worker findings must be an array");
  }
  if (result.patch !== undefined && !isRecord(result.patch)) {
    errors.push("worker patch must be an object");
  }
  if (result.requiresApproval && !REVIEW_STAGE_IDS.includes(result.requiresApproval)) {
    errors.push(`invalid worker approval gate: ${result.requiresApproval}`);
  }
  if (result.status === "waiting_approval" && !result.requiresApproval) {
    errors.push("waiting worker result must declare requiresApproval");
  }
  if (result.status !== "waiting_approval" && result.requiresApproval) {
    errors.push("only waiting worker results may declare requiresApproval");
  }
  if (result.requiresHuman && !new Set(["blocked", "failed"]).has(result.status)) {
    errors.push("requiresHuman is only valid for blocked or failed worker results");
  }
  return { valid: errors.length === 0, errors };
}

function validateApprovalReset(sourceEpisode, agentId, approvals) {
  const errors = [];
  if (!isRecord(approvals)) return ["worker approvals patch must be an object"];
  const allowedGate = WORKER_APPROVAL_RESET_GATE.get(agentId);
  for (const [gate, next] of Object.entries(approvals)) {
    if (!allowedGate || gate !== allowedGate) {
      errors.push(`${agentId} cannot patch approval gate: ${gate}`);
      continue;
    }
    const previous = sourceEpisode.approvals?.[gate];
    if (!isRecord(next) || next.status !== "pending") {
      errors.push(`${agentId} may only reset ${gate} approval to pending`);
      continue;
    }
    if (!Number.isInteger(next.currentVersion) || next.currentVersion < 1) {
      errors.push(`${gate} approval reset requires a positive currentVersion`);
    }
    if (
      Number.isInteger(previous?.currentVersion) &&
      next.currentVersion < previous.currentVersion
    ) {
      errors.push(`${gate} approval version cannot move backwards`);
    }
    if (!sameJson(next.history ?? [], previous?.history ?? [])) {
      errors.push(`${gate} approval reset cannot rewrite decision history`);
    }
    if (next.at !== null || next.note || next.feedback) {
      errors.push(`${gate} approval reset must clear the current decision and feedback`);
    }
    if (next.provenance != null || next.reviewReportId != null || next.artifactHash != null) {
      errors.push(`${gate} approval reset must clear approval provenance`);
    }
  }
  return errors;
}

function validateBudgetPatch(sourceEpisode, control) {
  const errors = [];
  if (!isRecord(control)) return ["worker control patch must be an object"];
  for (const key of Object.keys(control)) {
    if (key !== "budget") errors.push(`worker cannot patch control.${key}`);
  }
  const budget = control.budget;
  if (!isRecord(budget)) return [...errors, "worker control.budget patch must be an object"];
  const previous = sourceEpisode.control?.budget ?? {};
  const allowed = new Set([
    "maxCalls",
    "maxCostUsd",
    "usedCalls",
    "usedCostUsd",
    "reservedCalls",
    "reservedCostUsd",
    "reservations",
    "overrun"
  ]);
  for (const key of Object.keys(budget)) {
    if (!allowed.has(key)) errors.push(`worker cannot patch control.budget.${key}`);
  }
  if (budget.maxCalls !== previous.maxCalls || budget.maxCostUsd !== previous.maxCostUsd) {
    errors.push("worker cannot change episode budget limits");
  }
  if (!Number.isInteger(budget.usedCalls) || budget.usedCalls < (previous.usedCalls ?? 0)) {
    errors.push("worker budget usedCalls must be a monotonic integer");
  }
  if (!Number.isFinite(budget.usedCostUsd) || budget.usedCostUsd < (previous.usedCostUsd ?? 0)) {
    errors.push("worker budget usedCostUsd must be monotonic");
  }
  if (budget.reservedCalls !== (previous.reservedCalls ?? 0)) {
    errors.push("worker cannot change reserved call budget");
  }
  if (budget.reservedCostUsd !== (previous.reservedCostUsd ?? 0)) {
    errors.push("worker cannot change reserved cost budget");
  }
  if (!sameJson(budget.reservations ?? [], previous.reservations ?? [])) {
    errors.push("worker cannot change budget reservations");
  }
  if (previous.overrun && budget.overrun !== true) {
    errors.push("worker cannot clear a recorded budget overrun");
  }
  return errors;
}

function validateRoutingAppend(sourceEpisode, routingHistory) {
  const errors = [];
  if (!Array.isArray(routingHistory)) return ["worker routingHistory patch must be an array"];
  const previous = sourceEpisode.routingHistory ?? [];
  if (routingHistory.length < previous.length) {
    errors.push("worker cannot remove routing history");
    return errors;
  }
  if (!sameJson(routingHistory.slice(0, previous.length), previous)) {
    errors.push("worker cannot rewrite routing history");
  }
  for (const decision of routingHistory.slice(previous.length)) {
    const validation = validateRoutingDecision(decision);
    if (!validation.valid) errors.push(...validation.errors.map((error) => `routing append: ${error}`));
  }
  return errors;
}

function validateAssetSceneBindings(sourceEpisode, scenes, registeredAssets = sourceEpisode.assets ?? []) {
  if (!Array.isArray(scenes)) return ["asset-agent scenes patch must be an array"];
  const previousScenes = sourceEpisode.scenes ?? [];
  const errors = [];
  if (scenes.length !== previousScenes.length) {
    return ["asset-agent cannot add or remove storyboard scenes"];
  }
  const allowedByScene = new Map();
  const assetsByPlanItem = new Map(
    registeredAssets
      .filter((asset) => asset.planItemId && asset.path)
      .map((asset) => [asset.planItemId, asset])
  );
  for (const item of sourceEpisode.production?.assetPlan?.content?.items ?? []) {
    const asset = assetsByPlanItem.get(item.id);
    if (!asset) continue;
    for (const sceneId of item.sceneIds ?? []) {
      const allowed = allowedByScene.get(sceneId) ?? { asset: new Set(), audio: new Set() };
      allowed[asset.type === "audio" ? "audio" : "asset"].add(asset.path);
      allowedByScene.set(sceneId, allowed);
    }
  }
  for (const [index, nextScene] of scenes.entries()) {
    const previousScene = previousScenes[index];
    if (!isRecord(nextScene) || nextScene.id !== previousScene?.id) {
      errors.push(`asset-agent cannot reorder storyboard scenes: ${index}`);
      continue;
    }
    const withoutBindings = (scene) => Object.fromEntries(
      Object.entries(scene ?? {}).filter(([key]) => !new Set(["asset", "audio"]).has(key))
    );
    if (!sameJson(withoutBindings(nextScene), withoutBindings(previousScene))) {
      errors.push(`asset-agent cannot modify storyboard content: ${nextScene.id}`);
    }
    const allowed = allowedByScene.get(nextScene.id) ?? { asset: new Set(), audio: new Set() };
    for (const field of ["asset", "audio"]) {
      if (nextScene[field] === previousScene?.[field]) continue;
      if (!nextScene[field] || !allowed[field].has(nextScene[field])) {
        errors.push(`asset-agent binding is not declared by the asset plan: ${nextScene.id}.${field}`);
      }
    }
  }
  return errors;
}

function validateAssetRegistration(sourceEpisode, assets) {
  if (!Array.isArray(assets)) return ["asset-agent assets patch must be an array"];
  const errors = [];
  const previous = new Map((sourceEpisode.assets ?? []).map((asset) => [asset.planItemId, asset]));
  const plannedItems = new Map(
    (sourceEpisode.production?.assetPlan?.content?.items ?? []).map((item) => [item.id, item])
  );
  const nextByPlanItem = new Map(assets.map((asset) => [asset?.planItemId, asset]));
  for (const [planItemId] of previous) {
    if (!nextByPlanItem.has(planItemId)) {
      errors.push(`asset-agent cannot remove an existing asset: ${planItemId}`);
    }
  }
  const assetRevision = (asset) => Number.isInteger(asset?.version)
    ? asset.version
    : Number(/-v(\d{3})\.json$/u.exec(asset?.path ?? "")?.[1] ?? 0);
  const externalAssetValid = (asset, item) => {
    const call = (sourceEpisode.production?.assetPlan?.content?.executionPolicy
      ?.externalApiCalls ?? []).find((candidate) => candidate.id === asset?.externalCallId);
    const expectedType = item?.productionMethod?.kind === "external-image-generation"
      ? "image"
      : item?.productionMethod?.kind === "external-video-generation"
        ? "video"
        : null;
    const provenance = validateApprovedExternalAssetBinding(sourceEpisode, asset);
    return Boolean(
      provenance.valid &&
      call &&
      expectedType &&
      asset?.source === "approved-external-generation" &&
      asset?.type === expectedType &&
      Number.isInteger(asset?.version) &&
      asset.version >= 1 &&
      asset?.executor === item.productionMethod.executor &&
      asset?.providerId === item.productionMethod.externalProvider &&
      asset?.model === item.productionMethod.externalModel &&
      call.providerId === asset.providerId &&
      call.model === asset.model &&
      asset?.candidateHash === sourceEpisode.reviewCheckpoints?.assetExecution
        ?.currentCandidate?.candidateHash &&
      asset?.promptHash === createHash("sha256").update(call.prompt).digest("hex") &&
      asset?.requestParametersHash === integrityHash(call.requestParameters ?? null) &&
      asset?.externalApiCalls === 1 &&
      asset?.maximumPaidCostUsd === call.maximumCostUsd &&
      asset?.billingCurrency === (call.billing?.currency ?? "USD") &&
      asset?.maximumNativeCost === (
        call.billing?.maximumAmount ?? call.maximumCostUsd
      ) &&
      (
        asset?.actualNativeAmount === null ||
        (
          Number.isFinite(asset?.actualNativeAmount) &&
          asset.actualNativeAmount >= 0 &&
          asset.actualNativeAmount <= asset.maximumNativeCost
        )
      ) &&
      asset?.verified === false &&
      asset?.privacy === "requires-human-review" &&
      safeRelativeArtifactPath(asset?.path) &&
      safeRelativeArtifactPath(asset?.receiptPath) &&
      /^[a-f0-9]{64}$/u.test(asset?.sha256 ?? "") &&
      Number.isSafeInteger(asset?.bytes) &&
      asset.bytes > 0
    );
  };
  for (const asset of assets) {
    const old = previous.get(asset?.planItemId);
    if (old) continue;
    const item = plannedItems.get(asset?.planItemId);
    if (!item) {
      errors.push(`asset-agent cannot register an undeclared asset: ${asset?.planItemId ?? "missing"}`);
      continue;
    }
    const validLocal = item.productionMethod?.kind === "local-code-animation" && Boolean(
      asset?.source === "local-code-animation" &&
      asset?.type === "code-animation" &&
      Number.isInteger(asset?.version) &&
      asset.version >= 1 &&
      asset?.executor === item.productionMethod?.executor &&
      asset?.componentId === "AgentSkillShortExplainer" &&
      /^[a-f0-9]{64}$/u.test(asset?.implementationSha256 ?? "") &&
      asset?.assetPlanVersion === sourceEpisode.production?.assetPlan?.version &&
      asset?.candidateHash === sourceEpisode.reviewCheckpoints?.assetExecution
        ?.currentCandidate?.candidateHash &&
      asset?.visualContractHash === (
        item?.visualContract ? integrityHash(item.visualContract) : null
      ) &&
      asset?.externalApiCalls === 0 &&
      asset?.maximumPaidCostUsd === 0 &&
      asset?.verified === true &&
      safeRelativeArtifactPath(asset?.path) &&
      /^[a-f0-9]{64}$/u.test(asset?.sha256 ?? "") &&
      Number.isSafeInteger(asset?.bytes) &&
      asset.bytes > 0
    );
    if (!validLocal && !externalAssetValid(asset, item)) {
      errors.push(item.productionMethod?.kind === "local-code-animation"
        ? `asset-agent local code asset does not match approved plan: ${item.id}`
        : `asset-agent external asset does not match approved plan: ${item.id}`);
    }
  }
  for (const asset of assets) {
    const old = previous.get(asset?.planItemId);
    if (!old || sameJson(old, asset)) continue;
    const item = plannedItems.get(asset.planItemId);
    const validLocalReplacement =
      old.source === "local-code-animation" &&
      item?.productionMethod?.kind === "local-code-animation" &&
      asset.source === "local-code-animation" &&
      asset.type === "code-animation" &&
      asset.executor === item.productionMethod.executor &&
      asset.componentId === "AgentSkillShortExplainer" &&
      /^[a-f0-9]{64}$/u.test(asset.implementationSha256 ?? "") &&
      asset.assetPlanVersion === sourceEpisode.production?.assetPlan?.version &&
      asset.candidateHash === sourceEpisode.reviewCheckpoints?.assetExecution
        ?.currentCandidate?.candidateHash &&
      asset.visualContractHash === (
        item?.visualContract ? integrityHash(item.visualContract) : null
      ) &&
      asset.externalApiCalls === 0 &&
      asset.maximumPaidCostUsd === 0 &&
      asset.verified === true &&
      safeRelativeArtifactPath(asset.path) &&
      /^[a-f0-9]{64}$/u.test(asset.sha256 ?? "") &&
      Number.isSafeInteger(asset.bytes) &&
      asset.bytes > 0 &&
      assetRevision(asset) > assetRevision(old) &&
      asset.path !== old.path;
    const validExternalReplacement =
      old.source === "approved-external-generation" &&
      externalAssetValid(asset, item) &&
      assetRevision(asset) > assetRevision(old) &&
      asset.path !== old.path;
    if (!validLocalReplacement && !validExternalReplacement) {
      errors.push(`asset-agent cannot replace an existing asset: ${asset.planItemId}`);
    }
  }
  return errors;
}

function validateAssetExecutionCheckpointMutation(sourceEpisode, reviewCheckpoints) {
  const errors = [];
  if (!isRecord(reviewCheckpoints)) {
    return ["asset-agent reviewCheckpoints patch must be an object"];
  }
  for (const checkpointId of Object.keys(reviewCheckpoints)) {
    if (checkpointId !== "assetExecution") {
      errors.push(`asset-agent cannot patch review checkpoint: ${checkpointId}`);
    }
  }
  const next = reviewCheckpoints.assetExecution;
  if (!next) return errors;
  if (!isRecord(next)) {
    errors.push("asset-agent assetExecution checkpoint must be an object");
    return errors;
  }
  const previous = sourceEpisode.reviewCheckpoints?.assetExecution;
  if (next.status === "approved" || next.status === "rejected") {
    errors.push("asset-agent cannot create an approved or rejected asset execution checkpoint");
  }
  if (next.humanApproval !== null && next.humanApproval !== undefined) {
    errors.push("asset-agent cannot write asset execution human approval");
  }
  if (
    previous?.status === "approved" &&
    next.currentCandidate?.candidateHash === previous.currentCandidate?.candidateHash &&
    next.status !== "approved"
  ) {
    errors.push("asset-agent cannot invalidate human approval without a new candidate");
  }
  const previousHistory = Array.isArray(previous?.history) ? previous.history : [];
  const nextHistory = Array.isArray(next.history) ? next.history : [];
  if (!sameJson(nextHistory.slice(0, previousHistory.length), previousHistory)) {
    errors.push("asset-agent cannot rewrite asset execution checkpoint history");
  }
  const appendedHistory = nextHistory.slice(previousHistory.length);
  const previousCandidate = previous?.currentCandidate ?? null;
  const nextCandidate = next.currentCandidate ?? null;
  const candidateChanged = Boolean(
    previousCandidate?.candidateHash &&
    nextCandidate?.candidateHash &&
    previousCandidate.candidateHash !== nextCandidate.candidateHash
  );
  const expectedSupersededCandidate = previousCandidate ? {
    version: previousCandidate.version ?? null,
    candidateHash: previousCandidate.candidateHash ?? null,
    artifact: structuredClone(previousCandidate.artifact ?? null),
    planHash: previousCandidate.planHash ?? null,
    sourceStoryboard: structuredClone(previousCandidate.sourceStoryboard ?? null),
    localCodeImplementation: structuredClone(
      previousCandidate.localCodeImplementation ?? null
    ),
    summary: structuredClone(previousCandidate.summary ?? null)
  } : null;
  const supersededEntry = appendedHistory[0] ?? null;
  const validSupersededEntry = Boolean(
    candidateChanged &&
    appendedHistory.length === 2 &&
    supersededEntry?.type === "candidate-superseded" &&
    typeof supersededEntry.at === "string" &&
    supersededEntry.at.trim() &&
    sameJson(supersededEntry.candidate, expectedSupersededCandidate) &&
    supersededEntry.supersededByVersion === nextCandidate.version &&
    supersededEntry.supersededByCandidateHash === nextCandidate.candidateHash &&
    appendedHistory[1]?.type === "machine-review"
  );
  if (
    (candidateChanged && !validSupersededEntry) ||
    (!candidateChanged && appendedHistory.some((entry) => entry?.type !== "machine-review"))
  ) {
    errors.push("asset-agent may only append machine review checkpoint history");
  }
  return errors;
}

export function validateWorkerMutation(sourceEpisode, agentId, result) {
  const errors = [...validateWorkerResult(result).errors];
  const expectedGate = WORKER_GATE.get(agentId) ?? null;
  if (result?.status === "waiting_approval" && result.requiresApproval !== expectedGate) {
    errors.push(`${agentId} cannot request approval gate: ${result.requiresApproval ?? "missing"}`);
  }
  if (
    result?.status === "complete" &&
    expectedGate &&
    sourceEpisode.approvals?.[expectedGate]?.status !== "approved"
  ) {
    errors.push(`${agentId} cannot complete before ${expectedGate} approval`);
  }

  const patch = result?.patch;
  if (patch === undefined) return { valid: errors.length === 0, errors };
  if (!isRecord(patch)) return { valid: false, errors: [...errors, "worker patch must be an object"] };
  for (const path of unsafeWorkerPathFields(patch)) {
    errors.push(`worker patch path must stay workspace-relative: ${path}`);
  }
  const allowedFields = WORKER_PATCH_FIELDS.get(agentId);
  if (!allowedFields) errors.push(`unknown worker mutation scope: ${agentId}`);
  for (const key of Object.keys(patch)) {
    if (!allowedFields?.has(key)) errors.push(`${agentId} cannot patch top-level field: ${key}`);
  }
  if (patch.production !== undefined) {
    if (!isRecord(patch.production)) {
      errors.push("worker production patch must be an object");
    } else {
      const allowedProduction = WORKER_PRODUCTION_FIELDS.get(agentId) ?? new Set();
      for (const key of Object.keys(patch.production)) {
        if (!allowedProduction.has(key)) errors.push(`${agentId} cannot patch production.${key}`);
      }
    }
  }
  if (patch.approvals !== undefined) {
    errors.push(...validateApprovalReset(sourceEpisode, agentId, patch.approvals));
  }
  if (patch.control !== undefined) {
    errors.push(...validateBudgetPatch(sourceEpisode, patch.control));
  }
  if (patch.routingHistory !== undefined) {
    errors.push(...validateRoutingAppend(sourceEpisode, patch.routingHistory));
  }
  if (agentId === "asset-agent" && patch.scenes !== undefined) {
    errors.push(...validateAssetSceneBindings(
      sourceEpisode,
      patch.scenes,
      patch.assets ?? sourceEpisode.assets ?? []
    ));
  }
  if (agentId === "asset-agent" && patch.assets !== undefined) {
    errors.push(...validateAssetRegistration(sourceEpisode, patch.assets));
  }
  if (patch.reviewCheckpoints !== undefined) {
    if (agentId !== "asset-agent") {
      errors.push(`${agentId} cannot patch review checkpoints`);
    } else {
      errors.push(...validateAssetExecutionCheckpointMutation(sourceEpisode, patch.reviewCheckpoints));
    }
  }
  if (Array.isArray(patch.sourceDocs)) {
    for (const [index, source] of patch.sourceDocs.entries()) {
      if (!safeRelativeArtifactPath(source?.path)) {
        errors.push(`worker sourceDocs path must stay workspace-relative: ${index}`);
      }
    }
  }
  if (agentId === "storyboard-agent" && patch.render !== undefined) {
    const allowed = new Set(["durationSeconds", "status", "outputPath", "progress"]);
    for (const key of Object.keys(patch.render ?? {})) {
      if (!allowed.has(key)) errors.push(`storyboard-agent cannot patch render.${key}`);
    }
    if (
      patch.render?.status !== "pending" ||
      patch.render?.outputPath !== null ||
      patch.render?.progress !== 0
    ) {
      errors.push("storyboard-agent may only reset render state to pending");
    }
  }
  if (
    agentId === "render-agent" &&
    patch.qa !== undefined &&
    (patch.qa?.status !== "pending" || patch.qa?.reportPath !== null)
  ) {
    errors.push("render-agent may only reset QA state to pending");
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function validateReviewResult(result) {
  const errors = [];
  if (!isRecord(result)) return { valid: false, errors: ["review result must be an object"] };
  if (!REVIEW_DECISIONS.has(result.decision)) errors.push(`invalid review decision: ${result.decision}`);
  if (!REVIEW_STAGE_IDS.includes(result.stage)) errors.push(`invalid review stage: ${result.stage}`);
  if (typeof result.rubricVersion !== "string" || !result.rubricVersion.trim()) {
    errors.push("review rubricVersion is required");
  }
  if (!Number.isInteger(result.artifactVersion) || result.artifactVersion < 1) {
    errors.push("review artifactVersion must be a positive integer");
  }
  if (result.artifactHash !== undefined && !/^[a-f0-9]{64}$/u.test(result.artifactHash ?? "")) {
    errors.push("review artifactHash must be a SHA-256 hash");
  }
  if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
    errors.push("review confidence must be between 0 and 1");
  }
  for (const field of ["blockingIssues", "warnings", "passedChecks"]) {
    if (!Array.isArray(result[field])) errors.push(`review ${field} must be an array`);
  }
  if (Array.isArray(result.blockingIssues)) {
    if (result.decision === "pass" && result.blockingIssues.length > 0) {
      errors.push("passing review cannot contain blocking issues");
    }
    if (result.decision === "revise" && result.blockingIssues.length === 0) {
      errors.push("revision review must contain at least one blocking issue");
    }
  }
  const reviewIssues = [
    ...(Array.isArray(result.blockingIssues) ? result.blockingIssues : []),
    ...(Array.isArray(result.warnings) ? result.warnings : [])
  ];
  for (const issue of reviewIssues) {
    if (!isRecord(issue) || typeof issue.code !== "string" || !issue.code.trim()) {
      errors.push("review issues must declare a code");
      continue;
    }
    if (typeof issue.evidence !== "string" || !issue.evidence.trim()) {
      errors.push(`review issue ${issue.code} must declare evidence`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateMainAgentPlan(plan) {
  const errors = [];
  if (!isRecord(plan)) return { valid: false, errors: ["main plan must be an object"] };
  for (const key of Object.keys(plan)) {
    if (!MAIN_AGENT_PLAN_FIELDS.has(key)) errors.push(`unexpected main plan field: ${key}`);
  }
  for (const field of MAIN_AGENT_PLAN_FIELDS) {
    if (!Object.hasOwn(plan, field)) errors.push(`main plan field is required: ${field}`);
  }
  if (!MAIN_AGENT_ACTIONS.has(plan.action)) errors.push(`invalid main action: ${plan.action}`);
  if (plan.action === "run_worker" && (typeof plan.workerId !== "string" || !plan.workerId.trim())) {
    errors.push("run_worker requires workerId");
  }
  if (plan.action !== "run_worker" && plan.workerId !== null) {
    errors.push("non-worker plan must set workerId to null");
  }
  if (plan.action === "run_worker" && !TASK_PROFILES.has(plan.taskProfile)) {
    errors.push(`invalid task profile: ${plan.taskProfile}`);
  }
  if (plan.action !== "run_worker" && plan.taskProfile !== null) {
    errors.push("non-worker plan must set taskProfile to null");
  }
  if (typeof plan.reason !== "string" || !plan.reason.trim()) errors.push("main plan reason is required");
  if (!Array.isArray(plan.acceptanceCriteria)) errors.push("acceptanceCriteria must be an array");
  if (
    Array.isArray(plan.acceptanceCriteria) &&
    plan.acceptanceCriteria.some((criterion) => typeof criterion !== "string" || !criterion.trim())
  ) {
    errors.push("acceptanceCriteria must contain non-empty strings");
  }
  if (plan.action === "run_worker" && plan.acceptanceCriteria?.length === 0) {
    errors.push("run_worker requires at least one acceptance criterion");
  }
  for (const field of ["providerId", "model", "patch", "statePatch", "approvalDecision"]) {
    if (plan[field] !== undefined) errors.push(`main plan cannot set ${field}`);
  }
  if (plan.toolIds !== undefined) {
    if (!Array.isArray(plan.toolIds) || plan.toolIds.some((toolId) => typeof toolId !== "string" || !toolId.trim())) {
      errors.push("toolIds must be an array of non-empty strings");
    }
  }
  if (plan.reviewProfile !== null && (typeof plan.reviewProfile !== "string" || !plan.reviewProfile.trim())) {
    errors.push("reviewProfile must be null or a non-empty string");
  }
  if (
    plan.estimatedCostUsd !== undefined &&
    (!Number.isFinite(plan.estimatedCostUsd) || plan.estimatedCostUsd < 0)
  ) {
    errors.push("estimatedCostUsd must be a non-negative number");
  }
  if (
    plan.estimatedCalls !== undefined &&
    (!Number.isInteger(plan.estimatedCalls) || plan.estimatedCalls < 0)
  ) {
    errors.push("estimatedCalls must be a non-negative integer");
  }
  if (plan.limits?.maxAttempts !== undefined && (!Number.isInteger(plan.limits.maxAttempts) || plan.limits.maxAttempts < 1)) {
    errors.push("maxAttempts must be a positive integer");
  }
  if (!isRecord(plan.limits)) {
    errors.push("limits must be an object");
  } else {
    for (const field of ["maxAttempts", "maxRevisionRounds"]) {
      if (!Object.hasOwn(plan.limits, field)) errors.push(`plan limits field is required: ${field}`);
    }
    for (const field of Object.keys(plan.limits)) {
      if (!new Set(["maxAttempts", "maxRevisionRounds"]).has(field)) {
        errors.push(`unexpected plan limits field: ${field}`);
      }
    }
  }
  if (
    plan.limits?.maxRevisionRounds !== undefined &&
    (!Number.isInteger(plan.limits.maxRevisionRounds) || plan.limits.maxRevisionRounds < 0)
  ) {
    errors.push("maxRevisionRounds must be a non-negative integer");
  }
  if (!MAIN_AGENT_FALLBACK_ACTIONS.has(plan.fallbackAction)) {
    errors.push(`invalid fallbackAction: ${plan.fallbackAction}`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateRoutingDecision(decision) {
  const errors = [];
  if (!isRecord(decision)) return { valid: false, errors: ["routing decision must be an object"] };
  if (typeof decision.id !== "string" || !decision.id.trim()) errors.push("routing decision id is required");
  if (!TASK_PROFILES.has(decision.profile)) errors.push(`invalid routing profile: ${decision.profile}`);
  if (typeof decision.reason !== "string" || !decision.reason.trim()) {
    errors.push("routing decision reason is required");
  }
  if (!Array.isArray(decision.candidates)) errors.push("routing candidates must be an array");
  if (
    !isRecord(decision.selected) ||
    typeof decision.selected.providerId !== "string" ||
    typeof decision.selected.model !== "string"
  ) {
    errors.push("routing selected provider and model are required");
  }
  if (
    decision.estimatedCostUsd !== null &&
    decision.estimatedCostUsd !== undefined &&
    (!Number.isFinite(decision.estimatedCostUsd) || decision.estimatedCostUsd < 0)
  ) {
    errors.push("routing estimatedCostUsd must be null or non-negative");
  }
  for (const path of sensitiveDecisionFields(decision)) {
    errors.push(`routing decision cannot persist sensitive field: ${path}`);
  }
  return { valid: errors.length === 0, errors };
}
