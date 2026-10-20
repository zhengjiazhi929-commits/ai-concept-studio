import test from 'node:test';
import assert from 'node:assert/strict';
import {assertScreenEditorialFrames,emptyScreenEditing,requireScreenEditing,screenTextLength}
  from '../src/shared/screen-editorial-policy.mjs';
const item=(id,text,role='label')=>({id,objectId:id,role,text});
const frame=(startFrame,endFrame,elements)=>({startFrame,endFrame,fps:30,elements});
const check=frames=>assertScreenEditorialFrames({frames});
const exception={elementId:'quote',kind:'quotation',reason:'原始条款的必要限定必须在本拍完整阅读',sourceRef:'source-1'};

test('screen policy checks actual copy without mutation and does not include narration',()=>{
  const frames=[frame(0,90,[item('title','当前任务','heading'),item('copy','只读授权副本')])];
  const before=structuredClone(frames);assert.equal(check(frames).passed,true);assert.deepEqual(frames,before);
  assert.throws(()=>check([frame(0,90,[item('copy','说明'.repeat(30),'detail')])]),error=>error.code==='screen_editorial_text_dense');
});
test('ASCII equivalent-character boundaries use exact decimal units rather than accumulated float error',()=>{
  assert.equal(screenTextLength('a'.repeat(40)),24);
  assert.equal(screenTextLength('a'.repeat(80)),48);
  assert.equal(check([frame(0,90,[item('label','a'.repeat(40))])]).passed,true);
  assert.equal(check([frame(0,90,[item('detail','a'.repeat(80),'detail')])]).passed,true);
  assert.throws(()=>check([frame(0,90,[item('label','a'.repeat(41))])]),{code:'screen_editorial_text_dense'});
});
test('density counts concurrent visible objects per beat, not all objects across the scene',()=>{
  const first=Array.from({length:5},(_,i)=>item(`a${i}`,'短标签'));
  const second=Array.from({length:5},(_,i)=>item(`b${i}`,'短标签'));
  assert.equal(check([frame(0,90,first),frame(90,180,second)]).passed,true);
  assert.throws(()=>check([frame(0,180,[...first,...second])]),/屏显/u);
  assert.throws(()=>check([frame(0,180,Array.from({length:6},(_,i)=>item(`a${i}`,'字'.repeat(23))))]),error=>error.code==='screen_editorial_total_dense');
});
test('explicit source-bound reading exception remains capped, focused and timed',()=>{
  const frames=[frame(0,450,[item('quote','原'.repeat(150),'detail')])];
  assert.equal(assertScreenEditorialFrames({frames,exceptions:[exception],evidenceRefs:['source-1']}).passed,true);
  for(const patch of [{reason:'必要'},{sourceRef:'unbound'},{kind:'anything'},{elementId:'unused'}]){
    assert.throws(()=>assertScreenEditorialFrames({frames,exceptions:[{...exception,...patch}],evidenceRefs:['source-1']}));
  }
  assert.throws(()=>assertScreenEditorialFrames({frames:[frame(0,450,[item('quote','原'.repeat(181),'detail')])],exceptions:[exception],evidenceRefs:['source-1']}));
  assert.throws(()=>assertScreenEditorialFrames({frames:[frame(0,20,[item('quote','原'.repeat(150),'detail')])],exceptions:[exception],evidenceRefs:['source-1']}));
});
test('a long earlier reading cannot lend its duration to changed text in the same object',()=>{
  assert.throws(()=>assertScreenEditorialFrames({exceptions:[exception],evidenceRefs:['source-1'],frames:[
    frame(0,600,[item('quote','甲'.repeat(150),'detail')]),frame(600,601,[item('quote','乙'.repeat(150),'detail')])
  ]}),error=>error.code==='screen_editorial_reading_beat');
});
test('new policies are closed and cannot omit or fake their scene binding',()=>{
  assert.equal(requireScreenEditing(undefined,['S1']),null);
  assert.throws(()=>requireScreenEditing(undefined,['S1'],{required:true}),error=>error.code==='screen_editorial_policy_required');
  assert.deepEqual(requireScreenEditing(emptyScreenEditing(['S1']),['S1']),emptyScreenEditing(['S1']));
  for(const mutate of [p=>delete p.version,p=>p.version='legacy',p=>p.scenes[0].id='S2',p=>p.scenes[0].skip=true]){
    const plan=emptyScreenEditing(['S1']);mutate(plan);assert.throws(()=>requireScreenEditing(plan,['S1']));
  }
});
