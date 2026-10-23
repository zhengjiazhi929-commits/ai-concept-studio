import assert from 'node:assert/strict';
import test from 'node:test';
import {canonicalJsonDocumentContentSha256 as digest} from '../src/shared/durable-json-store.mjs';
import {
  validateLocalScriptReviewPreview, validateLocalScriptReviewRequest,
  localScriptReviewCapabilitySpec, localScriptReviewError
} from '../src/shared/local-script-review-request.mjs';

const request = () => ({episodeId: 'synthetic-script-review', scriptVersion: 1,
  artifactHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), actor: 'human:fixture',
  reason: 'Review the exact synthetic imported script', confirmLocalScriptReview: true});
const invalid = {code: 'local_script_review_request_invalid'};

test('local script review requires a closed exact preview and execution binding', () => {
  assert.deepEqual(validateLocalScriptReviewPreview({episodeId: request().episodeId}), {episodeId: request().episodeId});
  assert.deepEqual(validateLocalScriptReviewRequest(request()), request());
  for (const mutation of [{episodeId: '../escape'}, {episodeId: ''}, {scriptVersion: 0}, {scriptVersion: 1.5},
    {scriptVersion: '1'}, {scriptVersion: Number.MAX_SAFE_INTEGER + 1}, {artifactHash: 'A'.repeat(64)},
    {snapshotHash: null}, {actor: 'agent:fixture'}, {actor: 'human:with space'}, {reason: 'no'},
    {reason: ' padded '}, {reason: 'line\nbreak'}, {confirmLocalScriptReview: false}, {confirmed: true},
    {sideEffectGrant: {}}, {budget: {maxCalls: 1}}]) {
    assert.throws(() => validateLocalScriptReviewRequest({...request(), ...mutation}), invalid);
  }
  for (const input of [{}, {episodeId: request().episodeId, gate: 'script'}, {episodeId: '../escape'}]) {
    assert.throws(() => validateLocalScriptReviewPreview(input), invalid);
  }
  const missing = request(); delete missing.actor;
  assert.throws(() => validateLocalScriptReviewRequest(missing), invalid);
});

test('local script review validators reject accessors, hidden fields and prototypes without evaluating them', () => {
  for (const [validate, valid] of [[validateLocalScriptReviewPreview, {episodeId: request().episodeId}],
    [validateLocalScriptReviewRequest, request()]]) {
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

test('local script review grants bind every field and grant state writes at zero cost only', () => {
  const value = request(); const spec = localScriptReviewCapabilitySpec(value);
  assert.deepEqual(spec, {episodeId: `local-script-review/${digest(value)}`, operation: 'review:script',
    scopes: ['state.write'], maxCalls: 0, maxCostUsd: 0});
  for (const mutation of [{episodeId: 'another-episode'}, {scriptVersion: 2}, {artifactHash: 'c'.repeat(64)},
    {snapshotHash: 'd'.repeat(64)}, {actor: 'human:another'}, {reason: 'Another explicit reason'}]) {
    assert.notEqual(localScriptReviewCapabilitySpec({...value, ...mutation}).episodeId, spec.episodeId);
  }
  assert.equal(localScriptReviewError('synthetic-code').statusCode, 409);
});
