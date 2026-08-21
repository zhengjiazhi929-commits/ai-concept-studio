import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

import { visualSystemV1Layout } from "./layout.mjs";
import {
  visualSystemV1ChapterProgressAtFrame,
  visualSystemV1ConnectorMotionAtFrame,
  visualSystemV1DepthMotionAtFrame,
  visualSystemV1SceneOpacityAtFrame,
  visualSystemV1SpringMotionAtFrame,
  visualSystemV1TextMotionAtFrame,
  visualSystemV1WallpaperMotionAtFrame
} from "./motion.mjs";
import { VISUAL_SYSTEM_V1, VISUAL_SYSTEM_V1_DEPTH_ROLES } from "./tokens.mjs";

const { palette, typography } = VISUAL_SYSTEM_V1;

function assertDepthRole(role) {
  if (!VISUAL_SYSTEM_V1_DEPTH_ROLES.includes(role)) {
    throw new Error(`visual-system-v1 不允许浅立体角色：${role}`);
  }
}

export function VisualSystemV1Canvas({ children }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const wallpaper = visualSystemV1WallpaperMotionAtFrame(frame, width, height, fps);
  return (
    <AbsoluteFill
      data-visual-system="visual-system-v1"
      style={{
        overflow: "hidden",
        backgroundColor: palette.paper,
        color: palette.ink,
        fontFamily: typography.fontFamily
      }}
    >
      <div
        data-visual-system-wallpaper="mint-primary"
        style={{
          position: "absolute",
          width: width * 0.72,
          height: height * 0.72,
          left: width * -0.18,
          top: height * -0.22,
          borderRadius: "50%",
          opacity: VISUAL_SYSTEM_V1.wallpaper.mintOpacity,
          background: `radial-gradient(ellipse at center, ${palette.mintSoft} 0%, rgba(216,243,232,.64) 38%, rgba(216,243,232,0) 74%)`,
          filter: `blur(${VISUAL_SYSTEM_V1.wallpaper.blurPx}px)`,
          translate: `${wallpaper.mint.x}px ${wallpaper.mint.y}px`,
          willChange: "translate"
        }}
      />
      <div
        data-visual-system-wallpaper="purple-secondary"
        style={{
          position: "absolute",
          width: width * 0.42,
          height: height * 0.46,
          right: width * -0.1,
          bottom: height * -0.12,
          borderRadius: "50%",
          opacity: VISUAL_SYSTEM_V1.wallpaper.purpleOpacity,
          background: `radial-gradient(ellipse at center, ${palette.purpleSoft} 0%, rgba(232,224,255,.52) 42%, rgba(232,224,255,0) 76%)`,
          filter: `blur(${VISUAL_SYSTEM_V1.wallpaper.blurPx}px)`,
          translate: `${wallpaper.purple.x}px ${wallpaper.purple.y}px`,
          willChange: "translate"
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

export function VisualSystemV1OpenCanvasHeader({ title = "VISUAL SYSTEM V1" }) {
  return (
    <div
      data-visual-system-header="open-canvas"
      style={{
        position: "absolute",
        left: 90,
        right: 90,
        top: 42,
        height: 54,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: `1px solid ${palette.line}`,
        color: palette.mintDeep,
        fontSize: 16,
        fontWeight: 820,
        letterSpacing: ".12em"
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: palette.mint }} />
        {title}
      </span>
      <span style={{ color: palette.muted, letterSpacing: ".06em" }}>
        WIDE · OPEN CANVAS · FLAT DEFAULT
      </span>
    </div>
  );
}

export function VisualSystemV1SingleContentWindow({
  title = "VISUAL SYSTEM V1",
  opacity = 1,
  children
}) {
  const { width, height } = useVideoConfig();
  const layout = visualSystemV1Layout(width, height);
  const geometry = layout.window;
  return (
    <div
      data-visual-system-window="single-content-window"
      style={{
        position: "absolute",
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
        overflow: "hidden",
        borderRadius: geometry.borderRadius,
        border: `1px solid ${VISUAL_SYSTEM_V1.window.border}`,
        backgroundColor: palette.window,
        boxShadow: VISUAL_SYSTEM_V1.window.shadow,
        backdropFilter: "blur(22px) saturate(112%)",
        opacity
      }}
    >
      <div
        style={{
          height: geometry.topBarHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: layout.vertical ? "0 30px" : "0 26px",
          boxSizing: "border-box",
          borderBottom: `1px solid ${palette.line}`,
          backgroundColor: palette.windowChrome,
          color: palette.mintDeep,
          fontSize: layout.vertical ? 18 : 16,
          fontWeight: 820,
          letterSpacing: ".12em"
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: palette.mint }} />
          {title}
        </span>
        <span style={{ color: palette.muted, letterSpacing: ".06em" }}>
          FLAT DEFAULT · DEPTH OPTIONAL
        </span>
      </div>
      <div style={{ position: "absolute", inset: `${geometry.topBarHeight}px 0 0` }}>
        {children}
      </div>
    </div>
  );
}

export function VisualSystemV1PopText({ startFrame, children, style = {}, as = "div" }) {
  const frame = useCurrentFrame();
  const state = visualSystemV1TextMotionAtFrame(frame, startFrame);
  const Tag = as;
  return (
    <Tag
      data-visual-system-motion="text-pop-12f"
      style={{
        ...style,
        opacity: state.opacity,
        translate: `0 ${state.translateY}px`,
        scale: state.scale,
        transformOrigin: "left center"
      }}
    >
      {children}
    </Tag>
  );
}

export function VisualSystemV1SceneLayer({ startFrame, endFrame, children, style = {} }) {
  const frame = useCurrentFrame();
  const opacity = visualSystemV1SceneOpacityAtFrame(frame, { startFrame, endFrame });
  if (opacity <= 0.0001) return null;
  return (
    <div
      data-visual-system-motion="scene-fade-8f"
      style={{ position: "absolute", inset: 0, ...style, opacity }}
    >
      {children}
    </div>
  );
}

export function VisualSystemV1FlatNode({
  label,
  detail,
  startFrame,
  style = {},
  marker = null,
  accent = "mint"
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const state = visualSystemV1SpringMotionAtFrame(frame, startFrame, fps);
  const accentColor = accent === "purple" ? palette.purpleDeep : palette.mintDeep;
  const dotColor = accent === "purple" ? palette.purple : palette.mint;
  return (
    <div
      data-visual-system-surface="flat"
      style={{
        position: "absolute",
        boxSizing: "border-box",
        border: `1px solid ${palette.line}`,
        borderRadius: 18,
        backgroundColor: "rgba(252, 254, 252, 0.72)",
        backgroundImage: "none",
        boxShadow: "none",
        filter: "none",
        padding: "20px 24px",
        ...style,
        opacity: state.opacity,
        translate: `0 ${state.translateY}px`,
        scale: state.scale,
        transformOrigin: "center center"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: dotColor }} />
        {marker ? (
          <span style={{ color: accentColor, fontSize: 13, fontWeight: 900, letterSpacing: ".1em" }}>
            {marker}
          </span>
        ) : null}
      </div>
      <div style={{ marginTop: 13, color: palette.ink, fontSize: 28, fontWeight: 860, letterSpacing: "-.025em" }}>
        {label}
      </div>
      {detail ? (
        <div style={{ marginTop: 7, color: palette.muted, fontSize: 18, fontWeight: 620, lineHeight: 1.35 }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function VisualSystemV1ShallowDepthObject({
  role,
  label,
  detail,
  eyebrow,
  startFrame,
  hover = false,
  secondary = false,
  style = {}
}) {
  assertDepthRole(role);
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const state = visualSystemV1DepthMotionAtFrame(frame, startFrame, { fps, hover });
  const face = secondary ? palette.purpleSoft : palette.mintSoft;
  const side = secondary ? palette.purpleSide : palette.mintSide;
  const ink = secondary ? palette.purpleDeep : palette.mintDeep;
  return (
    <div
      data-visual-system-surface="shallow-depth"
      data-visual-system-depth-role={role}
      style={{
        position: "absolute",
        ...style,
        opacity: state.opacity,
        translate: `0 ${state.translateY}px`,
        scale: state.scale,
        transformOrigin: "center center"
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 14,
          right: 14,
          bottom: -12,
          height: 20,
          borderRadius: "50%",
          backgroundColor: secondary ? "rgba(91,69,170,.18)" : "rgba(23,121,93,.18)",
          filter: "blur(10px)",
          opacity: 0.44 + state.progress * 0.3,
          translate: `0 ${state.hoverProgress * -1}px`
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 22,
          backgroundColor: side,
          border: `1px solid ${secondary ? "rgba(91,69,170,.22)" : "rgba(23,121,93,.22)"}`,
          translate: `0 ${state.depthPx}px`
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          boxSizing: "border-box",
          borderRadius: 22,
          border: `1px solid ${secondary ? "rgba(91,69,170,.25)" : "rgba(23,121,93,.27)"}`,
          background: `linear-gradient(145deg, rgba(255,255,255,.78), ${face})`,
          boxShadow: `inset 0 1px 0 ${palette.whiteHighlight}, ${VISUAL_SYSTEM_V1.depth.surfaceShadow}`,
          padding: "22px 24px"
        }}
      >
        <div style={{ color: ink, fontSize: 13, fontWeight: 900, letterSpacing: ".12em" }}>
          {eyebrow}
        </div>
        <div style={{ marginTop: 15, color: palette.ink, fontSize: 30, fontWeight: 900, letterSpacing: "-.03em" }}>
          {label}
        </div>
        {detail ? (
          <div style={{ marginTop: 8, color: secondary ? "#6F6395" : palette.muted, fontSize: 18, fontWeight: 650, lineHeight: 1.35 }}>
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function VisualSystemV1ActiveNode(props) {
  return (
    <VisualSystemV1ShallowDepthObject
      {...props}
      role="active-node"
      eyebrow={props.eyebrow ?? "ACTIVE NODE"}
    />
  );
}

export function VisualSystemV1KeyResult(props) {
  return (
    <VisualSystemV1ShallowDepthObject
      {...props}
      role="key-result"
      eyebrow={props.eyebrow ?? "KEY RESULT"}
    />
  );
}

export function VisualSystemV1HumanConfirmation(props) {
  return (
    <VisualSystemV1ShallowDepthObject
      {...props}
      role="human-confirmation"
      eyebrow={props.eyebrow ?? "HUMAN GATE"}
      secondary
    />
  );
}

function arrowPoints(x, y, orientation) {
  if (orientation === "vertical") {
    return `${x},${y} ${x - 7},${y - 12} ${x + 7},${y - 12}`;
  }
  return `${x},${y} ${x - 12},${y - 7} ${x - 12},${y + 7}`;
}

export function VisualSystemV1DirectedConnector({
  from,
  to,
  startFrame,
  orientation = "horizontal",
  canvasWidth = 1000,
  canvasHeight = 1000,
  style = {}
}) {
  const frame = useCurrentFrame();
  const state = visualSystemV1ConnectorMotionAtFrame(frame, startFrame);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return (
    <svg
      data-visual-system-surface="flat"
      data-visual-system-connector="directed"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none", ...style }}
    >
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        pathLength={1}
        stroke={palette.mintDeep}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={1}
        strokeDashoffset={state.dashOffset}
        opacity={state.opacity}
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={arrowPoints(to.x, to.y, orientation)}
        fill={palette.mintDeep}
        opacity={state.arrowOpacity}
      />
      <circle
        cx={from.x}
        cy={from.y}
        r={length > 0 ? 4 : 0}
        fill={palette.mint}
        opacity={state.opacity}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function VisualSystemV1ChapterProgress({ chapters }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const layout = visualSystemV1Layout(width, height);
  const state = visualSystemV1ChapterProgressAtFrame(frame, chapters);
  const columns = chapters
    .map((chapter) => `${chapter.endFrame - chapter.startFrame}fr`)
    .join(" ");
  return (
    <div
      data-visual-system-chapter-progress="segmented"
      style={{
        position: "absolute",
        left: layout.vertical ? 54 : 90,
        right: layout.vertical ? 54 : 90,
        bottom: layout.vertical ? 18 : 16,
        zIndex: 8,
        display: "grid",
        gridTemplateColumns: columns,
        gap: layout.vertical ? 8 : 15
      }}
    >
      {chapters.map((chapter, index) => {
        const segment = state.segments[index];
        return (
          <div key={chapter.id} data-chapter-id={chapter.id} data-chapter-status={segment.status}>
            <div
              style={{
                marginBottom: layout.vertical ? 7 : 8,
                color: palette.muted,
                fontSize: layout.vertical ? 13 : 17,
                fontWeight: 600,
                lineHeight: "22px",
                letterSpacing: ".02em",
                whiteSpace: "nowrap"
              }}
            >
              {String(index + 1).padStart(2, "0")} · {chapter.label}
            </div>
            <div
              style={{
                height: 6,
                overflow: "hidden",
                borderRadius: 999,
                backgroundColor: "rgba(23,121,93,.14)"
              }}
            >
              <div
                data-chapter-progress={segment.progress}
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "inherit",
                  backgroundColor: palette.mint,
                  opacity: 1,
                  scale: `${segment.progress} 1`,
                  transformOrigin: "left center"
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function VisualSystemV1PlainSubtitle({ captions }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const layout = visualSystemV1Layout(width, height);
  const currentTimeMs = (frame / fps) * 1000;
  const caption = captions.find((item) => currentTimeMs >= item.startMs && currentTimeMs < item.endMs) ?? null;
  if (!caption) return null;
  return (
    <div
      data-visual-system-subtitle="stable-black-no-container"
      style={{
        position: "absolute",
        left: layout.vertical ? 72 : 300,
        right: layout.vertical ? 72 : 300,
        bottom: layout.vertical ? 72 : 92,
        zIndex: 10,
        color: VISUAL_SYSTEM_V1.defaults.subtitleColor,
        fontSize: layout.subtitleFontSize,
        fontWeight: 700,
        lineHeight: typography.subtitleLineHeight,
        letterSpacing: "-.025em",
        textAlign: "center",
        opacity: 1,
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: typography.subtitleMaximumLines,
        overflow: "hidden",
        background: "none",
        textShadow: "none",
        WebkitTextStroke: "0"
      }}
    >
      {caption.text}
    </div>
  );
}
