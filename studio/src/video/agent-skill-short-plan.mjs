import {
  CUMULATIVE_PATH_EMPHASIS_VERSION,
  PROGRESSIVE_KNOWLEDGE_MOTION_VERSION,
  TECHNICAL_DIAGRAM_ARROWHEAD_REVEAL,
  TECHNICAL_DIAGRAM_TRANSITION_DURATION_SECONDS,
  TECHNICAL_DIAGRAM_TRANSITION_EASING,
  TECHNICAL_DIAGRAM_TRANSITION_VERSION
} from "../shared/technical-diagram-contract.mjs";

export const AGENT_SKILL_SHORT_EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";
export const AGENT_SKILL_SHORT_DURATION_SECONDS = 60;
export const AGENT_SKILL_SHORT_FPS = 30;
export const AGENT_SKILL_SHORT_NODE_ENTRY_OFFSET_PIXELS = 12;
export const AGENT_SKILL_SHORT_NODE_ENTER_FRAMES = 18;
export const AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES = 3;
export const AGENT_SKILL_SHORT_EDGE_DRAW_FRAMES = 11;
export const AGENT_SKILL_SHORT_ARROW_FADE_FRAMES = 4;
export const AGENT_SKILL_SHORT_DIAGRAM_CROSSFADE_FRAMES = 9;
export const AGENT_SKILL_SHORT_S04_HIGHLIGHT_ENTER_FRAMES = 18;
export const AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES = 14;
export const AGENT_SKILL_SHORT_S04_HIGHLIGHT_ARROW_FADE_FRAMES = 4;

export const AGENT_SKILL_SHORT_SCENES = Object.freeze([
  { id: "S01", start: 0, end: 4.782, label: "Skill 定义任务方法" },
  { id: "S02", start: 4.782, end: 8.708, label: "Tool 执行动作" },
  { id: "S03", start: 8.708, end: 17.402, label: "MCP 暴露能力" },
  { id: "S04", start: 17.402, end: 25.443, label: "Skill 编排 MCP" },
  { id: "S05", start: 25.443, end: 36.745, label: "周报流程" },
  { id: "S06", start: 36.745, end: 41.526, label: "Tool 具体执行" },
  { id: "S07", start: 41.526, end: 47.395, label: "MCP 统一连接" },
  { id: "S08", start: 47.395, end: 52.828, label: "只有 Tool" },
  { id: "S09", start: 52.828, end: 60, label: "只有 Skill" }
]);

export const AGENT_SKILL_SHORT_SCENE_WEIGHTS = Object.freeze(
  AGENT_SKILL_SHORT_SCENES.map((scene) => Number((scene.end - scene.start).toFixed(3)))
);

// S04 keeps the complete architecture visible and retraces only the approved
// MCP path. Integer frame offsets make the emphasis deterministic at 30 fps.
export const AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES = Object.freeze([
  Object.freeze({
    id: "skill-rule",
    label: "Skill 规则",
    startFrameOffset: 0,
    nodeIds: Object.freeze(["skill-knowledge"]),
    edgeIds: Object.freeze([])
  }),
  Object.freeze({
    id: "agent-decision",
    label: "Agent 判断",
    startFrameOffset: 36,
    nodeIds: Object.freeze(["agent"]),
    edgeIds: Object.freeze(["skill-guides-agent"])
  }),
  Object.freeze({
    id: "mcp-call",
    label: "MCP 调用",
    startFrameOffset: 72,
    nodeIds: Object.freeze(["mcp-protocol"]),
    edgeIds: Object.freeze(["agent-uses-mcp"])
  }),
  Object.freeze({
    id: "external-capability",
    label: "外部能力",
    startFrameOffset: 114,
    nodeIds: Object.freeze(["external-capability"]),
    edgeIds: Object.freeze(["mcp-connects-capability"])
  })
]);

