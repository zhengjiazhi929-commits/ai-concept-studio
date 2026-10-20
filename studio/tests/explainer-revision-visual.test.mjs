import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activePhrase, chapterProgress, VISUALS, SAFE_AREAS, orthogonalPoints,
  queryMechanismState, compressionMechanismState, fallbackMechanismState,
  writeTimelineState, writeTimelineConnections} from '../src/video/explainer-revision/model.mjs';
import {createExplainerRevisionPlanFixture} from './helpers/explainer-revision-plan-fixture.mjs';

test('voice boundary owns the picture, captions disappear in gaps', () => {
  const segments=[{id:'a',startFrame:0,endFrame:10,visual:'topic'},{id:'b',startFrame:12,endFrame:20,visual:'outline'}];
  assert.equal(activePhrase(segments,0).current.visual,'topic');
  assert.equal(activePhrase(segments,10).caption,'');
  assert.equal(activePhrase(segments,11).current.visual,'topic');
  assert.equal(activePhrase(segments,12).current.visual,'outline');
});
test('progress uses global frames and never resets at clip joins', () => {
  const chapters=[{id:'a',startFrame:0,endFrame:60},{id:'b',startFrame:60,endFrame:120}];
  assert.deepEqual(chapterProgress(chapters,59).map(x=>x.amount),[59/60,0]);
  assert.deepEqual(chapterProgress(chapters,80).map(x=>x.amount),[1,1/3]);
  assert.deepEqual(chapterProgress(chapters,120).map(x=>x.amount),[1,1]);
});
test('chapter widths use measured durations, not equal slots or hard-coded percentages', () => {
  const chapters=[{id:'a',startFrame:0,endFrame:60},{id:'b',startFrame:60,endFrame:180},{id:'c',startFrame:180,endFrame:600}];
  const before=structuredClone(chapters);
  const progress=chapterProgress(chapters,120);
  assert.deepEqual(progress.map(c=>c.durationFrames),[60,120,420]);
  assert.deepEqual(progress.map(c=>c.widthFraction),[0.1,0.2,0.7]);
  assert.deepEqual(progress.map(c=>c.amount),[1,0.5,0]);
  assert.deepEqual(chapters,before,'layout calculation must not modify the timing');
  const revised=chapterProgress([{id:'a',startFrame:0,endFrame:25},{id:'b',startFrame:25,endFrame:100}],30);
  assert.deepEqual(revised.map(c=>c.widthFraction),[0.25,0.75]);
});
test('weighted fill represents elapsed time across unequal chapter boundaries', () => {
  const chapters=[{id:'a',startFrame:0,endFrame:9},{id:'b',startFrame:9,endFrame:40},{id:'c',startFrame:40,endFrame:100}];
  for(let frame=-1;frame<=101;frame++) {
    const progress=chapterProgress(chapters,frame);
    const played=progress.reduce((sum,c)=>sum+c.widthFraction*c.amount,0);
    assert.ok(Math.abs(played-Math.max(0,Math.min(1,frame/100)))<1e-12);
    assert.ok(Math.abs(progress.reduce((sum,c)=>sum+c.widthFraction,0)-1)<1e-12);
  }
});
test('duration-weighted progress rejects invalid frame spans', () => {
  for(const chapters of [[],[{startFrame:0,endFrame:0}],[{startFrame:10,endFrame:9}],
    [{startFrame:0,endFrame:Infinity}],[{startFrame:0,endFrame:0.5}]]) {
    assert.throws(()=>chapterProgress(chapters,0),/chapter|duration/i);
  }
});
test('chapter flex sizing cannot be expanded by intrinsic label width', async () => {
  const source=await readFile(new URL('../src/video/explainer-revision/root.jsx',import.meta.url),'utf8');
  assert.match(source,/data-chapter-progress=\{c.id\}/);
  assert.match(source,/flexGrow:c.durationFrames,flexBasis:0,minWidth:0/);
  assert.match(source,/data-chapter-label/);
  assert.match(source,/whiteSpace:'nowrap'/);
});
test('caption, content, navigation and logo have separate safe regions', () => {
  assert.ok(SAFE_AREAS.content.bottom < SAFE_AREAS.caption.top);
  assert.ok(SAFE_AREAS.caption.bottom < SAFE_AREAS.progress.top);
  assert.ok(SAFE_AREAS.heading.right < SAFE_AREAS.logo.left);
});
test('connection paths reject diagonal segments', () => {
  assert.equal(orthogonalPoints([[0,0],[20,0],[20,40]]),'0,0 20,0 20,40');
  assert.throws(()=>orthogonalPoints([[0,0],[20,40]]),/orthogonal/);
});
const REQUIRED_MECHANISMS = ['answer-fact','answer-limit','answer-next','model-input','memory-record',
  'sync-write','async-receipt','async-write','test-freshness','test-access','test-unavailable'];

