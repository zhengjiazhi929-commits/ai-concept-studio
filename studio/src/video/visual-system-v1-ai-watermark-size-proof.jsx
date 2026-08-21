import React from "react";
import { AbsoluteFill, Img } from "remotion";

import { VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF } from "./visual-system-v1-ai-watermark-size-proof-plan.mjs";

export function VisualSystemV1AiWatermarkSizeProof({
  sourceDataUrl,
  size,
  top,
  right,
  guideVisible = true
}) {
  const { outline } = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF;
  return (
    <AbsoluteFill style={{ backgroundColor: "#f5f8f6" }}>
      <Img
        src={sourceDataUrl}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover"
        }}
      />
      {guideVisible ? (
        <div
          data-review-only-watermark-size-range="true"
          style={{
            position: "absolute",
            top,
            right,
            width: size,
            height: size,
            boxSizing: "border-box",
            border: `${outline.width}px ${outline.style} ${outline.color}`,
            borderRadius: outline.cornerRadius,
            background: outline.fill,
            boxShadow: outline.shadow,
            pointerEvents: "none"
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}
