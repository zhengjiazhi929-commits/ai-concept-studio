import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";

import {
  AGENT_SKILL_UIVERSE_MOTION_PROOF,
  activeNodeMotionAtFrame,
  shallowTileMotionAtFrame,
  textMotionAtFrame
} from "./agent-skill-uiverse-motion-proof-plan.mjs";

const { palette, motion } = AGENT_SKILL_UIVERSE_MOTION_PROOF;
const fontFamily = "Inter, SF Pro Display, PingFang SC, Helvetica Neue, sans-serif";

function PopText({ frame, startFrame, children, style }) {
  const state = textMotionAtFrame(frame, startFrame);
  return (
    <div
      style={{
        opacity: state.opacity,
        transform: `translateY(${state.translateY}px) scale(${state.scale})`,
        transformOrigin: "left center",
        ...style
      }}
    >
      {children}
    </div>
  );
}

function Background() {
  return (
    <AbsoluteFill style={{ background: palette.paper, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: 420,
          height: 420,
          top: 154,
          right: -270,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(57,185,143,.14) 0%, rgba(57,185,143,.05) 46%, rgba(57,185,143,0) 73%)",
          filter: "blur(9px)"
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 280,
          height: 280,
          left: -204,
          bottom: 72,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(128,103,217,.09) 0%, rgba(128,103,217,0) 72%)",
          filter: "blur(12px)"
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.32,
          backgroundImage: "linear-gradient(rgba(23,121,93,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(23,121,93,.05) 1px, transparent 1px)",
          backgroundSize: "36px 36px"
        }}
      />
    </AbsoluteFill>
  );
}

function FlatStructure({ frame }) {
  const labels = [
    { number: "01", title: "输入", detail: "目标与上下文", start: 38, top: 294 },
    { number: "02", title: "处理", detail: "规则与工具", start: 46, top: 390 },
    { number: "03", title: "复核", detail: "证据与边界", start: 54, top: 486 }
  ];
  return (
    <div data-proof-flat-layer="structure" style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: 81, top: 282, width: 1, height: 312, background: "rgba(23,121,93,.18)" }} />
      {[326, 422, 518].map((top) => (
        <div key={top} style={{ position: "absolute", left: 81, top, width: 367, height: 1, background: "rgba(23,121,93,.14)" }} />
      ))}
      <div style={{ position: "absolute", left: 32, top: 258, color: palette.mintDeep, fontSize: 10, fontWeight: 900, letterSpacing: ".1em" }}>
        FLAT STRUCTURE
      </div>
      {labels.map((item) => {
        const state = textMotionAtFrame(frame, item.start);
        return (
          <div
            key={item.number}
            style={{
              position: "absolute",
              left: 32,
              top: item.top,
              width: 126,
              opacity: state.opacity,
              transform: `translateY(${state.translateY}px) scale(${state.scale})`,
              transformOrigin: "left center"
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ color: palette.mintDeep, fontSize: 10, fontWeight: 900, letterSpacing: ".08em" }}>{item.number}</span>
              <span style={{ color: palette.ink, fontSize: 15, fontWeight: 870 }}>{item.title}</span>
            </div>
            <div style={{ marginTop: 5, marginLeft: 27, color: palette.muted, fontSize: 11, fontWeight: 680 }}>{item.detail}</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 82, top: 324, width: 6, height: 6, borderRadius: 99, background: palette.mint }} />
      <div style={{ position: "absolute", left: 82, top: 420, width: 6, height: 6, borderRadius: 99, background: palette.mint }} />
      <div style={{ position: "absolute", left: 82, top: 516, width: 6, height: 6, borderRadius: 99, background: palette.purple }} />
    </div>
  );
}

function ActiveNode({ frame }) {
  const state = activeNodeMotionAtFrame(frame);
  return (
    <div
      style={{
        position: "absolute",
        left: 176,
        top: 282,
        width: 184,
        height: 158,
        perspective: 1000,
        opacity: state.opacity
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: -10,
          height: 24,
          borderRadius: "50%",
          background: "rgba(23,121,93,.18)",
          filter: "blur(13px)",
          opacity: 0.48 + state.enterProgress * 0.36,
          transform: `translateY(${-state.hoverProgress * 1.4}px)`
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 23,
          background: "#75CDB1",
          border: "1px solid rgba(23,121,93,.25)",
          transform: `translateY(${state.translateY + motion.maximumVisibleDepthPx}px) scale(${state.scale}) rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg)`
        }}
      />
      <div
        data-proof-depth-role="active-node"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 23,
          color: palette.ink,
          background: "linear-gradient(145deg, #E6FBF3 0%, #C9F1E2 58%, #B9E7D6 100%)",
          border: "1px solid rgba(23,121,93,.31)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.9), 0 7px 14px rgba(20,84,66,.11)",
          transform: `translateY(${state.translateY}px) scale(${state.scale}) rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg)`,
          transformOrigin: "center center",
          transformStyle: "preserve-3d",
          padding: "18px 18px 16px",
          boxSizing: "border-box"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: palette.mintDeep, fontSize: 9, fontWeight: 920, letterSpacing: ".1em" }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: palette.mint }} />
            ACTIVE NODE
          </span>
          <span style={{ color: palette.mintDeep, fontSize: 10, fontWeight: 850 }}>A-02</span>
        </div>
        <PopText frame={frame} startFrame={72} style={{ marginTop: 25, fontSize: 29, fontWeight: 950, letterSpacing: "-.04em" }}>
          Agent
        </PopText>
        <PopText frame={frame} startFrame={80} style={{ marginTop: 4, color: palette.mintDeep, fontSize: 13, fontWeight: 750 }}>
          当前激活 · 受控执行
        </PopText>
        <div style={{ marginTop: 17, height: 1, background: "rgba(23,121,93,.18)" }} />
        <PopText frame={frame} startFrame={88} style={{ marginTop: 11, color: palette.muted, fontSize: 11, fontWeight: 680 }}>
          读取规则 · 选择工具
        </PopText>
      </div>
    </div>
  );
}

