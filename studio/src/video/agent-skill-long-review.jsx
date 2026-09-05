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
  VisualSystemV1TechnicalArtifact,
  visualSystemV1ProgressAtFrame,
  visualSystemV1StandaloneOverlaySlot
} from "./components/visual-system-v1/index.jsx";
import { aiTechIconSize } from "../shared/ai-tech-icon-contract.mjs";
import { VisualSystemV1WideBrandLayer } from "./components/visual-system-v1/brand-layer.jsx";
import {
  longReviewBoundaryContrastRoute,
  longReviewIsBoundaryContrastTarget,
  longReviewResolvedSemanticGroupBounds
} from "./agent-skill-long-review-contrast.mjs";
import {
  AGENT_SKILL_LONG_REVIEW_CHAPTERS,
  AGENT_SKILL_LONG_REVIEW_CONNECTOR_TONES,
  AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES,
  AGENT_SKILL_LONG_REVIEW_SCENE_START_FRAMES,
  AGENT_SKILL_LONG_REVIEW_SCENE_SPECS,
  AGENT_SKILL_LONG_REVIEW_TITLE_PREROLL_FRAMES,
  longReviewDisplaySubtitles,
  longReviewLayoutAtFrame,
  longReviewSceneLayersAtFrame,
  longReviewSemanticGroupProgress,
  longReviewSemanticNodeRevealFrame,
  longReviewStageCaptionLayout,
  longReviewStageCaptionStateAtFrame,
  longReviewSubtitleGateAtFrame,
  longReviewVisualSceneCopy
} from "./agent-skill-long-review-plan.mjs";

const { palette, typography, surfaceBorder } = VISUAL_SYSTEM_V1;

const humanNodePattern = /(?:\bhuman\b|人工(?:决定|确认)|等待人工)/iu;
const WIDE_BACKDROP_LOOP_SECONDS = 25;
const SHAPE_GRAMMAR_LEGEND_FONT_SIZE_PX = 24;
const SHAPE_GRAMMAR_LEGEND_MIN_HEIGHT_PX = 48;

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

