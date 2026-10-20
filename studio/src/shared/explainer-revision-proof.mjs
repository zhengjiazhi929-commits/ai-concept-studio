// Bounded private-proof data contract. No filesystem, process, network or Episode access.
import {VISUALS} from '../video/explainer-revision/model.mjs';
export function explainerRevisionNeed(value,code='explainer_revision_invalid') {
  if(!value)throw Object.assign(new Error('Explainer revision input/options invalid'),{code});
}
const need=explainerRevisionNeed;
function record(value,keys=null) {
  need(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
  for(const key of Reflect.ownKeys(value)) {
    const d=Object.getOwnPropertyDescriptor(value,key);
    need(typeof key==='string'&&d.enumerable&&Object.hasOwn(d,'value')&&(!keys||keys.includes(key)));
  }
  if(keys)need(keys.every(key=>Object.hasOwn(value,key)));
}
function array(value,min,max) {
  need(Array.isArray(value)&&value.length>=min&&value.length<=max);
  for(const key of Reflect.ownKeys(value)) {
    const d=Object.getOwnPropertyDescriptor(value,key);
    need(Object.hasOwn(d,'value')&&(key==='length'||typeof key==='string'&&/^(0|[1-9][0-9]*)$/u.test(key)&&Number(key)<value.length));
  }
  for(let i=0;i<value.length;i++)need(Object.hasOwn(value,String(i)));
}
const id=value=>need(typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(value));
const text=(value,max)=>need(typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/\p{Cc}/u.test(value));
const integer=(value,min,max)=>need(Number.isSafeInteger(value)&&value>=min&&value<=max);
const hash=value=>need(typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value));
export function validateExplainerRevisionPlan(value) {
  record(value,['schemaVersion','chapters','clips']);need(value.schemaVersion==='explainer-revision-plan-v1');
  array(value.chapters,1,8);array(value.clips,1,3);const chapterIds=new Set(),clipIds=new Set(),segmentIds=new Set();
  for(const c of value.chapters){record(c,['id','label']);id(c.id);text(c.label,40);need(!chapterIds.has(c.id));chapterIds.add(c.id);}
  let previousChapter=-1;
  for(const c of value.clips) {
    record(c,['id','title','segments']);id(c.id);text(c.title,100);need(!clipIds.has(c.id));clipIds.add(c.id);array(c.segments,1,60);
    for(const s of c.segments) {
      record(s,['id','text','visual','chapterId','pauseAfterMs']);id(s.id);id(s.visual);need(VISUALS.includes(s.visual));text(s.text,28);
      need(!segmentIds.has(s.id));segmentIds.add(s.id);need(chapterIds.has(s.chapterId));integer(s.pauseAfterMs,0,3000);
      const chapter=value.chapters.findIndex(v=>v.id===s.chapterId);
      need(chapter>=previousChapter&&chapter<=previousChapter+1);previousChapter=chapter;
    }
  }
  need(segmentIds.size<=60&&previousChapter===value.chapters.length-1);
  need(value.clips.at(-1).segments.at(-1).pauseAfterMs===0);
  return structuredClone(value);
}
export function buildExplainerRevisionTiming(planValue,voice) {
  const plan=validateExplainerRevisionPlan(planValue);record(voice);need(voice.schemaVersion==='explainer-revision-voice-result-v1');
  record(voice.voice);record(voice.audioAssembly);array(voice.segments,1,60);
  need(typeof voice.voice.file==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.wav$/u.test(voice.voice.file));hash(voice.voice.sha256);
  integer(voice.voice.sampleCount,800,3600000);need(voice.voice.sampleCount%800===0);
  need(voice.voice.bytes===44+voice.voice.sampleCount*2);
  const segments=plan.clips.flatMap(c=>c.segments.map(s=>({...s,clipId:c.id})));need(segments.length===voice.segments.length);
  let nextSample=0;
  const timed=segments.map((s,i)=>{
    const v=voice.segments[i];record(v);need(v.id===s.id&&v.text===s.text&&v.clipId===s.clipId);
    integer(v.startSample,0,3600000);integer(v.endSample,v.startSample+6000,3600000);need(v.startSample===nextSample);
    need(v.pauseAfterSamples===s.pauseAfterMs*24);nextSample=v.endSample+v.pauseAfterSamples;
    return {...s,startSample:v.startSample,endSample:v.endSample,startFrame:Math.ceil(v.startSample/800),
      endFrame:Math.ceil(v.endSample/800),pauseAfterFrames:v.pauseAfterSamples/800};
  });
  const a=voice.audioAssembly;integer(a.tailPaddingSamples,0,799);
  need(a.speechAndPauseSamples===nextSample&&a.targetSamples===voice.voice.sampleCount
    &&a.speechAndPauseSamples+a.tailPaddingSamples===a.targetSamples);
  const durationInFrames=a.targetSamples/800;let fromFrame=0;
  const clips=plan.clips.map((c,i)=>{
    const members=timed.filter(s=>s.clipId===c.id),last=members.at(-1);
    const toFrameExclusive=i===plan.clips.length-1?durationInFrames:Math.ceil(last.endSample/800);
    need(toFrameExclusive>fromFrame);
    if(i<plan.clips.length-1) {
      const following=timed.find(s=>s.clipId===plan.clips[i+1].id);
      need(last.pauseAfterMs>=100&&toFrameExclusive*800>=last.endSample&&toFrameExclusive*800<=following.startSample,
        'explainer_revision_interclip_speech_cut');
    }
    const clip={id:c.id,title:c.title,fromFrame,toFrameExclusive,startSample:fromFrame*800,endSample:toFrameExclusive*800,
      speechStartSample:members[0].startSample,speechEndSample:last.endSample};fromFrame=toFrameExclusive;return clip;
  });
  const chapters=plan.chapters.map((c,i)=>({ ...c,startFrame:i===0?0:timed.find(s=>s.chapterId===c.id).startFrame,
    endFrame:i===plan.chapters.length-1?durationInFrames:timed.find(s=>s.chapterId===plan.chapters[i+1].id).startFrame}));
  need(chapters.every(c=>c.endFrame>c.startFrame));
  return {fps:30,sampleRate:24000,width:1920,height:1080,durationInFrames,segments:timed,clips,chapters};
}
export function validateExplainerRevisionPcm(bytes,voice) {
  need(bytes instanceof Uint8Array&&typeof bytes.readUInt32LE==='function'&&bytes.length>=44);
  need(bytes.toString('ascii',0,4)==='RIFF'&&bytes.readUInt32LE(4)===bytes.length-8
    &&bytes.toString('ascii',8,16)==='WAVEfmt '&&bytes.readUInt32LE(16)===16&&bytes.readUInt16LE(20)===1
    &&bytes.readUInt16LE(22)===1&&bytes.readUInt32LE(24)===24000&&bytes.readUInt32LE(28)===48000
    &&bytes.readUInt16LE(32)===2&&bytes.readUInt16LE(34)===16&&bytes.toString('ascii',36,40)==='data'
    &&bytes.readUInt32LE(40)===bytes.length-44&&bytes.length===voice.voice.bytes
    &&(bytes.length-44)/2===voice.voice.sampleCount,'explainer_revision_pcm_invalid');
  need(bytes.subarray(44+voice.audioAssembly.speechAndPauseSamples*2).every(value=>value===0),'explainer_revision_tail_not_silent');
  for(const segment of voice.segments)need(bytes.subarray(44+segment.endSample*2,
    44+(segment.endSample+segment.pauseAfterSamples)*2).every(value=>value===0),'explainer_revision_declared_pause_not_silent');
  return {sampleCount:(bytes.length-44)/2};
}
export function sliceExplainerRevisionPcm(bytes,clip) {
  integer(clip.fromFrame,0,4499);integer(clip.toFrameExclusive,clip.fromFrame+1,4500);
  const from=clip.fromFrame*800,to=clip.toFrameExclusive*800;need(44+to*2<=bytes.length);
  need(from<=clip.speechStartSample&&to>=clip.speechEndSample,'explainer_revision_speech_truncated');
  const output=bytes.constructor.alloc(44+(to-from)*2);bytes.copy(output,0,0,44);bytes.copy(output,44,44+from*2,44+to*2);
  output.writeUInt32LE(output.length-8,4);output.writeUInt32LE(output.length-44,40);return output;
}
function path(value) {
  need(typeof value==='string'&&value.startsWith('outputs/')&&value.endsWith('.json')&&value.length<=500
    &&/^[a-zA-Z0-9_./-]+$/u.test(value)&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'));
}
export function validateExplainerRevisionInput(value) {
  record(value,['planPath','voiceResultPath']);path(value.planPath);path(value.voiceResultPath);need(value.planPath!==value.voiceResultPath);
  return {planPath:value.planPath,voiceResultPath:value.voiceResultPath};
}
export function validateExplainerRevisionRequest(value) {
  record(value,['planPath','voiceResultPath','sourceHash','implementationHash','snapshotHash','confirmLocalProof']);
  const input=validateExplainerRevisionInput({planPath:value.planPath,voiceResultPath:value.voiceResultPath});
  hash(value.sourceHash);hash(value.implementationHash);hash(value.snapshotHash);need(value.confirmLocalProof===true);
  return {...input,sourceHash:value.sourceHash,implementationHash:value.implementationHash,snapshotHash:value.snapshotHash,confirmLocalProof:true};
}
export function parseExplainerRevisionArguments(argv) {
  array(argv,1,14);argv.forEach(v=>text(v,600));const args=[...argv];if(args[0]==='--')args.shift();const value={};
  const flags=new Map([['--plan','planPath'],['--voice-result','voiceResultPath'],['--source-hash','sourceHash'],
    ['--implementation-hash','implementationHash'],['--snapshot','snapshotHash']]);
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--confirm-local-proof'){need(!Object.hasOwn(value,'confirmLocalProof'));value.confirmLocalProof=true;continue;}
    const key=flags.get(args[i]),item=args[++i];need(key&&!Object.hasOwn(value,key)&&item&&!item.startsWith('-'));value[key]=item;
  }
  return Object.keys(value).length===2?{mode:'preview',request:validateExplainerRevisionInput(value)}:
    {mode:'render',request:validateExplainerRevisionRequest(value)};
}
