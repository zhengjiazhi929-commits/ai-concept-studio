import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJsonDocumentContentSha256 } from "../src/shared/durable-json-store.mjs";
import {
  assertLocalResearchEpisode,
  localResearchCapabilitySpec,
  localResearchError,
  localResearchSnapshotHash,
  validateLocalResearchPreview,
  validateLocalResearchRequest
} from "../src/shared/local-research-request.mjs";

const digest = "a".repeat(64);
const runRequest = () => ({
  episodeId: "synthetic-harness-episode",
  action: "run",
  candidatePath: null,
  researchVersion: 0,
  snapshotHash: digest,
  candidateSha256: null,
  batchId: null,
  actor: "human:synthetic-editor",
  reason: "Verify synthetic research evidence only",
  confirmLocalResearch: true
});
const importRequest = () => ({
  ...runRequest(),
  action: "import",
  candidatePath: "studio/data/research/inbox/synthetic-evidence.json",
  candidateSha256: "b".repeat(64),
  batchId: "synthetic-evidence"
});
const episode = () => ({
  id: "synthetic-harness-episode",
  research: { version: 0 },
  control: { activeOperation: null, stopRequested: false },
  pipeline: [{ id: "research", agent: "research-agent", status: "ready" }],
  approvals: { research: { status: "pending" } }
});
const invalidRequest = { code: "local_research_request_invalid" };

test("local Research accepts only exact preview targets and action-specific candidates", () => {
  assert.deepEqual(validateLocalResearchPreview({
    episodeId: "synthetic-harness-episode", action: "run", candidatePath: null
  }), { episodeId: "synthetic-harness-episode", action: "run", candidatePath: null });
  for (const candidatePath of ["outputs/research/evidence.json", "studio/data/research/inbox/evidence.json"]) {
    assert.equal(validateLocalResearchPreview({
      episodeId: "synthetic-harness-episode", action: "import", candidatePath
    }).candidatePath, candidatePath);
  }
  for (const input of [
    { episodeId: "synthetic-harness-episode", action: "run" },
    { episodeId: "synthetic-harness-episode", action: "run", candidatePath: "outputs/evidence.json" },
    { episodeId: "synthetic-harness-episode", action: "import", candidatePath: null },
    { episodeId: "../episode", action: "run", candidatePath: null },
    { episodeId: "synthetic-harness-episode", action: "approve", candidatePath: null },
    { episodeId: "synthetic-harness-episode", action: "run", candidatePath: null, scopes: [] }
  ]) assert.throws(() => validateLocalResearchPreview(input), invalidRequest);
});

test("local Research rejects candidate path escapes and ambiguous paths", () => {
  for (const candidatePath of [
    "/outputs/evidence.json", "../outputs/evidence.json", "outputs/../evidence.json",
    "outputs/./evidence.json", "outputs//evidence.json", "outputs\\evidence.json",
    "studio/data/episodes/episode.json", "outputs/evidence.json?x=1", "outputs/evidence.json#x",
    "outputs/evidence.json\n", "outputs/ bad/evidence.json", "outputs/evidence.txt",
    " outputs/evidence.json", "outputs/evidence.json ", "outputs/\u0000evidence.json"
  ]) assert.throws(() => validateLocalResearchRequest({ ...importRequest(), candidatePath }), invalidRequest);
});

test("local Research requests enforce closed data fields without evaluating getters", () => {
  for (const validate of [validateLocalResearchPreview, validateLocalResearchRequest]) {
    const valid = validate === validateLocalResearchPreview
      ? { episodeId: "synthetic-harness-episode", action: "run", candidatePath: null }
      : runRequest();
    let reads = 0;
    const getter = { ...valid };
    Object.defineProperty(getter, "episodeId", { enumerable: true, get() { reads += 1; return valid.episodeId; } });
    const hidden = { ...valid };
    Object.defineProperty(hidden, "episodeId", { value: valid.episodeId, enumerable: false });
    for (const input of [getter, hidden, { ...valid, [Symbol("hidden")]: true },
      Object.assign(Object.create({ inherited: true }), valid), { ...valid, dependencies: {} }]) {
      assert.throws(() => validate(input), invalidRequest);
    }
    assert.equal(reads, 0);
    assert.deepEqual(validate(Object.assign(Object.create(null), valid)), valid);
  }
});

test("local Research request requires explicit confirmation and complete version/hash binding", () => {
  assert.deepEqual(validateLocalResearchRequest(runRequest()), runRequest());
  assert.deepEqual(validateLocalResearchRequest(importRequest()), importRequest());
  const mutations = [
    { researchVersion: -1 }, { researchVersion: 0.5 }, { researchVersion: "0" },
    { researchVersion: Number.MAX_SAFE_INTEGER + 1 }, { snapshotHash: "a" },
    { snapshotHash: "A".repeat(64) }, { actor: "agent:synthetic" },
    { actor: "human:has space" }, { reason: "bad" }, { reason: " padded " },
    { reason: "unsafe\nreason" }, { confirmLocalResearch: false },
    { candidateSha256: "b".repeat(64) }, { batchId: "synthetic-evidence" }
  ];
  for (const mutation of mutations) {
    assert.throws(() => validateLocalResearchRequest({ ...runRequest(), ...mutation }), invalidRequest);
  }
  for (const mutation of [{ candidateSha256: null }, { batchId: null }, { batchId: "../escape" }]) {
    assert.throws(() => validateLocalResearchRequest({ ...importRequest(), ...mutation }), invalidRequest);
  }
  const missing = runRequest();
  delete missing.reason;
  assert.throws(() => validateLocalResearchRequest(missing), invalidRequest);
});

