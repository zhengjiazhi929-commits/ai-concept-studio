import { visualSystemV1Layout } from "./components/visual-system-v1/layout.mjs";
import { VISUAL_SYSTEM_V1_AI_WATERMARK } from "./components/visual-system-v1/ai-watermark.mjs";
import { VISUAL_SYSTEM_V1 } from "./components/visual-system-v1/tokens.mjs";

export const VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF = Object.freeze({
  schemaVersion: "visual-system-v1-skill-agent-mcp-proof-v5",
  fps: VISUAL_SYSTEM_V1.fps,
  durationSeconds: 12,
  durationInFrames: 360,
  compositions: Object.freeze({
    wide: Object.freeze({
      id: "VisualSystemV1SkillAgentMcpFlatV5AiWatermarkWide",
      ...VISUAL_SYSTEM_V1.formats.wide
    })
  }),
  scenes: Object.freeze([
    Object.freeze({ id: "boundary", startFrame: -7, endFrame: 72, textStartFrame: 8 }),
    Object.freeze({ id: "execution", startFrame: 64, endFrame: 192, textStartFrame: 64 }),
    Object.freeze({ id: "review", startFrame: 184, endFrame: 367, textStartFrame: 184 })
  ]),
  chapters: Object.freeze([
    Object.freeze({ id: "boundary", label: "规则边界 · 2.4s", startFrame: 0, endFrame: 72 }),
    Object.freeze({ id: "execution", label: "受控执行 · 4.0s", startFrame: 72, endFrame: 192 }),
    Object.freeze({ id: "review", label: "人工确认 · 5.6s", startFrame: 192, endFrame: 360 })
  ]),
  surfacePolicy: Object.freeze({
    defaultMode: "flat-only",
    sameLevelSurfaceUniform: true,
    outputFormat: "wide-only",
    contentFrameMode: "open-canvas",
    topHeaderRuntimeCount: 0,
    largeContentWindowRuntimeCount: 0,
    runtimeShallowDepthCount: 0,
    shallowDepthCapabilityRetained: true
  }),
  watermark: Object.freeze({
    enabled: true,
    role: VISUAL_SYSTEM_V1_AI_WATERMARK.role,
    component: "six-face-extruded-ai",
    placement: VISUAL_SYSTEM_V1_AI_WATERMARK.placement,
    motion: VISUAL_SYSTEM_V1_AI_WATERMARK.motion,
    motionSchemaVersion: VISUAL_SYSTEM_V1_AI_WATERMARK.motionSchemaVersion,
    renderMode: VISUAL_SYSTEM_V1_AI_WATERMARK.renderMode,
    rasterSequence: VISUAL_SYSTEM_V1_AI_WATERMARK.rasterSequence,
    contentSurfacePolicyExempt: true,
    completeCycles: 3
  }),
  timeline: Object.freeze({
    skillEnterFrame: 20,
    skillToAgentFrame: 40,
    agentEnterFrame: 44,
    agentToMcpFrame: 72,
    mcpEnterFrame: 76,
    mcpToResultFrame: 104,
    resultEnterFrame: 108,
    resultToHumanFrame: 212,
    humanEnterFrame: 216
  }),
  componentInventory: Object.freeze({
    flatWorkflow: Object.freeze([
      "skill-node",
      "agent-node",
      "mcp-node",
      "result-node",
      "human-confirmation-node"
    ]),
    shallowDepthRuntime: Object.freeze([]),
    shallowDepthAvailable: Object.freeze([
      "active-node",
      "key-result",
      "human-confirmation"
    ])
  })
});

export const VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS =
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.chapters;

export const VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CAPTIONS = Object.freeze([
  Object.freeze({
    text: "Skill 先规定边界，Agent 再判断下一步。",
    startMs: 0,
    endMs: 2400,
    timestampMs: null,
    confidence: null
  }),
  Object.freeze({
    text: "Agent 通过 MCP 调用外部能力，并保留过程证据。",
    startMs: 2400,
    endMs: 6400,
    timestampMs: null,
    confidence: null
  }),
  Object.freeze({
    text: "结果返回后，仍由人工确认是否采用。",
    startMs: 6400,
    endMs: 12000,
    timestampMs: null,
    confidence: null
  })
]);

export function visualSystemV1SkillAgentMcpProofLayout(width, height) {
  const base = visualSystemV1Layout(width, height);
  if (base.vertical) {
    throw new Error("visual-system-v1 v4 默认只生成 1920x1080 横版");
  }
  return Object.freeze({
    ...base,
    bodyWidth: width,
    bodyHeight: height,
    copy: Object.freeze({ left: 120, top: 136, width: 1640, supportTop: 270 }),
    nodes: Object.freeze({
      skill: Object.freeze({ left: 90, top: 456, width: 286, height: 166 }),
      agent: Object.freeze({ left: 454, top: 456, width: 286, height: 166 }),
      mcp: Object.freeze({ left: 818, top: 456, width: 286, height: 166 }),
      result: Object.freeze({ left: 1182, top: 456, width: 300, height: 166 }),
      human: Object.freeze({ left: 1560, top: 456, width: 270, height: 166 })
    }),
    connectors: Object.freeze([
      Object.freeze({ from: { x: 376, y: 539 }, to: { x: 454, y: 539 }, orientation: "horizontal" }),
      Object.freeze({ from: { x: 740, y: 539 }, to: { x: 818, y: 539 }, orientation: "horizontal" }),
      Object.freeze({ from: { x: 1104, y: 539 }, to: { x: 1182, y: 539 }, orientation: "horizontal" }),
      Object.freeze({ from: { x: 1482, y: 539 }, to: { x: 1560, y: 539 }, orientation: "horizontal" })
    ])
  });
}
