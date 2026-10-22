import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompletedFullReviewManifest} from '../src/server/production/editorial-full-review-manifest.mjs';
import {buildEditorialFullReviewSegments} from '../src/server/production/editorial-full-review-core.mjs';
import {canonicalJsonDocumentContentSha256 as digest} from '../src/shared/durable-json-store.mjs';
import {editorialMaterializationJson as json,editorialMaterializationSha as sha} from '../src/server/production/editorial-materialization-integrity.mjs';

const hash=n=>String(n).repeat(64);
const token='01234567-0123-4123-8123-0123456789ab';
const record=(path,content)=>({path,bytes:content?Buffer.byteLength(content):123,sha256:content?sha(content):hash(8)});
const signature=()=>({codec_name:'h264',profile:'High',codec_tag_string:'avc1',level:40,width:1920,height:1080,
  pix_fmt:'yuv420p',r_frame_rate:'30/1',time_base:'1/15360',extradata_hash:`SHA256:${hash(6)}`});
function fixture() {
  const value={sourceHash:hash(1),implementationHash:hash(2),planSha256:hash(3),sourceEpisodeFile:record('studio/data/episodes/synthetic/episode.json'),
    sourceHead:'a'.repeat(40),preparationManifestSha256:hash(4),implementationFiles:[record('studio/src/synthetic.mjs')],
    runtime:{node:record('/synthetic/runtime/node')},selectedPlanFiles:[record('outputs/synthetic/plan.json')],
    inputProps:{episode:{id:'synthetic'}},material:{inputPropsSha256:hash(5)},voice:{audio:{sha256:hash(6),totalSamples:901*800-240}},
    durationInFrames:901,totalSamples:901*800-240,segments:buildEditorialFullReviewSegments({durationInFrames:901,totalSamples:901*800-240})};
  const request={episodeId:'synthetic',planPath:'outputs/studio/synthetic/editorial-full-review-plans/plan.json',
    planSha256:value.planSha256,snapshotHash:digest(value),sourceHash:value.sourceHash,implementationHash:value.implementationHash,
    actor:'human:synthetic',reason:'Generate private complete synthetic review',confirmEditorialFullReview:true};
  const chunks=value.segments.map(segment=>({schemaVersion:'editorial-full-review-segment-v1',requestHash:digest(request),segment,
    file:record(`${segment.id}.${token}.mp4`),signature:signature(),fullDecodePassed:true}));
  const video=record(`full-review.${token}.mp4`),evidence=`assembly-${token}.json`;
  const files=[video,record('request.json',json(request)),record('input-props.json',json(value.inputProps)),
    {...record('full-narration-padded.wav'),bytes:44+value.durationInFrames*800*2},record(`concat-${token}.txt`),record(`full-silent-${token}.mp4`),record(evidence),
    ...chunks.flatMap(chunk=>[chunk.file,record(`${chunk.segment.id}.json`,json(chunk))])];
  const manifest={schemaVersion:'editorial-full-review-candidate-v1',episodeId:request.episodeId,request,sourceHash:value.sourceHash,
    sourceEpisodeFile:value.sourceEpisodeFile,sourceHead:value.sourceHead,preparationManifestSha256:value.preparationManifestSha256,
    implementationHash:value.implementationHash,implementationFiles:value.implementationFiles,runtime:value.runtime,
    selectedPlanFiles:value.selectedPlanFiles,inputPropsSha256:sha(json(value.inputProps)),originalPropsSha256:value.material.inputPropsSha256,
    voice:value.voice,video,chunks,files,durationInFrames:value.durationInFrames,fps:30,width:1920,height:1080,
    audio:{sourceSamples:value.totalSamples,targetSamples:value.durationInFrames*800,tailPaddingSamples:240,
      paddedPcmPath:'full-narration-padded.wav',aacEncodesForThisDeliveredAttempt:1,assemblyEvidencePath:evidence},
    fullDecodePassed:true,formalRender:false,visualAcceptance:false,continuousHumanReview:false,episodeMutated:false,
    releaseEligible:false,paidCalls:0,maximumPaidCostUsd:0,
    assurance:'private-full-review-only; decode does not replace pixel QA or continuous listening/viewing'};
  return {value,request,manifest};
}
function rejects(edit) {
  const {value,request,manifest}=fixture();edit(manifest,value,request);
  assert.throws(()=>validateCompletedFullReviewManifest(manifest,value,request));
}

