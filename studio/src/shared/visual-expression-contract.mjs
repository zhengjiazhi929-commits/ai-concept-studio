export const VISUAL_EXPRESSION_CONTRACT_VERSION = "visual-expression-contract-v1";
export const VISUAL_EXPRESSION_STYLE_PROFILE_ID = "desktop-light-window-editorial-v3";
export const VISUAL_EXPRESSION_REVIEW_CANDIDATE_STYLE_PROFILE_ID = "visual-system-v1";
export const DETERMINISTIC_LAYOUT_SAMPLE_TYPE = "deterministic-layout-sample";
export const DETERMINISTIC_LAYOUT_SAMPLE_SCHEMA_VERSION = "deterministic-layout-sample-v1";
export const DETERMINISTIC_LAYOUT_SAMPLE_ASSURANCE = "deterministic-layout-only";
export const VISUAL_EXPRESSION_RENDERER_CONTRACT_VERSION =
  "semantic-grammar-layout-v1";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const INFORMATION_NEEDS = Object.freeze([
  "none",
  "relationship",
  "sequence",
  "comparison",
  "hierarchy",
  "branch",
  "timeline",
  "quantity",
  "state-change",
  "spatial-context",
  "evidence-focus",
  "concept-anchor",
  "human-action"
]);

const CONTRIBUTIONS = Object.freeze([
  "none",
  "explain-relationship",
  "show-order",
  "show-difference",
  "show-containment",
  "show-choice",
  "show-time",
  "show-magnitude",
  "show-state-change",
  "show-spatial-context",
  "show-proof",
  "anchor-concept"
]);

const RELATION_KINDS = Object.freeze([
  "none",
  "association",
  "sequence",
  "causal",
  "comparison",
  "hierarchy",
  "branch",
  "feedback",
  "dependency",
  "state-transition",
  "temporal",
  "quantitative"
]);

const VISUAL_STRUCTURES = Object.freeze([
  "none",
  "single-focus",
  "node-link",
  "flow",
  "comparison",
  "hierarchy",
  "branch",
  "feedback-loop",
  "timeline",
  "quantity",
  "state-change",
  "spatial",
  "evidence",
  "human-decision"
]);

const NARRATIVE_ROLES = Object.freeze([
  "statement",
  "explanation",
  "evidence"
]);

const OBJECTIVES = Object.freeze([
  "orient",
  "explain",
  "compare",
  "prove",
  "show-change",
  "summarize"
]);

const COMPOSITION_PROFILES = Object.freeze([
  "text-first",
  "relation-first",
  "evidence-first"
]);

const SEMANTIC_ROLES = Object.freeze([
  "concept",
  "source",
  "step",
  "state",
  "evidence",
  "result",
  "decision",
  "boundary",
  "actor",
  "metric",
  "time-anchor",
  "location"
]);

const IMPORTANCE_LEVELS = Object.freeze(["primary", "secondary", "supporting"]);

export const VISUAL_EXPRESSION_ERROR_CODES = deepFreeze({
  SCHEMA_INVALID: "visual-expression-schema-invalid",
  INTENT_MISSING: "visual-expression-intent-missing",
  QUESTION_MISSING: "visual-expression-question-missing",
  GRAPHIC_REQUIRED: "visual-expression-graphic-required",
  GRAPHIC_UNJUSTIFIED: "visual-expression-graphic-unjustified",
  EXPLANATION_MISSING: "visual-expression-explanation-missing",
  STRUCTURE_MISMATCH: "visual-expression-structure-mismatch",
  SOURCE_BINDING_MISSING: "visual-expression-source-binding-missing",
  UNBOUND_ELEMENT: "visual-expression-unbound-element",
  ENHANCEMENT_INVALID: "visual-expression-enhancement-invalid",
  COMPLEXITY_EXCEEDED: "visual-expression-complexity-exceeded",
  EVIDENCE_PROVENANCE_MISSING: "visual-expression-evidence-provenance-missing",
  HIERARCHY_CYCLE: "visual-expression-hierarchy-cycle",
  STYLE_PROFILE_MISSING: "visual-expression-style-profile-missing",
  STYLE_PROFILE_DRIFT: "visual-expression-style-profile-drift",
  PLAN_INTEGRITY_MISMATCH: "visual-expression-plan-integrity-mismatch",
  LAYOUT_SAMPLES_MISSING: "visual-expression-layout-samples-missing",
  LAYOUT_SAMPLE_PROVENANCE_INVALID: "visual-expression-layout-sample-provenance-invalid",
  LAYOUT_SAMPLE_VERSION_MISMATCH: "visual-expression-layout-sample-version-mismatch",
  LAYOUT_SAMPLE_RENDERER_MISMATCH: "visual-expression-layout-sample-renderer-mismatch",
  LAYOUT_SAMPLE_STYLE_MISMATCH: "visual-expression-layout-sample-style-mismatch",
  LAYOUT_SAMPLE_RENDER_BINDING_MISMATCH:
    "visual-expression-layout-sample-render-binding-mismatch",
  LAYOUT_ELEMENT_MISSING: "visual-expression-layout-element-missing",
  LAYOUT_RELATION_MISSING: "visual-expression-layout-relation-missing",
  LAYOUT_RELATION_DUPLICATED: "visual-expression-layout-relation-duplicated",
  PALETTE_ROLE_INVALID: "visual-expression-palette-role-invalid",
  ACCENT_LIMIT_EXCEEDED: "visual-expression-accent-limit-exceeded",
  STATE_COLOR_UNJUSTIFIED: "visual-expression-state-color-unjustified",
  LINE_ROLE_INVALID: "visual-expression-line-role-invalid",
  INFORMATION_CARD_SURFACE_MISSING:
    "visual-expression-information-card-surface-missing",
  INFORMATION_CARD_BORDER_INVALID:
    "visual-expression-information-card-border-invalid",
  INFORMATION_CARD_ICON_FORBIDDEN:
    "visual-expression-information-card-icon-forbidden",
  TYPOGRAPHY_ROLE_INVALID: "visual-expression-typography-role-invalid",
  FONT_SIZE_TOO_SMALL: "visual-expression-font-size-too-small",
  TEXT_AREA_INSUFFICIENT: "visual-expression-text-area-insufficient",
  PEER_SCALE_MISMATCH: "visual-expression-peer-scale-mismatch",
  GRAPHIC_AREA_EXCEEDED: "visual-expression-graphic-area-exceeded",
  GRAPHIC_SCALE_EXCEEDED: "visual-expression-graphic-scale-exceeded",
  WHITESPACE_INSUFFICIENT: "visual-expression-whitespace-insufficient",
  ELEMENT_CROPPED: "visual-expression-element-cropped",
  ELEMENT_OVERLAP: "visual-expression-element-overlap",
  REGION_OVERLAP: "visual-expression-region-overlap",
  ARROW_UNJUSTIFIED: "visual-expression-arrow-unjustified",
  DIRECTED_RELATION_REQUIRED: "visual-expression-directed-relation-required",
  ARROWHEAD_MISSING: "visual-expression-arrowhead-missing",
  ARROW_ENDPOINT_INVALID: "visual-expression-arrow-endpoint-invalid",
  CONNECTOR_NON_ORTHOGONAL: "visual-expression-connector-non-orthogonal",
  ARROW_CROSSES_NODE: "visual-expression-arrow-crosses-node",
  ARROW_CROSSING: "visual-expression-arrow-crossing",
  PERSON_UNJUSTIFIED: "visual-expression-person-unjustified",
  TITLE_NOT_FIRST: "visual-expression-title-not-first"
});

