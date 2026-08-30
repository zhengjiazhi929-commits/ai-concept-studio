import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  VISUAL_SYSTEM_V1_CONNECTOR_POLICIES,
  VISUAL_SYSTEM_V1_CONNECTOR_PORTS,
  VISUAL_SYSTEM_V1_CONNECTOR_PRESENTATION_KINDS,
  VISUAL_SYSTEM_V1_GRAMMAR_STRUCTURES,
  VISUAL_SYSTEM_V1_HIERARCHY_LAYOUT_PROFILES,
  VISUAL_SYSTEM_V1_INFORMATION_CARD_PRIMITIVES,
  VISUAL_SYSTEM_V1_OPEN_DIAGRAM_CONTENT_OCCUPANCY,
  VISUAL_SYSTEM_V1_STANDALONE_OVERLAY_SLOT_SIDES,
  visualSystemV1GrammarConnectors,
  visualSystemV1GrammarLayout,
  visualSystemV1GrammarSafeArea,
  visualSystemV1SmoothConnectorPath,
  visualSystemV1StandaloneOverlaySlot
} from "../src/video/components/visual-system-v1/grammar-layout.mjs";
import { visualSystemV1ContentCardMetrics } from "../src/video/components/visual-system-v1/content-layout.mjs";
import {
  createVisualExpressionIntent,
  resolveVisualExpressionPlan,
  validateVisualExpressionScene
} from "../src/shared/visual-expression-contract.mjs";

const IDS = ["a", "b", "c", "d", "e", "f"];

function semanticElements(ids = IDS) {
  return ids.map((id, index) => ({
    id,
    label: `Element ${index + 1}`,
    semanticRole: index === 2 ? "decision" : index === ids.length - 1 ? "result" : "concept",
    importance: index === 2 ? "primary" : "secondary",
    claimIds: ["claim-layout"]
  }));
}

function chainRelations(ids = IDS, directed = true) {
  return ids.slice(0, -1).map((id, index) => ({
    id: `relation-${id}-${ids[index + 1]}`,
    from: id,
    to: ids[index + 1],
    type: "then",
    label: "next",
    directed,
    claimIds: ["claim-layout"]
  }));
}

function branchRelations() {
  return [
    { id: "a-c", from: "a", to: "c", directed: true },
    { id: "b-c", from: "b", to: "c", directed: true },
    { id: "c-d", from: "c", to: "d", directed: true },
    { id: "c-e", from: "c", to: "e", directed: true },
    { id: "e-f", from: "e", to: "f", directed: true }
  ];
}

function plan(structure, { relations = chainRelations(), elements = semanticElements() } = {}) {
  return {
    sceneId: `scene-${structure}`,
    structure,
    semanticElements: elements,
    semanticRelations: relations
  };
}

function geometrySignature(layout) {
  return Object.entries(layout.geometryById)
    .map(([id, geometry]) => [id, geometry.x, geometry.y, geometry.width, geometry.height])
    .sort(([left], [right]) => left.localeCompare(right));
}

function pointOnBoundary(point, geometry, tolerance = 0.001) {
  const onHorizontal =
    Math.abs(point.x - geometry.x) <= tolerance ||
    Math.abs(point.x - geometry.right) <= tolerance;
  const onVertical =
    Math.abs(point.y - geometry.y) <= tolerance ||
    Math.abs(point.y - geometry.bottom) <= tolerance;
  const insideX = point.x >= geometry.x - tolerance && point.x <= geometry.right + tolerance;
  const insideY = point.y >= geometry.y - tolerance && point.y <= geometry.bottom + tolerance;
  return insideX && insideY && (onHorizontal || onVertical);
}

function rectanglesOverlap(left, right) {
  return Math.max(left.x, right.x) < Math.min(left.right, right.right) &&
    Math.max(left.y, right.y) < Math.min(left.bottom, right.bottom);
}

function testGeometry(x, y, width = 120, height = 80) {
  return {
    x,
    y,
    left: x,
    top: y,
    width,
    height,
    right: x + width,
    bottom: y + height,
    centerX: x + width / 2,
    centerY: y + height / 2
  };
}

function routeSegments(route) {
  return route.slice(0, -1).map((point, index) => [point, route[index + 1]]);
}

