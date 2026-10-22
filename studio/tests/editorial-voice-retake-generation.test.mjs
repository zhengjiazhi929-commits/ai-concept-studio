import test from "node:test";
import assert from "node:assert/strict";
import {approvedStoryboardFixture} from "./approved-storyboard-fixture.mjs";
import {buildEditorialVoiceSpeechPlan, buildEditorialVoiceTiming} from "../src/shared/editorial-voice-timing.mjs";
import {canonicalJsonDocumentContentSha256 as digest} from "../src/shared/durable-json-store.mjs";
import {createCapabilityAuthority} from "../src/server/security/side-effect-capability.mjs";
import {validateEditorialVoiceRetakePreview, validateEditorialVoiceRetakeRequest,
  editorialVoiceRetakeCapabilitySpec} from "../src/shared/editorial-voice-retake-request.mjs";
import {createEditorialVoiceRetakeService} from "../src/server/production/editorial-voice-retake-core.mjs";

const h = char => char.repeat(64);
const auth = () => createCapabilityAuthority({secret: "synthetic-retake-capability-000000000000000000000"});
const grant = request => ({sideEffectGrant: auth().authorize(editorialVoiceRetakeCapabilitySpec(request))});
async function setup(t) {
  const f = await approvedStoryboardFixture(t);
  const episode = await f.deps.readEpisode();
  for (const id of ["storyboard", "assets"]) Object.assign(episode.pipeline.find(step => step.id === id),
    {status: "complete", requiresApproval: null, requiresHuman: false});
  Object.assign(episode.pipeline.find(step => step.id === "voice"), {status: "ready", requiresApproval: null, requiresHuman: false});
  episode.production.editorialMaterialization = {schemaVersion: "editorial-materialization-receipt-v1",
    episodeId: episode.id, manifestSha256: h("a"), rendered: false, voiceStatus: "deferred"};
  await f.deps.writeEpisode(episode); f.events.length = 0;
  const input = {episodeId: episode.id,
    baseCandidatePath: `outputs/studio/${episode.id}/editorial-voice-candidates/${h("a")}/voice-manifest.json`,
    baseCandidateSha256: h("b"), repairPlanPath: `outputs/studio/${episode.id}/retake-repair.json`, repairPlanSha256: h("c")};
  const source = {scriptBindingHash: h("d"), storyboardBindingHash: h("e"), materializationManifestSha256: h("a")};
  const basePlan = buildEditorialVoiceSpeechPlan([{id: "S01", unitIds: ["U01"], narration: "先理解上下文工程，再去设计记忆系统。"}]);
  const timing = buildEditorialVoiceTiming(basePlan, [{id: "speech-0001", sampleCount: 144000}]);
  const repairPlan = {schemaVersion: "editorial-voice-repair-plan-v1",
    baseCandidate: {path: input.baseCandidatePath, sha256: input.baseCandidateSha256}, repairs: [{id: "speech-0001",
      parts: ["先理解上下文工程，", "再去设计记忆系统。"].map(text => ({text, textSha256: null}))}]};
  const {createHash} = await import("node:crypto");
  repairPlan.repairs[0].parts.forEach(part => {part.textSha256 = createHash("sha256").update(part.text).digest("hex");});
  const base = {candidateSha256: input.baseCandidateSha256, source, implementationHash: h("f"), basePlan,
    timing, manifest: {synthesis: {voiceId: "zm_010", speed: 1.1}}, driverRequest: {}, files: [], directory: "synthetic"};
  let generated = 0; let verified = 0;
  const deps = {...f.deps, inspectBase: async () => structuredClone(base),
    readRepairPlan: async () => ({value: structuredClone(repairPlan), record: {path: input.repairPlanPath, bytes: 600, sha256: input.repairPlanSha256}}),
    prepareDriver: async ({retakePlan}) => ({basePlan, baseTiming: timing, repairPlan, retakePlan,
      baseMedia: {path: "/synthetic/media", files: []}, model: {}, pinnedFiles: {}, runtimeLock: {}, retakeDriverPin: {}}),
    generateCandidate: async ({preview, request}) => {
      generated++; return {candidatePath: `outputs/studio/${episode.id}/editorial-voice-candidates/${digest(request)}/voice-manifest.json`,
        candidateSha256: h("1"), source: preview.source, implementationHash: preview.implementationHash, registered: false, rendered: false};
    },
    verifyCandidate: async () => {verified++; return {candidateSha256: h("1"), source, implementationHash: h("f")};}};
  const service = createEditorialVoiceRetakeService(deps);
  const preview = await service.previewEditorialVoiceRetake(input);
  const request = {...input, snapshotHash: preview.snapshotHash, implementationHash: preview.implementationHash,
    sourceHash: preview.sourceHash, actor: "human:Zhengjiazhi", reason: "Repair only measured long captions with unchanged voice",
    confirmEditorialVoiceRetake: true};
  return {...f, deps, service, preview, request, input, base, repairPlan, counts: () => ({generated, verified})};
}

