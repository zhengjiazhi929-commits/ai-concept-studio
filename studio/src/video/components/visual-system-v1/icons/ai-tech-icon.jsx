import React from "react";

import {
  AI_TECH_ICON_CONTRACT_VERSION,
  AI_TECH_ICON_POLICY,
  AI_TECH_ICON_REGISTRY_VERSION,
  aiTechIconMotionStateAtProgress,
  aiTechIconSize,
  assertAiTechIconStateRole
} from "../../../../shared/ai-tech-icon-contract.mjs";
import { visualSystemV1ColorToken } from "../resolver.mjs";
import { VisualSystemV1StatusMark } from "../status-mark.jsx";
import {
  aiTechIconDefinition,
  aiTechIconTokenRolesForState
} from "./registry.mjs";

function colorForSlot(colorSlot, tokenRoles) {
  const role = tokenRoles[colorSlot];
  if (!role) throw new TypeError(`AI 技术图标几何使用未知颜色槽：${String(colorSlot)}`);
  return visualSystemV1ColorToken(role).value;
}

function strokeProps(element, color, drawProgress) {
  if (element.fill === true) {
    return {
      fill: color,
      stroke: "none",
      opacity: drawProgress
    };
  }
  return {
    fill: "none",
    stroke: color,
    strokeWidth: AI_TECH_ICON_POLICY.strokeWidth,
    strokeLinecap: AI_TECH_ICON_POLICY.strokeLinecap,
    strokeLinejoin: AI_TECH_ICON_POLICY.strokeLinejoin,
    pathLength: 1,
    strokeDasharray: 1,
    strokeDashoffset: 1 - drawProgress
  };
}

function GeometryElement({ element, index, tokenRoles, drawProgress }) {
  const color = colorForSlot(element.colorSlot, tokenRoles);
  const common = {
    key: `${element.type}-${index}`,
    "data-icon-primitive": element.type,
    "data-icon-color-slot": element.colorSlot,
    ...strokeProps(element, color, drawProgress)
  };
  if (element.type === "path") return <path {...common} d={element.d} />;
  if (element.type === "line") {
    return <line {...common} x1={element.x1} y1={element.y1} x2={element.x2} y2={element.y2} />;
  }
  if (element.type === "rect") {
    return (
      <rect
        {...common}
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        rx={element.rx ?? 0}
      />
    );
  }
  if (element.type === "circle") {
    return <circle {...common} cx={element.cx} cy={element.cy} r={element.r} />;
  }
  if (element.type === "ellipse") {
    return <ellipse {...common} cx={element.cx} cy={element.cy} rx={element.rx} ry={element.ry} />;
  }
  throw new TypeError(`AI 技术图标不支持几何原语：${String(element.type)}`);
}

export function VisualSystemV1AiTechIcon({
  conceptKind,
  sizeRole = "support",
  stateRole = null,
  progress = 1,
  statusMarkVariant = "quiet",
  label = null,
  style = {}
}) {
  const definition = aiTechIconDefinition(conceptKind, { allowNone: true });
  if (definition == null) return null;
  const resolvedStateRole = assertAiTechIconStateRole(stateRole ?? definition.defaultStateRole);
  if (!definition.allowedStateRoles.includes(resolvedStateRole)) {
    throw new TypeError(`图标 ${definition.conceptKind} 不允许状态角色：${resolvedStateRole}`);
  }
  const tokenRoles = aiTechIconTokenRolesForState(resolvedStateRole);
  const size = aiTechIconSize(sizeRole).sizePx;
  const motion = aiTechIconMotionStateAtProgress(progress);
  const accessible = typeof label === "string" && label.trim().length > 0;
  const sharedData = {
    "data-ai-tech-icon-contract": AI_TECH_ICON_CONTRACT_VERSION,
    "data-ai-tech-icon-registry": AI_TECH_ICON_REGISTRY_VERSION,
    "data-ai-tech-icon-concept": definition.conceptKind,
    "data-ai-tech-icon-id": definition.canonicalIconId,
    "data-ai-tech-icon-category": definition.category,
    "data-ai-tech-icon-size-role": sizeRole,
    "data-ai-tech-icon-state-role": resolvedStateRole,
    "data-ai-tech-icon-render-kind": definition.renderKind,
    "data-ai-tech-icon-motion": AI_TECH_ICON_POLICY.motionMode,
    "data-ai-tech-icon-settled": motion.settled ? "true" : "false"
  };
  const commonStyle = {
    ...style,
    display: "block",
    width: size,
    height: size,
    opacity: motion.opacity,
    scale: motion.scale,
    translate: `0 ${motion.translateY}px`,
    transformOrigin: "50% 50%"
  };

  if (definition.renderKind === "status-mark") {
    const statusMarkSizeRole = sizeRole === "inline" ? "support" : "focus";
    return (
      <span
        role={accessible ? "img" : undefined}
        aria-hidden={accessible ? undefined : "true"}
        aria-label={accessible ? label : undefined}
        {...sharedData}
        data-ai-tech-icon-status-mark-variant={statusMarkVariant}
        style={{
          ...commonStyle,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        <VisualSystemV1StatusMark
          progress={progress}
          variant={statusMarkVariant}
          sizeRole={statusMarkSizeRole}
          status="complete"
        />
      </span>
    );
  }

  return (
    <svg
      role={accessible ? "img" : undefined}
      aria-hidden={accessible ? undefined : "true"}
      aria-label={accessible ? label : undefined}
      {...sharedData}
      width={size}
      height={size}
      viewBox={definition.viewBox}
      fill="none"
      style={{ ...commonStyle, overflow: "visible" }}
    >
      {accessible ? <title>{label}</title> : null}
      {definition.geometry.elements.map((element, index) => (
        <GeometryElement
          key={`${element.type}-${index}`}
          element={element}
          index={index}
          tokenRoles={tokenRoles}
          drawProgress={motion.drawProgress}
        />
      ))}
    </svg>
  );
}
