import { visualSystemV1PackContentCards } from "./content-layout.mjs";
import { VISUAL_SYSTEM_V1 } from "./tokens.mjs";
import {
  EDITORIAL_SURFACE_ROLES,
  EDITORIAL_VISUAL_HIERARCHY_LEVELS
} from "../../../shared/editorial-visual-policy.mjs";

const REFERENCE_CANVAS = Object.freeze({ width: 1920, height: 1080 });
const semanticNodeTokens = VISUAL_SYSTEM_V1.semanticNode.standard;
const CONNECTOR_CLEARANCE_PX = 8;

export const VISUAL_SYSTEM_V1_GRAMMAR_STRUCTURES = Object.freeze([
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

export const VISUAL_SYSTEM_V1_CONNECTOR_PRESENTATION_KINDS = Object.freeze([
  "orthogonal",
  "smooth-curve"
]);

export const VISUAL_SYSTEM_V1_CONNECTOR_POLICIES = Object.freeze([
  "allow-smooth",
  "orthogonal-only"
]);

export const VISUAL_SYSTEM_V1_HIERARCHY_LAYOUT_PROFILES = Object.freeze([
  "progressive-package"
]);

export const VISUAL_SYSTEM_V1_STANDALONE_OVERLAY_SLOT_SIDES = Object.freeze([
  "right",
  "left",
  "top",
  "bottom"
]);

export const VISUAL_SYSTEM_V1_CONNECTOR_PORTS = Object.freeze([
  "top-center",
  "right-center",
  "bottom-center",
  "left-center"
]);

export const VISUAL_SYSTEM_V1_INFORMATION_CARD_PRIMITIVES = Object.freeze([
  "comparison-left",
  "comparison-right",
  "comparison-note",
  "flow-step",
  "hierarchy-root",
  "hierarchy-node",
  "branch-input",
  "branch-outcome",
  "decision-actor",
  "decision-outcome",
  "state-before",
  "state-after",
  "state-transition",
  "evidence-frame",
  "evidence-annotation",
  "annotation",
  "node"
]);

export const VISUAL_SYSTEM_V1_OPEN_DIAGRAM_PRIMITIVES = Object.freeze([
  "process-anchor",
  "text-strip",
  "directory-entry",
  "decision-gate",
  "diagram-output"
]);

export const VISUAL_SYSTEM_V1_OPEN_DIAGRAM_CONTENT_OCCUPANCY = deepFreeze({
  leadingPx: 88,
  trailingPx: 18
});

export const VISUAL_SYSTEM_V1_GRAMMAR_SAFE_AREA = Object.freeze({
  x: 120,
  y: 340,
  right: 1640,
  bottom: 800
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label}必须是正数`);
  }
  return value;
}

function round(value) {
  return Number(value.toFixed(4));
}

function rect(x, y, width, height) {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const left = round(x);
  const top = round(y);
  const roundedWidth = round(safeWidth);
  const roundedHeight = round(safeHeight);
  return {
    x: left,
    y: top,
    left,
    top,
    width: roundedWidth,
    height: roundedHeight,
    right: round(left + roundedWidth),
    bottom: round(top + roundedHeight),
    centerX: round(left + roundedWidth / 2),
    centerY: round(top + roundedHeight / 2)
  };
}

function bounds(rectangle) {
  return {
    x: rectangle.x,
    y: rectangle.y,
    width: rectangle.width,
    height: rectangle.height
  };
}

export function visualSystemV1GrammarSafeArea(width, height) {
  finitePositive(width, "画布宽度");
  finitePositive(height, "画布高度");
  const scaleX = width / REFERENCE_CANVAS.width;
  const scaleY = height / REFERENCE_CANVAS.height;
  const x = VISUAL_SYSTEM_V1_GRAMMAR_SAFE_AREA.x * scaleX;
  const y = VISUAL_SYSTEM_V1_GRAMMAR_SAFE_AREA.y * scaleY;
  const right = VISUAL_SYSTEM_V1_GRAMMAR_SAFE_AREA.right * scaleX;
  const bottom = VISUAL_SYSTEM_V1_GRAMMAR_SAFE_AREA.bottom * scaleY;
  return deepFreeze(rect(x, y, right - x, bottom - y));
}

function assertVisualPlan(visualPlan) {
  if (!visualPlan || typeof visualPlan !== "object" || Array.isArray(visualPlan)) {
    throw new TypeError("视觉语法布局需要 visualPlan");
  }
  if (!VISUAL_SYSTEM_V1_GRAMMAR_STRUCTURES.includes(visualPlan.structure)) {
    throw new TypeError(`不支持的视觉结构：${visualPlan.structure ?? "missing"}`);
  }
  if (!Array.isArray(visualPlan.semanticElements)) {
    throw new TypeError("visualPlan.semanticElements 必须是数组");
  }
  if (!Array.isArray(visualPlan.semanticRelations)) {
    throw new TypeError("visualPlan.semanticRelations 必须是数组");
  }
  const ids = visualPlan.semanticElements.map((element) => element?.id);
  if (
    ids.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(ids).size !== ids.length
  ) {
    throw new TypeError("视觉元素必须具有唯一的非空 id");
  }
}

function visibleElements(visualPlan, visibleElementIds) {
  const knownIds = new Set(visualPlan.semanticElements.map((element) => element.id));
  const requested = visibleElementIds == null
    ? visualPlan.semanticElements.map((element) => element.id)
    : visibleElementIds;
  if (!Array.isArray(requested)) {
    throw new TypeError("visibleElementIds 必须是数组");
  }
  if (new Set(requested).size !== requested.length) {
    throw new TypeError("visibleElementIds 不能包含重复 id");
  }
  const unknown = requested.filter((id) => !knownIds.has(id));
  if (unknown.length > 0) {
    throw new RangeError(`visibleElementIds 包含未知 id：${unknown.join("、")}`);
  }
  const requestedIds = new Set(requested);
  return visualPlan.semanticElements.filter((element) => requestedIds.has(element.id));
}

function visibleRelations(visualPlan, elementIds) {
  const ids = new Set(elementIds);
  return visualPlan.semanticRelations.filter((relation) =>
    relation &&
    typeof relation.id === "string" &&
    ids.has(relation.from) &&
    ids.has(relation.to) &&
    relation.from !== relation.to
  );
}

function emptyPlacement() {
  return {
    geometryById: {},
    primitiveById: {},
    peerGroupById: {}
  };
}

function place(placement, element, geometry, primitive, peerGroup = "") {
  placement.geometryById[element.id] = geometry;
  placement.primitiveById[element.id] = primitive;
  placement.peerGroupById[element.id] = peerGroup;
}

function centeredBox(area, widthRatio, heightRatio, maximumWidth, maximumHeight) {
  const width = Math.min(area.width * widthRatio, maximumWidth);
  const height = Math.min(area.height * heightRatio, maximumHeight);
  return rect(
    area.x + (area.width - width) / 2,
    area.y + (area.height - height) / 2,
    width,
    height
  );
}

function stackMetrics(count, extent, preferredSize, preferredGap) {
  if (count <= 0) return { size: 0, gap: 0, start: 0 };
  if (count === 1) {
    const size = Math.min(preferredSize, extent);
    return { size, gap: 0, start: (extent - size) / 2 };
  }
  const gap = Math.min(preferredGap, extent / (count * 3));
  const size = Math.min(preferredSize, (extent - gap * (count - 1)) / count);
  const occupied = size * count + gap * (count - 1);
  return { size, gap, start: (extent - occupied) / 2 };
}

function adjacencyMaps(elements, relations) {
  const outgoing = new Map(elements.map((element) => [element.id, []]));
  const incoming = new Map(elements.map((element) => [element.id, []]));
  for (const relation of relations) {
    outgoing.get(relation.from)?.push(relation.to);
    incoming.get(relation.to)?.push(relation.from);
  }
  return { outgoing, incoming };
}

function linearOrder(elements, relations) {
  const indexById = new Map(elements.map((element, index) => [element.id, index]));
  const { outgoing, incoming } = adjacencyMaps(elements, relations);
  const indegree = new Map(elements.map((element) => [element.id, incoming.get(element.id)?.length ?? 0]));
  const queue = elements
    .filter((element) => indegree.get(element.id) === 0)
    .map((element) => element.id);
  const orderedIds = [];
  while (queue.length > 0) {
    queue.sort((left, right) => indexById.get(left) - indexById.get(right));
    const id = queue.shift();
    orderedIds.push(id);
    for (const target of outgoing.get(id) ?? []) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  for (const element of elements) {
    if (!orderedIds.includes(element.id)) orderedIds.push(element.id);
  }
  const byId = new Map(elements.map((element) => [element.id, element]));
  return orderedIds.map((id) => byId.get(id));
}

function walkOrder(elements, relations) {
  if (elements.length <= 1) return [...elements];
  const { outgoing, incoming } = adjacencyMaps(elements, relations);
  const byId = new Map(elements.map((element) => [element.id, element]));
  const start = elements.find((element) => (incoming.get(element.id)?.length ?? 0) === 0) ?? elements[0];
  const ordered = [];
  const visited = new Set();
  let current = start.id;
  while (ordered.length < elements.length) {
    if (!visited.has(current)) {
      visited.add(current);
      ordered.push(byId.get(current));
    }
    const next = (outgoing.get(current) ?? []).find((id) => !visited.has(id));
    if (next) {
      current = next;
      continue;
    }
    const remaining = elements.find((element) => !visited.has(element.id));
    if (!remaining) break;
    current = remaining.id;
  }
  return ordered;
}

const HIERARCHY_STRUCTURAL_RELATION_TYPES = new Set(["contains"]);

function hierarchyStructuralRelations(relations) {
  const structural = relations.filter((relation) =>
    HIERARCHY_STRUCTURAL_RELATION_TYPES.has(relation?.semanticType ?? relation?.type)
  );
  return structural.length > 0 ? structural : relations;
}

function hierarchyLevels(elements, relations) {
  const ordered = linearOrder(elements, relations);
  const { incoming } = adjacencyMaps(elements, relations);
  const levelById = new Map();
  for (const element of ordered) {
    const parentLevels = (incoming.get(element.id) ?? [])
      .map((id) => levelById.get(id))
      .filter(Number.isFinite);
    levelById.set(element.id, parentLevels.length === 0 ? 0 : Math.max(...parentLevels) + 1);
  }
  return levelById;
}

function collectConnected(startId, adjacency) {
  const found = new Set();
  const queue = [...(adjacency.get(startId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift();
    if (found.has(id) || id === startId) continue;
    found.add(id);
    queue.push(...(adjacency.get(id) ?? []));
  }
  return found;
}

function singleFocusPlacement(elements, area, width, height) {
  const placement = emptyPlacement();
  if (elements.length === 0) return placement;
  const focus = elements.find((element) => element.importance === "primary") ?? elements[0];
  const others = elements.filter((element) => element.id !== focus.id);
  const focusRect = centeredBox(area, 0.3, 0.46, width * 0.28, height * 0.3);
  place(placement, focus, focusRect, "focus", "");
  if (others.length === 0) return placement;
  const half = Math.ceil(others.length / 2);
  const columns = [others.slice(0, half), others.slice(half)];
  const boxWidth = Math.min(area.width * 0.2, width * 0.2);
  for (const [columnIndex, column] of columns.entries()) {
    const metrics = stackMetrics(column.length, area.height, height * 0.09, height * 0.018);
    column.forEach((element, index) => {
      const x = columnIndex === 0
        ? area.x
        : area.right - boxWidth;
      place(
        placement,
        element,
        rect(x, area.y + metrics.start + index * (metrics.size + metrics.gap), boxWidth, metrics.size),
        "annotation",
        "focus-annotations"
      );
    });
  }
  return placement;
}

function nodeLinkPlacement(elements, relations, area, width, height) {
  const placement = emptyPlacement();
  if (elements.length === 0) return placement;
  const degree = new Map(elements.map((element) => [element.id, 0]));
  for (const relation of relations) {
    degree.set(relation.from, (degree.get(relation.from) ?? 0) + 1);
    degree.set(relation.to, (degree.get(relation.to) ?? 0) + 1);
  }
  const hub = [...elements].sort((left, right) =>
    (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) ||
    (right.importance === "primary" ? 1 : 0) - (left.importance === "primary" ? 1 : 0)
  )[0];
  const satellites = elements.filter((element) => element.id !== hub.id);
  place(
    placement,
    hub,
    centeredBox(area, 0.24, 0.38, width * 0.22, height * 0.24),
    "hub",
    ""
  );
  const half = Math.ceil(satellites.length / 2);
  const boxWidth = Math.min(area.width * 0.2, width * 0.18);
  [satellites.slice(0, half), satellites.slice(half)].forEach((column, columnIndex) => {
    const metrics = stackMetrics(column.length, area.height, height * 0.075, height * 0.014);
    column.forEach((element, index) => {
      place(
        placement,
        element,
        rect(
          columnIndex === 0 ? area.x : area.right - boxWidth,
          area.y + metrics.start + index * (metrics.size + metrics.gap),
          boxWidth,
          metrics.size
        ),
        "node",
        "node-link-satellites"
      );
    });
  });
  return placement;
}

function openDiagramContentOccupancy(primitive, width) {
  if (!VISUAL_SYSTEM_V1_OPEN_DIAGRAM_PRIMITIVES.includes(primitive)) return undefined;
  const scale = width / REFERENCE_CANVAS.width;
  return {
    leadingPx: VISUAL_SYSTEM_V1_OPEN_DIAGRAM_CONTENT_OCCUPANCY.leadingPx * scale,
    trailingPx: VISUAL_SYSTEM_V1_OPEN_DIAGRAM_CONTENT_OCCUPANCY.trailingPx * scale
  };
}

function contentDrivenFlowPlacement(
  elements,
  relations,
  area,
  width,
  height,
  semanticContentById,
  primitiveOverrideById,
  flowLayoutProfile
) {
  const placement = emptyPlacement();
  const ordered = linearOrder(elements, relations);
  if (ordered.length === 0) return placement;
  const scale = width / REFERENCE_CANVAS.width;
  const rowHeightPx = flowLayoutProfile?.rowHeightPx == null
    ? Math.min(height * 0.14, area.height * 0.44)
    : flowLayoutProfile.rowHeightPx * scale;
  const rowGapPx = flowLayoutProfile?.rowGapPx == null
    ? Math.min(height * 0.045, area.height * 0.16)
    : flowLayoutProfile.rowGapPx * scale;
  const gapPx = flowLayoutProfile?.gapPx == null
    ? Math.min(32 * scale, area.width * 0.03)
    : flowLayoutProfile.gapPx * scale;
  const packed = visualSystemV1PackContentCards({
    items: ordered.map((element) => {
      const content = semanticContentById[element.id];
      if (!content || typeof content !== "object") {
        throw new TypeError(`内容驱动 flow 缺少 ${element.id} 的语义文案`);
      }
      return {
        id: element.id,
        label: content.label,
        detail: content.detail,
        visualOccupancy: openDiagramContentOccupancy(
          primitiveOverrideById?.[element.id],
          width
        ),
        minWidth: content.minWidth,
        preferredWidth: content.preferredWidth
      };
    }),
    safeArea: area,
    gapPx,
    rowGapPx,
    rowHeightPx,
    maximumRows: flowLayoutProfile?.rowGroups?.length ?? 2,
    rowGroups: flowLayoutProfile?.rowGroups ?? null,
    rowDirections: flowLayoutProfile?.rowDirections ?? null,
    targetRowFillRatio: flowLayoutProfile?.targetRowFillRatio ?? 0,
    maximumCardWidthPx: (flowLayoutProfile?.maximumCardWidthPx ?? Number.POSITIVE_INFINITY) * scale,
    singletonMaximumWidthPx:
      (flowLayoutProfile?.singletonMaximumWidthPx ?? Number.POSITIVE_INFINITY) * scale,
    cardOptions: {
      labelFontSizePx: (
        flowLayoutProfile?.labelFontSizePx ?? semanticNodeTokens.informationCard.labelFontSizePx
      ) * scale,
      detailFontSizePx: (
        flowLayoutProfile?.detailFontSizePx ?? semanticNodeTokens.informationCard.detailFontSizePx
      ) * scale,
      horizontalPaddingPx: (
        flowLayoutProfile?.horizontalPaddingPx ?? semanticNodeTokens.informationCard.horizontalPaddingPx
      ) * scale,
      minimumCardWidthPx: (flowLayoutProfile?.minimumCardWidthPx ?? 300) * scale
    }
  });
  const packedById = new Map(packed.cards.map((card) => [card.id, card]));
  for (const row of packed.rows) {
    if (flowLayoutProfile != null) {
      row.itemIds.forEach((id) => {
        const element = ordered.find((candidate) => candidate.id === id);
        const card = packedById.get(id);
        place(
          placement,
          element,
          rect(card.left, card.top, card.width, card.height),
          "flow-step",
          ""
        );
      });
      continue;
    }
    let cursor = row.index % 2 === 0 ? row.left : row.right;
    row.itemIds.forEach((id) => {
      const element = ordered.find((candidate) => candidate.id === id);
      const card = packedById.get(id);
      const left = row.index % 2 === 0 ? cursor : cursor - card.width;
      place(
        placement,
        element,
        rect(left, card.top, card.width, card.height),
        "flow-step",
        ""
      );
      cursor += row.index % 2 === 0
        ? card.width + packed.gapPx
        : -(card.width + packed.gapPx);
    });
  }
  return placement;
}

function flowPlacement(
  elements,
  relations,
  area,
  width,
  height,
  semanticContentById = null,
  primitiveOverrideById = null,
  flowLayoutProfile = null
) {
  if (semanticContentById != null) {
    return contentDrivenFlowPlacement(
      elements,
      relations,
      area,
      width,
      height,
      semanticContentById,
      primitiveOverrideById,
      flowLayoutProfile
    );
  }
  const placement = emptyPlacement();
  const ordered = linearOrder(elements, relations);
  if (ordered.length === 0) return placement;
  const rows = ordered.length > 6 ? 2 : 1;
  const columns = Math.ceil(ordered.length / rows);
  const gapX = Math.min(width * 0.02, area.width / (columns * 4));
  const gapY = Math.min(height * 0.045, area.height * 0.16);
  const boxWidth = Math.min(
    width * 0.16,
    (area.width - gapX * (columns - 1)) / columns
  );
  const boxHeight = Math.min(
    height * 0.13,
    (area.height - gapY * (rows - 1)) / rows
  );
  const groupHeight = rows * boxHeight + (rows - 1) * gapY;
  const groupTop = area.y + (area.height - groupHeight) / 2;
  for (let row = 0; row < rows; row += 1) {
    const rowItems = ordered.slice(row * columns, (row + 1) * columns);
    const rowWidth = rowItems.length * boxWidth + (rowItems.length - 1) * gapX;
    const rowLeft = area.x + (area.width - rowWidth) / 2;
    rowItems.forEach((element, column) => {
      const visualColumn = row % 2 === 0 ? column : rowItems.length - 1 - column;
      place(
        placement,
        element,
        rect(
          rowLeft + visualColumn * (boxWidth + gapX),
          groupTop + row * (boxHeight + gapY),
          boxWidth,
          boxHeight
        ),
        "flow-step",
        "flow-steps"
      );
    });
  }
  return placement;
}

function comparisonPlacement(elements, area, width, height) {
  const placement = emptyPlacement();
  const rowCount = Math.ceil(elements.length / 2);
  if (rowCount === 0) return placement;
  const columnGap = Math.min(area.width * 0.12, width * 0.11);
  const boxWidth = Math.min((area.width - columnGap) / 2, width * 0.31);
  const metrics = stackMetrics(rowCount, area.height, height * 0.09, height * 0.018);
  const groupWidth = boxWidth * 2 + columnGap;
  const left = area.x + (area.width - groupWidth) / 2;
  elements.forEach((element, index) => {
    const row = Math.floor(index / 2);
    const column = index % 2;
    const oddTail = elements.length % 2 === 1 && index === elements.length - 1;
    const x = oddTail
      ? area.x + (area.width - boxWidth) / 2
      : left + column * (boxWidth + columnGap);
    place(
      placement,
      element,
      rect(x, area.y + metrics.start + row * (metrics.size + metrics.gap), boxWidth, metrics.size),
      oddTail ? "comparison-note" : column === 0 ? "comparison-left" : "comparison-right",
      oddTail ? "" : `comparison-row-${row}`
    );
  });
  return placement;
}

function hierarchyPlacement(elements, relations, area, width, height, hierarchyLayoutProfile = null) {
  const placement = emptyPlacement();
  if (elements.length === 0) return placement;
  const structuralRelations = hierarchyStructuralRelations(relations);
  const structuralIds = new Set(structuralRelations.flatMap((relation) => [relation.from, relation.to]));
  const hasTypedStructure = structuralRelations.some((relation) =>
    HIERARCHY_STRUCTURAL_RELATION_TYPES.has(relation?.semanticType ?? relation?.type)
  );
  const coreElements = hasTypedStructure
    ? elements.filter((element) => structuralIds.has(element.id))
    : elements;
  const auxiliaryElements = hasTypedStructure
    ? elements.filter((element) => !structuralIds.has(element.id))
    : [];
  const auxiliaryGap = auxiliaryElements.length > 0 ? Math.min(width * 0.028, area.width * 0.045) : 0;
  const auxiliaryWidth = auxiliaryElements.length > 0 ? Math.min(width * 0.144, area.width * 0.19) : 0;
  const coreArea = auxiliaryElements.length > 0
    ? rect(area.x, area.y, area.width - auxiliaryGap - auxiliaryWidth, area.height)
    : area;
  const levelById = hierarchyLevels(coreElements, structuralRelations);
  const levels = new Map();
  for (const element of coreElements) {
    const level = levelById.get(element.id) ?? 0;
    const group = levels.get(level) ?? [];
    group.push(element);
    levels.set(level, group);
  }
  const orderedLevels = [...levels.keys()].sort((left, right) => left - right);
  const layoutLevelCount = hierarchyLayoutProfile === "progressive-package"
    ? Math.max(2, orderedLevels.length)
    : orderedLevels.length;
  const rowGap = Math.min(height * 0.025, area.height / Math.max(8, layoutLevelCount * 3));
  const rowHeight = Math.min(
    height * 0.11,
    (area.height - rowGap * Math.max(0, layoutLevelCount - 1)) / layoutLevelCount
  );
  const groupHeight = rowHeight * layoutLevelCount + rowGap * Math.max(0, layoutLevelCount - 1);
  const top = area.y + (area.height - groupHeight) / 2;
  orderedLevels.forEach((level, rowIndex) => {
    const row = levels.get(level);
    const gap = Math.min(width * 0.018, coreArea.width / Math.max(8, row.length * 3));
    const boxWidth = Math.min(
      width * 0.18,
      (coreArea.width - gap * Math.max(0, row.length - 1)) / row.length
    );
    const rowWidth = boxWidth * row.length + gap * Math.max(0, row.length - 1);
    const left = coreArea.x + (coreArea.width - rowWidth) / 2;
    row.forEach((element, column) => {
      place(
        placement,
        element,
        rect(left + column * (boxWidth + gap), top + rowIndex * (rowHeight + rowGap), boxWidth, rowHeight),
        level === 0 ? "hierarchy-root" : "hierarchy-node",
        `hierarchy-level-${level}`
      );
    });
  });
  if (auxiliaryElements.length > 0) {
    const metrics = stackMetrics(
      auxiliaryElements.length,
      coreArea.height,
      height * 0.11,
      height * 0.018
    );
    auxiliaryElements.forEach((element, index) => {
      place(
        placement,
        element,
        rect(
          coreArea.right + auxiliaryGap,
          coreArea.y + metrics.start + index * (metrics.size + metrics.gap),
          auxiliaryWidth,
          metrics.size
        ),
        "annotation",
        "hierarchy-callouts"
      );
    });
  }
  return placement;
}

function branchPlacement(elements, relations, area, width, height) {
  const placement = emptyPlacement();
  if (elements.length === 0) return placement;
  const { outgoing, incoming } = adjacencyMaps(elements, relations);
  const levels = hierarchyLevels(elements, relations);
  const explicitDecision = elements.find((element) => element.semanticRole === "decision");
  const forkCandidates = elements.filter((element) => (outgoing.get(element.id)?.length ?? 0) >= 2);
  forkCandidates.sort((left, right) =>
    (levels.get(right.id) ?? 0) - (levels.get(left.id) ?? 0) ||
    (outgoing.get(right.id)?.length ?? 0) - (outgoing.get(left.id)?.length ?? 0)
  );
  const decision = explicitDecision ?? forkCandidates[0] ?? elements[Math.floor(elements.length / 2)];
  const ancestorIds = collectConnected(decision.id, incoming);
  const descendantIds = collectConnected(decision.id, outgoing);
  const inputs = elements.filter((element) => ancestorIds.has(element.id));
  const outcomes = elements.filter((element) => descendantIds.has(element.id));
  const unclassified = elements.filter((element) =>
    element.id !== decision.id && !ancestorIds.has(element.id) && !descendantIds.has(element.id)
  );
  unclassified.forEach((element, index) => {
    (index % 2 === 0 ? inputs : outcomes).push(element);
  });

  const columnWidth = Math.min(area.width * 0.25, width * 0.23);
  const decisionWidth = Math.min(area.width * 0.2, width * 0.18);
  const decisionHeight = Math.min(area.height * 0.32, height * 0.14);
  const leftX = area.x;
  const decisionX = area.x + (area.width - decisionWidth) / 2;
  const rightX = area.right - columnWidth;
  const addStack = (items, x, primitive, peerGroup) => {
    const metrics = stackMetrics(items.length, area.height, height * 0.085, height * 0.014);
    items.forEach((element, index) => {
      place(
        placement,
        element,
        rect(x, area.y + metrics.start + index * (metrics.size + metrics.gap), columnWidth, metrics.size),
        primitive,
        peerGroup
      );
    });
  };
  addStack(inputs, leftX, "branch-input", "branch-inputs");
  place(
    placement,
    decision,
    rect(decisionX, area.y + (area.height - decisionHeight) / 2, decisionWidth, decisionHeight),
    "decision",
    ""
  );
  addStack(outcomes, rightX, "branch-outcome", "branch-outcomes");
  return placement;
}

function feedbackPlacement(elements, relations, area, width, height) {
  const placement = emptyPlacement();
  const ordered = walkOrder(elements, relations);
  if (ordered.length === 0) return placement;
  if (ordered.length === 1) {
    place(
      placement,
      ordered[0],
      centeredBox(area, 0.25, 0.35, width * 0.22, height * 0.22),
      "loop-node",
      "feedback-loop"
    );
    return placement;
  }
  const boxWidth = Math.min(area.width * 0.15, width * 0.12);
  const boxHeight = Math.min(area.height * 0.18, height * 0.085);
  const radiusX = (area.width - boxWidth) / 2;
  const radiusY = (area.height - boxHeight) / 2;
  ordered.forEach((element, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / ordered.length;
    const centerX = area.centerX + Math.cos(angle) * radiusX;
    const centerY = area.centerY + Math.sin(angle) * radiusY;
    place(
      placement,
      element,
      rect(centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight),
      "loop-node",
      "feedback-loop"
    );
  });
  return placement;
}

function timelinePlacement(elements, relations, area, width, height) {
  const placement = emptyPlacement();
  const ordered = linearOrder(elements, relations);
  if (ordered.length === 0) return placement;
  const step = area.width / ordered.length;
  const boxWidth = Math.min(step * 0.72, width * 0.13);
  const boxHeight = Math.min(area.height * 0.2, height * 0.09);
  const upperY = area.y + area.height * 0.08;
  const lowerY = area.bottom - area.height * 0.08 - boxHeight;
  ordered.forEach((element, index) => {
    place(
      placement,
      element,
      rect(
        area.x + step * index + (step - boxWidth) / 2,
        index % 2 === 0 ? upperY : lowerY,
        boxWidth,
        boxHeight
      ),
      "timeline-anchor",
      "timeline-anchors"
    );
  });
  return placement;
}

function quantityPlacement(elements, area, width, height) {
  const placement = emptyPlacement();
  const values = elements.map((element) => {
    const candidate = element.value ?? element.magnitude;
    return Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
  });
  const measured = values.filter(Number.isFinite);
  const maximum = measured.length > 0 ? Math.max(1, ...measured) : 1;
  const metrics = stackMetrics(elements.length, area.height, height * 0.075, height * 0.018);
  const maximumWidth = Math.min(area.width * 0.72, width * 0.32);
  const left = area.x + (area.width - maximumWidth) / 2;
  elements.forEach((element, index) => {
    const ratio = values[index] == null ? 1 : Math.max(0.12, values[index] / maximum);
    place(
      placement,
      element,
      rect(
        left,
        area.y + metrics.start + index * (metrics.size + metrics.gap),
        maximumWidth * ratio,
        metrics.size
      ),
      "quantity-bar",
      ""
    );
  });
  return placement;
}

function stateChangePlacement(elements, relations, area, width, height) {
  const placement = emptyPlacement();
  const ordered = linearOrder(elements, relations);
  const gap = Math.min(width * 0.035, area.width / Math.max(6, ordered.length * 3));
  const boxWidth = Math.min(
    width * 0.25,
    (area.width - gap * Math.max(0, ordered.length - 1)) / Math.max(1, ordered.length)
  );
  const boxHeight = Math.min(area.height * 0.48, height * 0.23);
  const groupWidth = boxWidth * ordered.length + gap * Math.max(0, ordered.length - 1);
  const left = area.x + (area.width - groupWidth) / 2;
  ordered.forEach((element, index) => {
    place(
      placement,
      element,
      rect(left + index * (boxWidth + gap), area.y + (area.height - boxHeight) / 2, boxWidth, boxHeight),
      index === 0 ? "state-before" : index === ordered.length - 1 ? "state-after" : "state-transition",
      "state-peers"
    );
  });
  return placement;
}

function spatialPlacement(elements, area, width, height) {
  const placement = emptyPlacement();
  if (elements.length === 0) return placement;
  const columns = Math.ceil(Math.sqrt(elements.length));
  const rows = Math.ceil(elements.length / columns);
  const cellWidth = area.width / columns;
  const cellHeight = area.height / rows;
  const boxWidth = Math.min(cellWidth * 0.45, width * 0.1);
  const boxHeight = Math.min(cellHeight * 0.45, height * 0.07);
  elements.forEach((element, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const stagger = row % 2 === 0 ? -cellWidth * 0.08 : cellWidth * 0.08;
    const centerX = area.x + cellWidth * (column + 0.5) + stagger;
    const centerY = area.y + cellHeight * (row + 0.5);
    place(
      placement,
      element,
      rect(centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight),
      "spatial-marker",
      "spatial-markers"
    );
  });
  return placement;
}

function evidencePlacement(elements, area, width, height) {
  const placement = emptyPlacement();
  if (elements.length === 0) return placement;
  const evidence = elements.find((element) => element.semanticRole === "evidence") ??
    elements.find((element) => element.importance === "primary") ??
    elements[0];
  const annotations = elements.filter((element) => element.id !== evidence.id);
  const evidenceWidth = Math.min(area.width * 0.48, width * 0.32);
  const evidenceHeight = Math.min(area.height * 0.72, height * 0.3);
  const gap = Math.min(width * 0.035, area.width * 0.08);
  const annotationWidth = Math.min(area.width - evidenceWidth - gap, width * 0.24);
  const groupWidth = evidenceWidth + (annotations.length > 0 ? gap + annotationWidth : 0);
  const left = area.x + (area.width - groupWidth) / 2;
  place(
    placement,
    evidence,
    rect(left, area.y + (area.height - evidenceHeight) / 2, evidenceWidth, evidenceHeight),
    "evidence-frame",
    ""
  );
  const metrics = stackMetrics(annotations.length, area.height, height * 0.085, height * 0.018);
  annotations.forEach((element, index) => {
    place(
      placement,
      element,
      rect(
        left + evidenceWidth + gap,
        area.y + metrics.start + index * (metrics.size + metrics.gap),
        annotationWidth,
        metrics.size
      ),
      "evidence-annotation",
      "evidence-annotations"
    );
  });
  return placement;
}

function humanDecisionPlacement(elements, area, width, height) {
  const placement = emptyPlacement();
  if (elements.length === 0) return placement;
  const decision = elements.find((element) => element.semanticRole === "decision") ??
    elements[Math.floor(elements.length / 2)];
  const actor = elements.find((element) =>
    element.id !== decision.id && element.semanticRole === "actor"
  ) ?? elements.find((element) => element.id !== decision.id);
  const outcomes = elements.filter((element) =>
    element.id !== decision.id && element.id !== actor?.id
  );
  const sideWidth = Math.min(area.width * 0.24, width * 0.22);
  const decisionWidth = Math.min(area.width * 0.2, width * 0.18);
  const decisionHeight = Math.min(area.height * 0.3, height * 0.14);
  if (actor) {
    place(
      placement,
      actor,
      rect(area.x, area.y + (area.height - decisionHeight) / 2, sideWidth, decisionHeight),
      "decision-actor",
      ""
    );
  }
  place(
    placement,
    decision,
    rect(
      area.x + (area.width - decisionWidth) / 2,
      area.y + (area.height - decisionHeight) / 2,
      decisionWidth,
      decisionHeight
    ),
    "decision",
    ""
  );
  const metrics = stackMetrics(outcomes.length, area.height, height * 0.09, height * 0.018);
  outcomes.forEach((element, index) => {
    place(
      placement,
      element,
      rect(
        area.right - sideWidth,
        area.y + metrics.start + index * (metrics.size + metrics.gap),
        sideWidth,
        metrics.size
      ),
      "decision-outcome",
      "decision-outcomes"
    );
  });
  return placement;
}

function placementFor(
  structure,
  elements,
  relations,
  area,
  width,
  height,
  semanticContentById,
  primitiveOverrideById,
  flowLayoutProfile,
  hierarchyLayoutProfile
) {
  switch (structure) {
    case "none": return emptyPlacement();
    case "single-focus": return singleFocusPlacement(elements, area, width, height);
    case "node-link": return nodeLinkPlacement(elements, relations, area, width, height);
    case "flow": return flowPlacement(
      elements,
      relations,
      area,
      width,
      height,
      semanticContentById,
      primitiveOverrideById,
      flowLayoutProfile
    );
    case "comparison": return comparisonPlacement(elements, area, width, height);
    case "hierarchy": return hierarchyPlacement(
      elements,
      relations,
      area,
      width,
      height,
      hierarchyLayoutProfile
    );
    case "branch": return branchPlacement(elements, relations, area, width, height);
    case "feedback-loop": return feedbackPlacement(elements, relations, area, width, height);
    case "timeline": return timelinePlacement(elements, relations, area, width, height);
    case "quantity": return quantityPlacement(elements, area, width, height);
    case "state-change": return stateChangePlacement(elements, relations, area, width, height);
    case "spatial": return spatialPlacement(elements, area, width, height);
    case "evidence": return evidencePlacement(elements, area, width, height);
    case "human-decision": return humanDecisionPlacement(elements, area, width, height);
    default: throw new TypeError(`不支持的视觉结构：${structure}`);
  }
}

function applyPrimitiveOverrides(placement, elements, primitiveOverrideById) {
  if (primitiveOverrideById == null) return placement;
  if (typeof primitiveOverrideById !== "object" || Array.isArray(primitiveOverrideById)) {
    throw new TypeError("primitiveOverrideById 必须是对象");
  }
  for (const element of elements) {
    const primitive = primitiveOverrideById[element.id];
    if (primitive == null) continue;
    if (!VISUAL_SYSTEM_V1_OPEN_DIAGRAM_PRIMITIVES.includes(primitive)) {
      throw new TypeError(`${element.id} 使用了未注册的开放图解原语：${primitive}`);
    }
    placement.primitiveById[element.id] = primitive;
    // 开放图解按文案长度占用不同宽度；不能把同原语误报为必须等尺寸的卡片同级组。
    placement.peerGroupById[element.id] = "";
  }
  return placement;
}

function boundaryPoint(rectangle, target) {
  const dx = target.x - rectangle.centerX;
  const dy = target.y - rectangle.centerY;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    return { x: rectangle.right, y: rectangle.centerY };
  }
  const scale = 1 / Math.max(
    Math.abs(dx) / (rectangle.width / 2),
    Math.abs(dy) / (rectangle.height / 2)
  );
  return {
    x: round(rectangle.centerX + dx * scale),
    y: round(rectangle.centerY + dy * scale)
  };
}

function connectorRectangle(geometry, label) {
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) {
    throw new TypeError(`${label}必须是节点几何对象`);
  }
  const left = geometry.left ?? geometry.x;
  const top = geometry.top ?? geometry.y;
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(geometry.width) ||
    geometry.width <= 0 ||
    !Number.isFinite(geometry.height) ||
    geometry.height <= 0
  ) {
    throw new TypeError(`${label}必须包含有限的 x、y、width 与 height`);
  }
  return rect(left, top, geometry.width, geometry.height);
}

function connectorPortPoint(rectangle, port) {
  switch (port) {
    case "top-center": return { x: rectangle.centerX, y: rectangle.top };
    case "right-center": return { x: rectangle.right, y: rectangle.centerY };
    case "bottom-center": return { x: rectangle.centerX, y: rectangle.bottom };
    case "left-center": return { x: rectangle.left, y: rectangle.centerY };
    default: throw new TypeError(`不支持的连接端口：${port ?? "missing"}`);
  }
}

function smoothConnectorAxis(fromPort, toPort) {
  if (
    (fromPort === "bottom-center" && toPort === "top-center") ||
    (fromPort === "top-center" && toPort === "bottom-center")
  ) {
    return "vertical";
  }
  if (
    (fromPort === "right-center" && toPort === "left-center") ||
    (fromPort === "left-center" && toPort === "right-center")
  ) {
    return "horizontal";
  }
  throw new TypeError(`平滑曲线端口必须成对相向：${fromPort} -> ${toPort}`);
}

export function visualSystemV1SmoothConnectorPath({
  fromGeometry,
  toGeometry,
  fromPort,
  toPort
} = {}) {
  if (!VISUAL_SYSTEM_V1_CONNECTOR_PORTS.includes(fromPort)) {
    throw new TypeError(`不支持的起始连接端口：${fromPort ?? "missing"}`);
  }
  if (!VISUAL_SYSTEM_V1_CONNECTOR_PORTS.includes(toPort)) {
    throw new TypeError(`不支持的目标连接端口：${toPort ?? "missing"}`);
  }
  const from = connectorRectangle(fromGeometry, "起始节点几何");
  const to = connectorRectangle(toGeometry, "目标节点几何");
  const start = connectorPortPoint(from, fromPort);
  const end = connectorPortPoint(to, toPort);
  const axis = smoothConnectorAxis(fromPort, toPort);
  if (axis === "vertical") {
    const pointsTowardTarget = fromPort === "bottom-center"
      ? start.y <= end.y
      : start.y >= end.y;
    if (!pointsTowardTarget) {
      throw new TypeError(`平滑曲线端口方向与节点位置不一致：${fromPort} -> ${toPort}`);
    }
    const midpoint = round((start.y + end.y) / 2);
    return `M ${start.x} ${start.y} C ${start.x} ${midpoint} ${end.x} ${midpoint} ${end.x} ${end.y}`;
  }
  const pointsTowardTarget = fromPort === "right-center"
    ? start.x <= end.x
    : start.x >= end.x;
  if (!pointsTowardTarget) {
    throw new TypeError(`平滑曲线端口方向与节点位置不一致：${fromPort} -> ${toPort}`);
  }
  const midpoint = round((start.x + end.x) / 2);
  return `M ${start.x} ${start.y} C ${midpoint} ${start.y} ${midpoint} ${end.y} ${end.x} ${end.y}`;
}

function deduplicateRoute(points) {
  return points.filter((point, index) =>
    index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y
  );
}

function orientation(a, b, c) {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(value) < 1e-7 ? 0 : Math.sign(value);
}

function samePoint(left, right) {
  return Math.abs(left.x - right.x) < 1e-7 && Math.abs(left.y - right.y) < 1e-7;
}

function pointOnSegment(point, start, end) {
  return point.x >= Math.min(start.x, end.x) - 1e-7 &&
    point.x <= Math.max(start.x, end.x) + 1e-7 &&
    point.y >= Math.min(start.y, end.y) - 1e-7 &&
    point.y <= Math.max(start.y, end.y) + 1e-7;
}

function segmentIntersectionKind(a, b, c, d) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  if (first * second < 0 && third * fourth < 0) return "proper";
  if (first === 0 && second === 0 && third === 0 && fourth === 0) {
    const useX = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const firstRange = [useX ? a.x : a.y, useX ? b.x : b.y].sort((left, right) => left - right);
    const secondRange = [useX ? c.x : c.y, useX ? d.x : d.y].sort((left, right) => left - right);
    const overlap = Math.min(firstRange[1], secondRange[1]) -
      Math.max(firstRange[0], secondRange[0]);
    if (overlap > 1e-7) return "overlap";
    if (overlap >= -1e-7) return "touch";
    return "none";
  }
  if (
    (first === 0 && pointOnSegment(c, a, b)) ||
    (second === 0 && pointOnSegment(d, a, b)) ||
    (third === 0 && pointOnSegment(a, c, d)) ||
    (fourth === 0 && pointOnSegment(b, c, d))
  ) {
    return "touch";
  }
  return "none";
}

function segmentsCross(a, b, c, d) {
  return segmentIntersectionKind(a, b, c, d) !== "none";
}

function pointInside(point, rectangle, padding = 0) {
  return point.x > rectangle.x - padding && point.x < rectangle.right + padding &&
    point.y > rectangle.y - padding && point.y < rectangle.bottom + padding;
}

function segmentCrossesRectangle(start, end, rectangle, padding = CONNECTOR_CLEARANCE_PX) {
  const expanded = {
    x: rectangle.x - padding,
    y: rectangle.y - padding,
    right: rectangle.right + padding,
    bottom: rectangle.bottom + padding
  };
  if (pointInside(start, expanded) || pointInside(end, expanded)) return true;
  const corners = [
    { x: expanded.x, y: expanded.y },
    { x: expanded.right, y: expanded.y },
    { x: expanded.right, y: expanded.bottom },
    { x: expanded.x, y: expanded.bottom }
  ];
  return corners.some((corner, index) =>
    segmentsCross(start, end, corner, corners[(index + 1) % corners.length])
  );
}

function routeSegments(route) {
  return route.slice(0, -1).map((point, index) => [point, route[index + 1]]);
}

function routeIsOrthogonal(route) {
  return routeSegments(route).every(([start, end]) =>
    Math.abs(start.x - end.x) < 1e-7 || Math.abs(start.y - end.y) < 1e-7
  );
}

function routeLength(route) {
  return routeSegments(route).reduce(
    (sum, [start, end]) => sum + Math.hypot(end.x - start.x, end.y - start.y),
    0
  );
}

function sharedTerminalPoints(route, relation, previous) {
  const terminals = [];
  for (const id of [relation.from, relation.to]) {
    if (![previous.from, previous.to].includes(id)) continue;
    const current = id === relation.from ? route[0] : route.at(-1);
    const routed = id === previous.from ? previous.route[0] : previous.route.at(-1);
    if (current && routed && samePoint(current, routed)) terminals.push(current);
  }
  return terminals;
}

function segmentTouchPoints(a, b, c, d) {
  const candidates = [a, b, c, d].filter((point) =>
    orientation(a, b, point) === 0 && pointOnSegment(point, a, b) &&
    orientation(c, d, point) === 0 && pointOnSegment(point, c, d)
  );
  return candidates.filter((point, index) =>
    candidates.findIndex((candidate) => samePoint(candidate, point)) === index
  );
}

function connectorConflictUnits(route, relation, previous) {
  const allowedTerminals = sharedTerminalPoints(route, relation, previous);
  return routeSegments(route).reduce((total, [start, end]) =>
    total + routeSegments(previous.route).reduce((segmentTotal, [left, right]) => {
      const kind = segmentIntersectionKind(start, end, left, right);
      if (kind === "none") return segmentTotal;
      if (kind === "proper") return segmentTotal + 5;
      if (kind === "overlap") return segmentTotal + 7;
      const touchPoints = segmentTouchPoints(start, end, left, right);
      const allowed = touchPoints.length > 0 && touchPoints.every((point) =>
        allowedTerminals.some((terminal) => samePoint(point, terminal)) &&
        [start, end].some((terminal) => samePoint(point, terminal)) &&
        [left, right].some((terminal) => samePoint(point, terminal))
      );
      return segmentTotal + (allowed ? 0 : 3);
    }, 0),
  0);
}

function routeScore(route, obstacles, routedConnectors, relation) {
  const segments = routeSegments(route);
  const nodeIntersections = obstacles.reduce(
    (count, obstacle) => count + (segments.some(([start, end]) =>
      segmentCrossesRectangle(start, end, obstacle)
    ) ? 1 : 0),
    0
  );
  const connectorConflicts = routedConnectors.reduce(
    (count, previous) => count + connectorConflictUnits(route, relation, previous),
    0
  );
  return nodeIntersections * 1_000_000_000 + connectorConflicts * 100_000 +
    routeLength(route) + Math.max(0, route.length - 2) * 32;
}

const OUTER_LANE_SIDES = Object.freeze(["top", "right", "bottom", "left"]);

function sideCoordinate(rectangle, side, portRatio) {
  if (["top", "bottom"].includes(side)) {
    return round(rectangle.centerX + rectangle.width * portRatio);
  }
  return round(rectangle.centerY + rectangle.height * portRatio);
}

function sidePort(rectangle, side, portRatio) {
  const coordinate = sideCoordinate(rectangle, side, portRatio);
  if (side === "top") return { x: coordinate, y: rectangle.y };
  if (side === "right") return { x: rectangle.right, y: coordinate };
  if (side === "bottom") return { x: coordinate, y: rectangle.bottom };
  return { x: rectangle.x, y: coordinate };
}

function laneAnchor(rectangle, side, lane, portRatio) {
  const coordinate = sideCoordinate(rectangle, side, portRatio);
  if (side === "top") return { x: coordinate, y: lane.top };
  if (side === "right") return { x: lane.right, y: coordinate };
  if (side === "bottom") return { x: coordinate, y: lane.bottom };
  return { x: lane.left, y: coordinate };
}

function cornerAfter(side, lane) {
  if (side === "top") return { x: lane.right, y: lane.top };
  if (side === "right") return { x: lane.right, y: lane.bottom };
  if (side === "bottom") return { x: lane.left, y: lane.bottom };
  return { x: lane.left, y: lane.top };
}

function perimeterCorners(fromSide, toSide, lane, direction) {
  const corners = [];
  let sideIndex = OUTER_LANE_SIDES.indexOf(fromSide);
  const targetIndex = OUTER_LANE_SIDES.indexOf(toSide);
  while (sideIndex !== targetIndex) {
    if (direction > 0) {
      corners.push(cornerAfter(OUTER_LANE_SIDES[sideIndex], lane));
      sideIndex = (sideIndex + 1) % OUTER_LANE_SIDES.length;
    } else {
      sideIndex = (sideIndex - 1 + OUTER_LANE_SIDES.length) % OUTER_LANE_SIDES.length;
      corners.push(cornerAfter(OUTER_LANE_SIDES[sideIndex], lane));
    }
  }
  return corners;
}

function outerLaneRoute(from, to, lane, fromSide, toSide, direction, portRatio) {
  return deduplicateRoute([
    sidePort(from, fromSide, portRatio),
    laneAnchor(from, fromSide, lane, portRatio),
    ...perimeterCorners(fromSide, toSide, lane, direction),
    laneAnchor(to, toSide, lane, portRatio),
    sidePort(to, toSide, portRatio)
  ]);
}

function axisGapCenters(rectangles, axis, routeBounds) {
  const [minimumKey, maximumKey] = axis === "x"
    ? ["left", "right"]
    : ["top", "bottom"];
  const routeMinimum = routeBounds?.[minimumKey] ?? Number.NEGATIVE_INFINITY;
  const routeMaximum = routeBounds?.[maximumKey] ?? Number.POSITIVE_INFINITY;
  const boundaries = [...new Set(rectangles.flatMap((rectangle) => [
    round(rectangle[minimumKey]),
    round(rectangle[maximumKey])
  ]))].sort((left, right) => left - right);
  const minimumGapPx = CONNECTOR_CLEARANCE_PX * 2;
  return boundaries.slice(0, -1).flatMap((boundary, index) => {
    const next = boundaries[index + 1];
    if (next - boundary < minimumGapPx) return [];
    const center = round((boundary + next) / 2);
    return center >= routeMinimum && center <= routeMaximum ? [center] : [];
  });
}

function verticalLanePort(rectangle, laneX, other) {
  if (laneX < rectangle.left) return { x: rectangle.left, y: rectangle.centerY };
  if (laneX > rectangle.right) return { x: rectangle.right, y: rectangle.centerY };
  return {
    x: laneX,
    y: other.centerY >= rectangle.centerY ? rectangle.bottom : rectangle.top
  };
}

function horizontalLanePort(rectangle, laneY, other) {
  if (laneY < rectangle.top) return { x: rectangle.centerX, y: rectangle.top };
  if (laneY > rectangle.bottom) return { x: rectangle.centerX, y: rectangle.bottom };
  return {
    x: other.centerX >= rectangle.centerX ? rectangle.right : rectangle.left,
    y: laneY
  };
}

function verticalGapLaneRoute(from, to, laneX) {
  const start = verticalLanePort(from, laneX, to);
  const end = verticalLanePort(to, laneX, from);
  return deduplicateRoute([
    start,
    { x: laneX, y: start.y },
    { x: laneX, y: end.y },
    end
  ]);
}

function horizontalGapLaneRoute(from, to, laneY) {
  const start = horizontalLanePort(from, laneY, to);
  const end = horizontalLanePort(to, laneY, from);
  return deduplicateRoute([
    start,
    { x: start.x, y: laneY },
    { x: end.x, y: laneY },
    end
  ]);
}

function connectorRouteCandidates(structure, from, to, obstacles, routeBounds = null) {
  const directStart = boundaryPoint(from, { x: to.centerX, y: to.centerY });
  const directEnd = boundaryPoint(to, { x: from.centerX, y: from.centerY });
  const middleX = round((directStart.x + directEnd.x) / 2);
  const middleY = round((directStart.y + directEnd.y) / 2);
  const allRects = [from, to, ...obstacles];
  const globalEnvelope = {
    left: Math.min(...allRects.map((item) => item.x)),
    right: Math.max(...allRects.map((item) => item.right)),
    top: Math.min(...allRects.map((item) => item.y)),
    bottom: Math.max(...allRects.map((item) => item.bottom))
  };
  const localEnvelope = {
    left: Math.min(from.x, to.x),
    right: Math.max(from.right, to.right),
    top: Math.min(from.y, to.y),
    bottom: Math.max(from.bottom, to.bottom)
  };
  const minimumDimension = Math.min(
    ...allRects.flatMap((item) => [item.width, item.height])
  );
  const laneUnit = Math.max(18, Math.min(42, round(minimumDimension * 0.32)));
  const laneVariants = [
    { factor: 1, portRatio: 0 },
    { factor: 1.75, portRatio: -0.22 },
    { factor: 2.5, portRatio: 0.22 },
    { factor: 3.25, portRatio: -0.36 }
  ];
  const outerCandidates = [localEnvelope, globalEnvelope].flatMap((envelope) =>
    laneVariants.flatMap(({ factor, portRatio }) => {
      const offset = round(laneUnit * factor);
      const lane = {
        left: round(routeBounds ? Math.max(routeBounds.left, envelope.left - offset) : envelope.left - offset),
        right: round(routeBounds ? Math.min(routeBounds.right, envelope.right + offset) : envelope.right + offset),
        top: round(routeBounds ? Math.max(routeBounds.top, envelope.top - offset) : envelope.top - offset),
        bottom: round(routeBounds ? Math.min(routeBounds.bottom, envelope.bottom + offset) : envelope.bottom + offset)
      };
      return OUTER_LANE_SIDES.flatMap((fromSide) =>
        OUTER_LANE_SIDES.flatMap((toSide) =>
          [1, -1].map((direction) =>
            outerLaneRoute(from, to, lane, fromSide, toSide, direction, portRatio)
          )
        )
      );
    })
  );
  const verticalGapCandidates = axisGapCenters(allRects, "x", routeBounds).map((laneX) =>
    verticalGapLaneRoute(from, to, laneX)
  );
  const horizontalGapCandidates = axisGapCenters(allRects, "y", routeBounds).map((laneY) =>
    horizontalGapLaneRoute(from, to, laneY)
  );
  const candidates = [
    [directStart, directEnd],
    deduplicateRoute([
      directStart,
      { x: directEnd.x, y: directStart.y },
      directEnd
    ]),
    deduplicateRoute([
      directStart,
      { x: directStart.x, y: directEnd.y },
      directEnd
    ]),
    deduplicateRoute([
      directStart,
      { x: middleX, y: directStart.y },
      { x: middleX, y: directEnd.y },
      directEnd
    ]),
    deduplicateRoute([
      directStart,
      { x: directStart.x, y: middleY },
      { x: directEnd.x, y: middleY },
      directEnd
    ]),
    ...verticalGapCandidates,
    ...horizontalGapCandidates,
    ...outerCandidates
  ];
  if (structure === "timeline") candidates.reverse();
  const candidateKeys = new Set();
  const uniqueCandidates = candidates.filter((candidate) => {
    // “orthogonal”是几何合同，而不只是渲染标签：候选中的每一段都必须水平或垂直。
    if (!routeIsOrthogonal(candidate)) return false;
    const key = JSON.stringify(candidate);
    if (candidateKeys.has(key)) return false;
    candidateKeys.add(key);
    return true;
  });
  const nodeIntersectionCounts = uniqueCandidates.map((route) =>
    obstacles.reduce((count, obstacle) => count + (
      routeSegments(route).some(([start, end]) =>
        segmentCrossesRectangle(start, end, obstacle)
      ) ? 1 : 0
    ), 0)
  );
  const minimumIntersections = Math.min(...nodeIntersectionCounts);
  return uniqueCandidates.filter((route, index) =>
    nodeIntersectionCounts[index] === minimumIntersections
  );
}

function hierarchyContainmentRoute(from, to) {
  const start = { x: round(from.centerX), y: round(from.bottom) };
  const end = { x: round(to.centerX), y: round(to.top) };
  if (end.y <= start.y) return null;
  if (Math.abs(start.x - end.x) < 1e-7) return [start, end];
  const railY = round((start.y + end.y) / 2);
  return deduplicateRoute([
    start,
    { x: start.x, y: railY },
    { x: end.x, y: railY },
    end
  ]);
}

function bestConnectorRoute(candidates, obstacles, routedConnectors, relation) {
  return candidates.map((route, index) => ({
    route,
    index,
    score: routeScore(route, obstacles, routedConnectors, relation)
  })).sort((left, right) => left.score - right.score || left.index - right.index)[0];
}

function connectorWithRoute(item, route) {
  return { ...item.connector, route };
}

function optimizeConnectorRoutes(routed, initialRoutes) {
  const routes = [...initialRoutes];
  const maximumPasses = Math.max(2, Math.min(8, routed.length));
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let changed = false;
    for (let index = 0; index < routed.length; index += 1) {
      const item = routed[index];
      const otherConnectors = routed.flatMap((candidate, candidateIndex) =>
        candidateIndex === index
          ? []
          : [connectorWithRoute(candidate, routes[candidateIndex])]
      );
      const currentScore = routeScore(
        routes[index],
        item.obstacles,
        otherConnectors,
        item.relation
      );
      const best = bestConnectorRoute(
        item.candidates,
        item.obstacles,
        otherConnectors,
        item.relation
      );
      if (best.score + 1e-7 < currentScore) {
        routes[index] = best.route;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return routes;
}

function connectorRouteSetScore(routed, routes) {
  const baseScore = routes.reduce((sum, route) =>
    sum + routeLength(route) + Math.max(0, route.length - 2) * 32,
  0);
  let conflictUnits = 0;
  for (let leftIndex = 0; leftIndex < routed.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < routed.length; rightIndex += 1) {
      conflictUnits += connectorConflictUnits(
        routes[leftIndex],
        routed[leftIndex].relation,
        connectorWithRoute(routed[rightIndex], routes[rightIndex])
      );
    }
  }
  return conflictUnits * 100_000 + baseScore;
}

function sequentialConnectorRoutes(routed, order) {
  const routes = Array(routed.length);
  const selected = [];
  for (const index of order) {
    const item = routed[index];
    routes[index] = bestConnectorRoute(
      item.candidates,
      item.obstacles,
      selected,
      item.relation
    ).route;
    selected.push(connectorWithRoute(item, routes[index]));
  }
  return routes;
}

function buildConnectors(structure, relations, geometryById, routeBounds = null) {
  const routed = [];
  for (const relation of relations) {
    const from = geometryById[relation.from];
    const to = geometryById[relation.to];
    if (!from || !to) continue;
    const obstacles = Object.entries(geometryById)
      .filter(([id]) => ![relation.from, relation.to].includes(id))
      .map(([, geometry]) => geometry);
    const containmentRoute = structure === "hierarchy" &&
      (relation.semanticType ?? relation.type) === "contains"
      ? hierarchyContainmentRoute(from, to)
      : null;
    routed.push({
      connector: {
        id: `connector-${relation.id}`,
        relationId: relation.id,
        from: relation.from,
        to: relation.to,
        arrowhead: relation.directed === true,
        primitive: relation.directed === true ? "directed-connector" : "relationship-line"
      },
      relation,
      obstacles,
      span: Math.hypot(to.centerX - from.centerX, to.centerY - from.centerY),
      candidates: containmentRoute == null
        ? connectorRouteCandidates(structure, from, to, obstacles, routeBounds)
        : [containmentRoute]
    });
  }
  const naturalOrder = routed.map((_, index) => index);
  const routeOrders = [
    naturalOrder,
    [...naturalOrder].reverse(),
    [...naturalOrder].sort((left, right) => routed[right].span - routed[left].span || left - right),
    [...naturalOrder].sort((left, right) => routed[left].span - routed[right].span || left - right)
  ];
  const orderKeys = new Set();
  const routeSets = routeOrders.flatMap((order) => {
    const key = order.join(",");
    if (orderKeys.has(key)) return [];
    orderKeys.add(key);
    const initialRoutes = sequentialConnectorRoutes(routed, order);
    return [optimizeConnectorRoutes(routed, initialRoutes)];
  });
  const bestRoutes = routeSets.map((routes, index) => ({
    routes,
    index,
    score: connectorRouteSetScore(routed, routes)
  })).sort((left, right) => left.score - right.score || left.index - right.index)[0]?.routes ?? [];
  for (let index = 0; index < routed.length; index += 1) {
    routed[index].connector.route = bestRoutes[index];
  }
  return routed.map((item) => item.connector);
}

export function visualSystemV1GrammarConnectors({
  structure,
  semanticRelations,
  geometryById,
  routeBounds = null,
  connectorPresentationByRelationId = null,
  connectorPolicy = "allow-smooth"
} = {}) {
  if (!VISUAL_SYSTEM_V1_GRAMMAR_STRUCTURES.includes(structure)) {
    throw new TypeError(`不支持的视觉结构：${structure ?? "missing"}`);
  }
  if (!Array.isArray(semanticRelations) || !geometryById || typeof geometryById !== "object") {
    throw new TypeError("视觉语法连线需要 semanticRelations 与 geometryById");
  }
  if (
    connectorPresentationByRelationId != null &&
    (typeof connectorPresentationByRelationId !== "object" || Array.isArray(connectorPresentationByRelationId))
  ) {
    throw new TypeError("connectorPresentationByRelationId 必须是对象");
  }
  if (!VISUAL_SYSTEM_V1_CONNECTOR_POLICIES.includes(connectorPolicy)) {
    throw new TypeError(`不支持的连接线策略：${connectorPolicy ?? "missing"}`);
  }
  const connectors = buildConnectors(structure, semanticRelations, geometryById, routeBounds);
  for (const connector of connectors) {
    const presentation = connectorPresentationByRelationId?.[connector.relationId];
    if (presentation == null) {
      connector.presentationKind = "orthogonal";
      continue;
    }
    if (
      typeof presentation !== "object" ||
      Array.isArray(presentation) ||
      !VISUAL_SYSTEM_V1_CONNECTOR_PRESENTATION_KINDS.includes(presentation.kind)
    ) {
      throw new TypeError(`${connector.relationId} 的连接线展示配置无效`);
    }
    if (connectorPolicy === "orthogonal-only" && presentation.kind === "smooth-curve") {
      throw new TypeError(`${connector.relationId} 在 orthogonal-only 策略下禁止平滑曲线`);
    }
    connector.presentationKind = presentation.kind;
    if (presentation.kind === "smooth-curve") {
      connector.pathD = visualSystemV1SmoothConnectorPath({
        fromGeometry: geometryById[connector.from],
        toGeometry: geometryById[connector.to],
        fromPort: presentation.fromPort,
        toPort: presentation.toPort
      });
    }
  }
  return deepFreeze(connectors);
}

function rectangleInside(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.right <= outer.right && inner.bottom <= outer.bottom;
}

function rectanglesViolateGap(left, right, gap) {
  return left.x < right.right + gap && left.right > right.x - gap &&
    left.y < right.bottom + gap && left.bottom > right.y - gap;
}

function standaloneOverlayCandidate(anchor, side, width, height, gap) {
  if (side === "right") {
    return rect(anchor.right + gap, anchor.centerY - height / 2, width, height);
  }
  if (side === "left") {
    return rect(anchor.x - gap - width, anchor.centerY - height / 2, width, height);
  }
  if (side === "top") {
    return rect(anchor.centerX - width / 2, anchor.y - gap - height, width, height);
  }
  return rect(anchor.centerX - width / 2, anchor.bottom + gap, width, height);
}

/**
 * 为独立状态标记或语义图标寻找非遮挡槽位。
 *
 * 候选严格按右、左、上、下（或调用方给定顺序）尝试；候选必须完整位于
 * safeArea 内，并与全部节点和连接线保持最小间距。这里故意不做 clamp：
 * 没有合法槽位时 fail closed，避免“勉强塞入”后覆盖文案、边框或箭头。
 */
export function visualSystemV1StandaloneOverlaySlot({
  anchorGeometry,
  overlaySize,
  safeArea,
  geometryById,
  connectors = [],
  minimumGapPx = 24,
  preferredSides = VISUAL_SYSTEM_V1_STANDALONE_OVERLAY_SLOT_SIDES
} = {}) {
  const anchor = connectorRectangle(anchorGeometry, "overlay 锚点几何");
  const safeBounds = connectorRectangle(safeArea, "overlay 安全区");
  if (!overlaySize || typeof overlaySize !== "object" || Array.isArray(overlaySize)) {
    throw new TypeError("overlaySize 必须是尺寸对象");
  }
  const width = finitePositive(overlaySize.width, "overlay 宽度");
  const height = finitePositive(overlaySize.height, "overlay 高度");
  if (!Number.isFinite(minimumGapPx) || minimumGapPx < 0) {
    throw new TypeError("overlay 最小间距必须是非负数");
  }
  if (!geometryById || typeof geometryById !== "object" || Array.isArray(geometryById)) {
    throw new TypeError("overlay 槽位检查需要 geometryById");
  }
  if (!Array.isArray(connectors)) {
    throw new TypeError("overlay 槽位检查的 connectors 必须是数组");
  }
  if (
    !Array.isArray(preferredSides) ||
    preferredSides.length === 0 ||
    new Set(preferredSides).size !== preferredSides.length ||
    preferredSides.some((side) => !VISUAL_SYSTEM_V1_STANDALONE_OVERLAY_SLOT_SIDES.includes(side))
  ) {
    throw new TypeError("overlay 候选方向必须是无重复的 right/left/top/bottom 数组");
  }
  const nodes = Object.entries(geometryById).map(([id, geometry]) => ({
    id,
    geometry: connectorRectangle(geometry, `节点 ${id} 几何`)
  }));
  const connectorRoutes = connectors.map((connector, index) => {
    if (!connector || !Array.isArray(connector.route) || connector.route.length < 2) {
      throw new TypeError(`第 ${index + 1} 条连接线缺少 route`);
    }
    return connector.route;
  });

  for (const side of preferredSides) {
    const candidate = standaloneOverlayCandidate(anchor, side, width, height, minimumGapPx);
    if (!rectangleInside(candidate, safeBounds)) continue;
    if (nodes.some(({ geometry }) => rectanglesViolateGap(candidate, geometry, minimumGapPx))) {
      continue;
    }
    if (connectorRoutes.some((route) => routeSegments(route).some(([start, end]) =>
      segmentCrossesRectangle(start, end, candidate, minimumGapPx)
    ))) {
      continue;
    }
    return deepFreeze({
      render: true,
      reason: "safe-slot",
      side,
      bounds: bounds(candidate)
    });
  }

  return deepFreeze({
    render: false,
    reason: "no-safe-slot",
    side: null,
    bounds: null
  });
}

function colorRoleFor(element) {
  if (element.importance === "primary") return "accent-primary";
  if (element.importance === "secondary") return "accent-secondary";
  return "surface-muted";
}

function surfacePlanForElement(element, primitive, surfacePlanById) {
  const planned = surfacePlanById?.[element.id];
  if (planned == null) {
    const informationCard = VISUAL_SYSTEM_V1_INFORMATION_CARD_PRIMITIVES.includes(primitive);
    return {
      semanticGroupId: element.id,
      semanticRole: element.semanticRole ?? "concept",
      visualHierarchyLevel: element.importance ?? "supporting",
      surfaceRole: informationCard ? "information-card" : "open-canvas",
      surfacePurpose: informationCard ? "actionable-object" : "relationship-structure"
    };
  }
  if (
    typeof planned !== "object" ||
    Array.isArray(planned) ||
    typeof planned.semanticGroupId !== "string" ||
    planned.semanticGroupId.length === 0 ||
    typeof planned.semanticRole !== "string" ||
    planned.semanticRole.length === 0 ||
    !EDITORIAL_VISUAL_HIERARCHY_LEVELS.includes(planned.visualHierarchyLevel) ||
    !EDITORIAL_SURFACE_ROLES.includes(planned.surfaceRole) ||
    typeof planned.surfacePurpose !== "string" ||
    planned.surfacePurpose.length === 0
  ) {
    throw new TypeError(`${element.id} 的 surfacePlan 无效`);
  }
  return planned;
}

function assertSurfacePlanCoverage(elements, surfacePlanById) {
  if (surfacePlanById == null) return;
  if (typeof surfacePlanById !== "object" || Array.isArray(surfacePlanById)) {
    throw new TypeError("surfacePlanById 必须是对象");
  }
  const missing = elements.filter((element) => surfacePlanById[element.id] == null);
  if (missing.length > 0) {
    throw new TypeError(`surfacePlanById 缺少：${missing.map((item) => item.id).join("、")}`);
  }
}

function layoutSampleFor(
  width,
  height,
  visualPlan,
  area,
  elements,
  placement,
  connectors,
  surfacePlanById
) {
  const minimumFontSize = Number.isFinite(visualPlan.acceptance?.minimumBodyFontPx)
    ? visualPlan.acceptance.minimumBodyFontPx
    : 28;
  const fontSizePx = Math.max(
    minimumFontSize,
    round(32 * Math.min(width / REFERENCE_CANVAS.width, height / REFERENCE_CANVAS.height))
  );
  const textAreaRatio = round(1 - (area.width * area.height) / (width * height));
  return {
    frame: 0,
    canvas: { x: 0, y: 0, width, height },
    safeArea: bounds(area),
    regions: { graphic: bounds(area) },
    elements: elements.flatMap((element) => {
      const geometry = placement.geometryById[element.id];
      if (!geometry) return [];
      const primitive = placement.primitiveById[element.id];
      const surfacePlan = surfacePlanForElement(element, primitive, surfacePlanById);
      const informationCard = surfacePlan.surfaceRole === "information-card";
      return [{
        id: element.id,
        kind: "shape",
        primitive,
        visualEncoding: "semantic-diagram",
        semanticGroupId: surfacePlan.semanticGroupId,
        surfaceRole: surfacePlan.surfaceRole,
        surfacePurpose: surfacePlan.surfacePurpose,
        iconPlacement: "none",
        borderMode: informationCard ? "full-outline" : "shape-outline",
        borderWidthPx: informationCard ? 3 : null,
        borderColorRole: informationCard ? "line-primary" : null,
        borderRadiusPx: informationCard ? 18 : null,
        shadowMode: "none",
        bounds: bounds(geometry),
        peerGroup: placement.peerGroupById[element.id] ?? "",
        colorRole: colorRoleFor(element),
        lineRole: placement.primitiveById[element.id] === "evidence-frame"
          ? "boundary"
          : "relationship-secondary",
        typographyRole: "node-label",
        fontSizePx,
        narrativeRole: surfacePlan.semanticRole,
        visualHierarchyLevel: surfacePlan.visualHierarchyLevel
      }];
    }),
    connectors: connectors.map((connector) => ({ ...connector })),
    metrics: { textAreaRatio }
  };
}

export function visualSystemV1GrammarLayout({
  width,
  height,
  visualPlan,
  visibleElementIds,
  semanticContentById = null,
  primitiveOverrideById = null,
  surfacePlanById = null,
  flowLayoutProfile = null,
  hierarchyLayoutProfile = null
} = {}) {
  finitePositive(width, "画布宽度");
  finitePositive(height, "画布高度");
  assertVisualPlan(visualPlan);
  if (
    hierarchyLayoutProfile != null &&
    !VISUAL_SYSTEM_V1_HIERARCHY_LAYOUT_PROFILES.includes(hierarchyLayoutProfile)
  ) {
    throw new TypeError(`不支持的层级布局配置：${hierarchyLayoutProfile}`);
  }
  if (hierarchyLayoutProfile != null && visualPlan.structure !== "hierarchy") {
    throw new TypeError("hierarchyLayoutProfile 只允许用于 hierarchy 结构");
  }
  const selectedElements = visualPlan.structure === "none"
    ? []
    : visibleElements(visualPlan, visibleElementIds);
  const relations = visibleRelations(
    visualPlan,
    selectedElements.map((element) => element.id)
  );
  assertSurfacePlanCoverage(selectedElements, surfacePlanById);
  const safeArea = visualSystemV1GrammarSafeArea(width, height);
  const placement = applyPrimitiveOverrides(placementFor(
    visualPlan.structure,
    selectedElements,
    relations,
    safeArea,
    width,
    height,
    semanticContentById,
    primitiveOverrideById,
    flowLayoutProfile,
    hierarchyLayoutProfile
  ), selectedElements, primitiveOverrideById);
  const connectors = buildConnectors(
    visualPlan.structure,
    relations,
    placement.geometryById
  );
  const layoutSample = layoutSampleFor(
    width,
    height,
    visualPlan,
    safeArea,
    selectedElements,
    placement,
    connectors,
    surfacePlanById
  );
  return deepFreeze({
    structure: visualPlan.structure,
    safeArea,
    geometryById: placement.geometryById,
    primitiveById: placement.primitiveById,
    connectors,
    layoutSample
  });
}

export const resolveVisualSystemV1GrammarLayout = visualSystemV1GrammarLayout;
