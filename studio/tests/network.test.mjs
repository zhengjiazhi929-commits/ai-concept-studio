import test from "node:test";
import assert from "node:assert/strict";
import { parseMacProxy, resolveProxyUrl } from "../src/shared/network.mjs";

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
