const SAFE_ID_PATTERN = /^[a-z0-9-]+$/u;

export function validateCollectorConfig(document) {
  const errors = [];
  if (document?.schemaVersion !== 1) errors.push("collector config schemaVersion must be 1");
  if (!(document?.timeoutMs > 0)) errors.push("collector timeoutMs must be positive");
  if (!(document?.retryCount >= 0)) errors.push("collector retryCount must not be negative");
  if (!(document?.retryBackoffMs >= 0)) {
    errors.push("collector retryBackoffMs must not be negative");
  }
  if (!(document?.maxConcurrency > 0)) errors.push("collector maxConcurrency must be positive");
  if (!(document?.lookbackDays > 0)) errors.push("collector lookbackDays must be positive");
  if (!(document?.sourceFreshnessDays > 0)) {
    errors.push("collector sourceFreshnessDays must be positive");
  }
  return { valid: errors.length === 0, errors };
}

export function validateAssistedBatch(batch, creatorIds = null) {
  const errors = [];
  if (batch?.schemaVersion !== 1) errors.push("assisted batch schemaVersion must be 1");
  if (!batch?.batchId || !SAFE_ID_PATTERN.test(batch.batchId)) {
    errors.push("assisted batch has invalid batchId");
  }
  if (!batch?.observedAt || Number.isNaN(Date.parse(batch.observedAt))) {
    errors.push("assisted batch has invalid observedAt");
  }
  if (!Array.isArray(batch?.observations)) errors.push("assisted batch observations must be an array");

  for (const [index, observation] of (batch?.observations ?? []).entries()) {
    const prefix = `observation ${index + 1}`;
    if (!observation?.creatorId) errors.push(`${prefix} has no creatorId`);
    if (creatorIds && !creatorIds.has(observation.creatorId)) {
      errors.push(`${prefix} references unknown creator ${observation.creatorId}`);
    }
    if (!observation?.title) errors.push(`${prefix} has no title`);
    if (!observation?.sourceUrl || !/^https?:\/\//u.test(observation.sourceUrl)) {
      errors.push(`${prefix} has invalid sourceUrl`);
    }
    if (!observation?.publishedAt || Number.isNaN(Date.parse(observation.publishedAt))) {
      errors.push(`${prefix} has invalid publishedAt`);
    }
    if (observation?.id && !SAFE_ID_PATTERN.test(observation.id)) {
      errors.push(`${prefix} has invalid id`);
    }
  }
  return { valid: errors.length === 0, errors };
}
