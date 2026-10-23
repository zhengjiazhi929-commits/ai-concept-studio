import test from 'node:test';
import assert from 'node:assert/strict';
import {createCapabilityAuthority, requireSideEffectGrant} from '../src/server/security/side-effect-capability.mjs';

const spec = {
  episodeId: `local-script-review/${'a'.repeat(64)}`,
  operation: 'review:script',
  scopes: ['state.write'],
  maxCalls: 0,
  maxCostUsd: 0
};
const authority = () => createCapabilityAuthority({secret: 'synthetic-review-test-authority-not-a-real-secret', maximumCalls: 1, maximumCostUsd: 1});

test('local script review grant permits only its declared zero-cost review sink', () => {
  const sideEffectGrant = authority().authorize(spec);
  assert.equal(requireSideEffectGrant({sideEffectGrant}, spec, 'review:script'), sideEffectGrant);
  for (const sink of [undefined, 'worker:script-agent', 'script:import-local', 'model.invoke', 'approval:script']) {
    assert.throws(() => requireSideEffectGrant({sideEffectGrant}, spec, sink),
      {code: 'local_script_review_sink_forbidden'});
  }
});

test('local script review namespace refuses expanded scopes or nonzero budget', () => {
  for (const addition of [{maxCalls: 1}, {maxCostUsd: 0.01}]) {
    const sideEffectGrant = authority().authorize({...spec, ...addition});
    assert.throws(() => requireSideEffectGrant({sideEffectGrant}, spec, 'review:script'),
      {code: 'local_script_review_budget_forbidden'});
  }
  for (const extra of ['filesystem.write', 'network.request', 'model.invoke']) {
    const sideEffectGrant = authority().authorize({...spec, scopes: [...spec.scopes, extra]});
    assert.throws(() => requireSideEffectGrant({sideEffectGrant}, spec, 'review:script'),
      {code: 'local_script_review_scope_forbidden'});
  }
});
