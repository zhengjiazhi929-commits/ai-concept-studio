import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm,symlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {approvedStoryboardFixture} from './approved-storyboard-fixture.mjs';
import {createApprovedStoryboardCompletionService} from '../src/server/production/approved-storyboard-completion-core.mjs';
import {loadApprovedStoryboardBinding} from '../src/server/production/approved-storyboard-binding.mjs';
import {approvedStoryboardCompletionCapabilitySpec} from '../src/shared/approved-storyboard-completion-request.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {canonicalJsonDocumentContentSha256 as digest} from '../src/shared/durable-json-store.mjs';
import {assertProductionExpiry, assertProductionAuditExpiry, assertProductionNullAudit} from './production-capability-expiry-fixture.mjs';

for (const expireAt of [1, 2]) test(`storyboard completion rejects authority expiring during load ${expireAt}`, async t => {
  await assertProductionExpiry(t, {setup, createService: createApprovedStoryboardCompletionService,
    capabilitySpec: approvedStoryboardCompletionCapabilitySpec, method: 'completeApprovedStoryboard', expireAt});
});
test('storyboard completion reports committed warning if authority expires after CAS, then repairs audit safely', async t => {
  await assertProductionAuditExpiry(t, {setup, createService: createApprovedStoryboardCompletionService,
    capabilitySpec: approvedStoryboardCompletionCapabilitySpec, method: 'completeApprovedStoryboard'});
});
test('storyboard completion preserves committed status on null or undefined audit rejection', async t => {
  await assertProductionNullAudit(t, {setup, createService: createApprovedStoryboardCompletionService,
    capabilitySpec: approvedStoryboardCompletionCapabilitySpec, method: 'completeApprovedStoryboard'});
});

const authority=()=>createCapabilityAuthority({secret:'synthetic-storyboard-completion-000000000000000000'});
const grant=request=>({sideEffectGrant:authority().authorize(approvedStoryboardCompletionCapabilitySpec(request))});
const code=value=>error=>error.code===value;
async function setup(t) {
  const f=await approvedStoryboardFixture(t);const service=createApprovedStoryboardCompletionService(f.deps);
  const preview=await service.previewApprovedStoryboardCompletion({episodeId:f.episode.id});
  const request={episodeId:f.episode.id,artifactVersion:preview.sourceStoryboard.artifactVersion,
    artifactHash:preview.sourceStoryboard.artifactHash,reviewReportId:preview.sourceStoryboard.reviewReportId,
    snapshotHash:preview.snapshotHash,actor:'human:fixture',reason:'Complete exactly the approved synthetic storyboard',confirmApprovedStoryboardCompletion:true};
  return {...f,service,preview,request};
}

test('preview revalidates the entire approved evidence chain without writes and exposes exactly seven storyboard binding fields',async t=>{
  const f=await setup(t);const before=await readFile(f.episodePath,'utf8');
  const binding=await loadApprovedStoryboardBinding({workspaceRoot:f.root,episode:await f.deps.readEpisode(),reviewConfig:f.config});
  assert.deepEqual(Object.keys(binding.sourceStoryboard).sort(),['artifactVersion','artifactHash','reviewReportId','artifactPath','artifactSha256','manifestPath','manifestSha256'].sort());
  assert.equal(binding.sourceStoryboard.artifactHash,f.request.artifactHash);assert.deepEqual(binding.storyboard,f.candidate.content);
  assert.equal(binding.inspection.valid,true);assert.equal(binding.inspection.audioAligned,false);assert.equal(binding.quality.passed,true);
  assert.equal(f.preview.paidCalls,0);assert.equal(f.preview.estimatedCostUsd,0);assert.equal(f.preview.renderReady,false);
  assert.equal(await readFile(f.episodePath,'utf8'),before);assert.equal(f.events.length,0);
});

