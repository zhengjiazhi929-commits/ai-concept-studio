import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEditorialMotionPlan} from '../src/shared/editorial-motion.mjs';
import {buildEditorialMotionRenderModel} from '../src/video/editorial-motion-render-model.mjs';
import {validEditorialIllustration} from '../src/shared/editorial-illustration-contract.mjs';

const object={id:'figure',kind:'illustration',illustration:'monitor',label:'',detail:'',
  x:1100,y:470,width:600,height:240,scopeId:'synthetic',sourceId:null,initiallyVisible:true};
const fixture=()=>({version:'editorial-motion-v1',canvas:{width:1920,height:1080},objects:[{...object}],events:[]});
test('unlabelled standalone figure is allowed without inventing copy or a business result',()=>{
  const plan=fixture();assert.equal(validateEditorialMotionPlan(plan).valid,true);
  const episode={scenes:[{id:'demo',title:'合成数量示意',narration:'只展示对象',startFrame:0,endFrame:90,motionPlan:plan}],subtitles:[]};
  const value=buildEditorialMotionRenderModel(episode,0,30).objects[0];
  assert.equal(value.title.text,'');assert.equal(value.body.text,'');assert.equal(value.stateText.text,'');
  assert.equal(value.status,'idle');
  for(const kind of ['card','page','label']){const bad=fixture();bad.objects[0]={...object,kind};delete bad.objects[0].illustration;
    assert.equal(validateEditorialMotionPlan(bad).valid,false);}
});
test('bounded monitor quantities, sealed parcel and qualitative deadline use explicit variants',()=>{
  assert.equal(validEditorialIllustration('monitor','five'),true);
  assert.equal(validEditorialIllustration('monitor','twenty'),true);
  assert.equal(validEditorialIllustration('parcel'),true);
  assert.equal(validEditorialIllustration('deadline','over'),true);
  for(const [type,variant] of [['monitor','random'],['parcel','delivered'],['deadline','passed']]){
    assert.equal(validEditorialIllustration(type,variant),false);
  }
});
test('an unlabelled tray is physical geometry, not permission for empty text cards',()=>{
  const plan=fixture();plan.objects[0]={...object,kind:'tray',x:150,y:330,width:800,height:530};
  delete plan.objects[0].illustration;
  assert.equal(validateEditorialMotionPlan(plan).valid,true);
});
