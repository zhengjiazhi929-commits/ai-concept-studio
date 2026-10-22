import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  parseManualTopicArguments,
  reportManualTopicCli,
  runManualTopicCli
} from "../scripts/select-manual-topic.mjs";
import { manualTopicCapabilitySpec } from "../src/shared/manual-topic-decision.mjs";
import {
  assertSideEffectGrant,
  consumeSideEffectGrantUsage,
  requireSideEffectGrant
} from "../src/server/security/side-effect-capability.mjs";

const request = Object.freeze({
  candidateId: "candidate-manual-fixture",
  runId: "trend-manual-fixture",
  snapshotHash: "a".repeat(64),
  actor: "human:Zhengjiazhi",
  reason: "人工指定讲解 Agent Memory，保留真实热度不足与五道人审记录。",
  confirmManualSelection: true
});
const argsFor = (value = request) => [
  "--candidate", value.candidateId,
  "--run", value.runId,
  "--snapshot", value.snapshotHash,
  "--actor", value.actor,
  "--reason", value.reason,
  "--confirm-manual-selection"
];
const hasCode = (code) => (error) => error.code === code;

test("manual topic candidate-only arguments are explicitly preview-only", () => {
  assert.deepEqual(parseManualTopicArguments(["--candidate", request.candidateId]), {
    mode: "preview", candidateId: request.candidateId
  });
  assert.deepEqual(parseManualTopicArguments(["--", "--candidate", request.candidateId]), {
    mode: "preview", candidateId: request.candidateId
  });
  const parsed = parseManualTopicArguments(argsFor());
  assert.equal(parsed.mode, "select");
  assert.deepEqual(parsed.request, request);
  assert.equal(Object.isFrozen(parsed.request), true);
});

test("manual topic parser rejects unknown, repeated, missing and positional arguments", () => {
  const invalid = [
    [], ["--"], ["--candidate"], ["--candidate", ""], ["--candidate", "  "],
    ["--candidate", "fixture\0value"], ["--candidate=fixture"], ["fixture"],
    ["--candidate", "--actor", "human:fixture"], ["--unknown"],
    ["--candidate", request.candidateId, "extra"],
    [...argsFor(), "--candidate", request.candidateId],
    [...argsFor(), "--run", request.runId],
    [...argsFor(), "--snapshot", request.snapshotHash],
    [...argsFor(), "--actor", request.actor],
    [...argsFor(), "--reason", request.reason],
    [...argsFor(), "--confirm-manual-selection"],
    [...argsFor(), "true"],
    [...argsFor(), "--identity", "fixture.json"],
    [...argsFor(), "--data-root", "fixture"],
    [...argsFor(), "--operation", "research:run"],
    [...argsFor(), "--max-calls", "1"],
    [...argsFor(), "--max-cost-usd", "1"],
    [...argsFor(), "--side-effect-grant", "fixture"]
  ];
  for (const args of invalid) {
    assert.throws(() => parseManualTopicArguments(args), hasCode("manual_topic_arguments_invalid"));
  }
  for (const input of [null, {}, "--candidate", [123]]) {
    assert.throws(() => parseManualTopicArguments(input), hasCode("manual_topic_arguments_invalid"));
  }
});

test("every execution field and the confirmation flag are required together", () => {
  const complete = argsFor();
  for (let index = 0; index < complete.length; index += 2) {
    const partial = complete.filter((_, position) => position !== index && position !== index + 1);
    assert.throws(() => parseManualTopicArguments(partial), hasCode("manual_topic_arguments_invalid"));
  }
  for (const field of ["--run", "--snapshot", "--actor", "--reason", "--confirm-manual-selection"]) {
    assert.throws(() => parseManualTopicArguments(["--candidate", request.candidateId, field, "fixture"]), hasCode("manual_topic_arguments_invalid"));
  }
});

test("preview calls only the read-only dependency without any grant or write options", async () => {
  let calls = 0;
  const preview = { runId: request.runId, snapshotHash: request.snapshotHash, candidate: { id: request.candidateId, score: 42 } };
  const result = await runManualTopicCli(["--candidate", request.candidateId], {
    preview: async (...args) => {
      calls += 1;
      assert.deepEqual(args, [request.candidateId]);
      return preview;
    },
    approve: async () => assert.fail("preview must not select a topic")
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true, mode: "preview", preview });
});

