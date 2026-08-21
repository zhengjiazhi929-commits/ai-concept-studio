export const VISUAL_PROOF_MOTION_PHASES = Object.freeze({
  hook: Object.freeze(["count", "compare", "settle"]),
  "prompt-repeat": Object.freeze(["open", "reveal", "highlight"]),
  "prompt-to-skill": Object.freeze(["split", "assemble", "verify"]),
  "knowledge-merge": Object.freeze(["collect", "connect", "confirm"]),
  "skill-discovery": Object.freeze(["type", "match", "read"]),
  "team-example": Object.freeze(["contribute", "combine", "reuse"])
});

export function motionPhaseIndex(frame, durationInFrames) {
  if (!Number.isFinite(frame) || !Number.isFinite(durationInFrames) || durationInFrames <= 0) return 0;
  const normalized = Math.min(0.999, Math.max(0, frame / durationInFrames));
  return Math.min(2, Math.floor(normalized * 3));
}

export function motionPhaseAt(shotId, frame, durationInFrames) {
  const phases = VISUAL_PROOF_MOTION_PHASES[shotId];
  return phases?.[motionPhaseIndex(frame, durationInFrames)] ?? "unknown";
}