function assertOrthogonalRoute(route, message = "连接线含斜向线段") {
  assert.ok(route.length >= 2, "连接线至少需要两个端点");
  for (const [start, end] of routeSegments(route)) {
    assert.ok(
      Math.abs(start.x - end.x) < 1e-7 || Math.abs(start.y - end.y) < 1e-7,
      `${message}: ${JSON.stringify(start)} -> ${JSON.stringify(end)}`
    );
  }
}

function testOrientation(a, b, c) {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(value) < 1e-7 ? 0 : Math.sign(value);
}

function testPointOnSegment(point, start, end) {
  return point.x >= Math.min(start.x, end.x) - 1e-7 &&
    point.x <= Math.max(start.x, end.x) + 1e-7 &&
    point.y >= Math.min(start.y, end.y) - 1e-7 &&
    point.y <= Math.max(start.y, end.y) + 1e-7;
}

function testSegmentsConflict(a, b, c, d) {
  const first = testOrientation(a, b, c);
  const second = testOrientation(a, b, d);
  const third = testOrientation(c, d, a);
  const fourth = testOrientation(c, d, b);
  if (first * second < 0 && third * fourth < 0) return true;
  return (first === 0 && testPointOnSegment(c, a, b)) ||
    (second === 0 && testPointOnSegment(d, a, b)) ||
    (third === 0 && testPointOnSegment(a, c, d)) ||
    (fourth === 0 && testPointOnSegment(b, c, d));
}

function routeCrossesRectangle(route, rectangle) {
  const corners = [
    { x: rectangle.x, y: rectangle.y },
    { x: rectangle.right, y: rectangle.y },
    { x: rectangle.right, y: rectangle.bottom },
    { x: rectangle.x, y: rectangle.bottom }
  ];
  return routeSegments(route).some(([start, end]) => {
    const endpointInside = [start, end].some((point) =>
      point.x > rectangle.x && point.x < rectangle.right &&
      point.y > rectangle.y && point.y < rectangle.bottom
    );
    return endpointInside || corners.some((corner, index) =>
      testSegmentsConflict(start, end, corner, corners[(index + 1) % corners.length])
    );
  });
}

function routesConflict(left, right) {
  return routeSegments(left).some(([a, b]) =>
    routeSegments(right).some(([c, d]) => testSegmentsConflict(a, b, c, d))
  );
}

test("默认内容安全区按 1920x1080 基准等比映射", () => {
  assert.deepEqual(
    visualSystemV1GrammarSafeArea(1920, 1080),
    {
      x: 120,
      y: 340,
      left: 120,
      top: 340,
      width: 1520,
      height: 460,
      right: 1640,
      bottom: 800,
      centerX: 880,
      centerY: 570
    }
  );
  const doubled = visualSystemV1GrammarSafeArea(3840, 2160);
  assert.deepEqual(
    { x: doubled.x, y: doubled.y, right: doubled.right, bottom: doubled.bottom },
    { x: 240, y: 680, right: 3280, bottom: 1600 }
  );
});

test("六种核心关系语法具有不同几何和原语，不回落同一卡片网格", () => {
  const structures = ["comparison", "timeline", "flow", "hierarchy", "branch", "feedback-loop"];
  const layouts = structures.map((structure) => visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan: plan(structure, {
      relations: structure === "branch" ? branchRelations() : chainRelations(IDS, structure !== "comparison")
    }),
    visibleElementIds: IDS
  }));
  const signatures = new Set(layouts.map((layout) => JSON.stringify(geometrySignature(layout))));
  assert.equal(signatures.size, structures.length);
  assert.equal(new Set(layouts.map((layout) => layout.primitiveById.a)).size, structures.length);
  assert.equal(layouts.find((layout) => layout.structure === "flow").primitiveById.a, "flow-step");
  assert.equal(layouts.find((layout) => layout.structure === "timeline").primitiveById.a, "timeline-anchor");
  assert.equal(layouts.find((layout) => layout.structure === "feedback-loop").primitiveById.a, "loop-node");
});