test('zero-call completion preserves approvals, original script, storyboard, scenes, captions and budgets, only unlocking adjacent assets',async t=>{
  const f=await setup(t);const before=await f.deps.readEpisode();
  const result=await f.service.completeApprovedStoryboard(f.request,grant(f.request));
  assert.equal(result.status,'committed');assert.equal(result.paidCalls,0);
  const after=await f.deps.readEpisode();
  for(const field of ['approvals','approvalHistory','reviews','research','sourceDocs','scenes','subtitles','render','reviewCheckpoints']) assert.deepEqual(after[field],before[field],field);
  for(const field of ['scriptDraft','storyboardDraft','ai']) assert.deepEqual(after.production[field],before.production[field],field);
  assert.deepEqual(after.control.budget,before.control.budget);assert.equal(after.control.mode,'shadow');assert.equal(after.control.activeOperation,null);
  assert.equal(after.pipeline.find(s=>s.id==='storyboard').status,'complete');assert.equal(after.pipeline.find(s=>s.id==='assets').status,'ready');
  assert.deepEqual(after.pipeline.filter(s=>!['storyboard','assets'].includes(s.id)),before.pipeline.filter(s=>!['storyboard','assets'].includes(s.id)));
  assert.equal(after.production.approvedStoryboardCompletion.bindingHash,f.preview.bindingHash);
  assert.equal(f.events[0].type,'storyboard.approved-completed');
});

test('missing/wrong/broad capabilities and injectable options are denied before mutation',async t=>{
  const f=await setup(t);const before=await readFile(f.episodePath,'utf8');
  await assert.rejects(f.service.completeApprovedStoryboard(f.request),code('side_effect_capability_missing'));
  await assert.rejects(f.service.completeApprovedStoryboard({...f.request,actor:'human:other'},grant(f.request)));
  const options=[{authorizeSideEffect:()=>assert.fail('callback')},Object.create(grant(f.request)),{...grant(f.request),provider:()=>assert.fail('provider')}];
  const getter={};Object.defineProperty(getter,'sideEffectGrant',{get:()=>assert.fail('getter')});options.push(getter);
  for(const value of options) await assert.rejects(f.service.completeApprovedStoryboard(f.request,value),code('approved_storyboard_options_invalid'));
  const broad=createCapabilityAuthority({secret:'synthetic-storyboard-broad-authority-00000000000000',maximumCalls:10,maximumCostUsd:10});
  for(const change of [{maxCalls:1},{maxCostUsd:1},{scopes:['state.write','filesystem.write','model.call']},{scopes:['state.write','filesystem.write','network.fetch']}]) {
    await assert.rejects(f.service.completeApprovedStoryboard(f.request,{sideEffectGrant:broad.authorize({...approvedStoryboardCompletionCapabilitySpec(f.request),...change})}),code('approved_storyboard_capability_not_zero'));
  }
  assert.equal(await readFile(f.episodePath,'utf8'),before);
});

test('stale approvals/reports/configs, timeline drift, cue-only drafts and illegal pipeline states fail closed',async t=>{
  for(const mutation of ['snapshot','research-approval','script-approval','storyboard-approval','report','duplicate-report','config','revision','timeline','subtitles','legacy','busy','stop','running','research-step','script-step','storyboard-step','assets-step']) {
    const f=await setup(t);const e=await f.deps.readEpisode();
    if(mutation==='snapshot') e.title='Changed';
    if(mutation.endsWith('-approval')) e.approvals[mutation.replace('-approval','')].status='pending';
    if(mutation==='report') e.reviews.storyboard.reports.at(-1).rubricVersion='old';
    if(mutation==='duplicate-report') {
      const before=await readFile(f.episodePath,'utf8');
      e.reviews.storyboard.reports.push(structuredClone(e.reviews.storyboard.reports.at(-1)));
      await assert.rejects(loadApprovedStoryboardBinding({workspaceRoot:f.root,episode:e,reviewConfig:f.config}),code('approved_storyboard_episode_invalid'));
      assert.equal(await readFile(f.episodePath,'utf8'),before);continue;
    }
    if(mutation==='config') f.config.version='changed';
    if(mutation==='revision') e.production.storyboardDraft.needsRevision=true;
    if(mutation==='timeline') e.scenes[0].motionPlan.events[0].atFrame+=1;
    if(mutation==='subtitles') e.subtitles[0].text='Changed';
    if(mutation==='legacy') e.production.storyboardDraft.storyboardKind='editorial-cue-plan-v1';
    if(mutation==='busy') e.control.activeOperation={id:'other',kind:'other',startedAt:new Date().toISOString()};
    if(mutation==='stop') e.control.stopRequested=true;
    if(mutation==='running') e.pipeline.at(-1).status='running';
    if(mutation.endsWith('-step')) e.pipeline.find(s=>s.id===mutation.replace('-step','')).status=mutation==='assets-step'?'ready':'pending';
    await f.deps.writeEpisode(e);const before=await readFile(f.episodePath,'utf8');
    await assert.rejects(f.service.completeApprovedStoryboard(f.request,grant(f.request)),undefined,mutation);
    assert.equal(await readFile(f.episodePath,'utf8'),before,mutation);
  }
});

