import test from "node:test";
import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { trendsDataRoot } from "../src/shared/paths.mjs";
import { discoverTrendCandidates } from "../src/server/trends/engine.mjs";
import {
  readConceptTaxonomy,
  readLatestTrendRun,
  readTrendRadarConfig,
  readTrendSelection,
  readTrendSignals,
  readTrendSources,
  selectTrendCandidate,
  upsertTrendSignals,
  writeTrendRun
} from "../src/server/trends/store.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(testDirectory, "fixtures", "trends");

async function createFixtureStore(t) {
  const trendsRoot = await mkdtemp(join(tmpdir(), "acs-trend-engine-"));
  t.after(() => rm(trendsRoot, { recursive: true, force: true }));
  await Promise.all([
    copyFile(resolve(fixtureDirectory, "signals.json"), resolve(trendsRoot, "signals.json")),
    copyFile(resolve(fixtureDirectory, "latest.json"), resolve(trendsRoot, "latest.json"))
  ]);

  const runtimeRoot = resolve(trendsDataRoot);
  const isolatedRoot = resolve(trendsRoot);
  assert.equal(
    isolatedRoot === runtimeRoot || isolatedRoot.startsWith(`${runtimeRoot}${sep}`),
    false,
    "trend tests must never use the runtime trend root"
  );
  return { trendsRoot: isolatedRoot };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function runFixture(t) {
  const storeOptions = await createFixtureStore(t);
  const [signalDocument, sources, taxonomy, config] = await Promise.all([
    readTrendSignals(storeOptions),
    readTrendSources(),
    readConceptTaxonomy(),
    readTrendRadarConfig()
  ]);
  return discoverTrendCandidates({
    signals: signalDocument.signals,
    sources,
    taxonomy,
    config,
    coveredConceptIds: ["agentic-coding"],
    now: new Date("2026-08-03T23:00:00+08:00")
  });
}

test("热点发现按创作者共振而不是信号条数排名", async (t) => {
  const result = await runFixture(t);
  const agentSkill = result.candidates.find((candidate) => candidate.id === "agent-skill");

  assert.equal(agentSkill.recommendedPool, "formal_candidate");
  assert.equal(agentSkill.heatGate.creators14 >= 3, true);
  assert.equal(agentSkill.signalCount > agentSkill.heatGate.creators30, true);
  assert.equal(agentSkill.rank, 1);
});

test("已经制作的概念不会继续占用新一期推荐位", async (t) => {
  const result = await runFixture(t);
  const agenticCoding = result.candidates.find((candidate) => candidate.id === "agentic-coding");

  assert.equal(agenticCoding.productionState, "already_covered");
  assert.equal(agenticCoding.recommendedPool, "already_covered");
});

test("事件占主导或创作者不足的概念留在观察池", async (t) => {
  const result = await runFixture(t);
  const physicalAi = result.candidates.find((candidate) => candidate.id === "physical-ai");
  const rag = result.candidates.find((candidate) => candidate.id === "rag-engineering");

  assert.equal(physicalAi.eventDominated, true);
  assert.equal(physicalAi.recommendedPool, "observation_pool");
  assert.equal(rag.heatGate.passed, false);
  assert.equal(rag.recommendedPool, "observation_pool");
});

test("缺失互动数据不被填成虚构分数", async (t) => {
  const result = await runFixture(t);
  const agentSkill = result.candidates.find((candidate) => candidate.id === "agent-skill");

  assert.equal(agentSkill.score.components.relativePerformance.available, false);
  assert.equal(agentSkill.score.components.questionDensity.available, false);
  assert.equal(agentSkill.score.availablePoints, 70);
  assert.equal(agentSkill.confidence.level, "medium");
});

test("观察池候选不能绕过人工界面进入研究阶段", async (t) => {
  const storeOptions = await createFixtureStore(t);
  await assert.rejects(
    selectTrendCandidate("rag-engineering", "", storeOptions),
    /还没有通过正式候选门槛/u
  );
});

test("候选选择只写入注入的临时 trend root", async (t) => {
  const storeOptions = await createFixtureStore(t);
  const result = await selectTrendCandidate(
    "agent-skill",
    "synthetic fixture selection",
    storeOptions
  );
  const runPath = resolve(storeOptions.trendsRoot, "runs", `${result.run.id}.json`);
  const [savedRun, latestRun, selection] = await Promise.all([
    readJson(runPath),
    readJson(resolve(storeOptions.trendsRoot, "latest.json")),
    readJson(resolve(storeOptions.trendsRoot, "selection.json"))
  ]);

  assert.equal(savedRun.selectedCandidateId, "agent-skill");
  assert.equal(latestRun.selectedCandidateId, "agent-skill");
  assert.equal(selection.candidateId, "agent-skill");
});

test("trend run 拒绝调用方阶段 hook 且正常发布仍保持 run/latest 一致", async (t) => {
  const storeOptions = await createFixtureStore(t);
  const baseline = await readJson(resolve(storeOptions.trendsRoot, "latest.json"));
  const rejected = { ...baseline, id: "trend-rejected-hook" };

  await assert.rejects(
    writeTrendRun(rejected, {
      ...storeOptions,
      onDocumentSetStage() {}
    }),
    (error) => error?.code === "durable_json_store_hook_forbidden"
  );
  assert.deepEqual(await readJson(resolve(storeOptions.trendsRoot, "latest.json")), baseline);
  await assert.rejects(
    readFile(resolve(storeOptions.trendsRoot, "runs", `${rejected.id}.json`), "utf8"),
    { code: "ENOENT" }
  );

  const next = { ...baseline, id: "trend-normal-publication" };
  await writeTrendRun(next, storeOptions);
  assert.deepEqual(await readLatestTrendRun(storeOptions), next);
  assert.deepEqual(
    await readJson(resolve(storeOptions.trendsRoot, "runs", `${next.id}.json`)),
    next
  );
  await assert.rejects(
    readFile(resolve(storeOptions.trendsRoot, ".trend-publication.json"), "utf8"),
    { code: "ENOENT" }
  );
});

test("候选选择拒绝继承阶段 hook，随后正常发布保持 run/latest/selection 一致", async (t) => {
  const storeOptions = await createFixtureStore(t);
  const inheritedOptions = Object.create({ onDocumentSetStage() {} });
  inheritedOptions.trendsRoot = storeOptions.trendsRoot;
  await assert.rejects(
    selectTrendCandidate("agent-skill", "rejected hook", inheritedOptions),
    (error) => error?.code === "durable_json_store_hook_forbidden"
  );
  await assert.rejects(
    readFile(resolve(storeOptions.trendsRoot, "selection.json"), "utf8"),
    { code: "ENOENT" }
  );

  await selectTrendCandidate("agent-skill", "normal selection", storeOptions);
  const [savedRun, savedSelection] = await Promise.all([
    readJson(resolve(storeOptions.trendsRoot, "latest.json")),
    readJson(resolve(storeOptions.trendsRoot, "selection.json"))
  ]);
  assert.equal(savedRun.selectedCandidateId, savedSelection.candidateId);
  assert.equal(savedSelection.runId, savedRun.id);
  await assert.rejects(
    readFile(resolve(storeOptions.trendsRoot, ".trend-publication.json"), "utf8"),
    { code: "ENOENT" }
  );
});

function concurrentSignal(index, prefix = "same-process") {
  return {
    id: `${prefix}-${index}`,
    creatorId: "douyin-qiu-shui",
    title: `${prefix} unique signal ${index}`,
    sourceUrl: `https://example.test/trends/${prefix}-${index}`,
    publishedAt: `2026-08-${String(4 + index).padStart(2, "0")}T00:00:00+08:00`,
    observedAt: "2026-08-31T12:00:00+08:00",
    datePrecision: "exact",
    angle: "mechanism",
    conceptIds: ["agent-skill"],
    sourceKind: "test-fixture"
  };
}

async function waitForChild(child) {
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolveExit) => child.once("exit", resolveExit));
  assert.equal(
    exitCode,
    0,
    `trend upsert worker failed\nstdout: ${Buffer.concat(stdout)}\nstderr: ${Buffer.concat(stderr)}`
  );
}

