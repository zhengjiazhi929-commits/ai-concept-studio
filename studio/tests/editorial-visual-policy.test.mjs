import assert from "node:assert/strict";
import test from "node:test";

import {
  EDITORIAL_CARD_SURFACE_PURPOSES,
  EDITORIAL_ICON_PRESENTATIONS,
  EDITORIAL_ICON_PURPOSES,
  EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS,
  EDITORIAL_NARRATIVE_TREATMENT_NONE,
  EDITORIAL_NARRATIVE_TREATMENTS,
  EDITORIAL_OPEN_SURFACE_PURPOSES,
  EDITORIAL_SEQUENCE_PROFILE,
  EDITORIAL_SHAPE_GRAMMAR,
  EDITORIAL_SHAPE_GRAMMAR_VERSION,
  EDITORIAL_SUBTITLE_PHASES,
  EDITORIAL_VISUAL_ERROR_CODES,
  EDITORIAL_VISUAL_MODES,
  EDITORIAL_VISUAL_POLICY,
  EDITORIAL_VISUAL_POLICY_VERSION,
  EditorialVisualPolicyError,
  editorialSurfaceCohortKey,
  planEditorialCardTitleLayout,
  planEditorialSubtitlePresentation,
  validateEditorialRelationSurfaceConsistency,
  validateEditorialScene,
  validateEditorialSequence
} from "../src/shared/editorial-visual-policy.mjs";

function issueCodes(review) {
  return review.issues.map((item) => item.code);
}

function titleLayout(overrides = {}) {
  return {
    lineCount: 1,
    whiteSpace: "nowrap",
    wordBreak: "keep-all",
    overflowWrap: "normal",
    measuredTextWidthPx: 180,
    initialAvailableTextWidthPx: 200,
    finalAvailableTextWidthPx: 200,
    action: "keep",
    ...overrides
  };
}

function card(id, overrides = {}) {
  return {
    id,
    title: `标题 ${id}`,
    surfaceRole: "information-card",
    surfacePurpose: "actionable-object",
    semanticGroupId: `group-${id}`,
    semanticRole: "actionable-object",
    visualHierarchyLevel: "secondary",
    titleLayout: titleLayout(),
    border: { mode: "full-outline", widthPx: 2 },
    ...overrides
  };
}

function diagram(id, overrides = {}) {
  return {
    id,
    kind: "open-diagram",
    informationCard: false,
    surfaceRole: "open-canvas",
    surfacePurpose: "process-anchor",
    semanticGroupId: `group-${id}`,
    semanticRole: "process-step",
    visualHierarchyLevel: "secondary",
    carriesRelation: true,
    ...overrides
  };
}

function scene(id, overrides = {}) {
  return {
    id,
    shapeGrammarVersion: EDITORIAL_SHAPE_GRAMMAR_VERSION,
    visualMode: "text-led",
    narrativeTreatment: EDITORIAL_NARRATIVE_TREATMENT_NONE,
    narrativeTreatmentRationale: "本专项只验证独立的承载规则，不把无关结构伪装成图解叙事。",
    treatmentEvidence: null,
    cards: [],
    diagrams: [],
    icons: [],
    relations: [],
    semanticBoundaries: [],
    ...overrides
  };
}

const treatmentRoles = Object.freeze({
  "package-anatomy": ["step", "result", "concept", "concept"],
  "runtime-resource-flow": ["process-step", "state", "result", "decision"],
  "governance-evidence-trail": ["evidence", "decision", "source", "result"],
  "state-transformation": ["source", "result", "concept", "concept"],
  "decision-path": ["decision", "source", "result", "concept"],
  "comparison-field": ["state", "source", "result", "concept"],
  "relationship-map": ["concept", "concept", "concept", "result"]
});

function sceneWithTreatment(id, narrativeTreatment) {
  const visibleElementIds = [0, 1, 2, 3].map((index) => `${id}-node-${index}`);
  const relationIds = [0, 1, 2].map((index) => `${id}-relation-${index}`);
  const diagrams = visibleElementIds.map((elementId, index) => diagram(elementId, {
    semanticRole: treatmentRoles[narrativeTreatment][index]
  }));
  const relations = relationIds.map((relationId, index) => ({
    id: relationId,
    from: visibleElementIds[index],
    to: visibleElementIds[index + 1],
    semanticType: index === 0
      ? EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS[narrativeTreatment].requiredRelationTypes[0]
      : "then"
  }));
  return scene(id, {
    visualMode: "open-diagram",
    narrativeTreatment,
    narrativeTreatmentRationale: `${id} 用真实可见拓扑增强当前主张。`,
    treatmentEvidence: {
      mechanism: EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS[narrativeTreatment].mechanism,
      visibleElementIds,
      relationIds,
      contentContribution: `${id} 的对象与关系共同承担解释。`
    },
    diagrams,
    relations
  });
}

