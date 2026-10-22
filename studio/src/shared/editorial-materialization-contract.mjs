import {canonicalJsonDocumentContentSha256 as digest} from "./durable-json-store.mjs";
import {validateEditorialAssetsMaterializeRequest} from "./editorial-assets-materialize-request.mjs";

const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const RECEIPT_FIELDS = ["schemaVersion", "episodeId", "operationId", "request", "version", "directory",
  "manifestPath", "manifestBytes", "manifestSha256", "bundlePath", "inputPropsPath", "inputPropsSha256",
  "candidateHash", "machineReviewId", "assetPlanVersion", "implementationSha256", "rendered", "voiceStatus",
  "externalApiCalls", "maximumPaidCostUsd"];
const ASSET_FIELDS = ["id", "planItemId", "version", "type", "path", "source", "executor", "componentId",
  "implementationSha256", "assetPlanVersion", "candidateHash", "materialization", "bytes", "sha256",
  "createdAt", "privacy", "verified", "technicalVerification", "rights", "externalApiCalls",
  "maximumPaidCostUsd", "rendered", "visualAcceptance"];

function closedRecord(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [null, Object.prototype].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
    });
}
function dataArray(value) {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype
    && Reflect.ownKeys(value).length === value.length + 1
    && Array.from({length: value.length}, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
      .every(descriptor => descriptor?.enumerable && Object.hasOwn(descriptor, "value"));
}
// Unlike a JSON hash, this also rejects unknown undefined/symbol/hidden fields
// and accessors. Inspect descriptors before reading any untrusted value.
function matchesClosed(value, expected) {
  if (Array.isArray(expected)) return dataArray(value) && value.length === expected.length
    && expected.every((item, index) => matchesClosed(value[index], item));
  if (expected !== null && typeof expected === "object") {
    const keys = Object.keys(expected);
    return closedRecord(value, keys) && keys.every(key => matchesClosed(value[key], expected[key]));
  }
  return Object.is(value, expected);
}

// Pure registration validation only. File digests are opaque here: the sealed
// service and downstream bundle verifier must verify their actual bytes. Keep
// this reconstruction aligned with editorialMaterializationReceipt/AssetRecords;
// tests use those production schema helpers with exclusively synthetic data.
export function editorialMaterializationRegistrationValid(episode, assets, receipt) {
  try {
    if (!closedRecord(receipt, RECEIPT_FIELDS) || !dataArray(assets) || !assets.length
      || !assets.every(asset => closedRecord(asset, ASSET_FIELDS))) return false;
    const request = validateEditorialAssetsMaterializeRequest(receipt.request);
    const operationId = digest(request);
    const plan = episode.production?.assetPlan;
    const checkpoint = episode.reviewCheckpoints?.assetExecution;
    const human = checkpoint?.humanApproval;
    const candidateHash = checkpoint?.currentCandidate?.candidateHash;
    const implementationSha256 = plan?.content?.implementation?.sha256;
    if (plan?.content?.kind !== "editorial-code-asset-plan-v1" || !positiveInteger(plan.version)
      || checkpoint?.status !== "approved" || checkpoint.machineReview?.status !== "passed"
      || human?.decision !== "approved" || !sha(candidateHash) || !sha(implementationSha256)
      || human.candidateHash !== candidateHash || checkpoint.machineReview.candidateHash !== candidateHash
      || human.machineReviewId !== checkpoint.machineReview.id
      || typeof human.actor !== "string" || !/^human:[^\s\p{Cc}]{1,120}$/u.test(human.actor)
      || typeof human.at !== "string" || !Number.isFinite(Date.parse(human.at))
      || new Date(human.at).toISOString() !== human.at
      || request.episodeId !== episode.id || request.candidateHash !== candidateHash
      || request.machineReviewId !== checkpoint.machineReview.id || request.implementationHash !== implementationSha256
      || !positiveInteger(receipt.manifestBytes) || !sha(receipt.manifestSha256) || !sha(receipt.inputPropsSha256)) return false;

    const directory = `studio/public/episodes/${episode.id}/editorial-materialization/${operationId}`;
    const expectedReceipt = {schemaVersion: "editorial-materialization-receipt-v1", episodeId: episode.id,
      operationId, request, version: 1, directory, manifestPath: `${directory}/materialization.json`,
      manifestBytes: receipt.manifestBytes, manifestSha256: receipt.manifestSha256, bundlePath: `${directory}/bundle`,
      inputPropsPath: `${directory}/input-props.json`, inputPropsSha256: receipt.inputPropsSha256,
      candidateHash, machineReviewId: checkpoint.machineReview.id, assetPlanVersion: plan.version,
      implementationSha256, rendered: false, voiceStatus: "deferred", externalApiCalls: 0, maximumPaidCostUsd: 0};
    if (!matchesClosed(receipt, expectedReceipt)) return false;
    const items = plan.content.items;
    if (!Array.isArray(items) || items.length !== assets.length
      || new Set(items.map(item => item.id)).size !== items.length
      || items.some(item => typeof item.id !== "string" || !item.id || item.required !== true
        || item.productionMethod?.kind !== "local-code-animation"
        || item.productionMethod.executor !== "EditorialMotionPreview")) return false;

    // Every scene points to the same bundled index.html, so even these opaque
    // byte fields must agree across items; the disk verifier supplies the truth.
    const file = {bytes: assets[0].bytes, sha256: assets[0].sha256};
    if (!positiveInteger(file.bytes) || !sha(file.sha256)) return false;
    const expectedAssets = items.map(item => ({id: `editorial-${item.id}-v1`, planItemId: item.id,
      version: 1, type: "code-animation", path: `${directory.slice("studio/public/".length)}/bundle/index.html`,
      source: "local-code-animation", executor: "EditorialMotionPreview", componentId: "EditorialMotionPreview",
      implementationSha256, assetPlanVersion: plan.version, candidateHash,
      materialization: {schemaVersion: "editorial-materialization-asset-binding-v1", operationId,
        manifestPath: expectedReceipt.manifestPath, manifestSha256: expectedReceipt.manifestSha256,
        bundlePath: expectedReceipt.bundlePath, inputPropsSha256: expectedReceipt.inputPropsSha256},
      ...file, createdAt: human.at, privacy: "project-original", verified: false,
      technicalVerification: "recursive-byte-integrity",
      rights: {schemaVersion: 1, authorOrSource: "AI Concept Studio approved local code and brand resources", sourceUrl: null,
        acquiredAt: human.at, license: "project-original-private-use; Noto Sans SC OFL-1.1", allowedUse: "private-internal-review",
        attributionRequirements: "Preserve bundled font license", privacyPortraitStatus: "project-original",
        verifiedBy: "machine:editorial-materialization-v1"},
      externalApiCalls: 0, maximumPaidCostUsd: 0, rendered: false, visualAcceptance: false}));
    if (!matchesClosed(assets, expectedAssets)) return false;
    if (((episode.assets ?? []).length || episode.production.editorialMaterialization != null)
      && (!matchesClosed(episode.assets, expectedAssets)
        || !matchesClosed(episode.production.editorialMaterialization, expectedReceipt))) return false;
    return true;
  } catch { return false; }
}
