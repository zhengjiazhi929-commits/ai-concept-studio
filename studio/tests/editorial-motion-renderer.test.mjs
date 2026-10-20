import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {editorialMotionRendererFixture} from './editorial-motion-renderer-fixture.mjs';

const entry=fileURLToPath(new URL('../src/video/editorial-motion-preview.jsx',import.meta.url));
const modelEntry=fileURLToPath(new URL('../src/video/editorial-motion-render-model.mjs',import.meta.url));
const built=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',logLevel:'silent'});
const module={exports:{}};let frame=0;
const require=createRequire(entry);
const rendererRequire=name=>name==='remotion'?{
  AbsoluteFill:props=>React.createElement('div',props),Img:'img',staticFile:path=>path,
  useCurrentFrame:()=>frame,useVideoConfig:()=>({width:1920,height:1080,fps:30,durationInFrames:360}),
}:require(name);
vm.runInThisContext(`(function(module,exports,require){\n${built.outputFiles[0].text}\n})`)(module,module.exports,rendererRequire);
const {buildEditorialMotionRenderModel,EditorialMotionArtwork,EditorialMotionPreview}=module.exports;
const model=(episode,at)=>buildEditorialMotionRenderModel(episode,at,30);
const markup=(episode,at)=>{frame=at;return renderToStaticMarkup(React.createElement(EditorialMotionPreview,{episode}));};

test('renderer model is deterministic, preserves source and changes copy state only at actual beats (not pixel QA)',()=>{
  const episode=editorialMotionRendererFixture();const before=JSON.stringify(episode);
  const early=model(episode,19);assert.equal(early.objects.some(item=>item.id==='copy'),false);
  for(const at of [20,40,50,59,60,90]) {
    const value=model(episode,at);const source=value.objects.find(item=>item.id==='source');
    assert.deepEqual([source.x,source.y],[120,485]);assert.equal(source.body.text,'简短中文');
    assert.deepEqual(value,model(episode,at));
  }
  assert.equal(model(episode,59).objects.find(item=>item.id==='copy').status,'in-transit');
  assert.equal(model(episode,59).objects.find(item=>item.id==='copy').containerId,null);
  assert.equal(model(episode,60).objects.find(item=>item.id==='copy').status,'included');
  assert.equal(model(episode,90).objects.find(item=>item.id==='copy').body.text,'本次英文');
  assert.equal(JSON.stringify(episode),before);
});

test('container markup is behind source/copies and contained text stays below its header (SSR geometry only)',()=>{
  const episode=editorialMotionRendererFixture();const value=model(episode,60);
  const container=value.objects.find(item=>item.id==='input');const copy=value.objects.find(item=>item.id==='copy');
  assert.ok(copy.y>=container.y+container.headerBottom+16);
  assert.ok(copy.x>=container.x+24 && copy.x+copy.width<=container.x+container.width-24);
  const html=renderToStaticMarkup(React.createElement(EditorialMotionArtwork,{model:value}));
  assert.ok(html.indexOf('data-editorial-object-id="input"')<html.indexOf('data-editorial-object-id="copy"'));
  assert.match(html,/data-motion-state="included"/u);assert.match(html,/data-editorial-object-id="source"/u);
  assert.doesNotMatch(html,/clipPath|text-overflow|overflow:hidden|✓|✔/u);
});

test('cards use full frosted material, fixed readable type and no decorative text-prefix icons',()=>{
  const episode=editorialMotionRendererFixture();episode.scenes[0].motionPlan.events=[];episode.scenes[0].motionPlan.objects=[{id:'card',kind:'card',label:'保留原始记录',detail:'只把副本送入上下文',x:120,y:300,width:650,height:240,scopeId:'note',sourceId:null,initiallyVisible:true}];
  const value=model(episode,0);const card=value.objects.find(item=>item.id==='card');
  assert.equal(card.title.fontSize,48);assert.equal(card.body.fontSize,36);
  const html=markup(episode,0);assert.match(html,/data-glass-card="mint-frosted-thin-v001"/u);
  assert.match(html,/border:1.5px solid rgba\(255,255,255,0.9\)/u);assert.match(html,/backdrop-filter:blur\(14px\)/u);
  assert.doesNotMatch(html,/font-weight:[7-9]00|data-card-icon|animation:|transition:/u);
});

