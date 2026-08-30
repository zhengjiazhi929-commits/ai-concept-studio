import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import approvedVisualSystem from "../../config/visual-system.json";
import {
  phraseAwareTextStyle,
  PhraseText
} from "./components/chrome.jsx";
import {
  resolveProductionSemanticPreview
} from "./production-semantic-preview.mjs";

const approvedStyleTokens = Object.freeze({
  canvas: approvedVisualSystem.wallpaper.base,
  surface: approvedVisualSystem.colors.surface,
  surfaceElevated: approvedVisualSystem.colors.surfaceElevated,
  surfaceMuted: approvedVisualSystem.colors.canvas,
  surfaceTint: approvedVisualSystem.colors.surfaceTint,
  textPrimary: approvedVisualSystem.colors.ink,
  textSecondary: approvedVisualSystem.colors.muted,
  linePrimary: approvedVisualSystem.colors.structureViolet,
  lineSecondary: approvedVisualSystem.colors.line,
  accentPrimary: approvedVisualSystem.colors.activeBlue,
  accentSecondary: approvedVisualSystem.colors.structureViolet,
  accentSoft: approvedVisualSystem.colors.activeTint,
  windowBorder: approvedVisualSystem.window.border,
  windowShadow: approvedVisualSystem.window.shadow
});

function sanitizeSvgId(value) {
  return String(value ?? "semantic")
    .replace(/[^a-zA-Z0-9_-]/gu, "-")
    .replace(/^-+/u, "semantic-");
}

function midpoint(route) {
  if (!Array.isArray(route) || route.length === 0) return { x: 0, y: 0 };
  if (route.length === 1) return route[0];
  const middleIndex = Math.floor((route.length - 1) / 2);
  const start = route[middleIndex];
  const end = route[middleIndex + 1];
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
}

function elementSurface(element) {
  if (element.importance === "primary") {
    return {
      backgroundColor: approvedStyleTokens.accentSoft,
      borderColor: approvedStyleTokens.accentPrimary,
      color: approvedStyleTokens.textPrimary
    };
  }
  if (element.importance === "secondary") {
    return {
      backgroundColor: approvedStyleTokens.surfaceElevated,
      borderColor: approvedStyleTokens.linePrimary,
      color: approvedStyleTokens.textPrimary
    };
  }
  return {
    backgroundColor: approvedStyleTokens.surfaceTint,
    borderColor: approvedStyleTokens.lineSecondary,
    color: approvedStyleTokens.textSecondary
  };
}

function SemanticLabel({ label, fontSize, color, importance, style = {} }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6% 8%",
        color,
        fontSize,
        fontWeight: importance === "primary" ? 850 : 760,
        lineHeight: 1.14,
        textAlign: "center",
        ...phraseAwareTextStyle,
        ...style
      }}
    >
      <PhraseText text={label} />
    </div>
  );
}

