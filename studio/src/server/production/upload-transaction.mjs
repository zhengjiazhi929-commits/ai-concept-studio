import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { hostname } from "node:os";
import { relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  ensureInside,
  episodesDataRoot,
  productionDataRoot,
  publicRoot,
  resolveExistingPathInside
} from "../../shared/paths.mjs";
import { readEpisode as readStoredEpisode } from "../../shared/store.mjs";

export const pendingUploadTransactionRoot = resolve(
  productionDataRoot,
  "upload-transactions",
  "pending"
);
export const uploadTransactionQuarantineRoot = resolve(
  productionDataRoot,
  "upload-transactions",
  "quarantine"
);
export const uploadTransactionStagingRoot = resolve(
  productionDataRoot,
  "upload-transactions",
  "staging"
);
export const uploadTransactionLockRoot = resolve(
  productionDataRoot,
  "upload-transactions",
  "lock"
);
export const uploadTransactionLockQuarantineRoot = resolve(
  productionDataRoot,
  "upload-transactions",
  "lock-quarantine"
);

function uploadTransactionError(message, code, statusCode = 500, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function sameIdentity(left, right) {
  return Boolean(
    left && right &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size
  );
}

function isInside(root, target) {
  const nested = relative(resolve(root), resolve(target));
  return nested === "" || (!nested.startsWith(`..${sep}`) && nested !== "..");
}

function transactionSiblingRoot(markerRoot, name) {
  return resolve(markerRoot, "..", name);
}

async function assertPrivateTransactionRoot(markerRoot, allowedRoot) {
  await Promise.all([
    mkdir(markerRoot, { recursive: true, mode: 0o700 }),
    mkdir(allowedRoot, { recursive: true })
  ]);
  const [realMarkerRoot, realAllowedRoot] = await Promise.all([
    realpath(markerRoot),
    realpath(allowedRoot)
  ]);
  if (isInside(realAllowedRoot, realMarkerRoot)) {
    throw uploadTransactionError(
      "上传事务 marker 必须位于不可公开访问的私有目录",
      "upload_transaction_marker_public"
    );
  }
  return { realMarkerRoot, realAllowedRoot };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function validateLockOwner(owner) {
  return Boolean(
    owner &&
    typeof owner === "object" &&
    !Array.isArray(owner) &&
    typeof owner.token === "string" &&
    /^[a-f0-9-]+$/u.test(owner.token) &&
    Number.isInteger(owner.pid) &&
    owner.pid > 0 &&
    typeof owner.hostname === "string" &&
    owner.hostname
  );
}

function defaultProcessAlive(owner) {
  if (owner.hostname !== hostname()) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function acquireUploadTransactionLock(options) {
  const lockBoundary = await assertPrivateTransactionRoot(
    resolve(options.lockRoot),
    resolve(options.allowedRoot)
  );
  const quarantineBoundary = await assertPrivateTransactionRoot(
    resolve(options.lockQuarantineRoot),
    resolve(options.allowedRoot)
  );
  const activePath = resolve(lockBoundary.realMarkerRoot, "active.lock");
  const waitMs = Math.max(0, Number(options.waitMs ?? 0));
  const deadline = Date.now() + waitMs;

  while (true) {
    const token = randomUUID();
    const owner = {
      schemaVersion: 1,
      token,
      pid: process.pid,
      hostname: hostname(),
      createdAt: new Date().toISOString()
    };
    const candidate = resolve(
      lockBoundary.realMarkerRoot,
      `.lock-${token}.tmp`
    );
    await writeFile(candidate, `${JSON.stringify(owner)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    try {
      await link(candidate, activePath);
      let held = true;
      return {
        async release() {
          if (!held) return false;
          held = false;
          let current;
          try {
            current = JSON.parse(await readFile(activePath, "utf8"));
          } catch (error) {
            if (error?.code === "ENOENT") return false;
            throw error;
          }
          if (current?.token !== token) return false;
          await rm(activePath, { force: true });
          return true;
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let existing;
      try {
        existing = JSON.parse(await readFile(activePath, "utf8"));
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        throw uploadTransactionError(
          "上传事务互斥锁无法验证，恢复已安全停止",
          "upload_transaction_lock_invalid",
          503,
          readError
        );
      }
      if (!validateLockOwner(existing)) {
        throw uploadTransactionError(
          "上传事务互斥锁内容无效，恢复已安全停止",
          "upload_transaction_lock_invalid",
          503
        );
      }
      const alive = await (options.isProcessAlive ?? defaultProcessAlive)(existing);
      if (alive) {
        if (Date.now() < deadline) {
          await delay(Math.min(20, Math.max(1, deadline - Date.now())));
          continue;
        }
        throw uploadTransactionError(
          "另一个上传事务仍在进行，恢复已安全停止",
          "upload_transaction_lock_busy",
          503
        );
      }
      try {
        await rename(
          activePath,
          resolve(
            quarantineBoundary.realMarkerRoot,
            `stale-${existing.token}-${randomUUID()}.lock`
          )
        );
      } catch (renameError) {
        if (renameError?.code === "ENOENT") continue;
        throw renameError;
      }
    } finally {
      await rm(candidate, { force: true }).catch(() => undefined);
    }
  }
}

function validateEpisodeId(value) {
  const episodeId = String(value ?? "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u.test(episodeId)) {
    throw uploadTransactionError(
      "上传事务 episodeId 无效",
      "upload_transaction_marker_invalid"
    );
  }
  return episodeId;
}

function validatePublicPath(value) {
  const publicPath = String(value ?? "");
  if (
    !publicPath ||
    publicPath.startsWith("/") ||
    publicPath.includes("\\") ||
    /(?:^|\/)\.\.(?:\/|$)/u.test(publicPath) ||
    /[\u0000-\u001f\u007f]/u.test(publicPath)
  ) {
    throw uploadTransactionError(
      "上传事务 publicPath 无效",
      "upload_transaction_marker_invalid"
    );
  }
  return publicPath;
}

function validateAuditActor(value) {
  const actor = String(value ?? "").trim();
  if (!actor || actor.length > 128 || /[\u0000-\u001f\u007f]/u.test(actor)) {
    throw uploadTransactionError(
      "上传审计 outbox actor 无效",
      "upload_transaction_marker_invalid",
      503
    );
  }
  return actor;
}

function expectedUploadAuditEventId(marker) {
  return `upload-transaction:${marker.transactionId}:${marker.kind}.uploaded`;
}

function validateUploadAuditEvent(marker) {
  const event = marker.auditEvent;
  const expectedEventId = expectedUploadAuditEventId(marker);
  const expectedMessage = marker.kind === "asset"
    ? `${event?.planItemId ?? ""} 素材已上传，等待核验`
    : "旁白文件已上传，等待素材与声音核验";
  if (
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    event.eventId !== expectedEventId ||
    event.idempotencyKey !== expectedEventId ||
    event.type !== `${marker.kind}.uploaded` ||
    event.episodeId !== marker.episodeId ||
    event.at !== marker.createdAt ||
    typeof event.message !== "string" ||
    !event.message.trim() ||
    event.message.length > 512 ||
    event.message !== expectedMessage ||
    event.artifact?.path !== marker.publicPath ||
    event.artifact?.bytes !== marker.bytes ||
    event.artifact?.sha256 !== marker.sha256 ||
    (marker.kind === "asset" && (
      typeof event.planItemId !== "string" ||
      !event.planItemId.trim() ||
      event.agentId !== "asset-agent"
    )) ||
    (marker.kind === "voice" && event.agentId !== "voice-agent")
  ) {
    throw uploadTransactionError(
      "上传审计 outbox 与事务 marker 不一致",
      "upload_transaction_marker_invalid",
      503
    );
  }
  validateAuditActor(event.actor);
  return event;
}

function auditReceiptMatches(receipt, event) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  return Object.entries(event).every(([key, value]) => (
    JSON.stringify(receipt[key]) === JSON.stringify(value)
  ));
}

function assertAuditReceipt(receipt, event) {
  if (auditReceiptMatches(receipt, event)) return receipt;
  throw uploadTransactionError(
    "上传审计账本未返回与 outbox 精确匹配的幂等回执",
    "upload_audit_receipt_invalid",
    500
  );
}

function validateMarker(marker, fileName) {
  if (
    !marker ||
    typeof marker !== "object" ||
    Array.isArray(marker) ||
    ![1, 2].includes(marker.schemaVersion) ||
    marker.status !== "prepared" ||
    typeof marker.transactionId !== "string" ||
    `${marker.transactionId}.json` !== fileName ||
    !["asset", "voice"].includes(marker.kind) ||
    !Number.isInteger(marker.identity?.dev) ||
    !Number.isInteger(marker.identity?.ino) ||
    !Number.isInteger(marker.identity?.size) ||
    marker.identity.size < 0 ||
    !Number.isInteger(marker.bytes) ||
    marker.bytes < 0 ||
    marker.bytes !== marker.identity.size ||
    !/^[a-f0-9]{64}$/u.test(marker.sha256 ?? "")
  ) {
    throw uploadTransactionError(
      `上传事务 marker 无效：${fileName}`,
      "upload_transaction_marker_invalid",
      503
    );
  }
  validateEpisodeId(marker.episodeId);
  validatePublicPath(marker.publicPath);
  if (marker.schemaVersion === 2) validateUploadAuditEvent(marker);
  return marker;
}

async function writePendingMarker(options) {
  const markerRoot = resolve(options.transaction.markerRoot);
  const { realMarkerRoot, realAllowedRoot } = await assertPrivateTransactionRoot(
    markerRoot,
    options.allowedRoot
  );
  const publicPath = validatePublicPath(
    options.transaction.publicPathForFileName?.(options.fileName)
  );
  const expectedDestination = ensureInside(
    realAllowedRoot,
    resolve(realAllowedRoot, publicPath)
  );
  if (expectedDestination !== options.destination) {
    throw uploadTransactionError(
      "上传事务 publicPath 与发布目标不一致",
      "upload_transaction_marker_binding_mismatch"
    );
  }
  const transactionId = randomUUID();
  const marker = {
    schemaVersion: options.transaction.auditEventForFileName ? 2 : 1,
    transactionId,
    status: "prepared",
    episodeId: validateEpisodeId(options.transaction.episodeId),
    kind: options.transaction.kind,
    publicPath,
    identity: {
      dev: options.identity.dev,
      ino: options.identity.ino,
      size: options.identity.size
    },
    bytes: options.identity.size,
    sha256: options.sha256,
    createdAt: new Date(options.transaction.now?.() ?? Date.now()).toISOString()
  };
  if (!["asset", "voice"].includes(marker.kind)) {
    throw uploadTransactionError(
      "上传事务 kind 无效",
      "upload_transaction_marker_invalid"
    );
  }
  if (marker.schemaVersion === 2) {
    const eventDetails = options.transaction.auditEventForFileName(options.fileName) ?? {};
    const eventId = expectedUploadAuditEventId(marker);
    marker.auditEvent = {
      eventId,
      idempotencyKey: eventId,
      at: marker.createdAt,
      type: `${marker.kind}.uploaded`,
      episodeId: marker.episodeId,
      actor: validateAuditActor(eventDetails.actor),
      agentId: marker.kind === "asset" ? "asset-agent" : "voice-agent",
      ...(marker.kind === "asset"
        ? { planItemId: String(eventDetails.planItemId ?? "").trim() }
        : {}),
      message: String(eventDetails.message ?? "").trim(),
      artifact: {
        path: marker.publicPath,
        bytes: marker.bytes,
        sha256: marker.sha256
      },
      rights: structuredClone(eventDetails.rights ?? null)
    };
    validateUploadAuditEvent(marker);
  }
  const markerPath = resolve(realMarkerRoot, `${transactionId}.json`);
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  return { marker, markerPath };
}

function episodeBindingForMarker(episodes, marker) {
  const episode = episodes.find((candidate) => candidate?.id === marker.episodeId);
  if (!episode) return null;
  if (marker.kind === "asset") {
    const reference = (episode.assets ?? []).find(
      (asset) => asset?.path === marker.publicPath
    ) ?? null;
    return reference ? { episode, reference } : null;
  }
  return episode.voice?.publicPath === marker.publicPath
    ? { episode, reference: episode.voice }
    : null;
}

function validateCommittedAuditOutbox(binding, marker) {
  if (marker.schemaVersion !== 2) return;
  const event = validateUploadAuditEvent(marker);
  const historyType = marker.kind === "asset" ? "asset-upload" : "voice-upload";
  const history = (binding.episode.history ?? []).find((entry) => (
    entry?.type === historyType &&
    entry.auditEventId === event.eventId &&
    entry.at === event.at &&
    entry.actor === event.actor
  ));
  if (
    !history ||
    (marker.kind === "asset" && binding.reference?.planItemId !== event.planItemId) ||
    JSON.stringify(binding.reference?.rights ?? null) !==
      JSON.stringify(event.rights ?? null)
  ) {
    throw uploadTransactionError(
      "已提交上传与审计 outbox 的 Episode 绑定无效，恢复已安全停止",
      "upload_recovery_audit_outbox_invalid",
      503
    );
  }
}

async function deliverCommittedAuditOutbox(marker, options) {
  if (marker.schemaVersion !== 2) return null;
  if (typeof options.appendEvent !== "function") {
    throw uploadTransactionError(
      "上传恢复缺少审计写入器，恢复已安全停止",
      "upload_recovery_audit_writer_missing",
      503
    );
  }
  const event = validateUploadAuditEvent(marker);
  return assertAuditReceipt(await options.appendEvent(event), event);
}

async function inspectPublishedFile(allowedRoot, publicPath) {
  const destination = ensureInside(
    allowedRoot,
    resolve(allowedRoot, publicPath)
  );
  try {
    const resolvedDestination = await resolveExistingPathInside(
      allowedRoot,
      destination
    );
    return {
      destination,
      resolvedDestination,
      identity: await lstat(resolvedDestination)
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { destination, resolvedDestination: null, identity: null };
    }
    throw error;
  }
}

async function quarantineAbandonedStaging(stagingRoot, quarantineRoot) {
  const entries = await readdir(stagingRoot, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^\.upload-[a-f0-9-]+\.tmp$/u.test(entry.name)) {
      throw uploadTransactionError(
        `私有上传 staging 包含无法恢复的条目：${entry.name}`,
        "upload_transaction_staging_invalid",
        503
      );
    }
    await rename(
      resolve(stagingRoot, entry.name),
      resolve(quarantineRoot, `staging-${randomUUID()}.tmp`)
    );
    count += 1;
  }
  return count;
}

async function readPendingMarkers(markerRoot) {
  const entries = await readdir(markerRoot, { withFileTypes: true });
  const markers = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9-]+\.json$/u.test(entry.name)) {
      throw uploadTransactionError(
        `上传事务目录包含无法裁决的条目：${entry.name}`,
        "upload_transaction_marker_invalid",
        503
      );
    }
    const markerPath = resolve(markerRoot, entry.name);
    let marker;
    try {
      marker = JSON.parse(await readFile(markerPath, "utf8"));
    } catch (error) {
      throw uploadTransactionError(
        `上传事务 marker 无法读取：${entry.name}`,
        "upload_transaction_marker_invalid",
        503,
        error
      );
    }
    markers.push({ marker: validateMarker(marker, entry.name), markerPath });
  }
  return markers;
}

async function listEpisodesForUploadRecovery() {
  await mkdir(episodesDataRoot, { recursive: true });
  const entries = await readdir(episodesDataRoot, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readStoredEpisode(entry.name))
  );
}

export async function recoverPendingUploadTransactions(options = {}) {
  const markerRoot = resolve(options.markerRoot ?? pendingUploadTransactionRoot);
  const quarantineRoot = resolve(
    options.quarantineRoot ?? uploadTransactionQuarantineRoot
  );
  const allowedRoot = resolve(options.allowedRoot ?? publicRoot);
  const stagingRoot = resolve(
    options.stagingRoot ?? transactionSiblingRoot(markerRoot, "staging")
  );
  const lockRoot = resolve(
    options.lockRoot ?? transactionSiblingRoot(markerRoot, "lock")
  );
  const lockQuarantineRoot = resolve(
    options.lockQuarantineRoot ??
      transactionSiblingRoot(markerRoot, "lock-quarantine")
  );
  const transactionLock = await acquireUploadTransactionLock({
    allowedRoot,
    lockRoot,
    lockQuarantineRoot,
    waitMs: options.lockWaitMs ?? 0,
    isProcessAlive: options.isProcessAlive
  });
  try {
    const markerBoundary = await assertPrivateTransactionRoot(markerRoot, allowedRoot);
    const quarantineBoundary = await assertPrivateTransactionRoot(
      quarantineRoot,
      allowedRoot
    );
    const stagingBoundary = await assertPrivateTransactionRoot(stagingRoot, allowedRoot);
    const pending = await readPendingMarkers(markerBoundary.realMarkerRoot);
    const emptyResult = {
      pendingCount: pending.length,
      committedCount: 0,
      quarantinedCount: 0,
      removedFinalCount: 0,
      detachedMarkerCount: 0,
      quarantinedStagingCount: 0
    };
    if (pending.length === 0) {
      emptyResult.quarantinedStagingCount = await quarantineAbandonedStaging(
        stagingBoundary.realMarkerRoot,
        quarantineBoundary.realMarkerRoot
      );
      return emptyResult;
    }

    let episodes;
    try {
      // Unlike the dashboard list, recovery must not skip an unreadable Episode:
      // an omitted reference could make a committed upload look like an orphan.
      episodes = await (options.listEpisodes ?? listEpisodesForUploadRecovery)();
      if (!Array.isArray(episodes)) throw new Error("Episode 列表不是数组");
    } catch (error) {
      throw uploadTransactionError(
        "无法读取完整 Episode 列表，上传事务恢复已安全停止",
        "upload_recovery_episode_list_unavailable",
        503,
        error
      );
    }

    // Decide and verify the complete batch before mutating any final or marker.
    // One corrupt committed item therefore keeps every recovery record intact.
    const decisions = [];
    for (const pendingItem of pending) {
      const { marker } = pendingItem;
      const binding = episodeBindingForMarker(episodes, marker);
      const published = await inspectPublishedFile(
        markerBoundary.realAllowedRoot,
        marker.publicPath
      );
      if (binding) {
        const finalHash = published.resolvedDestination && published.identity?.isFile()
          ? await sha256File(published.resolvedDestination)
          : null;
        if (
          !published.identity?.isFile() ||
          !sameIdentity(marker.identity, published.identity) ||
          published.identity.size !== marker.bytes ||
          finalHash !== marker.sha256 ||
          binding.reference.bytes !== marker.bytes ||
          binding.reference.sha256 !== marker.sha256
        ) {
          throw uploadTransactionError(
            `Episode 已引用的上传文件缺失或完整性漂移：${marker.publicPath}`,
            "upload_recovery_committed_integrity_invalid",
            503
          );
        }
        validateCommittedAuditOutbox(binding, marker);
        decisions.push({ ...pendingItem, action: "committed", published, binding });
      } else if (
        published.identity &&
        sameIdentity(marker.identity, published.identity)
      ) {
        decisions.push({ ...pendingItem, action: "remove-orphan", published });
      } else {
        decisions.push({ ...pendingItem, action: "detach-marker", published });
      }
    }

    const result = {
      ...emptyResult,
      quarantinedStagingCount: await quarantineAbandonedStaging(
        stagingBoundary.realMarkerRoot,
        quarantineBoundary.realMarkerRoot
      )
    };
    // Deliver every committed outbox before removing any marker. An append
    // failure therefore leaves the entire recovery batch inspectable, while a
    // duplicate append is harmless because eventId/idempotencyKey are stable.
    for (const decision of decisions) {
      if (decision.action === "committed") {
        await deliverCommittedAuditOutbox(decision.marker, options);
      }
    }
    for (const decision of decisions) {
      if (decision.action === "committed") {
        await rm(decision.markerPath, { force: true });
        result.committedCount += 1;
        continue;
      }
      if (decision.action === "remove-orphan") {
        await rm(decision.published.destination, { force: true });
        result.removedFinalCount += 1;
      } else if (decision.published.identity) {
        // A pre-publication collision or later replacement is not owned by this
        // transaction. Keep the unrelated file and quarantine only our marker.
        result.detachedMarkerCount += 1;
      }
      await rename(
        decision.markerPath,
        resolve(
          quarantineBoundary.realMarkerRoot,
          `${decision.marker.transactionId}-${randomUUID()}.json`
        )
      );
      result.quarantinedCount += 1;
    }
    return result;
  } finally {
    await transactionLock.release();
  }
}

export async function stageExclusiveVersionedUpload(options) {
  if (!options.allowedRoot) {
    throw uploadTransactionError(
      "上传事务缺少允许写入的根目录",
      "upload_boundary_missing"
    );
  }
  const allowedRoot = resolve(options.allowedRoot);
  await mkdir(allowedRoot, { recursive: true });
  let requestedDirectory;
  try {
    requestedDirectory = ensureInside(allowedRoot, resolve(options.directory));
  } catch {
    throw uploadTransactionError(
      "上传目录位于允许根之外",
      "path_boundary_forbidden",
      403
    );
  }
  await mkdir(requestedDirectory, { recursive: true });
  const directory = await resolveExistingPathInside(allowedRoot, requestedDirectory);
  const realAllowedRoot = await realpath(allowedRoot);
  let temporaryDirectory = directory;
  let transaction = null;
  let transactionLock = null;
  let lockTransferred = false;
  if (options.transaction) {
    if (typeof options.transaction.markerRoot !== "string") {
      throw uploadTransactionError(
        "上传事务缺少私有 marker 目录",
        "upload_transaction_marker_invalid"
      );
    }
    const markerRoot = resolve(options.transaction.markerRoot);
    const stagingRoot = resolve(
      options.transaction.stagingRoot ??
        transactionSiblingRoot(markerRoot, "staging")
    );
    const lockRoot = resolve(
      options.transaction.lockRoot ?? transactionSiblingRoot(markerRoot, "lock")
    );
    const lockQuarantineRoot = resolve(
      options.transaction.lockQuarantineRoot ??
        transactionSiblingRoot(markerRoot, "lock-quarantine")
    );
    temporaryDirectory = (
      await assertPrivateTransactionRoot(stagingRoot, realAllowedRoot)
    ).realMarkerRoot;
    transactionLock = await acquireUploadTransactionLock({
      allowedRoot: realAllowedRoot,
      lockRoot,
      lockQuarantineRoot,
      waitMs: options.transaction.lockWaitMs ?? 5000,
      isProcessAlive: options.transaction.isProcessAlive
    });
    transaction = {
      ...options.transaction,
      markerRoot,
      stagingRoot,
      lockRoot,
      lockQuarantineRoot
    };
    const markerBoundary = await assertPrivateTransactionRoot(
      markerRoot,
      realAllowedRoot
    );
    const pendingEntries = await readdir(markerBoundary.realMarkerRoot);
    if (pendingEntries.length > 0) {
      await transactionLock.release();
      transactionLock = null;
      throw uploadTransactionError(
        "存在尚未恢复的上传事务；为避免重复版本和审计缺口，已拒绝新上传",
        "upload_recovery_required",
        503
      );
    }
  }
  const temporary = resolve(temporaryDirectory, `.upload-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, options.data, { flag: "wx", mode: 0o600 });
    const occupied = await readdir(directory);
    const sourceIdentity = await lstat(temporary);
    const expectedHash = createHash("sha256").update(options.data).digest("hex");
    const stagedHash = await sha256File(temporary);
    const destinationDirectoryIdentity = await lstat(directory);
    if (
      !sourceIdentity.isFile() ||
      sourceIdentity.size !== options.data.length ||
      stagedHash !== expectedHash
    ) {
      throw uploadTransactionError(
        "私有 staging 文件未通过字节完整性检查",
        "upload_transaction_staging_integrity_invalid",
        503
      );
    }
    if (sourceIdentity.dev !== destinationDirectoryIdentity.dev) {
      throw uploadTransactionError(
        "私有 staging 与公开目录不在同一文件系统，拒绝非原子发布",
        "upload_transaction_cross_device",
        503
      );
    }
    while (true) {
      const fileName = options.nextFileName(occupied);
      const destination = resolve(directory, fileName);
      let pending = null;
      if (transaction) {
        pending = await writePendingMarker({
          allowedRoot: realAllowedRoot,
          destination,
          fileName,
          identity: sourceIdentity,
          sha256: stagedHash,
          transaction
        });
      }
      try {
        // The private marker exists before this atomic publication. A restart
        // can therefore reconcile the exact crash window before Episode CAS.
        await link(temporary, destination);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        if (pending) await rm(pending.markerPath, { force: true });
        occupied.push(fileName);
        continue;
      }
      const identity = await lstat(destination);
      let markerPath = pending?.markerPath ?? null;
      const releaseLock = async () => {
        if (!transactionLock) return false;
        const lock = transactionLock;
        transactionLock = null;
        return lock.release();
      };
      const removeMarkerAndRelease = async () => {
        try {
          if (!markerPath) return false;
          await rm(markerPath, { force: true });
          markerPath = null;
          return true;
        } catch {
          // Episode and audit already reference the final. Startup recovery
          // will remove the marker without deleting the committed file.
          return false;
        } finally {
          await releaseLock();
        }
      };
      lockTransferred = true;
      return {
        fileName,
        destination,
        transactionId: pending?.marker.transactionId ?? null,
        auditEvent: pending?.marker.auditEvent ?? null,
        async commit() {
          return removeMarkerAndRelease();
        },
        async commitWithAudit(appendEvent) {
          if (!pending?.marker.auditEvent) return removeMarkerAndRelease();
          try {
            const event = validateUploadAuditEvent(pending.marker);
            assertAuditReceipt(await appendEvent(event), event);
          } catch (error) {
            await releaseLock();
            throw error;
          }
          return removeMarkerAndRelease();
        },
        async defer() {
          await releaseLock();
          return Boolean(markerPath);
        },
        async rollback() {
          try {
            const current = await lstat(destination).catch(() => null);
            if (current && !sameIdentity(identity, current)) return false;
            if (current) await rm(destination, { force: true });
            if (markerPath) {
              await rm(markerPath, { force: true });
              markerPath = null;
            }
            return Boolean(current);
          } finally {
            await releaseLock();
          }
        }
      };
    }
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (transactionLock && !lockTransferred) {
      await transactionLock.release();
    }
  }
}
