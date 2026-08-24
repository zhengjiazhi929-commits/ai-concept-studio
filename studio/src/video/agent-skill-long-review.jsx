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
  VisualSystemV1AiWatermark,
  VisualSystemV1ChapterProgress,
  VisualSystemV1FlatNode,
  VisualSystemV1PlainSubtitle,
  VisualSystemV1PopText,
  visualSystemV1AdaptiveCardLayout,
  visualSystemV1SmoothStep
} from "./components/visual-system-v1/index.jsx";
import {
  AGENT_SKILL_LONG_REVIEW_CHAPTERS,
  AGENT_SKILL_LONG_REVIEW_SCENE_SPECS,
  longReviewDiagramStateAtFrame,
  longReviewSceneLayersAtFrame
} from "./agent-skill-long-review-plan.mjs";

const { palette, typography } = VISUAL_SYSTEM_V1;
const CARD_CONSTRAINTS = Object.freeze({
  copyBottomPx: 318,
  subtitleTopPx: 872,
  minimumCardWidthPx: VISUAL_SYSTEM_V1.cardDeck.minimumCardWidthPx,
  minimumCardHeightPx: VISUAL_SYSTEM_V1.cardDeck.minimumCardHeightPx
});

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

function nodeMarker(node, spec) {
  if (isHumanNode(node)) return "HUMAN GATE";
  if (node.dashed) return "BOUNDARY";
  if (spec.kind === "native-evidence") return "EVIDENCE";
  if (spec.kind === "summary") return "SUMMARY";
  return "NODE";
}

function uniqueNodeIds(stages) {
  return [...new Set(stages.flatMap((stage) => stage.nodeIds))];
}

function cardGeometry(card) {
  return {
    left: card.left,
    top: card.top,
    width: card.width,
    height: card.height
  };
}

function interpolateGeometry(from, to, progress) {
  const amount = visualSystemV1SmoothStep(progress);
  const interpolate = (start, end) => start + (end - start) * amount;
  return {
    left: interpolate(from.left, to.left),
    top: interpolate(from.top, to.top),
    width: interpolate(from.width, to.width),
    height: interpolate(from.height, to.height)
  };
}

function adaptiveNodeLayout(spec, state, width, height) {
  const targetNodeIds = uniqueNodeIds(spec.stages.slice(0, state.stageIndex + 1));
  if (targetNodeIds.length === 0) {
    return { nodeIds: [], geometryById: {}, visibleCount: 0 };
  }
  const previousNodeIds = uniqueNodeIds(spec.stages.slice(0, state.stageIndex));
  const targetDeck = visualSystemV1AdaptiveCardLayout(
    width,
    height,
    targetNodeIds.length,
    CARD_CONSTRAINTS
  );
  const targetGeometry = Object.fromEntries(
    targetNodeIds.map((nodeId, index) => [nodeId, cardGeometry(targetDeck.cards[index])])
  );
  if (
    previousNodeIds.length === 0 ||
    previousNodeIds.length === targetNodeIds.length ||
    state.stageTransitionProgress >= 1
  ) {
    return {
      nodeIds: targetNodeIds,
      geometryById: targetGeometry,
      visibleCount: targetNodeIds.length
    };
  }
  const previousDeck = visualSystemV1AdaptiveCardLayout(
    width,
    height,
    previousNodeIds.length,
    CARD_CONSTRAINTS
  );
  const previousGeometry = Object.fromEntries(
    previousNodeIds.map((nodeId, index) => [nodeId, cardGeometry(previousDeck.cards[index])])
  );
  return {
    nodeIds: targetNodeIds,
    geometryById: Object.fromEntries(targetNodeIds.map((nodeId) => [
      nodeId,
      previousGeometry[nodeId]
        ? interpolateGeometry(
          previousGeometry[nodeId],
          targetGeometry[nodeId],
          state.stageTransitionProgress
        )
        : targetGeometry[nodeId]
    ])),
    visibleCount: targetNodeIds.length
  };
}

function firstRevealFrame(spec, nodeId) {
  return spec.stages.find((stage) => stage.nodeIds.includes(nodeId))?.startFrame ?? spec.startFrame;
}

function connectorEndpoints(from, to) {
  const fromCenter = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  const toCenter = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return null;
  const fromScale = Math.min(
    from.width / (2 * Math.max(Math.abs(dx), 0.001)),
    from.height / (2 * Math.max(Math.abs(dy), 0.001))
  );
  const toScale = Math.min(
    to.width / (2 * Math.max(Math.abs(dx), 0.001)),
    to.height / (2 * Math.max(Math.abs(dy), 0.001))
  );
  return {
    from: {
      x: fromCenter.x + dx * fromScale,
      y: fromCenter.y + dy * fromScale
    },
    to: {
      x: toCenter.x - dx * toScale,
      y: toCenter.y - dy * toScale
    }
  };
}