function PrimitiveArtwork({ element, fontSize }) {
  const { geometry, primitive, primitiveFamily } = element;
  const surface = elementSurface(element);
  const label = element.label ?? "";
  const commonLabel = (
    <SemanticLabel
      label={label}
      fontSize={fontSize}
      color={surface.color}
      importance={element.importance}
    />
  );

  if (primitiveFamily === "comparison") {
    const railOnRight = primitive === "comparison-right";
    return (
      <>
        <div
          style={{
            position: "absolute",
            top: "10%",
            bottom: "10%",
            [railOnRight ? "right" : "left"]: 0,
            width: 4,
            borderRadius: 4,
            backgroundColor: surface.borderColor
          }}
        />
        <div
          style={{
            position: "absolute",
            left: railOnRight ? "55%" : 0,
            right: railOnRight ? 0 : "55%",
            bottom: "10%",
            height: 3,
            backgroundColor: approvedStyleTokens.lineSecondary
          }}
        />
        {commonLabel}
      </>
    );
  }

  if (primitiveFamily === "flow") {
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            height: 3,
            backgroundColor: approvedStyleTokens.lineSecondary
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 4,
            top: "50%",
            width: 14,
            height: 14,
            border: `3px solid ${surface.borderColor}`,
            borderRadius: 999,
            backgroundColor: approvedStyleTokens.surfaceElevated,
            transform: "translateY(-50%)"
          }}
        />
        <SemanticLabel
          label={label}
          fontSize={fontSize}
          color={surface.color}
          importance={element.importance}
          style={{ left: 18, justifyContent: "flex-start", textAlign: "left" }}
        />
      </>
    );
  }

  if (primitiveFamily === "hierarchy") {
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            width: 3,
            height: "24%",
            backgroundColor: surface.borderColor,
            transform: "translateX(-50%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "12%",
            right: "12%",
            top: "24%",
            height: primitive === "hierarchy-root" ? 4 : 2,
            backgroundColor: surface.borderColor
          }}
        />
        <SemanticLabel
          label={label}
          fontSize={fontSize}
          color={surface.color}
          importance={element.importance}
          style={{ top: "24%" }}
        />
      </>
    );
  }

  if (primitiveFamily === "branch") {
    if (primitive === "decision") {
      const diamondSize = Math.min(geometry.width, geometry.height) * 0.7;
      return (
        <>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: diamondSize,
              height: diamondSize,
              border: `3px solid ${surface.borderColor}`,
              backgroundColor: approvedStyleTokens.accentSoft,
              transform: "translate(-50%, -50%) rotate(45deg)",
              borderRadius: 8
            }}
          />
          {commonLabel}
        </>
      );
    }
    const railOnRight = primitive === "branch-outcome";
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "18%",
            height: 2,
            backgroundColor: approvedStyleTokens.lineSecondary
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "18%",
            height: 2,
            backgroundColor: approvedStyleTokens.lineSecondary
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "18%",
            bottom: "18%",
            [railOnRight ? "right" : "left"]: 0,
            width: 4,
            backgroundColor: surface.borderColor
          }}
        />
        {commonLabel}
      </>
    );
  }

  if (primitiveFamily === "timeline") {
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "30%",
            height: 3,
            backgroundColor: approvedStyleTokens.lineSecondary
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "30%",
            width: 18,
            height: 18,
            border: `4px solid ${surface.borderColor}`,
            borderRadius: 999,
            backgroundColor: approvedStyleTokens.surfaceElevated,
            transform: "translate(-50%, -50%)"
          }}
        />
        <SemanticLabel
          label={label}
          fontSize={fontSize}
          color={surface.color}
          importance={element.importance}
          style={{ top: "38%", alignItems: "flex-start" }}
        />
      </>
    );
  }

  if (primitiveFamily === "state") {
    const after = primitive === "state-after";
    const ringSize = Math.min(geometry.width, geometry.height) * 0.76;
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: ringSize,
            height: ringSize,
            border: `3px ${primitive === "state-before" ? "dashed" : "solid"} ${surface.borderColor}`,
            borderRadius: 999,
            backgroundColor: after ? approvedStyleTokens.accentSoft : "transparent",
            transform: "translate(-50%, -50%)"
          }}
        />
        {commonLabel}
      </>
    );
  }

  if (primitiveFamily === "evidence") {
    if (primitive === "evidence-frame") {
      const corner = "22%";
      return (
        <>
          {[
            { top: 0, left: 0, borderTop: true, borderLeft: true },
            { top: 0, right: 0, borderTop: true, borderRight: true },
            { bottom: 0, left: 0, borderBottom: true, borderLeft: true },
            { bottom: 0, right: 0, borderBottom: true, borderRight: true }
          ].map((placement, index) => (
            <div
              key={index}
              style={{
                position: "absolute",
                width: corner,
                height: corner,
                ...Object.fromEntries(
                  Object.entries(placement).filter(([, value]) => typeof value !== "boolean")
                ),
                borderTop: placement.borderTop ? `3px solid ${surface.borderColor}` : undefined,
                borderRight: placement.borderRight ? `3px solid ${surface.borderColor}` : undefined,
                borderBottom: placement.borderBottom ? `3px solid ${surface.borderColor}` : undefined,
                borderLeft: placement.borderLeft ? `3px solid ${surface.borderColor}` : undefined
              }}
            />
          ))}
          {commonLabel}
        </>
      );
    }
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: "12%",
            bottom: "12%",
            width: 4,
            backgroundColor: surface.borderColor
          }}
        />
        <SemanticLabel
          label={label}
          fontSize={fontSize}
          color={surface.color}
          importance={element.importance}
          style={{ left: 8, justifyContent: "flex-start", textAlign: "left" }}
        />
      </>
    );
  }

  if (primitiveFamily === "quantity") {
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "28%",
            bottom: "28%",
            borderRadius: 999,
            backgroundColor: approvedStyleTokens.surfaceTint
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "28%",
            bottom: "28%",
            borderRadius: 999,
            backgroundColor: surface.borderColor,
            opacity: 0.24
          }}
        />
        {commonLabel}
      </>
    );
  }

  if (["network", "loop", "focus"].includes(primitiveFamily)) {
    const ringInset = primitiveFamily === "focus" ? "8%" : "16%";
    return (
      <>
        <div
          style={{
            position: "absolute",
            inset: ringInset,
            border: `${primitiveFamily === "focus" ? 4 : 3}px solid ${surface.borderColor}`,
            borderRadius: 999,
            backgroundColor: element.importance === "primary"
              ? approvedStyleTokens.accentSoft
              : "transparent"
          }}
        />
        {primitiveFamily === "focus" ? (
          <div
            style={{
              position: "absolute",
              inset: "20%",
              border: `2px solid ${approvedStyleTokens.lineSecondary}`,
              borderRadius: 999
            }}
          />
        ) : null}
        {commonLabel}
      </>
    );
  }

  if (primitiveFamily === "spatial") {
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "24%",
            width: 18,
            height: 18,
            border: `4px solid ${surface.borderColor}`,
            borderRadius: 999,
            transform: "translateX(-50%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "44%",
            width: 3,
            height: "18%",
            backgroundColor: surface.borderColor,
            transform: "translateX(-50%)"
          }}
        />
        <SemanticLabel
          label={label}
          fontSize={fontSize}
          color={surface.color}
          importance={element.importance}
          style={{ top: "54%", alignItems: "flex-start" }}
        />
      </>
    );
  }

  if (primitiveFamily === "human-decision") {
    const gateSize = Math.min(geometry.width, geometry.height) * 0.24;
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "10%",
            width: 3,
            height: "22%",
            backgroundColor: surface.borderColor,
            transform: "translateX(-50%)"
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "36%",
            width: gateSize,
            height: gateSize,
            border: `3px solid ${surface.borderColor}`,
            backgroundColor: approvedStyleTokens.accentSoft,
            transform: "translate(-50%, -50%) rotate(45deg)",
            borderRadius: 5
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "16%",
            right: "16%",
            top: "52%",
            height: 3,
            backgroundColor: surface.borderColor
          }}
        />
        {["16%", "84%"].map((left) => (
          <div
            key={left}
            style={{
              position: "absolute",
              left,
              top: "52%",
              width: 3,
              height: "14%",
              backgroundColor: surface.borderColor,
              transform: "translateX(-50%)"
            }}
          />
        ))}
        <SemanticLabel
          label={label}
          fontSize={fontSize}
          color={surface.color}
          importance={element.importance}
          style={{ top: "64%", alignItems: "flex-start" }}
        />
      </>
    );
  }

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "12%",
          bottom: "12%",
          width: 4,
          backgroundColor: surface.borderColor
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "12%",
          height: 2,
          backgroundColor: approvedStyleTokens.lineSecondary
        }}
      />
      {commonLabel}
    </>
  );
}

