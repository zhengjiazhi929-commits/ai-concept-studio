import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {resolveEditorialMotionFrame} from '../src/shared/editorial-motion.mjs';
import {buildEditorialMotionRenderModel} from '../src/video/editorial-motion-render-model.mjs';

// Pure synthetic data and in-memory SSR. No live Episode, output, server or render.
const entry=fileURLToPath(new URL('../src/video/editorial-illustration-shapes.jsx',import.meta.url));
const built=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',logLevel:'silent'});
const module={exports:{}};
vm.runInThisContext(`(function(module,exports,require){\n${built.outputFiles[0].text}\n})`)(module,module.exports,createRequire(entry));
const {EditorialIllustrationShape}=module.exports;
const gate=variant=>renderToStaticMarkup(React.createElement(EditorialIllustrationShape,
  {object:{width:460,illustration:'gate',variant},stroke:'#17795D',fill:'#E4F4EC'}));
const base={detail:'',scopeId:'synthetic',sourceId:null,initiallyVisible:true};
const object=(id,x,y=390,width=460,height=390,extra={})=>
  ({...base,id,kind:'label',label:id,x,y,width,height,...extra});
const event=(id,atFrame,op,objectId,patch={})=>({id,cue:'合成',atFrame,durationFrames:0,op,objectId,
  targetId:null,value:null,requires:[],...patch});
const plan=(objects,events=[])=>({version:'editorial-motion-v1',canvas:{width:1920,height:1080},objects,events});
const model=(motionPlan,frame=0)=>buildEditorialMotionRenderModel({scenes:[{id:'synthetic',title:'合成关系',
  narration:'合成。',startFrame:0,endFrame:150,motionPlan}],subtitles:[]},frame,30);

test('pending neutral gate is visually distinct from closed and never draws a solid blocking arm',()=>{
  const pending=gate('neutral'),closed=gate('closed'),opened=gate('open');
  assert.notEqual(pending,closed);
  assert.match(pending,/data-editorial-gate-pending="true"/u);
  assert.match(pending,/stroke-dasharray=/u);
  assert.doesNotMatch(pending,/x="58" y="60" width="118" height="12"/u);
  assert.match(closed,/x="58" y="60" width="118" height="12"/u);
  assert.match(opened,/x="58" y="8" width="10" height="72"/u);
  assert.doesNotMatch(pending+closed+opened,/✓|✔|data-card-icon/u);
});

test('return route rejects vertically aligned endpoints instead of passing through its target',()=>{
  const source=object('source',600,320,300,160),target=object('target',600,580,300,160);
  assert.throws(()=>model(plan([source,target],[event('relation',0,'connect','source',{
    targetId:'target',durationFrames:18,value:{route:'return'}})]),18),/return-no-clear-corridor/u);
});

test('return route remains available for separated horizontal endpoints',()=>{
  const value=model(plan([object('source',180),object('target',1190)],
    [event('relation',0,'connect','source',{targetId:'target',durationFrames:18,value:{route:'return'}})]),18);
  assert.equal(value.connections.length,1);
  assert.match(value.connections[0].path,/^M [\d.]+ [\d.]+ V [\d.]+ H [\d.]+ V [\d.]+$/u);
});

test('regions render by complete ancestry depth even when a descendant is declared before its parent',()=>{
  const regions=[object('outer',100,300,1720,580,{kind:'region',label:'外层'}),
    object('child',250,550,800,230,{kind:'region',label:'子层',regionId:'inner'}),
    object('inner',180,420,1400,420,{kind:'region',label:'中层',regionId:'outer'})];
  assert.deepEqual(model(plan(regions)).objects.map(item=>item.id),['outer','inner','child']);
});

function sharedInnerRegionFixture(obstacle = null) {
  return plan([
    object('outer',120,310,1680,560,{kind:'region',label:'外层'}),
    object('inner',180,430,1500,400,{kind:'region',label:'内层',regionId:'outer'}),
    object('left',220,550,480,140,{label:'步骤一',regionId:'inner'}),
    object('right',1150,550,420,140,{label:'步骤二',regionId:'inner'}),
    ...(obstacle ? [object('obstacle',800,550,200,160,{kind:obstacle,label:'障碍',regionId:'inner'})] : [])
  ],[event('nested-link',10,'connect','left',{targetId:'right',durationFrames:18,value:{route:'direct'}})]);
}

test('connections between nodes in the same inner region ignore their complete ancestor chain',()=>{
  const data=sharedInnerRegionFixture();
  for(const frame of [10,19,28]) {
    const value=model(data,frame);
    assert.equal(value.connections.length,1);
    assert.equal(value.connections[0].path,'M 712 620 H 1138');
  }
});

test('nested ancestor exemptions still reject non-ancestor labels and sibling regions blocking the route',()=>{
  for(const kind of ['label','region']) {
    const data=sharedInnerRegionFixture(kind);
    assert.equal(model(data,9).connections.length,0);
    assert.throws(()=>model(data,10),/editorial-renderer-connection-obstructed/u);
  }
});

test('scope reset retires relations permanently rather than reviving them when endpoints return',()=>{
  const data=plan([object('source',180),object('target',1190)],[
    event('relation',0,'connect','source',{targetId:'target',durationFrames:18,value:{route:'direct'}}),
    event('reset',30,'reset-scope',null,{value:{scopeId:'synthetic',keepIds:[]}}),
    event('source-back',40,'reveal','source'),event('target-back',40,'reveal','target')]);
  assert.equal(resolveEditorialMotionFrame(data,29).connections.length,1);
  assert.equal(resolveEditorialMotionFrame(data,30).connections.length,0);
  assert.equal(resolveEditorialMotionFrame(data,40).connections.length,0);
});

test('scope reset preserves a relation only when both endpoints are explicitly retained',()=>{
  const data=plan([object('source',180),object('target',1190)],[
    event('relation',0,'connect','source',{targetId:'target',durationFrames:18,value:{route:'direct'}}),
    event('reset',30,'reset-scope',null,{value:{scopeId:'synthetic',keepIds:['source','target']}})]);
  assert.equal(resolveEditorialMotionFrame(data,40).connections.length,1);
});
