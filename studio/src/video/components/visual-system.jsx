import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import visualSystem from "../../../config/visual-system.json";
import { VIDEO_SANS_FONT_FAMILY } from "../font-system.mjs";

const fontFamily = VIDEO_SANS_FONT_FAMILY;

export const visualColors = visualSystem.colors;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function stageWindowMotion(frame, start, end, vertical = false) {
  const motion = visualSystem.motion.stageManager;
  const enterCurve = Easing.bezier(...motion.enterCurve);
  const exitCurve = Easing.bezier(...motion.exitCurve);
  const enter = interpolate(frame, [start, start + motion.enterFrames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: enterCurve
  });
  const exit = interpolate(frame, [end - motion.exitFrames, end - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: exitCurve
  });
  const entering = frame < start + motion.enterFrames;
  const exiting = frame >= end - motion.exitFrames;
  const enterLift = vertical ? motion.enterLiftPxVertical : motion.enterLiftPxWide;
  const exitLift = vertical ? motion.exitLiftPxVertical : motion.exitLiftPxWide;
  const scale = exiting
    ? interpolate(exit, [0, 1], [1, motion.exitScale])
    : entering
      ? interpolate(enter, [0, 1], [motion.enterScale, 1])
      : 1;
  const opacity = exiting
    ? interpolate(exit, [0, 0.72, 1], [1, 0.96, 0.08])
    : entering
      ? interpolate(enter, [0, 0.12, 1], [0.08, 0.34, 1])
      : 1;
  const translateY = exiting
    ? interpolate(exit, [0, 1], [0, exitLift])
    : entering
      ? interpolate(enter, [0, 1], [enterLift, 0])
      : 0;

  return {
    visible: frame >= start && frame < end,
    enter,
    exit,
    phase: exiting ? "exiting" : entering ? "entering" : "settled",
    zIndex: 1,
    scale,
    translateX: 0,
    translateY,
    opacity: clamp(opacity)
  };
}

export function WallpaperStage() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = Math.sin((frame / fps / visualSystem.wallpaper.driftPeriodSeconds) * Math.PI * 2);

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: visualSystem.wallpaper.base }}>
      <Img
        src={staticFile("assets/visual-system-v1/wallpaper-v1.png")}
        style={{
          width: "103%",
          height: "103%",
          objectFit: "cover",
          objectPosition: "center",
          transform: `translate(${drift * 0.45}%, ${drift * -0.25}%) scale(1.015)`,
          filter: "saturate(0.78) brightness(1.36) contrast(0.74)"
        }}
      />
      <AbsoluteFill
        style={{
          backgroundColor: "rgba(247,249,252,0.28)"
        }}
      />
    </AbsoluteFill>
  );
}

export function ChapterLabel() {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <div
      style={{
        position: "absolute",
        top: vertical ? 48 : 26,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: vertical ? 14 : 10,
        width: "fit-content",
        height: vertical ? 58 : 52,
        margin: "0 auto",
        padding: vertical ? "0 24px" : "0 20px",
        zIndex: 3,
        border: "1px solid rgba(255,255,255,0.72)",
        borderRadius: 999,
        backgroundColor: "rgba(255,255,255,0.54)",
        boxShadow: "0 12px 34px rgba(67,86,120,0.12), inset 0 1px 0 rgba(255,255,255,0.78)",
        backdropFilter: "blur(18px) saturate(118%)",
        color: visualSystem.chapterLabel.color,
        fontFamily,
        fontSize: vertical ? 32 : 27,
        fontWeight: 550,
        textShadow: "0 1px 0 rgba(255,255,255,0.8)"
      }}
    >
      <span
        style={{
          width: vertical ? 12 : 9,
          height: vertical ? 12 : 9,
          borderRadius: "50%",
          backgroundColor: visualSystem.chapterLabel.dotColor,
          boxShadow: "0 0 12px rgba(47,127,247,0.24)"
        }}
      />
      <span>Agentic Coding</span>
      <span
        style={{
          width: vertical ? 12 : 9,
          height: vertical ? 12 : 9,
          borderRadius: "50%",
          backgroundColor: visualSystem.chapterLabel.dotColor,
          boxShadow: "0 0 12px rgba(47,127,247,0.24)"
        }}
      />
    </div>
  );
}

