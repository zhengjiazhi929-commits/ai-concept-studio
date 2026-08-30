import assert from "node:assert/strict";
import test from "node:test";

import { runRemediationRollbackRehearsal } from
  "../scripts/rehearse-remediation-rollback.mjs";

test("R3 rollback rehearsal completes all recovery cases without live data", async () => {
  const report = await runRemediationRollbackRehearsal();
  assert.equal(report.summary.passed, true);
  assert.equal(report.summary.passedCount, 7);
  assert.equal(report.summary.failedCount, 0);
  assert.equal(report.environment.externalCalls, 0);
  assert.equal(report.environment.liveEpisodeWrites, 0);
});
