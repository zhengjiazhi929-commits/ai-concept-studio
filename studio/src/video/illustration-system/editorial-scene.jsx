import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { VisualSystemV1AiWatermark } from "../components/visual-system-v1/ai-watermark.jsx";
import { VISUAL_SYSTEM_V1 } from "../components/visual-system-v1/tokens.mjs";
import { VIDEO_SANS_FONT_FAMILY } from "../font-system.mjs";
import { EDITORIAL_PLAN, editorialFrameState } from "./editorial-plan.mjs";

const C = VISUAL_SYSTEM_V1.palette;
const border = VISUAL_SYSTEM_V1.surfaceBorder.informationCard.restingColor;
const clamp = (value) => Math.max(0, Math.min(1, value));

function Label({ x, y, children, size = 44, fill = C.ink, weight = 550, anchor = "start", ...rest }) {
  return <text {...rest} x={x} y={y} fontSize={size} fill={fill} stroke="none"
    fontWeight={weight} textAnchor={anchor}>{children}</text>;
}

function pageOutline(width, height) {
  return `M 12 0 H ${width - 28} L ${width} 28 V ${height - 12} Q ${width} ${height} ${width - 12} ${height} H 12 Q 0 ${height} 0 ${height - 12} V 12 Q 0 0 12 0 Z`;
}

// A name/description index is not the complete body. The page silhouette makes
// copying and unfolding readable without putting a decorative icon next to text.
export function IndexPage({ item, description = item.description }) {
  const compact = clamp((280 - item.height) / 155);
  const stroke = item.selected ? C.mintDeep : border;
  return <g data-editorial-object="index-page" data-source-retained={String(item.retained)}
    transform={`translate(${item.x} ${item.y})`}>
    <path d={pageOutline(item.width, item.height)} fill={item.selected ? C.mintSoft : C.paperWarm}
      stroke={stroke} strokeWidth={3} data-editorial-outline="index" />
    <path d={`M ${item.width - 28} 0 V 28 H ${item.width}`} fill="none" stroke={stroke} strokeWidth={2} />
    {compact < 0.02 && <g opacity={1 - compact / 0.02}>
      <Label x={32} y={38} size={25} fill={C.muted} weight={500}>名称</Label>
      <Label x={32} y={143} size={25} fill={C.muted} weight={500}>描述</Label>
      <path d={`M 32 224 H ${item.width - 32}`} stroke={C.lineStrong} strokeWidth={2} />
      <Label x={32} y={258} size={24} fill={item.selected ? C.mintDeep : C.muted} weight={500}>
        {item.selected ? "与当前任务匹配" : "完整内容尚未读取"}
      </Label>
    </g>}
    <Label data-editorial-label="name" x={32} y={82 - 30 * compact}>{item.label}</Label>
    <Label x={32} y={192 - 98 * compact} size={28} fill={C.muted} weight={500}>{description}</Label>
  </g>;
}

// Expansion changes the paper geometry, not font scale. Rows enter only after
// the page has enough room for the complete glyphs and bottom clearance.
export function UnfoldingPage({ rect, title = "命中内容", expansion, stepsVisible, qaVisible }) {
  return <g data-editorial-object="content-copy" transform={`translate(${rect.x} ${rect.y})`}>
    <path d={pageOutline(rect.width, rect.height)} fill={C.paperWarm} stroke={C.mintDeep}
      strokeWidth={3} data-editorial-outline="copy"
      style={{ filter: "drop-shadow(0px 7px 6px rgba(28, 78, 59, 0.10))" }} />
    <path d={`M ${rect.width - 28} 0 V 28 H ${rect.width}`} fill="none" stroke={C.mintDeep} strokeWidth={2} />
    <Label x={30} y={53}>{title}</Label>
    <Label x={rect.width - 40} y={51} anchor="end" size={28} fill={C.mintDeep}>副本</Label>
    {expansion === 0 && <Label x={30} y={98} size={28} fill={C.muted} weight={500}>完整内容 · 按需读取</Label>}
    {expansion > 0 && <path d={`M 28 91 H ${rect.width - 28}`} stroke={border} strokeWidth={2} />}
    {stepsVisible && <Label x={30} y={178} fill={C.mintDeep}>执行步骤</Label>}
    {qaVisible && <Label x={30} y={240} fill={C.mintDeep}>验收标准</Label>}
  </g>;
}

