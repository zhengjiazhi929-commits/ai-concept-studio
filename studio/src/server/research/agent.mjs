import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { workspaceRoot } from "../../shared/paths.mjs";
import { canonicalJsonDocumentContentSha256 } from "../../shared/durable-json-store.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
import { requireSideEffectGrant } from "../security/side-effect-capability.mjs";
import {
  latestReviewFeedback,
  resetApprovalForVersion
} from "../../shared/workflow.mjs";
import {
  buildResearchAssistTask,
  buildResearchPlan,
  mergeEvidenceBatch,
  mergeSourceInspections,
  reconcileResearchPack
} from "./engine.mjs";
import { inspectPrimarySource } from "./fetcher.mjs";
import { validateResearchEvidenceBatch } from "./schema.mjs";
import {
  readLatestResearchPack,
  readResearchPackAtPath,
  readResearchAssistTask,
  readResearchConfig,
  readTrendSelection,
  publishResearchPackRevision,
  writeResearchAssistTask,
  writeResearchEvidenceBatch,
  writeResearchPack,
  writeResearchPackRevision
} from "./store.mjs";

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => consume()));
  return results;
}

async function fileRecord(path) {
  const [body, details] = await Promise.all([readFile(path), stat(path)]);
  return {
    path: relative(workspaceRoot, path).replaceAll("\\", "/"),
    bytes: details.size,
    sha256: createHash("sha256").update(body).digest("hex")
  };
}

function requireResearchSideEffects(options, fullyInjected, operation, scopes) {
  // Test-only seam: every side-effect dependency must be injected, and an
  // explicit capability requirement always wins. Default/HTTP paths cannot
  // enter this branch because at least one production dependency remains.
  if (fullyInjected && options.requireSideEffectCapability !== true) return null;
  return requireSideEffectGrant(options, {
    episodeId: options.episodeId ?? "studio",
    operation: options.capabilityOperation ?? operation,
    scopes,
    maxCalls: 0,
    maxCostUsd: 0
  });
}

function researchRunDependencies(options = {}) {
  const injected = options.dependencies ?? {};
  const required = [
    "fileRecord",
    "readLatestResearchPack",
    "readResearchPackAtPath",
    "readResearchConfig",
    "writeResearchAssistTask",
    "writeResearchPack"
  ];
  return {
    values: {
      fileRecord: injected.fileRecord ?? fileRecord,
      inspectPrimarySource: injected.inspectPrimarySource ?? inspectPrimarySource,
      readLatestResearchPack:
        injected.readLatestResearchPack ?? readLatestResearchPack,
      readResearchPackAtPath:
        injected.readResearchPackAtPath ?? readResearchPackAtPath,
      readResearchConfig: injected.readResearchConfig ?? readResearchConfig,
      writeResearchAssistTask:
        injected.writeResearchAssistTask ?? writeResearchAssistTask,
      writeResearchPack: injected.writeResearchPack ?? writeResearchPack
    },
    fullyInjected: required.every((name) => typeof injected[name] === "function") &&
      (
        typeof injected.inspectPrimarySource === "function" ||
        typeof options.fetchImpl === "function"
      )
  };
}

function researchImportDependencies(options = {}) {
  const injected = options.dependencies ?? {};
  const defaults = {
    appendEvent,
    fileRecord,
    readEpisode,
    readLatestResearchPack,
    readResearchPackAtPath,
    readResearchConfig,
    publishResearchPackRevision,
    writeEpisode,
    writeResearchEvidenceBatch,
    writeResearchPackRevision
  };
  const names = Object.keys(defaults);
  return {
    values: Object.fromEntries(
      names.map((name) => [name, injected[name] ?? defaults[name]])
    ),
    fullyInjected: names.every((name) => typeof injected[name] === "function")
  };
}

function mergeSourceDocs(current, additions) {
  const records = new Map((current ?? []).map((item) => [item.path, item]));
  for (const item of additions) records.set(item.path, item);
  return Array.from(records.values());
}

function researchBoundaryError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

