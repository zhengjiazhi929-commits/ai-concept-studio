import {
  createLocalOfflineVoiceService
} from "./local-offline-voice-core.mjs";

export {
  LOCAL_OFFLINE_TTS_REBIND_INSPECTION,
  LOCAL_OFFLINE_TTS_V002_REGISTRATION,
  assertNoSymlinkRegularFile,
  inspectPcmWav
} from "./local-offline-voice-core.mjs";

const productionLocalOfflineVoice = createLocalOfflineVoiceService();

export function inspectLocalOfflineTtsCandidate(episodeId, options = {}) {
  return productionLocalOfflineVoice.inspectLocalOfflineTtsCandidate(
    episodeId,
    options
  );
}

export function inspectRegisteredLocalOfflineTtsRebindCandidate(
  episodeId,
  options = {}
) {
  return productionLocalOfflineVoice.inspectRegisteredLocalOfflineTtsRebindCandidate(
    episodeId,
    options
  );
}

export function verifyRegisteredLocalOfflineVoiceForAssets(episode, options = {}) {
  return productionLocalOfflineVoice.verifyRegisteredLocalOfflineVoiceForAssets(
    episode,
    options
  );
}

export function registerApprovedLocalOfflineTts(episodeId, input, options = {}) {
  return productionLocalOfflineVoice.registerApprovedLocalOfflineTts(
    episodeId,
    input,
    options
  );
}
