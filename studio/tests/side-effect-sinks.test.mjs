import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createCapabilityAuthority } from
  "../src/server/security/side-effect-capability.mjs";
import { getAgent } from "../src/server/agents/registry.mjs";
import {
  importAssistedCollectorBatch,
  runCollectorAgent
} from "../src/server/collector/agent.mjs";
import {
  approveTrendCandidate,
  ensureDefaultTrendSignals,
  ingestTrendSignal,
  runTrendRadarAgent
} from "../src/server/trends/agent.mjs";
import {
  importResearchEvidenceBatch,
  runEpisodeResearchAgent
} from "../src/server/research/agent.mjs";
import { buildEpisodeFromTrendSelection } from
  "../src/server/research/episode.mjs";

const CAPABILITY_SECRET =
  "side-effect-sink-test-secret-20260824-at-least-thirty-two-bytes";

function trendDependencies(counters = {}) {
  const signalDocument = {
    schemaVersion: 1,
    updatedAt: "2026-08-24T08:00:00.000Z",
    importedSnapshots: [],
    signals: []
  };
  return {
    appendEvent: async () => {
      counters.events = (counters.events ?? 0) + 1;
    },
    importTrendSnapshot: async () => ({ imported: 0, total: 0 }),
    listEpisodes: async () => [],
    readConceptTaxonomy: async () => ({ schemaVersion: 1, concepts: [] }),
    readTrendRadarConfig: async () => ({}),
    readTrendSignals: async () => structuredClone(signalDocument),
    readTrendSources: async () => ({ schemaVersion: 1, creators: [] }),
    writeTrendRun: async () => {
      counters.writes = (counters.writes ?? 0) + 1;
      return resolve(process.cwd(), "tests/fixtures/in-memory-trend-run.json");
    }
  };
}

function collectorDependencies(counters = {}) {
  return {
    appendEvent: async () => {
      counters.events = (counters.events ?? 0) + 1;
    },
    collectPublicSource: async (source) => {
      counters.fetches = (counters.fetches ?? 0) + 1;
      return {
        creatorId: source.id,
        status: "success",
        httpStatus: 200,
        fetchedBytes: 2,
        observations: []
      };
    },
    readCollectorConfig: async () => ({
      maxConcurrency: 1,
      sourceFreshnessDays: 14,
      refreshRadarAfterCollection: false
    }),
    readCollectorSourceHealth: async () => ({ schemaVersion: 1, sources: [] }),
    readConceptTaxonomy: async () => ({ schemaVersion: 1, concepts: [] }),
    readTrendSignals: async () => ({ schemaVersion: 1, signals: [] }),
    readTrendSources: async () => ({
      schemaVersion: 1,
      creators: [{
        id: "fixture-creator",
        name: "Fixture Creator",
        platform: "fixture",
        profileUrl: "https://example.test/creator",
        enabled: true
      }]
    }),
    runTrendRadarAgent: async () => ({ run: { id: "not-used" } }),
    updateCollectorSourceHealth: async () => {
      counters.writes = (counters.writes ?? 0) + 1;
    },
    upsertTrendSignals: async () => ({ added: 0, updated: 0, unchanged: 0 }),
    writeCollectorAssistTask: async () => {
      counters.writes = (counters.writes ?? 0) + 1;
      return "/virtual/collector-assist.json";
    },
    writeCollectorRun: async () => {
      counters.writes = (counters.writes ?? 0) + 1;
      return "/virtual/collector-run.json";
    }
  };
}

function researchSelection() {
  return {
    schemaVersion: 1,
    selectedAt: "2026-08-24T08:00:00.000Z",
    runId: "fixture-trend-run",
    candidateId: "fixture-concept",
    episodeId: "fixture-research-episode",
    concept: "Fixture Concept",
    recommendedTitle: "Fixture research title",
    note: "synthetic test selection",
    productDecisions: [],
    primarySources: [{
      label: "Fixture specification",
      url: "https://example.test/specification"
    }],
    creatorEvidence: [],
    evidenceSignals: []
  };
}

