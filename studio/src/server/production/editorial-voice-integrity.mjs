// A measured audio/caption package. It deliberately does not retime approved motion.
import {mkdir, writeFile, realpath, lstat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {buildEditorialVoiceSpeechPlan, buildEditorialVoiceTiming, serializeEditorialVoiceSrt} from '../../shared/editorial-voice-timing.mjs';
import {validateEditorialVoiceReceipt} from '../../shared/editorial-voice-contract.mjs';
import {editorialVoiceRegisterCapabilitySpec} from '../../shared/editorial-voice-register-request.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';
import {loadApprovedScriptBinding} from './approved-script-binding.mjs';
import {loadApprovedStoryboardBinding} from './approved-storyboard-binding.mjs';
import {verifyRegisteredEditorialMaterialization} from './editorial-materialization-consumption.mjs';
import {verifyEditorialVoiceInputs} from './editorial-voice-inputs.mjs';
import {verifyEditorialVoiceRetakePackageCore} from './editorial-voice-retake-integrity.mjs';
import {editorialMaterializationSha as sha, editorialMaterializationJson as json,
  editorialMaterializationRegularFile as readRegular, editorialMaterializationFileSet as fileSet} from './editorial-materialization-integrity.mjs';

export const EDITORIAL_VOICE_IMPLEMENTATION_PATHS=Object.freeze([
  'studio/src/shared/editorial-voice-timing.mjs', 'studio/src/shared/editorial-voice-contract.mjs',
  'studio/src/shared/editorial-voice-register-request.mjs', 'studio/src/server/control/editorial-voice-transition.mjs',
  'studio/src/server/production/editorial-voice-core.mjs', 'studio/src/server/production/editorial-voice.mjs',
  'studio/src/server/production/editorial-voice-integrity.mjs', 'studio/src/server/production/editorial-voice-generation.mjs',
  'studio/src/server/production/editorial-voice-inputs.mjs',
  'studio/src/shared/editorial-voice-retakes.mjs', 'studio/src/shared/editorial-voice-retake-request.mjs',
  'studio/src/server/production/editorial-voice-retake-integrity.mjs',
  'studio/src/server/production/editorial-voice-retake-core.mjs', 'studio/src/server/production/editorial-voice-retake.mjs',
  'studio/src/server/production/editorial-voice-retake-generation.mjs',
  'studio/scripts/retake-editorial-local-voice.py', 'studio/scripts/retake-editorial-voice.mjs',
  'studio/src/server/production/subtitle-segmentation.mjs', 'studio/scripts/generate-editorial-local-voice.py',
  'studio/scripts/generate-agent-skill-local-tts.py', 'studio/scripts/generate-editorial-voice.mjs',
  'studio/scripts/register-editorial-voice.mjs', 'studio/config/local-tts-python-runtime.lock.json',
  'studio/src/video/agent-skill-local-tts-plan.mjs'
].sort());
export function editorialVoiceIntegrityError(code='editorial_voice_integrity_changed') {
  return Object.assign(new Error('完整旁白、实测字幕或批准来源校验失败'),{code,statusCode:409});
}
function requireValue(value,code) {if(!value) throw editorialVoiceIntegrityError(code);}
const same=(a,b)=>digest(a??null)===digest(b??null);
export async function createEditorialVoiceDirectory(root,path,{exclusive=false}={}) {
  requireValue(typeof path==='string' && /^[A-Za-z0-9_./-]+$/u.test(path) && !path.startsWith('/')
    && path.split('/').every(part=>part && part!=='.' && part!=='..'),'editorial_voice_path_unsafe');
  let current=await realpath(root);
  const parts=path.split('/');
  for(const [index,part] of parts.entries()) {
    requireValue(await realpath(current)===current,'editorial_voice_path_unsafe');
    current=resolve(current,part);
    try {await mkdir(current);} catch(error) {
      if(error.code!=='EEXIST' || (exclusive && index===parts.length-1)) throw error;
    }
    const info=await lstat(current);
    requireValue(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(current)===current,'editorial_voice_path_unsafe');
  }
  return current;
}
export async function editorialVoiceImplementation(workspaceRoot) {
  const files=[];
  for(const path of EDITORIAL_VOICE_IMPLEMENTATION_PATHS) files.push((await readRegular(workspaceRoot,path)).record);
  return {files,sha256:digest(files)};
}
export async function loadEditorialVoiceSource({workspaceRoot,episode,reviewConfig}) {
  const script=await loadApprovedScriptBinding({workspaceRoot,episode,reviewConfig});
  const storyboard=await loadApprovedStoryboardBinding({workspaceRoot,episode,reviewConfig});
  const materials=await verifyRegisteredEditorialMaterialization({workspaceRoot,episode});
  return {scriptBindingHash:script.bindingHash,storyboardBindingHash:storyboard.bindingHash,
    materializationManifestSha256:materials.receipt.manifestSha256};
}

export function inspectEditorialVoicePcm(bytes) {
  requireValue(Buffer.isBuffer(bytes)&&bytes.length>44,'editorial_voice_pcm_invalid');
  requireValue(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,16)==='WAVEfmt '
    && bytes.readUInt32LE(4)===bytes.length-8 && bytes.readUInt32LE(16)===16
    && bytes.readUInt16LE(20)===1 && bytes.readUInt16LE(22)===1 && bytes.readUInt32LE(24)===24000
    && bytes.readUInt32LE(28)===48000 && bytes.readUInt16LE(32)===2 && bytes.readUInt16LE(34)===16
    && bytes.toString('ascii',36,40)==='data' && bytes.readUInt32LE(40)===bytes.length-44
    && (bytes.length-44)%2===0,'editorial_voice_pcm_invalid');
  const sampleCount=(bytes.length-44)/2;let squared=0,peak=0,clipped=0;
  for(let offset=44;offset<bytes.length;offset+=2) {
    const sample=Math.abs(bytes.readInt16LE(offset));squared+=sample*sample;peak=Math.max(peak,sample);
    if(sample>=32767) clipped++;
  }
  const rms=Math.sqrt(squared/sampleCount)/32768;
  requireValue(rms>0.001 && clipped/sampleCount<0.01,'editorial_voice_pcm_silent_or_clipped');
  return {sampleCount,sampleRate:24000,channels:1,bitsPerSample:16,durationSeconds:sampleCount/24000,
    rms,peak:peak/32768,clippedFraction:clipped/sampleCount};
}
export function verifyEditorialVoicePcmAssembly(fullBytes,segments) {
  const full=inspectEditorialVoicePcm(fullBytes);const chunks=[];
  for(const segment of segments) {
    inspectEditorialVoicePcm(segment.bytes);
    requireValue(Number.isSafeInteger(segment.pauseAfterSamples)&&segment.pauseAfterSamples>=0&&segment.pauseAfterSamples<=4800);
    chunks.push(segment.bytes.subarray(44),Buffer.alloc(segment.pauseAfterSamples*2));
  }
  requireValue(Buffer.concat(chunks).equals(fullBytes.subarray(44)),'editorial_voice_pcm_assembly_changed');return full;
}
async function readJson(root,path) {
  const file=await readRegular(root,path);requireValue(file.bytes.length<=16*1024*1024);
  try{return {...file,value:JSON.parse(file.bytes)};}catch{throw editorialVoiceIntegrityError();}
}
const relativeRecord=(path,record)=>({path,sha256:record.sha256,bytes:record.bytes});

