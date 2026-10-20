// Sealed local review entry. No Episode writes, approval, provider, upload or formal renderer.
import {readFile,writeFile,realpath,stat,rename} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {workspaceRoot} from '../../shared/paths.mjs';
import {readEpisode,readConfig} from '../../shared/store.mjs';
import {readReviewConfig} from '../reviews/coordinator.mjs';
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {editorialVoiceRegistrationValid} from '../../shared/editorial-voice-contract.mjs';
import {compileEditorialAudioVisualTiming,buildEditorialAudioVisualClipRanges} from '../../shared/editorial-av-timing.mjs';
import {verifyRegisteredEditorialVoice,createEditorialVoiceDirectory} from './editorial-voice-integrity.mjs';
import {verifyRegisteredEditorialMaterialization,createEditorialMaterializationSnapshotCore} from './editorial-materialization-consumption.mjs';
import {editorialMaterializationInputProps,editorialMaterializationRegularFile as readRegular,
  editorialMaterializationSha as sha,editorialMaterializationJson as json,editorialMaterializationFileSet as fileSet} from './editorial-materialization-integrity.mjs';
import {createEditorialAvReviewService,editorialAvReviewNeed as need,editorialAvReviewError,
  assertEditorialAvReviewGrant,validateEditorialAvReviewRequest,assertEditorialAvReviewClips,
  validateEditorialAvReviewPlan} from './editorial-av-review-core.mjs';
