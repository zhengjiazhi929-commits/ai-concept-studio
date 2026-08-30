import React from "react";

import { VisualSystemV1AiWatermark } from "./ai-watermark.jsx";
import { VISUAL_SYSTEM_V1_AI_WATERMARK } from "./ai-watermark.mjs";

const placement = VISUAL_SYSTEM_V1_AI_WATERMARK.placement;
const safeZonePadding = 40;
const safeZoneSize = placement.size + safeZonePadding * 2;

export const VISUAL_SYSTEM_V1_WIDE_BRAND_TONES = Object.freeze({
  standard: Object.freeze({ opacity: 1, watermarkCadence: "continuous" }),
  quiet: Object.freeze({ opacity: 0.76, watermarkCadence: "longform-quiet" })
});

export const VISUAL_SYSTEM_V1_WIDE_BRAND_SAFE_ZONE = Object.freeze({
  id: "top-right-brand-exclusion-zone",
  outputFormat: "wide-only",
  canvas: Object.freeze({ width: 1920, height: 1080 }),
  bounds: Object.freeze({
    left: 1920 - safeZoneSize,
    top: 0,
    right: 1920,
    bottom: safeZoneSize,
    width: safeZoneSize,
    height: safeZoneSize
  }),
  padding: Object.freeze({
    top: safeZonePadding,
    right: safeZonePadding,
    bottom: safeZonePadding,
    left: safeZonePadding
  }),
  excludedContentRoles: Object.freeze([
    "title",
    "body-copy",
    "caption",
    "diagram",
    "connector"
  ])
});

export const VISUAL_SYSTEM_V1_WIDE_BRAND_LAYER = Object.freeze({
  schemaVersion: "visual-system-v1-wide-brand-layer-v1",
  outputFormat: "wide-only",
  role: "persistent-brand-layer",
  instancePolicy: "exactly-one-per-composition",
  defaultWatermarkProfileId: VISUAL_SYSTEM_V1_AI_WATERMARK.defaultProfileId,
  watermarkProfilePolicy: "approved-v013-default-v012-explicit-legacy-fallback",
  watermarkTonePolicy: "standard-default-quiet-explicit-longform",
  watermarkCadencePolicy:
    "standard-continuous-quiet-static-body-declared-transition-motion",
  watermarkTones: VISUAL_SYSTEM_V1_WIDE_BRAND_TONES,
  watermarkPlacement: placement,
  safeZone: VISUAL_SYSTEM_V1_WIDE_BRAND_SAFE_ZONE
});

export function VisualSystemV1WideBrandLayer({
  profile = VISUAL_SYSTEM_V1_AI_WATERMARK.defaultProfileId,
  tone = "standard",
  transitionFrames
} = {}) {
  const { safeZone } = VISUAL_SYSTEM_V1_WIDE_BRAND_LAYER;
  const resolvedTone = VISUAL_SYSTEM_V1_WIDE_BRAND_TONES[tone];
  if (!resolvedTone) throw new Error(`未知的 visual-system-v1 品牌水印 tone: ${tone}`);
  const transitionSource = resolvedTone.watermarkCadence === "continuous"
    ? "continuous-not-applicable"
    : transitionFrames == null
      ? "composition-entry-and-exit"
      : "declared-scene-transitions";
  return (
    <div
      aria-hidden="true"
      data-visual-system-brand-layer="wide-persistent-ai-watermark"
      data-brand-layer-instance-policy="exactly-one-per-composition"
      data-brand-layer-output-format="wide-only"
      data-brand-safe-zone-id={safeZone.id}
      data-brand-safe-zone-left={safeZone.bounds.left}
      data-brand-safe-zone-top={safeZone.bounds.top}
      data-brand-safe-zone-width={safeZone.bounds.width}
      data-brand-safe-zone-height={safeZone.bounds.height}
      data-brand-safe-zone-content-policy="reserved-no-content"
      data-brand-watermark-profile={profile}
      data-brand-watermark-tone={tone}
      data-brand-watermark-opacity={resolvedTone.opacity}
      data-brand-watermark-motion-cadence={resolvedTone.watermarkCadence}
      data-brand-watermark-transition-source={transitionSource}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: placement.zIndex,
        opacity: resolvedTone.opacity,
        pointerEvents: "none"
      }}
    >
      <VisualSystemV1AiWatermark
        profile={profile}
        motionCadence={resolvedTone.watermarkCadence}
        transitionFrames={transitionFrames}
      />
    </div>
  );
}
