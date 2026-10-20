import assert from "node:assert/strict";
import test from "node:test";
import {buildRecentDiscoveryTask, validateRecentDiscoveryBatch} from "../src/server/collector/discovery.mjs";
import {normalizeObservation} from "../src/server/collector/normalizer.mjs";

const now = new Date("2026-09-09T06:00:00Z");
const creators = [
  {id: "dy-example", name: "示例作者", platform: "douyin", enabled: true, profileUrl: "https://www.douyin.com/video/123"},
  {id: "b-example", name: "示例UP", platform: "bilibili", enabled: true, profileUrl: "https://www.bilibili.com/video/BV123/"},
  {id: "disabled", name: "停用作者", platform: "douyin", enabled: false}
];
const sources = {creators};
function task() { return buildRecentDiscoveryTask({sources, now, lookbackDays: 30, sourceResults: []}); }
function batch() {
  return {
    schemaVersion: 2, batchId: "discovered-fixture", discoveryTaskId: task().taskId,
    observedAt: now.toISOString(), method: "公开原作品页面核对",
    sourceChecks: [{creatorId: "dy-example", status: "verified", checkedAt: now.toISOString(), url: "https://www.douyin.com/video/789"}],
    observations: [{
      creatorId: "dy-example", title: "Agent记忆系统如何工作", sourceUrl: "https://www.douyin.com/video/789",
      publishedAt: "2026-09-07T04:00:00Z", datePrecision: "page-date", conceptIds: ["memory"],
      evidence: {authorName: "示例作者", authorUrl: "https://www.douyin.com/user/creator-one", url: "https://www.douyin.com/video/789", publishedText: "2026-09-07 12:00", excerpt: "示例作者 2026-09-07 12:00 Agent记忆系统如何工作"}
    }]
  };
}

test("recent discovery covers all enabled authors, not just failed direct pages", () => {
  const t = task();
  assert.equal(t.tasks.length, 2);
  assert.equal(t.tasks[1].platform, "bilibili");
  assert.equal(t.requiresCodexContinuation, true);
  assert.equal(t.window.from, "2026-08-10T06:00:00.000Z");
  assert.equal(t.window.to, now.toISOString());
  assert.match(t.tasks[1].suggestedSearchQuery, /bilibili/u);
  assert.equal(t.tasks[1].entryUrlIsProfile, false);
  assert.equal(t.outputTemplate.schemaVersion, 2);
  assert.equal(t.authorizesCandidateSelection, false);
});

test("v2 discovery evidence is bound to the live task, author, item and date", () => {
  assert.equal(validateRecentDiscoveryBatch(batch(), {sources, task: task(), now}).valid, true);
  for (const mutate of [
    b => {b.discoveryTaskId = "other-task";},
    b => {b.observations[0].evidence.authorName = "其他作者";},
    b => {b.observations[0].evidence.url = "https://www.douyin.com/video/999";},
    b => {b.observations[0].publishedAt = "2026-10-01T00:00:00Z";},
    b => {b.observations[0].publishedAt = "2026-07-01T00:00:00Z";},
    b => {b.observations[0].datePrecision = "observation-window";},
    b => {b.observations[0].sourceUrl = "https://www.douyin.com/search/Agent";},
    b => {b.observations[0].evidence.authorUrl = "http://localhost/private";},
    b => {b.observations[0].evidence.publishedText = "";},
    b => {b.observations[0].evidence.publishedText = 123;},
    b => {b.observations[0].metrics = null;},
    b => {b.observations[0].evidence.excerpt = "";},
    b => {b.sourceChecks = [];},
    b => {b.sourceChecks[0].status = "blocked";},
    b => {b.observedAt = "2026-08-01T00:00:00Z";}
  ]) {
    const b = batch(); mutate(b);
    assert.equal(validateRecentDiscoveryBatch(b, {sources, task: task(), now}).valid, false, JSON.stringify(b));
  }
});

test("a bounded scan may honestly find zero items and cannot claim observed success", () => {
  const b = batch(); b.observations = [];
  b.sourceChecks[0].status = "blocked";
  assert.equal(validateRecentDiscoveryBatch(b, {sources, task: task(), now}).valid, true);
  b.sourceChecks[0].status = "verified";
  assert.equal(validateRecentDiscoveryBatch(b, {sources, task: task(), now}).valid, false);
});