export const AGENT_SKILL_SHORT_DIAGRAM_BOUNDARIES = Object.freeze([
  Object.freeze({
    id: "architecture-to-weekly-report",
    atSecond: 25.443,
    outgoingDiagramId: "architecture",
    incomingDiagramId: "weeklyReport"
  }),
  Object.freeze({
    id: "flow-to-comparison",
    atSecond: 47.395,
    outgoingDiagramId: "flow",
    incomingDiagramId: "comparison"
  })
]);

// The animation keeps all nine approved shots, while the footer groups them
// into six readable content chapters. Chapter widths still follow real time.
export const AGENT_SKILL_SHORT_CHAPTERS = Object.freeze([
  { id: "skill", start: 0, end: 4.782, label: "Skill" },
  { id: "tool", start: 4.782, end: 8.708, label: "Tool" },
  { id: "mcp", start: 8.708, end: 17.402, label: "MCP" },
  { id: "orchestration", start: 17.402, end: 25.443, label: "编排" },
  { id: "weekly-report", start: 25.443, end: 47.395, label: "周报协作" },
  { id: "capability-boundary", start: 47.395, end: 60, label: "能力边界" }
]);

export const AGENT_SKILL_SHORT_CHAPTER_WEIGHTS = Object.freeze(
  AGENT_SKILL_SHORT_CHAPTERS.map((chapter) =>
    Number((chapter.end - chapter.start).toFixed(3))
  )
);

function diagramSpec({
  id,
  kind,
  start,
  end,
  sceneIds,
  nodes,
  edges,
  phases
}) {
  return Object.freeze({
    id,
    kind,
    start,
    end,
    durationSeconds: Number((end - start).toFixed(3)),
    sceneIds: Object.freeze([...sceneIds]),
    nodes: Object.freeze(nodes.map((node) => Object.freeze({ ...node }))),
    edges: Object.freeze(edges.map((edge) => Object.freeze({ ...edge }))),
    phases: Object.freeze(phases.map((phase) => Object.freeze({
      ...phase,
      revealNodeIds: Object.freeze([...phase.revealNodeIds]),
      activateEdgeIds: Object.freeze([...phase.activateEdgeIds])
    })))
  });
}

