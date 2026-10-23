import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {approvedScriptFixture} from './approved-script-fixture.mjs';
import {prepareGateForHumanReview} from '../src/shared/workflow.mjs';
import {createLocalScriptReviewService} from '../src/server/reviews/local-script-review-core.mjs';
import {previewLocalScriptReview, executeLocalScriptReview} from '../src/server/reviews/local-script-review.mjs';
import {localScriptReviewCapabilitySpec} from '../src/shared/local-script-review-request.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';

const implementation = Object.freeze({version: 'synthetic-review-implementation-v1', hash: 'a'.repeat(64)});
const hasCode = code => error => error.code === code;
async function fixture(t) {
  const f = await approvedScriptFixture(t);
  const pending = prepareGateForHumanReview(await f.deps.readEpisode(), {gate: 'script', reason: 'Synthetic review-entry fixture only'}).episode;
  await f.deps.writeEpisode(pending);
  const calls = [];
  const dependencies = {workspaceRoot: f.root, readEpisode: f.deps.readEpisode, readReviewConfig: f.deps.readReviewConfig,
    readImplementationFingerprint: async () => structuredClone(implementation),
    recheckGateReview: async (...args) => {calls.push(args); return {status: 'synthetic-only'};}};
  const service = createLocalScriptReviewService(dependencies);
  return {...f, dependencies, service, calls};
}
async function requestFor(f) {
  const preview = await f.service.previewLocalScriptReview({episodeId: f.episode.id});
  return {episodeId: preview.episodeId, scriptVersion: preview.scriptVersion, artifactHash: preview.artifactHash,
    snapshotHash: preview.snapshotHash, actor: 'human:fixture', reason: 'Run the exact synthetic deterministic review', confirmLocalScriptReview: true};
}
function grantFor(request) {
  return createCapabilityAuthority({secret: 'synthetic-script-review-core-secret-only-000000000'}).authorize(localScriptReviewCapabilitySpec(request));
}

test('core preview inspects synthetic files without writes or Kernel execution', async t => {
  const f = await fixture(t); const before = await readFile(f.episodePath, 'utf8');
  const preview = await f.service.previewLocalScriptReview({episodeId: f.episode.id});
  assert.equal(preview.episodeId, f.episode.id); assert.equal(preview.scriptVersion, 1);
  assert.match(preview.artifactHash, /^[a-f0-9]{64}$/u); assert.match(preview.snapshotHash, /^[a-f0-9]{64}$/u);
  assert.equal(preview.humanApproved, false); assert.equal(preview.paidCalls, 0); assert.equal(preview.estimatedCostUsd, 0);
  assert.deepEqual(preview.implementationFingerprint, implementation);
  assert.equal(await readFile(f.episodePath, 'utf8'), before); assert.equal(f.calls.length, 0);
});

test('core validates grant before Episode or config reads and rejects extra options without accessors', async () => {
  const forbidden = () => assert.fail('unauthorized call cannot read or execute');
  const service = createLocalScriptReviewService({workspaceRoot: '/synthetic-only', readEpisode: forbidden,
    readReviewConfig: forbidden, readImplementationFingerprint: forbidden, recheckGateReview: forbidden});
  const request = {episodeId: 'synthetic-review', scriptVersion: 1, artifactHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64),
    actor: 'human:fixture', reason: 'Synthetic invalid grant check', confirmLocalScriptReview: true};
  await assert.rejects(service.executeLocalScriptReview(request), hasCode('side_effect_capability_missing'));
  const sideEffectGrant = grantFor(request);
  const getter = {}; Object.defineProperty(getter, 'sideEffectGrant', {enumerable: true, get: forbidden});
  const hidden = {}; Object.defineProperty(hidden, 'sideEffectGrant', {value: sideEffectGrant, enumerable: false});
  for (const options of [null, [], getter, hidden, Object.create({sideEffectGrant}), {[Symbol('x')]: sideEffectGrant},
    {sideEffectGrant, review: {}}, {sideEffectGrant, provider: forbidden}, {sideEffectGrant, readEpisode: forbidden},
    {sideEffectGrant, now: 'forbidden'}, {sideEffectGrant, workspaceRoot: '/forbidden'}]) {
    await assert.rejects(service.executeLocalScriptReview(request, options), hasCode('local_script_review_options_invalid'));
  }
});