test("progressive-package 层级保持根节点稳定、当前子树紧凑并把反例放在核心树外", () => {
  assert.deepEqual(VISUAL_SYSTEM_V1_HIERARCHY_LAYOUT_PROFILES, ["progressive-package"]);
  const elements = semanticElements(["root", "skill", "scripts", "references", "assets", "prompt"]);
  const relations = [
    ["root-skill", "root", "skill", "contains"],
    ["root-scripts", "root", "scripts", "contains"],
    ["root-references", "root", "references", "contains"],
    ["root-assets", "root", "assets", "contains"],
    ["root-prompt", "root", "prompt", "contrasts-with"]
  ].map(([id, from, to, type]) => ({ id, from, to, type, directed: false }));
  const visualPlan = plan("hierarchy", { elements, relations });
  const rootOnly = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan,
    visibleElementIds: ["root"],
    hierarchyLayoutProfile: "progressive-package"
  });
  const firstBranch = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan,
    visibleElementIds: ["root", "skill"],
    hierarchyLayoutProfile: "progressive-package"
  });
  assert.equal(rootOnly.geometryById.root.y, firstBranch.geometryById.root.y);
  assert.equal(firstBranch.geometryById.root.centerX, firstBranch.geometryById.skill.centerX);
  assert.deepEqual(firstBranch.connectors[0].route, [
    { x: firstBranch.geometryById.root.centerX, y: firstBranch.geometryById.root.bottom },
    { x: firstBranch.geometryById.skill.centerX, y: firstBranch.geometryById.skill.top }
  ]);

  const complete = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan,
    visibleElementIds: elements.map((element) => element.id),
    hierarchyLayoutProfile: "progressive-package"
  });
  const coreIds = ["root", "skill", "scripts", "references", "assets"];
  assert.ok(
    complete.geometryById.prompt.x > Math.max(...coreIds.map((id) => complete.geometryById[id].right))
  );
  const contains = complete.connectors.filter((connector) => connector.relationId !== "root-prompt");
  assert.equal(contains.length, 4);
  for (const connector of contains) {
    assertOrthogonalRoute(connector.route);
    assert.equal(connector.route[0].x, complete.geometryById.root.centerX);
    assert.equal(connector.route[0].y, complete.geometryById.root.bottom);
    const target = complete.geometryById[connector.to];
    assert.deepEqual(connector.route.at(-1), { x: target.centerX, y: target.top });
  }
});

test("卡片原语登记完整边框，非卡片原语保持图解对象", () => {
  const flow = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan: plan("flow"),
    visibleElementIds: IDS
  });
  assert.ok(VISUAL_SYSTEM_V1_INFORMATION_CARD_PRIMITIVES.includes("flow-step"));
  assert.ok(flow.layoutSample.elements.every((element) =>
    element.surfaceRole === "information-card" &&
    element.borderMode === "full-outline" &&
    element.borderWidthPx === 3 &&
    element.borderColorRole === "line-primary" &&
    element.borderRadiusPx === 18 &&
    element.shadowMode === "none" &&
    element.visualEncoding === "semantic-diagram"
  ));

  const timeline = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan: plan("timeline"),
    visibleElementIds: IDS
  });
  assert.ok(timeline.layoutSample.elements.every((element) =>
    element.primitive === "timeline-anchor" &&
    element.surfaceRole === "open-canvas" &&
    element.borderMode === "shape-outline" &&
    element.borderWidthPx === null
  ));
});

test("surfacePlan 是卡片与开放图解的唯一真源，primitive 只负责几何语法", () => {
  const elements = semanticElements(["a"]);
  const flowPlan = plan("flow", { elements, relations: [] });
  const openFlow = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan: flowPlan,
    visibleElementIds: ["a"],
    surfacePlanById: {
      a: {
        semanticGroupId: "surface-plan-demo",
        semanticRole: "process-step",
        visualHierarchyLevel: "secondary",
        surfaceRole: "open-canvas",
        surfacePurpose: "process-anchor"
      }
    }
  });
  assert.equal(openFlow.primitiveById.a, "flow-step");
  assert.equal(openFlow.layoutSample.elements[0].surfaceRole, "open-canvas");
  assert.equal(openFlow.layoutSample.elements[0].surfacePurpose, "process-anchor");

  const timelinePlan = plan("timeline", { elements, relations: [] });
  const cardTimeline = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan: timelinePlan,
    visibleElementIds: ["a"],
    surfacePlanById: {
      a: {
        semanticGroupId: "surface-plan-demo",
        semanticRole: "state",
        visualHierarchyLevel: "primary",
        surfaceRole: "information-card",
        surfacePurpose: "state-container"
      }
    }
  });
  assert.equal(cardTimeline.primitiveById.a, "timeline-anchor");
  assert.equal(cardTimeline.layoutSample.elements[0].surfaceRole, "information-card");
  assert.equal(cardTimeline.layoutSample.elements[0].borderMode, "full-outline");
});

