import React from "react";
import {
  AbsoluteFill,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { PhraseText, Subtitle, phraseAwareTextStyle } from "./components/chrome.jsx";
import {
  AGENT_SKILL_SHORT_CHAPTERS,
  AGENT_SKILL_SHORT_CHAPTER_WEIGHTS,
  AGENT_SKILL_SHORT_NODE_ENTRY_OFFSET_PIXELS,
  AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS,
  agentSkillShortDiagramLayersAt,
  agentSkillShortDiagramStateAt,
  agentSkillShortProgressPixelsAt,
  agentSkillShortSceneAt
} from "./agent-skill-short-plan.mjs";

const palette = {
  paper: "#F4F6F3",
  ink: "#17201D",
  muted: "#69726E",
  line: "#D2D9D5",
  lineStrong: "#89948F",
  panel: "#FFFFFF",
  mint: "#47C4A1",
  mintSoft: "#DFF6EE",
  blue: "#5276E6",
  blueSoft: "#E8EDFF",
  purple: "#765BD8",
  purpleSoft: "#EEE9FF",
  orange: "#F2783A",
  orangeSoft: "#FFE9DD"
};

const diagramAccents = Object.freeze({
  mint: { stroke: palette.mint, soft: palette.mintSoft },
  blue: { stroke: palette.blue, soft: palette.blueSoft },
  purple: { stroke: palette.purple, soft: palette.purpleSoft },
  orange: { stroke: palette.orange, soft: palette.orangeSoft }
});

const chapterGrid = AGENT_SKILL_SHORT_CHAPTER_WEIGHTS.map(
  (duration) => `${duration}fr`
).join(" ");

function Backdrop() {
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: palette.paper }} />
      <AbsoluteFill
        style={{
          opacity: 0.26,
          backgroundImage:
            "linear-gradient(rgba(78,96,89,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(78,96,89,0.08) 1px, transparent 1px)",
          backgroundSize: "36px 36px"
        }}
      />
    </>
  );
}

function Header({ scene }) {
  return (
    <div style={{ position: "absolute", top: 54, left: 24, right: 24 }}>
      <div style={{ color: palette.ink, fontSize: 34, fontWeight: 920, lineHeight: 1.1, ...phraseAwareTextStyle }}>
        <PhraseText text={scene.title} />
      </div>
      <div style={{ marginTop: 8, color: palette.muted, fontSize: 18, fontWeight: 720, ...phraseAwareTextStyle }}>
        <PhraseText text={scene.statement} />
      </div>
    </div>
  );
}

function diagramGroups(diagramId) {
  if (diagramId === "architecture") {
    return [
      { id: "method-and-agent", x: 145, y: 0, width: 190, height: 214, nodeIds: ["skill-knowledge", "agent"] },
      { id: "execution-and-connection", x: 14, y: 246, width: 452, height: 286, nodeIds: ["tool-action", "mcp-protocol", "external-capability"] }
    ];
  }
  if (diagramId === "weeklyReport") {
    return [
      { id: "weekly-workflow", x: 26, y: 18, width: 428, height: 536, nodeIds: ["metric-definition", "anomaly-check", "structured-conclusion"] }
    ];
  }
  if (diagramId === "flow") {
    return [
      { id: "tool-actions", x: 4, y: 122, width: 472, height: 118, nodeIds: ["database-query", "document-write"] },
      { id: "protocol-roundtrip", x: 145, y: 260, width: 190, height: 388, nodeIds: ["mcp-protocol", "external-capability", "result"] }
    ];
  }
  return [
    { id: "tool-column", x: 4, y: 0, width: 233, height: 470, nodeIds: ["tool-only", "tool-action", "missing-method"] },
    { id: "skill-column", x: 243, y: 0, width: 233, height: 470, nodeIds: ["skill-only", "skill-method", "missing-execution"] }
  ];
}

function DiagramGroupBoundary({ group, nodeProgress }) {
  const progress = Math.max(...group.nodeIds.map((id) => nodeProgress[id] ?? 0));
  return (
    <rect
      x={group.x}
      y={group.y}
      width={group.width}
      height={group.height}
      rx={18}
      fill="rgba(255,255,255,0.24)"
      stroke="rgba(105,114,110,0.28)"
      strokeWidth={1}
      strokeDasharray="5 6"
      opacity={progress}
    />
  );
}

