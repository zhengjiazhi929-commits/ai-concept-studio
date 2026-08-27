import React from "react";
import { Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

import { VISUAL_SYSTEM_V1_AI_WATERMARK_PROOF } from "../../visual-system-v1-ai-watermark-proof-plan.mjs";
import {
  AI_CUBE_FACES,
  AI_WATERMARK_EXTRUSION_LAYERS,
  VISUAL_SYSTEM_V1_AI_WATERMARK,
  aiCubeFaceVisibilityAtFrame,
  aiExtrusionLayerState,
  aiWatermarkMotionAtFrame,
  visualSystemV1AiWatermarkProfile,
  visualSystemV1AiWatermarkGeometry,
  visualSystemV1AiWatermarkScale
} from "./ai-watermark.mjs";

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
      data-ai-watermark-extrusion-layer={index}
      viewBox="0 0 368 240"
      width={cube.glyphWidthPx}
      height={cube.glyphHeightPx}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
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
  const faceGradientId = `visual-system-ai-face-gradient-${faceId}`;
  const shineGradientId = `visual-system-ai-face-shine-${faceId}`;
  return (
    <svg
      role="img"
      aria-label="AI"
      data-ai-watermark-glyph-front={faceId}
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
        data-ai-watermark-a-front-base="single-compound-surface"
        fill={`url(#${faceGradientId})`}
      />
      <AiIPath fill={`url(#${faceGradientId})`} />
      <AiACompoundPath
        data-ai-watermark-a-front-shine="single-compound-surface"
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
      data-ai-watermark-cube-face={face.id}
      data-ai-watermark-face-visible={faceVisibility.visible ? "true" : "false"}
      data-ai-watermark-extrusion-layers={faceVisibility.extrusionLayerCount}
      data-ai-watermark-extrusion-progress={faceVisibility.extrusionProgress}
      data-ai-watermark-extrusion-depth={faceVisibility.extrusionDepthPx}
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
      data-ai-watermark-open-cube="six-extruded-ai-faces"
      data-ai-watermark-motion-phase={motion.phase}
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

export function VisualSystemV1AiWatermarkLiveObject({
  size = VISUAL_SYSTEM_V1_AI_WATERMARK.placement.size
}) {
  const frame = useCurrentFrame();
  const stage = VISUAL_SYSTEM_V1_AI_WATERMARK.referenceStage;
  return (
    <div
      data-ai-watermark-live-object="css-3d-raster-source-only"
      style={{
        position: "relative",
        width: size,
        height: size,
        overflow: "visible"
      }}
    >
      <div
        data-ai-watermark-perspective-stage="true"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: stage.size,
          height: stage.size,
          perspective: stage.perspective,
          perspectiveOrigin: stage.perspectiveOrigin,
          translate: "-50% -50%",
          scale: visualSystemV1AiWatermarkScale(size),
          transformOrigin: "center center",
          transformStyle: "preserve-3d"
        }}
      >
        <AiOpenCube frame={frame} />
      </div>
    </div>
  );
}

function rasterFramePath(frame, profile) {
  const { assetRoot, frameCount } = profile.rasterSequence;
  const cycleFrames = frameCount;
  const cycleFrame = ((Math.trunc(frame) % cycleFrames) + cycleFrames) % cycleFrames;
  return `${assetRoot}/frame-${String(cycleFrame).padStart(3, "0")}.png`;
}

export function VisualSystemV1AiWatermark({
  size = VISUAL_SYSTEM_V1_AI_WATERMARK.placement.size,
  top = VISUAL_SYSTEM_V1_AI_WATERMARK.placement.top,
  right = VISUAL_SYSTEM_V1_AI_WATERMARK.placement.right,
  zIndex = VISUAL_SYSTEM_V1_AI_WATERMARK.placement.zIndex,
  profile = VISUAL_SYSTEM_V1_AI_WATERMARK.defaultProfileId
}) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const resolvedProfile = visualSystemV1AiWatermarkProfile(profile);
  const geometry = visualSystemV1AiWatermarkGeometry(width, height, {
    size,
    top,
    right,
    zIndex
  });
  return (
    <div
      aria-hidden="true"
      data-visual-system-ai-watermark="persistent-six-face-ai"
      data-ai-watermark-size={geometry.width}
      data-ai-watermark-top={geometry.top}
      data-ai-watermark-right={geometry.right}
      data-ai-watermark-profile={resolvedProfile.id}
      data-ai-watermark-approval-status={resolvedProfile.approvalStatus}
      data-ai-watermark-review-only={resolvedProfile.reviewOnly ? "true" : "false"}
      style={{
        position: "absolute",
        top: geometry.top,
        right: geometry.right,
        width: geometry.width,
        height: geometry.height,
        zIndex: geometry.zIndex,
        overflow: "visible",
        pointerEvents: "none"
      }}
    >
      <Img
        data-ai-watermark-raster-sequence={resolvedProfile.rasterSequenceLabel}
        src={staticFile(rasterFramePath(frame, resolvedProfile))}
        style={{
          width: geometry.width,
          height: geometry.height,
          objectFit: "contain"
        }}
      />
    </div>
  );
}
