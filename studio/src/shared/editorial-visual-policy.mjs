export const EDITORIAL_VISUAL_POLICY_VERSION = "editorial-visual-policy-v8";

export const EDITORIAL_SEQUENCE_PROFILE = "ai-tech-longform";

export const EDITORIAL_SHAPE_GRAMMAR_VERSION = "editorial-shape-grammar-v1";

export const EDITORIAL_SHAPE_GRAMMAR = Object.freeze({
  informationCard: Object.freeze({
    visualForm: "full-outline",
    semanticMeaning: "complete-object-or-boundary"
  }),
  openCanvas: Object.freeze({
    visualForm: "open-node",
    semanticMeaning: "process-or-relationship-anchor"
  }),
  semanticBoundary: Object.freeze({
    visualForm: "dashed-outline",
    allowedMeanings: Object.freeze([
      "scope",
      "exclusion",
      "pending-validation",
      "risk-boundary"
    ]),
    forbiddenMeaning: "decoration"
  }),
  teachingMode: Object.freeze({
    mode: "single-transient-legend",
    persistent: false
  })
});

export const EDITORIAL_VISUAL_MODES = Object.freeze([
  "text-led",
  "card-led",
  "open-diagram",
  "mixed-diagram"
]);

/**
 * Reusable explanatory treatments describe how a scene makes meaning visible.
 * They deliberately name the teaching pattern, not a fixed icon or drawing.
 */
export const EDITORIAL_NARRATIVE_TREATMENTS = Object.freeze([
  "package-anatomy",
  "runtime-resource-flow",
  "governance-evidence-trail",
  "state-transformation",
  "decision-path",
  "comparison-field",
  "relationship-map"
]);

export const EDITORIAL_NARRATIVE_TREATMENT_NONE = "not-applicable";

export const EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS = Object.freeze({
  "package-anatomy": Object.freeze({
    mechanism: "containment-and-responsibility",
    requiredRelationTypes: Object.freeze(["contains", "packages"]),
    minimumVisibleElements: 3,
    minimumRelations: 2,
    roleSignatures: Object.freeze([
      Object.freeze(["hierarchy-root"]),
      Object.freeze(["hierarchy-entry"]),
      Object.freeze(["step", "result"])
    ])
  }),
  "runtime-resource-flow": Object.freeze({
    mechanism: "runtime-entry-exit-flow",
    requiredRelationTypes: Object.freeze([
      "loads-metadata",
      "loads-instructions",
      "loads-resource",
      "invokes-capability",
      "connects-system"
    ]),
    minimumVisibleElements: 3,
    minimumRelations: 2,
    roleSignatures: Object.freeze([
      Object.freeze(["process-step"]),
      Object.freeze(["endpoint"]),
      Object.freeze(["decision", "source"])
    ])
  }),
  "governance-evidence-trail": Object.freeze({
    mechanism: "evidence-and-accountability-chain",
    requiredRelationTypes: Object.freeze([
      "records-evidence",
      "invalidates-review",
      "requires-review",
      "assigns-accountability"
    ]),
    minimumVisibleElements: 4,
    minimumRelations: 3,
    roleSignatures: Object.freeze([
      Object.freeze(["evidence"]),
      Object.freeze(["time-anchor"]),
      Object.freeze(["feedback-action"]),
      Object.freeze(["source", "decision"])
    ])
  }),
  "state-transformation": Object.freeze({
    mechanism: "before-after-convergence",
    requiredRelationTypes: Object.freeze(["transforms-to", "converges-to"]),
    minimumVisibleElements: 2,
    minimumRelations: 1,
    roleSignatures: Object.freeze([
      Object.freeze(["source", "result"]),
      Object.freeze(["step", "result"]),
      Object.freeze(["decision", "result"])
    ])
  }),
  "decision-path": Object.freeze({
    mechanism: "condition-to-outcome-branch",
    requiredRelationTypes: Object.freeze(["qualifies", "branches-to"]),
    minimumVisibleElements: 3,
    minimumRelations: 2,
    roleSignatures: Object.freeze([
      Object.freeze(["decision"]),
      Object.freeze(["source", "result"])
    ])
  }),
  "comparison-field": Object.freeze({
    mechanism: "shared-dimension-contrast",
    requiredRelationTypes: Object.freeze(["compares-on", "contrasts-with"]),
    minimumVisibleElements: 3,
    minimumRelations: 1,
    roleSignatures: Object.freeze([
      Object.freeze(["state"]),
      Object.freeze(["decision"]),
      Object.freeze(["source", "result"]),
      Object.freeze(["source", "concept"])
    ])
  }),
  "relationship-map": Object.freeze({
    mechanism: "typed-relation-network",
    requiredRelationTypes: Object.freeze(["defines", "associates"]),
    minimumVisibleElements: 3,
    minimumRelations: 2,
    roleSignatures: Object.freeze([])
  })
});

export const EDITORIAL_SUBTITLE_PHASES = Object.freeze([
  "pre-build",
  "active-build",
  "dense-build",
  "final-hold"
]);

export const EDITORIAL_ICON_PURPOSES = Object.freeze([
  "semantic-anchor",
  "state-proof",
  "interaction-cue"
]);

export const EDITORIAL_ICON_PRESENTATIONS = Object.freeze([
  "standalone-focus",
  "open-diagram-symbol"
]);

export const EDITORIAL_SURFACE_ROLES = Object.freeze([
  "information-card",
  "open-canvas"
]);

export const EDITORIAL_VISUAL_HIERARCHY_LEVELS = Object.freeze([
  "primary",
  "secondary",
  "supporting"
]);

export const EDITORIAL_CARD_SURFACE_PURPOSES = Object.freeze([
  "focus-result",
  "decision-boundary",
  "actionable-object",
  "state-container"
]);

export const EDITORIAL_OPEN_SURFACE_PURPOSES = Object.freeze([
  "process-anchor",
  "relationship-structure",
  "transition-output"
]);

export const EDITORIAL_SURFACE_PURPOSE_RATIONALES = Object.freeze({
  "focus-result": "把本镜头的关键结果与过程区分开，形成明确阅读焦点。",
  "decision-boundary": "把需要判断、采用或退回的边界收束为可识别容器。",
  "actionable-object": "把可被执行、检查或交付的完整对象作为一个信息单元。",
  "state-container": "把需要共同读取的一组状态属性封装在同一边界内。",
  "process-anchor": "保持步骤处于开放关系图中，让顺序和流向优先于容器。",
  "relationship-structure": "保持对象处于开放关系图中，让层级、对照或连接优先。",
  "transition-output": "保持反馈或输出处于关系末端，明确它与前序动作的因果。"
});

export const EDITORIAL_TITLE_LAYOUT_ACTIONS = Object.freeze([
  "keep",
  "grow-card",
  "reflow-layout"
]);

export const EDITORIAL_VISUAL_POLICY = Object.freeze({
  sequenceProfile: EDITORIAL_SEQUENCE_PROFILE,
  maximumCardLedSceneRatio: 0.5,
  maximumConsecutiveCardLedScenes: 1,
  minimumNarrativeTreatmentsPerLongformSequence: 3,
  minimumNarrativeDiversitySequenceLength: 8,
  narrativeTreatmentWindowSize: 4,
  maximumConsecutiveSameNarrativeTreatment: 2,
  denseDiagramVisibleNodeThreshold: 5,
  denseDiagramVisibleRelationThreshold: 4,
  maximumSubtitleCueGraphemes: 16,
  maximumStandaloneFinalSubtitleGraphemes: 8,
  diagramBuildSubtitleMode: "semantic-cue",
  denseFinalHoldSubtitleMode: "semantic-cue",
  preAndFinalSubtitleMode: "full-sentence",
  mixedDiagramMustCarryRelation: true,
  maximumIconsPerLongVideoScene: 2,
  maximumIconsPerInformationCard: 0,
  informationCardContentMode: "text-only",
  iconPresentationMode: "standalone-only",
  iconSemanticBindingMode: "graph-node-or-owned-callout",
  duplicateSemanticRepresentationMode: "fail-closed",
  maximumOwnedCalloutGapPx: 48,
  maximumIconLabelRevealDeltaFrames: 1,
  diagramWindowSize: 3,
  informationCardBorderMode: "full-outline",
  minimumInformationCardBorderWidthPx: 2,
  maximumInformationCardBorderWidthPx: 3,
  relationSurfaceConsistencyMode: "connected-component",
  relationSurfaceBoundaryMode: "explicit-semantic-subgroup-transition",
  openDiagramSurfaceRole: "open-canvas",
  cardTitleLineCount: 1,
  cardTitleWhiteSpace: "nowrap",
  cardTitleWordBreak: "keep-all",
  cardTitleOverflowWrap: "normal",
  cardTitleOverflowOrder: Object.freeze(["grow-card", "reflow-layout"])
});