test('source script/research and storyboard body/manifest/symlink are verified from the injected root',async t=>{
  for(const mutation of ['storyboard-body','storyboard-manifest','script-body','script-manifest','pack','batch','symlink']) {
    const f=await setup(t);const e=await f.deps.readEpisode();
    const paths={'storyboard-body':e.production.storyboardDraft.artifactPath,'storyboard-manifest':e.production.storyboardDraft.manifestPath,
      'script-body':e.production.scriptDraft.artifactPath,'script-manifest':e.production.scriptDraft.manifestPath,pack:f.packPath,batch:f.batchPath,symlink:e.production.storyboardDraft.artifactPath};
    if(mutation==='symlink') {await rm(resolve(f.root,paths[mutation]));await symlink(resolve(f.root,f.packPath),resolve(f.root,paths[mutation]));}
    else await f.put(paths[mutation],{episodeId:e.id,changed:true});
    const before=await readFile(f.episodePath,'utf8');
    await assert.rejects(f.service.completeApprovedStoryboard(f.request,grant(f.request)),undefined,mutation);
    assert.equal(await readFile(f.episodePath,'utf8'),before);
  }
});

test('manifest and version-entry metadata must remain internally bound, not only have matching file hashes',async t=>{
  for(const mutation of ['candidate-hash','request-hash','actor','source-script','source-research','version-entry']) {
    const f=await setup(t);const e=await f.deps.readEpisode();const draft=e.production.storyboardDraft;
    if(mutation==='version-entry') draft.versions[0].importedBy='human:other';
    else {
      const manifest=JSON.parse(await readFile(resolve(f.root,draft.manifestPath),'utf8'));
      if(mutation==='candidate-hash') manifest.candidate.author='Other';
      if(mutation==='request-hash') manifest.request.reason='Modified request';
      if(mutation==='actor') draft.importedBy='human:other';
      if(mutation==='source-script') manifest.sourceScript.artifactHash='a'.repeat(64);
      if(mutation==='source-research') manifest.sourceResearch.packSha256='b'.repeat(64);
      const file=await f.put(draft.manifestPath,manifest);draft.manifestSha256=file.sha256;draft.manifestBytes=file.bytes;
      Object.assign(draft.versions[0],{manifestSha256:file.sha256,manifestBytes:file.bytes,importedBy:draft.importedBy});
    }
    await f.deps.writeEpisode(e);await assert.rejects(loadApprovedStoryboardBinding({workspaceRoot:f.root,episode:await f.deps.readEpisode(),reviewConfig:f.config}),undefined,mutation);
  }
});

test('state/config/file second read and CAS refusal prevent registration and simultaneous requests commit once',async t=>{
  for(const mutation of ['file','episode','config']) {
    const f=await setup(t);let reads=0;
    const service=createApprovedStoryboardCompletionService({...f.deps,readEpisode:async()=>{
      if(++reads===2) {
        if(mutation==='file') await f.put(f.packPath,{changed:true});
        if(mutation==='episode') {const e=await f.deps.readEpisode();e.title='Concurrent';await f.deps.writeEpisode(e);}
        if(mutation==='config') f.config.version='changed';
      }
      return f.deps.readEpisode();
    }});
    await assert.rejects(service.completeApprovedStoryboard(f.request,grant(f.request)));
    assert.equal((await f.deps.readEpisode()).pipeline.find(s=>s.id==='storyboard').status,'ready');
  }
  const f=await setup(t);
  const denied=createApprovedStoryboardCompletionService({...f.deps,writeEpisode:async()=>{throw Object.assign(new Error('CAS'),{code:'state_version_conflict'});}});
  await assert.rejects(denied.completeApprovedStoryboard(f.request,grant(f.request)),code('state_version_conflict'));
  assert.equal((await f.deps.readEpisode()).production.approvedStoryboardCompletion,undefined);
  const results=await Promise.allSettled([f.service.completeApprovedStoryboard(f.request,grant(f.request)),f.service.completeApprovedStoryboard(f.request,grant(f.request))]);
  assert.equal(results.filter(item=>item.status==='fulfilled').length,1);
});

