import { appendEvent } from "../../shared/store.mjs";
import { requireSideEffectGrant } from "../security/side-effect-capability.mjs";
import { runTrendRadarAgent } from "../trends/agent.mjs";
import {
  readConceptTaxonomy,
  readTrendSignals,
  readTrendSources,
  upsertTrendSignals
} from "../trends/store.mjs";
import { collectPublicSource } from "./adapters.mjs";
import { normalizeObservation } from "./normalizer.mjs";
import { validateAssistedBatch } from "./schema.mjs";
import {
  readCollectorAssistTask,
  readCollectorConfig,
  readCollectorSourceHealth,
  readLatestCollectorRun,
  updateCollectorSourceHealth,
  writeCollectorAssistTask,
  writeCollectorRun
} from "./store.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

const collectorSideEffectDependencyNames = Object.freeze([
  "appendEvent",
  "collectPublicSource",
  "readCollectorConfig",
  "readCollectorSourceHealth",
  "readConceptTaxonomy",
  "readTrendSignals",
  "readTrendSources",
  "runTrendRadarAgent",
  "updateCollectorSourceHealth",
  "upsertTrendSignals",
  "writeCollectorAssistTask",
  "writeCollectorRun"
]);

function collectorDependencies(options = {}) {
  const injected = options.dependencies ?? {};
  const defaults = {
    appendEvent,
    collectPublicSource,
    readCollectorConfig,
    readCollectorSourceHealth,
    readConceptTaxonomy,
    readTrendSignals,
    readTrendSources,
    runTrendRadarAgent,
    updateCollectorSourceHealth,
    upsertTrendSignals,
    writeCollectorAssistTask,
    writeCollectorRun
  };
  return {
    values: Object.fromEntries(
      collectorSideEffectDependencyNames.map((name) => [
        name,
        injected[name] ?? defaults[name]
      ])
    ),
    fullyInjected: collectorSideEffectDependencyNames.every(
      (name) => typeof injected[name] === "function"
    )
  };
}

function requireCollectorSideEffects(options, fullyInjected, operation, scopes) {
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

function buildRunId(prefix, time) {
  return `${prefix}-${time.toISOString().replaceAll(/[:.]/gu, "-")}`;
}

function summarizeNormalization(normalized) {
  return {
    accepted: normalized.filter((item) => item.status === "accepted").length,
    pendingReview: normalized.filter((item) => item.status === "pending_review").length,
    ignored: normalized.filter((item) => item.status === "ignored").length
  };
}

async function refreshRadarIfNeeded(
  enabled,
  acceptedCount,
  sideEffectGrant,
  options,
  dependencies,
  defaultOperation
) {
  if (!enabled || acceptedCount === 0) return { status: "skipped" };
  try {
    const result = await dependencies.runTrendRadarAgent({
      sideEffectGrant: sideEffectGrant ?? undefined,
      requireSideEffectCapability: Boolean(sideEffectGrant),
      capabilityOperation: options.capabilityOperation ?? defaultOperation,
      episodeId: options.episodeId ?? "studio"
    });
    return { status: "complete", runId: result.run.id };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "热点雷达刷新失败"
    };
  }
}

