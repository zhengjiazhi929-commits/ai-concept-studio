import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutScene,fullSceneState,progressGeometry,fullSurfaceStyle,sourceReadState,pointOnOrthogonalPath,preflightFullRevisionText} from '../src/video/explainer-full-revision/model.mjs';
import {assertFullCardDomFit} from '../src/video/explainer-full-revision/text-fit-guard.mjs';

for(const layout of ['topic','outline','compare','flow','sources','input','answer','record','tests','lifecycle']) {
  test(`${layout}: bounded, non-overlapping content and orthogonal connections`,()=>{
    for(let count=1;count<=(layout==='sources'?5:4);count++){
      const {boxes,connections}=layoutScene({layout,items:Array.from({length:count},()=>({title:'合成标题',body:'合成说明'}))});
      assert.equal(boxes.length,count);
      for(const b of boxes){assert.ok(b.x>=108&&b.y>=280&&b.x+b.w<=1812&&b.y+b.h<=860);assert.equal(fullSurfaceStyle(b).minHeight,b.h);}
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i],b=boxes[j];assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);
      }
      for(const edge of connections)for(let i=1;i<edge.points.length;i++){
        const a=edge.points[i-1],b=edge.points[i];assert.ok(a[0]===b[0]||a[1]===b[1]);
      }
    }
  });
}
test('reveal follows narration, holds in pause, never reveals next item early',()=>{
  const timing={scenes:[{id:'A',startFrame:0,endFrame:120}],segments:[
    {sceneId:'A',startFrame:0,endFrame:40,text:'甲',focusIndex:0,revealCount:1},
    {sceneId:'A',startFrame:50,endFrame:120,text:'乙',focusIndex:1,revealCount:2}]};
  assert.equal(fullSceneState(timing,0).current.revealCount,1);
  assert.equal(fullSceneState(timing,49).current.revealCount,1);
  assert.equal(fullSceneState(timing,49).caption,'');
  assert.equal(fullSceneState(timing,50).current.revealCount,2);
});
test('progress uses all global chapter durations and cannot restart at render chunk boundary',()=>{
  const chapters=[{id:'a',startFrame:0,endFrame:100},{id:'b',startFrame:100,endFrame:500},{id:'c',startFrame:500,endFrame:800},{id:'d',startFrame:800,endFrame:1000}];
  const bars=progressGeometry(chapters,900);
  assert.deepEqual(bars.map(b=>b.amount),[1,1,1,.5]);
  assert.ok(Math.abs(bars[1].w/bars[0].w-4)<1e-10);
  assert.ok(Math.abs(bars.at(-1).x+bars.at(-1).w-1812)<1e-10);
});
test('source copy follows its orthogonal route; destination waits for arrival, summary does not resend',()=>{
  const points=[[800,350],[916,350],[916,545],[1094,545]];
  for(let f=0;f<=24;f++){
    const [x,y]=pointOnOrthogonalPath(points,f/24);
    assert.ok((y===350&&x>=800&&x<=916)||(x===916&&y>=350&&y<=545)||(y===545&&x>=916&&x<=1094));
  }
  const scene={segments:[{startFrame:0,focusIndex:-1,revealCount:1},{startFrame:90,focusIndex:0,revealCount:1},{startFrame:180,focusIndex:-1,revealCount:1}]};
  assert.equal(sourceReadState(scene,scene.segments[0],50).deliveredCount,0);
  assert.equal(sourceReadState(scene,scene.segments[1],113).deliveredCount,0);
  assert.equal(sourceReadState(scene,scene.segments[1],114).deliveredCount,1);
  assert.deepEqual(sourceReadState(scene,scene.segments[2],180),{deliveredCount:1,pendingCount:1,progress:1});
});

test('maximum valid Chinese text reflows flow cards instead of spilling or shrinking',()=>{
  const items=Array.from({length:4},()=>({title:'长'.repeat(18),body:'文'.repeat(55)}));
  const {boxes}=layoutScene({layout:'flow',items});
  for(const b of boxes){
    const inner=b.w-56,titleSize=b.w<440?36:40,bodySize=b.w<440?28:32;
    const needed=26+Math.ceil(18*titleSize/inner)*titleSize*1.35+24
      +Math.ceil(55*bodySize/inner)*bodySize*1.45+26;
    assert.ok(needed<=b.h,`text needs ${needed}px inside ${b.h}px`);
  }
});

test('fitting four-card flow preserves the approved geometry exactly',()=>{
  const {boxes,connections}=layoutScene({layout:'flow',items:Array.from({length:4},()=>({title:'合成标题',body:'合成说明'}))});
  assert.deepEqual(boxes,[0,1,2,3].map(i=>({x:132+i*433.5,y:408,w:355.5,h:292})));
  assert.deepEqual(connections,[1,2,3].map(i=>({toIndex:i,points:[[132+(i-1)*433.5+364.5,554],[132+i*433.5-9,554]]})));
});

