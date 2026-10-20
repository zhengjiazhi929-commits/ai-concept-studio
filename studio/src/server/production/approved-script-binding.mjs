// Read-only, bounded local evidence loader shared by the two closed production
// services. It does not approve, advance, generate, or invoke injected callbacks.
import {canonicalJsonDocumentContentSha256 as digest,jsonDocumentContentSha256} from '../../shared/durable-json-store.mjs';
import {currentGateArtifactHash} from '../../shared/workflow.mjs';
import {validateEpisode} from '../../shared/schema.mjs';
import {assertVersionedConfig} from '../../shared/config-integrity.mjs';
import {approvalValidForGate} from '../control/policy-engine.mjs';
import {readLocalScriptJson,validateLocalScriptCandidate} from './local-script-candidate.mjs';
import {validateLocalScriptRequest} from '../../shared/local-script-import-request.mjs';

export function approvedScriptError(code) {
  return Object.assign(new Error('当前已批讲稿、研究证据或流转状态不再匹配，请重新核对'),{code,statusCode:409});
}
function requireValue(condition,code='approved_script_binding_invalid') {
  if(!condition) throw approvedScriptError(code);
}

export async function loadApprovedScriptBinding({workspaceRoot,episode,reviewConfig}) {
  requireValue(typeof workspaceRoot==='string' && validateEpisode(episode).valid,'approved_script_episode_invalid');
  const reviewConfigHash=assertVersionedConfig('review-rubrics',reviewConfig).hash;
  requireValue(episode.control?.reviewEnabled===true && !episode.research?.needsRevision && !episode.production?.scriptDraft?.needsRevision && episode.research?.readiness?.readyForFactApproval,'approved_script_not_approved');
  for(const gate of ['research','script']) {
    requireValue(approvalValidForGate(episode,gate),'approved_script_not_approved');
    const approval=episode.approvals[gate];
    const reports=episode.reviews[gate].reports.filter(item=>item.id===approval.reviewReportId);
    requireValue(reports.length===1 && reports[0].stage===gate && reports[0].rubricVersion===reviewConfig.stages[gate]?.version &&
      reports[0].reviewConfigVersion===reviewConfig.version && reports[0].reviewConfigHash===reviewConfigHash,'approved_script_review_changed');
  }
  const draft=episode.production.scriptDraft;
  requireValue(draft.generationKind==='codex-local-script-import' && draft.content && jsonDocumentContentSha256(draft.content)===draft.sha256);
  const entries=(draft.versions??[]).filter(entry=>entry.version===draft.version);
  requireValue(entries.length===1 && Object.keys(entries[0]).every(key=>digest(entries[0][key])===digest(draft[key]??null)));
  const prefix=`studio/data/production/episodes/${episode.id}/local-script/${draft.importId}/`;
  requireValue(/^[a-f0-9]{64}$/u.test(draft.importId??'') && draft.artifactPath===`${prefix}script-v${String(draft.version).padStart(3,'0')}.json` && draft.manifestPath===`${prefix}import.json`);
  async function registeredFile(path,bytes,sha256,prefixes) {
    requireValue(Number.isSafeInteger(bytes) && bytes>0 && typeof sha256==='string' && /^[a-f0-9]{64}$/u.test(sha256));
    const file=await readLocalScriptJson(workspaceRoot,path,prefixes,4*1024*1024);
    requireValue(file.bytes===bytes && file.sha256===sha256,'approved_script_evidence_changed');
    return file.value;
  }
  const artifact=await registeredFile(draft.artifactPath,draft.bytes,draft.sha256,[prefix]);
  requireValue(digest(artifact)===digest(draft.content));
  const manifest=await registeredFile(draft.manifestPath,draft.manifestBytes,draft.manifestSha256,[prefix]);
  requireValue(manifest.schemaVersion===1 && manifest.kind==='codex-local-script-import' && manifest.importId===draft.importId && manifest.version===draft.version &&
    manifest.artifactPath===draft.artifactPath && manifest.artifactSha256===draft.sha256 && digest(manifest.candidate?.content??null)===digest(draft.content));
  const importRequest=validateLocalScriptRequest(manifest.request);
  requireValue(digest(importRequest)===draft.importId && importRequest.episodeId===episode.id && importRequest.candidateSha256===draft.candidateSha256 && importRequest.actor===draft.importedBy);
  const source=draft.sourceResearch;
  requireValue(source && digest(source)===digest(manifest.sourceResearch??null) && digest(source)===digest(manifest.candidate?.sourceResearch??null));
  requireValue(source.artifactVersion===episode.approvals.research.currentVersion && source.artifactHash===currentGateArtifactHash(episode,'research') && source.reviewReportId===episode.approvals.research.reviewReportId && source.packPath===episode.research.packPath);
  async function sourceFile(path,expectedHash) {
    const sources=episode.sourceDocs.filter(item=>item.path===path);
    requireValue(sources.length===1 && sources[0].sha256===expectedHash,'approved_script_source_unregistered');
    const value=await registeredFile(path,sources[0].bytes,expectedHash,['studio/data/research/runs/','studio/data/research/inbox/']);
    requireValue(value.episodeId===episode.id);
    return value;
  }
  const pack=await sourceFile(source.packPath,source.packSha256);
  const batch=await sourceFile(source.editorialBatchPath,source.editorialBatchSha256);
  requireValue(pack.readiness?.readyForFactApproval && batch.editorialBrief);
  validateLocalScriptCandidate(manifest.candidate,episode,pack);
  const sourceScript={artifactVersion:draft.version,artifactHash:currentGateArtifactHash(episode,'script'),reviewReportId:episode.approvals.script.reviewReportId,
    artifactPath:draft.artifactPath,artifactSha256:draft.sha256,manifestPath:draft.manifestPath,manifestSha256:draft.manifestSha256};
  return {script:structuredClone(draft.content),sourceScript,sourceResearch:structuredClone(source),
    bindingHash:digest({sourceScript,sourceResearch:source,reviewConfigHash})};
}
