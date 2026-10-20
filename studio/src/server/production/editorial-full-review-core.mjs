// Private full-length review artifacts only. No Episode writer or Gate transition.
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';
import {inspectEditorialVoicePcm} from './editorial-voice-integrity.mjs';

export const EDITORIAL_FULL_REVIEW_OPERATION='review:render-editorial-full';
export const EDITORIAL_FULL_REVIEW_SCOPES=Object.freeze([
  'filesystem.write.editorial-full-review','process.spawn.editorial-full-review',
]);
const inputKeys=['episodeId','planPath'];
const requestKeys=[...inputKeys,'planSha256','snapshotHash','sourceHash','implementationHash','actor','reason','confirmEditorialFullReview'];
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[null,Object.prototype].includes(Object.getPrototypeOf(value));

export function editorialFullReviewError(code='editorial_full_review_request_invalid') {
  return Object.assign(new Error('完整私有审看版未获有效授权，或冻结来源、范围与完整性已改变'),{code,statusCode:409});
}
export function editorialFullReviewNeed(value,code) {if(!value)throw editorialFullReviewError(code);}
function closed(value,required,optional=[]) {
  if(!plain(value))return false;
  const keys=Reflect.ownKeys(value);
  return required.every(key=>keys.includes(key))&&keys.every(key=>{
    const d=Object.getOwnPropertyDescriptor(value,key);
    return [...required,...optional].includes(key)&&d.enumerable&&Object.hasOwn(d,'value');
  });
}
function assertData(value,seen=new Set(),budget={left:1000000},depth=0) {
  const need=ok=>editorialFullReviewNeed(ok,'editorial_full_review_inspection_invalid');
  need(--budget.left>=0&&depth<=64);
  if(value===null||['string','boolean'].includes(typeof value))return;
  if(typeof value==='number'){need(Number.isFinite(value));return;}
  need(typeof value==='object'&&!seen.has(value));
  need(Array.isArray(value)?Object.getPrototypeOf(value)===Array.prototype:plain(value));
  seen.add(value);
  for(const key of Reflect.ownKeys(value)) {
    const d=Object.getOwnPropertyDescriptor(value,key);
    need(typeof key==='string'&&Object.hasOwn(d,'value'));
    if(Array.isArray(value)&&key==='length')continue;
    need(d.enumerable);assertData(d.value,seen,budget,depth+1);
  }
  if(Array.isArray(value))need(Object.keys(value).length===value.length&&Object.keys(value).every((key,index)=>key===String(index)));
  seen.delete(value);
}
function inputValid(value) {
  return typeof value.episodeId==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/u.test(value.episodeId)
    &&typeof value.planPath==='string'
    &&value.planPath.startsWith(`outputs/studio/${value.episodeId}/editorial-full-review-plans/`)
    &&/^[A-Za-z0-9_-]+\.json$/u.test(value.planPath.slice(`outputs/studio/${value.episodeId}/editorial-full-review-plans/`.length));
}
export function validateEditorialFullReviewInput(value) {
  editorialFullReviewNeed(closed(value,inputKeys)&&inputValid(value));return structuredClone(value);
}
export function validateEditorialFullReviewRequest(value) {
  editorialFullReviewNeed(closed(value,requestKeys)&&inputValid(value));
  editorialFullReviewNeed([value.planSha256,value.snapshotHash,value.sourceHash,value.implementationHash].every(sha)
    &&typeof value.actor==='string'&&/^human:[^\s\p{Cc}]{1,120}$/u.test(value.actor)
    &&typeof value.reason==='string'&&value.reason.trim()===value.reason&&value.reason.length>=4&&value.reason.length<=1000
    &&!/\p{Cc}/u.test(value.reason)&&value.confirmEditorialFullReview===true);
  return structuredClone(value);
}
export function validateEditorialFullReviewPlan(value) {
  const need=ok=>editorialFullReviewNeed(ok,'editorial_full_review_plan_invalid');
  need(closed(value,['schemaVersion','preparationManifestPath','preparationManifestSha256','chunkFrames']));
  need(value.schemaVersion==='editorial-full-review-plan-v1'&&value.chunkFrames===900&&sha(value.preparationManifestSha256));
  const path=value.preparationManifestPath;
  need(typeof path==='string'&&/^outputs\/[A-Za-z0-9_./-]+\/preparation-manifest\.json$/u.test(path)
    &&path.split('/').every(part=>part&&part!=='.'&&part!=='..'));
  return structuredClone(value);
}
export function editorialFullReviewCapabilitySpec(value) {
  return {episodeId:`editorial-full-review/${digest(validateEditorialFullReviewRequest(value))}`,
    operation:EDITORIAL_FULL_REVIEW_OPERATION,scopes:[...EDITORIAL_FULL_REVIEW_SCOPES],maxCalls:0,maxCostUsd:0};
}
export function assertEditorialFullReviewGrant(request,options) {
  editorialFullReviewNeed(closed(options,[],['sideEffectGrant']),'editorial_full_review_options_invalid');
  const grant=requireSideEffectGrant(options,editorialFullReviewCapabilitySpec(request),EDITORIAL_FULL_REVIEW_OPERATION);
  editorialFullReviewNeed(grant.maxCalls===0&&grant.maxCostUsd===0
    &&digest([...grant.scopes].sort())===digest([...EDITORIAL_FULL_REVIEW_SCOPES].sort()),'editorial_full_review_capability_invalid');
  return grant;
}
function frameCountValid(value) {return Number.isSafeInteger(value)&&value>0&&value<=36000;}
export function buildEditorialFullReviewSegments(value) {
  const need=ok=>editorialFullReviewNeed(ok,'editorial_full_review_segment_invalid');
  need(closed(value,['durationInFrames','totalSamples'],['fps','sampleRate','chunkFrames']));
  const {durationInFrames,totalSamples}=value;
  need(frameCountValid(durationInFrames)&&Number.isSafeInteger(totalSamples)&&totalSamples>0
    &&(!Object.hasOwn(value,'fps')||value.fps===30)&&(!Object.hasOwn(value,'sampleRate')||value.sampleRate===24000)
    &&(!Object.hasOwn(value,'chunkFrames')||value.chunkFrames===900));
  const padding=durationInFrames*800-totalSamples;
  need(padding>=0&&padding<800);
  const segments=[];
  for(let fromFrame=0;fromFrame<durationInFrames;fromFrame+=900) {
    const toFrameExclusive=Math.min(fromFrame+900,durationInFrames);
    segments.push({id:`segment-${String(segments.length+1).padStart(2,'0')}`,fromFrame,toFrameExclusive,frameCount:toFrameExclusive-fromFrame});
  }
  return segments;
}
export function padEditorialFullReviewPcm(bytes,totalFrames) {
  editorialFullReviewNeed(frameCountValid(totalFrames),'editorial_full_review_audio_invalid');
  const {sampleCount:sourceSamples}=inspectEditorialVoicePcm(bytes);
  buildEditorialFullReviewSegments({durationInFrames:totalFrames,totalSamples:sourceSamples});
  const targetSamples=totalFrames*800,tailPaddingSamples=targetSamples-sourceSamples;
  const padded=Buffer.alloc(44+targetSamples*2);
  bytes.copy(padded);padded.writeUInt32LE(padded.length-8,4);padded.writeUInt32LE(targetSamples*2,40);
  return {bytes:padded,sourceSamples,targetSamples,tailPaddingSamples};
}
function summary(value,input) {
  assertData(value);
  editorialFullReviewNeed(plain(value)&&[value.sourceHash,value.implementationHash,value.planSha256].every(sha)
    &&(!Object.hasOwn(value,'publicSummary')||plain(value.publicSummary)),'editorial_full_review_inspection_invalid');
  const expected=buildEditorialFullReviewSegments({durationInFrames:value.durationInFrames,totalSamples:value.totalSamples});
  editorialFullReviewNeed(Array.isArray(value.segments)&&digest(value.segments)===digest(expected),'editorial_full_review_segment_invalid');
  return {...value.publicSummary,...input,planSha256:value.planSha256,sourceHash:value.sourceHash,implementationHash:value.implementationHash,
    snapshotHash:digest(value),durationInFrames:value.durationInFrames,totalSamples:value.totalSamples,segments:expected,
    formalRender:false,visualAcceptance:false,releaseEligible:false,paidCalls:0,estimatedCostUsd:0};
}
export function createEditorialFullReviewService(dependencies) {
  if(!closed(dependencies,['inspect','execute'])||typeof dependencies.inspect!=='function'||typeof dependencies.execute!=='function')
    throw new TypeError('Incomplete full review dependencies');
  const {inspect,execute}=dependencies;
  async function preview(raw) {
    const input=validateEditorialFullReviewInput(raw);return summary(await inspect(input),input);
  }
  async function render(raw,options={}) {
    const request=validateEditorialFullReviewRequest(raw);
    const sideEffectGrant=assertEditorialFullReviewGrant(request,options);
    // Capture the verified grant; later mutation of the caller's options cannot replace it.
    const checkedOptions=Object.freeze({sideEffectGrant});
    const input=validateEditorialFullReviewInput({episodeId:request.episodeId,planPath:request.planPath});
    const inspectedValue=await inspect(input),inspected=summary(inspectedValue,input);
    editorialFullReviewNeed(['snapshotHash','sourceHash','implementationHash','planSha256'].every(key=>request[key]===inspected[key]),
      'editorial_full_review_snapshot_changed');
    const value=structuredClone(inspectedValue);
    const assertCurrent=async()=>{
      assertEditorialFullReviewGrant(request,checkedOptions);
      const next=summary(await inspect(input),input);
      editorialFullReviewNeed(next.snapshotHash===request.snapshotHash,'editorial_full_review_snapshot_changed');
      assertEditorialFullReviewGrant(request,checkedOptions);
    };
    assertEditorialFullReviewGrant(request,checkedOptions);
    return execute({value,request,sideEffectGrant,assertCurrent});
  }
  return Object.freeze({preview,render});
}
