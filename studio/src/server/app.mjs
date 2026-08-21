import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureInside,
  publicRoot,
  studioOutputRoot,
  webRoot
} from "../shared/paths.mjs";
import {
  listEpisodes,
  readConfig,
  readEpisode,
  readRecentEvents
} from "../shared/store.mjs";
import { summarizePipeline } from "../shared/schema.mjs";
import { getCloudBackupStatus } from "../shared/cloud-backup.mjs";
import { getAiStatus, setPrimaryProvider } from "../shared/ai-config.mjs";
import { importGoldenSample } from "./importer.mjs";
import {
  approveGate,
  getWorkflowState,
  rejectGate,
  recoverInterruptedRuns,
  runAgent,
  runNextReadyAgent
} from "./orchestrator.mjs";
import { getProviderHealthSnapshot } from "./ai/client.mjs";
import { runShadowPlanning } from "./control/main-agent.mjs";
import {
  confirmAssistedDispatch,
  prepareAssistedDispatch,
  runActiveCycle,
  setControlMode,
  setStopRequest
} from "./control/controlled-dispatch.mjs";
import {
  getCollectorState,
  importAssistedCollectorBatch,
  runCollectorAgent
} from "./collector/agent.mjs";
import {
  getResearchState,
  importResearchEvidenceBatch
} from "./research/agent.mjs";
import {
  approveTrendCandidate,
  getTrendRadarState,
  ingestTrendSignal,
  runTrendRadarAgent
} from "./trends/agent.mjs";
import { saveVoiceUpload } from "./production/voice.mjs";
import {
  inspectLocalOfflineTtsCandidate,
  registerApprovedLocalOfflineTts
} from "./production/local-offline-voice.mjs";
import { saveAssetUpload } from "./production/assets.mjs";
import { adjudicateAmbiguousExternalAssetReceipt } from
  "./production/external-assets.mjs";
import { summarizeAgentOperations } from "./control/agent-observability.mjs";
import { safeErrorMessage } from "../shared/redaction.mjs";
import {
  approveVisualProofCandidate,
  reviewVisualProofCandidate,
  verifyVisualProofApproval
} from "./reviews/visual-proof-checkpoint.mjs";
import {
  approveAssetExecutionCandidate,
  rejectAssetExecutionCandidate,
  reviseAssetExecutionStrategy,
  reviewAssetExecutionCandidate,
  verifyAssetExecutionApproval
} from "./reviews/asset-execution-checkpoint.mjs";
import { runAssetExecutionPreflight } from
  "./reviews/asset-execution-preflight-runner.mjs";
import { getHumanApprovalView } from "./reviews/human-approval-view.mjs";

const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".ogg", "audio/ogg"]
]);

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function sendError(response, error, statusCode = 500) {
  sendJson(response, statusCode, {
    error: safeErrorMessage(error, "未知错误"),
    code: typeof error?.code === "string" ? error.code : "internal_error"
  });
}

