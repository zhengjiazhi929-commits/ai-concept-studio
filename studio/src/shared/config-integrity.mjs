import { integrityHash } from "./integrity.mjs";

export function validateVersionedConfig(name, config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { valid: false, errors: [`${name} must be an object`] };
  }
  if (!Number.isInteger(config.schemaVersion) || config.schemaVersion < 1) {
    errors.push(`${name} schemaVersion must be a positive integer`);
  }
  if (typeof config.version !== "string" || !config.version.trim()) {
    errors.push(`${name} version is required`);
  }
  if (name === "model-registry") {
    if (!config.profiles || typeof config.profiles !== "object") errors.push("model-registry profiles are required");
    if (!config.models || typeof config.models !== "object") errors.push("model-registry models are required");
    for (const [modelId, model] of Object.entries(config.models ?? {})) {
      if (!Array.isArray(model.capabilities) || !Array.isArray(model.profiles)) {
        errors.push(`model ${modelId} capabilities and profiles are required`);
      }
      if (!new Set(["confirmed", "unconfirmed"]).has(model.pricing?.status)) {
        errors.push(`model ${modelId} pricing status is invalid`);
      }
      if (model.pricing?.status === "confirmed" && !model.pricing.version) {
        errors.push(`model ${modelId} confirmed pricing requires a version`);
      }
    }
  }
  if (name === "routing-policy" && !Array.isArray(config.providerPreference)) {
    errors.push("routing-policy providerPreference is required");
  }
  if (name === "review-rubrics" && !config.stages) {
    errors.push("review-rubrics stages are required");
  }
  return { valid: errors.length === 0, errors, hash: integrityHash(config) };
}

export function assertVersionedConfig(name, config) {
  const validation = validateVersionedConfig(name, config);
  if (!validation.valid) throw new Error(`${name} 配置无效：${validation.errors.join("；")}`);
  return validation;
}
