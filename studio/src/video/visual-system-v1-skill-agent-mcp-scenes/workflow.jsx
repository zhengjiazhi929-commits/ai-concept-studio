import React from "react";
import { useCurrentFrame } from "remotion";

import {
  VisualSystemV1DirectedConnector,
  VisualSystemV1FlatNode
} from "../components/visual-system-v1/index.jsx";
import {
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF,
  visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame
} from "../visual-system-v1-skill-agent-mcp-proof-plan.mjs";

export function VisualSystemV1SkillAgentMcpWorkflow({ layout }) {
  const frame = useCurrentFrame();
  const { timeline } = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF;
  const adaptiveLayout = visualSystemV1SkillAgentMcpWorkflowLayoutAtFrame(layout, frame);
  const connectorStartFrames = [
    timeline.skillToAgentFrame,
    timeline.agentToMcpFrame,
    timeline.mcpToResultFrame,
    timeline.resultToHumanFrame
  ];
  const connectorProps = {
    canvasWidth: adaptiveLayout.bodyWidth,
    canvasHeight: adaptiveLayout.bodyHeight,
    style: { zIndex: 1 }
  };
  return (
    <div
      data-visual-system-flat-structure="skill-agent-mcp-flow"
      data-scene-adaptive-layout="visible-node-count"
      data-visible-card-count={adaptiveLayout.visibleCount}
      data-target-card-count={adaptiveLayout.targetCount}
      data-focus-node={adaptiveLayout.focusId ?? "none"}
      style={{ position: "absolute", inset: 0, zIndex: 2 }}
    >
      {adaptiveLayout.connectors.map((connector, index) => (
        <VisualSystemV1DirectedConnector
          key={`workflow-connector-${index}`}
          {...connectorProps}
          {...connector}
          startFrame={connectorStartFrames[index]}
        />
      ))}
      <VisualSystemV1FlatNode
        nodeId="skill"
        marker="RULE"
        label="Skill"
        detail="规则与完成标准"
        startFrame={timeline.skillEnterFrame}
        focusProgress={adaptiveLayout.focusProgressByNode.skill}
        layoutMode="fill-safe-viewport"
        style={{ ...adaptiveLayout.nodes.skill, zIndex: 2 }}
      />
      <VisualSystemV1FlatNode
        nodeId="agent"
        marker="ACTIVE NODE"
        label="Agent"
        detail="判断并组织执行"
        startFrame={timeline.agentEnterFrame}
        focusProgress={adaptiveLayout.focusProgressByNode.agent}
        layoutMode="fill-safe-viewport"
        style={{ ...adaptiveLayout.nodes.agent, zIndex: 2 }}
      />
      <VisualSystemV1FlatNode
        nodeId="mcp"
        marker="PROTOCOL"
        label="MCP"
        detail="标准化连接外部能力"
        startFrame={timeline.mcpEnterFrame}
        focusProgress={adaptiveLayout.focusProgressByNode.mcp}
        layoutMode="fill-safe-viewport"
        style={{ ...adaptiveLayout.nodes.mcp, zIndex: 2 }}
      />
      <VisualSystemV1FlatNode
        nodeId="result"
        marker="KEY RESULT"
        label="外部能力"
        detail="结果与证据已返回"
        startFrame={timeline.resultEnterFrame}
        focusProgress={adaptiveLayout.focusProgressByNode.result}
        layoutMode="fill-safe-viewport"
        style={{ ...adaptiveLayout.nodes.result, zIndex: 2 }}
      />
      <VisualSystemV1FlatNode
        nodeId="human"
        marker="HUMAN GATE"
        label="等待人工确认"
        detail="采用，或退回修改"
        startFrame={timeline.humanEnterFrame}
        focusProgress={adaptiveLayout.focusProgressByNode.human}
        accent="purple"
        layoutMode="fill-safe-viewport"
        style={{ ...adaptiveLayout.nodes.human, zIndex: 2 }}
      />
    </div>
  );
}