export const VISUAL_EXPRESSION_STYLE_POLICY = deepFreeze({
  profileId: VISUAL_EXPRESSION_STYLE_PROFILE_ID,
  shapeLanguage: "flat-geometric-2d",
  depthMode: "flat-only",
  paletteMode: "semantic-token-roles",
  colorRoles: [
    "canvas",
    "surface",
    "surface-muted",
    "text-primary",
    "text-secondary",
    "line-primary",
    "line-secondary",
    "accent-primary",
    "accent-secondary",
    "state-success",
    "state-warning",
    "state-error",
    "evidence-highlight"
  ],
  stateColorRoles: ["state-success", "state-warning", "state-error"],
  lineRoles: ["boundary", "relationship-primary", "relationship-secondary", "annotation"],
  typographyRoles: [
    "headline",
    "supporting",
    "stage-title",
    "node-label",
    "node-detail",
    "caption",
    "evidence-label"
  ],
  compositionProfiles: {
    "text-first": { minimumTextAreaRatio: 0.6, maximumGraphicAreaRatio: 0.4 },
    "relation-first": { minimumTextAreaRatio: 0.3, maximumGraphicAreaRatio: 0.7 },
    "evidence-first": { minimumTextAreaRatio: 0.2, maximumGraphicAreaRatio: 0.8 }
  },
  geometry: {
    minimumRegionGapPx: 24,
    maximumSingleGraphicWidthRatio: 0.34,
    maximumSingleGraphicHeightRatio: 0.38,
    peerScaleToleranceRatio: 0.08
  },
  typography: {
    minimumBodyFontPx: 28,
    minimumStageTitleFontPx: 46,
    samePeerRoleRequired: true
  },
  surfaces: {
    informationCard: {
      surfaceRole: "information-card",
      contentMode: "text-only",
      borderMode: "full-outline",
      minimumBorderWidthPx: 2,
      maximumBorderWidthPx: 3,
      allowedBorderColorRoles: ["line-primary", "accent-primary", "accent-secondary"],
      minimumBorderRadiusPx: 14,
      maximumBorderRadiusPx: 24,
      shadowMode: "none"
    }
  },
  complexity: {
    maximumAccentColors: 2,
    maximumVisibleEntities: 12,
    maximumSimultaneousHighlights: 3,
    maximumSimultaneousMotionObjects: 3
  },
  timing: {
    headlineStartFrame: 0,
    supportingCopyStartFrame: 18,
    graphicStartFrame: 28,
    detailCopyStartFrame: 42,
    subtitleStartFrame: 18,
    minimumHeadlineLeadFrames: 12,
    mode: "frame-driven-semantic"
  },
  people: {
    mode: "semantic-only",
    allowedNarrativeRoles: ["approval", "acceptance", "goal-setting", "user-decision"]
  },
  forbidden: [
    "card-everything",
    "icon-wall",
    "decorative-arrow",
    "pseudo-3d",
    "perspective-illustration",
    "heavy-shadow",
    "decorative-gradient",
    "raw-color-value",
    "scene-local-font-scale",
    "css-animation",
    "css-transition"
  ]
});

const closedSchema = (properties, required = Object.keys(properties)) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required
});

export const VISUAL_EXPRESSION_INTENT_JSON_SCHEMA = deepFreeze(closedSchema({
  schemaVersion: { type: "string", enum: [VISUAL_EXPRESSION_CONTRACT_VERSION] },
  question: { type: "string", minLength: 1 },
  takeaway: { type: "string", minLength: 1 },
  role: { type: "string", enum: NARRATIVE_ROLES },
  objective: { type: "string", enum: OBJECTIVES },
  informationNeed: { type: "string", enum: INFORMATION_NEEDS },
  contribution: { type: "string", enum: CONTRIBUTIONS },
  contributionRationale: { type: "string", minLength: 1 },
  relationKind: { type: "string", enum: RELATION_KINDS },
  compositionProfile: { type: "string", enum: COMPOSITION_PROFILES },
  claims: {
    type: "array",
    minItems: 1,
    maxItems: 12,
    items: closedSchema({
      id: { type: "string", minLength: 1 },
      text: { type: "string", minLength: 1 },
      visualRequired: { type: "boolean" },
      evidenceRefs: { type: "array", items: { type: "string", minLength: 1 } }
    })
  },
  entities: {
    type: "array",
    maxItems: VISUAL_EXPRESSION_STYLE_POLICY.complexity.maximumVisibleEntities,
    items: closedSchema({
      id: { type: "string", minLength: 1 },
      label: { type: "string", minLength: 1 },
      semanticRole: { type: "string", enum: SEMANTIC_ROLES },
      importance: { type: "string", enum: IMPORTANCE_LEVELS },
      claimIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } }
    })
  },
  relations: {
    type: "array",
    maxItems: 18,
    items: closedSchema({
      id: { type: "string", minLength: 1 },
      from: { type: "string", minLength: 1 },
      to: { type: "string", minLength: 1 },
      type: { type: "string", minLength: 1 },
      label: { type: "string" },
      directed: { type: "boolean" },
      claimIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } }
    })
  },
  evidenceRefs: { type: "array", items: { type: "string", minLength: 1 } },
  mustNotShow: { type: "array", items: { type: "string", minLength: 1 } }
}));

const INTENT_KEYS = Object.freeze(Object.keys(VISUAL_EXPRESSION_INTENT_JSON_SCHEMA.properties));
const CLAIM_KEYS = Object.freeze(["id", "text", "visualRequired", "evidenceRefs"]);
const ENTITY_KEYS = Object.freeze(["id", "label", "semanticRole", "importance", "claimIds"]);
const RELATION_KEYS = Object.freeze(["id", "from", "to", "type", "label", "directed", "claimIds"]);
const FORBIDDEN_RENDER_FIELDS = new Set([
  "x", "y", "width", "height", "path", "svg", "icon", "shape", "color", "hexColor",
  "strokeWidth", "borderRadius", "shadow", "gradient", "rotation", "paintOrder",
  "folderInsertion", "primaryIllustration"
]);

const expectedContributionByNeed = deepFreeze({
  none: ["none"],
  relationship: ["explain-relationship"],
  sequence: ["show-order"],
  comparison: ["show-difference"],
  hierarchy: ["show-containment"],
  branch: ["show-choice"],
  timeline: ["show-time"],
  quantity: ["show-magnitude"],
  "state-change": ["show-state-change"],
  "spatial-context": ["show-spatial-context"],
  "evidence-focus": ["show-proof"],
  "concept-anchor": ["anchor-concept"],
  "human-action": ["show-choice", "show-state-change", "explain-relationship"]
});

