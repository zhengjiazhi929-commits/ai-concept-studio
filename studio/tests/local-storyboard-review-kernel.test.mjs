import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {approvedStoryboardFixture} from './approved-storyboard-fixture.mjs';
import {ensureAgentArchitecture, createReviewState} from '../src/shared/agent-contracts.mjs';
import {currentGateArtifactHash, resetApprovalForVersion} from '../src/shared/workflow.mjs';
import {reviewCandidateOutput, routeReviewRevision, recheckGateReview, recoverInterruptedEpisode} from '../src/server/orchestrator.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {acquireEpisodeOperation, isEpisodeOperationActive} from '../src/server/control/episode-operation-lock.mjs';
import {localStoryboardCapabilitySpec} from '../src/shared/local-storyboard-import-request.mjs';
import {attachSyntheticScreenEditing} from './helpers/screen-editorial-fixture.mjs';
import {runLocalStoryboardReviewCli} from '../scripts/local-storyboard-review.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
};
const codeIs = code => error => error.code === code;

async function fixture(t, options = {}) {
  const base = await approvedStoryboardFixture(t, options);
  if (options.cueOnly) {
    const candidate = structuredClone(base.candidate);
    candidate.kind = 'codex-authored-storyboard-candidate-v1';
    candidate.status = 'local-editorial-draft';
    candidate.candidateVersion += 1;
    delete candidate.content.executionPlan;
    delete candidate.content.screenEditing;
    attachSyntheticScreenEditing(candidate);
    await base.put(base.candidatePath, candidate);
    const request = await base.request();
    await base.service.importLocalStoryboard(request, {sideEffectGrant: createCapabilityAuthority({
      secret: 'synthetic-review-cue-only-import-00000000000000'
    }).authorize(localStoryboardCapabilitySpec(request))});
  }
  const before = ensureAgentArchitecture(await base.deps.readEpisode());
  before.approvals.storyboard = resetApprovalForVersion(before.approvals.storyboard, before.production.storyboardDraft.version);
  before.reviews.storyboard = createReviewState();
  const storyboardStep = before.pipeline.find(step => step.id === 'storyboard');
  Object.assign(storyboardStep, {status: 'waiting_approval', requiresApproval: 'storyboard', requiresHuman: false});
  await base.deps.writeEpisode(before);
  base.events.length = 0;
  const {createLocalStoryboardReviewRunner} = await import('../src/server/reviews/local-storyboard-review-runner.mjs');
  const {createLocalStoryboardReviewService} = await import('../src/server/reviews/local-storyboard-review-core.mjs');
  const {loadLocalStoryboardReviewBinding} = await import('../src/server/reviews/local-storyboard-review-binding.mjs');
  const {localStoryboardReviewCapabilitySpec} = await import('../src/shared/local-storyboard-review-request.mjs');
  let clock = Date.now();
  let writes = 0;
  let reviews = 0;
  let config = structuredClone(base.config);
  let implementation = {version: 'synthetic-storyboard-review-v1', hash: 'a'.repeat(64)};
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
  const run = createLocalStoryboardReviewRunner(deps);
  const service = createLocalStoryboardReviewService({...deps,
    recheckGateReview: async (id, gate, options) => {
      assert.equal(id, before.id); assert.equal(gate, 'storyboard');
      return run(options.localStoryboardReviewRequest, {sideEffectGrant: options.sideEffectGrant});
    }
  });
  const authority = createCapabilityAuthority({secret: 'synthetic-storyboard-review-kernel-authority-00000000', now: () => clock, maximumCalls: 1, maximumCostUsd: 1});
  const requestFor = async () => {
    const binding = await loadLocalStoryboardReviewBinding(await readEpisode(), {
      workspaceRoot: base.root, reviewConfig: config, implementationFingerprint: implementation
    });
    return {episodeId: before.id, storyboardVersion: binding.storyboardVersion, artifactHash: binding.artifactHash,
      snapshotHash: binding.snapshotHash, actor: 'human:fixture', reason: 'Synthetic zero-cost machine review only', confirmLocalStoryboardReview: true};
  };
  const authorize = (request, specOverrides = {}) => ({sideEffectGrant: authority.authorize({...localStoryboardReviewCapabilitySpec(request), ...specOverrides})});
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

test('local deterministic Storyboard review exposes a dedicated Kernel runner', async () => {
  const module = await import('../src/server/reviews/local-storyboard-review-runner.mjs');
  assert.equal(typeof module.createLocalStoryboardReviewRunner, 'function');
});

test('binding rejects non-JSON Episode/options and unknown binding controls without invoking accessors', async t => {
  const f = await fixture(t);
  const {loadLocalStoryboardReviewBinding: bind} = await import('../src/server/reviews/local-storyboard-review-binding.mjs');
  const episode = await f.readEpisode();
  const options = {workspaceRoot: f.root, reviewConfig: f.config,
    implementationFingerprint: {version: 'synthetic-storyboard-review-v1', hash: 'a'.repeat(64)}};
  let getterCalls = 0;
  const accessorEpisode = structuredClone(episode);
  Object.defineProperty(accessorEpisode.production.storyboardDraft, 'content', {
    enumerable: true, get() {getterCalls += 1; return {};}
  });
  const accessorOptions = Object.defineProperty({}, 'workspaceRoot', {
    enumerable: true, get() {getterCalls += 1; return f.root;}
  });
  const hiddenEpisode = structuredClone(episode);
  Object.defineProperty(hiddenEpisode, 'hiddenReviewOverride', {value: true});
  const symbolOptions = {...options, [Symbol('override')]: true};
  const cyclicEpisode = structuredClone(episode); cyclicEpisode.self = cyclicEpisode;
  for (const [value, controls] of [[accessorEpisode, options], [hiddenEpisode, options],
    [cyclicEpisode, options], [episode, accessorOptions], [episode, symbolOptions],
    [episode, {...options, semanticReviewer: 'override'}], [episode, Object.create(options)]]) {
    await assert.rejects(bind(value, controls));
  }
  assert.equal(getterCalls, 0);
  assert.equal(f.writes, 0); assert.equal(f.reviews, 0); assert.equal(f.events.length, 0);
});

test('fresh binding rejects mismatched or duplicate Storyboard step, gate and agent identities', async t => {
  const f = await fixture(t);
  const {loadLocalStoryboardReviewBinding: bind} = await import('../src/server/reviews/local-storyboard-review-binding.mjs');
  const options = {workspaceRoot: f.root, reviewConfig: f.config,
    implementationFingerprint: {version: 'synthetic-storyboard-review-v1', hash: 'a'.repeat(64)}};
  for (const mutate of [
    value => {value.pipeline.find(step => step.id === 'storyboard').agent = 'script-agent';},
    value => {value.pipeline.find(step => step.id === 'storyboard').gate = 'script';},
    value => {value.pipeline.unshift(structuredClone(value.pipeline.find(step => step.id === 'storyboard')));}
  ]) {
    const value = await f.readEpisode(); mutate(value);
    await assert.rejects(bind(value, options));
  }
  assert.equal(f.writes, 0); assert.equal(f.reviews, 0);
});

test('real deterministic coordinator and CAS review imported Storyboard without human approval or downstream work', async t => {
  const f = await fixture(t);
  const before = await f.readEpisode();
  const request = await f.requestFor();
  const result = await f.run(request, f.authorize(request));
  const state = await f.readEpisode();
  assert.equal(result.commitStatus, 'committed');
  assert.equal(result.audit.status, 'committed');
  assert.equal(result.review.report.decision, 'pass');
  assert.equal(result.review.report.reviewMode, 'deterministic');
  assert.equal(state.reviews.storyboard.status, 'passed');
  assert.equal(state.reviews.storyboard.artifactHash, currentGateArtifactHash(state, 'storyboard'));
  assert.equal(state.approvals.storyboard.status, 'pending');
  assert.deepEqual(state.approvals.research, before.approvals.research);
  assert.deepEqual(state.approvals.script, before.approvals.script);
  assert.deepEqual(state.reviews.script, before.reviews.script);
  assert.deepEqual(state.production.scriptDraft, before.production.scriptDraft);
  assert.deepEqual(state.production.storyboardDraft, before.production.storyboardDraft);
  assert.deepEqual(state.scenes, before.scenes);
  assert.deepEqual(state.subtitles, before.subtitles);
  assert.deepEqual(state.pipeline.filter(step => !['storyboard'].includes(step.id)), before.pipeline.filter(step => !['storyboard'].includes(step.id)));
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
  const preview = await f.service.previewLocalStoryboardReview({episodeId: f.episode.id});
  assert.deepEqual(await readFile(f.episodePath), before);
  assert.equal(preview.paidCalls, 0);
  assert.equal(preview.humanApproved, false);
  const request = await f.requestFor();
  assert.equal(preview.snapshotHash, request.snapshotHash);
  const result = await f.service.executeLocalStoryboardReview(request, f.authorize(request));
  assert.equal(result.review.report.decision, 'pass');
  assert.equal((await f.readEpisode()).approvals.storyboard.status, 'pending');
  assert.equal(f.writes, 2);
});

test('normal CLI authorizes the exact synthetic service request and reaches real deterministic review without downstream work', async t => {
  const f = await fixture(t);
  const dependencies = {preview: f.service.previewLocalStoryboardReview, execute: f.service.executeLocalStoryboardReview};
  const before = await readFile(f.episodePath);
  const preview = await runLocalStoryboardReviewCli(['--episode', f.episode.id], dependencies);
  assert.equal(preview.mode, 'preview');
  assert.deepEqual(await readFile(f.episodePath), before);
  const {episodeId, storyboardVersion, artifactHash, snapshotHash} = preview.preview;
  const result = await runLocalStoryboardReviewCli(['--episode', episodeId,
    '--storyboard-version', String(storyboardVersion), '--artifact-hash', artifactHash, '--snapshot', snapshotHash,
    '--actor', 'human:synthetic-cli', '--reason', 'Exact synthetic CLI integration review',
    '--confirm-local-storyboard-review'], dependencies);
  assert.equal(result.mode, 'executed');
  assert.equal(result.result.review.report.decision, 'pass');
  assert.equal(result.result.commitStatus, 'committed');
  assert.equal((await f.readEpisode()).approvals.storyboard.status, 'pending');
  assert.equal((await f.readEpisode()).production.ai.requestCount, 0);
  assert.equal(f.reviews, 1); assert.equal(f.writes, 2);
});

test('actual deterministic review blocks cue-only content and cannot turn a successful transaction into human approval', async t => {
  const f = await fixture(t, {cueOnly: true});
  const before = await f.readEpisode();
  const request = await f.requestFor();
  const result = await f.service.executeLocalStoryboardReview(request, f.authorize(request));
  const after = await f.readEpisode();
  assert.equal(result.commitStatus, 'committed');
  assert.equal(result.review.report.decision, 'revise');
  assert.equal(result.output.status, 'blocked');
  for (const code of ['editorial-timing-unmeasured', 'editorial-execution-unimplemented', 'scene-timeline', 'subtitle-timeline']) {
    assert.ok(result.review.report.blockingIssues.some(issue => issue.code === code), code);
  }
  assert.equal(after.reviews.storyboard.status, 'revision_required');
  assert.equal(after.production.storyboardDraft.needsRevision, true);
  assert.equal(after.approvals.storyboard.status, 'pending');
  assert.equal(after.pipeline.find(step => step.id === 'storyboard').status, 'blocked');
  assert.deepEqual(after.approvals.script, before.approvals.script);
  assert.deepEqual(after.production.scriptDraft, before.production.scriptDraft);
  assert.deepEqual(after.control.budget, before.control.budget);
  assert.equal(after.production.ai.requestCount, 0);
  assert.equal(after.control.activeOperation, null);
});

for (const [label, optionsFor] of [
  ['missing', () => ({})],
  ['forged', () => ({sideEffectGrant: {episodeId: 'approved-storyboard-fixture', operation: 'review:storyboard', scopes: ['state.write'], maxCalls: 0, maxCostUsd: 0}})],
  ['positive-call-budget', (f, request) => f.authorize(request, {maxCalls: 1})],
  ['positive-dollar-budget', (f, request) => f.authorize(request, {maxCostUsd: 1})],
  ['extra-write-scope', (f, request) => f.authorize(request, {scopes: ['state.write', 'filesystem.write']})],
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
  ['version', request => {request.storyboardVersion += 1;}],
  ['artifact hash', request => {request.artifactHash = 'b'.repeat(64);}],
  ['full snapshot', request => {request.snapshotHash = 'c'.repeat(64);}]
]) {
  test(`Kernel independently rejects stale Storyboard ${label}`, async t => {
    const f = await fixture(t); const request = await f.requestFor(); mutate(request);
    await assertReadOnlyReject(f, request, f.authorize(request));
  });
}

for (const target of ['artifact', 'manifest', 'script-artifact', 'script-manifest', 'research-pack', 'research-evidence']) {
  test(`Kernel detects ${target} disk tamper after preview before writing`, async t => {
    const f = await fixture(t); const request = await f.requestFor(); const state = await f.readEpisode();
    const path = target === 'artifact' ? state.production.storyboardDraft.artifactPath
      : target === 'manifest' ? state.production.storyboardDraft.manifestPath
        : target === 'script-artifact' ? state.production.scriptDraft.artifactPath
          : target === 'script-manifest' ? state.production.scriptDraft.manifestPath
            : target === 'research-pack' ? f.packPath : state.sourceDocs.at(-1).path;
    await f.put(path, {syntheticTampering: target});
    await assertReadOnlyReject(f, request, f.authorize(request));
  });
}

for (const [label, mutate] of [
  ['unrelated Episode content', state => {state.title = 'Concurrent synthetic title change';}],
  ['stop requested', state => {state.control.stopRequested = true;}],
  ['persisted busy operation', state => {state.control.activeOperation = {id: 'synthetic-other-operation', kind: 'manual', startedAt: new Date().toISOString()};}],
  ['human-approved storyboard', state => {state.approvals.storyboard.status = 'approved';}],
  ['research approval revoked', state => {state.approvals.research.status = 'pending';}],
  ['script approval revoked', state => {state.approvals.script.status = 'pending';}],
  ['script approval report changed', state => {state.approvals.script.reviewReportId = 'unbound-synthetic-report';}],
  ['script no longer complete', state => {state.pipeline.find(step => step.id === 'script').status = 'ready';}],
  ['storyboard no longer waiting', state => {state.pipeline.find(step => step.id === 'storyboard').status = 'ready';}]
]) {
  test(`Kernel refuses ${label} changed after preview`, async t => {
    const f = await fixture(t); const request = await f.requestFor(); await f.mutate(mutate);
    await assertReadOnlyReject(f, request, f.authorize(request));
  });
}

test('semantic-review configuration and implementation drift cannot reuse a preview', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  const config = structuredClone(f.config); config.stages.storyboard.semanticReview = true;
  f.setConfig(config);
  await assertReadOnlyReject(f, request, f.authorize(request));
  f.setConfig(f.config);
  f.setImplementation({version: 'synthetic-storyboard-review-v2', hash: 'd'.repeat(64)});
  await assertReadOnlyReject(f, request, f.authorize(request));
});

