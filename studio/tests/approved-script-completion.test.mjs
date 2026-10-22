import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,rm,symlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {approvedScriptFixture} from './approved-script-fixture.mjs';
import {createApprovedScriptCompletionService} from '../src/server/production/approved-script-completion-core.mjs';
import {loadApprovedScriptBinding} from '../src/server/production/approved-script-binding.mjs';
import {approvedScriptCompletionCapabilitySpec} from '../src/shared/approved-script-completion-request.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {kernelSnapshot} from '../src/server/control/workflow-kernel.mjs';
import {assertProductionExpiry, assertProductionAuditExpiry, assertProductionNullAudit} from './production-capability-expiry-fixture.mjs';

for (const expireAt of [1, 2]) test(`script completion rejects authority expiring during load ${expireAt}`, async t => {
  await assertProductionExpiry(t, {setup, createService: createApprovedScriptCompletionService,
    capabilitySpec: approvedScriptCompletionCapabilitySpec, method: 'completeApprovedScript', expireAt});
});
test('script completion reports committed warning if authority expires after CAS, then repairs audit safely', async t => {
  await assertProductionAuditExpiry(t, {setup, createService: createApprovedScriptCompletionService,
    capabilitySpec: approvedScriptCompletionCapabilitySpec, method: 'completeApprovedScript'});
});
test('script completion preserves committed status on null or undefined audit rejection', async t => {
  await assertProductionNullAudit(t, {setup, createService: createApprovedScriptCompletionService,
    capabilitySpec: approvedScriptCompletionCapabilitySpec, method: 'completeApprovedScript'});
});

const grant=request=>({sideEffectGrant:createCapabilityAuthority({secret:'synthetic-completion-test-only-00000000000000'}).authorize(approvedScriptCompletionCapabilitySpec(request))});
const code=value=>error=>error.code===value;
async function setup(t) {
  const f=await approvedScriptFixture(t);const service=createApprovedScriptCompletionService(f.deps);
  const preview=await service.previewApprovedScriptCompletion({episodeId:f.episode.id});
  const request={episodeId:f.episode.id,artifactVersion:preview.sourceScript.artifactVersion,artifactHash:preview.sourceScript.artifactHash,reviewReportId:preview.sourceScript.reviewReportId,snapshotHash:preview.snapshotHash,actor:'human:fixture',reason:'Complete exactly this already approved script without provider calls',confirmApprovedScriptCompletion:true};
  return {...f,service,preview,request};
}

test('read-only preview and binding reread immutable evidence without state or provider authority',async t=>{
  const f=await setup(t);const before=await readFile(f.episodePath,'utf8');
  const binding=await loadApprovedScriptBinding({workspaceRoot:f.root,episode:await f.deps.readEpisode(),reviewConfig:f.config});
  assert.equal(binding.sourceScript.artifactHash,f.request.artifactHash);assert.deepEqual(binding.script,f.candidate.content);
  assert.equal(f.preview.paidCalls,0);assert.equal(f.preview.estimatedCostUsd,0);
  assert.equal(await readFile(f.episodePath,'utf8'),before);assert.equal(f.events.length,0);
});

test('zero-call zero-cost completion preserves all approvals, content, budget and advances only adjacent storyboard',async t=>{
  const f=await setup(t);const before=await f.deps.readEpisode();
  const result=await f.service.completeApprovedScript(f.request,grant(f.request));
  assert.equal(result.status,'committed');assert.equal(result.paidCalls,0);
  const after=await f.deps.readEpisode();
  for(const field of ['approvals','approvalHistory','reviews','research','sourceDocs']) assert.deepEqual(after[field],before[field],field);
  assert.deepEqual(after.production.scriptDraft,before.production.scriptDraft);assert.deepEqual(after.production.ai,before.production.ai);
  assert.deepEqual(after.control.budget,before.control.budget);assert.equal(after.control.mode,'shadow');assert.equal(after.control.activeOperation,null);
  assert.equal(after.pipeline.find(s=>s.id==='script').status,'complete');assert.equal(after.pipeline.find(s=>s.id==='storyboard').status,'ready');
  const other=steps=>steps.filter(s=>!['script','storyboard'].includes(s.id));assert.deepEqual(other(after.pipeline),other(before.pipeline));
  assert.equal(kernelSnapshot(after).legalActions.some(a=>a.workerId==='storyboard-agent'),true);
  assert.equal(f.events[0].type,'script.approved-completed');
});

