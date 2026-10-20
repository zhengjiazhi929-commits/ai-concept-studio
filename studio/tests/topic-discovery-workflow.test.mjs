import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setupPublicDiscoveryIdentity} from "../scripts/lib/public-discovery-authority.mjs";
import {runTopicDiscoveryCli} from "../scripts/run-topic-discovery.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), "topic-flow-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const configPath = join(root, "private", "identity.json");
  await setupPublicDiscoveryIdentity({actor: "human:fixture", confirmPublicDiscovery: true, configPath});
  const calls = [];
  return {root, configPath, calls, deps: {
    environment: {}, inboxRoot: root,
    collect: async options => {calls.push(["collect", options]); return {run: {id: "collector-1", summary: {}}, assistTask: {taskId: "task-1", tasks: [{creatorId: "one"}]}};},
    importBatch: async (batch, options) => {calls.push(["import", options, batch]); return {run: {id: "batch-1", summary: {}, discoverySummary: {scanned: 1, notScanned: 0}}};},
    radar: async options => {calls.push(["radar", options]); return {run: {id: "radar-1", summary: {formalCandidateCount: 0, freshness: {status: "empty"}}, candidates: []}};}
  }};
}

test("topic workflow authorizes collection then radar and returns the Codex continuation", async t => {
  const f = await fixture(t);
  const result = await runTopicDiscoveryCli(["--identity", f.configPath], f.deps);
  assert.deepEqual(f.calls.map(c => c[0]), ["collect", "radar"]);
  assert.equal(f.calls[0][1].requireSideEffectCapability, true);
  assert.equal(f.calls[0][1].refreshRadar, false);
  assert.equal(result.status, "awaiting_public_discovery");
  assert.equal(result.continuation.taskId, "task-1");
  assert.equal(result.authorizesCandidateSelection, false);
});

test("resume imports a v2 inbox batch without resetting the discovery task", async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, "batch.json"), JSON.stringify({schemaVersion: 2, observations: [], sourceChecks: [{status: "blocked"}]}));
  const result = await runTopicDiscoveryCli(["--identity", f.configPath, "--batch", "batch.json"], f.deps);
  assert.deepEqual(f.calls.map(c => c[0]), ["import", "radar"]);
  assert.equal(result.status, "needs_more_evidence");
});

test("formal candidates are returned for human choice, never selected by the workflow", async t => {
  const f = await fixture(t);
  f.deps.radar = async () => ({run: {id: "radar-2", summary: {formalCandidateCount: 1}, candidates: [{id: "topic", recommendedPool: "formal_candidate", selectionStatus: "not_selected"}]}});
  const result = await runTopicDiscoveryCli(["--identity", f.configPath], f.deps);
  assert.equal(result.status, "awaiting_topic_selection");
  assert.equal(result.candidates[0].selectionStatus, "not_selected");
  assert.equal(result.authorizesCandidateSelection, false);
});

test("malformed options, legacy batches and absent authorization cannot start Agents", async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, "legacy.json"), JSON.stringify({schemaVersion: 1, observations: [{}]}));
  for (const args of [["--unknown"], ["--batch"], ["--batch", "../outside.json"], ["--batch", "legacy.json"], ["--batch", "batch.json", "--batch", "other.json"]]) {
    await assert.rejects(runTopicDiscoveryCli(["--identity", f.configPath, ...args], f.deps));
  }
  await assert.rejects(runTopicDiscoveryCli(["--identity", join(f.root, "missing", "identity.json")], f.deps));
  assert.deepEqual(f.calls, []);
});
