import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseLocalScriptArguments,
  reportLocalScriptCli,
  runLocalScriptCli
} from "../scripts/import-local-script.mjs";
import {
  localScriptCapabilitySpec,
  validateLocalScriptPreview,
  validateLocalScriptRequest
} from "../src/shared/local-script-import-request.mjs";
import {
  assertSideEffectGrant,
  consumeSideEffectGrantUsage,
  createCapabilityAuthority,
  requireSideEffectGrant
} from "../src/server/security/side-effect-capability.mjs";

const request = Object.freeze({
  episodeId: "script-import-fixture",
  candidatePath: "outputs/script-fixture/candidate-v1/script.json",
  candidateSha256: "a".repeat(64),
  snapshotHash: "b".repeat(64),
  actor: "human:Zhengjiazhi",
  reason: "将本地合成讲稿送入审核，保留全部独立人工批准。",
  confirmLocalScriptImport: true
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
  "--confirm-local-script-import"
];
const hasCode = (code) => (error) => error.code === code;

test("local script request is a closed, cloned contract with exact paths and human declaration", () => {
  const checked = validateLocalScriptRequest(request);
  assert.deepEqual(checked, request);
  assert.notEqual(checked, request);
  assert.deepEqual(validateLocalScriptPreview(previewRequest), previewRequest);
  assert.deepEqual(validateLocalScriptPreview({ ...previewRequest, candidatePath: "studio/data/production/inbox/fixture.json" }), {
    ...previewRequest, candidatePath: "studio/data/production/inbox/fixture.json"
  });
  const badChanges = [
    { episodeId: "../episode" }, { episodeId: "-episode" }, { episodeId: "e".repeat(101) },
    { candidateSha256: "A".repeat(64) }, { candidateSha256: "a".repeat(63) },
    { snapshotHash: "b".repeat(65) }, { actor: "agent:fixture" }, { actor: "human:with space" },
    { reason: "abc" }, { reason: "x".repeat(1001) }, { reason: " reason" }, { reason: "with\nnewline" },
    { confirmLocalScriptImport: false }, { extra: true }
  ];
  for (const change of badChanges) {
    assert.throws(() => validateLocalScriptRequest({ ...request, ...change }), hasCode("local_script_request_invalid"));
  }
  for (const key of Object.keys(request)) {
    const incomplete = { ...request };
    delete incomplete[key];
    assert.throws(() => validateLocalScriptRequest(incomplete), hasCode("local_script_request_invalid"));
  }
  for (const value of [null, [], "fixture", true, 0]) {
    assert.throws(() => validateLocalScriptRequest(value), hasCode("local_script_request_invalid"));
    assert.throws(() => validateLocalScriptPreview(value), hasCode("local_script_request_invalid"));
  }
  assert.throws(() => validateLocalScriptPreview({ ...previewRequest, actor: request.actor }), hasCode("local_script_request_invalid"));
});

test("request contracts reject prototypes, symbols, nonenumerable fields, and getters without evaluating them", () => {
  const inherited = Object.assign(Object.create({ unexpected: true }), request);
  const symbolic = { ...request, [Symbol("unexpected")]: true };
  const nonenumerable = { ...request };
  Object.defineProperty(nonenumerable, "actor", { value: request.actor, enumerable: false });
  const accessor = { ...request };
  Object.defineProperty(accessor, "actor", { get: () => assert.fail("input getter must not run"), enumerable: true });
  for (const value of [inherited, symbolic, nonenumerable, accessor]) {
    assert.throws(() => validateLocalScriptRequest(value), hasCode("local_script_request_invalid"));
  }
});

test("preview and execution reject traversal, absolute, alternate separator, and unsupported candidate paths", () => {
  for (const candidatePath of [
    "outputs/../secret.json", "outputs/a/../../secret.json", "outputs/./file.json", "outputs//file.json",
    "/outputs/file.json", "C:/outputs/file.json", "outputs\\file.json", "https://host/outputs/file.json",
    "studio/data/episodes/file.json", "studio/data/production/inbox-other/file.json", "outputs/file.JSON",
    "outputs/file.txt", "outputs/file.json/", "outputs/", "outputs/file\0.json", "outputs/file\n.json",
    " outputs/file.json", "outputs/file.json ", "outputs/file.json?secret", "outputs/file.json#secret"
  ]) {
    assert.throws(() => validateLocalScriptPreview({ ...previewRequest, candidatePath }), hasCode("local_script_request_invalid"));
    assert.throws(() => validateLocalScriptRequest({ ...request, candidatePath }), hasCode("local_script_request_invalid"));
  }
});

test("parser defaults to preview and requires every execution field and confirmation together", () => {
  assert.deepEqual(parseLocalScriptArguments(previewArgs), { mode: "preview", request: previewRequest });
  assert.deepEqual(parseLocalScriptArguments(["--", ...previewArgs]), { mode: "preview", request: previewRequest });
  const parsed = parseLocalScriptArguments(argsFor());
  assert.equal(parsed.mode, "import");
  assert.deepEqual(parsed.request, request);
  assert.equal(Object.isFrozen(parsed.request), true);
  const full = argsFor();
  for (let index = 0; index < full.length; index += 2) {
    assert.throws(() => parseLocalScriptArguments(full.filter((_, position) => position !== index && position !== index + 1)), hasCode("local_script_arguments_invalid"));
  }
});

test("parser rejects malformed, duplicate, missing, unknown and authority override flags", () => {
  const invalid = [
    [], ["--"], ["--episode"], ["--episode", ""], ["--episode", "  "], ["--episode=fixture"],
    ["fixture"], ["--unknown"], ["--episode", "--candidate", "fixture"],
    [...previewArgs, "extra"], [...argsFor(), "true"], [...argsFor(), "--confirm-local-script-import"]
  ];
  for (const flag of ["--episode", "--candidate", "--candidate-sha256", "--snapshot", "--actor", "--reason"]) {
    invalid.push([...argsFor(), flag, "fixture"]);
  }
  for (const flag of ["--identity", "--data-root", "--operation", "--max-calls", "--max-cost-usd", "--side-effect-grant", "--approve", "--review"]) {
    invalid.push([...argsFor(), flag, "fixture"]);
  }
  for (const input of [...invalid, null, {}, "--episode", [123]]) {
    assert.throws(() => parseLocalScriptArguments(input), hasCode("local_script_arguments_invalid"));
  }
});

test("read-only preview never invokes import or receives a grant", async () => {
  let calls = 0;
  const preview = { candidateSha256: request.candidateSha256, snapshotHash: request.snapshotHash };
  const result = await runLocalScriptCli(previewArgs, {
    preview: async (...args) => { calls += 1; assert.deepEqual(args, [previewRequest]); return preview; },
    import: async () => assert.fail("preview must not import")
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true, mode: "preview", preview });
});

test("invalid requests never reach preview or import dependencies", async () => {
  const forbidden = async () => assert.fail("invalid arguments cannot reach an operation");
  for (const args of [
    [...argsFor(), "--unknown"],
    argsFor({ ...request, snapshotHash: "invalid" }),
    argsFor({ ...request, actor: "agent:fixture" }),
    ["--episode", request.episodeId, "--candidate", "outputs/../secret.json"]
  ]) {
    await assert.rejects(runLocalScriptCli(args, { preview: forbidden, import: forbidden }));
  }
});

test("explicit import issues one authentic request-bound zero-budget capability and no approvals", async () => {
  let calls = 0;
  const result = await runLocalScriptCli(argsFor(), {
    preview: async () => assert.fail("import cannot silently refresh the bound snapshot"),
    import: async (received, options) => {
      calls += 1;
      assert.deepEqual(received, request);
      assert.equal(Object.isFrozen(received), true);
      assert.deepEqual(Object.keys(options), ["sideEffectGrant"]);
      assert.equal(Object.isFrozen(options), true);
      const spec = localScriptCapabilitySpec(received);
      const grant = requireSideEffectGrant(options, spec, "script:import-local");
      assert.match(grant.episodeId, /^local-script\/[a-f0-9]{64}$/u);
      assert.equal(grant.operation, "script:import-local");
      assert.deepEqual([...grant.scopes].sort(), ["filesystem.write", "state.write"]);
      assert.equal(grant.maxCalls, 0);
      assert.equal(grant.maxCostUsd, 0);
      assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), 5 * 60_000);
      assert.equal(Object.hasOwn(grant, "secret"), false);
      assert.equal(Object.hasOwn(grant, "signature"), false);
      return { status: "imported", scriptVersion: 1 };
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true, mode: "imported", result: { status: "imported", scriptVersion: 1 } });
  assert.equal(Object.hasOwn(result, "sideEffectGrant"), false);
});

