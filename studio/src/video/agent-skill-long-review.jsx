import React from "react";
import {
  AbsoluteFill,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

import {
  VISUAL_SYSTEM_V1,
  VisualSystemV1ChapterProgress,
  VisualSystemV1PlainSubtitle,
  VisualSystemV1PopText,
  VisualSystemV1SemanticNode,
  VisualSystemV1StandaloneIcon,
  visualSystemV1ProgressAtFrame,
  visualSystemV1StandaloneOverlaySlot
} from "./components/visual-system-v1/index.jsx";
import { VisualSystemV1WideBrandLayer } from "./components/visual-system-v1/brand-layer.jsx";
import {
  AGENT_SKILL_LONG_REVIEW_CHAPTERS,
  AGENT_SKILL_LONG_REVIEW_SCENE_SPECS,
  longReviewDisplaySubtitles,
  longReviewLayoutAtFrame,
  longReviewSceneLayersAtFrame,
  longReviewSemanticNodeRevealFrame,
  longReviewStageCaptionLayout,
  longReviewStageCaptionStateAtFrame,
  longReviewSubtitleGateAtFrame
} from "./agent-skill-long-review-plan.mjs";

const { palette, typography } = VISUAL_SYSTEM_V1;

const humanNodePattern = /(?:\bhuman\b|人工(?:决定|确认)|等待人工)/iu;
const WIDE_BACKDROP_LOOP_SECONDS = 25;

function interpolateBackdropAnchor(phase, phaseOffset, width, height) {
  const loopProgress = ((phase + phaseOffset) % 1 + 1) % 1;
  const perimeter = 2 * (width + height);
  const distance = loopProgress * perimeter;
  let x;
  let y;
  if (distance < width) {
    x = distance;
    y = 0;
  } else if (distance < width + height) {
    x = width;
    y = distance - width;
  } else if (distance < 2 * width + height) {
    x = width - (distance - width - height);
    y = height;
  } else {
    x = 0;
    y = height - (distance - 2 * width - height);
  }
  return {
    x,
    y,
    scale: 0.88 + 0.2 * (0.5 + 0.5 * Math.cos(2 * Math.PI * loopProgress))
  };
}

function WideMovingBackdrop() {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const periodFrames = WIDE_BACKDROP_LOOP_SECONDS * fps;
  const phase = (((frame % periodFrames) + periodFrames) % periodFrames) / periodFrames;
  const blobs = [
    {
      id: "mint-a",
      offset: 0,
      width: width * 0.54,
      height: height * 0.7,
      opacity: 0.18,
      color: palette.mintSoft
    },
    {
      id: "mint-b",
      offset: 1 / 3,
      width: width * 0.46,
      height: height * 0.62,
      opacity: 0.14,
      color: palette.mintFace
    },
    {
      id: "purple",
      offset: 2 / 3,
      width: width * 0.44,
      height: height * 0.58,
      opacity: 0.07,
      color: palette.purpleSoft
    }
  ];
  return (
    <div
      data-visual-system-wallpaper="three-edge-blobs-25s-seamless"
      data-wallpaper-loop-frames={periodFrames}
      style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundColor: palette.paper }}
    >
      {blobs.map((blob) => {
        const position = interpolateBackdropAnchor(phase, blob.offset, width, height);
        return (
          <div
            key={blob.id}
            data-wallpaper-blob={blob.id}
            style={{
              position: "absolute",
              left: -blob.width / 2,
              top: -blob.height / 2,
              width: blob.width,
              height: blob.height,
              borderRadius: "50%",
              opacity: blob.opacity,
              background: `radial-gradient(ellipse at center, ${blob.color} 0%, ${blob.color} 34%, rgba(242,246,243,0) 74%)`,
              filter: "blur(88px)",
              translate: `${position.x}px ${position.y}px`,
              scale: position.scale,
              transformOrigin: "center center",
              willChange: "translate, scale"
            }}
          />
        );
      })}
    </div>
  );
}

function normalizeNodeCopy(value) {
  const text = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  return text.replace(/\s*\n+\s*/gu, " · ").trim();
}

function isHumanNode(node) {
  return humanNodePattern.test(`${node.id} ${normalizeNodeCopy(node.label)} ${normalizeNodeCopy(node.detail)}`);
}

function nodeMarker(node) {
  if (node.dashed) return "边界";
  return null;
}

function standaloneIconSize(icon) {
  const size = icon.sizeRole === "focus" ? 104 : icon.sizeRole === "inline" ? 36 : 56;
  return { width: size, height: size };
}

