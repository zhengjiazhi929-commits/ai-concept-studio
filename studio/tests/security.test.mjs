import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  ensureInside,
  publicRoot,
  workspaceRelativePath,
  workspaceRoot
} from "../src/shared/paths.mjs";

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
