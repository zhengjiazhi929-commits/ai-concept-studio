import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {createRequire} from "node:module";
import {promisify} from "node:util";
import test from "node:test";
import {fileURLToPath} from "node:url";

const studio = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const bundlerRequire = createRequire(require.resolve("@remotion/bundler"));
const webpackRequire = createRequire(bundlerRequire.resolve("webpack"));
const schemaRequire = createRequire(webpackRequire.resolve("schema-utils"));
const ajvRequire = createRequire(schemaRequire.resolve("ajv"));
const postcssRequire = createRequire(bundlerRequire.resolve("postcss"));
const cssRequire = createRequire(bundlerRequire.resolve("css-loader"));
const modulesRequire = createRequire(cssRequire.resolve("postcss-modules-local-by-default"));
const uri = ajvRequire("fast-uri");
const {SourceMapConsumer} = postcssRequire("source-map-js");
const {BalancedPool, Pool} = require("undici");

test("installed security patch versions remain pinned without changing the rendering toolchain", () => {
  assert.equal(ajvRequire("fast-uri/package.json").version, "3.1.8");
  assert.equal(postcssRequire("source-map-js/package.json").version, "1.2.2");
  assert.equal(modulesRequire("postcss-selector-parser/package.json").version, "7.1.6");
  assert.equal(require("undici/package.json").version, "7.29.1");
  for (const name of ["remotion", "@remotion/bundler", "@remotion/renderer"]) {
    assert.equal(require(`${name}/package.json`).version, "4.0.504");
  }
});

test("fast-uri rejects non-digit ports without changing valid URI serialization", () => {
  assert.throws(() => uri.serialize({scheme: "https", host: "example.com", port: "@127.0.0.1:8124", path: "/safe"}), /port.*malformed/iu);
  assert.equal(uri.serialize({scheme: "https", host: "example.com", port: 8443, path: "/safe"}), "https://example.com:8443/safe");
});

test("fast-uri reports malformed authority brackets and still accepts a valid IPv6 literal", () => {
  for (const value of ["https://[broken.example/path", "https://safe@[@127.0.0.1/path"]) {
    assert.match(uri.parse(value).error ?? "", /host.*malformed/iu);
  }
  assert.equal(uri.parse("https://[2001:db8::1]/path").error, undefined);
});

test("fast-uri canonicalizes percent-encoded host case consistently for scheme-relative references", () => {
  assert.equal(uri.parse("//%41.example").host, "a.example");
  assert.equal(uri.equal("//%41.example", "//a.example"), true);
  assert.equal(uri.normalize("//%41.example"), uri.normalize("//a.example"));
});

test("flat selector parsing preserves output without quadratic numeric-array membership scans", async () => {
  const script = `
    import assert from "node:assert/strict";
    import {createRequire} from "node:module";
    const require = createRequire(import.meta.url);
    const bundler = createRequire(require.resolve("@remotion/bundler"));
    const css = createRequire(bundler.resolve("css-loader"));
    const modules = createRequire(css.resolve("postcss-modules-local-by-default"));
    const parse = modules("postcss-selector-parser");
    const count = 1024, selector = ".part".repeat(count), limit = count * 64;
    const original = Array.prototype.indexOf;
    let scannedItems = 0;
    try {
      // Count actual numeric-array lookup work, not noisy wall-clock duration.
      // The instrumentation is confined to this disposable child process.
      Array.prototype.indexOf = function(value, from = 0) {
        const result = Reflect.apply(original, this, [value, from]);
        if (this.length > 32 && typeof value === "number" && typeof this[0] === "number") {
          scannedItems += result < 0 ? this.length : result + 1;
          assert.ok(scannedItems <= limit, "quadratic numeric membership scan exceeded bounded regression budget");
        }
        return result;
      };
      const ast = parse().astSync(selector);
      assert.equal(ast.first.nodes.length, count);
      assert.equal(ast.toString(), selector);
    } finally {
      Array.prototype.indexOf = original;
    }
    console.log(JSON.stringify({scannedItems, limit}));
  `;
  const {stdout} = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], {
    cwd: studio, timeout: 8000, maxBuffer: 32 * 1024
  });
  const result = JSON.parse(stdout);
  assert.ok(result.scannedItems <= result.limit);
});

test("source-map-js rejects oversized indexed offsets before mapping expansion", () => {
  const source = {version: 3, sources: ["source.js"], names: [], mappings: "AAAA"};
  const indexed = line => ({version: 3, sections: [{offset: {line, column: 0}, map: source}]});
  // Only construct the old consumer: never expand its attacker-sized mapping.
  assert.throws(() => new SourceMapConsumer(indexed(10000001)), /offset.*exceed/iu);
  const valid = new SourceMapConsumer(indexed(1));
  assert.deepEqual(valid.originalPositionFor({line: 2, column: 1}), {source: "source.js", line: 1, column: 0, name: null});
});

test("BalancedPool preserves function-valued TLS and connector options without dispatching requests", async () => {
  const checkServerIdentity = () => new Error("synthetic pin mismatch");
  const connector = () => { throw new Error("No network permitted in this regression"); };
  for (const options of [{connect: {checkServerIdentity}}, {tls: {checkServerIdentity}}, {connect: connector}]) {
    let received;
    const pool = new BalancedPool(["https://example.invalid"], {...options, factory(origin, value) {
      received = value;
      return new Pool(origin, value);
    }});
    try {
      for (const key of Object.keys(options)) assert.deepEqual(received[key], options[key]);
    } finally {
      await pool.close();
    }
  }
});

test("undici rejects an unrequested WebSocket subprotocol without crashing the child process", async () => {
  const script = `
    import assert from "node:assert/strict";
    import {createHash} from "node:crypto";
    import {createServer} from "node:http";
    import {once} from "node:events";
    import {WebSocket} from "undici";
    const sockets = new Set();
    const server = createServer();
    server.on("connection", socket => {sockets.add(socket); socket.on("close", () => sockets.delete(socket));});
    server.on("upgrade", (request, socket) => {
      const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\nSec-WebSocket-Protocol: never-requested\\r\\n\\r\\n");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const socket = new WebSocket("ws://127.0.0.1:" + server.address().port);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Handshake did not fail promptly")), 3000);
        socket.addEventListener("error", () => {clearTimeout(timer); resolve();}, {once: true});
        socket.addEventListener("open", () => {clearTimeout(timer); reject(new Error("Unexpected protocol accepted"));}, {once: true});
      });
      assert.notEqual(socket.readyState, WebSocket.OPEN);
      console.log("handshake-rejected-without-process-crash");
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    }
  `;
  const {stdout} = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], {
    cwd: studio, timeout: 8000, maxBuffer: 32 * 1024
  });
  assert.match(stdout, /handshake-rejected-without-process-crash/u);
});
