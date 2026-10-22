import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {access,copyFile,mkdir,mkdtemp,readFile,realpath} from 'node:fs/promises';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {CONCISE_BOARDS,conciseStoryboardState,assertConciseEditorialPlan} from '../src/video/concise-storyboards/plan.mjs';
import {inspectFileIntegrity,integrityHash,isSha256} from '../src/shared/integrity.mjs';
import {captureGlassSources,GLASS_SOURCE_FILES,parseGlassArguments} from './render-glass-card-proof.mjs';
import {auditPngFrame,decodePngPixels} from './ci-png-audit.mjs';
import {auditStoryboardLogo} from './render-illustration-storyboard-proof.mjs';
import {assertSourceBindingUnchanged,createCandidateDirectory,publishFileExclusive,resolveProofOutputRoot,
  withProofBrowser,writeExclusive} from './render-illustration-system-proof.mjs';

const execute=promisify(execFile);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sceneDirectory='studio/src/video/concise-storyboards';
const rasterDirectory='studio/public/assets/visual-system-v1/ai-watermark-v013/frames';
const policyFile='studio/src/shared/screen-editorial-policy.mjs';
export const CONCISE_PROOF=Object.freeze({schemaVersion:'concise-storyboard-proof-v1',width:1920,height:1080,
  fps:30,durationInFrames:3,phases:Object.freeze([0,1,2]),imageFormat:'png',concurrency:1,
  renderTimeoutMs:120000,defaultOutputRoot:'outputs/studio/concise-storyboards'});
export const captureConciseSources=()=>captureGlassSources({sourceFiles:[...GLASS_SOURCE_FILES,
  'studio/scripts/render-concise-storyboard-proof.mjs','studio/scripts/render-illustration-storyboard-proof.mjs',
  'studio/src/video/illustration-storyboards/plan.mjs','studio/src/video/illustration-storyboards/assets-ready.jsx',
  'studio/src/video/glass-card-preview/material.mjs','studio/src/shared/illustration-system-contract.mjs',policyFile],
  sourceDirectories:[sceneDirectory,'studio/src/video/illustration-system',rasterDirectory]});

