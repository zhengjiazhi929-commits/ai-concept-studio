import test from "node:test";
import assert from "node:assert/strict";
import { collectPublicSource, parseBilibiliPage } from "../src/server/collector/adapters.mjs";
import { normalizeObservation } from "../src/server/collector/normalizer.mjs";
import { readCollectorConfig } from "../src/server/collector/store.mjs";
import { readConceptTaxonomy } from "../src/server/trends/store.mjs";

const observedAt = "2026-08-03T08:00:00.000Z";
const bilibiliSource = {
  id: "bilibili-feiman-ai",
  platform: "bilibili",
  profileUrl: "https://www.bilibili.com/video/BVTEST123/"
};

function bilibiliFixture() {
  const state = {
    videoData: {
      bvid: "BVTEST123",
      title: "7步设计 Agent 记忆系统",
      pubdate: Math.floor(Date.parse("2026-08-02T03:00:00.000Z") / 1000),
      owner: { name: "费曼学AI" },
      stat: {
        view: 4493,
        like: 154,
        reply: 21,
        favorite: 574,
        share: 46,
        coin: 77,
        danmaku: 11
      }
    }
  };
  return `<html><script>window.__INITIAL_STATE__=${JSON.stringify(state)};(function(){})();</script></html>`;
}

test("B站公开页适配器提取标题、日期和真实公开指标", () => {
  const result = parseBilibiliPage(bilibiliFixture(), bilibiliSource, observedAt);
  const observation = result.observations[0];

  assert.equal(result.status, "success");
  assert.equal(observation.externalId, "BVTEST123");
  assert.equal(observation.metrics.views, 4493);
  assert.equal(observation.metrics.favorites, 574);
});

test("抖音客户端渲染页被明确转入 Codex 辅助，而不是伪装采集成功", async () => {
  const config = await readCollectorConfig();
  const result = await collectPublicSource(
    {
      id: "douyin-qiu-shui",
      platform: "douyin",
      profileUrl: "https://jingxuan.douyin.com/m/video/1"
    },
    {
      config,
      now: new Date(observedAt),
      fetchImpl: async () => new Response("<html><div id='root'></div></html>", { status: 200 })
    }
  );

  assert.equal(result.status, "assisted_required");
  assert.equal(result.reason, "client-rendered-list-needs-codex");
  assert.equal(result.observations.length, 0);
});

test("公开页面遇到一次临时网络失败后会短重试", async () => {
  const config = await readCollectorConfig();
  let attempts = 0;
  const result = await collectPublicSource(bilibiliSource, {
    config,
    now: new Date(observedAt),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("temporary network failure");
      return new Response(bilibiliFixture(), { status: 200 });
    }
  });

  assert.equal(attempts, 2);
  assert.equal(result.status, "success");
});

test("采集观察通过概念词典归一化后才能成为热点信号", async () => {
  const [config, taxonomy] = await Promise.all([
    readCollectorConfig(),
    readConceptTaxonomy()
  ]);
  const result = normalizeObservation({
    observation: {
      creatorId: "bilibili-feiman-ai",
      title: "7步设计 Agent 记忆系统",
      sourceUrl: "https://www.bilibili.com/video/BVTEST123/",
      publishedAt: "2026-08-02T03:00:00.000Z",
      metrics: { views: 4493 }
    },
    taxonomy,
    config,
    batchId: "collector-test-batch",
    observedAt
  });

  assert.equal(result.status, "accepted");
  assert.deepEqual(result.signal.conceptIds, ["context-engineering-memory"]);
  assert.equal(result.signal.collector.normalization, "taxonomy-alias");
});

test("没有匹配概念的内容留在待复核区，不污染热点雷达", async () => {
  const [config, taxonomy] = await Promise.all([
    readCollectorConfig(),
    readConceptTaxonomy()
  ]);
  const result = normalizeObservation({
    observation: {
      creatorId: "bilibili-feiman-ai",
      title: "今天聊聊团队管理",
      sourceUrl: "https://example.com/video/1",
      publishedAt: "2026-08-02T03:00:00.000Z"
    },
    taxonomy,
    config,
    batchId: "collector-test-batch",
    observedAt
  });

  assert.equal(result.status, "pending_review");
  assert.equal(result.reason, "unmapped-concept");
});
