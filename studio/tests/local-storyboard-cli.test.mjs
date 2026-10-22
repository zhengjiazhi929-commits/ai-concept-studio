import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  parseLocalStoryboardArguments,
  reportLocalStoryboardCli,
  runLocalStoryboardCli
} from "../scripts/import-local-storyboard.mjs";
import { localStoryboardCapabilitySpec } from "../src/shared/local-storyboard-import-request.mjs";
import {
  consumeSideEffectGrantUsage,
  requireSideEffectGrant
} from "../src/server/security/side-effect-capability.mjs";

const request = Object.freeze({
  episodeId: "storyboard-cli-synthetic",
  candidatePath: "outputs/synthetic-only/storyboard.json",
  candidateSha256: "a".repeat(64),
  snapshotHash: "b".repeat(64),
  actor: "human:fixture",
  reason: "Import only the bound synthetic editorial plan",
  confirmLocalStoryboardImport: true
});
const previewRequest = Object.freeze({ episodeId: request.episodeId, candidatePath: request.candidatePath });
const previewArgs = ["--episode", request.episodeId, "--candidate", request.candidatePath];
const argsFor = (value = request) => [
  "--episode", value.episodeId,
  "--candidate", value.candidatePath,
  "--candidate-sha256", value.candidateSha256,
  "--snapshot", value.snapshotHash,
  "--actor", value.actor,
  "--reason", value.reason,
  "--confirm-local-storyboard-import"
];
const hasCode = code => error => error.code === code;

test("default CLI preview receives no grant and never enters the write dependency", async () => {
  let calls = 0;
  const snapshot = { candidateSha256: request.candidateSha256, snapshotHash: request.snapshotHash };
  const result = await runLocalStoryboardCli(previewArgs, {
    preview: async (...values) => {
      calls++;
      assert.deepEqual(values, [previewRequest]);
      assert.equal(Object.isFrozen(values[0]), true);
      return snapshot;
    },
    import: async () => assert.fail("preview cannot enter an import or write operation")
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true, mode: "preview", preview: snapshot });
});

