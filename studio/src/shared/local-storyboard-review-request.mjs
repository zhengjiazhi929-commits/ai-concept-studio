import {canonicalJsonDocumentContentSha256} from './durable-json-store.mjs';

export const LOCAL_STORYBOARD_REVIEW_OPERATION = 'review:storyboard';
const previewFields = ['episodeId'];
const requestFields = [...previewFields, 'storyboardVersion', 'artifactHash', 'snapshotHash', 'actor', 'reason', 'confirmLocalStoryboardReview'];
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const sha256 = /^[a-f0-9]{64}$/u;

export function localStoryboardReviewError(code, message = '本地分镜审核请求或证据绑定已变化，请重新预览') {
  return Object.assign(new Error(message), {code, statusCode: 409});
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).length === fields.length && fields.every(field => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable;
  });
}

export function validateLocalStoryboardReviewPreview(input) {
  if (!exactFields(input, previewFields) || typeof input.episodeId !== 'string' || !identifier.test(input.episodeId)) {
    throw localStoryboardReviewError('local_storyboard_review_request_invalid');
  }
  return structuredClone(input);
}

export function validateLocalStoryboardReviewRequest(input) {
  if (!exactFields(input, requestFields) || typeof input.episodeId !== 'string' || !identifier.test(input.episodeId)
    || !Number.isSafeInteger(input.storyboardVersion) || input.storyboardVersion < 1
    || typeof input.artifactHash !== 'string' || !sha256.test(input.artifactHash)
    || typeof input.snapshotHash !== 'string' || !sha256.test(input.snapshotHash)
    || typeof input.actor !== 'string' || !/^human:[^\s\p{Cc}]{1,120}$/u.test(input.actor)
    || typeof input.reason !== 'string' || input.reason.trim() !== input.reason
    || input.reason.length < 4 || input.reason.length > 1000 || /\p{Cc}/u.test(input.reason)
    || input.confirmLocalStoryboardReview !== true) throw localStoryboardReviewError('local_storyboard_review_request_invalid');
  return structuredClone(input);
}

export function localStoryboardReviewCapabilitySpec(input) {
  const request = validateLocalStoryboardReviewRequest(input);
  return {episodeId: `local-storyboard-review/${canonicalJsonDocumentContentSha256(request)}`,
    operation: LOCAL_STORYBOARD_REVIEW_OPERATION, scopes: ['state.write'], maxCalls: 0, maxCostUsd: 0};
}
