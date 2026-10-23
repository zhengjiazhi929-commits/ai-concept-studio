import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {validateEditorialMotionPlan,resolveEditorialMotionFrame,compileEditorialMotionPlan} from '../src/shared/editorial-motion.mjs';
import {buildEditorialMotionRenderModel} from '../src/video/editorial-motion-render-model.mjs';

const narration='轨迹出现。继续突出。改变路径。移除轨迹。移动页面。';
const object=(id='note',patch={})=>({id,kind:'page',label:'合成页面',detail:'',x:150,y:400,width:320,height:180,
  scopeId:'synthetic',sourceId:null,initiallyVisible:true,...patch});
const event=(id,atFrame,op,objectId,patch={})=>({id,cue:'移动页面',atFrame,durationFrames:0,op,objectId,
  targetId:null,value:null,requires:[],...patch});
const state=(atFrame,patch={})=>({cue:'轨迹出现',atFrame,durationFrames:18,
  points:[{x:200,y:720},{x:900,y:720},{x:900,y:820}],highlightStop:1,...patch});
const plan=(patch={})=>({version:'editorial-motion-v1',canvas:{width:1920,height:1080},
  objects:[object()],events:[],...patch});
const inspect=data=>validateEditorialMotionPlan(data,{narration,durationInFrames:500});
const model=(data,frame)=>buildEditorialMotionRenderModel({scenes:[{id:'synthetic',title:'合成轨迹',narration,
  startFrame:0,endFrame:500,motionPlan:data}],subtitles:[]},frame,30);
const trackPlan=()=>plan({tracks:[{id:'process',states:[state(20),state(60,{cue:'继续突出',durationFrames:0,highlightStop:2}),
  state(100,{cue:'改变路径',points:[{x:200,y:720},{x:900,y:720}],highlightStop:null}),
  state(150,{cue:'移除轨迹',durationFrames:0,points:[],highlightStop:null})]}]});

test('orthogonal text-free tracks reveal, highlight, change actual path and retire at exact cues',()=>{
  const data=trackPlan(),before=structuredClone(data);
  assert.equal(inspect(data).valid,true);
  assert.deepEqual(resolveEditorialMotionFrame(data,19).tracks,[]);
  const halfway=resolveEditorialMotionFrame(data,29).tracks[0];
  assert.equal(halfway.progress,.5);assert.equal(halfway.highlightPoint,null);
  assert.deepEqual(resolveEditorialMotionFrame(data,38).tracks[0].highlightPoint,{x:900,y:720});
  assert.deepEqual(resolveEditorialMotionFrame(data,60).tracks[0].highlightPoint,{x:900,y:820});
  assert.notEqual(model(data,99).tracks[0].path,model(data,118).tracks[0].path);
  assert.deepEqual(model(data,150).tracks,[]);
  assert.deepEqual(data,before);
  assert.equal(Object.isFrozen(compileEditorialMotionPlan(data).tracks[0].states),true);
});

test('track contract rejects arbitrary drawings, malformed states, bounds and timing drift',()=>{
  const changes=[p=>{p.tracks=null;},p=>{p.tracks[0].label='hidden text';},p=>{p.tracks[0].states[0].svg='<svg/>';},
    p=>{p.tracks[0].states[0].points[0].x=95;},p=>{p.tracks[0].states[0].points[0].x=200.5;},
    p=>{p.tracks[0].states[0].points[1].y=721;},p=>{p.tracks[0].states[0].points[1]={x:200,y:720};},
    p=>{p.tracks[0].states[0].points=[{x:200,y:720}];},p=>{p.tracks[0].states[0].highlightStop=3;},
    p=>{p.tracks[0].states[0].durationFrames=91;},p=>{p.tracks[0].states[3].durationFrames=1;},
    p=>{p.tracks[0].states[3].highlightStop=0;},p=>{p.tracks[0].states[0].cue='不存在';},
    p=>{p.tracks[0].states[1].atFrame=25;},p=>{p.tracks[0].states[3].atFrame=500;},
    p=>{p.tracks.push(structuredClone(p.tracks[0]));},p=>{p.tracks=Array.from({length:5},(_,i)=>({...p.tracks[0],id:`t${i}`}));}];
  for(const change of changes){const data=trackPlan();change(data);assert.equal(inspect(data).valid,false);}
});

test('track data rejects getters and sparse state arrays before executing input code',()=>{
  let reads=0;const data=trackPlan();
  Object.defineProperty(data.tracks[0].states[0],'points',{get(){reads++;return [];},enumerable:true});
  assert.equal(inspect(data).valid,false);assert.equal(reads,0);
  const sparse=trackPlan();delete sparse.tracks[0].states[1];assert.equal(inspect(sparse).valid,false);
});

