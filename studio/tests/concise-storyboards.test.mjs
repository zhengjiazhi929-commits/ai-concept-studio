import test from 'node:test';
import assert from 'node:assert/strict';
import {CONCISE_BOARDS,conciseStoryboardState} from '../src/video/concise-storyboards/plan.mjs';
import {orthogonalPath,rectContains} from '../src/video/illustration-storyboards/plan.mjs';

test('three concise storyboard families have three explicit poses and off-screen explanations',()=>{
  assert.deepEqual(CONCISE_BOARDS.map(board=>board.id),['context','memory','order']);
  for(const board of CONCISE_BOARDS){
    assert.equal(board.phases.length,3);assert.ok([...board.title].length<=20);
    for(const phase of board.phases){assert.ok(phase.explanation.length>35);assert.ok(phase.label.length<16);}
  }
});

test('every pose has bounded semantic objects and strictly orthogonal connections',()=>{
  for(const board of CONCISE_BOARDS)for(let phase=0;phase<3;phase++){
    const state=conciseStoryboardState(board.id,phase);
    for(const box of state.bounds)assert.ok(box.x>=108&&box.y>=300&&box.x+box.width<=1812&&box.y+box.height<=880,JSON.stringify(box));
    for(const edge of state.connections)assert.doesNotThrow(()=>orthogonalPath(edge.points));
    assert.ok(state.labels.every(label=>[...label].length<=12));
  }
  for(const args of [['unknown',0],['context',-1],['memory',3],['order',.5]])assert.throws(()=>conciseStoryboardState(...args));
});

test('context assembly selects only relevant sources and never moves the originals',()=>{
  const start=conciseStoryboardState('context',0);
  for(let phase=0;phase<3;phase++){
    const state=conciseStoryboardState('context',phase);
    assert.deepEqual(state.sources.map(({id,rect})=>({id,rect})),start.sources.map(({id,rect})=>({id,rect})));
    assert.ok(state.sources.every(source=>source.retained));
    assert.deepEqual(state.selectedIds,phase===0?[]:['rules','tool']);
    assert.equal(state.assembled,phase===2);
  }
});

test('memory is copied only after authorization and arrives inside the current window',()=>{
  const start=conciseStoryboardState('memory',0),moving=conciseStoryboardState('memory',1),arrived=conciseStoryboardState('memory',2);
  assert.equal(start.copy,null);assert.equal(start.authorized,false);
  assert.equal(moving.authorized,true);assert.equal(moving.arrived,false);
  assert.equal(arrived.arrived,true);assert.ok(rectContains(arrived.windowContent,arrived.copy.rect));
  for(const state of [start,moving,arrived])assert.deepEqual(state.source,start.source);
  assert.equal(moving.copy.value,arrived.source.value);assert.equal(arrived.copy.value,arrived.source.value);
});

test('order result is hidden until this query returns; historic state is preserved',()=>{
  for(let phase=0;phase<3;phase++){
    const state=conciseStoryboardState('order',phase);
    assert.equal(state.orderId,'317');assert.deepEqual(state.oldSnapshot,{time:'10:02',value:'待发货',retained:true});
    assert.equal(state.querySent,phase>=1);assert.equal(state.queryReturned,phase===2);
    assert.deepEqual(state.currentResult,phase===2?{time:'10:05',value:'已发货',orderId:'317'}:null);
  }
});

test('memory copy keeps its physical footprint and arrival path has no needless elbow',()=>{
  const moving=conciseStoryboardState('memory',1),arrived=conciseStoryboardState('memory',2);
  assert.equal(arrived.copy.rect.width,moving.copy.rect.width);
  assert.equal(arrived.copy.rect.height,moving.copy.rect.height);
  assert.equal(arrived.connections.length,1);
  assert.equal(arrived.connections[0].points.length,2);
  assert.equal(arrived.connections[0].points[0][1],arrived.connections[0].points[1][1]);
});