test("内容驱动 flow 只为开放图解 glyph 扩宽，普通文字卡不再保留图标槽", () => {
  const elements = semanticElements(["parked", "skill", "agent", "tool"]);
  const relations = chainRelations(["parked", "skill", "agent", "tool"]);
  const semanticContentById = {
    parked: { label: "其余材料未加载", detail: "不占当前上下文" },
    skill: { label: "Skill / 方法", detail: "核对指标与结论" },
    agent: { label: "Agent / 判断", detail: "选择顺序与验收" },
    tool: { label: "Tool / 动作", detail: "查询与写入" }
  };
  const primitiveOverrideById = {
    parked: "diagram-output",
    skill: "process-anchor",
    agent: "decision-gate"
  };
  const layout = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan: plan("flow", { elements, relations }),
    visibleElementIds: ["parked", "skill", "agent", "tool"],
    semanticContentById,
    primitiveOverrideById
  });
  const cardOptions = {
    labelFontSizePx: 32,
    detailFontSizePx: 20,
    horizontalPaddingPx: 26,
    minimumCardWidthPx: 300
  };

  for (const id of ["parked", "skill", "agent"]) {
    const metrics = visualSystemV1ContentCardMetrics({
      id,
      ...semanticContentById[id],
      visualOccupancy: VISUAL_SYSTEM_V1_OPEN_DIAGRAM_CONTENT_OCCUPANCY
    }, cardOptions);
    assert.ok(layout.geometryById[id].width >= metrics.minWidth, `${id} 未给 glyph 与单行标题留足宽度`);
    assert.deepEqual(metrics.visualOccupancy, { leadingPx: 88, trailingPx: 18 });
    assert.equal(
      layout.layoutSample.elements.find((element) => element.id === id).peerGroup,
      "",
      `${id} 的内容宽度不同，不应被误归为等尺寸 peer group`
    );
  }

  const toolMetrics = visualSystemV1ContentCardMetrics({
    id: "tool",
    ...semanticContentById.tool
  }, cardOptions);
  assert.equal(toolMetrics.visualOccupancy, null);
  assert.equal(toolMetrics.iconOccupancyPx, 0);
  assert.ok(layout.geometryById.tool.width >= toolMetrics.minWidth);
  assert.equal(layout.primitiveById.tool, "flow-step");
  assert.equal(
    layout.layoutSample.elements.find((element) => element.id === "tool").iconPlacement,
    "none"
  );
});

test("开放图解占位参与最小宽度计算，而不是渲染后再挤进既有卡宽", () => {
  const elements = semanticElements(["parked"]);
  const visualPlan = plan("flow", { elements, relations: [] });
  const input = {
    width: 1920,
    height: 1080,
    visualPlan,
    visibleElementIds: ["parked"],
    semanticContentById: {
      parked: { label: "其余材料未加载", detail: "不占当前上下文" }
    }
  };
  const cardLayout = visualSystemV1GrammarLayout(input);
  const diagramLayout = visualSystemV1GrammarLayout({
    ...input,
    primitiveOverrideById: { parked: "diagram-output" }
  });

  assert.ok(diagramLayout.geometryById.parked.width > cardLayout.geometryById.parked.width);
  assert.equal(cardLayout.geometryById.parked.width, 300);
  assert.equal(diagramLayout.primitiveById.parked, "diagram-output");
});

test("全部合同结构都由独立分支解析并返回完整布局产物", () => {
  assert.equal(VISUAL_SYSTEM_V1_GRAMMAR_STRUCTURES.length, 14);
  for (const structure of VISUAL_SYSTEM_V1_GRAMMAR_STRUCTURES) {
    const layout = visualSystemV1GrammarLayout({
      width: 1920,
      height: 1080,
      visualPlan: plan(structure, {
        relations: structure === "branch" ? branchRelations() : chainRelations()
      }),
      visibleElementIds: IDS
    });
    assert.equal(layout.structure, structure);
    assert.ok(layout.geometryById && layout.primitiveById);
    assert.ok(Array.isArray(layout.connectors));
    for (const connector of layout.connectors) {
      assertOrthogonalRoute(connector.route, `${structure} 结构输出了斜向连线`);
    }
    assert.deepEqual(layout.layoutSample.safeArea, {
      x: 120,
      y: 340,
      width: 1520,
      height: 460
    });
    const expectedCount = structure === "none" ? 0 : IDS.length;
    assert.equal(Object.keys(layout.geometryById).length, expectedCount, structure);
    assert.equal(layout.layoutSample.elements.length, expectedCount, structure);
  }
});

