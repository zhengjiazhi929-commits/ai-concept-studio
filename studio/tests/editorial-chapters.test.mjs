import test from 'node:test';
import assert from 'node:assert/strict';
import {EDITORIAL_TIMING_POLICY, cueFrameForNarration} from '../src/shared/editorial-timing.mjs';
import {EDITORIAL_CHAPTERS_VERSION, compileEditorialChapterPlan, resolveEditorialChapterFrame}
  from '../src/shared/editorial-chapters.mjs';

function fixture() {
  return {
    plan: {version:'editorial-chapters-v1',chapters:[
      {id:'concept',label:'概念',sceneIds:['S01','S02'],reveal:{sceneId:'S01',cue:'先讲概念。'}},
      {id:'business',label:'运行',sceneIds:['S03'],reveal:{sceneId:'S02',cue:'再讲运行。'}},
      {id:'exceptions',label:'异常',sceneIds:['S04'],reveal:{sceneId:'S02',cue:'随后看异常。'}},
      {id:'delivery',label:'落地',sceneIds:['S05'],reveal:{sceneId:'S02',cue:'最后做落地。'}}
    ]},
    options: {timingPolicy:{...EDITORIAL_TIMING_POLICY},scenes:[
      {id:'S01',narration:'先讲概念。',startFrame:0,endFrame:400},
      {id:'S02',narration:'先看大纲，再讲运行。随后看异常。最后做落地。',startFrame:400,endFrame:900},
      {id:'S03',narration:'运行部分。',startFrame:900,endFrame:1500},
      {id:'S04',narration:'异常部分。',startFrame:1500,endFrame:1900},
      {id:'S05',narration:'落地部分。',startFrame:1900,endFrame:2700}
    ]}
  };
}

const compile = value => compileEditorialChapterPlan(value.plan,value.options);
const rejects = value => assert.throws(()=>compile(value),{code:'editorial_chapter_contract_invalid'});

test('chapters bind exact ordered scenes and cue offsets without changing narration',()=>{
  const input=fixture(),before=structuredClone(input),result=compile(input);
  assert.equal(EDITORIAL_CHAPTERS_VERSION,'editorial-chapters-v1');
  assert.deepEqual(input,before);
  assert.equal(result.durationInFrames,2700);
  assert.equal(result.audioAligned,false);
  assert.deepEqual(result.chapters.map(({id,label,startFrame,endFrame})=>({id,label,startFrame,endFrame})),[
    {id:'concept',label:'概念',startFrame:0,endFrame:900},
    {id:'business',label:'运行',startFrame:900,endFrame:1500},
    {id:'exceptions',label:'异常',startFrame:1500,endFrame:1900},
    {id:'delivery',label:'落地',startFrame:1900,endFrame:2700}
  ]);
  assert.equal(result.chapters[1].revealFrame,400+cueFrameForNarration(
    input.options.scenes[1].narration,'再讲运行。',EDITORIAL_TIMING_POLICY));
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.chapters)&&Object.isFrozen(result.chapters[0]));
});

test('names reveal exactly at their spoken cues; progress uses unequal chapter frame spans',()=>{
  const result=compile(fixture()),reveal=result.chapters[1].revealFrame;
  assert.deepEqual(resolveEditorialChapterFrame(result,0).chapters.map(c=>c.visible),[true,false,false,false]);
  assert.equal(resolveEditorialChapterFrame(result,reveal-1).chapters[1].visible,false);
  assert.equal(resolveEditorialChapterFrame(result,reveal).chapters[1].visible,true);
  const frame=resolveEditorialChapterFrame(result,1200);
  assert.deepEqual(frame.chapters.map(c=>c.widthFraction),[900/2700,600/2700,400/2700,800/2700]);
  assert.deepEqual(frame.chapters.map(c=>c.progress),[1,0.5,0,0]);
  assert.equal(frame.audioAligned,false);
  assert.equal(resolveEditorialChapterFrame(result,2699).chapters[3].progress<1,true);
  assert.equal(resolveEditorialChapterFrame(result,2700).chapters[3].progress,1);
});

test('absent or malformed plans never silently become a default chapter plan',()=>{
  for(const plan of [undefined,null,{},[],{version:'other',chapters:[]}]){
    const input=fixture();input.plan=plan;rejects(input);
  }
  for(const change of [p=>{p.extra=true;},p=>{p.chapters[0].extra=true;},
    p=>{p.chapters[0].reveal.extra=true;},p=>{p.chapters[0].label='';},
    p=>{p.chapters[0].label='一二三四五六七八九';},p=>{p.chapters[0].label='概念\n运行';},
    p=>{p.chapters[0].id='bad id';},p=>{p.chapters[1].id=p.chapters[0].id;},
    p=>{p.chapters[1].label=p.chapters[0].label;},p=>{p.chapters=p.chapters.slice(0,1);},
    p=>{p.chapters=Array(7).fill(p.chapters[0]);}]){
    const input=fixture();change(input.plan);rejects(input);
  }
});

