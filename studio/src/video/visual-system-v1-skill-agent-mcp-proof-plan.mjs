import {
  visualSystemV1AdaptiveCardTypography,
  visualSystemV1AdaptiveCardLayout,
  visualSystemV1HorizontalCardConnectors,
  visualSystemV1InterpolateCardDeck,
  visualSystemV1Layout
} from "./components/visual-system-v1/layout.mjs";
import { VISUAL_SYSTEM_V1_AI_WATERMARK } from "./components/visual-system-v1/ai-watermark.mjs";
import { visualSystemV1ProgressAtFrame } from "./components/visual-system-v1/motion.mjs";
import { VISUAL_SYSTEM_V1 } from "./components/visual-system-v1/tokens.mjs";

export const VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF = Object.freeze({
  schemaVersion: "visual-system-v1-skill-agent-mcp-proof-v9",
  fps: VISUAL_SYSTEM_V1.fps,
  durationSeconds: 12,
  durationInFrames: 360,
  compositions: Object.freeze({
    wide: Object.freeze({
      id: "VisualSystemV1SkillAgentMcpFlatV9AiWatermarkWide",
      ...VISUAL_SYSTEM_V1.formats.wide
    })
  }),
  scenes: Object.freeze([
    Object.freeze({ id: "boundary", startFrame: -7, endFrame: 72, textStartFrame: 8 }),
    Object.freeze({ id: "execution", startFrame: 64, endFrame: 192, textStartFrame: 64 }),
    Object.freeze({ id: "review", startFrame: 184, endFrame: 367, textStartFrame: 184 })
  ]),
  chapters: Object.freeze([
    Object.freeze({ id: "boundary", label: "规则边界", startFrame: 0, endFrame: 72 }),
    Object.freeze({ id: "execution", label: "受控执行", startFrame: 72, endFrame: 192 }),
    Object.freeze({ id: "review", label: "人工确认", startFrame: 192, endFrame: 360 })
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
  sceneAdaptiveComposition: Object.freeze({
    enabled: true,
    mode: "visible-node-count",
    cardCounts: Object.freeze([1, 2, 3, 4, 5]),
    reflowFrames: VISUAL_SYSTEM_V1.motion.cardReflowFrames,
    focusFrames: VISUAL_SYSTEM_V1.motion.cardFocusFrames,
    sameLevelEqualSize: true,
    surfaceMode: "flat-only"
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
    skillToAgentFrame: 44,
    agentEnterFrame: 44,
    agentToMcpFrame: 76,
    mcpEnterFrame: 76,
    mcpToResultFrame: 108,
    resultEnterFrame: 108,
    resultToHumanFrame: 216,
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

const WORKFLOW_NODE_IDS = Object.freeze(["skill", "agent", "mcp", "result", "human"]);

export const VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES = Object.freeze([
  Object.freeze({
    nodeId: "skill",
    itemCount: 1,
    reflowStartFrame: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline.skillEnterFrame,
    nodeEnterFrame: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline.skillEnterFrame
  }),
  Object.freeze({
    nodeId: "agent",
    itemCount: 2,
    reflowStartFrame:
      VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline.agentEnterFrame -
      VISUAL_SYSTEM_V1.motion.cardReflowFrames,
    nodeEnterFrame: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline.agentEnterFrame
  }),
  Object.freeze({
    nodeId: "mcp",
    itemCount: 3,
    reflowStartFrame:
      VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline.mcpEnterFrame -
      VISUAL_SYSTEM_V1.motion.cardReflowFrames,
    nodeEnterFrame: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline.mcpEnterFrame
  }),
  Object.freeze({
    nodeId: "result",
    itemCount: 4,
    reflowStartFrame:
      VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline.resultEnterFrame -
      VISUAL_SYSTEM_V1.motion.cardReflowFrames,
    nodeEnterFrame: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline.resultEnterFrame
  }),
  Object.freeze({
    nodeId: "human",
    itemCount: 5,
    reflowStartFrame:
      VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline.humanEnterFrame -
      VISUAL_SYSTEM_V1.motion.cardReflowFrames,
    nodeEnterFrame: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.timeline.humanEnterFrame
  })
]);

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
    throw new Error("visual-system-v1 v9 默认只生成 1920x1080 横版");
  }
  const copy = Object.freeze({ left: 120, top: 136, width: 1640, supportTop: 270 });
  const copyBottomPx = copy.supportTop + VISUAL_SYSTEM_V1.typography.supportingWidePx * 1.42;
  const subtitleTopPx = height - 92 -
    VISUAL_SYSTEM_V1.typography.subtitleWidePx *
    VISUAL_SYSTEM_V1.typography.subtitleLineHeight *
    VISUAL_SYSTEM_V1.typography.subtitleMaximumLines;
  const cardConstraints = Object.freeze({
    copyBottomPx,
    subtitleTopPx,
    minimumCardWidthPx: VISUAL_SYSTEM_V1.cardDeck.minimumCardWidthPx,
    minimumCardHeightPx: VISUAL_SYSTEM_V1.cardDeck.minimumCardHeightPx
  });
  const cardDecksByCount = Object.freeze(Object.fromEntries(
    VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.sceneAdaptiveComposition.cardCounts.map(
      (itemCount) => [
        itemCount,
        visualSystemV1AdaptiveCardLayout(width, height, itemCount, cardConstraints)
      ]
    )
  ));
  const cardTypographyByCount = Object.freeze(Object.fromEntries(
    Object.entries(cardDecksByCount).map(([itemCount, deck]) => [
      itemCount,
      visualSystemV1AdaptiveCardTypography(deck.cardWidth, deck.cardHeight)
    ])
  ));
  const cardDeck = cardDecksByCount[5];
  const cardTypography = visualSystemV1AdaptiveCardTypography(
    cardDeck.cardWidth,
    cardDeck.cardHeight
  );
  const [skill, agent, mcp, result, human] = cardDeck.cards;
  const cardStyle = (card) => Object.freeze({
    left: card.left,
    top: card.top,
    width: card.width,
    height: card.height
  });
  return Object.freeze({
    ...base,
    bodyWidth: width,
    bodyHeight: height,
    copy,
    cardConstraints,
    cardDeck,
    cardDecksByCount,
    cardTypography,
    cardTypographyByCount,
    nodes: Object.freeze({
      skill: cardStyle(skill),
      agent: cardStyle(agent),
      mcp: cardStyle(mcp),
      result: cardStyle(result),
      human: cardStyle(human)
    }),
    connectors: visualSystemV1HorizontalCardConnectors(cardDeck.cards)
  });
}

function cardStyle(card) {
  return Object.freeze({
    left: card.left,
    top: card.top,
    width: card.width,
    height: card.height
  });
}

function focusStateAtFrame(frame) {
  const enteredIndex = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES.findLastIndex(
    (stage) => frame >= stage.nodeEnterFrame
  );
  const progressByNode = Object.fromEntries(WORKFLOW_NODE_IDS.map((nodeId) => [nodeId, 0]));
  if (enteredIndex < 0) {
    return Object.freeze({
      focusId: null,
      progressByNode: Object.freeze(progressByNode)
    });
  }
  const enteredStage = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES[enteredIndex];
  const incomingProgress = visualSystemV1ProgressAtFrame(
    frame,
    enteredStage.nodeEnterFrame,
    VISUAL_SYSTEM_V1.motion.cardFocusFrames
  );
  progressByNode[enteredStage.nodeId] = incomingProgress;
  if (enteredIndex > 0) {
    progressByNode[
      VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES[enteredIndex - 1].nodeId
    ] = 1 - incomingProgress;
  }
  return Object.freeze({
    focusId: incomingProgress >= 0.5
      ? enteredStage.nodeId
      : VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES[enteredIndex - 1]?.nodeId ?? enteredStage.nodeId,
    progressByNode: Object.freeze(progressByNode)
  });
}

export function visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame(layout, frame) {
  if (
    layout === null || typeof layout !== "object" ||
    layout.orientation !== "wide" ||
    layout.cardDecksByCount === null || typeof layout.cardDecksByCount !== "object"
  ) {
    throw new TypeError("逐帧工作流布局需要有效的横版基础布局");
  }
  if (!Number.isFinite(frame)) {
    throw new TypeError("逐帧工作流布局需要有限帧号");
  }

  const targetStageIndex = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES.findLastIndex(
    (stage) => frame >= stage.reflowStartFrame
  );
  const effectiveStageIndex = Math.max(0, targetStageIndex);
  const targetStage = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES[effectiveStageIndex];
  const targetCount = targetStage.itemCount;
  const visibleCount = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_LAYOUT_STAGES.filter(
    (stage) => frame > stage.nodeEnterFrame
  ).length;
  const reflowProgress = targetCount === 1
    ? 1
    : visualSystemV1ProgressAtFrame(
        frame,
        targetStage.reflowStartFrame,
        VISUAL_SYSTEM_V1.motion.cardReflowFrames
      );
  const dynamicDeck = targetCount === 1
    ? layout.cardDecksByCount[1]
    : visualSystemV1InterpolateCardDeck(
        layout.cardDecksByCount[targetCount - 1],
        layout.cardDecksByCount[targetCount],
        reflowProgress
      );

  const nodes = Object.freeze(Object.fromEntries(WORKFLOW_NODE_IDS.map((nodeId, index) => {
    const card = dynamicDeck.cards[index] ?? layout.cardDecksByCount[index + 1].cards[index];
    return [nodeId, cardStyle(card)];
  })));
  const connectors = [];
  for (let index = 0; index < targetCount - 1; index += 1) {
    const fromCard = dynamicDeck.cards[index];
    const toCard = dynamicDeck.cards[index + 1];
    const nextNodeHasEntered = index + 1 < visibleCount;
    const finalDeck = layout.cardDecksByCount[targetCount];
    const finalGap = finalDeck.cards[index + 1].left - finalDeck.cards[index].right;
    const from = Object.freeze({
      x: fromCard.right,
      y: fromCard.top + fromCard.height / 2
    });
    const to = Object.freeze({
      x: nextNodeHasEntered
        ? toCard.left
        : from.x + finalGap * reflowProgress,
      y: toCard.top + toCard.height / 2
    });
    connectors.push(Object.freeze({ from, to, orientation: "horizontal" }));
  }
  const focus = focusStateAtFrame(frame);

  return Object.freeze({
    ...layout,
    mode: "scene-adaptive-visible-node-count",
    visibleCount,
    targetCount,
    reflowProgress,
    cardDeck: dynamicDeck,
    cardTypography: visualSystemV1AdaptiveCardTypography(
      dynamicDeck.cardWidth,
      dynamicDeck.cardHeight
    ),
    nodes,
    connectors: Object.freeze(connectors),
    focusId: focus.focusId,
    focusProgressByNode: focus.progressByNode
  });
}
