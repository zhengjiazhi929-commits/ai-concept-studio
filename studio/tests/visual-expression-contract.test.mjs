import assert from "node:assert/strict";
import test from "node:test";

import {
  VISUAL_EXPRESSION_CONTRACT_VERSION,
  VISUAL_EXPRESSION_ERROR_CODES,
  VISUAL_EXPRESSION_STYLE_PROFILE_ID,
  assertVisualExpressionPlan,
  createVisualExpressionIntent,
  resolveVisualExpressionPlan,
  validateVisualExpressionIntent,
  validateVisualExpressionPlan,
  validateVisualExpressionScene,
  visualExpressionPromptDirective
} from "../src/shared/visual-expression-contract.mjs";

function sequenceIntent(overrides = {}) {
  return {
    schemaVersion: VISUAL_EXPRESSION_CONTRACT_VERSION,
    question: "这个任务按什么顺序完成？",
    takeaway: "先路由，再加载，最后执行。",
    role: "explanation",
    objective: "explain",
    informationNeed: "sequence",
    contribution: "show-order",
    contributionRationale: "删掉流程图后，口播中的先后关系会退化成三个并列名词。",
    relationKind: "sequence",
    compositionProfile: "text-first",
    claims: [{
      id: "claim-order",
      text: "路由、加载、执行有固定顺序",
      visualRequired: true,
      evidenceRefs: []
    }],
    entities: [
      { id: "route", label: "路由", semanticRole: "step", importance: "primary", claimIds: ["claim-order"] },
      { id: "execute", label: "执行", semanticRole: "result", importance: "primary", claimIds: ["claim-order"] }
    ],
    relations: [{
      id: "route-to-execute",
      from: "route",
      to: "execute",
      type: "then",
      label: "然后",
      directed: true,
      claimIds: ["claim-order"]
    }],
    evidenceRefs: [],
    mustNotShow: ["人物", "装饰箭头"],
    ...overrides
  };
}

function textOnlyIntent() {
  return {
    schemaVersion: VISUAL_EXPRESSION_CONTRACT_VERSION,
    question: "这一章的核心判断是什么？",
    takeaway: "Skill 是可维护的能力单元。",
    role: "statement",
    objective: "orient",
    informationNeed: "none",
    contribution: "none",
    contributionRationale: "这是单一判断，使用清晰大标题比装饰插画更直接。",
    relationKind: "none",
    compositionProfile: "text-first",
    claims: [{
      id: "claim-definition",
      text: "Skill 是可维护的能力单元",
      visualRequired: false,
      evidenceRefs: []
    }],
    entities: [],
    relations: [],
    evidenceRefs: [],
    mustNotShow: ["为填空白而画的抽象插画"]
  };
}

function validScene(id = "S03") {
  const visualIntent = createVisualExpressionIntent(sequenceIntent(), { sceneId: id });
  return {
    id,
    visualIntent,
    visualPlan: resolveVisualExpressionPlan({ sceneId: id, visualIntent })
  };
}