test("同一进程中的并发 upsert 不丢失信号且始终留下有效 JSON", async (t) => {
  const storeOptions = await createFixtureStore(t);
  const baseline = (await readTrendSignals(storeOptions)).signals.length;
  const signals = Array.from({ length: 20 }, (_, index) => concurrentSignal(index));

  await Promise.all(signals.map((signal) => upsertTrendSignals([signal], storeOptions)));

  const saved = await readJson(resolve(storeOptions.trendsRoot, "signals.json"));
  assert.equal(saved.signals.length, baseline + signals.length);
  assert.deepEqual(
    new Set(saved.signals.map((signal) => signal.id)),
    new Set([
      ...(await readJson(resolve(fixtureDirectory, "signals.json"))).signals.map(
        (signal) => signal.id
      ),
      ...signals.map((signal) => signal.id)
    ])
  );
});

test("不同进程中的并发 upsert 由同一 store 锁串行化", async (t) => {
  const storeOptions = await createFixtureStore(t);
  const baseline = (await readTrendSignals(storeOptions)).signals.length;
  const barrierPath = resolve(storeOptions.trendsRoot, "start-workers");
  const workerPath = resolve(testDirectory, "helpers", "trend-upsert-worker.mjs");
  const workerCount = 12;
  const children = Array.from({ length: workerCount }, (_, index) =>
    spawn(process.execPath, [workerPath, storeOptions.trendsRoot, barrierPath, String(index)], {
      cwd: resolve(testDirectory, ".."),
      stdio: ["ignore", "pipe", "pipe"]
    })
  );

  await writeFile(barrierPath, "go\n", "utf8");
  await Promise.all(children.map(waitForChild));

  const saved = await readJson(resolve(storeOptions.trendsRoot, "signals.json"));
  assert.equal(saved.signals.length, baseline + workerCount);
  for (let index = 0; index < workerCount; index += 1) {
    assert.equal(saved.signals.some((signal) => signal.id === `cross-process-${index}`), true);
  }
});

