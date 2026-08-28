import {
  VISUAL_EXPRESSION_STYLE_PROFILE_ID
} from "../shared/visual-expression-contract.mjs";
import {
  visualSystemV1GrammarLayout
} from "./components/visual-system-v1/grammar-layout.mjs";

export const PRODUCTION_SEMANTIC_PREVIEW_STYLE_PROFILE_ID =
  VISUAL_EXPRESSION_STYLE_PROFILE_ID;

export function productionSemanticPrimitiveFamily(primitive) {
  if (typeof primitive !== "string" || primitive.length === 0) return "semantic";
  if (primitive.startsWith("comparison-")) return "comparison";
  if (primitive === "flow-step") return "flow";
  if (primitive.startsWith("hierarchy-")) return "hierarchy";
  if (primitive.startsWith("branch-") || primitive === "decision") return "branch";
  if (primitive === "timeline-anchor") return "timeline";
  if (primitive.startsWith("state-")) return "state";
  if (primitive.startsWith("evidence-")) return "evidence";
  if (primitive === "quantity-bar") return "quantity";
  if (primitive === "spatial-marker") return "spatial";
  if (primitive === "focus") return "focus";
  if (["node", "hub"].includes(primitive)) return "network";
  if (primitive === "loop-node") return "loop";
  if (primitive.startsWith("decision-")) return "human-decision";
  if (primitive === "annotation") return "annotation";
  return "semantic";
}

const LABELED_RELATION_TYPES = new Set([
  "branch",
  "branches-to",
  "comparison",
  "compares",
  "condition",
  "constraint",
  "contains",
  "criterion",
  "dimension",
  "risk-context"
]);

export function productionSemanticRelationLabelRequired(relationType) {
  return LABELED_RELATION_TYPES.has(relationType);
}

const TIMING_KEYS = Object.freeze([
  "headlineStartFrame",
  "supportingCopyStartFrame",
  "graphicStartFrame",
  "detailCopyStartFrame",
  "subtitleStartFrame"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function finiteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label}必须是非负数`);
  }
  return value;
}

function revealProgress(frame, startFrame, revealFrames = 8) {
  if (frame < startFrame) return 0;
  return Math.min(1, (frame - startFrame + 1) / Math.max(1, revealFrames));
}

function assertApprovedVisualPlan(visualPlan) {
  if (!visualPlan || typeof visualPlan !== "object" || Array.isArray(visualPlan)) {
    throw new TypeError("通用生产语义预览需要 visualPlan");
  }
  if (visualPlan.styleProfileId !== PRODUCTION_SEMANTIC_PREVIEW_STYLE_PROFILE_ID) {
    throw new RangeError(
      `通用生产语义预览只接受已批准风格 ${PRODUCTION_SEMANTIC_PREVIEW_STYLE_PROFILE_ID}`
    );
  }
  const timing = visualPlan.timing;
  if (!timing || typeof timing !== "object" || Array.isArray(timing)) {
    throw new TypeError("visualPlan.timing 缺失");
  }
  for (const key of TIMING_KEYS) {
    finiteNonNegative(timing[key], `visualPlan.timing.${key}`);
  }
  if (
    timing.supportingCopyStartFrame < timing.headlineStartFrame ||
    timing.subtitleStartFrame < timing.headlineStartFrame ||
    timing.graphicStartFrame < timing.supportingCopyStartFrame ||
    timing.detailCopyStartFrame < timing.graphicStartFrame
  ) {
    throw new RangeError("visualPlan.timing 必须先标题，再小字、图形和细节");
  }
  return visualPlan;
}

export function isProductionSemanticScene(scene) {
  return Boolean(
    scene &&
    typeof scene === "object" &&
    scene.visualPlan &&
    typeof scene.visualPlan === "object" &&
    !Array.isArray(scene.visualPlan)
  );
}

export function resolveProductionSemanticPreview({ scene, frame, width, height } = {}) {
  if (!isProductionSemanticScene(scene)) {
    throw new TypeError("通用生产语义预览需要带 visualPlan 的场景");
  }
  finiteNonNegative(frame, "场景帧");
  const visualPlan = assertApprovedVisualPlan(scene.visualPlan);
  const layout = visualSystemV1GrammarLayout({
    width,
    height,
    visualPlan,
    visibleElementIds: visualPlan.semanticElements.map((element) => element.id)
  });
  const elementById = new Map(
    visualPlan.semanticElements.map((element) => [element.id, element])
  );
  const relationById = new Map(
    visualPlan.semanticRelations.map((relation) => [relation.id, relation])
  );
  const timing = visualPlan.timing;
  const visibility = {
    headline: revealProgress(frame, timing.headlineStartFrame),
    supportingCopy: revealProgress(frame, timing.supportingCopyStartFrame),
    graphic: revealProgress(frame, timing.graphicStartFrame),
    detailCopy: revealProgress(frame, timing.detailCopyStartFrame),
    subtitle: revealProgress(frame, timing.subtitleStartFrame)
  };

  return deepFreeze({
    sceneId: scene.id ?? visualPlan.sceneId,
    styleProfileId: visualPlan.styleProfileId,
    structure: visualPlan.structure,
    viewport: { width, height },
    timing: { ...timing },
    visibility,
    headline: scene.title ?? scene.visualIntent?.takeaway ?? "",
    supportingCopy: scene.statement ?? scene.visualIntent?.takeaway ?? scene.subtitle ?? "",
    elements: Object.entries(layout.geometryById).flatMap(([id, geometry]) => {
      const semantic = elementById.get(id);
      if (!semantic) return [];
      return [{
        ...semantic,
        geometry,
        primitive: layout.primitiveById[id],
        primitiveFamily: productionSemanticPrimitiveFamily(layout.primitiveById[id])
      }];
    }),
    connectors: layout.connectors.flatMap((connector) => {
      const semantic = relationById.get(connector.relationId);
      if (!semantic) return [];
      const directed = semantic.directed === true;
      if (connector.arrowhead !== directed) {
        throw new Error(`关系 ${semantic.id} 的箭头与 directed 不一致`);
      }
      return [{
        ...connector,
        label: semantic.label,
        relationType: semantic.type,
        showLabel: productionSemanticRelationLabelRequired(semantic.type),
        directed
      }];
    }),
    layout
  });
}