function WideMovingBackdrop({ frameOverride = null }) {
  const currentFrame = useCurrentFrame();
  const frame = frameOverride == null ? currentFrame : frameOverride;
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
      data-wallpaper-compositor-policy={VISUAL_SYSTEM_V1.wallpaper.compositorPolicy}
      data-wallpaper-loop-frames={periodFrames}
      data-wallpaper-sample-frame={frame}
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
              translate: `${position.x}px ${position.y}px`,
              scale: position.scale,
              transformOrigin: "center center"
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
  const size = aiTechIconSize(icon.sizeRole).sizePx;
  if (!icon.caption) return { width: size, height: size };
  return { width: Math.max(120, size), height: size + 36 };
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

function ownedCalloutLeaderPoints(bounds, anchor, side) {
  if (side === "left") {
    return `${bounds.x + bounds.width},${bounds.y + bounds.height / 2} ${anchor.x},${anchor.centerY}`;
  }
  if (side === "right") {
    return `${bounds.x},${bounds.y + bounds.height / 2} ${anchor.right},${anchor.centerY}`;
  }
  if (side === "top") {
    return `${bounds.x + bounds.width / 2},${bounds.y + bounds.height} ${anchor.centerX},${anchor.y}`;
  }
  return `${bounds.x + bounds.width / 2},${bounds.y} ${anchor.centerX},${anchor.bottom}`;
}

function AdaptiveSemanticGroups({ spec, layout }) {
  const labelledGroups = (spec.groups ?? []).filter((group) => group.label);
  if (labelledGroups.length === 0) return null;
  return labelledGroups.map((group) => {
    const isCompleteObjectBoundary = group.semanticMeaning === "complete-object-or-boundary";
    const groupProgress = longReviewSemanticGroupProgress(layout.state, group.nodeIds);
    if (groupProgress <= 0) return null;
    const bounds = longReviewResolvedSemanticGroupBounds(group, layout);
    if (!bounds) return null;
    const { left, right, top, bottom } = bounds;
    const groupBorderColor = isCompleteObjectBoundary
      ? surfaceBorder.semanticGroup.completeBoundaryColor
      : surfaceBorder.semanticGroup.contextualColor;
    return (
      <div
        key={group.id}
        data-semantic-group-id={group.id}
        data-semantic-group-role={isCompleteObjectBoundary ? "complete-boundary" : "contextual-boundary"}
        data-shape-grammar-role={isCompleteObjectBoundary ? "complete-object" : "semantic-group"}
        data-shape-grammar-form={group.visualForm}
        data-visual-system-group-border={`${surfaceBorder.semanticGroup.mode}-${surfaceBorder.semanticGroup.widthPx}px`}
        data-shape-grammar-meaning={
          group.semanticMeaning
        }
        style={{
          position: "absolute",
          left,
          top,
          width: right - left,
          height: bottom - top,
          boxSizing: "border-box",
          border: `${surfaceBorder.semanticGroup.widthPx}px solid ${groupBorderColor}`,
          background: "linear-gradient(180deg, rgba(216, 243, 232, 0.28) 0%, rgba(216, 243, 232, 0) 42%)",
          borderRadius: 18,
          opacity: groupProgress,
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
            fontWeight: typography.fontWeights.sectionLabel,
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
  const connectorTone = AGENT_SKILL_LONG_REVIEW_CONNECTOR_TONES[spec.connectorTone];
  if (!connectorTone) throw new Error(`${spec.id} 使用了未知连接线 tone：${spec.connectorTone}`);
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
            markerWidth={connectorTone.markerSizePx}
            markerHeight={connectorTone.markerSizePx}
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
        const boundaryContrastRoute = semanticRelation == null
          ? null
          : longReviewBoundaryContrastRoute(spec, semanticRelation, layout);
        const boundaryContrast = boundaryContrastRoute != null;
        const renderedRoute = boundaryContrastRoute ?? connector.route;
        const connectorProps = {
          "data-semantic-relation-id": semanticRelation?.id,
          "data-semantic-directed": String(Boolean(semanticRelation?.directed)),
          "data-connector-presentation": connector.presentationKind,
          "data-connector-semantic-style": boundaryContrast ? "contrast-dashed" : "structural-solid",
          pathLength: boundaryContrast ? undefined : 1,
          fill: "none",
          stroke: boundaryContrast ? palette.purpleDeep : palette.mintDeep,
          strokeWidth: connectorTone.strokeWidthPx + focus * 0.5,
          strokeLinecap: "round",
          strokeDasharray: boundaryContrast ? "7 6" : 1,
          strokeDashoffset: boundaryContrast ? 0 : 1 - progress,
          markerEnd: semanticRelation?.directed
            ? `url(#long-review-arrow-${spec.id}-${connector.relationId})`
            : undefined,
          opacity: progress * (state.edgeVisibilityProgress[connector.relationId] ?? 0) * (
            connectorTone.restingOpacity +
            focus * (connectorTone.focusedOpacity - connectorTone.restingOpacity)
          ),
          vectorEffect: "non-scaling-stroke"
        };
        return (
          <polyline
            key={connector.relationId}
            {...connectorProps}
            points={renderedRoute.map((point) => `${point.x},${point.y}`).join(" ")}
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
          fontWeight: typography.fontWeights.sectionLabel,
          lineHeight: 1.25,
          letterSpacing: "-.015em"
        }}
      >
        {label ?? ""}
      </div>
    </div>
  );
  const previous = caption.previous?.render === false ? null : caption.previous;
  const current = caption.current?.render === false ? null : caption.current;
  if (previous == null && current == null) return null;
  return (
    <div style={{ position: "relative", width: "100%", height: 34, opacity: copyOpacity }}>
      {previous != null
        ? renderText(previous.label, caption.stageIndex - 1, previous.opacity)
        : null}
      {current != null
        ? renderText(current.label, caption.stageIndex, current.opacity)
        : null}
    </div>
  );
}

function ShapeGrammarGlyph({ visualForm }) {
  if (visualForm === "open-node") {
    return (
      <span
        aria-hidden="true"
        style={{ position: "relative", width: 34, height: 18, flex: "0 0 34px" }}
      >
        <span
          style={{
            position: "absolute",
            left: 2,
            right: 2,
            top: 8,
            height: 2,
            backgroundColor: palette.mintDeep
          }}
        />
        <span
          style={{
            position: "absolute",
            left: 12,
            top: 3,
            width: 10,
            height: 10,
            boxSizing: "border-box",
            border: `2px solid ${palette.mintDeep}`,
            borderRadius: "50%",
            backgroundColor: palette.paper
          }}
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: 30,
        height: 17,
        flex: "0 0 30px",
        boxSizing: "border-box",
        border: `2px ${visualForm === "dashed-outline" ? "dashed" : "solid"} ${palette.mintDeep}`,
        borderRadius: 5
      }}
    />
  );
}

function ShapeGrammarLegend({ cue, globalFrame, copyOpacity = 1 }) {
  if (cue == null || globalFrame < cue.startFrame || globalFrame >= cue.endFrame) return null;
  const enterProgress = visualSystemV1ProgressAtFrame(globalFrame, cue.startFrame, 10);
  const exitProgress = visualSystemV1ProgressAtFrame(globalFrame, cue.endFrame - 10, 10);
  const opacity = copyOpacity * enterProgress * (1 - exitProgress);
  return (
    <div
      data-shape-grammar-legend={cue.mode}
      data-shape-grammar-persistent={cue.persistent ? "true" : "false"}
      data-shape-grammar-window={`${cue.startFrame}:${cue.endFrame}`}
      data-shape-grammar-font-size={SHAPE_GRAMMAR_LEGEND_FONT_SIZE_PX}
      style={{
        position: "absolute",
        left: 700,
        right: 240,
        top: 298,
        minHeight: SHAPE_GRAMMAR_LEGEND_MIN_HEIGHT_PX,
        zIndex: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 18,
        color: palette.muted,
        fontSize: SHAPE_GRAMMAR_LEGEND_FONT_SIZE_PX,
        fontWeight: typography.fontWeights.explanatory,
        letterSpacing: ".01em",
        opacity,
        pointerEvents: "none"
      }}
    >
      {cue.items.map((item) => (
        <span
          key={item.id}
          data-shape-grammar-form={item.visualForm}
          data-shape-grammar-meaning={item.meaning}
          style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}
        >
          <ShapeGrammarGlyph visualForm={item.visualForm} />
          <span>{item.meaning}</span>
        </span>
      ))}
    </div>
  );
}

function TechnicalDiagram({
  spec,
  globalFrame,
  copyOpacity = 1,
  diagramOpacity = 1,
  subtitlePresentationMode = null
}) {
  const detailOpacity = visualSystemV1ProgressAtFrame(
    globalFrame,
    spec.startFrame + spec.visualPlan.timing.detailCopyStartFrame,
    12
  );
  const { width, height } = useVideoConfig();
  const semanticLayout = longReviewLayoutAtFrame(spec.id, globalFrame, { width, height });
  const { state } = semanticLayout;
  const graphIconByAnchorId = new Map(
    spec.standaloneIcons
      .filter((icon) => icon.participation === "graph-node")
      .map((icon) => [icon.anchorId, icon])
  );
  const stageCaptionLayout = longReviewStageCaptionLayout(width, height);
  const stageCaption = longReviewStageCaptionStateAtFrame(spec.id, globalFrame);
  const shapeGrammarCueActive = spec.shapeGrammarCue != null &&
    globalFrame >= spec.shapeGrammarCue.startFrame &&
    globalFrame < spec.shapeGrammarCue.endFrame;
  const suppressStageCaption = ["semantic-cue", "hidden"].includes(subtitlePresentationMode) ||
    shapeGrammarCueActive;
  return (
    <div
      data-layout-stability={spec.layoutStability}
      style={{ position: "absolute", inset: 0, opacity: diagramOpacity }}
      data-scene-id={spec.id}
      data-stage-id={state.stageId ?? "none"}
      data-final-hold={state.finalHold ? "true" : "false"}
      data-convergence-progress={state.convergenceProgress ?? undefined}
      data-scene-layout={`${spec.layoutStability}-visual-grammar`}
      data-visual-grammar={spec.visualPlan.structure}
      data-editorial-visual-mode={spec.visualMode}
      data-narrative-treatment={spec.narrativeTreatment}
      data-narrative-treatment-rationale={spec.narrativeTreatmentRationale}
      data-shape-grammar-version={spec.shapeGrammarVersion}
      data-visible-semantic-count={semanticLayout.visibleCount}
      data-surface-mode="flat-only"
    >
      <VisualSystemV1TechnicalArtifact
        profile={spec.artifactProfile}
        safeArea={semanticLayout.safeArea}
        geometryById={semanticLayout.fullGeometryById}
        nodeVisibilityProgress={state.nodeVisibilityProgress}
        progress={visualSystemV1ProgressAtFrame(
          globalFrame,
          spec.startFrame + spec.visualPlan.timing.graphicStartFrame,
          AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES
        )}
        contentOpacity={copyOpacity}
      />
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
        if (graphIconByAnchorId.has(nodeId)) return null;
        const semanticElement = spec.visualPlan.semanticElements.find(
          (candidate) => candidate.id === nodeId
        );
        const geometry = semanticLayout.geometryById[nodeId];
        const surfacePlan = spec.surfacePlanById[nodeId];
        if (!node || !geometry) return null;
        const revealFrame = longReviewSemanticNodeRevealFrame(spec.id, node.id);
        return (
          <div
            key={node.id}
            data-shape-grammar-node-id={node.id}
            data-shape-grammar-role={surfacePlan?.shapeGrammarRole}
            data-shape-grammar-form={surfacePlan?.shapeGrammarVisualForm}
            data-shape-grammar-meaning={surfacePlan?.shapeGrammarMeaning}
            style={{ display: "contents" }}
          >
            {surfacePlan?.shapeGrammarRole === "semantic-boundary" ? (
              <div
                aria-hidden="true"
                data-shape-grammar-boundary-wrapper={surfacePlan.shapeGrammarMeaning}
                style={{
                  position: "absolute",
                  left: geometry.left - 8,
                  top: geometry.top - 8,
                  width: geometry.width + 16,
                  height: geometry.height + 16,
                  boxSizing: "border-box",
                  border: `2px dashed ${longReviewIsBoundaryContrastTarget(spec, node.id)
                    ? palette.purpleDeep
                    : palette.mintDeep}`,
                  borderRadius: 18,
                  opacity: (state.nodeProgress[node.id] ?? 0) *
                    (state.nodeVisibilityProgress[node.id] ?? 0),
                  zIndex: 1,
                  pointerEvents: "none"
                }}
              />
            ) : null}
            <VisualSystemV1SemanticNode
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
              textWrapMode={node.textWrapMode ?? "break-word"}
              typographyProfile={spec.typographyProfile === "longform-emphasis"
                ? "longformEmphasis"
                : "standard"}
              style={{
                ...geometry,
                zIndex: 2,
                textAlign: spec.narrativeTreatment === "package-anatomy" && node.semanticGroupId != null
                  ? "center"
                  : undefined
              }}
            />
          </div>
        );
      })}
      {spec.standaloneIcons.map((icon) => {
        const anchor = semanticLayout.geometryById[icon.anchorId];
        if (!anchor) return null;
        const progress = icon.delayUntilFinalHold
          ? visualSystemV1ProgressAtFrame(globalFrame, spec.holdStartFrame, 18)
          : (state.nodeProgress[icon.anchorId] ?? 0) * (state.nodeVisibilityProgress[icon.anchorId] ?? 0);
        if (progress <= 0) return null;
        const graphNode = icon.participation === "graph-node";
        const graphNodeBounds = graphNode
          ? semanticLayout.iconGeometryById[icon.anchorId]
          : null;
        if (graphNode && !graphNodeBounds) {
          throw new Error(`${spec.id}/${icon.id} 缺少与连线同源的图标可见几何`);
        }
        const slot = graphNode
          ? { render: true, reason: "semantic-icon-render-bounds", side: null, bounds: graphNodeBounds }
          : visualSystemV1StandaloneOverlaySlot({
              anchorGeometry: anchor,
              overlaySize: standaloneIconSize(icon),
              safeArea: semanticLayout.safeArea,
              geometryById: semanticLayout.fullGeometryById,
              connectors: semanticLayout.allConnectors,
              minimumGapPx: icon.maximumGapPx,
              preferredSides: preferredOverlaySides(icon.placement)
            });
        if (!slot.render) return null;
        const anchorNode = spec.nodes.find((node) => node.id === icon.anchorId);
        return (
          <React.Fragment key={icon.id}>
            {icon.participation === "owned-callout" ? (
              <svg
                data-ai-tech-icon-owner-link={icon.id}
                width={width}
                height={height}
                viewBox={`0 0 ${width} ${height}`}
                style={{ position: "absolute", inset: 0, overflow: "visible", zIndex: 2 }}
              >
                <polyline
                  points={ownedCalloutLeaderPoints(slot.bounds, anchor, slot.side)}
                  fill="none"
                  stroke={palette.mintDeep}
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity={progress * 0.58}
                />
              </svg>
            ) : null}
            <VisualSystemV1StandaloneIcon
              conceptKind={icon.conceptKind}
              presentation={icon.presentation}
              sizeRole={icon.sizeRole}
              progress={progress}
              statusMarkVariant={icon.statusMarkVariant}
              caption={graphNode ? normalizeNodeCopy(anchorNode?.label) : icon.caption}
              detail={graphNode ? normalizeNodeCopy(anchorNode?.detail) : null}
              layoutRole={icon.layoutRole}
              placement={icon.placement}
              participation={icon.participation}
              semanticObjectId={icon.semanticObjectId}
              ownerId={icon.ownerId}
              label={`${anchorNode?.label ?? icon.anchorId} 独立状态图标`}
              style={{
                left: slot.bounds.x,
                top: slot.bounds.y,
                width: slot.bounds.width,
                height: slot.bounds.height,
                zIndex: 3
              }}
            />
          </React.Fragment>
        );
      })}
      <div
        data-stage-caption-reading-anchor={
          subtitlePresentationMode === "semantic-cue"
            ? "suppressed-for-subtitle-cue"
            : shapeGrammarCueActive
              ? "suppressed-for-shape-legend"
              : "visible"
        }
        style={{
          position: "absolute",
          left: stageCaptionLayout.left,
          right: stageCaptionLayout.right,
          top: stageCaptionLayout.top,
          height: stageCaptionLayout.height,
          zIndex: 3
        }}
      >
        {suppressStageCaption ? null : (
          <StageCaption caption={stageCaption} copyOpacity={copyOpacity * detailOpacity} />
        )}
      </div>
      <ShapeGrammarLegend
        cue={spec.shapeGrammarCue}
        globalFrame={globalFrame}
        copyOpacity={copyOpacity * detailOpacity}
      />
    </div>
  );
}

