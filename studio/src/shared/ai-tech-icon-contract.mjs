export const AI_TECH_ICON_CONTRACT_VERSION = "ai-tech-icon-contract-v4";
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
  "longform-support": Object.freeze({
    sizePx: 88,
    purpose: "横版长视频明确预留的大型图解节点；不得进入远端边栏或贴附信息卡"
  }),
  focus: Object.freeze({ sizePx: 104, purpose: "单一概念焦点，不替代大标题" })
});

export const AI_TECH_ICON_PRODUCTION_PRESENTATIONS = Object.freeze([
  "standalone-focus",
  "open-diagram-symbol"
]);

export const AI_TECH_ICON_PARTICIPATION_ROLES = Object.freeze([
  "graph-node",
  "owned-callout",
  "dedicated-focus"
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
  registeredIconHierarchy: "peer",
  cardAttachmentMode: "forbidden",
  duplicateSemanticRepresentationMode: "fail-closed",
  maximumOwnedCalloutGapPx: 48,
  maximumIconLabelRevealDeltaFrames: 1,
  openDiagramUsage: Object.freeze({
    graphNodeLayoutRole: "semantic-icon-node",
    graphNodePlacement: "anchor-bounds",
    graphNodeGeometryMode: "measured-visible-content",
    graphNodeRelationEntryMode: "connector-arrow-first",
    graphNodeMultipleIncomingMode: "wait-for-all-establishing-arrows",
    ownedCalloutLayoutRole: "owned-icon-callout",
    allowedOwnedCalloutPlacements: Object.freeze([
      "right-center",
      "left-center",
      "above-center",
      "below-center"
    ]),
    remoteRailPlacement: "forbidden"
  }),
  verifiedSuccessUsage: Object.freeze({
    autoInsert: false,
    purpose: "state-proof",
    presentation: "standalone-focus",
    layoutRole: "dedicated-icon-focus",
    participation: "dedicated-focus",
    placement: "dedicated-focus"
  }),
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
  PRESENTATION_UNKNOWN: "ai-tech-icon-presentation-unknown",
  VERIFIED_SUCCESS_PRESENTATION_INVALID: "ai-tech-icon-verified-success-presentation-invalid",
  CARD_ATTACHMENT_FORBIDDEN: "ai-tech-icon-card-attachment-forbidden",
  VERIFIED_SUCCESS_USAGE_INVALID: "ai-tech-icon-verified-success-usage-invalid",
  PARTICIPATION_INVALID: "ai-tech-icon-participation-invalid",
  SEMANTIC_BINDING_INVALID: "ai-tech-icon-semantic-binding-invalid",
  OWNED_CALLOUT_GAP_INVALID: "ai-tech-icon-owned-callout-gap-invalid",
  REMOTE_RAIL_FORBIDDEN: "ai-tech-icon-remote-rail-forbidden",
  LABEL_REVEAL_SYNC_INVALID: "ai-tech-icon-label-reveal-sync-invalid",
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

export function assertAiTechIconProductionPresentation(conceptKind, presentation) {
  assertAiTechIconConceptKind(conceptKind);
  if (!AI_TECH_ICON_PRODUCTION_PRESENTATIONS.includes(presentation)) {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.PRESENTATION_UNKNOWN,
      `未知 AI 技术图标生产展示方式：${String(presentation)}`,
      { presentation, allowed: AI_TECH_ICON_PRODUCTION_PRESENTATIONS }
    );
  }
  if (
    conceptKind === AI_TECH_ICON_POLICY.canonicalStatusMarkConcept &&
    presentation !== AI_TECH_ICON_POLICY.verifiedSuccessUsage.presentation
  ) {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.VERIFIED_SUCCESS_PRESENTATION_INVALID,
      "成功对号只能作为独立成功焦点，不能作为开放图解节点或卡片贴边附件",
      {
        conceptKind,
        presentation,
        allowed: [AI_TECH_ICON_POLICY.verifiedSuccessUsage.presentation]
      }
    );
  }
  return presentation;
}

