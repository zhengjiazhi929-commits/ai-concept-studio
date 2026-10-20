import test from 'node:test';
import assert from 'node:assert/strict';
import {createCapabilityAuthority, requireSideEffectGrant} from '../src/server/security/side-effect-capability.mjs';
import {validateEditorialAvReviewInput, validateEditorialAvReviewRequest, editorialAvReviewCapabilitySpec,
  createEditorialAvReviewService, EDITORIAL_AV_REVIEW_OPERATION, validateEditorialAvReviewPlan} from '../src/server/production/editorial-av-review-core.mjs';
import {parseEditorialReviewClipArguments, runEditorialReviewClipCli} from '../scripts/render-editorial-review-clips.mjs';
import * as production from '../src/server/production/editorial-av-review.mjs';
import * as runtime from '../src/server/production/editorial-av-review-runtime.mjs';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';

const hash = n => String(n).repeat(64);
const input = {episodeId:'synthetic',planPath:'outputs/studio/synthetic/review/plan.json'};
const inspected = () => ({sourceHash:hash(1),implementationHash:hash(2),planSha256:hash(3),
  clips:[{id:'concept',fromFrame:30,toFrameExclusive:330}],durationInFrames:18000,
  publicSummary:{durationSeconds:600,alignmentMethod:'synthesis-segment-sample-boundaries-v1'}});
const authority = () => createCapabilityAuthority({secret:'synthetic-editorial-av-test-secret-000',maximumCalls:0,maximumCostUsd:0});
const authorization = request => ({sideEffectGrant:authority().authorize(editorialAvReviewCapabilitySpec(request))});
const request = preview => ({...input,planSha256:preview.planSha256,snapshotHash:preview.snapshotHash,
  sourceHash:preview.sourceHash,implementationHash:preview.implementationHash,actor:'human:synthetic',
  reason:'Generate bounded internal review clips',confirmEditorialReviewClips:true});

test('review plan versions remain closed and pacing can touch only the selected review scenes',()=>{
  const v1={schemaVersion:'editorial-av-review-plan-v1',clips:[{id:'a',sceneIds:['A']}]};
  assert.deepEqual(validateEditorialAvReviewPlan(v1),v1);
  const pacing={schemaVersion:'editorial-av-pacing-v1',scenes:[{sceneId:'A',sourceMotionPlanSha256:hash(1),retime:[],focus:[],constraints:[]}]};
  const v2={...v1,schemaVersion:'editorial-av-review-plan-v2',pacing};
  assert.deepEqual(validateEditorialAvReviewPlan(v2),v2);
  for(const bad of [{...v1,pacing},{...v2,extra:true},{...v2,pacing:{...pacing,scenes:[{...pacing.scenes[0],sceneId:'B'}]}},
    {...v2,schemaVersion:'editorial-av-review-plan-v3'},{...v2,pacing:null},
    {...v2,pacing:{...pacing,scenes:[pacing.scenes[0],pacing.scenes[0]]}}])
    assert.throws(()=>validateEditorialAvReviewPlan(bad),{code:'editorial_av_review_plan_invalid'});
  const accessor={...v2};Object.defineProperty(accessor,'pacing',{enumerable:true,get:()=>assert.fail('getter executed')});
  assert.throws(()=>validateEditorialAvReviewPlan(accessor),{code:'editorial_av_review_plan_invalid'});
  const nested=structuredClone(v2);Object.defineProperty(nested.pacing.scenes[0],'sceneId',{enumerable:true,get:()=>assert.fail('getter executed')});
  assert.throws(()=>validateEditorialAvReviewPlan(nested),{code:'editorial_av_review_plan_invalid'});
});

test('a changed pacing snapshot invalidates authorization even when audio and clip ranges remain identical',async()=>{
  let value={...inspected(),pacing:{version:1}},calls=0;
  const service=createEditorialAvReviewService({inspect:async()=>value,execute:async()=>calls++});
  const r=request(await service.preview(input));value={...value,pacing:{version:2}};
  await assert.rejects(service.render(r,authorization(r)),{code:'editorial_av_review_snapshot_changed'});
  assert.equal(calls,0);
});

