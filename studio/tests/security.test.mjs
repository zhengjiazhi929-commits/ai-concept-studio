import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  ensureInside,
  publicRoot,
  workspaceRelativePath,
  workspaceRoot
} from "../src/shared/paths.mjs";
import { redactSensitiveValue } from "../src/shared/redaction.mjs";
import { assertPublicHttpsTarget } from "../src/shared/network.mjs";

test("静态文件路径不能逃出允许目录", () => {
  assert.throws(
    () => ensureInside(publicRoot, resolve(publicRoot, "..", "config", "studio.json")),
    /escapes allowed root/u
  );
});

test("允许访问公开素材目录内部的文件", () => {
  const target = resolve(publicRoot, "episodes", "golden-001", "demo-admin-export-complete.png");
  assert.equal(ensureInside(publicRoot, target), target);
});

test("持久化产物路径统一转换为跨平台相对路径", () => {
  const target = resolve(workspaceRoot, "outputs", "studio", "golden-001", "preview.mp4");
  assert.equal(workspaceRelativePath(target), "outputs/studio/golden-001/preview.mp4");
});

test("持久化产物路径不能指向工作区外部", () => {
  assert.throws(() => workspaceRelativePath(resolve(workspaceRoot, "..", "private.mp4")), /escapes/u);
});

test("嵌套对象按秘密字段名脱敏，即使字段值没有可识别前缀", () => {
  const opaqueSecret = "opaque-value-without-a-known-secret-prefix";
  const safe = redactSensitiveValue({
    apiKey: opaqueSecret,
    nested: {
      Authorization: opaqueSecret,
      password: opaqueSecret,
      headers: {
        "x-api-key": opaqueSecret,
        "content-type": "application/json"
      },
      note: opaqueSecret
    }
  });

  assert.equal(safe.apiKey, "[REDACTED]");
  assert.equal(safe.nested.Authorization, "[REDACTED]");
  assert.equal(safe.nested.password, "[REDACTED]");
  assert.equal(safe.nested.headers["x-api-key"], "[REDACTED]");
  assert.equal(safe.nested.headers["content-type"], "application/json");
  assert.equal(safe.nested.note, opaqueSecret);
});

test("公网目标校验拒绝 IPv6 loopback 和公私混合 DNS 结果", async () => {
  await assert.rejects(
    assertPublicHttpsTarget("https://[::1]/admin"),
    (error) => error.code === "public_https_address_forbidden"
  );
  await assert.rejects(
    assertPublicHttpsTarget("https://mixed.example.org/spec", {
      lookupImpl: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 }
      ]
    }),
    (error) => error.code === "public_https_address_forbidden"
  );
});