test("duplicate original works or author identity cannot inflate independent coverage", () => {
  const b = batch(); b.observations.push(structuredClone(b.observations[0]));
  assert.equal(validateRecentDiscoveryBatch(b, {sources, task: task(), now}).valid, false);
});

test("byline fallback is explicit, preserves its weaker basis, and cannot bypass a bound account", () => {
  const b = batch();
  const evidence = b.observations[0].evidence;
  evidence.authorUrl = null;
  evidence.identityBasis = "original-work-byline";
  assert.equal(validateRecentDiscoveryBatch(b, {sources, task: task(), now}).valid, true);
  for (const mutate of [
    e => { delete e.identityBasis; },
    e => { e.authorUrl = "https://malicious.example/user/123"; },
    e => { e.excerpt = "只有标题，没有作者和日期"; },
    e => { e.publishedText = "2026-09-08"; }
  ]) {
    const malformed = structuredClone(b); mutate(malformed.observations[0].evidence);
    assert.equal(validateRecentDiscoveryBatch(malformed, {sources, task: task(), now}).valid, false);
  }
  const boundSources = structuredClone(sources);
  boundSources.creators[0].profileUrl = "https://www.douyin.com/user/creator-one";
  assert.equal(validateRecentDiscoveryBatch(b, {sources: boundSources, task: task(), now}).valid, false);
  const signal = normalizeObservation({observation: b.observations[0], taxonomy: {concepts: [{id: "memory", aliases: []}]}, config: {lookbackDays: 45}, batchId: b.batchId, observedAt: b.observedAt, source: creators[0]}).signal;
  assert.equal(signal.evidence.identityBasis, "original-work-byline");
});

test("malformed task window cannot disable the recency gate", () => {
  for (const window of [{}, {from: "bad", to: now.toISOString()}, {from: now.toISOString(), to: "bad"}]) {
    assert.equal(validateRecentDiscoveryBatch(batch(), {sources, task: {...task(), window}, now}).valid, false);
  }
});

test("publication time must agree with original date text; relative dates require an observation anchor", () => {
  const b = batch();
  b.observations[0].evidence.publishedText = "2020-01-01发布";
  b.observations[0].evidence.excerpt = "示例作者 2020-01-01发布";
  assert.equal(validateRecentDiscoveryBatch(b, {sources, task: task(), now}).valid, false);
  const relative = batch(); relative.observations[0].datePrecision = "relative-day-estimate";
  relative.observations[0].evidence.publishedText = "2天前";
  assert.equal(validateRecentDiscoveryBatch(relative, {sources, task: task(), now}).valid, false);
  relative.observations[0].evidence.dateReferenceAt = now.toISOString();
  assert.equal(validateRecentDiscoveryBatch(relative, {sources, task: task(), now}).valid, true);
  relative.observations[0].evidence.dateReferenceAt = "2020-01-01T00:00:00Z";
  assert.equal(validateRecentDiscoveryBatch(relative, {sources, task: task(), now}).valid, false);
  const chinese = batch(); chinese.observations[0].evidence.publishedText = "2026年9月7日发布";
  assert.equal(validateRecentDiscoveryBatch(chinese, {sources, task: task(), now}).valid, true);
});

test("discovery rejects malformed collections rather than throwing TypeError", () => {
  for (const b of [null, {}, {...batch(), observations: {}}, {...batch(), sourceChecks: null}, {...batch(), observations: [null]}]) {
    assert.equal(validateRecentDiscoveryBatch(b, {sources, task: task(), now}).valid, false);
  }
});

test("normalization rejects wrong direct-page author and preserves v2 evidence", () => {
  const options = {
    taxonomy: {concepts: [{id: "memory", aliases: ["记忆"]}]}, config: {lookbackDays: 45},
    batchId: "normalizer-fixture", observedAt: now.toISOString(), source: creators[0]
  };
  const observation = batch().observations[0];
  const wrong = normalizeObservation({...options, observation: {...observation, evidence: undefined, pageCreatorName: "别人的账号"}});
  assert.equal(wrong.status, "pending_review");
  assert.equal(wrong.reason, "creator-identity-mismatch");
  const correct = normalizeObservation({...options, observation});
  assert.equal(correct.status, "accepted");
  assert.deepEqual(correct.signal.evidence, observation.evidence);
});
