import React from "react";
import { Composition } from "remotion";

import { AgentSkillUiverseMotionProof } from "./agent-skill-uiverse-motion-proof.jsx";
import { AGENT_SKILL_UIVERSE_MOTION_PROOF } from "./agent-skill-uiverse-motion-proof-plan.mjs";

export function AgentSkillUiverseMotionProofRoot() {
  return (
    <Composition
      id={AGENT_SKILL_UIVERSE_MOTION_PROOF.compositionId}
      component={AgentSkillUiverseMotionProof}
      durationInFrames={AGENT_SKILL_UIVERSE_MOTION_PROOF.durationInFrames}
      fps={AGENT_SKILL_UIVERSE_MOTION_PROOF.fps}
      width={AGENT_SKILL_UIVERSE_MOTION_PROOF.width}
      height={AGENT_SKILL_UIVERSE_MOTION_PROOF.height}
    />
  );
}
