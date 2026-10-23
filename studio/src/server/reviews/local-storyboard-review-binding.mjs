// Read-only binding for imported Storyboards. The Kernel owns locks, CAS and review writes.
import {canonicalJsonDocumentContentSha256 as digest, jsonDocumentContentSha256} from '../../shared/durable-json-store.mjs';
import {currentGateArtifactHash} from '../../shared/workflow.mjs';
import {validateEpisode} from '../../shared/schema.mjs';
import {assertVersionedConfig} from '../../shared/config-integrity.mjs';
import {localStoryboardReviewError, validateLocalStoryboardReviewRequest} from '../../shared/local-storyboard-review-request.mjs';
import {validateLocalStoryboardRequest} from '../../shared/local-storyboard-import-request.mjs';
import {loadApprovedScriptBinding} from '../production/approved-script-binding.mjs';
import {readLocalStoryboardJson, validateLocalStoryboardCandidate} from '../production/local-storyboard-candidate.mjs';
import {inspectTimedEditorialEpisode, TIMED_EDITORIAL_CANDIDATE_KIND, TIMED_EDITORIAL_KIND} from '../production/timed-editorial-content.mjs';
import {requireScreenEditing} from '../../shared/screen-editorial-policy.mjs';

const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const same = (left, right) => digest(left ?? null) === digest(right ?? null);
function need(condition, code = 'local_storyboard_review_binding_invalid') {
  if (!condition) throw localStoryboardReviewError(code);
}

// Check data before schema/hash/clone can invoke an accessor or toJSON method.
function assertJsonData(value, active = new Set(), depth = 0) {
  need(depth < 80, 'local_storyboard_review_input_invalid');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {need(Number.isFinite(value), 'local_storyboard_review_input_invalid'); return;}
  need(value && typeof value === 'object' && !active.has(value), 'local_storyboard_review_input_invalid');
  const array = Array.isArray(value);
  need(array ? Object.getPrototypeOf(value) === Array.prototype
    : [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'local_storyboard_review_input_invalid');
  active.add(value);
  const keys = Reflect.ownKeys(value);
  if (array) need(keys.length === value.length + 1, 'local_storyboard_review_input_invalid');
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(typeof key === 'string' && descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
      && (!array || /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length), 'local_storyboard_review_input_invalid');
    assertJsonData(descriptor.value, active, depth + 1);
  }
  active.delete(value);
}