test("invalid arguments never reach either dependency", async () => {
  const forbidden = async () => assert.fail("invalid arguments must not reach an operation");
  await assert.rejects(runManualTopicCli([...argsFor(), "--unknown"], {
    preview: forbidden, approve: forbidden
  }), hasCode("manual_topic_arguments_invalid"));
});

test("execution validates the real shared request contract before calling approval", async () => {
  let calls = 0;
  for (const change of [
    { snapshotHash: "not-a-snapshot" },
    { actor: "agent:fixture" },
    { reason: "" }
  ]) {
    await assert.rejects(runManualTopicCli(argsFor({ ...request, ...change }), {
      approve: async () => { calls += 1; }
    }));
  }
  assert.equal(calls, 0);
});

test("explicit selection sends exactly one authentic request-bound zero-budget grant", async () => {
  let calls = 0;
  const result = await runManualTopicCli(argsFor(), {
    preview: async () => assert.fail("execution must use the explicitly supplied snapshot, not silently refresh it"),
    approve: async (received, options) => {
      calls += 1;
      assert.deepEqual(received, request);
      assert.equal(Object.isFrozen(received), true);
      assert.deepEqual(Object.keys(options), ["sideEffectGrant"]);
      assert.equal(Object.isFrozen(options), true);
      const spec = manualTopicCapabilitySpec(received);
      const grant = requireSideEffectGrant(options, spec, "trend:manual-select");
      assert.match(grant.episodeId, /^manual-topic\/[a-f0-9]{64}$/u);
      assert.equal(grant.operation, "trend:manual-select");
      assert.equal(grant.maxCalls, 0);
      assert.equal(grant.maxCostUsd, 0);
      assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), 5 * 60_000);
      assert.equal(Object.hasOwn(grant, "secret"), false);
      assert.equal(Object.hasOwn(grant, "signature"), false);
      return { episodeId: "fixture-episode", selectionMode: "manual" };
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    ok: true, mode: "selected", result: { episodeId: "fixture-episode", selectionMode: "manual" }
  });
  assert.equal(Object.hasOwn(result, "sideEffectGrant"), false);
});

test("the issued grant cannot authorize changed facts, paid calls, or another operation", async () => {
  await runManualTopicCli(argsFor(), {
    approve: async (received, { sideEffectGrant }) => {
      const spec = manualTopicCapabilitySpec(received);
      for (const change of [
        { candidateId: "candidate-other-fixture" },
        { runId: "trend-other-fixture" },
        { snapshotHash: "b".repeat(64) },
        { actor: "human:other-fixture" },
        { reason: "另一项人工选题理由，不应复用既有授权。" }
      ]) {
        assert.throws(() => assertSideEffectGrant(sideEffectGrant, manualTopicCapabilitySpec({ ...received, ...change })), hasCode("side_effect_capability_episode_mismatch"));
      }
      for (const operation of ["trend:approve-candidate", "research:run", "gate:approve", "collector:run"]) {
        assert.throws(() => assertSideEffectGrant(sideEffectGrant, { ...spec, operation }), hasCode("side_effect_capability_operation_mismatch"));
        assert.throws(() => requireSideEffectGrant({ sideEffectGrant }, spec, operation), hasCode("manual_topic_sink_forbidden"));
      }
      for (const scope of ["network.request", "model.invoke", "paid.invoke"]) {
        assert.throws(() => assertSideEffectGrant(sideEffectGrant, { ...spec, scopes: [scope] }), hasCode("side_effect_capability_scope_mismatch"));
      }
      assert.throws(() => consumeSideEffectGrantUsage(sideEffectGrant, spec, { calls: 1, costUsd: 0 }), hasCode("side_effect_capability_calls_exceeded"));
      assert.throws(() => consumeSideEffectGrantUsage(sideEffectGrant, spec, { calls: 0, costUsd: 0.01 }), hasCode("side_effect_capability_cost_exceeded"));
      return { episodeId: "fixture-episode" };
    }
  });
});

test("each explicit invocation gets a fresh nonce and its grant expires after five minutes", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const grants = [];
  const approve = async (_, options) => { grants.push(options.sideEffectGrant); return { episodeId: "fixture-episode" }; };
  await runManualTopicCli(argsFor(), { approve });
  await runManualTopicCli(argsFor(), { approve });
  assert.notEqual(grants[0].nonce, grants[1].nonce);
  now += 5 * 60_000;
  assert.throws(() => assertSideEffectGrant(grants[0], manualTopicCapabilitySpec(request)), hasCode("side_effect_capability_expired"));
});