function ResultTile({ frame }) {
  const state = shallowTileMotionAtFrame(frame, 108);
  return (
    <div style={{ position: "absolute", left: 288, top: 470, width: 220, height: 116, perspective: 900, opacity: state.opacity }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 20, background: "#8DD4BB", transform: `translateY(${state.translateY + 2.3}px) scale(${state.scale}) rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg)` }} />
      <div
        data-proof-depth-role="key-result"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 20,
          background: "linear-gradient(145deg, #E8FBF4, #CFF2E5)",
          border: "1px solid rgba(23,121,93,.24)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.9), 0 6px 13px rgba(20,84,66,.10)",
          transform: `translateY(${state.translateY}px) scale(${state.scale}) rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg)`,
          padding: "16px 17px",
          boxSizing: "border-box"
        }}
      >
        <PopText frame={frame} startFrame={116} style={{ color: palette.mintDeep, fontSize: 9, fontWeight: 920, letterSpacing: ".1em" }}>KEY RESULT</PopText>
        <PopText frame={frame} startFrame={124} style={{ marginTop: 9, color: palette.ink, fontSize: 17, fontWeight: 900 }}>可复用 Skill 已生成</PopText>
        <PopText frame={frame} startFrame={132} style={{ marginTop: 5, color: palette.muted, fontSize: 11, fontWeight: 680 }}>包含版本与验收证据</PopText>
      </div>
    </div>
  );
}

function ApprovalTile({ frame }) {
  const state = shallowTileMotionAtFrame(frame, 136);
  return (
    <div style={{ position: "absolute", left: 45, top: 544, width: 214, height: 96, perspective: 900, opacity: state.opacity }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 19, background: "#A895EC", transform: `translateY(${state.translateY + 2.3}px) scale(${state.scale}) rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg)` }} />
      <div
        data-proof-depth-role="human-approval"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 19,
          background: `linear-gradient(145deg, #F1EDFF, ${palette.purpleSoft})`,
          border: "1px solid rgba(128,103,217,.26)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.92), 0 6px 13px rgba(91,70,157,.10)",
          transform: `translateY(${state.translateY}px) scale(${state.scale}) rotateX(${state.rotateX}deg) rotateY(${state.rotateY}deg)`,
          padding: "15px 16px",
          boxSizing: "border-box"
        }}
      >
        <PopText frame={frame} startFrame={144} style={{ color: "#5B45AA", fontSize: 9, fontWeight: 920, letterSpacing: ".1em" }}>HUMAN GATE</PopText>
        <PopText frame={frame} startFrame={152} style={{ marginTop: 8, color: "#3E2E7F", fontSize: 17, fontWeight: 900 }}>等待人工确认</PopText>
        <PopText frame={frame} startFrame={160} style={{ marginTop: 4, color: "#71649B", fontSize: 10, fontWeight: 700 }}>批准或退回修改</PopText>
      </div>
    </div>
  );
}

function BottomStatement({ frame }) {
  return (
    <div style={{ position: "absolute", left: 28, right: 28, top: 704 }}>
      <PopText frame={frame} startFrame={184} style={{ color: palette.mintDeep, fontSize: 10, fontWeight: 920, letterSpacing: ".1em" }}>
        ONE FRAME · TWO DEPTHS
      </PopText>
      <PopText frame={frame} startFrame={192} style={{ marginTop: 15, color: palette.ink, fontSize: 28, fontWeight: 940, lineHeight: 1.16, letterSpacing: "-.035em" }}>
        平面建立秩序，<br />轻立体标记关键动作。
      </PopText>
      <PopText frame={frame} startFrame={200} style={{ marginTop: 12, color: palette.muted, fontSize: 13, fontWeight: 680, lineHeight: 1.5 }}>
        主色薄荷 · 辅色紫 · 只让重点离开画布
      </PopText>
    </div>
  );
}

export function AgentSkillUiverseMotionProof() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ fontFamily, color: palette.ink }}>
      <Background />
      <div style={{ position: "absolute", left: 28, right: 28, top: 38, display: "flex", justifyContent: "space-between", color: palette.mintDeep, fontSize: 11, fontWeight: 900, letterSpacing: ".1em" }}>
        <span>LIGHT DEPTH SYSTEM</span><span>01</span>
      </div>
      <PopText frame={frame} startFrame={10} style={{ position: "absolute", left: 28, right: 30, top: 86, fontSize: 38, fontWeight: 960, lineHeight: 1.08, letterSpacing: "-.045em" }}>
        同一画面，<br />平面与轻立体共存
      </PopText>
      <PopText frame={frame} startFrame={18} style={{ position: "absolute", left: 28, right: 28, top: 184, color: palette.muted, fontSize: 15, fontWeight: 700, lineHeight: 1.5 }}>
        结构保持平面，仅将当前节点、结果与人工确认抬起
      </PopText>
      <div style={{ position: "absolute", left: 28, right: 28, top: 232, height: 1, background: "rgba(23,121,93,.17)" }} />
      <FlatStructure frame={frame} />
      <ActiveNode frame={frame} />
      <ResultTile frame={frame} />
      <ApprovalTile frame={frame} />
      <BottomStatement frame={frame} />
    </AbsoluteFill>
  );
}
