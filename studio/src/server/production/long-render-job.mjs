import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, lstatSync, realpathSync } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/u;
const longReviewRenderJobLockStates = new WeakMap();

export const LONG_REVIEW_RENDER_JOB_SCHEMA_VERSION = "long-review-render-job-v1";
export const LONG_REVIEW_RENDER_JOB_LOCK_FILE = ".render-job-lock.sqlite";
export const LONG_REVIEW_RENDER_PARENT_BINDING_PROTOCOL =
  "long-review-render-parent-binding-v1";
export const LONG_REVIEW_RENDER_SCHEDULING_DEFAULTS = Object.freeze({
  chunkFrames: 900,
  interChunkPauseMs: 5_000
});

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function renderJobLockError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = code === "long_review_render_job_locked" ? 409 : 503;
  return error;
}

function readLongReviewRenderLockPathIdentity(path, expectedType, label) {
  const resolvedPath = resolve(path);
  let stat;
  let canonicalPath;
  try {
    stat = lstatSync(resolvedPath, { bigint: true });
    canonicalPath = realpathSync(resolvedPath);
  } catch (error) {
    throw renderJobLockError(
      `${label} 不可读取或已被替换`,
      "long_review_render_job_lock_lost",
      error
    );
  }
  const hasExpectedType = expectedType === "directory"
    ? stat.isDirectory()
    : stat.isFile();
  if (!hasExpectedType || stat.isSymbolicLink()) {
    throw renderJobLockError(
      `${label} 类型已变化或变成符号链接`,
      "long_review_render_job_lock_lost"
    );
  }
  return Object.freeze({
    path: resolvedPath,
    canonicalPath,
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    type: expectedType
  });
}

function assertLongReviewRenderLockPathIdentity(expectedIdentity, label) {
  const currentIdentity = readLongReviewRenderLockPathIdentity(
    expectedIdentity.path,
    expectedIdentity.type,
    label
  );
  if (
    currentIdentity.canonicalPath !== expectedIdentity.canonicalPath ||
    currentIdentity.device !== expectedIdentity.device ||
    currentIdentity.inode !== expectedIdentity.inode
  ) {
    throw renderJobLockError(
      `${label} inode 已变化，原 owner 不再拥有该路径`,
      "long_review_render_job_lock_lost"
    );
  }
  return true;
}

export function isUnsupportedLongReviewDirectorySyncError(
  error,
  platform = process.platform
) {
  const code = error?.code;
  if (new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]).has(code)) {
    return true;
  }
  return platform === "win32" && new Set(["EISDIR", "EPERM"]).has(code);
}

function durabilityError(message, code, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = 503;
  return error;
}

async function closeDurabilityHandle(handle, priorError) {
  if (!handle) return;
  try {
    await handle.close();
  } catch (error) {
    if (!priorError) {
      throw durabilityError(
        "长片 durable publication 关闭文件句柄失败",
        "long_review_render_sync_close_failed",
        error
      );
    }
  }
}

export async function syncLongReviewRenderFile(filePath) {
  if (arguments.length !== 1) {
    throw new TypeError("long-review file fsync does not accept dependency injection");
  }
  const resolvedPath = resolve(filePath);
  const stat = await lstat(resolvedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw durabilityError(
      "长片 durable publication 只能同步普通文件",
      "long_review_render_file_sync_path_unsafe"
    );
  }
  let handle;
  let operationError = null;
  try {
    handle = await open(resolvedPath, "r");
    await handle.sync();
  } catch (error) {
    operationError = durabilityError(
      `长片 durable publication 文件 fsync 失败: ${resolvedPath}`,
      "long_review_render_file_sync_failed",
      error
    );
    throw operationError;
  } finally {
    await closeDurabilityHandle(handle, operationError);
  }
  return { path: resolvedPath, durable: true };
}

