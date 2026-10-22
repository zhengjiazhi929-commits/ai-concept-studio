import test from "node:test";
import assert from "node:assert/strict";
import {validateWorkerMutation} from "../src/shared/agent-contracts.mjs";
import {editorialMaterializationRegistrationValid} from "../src/shared/editorial-materialization-contract.mjs";
import {canonicalJsonDocumentContentSha256 as digest} from "../src/shared/durable-json-store.mjs";
import {editorialMaterializationReceipt, editorialMaterializationAssetRecords} from "../src/server/production/editorial-materialization-integrity.mjs";

// Pure synthetic metadata produced by the real schema helpers. No Episode,
// production file, renderer, compiler or provider is accessed by this fixture.
function fixture(requestChanges = {}) {
  const h = "a".repeat(64); const id = "synthetic-editorial";
  const request = {episodeId: id, snapshotHash: "c".repeat(64), candidateHash: h,
    machineReviewId: "synthetic-review", implementationHash: h, actor: "human:synthetic",
    reason: "Create synthetic local materials only", confirmEditorialAssetsMaterialization: true, ...requestChanges};
  const e = {id, assets: [], production: {assetPlan: {version: 1, content: {
    kind: "editorial-code-asset-plan-v1", implementation: {sha256: h},
    items: ["S1", "S2"].map(scene => ({id: `editorial-${scene}`, required: true,
      productionMethod: {kind: "local-code-animation", executor: "EditorialMotionPreview"}}))}}},
    reviewCheckpoints: {assetExecution: {status: "approved", currentCandidate: {candidateHash: h},
      machineReview: {id: "synthetic-review", status: "passed", candidateHash: h},
      humanApproval: {decision: "approved", candidateHash: h, machineReviewId: "synthetic-review",
        actor: "human:synthetic", at: "2026-01-01T00:00:00.000Z"}}}};
  const manifest = {episodeId: id, operationId: digest(request), request,
    sourceAssetPlan: {version: 1, candidateHash: h, machineReviewId: "synthetic-review"},
    implementationSha256: h, renderer: {inputPropsSha256: h},
    files: [{path: "bundle/index.html", bytes: 30, sha256: h}]};
  const receipt = editorialMaterializationReceipt(manifest);
  const assets = editorialMaterializationAssetRecords(e, manifest, receipt);
  const result = {status: "complete", message: "本地包已制作，待声音与视觉检查",
    artifacts: [receipt.manifestPath], findings: [], patch: {assets, production: {editorialMaterialization: receipt}}};
  return {e, assets, asset: assets[0], receipt, result};
}
const valid = f => validateWorkerMutation(f.e, "asset-agent", f.result).valid;

test("real receipt and asset schema helpers satisfy the pure worker boundary without visual approval", () => {
  const f = fixture(); const result = validateWorkerMutation(f.e, "asset-agent", f.result);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(f.asset.verified, false);
  assert.equal(f.asset.visualAcceptance, false);
  assert.equal(f.asset.createdAt, f.e.reviewCheckpoints.assetExecution.humanApproval.at);
  f.e.assets = structuredClone(f.assets);
  f.e.production.editorialMaterialization = structuredClone(f.receipt);
  assert.equal(valid(f), true);
});

test("editorial registration rejects legacy disguise, missing items and false acceptance", () => {
  for (const change of [
    f => {delete f.result.patch.production.editorialMaterialization;},
    f => {f.asset.componentId = "AgentSkillShortExplainer";},
    f => {f.asset.verified = true;}, f => {f.asset.visualAcceptance = true;},
    f => {f.asset.externalApiCalls = 1;}, f => {f.asset.materialization.manifestSha256 = "d".repeat(64);},
    f => {f.receipt.bundlePath = "outside/bundle";},
    f => {f.assets.push(structuredClone(f.asset));}, f => {f.result.patch.assets = [];},
    f => {f.e.production.assetPlan.content.kind = "legacy";},
    f => {f.e.reviewCheckpoints.assetExecution.status = "waiting_approval";},
    f => {f.receipt.rendered = true;}, f => {f.receipt.voiceStatus = "ready";}
  ]) {const f = fixture(); change(f); assert.equal(valid(f), false);}
});

