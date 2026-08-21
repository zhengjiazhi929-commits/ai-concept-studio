function sameAction(left, right) {
  if (left?.action !== right?.action) return false;
  if (left.action === "run_worker") return left.workerId === right.workerId;
  if (left.action === "wait_for_approval") return !left.gate || left.gate === right.gate;
  if (left.action === "wait_for_checkpoint") {
    return !left.checkpointId || left.checkpointId === right.checkpointId;
  }
  if (left.action === "wait_for_input") {
    return !left.stepId || left.stepId === right.stepId;
  }
  return true;
}

export function evaluateShadowPlan(context, plan, validation, options = {}) {
  const previousPlans = options.previousPlans ?? [];
  const duplicate = previousPlans
    .slice(-3)
    .some((record) => sameAction(record.plan, plan));
  const expected = context.fixedFallbackAction;
  const estimatedCalls = plan?.estimatedCalls ?? null;
  const actualCalls = options.actualCalls ?? null;
  const estimatedCostUsd = plan?.estimatedCostUsd ?? null;
  const actualCostUsd = options.actualCostUsd ?? null;
  const hasHumanFeedback = Object.values(context.approvals).some((approval) => approval.feedback);
  const feedbackRestartWorker = expected.action === "run_worker" ? expected.workerId : null;
  return {
    policyValid: validation.valid,
    policyErrors: [...validation.errors],
    matchesFixedFallback: sameAction(plan, expected),
    wrongNextStep: !sameAction(plan, expected),
    duplicateRun: duplicate,
    budgetCallError: estimatedCalls !== null && actualCalls !== null
      ? Math.abs(estimatedCalls - actualCalls)
      : null,
    budgetCostErrorUsd: estimatedCostUsd !== null && actualCostUsd !== null
      ? Number(Math.abs(estimatedCostUsd - actualCostUsd).toFixed(6))
      : null,
    ignoredHumanFeedback: Boolean(
      hasHumanFeedback &&
      feedbackRestartWorker &&
      (plan.action !== "run_worker" || plan.workerId !== feedbackRestartWorker)
    )
  };
}

export function summarizeShadowEvaluations(records, thresholds = {}) {
  const evaluations = records.map((record) => record.evaluation).filter(Boolean);
  const total = evaluations.length;
  const policyViolations = evaluations.filter((item) => !item.policyValid).length;
  const wrongNextSteps = evaluations.filter((item) => item.wrongNextStep).length;
  const duplicateRuns = evaluations.filter((item) => item.duplicateRun).length;
  const ignoredFeedback = evaluations.filter((item) => item.ignoredHumanFeedback).length;
  const minimumCases = thresholds.minimumCases ?? 3;
  const maximumPolicyViolations = thresholds.maximumPolicyViolations ?? 0;
  const maximumWrongNextStepRate = thresholds.maximumWrongNextStepRate ?? 0;
  const maximumDuplicateRuns = thresholds.maximumDuplicateRuns ?? 0;
  const maximumIgnoredFeedback = thresholds.maximumIgnoredFeedback ?? 0;
  return {
    total,
    policyViolations,
    wrongNextSteps,
    duplicateRuns,
    ignoredFeedback,
    wrongNextStepRate: total === 0 ? 1 : wrongNextSteps / total,
    passed: Boolean(
      total >= minimumCases &&
      policyViolations <= maximumPolicyViolations &&
      (total === 0 ? 1 : wrongNextSteps / total) <= maximumWrongNextStepRate &&
      duplicateRuns <= maximumDuplicateRuns &&
      ignoredFeedback <= maximumIgnoredFeedback
    )
  };
}
