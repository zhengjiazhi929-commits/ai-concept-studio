import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {approvedStoryboardFixture} from "./approved-storyboard-fixture.mjs";
import {canonicalJsonDocumentContentSha256 as digest} from "../src/shared/durable-json-store.mjs";
import {createCapabilityAuthority} from "../src/server/security/side-effect-capability.mjs";
import {validateEditorialVoiceRegisterRequest, editorialVoiceRegisterCapabilitySpec}
  from "../src/shared/editorial-voice-register-request.mjs";
import {validateEditorialVoiceReceipt, buildEditorialVoiceRecord, editorialVoiceRegistrationValid}
  from "../src/shared/editorial-voice-contract.mjs";
import {createEditorialVoiceService} from "../src/server/production/editorial-voice-core.mjs";

const h = letter => letter.repeat(64);
const iso = "2026-09-17T01:00:00.000Z";
const authority = () => createCapabilityAuthority({secret: "synthetic-editorial-voice-0000000000000000000000"});
const grant = request => ({sideEffectGrant: authority().authorize(editorialVoiceRegisterCapabilitySpec(request))});
const candidatePath = `outputs/studio/synthetic/editorial-voice-candidates/${h("a")}/voice-manifest.json`;
function receiptFor(episode, candidate, request) {
  const bundlePath = `studio/public/episodes/${episode.id}/editorial-voice/${candidate.candidateSha256}`;
  return {schemaVersion: "editorial-voice-receipt-v1", episodeId: episode.id, version: 1,
    operationId: digest(request), request: structuredClone(request), candidateSha256: candidate.candidateSha256,
    bundlePath, manifest: {path: `${bundlePath}/voice-manifest.json`, sha256: candidate.candidateSha256, bytes: 400},
    audio: {path: `${bundlePath}/media/voice.wav`, publicPath: `${bundlePath.slice("studio/public/".length)}/media/voice.wav`,
      sha256: h("b"), bytes: 48044, totalSamples: 24000, durationSeconds: 1, sampleRate: 24000, channels: 1, bitsPerSample: 16},
    captions: {path: `${bundlePath}/captions.json`, sha256: h("c"), bytes: 200, count: 2},
    timing: {path: `${bundlePath}/timing.json`, sha256: h("d"), bytes: 300},
    source: structuredClone(candidate.source), synthesis: {voiceId: "zm_010", speed: 1.1, modelSha256: h("e"), voiceSha256: h("f")},
    captionAligned: true, alignmentMethod: "synthesis-segment-sample-boundaries-v1", motionAligned: false,
    renderReady: false, externalApiCalls: 0, maximumPaidCostUsd: 0, registeredAt: iso};
}
async function setup(t) {
  // Synthetic source chain and injected byte adapters only. No live episode,
  // installed TTS engine, user media, model calls, or rendering is accessed.
  const f = await approvedStoryboardFixture(t);
  const before = await f.deps.readEpisode();
  for (const id of ["storyboard", "assets"]) Object.assign(before.pipeline.find(step => step.id === id),
    {status: "complete", requiresHuman: false, requiresApproval: null});
  Object.assign(before.pipeline.find(step => step.id === "voice"),
    {status: "ready", requiresHuman: false, requiresApproval: null});
  before.production.editorialMaterialization = {schemaVersion: "editorial-materialization-receipt-v1",
    episodeId: before.id, manifestSha256: h("6"), rendered: false, voiceStatus: "deferred"};
  await f.deps.writeEpisode(before); f.events.length = 0;
  const candidate = {candidateSha256: h("1"), implementationHash: h("2"), source: {
    scriptBindingHash: h("3"), storyboardBindingHash: h("4"), materializationManifestSha256: h("6")}};
  const receipts = new Map(); let builds = 0; let verifies = 0;
  const deps = {...f.deps,
    inspectCandidate: async () => structuredClone(candidate),
    materializeCandidate: async ({episode, candidate: input, request}) => {
      builds++; const receipt = receiptFor(episode, input, request); receipts.set(receipt.operationId, receipt);
      return structuredClone(receipt);
    },
    verifyRegistered: async ({receipt}) => {
      verifies++; assert.deepEqual(receipt, receipts.get(receipt.operationId), "Synthetic bytes or receipt changed");
      return structuredClone(receipt);
    }};
  const service = createEditorialVoiceService(deps);
  const path = candidatePath.replace("/synthetic/", `/${before.id}/`);
  const preview = await service.previewEditorialVoiceRegistration({episodeId: before.id, candidatePath: path});
  const request = {episodeId: before.id, candidatePath: path, candidateSha256: preview.candidateSha256,
    snapshotHash: preview.snapshotHash, implementationHash: preview.implementationHash, actor: "human:synthetic",
    reason: "Register synthetic local voice without approving final audio", confirmEditorialVoiceRegistration: true};
  return {...f, deps, candidate, receipts, service, preview, request, counts: () => ({builds, verifies})};
}

