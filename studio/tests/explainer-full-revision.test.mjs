import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateExplainerFullRevisionPlan,buildExplainerFullRevisionTiming,validateExplainerFullRevisionPcm,
  validateExplainerFullRevisionInput,validateExplainerFullRevisionRequest,parseExplainerFullRevisionArguments,
  buildExplainerFullRevisionChunks,validateExplainerFullRevisionManifest} from '../src/shared/explainer-full-revision.mjs';

const hash='a'.repeat(64);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const chapters=['concept','types','relationship','practice'].map(id=>({id,label:id}));
  const plan={schemaVersion:'explainer-full-revision-plan-v1',chapters,scenes:chapters.map((c,i)=>({
    id:`scene-${i}`,title:`标题${i}`,chapterId:c.id,layout:'compare',items:[{title:'标题',body:'具体说明'}],note:'',
    segments:[{id:`s${i}`,text:'讲清楚完整内容。',pauseAfterMs:i===3?0:200,focusIndex:0,revealCount:1}]}))};
  let next=0;
  const segments=plan.scenes.flatMap(scene=>scene.segments.map(s=>{const startSample=next,endSample=next+18123;
    next=endSample+s.pauseAfterMs*24;return {...s,sceneId:scene.id,startSample,endSample,pauseAfterSamples:s.pauseAfterMs*24};}));
  const total=Math.ceil(next/800)*800,pcm=Buffer.alloc(44+total*2);
  pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);
  pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(24000,24);pcm.writeUInt32LE(48000,28);
  pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(total*2,40);
  for(const s of segments)pcm.writeInt16LE(300,44+s.startSample*2);
  const voice={schemaVersion:'explainer-full-revision-voice-result-v1',voice:{file:'voice.wav',sampleCount:total,bytes:pcm.length,sha256:sha(pcm)},
    audioAssembly:{speechAndPauseSamples:next,tailPaddingSamples:total-next,targetSamples:total},segments};
  return {plan,voice,pcm};
}
const input=()=>({planPath:'outputs/full/plan.json',voiceResultPath:'outputs/full/voice-result.json'});
const request=()=>({...input(),sourceHash:hash,implementationHash:hash,snapshotHash:hash,confirmLocalFullReview:true});

