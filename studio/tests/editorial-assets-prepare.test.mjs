import test from "node:test";
import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {approvedStoryboardFixture} from "./approved-storyboard-fixture.mjs";
import {seedEditorialImplementationFixture} from "./editorial-implementation-fixture.mjs";
import {createApprovedStoryboardCompletionService} from "../src/server/production/approved-storyboard-completion-core.mjs";
import {approvedStoryboardCompletionCapabilitySpec} from "../src/shared/approved-storyboard-completion-request.mjs";
import {createEditorialAssetsPrepareService} from "../src/server/production/editorial-assets-prepare-core.mjs";
import {editorialAssetsPrepareCapabilitySpec, validateEditorialAssetsPrepareRequest} from "../src/shared/editorial-assets-prepare-request.mjs";
import {createCapabilityAuthority} from "../src/server/security/side-effect-capability.mjs";
import {kernelSnapshot} from "../src/server/control/workflow-kernel.mjs";
import {canonicalJsonDocumentContentSha256 as digest} from "../src/shared/durable-json-store.mjs";
import {prepareEditorialAssetsStep} from "../src/server/control/editorial-assets-transition.mjs";
import {approveAssetExecutionCandidate} from "../src/server/reviews/asset-execution-checkpoint.mjs";
import {assertProductionExpiry, assertProductionAuditExpiry, assertProductionManifestExpiry, assertProductionNullAudit} from './production-capability-expiry-fixture.mjs';

for (const expireAt of [1, 2]) test(`asset preparation rejects authority expiring during load ${expireAt}`, async t => {
  await assertProductionExpiry(t, {setup, createService: createEditorialAssetsPrepareService,
    capabilitySpec: editorialAssetsPrepareCapabilitySpec, method: 'prepareEditorialAssets', expireAt});
});
test('asset preparation reports committed warning if authority expires after CAS, then repairs audit safely', async t => {
  await assertProductionAuditExpiry(t, {setup, createService: createEditorialAssetsPrepareService,
    capabilitySpec: editorialAssetsPrepareCapabilitySpec, method: 'prepareEditorialAssets'});
});
test('asset preparation rechecks expiry between the immutable artifact and manifest', async t => {
  await assertProductionManifestExpiry(t, {setup, capabilitySpec: editorialAssetsPrepareCapabilitySpec, method: 'prepareEditorialAssets',
    directory: 'editorial-assets', artifactName: 'asset-plan-v001.json', manifestName: 'prepare.json'});
});
test('asset preparation preserves committed status on null or undefined audit rejection', async t => {
  await assertProductionNullAudit(t, {setup, createService: createEditorialAssetsPrepareService,
    capabilitySpec: editorialAssetsPrepareCapabilitySpec, method: 'prepareEditorialAssets'});
});

const authority = () => createCapabilityAuthority({secret: "synthetic-editorial-assets-000000000000000000000"});
const grant = request => ({sideEffectGrant: authority().authorize(editorialAssetsPrepareCapabilitySpec(request))});
async function setup(t) {
  const f = await approvedStoryboardFixture(t);
  const completion = createApprovedStoryboardCompletionService(f.deps);
  const p = await completion.previewApprovedStoryboardCompletion({episodeId: f.episode.id});
  const r = {episodeId: f.episode.id, artifactVersion: p.sourceStoryboard.artifactVersion,
    artifactHash: p.sourceStoryboard.artifactHash, reviewReportId: p.sourceStoryboard.reviewReportId,
    snapshotHash: p.snapshotHash, actor: "human:synthetic", reason: "Complete synthetic approved storyboard",
    confirmApprovedStoryboardCompletion: true};
  await completion.completeApprovedStoryboard(r, {sideEffectGrant: authority().authorize(approvedStoryboardCompletionCapabilitySpec(r))});
  // A fresh synthetic production start, not the historical fixture's captures.
  const emptyAssets = await f.deps.readEpisode(); emptyAssets.assets = [];
  await f.deps.writeEpisode(emptyAssets);
  const implementationFixture = await seedEditorialImplementationFixture(f.root);
  const service = createEditorialAssetsPrepareService(f.deps);
  const preview = await service.previewEditorialAssetsPreparation({episodeId: f.episode.id});
  const request = {episodeId: f.episode.id, snapshotHash: preview.snapshotHash, planHash: preview.planHash,
    implementationHash: preview.implementationHash, actor: "human:synthetic", reason: "Prepare deterministic synthetic assets only",
    confirmEditorialAssetsPreparation: true};
  f.events.length = 0;
  return {...f, implementationFixture, service, preview, request};
}