test("长视频图文编排合同固定纯文字卡片、语义绑定图标和三场图解节奏", () => {
  assert.equal(EDITORIAL_VISUAL_POLICY_VERSION, "editorial-visual-policy-v8");
  assert.equal(EDITORIAL_SEQUENCE_PROFILE, "ai-tech-longform");
  assert.equal(EDITORIAL_SHAPE_GRAMMAR_VERSION, "editorial-shape-grammar-v1");
  assert.deepEqual(EDITORIAL_SHAPE_GRAMMAR, {
    informationCard: {
      visualForm: "full-outline",
      semanticMeaning: "complete-object-or-boundary"
    },
    openCanvas: {
      visualForm: "open-node",
      semanticMeaning: "process-or-relationship-anchor"
    },
    semanticBoundary: {
      visualForm: "dashed-outline",
      allowedMeanings: ["scope", "exclusion", "pending-validation", "risk-boundary"],
      forbiddenMeaning: "decoration"
    },
    teachingMode: {
      mode: "single-transient-legend",
      persistent: false
    }
  });
  assert.equal(EDITORIAL_VISUAL_POLICY.sequenceProfile, "ai-tech-longform");
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumCardLedSceneRatio, 0.5);
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumConsecutiveCardLedScenes, 1);
  assert.equal(EDITORIAL_VISUAL_POLICY.minimumNarrativeTreatmentsPerLongformSequence, 3);
  assert.equal(EDITORIAL_VISUAL_POLICY.minimumNarrativeDiversitySequenceLength, 8);
  assert.equal(EDITORIAL_VISUAL_POLICY.narrativeTreatmentWindowSize, 4);
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumConsecutiveSameNarrativeTreatment, 2);
  assert.equal(EDITORIAL_VISUAL_POLICY.denseDiagramVisibleNodeThreshold, 5);
  assert.equal(EDITORIAL_VISUAL_POLICY.denseDiagramVisibleRelationThreshold, 4);
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumSubtitleCueGraphemes, 16);
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumStandaloneFinalSubtitleGraphemes, 8);
  assert.equal(EDITORIAL_VISUAL_POLICY.denseFinalHoldSubtitleMode, "semantic-cue");
  assert.deepEqual(EDITORIAL_SUBTITLE_PHASES, [
    "pre-build",
    "active-build",
    "dense-build",
    "final-hold"
  ]);
  assert.equal(EDITORIAL_VISUAL_POLICY.mixedDiagramMustCarryRelation, true);
  assert.deepEqual(EDITORIAL_VISUAL_MODES, [
    "text-led",
    "card-led",
    "open-diagram",
    "mixed-diagram"
  ]);
  assert.deepEqual(EDITORIAL_NARRATIVE_TREATMENTS, [
    "package-anatomy",
    "runtime-resource-flow",
    "governance-evidence-trail",
    "state-transformation",
    "decision-path",
    "comparison-field",
    "relationship-map"
  ]);
  assert.equal(EDITORIAL_NARRATIVE_TREATMENT_NONE, "not-applicable");
  assert.equal(
    EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS["package-anatomy"].mechanism,
    "containment-and-responsibility"
  );
  assert.deepEqual(EDITORIAL_ICON_PURPOSES, [
    "semantic-anchor",
    "state-proof",
    "interaction-cue"
  ]);
  assert.deepEqual(EDITORIAL_ICON_PRESENTATIONS, [
    "standalone-focus",
    "open-diagram-symbol"
  ]);
  assert.deepEqual(EDITORIAL_CARD_SURFACE_PURPOSES, [
    "focus-result",
    "decision-boundary",
    "actionable-object",
    "state-container"
  ]);
  assert.deepEqual(EDITORIAL_OPEN_SURFACE_PURPOSES, [
    "process-anchor",
    "relationship-structure",
    "transition-output"
  ]);
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumIconsPerLongVideoScene, 2);
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumIconsPerInformationCard, 0);
  assert.equal(EDITORIAL_VISUAL_POLICY.informationCardContentMode, "text-only");
  assert.equal(EDITORIAL_VISUAL_POLICY.iconPresentationMode, "standalone-only");
  assert.equal(EDITORIAL_VISUAL_POLICY.iconSemanticBindingMode, "graph-node-or-owned-callout");
  assert.equal(EDITORIAL_VISUAL_POLICY.duplicateSemanticRepresentationMode, "fail-closed");
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumOwnedCalloutGapPx, 48);
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumIconLabelRevealDeltaFrames, 1);
  assert.equal(EDITORIAL_VISUAL_POLICY.diagramWindowSize, 3);
  assert.equal(EDITORIAL_VISUAL_POLICY.informationCardBorderMode, "full-outline");
  assert.equal(EDITORIAL_VISUAL_POLICY.relationSurfaceConsistencyMode, "connected-component");
  assert.equal(
    EDITORIAL_VISUAL_POLICY.relationSurfaceBoundaryMode,
    "explicit-semantic-subgroup-transition"
  );
  assert.deepEqual(EDITORIAL_VISUAL_POLICY.cardTitleOverflowOrder, [
    "grow-card",
    "reflow-layout"
  ]);
});

