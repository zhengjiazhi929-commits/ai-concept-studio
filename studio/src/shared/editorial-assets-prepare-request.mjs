import {canonicalJsonDocumentContentSha256} from "./durable-json-store.mjs";

export const EDITORIAL_ASSETS_PREPARE_OPERATION = "assets:prepare-editorial";
const fields = ["episodeId", "snapshotHash", "planHash", "implementationHash", "actor", "reason", "confirmEditorialAssetsPreparation"];
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const invalid = () => Object.assign(new Error("编辑素材准备必须绑定当前快照、方案、实现与显式确认"), {
  code: "editorial_assets_request_invalid", statusCode: 409
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
export function validateEditorialAssetsPreparePreview(value) {
  if (!closed(value, ["episodeId"]) || !validId(value.episodeId)) throw invalid();
  return structuredClone(value);
}
export function validateEditorialAssetsPrepareRequest(value) {
  if (!closed(value, fields) || !validId(value.episodeId)
    || ![value.snapshotHash, value.planHash, value.implementationHash].every(sha)
    || typeof value.actor !== "string" || !/^human:[^\s\p{Cc}]{1,120}$/u.test(value.actor)
    || typeof value.reason !== "string" || value.reason.trim() !== value.reason
    || value.reason.length < 4 || value.reason.length > 1000 || /\p{Cc}/u.test(value.reason)
    || value.confirmEditorialAssetsPreparation !== true) throw invalid();
  return structuredClone(value);
}
export function editorialAssetsPrepareCapabilitySpec(value) {
  return {episodeId: `editorial-assets/${canonicalJsonDocumentContentSha256(validateEditorialAssetsPrepareRequest(value))}`,
    operation: EDITORIAL_ASSETS_PREPARE_OPERATION, scopes: ["state.write", "filesystem.write"], maxCalls: 0, maxCostUsd: 0};
}
