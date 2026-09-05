import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  utimes
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname } from "node:path";

export class StateConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "StateConflictError";
    this.code = "state_version_conflict";
    this.statusCode = 409;
    this.details = details;
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function stateLockError(message, code, statusCode = 409, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function validLockOwner(owner) {
  return Boolean(
    owner?.schemaVersion === 1 &&
      typeof owner.token === "string" &&
      /^[a-f0-9-]+$/u.test(owner.token) &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      typeof owner.hostname === "string" &&
      owner.hostname &&
      typeof owner.acquiredAt === "string" &&
      !Number.isNaN(Date.parse(owner.acquiredAt))
  );
}

function lockOwnerIsAlive(owner) {
  if (owner.hostname !== hostname()) return null;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function ownerPathFor(lockPath, token) {
  return `${lockPath}.owner-${token}`;
}

function transitionPathFor(lockPath) {
  return `${lockPath}.transition`;
}

async function readLockOwner(path) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let owner;
  try {
    owner = JSON.parse(source);
  } catch (cause) {
    throw stateLockError(
      "Episode 状态锁内容无效，写入已安全停止",
      "state_lock_invalid",
      503,
      cause
    );
  }
  if (!validLockOwner(owner)) {
    throw stateLockError(
      "Episode 状态锁内容无效，写入已安全停止",
      "state_lock_invalid",
      503
    );
  }
  return owner;
}

async function syncDirectory(path) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EBADF"].includes(error?.code)) throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function writeLockOwner(path, owner) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function inspectLockOwner(path, options) {
  const [owner, details] = await Promise.all([readLockOwner(path), stat(path)]);
  if (!owner) {
    const error = new Error("State lock owner disappeared during inspection");
    error.code = "ENOENT";
    throw error;
  }
  const ownerDetails = await stat(ownerPathFor(path, owner.token)).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const localLiveness = lockOwnerIsAlive(owner);
  const leaseExpired = Date.now() - details.mtimeMs > options.staleAfterMs;
  return {
    owner,
    details,
    stale:
      !ownerDetails ||
      !sameFile(details, ownerDetails) ||
      localLiveness === false ||
      (localLiveness === null && leaseExpired)
  };
}