export function assertConciseComposition(composition,id){
  if(!CONCISE_BOARDS.some(board=>board.compositionId===id))throw new Error('Unknown concise composition');
  for(const [key,value] of Object.entries({id,width:1920,height:1080,fps:30,durationInFrames:3}))
    if(composition?.[key]!==value)throw new Error(`Unexpected concise composition ${key}`);
}
export function buildConciseManifest({source,stills,runtime,generatedAt,gallery}){
  if(!source?.files?.length||!/^[a-f0-9]{40,64}$/u.test(source.gitHead)||integrityHash(source.files)!==source.visualSourceHash)
    throw new Error('Invalid concise source binding');
  const policySources=source.files.filter(file=>file.path===policyFile);
  if(policySources.length!==1||!isSha256(policySources[0].sha256))throw new Error('Missing editorial policy source binding');
  if(!Array.isArray(stills)||stills.length!==9)throw new Error('Exactly nine concise PNGs required');
  const expected=CONCISE_BOARDS.flatMap(board=>CONCISE_PROOF.phases.map(frame=>({board,frame})));
  stills.forEach((still,index)=>{
    const {board,frame}=expected[index];
    if(still.id!==board.id||still.compositionId!==board.compositionId||still.frame!==frame||still.path!==`${board.id}-${frame}.png`
      ||!Number.isSafeInteger(still.bytes)||still.bytes<1||!isSha256(still.sha256)||still.pixels?.width!==1920
      ||still.pixels?.height!==1080||!isSha256(still.pixels?.pixelSha256)||still.watermark?.presencePassed!==true
      ||!Number.isFinite(still.watermark.mintPixels)||!Number.isFinite(still.watermark.minimumMintPixels)
      ||still.watermark.minimumMintPixels<1||still.watermark.mintPixels<still.watermark.minimumMintPixels)
      throw new Error('Invalid concise PNG, composition, phase or logo');
  });
  if(new Set(stills.map(still=>still.sha256)).size!==9)throw new Error('Every concise pose must produce a distinct PNG');
  const editorial=assertConciseEditorialPlan();
  const payload={schemaVersion:CONCISE_PROOF.schemaVersion,generatedAt,status:'static-concise-storyboard-candidate',
    caseData:'authored-synthetic-teaching-case',source,runtime,render:CONCISE_PROOF,storyboardPlan:CONCISE_BOARDS,
    editorial:{...editorial,sourceFile:policyFile,sourceSha256:policySources[0].sha256,frames:CONCISE_BOARDS.map(board=>({id:board.id,
      phases:[0,1,2].map(phase=>({phase,visibleLabels:conciseStoryboardState(board.id,phase).visibleLabels}))}))},
    stills,...(gallery?{gallery}:{}),userAccepted:false,productionApproved:false,finalAccepted:false,videoGenerated:false,
    formalEpisodeStateTouched:false,authorizesPublication:false,
    bindings:{sourceSha256:source.visualSourceHash,planSha256:integrityHash(CONCISE_BOARDS),previewSha256:integrityHash(stills),runtimeSha256:integrityHash(runtime)},
    limits:['Static key poses only; not narration synchronization, motion or visual acceptance.',
      'Density checks cover declared same-source text and object concurrency, not pedagogical correctness.',
      'Order identifiers, times and statuses are authored synthetic teaching data. No live systems queried.']};
  return {...payload,candidateHash:integrityHash(payload)};
}
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function buildConciseGallery(manifest){
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI 直通车 · 精简分镜候选</title><style>
*{box-sizing:border-box}body{margin:0;background:#F2F6F3;color:#14211D;font:17px/1.7 system-ui,sans-serif}main{max-width:1480px;margin:auto;padding:44px 30px 70px}h1{font-size:38px;font-weight:550;margin:0 0 12px}h2{font-size:27px;font-weight:550;margin:0 0 18px}p{max-width:1020px}.intro,figcaption{color:#53685E}nav{display:flex;gap:24px;flex-wrap:wrap;margin:28px 0 48px}a{color:#17795D}article{margin-bottom:58px;scroll-margin-top:24px}.phases{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}button{font:inherit;border:1px solid #5A8A77;background:transparent;color:#365B49;padding:9px 18px;border-radius:10px;cursor:pointer}button[aria-pressed=true]{background:#DDF1E8;color:#14211D;border-color:#17795D}button:focus-visible,a:focus-visible{outline:3px solid #17795D;outline-offset:4px}figure{margin:0}figure[hidden]{display:none}img{display:block;width:100%;height:auto;border:1px solid #CADDD1;border-radius:12px}figcaption{padding:14px 2px;max-width:1100px}figcaption strong{font-weight:550;color:#14211D}details{border-top:1px solid #CADDD1;padding-top:20px}code{font-size:13px;overflow-wrap:anywhere}@media(max-width:640px){main{padding:26px 14px}h1{font-size:28px}h2{font-size:22px}.phases{gap:7px}button{font-size:15px;padding:7px 10px}}</style></head><body><main>
<h1>画面讲关系，解说讲完整逻辑</h1><p class="intro">Zhengjiazhi，这是三组各三拍的静态候选。图片仅保留主题、关键词及状态变化；完整讲解放在图片下方。未生成视频，未改变现有成片、Episode 或旁白。尚未获视觉批准。</p>
<p class="intro">数据边界：订单 317、时间、状态和记忆偏好均为虚构教学案例；没有查询真实业务系统。这里确认画法，不代表真实项目的授权、失败分支、时效管理已全部实现。</p>
<nav>${CONCISE_BOARDS.map((board,index)=>`<a href="#${board.id}">${index+1}. ${escape(board.title)}</a>`).join('')}</nav>
${CONCISE_BOARDS.map((board,index)=>`<article id="${board.id}"><h2>${String(index+1).padStart(2,'0')} / ${escape(board.title)}</h2><div class="phases" role="group" aria-label="${escape(board.title)}的阶段">${board.phases.map((phase,i)=>`<button type="button" aria-pressed="${i===0}" data-phase="${i}" aria-controls="${board.id}-phase-${i}">${i+1}. ${escape(phase.label)}</button>`).join('')}</div>
${board.phases.map((phase,i)=>`<figure id="${board.id}-phase-${i}" data-phase="${i}" ${i?'hidden':''}><a href="${board.id}-${i}.png" target="_blank" rel="noopener"><img src="${board.id}-${i}.png" alt="${escape(board.title)}：${escape(phase.label)}"></a><figcaption><strong>画外讲解：</strong>${escape(phase.explanation)}</figcaption></figure>`).join('')}</article>`).join('')}
<details><summary>来源与专项检查（不等于视觉验收）</summary><p>Git HEAD：<code>${escape(manifest.source.gitHead)}</code><br>视觉源码：<code>${escape(manifest.source.visualSourceHash)}</code><br>编辑规则：<code>${escape(manifest.editorial.version)}</code>。九张图片通过完整 PNG 解码与 Logo 区域存在性检查；该检查不证明 Logo 动画或音画同步。</p><a href="manifest.json">源码、实际屏显文案和 PNG 哈希清单</a></details>
</main><script>document.querySelectorAll('article').forEach(article=>{article.querySelectorAll('button[data-phase]').forEach(button=>{button.addEventListener('click',()=>{article.querySelectorAll('button[data-phase]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));article.querySelectorAll('figure[data-phase]').forEach(f=>{f.hidden=f.dataset.phase!==button.dataset.phase;});});});});</script></body></html>\n`;
}

export async function runConciseProof(options={}){
  const expectedNode=(await readFile(resolve(root,'.node-version'),'utf8')).trim().replace(/^v/u,'');
  if(process.versions.node!==expectedNode)throw new Error(`Expected Node ${expectedNode}`);
  assertConciseEditorialPlan();
  const outputRoot=resolveProofOutputRoot(root,options.outputRoot??CONCISE_PROOF.defaultOutputRoot);
  const browserExecutable=await realpath(process.env.REMOTION_BROWSER_EXECUTABLE??
    (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/chromium'));
  await access(browserExecutable,constants.X_OK);
  const source=await captureConciseSources();
  const [{bundle},renderer]=await Promise.all([import('@remotion/bundler'),import('@remotion/renderer')]);
  const runtime={node:process.version,platform:process.platform,arch:process.arch,browser:{
    version:(await execute(browserExecutable,['--version'])).stdout.trim(),...await inspectFileIntegrity(browserExecutable)},browserLogs:[]};
  const directory=await createCandidateDirectory(root,outputRoot);
  const scratch=await mkdtemp(resolve(directory,'.render-work-'));
  process.stdout.write(`Concise static candidate: ${directory}\n`);
  try{
    const publicDir=resolve(scratch,'public');await mkdir(publicDir);
    for(const file of source.files.filter(({path})=>path.startsWith(`${rasterDirectory}/`))){
      const destination=resolve(publicDir,relative('studio/public',file.path));await mkdir(dirname(destination),{recursive:true});
      await copyFile(resolve(root,file.path),destination,constants.COPYFILE_EXCL);
    }
    const serveUrl=await bundle({entryPoint:resolve(root,sceneDirectory,'index.jsx'),publicDir,outDir:resolve(scratch,'bundle'),enableCaching:false});
    const stills=await withProofBrowser(renderer,browserExecutable,async puppeteerInstance=>{
      const evidence=[];
      for(const board of CONCISE_BOARDS){
        const composition=await renderer.selectComposition({serveUrl,id:board.compositionId,puppeteerInstance,timeoutInMilliseconds:CONCISE_PROOF.renderTimeoutMs,logLevel:'warn'});
        assertConciseComposition(composition,board.compositionId);
        for(const frame of CONCISE_PROOF.phases){
          const name=`${board.id}-${frame}.png`,output=resolve(scratch,name);
          await renderer.renderStill({serveUrl,composition,output,frame,imageFormat:'png',puppeteerInstance,
            timeoutInMilliseconds:CONCISE_PROOF.renderTimeoutMs,overwrite:false,logLevel:'warn',
            onBrowserLog:event=>runtime.browserLogs.push({type:event.type,text:event.text})});
          const png=await readFile(output),pixels=auditPngFrame(png,{expectedWidth:1920,expectedHeight:1080}),watermark=auditStoryboardLogo(decodePngPixels(png));
          await publishFileExclusive(output,resolve(directory,name));
          evidence.push({id:board.id,compositionId:board.compositionId,frame,path:name,...await inspectFileIntegrity(resolve(directory,name)),pixels,watermark});
          process.stdout.write(`${name}: PNG decoded, Logo present (${watermark.mintPixels} pixels)\n`);
        }
      }return evidence;
    });
    assertSourceBindingUnchanged(source,await captureConciseSources());
    if((await inspectFileIntegrity(browserExecutable)).sha256!==runtime.browser.sha256)throw new Error('Browser changed during render');
    const input={source,stills,runtime,generatedAt:new Date().toISOString()};
    const galleryPath=resolve(directory,'index.html');await writeExclusive(galleryPath,buildConciseGallery(buildConciseManifest(input)));
    const manifest=buildConciseManifest({...input,gallery:{path:'index.html',...await inspectFileIntegrity(galleryPath)}});
    await writeExclusive(resolve(directory,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
    process.stdout.write(`Nine concise PNGs ready: ${galleryPath}\n`);return {directory,manifest};
  }catch(error){
    await writeExclusive(resolve(directory,'failure.json'),`${JSON.stringify({source,runtime,status:'incomplete-static-candidate',userAccepted:false,error:String(error?.stack??error)},null,2)}\n`);
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const options=parseGlassArguments(process.argv.slice(2));
    if(options.help)process.stdout.write('Usage: node scripts/render-concise-storyboard-proof.mjs [--output-root outputs/path]\nNine static PNGs only; no video or approval.\n');
    else await runConciseProof(options);
  }catch(error){process.stderr.write(`${error?.stack??error}\n`);process.exitCode=1;}
}