async function readJsonBody(request, maximumBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      const error = new Error("JSON 请求超过 1 MB 上限");
      error.code = "request_too_large";
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readBinaryBody(request, maximumBytes = 100 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw new Error("上传文件超过 100 MB 上限");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveFile(request, response, filePath) {
  const details = await stat(filePath);
  const contentType = mimeTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
  const range = request.headers.range;

  if (range && contentType === "video/mp4") {
    const match = /bytes=(\d*)-(\d*)/u.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : details.size - 1;
    if (start > end || end >= details.size) {
      response.writeHead(416, { "content-range": `bytes */${details.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      "content-type": contentType,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${details.size}`,
      "accept-ranges": "bytes",
      "cache-control": "no-store"
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, {
    "content-type": contentType,
    "content-length": details.size,
    "cache-control": contentType === "video/mp4" ? "no-store" : "public, max-age=60"
  });
  createReadStream(filePath).pipe(response);
}

function summarizeEpisode(episode) {
  const visualProof = episode.reviewCheckpoints?.visualProof;
  const assetExecution = episode.reviewCheckpoints?.assetExecution;
  return {
    id: episode.id,
    title: episode.title,
    concept: episode.concept,
    status: episode.status,
    updatedAt: episode.updatedAt,
    progress: summarizePipeline(episode.pipeline),
    render: episode.render,
    qa: episode.qa,
    voice: episode.voice,
    visualProofReview: visualProof
      ? {
          status: visualProof.status,
          version: visualProof.currentCandidate?.version ?? null,
          candidateHash: visualProof.currentCandidate?.candidateHash ?? null,
          approvedAt: visualProof.humanApproval?.at ?? null
        }
      : null,
    assetExecutionReview: assetExecution
      ? {
          status: assetExecution.status,
          version: assetExecution.currentCandidate?.version ?? null,
          candidateHash: assetExecution.currentCandidate?.candidateHash ?? null,
          maximumPaidCostUsd:
            assetExecution.currentCandidate?.summary?.maximumPaidCostUsd ?? null,
          billingCurrencies:
            assetExecution.currentCandidate?.summary?.billingCurrencies ?? [],
          nativeCurrencyCaps:
            assetExecution.currentCandidate?.summary?.nativeCurrencyCaps ?? [],
          externalApiCallCount:
            assetExecution.currentCandidate?.summary?.externalApiCallCount ?? null,
          approvedAt: assetExecution.humanApproval?.at ?? null
        }
      : null
  };
}

async function routeApi(request, response, url, options = {}) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, at: new Date().toISOString() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    const config = await readConfig();
    sendJson(response, 200, {
      name: config.name,
      version: config.version,
      autoPublish: config.autoPublish,
      humanGates: config.humanGates
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/ai/status") {
    sendJson(response, 200, {
      ...(await getAiStatus()),
      health: getProviderHealthSnapshot()
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/ai/primary") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await setPrimaryProvider(body.providerId));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/cloud") {
    sendJson(response, 200, await getCloudBackupStatus());
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/episodes") {
    const episodes = await listEpisodes();
    sendJson(response, 200, { episodes: episodes.map(summarizeEpisode) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/events") {
    sendJson(response, 200, { events: await readRecentEvents(80) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/collector") {
    sendJson(response, 200, await getCollectorState());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/collector/run") {
    sendJson(response, 200, await runCollectorAgent());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/collector/assisted-batches") {
    const batch = await readJsonBody(request);
    sendJson(response, 201, await importAssistedCollectorBatch(batch));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/research") {
    sendJson(response, 200, await getResearchState());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/research/run") {
    const body = await readJsonBody(request);
    const researchState = await getResearchState();
    const episodeId = body.episodeId || researchState.selection?.episodeId;
    if (!episodeId) throw new Error("请先在热点概念雷达中选择一个正式候选");
    sendJson(response, 200, await runAgent(episodeId, "research-agent"));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/research/evidence-batches") {
    const batch = await readJsonBody(request);
    sendJson(response, 201, await importResearchEvidenceBatch(batch));
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/trends") {
    sendJson(response, 200, await getTrendRadarState());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/trends/run") {
    const result = await runTrendRadarAgent();
    sendJson(response, 200, result);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/trends/signals") {
    const signal = await readJsonBody(request);
    sendJson(response, 201, await ingestTrendSignal(signal));
    return true;
  }

  const trendSelectionMatch = /^\/api\/trends\/candidates\/([a-z0-9-]+)\/select$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && trendSelectionMatch) {
    const body = await readJsonBody(request);
    const result = await approveTrendCandidate(trendSelectionMatch[1], body.note ?? "");
    sendJson(response, 200, result);
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/import/golden") {
    const result = await importGoldenSample();
    sendJson(response, 201, { episode: result.episode });
    return true;
  }

  const episodeMatch = /^\/api\/episodes\/([a-z0-9-]+)$/u.exec(url.pathname);
  if (request.method === "GET" && episodeMatch) {
    sendJson(response, 200, { episode: await readEpisode(episodeMatch[1]) });
    return true;
  }

  const approvalReviewMatch = /^\/api\/episodes\/([a-z0-9-]+)\/approval-review\/(research|script|storyboard|assets|final|asset-execution|visual-proof)$/u.exec(
    url.pathname
  );
  if (request.method === "GET" && approvalReviewMatch) {
    const review = await getHumanApprovalView(
      approvalReviewMatch[1],
      approvalReviewMatch[2],
      options
    );
    sendJson(response, 200, { review });
    return true;
  }

  const workflowMatch = /^\/api\/episodes\/([a-z0-9-]+)\/workflow$/u.exec(url.pathname);
  if (request.method === "GET" && workflowMatch) {
    sendJson(response, 200, { workflow: await getWorkflowState(workflowMatch[1]) });
    return true;
  }

  const metricsMatch = /^\/api\/episodes\/([a-z0-9-]+)\/agent-metrics$/u.exec(url.pathname);
  if (request.method === "GET" && metricsMatch) {
    sendJson(response, 200, {
      metrics: summarizeAgentOperations(await readEpisode(metricsMatch[1]))
    });
    return true;
  }

  const visualProofReviewMatch = /^\/api\/episodes\/([a-z0-9-]+)\/visual-proof-review$/u.exec(
    url.pathname
  );
  if (request.method === "GET" && visualProofReviewMatch) {
    sendJson(response, 200, await verifyVisualProofApproval(visualProofReviewMatch[1]));
    return true;
  }
  if (request.method === "POST" && visualProofReviewMatch) {
    const body = await readJsonBody(request);
    const result = await reviewVisualProofCandidate(visualProofReviewMatch[1], body);
    sendJson(response, 200, {
      checkpoint: result.checkpoint,
      unchanged: result.unchanged
    });
    return true;
  }

  const visualProofApprovalMatch = /^\/api\/episodes\/([a-z0-9-]+)\/visual-proof-review\/approve$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && visualProofApprovalMatch) {
    const body = await readJsonBody(request);
    const result = await approveVisualProofCandidate(visualProofApprovalMatch[1], body, options);
    sendJson(response, 200, {
      checkpoint: result.checkpoint,
      unchanged: result.unchanged
    });
    return true;
  }

  const assetExecutionReviewMatch = /^\/api\/episodes\/([a-z0-9-]+)\/asset-execution-review$/u.exec(
    url.pathname
  );
  if (request.method === "GET" && assetExecutionReviewMatch) {
    sendJson(response, 200, await verifyAssetExecutionApproval(assetExecutionReviewMatch[1]));
    return true;
  }
  if (request.method === "POST" && assetExecutionReviewMatch) {
    const body = await readJsonBody(request);
    const result = await reviewAssetExecutionCandidate(assetExecutionReviewMatch[1], body);
    sendJson(response, 200, {
      checkpoint: result.checkpoint,
      unchanged: result.unchanged
    });
    return true;
  }

  const assetExecutionApprovalMatch = /^\/api\/episodes\/([a-z0-9-]+)\/asset-execution-review\/approve$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && assetExecutionApprovalMatch) {
    const body = await readJsonBody(request);
    const result = await approveAssetExecutionCandidate(
      assetExecutionApprovalMatch[1],
      body,
      options
    );
    sendJson(response, 200, {
      checkpoint: result.checkpoint,
      unchanged: result.unchanged
    });
    return true;
  }

  const assetExecutionRejectionMatch = /^\/api\/episodes\/([a-z0-9-]+)\/asset-execution-review\/reject$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && assetExecutionRejectionMatch) {
    const body = await readJsonBody(request);
    const result = await rejectAssetExecutionCandidate(
      assetExecutionRejectionMatch[1],
      body,
      options
    );
    sendJson(response, 200, {
      checkpoint: result.checkpoint,
      unchanged: result.unchanged
    });
    return true;
  }

  const assetExecutionStrategyMatch = /^\/api\/episodes\/([a-z0-9-]+)\/asset-execution-review\/strategy$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && assetExecutionStrategyMatch) {
    const body = await readJsonBody(request);
    const result = await reviseAssetExecutionStrategy(assetExecutionStrategyMatch[1], body);
    sendJson(response, 200, {
      checkpoint: result.checkpoint,
      strategy: result.episode.production?.assetPlanDirection?.strategy ?? null,
      unchanged: result.unchanged
    });
    return true;
  }

  const assetExecutionPreflightMatch = /^\/api\/episodes\/([a-z0-9-]+)\/asset-execution-preflight\/run$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && assetExecutionPreflightMatch) {
    const body = await readJsonBody(request);
    const result = await runAssetExecutionPreflight(
      assetExecutionPreflightMatch[1],
      { candidateHash: body.candidateHash }
    );
    sendJson(response, 200, {
      checkpointStatus: result.checkpoint.status,
      run: result.run,
      report: result.report,
      unchanged: result.unchanged
    });
    return true;
  }

  const externalAssetRetryAdjudicationMatch =
    /^\/api\/episodes\/([a-z0-9-]+)\/external-assets\/([a-z0-9-]+)\/retry-adjudications$/u
      .exec(url.pathname);
  if (request.method === "POST" && externalAssetRetryAdjudicationMatch) {
    const body = await readJsonBody(request);
    const result = await adjudicateAmbiguousExternalAssetReceipt(
      externalAssetRetryAdjudicationMatch[1],
      {
        candidateHash: body.candidateHash,
        itemId: externalAssetRetryAdjudicationMatch[2],
        callId: body.callId,
        expectedReceiptStateVersion: body.expectedReceiptStateVersion,
        expectedReceiptHash: body.expectedReceiptHash,
        decision: body.decision,
        observations: body.observations,
        confirmation: body.confirmation,
        note: body.note
      },
      { actor: "human:Zhengjiazhi" }
    );
    sendJson(response, 200, {
      candidateHash: result.adjudication.candidateHash ?? body.candidateHash,
      itemId: externalAssetRetryAdjudicationMatch[2],
      callId: body.callId,
      status: result.journal.status,
      receiptStateVersion: result.journal.stateVersion,
      adjudicationId: result.adjudication.id,
      unchanged: result.unchanged
    });
    return true;
  }

  const shadowPlanMatch = /^\/api\/episodes\/([a-z0-9-]+)\/main-agent\/shadow$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && shadowPlanMatch) {
    const result = await runShadowPlanning(shadowPlanMatch[1]);
    sendJson(response, 200, { episode: result.episode, plan: result.record });
    return true;
  }

  const controlModeMatch = /^\/api\/episodes\/([a-z0-9-]+)\/control\/mode$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && controlModeMatch) {
    const body = await readJsonBody(request);
    const result = await setControlMode(controlModeMatch[1], body.mode);
    sendJson(response, 200, {
      episode: result.episode,
      changed: result.changed,
      evaluation: result.evaluation
    });
    return true;
  }

  const controlStopMatch = /^\/api\/episodes\/([a-z0-9-]+)\/control\/stop$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && controlStopMatch) {
    const body = await readJsonBody(request);
    const episode = await setStopRequest(controlStopMatch[1], body.requested ?? true);
    sendJson(response, 200, { episode });
    return true;
  }

  const assistedPrepareMatch = /^\/api\/episodes\/([a-z0-9-]+)\/main-agent\/assisted\/prepare$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && assistedPrepareMatch) {
    const result = await prepareAssistedDispatch(assistedPrepareMatch[1], {
      providerHealth: getProviderHealthSnapshot()
    });
    sendJson(response, 200, result);
    return true;
  }

  const assistedConfirmMatch = /^\/api\/episodes\/([a-z0-9-]+)\/main-agent\/assisted\/confirm$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && assistedConfirmMatch) {
    const body = await readJsonBody(request);
    const result = await confirmAssistedDispatch(assistedConfirmMatch[1], body.dispatchId, {
      providerHealth: getProviderHealthSnapshot(),
      runWorker: runAgent
    });
    sendJson(response, 200, result);
    return true;
  }

  const activeRunMatch = /^\/api\/episodes\/([a-z0-9-]+)\/main-agent\/active\/run$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && activeRunMatch) {
    const result = await runActiveCycle(activeRunMatch[1], {
      providerHealth: getProviderHealthSnapshot(),
      runWorker: runAgent
    });
    sendJson(response, 200, result);
    return true;
  }

  const voiceUploadMatch = /^\/api\/episodes\/([a-z0-9-]+)\/voice\/upload$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && voiceUploadMatch) {
    const encodedFileName = request.headers["x-file-name"] ?? "voice";
    const result = await saveVoiceUpload(voiceUploadMatch[1], {
      fileName: decodeURIComponent(String(encodedFileName)),
      contentType: request.headers["content-type"] ?? "application/octet-stream",
      data: await readBinaryBody(request)
    });
    sendJson(response, 201, { episode: result.episode, bytes: result.bytes });
    return true;
  }

  const localOfflineVoiceMatch =
    /^\/api\/episodes\/([a-z0-9-]+)\/voice\/local-offline-tts\/candidate$/u.exec(
      url.pathname
    );
  if (request.method === "GET" && localOfflineVoiceMatch) {
    sendJson(response, 200, await inspectLocalOfflineTtsCandidate(localOfflineVoiceMatch[1]));
    return true;
  }

  const localOfflineVoiceRegistrationMatch =
    /^\/api\/episodes\/([a-z0-9-]+)\/voice\/local-offline-tts\/register$/u.exec(
      url.pathname
    );
  if (request.method === "POST" && localOfflineVoiceRegistrationMatch) {
    const result = await registerApprovedLocalOfflineTts(
      localOfflineVoiceRegistrationMatch[1],
      await readJsonBody(request)
    );
    sendJson(response, result.unchanged ? 200 : 201, {
      episode: result.episode,
      candidateId: result.candidateId,
      candidateHash: result.candidateHash,
      machineVerificationId: result.machineVerificationId,
      machineVerificationHash: result.machineVerificationHash,
      verificationId: result.verificationId ?? null,
      unchanged: result.unchanged
    });
    return true;
  }

  const assetUploadMatch = /^\/api\/episodes\/([a-z0-9-]+)\/assets\/upload$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && assetUploadMatch) {
    const encodedFileName = request.headers["x-file-name"] ?? "material";
    const result = await saveAssetUpload(assetUploadMatch[1], {
      fileName: decodeURIComponent(String(encodedFileName)),
      planItemId: decodeURIComponent(String(request.headers["x-plan-item-id"] ?? "")),
      source: decodeURIComponent(String(request.headers["x-asset-source"] ?? "human-upload")),
      externalCallId: decodeURIComponent(String(request.headers["x-external-call-id"] ?? "")),
      providerId: decodeURIComponent(String(request.headers["x-provider-id"] ?? "")),
      model: decodeURIComponent(String(request.headers["x-model"] ?? "")),
      maximumCostUsd: Number(request.headers["x-maximum-cost-usd"] ?? 0),
      contentType: request.headers["content-type"] ?? "application/octet-stream",
      data: await readBinaryBody(request)
    });
    sendJson(response, 201, { episode: result.episode, asset: result.asset });
    return true;
  }

  const agentMatch = /^\/api\/episodes\/([a-z0-9-]+)\/agents\/([a-z0-9-]+)\/run$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && agentMatch) {
    const result = await runAgent(agentMatch[1], agentMatch[2]);
    sendJson(response, 200, result);
    return true;
  }

  const nextMatch = /^\/api\/episodes\/([a-z0-9-]+)\/run-next$/u.exec(url.pathname);
  if (request.method === "POST" && nextMatch) {
    const result = await runNextReadyAgent(nextMatch[1]);
    sendJson(response, 200, result);
    return true;
  }

  const approvalMatch = /^\/api\/episodes\/([a-z0-9-]+)\/approvals\/([a-z]+)$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && approvalMatch) {
    const body = await readJsonBody(request);
    const episode = await approveGate(approvalMatch[1], approvalMatch[2], body, options);
    sendJson(response, 200, { episode });
    return true;
  }

  const rejectionMatch = /^\/api\/episodes\/([a-z0-9-]+)\/approvals\/([a-z]+)\/reject$/u.exec(
    url.pathname
  );
  if (request.method === "POST" && rejectionMatch) {
    const body = await readJsonBody(request);
    const episode = await rejectGate(rejectionMatch[1], rejectionMatch[2], body, options);
    sendJson(response, 200, { episode });
    return true;
  }

  return false;
}

