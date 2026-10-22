import test from "node:test";
import assert from "node:assert/strict";
import { loadPublicDiscoveryAuthorization } from "../scripts/lib/public-discovery-authority.mjs";
import {
  createCapabilityAuthority,
  requireSideEffectGrant
} from "../src/server/security/side-effect-capability.mjs";
import {
  approveTrendCandidate,
  ensureDefaultTrendSignals,
  ingestTrendSignal,
  runTrendRadarAgent
} from "../src/server/trends/agent.mjs";
import { importAssistedCollectorBatch } from "../src/server/collector/agent.mjs";
import { runEpisodeResearchAgent } from "../src/server/research/agent.mjs";

const environment = {
  AI_CONCEPT_STUDIO_OPERATOR_ACTOR: "human:discovery-boundary-fixture",
  AI_CONCEPT_STUDIO_OPERATOR_TOKEN: "synthetic-boundary-operator-token-not-real-0000",
  AI_CONCEPT_STUDIO_CAPABILITY_SECRET: "synthetic-boundary-capability-secret-not-real-0000"
};
const discoveryOperations = ["collector:run", "collector:import-assisted-batch", "trend:run"];
const hasCode = (code) => (error) => error?.code === code;

function memoryTrendDependencies() {
  const effects = [];
  const signalDocument = { schemaVersion: 1, importedSnapshots: [], signals: [] };
  return {
    effects,
    dependencies: {
      appendEvent: async () => { effects.push("event"); },
      importTrendSnapshot: async () => {
        effects.push("historical-import");
        return { imported: 1, total: 1 };
      },
      listEpisodes: async () => [],
      readConceptTaxonomy: async () => ({ concepts: [] }),
      readTrendRadarConfig: async () => ({}),
      readTrendSignals: async () => structuredClone(signalDocument),
      readTrendSources: async () => ({ creators: [] }),
      writeTrendRun: async () => { effects.push("radar-write"); return "/virtual/run.json"; },
      selectTrendCandidate: async () => {
        effects.push("selected-candidate");
        return { selection: { concept: "Synthetic Concept" } };
      },
      createEpisodeFromTrendSelection: async () => {
        effects.push("created-episode");
        return { id: "synthetic-episode" };
      },
      appendTrendSignal: async () => {
        effects.push("unvalidated-signal");
        return structuredClone(signalDocument);
      }
    }
  };
}

function specFor(options) {
  const grant = options.sideEffectGrant;
  return {
    episodeId: grant.episodeId,
    operation: grant.operation,
    scopes: [...grant.scopes],
    maxCalls: 0,
    maxCostUsd: 0
  };
}

for (const operation of discoveryOperations) {
  test(`${operation} grant cannot select a topic, create an episode, ingest raw signals or import history`, async () => {
    const authorization = await loadPublicDiscoveryAuthorization({ environment });
    const fixture = memoryTrendDependencies();
    const options = {
      ...authorization.forOperation(operation),
      dependencies: fixture.dependencies
    };
    assert.equal(options.requireSideEffectCapability, true);
    for (const invoke of [
      () => approveTrendCandidate("synthetic-concept", "", options),
      () => ingestTrendSignal({ id: "synthetic-signal" }, options),
      () => ensureDefaultTrendSignals(options)
    ]) {
      await assert.rejects(invoke(), hasCode("public_discovery_sink_forbidden"));
    }
    assert.deepEqual(fixture.effects, []);
  });

  test(`${operation} grant can reach the real Radar sink through its permitted delegation`, async () => {
    const authorization = await loadPublicDiscoveryAuthorization({ environment });
    const fixture = memoryTrendDependencies();
    const result = await runTrendRadarAgent({
      ...authorization.forOperation(operation),
      dependencies: fixture.dependencies,
      now: new Date("2026-09-09T04:00:00.000Z")
    });
    assert.deepEqual(result.run.candidates, []);
    assert.deepEqual(fixture.effects, ["event", "radar-write", "event"]);
  });
}

test("collector run grant cannot delegate to assisted import even though the write scopes overlap", async () => {
  const authorization = await loadPublicDiscoveryAuthorization({ environment });
  const effects = [];
  await assert.rejects(importAssistedCollectorBatch({}, {
    ...authorization.forOperation("collector:run"),
    dependencies: { readCollectorConfig: async () => { effects.push("read"); } }
  }), hasCode("public_discovery_sink_forbidden"));
  assert.deepEqual(effects, []);
});

test("discovery subjects require an explicit allowlisted sink constant, never an options override", async () => {
  const authorization = await loadPublicDiscoveryAuthorization({ environment });
  const options = authorization.forOperation("collector:run");
  const spec = specFor(options);
  for (const override of [options, { ...options, sinkOperation: "collector:run", episodeId: "studio" }]) {
    assert.throws(() => requireSideEffectGrant(override, spec), hasCode("public_discovery_sink_forbidden"));
  }
  for (const sink of ["trend:approve-candidate", "research:run", "paid.invoke", "unknown", "toString"]) {
    assert.throws(() => requireSideEffectGrant(options, spec, sink), hasCode("public_discovery_sink_forbidden"));
  }
  assert.equal(requireSideEffectGrant(options, spec, "collector:run"), options.sideEffectGrant);
  const forged = { ...options.sideEffectGrant, episodeId: "studio" };
  assert.throws(() => requireSideEffectGrant({ sideEffectGrant: forged }, { ...spec, episodeId: "studio" }, "collector:run"), hasCode("side_effect_capability_missing"));
});

test("authority callbacks cannot avoid the discovery sink restriction", async () => {
  const authorization = await loadPublicDiscoveryAuthorization({ environment });
  const options = authorization.forOperation("trend:run");
  const callbackOptions = { authorizeSideEffect: () => options.sideEffectGrant };
  const spec = specFor(options);
  assert.throws(() => requireSideEffectGrant(callbackOptions, spec), hasCode("public_discovery_sink_forbidden"));
  assert.equal(requireSideEffectGrant(callbackOptions, spec, "trend:run"), options.sideEffectGrant);
});

test("discovery grants cannot authorize an existing production episode or paid scopes", async () => {
  const authorization = await loadPublicDiscoveryAuthorization({ environment });
  const options = authorization.forOperation("collector:run");
  await assert.rejects(runEpisodeResearchAgent({ id: "production-fixture-episode" }, options), hasCode("side_effect_capability_episode_mismatch"));
  assert.throws(() => requireSideEffectGrant(options, {
    ...specFor(options), scopes: ["network.request", "paid.invoke"], maxCalls: 1
  }, "collector:run"), hasCode("side_effect_capability_scope_mismatch"));
});

test("ordinary operator grants retain the real topic approval sink contract", async () => {
  const authority = createCapabilityAuthority({ secret: environment.AI_CONCEPT_STUDIO_CAPABILITY_SECRET });
  const fixture = memoryTrendDependencies();
  const sideEffectGrant = authority.authorize({
    episodeId: "studio", operation: "trend:approve-candidate",
    scopes: ["state.write", "filesystem.write"], maxCalls: 0, maxCostUsd: 0
  });
  await approveTrendCandidate("synthetic-concept", "", {
    actor: environment.AI_CONCEPT_STUDIO_OPERATOR_ACTOR,
    sideEffectGrant,
    requireSideEffectCapability: true,
    dependencies: fixture.dependencies
  });
  assert.deepEqual(fixture.effects, ["selected-candidate", "created-episode", "event"]);
});
