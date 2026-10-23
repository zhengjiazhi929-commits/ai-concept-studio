import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve, relative, basename} from 'node:path';
import {createEpisodeWriterCore} from '../src/shared/episode-store-writer-core.mjs';
import {buildEpisodeFromTrendSelection} from '../src/server/research/episode.mjs';
import {runAgent} from '../src/server/orchestrator.mjs';
import {runEpisodeResearchAgent, researchPatch, importResearchEvidenceBatch} from '../src/server/research/agent.mjs';
import {readResearchConfig, readLatestResearchPack, readResearchPackAtPath, writeResearchPack,
  writeResearchAssistTask, writeResearchEvidenceBatch, writeResearchPackRevision,
  publishResearchPackRevision} from '../src/server/research/store.mjs';
import {readReviewConfig} from '../src/server/reviews/coordinator.mjs';
import {createLocalResearchService} from '../src/server/research/local-research-core.mjs';
import {readLocalScriptJson} from '../src/server/production/local-script-candidate.mjs';
import {localResearchCapabilitySpec} from '../src/shared/local-research-request.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {inspectFileIntegrity} from '../src/shared/integrity.mjs';

const rejectCode = code => error => error.code === code;
const deferred = () => {let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve};};

async function fixture(t) {
  const root=await mkdtemp(resolve(tmpdir(),'local-research-kernel-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const id=`synthetic-research-${randomUUID()}`;
  const researchRoot=resolve(root,'studio/data/research');
  const path=resolve(root,'studio/data/episodes',id,'episode.json');
  const writer=createEpisodeWriterCore({episodeDataDirectory:()=>resolve(root,'studio/data/episodes',id),episodeDataPath:()=>path});
  const episode=buildEpisodeFromTrendSelection({schemaVersion:1,selectedAt:'2026-10-22T00:00:00Z',
    runId:'synthetic-only-run',candidateId:'synthetic-harness',episodeId:id,concept:'Synthetic Harness',
    recommendedTitle:'Synthetic Harness research',primarySources:[{label:'Synthetic specification',url:'https://example.org/specification'}],
    productDecisions:[],creatorEvidence:[],evidenceSignals:[]},new Date('2026-10-22T00:00:00Z'));
  await writer.writeEpisode(episode);
  let writes=0, artifacts=0, requests=0, clock=Date.now();
  const events=[];
  const readEpisode=async()=>JSON.parse(await readFile(path,'utf8'));
  const writeEpisode=async value=>{writes++;return writer.writeEpisode(value);};
  const appendEvent=async value=>{events.push(structuredClone(value));return structuredClone(value);};
  const fileRecord=async target=>{const bytes=await readFile(target);return {path:relative(root,target).replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
  const dependencies={readEpisode,writeEpisode,appendEvent,fileRecord,readResearchConfig,readReviewConfig,
    readLocalResearchRecord:(target,prefixes)=>readLocalScriptJson(root,target,prefixes,4*1024*1024),
    readLocalResearchCandidate:target=>readLocalScriptJson(root,target,['outputs/','studio/data/research/inbox/'],4*1024*1024),
    readLatestResearchPack:episodeId=>readLatestResearchPack(episodeId,{researchRoot}),
    readResearchPackAtPath:target=>readResearchPackAtPath(target.startsWith(root)?target:resolve(researchRoot,'runs',basename(target)),{researchRoot}),
    writeResearchPack:async value=>{artifacts++;return writeResearchPack(value,{researchRoot});},
    writeResearchAssistTask:async value=>{artifacts++;return writeResearchAssistTask(value,{researchRoot});},
    writeResearchEvidenceBatch:async value=>{artifacts++;return writeResearchEvidenceBatch(value,{researchRoot});},
    writeResearchPackRevision:async value=>{artifacts++;return writeResearchPackRevision(value,{researchRoot});},
    publishResearchPackRevision:(value,target)=>publishResearchPackRevision(value,resolve(researchRoot,'runs',basename(target)),{researchRoot})};
  const control={beforeFetch:async()=>{},beforeWorker:async()=>{},beforeLookup:async()=>{}};
  const agent={async run(value,context) {
    await control.beforeWorker();
    const result=await runEpisodeResearchAgent(value,{dependencies,localResearchRequest:context.localResearchRequest,
      localResearchDispatch:context.localResearchDispatch,
      sideEffectGrant:context.sideEffectGrant,capabilityOperation:'worker:research-agent',requireSideEffectCapability:true,
      lookupImpl:async()=>{await control.beforeLookup();return [{address:'93.184.216.34',family:4}];},fetchImpl:async()=>{
        requests++;await control.beforeFetch();return new Response('<title>Synthetic public specification</title>',{headers:{'content-type':'text/html'}});
      }});
    return {status:'blocked',message:'Synthetic evidence still needs claims',artifacts:result.sourceDocs.map(item=>item.path),
      findings:result.pack.readiness.reasons,patch:researchPatch(value,result)};
  }};
  const run=(episodeId,agentId,options)=>runAgent(episodeId,agentId,{...options,readEpisode,writeEpisode,appendEvent,agent,
    inspectFileIntegrity:target=>inspectFileIntegrity(resolve(root,'studio/data/research/runs',basename(target)))});
  const service=createLocalResearchService({workspaceRoot:root,readEpisode,readResearchConfig,readReviewConfig,
    runAgent:run,importResearchEvidenceBatch:(batch,options)=>importResearchEvidenceBatch(batch,{...options,dependencies})});
  const authority=createCapabilityAuthority({secret:'synthetic-kernel-research-authority-0000000000000',now:()=>clock});
  const requestFor=async(action='run',candidatePath=null)=>{
    const p=await service.previewLocalResearch({episodeId:id,action,candidatePath});
    return {episodeId:id,action,candidatePath,researchVersion:p.researchVersion,snapshotHash:p.snapshotHash,
      candidateSha256:p.candidateSha256,batchId:p.batchId,actor:'human:fixture',reason:'Synthetic local research authorization',confirmLocalResearch:true};
  };
  const authorize=request=>({sideEffectGrant:authority.authorize(localResearchCapabilitySpec(request))});
  return {root,id,researchRoot,path,writer,readEpisode,writeEpisode,dependencies,service,run,control,requestFor,authorize,
    expire:()=>{clock+=60_000;},get writes(){return writes;},get artifacts(){return artifacts;},get requests(){return requests;},events};
}

test('real research worker and CAS persist a version without granting human approval',async t=>{
  const f=await fixture(t);const request=await f.requestFor();
  const result=await f.service.executeLocalResearch(request,f.authorize(request));
  const persisted=await f.readEpisode();
  assert.equal(result.output.status,'blocked');
  assert.equal(persisted.research.version,1);
  assert.equal(persisted.approvals.research.status,'pending');
  assert.equal(persisted.production.ai.requestCount,0);
  assert.equal(persisted.control.activeOperation,null);
  assert.ok(persisted.control.stateVersion>1);
  assert.ok(f.requests>0);assert.equal(f.artifacts,2);
  assert.equal((await readLatestResearchPack(f.id,{researchRoot:f.researchRoot})).episodeId,f.id);
});

test('a local research grant cannot enter another real Kernel worker',async t=>{
  const f=await fixture(t);const request=await f.requestFor();const before=await readFile(f.path);
  await assert.rejects(f.run(f.id,'trend-agent',{...f.authorize(request),localResearchRequest:request,requireSideEffectCapability:true}));
  assert.deepEqual(await readFile(f.path),before);assert.equal(f.writes,0);assert.equal(f.requests,0);
});

test('Kernel independently rejects a stale preview before any state or research write',async t=>{
  const f=await fixture(t);const request=await f.requestFor();
  const changed=await f.readEpisode();changed.title='Changed synthetic title';await f.writer.writeEpisode(changed);
  const before=await readFile(f.path);
  await assert.rejects(f.run(f.id,'research-agent',{...f.authorize(request),localResearchRequest:request,requireSideEffectCapability:true}),rejectCode('local_research_snapshot_changed'));
  assert.deepEqual(await readFile(f.path),before);assert.equal(f.writes,0);assert.equal(f.artifacts,0);
});

test('expiry during a fake public response prohibits subsequent artifact and CAS writes',async t=>{
  const f=await fixture(t);const request=await f.requestFor();let allowedWrites;
  f.control.beforeFetch=async()=>{allowedWrites=f.writes;f.expire();};
  await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)),rejectCode('side_effect_capability_expired'));
  assert.equal(f.artifacts,0);assert.equal(f.writes,allowedWrites);
  const persisted=await f.readEpisode();assert.equal(persisted.research.version,0);assert.equal(persisted.approvals.research.status,'pending');
});

test('expiry across DNS await prevents actual public HTTP dispatch',async t=>{
  const f=await fixture(t);const request=await f.requestFor();let allowedWrites;
  f.control.beforeLookup=async()=>{allowedWrites=f.writes;f.expire();};
  await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)),rejectCode('side_effect_capability_expired'));
  assert.equal(f.requests,0);assert.equal(f.artifacts,0);assert.equal(f.writes,allowedWrites);
});