export function PlainSubtitle({ text, opacity = 1 }) {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <div
      style={{
        position: "absolute",
        left: vertical ? 54 : 260,
        right: vertical ? 54 : 260,
        bottom: vertical ? 34 : 28,
        display: "flex",
        justifyContent: "center",
        zIndex: 2,
        opacity,
        color: visualSystem.subtitle.color,
        fontFamily,
        fontSize: vertical ? 42 : 40,
        fontWeight: 700,
        lineHeight: 1.28,
        letterSpacing: "-0.025em",
        textAlign: "center",
        textShadow: visualSystem.subtitle.textShadow
      }}
    >
      {text}
    </div>
  );
}

export function EvidenceTag({ kind = "证据", text }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        minHeight: 38,
        padding: "0 14px",
        border: `1px solid ${visualColors.line}`,
        borderRadius: 9,
        backgroundColor: visualSystem.evidenceTag.background,
        color: visualColors.ink,
        fontFamily,
        fontSize: 18,
        fontWeight: 680,
        boxShadow: "0 10px 26px rgba(52,72,105,0.12)"
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          backgroundColor: visualSystem.evidenceTag.dot
        }}
      />
      <span>{kind}｜{text}</span>
    </div>
  );
}

export function ContentWindow({ motion, children, title = "" }) {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const geometry = vertical
    ? {
        left: visualSystem.window.vertical.x,
        top: visualSystem.window.vertical.y,
        windowWidth: visualSystem.window.vertical.width,
        windowHeight: visualSystem.window.vertical.height,
        radius: visualSystem.window.vertical.borderRadius,
        topBarHeight: visualSystem.window.vertical.topBarHeight
      }
    : {
        left: visualSystem.window.x,
        top: visualSystem.window.y,
        windowWidth: visualSystem.window.width,
        windowHeight: visualSystem.window.height,
        radius: visualSystem.window.borderRadius,
        topBarHeight: visualSystem.window.topBarHeight
      };
  if (!motion?.visible || motion.opacity <= 0.001) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: geometry.left,
        top: geometry.top,
        width: geometry.windowWidth,
        height: geometry.windowHeight,
        overflow: "hidden",
        borderRadius: geometry.radius,
        border: visualSystem.window.borderWidth + "px solid " + visualSystem.window.border,
        backgroundColor: visualColors.canvas,
        boxShadow: visualSystem.window.shadow,
        transformOrigin: "50% 50%",
        transform: `translate3d(${motion.translateX}px, ${motion.translateY}px, 0) scale(${motion.scale})`,
        opacity: motion.opacity,
        zIndex: motion.zIndex,
        willChange: "transform, opacity",
        fontFamily
      }}
    >
      <div
        style={{
          height: geometry.topBarHeight,
          display: "flex",
          alignItems: "center",
          padding: vertical ? "0 28px" : "0 22px",
          borderBottom: `1px solid ${visualColors.line}`,
          backgroundColor: visualSystem.window.chromeBackground
        }}
      >
        <div style={{ display: "flex", gap: vertical ? 12 : 9 }}>
          {["#FF5F57", "#FEBB2E", "#28C840"].map((color) => (
            <span
              key={color}
              style={{
                width: vertical ? 15 : 12,
                height: vertical ? 15 : 12,
                borderRadius: "50%",
                backgroundColor: color
              }}
            />
          ))}
        </div>
        {title ? (
          <div
            style={{
              marginLeft: vertical ? 28 : 22,
              color: visualColors.muted,
              fontSize: vertical ? 19 : 15,
              fontWeight: 620
            }}
          >
            {title}
          </div>
        ) : null}
      </div>
      <div style={{ position: "absolute", inset: `${geometry.topBarHeight}px 0 0` }}>
        {children}
      </div>
    </div>
  );
}

export function FadeIn({ start, duration = 8, children, style = {} }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic)
  });
  const rise = interpolate(opacity, [0, 1], [10, 0]);
  return <div style={{ ...style, opacity, transform: `translateY(${rise}px)` }}>{children}</div>;
}
