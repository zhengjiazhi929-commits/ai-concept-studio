// Internal factory for synthetic temporary stores. Production fixes these
// dependencies in the sealed wrapper; requests cannot inject authority or work.
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {validateApprovedStoryboardCompletionRequest,validateApprovedStoryboardCompletionPreview,approvedStoryboardCompletionCapabilitySpec} from '../../shared/approved-storyboard-completion-request.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';
import {acquireEpisodeOperation} from '../control/episode-operation-lock.mjs';
import {completeApprovedStoryboardStep} from '../control/approved-storyboard-transition.mjs';
import {loadApprovedStoryboardBinding,approvedStoryboardError} from './approved-storyboard-binding.mjs';

export function createApprovedStoryboardCompletionService(dependencies) {
  const {workspaceRoot,readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent,readReviewConfig}=dependencies;
  if(!workspaceRoot || [readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent,readReviewConfig].some(fn=>typeof fn!=='function')) throw new TypeError('Incomplete approved storyboard completion dependencies');
  async function load(input) {
    const {episodeId}=validateApprovedStoryboardCompletionPreview(input);
    const episode=await readEpisode(episodeId);
    if(episode?.id!==episodeId) throw approvedStoryboardError('approved_storyboard_episode_invalid');
    if(episode.control?.activeOperation || episode.control?.stopRequested || episode.pipeline.some(step=>step.status==='running')) throw approvedStoryboardError('approved_storyboard_episode_busy');
    const reviewConfig=await readReviewConfig();
    const binding=await loadApprovedStoryboardBinding({workspaceRoot,episode,reviewConfig});
    return {episode,...binding,snapshotHash:digest({episode,reviewConfig,bindingHash:binding.bindingHash})};
  }
  async function previewApprovedStoryboardCompletion(input) {
    const value=await load(input);
    return {episodeId:value.episode.id,sourceStoryboard:value.sourceStoryboard,sourceScript:value.sourceScript,sourceResearch:value.sourceResearch,
      bindingHash:value.bindingHash,snapshotHash:value.snapshotHash,storyboardStepStatus:value.episode.pipeline.find(step=>step.id==='storyboard').status,
      qualityScore:value.quality.score,timingStatus:'editorial-estimate',audioAligned:false,renderReady:false,paidCalls:0,estimatedCostUsd:0};
  }
  async function audit(episodeId,receipt,guard) {
    try {
      guard();
      await appendEvent({type:'storyboard.approved-completed',episodeId,agentId:'storyboard-agent',status:'complete',
        idempotencyKey:`approved-storyboard-completion:${receipt.operationId}`,actor:receipt.request.actor,
        message:'已批准分镜完成本地核验并进入素材准备，未调用模型',artifactHash:receipt.sourceStoryboard.artifactHash,
        artifactVersion:receipt.sourceStoryboard.artifactVersion,reviewReportId:receipt.sourceStoryboard.reviewReportId,paidCalls:0,estimatedCostUsd:0});
      return {status:'committed',errorCode:null};
    } catch (error) {return {status:'pending',errorCode:error?.code==='side_effect_capability_expired'?error.code:'approved_storyboard_audit_pending'};}
  }
  async function completeApprovedStoryboard(rawRequest,options={}) {
    const request=validateApprovedStoryboardCompletionRequest(rawRequest);
    if(!options || typeof options!=='object' || Array.isArray(options) || ![null,Object.prototype].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some(key=>key!=='sideEffectGrant' || !Object.hasOwn(Object.getOwnPropertyDescriptor(options,key),'value') || !Object.getOwnPropertyDescriptor(options,key).enumerable)) throw approvedStoryboardError('approved_storyboard_options_invalid');
    const checkedOptions=Object.freeze({sideEffectGrant:options.sideEffectGrant});
    const guard=()=>requireSideEffectGrant(checkedOptions,approvedStoryboardCompletionCapabilitySpec(request),'storyboard:complete-approved');
    const grant=guard();
    if(grant.maxCalls!==0 || grant.maxCostUsd!==0 || digest([...grant.scopes].sort())!==digest(['filesystem.write','state.write'])) throw approvedStoryboardError('approved_storyboard_capability_not_zero');
    const release=acquireEpisodeOperation(request.episodeId,'storyboard:complete-approved');
    try {
      const value=await load({episodeId:request.episodeId});
      for(const key of ['artifactVersion','artifactHash','reviewReportId']) if(request[key]!==value.sourceStoryboard[key]) throw approvedStoryboardError('approved_storyboard_binding_changed');
      const operationId=digest(request);const previous=value.episode.production?.approvedStoryboardCompletion;
      if(value.episode.pipeline.find(step=>step.id==='storyboard').status==='complete') {
        if(!previous || previous.schemaVersion!==1 || previous.kind!=='approved-storyboard-zero-provider-completion' ||
          previous.operationId!==operationId || digest(previous.request)!==operationId || previous.bindingHash!==value.bindingHash ||
          digest(previous.sourceStoryboard)!==digest(value.sourceStoryboard) || previous.paidCalls!==0 || previous.estimatedCostUsd!==0 ||
          !Number.isFinite(Date.parse(previous.completedAt))) throw approvedStoryboardError('approved_storyboard_completion_conflict');
        guard();
        const outcome=await audit(request.episodeId,previous,guard);
        return {status:outcome.status==='pending'?'committed_with_warning':'already_committed',episodeId:request.episodeId,
          sourceStoryboard:value.sourceStoryboard,paidCalls:0,estimatedCostUsd:0,audit:outcome};
      }
      if(previous || value.snapshotHash!==request.snapshotHash) throw approvedStoryboardError('approved_storyboard_snapshot_changed');
      // Re-read Episode/config AND every registered file under the lock. The
      // injected production writer then compares the observed stateVersion.
      const current=await load({episodeId:request.episodeId});
      if(current.snapshotHash!==request.snapshotHash) throw approvedStoryboardError('approved_storyboard_snapshot_changed');
      const now=new Date().toISOString();
      const receipt={schemaVersion:1,kind:'approved-storyboard-zero-provider-completion',operationId,request,
        sourceStoryboard:current.sourceStoryboard,bindingHash:current.bindingHash,completedAt:now,paidCalls:0,estimatedCostUsd:0};
      const next=completeApprovedStoryboardStep(current.episode,{quality:current.quality,receipt,now});
      guard();await writeEpisode(next);
      const commit=readEpisodeCommitStatus(request.episodeId);const outcome=await audit(request.episodeId,receipt,guard);
      return {status:outcome.status==='pending' || commit?.warningCount>0 || commit?.commitStatus==='committed_with_warnings'?'committed_with_warning':'committed',
        episodeId:request.episodeId,sourceStoryboard:current.sourceStoryboard,paidCalls:0,estimatedCostUsd:0,audit:outcome,commit};
    } finally {release();}
  }
  return Object.freeze({previewApprovedStoryboardCompletion,completeApprovedStoryboard});
}
