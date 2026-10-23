// Internal factory for synthetic temporary-root tests; use the sealed production wrapper.
import {validateEpisode} from '../../shared/schema.mjs';
import {validateLocalResearchPreview, validateLocalResearchRequest, assertLocalResearchEpisode,
  localResearchCapabilitySpec, localResearchSnapshotHash, localResearchError} from '../../shared/local-research-request.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';
import {acquireEpisodeOperation} from '../control/episode-operation-lock.mjs';
import {readLocalScriptJson} from '../production/local-script-candidate.mjs';
import {validateResearchEvidenceBatch} from './schema.mjs';

export function createLocalResearchService(dependencies) {
  const {workspaceRoot,readEpisode,readResearchConfig,readReviewConfig,runAgent,importResearchEvidenceBatch}=dependencies;
  if(!workspaceRoot || [readEpisode,readResearchConfig,readReviewConfig,runAgent,importResearchEvidenceBatch].some(fn=>typeof fn!=='function')) throw new TypeError('Incomplete local research dependencies');
  async function load(rawInput) {
    const input=validateLocalResearchPreview(rawInput);
    const [episode,config,review]=await Promise.all([readEpisode(input.episodeId),readResearchConfig(),readReviewConfig()]);
    if(episode.id!==input.episodeId || !validateEpisode(episode).valid) throw localResearchError('local_research_episode_invalid');
    if(review.stages.research.semanticReview!==false) throw localResearchError('local_research_paid_review_forbidden');
    let record=null;
    if(input.action==='import') {
      record=await readLocalScriptJson(workspaceRoot,input.candidatePath,['outputs/','studio/data/research/inbox/'],4*1024*1024);
      if(record.value.episodeId!==episode.id || !validateResearchEvidenceBatch(record.value,config).valid) throw localResearchError('local_research_candidate_invalid');
    }
    if(episode.research?.packPath) {
      const pack=await readLocalScriptJson(workspaceRoot,episode.research.packPath,['studio/data/research/runs/'],4*1024*1024);
      const binding=episode.sourceDocs?.find(item=>item.path===episode.research.packPath);
      if(pack.value.episodeId!==episode.id || binding?.sha256!==pack.sha256 || binding?.bytes!==pack.bytes) throw localResearchError('local_research_evidence_changed');
    }
    return {episode,config,review,record,snapshotHash:localResearchSnapshotHash(episode,config,review,record?.sha256??null)};
  }
  async function previewLocalResearch(input) {
    const value=await load(input);
    const preview={...input,researchVersion:value.episode.research?.version??0,snapshotHash:value.snapshotHash,
      candidateSha256:value.record?.sha256??null,batchId:value.record?.value.batchId??null};
    assertLocalResearchEpisode({...preview,actor:'human:preview',reason:'Read-only research preview',confirmLocalResearch:true},value.episode,{initial:true});
    return {...preview,title:value.episode.title,humanApproved:false,paidCalls:0,estimatedCostUsd:0};
  }
  async function executeLocalResearch(rawRequest,options={}) {
    const request=validateLocalResearchRequest(rawRequest);
    if(!options || typeof options!=='object' || ![null,Object.prototype].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some(key=>key!=='sideEffectGrant' || !Object.hasOwn(Object.getOwnPropertyDescriptor(options,key),'value'))) throw localResearchError('local_research_options_invalid');
    const checked=Object.freeze({sideEffectGrant:options.sideEffectGrant});
    const sink=request.action==='run'?'worker:research-agent':'research:import-evidence';
    const guard=()=>requireSideEffectGrant(checked,localResearchCapabilitySpec(request),sink);
    guard();
    // Run takes its own Kernel lock; import shares that lock without nesting it.
    const release=request.action==='import'?acquireEpisodeOperation(request.episodeId,sink):()=>{};
    try {
      const value=await load({episodeId:request.episodeId,action:request.action,candidatePath:request.candidatePath});
      assertLocalResearchEpisode(request,value.episode,{initial:true});
      if((value.record?.sha256??null)!==request.candidateSha256 || (value.record?.value.batchId??null)!==request.batchId) throw localResearchError('local_research_candidate_changed');
      if(value.snapshotHash!==request.snapshotHash) throw localResearchError('local_research_snapshot_changed');
      guard();
      const authorized=Object.freeze({...checked,localResearchRequest:request,requireSideEffectCapability:true});
      return await (request.action==='run'
        ? runAgent(request.episodeId,'research-agent',authorized)
        : importResearchEvidenceBatch(value.record.value,authorized));
    } finally {release();}
  }
  return {previewLocalResearch,executeLocalResearch};
}