test("editorial asset preview has no mutations and binds plan, resources and approved source", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8");
  const again = await f.service.previewEditorialAssetsPreparation({episodeId: f.episode.id});
  assert.equal(again.snapshotHash, f.preview.snapshotHash);
  assert.match(again.planHash, /^[a-f0-9]{64}$/u);
  assert.match(again.implementationHash, /^[a-f0-9]{64}$/u);
  assert.equal(again.sourceStoryboard.artifactVersion, 1);
  assert.equal(again.paidCalls, 0); assert.equal(again.estimatedCostUsd, 0);
  assert.equal(again.rendered, false); assert.equal(again.voiceStatus, "deferred");
  assert.equal(await readFile(f.episodePath, "utf8"), before);
  assert.equal(f.events.length, 0);
});

test("zero-call prepare writes immutable evidence then one CAS and stops at independent human checkpoint", async t => {
  const f = await setup(t); const before = await f.deps.readEpisode();
  const result = await f.service.prepareEditorialAssets(f.request, grant(f.request));
  assert.equal(result.status, "committed"); assert.equal(result.paidCalls, 0);
  const after = await f.deps.readEpisode();
  assert.equal(after.control.stateVersion, before.control.stateVersion + 1);
  for (const key of ["research", "sourceDocs", "scenes", "subtitles", "render", "voice", "assets", "reviews"]) assert.deepEqual(after[key], before[key], key);
  for (const gate of ["research", "script", "storyboard"]) assert.deepEqual(after.approvals[gate], before.approvals[gate]);
  for (const key of ["scriptDraft", "storyboardDraft", "ai"]) assert.deepEqual(after.production[key], before.production[key]);
  assert.deepEqual(after.control.budget, before.control.budget);
  assert.equal(after.reviewCheckpoints.assetExecution.status, "waiting_approval");
  assert.equal(after.reviewCheckpoints.assetExecution.humanApproval, null);
  assert.equal(after.pipeline.find(s => s.id === "assets").status, "blocked");
  assert.equal(after.pipeline.find(s => s.id === "assets").requiresHuman, true);
  assert.equal(after.pipeline.find(s => s.id === "voice").status, "pending");
  const actions = kernelSnapshot(after).legalActions;
  assert.equal(actions.some(a => a.action === "wait_for_checkpoint" && a.checkpointId === "assetExecution"), true);
  assert.equal(actions.some(a => a.action === "run_worker" && a.workerId === "asset-agent"), false);
  const artifact = JSON.parse(await readFile(resolve(f.root, result.artifactPath), "utf8"));
  assert.equal(artifact.episodeId, after.id); assert.equal(artifact.plan.executionPolicy.maximumPaidCostUsd, 0);
  const bytes = await readFile(f.episodePath, "utf8");
  assert.equal((await f.service.prepareEditorialAssets(f.request, grant(f.request))).status, "already_committed");
  assert.equal(await readFile(f.episodePath, "utf8"), bytes);
  assert.equal((await readdir(resolve(f.root, result.manifestPath, ".."))).length, 2);
  // A synthetic machine-negative result must be retained, never promoted to a
  // human-review-ready or execution-approved state by the transition helper.
  const blocked = structuredClone(after.reviewCheckpoints.assetExecution);
  blocked.status = "blocked"; blocked.machineReview.status = "blocked";
  blocked.machineReview.checks[0].passed = false;
  const negative = prepareEditorialAssetsStep(before, {entry: after.production.assetPlan.versions[0],
    plan: after.production.assetPlan.content, checkpoint: blocked, now: after.updatedAt});
  assert.equal(negative.reviewCheckpoints.assetExecution.status, "blocked");
  assert.equal(negative.pipeline.find(s => s.id === "assets").requiresHuman, false);
  assert.equal(negative.production.assetPlan.needsRevision, true);
  assert.deepEqual(negative.scenes, before.scenes);
  const cp = after.reviewCheckpoints.assetExecution;
  await approveAssetExecutionCandidate(after.id, {candidateHash: cp.currentCandidate.candidateHash,
    machineReviewId: cp.machineReview.id, note: "Synthetic-only independent human approval"},
  {...f.deps, workspaceRoot: f.root, reviewConfig: f.config, actor: "human:synthetic"});
  const approvedBytes = await readFile(f.episodePath, "utf8");
  const approvedPreview = await f.service.previewEditorialAssetsPreparation({episodeId: after.id});
  assert.equal(approvedPreview.humanApproved, true); assert.equal(approvedPreview.preparationState, "already_prepared");
  assert.equal((await f.service.prepareEditorialAssets(f.request, grant(f.request))).status, "already_committed");
  assert.equal(await readFile(f.episodePath, "utf8"), approvedBytes);
});

