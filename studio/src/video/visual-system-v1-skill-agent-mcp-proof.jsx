import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

import {
  VisualSystemV1AiWatermark,
  VisualSystemV1Canvas,
  VisualSystemV1ChapterProgress,
  VisualSystemV1PlainSubtitle,
  VisualSystemV1SceneLayer,
  visualSystemV1SceneOpacityAtFrame
} from "./components/visual-system-v1/index.jsx";
import { VisualSystemV1BoundaryScene } from "./visual-system-v1-skill-agent-mcp-scenes/scene-boundary.jsx";
import { VisualSystemV1ExecutionScene } from "./visual-system-v1-skill-agent-mcp-scenes/scene-execution.jsx";
import { VisualSystemV1ReviewScene } from "./visual-system-v1-skill-agent-mcp-scenes/scene-review.jsx";
import { VisualSystemV1SkillAgentMcpWorkflow } from "./visual-system-v1-skill-agent-mcp-scenes/workflow.jsx";
import {
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CAPTIONS,
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS,
  VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF,
  visualSystemV1SkillAgentMcpProofLayout
} from "./visual-system-v1-skill-agent-mcp-proof-plan.mjs";

const [boundaryScene, executionScene, reviewScene] = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.scenes;
const { watermark } = VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF;

export function VisualSystemV1SkillAgentMcpProof() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const layout = visualSystemV1SkillAgentMcpProofLayout(width, height);
  const masterOpacity = visualSystemV1SceneOpacityAtFrame(frame, {
    startFrame: 0,
    endFrame: VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_PROOF.durationInFrames
  });
  return (
    <VisualSystemV1Canvas>
      <div
        data-visual-system-content="open-canvas"
        style={{ position: "absolute", inset: 0, opacity: masterOpacity }}
      >
        <VisualSystemV1SceneLayer
          startFrame={boundaryScene.startFrame}
          endFrame={boundaryScene.endFrame}
        >
          <VisualSystemV1BoundaryScene
            layout={layout}
            textStartFrame={boundaryScene.textStartFrame}
          />
        </VisualSystemV1SceneLayer>
        <VisualSystemV1SceneLayer
          startFrame={executionScene.startFrame}
          endFrame={executionScene.endFrame}
        >
          <VisualSystemV1ExecutionScene
            layout={layout}
            textStartFrame={executionScene.textStartFrame}
          />
        </VisualSystemV1SceneLayer>
        <VisualSystemV1SceneLayer
          startFrame={reviewScene.startFrame}
          endFrame={reviewScene.endFrame}
        >
          <VisualSystemV1ReviewScene
            layout={layout}
            textStartFrame={reviewScene.textStartFrame}
          />
        </VisualSystemV1SceneLayer>
        <VisualSystemV1SkillAgentMcpWorkflow layout={layout} />
      </div>
      <VisualSystemV1AiWatermark
        size={watermark.placement.size}
        top={watermark.placement.top}
        right={watermark.placement.right}
        zIndex={watermark.placement.zIndex}
      />
      <VisualSystemV1PlainSubtitle
        captions={VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CAPTIONS}
      />
      <VisualSystemV1ChapterProgress
        chapters={VISUAL_SYSTEM_V1_SKILL_AGENT_MCP_CHAPTERS}
      />
    </VisualSystemV1Canvas>
  );
}