test('audit failure can recover on exact read-only retry without resetting subsequent asset work',async t=>{
  const f=await setup(t);let fail=true;
  const service=createApprovedStoryboardCompletionService({...f.deps,appendEvent:async event=>{if(fail) throw new Error('audit unavailable');f.events.push(event);}});
  assert.equal((await service.completeApprovedStoryboard(f.request,grant(f.request))).status,'committed_with_warning');
  const e=await f.deps.readEpisode();e.pipeline.find(s=>s.id==='assets').status='blocked';await f.deps.writeEpisode(e);
  const before=await readFile(f.episodePath,'utf8');fail=false;
  assert.equal((await service.completeApprovedStoryboard(f.request,grant(f.request))).status,'already_committed');
  assert.equal(await readFile(f.episodePath,'utf8'),before);assert.equal(f.events.length,1);
  await assert.rejects(service.completeApprovedStoryboard({...f.request,reason:'Different operation'},grant({...f.request,reason:'Different operation'})),code('approved_storyboard_completion_conflict'));
  e.production.approvedStoryboardCompletion.sourceStoryboard.artifactHash='b'.repeat(64);await f.deps.writeEpisode(e);
  await assert.rejects(service.completeApprovedStoryboard(f.request,grant(f.request)),code('approved_storyboard_completion_conflict'));
});

test('receipt binding ignores asset-only later progress, but preserves exact approved execution content',async t=>{
  const f=await setup(t);await f.service.completeApprovedStoryboard(f.request,grant(f.request));
  const e=await f.deps.readEpisode();const before=digest(e.production.storyboardDraft);
  e.production.assetPlan={syntheticOnly:true};await f.deps.writeEpisode(e);
  assert.equal((await f.service.completeApprovedStoryboard(f.request,grant(f.request))).status,'already_committed');
  assert.equal(digest((await f.deps.readEpisode()).production.storyboardDraft),before);
});

test('completion rejects failed current quality even when the original storyboard approval still matches',async t=>{
  const f=await setup(t);const e=await f.deps.readEpisode();e.thesis='短';await f.deps.writeEpisode(e);
  const before=await readFile(f.episodePath,'utf8');
  await assert.rejects(f.service.previewApprovedStoryboardCompletion({episodeId:e.id}),code('approved_storyboard_quality_failed'));
  assert.equal(await readFile(f.episodePath,'utf8'),before);
});

test('ambiguous duplicate or wrong-agent pipeline entries cannot be used as approved source bindings',async t=>{
  const f=await setup(t);const e=await f.deps.readEpisode();
  const duplicate=structuredClone(e);duplicate.pipeline.push(structuredClone(duplicate.pipeline.find(step=>step.id==='storyboard')));
  const wrongAgent=structuredClone(e);wrongAgent.pipeline.find(step=>step.id==='script').agent='asset-agent';
  for(const value of [duplicate,wrongAgent]) await assert.rejects(loadApprovedStoryboardBinding({workspaceRoot:f.root,episode:value,reviewConfig:f.config}),code('approved_storyboard_transition_invalid'));
});

test('sealed wrappers reject overrides; this entry never imports workers or model routing',async()=>{
  const production=await import('../src/server/production/approved-storyboard-completion.mjs');
  assert.throws(()=>production.previewApprovedStoryboardCompletion({},{}),/overrides/u);
  assert.throws(()=>production.completeApprovedStoryboard({}, {}, {}),/overrides/u);
  for(const file of ['approved-storyboard-completion.mjs','approved-storyboard-completion-core.mjs','approved-storyboard-binding.mjs']) {
    assert.doesNotMatch(await readFile(new URL(`../src/server/production/${file}`,import.meta.url),'utf8'),/agents\/registry|generator\.mjs|runAgent\(|model-router|createAiClient/u);
  }
});
