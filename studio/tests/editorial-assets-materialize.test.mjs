import test from "node:test";
import assert from "node:assert/strict";
import {readFile, writeFile, readdir, mkdir} from "node:fs/promises";
import {resolve, dirname} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {approvedStoryboardFixture} from "./approved-storyboard-fixture.mjs";
import {seedEditorialBundleImplementationFixture} from "./editorial-materialization-fixture.mjs";
import {seedEditorialImplementationFixture} from "./editorial-implementation-fixture.mjs";
import {createApprovedStoryboardCompletionService} from "../src/server/production/approved-storyboard-completion-core.mjs";
import {approvedStoryboardCompletionCapabilitySpec} from "../src/shared/approved-storyboard-completion-request.mjs";
import {createEditorialAssetsPrepareService} from "../src/server/production/editorial-assets-prepare-core.mjs";
import {editorialAssetsPrepareCapabilitySpec} from "../src/shared/editorial-assets-prepare-request.mjs";
import {createEditorialAssetsMaterializeService} from "../src/server/production/editorial-assets-materialize-core.mjs";
import {editorialAssetsMaterializeCapabilitySpec, validateEditorialAssetsMaterializeRequest} from "../src/shared/editorial-assets-materialize-request.mjs";
import {createCapabilityAuthority} from "../src/server/security/side-effect-capability.mjs";
import {approveAssetExecutionCandidate} from "../src/server/reviews/asset-execution-checkpoint.mjs";
import {canonicalJsonDocumentContentSha256 as digest} from "../src/shared/durable-json-store.mjs";
import {integrityHash} from "../src/shared/integrity.mjs";
import {editorialMaterializationManifest, editorialMaterializationReceipt, editorialMaterializationAssetRecords,
  editorialMaterializationInputProps, editorialMaterializationJson, editorialMaterializationSha,
  editorialMaterializationDirectory} from "../src/server/production/editorial-materialization-integrity.mjs";

const authority = () => createCapabilityAuthority({secret: "synthetic-editorial-materialize-000000000000000000",
  now: () => 1800000000000, defaultTtlMs: 300000, maximumTtlMs: 300000});
