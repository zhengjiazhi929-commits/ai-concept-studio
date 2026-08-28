import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_TECH_ICON_CONCEPT_KINDS,
  AI_TECH_ICON_CONTRACT_VERSION,
  AI_TECH_ICON_ERROR_CODES,
  AI_TECH_ICON_PARTICIPATION_ROLES,
  AI_TECH_ICON_POLICY,
  AI_TECH_ICON_PRODUCTION_PRESENTATIONS,
  AI_TECH_ICON_REGISTRY_APPROVAL,
  AI_TECH_ICON_REGISTRY_VERSION,
  AI_TECH_ICON_SIZE_ROLES,
  AI_TECH_ICON_STATE_ROLES,
  AI_TECH_ICON_VIEW_BOX,
  AiTechIconContractError,
  aiTechIconMotionStateAtProgress,
  aiTechIconSize,
  assertAiTechIconConceptKind,
  assertAiTechIconProductionPlacement,
  assertAiTechIconProductionPresentation,
  assertAiTechIconStateRole
} from "../src/shared/ai-tech-icon-contract.mjs";

test("AI 技术图标合同固定28个语义、64视窗和四档受控尺寸", () => {
  assert.equal(AI_TECH_ICON_CONTRACT_VERSION, "ai-tech-icon-contract-v4");
  assert.equal(AI_TECH_ICON_REGISTRY_VERSION, "ai-tech-icon-registry-v1");
  assert.deepEqual(AI_TECH_ICON_REGISTRY_APPROVAL, {
    status: "approved-production-v1",
    approvedBy: "Zhengjiazhi",
    approvedOn: "2026-08-26",
    sourceCandidate: "ai-tech-icon-system-review-v002",
    scope: "28-concept-mapping-geometry-status-motion-and-production-usage-rules"
  });
  assert.equal(AI_TECH_ICON_CONCEPT_KINDS.length, 28);
  assert.equal(new Set(AI_TECH_ICON_CONCEPT_KINDS).size, 28);
  assert.deepEqual(AI_TECH_ICON_VIEW_BOX, {
    minX: 0,
    minY: 0,
    width: 64,
    height: 64,
    value: "0 0 64 64"
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(AI_TECH_ICON_SIZE_ROLES).map(([role, definition]) => [role, definition.sizePx])),
    { inline: 36, support: 56, "longform-support": 88, focus: 104 }
  );
  assert.equal(AI_TECH_ICON_POLICY.strokeWidth, 3.5);
  assert.equal(AI_TECH_ICON_POLICY.maximumPrimitiveCount, 6);
  assert.equal(AI_TECH_ICON_POLICY.maximumVisibleIconsPerProductionScene, 2);
  assert.equal(AI_TECH_ICON_POLICY.maximumIconsPerInformationCard, 0);
  assert.equal(AI_TECH_ICON_POLICY.informationCardContentMode, "text-only");
  assert.equal(AI_TECH_ICON_POLICY.productionPresentationMode, "standalone-only");
  assert.deepEqual(AI_TECH_ICON_PRODUCTION_PRESENTATIONS, [
    "standalone-focus",
    "open-diagram-symbol"
  ]);
  assert.deepEqual(
    AI_TECH_ICON_POLICY.allowedProductionPresentations,
    AI_TECH_ICON_PRODUCTION_PRESENTATIONS
  );
  assert.equal(AI_TECH_ICON_POLICY.registeredIconHierarchy, "peer");
  assert.equal(AI_TECH_ICON_POLICY.cardAttachmentMode, "forbidden");
  assert.deepEqual(AI_TECH_ICON_PARTICIPATION_ROLES, [
    "graph-node",
    "owned-callout",
    "dedicated-focus"
  ]);
  assert.equal(AI_TECH_ICON_POLICY.maximumOwnedCalloutGapPx, 48);
  assert.equal(AI_TECH_ICON_POLICY.maximumIconLabelRevealDeltaFrames, 1);
  assert.equal(AI_TECH_ICON_POLICY.duplicateSemanticRepresentationMode, "fail-closed");
  assert.equal(
    AI_TECH_ICON_POLICY.openDiagramUsage.graphNodeGeometryMode,
    "measured-visible-content"
  );
  assert.equal(
    AI_TECH_ICON_POLICY.openDiagramUsage.graphNodeRelationEntryMode,
    "connector-arrow-first"
  );
  assert.equal(
    AI_TECH_ICON_POLICY.openDiagramUsage.graphNodeMultipleIncomingMode,
    "wait-for-all-establishing-arrows"
  );
  assert.deepEqual(AI_TECH_ICON_POLICY.verifiedSuccessUsage, {
    autoInsert: false,
    purpose: "state-proof",
    presentation: "standalone-focus",
    layoutRole: "dedicated-icon-focus",
    participation: "dedicated-focus",
    placement: "dedicated-focus"
  });
});

