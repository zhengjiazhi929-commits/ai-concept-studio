import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonicalJsonDocumentContentSha256 as digest} from '../src/shared/durable-json-store.mjs';
import {buildEditorialVoiceSpeechPlan, buildEditorialVoiceTiming, serializeEditorialVoiceSrt} from '../src/shared/editorial-voice-timing.mjs';
import {buildEditorialVoiceRetakePlan, buildEditorialVoiceRetakeTiming} from '../src/shared/editorial-voice-retakes.mjs';
import {verifyEditorialVoicePackageCore, verifyEditorialVoiceRetakeBaseCore} from '../src/server/production/editorial-voice-integrity.mjs';
import {editorialVoicePin} from '../src/server/production/editorial-voice-inputs.mjs';
import {editorialMaterializationFileSet as fileSet, editorialMaterializationSha as sha,
  editorialMaterializationJson as json} from '../src/server/production/editorial-materialization-integrity.mjs';

const rate = 24000;
const networkGuards = ['socket.connect', 'socket.connect_ex', 'socket.create_connection', 'socket.getaddrinfo', 'socket.sendto'];
const authorization = {actor: 'human:Zhengjiazhi', scope: 'local-full-narration-and-caption-registration', paidApiCalls: 0, render: false};
function wavFromPcm(pcm) {
  const buffer = Buffer.alloc(44 + pcm.length);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(pcm.length, 40); pcm.copy(buffer, 44);
  return buffer;
}
function wav(samples, amplitude = 1000) {
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(i % 2 ? -amplitude : amplitude, i * 2);
  return wavFromPcm(pcm);
}
const combine = rows => wavFromPcm(Buffer.concat(rows.flatMap(row => [row.audio.subarray(44), Buffer.alloc(row.pause * 2)])));
const audioRecord = (file, audio) => ({file, sampleCount: (audio.length - 44) / 2, sha256: sha(audio), bytes: audio.length});
const phonemes = id => ({id, length: 20, sha256: '1'.repeat(64), missingVocabulary: []});
async function put(directory, path, value) {
  await writeFile(join(directory, path), Buffer.isBuffer(value) || typeof value === 'string' ? value : json(value));
}
const readJson = async path => JSON.parse(await readFile(path));
async function refreshManifest(directory, manifest) {
  const files = (await fileSet(directory)).filter(file => file.path !== 'voice-manifest.json');
  const timing = await readJson(join(directory, 'timing.json'));
  const record = path => files.find(file => file.path === path);
  Object.assign(manifest, {files,
    audio: {...record('media/voice.wav'), totalSamples: timing.totalSamples, durationSeconds: timing.durationSeconds,
      sampleRate: rate, channels: 1, bitsPerSample: 16},
    captions: {...record('captions.json'), count: timing.captions.length}, timing: record('timing.json')});
  await put(directory, 'voice-manifest.json', manifest);
}

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'editorial-voice-retake-synthetic-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const episode = {id: 'synthetic-retake', scenes: [
    {id: 'S01', unitIds: ['one'], narration: '先检查资料，再整理证据。'},
    {id: 'S02', unitIds: ['two'], narration: '最后验证全部结果。'}]};
  const source = {scriptBindingHash: 'a'.repeat(64), storyboardBindingHash: 'b'.repeat(64), materializationManifestSha256: 'c'.repeat(64)};
  const basePlan = buildEditorialVoiceSpeechPlan(episode.scenes);
  assert.equal(basePlan.segments.length, 2);
  const baseDriver = {plan: basePlan, model: {synthetic: true}, runtimeLock: {synthetic: true},
    pinnedFiles: {model: {sha256: 'd'.repeat(64)}, voice: {sha256: 'e'.repeat(64)}}};
  const oldImplementation = 'f'.repeat(64), implementationHash = '0'.repeat(64);
  const baseRequest = {episodeId: episode.id, source, implementationHash: oldImplementation, plan: basePlan,
    driverRequestSha256: sha(json(baseDriver)), authorization};
  const baseDirectory = `outputs/studio/${episode.id}/editorial-voice-candidates/${sha(json(baseRequest))}`;
  const baseRoot = join(root, baseDirectory);
  await mkdir(join(baseRoot, 'media'), {recursive: true});
  const parentAudio = [wav(rate * 6), wav(rate * 2, 2000)];
  const baseTiming = buildEditorialVoiceTiming(basePlan, basePlan.segments.map((s, i) => ({id: s.id, sampleCount: i ? rate * 2 : rate * 6})));
  const baseVoice = combine(parentAudio.map((audio, i) => ({audio, pause: basePlan.segments[i].pauseAfterSamples})));
  const baseResult = {schemaVersion: 'editorial-local-voice-result-v1', requestSha256: sha(json(baseDriver)),
    planSourceTextSha256: basePlan.sourceTextSha256, sampleRate: rate, externalApiCalls: 0, costUsd: 0,
    runtime: baseDriver.runtimeLock, voiceId: 'zm_010', speed: 1.1, formalVoiceRegistered: false,
    releaseEligible: false, networkGuards, offlineEnvironmentVerified: true,
    segments: basePlan.segments.map((s, i) => ({...s, ...audioRecord(`${s.id}.wav`, parentAudio[i]), phonemeCheck: phonemes(s.id)})),
    voice: audioRecord('voice.wav', baseVoice)};
  const common = {episodeId: episode.id, source, synthesis: {voiceId: 'zm_010', speed: 1.1, modelSha256: 'd'.repeat(64), voiceSha256: 'e'.repeat(64)},
    alignmentMethod: baseTiming.alignmentMethod, captionAligned: true, motionAligned: false, renderReady: false,
    externalApiCalls: 0, maximumPaidCostUsd: 0, releaseEligible: false};
  for (const [path, value] of [['request.json', baseRequest], ['driver-request.json', baseDriver], ['media/result.json', baseResult],
    ['media/voice.wav', baseVoice], ['timing.json', baseTiming], ['captions.json', baseTiming.captions],
    ['captions.srt', serializeEditorialVoiceSrt(baseTiming.captions)], ['execution.json', {synthetic: true}],
    ...basePlan.segments.map((s, i) => [`media/${s.id}.wav`, parentAudio[i]])]) await put(baseRoot, path, value);
  const baseManifest = {...common, schemaVersion: 'editorial-local-voice-candidate-v1',
    generationRequestHash: sha(json(baseRequest)), implementationHash: oldImplementation};
  await refreshManifest(baseRoot, baseManifest);
  const baseCandidate = {path: `${baseDirectory}/voice-manifest.json`, sha256: sha(await readFile(join(baseRoot, 'voice-manifest.json')))};
  const repair = {schemaVersion: 'editorial-voice-repair-plan-v1', baseCandidate,
    repairs: [{id: 'speech-0001', parts: ['先检查资料，', '再整理证据。'].map(text => ({text, textSha256: sha(text)}))}]};
  const repairRecord = {path: 'outputs/synthetic-repair-plan.json', bytes: Buffer.byteLength(json(repair)), sha256: sha(json(repair))};
  const retakePlan = buildEditorialVoiceRetakePlan(basePlan, baseTiming, repair);
  await mkdir(join(root, 'studio/scripts'), {recursive: true});
  const driverPath = join(root, 'studio/scripts/retake-editorial-local-voice.py');
  await writeFile(driverPath, '# Synthetic pin fixture only. Never executed.\n');
  const driver = {basePlan, baseTiming, repairPlan: repair, retakePlan, model: baseDriver.model,
    pinnedFiles: baseDriver.pinnedFiles, runtimeLock: baseDriver.runtimeLock,
    retakeDriverPin: await editorialVoicePin(driverPath), baseMedia: {path: join(baseRoot, 'media'),
      files: baseResult.segments.map(({id, file, bytes, sha256, sampleCount}) => ({id, file, bytes, sha256, sampleCount}))}};
  const executionRequest = {episodeId: episode.id, baseCandidatePath: baseCandidate.path, baseCandidateSha256: baseCandidate.sha256,
    repairPlanPath: repairRecord.path, repairPlanSha256: repairRecord.sha256, implementationHash, snapshotHash: '2'.repeat(64),
    sourceHash: digest(source), actor: 'human:Zhengjiazhi', reason: 'Synthetic exact failed cue repair', confirmEditorialVoiceRetake: true};
  const request = {schemaVersion: 'editorial-voice-retake-generation-request-v1', episodeId: episode.id, source, implementationHash,
    plan: basePlan, retakePlan, baseCandidate, repairPlan: repairRecord, authorization, executionRequest,
    episodeSnapshotHash: executionRequest.snapshotHash, driverRequestSha256: sha(json(driver))};
  const directory = `outputs/studio/${episode.id}/editorial-voice-candidates/${sha(json(request))}`;
  const target = join(root, directory);
  await mkdir(join(target, 'media'), {recursive: true});
  const children = [wav(rate * 2, 3000), wav(rate * 2, 4000)];
  const retakenParent = combine(children.map(audio => ({audio, pause: 0})));
  const newParents = [retakenParent, parentAudio[1]];
  const measurements = retakePlan.parents.map((p, i) => ({id: p.id, sampleCount: i ? rate * 2 : rate * 4,
    parts: p.parts.map(part => ({id: part.id, sampleCount: rate * 2}))}));
  const timing = buildEditorialVoiceRetakeTiming(basePlan, repair, measurements);
  const voice = combine(newParents.map((audio, i) => ({audio, pause: basePlan.segments[i].pauseAfterSamples})));
  const result = {...baseResult, schemaVersion: 'editorial-local-voice-retake-result-v1', requestSha256: sha(json(driver)),
    segments: retakePlan.parents.map((p, i) => ({...p, ...audioRecord(`${p.id}.wav`, newParents[i]),
      parts: p.parts.map((part, n) => ({...part, ...audioRecord(`${part.id}.wav`, children[n]), phonemeCheck: phonemes(part.id)}))})),
    voice: audioRecord('voice.wav', voice)};
  for (const [path, value] of [['request.json', request], ['driver-request.json', driver], ['media/result.json', result],
    ['media/voice.wav', voice], ['timing.json', timing], ['captions.json', timing.captions],
    ['captions.srt', serializeEditorialVoiceSrt(timing.captions)], ['execution.json', {synthetic: true}],
    ['base-candidate.json', await readFile(join(baseRoot, 'voice-manifest.json'))], ['repair-plan.json', repair],
    ...retakePlan.parents.map((p, i) => [`media/${p.id}.wav`, newParents[i]]),
    ...retakePlan.parents[0].parts.map((part, i) => [`media/${part.id}.wav`, children[i]])]) await put(target, path, value);
  const manifest = {...common, schemaVersion: 'editorial-local-voice-retake-candidate-v1', generationRequestHash: sha(json(request)),
    implementationHash, baseCandidate, repairPlan: repairRecord};
  await refreshManifest(target, manifest);
  return {root, target, directory, episode, source, implementationHash, manifest, result, timing, repair, basePlan,
    baseRoot, baseDirectory, baseCandidate, baseManifest, baseTiming, baseResult, newParents, children,
    input: {workspaceRoot: root, directory, episode, source, implementationHash},
    baseInput: {workspaceRoot: root, episode, source, baseCandidatePath: baseCandidate.path, baseCandidateSha256: baseCandidate.sha256}};
}
const verify = (f, checkInputs = async () => true) => verifyEditorialVoicePackageCore(f.input, checkInputs);
async function forgeParent(f, index, audio) {
  f.newParents[index] = audio;
  Object.assign(f.result.segments[index], audioRecord(`${f.result.segments[index].id}.wav`, audio));
  const voice = combine(f.newParents.map((bytes, i) => ({audio: bytes, pause: f.basePlan.segments[i].pauseAfterSamples})));
  f.result.voice = audioRecord('voice.wav', voice);
  await put(f.target, `media/${f.result.segments[index].id}.wav`, audio);
  await put(f.target, 'media/voice.wav', voice);
  await put(f.target, 'media/result.json', f.result);
  await refreshManifest(f.target, f.manifest);
}

