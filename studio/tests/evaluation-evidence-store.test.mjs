import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  appendEvaluationEvidence,
  createEvaluationAttestation,
  evaluationEvidenceInfrastructureStatus,
  readEvaluationEvidenceLedger,
  validateEvaluationAttestation,
  validateEvaluationEvidenceLedger
} from "../src/server/control/evaluation-evidence-store.mjs";
import {
  EVALUATION_VERDICT_RULE,
  INDEPENDENT_JUDGE_ID,
  INDEPENDENT_JUDGE_VERSION,
  contentHash,
  readEvaluationSuiteConfig,
  runFormalEvaluationCase
} from "../src/server/control/evaluation-suite.mjs";
import { validateMainAgentPlan } from "../src/shared/agent-contracts.mjs";

function failedEvidenceAfter(passedEvidence, definition) {
  const actualAction = {
    ...passedEvidence.actualAction,
    action: passedEvidence.actualAction.action === "stop" ? "noop" : "stop"
  };
  const contract = validateMainAgentPlan(actualAction);
  const checks = [
    { id: "actual-action-object", passed: true },
    {
      id: "closed-main-agent-plan-contract",
      passed: contract.valid,
      errors: contract.errors
    },
    ...Object.entries(definition.expectedBehavior.requiredFields).map(
    ([field, expected]) => ({
      id: `required-field:${field}`,
      passed: contentHash(actualAction[field]) === contentHash(expected)
    })
    )
  ];
  checks.push({
    id: "forbidden-action",
    passed: !definition.expectedBehavior.forbiddenActions.includes(actualAction.action)
  });
  const judge = {
    judgeId: INDEPENDENT_JUDGE_ID,
    judgeVersion: INDEPENDENT_JUDGE_VERSION,
    rubricId: definition.expectedBehavior.rubricId,
    rubricVersion: definition.expectedBehavior.rubricVersion,
    checks,
    passed: checks.every((check) => check.passed)
  };
  const completedAt = new Date(Date.parse(passedEvidence.completedAt) + 60_000).toISOString();
  const runId = `${passedEvidence.runId}-later-fail`;
  const { evidenceHash: _previousHash, ...payload } = passedEvidence;
  const failed = {
    ...payload,
    id: `eval-${passedEvidence.caseId}-${runId}`,
    runId,
    executionId:
      `${passedEvidence.suiteId}:${passedEvidence.suiteVersion}:${passedEvidence.caseId}:${runId}`,
    actualAction,
    actualActionHash: contentHash(actualAction),
    judge,
    judgeHash: contentHash(judge),
    verdictRule: EVALUATION_VERDICT_RULE,
    passed: false,
    completedAt
  };
  return { ...failed, evidenceHash: contentHash(failed) };
}

