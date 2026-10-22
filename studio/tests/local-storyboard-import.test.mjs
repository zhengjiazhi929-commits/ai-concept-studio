import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, symlink, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { approvedScriptFixture } from "./approved-script-fixture.mjs";
import { loadApprovedScriptBinding } from "../src/server/production/approved-script-binding.mjs";
import { createLocalStoryboardImportService } from "../src/server/production/local-storyboard-import-core.mjs";
import { localStoryboardCapabilitySpec } from "../src/shared/local-storyboard-import-request.mjs";
import { createCapabilityAuthority } from "../src/server/security/side-effect-capability.mjs";
import { evaluateProductionQuality } from "../src/server/production/quality.mjs";
import {assertProductionExpiry, assertProductionAuditExpiry, assertProductionManifestExpiry, assertProductionNullAudit} from './production-capability-expiry-fixture.mjs';
import {attachSyntheticScreenEditing} from './helpers/screen-editorial-fixture.mjs';
import {canonicalJsonDocumentContentSha256 as digest,jsonDocumentContentSha256}
  from '../src/shared/durable-json-store.mjs';

for (const expireAt of [1, 2]) test(`storyboard import rejects authority expiring during load ${expireAt}`, async t => {
  await assertProductionExpiry(t, {setup: fixture, createService: createLocalStoryboardImportService,
    capabilitySpec: localStoryboardCapabilitySpec, method: 'importLocalStoryboard', expireAt});
});
test('storyboard import reports committed warning if authority expires after CAS, then repairs audit safely', async t => {
  await assertProductionAuditExpiry(t, {setup: fixture, createService: createLocalStoryboardImportService,
    capabilitySpec: localStoryboardCapabilitySpec, method: 'importLocalStoryboard'});
});
test('storyboard import rechecks expiry between the immutable artifact and manifest', async t => {
  await assertProductionManifestExpiry(t, {setup: fixture, capabilitySpec: localStoryboardCapabilitySpec, method: 'importLocalStoryboard',
    directory: 'local-storyboard', artifactName: 'storyboard-v001.json', manifestName: 'import.json'});
});
test('storyboard import preserves committed status on null or undefined audit rejection', async t => {
  await assertProductionNullAudit(t, {setup: fixture, createService: createLocalStoryboardImportService,
    capabilitySpec: localStoryboardCapabilitySpec, method: 'importLocalStoryboard'});
});

const sha = text => createHash("sha256").update(text).digest("hex");
const authorize = request => ({ sideEffectGrant: createCapabilityAuthority({
  secret: "synthetic-storyboard-import-000000000000000000000"
}).authorize(localStoryboardCapabilitySpec(request)) });

