import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {workspaceRoot} from '../src/shared/paths.mjs';
import {readEpisode} from '../src/shared/store.mjs';
import {readReviewConfig} from '../src/server/reviews/coordinator.mjs';
import {createCapabilityAuthority} from '../src/server/security/side-effect-capability.mjs';
import {previewEditorialVoiceGeneration,generateEditorialVoiceCandidate,editorialVoiceGenerationCapabilitySpec}
  from '../src/server/production/editorial-voice-generation.mjs';

export function parseEditorialVoiceGenerationArguments(argv) {
  if(!Array.isArray(argv)||argv.some(value=>typeof value!=='string'))throw new Error('Invalid arguments');
  const flags=new Map([['--episode','episodeId'],['--audition-request','auditionRequestPath'],['--selection','selectionPath'],
    ['--request-hash','requestHash']]);const value={};
  for(let index=0;index<argv.length;index++) {
    const flag=argv[index];
    if(flag==='--confirm-local-full-voice') {if(value.confirm)throw new Error('Duplicate confirmation');value.confirm=true;continue;}
    const key=flags.get(flag),argument=argv[++index];
    if(!key||Object.hasOwn(value,key)||!argument||argument.startsWith('-')||/\p{Cc}/u.test(argument))throw new Error('Invalid arguments');
    value[key]=argument;
  }
  if(!/^[a-z0-9][a-z0-9-]{0,99}$/u.test(value.episodeId??'') || !value.auditionRequestPath || !value.selectionPath
    || Boolean(value.confirm)!==Boolean(value.requestHash) || value.requestHash&&!/^[a-f0-9]{64}$/u.test(value.requestHash))throw new Error('Incomplete arguments');
  for(const key of ['auditionRequestPath','selectionPath']) {
    if(!/^outputs\/[A-Za-z0-9_./-]+\.json$/u.test(value[key])
      || value[key].split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Unsafe input path');
  }
  return value;
}
export async function runEditorialVoiceGenerationCli(argv=process.argv.slice(2)) {
  const parsed=parseEditorialVoiceGenerationArguments(argv);
  const input={episodeId:parsed.episodeId,auditionRequestPath:parsed.auditionRequestPath,selectionPath:parsed.selectionPath};
  const readCurrent=async()=>({episode:await readEpisode(input.episodeId),reviewConfig:await readReviewConfig()});
  const preview=await previewEditorialVoiceGeneration({workspaceRoot,...await readCurrent(),input});
  if(!parsed.confirm)return {mode:'preview',episodeId:input.episodeId,generationRequestHash:preview.generationRequestHash,
    source:preview.source,implementationHash:preview.implementationHash,voiceId:preview.request.plan.voiceId,
    speed:preview.request.plan.speed,segmentCount:preview.request.plan.segments.length,directory:preview.directory,paidCalls:0,rendered:false};
  if(parsed.requestHash!==preview.generationRequestHash)throw new Error('Generation preview changed');
  const authority=createCapabilityAuthority({secret:randomBytes(32).toString('hex'),defaultTtlMs:2100000,maximumTtlMs:2100000,
    maximumCalls:0,maximumCostUsd:0});
  const sideEffectGrant=authority.authorize(editorialVoiceGenerationCapabilitySpec(preview));
  return {mode:'candidate',...await generateEditorialVoiceCandidate({workspaceRoot,preview,sideEffectGrant,readCurrent,
    onProgress:line=>process.stderr.write(line)})};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{console.log(JSON.stringify(await runEditorialVoiceGenerationCli(),null,2));}
  catch(error){console.error(JSON.stringify({ok:false,code:error.code??'editorial_voice_generation_failed',
    message:'完整旁白候选未确认完成；保留现有文件，核对来源和日志，勿覆盖重试。'}));process.exitCode=1;}
}
