import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, link, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCollectorCli } from "../scripts/run-collector.mjs";
import { runTrendRadarCli } from "../scripts/run-trend-radar.mjs";
import { runImportCollectorBatchCli } from "../scripts/import-collector-batch.mjs";
import {
  loadPublicDiscoveryAuthorization,
  setupPublicDiscoveryIdentity
} from "../scripts/lib/public-discovery-authority.mjs";
import { parsePublicDiscoveryArguments, readPublicDiscoveryBatch } from "../scripts/lib/public-discovery-cli.mjs";
import { assertSideEffectGrant, consumeSideEffectGrantUsage } from "../src/server/security/side-effect-capability.mjs";
import { runCollectorAgent } from "../src/server/collector/agent.mjs";
import { runTrendRadarAgent } from "../src/server/trends/agent.mjs";

const studioRoot = fileURLToPath(new URL("../", import.meta.url));
const operatorEnvironment = Object.freeze({
  AI_CONCEPT_STUDIO_OPERATOR_ACTOR: "human:fixture-operator",
  AI_CONCEPT_STUDIO_OPERATOR_TOKEN: "synthetic-operator-fixture-token-".repeat(2),
  AI_CONCEPT_STUDIO_CAPABILITY_SECRET: "synthetic-capability-fixture-key-".repeat(2)
});

const hasCode = (code) => (error) => error.code === code;

async function temporaryDirectory(t) {
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), "public-discovery-cli-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function cli(script, args = [], environment = {}) {
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !name.startsWith("AI_CONCEPT_STUDIO_")));
  return spawnSync(process.execPath, [resolve(studioRoot, "scripts", script), ...args], {
    cwd: studioRoot,
    env: { ...env, ...environment },
    encoding: "utf8"
  });
}

test("CLI without operator identity fails before running a side effect", async (t) => {
  const root = await temporaryDirectory(t);
  for (const script of ["run-collector.mjs", "run-trend-radar.mjs"]) {
    const result = cli(script, ["--identity", resolve(root, "missing", "identity.json")]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /public_discovery_identity_missing/u);
    assert.doesNotMatch(result.stderr, /side_effect_capability_missing/u);
  }
});

test("assisted import rejects unknown flags before opening a batch", () => {
  const result = cli("import-collector-batch.mjs", ["--unknown"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /public_discovery_arguments_invalid/u);
  assert.doesNotMatch(result.stderr, /ENOENT|side_effect_capability_missing/u);
});

test("explicit setup creates one private local identity and never prints its secret", async (t) => {
  const root = await temporaryDirectory(t);
  const configPath = resolve(root, "private", "identity.json");
  const args = ["setup", "--actor", "human:Zhengjiazhi", "--confirm-public-discovery", "--identity", configPath];
  const result = cli("setup-public-discovery.mjs", args);
  assert.equal(result.status, 0, result.stderr);
  const document = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(document.actor, "human:Zhengjiazhi");
  assert.equal(document.purpose, "public-topic-discovery");
  assert.match(document.capabilitySecret, /^[a-f0-9]{64}$/u);
  assert.equal((await lstat(configPath)).mode & 0o777, 0o600);
  assert.equal((await lstat(resolve(root, "private"))).mode & 0o777, 0o700);
  assert.equal(result.stdout.includes(document.capabilitySecret), false);
  assert.equal(result.stderr.includes(document.capabilitySecret), false);
  const repeated = cli("setup-public-discovery.mjs", args);
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /public_discovery_identity_exists/u);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), document);
  const authorization = await loadPublicDiscoveryAuthorization({ environment: {}, configPath });
  assert.equal(authorization.actor, "human:Zhengjiazhi");
  assert.equal(authorization.source, "local-public-discovery");
});

test("setup requires an explicit human actor and confirmation without writing an identity", async (t) => {
  const root = await temporaryDirectory(t);
  const configPath = resolve(root, "private", "identity.json");
  await assert.rejects(setupPublicDiscoveryIdentity({ actor: "human:fixture", configPath }), hasCode("public_discovery_confirmation_required"));
  await assert.rejects(setupPublicDiscoveryIdentity({ actor: "agent:fixture", confirmPublicDiscovery: true, configPath }), hasCode("operator_auth_forbidden"));
  await assert.rejects(lstat(resolve(root, "private")), hasCode("ENOENT"));
});