export async function runCollectorAgent(options = {}) {
  const { values: dependencies, fullyInjected } = collectorDependencies(options);
  const sideEffectGrant = requireCollectorSideEffects(
    options,
    fullyInjected,
    "collector:run",
    ["state.write", "filesystem.write", "network.request"]
  );
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const startedAt = now.toISOString();
  await dependencies.appendEvent({
    type: "agent.started",
    agentId: "creator-signal-collector",
    message: "创作者公开信号采集开始运行"
  });
  try {
    const [config, sources, taxonomy, existingSignals, previousHealth] = await Promise.all([
      dependencies.readCollectorConfig(),
      dependencies.readTrendSources(),
      dependencies.readConceptTaxonomy(),
      dependencies.readTrendSignals(),
      dependencies.readCollectorSourceHealth()
    ]);
    const enabledSources = sources.creators.filter((source) => source.enabled !== false);
    const sourceResults = await mapWithConcurrency(
      enabledSources,
      config.maxConcurrency,
      (source) =>
        dependencies.collectPublicSource(source, {
          config,
          now,
          fetchImpl: options.fetchImpl,
          lookupImpl: options.lookupImpl
        })
    );
    const batchId = buildRunId("collector-direct", now);
    const observations = sourceResults.flatMap((result) => result.observations ?? []);
    const normalized = observations.map((observation) =>
      normalizeObservation({ observation, taxonomy, config, batchId, observedAt: startedAt })
    );
    const acceptedSignals = normalized
      .filter((item) => item.status === "accepted")
      .map((item) => item.signal);
    const upsert = acceptedSignals.length
      ? await dependencies.upsertTrendSignals(acceptedSignals, { importTag: batchId })
      : { added: 0, updated: 0, unchanged: 0 };
    const previousHealthMap = new Map(
      previousHealth.sources.map((source) => [source.creatorId, source])
    );
    const healthEntries = sourceResults.map((result) => {
      const previous = previousHealthMap.get(result.creatorId);
      const degraded = result.status === "failed" && Boolean(previous?.lastSuccessAt);
      return {
        creatorId: result.creatorId,
        lastAttemptAt: startedAt,
        httpStatus: result.httpStatus ?? null,
        fetchedBytes: result.fetchedBytes ?? null,
        observationCount: result.observations?.length ?? 0,
        status:
          result.status === "success"
            ? "success"
            : result.status === "assisted_required"
              ? "needs_assist"
              : degraded
                ? "degraded"
                : "failed",
        accessMode:
          result.status === "success" ? "direct" : previous?.accessMode || "codex_assisted",
        reason: result.reason ?? null,
        ...(result.status === "success" ? { lastSuccessAt: startedAt } : {})
      };
    });
    await dependencies.updateCollectorSourceHealth(healthEntries, startedAt);
    const latestSignalMap = new Map();
    for (const signal of existingSignals.signals) {
      const timestamp = signal.publishedAt || signal.observedAt;
      if (!latestSignalMap.has(signal.creatorId) || timestamp > latestSignalMap.get(signal.creatorId)) {
        latestSignalMap.set(signal.creatorId, timestamp);
      }
    }
    const sourceMap = new Map(enabledSources.map((source) => [source.id, source]));
    const assistedSources = sourceResults.filter((result) => result.status === "assisted_required");
    const assistTask = {
      schemaVersion: 1,
      taskId: `assist-${batchId}`,
      createdAt: startedAt,
      purpose: "使用 Codex 读取普通程序无法稳定提取的公开创作者作品列表",
      rules: [
        "只读取公开页面，不登录账号、不使用 Cookie。",
        "记录作品标题、来源链接和可核对的发布时间；没有互动数据就保持为空。",
        "竞品内容只作为热度信号，不作为技术事实来源。"
      ],
      tasks: assistedSources.map((result) => {
        const source = sourceMap.get(result.creatorId);
        const latestSignalAt = latestSignalMap.get(result.creatorId) ?? null;
        const fresh = latestSignalAt
          ? Date.parse(latestSignalAt) >= now.getTime() - config.sourceFreshnessDays * DAY_MS
          : false;
        return {
          creatorId: source.id,
          name: source.name,
          platform: source.platform,
          profileUrl: source.profileUrl,
          suggestedSearchQuery: `site:jingxuan.douyin.com/m/video \"${source.name}\" AI`,
          latestSignalAt,
          priority: fresh ? "normal" : "high"
        };
      }),
      outputTemplate: {
        schemaVersion: 1,
        batchId: `assisted-${startedAt.slice(0, 10).replaceAll("-", "")}`,
        observedAt: startedAt,
        method: "Codex 公开页面核对",
        observations: []
      }
    };
    await dependencies.writeCollectorAssistTask(assistTask);
    const normalizationSummary = summarizeNormalization(normalized);
    const radarRefresh = await refreshRadarIfNeeded(
      options.refreshRadar ?? config.refreshRadarAfterCollection,
      acceptedSignals.length,
      sideEffectGrant,
      options,
      dependencies,
      "collector:run"
    );
    const run = {
      schemaVersion: 1,
      id: batchId,
      agentId: "creator-signal-collector",
      mode: "direct-public-pages",
      status: "complete",
      startedAt,
      finishedAt: new Date().toISOString(),
      summary: {
        configuredSources: enabledSources.length,
        directSuccess: sourceResults.filter((result) => result.status === "success").length,
        assistedRequired: sourceResults.filter(
          (result) => result.status === "assisted_required"
        ).length,
        failed: sourceResults.filter((result) => result.status === "failed").length,
        observationsFound: observations.length,
        ...normalizationSummary,
        signalsAdded: upsert.added,
        signalsUpdated: upsert.updated,
        signalsUnchanged: upsert.unchanged
      },
      sourceResults: sourceResults.map((result) => ({
        creatorId: result.creatorId,
        status: result.status,
        reason: result.reason,
        httpStatus: result.httpStatus ?? null,
        observationCount: result.observations?.length ?? 0
      })),
      pendingReview: normalized
        .filter((item) => item.status === "pending_review")
        .map((item) => ({
          creatorId: item.observation.creatorId,
          title: item.observation.title,
          sourceUrl: item.observation.sourceUrl,
          reason: item.reason
        })),
      ignoredObservations: normalized
        .filter((item) => item.status === "ignored")
        .map((item) => ({
          creatorId: item.observation.creatorId,
          title: item.observation.title,
          sourceUrl: item.observation.sourceUrl,
          publishedAt: item.observation.publishedAt,
          reason: item.reason
        })),
      radarRefresh
    };
    const runPath = await dependencies.writeCollectorRun(run);
    await dependencies.appendEvent({
      type: "agent.finished",
      agentId: "creator-signal-collector",
      status: "complete",
      message: `创作者信号采集完成：${run.summary.directSuccess} 个直读，${run.summary.assistedRequired} 个需 Codex 辅助`
    });
    return { run, runPath };
  } catch (error) {
    await dependencies.appendEvent({
      type: "agent.failed",
      agentId: "creator-signal-collector",
      message: error instanceof Error ? error.message : "创作者信号采集失败"
    });
    throw error;
  }
}

