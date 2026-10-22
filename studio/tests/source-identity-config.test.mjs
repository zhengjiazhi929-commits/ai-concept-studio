import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {buildRecentDiscoveryTask, matchesConfiguredCreator, validateRecentDiscoveryBatch} from "../src/server/collector/discovery.mjs";
import {discoverTrendCandidates} from "../src/server/trends/engine.mjs";

// Versioned configuration is the subject of these contract tests. All work
// observations are synthetic; no ignored evidence or live store is consumed.
const readConfig = async name => JSON.parse(await readFile(new URL(`../config/${name}.json`, import.meta.url), "utf8"));
const sources = await readConfig("trend-sources");
const source = sources.creators.find(item => item.id === "douyin-sherry");
const fullName = "Sherry小水（Ai工具学习者）";
const now = new Date("2026-09-09T09:00:00Z");

function fixtureBatch(currentSources = sources) {
  const task = buildRecentDiscoveryTask({sources: currentSources, now});
  return {task, batch: {
    schemaVersion: 2, batchId: "synthetic-source-correction", discoveryTaskId: task.taskId,
    observedAt: now.toISOString(), method: "synthetic source identity regression",
    sourceChecks: [{creatorId: source.id, status: "verified", checkedAt: now.toISOString(), url: "https://www.douyin.com/video/12345"}],
    observations: [{creatorId: source.id, title: "Synthetic Agent Skill example", sourceUrl: "https://www.douyin.com/video/12345",
      publishedAt: "2026-09-03T00:00:00+08:00", datePrecision: "page-date", conceptIds: ["agent-skill"],
      evidence: {authorName: fullName, authorUrl: null, identityBasis: "original-work-byline",
        url: "https://www.douyin.com/video/12345", publishedText: "2026-09-03发布", excerpt: `${fullName}\nSynthetic example\n2026-09-03发布`}
    }]
  }};
}

test("source correction uses the verified canonical byline without adding a creator", () => {
  assert.equal(source.name, fullName);
  assert.equal(source.id, "douyin-sherry");
  assert.equal(source.coverageGroup, "sherry");
  assert.equal(source.weight, 1);
  assert.equal(source.audienceFit, 0.85);
  assert.equal(sources.creators.filter(item => item.coverageGroup === "sherry").length, 1);
  assert.deepEqual(source.verifiedNameAliases ?? [], []);
});

test("corrected byline accepts the complete name but not prefixes or unverified variants", () => {
  assert.equal(matchesConfiguredCreator(fullName, source), true);
  for (const name of ["Sherry小水", `${fullName}搬运`, "Sherry小水（其他账号）", "小水"]) {
    assert.equal(matchesConfiguredCreator(name, source), false, name);
  }
  const {task, batch} = fixtureBatch();
  assert.equal(validateRecentDiscoveryBatch(batch, {sources, task, now}).valid, true);
});

test("reviewed public-work entry points are not treated as verified author profiles", () => {
  const task = buildRecentDiscoveryTask({sources, now});
  assert.equal(source.profileUrl, "https://jingxuan.douyin.com/m/video/7681270887899491200");
  const ming = sources.creators.find(item => item.id === "douyin-ming-jie");
  assert.equal(ming.name, "鸣姐.AI进阶");
  assert.equal(ming.coverageGroup, "ming-jie");
  assert.equal(ming.profileUrl, "https://jingxuan.douyin.com/m/video/7607800723727732010");
  for (const id of [source.id, ming.id]) assert.equal(task.tasks.find(item => item.creatorId === id).entryUrlIsProfile, false);
});

test("canonical name correction cannot bypass an existing bound account", () => {
  const bound = structuredClone(sources);
  bound.creators.find(item => item.id === source.id).profileUrl = "https://www.douyin.com/user/synthetic-owner";
  const {task, batch} = fixtureBatch(bound);
  assert.equal(validateRecentDiscoveryBatch(batch, {sources: bound, task, now}).valid, false);
  batch.observations[0].evidence.authorUrl = "https://www.douyin.com/user/synthetic-impostor";
  assert.equal(validateRecentDiscoveryBatch(batch, {sources: bound, task, now}).valid, false);
  batch.observations[0].evidence.authorUrl = "https://www.douyin.com/user/synthetic-owner";
  assert.equal(validateRecentDiscoveryBatch(batch, {sources: bound, task, now}).valid, true);
});

test("multiple works of the corrected source still count as one coverage group", async () => {
  const signals = [1, 2].map(index => ({id: `synthetic-work-${index}`, creatorId: source.id,
    title: "Synthetic Agent Skill example", sourceUrl: `https://www.douyin.com/video/${index}`,
    publishedAt: "2026-09-03T00:00:00+08:00", observedAt: now.toISOString(), datePrecision: "page-date",
    angle: "tutorial", conceptIds: ["agent-skill"], collector: {discoveryVersion: 2}}));
  const result = discoverTrendCandidates({signals, sources, taxonomy: await readConfig("concept-taxonomy"), config: await readConfig("trend-radar"), now});
  const candidate = result.candidates.find(item => item.id === "agent-skill");
  assert.equal(candidate.signalCount, 2);
  assert.equal(candidate.heatGate.creators14, 1);
  assert.equal(candidate.heatGate.creators30, 1);
  assert.equal(candidate.recommendedPool, "observation_pool");
});

test("unresolved reference-account binding and source gates remain unchanged", async () => {
  assert.equal(sources.creators.find(item => item.id === "douyin-user-reference-ai-model-learning").profileUrl,
    "https://www.douyin.com/user/MS4wLjABAAAALc4kETj5YEPPpJXumFbEKsrihV9MQCdEtP4p8im0w2g");
  assert.equal(sources.creators.find(item => item.id === "bilibili-ai-frontier-interview").name, "AI前沿访谈");
  const config = await readConfig("trend-radar");
  assert.equal(config.hardGates.primaryCreatorCount, 3);
  assert.equal(config.hardGates.extendedCreatorCount, 5);
  assert.equal(config.thresholds.formalCandidate, 70);
});
