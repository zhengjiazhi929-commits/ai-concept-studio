import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocalStoryboardReviewArguments, runLocalStoryboardReviewCli, reportLocalStoryboardReviewCli} from '../scripts/local-storyboard-review.mjs';
import {localStoryboardReviewCapabilitySpec} from '../src/shared/local-storyboard-review-request.mjs';
import {requireSideEffectGrant, consumeSideEffectGrantUsage} from '../src/server/security/side-effect-capability.mjs';

const request = Object.freeze({episodeId: 'local-storyboard-review-cli-fixture', storyboardVersion: 1,
  artifactHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), actor: 'human:fixture',
  reason: 'Review only the exact synthetic storyboard without approving it', confirmLocalStoryboardReview: true});
const previewArgs = ['--episode', request.episodeId];
const argsFor = (value = request) => ['--episode', value.episodeId, '--storyboard-version', String(value.storyboardVersion),
  '--artifact-hash', value.artifactHash, '--snapshot', value.snapshotHash, '--actor', value.actor,
  '--reason', value.reason, '--confirm-local-storyboard-review'];
const hasCode = code => error => error.code === code;

test('local storyboard review CLI defaults to read-only preview and requires all execution fields', () => {
  assert.deepEqual(parseLocalStoryboardReviewArguments(previewArgs), {mode: 'preview', request: {episodeId: request.episodeId}});
  assert.deepEqual(parseLocalStoryboardReviewArguments(['--', ...argsFor()]), {mode: 'execute', request});
  assert.equal(Object.isFrozen(parseLocalStoryboardReviewArguments(argsFor()).request), true);
  for (const flag of ['--episode', '--storyboard-version', '--artifact-hash', '--snapshot', '--actor', '--reason']) {
    const args = argsFor(); args.splice(args.indexOf(flag), 2);
    assert.throws(() => parseLocalStoryboardReviewArguments(args));
  }
  assert.throws(() => parseLocalStoryboardReviewArguments(argsFor().slice(0, -1)));
});

test('CLI rejects malformed flags, numbers and authority overrides', () => {
  const invalid = [[], ['--'], ['--episode'], ['--episode', ''], ['--episode', '  '], ['--episode=fixture'],
    [...argsFor(), 'true'], [...argsFor(), '--confirm-local-storyboard-review'], null, {}, [1],
    argsFor({...request, storyboardVersion: 0}), argsFor({...request, storyboardVersion: -1}),
    argsFor({...request, storyboardVersion: '01'}), argsFor({...request, storyboardVersion: '1.0'}),
    argsFor({...request, storyboardVersion: '1e0'}), argsFor({...request, storyboardVersion: '9007199254740992'}),
    argsFor({...request, actor: 'agent:fixture'}), argsFor({...request, reason: 'line\nbreak'}),
    argsFor({...request, artifactHash: 'bad'}), argsFor({...request, snapshotHash: 'bad'})];
  for (const flag of ['--episode', '--storyboard-version', '--artifact-hash', '--snapshot', '--actor', '--reason',
    '--max-calls', '--max-cost-usd', '--provider', '--review', '--data-root', '--approve', '--operation', '--scopes', '--identity']) {
    invalid.push([...argsFor(), flag, 'fixture']);
  }
  for (const args of invalid) assert.throws(() => parseLocalStoryboardReviewArguments(args));
});

test('preview never grants authority or executes and invalid arguments never reach dependencies', async () => {
  let calls = 0;
  const result = await runLocalStoryboardReviewCli(previewArgs, {
    preview: async (...args) => {calls += 1; assert.deepEqual(args, [{episodeId: request.episodeId}]); return {paidCalls: 0};},
    execute: () => assert.fail('preview cannot execute')
  });
  assert.equal(calls, 1); assert.deepEqual(result, {ok: true, mode: 'preview', preview: {paidCalls: 0}});
  await assert.rejects(runLocalStoryboardReviewCli([...argsFor(), '--provider', 'fake'], {
    preview: () => assert.fail('invalid request cannot read'), execute: () => assert.fail('invalid request cannot write')
  }));
});