export async function importAssistedCollectorBatch(batch, options = {}) {
  const { values: dependencies, fullyInjected } = collectorDependencies(options);
  const sideEffectGrant = requireCollectorSideEffects(
    options,
    fullyInjected,
    "collector:import-assisted-batch",
    ["state.write", "filesystem.write"]
  );
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const [config, sources, taxonomy] = await Promise.all([
    dependencies.readCollectorConfig(),
    dependencies.readTrendSources(),
    dependencies.readConceptTaxonomy()
  ]);
  const validation = validateAssistedBatch(
    batch,
    new Set(sources.creators.map((source) => source.id))
  );
  if (!validation.valid) throw new Error(validation.errors.join("; "));

  const normalized = batch.observations.map((observation) =>
    normalizeObservation({
      observation: {
        ...observation,
        sourceKind: observation.sourceKind || "collector-codex-assisted"
      },
      taxonomy,
      config,
      batchId: batch.batchId,
      observedAt: batch.observedAt
    })
  );
  const acceptedSignals = normalized
    .filter((item) => item.status === "accepted")
    .map((item) => item.signal);
  const upsert = acceptedSignals.length
    ? await dependencies.upsertTrendSignals(acceptedSignals, { importTag: batch.batchId })
    : { added: 0, updated: 0, unchanged: 0 };
  const creatorIds = Array.from(new Set(batch.observations.map((item) => item.creatorId)));
  await dependencies.updateCollectorSourceHealth(
    creatorIds.map((creatorId) => ({
      creatorId,
      lastAttemptAt: batch.observedAt,
      lastSuccessAt: batch.observedAt,
      lastAssistedAt: batch.observedAt,
      status: "success",
      accessMode: "codex_assisted",
      reason: null,
      observationCount: batch.observations.filter((item) => item.creatorId === creatorId).length
    })),
    batch.observedAt
  );
  const normalizationSummary = summarizeNormalization(normalized);
  const radarRefresh = await refreshRadarIfNeeded(
    options.refreshRadar ?? config.refreshRadarAfterCollection,
    acceptedSignals.length,
    sideEffectGrant,
    options,
    dependencies,
    "collector:import-assisted-batch"
  );
  const run = {
    schemaVersion: 1,
    id: batch.batchId,
    agentId: "creator-signal-collector",
    mode: "codex-assisted-import",
    method: batch.method || "公开页面人工或 Codex 核对",
    status: "complete",
    startedAt: batch.observedAt,
    finishedAt: now.toISOString(),
    summary: {
      configuredSources: creatorIds.length,
      directSuccess: 0,
      assistedRequired: 0,
      assistedSuccess: creatorIds.length,
      failed: 0,
      observationsFound: batch.observations.length,
      ...normalizationSummary,
      signalsAdded: upsert.added,
      signalsUpdated: upsert.updated,
      signalsUnchanged: upsert.unchanged
    },
    sourceResults: creatorIds.map((creatorId) => ({
      creatorId,
      status: "assisted_success",
      reason: null,
      observationCount: batch.observations.filter((item) => item.creatorId === creatorId).length
    })),
    pendingReview: normalized
      .filter((item) => item.status === "pending_review")
      .map((item) => ({
        creatorId: item.observation.creatorId,
        title: item.observation.title,
        sourceUrl: item.observation.sourceUrl,
        reason: item.reason
      })),
    ignoredObservations: normalized
      .filter((item) => item.status === "ignored")
      .map((item) => ({
        creatorId: item.observation.creatorId,
        title: item.observation.title,
        sourceUrl: item.observation.sourceUrl,
        publishedAt: item.observation.publishedAt,
        reason: item.reason
      })),
    radarRefresh
  };
  const runPath = await dependencies.writeCollectorRun(run);
  await dependencies.appendEvent({
    type: "collector.assisted-batch-imported",
    agentId: "creator-signal-collector",
    message: `Codex 辅助采集已导入：${batch.observations.length} 条观察`
  });
  return { run, runPath };
}