export const AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS = Object.freeze({
  architecture: diagramSpec({
    id: "skill-tool-mcp-layers",
    kind: "technical-architecture",
    start: 0,
    end: 25.443,
    sceneIds: ["S01", "S02", "S03", "S04"],
    nodes: [
      { id: "skill-knowledge", label: "Skill / 过程知识", role: "method-guidance", detail: "顺序、判断与验收标准", x: 165, y: 8, width: 150, height: 72, accent: "mint" },
      { id: "agent", label: "Agent / 判断与编排", role: "orchestrator", detail: "选择路径并检查条件", x: 165, y: 122, width: 150, height: 72, accent: "orange" },
      { id: "tool-action", label: "Tool / 执行动作", role: "executable-action", detail: "数据库查询、文档写入", x: 40, y: 270, width: 150, height: 76, accent: "blue" },
      { id: "mcp-protocol", label: "MCP / 连接协议", role: "capability-protocol", detail: "统一发现和调用能力", x: 290, y: 270, width: 150, height: 76, accent: "purple" },
      { id: "external-capability", label: "外部能力", role: "external-capability", detail: "由 MCP 建立连接", x: 290, y: 430, width: 150, height: 76, accent: "mint" }
    ],
    edges: [
      { id: "skill-guides-agent", from: "skill-knowledge", to: "agent", relation: "guides", path: "M240 80 L240 122" },
      { id: "agent-invokes-tool", from: "agent", to: "tool-action", relation: "invokes", path: "M240 194 L240 232 L115 232 L115 270" },
      { id: "agent-uses-mcp", from: "agent", to: "mcp-protocol", relation: "discovers-and-calls", path: "M240 194 L240 232 L365 232 L365 270" },
      { id: "mcp-connects-capability", from: "mcp-protocol", to: "external-capability", relation: "connects", path: "M365 346 L365 430" }
    ],
    phases: [
      { id: "reveal-skill", kind: "reveal", startSecond: 0, endSecond: 2.2, learningObjective: "先建立 Skill 的过程知识", revealNodeIds: ["skill-knowledge"], activateEdgeIds: [] },
      { id: "reveal-agent", kind: "reveal", startSecond: 2.2, endSecond: 4.782, learningObjective: "再展示 Skill 如何指导 Agent", revealNodeIds: ["agent"], activateEdgeIds: ["skill-guides-agent"] },
      { id: "reveal-tool", kind: "reveal", startSecond: 4.782, endSecond: 8.708, learningObjective: "展示 Agent 调用 Tool 执行动作", revealNodeIds: ["tool-action"], activateEdgeIds: ["agent-invokes-tool"] },
      { id: "reveal-mcp", kind: "reveal", startSecond: 8.708, endSecond: 13, learningObjective: "展示 Agent 通过 MCP 发现能力", revealNodeIds: ["mcp-protocol"], activateEdgeIds: ["agent-uses-mcp"] },
      { id: "reveal-external", kind: "reveal", startSecond: 13, endSecond: 17.402, learningObjective: "由 MCP 连接到外部能力", revealNodeIds: ["external-capability"], activateEdgeIds: ["mcp-connects-capability"] },
      { id: "hold-architecture", kind: "hold", startSecond: 17.402, endSecond: 25.443, learningObjective: "停留完整架构并按旁白高亮职责", revealNodeIds: [], activateEdgeIds: [] }
    ]
  }),
  weeklyReport: diagramSpec({
    id: "weekly-report-process",
    kind: "technical-flow",
    start: 25.443,
    end: 36.745,
    sceneIds: ["S05"],
    nodes: [
      { id: "metric-definition", label: "核对指标定义", role: "definition-check", detail: "先确认统计口径", x: 55, y: 45, width: 370, height: 88, accent: "mint" },
      { id: "anomaly-check", label: "检查异常", role: "anomaly-check", detail: "识别波动与缺口", x: 55, y: 240, width: 370, height: 88, accent: "blue" },
      { id: "structured-conclusion", label: "固定结构写结论", role: "structured-output", detail: "形成可验收周报", x: 55, y: 435, width: 370, height: 88, accent: "orange" }
    ],
    edges: [
      { id: "definition-then-anomaly", from: "metric-definition", to: "anomaly-check", relation: "then", path: "M240 133 L240 240" },
      { id: "anomaly-then-conclusion", from: "anomaly-check", to: "structured-conclusion", relation: "then", path: "M240 328 L240 435" }
    ],
    phases: [
      { id: "reveal-definition", kind: "reveal", startSecond: 0, endSecond: 2.6, learningObjective: "先核对指标定义", revealNodeIds: ["metric-definition"], activateEdgeIds: [] },
      { id: "reveal-anomaly", kind: "reveal", startSecond: 2.6, endSecond: 5.7, learningObjective: "再检查异常", revealNodeIds: ["anomaly-check"], activateEdgeIds: ["definition-then-anomaly"] },
      { id: "reveal-conclusion", kind: "reveal", startSecond: 5.7, endSecond: 8.8, learningObjective: "最后按固定结构写结论", revealNodeIds: ["structured-conclusion"], activateEdgeIds: ["anomaly-then-conclusion"] },
      { id: "hold-weekly-report", kind: "hold", startSecond: 8.8, endSecond: 11.302, learningObjective: "停留完整周报流程", revealNodeIds: [], activateEdgeIds: [] }
    ]
  }),
  flow: diagramSpec({
    id: "tool-and-mcp-actions",
    kind: "technical-flow",
    start: 36.745,
    end: 47.395,
    sceneIds: ["S06", "S07"],
    nodes: [
      { id: "agent-request", label: "Agent 请求", role: "request-source", detail: "明确任务与约束", x: 165, y: 4, width: 150, height: 68, accent: "orange" },
      { id: "database-query", label: "数据库查询", role: "local-tool-query", detail: "Tool 执行", x: 18, y: 145, width: 150, height: 72, accent: "blue" },
      { id: "document-write", label: "文档写入", role: "local-tool-write", detail: "Tool 执行", x: 312, y: 145, width: 150, height: 72, accent: "blue" },
      { id: "mcp-protocol", label: "MCP 协议", role: "protocol-bridge", detail: "发现与调用", x: 165, y: 282, width: 150, height: 72, accent: "purple" },
      { id: "external-capability", label: "外部能力", role: "remote-execution", detail: "通过协议连接", x: 165, y: 420, width: 150, height: 72, accent: "mint" },
      { id: "result", label: "结构化结果", role: "result-return", detail: "返回 Agent 验收", x: 165, y: 558, width: 150, height: 72, accent: "orange" }
    ],
    edges: [
      { id: "request-to-database", from: "agent-request", to: "database-query", relation: "invokes", path: "M215 72 L215 105 L93 105 L93 145" },
      { id: "request-to-document", from: "agent-request", to: "document-write", relation: "invokes", path: "M265 72 L265 105 L387 105 L387 145" },
      { id: "request-to-mcp", from: "agent-request", to: "mcp-protocol", relation: "discovers-and-calls", path: "M240 72 L240 282" },
      { id: "mcp-to-external", from: "mcp-protocol", to: "external-capability", relation: "connects", path: "M240 354 L240 420" },
      { id: "external-to-result", from: "external-capability", to: "result", relation: "returns", path: "M240 492 L240 558" },
      { id: "result-to-agent", from: "result", to: "agent-request", relation: "returns", path: "M315 594 L468 594 L468 38 L315 38" }
    ],
    phases: [
      { id: "establish-agent-request", kind: "reveal", startSecond: 0, endSecond: 1.2, learningObjective: "先建立 Agent 请求起点", revealNodeIds: ["agent-request"], activateEdgeIds: [] },
      { id: "query-database", kind: "reveal", startSecond: 1.2, endSecond: 3, learningObjective: "再展示数据库查询 Tool", revealNodeIds: ["database-query"], activateEdgeIds: ["request-to-database"] },
      { id: "write-document", kind: "reveal", startSecond: 3, endSecond: 4.8, learningObjective: "数据库查询之后展示文档写入 Tool", revealNodeIds: ["document-write"], activateEdgeIds: ["request-to-document"] },
      { id: "discover-mcp", kind: "reveal", startSecond: 4.8, endSecond: 6.6, learningObjective: "随后建立 MCP 发现与调用连接", revealNodeIds: ["mcp-protocol"], activateEdgeIds: ["request-to-mcp"] },
      { id: "connect-external", kind: "reveal", startSecond: 6.6, endSecond: 8.2, learningObjective: "由 MCP 连接到外部能力", revealNodeIds: ["external-capability"], activateEdgeIds: ["mcp-to-external"] },
      { id: "return-result", kind: "reveal", startSecond: 8.2, endSecond: 9.6, learningObjective: "最后返回结构化结果并闭环", revealNodeIds: ["result"], activateEdgeIds: ["external-to-result", "result-to-agent"] },
      { id: "hold-complete-flow", kind: "hold", startSecond: 9.6, endSecond: 10.65, learningObjective: "停留完整流程图供观众复盘", revealNodeIds: [], activateEdgeIds: [] }
    ]
  }),
  comparison: diagramSpec({
    id: "capability-boundary-contrast",
    kind: "technical-comparison",
    start: 47.395,
    end: 60,
    sceneIds: ["S08", "S09"],
    nodes: [
      { id: "tool-only", label: "只有 Tool", role: "comparison-case", detail: "能执行动作", x: 18, y: 24, width: 205, height: 72, accent: "blue" },
      { id: "tool-action", label: "可执行动作", role: "available-capability", detail: "数据库、文档等", x: 18, y: 190, width: 205, height: 76, accent: "blue" },
      { id: "missing-method", label: "缺少方法与验收", role: "missing-capability", detail: "不知道何时与怎样做", x: 18, y: 356, width: 205, height: 82, accent: "orange", dashed: true },
      { id: "skill-only", label: "只有 Skill", role: "comparison-case", detail: "有方法与顺序", x: 257, y: 24, width: 205, height: 72, accent: "mint" },
      { id: "skill-method", label: "方法与顺序", role: "available-capability", detail: "知道怎么判断", x: 257, y: 190, width: 205, height: 76, accent: "mint" },
      { id: "missing-execution", label: "缺少执行通道", role: "missing-capability", detail: "无法真正完成动作", x: 257, y: 356, width: 205, height: 82, accent: "orange", dashed: true }
    ],
    edges: [
      { id: "tool-case-action", from: "tool-only", to: "tool-action", relation: "has", path: "M120 96 L120 190" },
      { id: "tool-case-gap", from: "tool-action", to: "missing-method", relation: "lacks", path: "M120 266 L120 356" },
      { id: "skill-case-method", from: "skill-only", to: "skill-method", relation: "has", path: "M360 96 L360 190" },
      { id: "skill-case-gap", from: "skill-method", to: "missing-execution", relation: "lacks", path: "M360 266 L360 356" }
    ],
    phases: [
      { id: "reveal-tool-case", kind: "reveal", startSecond: 0, endSecond: 1.5, learningObjective: "建立只有 Tool 的案例", revealNodeIds: ["tool-only"], activateEdgeIds: [] },
      { id: "reveal-tool-action", kind: "reveal", startSecond: 1.5, endSecond: 3.2, learningObjective: "展示 Tool 拥有执行动作", revealNodeIds: ["tool-action"], activateEdgeIds: ["tool-case-action"] },
      { id: "reveal-tool-gap", kind: "reveal", startSecond: 3.2, endSecond: 5.433, learningObjective: "指出 Tool 缺少方法与验收", revealNodeIds: ["missing-method"], activateEdgeIds: ["tool-case-gap"] },
      { id: "reveal-skill-case", kind: "reveal", startSecond: 5.433, endSecond: 6.8, learningObjective: "建立只有 Skill 的案例", revealNodeIds: ["skill-only"], activateEdgeIds: [] },
      { id: "reveal-skill-method", kind: "reveal", startSecond: 6.8, endSecond: 8.6, learningObjective: "展示 Skill 拥有方法与顺序", revealNodeIds: ["skill-method"], activateEdgeIds: ["skill-case-method"] },
      { id: "reveal-skill-gap", kind: "reveal", startSecond: 8.6, endSecond: 10.4, learningObjective: "指出 Skill 缺少执行通道", revealNodeIds: ["missing-execution"], activateEdgeIds: ["skill-case-gap"] },
      { id: "hold-comparison", kind: "hold", startSecond: 10.4, endSecond: 12.605, learningObjective: "停留双列能力边界", revealNodeIds: [], activateEdgeIds: [] }
    ]
  })
});