const relationKindsByNeed = deepFreeze({
  none: ["none"],
  relationship: ["association", "causal", "feedback", "dependency"],
  sequence: ["sequence"],
  comparison: ["comparison"],
  hierarchy: ["hierarchy"],
  branch: ["branch"],
  timeline: ["temporal"],
  quantity: ["quantitative"],
  "state-change": ["state-transition"],
  "spatial-context": ["association"],
  "evidence-focus": ["none", "association"],
  "concept-anchor": ["none", "association"],
  "human-action": ["association", "branch", "dependency", "state-transition"]
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function exactKeys(value, keys) {
  return isObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function issue(code, sceneId, location, actual, expected, message, suggestedFix = "") {
  return { code, sceneId: sceneId ?? null, location, actual, expected, message, suggestedFix };
}

function uniqueStrings(values) {
  return Array.isArray(values) &&
    values.every((value) => nonEmpty(value) && value === value.trim()) &&
    new Set(values).size === values.length;
}

function nonEmptyUniqueStrings(values) {
  return uniqueStrings(values) && values.length > 0;
}

function sameStructuredValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasRawRenderingInstruction(value, path = "visualIntent") {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = hasRawRenderingInstruction(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RENDER_FIELDS.has(key)) return `${path}.${key}`;
    const found = hasRawRenderingInstruction(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

function visualStructureForIntent(intent) {
  if (!intent || intent.informationNeed === "none") return "none";
  if (intent.informationNeed === "concept-anchor") return "single-focus";
  if (intent.informationNeed === "comparison") return "comparison";
  if (intent.informationNeed === "sequence") return "flow";
  if (intent.informationNeed === "hierarchy") return "hierarchy";
  if (intent.informationNeed === "branch") return "branch";
  if (intent.informationNeed === "timeline") return "timeline";
  if (intent.informationNeed === "quantity") return "quantity";
  if (intent.informationNeed === "state-change") return "state-change";
  if (intent.informationNeed === "spatial-context") return "spatial";
  if (intent.informationNeed === "evidence-focus") return "evidence";
  if (intent.informationNeed === "human-action") return "human-decision";
  if (intent.relationKind === "feedback") return "feedback-loop";
  if (["causal", "dependency"].includes(intent.relationKind)) return "flow";
  return "node-link";
}

function readingDirectionForStructure(structure) {
  if (["single-focus", "evidence", "none"].includes(structure)) return "center-out";
  if (structure === "hierarchy") return "top-to-bottom";
  return "left-to-right";
}

function hierarchyHasCycle(entities, relations) {
  const adjacency = new Map(entities.map((entity) => [entity.id, []]));
  for (const relation of relations) adjacency.get(relation.from)?.push(relation.to);
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return entities.some((entity) => visit(entity.id));
}

export function validateVisualExpressionIntent(intent, options = {}) {
  const sceneId = options.sceneId ?? null;
  const issues = [];
  const add = (...args) => issues.push(issue(...args));
  if (!isObject(intent)) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.INTENT_MISSING,
      sceneId,
      "visualIntent",
      intent ?? null,
      VISUAL_EXPRESSION_CONTRACT_VERSION,
      "场景缺少结构化视觉意图",
      "先写观众问题、结论、信息关系和图形贡献，再选择具体组件"
    );
    return { valid: false, passed: false, issues };
  }
  if (!exactKeys(intent, INTENT_KEYS) || intent.schemaVersion !== VISUAL_EXPRESSION_CONTRACT_VERSION) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.SCHEMA_INVALID,
      sceneId,
      "visualIntent",
      Object.keys(intent),
      INTENT_KEYS,
      "视觉意图字段或版本不符合合同"
    );
  }
  const forbiddenPath = hasRawRenderingInstruction(intent);
  if (forbiddenPath) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.SCHEMA_INVALID,
      sceneId,
      forbiddenPath,
      "render-specific-field",
      "semantic-only",
      "Storyboard 视觉合同不得写坐标、SVG、图标、颜色或某个物体的画法",
      "改写为观众需要理解的对象、关系和信息贡献"
    );
  }
  if (!nonEmpty(intent.question)) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.QUESTION_MISSING,
      sceneId,
      "visualIntent.question",
      intent.question ?? null,
      "non-empty",
      "没有说明这张画面替观众回答什么问题"
    );
  }
  if (!nonEmpty(intent.takeaway) || !nonEmpty(intent.contributionRationale)) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.EXPLANATION_MISSING,
      sceneId,
      "visualIntent",
      { takeaway: intent.takeaway, contributionRationale: intent.contributionRationale },
      "non-empty takeaway and rationale",
      "必须写清观众最终理解什么，以及删掉图形会损失什么理解"
    );
  }
  for (const [value, allowed, location] of [
    [intent.role, NARRATIVE_ROLES, "visualIntent.role"],
    [intent.objective, OBJECTIVES, "visualIntent.objective"],
    [intent.informationNeed, INFORMATION_NEEDS, "visualIntent.informationNeed"],
    [intent.contribution, CONTRIBUTIONS, "visualIntent.contribution"],
    [intent.relationKind, RELATION_KINDS, "visualIntent.relationKind"],
    [intent.compositionProfile, COMPOSITION_PROFILES, "visualIntent.compositionProfile"]
  ]) {
    if (!allowed.includes(value)) {
      add(VISUAL_EXPRESSION_ERROR_CODES.SCHEMA_INVALID, sceneId, location, value, allowed, "视觉意图枚举值无效");
    }
  }

  const claims = Array.isArray(intent.claims) ? intent.claims : [];
  const entities = Array.isArray(intent.entities) ? intent.entities : [];
  const relations = Array.isArray(intent.relations) ? intent.relations : [];
  const evidenceRefs = Array.isArray(intent.evidenceRefs) ? intent.evidenceRefs : [];
  if (
    claims.length === 0 ||
    !claims.every((claim) =>
      exactKeys(claim, CLAIM_KEYS) && nonEmpty(claim.id) && nonEmpty(claim.text) &&
      typeof claim.visualRequired === "boolean" && uniqueStrings(claim.evidenceRefs)
    ) ||
    new Set(claims.map((claim) => claim.id)).size !== claims.length
  ) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.SOURCE_BINDING_MISSING,
      sceneId,
      "visualIntent.claims",
      claims,
      "unique claims with source bindings",
      "每个画面必须绑定至少一个明确主张"
    );
  }
  const claimIds = new Set(claims.map((claim) => claim.id));
  if (
    !entities.every((entity) =>
      exactKeys(entity, ENTITY_KEYS) && nonEmpty(entity.id) && nonEmpty(entity.label) &&
      SEMANTIC_ROLES.includes(entity.semanticRole) && IMPORTANCE_LEVELS.includes(entity.importance) &&
      nonEmptyUniqueStrings(entity.claimIds)
    ) ||
    new Set(entities.map((entity) => entity.id)).size !== entities.length
  ) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.SCHEMA_INVALID,
      sceneId,
      "visualIntent.entities",
      entities,
      "unique semantic entities",
      "视觉对象必须只有语义身份，不得夹带具体画法"
    );
  }
  const entityIds = new Set(entities.map((entity) => entity.id));
  if (
    !relations.every((relation) =>
      exactKeys(relation, RELATION_KEYS) && nonEmpty(relation.id) && nonEmpty(relation.from) &&
      nonEmpty(relation.to) && nonEmpty(relation.type) && typeof relation.label === "string" &&
      typeof relation.directed === "boolean" && nonEmptyUniqueStrings(relation.claimIds)
    ) ||
    new Set(relations.map((relation) => relation.id)).size !== relations.length
  ) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.SCHEMA_INVALID,
      sceneId,
      "visualIntent.relations",
      relations,
      "unique semantic relations",
      "关系必须声明端点、关系类型、是否有方向及来源主张"
    );
  }

  const invalidBindings = [
    ...entities.flatMap((entity) => entity.claimIds ?? []),
    ...relations.flatMap((relation) => relation.claimIds ?? [])
  ].filter((claimId) => !claimIds.has(claimId));
  const invalidEndpoints = relations.filter(
    (relation) => !entityIds.has(relation.from) || !entityIds.has(relation.to) || relation.from === relation.to
  );
  if (invalidBindings.length > 0 || invalidEndpoints.length > 0) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.UNBOUND_ELEMENT,
      sceneId,
      "visualIntent.entities|relations",
      { invalidBindings, invalidEndpoints: invalidEndpoints.map((relation) => relation.id) },
      "all elements bound to declared claims and endpoints",
      "图形元素和关系不得脱离旁白主张独立存在"
    );
  }

  const graphicRequired = intent.informationNeed !== "none" || claims.some((claim) => claim.visualRequired);
  if (graphicRequired && entities.length === 0) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.GRAPHIC_REQUIRED,
      sceneId,
      "visualIntent.entities",
      0,
      ">= 1",
      "内容包含关系、顺序、对比或证据，但视觉计划仍是纯文字"
    );
  }
  if (!graphicRequired && (entities.length > 0 || relations.length > 0)) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.GRAPHIC_UNJUSTIFIED,
      sceneId,
      "visualIntent",
      { entityCount: entities.length, relationCount: relations.length },
      "text-only",
      "单一主张不应为了填空白添加装饰图"
    );
  }
  if (
    !expectedContributionByNeed[intent.informationNeed]?.includes(intent.contribution) ||
    !relationKindsByNeed[intent.informationNeed]?.includes(intent.relationKind)
  ) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.ENHANCEMENT_INVALID,
      sceneId,
      "visualIntent.contribution|relationKind",
      { contribution: intent.contribution, relationKind: intent.relationKind },
      {
        contribution: expectedContributionByNeed[intent.informationNeed] ?? [],
        relationKind: relationKindsByNeed[intent.informationNeed] ?? []
      },
      "图形贡献或关系类型与观众的信息需求不对应",
      "先确定比较、顺序、层级、证据等信息需求，再选择视觉语法"
    );
  }
  const needsRelations = ["relationship", "sequence", "comparison", "hierarchy", "branch", "timeline", "state-change", "human-action"];
  if (needsRelations.includes(intent.informationNeed) && relations.length === 0) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.STRUCTURE_MISMATCH,
      sceneId,
      "visualIntent.relations",
      0,
      ">= 1",
      "声明要解释关系，却没有定义任何可验证关系"
    );
  }
  if (intent.informationNeed === "comparison" && entities.length < 2) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.STRUCTURE_MISMATCH,
      sceneId,
      "visualIntent.entities",
      entities.length,
      ">= 2",
      "对比至少需要两个同级对象"
    );
  }
  const directedRelationTypes = new Set([
    "then", "branches-to", "causes", "depends-on", "feeds-back",
    "state-transition", "temporal-order", "contributes-to"
  ]);
  const wronglyUndirected = relations.filter(
    (relation) => directedRelationTypes.has(relation.type) && relation.directed !== true
  );
  const minimumDirectedRelations = intent.informationNeed === "branch" ? 2 :
    ["sequence", "timeline", "state-change"].includes(intent.informationNeed) ? 1 : 0;
  const directedRelationCount = relations.filter((relation) => relation.directed === true).length;
  if (wronglyUndirected.length > 0 || directedRelationCount < minimumDirectedRelations) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.DIRECTED_RELATION_REQUIRED,
      sceneId,
      "visualIntent.relations",
      {
        wronglyUndirected: wronglyUndirected.map((relation) => relation.id),
        directedRelationCount
      },
      { minimumDirectedRelations },
      "顺序、分支、因果、依赖、反馈、状态变化和时间关系必须声明方向"
    );
  }
  if (
    ["comparison", "hierarchy"].includes(intent.informationNeed) &&
    relations.some((relation) => relation.directed === true)
  ) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.ARROW_UNJUSTIFIED,
      sceneId,
      "visualIntent.relations",
      relations.filter((relation) => relation.directed === true).map((relation) => relation.id),
      "undirected peer or containment relations",
      "比较和层级关系使用无箭头关系线，不能误导成流程"
    );
  }
  if (
    intent.informationNeed === "branch" &&
    (entities.length < 3 || relations.length < 2 || relations.some((relation) => !nonEmpty(relation.label)))
  ) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.STRUCTURE_MISMATCH,
      sceneId,
      "visualIntent.relations",
      relations,
      "labeled root-to-outcome branches",
      "分支必须有根节点、条件标签和至少两个结果"
    );
  }
  if (intent.informationNeed === "hierarchy" && hierarchyHasCycle(entities, relations)) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.HIERARCHY_CYCLE,
      sceneId,
      "visualIntent.relations",
      relations.map((relation) => relation.id),
      "acyclic",
      "组成或归属层级不能形成循环"
    );
  }
  const coveredClaimIds = new Set([
    ...entities.flatMap((entity) => entity.claimIds ?? []),
    ...relations.flatMap((relation) => relation.claimIds ?? [])
  ]);
  const uncoveredClaims = claims
    .filter((claim) => claim.visualRequired && !coveredClaimIds.has(claim.id))
    .map((claim) => claim.id);
  if (uncoveredClaims.length > 0) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.SOURCE_BINDING_MISSING,
      sceneId,
      "visualIntent.claims",
      uncoveredClaims,
      "all visualRequired claims covered",
      "要求图形表达的主张没有被任何对象或关系覆盖"
    );
  }
  if (
    (intent.role === "evidence" || ["evidence-focus", "quantity"].includes(intent.informationNeed)) &&
    (evidenceRefs.length === 0 || !uniqueStrings(evidenceRefs))
  ) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.EVIDENCE_PROVENANCE_MISSING,
      sceneId,
      "visualIntent.evidenceRefs",
      evidenceRefs,
      ">= 1 source reference",
      "证据或数量画面必须绑定真实来源，生成图不能冒充证据"
    );
  }
  if (entities.length > VISUAL_EXPRESSION_STYLE_POLICY.complexity.maximumVisibleEntities) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.COMPLEXITY_EXCEEDED,
      sceneId,
      "visualIntent.entities",
      entities.length,
      VISUAL_EXPRESSION_STYLE_POLICY.complexity.maximumVisibleEntities,
      "单屏语义对象过多，应拆镜头而不是缩小文字"
    );
  }
  return { valid: issues.length === 0, passed: issues.length === 0, issues };
}

