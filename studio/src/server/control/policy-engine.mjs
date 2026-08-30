import { validateMainAgentPlan } from "../../shared/agent-contracts.mjs";
import { workerManifest } from "../../shared/worker-manifests.mjs";
import {
  currentGateArtifactHash,
  currentGateVersion
} from "../../shared/workflow.mjs";

const RUNNABLE_STATUSES = new Set(["ready", "failed", "blocked"]);

export function legalWorkerActions(episode) {
  if (episode.control?.stopRequested) return [];
  return episode.pipeline
    .filter((step) => {
      if (step.requiresHuman) return false;
      if (
        step.agent === "asset-agent" &&
        step.status === "blocked" &&
        episode.reviewCheckpoints?.assetExecution?.status === "waiting_approval"
      ) {
        return false;
      }
      if (RUNNABLE_STATUSES.has(step.status)) return true;
      return Boolean(
        step.status === "waiting_approval" &&
          step.gate &&
          approvalValidForGate(episode, step.gate)
      );
    })
    .map((step) => ({
      workerId: step.agent,
      stepId: step.id,
      status: step.status,
      gate: step.gate
    }));
}

export function reviewPassedForGate(episode, gate) {
  if (!episode.control?.reviewEnabled) return true;
  const review = episode.reviews?.[gate];
  const artifactVersion = episode.approvals?.[gate]?.currentVersion ?? null;
  const artifactHash = currentGateArtifactHash(episode, gate);
  const report = review?.reports?.find((item) => item.id === review.latestReportId) ?? null;
  return Boolean(
    review?.status === "passed" &&
      Number.isInteger(artifactVersion) &&
      artifactVersion === currentGateVersion(episode, gate) &&
      review.artifactVersion === artifactVersion &&
      review.artifactHash === artifactHash &&
      report?.decision === "pass" &&
      report.artifactVersion === artifactVersion &&
      report.artifactHash === artifactHash
  );
}

export function approvalValidForGate(episode, gate) {
  const approval = episode.approvals?.[gate];
  if (approval?.status !== "approved") return false;
  if (!episode.control?.reviewEnabled) {
    return Boolean(
      approval.currentVersion === currentGateVersion(episode, gate) &&
        approval.artifactHash === currentGateArtifactHash(episode, gate)
    );
  }
  if (approval.provenance !== "reviewed-v2" || !approval.reviewReportId) return false;
  if (approval.reviewReportId !== episode.reviews?.[gate]?.latestReportId) return false;
  return Boolean(
    reviewPassedForGate(episode, gate) &&
      approval.artifactHash === currentGateArtifactHash(episode, gate)
  );
}

export function validatePlanAgainstPolicy(episode, plan) {
  const contract = validateMainAgentPlan(plan);
  const errors = [...contract.errors];
  if (episode.control?.stopRequested && plan.action !== "stop" && plan.action !== "noop") {
    errors.push("episode has a stop request");
  }
  if (plan.action === "run_worker") {
    const legal = legalWorkerActions(episode).find((item) => item.workerId === plan.workerId);
    if (!legal) errors.push(`worker is not currently legal: ${plan.workerId}`);
    const manifest = workerManifest(plan.workerId);
    if (!manifest) errors.push(`worker manifest is missing: ${plan.workerId}`);
    for (const toolId of plan.toolIds ?? []) {
      if (!manifest?.allowedTools.includes(toolId)) {
        errors.push(`worker tool is not allowed by manifest: ${toolId}`);
      }
      if (!episode.control?.allowedTools?.includes(toolId)) {
        errors.push(`worker tool is not allowed for episode: ${toolId}`);
      }
    }
    if (plan.limits?.maxAttempts > (manifest?.maxAttempts ?? 0)) {
      errors.push(`worker attempt limit exceeds manifest: ${plan.limits.maxAttempts}`);
    }
  }
  const budget = episode.control?.budget;
  const requestedCalls = plan.estimatedCalls ?? (plan.action === "run_worker" ? 1 : 0);
  const requestedCost = plan.estimatedCostUsd ?? 0;
  if (
    plan.action === "run_worker" &&
    budget?.maxCalls !== null &&
    budget?.maxCalls !== undefined &&
    budget.usedCalls + (budget.reservedCalls ?? 0) + requestedCalls > budget.maxCalls
  ) {
    errors.push("episode model-call budget is exhausted");
  }
  if (
    plan.action === "run_worker" &&
    budget?.maxCostUsd !== null &&
    budget?.maxCostUsd !== undefined &&
    budget.usedCostUsd + (budget.reservedCostUsd ?? 0) + requestedCost > budget.maxCostUsd
  ) {
    errors.push("episode cost budget is exhausted");
  }
  const allowedTools = new Set(episode.control?.allowedTools ?? []);
  for (const toolId of plan.toolIds ?? []) {
    if (!allowedTools.has(toolId)) errors.push(`tool is not allowed: ${toolId}`);
  }
  if (plan.action === "wait_for_approval") {
    const waiting = episode.pipeline.some((step) => step.status === "waiting_approval");
    if (!waiting) errors.push("no human approval is currently pending");
  }
  if (plan.action === "wait_for_checkpoint") {
    const waiting = Object.values(episode.reviewCheckpoints ?? {})
      .some((checkpoint) => checkpoint?.status === "waiting_approval");
    if (!waiting) errors.push("no human checkpoint is currently pending");
  }
  if (plan.action === "wait_for_input") {
    const waiting = episode.pipeline.some((step) => step.requiresHuman === true);
    if (!waiting) errors.push("no human input is currently pending");
  }
  if (
    plan.limits?.maxRevisionRounds !== undefined &&
    plan.limits.maxRevisionRounds > (episode.control?.revisionLimit ?? 2)
  ) {
    errors.push("plan revision limit exceeds kernel policy");
  }
  return { valid: errors.length === 0, errors };
}

export function assertPlanAllowed(episode, plan) {
  const validation = validatePlanAgainstPolicy(episode, plan);
  if (!validation.valid) throw new Error(`Main Agent 计划被策略拒绝：${validation.errors.join("；")}`);
  return plan;
}
