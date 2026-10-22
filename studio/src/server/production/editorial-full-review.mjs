// Sealed, explicitly authorized full-length PRIVATE candidate. No Episode/Gate writer,
// provider, upload or formal renderer. The existing shortclip boundary is unchanged.
import {readFile,writeFile,realpath,stat,lstat} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {workspaceRoot} from '../../shared/paths.mjs';
import {readEpisode,readConfig} from '../../shared/store.mjs';
import {readReviewConfig} from '../reviews/coordinator.mjs';
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {editorialVoiceRegistrationValid} from '../../shared/editorial-voice-contract.mjs';
import {compileEditorialAudioVisualTiming} from '../../shared/editorial-av-timing.mjs';
import {applyEditorialPacingRevision} from '../../shared/editorial-av-pacing.mjs';
import {compileEditorialMotionRenderEpisode,buildEditorialMotionRenderModel} from '../../video/editorial-motion-render-model.mjs';
import {verifyRegisteredEditorialVoice,createEditorialVoiceDirectory} from './editorial-voice-integrity.mjs';
import {verifyRegisteredEditorialMaterialization} from './editorial-materialization-consumption.mjs';
import {editorialMaterializationInputProps,editorialMaterializationRegularFile as readRegular,
  editorialMaterializationSha as sha,editorialMaterializationJson as json,editorialMaterializationSafePath as safePath} from './editorial-materialization-integrity.mjs';
import {validateEditorialAvReviewPlan} from './editorial-av-review-core.mjs';
import {createEditorialReviewResourceMap} from './editorial-av-review-runtime.mjs';
import {createEditorialFullReviewService,editorialFullReviewNeed as need,editorialFullReviewError,
  assertEditorialFullReviewGrant,validateEditorialFullReviewRequest,validateEditorialFullReviewPlan,
  buildEditorialFullReviewSegments,padEditorialFullReviewPcm} from './editorial-full-review-core.mjs';
import {inspectEditorialFullReviewImplementation,assertFullReviewMedia,validateFullReviewCheckpoint,fullReviewConcatList} from './editorial-full-review-runtime.mjs';
import {validateCompletedFullReviewManifest} from './editorial-full-review-manifest.mjs';
import {acquireLongReviewRenderJobLock} from './long-render-job.mjs';
import {openOwnedBrowser} from './owned-browser-launch.mjs';

