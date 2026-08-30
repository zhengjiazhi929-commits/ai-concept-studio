import { createHash } from "node:crypto";
import { integrityHash } from "./integrity.mjs";

const missingValues = new Set([
  "",
  "unknown",
  "unverified",
  "pending",
  "tbd",
  "n/a"
]);

const resolvedPrivacyStatuses = new Set([
  "no-identifiable-person",
  "consent-recorded",
  "fictional-data",
  "project-original",
  "synthetic-no-real-person"
]);

function rightsError(message, errors = []) {
  const error = new Error(message);
  error.code = "asset_rights_metadata_required";
  error.statusCode = 400;
  error.details = errors;
  return error;
}

function boundedText(value, maximum = 512) {
  const text = String(value ?? "").trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) return null;
  return text;
}

function meaningfulText(value, maximum = 512) {
  const text = boundedText(value, maximum);
  return text && !missingValues.has(text.toLowerCase()) ? text : null;
}

function normalizedSourceUrl(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = boundedText(value, 2048);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeRelativePath(value) {
  const path = boundedText(value, 2048);
  return Boolean(
    path &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/(?:^|\/)\.\.(?:\/|$)/u.test(path)
  );
}

export function buildUploadRights(input, options = {}) {
  const source = String(options.source ?? "human-upload");
  const actor = boundedText(options.actor, 128);
  const acquiredAt = String(options.acquiredAt ?? new Date().toISOString());
  const sourceUrl = normalizedSourceUrl(input?.sourceUrl);
  const rights = {
    schemaVersion: 1,
    authorOrSource: meaningfulText(input?.authorOrSource),
    sourceUrl,
    acquiredAt,
    license: meaningfulText(input?.license),
    allowedUse: meaningfulText(input?.allowedUse),
    attributionRequirements: meaningfulText(input?.attributionRequirements),
    privacyPortraitStatus: meaningfulText(input?.privacyPortraitStatus),
    verifiedBy: actor
  };
  const errors = [];
  for (const field of [
    "authorOrSource",
    "license",
    "allowedUse",
    "attributionRequirements",
    "privacyPortraitStatus",
    "verifiedBy"
  ]) {
    if (!rights[field]) errors.push(`${field} is required`);
  }
  if (!Number.isFinite(Date.parse(acquiredAt))) errors.push("acquiredAt must be an ISO timestamp");
  if (sourceUrl === undefined) errors.push("sourceUrl must be an HTTP(S) URL without credentials");
  if (
    new Set(["licensed-stock", "approved-external-generation"]).has(source) &&
    !sourceUrl
  ) {
    errors.push("sourceUrl is required for external or stock material");
  }
  if (!resolvedPrivacyStatuses.has(rights.privacyPortraitStatus)) {
    errors.push("privacyPortraitStatus must be resolved before registration");
  }
  if (errors.length > 0) {
    throw rightsError(`素材许可证台账不完整：${errors.join("；")}`, errors);
  }
  return rights;
}

export function validateExternalRightsDeclaration(declaration) {
  const errors = [];
  if (!declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
    return { valid: false, errors: ["structured rightsDeclaration is required"] };
  }
  if (declaration.schemaVersion !== 1) {
    errors.push("rightsDeclaration schemaVersion must be 1");
  }
  if (!meaningfulText(declaration.authorOrSource)) {
    errors.push("authorOrSource is required");
  }
  const sourceUrl = normalizedSourceUrl(declaration.sourceUrl);
  if (!sourceUrl) {
    errors.push("sourceUrl must be an HTTP(S) URL without credentials");
  }
  if (!meaningfulText(declaration.license)) {
    errors.push("license is required and must be resolved");
  }
  if (!meaningfulText(declaration.allowedUse)) {
    errors.push("allowedUse is required");
  }
  if (!meaningfulText(declaration.attributionRequirements)) {
    errors.push("attributionRequirements is required");
  }
  if (!resolvedPrivacyStatuses.has(declaration.privacyPortraitStatus)) {
    errors.push("privacyPortraitStatus must be resolved");
  }
  const verifiedBy = meaningfulText(declaration.verifiedBy, 128);
  if (!verifiedBy || !verifiedBy.startsWith("human:")) {
    errors.push("verifiedBy must identify the human who checked the provider terms");
  }
  if (!Number.isFinite(Date.parse(declaration.verifiedAt ?? ""))) {
    errors.push("verifiedAt must be an ISO timestamp");
  }
  return { valid: errors.length === 0, errors };
}

export function buildExternalGenerationRights(declaration, options = {}) {
  const validation = validateExternalRightsDeclaration(declaration);
  if (!validation.valid) {
    throw rightsError(
      `外部生成权利声明不完整：${validation.errors.join("；")}`,
      validation.errors
    );
  }
  return {
    ...buildUploadRights(declaration, {
      source: "approved-external-generation",
      actor: declaration.verifiedBy,
      acquiredAt: options.acquiredAt
    }),
    verifiedAt: declaration.verifiedAt
  };
}

function sameIntegrity(left, right) {
  return integrityHash(left) === integrityHash(right);
}

export function validateApprovedExternalAssetBinding(episode, asset) {
  const errors = [];
  const items = episode?.production?.assetPlan?.content?.items ?? [];
  const calls = episode?.production?.assetPlan?.content?.executionPolicy?.externalApiCalls ?? [];
  const item = items.find((candidate) => candidate?.id === asset?.planItemId) ?? null;
  const call = calls.find((candidate) => candidate?.id === asset?.externalCallId) ?? null;
  const expectedKind = item?.productionMethod?.kind;
  const expectedType = expectedKind === "external-image-generation"
    ? "image"
    : expectedKind === "external-video-generation"
      ? "video"
      : null;
  const expectedExtension = expectedType === "image" ? ".png" : expectedType === "video" ? ".mp4" : null;
  const candidateHash = episode?.reviewCheckpoints?.assetExecution?.currentCandidate?.candidateHash;
  const declarationValidation = validateExternalRightsDeclaration(call?.rightsDeclaration);
  const declarationHash = declarationValidation.valid
    ? integrityHash(call.rightsDeclaration)
    : null;
  let expectedRights = null;
  if (declarationValidation.valid && Number.isFinite(Date.parse(asset?.createdAt ?? ""))) {
    try {
      expectedRights = {
        ...buildExternalGenerationRights(call.rightsDeclaration, {
          acquiredAt: asset.createdAt
        }),
        declarationHash
      };
    } catch {
      expectedRights = null;
    }
  }
  const trustedPrefix = typeof candidateHash === "string" && candidateHash.length >= 16
    ? `episodes/${episode?.id}/generated-assets/${candidateHash.slice(0, 16)}`
    : null;
  const expectedPath = trustedPrefix && item && expectedExtension
    ? `${trustedPrefix}/${item.id}${expectedExtension}`
    : null;
  const expectedReceiptPath = trustedPrefix && item
    ? `${trustedPrefix}/${item.id}.receipt.json`
    : null;

  if (asset?.source !== "approved-external-generation") {
    errors.push("source must be approved-external-generation");
  }
  if (!item || !expectedType) errors.push("asset must bind an approved external plan item");
  if (!call) errors.push("asset must bind an approved external call");
  if (call && (typeof call.prompt !== "string" || !call.prompt.trim())) {
    errors.push("approved external call prompt is invalid");
  }
  if (!declarationValidation.valid) {
    errors.push(...declarationValidation.errors.map((error) => `rightsDeclaration: ${error}`));
  }
  if (call && item && (
    call.providerId !== item.productionMethod?.externalProvider ||
    call.model !== item.productionMethod?.externalModel ||
    !(item.sceneIds ?? []).every((sceneId) => call.sceneIds?.includes(sceneId))
  )) {
    errors.push("external call does not match the approved plan item");
  }
  if (asset?.candidateHash !== candidateHash) errors.push("candidateHash does not match current approval");
  if (asset?.type !== expectedType) errors.push("asset type does not match plan item");
  if (asset?.path !== expectedPath) errors.push("asset path is outside the trusted candidate output path");
  if (asset?.receiptPath !== expectedReceiptPath) {
    errors.push("receiptPath is outside the trusted candidate output path");
  }
  if (asset?.rightsDeclarationHash !== declarationHash) {
    errors.push("rightsDeclarationHash does not match approved call");
  }
  if (!expectedRights || !sameIntegrity(asset?.rights, expectedRights)) {
    errors.push("rights must exactly match the approved declaration and asset createdAt");
  }
  if (!validateAssetRights(asset).valid) errors.push("asset rights registry is invalid");
  return {
    valid: errors.length === 0,
    errors,
    item,
    call,
    declarationHash,
    expectedRights,
    expectedPath,
    expectedReceiptPath
  };
}

export function validateApprovedExternalAssetReceipt(episode, asset, receipt) {
  const binding = validateApprovedExternalAssetBinding(episode, asset);
  const errors = [...binding.errors];
  const call = binding.call;
  const promptHash = typeof call?.prompt === "string"
    ? createHash("sha256").update(call.prompt).digest("hex")
    : null;
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { valid: false, errors: [...errors, "completed receipt is required"] };
  }
  if (receipt.schemaVersion !== "approved-external-assets-v1") {
    errors.push("receipt schemaVersion is invalid");
  }
  if (!Number.isInteger(receipt.stateVersion) || receipt.stateVersion < 1) {
    errors.push("receipt stateVersion is invalid");
  }
  if (receipt.status !== "completed") errors.push("receipt is not completed");
  if (receipt.episodeId !== episode?.id) errors.push("receipt episodeId mismatch");
  if (receipt.candidateHash !== asset?.candidateHash) errors.push("receipt candidateHash mismatch");
  if (receipt.assetPlanVersion !== episode?.production?.assetPlan?.version) {
    errors.push("receipt assetPlanVersion mismatch");
  }
  if (receipt.planItemId !== asset?.planItemId) errors.push("receipt planItemId mismatch");
  if (receipt.callId !== asset?.externalCallId) errors.push("receipt callId mismatch");
  if (receipt.providerId !== call?.providerId || receipt.model !== call?.model) {
    errors.push("receipt provider or model mismatch");
  }
  if (receipt.endpoint !== call?.endpoint) errors.push("receipt endpoint mismatch");
  if (promptHash === null) errors.push("approved call prompt is invalid");
  if (receipt.promptHash !== promptHash) errors.push("receipt promptHash mismatch");
  if (receipt.requestParametersHash !== integrityHash(call?.requestParameters ?? null)) {
    errors.push("receipt requestParametersHash mismatch");
  }
  if (receipt.rightsDeclarationHash !== binding.declarationHash) {
    errors.push("receipt rightsDeclarationHash mismatch");
  }
  if (!sameIntegrity(receipt.rightsDeclaration ?? null, call?.rightsDeclaration ?? null)) {
    errors.push("receipt rightsDeclaration mismatch");
  }
  if (!sameIntegrity(receipt.asset ?? null, asset ?? null)) {
    errors.push("receipt asset snapshot mismatch");
  }
  if (!Number.isFinite(Date.parse(receipt.completedAt ?? ""))) {
    errors.push("receipt completedAt is invalid");
  }
  return { valid: errors.length === 0, errors, binding };
}

