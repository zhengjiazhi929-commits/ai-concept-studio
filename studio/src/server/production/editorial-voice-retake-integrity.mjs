// Retakes preserve successful parent audio bytes; only explicit failed captions
// are synthesized again. Registration never accepts unresolved duration issues.
import {resolve} from 'node:path';
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {buildEditorialVoiceRetakePlan,buildEditorialVoiceRetakeTiming} from '../../shared/editorial-voice-retakes.mjs';
import {serializeEditorialVoiceSrt} from '../../shared/editorial-voice-timing.mjs';
import {validateEditorialVoiceRetakeRequest} from '../../shared/editorial-voice-retake-request.mjs';
import {editorialVoicePin} from './editorial-voice-inputs.mjs';
import {inspectEditorialVoicePcm,verifyEditorialVoicePcmAssembly,editorialVoiceIntegrityError} from './editorial-voice-integrity.mjs';
import {editorialMaterializationRegularFile as readRegular,editorialMaterializationFileSet as fileSet,
  editorialMaterializationSha as sha} from './editorial-materialization-integrity.mjs';

const same=(a,b)=>digest(a??null)===digest(b??null);
function need(value,code='editorial_voice_retake_integrity_changed'){if(!value)throw editorialVoiceIntegrityError(code);}
async function readJson(root,path){const file=await readRegular(root,path);need(file.bytes.length<=16*1024*1024);
  try{return {...file,value:JSON.parse(file.bytes)};}catch{throw editorialVoiceIntegrityError();}}
const record=(path,file)=>({path,bytes:file.record.bytes,sha256:file.record.sha256});
const keys=(value,expected)=>same(Object.keys(value??{}).sort(),[...expected].sort());

