import React from "react";

import {
  VisualSystemV1DirectedConnector,
  VisualSystemV1FlatNode
} from "../components/visual-system-v1/index.jsx";
import { VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF } from "../visual-system-v1-skill-agent-mcp-proof-plan.mjs";

export function VisualSystemV1SkillAgentMcpWorkflow({ layout }) {
  const { timeline } = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF;
  const [skillToAgent, agentToMcp, mcpToResult, resultToHuman] = layout.connectors;
  const connectorProps = {
    canvasWidth: layout.bodyWidth,
    canvasHeight: layout.bodyHeight,
    style: { zIndex: 1 }
  };
  return (
    <div
      data-visual-system-flat-structure="skill-agent-mcp-flow"
      style={{ position: "absolute", inset: 0 }}
    >
      <VisualSystemV1DirectedConnector
        {...connectorProps}
        {...skillToAgent}
        startFrame={timeline.skillToAgentFrame}
      />
      <VisualSystemV1DirectedConnector
        {...connectorProps}
        {...agentToMcp}
        startFrame={timeline.agentToMcpFrame}
      />
      <VisualSystemV1DirectedConnector
        {...connectorProps}
        {...mcpToResult}
        startFrame={timeline.mcpToResultFrame}
      />
      <VisualSystemV1DirectedConnector
        {...connectorProps}
        {...resultToHuman}
        startFrame={timeline.resultToHumanFrame}
      />
      <VisualSystemV1FlatNode
        marker="RULE"
        label="Skill"
        detail="规则与完成标准"
        startFrame={timeline.skillEnterFrame}
        style={{ ...layout.nodes.skill, zIndex: 2 }}
      />
      <VisualSystemV1FlatNode
        marker="ACTIVE NODE"
        label="Agent"
        detail="判断并组织执行"
        startFrame={timeline.agentEnterFrame}
        style={{ ...layout.nodes.agent, zIndex: 2 }}
      />
      <VisualSystemV1FlatNode
        marker="PROTOCOL"
        label="MCP"
        detail="标准化连接外部能力"
        startFrame={timeline.mcpEnterFrame}
        style={{ ...layout.nodes.mcp, zIndex: 2 }}
      />
      <VisualSystemV1FlatNode
        marker="KEY RESULT"
        label="外部能力"
        detail="结果与证据已返回"
        startFrame={timeline.resultEnterFrame}
        style={{ ...layout.nodes.result, zIndex: 2 }}
      />
      <VisualSystemV1FlatNode
        marker="HUMAN GATE"
        label="等待人工确认"
        detail="采用，或退回修改"
        startFrame={timeline.humanEnterFrame}
        accent="purple"
        style={{ ...layout.nodes.human, zIndex: 2 }}
      />
    </div>
  );
}