function validLayoutSample() {
  return {
    frame: 90,
    canvas: { x: 0, y: 0, width: 1920, height: 1080 },
    safeArea: { x: 96, y: 80, width: 1728, height: 860 },
    regions: {
      title: { x: 120, y: 100, width: 1500, height: 160 },
      graphic: { x: 120, y: 320, width: 1500, height: 350 },
      subtitle: { x: 120, y: 720, width: 1500, height: 80 }
    },
    elements: [
      {
        id: "route",
        kind: "shape",
        primitive: "flow-step",
        visualEncoding: "semantic-diagram",
        surfaceRole: "information-card",
        iconPlacement: "none",
        borderMode: "full-outline",
        borderWidthPx: 3,
        borderColorRole: "line-primary",
        borderRadiusPx: 18,
        shadowMode: "none",
        bounds: { x: 240, y: 390, width: 300, height: 180 },
        peerGroup: "steps",
        colorRole: "accent-primary",
        lineRole: "relationship-primary",
        typographyRole: "node-label",
        fontSizePx: 42,
        narrativeRole: "step"
      },
      {
        id: "execute",
        kind: "shape",
        primitive: "flow-step",
        visualEncoding: "semantic-diagram",
        surfaceRole: "information-card",
        iconPlacement: "none",
        borderMode: "full-outline",
        borderWidthPx: 3,
        borderColorRole: "line-primary",
        borderRadiusPx: 18,
        shadowMode: "none",
        bounds: { x: 980, y: 390, width: 300, height: 180 },
        peerGroup: "steps",
        colorRole: "accent-secondary",
        lineRole: "relationship-primary",
        typographyRole: "node-label",
        fontSizePx: 42,
        narrativeRole: "result"
      }
    ],
    connectors: [{
      id: "connector-route-to-execute",
      relationId: "route-to-execute",
      from: "route",
      to: "execute",
      arrowhead: true,
      route: [{ x: 540, y: 480 }, { x: 980, y: 480 }]
    }],
    metrics: { textAreaRatio: 0.64 }
  };
}

function issueCodes(review) {
  return review.issues.map((item) => item.code);
}

test("单一判断允许纯文字，关系、顺序和比较才要求图形", () => {
  const textReview = validateVisualExpressionIntent(textOnlyIntent(), { sceneId: "S01" });
  assert.equal(textReview.valid, true);
  const textPlan = resolveVisualExpressionPlan({ sceneId: "S01", visualIntent: textOnlyIntent() });
  assert.equal(textPlan.visualMode, "text-only");
  assert.equal(textPlan.structure, "none");

  const missingGraphic = sequenceIntent({ entities: [], relations: [] });
  const graphicReview = validateVisualExpressionIntent(missingGraphic, { sceneId: "S02" });
  assert.equal(graphicReview.valid, false);
  assert.ok(issueCodes(graphicReview).includes(VISUAL_EXPRESSION_ERROR_CODES.GRAPHIC_REQUIRED));
  assert.ok(issueCodes(graphicReview).includes(VISUAL_EXPRESSION_ERROR_CODES.STRUCTURE_MISMATCH));
});

test("Storyboard 合同只允许语义对象，不允许文件夹、坐标、SVG 或颜色画法", () => {
  const concrete = sequenceIntent({
    folderInsertion: { paintOrder: ["folder-back", "paper", "folder-front"] }
  });
  const review = validateVisualExpressionIntent(concrete, { sceneId: "S03" });
  assert.equal(review.valid, false);
  assert.ok(issueCodes(review).includes(VISUAL_EXPRESSION_ERROR_CODES.SCHEMA_INVALID));
  assert.ok(review.issues.some((item) => item.location.includes("folderInsertion")));
  assert.match(visualExpressionPromptDirective(), /禁止写坐标、SVG、图标、文件夹/u);
});

test("同一语义稳定解析为统一结构、文图比例、色彩预算和标题时序", () => {
  const intent = createVisualExpressionIntent(sequenceIntent(), { sceneId: "S03" });
  const first = resolveVisualExpressionPlan({ sceneId: "S03", visualIntent: intent });
  const second = resolveVisualExpressionPlan({ sceneId: "S03", visualIntent: intent });
  assert.deepEqual(first, second);
  assert.equal(first.structure, "flow");
  assert.equal(first.styleProfileId, VISUAL_EXPRESSION_STYLE_PROFILE_ID);
  assert.equal(first.acceptance.maximumAccentColors, 2);
  assert.equal(first.acceptance.minimumTextAreaRatio, 0.6);
  assert.equal(first.acceptance.maximumGraphicAreaRatio, 0.4);
  assert.equal(first.acceptance.informationCardBorderMode, "full-outline");
  assert.equal(first.acceptance.informationCardContentMode, "text-only");
  assert.equal(first.acceptance.minimumInformationCardBorderWidthPx, 2);
  assert.equal(first.acceptance.maximumInformationCardBorderWidthPx, 3);
  assert.ok(first.timing.supportingCopyStartFrame - first.timing.headlineStartFrame >= 12);
  assert.ok(first.timing.graphicStartFrame >= first.timing.supportingCopyStartFrame);
});

