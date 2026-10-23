import { canonicalJsonDocumentContentSha256 } from "./durable-json-store.mjs";

const previewFields = ["episodeId", "action", "candidatePath"];
const requestFields = [
  ...previewFields,
  "researchVersion",
  "snapshotHash",
  "candidateSha256",
  "batchId",
  "actor",
  "reason",
  "confirmLocalResearch"
];
const identifier = /^[a-z0-9][a-z0-9-]{0,99}$/u;
const sha256 = /^[a-f0-9]{64}$/u;

export function localResearchError(code, message = "本地研究请求或当前研究状态无效") {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

function invalidRequest() {
  return localResearchError("local_research_request_invalid");
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
    !(value.startsWith("outputs/") || value.startsWith("studio/data/research/inbox/"))) return false;
  return value.split("/").every((part) =>
    part.length > 0 && part !== "." && part !== ".." && part.trim() === part);
}

function validTarget(value) {
  return typeof value.episodeId === "string" && identifier.test(value.episodeId) &&
    ((value.action === "run" && value.candidatePath === null) ||
      (value.action === "import" && validCandidatePath(value.candidatePath)));
}

export function validateLocalResearchPreview(input) {
  if (!hasExactFields(input, previewFields) || !validTarget(input)) throw invalidRequest();
  return structuredClone(input);
}

export function validateLocalResearchRequest(input) {
  if (!hasExactFields(input, requestFields) || !validTarget(input) ||
    !Number.isSafeInteger(input.researchVersion) || input.researchVersion < 0 ||
    typeof input.snapshotHash !== "string" || !sha256.test(input.snapshotHash) ||
    typeof input.actor !== "string" || !/^human:[^\s\p{Cc}]{1,120}$/u.test(input.actor) ||
    typeof input.reason !== "string" || input.reason.trim() !== input.reason ||
    input.reason.length < 4 || input.reason.length > 1000 || /\p{Cc}/u.test(input.reason) ||
    input.confirmLocalResearch !== true) throw invalidRequest();
  if (input.action === "run") {
    if (input.candidateSha256 !== null || input.batchId !== null) throw invalidRequest();
  } else if (typeof input.candidateSha256 !== "string" || !sha256.test(input.candidateSha256) ||
    typeof input.batchId !== "string" || !identifier.test(input.batchId)) {
    throw invalidRequest();
  }
  return structuredClone(input);
}

export function localResearchCapabilitySpec(input) {
  const request = validateLocalResearchRequest(input);
  return {
    episodeId: `local-research/${canonicalJsonDocumentContentSha256(request)}`,
    operation: request.action === "run" ? "worker:research-agent" : "research:import-evidence",
    scopes: request.action === "run"
      ? ["state.write", "filesystem.write", "network.request"]
      : ["state.write", "filesystem.write"],
    maxCalls: 0,
    maxCostUsd: 0
  };
}

export function localResearchSnapshotHash(episode, researchConfig, reviewConfig, candidateSha256 = null) {
  if (candidateSha256 !== null && (typeof candidateSha256 !== "string" || !sha256.test(candidateSha256))) {
    throw invalidRequest();
  }
  return canonicalJsonDocumentContentSha256({ episode, researchConfig, reviewConfig, candidateSha256 });
}

export function assertLocalResearchEpisode(input, episode, { initial = false } = {}) {
  const request = validateLocalResearchRequest(input);
  if (!episode || episode.id !== request.episodeId) {
    throw localResearchError("local_research_episode_mismatch");
  }
  if ((episode.research?.version ?? 0) !== request.researchVersion) {
    throw localResearchError("local_research_version_changed");
  }
  if (initial) {
    if (!Array.isArray(episode.pipeline) ||
      !episode.pipeline.some((step) => step?.agent === "research-agent" || step?.id === "research")) {
      throw localResearchError("local_research_episode_invalid");
    }
    if (episode.control?.activeOperation || episode.control?.stopRequested ||
      episode.pipeline.some((step) => step?.status === "running")) {
      throw localResearchError("local_research_episode_busy");
    }
    if (episode.approvals?.research?.status === "approved") {
      throw localResearchError("local_research_already_approved");
    }
  }
  return episode;
}
