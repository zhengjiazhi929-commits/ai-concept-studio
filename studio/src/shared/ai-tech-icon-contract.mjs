export const AI_TECH_ICON_CONTRACT_VERSION = "ai-tech-icon-contract-v2";
export const AI_TECH_ICON_REGISTRY_VERSION = "ai-tech-icon-registry-v1";
export const AI_TECH_ICON_REGISTRY_APPROVAL = Object.freeze({
  status: "approved-production-v1",
  approvedBy: "Zhengjiazhi",
  approvedOn: "2026-08-26",
  sourceCandidate: "ai-tech-icon-system-review-v002",
  scope: "28-concept-mapping-geometry-status-motion-and-production-usage-rules"
});
export const AI_TECH_ICON_VIEW_BOX = Object.freeze({
  minX: 0,
  minY: 0,
  width: 64,
  height: 64,
  value: "0 0 64 64"
});

export const AI_TECH_ICON_CONCEPT_KINDS = Object.freeze([
  "prompt",
  "document",
  "image",
  "audio",
  "video",
  "table-data",
  "database",
  "knowledge-base",
  "search-retrieval",
  "vector-embedding",
  "context-window",
  "memory",
  "ai-model",
  "agent",
  "tool",
  "api",
  "mcp",
  "workflow",
  "routing",
  "parallel-execution",
  "retry",
  "verified-success",
  "warning",
  "failure",
  "human-approval",
  "permission",
  "audit-log",
  "version-history"
]);

export const AI_TECH_ICON_SIZE_ROLES = Object.freeze({
  inline: Object.freeze({
    sizePx: 36,
    purpose: "旧图标审阅联系表的小号独立展示；正式成片不得嵌入卡片文字"
  }),
  support: Object.freeze({ sizePx: 56, purpose: "开放图解中的独立语义对象" }),
  focus: Object.freeze({ sizePx: 104, purpose: "单一概念焦点，不替代大标题" })
});

export const AI_TECH_ICON_PRODUCTION_PRESENTATIONS = Object.freeze([
  "standalone-focus",
  "open-diagram-symbol"
]);

export const AI_TECH_ICON_STATE_ROLES = Object.freeze([
  "neutral",
  "active",
  "success",
  "warning",
  "error",
  "human"
]);

export const AI_TECH_ICON_COLOR_ROLES = Object.freeze([
  "text-primary",
  "text-secondary",
  "line-primary",
  "line-secondary",
  "accent-primary",
  "accent-secondary",
  "state-success",
  "state-warning",
  "state-error",
  "surface",
  "surface-muted"
]);

export const AI_TECH_ICON_POLICY = Object.freeze({
  shapeLanguage: "flat-geometric-outline",
  viewBox: AI_TECH_ICON_VIEW_BOX.value,
  opticalInset: 8,
  strokeWidth: 3.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  minimumPrimitiveCount: 1,
  maximumPrimitiveCount: 6,
  maximumVisibleIconsPerProductionScene: 2,
  maximumIconsPerInformationCard: 0,
  informationCardContentMode: "text-only",
  productionPresentationMode: "standalone-only",
  allowedProductionPresentations: AI_TECH_ICON_PRODUCTION_PRESENTATIONS,
  maximumNonNeutralColorRolesPerIcon: 2,
  minimumHeadlineLeadFrames: 12,
  defaultEnterFrames: 16,
  motionMode: "frame-progress-driven",
  settleMode: "stable-hold",
  unknownConceptMode: "fail-closed",
  explicitNoIconConcept: "none",
  canonicalStatusMarkConcept: "verified-success",
  checkmarkRendering: "visual-system-v1-status-mark-only",
  forbidden: Object.freeze([
    "emoji-glyph",
    "unicode-status-mark",
    "scene-private-svg-icon",
    "raw-color-value",
    "decorative-icon-wall",
    "pseudo-3d",
    "heavy-shadow",
    "decorative-gradient",
    "css-animation",
    "css-transition",
    "continuous-loop"
  ])
});

export const AI_TECH_ICON_ERROR_CODES = Object.freeze({
  CONCEPT_UNKNOWN: "ai-tech-icon-concept-unknown",
  SIZE_ROLE_UNKNOWN: "ai-tech-icon-size-role-unknown",
  STATE_ROLE_UNKNOWN: "ai-tech-icon-state-role-unknown",
  PROGRESS_INVALID: "ai-tech-icon-progress-invalid"
});

export class AiTechIconContractError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "AiTechIconContractError";
    this.code = code;
    this.details = details;
  }
}

export function assertAiTechIconConceptKind(conceptKind, { allowNone = false } = {}) {
  if (allowNone && conceptKind === AI_TECH_ICON_POLICY.explicitNoIconConcept) return null;
  if (!AI_TECH_ICON_CONCEPT_KINDS.includes(conceptKind)) {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.CONCEPT_UNKNOWN,
      `未知 AI 技术图标语义：${String(conceptKind)}`,
      { conceptKind, allowed: AI_TECH_ICON_CONCEPT_KINDS }
    );
  }
  return conceptKind;
}

export function aiTechIconSize(sizeRole = "support") {
  const definition = AI_TECH_ICON_SIZE_ROLES[sizeRole];
  if (!definition) {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.SIZE_ROLE_UNKNOWN,
      `未知 AI 技术图标尺寸角色：${String(sizeRole)}`,
      { sizeRole, allowed: Object.keys(AI_TECH_ICON_SIZE_ROLES) }
    );
  }
  return definition;
}

export function assertAiTechIconStateRole(stateRole = "neutral") {
  if (!AI_TECH_ICON_STATE_ROLES.includes(stateRole)) {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.STATE_ROLE_UNKNOWN,
      `未知 AI 技术图标状态角色：${String(stateRole)}`,
      { stateRole, allowed: AI_TECH_ICON_STATE_ROLES }
    );
  }
  return stateRole;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function aiTechIconMotionStateAtProgress(progress) {
  if (!Number.isFinite(progress)) {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.PROGRESS_INVALID,
      "AI 技术图标 progress 必须是有限数字",
      { progress }
    );
  }
  const normalized = clamp01(progress);
  const eased = normalized * normalized * (3 - (2 * normalized));
  const drawProgress = clamp01((normalized - 0.18) / 0.82);
  return Object.freeze({
    progress: normalized,
    opacity: eased,
    scale: 0.96 + (0.04 * eased),
    translateY: (1 - eased) * 4,
    drawProgress,
    settled: normalized === 1
  });
}
