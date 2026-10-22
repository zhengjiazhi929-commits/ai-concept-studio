import {constants} from 'node:fs';
import {open, realpath, lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {assertDurableStorePath} from '../../shared/durable-json-store.mjs';
import {productionProfileForEpisode} from '../../shared/production-profiles.mjs';

export function localScriptError(code, message = '本地讲稿不符合当前入库绑定，请重新预览') {
  return Object.assign(new Error(message), {code, statusCode:409});
}

function requireValue(condition, code = 'local_script_candidate_invalid') {
  if (!condition) throw localScriptError(code);
}
function closed(value, fields) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value,key)));
}
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 20000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

// Reads only bounded JSON under a canonical workspace path; no executable code,
// symlink hops, devices, network paths or unlimited readFile buffers.
export async function readLocalScriptJson(root, path, allowedPrefixes, maximumBytes=1024*1024) {
  requireValue(typeof path === 'string' && !/[\\\u0000-\u001f]/u.test(path) &&
    path.split('/').every(part => part && part !== '.' && part !== '..') &&
    allowedPrefixes.some(prefix => path.startsWith(prefix)) && path.endsWith('.json'), 'local_script_path_invalid');
  const destination = resolve(root,path);
  await assertDurableStorePath(root,destination);
  const handle = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    requireValue(before.isFile() && before.size > 0 && before.size <= maximumBytes, 'local_script_file_invalid');
    const buffer=Buffer.alloc(before.size+1);
    let count=0;
    while(count < buffer.length) {
      const read=await handle.read(buffer,count,buffer.length-count,null);
      if(!read.bytesRead) break;
      count+=read.bytesRead;
    }
    const after=await handle.stat();
    await assertDurableStorePath(root,destination);
    const pathState=await lstat(destination);
    requireValue(count===before.size && before.size===after.size && before.mtimeMs===after.mtimeMs && before.ctimeMs===after.ctimeMs &&
      pathState.isFile() && !pathState.isSymbolicLink() && pathState.dev===after.dev && pathState.ino===after.ino &&
      await realpath(destination)===resolve(await realpath(root),path), 'local_script_file_changed');
    const body=buffer.subarray(0,count);
    let value;
    try {value=JSON.parse(body.toString('utf8'));} catch {throw localScriptError('local_script_json_invalid');}
    return {value,bytes:count,sha256:createHash('sha256').update(body).digest('hex')};
  } finally {await handle.close();}
}

export function validateLocalScriptCandidate(candidate, episode, pack) {
  closed(candidate,['schemaVersion','kind','episodeId','candidateVersion','author','status','humanApproved','sourceResearch','chapterMapping','content']);
  requireValue(candidate.schemaVersion===1 && candidate.kind==='codex-authored-script-candidate-v1' &&
    candidate.episodeId===episode.id && Number.isSafeInteger(candidate.candidateVersion) && candidate.candidateVersion>0 &&
    candidate.author==='Codex' && candidate.status==='local-editorial-draft' && candidate.humanApproved===false);
  const source=candidate.sourceResearch;
  closed(source,['artifactVersion','artifactHash','reviewReportId','packPath','packSha256','editorialBatchPath','editorialBatchSha256']);
  requireValue(Number.isSafeInteger(source.artifactVersion) && source.artifactVersion>0 && sha(source.artifactHash) &&
    sha(source.packSha256) && sha(source.editorialBatchSha256) && text(source.reviewReportId));
  const content=candidate.content;
  closed(content,['title','thesis','targetDurationSeconds','hook','sections','closing','factCheckNotes']);
  const profile=productionProfileForEpisode(episode);
  requireValue(['title','thesis','hook','closing'].every(key=>text(content[key])) &&
    Number.isSafeInteger(content.targetDurationSeconds) && content.targetDurationSeconds>=profile.targetDurationSeconds.minimum &&
    content.targetDurationSeconds<=profile.targetDurationSeconds.maximum && Array.isArray(content.sections) &&
    content.sections.length>=profile.scriptSections.minimum && content.sections.length<=profile.scriptSections.maximum &&
    Array.isArray(content.factCheckNotes) && content.factCheckNotes.length>0 && content.factCheckNotes.every(text));
  const claims=new Set((pack.claims??[]).filter(claim=>claim.support==='supported').map(claim=>claim.id));
  const ids=new Set();
  for(const section of content.sections) {
    closed(section,['id','heading','purpose','narration','evidenceRefs','visualDirection']);
    requireValue(['id','heading','purpose','narration','visualDirection'].every(key=>text(section[key])) &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(section.id) && !ids.has(section.id));
    ids.add(section.id);
    requireValue(Array.isArray(section.evidenceRefs) && section.evidenceRefs.length>0 &&
      new Set(section.evidenceRefs).size===section.evidenceRefs.length && section.evidenceRefs.every(ref=>claims.has(ref)), 'local_script_evidence_invalid');
  }
  requireValue(Array.isArray(candidate.chapterMapping) && candidate.chapterMapping.length===ids.size);
  const mapped=new Set();
  for(const item of candidate.chapterMapping) {
    closed(item,['sectionId','chapter']);
    requireValue(ids.has(item.sectionId) && !mapped.has(item.sectionId) && text(item.chapter));
    mapped.add(item.sectionId);
  }
  return candidate;
}
