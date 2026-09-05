import test from "node:test";
import assert from "node:assert/strict";
import { validateEpisode } from "../src/shared/schema.mjs";
import { buildEpisodeFromTrendSelection } from "../src/server/research/episode.mjs";
import {
  buildResearchPlan,
  mergeEvidenceBatch
} from "../src/server/research/engine.mjs";
import { inspectPrimarySource } from "../src/server/research/fetcher.mjs";
import {
  getResearchState,
  importResearchEvidenceBatch,
  researchStepAfterEvidenceImport,
  runEpisodeResearchAgent
} from "../src/server/research/agent.mjs";
import { validateResearchEvidenceBatch } from "../src/server/research/schema.mjs";
import { readResearchConfig } from "../src/server/research/store.mjs";

const selectedAt = "2026-08-03T10:00:00.000Z";
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

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

function researchImportDependencies({ episode, pack, writeEpisode, publishPack, events = [] }) {
  return {
    appendEvent: async (event) => {
      events.push(event);
    },
    fileRecord: async (path) => ({
      path: path === "/virtual/research-batch.json"
        ? "studio/data/research/inbox/research-agent-skill-20260803.json"
        : "studio/data/research/runs/research-import-revision.json",
      bytes: 128,
      sha256: "a".repeat(64)
    }),
    readEpisode: async () => structuredClone(episode),
    readLatestResearchPack: async () => structuredClone(pack),
    readResearchPackAtPath: async () => structuredClone(pack),
    readResearchConfig,
    publishResearchPackRevision: publishPack,
    writeEpisode,
    writeResearchEvidenceBatch: async () => "/virtual/research-batch.json",
    writeResearchPackRevision: async () => "/virtual/research-pack.json"
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
    lookupImpl: publicLookup,
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

test("研究抓取在请求前拒绝私网 IP 与解析到私网的域名", async () => {
  const config = await readResearchConfig();
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    throw new Error("unsafe request should not execute");
  };
  const direct = await inspectPrimarySource(
    { id: "direct-private", url: "https://127.0.0.1/admin" },
    { config, now: new Date(selectedAt), fetchImpl, lookupImpl: publicLookup }
  );
  const resolved = await inspectPrimarySource(
    { id: "dns-private", url: "https://research.example.org/spec" },
    {
      config,
      now: new Date(selectedAt),
      fetchImpl,
      lookupImpl: async () => [{ address: "10.10.0.8", family: 4 }]
    }
  );

  assert.equal(direct.access.status, "needs_assist");
  assert.equal(direct.access.reason, "unsafe-network-target");
  assert.equal(resolved.access.status, "needs_assist");
  assert.equal(resolved.access.reason, "unsafe-network-target");
  assert.equal(requests, 0);
});

test("研究抓取逐跳校验重定向，不能跳到云元数据地址", async () => {
  const config = await readResearchConfig();
  let requests = 0;
  const inspection = await inspectPrimarySource(
    { id: "redirect-private", url: "https://research.example.org/spec" },
    {
      config,
      now: new Date(selectedAt),
      lookupImpl: publicLookup,
      fetchImpl: async (_url, init) => {
        requests += 1;
        assert.equal(init.redirect, "manual");
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" }
        });
      }
    }
  );

  assert.equal(inspection.access.status, "needs_assist");
  assert.equal(inspection.access.reason, "unsafe-network-target");
  assert.equal(requests, 1);
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

test("Episode CAS 冲突的研究导入不会发布 loser pack", async () => {
  const config = await readResearchConfig();
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const current = buildResearchPlan({ episode, config, now: new Date(selectedAt) });
  episode.research.packPath = "studio/data/research/runs/current-pack.json";
  let publications = 0;
  let episodeWrites = 0;
  const conflict = new Error("injected episode CAS conflict");
  conflict.code = "state_version_conflict";
  conflict.statusCode = 409;

  await assert.rejects(
    importResearchEvidenceBatch(evidenceBatch(current), {
      dependencies: researchImportDependencies({
        episode,
        pack: current,
        writeEpisode: async () => {
          episodeWrites += 1;
          throw conflict;
        },
        publishPack: async () => {
          publications += 1;
        }
      })
    }),
    (error) => error === conflict
  );
  assert.equal(episodeWrites, 1);
  assert.equal(publications, 0);
});

test("Episode 已提交但 research latest 发布失败时返回待恢复且不回滚真源", async () => {
  const config = await readResearchConfig();
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const current = buildResearchPlan({ episode, config, now: new Date(selectedAt) });
  episode.research.packPath = "studio/data/research/runs/current-pack.json";
  let committedEpisode = null;
  const events = [];
  const publicationError = new Error("injected research pointer failure");
  publicationError.code = "research_pointer_io_failed";

  const result = await importResearchEvidenceBatch(evidenceBatch(current), {
    dependencies: researchImportDependencies({
      episode,
      pack: current,
      events,
      writeEpisode: async (nextEpisode) => {
        committedEpisode = structuredClone(nextEpisode);
      },
      publishPack: async () => {
        throw publicationError;
      }
    })
  });

  assert.equal(result.publication.status, "pending");
  assert.equal(result.publication.errorCode, "research_pointer_io_failed");
  assert.equal(result.audit.status, "committed");
  assert.equal(result.commitStatus, "committed_with_warning");
  assert.equal(
    committedEpisode.research.packPath,
    "studio/data/research/runs/research-import-revision.json"
  );
  assert.equal(result.episode.research.packPath, committedEpisode.research.packPath);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, "warning");
  assert.equal(
    events[0].idempotencyKey,
    `research-evidence-import:${episode.id}:${evidenceBatch(current).batchId}`
  );
});

