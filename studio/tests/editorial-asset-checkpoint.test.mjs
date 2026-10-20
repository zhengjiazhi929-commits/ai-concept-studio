import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { approvedStoryboardFixture } from "./approved-storyboard-fixture.mjs";
import { seedEditorialImplementationFixture } from "./editorial-implementation-fixture.mjs";
import { loadApprovedStoryboardBinding } from "../src/server/production/approved-storyboard-binding.mjs";
import { inspectEditorialCodeImplementation } from "../src/server/production/editorial-code-implementation.mjs";
import { buildEditorialAssetPlan } from "../src/server/production/editorial-asset-plan.mjs";
import { buildAssetExecutionCheckpoint, approveAssetExecutionCandidate,
  verifyAssetExecutionApproval, inspectAssetExecutionPlan, assertAssetExecutionAuthorized, resolveEditorialAssetPlanPath }
  from "../src/server/reviews/asset-execution-checkpoint.mjs";

test("editorial evidence path guard rejects symlinks without an options-presence bypass", async t => {
  const root=await realpath(await mkdtemp(resolve(tmpdir(),"editorial-checkpoint-path-")));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(resolve(root,"outputs"));
  await writeFile(resolve(root,"outputs/real.json"),"{}\n");
  assert.equal(await resolveEditorialAssetPlanPath("outputs/real.json",root),resolve(root,"outputs/real.json"));
  await symlink(resolve(root,"outputs/real.json"),resolve(root,"outputs/link.json"));
  await assert.rejects(resolveEditorialAssetPlanPath("outputs/link.json",root),{code:"path_boundary_forbidden"});
});

test("editorial checkpoint retains independent review and human gate, rejecting file/code/upstream drift", async t => {
  const f=await approvedStoryboardFixture(t);
  const source=await loadApprovedStoryboardBinding({workspaceRoot:f.root,episode:f.episode,reviewConfig:f.config});
  const seeded=await seedEditorialImplementationFixture(f.root);
  const implementation=await inspectEditorialCodeImplementation({workspaceRoot:f.root});
  const plan=buildEditorialAssetPlan(f.episode,{sourceStoryboard:source.sourceStoryboard,implementation});
  const path=`studio/data/production/episodes/${f.episode.id}/synthetic-editorial-plan.json`;
  await f.put(path,{episodeId:f.episode.id,plan});
  const episode=structuredClone(f.episode);
  episode.production.assetPlan={version:1,artifactPath:path,content:plan};
  await f.deps.writeEpisode(episode);
  const options={...f.deps,workspaceRoot:f.root,reviewConfig:f.config,now:"2026-09-13T01:00:00Z"};
  const result=await buildAssetExecutionCheckpoint(episode,{artifactPath:path,version:1},options);
  assert.equal(result.checkpoint.status,"waiting_approval",JSON.stringify(result.inspected.checks));
  assert.equal(result.checkpoint.humanApproval,null);
  episode.reviewCheckpoints.assetExecution=result.checkpoint;
  await f.deps.writeEpisode(episode);
  const req={candidateHash:result.checkpoint.currentCandidate.candidateHash,machineReviewId:result.checkpoint.machineReview.id,note:"Synthetic only"};
  await assert.rejects(approveAssetExecutionCandidate(episode.id,{...req,machineReviewId:"old"},options),{code:"asset_execution_review_conflict"});
  const fontPath="studio/node_modules/@fontsource-variable/noto-sans-sc/files/synthetic.woff2";
  const originalFont=await readFile(resolve(f.root,fontPath));
  await seeded.put(fontPath,Buffer.from("wOF2changed synthetic font"));
  await assert.rejects(approveAssetExecutionCandidate(episode.id,req,options),{code:"asset_execution_review_stale"});
  await seeded.put(fontPath,originalFont);
  const approved=await approveAssetExecutionCandidate(episode.id,req,options);
  assert.equal(approved.checkpoint.status,"approved");
  assert.deepEqual(approved.checkpoint.humanApproval.authorizedToolIds,[]);
  assert.equal((await verifyAssetExecutionApproval(episode.id,options)).valid,true);
  // Preparation approval is not authorization to render via an old executor.
  assert.throws(()=>assertAssetExecutionAuthorized(approved.episode,{itemId:plan.items[0].id,executor:"EditorialMotionPreview"}),
    {code:"editorial_asset_materialization_unavailable"});
  await seeded.put("studio/src/video/synthetic-transitive.mjs","export const sample=2;\n");
  assert.equal((await verifyAssetExecutionApproval(episode.id,options)).valid,false);
  await seeded.put("studio/src/video/synthetic-transitive.mjs","export const sample = 1;\n");
  await f.put(path,{episodeId:episode.id,plan:{...plan,renderAuthorized:true}});
  assert.equal((await verifyAssetExecutionApproval(episode.id,options)).valid,false);
  await f.put(path,{episodeId:episode.id,plan});
  await seeded.put(source.sourceStoryboard.artifactPath,"{}\n");
  assert.equal((await verifyAssetExecutionApproval(episode.id,options)).valid,false);
  const fakeLegacy={...plan,kind:"legacy"};
  assert.equal(inspectAssetExecutionPlan(episode,fakeLegacy,{version:1}).passed,false);
});
