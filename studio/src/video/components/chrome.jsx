import React from "react";
import { phraseWrapChunks } from "../text-layout.mjs";

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

export const phraseAwareTextStyle = {
  wordBreak: "auto-phrase",
  lineBreak: "strict",
  overflowWrap: "normal"
};

export function PhraseText({ text }) {
  return phraseWrapChunks(text).map((chunk, index) =>
    chunk === "\n" ? (
      <br key={`line-${index}`} />
    ) : (
      <React.Fragment key={`${index}-${chunk}`}>
        <span style={{ whiteSpace: "nowrap" }}>{chunk}</span>
        <wbr />
      </React.Fragment>
    )
  );
}

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

export function Subtitle({
  text,
  variant = "panel",
  bottom = 72,
  horizontalInset,
  fontSize,
  lineHeight
}) {
  if (!text) return null;
  const isOutline = variant === "outline";
  const inset = horizontalInset ?? (isOutline ? 30 : 34);
  return (
    <div
      style={{
        position: "absolute",
        left: inset,
        right: inset,
        bottom,
        display: "flex",
        justifyContent: "center"
      }}
    >
      <div
        style={{
          maxWidth: "100%",
          padding: isOutline ? "0 8px" : "13px 18px 14px",
          borderRadius: isOutline ? 0 : 9,
          backgroundColor: isOutline ? "transparent" : colors.ink,
          color: "white",
          fontSize: fontSize ?? (isOutline ? 25 : 24),
          fontWeight: isOutline ? 850 : 700,
          lineHeight: lineHeight ?? 1.45,
          textAlign: "center",
          textWrap: "balance",
          WebkitTextStroke: isOutline ? "1.5px rgba(18, 26, 24, 0.96)" : undefined,
          paintOrder: isOutline ? "stroke fill" : undefined,
          textShadow: isOutline
            ? "0 2px 2px rgba(18, 26, 24, 0.9), 0 4px 8px rgba(18, 26, 24, 0.72)"
            : undefined,
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={text} />
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
