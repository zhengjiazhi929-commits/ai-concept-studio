import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLocalStoryboardPreview,
  validateLocalStoryboardRequest,
  localStoryboardCapabilitySpec
} from "../src/shared/local-storyboard-import-request.mjs";
import { parseLocalStoryboardArguments } from "../scripts/import-local-storyboard.mjs";

const preview = { episodeId: "synthetic-board", candidatePath: "outputs/synthetic/board.json" };
const request = { ...preview, candidateSha256: "a".repeat(64), snapshotHash: "b".repeat(64),
  actor: "human:fixture", reason: "Explicit synthetic import", confirmLocalStoryboardImport: true };

test("preview is read-only by default and complete execution request gets a zero-cost unique grant", () => {
  assert.deepEqual(validateLocalStoryboardPreview(preview), preview);
  assert.deepEqual(validateLocalStoryboardRequest(request), request);
  const spec = localStoryboardCapabilitySpec(request);
  assert.match(spec.episodeId, /^local-storyboard\/[a-f0-9]{64}$/u);
  assert.equal(spec.operation, "storyboard:import-local");
  assert.deepEqual(spec.scopes, ["state.write", "filesystem.write"]);
  assert.equal(spec.maxCalls, 0); assert.equal(spec.maxCostUsd, 0);
  assert.notEqual(spec.episodeId, localStoryboardCapabilitySpec({ ...request, actor: "human:other" }).episodeId);
  assert.equal(parseLocalStoryboardArguments(["--episode", preview.episodeId, "--candidate", preview.candidatePath]).mode, "preview");
});

test("request rejects traversal, unknown fields, incomplete confirmation, prototype and accessor inputs", () => {
  for (const candidatePath of ["/tmp/x.json", "outputs/../x.json", "outputs//x.json", "outputs/x.json?x", "outputs/a\\x.json", "outputs/ x.json"]) {
    assert.throws(() => validateLocalStoryboardPreview({ ...preview, candidatePath }));
  }
  assert.throws(() => validateLocalStoryboardRequest({ ...request, confirmLocalStoryboardImport: false }));
  assert.throws(() => validateLocalStoryboardRequest({ ...request, model: "forbidden" }));
  assert.throws(() => validateLocalStoryboardRequest(Object.create(request)));
  let calls = 0;
  const accessor = { ...request };
  Object.defineProperty(accessor, "actor", { enumerable: true, get() { calls++; return "human:fixture"; } });
  assert.throws(() => validateLocalStoryboardRequest(accessor));
  assert.equal(calls, 0);
});

test("CLI rejects partial execution and duplicate or unsupported switches", () => {
  const args = ["--episode", preview.episodeId, "--candidate", preview.candidatePath];
  for (const tail of [["--actor", request.actor], ["--confirm-local-storyboard-import"], ["--model", "any"], ["--episode", "other"]]) {
    assert.throws(() => parseLocalStoryboardArguments([...args, ...tail]));
  }
  const parsed = parseLocalStoryboardArguments([...args, "--candidate-sha256", request.candidateSha256,
    "--snapshot", request.snapshotHash, "--actor", request.actor, "--reason", request.reason, "--confirm-local-storyboard-import"]);
  assert.equal(parsed.mode, "import"); assert.deepEqual(parsed.request, request);
});