export const EDITORIAL_VISUAL_ERROR_CODES = Object.freeze({
  SCENE_SCHEMA_INVALID: "editorial-scene-schema-invalid",
  SHAPE_GRAMMAR_VERSION_INVALID: "editorial-shape-grammar-version-invalid",
  VISUAL_MODE_INVALID: "editorial-visual-mode-invalid",
  MODE_CONTENT_MISMATCH: "editorial-mode-content-mismatch",
  CARD_SCHEMA_INVALID: "editorial-card-schema-invalid",
  CARD_TITLE_NOT_SINGLE_LINE: "editorial-card-title-not-single-line",
  CARD_TITLE_LAYOUT_INVALID: "editorial-card-title-layout-invalid",
  CARD_TITLE_OVERFLOW_UNRESOLVED: "editorial-card-title-overflow-unresolved",
  CARD_BORDER_INCOMPLETE: "editorial-card-border-incomplete",
  SURFACE_METADATA_INVALID: "editorial-surface-metadata-invalid",
  CARD_SURFACE_PURPOSE_INVALID: "editorial-card-surface-purpose-invalid",
  DIAGRAM_SURFACE_PURPOSE_INVALID: "editorial-diagram-surface-purpose-invalid",
  SURFACE_COHORT_MISMATCH: "editorial-surface-cohort-mismatch",
  RELATION_SURFACE_SCHEMA_INVALID: "editorial-relation-surface-schema-invalid",
  RELATION_SURFACE_COMPONENT_MISMATCH: "editorial-relation-surface-component-mismatch",
  RELATION_SURFACE_BOUNDARY_INVALID: "editorial-relation-surface-boundary-invalid",
  DIAGRAM_CLASSIFICATION_INVALID: "editorial-diagram-classification-invalid",
  MIXED_DIAGRAM_RELATION_MISSING: "editorial-mixed-diagram-relation-missing",
  CARD_LED_RATIO_EXCEEDED: "editorial-card-led-ratio-exceeded",
  CARD_LED_RUN_EXCEEDED: "editorial-card-led-run-exceeded",
  NARRATIVE_TREATMENT_INVALID: "editorial-narrative-treatment-invalid",
  NARRATIVE_TREATMENT_RATIONALE_MISSING:
    "editorial-narrative-treatment-rationale-missing",
  NARRATIVE_TREATMENT_EVIDENCE_INVALID:
    "editorial-narrative-treatment-evidence-invalid",
  NARRATIVE_DIVERSITY_INSUFFICIENT: "editorial-narrative-diversity-insufficient",
  NARRATIVE_TREATMENT_WINDOW_HOMOGENEOUS:
    "editorial-narrative-treatment-window-homogeneous",
  NARRATIVE_TREATMENT_RUN_EXCEEDED: "editorial-narrative-treatment-run-exceeded",
  SUBTITLE_PLAN_INVALID: "editorial-subtitle-plan-invalid",
  SUBTITLE_CUE_TOO_LONG: "editorial-subtitle-cue-too-long",
  SEMANTIC_BOUNDARY_SCHEMA_INVALID: "editorial-semantic-boundary-schema-invalid",
  SEMANTIC_BOUNDARY_MEANING_INVALID: "editorial-semantic-boundary-meaning-invalid",
  SEMANTIC_BOUNDARY_MEMBER_INVALID: "editorial-semantic-boundary-member-invalid",
  ICON_SCHEMA_INVALID: "editorial-icon-schema-invalid",
  ICON_PURPOSE_INVALID: "editorial-icon-purpose-invalid",
  ICON_PRESENTATION_INVALID: "editorial-icon-presentation-invalid",
  ICON_ANCHOR_INVALID: "editorial-icon-anchor-invalid",
  ICON_BINDING_INVALID: "editorial-icon-binding-invalid",
  ICON_DUPLICATE_SEMANTIC_OBJECT: "editorial-icon-duplicate-semantic-object",
  ICON_REMOTE_PLACEMENT_FORBIDDEN: "editorial-icon-remote-placement-forbidden",
  ICON_LABEL_SYNC_INVALID: "editorial-icon-label-sync-invalid",
  CARD_ICON_FORBIDDEN: "editorial-card-icon-forbidden",
  ICON_LIMIT_EXCEEDED: "editorial-icon-limit-exceeded",
  DIAGRAM_WINDOW_MISSING: "editorial-diagram-window-missing",
  TITLE_LAYOUT_INPUT_INVALID: "editorial-title-layout-input-invalid",
  TITLE_CANNOT_FIT_SINGLE_LINE: "editorial-title-cannot-fit-single-line"
});

export class EditorialVisualPolicyError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "EditorialVisualPolicyError";
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function makeIssue(code, message, location, details = null) {
  return Object.freeze({ code, message, location, details });
}

export function editorialSurfaceCohortKey(item) {
  if (!isObject(item) || !nonEmptyString(item.semanticGroupId) ||
      !nonEmptyString(item.semanticRole) ||
      !EDITORIAL_VISUAL_HIERARCHY_LEVELS.includes(item.visualHierarchyLevel)) {
    return null;
  }
  return `${item.semanticGroupId}::${item.semanticRole}::${item.visualHierarchyLevel}`;
}

export function editorialSurfacePurposeRationale(purpose) {
  return EDITORIAL_SURFACE_PURPOSE_RATIONALES[purpose] ?? null;
}

function validateSurfaceMetadata(item, location, expectedSurfaceRole, allowedPurposes, invalidPurposeCode) {
  const issues = [];
  if (
    !isObject(item) ||
    item.surfaceRole !== expectedSurfaceRole ||
    !nonEmptyString(item.semanticGroupId) ||
    !nonEmptyString(item.semanticRole) ||
    !EDITORIAL_VISUAL_HIERARCHY_LEVELS.includes(item.visualHierarchyLevel)
  ) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SURFACE_METADATA_INVALID,
      "视觉对象必须声明 semanticGroupId、语义角色、视觉层级和与实际承载一致的 surfaceRole",
      location,
      {
        semanticGroupId: item?.semanticGroupId ?? null,
        semanticRole: item?.semanticRole ?? null,
        visualHierarchyLevel: item?.visualHierarchyLevel ?? null,
        surfaceRole: item?.surfaceRole ?? null,
        expectedSurfaceRole
      }
    ));
  }
  if (!allowedPurposes.includes(item?.surfacePurpose)) {
    issues.push(makeIssue(
      invalidPurposeCode,
      expectedSurfaceRole === "information-card"
        ? "信息卡只能用于焦点结果、决策边界、可操作对象或状态容器"
        : "开放图解只能用于过程锚点、关系结构或转移输出",
      `${location}.surfacePurpose`,
      { purpose: item?.surfacePurpose ?? null, allowed: allowedPurposes }
    ));
  }
  if (editorialSurfacePurposeRationale(item?.surfacePurpose) == null) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SURFACE_METADATA_INVALID,
      "surfacePurpose 必须具有稳定的内容增强理由，不能以装饰为理由混用承载方式",
      `${location}.surfacePurpose`
    ));
  }
  return issues;
}