test("capability binds every request field and excludes other operations, paid calls and old grants", async () => {
  const reordered = Object.fromEntries(Object.entries(request).reverse());
  assert.deepEqual(localScriptCapabilitySpec(reordered), localScriptCapabilitySpec(request));
  await runLocalScriptCli(argsFor(), {
    import: async (received, { sideEffectGrant }) => {
      const spec = localScriptCapabilitySpec(received);
      for (const change of [
        { episodeId: "other-fixture" }, { candidatePath: "outputs/other/script.json" },
        { candidateSha256: "c".repeat(64) }, { snapshotHash: "d".repeat(64) },
        { actor: "human:other-fixture" }, { reason: "另一项本地讲稿导入，不可复用授权。" }
      ]) {
        assert.throws(() => assertSideEffectGrant(sideEffectGrant, localScriptCapabilitySpec({ ...received, ...change })), hasCode("side_effect_capability_episode_mismatch"));
      }
      for (const operation of ["research:run", "gate:approve", "script:generate", "collector:run"]) {
        assert.throws(() => assertSideEffectGrant(sideEffectGrant, { ...spec, operation }), hasCode("side_effect_capability_operation_mismatch"));
      }
      for (const scope of ["network.request", "model.invoke", "paid.invoke"]) {
        assert.throws(() => assertSideEffectGrant(sideEffectGrant, { ...spec, scopes: [scope] }), hasCode("side_effect_capability_scope_mismatch"));
      }
      assert.throws(() => consumeSideEffectGrantUsage(sideEffectGrant, spec, { calls: 1, costUsd: 0 }), hasCode("side_effect_capability_calls_exceeded"));
      assert.throws(() => consumeSideEffectGrantUsage(sideEffectGrant, spec, { calls: 0, costUsd: 0.01 }), hasCode("side_effect_capability_cost_exceeded"));
      const authority = createCapabilityAuthority({ secret: "synthetic-test-only-authority-value", maximumCalls: 0, maximumCostUsd: 0 });
      for (const episodeId of ["public-discovery/fixture", "manual-topic/fixture"]) {
        const oldGrant = authority.authorize({ ...spec, episodeId, operation: "trend:run" });
        assert.throws(() => assertSideEffectGrant(oldGrant, spec), hasCode("side_effect_capability_episode_mismatch"));
      }
      return { status: "imported" };
    }
  });
});

