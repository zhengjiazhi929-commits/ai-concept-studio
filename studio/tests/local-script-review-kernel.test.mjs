import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {approvedScriptFixture} from './approved-script-fixture.mjs';
import {ensureAgentArchitecture, createReviewState} from '../src/shared/agent-contracts.mjs';
import {currentGateArtifactHash, resetApprovalForVersion} from '../src/shared/workflow.mjs';
import {reviewCandidateOutput, routeReviewRevision, recheckGateReview, recoverInterruptedEpisode} from '../src/server/orchestrator.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {acquireEpisodeOperation, isEpisodeOperationActive} from '../src/server/control/episode-operation-lock.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};
const codeIs = code => error => error.code === code;

async function fixture(t, options = {}) {
  const base = await approvedScriptFixture(t, options);
  const before = ensureAgentArchitecture(await base.deps.readEpisode());
  before.approvals.script = resetApprovalForVersion(before.approvals.script, 1);
  before.reviews.script = createReviewState();
  const scriptStep = before.pipeline.find(step => step.id === 'script');
  Object.assign(scriptStep, {status: 'waiting_approval', requiresApproval: 'script', requiresHuman: false});
  await base.deps.writeEpisode(before);
  base.events.length = 0;
  const {createLocalScriptReviewRunner} = await import('../src/server/reviews/local-script-review-runner.mjs');
  const {createLocalScriptReviewService} = await import('../src/server/reviews/local-script-review-core.mjs');
  const {loadLocalScriptReviewBinding} = await import('../src/server/reviews/local-script-review-binding.mjs');
  const {localScriptReviewCapabilitySpec} = await import('../src/shared/local-script-review-request.mjs');
  let clock = Date.now();
  let writes = 0;
  let reviews = 0;
  let config = structuredClone(base.config);
  let implementation = {version: 'synthetic-script-review-v1', hash: 'a'.repeat(64)};
  const hooks = {beforeWrite: async () => {}, afterWrite: async () => {}, beforeReview: async () => {}, afterReview: async () => {}, beforeEvent: async () => {}, commitStatus: value => value};
  const readEpisode = async () => ensureAgentArchitecture(await base.deps.readEpisode());
  const deps = {
    workspaceRoot: base.root,
    readEpisode,
    readReviewConfig: async () => structuredClone(config),
    readImplementationFingerprint: async () => structuredClone(implementation),
    writeEpisode: async value => {
      await hooks.beforeWrite(value, writes + 1);
      const result = await base.deps.writeEpisode(value);
      writes += 1;
      await hooks.afterWrite(value, writes);
      return result;
    },
    readEpisodeCommitStatus: id => hooks.commitStatus(base.deps.readEpisodeCommitStatus(id), writes),
    appendEvent: async event => {
      await hooks.beforeEvent(event);
      base.events.push(structuredClone(event));
    },
    reviewCandidateOutput: async (...args) => {
      reviews += 1;
      await hooks.beforeReview(...args);
      const result = await reviewCandidateOutput(...args);
      await hooks.afterReview(result);
      return result;
    },
    routeReviewRevision
  };
  const run = createLocalScriptReviewRunner(deps);
  const service = createLocalScriptReviewService({...deps,
    recheckGateReview: async (id, gate, options) => {
      assert.equal(id, before.id); assert.equal(gate, 'script');
      return run(options.localScriptReviewRequest, {sideEffectGrant: options.sideEffectGrant});
    }
  });
  const authority = createCapabilityAuthority({secret: 'synthetic-script-review-kernel-authority-00000000', now: () => clock, maximumCalls: 1, maximumCostUsd: 1});
  const requestFor = async () => {
    const binding = await loadLocalScriptReviewBinding(await readEpisode(), {
      workspaceRoot: base.root, reviewConfig: config, implementationFingerprint: implementation
    });
    return {episodeId: before.id, scriptVersion: binding.scriptVersion, artifactHash: binding.artifactHash,
      snapshotHash: binding.snapshotHash, actor: 'human:fixture', reason: 'Synthetic zero-cost machine review only', confirmLocalScriptReview: true};
  };
  const authorize = (request, specOverrides = {}) => ({sideEffectGrant: authority.authorize({...localScriptReviewCapabilitySpec(request), ...specOverrides})});
  return {...base, readEpisode, hooks, deps, run, service, requestFor, authorize, authority,
    mutate: async mutate => {const value = await readEpisode(); await mutate(value); await base.deps.writeEpisode(value);},
    expire: () => {clock += 60_000;},
    setConfig: value => {config = value;},
    setImplementation: value => {implementation = value;},
    get writes() {return writes;}, get reviews() {return reviews;}};
}