function titleFontSize(title) {
  const length = [...String(title ?? "")].length;
  if (length >= 22) return 66;
  if (length >= 17) return 74;
  return typography.headlineWidePx;
}

function SceneLayer({ episode, layer, globalFrame, subtitlePresentationMode }) {
  const spec = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((item) => item.id === layer.sceneId);
  if (!spec) return null;
  const scene = episode?.scenes?.find((item) => item.id === layer.sceneId) ?? spec;
  const visualSceneCopy = longReviewVisualSceneCopy(spec.id, scene);
  const title = visualSceneCopy.title;
  const titleStartFrame = spec.startFrame - AGENT_SKILL_LONG_REVIEW_TITLE_PREROLL_FRAMES;
  return (
    <div
      style={{ position: "absolute", inset: 0, opacity: layer.opacity }}
      data-layer-scene-id={layer.sceneId}
      data-scene-kind={spec.kind}
      data-scene-title-source={visualSceneCopy.titleSource}
      data-episode-title-mismatch={visualSceneCopy.episodeTitleMismatch ? "true" : "false"}
    >
      <VisualSystemV1PopText
        startFrame={titleStartFrame}
        style={{
          position: "absolute",
          left: 120,
          right: 280,
          top: 110,
          zIndex: 4,
          color: palette.ink,
          fontSize: titleFontSize(title),
          fontWeight: typography.fontWeights.display,
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
          fontWeight: typography.fontWeights.supporting,
          lineHeight: 1.34,
          letterSpacing: "-.02em",
          whiteSpace: "nowrap",
          opacity: layer.copyOpacity
        }}
      >
        {visualSceneCopy.deck}
      </VisualSystemV1PopText>
      <TechnicalDiagram
        spec={spec}
        globalFrame={globalFrame}
        copyOpacity={layer.copyOpacity}
        diagramOpacity={layer.diagramOpacity}
        subtitlePresentationMode={subtitlePresentationMode}
      />
    </div>
  );
}

