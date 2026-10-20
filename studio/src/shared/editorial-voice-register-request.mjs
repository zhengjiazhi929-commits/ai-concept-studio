import {canonicalJsonDocumentContentSha256 as digest} from "./durable-json-store.mjs";

export const EDITORIAL_VOICE_REGISTER_OPERATION = "voice:register-editorial";
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const id = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/u.test(value);
const fields = ["episodeId", "candidatePath", "candidateSha256", "snapshotHash", "implementationHash",
  "actor", "reason", "confirmEditorialVoiceRegistration"];
function invalid() {
  return Object.assign(new Error("本地旁白登记必须绑定精确候选、当前快照与明确人工执行授权"), {
    code: "editorial_voice_request_invalid", statusCode: 409
  });
}
function closed(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [null, Object.prototype].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return d?.enumerable && Object.hasOwn(d, "value");
    });
}
function pathValid(value) {
  return typeof value === "string"
    && /^outputs\/studio\/[a-z0-9][a-z0-9-]{0,99}\/editorial-voice-candidates\/[a-f0-9]{64}\/voice-manifest\.json$/u.test(value);
}
export function validateEditorialVoiceRegisterPreview(value) {
  if (!closed(value, ["episodeId", "candidatePath"]) || !id(value.episodeId) || !pathValid(value.candidatePath)
    || !value.candidatePath.startsWith(`outputs/studio/${value.episodeId}/`)) throw invalid();
  return structuredClone(value);
}
export function validateEditorialVoiceRegisterRequest(value) {
  if (!closed(value, fields) || !id(value.episodeId) || !pathValid(value.candidatePath)
    || !value.candidatePath.startsWith(`outputs/studio/${value.episodeId}/`)
    || ![value.candidateSha256, value.snapshotHash, value.implementationHash].every(sha)
    || typeof value.actor !== "string" || !/^human:[^\s\p{Cc}]{1,120}$/u.test(value.actor)
    || typeof value.reason !== "string" || value.reason.trim() !== value.reason || value.reason.length < 4
    || value.reason.length > 1000 || /\p{Cc}/u.test(value.reason)
    || value.confirmEditorialVoiceRegistration !== true) throw invalid();
  return structuredClone(value);
}
export function editorialVoiceRegisterCapabilitySpec(value) {
  return {episodeId: `editorial-voice/${digest(validateEditorialVoiceRegisterRequest(value))}`,
    operation: EDITORIAL_VOICE_REGISTER_OPERATION, scopes: ["filesystem.write", "state.write"], maxCalls: 0, maxCostUsd: 0};
}