function rounded(value) {
  return Number(value.toFixed(3));
}

function buildS04CumulativePathEmphasisPolicy() {
  const s04 = AGENT_SKILL_SHORT_SCENES.find((scene) => scene.id === "S04");
  const boundary = AGENT_SKILL_SHORT_DIAGRAM_BOUNDARIES.find(
    (item) => item.outgoingDiagramId === "architecture"
  );
  const sceneStartFrame = Math.ceil(s04.start * AGENT_SKILL_SHORT_FPS - 1e-7);
  const sceneEndFrameExclusive = Math.ceil(s04.end * AGENT_SKILL_SHORT_FPS - 1e-7);
  const lastStage = AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES.at(-1);
  const holdStartFrameOffset = lastStage.startFrameOffset + Math.max(
    AGENT_SKILL_SHORT_S04_HIGHLIGHT_ENTER_FRAMES,
    AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES +
      AGENT_SKILL_SHORT_S04_HIGHLIGHT_ARROW_FADE_FRAMES
  );
  return {
    schemaVersion: CUMULATIVE_PATH_EMPHASIS_VERSION,
    sceneId: s04.id,
    mode: "cumulative-path-highlight",
    fps: AGENT_SKILL_SHORT_FPS,
    sceneStartFrame,
    sceneEndFrameExclusive,
    retainHighlightedElements: true,
    neutralElements: {
      treatment: "base-style-throughout",
      nodeIds: ["tool-action"],
      edgeIds: ["agent-invokes-tool"]
    },
    transition: {
      nodeEnterFrames: AGENT_SKILL_SHORT_S04_HIGHLIGHT_ENTER_FRAMES,
      edgeDrawFrames: AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES,
      arrowheadFadeFrames: AGENT_SKILL_SHORT_S04_HIGHLIGHT_ARROW_FADE_FRAMES,
      easing: TECHNICAL_DIAGRAM_TRANSITION_EASING,
      bounce: false
    },
    stages: AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES.map((stage, index) => ({
      id: stage.id,
      order: index + 1,
      label: stage.label,
      startFrameOffset: stage.startFrameOffset,
      highlightNodeIds: [...stage.nodeIds],
      highlightEdgeIds: [...stage.edgeIds]
    })),
    endBehavior: {
      mode: "hold-then-crossfade",
      holdStartFrameOffset,
      crossfadeStartFrameOffset: sceneEndFrameExclusive - sceneStartFrame,
      crossfadeDurationFrames: AGENT_SKILL_SHORT_DIAGRAM_CROSSFADE_FRAMES,
      outgoingDiagramId: boundary.outgoingDiagramId,
      incomingDiagramId: boundary.incomingDiagramId,
      retainHighlightThroughCrossfade: true,
      easing: TECHNICAL_DIAGRAM_TRANSITION_EASING,
      bounce: false
    }
  };
}

