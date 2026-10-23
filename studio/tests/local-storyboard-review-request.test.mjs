import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalJsonDocumentContentSha256 as digest} from '../src/shared/durable-json-store.mjs';
import {
  validateLocalStoryboardReviewPreview, validateLocalStoryboardReviewRequest,
  localStoryboardReviewCapabilitySpec, localStoryboardReviewError
} from '../src/shared/local-storyboard-review-request.mjs';

const request = () => ({episodeId: 'synthetic-storyboard-review', storyboardVersion: 1,
  artifactHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), actor: 'human:fixture',
  reason: 'Review the exact synthetic imported storyboard', confirmLocalStoryboardReview: true});
const invalid = {code: 'local_storyboard_review_request_invalid'};

test('local storyboard review requires a closed exact preview and execution binding', () => {
  assert.deepEqual(validateLocalStoryboardReviewPreview({episodeId: request().episodeId}), {episodeId: request().episodeId});
  assert.deepEqual(validateLocalStoryboardReviewRequest(request()), request());
  for (const mutation of [{episodeId: '../escape'}, {episodeId: ''}, {storyboardVersion: 0}, {storyboardVersion: 1.5},
    {storyboardVersion: '1'}, {storyboardVersion: Number.MAX_SAFE_INTEGER + 1}, {artifactHash: 'A'.repeat(64)},
    {snapshotHash: null}, {actor: 'agent:fixture'}, {actor: 'human:with space'}, {reason: 'no'},
    {reason: ' padded '}, {reason: 'line\nbreak'}, {confirmLocalStoryboardReview: false}, {confirmed: true},
    {sideEffectGrant: {}}, {budget: {maxCalls: 1}}]) {
    assert.throws(() => validateLocalStoryboardReviewRequest({...request(), ...mutation}), invalid);
  }
  for (const input of [{}, {episodeId: request().episodeId, gate: 'storyboard'}, {episodeId: '../escape'}]) {
    assert.throws(() => validateLocalStoryboardReviewPreview(input), invalid);
  }
  const missing = request(); delete missing.actor;
  assert.throws(() => validateLocalStoryboardReviewRequest(missing), invalid);
});

test('local storyboard review validators reject accessors, hidden fields and prototypes without evaluating them', () => {
  for (const [validate, valid] of [[validateLocalStoryboardReviewPreview, {episodeId: request().episodeId}],
    [validateLocalStoryboardReviewRequest, request()]]) {
    let reads = 0;
    const getter = {...valid}; Object.defineProperty(getter, 'episodeId', {enumerable: true, get() { reads++; return valid.episodeId; }});
    const hidden = {...valid}; Object.defineProperty(hidden, 'episodeId', {value: valid.episodeId, enumerable: false});
    for (const input of [getter, hidden, {...valid, [Symbol('hidden')]: true}, Object.assign(Object.create({inherited: true}), valid)]) {
      assert.throws(() => validate(input), invalid);
    }
    assert.equal(reads, 0);
    assert.deepEqual(validate(Object.assign(Object.create(null), valid)), valid);
  }
});

test('local storyboard review grants bind every field and grant state writes at zero cost only', () => {
  const value = request(); const spec = localStoryboardReviewCapabilitySpec(value);
  assert.deepEqual(spec, {episodeId: `local-storyboard-review/${digest(value)}`, operation: 'review:storyboard',
    scopes: ['state.write'], maxCalls: 0, maxCostUsd: 0});
  for (const mutation of [{episodeId: 'another-episode'}, {storyboardVersion: 2}, {artifactHash: 'c'.repeat(64)},
    {snapshotHash: 'd'.repeat(64)}, {actor: 'human:another'}, {reason: 'Another explicit reason'}]) {
    assert.notEqual(localStoryboardReviewCapabilitySpec({...value, ...mutation}).episodeId, spec.episodeId);
  }
  assert.equal(localStoryboardReviewError('synthetic-code').statusCode, 409);
});