test('review preview is read-only; exact confirmation creates no Episode transition',async()=>{
  let calls=0;
  const service=createEditorialAvReviewService({inspect:async()=>inspected(),execute:async()=>{calls++;return {status:'review_candidate'};}});
  const preview=await service.preview(input);assert.equal(calls,0);assert.equal(preview.formalRender,false);
  const r=request(preview);assert.equal((await service.render(r,authorization(r))).status,'review_candidate');assert.equal(calls,1);
});
test('closed inputs reject paths, getters, missing confirmation and excess keys',()=>{
  for(const value of [{...input,planPath:'outputs/../private.json'},{...input,extra:true},{...input,episodeId:'../synthetic'}])
    assert.throws(()=>validateEditorialAvReviewInput(value),{code:'editorial_av_review_request_invalid'});
  const accessor={...input};Object.defineProperty(accessor,'episodeId',{enumerable:true,get:()=>assert.fail('getter executed')});
  assert.throws(()=>validateEditorialAvReviewInput(accessor));
  assert.throws(()=>validateEditorialAvReviewRequest({...request({...inspected(),snapshotHash:hash(4)}),confirmEditorialReviewClips:false}));
});
test('missing, nonzero or broad grant fails before inspection or sink',async()=>{
  const service=createEditorialAvReviewService({inspect:()=>assert.fail('inspection executed'),execute:()=>assert.fail('sink executed')});
  const r=request({...inspected(),snapshotHash:hash(4)});
  await assert.rejects(service.render(r),{code:'side_effect_capability_missing'});
  const broad=createCapabilityAuthority({secret:'synthetic-broad-capability-secret-000',maximumCalls:1,maximumCostUsd:1});
  for(const extra of [{scopes:[...editorialAvReviewCapabilitySpec(r).scopes,'state.write']},{maxCalls:1},{maxCostUsd:1}])
    await assert.rejects(service.render(r,{sideEffectGrant:broad.authorize({...editorialAvReviewCapabilitySpec(r),...extra})}),
      {code:'editorial_av_review_capability_invalid'});
});
test('dedicated review grant cannot enter generic filesystem, state or network sinks',()=>{
  const r=request({...inspected(),snapshotHash:hash(4)});const options=authorization(r);const spec=editorialAvReviewCapabilitySpec(r);
  for(const scope of ['filesystem.write','state.write','network.request','local-inference'])
    assert.throws(()=>requireSideEffectGrant(options,{...spec,scopes:[scope]},EDITORIAL_AV_REVIEW_OPERATION),
      {code:'side_effect_capability_scope_mismatch'});
});
test('request or current source drift refuses before render',async()=>{
  let state=inspected();let rendered=0;
  const service=createEditorialAvReviewService({inspect:async()=>state,execute:async()=>rendered++});
  const r=request(await service.preview(input));state={...state,sourceHash:hash(5)};
  await assert.rejects(service.render(r,authorization(r)),{code:'editorial_av_review_snapshot_changed'});assert.equal(rendered,0);
});
test('review ranges are limited to three nonoverlapping clips and 150 seconds',async()=>{
  for(const clips of [Array.from({length:4},(_,i)=>({id:`c${i}`,fromFrame:i*60,toFrameExclusive:i*60+30})),
    [{id:'long',fromFrame:0,toFrameExclusive:4501}],
    [{id:'a',fromFrame:0,toFrameExclusive:100},{id:'b',fromFrame:99,toFrameExclusive:120}],
    [{id:'a',fromFrame:0,toFrameExclusive:18000}]]) {
    const service=createEditorialAvReviewService({inspect:async()=>({...inspected(),clips}),execute:()=>assert.fail('render')});
    await assert.rejects(service.preview(input),{code:'editorial_av_review_clip_limit'});
  }
});
test('CLI defaults to preview and issues only dedicated zero cost grant on explicit execution',async()=>{
  assert.deepEqual(parseEditorialReviewClipArguments(['--episode','synthetic','--plan',input.planPath]),{mode:'preview',request:input});
  const p={...inspected(),snapshotHash:hash(4)};const r=request(p);
  const argv=['--episode',r.episodeId,'--plan',r.planPath,'--plan-hash',r.planSha256,'--snapshot',r.snapshotHash,
    '--source-hash',r.sourceHash,'--implementation-hash',r.implementationHash,'--actor',r.actor,'--reason',r.reason,
    '--confirm-local-review-clips'];
  await runEditorialReviewClipCli(argv,{render:async(value,options)=>{
    assert.deepEqual(value,r);requireSideEffectGrant(options,editorialAvReviewCapabilitySpec(r),EDITORIAL_AV_REVIEW_OPERATION);return {ok:true};
  }});
  for(const bad of [[...argv,'--confirm-local-review-clips'],['--episode','synthetic','--plan',input.planPath,'--unknown','x']])
    assert.throws(()=>parseEditorialReviewClipArguments(bad));
});
test('production has no exported raw sinks or dependency injection options',async()=>{
  assert.deepEqual(Object.keys(production).sort(),['previewEditorialReviewClips','renderEditorialReviewClips']);
  assert.deepEqual(Object.keys(runtime).sort(),['createEditorialReviewResourceMap','inspectEditorialAvReviewImplementation','sliceEditorialReviewPcm']);
  assert.throws(()=>production.previewEditorialReviewClips(input,{workspaceRoot:'/tmp'}),TypeError);
  assert.throws(()=>production.renderEditorialReviewClips({}, {}, {execute:()=>assert.fail('sink')}),TypeError);
  const r=request({...inspected(),snapshotHash:hash(4)});
  // The fake Episode does not exist. Missing authority must reject before reading it.
  await assert.rejects(production.renderEditorialReviewClips(r),{code:'side_effect_capability_missing'});
  for(const key of ['workspaceRoot','value','execute','assertCurrent','runtime'])
    await assert.rejects(production.renderEditorialReviewClips(r,{...authorization(r),[key]:()=>assert.fail('injected')}),
      {code:'editorial_av_review_options_invalid'});
});
function pcm(samples) {
  const bytes=Buffer.alloc(44+samples*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);
  bytes.writeUInt32LE(48000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)bytes.writeInt16LE((i%4096)-2048,44+i*2);return bytes;
}
test('PCM slice preserves exact samples/rate, phrase onset and bounded final padding',()=>{
  const original=pcm(5000);const sliced=runtime.sliceEditorialReviewPcm(original,1,4,710);
  assert.equal(sliced.startSample,710);assert.equal(sliced.endSample,3110);assert.equal(sliced.audioLeadSamples,90);
  assert.deepEqual(sliced.bytes.subarray(44),original.subarray(44+710*2,44+3110*2));
  assert.equal(sliced.bytes.readUInt32LE(24),24000);assert.equal(sliced.bytes.readUInt32LE(4),sliced.bytes.length-8);
  const tail=runtime.sliceEditorialReviewPcm(original,5,7);assert.equal(tail.tailPaddingSamples,600);
  assert.deepEqual(tail.bytes.subarray(-1200),Buffer.alloc(1200));
  for(const args of [[-1,2],[1,1],[0,8],[1,2,-1],[1,2,0],[1.1,3],[1.5,3]])
    assert.throws(()=>runtime.sliceEditorialReviewPcm(original,...args));
  assert.throws(()=>runtime.sliceEditorialReviewPcm(pcm(5599),1,7,710),{code:'editorial_av_review_audio_speech_truncated'});
});
test('HTTP resource snapshot uses verified copied bytes, rejects substitution and never returns mutable backing data',()=>{
  const content=Buffer.from('approved module');const file={path:'main.js',content,bytes:content.length,
    sha256:createHash('sha256').update(content).digest('hex')};
  const read=runtime.createEditorialReviewResourceMap([file]);content.fill(0);
  assert.equal(read('main.js').toString(),'approved module');read('main.js').fill(0);
  assert.equal(read('main.js').toString(),'approved module');assert.equal(read('../secret'),null);
  assert.throws(()=>runtime.createEditorialReviewResourceMap([file]),{code:'editorial_av_review_snapshot_bytes_changed'});
});
test('read-only implementation discovery binds transitive source changes and dependency locks',async t=>{
  const root=await mkdtemp(resolve(tmpdir(),'synthetic-av-closure-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const put=async(path,content)=>{await mkdir(dirname(resolve(root,path)),{recursive:true});await writeFile(resolve(root,path),content);};
  await put('studio/src/server/production/editorial-av-review.mjs',"import './nested.mjs'; export const value=1;\n");
  await put('studio/src/server/production/nested.mjs','export const value=1;\n');
  await put('studio/scripts/render-editorial-review-clips.mjs',"import '../src/server/production/editorial-av-review.mjs';\n");
  for(const path of ['studio/package.json','studio/pnpm-lock.yaml','studio/pnpm-workspace.yaml','.node-version'])await put(path,'synthetic pin');
  await put('studio/package.json','{"type":"module"}');
  const before=await runtime.inspectEditorialAvReviewImplementation(root);
  assert.ok(before.some(file=>file.path.endsWith('/nested.mjs')));
  await put('studio/src/server/production/nested.mjs','export const value=2;\n');
  const after=await runtime.inspectEditorialAvReviewImplementation(root);assert.notDeepEqual(before,after);
});