function approvalRouteDependencies(options = {}) {
  const allowed = [
    "readEpisode",
    "writeEpisode",
    "appendEvent",
    "readApprovalArtifact",
    "inspectFileIntegrity",
    "inspectVisualProofCandidate",
    "review"
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => options[key] !== undefined)
      .map((key) => [key, options[key]])
  );
}

export async function createStudioServer(options = {}) {
  if (options.recoverOnStart !== false) {
    await recoverInterruptedRuns(options.recovery ?? {});
  }
  const config = await readConfig();
  if (!localHosts.has(config.host)) {
    const error = new Error("安全策略禁止把本地控制台绑定到非本机地址");
    error.code = "remote_binding_disabled";
    throw error;
  }
  const routeOptions = approvalRouteDependencies(options);
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${config.host}:${config.port}`);
      if (url.pathname.startsWith("/api/")) {
        if (!new Set(["GET", "HEAD", "OPTIONS"]).has(request.method)) {
          const origin = request.headers.origin;
          if (origin) {
            let parsedOrigin;
            try {
              parsedOrigin = new URL(origin);
            } catch {
              const error = new Error("请求来源格式无效");
              error.code = "forbidden_origin";
              error.statusCode = 403;
              throw error;
            }
            if (!localHosts.has(parsedOrigin.hostname) || Number(parsedOrigin.port || 80) !== config.port) {
              const error = new Error("请求来源不属于本地控制台");
              error.code = "forbidden_origin";
              error.statusCode = 403;
              throw error;
            }
          }
        }
        if (!(await routeApi(request, response, url, routeOptions))) {
          sendError(response, new Error("接口不存在"), 404);
        }
        return;
      }

      if (url.pathname.startsWith("/assets/")) {
        const relativePath = decodeURIComponent(url.pathname.slice("/assets/".length));
        await serveFile(request, response, ensureInside(publicRoot, resolve(publicRoot, relativePath)));
        return;
      }

      if (url.pathname.startsWith("/outputs/")) {
        const relativePath = decodeURIComponent(url.pathname.slice("/outputs/".length));
        await serveFile(
          request,
          response,
          ensureInside(studioOutputRoot, resolve(studioOutputRoot, relativePath))
        );
        return;
      }

      const webPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      await serveFile(request, response, ensureInside(webRoot, resolve(webRoot, webPath)));
    } catch (error) {
      const statusCode = error?.statusCode
        ?? (error?.code === "ENOENT"
          ? 404
          : error?.code === "state_version_conflict"
            ? 409
            : 500);
      sendError(response, error, statusCode);
    }
  });

  return { server, config };
}

if (typeof process !== "undefined" && process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, config } = await createStudioServer();
  server.listen(config.port, config.host, () => {
    console.log(`AI Concept Studio: http://${config.host}:${config.port}`);
  });
}
