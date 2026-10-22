import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runCollectorAgent, importAssistedCollectorBatch } from "../src/server/collector/agent.mjs";
import { buildRecentDiscoveryTask } from "../src/server/collector/discovery.mjs";
import * as collectorStore from "../src/server/collector/store.mjs";
import { createCapabilityAuthority } from "../src/server/security/side-effect-capability.mjs";

const now = new Date("2026-09-09T06:00:00Z");
const sources = { creators: [
  { id: "first", name: "示例作者", platform: "douyin", enabled: true, profileUrl: "https://www.douyin.com/user/first" },
  { id: "second", name: "示例UP", platform: "bilibili", enabled: true, profileUrl: "https://www.bilibili.com/video/BV123/" },
  { id: "third", name: "其他作者", platform: "douyin", enabled: true, profileUrl: "https://www.douyin.com/user/third" },
  { id: "disabled", name: "停用作者", platform: "douyin", enabled: false, profileUrl: "https://www.douyin.com/user/disabled" }
] };

function fixture() {
  const state = { writes: [], signals: [], health: [], claims: new Map(), run: null, task: buildRecentDiscoveryTask({ sources, now, lookbackDays: 30 }) };
  const dependencies = {
    appendEvent: async (event) => { state.writes.push(event.type); },
    collectPublicSource: async (source) => ({ creatorId: source.id, status: "success", observations: [] }),
    readCollectorConfig: async () => ({ maxConcurrency: 1, lookbackDays: 30, sourceFreshnessDays: 14, refreshRadarAfterCollection: false }),
    readCollectorSourceHealth: async () => ({ schemaVersion: 1, sources: [] }),
    readConceptTaxonomy: async () => ({ schemaVersion: 1, concepts: [{ id: "memory", name: "Memory", aliases: ["记忆"] }] }),
    readTrendSignals: async () => ({ schemaVersion: 1, signals: [] }),
    readTrendSources: async () => structuredClone(sources),
    runTrendRadarAgent: async () => { throw new Error("No radar refresh expected"); },
    updateCollectorSourceHealth: async (entries) => { state.health = entries; state.writes.push("health"); },
    upsertTrendSignals: async (signals) => { state.signals = signals; state.writes.push("signals"); return { added: signals.length, updated: 0, unchanged: 0 }; },
    writeCollectorAssistTask: async (task) => { state.task = task; state.writes.push("task"); },
    readCollectorAssistTask: async () => structuredClone(state.task),
    readCollectorRun: async () => state.existingRun ?? null,
    claimCollectorBatch: async (value) => {
      if (state.claims.has(value.batchId)) throw Object.assign(new Error("Already claimed"), { code: "collector_batch_already_claimed" });
      state.claims.set(value.batchId, structuredClone(value));
      state.writes.push("claim");
    },
    writeCollectorRun: async (run) => { state.run = run; state.writes.push("run"); return "/synthetic/run.json"; }
  };
  return { state, dependencies };
}

function batch(task) {
  return {
    schemaVersion: 2,
    batchId: "discovery-agent-fixture",
    discoveryTaskId: task.taskId,
    observedAt: now.toISOString(),
    method: "公开原作品页面核验",
    sourceChecks: [
      { creatorId: "first", status: "verified", checkedAt: now.toISOString(), url: "https://www.douyin.com/video/789" },
      { creatorId: "second", status: "blocked", checkedAt: now.toISOString(), url: "https://www.bilibili.com/video/BV123/", reason: "公开页面要求验证" }
    ],
    observations: [{
      creatorId: "first", title: "Agent记忆机制", sourceUrl: "https://www.douyin.com/video/789",
      publishedAt: "2026-09-07T04:00:00Z", datePrecision: "page-date", conceptIds: ["memory"],
      evidence: { authorName: "示例作者", authorUrl: "https://www.douyin.com/user/first", url: "https://www.douyin.com/video/789", publishedText: "2026-09-07 12:00", excerpt: "示例作者 2026-09-07 12:00 Agent记忆机制" }
    }]
  };
}

test("Collector prepares v2 recent discovery for every enabled source after fixed-page reads", async () => {
  const { state, dependencies } = fixture();
  const { run } = await runCollectorAgent({ dependencies, now });
  assert.equal(state.task.schemaVersion, 2);
  assert.deepEqual(state.task.tasks.map((task) => task.creatorId), ["first", "second", "third"]);
  assert.equal(run.discoveryTaskId, state.task.taskId);
  assert.equal(run.discoverySummary.scanned, 0);
  assert.equal(run.discoverySummary.notScanned, 3);
  assert.equal(run.discoverySummary.complete, false);
  assert.equal(run.sourceResults.every((source) => source.discoveryStatus === "not_scanned"), true);
});