test("长片场景必须声明解释方式和内容增强理由", () => {
  const missing = validateEditorialScene({
    id: "S-treatment-missing",
    shapeGrammarVersion: EDITORIAL_SHAPE_GRAMMAR_VERSION,
    visualMode: "text-led",
    cards: [],
    diagrams: [],
    icons: [],
    relations: []
  });
  assert.ok(issueCodes(missing).includes(
    EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_INVALID
  ));
  assert.ok(issueCodes(missing).includes(
    EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_RATIONALE_MISSING
  ));

  const staleShapeGrammar = validateEditorialScene(scene("S-shape-grammar-stale", {
    shapeGrammarVersion: "legacy-shape-grammar"
  }));
  assert.ok(issueCodes(staleShapeGrammar).includes(
    EDITORIAL_VISUAL_ERROR_CODES.SHAPE_GRAMMAR_VERSION_INVALID
  ));

  const metadataOnly = validateEditorialScene(scene("S-treatment-metadata-only", {
    narrativeTreatment: "package-anatomy",
    narrativeTreatmentRationale: "把目录边界和各组成职责放在同一结构中，减少跨段记忆。"
  }));
  assert.equal(metadataOnly.valid, false);
  assert.ok(issueCodes(metadataOnly).includes(
    EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_EVIDENCE_INVALID
  ));

  const valid = validateEditorialScene(sceneWithTreatment(
    "S-treatment-valid",
    "package-anatomy"
  ));
  assert.equal(valid.valid, true);

  const stateTransformation = sceneWithTreatment(
    "S-treatment-not-relabelable",
    "state-transformation"
  );
  const relabeledWithoutChangingVisibleSemantics = validateEditorialScene({
    ...stateTransformation,
    narrativeTreatment: "package-anatomy",
    treatmentEvidence: {
      ...stateTransformation.treatmentEvidence,
      mechanism: EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS["package-anatomy"].mechanism
    }
  });
  assert.equal(relabeledWithoutChangingVisibleSemantics.valid, false);
  assert.ok(issueCodes(relabeledWithoutChangingVisibleSemantics).includes(
    EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_EVIDENCE_INVALID
  ));
});

test("长片序列至少使用三种解释方式且不能连续同构", () => {
  const treatmentSequence = [
    "state-transformation",
    "package-anatomy",
    "runtime-resource-flow",
    "relationship-map",
    "comparison-field",
    "decision-path",
    "governance-evidence-trail",
    "runtime-resource-flow"
  ];
  const valid = validateEditorialSequence(treatmentSequence.map((narrativeTreatment, index) =>
    sceneWithTreatment(`S-diverse-${index + 1}`, narrativeTreatment)
  ));
  assert.equal(valid.valid, true);

  const homogeneous = validateEditorialSequence(Array.from({ length: 8 }, (_, index) =>
    sceneWithTreatment(`S-homogeneous-${index + 1}`, "relationship-map")
  ));
  const codes = issueCodes(homogeneous);
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_DIVERSITY_INSUFFICIENT));
  assert.ok(codes.includes(
    EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_WINDOW_HOMOGENEOUS
  ));
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.NARRATIVE_TREATMENT_RUN_EXCEEDED));
});