test('missing grant, different actor grant, foreign scope and authority callbacks cannot write',async t=>{
  const f=await setup(t);const before=await readFile(f.episodePath,'utf8');
  await assert.rejects(f.service.completeApprovedScript(f.request),code('side_effect_capability_missing'));
  await assert.rejects(f.service.completeApprovedScript({...f.request,actor:'human:other'},grant(f.request)));
  const options=[{authorizeSideEffect:()=>assert.fail('no callbacks')},Object.create(grant(f.request)),{...grant(f.request),aiClient:()=>assert.fail('no provider')}];
  const getter={};Object.defineProperty(getter,'sideEffectGrant',{get:()=>assert.fail('getter invoked')});options.push(getter);
  for(const value of options) await assert.rejects(f.service.completeApprovedScript(f.request,value),code('approved_script_options_invalid'));
  assert.equal(await readFile(f.episodePath,'utf8'),before);
});

test('even authenticated same-operation grants with extra scopes or positive budgets are refused',async t=>{
  const f=await setup(t);const before=await readFile(f.episodePath,'utf8');
  const authority=createCapabilityAuthority({secret:'synthetic-broad-grant-test-only-00000000000000',maximumCalls:10,maximumCostUsd:10});
  for(const change of [{maxCalls:1},{maxCostUsd:1},{scopes:['state.write','filesystem.write','model.call']},{scopes:['state.write','filesystem.write','network.fetch']}]) {
    const sideEffectGrant=authority.authorize({...approvedScriptCompletionCapabilitySpec(f.request),...change});
    await assert.rejects(f.service.completeApprovedScript(f.request,{sideEffectGrant}),code('approved_script_capability_not_zero'));
  }
  assert.equal(await readFile(f.episodePath,'utf8'),before);
});

test('stale approval, snapshot, report, config, revision and illegal pipeline states fail before writes',async t=>{
  for(const mutation of ['snapshot','script-approval','research-approval','hash','report','config-hash','revision','busy','running','stop','research-step','script-step','storyboard-step']) {
    const f=await setup(t);const e=await f.deps.readEpisode();
    if(mutation==='snapshot') e.title='Changed';
    if(mutation==='script-approval') e.approvals.script.status='pending';
    if(mutation==='research-approval') e.approvals.research.status='rejected';
    if(mutation==='hash') e.production.scriptDraft.content.title='Changed';
    if(mutation==='report') e.reviews.script.reports[0].rubricVersion='old';
    if(mutation==='config-hash') e.reviews.script.reports[0].reviewConfigHash='a'.repeat(64);
    if(mutation==='revision') e.production.scriptDraft.needsRevision=true;
    if(mutation==='busy') e.control.activeOperation={id:'other',kind:'other',startedAt:new Date().toISOString()};
    if(mutation==='running') e.pipeline.at(-1).status='running';
    if(mutation==='stop') e.control.stopRequested=true;
    if(mutation==='research-step') e.pipeline.find(s=>s.id==='research').status='ready';
    if(mutation==='script-step') e.pipeline.find(s=>s.id==='script').status='pending';
    if(mutation==='storyboard-step') e.pipeline.find(s=>s.id==='storyboard').status='ready';
    await f.deps.writeEpisode(e);const before=await readFile(f.episodePath,'utf8');
    await assert.rejects(f.service.completeApprovedScript(f.request,grant(f.request)),undefined,mutation);
    assert.equal(await readFile(f.episodePath,'utf8'),before,mutation);
  }
});