test("Collector passes the configured source to direct observation identity validation", async () => {
  const { state, dependencies } = fixture();
  dependencies.collectPublicSource = async (source) => ({
    creatorId: source.id, status: "success", observations: source.id !== "first" ? [] : [{
      ...batch(state.task).observations[0], evidence: undefined, pageCreatorName: "另一个作者"
    }]
  });
  const { run } = await runCollectorAgent({ dependencies, now });
  assert.equal(state.signals.length, 0);
  assert.equal(run.pendingReview[0].reason, "creator-identity-mismatch");
  assert.notEqual(state.health.find((entry) => entry.creatorId === "first").status, "success");
});

test("v2 import validates current task and full evidence before any write", async () => {
  for (const mutate of [
    (value) => { value.discoveryTaskId = "stale-task"; },
    (value) => { value.observations[0].evidence.authorName = "wrong"; },
    (value) => { value.batchId = "../outside"; }
  ]) {
    const { state, dependencies } = fixture();
    const value = batch(state.task); mutate(value);
    let existingReads = 0;
    dependencies.readCollectorRun = async () => { existingReads += 1; return null; };
    await assert.rejects(importAssistedCollectorBatch(value, { dependencies, now }));
    assert.deepEqual(state.writes, []);
    assert.equal(existingReads, 0);
  }
});

test("v2 import retains evidence and reports blocked and not-scanned sources honestly", async () => {
  const { state, dependencies } = fixture();
  const value = batch(state.task);
  const { run } = await importAssistedCollectorBatch(value, { dependencies, now });
  assert.equal(run.schemaVersion, 2);
  assert.equal(run.discoveryTaskId, value.discoveryTaskId);
  assert.deepEqual(run.sourceChecks, value.sourceChecks);
  assert.deepEqual(run.observations, value.observations);
  assert.deepEqual(run.discoverySummary, { scanned: 2, verified: 1, blocked: 1, unverified: 0, noRecent: 0, notScanned: 1, complete: false });
  assert.deepEqual(state.signals[0].evidence, value.observations[0].evidence);
  const blocked = state.health.find((entry) => entry.creatorId === "second");
  assert.equal(blocked.discoveryStatus, "blocked");
  assert.notEqual(blocked.status, "success");
  assert.equal(Object.hasOwn(blocked, "lastSuccessAt"), false);
  assert.equal(run.summary.assistedSuccess, 1);
});

test("zero-observation blocked scans can be saved without marking discovery complete", async () => {
  const { state, dependencies } = fixture();
  const value = batch(state.task);
  value.observations = [];
  value.sourceChecks = [{ ...value.sourceChecks[1] }];
  const { run } = await importAssistedCollectorBatch(value, { dependencies, now });
  assert.equal(run.summary.assistedSuccess, 0);
  assert.equal(run.discoverySummary.scanned, 1);
  assert.equal(run.discoverySummary.blocked, 1);
  assert.equal(run.discoverySummary.complete, false);
  assert.equal(state.health.every((entry) => !Object.hasOwn(entry, "lastSuccessAt")), true);
});

test("no-recent-items and unverified checks remain distinct from verified observations", async () => {
  const { state, dependencies } = fixture();
  const value = batch(state.task);
  value.observations = [];
  value.sourceChecks = sources.creators.filter((source) => source.enabled).map((source, index) => ({
    creatorId: source.id, status: index === 0 ? "unverified" : "no_recent_items", checkedAt: now.toISOString(), url: source.profileUrl
  }));
  const { run } = await importAssistedCollectorBatch(value, { dependencies, now });
  assert.equal(run.discoverySummary.noRecent, 2);
  assert.equal(run.discoverySummary.unverified, 1);
  assert.equal(run.discoverySummary.notScanned, 0);
  assert.equal(run.discoverySummary.complete, false);
  assert.equal(run.summary.assistedSuccess, 0);
  assert.equal(state.health.every((entry) => entry.status !== "success"), true);
});

test("replaying an existing batch is rejected before upsert, health or run writes", async () => {
  const { state, dependencies } = fixture();
  state.existingRun = { id: "discovery-agent-fixture" };
  await assert.rejects(importAssistedCollectorBatch(batch(state.task), { dependencies, now }), (error) => error.code === "collector_batch_already_imported");
  assert.deepEqual(state.writes, []);
});

test("v2 test seam requires current-task and historical-run readers plus an isolated claim writer", async () => {
  for (const reader of ["readCollectorAssistTask", "readCollectorRun", "claimCollectorBatch"]) {
    const { state, dependencies } = fixture();
    delete dependencies[reader];
    await assert.rejects(importAssistedCollectorBatch(batch(state.task), { dependencies, now }), (error) => error.code === "side_effect_capability_missing");
    assert.deepEqual(state.writes, []);
  }
});