test("concurrent initialization has one winner and never overwrites an identity", async (t) => {
  const root = await temporaryDirectory(t);
  const configPath = resolve(root, "private", "identity.json");
  const results = await Promise.allSettled(["human:first", "human:second"].map((actor) =>
    setupPublicDiscoveryIdentity({ actor, confirmPublicDiscovery: true, configPath })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "public_discovery_identity_exists");
  const document = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(document.actor, results.find((result) => result.status === "fulfilled").value.actor);
  assert.equal((await lstat(configPath)).uid, process.getuid());
});

test("identity loading refuses unsafe modes, symlink ancestors, symlink files and hard links", async (t) => {
  const root = await temporaryDirectory(t);
  const directory = resolve(root, "private");
  const configPath = resolve(directory, "identity.json");
  await setupPublicDiscoveryIdentity({ actor: "human:fixture", confirmPublicDiscovery: true, configPath });
  await chmod(configPath, 0o644);
  await assert.rejects(loadPublicDiscoveryAuthorization({ environment: {}, configPath }), hasCode("public_discovery_identity_unsafe"));
  await chmod(configPath, 0o600);
  await chmod(directory, 0o755);
  await assert.rejects(loadPublicDiscoveryAuthorization({ environment: {}, configPath }), hasCode("public_discovery_identity_unsafe"));
  await chmod(directory, 0o700);
  const alias = resolve(root, "alias");
  await symlink(directory, alias);
  await assert.rejects(loadPublicDiscoveryAuthorization({ environment: {}, configPath: resolve(alias, "identity.json") }), hasCode("public_discovery_identity_unsafe"));
  await assert.rejects(setupPublicDiscoveryIdentity({ actor: "human:fixture", confirmPublicDiscovery: true, configPath: resolve(alias, "other.json") }), hasCode("public_discovery_identity_unsafe"));
  await symlink(configPath, resolve(directory, "linked.json"));
  await assert.rejects(loadPublicDiscoveryAuthorization({ environment: {}, configPath: resolve(directory, "linked.json") }), hasCode("public_discovery_identity_unsafe"));
  await link(configPath, resolve(directory, "hard-linked.json"));
  await assert.rejects(loadPublicDiscoveryAuthorization({ environment: {}, configPath }), hasCode("public_discovery_identity_unsafe"));
});

test("complete operator environment takes precedence; partial or paid configuration fails closed", async (t) => {
  const root = await temporaryDirectory(t);
  const configPath = resolve(root, "missing", "identity.json");
  const context = await loadPublicDiscoveryAuthorization({ environment: operatorEnvironment, configPath });
  assert.equal(context.actor, operatorEnvironment.AI_CONCEPT_STUDIO_OPERATOR_ACTOR);
  assert.equal(context.source, "operator-environment");
  await assert.rejects(loadPublicDiscoveryAuthorization({
    environment: { AI_CONCEPT_STUDIO_OPERATOR_ACTOR: "human:fixture" }, configPath
  }), hasCode("operator_security_config_incomplete"));
  for (const budget of [
    { AI_CONCEPT_STUDIO_CAPABILITY_MAX_CALLS: "1" },
    { AI_CONCEPT_STUDIO_CAPABILITY_MAX_COST_USD: "0.01" }
  ]) {
    await assert.rejects(loadPublicDiscoveryAuthorization({ environment: { ...operatorEnvironment, ...budget }, configPath }), hasCode("public_discovery_paid_budget_forbidden"));
  }
});

test("local identity rejects invalid content and a nonzero paid budget without exposing it", async (t) => {
  const root = await temporaryDirectory(t);
  const configPath = resolve(root, "private", "identity.json");
  await setupPublicDiscoveryIdentity({ actor: "human:fixture", confirmPublicDiscovery: true, configPath });
  const document = JSON.parse(await readFile(configPath, "utf8"));
  await writeFile(configPath, JSON.stringify({ ...document, maxCalls: 1 }));
  await assert.rejects(loadPublicDiscoveryAuthorization({ environment: {}, configPath }), hasCode("public_discovery_paid_budget_forbidden"));
  await writeFile(configPath, `{\"secret\":\"${document.capabilitySecret}\",`);
  const result = cli("run-collector.mjs", ["--identity", configPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /public_discovery_identity_invalid/u);
  assert.equal(result.stderr.includes(document.capabilitySecret), false);
});

test("allowlisted grants bind actor, exact operation and zero budget without exposing authority", async () => {
  const authorization = await loadPublicDiscoveryAuthorization({ environment: operatorEnvironment });
  const options = authorization.forOperation("collector:run");
  assert.equal(options.actor, operatorEnvironment.AI_CONCEPT_STUDIO_OPERATOR_ACTOR);
  assert.equal(options.requireSideEffectCapability, true);
  assert.equal(options.sideEffectGrant.episodeId, options.episodeId);
  assert.match(options.episodeId, /^public-discovery\/[a-f0-9]{32}$/u);
  assert.equal(Object.hasOwn(options, "authorizeSideEffect"), false);
  assert.equal(Object.hasOwn(authorization, "authority"), false);
  assert.equal(Object.isFrozen(options), true);
  const spec = {
    episodeId: options.episodeId, operation: "collector:run",
    scopes: ["state.write", "filesystem.write", "network.request"], maxCalls: 0, maxCostUsd: 0
  };
  assert.equal(assertSideEffectGrant(options.sideEffectGrant, spec), options.sideEffectGrant);
  assert.throws(() => assertSideEffectGrant(options.sideEffectGrant, { ...spec, operation: "trend:approve-candidate" }), hasCode("side_effect_capability_operation_mismatch"));
  assert.throws(() => assertSideEffectGrant(options.sideEffectGrant, { ...spec, scopes: ["paid.invoke"] }), hasCode("side_effect_capability_scope_mismatch"));
  assert.throws(() => consumeSideEffectGrantUsage(options.sideEffectGrant, spec, { calls: 1, costUsd: 0 }), hasCode("side_effect_capability_calls_exceeded"));
  assert.throws(() => consumeSideEffectGrantUsage(options.sideEffectGrant, spec, { calls: 0, costUsd: 0.01 }), hasCode("side_effect_capability_cost_exceeded"));
  for (const operation of ["trend:approve-candidate", "research:run", "toString", "paid.invoke"]) {
    assert.throws(() => authorization.forOperation(operation), hasCode("public_discovery_operation_forbidden"));
  }
  assert.throws(() => authorization.forOperation("collector:run", { maxCalls: 1 }), hasCode("public_discovery_operation_forbidden"));
  const other = await loadPublicDiscoveryAuthorization({ environment: { ...operatorEnvironment, AI_CONCEPT_STUDIO_OPERATOR_ACTOR: "human:other" } });
  assert.notEqual(other.forOperation("collector:run").episodeId, options.episodeId);
  assert.equal(assertSideEffectGrant(options.sideEffectGrant, { ...spec, scopes: ["state.write", "filesystem.write"] }), options.sideEffectGrant);
});

test("argument parsing rejects duplicates, unknown flags, missing input and paths outside the inbox", () => {
  for (const args of [[], ["--"], ["--unknown"], ["a.json", "b.json"], ["../a.json"], ["/tmp/a.json"], ["a.json", "--identity"], ["a.json", "--legacy-import", "--legacy-import"]]) {
    assert.throws(() => parsePublicDiscoveryArguments(args, { batch: true }), hasCode("public_discovery_arguments_invalid"));
  }
  assert.deepEqual(parsePublicDiscoveryArguments(["--", "a.json", "--legacy-import"], { batch: true }), { batchName: "a.json", legacyImport: true });
});

test("expired grants fail closed and subsequent operations receive fresh grants", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const authorization = await loadPublicDiscoveryAuthorization({ environment: operatorEnvironment });
  const options = authorization.forOperation("trend:run");
  const spec = { episodeId: options.episodeId, operation: "trend:run", scopes: ["state.write"], maxCalls: 0, maxCostUsd: 0 };
  now += 5 * 60_000;
  assert.throws(() => assertSideEffectGrant(options.sideEffectGrant, spec), hasCode("side_effect_capability_expired"));
  const refreshed = authorization.forOperation("trend:run");
  assert.notEqual(refreshed.sideEffectGrant.nonce, options.sideEffectGrant.nonce);
  assert.equal(assertSideEffectGrant(refreshed.sideEffectGrant, spec), refreshed.sideEffectGrant);
});

test("batch reader requires v2 evidence or source checks, with explicit legacy compatibility", async (t) => {
  const inboxRoot = await temporaryDirectory(t);
  await assert.rejects(readPublicDiscoveryBatch("missing.json", { inboxRoot }), hasCode("public_discovery_batch_missing"));
  await writeFile(resolve(inboxRoot, "legacy.json"), JSON.stringify({ schemaVersion: 1, observations: [] }));
  await assert.rejects(readPublicDiscoveryBatch("legacy.json", { inboxRoot }), hasCode("public_discovery_batch_version"));
  assert.equal((await readPublicDiscoveryBatch("legacy.json", { inboxRoot, legacyImport: true })).schemaVersion, 1);
  await writeFile(resolve(inboxRoot, "empty.json"), JSON.stringify({ schemaVersion: 2, observations: [] }));
  await assert.rejects(readPublicDiscoveryBatch("empty.json", { inboxRoot }), hasCode("public_discovery_batch_empty"));
  await writeFile(resolve(inboxRoot, "checked.json"), JSON.stringify({ schemaVersion: 2, observations: [], sourceChecks: [{ creatorId: "fixture", status: "failed" }] }));
  assert.equal((await readPublicDiscoveryBatch("checked.json", { inboxRoot })).sourceChecks.length, 1);
  await writeFile(resolve(inboxRoot, "bad.json"), "{broken");
  await assert.rejects(readPublicDiscoveryBatch("bad.json", { inboxRoot }), hasCode("public_discovery_batch_invalid"));
  await symlink(resolve(inboxRoot, "checked.json"), resolve(inboxRoot, "linked.json"));
  await assert.rejects(readPublicDiscoveryBatch("linked.json", { inboxRoot }), hasCode("path_boundary_forbidden"));
  const otherRoot = await temporaryDirectory(t);
  await symlink(inboxRoot, resolve(otherRoot, "linked-inbox"));
  await assert.rejects(readPublicDiscoveryBatch("checked.json", { inboxRoot: resolve(otherRoot, "linked-inbox") }), hasCode("public_discovery_batch_unsafe"));
});

test("all three CLI entry functions deliver real grants and authenticated actor options", async (t) => {
  const inboxRoot = await temporaryDirectory(t);
  await writeFile(resolve(inboxRoot, "batch.json"), JSON.stringify({ schemaVersion: 2, observations: [{}] }));
  const calls = [];
  const inspect = (operation) => async (options) => {
    assert.equal(options.requireSideEffectCapability, true);
    assert.equal(options.actor, operatorEnvironment.AI_CONCEPT_STUDIO_OPERATOR_ACTOR);
    assertSideEffectGrant(options.sideEffectGrant, {
      episodeId: options.episodeId, operation, scopes: ["state.write", "filesystem.write"], maxCalls: 0, maxCostUsd: 0
    });
    calls.push(operation);
    return { run: { id: "fixture", summary: {}, sourceResults: [], candidates: [] } };
  };
  await runCollectorCli([], { environment: operatorEnvironment, runAgent: inspect("collector:run") });
  await runTrendRadarCli([], { environment: operatorEnvironment, runAgent: inspect("trend:run") });
  const imported = await runImportCollectorBatchCli(["batch.json"], {
    environment: operatorEnvironment, inboxRoot,
    importBatch: async (batch, options) => {
      assert.equal(batch.schemaVersion, 2);
      return inspect("collector:import-assisted-batch")(options);
    }
  });
  assert.equal(imported.legacy, false);
  assert.deepEqual(calls, ["collector:run", "trend:run", "collector:import-assisted-batch"]);
});

test("authorized CLI reaches real Collector and Radar sinks using only temporary synthetic storage", async (t) => {
  const root = await temporaryDirectory(t);
  const writes = [];
  const signals = { schemaVersion: 1, signals: [], importedSnapshots: [] };
  const dependencies = {
    appendEvent: async (event) => { writes.push(event.type); },
    collectPublicSource: async () => { throw new Error("No source should be fetched"); },
    readCollectorConfig: async () => ({ maxConcurrency: 1, sourceFreshnessDays: 14, lookbackDays: 14, refreshRadarAfterCollection: false }),
    readCollectorSourceHealth: async () => ({ schemaVersion: 1, sources: [] }),
    readConceptTaxonomy: async () => ({ schemaVersion: 1, concepts: [] }),
    readTrendSignals: async () => structuredClone(signals),
    readTrendSources: async () => ({ schemaVersion: 1, creators: [] }),
    runTrendRadarAgent: async () => { throw new Error("No refresh expected"); },
    updateCollectorSourceHealth: async () => {},
    upsertTrendSignals: async () => ({ added: 0, updated: 0, unchanged: 0 }),
    writeCollectorAssistTask: async () => {},
    writeCollectorRun: async (run) => {
      const path = resolve(root, "collector.json");
      await writeFile(path, JSON.stringify(run));
      return path;
    }
  };
  await assert.rejects(runCollectorAgent({ dependencies, requireSideEffectCapability: true }), hasCode("side_effect_capability_missing"));
  assert.equal(writes.length, 0);
  const collector = await runCollectorCli([], { environment: operatorEnvironment, runAgent: (options) => runCollectorAgent({ ...options, dependencies }) });
  assert.equal(JSON.parse(await readFile(resolve(root, "collector.json"), "utf8")).id, collector.runId);
  const trendDependencies = {
    appendEvent: dependencies.appendEvent,
    importTrendSnapshot: async () => ({ imported: 0, total: 0 }),
    listEpisodes: async () => [],
    readConceptTaxonomy: dependencies.readConceptTaxonomy,
    readTrendRadarConfig: async () => ({}),
    readTrendSignals: dependencies.readTrendSignals,
    readTrendSources: dependencies.readTrendSources,
    writeTrendRun: async (run) => {
      const path = resolve(root, "trend.json");
      await writeFile(path, JSON.stringify(run));
      return path;
    }
  };
  const radar = await runTrendRadarCli([], { environment: operatorEnvironment, runAgent: (options) => runTrendRadarAgent({ ...options, dependencies: trendDependencies }) });
  assert.equal(JSON.parse(await readFile(resolve(root, "trend.json"), "utf8")).id, radar.runId);
});
