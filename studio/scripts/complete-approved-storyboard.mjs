import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateApprovedStoryboardCompletionPreview,validateApprovedStoryboardCompletionRequest,approvedStoryboardCompletionCapabilitySpec} from '../src/shared/approved-storyboard-completion-request.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';

const flags=new Map([['--episode','episodeId'],['--artifact-version','artifactVersion'],['--artifact-hash','artifactHash'],['--review-report','reviewReportId'],['--snapshot','snapshotHash'],['--actor','actor'],['--reason','reason']]);
const cliError=code=>Object.assign(new Error('已批分镜本地流转参数无效'),{code});
export function parseApprovedStoryboardCompletionArguments(argv) {
  const invalid=()=>cliError('approved_storyboard_arguments_invalid');
  if(!Array.isArray(argv) || argv.some(value=>typeof value!=='string')) throw invalid();
  const args=[...argv];if(args[0]==='--') args.shift();const values={};
  for(let i=0;i<args.length;i+=1) {
    const flag=args[i];
    if(flag==='--confirm-approved-storyboard-completion') {
      if(Object.hasOwn(values,'confirmApprovedStoryboardCompletion')) throw invalid();
      values.confirmApprovedStoryboardCompletion=true;continue;
    }
    const key=flags.get(flag);if(!key || Object.hasOwn(values,key)) throw invalid();
    const value=args[++i];if(!value || !value.trim() || value.startsWith('-') || /\p{Cc}/u.test(value)) throw invalid();
    if(key==='artifactVersion' && !/^[1-9][0-9]*$/u.test(value)) throw invalid();
    values[key]=key==='artifactVersion'?Number(value):value;
  }
  if(!values.episodeId) throw invalid();
  if(Object.keys(values).length===1) return Object.freeze({mode:'preview',request:Object.freeze(validateApprovedStoryboardCompletionPreview(values))});
  if(!values.confirmApprovedStoryboardCompletion || [...flags.values()].some(key=>!Object.hasOwn(values,key))) throw invalid();
  return Object.freeze({mode:'complete',request:Object.freeze(validateApprovedStoryboardCompletionRequest(values))});
}
export async function runApprovedStoryboardCompletionCli(argv=process.argv.slice(2),dependencies={}) {
  if(!dependencies || typeof dependencies!=='object' || Array.isArray(dependencies) || ![null,Object.prototype].includes(Object.getPrototypeOf(dependencies)) ||
    Reflect.ownKeys(dependencies).some(key=>{
      const descriptor=Object.getOwnPropertyDescriptor(dependencies,key);
      return !['preview','complete'].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor,'value') || typeof descriptor.value!=='function';
    })) throw cliError('approved_storyboard_dependencies_invalid');
  const parsed=parseApprovedStoryboardCompletionArguments(argv);
  if(parsed.mode==='preview') {
    const preview=dependencies.preview??(await import('../src/server/production/approved-storyboard-completion.mjs')).previewApprovedStoryboardCompletion;
    return {ok:true,mode:'preview',preview:await preview(parsed.request)};
  }
  // Explicit OS-local declaration, not a remote login or a human Gate approval.
  const authority=createCapabilityAuthority({secret:randomBytes(32).toString('hex'),defaultTtlMs:300000,maximumTtlMs:300000,maximumCalls:0,maximumCostUsd:0});
  const sideEffectGrant=authority.authorize(approvedStoryboardCompletionCapabilitySpec(parsed.request));
  const complete=dependencies.complete??(await import('../src/server/production/approved-storyboard-completion.mjs')).completeApprovedStoryboard;
  return {ok:true,mode:'completed',result:await complete(parsed.request,Object.freeze({sideEffectGrant}))};
}
export async function reportApprovedStoryboardCompletionCli(run=()=>runApprovedStoryboardCompletionCli()) {
  try {console.log(JSON.stringify(await run(),null,2));}
  catch(error) {
    const codes=new Set(['approved_storyboard_arguments_invalid','approved_storyboard_dependencies_invalid','approved_storyboard_request_invalid','approved_storyboard_options_invalid',
      'approved_storyboard_episode_invalid','approved_storyboard_episode_busy','approved_storyboard_not_approved','approved_storyboard_review_changed','approved_storyboard_binding_invalid',
      'approved_storyboard_binding_changed','approved_storyboard_evidence_changed','approved_storyboard_upstream_incomplete','approved_storyboard_transition_invalid','approved_storyboard_quality_failed',
      'approved_storyboard_execution_changed','approved_storyboard_upstream_changed',
      'approved_storyboard_snapshot_changed','approved_storyboard_completion_conflict','approved_storyboard_capability_not_zero','approved_storyboard_sink_forbidden','side_effect_capability_missing','side_effect_capability_expired']);
    console.error(JSON.stringify({ok:false,code:codes.has(error?.code)?error.code:'approved_storyboard_cli_failed',message:'已批分镜流转未完成，请重新核对当前批准、证据文件与预览快照。'}));
    process.exitCode=1;
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await reportApprovedStoryboardCompletionCli();
