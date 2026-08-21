import { integrityHash } from "../../shared/integrity.mjs";
import { readFile } from "node:fs/promises";
import { agentEvaluationSuiteConfigPath } from "../../shared/paths.mjs";
import { assertVersionedConfig } from "../../shared/config-integrity.mjs";

export const DEFAULT_EVALUATION_SUITE = Object.freeze({
  id: "main-agent-release-v1",
  version: "1.0.0",
  policyVersion: "routing-policy-v1",
  reviewVersion: "review-rubrics-v5",
  cases: [
    { caseId: "golden-next-step", scenarioType: "golden" },
    { caseId: "reject-illegal-action", scenarioType: "rejection" },
    { caseId: "respect-human-gate", scenarioType: "boundary" },
    { caseId: "respect-human-feedback", scenarioType: "human-feedback" },
    { caseId: "pause-on-budget", scenarioType: "budget" },
    { caseId: "recover-without-duplicate", scenarioType: "recovery" }
  ]
});

export const EVALUATION_VERDICT_RULE = "action-hash-match-v1";

export function contentHash(value) {
  return integrityHash(value);
}

export async function readEvaluationSuiteConfig(options = {}) {
  const config = options.config
    ?? JSON.parse(await readFile(agentEvaluationSuiteConfigPath, "utf8"));
  assertVersionedConfig("agent-evaluation-suite", config);
  if (!Array.isArray(config.requiredCases) || config.requiredCases.length === 0) {
    throw new Error("agent-evaluation-suite requiredCases are required");
  }
  return {
    id: config.id,
    version: config.version,
    policyVersion: config.policyVersion,
    reviewVersion: config.reviewVersion,
    cases: structuredClone(config.requiredCases)
  };
}

function evidencePayload(record) {
  const { evidenceHash, ...payload } = record;
  return payload;
}

export function createEvaluationEvidence(input, suite = DEFAULT_EVALUATION_SUITE) {
  const definition = suite.cases.find((item) => item.caseId === input.caseId);
  if (!definition) throw new Error(`未知正式评测案例：${input.caseId}`);
  const record = {
    id: input.id ?? `eval-${input.caseId}-${input.runId}`,
    source: "formal-evaluation-suite",
    suiteId: suite.id,
    suiteVersion: suite.version,
    caseId: input.caseId,
    scenarioType: definition.scenarioType,
    runId: input.runId,
    policyVersion: input.policyVersion ?? suite.policyVersion,
    reviewVersion: input.reviewVersion ?? suite.reviewVersion,
    contextHash: input.contextHash,
    expectedActionHash: input.expectedActionHash,
    actualActionHash: input.actualActionHash,
    verdictRule: EVALUATION_VERDICT_RULE,
    passed: input.expectedActionHash === input.actualActionHash,
    completedAt: input.completedAt ?? new Date().toISOString()
  };
  return { ...record, evidenceHash: contentHash(record) };
}

export function validateEvaluationEvidence(record, suite = DEFAULT_EVALUATION_SUITE) {
  const errors = [];
  const definition = suite.cases.find((item) => item.caseId === record?.caseId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { valid: false, errors: ["evaluation evidence must be an object"] };
  }
  if (record.source !== "formal-evaluation-suite") errors.push("evaluation source is not formal");
  if (record.suiteId !== suite.id || record.suiteVersion !== suite.version) {
    errors.push("evaluation suite version mismatch");
  }
  if (!definition || definition.scenarioType !== record.scenarioType) {
    errors.push("evaluation case or scenario type mismatch");
  }
  if (record.policyVersion !== suite.policyVersion) errors.push("evaluation policy version mismatch");
  if (record.reviewVersion !== suite.reviewVersion) errors.push("evaluation review version mismatch");
  if (record.verdictRule !== EVALUATION_VERDICT_RULE) {
    errors.push("evaluation verdict rule mismatch");
  }
  for (const field of ["contextHash", "expectedActionHash", "actualActionHash"]) {
    if (!/^[a-f0-9]{64}$/u.test(record[field] ?? "")) errors.push(`invalid evaluation ${field}`);
  }
  if (typeof record.runId !== "string" || !record.runId.trim()) errors.push("evaluation runId is required");
  if (typeof record.completedAt !== "string" || !Number.isFinite(Date.parse(record.completedAt))) {
    errors.push("evaluation completedAt is invalid");
  }
  if (record.passed !== (record.expectedActionHash === record.actualActionHash)) {
    errors.push("evaluation verdict does not match action evidence");
  }
  if (record.evidenceHash !== contentHash(evidencePayload(record))) {
    errors.push("evaluation evidence hash mismatch");
  }
  return { valid: errors.length === 0, errors };
}

export function summarizeReleaseEvaluations(records = [], suite = DEFAULT_EVALUATION_SUITE) {
  const latest = new Map();
  for (const record of records) {
    if (record?.suiteId !== suite.id || record?.suiteVersion !== suite.version) continue;
    const previous = latest.get(record.caseId);
    if (!previous || String(record.completedAt).localeCompare(String(previous.completedAt)) > 0) {
      latest.set(record.caseId, record);
    }
  }
  const cases = suite.cases.map((definition) => {
    const record = latest.get(definition.caseId) ?? null;
    const validation = record
      ? validateEvaluationEvidence(record, suite)
      : { valid: false, errors: ["missing evaluation evidence"] };
    return {
      ...definition,
      recordId: record?.id ?? null,
      passed: Boolean(record?.passed && validation.valid),
      errors: validation.errors
    };
  });
  return {
    suiteId: suite.id,
    suiteVersion: suite.version,
    total: cases.length,
    passedCases: cases.filter((item) => item.passed).length,
    cases,
    passed: cases.length > 0 && cases.every((item) => item.passed)
  };
}