export class VisualExpressionContractError extends Error {
  constructor(message, issues) {
    super(message);
    this.name = "VisualExpressionContractError";
    this.issues = issues;
  }
}

export function createVisualExpressionIntent(input, options = {}) {
  const intent = structuredClone({
    schemaVersion: VISUAL_EXPRESSION_CONTRACT_VERSION,
    ...input
  });
  const review = validateVisualExpressionIntent(intent, options);
  if (!review.valid) {
    throw new VisualExpressionContractError(
      `视觉意图未通过合同：${review.issues.map((item) => item.code).join("、")}`,
      review.issues
    );
  }
  return deepFreeze(intent);
}

export function resolveVisualExpressionPlan({ sceneId, visualIntent, styleProfileId } = {}) {
  const review = validateVisualExpressionIntent(visualIntent, { sceneId });
  if (!review.valid) {
    throw new VisualExpressionContractError(
      `场景 ${sceneId ?? "unknown"} 无法解析视觉计划`,
      review.issues
    );
  }
  const structure = visualStructureForIntent(visualIntent);
  const profileId = styleProfileId ?? VISUAL_EXPRESSION_STYLE_PROFILE_ID;
  return deepFreeze({
    schemaVersion: VISUAL_EXPRESSION_CONTRACT_VERSION,
    sceneId,
    visualMode: structure === "none" ? "text-only" : "graphic",
    structure,
    readingDirection: readingDirectionForStructure(structure),
    compositionProfile: visualIntent.compositionProfile,
    styleProfileId: profileId,
    claimIds: visualIntent.claims.map((claim) => claim.id),
    semanticElements: visualIntent.entities.map((entity) => ({ ...entity })),
    semanticRelations: visualIntent.relations.map((relation) => ({ ...relation })),
    timing: { ...VISUAL_EXPRESSION_STYLE_POLICY.timing },
    acceptance: {
      paletteMode: VISUAL_EXPRESSION_STYLE_POLICY.paletteMode,
      maximumAccentColors: VISUAL_EXPRESSION_STYLE_POLICY.complexity.maximumAccentColors,
      maximumVisibleEntities: VISUAL_EXPRESSION_STYLE_POLICY.complexity.maximumVisibleEntities,
      maximumSimultaneousHighlights:
        VISUAL_EXPRESSION_STYLE_POLICY.complexity.maximumSimultaneousHighlights,
      maximumSimultaneousMotionObjects:
        VISUAL_EXPRESSION_STYLE_POLICY.complexity.maximumSimultaneousMotionObjects,
      minimumRegionGapPx: VISUAL_EXPRESSION_STYLE_POLICY.geometry.minimumRegionGapPx,
      minimumBodyFontPx: VISUAL_EXPRESSION_STYLE_POLICY.typography.minimumBodyFontPx,
      minimumStageTitleFontPx: VISUAL_EXPRESSION_STYLE_POLICY.typography.minimumStageTitleFontPx,
      informationCardSurfaceRole:
        VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard.surfaceRole,
      informationCardContentMode:
        VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard.contentMode,
      informationCardBorderMode:
        VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard.borderMode,
      minimumInformationCardBorderWidthPx:
        VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard.minimumBorderWidthPx,
      maximumInformationCardBorderWidthPx:
        VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard.maximumBorderWidthPx,
      allowedInformationCardBorderColorRoles: [
        ...VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard.allowedBorderColorRoles
      ],
      minimumInformationCardBorderRadiusPx:
        VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard.minimumBorderRadiusPx,
      maximumInformationCardBorderRadiusPx:
        VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard.maximumBorderRadiusPx,
      informationCardShadowMode:
        VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard.shadowMode,
      ...VISUAL_EXPRESSION_STYLE_POLICY.compositionProfiles[visualIntent.compositionProfile]
    }
  });
}

function finiteRect(rect) {
  return isObject(rect) && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 && rect.height > 0;
}

function rectRight(rect) { return rect.x + rect.width; }
function rectBottom(rect) { return rect.y + rect.height; }

function containsRect(outer, inner) {
  return finiteRect(outer) && finiteRect(inner) &&
    inner.x >= outer.x && inner.y >= outer.y &&
    rectRight(inner) <= rectRight(outer) && rectBottom(inner) <= rectBottom(outer);
}

function rectIntersectionArea(left, right) {
  if (!finiteRect(left) || !finiteRect(right)) return Number.POSITIVE_INFINITY;
  const width = Math.max(0, Math.min(rectRight(left), rectRight(right)) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(rectBottom(left), rectBottom(right)) - Math.max(left.y, right.y));
  return width * height;
}

function rectGap(left, right) {
  const horizontal = Math.max(left.x - rectRight(right), right.x - rectRight(left), 0);
  const vertical = Math.max(left.y - rectBottom(right), right.y - rectBottom(left), 0);
  return Math.max(horizontal, vertical);
}

function graphicEnvelope(elements) {
  if (elements.length === 0) return null;
  const x = Math.min(...elements.map((element) => element.bounds.x));
  const y = Math.min(...elements.map((element) => element.bounds.y));
  const right = Math.max(...elements.map((element) => rectRight(element.bounds)));
  const bottom = Math.max(...elements.map((element) => rectBottom(element.bounds)));
  return { x, y, width: right - x, height: bottom - y };
}

function orientation(a, b, c) {
  return Math.sign((b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y));
}

function segmentsCross(a, b, c, d) {
  return orientation(a, b, c) !== orientation(a, b, d) &&
    orientation(c, d, a) !== orientation(c, d, b);
}

function pointInsideRect(point, rect, inset = 0.001) {
  return point.x > rect.x + inset && point.x < rectRight(rect) - inset &&
    point.y > rect.y + inset && point.y < rectBottom(rect) - inset;
}

function segmentCrossesRect(a, b, rect) {
  if (pointInsideRect(a, rect) || pointInsideRect(b, rect)) return true;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rectRight(rect), y: rect.y },
    { x: rectRight(rect), y: rectBottom(rect) },
    { x: rect.x, y: rectBottom(rect) }
  ];
  return corners.some((corner, index) =>
    segmentsCross(a, b, corner, corners[(index + 1) % corners.length])
  );
}

function connectorSegments(connector) {
  const route = Array.isArray(connector.route) ? connector.route : [];
  return route.slice(0, -1).map((point, index) => [point, route[index + 1]]);
}