function titleLayoutContentWidth(cardWidthPx, horizontalPaddingPx, iconSlotWidthPx) {
  return cardWidthPx - horizontalPaddingPx - iconSlotWidthPx;
}

/**
 * Plans a one-line information-card title before rendering.
 *
 * `remainingRowWidthPx` is the unused width in the current row, while
 * `maximumCardWidthPx` is the width available after moving the card to a fresh
 * row. The planner therefore grows the card first when possible, then requests
 * a row reflow. It never returns a wrapping fallback.
 */
export function planEditorialCardTitleLayout({
  title,
  measuredTextWidthPx,
  currentCardWidthPx,
  remainingRowWidthPx,
  maximumCardWidthPx,
  horizontalPaddingPx = 48,
  iconSlotWidthPx = 0
}) {
  const numericInputValid = finitePositive(measuredTextWidthPx) &&
    finitePositive(currentCardWidthPx) &&
    finiteNonNegative(remainingRowWidthPx) &&
    finitePositive(maximumCardWidthPx) &&
    finiteNonNegative(horizontalPaddingPx) &&
    finiteNonNegative(iconSlotWidthPx);
  if (!nonEmptyString(title) || !numericInputValid) {
    throw new EditorialVisualPolicyError(
      EDITORIAL_VISUAL_ERROR_CODES.TITLE_LAYOUT_INPUT_INVALID,
      "卡片标题布局输入必须包含非空标题和有效像素尺寸",
      {
        title,
        measuredTextWidthPx,
        currentCardWidthPx,
        remainingRowWidthPx,
        maximumCardWidthPx,
        horizontalPaddingPx,
        iconSlotWidthPx
      }
    );
  }

  if (iconSlotWidthPx !== 0) {
    throw new EditorialVisualPolicyError(
      EDITORIAL_VISUAL_ERROR_CODES.CARD_ICON_FORBIDDEN,
      "信息卡内容必须保持纯文字，不得为标题前图标预留空间",
      { title, iconSlotWidthPx }
    );
  }

  const requiredCardWidthPx = Math.ceil(
    measuredTextWidthPx + horizontalPaddingPx + iconSlotWidthPx
  );
  const plannedCardWidthPx = Math.max(currentCardWidthPx, requiredCardWidthPx);
  if (plannedCardWidthPx > maximumCardWidthPx) {
    throw new EditorialVisualPolicyError(
      EDITORIAL_VISUAL_ERROR_CODES.TITLE_CANNOT_FIT_SINGLE_LINE,
      "标题在最大卡片宽度内仍无法单行容纳；应调整场景编排或文案，不得词内断行",
      {
        title,
        measuredTextWidthPx,
        requiredCardWidthPx,
        maximumCardWidthPx
      }
    );
  }

  const initialAvailableTextWidthPx = Math.max(0, titleLayoutContentWidth(
    currentCardWidthPx,
    horizontalPaddingPx,
    iconSlotWidthPx
  ));
  const finalAvailableTextWidthPx = titleLayoutContentWidth(
    plannedCardWidthPx,
    horizontalPaddingPx,
    iconSlotWidthPx
  );
  const action = plannedCardWidthPx > remainingRowWidthPx
    ? "reflow-layout"
    : requiredCardWidthPx > currentCardWidthPx
      ? "grow-card"
      : "keep";

  return Object.freeze({
    lineCount: EDITORIAL_VISUAL_POLICY.cardTitleLineCount,
    whiteSpace: EDITORIAL_VISUAL_POLICY.cardTitleWhiteSpace,
    wordBreak: EDITORIAL_VISUAL_POLICY.cardTitleWordBreak,
    overflowWrap: EDITORIAL_VISUAL_POLICY.cardTitleOverflowWrap,
    measuredTextWidthPx,
    initialAvailableTextWidthPx,
    finalAvailableTextWidthPx,
    requiredCardWidthPx,
    plannedCardWidthPx,
    action
  });
}

/**
 * Coordinates captions with a diagram build so viewers never have to read a
 * full sentence while also following changing nodes and connectors. The
 * caller supplies a semantic cue; this planner never truncates prose into an
 * arbitrary fragment.
 */
export function planEditorialSubtitlePresentation({
  phase,
  visibleNodeCount,
  visibleRelationCount,
  fullText,
  cueText = null
}) {
  const countsValid = Number.isSafeInteger(visibleNodeCount) && visibleNodeCount >= 0 &&
    Number.isSafeInteger(visibleRelationCount) && visibleRelationCount >= 0;
  if (!EDITORIAL_SUBTITLE_PHASES.includes(phase) || !countsValid || !nonEmptyString(fullText)) {
    throw new EditorialVisualPolicyError(
      EDITORIAL_VISUAL_ERROR_CODES.SUBTITLE_PLAN_INVALID,
      "字幕协调必须包含合法阶段、可见对象数量和完整字幕",
      { phase, visibleNodeCount, visibleRelationCount, fullText }
    );
  }

  const dense = visibleNodeCount >= EDITORIAL_VISUAL_POLICY.denseDiagramVisibleNodeThreshold ||
    visibleRelationCount >= EDITORIAL_VISUAL_POLICY.denseDiagramVisibleRelationThreshold;
  const effectivePhase = phase === "active-build" && dense ? "dense-build" : phase;
  const fullTextGraphemes = Array.from(fullText.trim()).length;
  const denseFinalHold = effectivePhase === "final-hold" && dense;
  const fragmentFinalHold = effectivePhase === "final-hold" &&
    fullTextGraphemes <= EDITORIAL_VISUAL_POLICY.maximumStandaloneFinalSubtitleGraphemes;
  const cueRequired = ["active-build", "dense-build"].includes(effectivePhase) ||
    denseFinalHold || fragmentFinalHold;
  if (cueRequired && !nonEmptyString(cueText)) {
    throw new EditorialVisualPolicyError(
      EDITORIAL_VISUAL_ERROR_CODES.SUBTITLE_PLAN_INVALID,
      "图解构建期间必须提供与当前语义步骤同步的短提示",
      { phase: effectivePhase, cueText }
    );
  }

  const cueGraphemes = nonEmptyString(cueText) ? Array.from(cueText.trim()).length : 0;
  if (cueRequired && cueGraphemes > EDITORIAL_VISUAL_POLICY.maximumSubtitleCueGraphemes) {
    throw new EditorialVisualPolicyError(
      EDITORIAL_VISUAL_ERROR_CODES.SUBTITLE_CUE_TOO_LONG,
      `图解构建提示不得超过 ${EDITORIAL_VISUAL_POLICY.maximumSubtitleCueGraphemes} 个字符`,
      { cueText, cueGraphemes }
    );
  }

  const cueMode = cueRequired;
  return Object.freeze({
    phase: effectivePhase,
    mode: cueMode
      ? denseFinalHold
        ? EDITORIAL_VISUAL_POLICY.denseFinalHoldSubtitleMode
        : EDITORIAL_VISUAL_POLICY.diagramBuildSubtitleMode
      : EDITORIAL_VISUAL_POLICY.preAndFinalSubtitleMode,
    text: cueMode ? cueText.trim() : fullText.trim(),
    visualWeight: cueMode ? "supporting" : "primary",
    opacity: cueMode ? 0.72 : 1,
    dense,
    denseFinalHold,
    fragmentFinalHold
  });
}

