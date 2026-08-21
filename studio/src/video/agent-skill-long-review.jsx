import React from "react";
import {
  AbsoluteFill,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

import {
  AGENT_SKILL_LONG_BACKGROUND_VARIANTS,
  AgentSkillLongBackdrop
} from "./agent-skill-long-backgrounds.jsx";
import { PhraseText, Subtitle, phraseAwareTextStyle } from "./components/chrome.jsx";
import {
  AGENT_SKILL_LONG_REVIEW_CHAPTERS,
  AGENT_SKILL_LONG_REVIEW_SCENE_SPECS,
  longReviewDiagramStateAtFrame,
  longReviewProgressAtFrame,
  longReviewSceneLayersAtFrame
} from "./agent-skill-long-review-plan.mjs";

const palette = Object.freeze({
  paper: "#F4F6F3",
  panel: "#FFFFFF",
  ink: "#17201D",
  muted: "#69726E",
  line: "#D2D9D5",
  lineStrong: "#89948F",
  mint: "#47C4A1",
  mintSoft: "#DFF6EE",
  blue: "#5276E6",
  blueSoft: "#E8EDFF",
  purple: "#765BD8",
  purpleSoft: "#EEE9FF",
  orange: "#F2783A",
  orangeSoft: "#FFE9DD",
  red: "#CF5B56",
  redSoft: "#FBE5E3"
});

const accents = Object.freeze({
  mint: { stroke: palette.mint, soft: palette.mintSoft },
  blue: { stroke: palette.blue, soft: palette.blueSoft },
  purple: { stroke: palette.purple, soft: palette.purpleSoft },
  orange: { stroke: palette.orange, soft: palette.orangeSoft },
  red: { stroke: palette.red, soft: palette.redSoft }
});

const chapterGrid = AGENT_SKILL_LONG_REVIEW_CHAPTERS
  .map((chapter) => `${chapter.endSecond - chapter.startSecond}fr`)
  .join(" ");

function activeTimedItem(items, second) {
  return items.find((item) => second >= item.start && second < item.end) ?? null;
}

function smoothStep(value) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return clamped * clamped * (3 - 2 * clamped);
}

function SceneHeader({ scene, spec }) {
  return (
    <div style={{ position: "absolute", top: 50, left: 24, right: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: palette.muted,
          fontSize: 12,
          fontWeight: 840,
          letterSpacing: "0.04em"
        }}
      >
        <span>{spec.chapterLabel}</span>
        <span>{spec.id}</span>
      </div>
      <div
        style={{
          marginTop: 10,
          color: palette.ink,
          fontSize: 31,
          fontWeight: 920,
          lineHeight: 1.08,
          letterSpacing: "-0.035em",
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.title ?? spec.title} />
      </div>
      <div
        style={{
          marginTop: 7,
          color: palette.muted,
          fontSize: 15,
          fontWeight: 720,
          lineHeight: 1.26,
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={spec.deck ?? scene.statement ?? ""} />
      </div>
    </div>
  );
}

function Edge({ edge, lineProgress, arrowProgress, activeProgress, sceneId }) {
  const color = edge.relation === "warning"
    ? palette.orange
    : (accents[edge.accent]?.stroke ?? palette.mint);
  const markerId = `long-review-arrow-${sceneId}-${edge.id}`;
  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5.4"
          markerHeight="5.4"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} opacity={arrowProgress} />
        </marker>
      </defs>
      <path
        d={edge.path}
        fill="none"
        stroke={color}
        strokeWidth={2 + 1.1 * activeProgress}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - lineProgress}
        markerEnd={`url(#${markerId})`}
        opacity={lineProgress * (0.62 + 0.38 * activeProgress)}
      />
    </>
  );
}

