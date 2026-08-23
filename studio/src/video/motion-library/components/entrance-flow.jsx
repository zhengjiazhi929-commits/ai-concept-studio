import React from "react";

import { staggeredProgress } from "../motion.mjs";
import {
  DemoText,
  FlatCard,
  MOTION_PALETTE,
  SmallNode
} from "./primitives.jsx";

function EntranceShell({ progress, kind }) {
  const direction = {
    "fade-in": [0, 0],
    "fade-up": [0, 26],
    "fade-down": [0, -26],
    "slide-left": [96, 0],
    "slide-right": [-96, 0]
  }[kind] ?? [0, 0];
  const useScale = kind === "scale-in";
  return (
    <DemoText
      style={{
        opacity: progress,
        translate: `${direction[0] * (1 - progress)}px ${direction[1] * (1 - progress)}px`,
        scale: useScale ? 0.975 + (progress * 0.025) : 1
      }}
    />
  );
}

export const FadeInEffect = ({ progress }) => <EntranceShell progress={progress} kind="fade-in" />;
export const FadeUpEffect = ({ progress }) => <EntranceShell progress={progress} kind="fade-up" />;
export const FadeDownEffect = ({ progress }) => <EntranceShell progress={progress} kind="fade-down" />;
export const SlideLeftEffect = ({ progress }) => <EntranceShell progress={progress} kind="slide-left" />;
export const SlideRightEffect = ({ progress }) => <EntranceShell progress={progress} kind="slide-right" />;
export const ScaleInEffect = ({ progress }) => <EntranceShell progress={progress} kind="scale-in" />;

export function TextRevealEffect({ progress }) {
  return (
    <div style={{ width: 590, overflow: "hidden" }}>
      <div style={{ width: 590, clipPath: `inset(0 ${100 * (1 - progress)}% 0 0)` }}>
        <DemoText title="把能力变成可维护的工作单元" detail="触发条件、过程知识与验收标准共同组成边界。" />
      </div>
      <div style={{ marginTop: 17, width: `${590 * progress}px`, height: 3, borderRadius: 999, backgroundColor: MOTION_PALETTE.mint }} />
    </div>
  );
}

export function WordRevealEffect({ progress, words }) {
  const tokens = words.length > 0 ? words : ["规则", "连接", "执行", "结果", "人工确认"];
  return (
    <div style={{ width: 660, display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: "14px 12px" }}>
      {tokens.map((word, index) => {
        const itemProgress = staggeredProgress(progress, index, tokens.length, 0.5);
        return (
          <span
            key={`${word}-${index}`}
            style={{
              opacity: itemProgress,
              translate: `0 ${16 * (1 - itemProgress)}px`,
              color: index === tokens.length - 1 ? MOTION_PALETTE.purpleDeep : MOTION_PALETTE.ink,
              fontSize: 42,
              fontWeight: 850,
              letterSpacing: "-.03em"
            }}
          >
            {word}{index < tokens.length - 1 ? " →" : ""}
          </span>
        );
      })}
    </div>
  );
}

const cards = Object.freeze([
  ["01", "规则", "输入边界"],
  ["02", "Agent", "受控执行"],
  ["03", "MCP", "连接能力"],
  ["04", "结果", "证据返回"],
  ["05", "人工", "最终决定"]
]);

function CardAt({ item, index, x, y, rotate = 0, progress = 1, accent = "mint" }) {
  return (
    <FlatCard
      marker={item[0]}
      title={item[1]}
      detail={item[2]}
      accent={accent}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        translate: `${x}px ${y}px`,
        rotate: `${rotate}deg`,
        opacity: progress,
        scale: 0.985 + (progress * 0.015),
        transformOrigin: "center bottom"
      }}
    />
  );
}

export function CardLinearSpreadEffect({ progress }) {
  return (
    <div style={{ position: "relative", width: 820, height: 180 }}>
      {cards.map((item, index) => {
        const x = 8 + (index * 162 * progress);
        return <CardAt key={item[0]} item={item} index={index} x={x} y={30} progress={1} accent={index === 4 ? "purple" : "mint"} />;
      })}
    </div>
  );
}

export function CardCascadeStaggerEffect({ progress }) {
  const visible = cards.slice(0, 4);
  return (
    <div style={{ position: "relative", width: 760, height: 250 }}>
      {visible.map((item, index) => {
        const itemProgress = staggeredProgress(progress, index, visible.length, 0.55);
        return (
          <CardAt
            key={item[0]}
            item={item}
            index={index}
            x={34 + (index * 174)}
            y={58 + ((1 - itemProgress) * 46)}
            progress={itemProgress}
            accent={index === visible.length - 1 ? "purple" : "mint"}
          />
        );
      })}
    </div>
  );
}

export function CardArcEffect({ progress }) {
  return (
    <div style={{ position: "relative", width: 760, height: 280 }}>
      {cards.map((item, index) => {
        const offset = index - 2;
        return (
          <CardAt
            key={item[0]}
            item={item}
            index={index}
            x={298 + (offset * 86 * progress)}
            y={70 + ((offset ** 2) * 12 * progress)}
            rotate={offset * 7 * progress}
            progress={1}
            accent={index === 4 ? "purple" : "mint"}
          />
        );
      })}
    </div>
  );
}