function validateCard(card, index) {
  const issues = [];
  const location = `cards[${index}]`;
  if (!isObject(card) || !nonEmptyString(card.id) || !nonEmptyString(card.title)) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.CARD_SCHEMA_INVALID,
      "信息卡必须包含非空 id 与 title",
      location
    ));
    return issues;
  }

  issues.push(...validateSurfaceMetadata(
    card,
    location,
    "information-card",
    EDITORIAL_CARD_SURFACE_PURPOSES,
    EDITORIAL_VISUAL_ERROR_CODES.CARD_SURFACE_PURPOSE_INVALID
  ));

  if (
    (nonEmptyString(card.conceptKind) && card.conceptKind !== "none") ||
    nonEmptyString(card.iconPurpose) ||
    (nonEmptyString(card.iconPresentation) && card.iconPresentation !== "none")
  ) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.CARD_ICON_FORBIDDEN,
      "信息卡必须是纯文字内容；图标只能作为卡片外的独立焦点或开放图解符号",
      `${location}.iconPresentation`,
      {
        conceptKind: card.conceptKind ?? null,
        iconPurpose: card.iconPurpose ?? null,
        iconPresentation: card.iconPresentation ?? null
      }
    ));
  }

  const layout = card.titleLayout;
  if (!isObject(layout)) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.CARD_TITLE_LAYOUT_INVALID,
      "信息卡必须声明可验证的单行标题布局",
      `${location}.titleLayout`
    ));
  } else {
    if (
      layout.lineCount !== EDITORIAL_VISUAL_POLICY.cardTitleLineCount ||
      layout.whiteSpace !== EDITORIAL_VISUAL_POLICY.cardTitleWhiteSpace ||
      layout.wordBreak !== EDITORIAL_VISUAL_POLICY.cardTitleWordBreak ||
      layout.overflowWrap !== EDITORIAL_VISUAL_POLICY.cardTitleOverflowWrap
    ) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.CARD_TITLE_NOT_SINGLE_LINE,
        "卡片标题必须保持单行，禁止词内断行",
        `${location}.titleLayout`
      ));
    }

    const layoutNumbersValid = finitePositive(layout.measuredTextWidthPx) &&
      finiteNonNegative(layout.initialAvailableTextWidthPx) &&
      finitePositive(layout.finalAvailableTextWidthPx);
    const actionValid = EDITORIAL_TITLE_LAYOUT_ACTIONS.includes(layout.action);
    if (!layoutNumbersValid || !actionValid) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.CARD_TITLE_LAYOUT_INVALID,
        "标题布局必须声明测量宽度、初始/最终可用宽度和合法编排动作",
        `${location}.titleLayout`
      ));
    } else {
      const initiallyOverflowed = layout.measuredTextWidthPx > layout.initialAvailableTextWidthPx;
      const finallyOverflowed = layout.measuredTextWidthPx > layout.finalAvailableTextWidthPx;
      const overflowActionUsed = EDITORIAL_VISUAL_POLICY.cardTitleOverflowOrder.includes(
        layout.action
      );
      if (finallyOverflowed || (initiallyOverflowed && !overflowActionUsed)) {
        issues.push(makeIssue(
          EDITORIAL_VISUAL_ERROR_CODES.CARD_TITLE_OVERFLOW_UNRESOLVED,
          "标题空间不足时必须加宽卡片或重排布局，并在最终布局中完整单行显示",
          `${location}.titleLayout`,
          {
            measuredTextWidthPx: layout.measuredTextWidthPx,
            initialAvailableTextWidthPx: layout.initialAvailableTextWidthPx,
            finalAvailableTextWidthPx: layout.finalAvailableTextWidthPx,
            action: layout.action
          }
        ));
      }
    }
  }

  const border = card.border;
  if (
    !isObject(border) ||
    border.mode !== EDITORIAL_VISUAL_POLICY.informationCardBorderMode ||
    !Number.isFinite(border.widthPx) ||
    border.widthPx < EDITORIAL_VISUAL_POLICY.minimumInformationCardBorderWidthPx ||
    border.widthPx > EDITORIAL_VISUAL_POLICY.maximumInformationCardBorderWidthPx
  ) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.CARD_BORDER_INCOMPLETE,
      "信息卡必须使用 2–3px 的完整闭合边框",
      `${location}.border`
    ));
  }
  return issues;
}

function validateDiagram(diagram, index) {
  const location = `diagrams[${index}]`;
  const issues = [];
  if (
    !isObject(diagram) ||
    !nonEmptyString(diagram.id) ||
    diagram.kind !== "open-diagram" ||
    diagram.informationCard !== false ||
    diagram.surfaceRole !== EDITORIAL_VISUAL_POLICY.openDiagramSurfaceRole
  ) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.DIAGRAM_CLASSIFICATION_INVALID,
      "开放图解必须明确声明为 open-diagram/open-canvas，且不得计作信息卡",
      location
    ));
  }
  if (isObject(diagram)) {
    issues.push(...validateSurfaceMetadata(
      diagram,
      location,
      "open-canvas",
      EDITORIAL_OPEN_SURFACE_PURPOSES,
      EDITORIAL_VISUAL_ERROR_CODES.DIAGRAM_SURFACE_PURPOSE_INVALID
    ));
  }
  return issues;
}

function validateSurfaceHierarchy(cards, diagrams) {
  const entries = [
    ...cards.map((item, index) => ({ item, location: `cards[${index}]` })),
    ...diagrams.map((item, index) => ({ item, location: `diagrams[${index}]` }))
  ];
  const byCohort = new Map();
  for (const entry of entries) {
    const key = editorialSurfaceCohortKey(entry.item);
    if (key == null || !EDITORIAL_SURFACE_ROLES.includes(entry.item?.surfaceRole)) continue;
    const cohort = byCohort.get(key) ?? [];
    cohort.push(entry);
    byCohort.set(key, cohort);
  }
  return [...byCohort.entries()].flatMap(([cohortKey, cohort]) => {
    const surfaceRoles = [...new Set(cohort.map(({ item }) => item.surfaceRole))];
    if (surfaceRoles.length <= 1) return [];
    return [makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SURFACE_COHORT_MISMATCH,
      "同一语义组、语义角色与视觉层级中的对象必须使用同一种承载方式",
      "surfaces",
      {
        cohortKey,
        semanticGroupId: cohort[0]?.item?.semanticGroupId ?? null,
        surfaceRoles,
        members: cohort.map(({ item, location }) => ({
          id: item.id,
          location,
          semanticGroupId: item.semanticGroupId,
          surfaceRole: item.surfaceRole
        }))
      }
    )];
  });
}

/**
 * Keeps one connected explanatory path on one visual carrier. A scene may
 * still combine cards and open diagrams when they are disconnected semantic
 * subgroups, or when a relation explicitly declares a meaningful subgroup
 * transition. This prevents arbitrary carrier changes without imposing a
 * scene-wide "all cards" / "all open" rule.
 */
