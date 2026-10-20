// Independent PRIVATE full-revision contract. Never expands the150s proof or reads an Episode.
import {createHash} from 'node:crypto';
import {validateFullReviewCheckpoint} from '../server/production/editorial-full-review-runtime.mjs';

export const EXPLAINER_FULL_REVISION_MAX_FRAMES=27000;
const MAX_SAMPLES=EXPLAINER_FULL_REVISION_MAX_FRAMES*800;
const LAYOUTS=['topic','outline','compare','flow','sources','input','answer','record','tests','lifecycle'];
const CHAPTERS=['concept','types','relationship','practice'];
export function explainerFullRevisionNeed(value,code='explainer_full_revision_invalid') {
  if(!value)throw Object.assign(new Error('Private full revision input or frozen evidence invalid'),{code});
}
const need=explainerFullRevisionNeed;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>sha(`${JSON.stringify(value,null,2)}\n`);
function data(value,depth=0) {
  need(depth<=32);
  if(value===null||typeof value==='boolean'||typeof value==='string')return;
  if(typeof value==='number'){need(Number.isFinite(value));return;}
  if(Array.isArray(value)){array(value,0,10000);for(const item of value)data(item,depth+1);return;}
  record(value);for(const item of Object.values(value))data(item,depth+1);
}
function record(value,keys=null) {
  need(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
  for(const key of Reflect.ownKeys(value)) {
    const d=Object.getOwnPropertyDescriptor(value,key);
    need(typeof key==='string'&&d.enumerable&&Object.hasOwn(d,'value')&&(!keys||keys.includes(key)));
  }
  if(keys)need(keys.every(key=>Object.hasOwn(value,key)));
}
function array(value,min,max) {
  need(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length>=min&&value.length<=max);
  for(const key of Reflect.ownKeys(value)) {
    const d=Object.getOwnPropertyDescriptor(value,key);
    need(Object.hasOwn(d,'value')&&(key==='length'||typeof key==='string'&&/^(0|[1-9][0-9]*)$/u.test(key)&&Number(key)<value.length));
  }
  for(let i=0;i<value.length;i++)need(Object.hasOwn(value,String(i)));
}
const id=value=>need(typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(value));
const text=(value,max,min=1)=>need(typeof value==='string'&&value.trim()===value&&[...value].length>=min&&[...value].length<=max&&!/\p{Cc}/u.test(value));
const integer=(value,min,max)=>need(Number.isSafeInteger(value)&&value>=min&&value<=max);
const hash=value=>need(typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value));
export function explainerFullRevisionSafePath(value) {
  return typeof value==='string'&&/^[a-zA-Z0-9_./@-]+$/u.test(value)&&!value.startsWith('/')
    &&value.split('/').every(p=>p&&p!=='.'&&p!=='..');
}
export function validateExplainerFullRevisionPlan(value) {
  record(value,['schemaVersion','chapters','scenes']);need(value.schemaVersion==='explainer-full-revision-plan-v1');
  array(value.chapters,4,4);array(value.scenes,4,64);
  value.chapters.forEach((c,i)=>{record(c,['id','label']);need(c.id===CHAPTERS[i]);text(c.label,40);});
  const sceneIds=new Set(),segmentIds=new Set();let previousChapter=-1;
  for(const scene of value.scenes) {
    record(scene,['id','title','chapterId','layout','items','note','segments']);id(scene.id);text(scene.title,32);
    need(!sceneIds.has(scene.id));sceneIds.add(scene.id);need(LAYOUTS.includes(scene.layout));text(scene.note,65,0);
    const chapter=CHAPTERS.indexOf(scene.chapterId);need(chapter>=0&&chapter>=previousChapter&&chapter<=previousChapter+1);previousChapter=chapter;
    array(scene.items,1,scene.layout==='sources'?5:4);
    for(const item of scene.items){record(item,['title','body']);text(item.title,18);text(item.body,scene.layout==='sources'?22:55,0);}
    array(scene.segments,1,64);let revealCount=0;
    for(const segment of scene.segments) {
      record(segment,['id','text','pauseAfterMs','focusIndex','revealCount']);id(segment.id);text(segment.text,28);
      need(!segmentIds.has(segment.id));segmentIds.add(segment.id);integer(segment.pauseAfterMs,0,1000);
      integer(segment.revealCount,1,scene.items.length);integer(segment.focusIndex,-1,segment.revealCount-1);
      need(segment.revealCount>=revealCount);revealCount=segment.revealCount;
    }
    if(scene!==value.scenes.at(-1))need(scene.segments.at(-1).pauseAfterMs>=100);
  }
  need(segmentIds.size<=260&&previousChapter===3&&value.scenes.at(-1).segments.at(-1).pauseAfterMs===0);
  return structuredClone(value);
}
export function buildExplainerFullRevisionTiming(planValue,voice) {
  const plan=validateExplainerFullRevisionPlan(planValue);data(voice);need(voice.schemaVersion==='explainer-full-revision-voice-result-v1');
  record(voice.voice);record(voice.audioAssembly);array(voice.segments,4,260);
  need(typeof voice.voice.file==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.wav$/u.test(voice.voice.file));hash(voice.voice.sha256);
  integer(voice.voice.sampleCount,800,MAX_SAMPLES);need(voice.voice.sampleCount%800===0);
  need(voice.voice.bytes===44+voice.voice.sampleCount*2);
  const flat=plan.scenes.flatMap(scene=>scene.segments.map(s=>({...s,sceneId:scene.id,chapterId:scene.chapterId})));
  need(flat.length===voice.segments.length);let nextSample=0;
  const segments=flat.map((segment,i)=>{
    const v=voice.segments[i];record(v);need(v.id===segment.id&&v.text===segment.text&&v.sceneId===segment.sceneId);
    integer(v.startSample,0,MAX_SAMPLES);integer(v.endSample,v.startSample+6000,MAX_SAMPLES);need(v.startSample===nextSample);
    need(v.pauseAfterSamples===segment.pauseAfterMs*24);nextSample=v.endSample+v.pauseAfterSamples;need(nextSample<=MAX_SAMPLES);
    return {...segment,startSample:v.startSample,endSample:v.endSample,startFrame:Math.ceil(v.startSample/800),
      endFrame:Math.ceil(v.endSample/800),pauseAfterFrames:v.pauseAfterSamples/800};
  });
  const a=voice.audioAssembly;integer(a.tailPaddingSamples,0,799);
  need(a.speechAndPauseSamples===nextSample&&a.targetSamples===voice.voice.sampleCount&&nextSample+a.tailPaddingSamples===a.targetSamples);
  const durationInFrames=a.targetSamples/800;
  const scenes=plan.scenes.map((scene,i)=>{
    const members=segments.filter(s=>s.sceneId===scene.id),following=segments.find(s=>s.sceneId===plan.scenes[i+1]?.id);
    return {...scene,startFrame:i===0?0:members[0].startFrame,endFrame:following?.startFrame??durationInFrames,segments:members};
  });
  need(scenes.every(s=>s.endFrame>s.startFrame&&s.segments.every(v=>v.startFrame>=s.startFrame&&v.endFrame<=s.endFrame)));
  const chapters=plan.chapters.map((c,i)=>({...c,startFrame:i===0?0:segments.find(s=>s.chapterId===c.id).startFrame,
    endFrame:i===3?durationInFrames:segments.find(s=>s.chapterId===plan.chapters[i+1].id).startFrame}));
  need(chapters.every(c=>c.endFrame>c.startFrame));
  return {fps:30,sampleRate:24000,width:1920,height:1080,durationInFrames,segments,scenes,chapters};
}
export function validateExplainerFullRevisionPcm(bytes,voice) {
  data(voice);need(bytes instanceof Uint8Array&&typeof bytes.readUInt32LE==='function'&&bytes.length>=44);
  need(bytes.toString('ascii',0,4)==='RIFF'&&bytes.readUInt32LE(4)===bytes.length-8
    &&bytes.toString('ascii',8,16)==='WAVEfmt '&&bytes.readUInt32LE(16)===16&&bytes.readUInt16LE(20)===1
    &&bytes.readUInt16LE(22)===1&&bytes.readUInt32LE(24)===24000&&bytes.readUInt32LE(28)===48000
    &&bytes.readUInt16LE(32)===2&&bytes.readUInt16LE(34)===16&&bytes.toString('ascii',36,40)==='data'
    &&bytes.readUInt32LE(40)===bytes.length-44&&bytes.length===voice.voice.bytes
    &&(bytes.length-44)/2===voice.voice.sampleCount&&sha(bytes)===voice.voice.sha256,'explainer_full_revision_pcm_invalid');
  need(bytes.subarray(44+voice.audioAssembly.speechAndPauseSamples*2).every(x=>x===0),'explainer_full_revision_tail_not_silent');
  for(const s of voice.segments)need(bytes.subarray(44+s.endSample*2,44+(s.endSample+s.pauseAfterSamples)*2).every(x=>x===0),
    'explainer_full_revision_declared_pause_not_silent');
  return {sampleCount:(bytes.length-44)/2};
}
export function buildExplainerFullRevisionChunks(durationInFrames) {
  integer(durationInFrames,1,EXPLAINER_FULL_REVISION_MAX_FRAMES);const chunks=[];
  for(let fromFrame=0;fromFrame<durationInFrames;fromFrame+=900){const toFrameExclusive=Math.min(fromFrame+900,durationInFrames);
    chunks.push({id:`segment-${String(chunks.length+1).padStart(2,'0')}`,fromFrame,toFrameExclusive,frameCount:toFrameExclusive-fromFrame});}
  return chunks;
}
function inputPath(path){need(explainerFullRevisionSafePath(path)&&path.startsWith('outputs/')&&path.endsWith('.json')&&path.length<=500);}
export function validateExplainerFullRevisionInput(value) {
  record(value,['planPath','voiceResultPath']);inputPath(value.planPath);inputPath(value.voiceResultPath);need(value.planPath!==value.voiceResultPath);
  return structuredClone(value);
}
export function validateExplainerFullRevisionRequest(value) {
  record(value,['planPath','voiceResultPath','sourceHash','implementationHash','snapshotHash','confirmLocalFullReview']);
  validateExplainerFullRevisionInput({planPath:value.planPath,voiceResultPath:value.voiceResultPath});
  hash(value.sourceHash);hash(value.implementationHash);hash(value.snapshotHash);need(value.confirmLocalFullReview===true);return structuredClone(value);
}
export function parseExplainerFullRevisionArguments(argv) {
  array(argv,1,14);argv.forEach(v=>text(v,600));const args=[...argv];if(args[0]==='--')args.shift();const value={};
  const flags=new Map([['--plan','planPath'],['--voice-result','voiceResultPath'],['--source-hash','sourceHash'],['--implementation-hash','implementationHash'],['--snapshot','snapshotHash']]);
  for(let i=0;i<args.length;i++){
    if(args[i]==='--confirm-local-full-review'){need(!Object.hasOwn(value,'confirmLocalFullReview'));value.confirmLocalFullReview=true;continue;}
    const key=flags.get(args[i]),item=args[++i];need(key&&!Object.hasOwn(value,key)&&item&&!item.startsWith('-'));value[key]=item;
  }
  return Object.keys(value).length===2?{mode:'preview',request:validateExplainerFullRevisionInput(value)}:
    {mode:'render',request:validateExplainerFullRevisionRequest(value)};
}
export function validateExplainerFullRevisionManifest(value,summary,request) {
  data(value);data(summary);validateExplainerFullRevisionRequest(request);
  need(request.snapshotHash===digest(summary)&&digest(summary.chunks)===digest(buildExplainerFullRevisionChunks(summary.durationInFrames)));
  record(value,['schemaVersion','request','sourceHash','implementationHash','snapshotHash','gitHead','sourceFiles','implementationFiles','runtime',
    'durationInFrames','fps','width','height','inputPropsSha256','video','chunks','files','audio','fullDecodePassed','formalRender','visualAcceptance',
    'continuousHumanReview','episodeMutated','releaseEligible','paidCalls','maximumPaidCostUsd','assurance']);
  need(value.schemaVersion==='explainer-full-revision-candidate-v1'&&digest(value.request)===digest(request)
    &&value.sourceHash===summary.sourceHash&&value.implementationHash===summary.implementationHash&&value.snapshotHash===request.snapshotHash
    &&value.durationInFrames===summary.durationInFrames&&value.fullDecodePassed===true&&value.formalRender===false
    &&value.visualAcceptance===false&&value.episodeMutated===false&&value.releaseEligible===false&&value.paidCalls===0
    &&value.continuousHumanReview===false&&value.maximumPaidCostUsd===0&&value.fps===30&&value.width===1920&&value.height===1080
    &&value.gitHead===summary.gitHead&&value.inputPropsSha256===digest(summary.inputProps)
    &&digest(value.sourceFiles)===digest(summary.sourceFiles)&&digest(value.implementationFiles)===digest(summary.implementationFiles)
    &&digest(value.runtime)===digest(summary.runtime)
    &&value.assurance==='private complete revision; machine decode does not replace visual QA or continuous listening/viewing');
  array(value.chunks,1,30);need(value.chunks.length===summary.chunks.length);
  value.chunks.forEach((c,i)=>{validateFullReviewCheckpoint(c,summary.chunks[i],digest(request));
    if(i)need(digest(c.signature)===digest(value.chunks[0].signature));});
  array(value.files,1,4000);const files=new Map();
  for(const file of value.files){record(file,['path','bytes','sha256']);need(explainerFullRevisionSafePath(file.path)&&!files.has(file.path));
    integer(file.bytes,1,Number.MAX_SAFE_INTEGER);hash(file.sha256);files.set(file.path,file);}
  record(value.video,['path','bytes','sha256']);const token=/^full-review\.([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.mp4$/u.exec(value.video.path)?.[1];need(token);
  need(digest(files.get(value.video.path))===digest(value.video));
  for(const chunk of value.chunks)need(digest(files.get(chunk.file.path))===digest(chunk.file));
  record(value.audio,['sourceAudioSha256','sampleCount','aacEncodesForThisDeliveredAttempt','assemblyEvidencePath']);
  const sourceAudio=summary.sourceFiles[2];
  need(value.audio.sourceAudioSha256===sourceAudio.sha256&&value.audio.sampleCount===summary.durationInFrames*800
    &&value.audio.aacEncodesForThisDeliveredAttempt===1&&value.audio.assemblyEvidencePath===`assembly-${token}.json`);
  const exact=(path,bytes,sha256)=>need(digest(files.get(path))===digest({path,bytes,sha256}));
  for(const [path,content] of [['request.json',request],['source-manifest.json',summary],['input-props.json',summary.inputProps]]){
    const bytes=Buffer.byteLength(`${JSON.stringify(content,null,2)}\n`);exact(path,bytes,digest(content));
  }
  for(const [index,path] of ['plan.json','voice-result.json','full-narration.wav'].entries()){
    const file=summary.sourceFiles[index];exact(path,file.bytes,file.sha256);
  }
  for(const file of summary.implementationFiles)exact(file.path.startsWith('studio/public/')?`public/${file.path.slice(14)}`:`snapshot/${file.path}`,file.bytes,file.sha256);
  for(const chunk of value.chunks){const content=`${JSON.stringify(chunk,null,2)}\n`;exact(`${chunk.segment.id}.json`,Buffer.byteLength(content),sha(content));}
  need(files.has('bundle-manifest.json')&&files.has(value.audio.assemblyEvidencePath)&&files.has(`concat-${token}.txt`)&&files.has(`full-silent-${token}.mp4`));
  return structuredClone(value);
}
