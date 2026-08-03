const SIGNAL_ID_PATTERN = /^[a-z0-9-]+$/u;

export function validateTrendSources(document) {
  const errors = [];
  if (document?.schemaVersion !== 1) errors.push("trend sources schemaVersion must be 1");
  if (!Array.isArray(document?.creators)) errors.push("creators must be an array");

  const ids = new Set();
  for (const creator of document?.creators ?? []) {
    if (!creator.id || !SIGNAL_ID_PATTERN.test(creator.id)) errors.push("creator has invalid id");
    if (ids.has(creator.id)) errors.push(`duplicate creator id: ${creator.id}`);
    ids.add(creator.id);
    if (!creator.name) errors.push(`creator ${creator.id} has no name`);
    if (!creator.platform) errors.push(`creator ${creator.id} has no platform`);
    if (!(creator.weight > 0)) errors.push(`creator ${creator.id} has invalid weight`);
    if (!(creator.audienceFit >= 0 && creator.audienceFit <= 1)) {
      errors.push(`creator ${creator.id} has invalid audienceFit`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateTaxonomy(document) {
  const errors = [];
  if (document?.schemaVersion !== 1) errors.push("taxonomy schemaVersion must be 1");
  if (!Array.isArray(document?.concepts)) errors.push("concepts must be an array");

  const ids = new Set();
  for (const concept of document?.concepts ?? []) {
    if (!concept.id || !SIGNAL_ID_PATTERN.test(concept.id)) errors.push("concept has invalid id");
    if (ids.has(concept.id)) errors.push(`duplicate concept id: ${concept.id}`);
    ids.add(concept.id);
    if (!concept.name) errors.push(`concept ${concept.id} has no name`);
    if (!Array.isArray(concept.aliases)) errors.push(`concept ${concept.id} aliases must be an array`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateSignal(signal, creatorIds = null, conceptIds = null) {
  const errors = [];
  if (!signal?.id || !SIGNAL_ID_PATTERN.test(signal.id)) errors.push("signal has invalid id");
  if (!signal?.creatorId) errors.push(`signal ${signal?.id} has no creatorId`);
  if (!signal?.title) errors.push(`signal ${signal?.id} has no title`);
  if (!signal?.observedAt || Number.isNaN(Date.parse(signal.observedAt))) {
    errors.push(`signal ${signal?.id} has invalid observedAt`);
  }
  if (signal?.publishedAt && Number.isNaN(Date.parse(signal.publishedAt))) {
    errors.push(`signal ${signal?.id} has invalid publishedAt`);
  }
  if (creatorIds && !creatorIds.has(signal.creatorId)) {
    errors.push(`signal ${signal?.id} references unknown creator ${signal.creatorId}`);
  }
  for (const conceptId of signal?.conceptIds ?? []) {
    if (conceptIds && !conceptIds.has(conceptId)) {
      errors.push(`signal ${signal?.id} references unknown concept ${conceptId}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function normalizeSearchText(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replaceAll(/[\s_—–·・]+/gu, " ")
    .trim();
}