test("preview works when capability secret creation is forbidden in an isolated process", () => {
  const cli = new URL("../scripts/import-local-storyboard.mjs", import.meta.url).href;
  const probe = `
    import assert from "node:assert/strict";
    import crypto from "node:crypto";
    import { syncBuiltinESMExports } from "node:module";
    let secretCalls = 0;
    crypto.randomBytes = () => { secretCalls++; throw new Error("preview attempted authority creation"); };
    syncBuiltinESMExports();
    const { runLocalStoryboardCli } = await import(${JSON.stringify(cli)});
    const result = await runLocalStoryboardCli(${JSON.stringify(previewArgs)}, {
      preview: async (...args) => { assert.deepEqual(args, [${JSON.stringify(previewRequest)}]); return { readOnly: true }; },
      import: async () => assert.fail("preview attempted a write")
    });
    assert.equal(secretCalls, 0);
    console.log(JSON.stringify(result));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, mode: "preview", preview: { readOnly: true } });
});

test("explicit CLI import uses the exact request-bound actual sink and rejects positive calls and cost", async () => {
  const nonces = [];
  const receive = async (received, options) => {
    assert.deepEqual(received, request);
    assert.equal(Object.isFrozen(received), true);
    assert.equal(Object.isFrozen(options), true);
    assert.deepEqual(Reflect.ownKeys(options), ["sideEffectGrant"]);
    const spec = localStoryboardCapabilitySpec(received);
    const grant = requireSideEffectGrant(options, spec, "storyboard:import-local");
    assert.match(grant.episodeId, /^local-storyboard\/[a-f0-9]{64}$/u);
    assert.equal(grant.operation, "storyboard:import-local");
    assert.deepEqual([...grant.scopes].sort(), ["filesystem.write", "state.write"]);
    assert.equal(grant.maxCalls, 0);
    assert.equal(grant.maxCostUsd, 0);
    assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), 300_000);
    assert.throws(() => consumeSideEffectGrantUsage(grant, spec, { calls: 1, costUsd: 0 }),
      hasCode("side_effect_capability_calls_exceeded"));
    assert.throws(() => consumeSideEffectGrantUsage(grant, spec, { calls: 0, costUsd: 0.001 }),
      hasCode("side_effect_capability_cost_exceeded"));
    assert.deepEqual(consumeSideEffectGrantUsage(grant, spec, { calls: 0, costUsd: 0 }), {
      usedCalls: 0, usedCostUsd: 0, remainingCalls: 0, remainingCostUsd: 0
    });
    for (const sink of [undefined, "script:import-local", "script:complete-approved", "model.call", "render:local"]) {
      assert.throws(() => requireSideEffectGrant(options, spec, sink), hasCode("local_storyboard_sink_forbidden"));
    }
    assert.throws(() => requireSideEffectGrant(options,
      localStoryboardCapabilitySpec({ ...received, actor: "human:other" }), "storyboard:import-local"),
    hasCode("side_effect_capability_episode_mismatch"));
    nonces.push(grant.nonce);
    return { status: "committed", humanApproved: false };
  };
  const dependencies = { preview: async () => assert.fail("import cannot silently refresh the preview"), import: receive };
  const result = await runLocalStoryboardCli(argsFor(), dependencies);
  await runLocalStoryboardCli(argsFor(), dependencies);
  assert.notEqual(nonces[0], nonces[1]);
  assert.deepEqual(result, { ok: true, mode: "imported", result: { status: "committed", humanApproved: false } });
  assert.equal(Object.hasOwn(result, "sideEffectGrant"), false);
});

test("CLI rejects duplicate, unknown, incomplete and control-character arguments before dependencies run", async () => {
  const invalidArgs = [
    [], ["--episode"], ["--episode", ""], ["--episode", "  "], ["--episode=synthetic"],
    [...previewArgs, "trailing"], [...argsFor(), "--confirm-local-storyboard-import"], argsFor().slice(0, -1),
    null, {}, "--episode", [123]
  ];
  for (const flag of ["--episode", "--candidate", "--candidate-sha256", "--snapshot", "--actor", "--reason"]) {
    invalidArgs.push([...argsFor(), flag, "duplicate"]);
  }
  for (const flag of ["--model", "--review", "--approve", "--operation", "--data-root", "--max-calls", "--max-cost-usd"]) {
    invalidArgs.push([...argsFor(), flag, "forbidden"]);
  }
  for (const control of ["\n", "\r", "\t", "\u0000", "\u007f"]) {
    invalidArgs.push(argsFor({ ...request, reason: `Synthetic${control}control` }));
    invalidArgs.push([`--episode${control}`, request.episodeId, "--candidate", request.candidatePath]);
  }
  const forbidden = async () => assert.fail("invalid input cannot enter preview or import");
  for (const args of invalidArgs) {
    assert.throws(() => parseLocalStoryboardArguments(args));
    await assert.rejects(runLocalStoryboardCli(args, { preview: forbidden, import: forbidden }));
  }
});

test("CLI rejects inherited, hidden, symbolic and accessor dependency injection without evaluating it", async () => {
  let evaluated = 0;
  const forbidden = () => { evaluated++; assert.fail("invalid dependency executed"); };
  const hidden = {};
  Object.defineProperty(hidden, "import", { value: forbidden, enumerable: false });
  const accessor = {};
  Object.defineProperty(accessor, "import", { get: forbidden, enumerable: true });
  for (const dependencies of [
    null, [], { preview: false }, { import: null }, { authority: forbidden },
    Object.create({ import: forbidden }), hidden, accessor, { [Symbol("authority")]: forbidden }
  ]) {
    await assert.rejects(runLocalStoryboardCli(argsFor(), dependencies), hasCode("local_storyboard_arguments_invalid"));
  }
  assert.equal(evaluated, 0);
});

test("fixed CLI errors never reveal candidate paths, provider details, nested causes or stacks", async t => {
  const stderr = [];
  const stdout = [];
  const exitCode = process.exitCode;
  t.after(() => { process.exitCode = exitCode; });
  t.mock.method(console, "error", value => stderr.push(value));
  t.mock.method(console, "log", value => stdout.push(value));
  const detail = "/synthetic-private/provider-response-token-for-test";
  for (const error of [
    Object.assign(new Error(detail, { cause: new Error(`provider:${detail}`) }), { code: detail }),
    Object.assign(new Error(detail), { code: "local_storyboard_snapshot_changed" })
  ]) {
    await reportLocalStoryboardCli(async () => { throw error; });
  }
  assert.equal(process.exitCode, 1);
  assert.deepEqual(stdout, []);
  for (const value of stderr) {
    assert.deepEqual(JSON.parse(value), { ok: false, code: "local_storyboard_cli_failed",
      message: "本地分镜入库未完成；请核对候选文件、当前脚本批准与显式确认快照。" });
    assert.equal(value.includes(detail), false);
    assert.doesNotMatch(value, /provider:|Error:|\.mjs:\d+/u);
  }
});

test("sealed production wrapper rejects overrides and getters before reading production state", async () => {
  const production = await import("../src/server/production/local-storyboard-import.mjs");
  assert.throws(() => production.previewLocalStoryboard(previewRequest, {}), /overrides/u);
  assert.throws(() => production.importLocalStoryboard(request, {}, {}), /overrides/u);
  let evaluated = 0;
  const forbidden = () => { evaluated++; assert.fail("production evaluated an authority override"); };
  const accessor = {};
  Object.defineProperty(accessor, "sideEffectGrant", { get: forbidden, enumerable: true });
  for (const options of [
    { authorizeSideEffect: forbidden }, { writeEpisode: forbidden }, accessor,
    Object.create({ sideEffectGrant: {} }), { [Symbol("authority")]: forbidden }
  ]) {
    await assert.rejects(production.importLocalStoryboard(request, options), hasCode("local_storyboard_options_invalid"));
  }
  assert.equal(evaluated, 0);
});