export function buildAgentSkillShortDiagramMotionPolicy(diagramId, durationSeconds = null) {
  const diagram = AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS[diagramId];
  if (!diagram) throw new Error(`未知技术图：${diagramId}`);
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : diagram.durationSeconds;
  const scale = duration / diagram.durationSeconds;
  return {
    schemaVersion: PROGRESSIVE_KNOWLEDGE_MOTION_VERSION,
    mode: "progressive-knowledge-derivation",
    durationSeconds: rounded(duration),
    initialVisibleNodeIds: [],
    retainRevealedElements: true,
    allowCompleteDiagramAtStart: false,
    maxNewNodesPerPhase: 1,
    transition: {
      schemaVersion: TECHNICAL_DIAGRAM_TRANSITION_VERSION,
      durationSeconds: TECHNICAL_DIAGRAM_TRANSITION_DURATION_SECONDS,
      easing: TECHNICAL_DIAGRAM_TRANSITION_EASING,
      bounce: false,
      arrowheadReveal: TECHNICAL_DIAGRAM_ARROWHEAD_REVEAL
    },
    emphasisPolicy: diagramId === "architecture"
      ? buildS04CumulativePathEmphasisPolicy()
      : null,
    phases: diagram.phases.map((phase, index) => ({
      id: phase.id,
      order: index + 1,
      kind: phase.kind,
      startSecond: rounded(phase.startSecond * scale),
      endSecond: index === diagram.phases.length - 1
        ? rounded(duration)
        : rounded(phase.endSecond * scale),
      learningObjective: phase.learningObjective,
      revealNodeIds: [...phase.revealNodeIds],
      activateEdgeIds: [...phase.activateEdgeIds]
    }))
  };
}

