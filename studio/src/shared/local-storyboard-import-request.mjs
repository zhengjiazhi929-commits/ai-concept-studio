import { canonicalJsonDocumentContentSha256 } from "./durable-json-store.mjs";

export const LOCAL_STORYBOARD_IMPORT_OPERATION = "storyboard:import-local";
const previewFields = ["episodeId", "candidatePath"];
const requestFields = [...previewFields, "candidateSha256", "snapshotHash", "actor", "reason", "confirmLocalStoryboardImport"];
const sha256 = /^[a-f0-9]{64}$/u;

function invalid() {
  return Object.assign(new Error("本地分镜入库请求必须包含准确绑定与显式人工声明"), {
    code: "local_storyboard_request_invalid", statusCode: 409
  });
}

function exact(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).length === fields.length && fields.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  });
}

function target(value) {
  return typeof value.episodeId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value.episodeId) &&
    typeof value.candidatePath === "string" && value.candidatePath.length <= 1024 &&
    !/[\\\p{Cc}?#]/u.test(value.candidatePath) && value.candidatePath.endsWith(".json") &&
    ["outputs/", "studio/data/production/inbox/"].some(prefix => value.candidatePath.startsWith(prefix)) &&
    value.candidatePath.split("/").every(part => part && part !== "." && part !== ".." && part.trim() === part);
}

export function validateLocalStoryboardPreview(value) {
  if (!exact(value, previewFields) || !target(value)) throw invalid();
  return structuredClone(value);
}

export function validateLocalStoryboardRequest(value) {
  if (!exact(value, requestFields) || !target(value) ||
    typeof value.candidateSha256 !== "string" || !sha256.test(value.candidateSha256) ||
    typeof value.snapshotHash !== "string" || !sha256.test(value.snapshotHash) ||
    typeof value.actor !== "string" || !/^human:[^\s\p{Cc}]{1,120}$/u.test(value.actor) ||
    typeof value.reason !== "string" || value.reason.trim() !== value.reason ||
    value.reason.length < 4 || value.reason.length > 1000 || /\p{Cc}/u.test(value.reason) ||
    value.confirmLocalStoryboardImport !== true) throw invalid();
  return structuredClone(value);
}

export function localStoryboardCapabilitySpec(value) {
  const hash = canonicalJsonDocumentContentSha256(validateLocalStoryboardRequest(value));
  return { episodeId: `local-storyboard/${hash}`, operation: LOCAL_STORYBOARD_IMPORT_OPERATION,
    scopes: ["state.write", "filesystem.write"], maxCalls: 0, maxCostUsd: 0 };
}
