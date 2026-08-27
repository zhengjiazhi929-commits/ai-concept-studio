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
  schemaVersion: "visual-system-v1-ai-watermark-v1",
  motionSchemaVersion: VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF.schemaVersion,
  outputFormat: "wide-only",
  role: "persistent-brand-watermark",
  contentSurfacePolicyExempt: true,
  renderMode: "validated-transparent-png-sequence",
  defaultProfileId: VISUAL_SYSTEM_V1_AI_WATERMARK_DEFAULT_PROFILE_ID,
  profileSelectionPolicy: "approved-v013-default-v012-explicit-legacy-fallback",
  legacyProfileAliases: VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILE_ALIASES,
  profiles: VISUAL_SYSTEM_V1_AI_WATERMARK_PROFILES,
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
