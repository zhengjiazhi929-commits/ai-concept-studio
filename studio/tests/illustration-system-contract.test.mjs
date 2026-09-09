import test from "node:test";
import assert from "node:assert/strict";
import {
  ILLUSTRATION_SYSTEM_CONTRACT_VERSION,
  createIllustrationProofCandidate,
  defineIllustrationSequence,
  hashIllustrationValue,
  validateIllustrationSequence,
  verifyIllustrationProofCandidate
} from "../src/shared/illustration-system-contract.mjs";

function sequence() {
  return {
    id: "context-loading", version: 1, title: "按需装载",
    explanationGoal: "展示只有选中的资料进入有限上下文，其他资料留在外部。",
    claimIds: ["C-load"], durationInFrames: 300, fps: 30,
    objects: [
      { id: "source", kind: "document", label: "资料", claimIds: ["C-load"] },
      { id: "target", kind: "context", label: "上下文", claimIds: ["C-load"] }
    ],
    actions: [
      { id: "pick", kind: "select", objectIds: ["source"], claimIds: ["C-load"], fromFrame: 20, toFrame: 70 },
      { id: "load", kind: "transfer", objectIds: ["source", "target"], claimIds: ["C-load"], fromFrame: 70, toFrame: 220 }
    ],
    checkpoints: [
      { id: "loaded", frame: 220, objectIds: ["source", "target"], claimIds: ["C-load"], state: "selected-content-loaded" }
    ]
  };
}

function evidence() {
  return {
    definition: sequence(),
    sourceEvidence: [{ path: "src/illustrations.jsx", bytes: 100, sha256: "a".repeat(64) }],
    styleEvidence: [{ path: "styles/candidate.json", bytes: 200, sha256: "b".repeat(64) }],
    previewEvidence: [{ path: "proof/context-loading.mp4", bytes: 300, sha256: "c".repeat(64) }]
  };
}

function rejectsSequence(change, code) {
  const value = sequence();
  change(value);
  const review = validateIllustrationSequence(value);
  assert.equal(review.valid, false);
  assert.ok(review.issues.some((issue) => issue.code === code), JSON.stringify(review.issues));
  assert.throws(() => defineIllustrationSequence(value), { name: "IllustrationContractError" });
}

test("valid sequences are independent immutable candidates with explicit explanation claims", () => {
  const input = sequence();
  const result = defineIllustrationSequence(input);
  assert.equal(result.schemaVersion, ILLUSTRATION_SYSTEM_CONTRACT_VERSION);
  assert.equal(result.status, "candidate");
  assert.equal(result.productionApproved, false);
  assert.equal(result.userAccepted, false);
  assert.equal(result.finalAccepted, false);
  assert.equal(Object.isFrozen(result.actions[0].objectIds), true);
  input.actions[0].objectIds.push("changed-input");
  assert.deepEqual(result.actions[0].objectIds, ["source"]);
});

test("duplicate object or action IDs cannot alias scene objects or actions", () => {
  rejectsSequence((value) => value.objects.push({ ...value.objects[0] }), "duplicate-id");
  rejectsSequence((value) => value.actions[1].id = "pick", "duplicate-id");
});

test("explanation goals cannot be empty or only a generic short label", () => {
  rejectsSequence((value) => value.explanationGoal = "", "explanation-goal");
  rejectsSequence((value) => value.explanationGoal = "动起来", "explanation-goal");
});

test("sequence, object, action and checkpoint claims must bind known explanation claims", () => {
  rejectsSequence((value) => value.claimIds = [], "claim-binding");
  rejectsSequence((value) => value.objects[0].claimIds = [], "claim-binding");
  rejectsSequence((value) => value.actions[0].claimIds = ["invented"], "claim-binding");
  rejectsSequence((value) => value.checkpoints[0].claimIds = [], "claim-binding");
});

test("unsupported object and action kinds fail closed", () => {
  rejectsSequence((value) => value.objects[0].kind = "ornamental-robot", "object-kind");
  rejectsSequence((value) => value.actions[0].kind = "pulse-forever", "action-kind");
});

test("all action and checkpoint references must resolve to real objects", () => {
  rejectsSequence((value) => value.actions[0].objectIds = ["missing"], "object-reference");
  rejectsSequence((value) => value.checkpoints[0].objectIds = [], "object-reference");
});

test("action timing rejects missing, negative, inverted, fractional and out of bounds frames", () => {
  for (const [fromFrame, toFrame] of [[undefined, 60], [-1, 60], [70, 70], [80, 70], [0.5, 60], [10, 301]]) {
    rejectsSequence((value) => Object.assign(value.actions[0], { fromFrame, toFrame }), "action-timing");
  }
});

test("actions are ordered by start frame while parallel actions and reading holds remain legal", () => {
  rejectsSequence((value) => value.actions.reverse(), "action-order");
  const value = sequence();
  value.actions[1].fromFrame = 20;
  assert.equal(validateIllustrationSequence(value).valid, true);
});

test("duration and FPS must be positive finite integers", () => {
  rejectsSequence((value) => value.durationInFrames = 0, "sequence-timing");
  rejectsSequence((value) => value.fps = Number.NaN, "sequence-timing");
});

