import test from "node:test";
import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import * as generation from "../src/server/production/editorial-voice-generation.mjs";
import {parseEditorialVoiceGenerationArguments} from "../scripts/generate-editorial-voice.mjs";
import {approvedStoryboardFixture} from "./approved-storyboard-fixture.mjs";
import {assertEditorialFirstVoiceRegistration} from "../src/server/control/editorial-voice-transition.mjs";
import {createCapabilityAuthority, requireSideEffectGrant} from "../src/server/security/side-effect-capability.mjs";

const h = value => value.repeat(64);
const args = ["--episode", "synthetic", "--audition-request", "outputs/synthetic/audition-request.json",
  "--selection", "outputs/synthetic/selection.json"];

test("generation CLI defaults to read-only preview and explicit confirmation binds an exact request hash", () => {
  assert.deepEqual(parseEditorialVoiceGenerationArguments(args), {episodeId: "synthetic",
    auditionRequestPath: "outputs/synthetic/audition-request.json", selectionPath: "outputs/synthetic/selection.json"});
  const confirmed = parseEditorialVoiceGenerationArguments([...args, "--request-hash", h("a"), "--confirm-local-full-voice"]);
  assert.equal(confirmed.confirm, true); assert.equal(confirmed.requestHash, h("a"));
  for (const input of [null, {}, [1], [], args.slice(0, -1), [...args, "--confirm-local-full-voice"],
    [...args, "--request-hash", h("a")], [...args, "--episode", "other"], [...args, "--provider", "remote"],
    [...args, "--workspace-root", "/tmp/synthetic"], [...args, "--model", "another"],
    [...args, "--request-hash", "not-a-hash", "--confirm-local-full-voice"],
    [...args, "--request-hash", h("a"), "--confirm-local-full-voice", "--confirm-local-full-voice"],
    ["--episode", "synthetic\n", ...args.slice(2)]]) {
    assert.throws(() => parseEditorialVoiceGenerationArguments(input));
  }
});

test("generation CLI argument boundary rejects array-like objects and escaping or non-output JSON paths", () => {
  const arrayLike = {length: args.length, ...Object.fromEntries(args.map((arg, index) => [index, arg]))};
  assert.throws(() => parseEditorialVoiceGenerationArguments(arrayLike));
  for (const path of ["/tmp/selection.json", "outputs/../private.json", "outputs//selection.json",
    "outputs/./selection.json", "studio/data/selection.json", "outputs/selection.txt", "outputs/synthetic\\selection.json"]) {
    assert.throws(() => parseEditorialVoiceGenerationArguments([...args.slice(0, -1), path]));
  }
});

test("generation module cannot expose a raw subprocess execution sink", () => {
  assert.equal(Object.hasOwn(generation, "runEditorialVoiceDriver"), false);
  assert.deepEqual(Object.keys(generation).sort(), ["editorialVoiceGenerationCapabilitySpec",
    "generateEditorialVoiceCandidate", "previewEditorialVoiceGeneration"].sort());
});

test("generation capability binds a single candidate and excludes other side-effect sinks", () => {
  const preview = {generationRequestHash: h("a")};
  const spec = generation.editorialVoiceGenerationCapabilitySpec(preview);
  assert.deepEqual(spec, {episodeId: `editorial-voice-generation/${h("a")}`, operation: "voice:generate-editorial",
    scopes: ["filesystem.write", "local-inference"], maxCalls: 0, maxCostUsd: 0});
  const auth = createCapabilityAuthority({secret: "synthetic-generation-capability-0000000000000000000"});
  const grant = auth.authorize(spec);
  assert.equal(requireSideEffectGrant({sideEffectGrant: grant}, spec, "voice:generate-editorial").maxCalls, 0);
  assert.throws(() => requireSideEffectGrant({}, spec, "voice:generate-editorial"), e => e.code === "side_effect_capability_missing");
  assert.throws(() => requireSideEffectGrant({sideEffectGrant: grant}, spec, "voice:register-editorial"), e => e.code === "editorial_voice_sink_forbidden");
  assert.throws(() => requireSideEffectGrant({sideEffectGrant: grant}, {...spec,
    episodeId: `editorial-voice-generation/${h("b")}`}, "voice:generate-editorial"));
  assert.throws(() => generation.editorialVoiceGenerationCapabilitySpec({generationRequestHash: "bad"}));
  let clock = 1800000000000;
  const expiring = createCapabilityAuthority({secret: "synthetic-generation-expiry-00000000000000000000000",
    now: () => clock, defaultTtlMs: 300000, maximumTtlMs: 300000});
  const expires = expiring.authorize(spec); clock += 300001;
  assert.throws(() => requireSideEffectGrant({sideEffectGrant: expires}, spec, "voice:generate-editorial"), e => e.code === "side_effect_capability_expired");
});

