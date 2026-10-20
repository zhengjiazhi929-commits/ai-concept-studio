import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readFixtureEpisode} from './episode-fixture.mjs';
import {createEpisodeWriterCore} from '../src/shared/episode-store-writer-core.mjs';
import {currentGateArtifactHash} from '../src/shared/workflow.mjs';
import {createLocalScriptImportService} from '../src/server/production/local-script-import-core.mjs';
import {localScriptCapabilitySpec} from '../src/shared/local-script-import-request.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {readReviewConfig} from '../src/server/reviews/coordinator.mjs';
import {recheckGateReview} from '../src/server/orchestrator.mjs';
import {readLocalScriptJson} from '../src/server/production/local-script-candidate.mjs';
import {assertProductionExpiry, assertProductionAuditExpiry, assertProductionManifestExpiry, assertProductionNullAudit} from './production-capability-expiry-fixture.mjs';

const sha = (body) => createHash('sha256').update(body).digest('hex');
const code = (value) => (error) => error.code === value;
const grant = (request) => ({sideEffectGrant: createCapabilityAuthority({secret:'synthetic-local-script-test-only-00000000000000'}).authorize(localScriptCapabilitySpec(request))});

for (const expireAt of [1, 2]) test(`script import rejects authority expiring during load ${expireAt}`, async t => {
  await assertProductionExpiry(t, {setup: fixture, createService: createLocalScriptImportService,
    capabilitySpec: localScriptCapabilitySpec, method: 'importLocalScript', expireAt});
});
test('script import reports committed warning if authority expires after CAS, then repairs audit safely', async t => {
  await assertProductionAuditExpiry(t, {setup: fixture, createService: createLocalScriptImportService,
    capabilitySpec: localScriptCapabilitySpec, method: 'importLocalScript'});
});
test('script import rechecks expiry between the immutable artifact and manifest', async t => {
  await assertProductionManifestExpiry(t, {setup: fixture, capabilitySpec: localScriptCapabilitySpec, method: 'importLocalScript',
    directory: 'local-script', artifactName: 'script-v001.json', manifestName: 'import.json'});
});
test('script import preserves committed status on null or undefined audit rejection', async t => {
  await assertProductionNullAudit(t, {setup: fixture, createService: createLocalScriptImportService,
    capabilitySpec: localScriptCapabilitySpec, method: 'importLocalScript'});
});

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'local-script-test-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const put = async (path,value) => {await mkdir(dirname(resolve(root,path)),{recursive:true}); const body=JSON.stringify(value); await writeFile(resolve(root,path),body); return {path,bytes:Buffer.byteLength(body),sha256:sha(body)};};
  const episode = await readFixtureEpisode();
  episode.id='local-script-test'; delete episode.productionProfile; delete episode.derivation;
  episode.control.activeOperation=null; episode.control.stopRequested=false;
  episode.control.mode='shadow'; episode.control.reviewEnabled=true;
  episode.production={ai:{requestCount:0}};
  const packPath='studio/data/research/runs/synthetic-pack.json';
  const batchPath='studio/data/research/inbox/synthetic-batch.json';
  const pack={episodeId:episode.id,claims:[{id:'c1',support:'supported'},{id:'c2',support:'supported'}],readiness:{readyForFactApproval:true}};
  episode.sourceDocs=[await put(packPath,pack),await put(batchPath,{episodeId:episode.id,editorialBrief:{case:'synthetic'}})];
  episode.research={version:1,packPath,readiness:{readyForFactApproval:true},needsRevision:false};
  const hash=currentGateArtifactHash(episode,'research');
  const config=await readReviewConfig();
  const report={id:'synthetic-research-report',stage:'research',decision:'pass',artifactVersion:1,artifactHash:hash,rubricVersion:config.stages.research.version,reviewConfigVersion:config.version,reviewMode:'deterministic',confidence:1,blockingIssues:[],warnings:[],passedChecks:['synthetic-only']};
  episode.approvals.research={...episode.approvals.research,status:'approved',currentVersion:1,artifactHash:hash,reviewReportId:report.id,provenance:'reviewed-v2'};
  episode.reviews.research={...episode.reviews.research,status:'passed',artifactVersion:1,artifactHash:hash,latestReportId:report.id,reports:[report]};
  episode.pipeline.forEach(step=>{step.status=step.id==='research'?'complete':step.id==='script'?'ready':'pending';step.requiresApproval=null;step.requiresHuman=false;});
  const candidate={schemaVersion:1,kind:'codex-authored-script-candidate-v1',episodeId:episode.id,candidateVersion:1,author:'Codex',status:'local-editorial-draft',humanApproved:false,sourceResearch:{artifactVersion:1,artifactHash:hash,reviewReportId:report.id,packPath,packSha256:episode.sourceDocs[0].sha256,editorialBatchPath:batchPath,editorialBatchSha256:episode.sourceDocs[1].sha256},chapterMapping:Array.from({length:6},(_,i)=>({sectionId:`S${i+1}`,chapter:`第${i+1}章`})),content:{title:'Synthetic local script',thesis:'这是一段测试用的讲稿论点，不是现实事实。',targetDurationSeconds:480,hook:'测试开场',sections:Array.from({length:6},(_,i)=>({id:`S${i+1}`,heading:`第${i+1}节`,purpose:'明确测试目的',narration:'这是测试用的正文内容，用于验证讲稿版本与证据的对应关系。'.repeat(9),evidenceRefs:['c1'],visualDirection:'按信息关系显示。'})),closing:'测试结束',factCheckNotes:['仅为测试，不作为生产内容。']}};
  const candidatePath='outputs/candidate/script.json'; await put(candidatePath,candidate);
  const episodePath=resolve(root,'episodes',episode.id,'episode.json');
  const writer=createEpisodeWriterCore({episodeDataDirectory:()=>dirname(episodePath),episodeDataPath:()=>episodePath});
  episode.control.stateVersion=0; await writer.writeEpisode(episode);
  const events=[];
  const deps={workspaceRoot:root,readEpisode:async()=>JSON.parse(await readFile(episodePath,'utf8')),writeEpisode:writer.writeEpisode,readEpisodeCommitStatus:writer.readEpisodeCommitStatus,appendEvent:async event=>events.push(event),readReviewConfig};
  const service=createLocalScriptImportService(deps);
  const preview=await service.previewLocalScript({episodeId:episode.id,candidatePath});
  const request={episodeId:episode.id,candidatePath,candidateSha256:preview.candidateSha256,snapshotHash:preview.snapshotHash,actor:'human:fixture',reason:'Explicit synthetic local import test',confirmLocalScriptImport:true};
  return {root,put,episodePath,episode,candidate,candidatePath,pack,batchPath,packPath,deps,service,request,events};
}