test("Ed25519 attestation 与 append-only hash chain 拒绝伪造、篡改和同 ID 换证据", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "evaluation-ledger-"));
  const ledgerPath = resolve(directory, "ledger.json");
  try {
    const suite = await readEvaluationSuiteConfig();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const trustedKeys = new Map([["local-release-runner", publicKey]]);
    const firstEvidence = await runFormalEvaluationCase({
      caseId: suite.cases[0].caseId,
      runId: "attested-case-1"
    }, suite);
    const firstEnvelope = createEvaluationAttestation(firstEvidence, {
      privateKey,
      keyId: "local-release-runner",
      runnerInstanceId: "ci-isolated-runner-1",
      now: new Date("2026-08-25T00:00:00.000Z")
    });
    assert.equal(validateEvaluationAttestation(firstEnvelope, {
      suite,
      trustedKeys,
      nowMs: Date.parse("2026-08-25T00:00:00.000Z")
    }).valid, true);

    const appended = await appendEvaluationEvidence(ledgerPath, firstEnvelope, {
      suite,
      trustedKeys,
      now: new Date("2026-08-25T00:00:01.000Z"),
      nowMs: Date.parse("2026-08-25T00:00:01.000Z")
    });
    assert.equal(appended.duplicate, false);
    const duplicate = await appendEvaluationEvidence(ledgerPath, firstEnvelope, {
      suite,
      trustedKeys,
      now: new Date("2026-08-25T00:00:02.000Z"),
      nowMs: Date.parse("2026-08-25T00:00:02.000Z")
    });
    assert.equal(duplicate.duplicate, true);

    const ledger = await readEvaluationEvidenceLedger(ledgerPath, {
      suite,
      trustedKeys,
      nowMs: Date.parse("2026-08-25T00:00:03.000Z")
    });
    assert.equal(ledger.records.length, 1);
    assert.equal(validateEvaluationEvidenceLedger(ledger, {
      suite,
      trustedKeys,
      nowMs: Date.parse("2026-08-25T00:00:03.000Z")
    }).valid, true);

    const untrusted = validateEvaluationAttestation(firstEnvelope, {
      suite,
      trustedKeys: new Map(),
      nowMs: Date.parse("2026-08-25T00:00:03.000Z")
    });
    assert.equal(untrusted.valid, false);
    assert.ok(untrusted.errors.includes("evaluation attestation signer is not trusted"));

    const tampered = JSON.parse(await readFile(ledgerPath, "utf8"));
    tampered.records[0].envelope.evidence.passed = false;
    await writeFile(ledgerPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    await assert.rejects(
      readEvaluationEvidenceLedger(ledgerPath, {
        suite,
        trustedKeys,
        nowMs: Date.parse("2026-08-25T00:00:03.000Z")
      }),
      (error) => error.code === "evaluation_evidence_ledger_invalid"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("全部固定案例即使有可信签名也不会自动解锁 assisted/active", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "evaluation-ledger-full-"));
  const ledgerPath = resolve(directory, "ledger.json");
  try {
    const suite = await readEvaluationSuiteConfig();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const trustedKeys = { "local-release-runner": publicKey };
    let firstEvidence = null;
    for (const [index, definition] of suite.cases.entries()) {
      const evidence = await runFormalEvaluationCase({
        caseId: definition.caseId,
        runId: `attested-full-${index + 1}`
      }, suite);
      if (index === 0) firstEvidence = evidence;
      const envelope = createEvaluationAttestation(evidence, {
        privateKey,
        keyId: "local-release-runner",
        runnerInstanceId: "ci-isolated-runner-full",
        now: new Date(`2026-08-25T00:01:${String(index).padStart(2, "0")}.000Z`)
      });
      await appendEvaluationEvidence(ledgerPath, envelope, {
        suite,
        trustedKeys,
        now: new Date(`2026-08-25T00:02:${String(index).padStart(2, "0")}.000Z`),
        nowMs: Date.parse("2026-08-25T00:10:00.000Z")
      });
    }
    const ledger = await readEvaluationEvidenceLedger(ledgerPath, {
      suite,
      trustedKeys,
      nowMs: Date.parse("2026-08-25T00:10:00.000Z")
    });
    const status = evaluationEvidenceInfrastructureStatus(ledger, {
      suite,
      trustedKeys,
      nowMs: Date.parse("2026-08-25T00:10:00.000Z")
    });
    assert.equal(status.ledgerValid, true);
    assert.equal(status.allRequiredCasesAttested, true);
    assert.equal(status.referenceEvidenceReady, true);
    assert.equal(status.infrastructureReady, false);
    assert.match(status.infrastructureBlockReason, /离线参考逻辑/u);
    assert.equal(status.releaseAdmissionEligible, false);
    assert.match(status.releaseBlockReason, /真实 shadow/u);

    const laterFailure = failedEvidenceAfter(firstEvidence, suite.cases[0]);
    const laterFailureEnvelope = createEvaluationAttestation(laterFailure, {
      privateKey,
      keyId: "local-release-runner",
      runnerInstanceId: "ci-isolated-runner-full",
      now: new Date(Date.parse(laterFailure.completedAt) + 1_000)
    });
    await appendEvaluationEvidence(ledgerPath, laterFailureEnvelope, {
      suite,
      trustedKeys,
      now: new Date(Date.parse(laterFailure.completedAt) + 2_000),
      nowMs: Date.parse(laterFailure.completedAt) + 3_000
    });
    const ledgerAfterFailure = await readEvaluationEvidenceLedger(ledgerPath, {
      suite,
      trustedKeys,
      nowMs: Date.parse(laterFailure.completedAt) + 4_000
    });
    const statusAfterFailure = evaluationEvidenceInfrastructureStatus(ledgerAfterFailure, {
      suite,
      trustedKeys,
      nowMs: Date.parse(laterFailure.completedAt) + 4_000
    });
    assert.equal(statusAfterFailure.allRequiredCasesAttested, false);
    assert.equal(statusAfterFailure.referenceEvidenceReady, false);
    assert.equal(statusAfterFailure.trustedAttestationCount, suite.cases.length - 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
