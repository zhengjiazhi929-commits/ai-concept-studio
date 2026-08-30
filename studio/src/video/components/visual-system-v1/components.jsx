import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

import {
  visualSystemV1AdaptiveCardTypography,
  visualSystemV1Layout,
  visualSystemV1SubtitleFontSize
} from "./layout.mjs";
import {
  VISUAL_SYSTEM_V1_INFORMATION_CARD_PRIMITIVES
} from "./grammar-layout.mjs";
import {
  VISUAL_SYSTEM_V1_SEMANTIC_ICON_NODE_DEFAULTS
} from "./content-layout.mjs";
import { visualSystemV1ChapterDisplayLabel } from "./chapter-progress.mjs";
import {
  visualSystemV1ChapterProgressAtFrame,
  visualSystemV1ConnectorMotionAtFrame,
  visualSystemV1DepthMotionAtFrame,
  visualSystemV1SceneOpacityAtFrame,
  visualSystemV1SequentialSceneOpacityAtFrame,
  visualSystemV1SpringMotionAtFrame,
  visualSystemV1TextMotionAtFrame,
  visualSystemV1WallpaperMotionAtFrame
} from "./motion.mjs";
import { VISUAL_SYSTEM_V1, VISUAL_SYSTEM_V1_DEPTH_ROLES } from "./tokens.mjs";
import { VisualSystemV1AiTechIcon } from "./icons/ai-tech-icon.jsx";
import {
  aiTechIconMotionStateAtProgress,
  aiTechIconSize,
  assertAiTechIconProductionPresentation
} from "../../../shared/ai-tech-icon-contract.mjs";

const { palette, typography, semanticNode } = VISUAL_SYSTEM_V1;
const SceneOpacityContext = React.createContext(1);