const grant = request => ({sideEffectGrant: authority().authorize(editorialAssetsMaterializeCapabilitySpec(request))});
// Explicit synthetic file adapter for service protocol faults. This does not
// claim webpack/browser/pixel coverage: the separate real-bundle test below and
// bundle-integrity test suite exercise the production implementation itself.
function syntheticBundleAdapter(root) {
  function buildExpected(episode, request) {
    const cp = episode.reviewCheckpoints.assetExecution; const plan = episode.production.assetPlan;
    const bodies = {"bundle/index.html": "<!doctype html><title>Synthetic protocol fixture</title>",
      "bundle/app.js": "/* synthetic protocol fixture, not an executable renderer */",
      "input-props.json": editorialMaterializationJson(editorialMaterializationInputProps(episode))};
    const files = Object.entries(bodies).map(([path, body]) => ({path, bytes: Buffer.byteLength(body), sha256: editorialMaterializationSha(body),
      role: path === "input-props.json" ? "renderer-input" : "compiled-renderer"}));
    const source = {implementation: plan.content.implementation, sourceStoryboard: plan.content.sourceStoryboard,
      sourceAssetPlan: {version: plan.version, candidateHash: cp.currentCandidate.candidateHash, machineReviewId: cp.machineReview.id,
        planHash: cp.currentCandidate.planHash, artifact: cp.currentCandidate.artifact, entryHash: integrityHash(plan),
        humanApprovalHash: integrityHash(cp.humanApproval), machineReviewHash: integrityHash(cp.machineReview)}};
    const manifest = editorialMaterializationManifest({episode, operationId: digest(request), request, source, files});
    const receipt = editorialMaterializationReceipt(manifest);
    return {manifest, receipt, assetRecords: editorialMaterializationAssetRecords(episode, manifest, receipt),
      bodies: {...bodies, "materialization.json": editorialMaterializationJson(manifest)}};
  }
  return {buildBundle: async ({episode, request}) => {
    const result = buildExpected(episode, request); const dir = editorialMaterializationDirectory(episode.id, digest(request));
    for (const [path, body] of Object.entries(result.bodies)) {
      const target = resolve(root, dir, path); await mkdir(dirname(target), {recursive: true});
      try { await writeFile(target, body, {flag: "wx"}); }
      catch (error) { if (error.code !== "EEXIST") throw error; assert.equal(await readFile(target, "utf8"), body, "Synthetic immutable output changed"); }
    }
    return result;
  }, verifyBundle: async ({episode, receipt}) => {
    const result = buildExpected(episode, receipt.request);
    assert.deepEqual(receipt, result.receipt, "Synthetic receipt changed");
    for (const [path, body] of Object.entries(result.bodies)) assert.equal(await readFile(resolve(root, result.receipt.directory, path), "utf8"), body, "Synthetic output changed");
    return result;
  }};
}
async function setup(t, {realBundle = false} = {}) {
  const f = await approvedStoryboardFixture(t);
  const completion = createApprovedStoryboardCompletionService(f.deps);
  const p = await completion.previewApprovedStoryboardCompletion({episodeId: f.episode.id});
  const r = {episodeId: f.episode.id, artifactVersion: p.sourceStoryboard.artifactVersion,
    artifactHash: p.sourceStoryboard.artifactHash, reviewReportId: p.sourceStoryboard.reviewReportId,
    snapshotHash: p.snapshotHash, actor: "human:synthetic", reason: "Complete synthetic approved storyboard",
    confirmApprovedStoryboardCompletion: true};
  await completion.completeApprovedStoryboard(r, {sideEffectGrant: authority().authorize(approvedStoryboardCompletionCapabilitySpec(r))});
  const empty = await f.deps.readEpisode(); empty.assets = []; await f.deps.writeEpisode(empty);
  const implementation = await (realBundle ? seedEditorialBundleImplementationFixture : seedEditorialImplementationFixture)(f.root);
  await f.put("studio/config/review-rubrics.json", f.config);
  const prepare = createEditorialAssetsPrepareService(f.deps);
  const pp = await prepare.previewEditorialAssetsPreparation({episodeId: f.episode.id});
  const pr = {episodeId: f.episode.id, snapshotHash: pp.snapshotHash, planHash: pp.planHash,
    implementationHash: pp.implementationHash, actor: "human:synthetic", reason: "Prepare synthetic local assets only", confirmEditorialAssetsPreparation: true};
  await prepare.prepareEditorialAssets(pr, {sideEffectGrant: authority().authorize(editorialAssetsPrepareCapabilitySpec(pr))});
  const unapproved = await f.deps.readEpisode(); const cp = unapproved.reviewCheckpoints.assetExecution;
  await approveAssetExecutionCandidate(unapproved.id, {candidateHash: cp.currentCandidate.candidateHash,
    machineReviewId: cp.machineReview.id, note: "Explicit independent synthetic-only execution approval"},
  {...f.deps, workspaceRoot: f.root, reviewConfig: f.config, actor: "human:synthetic"});
  const deps = {...f.deps, ...(realBundle ? {} : syntheticBundleAdapter(f.root))};
  const service = createEditorialAssetsMaterializeService(deps);
  const preview = await service.previewEditorialAssetsMaterialization({episodeId: f.episode.id});
  const request = {episodeId: f.episode.id, snapshotHash: preview.snapshotHash, candidateHash: preview.candidateHash,
    machineReviewId: preview.machineReviewId, implementationHash: preview.implementationHash,
    actor: "human:synthetic", reason: "Materialize synthetic local bundle without render", confirmEditorialAssetsMaterialization: true};
  f.events.length = 0;
  return {...f, deps, implementation, unapproved, service, preview, request};
}

test("materialization request is closed, bound, human-explicit and excludes render/provider switches", () => {
  const valid = {episodeId: "synthetic", snapshotHash: "a".repeat(64), candidateHash: "b".repeat(64),
    machineReviewId: "synthetic-review", implementationHash: "c".repeat(64), actor: "human:synthetic",
    reason: "Synthetic local only", confirmEditorialAssetsMaterialization: true};
  assert.deepEqual(validateEditorialAssetsMaterializeRequest(valid), valid);
  for (const input of [{...valid, render: true}, {...valid, provider: "fake"}, {...valid, confirmEditorialAssetsMaterialization: false},
    {...valid, actor: "agent:test"}, {...valid, machineReviewId: "../bad"}, Object.create(valid)]) assert.throws(() => validateEditorialAssetsMaterializeRequest(input));
  const getter = {...valid}; Object.defineProperty(getter, "actor", {enumerable: true, get: () => assert.fail("getter executed")});
  assert.throws(() => validateEditorialAssetsMaterializeRequest(getter));
});