function researchDependencies(counters = {}) {
  return {
    fileRecord: async (path) => ({
      path: `studio/tests/fixtures/${path.split("/").at(-1)}`,
      bytes: 2,
      sha256: "a".repeat(64)
    }),
    inspectPrimarySource: async (source) => {
      counters.fetches = (counters.fetches ?? 0) + 1;
      return {
        sourceId: source.id,
        access: {
          status: "accessible",
          checkedAt: "2026-08-24T08:00:00.000Z",
          httpStatus: 200,
          contentType: "text/html",
          bytes: 2,
          sha256: "b".repeat(64),
          title: "Fixture specification",
          reason: null
        }
      };
    },
    readLatestResearchPack: async () => null,
    readResearchConfig: async () => ({
      maxConcurrency: 1,
      minimumSources: 0,
      minimumPrimarySources: 0,
      minimumSupportedClaims: 0,
      minimumCrossSourceClaims: 0,
      allowedSourceTypes: ["official-doc", "standard"],
      requiredClaimCategories: []
    }),
    writeResearchAssistTask: async () => {
      counters.writes = (counters.writes ?? 0) + 1;
      return resolve(process.cwd(), "tests/fixtures/in-memory-research-assist.json");
    },
    writeResearchPack: async () => {
      counters.writes = (counters.writes ?? 0) + 1;
      return resolve(process.cwd(), "tests/fixtures/in-memory-research-pack.json");
    }
  };
}

test("真实 Trend、Collector、Research sink 缺少 Capability 时零 fetch、零 write", async () => {
  const counters = { fetches: 0, writes: 0, events: 0 };
  const missingCapability = (error) =>
    error?.code === "side_effect_capability_missing";

  await assert.rejects(
    runTrendRadarAgent({
      dependencies: {
        appendEvent: async () => { counters.events += 1; },
        writeTrendRun: async () => { counters.writes += 1; }
      }
    }),
    missingCapability
  );
  await assert.rejects(
    runCollectorAgent({
      fetchImpl: async () => {
        counters.fetches += 1;
        return new Response("ok");
      },
      dependencies: {
        appendEvent: async () => { counters.events += 1; },
        writeCollectorRun: async () => { counters.writes += 1; }
      }
    }),
    missingCapability
  );
  await assert.rejects(
    runEpisodeResearchAgent({ id: "fixture-research-episode" }, {
      fetchImpl: async () => {
        counters.fetches += 1;
        return new Response("ok");
      },
      dependencies: {
        writeResearchPack: async () => { counters.writes += 1; }
      }
    }),
    missingCapability
  );
  await assert.rejects(
    ensureDefaultTrendSignals({
      dependencies: {
        readTrendSignals: async () => ({ signals: [] }),
        importTrendSnapshot: async () => { counters.writes += 1; }
      }
    }),
    missingCapability
  );
  await assert.rejects(
    approveTrendCandidate("fixture-candidate", "", {
      dependencies: {
        selectTrendCandidate: async () => { counters.writes += 1; }
      }
    }),
    missingCapability
  );
  await assert.rejects(
    ingestTrendSignal({ id: "fixture-signal" }, {
      dependencies: {
        appendTrendSignal: async () => { counters.writes += 1; }
      }
    }),
    missingCapability
  );
  await assert.rejects(
    importAssistedCollectorBatch({}, {
      dependencies: {
        writeCollectorRun: async () => { counters.writes += 1; }
      }
    }),
    missingCapability
  );
  await assert.rejects(
    importResearchEvidenceBatch({ episodeId: "fixture-research-episode" }, {
      dependencies: {
        writeResearchEvidenceBatch: async () => { counters.writes += 1; }
      }
    }),
    missingCapability
  );

  assert.deepEqual(counters, { fetches: 0, writes: 0, events: 0 });
});

