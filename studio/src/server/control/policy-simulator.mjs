import { validatePlanAgainstPolicy } from "./policy-engine.mjs";

function outcome(validation) {
  return { allowed: validation.valid, errors: [...validation.errors] };
}

export function replayPolicyCases(cases = [], options = {}) {
  const currentValidator = options.currentValidator ?? validatePlanAgainstPolicy;
  const proposedValidator = options.proposedValidator ?? validatePlanAgainstPolicy;
  const results = cases.map((testCase) => {
    const current = outcome(currentValidator(testCase.episode, testCase.plan));
    const proposedEpisode = options.transformEpisode
      ? options.transformEpisode(structuredClone(testCase.episode), testCase)
      : testCase.episode;
    const proposedPlan = options.transformPlan
      ? options.transformPlan(structuredClone(testCase.plan), testCase)
      : testCase.plan;
    const proposed = outcome(proposedValidator(proposedEpisode, proposedPlan));
    return {
      caseId: testCase.caseId,
      current,
      proposed,
      change: current.allowed === proposed.allowed
        ? "unchanged"
        : proposed.allowed ? "newly-allowed" : "newly-blocked",
      estimatedCostDeltaUsd: Number(
        ((proposedPlan.estimatedCostUsd ?? 0) - (testCase.plan.estimatedCostUsd ?? 0)).toFixed(6)
      )
    };
  });
  return {
    total: results.length,
    newlyAllowed: results.filter((item) => item.change === "newly-allowed").length,
    newlyBlocked: results.filter((item) => item.change === "newly-blocked").length,
    unchanged: results.filter((item) => item.change === "unchanged").length,
    estimatedCostDeltaUsd: Number(
      results.reduce((sum, item) => sum + item.estimatedCostDeltaUsd, 0).toFixed(6)
    ),
    results
  };
}