async function assertReadOnlyReject(f, request, options, errorCheck) {
  const before = await readFile(f.episodePath);
  const writes = f.writes;
  const events = f.events.length;
  await assert.rejects(f.run(request, options), errorCheck);
  assert.deepEqual(await readFile(f.episodePath), before);
  assert.equal(f.writes, writes);
  assert.equal(f.events.length, events);
  assert.equal(f.reviews, 0);
}

test('local deterministic Script review exposes a dedicated Kernel runner', async () => {
  const module = await import('../src/server/reviews/local-script-review-runner.mjs');
  assert.equal(typeof module.createLocalScriptReviewRunner, 'function');
});

test('real deterministic coordinator and CAS review imported Script without human approval or downstream work', async t => {
  const f = await fixture(t);
  const before = await f.readEpisode();
  const request = await f.requestFor();
  const result = await f.run(request, f.authorize(request));
  const state = await f.readEpisode();
  assert.equal(result.commitStatus, 'committed');
  assert.equal(result.audit.status, 'committed');
  assert.equal(result.review.report.decision, 'pass');
  assert.equal(result.review.report.reviewMode, 'deterministic');
  assert.equal(state.reviews.script.status, 'passed');
  assert.equal(state.reviews.script.artifactHash, currentGateArtifactHash(state, 'script'));
  assert.equal(state.approvals.script.status, 'pending');
  assert.deepEqual(state.approvals.research, before.approvals.research);
  assert.deepEqual(state.production.scriptDraft, before.production.scriptDraft);
  assert.deepEqual(state.pipeline.filter(step => !['script'].includes(step.id)), before.pipeline.filter(step => !['script'].includes(step.id)));
  assert.equal(state.production.ai.requestCount, 0);
  assert.deepEqual(state.control.budget, before.control.budget);
  assert.equal(state.control.activeOperation, null);
  assert.equal(isEpisodeOperationActive(state.id), false);
  assert.equal(f.reviews, 1);
  assert.equal(f.writes, 2);
  assert.ok(state.control.stateVersion > before.control.stateVersion);
  assert.equal(f.events.filter(event => event.type === 'review.recheck_started').length, 1);
  assert.equal(f.events.filter(event => event.type === 'review.recheck_completed').length, 1);
});

test('normal service preview and execution pass the exact request through the real runner and coordinator', async t => {
  const f = await fixture(t);
  const before = await readFile(f.episodePath);
  const preview = await f.service.previewLocalScriptReview({episodeId: f.episode.id});
  assert.deepEqual(await readFile(f.episodePath), before);
  assert.equal(preview.paidCalls, 0);
  assert.equal(preview.humanApproved, false);
  const request = await f.requestFor();
  assert.equal(preview.snapshotHash, request.snapshotHash);
  const result = await f.service.executeLocalScriptReview(request, f.authorize(request));
  assert.equal(result.review.report.decision, 'pass');
  assert.equal((await f.readEpisode()).approvals.script.status, 'pending');
  assert.equal(f.writes, 2);
});

test('a real failing deterministic rubric records revision without authorizing automatic generation', async t => {
  const f = await fixture(t, {sectionNarration: '合成测试短句。'});
  const request = await f.requestFor();
  const result = await f.run(request, f.authorize(request));
  const state = await f.readEpisode();
  assert.equal(result.commitStatus, 'committed');
  assert.equal(result.review.report.decision, 'revise');
  assert.ok(result.review.report.blockingIssues.some(issue => issue.code === 'script-narration-density'));
  assert.equal(state.reviews.script.status, 'revision_required');
  assert.equal(state.production.scriptDraft.needsRevision, true);
  assert.equal(state.pipeline.find(step => step.id === 'script').status, 'blocked');
  assert.equal(state.approvals.script.status, 'pending');
  assert.equal(state.production.ai.requestCount, 0);
  assert.equal(state.control.activeOperation, null);
});

