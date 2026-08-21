import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import {
  PhraseText,
  Subtitle,
  phraseAwareTextStyle
} from "./components/chrome.jsx";
import {
  AGENT_SKILL_EXPLANATION_KINDS,
  AGENT_SKILL_FULL_VIDEO_CHAPTERS,
  AGENT_SKILL_FULL_VIDEO_CHAPTER_WEIGHTS,
  activeDiagramItemIndex,
  agentSkillEvidenceViewportGeometry,
  agentSkillFullVideoProgressPixelsAt
} from "./agent-skill-full-video-plan.mjs";

const palette = {
  paper: "#F5F6F2",
  ink: "#18201E",
  muted: "#67706C",
  line: "#CDD5D0",
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

const panelShadow = "0 18px 42px rgba(27, 43, 38, 0.11)";
const flatPanel = {
  border: `1px solid ${palette.line}`,
  background: "#FFFFFF",
  boxShadow: "0 10px 26px rgba(27,43,38,0.08)"
};
const FULL_VIDEO_CHAPTER_GRID = AGENT_SKILL_FULL_VIDEO_CHAPTER_WEIGHTS
  .map((duration) => `${duration}fr`)
  .join(" ");

function activeItem(items, currentTime) {
  return items.find((item) => currentTime >= item.start && currentTime < item.end);
}

function clampInterpolation(frame, input, output) {
  return interpolate(frame, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
}

function entrance(frame, fps, delay = 0) {
  return spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 18, stiffness: 135, mass: 0.85 }
  });
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
    fontSize: 13,
    fontWeight: 850,
    letterSpacing: "0.02em"
  };
}

function Dot({ color = palette.orange, size = 8 }) {
  return <span style={{ width: size, height: size, borderRadius: "50%", background: color }} />;
}

function FullVideoBackdrop({ evidence = false }) {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 72) * 10;
  return (
    <>
      <AbsoluteFill style={{ backgroundColor: palette.paper }} />
      <AbsoluteFill
        style={{
          opacity: evidence ? 0.2 : 0.34,
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
          left: -165 + drift,
          top: 58,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(85,200,164,0.20), rgba(85,200,164,0))"
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 360,
          height: 360,
          right: -205 - drift,
          top: 270,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(119,89,221,0.16), rgba(119,89,221,0))"
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 28,
          bottom: 64,
          color: palette.muted,
          fontSize: 12,
          fontWeight: 800
        }}
      >
        AI Concept Studio
      </div>
    </>
  );
}

function SceneHeading({ scene, accent = palette.orange, compact = false }) {
  return (
    <div>
      <div style={{ ...pillStyle(accent, `${accent}18`), marginBottom: 12 }}>
        <Dot color={accent} />
        {scene.kicker || scene.label}
      </div>
      <div
        style={{
          color: palette.ink,
          fontSize: compact ? 29 : 34,
          fontWeight: 920,
          lineHeight: 1.12,
          letterSpacing: "-0.045em",
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.title} />
      </div>
    </div>
  );
}

function DiagramCard({ children, style = {} }) {
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 18,
        ...flatPanel,
        ...style
      }}
    >
      {children}
    </div>
  );
}

function AnimatedList({ items, localFrame, fps, sceneDurationFrames, columns = 1, accent = palette.mint }) {
  const activeIndex = activeDiagramItemIndex(localFrame, sceneDurationFrames, items.length);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 11 }}>
      {items.map((item, index) => {
        const progress = entrance(localFrame, fps, 5 + index * 6);
        const active = index === activeIndex;
        return (
          <DiagramCard
            key={item.title}
            style={{
              minHeight: item.height || 90,
              padding: "14px 15px",
              opacity: progress,
              transform: `translate(${active ? 2 : 0}px, ${(1 - progress) * 16}px)`
            }}
          >
            <div style={{ color: item.accent || accent, fontSize: 13, fontWeight: 950 }}>{item.eyebrow}</div>
            <div style={{ marginTop: 5, color: palette.ink, fontSize: 18, fontWeight: 920 }}>{item.title}</div>
            {item.body ? (
              <div style={{ marginTop: 5, color: palette.muted, fontSize: 13, fontWeight: 700, lineHeight: 1.42 }}>
                {item.body}
              </div>
            ) : null}
          </DiagramCard>
        );
      })}
    </div>
  );
}

