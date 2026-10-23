import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocalScriptReviewArguments, runLocalScriptReviewCli, reportLocalScriptReviewCli} from '../scripts/local-script-review.mjs';
import {localScriptReviewCapabilitySpec} from '../src/shared/local-script-review-request.mjs';
import {requireSideEffectGrant, consumeSideEffectGrantUsage} from '../src/server/security/side-effect-capability.mjs';

const request = Object.freeze({episodeId: 'local-script-review-cli-fixture', scriptVersion: 1,
  artifactHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), actor: 'human:fixture',
  reason: 'Review only the exact synthetic script without approving it', confirmLocalScriptReview: true});
const previewArgs = ['--episode', request.episodeId];
const argsFor = (value = request) => ['--episode', value.episodeId, '--script-version', String(value.scriptVersion),
  '--artifact-hash', value.artifactHash, '--snapshot', value.snapshotHash, '--actor', value.actor,
  '--reason', value.reason, '--confirm-local-script-review'];
const hasCode = code => error => error.code === code;

test('local script review CLI defaults to read-only preview and requires all execution fields', () => {
  assert.deepEqual(parseLocalScriptReviewArguments(previewArgs), {mode: 'preview', request: {episodeId: request.episodeId}});
  assert.deepEqual(parseLocalScriptReviewArguments(['--', ...argsFor()]), {mode: 'execute', request});
  assert.equal(Object.isFrozen(parseLocalScriptReviewArguments(argsFor()).request), true);
  for (const flag of ['--episode', '--script-version', '--artifact-hash', '--snapshot', '--actor', '--reason']) {
    const args = argsFor(); args.splice(args.indexOf(flag), 2);
    assert.throws(() => parseLocalScriptReviewArguments(args));
  }
  assert.throws(() => parseLocalScriptReviewArguments(argsFor().slice(0, -1)));
});

test('CLI rejects malformed flags, numbers and authority overrides', () => {
  const invalid = [[], ['--'], ['--episode'], ['--episode', ''], ['--episode', '  '], ['--episode=fixture'],
    [...argsFor(), 'true'], [...argsFor(), '--confirm-local-script-review'], null, {}, [1],
    argsFor({...request, scriptVersion: 0}), argsFor({...request, scriptVersion: -1}),
    argsFor({...request, scriptVersion: '01'}), argsFor({...request, scriptVersion: '1.0'}),
    argsFor({...request, scriptVersion: '1e0'}), argsFor({...request, scriptVersion: '9007199254740992'}),
    argsFor({...request, actor: 'agent:fixture'}), argsFor({...request, reason: 'line\nbreak'}),
    argsFor({...request, artifactHash: 'bad'}), argsFor({...request, snapshotHash: 'bad'})];
  for (const flag of ['--episode', '--script-version', '--artifact-hash', '--snapshot', '--actor', '--reason',
    '--max-calls', '--max-cost-usd', '--provider', '--review', '--data-root', '--approve', '--operation', '--scopes', '--identity']) {
    invalid.push([...argsFor(), flag, 'fixture']);
  }
  for (const args of invalid) assert.throws(() => parseLocalScriptReviewArguments(args));
});

test('preview never grants authority or executes and invalid arguments never reach dependencies', async () => {
  let calls = 0;
  const result = await runLocalScriptReviewCli(previewArgs, {
    preview: async (...args) => {calls += 1; assert.deepEqual(args, [{episodeId: request.episodeId}]); return {paidCalls: 0};},
    execute: () => assert.fail('preview cannot execute')
  });
  assert.equal(calls, 1); assert.deepEqual(result, {ok: true, mode: 'preview', preview: {paidCalls: 0}});
  await assert.rejects(runLocalScriptReviewCli([...argsFor(), '--provider', 'fake'], {
    preview: () => assert.fail('invalid request cannot read'), execute: () => assert.fail('invalid request cannot write')
  }));
});

