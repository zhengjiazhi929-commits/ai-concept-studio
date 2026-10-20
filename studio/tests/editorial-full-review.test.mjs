import test from 'node:test';
import assert from 'node:assert/strict';
import {createCapabilityAuthority, requireSideEffectGrant} from '../src/server/security/side-effect-capability.mjs';
import {
  validateEditorialFullReviewInput, validateEditorialFullReviewRequest, validateEditorialFullReviewPlan,
  editorialFullReviewCapabilitySpec, assertEditorialFullReviewGrant, createEditorialFullReviewService,
  buildEditorialFullReviewSegments, padEditorialFullReviewPcm, EDITORIAL_FULL_REVIEW_OPERATION,
} from '../src/server/production/editorial-full-review-core.mjs';
import {createEditorialAvReviewService, editorialAvReviewCapabilitySpec} from '../src/server/production/editorial-av-review-core.mjs';
import {parseEditorialFullReviewArguments, runEditorialFullReviewCli} from '../scripts/render-editorial-full-review.mjs';

const hash = n => String(n).repeat(64);
const input = {episodeId:'synthetic',planPath:'outputs/studio/synthetic/editorial-full-review-plans/plan.json'};
const plan = () => ({schemaVersion:'editorial-full-review-plan-v1',
  preparationManifestPath:'outputs/synthetic-preparation/v001/preparation-manifest.json',
  preparationManifestSha256:hash(1),chunkFrames:900});
const inspected = () => ({sourceHash:hash(1),implementationHash:hash(2),planSha256:hash(3),
  durationInFrames:1802,totalSamples:1802*800-240,
  segments:buildEditorialFullReviewSegments({durationInFrames:1802,totalSamples:1802*800-240}),
  publicSummary:{durationSeconds:1802/30,alignmentMethod:'synthetic-sample-boundaries'}});
const authority = (overrides={}) => createCapabilityAuthority({secret:'synthetic-full-review-secret-000000',maximumCalls:0,maximumCostUsd:0,...overrides});
const authorization = request => ({sideEffectGrant:authority().authorize(editorialFullReviewCapabilitySpec(request))});
const request = preview => ({...input,planSha256:preview.planSha256,snapshotHash:preview.snapshotHash,
  sourceHash:preview.sourceHash,implementationHash:preview.implementationHash,actor:'human:synthetic',
  reason:'Generate a private full review candidate',confirmEditorialFullReview:true});
const fakeRequest = () => request({...inspected(),snapshotHash:hash(4)});
const argvFor = r => ['--episode',r.episodeId,'--plan',r.planPath,'--plan-hash',r.planSha256,'--snapshot',r.snapshotHash,
  '--source-hash',r.sourceHash,'--implementation-hash',r.implementationHash,'--actor',r.actor,'--reason',r.reason,
  '--confirm-local-full-review'];
function accessor(value,key) {
  const result={...value};Object.defineProperty(result,key,{enumerable:true,get:()=>assert.fail('getter must not execute')});return result;
}
function hidden(value) {const result={...value};Object.defineProperty(result,'hidden',{value:true});return result;}
function symbolic(value) {return {...value,[Symbol('hidden')]:true};}

test('full input and request are closed data-only records with dedicated plan paths',()=>{
  assert.deepEqual(validateEditorialFullReviewInput(input),input);
  const r=fakeRequest();assert.deepEqual(validateEditorialFullReviewRequest(r),r);
  for(const value of [{...input,extra:true},hidden(input),symbolic(input),accessor(input,'episodeId'),Object.assign(Object.create({x:1}),input),
    {...input,planPath:'outputs/studio/synthetic/review/plan.json'},
    {...input,planPath:'outputs/studio/other/editorial-full-review-plans/plan.json'},
    {...input,planPath:'outputs/studio/synthetic/editorial-full-review-plans/../plan.json'},
    {...input,planPath:'outputs/studio/synthetic/editorial-full-review-plans/nested/plan.json'},
    {...input,planPath:`/${input.planPath}`},{...input,planPath:input.planPath+'?x'},
    {...input,episodeId:'../synthetic'},null,[]]) assert.throws(()=>validateEditorialFullReviewInput(value));
  for(const value of [{...r,confirmEditorialFullReview:false},{...r,actor:'agent:synthetic'},{...r,reason:' x '},
    {...r,sourceHash:hash('X')},{...r,durationInFrames:36001},{...r,confirmEditorialReviewClips:true},
    accessor(r,'confirmEditorialFullReview'),hidden(r),symbolic(r)]) assert.throws(()=>validateEditorialFullReviewRequest(value));
});

