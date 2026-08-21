export function reviewCheck(code, label, passed, options = {}) {
  return {
    code,
    label,
    passed: Boolean(passed),
    severity: options.severity ?? "error",
    actual: options.actual ?? null,
    expected: options.expected ?? null,
    message: options.message ?? "",
    location: options.location ?? null,
    suggestedFix: options.suggestedFix ?? "",
    ownerAgentId: options.ownerAgentId ?? null
  };
}

export function fromQualityChecks(checks = []) {
  return checks.map((item) => ({
    code: item.id,
    label: item.label,
    passed: Boolean(item.passed),
    severity: item.severity ?? "error",
    actual: item.actual ?? null,
    expected: item.expected ?? null,
    message: item.message ?? "",
    location: item.location ?? item.id,
    suggestedFix: item.suggestedFix ?? "",
    ownerAgentId: item.ownerAgentId ?? null
  }));
}

export function issueFromCheck(check) {
  return {
    code: check.code,
    location: check.location ?? check.code,
    evidence:
      check.message ||
      `${check.label}：实际 ${String(check.actual ?? "未知")}，期望 ${String(check.expected ?? "通过")}`,
    suggestedFix: check.suggestedFix || `修复“${check.label}”后重新生成或审核`,
    ownerAgentId: check.ownerAgentId ?? null
  };
}