async function executable(candidates) {
  for(const candidate of candidates.filter(Boolean))try{
    const path=await realpath(candidate),s=await stat(path);if(!s.isFile()||!(s.mode&0o111))continue;
    const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};
  }catch{/* Installed runtimes only; no downloads. */}
  need(false,'editorial_full_review_runtime_missing');
}
async function inspect(input) {
  const root=await realpath(workspaceRoot),episode=await readEpisode(input.episodeId),config=await readConfig(),reviewConfig=await readReviewConfig();
  need(!episode.control?.activeOperation&&!episode.control?.stopRequested&&!episode.pipeline.some(s=>s.status==='running'),
    'editorial_full_review_episode_busy');
  need(episode.render.fps===30&&episode.render.width===1920&&episode.render.height===1080
    &&episode.voice?.status==='ready'&&!episode.voice.needsRevision&&editorialVoiceRegistrationValid(episode),'editorial_full_review_voice_not_ready');
  const material=await verifyRegisteredEditorialMaterialization({workspaceRoot:root,episode});
  const voice=await verifyRegisteredEditorialVoice({workspaceRoot:root,episode,receipt:episode.production.editorialVoice,reviewConfig});
  const planFile=await readRegular(root,input.planPath);need(planFile.bytes.length<=16384);
  const plan=validateEditorialFullReviewPlan(JSON.parse(planFile.bytes));
  const manifestFile=await readRegular(root,plan.preparationManifestPath);
  need(manifestFile.record.sha256===plan.preparationManifestSha256&&manifestFile.bytes.length<2*1024*1024,'editorial_full_review_preparation_changed');
  const manifest=JSON.parse(manifestFile.bytes),preparationRoot=dirname(plan.preparationManifestPath);
  need(manifest.schemaVersion==='full-film-preparation-package-v1'&&manifest.episodeId===episode.id
    &&Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=2000);
  const prepared=new Map();
  for(const entry of manifest.files){
    need(safePath(entry.path)&&!prepared.has(entry.path)&&Number.isSafeInteger(entry.bytes)&&entry.bytes>0);
    const file=await readRegular(root,`${preparationRoot}/${entry.path}`);
    need(file.record.sha256===entry.sha256&&file.record.bytes===entry.bytes,'editorial_full_review_preparation_changed');
    prepared.set(entry.path,file);
  }
  const take=path=>{const value=prepared.get(path);need(value,'editorial_full_review_preparation_incomplete');return value;};
  const sourceEpisodeFile=await readRegular(root,`studio/data/episodes/${episode.id}/episode.json`);
  need(sourceEpisodeFile.record.sha256===manifest.sourceEpisode.sha256
    &&digest(JSON.parse(sourceEpisodeFile.bytes))===digest(episode),'editorial_full_review_source_changed');
  const projection=JSON.parse(take('inputs/provenance/cumulative-review-projection.json').bytes);
  const frozenProps=JSON.parse(take('inputs/input-props.json').bytes);
  need(projection.episodeId===episode.id&&projection.sourceEpisodeSha256===sourceEpisodeFile.record.sha256
    &&projection.sourceVoiceAudioSha256===voice.audio.sha256&&projection.sourceVoiceTimingSha256===voice.timing.sha256);
  need(digest(projection.inputProps)===digest(frozenProps));
  const timingFile=await readRegular(root,voice.timing.path),voiceTiming=JSON.parse(timingFile.bytes);
  need(timingFile.record.sha256===voice.timing.sha256);
  const source={...material.inputProps.episode,scenes:material.inputProps.episode.scenes.map(scene=>({...scene,
    unitIds:structuredClone(episode.scenes.find(original=>original.id===scene.id).unitIds)}))};
  const baseline=compileEditorialAudioVisualTiming({episode:source,voiceTiming});
  let cumulative=baseline.episode;
  need(Array.isArray(projection.selectedPlanSources)&&projection.selectedPlanSources.length>0&&projection.selectedPlanSources.length<=8);
  const groups=new Set(),edited=new Set(),selectedPlanFiles=[];
  for(const item of projection.selectedPlanSources){
    need(typeof item.group==='string'&&/^[a-z][a-z0-9-]{0,39}$/u.test(item.group)&&!groups.has(item.group));groups.add(item.group);
    const original=await readRegular(root,item.path),copy=take(`inputs/selected-plans/${item.group}.json`);
    need(original.record.sha256===item.sha256&&copy.record.sha256===item.sha256,'editorial_full_review_pacing_changed');
    const revision=validateEditorialAvReviewPlan(JSON.parse(copy.bytes));need(revision.pacing);
    for(const scene of revision.pacing.scenes){need(!edited.has(scene.sceneId),'editorial_full_review_repeated_scene_revision');edited.add(scene.sceneId);}
    cumulative=applyEditorialPacingRevision({episode:cumulative,voiceTiming,pacing:revision.pacing,sourceEpisode:source}).episode;
    selectedPlanFiles.push(original.record);
  }
  const inputProps=editorialMaterializationInputProps(cumulative);
  need(digest(inputProps)===digest(frozenProps),'editorial_full_review_cumulative_props_changed');
  const durationInFrames=baseline.timing.durationInFrames,totalSamples=voice.audio.totalSamples;
  const segments=buildEditorialFullReviewSegments({durationInFrames,totalSamples});
  // Validate actual cumulative states, including revised event transitions, not just the baseline.
  const model=compileEditorialMotionRenderEpisode(cumulative,30),frames=new Set();
  for(const scene of cumulative.scenes){frames.add(scene.startFrame);frames.add(scene.endFrame-1);
    for(const event of scene.motionPlan.events)for(let f=event.atFrame-1;f<=event.atFrame+event.durationFrames+1;f++)
      if(f>=0&&f<scene.endFrame-scene.startFrame)frames.add(scene.startFrame+f);}
  for(const frame of frames)buildEditorialMotionRenderModel(model,frame,30);
  const implementationFiles=await inspectEditorialFullReviewImplementation(root);
  const runtime={node:await executable([process.execPath]),browser:await executable([config.browserExecutable,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge','/usr/bin/google-chrome','/usr/bin/chromium']),
  ffmpeg:await executable(['/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg','/usr/bin/ffmpeg']),
  ffprobe:await executable(['/opt/homebrew/bin/ffprobe','/usr/local/bin/ffprobe','/usr/bin/ffprobe'])};
  need(digest(episode)===digest(await readEpisode(input.episodeId))&&digest(config)===digest(await readConfig())
    &&digest(reviewConfig)===digest(await readReviewConfig()),'editorial_full_review_source_changed');
  return {episode,sourceEpisodeFile:sourceEpisodeFile.record,plan,planSha256:planFile.record.sha256,
    preparationManifestSha256:manifestFile.record.sha256,sourceHead:manifest.sourceHead,
    sourceHash:digest({episode,config,reviewConfig,voice,material:material.receipt,selectedPlanFiles,preparationManifestSha256:manifestFile.record.sha256}),
    implementationHash:digest({implementationFiles,runtime}),implementationFiles,runtime,voice,material:material.receipt,
    inputProps,durationInFrames,totalSamples,segments,selectedPlanFiles,
    bundleFiles:material.files.filter(f=>f.path.startsWith('bundle/')).map(f=>({path:f.path.slice(7),bytes:f.bytes,sha256:f.sha256})),
    publicSummary:{durationSeconds:durationInFrames/30,sceneCount:cumulative.scenes.length,captionCount:cumulative.subtitles.length,
      revisedSceneCount:edited.size,tailPaddingSamples:durationInFrames*800-totalSamples}};
}
const service=createEditorialFullReviewService({inspect,execute:executeFullReview});
export function previewEditorialFullReview(input) {
  if(arguments.length!==1)throw new TypeError('Full review preview accepts no overrides');return service.preview(input);
}
export function renderEditorialFullReview(request,options={}) {
  if(arguments.length>2)throw new TypeError('Full review execution accepts no overrides');return service.render(request,options);
}

const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
async function serve(value,root) {
  const resources=[];
  for(const item of value.bundleFiles){const file=await readRegular(root,`${value.material.bundlePath}/${item.path}`);
    need(file.record.sha256===item.sha256&&file.record.bytes===item.bytes);resources.push({...item,content:file.bytes});}
  const get=createEditorialReviewResourceMap(resources);
  const csp="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'";
  const server=createServer((req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),name=path==='/'?'index.html':path.slice(1),bytes=get(name);
    need(bytes);res.writeHead(200,{'Content-Type':types[extname(name)]??'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'});res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found');}});
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(yes=>server.close(yes))};
}
async function verifyRuntime(runtime){for(const item of Object.values(runtime)){
  need(await realpath(item.path)===item.path);const bytes=await readFile(item.path);
  need(bytes.length===item.bytes&&sha(bytes)===item.sha256,'editorial_full_review_runtime_changed');}}
async function exists(path){try{const s=await lstat(path);need(s.isFile()&&!s.isSymbolicLink()&&await realpath(path)===path);return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function run(executable,args,guard){guard();return new Promise((yes,no)=>{
  const child=spawn(executable,args,{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,LANG:'C',LC_ALL:'C'}});
  let stdout='',stderr='',failure=null;
  const stop=error=>{failure??=error;child.kill('SIGKILL');};
  const heartbeat=setInterval(()=>{try{guard();}catch(error){stop(error);}},1000);
  const timeout=setTimeout(()=>stop(editorialFullReviewError('editorial_full_review_process_timeout')),20*60*1000);
  child.stdout.on('data',c=>{stdout+=c;if(stdout.length>2*1024*1024)stop(editorialFullReviewError('editorial_full_review_process_output_limit'));});
  child.stderr.on('data',c=>{stderr+=c;if(stderr.length>2*1024*1024)stop(editorialFullReviewError('editorial_full_review_process_output_limit'));});
  const clear=()=>{clearInterval(heartbeat);clearTimeout(timeout);};
  child.once('error',e=>{clear();no(e);});child.once('close',code=>{clear();if(failure)return no(failure);
    if(code!==0)return no(editorialFullReviewError('editorial_full_review_process_failed'));
    try{guard();yes({stdout,stderr});}catch(e){no(e);}});
});}
async function executeFullReview({value,request,sideEffectGrant,assertCurrent}) {
  validateEditorialFullReviewRequest(request);
  const grant=()=>assertEditorialFullReviewGrant(request,{sideEffectGrant});grant();
  need(digest(value)===request.snapshotHash&&value.sourceHash===request.sourceHash&&value.implementationHash===request.implementationHash);
  const root=await realpath(workspaceRoot),requestHash=digest(request);
  const directory=`outputs/studio/${request.episodeId}/editorial-full-review-candidates/${requestHash}`;
  await assertCurrent();await verifyRuntime(value.runtime);grant();
  const destination=await createEditorialVoiceDirectory(root,directory);
  grant();const lock=await acquireLongReviewRenderJobLock(destination,{jobId:requestHash});
  let browser=null,server=null,cancelRender=null,interrupted=false;
  const interrupt=()=>{interrupted=true;cancelRender?.();};
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  const guard=()=>{need(!interrupted,'editorial_full_review_interrupted');grant();lock.assertOwned();};
  const write=async(name,bytes)=>{guard();need(safePath(name)&&!name.includes('/'));await writeFile(resolve(destination,name),bytes,{flag:'wx'});};
  const record=async name=>{const file=await readRegular(root,`${directory}/${name}`);return {...file.record,path:name};};
  const probe=async name=>JSON.parse((await run(value.runtime.ffprobe.path,['-v','error','-count_frames','-show_streams','-show_format','-show_data_hash','sha256','-of','json',resolve(destination,name)],guard)).stdout);
  const decode=async name=>run(value.runtime.ffmpeg.path,['-hide_banner','-loglevel','error','-xerror','-nostdin','-i',resolve(destination,name),'-map','0','-f','null','-'],guard);
  const preserve=async(name,bytes,readOnly=false)=>{if(await exists(resolve(destination,name))){need((await readRegular(root,`${directory}/${name}`)).bytes.equals(Buffer.from(bytes)),'editorial_full_review_resume_input_changed');}
    else {need(!readOnly,'editorial_full_review_resume_input_missing');await write(name,bytes);}};
  const result=manifest=>({status:'private_full_review_candidate',directory,manifestPath:`${directory}/review-manifest.json`,
    manifestSha256:sha(json(manifest)),videoPath:`${directory}/${manifest.video.path}`,durationSeconds:value.durationInFrames/30,
    durationInFrames:value.durationInFrames,formalRender:false,visualAcceptance:false,episodeMutated:false,releaseEligible:false,paidCalls:0});
  try {
    guard();const alreadyComplete=await exists(resolve(destination,'review-manifest.json'));
    const audio=await readRegular(root,value.voice.audio.path);need(audio.record.sha256===value.voice.audio.sha256&&audio.record.bytes===value.voice.audio.bytes);
    const padded=padEditorialFullReviewPcm(audio.bytes,value.durationInFrames);
    const baseCopies=[['request.json',json(request)],['input-props.json',json(value.inputProps)],['full-narration-padded.wav',padded.bytes]];
    for(const [name,bytes] of baseCopies)await preserve(name,bytes,alreadyComplete);
    const assertBaseCopies=async()=>{for(const [name,bytes]of baseCopies)await preserve(name,bytes,true);};
    const assertChunks=async chunks=>{for(const c of chunks){
      need(digest(await record(c.file.path))===digest(c.file),'editorial_full_review_resume_media_changed');
      need(digest(JSON.parse((await readRegular(root,`${directory}/${c.segment.id}.json`)).bytes))===digest(c),'editorial_full_review_checkpoint_changed');
    }};
    if(alreadyComplete){
      const complete=validateCompletedFullReviewManifest(JSON.parse((await readRegular(root,`${directory}/review-manifest.json`)).bytes),value,request);
      for(const file of complete.files){const current=await record(file.path);need(digest(current)===digest(file));}
      await assertChunks(complete.chunks);
      for(const c of complete.chunks){assertFullReviewMedia(await probe(c.file.path),c.segment.frameCount,{signature:c.signature});await decode(c.file.path);}
      assertFullReviewMedia(await probe(complete.video.path),value.durationInFrames,{audio:true});await decode(complete.video.path);
      await assertBaseCopies();await assertChunks(complete.chunks);await assertCurrent();
      for(const file of complete.files)need(digest(await record(file.path))===digest(file),'editorial_full_review_output_changed');
      guard();return result(complete);
    }
    const chunks=[];let signature=null,shared=null,composition=null;
    for(const segment of value.segments){
      await assertCurrent();await verifyRuntime(value.runtime);guard();
      const metadata=`${segment.id}.json`;
      if(await exists(resolve(destination,metadata))){
        const checkpoint=validateFullReviewCheckpoint(JSON.parse((await readRegular(root,`${directory}/${metadata}`)).bytes),segment,requestHash);
        need(digest(await record(checkpoint.file.path))===digest(checkpoint.file),'editorial_full_review_resume_media_changed');
        const current=assertFullReviewMedia(await probe(checkpoint.file.path),segment.frameCount,{signature:signature??checkpoint.signature});
        need(digest(current)===digest(checkpoint.signature));await decode(checkpoint.file.path);signature??=current;
        chunks.push(checkpoint);process.stderr.write(`${segment.id}: reused verified segment\n`);continue;
      }
      if(!browser){guard();server=await serve(value,root);guard();
        const {selectComposition}=await import('@remotion/renderer');
        browser=await openOwnedBrowser('chrome',{browserExecutable:value.runtime.browser.path,logLevel:'error'},guard);
        shared={serveUrl:server.url,inputProps:value.inputProps,puppeteerInstance:browser,logLevel:'error',
          onBrowserDownload:()=>{throw editorialFullReviewError('editorial_full_review_download_forbidden');}};
        composition=await selectComposition({...shared,id:'ConceptPreview'});
        need(composition.fps===30&&composition.width===1920&&composition.height===1080&&composition.durationInFrames===value.durationInFrames);
      }
      const token=lock.token,part=`${segment.id}.attempt-${token}.part.mp4`,video=`${segment.id}.${token}.mp4`,metadataPart=`${segment.id}.attempt-${token}.part.json`;
      const {renderMedia,makeCancelSignal}=await import('@remotion/renderer');const cancellation=makeCancelSignal();cancelRender=cancellation.cancel;
      let last=-1,grantFailure=null;
      await renderMedia({...shared,composition,outputLocation:resolve(destination,part),codec:'h264',pixelFormat:'yuv420p',imageFormat:'png',
        concurrency:1,crf:18,muted:true,overwrite:false,frameRange:[segment.fromFrame,segment.toFrameExclusive-1],cancelSignal:cancellation.cancelSignal,
        onProgress:({progress})=>{try{guard();}catch(error){grantFailure=error;cancellation.cancel();}
          const next=Math.floor(progress*4);if(next>last){last=next;process.stderr.write(`${segment.id}: ${Math.min(100,next*25)}%\n`);}}});
      cancelRender=null;if(grantFailure)throw grantFailure;
      const current=assertFullReviewMedia(await probe(part),segment.frameCount,{signature});await decode(part);signature??=current;
      await assertCurrent();guard();
      const partRecord=await record(part),checkpoint={schemaVersion:'editorial-full-review-segment-v1',requestHash,segment,
        file:{...partRecord,path:video},signature:current,fullDecodePassed:true};
      await write(metadataPart,json(checkpoint));guard();
      await lock.publishAttemptPair({attemptToken:token,videoPartPath:resolve(destination,part),videoPath:resolve(destination,video),
        metadataPartPath:resolve(destination,metadataPart),metadataPath:resolve(destination,metadata)});
      chunks.push(checkpoint);process.stderr.write(`${segment.id}: verified and checkpointed\n`);
    }
    if(browser){await browser.close({silent:true});browser=null;}if(server){await server.close();server=null;}
    await assertCurrent();await verifyRuntime(value.runtime);await assertChunks(chunks);await assertBaseCopies();guard();
    const token=lock.token,concat=`concat-${token}.txt`,silent=`full-silent-${token}.mp4`,part=`full-review.attempt-${token}.part.mp4`,video=`full-review.${token}.mp4`;
    await write(concat,fullReviewConcatList(chunks.map(c=>c.file.path)));
    const concatArgs=['-hide_banner','-loglevel','error','-nostdin','-n','-f','concat','-safe','1','-i',resolve(destination,concat),'-map','0:v:0','-c:v','copy','-an',resolve(destination,silent)];
    await run(value.runtime.ffmpeg.path,concatArgs,guard);assertFullReviewMedia(await probe(silent),value.durationInFrames,{signature});await decode(silent);
    const silentRecord=await record(silent);await assertChunks(chunks);await assertBaseCopies();
    const muxArgs=['-hide_banner','-loglevel','error','-nostdin','-n','-i',resolve(destination,silent),'-i',resolve(destination,'full-narration-padded.wav'),
      '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-movflags','+faststart',resolve(destination,part)];
    await run(value.runtime.ffmpeg.path,muxArgs,guard);
    const info=await probe(part);assertFullReviewMedia(info,value.durationInFrames,{audio:true,signature});await decode(part);
    await assertCurrent();await verifyRuntime(value.runtime);await assertChunks(chunks);await assertBaseCopies();
    need(digest(await record(silent))===digest(silentRecord),'editorial_full_review_assembly_changed');guard();
    const videoRecord={...await record(part),path:video};
    const evidence=`assembly-${token}.json`;
    await write(evidence,json({requestHash,concatArgs,muxArgs,aacEncodesForThisDeliveredAttempt:1,sourceAudioSha256:value.voice.audio.sha256,
      sourceSamples:padded.sourceSamples,targetSamples:padded.targetSamples,tailPaddingSamples:padded.tailPaddingSamples,interiorPaddingSamples:0,
      resynthesized:false,timeStretched:false,fullDecodePassed:true,probe:info}));
    const files=[videoRecord];
    for(const name of ['request.json','input-props.json','full-narration-padded.wav',concat,silent,evidence,
      ...chunks.flatMap(c=>[c.file.path,`${c.segment.id}.json`])])files.push(await record(name));
    const manifest={schemaVersion:'editorial-full-review-candidate-v1',episodeId:request.episodeId,request,sourceHash:value.sourceHash,
      sourceEpisodeFile:value.sourceEpisodeFile,sourceHead:value.sourceHead,preparationManifestSha256:value.preparationManifestSha256,
      implementationHash:value.implementationHash,implementationFiles:value.implementationFiles,runtime:value.runtime,
      selectedPlanFiles:value.selectedPlanFiles,inputPropsSha256:sha(json(value.inputProps)),originalPropsSha256:value.material.inputPropsSha256,
      voice:value.voice,video:videoRecord,chunks,files,durationInFrames:value.durationInFrames,fps:30,width:1920,height:1080,
      audio:{sourceSamples:padded.sourceSamples,targetSamples:padded.targetSamples,tailPaddingSamples:padded.tailPaddingSamples,
        paddedPcmPath:'full-narration-padded.wav',aacEncodesForThisDeliveredAttempt:1,assemblyEvidencePath:evidence},
      fullDecodePassed:true,formalRender:false,visualAcceptance:false,continuousHumanReview:false,episodeMutated:false,
      releaseEligible:false,paidCalls:0,maximumPaidCostUsd:0,assurance:'private-full-review-only; decode does not replace pixel QA or continuous listening/viewing'};
    validateCompletedFullReviewManifest(manifest,value,request);
    const metadataPart=`review-manifest.attempt-${token}.part.json`;await write(metadataPart,json(manifest));
    await assertCurrent();await assertChunks(chunks);await assertBaseCopies();
    for(const f of files){const path=f.path===video?part:f.path;need(digest({...await record(path),path:f.path})===digest(f),'editorial_full_review_output_changed');}
    guard();await lock.publishAttemptPair({attemptToken:token,videoPartPath:resolve(destination,part),videoPath:resolve(destination,video),
      metadataPartPath:resolve(destination,metadataPart),metadataPath:resolve(destination,'review-manifest.json')});
    return result(manifest);
  }finally{
    process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
    if(browser)await browser.close({silent:true}).catch(()=>undefined);
    if(server)await server.close().catch(()=>undefined);
    lock.release();
  }
}