test("public discovery grant requires explicit legacy import and preserves its v1 provenance", async () => {
  const { state, dependencies } = fixture();
  const value = batch(state.task);
  value.schemaVersion = 1;
  const spec = {
    episodeId: "public-discovery/legacy-fixture", operation: "collector:import-assisted-batch",
    scopes: ["state.write", "filesystem.write"], maxCalls: 0, maxCostUsd: 0
  };
  const sideEffectGrant = createCapabilityAuthority({ secret: "synthetic-discovery-fixture-secret-".repeat(2) }).authorize(spec);
  const options = { dependencies, now, episodeId: spec.episodeId, sideEffectGrant, requireSideEffectCapability: true };
  await assert.rejects(importAssistedCollectorBatch(value, options), (error) => error.code === "collector_legacy_confirmation_required");
  assert.deepEqual(state.writes, []);
  const { run } = await importAssistedCollectorBatch(value, { ...options, legacyImport: true });
  assert.equal(run.legacy, true);
  assert.equal(state.signals[0].collector.discoveryVersion, 1);
  assert.equal(Object.hasOwn(run, "discoverySummary"), false);
});

test("the combined workflow can disable nested Radar refresh despite an enabled default", async () => {
  const { state, dependencies } = fixture();
  const readConfig = dependencies.readCollectorConfig;
  dependencies.readCollectorConfig = async () => ({ ...await readConfig(), refreshRadarAfterCollection: true });
  const { run } = await importAssistedCollectorBatch(batch(state.task), { dependencies, now, refreshRadar: false });
  assert.equal(run.radarRefresh.status, "skipped");
  assert.equal(state.signals[0].collector.discoveryVersion, 2);
});

test("concurrent conflicting batches allow only the durable claim winner to reach signal writes", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "collector-claim-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { state, dependencies } = fixture();
  const first = batch(state.task);
  const second = structuredClone(first);
  second.observations[0].sourceUrl = "https://www.douyin.com/video/999";
  second.observations[0].evidence.url = second.observations[0].sourceUrl;
  dependencies.claimCollectorBatch = (value) => collectorStore.claimCollectorBatch(value, { collectorRoot: root });
  const results = await Promise.allSettled([first, second].map((value) => importAssistedCollectorBatch(value, { dependencies, now })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "collector_batch_already_claimed");
  assert.equal(state.writes.filter((write) => write === "signals").length, 1);
  assert.equal(state.writes.filter((write) => write === "health").length, 1);
  const claim = JSON.parse(await readFile(resolve(root, "claims", `${first.batchId}.json`), "utf8"));
  assert.match(claim.batchSha256, /^[a-f0-9]{64}$/u);
  assert.equal(state.signals[0].sourceUrl, claim.batch.observations[0].sourceUrl);
});

test("a failed import retains its claim and blocks automatic replay before more signal writes", async () => {
  const { state, dependencies } = fixture();
  const value = batch(state.task);
  let writes = 0;
  dependencies.upsertTrendSignals = async () => { writes += 1; throw new Error("synthetic store failure"); };
  await assert.rejects(importAssistedCollectorBatch(value, { dependencies, now }), /synthetic store failure/u);
  assert.deepEqual(state.claims.get(value.batchId), value);
  await assert.rejects(importAssistedCollectorBatch(value, { dependencies, now }), (error) => error.code === "collector_batch_already_claimed");
  assert.equal(writes, 1);
  assert.equal(state.run, null);
});

test("separate processes cannot claim the same batch id twice", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "collector-cross-process-claim-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { state } = fixture();
  const value = batch(state.task);
  const script = `
    const { claimCollectorBatch } = await import(process.argv[3]);
    try {
      await claimCollectorBatch(JSON.parse(process.argv[2]), { collectorRoot: process.argv[1] });
      process.stdout.write("claimed");
    } catch (error) {
      process.stdout.write(error.code);
      process.exitCode = 1;
    }
  `;
  const attempt = () => new Promise((resolveAttempt, reject) => {
    const child = spawn(process.execPath, [
      "--input-type=module", "--eval", script, root, JSON.stringify(value),
      new URL("../src/server/collector/store.mjs", import.meta.url).href
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolveAttempt({ code, stdout, stderr }));
  });
  const results = await Promise.all([attempt(), attempt()]);
  assert.deepEqual(results.map((result) => result.code).sort(), [0, 1]);
  assert.deepEqual(results.map((result) => result.stdout).sort(), ["claimed", "collector_batch_already_claimed"]);
  assert.equal(results.every((result) => result.stderr === ""), true);
});

test("specified historical collector run reads validate ids and reject symlink escapes", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "collector-history-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const collectorRoot = resolve(root, "collector");
  await mkdir(resolve(collectorRoot, "runs"), { recursive: true });
  await writeFile(resolve(collectorRoot, "runs", "existing.json"), JSON.stringify({ id: "existing" }));
  assert.deepEqual(await collectorStore.readCollectorRun("existing", { collectorRoot }), { id: "existing" });
  assert.equal(await collectorStore.readCollectorRun("missing", { collectorRoot }), null);
  await assert.rejects(collectorStore.readCollectorRun("../outside", { collectorRoot }));
  const outside = resolve(root, "outside.json");
  await writeFile(outside, JSON.stringify({ secret: "synthetic" }));
  await symlink(outside, resolve(collectorRoot, "runs", "linked.json"));
  await assert.rejects(collectorStore.readCollectorRun("linked", { collectorRoot }));
  assert.equal(JSON.parse(await readFile(outside, "utf8")).secret, "synthetic");
});
