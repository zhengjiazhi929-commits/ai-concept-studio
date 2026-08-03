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
import { importGoldenSample } from "./importer.mjs";
import { approveGate, runAgent, runNextReadyAgent } from "./orchestrator.mjs";
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

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".mp4", "video/mp4"]
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
    error: error instanceof Error ? error.message : "未知错误"
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
  return {
    id: episode.id,
    title: episode.title,
    concept: episode.concept,
    status: episode.status,
    updatedAt: episode.updatedAt,
    progress: summarizePipeline(episode.pipeline),
    render: episode.render,
    qa: episode.qa,
    voice: episode.voice
  };
}

async function routeApi(request, response, url) {
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
    const episode = await approveGate(approvalMatch[1], approvalMatch[2], body.note ?? "");
    sendJson(response, 200, { episode });
    return true;
  }

  return false;
}

export async function createStudioServer() {
  const config = await readConfig();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${config.host}:${config.port}`);
      if (url.pathname.startsWith("/api/")) {
        if (!(await routeApi(request, response, url))) {
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
      const statusCode = error?.code === "ENOENT" ? 404 : 500;
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
