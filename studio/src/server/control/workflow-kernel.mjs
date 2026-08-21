import {
  ensureAgentArchitecture,
  validateRoutingDecision
} from "../../shared/agent-contracts.mjs";
import { workerManifest } from "../../shared/worker-manifests.mjs";
import {
  approvalValidForGate,
  legalWorkerActions,
  reviewPassedForGate,
  validatePlanAgainstPolicy
} from "./policy-engine.mjs";
import {
  approvedAssetExecutionToolIds,
  assetExecutionApprovalValid,
  assetExecutionPreflightValid
} from "../reviews/asset-execution-checkpoint.mjs";

const gateRequirements = {
  "script-agent": ["research"],
  "storyboard-agent": ["research", "script"],
  "asset-agent": ["research", "script", "storyboard"],
  "voice-agent": ["research", "script", "storyboard"],
  "render-agent": ["research", "script", "storyboard", "assets"],
  "qa-agent": ["research", "script", "storyboard", "assets"]
};

function missingGateApprovals(episode, workerId) {
  return (gateRequirements[workerId] ?? []).filter(
    (gate) => !approvalValidForGate(episode, gate)
  );
}

function assetExecutionNeedsPreflight(episode) {
  if (episode.production?.assetPlan?.needsRevision === true) return false;
  const assetStep = episode.pipeline.find((step) => step.agent === "asset-agent");
  if (!assetStep || assetStep.requiresHuman === true) return false;
  const hasPreflightCall = (episode.production?.assetPlan?.content?.executionPolicy
    ?.externalApiCalls ?? []).some((call) => call?.executionPreflight?.noGenerationAllowed === true);
  try {
    return Boolean(
      hasPreflightCall &&
      assetExecutionApprovalValid(episode) &&
      !assetExecutionPreflightValid(episode) &&
      episode.production?.assetExecutionPreflightRun?.status !== "checking"
    );
  } catch {
    return false;
  }
}

function workerDispatchToolIds(episode, workerId) {
  const manifestTools = new Set(workerManifest(workerId)?.allowedTools ?? []);
  const episodeTools = new Set(episode.control?.allowedTools ?? []);
  const candidates = workerId === "asset-agent"
    ? approvedAssetExecutionToolIds(episode)
    : [...episodeTools];
  return [...new Set(candidates)].filter((toolId) =>
    manifestTools.has(toolId) && episodeTools.has(toolId)
  );
}

export function kernelSnapshot(sourceEpisode, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const needsAssetPreflight = assetExecutionNeedsPreflight(episode);
  const workers = legalWorkerActions(episode).filter((action) =>
    missingGateApprovals(episode, action.workerId).length === 0 &&
    !(needsAssetPreflight && action.workerId === "asset-agent")
  );
  const waitingApprovals = episode.pipeline
    .filter((step) => step.status === "waiting_approval" && step.gate)
    .map((step) => ({
      action: "wait_for_approval",
      gate: step.gate,
      stepId: step.id,
      reviewPassed: reviewPassedForGate(episode, step.gate)
    }));
  const waitingCheckpoints = Object.entries(episode.reviewCheckpoints ?? {})
    .filter(([, checkpoint]) => checkpoint?.status === "waiting_approval")
    .map(([checkpointId, checkpoint]) => ({
      action: "wait_for_checkpoint",
      checkpointId,
      stepId: checkpointId === "assetExecution" ? "assets" : null,
      machineReviewPassed: checkpoint.machineReview?.status === "passed",
      candidateHash: checkpoint.currentCandidate?.candidateHash ?? null
    }));
  const waitingInputs = episode.pipeline
    .filter((step) => step.requiresHuman === true)
    .map((step) => ({
      action: "wait_for_input",
      stepId: step.id,
      workerId: step.agent,
      inputType: step.agent === "voice-agent" ? "authorized_voice_audio" : "human_intervention"
    }));
  return {
    episodeId: episode.id,
    mode: episode.control.mode,
    stopRequested: episode.control.stopRequested,
    activeRun: Boolean(options.activeRun),
    budget: structuredClone(episode.control.budget),
    allowedTools: [...episode.control.allowedTools],
    legalActions: [
      ...workers.map((worker) => ({
        action: "run_worker",
        ...worker,
        toolIds: workerDispatchToolIds(episode, worker.workerId)
      })),
      ...waitingApprovals,
      ...waitingCheckpoints,
      ...waitingInputs,
      ...(needsAssetPreflight ? [{
        action: "run_checkpoint",
        checkpointId: "assetExecutionPreflight",
        stepId: "assets",
        candidateHash:
          episode.reviewCheckpoints?.assetExecution?.currentCandidate?.candidateHash ?? null,
        generationRequestCount: 0
      }] : []),
      { action: episode.control.stopRequested ? "stop" : "noop" }
    ]
  };
}

