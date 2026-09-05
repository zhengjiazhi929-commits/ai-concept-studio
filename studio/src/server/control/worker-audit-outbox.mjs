import { integrityHash } from "../../shared/integrity.mjs";
import { redactSensitiveValue, safeErrorMessage } from "../../shared/redaction.mjs";

const WORKER_AUDIT_OUTBOX_SCHEMA_VERSION = 1;
const WORKER_AUDIT_EVENT_TYPES = new Set([
  "review.completed",
  "review.revision_routed",
  "agent.revision_started",
  "agent.finished"
]);

function timestamp(now) {
  const value = typeof now === "function" ? now() : now;
  return (value instanceof Date ? value : new Date(value ?? Date.now())).toISOString();
}

function outboxError(message, code, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function eventReceiptMatches(receipt, event) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const projected = Object.fromEntries(
    Object.keys(event).map((key) => [key, structuredClone(receipt[key])])
  );
  return integrityHash(projected) === integrityHash(event);
}

function validateMarker(marker, episodeId) {
  const event = marker?.event;
  if (
    !marker ||
    typeof marker !== "object" ||
    Array.isArray(marker) ||
    marker.schemaVersion !== WORKER_AUDIT_OUTBOX_SCHEMA_VERSION ||
    typeof marker.operationId !== "string" ||
    !marker.operationId ||
    typeof marker.eventHash !== "string" ||
    !event ||
    typeof event !== "object" ||
    Array.isArray(event) ||
    typeof event.eventId !== "string" ||
    !event.eventId ||
    event.idempotencyKey !== event.eventId ||
    event.episodeId !== episodeId ||
    !WORKER_AUDIT_EVENT_TYPES.has(event.type) ||
    typeof event.at !== "string" ||
    !Number.isFinite(Date.parse(event.at)) ||
    marker.eventHash !== integrityHash(event)
  ) {
    throw outboxError(
      "Worker 审计 outbox 与已提交 Episode 不一致，禁止自动补写",
      "worker_audit_outbox_invalid"
    );
  }
  return marker;
}

function workerAuditOutbox(episode) {
  const outbox = episode?.system?.workerAuditOutbox;
  if (outbox === undefined) return [];
  if (!Array.isArray(outbox)) {
    throw outboxError(
      "Worker 审计 outbox 必须是数组",
      "worker_audit_outbox_invalid"
    );
  }
  return outbox;
}

export function enqueueWorkerAuditEvents(sourceEpisode, events, options = {}) {
  const episode = structuredClone(sourceEpisode);
  episode.system = episode.system ?? {};
  const outbox = workerAuditOutbox(episode);
  const existingIds = new Set(outbox.map((marker) => marker?.event?.eventId));
  const operationId = options.operationId;
  if (typeof operationId !== "string" || !operationId) {
    throw outboxError("Worker 审计 outbox 缺少 operationId", "worker_audit_operation_missing");
  }
  const at = timestamp(options.now);
  for (const rawEvent of events) {
    const event = redactSensitiveValue({ at, ...rawEvent });
    if (
      typeof event.eventId !== "string" ||
      !event.eventId ||
      event.idempotencyKey !== event.eventId ||
      event.episodeId !== episode.id ||
      !WORKER_AUDIT_EVENT_TYPES.has(event.type)
    ) {
      throw outboxError(
        "Worker 审计事件身份或类型无效",
        "worker_audit_event_invalid"
      );
    }
    if (existingIds.has(event.eventId)) continue;
    outbox.push({
      schemaVersion: WORKER_AUDIT_OUTBOX_SCHEMA_VERSION,
      operationId,
      eventHash: integrityHash(event),
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      event
    });
    existingIds.add(event.eventId);
  }
  episode.system.workerAuditOutbox = outbox;
  return episode;
}

export async function deliverWorkerAuditOutbox(sourceEpisode, options = {}) {
  const appendEvent = options.appendEvent;
  const writeEpisode = options.writeEpisode;
  if (typeof appendEvent !== "function" || typeof writeEpisode !== "function") {
    throw outboxError(
      "Worker 审计 outbox 缺少持久化依赖",
      "worker_audit_delivery_dependency_missing"
    );
  }

  let episode = structuredClone(sourceEpisode);
  let outbox;
  try {
    outbox = workerAuditOutbox(episode);
    for (const marker of outbox) validateMarker(marker, episode.id);
  } catch (error) {
    return {
      episode,
      deliveredCount: 0,
      pendingCount: Array.isArray(episode?.system?.workerAuditOutbox)
        ? episode.system.workerAuditOutbox.length
        : 1,
      error,
      safeToContinue: false
    };
  }
  if (outbox.length === 0) {
    return {
      episode,
      deliveredCount: 0,
      pendingCount: 0,
      error: null,
      safeToContinue: true
    };
  }

  const deliveredIds = new Set();
  let deliveryError = null;
  const attemptAt = timestamp(options.now);
  for (const marker of outbox) {
    try {
      const receipt = await appendEvent(structuredClone(marker.event));
      if (options.requireReceipt === true && !eventReceiptMatches(receipt, marker.event)) {
        throw outboxError(
          "Worker 审计账本未返回与 outbox 精确匹配的幂等回执",
          "worker_audit_receipt_invalid"
        );
      }
      deliveredIds.add(marker.event.eventId);
    } catch (error) {
      marker.attempts = (marker.attempts ?? 0) + 1;
      marker.lastAttemptAt = attemptAt;
      marker.lastError = {
        code: typeof error?.code === "string" ? error.code : "worker_audit_delivery_failed",
        message: safeErrorMessage(error, "Worker 审计事件交付失败")
      };
      deliveryError = error;
      break;
    }
  }

  episode.system.workerAuditOutbox = outbox.filter(
    (marker) => !deliveredIds.has(marker.event.eventId)
  );
  episode.system.workerAuditDelivery = {
    status: episode.system.workerAuditOutbox.length === 0 ? "delivered" : "pending",
    checkedAt: attemptAt,
    pendingCount: episode.system.workerAuditOutbox.length,
    lastError: deliveryError
      ? {
          code: typeof deliveryError?.code === "string"
            ? deliveryError.code
            : "worker_audit_delivery_failed",
          message: safeErrorMessage(deliveryError, "Worker 审计事件交付失败")
        }
      : null
  };

  try {
    await writeEpisode(episode);
  } catch (error) {
    let latestEpisode = structuredClone(sourceEpisode);
    let refreshed = false;
    if (typeof options.readEpisode === "function") {
      try {
        const candidate = await options.readEpisode(sourceEpisode.id);
        if (candidate?.id === sourceEpisode.id) {
          latestEpisode = structuredClone(candidate);
          refreshed = true;
        }
      } catch {
        // The caller must not continue recovery from the stale snapshot below.
      }
    }
    const latestPendingCount = Array.isArray(latestEpisode?.system?.workerAuditOutbox)
      ? latestEpisode.system.workerAuditOutbox.length
      : outbox.length;
    return {
      episode: latestEpisode,
      deliveredCount: deliveredIds.size,
      pendingCount: latestPendingCount,
      error: outboxError(
        "Worker 审计回执已产生，但 Episode outbox 确认写入失败；后续必须按幂等键重放",
        "worker_audit_ack_persist_failed",
        error
      ),
      safeToContinue: refreshed
    };
  }

  return {
    episode,
    deliveredCount: deliveredIds.size,
    pendingCount: episode.system.workerAuditOutbox.length,
    error: deliveryError,
    safeToContinue: true
  };
}