function validateLayoutSample(scene, plan, sample) {
  const sceneId = scene.id ?? plan.sceneId ?? null;
  const issues = [];
  const add = (...args) => issues.push(issue(...args));
  const canvas = sample?.canvas;
  const safeArea = sample?.safeArea;
  const elements = Array.isArray(sample?.elements) ? sample.elements : [];
  const connectors = Array.isArray(sample?.connectors) ? sample.connectors : [];
  if (!finiteRect(canvas) || !finiteRect(safeArea) || !containsRect(canvas, safeArea)) {
    add(VISUAL_EXPRESSION_ERROR_CODES.SCHEMA_INVALID, sceneId, "layoutSample", sample, "finite canvas and safeArea", "布局采样缺少有效画布或安全区");
    return issues;
  }
  const regions = Object.values(sample?.regions ?? {}).filter(Boolean);
  for (let leftIndex = 0; leftIndex < regions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < regions.length; rightIndex += 1) {
      const left = regions[leftIndex];
      const right = regions[rightIndex];
      if (rectIntersectionArea(left, right) > 0) {
        add(VISUAL_EXPRESSION_ERROR_CODES.REGION_OVERLAP, sceneId, "layoutSample.regions", [leftIndex, rightIndex], 0, "标题、图形和字幕区域不得重叠");
      } else if (rectGap(left, right) < plan.acceptance.minimumRegionGapPx) {
        add(VISUAL_EXPRESSION_ERROR_CODES.WHITESPACE_INSUFFICIENT, sceneId, "layoutSample.regions", rectGap(left, right), plan.acceptance.minimumRegionGapPx, "主要信息区域之间留白不足");
      }
    }
  }
  const semanticIds = new Set(plan.semanticElements.map((element) => element.id));
  const elementIds = new Set();
  const accentRoles = new Set();
  for (const element of elements) {
    if (!nonEmpty(element.id) || elementIds.has(element.id) || !semanticIds.has(element.id) || !finiteRect(element.bounds)) {
      add(VISUAL_EXPRESSION_ERROR_CODES.UNBOUND_ELEMENT, sceneId, "layoutSample.elements", element, "unique element bound to semantic plan", "最终图形必须能回指视觉合同中的语义 ID");
      continue;
    }
    elementIds.add(element.id);
    if (!containsRect(safeArea, element.bounds)) {
      add(VISUAL_EXPRESSION_ERROR_CODES.ELEMENT_CROPPED, sceneId, `layoutSample.elements.${element.id}.bounds`, element.bounds, safeArea, "图形越出安全区或发生裁切");
    }
    if (!VISUAL_EXPRESSION_STYLE_POLICY.colorRoles.includes(element.colorRole) || /^#|rgb|hsl/iu.test(String(element.colorRole ?? ""))) {
      add(VISUAL_EXPRESSION_ERROR_CODES.PALETTE_ROLE_INVALID, sceneId, `layoutSample.elements.${element.id}.colorRole`, element.colorRole, VISUAL_EXPRESSION_STYLE_POLICY.colorRoles, "场景只能引用颜色角色，不能自定义颜色值");
    }
    if (
      ["accent-primary", "accent-secondary", "evidence-highlight"].includes(element.colorRole) ||
      VISUAL_EXPRESSION_STYLE_POLICY.stateColorRoles.includes(element.colorRole)
    ) {
      accentRoles.add(element.colorRole);
    }
    if (VISUAL_EXPRESSION_STYLE_POLICY.stateColorRoles.includes(element.colorRole) && scene.visualIntent.evidenceRefs.length === 0) {
      add(VISUAL_EXPRESSION_ERROR_CODES.STATE_COLOR_UNJUSTIFIED, sceneId, `layoutSample.elements.${element.id}.colorRole`, element.colorRole, "evidence-backed state", "成功、警告和错误色必须绑定可验证状态");
    }
    if (!VISUAL_EXPRESSION_STYLE_POLICY.lineRoles.includes(element.lineRole)) {
      add(VISUAL_EXPRESSION_ERROR_CODES.LINE_ROLE_INVALID, sceneId, `layoutSample.elements.${element.id}.lineRole`, element.lineRole, VISUAL_EXPRESSION_STYLE_POLICY.lineRoles, "线条必须使用统一角色"
      );
    }
    const informationCardSurface =
      element.surfaceRole ===
      VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard.surfaceRole;
    if (informationCardSurface) {
      const surfacePolicy = VISUAL_EXPRESSION_STYLE_POLICY.surfaces.informationCard;
      if (element.iconPlacement !== "none") {
        add(
          VISUAL_EXPRESSION_ERROR_CODES.INFORMATION_CARD_ICON_FORBIDDEN,
          sceneId,
          `layoutSample.elements.${element.id}.iconPlacement`,
          element.iconPlacement ?? null,
          "none",
          "信息卡只承载文字；需要图标时应把图标作为卡片外独立图解对象"
        );
      }
      if (
        element.borderMode !== surfacePolicy.borderMode ||
        element.shadowMode !== surfacePolicy.shadowMode
      ) {
        add(
          VISUAL_EXPRESSION_ERROR_CODES.INFORMATION_CARD_SURFACE_MISSING,
          sceneId,
          `layoutSample.elements.${element.id}.surfaceRole`,
          {
            surfaceRole: element.surfaceRole,
            borderMode: element.borderMode,
            shadowMode: element.shadowMode
          },
          {
            surfaceRole: surfacePolicy.surfaceRole,
            borderMode: surfacePolicy.borderMode,
            shadowMode: surfacePolicy.shadowMode
          },
          "信息卡片必须使用完整外框且保持无阴影；不是卡片的图解对象不应冒充卡片"
        );
      }
      const borderWidthValid =
        Number.isFinite(element.borderWidthPx) &&
        element.borderWidthPx >= surfacePolicy.minimumBorderWidthPx &&
        element.borderWidthPx <= surfacePolicy.maximumBorderWidthPx;
      const borderColorValid =
        surfacePolicy.allowedBorderColorRoles.includes(element.borderColorRole);
      const borderRadiusValid =
        Number.isFinite(element.borderRadiusPx) &&
        element.borderRadiusPx >= surfacePolicy.minimumBorderRadiusPx &&
        element.borderRadiusPx <= surfacePolicy.maximumBorderRadiusPx;
      if (!borderWidthValid || !borderColorValid || !borderRadiusValid) {
        add(
          VISUAL_EXPRESSION_ERROR_CODES.INFORMATION_CARD_BORDER_INVALID,
          sceneId,
          `layoutSample.elements.${element.id}.border`,
          {
            borderWidthPx: element.borderWidthPx ?? null,
            borderColorRole: element.borderColorRole ?? null,
            borderRadiusPx: element.borderRadiusPx ?? null
          },
          {
            borderWidthPx: [
              surfacePolicy.minimumBorderWidthPx,
              surfacePolicy.maximumBorderWidthPx
            ],
            borderColorRoles: surfacePolicy.allowedBorderColorRoles,
            borderRadiusPx: [
              surfacePolicy.minimumBorderRadiusPx,
              surfacePolicy.maximumBorderRadiusPx
            ]
          },
          "信息卡片边框必须清晰、完整、使用统一线条角色和圆角比例"
        );
      }
    }
    if (!VISUAL_EXPRESSION_STYLE_POLICY.typographyRoles.includes(element.typographyRole)) {
      add(VISUAL_EXPRESSION_ERROR_CODES.TYPOGRAPHY_ROLE_INVALID, sceneId, `layoutSample.elements.${element.id}.typographyRole`, element.typographyRole, VISUAL_EXPRESSION_STYLE_POLICY.typographyRoles, "文字必须使用统一字号角色"
      );
    }
    const minimumFontSize = element.typographyRole === "stage-title"
      ? plan.acceptance.minimumStageTitleFontPx
      : plan.acceptance.minimumBodyFontPx;
    if (!Number.isFinite(element.fontSizePx) || element.fontSizePx < minimumFontSize) {
      add(
        VISUAL_EXPRESSION_ERROR_CODES.FONT_SIZE_TOO_SMALL,
        sceneId,
        `layoutSample.elements.${element.id}.fontSizePx`,
        element.fontSizePx ?? null,
        `>= ${minimumFontSize}`,
        "最终帧必须报告实际字号，不能靠缩小文字塞入过多内容"
      );
    }
    if (element.kind === "person") {
      const allowed = scene.visualIntent.informationNeed === "human-action" &&
        VISUAL_EXPRESSION_STYLE_POLICY.people.allowedNarrativeRoles.includes(element.narrativeRole);
      if (!allowed) {
        add(VISUAL_EXPRESSION_ERROR_CODES.PERSON_UNJUSTIFIED, sceneId, `layoutSample.elements.${element.id}`, element.narrativeRole, VISUAL_EXPRESSION_STYLE_POLICY.people.allowedNarrativeRoles, "人物只有在审批、验收、目标设定或用户决策本身需要解释时才允许出现");
      }
    }
    if (
      element.bounds.width / canvas.width > VISUAL_EXPRESSION_STYLE_POLICY.geometry.maximumSingleGraphicWidthRatio ||
      element.bounds.height / canvas.height > VISUAL_EXPRESSION_STYLE_POLICY.geometry.maximumSingleGraphicHeightRatio
    ) {
      add(VISUAL_EXPRESSION_ERROR_CODES.GRAPHIC_SCALE_EXCEEDED, sceneId, `layoutSample.elements.${element.id}.bounds`, element.bounds, VISUAL_EXPRESSION_STYLE_POLICY.geometry, "单个图形过大，会压过文字层级或被裁切");
    }
  }
  const missingElementIds = [...semanticIds].filter((id) => !elementIds.has(id));
  if (missingElementIds.length > 0) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_ELEMENT_MISSING,
      sceneId,
      "layoutSample.elements",
      missingElementIds,
      "all semantic elements present in final-hold sample",
      "最终保持帧必须完整呈现视觉计划中的语义对象"
    );
  }
  if (accentRoles.size > plan.acceptance.maximumAccentColors) {
    add(VISUAL_EXPRESSION_ERROR_CODES.ACCENT_LIMIT_EXCEEDED, sceneId, "layoutSample.elements.colorRole", [...accentRoles], plan.acceptance.maximumAccentColors, "同一画面强调色过多");
  }
  for (let leftIndex = 0; leftIndex < elements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < elements.length; rightIndex += 1) {
      if (rectIntersectionArea(elements[leftIndex].bounds, elements[rightIndex].bounds) > 0) {
        add(VISUAL_EXPRESSION_ERROR_CODES.ELEMENT_OVERLAP, sceneId, "layoutSample.elements", [elements[leftIndex].id, elements[rightIndex].id], 0, "顶层语义对象不得互相遮挡或压住文字");
      }
    }
  }
  const peerGroups = new Map();
  for (const element of elements.filter((candidate) => nonEmpty(candidate.peerGroup))) {
    const group = peerGroups.get(element.peerGroup) ?? [];
    group.push(element);
    peerGroups.set(element.peerGroup, group);
  }
  for (const [peerGroup, peers] of peerGroups) {
    const baseline = peers[0]?.bounds;
    if (!baseline) continue;
    const tolerance = VISUAL_EXPRESSION_STYLE_POLICY.geometry.peerScaleToleranceRatio;
    const mismatch = peers.some((peer) =>
      Math.abs(peer.bounds.width - baseline.width) / baseline.width > tolerance ||
      Math.abs(peer.bounds.height - baseline.height) / baseline.height > tolerance
    );
    if (mismatch) {
      add(VISUAL_EXPRESSION_ERROR_CODES.PEER_SCALE_MISMATCH, sceneId, `layoutSample.peerGroups.${peerGroup}`, peers.map((peer) => peer.bounds), tolerance, "同级对象尺寸必须一致，不能无依据暗示重要性差异");
    }
  }
  const envelope = graphicEnvelope(elements);
  if (envelope && (envelope.width * envelope.height) / (canvas.width * canvas.height) > plan.acceptance.maximumGraphicAreaRatio) {
    add(VISUAL_EXPRESSION_ERROR_CODES.GRAPHIC_AREA_EXCEEDED, sceneId, "layoutSample.elements", Number(((envelope.width * envelope.height) / (canvas.width * canvas.height)).toFixed(4)), plan.acceptance.maximumGraphicAreaRatio, "图形占比超过当前构图 profile，文字不再是主要信息层");
  }
  const textAreaRatio = sample?.metrics?.textAreaRatio;
  if (!Number.isFinite(textAreaRatio) || textAreaRatio < plan.acceptance.minimumTextAreaRatio) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.TEXT_AREA_INSUFFICIENT,
      sceneId,
      "layoutSample.metrics.textAreaRatio",
      textAreaRatio ?? null,
      `>= ${plan.acceptance.minimumTextAreaRatio}`,
      "文字信息面积不足，图形压过了当前构图 profile 的信息层级"
    );
  }

  const relationById = new Map(plan.semanticRelations.map((relation) => [relation.id, relation]));
  const connectorIds = new Set();
  const connectorRelationIds = new Set();
  for (const connector of connectors) {
    const relation = relationById.get(connector.relationId);
    if (!nonEmpty(connector.id) || connectorIds.has(connector.id) || !relation) {
      add(VISUAL_EXPRESSION_ERROR_CODES.ARROW_UNJUSTIFIED, sceneId, "layoutSample.connectors", connector, "one connector per declared relation", "连线和箭头必须对应一条明确语义关系");
      continue;
    }
    connectorIds.add(connector.id);
    if (connectorRelationIds.has(connector.relationId)) {
      add(
        VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_RELATION_DUPLICATED,
        sceneId,
        `layoutSample.connectors.${connector.id}.relationId`,
        connector.relationId,
        "one connector per semantic relation",
        "同一语义关系不能被重复画成多条线"
      );
    }
    connectorRelationIds.add(connector.relationId);
    if (connector.from !== relation.from || connector.to !== relation.to || !elementIds.has(connector.from) || !elementIds.has(connector.to)) {
      add(VISUAL_EXPRESSION_ERROR_CODES.ARROW_ENDPOINT_INVALID, sceneId, `layoutSample.connectors.${connector.id}`, { from: connector.from, to: connector.to }, { from: relation.from, to: relation.to }, "连线端点与语义关系不一致");
    }
    if (relation.directed && connector.arrowhead !== true) {
      add(VISUAL_EXPRESSION_ERROR_CODES.ARROWHEAD_MISSING, sceneId, `layoutSample.connectors.${connector.id}.arrowhead`, connector.arrowhead, true, "有向关系必须显示清楚箭头方向");
    }
    if (!relation.directed && connector.arrowhead === true) {
      add(VISUAL_EXPRESSION_ERROR_CODES.ARROW_UNJUSTIFIED, sceneId, `layoutSample.connectors.${connector.id}.arrowhead`, true, false, "比较、层级或无向关系不能用箭头误导为流程");
    }
    const segments = connectorSegments(connector);
    if (segments.length === 0 || segments.flat().some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
      add(VISUAL_EXPRESSION_ERROR_CODES.SCHEMA_INVALID, sceneId, `layoutSample.connectors.${connector.id}.route`, connector.route, ">= 2 finite points", "连线路径无效");
      continue;
    }
    if (segments.some(([start, end]) => start.x !== end.x && start.y !== end.y)) {
      add(
        VISUAL_EXPRESSION_ERROR_CODES.CONNECTOR_NON_ORTHOGONAL,
        sceneId,
        `layoutSample.connectors.${connector.id}.route`,
        connector.route,
        "horizontal or vertical segment only",
        "AI 技术长视频的关系线只允许水平、垂直和九十度转弯，禁止斜线或曲线"
      );
    }
    for (const element of elements.filter((candidate) => ![connector.from, connector.to].includes(candidate.id))) {
      if (segments.some(([start, end]) => segmentCrossesRect(start, end, element.bounds))) {
        add(VISUAL_EXPRESSION_ERROR_CODES.ARROW_CROSSES_NODE, sceneId, `layoutSample.connectors.${connector.id}.route`, element.id, "no unrelated element intersection", "连线不得穿过无关图形或文字");
      }
    }
  }
  const missingRelationIds = [...relationById.keys()].filter((id) => !connectorRelationIds.has(id));
  if (missingRelationIds.length > 0) {
    add(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_RELATION_MISSING,
      sceneId,
      "layoutSample.connectors",
      missingRelationIds,
      "all semantic relations present in final-hold sample",
      "最终保持帧必须完整呈现视觉计划中的关系与必要箭头"
    );
  }
  for (let leftIndex = 0; leftIndex < connectors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < connectors.length; rightIndex += 1) {
      const left = connectors[leftIndex];
      const right = connectors[rightIndex];
      if ([left.from, left.to].some((id) => [right.from, right.to].includes(id))) continue;
      const crossing = connectorSegments(left).some(([a, b]) =>
        connectorSegments(right).some(([c, d]) => segmentsCross(a, b, c, d))
      );
      if (crossing) {
        add(VISUAL_EXPRESSION_ERROR_CODES.ARROW_CROSSING, sceneId, "layoutSample.connectors", [left.id, right.id], "no crossing", "不同关系线不得交叉成线团，应重排或拆镜头");
      }
    }
  }
  return issues;
}

