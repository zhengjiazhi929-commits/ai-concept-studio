import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocalResearchArguments, runLocalResearchCli, reportLocalResearchCli} from '../scripts/local-research.mjs';
import {localResearchCapabilitySpec} from '../src/shared/local-research-request.mjs';
import {requireSideEffectGrant, consumeSideEffectGrantUsage} from '../src/server/security/side-effect-capability.mjs';

const base = {
  episodeId: 'local-research-cli-fixture', action: 'run', candidatePath: null,
  researchVersion: 0, snapshotHash: 'a'.repeat(64), actor: 'human:fixture',
  reason: 'Run only the exact synthetic research snapshot',
  batchId: null, candidateSha256: null, confirmLocalResearch: true
};
const imported = {...base, action: 'import', candidatePath: 'outputs/synthetic-cli-fixture/research-candidate.json',
  batchId: 'synthetic-research-batch', candidateSha256: 'b'.repeat(64), researchVersion: 1};
const previewArgs = value => ['--episode', value.episodeId, '--action', value.action,
  ...(value.action === 'import' ? ['--candidate', value.candidatePath] : [])];
const args = (value = base) => [...previewArgs(value), '--research-version', String(value.researchVersion),
  '--snapshot', value.snapshotHash, '--actor', value.actor, '--reason', value.reason,
  ...(value.action === 'import' ? ['--batch-id', value.batchId, '--candidate-sha256', value.candidateSha256] : []),
  '--confirm-local-research'];
const hasCode = code => error => error.code === code;

test('local research CLI previews run/import and requires complete explicit execution arguments', () => {
  assert.deepEqual(parseLocalResearchArguments(previewArgs(base)), {
    mode: 'preview', request: {episodeId: base.episodeId, action: 'run', candidatePath: null}
  });
  assert.deepEqual(parseLocalResearchArguments(previewArgs(imported)), {
    mode: 'preview', request: {episodeId: imported.episodeId, action: 'import', candidatePath: imported.candidatePath}
  });
  assert.deepEqual(parseLocalResearchArguments(['--', ...args()]), {mode: 'execute', request: base});
  assert.deepEqual(parseLocalResearchArguments(args(imported)), {mode: 'execute', request: imported});
  assert.equal(Object.isFrozen(parseLocalResearchArguments(args()).request), true);
});

test('local research CLI rejects missing/duplicate/foreign flags and malformed numeric values', () => {
  const invalid = [[], ['--episode'], ['--episode', base.episodeId], ['--action', 'run'],
    args().slice(0, -1), [...previewArgs(base), '--candidate', 'fixture.json'],
    ['--episode', base.episodeId, '--action', 'import'],
    [...args(), '--candidate', 'fixture.json'], [...args(), '--batch-id', 'extra-batch'],
    [...args(), '--candidate-sha256', 'b'.repeat(64)],
    [...args(), '--episode', 'another'], [...args(), '--confirm-local-research'],
    [...args(), '--max-calls', '0'], [...args(), '--provider', 'fake'],
    [...args(), '--data-root', '/tmp/not-allowed'], [...args(), '--operation', 'other'],
    [...args(), '--scopes', 'paid.invoke'], [...args(), '--identity', 'fixture.json'],
    args({...base, action: 'approve'}), args({...base, researchVersion: -1}),
    args({...base, researchVersion: '01'}), args({...base, researchVersion: '1.0'}),
    args({...base, researchVersion: '1e0'}), args({...base, researchVersion: '9007199254740992'}),
    args({...base, reason: 'line\nbreak'}), args({...base, actor: 'agent:fixture'}),
    args({...base, snapshotHash: 'bad'}), null, [1]];
  for (const input of invalid) assert.throws(() => parseLocalResearchArguments(input));
  for (const flag of ['--research-version', '--snapshot', '--actor', '--reason', '--batch-id', '--candidate-sha256']) {
    const input = args(imported); const index = input.indexOf(flag); input.splice(index, 2);
    assert.throws(() => parseLocalResearchArguments(input), undefined, flag);
  }
});

test('preview passes only preview fields, without authority or execution', async () => {
  for (const value of [base, imported]) {
    let called = 0;
    const result = await runLocalResearchCli(previewArgs(value), {
      preview: async (...received) => {
        called += 1;
        assert.deepEqual(received, [{episodeId: value.episodeId, action: value.action, candidatePath: value.candidatePath}]);
        return {snapshotHash: 'c'.repeat(64), paidCalls: 0};
      },
      execute: () => assert.fail('preview cannot execute')
    });
    assert.equal(called, 1); assert.equal(result.mode, 'preview'); assert.equal(result.ok, true);
  }
});