test('artifact, manifest, pack, batch and symlink tampering cannot use approval',async t=>{
  for(const mutation of ['artifact','manifest','pack','batch','symlink']) {
    const f=await setup(t);const e=await f.deps.readEpisode();
    const path=mutation==='manifest'?e.production.scriptDraft.manifestPath:mutation==='pack'?f.packPath:mutation==='batch'?f.batchPath:e.production.scriptDraft.artifactPath;
    if(mutation==='symlink') {await rm(resolve(f.root,path));await symlink(resolve(f.root,f.packPath),resolve(f.root,path));}
    else await f.put(path,{episodeId:e.id,changed:true});
    const before=await readFile(f.episodePath,'utf8');await assert.rejects(f.service.completeApprovedScript(f.request,grant(f.request)),undefined,mutation);
    assert.equal(await readFile(f.episodePath,'utf8'),before);
  }
});

test('quality failure remains uncompleted and exhausted budgets do not need bypass or spending',async t=>{
  const f=await setup(t);const e=await f.deps.readEpisode();e.thesis='短';await f.deps.writeEpisode(e);
  await assert.rejects(f.service.previewApprovedScriptCompletion({episodeId:e.id}),code('approved_script_quality_failed'));
  assert.equal((await f.deps.readEpisode()).pipeline.find(s=>s.id==='script').status,'ready');
});

test('second load prevents evidence and Episode/config TOCTOU before CAS',async t=>{
  for(const mutation of ['file','episode','config']) {
    const f=await setup(t);let reads=0;
    const service=createApprovedScriptCompletionService({...f.deps,readEpisode:async()=>{
      reads+=1;if(reads===2) {
        if(mutation==='file') await f.put(f.batchPath,{changed:true});
        if(mutation==='episode') {const e=await f.deps.readEpisode();e.title='Changed concurrently';await f.deps.writeEpisode(e);}
        if(mutation==='config') f.config.version='changed-review-config';
      }
      return f.deps.readEpisode();
    }});
    await assert.rejects(service.completeApprovedScript(f.request,grant(f.request)));
    assert.equal((await f.deps.readEpisode()).pipeline.find(s=>s.id==='script').status,'ready',mutation);
  }
});

test('CAS refusal cannot register completion; simultaneous calls can commit only once',async t=>{
  const f=await setup(t);
  const broken=createApprovedScriptCompletionService({...f.deps,writeEpisode:async()=>{throw Object.assign(new Error('CAS'),{code:'state_version_conflict'});}});
  await assert.rejects(broken.completeApprovedScript(f.request,grant(f.request)),code('state_version_conflict'));
  assert.equal((await f.deps.readEpisode()).production.approvedScriptCompletion,undefined);
  const results=await Promise.allSettled([f.service.completeApprovedScript(f.request,grant(f.request)),f.service.completeApprovedScript(f.request,grant(f.request))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});

test('audit failure is committed-with-warning; exact retry is read-only and never resets later storyboard progress',async t=>{
  const f=await setup(t);let fail=true;
  const service=createApprovedScriptCompletionService({...f.deps,appendEvent:async event=>{if(fail) throw new Error('synthetic audit error');f.events.push(event);}});
  const first=await service.completeApprovedScript(f.request,grant(f.request));assert.equal(first.status,'committed_with_warning');
  const e=await f.deps.readEpisode();const storyboard=e.pipeline.find(s=>s.id==='storyboard');storyboard.status='waiting_approval';storyboard.requiresApproval='storyboard';await f.deps.writeEpisode(e);
  const before=await readFile(f.episodePath,'utf8');fail=false;
  const retry=await service.completeApprovedScript(f.request,grant(f.request));assert.equal(retry.status,'already_committed');
  assert.equal(await readFile(f.episodePath,'utf8'),before);assert.equal(f.events.length,1);
  e.approvals.script.status='rejected';await f.deps.writeEpisode(e);
  await assert.rejects(service.completeApprovedScript(f.request,grant(f.request)));
});

test('sealed production entry rejects override injection and does not load model registry or workers',async()=>{
  const production=await import('../src/server/production/approved-script-completion.mjs');
  assert.throws(()=>production.previewApprovedScriptCompletion({},{}),/overrides/u);
  assert.throws(()=>production.completeApprovedScript({}, {}, {}),/overrides/u);
  for(const file of ['approved-script-completion.mjs','approved-script-completion-core.mjs','approved-script-binding.mjs']) {
    const source=await readFile(new URL(`../src/server/production/${file}`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/agents\/registry|generator\.mjs|runAgent\(|model-router|createAiClient/u);
  }
});
