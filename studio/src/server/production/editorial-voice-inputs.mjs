import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {LOCAL_TTS_MODEL,LOCAL_TTS_VOICES} from '../../video/agent-skill-local-tts-plan.mjs';
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function requireValue(value) {if(!value) throw Object.assign(new Error('本地旁白锁定输入不匹配'),{code:'editorial_voice_pinned_input_changed'});}
export async function editorialVoicePin(path) {
  const resolved=await realpath(path);const info=await stat(path);requireValue(info.isFile());
  return {path,realPath:resolved,bytes:info.size,sha256:sha(await readFile(path))};
}
export async function verifyEditorialVoiceInputs(workspaceRoot,driver) {
  requireValue(digest(Object.keys(driver).sort())===digest(['plan','model','pinnedFiles','runtimeLock'].sort()));
  requireValue(digest(driver.model)===digest(LOCAL_TTS_MODEL));
  const pins=driver.pinnedFiles;
  const exact=['model','config','voice','python','generator','runtimeLock','englishLexicon','zhFrontend','kokoroPipeline','driver'];
  requireValue(digest(Object.keys(pins).sort())===digest(exact.sort()));
  const workspacePaths={generator:'studio/scripts/generate-agent-skill-local-tts.py',
    driver:'studio/scripts/generate-editorial-local-voice.py',runtimeLock:'studio/config/local-tts-python-runtime.lock.json'};
  for(const [key,path] of Object.entries(workspacePaths)) requireValue(pins[key].path===resolve(workspaceRoot,path));
  const lock=JSON.parse(await readFile(resolve(workspaceRoot,workspacePaths.runtimeLock),'utf8'));
  requireValue(digest(driver.runtimeLock)===digest(lock));
  const hashes={model:LOCAL_TTS_MODEL.sha256,config:LOCAL_TTS_MODEL.configSha256,
    voice:LOCAL_TTS_VOICES.find(item=>item.id==='zm_010').sha256,python:lock.executableSha256,
    englishLexicon:'dc414872a49a28ae6c141463d502fd945f3b2fde040484fdc47d00cc4612686f',
    zhFrontend:'97d16aec581832845d2566cb24da2ba045d4552fb65a5017a6eac8feef654c81',
    kokoroPipeline:'499982bbc23a1019681cdb4c327c1d911e7034e240721b95686ff1a8f15c2a9a'};
  for(const [key,pin] of Object.entries(pins)) {
    requireValue(typeof pin.path==='string' && pin.path.startsWith('/'));
    requireValue(digest(pin)===digest(await editorialVoicePin(pin.path)) && (!hashes[key] || pin.sha256===hashes[key]));
  }
  return true;
}