test("checkpoints must have unique IDs and ordered in-range frames", () => {
  rejectsSequence((value) => value.checkpoints[0].frame = 300, "checkpoint-timing");
  rejectsSequence((value) => value.checkpoints.push({ ...value.checkpoints[0] }), "duplicate-id");
  rejectsSequence((value) => value.checkpoints.push({ ...value.checkpoints[0], id: "earlier", frame: 0 }), "checkpoint-order");
});

test("non-JSON metadata and unsupported contract versions are rejected before freezing", () => {
  rejectsSequence((value) => value.objects[0].metadata = { callback: () => true }, "non-json-value");
  rejectsSequence((value) => value.schemaVersion = "future-v999", "contract-version");
});

test("canonical SHA-256 binds values independent of object key insertion order", async () => {
  assert.equal(await hashIllustrationValue({ b: 2, a: 1 }), await hashIllustrationValue({ a: 1, b: 2 }));
  assert.notEqual(await hashIllustrationValue({ a: 1 }), await hashIllustrationValue({ a: 2 }));
  assert.match(await hashIllustrationValue({ a: 1 }), /^[a-f0-9]{64}$/u);
});

test("sparse arrays or hidden named array data cannot disappear from a canonical evidence hash", async () => {
  await assert.rejects(hashIllustrationValue(new Array(2)), { name: "IllustrationContractError" });
  const values = ["visible"];
  values.hidden = "unhashed-data";
  await assert.rejects(hashIllustrationValue(values), { name: "IllustrationContractError" });
});

test("proof evidence binds definition, source, style and actual preview fingerprints immutably", async () => {
  const input = evidence();
  const candidate = await createIllustrationProofCandidate(input);
  assert.deepEqual(Object.keys(candidate.bindings).sort(), ["definitionSha256", "previewSha256", "sourceSha256", "styleSha256"]);
  assert.equal(Object.isFrozen(candidate.previewEvidence[0]), true);
  input.previewEvidence[0].sha256 = "d".repeat(64);
  assert.equal(candidate.previewEvidence[0].sha256, "c".repeat(64));
  const result = await verifyIllustrationProofCandidate(candidate, evidence());
  assert.equal(result.valid, true);
  assert.equal(result.productionApproved, false);
  assert.equal(result.userAccepted, false);
  assert.equal(result.finalAccepted, false);
});

test("candidate evidence requires every evidence category and complete SHA-256 fingerprints", async () => {
  for (const field of ["sourceEvidence", "styleEvidence", "previewEvidence"]) {
    const input = evidence();
    input[field] = [];
    await assert.rejects(createIllustrationProofCandidate(input), { name: "IllustrationContractError" });
  }
  for (const fingerprint of [{ bytes: 0 }, { sha256: "short-hash" }, { path: "" }]) {
    const input = evidence();
    Object.assign(input.previewEvidence[0], fingerprint);
    await assert.rejects(createIllustrationProofCandidate(input), { name: "IllustrationContractError" });
  }
});

test("tampering with any recorded artifact invalidates its candidate hash", async () => {
  const candidate = structuredClone(await createIllustrationProofCandidate(evidence()));
  candidate.previewEvidence[0].bytes += 1;
  const result = await verifyIllustrationProofCandidate(candidate, evidence());
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "candidate-tampered"));
});

test("changed current definition, source, style or preview makes the old evidence stale", async () => {
  const candidate = await createIllustrationProofCandidate(evidence());
  for (const field of ["definition", "sourceEvidence", "styleEvidence", "previewEvidence"]) {
    const current = evidence();
    if (field === "definition") current.definition.actions[0].toFrame = 69;
    else current[field][0].sha256 = "d".repeat(64);
    const result = await verifyIllustrationProofCandidate(candidate, current);
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.code === "evidence-stale"));
  }
});

test("self-supplied approval flags or approval records cannot authorize production", async () => {
  rejectsSequence((value) => value.productionApproved = true, "candidate-only");
  const input = evidence();
  input.humanApproval = { decision: "approved", candidateHash: "a".repeat(64) };
  await assert.rejects(createIllustrationProofCandidate(input), { name: "IllustrationContractError" });
  const forged = structuredClone(await createIllustrationProofCandidate(evidence()));
  forged.status = "approved";
  forged.productionApproved = true;
  assert.equal((await verifyIllustrationProofCandidate(forged, evidence())).valid, false);
});

test("old approval data cannot be attached to a new candidate or bypass current evidence", async () => {
  const candidate = structuredClone(await createIllustrationProofCandidate(evidence()));
  candidate.humanApproval = { decision: "approved", candidateHash: candidate.candidateHash };
  const current = evidence();
  current.styleEvidence[0].sha256 = "f".repeat(64);
  const result = await verifyIllustrationProofCandidate(candidate, current);
  assert.equal(result.valid, false);
  assert.equal(result.productionApproved, false);
});

test("verification cannot pass without explicitly supplied current observations", async () => {
  const candidate = await createIllustrationProofCandidate(evidence());
  assert.equal((await verifyIllustrationProofCandidate(candidate)).valid, false);
});