export function assertResearchPackEpisode(pack, expectedEpisodeId, operation = "使用") {
  if (pack == null) return pack;
  if (pack?.episodeId !== expectedEpisodeId) {
    throw researchBoundaryError(
      `研究证据包属于 ${pack?.episodeId ?? "未知 Episode"}，不能为 ${expectedEpisodeId} 执行${operation}`,
      "research_pack_episode_mismatch"
    );
  }
  return pack;
}

function assertLoadedEpisode(episode, expectedEpisodeId) {
  if (episode?.id !== expectedEpisodeId) {
    throw researchBoundaryError(
      `读取到的 Episode ${episode?.id ?? "未知"} 与请求的 ${expectedEpisodeId} 不一致`,
      "research_episode_mismatch"
    );
  }
  return episode;
}

function researchImportEvent({ batch, pack, ready, publication }) {
  return {
    type: "research.evidence-imported",
    episodeId: batch.episodeId,
    agentId: "research-agent",
    idempotencyKey: `research-evidence-import:${batch.episodeId}:${batch.batchId}`,
    status: publication.status === "pending" ? "warning" : ready ? "ready" : "blocked",
    message: ready
      ? `研究证据达到机器审核门槛：${pack.readiness.verifiedSourceCount} 份来源${publication.status === "pending" ? "；最新指针待恢复" : ""}`
      : `研究证据已导入，但仍有 ${pack.readiness.reasons.length} 项缺口${publication.status === "pending" ? "；最新指针待恢复" : ""}`
  };
}

async function appendResearchImportAudit(dependencies, context) {
  try {
    const record = await dependencies.appendEvent(researchImportEvent(context));
    return {
      status: "committed",
      errorCode: null,
      eventId: record?.eventId ?? null
    };
  } catch (error) {
    // Episode CAS is already committed. An unavailable audit sink must remain
    // visible to the caller, but it must not turn the committed import into a
    // failed request that encourages a duplicate Episode write.
    return {
      status: "pending",
      errorCode: error?.code ?? "research_import_audit_failed",
      eventId: null
    };
  }
}

function researchImportCommitStatus(publication, audit, idempotent = false) {
  if (publication.status === "pending" || audit.status === "pending") {
    return "committed_with_warning";
  }
  return idempotent ? "already_committed" : "committed";
}

async function publishResearchRevision(dependencies, pack, runPath) {
  try {
    await dependencies.publishResearchPackRevision(pack, runPath);
    return { status: "published", errorCode: null };
  } catch (error) {
    // The Episode already references the immutable revision and remains the
    // source of truth. Pointer publication is derived state and may be retried
    // by a later write without rolling back or duplicating the evidence import.
    return {
      status: "pending",
      errorCode: error?.code ?? "research_pack_publication_failed"
    };
  }
}

function findImportedBatch(pack, batchId) {
  return (pack?.imports ?? []).find((item) => item.batchId === batchId) ?? null;
}

function importedBatchPaths(episode, batchId) {
  const versions = episode.research?.versions ?? [];
  const version = versions.findLast?.((item) => item.batchId === batchId)
    ?? (episode.research?.lastImportedBatch === batchId ? versions.at(-1) : null);
  return {
    batchPath: version?.batchPath ? resolve(workspaceRoot, version.batchPath) : null,
    runPath: resolve(workspaceRoot, version?.packPath ?? episode.research.packPath)
  };
}

export function researchStepAfterEvidenceImport(step, pack) {
  const ready = pack.readiness.readyForFactApproval;
  return {
    ...step,
    status: ready ? "ready" : "blocked",
    message: ready
      ? "证据包达到门槛，可以由研究 Agent 提交机器审核"
      : `证据仍不足：${pack.readiness.reasons.join("；")}`,
    findings: pack.readiness.reasons,
    requiresApproval: null
  };
}

