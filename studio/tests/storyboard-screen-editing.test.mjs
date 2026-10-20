import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyScreenEditing} from '../src/shared/screen-editorial-policy.mjs';
import {assertGeneratedStoryboardScreenEditing,assertCueStoryboardScreenEditing,assertTimedStoryboardScreenEditing}
  from '../src/server/production/storyboard-screen-editing.mjs';
import {editorialMotionRendererFixture} from './editorial-motion-renderer-fixture.mjs';
import {buildEditorialMotionRenderModel} from '../src/video/editorial-motion-render-model.mjs';
import {readFixtureEpisode} from './episode-fixture.mjs';
import {evaluateProductionQuality} from '../src/server/production/quality.mjs';

const scene=()=>({id:'S1',type:'title',durationSeconds:12,title:'当前输入',statement:'只读授权副本',subtitle:'不要移动原件',kicker:'概念',
  visualIntent:{takeaway:'当前需要什么',evidenceRefs:[]},visualPlan:{timing:{headlineStartFrame:0,supportingCopyStartFrame:20,graphicStartFrame:30},
    semanticElements:[{id:'a',label:'授权副本'}],semanticRelations:[]}});
const check=value=>assertGeneratedStoryboardScreenEditing({scenes:[value],screenEditing:emptyScreenEditing(['S1'])},{required:true});

test('generated screen checks actual semantic copy and fallback title subtitle, not a declared short summary',()=>{
  assert.equal(check(scene()).passed,true);
  for(const mutate of [s=>s.statement='长'.repeat(49),s=>s.title='长'.repeat(33),s=>s.kicker='长'.repeat(25),
    s=>s.visualPlan.semanticElements[0].label='长'.repeat(25),
    s=>{delete s.statement;s.visualIntent.takeaway='长'.repeat(49);},
    s=>{delete s.statement;delete s.visualIntent.takeaway;s.subtitle='长'.repeat(49);},
    s=>{delete s.visualPlan;s.subtitle='长'.repeat(49);}]){
    const value=scene();mutate(value);
    assert.throws(()=>check(value),error=>error.code==='screen_editorial_text_dense');
  }
  const draft={scenes:[scene()],screenEditing:emptyScreenEditing(['S1'])};
  draft.screenEditing.scenes[0].panels=[{cue:'短标签',elements:[]}];
  assert.throws(()=>assertGeneratedStoryboardScreenEditing(draft,{required:true}),{code:'screen_editorial_unimplemented_visibility'});
});

test('cue policy follows ordered narrative positions when a different prior cue skips an earlier matching word',()=>{
  const narration='先看当前输入，然后进入下一步，再核对当前结果。';
  const beats=[{cue:'下一步'},{cue:'当前'}];
  const content={shots:[{id:'B1',title:'按顺序核对',narration,beats,evidenceRefs:[]}],screenEditing:emptyScreenEditing(['B1'])};
  content.screenEditing.scenes[0].panels=beats.map((beat,index)=>({cue:beat.cue,elements:[
    {id:`copy-${index}`,objectId:'record',role:'label',text:'核对来源'}]}));
  const result=assertCueStoryboardScreenEditing(content,{required:true});
  assert.equal(result.passed,true);assert.equal(result.audioAligned,false);assert.equal(result.executionImplemented,false);
});

test('timed policy sees the actual temporary override rather than the short declared detail',()=>{
  const episode=editorialMotionRendererFixture();
  const plan=episode.scenes[0].motionPlan;
  // Synthetic ample geometry isolates editorial density from the existing fit guard.
  for(const object of plan.objects.filter(value=>value.kind==='page'))Object.assign(object,{width:760,height:350});
  plan.events.find(event=>event.op==='temporary-override').value='长'.repeat(54);
  const actual=buildEditorialMotionRenderModel(episode,90,30).objects.find(object=>object.id==='copy');
  assert.equal(actual.body.text.length,54);
  assert.equal(plan.objects.find(object=>object.id==='copy').detail,'简短中文');
  assert.throws(()=>assertTimedStoryboardScreenEditing({screenEditing:emptyScreenEditing(['synthetic-a'])},episode,episode,{required:true}),
    error=>error.code==='screen_editorial_text_dense' && error.actual===54);
});

test('timed concurrency follows retire and reveal boundaries rather than the whole scene inventory',()=>{
  const episode=editorialMotionRendererFixture();episode.subtitles=[];
  const scene=episode.scenes[0];scene.title='分批核对';scene.narration='先核对第一组，然后切换第二组。';
  const plan=scene.motionPlan;
  plan.objects=Array.from({length:8},(_,index)=>({id:`note-${index}`,kind:'label',label:`记录${index+1}`,detail:'',
    x:120+(index%4)*420,y:index<4?350:600,width:300,height:150,scopeId:'a',sourceId:null,initiallyVisible:index<4}));
  plan.events=plan.objects.map((object,index)=>({id:`switch-${index}`,cue:'切换',atFrame:60,durationFrames:0,
    op:index<4?'retire':'reveal',objectId:object.id,targetId:null,value:null,requires:[]}));
  const content={screenEditing:emptyScreenEditing([scene.id])};
  assert.equal(assertTimedStoryboardScreenEditing(content,episode,episode,{required:true}).passed,true);
  plan.events=[];for(const object of plan.objects)object.initiallyVisible=true;
  assert.throws(()=>assertTimedStoryboardScreenEditing(content,episode,episode,{required:true}),
    error=>error.code==='screen_editorial_concurrency' && error.actual===9);
});

test('cue-only final reading beat uses the same narration lattice as its start, including English',()=>{
  const narration=`Start ${'alpha '.repeat(100)}End ${'omega '.repeat(60)}`;
  const content={shots:[{id:'B1',title:'逐步阅读',narration,beats:[{cue:'Start'},{cue:'End'}],evidenceRefs:[]}],
    screenEditing:emptyScreenEditing(['B1'])};
  const entry=content.screenEditing.scenes[0];
  entry.panels=[{cue:'Start',elements:[{id:'short',objectId:'short',role:'label',text:'核对输入'}]},
    {cue:'End',elements:[{id:'code',objectId:'code',role:'detail',text:'原'.repeat(70)}]}];
  entry.exceptions=[{elementId:'code',kind:'code',reason:'本拍逐行解读这一小段示意代码的限定条件',sourceRef:'illustrative-example'}];
  assert.equal(assertCueStoryboardScreenEditing(content,{required:true}).passed,true);
});

test('new draft quality uses actual episode scenes and stays required after plan deletion; legacy reads are not upgraded',async()=>{
  const episode=await readFixtureEpisode();
  assert.equal(evaluateProductionQuality(episode,{stage:'storyboard'}).checks.some(check=>check.id==='screen-editorial-policy'),false);
  const actual=scene();actual.start=0;actual.end=12;
  episode.scenes=[actual];
  episode.production.storyboardDraft={screenEditorialRequired:true,screenEditing:emptyScreenEditing(['S1']),scenes:[scene()]};
  const check=()=>evaluateProductionQuality(episode,{stage:'storyboard'}).checks.find(check=>check.id==='screen-editorial-policy');
  assert.equal(check().passed,true);
  actual.kicker='长'.repeat(25);
  assert.equal(check().passed,false);
  actual.kicker='概念';delete episode.production.storyboardDraft.screenEditing;
  assert.equal(check().passed,false);
});