for (const [label, mutate] of [
  ['compiled scene', state => {state.scenes[0].title = 'Changed compiled synthetic scene';}],
  ['compiled subtitle', state => {state.subtitles[0].text = 'Changed synthetic subtitle';}],
  // Keep the generic Episode schema valid; only the authoritative compilation
  // binding should reject the changed terminal timing.
  ['compiled render duration', state => {state.render.durationSeconds += 1; state.scenes.at(-1).end += 1;}],
  ['registered storyboard history', state => {state.production.storyboardDraft.versions[0].sha256 = 'e'.repeat(64);}]
]) {
  test(`a fresh preview cannot accept modified ${label}`, async t => {
    const f = await fixture(t); const request = await f.requestFor();
    await f.mutate(mutate);
    const serialized = await readFile(f.episodePath);
    await assert.rejects(f.requestFor());
    assert.deepEqual(await readFile(f.episodePath), serialized);
    await assertReadOnlyReject(f, request, f.authorize(request));
  });
}

test('successful review cannot be replayed using its stale request or infer storyboard approval', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  const first = await f.service.executeLocalStoryboardReview(request, f.authorize(request));
  const serialized = await readFile(f.episodePath);
  const reviews = f.reviews; const writes = f.writes;
  await assert.rejects(f.service.executeLocalStoryboardReview(request, f.authorize(request)));
  assert.deepEqual(await readFile(f.episodePath), serialized);
  assert.equal(f.reviews, reviews); assert.equal(f.writes, writes);
  assert.equal(first.review.report.decision, 'pass');
  const after = await f.readEpisode();
  assert.equal(after.reviews.storyboard.reports.length, 1);
  assert.equal(after.approvals.storyboard.status, 'pending');
  assert.equal(after.pipeline.find(step => step.id === 'storyboard').status, 'waiting_approval');
});

