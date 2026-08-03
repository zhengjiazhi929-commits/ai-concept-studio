import { createHash } from "node:crypto";

function stableSourceId(url) {
  return `source-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

function sourceTypeFor(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) return "paper";
  if (host === "github.com" || host.endsWith(".github.com")) return "official-repository";
  if (host.includes("benchmark") || path.includes("benchmark")) return "benchmark";
  if (path.includes("spec") || host.includes("standards")) return "standard";
  if (path.includes("blog") || path.includes("news") || path.includes("changelog")) {
    return "official-blog";
  }
  return "official-doc";
}

function plannedSource(source) {
  const url = new URL(source.url).toString();
  return {
    id: stableSourceId(url),
    label: source.label,
    url,
    publisher: new URL(url).hostname,
    sourceType: sourceTypeFor(url),
    provenance: "taxonomy-primary-source",
    evidenceStatus: "unreviewed",
    evidenceSummary: null,
    locator: null,
    contentHash: null,
    access: {
      status: "unchecked",
      checkedAt: null,
      httpStatus: null,
      contentType: null,
      bytes: null,
      sha256: null,
      title: null,
      reason: null
    }
  };
}

export function assessResearchPack(pack, config) {
  const verifiedSources = pack.sources.filter((source) => source.evidenceStatus === "verified");
  const primarySources = verifiedSources.filter((source) =>
    config.allowedSourceTypes.includes(source.sourceType)
  );
  const supportedClaims = pack.claims.filter((claim) => claim.support === "supported");
  const crossSourceClaims = supportedClaims.filter(
    (claim) => new Set(claim.sourceIds ?? []).size >= 2
  );
  const supportedCategories = new Set(supportedClaims.map((claim) => claim.category));
  const missingCriticalCategories = config.requiredClaimCategories
    .filter((requirement) => requirement.critical && !supportedCategories.has(requirement.id))
    .map((requirement) => requirement.id);
  const unsupportedCriticalClaims = pack.claims
    .filter((claim) => claim.importance === "critical" && claim.support !== "supported")
    .map((claim) => claim.id);
  const reasons = [];
  if (verifiedSources.length < config.minimumSources) {
    reasons.push(`至少需要 ${config.minimumSources} 份已核验一手来源`);
  }
  if (primarySources.length < config.minimumPrimarySources) {
    reasons.push(`至少需要 ${config.minimumPrimarySources} 份官方、论文或基准来源`);
  }
  if (supportedClaims.length < config.minimumSupportedClaims) {
    reasons.push(`至少需要 ${config.minimumSupportedClaims} 条有来源支持的主张`);
  }
  if (crossSourceClaims.length < config.minimumCrossSourceClaims) {
    reasons.push(`至少需要 ${config.minimumCrossSourceClaims} 条跨来源交叉核验的主张`);
  }
  if (missingCriticalCategories.length > 0) {
    reasons.push(`关键问题尚未覆盖：${missingCriticalCategories.join("、")}`);
  }
  if (unsupportedCriticalClaims.length > 0) {
    reasons.push(`仍有关键主张未获支持：${unsupportedCriticalClaims.join("、")}`);
  }
  return {
    readyForFactApproval: reasons.length === 0,
    verifiedSourceCount: verifiedSources.length,
    primarySourceCount: primarySources.length,
    supportedClaimCount: supportedClaims.length,
    crossSourceClaimCount: crossSourceClaims.length,
    coveredCategoryCount: supportedCategories.size,
    requiredCategoryCount: config.requiredClaimCategories.length,
    missingCriticalCategories,
    unsupportedCriticalClaims,
    reasons
  };
}

export function buildResearchPlan({ episode, config, now = new Date() }) {
  const selection = episode.trendSelection;
  if (!selection) throw new Error("这一期没有热点选题来源，无法启动研究 Agent");
  const createdAt = now.toISOString();
  const pack = {
    schemaVersion: 1,
    id: `research-${episode.id}-${createdAt.replaceAll(/[:.]/gu, "-")}`,
    episodeId: episode.id,
    conceptId: episode.conceptId,
    concept: episode.concept,
    title: episode.title,
    status: "needs_evidence",
    createdAt,
    updatedAt: createdAt,
    selection: {
      runId: selection.runId,
      candidateId: selection.candidateId,
      selectedAt: selection.selectedAt,
      note: selection.note || ""
    },
    marketContext: {
      purpose: "只证明近期创作者正在讨论该概念，不作为技术事实来源",
      independentCreators: selection.creatorEvidence ?? [],
      signals: selection.evidenceSignals ?? []
    },
    productDecisions: selection.productDecisions ?? [],
    sources: (selection.primarySources ?? []).map(plannedSource),
    claimRequirements: config.requiredClaimCategories.map((requirement) => ({
      ...requirement,
      productPrompts:
        requirement.id === "product-decision" ? selection.productDecisions ?? [] : []
    })),
    claims: [],
    imports: [],
    readiness: null
  };
  pack.readiness = assessResearchPack(pack, config);
  return pack;
}

export function reconcileResearchPack(current, fresh, config) {
  if (!current) return fresh;
  const currentSources = new Map(current.sources.map((source) => [source.url, source]));
  const plannedUrls = new Set(fresh.sources.map((source) => source.url));
  const sources = fresh.sources.map((source) => ({
    ...source,
    ...(currentSources.get(source.url) ?? {})
  }));
  for (const source of current.sources) {
    if (!plannedUrls.has(source.url)) sources.push(source);
  }
  const pack = {
    ...fresh,
    createdAt: current.createdAt,
    sources,
    claims: current.claims ?? [],
    imports: current.imports ?? []
  };
  pack.readiness = assessResearchPack(pack, config);
  pack.status = pack.readiness.readyForFactApproval
    ? "ready_for_fact_approval"
    : "needs_evidence";
  return pack;
}

export function mergeSourceInspections(pack, inspections, config, now = new Date()) {
  const inspectionMap = new Map(inspections.map((inspection) => [inspection.sourceId, inspection]));
  const updated = {
    ...pack,
    updatedAt: now.toISOString(),
    sources: pack.sources.map((source) => {
      const inspection = inspectionMap.get(source.id);
      return inspection ? { ...source, access: inspection.access } : source;
    })
  };
  updated.readiness = assessResearchPack(updated, config);
  updated.status = updated.readiness.readyForFactApproval
    ? "ready_for_fact_approval"
    : "needs_evidence";
  return updated;
}

export function mergeEvidenceBatch(pack, batch, config, now = new Date()) {
  if (batch.episodeId !== pack.episodeId) {
    throw new Error(`证据批次属于 ${batch.episodeId}，不能写入 ${pack.episodeId}`);
  }
  const existingById = new Map(pack.sources.map((source) => [source.id, source]));
  const batchIds = new Set(batch.sources.map((source) => source.id));
  const sources = batch.sources.map((source) => {
    const existing = existingById.get(source.id);
    return {
      ...(existing ?? {
        provenance: "codex-assisted-source-expansion",
        access: {
          status: "unchecked",
          checkedAt: null,
          httpStatus: null,
          contentType: null,
          bytes: null,
          sha256: null,
          title: null,
          reason: null
        }
      }),
      ...source,
      evidenceStatus: "verified",
      verifiedAt: batch.researchedAt
    };
  });
  for (const source of pack.sources) {
    if (!batchIds.has(source.id)) sources.push(source);
  }
  const incomingClaimIds = new Set(batch.claims.map((claim) => claim.id));
  const claims = [
    ...batch.claims.map((claim) => ({ ...claim, importedFrom: batch.batchId })),
    ...pack.claims.filter((claim) => !incomingClaimIds.has(claim.id))
  ];
  const updated = {
    ...pack,
    updatedAt: now.toISOString(),
    sources,
    claims,
    imports: [
      ...(pack.imports ?? []).filter((item) => item.batchId !== batch.batchId),
      {
        batchId: batch.batchId,
        researchedAt: batch.researchedAt,
        method: batch.method || "Codex 辅助研究",
        sourceCount: batch.sources.length,
        claimCount: batch.claims.length
      }
    ]
  };
  updated.readiness = assessResearchPack(updated, config);
  updated.status = updated.readiness.readyForFactApproval
    ? "ready_for_fact_approval"
    : "needs_evidence";
  return updated;
}

export function buildResearchAssistTask(pack, config, now = new Date()) {
  return {
    schemaVersion: 1,
    taskId: `assist-${pack.id}`,
    episodeId: pack.episodeId,
    createdAt: now.toISOString(),
    purpose: `为“${pack.concept}”建立可人工审批的一手证据包`,
    rules: [
      "竞品视频只证明市场热度，不得作为技术事实来源。",
      "优先使用官方文档、官方工程博客、论文、标准、官方仓库和基准官网。",
      "每条主张必须列出来源、定位信息和适用边界；没有证据就标记 unsupported。",
      "不要大段复制原文，只记录核验结论、短定位信息和必要的边界说明。"
    ],
    sourceTasks: pack.sources.map((source) => ({
      id: source.id,
      label: source.label,
      url: source.url,
      sourceType: source.sourceType,
      accessStatus: source.access.status,
      action:
        source.access.status === "accessible"
          ? "阅读并提取可支持主张、定位与边界"
          : "使用浏览器或官方替代页面核验"
    })),
    claimQuestions: pack.claimRequirements,
    productDecisions: pack.productDecisions,
    completionGate: {
      minimumSources: config.minimumSources,
      minimumPrimarySources: config.minimumPrimarySources,
      minimumSupportedClaims: config.minimumSupportedClaims,
      minimumCrossSourceClaims: config.minimumCrossSourceClaims
    },
    outputTemplate: {
      schemaVersion: 1,
      batchId: `research-${pack.episodeId}-YYYYMMDD`,
      episodeId: pack.episodeId,
      researchedAt: now.toISOString(),
      method: "Codex 公开一手资料核验",
      sources: pack.sources.map((source) => ({
        id: source.id,
        label: source.label,
        url: source.url,
        publisher: source.publisher,
        sourceType: source.sourceType,
        evidenceSummary: "",
        locator: "",
        contentHash: null
      })),
      claims: []
    }
  };
}
