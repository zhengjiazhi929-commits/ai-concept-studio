import {canonicalJsonDocumentContentSha256 as digest} from "./durable-json-store.mjs";

export const EDITORIAL_VOICE_RETAKE_OPERATION = "voice:retake-editorial";
const inputKeys = ["episodeId", "baseCandidatePath", "baseCandidateSha256", "repairPlanPath", "repairPlanSha256"];
const keys = [...inputKeys, "snapshotHash", "implementationHash", "sourceHash", "actor", "reason", "confirmEditorialVoiceRetake"];
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const safeJson = value => typeof value === "string" && /^outputs\/[A-Za-z0-9_./-]+\.json$/u.test(value)
  && value.split("/").every(part => part && part !== "." && part !== "..");
function invalid() {return Object.assign(new Error("局部重合成必须绑定原候选、修复方案、当前来源及明确执行授权"), {
  code: "editorial_voice_retake_request_invalid", statusCode: 409
});}
function closed(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [null, Object.prototype].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === fields.length
    && fields.every(key => {const d = Object.getOwnPropertyDescriptor(value, key); return d?.enumerable && Object.hasOwn(d, "value");});
}
function validateInput(value) {
  if (typeof value.episodeId !== "string" || !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(value.episodeId)
    || !safeJson(value.baseCandidatePath)
    || !new RegExp(`^outputs/studio/${value.episodeId}/editorial-voice-candidates/[a-f0-9]{64}/voice-manifest\\.json$`, "u").test(value.baseCandidatePath)
    || !safeJson(value.repairPlanPath) || !sha(value.baseCandidateSha256) || !sha(value.repairPlanSha256)) throw invalid();
}
export function validateEditorialVoiceRetakePreview(value) {
  if (!closed(value, inputKeys)) throw invalid(); validateInput(value); return structuredClone(value);
}
export function validateEditorialVoiceRetakeRequest(value) {
  if (!closed(value, keys)) throw invalid(); validateInput(value);
  if (![value.snapshotHash, value.implementationHash, value.sourceHash].every(sha)
    || value.actor !== "human:Zhengjiazhi"
    || typeof value.reason !== "string" || value.reason.trim() !== value.reason || value.reason.length < 4
    || value.reason.length > 1000 || /\p{Cc}/u.test(value.reason) || value.confirmEditorialVoiceRetake !== true) throw invalid();
  return structuredClone(value);
}
export function editorialVoiceRetakeInput(value) {
  return validateEditorialVoiceRetakePreview(Object.fromEntries(inputKeys.map(key => [key, value[key]])));
}
export function editorialVoiceRetakeCapabilitySpec(value) {
  return {episodeId: `editorial-voice-retake/${digest(validateEditorialVoiceRetakeRequest(value))}`,
    operation: EDITORIAL_VOICE_RETAKE_OPERATION, scopes: ["filesystem.write", "local-inference"], maxCalls: 0, maxCostUsd: 0};
}
