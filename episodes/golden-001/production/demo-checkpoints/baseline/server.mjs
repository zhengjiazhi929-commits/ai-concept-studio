import http from "node:http";
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
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/customers") {
        const count = Math.min(Number(url.searchParams.get("count")) || 24, 200);
        sendJson(response, 200, { customers: makeCustomers(count) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/export") {
        // Intentionally incomplete baseline for the Agentic Coding demonstration:
        // - no role authorization;
        // - exports sensitive fields in full;
        // - performs the whole export synchronously.
        const count = Number(url.searchParams.get("count")) || 24;
        const csv = customersToCsv(makeCustomers(count));

        response.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=customers.csv",
          "cache-control": "no-store"
        });
        response.end(csv);
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/export/")) {
        sendJson(response, 404, { error: "export job not found" });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4173;
  const server = createAppServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Demo running at http://127.0.0.1:${port}`);
  });
}