test("图形对象和关系必须绑定旁白主张，比较结构至少包含两个同级对象", () => {
  const unbound = sequenceIntent({
    entities: sequenceIntent().entities.map((entity, index) =>
      index === 0 ? { ...entity, claimIds: ["unknown-claim"] } : entity
    )
  });
  const unboundReview = validateVisualExpressionIntent(unbound, { sceneId: "S04" });
  assert.ok(issueCodes(unboundReview).includes(VISUAL_EXPRESSION_ERROR_CODES.UNBOUND_ELEMENT));

  const comparison = sequenceIntent({
    informationNeed: "comparison",
    contribution: "show-difference",
    relationKind: "comparison",
    entities: [sequenceIntent().entities[0]],
    relations: []
  });
  const comparisonReview = validateVisualExpressionIntent(comparison, { sceneId: "S05" });
  assert.ok(issueCodes(comparisonReview).includes(VISUAL_EXPRESSION_ERROR_CODES.STRUCTURE_MISMATCH));
});

test("证据和数量画面没有真实来源时阻断，不能用生成图冒充证据", () => {
  const evidence = sequenceIntent({
    role: "evidence",
    objective: "prove",
    informationNeed: "evidence-focus",
    contribution: "show-proof",
    relationKind: "none",
    compositionProfile: "evidence-first",
    relations: [],
    evidenceRefs: []
  });
  const review = validateVisualExpressionIntent(evidence, { sceneId: "S06" });
  assert.ok(issueCodes(review).includes(VISUAL_EXPRESSION_ERROR_CODES.EVIDENCE_PROVENANCE_MISSING));
});

test("代表帧布局验证安全区、图文比例、同级比例、颜色角色和箭头端点", () => {
  const scene = validScene();
  scene.layoutSamples = [validLayoutSample()];
  assert.equal(validateVisualExpressionScene(scene, { requireLayoutSamples: true }).valid, true);

  const invalid = structuredClone(scene);
  invalid.layoutSamples[0].elements[0].bounds.x = 20;
  invalid.layoutSamples[0].elements[1].bounds.width = 420;
  invalid.layoutSamples[0].elements[1].colorRole = "#ff0000";
  invalid.layoutSamples[0].connectors[0].arrowhead = false;
  const review = validateVisualExpressionScene(invalid, { requireLayoutSamples: true });
  const codes = issueCodes(review);
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.ELEMENT_CROPPED));
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.PEER_SCALE_MISMATCH));
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.PALETTE_ROLE_INVALID));
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.ARROWHEAD_MISSING));
});

test("代表帧会阻断第三种强调色、区域重叠和语义对象互相遮挡", () => {
  const scene = validScene();
  scene.visualIntent = createVisualExpressionIntent({
    ...sequenceIntent(),
    entities: [
      ...sequenceIntent().entities,
      { id: "check", label: "验收", semanticRole: "state", importance: "supporting", claimIds: ["claim-order"] }
    ]
  });
  scene.visualPlan = resolveVisualExpressionPlan({ sceneId: scene.id, visualIntent: scene.visualIntent });
  const sample = validLayoutSample();
  sample.elements.push({
    id: "check",
    kind: "shape",
    bounds: { x: 650, y: 590, width: 180, height: 70 },
    peerGroup: "",
    colorRole: "evidence-highlight",
    lineRole: "annotation",
    typographyRole: "node-detail",
    fontSizePx: 28,
    narrativeRole: "state"
  });
  sample.regions.graphic.y = 240;
  sample.elements[1].bounds.x = 500;
  scene.layoutSamples = [sample];
  const review = validateVisualExpressionScene(scene, { requireLayoutSamples: true });
  const codes = issueCodes(review);
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.ACCENT_LIMIT_EXCEEDED));
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.REGION_OVERLAP));
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.ELEMENT_OVERLAP));
});