test('visible tracks cannot cross text objects or hide behind their filled geometry',()=>{
  const data=trackPlan();data.tracks[0].states[0].points=[{x:120,y:470},{x:900,y:470}];
  assert.deepEqual(model(data,19).tracks,[]);
  assert.throws(()=>model(data,20),/editorial-renderer-track-obstructed/u);
  const appeared=trackPlan();appeared.objects.push(object('appearing',{label:'挡',x:600,y:680,width:200,height:140,
    kind:'label',initiallyVisible:false}));appeared.events.push(event('reveal-obstacle',30,'reveal','appearing'));
  assert.equal(model(appeared,29).tracks.length,1);
  assert.throws(()=>model(appeared,30),/editorial-renderer-track-obstructed/u);
  // Inspect the complete authored route even before a stroke reaches an obstacle.
  assert.throws(()=>model(appeared,31),/editorial-renderer-track-obstructed/u);
});

const movement=()=>plan({events:[event('move',20,'reposition','note',{durationFrames:30,value:{x:1050,y:400}})]});
test('independent page movement is frame-driven and preserves identity and every information field',()=>{
  const data=movement(),source=resolveEditorialMotionFrame(data,19).objects[0];
  assert.equal(inspect(data).valid,true);
  const half=resolveEditorialMotionFrame(data,35).objects[0],end=resolveEditorialMotionFrame(data,50).objects[0];
  assert.equal(half.x,600);assert.equal(half.y,400);assert.equal(half.presentation.inTransit,true);
  assert.equal(end.x,1050);assert.equal(end.presentation.inTransit,false);
  assert.deepEqual(source.information,half.information);assert.deepEqual(source.information,end.information);
  assert.equal(source.id,end.id);assert.equal(end.sourceId,null);assert.equal(model(data,35).objects[0].stateText.text,'');
});

test('reposition is limited to unreferenced root pages and labels on one axis',()=>{
  for(const change of [p=>{p.objects[0].kind='card';},p=>{p.objects[0].kind='window';},
    p=>{p.events[0].durationFrames=0;},p=>{p.events[0].durationFrames=91;},
    p=>{p.events[0].value.x=1700;},p=>{p.events[0].value.y=500;},p=>{p.events[0].value.x=150;},
    p=>{p.events[0].value.completed=true;},p=>{p.objects.push(object('copy',{sourceId:'note',initiallyVisible:false}));},
    p=>{p.objects[0].initiallyVisible=false;}]){
    const data=movement();change(data);assert.equal(inspect(data).valid,false);
  }
  const vertical=movement();vertical.objects[0].kind='label';vertical.events[0].value={x:150,y:680};
  assert.equal(inspect(vertical).valid,true);assert.equal(resolveEditorialMotionFrame(vertical,50).objects[0].y,680);
});

test('movement rejects tunneling through obstacles even when both endpoint boxes are clear',()=>{
  const data=movement();data.objects.push(object('obstacle',{x:700,y:420,width:260,height:140,kind:'label'}));
  assert.equal(inspect(data).valid,false);
  assert.throws(()=>model(data,20),/motion-reposition-overlap/u);
});

test('movement validates visibility changes inside its span and prevents concurrent edits or retirement',()=>{
  const revealed=movement();revealed.objects.push(object('obstacle',{x:700,y:420,width:260,height:140,kind:'label',initiallyVisible:false}));
  revealed.events.push(event('appear',35,'reveal','obstacle'));
  assert.equal(inspect(revealed).valid,false);
  for(const op of ['retire','present','reset-scope']){
    const data=movement();data.events.push(event('conflict',35,op,op==='reset-scope'?null:'note',
      op==='present'?{value:{label:'改字',detail:'',variant:'neutral'}}:
        op==='reset-scope'?{value:{scopeId:'synthetic',keepIds:[]}}:{}));
    assert.equal(inspect(data).valid,false);
  }
});

test('independent movement rejects overlapping motion spans instead of missing crossing trajectories',()=>{
  const data=plan({objects:[object('horizontal',{label:'横',x:150,y:480,width:200,height:140,kind:'label'}),
    object('vertical',{label:'竖',x:650,y:320,width:200,height:140,kind:'label'})],events:[
    event('move-a',20,'reposition','horizontal',{durationFrames:30,value:{x:1150,y:480}}),
    event('move-b',20,'reposition','vertical',{durationFrames:30,value:{x:650,y:720}})]});
  assert.equal(inspect(data).valid,false);
  assert.throws(()=>model(data,20),/motion-reposition-concurrent/u);
});

test('text-free tracks draw without arrowheads, arbitrary markup or added screen text',async()=>{
  const entry=fileURLToPath(new URL('../src/video/editorial-motion-preview.jsx',import.meta.url));
  const built=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',logLevel:'silent'});
  const module={exports:{}},require=createRequire(entry);
  vm.runInThisContext(`(function(module,exports,require){\n${built.outputFiles[0].text}\n})`)(module,module.exports,require);
  const value=model(trackPlan(),38);
  const html=renderToStaticMarkup(React.createElement(module.exports.EditorialMotionArtwork,{model:value}));
  assert.match(html,/data-editorial-track="process"/u);
  assert.match(html,/data-editorial-track-highlight=/u);
  assert.doesNotMatch(html,/data-editorial-arrowhead|<text\b|<script\b/u);
  assert.equal(value.objects.length,1);assert.equal(value.objects[0].title.text,'合成页面');
});
