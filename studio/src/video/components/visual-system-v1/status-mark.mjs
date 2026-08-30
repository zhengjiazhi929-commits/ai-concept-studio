import { VISUAL_SYSTEM_V1 } from "./tokens.mjs";

export const VISUAL_SYSTEM_V1_STATUS_MARK_VARIANTS = Object.freeze([
  "quiet",
  "celebrate"
]);

export const VISUAL_SYSTEM_V1_STATUS_MARK_STATUSES = Object.freeze([
  "complete",
  "pending",
  "disabled"
]);

export const VISUAL_SYSTEM_V1_STATUS_MARK_SIZE_ROLES = Object.freeze({
  inline: Object.freeze({
    sizePx: 25,
    borderRadiusPx: 4,
    borderWidthPx: 2,
    strokeWidthPx: 2.6
  }),
  support: Object.freeze({
    sizePx: 36,
    borderRadiusPx: 6,
    borderWidthPx: 2.5,
    strokeWidthPx: 3.2
  }),
  focus: Object.freeze({
    sizePx: 56,
    borderRadiusPx: 9,
    borderWidthPx: 3,
    strokeWidthPx: 4
  })
});

export const VISUAL_SYSTEM_V1_STATUS_MARK_TOKENS = Object.freeze({
  complete: Object.freeze({
    backgroundColor: VISUAL_SYSTEM_V1.palette.mintDeep,
    borderColor: VISUAL_SYSTEM_V1.palette.mintDeep,
    checkColor: VISUAL_SYSTEM_V1.palette.whiteHighlight,
    opacity: 1
  }),
  pending: Object.freeze({
    backgroundColor: VISUAL_SYSTEM_V1.palette.paperWarm,
    borderColor: VISUAL_SYSTEM_V1.palette.lineStrong,
    checkColor: VISUAL_SYSTEM_V1.palette.whiteHighlight,
    opacity: 1
  }),
  disabled: Object.freeze({
    backgroundColor: VISUAL_SYSTEM_V1.palette.paperWarm,
    borderColor: VISUAL_SYSTEM_V1.palette.faint,
    checkColor: VISUAL_SYSTEM_V1.palette.whiteHighlight,
    opacity: 0.46
  })
});

export const VISUAL_SYSTEM_V1_STATUS_MARK_MOTION = Object.freeze({
  mode: "remotion-frame-progress-driven",
  settleMode: "stable-hold",
  quietDurationInFrames: 6,
  celebrateDurationInFrames: 18,
  celebrateCheckDelayProgress: 0.25,
  celebrateCheckCompleteProgress: 0.62
});

export const VISUAL_SYSTEM_V1_STATUS_MARK_REFERENCE = Object.freeze({
  source: "Uiverse",
  url: "https://uiverse.io/cssbuttons-io/short-shrimp-54",
  author: "cssbuttons-io",
  license: "MIT",
  original: Object.freeze({
    widthPx: 27,
    heightPx: 27,
    borderRadiusPx: 3,
    checkedBackground: "#6871f1",
    checkColor: "#ffffff",
    checkDelaySeconds: 0.15,
    jellyDurationSeconds: 0.6
  }),
  secondaryReference: Object.freeze({
    widthPx: 25,
    heightPx: 25,
    borderRadiusPx: 4,
    checkDrawSeconds: 0.2,
    shadow: "soft"
  }),
  adaptation: Object.freeze({
    mode: "independent-remotion-frame-driven-reimplementation",
    copiedComponentCode: false,
    cssAnimation: false,
    cssTransition: false,
    continuousLoop: false,
    palette: VISUAL_SYSTEM_V1.schemaVersion
  })
});

const CELEBRATE_JELLY_KEYFRAMES = Object.freeze([
  Object.freeze({ progress: 0, scaleX: 1, scaleY: 1 }),
  Object.freeze({ progress: 0.2, scaleX: 1.1, scaleY: 0.9 }),
  Object.freeze({ progress: 0.38, scaleX: 0.94, scaleY: 1.06 }),
  Object.freeze({ progress: 0.56, scaleX: 1.04, scaleY: 0.96 }),
  Object.freeze({ progress: 0.74, scaleX: 0.985, scaleY: 1.015 }),
  Object.freeze({ progress: 0.88, scaleX: 1.006, scaleY: 0.994 }),
  Object.freeze({ progress: 1, scaleX: 1, scaleY: 1 })
]);

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothStep(value) {
  const normalized = clamp01(value);
  return normalized * normalized * (3 - (2 * normalized));
}

function assertFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function assertVariant(variant) {
  if (!VISUAL_SYSTEM_V1_STATUS_MARK_VARIANTS.includes(variant)) {
    throw new RangeError(`Unknown status mark variant: ${String(variant)}`);
  }
}

