import React from "react";

export const colors = {
  paper: "#F7F7F5",
  panel: "#FFFFFF",
  ink: "#202124",
  muted: "#737773",
  line: "#DADDD8",
  orange: "#E56B2F",
  green: "#3E8B57",
  red: "#C94D45"
};

export const sourceBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 34,
  padding: "0 13px",
  borderRadius: 7,
  backgroundColor: "#FBE7DC",
  color: "#9A421D",
  fontSize: 17,
  fontWeight: 800,
  letterSpacing: "0.03em"
};

export function ProgressStrip({ sceneIndex, sceneCount }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${sceneCount}, 1fr)`,
        gap: 7,
        width: "100%"
      }}
    >
      {Array.from({ length: sceneCount }, (_, index) => (
        <div
          key={index}
          style={{
            height: 5,
            borderRadius: 4,
            backgroundColor: index <= sceneIndex ? colors.orange : "#DFE1DD"
          }}
        />
      ))}
    </div>
  );
}

export function Subtitle({ text }) {
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 30,
        right: 92,
        bottom: 72,
        display: "flex",
        justifyContent: "center"
      }}
    >
      <div
        style={{
          maxWidth: "100%",
          padding: "13px 18px 14px",
          borderRadius: 9,
          backgroundColor: colors.ink,
          color: "white",
          fontSize: 24,
          fontWeight: 700,
          lineHeight: 1.45,
          textAlign: "center"
        }}
      >
        {text}
      </div>
    </div>
  );
}

export function Footer({ scene, sceneIndex }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 34,
        right: 34,
        bottom: 24,
        display: "flex",
        justifyContent: "space-between",
        color: colors.muted,
        fontSize: 13,
        fontWeight: 700
      }}
    >
      <span>{scene?.type === "evidence" ? "本地演示环境｜虚构数据" : "AI Concept Studio"}</span>
      <span>{String(sceneIndex + 1).padStart(2, "0")}</span>
    </div>
  );
}
