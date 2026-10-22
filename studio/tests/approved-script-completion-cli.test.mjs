import test from 'node:test';
import assert from 'node:assert/strict';
import {parseApprovedScriptCompletionArguments,runApprovedScriptCompletionCli,reportApprovedScriptCompletionCli} from '../scripts/complete-approved-script.mjs';
import {validateApprovedScriptCompletionRequest,validateApprovedScriptCompletionPreview,approvedScriptCompletionCapabilitySpec} from '../src/shared/approved-script-completion-request.mjs';
import {requireSideEffectGrant,consumeSideEffectGrantUsage} from '../src/server/security/side-effect-capability.mjs';

const request={episodeId:'completion-fixture',artifactVersion:1,artifactHash:'a'.repeat(64),reviewReportId:'synthetic-report',snapshotHash:'b'.repeat(64),actor:'human:fixture',reason:'Complete the exact approved synthetic script',confirmApprovedScriptCompletion:true};
const args=(value=request)=>['--episode',value.episodeId,'--artifact-version',String(value.artifactVersion),'--artifact-hash',value.artifactHash,'--review-report',value.reviewReportId,'--snapshot',value.snapshotHash,'--actor',value.actor,'--reason',value.reason,'--confirm-approved-script-completion'];
const hasCode=code=>error=>error.code===code;

test('completion request is exact, cloned and rejects malformed data without evaluating accessors',()=>{
  assert.deepEqual(validateApprovedScriptCompletionRequest(request),request);
  assert.notEqual(validateApprovedScriptCompletionRequest(request),request);
  assert.deepEqual(validateApprovedScriptCompletionPreview({episodeId:request.episodeId}),{episodeId:request.episodeId});
  for(const change of [{episodeId:'../path'},{episodeId:'UPPER'},{artifactVersion:0},{artifactVersion:'1'},{artifactHash:'x'},{reviewReportId:''},{snapshotHash:'X'.repeat(64)},{actor:'agent:test'},{reason:'abc'},{confirmApprovedScriptCompletion:false},{provider:'injected'}]) {
    assert.throws(()=>validateApprovedScriptCompletionRequest({...request,...change}),hasCode('approved_script_request_invalid'));
  }
  for(const key of Object.keys(request)) {const value={...request};delete value[key];assert.throws(()=>validateApprovedScriptCompletionRequest(value));}
  const getter={...request};Object.defineProperty(getter,'actor',{get:()=>assert.fail('getter ran')});
  const hidden={...request};Object.defineProperty(hidden,'actor',{value:request.actor,enumerable:false});
  for(const value of [getter,hidden,Object.assign(Object.create({authority:true}),request),{...request,[Symbol('secret')]:true},null,[]]) assert.throws(()=>validateApprovedScriptCompletionRequest(value));
});

test('CLI defaults to read-only preview and requires every execution flag, no overrides',()=>{
  assert.deepEqual(parseApprovedScriptCompletionArguments(['--episode',request.episodeId]),{mode:'preview',request:{episodeId:request.episodeId}});
  assert.deepEqual(parseApprovedScriptCompletionArguments(['--',...args()]),{mode:'complete',request});
  for(const input of [[],['--episode'],args().slice(0,-1),[...args(),'--max-calls','0'],[...args(),'--episode','other'],[...args(),'--confirm-approved-script-completion'],args({...request,artifactVersion:1.5}),args({...request,artifactVersion:'01'}),args({...request,artifactVersion:'1e0'})]) {
    assert.throws(()=>parseApprovedScriptCompletionArguments(input));
  }
});

test('preview does not issue grants or call completion; invalid dependencies fail closed',async()=>{
  const result=await runApprovedScriptCompletionCli(['--episode',request.episodeId],{preview:async(...values)=>{assert.deepEqual(values,[{episodeId:request.episodeId}]);return {paidCalls:0};},complete:()=>assert.fail('cannot complete')});
  assert.equal(result.mode,'preview');
  for(const value of [{authorizeSideEffect:()=>assert.fail('cannot authorize')},Object.create({preview:()=>assert.fail('inherited')})]) await assert.rejects(runApprovedScriptCompletionCli([],value));
});

test('explicit completion grants only request-bound filesystem/state writes and zero paid usage',async()=>{
  const result=await runApprovedScriptCompletionCli(args(),{complete:async(received,options)=>{
    assert.deepEqual(received,request);assert.equal(Object.isFrozen(received),true);assert.equal(Object.isFrozen(options),true);
    const spec=approvedScriptCompletionCapabilitySpec(received);
    const grant=requireSideEffectGrant(options,spec,'script:complete-approved');
    assert.match(grant.episodeId,/^approved-script\/[a-f0-9]{64}$/u);
    assert.deepEqual([...grant.scopes].sort(),['filesystem.write','state.write']);assert.equal(grant.maxCalls,0);assert.equal(grant.maxCostUsd,0);
    assert.equal(Date.parse(grant.expiresAt)-Date.parse(grant.issuedAt),300000);
    assert.throws(()=>requireSideEffectGrant(options,spec,'model.call'),hasCode('approved_script_sink_forbidden'));
    assert.throws(()=>consumeSideEffectGrantUsage(grant,spec,{calls:1,costUsd:0}),hasCode('side_effect_capability_calls_exceeded'));
    assert.throws(()=>consumeSideEffectGrantUsage(grant,spec,{calls:0,costUsd:0.01}),hasCode('side_effect_capability_cost_exceeded'));
    assert.throws(()=>requireSideEffectGrant(options,approvedScriptCompletionCapabilitySpec({...request,actor:'human:other'}),'script:complete-approved'));
    return {status:'committed'};
  }});
  assert.deepEqual(result,{ok:true,mode:'completed',result:{status:'committed'}});
});

test('CLI error reporting redacts unknown raw failures',async()=>{
  const previousError=console.error;const previousExit=process.exitCode;const lines=[];
  try {console.error=value=>lines.push(value);await reportApprovedScriptCompletionCli(async()=>{throw new Error('secret synthetic credential');});assert.equal(process.exitCode,1);assert.doesNotMatch(lines.join(''),/credential/u);assert.match(lines.join(''),/approved_script_cli_failed/u);}
  finally {console.error=previousError;process.exitCode=previousExit;}
});