test("materialization preview is fully read-only and refuses unapproved execution plan", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8");
  const preview = await f.service.previewEditorialAssetsMaterialization({episodeId: f.episode.id});
  assert.deepEqual(preview, f.preview); assert.equal(preview.materializationState, "not_started");
  assert.equal(preview.rendered, false); assert.equal(preview.voiceStatus, "deferred");
  assert.equal(preview.paidCalls, 0); assert.equal(preview.visualAcceptance, false);
  const unapproved = createEditorialAssetsMaterializeService({...f.deps, readEpisode: async () => structuredClone(f.unapproved)});
  await assert.rejects(unapproved.previewEditorialAssetsMaterialization({episodeId: f.episode.id}), error => error.code === "editorial_materialization_approval_required");
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.events.length, 0);
});

test("real local bundle is registered by one CAS, preserving source and every unapproved downstream gate", async t => {
  const f = await setup(t, {realBundle: true}); const before = await f.deps.readEpisode();
  const result = await f.service.materializeEditorialAssets(f.request, grant(f.request));
  assert.equal(result.status, "committed"); assert.equal(result.rendered, false); assert.equal(result.voiceStatus, "deferred");
  const after = await f.deps.readEpisode();
  assert.equal(after.control.stateVersion, before.control.stateVersion + 1);
  for (const key of ["research", "sourceDocs", "scenes", "subtitles", "render", "voice", "qa", "reviews", "approvals", "reviewCheckpoints"]) assert.deepEqual(after[key], before[key], key);
  for (const key of ["scriptDraft", "storyboardDraft", "assetPlan", "assetBundleRevision", "ai"]) assert.deepEqual(after.production[key], before.production[key], key);
  assert.deepEqual(after.control.budget, before.control.budget);
  assert.equal(after.pipeline.find(item => item.id === "assets").status, "complete");
  assert.equal(after.pipeline.find(item => item.id === "voice").status, "ready");
  assert.equal(after.pipeline.find(item => item.id === "render").status, "pending");
  assert.equal(after.approvals.assets.status, "pending"); assert.equal(after.approvals.final.status, "pending");
  assert.equal(after.assets.length, before.scenes.length);
  assert.ok(after.assets.every(asset => asset.verified === false && asset.componentId === "EditorialMotionPreview"));
  const receipt = after.production.editorialMaterialization;
  const manifest = JSON.parse(await readFile(resolve(f.root, receipt.manifestPath), "utf8"));
  assert.ok(manifest); assert.match(await readFile(resolve(f.root, receipt.bundlePath, "index.html"), "utf8"), /<!doctype html>/iu);
  const bytes = await readFile(f.episodePath, "utf8");
  assert.equal((await f.service.materializeEditorialAssets(f.request, grant(f.request))).status, "already_committed");
  assert.equal((await f.service.previewEditorialAssetsMaterialization({episodeId: f.episode.id})).materializationState, "already_materialized");
  assert.equal(await readFile(f.episodePath, "utf8"), bytes);
});

test("missing, broad, mismatched capability and options callbacks fail without writing", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8");
  await assert.rejects(f.service.materializeEditorialAssets(f.request), error => error.code === "side_effect_capability_missing");
  await assert.rejects(f.service.materializeEditorialAssets({...f.request, actor: "human:other"}, grant(f.request)));
  const broad = createCapabilityAuthority({secret: "synthetic-editorial-materialize-broad-000000000000", maximumCalls: 10, maximumCostUsd: 10});
  for (const more of [{maxCalls: 1}, {maxCostUsd: 1}, {scopes: ["filesystem.write", "state.write", "network.fetch"]}]) {
    await assert.rejects(f.service.materializeEditorialAssets(f.request, {sideEffectGrant: broad.authorize({...editorialAssetsMaterializeCapabilitySpec(f.request), ...more})}),
      error => error.code === "editorial_materialization_capability_not_zero");
  }
  const getter = {}; Object.defineProperty(getter, "sideEffectGrant", {enumerable: true, get: () => assert.fail("getter executed")});
  for (const options of [{...grant(f.request), workspaceRoot: f.root}, {...grant(f.request), provider: () => {}}, Object.create(grant(f.request)), getter]) {
    await assert.rejects(f.service.materializeEditorialAssets(f.request, options), error => error.code === "editorial_materialization_options_invalid");
  }
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.events.length, 0);
});