export function validateEditorialRelationSurfaceConsistency({
  cards = [],
  diagrams = [],
  relations = []
} = {}) {
  const issues = [];
  const surfaces = [...cards, ...diagrams].filter(isObject);
  const surfaceById = new Map(
    surfaces.filter((item) => nonEmptyString(item.id)).map((item) => [item.id, item])
  );
  const parentById = new Map([...surfaceById.keys()].map((id) => [id, id]));

  const find = (id) => {
    let current = id;
    while (parentById.get(current) !== current) {
      current = parentById.get(current);
    }
    let cursor = id;
    while (parentById.get(cursor) !== current) {
      const next = parentById.get(cursor);
      parentById.set(cursor, current);
      cursor = next;
    }
    return current;
  };
  const union = (from, to) => {
    const fromRoot = find(from);
    const toRoot = find(to);
    if (fromRoot !== toRoot) parentById.set(toRoot, fromRoot);
  };

  relations.forEach((relation, index) => {
    const location = `relations[${index}]`;
    const fromSurface = surfaceById.get(relation?.from);
    const toSurface = surfaceById.get(relation?.to);
    if (
      !isObject(relation) ||
      !nonEmptyString(relation.id) ||
      !nonEmptyString(relation.from) ||
      !nonEmptyString(relation.to) ||
      !fromSurface ||
      !toSurface
    ) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.RELATION_SURFACE_SCHEMA_INVALID,
        "关系必须包含非空 id、有效 from 与有效 to，且两端都属于受治理视觉对象",
        location,
        {
          id: relation?.id ?? null,
          from: relation?.from ?? null,
          to: relation?.to ?? null
        }
      ));
      return;
    }

    let validBoundary = false;
    if (relation.surfaceBoundary != null) {
      const boundary = relation.surfaceBoundary;
      validBoundary = isObject(boundary) &&
        boundary.kind === "semantic-subgroup-transition" &&
        boundary.cue === "surface-change" &&
        nonEmptyString(boundary.rationale) &&
        fromSurface.semanticGroupId !== toSurface.semanticGroupId &&
        fromSurface.surfaceRole !== toSurface.surfaceRole;
      if (!validBoundary) {
        issues.push(makeIssue(
          EDITORIAL_VISUAL_ERROR_CODES.RELATION_SURFACE_BOUNDARY_INVALID,
          "承载方式切换只能发生在明确的语义子组转换处，并必须说明它如何增强理解",
          `${location}.surfaceBoundary`,
          {
            boundary,
            from: {
              id: fromSurface.id,
              semanticGroupId: fromSurface.semanticGroupId,
              surfaceRole: fromSurface.surfaceRole
            },
            to: {
              id: toSurface.id,
              semanticGroupId: toSurface.semanticGroupId,
              surfaceRole: toSurface.surfaceRole
            }
          }
        ));
      }
    }
    if (!validBoundary) union(relation.from, relation.to);
  });

  const components = new Map();
  for (const surface of surfaces) {
    if (!nonEmptyString(surface.id) || !parentById.has(surface.id)) continue;
    const root = find(surface.id);
    const members = components.get(root) ?? [];
    members.push(surface);
    components.set(root, members);
  }
  for (const members of components.values()) {
    const surfaceRoles = [...new Set(members.map((item) => item.surfaceRole))];
    if (surfaceRoles.length <= 1) continue;
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.RELATION_SURFACE_COMPONENT_MISMATCH,
      "同一条连续关系路径必须使用同一种承载方式；不要在主流程中随机混用卡片和开放节点",
      "relations",
      {
        surfaceRoles,
        members: members.map((item) => ({
          id: item.id,
          semanticGroupId: item.semanticGroupId,
          semanticRole: item.semanticRole,
          surfaceRole: item.surfaceRole
        }))
      }
    ));
  }
  return issues;
}

function validateIcon(icon, index, { validAnchorIds, cardIds, diagramIds }) {
  const issues = [];
  const location = `icons[${index}]`;
  if (
    !isObject(icon) ||
    !nonEmptyString(icon.id) ||
    !nonEmptyString(icon.conceptKind) ||
    !nonEmptyString(icon.semanticObjectId) ||
    !nonEmptyString(icon.participation) ||
    !nonEmptyString(icon.anchorId)
  ) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.ICON_SCHEMA_INVALID,
      "独立图标必须包含 id、conceptKind、semanticObjectId、participation 与 anchorId",
      location
    ));
    return issues;
  }
  if (!EDITORIAL_ICON_PURPOSES.includes(icon.purpose)) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.ICON_PURPOSE_INVALID,
      "图标只能用于语义锚点、状态证明或交互提示",
      `${location}.purpose`,
      { purpose: icon.purpose, allowed: EDITORIAL_ICON_PURPOSES }
    ));
  }
  if (!EDITORIAL_ICON_PRESENTATIONS.includes(icon.presentation)) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.ICON_PRESENTATION_INVALID,
      "图标只能作为独立焦点或开放图解符号，不能嵌入卡片标题或正文",
      `${location}.presentation`,
      { presentation: icon.presentation, allowed: EDITORIAL_ICON_PRESENTATIONS }
    ));
  }
  if (!validAnchorIds.has(icon.anchorId)) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.ICON_ANCHOR_INVALID,
      "独立图标的 anchorId 必须指向本场已有语义对象",
      `${location}.anchorId`,
      { anchorId: icon.anchorId }
    ));
  }
  if (typeof icon.placement === "string" && icon.placement.endsWith("-rail")) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.ICON_REMOTE_PLACEMENT_FORBIDDEN,
      "生产图标不得放进与语义对象脱离的远端边栏",
      `${location}.placement`,
      { placement: icon.placement }
    ));
  }
  if (
    !Number.isInteger(icon.labelRevealDeltaFrames) ||
    icon.labelRevealDeltaFrames < 0 ||
    icon.labelRevealDeltaFrames > EDITORIAL_VISUAL_POLICY.maximumIconLabelRevealDeltaFrames
  ) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.ICON_LABEL_SYNC_INVALID,
      `图标和文字首次可见帧差不得超过 ${EDITORIAL_VISUAL_POLICY.maximumIconLabelRevealDeltaFrames} 帧`,
      `${location}.labelRevealDeltaFrames`,
      { labelRevealDeltaFrames: icon.labelRevealDeltaFrames }
    ));
  }
  if (icon.participation === "graph-node") {
    if (
      icon.semanticObjectId !== icon.anchorId ||
      nonEmptyString(icon.ownerId) ||
      !diagramIds.has(icon.anchorId) ||
      icon.layoutRole !== "semantic-icon-node" ||
      icon.placement !== "anchor-bounds"
    ) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.ICON_BINDING_INVALID,
        "关系图图标必须替代开放图解中的同一语义节点，并继承该节点的连接关系",
        location,
        {
          semanticObjectId: icon.semanticObjectId,
          anchorId: icon.anchorId,
          ownerId: icon.ownerId ?? null,
          layoutRole: icon.layoutRole,
          placement: icon.placement
        }
      ));
    }
  } else if (icon.participation === "owned-callout") {
    if (
      !nonEmptyString(icon.ownerId) ||
      icon.ownerId !== icon.anchorId ||
      !validAnchorIds.has(icon.ownerId) ||
      icon.layoutRole !== "owned-icon-callout" ||
      !["right-center", "left-center", "above-center", "below-center"].includes(icon.placement) ||
      !finiteNonNegative(icon.maximumGapPx) ||
      icon.maximumGapPx > EDITORIAL_VISUAL_POLICY.maximumOwnedCalloutGapPx
    ) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.ICON_BINDING_INVALID,
        "补充图标必须在 48px 内明确归属于一个场内 owner，且不能嵌入卡片",
        location,
        {
          ownerId: icon.ownerId ?? null,
          anchorId: icon.anchorId,
          maximumGapPx: icon.maximumGapPx,
          layoutRole: icon.layoutRole,
          placement: icon.placement
        }
      ));
    }
  } else if (icon.participation === "dedicated-focus") {
    if (
      nonEmptyString(icon.ownerId) ||
      icon.layoutRole !== "dedicated-icon-focus" ||
      icon.placement !== "dedicated-focus"
    ) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.ICON_BINDING_INVALID,
        "专门焦点图标不得绑定普通卡片或关系节点",
        location
      ));
    }
  } else {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.ICON_BINDING_INVALID,
      "图标 participation 只能是 graph-node、owned-callout 或 dedicated-focus",
      `${location}.participation`,
      { participation: icon.participation }
    ));
  }
  if (icon.participation === "graph-node" && cardIds.has(icon.anchorId)) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.CARD_ICON_FORBIDDEN,
      "关系节点图标不能替代信息卡；请改为开放图解节点或近距归属标注",
      `${location}.anchorId`,
      { anchorId: icon.anchorId }
    ));
  }
  return issues;
}

function validateModeContent(scene, cards, diagrams) {
  const cardCount = cards.length;
  const diagramCount = diagrams.length;
  const valid = (
    (scene.visualMode === "text-led" && cardCount === 0 && diagramCount === 0) ||
    (scene.visualMode === "card-led" && cardCount > 0 && diagramCount === 0) ||
    (scene.visualMode === "open-diagram" && cardCount === 0 && diagramCount > 0) ||
    (scene.visualMode === "mixed-diagram" && cardCount > 0 && diagramCount > 0)
  );
  return valid ? [] : [makeIssue(
    EDITORIAL_VISUAL_ERROR_CODES.MODE_CONTENT_MISMATCH,
    "visualMode 必须与信息卡和开放图解的实际组成一致",
    "visualMode",
    { visualMode: scene.visualMode, cardCount, diagramCount }
  )];
}