export async function loadLocalStoryboardReviewBinding(sourceEpisode, options) {
  assertJsonData(sourceEpisode); assertJsonData(options);
  need(options && Object.keys(options).length === 3
    && ['workspaceRoot', 'reviewConfig', 'implementationFingerprint'].every(key => Object.hasOwn(options, key)),
  'local_storyboard_review_options_invalid');
  const episode = structuredClone(sourceEpisode);
  const {workspaceRoot, reviewConfig, implementationFingerprint} = structuredClone(options);
  need(typeof workspaceRoot === 'string' && workspaceRoot.length > 0 && validateEpisode(episode).valid,
    'local_storyboard_review_episode_invalid');
  need(!episode.control?.activeOperation && !episode.control?.stopRequested && !episode.control?.pendingDispatch
    && !episode.pipeline.some(step => step.status === 'running') && episode.reviews?.storyboard?.status !== 'checking',
  'local_storyboard_review_episode_busy');
  const steps = episode.pipeline.filter(step => step.id === 'storyboard' || step.gate === 'storyboard');
  need(steps.length === 1 && steps[0].id === 'storyboard' && steps[0].gate === 'storyboard'
    && steps[0].agent === 'storyboard-agent', 'local_storyboard_review_episode_invalid');
  need(episode.control?.reviewEnabled === true
    && steps[0].status === 'waiting_approval' && steps[0].requiresApproval === 'storyboard'
    && episode.approvals?.storyboard?.status === 'pending', 'local_storyboard_review_not_pending');
  need(reviewConfig?.stages?.storyboard?.semanticReview === false
    && typeof reviewConfig.stages.storyboard.version === 'string' && reviewConfig.stages.storyboard.version.trim(),
  'local_storyboard_review_not_deterministic');
  const reviewConfigHash = assertVersionedConfig('review-rubrics', reviewConfig).hash;
  need(implementationFingerprint && Object.keys(implementationFingerprint).length === 2
    && typeof implementationFingerprint.version === 'string' && implementationFingerprint.version.trim()
    && sha(implementationFingerprint.hash), 'local_storyboard_review_implementation_invalid');
  need(['research', 'script'].every(gate => episode.pipeline.find(step => step.id === gate)?.status === 'complete'),
    'local_storyboard_review_script_not_approved');
  const approved = await loadApprovedScriptBinding({workspaceRoot, episode, reviewConfig});

  const draft = episode.production?.storyboardDraft;
  need(draft?.generationKind === 'codex-local-storyboard-import' && !draft.needsRevision && draft.content
    && Number.isSafeInteger(draft.version) && draft.version > 0 && draft.version === episode.approvals.storyboard.currentVersion
    && jsonDocumentContentSha256(draft.content) === draft.sha256, 'local_storyboard_review_storyboard_changed');
  const versions = (draft.versions ?? []).filter(entry => entry.version === draft.version);
  const entryFields = ['version', 'artifactPath', 'sha256', 'bytes', 'generatedAt', 'generationKind', 'screenEditorialRequired',
    'phase', 'storyboardKind', 'timingStatus', 'executionStatus', 'importId', 'importedBy', 'candidateSha256',
    'sourceScript', 'sourceResearch', 'manifestPath', 'manifestSha256', 'manifestBytes'];
  need(versions.length === 1 && Object.keys(versions[0]).length === entryFields.length
    && entryFields.every(key => Object.hasOwn(versions[0], key) && same(versions[0][key], draft[key]))
    && draft.screenEditorialRequired === true, 'local_storyboard_review_storyboard_changed');
  const prefix = `studio/data/production/episodes/${episode.id}/local-storyboard/${draft.importId}/`;
  need(sha(draft.importId) && draft.artifactPath === `${prefix}storyboard-v${String(draft.version).padStart(3, '0')}.json`
    && draft.manifestPath === `${prefix}import.json`, 'local_storyboard_review_storyboard_changed');
  async function registeredFile(path, bytes, hash, prefixes) {
    need(Number.isSafeInteger(bytes) && bytes > 0 && sha(hash), 'local_storyboard_review_evidence_unregistered');
    const file = await readLocalStoryboardJson(workspaceRoot, path, prefixes, 4 * 1024 * 1024);
    need(file.bytes === bytes && file.sha256 === hash, 'local_storyboard_review_evidence_changed');
    return file.value;
  }
  const artifact = await registeredFile(draft.artifactPath, draft.bytes, draft.sha256, [prefix]);
  need(same(artifact, draft.content), 'local_storyboard_review_storyboard_changed');
  const manifest = await registeredFile(draft.manifestPath, draft.manifestBytes, draft.manifestSha256, [prefix]);
  need(manifest.schemaVersion === 1 && manifest.kind === 'codex-local-storyboard-import' && manifest.importId === draft.importId
    && manifest.version === draft.version && manifest.artifactPath === draft.artifactPath
    && manifest.artifactSha256 === draft.sha256 && same(manifest.candidate?.content, draft.content),
  'local_storyboard_review_manifest_changed');
  const importRequest = validateLocalStoryboardRequest(manifest.request);
  need(digest(importRequest) === draft.importId && importRequest.episodeId === episode.id
    && importRequest.candidateSha256 === draft.candidateSha256 && importRequest.actor === draft.importedBy,
  'local_storyboard_review_manifest_changed');
  need(same(draft.sourceScript, approved.sourceScript) && same(draft.sourceScript, manifest.sourceScript)
    && same(draft.sourceScript, manifest.candidate?.sourceScript), 'local_storyboard_review_script_binding_changed');
  need(same(draft.sourceResearch, approved.sourceResearch) && same(draft.sourceResearch, manifest.sourceResearch),
    'local_storyboard_review_research_binding_changed');
  // Approval loading checks the selected pack and brief; review also binds every
  // registered research source so an unrelated registered file cannot silently drift.
  const sources = new Set();
  for (const record of episode.sourceDocs ?? []) {
    need(typeof record.path === 'string' && !sources.has(record.path)
      && (record.path.startsWith('studio/data/research/runs/') || record.path.startsWith('studio/data/research/inbox/')
        || record.path === 'studio/data/research/assist-task.json'), 'local_storyboard_review_source_unregistered');
    const value = await registeredFile(record.path, record.bytes, record.sha256, ['studio/data/research/']);
    need(value.episodeId === episode.id, 'local_storyboard_review_source_unregistered');
    sources.add(record.path);
  }
  validateLocalStoryboardCandidate(manifest.candidate, {episodeId: episode.id, script: approved.script, sourceScript: approved.sourceScript});
  const timed = manifest.candidate.kind === TIMED_EDITORIAL_CANDIDATE_KIND;
  need(draft.phase === (timed ? 'timed-editorial' : 'editorial')
    && draft.storyboardKind === (timed ? TIMED_EDITORIAL_KIND : 'editorial-cue-plan-v1')
    && draft.timingStatus === (timed ? 'editorial-estimate' : 'unmeasured')
    && draft.executionStatus === (timed ? 'implemented-contract' : 'implementation-required'),
  'local_storyboard_review_storyboard_changed');
  requireScreenEditing(draft.content.screenEditing,
    timed ? draft.content.executionPlan.sceneGroups.map(scene => scene.id) : draft.content.shots.map(shot => shot.id), {required: true});
  if (timed) need(inspectTimedEditorialEpisode(episode).valid, 'local_storyboard_review_timeline_changed');
  else need(episode.scenes.length === 0 && episode.subtitles.length === 0 && episode.render?.durationSeconds === null,
    'local_storyboard_review_timeline_changed');
  return {episodeId: episode.id, storyboardVersion: draft.version, artifactHash: currentGateArtifactHash(episode, 'storyboard'),
    snapshotHash: digest({episode, reviewConfig, implementationFingerprint}), reviewConfigHash,
    implementationFingerprint, sourceScript: approved.sourceScript, sourceResearch: approved.sourceResearch,
    storyboardArtifact: {artifactPath: draft.artifactPath, artifactSha256: draft.sha256,
      manifestPath: draft.manifestPath, manifestSha256: draft.manifestSha256}};
}

export function assertLocalStoryboardReviewRequestMatches(input, binding) {
  const request = validateLocalStoryboardReviewRequest(input);
  for (const field of ['episodeId', 'storyboardVersion', 'artifactHash', 'snapshotHash']) {
    need(request[field] === binding[field], 'local_storyboard_review_snapshot_changed');
  }
  return request;
}
