export const AGENT_SKILL_UIVERSE_MOTION_PROOF = Object.freeze({
  schemaVersion: "agent-skill-uiverse-motion-proof-v2",
  compositionId: "AgentSkillUiverseMotionProof",
  width: 540,
  height: 960,
  fps: 30,
  durationSeconds: 8,
  durationInFrames: 240,
  palette: Object.freeze({
    paper: "#F6F8F6",
    ink: "#12221D",
    muted: "#66736E",
    mint: "#39B98F",
    mintDeep: "#17795D",
    mintSoft: "#DDF7ED",
    mintFace: "#C7F0E1",
    purple: "#8067D9",
    purpleSoft: "#DED3FF"
  }),
  balance: Object.freeze({
    flatPercent: 70,
    shallowDepthPercent: 30,
    primaryMintPercent: 80,
    secondaryPurplePercent: 20
  }),
  motion: Object.freeze({
    textEnterFrames: 12,
    textStaggerFrames: 4,
    moduleEnterFrames: 18,
    tileEnterFrames: 18,
    maximumVisibleDepthPx: 2.5,
    hoverAmplitudePx: 2,
    hoverEnterFrame: 164,
    hoverHoldFrame: 180,
    hoverExitFrame: 192,
    hoverSettledFrame: 210
  })
});

export function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function smoothStep(value) {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

export function progressAtFrame(frame, startFrame, durationInFrames) {
  if (frame <= startFrame) return frame === startFrame ? 0 : 0;
  if (frame >= startFrame + durationInFrames) return 1;
  return smoothStep((frame - startFrame) / durationInFrames);
}

export function textMotionAtFrame(frame, startFrame) {
  const progress = progressAtFrame(
    frame,
    startFrame,
    AGENT_SKILL_UIVERSE_MOTION_PROOF.motion.textEnterFrames
  );
  return Object.freeze({
    progress,
    opacity: progress,
    translateY: (1 - progress) * 6,
    scale: 0.985 + progress * 0.015
  });
}

export function activeNodeMotionAtFrame(frame) {
  const enterProgress = progressAtFrame(
    frame,
    62,
    AGENT_SKILL_UIVERSE_MOTION_PROOF.motion.moduleEnterFrames
  );
  const {
    hoverEnterFrame,
    hoverHoldFrame,
    hoverExitFrame,
    hoverSettledFrame
  } = AGENT_SKILL_UIVERSE_MOTION_PROOF.motion;
  let hoverProgress = 0;
  if (frame >= hoverEnterFrame && frame < hoverHoldFrame) {
    hoverProgress = progressAtFrame(frame, hoverEnterFrame, hoverHoldFrame - hoverEnterFrame);
  } else if (frame >= hoverHoldFrame && frame < hoverExitFrame) {
    hoverProgress = 1;
  } else if (frame >= hoverExitFrame && frame < hoverSettledFrame) {
    hoverProgress = 1 - progressAtFrame(frame, hoverExitFrame, hoverSettledFrame - hoverExitFrame);
  }
  return Object.freeze({
    enterProgress,
    opacity: enterProgress,
    translateY: (1 - enterProgress) * 12 -
      hoverProgress * AGENT_SKILL_UIVERSE_MOTION_PROOF.motion.hoverAmplitudePx,
    scale: 0.985 + enterProgress * 0.015,
    rotateX: 0.2 + (1 - enterProgress) * 1.2 + hoverProgress * 0.4,
    rotateY: -0.4 + (1 - enterProgress) * -1.2 + hoverProgress * 1,
    hoverProgress
  });
}

export function shallowTileMotionAtFrame(frame, startFrame) {
  const progress = progressAtFrame(
    frame,
    startFrame,
    AGENT_SKILL_UIVERSE_MOTION_PROOF.motion.tileEnterFrames
  );
  return Object.freeze({
    progress,
    opacity: progress,
    translateY: (1 - progress) * 10,
    scale: 0.985 + progress * 0.015,
    rotateX: 0.15 + (1 - progress) * 1.1,
    rotateY: -0.25 + (1 - progress) * -1.1
  });
}