import {sliceEditorialReviewPcm,inspectEditorialAvReviewImplementation,createEditorialReviewResourceMap} from './editorial-av-review-runtime.mjs';
import {openOwnedBrowser} from './owned-browser-launch.mjs';
async function pinExecutable(candidates) {
  for(const candidate of candidates.filter(Boolean)) {
    try {
      const path=await realpath(candidate);const info=await stat(path);
      if(!info.isFile()||(info.mode&0o111)===0)continue;
      const bytes=await readFile(path);return {path,bytes:bytes.length,sha256:sha(bytes)};
    } catch { /* Read-only installed runtime discovery; never downloads. */ }
  }
  need(false,'editorial_av_review_runtime_missing');
}
async function inspect(input) {
  const root=await realpath(workspaceRoot);
  const episode=await readEpisode(input.episodeId);const reviewConfig=await readReviewConfig();const config=await readConfig();
  need(!episode.control?.activeOperation&&!episode.control?.stopRequested&&!episode.pipeline.some(step=>step.status==='running'),
    'editorial_av_review_episode_busy');
  need(episode.render.fps===30&&episode.render.width===1920&&episode.render.height===1080
    &&episode.voice?.status==='ready'&&!episode.voice.needsRevision&&editorialVoiceRegistrationValid(episode),
  'editorial_av_review_voice_not_ready');
  const voice=await verifyRegisteredEditorialVoice({workspaceRoot:root,episode,receipt:episode.production.editorialVoice,reviewConfig});
  const material=await verifyRegisteredEditorialMaterialization({workspaceRoot:root,episode});
  const timingFile=await readRegular(root,voice.timing.path);
  need(timingFile.record.sha256===voice.timing.sha256&&timingFile.record.bytes===voice.timing.bytes,'editorial_av_review_voice_changed');
  const voiceTiming=JSON.parse(timingFile.bytes);
  const planFile=await readRegular(root,input.planPath);need(planFile.bytes.length<=256*1024);
  const plan=validateEditorialAvReviewPlan(JSON.parse(planFile.bytes));
  // The registered renderer projection deliberately omits authoring unit IDs.
  // Restore only those IDs from the verified source, never its control/history.
  const timingInput={...material.inputProps.episode,scenes:material.inputProps.episode.scenes.map(scene=>({
    ...scene,unitIds:structuredClone(episode.scenes.find(original=>original.id===scene.id).unitIds)}))};
  const compiled=compileEditorialAudioVisualTiming({episode:timingInput,voiceTiming,...(plan.pacing?{pacing:plan.pacing}:{})});
  const clips=buildEditorialAudioVisualClipRanges({episode:compiled.episode,voiceTiming,clipSpecs:plan.clips}).map(clip=>({...clip,
    speechEndSample:Math.max(...voiceTiming.segments.filter(segment=>segment.endSample<=clip.endSample&&segment.endSample>clip.startSample)
      .map(segment=>segment.endSample))}));
  const inputProps=editorialMaterializationInputProps(compiled.episode);
  const files=await inspectEditorialAvReviewImplementation(root);
  const runtime={node:await pinExecutable([process.execPath]),browser:await pinExecutable([config.browserExecutable,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome','/usr/bin/chromium']),ffmpeg:await pinExecutable(['/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg','/usr/bin/ffmpeg']),
  ffprobe:await pinExecutable(['/opt/homebrew/bin/ffprobe','/usr/local/bin/ffprobe','/usr/bin/ffprobe'])};
  need(digest(episode)===digest(await readEpisode(input.episodeId))&&digest(reviewConfig)===digest(await readReviewConfig())
    &&digest(config)===digest(await readConfig()),'editorial_av_review_snapshot_changed');
  return {episode,reviewConfigHash:digest(reviewConfig),sourceHash:digest({episode,reviewConfig,material:material.receipt,voice}),
    implementationHash:digest({files,runtime}),implementationFiles:files,runtime,
    planSha256:planFile.record.sha256,plan,voice,material:material.receipt,inputProps,retiming:compiled.timing,clips,
    bundleFiles:material.files.filter(file=>file.path.startsWith('bundle/'))
      .map(file=>({path:file.path.slice('bundle/'.length),bytes:file.bytes,sha256:file.sha256})),
    durationInFrames:compiled.timing.durationInFrames,
    publicSummary:{durationSeconds:compiled.timing.durationSeconds,alignmentMethod:compiled.timing.alignmentMethod,
      pacingRevised:Boolean(plan.pacing),
      motionPlacementMethod:compiled.timing.motionPlacementMethod,captionAligned:true,motionAligned:true,
      assurance:'measured-phrase-audio-with-candidate-motion-timing-not-human-acceptance'}};
}
const service=createEditorialAvReviewService({inspect,execute:executeEditorialAvReview});
export function previewEditorialReviewClips(input) {
  if(arguments.length!==1)throw new TypeError('Editorial review preview does not accept overrides');return service.preview(input);
}
export function renderEditorialReviewClips(request,options={}) {
  if(arguments.length>2)throw new TypeError('Editorial review execution does not accept overrides');return service.render(request,options);
}

const contentTypes={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json',
  '.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml'};
const csp="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'";
async function serveSnapshot(directory,expectedFiles) {
  const root=await realpath(directory);
  const files=await fileSet(root);const resources=[];
  need(digest(files)===digest([...expectedFiles].sort((a,b)=>a.path.localeCompare(b.path,'en'))),'editorial_av_review_snapshot_bytes_changed');
  for(const file of expectedFiles)resources.push({...file,content:(await readRegular(root,file.path)).bytes});
  const readResource=createEditorialReviewResourceMap(resources);
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      const pathname=decodeURIComponent(url.pathname);const path=pathname==='/'?'index.html':pathname.slice(1);
      const bytes=readResource(path);need(bytes);
      res.writeHead(200,{'Content-Type':contentTypes[extname(path)]??'application/octet-stream','Content-Security-Policy':csp,
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);
    } catch {res.writeHead(404);res.end('Not found');}
  });
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()))};
}
async function verifyRuntime(runtime) {
  for(const item of Object.values(runtime)) {
    const path=await realpath(item.path);const bytes=await readFile(path);
    need(path===item.path&&bytes.length===item.bytes&&sha(bytes)===item.sha256,'editorial_av_review_runtime_changed');
  }
}
async function runProcess(executable,args) {
  return new Promise((accept,reject)=>{
    const child=spawn(executable,args,{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,LANG:'C',LC_ALL:'C'}});
    let stdout='',stderr='',limited=false;
    const timer=setTimeout(()=>{limited=true;child.kill('SIGKILL');},5*60*1000);
    child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>2*1024*1024){limited=true;child.kill('SIGKILL');}});
    child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>2*1024*1024){limited=true;child.kill('SIGKILL');}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{clearTimeout(timer);code===0&&!limited?accept({stdout,stderr}):reject(editorialAvReviewError('editorial_av_review_process_failed'));});
  });
}
async function executeEditorialAvReview({value,request,sideEffectGrant,assertCurrent}) {
  validateEditorialAvReviewRequest(request);
  const grant=()=>assertEditorialAvReviewGrant(request,{sideEffectGrant});grant();
  need(digest(value)===request.snapshotHash&&value.sourceHash===request.sourceHash
    &&value.implementationHash===request.implementationHash&&value.planSha256===request.planSha256,
  'editorial_av_review_snapshot_changed');
  assertEditorialAvReviewClips(value.clips,value.durationInFrames);
  const root=await realpath(workspaceRoot);const directory=`outputs/studio/${request.episodeId}/editorial-review-candidates/${digest(request)}`;
  await assertCurrent();await verifyRuntime(value.runtime);grant();
  const destination=await createEditorialVoiceDirectory(root,directory,{exclusive:true});
  const outputRecords=new Map();
  const record=async path=>{const file=await readRegular(root,`${directory}/${path}`);outputRecords.set(path,{...file.record,path});};
  const write=async(path,bytes)=>{grant();need(await realpath(destination)===destination);await writeFile(resolve(destination,path),bytes,{flag:'wx'});
    outputRecords.set(path,{path,bytes:Buffer.byteLength(bytes),sha256:sha(bytes)});};
  await write('request.json',json(request));await write('input-props.json',json(value.inputProps));await write('retiming.json',json(value.retiming));
  let snapshot=null,server=null,browser=null;const clipRecords=[];
  try {
    grant();snapshot=await createEditorialMaterializationSnapshotCore({workspaceRoot:root,episode:value.episode});
    const audio=await readRegular(root,value.voice.audio.path);
    need(audio.record.sha256===value.voice.audio.sha256&&audio.record.bytes===value.voice.audio.bytes,'editorial_av_review_voice_changed');
    await assertCurrent();grant();server=await serveSnapshot(snapshot.serveUrl,value.bundleFiles);
    const {selectComposition,renderMedia,renderStill}=await import('@remotion/renderer');
    grant();browser=await openOwnedBrowser('chrome',{browserExecutable:value.runtime.browser.path,logLevel:'error'},grant);
    const shared={serveUrl:server.url,inputProps:value.inputProps,puppeteerInstance:browser,logLevel:'error',
      onBrowserDownload:()=>{throw editorialAvReviewError('editorial_av_review_download_forbidden');}};
    const composition=await selectComposition({...shared,id:'ConceptPreview'});
    need(composition.fps===30&&composition.width===1920&&composition.height===1080
      &&composition.durationInFrames===value.durationInFrames,'editorial_av_review_composition_changed');
    for(const clip of value.clips) {
      await assertCurrent();await verifyRuntime(value.runtime);grant();
      const silent=`${clip.id}.silent.mp4`,pcmName=`${clip.id}.wav`,partial=`${clip.id}.rendering.mp4`,video=`${clip.id}.mp4`;
      let last=-1;
      await renderMedia({...shared,composition,outputLocation:resolve(destination,silent),codec:'h264',pixelFormat:'yuv420p',
        imageFormat:'png',concurrency:1,crf:18,muted:true,overwrite:false,frameRange:[clip.fromFrame,clip.toFrameExclusive-1],
        onProgress:({progress})=>{const next=Math.floor(progress*10);if(next>last){last=next;process.stderr.write(`${clip.id}: ${Math.min(next*10,100)}%\n`);}}});
      await record(silent);
      const sliced=sliceEditorialReviewPcm(audio.bytes,clip.fromFrame,clip.toFrameExclusive,clip.startSample,clip.speechEndSample);await write(pcmName,sliced.bytes);
      grant();await runProcess(value.runtime.ffmpeg.path,['-hide_banner','-loglevel','error','-nostdin','-n','-i',resolve(destination,silent),
        '-i',resolve(destination,pcmName),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k',
        '-movflags','+faststart','-t',String((clip.toFrameExclusive-clip.fromFrame)/30),resolve(destination,partial)]);
      grant();const probe=await runProcess(value.runtime.ffprobe.path,['-v','error','-count_frames','-show_streams','-show_format','-of','json',resolve(destination,partial)]);
      const info=JSON.parse(probe.stdout);const videoStreams=info.streams.filter(stream=>stream.codec_type==='video');
      const audioStreams=info.streams.filter(stream=>stream.codec_type==='audio');const seconds=(clip.toFrameExclusive-clip.fromFrame)/30;
      need(info.streams.length===2&&videoStreams.length===1&&audioStreams.length===1&&videoStreams[0].width===1920&&videoStreams[0].height===1080
        &&Number(videoStreams[0].nb_read_frames)===clip.toFrameExclusive-clip.fromFrame&&audioStreams[0].sample_rate==='24000'
        &&audioStreams[0].channels===1&&Math.abs(Number(videoStreams[0].duration)-seconds)<=1/30
        &&Math.abs(Number(audioStreams[0].duration)-seconds)<0.1,'editorial_av_review_media_validation_failed');
      // Decode both streams completely, without changing or stretching audio.
      grant();await runProcess(value.runtime.ffmpeg.path,['-hide_banner','-loglevel','error','-xerror','-nostdin','-i',resolve(destination,partial),
        '-map','0:v:0','-map','0:a:0','-f','null','-']);
      grant();await rename(resolve(destination,partial),resolve(destination,video));
      await record(video);
      const frames=[clip.fromFrame,clip.fromFrame+Math.floor((clip.toFrameExclusive-clip.fromFrame)/2),clip.toFrameExclusive-1];
      for(const [index,frame] of frames.entries()) {
        grant();await renderStill({...shared,composition,frame,imageFormat:'png',output:resolve(destination,`${clip.id}-key-${index+1}.png`),overwrite:false});
        await record(`${clip.id}-key-${index+1}.png`);
      }
      await write(`${clip.id}-probe.json`,json(info));
      clipRecords.push({...clip,file:video,actualAudioStartSample:sliced.startSample,actualAudioEndSample:sliced.endSample,
        tailPaddingSamples:sliced.tailPaddingSamples,frameBoundaryRounding:'ceil scene / floor interior-unit start; retain speech onset with less than one frame audio lead',
        audioLeadSamples:sliced.audioLeadSamples,
        playbackRate:1,fullDecodePassed:true,keyframes:frames});
    }
    await assertCurrent();await verifyRuntime(value.runtime);grant();
    const files=await fileSet(destination);
    need(digest(files)===digest([...outputRecords.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'))),
      'editorial_av_review_output_changed');
    const manifest={schemaVersion:'editorial-av-review-candidate-v1',episodeId:request.episodeId,request,sourceHash:value.sourceHash,
      source:{scriptBindingHash:value.voice.source.scriptBindingHash,storyboardBindingHash:value.voice.source.storyboardBindingHash,
        materializationManifestSha256:value.material.manifestSha256,voiceCandidateSha256:value.voice.candidateSha256,
        voiceAudioSha256:value.voice.audio.sha256,voiceTimingSha256:value.voice.timing.sha256},
      implementationHash:value.implementationHash,implementationFiles:value.implementationFiles,runtime:value.runtime,
      originalPropsSha256:value.material.inputPropsSha256,reviewPropsSha256:sha(json(value.inputProps)),
      retimingSha256:sha(json(value.retiming)),clips:clipRecords,files,formalRender:false,visualAcceptance:false,
      episodeMutated:false,releaseEligible:false,paidCalls:0,maximumPaidCostUsd:0,
      assurance:'private-review-only; machine decode is not visual or listening acceptance'};
    await write('review-manifest.json',json(manifest));
    return {status:'review_candidate',directory,manifestPath:`${directory}/review-manifest.json`,manifestSha256:sha(json(manifest)),
      clips:clipRecords.map(clip=>({id:clip.id,path:`${directory}/${clip.file}`,durationSeconds:(clip.toFrameExclusive-clip.fromFrame)/30})),
      formalRender:false,visualAcceptance:false,episodeMutated:false,releaseEligible:false,paidCalls:0};
  } finally {
    if(browser)await browser.close({silent:true}).catch(()=>undefined);
    if(server)await server.close().catch(()=>undefined);
    if(snapshot)await snapshot.cleanup();
  }
}
