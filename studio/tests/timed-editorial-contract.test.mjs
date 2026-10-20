import test from "node:test";
import assert from "node:assert/strict";
import { compileTimedEditorialContent, inspectTimedEditorialEpisode }
  from "../src/server/production/timed-editorial-content.mjs";
import { storyboardGateScenes } from "../src/shared/workflow.mjs";
import { readPacedFixtureEpisode } from "./episode-fixture.mjs";
import { evaluateProductionQuality } from "../src/server/production/quality.mjs";
import { buildHumanApprovalView } from "../src/server/reviews/human-approval-view.mjs";
import { assertCurrentApprovalArtifactIntegrity } from "../src/server/reviews/approval-artifact-integrity.mjs";

test("timed kind without a closed executable contract never becomes ready", () => {
  for (const content of [null, {}, {executionPlan: {version: "editorial-execution-v1"}}]) {
    assert.throws(() => compileTimedEditorialContent(content));
    assert.equal(inspectTimedEditorialEpisode({production: {storyboardDraft: {
      storyboardKind: "timed-editorial-plan-v1", content
    }}}).valid, false);
  }
});

test("Gate 3 includes motion and narration provenance, not only legacy visualPlan", () => {
  const original = {id: "synthetic", start: 0, end: 15, type: "statement", title: "Synthetic",
    motionPlan: {version: "editorial-motion-v1", events: []}, startFrame: 0, endFrame: 450,
    narration: "Synthetic narration", unitIds: ["S1:p1"], sourceShotIds: ["B1"], evidenceRefs: ["c1"]};
  const stable = storyboardGateScenes([original])[0];
  for (const field of ["motionPlan", "startFrame", "endFrame", "narration", "unitIds", "sourceShotIds", "evidenceRefs"]) {
    assert.deepEqual(stable[field], original[field], field);
  }
});

test("motion render data cannot hide behind a legacy draft to bypass its strict contract", async () => {
  const episode = await readPacedFixtureEpisode();
  episode.scenes[0].motionPlan = {version: "not-implemented", objects: [], events: []};
  const check = evaluateProductionQuality(episode, {stage: "storyboard"}).checks
    .find(item => item.id === "editorial-execution-contract");
  assert.equal(check?.passed, false);
  assert.equal(evaluateProductionQuality(episode, {stage: "storyboard"}).checks
    .find(item => item.id === "visual-expression-contract")?.passed, false);
  assert.equal(buildHumanApprovalView(episode, "storyboard").status.readyForHumanApproval, false);
  await assert.rejects(assertCurrentApprovalArtifactIntegrity(episode, "storyboard"),
    {code: "storyboard_approval_execution_mismatch"});
});