function assertSyntheticPlanVisualContract(plan) {
  const segments=plan.clips.flatMap(c=>c.segments);
  assert.deepEqual(segments.slice(0,2).map(s=>s.visual),['topic','outline']);
  assert.ok(segments.every(s=>VISUALS.includes(s.visual)),'every fixture visual must be supported');
  assert.deepEqual(plan.chapters.map(c=>c.id),['concept','types','relationship','practice']);
  const order=segments.map(s=>plan.chapters.findIndex(c=>c.id===s.chapterId));
  assert.ok(order.every(n=>n>=0),'every segment must name a known chapter');
  assert.ok(order.every((n,i)=>i===0||n>=order[i-1]));
  assert.equal(new Set(segments.map(s=>s.id)).size,segments.length);
  assert.ok(REQUIRED_MECHANISMS
    .every(v=>segments.some(s=>s.visual===v)));
}

test('synthetic plan starts with topic and outline and every narrated mechanism is supported', () => {
  const plan=createExplainerRevisionPlanFixture();
  assertSyntheticPlanVisualContract(plan);
  // The independent fixture also detects registry omissions or undocumented
  // additions; it is never generated from the implementation being checked.
  assert.deepEqual([...new Set(plan.clips.flatMap(c=>c.segments.map(s=>s.visual)))].sort(),[...VISUALS].sort());
});

test('synthetic plan contract rejects wrong opening, chapter order, identities and missing mechanisms', () => {
  const invalidEdits=[
    plan=>{plan.clips[0].segments.reverse();},
    plan=>{plan.clips[0].segments[2].visual='unsupported-synthetic-visual';},
    plan=>{plan.clips[0].segments[0].chapterId='missing-synthetic-chapter';},
    plan=>{plan.clips[1].segments[0].chapterId='concept';},
    plan=>{plan.chapters.reverse();},
    plan=>{plan.clips[1].segments[0].id=plan.clips[0].segments[0].id;}
  ];
  for(const edit of invalidEdits) {
    const plan=createExplainerRevisionPlanFixture();
    edit(plan);
    assert.throws(()=>assertSyntheticPlanVisualContract(plan),assert.AssertionError);
  }
  for(const visual of REQUIRED_MECHANISMS) {
    const plan=createExplainerRevisionPlanFixture();
    for(const clip of plan.clips)clip.segments=clip.segments.filter(s=>s.visual!==visual);
    assert.throws(()=>assertSyntheticPlanVisualContract(plan),assert.AssertionError,`missing ${visual} must fail`);
  }
});

