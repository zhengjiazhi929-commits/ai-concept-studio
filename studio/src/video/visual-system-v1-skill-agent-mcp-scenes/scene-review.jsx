import React from "react";

import { VisualSystemV1PopText } from "../components/visual-system-v1/index.jsx";

export function VisualSystemV1ReviewScene({ layout, textStartFrame }) {
  return (
    <>
      <VisualSystemV1PopText
        startFrame={textStartFrame}
        style={{
          position: "absolute",
          left: layout.copy.left,
          top: layout.copy.top,
          width: layout.copy.width,
          color: "#5B45AA",
          fontSize: 15,
          fontWeight: 900,
          letterSpacing: ".14em"
        }}
      >
        03 · 人工确认
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
        结果回来，仍要由人决定
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
        自动执行结束于可审核结果，而不是自动通过。
      </VisualSystemV1PopText>
    </>
  );
}
