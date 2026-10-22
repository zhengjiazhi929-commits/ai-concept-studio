// Synthetic-only evidence. Never copy a live Episode or production output here.
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readFixtureEpisode} from './episode-fixture.mjs';
import {createEpisodeWriterCore} from '../src/shared/episode-store-writer-core.mjs';
import {currentGateArtifactHash, applyApprovalDecision} from '../src/shared/workflow.mjs';
import {assertVersionedConfig} from '../src/shared/config-integrity.mjs';
import {createLocalScriptImportService} from '../src/server/production/local-script-import-core.mjs';
import {localScriptCapabilitySpec} from '../src/shared/local-script-import-request.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {readReviewConfig} from '../src/server/reviews/coordinator.mjs';

export async function approvedScriptFixture(t, options = {}) {
  const root=await mkdtemp(resolve(tmpdir(),'approved-script-fixture-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const put=async(path,value)=>{
    await mkdir(dirname(resolve(root,path)),{recursive:true});
    const body=`${JSON.stringify(value,null,2)}\n`;
    await writeFile(resolve(root,path),body);
    return {path,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')};
  };
  const episode=await readFixtureEpisode();
  episode.id='approved-script-fixture'; delete episode.productionProfile; delete episode.derivation;
  episode.control.activeOperation=null; episode.control.stopRequested=false;
  episode.control.mode='shadow';episode.control.reviewEnabled=true;
  episode.control.budget={...episode.control.budget,maxCalls:0,maxCostUsd:0,usedCalls:0,usedCostUsd:0,reservedCalls:0,reservedCostUsd:0};
  episode.production={ai:{requestCount:0}};
  const packPath='studio/data/research/runs/synthetic-approved-pack.json';
  const batchPath='studio/data/research/inbox/synthetic-approved-batch.json';
  const pack={episodeId:episode.id,claims:[{id:'c1',support:'supported'}],readiness:{readyForFactApproval:true}};
  episode.sourceDocs=[await put(packPath,pack),await put(batchPath,{episodeId:episode.id,editorialBrief:{case:'synthetic'}}),await put('studio/data/research/inbox/synthetic-evidence.json',{episodeId:episode.id,kind:'synthetic-only'})];
  episode.research={version:1,packPath,readiness:{readyForFactApproval:true},needsRevision:false};
  const config=await readReviewConfig();
  const approve=(value,gate)=>{
    const hash=currentGateArtifactHash(value,gate);
    const report={id:`synthetic-approved-${gate}-report`,stage:gate,decision:'pass',artifactVersion:1,artifactHash:hash,rubricVersion:config.stages[gate].version,reviewConfigVersion:config.version,reviewConfigHash:assertVersionedConfig('review-rubrics',config).hash,reviewMode:'deterministic',confidence:1,blockingIssues:[],warnings:[],passedChecks:['synthetic-only']};
    value.reviews[gate]={...value.reviews[gate],status:'passed',artifactVersion:1,artifactHash:hash,latestReportId:report.id,reports:[report]};
    value.approvals[gate]={...value.approvals[gate],currentVersion:1};
    return applyApprovalDecision(value,{gate,decision:'approved',actor:'human:synthetic-fixture',note:'Synthetic test-only approval'}).episode;
  };
  let state=approve(episode,'research');
  state.pipeline.forEach(step=>{step.status=step.id==='research'?'complete':step.id==='script'?'ready':'pending';step.requiresApproval=null;step.requiresHuman=false;});
  const sourceResearch={artifactVersion:1,artifactHash:state.approvals.research.artifactHash,reviewReportId:state.approvals.research.reviewReportId,packPath,packSha256:state.sourceDocs[0].sha256,editorialBatchPath:batchPath,editorialBatchSha256:state.sourceDocs[1].sha256};
  const candidate={schemaVersion:1,kind:'codex-authored-script-candidate-v1',episodeId:state.id,candidateVersion:1,author:'Codex',status:'local-editorial-draft',humanApproved:false,sourceResearch,chapterMapping:Array.from({length:6},(_,i)=>({sectionId:`S${i+1}`,chapter:`第${i+1}章`})),content:{title:'Synthetic approved script',thesis:'这是一段测试用的讲稿论点，不是现实事实。',targetDurationSeconds:480,hook:'测试开场',sections:Array.from({length:6},(_,i)=>({id:`S${i+1}`,heading:`第${i+1}节`,purpose:'明确测试目的',narration:'这是测试用的正文内容，用于验证讲稿版本与证据的对应关系。'.repeat(9),evidenceRefs:['c1'],visualDirection:'按信息关系显示。'})),closing:'测试结束',factCheckNotes:['仅为测试，不作为生产内容。']}};
  if (options.sectionNarration !== undefined) {
    for (const section of candidate.content.sections) section.narration = options.sectionNarration;
  }
  const candidatePath='outputs/synthetic-approved/script.json';await put(candidatePath,candidate);
  const episodePath=resolve(root,'episodes',state.id,'episode.json');
  const writer=createEpisodeWriterCore({episodeDataDirectory:()=>dirname(episodePath),episodeDataPath:()=>episodePath});
  state.control.stateVersion=0;await writer.writeEpisode(state);
  const events=[];
  const deps={workspaceRoot:root,readEpisode:async()=>JSON.parse(await readFile(episodePath,'utf8')),writeEpisode:writer.writeEpisode,readEpisodeCommitStatus:writer.readEpisodeCommitStatus,appendEvent:async event=>events.push(event),readReviewConfig:async()=>structuredClone(config)};
  const importer=createLocalScriptImportService(deps);
  const preview=await importer.previewLocalScript({episodeId:state.id,candidatePath});
  const request={episodeId:state.id,candidatePath,candidateSha256:preview.candidateSha256,snapshotHash:preview.snapshotHash,actor:'human:fixture',reason:'Explicit synthetic import for zero-provider completion tests',confirmLocalScriptImport:true};
  const sideEffectGrant=createCapabilityAuthority({secret:'synthetic-approved-fixture-only-00000000000000'}).authorize(localScriptCapabilitySpec(request));
  await importer.importLocalScript(request,{sideEffectGrant});
  state=approve(await deps.readEpisode(),'script');await deps.writeEpisode(state);events.length=0;
  return {root,put,episodePath,episode:state,pack,packPath,batchPath,candidate,candidatePath,config,deps,events};
}
