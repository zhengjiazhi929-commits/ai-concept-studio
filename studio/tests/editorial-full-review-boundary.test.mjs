import test from 'node:test';
import assert from 'node:assert/strict';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {editorialFullReviewCapabilitySpec} from '../src/server/production/editorial-full-review-core.mjs';
import * as sealed from '../src/server/production/editorial-full-review.mjs';
import {
  ensureDefaultTrendSignals, ingestTrendSignal, approveTrendCandidate,
} from '../src/server/trends/agent.mjs';
import {runEpisodeResearchAgent} from '../src/server/research/agent.mjs';

// Only synthetic requests and in-memory traps. No live Episode, user outputs,
// renderer, external provider, or real side-effect dependency is invoked.
const request = () => ({
  episodeId: 'synthetic-full-boundary',
  planPath: 'outputs/studio/synthetic-full-boundary/editorial-full-review-plans/synthetic.json',
  planSha256: '1'.repeat(64), snapshotHash: '2'.repeat(64),
  sourceHash: '3'.repeat(64), implementationHash: '4'.repeat(64),
  actor: 'human:synthetic-boundary', reason: 'Verify a synthetic private review boundary',
  confirmEditorialFullReview: true,
});
const authority = () => createCapabilityAuthority({
  secret: 'synthetic-full-boundary-secret-not-real-0000',
  maximumCalls: 0, maximumCostUsd: 0,
});
function memoryTraps() {
  const effects = [];
  const names = [
    'appendEvent', 'importTrendSnapshot', 'listEpisodes', 'readConceptTaxonomy',
    'readTrendRadarConfig', 'readTrendSignals', 'readTrendSources', 'writeTrendRun',
    'selectTrendCandidate', 'createEpisodeFromTrendSelection', 'appendTrendSignal',
    'fileRecord', 'readLatestResearchPack', 'readResearchPackAtPath',
    'readResearchConfig', 'writeResearchAssistTask', 'writeResearchPack', 'inspectPrimarySource',
  ];
  return {effects, dependencies: Object.fromEntries(names.map(name => [name, async () => {
    effects.push(name);
    assert.fail(`Real entry crossed its capability boundary: ${name}`);
  }]))};
}
const sinks = [
  ['ensureDefaultTrendSignals', options => ensureDefaultTrendSignals(options)],
  ['ingestTrendSignal', options => ingestTrendSignal({id: 'synthetic-signal'}, options)],
  ['approveTrendCandidate', options => approveTrendCandidate('synthetic-concept', '', options)],
  ['runEpisodeResearchAgent', options => runEpisodeResearchAgent({id: options.episodeId}, options)],
];

for (const authorizationMode of ['sideEffectGrant', 'authorizeSideEffect']) {
  for (const [sink, invoke] of sinks) {
    test(`full grant cannot reach real ${sink} through ${authorizationMode} and caller overrides`, async () => {
      const spec = editorialFullReviewCapabilitySpec(request());
      const grant = authority().authorize(spec);
      const fixture = memoryTraps();
      const auth = authorizationMode === 'sideEffectGrant'
        ? {sideEffectGrant: grant} : {authorizeSideEffect: () => grant};
      await assert.rejects(invoke({
        ...auth, dependencies: fixture.dependencies, requireSideEffectCapability: true,
        episodeId: spec.episodeId, capabilityOperation: spec.operation,
        // These hostile caller overrides must not replace sink-owned scopes.
        scopes: [...spec.scopes], sinkOperation: spec.operation, actor: 'human:synthetic-boundary',
      }), {code: 'side_effect_capability_scope_mismatch'});
      assert.deepEqual(fixture.effects, []);
    });
  }
}

test('sealed full review module exposes only preview and authorized render', () => {
  assert.deepEqual(Object.keys(sealed).sort(), ['previewEditorialFullReview', 'renderEditorialFullReview']);
  const r = request(), input = {episodeId: r.episodeId, planPath: r.planPath};
  assert.throws(() => sealed.previewEditorialFullReview(input, {}), TypeError);
  assert.throws(() => sealed.renderEditorialFullReview(r, {}, {}), TypeError);
});

test('sealed render rejects missing and forged grants before resolving any synthetic source', async () => {
  const r = request();
  await assert.rejects(sealed.renderEditorialFullReview(r), {code: 'side_effect_capability_missing'});
  await assert.rejects(sealed.renderEditorialFullReview(r, {
    sideEffectGrant: editorialFullReviewCapabilitySpec(r),
  }), {code: 'side_effect_capability_missing'});
});

test('sealed render rejects dependency, authority and capability overrides before source I/O', async () => {
  const r = request(), sideEffectGrant = authority().authorize(editorialFullReviewCapabilitySpec(r));
  let invoked = 0;
  const trap = () => {invoked++; assert.fail('Injected boundary must never run');};
  for (const options of [
    {sideEffectGrant, dependencies: {inspect: trap, execute: trap}},
    {sideEffectGrant, execute: trap},
    {sideEffectGrant, inspect: trap},
    {sideEffectGrant, authorizeSideEffect: trap},
    {sideEffectGrant, capabilityOperation: 'review:render-editorial-clips'},
    {sideEffectGrant, scopes: ['filesystem.write']},
  ]) {
    await assert.rejects(sealed.renderEditorialFullReview(r, options), {
      code: 'editorial_full_review_options_invalid',
    });
  }
  assert.equal(invoked, 0);
});

test('sealed render rejects accessor options and broader grants before source I/O', async () => {
  const r = request();
  const options = {};
  Object.defineProperty(options, 'sideEffectGrant', {
    enumerable: true, get: () => assert.fail('Grant getter must not execute'),
  });
  await assert.rejects(sealed.renderEditorialFullReview(r, options), {
    code: 'editorial_full_review_options_invalid',
  });
  const spec = editorialFullReviewCapabilitySpec(r);
  const broadGrant = authority().authorize({...spec, scopes: [...spec.scopes, 'filesystem.write']});
  await assert.rejects(sealed.renderEditorialFullReview(r, {sideEffectGrant: broadGrant}), {
    code: 'editorial_full_review_capability_invalid',
  });
});