function colorWithAlpha(color, opacity) {
  const match = typeof color === "string" ? /^#([0-9a-f]{6})$/iu.exec(color) : null;
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function mixHexColors(from, to, progress, alpha = 1) {
  const parse = (color) => {
    const match = /^#([0-9a-f]{6})$/iu.exec(color);
    if (!match) return null;
    const value = Number.parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const fromRgb = parse(from);
  const toRgb = parse(to);
  if (!fromRgb || !toRgb) return from;
  const normalizedProgress = Math.max(0, Math.min(1, progress));
  const mixed = fromRgb.map((channel, index) =>
    Math.round(channel + (toRgb[index] - channel) * normalizedProgress)
  );
  return `rgba(${mixed[0]}, ${mixed[1]}, ${mixed[2]}, ${alpha})`;
}

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
  const sceneOpacity = React.useContext(SceneOpacityContext);
  const state = visualSystemV1TextMotionAtFrame(frame, startFrame);
  if (state.progress <= 0) return null;
  const settled = state.progress >= 1;
  const animatedTop = Number.isFinite(style.top) && !settled
    ? style.top + state.translateY
    : style.top;
  const Tag = as;
  return (
    <Tag
      data-visual-system-motion="text-pop-12f"
      style={{
        ...style,
        top: animatedTop,
        color: colorWithAlpha(style.color, state.opacity * sceneOpacity)
      }}
    >
      {children}
    </Tag>
  );
}

export function VisualSystemV1SceneLayer({
  startFrame,
  endFrame,
  children,
  style = {},
  transitionMode = "crossfade"
}) {
  const frame = useCurrentFrame();
  if (!["crossfade", "sequential-copy"].includes(transitionMode)) {
    throw new TypeError(`未知场景淡化模式：${transitionMode}`);
  }
  const opacity = transitionMode === "sequential-copy"
    ? visualSystemV1SequentialSceneOpacityAtFrame(frame, { startFrame, endFrame })
    : visualSystemV1SceneOpacityAtFrame(frame, { startFrame, endFrame });
  if (opacity <= 0.0001) return null;
  return (
    <SceneOpacityContext.Provider value={opacity}>
      <div
        data-visual-system-motion={
          transitionMode === "sequential-copy"
            ? "scene-copy-sequential-fade-8f"
            : "scene-fade-8f"
        }
        data-scene-opacity={opacity}
        style={{ position: "absolute", inset: 0, ...style }}
      >
        {children}
      </div>
    </SceneOpacityContext.Provider>
  );
}

export function VisualSystemV1FlatNode({
  nodeId = null,
  label,
  detail,
  startFrame,
  style = {},
  marker = null,
  accent = "mint",
  focusProgress = 0,
  layoutMode = "content-sized",
  textWrapMode = "break-word",
  contentOpacity = 1,
  semanticRole = null,
  semanticGroupId = null,
  semanticClaimIds = []
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const state = visualSystemV1SpringMotionAtFrame(frame, startFrame, fps);
  if (state.progress <= 0) return null;
  const settled = state.progress >= 1;
  const animatedTop = Number.isFinite(style.top) && !settled
    ? style.top + state.translateY
    : style.top;
  const accentColor = accent === "purple" ? palette.purpleDeep : palette.mintDeep;
  const dotColor = accent === "purple" ? palette.purple : palette.mint;
  const normalizedFocus = Math.max(0, Math.min(1, focusProgress));
  const focusSurface = accent === "purple" ? palette.purpleSoft : palette.mintSoft;
  const focusBorder = accent === "purple" ? palette.purple : palette.mint;
  const fillsSafeViewport = layoutMode === "fill-safe-viewport";
  if (!fillsSafeViewport && layoutMode !== "content-sized") {
    throw new TypeError(`未知平面卡片布局模式：${layoutMode}`);
  }
  if (!["break-word", "phrase-safe"].includes(textWrapMode)) {
    throw new TypeError(`未知平面卡片断行模式：${textWrapMode}`);
  }
  const phraseSafe = textWrapMode === "phrase-safe";
  const normalizedContentOpacity = Math.max(
    0,
    Math.min(1, Number.isFinite(contentOpacity) ? contentOpacity : 1)
  );
  const cardWidth = Number.isFinite(style.width) ? style.width : 300;
  const cardHeight = Number.isFinite(style.height) ? style.height : 166;
  const paddingX = fillsSafeViewport ? Math.max(24, Math.min(36, cardWidth * 0.08)) : 24;
  const paddingY = fillsSafeViewport ? Math.max(24, Math.min(44, cardHeight * 0.1)) : 20;
  const cardTypography = fillsSafeViewport
    ? visualSystemV1AdaptiveCardTypography(cardWidth, cardHeight)
    : null;
  return (
    <div
      data-visual-system-surface="flat"
      data-visual-system-node-id={nodeId ?? undefined}
      data-visual-system-focus={normalizedFocus >= 0.5 ? "primary" : "context"}
      data-visual-system-focus-progress={normalizedFocus}
      data-visual-system-card-layout={layoutMode}
      data-visual-system-card-typography={cardTypography?.mode ?? "legacy-content-sized"}
      data-visual-system-card-text-wrap={textWrapMode}
      data-visual-system-card-border="full-outline-3px"
      data-semantic-id={nodeId}
      data-semantic-group-id={semanticGroupId ?? undefined}
      data-semantic-role={semanticRole ?? undefined}
      data-semantic-claim-ids={semanticClaimIds.join(",") || undefined}
      data-card-marker-font-size={cardTypography?.markerFontSizePx}
      data-card-label-font-size={cardTypography?.labelFontSizePx}
      data-card-detail-font-size={cardTypography?.detailFontSizePx}
      style={{
        position: "absolute",
        boxSizing: "border-box",
        border: `3px solid ${mixHexColors(palette.lineStrong, focusBorder, normalizedFocus)}`,
        borderRadius: 18,
        backgroundColor: mixHexColors(palette.paperWarm, focusSurface, normalizedFocus, 0.76),
        backgroundImage: "none",
        boxShadow: "none",
        filter: "none",
        ...style,
        top: animatedTop,
        padding: `${paddingY}px ${paddingX}px`,
        display: fillsSafeViewport ? "flex" : "block",
        flexDirection: fillsSafeViewport ? "column" : undefined,
        justifyContent: fillsSafeViewport ? "center" : undefined
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: cardTypography?.dotMarkerGapPx ?? 12,
          opacity: normalizedContentOpacity
        }}
      >
        <span
          style={{
            width: cardTypography?.dotSizePx ?? 8,
            height: cardTypography?.dotSizePx ?? 8,
            flex: "0 0 auto",
            borderRadius: "50%",
            backgroundColor: dotColor
          }}
        />
        {marker ? (
          <span
            style={{
              color: accentColor,
              fontSize: cardTypography?.markerFontSizePx ?? 13,
              fontWeight: 900,
              lineHeight: cardTypography?.marker.lineHeight ?? 1.2,
              letterSpacing: `${cardTypography?.marker.letterSpacingEm ?? 0.1}em`,
              whiteSpace: "nowrap"
            }}
          >
            {marker}
          </span>
        ) : null}
      </div>
      <div
        data-card-text-role="label"
        data-card-maximum-lines={cardTypography?.label.maximumLines}
        style={{
          marginTop: cardTypography?.markerTitleGapPx ?? 13,
          color: palette.ink,
          fontSize: cardTypography?.labelFontSizePx ?? 28,
          fontWeight: 860,
          lineHeight: cardTypography?.label.lineHeight ?? 1.12,
          letterSpacing: `${cardTypography?.label.letterSpacingEm ?? -0.025}em`,
          wordBreak: phraseSafe ? "keep-all" : "normal",
          overflowWrap: phraseSafe ? "normal" : "break-word",
          opacity: normalizedContentOpacity
        }}
      >
        {label}
      </div>
      {detail ? (
        <div
          data-card-text-role="detail"
          data-card-maximum-lines={cardTypography?.detail.maximumLines}
          style={{
            marginTop: cardTypography?.titleDetailGapPx ?? 7,
            color: palette.muted,
            fontSize: cardTypography?.detailFontSizePx ?? 18,
            fontWeight: 620,
            lineHeight: cardTypography?.detail.lineHeight ?? 1.35,
            wordBreak: phraseSafe ? "keep-all" : "normal",
            overflowWrap: phraseSafe ? "normal" : "break-word",
            opacity: normalizedContentOpacity
          }}
        >
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function semanticPrimitiveSurface(primitive, accentColor, focusColor, focusProgress, surfaceRole) {
  const openDiagram = {
    border: "none",
    borderRadius: 0,
    backgroundColor: "transparent",
    boxShadow: "none"
  };
  const fullOutline = {
    border: `3px solid ${mixHexColors(
      palette.lineStrong,
      accentColor,
      Math.min(1, focusProgress * 0.82)
    )}`,
    borderRadius: 18,
    backgroundColor: mixHexColors(
      palette.paperWarm,
      focusColor,
      focusProgress,
      0.92
    ),
    boxShadow: "none"
  };
  if (surfaceRole === "information-card") return fullOutline;
  if (primitive === "timeline-anchor") {
    return { ...openDiagram, borderTop: `3px solid ${accentColor}` };
  }
  if (primitive === "quantity-bar") {
    return {
      ...openDiagram,
      borderRadius: 14,
      backgroundColor: colorWithAlpha(accentColor, 0.12 + focusProgress * 0.16)
    };
  }
  if (primitive === "spatial-marker") {
    return { ...openDiagram, borderBottom: `3px solid ${accentColor}` };
  }
  return openDiagram;
}

export function VisualSystemV1StandaloneIcon({
  conceptKind,
  progress,
  presentation = "open-diagram-symbol",
  sizeRole = "support",
  statusMarkVariant = "quiet",
  label = "独立图标",
  caption = null,
  detail = null,
  layoutRole = "open-diagram-object",
  placement = "independent",
  participation = null,
  semanticObjectId = null,
  ownerId = null,
  style = {}
}) {
  const resolvedPresentation = assertAiTechIconProductionPresentation(conceptKind, presentation);
  const motion = aiTechIconMotionStateAtProgress(progress);
  const semanticIconNode = layoutRole === "semantic-icon-node";
  const semanticIconNodeDefaults = VISUAL_SYSTEM_V1_SEMANTIC_ICON_NODE_DEFAULTS;
  const resolvedIconSizePx = aiTechIconSize(sizeRole).sizePx;
  return (
    <div
      data-ai-tech-icon-presentation={resolvedPresentation}
      data-ai-tech-icon-container="standalone"
      data-ai-tech-icon-layout-role={layoutRole}
      data-ai-tech-icon-placement={placement}
      data-ai-tech-icon-participation={participation ?? undefined}
      data-ai-tech-icon-semantic-object-id={semanticObjectId ?? undefined}
      data-ai-tech-icon-owner-id={ownerId ?? undefined}
      style={{
        position: "absolute",
        display: "flex",
        flexDirection: semanticIconNode ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        gap: caption ? (semanticIconNode ? semanticIconNodeDefaults.gapPx : 8) : 0,
        padding: semanticIconNode
          ? `${semanticIconNodeDefaults.verticalPaddingPx}px ${semanticIconNodeDefaults.horizontalPaddingPx}px`
          : 0,
        boxSizing: "border-box",
        pointerEvents: "none",
        ...style
      }}
    >
      <VisualSystemV1AiTechIcon
        conceptKind={conceptKind}
        sizeRole={sizeRole}
        progress={progress}
        statusMarkVariant={statusMarkVariant}
        label={label}
      />
      {caption ? (
        <div
          data-ai-tech-icon-caption="standalone-label"
          style={{
            minWidth: 0,
            maxWidth: semanticIconNode
              ? `calc(100% - ${resolvedIconSizePx + semanticIconNodeDefaults.gapPx}px)`
              : "100%",
            color: palette.ink,
            fontSize: semanticIconNode ? semanticIconNodeDefaults.labelFontSizePx : 22,
            fontWeight: semanticIconNode ? 850 : 760,
            lineHeight: semanticIconNode ? semanticIconNodeDefaults.labelLineHeight : 1.08,
            letterSpacing: semanticIconNode
              ? semanticIconNodeDefaults.labelLetterSpacingPx
              : "-.02em",
            textAlign: semanticIconNode ? "left" : "center",
            whiteSpace: "nowrap",
            opacity: motion.drawProgress
          }}
        >
          <div>{caption}</div>
          {detail ? (
            <div
              data-ai-tech-icon-caption-detail="semantic-node-detail"
              style={{
                marginTop: semanticIconNodeDefaults.detailGapPx,
                color: palette.muted,
                fontSize: semanticIconNodeDefaults.detailFontSizePx,
                fontWeight: 620,
                lineHeight: semanticIconNodeDefaults.detailLineHeight,
                letterSpacing: semanticIconNodeDefaults.detailLetterSpacingPx,
                whiteSpace: "nowrap"
              }}
            >
              {detail}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function VisualSystemV1SemanticNode({
  nodeId,
  label,
  detail,
  marker = null,
  primitive = "node",
  startFrame,
  detailStartFrame = startFrame,
  style = {},
  accent = "mint",
  focusProgress = 0,
  visibilityProgress = 1,
  contentOpacity = 1,
  semanticRole = null,
  semanticGroupId = null,
  surfaceRole = null,
  surfacePurpose = null,
  visualHierarchyLevel = null,
  semanticClaimIds = [],
  conceptKind = "none",
  textWrapMode = "break-word",
  typographyProfile = "standard"
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const state = visualSystemV1SpringMotionAtFrame(frame, startFrame, fps);
  if (state.progress <= 0) return null;
  const detailState = visualSystemV1TextMotionAtFrame(frame, detailStartFrame);
  const normalizedFocus = Math.max(0, Math.min(1, focusProgress));
  const normalizedVisibility = Math.max(0, Math.min(1, visibilityProgress));
  const normalizedContentOpacity = Math.max(0, Math.min(1, contentOpacity));
  const accentColor = accent === "purple" ? palette.purpleDeep : palette.mintDeep;
  const focusColor = accent === "purple" ? palette.purpleSoft : palette.mintSoft;
  const width = Number.isFinite(style.width) ? style.width : 320;
  const height = Number.isFinite(style.height) ? style.height : 140;
  if (surfaceRole != null && !["information-card", "open-canvas"].includes(surfaceRole)) {
    throw new TypeError(`未知语义节点承载方式：${surfaceRole}`);
  }
  const resolvedSurfaceRole = surfaceRole ?? (
    VISUAL_SYSTEM_V1_INFORMATION_CARD_PRIMITIVES.includes(primitive)
      ? "information-card"
      : "open-canvas"
  );
  const informationCard = resolvedSurfaceRole === "information-card";
  const semanticTypography = semanticNode[typographyProfile];
  if (!semanticTypography) {
    throw new TypeError(`未知语义节点排版配置：${typographyProfile}`);
  }
  if (conceptKind !== "none") {
    throw new TypeError(
      `${nodeId} 是带文字的语义节点，不能嵌入图标；请改用 VisualSystemV1StandaloneIcon`
    );
  }
  const compactInformationCard = informationCard &&
    height < semanticTypography.informationCard.compactHeightThresholdPx;
  const labelFontSize = informationCard
    ? compactInformationCard
      ? semanticTypography.informationCard.compactLabelFontSizePx
      : semanticTypography.informationCard.labelFontSizePx
    : Math.max(
        semanticTypography.openCanvas.minimumLabelFontSizePx,
        Math.min(semanticTypography.openCanvas.maximumLabelFontSizePx, height * 0.3, width * 0.12)
      );
  const detailFontSize = informationCard
    ? compactInformationCard
      ? semanticTypography.informationCard.compactDetailFontSizePx
      : semanticTypography.informationCard.detailFontSizePx
    : Math.max(
        semanticTypography.openCanvas.minimumDetailFontSizePx,
        Math.min(semanticTypography.openCanvas.maximumDetailFontSizePx, height * 0.19, width * 0.068)
      );
  const paddingX = informationCard
    ? semanticTypography.informationCard.horizontalPaddingPx
    : Math.max(18, Math.min(semanticTypography.openCanvas.horizontalPaddingPx, width * 0.07));
  const paddingY = compactInformationCard
    ? semanticTypography.informationCard.compactVerticalPaddingPx
    : Math.max(informationCard ? 7 : 10, Math.min(26, height * 0.1));
  const markerVisible = Boolean(marker) &&
    height >= semanticNode.marker.minimumContainerHeightPx;
  const surface = semanticPrimitiveSurface(
    primitive,
    accentColor,
    focusColor,
    normalizedFocus,
    resolvedSurfaceRole
  );
  const phraseSafe = textWrapMode === "phrase-safe";
  if (!["break-word", "phrase-safe"].includes(textWrapMode)) {
    throw new TypeError(`未知语义节点断行模式：${textWrapMode}`);
  }
  return (
    <div
      data-visual-system-surface="semantic-grammar"
      data-visual-system-primitive={primitive}
      data-visual-system-surface-role={resolvedSurfaceRole}
      data-editorial-surface-purpose={surfacePurpose ?? undefined}
      data-visual-hierarchy-level={visualHierarchyLevel ?? undefined}
      data-visual-system-surface-border={surface.border === "none" ? "open-diagram" : "full-outline"}
      data-visual-system-node-id={nodeId}
      data-semantic-id={nodeId}
      data-semantic-group-id={semanticGroupId ?? undefined}
      data-semantic-role={semanticRole ?? undefined}
      data-semantic-claim-ids={semanticClaimIds.join(",") || undefined}
      data-ai-tech-icon-presentation="none"
      data-semantic-text-wrap={textWrapMode}
      data-semantic-typography-profile={typographyProfile}
      data-semantic-typography-compact={compactInformationCard ? "true" : "false"}
      style={{
        ...style,
        ...surface,
        position: "absolute",
        boxSizing: "border-box",
        top: Number.isFinite(style.top) ? style.top + state.translateY : style.top,
        padding: `${paddingY}px ${paddingX}px`,
        paddingLeft: paddingX,
        opacity: state.opacity * normalizedVisibility,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        overflow: informationCard ? "hidden" : "visible"
      }}
    >
      {primitive === "timeline-anchor" ? (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -7,
            left: "50%",
            width: 14,
            height: 14,
            borderRadius: "50%",
            backgroundColor: accentColor,
            translate: "-50% 0"
          }}
        />
      ) : null}
      {markerVisible ? (
        <div
          style={{
            color: accentColor,
            fontSize: semanticNode.marker.fontSizePx,
            fontWeight: 850,
            letterSpacing: ".08em",
            lineHeight: 1.1,
            opacity: normalizedContentOpacity * 0.76
          }}
        >
          {marker}
        </div>
      ) : null}
      <div
        style={{
          marginTop: markerVisible ? 7 : 0,
          minWidth: 0,
          opacity: normalizedContentOpacity
        }}
      >
        <div
          style={{
            minWidth: 0,
            color: palette.ink,
            fontSize: labelFontSize,
            fontWeight: 880,
            lineHeight: 1.08,
            letterSpacing: `${semanticTypography.labelLetterSpacingPx}px`,
            whiteSpace: informationCard ? "nowrap" : undefined,
            wordBreak: informationCard || phraseSafe ? "keep-all" : "normal",
            overflowWrap: informationCard || phraseSafe ? "normal" : "break-word"
          }}
        >
          {label}
        </div>
      </div>
      {detail ? (
        <div
          style={{
            marginTop: 7,
            color: palette.muted,
            fontSize: detailFontSize,
            fontWeight: semanticTypography.detailFontWeight,
            lineHeight: semanticTypography.detailLineHeight,
            wordBreak: phraseSafe ? "keep-all" : "normal",
            overflowWrap: phraseSafe ? "normal" : "break-word",
            opacity: normalizedContentOpacity * detailState.opacity
          }}
        >
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
              {visualSystemV1ChapterDisplayLabel(chapter.label, index)}
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

export function VisualSystemV1PlainSubtitle({ captions, visualWeight = "primary" }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const layout = visualSystemV1Layout(width, height);
  const fontSize = visualSystemV1SubtitleFontSize(layout, visualWeight);
  const currentTimeMs = (frame / fps) * 1000;
  const caption = captions.find((item) => currentTimeMs >= item.startMs && currentTimeMs < item.endMs) ?? null;
  if (!caption) return null;
  return (
    <div
      data-visual-system-subtitle="stable-black-no-container"
      data-visual-system-subtitle-weight={visualWeight}
      style={{
        position: "absolute",
        left: layout.vertical ? 72 : 300,
        right: layout.vertical ? 72 : 300,
        bottom: layout.vertical ? 72 : 92,
        zIndex: 10,
        color: VISUAL_SYSTEM_V1.defaults.subtitleColor,
        fontSize,
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