test("retake request is closed and binds current base, repair, source, implementation and human confirmation", () => {
  const input = {episodeId: "synthetic", baseCandidatePath: `outputs/studio/synthetic/editorial-voice-candidates/${h("a")}/voice-manifest.json`,
    baseCandidateSha256: h("b"), repairPlanPath: "outputs/synthetic/repair.json", repairPlanSha256: h("c")};
  const request = {...input, snapshotHash: h("d"), sourceHash: h("e"), implementationHash: h("f"),
    actor: "human:Zhengjiazhi", reason: "Synthetic retakes only", confirmEditorialVoiceRetake: true};
  assert.deepEqual(validateEditorialVoiceRetakePreview(input), input); assert.deepEqual(validateEditorialVoiceRetakeRequest(request), request);
  for (const edit of [r => {r.render = true;}, r => {r.repairPlanPath = "outputs/../escape.json";},
    r => {r.baseCandidatePath = r.baseCandidatePath.replace("/synthetic/", "/other/");},
    r => {r.baseCandidatePath = r.baseCandidatePath.replace("/editorial-voice-candidates/", "/editorial-voice-candidates/nested/");},
    r => {r.confirmEditorialVoiceRetake = false;}, r => {r.actor = "human:Other";}, r => {r.actor = "agent:fake";}]) {
    const next = structuredClone(request); edit(next); assert.throws(() => validateEditorialVoiceRetakeRequest(next));
  }
  let getterCalls = 0;
  const getter = {...request}; Object.defineProperty(getter, "sourceHash", {enumerable: true, get: () => {
    getterCalls += 1;
    assert.fail("getter executed");
  }});
  assert.throws(() => validateEditorialVoiceRetakeRequest(getter));
  assert.equal(getterCalls, 0, "rejection must not invoke a request accessor");
});

test("retake preview reads only and execution does not register, retime or approve the episode", async t => {
  const f = await setup(t); const before = await f.deps.readEpisode();
  assert.equal(f.preview.retakeParentCount, 1); assert.equal(f.preview.reuseParentCount, 0);
  assert.equal(f.counts().generated, 0); assert.equal(f.preview.registered, false);
  const result = await f.service.retakeEditorialVoice(f.request, grant(f.request));
  assert.equal(result.registered, false); assert.equal(result.rendered, false); assert.equal(f.counts().generated, 1);
  assert.equal(f.counts().verified, 1); assert.deepEqual(await f.deps.readEpisode(), before); assert.equal(f.events.length, 0);
});

test("retake missing, broad, wrong and expired capabilities fail before generating any files", async t => {
  const f = await setup(t);
  await assert.rejects(f.service.retakeEditorialVoice(f.request), e => e.code === "side_effect_capability_missing");
  await assert.rejects(f.service.retakeEditorialVoice({...f.request, reason: "Different exact request"}, grant(f.request)));
  const broad = createCapabilityAuthority({secret: "synthetic-retake-broad-00000000000000000000000000", maximumCalls: 10, maximumCostUsd: 10});
  for (const extra of [{maxCalls: 1}, {maxCostUsd: 1}, {scopes: ["filesystem.write", "local-inference", "network.fetch"]}]) {
    await assert.rejects(f.service.retakeEditorialVoice(f.request, {sideEffectGrant: broad.authorize({...editorialVoiceRetakeCapabilitySpec(f.request), ...extra})}),
      e => e.code === "editorial_voice_retake_capability_not_zero");
  }
  let time = 1800000000000;
  const expiring = createCapabilityAuthority({secret: "synthetic-retake-expiry-0000000000000000000000000", now: () => time});
  const token = expiring.authorize(editorialVoiceRetakeCapabilitySpec(f.request)); time += 400000;
  await assert.rejects(f.service.retakeEditorialVoice(f.request, {sideEffectGrant: token}), e => e.code === "side_effect_capability_expired");
  assert.equal(f.counts().generated, 0);
});

