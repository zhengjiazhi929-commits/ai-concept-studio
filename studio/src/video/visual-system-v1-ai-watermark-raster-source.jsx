import React from "react";
import { AbsoluteFill } from "remotion";

import { VisualSystemV1AiWatermarkLiveObject } from "./components/visual-system-v1/ai-watermark.jsx";

export function VisualSystemV1AiWatermarkRasterSource() {
  return (
    <AbsoluteFill
      data-ai-watermark-raster-source="transparent-120px"
      style={{
        backgroundColor: "transparent",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      <VisualSystemV1AiWatermarkLiveObject size={120} />
    </AbsoluteFill>
  );
}
