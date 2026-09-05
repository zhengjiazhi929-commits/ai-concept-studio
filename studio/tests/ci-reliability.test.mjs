import assert from "node:assert/strict";
import test from "node:test";

import {
  CI_DIFF_ZERO_SHA,
  resolveCiDiffRange,
  runGitDiffCheck
} from "../scripts/check-git-diff.mjs";
import {
  dependencyFingerprint,
  evaluateDependencyState
} from "../scripts/check-locked-dependencies.mjs";
import {
  auditPngFrame,
  auditPngFrameSet,
  decodePngPixels
} from "../scripts/ci-png-audit.mjs";
import { deflateSync } from "node:zlib";

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}

function rgbaPng(width, height, colors) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      row.set(colors[(y * width + x) % colors.length], 1 + x * 4);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

test("PR 与 push 的 CI diff range 分别使用合并基线与推送前置", () => {
  const base = "1".repeat(40);
  const head = "2".repeat(40);
  assert.deepEqual(resolveCiDiffRange({
    GITHUB_EVENT_NAME: "pull_request",
    ACS_DIFF_BASE_SHA: base,
    ACS_DIFF_HEAD_SHA: head
  }), { base, head, notation: "...", source: "event" });
  assert.deepEqual(resolveCiDiffRange({
    GITHUB_EVENT_NAME: "push",
    ACS_DIFF_BASE_SHA: base,
    ACS_DIFF_HEAD_SHA: head
  }), { base, head, notation: "..", source: "event" });
  assert.deepEqual(resolveCiDiffRange({
    GITHUB_EVENT_NAME: "schedule"
  }), null);
});

test("新分支 push 必须解析完整默认分支基线，不能退化为空 diff", async () => {
  const head = "2".repeat(40);
  const calls = [];
  const result = await runGitDiffCheck({
    environment: {
      GITHUB_EVENT_NAME: "push",
      ACS_DIFF_BASE_SHA: CI_DIFF_ZERO_SHA,
      ACS_DIFF_HEAD_SHA: head,
      ACS_DIFF_FALLBACK_BASE_REF: "origin/main"
    },
    runGit: async (arguments_) => {
      calls.push(arguments_);
      if (arguments_[0] === "rev-parse") return { stdout: `${"3".repeat(40)}\n` };
      if (arguments_[0] === "ls-files") return { stdout: "" };
      return { stdout: "" };
    }
  });
  assert.equal(result.commitRange, `${"3".repeat(40)}...${head}`);
  assert.deepEqual(calls.at(0), ["diff", "--check"]);
  assert.deepEqual(calls.at(1), ["diff", "--cached", "--check"]);
  assert.deepEqual(calls.at(-1), ["diff", "--check", `${"3".repeat(40)}...${head}`]);
});

test("本地 diff 检查始终覆盖工作树与暂存区", async () => {
  const calls = [];
  const result = await runGitDiffCheck({
    environment: {},
    runGit: async (arguments_) => {
      calls.push(arguments_);
      return { stdout: "" };
    }
  });
  assert.deepEqual(calls, [
    ["diff", "--check"],
    ["diff", "--cached", "--check"],
    ["ls-files", "--others", "--exclude-standard", "-z"]
  ]);
  assert.equal(result.commitRange, null);
  assert.equal(result.untrackedFileCount, 0);
});

test("本地 diff 检查不放过未跟踪文件的空白错误", async () => {
  let emptyFilePath = null;
  await assert.rejects(
    () => runGitDiffCheck({
      environment: {},
      runGit: async (arguments_) => {
        if (arguments_[0] === "ls-files") return { stdout: "new-file.mjs\0" };
        if (arguments_.includes("--no-index")) {
          emptyFilePath = arguments_.at(-2);
          throw Object.assign(new Error("diff check failed"), {
            code: 3,
            stdout: "new-file.mjs:1: trailing whitespace.\n"
          });
        }
        return { stdout: "" };
      }
    }),
    /未跟踪文件未通过/u
  );
  assert.notEqual(emptyFilePath, "/dev/null");
  assert.notEqual(emptyFilePath, "NUL");
});

test("依赖指纹绑定 lockfile、manifest、workspace 与运行时", () => {
  const input = {
    lockfile: "lock-v1",
    workspace: "packages: []",
    nodeVersion: "24.19.0",
    packageDocument: {
      packageManager: "pnpm@11.19.0",
      engines: { node: "24.19.0", pnpm: "11.19.0" },
      dependencies: { react: "19.2.8" },
      devDependencies: { esbuild: "0.28.1" }
    }
  };
  const first = dependencyFingerprint(input);
  assert.equal(first, dependencyFingerprint(structuredClone(input)));
  assert.notEqual(first, dependencyFingerprint({ ...input, lockfile: "lock-v2" }));
  assert.notEqual(first, dependencyFingerprint({
    ...input,
    packageDocument: { ...input.packageDocument, dependencies: { react: "20.0.0" } }
  }));
});

test("依赖状态同时校验 marker、安装 lock 副本和直接依赖可解析性", () => {
  const ready = evaluateDependencyState({
    expectedFingerprint: "abc",
    marker: { schemaVersion: "ai-concept-studio-dependencies-v1", fingerprint: "abc" },
    rootLockSha256: "lock",
    installedLockSha256: "lock",
    modulesManifestPresent: true,
    unresolvedPackages: []
  });
  assert.deepEqual(ready, { ready: true, reasons: [] });
  assert.deepEqual(evaluateDependencyState({
    expectedFingerprint: "abc",
    marker: null,
    rootLockSha256: "lock",
    installedLockSha256: "stale",
    modulesManifestPresent: false,
    unresolvedPackages: ["react"]
  }), {
    ready: false,
    reasons: [
      "dependency-marker-missing",
      "installed-lockfile-mismatch",
      "pnpm-modules-manifest-missing",
      "direct-dependency-unresolved:react"
    ]
  });
});

test("PNG 审计真实解码像素，拒绝单色帧并要求代表帧发生变化", () => {
  const first = rgbaPng(2, 2, [[20, 40, 60, 255], [200, 220, 240, 255]]);
  const second = rgbaPng(2, 2, [[21, 40, 60, 255], [200, 219, 240, 255]]);
  const decoded = decodePngPixels(first);
  assert.deepEqual({ width: decoded.width, height: decoded.height }, { width: 2, height: 2 });
  const audit = auditPngFrameSet([
    { frame: 0, bytes: first },
    { frame: 55, bytes: second }
  ], { expectedWidth: 2, expectedHeight: 2 });
  assert.equal(audit.distinctFrameCount, 2);
  assert.ok(audit.frames.every(({ uniqueColors }) => uniqueColors === 2));
  assert.throws(
    () => auditPngFrameSet([
      { frame: 0, bytes: rgbaPng(2, 2, [[255, 255, 255, 255]]) },
      { frame: 55, bytes: rgbaPng(2, 2, [[0, 0, 0, 255]]) }
    ], { expectedWidth: 2, expectedHeight: 2 }),
    /单色/u
  );
  const almostBlack = Array.from({ length: 10_000 }, () => [0, 0, 0, 255]);
  almostBlack[5_000] = [255, 255, 255, 255];
  assert.throws(
    () => auditPngFrame(rgbaPng(100, 100, almostBlack)),
    /有效亮度面积过小/u
  );
});
