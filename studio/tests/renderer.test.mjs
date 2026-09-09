import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  bundleVideoProjectForRender,
  createVideoBundleSnapshot,
  nextRenderFileName,
  renderPreview,
  resolveBrowserExecutable
} from "../src/server/renderer.mjs";
import { inspectFileIntegrity, matchesFileIntegrity } from "../src/shared/integrity.mjs";
import { nextQaReportFileName } from "../src/server/qa.mjs";
import {
  bundleVideoProjectForRenderHarness,
  createRendererHarness,
  createVideoBundleSnapshotHarness
} from "./helpers/renderer-harness.mjs";

test("渲染输出自动递增版本，不覆盖已有视频", () => {
  assert.equal(nextRenderFileName([]), "preview-v001.mp4");
  assert.equal(
    nextRenderFileName(["preview-v001.mp4", "preview-qa-v001.json", "preview-v003.mp4"]),
    "preview-v004.mp4"
  );
  assert.equal(
    nextRenderFileName(["preview-v001.rendering.mp4"]),
    "preview-v002.mp4",
    "崩溃遗留的当前版本必须保留并跳到下一版本，不能先覆盖再依赖失败清理"
  );
});

test("每次正式渲染都重新构建包含当前 publicDir 的 bundle", async () => {
  const calls = [];
  const bundleProject = async (options) => {
    calls.push(options);
    return `bundle-${calls.length}`;
  };
  const options = {
    entryPoint: "/tmp/video/index.jsx",
    publicDirectory: "/tmp/public",
    outDirectory: "/tmp/bundle-out"
  };

  assert.equal(
    await bundleVideoProjectForRenderHarness(options, { bundleProject }),
    "bundle-1"
  );
  assert.equal(
    await bundleVideoProjectForRenderHarness(options, { bundleProject }),
    "bundle-2"
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ entryPoint, publicDir, outDir }) => ({
    entryPoint,
    publicDir,
    outDir
  })), [
    {
      entryPoint: "/tmp/video/index.jsx",
      publicDir: "/tmp/public",
      outDir: "/tmp/bundle-out"
    },
    {
      entryPoint: "/tmp/video/index.jsx",
      publicDir: "/tmp/public",
      outDir: "/tmp/bundle-out"
    }
  ]);
});

test("正式 bundle 使用独立临时目录，并在渲染后只清理自己的快照", async () => {
  const removed = [];
  const snapshot = await createVideoBundleSnapshotHarness({
    entryPoint: "/tmp/video/index.jsx",
    publicDirectory: "/tmp/public"
  }, {
    mkdtemp: async () => "/tmp/acs-render-bundle-fixture",
    rm: async (path, options) => removed.push({ path, options }),
    bundleProject: async (options) => {
      assert.equal(options.outDir, "/tmp/acs-render-bundle-fixture/bundle");
      assert.equal(options.symlinkPublicDir, false);
      return options.outDir;
    }
  });
  assert.equal(snapshot.serveUrl, "/tmp/acs-render-bundle-fixture/bundle");
  assert.equal(await snapshot.cleanup(), true);
  assert.equal(await snapshot.cleanup(), false);
  assert.deepEqual(removed, [{
    path: "/tmp/acs-render-bundle-fixture",
    options: { recursive: true, force: true }
  }]);
});

