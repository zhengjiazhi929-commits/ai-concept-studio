import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {buildRecentDiscoveryTask, validateRecentDiscoveryBatch} from "../src/server/collector/discovery.mjs";
import {validateTrendSources} from "../src/server/trends/schema.mjs";

// Registry contracts use tracked configuration and synthetic observations only.
const sources = JSON.parse(await readFile(new URL("../config/trend-sources.json", import.meta.url), "utf8"));
const additions = [
  ["bilibili-sean", "479332937"],
  ["bilibili-ai-architect-leo", "518390923"],
  ["bilibili-kunpeng-talk", "18052876"],
  ["bilibili-ai-product-sniper", "596541619"],
  ["bilibili-ai-super-domain", "3493277319825652"],
  ["bilibili-haianyu", "2071007724"]
];

test("expanded creator registry keeps verified account bindings and conservative weights", () => {
  assert.deepEqual(validateTrendSources(sources), {valid: true, errors: []});
  for (const [id, account] of additions) {
    const source = sources.creators.find(item => item.id === id);
    assert.ok(source, id);
    assert.equal(source.profileUrl.replace(/\/$/u, ""), `https://space.bilibili.com/${account}`);
    assert.equal(source.weight, 1);
    assert.ok(source.audienceFit <= 0.9);
    assert.equal(sources.creators.filter(item => item.coverageGroup === source.coverageGroup).length, 1);
  }
  const weak = sources.creators.find(item => item.id === "douyin-jiutian-hector");
  assert.ok(weak);
  assert.equal(weak.weight, 1);
  assert.equal(weak.profileUrl, "https://jingxuan.douyin.com/m/video/7690507069723577643");
  assert.equal(sources.creators.some(item => item.id === "bilibili-laoji-oceanbase"), false);
});

test("new bound accounts cannot fall back to display-name-only evidence", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const task = buildRecentDiscoveryTask({sources, now});
  for (const [id] of additions) {
    const source = sources.creators.find(item => item.id === id);
    assert.ok(source, id);
    const work = "https://www.bilibili.com/video/BVSynthetic123/";
    const batch = {
      schemaVersion: 2, batchId: "synthetic-expanded-source", discoveryTaskId: task.taskId,
      observedAt: now.toISOString(), method: "synthetic identity contract",
      sourceChecks: [{creatorId: id, status: "verified", checkedAt: now.toISOString(), url: work}],
      observations: [{creatorId: id, title: "Synthetic topic", sourceUrl: work,
        publishedAt: "2026-10-20T00:00:00+08:00", datePrecision: "page-date", conceptIds: [],
        evidence: {url: work, authorName: source.name, authorUrl: null,
          identityBasis: "original-work-byline", publishedText: "2026-10-20",
          excerpt: `${source.name} 2026-10-20`}}]
    };
    assert.equal(validateRecentDiscoveryBatch(batch, {sources, task, now}).valid, false, id);
    batch.observations[0].evidence.authorUrl = source.profileUrl;
    delete batch.observations[0].evidence.identityBasis;
    assert.equal(validateRecentDiscoveryBatch(batch, {sources, task, now}).valid, true, id);
  }
});
