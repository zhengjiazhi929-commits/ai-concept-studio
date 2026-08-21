import React from "react";
import { Composition } from "remotion";

import { AgentSkillLongReview } from "./agent-skill-long-review.jsx";
import {
  AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS,
  AGENT_SKILL_LONG_REVIEW_FPS
} from "./agent-skill-long-review-plan.mjs";

const defaultEpisode = {
  id: "agent-skill-20260806",
  title: "Agent Skill 到底是什么？它不是 Prompt，也不是 MCP",
  scenes: [],
  subtitles: [],
  voice: null
};

export function AgentSkillLongReviewRoot() {
  return (
    <Composition
      id="AgentSkillLongReview"
      component={AgentSkillLongReview}
      durationInFrames={AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS * AGENT_SKILL_LONG_REVIEW_FPS}
      fps={AGENT_SKILL_LONG_REVIEW_FPS}
      width={540}
      height={960}
      defaultProps={{ episode: defaultEpisode }}
    />
  );
}