function RepeatVsSkillDiagram({ localFrame, fps, durationInFrames }) {
  const progress = clampInterpolation(localFrame, [0, durationInFrames * 0.72], [0, 1]);
  const rows = [palette.blue, palette.purple, palette.orange];
  return (
    <div style={{ position: "relative", height: 452 }}>
      <div style={{ position: "absolute", left: 0, top: 8, width: 222, display: "grid", gap: 11 }}>
        {rows.map((color, index) => {
          const show = entrance(localFrame, fps, 5 + index * 7);
          return (
            <DiagramCard key={color} style={{ height: 104, padding: 13, opacity: show, transform: `translateX(${(1 - show) * -26}px)` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Dot color={color} />
                <span style={{ color: palette.ink, fontSize: 14, fontWeight: 900 }}>新对话 {index + 1}</span>
              </div>
              <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
                <div style={{ height: 7, width: "82%", borderRadius: 6, background: "#D9DFDB" }} />
                <div style={{ height: 7, width: `${64 + index * 6}%`, borderRadius: 6, background: `${color}62` }} />
              </div>
            </DiagramCard>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 222,
          top: 163,
          width: 82,
          height: 2,
          background: `linear-gradient(90deg, ${palette.orange}, ${palette.mint})`,
          transform: `scaleX(${progress})`,
          transformOrigin: "left",
          zIndex: 4
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 293,
          top: 155,
          color: palette.mint,
          fontSize: 18,
          fontWeight: 950,
          opacity: progress,
          zIndex: 5
        }}
      >
        →
      </div>
      <DiagramCard
        style={{
          position: "absolute",
          right: 0,
          top: 80,
          width: 205,
          minHeight: 260,
          padding: 18,
          opacity: progress,
          transform: `translateX(${(1 - progress) * 26}px)`
        }}
      >
        <div style={{ ...pillStyle(palette.dark, palette.mintSoft) }}>AGENT SKILL</div>
        <div style={{ marginTop: 14, color: palette.ink, fontSize: 27, fontWeight: 950, lineHeight: 1.12 }}>同一个<br />能力单元</div>
        {["触发条件", "执行步骤", "验收方式"].map((item) => (
          <div key={item} style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 15, color: palette.ink, fontSize: 15, fontWeight: 820 }}>
            <Dot color={palette.mint} size={7} />
            {item}
          </div>
        ))}
      </DiagramCard>
    </div>
  );
}

function SkillDirectoryDiagram(props) {
  return (
    <AnimatedList
      {...props}
      columns={1}
      items={[
        { eyebrow: "01", title: "SKILL.md", body: "触发条件、步骤与边界", accent: palette.blue, height: 82 },
        { eyebrow: "02", title: "scripts/", body: "确定性执行与重复动作", accent: palette.orange, height: 82 },
        { eyebrow: "03", title: "references/", body: "按需加载的知识材料", accent: palette.purple, height: 82 },
        { eyebrow: "04", title: "assets/", body: "输出需要的真实素材", accent: palette.mint, height: 82 }
      ]}
    />
  );
}

function LifecycleComparisonDiagram({ localFrame, fps, durationInFrames }) {
  const active = activeDiagramItemIndex(localFrame, durationInFrames, 3);
  const left = entrance(localFrame, fps, 4);
  const right = entrance(localFrame, fps, 12);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <DiagramCard style={{ minHeight: 388, padding: 18, opacity: left }}>
        <div style={{ ...pillStyle(palette.orange, palette.orangeSoft) }}>PROMPT</div>
        <div style={{ marginTop: 18, fontSize: 25, fontWeight: 950, color: palette.ink }}>一次性输入</div>
        {["临时粘贴", "版本散落", "依赖记忆"].map((item, index) => (
          <div key={item} style={{ marginTop: 18, paddingBottom: 13, borderBottom: `1px solid ${palette.line}`, color: index === active ? palette.orange : palette.muted, fontSize: 16, fontWeight: 820 }}>
            {item}
          </div>
        ))}
      </DiagramCard>
      <DiagramCard style={{ minHeight: 388, padding: 18, opacity: right }}>
        <div style={{ ...pillStyle(palette.dark, palette.mintSoft) }}>AGENT SKILL</div>
        <div style={{ marginTop: 18, fontSize: 25, fontWeight: 950, color: palette.ink }}>可安装能力</div>
        {["版本管理", "权限边界", "回归验证"].map((item, index) => (
          <div key={item} style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 18, paddingBottom: 13, borderBottom: `1px solid ${palette.line}`, color: index + 1 === active ? palette.mint : palette.ink, fontSize: 16, fontWeight: 860 }}>
            <Dot color={palette.mint} size={7} />
            {item}
          </div>
        ))}
      </DiagramCard>
    </div>
  );
}

