import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { integrityHash } from "./integrity.mjs";
import { redactSensitiveValue } from "./redaction.mjs";
import { writeVersionedJson } from "./versioned-json-store.mjs";

function recordPayload(record) {
  const { hash, ...payload } = record;
  return payload;
}

export function appendAuditRecord(sourceLedger, event, options = {}) {
  const ledger = {
    stateVersion: Number.isInteger(sourceLedger?.stateVersion) ? sourceLedger.stateVersion : 0,
    records: Array.isArray(sourceLedger?.records) ? structuredClone(sourceLedger.records) : []
  };
  const safeEvent = redactSensitiveValue(event);
  if (safeEvent.idempotencyKey) {
    const existing = ledger.records.find((item) => item.idempotencyKey === safeEvent.idempotencyKey);
    if (existing) return { ledger, record: existing, duplicate: true };
  }
  const previous = ledger.records.at(-1) ?? null;
  const record = {
    ...safeEvent,
    sequence: (previous?.sequence ?? 0) + 1,
    eventId: safeEvent.eventId ?? randomUUID(),
    idempotencyKey: safeEvent.idempotencyKey ?? null,
    at: safeEvent.at ?? new Date().toISOString(),
    actor: safeEvent.actor ?? "system",
    previousHash: previous?.hash ?? null
  };
  delete record.hash;
  record.hash = integrityHash(record);
  ledger.records.push(record);
  return { ledger, record, duplicate: false };
}

export function validateAuditLedger(ledger) {
  const errors = [];
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    return { valid: false, errors: ["audit ledger must be an object"] };
  }
  if (!Array.isArray(ledger.records)) {
    return { valid: false, errors: ["audit records must be an array"] };
  }
  let previousHash = null;
  let sequence = 1;
  for (const record of ledger.records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      errors.push(`audit record must be an object at ${sequence}`);
      sequence += 1;
      continue;
    }
    if (record.sequence !== sequence) errors.push(`audit sequence mismatch at ${sequence}`);
    if (record.previousHash !== previousHash) errors.push(`audit previous hash mismatch at ${sequence}`);
    if (record.hash !== integrityHash(recordPayload(record))) errors.push(`audit hash mismatch at ${sequence}`);
    previousHash = record.hash;
    sequence += 1;
  }
  return { valid: errors.length === 0, errors };
}

async function readLedger(path) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { stateVersion: 0, records: [] };
    throw error;
  }
  let ledger;
  try {
    ledger = JSON.parse(content);
  } catch (cause) {
    const error = new Error("Audit ledger is malformed or truncated", { cause });
    error.code = "audit_integrity_invalid";
    throw error;
  }
  const validation = validateAuditLedger(ledger);
  if (!validation.valid) {
    const error = new Error(`Audit ledger integrity check failed: ${validation.errors.join("; ")}`);
    error.code = "audit_integrity_invalid";
    throw error;
  }
  return ledger;
}

export async function appendAuditEvent(path, event, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const source = await readLedger(path);
    const appended = appendAuditRecord(source, event, options);
    if (appended.duplicate) return appended.record;
    try {
      const written = await writeVersionedJson(path, appended.ledger, {
        expectedVersion: source.stateVersion ?? 0,
        getVersion: (value) => value?.stateVersion ?? 0,
        setVersion: (value, version) => {
          value.stateVersion = version;
        }
      });
      appended.record.ledgerVersion = written.version;
      return appended.record;
    } catch (error) {
      if (error?.code !== "state_version_conflict" || attempt === 2) throw error;
    }
  }
  throw new Error("审计事件写入失败");
}

export async function readAuditEvents(path, limit = 80) {
  const ledger = await readLedger(path);
  return ledger.records.slice(-limit).reverse();
}