test('dependency seam only accepts own enumerable preview/execute functions without evaluating accessors', async () => {
  const getter = {}; Object.defineProperty(getter, 'preview', {enumerable: true, get: () => assert.fail('getter ran')});
  const hidden = {}; Object.defineProperty(hidden, 'preview', {value: () => {}, enumerable: false});
  for (const value of [null, [], {preview: true}, {execute: null}, getter, hidden,
    {authorizeSideEffect: () => assert.fail('unauthorized authority')},
    Object.create({preview: () => assert.fail('inherited function')}),
    {[Symbol('hidden')]: () => {}}, {preview: () => {}, identity: () => {}}]) {
    await assert.rejects(runLocalResearchCli(previewArgs(base), value), hasCode('local_research_dependencies_invalid'));
  }
});

test('execution signs a short-lived request-bound zero-cost grant and refuses unrelated sinks', async () => {
  for (const value of [base, imported]) {
    const result = await runLocalResearchCli(args(value), {execute: async (received, options) => {
      assert.deepEqual(received, value); assert.equal(Object.isFrozen(received), true);
      assert.equal(Object.isFrozen(options), true); assert.deepEqual(Object.keys(options), ['sideEffectGrant']);
      const spec = localResearchCapabilitySpec(received);
      const grant = requireSideEffectGrant(options, spec, spec.operation);
      assert.match(grant.episodeId, /^local-research\/[a-f0-9]{64}$/u);
      assert.equal(grant.operation, value.action === 'run' ? 'worker:research-agent' : 'research:import-evidence');
      assert.deepEqual([...grant.scopes].sort(), value.action === 'run'
        ? ['filesystem.write', 'network.request', 'state.write'] : ['filesystem.write', 'state.write']);
      assert.equal(grant.maxCalls, 0); assert.equal(grant.maxCostUsd, 0);
      assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), 300000);
      for (const sink of ['model.call', 'paid.invoke', 'render:run', value.action === 'run' ? 'research:import-evidence' : 'worker:research-agent']) {
        assert.throws(() => requireSideEffectGrant(options, spec, sink), hasCode('local_research_sink_forbidden'));
      }
      assert.throws(() => consumeSideEffectGrantUsage(grant, spec, {calls: 1, costUsd: 0}), hasCode('side_effect_capability_calls_exceeded'));
      assert.throws(() => consumeSideEffectGrantUsage(grant, spec, {calls: 0, costUsd: 0.01}), hasCode('side_effect_capability_cost_exceeded'));
      for (const change of [{episodeId: 'another-fixture'}, {actor: 'human:another'}, {snapshotHash: 'c'.repeat(64)}, {researchVersion: value.researchVersion + 1},
        ...(value.action === 'import' ? [{batchId: 'another-batch'}, {candidateSha256: 'd'.repeat(64)}, {candidatePath: 'outputs/synthetic-cli-fixture/other.json'}] : [])]) {
        assert.throws(() => requireSideEffectGrant(options, localResearchCapabilitySpec({...received, ...change}), spec.operation));
      }
      assert.throws(() => requireSideEffectGrant(options, localResearchCapabilitySpec(value.action === 'run' ? imported : base), spec.operation));
      return {status: 'synthetic-only', paidCalls: 0};
    }});
    assert.deepEqual(result, {ok: true, mode: 'executed', result: {status: 'synthetic-only', paidCalls: 0}});
  }
});

test('expired execution grants cannot be reused after the five minute window', async () => {
  await runLocalResearchCli(args(), {execute: async (received, options) => {
    const spec = localResearchCapabilitySpec(received);
    const originalNow = Date.now;
    try {
      Date.now = () => Date.parse(options.sideEffectGrant.expiresAt);
      assert.throws(() => requireSideEffectGrant(options, spec, spec.operation), hasCode('side_effect_capability_expired'));
    } finally { Date.now = originalNow; }
    return {status: 'synthetic-only'};
  }});
});

test('CLI reporting preserves known failure codes and redacts arbitrary errors', async () => {
  const previousError = console.error; const previousLog = console.log; const previousExit = process.exitCode;
  const errors = []; const logs = [];
  try {
    console.error = value => errors.push(value); console.log = value => logs.push(value);
    await reportLocalResearchCli(async () => ({ok: true, mode: 'preview'}));
    assert.deepEqual(JSON.parse(logs[0]), {ok: true, mode: 'preview'});
    await reportLocalResearchCli(async () => { throw Object.assign(new Error('sensitive fixture detail'), {code: 'local_research_snapshot_changed'}); });
    assert.equal(JSON.parse(errors[0]).code, 'local_research_snapshot_changed');
    await reportLocalResearchCli(async () => { throw Object.assign(new Error('sensitive fixture detail'), {code: 'secret-unknown-code'}); });
    assert.equal(process.exitCode, 1); assert.equal(JSON.parse(errors[1]).code, 'local_research_cli_failed');
    assert.doesNotMatch(errors.join(''), /sensitive|secret-unknown-code/u);
  } finally {console.error = previousError; console.log = previousLog; process.exitCode = previousExit;}
});