test("崩溃进程遗留的锁会被隔离，存活进程的锁不会被超时写入者删除", async (t) => {
  const staleStore = await createFixtureStore(t);
  const exitedChild = spawn(process.execPath, ["-e", ""], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  const exitedPid = exitedChild.pid;
  await waitForChild(exitedChild);
  await writeFile(
    resolve(staleStore.trendsRoot, ".store.lock"),
    `${JSON.stringify({
      schemaVersion: 1,
      token: "stale-test-owner",
      pid: exitedPid,
      hostname: hostname(),
      createdAt: "2026-08-31T12:00:00.000Z"
    })}\n`,
    "utf8"
  );

  await upsertTrendSignals([concurrentSignal(0, "stale-recovery")], staleStore);
  const recovered = await readTrendSignals(staleStore);
  assert.equal(recovered.signals.some((signal) => signal.id === "stale-recovery-0"), true);
  await assert.rejects(readFile(resolve(staleStore.trendsRoot, ".store.lock")), {
    code: "ENOENT"
  });

  const liveStore = await createFixtureStore(t);
  const liveOwner = {
    schemaVersion: 1,
    token: "live-test-owner",
    pid: process.pid,
    hostname: hostname(),
    createdAt: new Date().toISOString()
  };
  await writeFile(
    resolve(liveStore.trendsRoot, ".store.lock"),
    `${JSON.stringify(liveOwner)}\n`,
    "utf8"
  );
  await assert.rejects(
    upsertTrendSignals([concurrentSignal(1, "live-owner")], {
      ...liveStore,
      lockTimeoutMs: 25,
      lockRetryDelayMs: 5
    }),
    (error) => error?.code === "trend_store_lock_busy"
  );
  assert.deepEqual(
    await readJson(resolve(liveStore.trendsRoot, ".store.lock")),
    liveOwner
  );
});

test("两个旧锁回收者由 SQLite 串行且都不丢失写入", async (t) => {
  const storeOptions = await createFixtureStore(t);
  const exitedChild = spawn(process.execPath, ["-e", ""], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  const exitedPid = exitedChild.pid;
  await waitForChild(exitedChild);
  const staleOwner = {
    schemaVersion: 1,
    token: "stale-aba-owner",
    pid: exitedPid,
    hostname: hostname(),
    createdAt: "2026-08-31T12:00:00.000Z"
  };
  await writeFile(
    resolve(storeOptions.trendsRoot, ".store.lock"),
    `${JSON.stringify(staleOwner)}\n`,
    "utf8"
  );

  const first = upsertTrendSignals(
    [concurrentSignal(20, "aba-first")],
    storeOptions
  );
  const second = upsertTrendSignals([concurrentSignal(21, "aba-second")], {
    ...storeOptions,
    lockTimeoutMs: 1_000,
    lockRetryDelayMs: 5
  });
  await Promise.all([first, second]);
  await assert.rejects(
    readFile(resolve(storeOptions.trendsRoot, ".store.lock"), "utf8"),
    { code: "ENOENT" }
  );
  const saved = await readTrendSignals(storeOptions);
  assert.equal(saved.signals.some((signal) => signal.id === "aba-first-20"), true);
  assert.equal(saved.signals.some((signal) => signal.id === "aba-second-21"), true);
});

test("持有 SQLite 写锁的进程崩溃后，操作系统会释放锁且后续写入可恢复", async (t) => {
  const storeOptions = await createFixtureStore(t);
  const databasePath = resolve(storeOptions.trendsRoot, ".store-lock.sqlite");
  const holder = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        "import {DatabaseSync} from 'node:sqlite';",
        `const database = new DatabaseSync(${JSON.stringify(databasePath)});`,
        "database.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');",
        "process.stdout.write('ready\\n');",
        "setInterval(() => undefined, 1000);"
      ].join("\n")
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  await new Promise((resolveReady, rejectReady) => {
    let stdout = "";
    let stderr = "";
    holder.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("ready\n")) resolveReady();
    });
    holder.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    holder.once("exit", (code) => {
      rejectReady(new Error(`lock holder exited before ready (${code}): ${stderr}`));
    });
  });
  const holderExit = new Promise((resolveExit) => holder.once("exit", resolveExit));
  holder.kill("SIGKILL");
  await holderExit;

  await upsertTrendSignals([concurrentSignal(22, "crash-recovery")], {
    ...storeOptions,
    lockTimeoutMs: 1_000,
    lockRetryDelayMs: 5
  });
  const saved = await readTrendSignals(storeOptions);
  assert.equal(saved.signals.some((signal) => signal.id === "crash-recovery-22"), true);
});

