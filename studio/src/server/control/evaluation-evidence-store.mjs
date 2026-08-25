import { sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";

import { integrityHash } from "../../shared/integrity.mjs";
import { writeVersionedJson } from "../../shared/versioned-json-store.mjs";
import { validateEvaluationEvidence } from "./evaluation-suite.mjs";

export const EVALUATION_ATTESTATION_SCHEMA = "evaluation-ed25519-attestation-v1";
export const EVALUATION_EVIDENCE_LEDGER_SCHEMA = "evaluation-evidence-ledger-v1";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function attestationPayload(attestation) {
  return {
    schema: attestation.schema,
    keyId: attestation.keyId,
    runnerInstanceId: attestation.runnerInstanceId,
    evidenceHash: attestation.evidenceHash,
    issuedAt: attestation.issuedAt
  };
}

function attestationMessage(attestation) {
  return Buffer.from(
    `${EVALUATION_ATTESTATION_SCHEMA}\n${integrityHash(attestationPayload(attestation))}`,
    "utf8"
  );
}

function ledgerRecordPayload(record) {
  const { chainHash, ...payload } = record;
  return payload;
}

function trustedPublicKey(trustedKeys, keyId) {
  if (trustedKeys instanceof Map) return trustedKeys.get(keyId) ?? null;
  if (isRecord(trustedKeys)) return trustedKeys[keyId] ?? null;
  return null;
}

function ledgerError(errors) {
  const error = new Error(`评测证据账本无效：${errors.join("；")}`);
  error.code = "evaluation_evidence_ledger_invalid";
  error.statusCode = 409;
  error.errors = errors;
  return error;
}

export function createEvaluationAttestation(evidence, options = {}) {
  if (!isRecord(evidence) || !/^[a-f0-9]{64}$/u.test(String(evidence.evidenceHash ?? ""))) {
    throw new Error("签名评测证据必须包含有效 evidenceHash");
  }
  if (!options.privateKey) throw new Error("缺少评测 Runner 私钥");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/u.test(String(options.keyId ?? ""))) {
    throw new Error("评测 Runner keyId 无效");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(String(options.runnerInstanceId ?? ""))) {
    throw new Error("评测 Runner instance ID 无效");
  }
  const issuedAt = (options.now instanceof Date
    ? options.now
    : new Date(options.now ?? Date.now())).toISOString();
  const attestation = {
    schema: EVALUATION_ATTESTATION_SCHEMA,
    keyId: options.keyId,
    runnerInstanceId: options.runnerInstanceId,
    evidenceHash: evidence.evidenceHash,
    issuedAt
  };
  return {
    evidence: structuredClone(evidence),
    attestation: {
      ...attestation,
      signature: sign(null, attestationMessage(attestation), options.privateKey).toString("base64")
    }
  };
}

export function validateEvaluationAttestation(envelope, options = {}) {
  const errors = [];
  if (!isRecord(envelope) || !isRecord(envelope.evidence) || !isRecord(envelope.attestation)) {
    return { valid: false, errors: ["evaluation attestation envelope is invalid"] };
  }
  const { evidence, attestation } = envelope;
  if (attestation.schema !== EVALUATION_ATTESTATION_SCHEMA) {
    errors.push("evaluation attestation schema mismatch");
  }
  if (attestation.evidenceHash !== evidence.evidenceHash) {
    errors.push("evaluation attestation evidence hash mismatch");
  }
  const issuedAtMs = Date.parse(attestation.issuedAt);
  if (!Number.isFinite(issuedAtMs)) {
    errors.push("evaluation attestation issuedAt is invalid");
  } else if (issuedAtMs > (options.nowMs ?? Date.now()) + 5 * 60_000) {
    errors.push("evaluation attestation issuedAt is in the future");
  }
  const publicKey = trustedPublicKey(options.trustedKeys, attestation.keyId);
  if (!publicKey) {
    errors.push("evaluation attestation signer is not trusted");
  } else {
    let signature = null;
    try {
      signature = Buffer.from(String(attestation.signature ?? ""), "base64");
    } catch {
      signature = null;
    }
    if (
      !signature?.length
      || !verify(null, attestationMessage(attestation), publicKey, signature)
    ) {
      errors.push("evaluation attestation signature is invalid");
    }
  }
  const evidenceValidation = options.suite
    ? validateEvaluationEvidence(evidence, options.suite)
    : { valid: true, errors: [] };
  if (!evidenceValidation.valid) {
    errors.push(...evidenceValidation.errors.map((item) => `attested ${item}`));
  }
  return { valid: errors.length === 0, errors };
}