async function fixture(t,{legacy=false}={}) {
  const f = await approvedScriptFixture(t);
  let episode = await f.deps.readEpisode();
  episode.pipeline.find(step => step.id === "script").status = "complete";
  episode.pipeline.find(step => step.id === "storyboard").status = "ready";
  await f.deps.writeEpisode(episode);
  episode = await f.deps.readEpisode();
  const binding = await loadApprovedScriptBinding({ workspaceRoot: f.root, episode, reviewConfig: f.config });
  const script = binding.script;
  const units = [{ id: "hook", text: script.hook, refs: [] }, ...script.sections.flatMap(section =>
    section.narration.split("\n\n").map((text, index) => ({ id: `${section.id}:p${index + 1}`, text, refs: section.evidenceRefs }))),
  { id: "closing", text: script.closing, refs: [] }];
  const groups = units.slice(1, -1).map(unit => [unit]);
  groups[0].unshift(units[0]); groups.at(-1).push(units.at(-1));
  const style = Object.fromEntries(["background", "cardMaterial", "text", "cardText", "illustrationText", "connections", "borders",
    "logo", "captions", "illustrations", "motion", "layout"].map(key => [key, `Synthetic ${key}`]));
  const candidate = { schemaVersion: 1, kind: "codex-authored-storyboard-candidate-v1", episodeId: episode.id,
    candidateVersion: 1, author: "Codex", status: "local-editorial-draft", humanApproved: false, sourceScript: binding.sourceScript,
    content: { title: script.title, globalStyle: { canvas: [1920, 1080], ...style }, timingPolicy: "No audio timing",
      implementationBoundary: "No implemented graphics", shots: groups.map((group, index) => ({ id: `B${index + 1}`, title: `合成镜头${index + 1}`,
        unitIds: group.map(unit => unit.id), form: "演示", layout: "左右分区", beats: [{ cue: group[0].text.slice(0, 5), action: "复制记录", result: "保留原件" }],
        guard: "不提前出现结果", implementation: "待实现", narration: group.map(unit => unit.text).join("\n\n"),
        sourceUnits: group.map(unit => ({ id: unit.id, sha256: sha(unit.text) })), evidenceRefs: [...new Set(group.flatMap(unit => unit.refs))],
        timing: { mode: "narration-cues", startSeconds: null, endSeconds: null, note: "No measured timing" } })) } };
  const candidatePath = "outputs/synthetic/storyboard.json";
  if(!legacy)attachSyntheticScreenEditing(candidate);
  await f.put(candidatePath, candidate);
  const service = createLocalStoryboardImportService(f.deps);
  const preview = await service.previewLocalStoryboard({ episodeId: episode.id, candidatePath });
  const request = { episodeId: episode.id, candidatePath, candidateSha256: preview.candidateSha256,
    snapshotHash: preview.snapshotHash, actor: "human:fixture", reason: "Explicit synthetic editorial import", confirmLocalStoryboardImport: true };
  return { ...f, candidate, candidatePath, request, service };
}

test('new storyboard submission cannot bypass screen editing by omitting its versioned plan', async t => {
  const f = await fixture(t,{legacy:true});
  const before = await f.deps.readEpisode();
  await assert.rejects(f.service.importLocalStoryboard(f.request, authorize(f.request)),
    error => error.code === 'screen_editorial_policy_required');
  assert.deepEqual(await f.deps.readEpisode(), before);
});

test('exact registered legacy cue replay preserves history but is not a new-submission exemption',async t=>{
  const f=await fixture(t,{legacy:true});
  const episode=await f.deps.readEpisode();
  const upstream=await loadApprovedScriptBinding({workspaceRoot:f.root,episode,reviewConfig:f.config});
  const importId=digest(f.request),version=1;
  const prefix=`studio/data/production/episodes/${episode.id}/local-storyboard/${importId}`;
  const artifactPath=`${prefix}/storyboard-v001.json`,manifestPath=`${prefix}/import.json`;
  const byteLength=value=>Buffer.byteLength(`${JSON.stringify(value,null,2)}\n`);
  const manifest={schemaVersion:1,kind:'codex-local-storyboard-import',importId,request:f.request,version,
    artifactPath,artifactSha256:jsonDocumentContentSha256(f.candidate.content),candidate:f.candidate,
    sourceScript:upstream.sourceScript,sourceResearch:upstream.sourceResearch,
    previousTimeline:{scenes:episode.scenes,subtitles:episode.subtitles,durationSeconds:episode.render.durationSeconds}};
  // Materialize a synthetic pre-policy registry snapshot directly. The new
  // service is never allowed to create this unversioned artifact.
  await f.put(artifactPath,f.candidate.content);await f.put(manifestPath,manifest);
  const entry={version,artifactPath,sha256:manifest.artifactSha256,bytes:byteLength(f.candidate.content),
    generatedAt:'2026-09-01T00:00:00.000Z',generationKind:'codex-local-storyboard-import',phase:'editorial',
    storyboardKind:'editorial-cue-plan-v1',timingStatus:'unmeasured',executionStatus:'implementation-required',
    importId,importedBy:f.request.actor,candidateSha256:f.request.candidateSha256,
    sourceScript:upstream.sourceScript,sourceResearch:upstream.sourceResearch,
    manifestPath,manifestSha256:jsonDocumentContentSha256(manifest),manifestBytes:byteLength(manifest)};
  episode.production.storyboardDraft={...entry,needsRevision:false,content:f.candidate.content,versions:[entry]};
  episode.scenes=[];episode.subtitles=[];episode.render.durationSeconds=null;
  await f.deps.writeEpisode(episode);
  const before=await f.deps.readEpisode();
  assert.equal((await f.service.importLocalStoryboard(f.request,authorize(f.request))).status,'already_committed');
  assert.deepEqual(await f.deps.readEpisode(),before);
  f.candidate.candidateVersion+=1;await f.put(f.candidatePath,f.candidate);
  const preview=await f.service.previewLocalStoryboard({episodeId:episode.id,candidatePath:f.candidatePath});
  const request={...f.request,candidateSha256:preview.candidateSha256,snapshotHash:preview.snapshotHash};
  await assert.rejects(f.service.importLocalStoryboard(request,authorize(request)),{code:'screen_editorial_policy_required'});
  assert.deepEqual(await f.deps.readEpisode(),before);
});