test('source objects have simple distinct complete outlines and unstroked independent text',()=>{
  const episode=editorialMotionRendererFixture();episode.scenes[0].motionPlan.events=[];
  episode.scenes[0].motionPlan.objects=[
    {id:'page',kind:'page',label:'资料页面',detail:'带来源',x:110,y:390,width:360,height:260,scopeId:'a',sourceId:null,initiallyVisible:true},
    {id:'store',kind:'store',label:'知识库',detail:'按版本查阅',x:600,y:360,width:500,height:380,scopeId:'a',sourceId:null,initiallyVisible:true},
    {id:'note',kind:'label',label:'先读取，再组装',detail:'保留来源',x:1240,y:470,width:540,height:180,scopeId:'a',sourceId:null,initiallyVisible:true},
  ];
  const html=markup(episode,0);assert.match(html,/data-editorial-shape="page"/u);assert.match(html,/data-editorial-shape="store"/u);
  assert.doesNotMatch(html,/<text\b|data-card-icon|data-glass-card/u);
  assert.match(html,/font-family:&quot;Noto Sans SC Variable&quot;/u);
});

test('connector shafts have only H/V segments and visible directional endpoints',()=>{
  const value=model(editorialMotionRendererFixture(),50);
  assert.ok(value.connections.length>0);
  for(const connection of value.connections) {
    assert.match(connection.path,/^M /u);assert.doesNotMatch(connection.path,/[LCQ]/u);
    assert.match(connection.direction,/^(left|right|up|down)$/u);
  }
  const html=renderToStaticMarkup(React.createElement(EditorialMotionArtwork,{model:value}));assert.match(html,/data-editorial-arrowhead=/u);
});

test('global frame selects exact scene/caption boundaries and watermark never resets per scene',()=>{
  const episode=editorialMotionRendererFixture();const second=structuredClone(episode.scenes[0]);
  second.id='synthetic-b';second.start=6.0000001;second.end=12;second.startFrame=180;second.endFrame=360;episode.scenes.push(second);
  episode.subtitles.push({start:6,end:12,startFrame:180,endFrame:360,text:'下一轮继续核对'});
  assert.equal(model(episode,179).sceneId,'synthetic-a');assert.equal(model(episode,180).sceneId,'synthetic-b');assert.equal(model(episode,180).localFrame,0);
  assert.equal(model(episode,59).caption.text,'先复制需要的内容');assert.equal(model(episode,60).caption.text,'到达窗口后才纳入上下文');
  assert.equal(model(episode,180).caption.text,'下一轮继续核对');
  const html=markup(episode,181);assert.match(html,/data-ai-watermark-profile="approved-v013-stable-footprint"/u);assert.match(html,/data-ai-watermark-motion-cadence="continuous"/u);
  assert.match(html,/data-ai-watermark-raster-frame="61"/u);assert.doesNotMatch(html,/data-editorial-subtitle[^>]*background|data-editorial-subtitle[^>]*border:/u);
});

test('long text, title/subtitle collisions, invalid timing and unsupported canvas reject instead of clipping',()=>{
  for(const change of [
    e=>{e.scenes[0].motionPlan.objects[0].label='这是一个太长的标题绝对不能缩小字体或者被裁切';e.scenes[0].motionPlan.objects[0].height=150;},
    e=>{e.scenes[0].motionPlan.objects[0].y=50;},
    e=>{e.scenes[0].motionPlan.objects[1].y=850;},
    e=>{e.scenes[0].motionPlan.canvas.width=1080;},
    e=>{e.scenes[0].title='这是极长标题'.repeat(30);},
    e=>{e.subtitles[0].text='极长的字幕不允许隐藏'.repeat(40);},
    e=>{e.scenes[0].endFrame=0;},
  ]) {const episode=editorialMotionRendererFixture();change(episode);assert.throws(()=>model(episode,0));}
  assert.throws(()=>model(editorialMotionRendererFixture(),-1));
  assert.throws(()=>model(editorialMotionRendererFixture(),180));
});

test('renderer implementation is declared frame-driven and independent of old single-graphic resolver',async()=>{
  const source=await readFile(entry,'utf8')+await readFile(modelEntry,'utf8');
  assert.match(source,/resolveEditorialMotionFrame/u);assert.match(source,/useCurrentFrame/u);assert.match(source,/frostedCardStyle/u);
  assert.doesNotMatch(source,/Math\.random|Date\.now|setInterval|setTimeout|animation:|transition:|ProductionSemanticPreview|visual-system-v1\/resolver/u);
});