test('preview has no writes; import records truthful v1, preserves research/AI and resets downstream gates',async t=>{
  const f=await fixture(t); const before=await f.deps.readEpisode();
  await f.service.previewLocalScript({episodeId:before.id,candidatePath:f.candidatePath});
  assert.deepEqual(await f.deps.readEpisode(),before); assert.equal(f.events.length,0);
  const result=await f.service.importLocalScript(f.request,grant(f.request));
  assert.equal(result.status,'committed');
  const after=await f.deps.readEpisode();
  assert.equal(after.production.scriptDraft.version,1);
  assert.equal(after.production.scriptDraft.generationKind,'codex-local-script-import');
  assert.deepEqual(after.production.scriptDraft.content,f.candidate.content);
  assert.deepEqual(after.production.ai,before.production.ai);
  assert.deepEqual(after.approvals.research,before.approvals.research);
  assert.deepEqual(after.research,before.research); assert.deepEqual(after.sourceDocs,before.sourceDocs);
  for(const gate of ['script','storyboard','assets','final']) assert.equal(after.approvals[gate].status,'pending');
  assert.equal(after.pipeline.find(s=>s.id==='script').status,'waiting_approval');
  assert.equal(after.reviews.script.status,'not_started');
  const artifact=JSON.parse(await readFile(resolve(f.root,result.artifactPath),'utf8'));
  assert.deepEqual(artifact,f.candidate.content);
});

test('no grant or mismatched actor grant never writes',async t=>{
  const f=await fixture(t);const before=await readFile(f.episodePath,'utf8');
  await assert.rejects(f.service.importLocalScript(f.request),code('side_effect_capability_missing'));
  await assert.rejects(f.service.importLocalScript({...f.request,actor:'human:other'},grant(f.request)));
  assert.equal(await readFile(f.episodePath,'utf8'),before);
});

test('candidate edits, stale snapshots, active operation and revoked research fail closed',async t=>{
  for(const mutation of ['candidate','snapshot','active','approval','rubric','batch','pack']) {
    const f=await fixture(t);
    if(mutation==='candidate') {f.candidate.content.title='Changed';await f.put(f.candidatePath,f.candidate);}
    else if(mutation==='batch') await f.put(f.batchPath,{episodeId:f.episode.id,editorialBrief:'changed'});
    else if(mutation==='pack') await f.put(f.packPath,{...f.pack,claims:[]});
    else {const e=await f.deps.readEpisode();
      if(mutation==='snapshot') e.title='Changed title';
      if(mutation==='active') e.control.activeOperation={id:'active',kind:'render',startedAt:new Date().toISOString()};
      if(mutation==='approval') e.approvals.research.status='pending';
      if(mutation==='rubric') e.reviews.research.reports[0].rubricVersion='old-rubric';
      await f.deps.writeEpisode(e);
    }
    const before=await readFile(f.episodePath,'utf8');
    await assert.rejects(f.service.importLocalScript(f.request,grant(f.request)));
    assert.equal(await readFile(f.episodePath,'utf8'),before,mutation);
  }
});