test("snapshot, source preparation, approval, implementation or pipeline drift fails closed", async t => {
  const f = await setup(t); const original = await f.deps.readEpisode();
  for (const field of ["snapshotHash", "candidateHash", "implementationHash", "machineReviewId"]) {
    const request = {...f.request, [field]: field === "machineReviewId" ? "stale-report" : "f".repeat(64)};
    await assert.rejects(f.service.materializeEditorialAssets(request, grant(request)));
  }
  const mutations = [
    e => {e.pipeline.find(item => item.id === "assets").status = "complete";},
    e => {e.pipeline.find(item => item.id === "voice").status = "ready";},
    e => {e.pipeline.push(structuredClone(e.pipeline.find(item => item.id === "assets")));},
    e => {e.pipeline.find(item => item.id === "voice").agent = "render-agent";},
    e => {e.control.activeOperation = {id: "busy", kind: "synthetic", startedAt: "2026-01-01T00:00:00.000Z"};},
    e => {e.control.stopRequested = true;},
    e => {e.reviewCheckpoints.assetExecution.humanApproval = null;},
    e => {e.reviewCheckpoints.assetExecution.humanApproval.actor = "agent:synthetic";},
    e => {e.production.voicePlan = {version: 1};},
    e => {e.voice.audioPath = "synthetic.wav";},
    e => {e.render.outputPath = "synthetic.mp4";},
    e => {e.approvals.assets.status = "approved";},
    e => {e.production.assetPlan.sha256 = "f".repeat(64);},
    e => {e.production.assetPlan.versions[0].preparedBy = "human:other";}
  ];
  for (const change of mutations) {
    const altered = structuredClone(original); change(altered);
    const service = createEditorialAssetsMaterializeService({...f.deps, readEpisode: async () => structuredClone(altered), writeEpisode: async () => assert.fail("illegal mutation")});
    await assert.rejects(service.materializeEditorialAssets(f.request, grant(f.request)));
  }
  assert.deepEqual(await f.deps.readEpisode(), original); assert.equal(f.events.length, 0);
});

test("pre-CAS crash retains immutable bundle and exact retry registers it once", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8");
  const fail = createEditorialAssetsMaterializeService({...f.deps, writeEpisode: async () => {throw new Error("Synthetic pre-CAS crash");}});
  await assert.rejects(fail.materializeEditorialAssets(f.request, grant(f.request)), /Synthetic pre-CAS crash/u);
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.events.length, 0);
  const manifestPath = `studio/public/episodes/${f.request.episodeId}/editorial-materialization/${digest(f.request)}/materialization.json`;
  const manifest = await readFile(resolve(f.root, manifestPath), "utf8");
  assert.equal((await f.service.materializeEditorialAssets(f.request, grant(f.request))).status, "committed");
  assert.equal(await readFile(resolve(f.root, manifestPath), "utf8"), manifest);
  assert.equal((await f.deps.readEpisode()).control.stateVersion, JSON.parse(before).control.stateVersion + 1);
});

test("audit warning retry only repairs audit, preserves later state and rejects request changes", async t => {
  const f = await setup(t);
  const fail = createEditorialAssetsMaterializeService({...f.deps, appendEvent: async () => {throw new Error("Synthetic audit failure");}});
  assert.equal((await fail.materializeEditorialAssets(f.request, grant(f.request))).status, "committed_with_warning");
  const later = await f.deps.readEpisode(); later.pipeline.find(item => item.id === "voice").message = "Synthetic later voice planning note";
  await f.deps.writeEpisode(later);
  const before = await readFile(f.episodePath, "utf8");
  const retry = createEditorialAssetsMaterializeService({...f.deps, writeEpisode: async () => assert.fail("retry rewrote state")});
  assert.equal((await retry.materializeEditorialAssets(f.request, grant(f.request))).status, "already_committed");
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.events.length, 1);
  const changed = {...f.request, reason: "Other request cannot reuse committed bundle"};
  await assert.rejects(retry.materializeEditorialAssets(changed, grant(changed)), error => error.code === "editorial_materialization_conflict");
});