test('the server preflight imports the same pure render model and compiled snapshots cannot drift',async()=>{
  const pure=await import(modelEntry);const episode=editorialMotionRendererFixture();
  const compiled=pure.compileEditorialMotionRenderEpisode(episode,30);
  assert.deepEqual(pure.buildEditorialMotionRenderModel(episode,60,30),model(episode,60));
  const snapshot=pure.buildEditorialMotionRenderModel(compiled,60,30);
  episode.scenes[0].title='修改原始对象不能改变编译快照';
  assert.deepEqual(pure.buildEditorialMotionRenderModel(compiled,60,30),snapshot);
  assert.ok(Object.isFrozen(compiled.scenes[0].motionPlan));
  assert.throws(()=>{compiled.scenes[0].title='changed';},TypeError);
  assert.doesNotMatch(await readFile(modelEntry,'utf8'),/from ['"](?:react|remotion)['"]|\.jsx['"]/u);
});

test('membership and invalidation have readable reserved status lines, never floating badges',()=>{
  const episode=editorialMotionRendererFixture();
  for(const [at,text] of [[59,'传送中，尚未纳入'],[60,'已纳入本轮']]) {
    const copy=model(episode,at).objects.find(item=>item.id==='copy');
    assert.equal(copy.stateText.text,text);
    assert.ok(copy.stateText.y>=copy.body.y+copy.body.height+12);
    assert.ok(copy.stateText.y+copy.stateText.height<=copy.height-copy.padding);
    assert.ok(markup(episode,at).includes(text));
  }
  episode.scenes[0].narration+='停用旧记录。';
  episode.scenes[0].motionPlan.events.push({id:'invalidate',cue:'停用旧记录',atFrame:120,durationFrames:0,op:'invalidate',objectId:'source',targetId:null,value:null,requires:[]});
  assert.ok(markup(episode,120).includes('已停用，不再召回'));
  for(const object of episode.scenes[0].motionPlan.objects.filter(item=>item.kind==='page')) object.height=170;
  assert.throws(()=>model(episode,60),/text-overflow/u);
});

test('retired relation endpoints do not leave arrows pointing to invisible objects',()=>{
  const episode=editorialMotionRendererFixture();episode.scenes[0].narration+='隐藏来源。';
  episode.scenes[0].motionPlan.events.push({id:'hide',cue:'隐藏来源',atFrame:120,durationFrames:0,op:'retire',objectId:'source',targetId:null,value:null,requires:[]});
  const value=model(episode,120);assert.equal(value.objects.some(item=>item.id==='source'),false);
  assert.equal(value.objects.some(item=>item.id==='copy'),true);assert.equal(value.connections.length,0);
});

test('server geometry rejects cards outside the actual frosted material dimensions',()=>{
  for(const [width,height] of [[300,240],[500,170]]) {
    const episode=editorialMotionRendererFixture();episode.scenes[0].motionPlan.events=[];
    episode.scenes[0].motionPlan.objects=[{id:'small',kind:'card',label:'短标题',detail:'',x:120,y:300,width,height,scopeId:'a',sourceId:null,initiallyVisible:true}];
    assert.throws(()=>model(episode,0),/Invalid glass card/u);
  }
});

test('records inside a store never claim to be included in the model context',()=>{
  const episode=editorialMotionRendererFixture();episode.scenes[0].motionPlan.events=[];
  const store={id:'records',kind:'store',label:'长期记录',detail:'',x:930,y:310,width:850,height:560,scopeId:'records',sourceId:null,initiallyVisible:true};
  const record={id:'existing',kind:'page',label:'已有偏好',detail:'简短中文',x:980,y:625,width:440,height:220,scopeId:'records',sourceId:null,containerId:'records',initiallyVisible:true};
  episode.scenes[0].motionPlan.objects=[store,record];
  assert.equal(model(episode,0).objects.find(item=>item.id==='existing').stateText.text,'存储记录');
  assert.doesNotMatch(markup(episode,0),/已纳入本轮/u);
  const arriving=editorialMotionRendererFixture();arriving.scenes[0].motionPlan.objects[1].kind='store';
  arriving.scenes[0].motionPlan.objects[1].detail='';
  arriving.scenes[0].motionPlan.events=arriving.scenes[0].motionPlan.events.slice(0,3);
  assert.equal(model(arriving,60).objects.find(item=>item.id==='copy').stateText.text,'已放入记录区');
});

