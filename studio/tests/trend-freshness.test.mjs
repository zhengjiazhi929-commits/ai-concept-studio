import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureDefaultTrendSignals,
  runTrendRadarAgent
} from "../src/server/trends/agent.mjs";
import { discoverTrendCandidates } from "../src/server/trends/engine.mjs";

const NOW = new Date("2026-09-09T04:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIG = {
  windows: { fastDays: 7, primaryDays: 14, extendedDays: 30 },
  hardGates: {
    primaryCreatorCount: 3,
    extendedCreatorCount: 5,
    fastCreatorCount: 2,
    fastRelativePerformance: 1.8,
    maxEventShare: 0.5
  },
  scoreWeights: {
    creatorCoverage: 35,
    audienceFit: 20,
    relativePerformance: 20,
    velocity: 15,
    questionDensity: 10
  },
  thresholds: { formalCandidate: 70, continueWatching: 60 }
};
const SOURCES = {
  creators: Array.from({ length: 5 }, (_, index) => ({
    id: `creator-${index}`,
    name: `Fixture Creator ${index}`,
    platform: index % 2 ? "fixture-one" : "fixture-two",
    enabled: true,
    coverageGroup: `independent-${index}`,
    weight: 1,
    audienceFit: 1
  }))
};
const TAXONOMY = {
  concepts: [{
    id: "fixture-concept",
    name: "Fixture Concept",
    aliases: ["fixture concept"],
    recommendedTitle: "A fixture mechanism",
    brandIndependent: true,
    crossProductExamples: ["Fixture A", "Fixture B"],
    productDecisions: ["Fixture decision A", "Fixture decision B"],
    primarySources: [{ label: "Fixture spec", url: "https://example.test/spec" }]
  }]
};

function signal(index, ageDays = 1, extra = {}) {
  return {
    id: `fixture-signal-${index}`,
    creatorId: `creator-${index % 5}`,
    title: `Fixture concept mechanism ${index}`,
    sourceUrl: `https://example.test/works/${index}`,
    publishedAt: new Date(NOW.getTime() - ageDays * DAY_MS).toISOString(),
    observedAt: NOW.toISOString(),
    datePrecision: "page-date",
    angle: "mechanism",
    conceptIds: ["fixture-concept"],
    ...extra
  };
}

function discover(signals, extra = {}) {
  return discoverTrendCandidates({
    signals,
    sources: SOURCES,
    taxonomy: TAXONOMY,
    config: CONFIG,
    now: NOW,
    ...extra
  });
}

function memoryDependencies(signals = []) {
  const calls = { imports: [], writes: [], events: [] };
  const document = { schemaVersion: 1, importedSnapshots: [], signals };
  return {
    calls,
    document,
    dependencies: {
      appendEvent: async (event) => { calls.events.push(structuredClone(event)); },
      importTrendSnapshot: async (path) => {
        calls.imports.push(path);
        return { imported: 52, total: 52 };
      },
      listEpisodes: async () => [],
      readConceptTaxonomy: async () => structuredClone(TAXONOMY),
      readTrendRadarConfig: async () => structuredClone(CONFIG),
      readTrendSignals: async () => structuredClone(document),
      readTrendSources: async () => structuredClone(SOURCES),
      writeTrendRun: async (run) => {
        calls.writes.push(structuredClone(run));
        return "/virtual/trends/run.json";
      }
    }
  };
}

test("empty radar run publishes empty evidence without importing the historical seed", async () => {
  const fixture = memoryDependencies();
  const { run } = await runTrendRadarAgent({ dependencies: fixture.dependencies, now: NOW });
  assert.deepEqual(fixture.calls.imports, []);
  assert.deepEqual(fixture.document.signals, []);
  assert.deepEqual(run.candidates, []);
  assert.equal(run.summary.signalCount, 0);
  assert.deepEqual(run.summary.recentSignalCounts, { days7: 0, days14: 0, days30: 0 });
  assert.deepEqual(run.summary.freshness, {
    status: "empty", lastPublishedAt: null, windowDays: 30
  });
  assert.deepEqual(fixture.calls.writes, [run]);
});

test("historical seed remains available only through its explicit authorized entry", async () => {
  const fixture = memoryDependencies();
  const result = await ensureDefaultTrendSignals({ dependencies: fixture.dependencies });
  assert.equal(result.imported, 52);
  assert.equal(fixture.calls.imports.length, 1);
  assert.match(fixture.calls.imports[0], /2026-08-03-public-signal-snapshot\.json$/u);
  assert.deepEqual(fixture.calls.writes, []);
});

