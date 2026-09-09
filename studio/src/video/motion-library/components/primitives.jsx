import React from "react";
import { VIDEO_SANS_FONT_FAMILY } from "../../font-system.mjs";

export const MOTION_PALETTE = Object.freeze({
  paper: "#F6F8F6",
  paperWarm: "#FCFEFC",
  ink: "#12221D",
  muted: "#66736E",
  line: "#CAD7D1",
  mint: "#39B98F",
  mintDeep: "#17795D",
  mintSoft: "#DDF7ED",
  purple: "#8067D9",
  purpleDeep: "#5B45AA",
  purpleSoft: "#EEE9FF"
});

export const MOTION_FONT_FAMILY = VIDEO_SANS_FONT_FAMILY;

export function DemoText({ eyebrow = "AGENT FLOW", title = "结果已经返回", detail = "等待人工确认后再进入下一步", style = {} }) {
  return (
    <div style={{ width: 520, textAlign: "left", ...style }}>
      <div style={{ color: MOTION_PALETTE.mintDeep, fontSize: 15, fontWeight: 850, letterSpacing: ".09em" }}>
        {eyebrow}
      </div>
      <div style={{ marginTop: 10, color: MOTION_PALETTE.ink, fontSize: 50, fontWeight: 860, lineHeight: 1.12, letterSpacing: "-.035em" }}>
        {title}
      </div>
      <div style={{ marginTop: 13, color: MOTION_PALETTE.muted, fontSize: 23, fontWeight: 620, lineHeight: 1.4 }}>
        {detail}
      </div>
    </div>
  );
}

export function FlatCard({ marker, title, detail, accent = "mint", style = {}, children }) {
  const color = accent === "purple" ? MOTION_PALETTE.purple : MOTION_PALETTE.mint;
  const colorDeep = accent === "purple" ? MOTION_PALETTE.purpleDeep : MOTION_PALETTE.mintDeep;
  const colorSoft = accent === "purple" ? MOTION_PALETTE.purpleSoft : MOTION_PALETTE.mintSoft;
  return (
    <div
      style={{
        width: 164,
        height: 116,
        boxSizing: "border-box",
        border: `1px solid ${MOTION_PALETTE.line}`,
        borderRadius: 18,
        backgroundColor: MOTION_PALETTE.paperWarm,
        padding: "17px 18px",
        color: MOTION_PALETTE.ink,
        ...style
      }}
    >
      {children ?? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: colorDeep, fontSize: 11, fontWeight: 850, letterSpacing: ".08em" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: color }} />
            {marker}
          </div>
          <div style={{ marginTop: 10, fontSize: 24, fontWeight: 850, lineHeight: 1.1 }}>{title}</div>
          <div style={{ marginTop: 5, color: MOTION_PALETTE.muted, fontSize: 13, fontWeight: 620 }}>{detail}</div>
          <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", backgroundColor: colorSoft }} />
        </>
      )}
    </div>
  );
}

export function SmallNode({ label, active = false, purple = false, style = {} }) {
  const activeColor = purple ? MOTION_PALETTE.purple : MOTION_PALETTE.mint;
  const activeSoft = purple ? MOTION_PALETTE.purpleSoft : MOTION_PALETTE.mintSoft;
  return (
    <div
      style={{
        minWidth: 108,
        height: 52,
        boxSizing: "border-box",
        borderRadius: 15,
        border: `1px solid ${active ? activeColor : MOTION_PALETTE.line}`,
        backgroundColor: active ? activeSoft : MOTION_PALETTE.paperWarm,
        color: active ? (purple ? MOTION_PALETTE.purpleDeep : MOTION_PALETTE.mintDeep) : MOTION_PALETTE.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        fontWeight: 780,
        ...style
      }}
    >
      {label}
    </div>
  );
}

export function Checkmark({ progress, size = 28, color = MOTION_PALETTE.mintDeep, strokeWidth = 3 }) {
  const dash = 30;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M7 16.5 13.2 23 25.5 9.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dash}
        strokeDashoffset={dash * (1 - progress)}
      />
    </svg>
  );
}
