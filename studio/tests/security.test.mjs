import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ensureInside, publicRoot } from "../src/shared/paths.mjs";

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
