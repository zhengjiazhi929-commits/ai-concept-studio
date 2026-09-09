import React from "react";
import { AbsoluteFill, Composition } from "remotion";
import { VisualSystemV1AiWatermark } from "../components/visual-system-v1/ai-watermark.jsx";
import { VIDEO_SANS_FONT_FAMILY } from "../font-system.mjs";
import { GLASS_CARD_MATERIAL as M } from "./material.mjs";
import { GlassArtwork } from "./cards.jsx";

export function GlassCardScene({ example, title, caption }) {
  return <AbsoluteFill style={{ backgroundColor: M.background, color: M.ink,
    fontFamily: VIDEO_SANS_FONT_FAMILY,
    backgroundImage: "radial-gradient(ellipse at 88% 8%, rgba(67,184,145,0.055), transparent 42%)" }}>
    <h1 style={{ position: "absolute", left: 108, top: 106, margin: 0,
      fontSize: 76, lineHeight: 1.24, fontWeight: 550, letterSpacing: "-0.025em" }}>{title}</h1>
    <GlassArtwork example={example} />
    <p style={{ position: "absolute", left: 108, right: 108, top: 830, margin: 0,
      fontSize: 36, fontWeight: 450, lineHeight: 1.5, color: M.secondary }}>{caption}</p>
    <VisualSystemV1AiWatermark profile="approved-v013-stable-footprint" motionCadence="continuous" />
    <div style={{ position: "absolute", left: 108, bottom: 54, fontSize: 25, color: M.secondary }}>
      AI 直通车 · 卡片材质样张
    </div>
    <div style={{ position: "absolute", right: 108, bottom: 54, fontSize: 25, color: M.secondary }}>
      轻薄微磨砂 · 待视觉确认
    </div>
  </AbsoluteFill>;
}

export function GlassCardPreviewRoot() {
  return <>
    <Composition id="GlassCardSingle" component={GlassCardScene} width={1920} height={1080} fps={30} durationInFrames={1}
      defaultProps={{ example: "single", title: "只在需要时，加载完整内容", caption: "名称与描述先匹配，命中之后再读取。" }} />
    <Composition id="GlassCardWide" component={GlassCardScene} width={1920} height={1080} fps={30} durationInFrames={1}
      defaultProps={{ example: "wide", title: "先看清边界，再做判断", caption: "内容较长时拓宽卡片，保持文字大小与阅读间距。" }} />
    <Composition id="GlassCardFlow" component={GlassCardScene} width={1920} height={1080} fps={30} durationInFrames={1}
      defaultProps={{ example: "flow", title: "让步骤和结果，都有清楚的来路", caption: "先确认任务，再执行，最后核对结果。" }} />
  </>;
}
