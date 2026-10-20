import test from "node:test";
import assert from "node:assert/strict";
import {createRendererService} from "../src/server/renderer-core.mjs";
import {assertCurrentAssetBundleIntegrity} from "../src/server/production/asset-bundle-integrity.mjs";
import {createEditorialMaterializationSnapshot} from "../src/server/renderer.mjs";

test("editorial formal render fails before config, bundle rebuild, browser or output I/O", async () => {
  const dependencies = new Proxy({}, {get: () => assert.fail("editorial formal render performed I/O")});
  const renderer = createRendererService({dependencies});
  for (const episode of [
    {production: {assetPlan: {content: {kind: "editorial-code-asset-plan-v1"}}}},
    {production: {editorialMaterialization: {}}}, {scenes: [{motionPlan: {}}]}
  ]) await assert.rejects(renderer.renderPreview(episode), {code: "editorial_audio_integration_required"});
});

test("asset integrity cannot replace missing editorial bundle verification with an index-file stub", async () => {
  await assert.rejects(assertCurrentAssetBundleIntegrity({id: "synthetic-no-bundle", previewMode: "visual-proof",
    production: {assetPlan: {content: {kind: "editorial-code-asset-plan-v1"}}}, assets: []}, {
    inspectFileIntegrity: () => assert.fail("index-only stub was trusted")
  }), {code: "editorial_materialization_integrity_changed"});
});

test("production editorial snapshot refuses dependency or workspace overrides", async () => {
  await assert.rejects(createEditorialMaterializationSnapshot({}, {workspaceRoot: "/tmp"}), TypeError);
});