function AdaptiveConnectors({ spec, state, layout, width, height }) {
  return (
    <svg
      data-visual-system-connectors="adaptive-flat-graph"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", inset: 0, overflow: "visible", zIndex: 1 }}
    >
      <defs>
        {spec.edges.map((edge) => (
          <marker
            key={edge.id}
            id={`long-review-arrow-${spec.id}-${edge.id}`}
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
              opacity={state.edgeArrowProgress[edge.id] ?? 0}
            />
          </marker>
        ))}
      </defs>
      {spec.edges.map((edge) => {
        const from = layout.geometryById[edge.from];
        const to = layout.geometryById[edge.to];
        const endpoints = from && to ? connectorEndpoints(from, to) : null;
        const progress = state.edgeProgress[edge.id] ?? 0;
        const focus = state.edgeHighlightProgress[edge.id] ?? 0;
        if (!endpoints || progress <= 0) return null;
        return (
          <line
            key={edge.id}
            x1={endpoints.from.x}
            y1={endpoints.from.y}
            x2={endpoints.to.x}
            y2={endpoints.to.y}
            pathLength={1}
            stroke={palette.mintDeep}
            strokeWidth={2 + focus}
            strokeLinecap="round"
            strokeDasharray={1}
            strokeDashoffset={1 - progress}
            markerEnd={`url(#long-review-arrow-${spec.id}-${edge.id})`}
            opacity={progress * (0.42 + focus * 0.42)}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

function StageCaption({ state }) {
  const progress = state.previousStageLabel == null
    ? 1
    : state.stageTransitionProgress ?? 1;
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
          fontSize: 24,
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
    <div style={{ position: "relative", width: "100%", height: 34 }}>
      {state.previousStageLabel != null
        ? renderText(state.previousStageLabel, Math.max(0, state.stageIndex - 1), 1 - progress)
        : null}
      {renderText(state.stageLabel, state.stageIndex, progress)}
    </div>
  );
}

function TechnicalDiagram({ spec, globalFrame }) {
  const state = longReviewDiagramStateAtFrame(spec.id, globalFrame);
  const { width, height } = useVideoConfig();
  const adaptiveLayout = adaptiveNodeLayout(spec, state, width, height);
  return (
    <div
      style={{ position: "absolute", inset: 0 }}
      data-scene-id={spec.id}
      data-stage-id={state.stageId ?? "none"}
      data-final-hold={state.finalHold ? "true" : "false"}
      data-scene-adaptive-layout="visible-node-count"
      data-visible-card-count={adaptiveLayout.visibleCount}
      data-surface-mode="flat-only"
    >
      <AdaptiveConnectors
        spec={spec}
        state={state}
        layout={adaptiveLayout}
        width={width}
        height={height}
      />
      {adaptiveLayout.nodeIds.map((nodeId) => {
        const node = spec.nodes.find((candidate) => candidate.id === nodeId);
        const geometry = adaptiveLayout.geometryById[nodeId];
        if (!node || !geometry) return null;
        return (
          <VisualSystemV1FlatNode
            key={node.id}
            nodeId={node.id}
            marker={nodeMarker(node, spec)}
            label={normalizeNodeCopy(node.label)}
            detail={normalizeNodeCopy(node.detail)}
            startFrame={firstRevealFrame(spec, node.id)}
            accent={isHumanNode(node) ? "purple" : "mint"}
            focusProgress={state.nodeHighlightProgress[node.id] ?? 0}
            layoutMode="fill-safe-viewport"
            style={{ ...geometry, zIndex: 2 }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 120,
          right: 280,
          top: 298,
          height: 34,
          zIndex: 3
        }}
      >
        <StageCaption state={state} />
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
          whiteSpace: "nowrap"
        }}
      >
        {title}
      </VisualSystemV1PopText>
      <VisualSystemV1PopText
        startFrame={spec.startFrame + 4}
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
          whiteSpace: "nowrap"
        }}
      >
        {spec.deck ?? scene.statement ?? ""}
      </VisualSystemV1PopText>
      <TechnicalDiagram spec={spec} globalFrame={globalFrame} />
    </div>
  );
}

function subtitleCaptions(episode) {
  return (episode?.subtitles ?? []).map((subtitle) => ({
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
        data-same-level-surfaces="flat"
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
      <VisualSystemV1AiWatermark size={40} top={18} right={18} />
      <VisualSystemV1PlainSubtitle captions={captions} />
      <VisualSystemV1ChapterProgress chapters={AGENT_SKILL_LONG_REVIEW_CHAPTERS} />
    </AbsoluteFill>
  );
}
