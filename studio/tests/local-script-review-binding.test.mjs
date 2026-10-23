import assert from 'node:assert/strict';
import test from 'node:test';
import {writeFile, symlink, unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {approvedScriptFixture} from './approved-script-fixture.mjs';
import {prepareGateForHumanReview} from '../src/shared/workflow.mjs';
import {loadLocalScriptReviewBinding, assertLocalScriptReviewRequestMatches} from '../src/server/reviews/local-script-review-binding.mjs';

const fingerprint = {version: 'synthetic-review-implementation-v1', hash: 'c'.repeat(64)};
async function fixture(t) {
  const value = await approvedScriptFixture(t);
  value.episode = prepareGateForHumanReview(value.episode, {gate: 'script', reason: 'Synthetic pending script review'}).episode;
  value.options = {workspaceRoot: value.root, reviewConfig: value.config, implementationFingerprint: fingerprint};
  return value;
}
const requestFor = binding => ({episodeId: binding.episodeId, scriptVersion: binding.scriptVersion,
  artifactHash: binding.artifactHash, snapshotHash: binding.snapshotHash, actor: 'human:fixture',
  reason: 'Review exact synthetic script', confirmLocalScriptReview: true});

test('local script binding verifies imported script and research without mutating human approvals', async t => {
  const f = await fixture(t); const before = structuredClone(f.episode);
  const binding = await loadLocalScriptReviewBinding(f.episode, f.options);
  assert.equal(binding.episodeId, f.episode.id); assert.equal(binding.scriptVersion, 1);
  assert.match(binding.artifactHash, /^[a-f0-9]{64}$/u); assert.match(binding.snapshotHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(binding.implementationFingerprint, fingerprint);
  assert.deepEqual(f.episode, before);
  assertLocalScriptReviewRequestMatches(requestFor(binding), binding);
  for (const mutation of [{episodeId: 'another-episode'}, {scriptVersion: 2}, {artifactHash: 'd'.repeat(64)}, {snapshotHash: 'e'.repeat(64)}]) {
    assert.throws(() => assertLocalScriptReviewRequestMatches({...requestFor(binding), ...mutation}, binding));
  }
});

test('local script snapshot binds full Episode, review configuration and implementation', async t => {
  const f = await fixture(t); const first = await loadLocalScriptReviewBinding(f.episode, f.options);
  const changed = structuredClone(f.episode); changed.title = 'Changed synthetic title';
  assert.notEqual((await loadLocalScriptReviewBinding(changed, f.options)).snapshotHash, first.snapshotHash);
  const options = {...f.options, implementationFingerprint: {...fingerprint, hash: 'd'.repeat(64)}};
  assert.notEqual((await loadLocalScriptReviewBinding(f.episode, options)).snapshotHash, first.snapshotHash);
  const config = structuredClone(f.config); config.lowConfidenceThreshold = 0.75;
  await assert.rejects(loadLocalScriptReviewBinding(f.episode, {...f.options, reviewConfig: config}), {code: 'local_script_review_research_binding_changed'});
});

test('local script binding rejects pending operations, stale stages, revisions and approvals', async t => {
  const f = await fixture(t);
  const mutations = [value => {value.control.activeOperation = {id: 'busy'};},
    value => {value.control.stopRequested = true;}, value => {value.control.pendingDispatch = {id: 'pending'};},
    value => {value.pipeline.find(step => step.id === 'script').status = 'running';},
    value => {value.pipeline.find(step => step.id === 'research').status = 'ready';},
    value => {value.approvals.script.status = 'approved';}, value => {value.approvals.script.status = 'rejected';},
    value => {value.approvals.research.status = 'pending';}, value => {value.control.reviewEnabled = false;},
    value => {value.production.scriptDraft.needsRevision = true;}, value => {value.research.needsRevision = true;},
    value => {value.production.scriptDraft.version = 2;}, value => {value.production.scriptDraft.generationKind = 'unverified';},
    value => {value.production.scriptDraft.versions = [{version: 1}];},
    value => {value.pipeline.find(step => step.id === 'script').requiresApproval = 'research';}];
  for (const mutate of mutations) {const changed = structuredClone(f.episode); mutate(changed); await assert.rejects(loadLocalScriptReviewBinding(changed, f.options));}
});

test('local script binding rejects semantic review and unsafe descriptors before evaluating getters', async t => {
  const f = await fixture(t);
  for (const semanticReview of [true, undefined, null, 'false']) {
    const config = structuredClone(f.config); config.stages.script.semanticReview = semanticReview;
    await assert.rejects(loadLocalScriptReviewBinding(f.episode, {...f.options, reviewConfig: config}));
  }
  let reads = 0; const input = structuredClone(f.episode);
  Object.defineProperty(input.production.scriptDraft, 'content', {enumerable: true, get() {reads++; return {};}});
  await assert.rejects(loadLocalScriptReviewBinding(input, f.options)); assert.equal(reads, 0);
  for (const implementationFingerprint of [null, {version: 'v1', hash: 'invalid'}, {...fingerprint, trusted: true}]) {
    await assert.rejects(loadLocalScriptReviewBinding(f.episode, {...f.options, implementationFingerprint}));
  }
});

for (const target of ['script', 'manifest', 'research-pack', 'editorial-batch', 'extra-source']) {
  test(`local script binding rejects changed ${target} bytes`, async t => {
    const f = await fixture(t); const draft = f.episode.production.scriptDraft;
    const path = {script: draft.artifactPath, manifest: draft.manifestPath,
      'research-pack': f.packPath, 'editorial-batch': f.batchPath, 'extra-source': f.episode.sourceDocs[2].path}[target];
    await writeFile(resolve(f.root, path), '{"synthetic":"tamper"}\n');
    await assert.rejects(loadLocalScriptReviewBinding(f.episode, f.options));
  });
}

test('local script binding rejects manifest symlinks and duplicate source registration', async t => {
  const f = await fixture(t); const changed = structuredClone(f.episode);
  changed.sourceDocs.push(structuredClone(changed.sourceDocs[0]));
  await assert.rejects(loadLocalScriptReviewBinding(changed, f.options));
  const path = resolve(f.root, f.episode.production.scriptDraft.manifestPath);
  await unlink(path); await symlink(resolve(f.root, f.packPath), path);
  await assert.rejects(loadLocalScriptReviewBinding(f.episode, f.options));
});