test('historical overlong v1 is readable as exact base but remains ineligible for registration', async t => {
  const f = await fixture(t);
  const before = await fileSet(f.baseRoot);
  const base = await verifyEditorialVoiceRetakeBaseCore(f.baseInput, async () => true);
  assert.equal(base.timing.captionDurationIssues.length, 1);
  assert.equal(base.basePlan.segments.length, 2);
  await assert.rejects(verifyEditorialVoicePackageCore({...f.input, directory: f.baseDirectory,
    implementationHash: f.baseManifest.implementationHash}, async () => true), {code: 'editorial_voice_caption_duration_requires_revision'});
  assert.deepEqual(await fileSet(f.baseRoot), before);
});

test('strict synthetic retake verifies children, unchanged reused parent, PCM assembly and measured captions', async t => {
  const f = await fixture(t); const baseBefore = await fileSet(f.baseRoot);
  const verified = await verify(f);
  assert.equal(verified.manifest.captions.count, 3);
  assert.equal(verified.manifest.audio.totalSamples, rate * 6 + 4800);
  assert.equal(verified.manifest.motionAligned, false);
  assert.equal(verified.manifest.renderReady, false);
  assert.deepEqual(await fileSet(f.baseRoot), baseBefore);
});

test('rehashing a changed reused parent and full assembly cannot replace the pinned original audio', async t => {
  const f = await fixture(t);
  await forgeParent(f, 1, wav(rate * 2, 5000));
  await assert.rejects(verify(f), {code: 'editorial_voice_reused_audio_changed'});
});