test("虚线只允许作为带语义声明的开放边界，普通分组和信息卡不能借用", () => {
  const boundaryDiagram = diagram("excluded-option", {
    shapeGrammarRole: "semantic-boundary",
    shapeGrammarVisualForm: "dashed-outline",
    shapeGrammarMeaning: "exclusion"
  });
  const valid = validateEditorialScene(scene("S-boundary-valid", {
    visualMode: "open-diagram",
    diagrams: [boundaryDiagram],
    semanticBoundaries: [{
      id: "excluded-option-boundary",
      meaning: "exclusion",
      memberIds: ["excluded-option"],
      rationale: "明确指出该方案不属于当前能力边界。"
    }]
  }));
  assert.equal(valid.valid, true);

  const decorative = validateEditorialScene(scene("S-boundary-decoration", {
    visualMode: "open-diagram",
    diagrams: [boundaryDiagram],
    semanticBoundaries: [{
      id: "decorative-dash",
      meaning: "decoration",
      memberIds: ["excluded-option"],
      rationale: "只为了让画面更丰富。"
    }]
  }));
  assert.ok(issueCodes(decorative).includes(
    EDITORIAL_VISUAL_ERROR_CODES.SEMANTIC_BOUNDARY_MEANING_INVALID
  ));
  assert.ok(issueCodes(decorative).includes(
    EDITORIAL_VISUAL_ERROR_CODES.SEMANTIC_BOUNDARY_MEMBER_INVALID
  ));

  const dashedCard = validateEditorialScene(scene("S-boundary-card", {
    visualMode: "card-led",
    cards: [card("card-boundary", {
      shapeGrammarRole: "semantic-boundary",
      shapeGrammarVisualForm: "dashed-outline",
      shapeGrammarMeaning: "scope"
    })],
    semanticBoundaries: [{
      id: "card-boundary-declaration",
      meaning: "scope",
      memberIds: ["card-boundary"],
      rationale: "错误地把完整信息卡当作虚线范围。"
    }]
  }));
  assert.ok(issueCodes(dashedCard).includes(
    EDITORIAL_VISUAL_ERROR_CODES.SEMANTIC_BOUNDARY_MEMBER_INVALID
  ));
});

test("关系图构建时字幕降为语义短提示，建立前后才显示完整句", () => {
  const preBuild = planEditorialSubtitlePresentation({
    phase: "pre-build",
    visibleNodeCount: 0,
    visibleRelationCount: 0,
    fullText: "完整句子先建立语境。",
    cueText: "建立语境"
  });
  assert.deepEqual(
    { mode: preBuild.mode, text: preBuild.text, opacity: preBuild.opacity },
    { mode: "full-sentence", text: "完整句子先建立语境。", opacity: 1 }
  );

  const denseBuild = planEditorialSubtitlePresentation({
    phase: "active-build",
    visibleNodeCount: 5,
    visibleRelationCount: 4,
    fullText: "完整句子不能与正在变化的关系图争夺阅读注意力。",
    cueText: "证据逐步汇入"
  });
  assert.equal(denseBuild.phase, "dense-build");
  assert.equal(denseBuild.mode, "semantic-cue");
  assert.equal(denseBuild.text, "证据逐步汇入");
  assert.equal(denseBuild.visualWeight, "supporting");
  assert.equal(denseBuild.opacity, 0.72);

  const finalHold = planEditorialSubtitlePresentation({
    phase: "final-hold",
    visibleNodeCount: 6,
    visibleRelationCount: 6,
    fullText: "图解停止变化后恢复完整结论。",
    cueText: "完成"
  });
  assert.equal(finalHold.mode, "semantic-cue");
  assert.equal(finalHold.text, "完成");
  assert.equal(finalHold.visualWeight, "supporting");
  assert.equal(finalHold.denseFinalHold, true);

  const quietFinalHold = planEditorialSubtitlePresentation({
    phase: "final-hold",
    visibleNodeCount: 2,
    visibleRelationCount: 1,
    fullText: "图解停止变化后恢复完整结论。",
    cueText: "完成"
  });
  assert.equal(quietFinalHold.mode, "full-sentence");
  assert.equal(quietFinalHold.text, "图解停止变化后恢复完整结论。");

  const fragmentFinalHold = planEditorialSubtitlePresentation({
    phase: "final-hold",
    visibleNodeCount: 2,
    visibleRelationCount: 1,
    fullText: "以后一直安全",
    cueText: "证据需持续有效"
  });
  assert.equal(fragmentFinalHold.mode, "semantic-cue");
  assert.equal(fragmentFinalHold.text, "证据需持续有效");
  assert.equal(fragmentFinalHold.fragmentFinalHold, true);

  assert.throws(
    () => planEditorialSubtitlePresentation({
      phase: "dense-build",
      visibleNodeCount: 6,
      visibleRelationCount: 5,
      fullText: "完整句子。",
      cueText: "这是一个超过十六个字符且不应该作为构建提示的长句子"
    }),
    (error) => error instanceof EditorialVisualPolicyError &&
      error.code === EDITORIAL_VISUAL_ERROR_CODES.SUBTITLE_CUE_TOO_LONG
  );
});

