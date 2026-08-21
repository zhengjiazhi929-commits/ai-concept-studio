export const AGENT_SKILL_LONG_BACKGROUND_MOTION_POLICY = Object.freeze({
  schemaVersion: "agent-skill-long-background-motion-v1",
  fps: 30,
  cycleSeconds: 25,
  cycleFrames: 750,
  easing: "continuous-sinusoidal-loop",
  maximumTranslationPixels: Object.freeze({ x: 18, y: 11 })
});

export const AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY = Object.freeze({
  schemaVersion: "agent-skill-long-soft-gradient-motion-v3",
  fps: 30,
  cycleSeconds: 25,
  cycleFrames: 750,
  easing: "continuous-edge-anchor-affine-loop",
  viewportPixels: Object.freeze({ width: 540, height: 960 }),
  edgeAnchorCenters: Object.freeze([
    Object.freeze({ id: "right-upper", x: 540, y: 180 }),
    Object.freeze({ id: "left-middle", x: 0, y: 480 }),
    Object.freeze({ id: "bottom-right", x: 360, y: 960 })
  ]),
  scaleRange: Object.freeze({ minimum: 0.85, maximum: 1.15 }),
  phaseOffsetTurns: Object.freeze({
    purple: 0,
    mint: 1 / 3,
    orange: 2 / 3
  })
});

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

export function agentSkillLongBackgroundMotionAtFrame(
  frame,
  fps = AGENT_SKILL_LONG_BACKGROUND_MOTION_POLICY.fps
) {
  if (!Number.isFinite(frame)) throw new Error("背景柔光 frame 必须是有限数字");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("背景柔光 fps 必须是正数");
  const cycleFrames = fps * AGENT_SKILL_LONG_BACKGROUND_MOTION_POLICY.cycleSeconds;
  const loopFrame = positiveModulo(frame, cycleFrames);
  const phase = (loopFrame / cycleFrames) * Math.PI * 2;
  return {
    loopFrame,
    cycleFrames,
    x: 18 * Math.cos(phase),
    y: 11 * Math.sin(phase)
  };
}

export function agentSkillLongSoftGradientMotionAtFrame(
  frame,
  fps = AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.fps
) {
  if (!Number.isFinite(frame)) throw new Error("抽象柔光 frame 必须是有限数字");
  if (!Number.isFinite(fps) || fps <= 0) throw new Error("抽象柔光 fps 必须是正数");
  const cycleFrames = fps * AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY.cycleSeconds;
  const loopFrame = positiveModulo(frame, cycleFrames);
  const phase = (loopFrame / cycleFrames) * Math.PI * 2;
  const { edgeAnchorCenters, phaseOffsetTurns, viewportPixels } =
    AGENT_SKILL_LONG_SOFT_GRADIENT_MOTION_POLICY;
  const [first, second, third] = edgeAnchorCenters;
  const mean = {
    x: (first.x + second.x + third.x) / 3,
    y: (first.y + second.y + third.y) / 3
  };
  const cosine = {
    x: (2 * first.x - second.x - third.x) / 3,
    y: (2 * first.y - second.y - third.y) / 3
  };
  const sine = {
    x: (second.x - third.x) / Math.sqrt(3),
    y: (second.y - third.y) / Math.sqrt(3)
  };
  const stateFor = (id) => {
    const layerPhase = phase + phaseOffsetTurns[id] * Math.PI * 2;
    const centerX =
      mean.x + cosine.x * Math.cos(layerPhase) + sine.x * Math.sin(layerPhase);
    const centerY =
      mean.y + cosine.y * Math.cos(layerPhase) + sine.y * Math.sin(layerPhase);
    return {
      centerX,
      centerY,
      x: centerX - viewportPixels.width / 2,
      y: centerY - viewportPixels.height / 2,
      scale: 1 + 0.15 * Math.sin(layerPhase)
    };
  };
  return {
    loopFrame,
    cycleFrames,
    purple: stateFor("purple"),
    mint: stateFor("mint"),
    orange: stateFor("orange")
  };
}
