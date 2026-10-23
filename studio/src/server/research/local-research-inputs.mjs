// Internal read-only input checks. Every local operation rechecks actual inputs
// at side-effect boundaries; an earlier preview or a dispatch token is not a
// substitute for the bytes being consumed now.
import {workspaceRoot} from '../../shared/paths.mjs';
import {localResearchSnapshotHash,localResearchError,validateLocalResearchRequest} from '../../shared/local-research-request.mjs';
import {readLocalScriptJson} from '../production/local-script-candidate.mjs';
import {readResearchConfig} from './store.mjs';
import {readReviewConfig} from '../reviews/coordinator.mjs';

export function assertLocalResearchConfigBinding(request,sourceEpisode,researchConfig,reviewConfig) {
  if(reviewConfig?.stages?.research?.semanticReview!==false)throw localResearchError('local_research_paid_review_forbidden');
  if(localResearchSnapshotHash(sourceEpisode,researchConfig,reviewConfig,request.candidateSha256)!==request.snapshotHash) {
    throw localResearchError('local_research_snapshot_changed');
  }
}

export function assertLocalResearchPackRecord(sourceEpisode,record) {
  const path=sourceEpisode.research?.packPath;
  const bindings=sourceEpisode.sourceDocs?.filter(item=>item.path===path)??[];
  if(!path || bindings.length!==1 || !record || record.sha256!==bindings[0].sha256 || record.bytes!==bindings[0].bytes
    || (Object.hasOwn(record,'value') && record.value?.episodeId!==sourceEpisode.id)) {
    throw localResearchError('local_research_evidence_changed');
  }
}

export const readLocalResearchRecord=(path,prefixes)=>readLocalScriptJson(workspaceRoot,path,prefixes,4*1024*1024);

export async function readBoundLocalResearchInputs(rawRequest,sourceEpisode,dependencies={}) {
  const request=validateLocalResearchRequest(rawRequest);
  const [researchConfig,reviewConfig]=await Promise.all([
    (dependencies.readResearchConfig??readResearchConfig)(),(dependencies.readReviewConfig??readReviewConfig)()
  ]);
  assertLocalResearchConfigBinding(request,sourceEpisode,researchConfig,reviewConfig);
  const readRecord=dependencies.readLocalResearchRecord??readLocalResearchRecord;
  let pack=null,candidate=null;
  if(sourceEpisode.research?.packPath){
    const record=await readRecord(sourceEpisode.research.packPath,['studio/data/research/runs/']);
    assertLocalResearchPackRecord(sourceEpisode,record);pack=record.value;
  }
  if(request.action==='import'){
    const record=await readRecord(request.candidatePath,['outputs/','studio/data/research/inbox/']);
    if(record.sha256!==request.candidateSha256 || record.value?.episodeId!==request.episodeId || record.value?.batchId!==request.batchId) {
      throw localResearchError('local_research_candidate_changed');
    }
    candidate=record.value;
  }
  return structuredClone({researchConfig,reviewConfig,pack,candidate});
}
