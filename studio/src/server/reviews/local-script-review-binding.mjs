// Read-only evidence binding for the closed local imported-script review entry.
// The caller owns Kernel locking/CAS. No approvals, state writes or providers run here.
import {canonicalJsonDocumentContentSha256 as digest, jsonDocumentContentSha256} from '../../shared/durable-json-store.mjs';
import {currentGateArtifactHash} from '../../shared/workflow.mjs';
import {validateEpisode} from '../../shared/schema.mjs';
import {assertVersionedConfig} from '../../shared/config-integrity.mjs';
import {localScriptReviewError, validateLocalScriptReviewRequest} from '../../shared/local-script-review-request.mjs';
import {validateLocalScriptRequest} from '../../shared/local-script-import-request.mjs';
import {approvalValidForGate} from '../control/policy-engine.mjs';
import {readLocalScriptJson, validateLocalScriptCandidate} from '../production/local-script-candidate.mjs';

const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const same = (left, right) => digest(left ?? null) === digest(right ?? null);
function need(condition, code = 'local_script_review_binding_invalid') {
  if (!condition) throw localScriptReviewError(code);
}

// Reject non-JSON inputs before schema/hash/clone can invoke accessors or toJSON.
function assertJsonData(value, active = new Set(), depth = 0) {
  need(depth < 80, 'local_script_review_input_invalid');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {need(Number.isFinite(value), 'local_script_review_input_invalid'); return;}
  need(value && typeof value === 'object' && !active.has(value), 'local_script_review_input_invalid');
  const array = Array.isArray(value);
  need(array ? Object.getPrototypeOf(value) === Array.prototype
    : [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'local_script_review_input_invalid');
  active.add(value);
  const keys = Reflect.ownKeys(value);
  if (array) need(keys.length === value.length + 1, 'local_script_review_input_invalid');
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(typeof key === 'string' && descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
      && (!array || /^(0|[1-9][0-9]*)$/u.test(key) && Number(key) < value.length), 'local_script_review_input_invalid');
    assertJsonData(descriptor.value, active, depth + 1);
  }
  active.delete(value);
}