test('same-Episode concurrent Kernel run is rejected while first real research run is active',async t=>{
  const f=await fixture(t);const request=await f.requestFor();const entered=deferred(),release=deferred();
  f.control.beforeFetch=async()=>{entered.resolve();await release.promise;};
  const first=f.service.executeLocalResearch(request,f.authorize(request));
  first.catch(()=>{});
  try {
    await Promise.race([entered.promise,first.then(()=>{throw new Error('Worker finished before fetch');})]);
    const writes=f.writes;
    await assert.rejects(f.run(f.id,'research-agent',{...f.authorize(request),localResearchRequest:request,requireSideEffectCapability:true}),rejectCode('episode_operation_active'));
    assert.equal(f.writes,writes);
  } finally {release.resolve();}
  await first;assert.equal((await f.readEpisode()).research.version,1);
});

test('real evidence import uses CAS and identical batch is idempotent only with fresh preview',async t=>{
  const f=await fixture(t);const runRequest=await f.requestFor();
  await f.service.executeLocalResearch(runRequest,f.authorize(runRequest));
  const candidatePath='outputs/synthetic-evidence.json';await mkdir(resolve(f.root,'outputs'));
  const batch={schemaVersion:1,batchId:'synthetic-kernel-batch',episodeId:f.id,researchedAt:'2026-10-22T00:00:00Z',method:'Synthetic evidence fixture only',sources:[],claims:[]};
  await writeFile(resolve(f.root,candidatePath),JSON.stringify(batch));
  const request=await f.requestFor('import',candidatePath);
  const stateBefore=await readFile(f.path);const artifactsBefore=f.artifacts;
  await assert.rejects(importResearchEvidenceBatch({...batch,method:'Mutated same-ID synthetic batch'},
    {...f.authorize(request),localResearchRequest:request,requireSideEffectCapability:true,dependencies:f.dependencies}),rejectCode('local_research_candidate_changed'));
  assert.deepEqual(await readFile(f.path),stateBefore);assert.equal(f.artifacts,artifactsBefore);
  const result=await f.service.executeLocalResearch(request,f.authorize(request));
  assert.equal(result.idempotent,false);const after=await f.readEpisode();assert.equal(after.research.version,2);
  await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)));
  const fresh=await f.requestFor('import',candidatePath);
  const repeat=await f.service.executeLocalResearch(fresh,f.authorize(fresh));
  assert.equal(repeat.idempotent,true);assert.equal((await f.readEpisode()).control.stateVersion,after.control.stateVersion);
  assert.equal((await f.readEpisode()).approvals.research.status,'pending');
});

