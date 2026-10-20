import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {validateEditorialFullReviewInput,validateEditorialFullReviewRequest,editorialFullReviewCapabilitySpec,editorialFullReviewError}
  from '../src/server/production/editorial-full-review-core.mjs';

const flags=new Map([['--episode','episodeId'],['--plan','planPath'],['--plan-hash','planSha256'],['--snapshot','snapshotHash'],
  ['--source-hash','sourceHash'],['--implementation-hash','implementationHash'],['--actor','actor'],['--reason','reason']]);
export function parseEditorialFullReviewArguments(argv) {
  if(!Array.isArray(argv)||Object.getPrototypeOf(argv)!==Array.prototype
    ||Reflect.ownKeys(argv).length!==argv.length+1)throw editorialFullReviewError();
  for(let index=0;index<argv.length;index++) {
    const d=Object.getOwnPropertyDescriptor(argv,String(index));
    if(!d?.enumerable||!Object.hasOwn(d,'value')||typeof d.value!=='string')throw editorialFullReviewError();
  }
  const args=[...argv];if(args[0]==='--')args.shift();const value={};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--confirm-local-full-review') {
      if(Object.hasOwn(value,'confirmEditorialFullReview'))throw editorialFullReviewError();
      value.confirmEditorialFullReview=true;continue;
    }
    const key=flags.get(args[i]),item=args[++i];
    if(!key||Object.hasOwn(value,key)||!item?.trim()||item.startsWith('-')||/\p{Cc}/u.test(item))throw editorialFullReviewError();
    value[key]=item;
  }
  return Object.keys(value).length===2?{mode:'preview',request:validateEditorialFullReviewInput(value)}:
    {mode:'render',request:validateEditorialFullReviewRequest(value)};
}
export async function runEditorialFullReviewCli(argv=process.argv.slice(2),dependencies={}) {
  if(!dependencies||typeof dependencies!=='object'||Array.isArray(dependencies)
    ||![null,Object.prototype].includes(Object.getPrototypeOf(dependencies))||Reflect.ownKeys(dependencies).some(key=>{
      const d=Object.getOwnPropertyDescriptor(dependencies,key);
      return !['preview','render'].includes(key)||!d.enumerable||!Object.hasOwn(d,'value')||typeof d.value!=='function';
    }))throw editorialFullReviewError();
  const parsed=parseEditorialFullReviewArguments(argv);
  if(parsed.mode==='preview') {
    const preview=dependencies.preview??(await import('../src/server/production/editorial-full-review.mjs')).previewEditorialFullReview;
    return {ok:true,mode:'preview',preview:await preview(parsed.request)};
  }
  // A single bounded local film can take hours. Authority remains in-memory,
  // private to this invocation, and cannot grant network/state/paid API access.
  const ttlMs=8*60*60*1000;
  const authority=createCapabilityAuthority({secret:randomBytes(32).toString('hex'),defaultTtlMs:ttlMs,
    maximumTtlMs:ttlMs,maximumCalls:0,maximumCostUsd:0});
  const sideEffectGrant=authority.authorize(editorialFullReviewCapabilitySpec(parsed.request));
  const render=dependencies.render??(await import('../src/server/production/editorial-full-review.mjs')).renderEditorialFullReview;
  return {ok:true,mode:'review_candidate',result:await render(parsed.request,Object.freeze({sideEffectGrant}))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runEditorialFullReviewCli(),null,2));}
  catch(error) {console.error(JSON.stringify({ok:false,code:error?.code??'editorial_full_review_failed',
    message:'完整私有审看版未确认完成；请检查冻结输入与独立输出，不要将机器结果视为人工验收或发布。'}));process.exitCode=1;}
}