test('deterministic Storyboard review does not dispatch a network or model call', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  try {
    globalThis.fetch = () => {fetches += 1; throw new Error('Synthetic forbidden network dispatch');};
    assert.equal((await f.run(request, f.authorize(request))).review.report.decision, 'pass');
  } finally {globalThis.fetch = originalFetch;}
  assert.equal(fetches, 0);
  assert.equal((await f.readEpisode()).production.ai.requestCount, 0);
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
  assert.equal(state.reviews.storyboard.status, 'checking');
  assert.notEqual(state.control.activeOperation, null);
  assert.equal(state.approvals.storyboard.status, 'pending');
  assert.equal(isEpisodeOperationActive(state.id), false);
  assert.equal(f.events.filter(event => event.type === 'review.recheck_completed').length, 0);
  const recovered = recoverInterruptedEpisode(state);
  assert.deepEqual(recovered.recoveredReviewStages, ['storyboard']);
  assert.equal(recovered.episode.reviews.storyboard.status, 'not_started');
  assert.equal(recovered.episode.control.activeOperation, null);
  assert.equal(recovered.episode.approvals.storyboard.status, 'pending');
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
  assert.equal(state.reviews.storyboard.status, 'passed');
  assert.equal(state.approvals.storyboard.status, 'pending');
  assert.equal(state.control.activeOperation, null);
  assert.equal(f.writes, 2);
});