test('full plan is closed, bound to one safe preparation manifest, and has a fixed 900-frame chunk',()=>{
  assert.deepEqual(validateEditorialFullReviewPlan(plan()),plan());
  for(const value of [{...plan(),schemaVersion:'editorial-av-review-plan-v1'},{...plan(),chunkFrames:901},
    {...plan(),preparationManifestSha256:'x'},{...plan(),clips:[]},accessor(plan(),'chunkFrames'),hidden(plan()),symbolic(plan()),
    ...['../preparation-manifest.json','/outputs/x/preparation-manifest.json','outputs/../preparation-manifest.json',
      'outputs//preparation-manifest.json','outputs/./preparation-manifest.json','outputs/x/other.json',
      'outputs/x\\preparation-manifest.json','outputs/x/preparation-manifest.json?x'].map(preparationManifestPath=>({...plan(),preparationManifestPath}))])
    assert.throws(()=>validateEditorialFullReviewPlan(value),{code:'editorial_full_review_plan_invalid'});
});

test('segments continuously cover full frame range without overlap, drift, or caller-selected ranges',()=>{
  assert.deepEqual(buildEditorialFullReviewSegments({durationInFrames:1802,totalSamples:1802*800-240}),[
    {id:'segment-01',fromFrame:0,toFrameExclusive:900,frameCount:900},
    {id:'segment-02',fromFrame:900,toFrameExclusive:1800,frameCount:900},
    {id:'segment-03',fromFrame:1800,toFrameExclusive:1802,frameCount:2},
  ]);
  for(const durationInFrames of [1,900,901,21492,36000]) {
    const segments=buildEditorialFullReviewSegments({durationInFrames,totalSamples:durationInFrames*800});
    assert.equal(segments[0].fromFrame,0);assert.equal(segments.at(-1).toFrameExclusive,durationInFrames);
    assert.equal(segments.reduce((sum,s)=>sum+s.frameCount,0),durationInFrames);
    assert.ok(segments.every((s,i)=>s.frameCount<=900&&(!i||s.fromFrame===segments[i-1].toFrameExclusive)));
  }
  const base={durationInFrames:901,totalSamples:901*800-1};
  for(const value of [{...base,durationInFrames:0},{...base,durationInFrames:36001},{...base,durationInFrames:1.5},
    {...base,totalSamples:901*800+1},{...base,totalSamples:900*800},{...base,totalSamples:1.5},
    {...base,totalSamples:NaN},{...base,fps:60},{...base,sampleRate:48000},{...base,chunkFrames:1000},
    {...base,fromFrame:900},accessor(base,'durationInFrames'),symbolic(base)]) assert.throws(()=>buildEditorialFullReviewSegments(value));
});

function pcm(samples) {
  const bytes=Buffer.alloc(44+samples*2);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);
  bytes.writeUInt32LE(48000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)bytes.writeInt16LE((i%4096)-2048,44+i*2);return bytes;
}
test('PCM is never trimmed or stretched; only sub-frame tail silence is added without source mutation',()=>{
  for(const tailPaddingSamples of [0,1,240,799]) {
    const original=pcm(1600-tailPaddingSamples),before=Buffer.from(original);
    const padded=padEditorialFullReviewPcm(original,2);
    assert.equal(padded.sourceSamples,1600-tailPaddingSamples);assert.equal(padded.targetSamples,1600);
    assert.equal(padded.tailPaddingSamples,tailPaddingSamples);assert.notEqual(padded.bytes,original);
    assert.deepEqual(padded.bytes.subarray(44,44+2*padded.sourceSamples),original.subarray(44));
    assert.deepEqual(padded.bytes.subarray(44+2*padded.sourceSamples),Buffer.alloc(tailPaddingSamples*2));
    assert.equal(padded.bytes.readUInt32LE(4),padded.bytes.length-8);assert.equal(padded.bytes.readUInt32LE(40),3200);
    assert.deepEqual(original,before);
  }
  for(const [bytes,frames] of [[pcm(1601),2],[pcm(800),2],[pcm(1600),0],[pcm(1600),2.5],[pcm(1600),36001],
    [Buffer.alloc(50),1],[new Uint8Array(100),1]]) assert.throws(()=>padEditorialFullReviewPcm(bytes,frames));
  const stereo=pcm(800);stereo.writeUInt16LE(2,22);assert.throws(()=>padEditorialFullReviewPcm(stereo,1));
  const silent=pcm(800);silent.fill(0,44);assert.throws(()=>padEditorialFullReviewPcm(silent,1));
});

