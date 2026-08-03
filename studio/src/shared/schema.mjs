export const PIPELINE_DEFINITIONS = [
  { id: "trend", label: "热点发现", agent: "trend-agent", gate: "topic" },
  { id: "research", label: "研究与事实", agent: "research-agent", gate: "facts" },
  { id: "script", label: "脚本", agent: "script-agent", gate: "script" },
  { id: "storyboard", label: "分镜", agent: "storyboard-agent", gate: "visual" },
  { id: "assets", label: "素材", agent: "asset-agent", gate: null },
  { id: "voice", label: "旁白", agent: "voice-agent", gate: "voice" },
  { id: "render", label: "视频渲染", agent: "render-agent", gate: null },
  { id: "qa", label: "质量检查", agent: "qa-agent", gate: "final" }
];

export const STEP_STATUSES = new Set([
  "pending",
  "ready",
  "running",
  "waiting_approval",
  "blocked",
  "complete",
  "failed"
]);

export function validateEpisode(episode) {
  const errors = [];

  if (!episode || typeof episode !== "object") errors.push("episode must be an object");
  if (!episode?.id || !/^[a-z0-9-]+$/.test(episode.id)) errors.push("invalid episode id");
  if (!episode?.title) errors.push("title is required");
  if (!Array.isArray(episode?.pipeline)) errors.push("pipeline must be an array");
  if (!Array.isArray(episode?.scenes) || episode.scenes.length === 0) {
    errors.push("at least one scene is required");
  }

  const pipelineIds = new Set(episode?.pipeline?.map((step) => step.id) ?? []);
  for (const definition of PIPELINE_DEFINITIONS) {
    if (!pipelineIds.has(definition.id)) errors.push(`missing pipeline step: ${definition.id}`);
  }

  for (const step of episode?.pipeline ?? []) {
    if (!STEP_STATUSES.has(step.status)) errors.push(`invalid status for ${step.id}`);
  }

  let previousEnd = 0;
  for (const scene of episode?.scenes ?? []) {
    if (scene.start !== previousEnd) errors.push(`scene ${scene.id} does not continue timeline`);
    if (scene.end <= scene.start) errors.push(`scene ${scene.id} has invalid duration`);
    previousEnd = scene.end;
  }

  if (episode?.render?.durationSeconds && previousEnd !== episode.render.durationSeconds) {
    errors.push("scene timeline does not match render duration");
  }

  return { valid: errors.length === 0, errors };
}

export function summarizePipeline(pipeline) {
  const complete = pipeline.filter((step) => step.status === "complete").length;
  return {
    complete,
    total: pipeline.length,
    percent: Math.round((complete / Math.max(1, pipeline.length)) * 100)
  };
}
