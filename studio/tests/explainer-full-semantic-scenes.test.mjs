import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const built=buildSync({entryPoints:[fileURLToPath(new URL('../src/video/explainer-full-revision/semantic-scenes.jsx',import.meta.url))],
  bundle:true,write:false,format:'cjs',platform:'node',external:['react','remotion'],loader:{'.css':'empty','.woff2':'empty'}});
const module={exports:{}};
new Function('require','module','exports',built.outputFiles[0].text)(require,module,module.exports);
const {semanticSceneState,SEMANTIC_SCENES,SemanticScene}=module.exports;
const orderedScene=id=>({id,segments:Array.from({length:6},(_,i)=>({id:`${id}-${String(i+1).padStart(2,'0')}`}))});
const state=(scene,n,p=0)=>semanticSceneState({scene:orderedScene(scene),current:{id:`${scene}-${String(n).padStart(2,'0')}`,startFrame:100,endFrame:200},frame:100+p*100});

test('semantic phases use scene order, not the spelling or suffix of segment identities',()=>{
  for(const sceneId of SEMANTIC_SCENES){
    const ids=['query-start','token-99','another-id','query-ready','last-step','end'];
    for(let i=0;i<ids.length;i++)for(const p of [0,.5,1]){
      const scene={id:sceneId,segments:ids.map(id=>({id}))};
      const actual=semanticSceneState({scene,current:{id:ids[i],startFrame:100,endFrame:200},frame:100+p*100});
      assert.deepEqual(actual,state(sceneId,i+1,p));
    }
  }
});

test('semantic phases reject a current segment absent from the ordered scene',()=>{
  assert.throws(()=>semanticSceneState({scene:{id:'F26',segments:[{id:'known'}]},
    current:{id:'unknown-02',startFrame:100,endFrame:200},frame:150}),/segment/);
});

test('approved mechanisms are explicitly retained in complete video',()=>{
  for(const id of ['F01','F03','F18','F26','F28','F29','F30','F32','F33','F41'])assert.ok(SEMANTIC_SCENES.has(id));
});
test('full compression scene confines the two headers to their own columns',()=>{
  const element=SemanticScene({scene:orderedScene('F28'),current:{id:'F28-03',startFrame:100,endFrame:200},frame:150});
  assert.equal(element.props.boundedHeaders,true);
  const fragment=element.type(element.props);
  const headers=fragment.props.children.filter(child=>child?.props?.children==='压缩前'||child?.props?.children==='压缩后');
  assert.equal(headers.length,2);
  assert.ok(headers[0].props.x+headers[0].props.w<headers[1].props.x);
  assert.ok(headers[1].props.x+headers[1].props.w<=1800);
  const rowFragments=fragment.props.children.find(Array.isArray);
  for(const row of rowFragments.slice(1)){
    const arrow=row.props.children.find(child=>child?.props?.points);
    assert.ok(arrow.props.points.at(-1)[0]<=1076,'arrow needs space before destination text');
  }
});
test('memory copy enters input only after authorized transfer, source persists',()=>{
  assert.equal(state('F18',1,1).memoryArrived,false);
  assert.equal(state('F18',2,0).memoryArrived,false);
  assert.equal(state('F18',2,1).memoryArrived,true);
  assert.equal(state('F18',3,0).memoryArrived,true);
});
test('query cannot show new business state in the old-record sentence',()=>{
  assert.equal(state('F26',1,1).queryProgress,0);
  assert.equal(state('F26',2,0).queryProgress,0);
  assert.equal(state('F26',2,1).queryProgress,1);
  assert.equal(state('F26',3,0).queryProgress,1);
  assert.equal(state('F26',3,1).showPolicy,false);
  assert.equal(state('F26',4,0).showPolicy,true);
});
test('final answer and records are revealed only in matching utterances',()=>{
  assert.equal(state('F29',1).answerVisual,'answer-fact');
  assert.equal(state('F29',2).answerVisual,'answer-limit');
  assert.equal(state('F29',3).answerVisual,'answer-next');
  assert.equal(state('F30',1).recordLongTerm,false);
  assert.equal(state('F30',2).recordLongTerm,true);
});
test('synchronous write has no success in the verification sentence',()=>{
  assert.deepEqual(state('F32',1,1).writeSteps,{syncStep:0,asyncStep:0});
  assert.deepEqual(state('F32',2,1).writeSteps,{syncStep:1,asyncStep:0});
  assert.deepEqual(state('F32',3,0).writeSteps,{syncStep:1,asyncStep:0});
  assert.deepEqual(state('F32',3,0.5).writeSteps,{syncStep:2,asyncStep:0});
  assert.deepEqual(state('F32',3,1).writeSteps,{syncStep:3,asyncStep:0});
});
test('asynchronous receipt is not persistence and background cannot complete early',()=>{
  assert.deepEqual(state('F33',2,1).writeSteps,{syncStep:3,asyncStep:1});
  assert.deepEqual(state('F33',3,1).writeSteps,{syncStep:3,asyncStep:2});
  assert.deepEqual(state('F33',4,0).writeSteps,{syncStep:3,asyncStep:2});
  assert.deepEqual(state('F33',4,1).writeSteps,{syncStep:3,asyncStep:3});
});
test('poisoning text keeps generic warning; missing business evidence cannot answer',()=>{
  assert.equal(state('F41',1).fallback,false);
  assert.equal(state('F41',2).fallback,false);
  assert.equal(state('F41',3).fallback,true);
  assert.equal(state('F41',3,1).businessReady,false);
  assert.equal(state('F41',4,1).businessReady,true);
  assert.equal(state('F41',5,0).businessReady,false);
  assert.equal(state('F41',6,1).businessReady,false);
  assert.equal(state('F41',5,0).businessMissing,true);
});
test('phrase normalization clamps gaps and fails closed on malformed timing',()=>{
  assert.equal(state('F26',2,2).queryProgress,1);
  assert.throws(()=>semanticSceneState({scene:{id:'F26'},current:{id:'F26-02',startFrame:100,endFrame:100},frame:100}),/timing/);
});