test('complete manifest accepts exact source-bound private candidate and returns a copy',()=>{
  const {value,request,manifest}=fixture(),result=validateCompletedFullReviewManifest(manifest,value,request);
  assert.deepEqual(result,manifest);assert.notEqual(result,manifest);assert.equal(result.files.length,11);
});
test('empty, extra, duplicated, omitted, unsafe or substituted file records all reject',()=>{
  for(const edit of [m=>{m.files=[];},m=>{m.files.pop();},m=>{m.files.push(record('unapproved.txt'));},m=>{m.files.push(m.files[0]);},
    m=>{m.files[0].path='../outside.mp4';},m=>{m.files[0].path='/tmp/outside.mp4';},m=>{m.files[0].path='dir/outside.mp4';},
    m=>{m.files[0].bytes=0;},m=>{m.files[0].bytes=1.5;},m=>{m.files[0].sha256='x';},m=>{m.files[0].extra=true;},
    m=>{m.files=m.files.map(f=>({...f}));m.files[0].sha256=hash(7);},
    m=>{m.video=record('full-review.ffffffff-ffff-ffff-ffff-ffffffffffff.mp4');}]) rejects(edit);
});
test('every bound source, dimensions, scope and acceptance field remains exact',()=>{
  for(const key of ['sourceHash','sourceEpisodeFile','sourceHead','preparationManifestSha256','implementationHash','implementationFiles',
    'runtime','selectedPlanFiles','inputPropsSha256','originalPropsSha256','voice','episodeId','request','durationInFrames','fps','width','height','assurance'])
    rejects(m=>{m[key]='forged';});
  for(const key of ['formalRender','visualAcceptance','continuousHumanReview','episodeMutated','releaseEligible']) rejects(m=>{m[key]=true;});
  for(const key of ['paidCalls','maximumPaidCostUsd'])rejects(m=>{m[key]=1;});
  rejects(m=>{m.fullDecodePassed=false;});rejects(m=>{m.extra=true;});
  rejects((m,v,r)=>{r.reason='Changed request after completion';});
  rejects((m,v)=>{v.runtime={node:record('/different/runtime')};});
});
test('chunks must match exact continuous expected segment order and signed checkpoint metadata',()=>{
  for(const edit of [m=>{m.chunks=[];},m=>{m.chunks.reverse();},m=>{m.chunks.push(m.chunks[0]);},
    m=>{m.chunks[0].requestHash=hash(9);},m=>{m.chunks[0].segment.fromFrame=1;},
    m=>{m.chunks[0].file.path='segment-99.01234567-0123-4123-8123-0123456789ab.mp4';},
    m=>{m.chunks[0].file.path='../outside.mp4';},m=>{m.chunks[0].fullDecodePassed=false;},
    m=>{m.chunks[0].signature.width=1280;},m=>{m.chunks[0].file.extra=true;},
    m=>{m.files.find(f=>f.path==='segment-01.json').sha256=hash(9);}])rejects(edit);
});
test('audio preserves exact source samples with less-than-one-frame tail padding and no alternate path',()=>{
  for(const edit of [m=>{m.audio.sourceSamples--;},m=>{m.audio.targetSamples++;},m=>{m.audio.tailPaddingSamples=800;},
    m=>{m.audio.paddedPcmPath='../voice.wav';},m=>{m.audio.aacEncodesForThisDeliveredAttempt=2;},
    m=>{m.audio.assemblyEvidencePath='assembly-ffffffff-ffff-ffff-ffff-ffffffffffff.json';},m=>{m.audio.extra=true;},
    m=>{m.files.find(f=>f.path==='full-narration-padded.wav').bytes--;},
    m=>{m.files.find(f=>f.path==='input-props.json').sha256=hash(9);},
    m=>{m.files.find(f=>f.path==='request.json').bytes++;}])rejects(edit);
});
test('completed manifest refuses getters, Symbols, hidden fields and nested non-data objects without invoking them',()=>{
  rejects(m=>{Object.defineProperty(m,'video',{enumerable:true,get:()=>assert.fail('getter invoked')});});
  rejects(m=>{Object.defineProperty(m.audio,'sourceSamples',{enumerable:true,get:()=>assert.fail('nested getter invoked')});});
  rejects(m=>{m[Symbol('x')]=true;});rejects(m=>{Object.defineProperty(m,'hidden',{value:true});});
  rejects(m=>{Object.setPrototypeOf(m.audio,{inherited:true});});rejects(m=>{m.chunks[0].signature.toJSON=()=>assert.fail('toJSON invoked');});
});
