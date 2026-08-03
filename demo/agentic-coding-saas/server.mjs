import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeCustomers } from "./src/customers.mjs";
import { customersToCsv } from "./src/csv.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function isAdmin(url) {
  return url.searchParams.get("role") === "admin";
}

function publicJob(job) {
  return {
    jobId: job.jobId,
    status: job.status,
    ...(job.status === "complete"
      ? { downloadUrl: `/api/export/${job.jobId}/download` }
      : {})
  };
}

async function serveStatic(pathname, response) {
  const entry = staticFiles.get(pathname);
  if (!entry) return false;

  const [fileName, contentType] = entry;
  const body = await readFile(join(currentDir, "public", fileName));
  response.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
  return true;
}

export function createAppServer() {
  const exportJobs = new Map();

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/customers") {
        const count = Math.min(Number(url.searchParams.get("count")) || 24, 200);
        sendJson(response, 200, { customers: makeCustomers(count) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/export") {
        if (!isAdmin(url)) {
          sendJson(response, 403, { error: "仅管理员可以创建导出任务" });
          return;
        }

        const jobId = randomUUID();
        const job = {
          jobId,
          status: "queued",
          count: Number(url.searchParams.get("count")) || 24,
          csv: null,
          createdAt: Date.now()
        };

        exportJobs.set(jobId, job);
        sendJson(response, 202, publicJob(job));

        // The response is completed before the potentially larger CSV is generated.
        // A short queue delay also makes the background state observable in the demo UI.
        setTimeout(() => {
          job.status = "processing";
          setImmediate(() => {
            try {
              job.csv = customersToCsv(makeCustomers(job.count));
              job.status = "complete";
            } catch (error) {
              job.status = "failed";
              job.error = error instanceof Error ? error.message : "导出失败";
            }
          });
        }, 30);
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/export/")) {
        if (!isAdmin(url)) {
          sendJson(response, 403, { error: "仅管理员可以访问导出结果" });
          return;
        }

        const pathParts = url.pathname.split("/").filter(Boolean);
        const jobId = pathParts[2];
        const job = exportJobs.get(jobId);
        if (!job) {
          sendJson(response, 404, { error: "export job not found" });
          return;
        }

        if (pathParts[3] === "download") {
          if (job.status !== "complete" || typeof job.csv !== "string") {
            sendJson(response, 409, { error: "export job is not complete" });
            return;
          }

          response.writeHead(200, {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename=customers-${job.jobId}.csv`,
            "cache-control": "no-store"
          });
          response.end(job.csv);
          return;
        }

        if (pathParts.length === 3) {
          sendJson(response, 200, publicJob(job));
          return;
        }

        sendJson(response, 404, { error: "not found" });
        return;
      }

      if (request.method === "GET" && (await serveStatic(url.pathname, response))) {
        return;
      }

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "unknown error" });
    }
  });
}

if (typeof process !== "undefined" && process.argv?.[1] === fileURLToPath(import.meta.url)) {
  const port = 4173;
  const server = createAppServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Demo running at http://127.0.0.1:${port}`);
  });
}