export async function runEpisodeResearchAgent(episode, options = {}) {
  const { values: dependencies, fullyInjected } = researchRunDependencies(options);
  requireResearchSideEffects(
    { ...options, episodeId: episode.id },
    fullyInjected,
    "research:run",
    ["filesystem.write", "network.request"]
  );
  const config = await dependencies.readResearchConfig();
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const fresh = buildResearchPlan({ episode, config, now });
  const current = assertResearchPackEpisode(episode.research?.packPath
    ? await dependencies.readResearchPackAtPath(episode.research.packPath)
    : await dependencies.readLatestResearchPack(episode.id), episode.id, "研究规划");
  let pack = reconcileResearchPack(current, fresh, config);
  const inspections = await mapWithConcurrency(
    pack.sources,
    config.maxConcurrency,
    (source) =>
      dependencies.inspectPrimarySource(source, {
        config,
        now,
        fetchImpl: options.fetchImpl,
        lookupImpl: options.lookupImpl
      })
  );
  pack = mergeSourceInspections(pack, inspections, config, now);
  const reviewFeedback =
    (Array.isArray(options.reviewFeedback) && options.reviewFeedback.length > 0)
      ? structuredClone(options.reviewFeedback)
      : (typeof options.reviewFeedback === "string" && options.reviewFeedback.trim())
        ? options.reviewFeedback.trim()
        : latestReviewFeedback(episode, "research");
  const assistTask = {
    ...buildResearchAssistTask(pack, config, now),
    reviewFeedback: reviewFeedback || null
  };
  const runPath = await dependencies.writeResearchPack(pack);
  const assistTaskPath = await dependencies.writeResearchAssistTask(assistTask);
  return {
    pack,
    assistTask,
    runPath,
    assistTaskPath,
    sourceDocs: await Promise.all([
      dependencies.fileRecord(runPath),
      dependencies.fileRecord(assistTaskPath)
    ])
  };
}

export async function importResearchEvidenceBatch(batch, options = {}) {
  const { values: dependencies, fullyInjected } = researchImportDependencies(options);
  requireResearchSideEffects(
    { ...options, episodeId: batch?.episodeId ?? "studio" },
    fullyInjected,
    "research:import-evidence",
    ["state.write", "filesystem.write"]
  );
  const config = await dependencies.readResearchConfig();
  const validation = validateResearchEvidenceBatch(batch, config);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  // Episode CAS is the authoritative commit. Read it before deriving the next
  // pack so a concurrent writer cannot make a failed import look published.
  const episode = assertLoadedEpisode(
    await dependencies.readEpisode(batch.episodeId),
    batch.episodeId
  );
  const current = assertResearchPackEpisode(episode.research?.packPath
    ? await dependencies.readResearchPackAtPath(episode.research.packPath)
    : await dependencies.readLatestResearchPack(batch.episodeId), batch.episodeId, "证据导入");
  if (!current) throw new Error(`还没有 ${batch.episodeId} 的研究计划，请先运行研究 Agent`);
  const batchSha256 = canonicalJsonDocumentContentSha256(batch);
  const priorImport = findImportedBatch(current, batch.batchId);
  if (priorImport?.batchSha256 && priorImport.batchSha256 !== batchSha256) {
    throw researchBoundaryError(
      `研究批次 ${batch.batchId} 已用于不同内容，不能复用 batchId`,
      "research_batch_id_conflict"
    );
  }
  if (priorImport?.batchSha256 === batchSha256) {
    const paths = importedBatchPaths(episode, batch.batchId);
    const publication = await publishResearchRevision(dependencies, current, paths.runPath);
    const ready = current.readiness.readyForFactApproval;
    const audit = await appendResearchImportAudit(dependencies, {
      batch,
      pack: current,
      ready,
      publication
    });
    return {
      pack: current,
      episode,
      batchPath: paths.batchPath,
      runPath: paths.runPath,
      publication,
      audit,
      commitStatus: researchImportCommitStatus(publication, audit, true),
      idempotent: true
    };
  }
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const pack = mergeEvidenceBatch(current, batch, config, now);
  const importedBatch = findImportedBatch(pack, batch.batchId);
  if (importedBatch) importedBatch.batchSha256 = batchSha256;
  const batchPath = await dependencies.writeResearchEvidenceBatch(batch);
  // Materialize immutable inputs before the CAS, but do not advance any latest
  // pointer. A losing CAS may leave an orphan revision, never a published one.
  const runPath = await dependencies.writeResearchPackRevision(pack);
  const [batchRecord, packRecord] = await Promise.all([
    dependencies.fileRecord(batchPath),
    dependencies.fileRecord(runPath)
  ]);

  const stepIndex = episode.pipeline.findIndex((step) => step.agent === "research-agent");
  if (stepIndex < 0) throw new Error("这一期缺少研究 Agent 流水线步骤");
  const ready = pack.readiness.readyForFactApproval;
  const version = (episode.research?.version ?? 0) + 1;
  episode.pipeline[stepIndex] = {
    ...researchStepAfterEvidenceImport(episode.pipeline[stepIndex], pack),
    artifacts: [packRecord.path, batchRecord.path],
    lastRunAt: now.toISOString()
  };
  episode.research = {
    status: pack.status,
    version,
    versions: [
      ...(episode.research?.versions ?? []),
      {
        version,
        packPath: packRecord.path,
        batchPath: batchRecord.path,
        batchId: batch.batchId,
        batchSha256,
        at: now.toISOString()
      }
    ],
    packPath: packRecord.path,
    assistTaskPath: episode.research?.assistTaskPath ?? null,
    lastImportedBatch: batch.batchId,
    readiness: pack.readiness,
    needsRevision: false
  };
  episode.approvals.research = resetApprovalForVersion(episode.approvals.research, version);
  episode.sourceDocs = mergeSourceDocs(episode.sourceDocs, [packRecord, batchRecord]);
  episode.updatedAt = now.toISOString();
  episode.history.push({
    at: now.toISOString(),
    type: "research-evidence-import",
    message: `导入 ${batch.sources.length} 份来源和 ${batch.claims.length} 条主张`
  });
  await dependencies.writeEpisode(episode);

  const publication = await publishResearchRevision(dependencies, pack, runPath);
  const audit = await appendResearchImportAudit(dependencies, {
    batch,
    pack,
    ready,
    publication
  });
  return {
    pack,
    episode,
    batchPath,
    runPath,
    publication,
    audit,
    commitStatus: researchImportCommitStatus(publication, audit),
    idempotent: false
  };
}