test('started audit failure resets only this interrupted review and releases its persisted operation', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  f.hooks.beforeEvent = async event => {if (event.type === 'review.recheck_started') throw new Error('synthetic started audit unavailable');};
  await assert.rejects(f.run(request, f.authorize(request)), /synthetic started audit unavailable/u);
  const state = await f.readEpisode();
  assert.equal(state.reviews.storyboard.status, 'not_started');
  assert.equal(state.approvals.storyboard.status, 'pending');
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
  assert.equal(state.reviews.storyboard.status, 'passed');
  assert.equal(state.approvals.storyboard.status, 'pending');
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
    assert.equal((await f.readEpisode()).reviews.storyboard.status, 'passed');
    assert.equal(f.writes, 2);
  });

  test(`state status observer throwing after commit ${writeNumber} reports a committed warning, not failed review`, async t => {
    const f = await fixture(t); const request = await f.requestFor();
    f.hooks.commitStatus = (value, number) => {
      if (number === writeNumber) throw new Error('Synthetic observer unavailable after durable state write');
      return value;
    };
    const result = await f.run(request, f.authorize(request));
    assert.equal(result.commitStatus, 'committed_with_warning');
    assert.equal(result.audit.status, 'committed');
    assert.ok(result.stateCommits.some(value => value.warningCount > 0 || value.observer?.status === 'failed'));
    const after = await f.readEpisode();
    assert.equal(after.reviews.storyboard.status, 'passed');
    assert.equal(after.approvals.storyboard.status, 'pending');
    assert.equal(after.control.activeOperation, null);
    assert.equal(isEpisodeOperationActive(after.id), false);
    assert.equal(f.writes, 2);
  });
}