test('unknown candidate fields, invalid claim refs and symlink inputs rejected before writes',async t=>{
  for(const mutation of ['extra','approved','claim','mapping','duplicate','symlink']) {
    const f=await fixture(t);
    if(mutation==='extra') f.candidate.content.provider='fake';
    if(mutation==='approved') f.candidate.humanApproved=true;
    if(mutation==='claim') f.candidate.content.sections[0].evidenceRefs=['unknown'];
    if(mutation==='mapping') f.candidate.chapterMapping[0].sectionId='unknown';
    if(mutation==='duplicate') f.candidate.content.sections[1].id='S1';
    if(mutation==='symlink') {await rm(resolve(f.root,f.candidatePath));await symlink(resolve(f.root,f.packPath),resolve(f.root,f.candidatePath));}
    else await f.put(f.candidatePath,f.candidate);
    await assert.rejects(f.service.previewLocalScript({episodeId:f.episode.id,candidatePath:f.candidatePath}));
  }
});

test('retry after audit failure or later script approval never adds versions or resets gates',async t=>{
  const f=await fixture(t); let failed=true;
  const service=createLocalScriptImportService({...f.deps,appendEvent:async()=>{if(failed) throw new Error('audit failed');}});
  const first=await service.importLocalScript(f.request,grant(f.request)); assert.equal(first.status,'committed_with_warning');
  let e=await f.deps.readEpisode(); e.approvals.script.status='approved'; await f.deps.writeEpisode(e);
  const before=await f.deps.readEpisode();failed=false;
  const retry=await service.importLocalScript(f.request,grant(f.request));assert.equal(retry.status,'already_committed');
  assert.deepEqual(await f.deps.readEpisode(),before);
});

test('CAS failure leaves no registered draft and retry adopts only verified immutable files',async t=>{
  const f=await fixture(t); const broken=createLocalScriptImportService({...f.deps,writeEpisode:async()=>{throw Object.assign(new Error('CAS'),{code:'state_version_conflict'});}});
  await assert.rejects(broken.importLocalScript(f.request,grant(f.request)),code('state_version_conflict'));
  assert.equal((await f.deps.readEpisode()).production.scriptDraft,undefined);
  const result=await f.service.importLocalScript(f.request,grant(f.request)); assert.equal(result.status,'committed');
  assert.equal((await f.deps.readEpisode()).production.scriptDraft.versions.length,1);
});

test('two concurrent imports can register only one draft',async t=>{
  const f=await fixture(t);
  const results=await Promise.allSettled([f.service.importLocalScript(f.request,grant(f.request)),f.service.importLocalScript(f.request,grant(f.request))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await f.deps.readEpisode()).production.scriptDraft.versions.length,1);
});

test('inherited or getter authority options are rejected before any callback executes',async t=>{
  const f=await fixture(t);let calls=0;
  const options=Object.create({authorizeSideEffect:spec=>{calls++;return createCapabilityAuthority({secret:'synthetic-local-script-test-only-00000000000000'}).authorize(spec);}});
  await assert.rejects(f.service.importLocalScript(f.request,options));assert.equal(calls,0);
  const accessor={};Object.defineProperty(accessor,'sideEffectGrant',{enumerable:true,get(){calls++;return grant(f.request).sideEffectGrant;}});
  await assert.rejects(f.service.importLocalScript(f.request,accessor));assert.equal(calls,0);
});

test('legacy current draft is retained when it has no versions array',async t=>{
  const f=await fixture(t);let e=await f.deps.readEpisode();
  const old={version:3,artifactPath:'preserved-legacy.json',content:{title:'preserved legacy'},generatedAt:'2026-01-01T00:00:00Z'};
  e.production.scriptDraft=old;await f.deps.writeEpisode(e);
  const preview=await f.service.previewLocalScript({episodeId:e.id,candidatePath:f.candidatePath});
  const request={...f.request,snapshotHash:preview.snapshotHash};
  await f.service.importLocalScript(request,grant(request));e=await f.deps.readEpisode();
  assert.equal(e.production.scriptDraft.version,4);
  assert.deepEqual(e.production.scriptDraft.versions[0],old);
  assert.equal(e.pipeline.find(s=>s.id==='script').progress,1);
});