test('import retains the Episode lock until its asynchronous operation settles',async t=>{
  const f=await fixture(t);const initial=await f.requestFor();
  await f.service.executeLocalResearch(initial,f.authorize(initial));
  const candidatePath='outputs/lock-evidence.json';await mkdir(resolve(f.root,'outputs'));
  const batch={schemaVersion:1,batchId:'synthetic-lock-batch',episodeId:f.id,researchedAt:'2026-10-22T00:00:00Z',method:'Synthetic held import',sources:[],claims:[]};
  await writeFile(resolve(f.root,candidatePath),JSON.stringify(batch));
  const request=await f.requestFor('import',candidatePath);const runRequest=await f.requestFor();
  const entered=deferred(),release=deferred();const writeBatch=f.dependencies.writeResearchEvidenceBatch;
  f.dependencies.writeResearchEvidenceBatch=async value=>{entered.resolve();await release.promise;return writeBatch(value);};
  const first=f.service.executeLocalResearch(request,f.authorize(request));first.catch(()=>{});
  try {
    await Promise.race([entered.promise,first.then(()=>{throw new Error('Import unexpectedly settled before holding the batch write');})]);
    const writes=f.writes;
    await assert.rejects(f.run(f.id,'research-agent',{...f.authorize(runRequest),localResearchRequest:runRequest,requireSideEffectCapability:true}),rejectCode('episode_operation_active'));
    await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)),rejectCode('episode_operation_active'));
    assert.equal(f.writes,writes);
  } finally {release.resolve();}
  assert.equal((await first).commitStatus,'committed');
  const fresh=await f.requestFor('import',candidatePath);
  assert.equal((await f.service.executeLocalResearch(fresh,f.authorize(fresh))).idempotent,true);
});

