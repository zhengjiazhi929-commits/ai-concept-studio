// Sealed, local, immutable three-clip proof. Never registers or mutates an Episode.
import {createHash,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,readdir,realpath,stat} from 'node:fs/promises';
import {resolve,relative,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createCapabilityAuthority,requireSideEffectGrant} from '../src/server/security/side-effect-capability.mjs';
import {validateExplainerRevisionPlan,buildExplainerRevisionTiming,validateExplainerRevisionInput,
  validateExplainerRevisionRequest,validateExplainerRevisionPcm,sliceExplainerRevisionPcm,
  parseExplainerRevisionArguments,explainerRevisionNeed as need} from '../src/shared/explainer-revision-proof.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const ENTRY='studio/src/video/explainer-revision/index.jsx';
const SCRIPT='studio/scripts/render-explainer-revision-proof.mjs';
const FONT='studio/node_modules/@fontsource-variable/noto-sans-sc';
const LOGO='studio/public/assets/visual-system-v1/ai-watermark-v013';
const OP='review:render-explainer-revision-proof';
const SCOPES=['filesystem.write.explainer-revision-proof','process.spawn.explainer-revision-proof'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>`${JSON.stringify(value,null,2)}\n`;
const digest=value=>sha(json(value));
const safePath=path=>typeof path==='string'&&/^[a-zA-Z0-9_./@-]+$/u.test(path)&&!path.startsWith('/')
  &&path.split('/').every(p=>p&&p!=='.'&&p!=='..');
export function explainerRevisionCapabilitySpec(value) {
  const request=validateExplainerRevisionRequest(value);
  return {episodeId:`explainer-revision-proof/${digest(request)}`,operation:OP,scopes:[...SCOPES],maxCalls:0,maxCostUsd:0};
}
function grantFor(request,options) {
  need(options&&typeof options==='object'&&!Array.isArray(options)&&[Object.prototype,null].includes(Object.getPrototypeOf(options)));
  for(const key of Reflect.ownKeys(options)) {
    const d=Object.getOwnPropertyDescriptor(options,key);need(key==='sideEffectGrant'&&d.enumerable&&Object.hasOwn(d,'value'));
  }
  const grant=requireSideEffectGrant(options,explainerRevisionCapabilitySpec(request),OP);
  need(grant.maxCalls===0&&grant.maxCostUsd===0&&JSON.stringify([...grant.scopes].sort())===JSON.stringify([...SCOPES].sort()),
    'explainer_revision_capability_scope_invalid');return grant;
}
async function regular(root,path,{font=false,maxBytes=64*1024*1024}={}) {
  need(safePath(path),'explainer_revision_path_unsafe');const target=resolve(root,path),actual=await realpath(target);
  const info=await lstat(target);need(info.isFile()&&!info.isSymbolicLink()&&(actual===target||font&&path.startsWith(`${FONT}/`)),
    'explainer_revision_path_unsafe');need(info.size>0&&info.size<=maxBytes,'explainer_revision_file_size');
  const bytes=await readFile(actual);need(bytes.length===info.size&&await realpath(target)===actual,'explainer_revision_input_changed');
  return {path,bytes:bytes.length,sha256:sha(bytes),content:bytes};
}
const metadata=({path,bytes,sha256})=>({path,bytes,sha256});
async function tree(root,path,{font=false}={}) {
  const found=[];
  async function walk(local) {
    const full=resolve(root,local),actual=await realpath(full),s=await lstat(full);
    // Only the initial package-manager font directory may resolve through a link.
    need(actual===full||font&&local.startsWith(FONT),'explainer_revision_path_unsafe');
    if(s.isDirectory()||font&&local===FONT&&s.isSymbolicLink()) {
      for(const name of (await readdir(full)).sort())await walk(`${local}/${name}`);
    }else {need(s.isFile()&&!s.isSymbolicLink(),'explainer_revision_path_unsafe');found.push(await regular(root,local,{font}));}
  }
  await walk(path);return found;
}
async function executable(candidates) {
  for(const candidate of candidates)try {
    const path=await realpath(candidate),s=await stat(path);if(!s.isFile()||!(s.mode&0o111))continue;
    const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};
  }catch{/* Installed binaries only. No download fallback. */}
  need(false,'explainer_revision_runtime_missing');
}
async function implementation(root) {
  const {build}=await import('esbuild');const sources=new Map();
  for(const [seed,platform] of [[SCRIPT,'node'],[ENTRY,'browser']]) {
    const result=await build({absWorkingDir:root,entryPoints:[resolve(root,seed)],bundle:true,write:false,metafile:true,
      packages:'external',platform,format:'esm',outdir:resolve(root,'outputs/unused-explainer-inspection'),logLevel:'silent',
      plugins:[{name:'read-only-bound-closure',setup(builder){builder.onLoad({filter:/.*/},async({path})=>{
        const local=relative(root,path).replaceAll('\\','/');need(local.startsWith('studio/src/')||local.startsWith('studio/scripts/'));
        const file=await regular(root,local);need(!sources.has(local)||sources.get(local).sha256===file.sha256);
        sources.set(local,file);const loader={'.mjs':'js','.js':'js','.jsx':'jsx','.css':'css','.json':'json'}[extname(path)];need(loader);
        return {contents:file.content,loader,resolveDir:dirname(path)};
      });}}]});need(result.warnings.length===0,'explainer_revision_closure_incomplete');
  }
  for(const path of ['.node-version','studio/package.json','studio/pnpm-lock.yaml','studio/pnpm-workspace.yaml'])sources.set(path,await regular(root,path));
  for(const file of [...await tree(root,FONT,{font:true}),...await tree(root,LOGO)])sources.set(file.path,file);
  return [...sources.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
async function inspect(inputValue) {
  const input=validateExplainerRevisionInput(inputValue),root=await realpath(ROOT);
  const planFile=await regular(root,input.planPath,{maxBytes:256*1024}),voiceFile=await regular(root,input.voiceResultPath,{maxBytes:1024*1024});
  const plan=validateExplainerRevisionPlan(JSON.parse(planFile.content)),voice=JSON.parse(voiceFile.content);
  const timing=buildExplainerRevisionTiming(plan,voice);
  const voicePath=`${dirname(input.voiceResultPath)}/${voice.voice.file}`;
  const audio=await regular(root,voicePath,{maxBytes:7200044});validateExplainerRevisionPcm(audio.content,voice);
  need(audio.sha256===voice.voice.sha256&&audio.bytes===voice.voice.bytes,'explainer_revision_voice_changed');
  const files=await implementation(root);
  const runtime={node:await executable([process.execPath]),browser:await executable([
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome','/usr/bin/chromium']),ffmpeg:await executable(['/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg','/usr/bin/ffmpeg']),
    ffprobe:await executable(['/opt/homebrew/bin/ffprobe','/usr/local/bin/ffprobe','/usr/bin/ffprobe']),git:await executable(['/usr/bin/git'])};
  need(process.version==='v24.19.0','explainer_revision_node_version');
  const gitHead=(await run(runtime.git.path,['-C',root,'rev-parse','HEAD'],()=>{})).trim();
  need(/^[a-f0-9]{40}$/u.test(gitHead),'explainer_revision_git_head_invalid');
  const inputProps={plan,timing,captions:timing.segments.map(s=>({id:s.id,text:s.text,startMs:s.startSample/24,endMs:s.endSample/24}))};
  const sourceFiles=[planFile,voiceFile,audio].map(metadata);
  const sourceHash=digest(sourceFiles),implementationFiles=files.map(metadata),implementationHash=digest({files:implementationFiles,runtime});
  const summary={schemaVersion:'explainer-revision-proof-preview-v1',gitHead,sourceHash,implementationHash,sourceFiles,implementationFiles,runtime,
    inputProps,clips:timing.clips,durationInFrames:timing.durationInFrames,durationSeconds:timing.durationInFrames/30,
    formalRender:false,visualAcceptance:false,episodeMutated:false,releaseEligible:false,externalApiCalls:0,maximumPaidCostUsd:0};
  const snapshotHash=digest(summary);
  return {root,input,files,audio,summary,snapshotHash};
}
export async function previewExplainerRevisionProof(input) {
  need(arguments.length===1);const value=await inspect(input);return {...value.summary,snapshotHash:value.snapshotHash};
}
async function unchanged(value) {
  need((await run(value.summary.runtime.git.path,['-C',value.root,'rev-parse','HEAD'],()=>{})).trim()===value.summary.gitHead,
    'explainer_revision_git_head_changed');
  for(const expected of [...value.summary.sourceFiles,...value.summary.implementationFiles]) {
    const file=await regular(value.root,expected.path,{font:expected.path.startsWith(`${FONT}/`)});
    need(file.sha256===expected.sha256&&file.bytes===expected.bytes,'explainer_revision_source_changed');
  }
  for(const expected of Object.values(value.summary.runtime)) {
    need(await realpath(expected.path)===expected.path);const bytes=await readFile(expected.path);
    need(bytes.length===expected.bytes&&sha(bytes)===expected.sha256,'explainer_revision_runtime_changed');
  }
}
async function assertDirectory(root,path) {
  const target=resolve(root,path);need(target===root||target.startsWith(`${root}/`));
  let cursor=root;
  for(const part of relative(root,target).split('/').filter(Boolean)) {
    cursor=resolve(cursor,part);const s=await lstat(cursor).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(s)need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(cursor)===cursor,'explainer_revision_output_path_unsafe');
  }
}
async function serve(resources,guard) {
  const data=new Map(resources.map(file=>[file.path,Buffer.from(file.content)]));
  const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png'};
  guard();const server=createServer((req,res)=>{
    try {
      const url=new URL(req.url,'http://127.0.0.1'),path=decodeURIComponent(url.pathname).slice(1)||'index.html',bytes=data.get(path);need(bytes);
      res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Security-Policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'"});res.end(bytes);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function run(executable,args,guard) {
  guard();return new Promise((accept,reject)=>{
    const child=spawn(executable,args,{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,LANG:'C',LC_ALL:'C'}});
    let stdout='',stderr='',limit=false;const timer=setTimeout(()=>{limit=true;child.kill('SIGKILL');},5*60*1000);
    child.stdout.on('data',x=>{stdout+=x;if(stdout.length>2*1024*1024){limit=true;child.kill('SIGKILL');}});
    child.stderr.on('data',x=>{stderr+=x;if(stderr.length>2*1024*1024){limit=true;child.kill('SIGKILL');}});
    child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);
      if(code===0&&!limit)accept(stdout);else reject(Object.assign(new Error('Local proof process failed'),{code:'explainer_revision_process_failed'}));});
  });
}
function media(info,clip) {
  const v=info.streams?.filter(s=>s.codec_type==='video')??[],a=info.streams?.filter(s=>s.codec_type==='audio')??[];
  const frames=clip.toFrameExclusive-clip.fromFrame,seconds=frames/30;
  need(info.streams?.length===2&&v.length===1&&a.length===1&&v[0].codec_name==='h264'&&v[0].width===1920&&v[0].height===1080
    &&v[0].pix_fmt==='yuv420p'&&v[0].r_frame_rate==='30/1'&&Number(v[0].nb_read_frames)===frames
    &&a[0].codec_name==='aac'&&a[0].sample_rate==='24000'&&a[0].channels===1
    &&Math.abs(Number(v[0].duration)-seconds)<0.034&&Math.abs(Number(a[0].duration)-seconds)<0.1,'explainer_revision_media_invalid');
}
export async function renderExplainerRevisionProof(requestValue,options={}) {
  need(arguments.length<=2);const request=validateExplainerRevisionRequest(requestValue);grantFor(request,options);
  const guard=()=>grantFor(request,options);
  const value=await inspect({planPath:request.planPath,voiceResultPath:request.voiceResultPath});
  need(value.snapshotHash===request.snapshotHash&&value.summary.sourceHash===request.sourceHash
    &&value.summary.implementationHash===request.implementationHash,'explainer_revision_preview_changed');
  const local=`outputs/studio/explainer-revision-proof/${digest(request)}`,destination=resolve(value.root,local);
  await unchanged(value);guard();await assertDirectory(value.root,dirname(local));await mkdir(dirname(destination),{recursive:true});
  await assertDirectory(value.root,dirname(local));guard();await mkdir(destination); // EEXIST is intentional; never resume or replace.
  const written=new Map();
  const write=async(path,bytes)=>{
    need(safePath(path));guard();await assertDirectory(destination,dirname(path));await mkdir(dirname(resolve(destination,path)),{recursive:true});
    await assertDirectory(destination,dirname(path));guard();await writeFile(resolve(destination,path),bytes,{flag:'wx'});
    written.set(path,{path,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)});
  };
  const record=async path=>{const file=await regular(destination,path);written.set(path,metadata(file));return file;};
  await write('request.json',json(request));await write('input-props.json',json(value.summary.inputProps));
  await write('source-manifest.json',json(value.summary));await write('voice.wav',value.audio.content);
  for(const file of value.files) {
    const target=file.path.startsWith('studio/public/')?`public/${file.path.slice('studio/public/'.length)}`:`snapshot/${file.path}`;
    await write(target,file.content);
  }
  let browser=null,server=null;
  try {
    await unchanged(value);guard();const {bundle}=await import('@remotion/bundler');
    const bundleDir=resolve(destination,'bundle'),snapshot=resolve(destination,'snapshot');
    await bundle({entryPoint:resolve(snapshot,ENTRY),rootDir:resolve(snapshot,'studio'),outDir:bundleDir,
      publicDir:resolve(destination,'public'),symlinkPublicDir:false,enableCaching:false,gitSource:null,onProgress:()=>undefined,
      webpackOverride:config=>({...config,devtool:false,resolve:{...config.resolve,
        modules:[resolve(value.root,'studio/node_modules'),...(config.resolve?.modules??['node_modules'])],
        alias:{...config.resolve?.alias,'@fontsource-variable/noto-sans-sc':resolve(snapshot,FONT)}}})});
    const resources=await tree(destination,'bundle');for(const f of resources)written.set(f.path,metadata(f));
    await unchanged(value);server=await serve(resources.map(f=>({...f,path:f.path.slice(7)})),guard);
    const {openBrowser,selectComposition,renderMedia}=await import('@remotion/renderer');
    guard();browser=await openBrowser('chrome',{browserExecutable:value.summary.runtime.browser.path,logLevel:'error'});
    const shared={serveUrl:server.url,inputProps:value.summary.inputProps,puppeteerInstance:browser,logLevel:'error',
      onBrowserDownload:()=>{throw new Error('Download forbidden');}};
    guard();const composition=await selectComposition({...shared,id:'ExplainerRevision'});
    need(composition.fps===30&&composition.width===1920&&composition.height===1080
      &&composition.durationInFrames===value.summary.durationInFrames,'explainer_revision_composition_changed');
    const clips=[];
    for(const clip of value.summary.clips) {
      await unchanged(value);guard();const silent=`${clip.id}.silent.mp4`,wav=`${clip.id}.wav`,video=`${clip.id}.mp4`;
      let lastProgress=-1;
      await renderMedia({...shared,composition,outputLocation:resolve(destination,silent),codec:'h264',pixelFormat:'yuv420p',imageFormat:'png',
        concurrency:1,crf:18,muted:true,overwrite:false,frameRange:[clip.fromFrame,clip.toFrameExclusive-1],
        onProgress:({progress})=>{const current=Math.floor(progress*10);if(current>lastProgress){lastProgress=current;process.stderr.write(`${clip.id}: ${current*10}%\n`);}}});
      const silentFile=await record(silent);await write(wav,sliceExplainerRevisionPcm(value.audio.content,clip));await unchanged(value);
      await run(value.summary.runtime.ffmpeg.path,['-hide_banner','-loglevel','error','-nostdin','-n','-i',resolve(destination,silent),
        '-i',resolve(destination,wav),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',
        '-t',String((clip.toFrameExclusive-clip.fromFrame)/30),resolve(destination,video)],guard);
      const final=await record(video);
      need((await regular(destination,silent)).sha256===silentFile.sha256,'explainer_revision_output_changed');
      const info=JSON.parse(await run(value.summary.runtime.ffprobe.path,['-v','error','-count_frames','-show_streams','-show_format','-of','json',resolve(destination,video)],guard));
      media(info,clip);await run(value.summary.runtime.ffmpeg.path,['-hide_banner','-loglevel','error','-xerror','-nostdin','-i',resolve(destination,video),'-map','0','-f','null','-'],guard);
      need((await regular(destination,video)).sha256===final.sha256,'explainer_revision_output_changed');
      await write(`${clip.id}-probe.json`,json(info));const keyframes=[];
      // Evidence is decoded from the actual final MP4, not a separately rendered still.
      for(const frame of [...new Set([0,Math.floor((clip.toFrameExclusive-clip.fromFrame)/2),clip.toFrameExclusive-clip.fromFrame-1])]) {
        const image=`${clip.id}-frame-${frame}.png`;
        await run(value.summary.runtime.ffmpeg.path,['-hide_banner','-loglevel','error','-nostdin','-n','-i',resolve(destination,video),
          '-vf',`select=eq(n\\,${frame})`,'-frames:v','1',resolve(destination,image)],guard);await record(image);keyframes.push({file:image,clipFrame:frame,globalFrame:clip.fromFrame+frame});
      }
      clips.push({...clip,file:video,sha256:final.sha256,fullDecodePassed:true,playbackRate:1,keyframes});
    }
    await unchanged(value);guard();
    // Walk output from its parent so the regular-file path check never accepts '.'.
    const all=(await tree(dirname(destination),digest(request))).map(f=>({...f,path:f.path.slice(digest(request).length+1)}));
    const files=all.map(metadata).sort((a,b)=>a.path.localeCompare(b.path,'en'));
    need(digest(files)===digest([...written.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'))),'explainer_revision_output_changed');
    const manifest={schemaVersion:'explainer-revision-proof-candidate-v1',gitHead:value.summary.gitHead,request,sourceHash:request.sourceHash,
      implementationHash:request.implementationHash,snapshotHash:request.snapshotHash,sourceFiles:value.summary.sourceFiles,
      implementationFiles:value.summary.implementationFiles,runtime:value.summary.runtime,
      inputPropsSha256:written.get('input-props.json').sha256,clips,files,formalRender:false,visualAcceptance:false,
      episodeMutated:false,releaseEligible:false,externalApiCalls:0,maximumPaidCostUsd:0,
      assurance:'private three-clip proof; measured audio and full decode do not imply visual or listening acceptance'};
    await write('proof-manifest.json',json(manifest));
    return {status:'private_review_candidate',directory:local,manifestPath:`${local}/proof-manifest.json`,manifestSha256:sha(json(manifest)),
      clips:clips.map(c=>({id:c.id,path:`${local}/${c.file}`,durationSeconds:(c.toFrameExclusive-c.fromFrame)/30})),
      formalRender:false,visualAcceptance:false,episodeMutated:false,releaseEligible:false};
  } finally {if(browser)await browser.close({silent:true}).catch(()=>{});if(server)await server.close().catch(()=>{});}
}
export async function runExplainerRevisionProofCli(argv=process.argv.slice(2)) {
  need(arguments.length<=1);const parsed=parseExplainerRevisionArguments(argv);
  if(parsed.mode==='preview')return {ok:true,mode:'preview',preview:await previewExplainerRevisionProof(parsed.request)};
  const authority=createCapabilityAuthority({secret:randomBytes(32).toString('hex'),defaultTtlMs:45*60*1000,maximumTtlMs:45*60*1000,maximumCalls:0,maximumCostUsd:0});
  const sideEffectGrant=authority.authorize(explainerRevisionCapabilitySpec(parsed.request));
  return {ok:true,mode:'private_review_candidate',result:await renderExplainerRevisionProof(parsed.request,{sideEffectGrant})};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runExplainerRevisionProofCli(),null,2));}
  catch(error){console.error(JSON.stringify({ok:false,code:error.code??'explainer_revision_failed',message:'私有样片未确认完成，旧视频与审批状态未变。'}));process.exitCode=1;}
}