test("显式全内存依赖可在无 Capability 的单测中运行", async () => {
  const trendCounters = {};
  const trend = await runTrendRadarAgent({
    dependencies: trendDependencies(trendCounters),
    now: new Date("2026-08-24T08:00:00.000Z")
  });
  assert.equal(trend.run.summary.signalCount, 0);
  assert.equal(trendCounters.writes, 1);

  const collectorCounters = {};
  const collector = await runCollectorAgent({
    dependencies: collectorDependencies(collectorCounters),
    now: new Date("2026-08-24T08:00:00.000Z"),
    refreshRadar: false
  });
  assert.equal(collector.run.summary.directSuccess, 1);
  assert.equal(collectorCounters.fetches, 1);
  assert.equal(collectorCounters.writes, 3);

  const researchCounters = {};
  const episode = buildEpisodeFromTrendSelection(
    researchSelection(),
    new Date("2026-08-24T08:00:00.000Z")
  );
  const research = await runEpisodeResearchAgent(episode, {
    dependencies: researchDependencies(researchCounters),
    now: new Date("2026-08-24T08:00:00.000Z")
  });
  assert.equal(research.pack.episodeId, episode.id);
  assert.equal(researchCounters.fetches, 1);
  assert.equal(researchCounters.writes, 2);
});

test("全内存 test seam 在显式 requireSideEffectCapability 时仍然 fail closed", async () => {
  const trendCounters = {};
  await assert.rejects(
    runTrendRadarAgent({
      dependencies: trendDependencies(trendCounters),
      requireSideEffectCapability: true,
      now: new Date("2026-08-24T08:00:00.000Z")
    }),
    (error) => error.code === "side_effect_capability_missing"
  );
  assert.deepEqual(trendCounters, {});

  const collectorCounters = {};
  await assert.rejects(
    runCollectorAgent({
      dependencies: collectorDependencies(collectorCounters),
      requireSideEffectCapability: true,
      now: new Date("2026-08-24T08:00:00.000Z")
    }),
    (error) => error.code === "side_effect_capability_missing"
  );
  assert.deepEqual(collectorCounters, {});

  const researchCounters = {};
  const episode = buildEpisodeFromTrendSelection(
    researchSelection(),
    new Date("2026-08-24T08:00:00.000Z")
  );
  await assert.rejects(
    runEpisodeResearchAgent(episode, {
      dependencies: researchDependencies(researchCounters),
      requireSideEffectCapability: true,
      now: new Date("2026-08-24T08:00:00.000Z")
    }),
    (error) => error.code === "side_effect_capability_missing"
  );
  assert.deepEqual(researchCounters, {});
});

test("Collector 只为联网 run 请求 network scope，assisted import 不请求", async () => {
  const authority = createCapabilityAuthority({
    secret: CAPABILITY_SECRET,
    maximumCalls: 0,
    maximumCostUsd: 0
  });
  const specs = [];
  const authorizeSideEffect = (spec) => {
    specs.push(structuredClone(spec));
    return authority.authorize(spec);
  };
  await runCollectorAgent({
    dependencies: collectorDependencies({}),
    requireSideEffectCapability: true,
    authorizeSideEffect,
    refreshRadar: false,
    now: new Date("2026-08-24T08:00:00.000Z")
  });
  await importAssistedCollectorBatch({
    schemaVersion: 1,
    batchId: "fixture-assisted-import",
    observedAt: "2026-08-24T08:00:00.000Z",
    method: "synthetic test fixture",
    observations: []
  }, {
    dependencies: collectorDependencies({}),
    requireSideEffectCapability: true,
    authorizeSideEffect,
    refreshRadar: false,
    now: new Date("2026-08-24T08:00:00.000Z")
  });
  assert.deepEqual(specs.map((spec) => ({
    operation: spec.operation,
    scopes: spec.scopes
  })), [{
    operation: "collector:run",
    scopes: ["state.write", "filesystem.write", "network.request"]
  }, {
    operation: "collector:import-assisted-batch",
    scopes: ["state.write", "filesystem.write"]
  }]);
});

