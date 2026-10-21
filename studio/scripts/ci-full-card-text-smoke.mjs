import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveBrowserExecutable} from '../src/server/renderer.mjs';
import {openOwnedBrowser} from '../src/server/production/owned-browser-launch.mjs';
import {fullCardBrowserFixtures} from '../tests/helpers/full-card-browser-fixture-data.mjs';
import {fullChapterBrowserFixtures} from '../tests/helpers/full-chapter-browser-fixture-data.mjs';

export function validateFullChapterTextSmokeAudit(audit){
  const requireValue=value=>{if(!value)throw new Error('Incomplete or regressed real-font chapter proof');};
  requireValue(audit?.fontLoaded===true);
  requireValue(JSON.stringify(Object.keys(audit.results??{}))===JSON.stringify(Object.keys(fullChapterBrowserFixtures)));
  for(const [name,fixture] of Object.entries(fullChapterBrowserFixtures)){
    const actual=audit.results[name];requireValue(Array.isArray(actual)&&actual.length===fixture.frames.length);
    for(const [i,result] of actual.entries()){
      const frame=fixture.frames[i],total=fixture.chapters.at(-1).endFrame;
      requireValue(result.frame===frame&&result.currentId===fixture.chapters.find(c=>frame<c.endFrame).id);
      requireValue(result.labels?.length===4&&result.tracks?.length===4
        &&JSON.stringify(result.fontSizes)===JSON.stringify(Array(4).fill('20px')));
      for(const [j,chapter] of fixture.chapters.entries()){
        const label=result.labels[j],track=result.tracks[j],expectedWidth=(chapter.endFrame-chapter.startFrame)/total*1704;
        requireValue(label.id===chapter.id&&label.text===chapter.label&&label.lines.length>=1&&label.lines.length<=2);
        requireValue(track.id===chapter.id&&Math.abs(track.box.right-track.box.left-expectedWidth)<0.1);
        // CSSStyleDeclaration serializes percentages with rounded decimals;
        // this tolerance is under 0.002 composition pixels on the full track.
        requireValue(Math.abs(result.fillAmounts?.[j]-Math.max(0,Math.min(1,(frame-chapter.startFrame)/(chapter.endFrame-chapter.startFrame))))<1e-6);
      }
      requireValue(result.boundaries?.length===3&&result.boundaries.every((boundary,j)=>boundary.id===fixture.chapters[j+1].id
        &&Math.abs((boundary.box.left+boundary.box.right)/2-(108+fixture.chapters[j+1].startFrame/total*1704))<0.1));
    }
  }
  requireValue(audit.scaled?.labels?.every((label,i)=>label.text===fullChapterBrowserFixtures.chinese40.chapters[i].label));
  const failures={overflow:'text-overflow',collision:'label-overlap',outsideCanvas:'text-overflow',caption:'caption-overlap',
    track:'track-overflow',boundary:'boundary-overflow',hidden:'text-hidden',missing:'missing-navigation'};
  requireValue(JSON.stringify(Object.keys(audit.sentinels??{}))===JSON.stringify(Object.keys(failures)));
  for(const [name,code] of Object.entries(failures))requireValue(audit.sentinels[name].error.includes(`full-chapter-dom-${code}`)
    &&audit.sentinels[name].handlesAfterUnmount===0);
  return true;
}

export async function cleanupFullCardTextSmoke({browser,server,root,removeProof,primaryFailure}){
  const errors=[];
  try{if(browser)await browser.close({silent:true});}catch(error){errors.push(error);}
  try{if(server)await new Promise((yes,no)=>server.close(error=>error?no(error):yes()));}catch(error){errors.push(error);}
  try{if(removeProof)await rm(root,{recursive:true,force:true});}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(primaryFailure?[primaryFailure,...errors]:errors,
    'Card DOM smoke resource cleanup failed',{cause:primaryFailure??errors[0]});
}