test("each explicit import uses a fresh expiring process-only capability", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const grants = [];
  const receive = async (_, options) => { grants.push(options.sideEffectGrant); return { status: "imported" }; };
  await runLocalScriptCli(argsFor(), { import: receive });
  await runLocalScriptCli(argsFor(), { import: receive });
  assert.notEqual(grants[0].nonce, grants[1].nonce);
  now += 5 * 60_000;
  assert.throws(() => assertSideEffectGrant(grants[0], localScriptCapabilitySpec(request)), hasCode("side_effect_capability_expired"));
});

test("local script capabilities require their actual import sink and cannot use a caller operation override", async () => {
  await runLocalScriptCli(argsFor(), {
    import: async (received, { sideEffectGrant }) => {
      const spec = localScriptCapabilitySpec(received);
      for (const sinkOperation of [undefined, "", "script:generate", "gate:approve", "research:run", "collector:run", "trend:manual-select"]) {
        assert.throws(() => requireSideEffectGrant({ sideEffectGrant }, spec, sinkOperation), hasCode("local_script_sink_forbidden"));
        assert.throws(() => requireSideEffectGrant({ authorizeSideEffect: () => sideEffectGrant }, spec, sinkOperation), hasCode("local_script_sink_forbidden"));
      }
      assert.equal(requireSideEffectGrant({ sideEffectGrant }, spec, "script:import-local"), sideEffectGrant);
      const authority = createCapabilityAuthority({ secret: "synthetic-test-only-authority-value", maximumCalls: 0, maximumCostUsd: 0 });
      const changedSpec = { ...spec, operation: "script:generate" };
      const wrongGrant = authority.authorize(changedSpec);
      assert.throws(() => requireSideEffectGrant({ sideEffectGrant: wrongGrant }, changedSpec, "script:import-local"), hasCode("local_script_sink_forbidden"));
      return { status: "imported" };
    }
  });
});

test("CLI dependency seam allows only preview and import functions", async () => {
  for (const dependencies of [null, [], { preview: false }, { import: null },
    ...["authority", "dataRoot", "environment", "approve", "review", "sideEffectGrant", "capabilitySpec"].map((key) => ({ [key]: () => {} }))]) {
    await assert.rejects(runLocalScriptCli(argsFor(), dependencies), hasCode("local_script_dependencies_invalid"));
  }
});

