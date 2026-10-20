import { canonicalJsonDocumentContentSha256 } from "./durable-json-store.mjs";

export const LOCAL_SCRIPT_IMPORT_OPERATION = "script:import-local";
const previewFields = ["episodeId", "candidatePath"];
const requestFields = [...previewFields, "candidateSha256", "snapshotHash", "actor", "reason", "confirmLocalScriptImport"];
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const sha256 = /^[a-f0-9]{64}$/u;

function invalidRequest() {
  return Object.assign(new Error("本地讲稿导入必须绑定准确的期数、候选文件、哈希、人工声明与显式确认"), {
    code: "local_script_request_invalid",
    statusCode: 409
  });
}

function hasExactFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable;
  });
}

function validCandidatePath(value) {
  if (typeof value !== "string" || value.length > 1024 || value.trim() !== value ||
    /[\\\p{Cc}?#]/u.test(value) || !value.endsWith(".json") ||
    !(value.startsWith("outputs/") || value.startsWith("studio/data/production/inbox/"))) return false;
  return value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && part.trim() === part);
}

function validTarget(value) {
  return typeof value.episodeId === "string" && identifier.test(value.episodeId) && validCandidatePath(value.candidatePath);
}

export function validateLocalScriptPreview(request) {
  if (!hasExactFields(request, previewFields) || !validTarget(request)) throw invalidRequest();
  return structuredClone(request);
}

export function validateLocalScriptRequest(request) {
  if (!hasExactFields(request, requestFields) || !validTarget(request) ||
    typeof request.candidateSha256 !== "string" || !sha256.test(request.candidateSha256) ||
    typeof request.snapshotHash !== "string" || !sha256.test(request.snapshotHash) ||
    typeof request.actor !== "string" || !/^human:[^\s\p{Cc}]{1,120}$/u.test(request.actor) ||
    typeof request.reason !== "string" || request.reason.trim() !== request.reason ||
    request.reason.length < 4 || request.reason.length > 1000 || /\p{Cc}/u.test(request.reason) ||
    request.confirmLocalScriptImport !== true) throw invalidRequest();
  return structuredClone(request);
}

export function localScriptCapabilitySpec(request) {
  const requestHash = canonicalJsonDocumentContentSha256(validateLocalScriptRequest(request));
  return {
    episodeId: `local-script/${requestHash}`,
    operation: LOCAL_SCRIPT_IMPORT_OPERATION,
    scopes: ["state.write", "filesystem.write"],
    maxCalls: 0,
    maxCostUsd: 0
  };
}