function smoothStep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function diagramIdForSceneId(sceneId) {
  if (["S01", "S02", "S03", "S04"].includes(sceneId)) return "architecture";
  if (sceneId === "S05") return "weeklyReport";
  if (["S06", "S07"].includes(sceneId)) return "flow";
  return "comparison";
}

export function agentSkillShortDiagramLayersAt(currentSecond) {
  const safeSecond = Number.isFinite(Number(currentSecond))
    ? Math.max(0, Number(currentSecond))
    : 0;
  const currentFrame = Math.floor(safeSecond * AGENT_SKILL_SHORT_FPS + 1e-7);
  const boundary = AGENT_SKILL_SHORT_DIAGRAM_BOUNDARIES.find((item) => {
    const boundaryFrame = Math.ceil(item.atSecond * AGENT_SKILL_SHORT_FPS - 1e-7);
    return currentFrame >= boundaryFrame &&
      currentFrame <= boundaryFrame + AGENT_SKILL_SHORT_DIAGRAM_CROSSFADE_FRAMES;
  });
  if (!boundary) {
    return [{
      diagramId: diagramIdForSceneId(agentSkillShortSceneAt(safeSecond).id),
      opacity: 1
    }];
  }
  const boundaryFrame = Math.ceil(boundary.atSecond * AGENT_SKILL_SHORT_FPS - 1e-7);
  const progress = smoothStep(
    (currentFrame - boundaryFrame) / AGENT_SKILL_SHORT_DIAGRAM_CROSSFADE_FRAMES
  );
  return [
    { diagramId: boundary.outgoingDiagramId, opacity: 1 - progress },
    { diagramId: boundary.incomingDiagramId, opacity: progress }
  ];
}