test("the test seam exposes only preview and approve, not authority or data-root options", async () => {
  for (const extra of ["environment", "dataRoot", "authority", "authorizeSideEffect", "sideEffectGrant", "capabilitySpec"]) {
    await assert.rejects(runManualTopicCli(argsFor(), {
      [extra]: {}, approve: async () => assert.fail("unexpected option must not reach an operation")
    }), hasCode("manual_topic_dependencies_invalid"));
  }
});

test("CLI error reports do not print raw messages, stacks, input, or unknown error codes", async (t) => {
  const stderr = [];
  const stdout = [];
  t.mock.method(console, "error", (value) => stderr.push(value));
  t.mock.method(console, "log", (value) => stdout.push(value));
  const originalExitCode = process.exitCode;
  t.after(() => { process.exitCode = originalExitCode; });
  const detail = "fixture-private-detail-must-not-escape";
  await reportManualTopicCli(async () => { throw Object.assign(new Error(detail), { code: detail }); });
  assert.equal(process.exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.equal(stderr.length, 1);
  const report = JSON.parse(stderr[0]);
  assert.equal(report.ok, false);
  assert.equal(report.code, "manual_topic_cli_failed");
  assert.equal(stderr[0].includes(detail), false);
  assert.doesNotMatch(stderr[0], /\bat \S+|\.mjs:\d+|Error:/u);
});

test("known stale-snapshot and duplicate-topic errors remain actionable without raw detail", async (t) => {
  const stderr = [];
  t.mock.method(console, "error", (value) => stderr.push(JSON.parse(value)));
  const originalExitCode = process.exitCode;
  t.after(() => { process.exitCode = originalExitCode; });
  for (const code of ["manual_topic_snapshot_changed", "manual_topic_already_in_production"]) {
    await reportManualTopicCli(async () => { throw Object.assign(new Error("fixture-private-detail"), { code }); });
    assert.equal(stderr.at(-1).code, code);
    assert.equal(JSON.stringify(stderr.at(-1)).includes("fixture-private-detail"), false);
  }
});

test("explicit local selection does not load or reuse operator/discovery identity or paid budgets", () => {
  const script = new URL("../scripts/select-manual-topic.mjs", import.meta.url).href;
  const security = new URL("../src/server/security/side-effect-capability.mjs", import.meta.url).href;
  const decision = new URL("../src/shared/manual-topic-decision.mjs", import.meta.url).href;
  const probe = `
    import { runManualTopicCli } from ${JSON.stringify(script)};
    import { requireSideEffectGrant } from ${JSON.stringify(security)};
    import { manualTopicCapabilitySpec } from ${JSON.stringify(decision)};
    const result = await runManualTopicCli(${JSON.stringify(argsFor())}, {
      approve: async (request, options) => {
        const grant = requireSideEffectGrant(options, manualTopicCapabilitySpec(request), "trend:manual-select");
        return { actor: request.actor, operation: grant.operation, maxCalls: grant.maxCalls, maxCostUsd: grant.maxCostUsd };
      }
    });
    console.log(JSON.stringify(result));
  `;
  const detail = "fixture-unusable-environment-value";
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
  assert.deepEqual(JSON.parse(output.stdout), {
    ok: true, mode: "selected", result: {
      actor: request.actor, operation: "trend:manual-select", maxCalls: 0, maxCostUsd: 0
    }
  });
  assert.equal(`${output.stdout}${output.stderr}`.includes(detail), false);
});

test("direct CLI rejects unsafe options with a nonzero safe exit before touching production data", () => {
  const script = fileURLToPath(new URL("../scripts/select-manual-topic.mjs", import.meta.url));
  const detail = "fixture-environment-value-must-not-escape";
  const output = spawnSync(process.execPath, [script, "--data-root", detail], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
    env: {
      ...process.env,
      AI_CONCEPT_STUDIO_OPERATOR_TOKEN: detail,
      AI_CONCEPT_STUDIO_CAPABILITY_SECRET: detail
    }
  });
  assert.equal(output.status, 1);
  assert.equal(output.stdout, "");
  assert.equal(JSON.parse(output.stderr).code, "manual_topic_arguments_invalid");
  assert.equal(output.stderr.includes(detail), false);
  assert.doesNotMatch(output.stderr, /\bat \S+|\.mjs:\d+|Error:/u);
});

test("package script exposes the narrowly scoped manual-topic CLI", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["topic:select"], "node scripts/select-manual-topic.mjs");
});