test("editorial voice request is closed and rejects unsafe paths, getters and nonhuman authority", () => {
  const request = {episodeId: "synthetic", candidatePath, candidateSha256: h("1"), snapshotHash: h("2"),
    implementationHash: h("3"), actor: "human:synthetic", reason: "Synthetic local registration", confirmEditorialVoiceRegistration: true};
  assert.deepEqual(validateEditorialVoiceRegisterRequest(request), request);
  for (const next of [{...request, render: true}, {...request, actor: "agent:synthetic"},
    {...request, candidatePath: "/tmp/file.json"}, {...request, candidatePath: "outputs/../file.json"},
    {...request, candidatePath: "studio/data/file.json"}, {...request, confirmEditorialVoiceRegistration: false},
    Object.create(request)]) assert.throws(() => validateEditorialVoiceRegisterRequest(next));
  const getter = {...request}; Object.defineProperty(getter, "actor", {enumerable: true, get: () => assert.fail("getter executed")});
  assert.throws(() => validateEditorialVoiceRegisterRequest(getter));
});

test("preview reads only and receipt validation never upgrades measured captions into a video approval", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8");
  assert.equal(f.preview.registrationState, "not_started"); assert.equal(f.preview.renderReady, false);
  assert.equal(f.preview.paidCalls, 0); assert.equal(f.counts().builds, 0); assert.equal(f.events.length, 0);
  const receipt = receiptFor(await f.deps.readEpisode(), f.candidate, f.request);
  assert.deepEqual(validateEditorialVoiceReceipt(receipt), receipt);
  for (const edit of [r => {r.renderReady = true;}, r => {r.audio.durationSeconds = 2;},
    r => {r.audio.path = "outside.wav";}, r => {r.request.reason = "Different request";},
    r => {r.synthesis.speed = 1;}, r => {r.captions.count = 0;}, r => {r.extra = undefined;}]) {
    const next = structuredClone(receipt); edit(next); assert.throws(() => validateEditorialVoiceReceipt(next));
  }
  assert.equal(await readFile(f.episodePath, "utf8"), before);
});

test("one CAS registers voice plus isolated captions while preserving approved storyboard and silent bundle", async t => {
  const f = await setup(t); const before = await f.deps.readEpisode();
  const result = await f.service.registerEditorialVoice(f.request, grant(f.request));
  assert.equal(result.status, "committed"); assert.equal(result.renderReady, false); assert.equal(result.motionAligned, false);
  const after = await f.deps.readEpisode(); const receipt = after.production.editorialVoice;
  assert.equal(after.control.stateVersion, before.control.stateVersion + 1);
  for (const key of ["scenes", "subtitles", "research", "sourceDocs", "assets", "reviewCheckpoints", "control"])
    assert.deepEqual(key === "control" ? {...after.control, stateVersion: before.control.stateVersion} : after[key], before[key], key);
  for (const key of ["scriptDraft", "storyboardDraft", "editorialMaterialization", "assetPlan"])
    assert.deepEqual(after.production[key], before.production[key], key);
  for (const gate of ["research", "script", "storyboard"]) {
    assert.deepEqual(after.approvals[gate], before.approvals[gate]); assert.deepEqual(after.reviews[gate], before.reviews[gate]);
  }
  assert.equal(after.render.durationSeconds, before.render.durationSeconds);
  assert.equal(after.approvals.assets.status, "pending"); assert.equal(after.approvals.final.status, "pending");
  assert.equal(after.pipeline.find(step => step.id === "voice").status, "ready");
  assert.equal(after.pipeline.find(step => step.id === "render").status, "pending");
  assert.deepEqual(after.voice, buildEditorialVoiceRecord(receipt)); assert.equal(editorialVoiceRegistrationValid(after), true);
  assert.equal(f.counts().builds, 1); assert.equal(f.events.length, 1);
});

test("missing, broad, expired, mismatched grants and injectable options cannot write", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8");
  await assert.rejects(f.service.registerEditorialVoice(f.request), e => e.code === "side_effect_capability_missing");
  await assert.rejects(f.service.registerEditorialVoice({...f.request, actor: "human:other"}, grant(f.request)));
  const broad = createCapabilityAuthority({secret: "synthetic-editorial-voice-broad-00000000000000000", maximumCalls: 10, maximumCostUsd: 10});
  for (const change of [{maxCalls: 1}, {maxCostUsd: 1}, {scopes: ["filesystem.write", "state.write", "network.fetch"]}])
    await assert.rejects(f.service.registerEditorialVoice(f.request, {sideEffectGrant: broad.authorize({...editorialVoiceRegisterCapabilitySpec(f.request), ...change})}),
      e => e.code === "editorial_voice_capability_not_zero");
  const getter = {}; Object.defineProperty(getter, "sideEffectGrant", {enumerable: true, get: () => assert.fail("getter executed")});
  for (const options of [{...grant(f.request), writeEpisode: () => {}}, Object.create(grant(f.request)), getter])
    await assert.rejects(f.service.registerEditorialVoice(f.request, options), e => e.code === "editorial_voice_options_invalid");
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.counts().builds, 0);
});