test("request is closed and provider callbacks, accessors, omitted confirmation are rejected", () => {
  const valid = {episodeId: "synthetic", snapshotHash: "a".repeat(64), planHash: "b".repeat(64),
    implementationHash: "c".repeat(64), actor: "human:synthetic", reason: "Synthetic preparation only", confirmEditorialAssetsPreparation: true};
  assert.deepEqual(validateEditorialAssetsPrepareRequest(valid), valid);
  for (const input of [{...valid, provider: "fake"}, {...valid, confirmEditorialAssetsPreparation: false},
    {...valid, actor: "agent:test"}, {...valid, episodeId: "../escape"}, Object.create(valid)]) assert.throws(() => validateEditorialAssetsPrepareRequest(input));
});

test("new artifact and manifest bytes are rechecked after final source reload before CAS", async t => {
  for (const file of ["asset-plan-v001.json", "prepare.json"]) {
    const f = await setup(t); let reads = 0; let writes = 0;
    const service = createEditorialAssetsPrepareService({...f.deps, readEpisode: async () => {
      const value = await f.deps.readEpisode(); reads++;
      if (reads === 2) await f.put(`studio/data/production/episodes/${f.request.episodeId}/editorial-assets/${digest(f.request)}/${file}`, {tampered: true});
      return value;
    }, writeEpisode: async value => {writes++; return f.deps.writeEpisode(value);}});
    const before = await readFile(f.episodePath, "utf8");
    await assert.rejects(service.prepareEditorialAssets(f.request, grant(f.request)), error => error.code === "editorial_assets_artifact_changed");
    assert.equal(writes, 0); assert.equal(await readFile(f.episodePath, "utf8"), before);
    assert.equal(f.events.length, 0);
  }
});

test("missing, broad or wrongly bound grants and injectable request options fail before state writes", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8");
  await assert.rejects(f.service.prepareEditorialAssets(f.request), error => error.code === "side_effect_capability_missing");
  await assert.rejects(f.service.prepareEditorialAssets({...f.request, actor: "human:other"}, grant(f.request)));
  const broad = createCapabilityAuthority({secret: "synthetic-editorial-broad-authority-000000000000", maximumCalls: 10, maximumCostUsd: 10});
  for (const change of [{maxCalls: 1}, {maxCostUsd: 1}, {scopes: ["filesystem.write", "state.write", "model.call"]},
    {scopes: ["filesystem.write", "state.write", "network.fetch"]}]) {
    await assert.rejects(f.service.prepareEditorialAssets(f.request, {sideEffectGrant: broad.authorize({...editorialAssetsPrepareCapabilitySpec(f.request), ...change})}),
      error => error.code === "editorial_assets_capability_not_zero");
  }
  const accessor = {}; Object.defineProperty(accessor, "sideEffectGrant", {enumerable: true, get: () => assert.fail("getter executed")});
  for (const options of [{...grant(f.request), workspaceRoot: f.root}, {...grant(f.request), provider: () => assert.fail("provider")},
    {...grant(f.request), now: "2020-01-01"}, Object.create(grant(f.request)), accessor]) {
    await assert.rejects(f.service.prepareEditorialAssets(f.request, options), error => error.code === "editorial_assets_options_invalid");
  }
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.events.length, 0);
});

