import {canonicalJsonDocumentContentSha256} from './durable-json-store.mjs';

export const APPROVED_STORYBOARD_COMPLETION_OPERATION='storyboard:complete-approved';
const fields=['episodeId','artifactVersion','artifactHash','reviewReportId','snapshotHash','actor','reason','confirmApprovedStoryboardCompletion'];
const sha=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value);
const invalid=()=>Object.assign(new Error('已批分镜流转必须绑定当前批准、快照与显式人工声明'),{code:'approved_storyboard_request_invalid',statusCode:409});

function closed(value,keys) {
  if(!value || typeof value!=='object' || Array.isArray(value) || ![null,Object.prototype].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).length===keys.length && keys.every(key=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor && descriptor.enumerable && Object.hasOwn(descriptor,'value');
  });
}
const validId=value=>typeof value==='string' && /^[a-z0-9][a-z0-9-]{0,99}$/u.test(value);

export function validateApprovedStoryboardCompletionPreview(value) {
  if(!closed(value,['episodeId']) || !validId(value.episodeId)) throw invalid();
  return structuredClone(value);
}

export function validateApprovedStoryboardCompletionRequest(value) {
  if(!closed(value,fields) || !validId(value.episodeId) || !Number.isSafeInteger(value.artifactVersion) || value.artifactVersion<1 ||
    !sha(value.artifactHash) || !sha(value.snapshotHash) || typeof value.reviewReportId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,239}$/u.test(value.reviewReportId) ||
    typeof value.actor!=='string' || !/^human:[^\s\p{Cc}]{1,120}$/u.test(value.actor) ||
    typeof value.reason!=='string' || value.reason.trim()!==value.reason || value.reason.length<4 || value.reason.length>1000 || /\p{Cc}/u.test(value.reason) ||
    value.confirmApprovedStoryboardCompletion!==true) throw invalid();
  return structuredClone(value);
}

export function approvedStoryboardCompletionCapabilitySpec(value) {
  return {episodeId:`approved-storyboard/${canonicalJsonDocumentContentSha256(validateApprovedStoryboardCompletionRequest(value))}`,
    operation:APPROVED_STORYBOARD_COMPLETION_OPERATION,scopes:['state.write','filesystem.write'],maxCalls:0,maxCostUsd:0};
}
