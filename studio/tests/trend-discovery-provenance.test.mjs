import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readTrendSignals, upsertTrendSignals } from "../src/server/trends/store.mjs";

async function fixtureStore(t) {
  const trendsRoot = await mkdtemp(resolve(tmpdir(), "trend-discovery-provenance-"));
  t.after(() => rm(trendsRoot, { recursive: true, force: true }));
  return { trendsRoot };
}

function signal(version, overrides = {}) {
  return {
    id: "discovery-provenance-fixture",
    creatorId: "douyin-qiu-shui",
    title: "合成Agent Skill原作品",
    sourceUrl: "https://www.douyin.com/video/123456789",
    publishedAt: "2026-09-07T04:00:00.000Z",
    observedAt: "2026-09-09T06:00:00.000Z",
    datePrecision: "page-date",
    conceptIds: ["agent-skill"],
    sourceKind: "collector-codex-assisted",
    collector: { batchId: `fixture-v${version}`, discoveryVersion: version },
    evidence: {
      authorName: "我叫秋水", authorUrl: "https://www.douyin.com/user/synthetic-fixture",
      url: "https://www.douyin.com/video/123456789",
      publishedText: "2026-09-07 12:00", excerpt: "合成原作品发布日期与作者证据"
    },
    ...overrides
  };
}

test("a later legacy import cannot downgrade existing v2 facts, evidence or metrics", async (t) => {
  const options = await fixtureStore(t);
  const verified = signal(2, { metrics: { likes: 4 } });
  await upsertTrendSignals([verified], options);
  const legacy = signal(1, {
    title: "未核验历史标题", sourceUrl: "https://www.douyin.com/video/987654321",
    observedAt: "2026-09-10T06:00:00.000Z", evidence: { excerpt: "旧证据" },
    metrics: { likes: 999, views: 8888 }
  });
  const result = await upsertTrendSignals([legacy], options);
  assert.equal(result.unchanged, 1);
  assert.deepEqual((await readTrendSignals(options)).signals, [verified]);
});

test("v2 replaces legacy facts and evidence together while discarding unrelated legacy metrics", async (t) => {
  const options = await fixtureStore(t);
  const legacy = signal(1, {
    title: "历史标题", publishedAt: "2026-09-01T04:00:00.000Z",
    sourceUrl: "https://www.douyin.com/video/987654321", metrics: { views: 900 },
    evidence: { excerpt: "旧页证据", publishedText: "2026-09-01" }
  });
  const verified = signal(2, { metrics: { likes: 4 } });
  await upsertTrendSignals([legacy], options);
  await upsertTrendSignals([verified], options);
  assert.deepEqual((await readTrendSignals(options)).signals, [verified]);
});

test("a v2 upgrade found by content keeps the existing stable id", async (t) => {
  const options = await fixtureStore(t);
  const legacy = signal(1, { id: "stable-legacy-id", evidence: { excerpt: "旧证据" } });
  const verified = signal(2, { id: "new-discovery-id" });
  await upsertTrendSignals([legacy], options);
  const result = await upsertTrendSignals([verified], options);
  assert.equal(result.added, 0);
  assert.deepEqual((await readTrendSignals(options)).signals, [{ ...verified, id: legacy.id }]);
});

test("v2 corrections refresh content identity before the next signal in the same batch", async (t) => {
  const options = await fixtureStore(t);
  await upsertTrendSignals([signal(1, { title: "旧标题" })], options);
  const corrected = signal(2, { title: "已核验新标题" });
  const duplicateContent = { ...corrected, id: "different-upstream-id" };
  const result = await upsertTrendSignals([corrected, duplicateContent], options);
  assert.equal(result.added, 0);
  assert.deepEqual((await readTrendSignals(options)).signals, [corrected]);
});

test("v2 correction cannot take another record's content identity or partially publish its batch", async (t) => {
  const options = await fixtureStore(t);
  const legacy = signal(1, { id: "legacy-record", title: "历史错误标题" });
  const verified = signal(2, { id: "verified-record", title: "已核验原作品标题" });
  await upsertTrendSignals([legacy, verified], options);
  const before = await readTrendSignals(options);

  await assert.rejects(upsertTrendSignals([
    signal(2, { id: "new-unrelated-record", title: "批次前部的另一个作品" }),
    { ...verified, id: legacy.id }
  ], { ...options, importTag: "rejected-content-correction" }),
  (error) => error.code === "trend_discovery_content_conflict");

  assert.deepEqual(await readTrendSignals(options), before);
});

test("same-work v2 metrics merge observed fields without sums or invented defaults", async (t) => {
  const options = await fixtureStore(t);
  const first = signal(2, { metrics: { views: 20, likes: 4 } });
  const incoming = signal(2, {
    title: "已核验标题修正", metrics: { likes: 3, comments: 0 },
    collector: { batchId: "new-verified-claim", discoveryVersion: 2 },
    evidence: { ...first.evidence, excerpt: "更新后的原作品证据" }
  });
  await upsertTrendSignals([first], options);
  await upsertTrendSignals([incoming], options);
  const saved = (await readTrendSignals(options)).signals[0];
  assert.deepEqual(saved.metrics, { views: 20, likes: 3, comments: 0 });
  assert.equal(saved.title, incoming.title);
  assert.deepEqual(saved.evidence, incoming.evidence);
  assert.deepEqual(saved.collector, incoming.collector);
});

test("a v2 corrected work URL does not inherit metrics or missing optional facts from a different work", async (t) => {
  const options = await fixtureStore(t);
  await upsertTrendSignals([signal(2, { metrics: { views: 10 }, externalId: "old-work" })], options);
  const corrected = signal(2, {
    sourceUrl: "https://www.douyin.com/video/987654321",
    evidence: { ...signal(2).evidence, url: "https://www.douyin.com/video/987654321" }
  });
  await upsertTrendSignals([corrected], options);
  assert.deepEqual((await readTrendSignals(options)).signals, [corrected]);
});

test("unmarked historical imports retain the previous merge behavior", async (t) => {
  const options = await fixtureStore(t);
  const existing = signal(undefined, { title: "保留的旧标题", metrics: { views: 20 } });
  delete existing.collector;
  const incoming = signal(undefined, {
    title: "新输入标题", sourceUrl: "https://www.douyin.com/video/999",
    metrics: { likes: 3 }, evidence: { excerpt: "新输入证据" }
  });
  delete incoming.collector;
  await upsertTrendSignals([existing], options);
  await upsertTrendSignals([incoming], options);
  const saved = (await readTrendSignals(options)).signals[0];
  assert.equal(saved.title, existing.title);
  assert.equal(saved.sourceUrl, incoming.sourceUrl);
  assert.deepEqual(saved.evidence, existing.evidence);
  assert.deepEqual(saved.metrics, { views: 20, likes: 3 });
});

test("incoming v2 cannot reuse another creator's stable id or partially publish its batch", async (t) => {
  const options = await fixtureStore(t);
  const existing = signal(1);
  await upsertTrendSignals([existing], options);
  await assert.rejects(upsertTrendSignals([
    signal(2, { id: "unrelated-new-signal", title: "另一个合成作品" }),
    signal(2, { creatorId: "douyin-ai-model-learning" })
  ], options), (error) => error.code === "trend_discovery_creator_conflict");
  assert.deepEqual((await readTrendSignals(options)).signals, [existing]);
});