function DiagramEdge({
  edge,
  progress,
  markerId,
  focusMarkerId,
  highlightProgress,
  focusPresence,
  focusColor
}) {
  const color = edge.relation === "lacks" ? palette.orange : palette.lineStrong;
  const baseOpacity = progress * (
    1 - 0.46 * focusPresence * (1 - highlightProgress)
  );
  return (
    <>
      <path
        d={edge.path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - progress}
        markerEnd={`url(#${markerId})`}
        opacity={baseOpacity}
      />
      <path
        d={edge.path}
        fill="none"
        stroke={focusColor}
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - highlightProgress}
        markerEnd={`url(#${focusMarkerId})`}
        opacity={highlightProgress}
      />
    </>
  );
}

function DiagramNode({
  node,
  progress,
  diagramId,
  highlightProgress,
  focusPresence
}) {
  const accent = diagramAccents[node.accent] ?? diagramAccents.mint;
  const isMissing = node.dashed === true;
  const labelFontSize = node.width <= 155 ? 14.5 : 16;
  const detailFontSize = node.width <= 155 ? 11.5 : 12.5;
  const labelY = node.y + (node.height <= 72 ? 29 : 31);
  const detailY = node.y + (node.height <= 72 ? 50 : 54);
  const baseOpacity = progress * (
    1 - 0.42 * focusPresence * (1 - highlightProgress)
  );
  return (
    <g
      opacity={baseOpacity}
      transform={`translate(0 ${(1 - progress) * AGENT_SKILL_SHORT_NODE_ENTRY_OFFSET_PIXELS})`}
    >
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={14}
        fill={isMissing ? "rgba(255,255,255,0.52)" : "rgba(255,255,255,0.94)"}
        stroke={isMissing ? accent.stroke : "rgba(105,114,110,0.38)"}
        strokeWidth={isMissing ? 1.5 : 1}
        strokeDasharray={isMissing ? "7 6" : undefined}
        filter={`url(#diagram-shadow-${diagramId})`}
      />
      <rect
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rx={14}
        fill={accent.soft}
        fillOpacity={0.78}
        stroke={accent.stroke}
        strokeWidth={1.2 + 1.8 * highlightProgress}
        opacity={highlightProgress}
      />
      <rect
        x={node.x + 1}
        y={node.y + 1}
        width={5}
        height={node.height - 2}
        rx={3}
        fill={accent.stroke}
        opacity={isMissing ? 0.58 : 0.86}
      />
      <text
        x={node.x + 16}
        y={labelY}
        fill={isMissing ? palette.orange : palette.ink}
        fontSize={labelFontSize}
        fontWeight={850}
      >
        {node.label}
      </text>
      <text
        x={node.x + 16}
        y={detailY}
        fill={palette.muted}
        fontSize={detailFontSize}
        fontWeight={650}
      >
        {node.detail}
      </text>
    </g>
  );
}