test("正式 bundle helpers 直接导入时在任何 I/O 前拒绝函数注入", async () => {
  let bundleInjectionReads = 0;
  let bundlePathReads = 0;
  const bundleOptions = Object.defineProperties({}, {
    bundleProject: {
      get() {
        bundleInjectionReads += 1;
        return async () => "must-not-run";
      }
    },
    entryPoint: {
      get() {
        bundlePathReads += 1;
        return "/must-not-be-read.jsx";
      }
    }
  });
  await assert.rejects(
    bundleVideoProjectForRender(bundleOptions),
    /does not accept dependency injection/u
  );
  assert.equal(bundleInjectionReads, 0);
  assert.equal(bundlePathReads, 0);

  for (const forbiddenProperty of ["mkdtemp", "rm", "bundleProject"]) {
    let snapshotInjectionReads = 0;
    let snapshotPathReads = 0;
    const snapshotOptions = Object.defineProperties({}, {
      [forbiddenProperty]: {
        get() {
          snapshotInjectionReads += 1;
          return async () => undefined;
        }
      },
      entryPoint: {
        get() {
          snapshotPathReads += 1;
          return "/must-not-be-read.jsx";
        }
      }
    });
    await assert.rejects(
      createVideoBundleSnapshot(snapshotOptions),
      /does not accept dependency injection/u
    );
    assert.equal(snapshotInjectionReads, 0);
    assert.equal(snapshotPathReads, 0);
  }
});

test("正式 renderPreview 直接导入时在任何 I/O 前拒绝 dependencies 注入", async () => {
  let episodeReads = 0;
  let dependencyGetterReads = 0;
  const episode = Object.defineProperty({}, "id", {
    get() {
      episodeReads += 1;
      return "must-not-be-read";
    }
  });
  const context = Object.defineProperty({}, "dependencies", {
    get() {
      dependencyGetterReads += 1;
      return { readConfig: async () => ({}) };
    }
  });

  await assert.rejects(
    renderPreview(episode, context),
    /does not accept dependency injection/u
  );
  assert.equal(episodeReads, 0);
  assert.equal(dependencyGetterReads, 0);
});

test("浏览器解析失败时仍清理已创建的正式 bundle 快照", async () => {
  let cleanupCalls = 0;
  const renderer = createRendererHarness({
    readConfig: async () => ({ browserExecutable: "/missing/chrome", render: {} }),
    episodeOutputDirectory: () => "/tmp/renderer-cleanup-browser-failure",
    mkdir: async () => {},
    readdir: async () => [],
    createVideoBundleSnapshot: async () => ({
      serveUrl: "/tmp/bundle",
      async cleanup() {
        cleanupCalls += 1;
      }
    }),
    browserOptions: async () => {
      throw new Error("synthetic browser failure");
    },
    rm: async () => {}
  });
  await assert.rejects(
    () => renderer.renderPreview({
      id: "renderer-cleanup-browser-failure",
      render: { compositionId: "ConceptPreview" },
      scenes: []
    }),
    /synthetic browser failure/u
  );
  assert.equal(cleanupCalls, 1);
});

test("bundle 清理失败不会覆盖已经发布成功的 MP4 结果", async () => {
  let cleanupWarnings = 0;
  const renderer = createRendererHarness({
    readConfig: async () => ({
      browserExecutable: null,
      render: { codec: "h264", concurrency: 1, crf: 20 }
    }),
    episodeOutputDirectory: () => "/tmp/renderer-cleanup-after-success",
    mkdir: async () => {},
    readdir: async () => [],
    createVideoBundleSnapshot: async () => ({
      serveUrl: "/tmp/bundle",
      async cleanup() {
        throw new Error("synthetic cleanup failure");
      }
    }),
    browserOptions: async () => ({}),
    selectComposition: async () => ({
      id: "ConceptPreview",
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 30
    }),
    renderMedia: async () => {},
    rename: async () => {},
    inspectFileIntegrity: async () => ({ bytes: 123456, sha256: "a".repeat(64) }),
    backupRenderedFile: async () => ({ status: "skipped" }),
    rm: async () => {}
  });
  const result = await renderer.renderPreview({
    id: "renderer-cleanup-after-success",
    render: { compositionId: "ConceptPreview" },
    scenes: []
  }, {
    onCleanupWarning(message) {
      cleanupWarnings += 1;
      assert.match(message, /synthetic cleanup failure/u);
    }
  });

  assert.equal(result.bytes, 123456);
  assert.equal(result.sha256, "a".repeat(64));
  assert.equal(cleanupWarnings, 1);
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