export function validateAssetRights(asset) {
  const errors = [];
  const rights = asset?.rights;
  if (!asset?.id || typeof asset.id !== "string") errors.push("asset_id is required");
  if (!safeRelativePath(asset?.path)) errors.push("safe local relative path is required");
  if (!Number.isSafeInteger(asset?.bytes) || asset.bytes <= 0) errors.push("bytes must be positive");
  if (!/^[a-f0-9]{64}$/u.test(asset?.sha256 ?? "")) errors.push("sha256 is required");
  if (!rights || typeof rights !== "object" || Array.isArray(rights)) {
    errors.push("rights registry is required");
    return { valid: false, errors };
  }
  if (rights.schemaVersion !== 1) errors.push("rights schemaVersion must be 1");
  if (!meaningfulText(rights.authorOrSource)) errors.push("authorOrSource is required");
  if (!meaningfulText(rights.license)) errors.push("license is required and must be resolved");
  if (!meaningfulText(rights.allowedUse)) errors.push("allowedUse is required");
  if (!meaningfulText(rights.attributionRequirements)) {
    errors.push("attributionRequirements is required");
  }
  if (!resolvedPrivacyStatuses.has(rights.privacyPortraitStatus)) {
    errors.push("privacyPortraitStatus must be resolved");
  }
  if (!meaningfulText(rights.verifiedBy, 128)) errors.push("verifiedBy is required");
  if (!Number.isFinite(Date.parse(rights.acquiredAt ?? ""))) {
    errors.push("acquiredAt must be an ISO timestamp");
  }
  const sourceUrl = normalizedSourceUrl(rights.sourceUrl);
  if (sourceUrl === undefined) errors.push("sourceUrl is invalid");
  if (
    new Set(["licensed-stock", "approved-external-generation"]).has(asset?.source) &&
    !sourceUrl
  ) {
    errors.push("external or stock material requires sourceUrl");
  }
  return { valid: errors.length === 0, errors };
}