test("52 historical signals remain stored but produce no current candidates", async () => {
  const signals = Array.from({ length: 52 }, (_, index) => signal(index, 37 + index));
  const fixture = memoryDependencies(signals);
  const before = structuredClone(fixture.document);
  const { run } = await runTrendRadarAgent({ dependencies: fixture.dependencies, now: NOW });
  assert.equal(run.summary.signalCount, 52);
  assert.deepEqual(run.candidates, []);
  assert.equal(run.summary.formalCandidateCount, 0);
  assert.deepEqual(run.summary.recentSignalCounts, { days7: 0, days14: 0, days30: 0 });
  assert.deepEqual(run.summary.freshness, {
    status: "stale", lastPublishedAt: signals[0].publishedAt, windowDays: 30
  });
  assert.deepEqual(fixture.document, before);
  assert.deepEqual(fixture.calls.imports, []);
});

test("future, invalid and missing publication dates cannot become current evidence", () => {
  const result = discover([
    signal(0, -0.5),
    signal(1, -2),
    signal(2, 0, { publishedAt: undefined }),
    signal(3, 0, { publishedAt: "invalid-publication-date" })
  ]);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.summary.recentSignalCounts, { days7: 0, days14: 0, days30: 0 });
  assert.equal(result.summary.freshness.lastPublishedAt, null);
});

test("explicit legacy imports cannot be relabelled as current discovery evidence by their date", () => {
  const result = discover([signal(0, 1, {collector: {discoveryVersion: 1}})]);
  assert.equal(result.summary.signalCount, 1);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.summary.recentSignalCounts.days30, 0);
});

test("recent counts use publication time and exact inclusive 7, 14 and 30 day boundaries", () => {
  const result = discover([
    signal(0, 0), signal(1, 7), signal(2, 14), signal(3, 30), signal(4, 30.001),
    signal(5, 1, { creatorId: "unconfigured-creator" })
  ]);
  assert.deepEqual(result.summary.recentSignalCounts, { days7: 2, days14: 3, days30: 4 });
  assert.equal(result.summary.freshness.status, "fresh");
  assert.equal(result.summary.freshness.lastPublishedAt, NOW.toISOString());
  assert.equal(result.candidates[0].signalCount, 4);
});

test("fresh independent creator evidence can qualify without fabricated missing metrics", () => {
  const result = discover(Array.from({ length: 6 }, (_, index) => signal(index)));
  const candidate = result.candidates[0];
  assert.equal(candidate.recommendedPool, "formal_candidate");
  assert.equal(candidate.heatGate.creators14, 5);
  assert.equal(candidate.score.components.relativePerformance.available, false);
  assert.equal(candidate.score.components.questionDensity.available, false);
  assert.deepEqual(result.summary.recentSignalCounts, { days7: 6, days14: 6, days30: 6 });
  assert.equal(result.summary.freshness.status, "fresh");
});

test("old and future events do not change current candidates, confidence or event share", () => {
  const recent = Array.from({ length: 6 }, (_, index) => signal(index));
  const noise = Array.from({ length: 12 }, (_, index) => signal(10 + index, index % 2 ? 40 : -0.5, {
    angle: "news",
    datePrecision: "observation-window"
  }));
  const baseline = discover(recent);
  const combined = discover([...recent, ...noise]);
  assert.deepEqual(combined.candidates, baseline.candidates);
  assert.deepEqual(combined.summary.freshness, baseline.summary.freshness);
});

test("already covered remains a separate pool for fresh evidence only", () => {
  const result = discover(Array.from({ length: 6 }, (_, index) => signal(index)), {
    coveredConceptIds: ["fixture-concept"]
  });
  assert.equal(result.candidates[0].recommendedPool, "already_covered");
  assert.equal(result.candidates[0].productionState, "already_covered");
  assert.equal(result.summary.formalCandidateCount, 0);
  assert.equal(result.summary.alreadyCoveredCount, 1);
});

test("current candidate freshness honors the configured extended window", () => {
  const result = discover([signal(0, 20)], {
    config: { ...CONFIG, windows: { ...CONFIG.windows, extendedDays: 10 } }
  });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.summary.recentSignalCounts, { days7: 0, days14: 0, days30: 1 });
  assert.equal(result.summary.freshness.status, "stale");
  assert.equal(result.summary.freshness.windowDays, 10);
});
