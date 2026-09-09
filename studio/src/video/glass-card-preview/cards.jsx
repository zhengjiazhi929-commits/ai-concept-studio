import React from "react";
import { VIDEO_SANS_FONT_FAMILY } from "../font-system.mjs";
import { GLASS_CARD_MATERIAL as M, frostedCardStyle } from "./material.mjs";

export function FrostedCard({ title, body, width, minHeight, emphasis = false }) {
  if (typeof title !== "string" || !title.trim()) throw new TypeError("Glass card title is required");
  if (typeof body !== "string") throw new TypeError("Glass card body must be text");
  return <section data-glass-card={M.id} data-glass-emphasis={String(emphasis)} aria-label={title}
    style={frostedCardStyle({ width, minHeight, emphasis })}>
    <div aria-hidden="true" data-glass-optics="inner-rim" style={{ position: "absolute", inset: 5,
      borderRadius: M.radius - 5, border: "1px solid rgba(255,255,255,0.35)",
      boxShadow: "inset 0 1px 1px rgba(255,255,255,0.50)", pointerEvents: "none" }} />
    <h2 data-glass-title="true" style={{ position: "relative", margin: 0, fontFamily: VIDEO_SANS_FONT_FAMILY,
      fontSize: M.titleSize, fontWeight: 550, lineHeight: 1.3, color: M.ink,
      overflowWrap: "anywhere", wordBreak: "normal", letterSpacing: "-0.02em" }}>{title}</h2>
    {body && <p data-glass-body="true" style={{ position: "relative", margin: "22px 0 0", fontFamily: VIDEO_SANS_FONT_FAMILY,
      fontSize: M.bodySize, fontWeight: 450, lineHeight: 1.55, color: M.secondary,
      whiteSpace: "pre-line", overflowWrap: "anywhere", wordBreak: "normal" }}>{body}</p>}
  </section>;
}

function PlacedCard({ x, y, ...props }) {
  return <div style={{ position: "absolute", left: x, top: y }}><FrostedCard {...props} /></div>;
}

function HorizontalConnection({ x }) {
  return <svg data-glass-connection="horizontal" width={92} height={24} viewBox="0 0 92 24"
    aria-hidden="true" style={{ position: "absolute", left: x, top: 514 }}>
    <path d="M 4 12 H 76" fill="none" stroke={M.accent} strokeWidth={2.5} />
    <path d="M 74 6 L 86 12 L 74 18 Z" fill={M.accent} />
  </svg>;
}

export function GlassArtwork({ example }) {
  if (example === "single") return <PlacedCard x={480} y={344} width={960} minHeight={370}
    title="按需加载" body={"先匹配名称与描述\n再读取命中的完整内容"} />;
  if (example === "wide") return <PlacedCard x={280} y={342} width={1360} minHeight={384}
    title="Agent / 判断与验收"
    body={"先确认任务与能力边界，再选择执行顺序。\n检查结果、核对证据，最后决定采用或退回。"} />;
  if (example === "flow") return <>
    <HorizontalConnection x={608} /><HorizontalConnection x={1220} />
    <PlacedCard x={108} y={390} width={488} minHeight={284} title="触发条件" body={"什么任务适用\n什么时候调用"} />
    <PlacedCard x={720} y={390} width={488} minHeight={284} title="执行步骤" body={"按顺序完成操作\n保留过程证据"} />
    <PlacedCard x={1332} y={390} width={480} minHeight={284} title="验收结果" body={"核对完成标准\n决定采用或退回"} emphasis />
  </>;
  throw new RangeError(`Unknown glass example: ${example}`);
}
