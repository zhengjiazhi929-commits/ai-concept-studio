import test from "node:test";
import assert from "node:assert/strict";
import { validateEpisode } from "../src/shared/schema.mjs";
import { buildEpisodeFromTrendSelection } from "../src/server/research/episode.mjs";
import {
  buildResearchPlan,
  mergeEvidenceBatch
} from "../src/server/research/engine.mjs";
import { inspectPrimarySource } from "../src/server/research/fetcher.mjs";
import { researchStepAfterEvidenceImport } from "../src/server/research/agent.mjs";
import { validateResearchEvidenceBatch } from "../src/server/research/schema.mjs";
import { readResearchConfig } from "../src/server/research/store.mjs";

const selectedAt = "2026-08-03T10:00:00.000Z";

function selectionFixture() {
  return {
    schemaVersion: 1,
    selectedAt,
    runId: "trend-test-run",
    candidateId: "agent-skill",
    episodeId: "agent-skill-20260803",
    concept: "Agent Skill",
    recommendedTitle: "Agent Skill 到底是什么？",
    note: "测试选题",
    productDecisions: ["何时沉淀过程知识", "Skill 与工具的分工"],
    primarySources: [
      { label: "Agent Skills specification", url: "https://agentskills.io/specification" },
      { label: "Agent Skills paper", url: "https://arxiv.org/abs/2602.12430" }
    ],
    creatorEvidence: [{ id: "creator-a", name: "热门创作者 A" }],
    evidenceSignals: [
      { id: "signal-a", title: "一次讲清 Agent Skill", sourceUrl: "https://example.com/video" }
    ]
  };
}

function evidenceBatch(pack) {
  const [specification, paper] = pack.sources;
  return {
    schemaVersion: 1,
    batchId: "research-agent-skill-20260803",
    episodeId: pack.episodeId,
    researchedAt: "2026-08-03T11:00:00.000Z",
    method: "Codex 公开一手资料核验",
    sources: [
      {
        id: specification.id,
        label: specification.label,
        url: specification.url,
        publisher: "Agent Skills",
        sourceType: specification.sourceType,
        evidenceSummary: "规范描述了 Skill 的目录结构、发现方式与加载边界。",
        locator: "Specification sections: overview, skill directories"
      },
      {
        id: paper.id,
        label: paper.label,
        url: paper.url,
        publisher: "arXiv",
        sourceType: paper.sourceType,
        evidenceSummary: "论文讨论了可复用过程知识对 Agent 执行的影响。",
        locator: "Abstract and methodology"
      },
      {
        id: "source-third-official",
        label: "Official implementation guide",
        url: "https://docs.example.org/agent-skills/guide",
        publisher: "Example Foundation",
        sourceType: "official-doc",
        evidenceSummary: "实现指南补充了版本与权限治理要求。",
        locator: "Governance section"
      }
    ],
    claims: [
      {
        id: "claim-definition",
        category: "definition",
        text: "Skill 是可被 Agent 发现和按需加载的过程知识单元。",
        importance: "critical",
        support: "supported",
        sourceIds: [specification.id, paper.id],
        boundary: "不同产品的具体加载协议可能不同。"
      },
      {
        id: "claim-mechanism",
        category: "mechanism",
        text: "系统先发现元数据，再按任务需要加载具体说明和资源。",
        importance: "critical",
        support: "supported",
        sourceIds: [specification.id, paper.id],
        boundary: "并非所有实现都采用相同的分层加载策略。"
      },
      {
        id: "claim-boundary",
        category: "boundary",
        text: "Skill 不等于任意外部工具连接，也不会自动消除权限风险。",
        importance: "critical",
        support: "supported",
        sourceIds: [paper.id, "source-third-official"],
        boundary: "工具和 Skill 可以组合使用。"
      },
      {
        id: "claim-product-impact",
        category: "product-impact",
        text: "Skill 会增加版本、权限和供应链治理需求。",
        importance: "critical",
        support: "supported",
        sourceIds: [specification.id, "source-third-official"],
        boundary: "治理强度取决于 Skill 的权限和分发范围。"
      },
      {
        id: "claim-comparison",
        category: "comparison",
        text: "MCP 侧重工具与数据连接，Skill 侧重过程知识组织。",
        importance: "supporting",
        support: "supported",
        sourceIds: [specification.id],
        boundary: "两者不是互斥方案。"
      },
      {
        id: "claim-product-decision",
        category: "product-decision",
        text: "团队需要先判断过程是否稳定、可复用且值得治理。",
        importance: "supporting",
        support: "supported",
        sourceIds: [paper.id],
        boundary: "低频探索任务不一定适合立即固化。"
      }
    ]
  };
}

test("热点正式候选可以创建尚无分镜的一期研究草稿", () => {
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const validation = validateEpisode(episode);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(episode.pipeline.find((step) => step.id === "research").status, "ready");
  assert.equal(episode.scenes.length, 0);
});

test("研究计划严格分离创作者热度信号和一手事实来源", async () => {
  const config = await readResearchConfig();
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const pack = buildResearchPlan({ episode, config, now: new Date(selectedAt) });
  assert.equal(pack.sources.length, 2);
  assert.equal(pack.sources.every((source) => source.provenance === "taxonomy-primary-source"), true);
  assert.equal(pack.marketContext.signals.length, 1);
  assert.equal(pack.sources.some((source) => source.url.includes("example.com/video")), false);
  assert.equal(pack.readiness.readyForFactApproval, false);
});

test("直接读取官方页面只记录可达性和哈希，不伪造事实主张", async () => {
  const config = await readResearchConfig();
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const pack = buildResearchPlan({ episode, config, now: new Date(selectedAt) });
  const inspection = await inspectPrimarySource(pack.sources[0], {
    config,
    now: new Date(selectedAt),
    fetchImpl: async () =>
      new Response("<html><head><title>Agent Skills Specification</title></head></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      })
  });
  assert.equal(inspection.access.status, "accessible");
  assert.equal(inspection.access.title, "Agent Skills Specification");
  assert.match(inspection.access.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(pack.claims.length, 0);
});

test("证据包只有达到来源、主张、交叉核验和关键类别门槛才可审批", async () => {
  const config = await readResearchConfig();
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const plan = buildResearchPlan({ episode, config, now: new Date(selectedAt) });
  const batch = evidenceBatch(plan);
  const validation = validateResearchEvidenceBatch(batch, config);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  const merged = mergeEvidenceBatch(plan, batch, config, new Date(batch.researchedAt));
  assert.equal(merged.readiness.readyForFactApproval, true);
  assert.equal(merged.readiness.verifiedSourceCount, 3);
  assert.equal(merged.readiness.supportedClaimCount, 6);
  assert.equal(merged.readiness.crossSourceClaimCount, 4);
  const step = researchStepAfterEvidenceImport(
    { id: "research", status: "blocked", requiresApproval: "research" },
    merged
  );
  assert.equal(step.status, "ready");
  assert.equal(step.requiresApproval, null);
});

test("创作者视频类型不能被伪装成研究证据来源", async () => {
  const config = await readResearchConfig();
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const plan = buildResearchPlan({ episode, config, now: new Date(selectedAt) });
  const batch = evidenceBatch(plan);
  batch.sources[0].sourceType = "creator-video";
  const validation = validateResearchEvidenceBatch(batch, config);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("; "), /unsupported sourceType/u);
});