for (const [label, optionsFor] of [
  ['missing', () => ({})],
  ['forged', () => ({sideEffectGrant: {episodeId: 'approved-script-fixture', operation: 'review:script', scopes: ['state.write'], maxCalls: 0, maxCostUsd: 0}})],
  ['positive-call-budget', (f, request) => f.authorize(request, {maxCalls: 1})],
  ['positive-dollar-budget', (f, request) => f.authorize(request, {maxCostUsd: 1})],
  ['wrong-episode', (f, request) => f.authorize(request, {episodeId: 'unrelated-synthetic-episode'})],
  ['wrong-operation', (f, request) => f.authorize(request, {operation: 'review:research'})]
]) {
  test(`Kernel rejects ${label} authorization before any write`, async t => {
    const f = await fixture(t); const request = await f.requestFor();
    await assertReadOnlyReject(f, request, optionsFor(f, request));
  });
}

test('expiry before starting rejects with no writes', async t => {
  const f = await fixture(t); const request = await f.requestFor(); const options = f.authorize(request);
  f.expire();
  await assertReadOnlyReject(f, request, options, codeIs('side_effect_capability_expired'));
});

for (const [label, mutate] of [
  ['version', request => {request.scriptVersion += 1;}],
  ['artifact hash', request => {request.artifactHash = 'b'.repeat(64);}],
  ['full snapshot', request => {request.snapshotHash = 'c'.repeat(64);}]
]) {
  test(`Kernel independently rejects stale Script ${label}`, async t => {
    const f = await fixture(t); const request = await f.requestFor(); mutate(request);
    await assertReadOnlyReject(f, request, f.authorize(request));
  });
}

for (const target of ['artifact', 'manifest', 'research-pack', 'research-evidence']) {
  test(`Kernel detects ${target} disk tamper after preview before writing`, async t => {
    const f = await fixture(t); const request = await f.requestFor(); const state = await f.readEpisode();
    const path = target === 'artifact' ? state.production.scriptDraft.artifactPath
      : target === 'manifest' ? state.production.scriptDraft.manifestPath
        : target === 'research-pack' ? f.packPath : state.sourceDocs.at(-1).path;
    await f.put(path, {syntheticTampering: target});
    await assertReadOnlyReject(f, request, f.authorize(request));
  });
}

for (const [label, mutate] of [
  ['unrelated Episode content', state => {state.title = 'Concurrent synthetic title change';}],
  ['stop requested', state => {state.control.stopRequested = true;}],
  ['persisted busy operation', state => {state.control.activeOperation = {id: 'synthetic-other-operation', kind: 'manual', startedAt: new Date().toISOString()};}],
  ['human-approved script', state => {state.approvals.script.status = 'approved';}],
  ['research approval revoked', state => {state.approvals.research.status = 'pending';}],
  ['script no longer waiting', state => {state.pipeline.find(step => step.id === 'script').status = 'ready';}]
]) {
  test(`Kernel refuses ${label} changed after preview`, async t => {
    const f = await fixture(t); const request = await f.requestFor(); await f.mutate(mutate);
    await assertReadOnlyReject(f, request, f.authorize(request));
  });
}

test('semantic-review configuration and implementation drift cannot reuse a preview', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  const config = structuredClone(f.config); config.stages.script.semanticReview = true;
  f.setConfig(config);
  await assertReadOnlyReject(f, request, f.authorize(request));
  f.setConfig(f.config);
  f.setImplementation({version: 'synthetic-script-review-v2', hash: 'd'.repeat(64)});
  await assertReadOnlyReject(f, request, f.authorize(request));
});

test('physical Episode lock blocks a local review before persistent work', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  const release = acquireEpisodeOperation(request.episodeId, 'synthetic-other-work');
  try {await assertReadOnlyReject(f, request, f.authorize(request), codeIs('episode_operation_active'));}
  finally {release();}
});

