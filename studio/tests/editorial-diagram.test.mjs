import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEditorialMotionPlan,resolveEditorialMotionFrame} from '../src/shared/editorial-motion.mjs';
import {buildEditorialMotionRenderModel} from '../src/video/editorial-motion-render-model.mjs';

const object=(id,x,patch={})=>({id,kind:'illustration',illustration:'gate',label:'待确认',detail:'',
  x,y:390,width:460,height:390,scopeId:'demo',sourceId:null,initiallyVisible:false,...patch});
const event=(id,atFrame,op,objectId,patch={})=>({id,cue:'合成示意',atFrame,durationFrames:0,op,objectId,
  targetId:null,value:null,requires:[],...patch});
function fixture(){return {version:'editorial-motion-v1',canvas:{width:1920,height:1080},objects:[
  object('a',180),object('b',1190,{illustration:'archive',label:'记录'})],events:[
  event('a-in',0,'reveal','a'),event('b-in',30,'reveal','b'),
  event('link',40,'connect','a',{targetId:'b',durationFrames:18,value:{route:'direct'}}),
  event('update',70,'present','a',{value:{label:'条件改变',detail:'重新确认',variant:'closed'}}),
  event('b-out',100,'retire','b')]};}
test('diagram updates only presentation at the cue and keeps stable identity and geometry',()=>{
  const plan=fixture();assert.deepEqual(validateEditorialMotionPlan(plan),{valid:true,errors:[]});
  const before=resolveEditorialMotionFrame(plan,69).objects[0],after=resolveEditorialMotionFrame(plan,70).objects[0];
  assert.equal(before.presentation.copy,undefined);assert.equal(after.presentation.copy.label,'条件改变');
  assert.deepEqual(before.information,after.information);assert.equal(after.x,before.x);assert.equal(after.id,before.id);
  assert.equal(resolveEditorialMotionFrame(plan,29).visibleObjects.length,1);
});
test('explicit relation is absent before cue, orthogonal and removed with a retired endpoint',()=>{
  const plan=fixture(),ep={scenes:[{id:'synthetic',title:'合成关系',startFrame:0,endFrame:150,narration:'合成示意',motionPlan:plan}],subtitles:[]};
  assert.equal(buildEditorialMotionRenderModel(ep,39,30).connections.length,0);
  const mid=buildEditorialMotionRenderModel(ep,49,30).connections[0];
  assert.match(mid.path,/^M [\d.]+ [\d.]+ H [\d.]+$/);assert.equal(mid.progress,.5);
  assert.equal(buildEditorialMotionRenderModel(ep,100,30).connections.length,0);
});
test('diagram rejects unknown shapes, unsafe presentation and hidden relation endpoints',()=>{
  const unknown=fixture();unknown.objects[0].illustration='robot';assert.equal(validateEditorialMotionPlan(unknown).valid,false);
  const hidden=fixture();hidden.events[2].atFrame=20;hidden.events.splice(1,1);assert.equal(validateEditorialMotionPlan(hidden).valid,false);
  const huge=fixture();huge.events[3].value.detail='过长'.repeat(80);assert.equal(validateEditorialMotionPlan(huge).valid,false);
  const field=fixture();field.events[3].value.completed=true;assert.equal(validateEditorialMotionPlan(field).valid,false);
  const invalid=fixture();invalid.events[3].value.variant='success';assert.equal(validateEditorialMotionPlan(invalid).valid,false);
});