test("标题规划先保持或加宽，当前行放不下时重排，永不返回换行方案", () => {
  const kept = planEditorialCardTitleLayout({
    title: "Agent / 判断",
    measuredTextWidthPx: 174,
    currentCardWidthPx: 260,
    remainingRowWidthPx: 300,
    maximumCardWidthPx: 560,
    horizontalPaddingPx: 56
  });
  assert.equal(kept.action, "keep");
  assert.equal(kept.lineCount, 1);
  assert.equal(kept.wordBreak, "keep-all");

  const grown = planEditorialCardTitleLayout({
    title: "Agent / 判断",
    measuredTextWidthPx: 240,
    currentCardWidthPx: 260,
    remainingRowWidthPx: 360,
    maximumCardWidthPx: 560,
    horizontalPaddingPx: 56
  });
  assert.equal(grown.action, "grow-card");
  assert.equal(grown.plannedCardWidthPx, 296);
  assert.ok(grown.finalAvailableTextWidthPx >= grown.measuredTextWidthPx);

  const reflowed = planEditorialCardTitleLayout({
    title: "需要更多横向空间的判断标题",
    measuredTextWidthPx: 330,
    currentCardWidthPx: 260,
    remainingRowWidthPx: 280,
    maximumCardWidthPx: 560,
    horizontalPaddingPx: 56
  });
  assert.equal(reflowed.action, "reflow-layout");
  assert.equal(reflowed.plannedCardWidthPx, 386);
  assert.ok(reflowed.finalAvailableTextWidthPx >= reflowed.measuredTextWidthPx);
});

test("最大卡片宽度仍放不下时 fail closed，要求改编排或文案而非词内断行", () => {
  assert.throws(
    () => planEditorialCardTitleLayout({
      title: "异常超长标题",
      measuredTextWidthPx: 680,
      currentCardWidthPx: 260,
      remainingRowWidthPx: 300,
      maximumCardWidthPx: 560,
      horizontalPaddingPx: 56
    }),
    (error) => error instanceof EditorialVisualPolicyError &&
      error.code === EDITORIAL_VISUAL_ERROR_CODES.TITLE_CANNOT_FIT_SINGLE_LINE
  );
});

test("卡片标题布局拒绝任何图标占位", () => {
  assert.throws(
    () => planEditorialCardTitleLayout({
      title: "检查结果",
      measuredTextWidthPx: 128,
      currentCardWidthPx: 260,
      remainingRowWidthPx: 300,
      maximumCardWidthPx: 560,
      horizontalPaddingPx: 56,
      iconSlotWidthPx: 49
    }),
    (error) => error instanceof EditorialVisualPolicyError &&
      error.code === EDITORIAL_VISUAL_ERROR_CODES.CARD_ICON_FORBIDDEN
  );
});

test("mixed-diagram 只允许卡片外的独立图标，并区分信息卡与开放图解", () => {
  const review = validateEditorialScene(scene("S11", {
    visualMode: "mixed-diagram",
    cards: [card("tool"), card("agent")],
    diagrams: [diagram("execution-relay")],
    icons: [{
      id: "tool-anchor",
      conceptKind: "tool",
      semanticObjectId: "execution-relay",
      participation: "graph-node",
      anchorId: "execution-relay",
      purpose: "semantic-anchor",
      presentation: "open-diagram-symbol",
      layoutRole: "semantic-icon-node",
      placement: "anchor-bounds",
      labelRevealDeltaFrames: 0
    }]
  }));
  assert.equal(review.valid, true);
  assert.deepEqual(review.issues, []);
});

test("同语义组、同角色、同层级必须统一承载方式", () => {
  const review = validateEditorialScene(scene("S-cohort", {
    visualMode: "mixed-diagram",
    cards: [card("step-card", {
      semanticGroupId: "execution-path",
      semanticRole: "process-step"
    })],
    diagrams: [diagram("step-open", {
      semanticGroupId: "execution-path",
      semanticRole: "process-step"
    })]
  }));
  assert.equal(review.valid, false);
  assert.ok(issueCodes(review).includes(
    EDITORIAL_VISUAL_ERROR_CODES.SURFACE_COHORT_MISMATCH
  ));
  const mismatch = review.issues.find(
    (item) => item.code === EDITORIAL_VISUAL_ERROR_CODES.SURFACE_COHORT_MISMATCH
  );
  assert.equal(mismatch.details.semanticGroupId, "execution-path");
  assert.equal(
    editorialSurfaceCohortKey(card("cohort-key", {
      semanticGroupId: "execution-path",
      semanticRole: "process-step"
    })),
    "execution-path::process-step::secondary"
  );
});

test("同一条连续关系路径必须统一承载方式，不因角色或层级不同而放行", () => {
  const review = validateEditorialScene(scene("S-connected-mix", {
    visualMode: "mixed-diagram",
    cards: [card("inspect", {
      semanticGroupId: "adoption-evidence",
      semanticRole: "evidence",
      surfacePurpose: "focus-result",
      visualHierarchyLevel: "primary"
    })],
    diagrams: [diagram("trial", {
      semanticGroupId: "adoption-process",
      semanticRole: "process-step"
    })],
    relations: [{ id: "trial-inspect", from: "trial", to: "inspect" }]
  }));
  assert.equal(review.valid, false);
  const mismatch = review.issues.find(
    (item) => item.code === EDITORIAL_VISUAL_ERROR_CODES.RELATION_SURFACE_COMPONENT_MISMATCH
  );
  assert.ok(mismatch);
  assert.deepEqual(new Set(mismatch.details.surfaceRoles), new Set([
    "information-card",
    "open-canvas"
  ]));
});

