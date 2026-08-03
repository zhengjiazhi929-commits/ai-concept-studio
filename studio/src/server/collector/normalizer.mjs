import { createHash } from "node:crypto";
import { inferConceptIds } from "../trends/engine.mjs";
import { normalizeSearchText } from "../trends/schema.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const SAFE_ID_PATTERN = /^[a-z0-9-]+$/u;

function inferAngle(title) {
  const text = normalizeSearchText(title);
  if (/(大会|发布会|融资|行业新闻|waic|刚刚发布|正式发布)/u.test(text)) return "news";
  if (/(对比|区别|差别|\bvs\b|怎么选|选哪个|什么时候用哪个)/u.test(text)) {
    return "comparison";
  }
  if (/(评测|测试|benchmark|榜单|排行|实测)/u.test(text)) return "benchmark";
  if (/(如何|怎么|实操|教程|搭建|实现|步骤|从0到1|从零)/u.test(text)) return "tutorial";
  if (/(上线|验收|选型|成本|产品决策|值不值得|适合谁)/u.test(text)) {
    return "product-decision";
  }
  if (/(原理|为什么|机制|底层|架构|如何工作)/u.test(text)) return "mechanism";
  return "definition";
}

function sanitizeMetrics(metrics = {}) {
  const allowed = [
    "views",
    "likes",
    "comments",
    "favorites",
    "shares",
    "coins",
    "danmaku",
    "questionComments"
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => Number.isFinite(metrics[key]) && metrics[key] >= 0)
      .map((key) => [key, metrics[key]])
  );
}

function createSignalId(observation) {
  if (observation.id && SAFE_ID_PATTERN.test(observation.id)) return observation.id;
  const identity = [
    observation.creatorId,
    observation.externalId,
    observation.title,
    observation.publishedAt?.slice(0, 10)
  ]
    .filter(Boolean)
    .join("|");
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return `collector-${digest}`;
}

export function normalizeObservation({ observation, taxonomy, config, batchId, observedAt }) {
  const publishedAt = observation.publishedAt;
  const timestamp = Date.parse(publishedAt);
  if (!publishedAt || Number.isNaN(timestamp)) {
    return { status: "pending_review", reason: "missing-published-at", observation };
  }
  const ageDays = (Date.parse(observedAt) - timestamp) / DAY_MS;
  if (ageDays < -1) {
    return { status: "pending_review", reason: "future-published-at", observation };
  }
  if (ageDays > config.lookbackDays) {
    return { status: "ignored", reason: "outside-lookback-window", observation };
  }

  const validConceptIds = new Set(taxonomy.concepts.map((concept) => concept.id));
  const explicitConceptIds = (observation.conceptIds ?? []).filter((id) => validConceptIds.has(id));
  const conceptIds = explicitConceptIds.length
    ? Array.from(new Set(explicitConceptIds))
    : inferConceptIds({ title: observation.title }, taxonomy);
  if (conceptIds.length === 0) {
    return { status: "pending_review", reason: "unmapped-concept", observation };
  }

  const metrics = sanitizeMetrics(observation.metrics);
  const signal = {
    id: createSignalId(observation),
    creatorId: observation.creatorId,
    title: observation.title.trim(),
    sourceUrl: observation.sourceUrl,
    publishedAt: new Date(timestamp).toISOString(),
    observedAt,
    datePrecision: observation.datePrecision || "page-date",
    angle: observation.angle || inferAngle(observation.title),
    conceptIds,
    sourceKind: observation.sourceKind || "collector-public-page",
    ...(observation.externalId ? { externalId: observation.externalId } : {}),
    ...(Object.keys(metrics).length ? { metrics } : {}),
    collector: {
      batchId,
      normalization: explicitConceptIds.length ? "reviewed-explicit" : "taxonomy-alias",
      confidence: explicitConceptIds.length ? 1 : 0.82
    }
  };
  return { status: "accepted", reason: null, signal, observation };
}
