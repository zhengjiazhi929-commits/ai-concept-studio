import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  interpolateColors,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import {
  ArrowRight,
  ArrowsClockwise,
  Brain,
  ChatCircleDots,
  Check,
  CheckCircle,
  Code,
  Database,
  Eye,
  File,
  FlowArrow,
  FolderOpen,
  Globe,
  ListChecks,
  LockKey,
  ShieldCheck,
  Terminal,
  User,
  Wrench
} from "@phosphor-icons/react";
import {
  ChapterLabel,
  ContentWindow,
  FadeIn,
  PlainSubtitle,
  WallpaperStage,
  stageWindowMotion,
  visualColors
} from "./components/visual-system.jsx";
import { VIDEO_SANS_FONT_FAMILY } from "./font-system.mjs";

const fontFamily = VIDEO_SANS_FONT_FAMILY;

const sceneTiming = {
  operation: { start: 0, end: 250, chapter: "01" },
  concept: { start: 253, end: 680, chapter: "02" },
  acceptance: { start: 683, end: 900, chapter: "03" }
};

function IconNode({ icon: Icon, zh, en, active = false, strength, state = "default", compact = false, roomy = false }) {
  const activeStrength = strength ?? (active ? 1 : 0);
  const stateColor =
    state === "error"
      ? visualColors.warningOrange
      : state === "success"
        ? visualColors.successGreen
        : active
          ? visualColors.activeBlue
          : visualColors.line;
  return (
    <div
      style={{
        minHeight: roomy ? 112 : compact ? 58 : 72,
        minWidth: compact ? 118 : 148,
        padding: compact ? "9px 12px" : "12px 15px",
        display: "flex",
        alignItems: "center",
        gap: compact ? 9 : 12,
        borderRadius: compact ? 12 : 14,
        border: `1.5px solid ${interpolateColors(activeStrength, [0, 1], [visualColors.line, stateColor])}`,
        backgroundColor: interpolateColors(
          activeStrength,
          [0, 1],
          [visualColors.surface, visualColors.activeTint]
        ),
        boxShadow:
          activeStrength > 0.02
            ? `0 10px 26px rgba(47,127,247,${0.08 + activeStrength * 0.1})`
            : "0 4px 14px rgba(52,72,105,0.05)",
        color: active ? visualColors.ink : visualColors.muted,
        transform: `translateY(${-2 * activeStrength}px) scale(${1 + 0.01 * activeStrength})`
      }}
    >
      <Icon size={compact ? 24 : 30} weight={active ? "duotone" : "regular"} color={stateColor} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: compact ? 16 : 19, fontWeight: 740, color: visualColors.ink, whiteSpace: "nowrap" }}>{zh}</div>
        <div style={{ marginTop: 2, fontSize: compact ? 10 : 12, fontWeight: 560, color: visualColors.muted, whiteSpace: "nowrap" }}>{en}</div>
      </div>
      {state === "success" ? <Check size={19} weight="bold" color={visualColors.successGreen} /> : null}
      {state === "error" ? <span style={{ color: visualColors.warningOrange, fontWeight: 900 }}>!</span> : null}
    </div>
  );
}

function Arrow({ active = false, vertical = false, color }) {
  return (
    <ArrowRight
      size={vertical ? 25 : 28}
      weight="bold"
      color={color ?? (active ? visualColors.activeBlue : "#A8B2C3")}
      style={{ transform: vertical ? "rotate(90deg)" : undefined, flex: "0 0 auto" }}
    />
  );
}