test("only a first preparation on the complete approved editorial chain is accepted", async t => {
  const f = await setup(t); const original = await f.deps.readEpisode();
  const mutations = [
    e => {e.pipeline.find(s => s.id === "storyboard").status = "ready";},
    e => {e.pipeline.find(s => s.id === "assets").status = "complete";},
    e => {e.pipeline.find(s => s.id === "voice").status = "ready";},
    e => {e.assets = [{id: "existing", type: "image", path: "existing.png", source: "synthetic", verified: false}];},
    e => {e.production.assetPlan = {version: 1, content: {kind: "existing"}};},
    e => {e.production.voicePlan = {version: 1};},
    e => {e.voice.audioPath = "synthetic.wav";},
    e => {e.render.outputPath = "synthetic.mp4";},
    e => {e.approvals.assets.status = "approved";},
    e => {e.control.stopRequested = true;},
    e => {e.pipeline.find(s => s.id === "qa").status = "running";},
    e => {e.approvals.storyboard.status = "pending";}
  ];
  for (const mutate of mutations) {
    const altered = structuredClone(original); mutate(altered);
    const service = createEditorialAssetsPrepareService({...f.deps, readEpisode: async () => structuredClone(altered),
      writeEpisode: async () => assert.fail("illegal state wrote")});
    await assert.rejects(service.prepareEditorialAssets(f.request, grant(f.request)));
  }
  assert.deepEqual(await f.deps.readEpisode(), original); assert.equal(f.events.length, 0);
});

test("snapshot or source, plan and implementation binding drift refuses preparation", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8");
  for (const field of ["snapshotHash", "planHash", "implementationHash"]) {
    const request = {...f.request, [field]: "f".repeat(64)};
    await assert.rejects(f.service.prepareEditorialAssets(request, grant(request)));
  }
  const config = structuredClone(f.config); config.version = "changed";
  const service = createEditorialAssetsPrepareService({...f.deps, readReviewConfig: async () => config});
  await assert.rejects(service.prepareEditorialAssets(f.request, grant(f.request)));
  await f.implementationFixture.put("studio/src/video/synthetic-transitive.mjs", "export const sample = 2;\n");
  await assert.rejects(f.service.prepareEditorialAssets(f.request, grant(f.request)), error => error.code === "editorial_assets_binding_changed");
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.events.length, 0);
});

test("a pre-CAS crash leaves only immutable orphans; retry registers the same evidence once", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8");
  const failWrite = createEditorialAssetsPrepareService({...f.deps, writeEpisode: async () => {throw new Error("Synthetic pre-CAS failure");}});
  await assert.rejects(failWrite.prepareEditorialAssets(f.request, grant(f.request)), /Synthetic pre-CAS failure/u);
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.events.length, 0);
  const directory = `studio/data/production/episodes/${f.request.episodeId}/editorial-assets/${digest(f.request)}`;
  const artifactBefore = await readFile(resolve(f.root, directory, "asset-plan-v001.json"), "utf8");
  const manifestBefore = await readFile(resolve(f.root, directory, "prepare.json"), "utf8");
  const result = await f.service.prepareEditorialAssets(f.request, grant(f.request));
  assert.equal(result.status, "committed");
  assert.equal(await readFile(resolve(f.root, result.artifactPath), "utf8"), artifactBefore);
  assert.equal(await readFile(resolve(f.root, result.manifestPath), "utf8"), manifestBefore);
  assert.equal((await f.deps.readEpisode()).production.assetPlan.versions.length, 1);
});

test("an audit failure reports committed warning and retry cannot write state or mint a new machine review", async t => {
  const f = await setup(t);
  const failAudit = createEditorialAssetsPrepareService({...f.deps, appendEvent: async () => {throw new Error("Synthetic audit unavailable");}});
  const result = await failAudit.prepareEditorialAssets(f.request, grant(f.request));
  assert.equal(result.status, "committed_with_warning"); assert.equal(result.audit.status, "pending");
  const before = await readFile(f.episodePath, "utf8");
  const retry = createEditorialAssetsPrepareService({...f.deps, writeEpisode: async () => assert.fail("retry wrote state")});
  assert.equal((await retry.prepareEditorialAssets(f.request, grant(f.request))).status, "already_committed");
  assert.equal(await readFile(f.episodePath, "utf8"), before);
  assert.equal(f.events.length, 1); assert.match(f.events[0].idempotencyKey, /^editorial-assets:/u);
  const changedRequest = {...f.request, reason: "A different human request must not reuse approval"};
  await assert.rejects(retry.prepareEditorialAssets(changedRequest, grant(changedRequest)), error => error.code === "editorial_assets_preparation_conflict");
});

