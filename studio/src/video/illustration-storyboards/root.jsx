import React from "react";
import { AbsoluteFill, Composition, useCurrentFrame } from "remotion";
import { VisualSystemV1AiWatermark } from "../components/visual-system-v1/ai-watermark.jsx";
import { VIDEO_SANS_FONT_FAMILY } from "../font-system.mjs";
import { STORYBOARDS, STORYBOARD_STYLE as S, storyboardState } from "./plan.mjs";
import { StoryboardArtwork } from "./artwork.jsx";
import { StoryboardAssetsReady } from "./assets-ready.jsx";

export function StoryboardScene({ id }) {
  const phase = useCurrentFrame();
  const state = storyboardState(id, phase);
  const board = STORYBOARDS.find((item) => item.id === id);
  return <AbsoluteFill style={{ backgroundColor: S.background, color: S.ink,
    fontFamily: VIDEO_SANS_FONT_FAMILY,
    backgroundImage: "radial-gradient(ellipse at 85% 8%, rgba(67,184,145,0.06), transparent 48%)" }}>
    <h1 style={{ position: "absolute", left: 108, top: 92, margin: 0,
      fontSize: 72, fontWeight: 550, lineHeight: 1.25, letterSpacing: "-0.025em" }}>{board.title}</h1>
    <p style={{ position: "absolute", left: 112, top: 197, margin: 0,
      fontSize: 34, fontWeight: 450, color: S.secondary }}>{board.subtitle}</p>
    <StoryboardArtwork id={id} phase={phase} />
    <p style={{ position: "absolute", left: 112, top: 265, margin: 0,
      fontSize: 30, fontWeight: 500, color: S.accent }}>{state.phaseLabel}</p>
    <p style={{ position: "absolute", left: 112, top: 996, margin: 0,
      fontSize: 30, fontWeight: 450, color: S.secondary }}>{state.caption}</p>
    <VisualSystemV1AiWatermark profile="approved-v013-stable-footprint" motionCadence="continuous" />
    <StoryboardAssetsReady key={`${id}-${phase}`} phase={phase} />
  </AbsoluteFill>;
}

export function IllustrationStoryboardsRoot() {
  return <>
    <Composition id="IllustrationLoadBoard" component={StoryboardScene} width={1920} height={1080}
      fps={30} durationInFrames={3} defaultProps={{ id: "load" }} />
    <Composition id="IllustrationToolBoard" component={StoryboardScene} width={1920} height={1080}
      fps={30} durationInFrames={3} defaultProps={{ id: "tool" }} />
    <Composition id="IllustrationRouteBoard" component={StoryboardScene} width={1920} height={1080}
      fps={30} durationInFrames={3} defaultProps={{ id: "route" }} />
  </>;
}