function validateMixedDiagramRelation(scene, diagrams) {
  if (scene.visualMode !== "mixed-diagram" ||
      EDITORIAL_VISUAL_POLICY.mixedDiagramMustCarryRelation !== true) {
    return [];
  }
  const relationDiagramIds = diagrams
    .filter((diagram) => diagram?.carriesRelation === true)
    .map((diagram) => diagram.id ?? null);
  if (relationDiagramIds.length > 0) return [];
  return [makeIssue(
    EDITORIAL_VISUAL_ERROR_CODES.MIXED_DIAGRAM_RELATION_MISSING,
    "mixed-diagram 必须包含至少一个 carriesRelation=true 的开放图解；独立图标不能替代关系图解",
    "diagrams",
    {
      diagramIds: diagrams.map((diagram) => diagram?.id ?? null),
      iconCountIgnored: Array.isArray(scene.icons) ? scene.icons.length : 0
    }
  )];
}

function validateNarrativeTreatmentEvidence(scene, cards, diagrams, relations) {
  const issues = [];
  const treatment = scene.narrativeTreatment;
  if (treatment === EDITORIAL_NARRATIVE_TREATMENT_NONE) {
    if (scene.treatmentEvidence != null) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_EVIDENCE_INVALID,
        "不适用解释方式的场景不得伪造图解证据",
        "treatmentEvidence"
      ));
    }
    return issues;
  }

  const requirement = EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS[treatment];
  if (!requirement) return issues;
  const evidence = scene.treatmentEvidence;
  if (
    !isObject(evidence) ||
    evidence.mechanism !== requirement.mechanism ||
    !Array.isArray(evidence.visibleElementIds) ||
    !Array.isArray(evidence.relationIds) ||
    !nonEmptyString(evidence.contentContribution)
  ) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_EVIDENCE_INVALID,
      "解释方式必须绑定真实可见对象、真实关系和内容贡献，不能只写一个类型标签",
      "treatmentEvidence",
      { treatment, expectedMechanism: requirement.mechanism }
    ));
    return issues;
  }

  const visibleElementIds = evidence.visibleElementIds;
  const relationIds = evidence.relationIds;
  const idsAreUnique = new Set(visibleElementIds).size === visibleElementIds.length &&
    new Set(relationIds).size === relationIds.length;
  const idsAreStrings = visibleElementIds.every(nonEmptyString) && relationIds.every(nonEmptyString);
  const surfaceById = new Map([...cards, ...diagrams].map((item) => [item.id, item]));
  const relationById = new Map(relations.map((item) => [item?.id, item]));
  const selectedSurfaces = visibleElementIds.map((id) => surfaceById.get(id));
  const selectedRelations = relationIds.map((id) => relationById.get(id));
  const referencesExist = selectedSurfaces.every(isObject) && selectedRelations.every(isObject);
  const selectedIdSet = new Set(visibleElementIds);
  const relationsStayInsideEvidence = selectedRelations.every((relation) =>
    isObject(relation) &&
    selectedIdSet.has(relation.from) &&
    selectedIdSet.has(relation.to) &&
    nonEmptyString(relation.semanticType)
  );
  const selectedRoles = new Set(selectedSurfaces.map((surface) => surface?.semanticRole));
  const selectedRelationTypes = new Set(
    selectedRelations.map((relation) => relation?.semanticType).filter(nonEmptyString)
  );
  const roleSignatureMatches = requirement.roleSignatures.length === 0 ||
    requirement.roleSignatures.some((signature) =>
      signature.every((semanticRole) => selectedRoles.has(semanticRole))
    );
  const relationTypeMatches = requirement.requiredRelationTypes.some((semanticType) =>
    selectedRelationTypes.has(semanticType)
  );
  const topologyMeetsMinimum =
    visibleElementIds.length >= requirement.minimumVisibleElements &&
    relationIds.length >= requirement.minimumRelations;

  if (
    !idsAreUnique ||
    !idsAreStrings ||
    !referencesExist ||
    !relationsStayInsideEvidence ||
    !topologyMeetsMinimum ||
    !roleSignatureMatches ||
    !relationTypeMatches
  ) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_EVIDENCE_INVALID,
      "解释方式证据必须引用场内真实对象和带语义类型的关系，并满足该教学方式的可见拓扑",
      "treatmentEvidence",
      {
        treatment,
        mechanism: evidence.mechanism,
        minimumVisibleElements: requirement.minimumVisibleElements,
        minimumRelations: requirement.minimumRelations,
        visibleElementIds,
        relationIds,
        selectedRoles: [...selectedRoles],
        selectedRelationTypes: [...selectedRelationTypes],
        requiredRelationTypes: requirement.requiredRelationTypes
      }
    ));
  }
  return issues;
}

function validateSemanticBoundaries(semanticBoundaries, cards, diagrams) {
  const issues = [];
  const cardIds = new Set(cards.filter(isObject).map((item) => item.id));
  const diagramById = new Map(
    diagrams.filter(isObject).map((item) => [item.id, item])
  );
  const boundaryByMemberId = new Map();
  const boundaryIds = new Set();

  semanticBoundaries.forEach((boundary, index) => {
    const location = `semanticBoundaries[${index}]`;
    if (
      !isObject(boundary) ||
      !nonEmptyString(boundary.id) ||
      boundaryIds.has(boundary.id) ||
      !Array.isArray(boundary.memberIds) ||
      boundary.memberIds.length === 0 ||
      new Set(boundary.memberIds).size !== boundary.memberIds.length ||
      !boundary.memberIds.every(nonEmptyString) ||
      !nonEmptyString(boundary.rationale)
    ) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.SEMANTIC_BOUNDARY_SCHEMA_INVALID,
        "虚线边界必须包含唯一 id、非空成员和内容理由，不能作为装饰",
        location
      ));
      return;
    }
    boundaryIds.add(boundary.id);
    if (!EDITORIAL_SHAPE_GRAMMAR.semanticBoundary.allowedMeanings.includes(boundary.meaning)) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.SEMANTIC_BOUNDARY_MEANING_INVALID,
        "虚线只允许表达范围、排除、待验证或风险边界",
        `${location}.meaning`,
        { meaning: boundary.meaning }
      ));
    }
    for (const memberId of boundary.memberIds) {
      const diagram = diagramById.get(memberId);
      const duplicateOwner = boundaryByMemberId.has(memberId);
      if (
        !diagram ||
        cardIds.has(memberId) ||
        duplicateOwner ||
        diagram.shapeGrammarRole !== "semantic-boundary" ||
        diagram.shapeGrammarVisualForm !== EDITORIAL_SHAPE_GRAMMAR.semanticBoundary.visualForm ||
        diagram.shapeGrammarMeaning !== boundary.meaning
      ) {
        issues.push(makeIssue(
          EDITORIAL_VISUAL_ERROR_CODES.SEMANTIC_BOUNDARY_MEMBER_INVALID,
          "虚线边界成员必须是唯一的开放语义边界，信息卡和普通分组不能改画虚线",
          `${location}.memberIds`,
          { memberId }
        ));
        continue;
      }
      boundaryByMemberId.set(memberId, boundary.id);
    }
  });

  for (const card of cards) {
    if (
      card?.shapeGrammarRole === "semantic-boundary" ||
      card?.shapeGrammarVisualForm === EDITORIAL_SHAPE_GRAMMAR.semanticBoundary.visualForm
    ) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.SEMANTIC_BOUNDARY_MEMBER_INVALID,
        "信息卡必须保持完整实线边框，不得借虚线表达范围",
        `cards.${card?.id ?? "unknown"}`
      ));
    }
  }
  for (const diagram of diagrams) {
    const declaresBoundary = diagram?.shapeGrammarRole === "semantic-boundary" ||
      diagram?.shapeGrammarVisualForm === EDITORIAL_SHAPE_GRAMMAR.semanticBoundary.visualForm;
    if (declaresBoundary && !boundaryByMemberId.has(diagram.id)) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.SEMANTIC_BOUNDARY_MEMBER_INVALID,
        "每一个可见虚线边界都必须有可检测语义声明",
        `diagrams.${diagram?.id ?? "unknown"}`
      ));
    }
  }
  return issues;
}