function OperationScene({ localFrame, vertical }) {
  const zoom = interpolate(localFrame, [0, 210], [1.01, 1.08], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic)
  });
  const highlight = interpolate(localFrame, [56, 76, 180, 206], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  if (vertical) {
    return (
      <div style={{ height: "100%", padding: "28px 26px 24px", backgroundColor: visualColors.canvas }}>
        <div style={{ fontSize: 31, fontWeight: 800, color: visualColors.ink }}>真实任务进入 Agent</div>
        <div style={{ marginTop: 8, fontSize: 18, color: visualColors.muted }}>Real task execution</div>
        <div
          style={{
            position: "relative",
            height: 930,
            marginTop: 24,
            overflow: "hidden",
            border: `1px solid ${visualColors.line}`,
            borderRadius: 20,
            backgroundColor: visualColors.surface
          }}
        >
          <Img
            src={staticFile("episodes/golden-001/demo-final-before-export.png")}
            style={{ width: "100%", height: "auto", transform: `scale(${zoom})`, transformOrigin: "50% 0%" }}
          />
          <div
            style={{
              position: "absolute",
              top: 278,
              right: 32,
              width: 180,
              height: 66,
              border: `3px solid ${visualColors.warningOrange}`,
              borderRadius: 16,
              opacity: highlight,
              boxShadow: "0 0 0 7px rgba(255,154,87,0.14)"
            }}
          />
        </div>
        <div style={{ marginTop: 24, display: "grid", gap: 14 }}>
          {[
            [Eye, "读取真实界面", "Read UI", true],
            [Wrench, "准备执行任务", "Prepare action", localFrame > 78],
            [ShieldCheck, "等待权限与验收", "Permission & review", localFrame > 150]
          ].map(([Icon, zh, en, active]) => (
            <IconNode key={zh} icon={Icon} zh={zh} en={en} active={active} compact />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "1.66fr 0.82fr", backgroundColor: visualColors.canvas }}>
      <div style={{ position: "relative", margin: 24, overflow: "hidden", borderRadius: 18, border: `1px solid ${visualColors.line}`, backgroundColor: visualColors.surface, boxShadow: "0 18px 44px rgba(52,72,105,0.13)" }}>
        <Img
          src={staticFile("episodes/golden-001/demo-final-before-export.png")}
          style={{ width: "100%", height: "auto", transform: `translateY(-2%) scale(${zoom})`, transformOrigin: "50% 0%" }}
        />
        <div
          style={{
            position: "absolute",
            top: 310,
            right: 70,
            width: 135,
            height: 56,
            border: `3px solid ${visualColors.warningOrange}`,
            borderRadius: 14,
            opacity: highlight,
            boxShadow: "0 0 0 7px rgba(255,154,87,0.14)"
          }}
        />
      </div>
      <div style={{ padding: "44px 36px 34px 14px" }}>
        <div style={{ color: visualColors.muted, fontSize: 16, fontWeight: 700 }}>当前任务 / CURRENT TASK</div>
        <div style={{ marginTop: 14, color: visualColors.ink, fontSize: 34, lineHeight: 1.18, fontWeight: 820 }}>批量导出客户数据</div>
        <div style={{ marginTop: 14, color: visualColors.muted, fontSize: 18, lineHeight: 1.55 }}>Agent 先读取真实产品状态，再决定需要调用哪些工具。</div>
        <div style={{ marginTop: 38, display: "grid", gap: 16 }}>
          {[
            [Eye, "读取真实界面", "Read UI", true],
            [Wrench, "准备执行任务", "Prepare action", localFrame > 78],
            [ShieldCheck, "等待权限与验收", "Permission & review", localFrame > 150]
          ].map(([Icon, zh, en, active], index) => (
            <FadeIn key={zh} start={index * 34 + 12}>
              <IconNode icon={Icon} zh={zh} en={en} active={active} compact />
            </FadeIn>
          ))}
        </div>
        <div style={{ marginTop: 36, paddingTop: 22, borderTop: `1px solid ${visualColors.line}`, color: visualColors.muted, fontSize: 15, lineHeight: 1.5 }}>
          本地演示环境 · 虚构数据<br />真实操作用于建立可核验的任务上下文
        </div>
      </div>
    </div>
  );
}

function ConceptScene({ localFrame, vertical }) {
  const step = Math.min(9, Math.max(1, Math.floor(localFrame / 43) + 1));
  const active = (target) => step >= target;
  const strength = (target) =>
    interpolate(localFrame, [(target - 1) * 43 - 8, (target - 1) * 43 + 10], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.22, 1, 0.36, 1)
    });

  if (vertical) {
    return (
      <div style={{ height: "100%", padding: "30px 26px 150px", backgroundColor: visualColors.canvas, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 34, fontWeight: 820, color: visualColors.ink }}>Agent 工具调用</div>
            <div style={{ marginTop: 7, fontSize: 17, color: visualColors.muted }}>根据目标选择工具，并在权限范围内完成任务</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, color: visualColors.successGreen, fontSize: 15, fontWeight: 720 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: visualColors.successGreen }} />
            运行中
          </div>
        </div>
        <div style={{ marginTop: 28, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <IconNode icon={User} zh="用户目标" en="User Goal" active={active(1)} strength={strength(1)} />
            <Arrow active={active(2)} />
            <IconNode icon={Brain} zh="智能体核心" en="Agent Core" active={active(2)} strength={strength(2)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <IconNode icon={FlowArrow} zh="工具路由" en="Tool Router" active={active(3)} strength={strength(3)} />
            <Arrow active={active(4)} />
            <IconNode icon={ShieldCheck} zh="权限确认" en="Permission" active={active(4)} strength={strength(4)} />
          </div>
        </div>

        <div style={{ marginTop: 26, color: visualColors.muted, fontSize: 15, fontWeight: 720 }}>可用工具 / AVAILABLE TOOLS</div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <IconNode icon={Globe} zh="网页搜索" en="Web Search" active={active(5)} strength={strength(5)} compact roomy />
          <IconNode icon={Code} zh="代码执行" en="Code Runtime" active={false} strength={0} compact roomy />
          <IconNode icon={FolderOpen} zh="文件系统" en="File System" active={false} strength={0} compact roomy />
          <IconNode icon={Database} zh="数据库" en="Database" active={false} strength={0} compact roomy />
          <div style={{ gridColumn: "1 / -1" }}>
            <IconNode icon={File} zh="外部 API" en="External API" active={false} strength={0} compact roomy />
          </div>
        </div>

        <div style={{ marginTop: 26, padding: "22px", border: `1px solid ${visualColors.line}`, borderRadius: 18, backgroundColor: visualColors.surfaceElevated, boxShadow: "0 16px 38px rgba(52,72,105,0.09)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: visualColors.ink, fontSize: 22, fontWeight: 780 }}>调用详情</div>
            <div style={{ color: step >= 6 ? visualColors.successGreen : visualColors.activeBlue, fontSize: 14, fontWeight: 720 }}>
              {step >= 6 ? "已完成" : "运行中"}
            </div>
          </div>
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              ["选中工具", step < 5 ? "等待路由" : "网页搜索"],
              ["所需权限", step < 4 ? "待确认" : "网络访问"],
              ["预计耗时", step < 5 ? "—" : "1.2s"],
              ["调用状态", step < 6 ? "运行中" : "已完成"]
            ].map(([label, value]) => (
              <div key={label} style={{ padding: "13px 14px", borderRadius: 12, backgroundColor: visualColors.surfaceTint }}>
                <div style={{ color: visualColors.muted, fontSize: 12, fontWeight: 650 }}>{label}</div>
                <div style={{ marginTop: 6, color: value.includes("完成") ? visualColors.successGreen : visualColors.ink, fontSize: 17, fontWeight: 740 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", padding: "34px 42px 76px", backgroundColor: visualColors.canvas, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 36, fontWeight: 820, color: visualColors.ink }}>Agent 工具调用</div>
          <div style={{ marginTop: 8, fontSize: 17, color: visualColors.muted }}>Agent 根据目标选择工具，并在权限范围内安全完成任务。</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: visualColors.successGreen, fontSize: 14, fontWeight: 700 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: visualColors.successGreen }} />
          运行中
        </div>
      </div>

      <div style={{ marginTop: 38, display: "grid", gridTemplateColumns: "1fr 294px", gap: 30 }}>
        <div style={{ display: "grid", gridTemplateRows: "auto auto", gap: 30, alignSelf: "start" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 11 }}>
            <IconNode icon={User} zh="用户目标" en="User Goal" active={active(1)} strength={strength(1)} />
            <Arrow active={active(2)} />
            <IconNode icon={Brain} zh="智能体核心" en="Agent Core" active={active(2)} strength={strength(2)} />
            <Arrow active={active(3)} />
            <IconNode icon={FlowArrow} zh="工具路由" en="Tool Router" active={active(3)} strength={strength(3)} />
            <Arrow active={active(4)} />
            <IconNode icon={ShieldCheck} zh="权限网关" en="Permission Gateway" active={active(4)} strength={strength(4)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
            <IconNode icon={Globe} zh="网页搜索" en="Web Search" active={active(5)} strength={strength(5)} compact roomy />
            <IconNode icon={Code} zh="代码执行" en="Code Runtime" active={false} strength={0} compact roomy />
            <IconNode icon={FolderOpen} zh="文件系统" en="File System" active={false} strength={0} compact roomy />
            <IconNode icon={Database} zh="数据库" en="Database" active={false} strength={0} compact roomy />
            <IconNode icon={File} zh="外部 API" en="External API" active={false} strength={0} compact roomy />
          </div>
        </div>

        <div style={{ padding: "22px 20px 18px", border: `1px solid ${visualColors.line}`, borderRadius: 18, backgroundColor: visualColors.surfaceElevated, boxShadow: "0 16px 38px rgba(52,72,105,0.09)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: visualColors.ink, fontSize: 18, fontWeight: 760 }}>调用详情</div>
              <div style={{ marginTop: 2, color: visualColors.muted, fontSize: 11 }}>Call Detail</div>
            </div>
            <div style={{ color: visualColors.successGreen, fontSize: 12, fontWeight: 700 }}>运行中</div>
          </div>
          {[
            ["选中工具", step < 5 ? "等待路由" : "网页搜索"],
            ["所需权限", step < 4 ? "待确认" : "网络访问"],
            ["预计耗时", step < 5 ? "—" : "1.2s"],
            ["调用状态", step < 6 ? "运行中" : "已完成"],
            ["结果摘要", step < 6 ? "等待工具返回" : "已获取相关资料"]
          ].map(([label, value]) => (
            <div key={label} style={{ marginTop: 13, padding: "10px 11px", borderRadius: 10, backgroundColor: visualColors.surfaceTint }}>
              <div style={{ color: visualColors.muted, fontSize: 11, fontWeight: 650 }}>{label}</div>
              <div style={{ marginTop: 5, color: value.includes("完成") ? visualColors.successGreen : visualColors.ink, fontSize: 14, fontWeight: 720 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TerminalPanel({ vertical }) {
  const lines = [
    ["$ pnpm test", "muted"],
    ["PASS  tests/visual-system.test.mjs", "success"],
    ["✓ 16:9 母版参数正确", "success"],
    ["✓ 9:16 重构参数正确", "success"],
    ["✓ 无进度条与章节计数", "success"],
    ["✓ 真实素材路径可用", "success"],
    ["", "muted"],
    ["Test Suites:  1 passed", "success"],
    ["Tests:        3 passed", "success"],
    ["Build:        completed successfully", "success"]
  ];
  return (
    <div style={{ height: "100%", overflow: "hidden", borderRadius: 16, backgroundColor: "#FBFCFE", color: visualColors.ink, boxShadow: `inset 0 0 0 1px ${visualColors.line}, 0 14px 34px rgba(52,72,105,0.08)` }}>
      <div style={{ padding: vertical ? "16px 18px" : "12px 16px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${visualColors.line}`, fontSize: vertical ? 16 : 13, color: visualColors.muted }}>
        <Terminal size={vertical ? 22 : 18} /> 验收终端 / acceptance
      </div>
      <div style={{ padding: vertical ? "22px 22px" : "18px 20px", fontFamily: '"JetBrains Mono", "SFMono-Regular", monospace', fontSize: vertical ? 17 : 15, lineHeight: vertical ? 1.7 : 1.62 }}>
        {lines.map(([line, tone], index) => (
          <FadeIn key={`${line}-${index}`} start={vertical ? 682 + index * 7 : 682 + index * 6} duration={5}>
            <div style={{ color: tone === "success" ? visualColors.successGreen : visualColors.muted, minHeight: "1.6em" }}>{line || " "}</div>
          </FadeIn>
        ))}
      </div>
    </div>
  );
}

function AcceptanceChecklist({ vertical }) {
  const items = [
    [CheckCircle, "真实界面已经执行", "Real UI executed"],
    [ShieldCheck, "权限边界已经检查", "Permission checked"],
    [ArrowsClockwise, "失败路径可以恢复", "Recovery verified"],
    [ListChecks, "交付证据可以审阅", "Evidence reviewable"]
  ];
  return (
    <div style={{ height: "100%", padding: vertical ? "24px" : "22px 24px", borderRadius: 16, border: `1px solid ${visualColors.line}`, backgroundColor: visualColors.surfaceElevated, boxShadow: "0 16px 38px rgba(52,72,105,0.09)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <CheckCircle size={vertical ? 36 : 31} weight="fill" color={visualColors.successGreen} />
        <div>
          <div style={{ color: visualColors.ink, fontSize: vertical ? 28 : 24, fontWeight: 820 }}>任务通过验收</div>
          <div style={{ marginTop: 2, color: visualColors.muted, fontSize: vertical ? 15 : 13 }}>Task accepted with evidence</div>
        </div>
      </div>
      <div style={{ marginTop: vertical ? 22 : 18, display: "grid", gap: vertical ? 13 : 10 }}>
        {items.map(([Icon, zh, en], index) => (
          <FadeIn key={zh} start={714 + index * 12} duration={7}>
            <div style={{ padding: vertical ? "14px 16px" : "11px 13px", display: "flex", alignItems: "center", gap: 12, borderRadius: 12, backgroundColor: visualColors.surfaceTint }}>
              <Icon size={vertical ? 25 : 21} color={visualColors.successGreen} />
              <div style={{ flex: 1 }}>
                <div style={{ color: visualColors.ink, fontSize: vertical ? 18 : 15, fontWeight: 720 }}>{zh}</div>
                <div style={{ marginTop: 1, color: visualColors.muted, fontSize: vertical ? 11 : 10 }}>{en}</div>
              </div>
              <Check size={20} weight="bold" color={visualColors.successGreen} />
            </div>
          </FadeIn>
        ))}
      </div>
    </div>
  );
}

function AcceptanceScene({ localFrame, vertical }) {
  const imageZoom = interpolate(localFrame, [0, 210], [1.02, 1.06], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (vertical) {
    return (
      <div style={{ height: "100%", padding: "24px", backgroundColor: visualColors.canvas }}>
        <div style={{ fontSize: 31, fontWeight: 820, color: visualColors.ink }}>结果验收 / Task Acceptance</div>
        <div style={{ marginTop: 20, height: 360 }}><TerminalPanel vertical /></div>
        <div style={{ marginTop: 18, height: 420, overflow: "hidden", borderRadius: 18, border: `1px solid ${visualColors.line}`, backgroundColor: visualColors.surface, boxShadow: "0 16px 38px rgba(52,72,105,0.1)" }}>
          <Img src={staticFile("episodes/golden-001/demo-admin-export-complete.png")} style={{ width: "100%", height: "auto", transform: `scale(${imageZoom})`, transformOrigin: "50% 0%" }} />
        </div>
        <div style={{ marginTop: 18, height: 440 }}><AcceptanceChecklist vertical /></div>
      </div>
    );
  }
  return (
    <div style={{ height: "100%", padding: 22, display: "grid", gridTemplateColumns: "0.96fr 1.04fr", gap: 20, backgroundColor: visualColors.canvas }}>
      <div style={{ minHeight: 0, display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", gap: 14 }}>
        <TerminalPanel />
        <div style={{ color: visualColors.muted, fontSize: 13 }}>43 / 43 tests · build complete</div>
      </div>
      <div style={{ minHeight: 0, display: "grid", gridTemplateRows: "minmax(0, 0.9fr) minmax(0, 1.1fr)", gap: 16 }}>
        <div style={{ minHeight: 0, overflow: "hidden", borderRadius: 16, border: `1px solid ${visualColors.line}`, backgroundColor: visualColors.surface, boxShadow: "0 16px 38px rgba(52,72,105,0.1)" }}>
          <Img src={staticFile("episodes/golden-001/demo-admin-export-complete.png")} style={{ width: "100%", height: "auto", transform: `translateY(-1%) scale(${imageZoom})`, transformOrigin: "50% 0%" }} />
        </div>
        <AcceptanceChecklist />
      </div>
    </div>
  );
}

function subtitleAt(frame) {
  if (frame < sceneTiming.concept.start) return "先让 Agent 在真实界面里接收并执行任务";
  if (frame < sceneTiming.acceptance.start) return "Agent 会根据目标选择工具，并在权限范围内完成任务";
  return "最终交付的不是一次调用，而是一条可以验收的证据链";
}

export function VisualSystemSample() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const activeSceneEntry = Object.entries(sceneTiming).find(
    ([, timing]) => frame >= timing.start && frame < timing.end
  );
  const activeKey = activeSceneEntry?.[0];
  const activeTiming = activeSceneEntry?.[1];
  const activeMotion = activeTiming
    ? stageWindowMotion(frame, activeTiming.start, activeTiming.end, vertical)
    : null;
  const localFrame = activeTiming ? frame - activeTiming.start : 0;

  return (
    <AbsoluteFill style={{ fontFamily, backgroundColor: visualColors.canvas }}>
      <WallpaperStage />
      {activeKey && activeMotion?.visible ? (
        <ContentWindow
          motion={activeMotion}
          title={
            activeKey === "operation"
              ? "真实操作 / Real workflow"
              : activeKey === "concept"
                ? "概念解释 / Concept"
                : "结果验收 / Acceptance"
          }
        >
          <div style={{ height: vertical ? "calc(100% - 150px)" : "calc(100% - 96px)", overflow: "hidden" }}>
            {activeKey === "operation" ? <OperationScene localFrame={localFrame} vertical={vertical} /> : null}
            {activeKey === "concept" ? <ConceptScene localFrame={localFrame} vertical={vertical} /> : null}
            {activeKey === "acceptance" ? <AcceptanceScene localFrame={localFrame} vertical={vertical} /> : null}
          </div>
          <PlainSubtitle text={subtitleAt(frame)} />
        </ContentWindow>
      ) : null}
      <ChapterLabel />
    </AbsoluteFill>
  );
}