test("十二个语义对象在所有图形结构中仍保持安全区内且互不遮挡", () => {
  const ids = Array.from({ length: 12 }, (_, index) => `item-${index + 1}`);
  const elements = semanticElements(ids);
  const relations = chainRelations(ids);
  for (const structure of VISUAL_SYSTEM_V1_GRAMMAR_STRUCTURES.filter((item) => item !== "none")) {
    const layout = visualSystemV1GrammarLayout({
      width: 1920,
      height: 1080,
      visualPlan: plan(structure, { elements, relations }),
      visibleElementIds: ids
    });
    const geometries = Object.values(layout.geometryById);
    for (const geometry of geometries) {
      assert.ok(geometry.x >= layout.safeArea.x, `${structure}: left crop`);
      assert.ok(geometry.y >= layout.safeArea.y, `${structure}: top crop`);
      assert.ok(geometry.right <= layout.safeArea.right, `${structure}: right crop`);
      assert.ok(geometry.bottom <= layout.safeArea.bottom, `${structure}: bottom crop`);
    }
    for (let leftIndex = 0; leftIndex < geometries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < geometries.length; rightIndex += 1) {
        assert.equal(
          rectanglesOverlap(geometries[leftIndex], geometries[rightIndex]),
          false,
          `${structure}: overlapping elements ${leftIndex}/${rightIndex}`
        );
      }
    }
  }
});

test("可见元素过滤同步移除不可见关系，且布局函数确定、纯净", () => {
  const visualPlan = plan("flow");
  const snapshot = structuredClone(visualPlan);
  const input = {
    width: 1920,
    height: 1080,
    visualPlan,
    visibleElementIds: ["a", "b", "c"]
  };
  const first = visualSystemV1GrammarLayout(input);
  const second = visualSystemV1GrammarLayout(input);
  assert.deepEqual(first, second);
  assert.deepEqual(visualPlan, snapshot);
  assert.deepEqual(Object.keys(first.geometryById), ["a", "b", "c"]);
  assert.deepEqual(first.connectors.map((connector) => connector.relationId), ["relation-a-b", "relation-b-c"]);
  assert.ok(Object.isFrozen(first));
  assert.throws(
    () => visualSystemV1GrammarLayout({ ...input, visibleElementIds: ["a", "unknown"] }),
    /未知 id/u
  );
});

test("语义连线端点由元素边界几何计算，箭头只服从 directed", () => {
  const visualPlan = plan("flow", { elements: semanticElements(["a", "b", "c"]), relations: chainRelations(["a", "b", "c"]) });
  const layout = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan,
    visibleElementIds: ["a", "b", "c"]
  });
  assert.equal(layout.connectors.length, 2);
  for (const connector of layout.connectors) {
    assert.equal(connector.arrowhead, true);
    assert.ok(connector.route.length >= 2);
    assertOrthogonalRoute(connector.route);
    assert.ok(pointOnBoundary(connector.route[0], layout.geometryById[connector.from]));
    assert.ok(pointOnBoundary(connector.route.at(-1), layout.geometryById[connector.to]));
  }
  const comparison = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan: plan("comparison", {
      elements: semanticElements(["a", "b"]),
      relations: chainRelations(["a", "b"], false)
    }),
    visibleElementIds: ["a", "b"]
  });
  assert.equal(comparison.connectors[0].arrowhead, false);
});

