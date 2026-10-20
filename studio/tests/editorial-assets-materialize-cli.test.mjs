import test from "node:test";
import assert from "node:assert/strict";
import {parseEditorialAssetsMaterializeArguments, runEditorialAssetsMaterializeCli} from "../scripts/materialize-editorial-assets.mjs";
import {editorialAssetsMaterializeCapabilitySpec} from "../src/shared/editorial-assets-materialize-request.mjs";
import {assertSideEffectGrant} from "../src/server/security/side-effect-capability.mjs";
import {previewEditorialAssetsMaterialization, materializeEditorialAssets} from "../src/server/production/editorial-assets-materialize.mjs";

const argv = ["--episode", "synthetic", "--snapshot", "a".repeat(64), "--candidate-hash", "b".repeat(64),
  "--machine-review", "synthetic-machine-review", "--implementation-hash", "c".repeat(64),
  "--actor", "human:synthetic", "--reason", "Materialize synthetic local assets only", "--confirm-editorial-assets-materialization"];
test("materialization CLI defaults to read-only preview and explicit exact zero-call grants", async () => {
  assert.equal(parseEditorialAssetsMaterializeArguments(["--episode", "synthetic"]).mode, "preview");
  const p = await runEditorialAssetsMaterializeCli(["--episode", "synthetic"], {preview: async input => ({...input, readOnly: true}),
    materialize: async () => assert.fail("preview mutated")});
  assert.equal(p.preview.readOnly, true);
  const result = await runEditorialAssetsMaterializeCli(argv, {materialize: async (request, options) => {
    const grant = assertSideEffectGrant(options.sideEffectGrant, editorialAssetsMaterializeCapabilitySpec(request));
    assert.deepEqual(Object.keys(options), ["sideEffectGrant"]);
    assert.equal(grant.maxCalls, 0); assert.equal(grant.maxCostUsd, 0);
    assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), 600000);
    assert.deepEqual([...grant.scopes].sort(), ["filesystem.write", "state.write"]);
    return {status: "synthetic"};
  }});
  assert.equal(result.result.status, "synthetic");
});
test("materialization CLI rejects missing approval binding and injection", async () => {
  for (const input of [[], argv.slice(0, -1), [...argv, "--provider", "fake"], [...argv, "--episode", "other"],
    [...argv, "--confirm-editorial-assets-materialization"], ["--episode", "../escape"]]) {
    assert.throws(() => parseEditorialAssetsMaterializeArguments(input));
  }
  for (const deps of [{root: "/synthetic"}, {authorize: () => {}}, Object.create({preview: () => {}})]) {
    await assert.rejects(runEditorialAssetsMaterializeCli(["--episode", "synthetic"], deps));
  }
  const getter = {}; Object.defineProperty(getter, "preview", {enumerable: true, get: () => assert.fail("getter executed")});
  await assert.rejects(runEditorialAssetsMaterializeCli(["--episode", "synthetic"], getter));
});
test("sealed production materialization entry rejects callbacks and path overrides before live reads", async () => {
  const request = parseEditorialAssetsMaterializeArguments(argv).request;
  assert.throws(() => previewEditorialAssetsMaterialization({episodeId: "synthetic"}, {workspaceRoot: "/synthetic"}), TypeError);
  assert.throws(() => materializeEditorialAssets(request, {}, {provider: () => {}}), TypeError);
  for (const options of [{workspaceRoot: "/synthetic"}, {buildBundle: () => assert.fail("injected builder")},
    {verifyBundle: () => assert.fail("injected verifier")}, {provider: () => {}}]) {
    await assert.rejects(materializeEditorialAssets(request, options), error => error.code === "editorial_materialization_options_invalid");
  }
});