test('bounded summary shows all preserved fields and its own readable state before transfer',()=>{
  const episode=editorialMotionRendererFixture();const plan=episode.scenes[0].motionPlan;
  const fields={goal:'查订单',constraints:'先核实',openQuestions:'运费未明'};
  const summary='目标：查订单\n约束：先核实\n未解决问题：运费未明';
  Object.assign(plan.objects[0],{label:'原始对话',detail:'查订单，先核实，运费未明，保留此前对话。',value:'查订单，先核实，运费未明，保留此前对话。',summaryFields:fields,width:500,height:340,scopeId:'session-b'});
  Object.assign(plan.objects[2],{label:'摘要',detail:summary,value:summary,summaryFields:{...fields},transformation:'summary',width:500,height:350});
  episode.scenes[0].narration='保留来源。生成摘要。送入窗口。到达以后才纳入。';
  plan.events=plan.events.slice(0,3);plan.events[0].op='summarize';plan.events[0].cue='生成摘要';
  const at=model(episode,20);const copy=at.objects.find(item=>item.id==='copy');
  assert.equal(copy.stateText.text,'关键字段已保留');assert.deepEqual(copy.body.lines,summary.split('\n'));
  assert.equal(at.objects.find(item=>item.id==='source').title.text,'原始对话');
  assert.ok(copy.stateText.y+copy.stateText.height<=copy.height-copy.padding);
  assert.ok(markup(episode,20).includes('关键字段已保留'));
});

test('a checked summary never suggests persistence that its execution contract prohibits',()=>{
  const episode=editorialMotionRendererFixture();const plan=episode.scenes[0].motionPlan;
  const fields={goal:'查订单',constraints:'先核实',openQuestions:'运费未明'};
  const summary='目标：查订单\n约束：先核实\n未解决问题：运费未明';
  Object.assign(plan.objects[0],{label:'原始对话',detail:'查订单，先核实，运费未明。',value:'查订单，先核实，运费未明。',summaryFields:fields,width:500,height:340,scopeId:'session-b'});
  Object.assign(plan.objects[2],{label:'摘要',detail:summary,value:summary,summaryFields:{...fields},transformation:'summary',width:500,height:350});
  plan.objects[1].kind='store';plan.objects[1].detail='';
  episode.scenes[0].narration='保留来源。生成摘要。送入窗口。到达以后才纳入。核对摘要。';
  plan.events=plan.events.slice(0,3);plan.events[0].op='summarize';plan.events[0].cue='生成摘要';
  plan.events.push({id:'check-summary',cue:'核对摘要',atFrame:80,durationFrames:0,op:'check',objectId:'copy',targetId:null,value:'passed',requires:[]});
  const copy=model(episode,80).objects.find(item=>item.id==='copy');
  assert.equal(copy.stateText.text,'核对通过');
  assert.doesNotMatch(markup(episode,80),/待保存|已保存/u);
  assert.ok(copy.stateText.y+copy.stateText.height<=copy.height-copy.padding);
  // Non-summary candidates retain their real, separately gated save step.
  delete plan.objects[2].transformation;
  Object.assign(plan.objects[2],{label:plan.objects[0].label,detail:plan.objects[0].detail,value:plan.objects[0].value});
  plan.events[0].op='copy';
  assert.equal(model(episode,80).objects.find(item=>item.id==='copy').stateText.text,'核对通过，待保存');
});

test('overlapping edge spans use one straight connector without miniature staircase bends',async()=>{
  const {buildEditorialMotionConnectionModel:connect}=await import(modelEntry);
  const c={id:'link',fromId:'a',toId:'b',objectId:'copy',status:'moving',progress:0.5};
  const horizontal=connect(c,[{id:'a',x:120,y:485,width:360,height:225},{id:'b',x:930,y:310,width:850,height:560}]);
  assert.equal(horizontal.path,'M 492 597.5 H 918');
  const vertical=connect(c,[{id:'a',x:120,y:300,width:400,height:180},{id:'b',x:125,y:700,width:400,height:150}]);
  assert.match(vertical.path,/^M [\d.]+ 492 V 688$/u);
});

test('a stored source exits the visible parent boundary and third-party obstructions fail closed',async()=>{
  const {buildEditorialMotionConnectionModel:connect}=await import(modelEntry);
  const c={id:'link',fromId:'source',toId:'target',objectId:'copy',status:'moving',progress:0.5};
  const objects=[
    {id:'store',kind:'store',x:100,y:300,width:600,height:570},
    {id:'source',kind:'page',x:150,y:500,width:300,height:210,containerId:'store'},
    {id:'target',kind:'window',x:1000,y:420,width:700,height:450},
    {id:'copy',kind:'page',x:770,y:500,width:300,height:210,inTransit:true,sourceId:'source'},
  ];
  const route=connect(c,objects);assert.match(route.path,/^M 712 /u);
  assert.equal(route.fromId,'source');assert.equal(route.fromBoundaryId,'store');
  assert.throws(()=>connect(c,[...objects,{id:'unrelated',kind:'label',x:810,y:620,width:120,height:70}]),/connection-obstructed/u);
  const endpointMember={id:'member',kind:'page',x:1020,y:600,width:300,height:210,containerId:'target'};
  assert.doesNotThrow(()=>connect(c,[...objects,endpointMember]));
});
