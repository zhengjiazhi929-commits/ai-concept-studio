// Independent review artifacts only: this service has no Episode writer or Gate transition.
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';

export const EDITORIAL_AV_REVIEW_OPERATION='review:render-editorial-clips';
export const EDITORIAL_AV_REVIEW_SCOPES=Object.freeze(['filesystem.write.editorial-review','process.spawn.editorial-review']);
const inputKeys=['episodeId','planPath'];
const requestKeys=[...inputKeys,'planSha256','snapshotHash','sourceHash','implementationHash','actor','reason','confirmEditorialReviewClips'];
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
export function editorialAvReviewError(code='editorial_av_review_request_invalid') {
  return Object.assign(new Error('独立音画审阅片段未获有效授权，或输入、来源、范围与完整性已改变'),{code,statusCode:409});
}
export function editorialAvReviewNeed(value,code) {if(!value)throw editorialAvReviewError(code);}
function closed(value,keys) {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)&&[null,Object.prototype].includes(Object.getPrototypeOf(value))
    &&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>{
      const d=Object.getOwnPropertyDescriptor(value,key);return d?.enumerable&&Object.hasOwn(d,'value');
    });
}
function assertPlanData(value,seen=new Set(),budget={left:20000},depth=0) {
  const need=ok=>editorialAvReviewNeed(ok,'editorial_av_review_plan_invalid');
  need(--budget.left>=0&&depth<=64);
  if(value===null||['string','boolean'].includes(typeof value))return;
  if(typeof value==='number'){need(Number.isFinite(value));return;}
  need(typeof value==='object'&&!seen.has(value));
  need(Array.isArray(value)?Object.getPrototypeOf(value)===Array.prototype:[null,Object.prototype].includes(Object.getPrototypeOf(value)));
  seen.add(value);
  for(const key of Reflect.ownKeys(value)) {
    const d=Object.getOwnPropertyDescriptor(value,key);need(typeof key==='string'&&Object.hasOwn(d,'value'));
    if(Array.isArray(value)&&key==='length')continue;
    need(d.enumerable);assertPlanData(d.value,seen,budget,depth+1);
  }
  if(Array.isArray(value))need(Object.keys(value).length===value.length&&Object.keys(value).every((key,index)=>key===String(index)));
  seen.delete(value);
}
export function validateEditorialAvReviewPlan(value) {
  assertPlanData(value);
  const need=ok=>editorialAvReviewNeed(ok,'editorial_av_review_plan_invalid');
  need(value&&typeof value==='object'&&!Array.isArray(value));
  const revised=value.schemaVersion==='editorial-av-review-plan-v2';
  need((revised||value.schemaVersion==='editorial-av-review-plan-v1')
    &&closed(value,revised?['schemaVersion','clips','pacing']:['schemaVersion','clips']));
  need(Array.isArray(value.clips)&&value.clips.length>0&&value.clips.length<=3);
  const selected=new Set();
  for(const clip of value.clips) {
    need(clip&&typeof clip==='object'&&Array.isArray(clip.sceneIds)&&clip.sceneIds.length>0);
    for(const sceneId of clip.sceneIds){need(typeof sceneId==='string');selected.add(sceneId);}
  }
  if(revised) {
    const pacing=value.pacing;
    need(closed(pacing,['schemaVersion','scenes'])&&pacing.schemaVersion==='editorial-av-pacing-v1'
      &&Array.isArray(pacing.scenes)&&pacing.scenes.length>0&&pacing.scenes.length<=3);
    const ids=new Set();
    for(const scene of pacing.scenes) {
      need(scene&&typeof scene==='object'&&typeof scene.sceneId==='string'
        &&selected.has(scene.sceneId)&&!ids.has(scene.sceneId));ids.add(scene.sceneId);
    }
  }
  return structuredClone(value);
}
function inputValid(value) {
  return typeof value.episodeId==='string'&&/^[a-z0-9][a-z0-9-]{0,99}$/u.test(value.episodeId)
    &&typeof value.planPath==='string'&&value.planPath.startsWith(`outputs/studio/${value.episodeId}/`)
    &&/^[A-Za-z0-9_./-]+\.json$/u.test(value.planPath)&&value.planPath.split('/').every(part=>part&&part!=='.'&&part!=='..');
}
export function validateEditorialAvReviewInput(value) {
  editorialAvReviewNeed(closed(value,inputKeys)&&inputValid(value));return structuredClone(value);
}
export function validateEditorialAvReviewRequest(value) {
  editorialAvReviewNeed(closed(value,requestKeys)&&inputValid(value));
  editorialAvReviewNeed([value.planSha256,value.snapshotHash,value.sourceHash,value.implementationHash].every(sha)
    &&typeof value.actor==='string'&&/^human:[^\s\p{Cc}]{1,120}$/u.test(value.actor)
    &&typeof value.reason==='string'&&value.reason.trim()===value.reason&&value.reason.length>=4&&value.reason.length<=1000
    &&!/\p{Cc}/u.test(value.reason)&&value.confirmEditorialReviewClips===true);
  return structuredClone(value);
}
export function editorialAvReviewCapabilitySpec(value) {
  return {episodeId:`editorial-av-review/${digest(validateEditorialAvReviewRequest(value))}`,
    operation:EDITORIAL_AV_REVIEW_OPERATION,scopes:[...EDITORIAL_AV_REVIEW_SCOPES],maxCalls:0,maxCostUsd:0};
}
export function assertEditorialAvReviewGrant(request,options) {
  editorialAvReviewNeed(options&&typeof options==='object'&&!Array.isArray(options)
    &&[null,Object.prototype].includes(Object.getPrototypeOf(options))&&Reflect.ownKeys(options).every(key=>{
      const d=Object.getOwnPropertyDescriptor(options,key);return key==='sideEffectGrant'&&d.enumerable&&Object.hasOwn(d,'value');
    }),'editorial_av_review_options_invalid');
  const grant=requireSideEffectGrant(options,editorialAvReviewCapabilitySpec(request),EDITORIAL_AV_REVIEW_OPERATION);
  editorialAvReviewNeed(grant.maxCalls===0&&grant.maxCostUsd===0&&digest([...grant.scopes].sort())===digest([...EDITORIAL_AV_REVIEW_SCOPES].sort()),
    'editorial_av_review_capability_invalid');return grant;
}
export function assertEditorialAvReviewClips(clips,durationInFrames) {
  const fail=()=>{throw editorialAvReviewError('editorial_av_review_clip_limit');};
  if(!Number.isSafeInteger(durationInFrames)||durationInFrames<=0||!Array.isArray(clips)||clips.length<1||clips.length>3)fail();
  let total=0;const ids=new Set();
  for(const clip of clips) {
    if(!clip||typeof clip.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,59}$/u.test(clip.id)||ids.has(clip.id)
      ||!Number.isSafeInteger(clip.fromFrame)||!Number.isSafeInteger(clip.toFrameExclusive)||clip.fromFrame<0
      ||clip.toFrameExclusive<=clip.fromFrame||clip.toFrameExclusive>durationInFrames)fail();
    ids.add(clip.id);total+=clip.toFrameExclusive-clip.fromFrame;
  }
  const sorted=[...clips].sort((a,b)=>a.fromFrame-b.fromFrame);
  if(sorted.some((clip,index)=>index>0&&sorted[index-1].toFrameExclusive>clip.fromFrame)||total>150*30||total>=durationInFrames)fail();
}
function summary(value,input) {
  assertEditorialAvReviewClips(value.clips,value.durationInFrames);
  editorialAvReviewNeed([value.sourceHash,value.implementationHash,value.planSha256].every(sha),'editorial_av_review_inspection_invalid');
  return {...input,planSha256:value.planSha256,sourceHash:value.sourceHash,implementationHash:value.implementationHash,
    snapshotHash:digest(value),clips:structuredClone(value.clips),...value.publicSummary,
    formalRender:false,visualAcceptance:false,releaseEligible:false,paidCalls:0,estimatedCostUsd:0};
}
export function createEditorialAvReviewService({inspect,execute}) {
  if(typeof inspect!=='function'||typeof execute!=='function')throw new TypeError('Incomplete review dependencies');
  async function preview(input) {const checked=validateEditorialAvReviewInput(input);return summary(await inspect(checked),checked);}
  async function render(raw,options={}) {
    const request=validateEditorialAvReviewRequest(raw);assertEditorialAvReviewGrant(request,options);
    const input=validateEditorialAvReviewInput({episodeId:request.episodeId,planPath:request.planPath});
    const value=await inspect(input);const inspected=summary(value,input);
    const assertCurrent=async()=>{
      const next=summary(await inspect(input),input);
      editorialAvReviewNeed(next.snapshotHash===request.snapshotHash,'editorial_av_review_snapshot_changed');
      assertEditorialAvReviewGrant(request,options);
    };
    editorialAvReviewNeed(['snapshotHash','sourceHash','implementationHash','planSha256'].every(key=>request[key]===inspected[key]),
      'editorial_av_review_snapshot_changed');
    assertEditorialAvReviewGrant(request,options);
    return execute({value,request,sideEffectGrant:options.sideEffectGrant,assertCurrent});
  }
  return Object.freeze({preview,render});
}
