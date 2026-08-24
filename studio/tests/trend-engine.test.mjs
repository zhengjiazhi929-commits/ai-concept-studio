import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { trendsDataRoot } from "../src/shared/paths.mjs";
import { discoverTrendCandidates } from "../src/server/trends/engine.mjs";
import {
  readConceptTaxonomy,
  readTrendRadarConfig,
  readTrendSignals,
  readTrendSources,
  selectTrendCandidate
} from "../src/server/trends/store.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(testDirectory, "fixtures", "trends");

async function createFixtureStore(t) {
  const trendsRoot = await mkdtemp(join(tmpdir(), "acs-trend-engine-"));
  t.after(() => rm(trendsRoot, { recursive: true, force: true }));
  await Promise.all([
    copyFile(resolve(fixtureDirectory, "signals.json"), resolve(trendsRoot, "signals.json")),
    copyFile(resolve(fixtureDirectory, "latest.json"), resolve(trendsRoot, "latest.json"))
  ]);

  const runtimeRoot = resolve(trendsDataRoot);
  const isolatedRoot = resolve(trendsRoot);
  assert.equal(
    isolatedRoot === runtimeRoot || isolatedRoot.startsWith(`${runtimeRoot}${sep}`),
    false,
    "trend tests must never use the runtime trend root"
  );
  return { trendsRoot: isolatedRoot };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function runFixture(t) {
  const storeOptions = await createFixtureStore(t);
  const [signalDocument, sources, taxonomy, config] = await Promise.all([
    readTrendSignals(storeOptions),
    readTrendSources(),
    readConceptTaxonomy(),
    readTrendRadarConfig()
  ]);
  return discoverTrendCandidates({
    signals: signalDocument.signals,
    sources,
    taxonomy,
    config,
    coveredConceptIds: ["agentic-coding"],
    now: new Date("2026-08-03T23:00:00+08:00")
  });
}

test("热点发现按创作者共振而不是信号条数排名", async (t) => {
  const result = await runFixture(t);
  const agentSkill = result.candidates.find((candidate) => candidate.id === "agent-skill");

  assert.equal(agentSkill.recommendedPool, "formal_candidate");
  assert.equal(agentSkill.heatGate.creators14 >= 3, true);
  assert.equal(agentSkill.signalCount > agentSkill.heatGate.creators30, true);
  assert.equal(agentSkill.rank, 1);
});

test("已经制作的概念不会继续占用新一期推荐位", async (t) => {
  const result = await runFixture(t);
  const agenticCoding = result.candidates.find((candidate) => candidate.id === "agentic-coding");

  assert.equal(agenticCoding.productionState, "already_covered");
  assert.equal(agenticCoding.recommendedPool, "already_covered");
});

test("事件占主导或创作者不足的概念留在观察池", async (t) => {
  const result = await runFixture(t);
  const physicalAi = result.candidates.find((candidate) => candidate.id === "physical-ai");
  const rag = result.candidates.find((candidate) => candidate.id === "rag-engineering");

  assert.equal(physicalAi.eventDominated, true);
  assert.equal(physicalAi.recommendedPool, "observation_pool");
  assert.equal(rag.heatGate.passed, false);
  assert.equal(rag.recommendedPool, "observation_pool");
});

test("缺失互动数据不被填成虚构分数", async (t) => {
  const result = await runFixture(t);
  const agentSkill = result.candidates.find((candidate) => candidate.id === "agent-skill");

  assert.equal(agentSkill.score.components.relativePerformance.available, false);
  assert.equal(agentSkill.score.components.questionDensity.available, false);
  assert.equal(agentSkill.score.availablePoints, 70);
  assert.equal(agentSkill.confidence.level, "medium");
});

test("观察池候选不能绕过人工界面进入研究阶段", async (t) => {
  const storeOptions = await createFixtureStore(t);
  await assert.rejects(
    selectTrendCandidate("rag-engineering", "", storeOptions),
    /还没有通过正式候选门槛/u
  );
});

test("候选选择只写入注入的临时 trend root", async (t) => {
  const storeOptions = await createFixtureStore(t);
  const result = await selectTrendCandidate(
    "agent-skill",
    "synthetic fixture selection",
    storeOptions
  );
  const runPath = resolve(storeOptions.trendsRoot, "runs", `${result.run.id}.json`);
  const [savedRun, latestRun, selection] = await Promise.all([
    readJson(runPath),
    readJson(resolve(storeOptions.trendsRoot, "latest.json")),
    readJson(resolve(storeOptions.trendsRoot, "selection.json"))
  ]);

  assert.equal(savedRun.selectedCandidateId, "agent-skill");
  assert.equal(latestRun.selectedCandidateId, "agent-skill");
  assert.equal(selection.candidateId, "agent-skill");
});
