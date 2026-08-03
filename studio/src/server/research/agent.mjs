import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { workspaceRoot } from "../../shared/paths.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
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
  readResearchAssistTask,
  readResearchConfig,
  readTrendSelection,
  writeResearchAssistTask,
  writeResearchEvidenceBatch,
  writeResearchPack
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

function mergeSourceDocs(current, additions) {
  const records = new Map((current ?? []).map((item) => [item.path, item]));
  for (const item of additions) records.set(item.path, item);
  return Array.from(records.values());
}

export async function runEpisodeResearchAgent(episode, options = {}) {
  const config = await readResearchConfig();
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const fresh = buildResearchPlan({ episode, config, now });
  const current = await readLatestResearchPack(episode.id);
  let pack = reconcileResearchPack(current, fresh, config);
  const inspections = await mapWithConcurrency(
    pack.sources,
    config.maxConcurrency,
    (source) =>
      inspectPrimarySource(source, {
        config,
        now,
        fetchImpl: options.fetchImpl ?? fetch
      })
  );
  pack = mergeSourceInspections(pack, inspections, config, now);
  const assistTask = buildResearchAssistTask(pack, config, now);
  const runPath = await writeResearchPack(pack);
  const assistTaskPath = await writeResearchAssistTask(assistTask);
  return {
    pack,
    assistTask,
    runPath,
    assistTaskPath,
    sourceDocs: await Promise.all([fileRecord(runPath), fileRecord(assistTaskPath)])
  };
}

export async function importResearchEvidenceBatch(batch, options = {}) {
  const config = await readResearchConfig();
  const validation = validateResearchEvidenceBatch(batch, config);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  const current = await readLatestResearchPack(batch.episodeId);
  if (!current) throw new Error(`还没有 ${batch.episodeId} 的研究计划，请先运行研究 Agent`);
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const pack = mergeEvidenceBatch(current, batch, config, now);
  const batchPath = await writeResearchEvidenceBatch(batch);
  const runPath = await writeResearchPack(pack);
  const [batchRecord, packRecord] = await Promise.all([
    fileRecord(batchPath),
    fileRecord(runPath)
  ]);

  const episode = await readEpisode(batch.episodeId);
  const stepIndex = episode.pipeline.findIndex((step) => step.agent === "research-agent");
  if (stepIndex < 0) throw new Error("这一期缺少研究 Agent 流水线步骤");
  const ready = pack.readiness.readyForFactApproval;
  episode.pipeline[stepIndex] = {
    ...episode.pipeline[stepIndex],
    status: ready ? "waiting_approval" : "blocked",
    message: ready
      ? "证据包达到门槛，等待人工批准关键事实"
      : `证据仍不足：${pack.readiness.reasons.join("；")}`,
    artifacts: [runPath, batchPath],
    findings: pack.readiness.reasons,
    requiresApproval: ready ? "facts" : null,
    lastRunAt: now.toISOString()
  };
  episode.research = {
    status: pack.status,
    packPath: packRecord.path,
    assistTaskPath: episode.research?.assistTaskPath ?? null,
    lastImportedBatch: batch.batchId,
    readiness: pack.readiness
  };
  episode.sourceDocs = mergeSourceDocs(episode.sourceDocs, [packRecord, batchRecord]);
  episode.updatedAt = now.toISOString();
  episode.history.push({
    at: now.toISOString(),
    type: "research-evidence-import",
    message: `导入 ${batch.sources.length} 份来源和 ${batch.claims.length} 条主张`
  });
  await writeEpisode(episode);
  await appendEvent({
    type: "research.evidence-imported",
    episodeId: batch.episodeId,
    agentId: "research-agent",
    status: ready ? "waiting_approval" : "blocked",
    message: ready
      ? `研究证据达到事实审批门槛：${pack.readiness.verifiedSourceCount} 份来源`
      : `研究证据已导入，但仍有 ${pack.readiness.reasons.length} 项缺口`
  });
  return { pack, episode, batchPath, runPath };
}

export async function getResearchState() {
  const selection = await readTrendSelection();
  const [pack, assistTask] = await Promise.all([
    selection?.episodeId ? readLatestResearchPack(selection.episodeId) : Promise.resolve(null),
    readResearchAssistTask()
  ]);
  let episode = null;
  if (selection?.episodeId) episode = await readEpisode(selection.episodeId).catch(() => null);
  return {
    selection,
    pack,
    assistTask: assistTask?.episodeId === selection?.episodeId ? assistTask : null,
    episode: episode
      ? {
          id: episode.id,
          title: episode.title,
          status: episode.status,
          research: episode.research,
          factsApproval: episode.approvals.facts
        }
      : null
  };
}

export function researchPatch(episode, result) {
  const packRecord = result.sourceDocs[0];
  const assistRecord = result.sourceDocs[1];
  return {
    research: {
      status: result.pack.status,
      packPath: packRecord.path,
      assistTaskPath: assistRecord.path,
      readiness: result.pack.readiness
    },
    sourceDocs: mergeSourceDocs(episode.sourceDocs, result.sourceDocs)
  };
}
