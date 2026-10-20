import {canonicalJsonDocumentContentSha256} from "./durable-json-store.mjs";

export const EDITORIAL_ASSETS_MATERIALIZE_OPERATION = "assets:materialize-editorial";
const fields = ["episodeId", "snapshotHash", "candidateHash", "machineReviewId", "implementationHash", "actor", "reason", "confirmEditorialAssetsMaterialization"];
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const invalid = () => Object.assign(new Error("本地素材物化必须绑定当前快照、批准候选、机器报告与实现"), {
  code: "editorial_materialization_request_invalid", statusCode: 409
});
function closed(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && [null, Object.prototype].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const d = Object.getOwnPropertyDescriptor(value, key);
      return d?.enumerable && Object.hasOwn(d, "value");
    });
}
const validId = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/u.test(value);
export function validateEditorialAssetsMaterializePreview(value) {
  if (!closed(value, ["episodeId"]) || !validId(value.episodeId)) throw invalid();
  return structuredClone(value);
}
export function validateEditorialAssetsMaterializeRequest(value) {
  if (!closed(value, fields) || !validId(value.episodeId)
    || ![value.snapshotHash, value.candidateHash, value.implementationHash].every(sha)
    || typeof value.machineReviewId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(value.machineReviewId)
    || typeof value.actor !== "string" || !/^human:[^\s\p{Cc}]{1,120}$/u.test(value.actor)
    || typeof value.reason !== "string" || value.reason.trim() !== value.reason
    || value.reason.length < 4 || value.reason.length > 1000 || /\p{Cc}/u.test(value.reason)
    || value.confirmEditorialAssetsMaterialization !== true) throw invalid();
  return structuredClone(value);
}
export function editorialAssetsMaterializeCapabilitySpec(value) {
  return {episodeId: `editorial-materialization/${canonicalJsonDocumentContentSha256(validateEditorialAssetsMaterializeRequest(value))}`,
    operation: EDITORIAL_ASSETS_MATERIALIZE_OPERATION, scopes: ["state.write", "filesystem.write"], maxCalls: 0, maxCostUsd: 0};
}
