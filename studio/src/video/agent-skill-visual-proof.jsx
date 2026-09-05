import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { PhraseText, Subtitle, phraseAwareTextStyle } from "./components/chrome.jsx";
import {
  VISUAL_PROOF_CHAPTER_WEIGHTS,
  VISUAL_PROOF_DURATION_SECONDS,
  VISUAL_PROOF_SHOTS,
  visualProofProgressAt,
  visualProofSubtitleAt
} from "./agent-skill-visual-proof-plan.mjs";
import { localTtsSubtitleAt } from "./agent-skill-local-tts-plan.mjs";
import { motionPhaseIndex } from "./agent-skill-motion-plan.mjs";
import { VIDEO_SANS_FONT_FAMILY } from "./font-system.mjs";

export const APPROVED_VISUAL_PROOF_AUDIO = "episodes/agent-skill-20260806/voice-v001.wav";
export const LOCAL_TTS_VISUAL_PROOF_AUDIO =
  "episodes/agent-skill-20260806/local-tts-proof-v002.wav";

const palette = {
  paper: "#F5F6F2",
  ink: "#18201E",
  muted: "#67706C",
  line: "#CDD5D0",
  panel: "rgba(255, 255, 255, 0.88)",
  orange: "#F06C32",
  orangeSoft: "#FFE1D1",
  mint: "#55C8A4",
  mintSoft: "#DDF6EC",
  blue: "#4C72E8",
  blueSoft: "#E3EAFF",
  purple: "#7759DD",
  purpleSoft: "#EDE7FF",
  dark: "#1F2725"
};

const panelShadow = "0 22px 55px rgba(27, 43, 38, 0.12)";
const CHAPTER_PROGRESS_WIDTH = 540;
const CHAPTER_PROGRESS_GRID = VISUAL_PROOF_CHAPTER_WEIGHTS
  .map((duration) => `${duration}fr`)
  .join(" ");

function clampInterpolation(frame, input, output, easing) {
  return interpolate(frame, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing
  });
}

function sceneOpacity(frame, durationInFrames) {
  return clampInterpolation(
    frame,
    [0, 9, Math.max(10, durationInFrames - 9), durationInFrames],
    [0, 1, 1, 0],
    Easing.inOut(Easing.cubic)
  );
}

function entrance(frame, fps, delay = 0) {
  return spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 18, stiffness: 145, mass: 0.85 }
  });
}

function stagedProgress(frame, durationInFrames, start, end) {
  return clampInterpolation(
    frame,
    [Math.round(durationInFrames * start), Math.round(durationInFrames * end)],
    [0, 1],
    Easing.inOut(Easing.cubic)
  );
}

function pillStyle(color, background) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    minHeight: 28,
    padding: "0 11px",
    borderRadius: 999,
    color,
    background,
    fontSize: 14,
    fontWeight: 850,
    letterSpacing: "0.02em"
  };
}

function Dot({ color = palette.orange, size = 8 }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", background: color }} />;
}

function Backdrop() {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 48) * 14;
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: palette.paper }} />
      <AbsoluteFill
        style={{
          opacity: 0.34,
          backgroundImage:
            "linear-gradient(rgba(77, 95, 88, 0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(77, 95, 88, 0.09) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
          maskImage: "linear-gradient(to bottom, black, transparent 82%)"
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 310,
          height: 310,
          left: -155 + drift,
          top: 60,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(85,200,164,0.22), rgba(85,200,164,0))"
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 360,
          height: 360,
          right: -190 - drift,
          top: 260,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(119,89,221,0.18), rgba(119,89,221,0))"
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 24,
          left: 28,
          right: 28,
          display: "flex",
          alignItems: "center"
        }}
      >
        <div style={pillStyle(palette.dark, "rgba(255,255,255,0.72)")}>
          <Dot />
          AGENT SKILL · VISUAL PROOF
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 28,
          right: 28,
          bottom: 64,
          display: "flex",
          justifyContent: "space-between",
          color: palette.muted,
          fontSize: 12,
          fontWeight: 800
        }}
      >
        <span>AI Concept Studio</span>
        <span>本地代码动画 · 无生成式素材</span>
      </div>
    </>
  );
}

