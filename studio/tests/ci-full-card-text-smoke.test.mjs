import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,access,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cleanupFullCardTextSmoke,validateFullCardTextSmokeAudit,validateFullChapterTextSmokeAudit} from '../scripts/ci-full-card-text-smoke.mjs';
import {fullChapterBrowserFixtures} from './helpers/full-chapter-browser-fixture-data.mjs';

const chapters=['读取资料','核对范围','更新记录','返回结果'];
const longBody='这里使用完整的中文说明验证卡片能够承载较长内容，流程仍按顺序连接，文字不会被截断，也不会靠缩小字号来勉强放入。';
function fixture(){
  return {scope:'generic-card-only',fontLoaded:true,overflowSentinelRejected:true,
    guardLifecycle:{sameRevealSegment:{frames:[100,101],overflowRejected:true,handlesAfterUnmount:0},
      sourceArrival:{frames:[23,24],overflowRejected:true,handlesAfterUnmount:0}},results:{
    short:chapters.map((title,i)=>({text:`${title}合成案例，保留已确认样式`,x:132+i*433.5,y:408,width:355.5,height:292,titleFontSize:'36px',bodyFontSize:'28px'})),
    long:chapters.map((title,i)=>({text:`${title}并确认当前任务适用范围与来源${longBody}`,x:132+(i===1||i===2?867:0),y:i<2?280:590,width:789,height:270,titleFontSize:'40px',bodyFontSize:'32px'})),
    rows:chapters.map((title,i)=>({text:`${title}并确认当前任务适用范围与来源${longBody}`,x:152,y:336+i*133,width:1616,height:115,titleFontSize:'32px',bodyFontSize:'30px'})),
  }};
}

test('card DOM smoke attests actual loaded font, preserved short baseline and unabridged long text',()=>{
  assert.equal(validateFullCardTextSmokeAudit(fixture()),true);
  for(const mutate of [audit=>audit.fontLoaded=false,audit=>audit.overflowSentinelRejected=false,
    audit=>delete audit.guardLifecycle,audit=>audit.guardLifecycle.sourceArrival.overflowRejected=false,
    audit=>audit.guardLifecycle.sameRevealSegment.handlesAfterUnmount=1,
    audit=>audit.guardLifecycle.sourceArrival.frames=[22,23],audit=>audit.scope='full-film',
    audit=>audit.results.short[0].width++,audit=>audit.results.short[0].bodyFontSize='27px',
    audit=>audit.results.long[0].text=audit.results.long[0].text.slice(0,-1),
    audit=>audit.results.long[0].titleFontSize='32px',audit=>audit.results.long.pop(),
    audit=>audit.results.rows[3].y=900,audit=>audit.results.short[0].x=NaN]){
    const audit=fixture();mutate(audit);assert.throws(()=>validateFullCardTextSmokeAudit(audit));
  }
});

test('production root binds the real card guard to every frame, not only reveal count',async()=>{
  const source=await readFile(new URL('../src/video/explainer-full-revision/root.jsx',import.meta.url),'utf8');
  assert.match(source,/<FullTextFitGuard key=\{`\$\{scene\.id\}:\$\{frame\}`\} frame=\{frame\} contentRef=\{contentRef\}/u);
});