export async function syncLongReviewRenderDirectory(directoryPath) {
  if (arguments.length !== 1) {
    throw new TypeError("long-review directory fsync does not accept dependency injection");
  }
  const resolvedPath = resolve(directoryPath);
  const stat = await lstat(resolvedPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw durabilityError(
      "长片 durable publication 只能同步普通目录",
      "long_review_render_directory_sync_path_unsafe"
    );
  }
  let handle;
  let operationError = null;
  try {
    handle = await open(resolvedPath, "r");
    await handle.sync();
  } catch (error) {
    const unsupported = isUnsupportedLongReviewDirectorySyncError(
      error,
      process.platform
    );
    operationError = durabilityError(
      unsupported
        ? `当前平台不支持长片 publication 目录 fsync: ${resolvedPath}`
        : `长片 durable publication 目录 fsync 失败: ${resolvedPath}`,
      unsupported
        ? "long_review_render_directory_sync_unsupported"
        : "long_review_render_directory_sync_failed",
      error
    );
    throw operationError;
  } finally {
    await closeDurabilityHandle(handle, operationError);
  }
  return { path: resolvedPath, durable: true };
}

function sqliteBusy(error) {
  return /database is (?:locked|busy)/iu.test(error?.message ?? "");
}

function lockTiming(options) {
  const parsedTimeoutMs = Number(options.lockTimeoutMs ?? 0);
  const parsedRetryDelayMs = Number(options.lockRetryDelayMs ?? 25);
  return {
    timeoutMs: Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs >= 0
      ? parsedTimeoutMs
      : 0,
    retryDelayMs: Number.isFinite(parsedRetryDelayMs) && parsedRetryDelayMs >= 1
      ? parsedRetryDelayMs
      : 25
  };
}

async function runSqliteLockStep(operation, timing, deadline) {
  while (true) {
    try {
      return operation();
    } catch (error) {
      if (!sqliteBusy(error)) throw error;
      if (Date.now() >= deadline) {
        throw renderJobLockError(
          "同一长片 workDirectory 已有渲染任务运行，拒绝并发启动",
          "long_review_render_job_locked",
          error
        );
      }
      await delay(Math.min(timing.retryDelayMs, Math.max(1, deadline - Date.now())));
    }
  }
}

