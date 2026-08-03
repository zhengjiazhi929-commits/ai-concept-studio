import test from "node:test";
import assert from "node:assert/strict";
import { parse, resolve } from "node:path";
import {
  getCloudBackupStatus,
  sanitizeGithubRemote,
  validateBackupDestination
} from "../src/shared/cloud-backup.mjs";
import { workspaceRoot } from "../src/shared/paths.mjs";

test("GitHub 远端地址只向界面暴露安全的仓库地址", () => {
  assert.equal(
    sanitizeGithubRemote("https://secret-token@github.com/example/ai-studio.git"),
    "https://github.com/example/ai-studio"
  );
  assert.equal(
    sanitizeGithubRemote("git@github.com:example/ai-studio.git"),
    "https://github.com/example/ai-studio"
  );
});

test("云端素材目录不能放在项目内部或磁盘根目录", () => {
  assert.throws(() => validateBackupDestination(resolve(workspaceRoot, "cloud")), /项目仓库内部/u);
  assert.throws(() => validateBackupDestination(parse(workspaceRoot).root), /磁盘根目录/u);
});

test("云端状态在尚未配置时仍可读取", async () => {
  const status = await getCloudBackupStatus();
  assert.equal(typeof status.summary, "string");
  assert.equal(typeof status.code.synced, "boolean");
  assert.equal(typeof status.media.configured, "boolean");
});