test('preview does no sink work; execution remains a private, non-gate review operation',async()=>{
  let calls=0;
  const service=createEditorialFullReviewService({inspect:async()=>inspected(),execute:async({assertCurrent})=>{await assertCurrent();calls++;return {status:'review_candidate'};}});
  const preview=await service.preview(input);assert.equal(calls,0);assert.equal(preview.durationInFrames,1802);
  assert.deepEqual(preview.segments,inspected().segments);
  for(const key of ['formalRender','visualAcceptance','releaseEligible'])assert.equal(preview[key],false);
  assert.equal(preview.paidCalls,0);assert.equal(preview.estimatedCostUsd,0);
  const r=request(preview);assert.equal((await service.render(r,authorization(r))).status,'review_candidate');assert.equal(calls,1);
});

test('inspection cannot replace security bindings or expand, overlap, omit or mutate segment ranges',async()=>{
  for(const change of [{durationInFrames:36001},{totalSamples:1},
    {segments:inspected().segments.slice(0,2)},
    {segments:[{...inspected().segments[0],toFrameExclusive:901},...inspected().segments.slice(1)]},
    {segments:[{...inspected().segments[0],extra:true},...inspected().segments.slice(1)]},
    {segments:[...inspected().segments,{id:'segment-04',fromFrame:1802,toFrameExclusive:1900,frameCount:98}]}]) {
    const service=createEditorialFullReviewService({inspect:async()=>({...inspected(),...change}),execute:()=>assert.fail('sink')});
    await assert.rejects(service.preview(input));
  }
  const service=createEditorialFullReviewService({inspect:async()=>({...inspected(),publicSummary:{...inspected().publicSummary,
    sourceHash:hash(5),snapshotHash:hash(5),episodeId:'other',segments:[],durationInFrames:999999,
    formalRender:true,visualAcceptance:true,releaseEligible:true,paidCalls:100,estimatedCostUsd:100}}),execute:()=>assert.fail('sink')});
  const result=await service.preview(input);assert.equal(result.sourceHash,hash(1));assert.notEqual(result.snapshotHash,hash(5));
  assert.equal(result.episodeId,input.episodeId);assert.equal(result.durationInFrames,1802);assert.equal(result.segments.length,3);
  assert.equal(result.formalRender,false);assert.equal(result.paidCalls,0);
  const bad=createEditorialFullReviewService({inspect:async()=>accessor(inspected(),'segments'),execute:()=>assert.fail('sink')});
  await assert.rejects(bad.preview(input));
});

test('missing, forged, wrong-operation, broader and paid capabilities reject before inspection',async()=>{
  const service=createEditorialFullReviewService({inspect:()=>assert.fail('inspection'),execute:()=>assert.fail('sink')});
  const r=fakeRequest();await assert.rejects(service.render(r),{code:'side_effect_capability_missing'});
  await assert.rejects(service.render(r,{sideEffectGrant:editorialFullReviewCapabilitySpec(r)}));
  const broad=authority({maximumCalls:1,maximumCostUsd:1});
  for(const change of [{scopes:[...editorialFullReviewCapabilitySpec(r).scopes,'state.write']},{maxCalls:1},{maxCostUsd:1},
    {operation:'review:render-editorial-clips'},{episodeId:'editorial-full-review/other'}])
    await assert.rejects(service.render(r,{sideEffectGrant:broad.authorize({...editorialFullReviewCapabilitySpec(r),...change})}));
  for(const value of [{...authorization(r),execute:()=>{}},{authorizeSideEffect:()=>assert.fail('injected')},
    accessor(authorization(r),'sideEffectGrant'),hidden(authorization(r)),symbolic(authorization(r))])
    await assert.rejects(service.render(r,value),{code:'editorial_full_review_options_invalid'});
});