test("连续开放路径通过；互不连接的卡片和图解仍可在同一场合理并存", () => {
  const continuousOpen = validateEditorialRelationSurfaceConsistency({
    cards: [],
    diagrams: [diagram("trial"), diagram("inspect")],
    relations: [{ id: "trial-inspect", from: "trial", to: "inspect" }]
  });
  assert.deepEqual(continuousOpen, []);

  const disconnectedMixed = validateEditorialScene(scene("S-disconnected-mix", {
    visualMode: "mixed-diagram",
    cards: [card("result", {
      semanticGroupId: "summary-result",
      surfacePurpose: "focus-result"
    })],
    diagrams: [diagram("process", { semanticGroupId: "process-path" })]
  }));
  assert.equal(disconnectedMixed.valid, true);
});

test("只有带解释的语义子组转换可以显式切换承载方式", () => {
  const cards = [card("result", {
    semanticGroupId: "summary-result",
    surfacePurpose: "focus-result"
  })];
  const diagrams = [diagram("process", { semanticGroupId: "process-path" })];
  const validBoundary = {
    kind: "semantic-subgroup-transition",
    cue: "surface-change",
    rationale: "从过程关系切换到需要独立读取的完整结果。"
  };
  assert.deepEqual(validateEditorialRelationSurfaceConsistency({
    cards,
    diagrams,
    relations: [{
      id: "process-result",
      from: "process",
      to: "result",
      surfaceBoundary: validBoundary
    }]
  }), []);

  const invalid = validateEditorialRelationSurfaceConsistency({
    cards,
    diagrams,
    relations: [{
      id: "process-result",
      from: "process",
      to: "result",
      surfaceBoundary: { ...validBoundary, rationale: "" }
    }]
  });
  assert.ok(invalid.some(
    (item) => item.code === EDITORIAL_VISUAL_ERROR_CODES.RELATION_SURFACE_BOUNDARY_INVALID
  ));
});

test("同角色同层级但不同语义组可以合理混合，卡片目的仍须属于内容职责", () => {
  const valid = validateEditorialScene(scene("S-semantic-mix", {
    visualMode: "mixed-diagram",
    cards: [card("result", {
      semanticGroupId: "adoption-result",
      semanticRole: "process-step",
      surfacePurpose: "focus-result"
    })],
    diagrams: [diagram("step", {
      semanticGroupId: "execution-path",
      semanticRole: "process-step"
    })]
  }));
  assert.equal(valid.valid, true);

  const invalidPurpose = validateEditorialScene(scene("S-decoration", {
    visualMode: "card-led",
    cards: [card("decorative", { surfacePurpose: "decoration" })]
  }));
  assert.ok(issueCodes(invalidPurpose).includes(
    EDITORIAL_VISUAL_ERROR_CODES.CARD_SURFACE_PURPOSE_INVALID
  ));
});

test("卡片和开放图解都必须显式传递 semanticGroupId", () => {
  const review = validateEditorialScene(scene("S-group-schema", {
    visualMode: "mixed-diagram",
    cards: [card("card-without-group", { semanticGroupId: "" })],
    diagrams: [diagram("diagram-without-group", { semanticGroupId: "" })]
  }));
  const metadataIssues = review.issues.filter(
    (item) => item.code === EDITORIAL_VISUAL_ERROR_CODES.SURFACE_METADATA_INVALID
  );
  assert.equal(metadataIssues.length, 2);
});