test("Episode 已提交后审计失败返回 pending，重试同 batch 不重复写 Episode", async () => {
  const config = await readResearchConfig();
  const sourceEpisode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const current = buildResearchPlan({
    episode: sourceEpisode,
    config,
    now: new Date(selectedAt)
  });
  sourceEpisode.research.packPath = "studio/data/research/runs/current-pack.json";
  const batch = evidenceBatch(current);
  let episodeWrites = 0;
  const auditError = new Error("injected audit sink failure");
  auditError.code = "audit_sink_unavailable";

  const firstDependencies = researchImportDependencies({
    episode: sourceEpisode,
    pack: current,
    writeEpisode: async () => {
      episodeWrites += 1;
    },
    publishPack: async () => undefined
  });
  firstDependencies.appendEvent = async () => {
    throw auditError;
  };
  const first = await importResearchEvidenceBatch(batch, {
    dependencies: firstDependencies
  });

  assert.equal(episodeWrites, 1);
  assert.equal(first.audit.status, "pending");
  assert.equal(first.audit.errorCode, "audit_sink_unavailable");
  assert.equal(first.commitStatus, "committed_with_warning");
  assert.equal(first.idempotent, false);

  const retryEvents = [];
  const retry = await importResearchEvidenceBatch(batch, {
    dependencies: researchImportDependencies({
      episode: first.episode,
      pack: first.pack,
      events: retryEvents,
      writeEpisode: async () => {
        episodeWrites += 1;
      },
      publishPack: async () => undefined
    })
  });

  assert.equal(episodeWrites, 1);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.commitStatus, "already_committed");
  assert.equal(retry.audit.status, "committed");
  assert.equal(retryEvents.length, 1);
  assert.equal(
    retryEvents[0].idempotencyKey,
    `research-evidence-import:${sourceEpisode.id}:${batch.batchId}`
  );
});

test("research batch 幂等哈希忽略对象键顺序但保留数组顺序", async () => {
  const config = await readResearchConfig();
  const sourceEpisode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const current = buildResearchPlan({
    episode: sourceEpisode,
    config,
    now: new Date(selectedAt)
  });
  sourceEpisode.research.packPath = "studio/data/research/runs/current-pack.json";
  const batch = evidenceBatch(current);
  let episodeWrites = 0;
  const first = await importResearchEvidenceBatch(batch, {
    dependencies: researchImportDependencies({
      episode: sourceEpisode,
      pack: current,
      writeEpisode: async () => {
        episodeWrites += 1;
      },
      publishPack: async () => undefined
    })
  });

  const reordered = Object.fromEntries(Object.entries(batch).reverse());
  reordered.sources = batch.sources.map((source) =>
    Object.fromEntries(Object.entries(source).reverse())
  );
  reordered.claims = batch.claims.map((claim) =>
    Object.fromEntries(Object.entries(claim).reverse())
  );
  const retry = await importResearchEvidenceBatch(reordered, {
    dependencies: researchImportDependencies({
      episode: first.episode,
      pack: first.pack,
      writeEpisode: async () => {
        throw new Error("key reordering must not write Episode again");
      },
      publishPack: async () => undefined
    })
  });

  assert.equal(episodeWrites, 1);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.commitStatus, "already_committed");

  const reorderedArray = structuredClone(batch);
  reorderedArray.claims[0].sourceIds.reverse();
  await assert.rejects(
    importResearchEvidenceBatch(reorderedArray, {
      dependencies: researchImportDependencies({
        episode: first.episode,
        pack: first.pack,
        writeEpisode: async () => {
          throw new Error("array reordering conflict must not write Episode");
        },
        publishPack: async () => undefined
      })
    }),
    (error) => error?.code === "research_batch_id_conflict" && error?.statusCode === 409
  );
});

test("同一 research batchId 不能复用为不同内容", async () => {
  const config = await readResearchConfig();
  const sourceEpisode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const current = buildResearchPlan({
    episode: sourceEpisode,
    config,
    now: new Date(selectedAt)
  });
  sourceEpisode.research.packPath = "studio/data/research/runs/current-pack.json";
  const first = await importResearchEvidenceBatch(evidenceBatch(current), {
    dependencies: researchImportDependencies({
      episode: sourceEpisode,
      pack: current,
      writeEpisode: async () => undefined,
      publishPack: async () => undefined
    })
  });
  const changed = evidenceBatch(current);
  changed.claims[0].text = "不同的内容不允许沿用同一 batchId。";

  await assert.rejects(
    importResearchEvidenceBatch(changed, {
      dependencies: researchImportDependencies({
        episode: first.episode,
        pack: first.pack,
        writeEpisode: async () => {
          throw new Error("conflicting batch must not write Episode");
        },
        publishPack: async () => undefined
      })
    }),
    (error) => error?.code === "research_batch_id_conflict" && error?.statusCode === 409
  );
});

