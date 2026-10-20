import test from "node:test";
import assert from "node:assert/strict";
import {parseEditorialAssetsArguments, runEditorialAssetsCli} from "../scripts/prepare-editorial-assets.mjs";
import {editorialAssetsPrepareCapabilitySpec} from "../src/shared/editorial-assets-prepare-request.mjs";
import {assertSideEffectGrant} from "../src/server/security/side-effect-capability.mjs";

const argv = ["--episode", "synthetic", "--snapshot", "a".repeat(64), "--plan-hash", "b".repeat(64),
  "--implementation-hash", "c".repeat(64), "--actor", "human:synthetic", "--reason", "Prepare synthetic assets only",
  "--confirm-editorial-assets-preparation"];
test("CLI defaults to read-only preview and issues exact zero-call capability only on explicit preparation", async () => {
  assert.equal(parseEditorialAssetsArguments(["--episode", "synthetic"]).mode, "preview");
  const preview = await runEditorialAssetsCli(["--episode", "synthetic"], {preview: async input => ({...input, readOnly: true}),
    prepare: async () => assert.fail("preview called mutation")});
  assert.equal(preview.preview.readOnly, true);
  const output = await runEditorialAssetsCli(argv, {preview: async () => assert.fail("wrong path"),
    prepare: async (request, options) => {
      assert.deepEqual(Object.keys(options), ["sideEffectGrant"]);
      const grant = assertSideEffectGrant(options.sideEffectGrant, editorialAssetsPrepareCapabilitySpec(request));
      assert.equal(grant.maxCalls, 0); assert.equal(grant.maxCostUsd, 0);
      assert.deepEqual([...grant.scopes].sort(), ["filesystem.write", "state.write"]);
      return {status: "synthetic-no-mutation"};
    }});
  assert.equal(output.result.status, "synthetic-no-mutation");
});
test("CLI rejects unknown flags, duplicates, options injection and incomplete authorization", async () => {
  for (const input of [[], argv.slice(0, -1), [...argv, "--provider", "fake"], [...argv, "--episode", "other"],
    [...argv, "--confirm-editorial-assets-preparation"], ["--episode", "../escape"]]) assert.throws(() => parseEditorialAssetsArguments(input));
  for (const dependencies of [{root: "/tmp/unsafe"}, {authorize: () => {}}, Object.create({preview: () => {}})]) {
    await assert.rejects(runEditorialAssetsCli(["--episode", "synthetic"], dependencies));
  }
  const accessor = {}; Object.defineProperty(accessor, "preview", {enumerable: true, get: () => assert.fail("getter executed")});
  await assert.rejects(runEditorialAssetsCli(["--episode", "synthetic"], accessor));
});
