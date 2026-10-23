import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createLocalResearchService} from '../src/server/research/local-research-core.mjs';
import {localResearchCapabilitySpec} from '../src/shared/local-research-request.mjs';
import {createCapabilityAuthority, requireSideEffectGrant} from '../src/server/security/side-effect-capability.mjs';
import {buildEpisodeFromTrendSelection} from '../src/server/research/episode.mjs';
import {readResearchConfig} from '../src/server/research/store.mjs';
import {readReviewConfig} from '../src/server/reviews/coordinator.mjs';

const grant = request => ({sideEffectGrant:createCapabilityAuthority({secret:'synthetic-local-research-secret-not-real-000000'}).authorize(localResearchCapabilitySpec(request))});
const code = expected => error => error.code === expected;
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(),'local-research-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let episode = buildEpisodeFromTrendSelection({schemaVersion:1,selectedAt:'2026-10-22T00:00:00Z',runId:'synthetic-run',candidateId:'synthetic-harness',episodeId:'synthetic-harness',concept:'Synthetic Harness',recommendedTitle:'Synthetic Harness',primarySources:[],creatorEvidence:[],evidenceSignals:[],productDecisions:[]});
  let calls = 0;
  const dependencies = {workspaceRoot:root,readEpisode:async()=>structuredClone(episode),readResearchConfig,readReviewConfig,
    runAgent:async(id,agent,options)=>{calls++;assert.equal(id,episode.id);assert.equal(agent,'research-agent');assert.ok(options.localResearchRequest);return {output:{status:'blocked'}};},
    importResearchEvidenceBatch:async(batch,options)=>{calls++;assert.equal(batch.episodeId,episode.id);assert.ok(options.localResearchRequest);return {commitStatus:'committed',pack:{readiness:{}}};}};
  const service=createLocalResearchService(dependencies);
  const input={episodeId:episode.id,action:'run',candidatePath:null};
  const preview=await service.previewLocalResearch(input);
  const request={...input,researchVersion:preview.researchVersion,snapshotHash:preview.snapshotHash,candidateSha256:null,batchId:null,actor:'human:fixture',reason:'Synthetic explicitly scoped research',confirmLocalResearch:true};
  return {root,service,request,dependencies,get episode(){return episode;},set episode(value){episode=value;},get calls(){return calls;}};
}

test('local research preview is read-only and run is a fixed zero-cost worker dispatch',async t=>{
  const f=await fixture(t);assert.equal(f.calls,0);
  await f.service.executeLocalResearch(f.request,grant(f.request));assert.equal(f.calls,1);
});
test('missing, forged, different request and changed state fail before dispatch',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.service.executeLocalResearch(f.request),code('side_effect_capability_missing'));
  await assert.rejects(f.service.executeLocalResearch(f.request,{sideEffectGrant:{}}));
  await assert.rejects(f.service.executeLocalResearch({...f.request,reason:'Changed synthetic request'},grant(f.request)));
  f.episode.title='Changed after preview';
  await assert.rejects(f.service.executeLocalResearch(f.request,grant(f.request)),code('local_research_snapshot_changed'));
  assert.equal(f.calls,0);
});
test('local grants cannot be reused by approvals, scripts, paid calls or undefined sinks',async t=>{
  const f=await fixture(t);const options=grant(f.request);const spec=localResearchCapabilitySpec(f.request);
  for(const sink of [undefined,'approval:research','worker:script-agent','research:import-evidence','render:preview','voice:generate']) {
    assert.throws(()=>requireSideEffectGrant(options,spec,sink),code('local_research_sink_forbidden'));
  }
  assert.throws(()=>requireSideEffectGrant(options,{...spec,maxCalls:1},'worker:research-agent'));
  const broad=createCapabilityAuthority({secret:'synthetic-only-broad-research-authority-00000',maximumCalls:1,maximumCostUsd:1})
    .authorize({...spec,maxCalls:1,maxCostUsd:1});
  assert.throws(()=>requireSideEffectGrant({sideEffectGrant:broad},spec,'worker:research-agent'),code('local_research_budget_forbidden'));
  const extra=createCapabilityAuthority({secret:'synthetic-only-extra-research-authority-00000'})
    .authorize({...spec,scopes:[...spec.scopes,'paid.invoke']});
  assert.throws(()=>requireSideEffectGrant({sideEffectGrant:extra},spec,'worker:research-agent'),code('local_research_scope_forbidden'));
});
test('semantic review, busy or already-approved episodes cannot enter free local research',async t=>{
  const f=await fixture(t);
  const config=await readReviewConfig();config.stages.research.semanticReview=true;
  const service=createLocalResearchService({...f.dependencies,readReviewConfig:async()=>config});
  await assert.rejects(service.previewLocalResearch({episodeId:f.episode.id,action:'run',candidatePath:null}),code('local_research_paid_review_forbidden'));
  f.episode.approvals.research.status='approved';
  await assert.rejects(f.service.executeLocalResearch(f.request,grant(f.request)));
  assert.equal(f.calls,0);
});
test('production-style wrapper rejects hidden dependency and authority overrides',async t=>{
  const f=await fixture(t);
  for(const options of [{...grant(f.request),authorizeSideEffect:()=>{}},{...grant(f.request),dependencies:{}},Object.create({sideEffectGrant:grant(f.request).sideEffectGrant})]) {
    await assert.rejects(f.service.executeLocalResearch(f.request,options),code('local_research_options_invalid'));
  }
  assert.equal(f.calls,0);
});
test('import preview binds file bytes, batch id and Episode before existing import path',async t=>{
  const f=await fixture(t);await mkdir(resolve(f.root,'outputs'));
  const batch={schemaVersion:1,batchId:'synthetic-batch',episodeId:f.episode.id,researchedAt:'2026-10-22T00:00:00Z',sources:[],claims:[]};
  const path='outputs/batch.json';await writeFile(resolve(f.root,path),JSON.stringify(batch));
  const input={episodeId:f.episode.id,action:'import',candidatePath:path};
  const p=await f.service.previewLocalResearch(input);
  const request={...f.request,...input,candidateSha256:p.candidateSha256,batchId:p.batchId,snapshotHash:p.snapshotHash};
  await f.service.executeLocalResearch(request,grant(request));assert.equal(f.calls,1);
  await writeFile(resolve(f.root,path),JSON.stringify({...batch,claims:[],method:'mutated'}));
  await assert.rejects(f.service.executeLocalResearch(request,grant(request)),code('local_research_candidate_changed'));
  assert.equal(f.calls,1);
});