test("Collector 刷新 Trend 只复用入口 grant，不下传 authority", async () => {
  const authority = createCapabilityAuthority({
    secret: CAPABILITY_SECRET,
    maximumCalls: 0,
    maximumCostUsd: 0
  });
  let issuedGrant = null;
  let nestedOptions = null;
  const dependencies = collectorDependencies({});
  dependencies.readCollectorConfig = async () => ({
    maxConcurrency: 1,
    lookbackDays: 30,
    sourceFreshnessDays: 14,
    refreshRadarAfterCollection: true
  });
  dependencies.readConceptTaxonomy = async () => ({
    schemaVersion: 1,
    concepts: [{ id: "fixture-concept", name: "Fixture Concept", aliases: [] }]
  });
  dependencies.collectPublicSource = async (source) => ({
    creatorId: source.id,
    status: "success",
    observations: [{
      creatorId: source.id,
      title: "Fixture accepted observation",
      sourceUrl: "https://example.test/observation",
      publishedAt: "2026-08-23T08:00:00.000Z",
      conceptIds: ["fixture-concept"]
    }]
  });
  dependencies.runTrendRadarAgent = async (options) => {
    nestedOptions = options;
    return { run: { id: "fixture-nested-trend-run" } };
  };
  const result = await runCollectorAgent({
    dependencies,
    requireSideEffectCapability: true,
    authorizeSideEffect(spec) {
      issuedGrant = authority.authorize(spec);
      return issuedGrant;
    },
    now: new Date("2026-08-24T08:00:00.000Z")
  });
  assert.equal(result.run.radarRefresh.status, "complete");
  assert.equal(nestedOptions.sideEffectGrant, issuedGrant);
  assert.equal(Object.hasOwn(nestedOptions, "authorizeSideEffect"), false);
  assert.equal(nestedOptions.requireSideEffectCapability, true);
  assert.equal(nestedOptions.capabilityOperation, "collector:run");
});

test("Registry 将 Worker 的 server-issued Capability 下传到 Trend 与 Research sink", async () => {
  const episode = {
    id: "fixture-trend-episode",
    trendSelection: null
  };
  const authority = createCapabilityAuthority({
    secret: CAPABILITY_SECRET,
    maximumCalls: 0,
    maximumCostUsd: 0
  });
  const grant = authority.authorize({
    episodeId: episode.id,
    operation: "worker:trend-agent",
    scopes: ["state.write", "filesystem.write"],
    maxCalls: 0,
    maxCostUsd: 0
  });
  const counters = {};
  const output = await getAgent("trend-agent").run(episode, {
    sideEffectGrant: grant,
    sideEffectDependencies: trendDependencies(counters),
    now: new Date("2026-08-24T08:00:00.000Z")
  });
  assert.equal(output.status, "blocked");
  assert.equal(counters.writes, 1);

  const researchEpisode = buildEpisodeFromTrendSelection(
    researchSelection(),
    new Date("2026-08-24T08:00:00.000Z")
  );
  const researchGrant = authority.authorize({
    episodeId: researchEpisode.id,
    operation: "worker:research-agent",
    scopes: ["state.write", "filesystem.write", "network.request"],
    maxCalls: 0,
    maxCostUsd: 0
  });
  const researchCounters = {};
  const researchOutput = await getAgent("research-agent").run(researchEpisode, {
    sideEffectGrant: researchGrant,
    sideEffectDependencies: researchDependencies(researchCounters),
    now: new Date("2026-08-24T08:00:00.000Z")
  });
  assert.equal(researchOutput.status, "waiting_approval");
  assert.equal(researchCounters.fetches, 1);
  assert.equal(researchCounters.writes, 2);
});