export function ContextWindow({ rect, loaded, waiting }) {
  return <g data-editorial-object="context" transform={`translate(${rect.x} ${rect.y})`}>
    <rect width={rect.width} height={rect.height} rx={18} fill={C.paperWarm}
      stroke={loaded ? C.mintDeep : border} strokeWidth={3} data-editorial-outline="context" />
    <path d={`M 0 90 H ${rect.width}`} stroke={border} strokeWidth={2} />
    <Label x={30} y={60}>上下文</Label>
    <Label x={rect.width - 30} y={57} anchor="end" size={28} fill={C.muted} weight={500}>本次任务</Label>
    {waiting && <Label x={rect.width / 2} y={280} anchor="middle" size={30} fill={C.muted} weight={500}>等待命中内容</Label>}
    {loaded && <Label x={rect.width / 2} y={454} anchor="middle" size={28} fill={C.mintDeep} weight={500}>完整内容已载入</Label>}
  </g>;
}

export function EditorialArtwork({ frame }) {
  const state = editorialFrameState(frame);
  const g = EDITORIAL_PLAN.geometry;
  return <svg viewBox="0 0 1920 1080" width={1920} height={1080}
    aria-label="先匹配名称和描述，再展开命中内容的副本并载入上下文"
    style={{ position: "absolute", inset: 0, fontFamily: VIDEO_SANS_FONT_FAMILY }}>
    <Label x={140 + 30 * (1 - state.reflowProgress)} y={360 - 45 * state.reflowProgress}
      size={30} fill={C.muted} weight={500}>
      {state.reflowProgress < 1 ? "Skill 目录 · 先看名称与描述" : "Skill 目录 · 原件保留"}
    </Label>
    {state.contextVisible && <ContextWindow rect={g.context} loaded={state.loaded} waiting={frame < 330} />}
    {state.sources.map((item) => <IndexPage key={item.index} item={item} />)}
    {state.packetVisible && <UnfoldingPage rect={state.packet} title={state.packetLabel} expansion={state.expansion}
      stepsVisible={state.stepsVisible} qaVisible={state.qaVisible} />}
    {frame >= 300 && frame < 330 && <Label x={875} y={785} anchor="middle" size={30} fill={C.mintDeep} weight={500}>只展开命中项</Label>}
    {state.cueVisible && <Label x={960} y={925} anchor="middle" size={44}>{state.cue}</Label>}
  </svg>;
}

export function EditorialScene() {
  const frame = useCurrentFrame();
  const state = editorialFrameState(frame);
  return <AbsoluteFill style={{ backgroundColor: C.paper, color: C.ink, fontFamily: VIDEO_SANS_FONT_FAMILY,
    backgroundImage: "radial-gradient(ellipse at 92% 3%, rgba(67,184,145,0.09), transparent 38%)" }}>
    <div style={{ position: "absolute", left: 100, top: 45, fontSize: 26, color: C.mintDeep, fontWeight: 550 }}>AI 直通车 · 动画插画样片</div>
    <div style={{ position: "absolute", left: 100, top: 112, fontSize: 84, lineHeight: 1.15, fontWeight: 550 }}>
      按需加载，不是整库搬入
    </div>
    <div style={{ position: "absolute", left: 102, top: 232, fontSize: 36, fontWeight: 500, color: C.mintDeep }}>
      当前任务：{state.copy.task}
    </div>
    <EditorialArtwork frame={frame} />
    <VisualSystemV1AiWatermark profile="approved-v013-stable-footprint" motionCadence="continuous" />
    <div style={{ position: "absolute", left: 100, bottom: 44, fontSize: 25, color: C.muted, fontWeight: 500 }}>
      名称与描述 → 选择 → 展开 → 载入
    </div>
    <div style={{ position: "absolute", right: 100, bottom: 44, fontSize: 25, color: C.muted, fontWeight: 500 }}>
      20 秒样片 · 无旁白
    </div>
  </AbsoluteFill>;
}
