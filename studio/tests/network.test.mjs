import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicHttps, parseMacProxy, resolveProxyUrl } from "../src/shared/network.mjs";

test("读取 macOS 已启用的 HTTPS 系统代理", () => {
  const output = `<dictionary> {
    HTTPSEnable : 1
    HTTPSPort : 7897
    HTTPSProxy : 127.0.0.1
  }`;
  assert.equal(parseMacProxy(output), "http://127.0.0.1:7897");
});

test("显式代理环境变量优先于系统代理", async () => {
  const proxy = await resolveProxyUrl({
    environment: { HTTPS_PROXY: "http://proxy.example:8080" },
    platform: "darwin",
    execFileAsync: async () => {
      throw new Error("不应读取系统代理");
    }
  });
  assert.equal(proxy, "http://proxy.example:8080");
});

test("异步请求前校验拒绝时不发送 HTTP", async () => {
  let requests = 0;
  const denied = Object.assign(new Error("synthetic authorization drift"), {code: "synthetic_denied"});
  await assert.rejects(fetchPublicHttps("https://example.org/spec", {
    lookupImpl: async () => [{address: "93.184.216.34", family: 4}],
    beforeRequest: async () => {await Promise.resolve(); throw denied;},
    fetchImpl: async () => {requests++; return new Response("synthetic");}
  }), error => error === denied);
  assert.equal(requests, 0);
});

test("同步请求前校验保持兼容并在每次重定向前执行", async () => {
  const order = [];
  const result = await fetchPublicHttps("https://example.org/spec", {
    lookupImpl: async () => [{address: "93.184.216.34", family: 4}],
    beforeRequest: () => {order.push("guard");},
    fetchImpl: async url => {
      order.push(url);
      return url.endsWith("/spec")
        ? new Response(null, {status: 302, headers: {location: "/final"}})
        : new Response("synthetic");
    }
  });
  assert.deepEqual(order, ["guard", "https://example.org/spec", "guard", "https://example.org/final"]);
  assert.equal(result.finalUrl.href, "https://example.org/final");
});