test("mixed-diagram 必须由开放图解真正承载关系，独立图标数量不能替代", () => {
  const review = validateEditorialScene(scene("S-fake-mixed", {
    visualMode: "mixed-diagram",
    cards: [card("result")],
    diagrams: [diagram("decorative-symbol", { carriesRelation: false })],
    icons: [
      {
        id: "icon-a",
        conceptKind: "routing",
        semanticObjectId: "decorative-symbol",
        participation: "graph-node",
        anchorId: "decorative-symbol",
        purpose: "interaction-cue",
        presentation: "open-diagram-symbol",
        layoutRole: "semantic-icon-node",
        placement: "anchor-bounds",
        labelRevealDeltaFrames: 0
      },
      {
        id: "icon-b",
        conceptKind: "agent",
        semanticObjectId: "focus-agent",
        participation: "dedicated-focus",
        anchorId: "result",
        purpose: "semantic-anchor",
        presentation: "standalone-focus",
        layoutRole: "dedicated-icon-focus",
        placement: "dedicated-focus",
        labelRevealDeltaFrames: 0
      }
    ]
  }));
  const relationIssue = review.issues.find(
    (item) => item.code === EDITORIAL_VISUAL_ERROR_CODES.MIXED_DIAGRAM_RELATION_MISSING
  );
  assert.ok(relationIssue);
  assert.equal(relationIssue.details.iconCountIgnored, 2);

  const sequence = validateEditorialSequence([
    scene("S01"),
    scene("S02", {
      visualMode: "mixed-diagram",
      cards: [card("sequence-result")],
      diagrams: [diagram("sequence-decoration", { carriesRelation: false })],
      icons: [{
        id: "sequence-icon",
        conceptKind: "routing",
        semanticObjectId: "sequence-decoration",
        participation: "graph-node",
        anchorId: "sequence-decoration",
        purpose: "interaction-cue",
        presentation: "open-diagram-symbol",
        layoutRole: "semantic-icon-node",
        placement: "anchor-bounds",
        labelRevealDeltaFrames: 0
      }]
    }),
    scene("S03")
  ]);
  assert.ok(issueCodes(sequence).includes(
    EDITORIAL_VISUAL_ERROR_CODES.DIAGRAM_WINDOW_MISSING
  ));
});

test("卡片标题若换行或溢出未通过加宽/重排解决会被拒绝", () => {
  const wrapped = card("wrapped", {
    titleLayout: titleLayout({
      lineCount: 2,
      whiteSpace: "normal",
      wordBreak: "break-all"
    })
  });
  const unresolved = card("unresolved", {
    titleLayout: titleLayout({
      measuredTextWidthPx: 260,
      initialAvailableTextWidthPx: 180,
      finalAvailableTextWidthPx: 180,
      action: "keep"
    })
  });
  const review = validateEditorialScene(scene("S-title", {
    visualMode: "card-led",
    cards: [wrapped, unresolved]
  }));
  const codes = issueCodes(review);
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.CARD_TITLE_NOT_SINGLE_LINE));
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.CARD_TITLE_OVERFLOW_UNRESOLVED));
});

test("信息卡缺失完整边框、开放图解冒充信息卡都会被拒绝", () => {
  const review = validateEditorialScene(scene("S-border", {
    visualMode: "mixed-diagram",
    cards: [card("borderless", { border: { mode: "bottom-only", widthPx: 2 } })],
    diagrams: [diagram("fake-card", { informationCard: true, surfaceRole: "information-card" })]
  }));
  const codes = issueCodes(review);
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.CARD_BORDER_INCOMPLETE));
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.DIAGRAM_CLASSIFICATION_INVALID));
});

test("卡片内图标、图标目的、展示方式、锚点和数量都会被场景合同校验", () => {
  const review = validateEditorialScene(scene("S-icons", {
    visualMode: "card-led",
    cards: [
      card("a", { conceptKind: "agent", iconPresentation: "inline" }),
      card("b"),
      card("c")
    ],
    icons: [
      {
        id: "i-a", conceptKind: "agent", semanticObjectId: "a", participation: "graph-node",
        anchorId: "a", purpose: "decoration", presentation: "inline",
        layoutRole: "semantic-icon-node", placement: "anchor-bounds", labelRevealDeltaFrames: 0
      },
      {
        id: "i-b", conceptKind: "tool", semanticObjectId: "focus-tool", participation: "dedicated-focus",
        anchorId: "b", purpose: "semantic-anchor", presentation: "standalone-focus",
        layoutRole: "dedicated-icon-focus", placement: "dedicated-focus", labelRevealDeltaFrames: 0
      },
      {
        id: "i-c", conceptKind: "mcp", semanticObjectId: "mcp-callout", participation: "owned-callout",
        anchorId: "c", ownerId: "c", purpose: "interaction-cue", presentation: "open-diagram-symbol",
        layoutRole: "owned-icon-callout", placement: "right-center", maximumGapPx: 24,
        labelRevealDeltaFrames: 0
      }
    ]
  }));
  const codes = issueCodes(review);
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.CARD_ICON_FORBIDDEN));
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.ICON_PURPOSE_INVALID));
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.ICON_PRESENTATION_INVALID));
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.ICON_LIMIT_EXCEEDED));

  const unbound = validateEditorialScene(scene("S-unbound", {
    visualMode: "open-diagram",
    diagrams: [diagram("relay")],
    icons: [{
      id: "orphan",
      conceptKind: "routing",
      semanticObjectId: "missing",
      participation: "graph-node",
      anchorId: "missing",
      purpose: "interaction-cue",
      presentation: "open-diagram-symbol",
      layoutRole: "semantic-icon-node",
      placement: "anchor-bounds",
      labelRevealDeltaFrames: 0
    }]
  }));
  assert.ok(issueCodes(unbound).includes(EDITORIAL_VISUAL_ERROR_CODES.ICON_ANCHOR_INVALID));
});

