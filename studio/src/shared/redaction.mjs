const sensitivePatterns = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/giu,
  /\b(?:api[\s_-]?key|token|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*\S+/giu
];
const sensitiveFieldNamePattern = /^(?:api.?key|private.?key|secret.?key|client.?secret|access.?token|refresh.?token|id.?token|token|secret|password|passwd|authorization|proxy.?authorization|cookie|set.?cookie|credential|credentials|signature|signed.?url|session.?token)$/iu;

function isSensitiveFieldName(value) {
  const normalized = String(value).replaceAll(/[\s_-]+/gu, "");
  return sensitiveFieldNamePattern.test(normalized) || [
    "apikey",
    "authorization",
    "cookie",
    "credential",
    "password",
    "secret",
    "signature",
    "token"
  ].some((suffix) => normalized.toLowerCase().endsWith(suffix));
}

export function redactSensitiveText(value, maximumLength = 500) {
  let text = String(value ?? "");
  for (const pattern of sensitivePatterns) text = text.replace(pattern, "[REDACTED]");
  return text.slice(0, maximumLength);
}

export function redactSensitiveValue(value, options = {}, depth = 0) {
  const maximumDepth = options.maximumDepth ?? 8;
  if (depth > maximumDepth) return "[TRUNCATED]";
  if (typeof value === "string") {
    return redactSensitiveText(value, options.maximumStringLength ?? 500);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, options.maximumArrayLength ?? 100)
      .map((item) => redactSensitiveValue(item, options, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveFieldName(key)
          ? "[REDACTED]"
          : redactSensitiveValue(item, options, depth + 1)
      ])
    );
  }
  return value;
}

export function safeErrorMessage(error, fallback = "操作失败") {
  return redactSensitiveText(error instanceof Error ? error.message : fallback);
}

export function sanitizeAttemptRecords(attempts = []) {
  return attempts.slice(0, 50).map((attempt) => ({
    provider: redactSensitiveText(attempt?.provider, 120),
    model: redactSensitiveText(attempt?.model, 160),
    attempt: Number.isInteger(attempt?.attempt) ? attempt.attempt : null,
    status: attempt?.status === "succeeded" ? "succeeded" : "failed",
    code: attempt?.code === null || attempt?.code === undefined
      ? null
      : redactSensitiveText(attempt.code, 120),
    httpStatus: Number.isInteger(attempt?.httpStatus) ? attempt.httpStatus : null,
    message: redactSensitiveText(attempt?.message, 500),
    actualCostUsd: Number.isFinite(attempt?.actualCostUsd)
      ? Math.max(0, attempt.actualCostUsd)
      : null,
    durationMs: Number.isFinite(attempt?.durationMs) ? Math.max(0, attempt.durationMs) : null
  }));
}