async function readyFixture(t) {
  const f = await approvedStoryboardFixture(t);
  const episode = await f.deps.readEpisode();
  for (const id of ["storyboard", "assets"]) Object.assign(episode.pipeline.find(step => step.id === id),
    {status: "complete", requiresApproval: null, requiresHuman: false});
  Object.assign(episode.pipeline.find(step => step.id === "voice"), {status: "ready", requiresApproval: null, requiresHuman: false});
  episode.production.editorialMaterialization = {schemaVersion: "editorial-materialization-receipt-v1",
    episodeId: episode.id, manifestSha256: h("a"), rendered: false, voiceStatus: "deferred"};
  assert.doesNotThrow(() => assertEditorialFirstVoiceRegistration(episode));
  return {...f, episode, input: {episodeId: episode.id,
    auditionRequestPath: "outputs/synthetic/audition-request.json", selectionPath: "outputs/synthetic/selection.json"}};
}

test("stopped, busy, running or already configured voice is rejected before resolving roots or reading source files", async t => {
  const f = await readyFixture(t); const original = structuredClone(f.episode);
  const bytes = await readFile(f.episodePath, "utf8"); const files = await readdir(f.root);
  const changes = [e => {e.control.stopRequested = true;},
    e => {e.control.activeOperation = {id: "synthetic-running", kind: "worker", startedAt: "2026-09-17T00:00:00.000Z"};},
    e => {e.pipeline.find(step => step.id === "voice").status = "running";},
    e => {e.pipeline.find(step => step.id === "assets").status = "ready";},
    e => {e.voice = {status: "ready", mode: "uploaded-recording", audioPath: "synthetic-voice.wav", version: 1};},
    e => {e.approvals.storyboard.status = "pending";}];
  for (const change of changes) {
    const episode = structuredClone(original); change(episode);
    // Null deliberately makes path.resolve fail if root IO precedes the pure
    // workflow rejection. No audition, installed model or subprocess is needed.
    await assert.rejects(generation.previewEditorialVoiceGeneration({workspaceRoot: null, episode,
      reviewConfig: f.config, input: f.input}), e => e.code === "editorial_voice_transition_invalid");
  }
  assert.deepEqual(f.episode, original); assert.equal(await readFile(f.episodePath, "utf8"), bytes);
  assert.deepEqual(await readdir(f.root), files); assert.equal(f.events.length, 0);
});

test("generation rejects stopped state before any output directory, TTS process or state mutation", async t => {
  const f = await readyFixture(t); f.episode.control.stopRequested = true;
  const before = await readdir(f.root); const bytes = await readFile(f.episodePath, "utf8");
  const preview = {generationRequestHash: h("a"), input: f.input};
  let reads = 0;
  await assert.rejects(generation.generateEditorialVoiceCandidate({workspaceRoot: f.root, preview,
    readCurrent: async () => {reads++; return {episode: structuredClone(f.episode), reviewConfig: f.config};},
    onProgress: () => assert.fail("rejected state started a subprocess")}), e => e.code === "editorial_voice_transition_invalid");
  assert.equal(reads, 1); assert.deepEqual(await readdir(f.root), before);
  assert.equal(await readFile(f.episodePath, "utf8"), bytes); assert.equal(f.events.length, 0);
});