function SvgTextLines({ x, y, lines, fontSize, fontWeight, fill, lineGap }) {
  return (
    <text x={x} y={y} fill={fill} fontSize={fontSize} fontWeight={fontWeight}>
      {lines.map((line, index) => (
        <tspan key={`${index}-${line}`} x={x} dy={index === 0 ? 0 : lineGap}>
          {line}
        </tspan>
      ))}
    </text>
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
    flexDirection: "column",
    justifyContent: "center"
  };
  const renderText = (label, index, opacity) => (
    <div key={`${index}-${label}`} style={{ ...captionStyle, opacity }}>
      <div
        style={{
          marginTop: 0,
          color: palette.ink,
          fontSize: 13,
          fontWeight: 780,
          lineHeight: 1.28,
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={label ?? ""} />
      </div>
    </div>
  );
  return (
    <div style={{ position: "relative", width: "100%", minHeight: 42 }}>
      {state.previousStageLabel != null
        ? renderText(state.previousStageLabel, Math.max(0, state.stageIndex - 1), 1 - progress)
        : null}
      {renderText(state.stageLabel, state.stageIndex, progress)}
    </div>
  );
}

function EvidenceSourceChip({ material }) {
  if (!material) return null;
  const match = String(material).match(/material-v(\d+)\.png$/u);
  const label = match ? `原始材料 ${match[1]}` : "原始材料";
  return (
    <div
      data-evidence-source={material}
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 2px",
        color: palette.muted,
        fontSize: 9.5,
        fontWeight: 800,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap"
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          backgroundColor: palette.orange
        }}
      />
      {label}
    </div>
  );
}

function Node({ node, progress, activeProgress, sceneId }) {
  const accent = accents[node.accent] ?? accents.mint;
  const labelLines = Array.isArray(node.label) ? node.label : String(node.label ?? "").split("\n");
  const detailLines = Array.isArray(node.detail) ? node.detail : String(node.detail ?? "").split("\n").filter(Boolean);
  const compact = node.width <= 142;
  const labelSize = compact ? 14 : 16;
  const detailSize = compact ? 10.5 : 11.5;
  const dashed = node.dashed === true;
  return (
    <g
      opacity={progress}
      transform={`translate(0 ${(1 - progress) * 12})`}
      data-node-id={node.id}
      data-active-progress={activeProgress.toFixed(4)}
    >
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={14}
        fill={dashed ? "rgba(255,255,255,0.58)" : "rgba(255,255,255,0.96)"}
        stroke={accent.stroke}
        strokeOpacity={dashed ? 0.7 : 0.34 + 0.66 * activeProgress}
        strokeWidth={dashed ? 1.5 : 1 + 1.6 * activeProgress}
        strokeDasharray={dashed ? "7 6" : undefined}
        filter={`url(#long-review-shadow-${sceneId})`}
      />
      <rect
        x={node.x + 1}
        y={node.y + 1}
        width={5}
        height={node.height - 2}
        rx={3}
        fill={accent.stroke}
        opacity={0.72 + 0.28 * activeProgress}
      />
      <rect
        x={node.x + 1}
        y={node.y + 1}
        width={node.width - 2}
        height={node.height - 2}
        rx={13}
        fill={accent.soft}
        opacity={0.7 * activeProgress}
      />
      <SvgTextLines
        x={node.x + 16}
        y={node.y + 28}
        lines={labelLines}
        fontSize={labelSize}
        fontWeight={860}
        fill={dashed ? palette.orange : palette.ink}
        lineGap={18}
      />
      {detailLines.length > 0 ? (
        <SvgTextLines
          x={node.x + 16}
          y={node.y + node.height - 19 - Math.max(0, detailLines.length - 1) * 14}
          lines={detailLines}
          fontSize={detailSize}
          fontWeight={650}
          fill={palette.muted}
          lineGap={14}
        />
      ) : null}
    </g>
  );
}