test("preview does not write; editorial import preserves script/AI, never invents timeline or approval", async t => {
  const f = await fixture(t); const before = await f.deps.readEpisode();
  const events = f.events.length;
  await f.service.previewLocalStoryboard({ episodeId: before.id, candidatePath: f.candidatePath });
  assert.deepEqual(await f.deps.readEpisode(), before); assert.equal(f.events.length, events);
  const result = await f.service.importLocalStoryboard(f.request, authorize(f.request));
  assert.equal(result.status, "committed");
  const after = await f.deps.readEpisode();
  assert.equal(after.production.storyboardDraft.generationKind, "codex-local-storyboard-import");
  assert.equal(after.production.storyboardDraft.storyboardKind, "editorial-cue-plan-v1");
  assert.equal(after.production.storyboardDraft.timingStatus, "unmeasured");
  assert.deepEqual(after.production.storyboardDraft.content, f.candidate.content);
  assert.deepEqual(after.production.scriptDraft, before.production.scriptDraft);
  assert.deepEqual(after.production.ai, before.production.ai);
  assert.deepEqual(after.approvals.script, before.approvals.script);
  assert.deepEqual(after.approvals.research, before.approvals.research);
  assert.deepEqual(after.sourceDocs, before.sourceDocs);
  assert.deepEqual(after.scenes, []); assert.deepEqual(after.subtitles, []);
  assert.equal(after.pipeline.find(step => step.id === "storyboard").status, "waiting_approval");
  for (const gate of ["storyboard", "assets", "final"]) assert.equal(after.approvals[gate].status, "pending");
  assert.equal(evaluateProductionQuality(after, { stage: "storyboard" }).passed, false);
});

test("missing/foreign grants and authority injection fail before writes", async t => {
  const f = await fixture(t); const before = await readFile(f.episodePath, "utf8");
  await assert.rejects(f.service.importLocalStoryboard(f.request));
  await assert.rejects(f.service.importLocalStoryboard({ ...f.request, actor: "human:other" }, authorize(f.request)));
  let calls = 0;
  const options = {}; Object.defineProperty(options, "sideEffectGrant", { get() { calls++; return authorize(f.request).sideEffectGrant; } });
  await assert.rejects(f.service.importLocalStoryboard(f.request, options));
  await assert.rejects(f.service.importLocalStoryboard(f.request, Object.create(authorize(f.request))));
  assert.equal(calls, 0); assert.equal(await readFile(f.episodePath, "utf8"), before);
});

test("same operation cannot bring provider scopes or a positive cost budget", async t => {
  const f = await fixture(t); const before = await readFile(f.episodePath, "utf8");
  const spec = localStoryboardCapabilitySpec(f.request);
  const authority = createCapabilityAuthority({ secret: "synthetic-storyboard-extra-authority-0000000000000000", maximumCalls: 2, maximumCostUsd: 2 });
  for (const grantSpec of [{ ...spec, scopes: [...spec.scopes, "model.invoke"] }, { ...spec, maxCalls: 1, maxCostUsd: 1 }]) {
    await assert.rejects(f.service.importLocalStoryboard(f.request, { sideEffectGrant: authority.authorize(grantSpec) }));
    assert.equal(await readFile(f.episodePath, "utf8"), before);
  }
});