function preferredOverlaySides(placement) {
  const normalized = ({
    "right-center": "right",
    "left-center": "left",
    "above-center": "top",
    "below-center": "bottom"
  })[placement] ?? placement;
  const sides = ["right", "left", "top", "bottom"];
  if (!sides.includes(normalized)) return sides;
  return [normalized, ...sides.filter((side) => side !== normalized)];
}

function AdaptiveSemanticGroups({ spec, layout }) {
  const labelledGroups = (spec.groups ?? []).filter((group) => group.label);
  if (labelledGroups.length === 0) return null;
  return labelledGroups.map((group) => {
    const members = group.nodeIds.flatMap((nodeId) => {
      const geometry = layout.geometryById[nodeId];
      return geometry ? [geometry] : [];
    });
    if (members.length === 0) return null;
    const paddingX = 18;
    const paddingTop = 34;
    const paddingBottom = 16;
    const left = Math.max(layout.safeArea.left, Math.min(...members.map((item) => item.left)) - paddingX);
    const right = Math.min(layout.safeArea.right, Math.max(...members.map((item) => item.right)) + paddingX);
    const top = Math.max(layout.safeArea.top, Math.min(...members.map((item) => item.top)) - paddingTop);
    const bottom = Math.min(layout.safeArea.bottom, Math.max(...members.map((item) => item.bottom)) + paddingBottom);
    return (
      <div
        key={group.id}
        data-semantic-group-id={group.id}
        data-semantic-group-role="swimlane"
        style={{
          position: "absolute",
          left,
          top,
          width: right - left,
          height: bottom - top,
          boxSizing: "border-box",
          border: `2px dashed ${palette.lineStrong}`,
          borderRadius: 24,
          zIndex: 0
        }}
      >
        <span
          style={{
            position: "absolute",
            left: 16,
            top: 7,
            color: palette.mintDeep,
            fontSize: 15,
            fontWeight: 820,
            letterSpacing: ".06em",
            lineHeight: 1
          }}
        >
          {group.label}
        </span>
      </div>
    );
  });
}

function AdaptiveConnectors({ spec, state, layout, width, height }) {
  const semanticRelations = new Map(
    spec.visualPlan.semanticRelations.map((relation) => [relation.id, relation])
  );
  return (
    <svg
      data-visual-system-connectors="orthogonal-semantic-graph"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", inset: 0, overflow: "visible", zIndex: 1 }}
    >
      <defs>
        {layout.connectors.filter((connector) => semanticRelations.get(connector.relationId)?.directed).map((connector) => (
          <marker
            key={connector.relationId}
            id={`long-review-arrow-${spec.id}-${connector.relationId}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5.5"
            markerHeight="5.5"
            orient="auto"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              fill={palette.mintDeep}
              opacity={state.edgeArrowProgress[connector.relationId] ?? 0}
            />
          </marker>
        ))}
      </defs>
      {layout.connectors.map((connector) => {
        const semanticRelation = semanticRelations.get(connector.relationId);
        const progress = state.edgeProgress[connector.relationId] ?? 0;
        const focus = state.edgeHighlightProgress[connector.relationId] ?? 0;
        if (connector.route.length < 2 || progress <= 0) return null;
        const connectorProps = {
          "data-semantic-relation-id": semanticRelation?.id,
          "data-semantic-directed": String(Boolean(semanticRelation?.directed)),
          "data-connector-presentation": connector.presentationKind,
          pathLength: 1,
          fill: "none",
          stroke: palette.mintDeep,
          strokeWidth: 2 + focus,
          strokeLinecap: "round",
          strokeDasharray: 1,
          strokeDashoffset: 1 - progress,
          markerEnd: semanticRelation?.directed
            ? `url(#long-review-arrow-${spec.id}-${connector.relationId})`
            : undefined,
          opacity: progress * (state.edgeVisibilityProgress[connector.relationId] ?? 0) * (0.42 + focus * 0.42),
          vectorEffect: "non-scaling-stroke"
        };
        return (
          <polyline
            key={connector.relationId}
            {...connectorProps}
            points={connector.route.map((point) => `${point.x},${point.y}`).join(" ")}
          />
        );
      })}
    </svg>
  );
}

function StageCaption({ caption, copyOpacity = 1 }) {
  const captionStyle = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center"
  };
  const renderText = (label, index, opacity) => (
    <div key={`${index}-${label}`} style={{ ...captionStyle, opacity }}>
      <div
        style={{
          color: palette.mintDeep,
          fontSize: 28,
          fontWeight: 760,
          lineHeight: 1.25,
          letterSpacing: "-.015em"
        }}
      >
        {label ?? ""}
      </div>
    </div>
  );
  return (
    <div style={{ position: "relative", width: "100%", height: 34, opacity: copyOpacity }}>
      {caption.previous != null
        ? renderText(caption.previous.label, caption.stageIndex - 1, caption.previous.opacity)
        : null}
      {renderText(caption.current.label, caption.stageIndex, caption.current.opacity)}
    </div>
  );
}