test("信息卡片必须使用清晰完整边框，但非卡片图解不被强制套卡片", () => {
  const scene = validScene();
  const sample = validLayoutSample();
  scene.layoutSamples = [sample];
  assert.equal(validateVisualExpressionScene(scene, { requireLayoutSamples: true }).valid, true);

  const invalid = structuredClone(scene);
  invalid.layoutSamples[0].elements[0].borderMode = "left-rail-only";
  invalid.layoutSamples[0].elements[0].iconPlacement = "inline";
  invalid.layoutSamples[0].elements[1].borderWidthPx = 1;
  const review = validateVisualExpressionScene(invalid, { requireLayoutSamples: true });
  const codes = issueCodes(review);
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.INFORMATION_CARD_SURFACE_MISSING));
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.INFORMATION_CARD_BORDER_INVALID));
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.INFORMATION_CARD_ICON_FORBIDDEN));

  const diagramObject = structuredClone(scene);
  diagramObject.layoutSamples[0].elements[0] = {
    ...diagramObject.layoutSamples[0].elements[0],
    primitive: "timeline-anchor",
    surfaceRole: "diagram-object",
    borderMode: "shape-outline",
    borderWidthPx: null,
    borderColorRole: null,
    borderRadiusPx: null
  };
  assert.equal(
    validateVisualExpressionScene(diagramObject, { requireLayoutSamples: true }).valid,
    true
  );
});

test("连线不得穿过无关节点，非有向关系不得乱加箭头", () => {
  const scene = validScene();
  const sample = validLayoutSample();
  scene.visualIntent = createVisualExpressionIntent({
    ...sequenceIntent(),
    entities: [
      ...sequenceIntent().entities,
      { id: "obstacle", label: "说明文字", semanticRole: "concept", importance: "supporting", claimIds: ["claim-order"] }
    ]
  });
  scene.visualPlan = resolveVisualExpressionPlan({ sceneId: scene.id, visualIntent: scene.visualIntent });
  sample.elements.push({
    id: "obstacle",
    kind: "shape",
    bounds: { x: 680, y: 410, width: 180, height: 140 },
    peerGroup: "",
    colorRole: "surface-muted",
    lineRole: "annotation",
    typographyRole: "node-detail",
    fontSizePx: 28,
    narrativeRole: "annotation"
  });
  scene.layoutSamples = [sample];
  const review = validateVisualExpressionScene(scene, { requireLayoutSamples: true });
  assert.ok(issueCodes(review).includes(VISUAL_EXPRESSION_ERROR_CODES.ARROW_CROSSES_NODE));

  const comparisonIntent = createVisualExpressionIntent({
    ...sequenceIntent(),
    informationNeed: "comparison",
    contribution: "show-difference",
    relationKind: "comparison",
    relations: [{ ...sequenceIntent().relations[0], type: "compares", directed: false }]
  });
  const comparisonScene = {
    id: "S07",
    visualIntent: comparisonIntent,
    visualPlan: resolveVisualExpressionPlan({ sceneId: "S07", visualIntent: comparisonIntent }),
    layoutSamples: [validLayoutSample()]
  };
  const comparisonReview = validateVisualExpressionScene(comparisonScene, { requireLayoutSamples: true });
  assert.ok(issueCodes(comparisonReview).includes(VISUAL_EXPRESSION_ERROR_CODES.ARROW_UNJUSTIFIED));
});

test("连接线只允许水平、垂直和九十度转弯，斜线样本必须阻断", () => {
  const scene = validScene("S08");
  const sample = validLayoutSample();
  sample.connectors[0].route = [
    { x: 540, y: 480 },
    { x: 760, y: 520 },
    { x: 980, y: 480 }
  ];
  scene.layoutSamples = [sample];
  const review = validateVisualExpressionScene(scene, { requireLayoutSamples: true });
  assert.ok(
    issueCodes(review).includes(VISUAL_EXPRESSION_ERROR_CODES.CONNECTOR_NON_ORTHOGONAL),
    JSON.stringify(review.issues, null, 2)
  );
});