test("changed candidate, stale state, revocation, active operation and immutable upstream changes reject", async t => {
  for (const change of ["candidate", "state", "revoke", "busy", "stop", "script-file", "manifest", "pack", "batch", "not-complete", "config"]) {
    const f = await fixture(t); let e = await f.deps.readEpisode();
    if (change === "candidate") { f.candidate.content.shots[0].guard = "Changed"; await f.put(f.candidatePath, f.candidate); }
    else if (change === "script-file") await f.put(e.production.scriptDraft.artifactPath, { changed: true });
    else if (change === "manifest") await f.put(e.production.scriptDraft.manifestPath, { changed: true });
    else if (change === "pack") await f.put(f.packPath, { changed: true });
    else if (change === "batch") await f.put(f.batchPath, { changed: true });
    else {
      if (change === "state") e.title = "Changed";
      if (change === "revoke") e.approvals.script.status = "pending";
      if (change === "busy") e.control.activeOperation = { id: "synthetic-busy", kind: "render" };
      if (change === "stop") e.control.stopRequested = true;
      if (change === "not-complete") e.pipeline.find(step => step.id === "script").status = "ready";
      if (change === "config") e.reviews.script.reports.at(-1).reviewConfigHash = "a".repeat(64);
      await f.deps.writeEpisode(e);
    }
    const before = await readFile(f.episodePath, "utf8");
    await assert.rejects(f.service.importLocalStoryboard(f.request, authorize(f.request)), undefined, change);
    assert.equal(await readFile(f.episodePath, "utf8"), before, change);
  }
});

test("CAS failure leaves unregistered immutable files and identical retry recovers", async t => {
  const f = await fixture(t);
  const service = createLocalStoryboardImportService({ ...f.deps, writeEpisode: async () => { throw new Error("Synthetic CAS failure"); } });
  await assert.rejects(service.importLocalStoryboard(f.request, authorize(f.request)));
  assert.equal((await f.deps.readEpisode()).production.storyboardDraft, undefined);
  assert.ok((await readdir(resolve(f.root, `studio/data/production/episodes/${f.request.episodeId}/local-storyboard`))).length > 0);
  assert.equal((await f.service.importLocalStoryboard(f.request, authorize(f.request))).status, "committed");
});

test("audit failure and later review-state retry never add a version or reset history", async t => {
  const f = await fixture(t); let auditFails = true;
  const service = createLocalStoryboardImportService({ ...f.deps, appendEvent: async () => { if (auditFails) throw new Error("Synthetic audit failure"); } });
  const first = await service.importLocalStoryboard(f.request, authorize(f.request));
  assert.equal(first.status, "committed_with_warning");
  let e = await f.deps.readEpisode();
  e.production.storyboardDraft.needsRevision = true;
  e.approvals.storyboard.feedback = "Synthetic revision note";
  await f.deps.writeEpisode(e); const before = await f.deps.readEpisode(); auditFails = false;
  const retry = await service.importLocalStoryboard(f.request, authorize(f.request));
  assert.equal(retry.status, "already_committed"); assert.deepEqual(await f.deps.readEpisode(), before);
  await f.put(first.manifestPath, { changed: true });
  await assert.rejects(service.importLocalStoryboard(f.request, authorize(f.request)));
});

test("concurrent import, symlink candidate and changed current pointer fail closed", async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.service.importLocalStoryboard(f.request, authorize(f.request)), f.service.importLocalStoryboard(f.request, authorize(f.request))]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  let e = await f.deps.readEpisode(); e.production.storyboardDraft.artifactPath = "changed.json"; await f.deps.writeEpisode(e);
  await assert.rejects(f.service.importLocalStoryboard(f.request, authorize(f.request)));
  const f2 = await fixture(t); await rm(resolve(f2.root, f2.candidatePath)); await symlink(resolve(f2.root, f2.packPath), resolve(f2.root, f2.candidatePath));
  await assert.rejects(f2.service.previewLocalStoryboard({ episodeId: f2.request.episodeId, candidatePath: f2.candidatePath }));
});