function TechnicalDiagram({ spec, globalFrame }) {
  const state = longReviewDiagramStateAtFrame(spec.id, globalFrame);
  return (
    <div
      style={{ position: "absolute", top: 150, left: 30, width: 480, height: 650 }}
      data-scene-id={spec.id}
      data-stage-id={state.stageId ?? "none"}
      data-final-hold={state.finalHold ? "true" : "false"}
    >
      <svg width="100%" height="100%" viewBox="0 0 480 650" preserveAspectRatio="xMidYMin meet">
        <defs>
          <filter id={`long-review-shadow-${spec.id}`} x="-20%" y="-25%" width="140%" height="160%">
            <feDropShadow dx="0" dy="7" stdDeviation="8" floodColor="#183129" floodOpacity="0.08" />
          </filter>
        </defs>
        {spec.groups?.map((group) => {
          const visible = Math.max(...group.nodeIds.map((id) => state.nodeProgress[id] ?? 0), 0);
          return (
            <rect
              key={group.id}
              x={group.x}
              y={group.y}
              width={group.width}
              height={group.height}
              rx={18}
              fill="rgba(255,255,255,0.22)"
              stroke="rgba(105,114,110,0.27)"
              strokeWidth={1}
              strokeDasharray="5 6"
              opacity={visible}
            />
          );
        })}
        {spec.edges.map((edge) => (
          <Edge
            key={edge.id}
            edge={edge}
            lineProgress={state.edgeProgress[edge.id] ?? 0}
            arrowProgress={state.edgeArrowProgress[edge.id] ?? 0}
            activeProgress={state.edgeHighlightProgress[edge.id] ?? 0}
            sceneId={spec.id}
          />
        ))}
        {spec.nodes.map((node) => (
          <Node
            key={node.id}
            node={node}
            progress={state.nodeProgress[node.id] ?? 0}
            activeProgress={state.nodeHighlightProgress[node.id] ?? 0}
            sceneId={spec.id}
          />
        ))}
      </svg>
      <div
        style={{
          position: "absolute",
          left: 14,
          right: 14,
          bottom: 12,
          minHeight: 42,
          display: "flex",
          alignItems: "center",
          padding: "0 13px",
          border: `1px solid ${palette.line}`,
          borderRadius: 12,
          backgroundColor: "rgba(255,255,255,0.9)",
          color: palette.ink,
          fontSize: 13,
          fontWeight: 780,
          lineHeight: 1.28,
          gap: 10,
          ...phraseAwareTextStyle
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <StageCaption state={state} />
        </div>
        {spec.kind === "native-evidence" ? <EvidenceSourceChip material={spec.material} /> : null}
      </div>
    </div>
  );
}

function SceneLayer({ episode, layer, globalFrame }) {
  const spec = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((item) => item.id === layer.sceneId);
  const scene = episode.scenes.find((item) => item.id === layer.sceneId) ?? spec;
  if (!spec) return null;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: layer.opacity }} data-layer-scene-id={layer.sceneId}>
      <SceneHeader scene={scene} spec={spec} />
      <TechnicalDiagram spec={spec} globalFrame={globalFrame} />
    </div>
  );
}

function ChapterProgress({ frame }) {
  const progress = longReviewProgressAtFrame(frame);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 36,
        overflow: "hidden",
        borderTop: `1px solid ${palette.line}`,
        backgroundColor: "rgba(239,242,239,0.76)"
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 540,
          backgroundColor: "rgba(128,139,133,0.22)",
          transform: `scaleX(${progress})`,
          transformOrigin: "left center",
          willChange: "transform",
          backfaceVisibility: "hidden"
        }}
      />
      <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: chapterGrid }}>
        {AGENT_SKILL_LONG_REVIEW_CHAPTERS.map((chapter, index) => (
          <div
            key={chapter.id}
            style={{
              display: "grid",
              placeItems: "center",
              borderLeft: index === 0 ? "none" : "1px solid rgba(113,124,118,0.26)",
              color: palette.ink,
              fontSize: 11,
              fontWeight: 820,
              whiteSpace: "nowrap",
              overflow: "hidden"
            }}
          >
            {chapter.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentSkillLongReview({
  episode,
  backgroundVariant = AGENT_SKILL_LONG_BACKGROUND_VARIANTS.paper,
  backgroundMaterial = null,
  backgroundFrameOffset = 0
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const second = frame / fps;
  const layers = longReviewSceneLayersAtFrame(frame);
  const subtitle = activeTimedItem(episode.subtitles ?? [], second);
  const subtitleStartFrame = subtitle ? Math.ceil(subtitle.start * fps) : frame;
  const subtitleOpacity = smoothStep((frame - subtitleStartFrame + 1) / 5);
  return (
    <AbsoluteFill
      lang="zh-CN"
      style={{
        color: palette.ink,
        fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
        overflow: "hidden"
      }}
    >
      <AgentSkillLongBackdrop
        variant={backgroundVariant}
        material={backgroundMaterial}
        frame={frame - backgroundFrameOffset}
        fps={fps}
      />
      {episode.voice?.publicPath ? <Audio src={staticFile(episode.voice.publicPath)} /> : null}
      {layers.map((layer) => (
        <SceneLayer
          key={`${layer.sceneId}-${layer.role ?? "current"}`}
          episode={episode}
          layer={layer}
          globalFrame={frame}
        />
      ))}
      <div style={{ opacity: subtitleOpacity }}>
        <Subtitle
          text={subtitle?.text ?? ""}
          variant="outline"
          bottom={46}
          horizontalInset={5}
          fontSize={18}
          lineHeight={1.18}
        />
      </div>
      <ChapterProgress frame={frame} />
    </AbsoluteFill>
  );
}