test("local Research grants bind every request field and retain fixed zero-cost operations", () => {
  for (const request of [runRequest(), importRequest()]) {
    const spec = localResearchCapabilitySpec(request);
    assert.equal(spec.episodeId, `local-research/${canonicalJsonDocumentContentSha256(request)}`);
    assert.equal(spec.operation, request.action === "run" ? "worker:research-agent" : "research:import-evidence");
    assert.deepEqual(spec.scopes, request.action === "run"
      ? ["state.write", "filesystem.write", "network.request"]
      : ["state.write", "filesystem.write"]);
    assert.equal(spec.maxCalls, 0);
    assert.equal(spec.maxCostUsd, 0);
    for (const change of [
      { episodeId: "synthetic-other-episode" }, { researchVersion: 1 },
      { snapshotHash: "c".repeat(64) }, { actor: "human:another-editor" },
      { reason: "Another explicitly confirmed synthetic reason" }
    ]) assert.notEqual(localResearchCapabilitySpec({ ...request, ...change }).episodeId, spec.episodeId);
  }
  for (const change of [
    { candidatePath: "outputs/another-evidence.json" },
    { candidateSha256: "d".repeat(64) }, { batchId: "another-evidence" }
  ]) assert.notEqual(localResearchCapabilitySpec({ ...importRequest(), ...change }).episodeId,
    localResearchCapabilitySpec(importRequest()).episodeId);
  assert.notEqual(localResearchCapabilitySpec(runRequest()).episodeId,
    localResearchCapabilitySpec(importRequest()).episodeId);
});

test("local Research snapshots bind full Episode, both configurations and candidate content", () => {
  const state = episode();
  const researchConfig = { minimumSources: 3 };
  const reviewConfig = { stages: { research: { version: "synthetic-review-v1" } } };
  const initial = localResearchSnapshotHash(state, researchConfig, reviewConfig);
  assert.equal(initial, canonicalJsonDocumentContentSha256({
    episode: state, researchConfig, reviewConfig, candidateSha256: null
  }));
  assert.notEqual(localResearchSnapshotHash({ ...state, title: "Changed title" }, researchConfig, reviewConfig), initial);
  assert.notEqual(localResearchSnapshotHash(state, { minimumSources: 4 }, reviewConfig), initial);
  assert.notEqual(localResearchSnapshotHash(state, researchConfig, { changed: true }), initial);
  assert.notEqual(localResearchSnapshotHash(state, researchConfig, reviewConfig, digest), initial);
});

test("local Research Episode assertion rejects cross-Episode and stale versions", () => {
  assert.doesNotThrow(() => assertLocalResearchEpisode(runRequest(), episode()));
  const initial = episode();
  delete initial.research;
  assert.doesNotThrow(() => assertLocalResearchEpisode(runRequest(), initial));
  assert.throws(() => assertLocalResearchEpisode(runRequest(), { ...episode(), id: "another-episode" }),
    { code: "local_research_episode_mismatch" });
  assert.throws(() => assertLocalResearchEpisode(runRequest(), { ...episode(), research: { version: 1 } }),
    { code: "local_research_version_changed" });
});

test("local Research initial assertion rejects running, stopped and approved research", () => {
  assert.doesNotThrow(() => assertLocalResearchEpisode(runRequest(), episode(), { initial: true }));
  for (const state of [
    { ...episode(), control: { activeOperation: { id: "synthetic-operation" } } },
    { ...episode(), control: { stopRequested: true } },
    { ...episode(), pipeline: [{ id: "research", agent: "research-agent", status: "running" }] }
  ]) assert.throws(() => assertLocalResearchEpisode(runRequest(), state, { initial: true }),
    { code: "local_research_episode_busy" });
  assert.throws(() => assertLocalResearchEpisode(runRequest(), {
    ...episode(), approvals: { research: { status: "approved" } }
  }, { initial: true }), { code: "local_research_already_approved" });
  assert.throws(() => assertLocalResearchEpisode(runRequest(), { ...episode(), pipeline: [] }, { initial: true }),
    { code: "local_research_episode_invalid" });
  const active = { ...episode(), control: { activeOperation: { id: "synthetic-operation" } } };
  assert.doesNotThrow(() => assertLocalResearchEpisode(runRequest(), active));
  const error = localResearchError("local_research_synthetic", "Synthetic error");
  assert.equal(error.code, "local_research_synthetic");
  assert.equal(error.statusCode, 409);
});
