export const AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FPS = 30;
export const AGENT_SKILL_LONG_BACKGROUND_COMPARISON_DURATION_SECONDS = 30;
export const AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FRAME_COUNT =
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FPS *
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_DURATION_SECONDS;

// 306s keeps the complete 30-second preview inside S10. The selected abstract
// background repeats every 750 frames, so frame 9_180 and frame 9_930 are the
// same background phase while the 749 -> 750 seam remains a normal one-frame
// motion step during a stable foreground stage. The final five seconds
// therefore show the beginning of cycle 2, ending exactly at the S10 boundary.
export const AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME = 9_180;
export const AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_SECOND =
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_START_FRAME /
  AGENT_SKILL_LONG_BACKGROUND_COMPARISON_FPS;

export const AGENT_SKILL_LONG_BACKGROUND_COMPARISON_MATERIAL =
  "episodes/agent-skill-20260806/materials/material-v003.png";

export const AGENT_SKILL_LONG_BACKGROUND_COMPARISON_CANDIDATES = Object.freeze([
  Object.freeze({
    id: "AgentSkillLongBackgroundBlurredMaterial",
    variant: "blurred-material",
    label: "方案 1 · 低透明度模糊素材背景",
    outputFileName: "01-blurred-material.mp4"
  }),
  Object.freeze({
    id: "AgentSkillLongBackgroundSoftGradient",
    variant: "soft-gradient",
    label: "方案 2 · 抽象柔光渐变背景",
    outputFileName: "02-soft-gradient.mp4"
  })
]);

export const AGENT_SKILL_LONG_BACKGROUND_SELECTED_CANDIDATE = Object.freeze({
  id: "AgentSkillLongBackgroundSoftGradientMoving",
  variant: "soft-gradient-moving",
  label: "已选方案 2 · 30 秒边缘半露三色换位柔光",
  outputFileName: "01-soft-gradient-edge-swap-30s.mp4",
  requiresMaterial: false
});