export function CircuitTraceDrawEffect({ progress }) {
  const dash = 520;
  return (
    <svg width="760" height="250" viewBox="0 0 760 250" fill="none" aria-hidden="true">
      <path d="M100 125 H250 C285 125 285 62 320 62 H470 C510 62 510 125 550 125 H660" stroke={MOTION_PALETTE.line} strokeWidth="8" strokeLinecap="round" />
      <path d="M100 125 H250 C285 125 285 62 320 62 H470 C510 62 510 125 550 125 H660" stroke={MOTION_PALETTE.mint} strokeWidth="8" strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={dash * (1 - progress)} />
      {[[100, 125], [320, 62], [470, 62], [660, 125]].map(([x, y], index) => {
        const nodeProgress = staggeredProgress(progress, index, 4, 0.6);
        return <circle key={`${x}-${y}`} cx={x} cy={y} r={14 + (nodeProgress * 6)} fill={index === 3 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint} opacity={0.25 + (nodeProgress * 0.75)} />;
      })}
    </svg>
  );
}

function hexPoints(cx, cy, radius) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = ((Math.PI / 3) * index) - (Math.PI / 6);
    return `${cx + (Math.cos(angle) * radius)},${cy + (Math.sin(angle) * radius)}`;
  }).join(" ");
}

export function HexagonLatticeDrawEffect({ progress }) {
  const points = [[380, 125], [295, 125], [465, 125], [337, 52], [423, 52], [337, 198], [423, 198]];
  return (
    <svg width="760" height="250" viewBox="0 0 760 250" fill="none" aria-hidden="true">
      {points.map(([cx, cy], index) => {
        const itemProgress = staggeredProgress(progress, index, points.length, 0.65);
        return (
          <polygon
            key={`${cx}-${cy}`}
            points={hexPoints(cx, cy, 45)}
            fill={index === 0 ? MOTION_PALETTE.mintSoft : MOTION_PALETTE.paperWarm}
            stroke={index === points.length - 1 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint}
            strokeWidth="3"
            opacity={itemProgress}
            transform={`translate(${cx} ${cy}) scale(${itemProgress}) translate(${-cx} ${-cy})`}
          />
        );
      })}
    </svg>
  );
}

export function ModularTileSnapEffect({ progress }) {
  const target = [[0, 0], [136, 0], [272, 0], [0, 106], [136, 106], [272, 106]];
  const start = [[-90, -65], [240, -88], [470, -40], [-110, 220], [240, 250], [500, 210]];
  return (
    <div style={{ position: "relative", width: 392, height: 196 }}>
      {target.map(([tx, ty], index) => {
        const itemProgress = staggeredProgress(progress, index, target.length, 0.38);
        const [sx, sy] = start[index];
        return (
          <SmallNode
            key={`${tx}-${ty}`}
            label={["规则", "上下文", "Agent", "MCP", "结果", "人工"][index]}
            active={index === 2}
            purple={index === 5}
            style={{
              position: "absolute",
              left: sx + ((tx - sx) * itemProgress),
              top: sy + ((ty - sy) * itemProgress),
              opacity: 0.35 + (itemProgress * 0.65),
              scale: 0.92 + (itemProgress * 0.08)
            }}
          />
        );
      })}
    </div>
  );
}

export function SegmentedLinkStretchEffect({ progress }) {
  const labels = ["Skill", "Agent", "MCP", "结果"];
  return (
    <div style={{ width: 760, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {labels.map((label, index) => {
        const itemProgress = staggeredProgress(progress, index, labels.length, 0.5);
        return (
          <React.Fragment key={label}>
            <SmallNode label={label} active={index === 1} purple={index === 3} style={{ opacity: itemProgress, scale: 0.96 + (itemProgress * 0.04) }} />
            {index < labels.length - 1 ? (
              <div style={{ width: 72 * itemProgress, height: 3, margin: "0 8px", borderRadius: 999, backgroundColor: MOTION_PALETTE.mint, transformOrigin: "left center" }} />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function DominoChainEffect({ progress }) {
  const labels = ["输入", "判断", "执行", "返回", "确认"];
  return (
    <div style={{ width: 760, height: 220, display: "flex", justifyContent: "center", alignItems: "center", gap: 20 }}>
      {labels.map((label, index) => {
        const itemProgress = staggeredProgress(progress, index, labels.length, 0.66);
        return (
          <div
            key={label}
            style={{
              width: 100,
              height: 150,
              border: `1px solid ${index === labels.length - 1 ? MOTION_PALETTE.purple : MOTION_PALETTE.line}`,
              borderRadius: 18,
              backgroundColor: index === labels.length - 1 ? MOTION_PALETTE.purpleSoft : MOTION_PALETTE.paperWarm,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              color: MOTION_PALETTE.ink,
              fontSize: 20,
              fontWeight: 800,
              rotate: `${(1 - itemProgress) * -10}deg`,
              translate: `0 ${(1 - itemProgress) * -14}px`,
              opacity: 0.4 + (itemProgress * 0.6),
              transformOrigin: "center bottom"
            }}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}