export function validateVisualExpressionScene(scene, options = {}) {
  const sceneId = scene?.id ?? null;
  const intentReview = validateVisualExpressionIntent(scene?.visualIntent, { sceneId });
  const issues = [...intentReview.issues];
  if (!intentReview.valid) return { valid: false, passed: false, issues };
  const actualPlan = scene.visualPlan ?? null;
  const expectedStyleProfileId = options.styleProfileId ??
    VISUAL_EXPRESSION_STYLE_PROFILE_ID;
  const expectedPlan = resolveVisualExpressionPlan({
    sceneId,
    visualIntent: scene.visualIntent,
    styleProfileId: expectedStyleProfileId
  });
  if (options.requireResolvedPlans === true && !scene.visualPlan) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.STRUCTURE_MISMATCH,
      sceneId,
      "visualPlan",
      null,
      expectedPlan.structure,
      "场景意图尚未解析成可供组件消费的统一视觉计划"
    ));
  }
  const checkedPlan = actualPlan ?? expectedPlan;
  if (!nonEmpty(checkedPlan.styleProfileId)) {
    issues.push(issue(VISUAL_EXPRESSION_ERROR_CODES.STYLE_PROFILE_MISSING, sceneId, "visualPlan.styleProfileId", checkedPlan.styleProfileId ?? null, expectedStyleProfileId, "视觉计划缺少统一风格 profile"));
  }
  for (const key of ["schemaVersion", "sceneId", "visualMode", "structure", "readingDirection", "compositionProfile", "styleProfileId"]) {
    if (checkedPlan[key] !== expectedPlan[key]) {
      issues.push(issue(VISUAL_EXPRESSION_ERROR_CODES.STRUCTURE_MISMATCH, sceneId, `visualPlan.${key}`, checkedPlan[key], expectedPlan[key], "解析后的视觉结构与场景意图不一致"));
    }
  }
  for (const key of ["claimIds", "semanticElements", "semanticRelations", "timing", "acceptance"]) {
    if (!sameStructuredValue(checkedPlan[key], expectedPlan[key])) {
      issues.push(issue(
        VISUAL_EXPRESSION_ERROR_CODES.PLAN_INTEGRITY_MISMATCH,
        sceneId,
        `visualPlan.${key}`,
        checkedPlan[key] ?? null,
        expectedPlan[key],
        "视觉计划必须由 resolver 确定生成，不能删除语义对象、关系或放宽验收阈值"
      ));
    }
  }
  const timing = checkedPlan.timing ?? {};
  const minimumLead = VISUAL_EXPRESSION_STYLE_POLICY.timing.minimumHeadlineLeadFrames;
  if (
    !Number.isFinite(timing.headlineStartFrame) ||
    !Number.isFinite(timing.supportingCopyStartFrame) ||
    !Number.isFinite(timing.graphicStartFrame) ||
    !Number.isFinite(timing.detailCopyStartFrame) ||
    !Number.isFinite(timing.subtitleStartFrame) ||
    timing.supportingCopyStartFrame - timing.headlineStartFrame < minimumLead ||
    timing.subtitleStartFrame - timing.headlineStartFrame < minimumLead ||
    timing.graphicStartFrame < timing.supportingCopyStartFrame ||
    timing.detailCopyStartFrame < timing.graphicStartFrame
  ) {
    issues.push(issue(VISUAL_EXPRESSION_ERROR_CODES.TITLE_NOT_FIRST, sceneId, "visualPlan.timing", timing, VISUAL_EXPRESSION_STYLE_POLICY.timing, "大标题必须先建立信息层级，小字、字幕、图形和细节再依次出现"));
  }
  const samples = Array.isArray(scene.layoutSamples) ? scene.layoutSamples : [];
  if (options.requireLayoutSamples === true && checkedPlan.visualMode === "graphic" && samples.length === 0) {
    issues.push(issue(VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLES_MISSING, sceneId, "layoutSamples", 0, ">= 1", "图形场景必须提供代表帧布局采样，才能验证比例、裁切、重叠和箭头"));
  }
  for (const sample of samples) issues.push(...validateLayoutSample(scene, checkedPlan, sample));
  return { valid: issues.length === 0, passed: issues.length === 0, issues, resolvedPlan: expectedPlan };
}