test('rehashing child bytes does not bypass exact child-to-parent PCM assembly', async t => {
  const f = await fixture(t), part = f.result.segments[0].parts[0], changed = wav(rate * 2, 6000);
  Object.assign(part, audioRecord(part.file, changed));
  await put(f.target, `media/${part.file}`, changed);
  await put(f.target, 'media/result.json', f.result);
  await refreshManifest(f.target, f.manifest);
  await assert.rejects(verify(f), {code: 'editorial_voice_pcm_assembly_changed'});
});

test('rehashing forged caption timestamps cannot replace actual child sample boundaries', async t => {
  const f = await fixture(t), forged = structuredClone(f.timing.captions);
  forged[0].endMs -= 1;
  await put(f.target, 'captions.json', forged);
  await refreshManifest(f.target, f.manifest);
  await assert.rejects(verify(f), {code: 'editorial_voice_captions_changed'});
});

test('base, source, repair and implementation drift fail closed', async t => {
  for (const change of ['base-manifest', 'base-pcm', 'source', 'repair', 'implementation', 'pins']) await t.test(change, async t => {
    const f = await fixture(t);
    if (change === 'base-manifest') await put(f.baseRoot, 'voice-manifest.json', {...f.baseManifest, releaseEligible: true});
    if (change === 'base-pcm') await put(f.baseRoot, 'media/speech-0002.wav', wav(rate * 2, 6000));
    if (change === 'source') f.input.source = {...f.source, scriptBindingHash: '9'.repeat(64)};
    if (change === 'repair') {
      const repair = structuredClone(f.repair); repair.repairs[0].parts[0].text = '改变了原文，';
      await put(f.target, 'repair-plan.json', repair); await refreshManifest(f.target, f.manifest);
    }
    if (change === 'implementation') f.input.implementationHash = '9'.repeat(64);
    await assert.rejects(verify(f, change === 'pins' ? async () => {throw new Error('Synthetic pin drift');} : undefined));
  });
});

test('base reuse PCM mutated after initial verification cannot bless an equally rehashed retake', async t => {
  const f = await fixture(t), changed = wav(rate * 2, 7000);
  await forgeParent(f, 1, changed);
  let inspected = 0;
  await assert.rejects(verify(f, async () => {
    inspected++;
    if (inspected === 2) await put(f.baseRoot, 'media/speech-0002.wav', changed);
  }));
});
