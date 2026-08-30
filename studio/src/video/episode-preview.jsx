import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import {
  colors,
  Footer,
  phraseAwareTextStyle,
  PhraseText,
  ProgressStrip,
  sourceBadgeStyle,
  Subtitle
} from "./components/chrome.jsx";
import { AgentSkillFullVideo } from "./agent-skill-full-video.jsx";
import { AgentSkillShortExplainer } from "./agent-skill-short.jsx";
import { AGENT_SKILL_SHORT_EPISODE_ID } from "./agent-skill-short-plan.mjs";
import { ProductionSemanticPreview } from "./production-semantic-preview.jsx";
import { isProductionSemanticScene } from "./production-semantic-preview.mjs";

function activeItem(items, currentTime) {
  return items.find((item) => currentTime >= item.start && currentTime < item.end);
}

function TitleScene({ scene }) {
  return (
    <div style={{ paddingTop: 150 }}>
      <div style={sourceBadgeStyle}>{scene.kicker || "AI 概念拆解"}</div>
      <div
        style={{
          marginTop: 34,
          maxWidth: 460,
          color: colors.ink,
          fontSize: 60,
          fontWeight: 900,
          lineHeight: 1.08,
          letterSpacing: "-0.055em",
          whiteSpace: "pre-line",
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.title} />
      </div>
      <div
        style={{
          width: 70,
          height: 7,
          marginTop: 34,
          borderRadius: 6,
          backgroundColor: colors.orange
        }}
      />
      <div
        style={{
          marginTop: 26,
          maxWidth: 430,
          color: colors.muted,
          fontSize: 27,
          fontWeight: 650,
          lineHeight: 1.5,
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.subtitle} />
      </div>
    </div>
  );
}

function EvidenceScene({ scene, localFrame, fps }) {
  const zoom = interpolate(localFrame, [0, Math.max(1, (scene.end - scene.start) * fps)], [1, 1.035], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div style={{ paddingTop: 64 }}>
      <div style={sourceBadgeStyle}>{scene.label}</div>
      <div
        style={{
          position: "relative",
          height: 480,
          marginTop: 22,
          overflow: "hidden",
          border: `1px solid ${colors.line}`,
          borderRadius: 17,
          backgroundColor: colors.panel,
          boxShadow: "0 16px 38px rgba(32, 33, 36, 0.10)"
        }}
      >
        <Img
          src={staticFile(scene.asset)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "50% 12%",
            transform: `scale(${zoom})`
          }}
        />
      </div>
      <div
        style={{
          marginTop: 24,
          maxWidth: 470,
          color: colors.ink,
          fontSize: 35,
          fontWeight: 900,
          lineHeight: 1.18,
          letterSpacing: "-0.035em",
          whiteSpace: "pre-line",
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.title} />
      </div>
    </div>
  );
}

function StatementScene({ scene }) {
  return (
    <div style={{ paddingTop: 116 }}>
      <div
        style={{
          color: colors.orange,
          fontSize: 90,
          fontWeight: 900,
          letterSpacing: "-0.06em"
        }}
      >
        {scene.index}
      </div>
      <div
        style={{
          marginTop: 14,
          color: colors.muted,
          fontSize: 24,
          fontWeight: 800,
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.title} />
      </div>
      <div
        style={{
          marginTop: 45,
          padding: "38px 20px 42px",
          borderTop: `2px solid ${colors.ink}`,
          borderBottom: `1px solid ${colors.line}`,
          color: colors.ink,
          fontSize: 43,
          fontWeight: 900,
          lineHeight: 1.32,
          letterSpacing: "-0.045em",
          whiteSpace: "pre-line",
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.statement} />
      </div>
    </div>
  );
}

function SummaryScene({ scene }) {
  const items = ["模型", "工具", "环境", "反馈", "边界"];
  return (
    <div style={{ paddingTop: 110 }}>
      <div style={sourceBadgeStyle}>{scene.kicker}</div>
      <div
        style={{
          marginTop: 32,
          color: colors.ink,
          fontSize: 42,
          fontWeight: 900,
          letterSpacing: "-0.04em",
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.title} />
      </div>
      <div
        style={{
          marginTop: 34,
          color: colors.ink,
          fontSize: 46,
          fontWeight: 900,
          lineHeight: 1.3,
          letterSpacing: "-0.05em",
          whiteSpace: "pre-line",
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.statement} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 46 }}>
        {items.map((item, index) => (
          <div
            key={item}
            style={{
              padding: "11px 14px",
              border: `1px solid ${index === 0 ? colors.orange : colors.line}`,
              borderRadius: 8,
              backgroundColor: colors.panel,
              color: index === 0 ? colors.orange : colors.ink,
              fontSize: 20,
              fontWeight: 800
            }}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GenericEpisodePreview({ episode }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const currentTime = frame / fps;
  const scene = activeItem(episode.scenes, currentTime) ?? episode.scenes.at(-1);
  const sceneIndex = Math.max(0, episode.scenes.findIndex((item) => item.id === scene.id));
  const localFrame = frame - Math.round(scene.start * fps);
  const fade = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const rise = interpolate(localFrame, [0, 10], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const subtitle = activeItem(episode.subtitles ?? [], currentTime)?.text ?? scene.subtitle;
  const semanticScene = isProductionSemanticScene(scene);

  return (
    <AbsoluteFill
      lang="zh-CN"
      style={{
        backgroundColor: colors.paper,
        color: colors.ink,
        fontFamily: '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
      }}
    >
      {episode.voice?.publicPath ? <Audio src={staticFile(episode.voice.publicPath)} /> : null}
      {semanticScene ? (
        <ProductionSemanticPreview
          scene={scene}
          subtitle={subtitle}
          localFrame={localFrame}
          sceneIndex={sceneIndex}
          sceneWeights={episode.scenes.map((item) => Math.max(0.001, item.end - item.start))}
        />
      ) : null}
      {!semanticScene ? (
        <div style={{ position: "absolute", top: 28, left: 34, right: 34 }}>
          <ProgressStrip sceneIndex={sceneIndex} sceneCount={episode.scenes.length} />
        </div>
      ) : null}
      {!semanticScene ? (
        <>
          <div
            style={{
              position: "absolute",
              inset: "54px 34px 140px",
              opacity: fade,
              transform: `translateY(${rise}px)`
            }}
          >
            {scene.type === "title" ? <TitleScene scene={scene} /> : null}
            {scene.type === "evidence" ? (
              <EvidenceScene scene={scene} localFrame={localFrame} fps={fps} />
            ) : null}
            {scene.type === "statement" ? <StatementScene scene={scene} /> : null}
            {scene.type === "summary" ? <SummaryScene scene={scene} /> : null}
          </div>
          <Subtitle text={subtitle} />
        </>
      ) : null}
      {!semanticScene ? (
        <>
          <Footer scene={scene} sceneIndex={sceneIndex} />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`,
              height: 4,
              backgroundColor: colors.orange
            }}
          />
        </>
      ) : null}
    </AbsoluteFill>
  );
}

export function EpisodePreview({ episode }) {
  if (episode.scenes?.some((scene) => isProductionSemanticScene(scene))) {
    return <GenericEpisodePreview episode={episode} />;
  }
  if (episode.id === "agent-skill-20260806") return <AgentSkillFullVideo episode={episode} />;
  if (episode.id === AGENT_SKILL_SHORT_EPISODE_ID) {
    return <AgentSkillShortExplainer episode={episode} />;
  }
  return <GenericEpisodePreview episode={episode} />;
}