export function validateVisualExpressionPlan(plan, options = {}) {
  const scenes = Array.isArray(plan) ? plan : plan?.scenes;
  if (!Array.isArray(scenes)) {
    const issues = [issue(VISUAL_EXPRESSION_ERROR_CODES.SCHEMA_INVALID, null, "scenes", scenes ?? null, "array", "视觉表达计划缺少场景数组")];
    return { valid: false, passed: false, issues, checks: issues };
  }
  const issues = scenes.flatMap((scene) => validateVisualExpressionScene(scene, options).issues);
  const styleProfiles = new Set(
    scenes.map((scene) => scene.visualPlan?.styleProfileId ?? "missing")
  );
  if (styleProfiles.size > 1) {
    issues.push(issue(VISUAL_EXPRESSION_ERROR_CODES.STYLE_PROFILE_DRIFT, null, "scenes.visualPlan.styleProfileId", [...styleProfiles], options.styleProfileId ?? VISUAL_EXPRESSION_STYLE_PROFILE_ID, "同一视频的场景不能私自更换风格、配色和比例体系"));
  }
  return { valid: issues.length === 0, passed: issues.length === 0, issues, checks: issues };
}

const DETERMINISTIC_LAYOUT_SAMPLE_METADATA_KEYS = Object.freeze([
  "sampleType",
  "schemaVersion",
  "rendererContractVersion",
  "styleProfileId",
  "sceneId",
  "compositionId",
  "renderVersion",
  "renderedArtifactSha256",
  "assurance",
  "finalizedAfterRender",
  "pixelInspection",
  "humanVisualQa"
]);

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function deterministicLayoutSampleExpected(options = {}) {
  return {
    rendererContractVersion:
      options.rendererContractVersion ?? VISUAL_EXPRESSION_RENDERER_CONTRACT_VERSION,
    styleProfileId: options.styleProfileId ?? VISUAL_EXPRESSION_STYLE_PROFILE_ID,
    compositionId: options.compositionId ?? null,
    renderVersion: options.renderVersion ?? null,
    renderedArtifactSha256: options.renderedArtifactSha256 ?? null,
    durationInFrames: options.durationInFrames ?? null
  };
}

function deterministicLayoutMetadataIssues(metadata, expected, sceneId, location) {
  const issues = [];
  if (
    !isObject(metadata) ||
    !exactKeys(metadata, DETERMINISTIC_LAYOUT_SAMPLE_METADATA_KEYS) ||
    metadata.sampleType !== DETERMINISTIC_LAYOUT_SAMPLE_TYPE ||
    metadata.assurance !== DETERMINISTIC_LAYOUT_SAMPLE_ASSURANCE ||
    metadata.finalizedAfterRender !== true ||
    metadata.pixelInspection !== false ||
    metadata.humanVisualQa !== false ||
    metadata.sceneId !== sceneId
  ) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_PROVENANCE_INVALID,
      sceneId,
      location,
      metadata ?? null,
      {
        sampleType: DETERMINISTIC_LAYOUT_SAMPLE_TYPE,
        assurance: DETERMINISTIC_LAYOUT_SAMPLE_ASSURANCE,
        finalizedAfterRender: true,
        pixelInspection: false,
        humanVisualQa: false,
        sceneId
      },
      "布局几何可以预计算，但样本证据必须在成片成功后定稿，且不能冒充像素或人工视觉 QA"
    ));
    return issues;
  }
  if (metadata.schemaVersion !== DETERMINISTIC_LAYOUT_SAMPLE_SCHEMA_VERSION) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_VERSION_MISMATCH,
      sceneId,
      `${location}.schemaVersion`,
      metadata.schemaVersion,
      DETERMINISTIC_LAYOUT_SAMPLE_SCHEMA_VERSION,
      "布局样本 schema 版本与当前 QA 合同不一致"
    ));
  }
  if (metadata.rendererContractVersion !== expected.rendererContractVersion) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_RENDERER_MISMATCH,
      sceneId,
      `${location}.rendererContractVersion`,
      metadata.rendererContractVersion,
      expected.rendererContractVersion,
      "布局样本不是由当前 renderer contract 生成"
    ));
  }
  if (metadata.styleProfileId !== expected.styleProfileId) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_STYLE_MISMATCH,
      sceneId,
      `${location}.styleProfileId`,
      metadata.styleProfileId,
      expected.styleProfileId,
      "布局样本的风格 profile 与当前分镜不一致"
    ));
  }
  if (
    metadata.compositionId !== expected.compositionId ||
    metadata.renderVersion !== expected.renderVersion ||
    metadata.renderedArtifactSha256 !== expected.renderedArtifactSha256 ||
    !sha256(metadata.renderedArtifactSha256)
  ) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_RENDER_BINDING_MISMATCH,
      sceneId,
      location,
      {
        compositionId: metadata.compositionId,
        renderVersion: metadata.renderVersion,
        renderedArtifactSha256: metadata.renderedArtifactSha256
      },
      {
        compositionId: expected.compositionId,
        renderVersion: expected.renderVersion,
        renderedArtifactSha256: expected.renderedArtifactSha256
      },
      "布局样本没有绑定当前渲染成片，可能来自旧版本或渲染前计划"
    ));
  }
  return issues;
}

