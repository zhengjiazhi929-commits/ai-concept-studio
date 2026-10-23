// Internal Kernel-to-Research handoff. Tokens never leave this process or enter CLI input.
import { canonicalJsonDocumentContentSha256 as digest } from "../../shared/durable-json-store.mjs";
import {
  assertLocalResearchEpisode,
  localResearchCapabilitySpec,
  localResearchError,
  localResearchSnapshotHash,
  validateLocalResearchRequest
} from "../../shared/local-research-request.mjs";
import { episodeOperation } from "../control/episode-operation-lock.mjs";
import { requireSideEffectGrant } from "../security/side-effect-capability.mjs";

const dispatches = new WeakMap();
const worker = "worker:research-agent";

function requireRunningOperation(episode) {
  const active = episode?.control?.activeOperation;
  if (episodeOperation(episode?.id)?.kind !== worker || active?.kind !== worker ||
    typeof active.id !== "string" || !active.id) {
    throw localResearchError("local_research_dispatch_required");
  }
}

function stableInputs(episode) {
  const value = structuredClone(episode);
  delete value.updatedAt;
  delete value.control.activeOperation;
  delete value.control.stateVersion;
  const step = value.pipeline.find((item) => item.agent === "research-agent");
  if (!step) throw localResearchError("local_research_dispatch_mismatch");
  // These are the only fields runAgent changes while claiming its initial run.
  for (const key of ["status", "message", "progress", "startedAt", "attempts", "lastError"]) delete step[key];
  return value;
}

export function issueLocalResearchDispatch({ request: rawRequest, sourceEpisode, episode,
  researchConfig, reviewConfig, sideEffectGrant }) {
  const request = validateLocalResearchRequest(rawRequest);
  if (request.action !== "run") throw localResearchError("local_research_dispatch_mismatch");
  assertLocalResearchEpisode(request, sourceEpisode, { initial: true });
  assertLocalResearchEpisode(request, episode);
  if (reviewConfig?.stages?.research?.semanticReview !== false) {
    throw localResearchError("local_research_paid_review_forbidden");
  }
  if (localResearchSnapshotHash(sourceEpisode, researchConfig, reviewConfig) !== request.snapshotHash) {
    throw localResearchError("local_research_snapshot_changed");
  }
  requireSideEffectGrant({ sideEffectGrant }, localResearchCapabilitySpec(request), worker);
  requireRunningOperation(episode);
  const step = episode.pipeline?.find((item) => item.agent === "research-agent");
  const sourceStep = sourceEpisode.pipeline?.find((item) => item.agent === "research-agent");
  if (step?.status !== "running" || step.attempts !== (sourceStep?.attempts ?? 0) + 1 ||
    episode.control.stateVersion !== (sourceEpisode.control?.stateVersion ?? 0) + 1 ||
    digest(stableInputs(sourceEpisode)) !== digest(stableInputs(episode))) {
    throw localResearchError("local_research_dispatch_mismatch");
  }
  const token = Object.freeze(Object.create(null));
  dispatches.set(token, {
    requestHash: digest(request), episodeHash: digest(episode), sideEffectGrant, consumed: false,
    sourceEpisode:structuredClone(sourceEpisode)
  });
  return token;
}

export function consumeLocalResearchDispatch(token, rawRequest, episode, sideEffectGrant) {
  const binding = token && typeof token === "object" ? dispatches.get(token) : null;
  if (!binding) throw localResearchError("local_research_dispatch_required");
  if (binding.consumed) throw localResearchError("local_research_dispatch_replayed");
  // A failed attempted handoff cannot be retried with altered inputs.
  binding.consumed = true;
  const request = validateLocalResearchRequest(rawRequest);
  if (binding.sideEffectGrant !== sideEffectGrant || binding.requestHash !== digest(request) ||
    binding.episodeHash !== digest(episode)) {
    throw localResearchError("local_research_dispatch_mismatch");
  }
  requireRunningOperation(episode);
  requireSideEffectGrant({ sideEffectGrant }, localResearchCapabilitySpec(request), "research:run");
  return {sourceEpisode:structuredClone(binding.sourceEpisode)};
}