test("first registration refuses stale snapshots, source bindings, invalid gates and busy states", async t => {
  const f = await setup(t); const before = await f.deps.readEpisode();
  for (const key of ["snapshotHash", "candidateSha256", "implementationHash"]) {
    const request = {...f.request, [key]: h("9")};
    await assert.rejects(f.service.registerEditorialVoice(request, grant(request)));
  }
  for (const edit of [e => {e.control.stopRequested = true;}, e => {e.control.activeOperation = {id: "busy", kind: "test", startedAt: iso};},
    e => {e.approvals.storyboard.status = "pending";}, e => {e.voice.audioPath = "old.wav";},
    e => {e.pipeline.find(step => step.id === "voice").status = "running";}, e => {e.pipeline.find(step => step.id === "assets").status = "ready";},
    e => {e.pipeline.push(structuredClone(e.pipeline[0]));}, e => {e.pipeline.reverse();},
    e => {e.pipeline.find(step => step.id === "assets").agent = "voice-agent";}, e => {e.render.outputPath = "old.mp4";},
    e => {e.approvals.assets.status = "approved";}, e => {e.production.editorialMaterialization.manifestSha256 = h("7");}]) {
    const altered = structuredClone(before); edit(altered);
    const service = createEditorialVoiceService({...f.deps, readEpisode: async () => structuredClone(altered), writeEpisode: async () => assert.fail("invalid transition wrote")});
    await assert.rejects(service.registerEditorialVoice(f.request, grant(f.request)));
  }
  assert.deepEqual(await f.deps.readEpisode(), before); assert.equal(f.counts().builds, 0);
});

test("source change during materialization and corrupt post-copy receipt fail before CAS", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8"); let changed = false;
  const service = createEditorialVoiceService({...f.deps,
    inspectCandidate: async () => ({...f.candidate, ...(changed ? {implementationHash: h("8")} : {})}),
    materializeCandidate: async args => {const receipt = await f.deps.materializeCandidate(args); changed = true; return receipt;}});
  await assert.rejects(service.registerEditorialVoice(f.request, grant(f.request)));
  const corrupt = createEditorialVoiceService({...f.deps, verifyRegistered: async ({receipt}) => ({...receipt, renderReady: true})});
  await assert.rejects(corrupt.registerEditorialVoice(f.request, grant(f.request)));
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.events.length, 0);
});

test("pre-CAS failure preserves candidate and exact retry registers once; post-CAS audit warning is repairable", async t => {
  const f = await setup(t); const before = await readFile(f.episodePath, "utf8");
  const fail = createEditorialVoiceService({...f.deps, writeEpisode: async () => {throw new Error("Synthetic CAS rejection");}});
  await assert.rejects(fail.registerEditorialVoice(f.request, grant(f.request)), /Synthetic CAS rejection/u);
  assert.equal(await readFile(f.episodePath, "utf8"), before); assert.equal(f.receipts.size, 1);
  const warning = createEditorialVoiceService({...f.deps, appendEvent: async () => {throw new Error("Synthetic audit failure");}});
  assert.equal((await warning.registerEditorialVoice(f.request, grant(f.request))).status, "committed_with_warning");
  const later = await f.deps.readEpisode(); later.pipeline.find(step => step.id === "voice").message = "Later local review note";
  await f.deps.writeEpisode(later); const saved = await readFile(f.episodePath, "utf8"); const count = f.counts().builds;
  const retry = createEditorialVoiceService({...f.deps, writeEpisode: async () => assert.fail("retry reset state"), materializeCandidate: async () => assert.fail("retry rebuilt")});
  assert.equal((await retry.registerEditorialVoice(f.request, grant(f.request))).status, "already_committed");
  assert.equal((await retry.previewEditorialVoiceRegistration({episodeId: f.request.episodeId, candidatePath: f.request.candidatePath})).registrationState, "already_registered");
  assert.equal(await readFile(f.episodePath, "utf8"), saved); assert.equal(f.counts().builds, count);
  const changed = {...f.request, reason: "Different request cannot replace registration"};
  await assert.rejects(retry.registerEditorialVoice(changed, grant(changed)), e => e.code === "editorial_voice_conflict");
});