test('CLI dependency seam rejects accessors, prototypes, hidden values and additional options', async () => {
  const getter = {}; Object.defineProperty(getter, 'execute', {enumerable: true, get: () => assert.fail('getter ran')});
  const hidden = {}; Object.defineProperty(hidden, 'preview', {value: () => {}, enumerable: false});
  for (const value of [null, [], getter, hidden, {preview: true}, {execute: null},
    Object.create({execute: () => {}}), {[Symbol('hidden')]: () => {}}, {authorizeSideEffect: () => {}},
    {preview: () => {}, identity: 'forbidden'}]) {
    await assert.rejects(runLocalStoryboardReviewCli(previewArgs, value), hasCode('local_storyboard_review_dependencies_invalid'));
  }
});

test('execution signs only a five-minute exact-request zero-cost review grant', async () => {
  const result = await runLocalStoryboardReviewCli(argsFor(), {execute: async (received, options) => {
    assert.deepEqual(received, request); assert.equal(Object.isFrozen(received), true);
    assert.deepEqual(Object.keys(options), ['sideEffectGrant']); assert.equal(Object.isFrozen(options), true);
    const spec = localStoryboardReviewCapabilitySpec(received);
    const grant = requireSideEffectGrant(options, spec, 'review:storyboard');
    assert.match(grant.episodeId, /^local-storyboard-review\/[a-f0-9]{64}$/u);
    assert.equal(grant.operation, 'review:storyboard'); assert.deepEqual(grant.scopes, ['state.write']);
    assert.equal(grant.maxCalls, 0); assert.equal(grant.maxCostUsd, 0);
    assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), 300000);
    for (const sink of ['model.call', 'paid.invoke', 'render:run', 'gate:approve', 'storyboard:import-local', 'worker:storyboard-agent']) {
      assert.throws(() => requireSideEffectGrant(options, spec, sink));
    }
    assert.throws(() => consumeSideEffectGrantUsage(grant, spec, {calls: 1, costUsd: 0}));
    assert.throws(() => consumeSideEffectGrantUsage(grant, spec, {calls: 0, costUsd: 0.01}));
    for (const change of [{episodeId: 'another-fixture'}, {storyboardVersion: 2}, {artifactHash: 'c'.repeat(64)},
      {snapshotHash: 'c'.repeat(64)}, {actor: 'human:another'}, {reason: 'A different declared review'}]) {
      assert.throws(() => requireSideEffectGrant(options, localStoryboardReviewCapabilitySpec({...received, ...change}), 'review:storyboard'));
    }
    return {status: 'synthetic-only', humanApproved: false};
  }});
  assert.deepEqual(result, {ok: true, mode: 'executed', result: {status: 'synthetic-only', humanApproved: false}});
  assert.equal(Object.hasOwn(result, 'sideEffectGrant'), false);
});

test('execution grants expire at their five-minute boundary', async () => {
  await runLocalStoryboardReviewCli(argsFor(), {execute: async (received, options) => {
    const originalNow = Date.now;
    try {
      Date.now = () => Date.parse(options.sideEffectGrant.expiresAt);
      assert.throws(() => requireSideEffectGrant(options, localStoryboardReviewCapabilitySpec(received), 'review:storyboard'), hasCode('side_effect_capability_expired'));
    } finally {Date.now = originalNow;}
    return {status: 'synthetic-only'};
  }});
});

test('CLI output redacts arbitrary error messages and only preserves safe error codes', async () => {
  const previous = {log: console.log, error: console.error, exitCode: process.exitCode};
  const logs = []; const errors = [];
  try {
    console.log = value => logs.push(value); console.error = value => errors.push(value);
    await reportLocalStoryboardReviewCli(async () => ({ok: true, mode: 'preview'}));
    assert.deepEqual(JSON.parse(logs[0]), {ok: true, mode: 'preview'});
    await reportLocalStoryboardReviewCli(async () => {throw Object.assign(new Error('secret fixture detail'), {code: 'local_storyboard_review_snapshot_changed'});});
    await reportLocalStoryboardReviewCli(async () => {throw Object.assign(new Error('secret fixture detail'), {code: 'secret-code'});});
    assert.equal(JSON.parse(errors[0]).code, 'local_storyboard_review_snapshot_changed');
    assert.equal(JSON.parse(errors[1]).code, 'local_storyboard_review_cli_failed');
    assert.equal(process.exitCode, 1); assert.doesNotMatch(errors.join(''), /secret fixture|secret-code/u);
  } finally {console.log = previous.log; console.error = previous.error; process.exitCode = previous.exitCode;}
});
