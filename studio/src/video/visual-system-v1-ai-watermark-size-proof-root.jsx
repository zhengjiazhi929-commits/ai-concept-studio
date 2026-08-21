import React from "react";
import { Composition } from "remotion";

import { VisualSystemV1AiWatermarkSizeProof } from "./visual-system-v1-ai-watermark-size-proof.jsx";
import { VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF } from "./visual-system-v1-ai-watermark-size-proof-plan.mjs";

const EMPTY_SOURCE =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'/%3E";

export function VisualSystemV1AiWatermarkSizeProofRoot() {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_SIZE_PROOF;
  return (
    <Composition
      id={contract.compositionId}
      component={VisualSystemV1AiWatermarkSizeProof}
      durationInFrames={contract.durationInFrames}
      fps={contract.fps}
      width={contract.width}
      height={contract.height}
      defaultProps={{
        sourceDataUrl: EMPTY_SOURCE,
        size: contract.options[0].size,
        top: contract.anchor.top,
        right: contract.anchor.right,
        guideVisible: true
      }}
    />
  );
}