export async function loadLocalScriptReviewBinding(sourceEpisode, options) {
  assertJsonData(sourceEpisode); assertJsonData(options);
  need(options && Object.keys(options).length === 3
    && ['workspaceRoot', 'reviewConfig', 'implementationFingerprint'].every(key => Object.hasOwn(options, key)),
  'local_script_review_options_invalid');
  const episode = structuredClone(sourceEpisode);
  const {workspaceRoot, reviewConfig, implementationFingerprint} = structuredClone(options);
  need(typeof workspaceRoot === 'string' && workspaceRoot.length > 0 && validateEpisode(episode).valid,
    'local_script_review_episode_invalid');
  need(!episode.control?.activeOperation && !episode.control?.stopRequested && !episode.control?.pendingDispatch
    && !episode.pipeline.some(step => step.status === 'running') && episode.reviews?.script?.status !== 'checking',
  'local_script_review_episode_busy');
  need(episode.control?.reviewEnabled === true && episode.pipeline.find(step => step.id === 'script')?.status === 'waiting_approval'
    && episode.pipeline.find(step => step.id === 'script')?.requiresApproval === 'script'
    && episode.approvals?.script?.status === 'pending', 'local_script_review_not_pending');
  need(reviewConfig?.stages?.script?.semanticReview === false
    && typeof reviewConfig.stages.script.version === 'string' && reviewConfig.stages.script.version.trim(),
  'local_script_review_not_deterministic');
  const reviewConfigHash = assertVersionedConfig('review-rubrics', reviewConfig).hash;
  need(implementationFingerprint && Object.keys(implementationFingerprint).length === 2
    && typeof implementationFingerprint.version === 'string' && implementationFingerprint.version.trim()
    && sha(implementationFingerprint.hash), 'local_script_review_implementation_invalid');
  need(episode.pipeline.find(step => step.id === 'research')?.status === 'complete'
    && approvalValidForGate(episode, 'research') && !episode.research?.needsRevision
    && episode.research?.readiness?.readyForFactApproval, 'local_script_review_research_not_approved');
  const researchApproval = episode.approvals.research;
  const reports = episode.reviews.research.reports.filter(report => report.id === researchApproval.reviewReportId);
  need(reports.length === 1 && reports[0].stage === 'research'
    && reports[0].rubricVersion === reviewConfig.stages.research?.version
    && reports[0].reviewConfigVersion === reviewConfig.version && reports[0].reviewConfigHash === reviewConfigHash,
  'local_script_review_research_binding_changed');

  const draft = episode.production?.scriptDraft;
  need(draft?.generationKind === 'codex-local-script-import' && !draft.needsRevision && draft.content
    && Number.isSafeInteger(draft.version) && draft.version > 0 && draft.version === episode.approvals.script.currentVersion
    && jsonDocumentContentSha256(draft.content) === draft.sha256, 'local_script_review_script_changed');
  const versions = (draft.versions ?? []).filter(entry => entry.version === draft.version);
  const entryFields = ['version', 'artifactPath', 'sha256', 'bytes', 'generatedAt', 'generationKind', 'importId',
    'importedBy', 'candidateSha256', 'sourceResearch', 'manifestPath', 'manifestSha256', 'manifestBytes'];
  need(versions.length === 1 && Object.keys(versions[0]).length === entryFields.length
    && entryFields.every(key => Object.hasOwn(versions[0], key) && same(versions[0][key], draft[key])),
    'local_script_review_script_changed');
  const prefix = `studio/data/production/episodes/${episode.id}/local-script/${draft.importId}/`;
  need(sha(draft.importId) && draft.artifactPath === `${prefix}script-v${String(draft.version).padStart(3, '0')}.json`
    && draft.manifestPath === `${prefix}import.json`, 'local_script_review_script_changed');
  async function registeredFile(path, bytes, hash, prefixes) {
    need(Number.isSafeInteger(bytes) && bytes > 0 && sha(hash), 'local_script_review_evidence_unregistered');
    const file = await readLocalScriptJson(workspaceRoot, path, prefixes, 4 * 1024 * 1024);
    need(file.bytes === bytes && file.sha256 === hash, 'local_script_review_evidence_changed');
    return file.value;
  }
  const artifact = await registeredFile(draft.artifactPath, draft.bytes, draft.sha256, [prefix]);
  need(same(artifact, draft.content), 'local_script_review_script_changed');
  const manifest = await registeredFile(draft.manifestPath, draft.manifestBytes, draft.manifestSha256, [prefix]);
  need(manifest.schemaVersion === 1 && manifest.kind === 'codex-local-script-import' && manifest.importId === draft.importId
    && manifest.version === draft.version && manifest.artifactPath === draft.artifactPath
    && manifest.artifactSha256 === draft.sha256 && same(manifest.candidate?.content, draft.content),
  'local_script_review_manifest_changed');
  const importRequest = validateLocalScriptRequest(manifest.request);
  need(digest(importRequest) === draft.importId && importRequest.episodeId === episode.id
    && importRequest.candidateSha256 === draft.candidateSha256 && importRequest.actor === draft.importedBy,
  'local_script_review_manifest_changed');
  const source = draft.sourceResearch;
  need(source && same(source, manifest.sourceResearch) && same(source, manifest.candidate?.sourceResearch)
    && source.artifactVersion === researchApproval.currentVersion
    && source.artifactHash === currentGateArtifactHash(episode, 'research')
    && source.reviewReportId === researchApproval.reviewReportId && source.packPath === episode.research.packPath,
  'local_script_review_research_binding_changed');
  const evidence = new Map();
  for (const record of episode.sourceDocs ?? []) {
    need(typeof record.path === 'string' && !evidence.has(record.path), 'local_script_review_source_unregistered');
    need(record.path.startsWith('studio/data/research/runs/') || record.path.startsWith('studio/data/research/inbox/')
      || record.path === 'studio/data/research/assist-task.json', 'local_script_review_source_unregistered');
    const value = await registeredFile(record.path, record.bytes, record.sha256, ['studio/data/research/']);
    need(value.episodeId === episode.id, 'local_script_review_source_unregistered');
    evidence.set(record.path, {sha256: record.sha256, value});
  }
  need(evidence.get(source.packPath)?.sha256 === source.packSha256
    && evidence.get(source.editorialBatchPath)?.sha256 === source.editorialBatchSha256,
  'local_script_review_source_unregistered');
  const pack = evidence.get(source.packPath).value;
  need(pack.readiness?.readyForFactApproval && evidence.get(source.editorialBatchPath).value.editorialBrief,
    'local_script_review_source_incomplete');
  validateLocalScriptCandidate(manifest.candidate, episode, pack);
  return {episodeId: episode.id, scriptVersion: draft.version, artifactHash: currentGateArtifactHash(episode, 'script'),
    snapshotHash: digest({episode, reviewConfig, implementationFingerprint}), reviewConfigHash,
    implementationFingerprint, sourceResearch: structuredClone(source),
    scriptArtifact: {artifactPath: draft.artifactPath, artifactSha256: draft.sha256,
      manifestPath: draft.manifestPath, manifestSha256: draft.manifestSha256}};
}

export function assertLocalScriptReviewRequestMatches(input, binding) {
  const request = validateLocalScriptReviewRequest(input);
  for (const field of ['episodeId', 'scriptVersion', 'artifactHash', 'snapshotHash']) {
    need(request[field] === binding[field], 'local_script_review_snapshot_changed');
  }
  return request;
}