export function validateFullCardTextSmokeAudit(audit){
  const requireValue=value=>{if(!value)throw new Error('Incomplete or regressed real-font DOM card proof');};
  requireValue(audit?.fontLoaded===true&&audit.overflowSentinelRejected===true);
  requireValue(audit.scope==='generic-card-only');
  for(const [name,frames] of Object.entries({sameRevealSegment:[100,101],sourceArrival:[23,24]})){
    const lifecycle=audit.guardLifecycle?.[name];
    requireValue(lifecycle?.overflowRejected===true&&lifecycle.handlesAfterUnmount===0
      &&JSON.stringify(lifecycle.frames)===JSON.stringify(frames));
  }
  requireValue(JSON.stringify(Object.keys(audit.results??{}).sort())===JSON.stringify(['long','rows','short']));
  for(const [name,fixture] of Object.entries(fullCardBrowserFixtures)){
    const cards=audit.results[name];requireValue(Array.isArray(cards)&&cards.length===fixture.items.length);
    for(const [i,card] of cards.entries()){
      requireValue(['x','y','width','height'].every(key=>Number.isFinite(card[key])));
      requireValue(card.x>=108&&card.y>=280&&card.width>0&&card.height>0&&card.x+card.width<=1812&&card.y+card.height<=860);
      requireValue(card.text===fixture.items[i].title+fixture.items[i].body);
      const sizes={short:['36px','28px'],long:['40px','32px'],rows:['32px','30px']}[name];
      requireValue(card.titleFontSize===sizes[0]&&card.bodyFontSize===sizes[1]);
      if(name==='short')requireValue(card.x===132+i*433.5&&card.y===408&&card.width===355.5&&card.height===292);
      if(name==='long')requireValue(card.width>355.5&&cards[0].y===cards[1].y&&cards[2].y===cards[3].y&&cards[2].y>cards[0].y);
    }
  }
  return true;
}

// A real local-font DOM check through the production component, not a video
// render and never an Episode input. --keep-proof retains synthetic HTML only.
export async function runFullCardTextSmoke({keepProof=false}={}){
  const browserExecutable=await resolveBrowserExecutable(null);
  if(!browserExecutable)throw new Error('Card DOM smoke requires an installed browser; no download');
  const root=await mkdtemp(join(tmpdir(),'acs-full-card-proof-'));
  const files=new Map();let browser,server,succeeded=false,primaryFailure;
  try{
    const built=await build({entryPoints:[fileURLToPath(new URL('../tests/helpers/full-card-browser-fixture.jsx',import.meta.url))],
      bundle:true,write:false,outdir:root,entryNames:'proof',format:'iife',platform:'browser',loader:{'.woff2':'dataurl'},logLevel:'silent'});
    for(const file of built.outputFiles)files.set(basename(file.path),file.contents);
    files.set('index.html',Buffer.from('<!doctype html><meta charset="utf-8"><title>合成卡片排版验证 · 待确认</title><link rel="stylesheet" href="proof.css"><style>body{margin:0;background:#F0F6F2}nav{position:fixed;z-index:2;bottom:10px;left:12px;display:flex;gap:12px}button{font:16px sans-serif;padding:10px 16px;border:1px solid #17795D;border-radius:8px;background:#F0F6F2;color:#14211D}#content{transform-origin:top left}</style><nav><button onclick="showCardCase(\'short\')">短文案：原布局</button><button onclick="showCardCase(\'long\')">长文案：流程重排</button><button onclick="showCardCase(\'rows\')">长文案：信息行</button></nav><main id="content"></main><script src="proof.js"></script>'));
    for(const [name,bytes] of files)await writeFile(join(root,name),bytes,{flag:'wx'});
    server=createServer((req,res)=>{
      const name=req.url==='/'?'index.html':req.url.slice(1),bytes=files.get(name);
      if(!bytes){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(bytes);
    });
    await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
    browser=await openOwnedBrowser('chrome',{browserExecutable,chromeMode:'chrome-for-testing',logLevel:'error'});
    const page=await browser.newPage({context:()=>Promise.resolve(null),logLevel:'error',indent:false,pageIndex:0,onBrowserLog:null,onLog:()=>{}});
    await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
    await page.goto({url:`http://127.0.0.1:${server.address().port}/`,timeout:30000});
    const audit=await page.evaluate(()=>window.auditCardProof);
    validateFullCardTextSmokeAudit(audit);
    validateFullChapterTextSmokeAudit(audit.chapterNavigation);
    const report={kind:'synthetic-card-and-chapter-real-font-dom-v3',videoRendered:false,visualAcceptance:false,...audit};
    await writeFile(join(root,'report.json'),`${JSON.stringify(report,null,2)}\n`,{flag:'wx'});
    succeeded=true;return {...report,...(keepProof?{proofDirectory:root}:{})};
  }catch(error){primaryFailure=error;throw error;
  }finally{
    await cleanupFullCardTextSmoke({browser,server,root,removeProof:!keepProof||!succeeded,primaryFailure});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).some(arg=>arg!=='--keep-proof')||process.argv.length>3)throw new Error('Only --keep-proof is supported');
  console.log(JSON.stringify(await runFullCardTextSmoke({keepProof:process.argv.includes('--keep-proof')}),null,2));
}
