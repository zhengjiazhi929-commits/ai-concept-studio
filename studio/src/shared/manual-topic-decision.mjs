import { canonicalJsonDocumentContentSha256 } from "./durable-json-store.mjs";

export const MANUAL_TOPIC_OPERATION = "trend:manual-select";
const fields = ["candidateId", "runId", "snapshotHash", "actor", "reason", "confirmManualSelection"];
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u;

export function manualTopicError(code, message) {
  return Object.assign(new Error(message), {code, statusCode: 409});
}

export function validateManualTopicRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request) ||
    Object.keys(request).length !== fields.length || fields.some((field) => !Object.hasOwn(request, field)) ||
    typeof request.candidateId !== "string" || !identifier.test(request.candidateId) ||
    typeof request.runId !== "string" || !identifier.test(request.runId) ||
    typeof request.snapshotHash !== "string" || !/^[a-f0-9]{64}$/u.test(request.snapshotHash) ||
    typeof request.actor !== "string" || !/^human:[^\s\u0000-\u001f\u007f]{1,120}$/u.test(request.actor) ||
    typeof request.reason !== "string" || request.reason.trim() !== request.reason ||
    request.reason.length < 4 || request.reason.length > 1000 || /[\u0000-\u001f\u007f]/u.test(request.reason) ||
    request.confirmManualSelection !== true) {
    throw manualTopicError("manual_topic_request_invalid", "人工指定必须提供准确的候选、运行、快照、人工声明、理由与显式确认");
  }
  return structuredClone(request);
}

export function manualTopicDecisionId(request) {
  return canonicalJsonDocumentContentSha256(validateManualTopicRequest(request));
}

export function manualTopicCapabilitySpec(request) {
  return {
    episodeId: `manual-topic/${manualTopicDecisionId(request)}`,
    operation: MANUAL_TOPIC_OPERATION,
    scopes: ["state.write", "filesystem.write"],
    maxCalls: 0,
    maxCostUsd: 0
  };
}