test("Research Agent 以 Episode 引用的 pack 为真源而不跟随 orphan latest", async () => {
  const config = await readResearchConfig();
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const authoritative = buildResearchPlan({ episode, config, now: new Date(selectedAt) });
  episode.research.packPath = "studio/data/research/runs/authoritative-pack.json";
  let pathReads = 0;
  let latestReads = 0;

  await runEpisodeResearchAgent(episode, {
    now: new Date(selectedAt),
    dependencies: {
      fileRecord: async (path) => ({
        path,
        bytes: 1,
        sha256: "b".repeat(64)
      }),
      inspectPrimarySource: async (source) => ({
        sourceId: source.id,
        access: {
          status: "accessible",
          checkedAt: selectedAt,
          httpStatus: 200,
          contentType: "text/html",
          bytes: 1,
          sha256: "c".repeat(64),
          title: source.label,
          reason: null
        }
      }),
      readLatestResearchPack: async () => {
        latestReads += 1;
        throw new Error("orphan latest must not be read");
      },
      readResearchPackAtPath: async (path) => {
        pathReads += 1;
        assert.equal(path, episode.research.packPath);
        return structuredClone(authoritative);
      },
      readResearchConfig: async () => config,
      writeResearchAssistTask: async () => "/virtual/research-assist.json",
      writeResearchPack: async () => "/virtual/research-pack.json"
    }
  });

  assert.equal(pathReads, 1);
  assert.equal(latestReads, 0);
});

test("Research Agent 在 reconcile 前拒绝其他 Episode 的 pack", async () => {
  const config = await readResearchConfig();
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const contaminated = buildResearchPlan({ episode, config, now: new Date(selectedAt) });
  contaminated.episodeId = "other-episode";
  contaminated.claims = [{
    id: "foreign-claim",
    text: "这条主张不能进入当前 Episode。",
    sourceIds: []
  }];
  episode.research.packPath = "studio/data/research/runs/foreign-pack.json";
  let inspections = 0;
  let writes = 0;

  await assert.rejects(
    runEpisodeResearchAgent(episode, {
      now: new Date(selectedAt),
      dependencies: {
        fileRecord: async () => ({ path: "unused", bytes: 1, sha256: "d".repeat(64) }),
        inspectPrimarySource: async () => {
          inspections += 1;
        },
        readLatestResearchPack: async () => null,
        readResearchPackAtPath: async () => structuredClone(contaminated),
        readResearchConfig: async () => config,
        writeResearchAssistTask: async () => {
          writes += 1;
        },
        writeResearchPack: async () => {
          writes += 1;
        }
      }
    }),
    (error) => error?.code === "research_pack_episode_mismatch" && error?.statusCode === 409
  );
  assert.equal(inspections, 0);
  assert.equal(writes, 0);
});

test("研究证据导入在写文件前拒绝其他 Episode 的 pack", async () => {
  const config = await readResearchConfig();
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const foreign = buildResearchPlan({ episode, config, now: new Date(selectedAt) });
  foreign.episodeId = "other-episode";
  episode.research.packPath = "studio/data/research/runs/foreign-pack.json";
  let artifactWrites = 0;
  const dependencies = researchImportDependencies({
    episode,
    pack: foreign,
    writeEpisode: async () => {
      throw new Error("foreign pack must not write Episode");
    },
    publishPack: async () => undefined
  });
  dependencies.writeResearchEvidenceBatch = async () => {
    artifactWrites += 1;
  };
  dependencies.writeResearchPackRevision = async () => {
    artifactWrites += 1;
  };

  await assert.rejects(
    importResearchEvidenceBatch(evidenceBatch(
      buildResearchPlan({ episode, config, now: new Date(selectedAt) })
    ), { dependencies }),
    (error) => error?.code === "research_pack_episode_mismatch" && error?.statusCode === 409
  );
  assert.equal(artifactWrites, 0);
});

test("研究状态展示拒绝 Episode 引用的跨 Episode pack", async () => {
  const config = await readResearchConfig();
  const episode = buildEpisodeFromTrendSelection(selectionFixture(), new Date(selectedAt));
  const foreign = buildResearchPlan({ episode, config, now: new Date(selectedAt) });
  foreign.episodeId = "other-episode";
  episode.research.packPath = "studio/data/research/runs/foreign-pack.json";

  await assert.rejects(
    getResearchState({
      dependencies: {
        readEpisode: async () => structuredClone(episode),
        readLatestResearchPack: async () => null,
        readResearchAssistTask: async () => null,
        readResearchPackAtPath: async () => structuredClone(foreign),
        readTrendSelection: async () => ({ episodeId: episode.id })
      }
    }),
    (error) => error?.code === "research_pack_episode_mismatch" && error?.statusCode === 409
  );
});