export async function acquireLongReviewRenderJobLock(workDirectory, options = {}) {
  const normalizedWorkDirectory = resolve(workDirectory);
  await mkdir(normalizedWorkDirectory, { recursive: true });
  const workDirectoryStat = await lstat(normalizedWorkDirectory);
  if (!workDirectoryStat.isDirectory() || workDirectoryStat.isSymbolicLink()) {
    throw renderJobLockError(
      "长片 workDirectory 必须是普通目录且不能是符号链接",
      "long_review_render_job_lock_path_unsafe"
    );
  }
  const workDirectoryIdentity = readLongReviewRenderLockPathIdentity(
    normalizedWorkDirectory,
    "directory",
    "长片 workDirectory"
  );
  if (
    options.publicationDirectory !== undefined &&
    (typeof options.publicationDirectory !== "string" ||
      !options.publicationDirectory.trim())
  ) {
    throw new TypeError("long-review publicationDirectory must be a non-empty path");
  }
  const normalizedPublicationDirectory = resolve(
    options.publicationDirectory ?? normalizedWorkDirectory
  );
  if (
    normalizedPublicationDirectory !== normalizedWorkDirectory &&
    dirname(normalizedPublicationDirectory) !== normalizedWorkDirectory
  ) {
    throw renderJobLockError(
      "长片 publicationDirectory 只能是 workDirectory 或其直接子目录",
      "long_review_render_job_lock_path_unsafe"
    );
  }
  if (normalizedPublicationDirectory !== normalizedWorkDirectory) {
    try {
      await mkdir(normalizedPublicationDirectory);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  const publicationDirectoryStat = await lstat(normalizedPublicationDirectory);
  if (
    !publicationDirectoryStat.isDirectory() ||
    publicationDirectoryStat.isSymbolicLink()
  ) {
    throw renderJobLockError(
      "长片 publicationDirectory 必须是普通目录且不能是符号链接",
      "long_review_render_job_lock_path_unsafe"
    );
  }
  const publicationDirectoryIdentity = readLongReviewRenderLockPathIdentity(
    normalizedPublicationDirectory,
    "directory",
    "长片 publicationDirectory"
  );

  const token = options.token ?? randomUUID();
  if (typeof token !== "string" || !/^[a-f0-9-]{8,80}$/u.test(token)) {
    throw new TypeError("long-review render attempt token must be a lowercase UUID-like value");
  }
  const jobId = options.jobId ?? "long-review-render";
  if (typeof jobId !== "string" || !jobId.trim()) {
    throw new TypeError("long-review render lock requires a jobId");
  }

  const databasePath = resolve(normalizedWorkDirectory, LONG_REVIEW_RENDER_JOB_LOCK_FILE);
  try {
    const databaseStat = await lstat(databasePath);
    if (!databaseStat.isFile() || databaseStat.isSymbolicLink()) {
      throw renderJobLockError(
        "长片渲染任务锁必须是普通 SQLite 文件且不能是符号链接",
        "long_review_render_job_lock_path_unsafe"
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const timing = lockTiming(options);
  const deadline = Date.now() + timing.timeoutMs;
  let database;
  let transactionOpen = false;
  try {
    database = new DatabaseSync(databasePath);
    database.exec("PRAGMA busy_timeout = 0");
    await runSqliteLockStep(() => database.exec(`
      CREATE TABLE IF NOT EXISTS render_job_lock_owner (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        token TEXT NOT NULL,
        job_id TEXT NOT NULL,
        pid INTEGER NOT NULL,
        hostname TEXT NOT NULL,
        acquired_at TEXT NOT NULL
      )
    `), timing, deadline);
    await runSqliteLockStep(() => database.exec("BEGIN IMMEDIATE"), timing, deadline);
    transactionOpen = true;
    const owner = {
      token,
      jobId,
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: new Date().toISOString()
    };
    database.prepare(`
      INSERT OR REPLACE INTO render_job_lock_owner
        (singleton, token, job_id, pid, hostname, acquired_at)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run(owner.token, owner.jobId, owner.pid, owner.hostname, owner.acquiredAt);

    const databaseIdentity = readLongReviewRenderLockPathIdentity(
      databasePath,
      "file",
      "长片渲染任务锁数据库"
    );

    let held = true;
    const assertFilesystemIdentity = () => {
      assertLongReviewRenderLockPathIdentity(
        workDirectoryIdentity,
        "长片 workDirectory"
      );
      assertLongReviewRenderLockPathIdentity(
        databaseIdentity,
        "长片渲染任务锁数据库"
      );
      assertLongReviewRenderLockPathIdentity(
        publicationDirectoryIdentity,
        "长片 publicationDirectory"
      );
      return true;
    };
    const assertOwned = () => {
      if (!held || !transactionOpen) {
        throw renderJobLockError(
          "长片渲染任务锁已释放",
          "long_review_render_job_lock_lost"
        );
      }
      assertFilesystemIdentity();
      const active = database.prepare(
        "SELECT token, job_id AS jobId FROM render_job_lock_owner WHERE singleton = 1"
      ).get();
      if (active?.token !== token || active?.jobId !== jobId) {
        throw renderJobLockError(
          "长片渲染任务锁 owner token 已变化",
          "long_review_render_job_lock_lost"
        );
      }
      assertFilesystemIdentity();
      return true;
    };
    const release = () => {
      if (!held) return false;
      held = false;
      try {
        if (transactionOpen) database.exec("ROLLBACK");
        transactionOpen = false;
      } finally {
        database.close();
        database = undefined;
      }
      return true;
    };
    const jobLock = Object.freeze({
      token,
      owner: Object.freeze(owner),
      databasePath,
      publicationDirectory: normalizedPublicationDirectory,
      assertOwned,
      release,
      publishAttemptPair(publication) {
        if (arguments.length !== 1 || !publication || typeof publication !== "object") {
          throw new TypeError("long-review chunk publication requires one options object");
        }
        const unsupportedOption = Object.keys(publication).find(
          (key) => ![
            "attemptToken",
            "videoPartPath",
            "videoPath",
            "metadataPartPath",
            "metadataPath"
          ].includes(key)
        );
        if (unsupportedOption) {
          throw new TypeError(
            `long-review chunk publication does not accept: ${unsupportedOption}`
          );
        }
        return publishLongReviewRenderAttemptPair({ ...publication, jobLock });
      }
    });
    longReviewRenderJobLockStates.set(jobLock, Object.freeze({
      token,
      jobId,
      workDirectory: normalizedWorkDirectory,
      workDirectoryIdentity,
      publicationDirectory: normalizedPublicationDirectory,
      publicationDirectoryIdentity,
      databasePath,
      databaseIdentity,
      assertOwned
    }));
    return jobLock;
  } catch (error) {
    if (transactionOpen) {
      try {
        database?.exec("ROLLBACK");
      } catch {
        // Preserve the original acquisition error.
      }
    }
    try {
      database?.close();
    } catch {
      // Preserve the original acquisition error.
    }
    throw error;
  }
}

function assertRenderAttemptToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9-]{8,80}$/u.test(token)) {
    throw new TypeError("long-review render attempt token must be a lowercase UUID-like value");
  }
  return token;
}

export function bindLongReviewRenderWorkerToParent({
  attemptToken,
  onParentLost = () => {},
  handshakeTimeoutMs = 5_000
} = {}) {
  const token = assertRenderAttemptToken(attemptToken);
  if (typeof process.send !== "function" || !process.connected) {
    throw renderJobLockError(
      "长片 chunk worker 必须由持锁 parent 通过 IPC 启动",
      "long_review_render_parent_binding_missing"
    );
  }
  if (typeof onParentLost !== "function") {
    throw new TypeError("long-review parent-loss handler must be a function");
  }
  if (!Number.isSafeInteger(handshakeTimeoutMs) || handshakeTimeoutMs < 1) {
    throw new TypeError("long-review parent binding timeout must be a positive integer");
  }

  let bound = false;
  let disposed = false;
  let parentLost = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolveBinding, rejectBinding) => {
    resolveReady = resolveBinding;
    rejectReady = rejectBinding;
  });

  const bindingError = (message, code) => renderJobLockError(message, code);
  const timeout = setTimeout(() => {
    if (bound || disposed || parentLost) return;
    rejectReady(bindingError(
      "长片 chunk worker 未收到 parent owner 绑定",
      "long_review_render_parent_binding_timeout"
    ));
  }, handshakeTimeoutMs);
  timeout.unref?.();

  const handleMessage = (message) => {
    if (disposed || bound || parentLost) return;
    if (
      message?.protocol !== LONG_REVIEW_RENDER_PARENT_BINDING_PROTOCOL ||
      message?.attemptToken !== token
    ) {
      return;
    }
    bound = true;
    clearTimeout(timeout);
    resolveReady(true);
  };
  const handleDisconnect = () => {
    if (disposed || parentLost) return;
    parentLost = true;
    clearTimeout(timeout);
    const error = bindingError(
      "长片 chunk worker 的 parent IPC 已断开",
      "long_review_render_parent_lost"
    );
    if (!bound) rejectReady(error);
    try {
      onParentLost(error);
    } catch {
      // Parent loss remains authoritative even if cancellation reporting fails.
    }
  };
  process.on("message", handleMessage);
  process.once("disconnect", handleDisconnect);

  return {
    ready,
    assertConnected() {
      if (disposed || !bound || parentLost || !process.connected) {
        throw bindingError(
          "长片 chunk worker 已失去 parent owner 绑定",
          "long_review_render_parent_lost"
        );
      }
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      clearTimeout(timeout);
      process.off("message", handleMessage);
      process.off("disconnect", handleDisconnect);
      return true;
    }
  };
}

async function assertRegularAttemptPart(filePath, attemptToken, label) {
  const token = assertRenderAttemptToken(attemptToken);
  const resolvedPath = resolve(filePath);
  if (!basename(resolvedPath).includes(`.attempt-${token}`)) {
    throw renderJobLockError(
      `${label} 不属于当前长片 render attempt`,
      "long_review_render_attempt_path_mismatch"
    );
  }
  const stat = await lstat(resolvedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw renderJobLockError(
      `${label} 必须是普通文件且不能是符号链接`,
      "long_review_render_attempt_path_unsafe"
    );
  }
  return resolvedPath;
}

async function publishLongReviewRenderAttemptPair({
  jobLock,
  attemptToken,
  videoPartPath,
  videoPath,
  metadataPartPath,
  metadataPath
} = {}) {
  const token = assertRenderAttemptToken(attemptToken);
  const lockState = jobLock && typeof jobLock === "object"
    ? longReviewRenderJobLockStates.get(jobLock)
    : null;
  if (!lockState || lockState.token !== token) {
    throw renderJobLockError(
      "只有仍持有同一 owner token 的 parent 可以发布稳定 chunk",
      "long_review_render_publish_owner_mismatch"
    );
  }

  const resolvedVideoPath = resolve(videoPath);
  const resolvedMetadataPath = resolve(metadataPath);
  const resolvedVideoPartPath = await assertRegularAttemptPart(
    videoPartPath,
    token,
    "chunk video part"
  );
  const resolvedMetadataPartPath = await assertRegularAttemptPart(
    metadataPartPath,
    token,
    "chunk metadata part"
  );
  const publicationDirectory = dirname(resolvedVideoPath);
  if (
    publicationDirectory !== lockState.publicationDirectory ||
    dirname(resolvedMetadataPath) !== publicationDirectory ||
    dirname(resolvedVideoPartPath) !== publicationDirectory ||
    dirname(resolvedMetadataPartPath) !== publicationDirectory
  ) {
    throw renderJobLockError(
      "长片 chunk 与 metadata 必须在持锁 publicationDirectory 内发布",
      "long_review_render_publish_path_mismatch"
    );
  }
  const runWhileOwned = async (operation) => {
    lockState.assertOwned();
    const result = await operation();
    lockState.assertOwned();
    return result;
  };

  await runWhileOwned(() => syncLongReviewRenderFile(resolvedVideoPartPath));
  await runWhileOwned(() => syncLongReviewRenderFile(resolvedMetadataPartPath));
  let videoLinked = false;
  let metadataLinked = false;
  try {
    await runWhileOwned(() => link(resolvedVideoPartPath, resolvedVideoPath));
    videoLinked = true;
    await runWhileOwned(() => syncLongReviewRenderFile(resolvedVideoPath));
    await runWhileOwned(() => syncLongReviewRenderDirectory(publicationDirectory));
    await runWhileOwned(() => link(resolvedMetadataPartPath, resolvedMetadataPath));
    metadataLinked = true;
    await runWhileOwned(() => syncLongReviewRenderFile(resolvedMetadataPath));
    await runWhileOwned(() => syncLongReviewRenderDirectory(publicationDirectory));
  } catch (error) {
    let stillOwned = false;
    try {
      stillOwned = lockState.assertOwned();
    } catch {
      // Never remove a stable path after ownership is lost: a successor may own it.
    }
    if (stillOwned) {
      if (metadataLinked) {
        await unlink(resolvedMetadataPath).catch(() => {});
      }
      if (videoLinked) {
        await unlink(resolvedVideoPath).catch(() => {});
      }
      await runWhileOwned(
        () => syncLongReviewRenderDirectory(publicationDirectory)
      ).catch(() => {
        // The original durability failure remains authoritative and fail-closed.
      });
    }
    throw error;
  }

  await runWhileOwned(() => unlink(resolvedVideoPartPath));
  await runWhileOwned(() => unlink(resolvedMetadataPartPath));
  await runWhileOwned(() => syncLongReviewRenderDirectory(publicationDirectory));
  return {
    videoPath: resolvedVideoPath,
    metadataPath: resolvedMetadataPath,
    attemptToken: token,
    durability: {
      durable: true,
      protocol: "file-and-directory-fsync-v1"
    }
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ensureInside(parent, candidate, label) {
  const resolvedParent = resolve(parent);
  const resolvedCandidate = resolve(candidate);
  if (
    resolvedCandidate !== resolvedParent &&
    !resolvedCandidate.startsWith(`${resolvedParent}${sep}`)
  ) {
    throw new Error(`${label} escapes its allowed directory`);
  }
  return resolvedCandidate;
}

async function assertSafeWorkspacePath({
  workspaceRoot,
  candidate,
  label,
  allowMissing = false,
  expectedType = null
}) {
  const lexicalRoot = resolve(workspaceRoot);
  const lexicalCandidate = ensureInside(lexicalRoot, candidate, label);
  const canonicalRoot = await realpath(lexicalRoot);
  const segments = relative(lexicalRoot, lexicalCandidate).split(sep).filter(Boolean);
  let current = lexicalRoot;
  let currentStat = await lstat(current);
  if (!currentStat.isDirectory() || currentStat.isSymbolicLink()) {
    throw new Error(`${label} workspace root must be a regular directory`);
  }
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      currentStat = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT" && allowMissing) break;
      throw new Error(`${label} does not exist or cannot be inspected`, { cause: error });
    }
    if (currentStat.isSymbolicLink()) {
      throw new Error(`${label} must not contain symlink path components`);
    }
    const canonicalCurrent = await realpath(current);
    ensureInside(canonicalRoot, canonicalCurrent, label);
  }
  try {
    const stat = await lstat(lexicalCandidate);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} must not be a symlink`);
    }
    if (expectedType === "file" && !stat.isFile()) {
      throw new Error(`${label} must be a regular file`);
    }
    if (expectedType === "directory" && !stat.isDirectory()) {
      throw new Error(`${label} must be a directory when it already exists`);
    }
  } catch (error) {
    if (!(error?.code === "ENOENT" && allowMissing)) throw error;
  }
  return lexicalCandidate;
}

function resolveWorkspacePath(workspaceRoot, value, label) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.includes("\0") ||
    isAbsolute(value) ||
    value.split(/[\\/]/u).includes("..")
  ) {
    throw new TypeError(`${label} must be a relative workspace path`);
  }
  return ensureInside(workspaceRoot, resolve(workspaceRoot, value), label);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function parseIntegerOption(name, rawValue, { minimum, maximum }) {
  const value = Number(rawValue);
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function parseLongReviewRenderCliArguments(argv) {
  const options = {
    help: false,
    jobConfigPath: null,
    ...LONG_REVIEW_RENDER_SCHEDULING_DEFAULTS
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const takeValue = (name) => {
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
      index += 1;
      if (index >= argv.length) throw new Error(`${name} requires a value`);
      return argv[index];
    };
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--job-config" || argument.startsWith("--job-config=")) {
      options.jobConfigPath = takeValue("--job-config");
    } else if (argument === "--chunk-frames" || argument.startsWith("--chunk-frames=")) {
      options.chunkFrames = parseIntegerOption(
        "--chunk-frames",
        takeValue("--chunk-frames"),
        { minimum: 1, maximum: 18_000 }
      );
    } else if (
      argument === "--inter-chunk-pause-ms" ||
      argument.startsWith("--inter-chunk-pause-ms=")
    ) {
      options.interChunkPauseMs = parseIntegerOption(
        "--inter-chunk-pause-ms",
        takeValue("--inter-chunk-pause-ms"),
        { minimum: 0, maximum: 60_000 }
      );
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!options.help && !options.jobConfigPath) {
    throw new Error("--job-config is required for a versioned long-review render");
  }
  if (18_000 % options.chunkFrames !== 0) {
    throw new Error("--chunk-frames must divide 18000 exactly");
  }
  return options;
}

export function validateLongReviewRenderJob(job, options = {}) {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new TypeError("long-review render job must be an object");
  }
  if (job.schemaVersion !== LONG_REVIEW_RENDER_JOB_SCHEMA_VERSION) {
    throw new Error(`unsupported long-review render job schema: ${job.schemaVersion ?? "missing"}`);
  }
  if (typeof job.jobId !== "string" || !JOB_ID_PATTERN.test(job.jobId)) {
    throw new TypeError("jobId must be a lowercase versioned slug");
  }
  if (typeof job.episodeId !== "string" || !JOB_ID_PATTERN.test(job.episodeId)) {
    throw new TypeError("episodeId must be a lowercase slug");
  }
  positiveInteger(job.candidateVersion, "candidateVersion");
  if (typeof job.compositionId !== "string" || !job.compositionId.trim()) {
    throw new TypeError("compositionId is required");
  }
  const mediaContract = {
    width: positiveInteger(job.width, "width"),
    height: positiveInteger(job.height, "height"),
    fps: positiveInteger(job.fps, "fps"),
    durationInFrames: positiveInteger(job.durationInFrames, "durationInFrames")
  };
  if (
    mediaContract.width !== 1920 ||
    mediaContract.height !== 1080 ||
    mediaContract.fps !== 30 ||
    mediaContract.durationInFrames !== 18_000
  ) {
    throw new Error("long-review media contract must remain 1920x1080, 30fps, 18000 frames");
  }
  if (!job.paths || typeof job.paths !== "object" || Array.isArray(job.paths)) {
    throw new TypeError("paths are required");
  }
  const resolvedPaths = Object.fromEntries(
    ["entryPoint", "episode", "voice", "finalDirectory", "workDirectory"].map((key) => [
      key,
      resolveWorkspacePath(workspaceRoot, job.paths[key], `paths.${key}`)
    ])
  );
  ensureInside(resolve(workspaceRoot, "studio", "src", "video"), resolvedPaths.entryPoint, "paths.entryPoint");
  ensureInside(
    resolve(workspaceRoot, "studio", "data", "episodes", job.episodeId),
    resolvedPaths.episode,
    "paths.episode"
  );
  ensureInside(
    resolve(workspaceRoot, "studio", "public", "episodes", job.episodeId),
    resolvedPaths.voice,
    "paths.voice"
  );
  const reviewRoot = resolve(
    workspaceRoot,
    "outputs",
    "studio",
    job.episodeId,
    "review-candidates"
  );
  ensureInside(reviewRoot, resolvedPaths.finalDirectory, "paths.finalDirectory");
  ensureInside(reviewRoot, resolvedPaths.workDirectory, "paths.workDirectory");
  if (
    dirname(resolvedPaths.finalDirectory) !== reviewRoot ||
    dirname(resolvedPaths.workDirectory) !== reviewRoot
  ) {
    throw new Error("finalDirectory and workDirectory must each be a direct child of review-candidates");
  }
  if (
    basename(resolvedPaths.finalDirectory).startsWith(".") ||
    !basename(resolvedPaths.workDirectory).startsWith(".")
  ) {
    throw new Error("finalDirectory must be public and workDirectory must be hidden");
  }
  if (resolvedPaths.finalDirectory === resolvedPaths.workDirectory) {
    throw new Error("finalDirectory and workDirectory must be different");
  }
  const protectedArtifacts = (job.protectedArtifacts ?? []).map((artifact, index) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
      throw new TypeError(`protectedArtifacts[${index}] must be an object`);
    }
    const path = resolveWorkspacePath(
      workspaceRoot,
      artifact.path,
      `protectedArtifacts[${index}].path`
    );
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) {
      throw new TypeError(`protectedArtifacts[${index}].bytes must be a non-negative integer`);
    }
    if (typeof artifact.sha256 !== "string" || !HASH_PATTERN.test(artifact.sha256)) {
      throw new TypeError(`protectedArtifacts[${index}].sha256 must be SHA-256`);
    }
    return { path, bytes: artifact.bytes, sha256: artifact.sha256 };
  });
  if (typeof job.temporaryVoice !== "boolean") {
    throw new TypeError("temporaryVoice must be explicit");
  }
  if (typeof job.temporaryVoiceIsFinalHumanRecording !== "boolean") {
    throw new TypeError("temporaryVoiceIsFinalHumanRecording must be explicit");
  }
  if (job.temporaryVoice && job.temporaryVoiceIsFinalHumanRecording) {
    throw new Error("temporary voice cannot be declared a final human recording");
  }
  const versionToken = `v${String(job.candidateVersion).padStart(3, "0")}`;
  const finalDirectoryName = basename(resolvedPaths.finalDirectory);
  const workDirectoryName = basename(resolvedPaths.workDirectory);
  if (!job.jobId.endsWith(`-${versionToken}`)) {
    throw new Error(`jobId must end with the candidate version token ${versionToken}`);
  }
  if (!finalDirectoryName.endsWith(`-${versionToken}`)) {
    throw new Error(`finalDirectory must end with the candidate version token ${versionToken}`);
  }
  if (workDirectoryName !== `.${finalDirectoryName}-work`) {
    throw new Error("workDirectory must be the hidden, version-matched sibling of finalDirectory");
  }
  return {
    schemaVersion: job.schemaVersion,
    jobId: job.jobId,
    episodeId: job.episodeId,
    candidateVersion: job.candidateVersion,
    compositionId: job.compositionId,
    ...mediaContract,
    paths: structuredClone(job.paths),
    resolvedPaths,
    protectedArtifacts,
    temporaryVoice: job.temporaryVoice,
    temporaryVoiceIsFinalHumanRecording: job.temporaryVoiceIsFinalHumanRecording
  };
}

