import React from "react";

import {
  VISUAL_SYSTEM_V1_STATUS_MARK_MOTION,
  visualSystemV1StatusMarkState
} from "./status-mark.mjs";

const CHECK_PATH = "M5.5 12.5L10 17L18.5 7.8";

export function VisualSystemV1StatusMark({
  progress = 1,
  variant = "quiet",
  sizeRole = "inline",
  status = "complete",
  label = null,
  style = {}
}) {
  const state = visualSystemV1StatusMarkState({
    progress,
    variant,
    sizeRole,
    status
  });
  const accessible = typeof label === "string" && label.trim().length > 0;

  return (
    <span
      role={accessible ? "img" : undefined}
      aria-hidden={accessible ? undefined : "true"}
      aria-label={accessible ? label : undefined}
      aria-disabled={status === "disabled" ? "true" : undefined}
      data-visual-system-status-mark={status}
      data-status-mark-variant={variant}
      data-status-mark-size-role={sizeRole}
      data-status-mark-motion={VISUAL_SYSTEM_V1_STATUS_MARK_MOTION.mode}
      data-status-mark-settled={state.settled ? "true" : "false"}
      style={{
        ...style,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto",
        width: state.sizePx,
        height: state.sizePx,
        border: `${state.borderWidthPx}px solid ${state.borderColor}`,
        borderRadius: state.borderRadiusPx,
        backgroundColor: state.backgroundColor,
        opacity: state.opacity,
        overflow: "hidden",
        scale: `${state.scaleX} ${state.scaleY}`,
        transformOrigin: "50% 50%"
      }}
    >
      <svg
        aria-hidden="true"
        width="100%"
        height="100%"
        viewBox="0 0 24 24"
        fill="none"
        style={{
          display: "block",
          overflow: "visible",
          opacity: state.checkOpacity,
          scale: state.checkScale,
          transformOrigin: "50% 50%"
        }}
      >
        <path
          d={CHECK_PATH}
          pathLength="1"
          fill="none"
          stroke={state.checkColor}
          strokeWidth={state.strokeWidthPx}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="1"
          strokeDashoffset={1 - state.checkProgress}
        />
      </svg>
    </span>
  );
}