test("receipt request is closed, explicit and bound to its canonical operation digest", () => {
  for (const change of [
    f => {f.receipt.request = {episodeId: f.e.id};},
    f => {f.receipt.request.reason = "A different request without a new operation";},
    f => {f.receipt.request.confirmEditorialAssetsMaterialization = false;},
    f => {f.receipt.request.actor = "agent:synthetic";},
    f => {f.receipt.request.provider = "unexpected";},
    f => {delete f.receipt.request.snapshotHash;}
  ]) {const f = fixture(); change(f); assert.equal(valid(f), false);}
  for (const change of [{episodeId: "different-synthetic"}, {candidateHash: "d".repeat(64)},
    {machineReviewId: "different-review"}, {implementationHash: "e".repeat(64)}]) {
    assert.equal(valid(fixture(change)), false);
  }
});

test("receipt keyset does not accept deleted fields or invented verification/provider metadata", () => {
  for (const key of ["verified", "visualAcceptance", "provider", "unexpected"]) {
    const f = fixture(); f.receipt[key] = true; assert.equal(valid(f), false, key);
  }
  for (const key of Object.keys(fixture().receipt)) {
    const f = fixture(); delete f.receipt[key]; assert.equal(valid(f), false, key);
  }
});

test("all registered asset metadata is rebuilt from the receipt, approved time and fixed rights", () => {
  for (const change of [
    f => {f.asset.createdAt = "2026-02-01T00:00:00.000Z";},
    f => {f.asset.rights.acquiredAt = "2026-02-01T00:00:00.000Z";},
    f => {f.asset.rights.allowedUse = "public-release";},
    f => {f.asset.rights.license = "CC0";},
    f => {f.asset.rights.verifiedBy = "human:synthetic";},
    f => {f.asset.rights.sourceUrl = "https://invalid.example/";},
    f => {f.asset.rights.unexpected = "metadata";},
    f => {delete f.asset.rights.attributionRequirements;},
    f => {f.asset.unexpected = "metadata";},
    f => {delete f.asset.createdAt;}, f => {delete f.asset.rights;},
    f => {f.assets[1].bytes += 1;}, f => {f.assets[1].sha256 = "d".repeat(64);},
    f => {f.e.production.assetPlan.version = 0; f.receipt.assetPlanVersion = 0; f.assets.forEach(a => {a.assetPlanVersion = 0;});},
    f => {f.e.reviewCheckpoints.assetExecution.humanApproval.at = "not-a-time"; f.assets.forEach(a => {a.createdAt = "not-a-time"; a.rights.acquiredAt = "not-a-time";});}
  ]) {const f = fixture(); change(f); assert.equal(valid(f), false);}
});

test("untrusted receipt and asset record descriptors are rejected without executing getters", () => {
  const check = f => editorialMaterializationRegistrationValid(f.e, f.assets, f.receipt);
  for (const target of [f => f.receipt, f => f.receipt.request, f => f.asset,
    f => f.asset.materialization, f => f.asset.rights]) {
    const f = fixture(); const value = target(f); const key = Object.keys(value)[0];
    let reads = 0;
    Object.defineProperty(value, key, {enumerable: true, get() {reads++; return "unexpected";}});
    assert.equal(check(f), false); assert.equal(reads, 0);
  }
  for (const target of [f => f.receipt, f => f.asset, f => f.asset.rights]) {
    const f = fixture(); Object.defineProperty(target(f), "hidden", {value: true}); assert.equal(check(f), false);
    const symbolic = fixture(); target(symbolic)[Symbol("hidden")] = true; assert.equal(check(symbolic), false);
    const inherited = fixture(); Object.setPrototypeOf(target(inherited), {inherited: true}); assert.equal(check(inherited), false);
  }
});

test("an existing receipt cannot be replaced by pretending registered assets are absent", () => {
  const f = fixture();
  f.e.production.editorialMaterialization = {...f.receipt, manifestSha256: "f".repeat(64)};
  assert.equal(valid(f), false);
  f.e.production.editorialMaterialization = structuredClone(f.receipt);
  assert.equal(valid(f), false);
});