test('bounded long-text layouts preserve all text and connector order; impossible topic fails closed',()=>{
  for(const type of ['outline','compare','flow','lifecycle','input','record','answer','tests','sources']){
    const items=Array.from({length:type==='sources'?5:4},()=>({title:'长'.repeat(18),body:'文'.repeat(type==='sources'?22:55)}));
    const scene={id:'synthetic',layout:type,items};
    const before=structuredClone(scene),{boxes,text,connections}=layoutScene(scene);
    assert.deepEqual(scene,before);
    for(let i=0;i<boxes.length;i++)assert.ok(text[i].requiredHeight<=boxes[i].h&&boxes[i].y+boxes[i].h<=860,type);
    for(const edge of connections)for(let i=1;i<edge.points.length;i++)assert.ok(edge.points[i][0]===edge.points[i-1][0]||edge.points[i][1]===edge.points[i-1][1]);
    assert.equal(preflightFullRevisionText({scenes:[scene]}).layouts.length,1);
  }
  assert.throws(()=>layoutScene({layout:'topic',items:Array.from({length:4},()=>({title:'长'.repeat(18),body:'文'.repeat(55)}))}),/split the scene/);
});

test('real-font DOM guard rejects vertical/horizontal overflow and overlapping text',()=>{
  const rect=(x,y,w,h)=>({left:x,top:y,right:x+w,bottom:y+h});
  const node=r=>({textContent:'合成文字',getBoundingClientRect:()=>r});
  const root=rects=>({querySelectorAll:()=>[{getBoundingClientRect:()=>rect(100,100,500,200),querySelectorAll:()=>rects.map(node)}]});
  assert.doesNotThrow(()=>assertFullCardDomFit(root([rect(128,126,444,54),rect(128,204,444,46)])));
  for(const bad of [[rect(128,280,444,54)],[rect(128,126,500,54)],
    [rect(128,126,444,54),rect(128,160,444,54)]])assert.throws(()=>assertFullCardDomFit(root(bad)),/overflow|overlap/);
});

test('expanded source cards remain a vertical list and reconnect from their real centers',()=>{
  const fitting=layoutScene({layout:'sources',items:Array.from({length:5},()=>({title:'长'.repeat(18),body:'文'.repeat(22)}))});
  assert.deepEqual(fitting.boxes,[0,1,2,3,4].map(i=>({x:132,y:300+i*110,w:650,h:100})));
  const scene={layout:'sources',items:Array.from({length:3},()=>({title:'来源',body:'长'.repeat(44)}))};
  const {boxes,connections}=layoutScene(scene);
  assert.equal(new Set(boxes.map(box=>box.x)).size,1);
  for(let i=1;i<boxes.length;i++)assert.ok(boxes[i].y>=boxes[i-1].y+boxes[i-1].h+10);
  for(const [i,edge] of connections.entries()){
    const box=boxes[i];
    assert.deepEqual(edge.points,[[box.x+box.w+12,box.y+box.h/2],[916,box.y+box.h/2],[916,545],[1094,545]]);
    assert.equal(edge.toIndex,i);
  }
});

test('source title growth cannot overlap its body and an overfull source list must split',()=>{
  const {text}=layoutScene({layout:'sources',items:[{title:'长'.repeat(30),body:'具体说明'}]});
  assert.ok(text[0].title.y+text[0].title.h+8<=text[0].body.y);
  assert.throws(()=>layoutScene({layout:'sources',items:Array.from({length:5},()=>({title:'来源',body:'长'.repeat(44)}))}),/split the scene/);
});

test('expanded comparison cards retain the intended two-column grid',()=>{
  const {boxes}=layoutScene({layout:'compare',items:Array.from({length:4},()=>({title:'长'.repeat(18),body:'文'.repeat(55)}))});
  assert.equal(boxes[0].y,boxes[1].y);assert.equal(boxes[2].y,boxes[3].y);
  assert.equal(boxes[0].x,boxes[2].x);assert.equal(boxes[1].x,boxes[3].x);
  assert.ok(boxes[1].x>=boxes[0].x+boxes[0].w);
  assert.ok(boxes[2].y>=boxes[0].y+boxes[0].h+28);
});

test('text preflight explicitly covers generic cards, not legacy semantic drawings',()=>{
  const result=preflightFullRevisionText({scenes:[
    {id:'synthetic-generic',layout:'flow',items:[{title:'标题',body:'正文'}]},
    {id:'F01',layout:'flow',items:[{title:'语义场景',body:'旧组件'}]}
  ]});
  assert.equal(result.scope,'generic-card-only');
  assert.deepEqual(result.excludedSemanticSceneIds,['F01']);
  assert.deepEqual(result.layouts.map(layout=>layout.sceneId),['synthetic-generic']);
  assert.match(result.assurance,/generic-card-only/u);
});