test("cross-process writer CAS preserves concurrent state and does not register bundle orphans", async t => {
  const f = await setup(t);
  const racing = createEditorialAssetsMaterializeService({...f.deps, writeEpisode: async candidate => {
    const moduleUrl = new URL("../src/shared/episode-store-writer-core.mjs", import.meta.url).href;
    await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", `
      import {readFile} from 'node:fs/promises'; import {dirname} from 'node:path';
      const {createEpisodeWriterCore} = await import(${JSON.stringify(moduleUrl)});
      const episodePath = process.argv[1];
      const writer = createEpisodeWriterCore({episodeDataDirectory:()=>dirname(episodePath),episodeDataPath:()=>episodePath});
      const value=JSON.parse(await readFile(episodePath,'utf8')); value.title='Synthetic independent writer update';
      await writer.writeEpisode(value);
    `, f.episodePath]);
    return f.deps.writeEpisode(candidate);
  }});
  await assert.rejects(racing.materializeEditorialAssets(f.request, grant(f.request)), error => error.code === "state_version_conflict");
  const after = await f.deps.readEpisode(); assert.equal(after.production.editorialMaterialization, undefined);
  assert.equal(after.title, "Synthetic independent writer update"); assert.equal(after.assets.length, 0); assert.equal(f.events.length, 0);
});

test("post-build output changes are refused before CAS and registered retry rechecks all files", async t => {
  const f = await setup(t); let reads = 0; let writes = 0;
  const service = createEditorialAssetsMaterializeService({...f.deps, readEpisode: async () => {
    const episode = await f.deps.readEpisode(); reads++;
    // Each load brackets the preparation service read. Second load occurs
    // only after real bundling; mutate before final recursive verification.
    if (reads === 4) {
      const directory = `studio/public/episodes/${f.request.episodeId}/editorial-materialization/${digest(f.request)}`;
      await writeFile(resolve(f.root, directory, "bundle/index.html"), "tampered bundle");
    }
    return episode;
  }, writeEpisode: async value => {writes++; return f.deps.writeEpisode(value);}});
  const before = await readFile(f.episodePath, "utf8");
  await assert.rejects(service.materializeEditorialAssets(f.request, grant(f.request)));
  assert.ok(reads >= 4, "the mutation must occur after the bundle builder completed");
  assert.equal(writes, 0); assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.events.length, 0);
});

test("a grant expiring after compilation cannot commit state and fresh same-request grant recovers", async t => {
  const f = await setup(t); let reads = 0; let clock = 1800000000000;
  const expiring = createCapabilityAuthority({secret: "synthetic-editorial-expiry-000000000000000000",
    now: () => clock, defaultTtlMs: 300000, maximumTtlMs: 300000});
  const options = {sideEffectGrant: expiring.authorize(editorialAssetsMaterializeCapabilitySpec(f.request))};
  const service = createEditorialAssetsMaterializeService({...f.deps, readEpisode: async () => {
    const value = await f.deps.readEpisode(); reads++;
    if (reads === 4) clock += 300001;
    return value;
  }});
  const before = await readFile(f.episodePath, "utf8");
  await assert.rejects(service.materializeEditorialAssets(f.request, options), error => error.code === "side_effect_capability_expired");
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.events.length, 0);
  assert.equal((await f.service.materializeEditorialAssets(f.request, grant(f.request))).status, "committed");
});

test("registered receipt, asset membership, human approval and source bytes cannot drift on retry", async t => {
  const f = await setup(t); await f.service.materializeEditorialAssets(f.request, grant(f.request));
  const original = await f.deps.readEpisode();
  for (const change of [e => {e.assets.pop();}, e => {e.assets[0].verified = true;},
    e => {e.pipeline.find(item => item.id === "assets").status = "ready";},
    e => {e.production.editorialMaterialization.rendered = true;}, e => {e.title = "Different renderer title";},
    e => {e.reviewCheckpoints.assetExecution.humanApproval.note = "Different synthetic approval";}]) {
    const altered = structuredClone(original); change(altered);
    const retry = createEditorialAssetsMaterializeService({...f.deps, readEpisode: async () => structuredClone(altered), writeEpisode: async () => assert.fail("stale retry wrote")});
    await assert.rejects(retry.materializeEditorialAssets(f.request, grant(f.request)));
  }
  const receipt = original.production.editorialMaterialization;
  const directory = resolve(f.root, receipt.bundlePath);
  const js = (await readdir(directory)).find(file => file.endsWith(".js"));
  assert.ok(js); await writeFile(resolve(directory, js), "tampered child JS");
  await assert.rejects(f.service.materializeEditorialAssets(f.request, grant(f.request)));
  await assert.rejects(f.service.previewEditorialAssetsMaterialization({episodeId: f.episode.id}));
  assert.deepEqual(await f.deps.readEpisode(), original);
});
