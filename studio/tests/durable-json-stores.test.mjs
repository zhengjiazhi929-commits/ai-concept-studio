import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectorDataRoot,
  researchDataRoot
} from "../src/shared/paths.mjs";
import {
  readCollectorSourceHealth,
  readLatestCollectorRun,
  updateCollectorSourceHealth,
  writeCollectorAssistTask,
  writeCollectorRun
} from "../src/server/collector/store.mjs";
import {
  readLatestResearchPack,
  writeResearchPack
} from "../src/server/research/store.mjs";
import { writeTrendRun } from "../src/server/trends/store.mjs";
import {
  publishImmutableJsonWithPointers,
  publishJsonDocumentSet,
  readJsonDocumentSetPointer,
  recoverJsonDocumentSet,
  recoverJsonPublication
} from "../src/shared/durable-json-store.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(testDirectory, "helpers", "durable-json-store-worker.mjs");

async function isolatedStore(t, kind) {
  const root = await mkdtemp(join(tmpdir(), `acs-${kind}-store-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeRoot = resolve(kind === "collector" ? collectorDataRoot : researchDataRoot);
  const isolatedRoot = resolve(root);
  assert.equal(
    isolatedRoot === runtimeRoot || isolatedRoot.startsWith(`${runtimeRoot}${sep}`),
    false,
    `${kind} store tests must never use the production data root`
  );
  return isolatedRoot;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function collectorRun(id, sequence = 0) {
  return {
    schemaVersion: 1,
    id,
    startedAt: `2026-08-31T12:00:${String(sequence).padStart(2, "0")}.000Z`,
    status: "completed",
    observations: []
  };
}

function researchPack(id, episodeId = "episode-concurrent", sequence = 0) {
  return {
    schemaVersion: 1,
    id,
    episodeId,
    updatedAt: `2026-08-31T12:00:${String(sequence).padStart(2, "0")}.000Z`,
    sources: [],
    claims: []
  };
}

function startWorker(mode, root, barrierPath, index) {
  return spawn(process.execPath, [workerPath, mode, root, barrierPath, String(index)], {
    cwd: resolve(testDirectory, ".."),
    stdio: ["ignore", "pipe", "pipe"]
  });
}

async function waitForChild(child, expectedExitCode = 0) {
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolveExit) => child.once("exit", resolveExit));
  assert.equal(
    exitCode,
    expectedExitCode,
    `durable JSON worker failed\nstdout: ${Buffer.concat(stdout)}\nstderr: ${Buffer.concat(stderr)}`
  );
}

async function waitForPath(path, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await access(path);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
  }
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, rejectTimeout) => {
        timeout = setTimeout(() => rejectTimeout(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function terminateWorkerAfterJournal(child, journalPath) {
  const stdout = [];
  const stderr = [];
  let readyResolve;
  const ready = new Promise((resolveReady) => {
    readyResolve = resolveReady;
  });
  child.stdout.on("data", (chunk) => {
    stdout.push(chunk);
    if (Buffer.concat(stdout).includes("ready\n")) readyResolve();
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  let exitResult = null;
  const exited = new Promise((resolveExit) =>
    child.once("exit", (exitCode, signal) => resolveExit({ exitCode, signal }))
  ).then((result) => {
    exitResult = result;
    return result;
  });
  try {
    await withTimeout(ready, 5000, "durable JSON worker did not report ready");
    await Promise.race([
      waitForPath(journalPath),
      exited.then((result) => {
        throw new Error(
          `worker exited before journal commit (${result.exitCode}/${result.signal})`
        );
      })
    ]);
    assert.equal(child.kill("SIGSTOP"), true, "worker must still be in the commit window");
    assert.equal(child.kill("SIGKILL"), true, "worker must be terminated externally");
    const result = await withTimeout(
      exited,
      5000,
      "durable JSON worker did not exit after SIGKILL"
    );
    assert.equal(
      result.signal,
      "SIGKILL",
      `worker did not terminate in the commit window\nstdout: ${Buffer.concat(stdout)}\nstderr: ${Buffer.concat(stderr)}`
    );
  } finally {
    if (!exitResult) child.kill("SIGKILL");
    await withTimeout(
      exited,
      5000,
      "durable JSON worker cleanup did not complete"
    ).catch(() => undefined);
  }
}

async function findTemporaryFiles(root) {
  const entries = await readdir(root, { recursive: true });
  return entries.filter((entry) => /\.tmp$/u.test(entry));
}

async function readRunDocuments(root) {
  const names = (await readdir(resolve(root, "runs"))).filter((name) => name.endsWith(".json"));
  return Promise.all(names.map((name) => readJson(resolve(root, "runs", name))));
}

test("collector run 先固化不可变版本再发布 latest，重复 ID 不可静默覆盖", async (t) => {
  const collectorRoot = await isolatedStore(t, "collector");
  const run = collectorRun("collector-one");
  const options = { collectorRoot };

  const runPath = await writeCollectorRun(run, options);
  assert.deepEqual(await readJson(runPath), run);
  assert.deepEqual(await readLatestCollectorRun(options), run);
  await writeCollectorRun(run, options);
  await assert.rejects(
    writeCollectorRun({ ...run, status: "failed" }, options),
    (error) => error?.code === "immutable_json_conflict"
  );
  assert.deepEqual(await readJson(runPath), run);
  assert.deepEqual(await findTemporaryFiles(collectorRoot), []);
});

test("空 store 的 latest 读取保持无副作用，不创建 SQLite 文件", async (t) => {
  const collectorRoot = await isolatedStore(t, "collector");
  assert.equal(await readLatestCollectorRun({ collectorRoot }), null);
  assert.deepEqual(await readdir(collectorRoot), []);
});

test("同进程 collector source-health 并发 RMW 不丢失更新", async (t) => {
  const collectorRoot = await isolatedStore(t, "collector");
  const options = { collectorRoot };
  const count = 24;
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      updateCollectorSourceHealth(
        [{ creatorId: `same-process-${index}`, status: "healthy", sequence: index }],
        `2026-08-31T12:00:${String(index).padStart(2, "0")}.000Z`,
        options
      )
    )
  );

  const health = await readCollectorSourceHealth(options);
  assert.equal(health.sources.length, count);
  assert.deepEqual(
    new Set(health.sources.map((source) => source.creatorId)),
    new Set(Array.from({ length: count }, (_, index) => `same-process-${index}`))
  );
});

test("跨进程 collector source-health 并发 RMW 由 SQLite 写互斥串行", async (t) => {
  const collectorRoot = await isolatedStore(t, "collector");
  const barrierPath = resolve(collectorRoot, "start-workers");
  const workerCount = 12;
  const children = Array.from({ length: workerCount }, (_, index) =>
    startWorker("collector-health", collectorRoot, barrierPath, index)
  );
  await writeFile(barrierPath, "go\n", "utf8");
  await Promise.all(children.map((child) => waitForChild(child)));

  const health = await readCollectorSourceHealth({ collectorRoot });
  assert.equal(health.sources.length, workerCount);
  for (let index = 0; index < workerCount; index += 1) {
    assert.equal(health.sources.some((source) => source.creatorId === `creator-${index}`), true);
  }
});

test("collector 多进程 run/latest 发布保留全部不可变 run 且 latest 始终有效", async (t) => {
  const collectorRoot = await isolatedStore(t, "collector");
  const barrierPath = resolve(collectorRoot, "start-run-workers");
  const workerCount = 10;
  const children = Array.from({ length: workerCount }, (_, index) =>
    startWorker("collector-run", collectorRoot, barrierPath, index)
  );
  await writeFile(barrierPath, "go\n", "utf8");
  await Promise.all(children.map((child) => waitForChild(child)));

  const latest = await readLatestCollectorRun({ collectorRoot });
  assert.match(latest.id, /^collector-run-\d+$/u);
  for (let index = 0; index < workerCount; index += 1) {
    const run = await readJson(resolve(collectorRoot, "runs", `collector-run-${index}.json`));
    assert.equal(run.id, `collector-run-${index}`);
  }
  assert.deepEqual(await findTemporaryFiles(collectorRoot), []);
});

test("research 多进程发布让全局与 episode latest 指向同一完整 run", async (t) => {
  const researchRoot = await isolatedStore(t, "research");
  const barrierPath = resolve(researchRoot, "start-workers");
  const workerCount = 10;
  const children = Array.from({ length: workerCount }, (_, index) =>
    startWorker("research-pack", researchRoot, barrierPath, index)
  );
  await writeFile(barrierPath, "go\n", "utf8");
  await Promise.all(children.map((child) => waitForChild(child)));

  const [globalLatest, episodeLatest] = await Promise.all([
    readLatestResearchPack(null, { researchRoot }),
    readLatestResearchPack("episode-concurrent", { researchRoot })
  ]);
  assert.deepEqual(globalLatest, episodeLatest);
  assert.match(globalLatest.id, /^research-run-\d+$/u);
  const runs = await readRunDocuments(researchRoot);
  assert.equal(runs.length, workerCount);
  assert.deepEqual(
    new Set(runs.map((run) => run.id)),
    new Set(Array.from({ length: workerCount }, (_, index) => `research-run-${index}`))
  );
  assert.deepEqual(await findTemporaryFiles(researchRoot), []);
});

test("同一 research pack ID 的不同修订写入不同不可变内容哈希文件", async (t) => {
  const researchRoot = await isolatedStore(t, "research");
  const first = researchPack("research-logical-id", "episode-revision", 0);
  const second = {
    ...first,
    updatedAt: "2026-08-31T12:00:01.000Z",
    claims: [{ id: "claim-new", support: "supported" }]
  };

  const firstPath = await writeResearchPack(first, { researchRoot });
  const secondPath = await writeResearchPack(second, { researchRoot });
  assert.notEqual(firstPath, secondPath);
  assert.deepEqual(await readJson(firstPath), first);
  assert.deepEqual(await readJson(secondPath), second);
  assert.deepEqual(await readLatestResearchPack("episode-revision", { researchRoot }), second);
});

test("collector 写进程在 journal 后崩溃，读取无副作用可见且下次写入重放 latest", async (t) => {
  const collectorRoot = await isolatedStore(t, "collector");
  const child = startWorker("collector-crash-window", collectorRoot, "-", 0);
  await terminateWorkerAfterJournal(
    child,
    resolve(collectorRoot, ".collector-publication.json")
  );

  assert.equal((await readJson(resolve(collectorRoot, "runs", "collector-crash-run.json"))).id,
    "collector-crash-run");
  const visible = await readLatestCollectorRun({ collectorRoot });
  assert.equal(visible.id, "collector-crash-run");
  assert.equal(
    (await readJson(resolve(collectorRoot, ".collector-publication.json"))).schemaVersion,
    1
  );

  const next = collectorRun("collector-after-crash", 1);
  await writeCollectorRun(next, { collectorRoot });
  assert.deepEqual(await readLatestCollectorRun({ collectorRoot }), next);
  assert.deepEqual(
    await readJson(resolve(collectorRoot, "crash-pointers", "255.json")),
    collectorRun("collector-crash-run")
  );
  await assert.rejects(readFile(resolve(collectorRoot, ".collector-publication.json"), "utf8"), {
    code: "ENOENT"
  });
});

test("research 写进程崩溃后重放两个 latest 指针且不遗留不可恢复文件锁", async (t) => {
  const researchRoot = await isolatedStore(t, "research");
  const child = startWorker("research-crash-window", researchRoot, "-", 0);
  await terminateWorkerAfterJournal(
    child,
    resolve(researchRoot, ".research-publication.json")
  );

  const crashRuns = await readRunDocuments(researchRoot);
  assert.equal(crashRuns.length, 1);
  assert.equal(crashRuns[0].id, "research-crash-run");
  const episodeLatest = await readLatestResearchPack("episode-crash", { researchRoot });
  const globalLatest = await readLatestResearchPack(null, { researchRoot });
  assert.equal(episodeLatest.id, "research-crash-run");
  assert.deepEqual(globalLatest, episodeLatest);
  assert.equal(
    (await readJson(resolve(researchRoot, ".research-publication.json"))).schemaVersion,
    1
  );

  const next = researchPack("research-after-crash", "episode-crash", 1);
  await writeResearchPack(next, { researchRoot });
  assert.deepEqual(await readLatestResearchPack("episode-crash", { researchRoot }), next);
  assert.deepEqual(
    await readJson(resolve(researchRoot, "crash-pointers", "255.json")),
    researchPack("research-crash-run", "episode-crash")
  );
  await assert.rejects(readFile(resolve(researchRoot, ".research-publication.json"), "utf8"), {
    code: "ENOENT"
  });
});

test("durable store 公开 API 拒绝自有或继承阶段 hook 且零写入", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "acs-durable-hook-boundary-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  let callbackInvocations = 0;
  const inheritedPublicationOptions = Object.create({
    onPublicationStage() {
      callbackInvocations += 1;
    }
  });
  const inheritedDocumentSetOptions = Object.create({
    onDocumentSetStage() {
      callbackInvocations += 1;
    }
  });
  const cases = [
    {
      root: resolve(parent, "publish-run"),
      invoke(root) {
        return publishImmutableJsonWithPointers({
          root,
          journalName: ".publication.json",
          runPath: resolve(root, "runs", "run.json"),
          value: { schemaVersion: 1, id: "forbidden" },
          pointerPaths: [resolve(root, "latest.json")],
          options: {
            onPublicationStage() {
              callbackInvocations += 1;
            }
          }
        });
      }
    },
    {
      root: resolve(parent, "recover-run"),
      invoke(root) {
        return recoverJsonPublication(root, ".publication.json", inheritedPublicationOptions);
      }
    },
    {
      root: resolve(parent, "publish-set"),
      invoke(root) {
        return publishJsonDocumentSet({
          root,
          journalName: ".document-set.json",
          documents: [{ path: resolve(root, "one.json"), value: { id: "one" } }],
          options: {
            onDocumentSetStage() {
              callbackInvocations += 1;
            }
          }
        });
      }
    },
    {
      root: resolve(parent, "recover-set"),
      invoke(root) {
        return recoverJsonDocumentSet(root, ".document-set.json", inheritedDocumentSetOptions);
      }
    }
  ];

  for (const scenario of cases) {
    await assert.rejects(
      scenario.invoke(scenario.root),
      (error) => error?.code === "durable_json_store_hook_forbidden"
    );
    await assert.rejects(access(scenario.root), { code: "ENOENT" });
  }
  assert.equal(callbackInvocations, 0);
});

test("collector research trends 入口在建锁前拒绝调用方 durable hook", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "acs-store-hook-boundary-"));
  t.after(() => rm(parent, { recursive: true, force: true }));

  const collectorRoot = resolve(parent, "collector");
  const collectorOptions = Object.create({ onPublicationStage() {} });
  collectorOptions.collectorRoot = collectorRoot;
  await assert.rejects(
    writeCollectorRun(collectorRun("collector-hook"), collectorOptions),
    (error) => error?.code === "durable_json_store_hook_forbidden"
  );

  const researchRoot = resolve(parent, "research");
  await assert.rejects(
    writeResearchPack(researchPack("research-hook"), {
      researchRoot,
      onPublicationStage() {}
    }),
    (error) => error?.code === "durable_json_store_hook_forbidden"
  );

  const trendsRoot = resolve(parent, "trends");
  await assert.rejects(
    writeTrendRun({ schemaVersion: 1, id: "trend-hook", candidates: [] }, {
      trendsRoot,
      onStaleLockObserved() {}
    }),
    (error) => error?.code === "durable_json_store_hook_forbidden"
  );

  for (const root of [collectorRoot, researchRoot, trendsRoot]) {
    await assert.rejects(access(root), { code: "ENOENT" });
  }
});

test("多文档 journal 在真实 commit 窗口被外部终止后完整恢复", async (t) => {
  const root = await isolatedStore(t, "collector");
  const journalName = ".document-set-publication.json";
  const journalPath = resolve(root, journalName);
  const child = startWorker("document-set-crash-window", root, "-", 0);
  await terminateWorkerAfterJournal(child, journalPath);

  const visibleLast = await readJsonDocumentSetPointer(
    root,
    journalName,
    resolve(root, "document-set", "255.json"),
    null
  );
  assert.equal(visibleLast.documentIndex, 255);
  const recovered = await recoverJsonDocumentSet(root, journalName);
  assert.equal(recovered.targetPaths.length, 256);
  assert.equal(
    (await readJson(resolve(root, "document-set", "0.json"))).documentIndex,
    0
  );
  assert.equal(
    (await readJson(resolve(root, "document-set", "255.json"))).documentIndex,
    255
  );
  await assert.rejects(readFile(journalPath, "utf8"), { code: "ENOENT" });
});

test("无锁的单文件并发写也使用唯一临时文件并只留下有效 JSON", async (t) => {
  const collectorRoot = await isolatedStore(t, "collector");
  const options = { collectorRoot };
  const tasks = Array.from({ length: 40 }, (_, index) => ({
    schemaVersion: 1,
    taskId: `assist-${index}`
  }));
  await Promise.all(tasks.map((task) => writeCollectorAssistTask(task, options)));
  const saved = await readJson(resolve(collectorRoot, "assist-task.json"));
  assert.equal(tasks.some((task) => task.taskId === saved.taskId), true);
  assert.deepEqual(await findTemporaryFiles(collectorRoot), []);
});

test("durable store 拒绝 runs 祖先或最终目标符号链接，不能写出 store root", async (t) => {
  const collectorRoot = await isolatedStore(t, "collector");
  const outside = await mkdtemp(join(tmpdir(), "acs-collector-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, resolve(collectorRoot, "runs"));

  await assert.rejects(
    writeCollectorRun(collectorRun("ancestor-escape"), { collectorRoot }),
    (error) => error?.code === "durable_json_store_path_unsafe"
  );
  await assert.rejects(readFile(resolve(outside, "ancestor-escape.json"), "utf8"), {
    code: "ENOENT"
  });

  const targetRoot = await isolatedStore(t, "collector");
  const targetOutside = resolve(outside, "target-escape.json");
  await mkdir(resolve(targetRoot, "runs"), { recursive: true });
  await writeFile(targetOutside, "outside-must-not-change\n", "utf8");
  await symlink(targetOutside, resolve(targetRoot, "runs", "target-escape.json"));

  await assert.rejects(
    writeCollectorRun(collectorRun("target-escape"), { collectorRoot: targetRoot }),
    (error) => error?.code === "durable_json_store_path_unsafe"
  );
  assert.equal(await readFile(targetOutside, "utf8"), "outside-must-not-change\n");
});
