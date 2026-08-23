import React from "react";

import { clamp01, staggeredProgress } from "../motion.mjs";
import {
  MOTION_FONT_FAMILY,
  MOTION_PALETTE
} from "./primitives.jsx";

const linePoints = Object.freeze([
  Object.freeze({ x: 72, y: 220, label: "01", value: 38 }),
  Object.freeze({ x: 190, y: 190, label: "02", value: 47 }),
  Object.freeze({ x: 308, y: 202, label: "03", value: 43 }),
  Object.freeze({ x: 426, y: 150, label: "04", value: 61 }),
  Object.freeze({ x: 544, y: 128, label: "05", value: 70 }),
  Object.freeze({ x: 662, y: 82, label: "06", value: 86 })
]);

const linePath = "M72 220 C122 220 140 190 190 190 C240 190 258 202 308 202 C358 202 376 150 426 150 C476 150 494 128 544 128 C594 128 612 82 662 82";

const barItems = Object.freeze([
  Object.freeze({ label: "规则", value: 58 }),
  Object.freeze({ label: "上下文", value: 76 }),
  Object.freeze({ label: "Agent", value: 92 }),
  Object.freeze({ label: "MCP", value: 68 }),
  Object.freeze({ label: "结果", value: 84 }),
  Object.freeze({ label: "人工", value: 64, purple: true })
]);

const sankeyNodes = Object.freeze([
  Object.freeze({ id: "material", x: 18, y: 54, width: 132, height: 52, label: "材料", detail: "42%" }),
  Object.freeze({ id: "rules", x: 18, y: 134, width: 132, height: 52, label: "规则", detail: "33%" }),
  Object.freeze({ id: "context", x: 18, y: 214, width: 132, height: 52, label: "上下文", detail: "25%" }),
  Object.freeze({ id: "agent", x: 326, y: 116, width: 154, height: 82, label: "Agent", detail: "受控路由", active: true }),
  Object.freeze({ id: "mcp", x: 650, y: 54, width: 132, height: 52, label: "MCP", detail: "46%" }),
  Object.freeze({ id: "result", x: 650, y: 134, width: 132, height: 52, label: "结果", detail: "34%" }),
  Object.freeze({ id: "human", x: 650, y: 214, width: 132, height: 52, label: "人工确认", detail: "20%", purple: true })
]);

const sankeyLinks = Object.freeze([
  Object.freeze({ d: "M150 80 C230 80 246 157 326 157", width: 18 }),
  Object.freeze({ d: "M150 160 C232 160 244 157 326 157", width: 14 }),
  Object.freeze({ d: "M150 240 C230 240 246 157 326 157", width: 11 }),
  Object.freeze({ d: "M480 157 C562 157 568 80 650 80", width: 19 }),
  Object.freeze({ d: "M480 157 C562 157 568 160 650 160", width: 14 }),
  Object.freeze({ d: "M480 157 C562 157 568 240 650 240", width: 9, purple: true })
]);

function EvidenceHeading({ eyebrow, title, value, valueDetail }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", minHeight: 48 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, color: MOTION_PALETTE.mintDeep, fontSize: 12, fontWeight: 850, letterSpacing: ".09em" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: MOTION_PALETTE.mint }} />
          {eyebrow}
        </div>
        <div style={{ marginTop: 7, color: MOTION_PALETTE.ink, fontSize: 25, fontWeight: 840, letterSpacing: "-.025em" }}>
          {title}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, color: MOTION_PALETTE.ink }}>
        <span style={{ fontSize: 34, fontWeight: 880, letterSpacing: "-.04em" }}>{value}</span>
        <span style={{ color: MOTION_PALETTE.muted, fontSize: 13, fontWeight: 680 }}>{valueDetail}</span>
      </div>
    </div>
  );
}