test('core passes only exact request and grant to the real Kernel seam', async t => {
  const f = await fixture(t); const request = await requestFor(f); const sideEffectGrant = grantFor(request);
  const result = await f.service.executeLocalScriptReview(request, {sideEffectGrant});
  assert.deepEqual(result, {status: 'synthetic-only'}); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], [f.episode.id, 'script', {localScriptReviewRequest: request, sideEffectGrant}]);
  assert.equal(Object.isFrozen(f.calls[0][2]), true); assert.equal(Object.isFrozen(f.calls[0][2].localScriptReviewRequest), true);
  assert.equal((await f.deps.readEpisode()).approvals.script.status, 'pending');
});

test('core rejects changed snapshot, version, artifact and implementation before dispatch', async t => {
  const f = await fixture(t); const request = await requestFor(f);
  for (const change of [{snapshotHash: 'c'.repeat(64)}, {scriptVersion: 2}, {artifactHash: 'c'.repeat(64)}]) {
    const changed = {...request, ...change};
    await assert.rejects(f.service.executeLocalScriptReview(changed, {sideEffectGrant: grantFor(changed)}));
  }
  const changedService = createLocalScriptReviewService({...f.dependencies,
    readImplementationFingerprint: async () => ({...implementation, hash: 'b'.repeat(64)})});
  await assert.rejects(changedService.executeLocalScriptReview(request, {sideEffectGrant: grantFor(request)}), hasCode('local_script_review_snapshot_changed'));
  assert.equal(f.calls.length, 0);
});

test('core rejects Episode mismatch and rechecks expiry after asynchronous inspection', async t => {
  const f = await fixture(t); const request = await requestFor(f);
  const mismatched = createLocalScriptReviewService({...f.dependencies, readEpisode: async () => ({...(await f.deps.readEpisode()), id: 'different-fixture'})});
  await assert.rejects(mismatched.previewLocalScriptReview({episodeId: f.episode.id}), hasCode('local_script_review_episode_invalid'));
  const sideEffectGrant = grantFor(request); const originalNow = Date.now;
  const expiring = createLocalScriptReviewService({...f.dependencies, readImplementationFingerprint: async () => {
    Date.now = () => Date.parse(sideEffectGrant.expiresAt); return structuredClone(implementation);
  }});
  try {
    await assert.rejects(expiring.executeLocalScriptReview(request, {sideEffectGrant}), hasCode('side_effect_capability_expired'));
  } finally {Date.now = originalNow;}
  assert.equal(f.calls.length, 0);
});

test('production wrapper refuses injection and missing authority before live reads', async () => {
  const request = {episodeId: 'never-read-production-fixture', scriptVersion: 1, artifactHash: 'a'.repeat(64),
    snapshotHash: 'b'.repeat(64), actor: 'human:fixture', reason: 'Synthetic production boundary only', confirmLocalScriptReview: true};
  assert.throws(() => previewLocalScriptReview({episodeId: request.episodeId}, {readEpisode: () => {}}), /does not accept overrides/u);
  assert.throws(() => executeLocalScriptReview(request, {}, {}), /does not accept overrides/u);
  await assert.rejects(executeLocalScriptReview(request), hasCode('side_effect_capability_missing'));
  for (const options of [{review: {}}, {readEpisode: () => {}}, {workspaceRoot: '/synthetic-only'},
    {readImplementationFingerprint: () => implementation}, {recheckGateReview: () => {}}]) {
    await assert.rejects(executeLocalScriptReview(request, options), hasCode('local_script_review_options_invalid'));
  }
});