test('scene coverage is exhaustive once, contiguous and ordered',()=>{
  for(const change of [p=>{p.chapters[0].sceneIds.pop();},p=>{p.chapters[0].sceneIds.push('S02');},
    p=>{p.chapters[0].sceneIds.reverse();},p=>{p.chapters[0].sceneIds.push('unknown');},
    p=>{p.chapters[1].sceneIds=[];},p=>{p.chapters[1].sceneIds=['S04'];p.chapters[2].sceneIds=['S03'];}]){
    const input=fixture();change(input.plan);rejects(input);
  }
});

test('reveal cues must be unambiguous exact raw substrings in prior or current scenes',()=>{
  for(const change of [i=>{i.plan.chapters[0].reveal.cue='讲概念。';},
    i=>{i.plan.chapters[1].reveal={sceneId:'S04',cue:'异常部分。'};},
    i=>{i.plan.chapters[1].reveal={sceneId:'S03',cue:'部分。'};},
    i=>{i.plan.chapters[1].reveal.cue='再讲运 行。';},
    i=>{i.plan.chapters[1].reveal.sceneId='unknown';},
    i=>{i.options.scenes[1].narration+='再讲运行。';}]){
    const input=fixture();change(input);rejects(input);
  }
  const input=fixture();input.plan.chapters[1].reveal={sceneId:'S03',cue:'运行部分。'};
  assert.equal(compile(input).chapters[1].revealFrame,900);
});

test('compiled scene timing and locked policy cannot be forged or loosened',()=>{
  for(const change of [o=>{o.extra=true;},o=>{o.scenes[0].startFrame=1;},
    o=>{o.scenes[1].startFrame=401;},o=>{o.scenes[1].endFrame=400;},
    o=>{o.scenes[1].endFrame=900.5;},o=>{o.scenes[1].id='S01';},
    o=>{o.scenes[1].narration='';},o=>{o.timingPolicy.audioAligned=true;},
    o=>{o.timingPolicy.fps=25;},o=>{o.timingPolicy.extra=true;}]){
    const input=fixture();change(input.options);rejects(input);
  }
});

test('rejects accessors, prototypes, symbols, sparse arrays and hidden data without executing getters',()=>{
  let reads=0;
  for(const select of [i=>[i.plan,'chapters'],i=>[i.plan.chapters[0],'label'],
    i=>[i.plan.chapters[0].reveal,'cue'],i=>[i.options,'scenes'],
    i=>[i.options.scenes[0],'narration'],i=>[i.options.timingPolicy,'fps']]){
    const input=fixture(),[target,key]=select(input);
    Object.defineProperty(target,key,{get(){reads++;return null;},enumerable:true});rejects(input);
  }
  assert.equal(reads,0);
  for(const change of [i=>{Object.setPrototypeOf(i.plan,{inherited:true});},
    i=>{i.plan[Symbol('hidden')]=true;},i=>{Object.defineProperty(i.plan,'hidden',{value:1});},
    i=>{delete i.plan.chapters[1];},i=>{i.plan.chapters.extra=true;},
    i=>{delete i.plan.chapters[0].sceneIds[0];},i=>{delete i.options.scenes[1];}]){
    const input=fixture();change(input);rejects(input);
  }
});

test('resolver validates its full compiled input and strict frame bounds',()=>{
  const input=compile(fixture());
  for(const frame of [-1,0.5,2701,Infinity,NaN,'0'])assert.throws(()=>resolveEditorialChapterFrame(input,frame),
    {code:'editorial_chapter_contract_invalid'});
  for(const change of [c=>{c.audioAligned=true;},c=>{c.chapters[0].revealFrame=1;},
    c=>{c.chapters[1].revealFrame=901;},c=>{c.chapters[1].startFrame=901;},
    c=>{c.durationInFrames=2701;},c=>{c.chapters[0].extra=true;},
    c=>{c.chapters[1].label=c.chapters[0].label;}]){
    const value=structuredClone(input);change(value);
    assert.throws(()=>resolveEditorialChapterFrame(value,0),{code:'editorial_chapter_contract_invalid'});
  }
});