/**
 * Validates one long-video editorial scene. Arrays describe only governed
 * editorial structures; decorative background primitives are intentionally
 * outside this contract.
 */
export function validateEditorialScene(scene, options = {}) {
  const maximumIconsPerScene = options.maximumIconsPerScene ??
    EDITORIAL_VISUAL_POLICY.maximumIconsPerLongVideoScene;
  if (!isObject(scene)) {
    const issues = [makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "场景必须是对象",
      "scene"
    )];
    return Object.freeze({ valid: false, issues: Object.freeze(issues) });
  }

  const issues = [];
  if (!nonEmptyString(scene.id)) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "场景必须包含非空 id",
      "id"
    ));
  }
  if (scene.shapeGrammarVersion !== EDITORIAL_SHAPE_GRAMMAR_VERSION) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SHAPE_GRAMMAR_VERSION_INVALID,
      "场景必须绑定统一的可见形状语法版本",
      "shapeGrammarVersion",
      {
        actual: scene.shapeGrammarVersion ?? null,
        expected: EDITORIAL_SHAPE_GRAMMAR_VERSION
      }
    ));
  }
  if (!EDITORIAL_VISUAL_MODES.includes(scene.visualMode)) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.VISUAL_MODE_INVALID,
      "场景必须声明 text-led、card-led、open-diagram 或 mixed-diagram",
      "visualMode",
      { visualMode: scene.visualMode, allowed: EDITORIAL_VISUAL_MODES }
    ));
  }
  if (
    scene.narrativeTreatment !== EDITORIAL_NARRATIVE_TREATMENT_NONE &&
    !EDITORIAL_NARRATIVE_TREATMENTS.includes(scene.narrativeTreatment)
  ) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_INVALID,
      "场景必须声明一种可复用的解释方式，不能只声明卡片或图解承载形式",
      "narrativeTreatment",
      {
        narrativeTreatment: scene.narrativeTreatment ?? null,
        allowed: [...EDITORIAL_NARRATIVE_TREATMENTS, EDITORIAL_NARRATIVE_TREATMENT_NONE]
      }
    ));
  }
  if (!nonEmptyString(scene.narrativeTreatmentRationale)) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_RATIONALE_MISSING,
      "场景必须说明图解怎样增强当前内容的理解，不能只写具体图案画法",
      "narrativeTreatmentRationale"
    ));
  }

  const cards = Array.isArray(scene.cards) ? scene.cards : [];
  const diagrams = Array.isArray(scene.diagrams) ? scene.diagrams : [];
  const icons = Array.isArray(scene.icons) ? scene.icons : [];
  const relations = Array.isArray(scene.relations) ? scene.relations : [];
  const semanticBoundaries = Array.isArray(scene.semanticBoundaries)
    ? scene.semanticBoundaries
    : [];
  if (
    !Array.isArray(scene.cards) ||
    !Array.isArray(scene.diagrams) ||
    !Array.isArray(scene.icons) ||
    !Array.isArray(scene.relations) ||
    !Array.isArray(scene.semanticBoundaries)
  ) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "场景必须显式提供 cards、diagrams、icons、relations 与 semanticBoundaries 数组",
      "scene"
    ));
  }

  cards.forEach((card, index) => issues.push(...validateCard(card, index)));
  diagrams.forEach((diagram, index) => issues.push(...validateDiagram(diagram, index)));
  issues.push(...validateNarrativeTreatmentEvidence(scene, cards, diagrams, relations));
  issues.push(...validateSemanticBoundaries(semanticBoundaries, cards, diagrams));
  issues.push(...validateSurfaceHierarchy(cards, diagrams));
  issues.push(...validateEditorialRelationSurfaceConsistency({ cards, diagrams, relations }));
  if (EDITORIAL_VISUAL_MODES.includes(scene.visualMode)) {
    issues.push(...validateModeContent(scene, cards, diagrams));
    issues.push(...validateMixedDiagramRelation(scene, diagrams));
  }

  const cardIds = new Set(cards.filter(isObject).map((card) => card.id).filter(nonEmptyString));
  const diagramIds = new Set(diagrams.filter(isObject).map((diagram) => diagram.id).filter(nonEmptyString));
  const validAnchorIds = new Set([...cardIds, ...diagramIds]);
  icons.forEach((icon, index) => {
    issues.push(...validateIcon(icon, index, { validAnchorIds, cardIds, diagramIds }));
  });
  const semanticObjectIds = icons
    .filter(isObject)
    .map((icon) => icon.semanticObjectId)
    .filter(nonEmptyString);
  const duplicateSemanticObjectIds = [...new Set(semanticObjectIds.filter(
    (semanticObjectId, index) => semanticObjectIds.indexOf(semanticObjectId) !== index
  ))];
  if (duplicateSemanticObjectIds.length > 0) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.ICON_DUPLICATE_SEMANTIC_OBJECT,
      "同一语义对象只能有一个图标主表现",
      "icons",
      { semanticObjectIds: duplicateSemanticObjectIds }
    ));
  }

  if (!Number.isSafeInteger(maximumIconsPerScene) || maximumIconsPerScene < 0) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "maximumIconsPerScene 必须是非负整数",
      "options.maximumIconsPerScene"
    ));
  } else if (icons.length > maximumIconsPerScene) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.ICON_LIMIT_EXCEEDED,
      `长视频单场最多使用 ${maximumIconsPerScene} 个解释性图标`,
      "icons",
      { actual: icons.length, maximum: maximumIconsPerScene }
    ));
  }

  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues)
  });
}

/**
 * Validates scene-level rules and the visual rhythm of a complete sequence.
 * The ai-tech-longform profile limits card-led scenes to half the sequence,
 * forbids adjacent card-led scenes and requires each complete sliding window
 * to contain an open or relationship-bearing mixed diagram scene.
 */