test('CLI dependency seam rejects accessors, prototypes, hidden values and additional options', async () => {
  const getter = {}; Object.defineProperty(getter, 'execute', {enumerable: true, get: () => assert.fail('getter ran')});
  const hidden = {}; Object.defineProperty(hidden, 'preview', {value: () => {}, enumerable: false});
  for (const value of [null, [], getter, hidden, {preview: true}, {execute: null},
    Object.create({execute: () => {}}), {[Symbol('hidden')]: () => {}}, {authorizeSideEffect: () => {}},
    {preview: () => {}, identity: 'forbidden'}]) {
    await assert.rejects(runLocalScriptReviewCli(previewArgs, value), hasCode('local_script_review_dependencies_invalid'));
  }
});

test('execution signs only a five-minute exact-request zero-cost review grant', async () => {
  const result = await runLocalScriptReviewCli(argsFor(), {execute: async (received, options) => {
    assert.deepEqual(received, request); assert.equal(Object.isFrozen(received), true);
    assert.deepEqual(Object.keys(options), ['sideEffectGrant']); assert.equal(Object.isFrozen(options), true);
    const spec = localScriptReviewCapabilitySpec(received);
    const grant = requireSideEffectGrant(options, spec, 'review:script');
    assert.match(grant.episodeId, /^local-script-review\/[a-f0-9]{64}$/u);
    assert.equal(grant.operation, 'review:script'); assert.deepEqual(grant.scopes, ['state.write']);
    assert.equal(grant.maxCalls, 0); assert.equal(grant.maxCostUsd, 0);
    assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), 300000);
    for (const sink of ['model.call', 'paid.invoke', 'render:run', 'gate:approve', 'script:import-local', 'worker:script-agent']) {
      assert.throws(() => requireSideEffectGrant(options, spec, sink));
    }
    assert.throws(() => consumeSideEffectGrantUsage(grant, spec, {calls: 1, costUsd: 0}));
    assert.throws(() => consumeSideEffectGrantUsage(grant, spec, {calls: 0, costUsd: 0.01}));
    for (const change of [{episodeId: 'another-fixture'}, {scriptVersion: 2}, {artifactHash: 'c'.repeat(64)},
      {snapshotHash: 'c'.repeat(64)}, {actor: 'human:another'}, {reason: 'A different declared review'}]) {
      assert.throws(() => requireSideEffectGrant(options, localScriptReviewCapabilitySpec({...received, ...change}), 'review:script'));
    }
    return {status: 'synthetic-only', humanApproved: false};
  }});
  assert.deepEqual(result, {ok: true, mode: 'executed', result: {status: 'synthetic-only', humanApproved: false}});
  assert.equal(Object.hasOwn(result, 'sideEffectGrant'), false);
});

test('execution grants expire at their five-minute boundary', async () => {
  await runLocalScriptReviewCli(argsFor(), {execute: async (received, options) => {
    const originalNow = Date.now;
    try {
      Date.now = () => Date.parse(options.sideEffectGrant.expiresAt);
      assert.throws(() => requireSideEffectGrant(options, localScriptReviewCapabilitySpec(received), 'review:script'), hasCode('side_effect_capability_expired'));
    } finally {Date.now = originalNow;}
    return {status: 'synthetic-only'};
  }});
});

test('CLI output redacts arbitrary error messages and only preserves safe error codes', async () => {
  const previous = {log: console.log, error: console.error, exitCode: process.exitCode};
  const logs = []; const errors = [];
  try {
    console.log = value => logs.push(value); console.error = value => errors.push(value);
    await reportLocalScriptReviewCli(async () => ({ok: true, mode: 'preview'}));
    assert.deepEqual(JSON.parse(logs[0]), {ok: true, mode: 'preview'});
    await reportLocalScriptReviewCli(async () => {throw Object.assign(new Error('secret fixture detail'), {code: 'local_script_review_snapshot_changed'});});
    await reportLocalScriptReviewCli(async () => {throw Object.assign(new Error('secret fixture detail'), {code: 'secret-code'});});
    assert.equal(JSON.parse(errors[0]).code, 'local_script_review_snapshot_changed');
    assert.equal(JSON.parse(errors[1]).code, 'local_script_review_cli_failed');
    assert.equal(process.exitCode, 1); assert.doesNotMatch(errors.join(''), /secret fixture|secret-code/u);
  } finally {console.log = previous.log; console.error = previous.error; process.exitCode = previous.exitCode;}
});
