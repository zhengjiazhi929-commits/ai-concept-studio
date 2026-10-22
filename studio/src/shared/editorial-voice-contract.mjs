import {canonicalJsonDocumentContentSha256 as digest} from "./durable-json-store.mjs";
import {validateEditorialVoiceRegisterRequest} from "./editorial-voice-register-request.mjs";

const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const fields = ["schemaVersion", "episodeId", "version", "operationId", "request", "candidateSha256", "bundlePath",
  "manifest", "audio", "captions", "timing", "source", "synthesis", "captionAligned", "alignmentMethod",
  "motionAligned", "renderReady", "externalApiCalls", "maximumPaidCostUsd", "registeredAt"];
function invalid() {
  return Object.assign(new Error("本地旁白收据、音频样本或字幕绑定不完整"), {code: "editorial_voice_receipt_invalid", statusCode: 409});
}
function closed(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [null, Object.prototype].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return d?.enumerable && Object.hasOwn(d, "value");
    });
}
function matchesClosed(value, expected) {
  if (expected !== null && typeof expected === "object") {
    const keys = Object.keys(expected);
    return closed(value, keys) && keys.every(key => matchesClosed(value[key], expected[key]));
  }
  return Object.is(value, expected);
}
function file(value, path, keys = ["path", "sha256", "bytes"]) {
  return closed(value, keys) && value.path === path && sha(value.sha256) && positive(value.bytes);
}
export function validateEditorialVoiceReceipt(receipt) {
  if (!closed(receipt, fields)) throw invalid();
  const request = validateEditorialVoiceRegisterRequest(receipt.request);
  const bundlePath = `studio/public/episodes/${request.episodeId}/editorial-voice/${request.candidateSha256}`;
  if (receipt.schemaVersion !== "editorial-voice-receipt-v1" || receipt.episodeId !== request.episodeId
    || receipt.version !== 1 || receipt.operationId !== digest(request) || receipt.candidateSha256 !== request.candidateSha256
    || receipt.bundlePath !== bundlePath || !file(receipt.manifest, `${bundlePath}/voice-manifest.json`)
    || receipt.manifest.sha256 !== request.candidateSha256
    || !file(receipt.audio, `${bundlePath}/media/voice.wav`, ["path", "publicPath", "sha256", "bytes", "totalSamples",
      "durationSeconds", "sampleRate", "channels", "bitsPerSample"])
    || receipt.audio.publicPath !== `${bundlePath.slice("studio/public/".length)}/media/voice.wav`
    || !positive(receipt.audio.totalSamples) || receipt.audio.sampleRate !== 24000
    || receipt.audio.channels !== 1 || receipt.audio.bitsPerSample !== 16
    || receipt.audio.durationSeconds !== receipt.audio.totalSamples / 24000
    || receipt.audio.bytes < 44 + receipt.audio.totalSamples * 2
    || !file(receipt.captions, `${bundlePath}/captions.json`, ["path", "sha256", "bytes", "count"])
    || !positive(receipt.captions.count) || !file(receipt.timing, `${bundlePath}/timing.json`)
    || !closed(receipt.source, ["scriptBindingHash", "storyboardBindingHash", "materializationManifestSha256"])
    || !Object.values(receipt.source).every(sha)
    || !closed(receipt.synthesis, ["voiceId", "speed", "modelSha256", "voiceSha256"])
    || receipt.synthesis.voiceId !== "zm_010" || receipt.synthesis.speed !== 1.1
    || !sha(receipt.synthesis.modelSha256) || !sha(receipt.synthesis.voiceSha256)
    || receipt.captionAligned !== true || receipt.alignmentMethod !== "synthesis-segment-sample-boundaries-v1"
    || receipt.motionAligned !== false || receipt.renderReady !== false
    || receipt.externalApiCalls !== 0 || receipt.maximumPaidCostUsd !== 0
    || typeof receipt.registeredAt !== "string" || !Number.isFinite(Date.parse(receipt.registeredAt))
    || new Date(receipt.registeredAt).toISOString() !== receipt.registeredAt) throw invalid();
  return structuredClone(receipt);
}

export function buildEditorialVoiceRecord(input) {
  const receipt = validateEditorialVoiceReceipt(input);
  const {audio} = receipt;
  return {status: "ready", version: receipt.version, mode: "editorial-local-tts", audioPath: audio.path,
    publicPath: audio.publicPath, bytes: audio.bytes, sha256: audio.sha256, durationSeconds: audio.durationSeconds,
    sampleRate: audio.sampleRate, channels: audio.channels, bitsPerSample: audio.bitsPerSample,
    registeredAt: receipt.registeredAt, needsRevision: false,
    note: "本地完整旁白及短句样本边界字幕已登记；尚未声音验收、动画校时或视频渲染",
    provenance: {schemaVersion: "editorial-local-tts-provenance-v1", receiptSha256: digest(receipt),
      candidateSha256: receipt.candidateSha256, manifest: structuredClone(receipt.manifest),
      source: structuredClone(receipt.source), synthesis: structuredClone(receipt.synthesis),
      externalApiCalls: 0, maximumPaidCostUsd: 0},
    verification: {schemaVersion: "editorial-local-tts-verification-v1", status: "technical-only",
      captionAligned: true, alignmentMethod: receipt.alignmentMethod, motionAligned: false,
      renderReady: false, humanVoiceAccepted: false},
    authorization: {schemaVersion: "editorial-local-tts-execution-authorization-v1",
      actor: receipt.request.actor, reason: receipt.request.reason, requestSha256: receipt.operationId,
      scope: "generation-and-registration-only", assetsVoiceAccepted: false},
    rights: {schemaVersion: 1, authorOrSource: "Local offline TTS zm_010; model and voice bytes bound in voice-manifest.json",
      sourceUrl: null, acquiredAt: receipt.registeredAt, license: "Full model and voice license clearance not independently audited; not approved for public release",
      allowedUse: "private-internal-review", attributionRequirements: "Preserve model and voice license evidence",
      privacyPortraitStatus: "synthetic-voice-no-person-identity-claim", verifiedBy: "machine:editorial-voice-registration-v1"}};
}

// Pure binding checks are not file verification or human acceptance. Notes and
// revision flags may evolve in the workflow; all media/provenance fields may not.
export function editorialVoiceRegistrationValid(episode, input = episode?.production?.editorialVoice) {
  try {
    const receipt = validateEditorialVoiceReceipt(input);
    if (episode?.id !== receipt.episodeId || !episode.voice || typeof episode.voice.note !== "string"
      || typeof episode.voice.needsRevision !== "boolean"
      || episode.production?.editorialMaterialization?.manifestSha256 !== receipt.source.materializationManifestSha256) return false;
    const expected = buildEditorialVoiceRecord(receipt);
    expected.note = episode.voice.note; expected.needsRevision = episode.voice.needsRevision;
    return matchesClosed(episode.voice, expected)
      && matchesClosed(episode.production.editorialVoice, receipt);
  } catch { return false; }
}
