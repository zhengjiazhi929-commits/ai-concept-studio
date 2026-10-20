import {approvalValidForGate} from './policy-engine.mjs';
import {assertWorkerRunAllowed} from './workflow-kernel.mjs';
import {validateEpisode} from '../../shared/schema.mjs';
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {validateApprovedStoryboardCompletionRequest} from '../../shared/approved-storyboard-completion-request.mjs';
import {currentGateArtifactHash} from '../../shared/workflow.mjs';

// Kernel-owned transition. The sealed completion sink separately verifies disk
// evidence, current review configuration, exact Capability and CAS snapshot.
export function completeApprovedStoryboardStep(sourceEpisode,{quality,receipt,now}) {
  const invalid=()=>Object.assign(new Error('已批分镜不符合零调用完成转换条件'),{code:'approved_storyboard_transition_invalid',statusCode:409});
  const episode=structuredClone(sourceEpisode);
  const index=episode.pipeline.findIndex(step=>step.id==='storyboard');
  const step=episode.pipeline[index];const next=episode.pipeline[index+1];
  if(!validateEpisode(episode).valid || episode.control?.activeOperation || episode.control?.stopRequested ||
    episode.pipeline.some(item=>item.status==='running') ||
    !['research','script'].every(id=>episode.pipeline.find(item=>item.id===id)?.status==='complete') ||
    !['research','script','storyboard'].every(gate=>approvalValidForGate(episode,gate)) ||
    step?.agent!=='storyboard-agent' || step.status!=='ready' || step.requiresHuman ||
    next?.id!=='assets' || next.status!=='pending' || next.requiresHuman || !quality?.passed ||
    !receipt || receipt.schemaVersion!==1 || receipt.kind!=='approved-storyboard-zero-provider-completion' ||
    receipt.paidCalls!==0 || receipt.estimatedCostUsd!==0 || receipt.completedAt!==now || !Number.isFinite(Date.parse(now))) throw invalid();
  const request=validateApprovedStoryboardCompletionRequest(receipt.request);
  if(receipt.operationId!==digest(request) || request.episodeId!==episode.id ||
    request.artifactVersion!==episode.production.storyboardDraft.version || request.artifactHash!==currentGateArtifactHash(episode,'storyboard') ||
    request.reviewReportId!==episode.approvals.storyboard.reviewReportId ||
    !/^[a-f0-9]{64}$/u.test(receipt.bindingHash??'') || receipt.sourceStoryboard?.artifactHash!==request.artifactHash) throw invalid();
  assertWorkerRunAllowed(episode,'storyboard-agent');
  episode.pipeline[index]={...step,status:'complete',message:'已批准分镜完成本地证据与逐拍执行核验，未调用模型',progress:1,
    requiresApproval:null,requiresHuman:false,finishedAt:now,lastError:null,findings:structuredClone(quality.checks),
    artifacts:[episode.production.storyboardDraft.artifactPath,episode.production.storyboardDraft.manifestPath]};
  episode.pipeline[index+1]={...next,status:'ready',message:'已批分镜已完成，可准备素材；执行方案及素材声音仍需独立审核'};
  episode.production={...episode.production,quality:{...episode.production?.quality,storyboard:structuredClone(quality)},
    approvedStoryboardCompletion:structuredClone(receipt)};
  episode.updatedAt=now;
  if(!validateEpisode(episode).valid) throw invalid();
  return episode;
}
