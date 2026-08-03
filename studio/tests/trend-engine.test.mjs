import test from "node:test";
import assert from "node:assert/strict";
import { discoverTrendCandidates } from "../src/server/trends/engine.mjs";
import {
  readConceptTaxonomy,
  readTrendRadarConfig,
  readTrendSignals,
  readTrendSources,
  selectTrendCandidate
} from "../src/server/trends/store.mjs";

async function runFixture() {
  const [signalDocument, sources, taxonomy, config] = await Promise.all([
    readTrendSignals(),
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

test("热点发现按创作者共振而不是信号条数排名", async () => {
  const result = await runFixture();
  const agentSkill = result.candidates.find((candidate) => candidate.id === "agent-skill");

  assert.equal(agentSkill.recommendedPool, "formal_candidate");
  assert.equal(agentSkill.heatGate.creators14 >= 3, true);
  assert.equal(agentSkill.signalCount > agentSkill.heatGate.creators30, true);
  assert.equal(agentSkill.rank, 1);
});

test("已经制作的概念不会继续占用新一期推荐位", async () => {
  const result = await runFixture();
  const agenticCoding = result.candidates.find((candidate) => candidate.id === "agentic-coding");

  assert.equal(agenticCoding.productionState, "already_covered");
  assert.equal(agenticCoding.recommendedPool, "already_covered");
});

test("事件占主导或创作者不足的概念留在观察池", async () => {
  const result = await runFixture();
  const physicalAi = result.candidates.find((candidate) => candidate.id === "physical-ai");
  const rag = result.candidates.find((candidate) => candidate.id === "rag-engineering");

  assert.equal(physicalAi.eventDominated, true);
  assert.equal(physicalAi.recommendedPool, "observation_pool");
  assert.equal(rag.heatGate.passed, false);
  assert.equal(rag.recommendedPool, "observation_pool");
});

test("缺失互动数据不被填成虚构分数", async () => {
  const result = await runFixture();
  const agentSkill = result.candidates.find((candidate) => candidate.id === "agent-skill");

  assert.equal(agentSkill.score.components.relativePerformance.available, false);
  assert.equal(agentSkill.score.components.questionDensity.available, false);
  assert.equal(agentSkill.score.availablePoints, 70);
  assert.equal(agentSkill.confidence.level, "medium");
});

test("观察池候选不能绕过人工界面进入研究阶段", async () => {
  await assert.rejects(
    selectTrendCandidate("rag-engineering"),
    /还没有通过正式候选门槛/u
  );
});
