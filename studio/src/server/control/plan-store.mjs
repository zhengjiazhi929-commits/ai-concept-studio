import { ensureAgentArchitecture } from "../../shared/agent-contracts.mjs";

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

export function beginPlanAttempt(sourceEpisode, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const version = episode.control.planVersion + 1;
  episode.control.planVersion = version;
  episode.control.currentPlan = {
    id: `plan-${episode.id}-v${version}`,
    version,
    status: "planning",
    mode: options.mode ?? episode.control.mode ?? "shadow",
    startedAt: timestamp(options.now)
  };
  return episode;
}

export function completePlanAttempt(sourceEpisode, result, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const version = episode.control.currentPlan?.version ?? episode.control.planVersion + 1;
  episode.control.planVersion = Math.max(episode.control.planVersion, version);
  const record = {
    id: episode.control.currentPlan?.id ?? `plan-${episode.id}-v${version}`,
    version,
    mode: episode.control.currentPlan?.mode ?? options.mode ?? episode.control.mode ?? "shadow",
    status: result.validation.valid ? "proposed" : "rejected",
    startedAt: episode.control.currentPlan?.startedAt ?? timestamp(options.now),
    completedAt: timestamp(options.now),
    plan: structuredClone(result.plan),
    validation: structuredClone(result.validation),
    evaluation: structuredClone(result.evaluation),
    routingDecision: result.routingDecision ? structuredClone(result.routingDecision) : null,
    contextHash: result.context?.contextHash ?? null,
    contextEstimatedTokens: result.context?.estimatedTokens ?? null
  };
  episode.control.currentPlan = record;
  episode.planHistory.push(record);
  return { episode, record };
}

export function failPlanAttempt(sourceEpisode, error, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  const version = episode.control.currentPlan?.version ?? episode.control.planVersion + 1;
  episode.control.planVersion = Math.max(episode.control.planVersion, version);
  const record = {
    id: episode.control.currentPlan?.id ?? `plan-${episode.id}-v${version}`,
    version,
    mode: episode.control.currentPlan?.mode ?? options.mode ?? episode.control.mode ?? "shadow",
    status: "failed",
    startedAt: episode.control.currentPlan?.startedAt ?? timestamp(options.now),
    completedAt: timestamp(options.now),
    errorCode: error?.code ?? "planning_failed",
    message: error instanceof Error ? error.message : "Main Agent 规划失败"
  };
  episode.control.currentPlan = record;
  episode.planHistory.push(record);
  return { episode, record };
}

export function recoverInterruptedPlan(sourceEpisode, options = {}) {
  const episode = ensureAgentArchitecture(sourceEpisode);
  if (episode.control.currentPlan?.status !== "planning") {
    return { episode, recovered: false };
  }
  const failed = failPlanAttempt(
    episode,
    Object.assign(new Error("Main Agent 规划被进程中断，可以安全重试"), {
      code: "process_interrupted"
    }),
    options
  );
  return { episode: failed.episode, recovered: true, record: failed.record };
}