test('expiry after successful import CAS returns a committed warning and fresh preview recovers once',async t=>{
  const f=await fixture(t);const initial=await f.requestFor();
  await f.service.executeLocalResearch(initial,f.authorize(initial));
  const candidatePath='outputs/post-commit-expiry.json';await mkdir(resolve(f.root,'outputs'));
  const batch={schemaVersion:1,batchId:'synthetic-post-commit-batch',episodeId:f.id,researchedAt:'2026-10-22T00:00:00Z',method:'Synthetic post commit expiry',sources:[],claims:[]};
  await writeFile(resolve(f.root,candidatePath),JSON.stringify(batch));
  const before=await f.readEpisode();const request=await f.requestFor('import',candidatePath);
  const writeEpisode=f.dependencies.writeEpisode;let publications=0;
  const publish=f.dependencies.publishResearchPackRevision;
  f.dependencies.publishResearchPackRevision=(...args)=>{publications++;return publish(...args);};
  f.dependencies.writeEpisode=async value=>{const result=await writeEpisode(value);f.expire();return result;};
  const eventCount=f.events.length;
  const result=await f.service.executeLocalResearch(request,f.authorize(request));
  assert.equal(result.commitStatus,'committed_with_warning');assert.equal(result.idempotent,false);
  assert.equal(result.publication.status,'pending');assert.equal(result.audit.status,'pending');
  assert.equal(result.publication.errorCode,'side_effect_capability_expired');assert.equal(result.audit.errorCode,'side_effect_capability_expired');
  const committed=await f.readEpisode();assert.equal(committed.research.version,before.research.version+1);
  assert.equal(committed.control.stateVersion,before.control.stateVersion+1);
  assert.equal(publications,0);assert.equal(f.events.length,eventCount);
  f.dependencies.writeEpisode=writeEpisode;
  const fresh=await f.requestFor('import',candidatePath);
  const recovered=await f.service.executeLocalResearch(fresh,f.authorize(fresh));
  assert.equal(recovered.commitStatus,'already_committed');assert.equal(recovered.idempotent,true);
  assert.equal(recovered.publication.status,'published');assert.equal(recovered.audit.status,'committed');
  const after=await f.readEpisode();assert.equal(after.control.stateVersion,committed.control.stateVersion);
  assert.equal(after.research.version,committed.research.version);assert.equal(after.approvals.research.status,'pending');
  assert.equal(publications,1);
});