export async function getCollectorState(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const [config, sources, signals, latestRun, health, assistTask] = await Promise.all([
    readCollectorConfig(),
    readTrendSources(),
    readTrendSignals(),
    readLatestCollectorRun(),
    readCollectorSourceHealth(),
    readCollectorAssistTask()
  ]);
  const enabledSources = sources.creators.filter((source) => source.enabled !== false);
  const healthMap = new Map(health.sources.map((entry) => [entry.creatorId, entry]));
  const latestSignalMap = new Map();
  for (const signal of signals.signals) {
    const timestamp = signal.publishedAt || signal.observedAt;
    if (!latestSignalMap.has(signal.creatorId) || timestamp > latestSignalMap.get(signal.creatorId)) {
      latestSignalMap.set(signal.creatorId, timestamp);
    }
  }
  const cutoff = now.getTime() - config.sourceFreshnessDays * DAY_MS;
  const sourceStates = enabledSources.map((source) => {
    const sourceHealth = healthMap.get(source.id) ?? {};
    const latestSignalAt = latestSignalMap.get(source.id) ?? null;
    return {
      creatorId: source.id,
      name: source.name,
      platform: source.platform,
      latestSignalAt,
      fresh: latestSignalAt ? Date.parse(latestSignalAt) >= cutoff : false,
      status: sourceHealth.status ?? "never_checked",
      accessMode: sourceHealth.accessMode ?? null,
      reason: sourceHealth.reason ?? null,
      lastAttemptAt: sourceHealth.lastAttemptAt ?? null,
      lastSuccessAt: sourceHealth.lastSuccessAt ?? null
    };
  });
  return {
    latestRun,
    assistTask,
    summary: {
      configuredSources: enabledSources.length,
      freshSources: sourceStates.filter((source) => source.fresh).length,
      staleSources: sourceStates.filter((source) => !source.fresh).length,
      directSuccess: sourceStates.filter(
        (source) => source.status === "success" && source.accessMode === "direct"
      ).length,
      assistedSuccess: sourceStates.filter(
        (source) =>
          source.fresh && !(source.status === "success" && source.accessMode === "direct")
      ).length,
      needsAssist: sourceStates.filter(
        (source) => !source.fresh && source.status === "needs_assist"
      ).length,
      failed: sourceStates.filter((source) => source.status === "failed").length,
      degraded: sourceStates.filter((source) => source.status === "degraded").length
    },
    sources: sourceStates
  };
}