test("CLI dependency seam rejects inherited, hidden, symbolic and accessor capabilities without running them", async () => {
  const forbidden = () => assert.fail("invalid dependency cannot execute");
  const hidden = {};
  Object.defineProperty(hidden, "import", { value: forbidden, enumerable: false });
  const accessor = {};
  Object.defineProperty(accessor, "import", { get: forbidden, enumerable: true });
  for (const dependencies of [
    Object.create({ import: forbidden }), hidden, accessor, { [Symbol("authority")]: forbidden }
  ]) {
    await assert.rejects(runLocalScriptCli(argsFor(), dependencies), hasCode("local_script_dependencies_invalid"));
  }
});

test("CLI error reports expose only fixed codes, never arbitrary details or stacks", async (t) => {
  const stderr = [];
  const stdout = [];
  t.mock.method(console, "error", (value) => stderr.push(value));
  t.mock.method(console, "log", (value) => stdout.push(value));
  const originalExitCode = process.exitCode;
  t.after(() => { process.exitCode = originalExitCode; });
  const detail = "fixture-private-detail-not-for-output";
  await reportLocalScriptCli(async () => { throw Object.assign(new Error(detail), { code: detail }); });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.equal(JSON.parse(stderr[0]).code, "local_script_cli_failed");
  assert.equal(stderr[0].includes(detail), false);
  assert.doesNotMatch(stderr[0], /\bat \S+|\.mjs:\d+|Error:/u);
  await reportLocalScriptCli(async () => { throw Object.assign(new Error(detail), { code: "local_script_snapshot_changed" }); });
  assert.equal(JSON.parse(stderr[1]).code, "local_script_snapshot_changed");
  assert.equal(stderr[1].includes(detail), false);
});

test("direct CLI rejects unsafe flags before loading production operations and hides environment secrets", () => {
  const script = fileURLToPath(new URL("../scripts/import-local-script.mjs", import.meta.url));
  const detail = "fixture-environment-detail-not-for-output";
  const result = spawnSync(process.execPath, [script, "--data-root", detail], {
    encoding: "utf8",
    env: { ...process.env, AI_CONCEPT_STUDIO_OPERATOR_TOKEN: detail, AI_CONCEPT_STUDIO_CAPABILITY_SECRET: detail }
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).code, "local_script_arguments_invalid");
  assert.equal(result.stderr.includes(detail), false);
});

test("explicit local import ignores operator credentials and cannot inherit external budgets", () => {
  const script = new URL("../scripts/import-local-script.mjs", import.meta.url).href;
  const security = new URL("../src/server/security/side-effect-capability.mjs", import.meta.url).href;
  const contract = new URL("../src/shared/local-script-import-request.mjs", import.meta.url).href;
  const probe = `
    import { runLocalScriptCli } from ${JSON.stringify(script)};
    import { requireSideEffectGrant } from ${JSON.stringify(security)};
    import { localScriptCapabilitySpec } from ${JSON.stringify(contract)};
    const result = await runLocalScriptCli(${JSON.stringify(argsFor())}, {
      import: async (request, options) => {
        const grant = requireSideEffectGrant(options, localScriptCapabilitySpec(request), "script:import-local");
        return { actor: request.actor, operation: grant.operation, maxCalls: grant.maxCalls, maxCostUsd: grant.maxCostUsd };
      }
    });
    console.log(JSON.stringify(result));
  `;
  const detail = "fixture-unusable-environment-identity";
  const output = spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
    encoding: "utf8",
    env: {
      ...process.env,
      AI_CONCEPT_STUDIO_OPERATOR_ACTOR: "agent:environment-fixture",
      AI_CONCEPT_STUDIO_OPERATOR_TOKEN: detail,
      AI_CONCEPT_STUDIO_CAPABILITY_SECRET: detail,
      AI_CONCEPT_STUDIO_CAPABILITY_MAX_CALLS: "99",
      AI_CONCEPT_STUDIO_CAPABILITY_MAX_COST_USD: "99"
    }
  });
  assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), { ok: true, mode: "imported", result: {
    actor: request.actor, operation: "script:import-local", maxCalls: 0, maxCostUsd: 0
  } });
  assert.equal(`${output.stdout}${output.stderr}`.includes(detail), false);
});