test('direct research run cannot spend a valid local grant without a Kernel dispatch token',async t=>{
  const f=await fixture(t);const request=await f.requestFor();const episode=await f.readEpisode();
  const before=await readFile(f.path);let fetches=0;
  await assert.rejects(runEpisodeResearchAgent(episode,{...f.authorize(request),localResearchRequest:request,
    dependencies:f.dependencies,capabilityOperation:'worker:research-agent',requireSideEffectCapability:true,
    lookupImpl:async()=>[{address:'93.184.216.34',family:4}],
    fetchImpl:async()=>{fetches++;return new Response('<title>Synthetic forbidden direct request</title>',{headers:{'content-type':'text/html'}});}}),rejectCode('local_research_dispatch_required'));
  assert.equal(fetches,0);assert.equal(f.artifacts,0);assert.equal(f.writes,0);
  assert.deepEqual(await readFile(f.path),before);
});

test('direct same-ID research cannot replace approved primary source URLs under a valid grant',async t=>{
  const f=await fixture(t);const request=await f.requestFor();const changed=await f.readEpisode();
  changed.trendSelection.primarySources=[{label:'Unapproved synthetic source',url:'https://unapproved.example.org/replacement'}];
  const before=await readFile(f.path);let fetches=0;
  await assert.rejects(runEpisodeResearchAgent(changed,{...f.authorize(request),localResearchRequest:request,
    dependencies:f.dependencies,capabilityOperation:'worker:research-agent',requireSideEffectCapability:true,
    lookupImpl:async()=>[{address:'93.184.216.34',family:4}],
    fetchImpl:async()=>{fetches++;return new Response('<title>Synthetic unapproved source</title>',{headers:{'content-type':'text/html'}});}}),rejectCode('local_research_dispatch_required'));
  assert.equal(fetches,0);assert.equal(f.artifacts,0);assert.equal(f.writes,0);
  assert.deepEqual(await readFile(f.path),before);
});

test('changed research configuration after Kernel claim is rejected before fetch or artifact writes',async t=>{
  const f=await fixture(t),request=await f.requestFor();
  const changed=await readResearchConfig();changed.minimumSources++;
  f.dependencies.readResearchConfig=async()=>changed;
  await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)),rejectCode('local_research_snapshot_changed'));
  assert.equal(f.requests,0);assert.equal(f.artifacts,0);
});

test('research configuration changed during response rejects the first artifact write',async t=>{
  const f=await fixture(t),request=await f.requestFor();
  let current=await readResearchConfig();const changed={...current,minimumSources:current.minimumSources+1};
  f.dependencies.readResearchConfig=async()=>current;
  f.control.beforeFetch=async()=>{current=changed;};
  await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)),rejectCode('local_research_snapshot_changed'));
  assert.equal(f.requests,1);assert.equal(f.artifacts,0);
});

test('research config drift during DNS is checked before the actual HTTP request',async t=>{
  const f=await fixture(t),request=await f.requestFor();
  let current=await readResearchConfig();const changed={...current,minimumSources:current.minimumSources+1};
  f.dependencies.readResearchConfig=async()=>current;
  f.control.beforeLookup=async()=>{current=changed;};
  await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)),rejectCode('local_research_snapshot_changed'));
  assert.equal(f.requests,0);assert.equal(f.artifacts,0);
});

test('run rejects same-Episode pack tampering after Kernel claim before new URL inspection',async t=>{
  const f=await fixture(t),first=await f.requestFor();await f.service.executeLocalResearch(first,f.authorize(first));
  const request=await f.requestFor(),episode=await f.readEpisode(),packPath=resolve(f.root,episode.research.packPath);
  f.control.beforeWorker=async()=>{const pack=JSON.parse(await readFile(packPath,'utf8'));
    pack.sources.push({...pack.sources[0],id:'unbound-source',url:'https://example.net/unbound'});
    await writeFile(packPath,JSON.stringify(pack));};
  const requests=f.requests,artifacts=f.artifacts;
  await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)),rejectCode('local_research_evidence_changed'));
  assert.equal(f.requests,requests);assert.equal(f.artifacts,artifacts);
});

