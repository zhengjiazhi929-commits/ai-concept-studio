import React from "react";
import { AbsoluteFill, CanvasImage, staticFile } from "remotion";

import {
  agentSkillLongBackgroundMotionAtFrame,
  agentSkillLongSoftGradientMotionAtFrame
} from "./agent-skill-long-background-motion.mjs";

const PAPER = "#F4F6F3";

export const AGENT_SKILL_LONG_BACKGROUND_VARIANTS = Object.freeze({
  paper: "paper",
  blurredMaterial: "blurred-material",
  blurredMaterialMovingGlow: "blurred-material-moving-glow",
  softGradient: "soft-gradient",
  softGradientMoving: "soft-gradient-moving"
});

function GridBackdrop({ opacity = 0.25 }) {
  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundImage:
          "linear-gradient(rgba(78,96,89,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(78,96,89,0.08) 1px, transparent 1px)",
        backgroundSize: "36px 36px"
      }}
    />
  );
}

function MovingSoftGlow({ frame, fps }) {
  const motion = agentSkillLongBackgroundMotionAtFrame(frame, fps);
  return (
    <AbsoluteFill data-background-moving-soft-glow="subtle-25s">
      <div
        style={{
          position: "absolute",
          inset: -72,
          opacity: 0.22,
          scale: 1.03,
          translate: `${motion.x}px ${motion.y}px`,
          backgroundImage:
            "radial-gradient(ellipse 68% 44% at 50% 38%, rgba(255,255,255,0.24) 0%, rgba(223,246,238,0.12) 40%, rgba(232,237,255,0.05) 58%, transparent 76%)",
          willChange: "translate",
          backfaceVisibility: "hidden"
        }}
      />
    </AbsoluteFill>
  );
}

function BlurredMaterialBackdrop({ material, movingGlow, frame, fps }) {
  if (!material) throw new Error("模糊素材背景缺少 material 路径");
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: PAPER }} />
      <CanvasImage
        src={staticFile(material)}
        style={{
          position: "absolute",
          inset: -38,
          width: 616,
          height: 1036,
          objectFit: "cover",
          opacity: 0.18,
          filter: "blur(22px) saturate(0.72) contrast(0.9)",
          scale: 1.08
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(244,246,243,0.24) 0%, rgba(244,246,243,0.44) 52%, rgba(244,246,243,0.7) 100%)"
        }}
      />
      {movingGlow ? <MovingSoftGlow frame={frame} fps={fps} /> : null}
      <GridBackdrop opacity={0.16} />
    </>
  );
}

const softGradientLayers = Object.freeze([
  Object.freeze({
    id: "purple",
    backgroundImage:
      "radial-gradient(ellipse 60% 46% at 50% 50%, rgba(118,91,216,0.18) 0%, rgba(118,91,216,0.06) 48%, transparent 76%)"
  }),
  Object.freeze({
    id: "mint",
    backgroundImage:
      "radial-gradient(ellipse 58% 50% at 50% 50%, rgba(71,196,161,0.16) 0%, rgba(71,196,161,0.05) 50%, transparent 78%)"
  }),
  Object.freeze({
    id: "orange",
    backgroundImage:
      "radial-gradient(ellipse 58% 42% at 50% 50%, rgba(242,120,58,0.13) 0%, rgba(242,120,58,0.04) 52%, transparent 80%)"
  })
]);

function MovingSoftGradientBackdrop({ frame, fps }) {
  const motion = agentSkillLongSoftGradientMotionAtFrame(frame, fps);
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: PAPER }} />
      <AbsoluteFill
        data-background-moving-soft-gradient="three-color-swap-25s"
        style={{ overflow: "hidden" }}
      >
        {softGradientLayers.map((layer) => (
          <div
            key={layer.id}
            data-soft-gradient-layer={layer.id}
            style={{
              position: "absolute",
              inset: 0,
              translate: `${motion[layer.id].x}px ${motion[layer.id].y}px`,
              willChange: "translate",
              backfaceVisibility: "hidden"
            }}
          >
            <div
              data-soft-gradient-blob={layer.id}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 640,
                height: 640,
                opacity: 0.78,
                backgroundImage: layer.backgroundImage,
                filter: "blur(10px)",
                translate: "-50% -50%",
                scale: motion[layer.id].scale,
                willChange: "scale",
                backfaceVisibility: "hidden"
              }}
            />
          </div>
        ))}
      </AbsoluteFill>
      <GridBackdrop opacity={0.2} />
    </>
  );
}

export function AgentSkillLongBackdrop({
  variant = AGENT_SKILL_LONG_BACKGROUND_VARIANTS.paper,
  material = null,
  frame = 0,
  fps = 30
}) {
  if (
    variant === AGENT_SKILL_LONG_BACKGROUND_VARIANTS.blurredMaterial ||
    variant === AGENT_SKILL_LONG_BACKGROUND_VARIANTS.blurredMaterialMovingGlow
  ) {
    return (
      <BlurredMaterialBackdrop
        material={material}
        movingGlow={variant === AGENT_SKILL_LONG_BACKGROUND_VARIANTS.blurredMaterialMovingGlow}
        frame={frame}
        fps={fps}
      />
    );
  }

  if (variant === AGENT_SKILL_LONG_BACKGROUND_VARIANTS.softGradient) {
    return (
      <>
        <AbsoluteFill style={{ backgroundColor: PAPER }} />
        <AbsoluteFill
          style={{
            opacity: 0.78,
            backgroundImage: [
              "radial-gradient(ellipse 72% 46% at 84% 18%, rgba(118,91,216,0.18) 0%, rgba(118,91,216,0.06) 48%, transparent 76%)",
              "radial-gradient(ellipse 68% 50% at 8% 52%, rgba(71,196,161,0.16) 0%, rgba(71,196,161,0.05) 50%, transparent 78%)",
              "radial-gradient(ellipse 58% 42% at 76% 88%, rgba(242,120,58,0.13) 0%, rgba(242,120,58,0.04) 52%, transparent 80%)"
            ].join(", "),
            filter: "blur(10px)",
            scale: 1.05
          }}
        />
        <GridBackdrop opacity={0.2} />
      </>
    );
  }

  if (variant === AGENT_SKILL_LONG_BACKGROUND_VARIANTS.softGradientMoving) {
    return <MovingSoftGradientBackdrop frame={frame} fps={fps} />;
  }

  return (
    <>
      <AbsoluteFill style={{ backgroundColor: PAPER }} />
      <GridBackdrop />
    </>
  );
}