function subtitleCaptions(episode, activeSubtitle = null) {
  return longReviewDisplaySubtitles(episode?.subtitles ?? []).map((subtitle) => ({
    text: activeSubtitle != null &&
      activeSubtitle.start === subtitle.start && activeSubtitle.end === subtitle.end
      ? activeSubtitle.text
      : subtitle.text,
    startMs: subtitle.start * 1000,
    endMs: subtitle.end * 1000,
    timestampMs: null,
    confidence: null
  }));
}

export function AgentSkillLongReview({
  episode,
  burnInSubtitle = true,
  renderAudio = true
}) {
  const frame = useCurrentFrame();
  const layers = longReviewSceneLayersAtFrame(frame);
  const subtitleGate = longReviewSubtitleGateAtFrame(episode?.subtitles ?? [], frame);
  const captions = subtitleCaptions(episode, subtitleGate.activeSubtitle);
  const shapeGrammarLegendActive = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.some((spec) =>
    spec.shapeGrammarCue != null &&
    frame >= spec.shapeGrammarCue.startFrame &&
    frame < spec.shapeGrammarCue.endFrame
  );
  const finalScene = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.at(-1);
  const backdropFrame = frame >= finalScene.holdStartFrame
    ? finalScene.holdStartFrame
    : frame;
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
      <WideMovingBackdrop frameOverride={backdropFrame} />
      {renderAudio && episode?.voice?.publicPath
        ? <Audio src={staticFile(episode.voice.publicPath)} />
        : null}
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
            subtitlePresentationMode={subtitleGate.presentationMode}
          />
        ))}
      </div>
      <VisualSystemV1WideBrandLayer
        tone="quiet"
        motionCadence="continuous"
        transitionFrames={AGENT_SKILL_LONG_REVIEW_SCENE_START_FRAMES}
      />
      <div
        data-subtitle-title-gate={subtitleGate.mode}
        data-subtitle-shape-legend-gate={shapeGrammarLegendActive ? "hidden" : "visible"}
        data-subtitle-presentation={subtitleGate.presentationMode ?? "none"}
        data-subtitle-phase={subtitleGate.phase}
        data-subtitle-visual-weight={subtitleGate.visualWeight ?? "none"}
        style={{
          opacity: shapeGrammarLegendActive
            ? 0
            : subtitleGate.opacity * subtitleGate.presentationOpacity
        }}
      >
        {burnInSubtitle && subtitleGate.renderSubtitle ? (
          <VisualSystemV1PlainSubtitle
            captions={captions}
            visualWeight={subtitleGate.visualWeight ?? "primary"}
          />
        ) : null}
      </div>
      <VisualSystemV1ChapterProgress
        chapters={AGENT_SKILL_LONG_REVIEW_CHAPTERS}
        revealStartFrame={AGENT_SKILL_LONG_REVIEW_TITLE_PREROLL_FRAMES}
        revealDurationInFrames={8}
      />
    </AbsoluteFill>
  );
}