function SemanticElement({ element, progress, minimumFontSize }) {
  const { geometry, primitive, primitiveFamily } = element;
  const label = element.label ?? "";
  const fittedFontSize = Math.max(
    minimumFontSize,
    Math.min(44, geometry.height * 0.3, geometry.width / Math.max(2.4, label.length * 0.7))
  );
  return (
    <div
      data-semantic-element-id={element.id}
      data-semantic-role={element.semanticRole}
      data-grammar-primitive={primitive}
      data-primitive-family={primitiveFamily}
      style={{
        position: "absolute",
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
        opacity: progress,
        transform: `scale(${0.96 + progress * 0.04})`,
        transformOrigin: "50% 50%"
      }}
    >
      <PrimitiveArtwork element={element} fontSize={fittedFontSize} />
    </div>
  );
}

function SemanticConnectors({
  sceneId,
  connectors,
  graphicProgress,
  detailProgress,
  width,
  height
}) {
  const markerPrefix = sanitizeSvgId(sceneId);
  return (
    <>
      <svg
        aria-hidden="true"
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        <defs>
          {connectors.filter((connector) => connector.arrowhead).map((connector) => (
            <marker
              key={connector.id}
              id={`${markerPrefix}-${sanitizeSvgId(connector.id)}-arrow`}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path
                d="M0,0 L7,3.5 L0,7 z"
                fill={approvedStyleTokens.accentPrimary}
                opacity={graphicProgress}
              />
            </marker>
          ))}
        </defs>
        {connectors.map((connector) => {
          const markerId = `${markerPrefix}-${sanitizeSvgId(connector.id)}-arrow`;
          const points = connector.route.map((point) => `${point.x},${point.y}`).join(" ");
          return (
            <polyline
              key={connector.id}
              data-semantic-relation-id={connector.relationId}
              data-relation-directed={connector.directed ? "true" : "false"}
              points={points}
              pathLength={1}
              fill="none"
              stroke={connector.arrowhead
                ? approvedStyleTokens.accentPrimary
                : approvedStyleTokens.linePrimary}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={1}
              strokeDashoffset={1 - graphicProgress}
              markerEnd={connector.arrowhead ? `url(#${markerId})` : undefined}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      {connectors.map((connector) => {
        if (!connector.showLabel || !connector.label) return null;
        const labelPoint = midpoint(connector.route);
        return (
          <div
            key={`${connector.id}-label`}
            data-semantic-relation-label={connector.relationId}
            style={{
              position: "absolute",
              left: labelPoint.x,
              top: labelPoint.y,
              padding: "4px 8px",
              border: `1px solid ${approvedStyleTokens.lineSecondary}`,
              borderRadius: 999,
              backgroundColor: approvedStyleTokens.surfaceElevated,
              color: approvedStyleTokens.textSecondary,
              fontSize: 28,
              fontWeight: 750,
              lineHeight: 1.1,
              opacity: detailProgress,
              transform: "translate(-50%, -50%)",
              whiteSpace: "nowrap"
            }}
          >
            <PhraseText text={connector.label} />
          </div>
        );
      })}
    </>
  );
}

function ProductionSemanticSubtitle({ text, progress, width, height, minimumFontSize }) {
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: Math.max(34, width * 0.065),
        right: Math.max(34, width * 0.065),
        bottom: Math.max(66, height * 0.075),
        display: "flex",
        justifyContent: "center",
        opacity: progress
      }}
    >
      <div
        style={{
          maxWidth: "100%",
          color: approvedVisualSystem.subtitle.color,
          fontSize: Math.max(
            minimumFontSize,
            Math.min(approvedVisualSystem.subtitle.fontSize, width * (approvedVisualSystem.subtitle.fontSize / 1080))
          ),
          fontWeight: 700,
          lineHeight: 1.25,
          textAlign: "center",
          textWrap: "balance",
          textShadow: approvedVisualSystem.subtitle.textShadow,
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={text} />
      </div>
    </div>
  );
}

function ProductionSemanticChrome({
  sceneIndex,
  sceneWeights,
  width
}) {
  const weights = Array.isArray(sceneWeights) && sceneWeights.length > 0 ? sceneWeights : [1];
  return (
    <>
      <div
        style={{
          position: "absolute",
          bottom: 52,
          left: Math.max(34, width * 0.065),
          right: Math.max(34, width * 0.065),
          display: "grid",
          gridTemplateColumns: weights.map((weight) => `${Math.max(0.001, weight)}fr`).join(" "),
          gap: 7
        }}
      >
        {weights.map((weight, index) => (
          <div
            key={`${index}-${weight}`}
            style={{
              height: 5,
              borderRadius: 4,
              backgroundColor: index <= sceneIndex
                ? approvedStyleTokens.accentPrimary
                : approvedStyleTokens.lineSecondary
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: Math.max(34, width * 0.065),
          right: Math.max(34, width * 0.065),
          bottom: 24,
          display: "flex",
          justifyContent: "space-between",
          color: approvedStyleTokens.textSecondary,
          fontSize: Math.max(13, Math.min(18, width * 0.024)),
          fontWeight: 700
        }}
      >
        <span>AI Concept Studio</span>
        <span>{String(sceneIndex + 1).padStart(2, "0")}</span>
      </div>
    </>
  );
}

export function ProductionSemanticPreview({
  scene,
  subtitle,
  localFrame,
  sceneIndex = 0,
  sceneWeights = [1]
}) {
  const { width, height } = useVideoConfig();
  const state = resolveProductionSemanticPreview({
    scene,
    frame: localFrame,
    width,
    height
  });
  if (state.styleProfileId !== approvedVisualSystem.id) {
    throw new RangeError(`生产视觉参数真源与场景风格不一致：${state.styleProfileId}`);
  }
  const horizontalInset = Math.max(34, width * 0.065);
  const isPortrait = height > width;
  const referenceWidth = isPortrait
    ? approvedVisualSystem.derivatives.vertical.width
    : approvedVisualSystem.master.width;
  const referenceHeight = isPortrait
    ? approvedVisualSystem.derivatives.vertical.height
    : approvedVisualSystem.master.height;
  const windowProfile = isPortrait
    ? approvedVisualSystem.window.vertical
    : approvedVisualSystem.window;
  const windowInset = width * (windowProfile.x / referenceWidth);
  const windowTop = height * (windowProfile.y / referenceHeight);
  const windowBottom = height * (
    (referenceHeight - windowProfile.y - windowProfile.height) / referenceHeight
  );
  const windowTopBarHeight = height * (windowProfile.topBarHeight / referenceHeight);
  const titleTop = windowTop + Math.max(44, height * 0.045);
  const supportingTop = Math.max(titleTop + 96, state.layout.safeArea.y - height * 0.085);
  const minimumFontSize = Math.max(28, scene.visualPlan.acceptance?.minimumBodyFontPx ?? 28);
  const minimumTitleFontSize = Math.max(
    46,
    scene.visualPlan.acceptance?.minimumStageTitleFontPx ?? 46
  );
  const titleFontSize = Math.max(
    minimumTitleFontSize,
    Math.min(86, Math.min(width, height) * 0.09)
  );

  return (
    <AbsoluteFill
      data-production-semantic-preview="true"
      data-style-profile={state.styleProfileId}
      data-grammar-structure={state.structure}
      data-viewport={`${width}x${height}`}
      style={{ backgroundColor: approvedStyleTokens.canvas }}
    >
      <div
        style={{
          position: "absolute",
          left: windowInset,
          right: windowInset,
          top: windowTop,
          bottom: windowBottom,
          overflow: "hidden",
          border: `1px solid ${approvedStyleTokens.windowBorder}`,
          borderRadius: width * (windowProfile.borderRadius / referenceWidth),
          backgroundColor: approvedStyleTokens.surfaceMuted,
          boxShadow: approvedStyleTokens.windowShadow
        }}
      >
        <div
          style={{
            height: windowTopBarHeight,
            borderBottom: `1px solid ${approvedStyleTokens.lineSecondary}`,
            backgroundColor: approvedStyleTokens.surface
          }}
        />
        {approvedVisualSystem.window.trafficLights ? (
          <div
            style={{
              position: "absolute",
              top: Math.max(13, height * 0.014),
              left: Math.max(18, width * 0.036),
              display: "flex",
              gap: 7
            }}
          >
            {[
              approvedVisualSystem.colors.errorRed,
              approvedVisualSystem.colors.warningOrange,
              approvedVisualSystem.colors.successGreen
            ].map((color) => (
              <div
                key={color}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  backgroundColor: color
                }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: "absolute",
          left: horizontalInset,
          right: horizontalInset,
          top: titleTop,
          opacity: state.visibility.headline,
          transform: `translateY(${(1 - state.visibility.headline) * 14}px)`
        }}
      >
        {scene.kicker ? (
          <div
            style={{
              marginBottom: 12,
              color: approvedStyleTokens.accentPrimary,
              fontSize: Math.max(28, approvedVisualSystem.chapterLabel.fontSize),
              fontWeight: 850,
              letterSpacing: "0.035em"
            }}
          >
            <PhraseText text={scene.kicker} />
          </div>
        ) : null}
        <div
          style={{
            maxWidth: width - horizontalInset * 2,
            color: approvedStyleTokens.textPrimary,
            fontSize: titleFontSize,
            fontWeight: 900,
            lineHeight: 1.04,
            letterSpacing: "-0.045em",
            ...phraseAwareTextStyle
          }}
        >
          <PhraseText text={state.headline} />
        </div>
      </div>

      {state.supportingCopy ? (
        <div
          style={{
            position: "absolute",
            left: horizontalInset,
            right: horizontalInset,
            top: supportingTop,
            color: approvedStyleTokens.textSecondary,
            fontSize: Math.max(
              minimumFontSize,
              Math.min(34, Math.min(width, height) * 0.045)
            ),
            fontWeight: 680,
            lineHeight: 1.4,
            opacity: state.visibility.supportingCopy,
            transform: `translateY(${(1 - state.visibility.supportingCopy) * 10}px)`,
            ...phraseAwareTextStyle
          }}
        >
          <PhraseText text={state.supportingCopy} />
        </div>
      ) : null}

      <SemanticConnectors
        sceneId={state.sceneId}
        connectors={state.connectors}
        graphicProgress={state.visibility.graphic}
        detailProgress={state.visibility.detailCopy}
        width={width}
        height={height}
      />
      {state.elements.map((element) => (
        <SemanticElement
          key={element.id}
          element={element}
          progress={state.visibility.graphic}
          minimumFontSize={minimumFontSize}
        />
      ))}

      <ProductionSemanticSubtitle
        text={subtitle}
        progress={state.visibility.subtitle}
        width={width}
        height={height}
        minimumFontSize={minimumFontSize}
      />
      <ProductionSemanticChrome
        sceneIndex={sceneIndex}
        sceneWeights={sceneWeights}
        width={width}
      />
    </AbsoluteFill>
  );
}
