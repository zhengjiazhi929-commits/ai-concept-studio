import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectEditorialVoicePcm, verifyEditorialVoicePcmAssembly,verifyEditorialVoicePackageCore,
  createEditorialVoiceDirectory} from '../src/server/production/editorial-voice-integrity.mjs';
import {buildEditorialVoiceSpeechPlan,buildEditorialVoiceTiming,serializeEditorialVoiceSrt} from '../src/shared/editorial-voice-timing.mjs';
import {editorialMaterializationFileSet as fileSet,editorialMaterializationSha as sha,
  editorialMaterializationJson as json} from '../src/server/production/editorial-materialization-integrity.mjs';
import {mkdtemp,mkdir,writeFile,rm,realpath,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function wav(samples) {
  const data=Buffer.alloc(44+samples.length*2);
  data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);
  data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);
  data.writeUInt32LE(24000,24);data.writeUInt32LE(48000,28);data.writeUInt16LE(2,32);
  data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples.length*2,40);
  samples.forEach((value,index)=>data.writeInt16LE(value,44+index*2));return data;
}
test('PCM validation rejects silence, truncated headers, stereo and non-canonical sizes',()=>{
  assert.equal(inspectEditorialVoicePcm(wav([1000,-1000])).sampleCount,2);
  assert.throws(()=>inspectEditorialVoicePcm(wav([0,0])));
  assert.throws(()=>inspectEditorialVoicePcm(Buffer.from('RIFF')));
  const stereo=wav([1000]);stereo.writeUInt16LE(2,22);assert.throws(()=>inspectEditorialVoicePcm(stereo));
  assert.throws(()=>inspectEditorialVoicePcm(Buffer.concat([wav([1000]),Buffer.from([0])])));
});
test('full PCM must exactly equal segment bytes plus declared zero gaps',()=>{
  const segments=[{bytes:wav([1000,-1000]),pauseAfterSamples:2},{bytes:wav([2000]),pauseAfterSamples:0}];
  assert.equal(verifyEditorialVoicePcmAssembly(wav([1000,-1000,0,0,2000]),segments).sampleCount,5);
  assert.throws(()=>verifyEditorialVoicePcmAssembly(wav([1000,-1000,1,0,2000]),segments));
  assert.throws(()=>verifyEditorialVoicePcmAssembly(wav([1000,-1000,0,2000]),segments));
});
async function fixture(t) {
  const root=await realpath(await mkdtemp(join(tmpdir(),'editorial-voice-synthetic-')));
  t.after(()=>rm(root,{recursive:true,force:true}));const directory='candidate';
  await mkdir(join(root,directory,'media'),{recursive:true});
  const episode={id:'synthetic-voice',scenes:[{id:'S01',unitIds:['B01'],narration:'先理解概念，再动手做。'}]};
  const source={scriptBindingHash:'a'.repeat(64),storyboardBindingHash:'b'.repeat(64),materializationManifestSha256:'c'.repeat(64)};
  const plan=buildEditorialVoiceSpeechPlan(episode.scenes);
  const samples=Array.from({length:24000},(_,i)=>i%2===0?1000:-1000),audio=wav(samples);
  const driver={plan,model:{},runtimeLock:{fixture:true},pinnedFiles:{model:{sha256:'d'.repeat(64)},voice:{sha256:'e'.repeat(64)}}};
  const implementationHash='f'.repeat(64);
  const request={episodeId:episode.id,source,implementationHash,plan,driverRequestSha256:sha(json(driver)),
    authorization:{actor:'human:Zhengjiazhi',scope:'local-full-narration-and-caption-registration',paidApiCalls:0,render:false}};
  const timing=buildEditorialVoiceTiming(plan,[{id:'speech-0001',sampleCount:24000}]);
  const result={schemaVersion:'editorial-local-voice-result-v1',requestSha256:request.driverRequestSha256,
    planSourceTextSha256:plan.sourceTextSha256,sampleRate:24000,externalApiCalls:0,costUsd:0,runtime:driver.runtimeLock,
    voiceId:'zm_010',speed:1.1,formalVoiceRegistered:false,releaseEligible:false,
    networkGuards:['socket.connect','socket.connect_ex','socket.create_connection','socket.getaddrinfo','socket.sendto'],offlineEnvironmentVerified:true,
    segments:[{...plan.segments[0],file:'speech-0001.wav',sampleCount:24000,sha256:sha(audio),bytes:audio.length,
      phonemeCheck:{id:'speech-0001',length:20,sha256:'1'.repeat(64),missingVocabulary:[]}}],
    voice:{file:'voice.wav',sampleCount:24000,sha256:sha(audio),bytes:audio.length}};
  for(const [path,bytes] of [['request.json',json(request)],['driver-request.json',json(driver)],['media/result.json',json(result)],
    ['media/voice.wav',audio],['media/speech-0001.wav',audio],['timing.json',json(timing)],['captions.json',json(timing.captions)],
    ['captions.srt',serializeEditorialVoiceSrt(timing.captions)],['execution.json',json({fixture:true})]])await writeFile(join(root,directory,path),bytes);
  const files=await fileSet(join(root,directory));const record=path=>files.find(file=>file.path===path);
  const manifest={schemaVersion:'editorial-local-voice-candidate-v1',episodeId:episode.id,generationRequestHash:sha(json(request)),source,implementationHash,
    synthesis:{voiceId:'zm_010',speed:1.1,modelSha256:'d'.repeat(64),voiceSha256:'e'.repeat(64)},
    audio:{...record('media/voice.wav'),totalSamples:24000,durationSeconds:1,sampleRate:24000,channels:1,bitsPerSample:16},
    captions:{...record('captions.json'),count:1},timing:record('timing.json'),files,
    alignmentMethod:timing.alignmentMethod,captionAligned:true,motionAligned:false,renderReady:false,externalApiCalls:0,maximumPaidCostUsd:0,releaseEligible:false};
  await writeFile(join(root,directory,'voice-manifest.json'),json(manifest));
  return {input:{workspaceRoot:root,directory,episode,source,implementationHash},root,manifest,timing};
}
test('synthetic package verifies complete bytes and refuses changed source, captions and extra files',async t=>{
  const {input,root}=await fixture(t);
  assert.equal((await verifyEditorialVoicePackageCore(input,async()=>true)).manifest.captions.count,1);
  await assert.rejects(verifyEditorialVoicePackageCore({...input,source:{...input.source,scriptBindingHash:'0'.repeat(64)}},async()=>true));
  await assert.rejects(verifyEditorialVoicePackageCore(input,async()=>{throw new Error('pins changed');}),/pins changed/);
  await writeFile(join(root,'candidate','captions.json'),'[]');
  await assert.rejects(verifyEditorialVoicePackageCore(input,async()=>true),{code:'editorial_voice_file_set_changed'});
});
test('rehashing forged caption boundaries cannot make estimated timing pass as measured',async t=>{
  const {input,root,manifest,timing}=await fixture(t);
  const forged=structuredClone(timing.captions);forged[0].endMs=999;
  await writeFile(join(root,'candidate','captions.json'),json(forged));
  manifest.files=(await fileSet(join(root,'candidate'))).filter(file=>file.path!=='voice-manifest.json');
  manifest.captions={...manifest.files.find(file=>file.path==='captions.json'),count:1};
  await writeFile(join(root,'candidate','voice-manifest.json'),json(manifest));
  await assert.rejects(verifyEditorialVoicePackageCore(input,async()=>true),{code:'editorial_voice_captions_changed'});
});
test('safe directories reject symlink ancestors before creating descendants and reject overwrite',async t=>{
  const {root}=await fixture(t);await mkdir(join(root,'outside'));await symlink(join(root,'outside'),join(root,'redirect'));
  await assert.rejects(createEditorialVoiceDirectory(root,'redirect/must-not-create'),{code:'editorial_voice_path_unsafe'});
  assert.deepEqual(await readdir(join(root,'outside')),[]);
  await assert.rejects(createEditorialVoiceDirectory(root,'candidate',{exclusive:true}),{code:'EEXIST'});
  await assert.rejects(createEditorialVoiceDirectory(root,'../escape'));
});