test('fresh fact arrives before the old fact loses current authority', () => {
  const start=queryMechanismState(0), pending=queryMechanismState(0.5), end=queryMechanismState(1);
  assert.equal(start.oldIsCurrent,true);
  assert.equal(start.newProgress,0);
  assert.equal(pending.oldIsCurrent,true);
  assert.equal(end.oldIsCurrent,false);
  assert.equal(end.newIsCurrent,true);
  assert.equal(end.newProgress,1);
  assert.ok(end.oldOpacity<start.oldOpacity);
  for(let f=0;f<=150;f++) {
    const state=queryMechanismState(f/150);
    assert.notEqual(state.oldIsCurrent,state.newIsCurrent,'exactly one current fact owner');
    if(state.newIsCurrent)assert.equal(state.newProgress,1,'incoming result must arrive first');
  }
});

test('compression removes chatter from selection but never loses the constraint', () => {
  const start=compressionMechanismState(0),end=compressionMechanismState(1);
  assert.equal(start.chatterSelected,true);
  assert.equal(end.chatterSelected,false);
  assert.equal(end.constraintFlow,1);
  assert.equal(end.updatedFactFlow,1);
  assert.ok(end.chatterOpacity<start.chatterOpacity);
  for(let f=0;f<=120;f++)assert.equal(compressionMechanismState(f/120).constraintSourceOpacity,1);
  assert.equal(compressionMechanismState(0.2).constraintOutputVisible,false);
  assert.equal(end.constraintOutputVisible,true);
});

test('memory failure stops its path while scoped business evidence can continue', () => {
  const start=fallbackMechanismState(0),failure=fallbackMechanismState(0.3),end=fallbackMechanismState(1);
  assert.equal(start.memoryStatus,'requesting');
  assert.equal(failure.memoryStatus,'unavailable');
  assert.equal(failure.businessOutputReady,false);
  assert.equal(end.businessOutputReady,true);
  assert.equal(end.businessProgress,1);
  for(let f=0;f<=150;f++) {
    const state=fallbackMechanismState(f/150);
    assert.equal(state.memoryDelivered,false);
    assert.equal(state.scopeRelaxed,false);
    assert.notEqual(state.memoryStatus,'empty');
    assert.notEqual(state.memoryStatus,'success');
  }
});

test('all mechanisms finish within a phrase and hold their terminal state in its gap', () => {
  for(const state of [queryMechanismState,compressionMechanismState,fallbackMechanismState]) {
    assert.deepEqual(state(0.9),state(1));
    assert.deepEqual(state(1),state(2));
    assert.deepEqual(state(-1),state(0));
    for(const invalid of [NaN,Infinity,undefined])assert.throws(()=>state(invalid),/finite/i);
  }
});

test('write completion follows the parent timing fix and persists into later phrases', () => {
  assert.deepEqual(writeTimelineState('write-compare',0),{syncStep:0,asyncStep:0});
  assert.equal(writeTimelineState('sync-write',0.1).syncStep,1);
  assert.equal(writeTimelineState('sync-write',0.3).syncStep,2);
  assert.equal(writeTimelineState('sync-write',0.7).syncStep,3);
  assert.deepEqual(writeTimelineState('async-receipt',0.3),{syncStep:3,asyncStep:1});
  assert.deepEqual(writeTimelineState('async-write',0.3),{syncStep:3,asyncStep:2});
  assert.deepEqual(writeTimelineState('async-write',0.6),{syncStep:3,asyncStep:3});
  assert.throws(()=>writeTimelineState('unknown',0.5),/write visual/i);
});

test('write timeline connectors hit real borders without crossing a card interior', () => {
  for(const row of [0,1]) {
    const y=471+row*243,connections=writeTimelineConnections(row);
    assert.deepEqual(connections,[[[796,y],[844,y]],[[1292,y],[1340,y]]]);
    for(const edge of connections) {
      assert.doesNotThrow(()=>orthogonalPoints(edge));
      for(let x=edge[0][0];x<=edge[1][0];x++) {
        for(let col=0;col<3;col++)assert.ok(!(x>348+496*col&&x<796+496*col));
      }
    }
  }
  assert.throws(()=>writeTimelineConnections(2),/row/i);
});
