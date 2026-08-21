import { kernelSnapshot } from "./workflow-kernel.mjs";
import { redactSensitiveText } from "../../shared/redaction.mjs";
import { integrityHash } from "../../shared/integrity.mjs";

function safeText(value, maximumLength = 500) {
  return redactSensitiveText(value, maximumLength);
}

function expectedFixedAction(episode, snapshot = kernelSnapshot(episode)) {
  if (episode.control?.stopRequested) return { action: "stop" };
  const worker = snapshot.legalActions.find((action) => action.action === "run_worker");
  if (worker) return { action: "run_worker", workerId: worker.workerId };
  const waiting = snapshot.legalActions.find((action) => action.action === "wait_for_approval");
  if (waiting) return { action: "wait_for_approval", gate: waiting.gate };
  const checkpoint = snapshot.legalActions.find(
    (action) => action.action === "wait_for_checkpoint"
  );
  if (checkpoint) {
    return { action: "wait_for_checkpoint", checkpointId: checkpoint.checkpointId };
  }
  const input = snapshot.legalActions.find((action) => action.action === "wait_for_input");
  if (input) return { action: "wait_for_input", stepId: input.stepId };
  return { action: "noop" };
}

export function buildMainAgentContext(sourceEpisode, options = {}) {
  const snapshot = kernelSnapshot(sourceEpisode, { activeRun: options.activeRun });
  const approvals = Object.fromEntries(
    Object.entries(sourceEpisode.approvals ?? {}).map(([gate, approval]) => [gate, {
      status: approval.status,
      currentVersion: approval.currentVersion,
      feedback: safeText(approval.feedback || approval.history?.at(-1)?.note || "")
    }])
  );
  const reviews = Object.fromEntries(
    Object.entries(sourceEpisode.reviews ?? {}).map(([stage, review]) => {
      const latest = review.reports?.find((report) => report.id === review.latestReportId)
        ?? review.reports?.at(-1);
      return [stage, {
        status: review.status,
        artifactVersion: review.artifactVersion,
        revisionRounds: review.revisionRounds,
        latestDecision: latest?.decision ?? null,
        blockingIssues: (latest?.blockingIssues ?? []).map((issue) => ({
          code: issue.code,
          location: safeText(issue.location, 120),
          evidence: safeText(issue.evidence)
        }))
      }];
    })
  );
  const context = {
    contextVersion: "main-agent-context-v2",
    episode: {
      id: sourceEpisode.id,
      title: safeText(sourceEpisode.title, 200),
      status: sourceEpisode.status,
      updatedAt: sourceEpisode.updatedAt,
      stateVersion: sourceEpisode.control?.stateVersion ?? 0
    },
    mode: snapshot.mode,
    legalActions: snapshot.legalActions,
    fixedFallbackAction: expectedFixedAction(sourceEpisode, snapshot),
    approvals,
    reviews,
    failures: sourceEpisode.pipeline
      .filter((step) => ["failed", "blocked"].includes(step.status))
      .map((step) => ({
        workerId: step.agent,
        status: step.status,
        attempts: step.attempts ?? 0,
        message: safeText(step.message),
        lastError: safeText(step.lastError)
      })),
    recentHistory: (sourceEpisode.history ?? []).slice(-(options.historyLimit ?? 8)).map((entry) => ({
      at: entry.at,
      type: entry.type,
      agentId: entry.agentId ?? null,
      gate: entry.gate ?? null,
      status: entry.status ?? null,
      message: safeText(entry.message)
    })),
    budget: snapshot.budget,
    allowedTools: snapshot.allowedTools,
    providerHealth: Object.fromEntries(
      Object.entries(options.providerHealth ?? {}).map(([providerId, health]) => [providerId, {
        state: health.state ?? "unknown",
        lastLatencyMs: health.lastLatencyMs ?? null,
        lastError: safeText(health.lastError, 120)
      }])
    )
  };
  const serialized = JSON.stringify(context);
  return {
    ...context,
    contextHash: integrityHash(context),
    estimatedTokens: Math.ceil(serialized.length / 3),
    sectionBudgets: {
      approvals: Object.keys(approvals).length,
      reviews: Object.keys(reviews).length,
      failures: context.failures.length,
      history: context.recentHistory.length
    }
  };
}

export { expectedFixedAction };
