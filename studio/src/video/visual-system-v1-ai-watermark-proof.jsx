import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

import {
  AI_CUBE_FACES,
  AI_WATERMARK_EXTRUSION_LAYERS,
  VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF,
  aiCubeFaceVisibilityAtFrame,
  aiExtrusionLayerState,
  aiWatermarkMotionAtFrame
} from "./visual-system-v1-ai-watermark-proof-plan.mjs";

const { cube, palette } = VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF;

function AiAPaths() {
  return (
    <>
      <path d="M96 22H126L66 218H18Z" />
      <path d="M96 22H126L206 218H158Z" />
      <path d="M68 137H152L166 174H55Z" />
    </>
  );
}

function AiACompoundPath(props) {
  return (
    <path
      d="M96 22H126L66 218H18Z M96 22H126L206 218H158Z M68 137H152L166 174H55Z"
      fillRule="nonzero"
      {...props}
    />
  );
}

function AiIPath(props) {
  return (
    <path
      d="M232 22H350V64H313V176H350V218H232V176H269V64H232Z"
      {...props}
    />
  );
}

function AiGlyphPaths() {
  return (
    <>
      <AiAPaths />
      <AiIPath />
    </>
  );
}

function AiGlyphLayer({ color, depthPx, index, opacity }) {
  return (
    <svg
      aria-hidden="true"
      data-ai-extrusion-layer={index}
      viewBox="0 0 368 240"
      width={cube.glyphWidthPx}
      height={cube.glyphHeightPx}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "visible",
        transform: `translateZ(${depthPx}px)`,
        opacity,
        transformStyle: "preserve-3d",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden"
      }}
      shapeRendering="geometricPrecision"
    >
      <g fill={color}>
        <AiGlyphPaths />
      </g>
    </svg>
  );
}

function AiGlyphFront({ faceId }) {
  const faceGradientId = `ai-face-gradient-${faceId}`;
  const shineGradientId = `ai-face-shine-${faceId}`;
  return (
    <svg
      role="img"
      aria-label="AI"
      data-ai-glyph-front={faceId}
      viewBox="0 0 368 240"
      width={cube.glyphWidthPx}
      height={cube.glyphHeightPx}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "visible",
        transform: "translateZ(1px)",
        transformStyle: "preserve-3d",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden"
      }}
      shapeRendering="geometricPrecision"
    >
      <defs>
        <linearGradient id={faceGradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette.mintFaceLight} />
          <stop offset="0.46" stopColor={palette.mintFace} />
          <stop offset="1" stopColor={palette.mintFaceDeep} />
        </linearGradient>
        <linearGradient id={shineGradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.7" />
          <stop offset="0.3" stopColor="#FFFFFF" stopOpacity="0.12" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <AiACompoundPath
        data-ai-a-front-base="single-compound-surface"
        fill={`url(#${faceGradientId})`}
      />
      <AiIPath fill={`url(#${faceGradientId})`} />
      <AiACompoundPath
        data-ai-a-front-shine="single-compound-surface"
        fill={`url(#${shineGradientId})`}
        opacity="0.48"
      />
      <AiIPath fill={`url(#${shineGradientId})`} opacity="0.48" />
    </svg>
  );
}

function AiExtrudedFace({ face, frame }) {
  const orientation = `rotate${face.axis.toUpperCase()}(${face.degrees}deg)`;
  const faceVisibility = aiCubeFaceVisibilityAtFrame(frame, face);
  const continuousExtrusionLayers = AI_WATERMARK_EXTRUSION_LAYERS.map((layer) => ({
    ...layer,
    ...aiExtrusionLayerState(layer, faceVisibility.extrusionProgress)
  }));
  return (
    <div
      data-ai-cube-face={face.id}
      data-ai-face-normal={face.normal.join(",")}
      data-ai-face-visible={faceVisibility.visible ? "true" : "false"}
      data-ai-extrusion-layers={faceVisibility.extrusionLayerCount}
      data-ai-extrusion-progress={faceVisibility.extrusionProgress}
      data-ai-extrusion-depth={faceVisibility.extrusionDepthPx}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 0,
        height: 0,
        transform: orientation,
        transformStyle: "preserve-3d",
        transformOrigin: "0 0 0",
        visibility: faceVisibility.visible ? "visible" : "hidden",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden"
      }}
    >
      <div
        style={{
          position: "absolute",
          left: -cube.glyphWidthPx / 2,
          top: -cube.glyphHeightPx / 2,
          width: cube.glyphWidthPx,
          height: cube.glyphHeightPx,
          transform: `translateZ(${cube.halfSizePx}px)`,
          transformStyle: "preserve-3d",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden"
        }}
      >
        {continuousExtrusionLayers.map((layer) => (
          <AiGlyphLayer key={layer.index} {...layer} />
        ))}
        <AiGlyphFront faceId={face.id} />
      </div>
    </div>
  );
}

function AiOpenCube({ frame }) {
  const motion = aiWatermarkMotionAtFrame(frame);
  return (
    <div
      data-ai-open-cube="six-extruded-ai-faces"
      data-ai-motion-phase={motion.phase}
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: 0,
        height: 0,
        transform: `rotateZ(${motion.rotateZ}deg)`,
        transformStyle: "preserve-3d"
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: `rotateX(${motion.rotateX}deg)`,
          transformStyle: "preserve-3d"
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            transform: `rotateY(${motion.rotateY}deg)`,
            transformStyle: "preserve-3d"
          }}
        >
          {AI_CUBE_FACES.map((face) => (
            <AiExtrudedFace key={face.id} face={face} frame={frame} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProofBackground() {
  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        backgroundColor: palette.paper,
        backgroundImage:
          "radial-gradient(circle at 50% 44%, rgba(88,202,161,.13) 0%, rgba(88,202,161,.055) 24%, rgba(88,202,161,0) 54%), radial-gradient(circle at 73% 68%, rgba(128,103,217,.07) 0%, rgba(128,103,217,0) 34%)"
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.22,
          backgroundImage: "radial-gradient(rgba(23,121,93,.13) .7px, transparent .7px)",
          backgroundSize: "24px 24px"
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 205,
          top: 462,
          width: 230,
          height: 30,
          borderRadius: "50%",
          background: "rgba(23,89,68,.10)",
          filter: "blur(18px)"
        }}
      />
    </AbsoluteFill>
  );
}

export function VisualSystemV1AiWatermarkMotionProof() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <ProofBackground />
      <div
        data-ai-perspective-stage="true"
        style={{
          position: "absolute",
          left: 60,
          top: 60,
          width: 520,
          height: 520,
          perspective: 780,
          perspectiveOrigin: "50% 46%",
          transformStyle: "preserve-3d"
        }}
      >
        <AiOpenCube frame={frame} />
      </div>
    </AbsoluteFill>
  );
}
