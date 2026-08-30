import {
  AI_CUBE_FACES,
  AI_WATERMARK_EXTRUSION_LAYERS,
  VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF,
  aiCubeFaceVisibilityAtFrame,
  aiExtrusionLayerState,
  aiWatermarkMotionAtFrame
} from "../../visual-system-v1-ai-watermark-proof-plan.mjs";

export {
  AI_CUBE_FACES,
  AI_WATERMARK_EXTRUSION_LAYERS,
  aiCubeFaceVisibilityAtFrame,
  aiExtrusionLayerState,
  aiWatermarkMotionAtFrame
};

export const VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_PROFILE_ID =
  "approved-v013-stable-footprint";

export const VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILE_ALIASES = Object.freeze({
  "review-v013-stable-footprint": "approved-v013-stable-footprint"
});

const approvedV012RasterSequence = Object.freeze({
  assetVersion: 12,
  frameCount: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cycleFrames,
  width: 120,
  height: 120,
  assetRoot: "assets/visual-system-v1/ai-watermark-v012/frames"
});

const approvedV013RasterSequence = Object.freeze({
  assetVersion: 13,
  frameCount: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cycleFrames,
  width: 120,
  height: 120,
  assetRoot: "assets/visual-system-v1/ai-watermark-v013/frames"
});

export const VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILES = Object.freeze({
  "approved-v012": Object.freeze({
    id: "approved-v012",
    approvalStatus: "approved",
    reviewOnly: false,
    rasterSequenceLabel: "approved-v012-120-frame-cycle",
    rasterSequence: approvedV012RasterSequence
  }),
  "approved-v013-stable-footprint": Object.freeze({
    id: "approved-v013-stable-footprint",
    approvalStatus: "approved",
    reviewOnly: false,
    rasterSequenceLabel: "approved-v013-stable-footprint-120-frame-cycle",
    rasterSequence: approvedV013RasterSequence
  })
});

export const VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_CADENCE_ID = "continuous";

export const VISUAL_SYSTEM_V1_AI_WATERMARK_CADENCES = Object.freeze({
  continuous: Object.freeze({
    id: "continuous",
    visibilityPolicy: "persistent-all-frames",
    bodyMotionPolicy: "continuous-approved-raster-cycle",
    transitionMotionPolicy: "not-applicable",
    geometryPolicy: "immutable-approved-placement"
  }),
  "longform-quiet": Object.freeze({
    id: "longform-quiet",
    visibilityPolicy: "persistent-all-frames",
    bodyMotionPolicy: "static-approved-raster-frame",
    transitionMotionPolicy: "restrained-closed-raster-excursion-per-declared-transition",
    geometryPolicy: "immutable-approved-placement",
    idleRasterFrame: 0,
    transitionWindowFrames: 30,
    transitionRasterExcursionFrames: 10,
    defaultTransitionPolicy: "composition-entry-and-exit-only"
  })
});

export function visualSystemV1AiWatermarkCadence(
  cadenceId = VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_CADENCE_ID
) {
  const cadence = VISUAL_SYSTEM_V1_AI_WATERMARK_CADENCES[cadenceId];
  if (!cadence) {
    throw new Error(`未知的 visual-system-v1 AI 水印 cadence: ${cadenceId}`);
  }
  return cadence;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`AI 水印${label}必须是非负整数`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`AI 水印${label}必须是正整数`);
  }
  return value;
}

function normalizeTransitionFrames(transitionFrames, durationInFrames, transitionWindowFrames) {
  if (!Array.isArray(transitionFrames)) {
    throw new Error("AI 水印场景切换帧必须是数组");
  }
  if (transitionFrames.length === 0) {
    throw new Error("AI 水印正式长片场景切换帧不能为空数组");
  }
  const normalized = transitionFrames.map((transitionFrame) =>
    nonNegativeInteger(transitionFrame, "场景切换帧")
  );
  const windowFrames = positiveInteger(transitionWindowFrames, "切换窗口帧数");
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("AI 水印场景切换帧不能重复");
  }
  const sorted = [...normalized].sort((left, right) => left - right);
  if (durationInFrames !== undefined) {
    const duration = positiveInteger(durationInFrames, "成片帧数");
    for (const transitionFrame of sorted) {
      if (transitionFrame + windowFrames > duration) {
        throw new Error("AI 水印场景切换窗口必须完整位于成片范围内");
      }
    }
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] - sorted[index - 1] < windowFrames) {
      throw new Error("AI 水印场景切换窗口不能重叠");
    }
  }
  return Object.freeze(sorted);
}

export function visualSystemV1AiWatermarkDefaultLongformTransitions(
  durationInFrames,
  transitionWindowFrames =
    VISUAL_SYSTEM_V1_AI_WATERMARK_CADENCES["longform-quiet"].transitionWindowFrames
) {
  const duration = positiveInteger(durationInFrames, "成片帧数");
  const windowFrames = positiveInteger(transitionWindowFrames, "切换窗口帧数");
  if (duration < windowFrames) {
    throw new Error("AI 水印成片帧数不能短于闭合切换窗口");
  }
  const exitStartFrame = Math.max(0, duration - windowFrames);
  return Object.freeze(exitStartFrame === 0 ? [0] : [0, exitStartFrame]);
}

