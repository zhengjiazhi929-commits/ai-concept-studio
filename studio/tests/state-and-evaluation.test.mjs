import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  StateConflictError,
  writeVersionedJson
} from "../src/shared/versioned-json-store.mjs";
import {
  contentHash,
  createEvaluationEvidence,
  DEFAULT_EVALUATION_SUITE,
  summarizeReleaseEvaluations,
  validateEvaluationEvidence
} from "../src/server/control/evaluation-suite.mjs";

test("跨进程状态写入使用版本比较，过期快照收到明确冲突", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-cas-"));
  const destination = join(directory, "episode.json");
  const options = {
    getVersion: (value) => value?.stateVersion ?? 0,
    setVersion: (value, version) => {
      value.stateVersion = version;
    }
  };
  try {
    const first = await writeVersionedJson(destination, { id: "case", stateVersion: 0 }, {
      ...options,
      expectedVersion: 0
    });
    assert.equal(first.version, 1);
    await assert.rejects(
      writeVersionedJson(destination, { id: "stale", stateVersion: 0 }, {
        ...options,
        expectedVersion: 0
      }),
      (error) => error instanceof StateConflictError && error.statusCode === 409
    );
    const persisted = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(persisted.id, "case");
    assert.equal(persisted.stateVersion, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("正式评测必须覆盖全部类别，且证据被修改后不再允许升级", () => {
  const records = DEFAULT_EVALUATION_SUITE.cases.map((definition, index) => createEvaluationEvidence({
    caseId: definition.caseId,
    runId: `release-${index}`,
    contextHash: contentHash({ case: definition.caseId }),
    expectedActionHash: contentHash({ expected: definition.caseId }),
    actualActionHash: contentHash({ expected: definition.caseId }),
    passed: true,
    completedAt: `2026-08-06T04:0${index}:00.000Z`
  }));
  assert.equal(summarizeReleaseEvaluations(records).passed, true);
  records[0].passed = false;
  const tampered = summarizeReleaseEvaluations(records);
  assert.equal(tampered.passed, false);
  assert.ok(tampered.cases[0].errors.includes("evaluation evidence hash mismatch"));
});

test("正式评测结论由预期与实际动作证据一致性推导，不能自报通过", () => {
  const evidence = createEvaluationEvidence({
    caseId: DEFAULT_EVALUATION_SUITE.cases[0].caseId,
    runId: "release-mismatch",
    contextHash: contentHash({ context: "same" }),
    expectedActionHash: contentHash({ action: "run-script" }),
    actualActionHash: contentHash({ action: "run-render" }),
    passed: true,
    completedAt: "2026-08-06T05:00:00.000Z"
  });
  assert.equal(evidence.passed, false);
  assert.equal(validateEvaluationEvidence(evidence).valid, true);

  const forged = { ...evidence, passed: true };
  forged.evidenceHash = contentHash((({ evidenceHash: _ignored, ...payload }) => payload)(forged));
  const validation = validateEvaluationEvidence(forged);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("evaluation verdict does not match action evidence"));
});