test("生成的 flow 代表帧可直接通过视觉表达最终帧合同", () => {
  const visualIntent = createVisualExpressionIntent({
    question: "三个阶段按什么顺序发生？",
    takeaway: "先准备，再执行，最后验收。",
    role: "explanation",
    objective: "explain",
    informationNeed: "sequence",
    contribution: "show-order",
    contributionRationale: "删掉流程结构后，三个阶段会被误读成没有先后的并列名词。",
    relationKind: "sequence",
    compositionProfile: "text-first",
    claims: [{
      id: "claim-layout",
      text: "三个阶段具有明确顺序",
      visualRequired: true,
      evidenceRefs: []
    }],
    entities: semanticElements(["a", "b", "c"]),
    relations: chainRelations(["a", "b", "c"]),
    evidenceRefs: [],
    mustNotShow: ["装饰元素"]
  });
  const visualPlan = resolveVisualExpressionPlan({ sceneId: "grammar-flow", visualIntent });
  const layout = visualSystemV1GrammarLayout({
    width: 1920,
    height: 1080,
    visualPlan,
    visibleElementIds: ["a", "b", "c"]
  });
  const review = validateVisualExpressionScene({
    id: "grammar-flow",
    visualIntent,
    visualPlan,
    layoutSamples: [layout.layoutSample]
  }, { requireLayoutSamples: true });
  assert.equal(review.valid, true, JSON.stringify(review.issues, null, 2));
});

test("斜向关系遇到无关节点时改走外侧通道，不以直线穿过节点", () => {
  const geometryById = {
    origin: testGeometry(100, 100),
    obstruction: testGeometry(360, 250),
    destination: testGeometry(620, 400)
  };
  const [connector] = visualSystemV1GrammarConnectors({
    structure: "node-link",
    semanticRelations: [{
      id: "diagonal-relation",
      from: "origin",
      to: "destination",
      directed: true
    }],
    geometryById
  });
  assert.ok(connector.route.length > 2, "斜线被遮挡后必须产生绕行折点");
  assertOrthogonalRoute(connector.route);
  assert.equal(routeCrossesRectangle(connector.route, geometryById.obstruction), false);
});

test("无障碍的斜向端点也必须生成全正交路径，不能把 diagonal 直线标成 orthogonal", () => {
  const [connector] = visualSystemV1GrammarConnectors({
    structure: "node-link",
    semanticRelations: [{
      id: "unobstructed-diagonal",
      from: "origin",
      to: "destination",
      directed: true
    }],
    geometryById: {
      origin: testGeometry(100, 100),
      destination: testGeometry(620, 400)
    },
    connectorPolicy: "orthogonal-only"
  });
  assert.equal(connector.presentationKind, "orthogonal");
  assertOrthogonalRoute(connector.route);
});

test("两列卡片向下汇聚时优先使用可见中缝，不沿源卡片边缘制造双边框", () => {
  const geometryById = {
    trigger: testGeometry(288, 342, 576, 132),
    acceptance: testGeometry(896, 342, 576, 132),
    permission: testGeometry(288, 504, 576, 132),
    rollback: testGeometry(896, 504, 576, 132),
    result: testGeometry(560, 666, 640, 132)
  };
  const connectors = visualSystemV1GrammarConnectors({
    structure: "flow",
    semanticRelations: [
      { id: "trigger-result", from: "trigger", to: "result", directed: true },
      { id: "acceptance-result", from: "acceptance", to: "result", directed: true },
      { id: "permission-result", from: "permission", to: "result", directed: true },
      { id: "rollback-result", from: "rollback", to: "result", directed: true }
    ],
    geometryById,
    routeBounds: testGeometry(120, 340, 1520, 460),
    connectorPolicy: "orthogonal-only"
  });
  const triggerResult = connectors.find((connector) => connector.relationId === "trigger-result");
  assert.deepEqual(triggerResult.route, [
    { x: 864, y: 408 },
    { x: 880, y: 408 },
    { x: 880, y: 666 }
  ]);
  assertOrthogonalRoute(triggerResult.route);
  assert.equal(
    routeSegments(triggerResult.route).some(([start, end]) =>
      start.y === end.y &&
      Math.abs(start.y - geometryById.trigger.top) < 10 &&
      Math.min(start.x, end.x) < geometryById.trigger.right
    ),
    false
  );
});

