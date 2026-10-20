import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateApprovedScriptCompletionPreview,validateApprovedScriptCompletionRequest,approvedScriptCompletionCapabilitySpec} from '../src/shared/approved-script-completion-request.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';

const flags=new Map([['--episode','episodeId'],['--artifact-version','artifactVersion'],['--artifact-hash','artifactHash'],['--review-report','reviewReportId'],['--snapshot','snapshotHash'],['--actor','actor'],['--reason','reason']]);
const cliError=code=>Object.assign(new Error('已批讲稿本地流转参数无效'),{code});
export function parseApprovedScriptCompletionArguments(argv) {
  const invalid=()=>cliError('approved_script_arguments_invalid');
  if(!Array.isArray(argv) || argv.some(value=>typeof value!=='string')) throw invalid();
  const args=[...argv];if(args[0]==='--') args.shift();const values={};
  for(let i=0;i<args.length;i+=1) {
    const flag=args[i];
    if(flag==='--confirm-approved-script-completion') {
      if(Object.hasOwn(values,'confirmApprovedScriptCompletion')) throw invalid();
      values.confirmApprovedScriptCompletion=true;continue;
    }
    const key=flags.get(flag);if(!key || Object.hasOwn(values,key)) throw invalid();
    const value=args[++i];if(!value || !value.trim() || value.startsWith('-') || /\p{Cc}/u.test(value)) throw invalid();
    if(key==='artifactVersion' && !/^[1-9][0-9]*$/u.test(value)) throw invalid();
    values[key]=key==='artifactVersion'?Number(value):value;
  }
  if(!values.episodeId) throw invalid();
  if(Object.keys(values).length===1) return Object.freeze({mode:'preview',request:Object.freeze(validateApprovedScriptCompletionPreview(values))});
  if(!values.confirmApprovedScriptCompletion || [...flags.values()].some(key=>!Object.hasOwn(values,key))) throw invalid();
  return Object.freeze({mode:'complete',request:Object.freeze(validateApprovedScriptCompletionRequest(values))});
}
export async function runApprovedScriptCompletionCli(argv=process.argv.slice(2),dependencies={}) {
  if(!dependencies || typeof dependencies!=='object' || Array.isArray(dependencies) || ![null,Object.prototype].includes(Object.getPrototypeOf(dependencies)) ||
    Reflect.ownKeys(dependencies).some(key=>{
      const descriptor=Object.getOwnPropertyDescriptor(dependencies,key);
      return !['preview','complete'].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor,'value') || typeof descriptor.value!=='function';
    })) throw cliError('approved_script_dependencies_invalid');
  const parsed=parseApprovedScriptCompletionArguments(argv);
  if(parsed.mode==='preview') {
    const preview=dependencies.preview??(await import('../src/server/production/approved-script-completion.mjs')).previewApprovedScriptCompletion;
    return {ok:true,mode:'preview',preview:await preview(parsed.request)};
  }
  // Explicit OS-local declaration, not a remote login or a human Gate approval.
  const authority=createCapabilityAuthority({secret:randomBytes(32).toString('hex'),defaultTtlMs:300000,maximumTtlMs:300000,maximumCalls:0,maximumCostUsd:0});
  const sideEffectGrant=authority.authorize(approvedScriptCompletionCapabilitySpec(parsed.request));
  const complete=dependencies.complete??(await import('../src/server/production/approved-script-completion.mjs')).completeApprovedScript;
  return {ok:true,mode:'completed',result:await complete(parsed.request,Object.freeze({sideEffectGrant}))};
}
export async function reportApprovedScriptCompletionCli(run=()=>runApprovedScriptCompletionCli()) {
  try {console.log(JSON.stringify(await run(),null,2));}
  catch(error) {
    const codes=new Set(['approved_script_arguments_invalid','approved_script_dependencies_invalid','approved_script_request_invalid','approved_script_options_invalid',
      'approved_script_episode_invalid','approved_script_episode_busy','approved_script_not_approved','approved_script_review_changed','approved_script_binding_invalid',
      'approved_script_binding_changed','approved_script_evidence_changed','approved_script_source_unregistered','approved_script_transition_invalid','approved_script_quality_failed',
      'approved_script_snapshot_changed','approved_script_completion_conflict','approved_script_capability_not_zero','approved_script_sink_forbidden','side_effect_capability_missing','side_effect_capability_expired']);
    console.error(JSON.stringify({ok:false,code:codes.has(error?.code)?error.code:'approved_script_cli_failed',message:'已批讲稿流转未完成，请重新核对当前批准、证据文件与预览快照。'}));
    process.exitCode=1;
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await reportApprovedScriptCompletionCli();