export function validateEvaluationEvidenceLedger(ledger, options = {}) {
  const errors = [];
  if (!isRecord(ledger) || ledger.schema !== EVALUATION_EVIDENCE_LEDGER_SCHEMA) {
    return { valid: false, errors: ["evaluation evidence ledger schema mismatch"] };
  }
  if (!Number.isInteger(ledger.stateVersion) || ledger.stateVersion < 0) {
    errors.push("evaluation evidence ledger stateVersion is invalid");
  }
  if (!Array.isArray(ledger.records)) {
    errors.push("evaluation evidence ledger records are invalid");
    return { valid: false, errors };
  }
  let previousHash = null;
  const ids = new Set();
  for (const [index, record] of ledger.records.entries()) {
    const sequence = index + 1;
    if (!isRecord(record)) {
      errors.push(`evaluation ledger record ${sequence} is invalid`);
      continue;
    }
    if (record.sequence !== sequence) {
      errors.push(`evaluation ledger sequence mismatch at ${sequence}`);
    }
    if (record.previousHash !== previousHash) {
      errors.push(`evaluation ledger previous hash mismatch at ${sequence}`);
    }
    if (record.chainHash !== integrityHash(ledgerRecordPayload(record))) {
      errors.push(`evaluation ledger chain hash mismatch at ${sequence}`);
    }
    const evidenceId = record.envelope?.evidence?.id;
    if (typeof evidenceId !== "string" || !evidenceId) {
      errors.push(`evaluation ledger evidence id missing at ${sequence}`);
    } else if (ids.has(evidenceId)) {
      errors.push(`evaluation ledger duplicate evidence id at ${sequence}`);
    } else {
      ids.add(evidenceId);
    }
    const attestation = validateEvaluationAttestation(record.envelope, options);
    errors.push(...attestation.errors.map((item) => `record ${sequence}: ${item}`));
    previousHash = record.chainHash;
  }
  return { valid: errors.length === 0, errors };
}

async function readLedger(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        schema: EVALUATION_EVIDENCE_LEDGER_SCHEMA,
        stateVersion: 0,
        records: []
      };
    }
    throw error;
  }
}

export async function readEvaluationEvidenceLedger(path, options = {}) {
  const ledger = await readLedger(path);
  const validation = validateEvaluationEvidenceLedger(ledger, options);
  if (!validation.valid) throw ledgerError(validation.errors);
  return ledger;
}

export async function appendEvaluationEvidence(path, envelope, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ledger = await readEvaluationEvidenceLedger(path, options);
    const validation = validateEvaluationAttestation(envelope, options);
    if (!validation.valid) throw ledgerError(validation.errors);
    const sameId = ledger.records.find(
      (record) => record.envelope?.evidence?.id === envelope.evidence.id
    );
    if (sameId) {
      if (sameId.envelope.evidence.evidenceHash === envelope.evidence.evidenceHash) {
        return { record: structuredClone(sameId), duplicate: true };
      }
      throw ledgerError(["evaluation evidence id already exists with a different hash"]);
    }
    const previous = ledger.records.at(-1) ?? null;
    const record = {
      sequence: ledger.records.length + 1,
      previousHash: previous?.chainHash ?? null,
      appendedAt: (options.now instanceof Date
        ? options.now
        : new Date(options.now ?? Date.now())).toISOString(),
      envelope: structuredClone(envelope)
    };
    record.chainHash = integrityHash(record);
    const next = structuredClone(ledger);
    next.records.push(record);
    try {
      const written = await writeVersionedJson(path, next, {
        expectedVersion: ledger.stateVersion,
        getVersion: (value) => value?.stateVersion ?? 0,
        setVersion: (value, version) => {
          value.stateVersion = version;
        }
      });
      record.ledgerVersion = written.version;
      return { record, duplicate: false };
    } catch (error) {
      if (error?.code !== "state_version_conflict" || attempt === 2) throw error;
    }
  }
  throw new Error("评测证据写入失败");
}

export function evaluationEvidenceInfrastructureStatus(ledger, options = {}) {
  const validation = validateEvaluationEvidenceLedger(ledger, options);
  const records = validation.valid
    ? ledger.records.map((record) => ({
      evidence: record.envelope.evidence,
      sequence: record.sequence
    }))
    : [];
  const requiredCaseIds = new Set((options.suite?.cases ?? []).map((item) => item.caseId));
  const candidates = records.filter(({ evidence }) => (
    evidence.suiteId === options.suite?.id
    && evidence.suiteVersion === options.suite?.version
    && evidence.suiteHash === options.suite?.suiteHash
    && evidence.runtimeBindingHash === options.suite?.runtimeBindingHash
  ));
  const latestByCase = new Map();
  for (const candidate of candidates) {
    const previous = latestByCase.get(candidate.evidence.caseId);
    const completedAt = Date.parse(candidate.evidence.completedAt);
    const previousCompletedAt = Date.parse(previous?.evidence?.completedAt ?? "");
    if (
      !previous
      || completedAt > previousCompletedAt
      || (completedAt === previousCompletedAt && candidate.sequence > previous.sequence)
    ) {
      latestByCase.set(candidate.evidence.caseId, candidate);
    }
  }
  const currentPassing = [...latestByCase.values()].filter(
    ({ evidence }) => evidence.passed === true
  );
  const presentCaseIds = new Set(currentPassing.map(({ evidence }) => evidence.caseId));
  const allRequiredCasesAttested = requiredCaseIds.size > 0
    && [...requiredCaseIds].every((caseId) => presentCaseIds.has(caseId));
  return {
    ledgerValid: validation.valid,
    errors: validation.errors,
    evidenceClass: "offline-reference-only",
    trustedAttestationCount: currentPassing.length,
    currentCaseConclusionCount: latestByCase.size,
    requiredCaseCount: requiredCaseIds.size,
    allRequiredCasesAttested,
    referenceEvidenceReady: validation.valid && allRequiredCasesAttested,
    infrastructureReady: false,
    infrastructureBlockReason:
      "当前 Runner 只执行离线参考逻辑，没有运行真实 Main Agent、Workflow Kernel 与 Model Router shadow",
    releaseAdmissionEligible: false,
    releaseBlockReason:
      "签名与 append-only 只证明证据来源；仍需限额真实 shadow、独立语义/视觉复核和人工发布决定"
  };
}
