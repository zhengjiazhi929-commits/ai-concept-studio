import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createStudioServer } from "../src/server/app.mjs";
import { assertLocalRequestBoundary } from "../src/server/security/local-request-boundary.mjs";

async function fixture(t, hostname = "127.0.0.1") {
  const root = await mkdtemp(resolve(tmpdir(), "acs-request-boundary-"));
  await writeFile(resolve(root, "private.txt"), "synthetic private asset");
  let reads = 0;
  const { server } = await createStudioServer({
    recoverOnStart: false,
    webRoot: root,
    publicRoot: root,
    outputRoot: root,
    readEpisode: async (id) => {
      reads += 1;
      return { id, privateNote: "synthetic private episode" };
    },
    readEpisodeCommitStatus: async () => null
  });
  server.listen(0, hostname);
  await once(server, "listening");
  t.after(async () => {
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  });
  const port = server.address().port;
  const request = (path, headers = {}, method = "GET") => new Promise((done, reject) => {
    const req = http.request({
      hostname, port, path, method, setHost: false,
      headers: { host: `${hostname === "::1" ? "[::1]" : hostname}:${port}`, ...headers }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => done({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
  return { port, request, reads: () => reads };
}

test("all route families reject nonlocal or malformed Host before reading private data", async (t) => {
  const f = await fixture(t);
  for (const path of ["/api/episodes/synthetic-episode", "/outputs/private.txt", "/assets/private.txt", "/private.txt"]) {
    for (const host of [
      `rebind-attacker.example:${f.port}`, `localhost.evil.example:${f.port}`,
      `127.0.0.1:${f.port === 65535 ? f.port - 1 : f.port + 1}`,
      "", `localhost:${f.port}/`, `user@localhost:${f.port}`,
      `127.1:${f.port}`, `localhost.:${f.port}`
    ]) {
      const result = await f.request(path, { host });
      assert.equal(result.status, 403, `${path} Host=${host}`);
      assert.equal(JSON.parse(result.body).code, "forbidden_host");
      assert.doesNotMatch(result.body, /synthetic private/u);
    }
  }
  assert.equal(f.reads(), 0);
});

test("read requests reject foreign Origin and cross-site browser metadata", async (t) => {
  const f = await fixture(t);
  for (const path of ["/api/episodes/synthetic-episode", "/outputs/private.txt", "/assets/private.txt"]) {
    for (const headers of [
      { origin: `http://rebind-attacker.example:${f.port}` },
      { origin: `http://localhost:${f.port + 1}` },
      { origin: `https://localhost:${f.port}` },
      { origin: "null" },
      { origin: `http://localhost:${f.port}/not-an-origin` },
      { "sec-fetch-site": "cross-site" }
    ]) {
      const result = await f.request(path, headers);
      assert.equal(result.status, 403, JSON.stringify(headers));
      assert.equal(JSON.parse(result.body).code, "forbidden_origin");
    }
  }
  assert.equal(f.reads(), 0);
});

test("localhost, IPv4 and bracketed IPv6 authorities at the bound port remain readable", async (t) => {
  const f = await fixture(t);
  for (const host of [`localhost:${f.port}`, `127.0.0.1:${f.port}`, `[::1]:${f.port}`]) {
    for (const metadata of [undefined, "same-origin", "same-site", "none"]) {
      const result = await f.request("/api/episodes/synthetic-episode", {
        host, origin: `http://${host}`, ...(metadata ? { "sec-fetch-site": metadata } : {})
      });
      assert.equal(result.status, 200, `${host} ${metadata}`);
      assert.match(result.body, /synthetic private episode/u);
    }
  }
  assert.equal((await f.request("/outputs/private.txt")).status, 200);
  assert.equal((await f.request("/outputs/private.txt", {}, "HEAD")).status, 200);
});

test("an actual IPv6 loopback client can read the private fixture without URL parsing failure", async (t) => {
  const f = await fixture(t, "::1");
  const result = await f.request("/api/episodes/synthetic-episode", { origin: `http://[::1]:${f.port}` });
  assert.equal(result.status, 200);
  assert.equal(f.reads(), 1);
});

test("authority validation uses the socket port, never forwarded headers or the configured fallback", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.doesNotThrow(() => assertLocalRequestBoundary({
      headers: { host, origin: `http://${host}` }, socket: { localPort: 80 }
    }, { port: 4317 }));
  }
  for (const host of [undefined, "localhost", "localhost:4317", "localhost:65536", "localhost:0"]) {
    assert.throws(() => assertLocalRequestBoundary({
      headers: { host, "x-forwarded-host": "localhost:5555", "x-forwarded-port": "5555" },
      socket: { localPort: 5555 }
    }, { port: 4317 }), { code: "forbidden_host" });
  }
});
