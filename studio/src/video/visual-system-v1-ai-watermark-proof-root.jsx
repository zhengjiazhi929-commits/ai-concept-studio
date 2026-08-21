import React from "react";
import { Composition } from "remotion";

import { VisualSystemV1AiWatermarkMotionProof } from "./visual-system-v1-ai-watermark-proof.jsx";
import { VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF } from "./visual-system-v1-ai-watermark-proof-plan.mjs";

export function VisualSystemV1AiWatermarkMotionProofRoot() {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF;
  return (
    <Composition
      id={contract.compositionId}
      component={VisualSystemV1AiWatermarkMotionProof}
      durationInFrames={contract.durationInFrames}
      fps={contract.fps}
      width={contract.width}
      height={contract.height}
    />
  );
}