test('full contract is independent, closed and requires ordered complete four-chapter coverage',()=>{
  const {plan}=fixture();assert.deepEqual(validateExplainerFullRevisionPlan(plan),plan);
  for(const mutate of [p=>p.extra=true,p=>p.chapters.pop(),p=>p.scenes.pop(),p=>p.scenes.reverse(),p=>p.scenes[0].layout='invented',
    p=>p.scenes[0].segments[0].focusIndex=1,p=>p.scenes[0].segments[0].revealCount=0,p=>p.scenes[0].id='../outside',
    p=>p.scenes[0].segments[0].text='很'.repeat(29),p=>p.scenes.at(-1).segments.at(-1).pauseAfterMs=10]) {
    const p=structuredClone(plan);mutate(p);assert.throws(()=>validateExplainerFullRevisionPlan(p));
  }
  const unicode=structuredClone(plan);unicode.scenes[0].segments[0].text='𠮷'.repeat(28);validateExplainerFullRevisionPlan(unicode);
});
test('data-only validation rejects getters, symbols, sparse arrays and unsafe visual state without executing accessors',()=>{
  const {plan}=fixture();let invoked=false;Object.defineProperty(plan.scenes[0],'title',{enumerable:true,get(){invoked=true;return 'x';}});
  assert.throws(()=>validateExplainerFullRevisionPlan(plan));assert.equal(invoked,false);
  for(const mutate of [p=>p.scenes[0][Symbol('x')]=1,p=>delete p.scenes[1],p=>p.scenes[0].segments[0].pauseAfterMs=NaN]){
    const p=fixture().plan;mutate(p);assert.throws(()=>validateExplainerFullRevisionPlan(p));
  }
});
test('timing conserves real PCM, ceil-projects captions and makes contiguous scenes and proportional chapters',()=>{
  const {plan,voice}=fixture(),timing=buildExplainerFullRevisionTiming(plan,voice);
  assert.equal(timing.durationInFrames,voice.voice.sampleCount/800);assert.equal(timing.scenes[0].startFrame,0);
  for(let i=1;i<timing.scenes.length;i++)assert.equal(timing.scenes[i].startFrame,timing.scenes[i-1].endFrame);
  assert.equal(timing.scenes.at(-1).endFrame,timing.durationInFrames);
  assert.equal(timing.segments[0].endFrame,Math.ceil(18123/800));
  assert.equal(timing.chapters.reduce((n,c)=>n+c.endFrame-c.startFrame,0),timing.durationInFrames);
  assert.deepEqual(timing.scenes.map(s=>s.id),plan.scenes.map(s=>s.id));
});
test('tampered voice text, scene, gap, pause, reordered and invented padding refuse before media generation',()=>{
  for(const mutate of [v=>v.segments[0].text='不同内容',v=>v.segments[0].sceneId='elsewhere',v=>v.segments.reverse(),
    v=>v.segments[1].startSample++,v=>v.segments[0].pauseAfterSamples++,v=>v.audioAssembly.tailPaddingSamples++,
    v=>v.voice.sampleCount=21600800,v=>v.voice.file='../voice.wav']){
    const {plan,voice}=fixture();mutate(voice);assert.throws(()=>buildExplainerFullRevisionTiming(plan,voice));
  }
});
test('strict PCM hash, format, final padding and every declared pause are validated',()=>{
  const {plan,voice,pcm}=fixture();buildExplainerFullRevisionTiming(plan,voice);validateExplainerFullRevisionPcm(pcm,voice);
  for(const mutate of [b=>b.writeUInt32LE(48000,24),b=>b[44]=7,b=>b[b.length-1]=1,
    b=>b[44+voice.segments[0].endSample*2]=1]){
    const bytes=Buffer.from(pcm);mutate(bytes);assert.throws(()=>validateExplainerFullRevisionPcm(bytes,voice));
  }
  const corrupt=Buffer.from(pcm);corrupt[44+voice.segments[0].endSample*2]=1;
  assert.throws(()=>validateExplainerFullRevisionPcm(corrupt,{...voice,voice:{...voice.voice,sha256:sha(corrupt)}}));
});
test('900frame chunk plans cover maximum15minutes without overlaps or truncated tail',()=>{
  for(const frames of [1,899,900,901,21492,27000]){
    const chunks=buildExplainerFullRevisionChunks(frames);assert.equal(chunks[0].fromFrame,0);
    assert.equal(chunks.at(-1).toFrameExclusive,frames);assert.equal(chunks.reduce((n,c)=>n+c.frameCount,0),frames);
    chunks.forEach((c,i)=>{assert.ok(c.frameCount<=900);if(i)assert.equal(c.fromFrame,chunks[i-1].toFrameExclusive);});
  }
  for(const frames of [0,27001,NaN,1.2])assert.throws(()=>buildExplainerFullRevisionChunks(frames));
});
test('unsafe input paths, missing explicit review confirmation and injected CLI flags fail closed',()=>{
  assert.deepEqual(validateExplainerFullRevisionInput(input()),input());assert.deepEqual(validateExplainerFullRevisionRequest(request()),request());
  for(const path of ['/tmp/x.json','outputs/../x.json','outputs//x.json','studio/data/episode.json','outputs/x.json/'])
    assert.throws(()=>validateExplainerFullRevisionInput({...input(),planPath:path}));
  for(const extra of [{confirmLocalFullReview:false},{outputPath:'outputs/overwrite'},{sourceHash:'changed'}])
    assert.throws(()=>validateExplainerFullRevisionRequest({...request(),...extra}));
  assert.equal(parseExplainerFullRevisionArguments(['--plan',input().planPath,'--voice-result',input().voiceResultPath]).mode,'preview');
  const args=['--plan',input().planPath,'--voice-result',input().voiceResultPath,'--source-hash',hash,'--implementation-hash',hash,'--snapshot',hash,'--confirm-local-full-review'];
  assert.equal(parseExplainerFullRevisionArguments(args).mode,'render');
  assert.throws(()=>parseExplainerFullRevisionArguments([...args,'--output','/tmp/overwrite']));
});
test('completed manifest validator rejects changed request, missing chunks or forged release flags',()=>{
  const requestValue=request(),{plan,voice}=fixture(),timing=buildExplainerFullRevisionTiming(plan,voice);
  const chunks=buildExplainerFullRevisionChunks(timing.durationInFrames),name='segment-01.11111111-1111-1111-1111-111111111111.mp4';
  const record={path:name,bytes:100,sha256:hash};
  const sourceFiles=[{path:'outputs/full/plan.json',bytes:200,sha256:hash},{path:'outputs/full/voice-result.json',bytes:300,sha256:hash},
    {path:'outputs/full/voice.wav',bytes:voice.voice.bytes,sha256:voice.voice.sha256}];
  const summary={sourceHash:hash,implementationHash:hash,durationInFrames:timing.durationInFrames,chunks,
    gitHead:'1'.repeat(40),sourceFiles,implementationFiles:[],runtime:{node:{path:'/synthetic/node',sha256:hash}},inputProps:{plan,timing}};
  requestValue.snapshotHash=sha(`${JSON.stringify(summary,null,2)}\n`);
  const manifest={schemaVersion:'explainer-full-revision-candidate-v1',request:requestValue,sourceHash:hash,implementationHash:hash,snapshotHash:requestValue.snapshotHash,
    durationInFrames:timing.durationInFrames,chunks:[{schemaVersion:'editorial-full-review-segment-v1',requestHash:sha(`${JSON.stringify(requestValue,null,2)}\n`),segment:chunks[0],file:record,signature:{codec_name:'h264'},fullDecodePassed:true}],
    video:{path:'full-review.11111111-1111-1111-1111-111111111111.mp4',bytes:200,sha256:hash},
    files:[record,{path:'full-review.11111111-1111-1111-1111-111111111111.mp4',bytes:200,sha256:hash}],
    gitHead:summary.gitHead,sourceFiles,implementationFiles:[],runtime:summary.runtime,inputPropsSha256:sha(`${JSON.stringify(summary.inputProps,null,2)}\n`),
    fps:30,width:1920,height:1080,audio:{sourceAudioSha256:voice.voice.sha256,sampleCount:voice.voice.sampleCount,aacEncodesForThisDeliveredAttempt:1,
      assemblyEvidencePath:'assembly-11111111-1111-1111-1111-111111111111.json'},fullDecodePassed:true,formalRender:false,visualAcceptance:false,
    continuousHumanReview:false,episodeMutated:false,releaseEligible:false,paidCalls:0,maximumPaidCostUsd:0,
    assurance:'private complete revision; machine decode does not replace visual QA or continuous listening/viewing'};
  const add=(path,content)=>{const bytes=`${JSON.stringify(content,null,2)}\n`;manifest.files.push({path,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)});};
  for(const [path,content] of [['request.json',requestValue],['source-manifest.json',summary],['input-props.json',summary.inputProps],
    ['segment-01.json',manifest.chunks[0]]])add(path,content);
  ['plan.json','voice-result.json','full-narration.wav'].forEach((path,i)=>manifest.files.push({...sourceFiles[i],path}));
  manifest.files.push({path:'bundle-manifest.json',bytes:2,sha256:hash},{path:manifest.audio.assemblyEvidencePath,bytes:2,sha256:hash});
  manifest.files.push({path:'concat-11111111-1111-1111-1111-111111111111.txt',bytes:2,sha256:hash},
    {path:'full-silent-11111111-1111-1111-1111-111111111111.mp4',bytes:2,sha256:hash});
  validateExplainerFullRevisionManifest(manifest,summary,requestValue);
  for(const mutate of [m=>m.request.sourceHash='b'.repeat(64),m=>m.chunks=[],m=>m.releaseEligible=true,m=>m.files[0].path='../elsewhere',
    m=>m.runtime.node.sha256='b'.repeat(64),m=>m.audio.aacEncodesForThisDeliveredAttempt=2,m=>m.files.pop(),m=>m.continuousHumanReview=true,
    m=>m.extra=true,m=>m.inputPropsSha256='b'.repeat(64)]){
    const m=structuredClone(manifest);mutate(m);assert.throws(()=>validateExplainerFullRevisionManifest(m,summary,requestValue));
  }
});
