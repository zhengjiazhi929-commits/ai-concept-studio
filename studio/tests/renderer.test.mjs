import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  nextRenderFileName,
  resolveBrowserExecutable
} from "../src/server/renderer.mjs";
import { inspectFileIntegrity, matchesFileIntegrity } from "../src/shared/integrity.mjs";
import { nextQaReportFileName } from "../src/server/qa.mjs";

test("渲染输出自动递增版本，不覆盖已有视频", () => {
  assert.equal(nextRenderFileName([]), "preview-v001.mp4");
  assert.equal(
    nextRenderFileName(["preview-v001.mp4", "preview-qa-v001.json", "preview-v003.mp4"]),
    "preview-v004.mp4"
  );
});

test("macOS 优先使用已经安装的本机浏览器", async () => {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const detected = await resolveBrowserExecutable(null, {
    platform: "darwin",
    environment: {},
    access: async (candidate) => {
      if (candidate !== chrome) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
  });
  assert.equal(detected, chrome);
});

test("成片完整性使用流式 SHA-256 并同时绑定字节数", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "studio-render-integrity-"));
  const filePath = resolve(directory, "preview-v001.mp4");
  try {
    await writeFile(filePath, "reviewed-render-artifact\n", "utf8");
    const first = await inspectFileIntegrity(filePath);
    assert.equal(first.bytes, 25);
    assert.match(first.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(matchesFileIntegrity(first, first), true);

    await writeFile(filePath, "replaced-render-artifact\n", "utf8");
    const replaced = await inspectFileIntegrity(filePath);
    assert.equal(matchesFileIntegrity(first, replaced), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("同一渲染版本重跑 QA 时递增报告修订号，不覆盖历史报告", () => {
  assert.equal(nextQaReportFileName([], "003"), "preview-qa-v003.json");
  assert.equal(
    nextQaReportFileName(["preview-qa-v003.json"], "003"),
    "preview-qa-v003-r002.json"
  );
  assert.equal(
    nextQaReportFileName(
      ["preview-qa-v003.json", "preview-qa-v003-r002.json", "preview-qa-v002.json"],
      "003"
    ),
    "preview-qa-v003-r003.json"
  );
});