test("grant expiring during final byte verification cannot commit and fresh grant recovers", async t => {
  const f = await setup(t); let clock = 1800000000000;
  const auth = createCapabilityAuthority({secret: "synthetic-editorial-voice-expiry-0000000000000000", now: () => clock, defaultTtlMs: 300000, maximumTtlMs: 300000});
  const service = createEditorialVoiceService({...f.deps, verifyRegistered: async args => {
    const receipt = await f.deps.verifyRegistered(args); clock += 300001; return receipt;
  }});
  const before = await readFile(f.episodePath, "utf8");
  await assert.rejects(service.registerEditorialVoice(f.request, {sideEffectGrant: auth.authorize(editorialVoiceRegisterCapabilitySpec(f.request))}),
    e => e.code === "side_effect_capability_expired");
  assert.equal(await readFile(f.episodePath, "utf8"), before);
  assert.equal((await f.service.registerEditorialVoice(f.request, grant(f.request))).status, "committed");
});

test("independent process CAS race cannot overwrite state or delete a completed immutable package", async t => {
  const f = await setup(t); const before = await f.deps.readEpisode();
  const racing = createEditorialVoiceService({...f.deps, writeEpisode: async candidate => {
    const moduleUrl = new URL("../src/shared/episode-store-writer-core.mjs", import.meta.url).href;
    await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", `
      import {readFile} from 'node:fs/promises'; import {dirname} from 'node:path';
      const {createEpisodeWriterCore}=await import(${JSON.stringify(moduleUrl)});
      const episodePath=process.argv[1];
      const writer=createEpisodeWriterCore({episodeDataDirectory:()=>dirname(episodePath),episodeDataPath:()=>episodePath});
      const value=JSON.parse(await readFile(episodePath,'utf8'));value.title='Synthetic independent writer update';
      await writer.writeEpisode(value);
    `, f.episodePath]);
    return f.deps.writeEpisode(candidate);
  }});
  await assert.rejects(racing.registerEditorialVoice(f.request, grant(f.request)), e => e.code === "state_version_conflict");
  const after = await f.deps.readEpisode();
  assert.equal(after.title, "Synthetic independent writer update"); assert.equal(after.production.editorialVoice, undefined);
  assert.deepEqual(after.voice, before.voice); assert.equal(after.control.stateVersion, before.control.stateVersion + 1);
  assert.equal(f.receipts.size, 1); assert.equal(f.events.length, 0);
});

test("already-registered retry revalidates immutable receipt/media while permitting later notes without rewriting", async t => {
  const f = await setup(t); await f.service.registerEditorialVoice(f.request, grant(f.request));
  const before = await f.deps.readEpisode();
  for (const edit of [e => {e.voice.sha256 = h("8");}, e => {e.voice.mode = "uploaded-recording";},
    e => {e.production.editorialVoice.captions.sha256 = h("8");}, e => {e.voice.authorization.assetsVoiceAccepted = true;},
    e => {e.voice.provenance.synthesis.speed = 1.2;}, e => {e.production.editorialVoice.source.scriptBindingHash = h("8");}]) {
    const altered = structuredClone(before); edit(altered);
    const retry = createEditorialVoiceService({...f.deps, readEpisode: async () => altered,
      writeEpisode: async () => assert.fail("tampered receipt reset state")});
    await assert.rejects(retry.registerEditorialVoice(f.request, grant(f.request)));
  }
  const allowed = structuredClone(before); allowed.voice.note = "Human review requested a later revision"; allowed.voice.needsRevision = true;
  assert.equal(editorialVoiceRegistrationValid(allowed), true);
  assert.equal(editorialVoiceRegistrationValid({...allowed, voice: {...allowed.voice, unexpected: true}}), false);
  const corruptFiles = createEditorialVoiceService({...f.deps, verifyRegistered: async () => {throw new Error("Synthetic registered WAV bytes changed");}});
  await assert.rejects(corruptFiles.registerEditorialVoice(f.request, grant(f.request)), /WAV bytes changed/u);
  assert.deepEqual(await f.deps.readEpisode(), before);
});

test("per-episode operation lock rejects parallel registration and releases after failure", async t => {
  const f = await setup(t); let unblock; let entered;
  const ready = new Promise(resolve => {entered = resolve;});
  const barrier = new Promise(resolve => {unblock = resolve;});
  const blocked = createEditorialVoiceService({...f.deps, materializeCandidate: async () => {
    entered(); await barrier; throw new Error("Synthetic interrupted copy");
  }});
  const first = blocked.registerEditorialVoice(f.request, grant(f.request));
  const failure = assert.rejects(first, /Synthetic interrupted copy/u);
  await ready;
  await assert.rejects(f.service.registerEditorialVoice(f.request, grant(f.request)), e => e.code === "episode_operation_active");
  unblock(); await failure;
  assert.equal((await f.service.registerEditorialVoice(f.request, grant(f.request))).status, "committed");
});