test("real writer CAS protects a concurrent state change and does not register orphans", async t => {
  const f = await setup(t);
  const racing = createEditorialAssetsPrepareService({...f.deps, writeEpisode: async candidate => {
    const concurrent = await f.deps.readEpisode(); concurrent.title = "Synthetic concurrent title";
    await f.deps.writeEpisode(concurrent); return f.deps.writeEpisode(candidate);
  }});
  await assert.rejects(racing.prepareEditorialAssets(f.request, grant(f.request)), error => error.code === "state_version_conflict");
  const after = await f.deps.readEpisode(); assert.equal(after.title, "Synthetic concurrent title");
  assert.equal(after.production.assetPlan, undefined); assert.equal(f.events.length, 0);
});

test("registered evidence, implementation, and checkpoint cannot drift on an idempotent retry", async t => {
  const f = await setup(t); const result = await f.service.prepareEditorialAssets(f.request, grant(f.request));
  const before = await readFile(f.episodePath, "utf8");
  const changed = await f.deps.readEpisode(); changed.reviewCheckpoints.assetExecution.machineReview.checkedAt = "2020-01-01T00:00:00.000Z";
  const stale = createEditorialAssetsPrepareService({...f.deps, readEpisode: async () => changed});
  await assert.rejects(stale.prepareEditorialAssets(f.request, grant(f.request)), error => error.code === "editorial_assets_checkpoint_changed");
  for (const key of ["paidCalls", "estimatedCostUsd", "preparedBy", "sourceStoryboard", "sourceScript", "sourceResearch", "missing"]) {
    const altered = await f.deps.readEpisode(); const plan = altered.production.assetPlan;
    if (key === "missing") {delete plan.preparedBy; delete plan.versions[0].preparedBy;}
    else {
      const value = key.endsWith("Calls") || key.endsWith("Usd") ? 1 : key === "preparedBy" ? "human:other" : {tampered: true};
      plan[key] = value; plan.versions[0][key] = value;
    }
    const badReceipt = createEditorialAssetsPrepareService({...f.deps, readEpisode: async () => structuredClone(altered),
      writeEpisode: async () => assert.fail("bad receipt wrote state")});
    await assert.rejects(badReceipt.prepareEditorialAssets(f.request, grant(f.request)), error => error.code === "editorial_assets_receipt_changed");
  }
  await f.put(result.manifestPath, {tampered: true});
  await assert.rejects(f.service.prepareEditorialAssets(f.request, grant(f.request)), error => error.code === "editorial_assets_artifact_changed");
  await assert.rejects(f.service.previewEditorialAssetsPreparation({episodeId: f.request.episodeId}), error => error.code === "editorial_assets_artifact_changed");
  assert.equal(await readFile(f.episodePath, "utf8"), before);
});

test("a concurrent prepare in the same process is refused while the first CAS is pending", async t => {
  const f = await setup(t);
  let started; let proceed;
  const atWrite = new Promise(resolveReady => {started = resolveReady;});
  const releaseWrite = new Promise(resolveReady => {proceed = resolveReady;});
  const first = createEditorialAssetsPrepareService({...f.deps, writeEpisode: async value => {
    started(); await releaseWrite; return f.deps.writeEpisode(value);
  }});
  const running = first.prepareEditorialAssets(f.request, grant(f.request));
  await atWrite;
  try {
    await assert.rejects(f.service.prepareEditorialAssets(f.request, grant(f.request)), error => error.code === "episode_operation_active");
  } finally {proceed();}
  assert.equal((await running).status, "committed");
  assert.equal((await f.deps.readEpisode()).production.assetPlan.versions.length, 1);
});
