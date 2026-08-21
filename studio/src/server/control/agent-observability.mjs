import { ensureAgentArchitecture } from "../../shared/agent-contracts.mjs";

function rate(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

export function summarizeAgentOperations(sourceEpisode, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const plans = episode.planHistory.filter((record) => record.status !== "planning");
  const evaluations = plans.map((record) => record.evaluation).filter(Boolean);
  const reviews = Object.values(episode.reviews)
    .flatMap((review) => review.reports ?? []);
  const dispatches = episode.dispatchHistory ?? [];
  const completedDispatches = dispatches.filter((item) => item.status === "completed").length;
  const failedDispatches = dispatches.filter((item) => item.status === "failed").length;
  const revisedReviews = reviews.filter((item) => item.decision === "revise").length;
  const escalatedReviews = reviews.filter((item) => item.decision === "escalate").length;
  const thresholds = {
    maximumPlanRejectionRate: options.maximumPlanRejectionRate ?? 0.05,
    maximumWrongNextStepRate: options.maximumWrongNextStepRate ?? 0.05,
    maximumDispatchFailureRate: options.maximumDispatchFailureRate ?? 0.1
  };
  const planRejectionRate = rate(plans.filter((item) => item.status === "rejected").length, plans.length);
  const wrongNextStepRate = rate(evaluations.filter((item) => item.wrongNextStep).length, evaluations.length);
  const dispatchFailureRate = rate(failedDispatches, completedDispatches + failedDispatches);
  return {
    episodeId: episode.id,
    stateVersion: episode.control.stateVersion,
    mode: episode.control.mode,
    plans: {
      total: plans.length,
      rejected: plans.filter((item) => item.status === "rejected").length,
      rejectionRate: planRejectionRate,
      wrongNextSteps: evaluations.filter((item) => item.wrongNextStep).length,
      wrongNextStepRate,
      duplicateRuns: evaluations.filter((item) => item.duplicateRun).length,
      ignoredHumanFeedback: evaluations.filter((item) => item.ignoredHumanFeedback).length
    },
    reviews: {
      total: reviews.length,
      passed: reviews.filter((item) => item.decision === "pass").length,
      revised: revisedReviews,
      escalated: escalatedReviews,
      interventionRate: rate(revisedReviews + escalatedReviews, reviews.length)
    },
    dispatches: {
      total: dispatches.length,
      completed: completedDispatches,
      failed: failedDispatches,
      cancelled: dispatches.filter((item) => item.status === "cancelled").length,
      failureRate: dispatchFailureRate
    },
    budget: {
      usedCalls: episode.control.budget.usedCalls,
      usedCostUsd: episode.control.budget.usedCostUsd,
      overrun: episode.control.budget.overrun,
      utilization: episode.control.budget.maxCostUsd === null
        ? null
        : rate(episode.control.budget.usedCostUsd, episode.control.budget.maxCostUsd)
    },
    recovery: {
      interruptedPlans: plans.filter((item) => item.errorCode === "process_interrupted").length,
      interruptedDispatches: dispatches.filter((item) => item.reasonCode === "process_interrupted").length,
      interruptedWorkers: (episode.history ?? []).filter((item) => item.type === "recovery").length
    },
    slo: {
      healthy: Boolean(
        planRejectionRate <= thresholds.maximumPlanRejectionRate &&
        wrongNextStepRate <= thresholds.maximumWrongNextStepRate &&
        dispatchFailureRate <= thresholds.maximumDispatchFailureRate &&
        !episode.control.budget.overrun
      ),
      thresholds
    }
  };
}