async function removeStaleTransition(lockPath, observed, options) {
  const transitionPath = transitionPathFor(lockPath);
  const quarantinePath = `${transitionPath}.stale-${observed.owner.token}-${randomUUID()}`;
  try {
    await rename(transitionPath, quarantinePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  await syncDirectory(dirname(lockPath));
  const moved = await inspectLockOwner(quarantinePath, options);
  if (
    moved.owner.token !== observed.owner.token ||
    !sameFile(moved.details, observed.details) ||
    !moved.stale
  ) {
    try {
      await link(quarantinePath, transitionPath);
      await rm(quarantinePath, { force: true });
      await syncDirectory(dirname(lockPath));
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    return false;
  }
  await rm(quarantinePath, { force: true });
  await rm(ownerPathFor(transitionPath, moved.owner.token), { force: true });
  await syncDirectory(dirname(lockPath));
  return true;
}

async function claimLockTransition(lockPath, options) {
  const transitionPath = transitionPathFor(lockPath);
  const token = randomUUID();
  const claimOwnerPath = ownerPathFor(transitionPath, token);
  const claimOwner = {
    schemaVersion: 1,
    token,
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString()
  };
  let claimed = false;
  await writeLockOwner(claimOwnerPath, claimOwner);
  try {
    while (true) {
      try {
        await link(claimOwnerPath, transitionPath);
        await syncDirectory(dirname(lockPath));
        const details = await stat(transitionPath);
        claimed = true;
        return { path: transitionPath, ownerPath: claimOwnerPath, token, details };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      let existing;
      try {
        existing = await inspectLockOwner(transitionPath, options);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (existing.stale && await removeStaleTransition(lockPath, existing, options)) {
        continue;
      }
      return null;
    }
  } finally {
    if (!claimed) {
      await rm(claimOwnerPath, { force: true }).catch(() => undefined);
    }
  }
}

async function releaseLockTransition(transition, lockPath) {
  try {
    const [currentOwner, currentDetails, ownerDetails] = await Promise.all([
      readLockOwner(transition.path),
      stat(transition.path),
      stat(transition.ownerPath)
    ]);
    if (
      currentOwner?.token !== transition.token ||
      !sameFile(currentDetails, transition.details) ||
      !sameFile(currentDetails, ownerDetails)
    ) {
      return false;
    }
    await rm(transition.path, { force: true });
    await syncDirectory(dirname(lockPath));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  } finally {
    await rm(transition.ownerPath, { force: true }).catch(() => undefined);
  }
}

async function takeOverStaleLock(lockPath, observed, candidateOwnerPath, options) {
  const transition = await claimLockTransition(lockPath, options);
  if (!transition) return false;
  let candidateInstalled = false;
  try {
    const [currentOwner, currentDetails] = await Promise.all([
      readLockOwner(lockPath),
      stat(lockPath)
    ]);
    if (
      currentOwner?.token !== observed.owner.token ||
      !sameFile(currentDetails, observed.details)
    ) {
      return false;
    }

    const localLiveness = lockOwnerIsAlive(currentOwner);
    const leaseExpired = Date.now() - currentDetails.mtimeMs > options.staleAfterMs;
    if (localLiveness === true || (localLiveness === null && !leaseExpired)) {
      return false;
    }

    await rm(lockPath, { force: true });
    try {
      await link(candidateOwnerPath, lockPath);
      candidateInstalled = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      return false;
    }
    try {
      await syncDirectory(dirname(lockPath));
    } catch (error) {
      options.recordWarning({
        stage: "lock_takeover",
        code: error?.code ?? "state_lock_takeover_directory_sync_failed",
        message: error?.message ?? "Episode stale-lock takeover directory sync failed"
      });
    }
    try {
      await rm(ownerPathFor(lockPath, currentOwner.token), { force: true });
    } catch (error) {
      options.recordWarning({
        stage: "lock_takeover",
        code: error?.code ?? "state_lock_displaced_owner_cleanup_failed",
        message: error?.message ?? "Episode displaced stale-lock owner cleanup failed"
      });
    }
    return true;
  } catch (error) {
    // Before the candidate is installed, restore only the displaced stale
    // owner's inode. The transition owner is a mutex for this replacement and
    // must never become the main lock: doing so would create a current-PID lock
    // with no heartbeat after the transition side links are cleaned up.
    if (!candidateInstalled) {
      const displacedOwnerPath = ownerPathFor(lockPath, observed.owner.token);
      try {
        const displacedOwnerDetails = await stat(displacedOwnerPath);
        if (sameFile(displacedOwnerDetails, observed.details)) {
          await link(displacedOwnerPath, lockPath).catch((restoreError) => {
            if (restoreError?.code !== "EEXIST") throw restoreError;
          });
        }
      } catch (restoreError) {
        if (restoreError?.code !== "ENOENT") {
          error.restoreError = restoreError;
        }
      }
    }
    throw error;
  } finally {
    await releaseLockTransition(transition, lockPath).catch(() => undefined);
  }
}

async function inspectExistingLock(lockPath, options) {
  let owner;
  let details;
  try {
    [owner, details] = await Promise.all([readLockOwner(lockPath), stat(lockPath)]);
  } catch (error) {
    if (error?.code === "ENOENT") return { missing: true, stale: false };
    throw error;
  }
  if (!owner) return { missing: true, stale: false };
  const localLiveness = lockOwnerIsAlive(owner);
  const leaseExpired = Date.now() - details.mtimeMs > options.staleAfterMs;
  return {
    owner,
    details,
    missing: false,
    stale: localLiveness === false || (localLiveness === null && leaseExpired)
  };
}

function lockTiming(options) {
  const timeoutValue = Number(options.lockTimeoutMs ?? 3000);
  const staleValue = Number(options.staleLockAfterMs ?? 30000);
  const retryValue = Number(options.retryDelayMs ?? 10);
  const timeoutMs = Number.isFinite(timeoutValue) && timeoutValue >= 0 ? timeoutValue : 3000;
  const staleAfterMs = Number.isFinite(staleValue) && staleValue >= 10 ? staleValue : 30000;
  const retryDelayMs = Number.isFinite(retryValue) && retryValue >= 1 ? retryValue : 10;
  const defaultHeartbeatMs = Math.max(5, Math.min(1000, Math.floor(staleAfterMs / 3)));
  const heartbeatValue = Number(options.lockHeartbeatIntervalMs ?? defaultHeartbeatMs);
  const heartbeatIntervalMs =
    Number.isFinite(heartbeatValue) && heartbeatValue >= 1
      ? Math.min(heartbeatValue, Math.max(1, staleAfterMs - 1))
      : defaultHeartbeatMs;
  return { timeoutMs, staleAfterMs, retryDelayMs, heartbeatIntervalMs };
}

async function acquireLock(lockPath, rawOptions = {}, assertWaitStillRelevant) {
  const acquisitionWarnings = [];
  const options = {
    ...lockTiming(rawOptions),
    recordWarning(warning) {
      acquisitionWarnings.push(warning);
    }
  };
  const token = randomUUID();
  const ownerPath = ownerPathFor(lockPath, token);
  const owner = {
    schemaVersion: 1,
    token,
    pid: process.pid,
    hostname: hostname(),
    acquiredAt: new Date().toISOString()
  };
  const startedAt = Date.now();

  await writeLockOwner(ownerPath, owner);
  try {
    while (true) {
      let candidateInstalled = false;
      try {
        await link(ownerPath, lockPath);
        candidateInstalled = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }

      if (candidateInstalled) {
        try {
          await syncDirectory(dirname(lockPath));
        } catch (error) {
          // The candidate is already the visible lock and still has its owner
          // side-link. Keep it live and surface durability uncertainty rather
          // than deleting only the owner side-link and manufacturing a fake lock.
          options.recordWarning({
            stage: "lock_acquire",
            code: error?.code ?? "state_lock_acquire_directory_sync_failed",
            message: error?.message ?? "Episode initial lock directory sync failed"
          });
        }
        break;
      }

      const existing = await inspectExistingLock(lockPath, options);
      if (existing.missing) continue;
      if (existing.stale) {
        if (await takeOverStaleLock(lockPath, existing, ownerPath, options)) break;
        continue;
      }
      await assertWaitStillRelevant?.();
      if (Date.now() - startedAt >= options.timeoutMs) {
        throw stateLockError(
          "Episode 状态锁等待超时，请稍后重试",
          "state_lock_timeout"
        );
      }
      await delay(
        Math.min(options.retryDelayMs, Math.max(1, options.timeoutMs - (Date.now() - startedAt)))
      );
    }
  } catch (error) {
    await rm(ownerPath, { force: true }).catch(() => undefined);
    throw error;
  }

  let held = true;
  let heartbeatError = null;
  let heartbeatInFlight = Promise.resolve();
  let releaseInFlight = null;
  const heartbeat = () => {
    heartbeatInFlight = heartbeatInFlight
      .then(async () => {
        if (!held) return;
        const now = new Date();
        await utimes(ownerPath, now, now);
      })
      .catch((error) => {
        heartbeatError = error;
      });
  };
  const heartbeatTimer = setInterval(heartbeat, options.heartbeatIntervalMs);
  heartbeatTimer.unref?.();

  const ownsActiveLock = async () => {
    if (!held || heartbeatError) return false;
    let activeOwner;
    let activeDetails;
    let ownerDetails;
    try {
      [activeOwner, activeDetails, ownerDetails] = await Promise.all([
        readLockOwner(lockPath),
        stat(lockPath),
        stat(ownerPath)
      ]);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    return activeOwner?.token === token && sameFile(activeDetails, ownerDetails);
  };

  return {
    token,
    acquisitionWarnings,
    async assertOwned() {
      if (!(await ownsActiveLock())) {
        throw stateLockError(
          "Episode 状态锁所有权已变更，写入已安全停止",
          "state_lock_lost",
          409,
          heartbeatError
        );
      }
    },
    async release() {
      if (!held) return false;
      if (releaseInFlight) return releaseInFlight;
      releaseInFlight = (async () => {
        let transition = null;
        let retireOwner = false;
        try {
          while (!transition) {
            transition = await claimLockTransition(lockPath, options);
            if (transition) break;
            const activeExists = await stat(lockPath).then(() => true, (error) => {
              if (error?.code === "ENOENT") return false;
              throw error;
            });
            if (!activeExists) {
              retireOwner = true;
              return false;
            }
            await delay(options.retryDelayMs);
          }

          let activeOwner;
          let activeDetails;
          let ownerDetails;
          try {
            [activeOwner, activeDetails, ownerDetails] = await Promise.all([
              readLockOwner(lockPath),
              stat(lockPath),
              stat(ownerPath)
            ]);
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          const owned = Boolean(
            activeOwner?.token === token &&
              activeDetails &&
              ownerDetails &&
              sameFile(activeDetails, ownerDetails)
          );
          if (owned) {
            await rm(lockPath, { force: true });
            retireOwner = true;
            await syncDirectory(dirname(lockPath));
          } else {
            retireOwner = true;
          }
          return owned;
        } finally {
          if (transition) {
            await releaseLockTransition(transition, lockPath).catch(() => undefined);
          }
          if (retireOwner) {
            held = false;
            clearInterval(heartbeatTimer);
            await heartbeatInFlight;
            await rm(ownerPath, { force: true }).catch(() => undefined);
          }
        }
      })();
      try {
        return await releaseInFlight;
      } finally {
        releaseInFlight = null;
      }
    }
  };
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeVersionedJson(destination, value, options = {}) {
  if (options !== null && options !== undefined && "lockHooks" in Object(options)) {
    const error = new TypeError(
      "writeVersionedJson does not accept lockHooks; durability and lock operations are fixed"
    );
    error.code = "unsupported_versioned_json_store_option";
    throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  const lockPath = `${destination}.lock`;
  const expectedVersion = Number.isInteger(options.expectedVersion)
    ? options.expectedVersion
    : 0;
  const assertExpectedVersion = async () => {
    const current = await readJsonIfPresent(destination);
    const observedVersion = options.getVersion?.(current);
    const actualVersion = Number.isInteger(observedVersion) ? observedVersion : 0;
    if (actualVersion !== expectedVersion) {
      throw new StateConflictError(
        `Episode 状态版本冲突：期望 ${expectedVersion}，当前 ${actualVersion}`,
        { expectedVersion, actualVersion }
      );
    }
    return actualVersion;
  };
  const lock = await acquireLock(lockPath, options, assertExpectedVersion);
  const temporary = `${destination}.${process.pid}-${randomUUID()}.tmp`;
  let result = null;
  let operationError = null;
  const commitWarnings = [...lock.acquisitionWarnings];
  try {
    const actualVersion = await assertExpectedVersion();
    const nextVersion = actualVersion + 1;
    const nextValue = structuredClone(value);
    options.setVersion?.(nextValue, nextVersion);
    const temporaryHandle = await open(temporary, "wx", 0o600);
    try {
      await temporaryHandle.writeFile(`${JSON.stringify(nextValue, null, 2)}\n`, "utf8");
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close().catch(() => undefined);
    }
    await lock.assertOwned();
    await rename(temporary, destination);
    result = { destination, value: nextValue, version: nextVersion };
  } catch (error) {
    operationError = error;
  }

  if (result) {
    try {
      await syncDirectory(dirname(destination));
    } catch (error) {
      commitWarnings.push({
        stage: "directory_sync",
        code: error?.code ?? "state_commit_durability_unknown",
        message: error?.message ?? "Committed Episode directory sync failed"
      });
    }
  }

  await rm(temporary, { force: true }).catch((error) => {
    if (result) {
      commitWarnings.push({
        stage: "temporary_cleanup",
        code: error?.code ?? "state_temporary_cleanup_failed",
        message: error?.message ?? "Committed Episode temporary cleanup failed"
      });
    }
  });

  try {
    const released = await lock.release();
    if (result && released !== true) {
      commitWarnings.push({
        stage: "lock_release",
        code: "state_lock_release_incomplete",
        message: "Committed Episode lock release could not be confirmed"
      });
    }
  } catch (error) {
    if (result) {
      commitWarnings.push({
        stage: "lock_release",
        code: error?.code ?? "state_lock_release_failed",
        message: error?.message ?? "Committed Episode lock release failed"
      });
    } else if (!operationError) {
      operationError = error;
    }
  }

  if (operationError) throw operationError;
  if (commitWarnings.length > 0) {
    return {
      ...result,
      commitStatus: "committed_with_warnings",
      commitWarnings
    };
  }
  return { ...result, commitStatus: "committed", commitWarnings: [] };
}
