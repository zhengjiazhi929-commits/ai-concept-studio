import React from "react";

import { VisualSystemV1PopText } from "../components/visual-system-v1/index.jsx";

export function VisualSystemV1BoundaryScene({ layout, textStartFrame }) {
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
        01 · 规则先行
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
        Skill 先把边界说清楚
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
        触发条件、流程知识与验收标准保持在同一能力单元。
      </VisualSystemV1PopText>
    </>
  );
}
