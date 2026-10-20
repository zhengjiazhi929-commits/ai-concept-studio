// Only creates an unregistered, immutable local candidate. No Episode writes.
import {writeFile,readFile,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {buildEditorialVoiceSpeechPlan,buildEditorialVoiceTiming,serializeEditorialVoiceSrt} from '../../shared/editorial-voice-timing.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';
import {assertEditorialFirstVoiceRegistration} from '../control/editorial-voice-transition.mjs';
import {editorialVoicePin,verifyEditorialVoiceInputs} from './editorial-voice-inputs.mjs';
import {loadEditorialVoiceSource,editorialVoiceImplementation,inspectEditorialVoicePcm,
  verifyEditorialVoicePcmAssembly,editorialVoiceIntegrityError} from './editorial-voice-integrity.mjs';
import {createEditorialVoiceDirectory} from './editorial-voice-integrity.mjs';
import {editorialMaterializationRegularFile as readRegular,editorialMaterializationFileSet as fileSet,
  editorialMaterializationSha as sha,editorialMaterializationJson as json} from './editorial-materialization-integrity.mjs';

const same=(a,b)=>digest(a??null)===digest(b??null);
function requireValue(value,code) {if(!value) throw editorialVoiceIntegrityError(code);}
function inputValid(input) {
  requireValue(input && same(Object.keys(input).sort(),['episodeId','auditionRequestPath','selectionPath'].sort())
    && /^[a-z0-9][a-z0-9-]{0,99}$/u.test(input.episodeId));
  for(const key of ['auditionRequestPath','selectionPath']) requireValue(typeof input[key]==='string'
    && input[key].startsWith('outputs/') && input[key].endsWith('.json'));
}
export async function previewEditorialVoiceGeneration({workspaceRoot,episode,reviewConfig,input}) {
  inputValid(input);requireValue(input.episodeId===episode.id && !episode.production?.editorialVoice);
  assertEditorialFirstVoiceRegistration(episode);
  const root=await realpath(resolve(workspaceRoot));
  const source=await loadEditorialVoiceSource({workspaceRoot:root,episode,reviewConfig});
  const auditionFile=await readRegular(root,input.auditionRequestPath);
  const selectionFile=await readRegular(root,input.selectionPath);
  const audition=JSON.parse(auditionFile.bytes),selection=JSON.parse(selectionFile.bytes);
  requireValue(selection.episodeId===episode.id && selection.actor==='Zhengjiazhi' && selection.voiceId==='zm_010'
    && selection.synthesisSpeed===1.1 && selection.kind==='audition-preference-selection'
    && selection.candidateRequestSha256===auditionFile.record.sha256 && audition.episodeId===episode.id
    && audition.source.bindingHash===source.scriptBindingHash,'editorial_voice_selection_changed');
  const selectedAudio=await readRegular(root,selection.audioPath);
  requireValue(selectedAudio.record.sha256===selection.audioSha256 && selectedAudio.record.bytes===selection.audioBytes);
  const pins=structuredClone(audition.pinnedFiles);
  for(const [key,path] of Object.entries({generator:'studio/scripts/generate-agent-skill-local-tts.py',
    driver:'studio/scripts/generate-editorial-local-voice.py',runtimeLock:'studio/config/local-tts-python-runtime.lock.json'})) {
    pins[key]=await editorialVoicePin(resolve(root,path));
  }
  const plan=buildEditorialVoiceSpeechPlan(episode.scenes);
  const driverRequest={plan,model:audition.model,pinnedFiles:pins,runtimeLock:audition.runtimeLock};
  await verifyEditorialVoiceInputs(root,driverRequest);
  const implementationHash=(await editorialVoiceImplementation(root)).sha256;
  const request={schemaVersion:'editorial-voice-generation-request-v1',episodeId:episode.id,source,implementationHash,plan,
    episodeSnapshotHash:digest(episode),driverRequestSha256:sha(json(driverRequest)),
    selection:{request:auditionFile.record,selection:selectionFile.record,audio:selectedAudio.record},
    authorization:{actor:'human:Zhengjiazhi',scope:'local-full-narration-and-caption-registration',
      paidApiCalls:0,render:false,assetsVoiceAccepted:false,release:false}};
  const generationRequestHash=sha(json(request));
  return {input:structuredClone(input),request,driverRequest,generationRequestHash,source,implementationHash,
    directory:`outputs/studio/${episode.id}/editorial-voice-candidates/${generationRequestHash}`};
}
export function editorialVoiceGenerationCapabilitySpec(preview) {
  requireValue(/^[a-f0-9]{64}$/u.test(preview?.generationRequestHash??''));
  return {episodeId:`editorial-voice-generation/${preview.generationRequestHash}`,operation:'voice:generate-editorial',
    scopes:['filesystem.write','local-inference'],maxCalls:0,maxCostUsd:0};
}
async function runEditorialVoiceDriver({workspaceRoot,directory,driverRequest,driverRequestSha256,onProgress,sideEffectGrant,preview}) {
  const root=resolve(workspaceRoot),pins=driverRequest.pinnedFiles;
  await verifyEditorialVoiceInputs(root,driverRequest);
  const requestFile=await readRegular(root,`${directory}/driver-request.json`);
  requireValue(requestFile.record.sha256===driverRequestSha256);
  requireSideEffectGrant({sideEffectGrant},editorialVoiceGenerationCapabilitySpec(preview),'voice:generate-editorial');
  return new Promise((resolvePromise,reject)=>{
    const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,
      PYTHONDONTWRITEBYTECODE:'1',PYTHONNOUSERSITE:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_DATASETS_OFFLINE:'1',
      TOKENIZERS_PARALLELISM:'false',PYTORCH_ENABLE_MPS_FALLBACK:'1'};
    const child=spawn(pins.python.path,[pins.driver.path,'--request',resolve(root,directory,'driver-request.json'),
      '--request-sha256',driverRequestSha256,'--output',resolve(root,directory,'media')],
    {cwd:root,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),30*60*1000);
    child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>2*1024*1024)child.kill('SIGKILL');onProgress?.(chunk.toString());});
    child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>2*1024*1024)child.kill('SIGKILL');});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolvePromise({stdout,stderr});
      else reject(Object.assign(editorialVoiceIntegrityError('editorial_voice_synthesis_failed'),{exitCode:code,diagnostic:stderr.slice(-4000)}));});
  });
}
export async function generateEditorialVoiceCandidate({workspaceRoot,preview,sideEffectGrant,readCurrent,onProgress}) {
  // readCurrent is a core test seam, not exposed by the production CLI.
  requireValue(typeof readCurrent==='function');
  const root=await realpath(resolve(workspaceRoot));
  const current=await readCurrent();
  const before=await previewEditorialVoiceGeneration({workspaceRoot:root,...current,input:preview.input});
  requireValue(same(before,preview),'editorial_voice_generation_snapshot_changed');
  const spec=editorialVoiceGenerationCapabilitySpec(preview);
  const grant=requireSideEffectGrant({sideEffectGrant},spec,'voice:generate-editorial');
  requireValue(grant.maxCalls===0&&grant.maxCostUsd===0&&same([...grant.scopes].sort(),['filesystem.write','local-inference']));
  const directory=preview.directory,absolute=resolve(root,directory);
  const write=async(path,bytes)=>{
    requireSideEffectGrant({sideEffectGrant},spec,'voice:generate-editorial');
    await writeFile(resolve(absolute,path),bytes,{flag:'wx'});
  };
  await createEditorialVoiceDirectory(root,directory,{exclusive:true});
  requireSideEffectGrant({sideEffectGrant},spec,'voice:generate-editorial');
  await createEditorialVoiceDirectory(root,`${directory}/media`,{exclusive:true});
  await write('request.json',json(preview.request));
  await write('driver-request.json',json(preview.driverRequest));
  const log=await runEditorialVoiceDriver({workspaceRoot:root,directory,driverRequest:preview.driverRequest,
    driverRequestSha256:preview.request.driverRequestSha256,onProgress,sideEffectGrant,preview});
  await write('execution.json',json(log));
  const result=JSON.parse(await readFile(resolve(absolute,'media/result.json'),'utf8'));
  const plan=preview.request.plan;
  requireValue(result.segments?.length===plan.segments.length);
  const measured=[],pieces=[];
  for(const [index,segment] of plan.segments.entries()) {
    const output=result.segments[index];requireValue(output.id===segment.id && output.file===`${segment.id}.wav`);
    const read=await readRegular(root,`${directory}/media/${output.file}`);
    const info=inspectEditorialVoicePcm(read.bytes);
    requireValue(output.sampleCount===info.sampleCount && output.sha256===read.record.sha256);
    measured.push({id:segment.id,sampleCount:info.sampleCount});pieces.push({bytes:read.bytes,pauseAfterSamples:segment.pauseAfterSamples});
  }
  const voiceFile=await readRegular(root,`${directory}/media/voice.wav`);
  const pcm=verifyEditorialVoicePcmAssembly(voiceFile.bytes,pieces);
  const timing=buildEditorialVoiceTiming(plan,measured);requireValue(pcm.sampleCount===timing.totalSamples);
  for(const [path,bytes] of [['timing.json',json(timing)],['captions.json',json(timing.captions)],['captions.srt',serializeEditorialVoiceSrt(timing.captions)]])
    await write(path,bytes);
  const files=await fileSet(absolute),record=path=>files.find(file=>file.path===path);
  const manifest={schemaVersion:'editorial-local-voice-candidate-v1',episodeId:preview.request.episodeId,
    generationRequestHash:preview.generationRequestHash,source:preview.source,implementationHash:preview.implementationHash,
    synthesis:{voiceId:plan.voiceId,speed:plan.speed,modelSha256:preview.driverRequest.pinnedFiles.model.sha256,
      voiceSha256:preview.driverRequest.pinnedFiles.voice.sha256},
    audio:{...record('media/voice.wav'),totalSamples:timing.totalSamples,durationSeconds:timing.durationSeconds,sampleRate:24000,channels:1,bitsPerSample:16},
    captions:{...record('captions.json'),count:timing.captions.length},timing:record('timing.json'),files,
    alignmentMethod:timing.alignmentMethod,captionAligned:true,motionAligned:false,renderReady:false,externalApiCalls:0,maximumPaidCostUsd:0,releaseEligible:false};
  const after=await previewEditorialVoiceGeneration({workspaceRoot:root,...await readCurrent(),input:preview.input});
  requireValue(same(after,preview),'editorial_voice_generation_snapshot_changed');
  await verifyEditorialVoiceInputs(root,preview.driverRequest);
  requireSideEffectGrant({sideEffectGrant},spec,'voice:generate-editorial');
  await write('voice-manifest.json',json(manifest));
  return {candidatePath:`${directory}/voice-manifest.json`,candidateSha256:sha(json(manifest)),
    durationSeconds:timing.durationSeconds,captionCount:timing.captions.length,captionDurationIssues:timing.captionDurationIssues,
    registered:false,rendered:false};
}
