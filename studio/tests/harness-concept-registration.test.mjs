import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {discoverTrendCandidates, inferConceptIds} from "../src/server/trends/engine.mjs";
import {validateTaxonomy} from "../src/server/trends/schema.mjs";

const readConfig = async name => JSON.parse(await readFile(new URL(`../config/${name}.json`, import.meta.url), "utf8"));
const taxonomy = await readConfig("concept-taxonomy");
const config = await readConfig("trend-radar");

test("Harness registry describes a cross-implementation runtime topic", () => {
  assert.deepEqual(validateTaxonomy(taxonomy), {valid: true, errors: []});
  const concept = taxonomy.concepts.find(item => item.id === "agent-harness");
  assert.ok(concept, "agent-harness must be registered");
  assert.equal(concept.brandIndependent, true);
  assert.ok(concept.productDecisions.length >= 3);
  assert.ok(new Set(concept.primarySources.map(source => new URL(source.url).hostname)).size >= 2);
});

test("Harness aliases recognize explicit concepts without swallowing products or adjacent topics", () => {
  for (const title of ["Agent Harness 的运行控制", "Harness Engineering 与业务完成条件"]) {
    assert.ok(inferConceptIds({title}, taxonomy).includes("agent-harness"), title);
  }
  for (const title of ["Harness", "测试工具 Harness", "DeepSeek Harness 更新价格", "模型 eval harness 榜单", "Agent Loop", "上下文工程", "多智能体", "Agent框架教程"]) {
    assert.equal(inferConceptIds({title}, taxonomy).includes("agent-harness"), false, title);
  }
});

test("one reviewed runtime-mechanism source stays below formal heat thresholds", () => {
  const now = new Date("2026-10-22T08:00:00Z");
  const result = discoverTrendCandidates({
    taxonomy, config, now, coveredConceptIds: [],
    sources: {schemaVersion: 1, creators: [{id: "synthetic-runtime-author", name: "Synthetic author", platform: "bilibili", category: "engineering", enabled: true, coverageGroup: "synthetic-runtime-author", weight: 1, audienceFit: 0.9}]},
    signals: [{id: "synthetic-runtime-rules", creatorId: "synthetic-runtime-author", title: "Synthetic runtime permission mechanism", sourceUrl: "https://example.test/synthetic-runtime", publishedAt: "2026-10-03T11:43:30Z", observedAt: now.toISOString(), datePrecision: "page-date", angle: "mechanism", conceptIds: ["agent-harness"]}]
  });
  const candidate = result.candidates.find(item => item.id === "agent-harness");
  assert.ok(candidate, "reviewed sub-mechanism can appear as an observation");
  assert.equal(candidate.heatGate.creators14, 0);
  assert.equal(candidate.heatGate.creators30, 1);
  assert.equal(candidate.heatGate.passed, false);
  assert.equal(candidate.recommendedPool, "observation_pool");
  assert.equal(config.hardGates.primaryCreatorCount, 3);
  assert.equal(config.hardGates.extendedCreatorCount, 5);
});