function emptyDiagramHighlightState(diagram) {
  return {
    nodeHighlightProgress: Object.fromEntries(
      diagram.nodes.map((node) => [node.id, 0])
    ),
    edgeHighlightProgress: Object.fromEntries(
      diagram.edges.map((edge) => [edge.id, 0])
    ),
    edgeHighlightArrowProgress: Object.fromEntries(
      diagram.edges.map((edge) => [edge.id, 0])
    )
  };
}

export function agentSkillShortS04HighlightStateAt(currentSecond) {
  const diagram = AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS.architecture;
  const s04 = AGENT_SKILL_SHORT_SCENES.find((scene) => scene.id === "S04");
  const safeSecond = Number.isFinite(Number(currentSecond))
    ? Math.max(0, Number(currentSecond))
    : 0;
  const currentFrame = Math.floor(safeSecond * AGENT_SKILL_SHORT_FPS + 1e-7);
  const s04StartFrame = Math.ceil(s04.start * AGENT_SKILL_SHORT_FPS - 1e-7);
  const highlight = emptyDiagramHighlightState(diagram);
  let currentStageId = null;

  for (const stage of AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES) {
    const stageStartFrame = s04StartFrame + stage.startFrameOffset;
    const elapsedFrames = currentFrame - stageStartFrame;
    if (elapsedFrames >= 0) currentStageId = stage.id;
    const nodeProgress = smoothStep(
      elapsedFrames / AGENT_SKILL_SHORT_S04_HIGHLIGHT_ENTER_FRAMES
    );
    const edgeProgress = smoothStep(
      elapsedFrames / AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES
    );
    const edgeArrowProgress = smoothStep(
      (
        elapsedFrames - AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES
      ) / AGENT_SKILL_SHORT_S04_HIGHLIGHT_ARROW_FADE_FRAMES
    );
    for (const nodeId of stage.nodeIds) {
      highlight.nodeHighlightProgress[nodeId] = nodeProgress;
    }
    for (const edgeId of stage.edgeIds) {
      highlight.edgeHighlightProgress[edgeId] = edgeProgress;
      highlight.edgeHighlightArrowProgress[edgeId] = edgeArrowProgress;
    }
  }

  const lastStage = AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES.at(-1);
  const lastStageEndFrame = s04StartFrame + lastStage.startFrameOffset + Math.max(
    AGENT_SKILL_SHORT_S04_HIGHLIGHT_ENTER_FRAMES,
    AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES +
      AGENT_SKILL_SHORT_S04_HIGHLIGHT_ARROW_FADE_FRAMES
  );
  return {
    currentFrame,
    s04StartFrame,
    currentStageId,
    isActive: safeSecond >= s04.start && safeSecond < s04.end,
    ...highlight,
    complete: currentFrame >= lastStageEndFrame
  };
}

