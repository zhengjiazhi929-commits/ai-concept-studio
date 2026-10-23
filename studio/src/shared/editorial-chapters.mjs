import {EDITORIAL_TIMING_POLICY, cueFrameAtNarrationPosition} from './editorial-timing.mjs';

export const EDITORIAL_CHAPTERS_VERSION = 'editorial-chapters-v1';
const MAXIMUM_FRAMES = 108000;
const fail = () => {throw Object.assign(new Error('章节导航必须绑定原文与完整有序时间轴'),
  {code:'editorial_chapter_contract_invalid'});};
const requireValue = value => {if(!value)fail();};
const identifier = value => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(value);
const text = value => typeof value==='string' && value.trim().length>0 && value.length<=20000
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const label = value => text(value) && value.trim()===value && !/[\r\n\t]/u.test(value) && [...value].length<=8;
const integer = value => Number.isSafeInteger(value) && value>=0 && value<=MAXIMUM_FRAMES;

function record(value,keys=null) {
  requireValue(value && typeof value==='object' && !Array.isArray(value)
    && [null,Object.prototype].includes(Object.getPrototypeOf(value)));
  const actual=Reflect.ownKeys(value);
  requireValue(actual.every(key=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return typeof key==='string' && descriptor?.enumerable && Object.hasOwn(descriptor,'value');
  }));
  if(keys)requireValue(actual.length===keys.length && keys.every(key=>Object.hasOwn(value,key)));
}

function list(value,min,max) {
  requireValue(Array.isArray(value) && Object.getPrototypeOf(value)===Array.prototype
    && value.length>=min && value.length<=max && Reflect.ownKeys(value).length===value.length+1);
  for(let index=0;index<value.length;index+=1){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    requireValue(descriptor?.enumerable && Object.hasOwn(descriptor,'value'));
  }
}

function validateScenes(scenes) {
  list(scenes,1,64);
  let cursor=0;
  const ids=new Set();
  for(const scene of scenes){
    // Compiled scenes also carry title, evidence and source-unit provenance.
    // Read only these four scheduling fields; never invoke an accessor.
    record(scene);
    requireValue(identifier(scene.id) && !ids.has(scene.id) && text(scene.narration)
      && integer(scene.startFrame) && scene.startFrame===cursor
      && integer(scene.endFrame) && scene.endFrame>scene.startFrame);
    ids.add(scene.id);cursor=scene.endFrame;
  }
  return cursor;
}

function validateCompiled(value) {
  record(value,['version','durationInFrames','audioAligned','chapters']);
  requireValue(value.version===EDITORIAL_CHAPTERS_VERSION && value.audioAligned===false
    && integer(value.durationInFrames) && value.durationInFrames>0);
  list(value.chapters,2,6);
  const ids=new Set(),labels=new Set();
  let cursor=0;
  for(const chapter of value.chapters){
    record(chapter,['id','label','startFrame','endFrame','revealFrame']);
    requireValue(identifier(chapter.id) && !ids.has(chapter.id) && label(chapter.label)
      && !labels.has(chapter.label) && integer(chapter.startFrame) && chapter.startFrame===cursor
      && integer(chapter.endFrame) && chapter.endFrame>chapter.startFrame
      && integer(chapter.revealFrame) && chapter.revealFrame<=chapter.startFrame);
    ids.add(chapter.id);labels.add(chapter.label);
    cursor=chapter.endFrame;
  }
  requireValue(cursor===value.durationInFrames);
}

/** Optional at the call site, never defaulted here. This remains an editorial
 * estimate; neither a chapter marker nor playback completion is business success. */
export function compileEditorialChapterPlan(plan,options) {
  record(plan,['version','chapters']);
  requireValue(plan.version===EDITORIAL_CHAPTERS_VERSION);
  list(plan.chapters,2,6);
  record(options,['scenes','timingPolicy']);
  record(options.timingPolicy,Object.keys(EDITORIAL_TIMING_POLICY));
  requireValue(Object.entries(EDITORIAL_TIMING_POLICY).every(([key,value])=>options.timingPolicy[key]===value));
  const durationInFrames=validateScenes(options.scenes);
  const byId=new Map(options.scenes.map(scene=>[scene.id,scene]));
  const assigned=[];
  const chapters=plan.chapters.map(chapter=>{
    record(chapter,['id','label','sceneIds','reveal']);
    requireValue(identifier(chapter.id) && label(chapter.label));
    list(chapter.sceneIds,1,64);
    requireValue(chapter.sceneIds.every(id=>identifier(id) && byId.has(id)));
    assigned.push(...chapter.sceneIds);
    record(chapter.reveal,['sceneId','cue']);
    requireValue(identifier(chapter.reveal.sceneId) && text(chapter.reveal.cue));
    const source=byId.get(chapter.reveal.sceneId);
    requireValue(source!==undefined);
    const position=source.narration.indexOf(chapter.reveal.cue);
    // No occurrence guessing or whitespace normalization of the authored cue.
    requireValue(position>=0 && source.narration.indexOf(chapter.reveal.cue,position+1)<0);
    const offset=cueFrameAtNarrationPosition(source.narration,position,options.timingPolicy);
    requireValue(offset>=0 && offset<source.endFrame-source.startFrame);
    return {id:chapter.id,label:chapter.label,startFrame:byId.get(chapter.sceneIds[0]).startFrame,
      endFrame:byId.get(chapter.sceneIds.at(-1)).endFrame,revealFrame:source.startFrame+offset};
  });
  requireValue(assigned.length===options.scenes.length
    && assigned.every((id,index)=>id===options.scenes[index].id));
  const result={version:EDITORIAL_CHAPTERS_VERSION,durationInFrames,audioAligned:false,chapters};
  validateCompiled(result);
  chapters.forEach(Object.freeze);Object.freeze(chapters);
  return Object.freeze(result);
}

/** Frame == durationInFrames is the explicit end boundary. The final rendered
 * frame is still before completion; earlier chapters may already be complete. */
export function resolveEditorialChapterFrame(compiled,frame) {
  validateCompiled(compiled);
  requireValue(integer(frame) && frame<=compiled.durationInFrames);
  return {...compiled,chapters:compiled.chapters.map(chapter=>({...chapter,
    visible:frame>=chapter.revealFrame,
    widthFraction:(chapter.endFrame-chapter.startFrame)/compiled.durationInFrames,
    progress:Math.max(0,Math.min(1,(frame-chapter.startFrame)/(chapter.endFrame-chapter.startFrame)))
  }))};
}