test('evidence or configuration changing during review cannot receive a stale passed result', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  f.hooks.afterReview = async () => {await f.put(f.packPath, {episodeId: request.episodeId, changed: 'during-await'});};
  await assert.rejects(f.run(request, f.authorize(request)));
  const state = await f.readEpisode();
  assert.equal(state.reviews.storyboard.status, 'not_started');
  assert.equal(state.reviews.storyboard.reports.length, 0);
  assert.equal(state.approvals.storyboard.status, 'pending');
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
      state.reviews.storyboard = createReviewState();
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
      state.reviews.storyboard = createReviewState();
    });
    concurrent = await readFile(f.episodePath);
  };
  await assert.rejects(f.run(request, f.authorize(request)));
  assert.deepEqual(await readFile(f.episodePath), concurrent);
  assert.equal((await f.readEpisode()).reviews.storyboard.status, 'not_started');
});

test('production recheck entry rejects review options, state injection and non-Storyboard gates before reading live state', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  let injectedCalls = 0;
  const sentinel = () => {injectedCalls += 1; throw new Error('must not run');};
  for (const extra of [{review: {semanticReviewer: sentinel}}, {readEpisode: sentinel}, {writeEpisode: sentinel}, {reviewProfile: 'override'}]) {
    await assert.rejects(recheckGateReview(request.episodeId, 'storyboard', {localStoryboardReviewRequest: request, ...f.authorize(request), ...extra}));
  }
  await assert.rejects(recheckGateReview(request.episodeId, 'research', {localStoryboardReviewRequest: request, ...f.authorize(request)}));
  assert.equal(injectedCalls, 0);
  assert.equal(f.writes, 0);
});

