import assert from "node:assert/strict";
import test from "node:test";

import {
  EDITORIAL_CARD_SURFACE_PURPOSES,
  EDITORIAL_ICON_PRESENTATIONS,
  EDITORIAL_ICON_PURPOSES,
  EDITORIAL_OPEN_SURFACE_PURPOSES,
  EDITORIAL_SEQUENCE_PROFILE,
  EDITORIAL_VISUAL_ERROR_CODES,
  EDITORIAL_VISUAL_MODES,
  EDITORIAL_VISUAL_POLICY,
  EDITORIAL_VISUAL_POLICY_VERSION,
  EditorialVisualPolicyError,
  editorialSurfaceCohortKey,
  planEditorialCardTitleLayout,
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
    visualMode: "text-led",
    cards: [],
    diagrams: [],
    icons: [],
    ...overrides
  };
}

test("长视频图文编排合同固定纯文字卡片、独立图标和三场图解节奏", () => {
  assert.equal(EDITORIAL_VISUAL_POLICY_VERSION, "editorial-visual-policy-v4");
  assert.equal(EDITORIAL_SEQUENCE_PROFILE, "ai-tech-longform");
  assert.equal(EDITORIAL_VISUAL_POLICY.sequenceProfile, "ai-tech-longform");
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumCardLedSceneRatio, 0.5);
  assert.equal(EDITORIAL_VISUAL_POLICY.maximumConsecutiveCardLedScenes, 1);
  assert.equal(EDITORIAL_VISUAL_POLICY.mixedDiagramMustCarryRelation, true);
  assert.deepEqual(EDITORIAL_VISUAL_MODES, [
    "text-led",
    "card-led",
    "open-diagram",
    "mixed-diagram"
  ]);
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
  assert.equal(EDITORIAL_VISUAL_POLICY.diagramWindowSize, 3);
  assert.equal(EDITORIAL_VISUAL_POLICY.informationCardBorderMode, "full-outline");
  assert.deepEqual(EDITORIAL_VISUAL_POLICY.cardTitleOverflowOrder, [
    "grow-card",
    "reflow-layout"
  ]);
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
      anchorId: "execution-relay",
      purpose: "semantic-anchor",
      presentation: "open-diagram-symbol"
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
        anchorId: "decorative-symbol",
        purpose: "interaction-cue",
        presentation: "open-diagram-symbol"
      },
      {
        id: "icon-b",
        conceptKind: "agent",
        anchorId: "result",
        purpose: "semantic-anchor",
        presentation: "standalone-focus"
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
        anchorId: "sequence-decoration",
        purpose: "interaction-cue",
        presentation: "open-diagram-symbol"
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
      { id: "i-a", conceptKind: "agent", anchorId: "a", purpose: "decoration", presentation: "inline" },
      { id: "i-b", conceptKind: "tool", anchorId: "b", purpose: "semantic-anchor", presentation: "standalone-focus" },
      { id: "i-c", conceptKind: "mcp", anchorId: "c", purpose: "interaction-cue", presentation: "open-diagram-symbol" }
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
      anchorId: "missing",
      purpose: "interaction-cue",
      presentation: "open-diagram-symbol"
    }]
  }));
  assert.ok(issueCodes(unbound).includes(EDITORIAL_VISUAL_ERROR_CODES.ICON_ANCHOR_INVALID));
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
