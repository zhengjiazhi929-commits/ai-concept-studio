import {approvalValidForGate} from './policy-engine.mjs';
import {assertWorkerRunAllowed} from './workflow-kernel.mjs';
import {validateEpisode} from '../../shared/schema.mjs';

// Kernel-owned deterministic transition, not an Agent execution. The production
// completion sink verifies current disk evidence and authorization before use.
export function completeApprovedScriptStep(sourceEpisode,{quality,receipt,now}) {
  const invalid=()=>Object.assign(new Error('已批脚本不符合零调用完成转换条件'),{code:'approved_script_transition_invalid',statusCode:409});
  const episode=structuredClone(sourceEpisode);
  const index=episode.pipeline.findIndex(step=>step.id==='script');
  const step=episode.pipeline[index];const next=episode.pipeline[index+1];
  if(!validateEpisode(episode).valid || episode.control?.activeOperation || episode.control?.stopRequested || episode.pipeline.some(item=>item.status==='running') ||
    episode.pipeline.find(item=>item.id==='research')?.status!=='complete' || !approvalValidForGate(episode,'research') || !approvalValidForGate(episode,'script') ||
    step?.agent!=='script-agent' || step.status!=='ready' || step.requiresHuman || next?.id!=='storyboard' || next.status!=='pending' || next.requiresHuman || !quality?.passed ||
    !receipt || receipt.paidCalls!==0 || receipt.estimatedCostUsd!==0 || !Number.isFinite(Date.parse(now))) throw invalid();
  assertWorkerRunAllowed(episode,'script-agent');
  episode.pipeline[index]={...step,status:'complete',message:'已批准讲稿完成本地质量与证据核验，未调用模型',progress:1,requiresApproval:null,requiresHuman:false,
    finishedAt:now,lastError:null,findings:structuredClone(quality.checks),artifacts:[episode.production.scriptDraft.artifactPath,episode.production.scriptDraft.manifestPath]};
  episode.pipeline[index+1]={...next,status:'ready',message:'上一步已完成，可准备分镜；仍需独立机器审核与人工批准'};
  episode.production={...episode.production,quality:{...episode.production?.quality,script:structuredClone(quality)},approvedScriptCompletion:structuredClone(receipt)};
  episode.updatedAt=now;
  if(!validateEpisode(episode).valid) throw invalid();
  return episode;
}