export async function verifyEditorialVoiceRetakePackageCore({workspaceRoot,directory,episode,source,implementationHash},{verifyInputs,verifyBase}) {
  need(typeof verifyInputs==='function' && typeof verifyBase==='function');
  const manifestFile=await readJson(workspaceRoot,`${directory}/voice-manifest.json`),m=manifestFile.value;
  need(keys(m,['schemaVersion','episodeId','generationRequestHash','source','implementationHash','synthesis','audio','captions',
    'timing','files','alignmentMethod','captionAligned','motionAligned','renderReady','externalApiCalls','maximumPaidCostUsd','releaseEligible',
    'baseCandidate','repairPlan']) && m.schemaVersion==='editorial-local-voice-retake-candidate-v1'
    && m.episodeId===episode.id && same(m.source,source) && m.implementationHash===implementationHash
    && m.alignmentMethod==='synthesis-segment-sample-boundaries-v1' && m.captionAligned===true && m.motionAligned===false
    && m.renderReady===false && m.externalApiCalls===0 && m.maximumPaidCostUsd===0 && m.releaseEligible===false);
  need(keys(m.baseCandidate,['path','sha256']) && keys(m.repairPlan,['path','bytes','sha256']));
  const initialFiles=await fileSet(resolve(workspaceRoot,directory));
  const expectedFiles=[...m.files,record('voice-manifest.json',manifestFile)].sort((a,b)=>a.path.localeCompare(b.path,'en'));
  need(same(initialFiles,expectedFiles),'editorial_voice_file_set_changed');
  const base=await verifyBase({workspaceRoot,episode,source,baseCandidatePath:m.baseCandidate.path,baseCandidateSha256:m.baseCandidate.sha256},verifyInputs);
  const baseCopy=await readRegular(workspaceRoot,`${directory}/base-candidate.json`);
  need(baseCopy.record.sha256===base.candidateSha256,'editorial_voice_base_changed');
  const repairFile=await readJson(workspaceRoot,`${directory}/repair-plan.json`),repair=repairFile.value;
  need(same(record(m.repairPlan.path,repairFile),m.repairPlan) && same(repair.baseCandidate,m.baseCandidate),'editorial_voice_repair_plan_changed');
  const plan=base.basePlan,retakePlan=buildEditorialVoiceRetakePlan(plan,base.timing,repair);
  const requestFile=await readJson(workspaceRoot,`${directory}/request.json`),request=requestFile.value;
  need(request.schemaVersion==='editorial-voice-retake-generation-request-v1' && m.generationRequestHash===sha(requestFile.bytes)
    && request.episodeId===episode.id && same(request.source,source) && request.implementationHash===implementationHash
    && same(request.plan,plan) && same(request.retakePlan,retakePlan) && same(request.baseCandidate,m.baseCandidate)
    && same(request.repairPlan,m.repairPlan),'editorial_voice_retake_request_changed');
  need(request.authorization?.actor==='human:Zhengjiazhi' && request.authorization?.scope==='local-full-narration-and-caption-registration'
    && request.authorization?.paidApiCalls===0 && request.authorization?.render===false);
  const execution=validateEditorialVoiceRetakeRequest(request.executionRequest);
  need(execution?.episodeId===episode.id && execution.baseCandidatePath===m.baseCandidate.path
    && execution.baseCandidateSha256===m.baseCandidate.sha256 && execution.repairPlanPath===m.repairPlan.path
    && execution.repairPlanSha256===m.repairPlan.sha256 && execution.implementationHash===implementationHash
    && execution.snapshotHash===request.episodeSnapshotHash && execution.sourceHash===digest(source)
    && execution.actor==='human:Zhengjiazhi' && execution.confirmEditorialVoiceRetake===true,'editorial_voice_retake_request_changed');
  const driverFile=await readJson(workspaceRoot,`${directory}/driver-request.json`),driver=driverFile.value;
  need(request.driverRequestSha256===driverFile.record.sha256 && keys(driver,['basePlan','baseTiming','repairPlan','retakePlan','baseMedia',
    'model','pinnedFiles','runtimeLock','retakeDriverPin']) && same(driver.basePlan,plan) && same(driver.baseTiming,base.timing)
    && same(driver.repairPlan,repair) && same(driver.retakePlan,retakePlan),'editorial_voice_retake_request_changed');
  need(same(driver.model,base.driverRequest.model) && same(driver.pinnedFiles,base.driverRequest.pinnedFiles)
    && same(driver.runtimeLock,base.driverRequest.runtimeLock),'editorial_voice_pinned_input_changed');
  await verifyInputs(workspaceRoot,{plan,model:driver.model,pinnedFiles:driver.pinnedFiles,runtimeLock:driver.runtimeLock});
  need(driver.retakeDriverPin?.path===resolve(workspaceRoot,'studio/scripts/retake-editorial-local-voice.py')
    && same(driver.retakeDriverPin,await editorialVoicePin(driver.retakeDriverPin.path)),'editorial_voice_pinned_input_changed');
  need(driver.baseMedia?.path===resolve(workspaceRoot,base.directory,'media') && same(driver.baseMedia.files,base.result.segments.map(segment=>({
    id:segment.id,file:segment.file,bytes:segment.bytes,sha256:segment.sha256,sampleCount:segment.sampleCount}))), 'editorial_voice_base_changed');
  need(same(m.synthesis,base.manifest.synthesis));
  const result=(await readJson(workspaceRoot,`${directory}/media/result.json`)).value;
  need(result.schemaVersion==='editorial-local-voice-retake-result-v1' && result.requestSha256===driverFile.record.sha256
    && result.planSourceTextSha256===plan.sourceTextSha256 && result.sampleRate===24000 && result.voiceId===plan.voiceId && result.speed===plan.speed
    && result.externalApiCalls===0 && result.costUsd===0 && result.formalVoiceRegistered===false && result.releaseEligible===false
    && same(result.runtime,driver.runtimeLock) && same(result.networkGuards,['socket.connect','socket.connect_ex','socket.create_connection','socket.getaddrinfo','socket.sendto'])
    && result.offlineEnvironmentVerified===true && result.segments?.length===plan.segments.length,'editorial_voice_retake_result_changed');
  const allowedFiles=['request.json','driver-request.json','execution.json','base-candidate.json','repair-plan.json','timing.json','captions.json','captions.srt',
    'media/result.json','media/voice.wav',...retakePlan.parents.flatMap(parent=>[`media/${parent.id}.wav`,...parent.parts.map(part=>`media/${part.id}.wav`)])];
  need(same(m.files.map(f=>f.path).sort(),allowedFiles.sort()),'editorial_voice_file_set_changed');
  const measurements=[],pcmSegments=[];
  for(const [index,parent] of retakePlan.parents.entries()) {
    const measured=result.segments[index];
    need(measured?.id===parent.id && measured.file===`${parent.id}.wav` && measured.mode===parent.mode
      && measured.sceneId===parent.sceneId && measured.unitId===parent.unitId && measured.text===parent.text
      && measured.textSha256===parent.textSha256 && measured.pauseAfterSamples===parent.pauseAfterSamples
      && Array.isArray(measured.parts) && measured.parts.length===parent.parts.length,'editorial_voice_segment_changed');
    const parentFile=await readRegular(workspaceRoot,`${directory}/media/${parent.id}.wav`),pcm=inspectEditorialVoicePcm(parentFile.bytes);
    need(measured.sampleCount===pcm.sampleCount && measured.sha256===parentFile.record.sha256 && measured.bytes===parentFile.record.bytes);
    const parts=[],partPcm=[];
    if(parent.mode==='reuse') {
      const bound=base.result.segments[index];
      need(parentFile.record.sha256===bound.sha256 && parentFile.record.bytes===bound.bytes
        && pcm.sampleCount===bound.sampleCount,'editorial_voice_reused_audio_changed');
      const old=await readRegular(workspaceRoot,`${base.directory}/media/${parent.id}.wav`);
      need(parentFile.bytes.equals(old.bytes),'editorial_voice_reused_audio_changed');
    } else {
      for(const [partIndex,part] of parent.parts.entries()) {
        const piece=measured.parts[partIndex];
        need(piece?.id===part.id && piece.file===`${part.id}.wav` && piece.text===part.text && piece.textSha256===part.textSha256);
        const file=await readRegular(workspaceRoot,`${directory}/media/${part.id}.wav`),info=inspectEditorialVoicePcm(file.bytes);
        need(piece.sampleCount===info.sampleCount && piece.bytes===file.record.bytes && piece.sha256===file.record.sha256);
        const phonemes=piece.phonemeCheck;
        need(phonemes?.id===part.id && Number.isSafeInteger(phonemes.length) && phonemes.length>0 && phonemes.length<=510
          && /^[a-f0-9]{64}$/u.test(phonemes.sha256??'') && same(phonemes.missingVocabulary,[]),'editorial_voice_phoneme_evidence_invalid');
        parts.push({id:part.id,sampleCount:info.sampleCount});partPcm.push({bytes:file.bytes,pauseAfterSamples:0});
      }
      verifyEditorialVoicePcmAssembly(parentFile.bytes,partPcm);
    }
    measurements.push({id:parent.id,sampleCount:pcm.sampleCount,parts});pcmSegments.push({bytes:parentFile.bytes,pauseAfterSamples:parent.pauseAfterSamples});
  }
  const timing=buildEditorialVoiceRetakeTiming(plan,repair,measurements);
  need(timing.captionDurationIssues.length===0,'editorial_voice_caption_duration_requires_revision');
  const timingFile=await readJson(workspaceRoot,`${directory}/timing.json`),captionsFile=await readJson(workspaceRoot,`${directory}/captions.json`);
  const srt=await readRegular(workspaceRoot,`${directory}/captions.srt`);
  need(same(timingFile.value,timing) && same(captionsFile.value,timing.captions)
    && srt.bytes.toString('utf8')===serializeEditorialVoiceSrt(timing.captions),'editorial_voice_captions_changed');
  const voiceFile=await readRegular(workspaceRoot,`${directory}/media/voice.wav`),voice=verifyEditorialVoicePcmAssembly(voiceFile.bytes,pcmSegments);
  need(voice.sampleCount===timing.totalSamples && result.voice?.file==='voice.wav' && result.voice.sampleCount===timing.totalSamples
    && result.voice.sha256===voiceFile.record.sha256 && result.voice.bytes===voiceFile.record.bytes);
  need(same(m.audio,{...record('media/voice.wav',voiceFile),totalSamples:timing.totalSamples,durationSeconds:timing.durationSeconds,sampleRate:24000,channels:1,bitsPerSample:16})
    && same(m.captions,{...record('captions.json',captionsFile),count:timing.captions.length}) && same(m.timing,record('timing.json',timingFile)));
  need(same(await fileSet(resolve(workspaceRoot,directory)),initialFiles),'editorial_voice_file_set_changed');
  const finalBase=await readRegular(workspaceRoot,m.baseCandidate.path);
  need(finalBase.record.sha256===base.candidateSha256,'editorial_voice_base_changed');
  need(same(await fileSet(resolve(workspaceRoot,base.directory)),base.files),'editorial_voice_base_changed');
  return {candidateSha256:manifestFile.record.sha256,source,implementationHash,manifest:m,directory,files:initialFiles};
}