test('request binding covers every input/hash, actor and reason independently',async()=>{
  const service=createEditorialFullReviewService({inspect:()=>assert.fail('inspection'),execute:()=>assert.fail('sink')});
  const r=fakeRequest(),options=authorization(r);
  for(const change of [{episodeId:'other',planPath:'outputs/studio/other/editorial-full-review-plans/plan.json'},
    {planPath:input.planPath.replace('plan.json','new.json')},{planSha256:hash(5)},{snapshotHash:hash(5)},
    {sourceHash:hash(5)},{implementationHash:hash(5)},{actor:'human:other'},{reason:'A different private review request'}])
    await assert.rejects(service.render({...r,...change},options),{code:'side_effect_capability_episode_mismatch'});
});

test('dedicated full grants cannot enter old clip service or generic write/network sinks, and vice versa',async()=>{
  const full=fakeRequest(),options=authorization(full),spec=editorialFullReviewCapabilitySpec(full);
  for(const scope of ['filesystem.write','state.write','network.request','local-inference','process.spawn.editorial-review'])
    assert.throws(()=>requireSideEffectGrant(options,{...spec,scopes:[scope]},EDITORIAL_FULL_REVIEW_OPERATION));
  const old={...full,planPath:'outputs/studio/synthetic/review/plan.json',confirmEditorialReviewClips:true};delete old.confirmEditorialFullReview;
  const oldService=createEditorialAvReviewService({inspect:()=>assert.fail('old inspection'),execute:()=>assert.fail('old sink')});
  await assert.rejects(oldService.render(old,options));
  const fullService=createEditorialFullReviewService({inspect:()=>assert.fail('full inspection'),execute:()=>assert.fail('full sink')});
  await assert.rejects(fullService.render(full,{sideEffectGrant:authority().authorize(editorialAvReviewCapabilitySpec(old))}));
});

test('token replay and grant expiry fail, including expiry during inspection and at each sink check',async()=>{
  let now=1000;const auth=authority({now:()=>now,defaultTtlMs:1000,maximumTtlMs:1000});
  const r=fakeRequest(),spec=editorialFullReviewCapabilitySpec(r),token=auth.issue(spec);
  const grant=auth.consume(token,spec);assert.throws(()=>auth.consume(token,spec));
  now=2001;assert.throws(()=>assertEditorialFullReviewGrant(r,{sideEffectGrant:grant}));
  for(const expiresAt of ['inspect','sink']) {
    now=1000;let stage='preview',executed=0,inspections=0;
    const service=createEditorialFullReviewService({inspect:async()=>{inspections++;if(stage==='render'&&expiresAt==='inspect')now=2001;return inspected();},
      execute:async({assertCurrent})=>{if(expiresAt==='sink')now=2001;const before=inspections;await assertCurrent();assert.equal(inspections,before);executed++;}});
    const current=request(await service.preview(input));stage='render';
    await assert.rejects(service.render(current,{sideEffectGrant:auth.authorize(editorialFullReviewCapabilitySpec(current))}));assert.equal(executed,0);
  }
});

test('source, preparation, runtime, implementation and plan drift fail before or at the next sink',async()=>{
  for(const change of [{sourceHash:hash(5)},{implementationHash:hash(5)},{planSha256:hash(5)},
    {runtime:{version:'changed'}},{preparation:{sha256:hash(5)}}]) {
    let state=inspected(),count=0;
    const service=createEditorialFullReviewService({inspect:async()=>state,execute:async({assertCurrent})=>{state={...state,...change};await assertCurrent();count++;}});
    const r=request(await service.preview(input));await assert.rejects(service.render(r,authorization(r)),{code:'editorial_full_review_snapshot_changed'});assert.equal(count,0);
    const next=request(await service.preview(input));state={...state,sourceHash:hash(6)};
    await assert.rejects(service.render(next,authorization(next)),{code:'editorial_full_review_snapshot_changed'});assert.equal(count,0);
  }
});