test('retry fails closed on missing or changed immutable import manifest',async t=>{
  const f=await fixture(t);const first=await f.service.importLocalScript(f.request,grant(f.request));
  await f.put(first.manifestPath,{tampered:true});
  await assert.rejects(f.service.importLocalScript(f.request,grant(f.request)),code('local_script_artifact_changed'));
});

test('retry rejects current pointer changes and exposes committed writer warnings without duplicate writes',async t=>{
  const f=await fixture(t);let writes=0;
  const service=createLocalScriptImportService({...f.deps,writeEpisode:async e=>{writes++;await f.deps.writeEpisode(e);},readEpisodeCommitStatus:()=>({commitStatus:'committed_with_warnings',warningCount:1})});
  const result=await service.importLocalScript(f.request,grant(f.request));assert.equal(result.status,'committed_with_warning');assert.equal(writes,1);
  const e=await f.deps.readEpisode();e.production.scriptDraft.artifactPath='changed.json';await f.deps.writeEpisode(e);
  await assert.rejects(service.importLocalScript(f.request,grant(f.request)),code('local_script_artifact_changed'));assert.equal(writes,1);
});

test('new revision invalidates approved downstream states and keeps original immutable bytes',async t=>{
  const f=await fixture(t);const first=await f.service.importLocalScript(f.request,grant(f.request));
  const bytes=await readFile(resolve(f.root,first.artifactPath));
  let e=await f.deps.readEpisode();
  for(const gate of ['script','storyboard','assets','final']) {e.approvals[gate].status='approved';e.approvals[gate].history=[{synthetic:'preserve'}];e.reviews[gate].status='passed';e.reviews[gate].artifactVersion=1;}
  await f.deps.writeEpisode(e);
  f.candidate.content.title='Synthetic second revision';f.candidate.candidateVersion=2;await f.put(f.candidatePath,f.candidate);
  const preview=await f.service.previewLocalScript({episodeId:e.id,candidatePath:f.candidatePath});
  const request={...f.request,snapshotHash:preview.snapshotHash,candidateSha256:preview.candidateSha256};
  await f.service.importLocalScript(request,grant(request));e=await f.deps.readEpisode();
  assert.equal(e.production.scriptDraft.version,2);assert.equal(e.production.scriptDraft.versions.length,2);
  assert.deepEqual(await readFile(resolve(f.root,first.artifactPath)),bytes);
  for(const gate of ['script','storyboard','assets','final']) {assert.equal(e.approvals[gate].status,'pending');assert.equal(e.reviews[gate].status,'not_started');assert.deepEqual(e.approvals[gate].history,[{synthetic:'preserve'}]);}
});

test('bounded reader rejects oversized files, directories and symlink ancestors',async t=>{
  const f=await fixture(t);await writeFile(resolve(f.root,f.candidatePath),' '.repeat(1024*1024+1));
  await assert.rejects(readLocalScriptJson(f.root,f.candidatePath,['outputs/']),code('local_script_file_invalid'));
  await mkdir(resolve(f.root,'outputs/directory.json'));
  await assert.rejects(readLocalScriptJson(f.root,'outputs/directory.json',['outputs/']),code('local_script_file_invalid'));
  await symlink(resolve(f.root,'studio/data/research/runs'),resolve(f.root,'outputs/link'));
  await assert.rejects(readLocalScriptJson(f.root,'outputs/link/synthetic-pack.json',['outputs/']));
});

test('formal deterministic review and interrupted audit recovery retain pending human gate and zero AI calls',async t=>{
  const f=await fixture(t);await f.service.importLocalScript(f.request,grant(f.request));
  const before=await f.deps.readEpisode();
  await assert.rejects(recheckGateReview(before.id,'script',{readEpisode:f.deps.readEpisode,writeEpisode:f.deps.writeEpisode,appendEvent:async()=>{throw new Error('synthetic audit interruption');}}));
  const recovered=await f.deps.readEpisode();assert.equal(recovered.control.activeOperation,null);
  assert.equal(recovered.production.scriptDraft.version,1);assert.equal(recovered.approvals.script.status,'pending');
  const result=await recheckGateReview(before.id,'script',{readEpisode:f.deps.readEpisode,writeEpisode:f.deps.writeEpisode,appendEvent:f.deps.appendEvent});
  const after=await f.deps.readEpisode();
  assert.equal(result.review.report.reviewMode,'deterministic');
  assert.equal(after.production.ai.requestCount,0);assert.equal(after.approvals.script.status,'pending');
  assert.equal(result.review.report.artifactVersion,1);
  assert.deepEqual(after.approvals.research,before.approvals.research);
});
