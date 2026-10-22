// Test-only dependency factory; production imports the sealed wrapper.
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {validateApprovedScriptCompletionRequest,validateApprovedScriptCompletionPreview,approvedScriptCompletionCapabilitySpec} from '../../shared/approved-script-completion-request.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';
import {acquireEpisodeOperation} from '../control/episode-operation-lock.mjs';
import {completeApprovedScriptStep} from '../control/approved-script-transition.mjs';
import {loadApprovedScriptBinding,approvedScriptError} from './approved-script-binding.mjs';
import {evaluateProductionQuality} from './quality.mjs';

export function createApprovedScriptCompletionService(dependencies) {
  const {workspaceRoot,readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent,readReviewConfig}=dependencies;
  if(!workspaceRoot || [readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent,readReviewConfig].some(fn=>typeof fn!=='function')) throw new TypeError('Incomplete approved script completion dependencies');
  async function load(input) {
    const {episodeId}=validateApprovedScriptCompletionPreview(input);
    const episode=await readEpisode(episodeId);
    if(episode?.id!==episodeId) throw approvedScriptError('approved_script_episode_invalid');
    if(episode.control?.activeOperation || episode.control?.stopRequested || episode.pipeline.some(step=>step.status==='running')) throw approvedScriptError('approved_script_episode_busy');
    const reviewConfig=await readReviewConfig();
    const binding=await loadApprovedScriptBinding({workspaceRoot,episode,reviewConfig});
    if(episode.pipeline.find(step=>step.id==='research')?.status!=='complete') throw approvedScriptError('approved_script_transition_invalid');
    const quality=evaluateProductionQuality(episode,{stage:'script'});
    if(!quality.passed) throw approvedScriptError('approved_script_quality_failed');
    return {episode,...binding,quality,snapshotHash:digest({episode,reviewConfig,bindingHash:binding.bindingHash})};
  }
  async function previewApprovedScriptCompletion(input) {
    const value=await load(input);
    const step=value.episode.pipeline.find(item=>item.id==='script');
    return {episodeId:value.episode.id,sourceScript:value.sourceScript,sourceResearch:value.sourceResearch,snapshotHash:value.snapshotHash,
      scriptStepStatus:step.status,qualityScore:value.quality.score,paidCalls:0,estimatedCostUsd:0};
  }
  async function audit(episodeId,receipt,guard) {
    try {
      guard();
      await appendEvent({type:'script.approved-completed',episodeId,agentId:'script-agent',status:'complete',idempotencyKey:`approved-script-completion:${receipt.operationId}`,
        message:'已批准讲稿完成本地核验并进入分镜准备，未调用模型',actor:receipt.request.actor,artifactHash:receipt.sourceScript.artifactHash,paidCalls:0});
      return {status:'committed',errorCode:null};
    } catch (error) {return {status:'pending',errorCode:error?.code==='side_effect_capability_expired'?error.code:'approved_script_audit_pending'};}
  }
  async function completeApprovedScript(rawRequest,options={}) {
    const request=validateApprovedScriptCompletionRequest(rawRequest);
    if(!options || typeof options!=='object' || Array.isArray(options) || ![null,Object.prototype].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some(key=>key!=='sideEffectGrant' || !Object.hasOwn(Object.getOwnPropertyDescriptor(options,key),'value') || !Object.getOwnPropertyDescriptor(options,key).enumerable)) throw approvedScriptError('approved_script_options_invalid');
    const checkedOptions=Object.freeze({sideEffectGrant:options.sideEffectGrant});
    const guard=()=>requireSideEffectGrant(checkedOptions,approvedScriptCompletionCapabilitySpec(request),'script:complete-approved');
    const grant=guard();
    if(grant.maxCalls!==0 || grant.maxCostUsd!==0 || grant.scopes.length!==2 ||
      !grant.scopes.every(scope=>['state.write','filesystem.write'].includes(scope))) throw approvedScriptError('approved_script_capability_not_zero');
    const release=acquireEpisodeOperation(request.episodeId,'script:complete-approved');
    try {
      const value=await load({episodeId:request.episodeId});
      for(const key of ['artifactVersion','artifactHash','reviewReportId']) if(request[key]!==value.sourceScript[key]) throw approvedScriptError('approved_script_binding_changed');
      const operationId=digest(request);const previous=value.episode.production?.approvedScriptCompletion;
      if(value.episode.pipeline.find(step=>step.id==='script').status==='complete') {
        if(!previous || previous.operationId!==operationId || digest(previous.request)!==operationId || previous.bindingHash!==value.bindingHash ||
          digest(previous.sourceScript)!==digest(value.sourceScript) || previous.paidCalls!==0 || previous.estimatedCostUsd!==0) throw approvedScriptError('approved_script_completion_conflict');
        guard();
        const outcome=await audit(request.episodeId,previous,guard);
        return {status:outcome.status==='pending'?'committed_with_warning':'already_committed',episodeId:request.episodeId,sourceScript:value.sourceScript,paidCalls:0,estimatedCostUsd:0,audit:outcome};
      }
      if(value.snapshotHash!==request.snapshotHash) throw approvedScriptError('approved_script_snapshot_changed');
      // Repeat state/config/file validation under the operation lock immediately
      // before CAS. No worker, provider, credentials, or external requests exist.
      const current=await load({episodeId:request.episodeId});
      if(current.snapshotHash!==request.snapshotHash) throw approvedScriptError('approved_script_snapshot_changed');
      const now=new Date().toISOString();
      const receipt={schemaVersion:1,kind:'approved-script-zero-provider-completion',operationId,request,sourceScript:current.sourceScript,bindingHash:current.bindingHash,
        completedAt:now,paidCalls:0,estimatedCostUsd:0};
      const next=completeApprovedScriptStep(current.episode,{quality:current.quality,receipt,now});
      guard();await writeEpisode(next);
      const commit=readEpisodeCommitStatus(request.episodeId);const outcome=await audit(request.episodeId,receipt,guard);
      return {status:outcome.status==='pending' || commit?.warningCount>0 || commit?.commitStatus==='committed_with_warnings'?'committed_with_warning':'committed',
        episodeId:request.episodeId,sourceScript:current.sourceScript,paidCalls:0,estimatedCostUsd:0,audit:outcome,commit};
    } finally {release();}
  }
  return Object.freeze({previewApprovedScriptCompletion,completeApprovedScript});
}