test("显式平滑曲线从相向边缘中点出发，并以目标边框法线方向进入", () => {
  assert.deepEqual(VISUAL_SYSTEM_V1_CONNECTOR_PRESENTATION_KINDS, ["orthogonal", "smooth-curve"]);
  assert.deepEqual(VISUAL_SYSTEM_V1_CONNECTOR_POLICIES, ["allow-smooth", "orthogonal-only"]);
  assert.deepEqual(VISUAL_SYSTEM_V1_CONNECTOR_PORTS, [
    "top-center",
    "right-center",
    "bottom-center",
    "left-center"
  ]);
  const fromGeometry = testGeometry(1077, 405.3, 288, 140.4);
  const toGeometry = testGeometry(537, 594.3, 288, 140.4);
  assert.equal(
    visualSystemV1SmoothConnectorPath({
      fromGeometry,
      toGeometry,
      fromPort: "bottom-center",
      toPort: "top-center"
    }),
    "M 1221 545.7 C 1221 570 681 570 681 594.3"
  );
  assert.equal(
    visualSystemV1SmoothConnectorPath({
      fromGeometry: testGeometry(100, 200),
      toGeometry: testGeometry(500, 360),
      fromPort: "right-center",
      toPort: "left-center"
    }),
    "M 220 240 C 360 240 360 400 500 400"
  );
  assert.throws(
    () => visualSystemV1SmoothConnectorPath({
      fromGeometry,
      toGeometry,
      fromPort: "bottom-center",
      toPort: "left-center"
    }),
    /必须成对相向/u
  );
});

test("连线布局仅对显式关系输出 cubic pathD，其他关系保持正交折线", () => {
  const geometryById = {
    inspect: testGeometry(1077, 405.3, 288, 140.4),
    machine: testGeometry(537, 594.3, 288, 140.4),
    human: testGeometry(980, 594.3, 288, 140.4)
  };
  const connectors = visualSystemV1GrammarConnectors({
    structure: "node-link",
    semanticRelations: [
      { id: "inspect-machine", from: "inspect", to: "machine", directed: true },
      { id: "machine-human", from: "machine", to: "human", directed: true }
    ],
    geometryById,
    connectorPresentationByRelationId: {
      "inspect-machine": {
        kind: "smooth-curve",
        fromPort: "bottom-center",
        toPort: "top-center"
      }
    }
  });
  assert.equal(connectors[0].presentationKind, "smooth-curve");
  assert.equal(connectors[0].pathD, "M 1221 545.7 C 1221 570 681 570 681 594.3");
  assert.equal(connectors[1].presentationKind, "orthogonal");
  assert.equal(connectors[1].pathD, undefined);
  assert.ok(connectors[1].route.length >= 2);
  assertOrthogonalRoute(connectors[1].route);

  assert.throws(
    () => visualSystemV1GrammarConnectors({
      structure: "node-link",
      semanticRelations: [
        { id: "inspect-machine", from: "inspect", to: "machine", directed: true }
      ],
      geometryById,
      connectorPolicy: "orthogonal-only",
      connectorPresentationByRelationId: {
        "inspect-machine": {
          kind: "smooth-curve",
          fromPort: "bottom-center",
          toPort: "top-center"
        }
      }
    }),
    /orthogonal-only.*禁止平滑曲线/u
  );
});

test("通用开放图解图标不进入信息卡，右侧越界时使用独立左侧安全槽", () => {
  assert.deepEqual(VISUAL_SYSTEM_V1_STANDALONE_OVERLAY_SLOT_SIDES, [
    "right",
    "left",
    "top",
    "bottom"
  ]);
  const anchorGeometry = testGeometry(1280, 620, 300, 120);
  const slot = visualSystemV1StandaloneOverlaySlot({
    anchorGeometry,
    overlaySize: { width: 64, height: 64 },
    safeArea: testGeometry(120, 340, 1520, 460),
    geometryById: {
      completion: anchorGeometry,
      prerequisite: testGeometry(1280, 400, 300, 120)
    },
    connectors: [{
      route: [
        { x: 1430, y: 520 },
        { x: 1430, y: 620 }
      ]
    }],
    minimumGapPx: 24
  });
  assert.deepEqual(slot, {
    render: true,
    reason: "safe-slot",
    side: "left",
    bounds: { x: 1192, y: 648, width: 64, height: 64 }
  });
  assert.ok(slot.bounds.x + slot.bounds.width <= anchorGeometry.x - 24);
});

