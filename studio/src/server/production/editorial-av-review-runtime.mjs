// Pure PCM projection only. No filesystem, browser, subprocess or production sink exports.
import {inspectEditorialVoicePcm} from './editorial-voice-integrity.mjs';
import {editorialAvReviewNeed as need} from './editorial-av-review-core.mjs';
import {resolve,relative,extname} from 'node:path';
import {realpath} from 'node:fs/promises';
import {editorialMaterializationRegularFile as readRegular,editorialMaterializationSha as sha} from './editorial-materialization-integrity.mjs';

export function sliceEditorialReviewPcm(bytes,fromFrame,toFrameExclusive,measuredStartSample=fromFrame*800,minimumSpeechEndSample=null) {
  const pcm=inspectEditorialVoicePcm(bytes);const frameStartSample=fromFrame*800;
  need(Number.isSafeInteger(fromFrame)&&Number.isSafeInteger(toFrameExclusive)&&fromFrame>=0&&toFrameExclusive>fromFrame,
    'editorial_av_review_audio_range_invalid');
  need(Number.isSafeInteger(measuredStartSample)&&measuredStartSample>=0&&Math.abs(measuredStartSample-frameStartSample)<800,
    'editorial_av_review_audio_range_invalid');
  // A whole-scene visual boundary uses ceil to avoid a previous-scene flash.
  // Retain its first speech samples; at most one frame of audio leads the image.
  const startSample=Math.min(frameStartSample,measuredStartSample);
  const endSample=startSample+(toFrameExclusive-fromFrame)*800;
  const minimum=minimumSpeechEndSample??(toFrameExclusive*800>=pcm.sampleCount?pcm.sampleCount:0);
  need(Number.isSafeInteger(minimum)&&minimum>=0&&minimum<=pcm.sampleCount&&endSample>=minimum,
    'editorial_av_review_audio_speech_truncated');
  need(Number.isSafeInteger(startSample)&&startSample>=0&&Number.isSafeInteger(endSample)&&endSample>startSample
    &&endSample<=pcm.sampleCount+799,'editorial_av_review_audio_range_invalid');
  const output=Buffer.alloc(44+(endSample-startSample)*2);bytes.copy(output,0,0,44);
  output.writeUInt32LE(output.length-8,4);output.writeUInt32LE(output.length-44,40);
  bytes.copy(output,44,44+startSample*2,44+Math.min(endSample,pcm.sampleCount)*2);
  return {bytes:output,startSample,endSample,audioLeadSamples:frameStartSample-startSample,
    tailPaddingSamples:Math.max(0,endSample-pcm.sampleCount)};
}

// Read-only compiler discovery of the actual local ESM graph, including literal
// dynamic imports. Package implementations remain pinned by the locked install.
export async function inspectEditorialAvReviewImplementation(workspaceRoot) {
  const root=await realpath(workspaceRoot);const {build}=await import('esbuild');const records=new Map();
  const seeds=['studio/src/server/production/editorial-av-review.mjs','studio/scripts/render-editorial-review-clips.mjs'];
  const result=await build({absWorkingDir:root,entryPoints:seeds.map(path=>resolve(root,path)),bundle:true,write:false,
    metafile:true,packages:'external',platform:'node',format:'esm',outdir:resolve(root,'outputs','unused-av-inspection'),logLevel:'silent',
    plugins:[{name:'bound-read-only-review-graph',setup(builder){builder.onLoad({filter:/.*/},async({path})=>{
      const local=relative(root,path).replaceAll('\\','/');
      need(local.startsWith('studio/src/')||local.startsWith('studio/scripts/'),'editorial_av_review_source_path_invalid');
      const file=await readRegular(root,local);const old=records.get(local);
      need(!old||old.sha256===file.record.sha256,'editorial_av_review_source_changed');records.set(local,file.record);
      const loader={'.mjs':'js','.js':'js','.jsx':'jsx','.json':'json','.css':'css'}[extname(path)];need(loader);
      return {contents:file.bytes,loader,resolveDir:resolve(path,'..')};
    });}}]});
  need(result.warnings.length===0,'editorial_av_review_source_graph_incomplete');
  const paths=[...new Set([...records.keys(),'studio/package.json','studio/pnpm-lock.yaml','studio/pnpm-workspace.yaml','.node-version'])].sort();
  const files=[];
  for(const path of paths){const file=await readRegular(root,path);need(!records.has(path)||records.get(path).sha256===file.record.sha256,
    'editorial_av_review_source_changed');files.push(file.record);}
  return files;
}

// Freeze verified bytes before HTTP starts. Mutating a temp snapshot later must
// neither replace browser code nor change the bytes in flight during rendering.
export function createEditorialReviewResourceMap(files) {
  need(Array.isArray(files)&&files.length>0);const resources=new Map();
  for(const file of files) {
    need(file&&typeof file.path==='string'&&/^[A-Za-z0-9_./@-]+$/u.test(file.path)
      &&file.path.split('/').every(part=>part&&part!=='.'&&part!=='..')&&!resources.has(file.path)
      &&Buffer.isBuffer(file.content)&&file.content.length===file.bytes&&sha(file.content)===file.sha256,
    'editorial_av_review_snapshot_bytes_changed');resources.set(file.path,Buffer.from(file.content));
  }
  return path=>{const bytes=resources.get(path);return bytes?Buffer.from(bytes):null;};
}