test('chapter report validation requires complete text, actual-time tracks, boundary frames and every negative guard',()=>{
  const report={fontLoaded:true,results:{},sentinels:{},scaled:{labels:fullChapterBrowserFixtures.chinese40.chapters.map(c=>({text:c.label}))}};
  for(const [name,fixture] of Object.entries(fullChapterBrowserFixtures)){
    const total=fixture.chapters.at(-1).endFrame;
    report.results[name]=fixture.frames.map(frame=>({frame,currentId:fixture.chapters.find(c=>frame<c.endFrame).id,
      fontSizes:Array(4).fill('20px'),labels:fixture.chapters.map(c=>({id:c.id,text:c.label,lines:[{}]})),
      tracks:fixture.chapters.map(c=>({id:c.id,box:{left:0,right:(c.endFrame-c.startFrame)/total*1704}})),
      boundaries:fixture.chapters.slice(1).map(c=>({id:c.id,box:{left:108+c.startFrame/total*1704-0.5,right:108+c.startFrame/total*1704+0.5}})),
      fillAmounts:fixture.chapters.map(c=>Math.max(0,Math.min(1,(frame-c.startFrame)/(c.endFrame-c.startFrame))))}));
  }
  for(const [name,code] of Object.entries({overflow:'text-overflow',collision:'label-overlap',outsideCanvas:'text-overflow',caption:'caption-overlap',
    track:'track-overflow',boundary:'boundary-overflow',hidden:'text-hidden',missing:'missing-navigation'}))report.sentinels[name]={error:`full-chapter-dom-${code}`,handlesAfterUnmount:0};
  assert.equal(validateFullChapterTextSmokeAudit(report),true);
  for(const mutate of [r=>r.fontLoaded=false,r=>delete r.results.tiny,r=>r.results.unequal.pop(),r=>r.results.tiny[0].frame++,
    r=>r.results.tiny[0].currentId='practice',r=>r.results.chinese40[0].labels[0].text='省略',r=>r.results.english40[0].fontSizes[0]='12px',
    r=>r.results.unequal[0].tracks[0].box.right++,r=>r.results.typical[1].fillAmounts[0]=0,r=>delete r.sentinels.caption,
    r=>r.sentinels.collision.error='success',r=>r.sentinels.overflow.handlesAfterUnmount=1,r=>r.scaled.labels[0].text='省略',
    r=>r.results.unequal[0].boundaries[0].box.left++,r=>delete r.sentinels.boundary]){
    const invalid=structuredClone(report);mutate(invalid);assert.throws(()=>validateFullChapterTextSmokeAudit(invalid));
  }
});

test('card smoke cleanup still closes the server and removes proof after browser close rejects',async t=>{
  const root=await mkdtemp(join(tmpdir(),'acs-card-cleanup-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const browserFailure=new Error('synthetic browser close failure');let serverClosed=false;
  await assert.rejects(cleanupFullCardTextSmoke({root,removeProof:true,
    browser:{close:async()=>{throw browserFailure;}},
    server:{close:done=>{serverClosed=true;done();}}
  }));
  assert.equal(serverClosed,true);
  await assert.rejects(access(root),error=>error.code==='ENOENT');
});

test('card smoke cleanup still removes proof when server close fails and preserves both errors',async t=>{
  const root=await mkdtemp(join(tmpdir(),'acs-card-cleanup-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const browserFailure=new Error('browser'),serverFailure=new Error('server');
  await assert.rejects(cleanupFullCardTextSmoke({root,removeProof:true,
    browser:{close:async()=>{throw browserFailure;}},server:{close:done=>done(serverFailure)}
  }),error=>error instanceof AggregateError&&error.errors[0]===browserFailure&&error.errors[1]===serverFailure);
  await assert.rejects(access(root),error=>error.code==='ENOENT');
});

test('card smoke cleanup preserves the primary assertion error as the aggregate cause',async t=>{
  const root=await mkdtemp(join(tmpdir(),'acs-card-cleanup-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const primaryFailure=new Error('original DOM proof failure'),closeFailure=new Error('close failure');
  await assert.rejects(cleanupFullCardTextSmoke({root,removeProof:true,primaryFailure,
    browser:{close:async()=>{throw closeFailure;}},server:{close:done=>done()}
  }),error=>error instanceof AggregateError&&error.cause===primaryFailure
    &&error.errors[0]===primaryFailure&&error.errors[1]===closeFailure);
  await assert.rejects(access(root),error=>error.code==='ENOENT');
});

test('explicit keep-proof preserves successful synthetic output while still closing resources',async t=>{
  const root=await mkdtemp(join(tmpdir(),'acs-card-cleanup-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const closed=[];
  await cleanupFullCardTextSmoke({root,removeProof:false,
    browser:{close:async()=>closed.push('browser')},server:{close:done=>{closed.push('server');done();}}
  });
  assert.deepEqual(closed,['browser','server']);await access(root);
});