function ProgressiveLoadingDiagram(props) {
  return (
    <AnimatedList
      {...props}
      items={[
        { eyebrow: "L1 · 始终可见", title: "元数据", body: "名称与描述先完成路由", accent: palette.blue, height: 105 },
        { eyebrow: "L2 · 命中后", title: "说明", body: "加载当前任务的主要步骤", accent: palette.purple, height: 105 },
        { eyebrow: "L3 · 需要时", title: "资源", body: "脚本、参考与素材按需进入", accent: palette.mint, height: 105 }
      ]}
    />
  );
}

function SkillToolMcpDiagram(props) {
  return (
    <AnimatedList
      {...props}
      items={[
        { eyebrow: "01 · 为什么", title: "Skill", body: "过程知识 · 顺序 · 验收", accent: palette.purple, height: 108 },
        { eyebrow: "02 · 做什么", title: "Tool", body: "执行查询、写入与操作", accent: palette.orange, height: 108 },
        { eyebrow: "03 · 怎么连接", title: "MCP", body: "统一发现并调用外部能力", accent: palette.blue, height: 108 }
      ]}
    />
  );
}

function DecisionCriteriaDiagram(props) {
  return (
    <AnimatedList
      {...props}
      columns={2}
      items={[
        { eyebrow: "01", title: "稳定", body: "目标与步骤清楚", accent: palette.blue, height: 135 },
        { eyebrow: "02", title: "重复", body: "多次出现同类任务", accent: palette.orange, height: 135 },
        { eyebrow: "03", title: "可验收", body: "错误能被检测", accent: palette.purple, height: 135 },
        { eyebrow: "04", title: "可复用", body: "不依赖单个人记忆", accent: palette.mint, height: 135 }
      ]}
    />
  );
}