export function validateDeterministicLayoutSampleSet(sampleSet, options = {}) {
  const issues = [];
  const expected = deterministicLayoutSampleExpected(options);
  const expectedSceneIds = (Array.isArray(options.scenes) ? options.scenes : [])
    .map((scene) => typeof scene === "string" ? scene : scene?.id)
    .filter(nonEmpty);
  const layoutSamplesByScene = {};
  if (!isObject(sampleSet)) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLES_MISSING,
      null,
      "render.deterministicLayoutSampleSet",
      sampleSet ?? null,
      DETERMINISTIC_LAYOUT_SAMPLE_SCHEMA_VERSION,
      "合同分镜在 QA 前必须由 render-agent 持久化 deterministic-layout-sample"
    ));
    return {
      valid: false,
      passed: false,
      issues,
      checks: issues,
      layoutSamplesByScene
    };
  }

  if (sampleSet.sampleType !== DETERMINISTIC_LAYOUT_SAMPLE_TYPE ||
      sampleSet.assurance !== DETERMINISTIC_LAYOUT_SAMPLE_ASSURANCE ||
      sampleSet.finalizedAfterRender !== true ||
      sampleSet.pixelInspection !== false ||
      sampleSet.humanVisualQa !== false) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_PROVENANCE_INVALID,
      null,
      "render.deterministicLayoutSampleSet",
      {
        sampleType: sampleSet.sampleType,
        assurance: sampleSet.assurance,
        finalizedAfterRender: sampleSet.finalizedAfterRender,
        pixelInspection: sampleSet.pixelInspection,
        humanVisualQa: sampleSet.humanVisualQa
      },
      {
        sampleType: DETERMINISTIC_LAYOUT_SAMPLE_TYPE,
        assurance: DETERMINISTIC_LAYOUT_SAMPLE_ASSURANCE,
        finalizedAfterRender: true,
        pixelInspection: false,
        humanVisualQa: false
      },
      "该证据只能声明确定性布局合同检查，不能声明像素检查或人工视觉 QA"
    ));
  }
  if (sampleSet.schemaVersion !== DETERMINISTIC_LAYOUT_SAMPLE_SCHEMA_VERSION) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_VERSION_MISMATCH,
      null,
      "render.deterministicLayoutSampleSet.schemaVersion",
      sampleSet.schemaVersion,
      DETERMINISTIC_LAYOUT_SAMPLE_SCHEMA_VERSION,
      "持久化布局样本版本不是当前 QA 支持版本"
    ));
  }
  if (sampleSet.rendererContractVersion !== expected.rendererContractVersion) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_RENDERER_MISMATCH,
      null,
      "render.deterministicLayoutSampleSet.rendererContractVersion",
      sampleSet.rendererContractVersion,
      expected.rendererContractVersion,
      "持久化布局样本来自不兼容的 renderer contract"
    ));
  }
  if (sampleSet.styleProfileId !== expected.styleProfileId) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_STYLE_MISMATCH,
      null,
      "render.deterministicLayoutSampleSet.styleProfileId",
      sampleSet.styleProfileId,
      expected.styleProfileId,
      "持久化布局样本的风格 profile 与分镜合同不一致"
    ));
  }
  if (
    sampleSet.compositionId !== expected.compositionId ||
    sampleSet.renderVersion !== expected.renderVersion ||
    sampleSet.renderedArtifactSha256 !== expected.renderedArtifactSha256 ||
    !sha256(sampleSet.renderedArtifactSha256)
  ) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_RENDER_BINDING_MISMATCH,
      null,
      "render.deterministicLayoutSampleSet",
      {
        compositionId: sampleSet.compositionId,
        renderVersion: sampleSet.renderVersion,
        renderedArtifactSha256: sampleSet.renderedArtifactSha256
      },
      {
        compositionId: expected.compositionId,
        renderVersion: expected.renderVersion,
        renderedArtifactSha256: expected.renderedArtifactSha256
      },
      "持久化布局样本没有绑定当前成片版本与 SHA-256"
    ));
  }

  const entries = Array.isArray(sampleSet.scenes) ? sampleSet.scenes : [];
  const entrySceneIds = entries.map((entry) => entry?.sceneId).filter(nonEmpty);
  const duplicateSceneIds = entrySceneIds.filter(
    (sceneId, index) => entrySceneIds.indexOf(sceneId) !== index
  );
  const missingSceneIds = expectedSceneIds.filter((sceneId) => !entrySceneIds.includes(sceneId));
  const unexpectedSceneIds = entrySceneIds.filter((sceneId) => !expectedSceneIds.includes(sceneId));
  if (
    entries.length !== expectedSceneIds.length ||
    duplicateSceneIds.length > 0 ||
    missingSceneIds.length > 0 ||
    unexpectedSceneIds.length > 0
  ) {
    issues.push(issue(
      VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLES_MISSING,
      null,
      "render.deterministicLayoutSampleSet.scenes",
      { entrySceneIds, duplicateSceneIds, missingSceneIds, unexpectedSceneIds },
      expectedSceneIds,
      "每个合同场景必须且只能有一组渲染后 deterministic-layout-sample"
    ));
  }

  for (const entry of entries) {
    if (!nonEmpty(entry?.sceneId)) continue;
    const samples = Array.isArray(entry.layoutSamples) ? entry.layoutSamples : [];
    layoutSamplesByScene[entry.sceneId] = samples;
    if (samples.length === 0) {
      issues.push(issue(
        VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLES_MISSING,
        entry.sceneId,
        `render.deterministicLayoutSampleSet.scenes.${entry.sceneId}.layoutSamples`,
        0,
        ">= 1",
        "每个合同场景都必须保存至少一个确定性代表帧布局样本"
      ));
      continue;
    }
    for (const [sampleIndex, sample] of samples.entries()) {
      const location =
        `render.deterministicLayoutSampleSet.scenes.${entry.sceneId}.layoutSamples[${sampleIndex}].deterministicLayoutSample`;
      issues.push(...deterministicLayoutMetadataIssues(
        sample?.deterministicLayoutSample,
        expected,
        entry.sceneId,
        location
      ));
      if (
        !Number.isInteger(sample?.frame) ||
        sample.frame < 0 ||
        (Number.isInteger(expected.durationInFrames) && sample.frame >= expected.durationInFrames)
      ) {
        issues.push(issue(
          VISUAL_EXPRESSION_ERROR_CODES.LAYOUT_SAMPLE_PROVENANCE_INVALID,
          entry.sceneId,
          `render.deterministicLayoutSampleSet.scenes.${entry.sceneId}.layoutSamples[${sampleIndex}].frame`,
          sample?.frame ?? null,
          Number.isInteger(expected.durationInFrames)
            ? `0..${expected.durationInFrames - 1}`
            : "non-negative integer",
          "确定性布局样本必须绑定成片内的有效代表帧"
        ));
      }
    }
  }

  return {
    valid: issues.length === 0,
    passed: issues.length === 0,
    issues,
    checks: issues,
    layoutSamplesByScene
  };
}

export function assertVisualExpressionPlan(plan, options = {}) {
  const review = validateVisualExpressionPlan(plan, options);
  if (!review.valid) {
    throw new VisualExpressionContractError(
      `视觉表达计划未通过合同：${review.issues.map((item) => item.code).join("、")}`,
      review.issues
    );
  }
  return plan;
}

export function visualExpressionPromptDirective() {
  return [
    `每个场景必须输出 ${VISUAL_EXPRESSION_CONTRACT_VERSION} 的 visualIntent。`,
    "先回答观众问题、结论、图形贡献和来源主张，再选择 comparison/flow/hierarchy 等结构。",
    "visualIntent 只写语义对象与关系，禁止写坐标、SVG、图标、文件夹、纸张、人物造型、颜色值或其他具体画法。",
    "单一判断可以 text-only；比较、顺序、层级、分支、数量和证据必须用图形解释，不能把所有内容都塞进卡片。",
    "图形必须说明删掉后会损失什么理解；纯装饰图、无方向含义的箭头和未绑定主张的元素一律禁止。",
    "人物仅在审批、验收、目标设定或用户决策本身需要解释时允许出现。"
  ].join(" ");
}

export {
  COMPOSITION_PROFILES as VISUAL_EXPRESSION_COMPOSITION_PROFILES,
  CONTRIBUTIONS as VISUAL_EXPRESSION_CONTRIBUTIONS,
  INFORMATION_NEEDS as VISUAL_EXPRESSION_INFORMATION_NEEDS,
  RELATION_KINDS as VISUAL_EXPRESSION_RELATION_KINDS,
  VISUAL_STRUCTURES as VISUAL_EXPRESSION_STRUCTURES
};
