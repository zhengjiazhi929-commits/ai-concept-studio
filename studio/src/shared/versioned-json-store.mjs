import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

async function acquireLock(lockPath, options = {}) {
  const timeoutMs = options.lockTimeoutMs ?? 3000;
  const staleAfterMs = options.staleLockAfterMs ?? 30000;
  const startedAt = Date.now();
  while (true) {
    try {
      return await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const details = await stat(lockPath).catch(() => null);
      if (details && Date.now() - details.mtimeMs > staleAfterMs) {
        await rm(lockPath, { force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        const lockError = new Error("Episode 状态锁等待超时，请稍后重试");
        lockError.code = "state_lock_timeout";
        lockError.statusCode = 409;
        throw lockError;
      }
      await delay(Math.min(25, options.retryDelayMs ?? 10));
    }
  }
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
  await mkdir(dirname(destination), { recursive: true });
  const lockPath = `${destination}.lock`;
  const handle = await acquireLock(lockPath, options);
  const temporary = `${destination}.${process.pid}-${randomUUID()}.tmp`;
  try {
    const current = await readJsonIfPresent(destination);
    const observedVersion = options.getVersion?.(current);
    const actualVersion = Number.isInteger(observedVersion) ? observedVersion : 0;
    const expectedVersion = Number.isInteger(options.expectedVersion)
      ? options.expectedVersion
      : 0;
    if (actualVersion !== expectedVersion) {
      throw new StateConflictError(
        `Episode 状态版本冲突：期望 ${expectedVersion}，当前 ${actualVersion}`,
        { expectedVersion, actualVersion }
      );
    }
    const nextVersion = actualVersion + 1;
    const nextValue = structuredClone(value);
    options.setVersion?.(nextValue, nextVersion);
    await writeFile(temporary, `${JSON.stringify(nextValue, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, destination);
    return { destination, value: nextValue, version: nextVersion };
  } finally {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}
