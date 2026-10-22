// PRIVATE complete review: independent contract, immutable source snapshot, resumable
// silent chunks, one continuous PCM mux. Never touches an Episode or human Gate.
import {createHash,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,readdir,realpath,stat} from 'node:fs/promises';
import {resolve,relative,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createCapabilityAuthority,requireSideEffectGrant} from '../src/server/security/side-effect-capability.mjs';
import {acquireLongReviewRenderJobLock} from '../src/server/production/long-render-job.mjs';
import {openOwnedBrowser} from '../src/server/production/owned-browser-launch.mjs';
import {assertFullReviewMedia,validateFullReviewCheckpoint,fullReviewConcatList} from '../src/server/production/editorial-full-review-runtime.mjs';
import {inspectInstalledDependencies,assertInstalledDependencies} from '../src/server/production/installed-dependency-integrity.mjs';
import {preflightFullRevisionText} from '../src/video/explainer-full-revision/model.mjs';
import {validateExplainerFullRevisionPlan,buildExplainerFullRevisionTiming,validateExplainerFullRevisionPcm,
  validateExplainerFullRevisionInput,validateExplainerFullRevisionRequest,buildExplainerFullRevisionChunks,
  validateExplainerFullRevisionManifest,parseExplainerFullRevisionArguments,explainerFullRevisionSafePath as safePath,
  explainerFullRevisionNeed as need} from '../src/shared/explainer-full-revision.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const ENTRY='studio/src/video/explainer-full-revision/index.jsx';