test("人物只有在审批、验收、目标设定或用户决策本身有解释价值时允许出现", () => {
  const scene = validScene();
  const sample = validLayoutSample();
  sample.elements[0].kind = "person";
  sample.elements[0].narrativeRole = "atmosphere";
  scene.layoutSamples = [sample];
  const review = validateVisualExpressionScene(scene, { requireLayoutSamples: true });
  assert.ok(issueCodes(review).includes(VISUAL_EXPRESSION_ERROR_CODES.PERSON_UNJUSTIFIED));
});

test("大标题必须先于小字、字幕、主图和细节，不能同时抢画面", () => {
  const scene = structuredClone(validScene());
  scene.visualPlan.timing.supportingCopyStartFrame = 0;
  scene.visualPlan.timing.subtitleStartFrame = 0;
  const review = validateVisualExpressionScene(scene);
  assert.ok(issueCodes(review).includes(VISUAL_EXPRESSION_ERROR_CODES.TITLE_NOT_FIRST));
});

test("resolver 产出的语义对象、关系、时序和验收阈值不能被篡改", () => {
  const scene = structuredClone(validScene());
  scene.visualPlan.semanticElements = [];
  scene.visualPlan.semanticRelations = [];
  scene.visualPlan.acceptance.maximumAccentColors = 99;
  const review = validateVisualExpressionScene(scene, { requireResolvedPlans: true });
  assert.ok(issueCodes(review).includes(VISUAL_EXPRESSION_ERROR_CODES.PLAN_INTEGRITY_MISMATCH));
});

test("最终保持帧必须覆盖全部语义对象和关系，并报告实际字号与文图比例", () => {
  const scene = validScene();
  const sample = validLayoutSample();
  sample.elements.pop();
  sample.connectors = [];
  sample.elements[0].fontSizePx = 18;
  sample.metrics.textAreaRatio = 0.2;
  scene.layoutSamples = [sample];
  const review = validateVisualExpressionScene(scene, { requireLayoutSamples: true });
  const codes = issueCodes(review);
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_ELEMENT_MISSING));
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_RELATION_MISSING));
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.FONT_SIZE_TOO_SMALL));
  assert.ok(codes.includes(VISUAL_EXPRESSION_ERROR_CODES.TEXT_AREA_INSUFFICIENT));
});

test("顺序和分支必须有方向，比较和层级不得滥用箭头", () => {
  const sequence = sequenceIntent({
    relations: [{ ...sequenceIntent().relations[0], directed: false }]
  });
  assert.ok(issueCodes(validateVisualExpressionIntent(sequence)).includes(
    VISUAL_EXPRESSION_ERROR_CODES.DIRECTED_RELATION_REQUIRED
  ));

  const comparison = sequenceIntent({
    informationNeed: "comparison",
    contribution: "show-difference",
    relationKind: "comparison",
    relations: [{ ...sequenceIntent().relations[0], type: "compares", directed: true }]
  });
  assert.ok(issueCodes(validateVisualExpressionIntent(comparison)).includes(
    VISUAL_EXPRESSION_ERROR_CODES.ARROW_UNJUSTIFIED
  ));
});

test("整片必须使用同一风格 profile，图形场景在最终帧 QA 必须提供布局采样", () => {
  const first = validScene("S01");
  const second = structuredClone(validScene("S02"));
  second.visualPlan.styleProfileId = "scene-local-style";
  const drift = validateVisualExpressionPlan({ scenes: [first, second] });
  assert.ok(issueCodes(drift).includes(VISUAL_EXPRESSION_ERROR_CODES.STYLE_PROFILE_DRIFT));

  const missingSamples = validateVisualExpressionPlan({ scenes: [first] }, { requireLayoutSamples: true });
  assert.ok(issueCodes(missingSamples).includes(VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLES_MISSING));
  assert.throws(
    () => assertVisualExpressionPlan({ scenes: [first] }, { requireLayoutSamples: true }),
    (error) => error.issues.some((item) => item.code === VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLES_MISSING)
  );
});
