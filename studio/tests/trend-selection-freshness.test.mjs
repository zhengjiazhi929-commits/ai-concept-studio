import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { discoverTrendCandidates } from "../src/server/trends/engine.mjs";
import {
  readConceptTaxonomy, readTrendRadarConfig, readTrendSources,
  selectTrendCandidate, writeTrendRun
} from "../src/server/trends/store.mjs";
import { withDurableJsonStoreLock } from "../src/shared/durable-json-store.mjs";
import { approveTrendCandidate } from "../src/server/trends/agent.mjs";
import { buildEpisodeFromTrendSelection } from "../src/server/research/episode.mjs";

const NOW = new Date("2026-08-03T15:00:00.000Z");
const EXPIRED = new Date("2026-10-14T04:00:00.000Z");

async function fixture(t) {
  const trendsRoot = await mkdtemp(resolve(tmpdir(), "acs-trend-selection-freshness-"));
  t.after(() => rm(trendsRoot, { recursive: true, force: true }));
  const [signals, sources, taxonomy, config] = await Promise.all([
    readFile(new URL("./fixtures/trends/signals.json", import.meta.url), "utf8").then(JSON.parse),
    readTrendSources(), readConceptTaxonomy(), readTrendRadarConfig()
  ]);
  const result = discoverTrendCandidates({ signals: signals.signals, sources, taxonomy, config, now: NOW });
  const run = { schemaVersion: 1, id: "trend-selection-fixture", ...result };
  assert.equal(run.candidates.find((item) => item.id === "agent-skill").recommendedPool, "formal_candidate");
  await writeFile(resolve(trendsRoot, "signals.json"), JSON.stringify(signals));
  await writeTrendRun(run, { trendsRoot });
  return { trendsRoot, run, signals };
}

async function assertNoSelection(f) {
  assert.deepEqual(JSON.parse(await readFile(resolve(f.trendsRoot, "latest.json"))), f.run);
  await assert.rejects(readFile(resolve(f.trendsRoot, "selection.json")), { code: "ENOENT" });
}

test("a cached formal candidate is rejected after its evidence expires without publishing selection", async (t) => {
  const f = await fixture(t);
  await assert.rejects(selectTrendCandidate("agent-skill", "", {
    trendsRoot: f.trendsRoot, now: () => EXPIRED
  }), { code: "trend_candidate_refresh_required" });
  await assertNoSelection(f);
});

test("valid current evidence is rechecked and bound to the selected run", async (t) => {
  const f = await fixture(t);
  const result = await selectTrendCandidate("agent-skill", "synthetic", {
    trendsRoot: f.trendsRoot, now: () => NOW
  });
  assert.equal(result.selection.selectedAt, NOW.toISOString());
  assert.equal(result.selection.eligibilityValidation.validatedAt, NOW.toISOString());
  assert.equal(result.selection.eligibilityValidation.recommendedPool, "formal_candidate");
  for (const name of ["runHash", "candidateHash", "inputHash"]) {
    assert.match(result.selection.eligibilityValidation[name], /^[a-f0-9]{64}$/u);
  }
  assert.equal(result.selection.runId, f.run.id);
  const episode = buildEpisodeFromTrendSelection(result.selection, NOW);
  assert.deepEqual(episode.trendSelection.eligibilityValidation, result.selection.eligibilityValidation);
  assert.notEqual(episode.trendSelection.eligibilityValidation, result.selection.eligibilityValidation);
  assert.equal(Object.values(episode.approvals).every((gate) => gate.status === "pending"), true);
});

test("approval stops before Episode creation or events when selection evidence has expired", async (t) => {
  const f = await fixture(t);
  let writes = 0;
  await assert.rejects(approveTrendCandidate("agent-skill", "", {
    dependencies: {
      selectTrendCandidate: (id, note) => selectTrendCandidate(id, note, {
        trendsRoot: f.trendsRoot, now: () => EXPIRED
      }),
      createEpisodeFromTrendSelection: async () => { writes += 1; },
      appendEvent: async () => { writes += 1; }
    }
  }), { code: "trend_candidate_refresh_required" });
  assert.equal(writes, 0);
  await assertNoSelection(f);
});

test("Episode provenance rejects malformed or mismatched eligibility bindings", () => {
  for (const eligibilityValidation of [null, {}, { recommendedPool: "formal_candidate" }, {
    validatedAt: NOW.toISOString(), recommendedPool: "formal_candidate",
    runHash: "a".repeat(64), candidateHash: "b".repeat(64), inputHash: "c".repeat(64),
    humanApproved: true
  }]) {
    assert.throws(() => buildEpisodeFromTrendSelection({
      selectedAt: NOW.toISOString(), eligibilityValidation
    }, NOW), { code: "trend_selection_validation_invalid" });
  }
});

test("fresh-looking cached summaries cannot substitute for removed raw evidence", async (t) => {
  const f = await fixture(t);
  await writeFile(resolve(f.trendsRoot, "signals.json"), JSON.stringify({ signals: [] }));
  await assert.rejects(selectTrendCandidate("agent-skill", "", {
    trendsRoot: f.trendsRoot, now: () => NOW
  }), { code: "trend_candidate_refresh_required" });
  await assertNoSelection(f);
});

test("changed facts or invalid selection clock require refresh without mutating the run", async (t) => {
  const f = await fixture(t);
  const evidenceId = f.run.candidates.find((item) => item.id === "agent-skill").evidenceSignals[0].id;
  const changed = structuredClone(f.signals);
  changed.signals.find((item) => item.id === evidenceId).title = "Revised synthetic source fact";
  await writeFile(resolve(f.trendsRoot, "signals.json"), JSON.stringify(changed));
  await assert.rejects(selectTrendCandidate("agent-skill", "", {
    trendsRoot: f.trendsRoot, now: () => NOW
  }), { code: "trend_candidate_refresh_required" });
  await assert.rejects(selectTrendCandidate("agent-skill", "", {
    trendsRoot: f.trendsRoot, now: () => new Date("invalid")
  }), { code: "trend_candidate_refresh_required" });
  await assertNoSelection(f);
});

test("formal eligibility is recomputed even when publication dates and summaries are unchanged", async (t) => {
  const f = await fixture(t);
  const changed = structuredClone(f.signals);
  for (const signal of changed.signals) signal.collector = { discoveryVersion: 1 };
  await writeFile(resolve(f.trendsRoot, "signals.json"), JSON.stringify(changed));
  await assert.rejects(selectTrendCandidate("agent-skill", "", {
    trendsRoot: f.trendsRoot, now: () => NOW
  }), { code: "trend_candidate_refresh_required" });
  await assertNoSelection(f);
});

test("selection samples time only after acquiring the trend store lock", async (t) => {
  const f = await fixture(t);
  let now = NOW;
  let release;
  let acquired;
  const locked = new Promise((done) => { acquired = done; });
  const held = withDurableJsonStoreLock(f.trendsRoot, {}, async () => {
    acquired();
    await new Promise((done) => { release = done; });
  });
  await locked;
  const pending = selectTrendCandidate("agent-skill", "", {
    trendsRoot: f.trendsRoot, now: () => now
  });
  now = EXPIRED;
  release();
  await held;
  await assert.rejects(pending, { code: "trend_candidate_refresh_required" });
  await assertNoSelection(f);
});