const SCRIPT='studio/scripts/render-explainer-full-revision.mjs';
const FONT='studio/node_modules/@fontsource-variable/noto-sans-sc';
const LOGO='studio/public/assets/visual-system-v1/ai-watermark-v013';
const OP='review:render-explainer-full-revision';
const SCOPES=['filesystem.write.explainer-full-revision','process.spawn.explainer-full-revision'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>`${JSON.stringify(value,null,2)}\n`;
const digest=value=>sha(json(value));
const metadata=({path,bytes,sha256})=>({path,bytes,sha256});

export function explainerFullRevisionCapabilitySpec(value) {
  return {episodeId:`explainer-full-revision/${digest(validateExplainerFullRevisionRequest(value))}`,
    operation:OP,scopes:[...SCOPES],maxCalls:0,maxCostUsd:0};
}
function grantFor(request,options) {
  need(options&&typeof options==='object'&&!Array.isArray(options)&&[Object.prototype,null].includes(Object.getPrototypeOf(options)));
  for(const key of Reflect.ownKeys(options)){
    const d=Object.getOwnPropertyDescriptor(options,key);need(key==='sideEffectGrant'&&d.enumerable&&Object.hasOwn(d,'value'));
  }
  const grant=requireSideEffectGrant(options,explainerFullRevisionCapabilitySpec(request),OP);
  need(grant.maxCalls===0&&grant.maxCostUsd===0&&digest([...grant.scopes].sort())===digest([...SCOPES].sort()),
    'explainer_full_revision_capability_scope_invalid');return grant;
}
async function regular(root,path,{font=false,maxBytes=1024*1024*1024}={}) {
  need(safePath(path),'explainer_full_revision_path_unsafe');const target=resolve(root,path),actual=await realpath(target),info=await lstat(target);
  need(info.isFile()&&!info.isSymbolicLink()&&(actual===target||font&&path.startsWith(`${FONT}/`)),'explainer_full_revision_path_unsafe');
  need(info.size>0&&info.size<=maxBytes,'explainer_full_revision_file_size');const bytes=await readFile(actual);
  need(bytes.length===info.size&&await realpath(target)===actual,'explainer_full_revision_input_changed');
  return {path,bytes:bytes.length,sha256:sha(bytes),content:bytes};
}
async function tree(root,path,{font=false}={}) {
  const found=[];
  async function walk(local){const full=resolve(root,local),actual=await realpath(full),s=await lstat(full);
    need(actual===full||font&&local.startsWith(FONT),'explainer_full_revision_path_unsafe');
    if(s.isDirectory()||font&&local===FONT&&s.isSymbolicLink()){
      for(const name of (await readdir(full)).sort())await walk(`${local}/${name}`);
    }else{need(s.isFile()&&!s.isSymbolicLink(),'explainer_full_revision_path_unsafe');found.push(await regular(root,local,{font}));}}
  await walk(path);return found;
}
async function executable(candidates) {
  for(const candidate of candidates)try{const path=await realpath(candidate),s=await stat(path);if(!s.isFile()||!(s.mode&0o111))continue;
    const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};
  }catch{/* Installed binaries only; never download. */}
  need(false,'explainer_full_revision_runtime_missing');
}
async function implementation(root) {
  const {build}=await import('esbuild'),sources=new Map();
  for(const [seed,platform] of [[SCRIPT,'node'],[ENTRY,'browser']]){
    const result=await build({absWorkingDir:root,entryPoints:[resolve(root,seed)],bundle:true,write:false,metafile:true,packages:'external',
      platform,format:'esm',outdir:resolve(root,'outputs/unused-full-revision-inspection'),logLevel:'silent',plugins:[{
        name:'read-only-full-revision-closure',setup(builder){builder.onLoad({filter:/.*/},async({path})=>{
          const local=relative(root,path).replaceAll('\\','/');need(local.startsWith('studio/src/')||local.startsWith('studio/scripts/'));
          const file=await regular(root,local);need(!sources.has(local)||sources.get(local).sha256===file.sha256);sources.set(local,file);
          const loader={'.mjs':'js','.js':'js','.jsx':'jsx','.css':'css','.json':'json'}[extname(path)];need(loader);
          return {contents:file.content,loader,resolveDir:dirname(path)};
        });}}]});need(result.warnings.length===0,'explainer_full_revision_closure_incomplete');
  }
  for(const path of ['.node-version','studio/package.json','studio/pnpm-lock.yaml','studio/pnpm-workspace.yaml'])sources.set(path,await regular(root,path));
  for(const file of [...await tree(root,FONT,{font:true}),...await tree(root,LOGO)])sources.set(file.path,file);
  return [...sources.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
async function run(executablePath,args,guard) {
  guard();return new Promise((accept,reject)=>{
    const child=spawn(executablePath,args,{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,LANG:'C',LC_ALL:'C'}});
    let stdout='',stderr='',failure=null;
    const stop=code=>{failure??=Object.assign(new Error('Private full review local process failed'),{code});child.kill('SIGKILL');};
    const heartbeat=setInterval(()=>{try{guard();}catch(e){failure=e;child.kill('SIGKILL');}},1000);
    const timer=setTimeout(()=>stop('explainer_full_revision_process_timeout'),20*60*1000);
    child.stdout.on('data',x=>{stdout+=x;if(stdout.length>2*1024*1024)stop('explainer_full_revision_process_output_limit');});
    child.stderr.on('data',x=>{stderr+=x;if(stderr.length>2*1024*1024)stop('explainer_full_revision_process_output_limit');});
    const clear=()=>{clearInterval(heartbeat);clearTimeout(timer);};
    child.once('error',e=>{clear();reject(e);});child.once('close',code=>{clear();
      if(failure)return reject(failure);if(code!==0)return reject(Object.assign(new Error('Private full review local process failed'),{code:'explainer_full_revision_process_failed'}));
      try{guard();accept(stdout);}catch(e){reject(e);}});
  });
}
async function inspect(inputValue) {
  const input=validateExplainerFullRevisionInput(inputValue),root=await realpath(ROOT);
  const planFile=await regular(root,input.planPath,{maxBytes:1024*1024}),voiceFile=await regular(root,input.voiceResultPath,{maxBytes:4*1024*1024});
  const plan=validateExplainerFullRevisionPlan(JSON.parse(planFile.content)),voice=JSON.parse(voiceFile.content);
  preflightFullRevisionText(plan);
  const timing=buildExplainerFullRevisionTiming(plan,voice),audio=await regular(root,`${dirname(input.voiceResultPath)}/${voice.voice.file}`,{maxBytes:43200044});
  validateExplainerFullRevisionPcm(audio.content,voice);const files=await implementation(root);
  const runtime={node:await executable([process.execPath]),browser:await executable([
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome','/usr/bin/chromium']),ffmpeg:await executable(['/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg','/usr/bin/ffmpeg']),
    ffprobe:await executable(['/opt/homebrew/bin/ffprobe','/usr/local/bin/ffprobe','/usr/bin/ffprobe']),git:await executable(['/usr/bin/git'])};
  need(process.version==='v24.19.0','explainer_full_revision_node_version');
  const gitHead=(await run(runtime.git.path,['-C',root,'rev-parse','HEAD'],()=>{})).trim();need(/^[a-f0-9]{40}$/u.test(gitHead));
  const inputProps={plan,timing,captions:timing.segments.map(s=>({id:s.id,text:s.text,startMs:s.startSample/24,endMs:s.endSample/24,timestampMs:null,confidence:null}))};
  const sourceFiles=[planFile,voiceFile,audio].map(metadata),sourceHash=digest(sourceFiles),implementationFiles=files.map(metadata);
  const dependencies=await inspectInstalledDependencies(resolve(root,'studio'));
  const implementationHash=digest({files:implementationFiles,runtime,dependencies});
  const summary={schemaVersion:'explainer-full-revision-preview-v1',gitHead,sourceHash,implementationHash,sourceFiles,implementationFiles,runtime,dependencies,
    inputProps,chunks:buildExplainerFullRevisionChunks(timing.durationInFrames),durationInFrames:timing.durationInFrames,durationSeconds:timing.durationInFrames/30,
    formalRender:false,visualAcceptance:false,episodeMutated:false,releaseEligible:false,externalApiCalls:0,maximumPaidCostUsd:0};
  return {root,input,files,planFile,voiceFile,audio,summary,snapshotHash:digest(summary)};
}
export async function previewExplainerFullRevision(input) {
  need(arguments.length===1);const value=await inspect(input);return {...value.summary,snapshotHash:value.snapshotHash};
}
async function unchanged(value,{checkDependencies=true}={}) {
  // Full installed-byte checks are mandatory before publishing a resumable
  // checkpoint. Only the redundant start-of-chunk check may use the cheap path.
  if(checkDependencies)await assertInstalledDependencies(resolve(value.root,'studio'),value.summary.dependencies);
  need((await run(value.summary.runtime.git.path,['-C',value.root,'rev-parse','HEAD'],()=>{})).trim()===value.summary.gitHead,'explainer_full_revision_git_head_changed');
  for(const expected of [...value.summary.sourceFiles,...value.summary.implementationFiles]){
    const current=await regular(value.root,expected.path,{font:expected.path.startsWith(`${FONT}/`)});
    need(current.sha256===expected.sha256&&current.bytes===expected.bytes,'explainer_full_revision_source_changed');
  }
  for(const expected of Object.values(value.summary.runtime)){
    need(await realpath(expected.path)===expected.path);const bytes=await readFile(expected.path);
    need(bytes.length===expected.bytes&&sha(bytes)===expected.sha256,'explainer_full_revision_runtime_changed');
  }
}
async function assertDirectory(root,path) {
  const target=resolve(root,path);need(target===root||target.startsWith(`${root}/`));let cursor=root;
  for(const part of relative(root,target).split('/').filter(Boolean)){
    cursor=resolve(cursor,part);const s=await lstat(cursor).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(s)need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(cursor)===cursor,'explainer_full_revision_output_path_unsafe');
  }
}
async function exists(root,path) {
  try{await regular(root,path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
}
async function serve(resources,guard) {
  const data=new Map(resources.map(f=>[f.path,Buffer.from(f.content)]));
  const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
  guard();const server=createServer((req,res)=>{try{
    const path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname).slice(1)||'index.html',bytes=data.get(path);need(bytes);
    res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'"});res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found');}});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(yes=>server.close(yes))};
}
export async function renderExplainerFullRevision(rawRequest,options={}) {
  need(arguments.length<=2);const request=validateExplainerFullRevisionRequest(rawRequest),sideEffectGrant=grantFor(request,options);
  const checkedOptions=Object.freeze({sideEffectGrant}),grant=()=>grantFor(request,checkedOptions);
  const value=await inspect({planPath:request.planPath,voiceResultPath:request.voiceResultPath});
  need(value.snapshotHash===request.snapshotHash&&value.summary.sourceHash===request.sourceHash&&value.summary.implementationHash===request.implementationHash,
    'explainer_full_revision_preview_changed');
  const requestHash=digest(request),directory=`outputs/studio/explainer-full-revision/${requestHash}`,destination=resolve(value.root,directory);
  await unchanged(value);grant();await assertDirectory(value.root,directory);await mkdir(destination,{recursive:true});await assertDirectory(value.root,directory);
  grant();const lock=await acquireLongReviewRenderJobLock(destination,{jobId:requestHash});
  let browser=null,server=null,cancelRender=null,interrupted=false;
  const interrupt=()=>{interrupted=true;cancelRender?.();};process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  const guard=()=>{need(!interrupted,'explainer_full_revision_interrupted');grant();lock.assertOwned();};
  const write=async(path,bytes)=>{need(safePath(path));guard();await assertDirectory(destination,dirname(path));
    await mkdir(dirname(resolve(destination,path)),{recursive:true});await assertDirectory(destination,dirname(path));guard();
    await writeFile(resolve(destination,path),bytes,{flag:'wx'});};
  const record=async path=>metadata(await regular(destination,path));
  const preserve=async(path,bytes,readOnly=false)=>{
    if(await exists(destination,path))need((await regular(destination,path)).content.equals(Buffer.from(bytes)),'explainer_full_revision_resume_input_changed');
    else{need(!readOnly,'explainer_full_revision_resume_input_missing');await write(path,bytes);}
  };
  const probe=async path=>JSON.parse(await run(value.summary.runtime.ffprobe.path,['-v','error','-count_frames','-show_streams','-show_format',
    '-show_data_hash','sha256','-of','json',resolve(destination,path)],guard));
  const decode=async path=>run(value.summary.runtime.ffmpeg.path,['-hide_banner','-loglevel','error','-xerror','-nostdin','-i',
    resolve(destination,path),'-map','0','-f','null','-'],guard);
  const result=manifest=>({status:'private_full_review_candidate',directory,manifestPath:`${directory}/review-manifest.json`,
    manifestSha256:sha(json(manifest)),videoPath:`${directory}/${manifest.video.path}`,durationSeconds:value.summary.durationInFrames/30,
    durationInFrames:value.summary.durationInFrames,formalRender:false,visualAcceptance:false,episodeMutated:false,releaseEligible:false,paidCalls:0});
  try {
    const completeExists=await exists(destination,'review-manifest.json');
    const base=[['request.json',json(request)],['source-manifest.json',json(value.summary)],['input-props.json',json(value.summary.inputProps)],
      ['plan.json',value.planFile.content],['voice-result.json',value.voiceFile.content],['full-narration.wav',value.audio.content]];
    for(const file of value.files)base.push([file.path.startsWith('studio/public/')?`public/${file.path.slice(14)}`:`snapshot/${file.path}`,file.content]);
    for(const [path,bytes] of base)await preserve(path,bytes,completeExists);
    const assertBase=async()=>{for(const [path,bytes] of base)await preserve(path,bytes,true);};
    const assertChunks=async chunks=>{for(const c of chunks){
      need(digest(await record(c.file.path))===digest(c.file),'explainer_full_revision_resume_media_changed');
      need(digest(JSON.parse((await regular(destination,`${c.segment.id}.json`)).content))===digest(c),'explainer_full_revision_checkpoint_changed');
    }};
    if(completeExists){
      const manifest=validateExplainerFullRevisionManifest(JSON.parse((await regular(destination,'review-manifest.json')).content),value.summary,request);
      for(const file of manifest.files)need(digest(await record(file.path))===digest(file),'explainer_full_revision_output_changed');
      await assertChunks(manifest.chunks);
      for(const c of manifest.chunks){assertFullReviewMedia(await probe(c.file.path),c.segment.frameCount,{signature:c.signature});await decode(c.file.path);}
      assertFullReviewMedia(await probe(manifest.video.path),value.summary.durationInFrames,{audio:true});await decode(manifest.video.path);
      await assertBase();await assertChunks(manifest.chunks);await unchanged(value);guard();return result(manifest);
    }
    let bundleRecord;
    if(await exists(destination,'bundle-manifest.json')){
      bundleRecord=JSON.parse((await regular(destination,'bundle-manifest.json')).content);
      need(bundleRecord.requestHash===requestHash&&/^bundle-[a-f0-9-]{36}$/u.test(bundleRecord.directory)
        &&Array.isArray(bundleRecord.files)&&bundleRecord.files.length>0&&bundleRecord.files.length<=2000);
      for(const file of bundleRecord.files){need(safePath(file.path)&&file.path.startsWith(`${bundleRecord.directory}/`));
        need(digest(await record(file.path))===digest(file),'explainer_full_revision_bundle_changed');}
    }else{
      guard();const {bundle}=await import('@remotion/bundler'),snapshot=resolve(destination,'snapshot'),bundleName=`bundle-${lock.token}`;
      await bundle({entryPoint:resolve(snapshot,ENTRY),rootDir:resolve(snapshot,'studio'),outDir:resolve(destination,bundleName),
        publicDir:resolve(destination,'public'),symlinkPublicDir:false,enableCaching:false,gitSource:null,onProgress:()=>undefined,
        webpackOverride:config=>({...config,devtool:false,resolve:{...config.resolve,
          modules:[resolve(value.root,'studio/node_modules'),...(config.resolve?.modules??['node_modules'])],
          alias:{...config.resolve?.alias,'@fontsource-variable/noto-sans-sc':resolve(snapshot,FONT)}}})});
      await unchanged(value);guard();bundleRecord={requestHash,directory:bundleName,files:(await tree(destination,bundleName)).map(metadata)};
      await write('bundle-manifest.json',json(bundleRecord));
    }
    const chunks=[];let signature=null,shared=null,composition=null;
    for(const segment of value.summary.chunks){
      await unchanged(value,{checkDependencies:false});guard();const metadataName=`${segment.id}.json`;
      if(await exists(destination,metadataName)){
        const checkpoint=validateFullReviewCheckpoint(JSON.parse((await regular(destination,metadataName)).content),segment,requestHash);
        need(digest(await record(checkpoint.file.path))===digest(checkpoint.file),'explainer_full_revision_resume_media_changed');
        const current=assertFullReviewMedia(await probe(checkpoint.file.path),segment.frameCount,{signature:signature??checkpoint.signature});
        need(digest(current)===digest(checkpoint.signature));await decode(checkpoint.file.path);signature??=current;
        chunks.push(checkpoint);process.stderr.write(`${segment.id}: reused verified segment\n`);continue;
      }
      if(!browser){
        await unchanged(value);guard();
        const resources=[];for(const expected of bundleRecord.files){const file=await regular(destination,expected.path);
          need(digest(metadata(file))===digest(expected),'explainer_full_revision_bundle_changed');resources.push({...file,path:file.path.slice(bundleRecord.directory.length+1)});}
        server=await serve(resources,guard);guard();const {selectComposition}=await import('@remotion/renderer');
        browser=await openOwnedBrowser('chrome',{browserExecutable:value.summary.runtime.browser.path,logLevel:'error'},guard);
        shared={serveUrl:server.url,inputProps:value.summary.inputProps,puppeteerInstance:browser,logLevel:'error',
          onBrowserDownload:()=>{throw new Error('Download forbidden');}};
        composition=await selectComposition({...shared,id:'ExplainerFullRevision'});
        need(composition.fps===30&&composition.width===1920&&composition.height===1080&&composition.durationInFrames===value.summary.durationInFrames,
          'explainer_full_revision_composition_changed');
      }
      const token=lock.token,part=`${segment.id}.attempt-${token}.part.mp4`,video=`${segment.id}.${token}.mp4`,metadataPart=`${segment.id}.attempt-${token}.part.json`;
      const {renderMedia,makeCancelSignal}=await import('@remotion/renderer'),cancel=makeCancelSignal();cancelRender=cancel.cancel;
      let last=-1,grantFailure=null;
      await renderMedia({...shared,composition,outputLocation:resolve(destination,part),codec:'h264',pixelFormat:'yuv420p',imageFormat:'png',
        concurrency:1,crf:18,muted:true,overwrite:false,frameRange:[segment.fromFrame,segment.toFrameExclusive-1],cancelSignal:cancel.cancelSignal,
        onProgress:({progress})=>{try{guard();}catch(e){grantFailure=e;cancel.cancel();}const next=Math.floor(progress*4);
          if(next>last){last=next;process.stderr.write(`${segment.id}: ${Math.min(100,next*25)}%\n`);}}});
      cancelRender=null;if(grantFailure)throw grantFailure;
      const current=assertFullReviewMedia(await probe(part),segment.frameCount,{signature});await decode(part);signature??=current;
      await unchanged(value);guard();const checkpoint={schemaVersion:'editorial-full-review-segment-v1',requestHash,segment,
        file:{...await record(part),path:video},signature:current,fullDecodePassed:true};
      await write(metadataPart,json(checkpoint));guard();await lock.publishAttemptPair({attemptToken:token,videoPartPath:resolve(destination,part),
        videoPath:resolve(destination,video),metadataPartPath:resolve(destination,metadataPart),metadataPath:resolve(destination,metadataName)});
      chunks.push(checkpoint);process.stderr.write(`${segment.id}: verified and checkpointed\n`);
    }
    if(browser){await browser.close({silent:true});browser=null;}if(server){await server.close();server=null;}
    await unchanged(value);await assertChunks(chunks);await assertBase();guard();
    const token=lock.token,concat=`concat-${token}.txt`,silent=`full-silent-${token}.mp4`,part=`full-review.attempt-${token}.part.mp4`,video=`full-review.${token}.mp4`;
    await write(concat,fullReviewConcatList(chunks.map(c=>c.file.path)));
    const concatArgs=['-hide_banner','-loglevel','error','-nostdin','-n','-f','concat','-safe','1','-i',resolve(destination,concat),'-map','0:v:0','-c:v','copy','-an',resolve(destination,silent)];
    await run(value.summary.runtime.ffmpeg.path,concatArgs,guard);assertFullReviewMedia(await probe(silent),value.summary.durationInFrames,{signature});await decode(silent);
    const silentRecord=await record(silent);await assertChunks(chunks);await assertBase();
    const muxArgs=['-hide_banner','-loglevel','error','-nostdin','-n','-i',resolve(destination,silent),'-i',resolve(destination,'full-narration.wav'),
      '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',resolve(destination,part)];
    await run(value.summary.runtime.ffmpeg.path,muxArgs,guard);const info=await probe(part);
    assertFullReviewMedia(info,value.summary.durationInFrames,{audio:true,signature});await decode(part);
    await unchanged(value);await assertChunks(chunks);await assertBase();need(digest(await record(silent))===digest(silentRecord),'explainer_full_revision_assembly_changed');
    const videoRecord={...await record(part),path:video},evidence=`assembly-${token}.json`;
    await write(evidence,json({requestHash,concatArgs,muxArgs,aacEncodesForThisDeliveredAttempt:1,sourceAudioSha256:value.audio.sha256,
      targetSamples:value.summary.durationInFrames*800,interiorPaddingSamples:0,resynthesized:false,timeStretched:false,fullDecodePassed:true,probe:info}));
    const files=[videoRecord,...bundleRecord.files];
    for(const name of [...base.map(([name])=>name),'bundle-manifest.json',concat,silent,evidence,...chunks.flatMap(c=>[c.file.path,`${c.segment.id}.json`])])files.push(await record(name));
    const manifest={schemaVersion:'explainer-full-revision-candidate-v1',request,sourceHash:request.sourceHash,implementationHash:request.implementationHash,
      snapshotHash:request.snapshotHash,gitHead:value.summary.gitHead,sourceFiles:value.summary.sourceFiles,implementationFiles:value.summary.implementationFiles,
      runtime:value.summary.runtime,durationInFrames:value.summary.durationInFrames,fps:30,width:1920,height:1080,
      inputPropsSha256:sha(json(value.summary.inputProps)),video:videoRecord,chunks,files,
      audio:{sourceAudioSha256:value.audio.sha256,sampleCount:value.summary.durationInFrames*800,aacEncodesForThisDeliveredAttempt:1,assemblyEvidencePath:evidence},
      fullDecodePassed:true,formalRender:false,visualAcceptance:false,continuousHumanReview:false,episodeMutated:false,releaseEligible:false,paidCalls:0,maximumPaidCostUsd:0,
      assurance:'private complete revision; machine decode does not replace visual QA or continuous listening/viewing'};
    validateExplainerFullRevisionManifest(manifest,value.summary,request);const manifestPart=`review-manifest.attempt-${token}.part.json`;
    await write(manifestPart,json(manifest));await unchanged(value);await assertChunks(chunks);await assertBase();
    for(const file of files)need(digest({...await record(file.path===video?part:file.path),path:file.path})===digest(file),'explainer_full_revision_output_changed');
    guard();await lock.publishAttemptPair({attemptToken:token,videoPartPath:resolve(destination,part),videoPath:resolve(destination,video),
      metadataPartPath:resolve(destination,manifestPart),metadataPath:resolve(destination,'review-manifest.json')});return result(manifest);
  }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
    if(browser)await browser.close({silent:true}).catch(()=>{});if(server)await server.close().catch(()=>{});lock.release();}
}
export async function runExplainerFullRevisionCli(argv=process.argv.slice(2)) {
  need(arguments.length<=1);const parsed=parseExplainerFullRevisionArguments(argv);
  if(parsed.mode==='preview')return {ok:true,mode:'preview',preview:await previewExplainerFullRevision(parsed.request)};
  const authority=createCapabilityAuthority({secret:randomBytes(32).toString('hex'),defaultTtlMs:2*60*60*1000,maximumTtlMs:2*60*60*1000,maximumCalls:0,maximumCostUsd:0});
  const sideEffectGrant=authority.authorize(explainerFullRevisionCapabilitySpec(parsed.request));
  return {ok:true,mode:'private_full_review_candidate',result:await renderExplainerFullRevision(parsed.request,{sideEffectGrant})};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runExplainerFullRevisionCli(),null,2));}
  catch(error){console.error(JSON.stringify({ok:false,code:error.code??'explainer_full_revision_failed',message:'完整私有审看片未确认完成；旧产物和审批状态未变。'}));process.exitCode=1;}
}
