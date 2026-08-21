import React from "react";
import { Composition } from "remotion";

import { VisualSystemV1AiWatermarkRasterSource } from "./visual-system-v1-ai-watermark-raster-source.jsx";
import { VISUAL_SYSTEM_V1_AI_WATERMARK_RASTER_SOURCE } from "./visual-system-v1-ai-watermark-raster-source-plan.mjs";

export function VisualSystemV1AiWatermarkRasterSourceRoot() {
  const contract = VISUAL_SYSTEM_V1_AI_WATERMARK_RASTER_SOURCE;
  return (
    <Composition
      id={contract.compositionId}
      component={VisualSystemV1AiWatermarkRasterSource}
      width={contract.width}
      height={contract.height}
      fps={contract.fps}
      durationInFrames={contract.durationInFrames}
    />
  );
}