function GovernanceLoopDiagram({ localFrame, fps, durationInFrames }) {
  const active = activeDiagramItemIndex(localFrame, durationInFrames, 4);
  const items = [
    { title: "发布前", body: "来源 · 权限", accent: palette.blue },
    { title: "安装时", body: "数据 · 工具", accent: palette.orange },
    { title: "运行中", body: "触发 · 失败", accent: palette.purple },
    { title: "更新后", body: "对比 · 回退", accent: palette.mint }
  ];
  return (
    <div style={{ position: "relative", height: 390 }}>
      {items.map((item, index) => {
        const angle = -90 + index * 90;
        const radius = 132;
        const x = 237 + Math.cos((angle * Math.PI) / 180) * radius - 80;
        const y = 195 + Math.sin((angle * Math.PI) / 180) * radius - 48;
        const show = entrance(localFrame, fps, 5 + index * 7);
        return (
          <DiagramCard
            key={item.title}
            style={{ position: "absolute", left: x, top: y, width: 160, height: 96, padding: 13, opacity: show, transform: `translateY(${index === active ? -3 : 0}px)` }}
          >
            <div style={{ color: item.accent, fontSize: 12, fontWeight: 950 }}>0{index + 1}</div>
            <div style={{ marginTop: 5, color: palette.ink, fontSize: 18, fontWeight: 930 }}>{item.title}</div>
            <div style={{ marginTop: 4, color: palette.muted, fontSize: 12, fontWeight: 740 }}>{item.body}</div>
          </DiagramCard>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 178,
          top: 137,
          width: 118,
          height: 118,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          border: `1px solid ${palette.line}`,
          background: "#FFFFFF",
          color: palette.ink,
          fontSize: 19,
          fontWeight: 950,
          lineHeight: 1.18,
          textAlign: "center",
          boxShadow: "0 10px 26px rgba(27,43,38,0.08)"
        }}
      >
        治理<br />闭环
      </div>
    </div>
  );
}

function LaunchChecklistDiagram(props) {
  return (
    <AnimatedList
      {...props}
      items={[
        { eyebrow: "01", title: "何时触发？", accent: palette.blue, height: 68 },
        { eyebrow: "02", title: "需要哪些输入？", accent: palette.orange, height: 68 },
        { eyebrow: "03", title: "哪些步骤不能跳？", accent: palette.purple, height: 68 },
        { eyebrow: "04", title: "什么证据算完成？", accent: palette.mint, height: 68 },
        { eyebrow: "05", title: "失败后如何回退？", accent: palette.blue, height: 68 }
      ]}
    />
  );
}

const statementDiagrams = {
  "repeat-vs-skill": RepeatVsSkillDiagram,
  "skill-directory": SkillDirectoryDiagram,
  "lifecycle-comparison": LifecycleComparisonDiagram,
  "progressive-loading": ProgressiveLoadingDiagram,
  "skill-tool-mcp": SkillToolMcpDiagram,
  "decision-criteria": DecisionCriteriaDiagram,
  "governance-loop": GovernanceLoopDiagram,
  "launch-checklist": LaunchChecklistDiagram
};

function TitleScene({ scene, localFrame, fps, durationInFrames }) {
  const title = entrance(localFrame, fps, 3);
  const choice = clampInterpolation(localFrame, [durationInFrames * 0.28, durationInFrames * 0.72], [0, 1]);
  return (
    <div style={{ paddingTop: 55 }}>
      <div style={{ ...pillStyle(palette.orange, palette.orangeSoft), marginBottom: 12 }}>
        <Dot color={palette.orange} />
        {scene.kicker}
      </div>
      <div
        style={{
          marginTop: 24,
          maxWidth: 474,
          color: palette.ink,
          fontSize: 47,
          fontWeight: 950,
          lineHeight: 1.06,
          letterSpacing: "-0.055em",
          opacity: title,
          transform: `translateY(${(1 - title) * 18}px)`,
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.title} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 58px 1fr", alignItems: "center", gap: 8, marginTop: 38 }}>
        <DiagramCard style={{ minHeight: 190, padding: 18 }}>
          <div style={{ ...pillStyle(palette.orange, palette.orangeSoft) }}>PROMPT</div>
          <div style={{ marginTop: 24, color: palette.ink, fontSize: 24, fontWeight: 950 }}>一次输入</div>
          <div style={{ marginTop: 12, color: palette.muted, fontSize: 14, fontWeight: 760, lineHeight: 1.5 }}>解决当前对话里的一个回答</div>
        </DiagramCard>
        <div style={{ color: choice > 0.5 ? palette.mint : palette.line, fontSize: 34, fontWeight: 950, textAlign: "center" }}>→</div>
        <DiagramCard style={{ minHeight: 190, padding: 18 }}>
          <div style={{ ...pillStyle(palette.dark, palette.mintSoft) }}>SKILL</div>
          <div style={{ marginTop: 24, color: palette.ink, fontSize: 24, fontWeight: 950 }}>能力单元</div>
          <div style={{ marginTop: 12, color: palette.muted, fontSize: 14, fontWeight: 760, lineHeight: 1.5 }}>让团队方法可发现、复用和治理</div>
        </DiagramCard>
      </div>
    </div>
  );
}

function EvidenceScene({ scene, localFrame, fps, durationInFrames }) {
  const geometry = agentSkillEvidenceViewportGeometry();
  return (
    <div style={{ paddingTop: 12 }}>
      <div
        style={{
          position: "relative",
          width: geometry.viewportWidth,
          height: geometry.viewportHeight,
          overflow: "hidden",
          borderRadius: 20,
          border: `1px solid ${palette.line}`,
          background: "#F4F5FA",
          boxShadow: panelShadow
        }}
      >
        <Img
          src={staticFile(scene.asset)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: geometry.viewportWidth,
            height: geometry.imageHeight,
            maxWidth: "none",
            transform: `translateY(-${geometry.imageOffsetY}px)`
          }}
        />
      </div>
    </div>
  );
}

function StatementScene({ scene, localFrame, fps, durationInFrames }) {
  const kind = AGENT_SKILL_EXPLANATION_KINDS[scene.id];
  const Diagram = statementDiagrams[kind];
  return (
    <div style={{ paddingTop: 26 }}>
      <SceneHeading scene={scene} accent={palette.mint} compact />
      <div style={{ marginTop: 25 }}>
        <Diagram localFrame={localFrame} fps={fps} durationInFrames={durationInFrames} />
      </div>
      <div
        style={{
          marginTop: 20,
          minHeight: 54,
          padding: "0 15px",
          borderRadius: 16,
          display: "flex",
          alignItems: "center",
          color: palette.ink,
          fontSize: 15,
          fontWeight: 850,
          lineHeight: 1.4,
          ...flatPanel,
          ...phraseAwareTextStyle
        }}
      >
        <Dot color={palette.orange} />
        <span style={{ marginLeft: 10 }}><PhraseText text={scene.statement} /></span>
      </div>
    </div>
  );
}

function SummaryScene({ scene, localFrame, fps, durationInFrames }) {
  const items = [
    { eyebrow: "01", title: "触发条件", accent: palette.blue },
    { eyebrow: "02", title: "完成标准", accent: palette.orange },
    { eyebrow: "03", title: "权限边界", accent: palette.purple },
    { eyebrow: "04", title: "版本回退", accent: palette.mint }
  ];
  return (
    <div style={{ paddingTop: 42 }}>
      <div style={{ ...pillStyle(palette.orange, palette.orangeSoft), marginBottom: 12 }}>
        <Dot color={palette.orange} />
        {scene.kicker}
      </div>
      <div
        style={{
          marginTop: 24,
          color: palette.ink,
          fontSize: 34,
          fontWeight: 950,
          lineHeight: 1.18,
          letterSpacing: "-0.045em",
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text="先定义边界，再把方法变成可治理的能力单元。" />
      </div>
      <div style={{ marginTop: 34 }}>
        <AnimatedList items={items} columns={2} localFrame={localFrame} fps={fps} sceneDurationFrames={durationInFrames} />
      </div>
      <div
        style={{
          marginTop: 28,
          padding: "20px 18px",
          borderRadius: 18,
          color: palette.ink,
          fontSize: 18,
          fontWeight: 860,
          lineHeight: 1.45,
          ...flatPanel,
          ...phraseAwareTextStyle
        }}
      >
        <PhraseText text={scene.statement} />
      </div>
    </div>
  );
}

function FullVideoChapterProgress({ currentSecond }) {
  const progressPixels = agentSkillFullVideoProgressPixelsAt(currentSecond);
  return (
    <div
      aria-label={`完整视频进度 ${Math.round((progressPixels / 540) * 100)}%，共 ${AGENT_SKILL_FULL_VIDEO_CHAPTERS.length} 个章节`}
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
          gridTemplateColumns: FULL_VIDEO_CHAPTER_GRID,
          height: "100%"
        }}
      >
        {AGENT_SKILL_FULL_VIDEO_CHAPTERS.map((chapter, index) => (
          <div
            key={chapter.id}
            style={{
              display: "grid",
              placeItems: "center",
              borderLeft: index === 0 ? "none" : "1px solid rgba(90, 103, 97, 0.18)",
              color: "rgba(57, 67, 63, 0.84)",
              fontSize: 11,
              fontWeight: 820,
              letterSpacing: "0.02em"
            }}
          >
            {chapter.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentSkillFullVideo({ episode }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;
  const scene = activeItem(episode.scenes, currentTime) ?? episode.scenes.at(-1);
  const localFrame = frame - Math.round(scene.start * fps);
  const durationInFrames = Math.max(1, Math.round((scene.end - scene.start) * fps));
  const fade = clampInterpolation(
    localFrame,
    [0, 8, Math.max(9, durationInFrames - 8), durationInFrames],
    [0, 1, 1, 0]
  );
  const subtitle = activeItem(episode.subtitles ?? [], currentTime)?.text ?? scene.subtitle;

  return (
    <AbsoluteFill
      lang="zh-CN"
      style={{
        color: palette.ink,
        fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
        overflow: "hidden"
      }}
    >
      {episode.voice?.publicPath ? <Audio src={staticFile(episode.voice.publicPath)} /> : null}
      <FullVideoBackdrop evidence={scene.type === "evidence"} />
      <div style={{ position: "absolute", inset: "70px 28px 154px", opacity: fade }}>
        {scene.type === "title" ? (
          <TitleScene scene={scene} localFrame={localFrame} fps={fps} durationInFrames={durationInFrames} />
        ) : null}
        {scene.type === "evidence" ? (
          <EvidenceScene scene={scene} localFrame={localFrame} fps={fps} durationInFrames={durationInFrames} />
        ) : null}
        {scene.type === "statement" ? (
          <StatementScene scene={scene} localFrame={localFrame} fps={fps} durationInFrames={durationInFrames} />
        ) : null}
        {scene.type === "summary" ? (
          <SummaryScene scene={scene} localFrame={localFrame} fps={fps} durationInFrames={durationInFrames} />
        ) : null}
      </div>
      <Subtitle
        text={subtitle}
        variant="outline"
        bottom={82}
        horizontalInset={8}
        fontSize={20}
        lineHeight={1.24}
      />
      <FullVideoChapterProgress currentSecond={currentTime} />
    </AbsoluteFill>
  );
}
