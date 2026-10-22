// Read-only evidence closure shared by completion and deterministic asset planning.
// No approval, worker, provider or filesystem mutation is performed here.
import {canonicalJsonDocumentContentSha256 as digest,jsonDocumentContentSha256} from '../../shared/durable-json-store.mjs';
import {currentGateArtifactHash} from '../../shared/workflow.mjs';
import {validateEpisode} from '../../shared/schema.mjs';
import {assertVersionedConfig} from '../../shared/config-integrity.mjs';
import {approvalValidForGate} from '../control/policy-engine.mjs';
import {validateLocalStoryboardRequest} from '../../shared/local-storyboard-import-request.mjs';
import {loadApprovedScriptBinding} from './approved-script-binding.mjs';
import {readLocalStoryboardJson,validateLocalStoryboardCandidate} from './local-storyboard-candidate.mjs';
import {inspectTimedEditorialEpisode,TIMED_EDITORIAL_KIND,TIMED_EDITORIAL_CANDIDATE_KIND} from './timed-editorial-content.mjs';
import {evaluateProductionQuality} from './quality.mjs';

const sha=value=>typeof value==='string' && /^[a-f0-9]{64}$/u.test(value);
export function approvedStoryboardError(code) {
  return Object.assign(new Error('当前已批分镜、上游证据或逐拍执行时间轴不再匹配，请重新核对'),{code,statusCode:409});
}
function requireValue(value,code='approved_storyboard_binding_invalid') {
  if(!value) throw approvedStoryboardError(code);
}

export async function loadApprovedStoryboardBinding({workspaceRoot,episode,reviewConfig}) {
  requireValue(typeof workspaceRoot==='string' && validateEpisode(episode).valid,'approved_storyboard_episode_invalid');
  requireValue(['research','script','storyboard','assets'].every(id=>{
    const steps=episode.pipeline.filter(step=>step.id===id);
    return steps.length===1 && steps[0].agent===`${id==='assets'?'asset':id}-agent`;
  }),'approved_storyboard_transition_invalid');
  requireValue(['research','script'].every(id=>episode.pipeline.find(step=>step.id===id)?.status==='complete'),'approved_storyboard_upstream_incomplete');
  // This existing loader checks both upstream Gate reports/configuration and the
  // registered script, import manifest, research pack and editorial source batch.
  const upstream=await loadApprovedScriptBinding({workspaceRoot,episode,reviewConfig});
  const reviewConfigHash=assertVersionedConfig('review-rubrics',reviewConfig).hash;
  const draft=episode.production?.storyboardDraft;
  requireValue(episode.control.reviewEnabled===true && !draft?.needsRevision && approvalValidForGate(episode,'storyboard'),'approved_storyboard_not_approved');
  const approval=episode.approvals.storyboard;
  const reports=episode.reviews.storyboard.reports.filter(report=>report.id===approval.reviewReportId);
  requireValue(reports.length===1 && reports[0].stage==='storyboard' &&
    reports[0].rubricVersion===reviewConfig.stages.storyboard?.version &&
    reports[0].reviewConfigVersion===reviewConfig.version && reports[0].reviewConfigHash===reviewConfigHash,'approved_storyboard_review_changed');
  requireValue(draft.generationKind==='codex-local-storyboard-import' && draft.storyboardKind===TIMED_EDITORIAL_KIND &&
    draft.phase==='timed-editorial' && draft.timingStatus==='editorial-estimate' && draft.executionStatus==='implemented-contract' &&
    draft.content && jsonDocumentContentSha256(draft.content)===draft.sha256);
  const entries=(draft.versions??[]).filter(entry=>entry.version===draft.version);
  const entryFields=['version','artifactPath','sha256','bytes','generatedAt','generationKind','phase','storyboardKind',
    'timingStatus','executionStatus','importId','importedBy','candidateSha256','sourceScript','sourceResearch','manifestPath','manifestSha256','manifestBytes',
    ...(Object.hasOwn(draft,'screenEditorialRequired')?['screenEditorialRequired']:[])];
  requireValue(entries.length===1 && Object.keys(entries[0]).length===entryFields.length &&
    entryFields.every(key=>Object.hasOwn(entries[0],key) && digest(entries[0][key])===digest(draft[key]??null)));
  const prefix=`studio/data/production/episodes/${episode.id}/local-storyboard/${draft.importId}/`;
  requireValue(sha(draft.importId) && sha(draft.candidateSha256) &&
    draft.artifactPath===`${prefix}storyboard-v${String(draft.version).padStart(3,'0')}.json` && draft.manifestPath===`${prefix}import.json`);
  async function registeredFile(path,bytes,sha256) {
    requireValue(Number.isSafeInteger(bytes) && bytes>0 && sha(sha256));
    const file=await readLocalStoryboardJson(workspaceRoot,path,[prefix],4*1024*1024);
    requireValue(file.bytes===bytes && file.sha256===sha256,'approved_storyboard_evidence_changed');
    return file.value;
  }
  const artifact=await registeredFile(draft.artifactPath,draft.bytes,draft.sha256);
  requireValue(digest(artifact)===digest(draft.content));
  const manifest=await registeredFile(draft.manifestPath,draft.manifestBytes,draft.manifestSha256);
  requireValue(manifest.schemaVersion===1 && manifest.kind==='codex-local-storyboard-import' &&
    manifest.importId===draft.importId && manifest.version===draft.version && manifest.artifactPath===draft.artifactPath &&
    manifest.artifactSha256===draft.sha256 && manifest.candidate?.kind===TIMED_EDITORIAL_CANDIDATE_KIND &&
    digest(manifest.candidate?.content??null)===digest(draft.content));
  const request=validateLocalStoryboardRequest(manifest.request);
  requireValue(digest(request)===draft.importId && request.episodeId===episode.id &&
    request.candidateSha256===draft.candidateSha256 && request.actor===draft.importedBy);
  requireValue(digest(draft.sourceScript)===digest(upstream.sourceScript) && digest(manifest.sourceScript)===digest(upstream.sourceScript) &&
    digest(draft.sourceResearch)===digest(upstream.sourceResearch) && digest(manifest.sourceResearch)===digest(upstream.sourceResearch),'approved_storyboard_upstream_changed');
  validateLocalStoryboardCandidate(manifest.candidate,{episodeId:episode.id,script:upstream.script,sourceScript:upstream.sourceScript});
  requireValue(draft.screenEditorialRequired!==true || draft.content.screenEditing!=null,'approved_storyboard_screen_editing_missing');
  const inspection=inspectTimedEditorialEpisode(episode);
  requireValue(inspection.valid,'approved_storyboard_execution_changed');
  const quality=evaluateProductionQuality(episode,{stage:'storyboard'});
  requireValue(quality.passed,'approved_storyboard_quality_failed');
  const sourceStoryboard={artifactVersion:draft.version,artifactHash:currentGateArtifactHash(episode,'storyboard'),
    reviewReportId:approval.reviewReportId,artifactPath:draft.artifactPath,artifactSha256:draft.sha256,
    manifestPath:draft.manifestPath,manifestSha256:draft.manifestSha256};
  return {storyboard:structuredClone(draft.content),sourceStoryboard,sourceScript:upstream.sourceScript,
    sourceResearch:upstream.sourceResearch,inspection,quality,
    bindingHash:digest({sourceStoryboard,upstreamBindingHash:upstream.bindingHash,reviewConfigHash})};
}
