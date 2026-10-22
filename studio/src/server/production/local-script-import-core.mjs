// Internal factory for synthetic temp-root tests. Production uses the sealed wrapper.
import {resolve} from 'node:path';
import {canonicalJsonDocumentContentSha256 as digest, jsonDocumentContentSha256, writeImmutableJsonDocument} from '../../shared/durable-json-store.mjs';
import {currentGateArtifactHash, prepareGateForHumanReview} from '../../shared/workflow.mjs';
import {validateEpisode} from '../../shared/schema.mjs';
import {approvalValidForGate} from '../control/policy-engine.mjs';
import {acquireEpisodeOperation} from '../control/episode-operation-lock.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';
import {localScriptCapabilitySpec, validateLocalScriptRequest, validateLocalScriptPreview} from '../../shared/local-script-import-request.mjs';
import {localScriptError, readLocalScriptJson, validateLocalScriptCandidate} from './local-script-candidate.mjs';

const candidatePrefixes=['outputs/','studio/data/production/inbox/'];
const registeredPrefixes=['studio/data/research/runs/','studio/data/research/inbox/'];

export function createLocalScriptImportService(dependencies) {
  const {workspaceRoot:root,readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent,readReviewConfig}=dependencies;
  if(!root || [readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent,readReviewConfig].some(fn=>typeof fn!=='function')) throw new TypeError('Incomplete local script import dependencies');

  async function load(input) {
    const {episodeId,candidatePath}=validateLocalScriptPreview(input);
    const episode=await readEpisode(episodeId);
    if(episode.id!==episodeId || !validateEpisode(episode).valid) throw localScriptError('local_script_episode_invalid');
    if(episode.control?.activeOperation || episode.control?.stopRequested || episode.pipeline.some(step=>step.status==='running')) throw localScriptError('local_script_episode_busy');
    const scriptStep=episode.pipeline.find(step=>step.id==='script');
    if(!scriptStep || episode.pipeline.find(step=>step.id==='research')?.status!=='complete' || !episode.control?.reviewEnabled ||
      !approvalValidForGate(episode,'research') || episode.research?.needsRevision || !episode.research?.readiness?.readyForFactApproval) throw localScriptError('local_script_research_not_approved');
    const record=await readLocalScriptJson(root,candidatePath,candidatePrefixes);
    const candidate=record.value;
    const source=candidate?.sourceResearch;
    const approval=episode.approvals.research;
    const config=await readReviewConfig();
    const report=episode.reviews.research.reports.find(item=>item.id===approval.reviewReportId);
    if(!source || source.artifactVersion!==approval.currentVersion || source.artifactHash!==currentGateArtifactHash(episode,'research') ||
      source.reviewReportId!==approval.reviewReportId || source.packPath!==episode.research.packPath ||
      report?.rubricVersion!==config.stages.research.version || report.reviewConfigVersion!==config.version) throw localScriptError('local_script_research_binding_changed');
    async function registered(path,expectedHash) {
      const matches=(episode.sourceDocs??[]).filter(item=>item.path===path);
      if(matches.length!==1 || matches[0].sha256!==expectedHash) throw localScriptError('local_script_source_unregistered');
      const file=await readLocalScriptJson(root,path,registeredPrefixes);
      if(file.sha256!==expectedHash || file.bytes!==matches[0].bytes || file.value?.episodeId!==episode.id) throw localScriptError('local_script_source_changed');
      return file.value;
    }
    const pack=await registered(source.packPath,source.packSha256);
    const batch=await registered(source.editorialBatchPath,source.editorialBatchSha256);
    if(!pack.readiness?.readyForFactApproval || !batch.editorialBrief) throw localScriptError('local_script_source_incomplete');
    validateLocalScriptCandidate(candidate,episode,pack);
    return {episode,candidate,candidateSha256:record.sha256,snapshotHash:digest({episode,reviewConfig:config,candidateSha256:record.sha256})};
  }

  async function previewLocalScript(input) {
    const value=await load(input);
    return {episodeId:value.episode.id,candidatePath:input.candidatePath,candidateSha256:value.candidateSha256,snapshotHash:value.snapshotHash,
      title:value.candidate.content.title,sectionCount:value.candidate.content.sections.length,
      currentScriptVersion:value.episode.production?.scriptDraft?.version??0,sourceResearch:value.candidate.sourceResearch,
      humanApproved:false,paidCalls:0,estimatedCostUsd:0};
  }

  async function audit(episodeId,entry,guard) {
    try {
      guard();
      await appendEvent({type:'script.local-imported',episodeId,agentId:'script-agent',status:'waiting_approval',
        idempotencyKey:`local-script:${episodeId}:${entry.importId}`,message:`本地讲稿 v${entry.version} 已入库，尚未人工批准`,
        artifactPath:entry.artifactPath,actor:entry.importedBy});
      return {status:'committed',errorCode:null};
    } catch (error) {return {status:'pending',errorCode:error?.code==='side_effect_capability_expired'?error.code:'local_script_audit_pending'};}
  }

  async function importLocalScript(rawRequest,options={}) {
    const request=validateLocalScriptRequest(rawRequest);
    if(!options || typeof options!=='object' || ![null,Object.prototype].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some(key=>key!=='sideEffectGrant' || !Object.hasOwn(Object.getOwnPropertyDescriptor(options,key),'value'))) throw localScriptError('local_script_options_invalid');
    const checkedOptions=Object.freeze({sideEffectGrant:options.sideEffectGrant});
    const guard=()=>requireSideEffectGrant(checkedOptions,localScriptCapabilitySpec(request),'script:import-local');
    guard();
    const release=acquireEpisodeOperation(request.episodeId,'script:import-local');
    try {
      const value=await load({episodeId:request.episodeId,candidatePath:request.candidatePath});
      if(value.candidateSha256!==request.candidateSha256) throw localScriptError('local_script_candidate_changed');
      const existing=value.episode.production?.scriptDraft;
      const previous=existing?.versions?.find(entry=>entry.candidateSha256===request.candidateSha256);
      if(previous) {
        if(existing.importId!==previous.importId || digest(existing.content)!==digest(value.candidate.content)) throw localScriptError('local_script_superseded');
        if(Object.keys(previous).some(key=>digest(existing[key]??null)!==digest(previous[key]??null))) throw localScriptError('local_script_artifact_changed');
        const artifact=await readLocalScriptJson(root,previous.artifactPath,['studio/data/production/episodes/'],4*1024*1024);
        if(artifact.sha256!==previous.sha256 || digest(artifact.value)!==digest(value.candidate.content)) throw localScriptError('local_script_artifact_changed');
        const manifest=await readLocalScriptJson(root,previous.manifestPath,['studio/data/production/episodes/'],4*1024*1024);
        if(manifest.sha256!==previous.manifestSha256 || manifest.bytes!==previous.manifestBytes ||
          manifest.value.importId!==previous.importId || manifest.value.artifactPath!==previous.artifactPath ||
          manifest.value.artifactSha256!==previous.sha256) throw localScriptError('local_script_artifact_changed');
        guard();
        const outcome=await audit(request.episodeId,previous,guard);
        return {status:outcome.status==='pending'?'committed_with_warning':'already_committed',episodeId:request.episodeId,version:existing.version,artifactPath:existing.artifactPath,audit:outcome};
      }
      if(value.snapshotHash!==request.snapshotHash) throw localScriptError('local_script_snapshot_changed');
      const version=Math.max(existing?.version??0,...(existing?.versions??[]).map(entry=>entry.version))+1;
      const importId=digest(request);
      const directory=`studio/data/production/episodes/${request.episodeId}/local-script/${importId}`;
      const artifactPath=`${directory}/script-v${String(version).padStart(3,'0')}.json`;
      const manifestPath=`${directory}/import.json`;
      const candidate=value.candidate;
      const artifactSha256=jsonDocumentContentSha256(candidate.content);
      const manifest={schemaVersion:1,kind:'codex-local-script-import',importId,request,version,artifactPath,artifactSha256,candidate,sourceResearch:candidate.sourceResearch};
      guard();await writeImmutableJsonDocument(resolve(root,artifactPath),candidate.content,{storeRoot:root});
      guard();await writeImmutableJsonDocument(resolve(root,manifestPath),manifest,{storeRoot:root});
      // Recheck source files and Episode before CAS; a stale writer may leave
      // immutable orphan files, but must not advance the authoritative pointer.
      const current=await load({episodeId:request.episodeId,candidatePath:request.candidatePath});
      if(current.snapshotHash!==request.snapshotHash) throw localScriptError('local_script_snapshot_changed');
      const at=new Date().toISOString();
      const entry={version,artifactPath,sha256:artifactSha256,bytes:Buffer.byteLength(`${JSON.stringify(candidate.content,null,2)}\n`),
        generatedAt:at,generationKind:'codex-local-script-import',importId,importedBy:request.actor,
        candidateSha256:request.candidateSha256,sourceResearch:structuredClone(candidate.sourceResearch),manifestPath,manifestSha256:jsonDocumentContentSha256(manifest),
        manifestBytes:Buffer.byteLength(`${JSON.stringify(manifest,null,2)}\n`)};
      let next=structuredClone(current.episode);
      const versions=structuredClone(existing?.versions??[]);
      if(existing && !versions.some(item=>item.version===existing.version)) {
        const {versions:ignored,...legacy}=existing;
        versions.push(structuredClone(legacy));
      }
      next.production={...next.production,scriptDraft:{...entry,needsRevision:false,content:structuredClone(candidate.content),versions:[...versions,entry]}};
      next=prepareGateForHumanReview(next,{gate:'script',reason:`本地讲稿 v${version} 已入库；${request.reason}`,now:at}).episode;
      const step=next.pipeline.find(item=>item.id==='script');
      step.artifacts=[artifactPath,manifestPath];step.findings=[];step.finishedAt=null;step.progress=1;
      if(!validateEpisode(next).valid) throw localScriptError('local_script_episode_invalid');
      guard();await writeEpisode(next);
      const commit=readEpisodeCommitStatus(request.episodeId);
      const outcome=await audit(request.episodeId,entry,guard);
      return {status:outcome.status==='pending' || commit?.warningCount>0 || commit?.commitStatus==='committed_with_warnings'?'committed_with_warning':'committed',episodeId:request.episodeId,version,artifactPath,manifestPath,
        artifactHash:currentGateArtifactHash(next,'script'),humanApproved:false,reviewStatus:'not_started',audit:outcome,commit};
    } finally {release();}
  }
  return Object.freeze({previewLocalScript,importLocalScript});
}