// Verifies all bytes twice, exact transcript coverage and actual sample boundaries.
// Input data is not trusted merely because the manifest contains plausible hashes.
async function verifyOriginalPackageCore({workspaceRoot,directory,episode,source,implementationHash},verifyInputs,{historicalBase=false}={}) {
  requireValue(typeof verifyInputs==='function');
  const manifestFile=await readJson(workspaceRoot,`${directory}/voice-manifest.json`);
  const manifest=manifestFile.value;
  const expectedKeys=['schemaVersion','episodeId','generationRequestHash','source','implementationHash','synthesis','audio',
    'captions','timing','files','alignmentMethod','captionAligned','motionAligned','renderReady','externalApiCalls','maximumPaidCostUsd','releaseEligible'];
  requireValue(same(Object.keys(manifest).sort(),expectedKeys.sort()) && manifest.schemaVersion==='editorial-local-voice-candidate-v1'
    && manifest.episodeId===episode.id && same(manifest.source,source) && manifest.implementationHash===implementationHash
    && manifest.alignmentMethod==='synthesis-segment-sample-boundaries-v1' && manifest.captionAligned===true
    && manifest.motionAligned===false && manifest.renderReady===false && manifest.externalApiCalls===0
    && manifest.maximumPaidCostUsd===0 && manifest.releaseEligible===false);
  const initialFiles=await fileSet(resolve(workspaceRoot,directory));
  const expectedFiles=[...manifest.files,{path:'voice-manifest.json',bytes:manifestFile.record.bytes,sha256:manifestFile.record.sha256}]
    .sort((a,b)=>a.path.localeCompare(b.path,'en'));
  requireValue(same(initialFiles,expectedFiles),'editorial_voice_file_set_changed');
  const requestFile=await readJson(workspaceRoot,`${directory}/request.json`);
  const request=requestFile.value;
  requireValue(manifest.generationRequestHash===sha(requestFile.bytes) && same(request.source,source)
    && request.implementationHash===implementationHash && request.episodeId===episode.id);
  const plan=buildEditorialVoiceSpeechPlan(episode.scenes,{voiceId:manifest.synthesis.voiceId,speed:manifest.synthesis.speed});
  requireValue(same(request.plan,plan),'editorial_voice_transcript_changed');
  requireValue(request.authorization?.actor==='human:Zhengjiazhi' && request.authorization?.scope==='local-full-narration-and-caption-registration'
    && request.authorization?.paidApiCalls===0 && request.authorization?.render===false);
  const result=(await readJson(workspaceRoot,`${directory}/media/result.json`)).value;
  const driverFile=await readJson(workspaceRoot,`${directory}/driver-request.json`);
  const driver=driverFile.value;
  requireValue(request.driverRequestSha256===driverFile.record.sha256 && same(driver.plan,plan));
  await verifyInputs(workspaceRoot,driver);
  requireValue(same(manifest.synthesis,{voiceId:plan.voiceId,speed:plan.speed,
    modelSha256:driver.pinnedFiles.model.sha256,voiceSha256:driver.pinnedFiles.voice.sha256}));
  requireValue(result.schemaVersion==='editorial-local-voice-result-v1' && result.requestSha256===driverFile.record.sha256
    && result.planSourceTextSha256===plan.sourceTextSha256 && result.sampleRate===24000 && result.externalApiCalls===0 && result.costUsd===0
    && result.voiceId===plan.voiceId && result.speed===plan.speed && result.releaseEligible===false
    && result.formalVoiceRegistered===false && result.segments?.length===plan.segments.length);
  requireValue(same(result.runtime,driver.runtimeLock),'editorial_voice_runtime_changed');
  requireValue(same(result.networkGuards,['socket.connect','socket.connect_ex','socket.create_connection','socket.getaddrinfo','socket.sendto'])
    && result.offlineEnvironmentVerified===true,'editorial_voice_network_guard_failed');
  const allowedFiles=['request.json','driver-request.json','execution.json','timing.json','captions.json','captions.srt',
    'media/result.json','media/voice.wav',...plan.segments.map(segment=>`media/${segment.id}.wav`)];
  requireValue(same(manifest.files.map(file=>file.path).sort(),allowedFiles.sort()),'editorial_voice_file_set_changed');
  const measurements=[];const pcmSegments=[];
  for(let index=0;index<plan.segments.length;index++) {
    const segment=plan.segments[index],measured=result.segments[index];
    requireValue(measured.id===segment.id && measured.text===segment.text && measured.textSha256===segment.textSha256
      && measured.sceneId===segment.sceneId && measured.unitId===segment.unitId && measured.pauseAfterSamples===segment.pauseAfterSamples
      && measured.file===`${segment.id}.wav`,'editorial_voice_segment_changed');
    const phonemes=measured.phonemeCheck;
    requireValue(phonemes?.id===segment.id && Number.isSafeInteger(phonemes.length) && phonemes.length>0 && phonemes.length<=510
      && /^[a-f0-9]{64}$/u.test(phonemes.sha256??'') && same(phonemes.missingVocabulary,[]),'editorial_voice_phoneme_evidence_invalid');
    const file=await readRegular(workspaceRoot,`${directory}/media/${measured.file}`);
    const pcm=inspectEditorialVoicePcm(file.bytes);
    requireValue(measured.sampleCount===pcm.sampleCount && measured.sha256===file.record.sha256 && measured.bytes===file.record.bytes);
    measurements.push({id:segment.id,sampleCount:pcm.sampleCount});
    pcmSegments.push({bytes:file.bytes,pauseAfterSamples:segment.pauseAfterSamples});
  }
  const timing=buildEditorialVoiceTiming(plan,measurements);
  requireValue(historicalBase || timing.captionDurationIssues.length===0,'editorial_voice_caption_duration_requires_revision');
  const timingFile=await readJson(workspaceRoot,`${directory}/timing.json`);
  const captionsFile=await readJson(workspaceRoot,`${directory}/captions.json`);
  const srtFile=await readRegular(workspaceRoot,`${directory}/captions.srt`);
  requireValue(same(timingFile.value,timing) && same(captionsFile.value,timing.captions)
    && srtFile.bytes.toString('utf8')===serializeEditorialVoiceSrt(timing.captions),'editorial_voice_captions_changed');
  const voiceFile=await readRegular(workspaceRoot,`${directory}/media/voice.wav`);
  const pcm=verifyEditorialVoicePcmAssembly(voiceFile.bytes,pcmSegments);
  requireValue(pcm.sampleCount===timing.totalSamples && result.voice?.sampleCount===timing.totalSamples
    && result.voice?.file==='voice.wav' && result.voice.sha256===voiceFile.record.sha256 && result.voice.bytes===voiceFile.record.bytes);
  const audio={...relativeRecord('media/voice.wav',voiceFile.record),totalSamples:timing.totalSamples,
    durationSeconds:timing.durationSeconds,sampleRate:24000,channels:1,bitsPerSample:16};
  requireValue(same(manifest.audio,audio) && same(manifest.captions,{...relativeRecord('captions.json',captionsFile.record),count:timing.captions.length})
    && same(manifest.timing,relativeRecord('timing.json',timingFile.record)));
  requireValue(same(await fileSet(resolve(workspaceRoot,directory)),initialFiles),'editorial_voice_file_set_changed');
  const candidate={candidateSha256:manifestFile.record.sha256,source,implementationHash,manifest,directory,files:initialFiles};
  return historicalBase ? {...candidate,basePlan:plan,timing,driverRequest:driver,result} : candidate;
}
export async function verifyEditorialVoicePackageCore(input,verifyInputs) {
  const manifest=(await readJson(input.workspaceRoot,`${input.directory}/voice-manifest.json`)).value;
  if(manifest.schemaVersion==='editorial-local-voice-retake-candidate-v1') {
    return verifyEditorialVoiceRetakePackageCore(input,{verifyInputs,verifyBase:verifyEditorialVoiceRetakeBaseCore});
  }
  return verifyOriginalPackageCore(input,verifyInputs);
}
// Read-only historical input verification. This never grants registration permission:
// duration issues are retained, and the caller must bind the historical manifest SHA.
export async function verifyEditorialVoiceRetakeBaseCore({workspaceRoot,episode,source,baseCandidatePath,baseCandidateSha256},verifyInputs) {
  const prefix=`outputs/studio/${episode.id}/editorial-voice-candidates/`;
  requireValue(typeof baseCandidatePath==='string' && baseCandidatePath.startsWith(prefix)
    && /^[a-f0-9]{64}\/voice-manifest\.json$/u.test(baseCandidatePath.slice(prefix.length))
    && /^[a-f0-9]{64}$/u.test(baseCandidateSha256??''),'editorial_voice_candidate_path_invalid');
  const file=await readJson(workspaceRoot,baseCandidatePath);
  requireValue(file.record.sha256===baseCandidateSha256,'editorial_voice_base_changed');
  const candidate=await verifyOriginalPackageCore({workspaceRoot,directory:dirname(baseCandidatePath),episode,source,
    implementationHash:file.value.implementationHash},verifyInputs,{historicalBase:true});
  requireValue(candidate.candidateSha256===baseCandidateSha256 && candidate.manifest.schemaVersion==='editorial-local-voice-candidate-v1'
    && dirname(baseCandidatePath)===`${prefix}${candidate.manifest.generationRequestHash}`,'editorial_voice_base_changed');
  return candidate;
}
export async function inspectEditorialVoiceRetakeBase({workspaceRoot,episode,reviewConfig,baseCandidatePath,baseCandidateSha256}) {
  const root=await realpath(resolve(workspaceRoot));
  const source=await loadEditorialVoiceSource({workspaceRoot:root,episode,reviewConfig});
  const base=await verifyEditorialVoiceRetakeBaseCore({workspaceRoot:root,episode,source,baseCandidatePath,baseCandidateSha256},verifyEditorialVoiceInputs);
  return {...base,implementationHash:(await editorialVoiceImplementation(root)).sha256};
}
export async function verifyEditorialVoicePackage(input) {
  if(arguments.length!==1)throw new TypeError('Voice package verification does not accept overrides');
  return verifyEditorialVoicePackageCore(input,verifyEditorialVoiceInputs);
}
export async function inspectEditorialVoiceCandidate({workspaceRoot,episode,reviewConfig,candidatePath}) {
  const root=await realpath(resolve(workspaceRoot));
  const prefix=`outputs/studio/${episode.id}/editorial-voice-candidates/`;
  requireValue(typeof candidatePath==='string' && candidatePath.startsWith(prefix)
    && /^[a-f0-9]{64}\/voice-manifest\.json$/u.test(candidatePath.slice(prefix.length)),'editorial_voice_candidate_path_invalid');
  const source=await loadEditorialVoiceSource({workspaceRoot:root,episode,reviewConfig});
  const implementationHash=(await editorialVoiceImplementation(root)).sha256;
  const candidate=await verifyEditorialVoicePackage({workspaceRoot:root,directory:dirname(candidatePath),episode,source,implementationHash});
  requireValue(dirname(candidatePath)===`${prefix}${candidate.manifest.generationRequestHash}`);
  return candidate;
}
function receiptFor({episode,candidate,request,registeredAt}) {
  const bundlePath=`studio/public/episodes/${episode.id}/editorial-voice/${candidate.candidateSha256}`;
  const record=field=>({...candidate.manifest[field],path:`${bundlePath}/${candidate.manifest[field].path}`});
  const audio=record('audio');audio.publicPath=audio.path.slice('studio/public/'.length);
  const manifest=candidate.files.find(file=>file.path==='voice-manifest.json');
  return validateEditorialVoiceReceipt({schemaVersion:'editorial-voice-receipt-v1',episodeId:episode.id,version:1,
    operationId:digest(request),request,candidateSha256:candidate.candidateSha256,bundlePath,
    manifest:{...manifest,path:`${bundlePath}/voice-manifest.json`},audio,captions:record('captions'),timing:record('timing'),
    source:candidate.source,synthesis:candidate.manifest.synthesis,captionAligned:true,
    alignmentMethod:'synthesis-segment-sample-boundaries-v1',motionAligned:false,renderReady:false,
    externalApiCalls:0,maximumPaidCostUsd:0,registeredAt});
}
export async function materializeEditorialVoiceCandidate({workspaceRoot,episode,candidate,request,sideEffectGrant}) {
  const root=await realpath(resolve(workspaceRoot));
  const checked=await verifyEditorialVoicePackage({workspaceRoot:root,directory:candidate.directory,episode,
    source:candidate.source,implementationHash:candidate.implementationHash});
  requireValue(same(checked,candidate),'editorial_voice_candidate_changed');
  const receipt=receiptFor({episode,candidate,request,registeredAt:new Date().toISOString()});
  const spec=editorialVoiceRegisterCapabilitySpec(request);
  requireSideEffectGrant({sideEffectGrant},spec,'voice:register-editorial');
  await createEditorialVoiceDirectory(root,receipt.bundlePath);
  // Recover an interrupted pre-CAS copy only when every existing byte is identical.
  const existing=await fileSet(resolve(root,receipt.bundlePath));
  requireValue(existing.every(file=>candidate.files.some(expected=>same(file,expected))),'editorial_voice_output_conflict');
  for(const file of candidate.files) {
    const read=await readRegular(root,`${candidate.directory}/${file.path}`);
    requireValue(same(relativeRecord(file.path,read.record),file));
    requireSideEffectGrant({sideEffectGrant},spec,'voice:register-editorial');
    const destination=resolve(root,receipt.bundlePath,file.path);
    await createEditorialVoiceDirectory(root,dirname(`${receipt.bundlePath}/${file.path}`));
    requireValue(await realpath(dirname(destination))===dirname(destination),'editorial_voice_path_unsafe');
    try {await writeFile(destination,read.bytes,{flag:'wx'});} catch(error) {
      if(error.code!=='EEXIST')throw error;
      requireValue((await readRegular(root,`${receipt.bundlePath}/${file.path}`)).bytes.equals(read.bytes),'editorial_voice_output_conflict');
    }
  }
  await verifyEditorialVoicePackage({workspaceRoot:root,directory:receipt.bundlePath,episode,source:candidate.source,
    implementationHash:candidate.implementationHash});
  return receipt;
}
export async function verifyRegisteredEditorialVoice({workspaceRoot,episode,receipt,reviewConfig}) {
  const checked=validateEditorialVoiceReceipt(receipt);
  const source=await loadEditorialVoiceSource({workspaceRoot,episode,reviewConfig});
  const implementationHash=(await editorialVoiceImplementation(workspaceRoot)).sha256;
  const candidate=await verifyEditorialVoicePackage({workspaceRoot,directory:checked.bundlePath,episode,source,implementationHash});
  requireValue(same(checked,receiptFor({episode,candidate,request:checked.request,registeredAt:checked.registeredAt})));
  return checked;
}