test("retake source or base drift and unapproved stopped states cannot invoke generation", async t => {
  const f = await setup(t); const before = await f.deps.readEpisode();
  for (const key of ["snapshotHash", "sourceHash", "implementationHash", "baseCandidateSha256", "repairPlanSha256"]) {
    const request = {...f.request, [key]: h("9")}; await assert.rejects(f.service.retakeEditorialVoice(request, grant(request)));
  }
  const stopped = structuredClone(before); stopped.control.stopRequested = true;
  const service = createEditorialVoiceRetakeService({...f.deps, readEpisode: async () => stopped,
    inspectBase: async () => assert.fail("stopped operation inspected source")});
  await assert.rejects(service.previewEditorialVoiceRetake(f.input)); assert.equal(f.counts().generated, 0);
});

test("retake source drift after local synthesis keeps candidate unregistered and returns failure", async t => {
  const f = await setup(t); const before = await f.deps.readEpisode(); let changed = false;
  const service = createEditorialVoiceRetakeService({...f.deps,
    inspectBase: async () => ({...f.base, ...(changed ? {implementationHash: h("8")} : {})}),
    generateCandidate: async args => {const value = await f.deps.generateCandidate(args); changed = true; return value;}});
  await assert.rejects(service.retakeEditorialVoice(f.request, grant(f.request)), e => e.code === "editorial_voice_retake_snapshot_changed");
  assert.equal(f.counts().generated, 1); assert.equal(f.counts().verified, 0);
  assert.deepEqual(await f.deps.readEpisode(), before); assert.equal(f.events.length, 0);
});

test("production retake exports no raw sink or dependency-injected source adapter", async () => {
  const generation = await import("../src/server/production/editorial-voice-retake-generation.mjs");
  const wrapper = await import("../src/server/production/editorial-voice-retake.mjs");
  for (const module of [generation, wrapper]) {
    assert.deepEqual(Object.keys(module).sort(), ["previewEditorialVoiceRetake", "retakeEditorialVoice"]);
    assert.throws(() => module.previewEditorialVoiceRetake({}, {workspaceRoot: "/tmp"}));
    assert.throws(() => module.retakeEditorialVoice({}, {}, {readCurrent: () => ({})}));
  }
});

test("retake expiry during source verification fails before local inference", async t => {
  const f = await setup(t); let time = 1800000000000;
  const authority = createCapabilityAuthority({secret: "synthetic-retake-async-expiry-000000000000000000", now: () => time});
  const token = authority.authorize(editorialVoiceRetakeCapabilitySpec(f.request));
  const service = createEditorialVoiceRetakeService({...f.deps,
    inspectBase: async args => {const value = await f.deps.inspectBase(args); time += 400000; return value;}});
  await assert.rejects(service.retakeEditorialVoice(f.request, {sideEffectGrant: token}), e => e.code === "side_effect_capability_expired");
  assert.equal(f.counts().generated, 0);
});

test("retake expiry during final candidate verification cannot report completion", async t => {
  const f = await setup(t); const before = await f.deps.readEpisode(); let time = 1800000000000;
  const authority = createCapabilityAuthority({secret: "synthetic-retake-final-expiry-000000000000000000", now: () => time});
  const token = authority.authorize(editorialVoiceRetakeCapabilitySpec(f.request));
  const service = createEditorialVoiceRetakeService({...f.deps,
    verifyCandidate: async args => {const value = await f.deps.verifyCandidate(args); time += 400000; return value;}});
  await assert.rejects(service.retakeEditorialVoice(f.request, {sideEffectGrant: token}), e => e.code === "side_effect_capability_expired");
  assert.equal(f.counts().generated, 1); assert.equal(f.counts().verified, 1);
  assert.deepEqual(await f.deps.readEpisode(), before); assert.equal(f.events.length, 0);
});