export function visualSystemV1AiWatermarkCadenceState({
  frame,
  durationInFrames,
  rasterFrameCount,
  cadenceId = VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_CADENCE_ID,
  transitionFrames
}) {
  const outputFrame = nonNegativeInteger(frame, "当前帧");
  const sourceFrameCount = positiveInteger(rasterFrameCount, "栅格序列帧数");
  const cadence = visualSystemV1AiWatermarkCadence(cadenceId);

  if (cadence.id === "continuous") {
    return Object.freeze({
      cadenceId: cadence.id,
      visibilityPolicy: cadence.visibilityPolicy,
      phase: "continuous-motion",
      motionActive: true,
      rasterFrame: outputFrame % sourceFrameCount,
      transitionFrame: null,
      transitionOffset: null
    });
  }

  const resolvedTransitionFrames = normalizeTransitionFrames(
    transitionFrames == null
      ?
      visualSystemV1AiWatermarkDefaultLongformTransitions(
        durationInFrames,
        cadence.transitionWindowFrames
      )
      : transitionFrames,
    durationInFrames,
    cadence.transitionWindowFrames
  );
  let activeTransitionFrame = null;
  for (const transitionFrame of resolvedTransitionFrames) {
    if (
      outputFrame >= transitionFrame &&
      outputFrame < transitionFrame + cadence.transitionWindowFrames
    ) {
      activeTransitionFrame = transitionFrame;
    }
    if (transitionFrame > outputFrame) break;
  }

  if (activeTransitionFrame === null) {
    return Object.freeze({
      cadenceId: cadence.id,
      visibilityPolicy: cadence.visibilityPolicy,
      phase: "quiet-body-hold",
      motionActive: false,
      rasterFrame: cadence.idleRasterFrame,
      transitionFrame: null,
      transitionOffset: null
    });
  }

  const transitionOffset = outputFrame - activeTransitionFrame;
  const transitionProgress =
    cadence.transitionWindowFrames === 1
      ? 0
      : transitionOffset / (cadence.transitionWindowFrames - 1);
  const closedExcursionProgress =
    transitionProgress <= 0.5
      ? transitionProgress * 2
      : (1 - transitionProgress) * 2;
  const rasterFrame = Math.round(
    closedExcursionProgress *
      Math.min(cadence.transitionRasterExcursionFrames, sourceFrameCount - 1)
  );
  return Object.freeze({
    cadenceId: cadence.id,
    visibilityPolicy: cadence.visibilityPolicy,
    phase: "declared-transition-motion",
    motionActive: true,
    rasterFrame,
    transitionFrame: activeTransitionFrame,
    transitionOffset
  });
}

export function visualSystemV1AiWatermarkProfile(
  profileId = VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_PROFILE_ID
) {
  const canonicalProfileId =
    VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILE_ALIASES[profileId] ?? profileId;
  const profile = VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILES[canonicalProfileId];
  if (!profile) {
    throw new Error(`未知的 visual-system-v1 AI 水印 profile: ${profileId}`);
  }
  return profile;
}

export const VISUAL_SYSTEM_V1_AI_WATERMARK = Object.freeze({
  schemaVersion: "visual-system-v1-ai-watermark-v2",
  motionSchemaVersion: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.schemaVersion,
  outputFormat: "wide-only",
  role: "persistent-brand-watermark",
  contentSurfacePolicyExempt: true,
  renderMode: "validated-transparent-png-sequence",
  defaultProfileId: VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_PROFILE_ID,
  defaultCadenceId: VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_CADENCE_ID,
  profileSelectionPolicy: "approved-v013-default-v012-explicit-legacy-fallback",
  cadenceSelectionPolicy: "continuous-standard-longform-quiet-explicit-transitions",
  legacyProfileAliases: VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILE_ALIASES,
  profiles: VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILES,
  cadences: VISUAL_SYSTEM_V1_AI_WATERMARK_CADENCES,
  placement: Object.freeze({
    size: 120,
    top: 40,
    right: 40,
    zIndex: 6
  }),
  referenceStage: Object.freeze({
    size: 520,
    perspective: 780,
    perspectiveOrigin: "50% 46%",
    scaleAt120Px: 0.46
  }),
  rasterSequence: approvedV013RasterSequence,
  motion: Object.freeze({
    cycleFrames: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.cycleFrames,
    turnFrames: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.turnFrames,
    turnCount: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.turnCount,
    directionPattern: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.reference.adaptedDirectionPattern
  })
});

function positiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`AI 水印${label}必须是正数`);
  }
  return value;
}

function nonNegativeFinite(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`AI 水印${label}必须是非负数`);
  }
  return value;
}

export function visualSystemV1AiWatermarkGeometry(
  width,
  height,
  placement = VISUAL_SYSTEM_V1_AI_WATERMARK.placement
) {
  if (width !== 1920 || height !== 1080) {
    throw new Error("visual-system-v1 AI 水印默认只允许 1920x1080 横版");
  }
  const size = positiveFinite(placement.size, "尺寸");
  const top = nonNegativeFinite(placement.top, "顶部距离");
  const right = nonNegativeFinite(placement.right, "右侧距离");
  const zIndex = nonNegativeFinite(placement.zIndex, "层级");
  if (top + size > height || right + size > width) {
    throw new Error("AI 水印超出横版画布");
  }
  return Object.freeze({
    left: width - right - size,
    top,
    right,
    bottom: height - top - size,
    width: size,
    height: size,
    zIndex
  });
}

export function visualSystemV1AiWatermarkScale(size) {
  const requestedSize = positiveFinite(size, "尺寸");
  const { placement, referenceStage } = VISUAL_SYSTEM_V1_AI_WATERMARK;
  return (requestedSize / placement.size) * referenceStage.scaleAt120Px;
}
