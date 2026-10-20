// Pure structural/binding checks. Callers must separately re-read every file,
// verify its bytes, probe the streams and fully decode the delivered media.
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {editorialMaterializationJson as json,editorialMaterializationSha as sha} from './editorial-materialization-integrity.mjs';
import {validateEditorialFullReviewRequest,buildEditorialFullReviewSegments} from './editorial-full-review-core.mjs';
import {validateFullReviewCheckpoint} from './editorial-full-review-runtime.mjs';

const fail=()=>{throw Object.assign(new Error('完整私有审看版完成清单与冻结输入不一致'),{code:'editorial_full_review_manifest_invalid',statusCode:409});};
const need=value=>{if(!value)fail();};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[null,Object.prototype].includes(Object.getPrototypeOf(value));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
function closed(value,keys) {
  return plain(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>{
    const d=Object.getOwnPropertyDescriptor(value,key);return d?.enumerable&&Object.hasOwn(d,'value');
  });
}
function data(value,seen=new Set(),budget={left:1000000},depth=0) {
  need(--budget.left>=0&&depth<=64);
  if(value===null||['string','boolean'].includes(typeof value))return;
  if(typeof value==='number'){need(Number.isFinite(value));return;}
  need(typeof value==='object'&&!seen.has(value));
  need(Array.isArray(value)?Object.getPrototypeOf(value)===Array.prototype:plain(value));
  seen.add(value);
  for(const key of Reflect.ownKeys(value)) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    need(typeof key==='string'&&Object.hasOwn(descriptor,'value'));
    if(Array.isArray(value)&&key==='length')continue;
    need(descriptor.enumerable);data(descriptor.value,seen,budget,depth+1);
  }
  if(Array.isArray(value))need(Object.keys(value).length===value.length&&Object.keys(value).every((key,index)=>key===String(index)));
  seen.delete(value);
}
function same(a,b) {return a!==undefined&&b!==undefined&&digest(a)===digest(b);}
function fileRecord(value) {
  need(closed(value,['path','bytes','sha256'])&&typeof value.path==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value.path)
    &&value.path!=='.'&&value.path!=='..'&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&hash(value.sha256));
}
const keys=['schemaVersion','episodeId','request','sourceHash','sourceEpisodeFile','sourceHead','preparationManifestSha256',
  'implementationHash','implementationFiles','runtime','selectedPlanFiles','inputPropsSha256','originalPropsSha256','voice',
  'video','chunks','files','durationInFrames','fps','width','height','audio','fullDecodePassed','formalRender','visualAcceptance',
  'continuousHumanReview','episodeMutated','releaseEligible','paidCalls','maximumPaidCostUsd','assurance'];
export function validateCompletedFullReviewManifest(manifest,value,rawRequest) {
  data(manifest);data(value);
  const request=validateEditorialFullReviewRequest(rawRequest),requestHash=digest(request);
  need(closed(manifest,keys)&&plain(value));
  need(request.snapshotHash===digest(value)&&request.sourceHash===value.sourceHash
    &&request.implementationHash===value.implementationHash&&request.planSha256===value.planSha256);
  need(manifest.schemaVersion==='editorial-full-review-candidate-v1'&&manifest.episodeId===request.episodeId&&same(manifest.request,request));
  for(const key of ['sourceHash','sourceEpisodeFile','sourceHead','preparationManifestSha256','implementationHash',
    'implementationFiles','runtime','selectedPlanFiles','voice','durationInFrames'])need(same(manifest[key],value[key]));
  need(manifest.inputPropsSha256===sha(json(value.inputProps))&&manifest.originalPropsSha256===value.material.inputPropsSha256);
  need(manifest.fps===30&&manifest.width===1920&&manifest.height===1080&&manifest.fullDecodePassed===true
    &&manifest.paidCalls===0&&manifest.maximumPaidCostUsd===0);
  for(const key of ['formalRender','visualAcceptance','continuousHumanReview','episodeMutated','releaseEligible'])need(manifest[key]===false);
  need(manifest.assurance==='private-full-review-only; decode does not replace pixel QA or continuous listening/viewing');
  const segments=buildEditorialFullReviewSegments({durationInFrames:value.durationInFrames,totalSamples:value.totalSamples});
  need(same(value.segments,segments)&&Array.isArray(manifest.chunks)&&manifest.chunks.length===segments.length
    &&value.voice.audio.totalSamples===value.totalSamples);
  fileRecord(manifest.video);
  const token=/^full-review\.([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.mp4$/u.exec(manifest.video.path)?.[1];
  need(token);
  const expectedAudio={sourceSamples:value.totalSamples,targetSamples:value.durationInFrames*800,
    tailPaddingSamples:value.durationInFrames*800-value.totalSamples,paddedPcmPath:'full-narration-padded.wav',
    aacEncodesForThisDeliveredAttempt:1,assemblyEvidencePath:`assembly-${token}.json`};
  need(closed(manifest.audio,Object.keys(expectedAudio))&&same(manifest.audio,expectedAudio));
  need(Array.isArray(manifest.files)&&manifest.files.length===7+segments.length*2);
  const files=new Map();
  for(const file of manifest.files){fileRecord(file);need(!files.has(file.path));files.set(file.path,file);}
  const expected=new Set([manifest.video.path,'request.json','input-props.json','full-narration-padded.wav',
    `concat-${token}.txt`,`full-silent-${token}.mp4`,`assembly-${token}.json`]);
  need(same(files.get(manifest.video.path),manifest.video));
  const exactJson=(path,content)=>{
    const bytes=json(content),record=files.get(path);
    need(record&&record.sha256===sha(bytes)&&record.bytes===Buffer.byteLength(bytes));
  };
  exactJson('request.json',request);exactJson('input-props.json',value.inputProps);
  need(files.get('full-narration-padded.wav')?.bytes===44+expectedAudio.targetSamples*2);
  let signature;
  for(const [index,chunk] of manifest.chunks.entries()) {
    const checkpoint=validateFullReviewCheckpoint(chunk,segments[index],requestHash);
    fileRecord(checkpoint.file);
    need(same(files.get(checkpoint.file.path),checkpoint.file));
    if(signature)need(same(checkpoint.signature,signature));else signature=checkpoint.signature;
    const metadata=`${segments[index].id}.json`;
    need(!expected.has(checkpoint.file.path)&&!expected.has(metadata));
    expected.add(checkpoint.file.path);expected.add(metadata);exactJson(metadata,checkpoint);
  }
  need(expected.size===files.size&&[...expected].every(path=>files.has(path)));
  return structuredClone(manifest);
}
