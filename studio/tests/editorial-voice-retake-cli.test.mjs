import test from "node:test";
import assert from "node:assert/strict";
import {parseEditorialVoiceRetakeArguments, runEditorialVoiceRetakeCli} from "../scripts/retake-editorial-voice.mjs";
import {assertSideEffectGrant} from "../src/server/security/side-effect-capability.mjs";
import {editorialVoiceRetakeCapabilitySpec} from "../src/shared/editorial-voice-retake-request.mjs";
const hash = char => char.repeat(64);
const preview = ["--episode", "synthetic", "--base-candidate", `outputs/studio/synthetic/editorial-voice-candidates/${hash("a")}/voice-manifest.json`,
  "--base-hash", hash("b"), "--repair-plan", "outputs/synthetic/repair.json", "--repair-hash", hash("c")];
const run = [...preview, "--snapshot", hash("d"), "--implementation-hash", hash("e"), "--source-hash", hash("f"),
  "--actor", "human:Zhengjiazhi", "--reason", "Reuse unchanged parent audio and retake long phrases", "--confirm-local-retake"];

test("retake CLI defaults to preview and requires every exact binding for execution", async () => {
  assert.equal(parseEditorialVoiceRetakeArguments(preview).mode, "preview");
  assert.equal(parseEditorialVoiceRetakeArguments(run).mode, "retake");
  const result = await runEditorialVoiceRetakeCli(preview, {preview: async input => ({episodeId: input.episodeId}),
    retake: async () => assert.fail("preview invoked generation")});
  assert.deepEqual(result, {ok: true, mode: "preview", result: {episodeId: "synthetic"}});
  await runEditorialVoiceRetakeCli(run, {retake: async (request, options) => {
    const claims = assertSideEffectGrant(options.sideEffectGrant, editorialVoiceRetakeCapabilitySpec(request));
    assert.equal(claims.maxCalls, 0); assert.equal(claims.maxCostUsd, 0);
    assert.deepEqual([...claims.scopes].sort(), ["filesystem.write", "local-inference"]);
    assert.equal(Date.parse(claims.expiresAt) - Date.parse(claims.issuedAt), 2100000);
    return {registered: false};
  }});
});

test("retake CLI rejects incomplete, duplicate, broadened and unsafe input", () => {
  for (const args of [null, {}, [], [1], run.slice(0, -1), [...preview, "--confirm-local-retake"],
    [...run, "--confirm-local-retake"], [...run, "--episode", "other"], [...preview, "--provider", "online"],
    [...preview, "--workspace-root", "/tmp"], [...preview, "--actor", "human:Zhengjiazhi"],
    preview.map(arg => arg === "outputs/synthetic/repair.json" ? "outputs/../repair.json" : arg),
    preview.map(arg => arg === hash("b") ? "bad" : arg)]) assert.throws(() => parseEditorialVoiceRetakeArguments(args));
});

test("retake CLI cannot inject roots, custom authority, getters or inherited dependency overrides", async () => {
  const getter = {}; Object.defineProperty(getter, "preview", {enumerable: true, get: () => assert.fail("getter executed")});
  for (const deps of [null, [], {workspaceRoot: "/tmp"}, {authorize: () => {}}, Object.create({preview: () => {}}), getter]) {
    await assert.rejects(runEditorialVoiceRetakeCli(preview, deps));
  }
});
