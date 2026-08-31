import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { writeVersionedJson } from "../src/shared/versioned-json-store.mjs";

const fsPromises = process.getBuiltinModule("fs/promises");

async function withFsOverrides(overrides, operation) {
  const originals = Object.fromEntries(
    Object.keys(overrides).map((name) => [name, fsPromises[name]])
  );
  Object.assign(fsPromises, overrides);
  syncBuiltinESMExports();
  try {
    return await operation(originals);
  } finally {
    Object.assign(fsPromises, originals);
    syncBuiltinESMExports();
  }
}

function pauseFirstTemporaryOpen(destination, acquired, allowCommit) {
  const originalOpen = fsPromises.open;
  let paused = false;
  return async (path, flags, ...rest) => {
    if (
      !paused &&
      flags === "wx" &&
      String(path).startsWith(`${destination}.`) &&
      String(path).endsWith(".tmp")
    ) {
      paused = true;
      acquired.resolve();
      await allowCommit.promise;
    }
    return originalOpen(path, flags, ...rest);
  };
}

function failDirectorySyncOnCall(directory, targetCall, beforeFailure) {
  const originalOpen = fsPromises.open;
  let directorySyncCall = 0;
  return async (path, flags, ...rest) => {
    const handle = await originalOpen(path, flags, ...rest);
    if (flags !== "r" || String(path) !== directory) return handle;
    directorySyncCall += 1;
    if (directorySyncCall !== targetCall) return handle;
    return new Proxy(handle, {
      get(target, property) {
        if (property === "sync") {
          return async () => {
            await beforeFailure?.();
            const error = new Error(`injected directory sync failure #${targetCall}`);
            error.code = "EIO";
            throw error;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(promise, label) {
  let timeout;
  try {
    await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), 2000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitUntil(predicate, label) {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > 2000) throw new Error(`${label} timed out`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  }
}

function versionOptions(overrides = {}) {
  return {
    expectedVersion: 0,
    getVersion: (value) => value?.stateVersion ?? 0,
    setVersion: (value, version) => {
      value.stateVersion = version;
    },
    ...overrides
  };
}

async function installStaleLock(destination) {
  const lockPath = `${destination}.lock`;
  const token = randomUUID();
  const ownerPath = `${lockPath}.owner-${token}`;
  await writeFile(ownerPath, `${JSON.stringify({
    schemaVersion: 1,
    token,
    pid: 2_147_483_647,
    hostname: hostname(),
    acquiredAt: new Date(0).toISOString()
  })}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await link(ownerPath, lockPath);
  return { lockPath, ownerPath, token };
}

test("公开 writeVersionedJson 拒绝 lockHooks 且零写入、零假提交", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-public-hook-rejection-"));
  const destination = join(directory, "episode.json");
  try {
    await assert.rejects(
      writeVersionedJson(
        destination,
        { id: "must-not-write", stateVersion: 0 },
        versionOptions({
          lockHooks: {
            async syncCommittedDirectory() {},
            async releaseLock() {
              return true;
            }
          }
        })
      ),
      (error) =>
        error instanceof TypeError &&
        error.code === "unsupported_versioned_json_store_option"
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("活跃写入会续租，超过 stale 阈值后也不能被第二个写入接管", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-lock-live-"));
  const destination = join(directory, "episode.json");
  const acquired = deferred();
  const allowCommit = deferred();

  try {
    await withFsOverrides(
      { open: pauseFirstTemporaryOpen(destination, acquired, allowCommit) },
      async () => {
        const first = writeVersionedJson(
          destination,
          { id: "first", stateVersion: 0 },
          versionOptions({
            staleLockAfterMs: 40,
            lockHeartbeatIntervalMs: 5,
            lockTimeoutMs: 500
          })
        );
        await waitFor(acquired.promise, "first lock acquisition");
        const heartbeatBefore = await stat(`${destination}.lock`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
        const heartbeatAfter = await stat(`${destination}.lock`);
        assert.ok(heartbeatAfter.mtimeMs > heartbeatBefore.mtimeMs);

        await assert.rejects(
          writeVersionedJson(
            destination,
            { id: "second", stateVersion: 0 },
            versionOptions({
              staleLockAfterMs: 40,
              lockHeartbeatIntervalMs: 5,
              lockTimeoutMs: 35,
              retryDelayMs: 5
            })
          ),
          (error) => error?.code === "state_lock_timeout"
        );

        allowCommit.resolve();
        const written = await first;
        assert.equal(written.value.id, "first");
      }
    );
  } finally {
    allowCommit.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

test("旧 owner 在提交前发现锁已换主，并且 finally 不删除新 owner 的锁", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-lock-owner-"));
  const destination = join(directory, "episode.json");
  const lockPath = `${destination}.lock`;
  const displacedPath = `${lockPath}.displaced`;
  const acquired = deferred();
  const allowCommit = deferred();
  const replacement = {
    schemaVersion: 1,
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString()
  };

  try {
    await withFsOverrides(
      { open: pauseFirstTemporaryOpen(destination, acquired, allowCommit) },
      async () => {
        const first = writeVersionedJson(
          destination,
          { id: "old-owner", stateVersion: 0 },
          versionOptions()
        );
        await waitFor(acquired.promise, "old owner lock acquisition");

        await rename(lockPath, displacedPath);
        await writeFile(lockPath, `${JSON.stringify(replacement)}\n`, {
          encoding: "utf8",
          mode: 0o600
        });
        allowCommit.resolve();

        await assert.rejects(first, (error) => error?.code === "state_lock_lost");
        const preserved = JSON.parse(await readFile(lockPath, "utf8"));
        assert.equal(preserved.token, replacement.token);
        await assert.rejects(readFile(destination, "utf8"), { code: "ENOENT" });
      }
    );
  } finally {
    allowCommit.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

test("首次抢锁 post-link fsync EIO 明确 warning，释放后同进程可继续写 v2", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-initial-sync-warning-"));
  const destination = join(directory, "episode.json");
  const lockPath = `${destination}.lock`;

  try {
    const first = await withFsOverrides(
      { open: failDirectorySyncOnCall(directory, 1) },
      () => writeVersionedJson(
        destination,
        { id: "initial-sync-warning", stateVersion: 0 },
        versionOptions()
      )
    );
    assert.equal(first.commitStatus, "committed_with_warnings");
    assert.equal(first.version, 1);
    assert.equal(
      first.commitWarnings.some(
        (warning) => warning.stage === "lock_acquire" && warning.code === "EIO"
      ),
      true
    );
    await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });

    const second = await writeVersionedJson(
      destination,
      { id: "after-initial-sync-warning", stateVersion: 1 },
      versionOptions({ expectedVersion: 1 })
    );
    assert.equal(second.commitStatus, "committed");
    assert.equal(second.version, 2);
    assert.equal(second.value.id, "after-initial-sync-warning");
    await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("首次抢锁 post-link warning 后若已换主，旧 owner 不会删除 replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-initial-sync-race-"));
  const destination = join(directory, "episode.json");
  const lockPath = `${destination}.lock`;
  const displacedPath = `${lockPath}.displaced`;
  const replacement = {
    schemaVersion: 1,
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString()
  };
  const replacementOwnerPath = `${lockPath}.owner-${replacement.token}`;

  try {
    await withFsOverrides(
      {
        open: failDirectorySyncOnCall(directory, 1, async () => {
          await rename(lockPath, displacedPath);
          await writeFile(replacementOwnerPath, `${JSON.stringify(replacement)}\n`, {
            encoding: "utf8",
            mode: 0o600
          });
          await link(replacementOwnerPath, lockPath);
        })
      },
      () => assert.rejects(
        writeVersionedJson(
          destination,
          { id: "displaced-after-initial-sync", stateVersion: 0 },
          versionOptions()
        ),
        (error) => error?.code === "state_lock_lost"
      )
    );
    const preserved = JSON.parse(await readFile(lockPath, "utf8"));
    assert.equal(preserved.token, replacement.token);
    const [replacementLockDetails, replacementOwnerDetails] = await Promise.all([
      stat(lockPath),
      stat(replacementOwnerPath)
    ]);
    assert.equal(replacementLockDetails.dev, replacementOwnerDetails.dev);
    assert.equal(replacementLockDetails.ino, replacementOwnerDetails.ino);
    await assert.rejects(readFile(destination, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("等待活锁时发现目标版本已推进会立即返回 conflict", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-lock-early-conflict-"));
  const destination = join(directory, "episode.json");
  const committed = deferred();
  const allowRelease = deferred();
  let firstWrite = null;

  try {
    const originalRm = fsPromises.rm;
    let pausedRelease = false;
    await withFsOverrides(
      {
        rm: async (path, ...args) => {
          if (!pausedRelease && String(path) === `${destination}.lock`) {
            pausedRelease = true;
            committed.resolve();
            await allowRelease.promise;
          }
          return originalRm(path, ...args);
        }
      },
      async () => {
        firstWrite = writeVersionedJson(
          destination,
          { id: "committed-owner", stateVersion: 0 },
          versionOptions()
        );
        await waitFor(committed.promise, "first committed state");

        await assert.rejects(
          writeVersionedJson(
            destination,
            { id: "stale-waiter", stateVersion: 0 },
            versionOptions({ lockTimeoutMs: 25, retryDelayMs: 1 })
          ),
          (error) => error?.code === "state_version_conflict"
        );

        allowRelease.resolve();
        const first = await firstWrite;
        assert.equal(first.commitStatus, "committed");
        assert.equal(first.version, 1);
      }
    );
  } finally {
    allowRelease.resolve();
    await firstWrite?.catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("确认 owner 进程已退出后可原子接管遗留锁", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-lock-stale-"));
  const destination = join(directory, "episode.json");
  const lockPath = `${destination}.lock`;
  const staleToken = randomUUID();

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({
      schemaVersion: 1,
      token: staleToken,
      pid: 2_147_483_647,
      hostname: hostname(),
      acquiredAt: new Date(0).toISOString()
    })}\n`, {
      encoding: "utf8",
      mode: 0o600
    });

    const written = await writeVersionedJson(
      destination,
      { id: "recovered", stateVersion: 0 },
      versionOptions({ lockTimeoutMs: 200, retryDelayMs: 5 })
    );
    assert.equal(written.value.id, "recovered");
    await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const fixture of [
  {
    label: "candidate 安装后的目录 fsync 失败",
    fault: "sync_takeover_directory",
    code: "EIO"
  },
  {
    label: "candidate 安装后的旧 owner 清理失败",
    fault: "remove_displaced_owner",
    code: "EPERM"
  }
]) {
  test(`${fixture.label} 不制造假主锁且后续版本仍可写入`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "studio-versioned-takeover-warning-"));
    const destination = join(directory, "episode.json");
    const stale = await installStaleLock(destination);

    try {
      const originalRm = fsPromises.rm;
      let removeFailureInjected = false;
      const overrides = fixture.fault === "sync_takeover_directory"
        ? { open: failDirectorySyncOnCall(directory, 2) }
        : {
            rm: async (path, ...args) => {
              if (!removeFailureInjected && String(path) === stale.ownerPath) {
                removeFailureInjected = true;
                const error = new Error("injected displaced owner cleanup failure");
                error.code = fixture.code;
                throw error;
              }
              return originalRm(path, ...args);
            }
          };
      const first = await withFsOverrides(
        overrides,
        () => writeVersionedJson(
          destination,
          { id: "takeover-with-warning", stateVersion: 0 },
          versionOptions({ lockTimeoutMs: 500, retryDelayMs: 1 })
        )
      );
      assert.equal(first.commitStatus, "committed_with_warnings");
      assert.equal(first.version, 1);
      assert.equal(
        first.commitWarnings.some(
          (warning) => warning.stage === "lock_takeover" && warning.code === fixture.code
        ),
        true
      );
      await assert.rejects(readFile(stale.lockPath, "utf8"), { code: "ENOENT" });

      const second = await writeVersionedJson(
        destination,
        { id: "after-takeover-warning", stateVersion: 1 },
        versionOptions({ expectedVersion: 1, lockTimeoutMs: 100, retryDelayMs: 1 })
      );
      assert.equal(second.commitStatus, "committed");
      assert.equal(second.version, 2);
      assert.equal(second.value.id, "after-takeover-warning");
      await assert.rejects(readFile(stale.lockPath, "utf8"), { code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("多个竞争者同时接管同一遗留锁时仍只提交一个版本", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-lock-race-"));
  const destination = join(directory, "episode.json");
  const lockPath = `${destination}.lock`;

  try {
    await writeFile(lockPath, `${JSON.stringify({
      schemaVersion: 1,
      token: randomUUID(),
      pid: 2_147_483_647,
      hostname: hostname(),
      acquiredAt: new Date(0).toISOString()
    })}\n`, {
      encoding: "utf8",
      mode: 0o600
    });

    const results = await Promise.allSettled(
      Array.from({ length: 64 }, (_, index) => writeVersionedJson(
        destination,
        { id: `contender-${index}`, stateVersion: 0 },
        versionOptions({ retryDelayMs: 1 })
      ))
    );
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 63);
    const rejectionCodes = rejected.map((result) => result.reason?.code);
    assert.ok(
      rejectionCodes.every((code) => code === "state_version_conflict"),
      `unexpected rejection codes: ${rejectionCodes.join(", ")}\n${rejected
        .map((result) => result.reason?.stack)
        .join("\n---\n")}`
    );

    const persisted = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(persisted.stateVersion, 1);
    assert.equal(persisted.id, fulfilled[0].value.value.id);
    await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("崩溃遗留的 transition owner 不会永久阻塞后续精确释放", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-transition-stale-"));
  const destination = join(directory, "episode.json");
  const transitionPath = `${destination}.lock.transition`;
  const transitionToken = randomUUID();
  const transitionOwnerPath = `${transitionPath}.owner-${transitionToken}`;

  try {
    await writeFile(transitionOwnerPath, `${JSON.stringify({
      schemaVersion: 1,
      token: transitionToken,
      pid: 2_147_483_647,
      hostname: hostname(),
      acquiredAt: new Date(0).toISOString()
    })}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await link(transitionOwnerPath, transitionPath);

    const written = await writeVersionedJson(
      destination,
      { id: "after-transition-crash", stateVersion: 0 },
      versionOptions({ lockTimeoutMs: 500, retryDelayMs: 1 })
    );
    assert.equal(written.value.id, "after-transition-crash");
    await assert.rejects(readFile(`${destination}.lock`, "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(transitionPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("owner 链接已丢失的同进程 transition 可被安全回收", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-transition-ownerless-"));
  const destination = join(directory, "episode.json");
  const transitionPath = `${destination}.lock.transition`;

  try {
    await writeFile(transitionPath, `${JSON.stringify({
      schemaVersion: 1,
      token: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: new Date().toISOString()
    })}\n`, {
      encoding: "utf8",
      mode: 0o600
    });

    const written = await writeVersionedJson(
      destination,
      { id: "after-ownerless-transition", stateVersion: 0 },
      versionOptions({ lockTimeoutMs: 500, retryDelayMs: 1 })
    );
    assert.equal(written.value.id, "after-ownerless-transition");
    await assert.rejects(readFile(`${destination}.lock`, "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(transitionPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("释放等待 transition 时持续续租，解除竞争后同进程仍可写入下一版本", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-transition-release-"));
  const destination = join(directory, "episode.json");
  const lockPath = `${destination}.lock`;
  const transitionPath = `${lockPath}.transition`;
  let firstWrite = null;
  let acquiredOwnerPath = null;
  const heldTransitionToken = randomUUID();
  const heldTransitionOwnerPath = `${transitionPath}.owner-${heldTransitionToken}`;

  try {
    await writeFile(heldTransitionOwnerPath, `${JSON.stringify({
      schemaVersion: 1,
      token: heldTransitionToken,
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: new Date().toISOString()
    })}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await link(heldTransitionOwnerPath, transitionPath);

    firstWrite = writeVersionedJson(
      destination,
      { id: "first-with-transition-contention", stateVersion: 0 },
      versionOptions({
        lockTimeoutMs: 20,
        staleLockAfterMs: 1000,
        lockHeartbeatIntervalMs: 5,
        retryDelayMs: 5
      })
    );

    await waitUntil(
      () => readFile(destination, "utf8").then(() => true, (error) => {
        if (error?.code === "ENOENT") return false;
        throw error;
      }),
      "release transition contention"
    );
    const activeOwner = JSON.parse(await readFile(lockPath, "utf8"));
    acquiredOwnerPath = `${lockPath}.owner-${activeOwner.token}`;
    const heartbeatBefore = await stat(lockPath);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 125));
    const heartbeatAfter = await stat(lockPath);
    assert.ok(
      heartbeatAfter.mtimeMs > heartbeatBefore.mtimeMs,
      "main lock lease must remain active while release waits for transition"
    );

    await rm(transitionPath, { force: true });
    await rm(heldTransitionOwnerPath, { force: true });
    const first = await firstWrite;
    assert.equal(first.commitStatus, "committed");
    assert.equal(first.version, 1);
    await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(transitionPath, "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(acquiredOwnerPath, "utf8"), { code: "ENOENT" });

    const second = await writeVersionedJson(
      destination,
      { id: "second-after-transition-contention", stateVersion: 1 },
      versionOptions({
        expectedVersion: 1,
        lockTimeoutMs: 100,
        retryDelayMs: 5
      })
    );
    assert.equal(second.commitStatus, "committed");
    assert.equal(second.version, 2);
    assert.equal(second.value.id, "second-after-transition-contention");
  } finally {
    await rm(transitionPath, { force: true }).catch(() => undefined);
    await rm(heldTransitionOwnerPath, { force: true }).catch(() => undefined);
    await firstWrite?.catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("rename 已提交后锁释放报错不会伪装成写入失败", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-release-warning-"));
  const destination = join(directory, "episode.json");
  try {
    const written = await withFsOverrides(
      { open: failDirectorySyncOnCall(directory, 4) },
      () => writeVersionedJson(
        destination,
        { id: "committed-before-release-error", stateVersion: 0 },
        versionOptions()
      )
    );

    assert.equal(written.commitStatus, "committed_with_warnings");
    assert.equal(written.version, 1);
    assert.equal(
      written.commitWarnings.some(
        (warning) => warning.stage === "lock_release" &&
          warning.code === "EIO"
      ),
      true
    );
    const persisted = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(persisted.id, "committed-before-release-error");
    assert.equal(persisted.stateVersion, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rename 后目录 fsync 失败明确返回 durability warning 且不诱发错误重试", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-versioned-sync-warning-"));
  const destination = join(directory, "episode.json");
  try {
    const written = await withFsOverrides(
      { open: failDirectorySyncOnCall(directory, 2) },
      () => writeVersionedJson(
        destination,
        { id: "visible-with-sync-warning", stateVersion: 0 },
        versionOptions()
      )
    );

    assert.equal(written.commitStatus, "committed_with_warnings");
    assert.equal(
      written.commitWarnings.some(
        (warning) => warning.stage === "directory_sync" && warning.code === "EIO"
      ),
      true
    );
    const persisted = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(persisted.id, "visible-with-sync-warning");
    assert.equal(persisted.stateVersion, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