test("独立 overlay 槽同时避让节点和连接线，再选择下一安全方向", () => {
  const anchorGeometry = testGeometry(500, 500, 200, 100);
  const slot = visualSystemV1StandaloneOverlaySlot({
    anchorGeometry,
    overlaySize: { width: 64, height: 64 },
    safeArea: testGeometry(100, 300, 1200, 500),
    geometryById: {
      anchor: anchorGeometry,
      rightBlocker: testGeometry(720, 500, 150, 100)
    },
    connectors: [{
      route: [
        { x: 100, y: 550 },
        { x: 500, y: 550 }
      ]
    }],
    minimumGapPx: 20
  });
  assert.equal(slot.render, true);
  assert.equal(slot.side, "top");
  assert.deepEqual(slot.bounds, { x: 568, y: 416, width: 64, height: 64 });
});

test("四向都没有安全槽时 fail closed，不通过 clamp 强塞进安全区", () => {
  const anchorGeometry = testGeometry(190, 190, 120, 120);
  const slot = visualSystemV1StandaloneOverlaySlot({
    anchorGeometry,
    overlaySize: { width: 80, height: 80 },
    safeArea: testGeometry(100, 100, 300, 300),
    geometryById: { anchor: anchorGeometry },
    connectors: [],
    minimumGapPx: 24
  });
  assert.deepEqual(slot, {
    render: false,
    reason: "no-safe-slot",
    side: null,
    bounds: null
  });
});

test("嵌套关系使用多条同侧外 lane，长短通道互不重叠", () => {
  const geometryById = {
    outerStart: testGeometry(300, 100),
    innerStart: testGeometry(300, 260),
    centerObstruction: testGeometry(300, 350, 120, 60),
    innerEnd: testGeometry(300, 420),
    outerEnd: testGeometry(300, 580),
    sideObstruction: testGeometry(425, 70, 175, 650)
  };
  const connectors = visualSystemV1GrammarConnectors({
    structure: "node-link",
    semanticRelations: [
      { id: "outer-relation", from: "outerStart", to: "outerEnd", directed: true },
      { id: "inner-relation", from: "innerStart", to: "innerEnd", directed: true }
    ],
    geometryById
  });
  const laneX = connectors.map((connector) => routeSegments(connector.route)
    .filter(([start, end]) => Math.abs(start.x - end.x) < 1e-7)
    .sort((left, right) => Math.abs(right[1].y - right[0].y) - Math.abs(left[1].y - left[0].y))[0][0].x);
  assert.ok(laneX.every((x) => x < geometryById.outerStart.x), "两条关系都应使用左侧空白通道");
  assert.notEqual(laneX[0], laneX[1], "嵌套关系不得复用同一条 lane");
  assert.equal(routesConflict(connectors[0].route, connectors[1].route), false);
});

test("交错端点的关系会分配到不同侧，避免端点落在另一条线中段形成 T 形交叉", () => {
  const geometryById = {
    first: testGeometry(300, 100),
    second: testGeometry(300, 240),
    third: testGeometry(300, 380),
    fourth: testGeometry(300, 520)
  };
  const connectors = visualSystemV1GrammarConnectors({
    structure: "node-link",
    semanticRelations: [
      { id: "first-third", from: "first", to: "third", directed: true },
      { id: "second-fourth", from: "second", to: "fourth", directed: true }
    ],
    geometryById
  });
  assert.equal(routesConflict(connectors[0].route, connectors[1].route), false);
  const laneSides = connectors.map((connector) => {
    const lane = routeSegments(connector.route)
      .filter(([start, end]) => Math.abs(start.x - end.x) < 1e-7)
      .sort((left, right) => Math.abs(right[1].y - right[0].y) - Math.abs(left[1].y - left[0].y))[0];
    return lane[0].x < geometryById.first.x ? "left" : "right";
  });
  assert.deepEqual(new Set(laneSides), new Set(["left", "right"]));
});

test("模块只包含抽象视觉语法，不绑定具体业务对象", async () => {
  const source = await readFile(
    new URL("../src/video/components/visual-system-v1/grammar-layout.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /Agent|Skill|Prompt|文件夹|纸张|目录插入/iu);
  assert.throws(
    () => visualSystemV1GrammarLayout({
      width: 1920,
      height: 1080,
      visualPlan: plan("unsupported"),
      visibleElementIds: IDS
    }),
    /不支持的视觉结构/u
  );
});