test('same Episode concurrent review remains locked through the real coordinator await', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  const entered = deferred(); const release = deferred();
  f.hooks.beforeReview = async () => {entered.resolve(); await release.promise;};
  const first = f.run(request, f.authorize(request)); first.catch(() => {});
  try {
    await Promise.race([entered.promise, first.then(() => {throw new Error('Review settled before synthetic wait');})]);
    const writes = f.writes;
    await assert.rejects(f.run(request, f.authorize(request)), codeIs('episode_operation_active'));
    assert.equal(f.writes, writes);
  } finally {release.resolve();}
  assert.equal((await first).review.report.decision, 'pass');
});

test('expiry during coordinator await leaves an interrupted review instead of writing without authority', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  f.hooks.beforeReview = async () => {f.expire();};
  await assert.rejects(f.run(request, f.authorize(request)), codeIs('side_effect_capability_expired'));
  const state = await f.readEpisode();
  assert.equal(f.writes, 1);
  assert.equal(state.reviews.script.status, 'checking');
  assert.notEqual(state.control.activeOperation, null);
  assert.equal(state.approvals.script.status, 'pending');
  assert.equal(isEpisodeOperationActive(state.id), false);
  assert.equal(f.events.filter(event => event.type === 'review.recheck_completed').length, 0);
  const recovered = recoverInterruptedEpisode(state);
  assert.deepEqual(recovered.recoveredReviewStages, ['script']);
  assert.equal(recovered.episode.reviews.script.status, 'not_started');
  assert.equal(recovered.episode.control.activeOperation, null);
  assert.equal(recovered.episode.approvals.script.status, 'pending');
  assert.equal(recovered.episode.production.ai.requestCount, 0);
});

test('expiry after final CAS reports committed warning and does not discard a valid machine result', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  f.hooks.afterWrite = async (_state, number) => {if (number === 2) f.expire();};
  const result = await f.run(request, f.authorize(request));
  const state = await f.readEpisode();
  assert.equal(result.commitStatus, 'committed_with_warning');
  assert.equal(result.audit.status, 'pending');
  assert.equal(result.audit.errorCode, 'side_effect_capability_expired');
  assert.equal(state.reviews.script.status, 'passed');
  assert.equal(state.approvals.script.status, 'pending');
  assert.equal(state.control.activeOperation, null);
  assert.equal(f.writes, 2);
});

test('started audit failure resets only this interrupted review and releases its persisted operation', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  f.hooks.beforeEvent = async event => {if (event.type === 'review.recheck_started') throw new Error('synthetic started audit unavailable');};
  await assert.rejects(f.run(request, f.authorize(request)), /synthetic started audit unavailable/u);
  const state = await f.readEpisode();
  assert.equal(state.reviews.script.status, 'not_started');
  assert.equal(state.approvals.script.status, 'pending');
  assert.equal(state.control.activeOperation, null);
  assert.equal(isEpisodeOperationActive(state.id), false);
  assert.equal(f.reviews, 0);
});

test('completed audit failure is a warning after committed review and never a false failed run', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  f.hooks.beforeEvent = async event => {if (event.type === 'review.recheck_completed') throw new Error('synthetic completed audit unavailable');};
  const result = await f.run(request, f.authorize(request));
  assert.equal(result.commitStatus, 'committed_with_warning');
  assert.equal(result.audit.status, 'pending');
  const state = await f.readEpisode();
  assert.equal(state.reviews.script.status, 'passed');
  assert.equal(state.approvals.script.status, 'pending');
  assert.equal(state.control.activeOperation, null);
  assert.equal(f.writes, 2);
});

for (const writeNumber of [1, 2]) {
  test(`durable writer warning at state commit ${writeNumber} remains visible after a passed review`, async t => {
    const f = await fixture(t); const request = await f.requestFor();
    f.hooks.commitStatus = (value, number) => number === writeNumber ? {...value,
      warningCount: 1, commitStatus: 'committed_with_warnings',
      commitWarnings: [{stage: 'directory-sync', code: 'synthetic_commit_warning', message: 'Synthetic durability warning'}]
    } : value;
    const result = await f.run(request, f.authorize(request));
    assert.equal(result.commitStatus, 'committed_with_warning');
    assert.equal(result.audit.status, 'committed');
    assert.ok(result.stateCommits.some(value => value.warningCount === 1));
    assert.equal((await f.readEpisode()).reviews.script.status, 'passed');
    assert.equal(f.writes, 2);
  });
}