export function assertWorkerRunAllowed(sourceEpisode, workerId, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  if (episode.control.stopRequested) throw new Error("本期已请求停止，不能运行 Worker");
  if (options.activeRun) throw new Error("这一期已有 Worker 正在运行");
  const step = episode.pipeline.find((item) => item.agent === workerId);
  if (!step) throw new Error(`Episode has no step for ${workerId}`);
  if (step.requiresHuman) {
    throw new Error(`${step.label}正在等待人工输入，不能重复运行`);
  }
  if (workerId === "asset-agent" && assetExecutionNeedsPreflight(episode)) {
    throw new Error("素材执行候选必须先完成与当前批准绑定的零生成预检");
  }
  if (
    workerId === "asset-agent" &&
    step.status === "blocked" &&
    episode.reviewCheckpoints?.assetExecution?.status === "waiting_approval"
  ) {
    throw new Error("素材执行方案正在等待人工审批，不能重复运行 Asset Agent");
  }
  const missing = missingGateApprovals(episode, workerId);
  if (missing.length > 0) throw new Error(`Worker 缺少人工批准：${missing.join(", ")}`);
  const fixedFallbackStatuses = new Set(["ready", "failed", "blocked", "complete"]);
  const fixedFallbackAllowed =
    options.initiator !== "main-agent" && fixedFallbackStatuses.has(step.status);
  const policyAllowed = legalWorkerActions(episode).some((action) => action.workerId === workerId);
  const approvedWaiting =
    step.status === "waiting_approval" &&
    step.gate &&
    approvalValidForGate(episode, step.gate);
  if (!fixedFallbackAllowed && !policyAllowed && !approvedWaiting) {
    throw new Error(`${step.label}当前状态为 ${step.status}，不能运行`);
  }
  return step;
}

export function validateKernelPlan(sourceEpisode, plan, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const validation = validatePlanAgainstPolicy(episode, plan);
  const errors = [...validation.errors];
  if (options.activeRun && plan.action === "run_worker") {
    errors.push("episode already has an active run");
  }
  if (plan.action === "run_worker") {
    errors.push(...missingGateApprovals(episode, plan.workerId).map((gate) => `missing human gate: ${gate}`));
  }
  return { valid: errors.length === 0, errors };
}

export function assertKernelPlanAllowed(sourceEpisode, plan, options = {}) {
  const validation = validateKernelPlan(sourceEpisode, plan, options);
  if (!validation.valid) {
    throw new Error(`Workflow Kernel 拒绝计划：${validation.errors.join("；")}`);
  }
  return plan;
}

export function recordRoutingOutcome(sourceEpisode, decision, details = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const validation = validateRoutingDecision(decision);
  if (!validation.valid) {
    throw new Error(`路由记录无效：${validation.errors.join("；")}`);
  }
  if (episode.routingHistory.some((entry) => entry.id === decision.id)) return episode;
  episode.routingHistory.push(structuredClone(decision));
  if (decision.outcome?.budgetAccounted === true) return episode;
  const callCount = Math.max(0, details.callCount ?? 0);
  const costUsd = Math.max(
    0,
    details.costUsd
      ?? decision.outcome?.actualCostUsd
      ?? decision.outcome?.accountedCostUsd
      ?? decision.outcome?.estimatedCostUsd
      ?? 0
  );
  episode.control.budget.usedCalls += callCount;
  episode.control.budget.usedCostUsd = Number(
    (episode.control.budget.usedCostUsd + costUsd).toFixed(6)
  );
  episode.control.budget.overrun = Boolean(
    episode.control.budget.overrun || decision.outcome?.budgetOverrun
  );
  return episode;
}