function researchStateDependencies(options = {}) {
  const injected = options.dependencies ?? {};
  return {
    readEpisode: injected.readEpisode ?? readEpisode,
    readLatestResearchPack:
      injected.readLatestResearchPack ?? readLatestResearchPack,
    readResearchAssistTask:
      injected.readResearchAssistTask ?? readResearchAssistTask,
    readResearchPackAtPath:
      injected.readResearchPackAtPath ?? readResearchPackAtPath,
    readTrendSelection: injected.readTrendSelection ?? readTrendSelection
  };
}

export async function getResearchState(options = {}) {
  const dependencies = researchStateDependencies(options);
  const selection = await dependencies.readTrendSelection();
  let episode = null;
  if (selection?.episodeId) {
    try {
      episode = assertLoadedEpisode(
        await dependencies.readEpisode(selection.episodeId),
        selection.episodeId
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const [pack, assistTask] = await Promise.all([
    episode?.research?.packPath
      ? dependencies.readResearchPackAtPath(episode.research.packPath)
      : episode
        ? dependencies.readLatestResearchPack(selection.episodeId)
        : Promise.resolve(null),
    dependencies.readResearchAssistTask()
  ]);
  return {
    selection,
    pack: assertResearchPackEpisode(pack, episode?.id, "状态展示"),
    assistTask: assistTask?.episodeId === selection?.episodeId ? assistTask : null,
    episode: episode
      ? {
          id: episode.id,
          title: episode.title,
          status: episode.status,
          research: episode.research,
          researchApproval: episode.approvals.research
        }
      : null
  };
}

export function researchPatch(episode, result) {
  const packRecord = result.sourceDocs[0];
  const assistRecord = result.sourceDocs[1];
  const version = (episode.research?.version ?? 0) + 1;
  return {
    research: {
      status: result.pack.status,
      version,
      versions: [
        ...(episode.research?.versions ?? []),
        { version, packPath: packRecord.path, assistTaskPath: assistRecord.path, at: new Date().toISOString() }
      ],
      packPath: packRecord.path,
      assistTaskPath: assistRecord.path,
      readiness: result.pack.readiness,
      needsRevision: false
    },
    approvals: {
      research: resetApprovalForVersion(episode.approvals.research, version)
    },
    sourceDocs: mergeSourceDocs(episode.sourceDocs, result.sourceDocs)
  };
}
