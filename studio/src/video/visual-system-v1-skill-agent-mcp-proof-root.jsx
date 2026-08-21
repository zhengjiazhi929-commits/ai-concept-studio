import React from "react";
import { Composition, Folder } from "remotion";

import { VisualSystemV1SkillAgentMcpProof } from "./visual-system-v1-skill-agent-mcp-proof.jsx";
import { VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF } from "./visual-system-v1-skill-agent-mcp-proof-plan.mjs";

export function VisualSystemV1SkillAgentMcpProofRoot() {
  const { compositions, durationInFrames, fps } = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF;
  return (
    <Folder name="Visual-System-V1">
      <Composition
        id={compositions.wide.id}
        component={VisualSystemV1SkillAgentMcpProof}
        durationInFrames={durationInFrames}
        fps={fps}
        width={compositions.wide.width}
        height={compositions.wide.height}
      />
    </Folder>
  );
}