test("图标语义绑定拒绝重复主表现、远端 rail、超距 owner 和文字提前", () => {
  const review = validateEditorialScene(scene("S-icon-binding", {
    visualMode: "open-diagram",
    diagrams: [diagram("router"), diagram("target")],
    icons: [
      {
        id: "router-a", conceptKind: "routing", semanticObjectId: "router", participation: "graph-node",
        anchorId: "router", purpose: "semantic-anchor", presentation: "open-diagram-symbol",
        layoutRole: "semantic-icon-node", placement: "left-rail", labelRevealDeltaFrames: 2
      },
      {
        id: "router-b", conceptKind: "workflow", semanticObjectId: "router", participation: "owned-callout",
        anchorId: "target", ownerId: "target", purpose: "interaction-cue", presentation: "open-diagram-symbol",
        layoutRole: "owned-icon-callout", placement: "right-center", maximumGapPx: 64,
        labelRevealDeltaFrames: 0
      }
    ]
  }));
  const codes = issueCodes(review);
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.ICON_DUPLICATE_SEMANTIC_OBJECT));
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.ICON_REMOTE_PLACEMENT_FORBIDDEN));
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.ICON_BINDING_INVALID));
  assert.ok(codes.includes(EDITORIAL_VISUAL_ERROR_CODES.ICON_LABEL_SYNC_INVALID));
});

test("每个连续三场窗口至少包含一场开放或混合图解", () => {
  const valid = validateEditorialSequence([
    scene("S01"),
    scene("S02", { visualMode: "card-led", cards: [card("s02-a"), card("s02-b")] }),
    scene("S03", { visualMode: "open-diagram", diagrams: [diagram("s03-flow")] }),
    scene("S04", { visualMode: "card-led", cards: [card("s04-a"), card("s04-b")] }),
    scene("S05", { visualMode: "mixed-diagram", cards: [card("s05-a"), card("s05-b")], diagrams: [diagram("s05-gate")] }),
    scene("S06")
  ]);
  assert.equal(valid.valid, true);

  const invalid = validateEditorialSequence([
    scene("S01"),
    scene("S02", { visualMode: "card-led", cards: [card("s02-a"), card("s02-b")] }),
    scene("S03", { visualMode: "card-led", cards: [card("s03-a"), card("s03-b")] }),
    scene("S04", { visualMode: "open-diagram", diagrams: [diagram("s04-flow")] })
  ]);
  const missingWindows = invalid.issues.filter(
    (item) => item.code === EDITORIAL_VISUAL_ERROR_CODES.DIAGRAM_WINDOW_MISSING
  );
  assert.equal(missingWindows.length, 1);
  assert.equal(missingWindows[0].location, "scenes[0..2]");
  assert.ok(issueCodes(invalid).includes(
    EDITORIAL_VISUAL_ERROR_CODES.CARD_LED_RUN_EXCEEDED
  ));
});

test("ai-tech-longform 的 card-led 占比最多一半且不能连续出现", () => {
  const ratioExceeded = validateEditorialSequence([
    scene("S01", { visualMode: "card-led", cards: [card("s01-card")] }),
    scene("S02", { visualMode: "open-diagram", diagrams: [diagram("s02-flow")] }),
    scene("S03", { visualMode: "card-led", cards: [card("s03-card")] }),
    scene("S04", { visualMode: "open-diagram", diagrams: [diagram("s04-flow")] }),
    scene("S05", { visualMode: "card-led", cards: [card("s05-card")] })
  ]);
  assert.ok(issueCodes(ratioExceeded).includes(
    EDITORIAL_VISUAL_ERROR_CODES.CARD_LED_RATIO_EXCEEDED
  ));
  assert.ok(!issueCodes(ratioExceeded).includes(
    EDITORIAL_VISUAL_ERROR_CODES.CARD_LED_RUN_EXCEEDED
  ));

  const adjacent = validateEditorialSequence([
    scene("S01", { visualMode: "open-diagram", diagrams: [diagram("s01-flow")] }),
    scene("S02", { visualMode: "card-led", cards: [card("s02-card")] }),
    scene("S03", { visualMode: "card-led", cards: [card("s03-card")] }),
    scene("S04", { visualMode: "open-diagram", diagrams: [diagram("s04-flow")] })
  ]);
  assert.ok(issueCodes(adjacent).includes(
    EDITORIAL_VISUAL_ERROR_CODES.CARD_LED_RUN_EXCEEDED
  ));
  assert.ok(!issueCodes(adjacent).includes(
    EDITORIAL_VISUAL_ERROR_CODES.CARD_LED_RATIO_EXCEEDED
  ));
});
