import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {validateEditorialAvReviewInput,validateEditorialAvReviewRequest,editorialAvReviewCapabilitySpec,editorialAvReviewError}
  from '../src/server/production/editorial-av-review-core.mjs';
const flags=new Map([['--episode','episodeId'],['--plan','planPath'],['--plan-hash','planSha256'],['--snapshot','snapshotHash'],
  ['--source-hash','sourceHash'],['--implementation-hash','implementationHash'],['--actor','actor'],['--reason','reason']]);
export function parseEditorialReviewClipArguments(argv) {
  if(!Array.isArray(argv)||argv.some(value=>typeof value!=='string'))throw editorialAvReviewError();
  const args=[...argv];if(args[0]==='--')args.shift();const value={};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--confirm-local-review-clips') {
      if(Object.hasOwn(value,'confirmEditorialReviewClips'))throw editorialAvReviewError();
      value.confirmEditorialReviewClips=true;continue;
    }
    const key=flags.get(args[i]);const item=args[++i];
    if(!key||Object.hasOwn(value,key)||!item?.trim()||item.startsWith('-')||/\p{Cc}/u.test(item))throw editorialAvReviewError();
    value[key]=item;
  }
  return Object.keys(value).length===2?{mode:'preview',request:validateEditorialAvReviewInput(value)}:
    {mode:'render',request:validateEditorialAvReviewRequest(value)};
}
export async function runEditorialReviewClipCli(argv=process.argv.slice(2),dependencies={}) {
  if(!dependencies||typeof dependencies!=='object'||Array.isArray(dependencies)
    ||![null,Object.prototype].includes(Object.getPrototypeOf(dependencies))||Reflect.ownKeys(dependencies).some(key=>{
      const d=Object.getOwnPropertyDescriptor(dependencies,key);return !['preview','render'].includes(key)||!d.enumerable||!Object.hasOwn(d,'value')||typeof d.value!=='function';
    }))throw editorialAvReviewError();
  const parsed=parseEditorialReviewClipArguments(argv);
  if(parsed.mode==='preview') {
    const preview=dependencies.preview??(await import('../src/server/production/editorial-av-review.mjs')).previewEditorialReviewClips;
    return {ok:true,mode:'preview',preview:await preview(parsed.request)};
  }
  const authority=createCapabilityAuthority({secret:randomBytes(32).toString('hex'),defaultTtlMs:20*60*1000,
    maximumTtlMs:20*60*1000,maximumCalls:0,maximumCostUsd:0});
  const sideEffectGrant=authority.authorize(editorialAvReviewCapabilitySpec(parsed.request));
  const render=dependencies.render??(await import('../src/server/production/editorial-av-review.mjs')).renderEditorialReviewClips;
  return {ok:true,mode:'review_candidate',result:await render(parsed.request,Object.freeze({sideEffectGrant}))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runEditorialReviewClipCli(),null,2));}
  catch(error) {console.error(JSON.stringify({ok:false,code:error?.code??'editorial_av_review_failed',
    message:'审阅候选未确认完成；请检查输入及独立输出，不要盲目重跑或认为成片已通过。'}));process.exitCode=1;}
}
