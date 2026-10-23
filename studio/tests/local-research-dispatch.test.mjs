import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { acquireEpisodeOperation } from "../src/server/control/episode-operation-lock.mjs";
import { createCapabilityAuthority, requireSideEffectGrant } from "../src/server/security/side-effect-capability.mjs";
import { localResearchCapabilitySpec, localResearchSnapshotHash } from "../src/shared/local-research-request.mjs";
import { issueLocalResearchDispatch, consumeLocalResearchDispatch } from "../src/server/research/local-research-dispatch.mjs";

function fixture(t) {
  const sourceEpisode = {
    id: `synthetic-${randomUUID()}`,
    title: "Synthetic dispatch test",
    research: { version: 0 },
    approvals: { research: { status: "pending" } },
    trendSelection: { primarySources: [{ url: "https://example.test/original" }] },
    control: { stateVersion: 1, activeOperation: null, stopRequested: false },
    pipeline: [{ id: "research", agent: "research-agent", status: "ready", attempts: 0 }]
  };
  const researchConfig = { minimumSources: 3 };
  const reviewConfig = { stages: { research: { semanticReview: false } } };
  const request = { episodeId: sourceEpisode.id, action: "run", candidatePath: null,
    researchVersion: 0, snapshotHash: localResearchSnapshotHash(sourceEpisode, researchConfig, reviewConfig),
    candidateSha256: null, batchId: null, actor: "human:synthetic", reason: "Synthetic Kernel dispatch only", confirmLocalResearch: true };
  let now = Date.now();
  const authority = createCapabilityAuthority({ secret: "synthetic-dispatch-secret-not-real-0000000000", now: () => now });
  const sideEffectGrant = authority.authorize(localResearchCapabilitySpec(request));
  const episode = structuredClone(sourceEpisode);
  episode.control.stateVersion += 1;
  episode.control.activeOperation = { id: "synthetic-operation", kind: "worker:research-agent", startedAt: new Date(now).toISOString() };
  Object.assign(episode.pipeline[0], { status: "running", attempts: 1, startedAt: new Date(now).toISOString(), message: "正在运行", progress: 0, lastError: null });
  episode.updatedAt = new Date(now).toISOString();
  const release = acquireEpisodeOperation(episode.id, "worker:research-agent");
  t.after(release);
  const binding = { request, sourceEpisode, episode, researchConfig, reviewConfig, sideEffectGrant };
  return { binding, request, episode, sideEffectGrant, authority, release,
    issue: () => issueLocalResearchDispatch(binding), expire: () => { now += 60_000; } };
}

test("Kernel dispatch is a one-use in-process token, not a caller-shaped object", t => {
  const f = fixture(t);
  for (const token of [undefined, null, {}, { kind: "local-research-dispatch" }]) {
    assert.throws(() => consumeLocalResearchDispatch(token, f.request, f.episode, f.sideEffectGrant), { code: "local_research_dispatch_required" });
  }
  const token = f.issue();
  assert.doesNotThrow(() => consumeLocalResearchDispatch(token, f.request, f.episode, f.sideEffectGrant));
  assert.throws(() => consumeLocalResearchDispatch(token, f.request, f.episode, f.sideEffectGrant), { code: "local_research_dispatch_replayed" });
});

test("dispatch issuer independently verifies snapshot, free review, actual lock and unchanged research inputs", t => {
  const f = fixture(t);
  assert.throws(() => issueLocalResearchDispatch({ ...f.binding, sourceEpisode: { ...f.binding.sourceEpisode, title: "changed" } }),
    { code: "local_research_snapshot_changed" });
  assert.throws(() => issueLocalResearchDispatch({ ...f.binding, reviewConfig: { stages: { research: { semanticReview: true } } } }),
    { code: "local_research_paid_review_forbidden" });
  const changed = structuredClone(f.episode);
  changed.trendSelection.primarySources = [{ url: "https://example.test/not-authorized" }];
  assert.throws(() => issueLocalResearchDispatch({ ...f.binding, episode: changed }), { code: "local_research_dispatch_mismatch" });
  f.release();
  assert.throws(() => f.issue(), { code: "local_research_dispatch_required" });
});

test("dispatch token binds exact request, grant identity and full running Episode", t => {
  const f = fixture(t);
  const changed = structuredClone(f.episode);
  changed.trendSelection.primarySources = [{ url: "https://example.test/changed" }];
  assert.throws(() => consumeLocalResearchDispatch(f.issue(), f.request, changed, f.sideEffectGrant), { code: "local_research_dispatch_mismatch" });
  assert.throws(() => consumeLocalResearchDispatch(f.issue(), { ...f.request, reason: "A different synthetic request" }, f.episode, f.sideEffectGrant),
    { code: "local_research_dispatch_mismatch" });
  const otherGrant = f.authority.authorize(localResearchCapabilitySpec(f.request));
  assert.throws(() => consumeLocalResearchDispatch(f.issue(), f.request, f.episode, otherGrant), { code: "local_research_dispatch_mismatch" });
});

test("expired or unlocked dispatch cannot enter the Research sink", t => {
  const f = fixture(t);
  const token = f.issue();
  f.expire();
  assert.throws(() => consumeLocalResearchDispatch(token, f.request, f.episode, f.sideEffectGrant), { code: "side_effect_capability_expired" });
  const g = fixture(t);
  const second = g.issue();
  g.release();
  assert.throws(() => consumeLocalResearchDispatch(second, g.request, g.episode, g.sideEffectGrant), { code: "local_research_dispatch_required" });
});

test("local Research sink refuses wider signed budgets and scopes despite a valid signature", t => {
  const f = fixture(t);
  const spec = localResearchCapabilitySpec(f.request);
  const authority = createCapabilityAuthority({ secret: "synthetic-wide-dispatch-secret-not-real-000000", maximumCalls: 1, maximumCostUsd: 1 });
  for (const change of [{ maxCalls: 1 }, { maxCostUsd: 1 }]) {
    const sideEffectGrant = authority.authorize({ ...spec, ...change });
    assert.throws(() => requireSideEffectGrant({ sideEffectGrant }, spec, "worker:research-agent"), { code: "local_research_budget_forbidden" });
  }
  const sideEffectGrant = authority.authorize({ ...spec, scopes: [...spec.scopes, "paid.invoke"] });
  assert.throws(() => requireSideEffectGrant({ sideEffectGrant }, spec, "worker:research-agent"), { code: "local_research_scope_forbidden" });
});