export function MonoRoundedLineEffect({ progress }) {
  const safeProgress = clamp01(progress);
  return (
    <div style={{ width: 760, height: 320, fontFamily: MOTION_FONT_FAMILY }}>
      <EvidenceHeading eyebrow="TREND EVIDENCE" title="任务成功率持续提升" value={`${Math.round(38 + (48 * safeProgress))}%`} valueDetail="最近 6 轮" />
      <svg width="760" height="254" viewBox="0 0 760 254" fill="none" aria-hidden="true" style={{ display: "block", marginTop: 14, overflow: "visible" }}>
        {[42, 92, 142, 192].map((y) => (
          <line key={y} x1="56" y1={y} x2="682" y2={y} stroke={MOTION_PALETTE.line} strokeWidth="1" opacity="0.72" />
        ))}
        <path d={linePath} stroke={MOTION_PALETTE.line} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity="0.54" />
        <path
          d={linePath}
          pathLength="1"
          stroke={MOTION_PALETTE.mint}
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1"
          strokeDashoffset={1 - safeProgress}
        />
        {linePoints.map((point, index) => {
          const pointProgress = staggeredProgress(safeProgress, index, linePoints.length, 0.68);
          return (
            <g key={point.label} opacity={0.18 + (pointProgress * 0.82)}>
              <circle cx={point.x} cy={point.y} r={5 + (pointProgress * 4)} fill={index === linePoints.length - 1 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint} stroke={MOTION_PALETTE.paperWarm} strokeWidth="4" />
              <text x={point.x} y="242" textAnchor="middle" fill={MOTION_PALETTE.muted} fontFamily={MOTION_FONT_FAMILY} fontSize="13" fontWeight="700">
                {point.label}
              </text>
              <text x={point.x} y={point.y - 17} textAnchor="middle" fill={index === linePoints.length - 1 ? MOTION_PALETTE.purpleDeep : MOTION_PALETTE.mintDeep} fontFamily={MOTION_FONT_FAMILY} fontSize="13" fontWeight="820">
                {Math.round(point.value * pointProgress)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function MonoRoundedBarEffect({ progress }) {
  const safeProgress = clamp01(progress);
  const baseline = 232;
  return (
    <div style={{ width: 760, height: 320, fontFamily: MOTION_FONT_FAMILY }}>
      <EvidenceHeading eyebrow="COMPARISON" title="各环节完成度" value={`${Math.round(74 * safeProgress)}%`} valueDetail="平均值" />
      <svg width="760" height="254" viewBox="0 0 760 254" fill="none" aria-hidden="true" style={{ display: "block", marginTop: 14 }}>
        {[62, 118, 174, baseline].map((y) => (
          <line key={y} x1="48" y1={y} x2="718" y2={y} stroke={MOTION_PALETTE.line} strokeWidth="1" opacity="0.72" />
        ))}
        {barItems.map((item, index) => {
          const itemProgress = staggeredProgress(safeProgress, index, barItems.length, 0.62);
          const fullHeight = item.value * 1.72;
          const height = fullHeight * itemProgress;
          const x = 66 + (index * 106);
          const color = item.purple ? MOTION_PALETTE.purple : MOTION_PALETTE.mint;
          const deep = item.purple ? MOTION_PALETTE.purpleDeep : MOTION_PALETTE.mintDeep;
          return (
            <g key={item.label}>
              <rect x={x} y={baseline - fullHeight} width="62" height={fullHeight} rx="18" fill={item.purple ? MOTION_PALETTE.purpleSoft : MOTION_PALETTE.mintSoft} />
              <rect x={x} y={baseline - height} width="62" height={height} rx="18" fill={color} />
              <text x={x + 31} y={baseline - fullHeight - 12} textAnchor="middle" fill={deep} fontFamily={MOTION_FONT_FAMILY} fontSize="14" fontWeight="830" opacity={itemProgress}>
                {Math.round(item.value * itemProgress)}
              </text>
              <text x={x + 31} y="251" textAnchor="middle" fill={MOTION_PALETTE.muted} fontFamily={MOTION_FONT_FAMILY} fontSize="13" fontWeight="700">
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SankeyNode({ node, progress }) {
  const color = node.purple ? MOTION_PALETTE.purple : MOTION_PALETTE.mint;
  const deep = node.purple ? MOTION_PALETTE.purpleDeep : MOTION_PALETTE.mintDeep;
  const soft = node.purple ? MOTION_PALETTE.purpleSoft : MOTION_PALETTE.mintSoft;
  return (
    <g opacity={0.22 + (progress * 0.78)}>
      <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="15" fill={node.active || node.purple ? soft : MOTION_PALETTE.paperWarm} stroke={node.active || node.purple ? color : MOTION_PALETTE.line} strokeWidth={node.active ? 2 : 1.4} />
      <text x={node.x + 16} y={node.y + 23} fill={node.active || node.purple ? deep : MOTION_PALETTE.ink} fontFamily={MOTION_FONT_FAMILY} fontSize={node.active ? 18 : 15} fontWeight="830">
        {node.label}
      </text>
      <text x={node.x + 16} y={node.y + (node.active ? 51 : 42)} fill={MOTION_PALETTE.muted} fontFamily={MOTION_FONT_FAMILY} fontSize="12" fontWeight="670">
        {node.detail}
      </text>
    </g>
  );
}

export function MonoRoundedSankeyEffect({ progress }) {
  const safeProgress = clamp01(progress);
  return (
    <div style={{ width: 800, height: 326, fontFamily: MOTION_FONT_FAMILY }}>
      <EvidenceHeading eyebrow="ROUTING EVIDENCE" title="输入经 Agent 分配到下一步" value="3→1→3" valueDetail="三层流向" />
      <svg width="800" height="270" viewBox="0 0 800 290" fill="none" aria-hidden="true" style={{ display: "block", marginTop: 10, overflow: "visible" }}>
        {sankeyLinks.map((link, index) => {
          const linkProgress = staggeredProgress(safeProgress, index, sankeyLinks.length, 0.7);
          const color = link.purple ? MOTION_PALETTE.purple : MOTION_PALETTE.mint;
          return (
            <g key={link.d}>
              <path d={link.d} stroke={MOTION_PALETTE.line} strokeWidth={link.width} strokeLinecap="round" opacity="0.52" />
              <path d={link.d} pathLength="1" stroke={color} strokeWidth={link.width} strokeLinecap="round" strokeDasharray="1" strokeDashoffset={1 - linkProgress} opacity="0.76" />
            </g>
          );
        })}
        {sankeyNodes.map((node, index) => (
          <SankeyNode key={node.id} node={node} progress={staggeredProgress(safeProgress, index, sankeyNodes.length, 0.5)} />
        ))}
      </svg>
    </div>
  );
}

function TransitionScene({ eyebrow, title, detail, purple = false }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: MOTION_PALETTE.paper, color: MOTION_PALETTE.ink, fontFamily: MOTION_FONT_FAMILY }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, color: purple ? MOTION_PALETTE.purpleDeep : MOTION_PALETTE.mintDeep, fontSize: 13, fontWeight: 850, letterSpacing: ".09em" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: purple ? MOTION_PALETTE.purple : MOTION_PALETTE.mint }} />
        {eyebrow}
      </div>
      <div style={{ marginTop: 13, fontSize: 43, fontWeight: 870, letterSpacing: "-.04em" }}>{title}</div>
      <div style={{ marginTop: 12, color: MOTION_PALETTE.muted, fontSize: 20, fontWeight: 630 }}>{detail}</div>
    </div>
  );
}

export function SplitGateRevealEffect({ progress, children }) {
  const safeProgress = clamp01(progress);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 300, overflow: "hidden", backgroundColor: MOTION_PALETTE.paper }}>
      {children ?? <TransitionScene eyebrow="NEXT CONTEXT" title="进入受控执行" detail="规则确认后，才开始调用外部能力" />}
      <div style={{ position: "absolute", inset: "0 50% 0 0", translate: `${-100 * safeProgress}% 0`, backgroundColor: MOTION_PALETTE.paperWarm, borderRight: `1px solid ${MOTION_PALETTE.mint}`, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 54, boxSizing: "border-box" }}>
        <div style={{ color: MOTION_PALETTE.mintDeep, fontFamily: MOTION_FONT_FAMILY, fontSize: 24, fontWeight: 840, whiteSpace: "nowrap" }}>规则边界</div>
      </div>
      <div style={{ position: "absolute", inset: "0 0 0 50%", translate: `${100 * safeProgress}% 0`, backgroundColor: MOTION_PALETTE.paperWarm, borderLeft: `1px solid ${MOTION_PALETTE.mint}`, display: "flex", alignItems: "center", justifyContent: "flex-start", paddingLeft: 54, boxSizing: "border-box" }}>
        <div style={{ color: MOTION_PALETTE.ink, fontFamily: MOTION_FONT_FAMILY, fontSize: 24, fontWeight: 840, whiteSpace: "nowrap" }}>执行结果</div>
      </div>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: "50%", backgroundColor: MOTION_PALETTE.purple, opacity: 1 - safeProgress, scale: 1 - (safeProgress * 0.35) }} />
    </div>
  );
}

export function RadialIrisMaskEffect({ progress, children }) {
  const safeProgress = clamp01(progress);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 300, overflow: "hidden", backgroundColor: MOTION_PALETTE.paper, fontFamily: MOTION_FONT_FAMILY }}>
      <TransitionScene eyebrow="CURRENT CONTEXT" title="自动执行结束" detail="结果已经返回，尚未自动通过" />
      <div style={{ position: "absolute", inset: 0, clipPath: `circle(${76 * safeProgress}% at 50% 50%)`, backgroundColor: MOTION_PALETTE.paperWarm }}>
        {children ?? <TransitionScene eyebrow="HUMAN GATE" title="等待人工确认" detail="是否采用结果，仍由人做最终决定" purple />}
      </div>
      <svg width="100%" height="100%" viewBox="0 0 760 300" preserveAspectRatio="none" fill="none" aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <circle cx="380" cy="150" r={420 * safeProgress} stroke={MOTION_PALETTE.mint} strokeWidth="3" opacity={1 - (safeProgress * 0.82)} />
      </svg>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: "50%", backgroundColor: MOTION_PALETTE.purple, opacity: 1 - safeProgress, scale: 0.8 + (safeProgress * 0.2) }} />
    </div>
  );
}