test("对号与其他注册图标同级，但只能作为独立成功焦点，不能贴在卡片或开放图解节点旁", () => {
  assert.deepEqual(assertAiTechIconProductionPlacement({
    conceptKind: "verified-success",
    purpose: "state-proof",
    presentation: "standalone-focus",
    layoutRole: "dedicated-icon-focus",
    participation: "dedicated-focus",
    semanticObjectId: "verified-result",
    placement: "dedicated-focus",
    attachmentMode: "independent",
    autoInsert: false
  }), {
    conceptKind: "verified-success",
    purpose: "state-proof",
    presentation: "standalone-focus",
    layoutRole: "dedicated-icon-focus",
    participation: "dedicated-focus",
    semanticObjectId: "verified-result",
    ownerId: null,
    placement: "dedicated-focus",
    maximumGapPx: null,
    labelRevealDeltaFrames: 0,
    attachmentMode: "independent",
    autoInsert: false
  });
  assert.throws(
    () => assertAiTechIconProductionPresentation("verified-success", "open-diagram-symbol"),
    (error) => error instanceof AiTechIconContractError &&
      error.code === AI_TECH_ICON_ERROR_CODES.VERIFIED_SUCCESS_PRESENTATION_INVALID
  );
  assert.equal(
    assertAiTechIconProductionPresentation("routing", "open-diagram-symbol"),
    "open-diagram-symbol"
  );
  assert.deepEqual(assertAiTechIconProductionPlacement({
    conceptKind: "routing",
    purpose: "semantic-anchor",
    presentation: "open-diagram-symbol",
    layoutRole: "semantic-icon-node",
    participation: "graph-node",
    semanticObjectId: "router",
    placement: "anchor-bounds"
  }), {
    conceptKind: "routing",
    purpose: "semantic-anchor",
    presentation: "open-diagram-symbol",
    layoutRole: "semantic-icon-node",
    participation: "graph-node",
    semanticObjectId: "router",
    ownerId: null,
    placement: "anchor-bounds",
    maximumGapPx: null,
    labelRevealDeltaFrames: 0,
    attachmentMode: "independent",
    autoInsert: false
  });
  assert.throws(
    () => assertAiTechIconProductionPlacement({
      conceptKind: "verified-success",
      purpose: "state-proof",
      presentation: "standalone-focus",
      layoutRole: "semantic-icon-node",
      participation: "graph-node",
      semanticObjectId: "result",
      placement: "anchor-bounds"
    }),
    (error) => error instanceof AiTechIconContractError &&
      error.code === AI_TECH_ICON_ERROR_CODES.SEMANTIC_BINDING_INVALID
  );
  assert.throws(
    () => assertAiTechIconProductionPlacement({
      conceptKind: "routing",
      purpose: "semantic-anchor",
      presentation: "open-diagram-symbol",
      layoutRole: "semantic-icon-node",
      participation: "graph-node",
      semanticObjectId: "router",
      placement: "anchor-bounds",
      attachmentMode: "card-accessory"
    }),
    (error) => error instanceof AiTechIconContractError &&
      error.code === AI_TECH_ICON_ERROR_CODES.CARD_ATTACHMENT_FORBIDDEN
  );
  assert.throws(
    () => assertAiTechIconProductionPresentation("routing", "card-badge"),
    (error) => error instanceof AiTechIconContractError &&
      error.code === AI_TECH_ICON_ERROR_CODES.PRESENTATION_UNKNOWN
  );
});