test('production sealed review validates request data without executing nested accessors', async () => {
  let getterCalls = 0;
  const request = Object.defineProperty({}, 'episodeId', {
    enumerable: true, get() {getterCalls += 1; return 'synthetic-storyboard-never-read';}
  });
  await assert.rejects(recheckGateReview('synthetic-storyboard-never-read', 'storyboard', {
    localStoryboardReviewRequest: request
  }));
  assert.equal(getterCalls, 0);
});

test('runner and service reject option injection and getters before review or writes', async t => {
  const f = await fixture(t); const request = await f.requestFor();
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, 'sideEffectGrant', {
    enumerable: true, get() {getterCalls += 1; return f.authorize(request).sideEffectGrant;}
  });
  const hidden = Object.defineProperty({}, 'sideEffectGrant', {value: f.authorize(request).sideEffectGrant});
  for (const options of [accessor, hidden, {...f.authorize(request), semanticReviewer: () => assert.fail('injected review')},
    {...f.authorize(request), readEpisode: () => assert.fail('injected state')},
    {...f.authorize(request), [Symbol('authority')]: true}, Object.create(f.authorize(request))]) {
    await assertReadOnlyReject(f, request, options);
    await assert.rejects(f.service.executeLocalStoryboardReview(request, options));
  }
  assert.equal(getterCalls, 0);
  assert.equal(f.writes, 0); assert.equal(f.reviews, 0); assert.equal(f.events.length, 0);
});