export function assertAiTechIconProductionPlacement({
  conceptKind,
  purpose,
  presentation,
  layoutRole,
  participation,
  semanticObjectId,
  ownerId = null,
  placement,
  maximumGapPx = null,
  labelRevealDeltaFrames = 0,
  attachmentMode = "independent",
  autoInsert = false
}) {
  const resolvedPresentation = assertAiTechIconProductionPresentation(conceptKind, presentation);
  if (attachmentMode !== "independent") {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.CARD_ATTACHMENT_FORBIDDEN,
      "注册图标必须是独立视觉对象，不能嵌入卡片或作为卡片贴边附件",
      { conceptKind, attachmentMode }
    );
  }
  if (!AI_TECH_ICON_PARTICIPATION_ROLES.includes(participation)) {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.PARTICIPATION_INVALID,
      `未知 AI 技术图标关系角色：${String(participation)}`,
      { participation, allowed: AI_TECH_ICON_PARTICIPATION_ROLES }
    );
  }
  if (!Number.isInteger(labelRevealDeltaFrames) || labelRevealDeltaFrames < 0 ||
      labelRevealDeltaFrames > AI_TECH_ICON_POLICY.maximumIconLabelRevealDeltaFrames) {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.LABEL_REVEAL_SYNC_INVALID,
      `图标与文字首次可见帧差不得超过 ${AI_TECH_ICON_POLICY.maximumIconLabelRevealDeltaFrames} 帧`,
      { labelRevealDeltaFrames }
    );
  }
  if (typeof placement === "string" && placement.endsWith("-rail")) {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.REMOTE_RAIL_FORBIDDEN,
      "生产图标不得放入与语义对象脱离的远端边栏",
      { conceptKind, placement }
    );
  }
  if (resolvedPresentation === "open-diagram-symbol") {
    if (participation === "graph-node") {
      if (
        typeof semanticObjectId !== "string" || semanticObjectId.length === 0 ||
        ownerId != null ||
        layoutRole !== AI_TECH_ICON_POLICY.openDiagramUsage.graphNodeLayoutRole ||
        placement !== AI_TECH_ICON_POLICY.openDiagramUsage.graphNodePlacement
      ) {
        throw new AiTechIconContractError(
          AI_TECH_ICON_ERROR_CODES.SEMANTIC_BINDING_INVALID,
          "关系图图标必须替代一个明确语义节点，并让关系线直接连接该节点",
          { conceptKind, participation, semanticObjectId, ownerId, layoutRole, placement }
        );
      }
    } else if (participation === "owned-callout") {
      const allowedPlacements = AI_TECH_ICON_POLICY.openDiagramUsage.allowedOwnedCalloutPlacements;
      if (
        typeof semanticObjectId !== "string" || semanticObjectId.length === 0 ||
        typeof ownerId !== "string" || ownerId.length === 0 ||
        layoutRole !== AI_TECH_ICON_POLICY.openDiagramUsage.ownedCalloutLayoutRole ||
        !allowedPlacements.includes(placement)
      ) {
        throw new AiTechIconContractError(
          AI_TECH_ICON_ERROR_CODES.SEMANTIC_BINDING_INVALID,
          "补充图标必须绑定明确 owner，并使用 owner 附近的受控方向",
          { conceptKind, participation, semanticObjectId, ownerId, layoutRole, placement }
        );
      }
      if (!Number.isFinite(maximumGapPx) || maximumGapPx < 0 ||
          maximumGapPx > AI_TECH_ICON_POLICY.maximumOwnedCalloutGapPx) {
        throw new AiTechIconContractError(
          AI_TECH_ICON_ERROR_CODES.OWNED_CALLOUT_GAP_INVALID,
          `补充图标与 owner 的边界距离不得超过 ${AI_TECH_ICON_POLICY.maximumOwnedCalloutGapPx}px`,
          { conceptKind, ownerId, maximumGapPx }
        );
      }
    } else {
      throw new AiTechIconContractError(
        AI_TECH_ICON_ERROR_CODES.PARTICIPATION_INVALID,
        "开放图解图标只能作为关系节点或近距归属标注",
        { conceptKind, participation }
      );
    }
  } else if (
    participation !== "dedicated-focus" ||
    ownerId != null ||
    layoutRole !== "dedicated-icon-focus" ||
    placement !== "dedicated-focus"
  ) {
    throw new AiTechIconContractError(
      AI_TECH_ICON_ERROR_CODES.SEMANTIC_BINDING_INVALID,
      "独立焦点图标只能用于专门焦点镜头，不能绑定普通卡片或关系节点",
      { conceptKind, participation, ownerId, layoutRole, placement }
    );
  }
  if (conceptKind === AI_TECH_ICON_POLICY.canonicalStatusMarkConcept) {
    const expected = AI_TECH_ICON_POLICY.verifiedSuccessUsage;
    if (
      purpose !== expected.purpose ||
      resolvedPresentation !== expected.presentation ||
      layoutRole !== expected.layoutRole ||
      participation !== expected.participation ||
      placement !== expected.placement ||
      autoInsert !== expected.autoInsert
    ) {
      throw new AiTechIconContractError(
        AI_TECH_ICON_ERROR_CODES.VERIFIED_SUCCESS_USAGE_INVALID,
        "成功对号必须由镜头显式规划为独立成功焦点，不能自动追加到结果卡或普通关系图",
        {
          conceptKind,
          purpose,
          presentation: resolvedPresentation,
          layoutRole,
          participation,
          placement,
          attachmentMode,
          autoInsert,
          expected
        }
      );
    }
  }
  return Object.freeze({
    conceptKind,
    purpose,
    presentation: resolvedPresentation,
    layoutRole,
    participation,
    semanticObjectId,
    ownerId,
    placement,
    maximumGapPx,
    labelRevealDeltaFrames,
    attachmentMode,
    autoInsert
  });
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
