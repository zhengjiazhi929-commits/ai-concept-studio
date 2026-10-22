import test from "node:test";
import assert from "node:assert/strict";
import { approvedStoryboardFixture } from "./approved-storyboard-fixture.mjs";
import { seedEditorialImplementationFixture } from "./editorial-implementation-fixture.mjs";
import { loadApprovedStoryboardBinding } from "../src/server/production/approved-storyboard-binding.mjs";
import { inspectEditorialCodeImplementation } from "../src/server/production/editorial-code-implementation.mjs";
import { buildEditorialAssetPlan, inspectEditorialAssetPlan } from "../src/server/production/editorial-asset-plan.mjs";

test("deterministic editorial asset contract covers exactly approved scenes and defers voice and render", async t => {
  const f = await approvedStoryboardFixture(t);
  await seedEditorialImplementationFixture(f.root);
  const source = await loadApprovedStoryboardBinding({workspaceRoot:f.root,episode:f.episode,reviewConfig:f.config});
  const implementation = await inspectEditorialCodeImplementation({workspaceRoot:f.root});
  const original = structuredClone(f.episode);
  const plan = buildEditorialAssetPlan(f.episode,{sourceStoryboard:source.sourceStoryboard,implementation});
  assert.deepEqual(f.episode,original);
  assert.deepEqual(plan.sourceStoryboard,source.sourceStoryboard);
  assert.deepEqual(plan.items.flatMap(item=>item.sceneIds),f.episode.scenes.map(scene=>scene.id));
  assert.equal(plan.executionPolicy.maximumPaidCostUsd,0);
  assert.deepEqual(plan.executionPolicy.externalApiCalls,[]);
  assert.equal(plan.voice.status,"deferred");
  assert.equal(plan.renderAuthorized,false);
  assert.equal(inspectEditorialAssetPlan(f.episode,plan,{version:1}).passed,true);
  for (const mutate of [p=>p.items.pop(),p=>p.items[0].binding.motionPlanSha256="f".repeat(64),
    p=>p.implementation.font.portable=false,p=>p.voice.status="complete",p=>p.executionPolicy.externalApiCalls.push({providerId:"hidden"}),
    p=>p.sourceStoryboard.artifactHash="a".repeat(64),p=>p.sourceStoryboard.version=1,p=>p.kind="legacy"]) {
    const changed=structuredClone(plan); mutate(changed);
    assert.equal(inspectEditorialAssetPlan(f.episode,changed,{version:1}).passed,false);
  }
  const drift=structuredClone(f.episode); drift.scenes[0].motionPlan.events[0].atFrame += 1;
  assert.equal(inspectEditorialAssetPlan(drift,plan,{version:1}).passed,false);
});