test('import sink revalidates registered pack bytes rather than trusting same Episode ID',async t=>{
  const f=await fixture(t),first=await f.requestFor();await f.service.executeLocalResearch(first,f.authorize(first));
  const candidatePath='outputs/import-pack-drift.json';await mkdir(resolve(f.root,'outputs'));
  const batch={schemaVersion:1,batchId:'synthetic-pack-drift',episodeId:f.id,researchedAt:'2026-10-22T00:00:00Z',sources:[],claims:[]};
  await writeFile(resolve(f.root,candidatePath),JSON.stringify(batch));
  const request=await f.requestFor('import',candidatePath),episode=await f.readEpisode(),packPath=resolve(f.root,episode.research.packPath);
  const pack=JSON.parse(await readFile(packPath,'utf8'));pack.sources.push({...pack.sources[0],id:'unbound-source',url:'https://example.net/unbound'});
  await writeFile(packPath,JSON.stringify(pack));const artifacts=f.artifacts,writes=f.writes;
  await assert.rejects(importResearchEvidenceBatch(batch,{...f.authorize(request),localResearchRequest:request,
    requireSideEffectCapability:true,dependencies:f.dependencies}),rejectCode('local_research_evidence_changed'));
  assert.equal(f.artifacts,artifacts);assert.equal(f.writes,writes);
});

test('review config cannot enable semantic review during a public response',async t=>{
  const f=await fixture(t),request=await f.requestFor();
  let current=await readReviewConfig();
  f.dependencies.readReviewConfig=async()=>current;
  f.control.beforeFetch=async()=>{current=structuredClone(current);current.stages.research.semanticReview=true;};
  await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)),rejectCode('local_research_paid_review_forbidden'));
  assert.equal(f.requests,1);assert.equal(f.artifacts,0);
  assert.equal((await f.readEpisode()).production.ai.requestCount,0);
});

test('pack drift after immutable import writes prevents Episode CAS and publication',async t=>{
  const f=await fixture(t),first=await f.requestFor();await f.service.executeLocalResearch(first,f.authorize(first));
  const candidatePath='outputs/import-final-pack-drift.json';await mkdir(resolve(f.root,'outputs'));
  const batch={schemaVersion:1,batchId:'synthetic-final-pack-drift',episodeId:f.id,researchedAt:'2026-10-22T00:00:00Z',sources:[],claims:[]};
  await writeFile(resolve(f.root,candidatePath),JSON.stringify(batch));
  const request=await f.requestFor('import',candidatePath),episode=await f.readEpisode();
  const packPath=resolve(f.root,episode.research.packPath),before=await readFile(f.path),writes=f.writes;
  const writeRevision=f.dependencies.writeResearchPackRevision;let publications=0;
  f.dependencies.publishResearchPackRevision=async()=>{publications++;};
  f.dependencies.writeResearchPackRevision=async value=>{
    const path=await writeRevision(value);
    await writeFile(packPath,`${await readFile(packPath,'utf8')}\n`);
    return path;
  };
  await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)),rejectCode('local_research_evidence_changed'));
  assert.equal(f.writes,writes);assert.equal(publications,0);assert.deepEqual(await readFile(f.path),before);
});

test('candidate drift after first immutable import write prevents later revision and CAS',async t=>{
  const f=await fixture(t),first=await f.requestFor();await f.service.executeLocalResearch(first,f.authorize(first));
  const candidatePath='outputs/import-final-candidate-drift.json';await mkdir(resolve(f.root,'outputs'));
  const batch={schemaVersion:1,batchId:'synthetic-final-candidate-drift',episodeId:f.id,researchedAt:'2026-10-22T00:00:00Z',sources:[],claims:[]};
  await writeFile(resolve(f.root,candidatePath),JSON.stringify(batch));
  const request=await f.requestFor('import',candidatePath),before=await readFile(f.path),writes=f.writes,artifacts=f.artifacts;
  const writeBatch=f.dependencies.writeResearchEvidenceBatch;
  f.dependencies.writeResearchEvidenceBatch=async value=>{
    const path=await writeBatch(value);await writeFile(resolve(f.root,candidatePath),`${JSON.stringify(batch)}\n`);return path;
  };
  await assert.rejects(f.service.executeLocalResearch(request,f.authorize(request)),rejectCode('local_research_candidate_changed'));
  assert.equal(f.writes,writes);assert.equal(f.artifacts,artifacts+1);assert.deepEqual(await readFile(f.path),before);
});