export function agentSkillShortDiagramStateAt(diagramId, currentSecond) {
  const diagram = AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS[diagramId];
  if (!diagram) throw new Error(`未知技术图：${diagramId}`);
  const safeSecond = Number.isFinite(Number(currentSecond))
    ? Math.max(0, Number(currentSecond))
    : 0;
  const currentFrame = Math.floor(safeSecond * AGENT_SKILL_SHORT_FPS + 1e-7);
  const elapsedSecond = Math.max(
    0,
    Math.min(diagram.durationSeconds, safeSecond - diagram.start)
  );
  const policy = buildAgentSkillShortDiagramMotionPolicy(diagramId);
  const nodeProgress = Object.fromEntries(diagram.nodes.map((node) => [node.id, 0]));
  const edgeProgress = Object.fromEntries(diagram.edges.map((edge) => [edge.id, 0]));
  const edgeArrowProgress = Object.fromEntries(diagram.edges.map((edge) => [edge.id, 0]));
  let currentPhaseId = policy.phases[0]?.id ?? null;
  for (const phase of policy.phases) {
    if (elapsedSecond >= phase.startSecond) currentPhaseId = phase.id;
    if (phase.kind === "hold") continue;
    const phaseStartFrame = Math.ceil(
      (diagram.start + phase.startSecond) * AGENT_SKILL_SHORT_FPS - 1e-7
    );
    const elapsedFrames = currentFrame - phaseStartFrame;
    const nodeRevealProgress = smoothStep(
      elapsedFrames / AGENT_SKILL_SHORT_NODE_ENTER_FRAMES
    );
    const lineRevealProgress = smoothStep(
      (elapsedFrames - AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES) /
        AGENT_SKILL_SHORT_EDGE_DRAW_FRAMES
    );
    const arrowRevealProgress = smoothStep(
      (
        elapsedFrames -
        AGENT_SKILL_SHORT_EDGE_DELAY_FRAMES -
        AGENT_SKILL_SHORT_EDGE_DRAW_FRAMES
      ) / AGENT_SKILL_SHORT_ARROW_FADE_FRAMES
    );
    for (const nodeId of phase.revealNodeIds) nodeProgress[nodeId] = nodeRevealProgress;
    for (const edgeId of phase.activateEdgeIds) {
      edgeProgress[edgeId] = lineRevealProgress;
      edgeArrowProgress[edgeId] = arrowRevealProgress;
    }
  }
  const highlight = diagramId === "architecture"
    ? agentSkillShortS04HighlightStateAt(safeSecond)
    : {
        currentStageId: null,
        isActive: false,
        complete: false,
        ...emptyDiagramHighlightState(diagram)
      };
  return {
    diagramId,
    currentFrame,
    elapsedSecond: rounded(elapsedSecond),
    currentPhaseId,
    nodeProgress,
    edgeProgress,
    edgeArrowProgress,
    highlightStageId: highlight.currentStageId,
    highlightActive: highlight.isActive,
    highlightComplete: highlight.complete,
    nodeHighlightProgress: highlight.nodeHighlightProgress,
    edgeHighlightProgress: highlight.edgeHighlightProgress,
    edgeHighlightArrowProgress: highlight.edgeHighlightArrowProgress,
    complete: elapsedSecond >= policy.phases.at(-1).startSecond
  };
}

export function agentSkillShortSceneAt(second) {
  const value = Number.isFinite(second) ? Math.max(0, second) : 0;
  return AGENT_SKILL_SHORT_SCENES.find(
    (scene) => value >= scene.start && value < scene.end
  ) ?? AGENT_SKILL_SHORT_SCENES.at(-1);
}

export function agentSkillShortProgressPixelsAt(second, width = 540) {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeSecond = Number.isFinite(second)
    ? Math.max(0, Math.min(AGENT_SKILL_SHORT_DURATION_SECONDS, second))
    : 0;
  return (safeSecond / AGENT_SKILL_SHORT_DURATION_SECONDS) * safeWidth;
}
