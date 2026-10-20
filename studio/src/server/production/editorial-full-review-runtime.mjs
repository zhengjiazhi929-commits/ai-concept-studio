// Pure media/checkpoint validation and read-only implementation discovery. No raw sink.
import {resolve,relative,extname} from 'node:path';
import {realpath} from 'node:fs/promises';
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {editorialMaterializationRegularFile as readRegular} from './editorial-materialization-integrity.mjs';

const fail=()=>{throw Object.assign(new Error('整片审看媒体或恢复记录未通过完整性校验'),{code:'editorial_full_review_media_invalid'});};
const need=value=>{if(!value)fail();};
const mediaName=/^segment-\d{2}\.[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.mp4$/u;
export function fullReviewConcatList(names) {
  need(Array.isArray(names)&&names.length>0&&names.length<=40&&new Set(names).size===names.length);
  need(names.every(name=>typeof name==='string'&&mediaName.test(name)));
  return names.map(name=>`file '${name}'\n`).join('');
}
export function assertFullReviewMedia(info,totalFrames,{audio=false,signature}={}) {
  need(Number.isSafeInteger(totalFrames)&&totalFrames>0&&Array.isArray(info?.streams));
  const video=info.streams.filter(s=>s.codec_type==='video'),sound=info.streams.filter(s=>s.codec_type==='audio');
  need(info.streams.length===(audio?2:1)&&video.length===1&&sound.length===(audio?1:0));
  const v=video[0],seconds=totalFrames/30;
  need(v.codec_name==='h264'&&v.width===1920&&v.height===1080&&v.pix_fmt==='yuv420p'
    &&v.r_frame_rate==='30/1'&&v.avg_frame_rate==='30/1'&&Number(v.nb_read_frames)===totalFrames
    &&Math.abs(Number(v.start_time))<1e-6&&Math.abs(Number(v.duration)-seconds)<1/300
    &&/^SHA256:[a-f0-9]{64}$/iu.test(v.extradata_hash));
  const result=Object.fromEntries(['codec_name','profile','codec_tag_string','level','width','height','pix_fmt','r_frame_rate','time_base','extradata_hash'].map(key=>[key,v[key]]));
  need(Object.values(result).every(value=>value!==undefined));
  if(signature)need(digest(result)===digest(signature));
  if(audio){const a=sound[0];need(a.codec_name==='aac'&&a.sample_rate==='24000'&&a.channels===1
    &&Math.abs(Number(a.start_time))<1e-6&&Math.abs(Number(a.duration)-seconds)<0.05);}
  return result;
}
export function validateFullReviewCheckpoint(value,segment,requestHash) {
  need(value&&typeof value==='object'&&Object.keys(value).sort().join(',')===['schemaVersion','requestHash','segment','file','signature','fullDecodePassed'].sort().join(','));
  need(value.schemaVersion==='editorial-full-review-segment-v1'&&value.requestHash===requestHash
    &&digest(value.segment)===digest(segment)&&value.fullDecodePassed===true);
  const file=value.file;
  need(file&&typeof file.path==='string'&&mediaName.test(file.path)&&file.path.startsWith(`${segment.id}.`)
    &&Number.isSafeInteger(file.bytes)&&file.bytes>0&&/^[a-f0-9]{64}$/u.test(file.sha256));
  need(value.signature&&typeof value.signature==='object');
  return structuredClone(value);
}
export async function inspectEditorialFullReviewImplementation(workspaceRoot) {
  const root=await realpath(workspaceRoot),{build}=await import('esbuild'),records=new Map();
  const seeds=['studio/src/server/production/editorial-full-review.mjs','studio/scripts/render-editorial-full-review.mjs'];
  const result=await build({absWorkingDir:root,entryPoints:seeds.map(path=>resolve(root,path)),bundle:true,write:false,
    metafile:true,packages:'external',platform:'node',format:'esm',outdir:resolve(root,'outputs/unused-full-review-inspection'),logLevel:'silent',
    plugins:[{name:'read-only-full-review-graph',setup(builder){builder.onLoad({filter:/.*/},async({path})=>{
      const local=relative(root,path).replaceAll('\\','/');need(local.startsWith('studio/src/')||local.startsWith('studio/scripts/'));
      const file=await readRegular(root,local),old=records.get(local);need(!old||old.sha256===file.record.sha256);records.set(local,file.record);
      const loader={'.mjs':'js','.js':'js','.jsx':'jsx','.json':'json','.css':'css'}[extname(path)];need(loader);
      return {contents:file.bytes,loader,resolveDir:resolve(path,'..')};
    });}}]});
  need(result.warnings.length===0);
  for(const path of ['studio/package.json','studio/pnpm-lock.yaml','studio/pnpm-workspace.yaml','.node-version']){
    const file=await readRegular(root,path);records.set(path,file.record);
  }
  const files=[...records.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'));
  for(const item of files)need((await readRegular(root,item.path)).record.sha256===item.sha256);
  return files;
}