test('evidence or configuration changing during review cannot receive a stale passed result', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  f.hooks.afterReview = async () => {await f.put(f.packPath, {episodeId: request.episodeId, changed: 'during-await'});};
  await assert.rejects(f.run(request, f.authorize(request)));
  const state = await f.readEpisode();
  assert.equal(state.reviews.script.status, 'not_started');
  assert.equal(state.reviews.script.reports.length, 0);
  assert.equal(state.approvals.script.status, 'pending');
  assert.equal(state.control.activeOperation, null);
});

test('concurrent state update during review is preserved without overwriting a human change', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  let concurrent;
  f.hooks.afterReview = async () => {
    await f.mutate(state => {
      state.title = 'Preserve a concurrent human edit';
      state.approvals.research.note = 'Synthetic human evidence note';
      state.control.activeOperation = null;
      state.reviews.script = createReviewState();
    });
    concurrent = await readFile(f.episodePath);
  };
  await assert.rejects(f.run(request, f.authorize(request)));
  assert.deepEqual(await readFile(f.episodePath), concurrent);
  assert.equal(f.writes, 1);
  assert.equal(isEpisodeOperationActive(request.episodeId), false);
});

test('real CAS rejects an external writer between final validation and final state commit', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  let concurrent;
  f.hooks.beforeWrite = async (_value, number) => {
    if (number !== 2) return;
    await f.mutate(state => {
      state.title = 'External state wins the CAS race';
      state.control.activeOperation = null;
      state.reviews.script = createReviewState();
    });
    concurrent = await readFile(f.episodePath);
  };
  await assert.rejects(f.run(request, f.authorize(request)));
  assert.deepEqual(await readFile(f.episodePath), concurrent);
  assert.equal((await f.readEpisode()).reviews.script.status, 'not_started');
});

test('production recheck entry rejects review options, state injection and non-Script gates before reading live state', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  let injectedCalls = 0;
  const sentinel = () => {injectedCalls += 1; throw new Error('must not run');};
  for (const extra of [{review: {semanticReviewer: sentinel}}, {readEpisode: sentinel}, {writeEpisode: sentinel}, {reviewProfile: 'override'}]) {
    await assert.rejects(recheckGateReview(request.episodeId, 'script', {localScriptReviewRequest: request, ...f.authorize(request), ...extra}));
  }
  await assert.rejects(recheckGateReview(request.episodeId, 'research', {localScriptReviewRequest: request, ...f.authorize(request)}));
  assert.equal(injectedCalls, 0);
  assert.equal(f.writes, 0);
});

test('production Script entry validates nested request data before reading accessors or acquiring a lock', async () => {
  const valid = {episodeId: 'synthetic-script-review-never-read', scriptVersion: 1,
    artifactHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), actor: 'human:fixture',
    reason: 'Reject synthetic accessor data without touching an Episode', confirmLocalScriptReview: true};
  let getterCalls = 0;
  for (const key of Object.keys(valid)) {
    const request = {...valid};
    Object.defineProperty(request, key, {enumerable: true, get() {
      getterCalls += 1;
      throw new Error('Synthetic request accessor must not execute');
    }});
    await assert.rejects(recheckGateReview(valid.episodeId, 'script', {localScriptReviewRequest: request}),
      codeIs('local_script_review_request_invalid'));
  }
  assert.equal(getterCalls, 0);
  assert.equal(isEpisodeOperationActive(valid.episodeId), false);
});

test('production Script entry rejects hidden option fields before authorization or Episode access', async () => {
  const request = {episodeId: 'synthetic-script-review-hidden-never-read', scriptVersion: 1,
    artifactHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), actor: 'human:fixture',
    reason: 'Reject hidden option fields without touching an Episode', confirmLocalScriptReview: true};
  for (const key of ['localScriptReviewRequest', 'sideEffectGrant']) {
    const options = {localScriptReviewRequest: request, sideEffectGrant: undefined};
    Object.defineProperty(options, key, {value: options[key], enumerable: false});
    await assert.rejects(recheckGateReview(request.episodeId, 'script', options),
      codeIs('local_script_review_options_invalid'));
  }
  assert.equal(isEpisodeOperationActive(request.episodeId), false);
});
