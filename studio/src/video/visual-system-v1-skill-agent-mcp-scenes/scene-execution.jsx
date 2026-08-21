import React from "react";

import { VisualSystemV1PopText } from "../components/visual-system-v1/index.jsx";

export function VisualSystemV1ExecutionScene({ layout, textStartFrame }) {
  return (
    <>
      <VisualSystemV1PopText
        startFrame={textStartFrame}
        style={{
          position: "absolute",
          left: layout.copy.left,
          top: layout.copy.top,
          width: layout.copy.width,
          color: "#17795D",
          fontSize: 15,
          fontWeight: 900,
          letterSpacing: ".14em"
        }}
      >
        02 · 受控执行
      </VisualSystemV1PopText>
      <VisualSystemV1PopText
        startFrame={textStartFrame + 4}
        as="h1"
        style={{
          position: "absolute",
          left: layout.copy.left,
          top: layout.copy.top + 32,
          width: layout.copy.width,
          margin: 0,
          color: "#14211D",
          fontSize: layout.headlineFontSize,
          fontWeight: 900,
          lineHeight: 1.08,
          letterSpacing: "-.045em"
        }}
      >
        Agent 通过 MCP 调用能力
      </VisualSystemV1PopText>
      <VisualSystemV1PopText
        startFrame={textStartFrame + 8}
        style={{
          position: "absolute",
          left: layout.copy.left,
          top: layout.copy.supportTop,
          width: layout.copy.width,
          color: "#65716C",
          fontSize: layout.supportingFontSize,
          fontWeight: 620,
          lineHeight: 1.42
        }}
      >
        节点按真实依赖逐步出现，过程证据持续保留。
      </VisualSystemV1PopText>
    </>
  );
}
