import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExplainerRevisionPlan,buildExplainerRevisionTiming,validateExplainerRevisionInput,
  validateExplainerRevisionRequest,validateExplainerRevisionPcm,sliceExplainerRevisionPcm,
  parseExplainerRevisionArguments} from '../src/shared/explainer-revision-proof.mjs';
import {explainerRevisionCapabilitySpec,renderExplainerRevisionProof} from '../scripts/render-explainer-revision-proof.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';

const hash='a'.repeat(64);
function fixture() {
  const plan={schemaVersion:'explainer-revision-plan-v1',chapters:[{id:'concept',label:'概念'},{id:'practice',label:'实践'}],
    clips:[{id:'intro',title:'开场',segments:[{id:'s1',text:'讲清概念。',visual:'topic',chapterId:'concept',pauseAfterMs:200}]},
      {id:'example',title:'实践',segments:[{id:'s2',text:'查看订单。',visual:'case',chapterId:'practice',pauseAfterMs:0}]}]};
  const end=12345,start=end+4800,last=start+13611,total=Math.ceil(last/800)*800;
  const voice={schemaVersion:'explainer-revision-voice-result-v1',voice:{file:'voice.wav',sampleCount:total,sha256:hash,bytes:44+total*2},
    audioAssembly:{speechAndPauseSamples:last,tailPaddingSamples:total-last,targetSamples:total},
    segments:[{...plan.clips[0].segments[0],clipId:'intro',startSample:0,endSample:end,pauseAfterSamples:4800},
      {...plan.clips[1].segments[0],clipId:'example',startSample:start,endSample:last,pauseAfterSamples:0}]};
  const pcm=Buffer.alloc(44+total*2);pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);
  pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(24000,24);
  pcm.writeUInt32LE(48000,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(total*2,40);
  return {plan,voice,pcm};
}
const input=()=>({planPath:'outputs/proof/plan.json',voiceResultPath:'outputs/proof/voice-result.json'});
const request=()=>({...input(),sourceHash:hash,implementationHash:hash,snapshotHash:hash,confirmLocalProof:true});
test('closed plan preserves agreed text and visual string IDs',()=>{
  const {plan}=fixture();assert.deepEqual(validateExplainerRevisionPlan(plan),plan);
  for(const alter of [p=>p.extra=true,p=>p.clips[0].segments[0].visual={},p=>p.clips[0].segments[0].chapterId='missing',
    p=>p.clips.push(...structuredClone(p.clips)),p=>p.clips[0].segments.push(structuredClone(p.clips[0].segments[0]))]) {
    const p=structuredClone(plan);alter(p);assert.throws(()=>validateExplainerRevisionPlan(p));
  }
});
test('getters, symbols, unsafe IDs and non-finite pause fail without invoking accessors',()=>{
  const {plan}=fixture();let read=false;Object.defineProperty(plan,'clips',{get(){read=true;return [];},enumerable:true});
  assert.throws(()=>validateExplainerRevisionPlan(plan));assert.equal(read,false);
  const p=fixture().plan;p[Symbol('x')]=1;assert.throws(()=>validateExplainerRevisionPlan(p));
  for(const id of ['../evil','foo/bar','']){const p=fixture().plan;p.clips[0].id=id;assert.throws(()=>validateExplainerRevisionPlan(p));}
  const q=fixture().plan;q.clips[0].segments[0].pauseAfterMs=NaN;assert.throws(()=>validateExplainerRevisionPlan(q));
});
test('global frame/PCM ranges meet inside interclip silence, conserve all samples, and do not reset chapters',()=>{
  const {plan,voice}=fixture();const timing=buildExplainerRevisionTiming(plan,voice);
  assert.equal(timing.clips[0].toFrameExclusive,16);assert.equal(timing.clips[1].fromFrame,16);
  assert.equal(timing.clips[1].toFrameExclusive,timing.durationInFrames);
  assert.equal(timing.segments[1].startSample,17145);assert.equal(timing.segments[1].visual,'case');
  assert.ok(timing.chapters[1].startFrame>0);assert.equal(timing.chapters.at(-1).endFrame,timing.durationInFrames);
  assert.equal(timing.clips.reduce((n,c)=>n+c.toFrameExclusive-c.fromFrame,0),timing.durationInFrames);
});
test('voice source mismatch, reordered speech, gaps, invented padding, and over150s reject',()=>{
  for(const alter of [v=>v.segments[0].text='改稿',v=>v.segments.reverse(),v=>v.segments[1].startSample++,
    v=>v.audioAssembly.tailPaddingSamples++,v=>v.voice.sampleCount=3600800,v=>v.voice.file='../voice.wav']) {
    const {plan,voice}=fixture();alter(voice);assert.throws(()=>buildExplainerRevisionTiming(plan,voice));
  }
});
test('interclip speech cannot be cut when pause is missing; backwards chapters reject',()=>{
  const {plan,voice}=fixture();plan.clips[0].segments[0].pauseAfterMs=0;voice.segments[0].pauseAfterSamples=0;
  assert.throws(()=>buildExplainerRevisionTiming(plan,voice));
  const p=fixture().plan;p.clips[0].segments[0].chapterId='practice';p.clips[1].segments[0].chapterId='concept';
  assert.throws(()=>validateExplainerRevisionPlan(p));
});
test('strict24k monoPCM16 and zero final padding; slices reassemble original aligned data',()=>{
  const {plan,voice,pcm}=fixture();validateExplainerRevisionPcm(pcm,voice);
  const timing=buildExplainerRevisionTiming(plan,voice);const parts=timing.clips.map(c=>sliceExplainerRevisionPcm(pcm,c));
  assert.deepEqual(Buffer.concat(parts.map(x=>x.subarray(44))),pcm.subarray(44));
  const bad=Buffer.from(pcm);bad.writeUInt32LE(48000,24);assert.throws(()=>validateExplainerRevisionPcm(bad,voice));
  const pad=Buffer.from(pcm);pad[pad.length-1]=1;assert.throws(()=>validateExplainerRevisionPcm(pad,voice));
  const pause=Buffer.from(pcm);pause[44+voice.segments[0].endSample*2]=1;assert.throws(()=>validateExplainerRevisionPcm(pause,voice));
});
test('input path, execution confirmation and explicit hashes are closed',()=>{
  assert.deepEqual(validateExplainerRevisionInput(input()),input());assert.deepEqual(validateExplainerRevisionRequest(request()),request());
  for(const planPath of ['/tmp/x','outputs/../x','data/episode.json','outputs//a.json'])assert.throws(()=>validateExplainerRevisionInput({...input(),planPath}));
  assert.throws(()=>validateExplainerRevisionRequest({...request(),confirmLocalProof:false}));
  assert.throws(()=>validateExplainerRevisionRequest({...request(),episodeId:'live'}));
});
test('CLI defaults to preview; unknown/duplicate flags or incomplete execution fail',()=>{
  assert.equal(parseExplainerRevisionArguments(['--plan',input().planPath,'--voice-result',input().voiceResultPath]).mode,'preview');
  assert.throws(()=>parseExplainerRevisionArguments(['--plan',input().planPath,'--voice-result',input().voiceResultPath,'--confirm-local-proof']));
  assert.throws(()=>parseExplainerRevisionArguments(['--plan',input().planPath,'--plan',input().planPath]));
});
test('sealed execution rejects absent/forged/wrong-scope grants before live input access',async()=>{
  await assert.rejects(renderExplainerRevisionProof(request()),{code:'side_effect_capability_missing'});
  await assert.rejects(renderExplainerRevisionProof(request(),{sideEffectGrant:{}}),{code:'side_effect_capability_missing'});
  const authority=createCapabilityAuthority({secret:'synthetic-only-authority-not-production',maximumCalls:0,maximumCostUsd:0});
  const sideEffectGrant=authority.authorize({...explainerRevisionCapabilitySpec(request()),scopes:['filesystem.write','process.spawn']});
  await assert.rejects(renderExplainerRevisionProof(request(),{sideEffectGrant}),{code:'side_effect_capability_scope_mismatch'});
  await assert.rejects(renderExplainerRevisionProof(request(),{execute:()=>null}),/options|invalid/u);
});
test('fixed operation and subject prevent grant replay between requests and existing clips',async()=>{
  const authority=createCapabilityAuthority({secret:'synthetic-only-authority-not-production',maximumCalls:0,maximumCostUsd:0});
  const spec=explainerRevisionCapabilitySpec(request());assert.equal(spec.operation,'review:render-explainer-revision-proof');
  assert.equal(spec.maxCalls,0);assert.equal(spec.maxCostUsd,0);
  const sideEffectGrant=authority.authorize(spec);
  await assert.rejects(renderExplainerRevisionProof({...request(),sourceHash:'b'.repeat(64)},{sideEffectGrant}),{code:'side_effect_capability_episode_mismatch'});
  const broad=authority.authorize({...spec,scopes:[...spec.scopes,'state.write']});
  await assert.rejects(renderExplainerRevisionProof(request(),{sideEffectGrant:broad}),{code:'explainer_revision_capability_scope_invalid'});
});
test('unknown visual state and overlong spoken phrase fail before rendering',()=>{
  const p=fixture().plan;p.clips[0].segments[0].visual='unknown';assert.throws(()=>validateExplainerRevisionPlan(p));
  const q=fixture().plan;q.clips[0].segments[0].text='字'.repeat(29);assert.throws(()=>validateExplainerRevisionPlan(q));
});
test('exactly150s is allowed but one extra frame is not',()=>{
  const {plan,voice}=fixture();voice.segments[1].endSample=3600000;voice.voice.sampleCount=3600000;voice.voice.bytes=7200044;
  voice.audioAssembly={speechAndPauseSamples:3600000,tailPaddingSamples:0,targetSamples:3600000};
  assert.equal(buildExplainerRevisionTiming(plan,voice).durationInFrames,4500);
  voice.voice.sampleCount=3600800;assert.throws(()=>buildExplainerRevisionTiming(plan,voice));
});
test('expired capability fails before source I/O',async()=>{
  let now=Date.now();const authority=createCapabilityAuthority({secret:'synthetic-only-authority-not-production',now:()=>now,defaultTtlMs:50,maximumTtlMs:50});
  const sideEffectGrant=authority.authorize(explainerRevisionCapabilitySpec(request()));now+=51;
  await assert.rejects(renderExplainerRevisionProof(request(),{sideEffectGrant}),{code:'side_effect_capability_expired'});
});
test('CLI arguments reject getters and Symbol keys without executing them',()=>{
  const args=['--plan','outputs/x.json'];let read=false;Object.defineProperty(args,'0',{get(){read=true;return '--plan';}});
  assert.throws(()=>parseExplainerRevisionArguments(args));assert.equal(read,false);
  const values=['--plan','outputs/x.json'];values[Symbol('extra')]=1;assert.throws(()=>parseExplainerRevisionArguments(values));
});
test('zero-pause adjacent sentences have no caption-frame overlap at noninteger boundaries',()=>{
  const {plan,voice}=fixture();plan.clips[0].segments.push({id:'s1b',text:'再讲关系。',visual:'relationship',chapterId:'concept',pauseAfterMs:200});
  plan.clips[0].segments[0].pauseAfterMs=0;
  voice.segments.splice(1,0,{id:'s1b',text:'再讲关系。',clipId:'intro',startSample:12345,endSample:20345,pauseAfterSamples:4800});
  voice.segments[0].pauseAfterSamples=0;voice.segments[2].startSample=25145;voice.segments[2].endSample=38756;
  voice.voice.sampleCount=39200;voice.voice.bytes=78444;voice.audioAssembly={speechAndPauseSamples:38756,tailPaddingSamples:444,targetSamples:39200};
  const timing=buildExplainerRevisionTiming(plan,voice);
  assert.equal(timing.segments[0].endFrame,timing.segments[1].startFrame);
  assert.equal(timing.segments[1].startFrame,16);
  assert.ok(timing.segments.every((s,i)=>!i||s.startFrame>=timing.segments[i-1].endFrame));
});