test('service dependencies are a closed function record; no accessors or additional sinks',()=>{
  const deps={inspect:()=>{},execute:()=>{}};
  for(const bad of [{...deps,runtime:()=>{}},accessor(deps,'execute'),symbolic(deps),{inspect:()=>{},execute:null},null])
    assert.throws(()=>createEditorialFullReviewService(bad));
});

test('CLI defaults to preview and authorizes only a dedicated zero-cost eight-hour local operation',async()=>{
  const previewArgs=['--episode',input.episodeId,'--plan',input.planPath];
  assert.deepEqual(parseEditorialFullReviewArguments(previewArgs),{mode:'preview',request:input});
  let calls=0;const p=await runEditorialFullReviewCli(previewArgs,{preview:async value=>{calls++;assert.deepEqual(value,input);return {review:true};},render:()=>assert.fail('render')});
  assert.equal(p.mode,'preview');assert.equal(calls,1);
  const r=fakeRequest();const result=await runEditorialFullReviewCli(argvFor(r),{render:async(value,options)=>{
    assert.deepEqual(value,r);const grant=assertEditorialFullReviewGrant(value,options);
    assert.equal(grant.operation,'review:render-editorial-full');assert.equal(grant.maxCalls,0);assert.equal(grant.maxCostUsd,0);
    assert.equal(Date.parse(grant.expiresAt)-Date.parse(grant.issuedAt),8*60*60*1000);return {status:'review_candidate'};
  }});
  assert.equal(result.mode,'review_candidate');assert.equal(result.result.status,'review_candidate');
});

test('CLI rejects missing confirmation, duplicates, invalid arrays, unknown flags and dependency overrides',async()=>{
  const args=argvFor(fakeRequest());
  for(const bad of [args.slice(0,-1),[...args,'--confirm-local-full-review'],[...args,'--unknown','x'],
    ['--episode','synthetic','--plan'],['--episode','synthetic','--episode','synthetic','--plan',input.planPath],
    ['--episode','synthetic','--plan',input.planPath,'--reason','x\n'],[null],null])
    assert.throws(()=>parseEditorialFullReviewArguments(bad));
  for(const dependencies of [{execute:()=>{}},{authority:()=>{}},accessor({preview:()=>{}},'preview'),symbolic({}),{preview:1},[]])
    await assert.rejects(runEditorialFullReviewCli(['--episode','synthetic','--plan',input.planPath],dependencies));
});

test('CLI never executes accessors or custom iterators on argument arrays',()=>{
  const args=['--episode','synthetic','--plan',input.planPath];
  const getter=[...args];Object.defineProperty(getter,'0',{enumerable:true,get:()=>assert.fail('argv getter')});
  const iterator=[...args];iterator[Symbol.iterator]=()=>assert.fail('argv iterator');
  const extra=[...args];extra.extra=true;
  const nonenumerable=[...args];Object.defineProperty(nonenumerable,'0',{value:'--episode',enumerable:false});
  const inherited=[...args];Object.setPrototypeOf(inherited,Object.create(Array.prototype));
  for(const bad of [getter,iterator,extra,nonenumerable,inherited,new Array(4)])
    assert.throws(()=>parseEditorialFullReviewArguments(bad),{code:'editorial_full_review_request_invalid'});
});

test('sealed production exports no raw sink and rejects missing authority and dependency overrides before I/O',async()=>{
  const production=await import('../src/server/production/editorial-full-review.mjs');
  assert.deepEqual(Object.keys(production).sort(),['previewEditorialFullReview','renderEditorialFullReview']);
  assert.throws(()=>production.previewEditorialFullReview(input,{workspaceRoot:'/unused'}),TypeError);
  assert.throws(()=>production.renderEditorialFullReview({}, {}, {execute:()=>assert.fail('injected')}),TypeError);
  const r=fakeRequest();
  await assert.rejects(production.renderEditorialFullReview(r),{code:'side_effect_capability_missing'});
  for(const key of ['workspaceRoot','execute','value','assertCurrent','runtime','inspect'])
    await assert.rejects(production.renderEditorialFullReview(r,{...authorization(r),[key]:()=>assert.fail('injected')}),
      {code:'editorial_full_review_options_invalid'});
});