test("开放图解图标只能替代关系节点或在48px内归属 owner，远端 rail 与异步文字 fail closed", () => {
  assert.deepEqual(assertAiTechIconProductionPlacement({
    conceptKind: "context-window",
    purpose: "semantic-anchor",
    presentation: "open-diagram-symbol",
    layoutRole: "owned-icon-callout",
    participation: "owned-callout",
    semanticObjectId: "context-window-callout",
    ownerId: "context-budget",
    placement: "left-center",
    maximumGapPx: 24,
    labelRevealDeltaFrames: 1
  }), {
    conceptKind: "context-window",
    purpose: "semantic-anchor",
    presentation: "open-diagram-symbol",
    layoutRole: "owned-icon-callout",
    participation: "owned-callout",
    semanticObjectId: "context-window-callout",
    ownerId: "context-budget",
    placement: "left-center",
    maximumGapPx: 24,
    labelRevealDeltaFrames: 1,
    attachmentMode: "independent",
    autoInsert: false
  });
  assert.throws(
    () => assertAiTechIconProductionPlacement({
      conceptKind: "tool",
      purpose: "semantic-anchor",
      presentation: "open-diagram-symbol",
      layoutRole: "semantic-icon-node",
      participation: "graph-node",
      semanticObjectId: "tool",
      placement: "left-rail"
    }),
    (error) => error.code === AI_TECH_ICON_ERROR_CODES.REMOTE_RAIL_FORBIDDEN
  );
  assert.throws(
    () => assertAiTechIconProductionPlacement({
      conceptKind: "context-window",
      purpose: "semantic-anchor",
      presentation: "open-diagram-symbol",
      layoutRole: "owned-icon-callout",
      participation: "owned-callout",
      semanticObjectId: "context-window-callout",
      ownerId: "context-budget",
      placement: "left-center",
      maximumGapPx: 49
    }),
    (error) => error.code === AI_TECH_ICON_ERROR_CODES.OWNED_CALLOUT_GAP_INVALID
  );
  assert.throws(
    () => assertAiTechIconProductionPlacement({
      conceptKind: "mcp",
      purpose: "semantic-anchor",
      presentation: "open-diagram-symbol",
      layoutRole: "semantic-icon-node",
      participation: "graph-node",
      semanticObjectId: "mcp",
      placement: "anchor-bounds",
      labelRevealDeltaFrames: 2
    }),
    (error) => error.code === AI_TECH_ICON_ERROR_CODES.LABEL_REVEAL_SYNC_INVALID
  );
});

test("未知 conceptKind、尺寸和状态 fail closed，none 必须显式允许", () => {
  assert.equal(assertAiTechIconConceptKind("prompt"), "prompt");
  assert.equal(assertAiTechIconConceptKind("none", { allowNone: true }), null);
  assert.throws(
    () => assertAiTechIconConceptKind("brain-robot"),
    (error) => error instanceof AiTechIconContractError &&
      error.code === AI_TECH_ICON_ERROR_CODES.CONCEPT_UNKNOWN
  );
  assert.equal(aiTechIconSize("support").sizePx, 56);
  assert.equal(aiTechIconSize("longform-support").sizePx, 88);
  assert.throws(
    () => aiTechIconSize("tiny"),
    (error) => error.code === AI_TECH_ICON_ERROR_CODES.SIZE_ROLE_UNKNOWN
  );
  for (const stateRole of AI_TECH_ICON_STATE_ROLES) {
    assert.equal(assertAiTechIconStateRole(stateRole), stateRole);
  }
  assert.throws(
    () => assertAiTechIconStateRole("rainbow"),
    (error) => error.code === AI_TECH_ICON_ERROR_CODES.STATE_ROLE_UNKNOWN
  );
});

test("动效只由 progress 驱动，完成后永久稳定", () => {
  assert.deepEqual(aiTechIconMotionStateAtProgress(0), {
    progress: 0,
    opacity: 0,
    scale: 0.96,
    translateY: 4,
    drawProgress: 0,
    settled: false
  });
  const middle = aiTechIconMotionStateAtProgress(0.5);
  assert.equal(middle.progress, 0.5);
  assert.equal(middle.opacity, 0.5);
  assert.ok(middle.drawProgress > 0 && middle.drawProgress < 1);
  assert.equal(middle.settled, false);
  const settled = aiTechIconMotionStateAtProgress(1);
  assert.deepEqual(settled, {
    progress: 1,
    opacity: 1,
    scale: 1,
    translateY: 0,
    drawProgress: 1,
    settled: true
  });
  assert.deepEqual(aiTechIconMotionStateAtProgress(9), settled);
  assert.throws(
    () => aiTechIconMotionStateAtProgress(Number.NaN),
    (error) => error.code === AI_TECH_ICON_ERROR_CODES.PROGRESS_INVALID
  );
});

test("合同明确禁止 emoji、临时 SVG、原始颜色与持续循环", () => {
  assert.ok(AI_TECH_ICON_POLICY.forbidden.includes("emoji-glyph"));
  assert.ok(AI_TECH_ICON_POLICY.forbidden.includes("unicode-status-mark"));
  assert.ok(AI_TECH_ICON_POLICY.forbidden.includes("scene-private-svg-icon"));
  assert.ok(AI_TECH_ICON_POLICY.forbidden.includes("raw-color-value"));
  assert.ok(AI_TECH_ICON_POLICY.forbidden.includes("decorative-icon-wall"));
  assert.ok(AI_TECH_ICON_POLICY.forbidden.includes("css-animation"));
  assert.ok(AI_TECH_ICON_POLICY.forbidden.includes("css-transition"));
  assert.ok(AI_TECH_ICON_POLICY.forbidden.includes("continuous-loop"));
  assert.equal(AI_TECH_ICON_POLICY.motionMode, "frame-progress-driven");
  assert.equal(AI_TECH_ICON_POLICY.settleMode, "stable-hold");
});