function TechnicalDiagram({ spec, globalFrame, copyOpacity = 1, diagramOpacity = 1 }) {
  const detailOpacity = visualSystemV1ProgressAtFrame(
    globalFrame,
    spec.startFrame + spec.visualPlan.timing.detailCopyStartFrame,
    12
  );
  const { width, height } = useVideoConfig();
  const semanticLayout = longReviewLayoutAtFrame(spec.id, globalFrame, { width, height });
  const { state } = semanticLayout;
  const stageCaptionLayout = longReviewStageCaptionLayout(width, height);
  const stageCaption = longReviewStageCaptionStateAtFrame(spec.id, globalFrame);
  return (
    <div
      data-layout-stability={spec.layoutStability}
      style={{ position: "absolute", inset: 0, opacity: diagramOpacity }}
      data-scene-id={spec.id}
      data-stage-id={state.stageId ?? "none"}
      data-final-hold={state.finalHold ? "true" : "false"}
      data-scene-layout="stable-final-visual-grammar"
      data-visual-grammar={spec.visualPlan.structure}
      data-editorial-visual-mode={spec.visualMode}
      data-visible-semantic-count={semanticLayout.visibleCount}
      data-surface-mode="flat-only"
    >
      <AdaptiveSemanticGroups spec={spec} layout={semanticLayout} />
      <AdaptiveConnectors
        spec={spec}
        state={state}
        layout={semanticLayout}
        width={width}
        height={height}
      />
      {semanticLayout.nodeIds.map((nodeId) => {
        const node = spec.nodes.find((candidate) => candidate.id === nodeId);
        const semanticElement = spec.visualPlan.semanticElements.find(
          (candidate) => candidate.id === nodeId
        );
        const geometry = semanticLayout.geometryById[nodeId];
        const surfacePlan = spec.surfacePlanById[nodeId];
        if (!node || !geometry) return null;
        const revealFrame = longReviewSemanticNodeRevealFrame(spec.id, node.id);
        return (
          <VisualSystemV1SemanticNode
            key={node.id}
            nodeId={node.id}
            marker={nodeMarker(node)}
            label={normalizeNodeCopy(node.label)}
            detail={normalizeNodeCopy(node.detail)}
            startFrame={revealFrame}
            detailStartFrame={Math.max(
              revealFrame,
              spec.startFrame + spec.visualPlan.timing.detailCopyStartFrame
            )}
            primitive={semanticLayout.primitiveById[node.id]}
            accent={isHumanNode(node) ? "purple" : "mint"}
            focusProgress={state.nodeHighlightProgress[node.id] ?? 0}
            visibilityProgress={state.nodeVisibilityProgress[node.id] ?? 0}
            contentOpacity={copyOpacity}
            semanticRole={semanticElement?.semanticRole}
            semanticGroupId={surfacePlan?.semanticGroupId}
            surfaceRole={surfacePlan?.surfaceRole}
            surfacePurpose={surfacePlan?.surfacePurpose}
            visualHierarchyLevel={surfacePlan?.visualHierarchyLevel}
            semanticClaimIds={semanticElement?.claimIds ?? []}
            conceptKind="none"
            textWrapMode={node.textWrapMode ?? "phrase-safe"}
            style={{ ...geometry, zIndex: 2 }}
          />
        );
      })}
      {spec.standaloneIcons.map((icon) => {
        const anchor = semanticLayout.geometryById[icon.anchorId];
        if (!anchor) return null;
        const progress = icon.delayUntilFinalHold
          ? visualSystemV1ProgressAtFrame(globalFrame, spec.holdStartFrame, 18)
          : (state.nodeProgress[icon.anchorId] ?? 0) * (state.nodeVisibilityProgress[icon.anchorId] ?? 0);
        if (progress <= 0) return null;
        const slot = visualSystemV1StandaloneOverlaySlot({
          anchorGeometry: anchor,
          overlaySize: standaloneIconSize(icon),
          safeArea: semanticLayout.safeArea,
          geometryById: semanticLayout.fullGeometryById,
          connectors: semanticLayout.allConnectors,
          minimumGapPx: 18,
          preferredSides: preferredOverlaySides(icon.placement)
        });
        if (!slot.render) return null;
        const anchorNode = spec.nodes.find((node) => node.id === icon.anchorId);
        return (
          <VisualSystemV1StandaloneIcon
            key={icon.id}
            conceptKind={icon.conceptKind}
            presentation={icon.presentation}
            sizeRole={icon.sizeRole}
            progress={progress}
            statusMarkVariant={icon.statusMarkVariant}
            label={`${anchorNode?.label ?? icon.anchorId} 独立状态图标`}
            style={{
              left: slot.bounds.x,
              top: slot.bounds.y,
              width: slot.bounds.width,
              height: slot.bounds.height,
              zIndex: 3
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          left: stageCaptionLayout.left,
          right: stageCaptionLayout.right,
          top: stageCaptionLayout.top,
          height: stageCaptionLayout.height,
          zIndex: 3
        }}
      >
        <StageCaption caption={stageCaption} copyOpacity={copyOpacity * detailOpacity} />
      </div>
    </div>
  );
}

function titleFontSize(title) {
  const length = [...String(title ?? "")].length;
  if (length >= 22) return 66;
  if (length >= 17) return 74;
  return typography.headlineWidePx;
}

function SceneLayer({ episode, layer, globalFrame }) {
  const spec = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((item) => item.id === layer.sceneId);
  if (!spec) return null;
  const scene = episode?.scenes?.find((item) => item.id === layer.sceneId) ?? spec;
  const title = scene.title ?? spec.title;
  return (
    <div
      style={{ position: "absolute", inset: 0, opacity: layer.opacity }}
      data-layer-scene-id={layer.sceneId}
      data-scene-kind={spec.kind}
    >
      <VisualSystemV1PopText
        startFrame={spec.startFrame}
        style={{
          position: "absolute",
          left: 120,
          right: 280,
          top: 110,
          zIndex: 4,
          color: palette.ink,
          fontSize: titleFontSize(title),
          fontWeight: 900,
          lineHeight: 1.08,
          letterSpacing: "-.045em",
          whiteSpace: "nowrap",
          opacity: layer.copyOpacity
        }}
      >
        {title}
      </VisualSystemV1PopText>
      <VisualSystemV1PopText
        startFrame={spec.startFrame + spec.visualPlan.timing.supportingCopyStartFrame}
        style={{
          position: "absolute",
          left: 122,
          right: 280,
          top: 238,
          zIndex: 4,
          color: palette.muted,
          fontSize: typography.supportingWidePx,
          fontWeight: 650,
          lineHeight: 1.34,
          letterSpacing: "-.02em",
          whiteSpace: "nowrap",
          opacity: layer.copyOpacity
        }}
      >
        {spec.deck ?? scene.statement ?? ""}
      </VisualSystemV1PopText>
      <TechnicalDiagram
        spec={spec}
        globalFrame={globalFrame}
        copyOpacity={layer.copyOpacity}
        diagramOpacity={layer.diagramOpacity}
      />
    </div>
  );
}

function subtitleCaptions(episode) {
  return longReviewDisplaySubtitles(episode?.subtitles ?? []).map((subtitle) => ({
    text: subtitle.text,
    startMs: subtitle.start * 1000,
    endMs: subtitle.end * 1000,
    timestampMs: null,
    confidence: null
  }));
}

export function AgentSkillLongReview({ episode }) {
  const frame = useCurrentFrame();
  const layers = longReviewSceneLayersAtFrame(frame);
  const captions = subtitleCaptions(episode);
  const subtitleGate = longReviewSubtitleGateAtFrame(episode?.subtitles ?? [], frame);
  return (
    <AbsoluteFill
      lang="zh-CN"
      style={{
        backgroundColor: palette.paper,
        color: palette.ink,
        fontFamily: typography.fontFamily,
        overflow: "hidden"
      }}
    >
      <WideMovingBackdrop />
      {episode?.voice?.publicPath ? <Audio src={staticFile(episode.voice.publicPath)} /> : null}
      <div
        data-visual-system="visual-system-v1"
        data-visual-system-content="open-canvas"
        data-output-format="wide-only"
        data-same-level-surfaces="semantic-hierarchy-consistent"
        style={{ position: "absolute", inset: 0 }}
      >
        {layers.map((layer) => (
          <SceneLayer
            key={`${layer.sceneId}-${layer.role ?? "current"}`}
            episode={episode}
            layer={layer}
            globalFrame={frame}
          />
        ))}
      </div>
      <VisualSystemV1WideBrandLayer />
      <div
        data-subtitle-title-gate={subtitleGate.mode}
        style={{ opacity: subtitleGate.opacity }}
      >
        <VisualSystemV1PlainSubtitle captions={captions} />
      </div>
      <VisualSystemV1ChapterProgress chapters={AGENT_SKILL_LONG_REVIEW_CHAPTERS} />
    </AbsoluteFill>
  );
}