export async function assertLongReviewRenderJobFilesystemSafety(job, options = {}) {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const checks = [
    {
      candidate: job.resolvedPaths.entryPoint,
      label: "paths.entryPoint",
      expectedType: "file"
    },
    {
      candidate: job.resolvedPaths.episode,
      label: "paths.episode",
      expectedType: "file"
    },
    {
      candidate: job.resolvedPaths.voice,
      label: "paths.voice",
      expectedType: "file"
    },
    {
      candidate: job.resolvedPaths.finalDirectory,
      label: "paths.finalDirectory",
      expectedType: "directory",
      allowMissing: true
    },
    {
      candidate: job.resolvedPaths.workDirectory,
      label: "paths.workDirectory",
      expectedType: "directory",
      allowMissing: true
    },
    ...job.protectedArtifacts.map((artifact, index) => ({
      candidate: artifact.path,
      label: `protectedArtifacts[${index}].path`,
      expectedType: "file"
    }))
  ];
  if (options.jobConfigPath) {
    checks.unshift({
      candidate: ensureInside(workspaceRoot, options.jobConfigPath, "jobConfigPath"),
      label: "jobConfigPath",
      expectedType: "file"
    });
  }
  for (const check of checks) {
    await assertSafeWorkspacePath({ workspaceRoot, ...check });
  }
  return job;
}

