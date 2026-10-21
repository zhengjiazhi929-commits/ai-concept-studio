import test from "node:test";
import assert from "node:assert/strict";
import {parseEditorialVoiceRegisterArguments, runEditorialVoiceRegisterCli,
  reportEditorialVoiceRegisterCli} from "../scripts/register-editorial-voice.mjs";
import {editorialVoiceRegisterCapabilitySpec} from "../src/shared/editorial-voice-register-request.mjs";
import {assertSideEffectGrant} from "../src/server/security/side-effect-capability.mjs";

const candidatePath = `outputs/studio/synthetic/editorial-voice-candidates/${"a".repeat(64)}/voice-manifest.json`;
const previewArgs = ["--episode", "synthetic", "--candidate", candidatePath];
const registerArgs = [...previewArgs, "--candidate-hash", "b".repeat(64), "--snapshot", "c".repeat(64),
  "--implementation-hash", "d".repeat(64), "--actor", "human:synthetic",
  "--reason", "Register synthetic local voice only", "--confirm-editorial-voice-registration"];

test("editorial voice CLI defaults to read-only preview with exact candidate binding", async () => {
  const parsed = parseEditorialVoiceRegisterArguments(previewArgs);
  assert.equal(parsed.mode, "preview");
  assert.deepEqual(parsed.request, {episodeId: "synthetic", candidatePath});
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.request), true);
  assert.deepEqual(parseEditorialVoiceRegisterArguments(["--", ...previewArgs]), parsed);
  const result = await runEditorialVoiceRegisterCli(previewArgs, {
    preview: async request => ({...request, readOnly: true}),
    register: async () => assert.fail("preview mutated")
  });
  assert.deepEqual(result, {ok: true, mode: "preview", preview: {...parsed.request, readOnly: true}});
});

test("editorial voice registration CLI grants exact zero-cost zero-call capability for ten minutes", async () => {
  const parsed = parseEditorialVoiceRegisterArguments(registerArgs);
  assert.equal(parsed.mode, "register");
  assert.equal(parsed.request.candidateSha256, "b".repeat(64));
  assert.equal(parsed.request.confirmEditorialVoiceRegistration, true);
  const result = await runEditorialVoiceRegisterCli(registerArgs, {
    preview: async () => assert.fail("registration used preview instead"),
    register: async (request, options) => {
      assert.deepEqual(request, parsed.request);
      assert.equal(Object.isFrozen(request), true);
      assert.equal(Object.isFrozen(options), true);
      assert.deepEqual(Object.keys(options), ["sideEffectGrant"]);
      const claims = assertSideEffectGrant(options.sideEffectGrant, editorialVoiceRegisterCapabilitySpec(request));
      assert.equal(claims.maxCalls, 0);
      assert.equal(claims.maxCostUsd, 0);
      assert.equal(Date.parse(claims.expiresAt) - Date.parse(claims.issuedAt), 600000);
      assert.deepEqual([...claims.scopes].sort(), ["filesystem.write", "state.write"]);
      assert.throws(() => assertSideEffectGrant(options.sideEffectGrant,
        editorialVoiceRegisterCapabilitySpec({...request, candidateSha256: "e".repeat(64)})));
      return {status: "synthetic"};
    }
  });
  assert.deepEqual(result, {ok: true, mode: "registered", result: {status: "synthetic"}});
});

test("editorial voice CLI rejects incomplete bindings, duplicates, path escapes and unknown flags", () => {
  const invalidArgs = [null, {}, [1], [], previewArgs.slice(0, 2), registerArgs.slice(0, -1),
    [...registerArgs, "--episode", "other"], [...registerArgs, "--candidate", candidatePath],
    [...registerArgs, "--confirm-editorial-voice-registration"], [...previewArgs, "--provider", "fake"],
    [...previewArgs, "--workspace-root", "/synthetic"], [...previewArgs, "--snapshot"],
    [...previewArgs, "--actor", "human:synthetic"], ["--", "--", ...previewArgs],
    ["--episode", "synthetic", "--candidate", "../voice-manifest.json"],
    ["--episode", "other", "--candidate", candidatePath],
    ["--episode", "synthetic\n", "--candidate", candidatePath],
    [...previewArgs, "--reason", "-invalid"], [...previewArgs, "--reason", "   "]];
  for (const input of invalidArgs) assert.throws(() => parseEditorialVoiceRegisterArguments(input));
});

test("editorial voice CLI rejects injected authority, roots, accessors and inherited dependencies", async () => {
  const deps = [null, [], {root: "/synthetic"}, {authorize: () => {}}, {register: null},
    Object.create({preview: () => {}}), {[Symbol("injected")]: () => {}}];
  const getter = {};
  let getterCalls = 0;
  Object.defineProperty(getter, "preview", {enumerable: true, get: () => {
    getterCalls += 1;
    assert.fail("getter executed");
  }});
  const hidden = {};
  Object.defineProperty(hidden, "preview", {enumerable: false, value: () => {}});
  for (const input of [...deps, getter, hidden]) await assert.rejects(runEditorialVoiceRegisterCli(previewArgs, input));
  assert.equal(getterCalls, 0, "rejection must not invoke a dependency accessor");
});

test("editorial voice CLI reports redacted errors without claiming a failed registration completed", async () => {
  const messages = [];
  const originalError = console.error;
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.error = value => messages.push(["error", value]);
  console.log = value => messages.push(["log", value]);
  try {
    await reportEditorialVoiceRegisterCli(async () => { throw new Error("SYNTHETIC_PRIVATE_PATH_AND_TOKEN"); });
    assert.equal(process.exitCode, 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0][0], "error");
    const error = JSON.parse(messages[0][1]);
    assert.equal(error.ok, false);
    assert.equal(error.code, "editorial_voice_registration_cli_failed");
    assert.doesNotMatch(messages[0][1], /SYNTHETIC_PRIVATE_PATH_AND_TOKEN/u);
    await reportEditorialVoiceRegisterCli(async () => ({ok: true, mode: "preview", preview: {readOnly: true}}));
    assert.equal(messages[1][0], "log");
    assert.equal(JSON.parse(messages[1][1]).mode, "preview");
  } finally {
    console.error = originalError;
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }
});