function assertStatus(status) {
  if (!VISUAL_SYSTEM_V1_STATUS_MARK_STATUSES.includes(status)) {
    throw new RangeError(`Unknown status mark status: ${String(status)}`);
  }
}

function sizeForRole(sizeRole) {
  const size = VISUAL_SYSTEM_V1_STATUS_MARK_SIZE_ROLES[sizeRole];
  if (!size) {
    throw new RangeError(`Unknown status mark size role: ${String(sizeRole)}`);
  }
  return size;
}

function durationForVariant(variant) {
  assertVariant(variant);
  return variant === "quiet"
    ? VISUAL_SYSTEM_V1_STATUS_MARK_MOTION.quietDurationInFrames
    : VISUAL_SYSTEM_V1_STATUS_MARK_MOTION.celebrateDurationInFrames;
}

function interpolateJelly(progress) {
  const normalized = clamp01(progress);
  if (normalized === 1) return Object.freeze({ scaleX: 1, scaleY: 1 });

  const nextIndex = CELEBRATE_JELLY_KEYFRAMES.findIndex(
    (keyframe) => keyframe.progress >= normalized
  );
  const right = CELEBRATE_JELLY_KEYFRAMES[Math.max(1, nextIndex)];
  const left = CELEBRATE_JELLY_KEYFRAMES[Math.max(0, nextIndex - 1)];
  const localProgress = smoothStep(
    (normalized - left.progress) / (right.progress - left.progress)
  );

  return Object.freeze({
    scaleX: left.scaleX + ((right.scaleX - left.scaleX) * localProgress),
    scaleY: left.scaleY + ((right.scaleY - left.scaleY) * localProgress)
  });
}

export function visualSystemV1StatusMarkProgressAtFrame({
  frame,
  startFrame = 0,
  variant = "quiet",
  durationInFrames = durationForVariant(variant)
}) {
  assertFiniteNumber(frame, "frame");
  assertFiniteNumber(startFrame, "startFrame");
  assertFiniteNumber(durationInFrames, "durationInFrames");
  assertVariant(variant);
  if (durationInFrames <= 0) {
    throw new RangeError("durationInFrames must be greater than zero");
  }
  if (durationInFrames === 1) return frame >= startFrame ? 1 : 0;
  if (frame <= startFrame) return 0;
  const endFrame = startFrame + durationInFrames - 1;
  if (frame >= endFrame) return 1;

  return smoothStep((frame - startFrame) / (durationInFrames - 1));
}

export function visualSystemV1StatusMarkState({
  progress = 1,
  variant = "quiet",
  sizeRole = "inline",
  status = "complete"
} = {}) {
  assertFiniteNumber(progress, "progress");
  assertVariant(variant);
  assertStatus(status);
  const size = sizeForRole(sizeRole);
  const tokens = VISUAL_SYSTEM_V1_STATUS_MARK_TOKENS[status];
  const normalized = clamp01(progress);
  const isComplete = status === "complete";

  let checkProgress = 0;
  let checkOpacity = 0;
  let checkScale = 1;
  let scaleX = 1;
  let scaleY = 1;

  if (isComplete && variant === "quiet") {
    checkProgress = smoothStep(normalized);
    checkOpacity = checkProgress;
  }

  if (isComplete && variant === "celebrate") {
    const jelly = interpolateJelly(normalized);
    const checkEnterProgress = smoothStep(
      (normalized - VISUAL_SYSTEM_V1_STATUS_MARK_MOTION.celebrateCheckDelayProgress) /
      (VISUAL_SYSTEM_V1_STATUS_MARK_MOTION.celebrateCheckCompleteProgress -
        VISUAL_SYSTEM_V1_STATUS_MARK_MOTION.celebrateCheckDelayProgress)
    );
    checkProgress = checkEnterProgress;
    checkOpacity = checkEnterProgress;
    checkScale = 0.68 + (0.32 * checkEnterProgress);
    scaleX = jelly.scaleX;
    scaleY = jelly.scaleY;
  }

  return Object.freeze({
    progress: normalized,
    variant,
    sizeRole,
    status,
    sizePx: size.sizePx,
    borderRadiusPx: size.borderRadiusPx,
    borderWidthPx: size.borderWidthPx,
    strokeWidthPx: size.strokeWidthPx,
    backgroundColor: tokens.backgroundColor,
    borderColor: tokens.borderColor,
    checkColor: tokens.checkColor,
    opacity: tokens.opacity,
    checkProgress,
    checkOpacity,
    checkScale,
    scaleX,
    scaleY,
    settled: !isComplete || normalized === 1
  });
}