export function longReviewSourceInputs(job, options = {}) {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const scriptPath = ensureInside(workspaceRoot, options.scriptPath, "scriptPath");
  const jobConfigPath = ensureInside(workspaceRoot, options.jobConfigPath, "jobConfigPath");
  return [
    scriptPath,
    jobConfigPath,
    resolve(workspaceRoot, "studio", "src"),
    resolve(workspaceRoot, "studio", "public"),
    resolve(workspaceRoot, ".node-version"),
    resolve(workspaceRoot, "studio", "package.json"),
    resolve(workspaceRoot, "studio", "pnpm-lock.yaml"),
    resolve(workspaceRoot, "studio", "config", "visual-system.json"),
    job.resolvedPaths.episode
  ];
}

async function inspectPlainFile(filePath, root) {
  const before = await lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Git material must be a plain file: ${relative(root, filePath)}`);
  }
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  const after = await lstat(filePath);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(`Git material changed while hashing: ${relative(root, filePath)}`);
  }
  return { bytes, sha256: hash.digest("hex") };
}

export async function captureContentAwareGitIdentity(options = {}) {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const maxBuffer = 64 * 1024 * 1024;
  const command = options.execFileAsync ?? execFileAsync;
  const [{ stdout: head }, { stdout: status }, { stdout: trackedDiff }, { stdout: untracked }] =
    await Promise.all([
      command("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8", maxBuffer }),
      command(
        "git",
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        { cwd: workspaceRoot, encoding: "utf8", maxBuffer }
      ),
      command("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        maxBuffer
      }),
      command("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
        cwd: workspaceRoot,
        encoding: "utf8",
        maxBuffer
      })
    ]);
  const headSha = head.trim();
  if (!/^[a-f0-9]{40,64}$/u.test(headSha)) {
    throw new Error(`Unexpected Git HEAD hash: ${headSha}`);
  }
  const records = [];
  const aggregate = createHash("sha256");
  for (const path of untracked.split("\0").filter(Boolean).sort()) {
    const absolute = resolveWorkspacePath(workspaceRoot, path, "untracked Git path");
    const integrity = await inspectPlainFile(absolute, workspaceRoot);
    const normalized = relative(workspaceRoot, absolute).replaceAll("\\", "/");
    aggregate.update(normalized);
    aggregate.update("\0");
    aggregate.update(integrity.sha256);
    aggregate.update("\0");
    records.push({ path: normalized, ...integrity });
  }
  return {
    headSha,
    statusSha256: sha256(status),
    trackedDiffSha256: sha256(trackedDiff),
    untracked: {
      algorithm: "sha256",
      sha256: aggregate.digest("hex"),
      fileCount: records.length,
      files: records
    }
  };
}
