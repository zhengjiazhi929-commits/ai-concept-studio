import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {explainerFullRevisionCapabilitySpec,renderExplainerFullRevision} from '../scripts/render-explainer-full-revision.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {assertFullReviewMedia,validateFullReviewCheckpoint,fullReviewConcatList} from '../src/server/production/editorial-full-review-runtime.mjs';
import {buildExplainerFullRevisionChunks,validateExplainerFullRevisionManifest} from '../src/shared/explainer-full-revision.mjs';

const hash='a'.repeat(64),request=()=>({planPath:'outputs/synthetic/plan.json',voiceResultPath:'outputs/synthetic/voice.json',
  sourceHash:hash,implementationHash:hash,snapshotHash:hash,confirmLocalFullReview:true});
const digest=value=>createHash('sha256').update(`${JSON.stringify(value,null,2)}\n`).digest('hex');
test('full renderer keeps installed-byte verification before every resumable checkpoint',async()=>{
  const code=await readFile(new URL('../scripts/render-explainer-full-revision.mjs',import.meta.url),'utf8');
  // This static wiring test complements the byte-mutation executable tests;
  // it cannot certify a real video or a hostile filesystem sandbox.
  assert.match(code,/async function unchanged\(value,\{checkDependencies=true\}/u);
  assert.match(code,/if\(checkDependencies\)await assertInstalledDependencies/u);
  assert.equal((code.match(/checkDependencies:false/gu)??[]).length,1);
  assert.match(code,/await unchanged\(value,\{checkDependencies:false\}\);guard\(\);const metadataName/u);
  assert.match(code,/if\(!browser\)\{\s*await unchanged\(value\);guard\(\)/u);
  assert.match(code,/await unchanged\(value\);guard\(\);const checkpoint=/u);
  assert.match(code,/await write\(manifestPart,json\(manifest\)\);await unchanged\(value\)/u);
});
test('full revision requires exact dedicated local grant before inspecting nonexistent inputs',async()=>{
  await assert.rejects(renderExplainerFullRevision(request()),{code:'side_effect_capability_missing'});
  const authority=createCapabilityAuthority({secret:'synthetic-test-secret-'.repeat(3),maximumCalls:1,maximumCostUsd:1});
  for(const change of [{operation:'review:render-explainer-revision-proof'},
    {scopes:['filesystem.write.explainer-full-revision']},{maxCalls:1},{maxCostUsd:1},
    {scopes:[...explainerFullRevisionCapabilitySpec(request()).scopes,'network.fetch']}]){
    const sideEffectGrant=authority.authorize({...explainerFullRevisionCapabilitySpec(request()),...change});
    await assert.rejects(renderExplainerFullRevision(request(),{sideEffectGrant}),e=>e.code?.startsWith('side_effect_capability_')||e.code==='explainer_full_revision_capability_scope_invalid');
  }
});
test('grant-bound request prevents changed inputs and cannot accept dependency overrides',async()=>{
  const authority=createCapabilityAuthority({secret:'synthetic-test-secret-'.repeat(3)});
  const sideEffectGrant=authority.authorize(explainerFullRevisionCapabilitySpec(request()));
  await assert.rejects(renderExplainerFullRevision({...request(),planPath:'outputs/other/plan.json'},{sideEffectGrant}),{code:'side_effect_capability_episode_mismatch'});
  await assert.rejects(renderExplainerFullRevision(request(),{sideEffectGrant,root:'/tmp'}));
  await assert.rejects(renderExplainerFullRevision(request(),{sideEffectGrant},{execute:()=>{throw Error('must not run');}}));
});
test('resume checkpoints bind request hash, exact contiguous chunk and safe immutable media name',()=>{
  const segment=buildExplainerFullRevisionChunks(901)[0],requestHash=digest(request());
  const checkpoint={schemaVersion:'editorial-full-review-segment-v1',requestHash,segment,
    file:{path:'segment-01.11111111-1111-1111-1111-111111111111.mp4',bytes:1024,sha256:hash},signature:{codec_name:'h264'},fullDecodePassed:true};
  assert.deepEqual(validateFullReviewCheckpoint(checkpoint,segment,requestHash),checkpoint);
  for(const mutate of [c=>c.requestHash='b'.repeat(64),c=>c.segment.fromFrame=1,c=>c.file.path='../outside.mp4',
    c=>c.file.sha256='invalid',c=>c.fullDecodePassed=false,c=>c.extra=true]){
    const c=structuredClone(checkpoint);mutate(c);assert.throws(()=>validateFullReviewCheckpoint(c,segment,requestHash));
  }
  assert.throws(()=>fullReviewConcatList(['safe.mp4\nfile /elsewhere']));
  assert.throws(()=>fullReviewConcatList([checkpoint.file.path,checkpoint.file.path]));
});
test('resume media validation rejects frame mismatch, extra streams, altered codec signature and wrong PCM mux',()=>{
  const video={codec_type:'video',codec_name:'h264',profile:'High',codec_tag_string:'avc1',level:40,width:1920,height:1080,pix_fmt:'yuv420p',
    r_frame_rate:'30/1',avg_frame_rate:'30/1',nb_read_frames:'900',start_time:'0',duration:'30',time_base:'1/15360',extradata_hash:`SHA256:${hash}`};
  const info={streams:[video]},signature=assertFullReviewMedia(info,900);
  for(const mutate of [x=>x.streams[0].nb_read_frames='899',x=>x.streams.push({...video}),x=>x.streams[0].extradata_hash=`SHA256:${'b'.repeat(64)}`,
    x=>x.streams[0].start_time='0.01']){
    const x=structuredClone(info);mutate(x);assert.throws(()=>assertFullReviewMedia(x,900,{signature}));
  }
  const mux={streams:[video,{codec_type:'audio',codec_name:'aac',sample_rate:'24000',channels:1,start_time:'0',duration:'30'}]};
  assertFullReviewMedia(mux,900,{audio:true});mux.streams[1].sample_rate='48000';assert.throws(()=>assertFullReviewMedia(mux,900,{audio:true}));
});
test('no manifest completion can be inferred from invalid or partial artifacts',()=>{
  for(const value of [null,{},[],{schemaVersion:'explainer-full-revision-candidate-v1',request:request()}])
    assert.throws(()=>validateExplainerFullRevisionManifest(value,{sourceHash:hash,implementationHash:hash,durationInFrames:1,chunks:buildExplainerFullRevisionChunks(1)},request()));
});
