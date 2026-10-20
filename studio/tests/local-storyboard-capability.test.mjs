import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityAuthority, requireSideEffectGrant, consumeSideEffectGrantUsage }
  from "../src/server/security/side-effect-capability.mjs";

const zeroCallOperations = [
  ["local-storyboard/", "storyboard:import-local"],
  ["approved-script/", "script:complete-approved"],
  ["approved-storyboard/", "storyboard:complete-approved"],
  ["editorial-assets/", "assets:prepare-editorial"],
  ["editorial-materialization/", "assets:materialize-editorial"]
];

test("zero-call editorial namespaces are fenced to their declared actual sinks", () => {
  for (const [namespace, operation] of zeroCallOperations) {
    const spec = { episodeId: namespace + "a".repeat(64), operation, scopes: ["state.write", "filesystem.write"], maxCalls: 0, maxCostUsd: 0 };
    const authority = createCapabilityAuthority({ secret: "synthetic-local-storyboard-authority-0000000000000000", maximumCalls: 0, maximumCostUsd: 0 });
    const sideEffectGrant = authority.authorize(spec);
    assert.ok(requireSideEffectGrant({ sideEffectGrant }, spec, operation));
    for (const sink of [undefined, "generator:script", "generator:storyboard", "review:gate", "script:import-local", "render:local",
      ...zeroCallOperations.map(([, value]) => value).filter(value => value !== operation)]) {
      assert.throws(() => requireSideEffectGrant({ sideEffectGrant }, spec, sink), `must not delegate to ${sink}`);
    }
    assert.throws(() => consumeSideEffectGrantUsage(sideEffectGrant, spec, { calls: 1, costUsd: 0 }), { code: "side_effect_capability_calls_exceeded" });
    assert.throws(() => consumeSideEffectGrantUsage(sideEffectGrant, spec, { calls: 0, costUsd: 0.001 }), { code: "side_effect_capability_cost_exceeded" });
  }
});

test("editorial namespaces reject forged operation labels even with a signed grant", () => {
  for (const [namespace, operation] of zeroCallOperations) {
    const authority = createCapabilityAuthority({ secret: "synthetic-editorial-authority-0000000000000000000" });
    const spec = { episodeId: namespace + "b".repeat(64), operation: "render:local",
      scopes: ["state.write", "filesystem.write"], maxCalls: 0, maxCostUsd: 0 };
    const sideEffectGrant = authority.authorize(spec);
    assert.throws(() => requireSideEffectGrant({ sideEffectGrant }, spec, "render:local"));
    assert.throws(() => requireSideEffectGrant({ sideEffectGrant }, spec, operation));
  }
});