test("trend root 符号链接在 SQLite open 前被拒绝且不会在外部创建锁文件", async (t) => {
  const parent = await mkdtemp(join(tmpdir(), "acs-trend-root-link-"));
  const outside = resolve(parent, "outside");
  const linkedRoot = resolve(parent, "linked-trends");
  t.after(() => rm(parent, { recursive: true, force: true }));
  await mkdir(outside);
  await symlink(outside, linkedRoot);

  await assert.rejects(
    upsertTrendSignals([concurrentSignal(2, "root-link")], {
      trendsRoot: linkedRoot
    }),
    (error) => error?.code === "durable_json_store_path_unsafe"
  );
  await assert.rejects(readFile(resolve(outside, ".store-lock.sqlite")), {
    code: "ENOENT"
  });
});

test("signals.json 符号链接不能读取或覆盖 store 外部文件", async (t) => {
  const storeOptions = await createFixtureStore(t);
  const outsideDirectory = await mkdtemp(join(tmpdir(), "acs-trend-signals-outside-"));
  const outsideSignals = resolve(outsideDirectory, "external-signals.json");
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const original = "{\"external\":true}\n";
  await writeFile(outsideSignals, original, "utf8");
  await rm(resolve(storeOptions.trendsRoot, "signals.json"));
  await symlink(outsideSignals, resolve(storeOptions.trendsRoot, "signals.json"));

  await assert.rejects(
    readTrendSignals(storeOptions),
    (error) => error?.code === "durable_json_store_path_unsafe"
  );
  await assert.rejects(
    upsertTrendSignals([concurrentSignal(3, "target-link")], storeOptions),
    (error) => error?.code === "durable_json_store_path_unsafe"
  );
  assert.equal(await readFile(outsideSignals, "utf8"), original);
});
