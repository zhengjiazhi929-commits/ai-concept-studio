import { createDerivedShortEpisode } from "../src/server/production/derived-episode.mjs";

const PARENT_EPISODE_ID = "agent-skill-20260806";
const DERIVED_EPISODE_ID = "agent-skill-tool-mcp-60s-20260813";

const result = await createDerivedShortEpisode(PARENT_EPISODE_ID, {
  id: DERIVED_EPISODE_ID,
  title: "60 秒讲清 Skill、Tool 与 MCP 的分工",
  thesis: "Skill 规定做事方法，Tool 提供执行动作，MCP 标准化外部能力的暴露与调用。",
  sourceSectionIds: ["S05"]
});

console.log(JSON.stringify({
  episodeId: result.episode.id,
  parentEpisodeId: result.episode.derivation.parentEpisodeId,
  created: result.created,
  profile: result.episode.productionProfile,
  inheritedGate: {
    research: result.episode.approvals.research.status,
    artifactHash: result.episode.approvals.research.artifactHash,
    reviewReportId: result.episode.approvals.research.reviewReportId
  },
  resetGates: {
    script: result.episode.approvals.script.status,
    storyboard: result.episode.approvals.storyboard.status,
    assets: result.episode.approvals.assets.status,
    final: result.episode.approvals.final.status
  },
  nextWorker: result.episode.pipeline.find((step) => step.status === "ready")?.agent ?? null
}, null, 2));
