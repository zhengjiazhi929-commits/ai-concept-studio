import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

import { getMotionLibraryItem } from "./catalog.mjs";
import { seamlessProgress } from "./motion.mjs";
import { MOTION_FONT_FAMILY, MOTION_PALETTE } from "./components/primitives.jsx";
import { MotionLibraryEffect } from "./registry.jsx";

function AmbientWallpaper() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const cycle = seamlessProgress(frame, durationInFrames);
  const angle = cycle * Math.PI * 2;
  const blobs = [
    { left: -125, top: 50, size: 310, color: "rgba(57,185,143,.15)", phase: 0 },
    { left: 770, top: -120, size: 280, color: "rgba(57,185,143,.12)", phase: 2.1 },
    { left: 730, top: 390, size: 255, color: "rgba(128,103,217,.11)", phase: 4.2 }
  ];
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {blobs.map((blob, index) => {
        const x = Math.cos(angle + blob.phase) * 15;
        const y = Math.sin(angle + blob.phase) * 12;
        const scale = 0.94 + (((Math.sin(angle + blob.phase) + 1) / 2) * 0.12);
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: blob.left,
              top: blob.top,
              width: blob.size,
              height: blob.size,
              borderRadius: "50%",
              backgroundColor: blob.color,
              filter: "blur(54px)",
              transform: `translate(${x}px, ${y}px) scale(${scale})`
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

export function MotionLibraryPreview({ effectId }) {
  const item = getMotionLibraryItem(effectId);
  const fullCanvasEffect = item.category === "scene-transition";
  return (
    <AbsoluteFill
      style={{
        backgroundColor: MOTION_PALETTE.paper,
        color: MOTION_PALETTE.ink,
        fontFamily: MOTION_FONT_FAMILY,
        overflow: "hidden"
      }}
    >
      <AmbientWallpaper />
      <div style={{ position: "absolute", zIndex: 2, left: 42, top: 34, right: 42, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: MOTION_PALETTE.mintDeep, fontSize: 13, fontWeight: 850, letterSpacing: ".09em" }}>
            {item.category.toUpperCase()}
          </div>
          <div style={{ marginTop: 7, fontSize: 29, fontWeight: 860, letterSpacing: "-.025em" }}>{item.titleZh}</div>
        </div>
        <div style={{ color: MOTION_PALETTE.muted, fontSize: 13, fontWeight: 720 }}>MOTION · {item.id}</div>
      </div>
      <div style={{ position: "absolute", zIndex: 1, inset: fullCanvasEffect ? 0 : "112px 42px 66px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <MotionLibraryEffect effectId={effectId} previewMode durationInFrames={item.previewDurationInFrames} style={{ width: "100%", height: "100%" }} />
      </div>
      <div style={{ position: "absolute", zIndex: 2, left: 42, right: 42, bottom: 26, height: 1, backgroundColor: "rgba(18,34,29,.12)" }} />
    </AbsoluteFill>
  );
}