function SceneCanvas({ children, durationInFrames }) {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        inset: "70px 28px 160px",
        opacity: sceneOpacity(frame, durationInFrames)
      }}
    >
      {children}
    </div>
  );
}

function MicroHeading({ eyebrow, title, accent = palette.orange }) {
  return (
    <div>
      <div style={{ ...pillStyle(accent, `${accent}18`), marginBottom: 12 }}>
        <Dot color={accent} />
        {eyebrow}
      </div>
      <div
        style={{
          color: palette.ink,
          fontSize: 34,
          fontWeight: 920,
          lineHeight: 1.12,
          letterSpacing: "-0.045em",
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={title} />
      </div>
    </div>
  );
}

function PromptSheet({ x, y, rotate, opacity, scale, label, lines = 5, accent = palette.orange }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 252,
        height: 315,
        padding: 18,
        border: `1px solid ${palette.line}`,
        borderRadius: 20,
        background: palette.panel,
        boxShadow: panelShadow,
        opacity,
        transform: `rotate(${rotate}deg) scale(${scale})`,
        transformOrigin: "50% 80%"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={pillStyle(accent, `${accent}18`)}>{label}</div>
        <div style={{ color: palette.muted, fontSize: 13, fontWeight: 800 }}>PROMPT.txt</div>
      </div>
      <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            style={{
              height: 9,
              width: `${88 - ((index * 13) % 35)}%`,
              borderRadius: 8,
              background: index === 1 ? `${accent}75` : "#DDE2DE"
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 18,
          right: 18,
          bottom: 18,
          height: 45,
          borderRadius: 12,
          border: `1px dashed ${accent}80`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: accent,
          fontWeight: 900,
          fontSize: 15
        }}
      >
        ⌘ C&nbsp;&nbsp;→&nbsp;&nbsp;⌘ V
      </div>
    </div>
  );
}

function HookScene({ durationInFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phaseIndex = motionPhaseIndex(frame, durationInFrames);
  const cards = [0, 1, 2].map((index) =>
    entrance(frame, fps, Math.round(durationInFrames * (0.03 + index * 0.1)))
  );
  const countProgress = stagedProgress(frame, durationInFrames, 0.04, 0.35);
  const decisionProgress = stagedProgress(frame, durationInFrames, 0.56, 0.82);
  const counter = Math.min(3, Math.max(1, Math.ceil(countProgress * 3)));
  const phaseLabels = ["正在统计", "发现重复劳动", "准备沉淀能力"];
  return (
    <SceneCanvas durationInFrames={durationInFrames}>
      <MicroHeading eyebrow="一个简单判断" title="每周复制三遍，还是沉淀一次？" />
      <div style={{ position: "relative", height: 440, marginTop: 35 }}>
        {cards.map((progress, index) => (
          <PromptSheet
            key={index}
            x={104 + (index - 1) * 18}
            y={56 + (2 - index) * 10}
            rotate={(index - 1) * 5}
            opacity={progress}
            scale={0.88 + progress * 0.12}
            label={`第 ${index + 1} 次`}
            accent={[palette.blue, palette.purple, palette.orange][index]}
          />
        ))}
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 112,
            height: 112,
            borderRadius: "50%",
            background: palette.dark,
            color: "white",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${1 + decisionProgress * 0.04})`,
            boxShadow: "0 20px 45px rgba(31,39,37,0.24)"
          }}
        >
          <span style={{ fontSize: 45, fontWeight: 950, lineHeight: 0.9 }}>{counter}</span>
          <span style={{ marginTop: 8, fontSize: 13, fontWeight: 800, opacity: 0.72 }}>
            {phaseIndex === 0 ? "次 / 周" : phaseLabels[phaseIndex]}
          </span>
        </div>
        <div
          style={{
            position: "absolute",
            left: 24,
            right: 24,
            bottom: 0,
            minHeight: 54,
            padding: "0 16px",
            border: `1px solid ${palette.mint}55`,
            borderRadius: 17,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(255,255,255,0.9)",
            boxShadow: "0 14px 30px rgba(27,43,38,0.1)",
            opacity: decisionProgress,
            transform: `translateY(${(1 - decisionProgress) * 22}px)`
          }}
        >
          <span style={{ color: palette.muted, fontSize: 13, fontWeight: 850 }}>重复输入 × 3</span>
          <span style={{ color: palette.mint, fontSize: 18, fontWeight: 950 }}>→ 能力单元 × 1</span>
        </div>
      </div>
    </SceneCanvas>
  );
}

function ChatWindow({ person, color, delay, revealDuration, messageOffset = 0 }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const open = entrance(frame, fps, delay);
  const completed = clampInterpolation(frame, [delay + revealDuration, delay + revealDuration + 10], [0, 1]);
  const emphasis = open * (1 - completed);
  return (
    <div
      style={{
        position: "relative",
        height: 138,
        padding: "15px 16px",
        border: `1px solid ${palette.line}`,
        borderRadius: 20,
        background: palette.panel,
        boxShadow: "0 14px 35px rgba(27,43,38,0.09)",
        opacity: open,
        transform: `translateX(${(1 - open) * (delay % 2 === 0 ? -55 : 55)}px) scale(${1 + emphasis * 0.012})`
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 10,
            display: "grid",
            placeItems: "center",
            background: `${color}20`,
            color,
            fontSize: 14,
            fontWeight: 950
          }}
        >
          {person}
        </div>
        <div style={{ fontSize: 15, fontWeight: 900, color: palette.ink }}>新对话</div>
      </div>
      <div style={{ marginTop: 13, display: "grid", gap: 8 }}>
        {[83, 67, 92].map((width, index) => {
          const reveal = clampInterpolation(
            frame,
            [delay + index * revealDuration * 0.12, delay + revealDuration * (0.5 + index * 0.2)],
            [0, 1],
            Easing.out(Easing.cubic)
          );
          return (
            <div
              key={index}
              style={{
                height: 8,
                width: `${Math.max(10, width - messageOffset)}%`,
                borderRadius: 8,
                background: index === 1 ? `${color}65` : "#DDE2DE",
                transform: `scaleX(${reveal})`,
                transformOrigin: "left"
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function PromptRepeatScene({ durationInFrames }) {
  const frame = useCurrentFrame();
  const phaseIndex = motionPhaseIndex(frame, durationInFrames);
  const delays = [0.03, 0.35, 0.62].map((ratio) => Math.round(durationInFrames * ratio));
  const revealDuration = Math.round(durationInFrames * 0.24);
  const phaseLabels = [
    "同样的背景，被再次输入",
    "同样的步骤，被再次输入",
    "同样的风险，也被再次输入"
  ];
  return (
    <SceneCanvas durationInFrames={durationInFrames}>
      <MicroHeading eyebrow="重复输入" title="知识被困在三个聊天框里" accent={palette.purple} />
      <div style={{ position: "relative", marginTop: 26, display: "grid", gap: 13 }}>
        <ChatWindow person="甲" color={palette.blue} delay={delays[0]} revealDuration={revealDuration} />
        <ChatWindow person="乙" color={palette.purple} delay={delays[1]} revealDuration={revealDuration} messageOffset={6} />
        <ChatWindow person="丙" color={palette.orange} delay={delays[2]} revealDuration={revealDuration} messageOffset={12} />
      </div>
      <div
        style={{
          marginTop: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: palette.muted,
          fontSize: 14,
          fontWeight: 850
        }}
      >
        <span>{phaseLabels[phaseIndex]}</span>
        <span style={{ color: [palette.blue, palette.purple, palette.orange][phaseIndex] }}>
          {phaseIndex + 1} / 3
        </span>
      </div>
    </SceneCanvas>
  );
}

function FolderTree({ frame, delay = 0, rowDelay = 7, compact = false }) {
  const { fps } = useVideoConfig();
  const rows = [
    { icon: "◆", name: "SKILL.md", detail: "步骤与边界", color: palette.orange },
    { icon: "⌘", name: "scripts/", detail: "可执行脚本", color: palette.blue },
    { icon: "▤", name: "references/", detail: "按需资料", color: palette.purple },
    { icon: "◫", name: "assets/", detail: "复用资源", color: palette.mint }
  ];
  return (
    <div style={{ display: "grid", gap: compact ? 8 : 11 }}>
      {rows.map((row, index) => {
        const progress = entrance(frame, fps, delay + index * rowDelay);
        return (
          <div
            key={row.name}
            style={{
              display: "grid",
              gridTemplateColumns: compact ? "30px 1fr" : "35px 1fr auto",
              alignItems: "center",
              gap: 9,
              minHeight: compact ? 42 : 54,
              padding: compact ? "7px 9px" : "8px 12px",
              border: `1px solid ${palette.line}`,
              borderRadius: 13,
              background: "rgba(255,255,255,0.78)",
              opacity: progress,
              transform: `translateY(${(1 - progress) * 18}px)`
            }}
          >
            <div
              style={{
                width: compact ? 28 : 34,
                height: compact ? 28 : 34,
                borderRadius: 9,
                display: "grid",
                placeItems: "center",
                color: row.color,
                background: `${row.color}18`,
                fontWeight: 950
              }}
            >
              {row.icon}
            </div>
            <div>
              <div style={{ color: palette.ink, fontSize: compact ? 14 : 16, fontWeight: 900 }}>{row.name}</div>
              {!compact ? (
                <div style={{ marginTop: 2, color: palette.muted, fontSize: 12, fontWeight: 700 }}>{row.detail}</div>
              ) : null}
            </div>
            {!compact ? <div style={{ color: row.color, fontSize: 16, fontWeight: 950 }}>✓</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function PromptToSkillScene({ durationInFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phaseIndex = motionPhaseIndex(frame, durationInFrames);
  const split = entrance(frame, fps, Math.round(durationInFrames * 0.02));
  const arrow = stagedProgress(frame, durationInFrames, 0.22, 0.5);
  const promptFade = clampInterpolation(
    frame,
    [Math.round(durationInFrames * 0.3), Math.round(durationInFrames * 0.72)],
    [1, 0.28]
  );
  const folderDelay = Math.round(durationInFrames * 0.29);
  const folderRowDelay = Math.round(durationInFrames * 0.09);
  const tagLabels = ["可发现", "可版本化", "可评测"];
  const phaseLabels = ["拆分输入", "生成目录", "结构检查"];
  return (
    <SceneCanvas durationInFrames={durationInFrames}>
      <MicroHeading eyebrow="从一次输入到能力单元" title="Prompt 被整理成可维护目录" accent={palette.blue} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.82fr 46px 1.18fr",
          gap: 10,
          alignItems: "center",
          marginTop: 34,
          minHeight: 430,
          opacity: split
        }}
      >
        <div
          style={{
            height: 345,
            padding: 14,
            border: `1px solid ${palette.line}`,
            borderRadius: 20,
            background: palette.panel,
            boxShadow: panelShadow,
            opacity: promptFade
          }}
        >
          <div style={{ display: "flex", gap: 6 }}>
            {[palette.orange, "#E9B84B", palette.mint].map((color) => (
              <Dot key={color} color={color} size={7} />
            ))}
          </div>
          <div style={{ marginTop: 18, color: palette.muted, fontSize: 12, fontWeight: 900 }}>聊天框</div>
          <div style={{ marginTop: 13, display: "grid", gap: 12 }}>
            {[93, 72, 85, 56, 88, 67, 78, 49].map((width, index) => (
              <div
                key={index}
                style={{
                  height: 7,
                  width: `${width}%`,
                  borderRadius: 7,
                  background: index === 4 ? palette.orangeSoft : "#DDE2DE"
                }}
              />
            ))}
          </div>
          <div style={{ marginTop: 24, color: palette.orange, fontSize: 13, fontWeight: 900 }}>难发现 · 难更新</div>
        </div>
        <div style={{ position: "relative", height: 345 }}>
          <div
            style={{
              position: "absolute",
              top: 164,
              left: 0,
              width: 42,
              height: 3,
              borderRadius: 3,
              background: palette.blue,
              transform: `scaleX(${arrow})`,
              transformOrigin: "left"
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 153,
              right: 0,
              color: palette.blue,
              fontSize: 23,
              fontWeight: 950,
              opacity: arrow
            }}
          >
            ›
          </div>
        </div>
        <div
          style={{
            minHeight: 390,
            padding: 15,
            border: `1px solid ${palette.blue}55`,
            borderRadius: 22,
            background: "rgba(245,248,255,0.9)",
            boxShadow: panelShadow
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9, marginBottom: 13 }}>
            <div style={{ color: palette.ink, fontSize: 15, fontWeight: 950 }}>competitive-analysis/</div>
            <div style={{ color: palette.blue, fontSize: 11, fontWeight: 900 }}>{phaseLabels[phaseIndex]}</div>
          </div>
          <FolderTree frame={frame} delay={folderDelay} rowDelay={folderRowDelay} compact />
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tagLabels.map((item, index) => (
              <div
                key={item}
                style={{
                  ...pillStyle([palette.blue, palette.purple, palette.mint][index], "white"),
                  opacity: stagedProgress(
                    frame,
                    durationInFrames,
                    0.7 + index * 0.08,
                    0.78 + index * 0.08
                  ),
                  transform: `translateY(${(1 - stagedProgress(
                    frame,
                    durationInFrames,
                    0.7 + index * 0.08,
                    0.78 + index * 0.08
                  )) * 10}px)`
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </SceneCanvas>
  );
}

function FlowLine({ x1, y1, x2, y2, progress, color }) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return (
    <div
      style={{
        position: "absolute",
        left: x1,
        top: y1,
        width: length,
        height: 3,
        borderRadius: 3,
        background: `linear-gradient(90deg, ${color}, ${palette.dark})`,
        transform: `rotate(${angle}deg) scaleX(${progress})`,
        transformOrigin: "0 50%"
      }}
    />
  );
}

function KnowledgeChip({ title, detail, color, left, top, progress }) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: 150,
        minHeight: 86,
        padding: "13px 14px",
        border: `1px solid ${color}55`,
        borderRadius: 17,
        background: "rgba(255,255,255,0.92)",
        boxShadow: "0 14px 30px rgba(27,43,38,0.09)",
        opacity: progress,
        transform: `scale(${0.82 + progress * 0.18})`
      }}
    >
      <div style={{ color, fontSize: 16, fontWeight: 950 }}>{title}</div>
      <div style={{ marginTop: 6, color: palette.muted, fontSize: 12, lineHeight: 1.35, fontWeight: 750 }}>{detail}</div>
    </div>
  );
}

function KnowledgeMergeScene({ durationInFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phaseIndex = motionPhaseIndex(frame, durationInFrames);
  const items = [
    { title: "背景", detail: "目标、受众、上下文", color: palette.blue, left: 0, top: 125 },
    { title: "步骤", detail: "顺序、工具、输入输出", color: palette.orange, left: 0, top: 310 },
    { title: "注意事项", detail: "权限、风险、验收", color: palette.purple, left: 322, top: 218 }
  ];
  const centerProgress = entrance(frame, fps, Math.round(durationInFrames * 0.24));
  const lineProgress = stagedProgress(frame, durationInFrames, 0.35, 0.64);
  const phaseLabels = ["收集知识", "连接结构", "确认能力"];
  return (
    <SceneCanvas durationInFrames={durationInFrames}>
      <MicroHeading eyebrow="团队知识合并" title="把散落经验装进同一个能力包" accent={palette.mint} />
      <div style={{ position: "relative", height: 500, marginTop: 22 }}>
        <FlowLine x1={145} y1={165} x2={238} y2={250} progress={lineProgress} color={palette.blue} />
        <FlowLine x1={145} y1={350} x2={238} y2={284} progress={lineProgress} color={palette.orange} />
        <FlowLine x1={322} y1={260} x2={286} y2={264} progress={lineProgress} color={palette.purple} />
        {items.map((item, index) => (
          <KnowledgeChip
            key={item.title}
            {...item}
            progress={entrance(frame, fps, Math.round(durationInFrames * (0.03 + index * 0.08)))}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: 176,
            top: 170,
            width: 150,
            height: 196,
            padding: "17px 18px",
            borderRadius: 28,
            background: palette.dark,
            color: "white",
            boxShadow: "0 25px 55px rgba(31,39,37,0.28)",
            opacity: centerProgress,
            transform: `scale(${0.75 + centerProgress * 0.25}) rotate(${(1 - centerProgress) * -7}deg)`
          }}
        >
          <div style={{ color: palette.mint, fontSize: 12, fontWeight: 900, letterSpacing: "0.08em" }}>
            {phaseLabels[phaseIndex]}
          </div>
          <div style={{ marginTop: 12, fontSize: 23, fontWeight: 950, lineHeight: 1.16 }}>竞品分析<br />能力包</div>
          <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
            {["可发现", "可复用", "可维护"].map((item, index) => {
              const itemProgress = stagedProgress(
                frame,
                durationInFrames,
                0.63 + index * 0.11,
                0.72 + index * 0.11
              );
              return (
              <div
                key={item}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 12,
                  fontWeight: 850,
                  opacity: itemProgress,
                  transform: `translateX(${(1 - itemProgress) * 10}px)`
                }}
              >
                <Dot color={palette.mint} size={6} /> {item}
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </SceneCanvas>
  );
}

function SkillDiscoveryScene({ durationInFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phaseIndex = motionPhaseIndex(frame, durationInFrames);
  const queryStepFrames = Math.max(1, Math.round(durationInFrames * 0.08));
  const queryLength = Math.min(4, Math.floor(frame / queryStepFrames));
  const query = "竞品分析".slice(0, queryLength);
  const match = entrance(frame, fps, Math.round(durationInFrames * 0.34));
  const folderDelay = Math.round(durationInFrames * 0.48);
  const folderRowDelay = Math.round(durationInFrames * 0.1);
  const readCount = Math.min(
    4,
    Math.max(0, Math.floor((frame - folderDelay) / folderRowDelay) + 1)
  );
  const pulse = 0.35 + (Math.sin(frame / 7) + 1) * 0.2;
  const statusLabels = ["正在理解任务", "匹配度 96% · 可调用", `按需读取 ${readCount} / 4`];
  return (
    <SceneCanvas durationInFrames={durationInFrames}>
      <MicroHeading eyebrow="发现与调用" title="Agent 先匹配能力，再按需读取" accent={palette.purple} />
      <div
        style={{
          marginTop: 30,
          padding: 18,
          border: `1px solid ${palette.line}`,
          borderRadius: 23,
          background: palette.panel,
          boxShadow: panelShadow
        }}
      >
        <div
          style={{
            height: 58,
            padding: "0 16px",
            borderRadius: 17,
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "#F1F3F0",
            border: `1px solid ${palette.line}`
          }}
        >
          <span style={{ color: palette.muted, fontSize: 19 }}>⌕</span>
          <span style={{ color: query ? palette.ink : palette.muted, fontSize: 19, fontWeight: 850 }}>
            {query || "描述当前任务…"}
          </span>
          <span style={{ width: 2, height: 23, background: palette.purple, opacity: frame % 18 < 9 ? 1 : 0 }} />
        </div>
        <div
          style={{
            position: "relative",
            marginTop: 18,
            minHeight: 250,
            padding: 17,
            borderRadius: 19,
            background: palette.purpleSoft,
            opacity: match,
            transform: `translateY(${(1 - match) * 24}px)`
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: -5,
              borderRadius: 24,
              border: `3px solid rgba(119,89,221,${pulse})`
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 15,
                display: "grid",
                placeItems: "center",
                background: palette.purple,
                color: "white",
                fontSize: 22,
                fontWeight: 950
              }}
            >
              S
            </div>
            <div>
              <div style={{ color: palette.ink, fontSize: 19, fontWeight: 950 }}>competitive-analysis</div>
              <div style={{ marginTop: 3, color: palette.purple, fontSize: 12, fontWeight: 900 }}>
                {statusLabels[phaseIndex]}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 19 }}>
            <FolderTree frame={frame} delay={folderDelay} rowDelay={folderRowDelay} compact />
          </div>
        </div>
      </div>
    </SceneCanvas>
  );
}

function Contributor({ name, role, color, delay, barDuration, detail }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = entrance(frame, fps, delay);
  const bar = clampInterpolation(
    frame,
    [delay + barDuration * 0.08, delay + barDuration],
    [0, 1],
    Easing.out(Easing.cubic)
  );
  const emphasis = progress * (1 - bar);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "42px 1fr auto",
        alignItems: "center",
        gap: 11,
        minHeight: 84,
        padding: "12px 14px",
        border: `1px solid ${palette.line}`,
        borderRadius: 18,
        background: palette.panel,
        opacity: progress,
        boxShadow: `0 12px 28px rgba(27,43,38,${0.05 + emphasis * 0.05})`,
        transform: `translateX(${(1 - progress) * -45}px) scale(${1 + emphasis * 0.01})`
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 14,
          display: "grid",
          placeItems: "center",
          background: `${color}20`,
          color,
          fontSize: 15,
          fontWeight: 950
        }}
      >
        {name}
      </div>
      <div>
        <div style={{ color: palette.ink, fontSize: 15, fontWeight: 950 }}>{role}</div>
        <div style={{ marginTop: 4, color: palette.muted, fontSize: 12, fontWeight: 750 }}>{detail}</div>
        <div style={{ marginTop: 8, height: 5, borderRadius: 5, background: "#E5E9E6", overflow: "hidden" }}>
          <div style={{ width: `${bar * 100}%`, height: "100%", background: color }} />
        </div>
      </div>
      <div style={{ color, fontSize: 17, fontWeight: 950, opacity: bar }}>✓</div>
    </div>
  );
}

function TeamExampleScene({ durationInFrames }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phaseIndex = motionPhaseIndex(frame, durationInFrames);
  const contributorDelays = [0.04, 0.32, 0.6].map((ratio) => Math.round(durationInFrames * ratio));
  const barDuration = Math.round(durationInFrames * 0.22);
  const result = entrance(frame, fps, Math.round(durationInFrames * 0.78));
  const phaseLabels = ["汇入步骤", "补齐口径", "形成共享能力"];
  return (
    <SceneCanvas durationInFrames={durationInFrames}>
      <MicroHeading eyebrow="一个具体场景" title="三位同事，共建一个竞品分析 Skill" accent={palette.orange} />
      <div style={{ marginTop: 25, display: "grid", gap: 10 }}>
        <Contributor name="甲" role="研究负责人" detail="写出 20 条分析步骤" color={palette.blue} delay={contributorDelays[0]} barDuration={barDuration} />
        <Contributor name="乙" role="数据同学" detail="补齐指标与数据口径" color={palette.purple} delay={contributorDelays[1]} barDuration={barDuration} />
        <Contributor name="丙" role="审核同学" detail="加入风险与验收标准" color={palette.orange} delay={contributorDelays[2]} barDuration={barDuration} />
      </div>
      <div
        style={{
          marginTop: 17,
          minHeight: 84,
          padding: "14px 16px",
          borderRadius: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: palette.dark,
          color: "white",
          opacity: result,
          transform: `translateY(${(1 - result) * 20}px)`
        }}
      >
        <div>
          <div style={{ color: palette.mint, fontSize: 11, fontWeight: 900, letterSpacing: "0.08em" }}>
            {phaseLabels[phaseIndex]}
          </div>
          <div style={{ marginTop: 5, fontSize: 18, fontWeight: 950 }}>competitive-analysis/</div>
        </div>
        <div style={{ ...pillStyle(palette.dark, palette.mint), fontSize: 13 }}>可复用 ✓</div>
      </div>
    </SceneCanvas>
  );
}

const sceneComponents = [
  HookScene,
  PromptRepeatScene,
  PromptToSkillScene,
  KnowledgeMergeScene,
  SkillDiscoveryScene,
  TeamExampleScene
];

function ChapterProgress({ currentSecond }) {
  const progress = visualProofProgressAt(currentSecond);
  const progressPixels = Math.round(progress * CHAPTER_PROGRESS_WIDTH);
  return (
    <div
      aria-label={`视频进度 ${Math.round(progress * 100)}%，共 ${VISUAL_PROOF_SHOTS.length} 个阶段`}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 36,
        overflow: "hidden",
        borderTop: "1px solid rgba(100, 111, 106, 0.24)",
        backgroundColor: "rgba(239, 242, 239, 0.30)",
        backfaceVisibility: "hidden"
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: progressPixels,
          backgroundColor: "rgba(128, 139, 133, 0.18)",
          transform: "translateZ(0)",
          backfaceVisibility: "hidden"
        }}
      />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gridTemplateColumns: CHAPTER_PROGRESS_GRID,
          height: "100%"
        }}
      >
        {VISUAL_PROOF_SHOTS.map((shot, index) => (
          <div
            key={shot.id}
            style={{
              display: "grid",
              placeItems: "center",
              borderLeft: index === 0 ? "none" : "1px solid rgba(90, 103, 97, 0.18)",
              color: "rgba(57, 67, 63, 0.84)",
              fontSize: 12,
              fontWeight: 820,
              letterSpacing: "0.04em"
            }}
          >
            {shot.chapter}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentSkillVisualProof({
  audioPublicPath = APPROVED_VISUAL_PROOF_AUDIO,
  subtitleTrack = "approved"
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSecond = frame / fps;
  const subtitle = subtitleTrack === "local-tts-zm-010"
    ? localTtsSubtitleAt(currentSecond)
    : visualProofSubtitleAt(currentSecond);
  return (
    <AbsoluteFill
      lang="zh-CN"
      style={{
        color: palette.ink,
        fontFamily: VIDEO_SANS_FONT_FAMILY,
        overflow: "hidden"
      }}
    >
      <Audio src={staticFile(audioPublicPath)} />
      <Backdrop />
      {VISUAL_PROOF_SHOTS.map((shot, index) => {
        const Component = sceneComponents[index];
        const from = Math.round(shot.start * fps);
        const durationInFrames = Math.round((shot.end - shot.start) * fps);
        return (
          <Sequence key={shot.id} from={from} durationInFrames={durationInFrames} premountFor={fps}>
            <Component durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
      <Subtitle
        text={subtitle}
        variant="outline"
        bottom={82}
        horizontalInset={12}
        fontSize={21}
        lineHeight={1.28}
      />
      <ChapterProgress currentSecond={currentSecond} />
    </AbsoluteFill>
  );
}
