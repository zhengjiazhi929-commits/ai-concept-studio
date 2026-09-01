import React from "react";

import {
  technicalArtifactBounds,
  technicalArtifactLayout,
  technicalArtifactRailStartX,
  technicalArtifactZoneProgress
} from "../../../shared/technical-artifact-profile.mjs";
import { VISUAL_SYSTEM_V1 } from "./tokens.mjs";

const { palette, typography } = VISUAL_SYSTEM_V1;

const stroke = "rgba(23,121,93,.24)";
const quietStroke = "rgba(23,121,93,.13)";
const quietFill = "rgba(90,196,163,.045)";
const focusFill = "rgba(90,196,163,.075)";

function BoundedResourceArtifact({ width, height, layout, zoneProgresses }) {
  const bandBoundaries = [2, ...layout.rowDividers, height - 2];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      {layout.zones.map((zone, index) => {
        const y = bandBoundaries[index];
        const bandHeight = bandBoundaries[index + 1] - y;
        return (
          <rect
            key={zone.id}
            x="2"
            y={y}
            width={width - 4}
            height={bandHeight}
            rx="18"
            fill={quietFill}
            stroke={index === 0 ? stroke : quietStroke}
            strokeWidth="2"
            opacity={zoneProgresses[index]}
          />
        );
      })}
    </svg>
  );
}

function LayeredRuntimeMap({ width, height, layout, zoneProgresses }) {
  const bandBoundaries = [2, ...layout.rowDividers, height - 2];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      {layout.zones.map((zone, index) => {
        const y = bandBoundaries[index] + 6;
        const bandHeight = bandBoundaries[index + 1] - bandBoundaries[index] - 12;
        return (
          <g key={zone.id} opacity={zoneProgresses[index]}>
            <rect
              x="2"
              y={y}
              width={width - 4}
              height={bandHeight}
              rx="18"
              fill={index === 1 ? focusFill : quietFill}
              stroke={quietStroke}
              strokeWidth="2"
            />
          </g>
        );
      })}
    </svg>
  );
}

function DecisionField({ width, height, layout, zoneProgresses }) {
  const [firstDivider, secondDivider] = layout.columnDividers;
  const columnBoundaries = [2, firstDivider, secondDivider, width - 2];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      {layout.zones.map((zone, index) => {
        const x = columnBoundaries[index];
        const zoneWidth = columnBoundaries[index + 1] - x;
        return (
          <rect
            key={zone.id}
            x={x}
            y="2"
            width={zoneWidth}
            height={height - 4}
            rx="18"
            fill={index === 1 ? focusFill : quietFill}
            stroke={quietStroke}
            strokeWidth="2"
            opacity={zoneProgresses[index]}
          />
        );
      })}
    </svg>
  );
}

function EvidenceLifecycleLedger({ width, height, layout, zoneProgresses }) {
  const lifecycleZone = layout.zones[0];
  const evidenceZone = layout.zones[1];
  const lifecycleRailY = Math.max(24, lifecycleZone.bounds.top - 27);
  const evidenceRailY = (lifecycleZone.bounds.bottom + evidenceZone.bounds.top) / 2;
  const lifecycleStepXs = lifecycleZone.anchors.map((anchor) => anchor.centerX);
  const evidenceStepXs = evidenceZone.anchors.map((anchor) => anchor.centerX);
  const lifecycleRailStartX = technicalArtifactRailStartX(
    lifecycleZone,
    layout.labelBounds[0]
  );
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <g opacity={zoneProgresses[0]}>
        <rect x="2" y="2" width={width - 4} height={lifecycleZone.bounds.bottom + 18} rx="20" fill={quietFill} />
        <line
          x1={lifecycleRailStartX}
          y1={lifecycleRailY}
          x2={Math.max(...lifecycleStepXs)}
          y2={lifecycleRailY}
          stroke={stroke}
          strokeWidth="3"
        />
        {lifecycleStepXs.map((x) => (
          <g key={x}>
            <circle cx={x} cy={lifecycleRailY} r="8" fill={palette.paper} stroke={palette.mintDeep} strokeWidth="3" />
            <line x1={x} y1={lifecycleRailY + 8} x2={x} y2={lifecycleZone.bounds.top - 14} stroke={quietStroke} strokeWidth="2" />
          </g>
        ))}
      </g>
      <g opacity={zoneProgresses[1]}>
        <rect
          x="2"
          y={evidenceRailY - 18}
          width={width - 4}
          height={height - evidenceRailY + 16}
          rx="20"
          fill={focusFill}
          stroke={quietStroke}
          strokeWidth="2"
        />
        <line
          x1={Math.min(...evidenceStepXs)}
          y1={evidenceRailY}
          x2={Math.max(...evidenceStepXs)}
          y2={evidenceRailY}
          stroke={stroke}
          strokeWidth="3"
        />
        {evidenceStepXs.map((x) => (
          <line
            key={x}
            x1={x}
            y1={evidenceRailY + 2}
            x2={x}
            y2={evidenceZone.bounds.top - 14}
            stroke={quietStroke}
            strokeWidth="2"
          />
        ))}
      </g>
    </svg>
  );
}

const artifactByKind = Object.freeze({
  "bounded-resource-artifact": BoundedResourceArtifact,
  "layered-runtime-map": LayeredRuntimeMap,
  "decision-field": DecisionField,
  "evidence-lifecycle-ledger": EvidenceLifecycleLedger
});

export function VisualSystemV1TechnicalArtifact({
  profile,
  safeArea,
  geometryById,
  nodeVisibilityProgress,
  progress = 1,
  contentOpacity = 1
}) {
  if (profile == null || progress <= 0 || contentOpacity <= 0) return null;
  const bounds = technicalArtifactBounds(safeArea, profile);
  const layout = technicalArtifactLayout({ profile, safeArea, geometryById });
  const Artifact = artifactByKind[profile.kind];
  if (!Artifact) return null;
  const zoneProgresses = profile.zones.map((zone) =>
    technicalArtifactZoneProgress(zone, nodeVisibilityProgress) * progress
  );
  return (
    <div
      data-technical-artifact-profile={profile.kind}
      data-technical-artifact-purpose={profile.semanticPurpose}
      data-technical-artifact-reveal={profile.revealMode}
      data-technical-artifact-safe-width-ratio={bounds.safeWidthRatio}
      data-technical-artifact-safe-height-ratio={bounds.safeHeightRatio}
      style={{
        position: "absolute",
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        zIndex: 0,
        opacity: contentOpacity,
        pointerEvents: "none"
      }}
    >
      <Artifact
        width={bounds.width}
        height={bounds.height}
        layout={layout}
        zoneProgresses={zoneProgresses}
      />
      {profile.zones.map((zone, index) => {
        const zoneProgress = zoneProgresses[index];
        if (zoneProgress <= 0) return null;
        const position = layout.labelBounds[index];
        return (
          <div
            key={zone.id}
            data-technical-artifact-zone={zone.id}
            data-technical-artifact-zone-progress={zoneProgress}
            style={{
              position: "absolute",
              ...position,
              color: palette.mintDeep,
              fontFamily: typography.fontFamily,
              fontSize: 18,
              fontWeight: 760,
              lineHeight: "28px",
              letterSpacing: ".04em",
              textAlign: position.textAlign,
              opacity: zoneProgress * 0.82,
              whiteSpace: "nowrap"
            }}
          >
            {zone.label}
          </div>
        );
      })}
    </div>
  );
}
