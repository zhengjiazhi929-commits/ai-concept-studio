const SAFE_ID_PATTERN = /^[a-z0-9-]+$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CLAIM_SUPPORT = new Set(["supported", "partial", "disputed", "unsupported"]);

export function validateResearchConfig(document) {
  const errors = [];
  if (document?.schemaVersion !== 1) errors.push("research config schemaVersion must be 1");
  for (const key of [
    "timeoutMs",
    "maxConcurrency",
    "maxSourceBytes",
    "minimumSources",
    "minimumPrimarySources",
    "minimumSupportedClaims",
    "minimumCrossSourceClaims"
  ]) {
    if (!(document?.[key] > 0)) errors.push(`research ${key} must be positive`);
  }
  if (!(document?.retryCount >= 0)) errors.push("research retryCount must not be negative");
  if (!(document?.retryBackoffMs >= 0)) {
    errors.push("research retryBackoffMs must not be negative");
  }
  if (!Array.isArray(document?.allowedSourceTypes) || document.allowedSourceTypes.length === 0) {
    errors.push("research allowedSourceTypes must not be empty");
  }
  if (
    !Array.isArray(document?.requiredClaimCategories) ||
    document.requiredClaimCategories.length === 0
  ) {
    errors.push("research requiredClaimCategories must not be empty");
  }
  return { valid: errors.length === 0, errors };
}

export function validateResearchEvidenceBatch(batch, config) {
  const errors = [];
  if (batch?.schemaVersion !== 1) errors.push("research batch schemaVersion must be 1");
  if (!batch?.batchId || !SAFE_ID_PATTERN.test(batch.batchId)) {
    errors.push("research batch has invalid batchId");
  }
  if (!batch?.episodeId || !SAFE_ID_PATTERN.test(batch.episodeId)) {
    errors.push("research batch has invalid episodeId");
  }
  if (!batch?.researchedAt || Number.isNaN(Date.parse(batch.researchedAt))) {
    errors.push("research batch has invalid researchedAt");
  }
  if (!Array.isArray(batch?.sources)) errors.push("research batch sources must be an array");
  if (!Array.isArray(batch?.claims)) errors.push("research batch claims must be an array");

  const sourceIds = new Set();
  for (const [index, source] of (batch?.sources ?? []).entries()) {
    const prefix = `source ${index + 1}`;
    if (!source?.id || !SAFE_ID_PATTERN.test(source.id)) errors.push(`${prefix} has invalid id`);
    else if (sourceIds.has(source.id)) errors.push(`${prefix} has duplicate id`);
    else sourceIds.add(source.id);
    if (!source?.label) errors.push(`${prefix} has no label`);
    if (!source?.url || !/^https:\/\//u.test(source.url)) errors.push(`${prefix} must use https`);
    if (!config.allowedSourceTypes.includes(source?.sourceType)) {
      errors.push(`${prefix} has unsupported sourceType`);
    }
    if (!source?.publisher) errors.push(`${prefix} has no publisher`);
    if (!source?.evidenceSummary) errors.push(`${prefix} has no evidenceSummary`);
    if (!source?.locator) errors.push(`${prefix} has no locator`);
    if (source?.contentHash && !SHA256_PATTERN.test(source.contentHash)) {
      errors.push(`${prefix} has invalid contentHash`);
    }
  }

  const categoryIds = new Set(config.requiredClaimCategories.map((item) => item.id));
  const claimIds = new Set();
  for (const [index, claim] of (batch?.claims ?? []).entries()) {
    const prefix = `claim ${index + 1}`;
    if (!claim?.id || !SAFE_ID_PATTERN.test(claim.id)) errors.push(`${prefix} has invalid id`);
    else if (claimIds.has(claim.id)) errors.push(`${prefix} has duplicate id`);
    else claimIds.add(claim.id);
    if (!categoryIds.has(claim?.category)) errors.push(`${prefix} has unknown category`);
    if (!claim?.text) errors.push(`${prefix} has no text`);
    if (!CLAIM_SUPPORT.has(claim?.support)) errors.push(`${prefix} has invalid support`);
    if (!Array.isArray(claim?.sourceIds) || claim.sourceIds.length === 0) {
      errors.push(`${prefix} must cite at least one source`);
    } else {
      for (const sourceId of claim.sourceIds) {
        if (!sourceIds.has(sourceId)) errors.push(`${prefix} cites unknown source ${sourceId}`);
      }
    }
    if (!claim?.boundary) errors.push(`${prefix} has no boundary statement`);
  }
  return { valid: errors.length === 0, errors };
}