export function validateEditorialSequence(scenes, options = {}) {
  if (!Array.isArray(scenes)) {
    const issues = [makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "场景序列必须是数组",
      "scenes"
    )];
    return Object.freeze({ valid: false, issues: Object.freeze(issues), sceneReviews: Object.freeze([]) });
  }

  const windowSize = options.diagramWindowSize ?? EDITORIAL_VISUAL_POLICY.diagramWindowSize;
  const maximumCardLedSceneRatio = options.maximumCardLedSceneRatio ??
    EDITORIAL_VISUAL_POLICY.maximumCardLedSceneRatio;
  const maximumConsecutiveCardLedScenes = options.maximumConsecutiveCardLedScenes ??
    EDITORIAL_VISUAL_POLICY.maximumConsecutiveCardLedScenes;
  const minimumNarrativeTreatments = options.minimumNarrativeTreatments ??
    EDITORIAL_VISUAL_POLICY.minimumNarrativeTreatmentsPerLongformSequence;
  const minimumNarrativeDiversitySequenceLength = options.minimumNarrativeDiversitySequenceLength ??
    EDITORIAL_VISUAL_POLICY.minimumNarrativeDiversitySequenceLength;
  const narrativeTreatmentWindowSize = options.narrativeTreatmentWindowSize ??
    EDITORIAL_VISUAL_POLICY.narrativeTreatmentWindowSize;
  const maximumConsecutiveSameNarrativeTreatment =
    options.maximumConsecutiveSameNarrativeTreatment ??
    EDITORIAL_VISUAL_POLICY.maximumConsecutiveSameNarrativeTreatment;
  const sceneReviews = scenes.map((scene) => validateEditorialScene(scene, options));
  const issues = sceneReviews.flatMap((review, index) => review.issues.map((item) => Object.freeze({
    ...item,
    location: `scenes[${index}].${item.location}`
  })));
  const evidenceBackedTreatments = scenes.map((scene, index) => {
    const treatment = scene?.narrativeTreatment;
    if (!EDITORIAL_NARRATIVE_TREATMENTS.includes(treatment)) return null;
    const treatmentInvalid = sceneReviews[index].issues.some((item) => [
      EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_INVALID,
      EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_RATIONALE_MISSING,
      EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_EVIDENCE_INVALID
    ].includes(item.code));
    return treatmentInvalid ? null : treatment;
  });

  if (!Number.isSafeInteger(windowSize) || windowSize < 1) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "diagramWindowSize 必须是正整数",
      "options.diagramWindowSize"
    ));
  } else {
    for (let start = 0; start + windowSize <= scenes.length; start += 1) {
      const window = scenes.slice(start, start + windowSize);
      const hasDiagramScene = window.some((scene) => {
        if (scene?.visualMode === "open-diagram") return true;
        if (scene?.visualMode !== "mixed-diagram" || !Array.isArray(scene.diagrams)) return false;
        return scene.diagrams.some((diagram) => diagram?.carriesRelation === true);
      });
      if (!hasDiagramScene) {
        issues.push(makeIssue(
          EDITORIAL_VISUAL_ERROR_CODES.DIAGRAM_WINDOW_MISSING,
          `连续 ${windowSize} 场中至少一场必须采用 open-diagram 或真正承载关系的 mixed-diagram`,
          `scenes[${start}..${start + windowSize - 1}]`,
          { sceneIds: window.map((scene) => scene?.id ?? null) }
        ));
      }
    }
  }

  if (!Number.isFinite(maximumCardLedSceneRatio) ||
      maximumCardLedSceneRatio < 0 || maximumCardLedSceneRatio > 1) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "maximumCardLedSceneRatio 必须是 0 到 1 之间的数字",
      "options.maximumCardLedSceneRatio"
    ));
  } else if (scenes.length > 0) {
    const cardLedSceneIds = scenes
      .filter((scene) => scene?.visualMode === "card-led")
      .map((scene) => scene?.id ?? null);
    const ratio = cardLedSceneIds.length / scenes.length;
    if (ratio > maximumCardLedSceneRatio) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.CARD_LED_RATIO_EXCEEDED,
        `ai-tech-longform 中 card-led 场景占比不得超过 ${maximumCardLedSceneRatio}`,
        "scenes",
        {
          actualRatio: ratio,
          maximumRatio: maximumCardLedSceneRatio,
          cardLedSceneIds,
          totalScenes: scenes.length
        }
      ));
    }
  }

  if (!Number.isSafeInteger(maximumConsecutiveCardLedScenes) ||
      maximumConsecutiveCardLedScenes < 0) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "maximumConsecutiveCardLedScenes 必须是非负整数",
      "options.maximumConsecutiveCardLedScenes"
    ));
  } else {
    let runStart = -1;
    let runLength = 0;
    for (let index = 0; index <= scenes.length; index += 1) {
      if (scenes[index]?.visualMode === "card-led") {
        if (runLength === 0) runStart = index;
        runLength += 1;
        continue;
      }
      if (runLength > maximumConsecutiveCardLedScenes) {
        issues.push(makeIssue(
          EDITORIAL_VISUAL_ERROR_CODES.CARD_LED_RUN_EXCEEDED,
          `ai-tech-longform 最多连续 ${maximumConsecutiveCardLedScenes} 个 card-led 场景`,
          `scenes[${runStart}..${runStart + runLength - 1}]`,
          {
            actualRunLength: runLength,
            maximumRunLength: maximumConsecutiveCardLedScenes,
            sceneIds: scenes
              .slice(runStart, runStart + runLength)
              .map((scene) => scene?.id ?? null)
          }
        ));
      }
      runStart = -1;
      runLength = 0;
    }
  }

  const narrativeDiversityApplies = Number.isSafeInteger(
    minimumNarrativeDiversitySequenceLength
  ) && minimumNarrativeDiversitySequenceLength > 0 &&
    scenes.length >= minimumNarrativeDiversitySequenceLength;
  if (!Number.isSafeInteger(minimumNarrativeDiversitySequenceLength) ||
      minimumNarrativeDiversitySequenceLength < 1) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "minimumNarrativeDiversitySequenceLength 必须是正整数",
      "options.minimumNarrativeDiversitySequenceLength"
    ));
  }
  if (!Number.isSafeInteger(minimumNarrativeTreatments) || minimumNarrativeTreatments < 1) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "minimumNarrativeTreatments 必须是正整数",
      "options.minimumNarrativeTreatments"
    ));
  } else if (narrativeDiversityApplies) {
    const treatments = evidenceBackedTreatments.filter(nonEmptyString);
    const distinctTreatments = [...new Set(treatments)];
    if (distinctTreatments.length < minimumNarrativeTreatments) {
      issues.push(makeIssue(
        EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_DIVERSITY_INSUFFICIENT,
        `ai-tech-longform 至少需要 ${minimumNarrativeTreatments} 种解释方式，避免整片退化为同一种卡片和箭头`,
        "scenes",
        {
          actual: distinctTreatments,
          expectedMinimum: minimumNarrativeTreatments
        }
      ));
    }
  }

  if (!Number.isSafeInteger(narrativeTreatmentWindowSize) || narrativeTreatmentWindowSize < 2) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "narrativeTreatmentWindowSize 必须是至少 2 的整数",
      "options.narrativeTreatmentWindowSize"
    ));
  } else if (narrativeDiversityApplies) {
    for (let start = 0; start + narrativeTreatmentWindowSize <= scenes.length; start += 1) {
      const window = scenes.slice(start, start + narrativeTreatmentWindowSize);
      const treatments = evidenceBackedTreatments
        .slice(start, start + narrativeTreatmentWindowSize)
        .filter(nonEmptyString);
      if (treatments.length === window.length && new Set(treatments).size === 1) {
        issues.push(makeIssue(
          EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_WINDOW_HOMOGENEOUS,
          `连续 ${narrativeTreatmentWindowSize} 场不能全部使用同一种解释方式`,
          `scenes[${start}..${start + narrativeTreatmentWindowSize - 1}]`,
          {
            treatment: treatments[0],
            sceneIds: window.map((scene) => scene?.id ?? null)
          }
        ));
      }
    }
  }

  if (!Number.isSafeInteger(maximumConsecutiveSameNarrativeTreatment) ||
      maximumConsecutiveSameNarrativeTreatment < 1) {
    issues.push(makeIssue(
      EDITORIAL_VISUAL_ERROR_CODES.SCENE_SCHEMA_INVALID,
      "maximumConsecutiveSameNarrativeTreatment 必须是正整数",
      "options.maximumConsecutiveSameNarrativeTreatment"
    ));
  } else if (narrativeDiversityApplies) {
    let runStart = 0;
    for (let index = 1; index <= scenes.length; index += 1) {
      const runTreatment = evidenceBackedTreatments[runStart];
      const continues = index < scenes.length &&
        evidenceBackedTreatments[index] === runTreatment;
      if (continues) continue;
      const runLength = index - runStart;
      if (EDITORIAL_NARRATIVE_TREATMENTS.includes(runTreatment) &&
          runLength > maximumConsecutiveSameNarrativeTreatment) {
        issues.push(makeIssue(
          EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_RUN_EXCEEDED,
          `同一种解释方式最多连续 ${maximumConsecutiveSameNarrativeTreatment} 场`,
          `scenes[${runStart}..${index - 1}]`,
          {
            treatment: runTreatment,
            actualRunLength: runLength,
            sceneIds: scenes.slice(runStart, index).map((scene) => scene?.id ?? null)
          }
        ));
      }
      runStart = index;
    }
  }

  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
    sceneReviews: Object.freeze(sceneReviews)
  });
}