function TechnicalDiagram({ diagramId, currentSecond, opacity = 1 }) {
  const diagram = AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS[diagramId];
  const state = agentSkillShortDiagramStateAt(diagramId, currentSecond);
  const markerId = `diagram-arrow-${diagramId}`;
  const focusPresence = Math.max(
    0,
    ...Object.values(state.nodeHighlightProgress),
    ...Object.values(state.edgeHighlightProgress)
  );
  return (
    <div style={{ position: "absolute", top: 150, left: 30, width: 480, height: 650, opacity }}>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 480 650"
        preserveAspectRatio="xMidYMin meet"
        aria-label={`${diagram.kind} diagram`}
        data-highlight-stage={state.highlightStageId ?? "none"}
      >
        <defs>
          <filter id={`diagram-shadow-${diagramId}`} x="-20%" y="-25%" width="140%" height="160%">
            <feDropShadow dx="0" dy="7" stdDeviation="8" floodColor="#183129" floodOpacity="0.08" />
          </filter>
          {diagram.edges.map((edge) => {
            const arrowProgress = state.edgeArrowProgress[edge.id] ?? 0;
            const highlightProgress = state.edgeHighlightProgress[edge.id] ?? 0;
            const highlightArrowProgress =
              state.edgeHighlightArrowProgress[edge.id] ?? 0;
            const color = edge.relation === "lacks" ? palette.orange : palette.lineStrong;
            const targetNode = diagram.nodes.find((node) => node.id === edge.to);
            const focusColor = (
              diagramAccents[targetNode?.accent] ?? diagramAccents.mint
            ).stroke;
            const baseArrowOpacity = arrowProgress * (
              1 - 0.46 * focusPresence * (1 - highlightProgress)
            );
            return (
              <React.Fragment key={edge.id}>
                <marker
                  id={`${markerId}-${edge.id}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    fill={color}
                    opacity={baseArrowOpacity}
                  />
                </marker>
                <marker
                  id={`${markerId}-${edge.id}-focus`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5.5"
                  markerHeight="5.5"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    fill={focusColor}
                    opacity={highlightArrowProgress}
                  />
                </marker>
              </React.Fragment>
            );
          })}
        </defs>
        {diagramGroups(diagramId).map((group) => (
          <DiagramGroupBoundary key={group.id} group={group} nodeProgress={state.nodeProgress} />
        ))}
        {diagram.edges.map((edge) => (
          <DiagramEdge
            key={edge.id}
            edge={edge}
            progress={state.edgeProgress[edge.id] ?? 0}
            markerId={`${markerId}-${edge.id}`}
            focusMarkerId={`${markerId}-${edge.id}-focus`}
            highlightProgress={state.edgeHighlightProgress[edge.id] ?? 0}
            focusPresence={focusPresence}
            focusColor={(
              diagramAccents[
                diagram.nodes.find((node) => node.id === edge.to)?.accent
              ] ?? diagramAccents.mint
            ).stroke}
          />
        ))}
        {diagram.nodes.map((node) => (
          <DiagramNode
            key={node.id}
            node={node}
            progress={state.nodeProgress[node.id] ?? 0}
            diagramId={diagramId}
            highlightProgress={state.nodeHighlightProgress[node.id] ?? 0}
            focusPresence={focusPresence}
          />
        ))}
      </svg>
    </div>
  );
}

function SceneBody({ scene, currentSecond }) {
  const transitionLayers = agentSkillShortDiagramLayersAt(currentSecond);
  if (transitionLayers.length > 1) {
    return transitionLayers.map((layer) => (
      <TechnicalDiagram
        key={layer.diagramId}
        diagramId={layer.diagramId}
        currentSecond={currentSecond}
        opacity={layer.opacity}
      />
    ));
  }
  if (["S01", "S02", "S03", "S04"].includes(scene.id)) {
    return <TechnicalDiagram diagramId="architecture" currentSecond={currentSecond} />;
  }
  if (scene.id === "S05") {
    return <TechnicalDiagram diagramId="weeklyReport" currentSecond={currentSecond} />;
  }
  if (["S06", "S07"].includes(scene.id)) {
    return <TechnicalDiagram diagramId="flow" currentSecond={currentSecond} />;
  }
  return <TechnicalDiagram diagramId="comparison" currentSecond={currentSecond} />;
}

function ChapterProgress({ currentSecond }) {
  const progressPixels = agentSkillShortProgressPixelsAt(currentSecond);
  const progressRatio = progressPixels / 540;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 36, borderTop: `1px solid ${palette.line}`, backgroundColor: "rgba(239,242,239,0.72)", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 540, backgroundColor: "rgba(128,139,133,0.22)", transform: `scaleX(${progressRatio})`, transformOrigin: "left center", willChange: "transform", backfaceVisibility: "hidden" }} />
      <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: chapterGrid }}>
        {AGENT_SKILL_SHORT_CHAPTERS.map((chapter, index) => (
          <div key={chapter.id} style={{ display: "grid", placeItems: "center", borderLeft: index === 0 ? "none" : "1px solid rgba(113,124,118,0.26)", color: palette.ink, fontSize: 11, fontWeight: 820, whiteSpace: "nowrap", overflow: "hidden" }}>
            {chapter.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentSkillShortExplainer({ episode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSecond = frame / fps;
  const plannedScene = agentSkillShortSceneAt(currentSecond);
  const scene = episode.scenes.find((item) => item.id === plannedScene.id) ?? episode.scenes.at(-1);
  const subtitle = (episode.subtitles ?? []).find((item) => currentSecond >= item.start && currentSecond < item.end)?.text ?? scene.subtitle;
  return (
    <AbsoluteFill lang="zh-CN" style={{ color: palette.ink, fontFamily: '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif' }}>
      <Backdrop />
      {episode.voice?.publicPath ? <Audio src={staticFile(episode.voice.publicPath)} /> : null}
      <Header scene={scene} />
      <SceneBody scene={scene} currentSecond={currentSecond} />
      <Subtitle text={subtitle} variant="outline" bottom={46} horizontalInset={4} fontSize={18} lineHeight={1.18} />
      <ChapterProgress currentSecond={currentSecond} />
    </AbsoluteFill>
  );
}
