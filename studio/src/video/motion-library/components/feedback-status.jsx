import React from "react";

import { staggeredProgress } from "../motion.mjs";
import { Checkmark, MOTION_PALETTE } from "./primitives.jsx";

export function FilterTagPillEffect({ progress }) {
  const tags = ["可复用", "可维护", "可发现"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      {tags.map((tag, index) => {
        const selected = index === 1;
        const itemProgress = selected ? progress : 0;
        return (
          <div
            key={tag}
            style={{
              height: 58,
              padding: "0 25px",
              borderRadius: 999,
              border: `1px solid ${selected ? MOTION_PALETTE.mint : MOTION_PALETTE.line}`,
              backgroundColor: selected && itemProgress > 0.4 ? MOTION_PALETTE.mintSoft : MOTION_PALETTE.paperWarm,
              color: selected && itemProgress > 0.4 ? MOTION_PALETTE.mintDeep : MOTION_PALETTE.muted,
              display: "flex",
              alignItems: "center",
              gap: 9,
              fontSize: 20,
              fontWeight: 760,
              scale: selected ? 1 + (itemProgress * 0.035) : 1
            }}
          >
            {selected ? <span style={{ width: 9, height: 9, borderRadius: "50%", backgroundColor: MOTION_PALETTE.mint, opacity: itemProgress }} /> : null}
            {tag}
          </div>
        );
      })}
    </div>
  );
}

export function MorphActionPillEffect({ progress }) {
  return (
    <div
      style={{
        width: 62 + (progress * 220),
        height: 64,
        borderRadius: 999,
        border: `1px solid ${MOTION_PALETTE.mint}`,
        backgroundColor: MOTION_PALETTE.mintSoft,
        color: MOTION_PALETTE.mintDeep,
        display: "flex",
        alignItems: "center",
        justifyContent: progress < 0.35 ? "center" : "flex-start",
        padding: progress < 0.35 ? 0 : "0 20px",
        boxSizing: "border-box",
        overflow: "hidden"
      }}
    >
      <div style={{ width: 30, height: 30, borderRadius: "50%", backgroundColor: MOTION_PALETTE.mint, color: "white", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", fontSize: 18, fontWeight: 900 }}>
        ✓
      </div>
      <span style={{ marginLeft: 13, opacity: progress, whiteSpace: "nowrap", fontSize: 21, fontWeight: 800 }}>
        已完成并保存
      </span>
    </div>
  );
}

export function SegmentedStepBarEffect({ progress }) {
  const labels = ["规则", "执行", "返回", "人工"];
  return (
    <div style={{ width: 720 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {labels.map((label, index) => {
          const itemProgress = staggeredProgress(progress, index, labels.length, 0.66);
          return (
            <div key={label}>
              <div style={{ color: itemProgress > 0.6 ? (index === 3 ? MOTION_PALETTE.purpleDeep : MOTION_PALETTE.mintDeep) : MOTION_PALETTE.muted, fontSize: 16, fontWeight: 760 }}>
                {String(index + 1).padStart(2, "0")} · {label}
              </div>
              <div style={{ marginTop: 12, height: 8, borderRadius: 999, backgroundColor: "#DDE5E1", overflow: "hidden" }}>
                <div style={{ width: `${itemProgress * 100}%`, height: "100%", borderRadius: 999, backgroundColor: index === 3 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SegmentedStepperDotsEffect({ progress }) {
  const labels = ["输入", "调用", "结果", "确认"];
  return (
    <div style={{ width: 690, display: "flex", alignItems: "flex-start" }}>
      {labels.map((label, index) => {
        const itemProgress = staggeredProgress(progress, index, labels.length, 0.64);
        return (
          <React.Fragment key={label}>
            <div style={{ width: 110, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", border: `2px solid ${index === 3 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint}`, backgroundColor: itemProgress > 0.5 ? (index === 3 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint) : MOTION_PALETTE.paperWarm, scale: 0.86 + (itemProgress * 0.14) }} />
              <div style={{ marginTop: 11, color: itemProgress > 0.5 ? MOTION_PALETTE.ink : MOTION_PALETTE.muted, fontSize: 17, fontWeight: 740 }}>{label}</div>
            </div>
            {index < labels.length - 1 ? (
              <div style={{ width: 80, height: 3, marginTop: 14, borderRadius: 999, backgroundColor: MOTION_PALETTE.line, overflow: "hidden" }}>
                <div style={{ width: `${staggeredProgress(progress, index + 1, labels.length, 0.64) * 100}%`, height: "100%", backgroundColor: MOTION_PALETTE.mint }} />
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function CardGlancePreviewEffect({ progress }) {
  return (
    <div
      style={{
        width: 360 + (progress * 220),
        minHeight: 84 + (progress * 84),
        border: `1px solid ${MOTION_PALETTE.line}`,
        borderRadius: 20,
        backgroundColor: MOTION_PALETTE.paperWarm,
        padding: "20px 24px",
        boxSizing: "border-box",
        overflow: "hidden"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: MOTION_PALETTE.mintDeep, fontSize: 12, fontWeight: 850, letterSpacing: ".08em" }}>EVIDENCE</div>
          <div style={{ marginTop: 7, color: MOTION_PALETTE.ink, fontSize: 23, fontWeight: 820 }}>验收结果已返回</div>
        </div>
        <div style={{ color: MOTION_PALETTE.mintDeep, fontSize: 20, rotate: `${progress * 90}deg` }}>＋</div>
      </div>
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${MOTION_PALETTE.line}`, color: MOTION_PALETTE.muted, fontSize: 18, lineHeight: 1.45, opacity: progress, translate: `0 ${(1 - progress) * 12}px` }}>
        3 项检查全部通过，仍需由人工决定是否采用。
      </div>
    </div>
  );
}

export function BookmarkSavePillEffect({ progress }) {
  const width = 66 + (progress * 210);
  return (
    <div style={{ width, height: 66, borderRadius: 999, border: `1px solid ${MOTION_PALETTE.purple}`, backgroundColor: MOTION_PALETTE.purpleSoft, color: MOTION_PALETTE.purpleDeep, display: "flex", alignItems: "center", padding: progress < 0.3 ? 0 : "0 21px", justifyContent: progress < 0.3 ? "center" : "flex-start", boxSizing: "border-box", overflow: "hidden" }}>
      <svg width="26" height="30" viewBox="0 0 26 30" fill="none" style={{ flex: "0 0 auto" }} aria-hidden="true">
        <path d="M5 3.5h16v22l-8-5-8 5v-22Z" stroke={MOTION_PALETTE.purpleDeep} strokeWidth="2.5" strokeLinejoin="round" fill={progress > 0.55 ? MOTION_PALETTE.purple : "transparent"} />
      </svg>
      <span style={{ marginLeft: 13, opacity: progress, fontSize: 20, fontWeight: 820, whiteSpace: "nowrap" }}>已保存为可复用组件</span>
    </div>
  );
}

export function CheckboxDrawEffect({ progress }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <div style={{ width: 58, height: 58, borderRadius: 15, border: `2px solid ${MOTION_PALETTE.mint}`, backgroundColor: progress > 0.82 ? MOTION_PALETTE.mintSoft : MOTION_PALETTE.paperWarm, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Checkmark progress={progress} size={38} strokeWidth={3.2} />
      </div>
      <div>
        <div style={{ color: MOTION_PALETTE.ink, fontSize: 29, fontWeight: 830 }}>完成标准已满足</div>
        <div style={{ marginTop: 7, color: MOTION_PALETTE.muted, fontSize: 18, fontWeight: 620 }}>证据、结果与边界均可追溯</div>
      </div>
    </div>
  );
}

export function FormSubmitMorphEffect({ progress }) {
  const done = progress > 0.58;
  return (
    <div style={{ width: 310, height: 72, borderRadius: 20 + (progress * 16), border: `1px solid ${done ? MOTION_PALETTE.mint : MOTION_PALETTE.line}`, backgroundColor: done ? MOTION_PALETTE.mintSoft : MOTION_PALETTE.paperWarm, display: "flex", alignItems: "center", justifyContent: "center", color: done ? MOTION_PALETTE.mintDeep : MOTION_PALETTE.ink, fontSize: 22, fontWeight: 820, overflow: "hidden" }}>
      {done ? (
        <div style={{ display: "flex", alignItems: "center", gap: 11, opacity: (progress - 0.58) / 0.42 }}>
          <Checkmark progress={(progress - 0.58) / 0.42} size={30} />
          已提交，等待人工确认
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 11, opacity: 1 - (progress / 0.58) }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", backgroundColor: MOTION_PALETTE.mint }} />
          提交审核
        </div>
      )}
    </div>
  );
}

export function SmoothDotShiftEffect({ cycle }) {
  const phase = cycle * Math.PI * 2;
  return (
    <div style={{ position: "relative", width: 320, height: 120 }}>
      {[0, 1, 2].map((index) => {
        const angle = phase + ((Math.PI * 2 * index) / 3);
        return (
          <span
            key={index}
            style={{
              position: "absolute",
              left: 140 + (Math.cos(angle) * 90),
              top: 50 + (Math.sin(angle) * 18),
              width: 22,
              height: 22,
              borderRadius: "50%",
              backgroundColor: index === 2 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint,
              opacity: 0.72 + (0.28 * ((Math.sin(angle) + 1) / 2))
            }}
          />
        );
      })}
    </div>
  );
}

export function MagneticDotsEffect({ cycle }) {
  const phase = (1 - Math.cos(cycle * Math.PI * 2)) / 2;
  const dots = [[-150, -45], [-78, 50], [0, -65], [78, 50], [150, -45]];
  return (
    <div style={{ position: "relative", width: 440, height: 180 }}>
      {dots.map(([x, y], index) => (
        <span
          key={`${x}-${y}`}
          style={{
            position: "absolute",
            left: 208 + (x * (1 - (phase * 0.78))),
            top: 78 + (y * (1 - (phase * 0.78))),
            width: index === 2 ? 30 : 20,
            height: index === 2 ? 30 : 20,
            borderRadius: "50%",
            backgroundColor: index === 4 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint,
            opacity: 0.74 + (phase * 0.26)
          }}
        />
      ))}
    </div>
  );
}

export function ArcTracerEffect({ cycle }) {
  const dash = 250;
  return (
    <svg width="190" height="190" viewBox="0 0 190 190" fill="none" aria-hidden="true">
      <circle cx="95" cy="95" r="68" stroke={MOTION_PALETTE.line} strokeWidth="10" />
      <circle cx="95" cy="95" r="68" stroke={MOTION_PALETTE.mint} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${dash * 0.42} ${dash}`} strokeDashoffset={-dash * cycle} transform="rotate(-90 95 95)" />
      <circle cx="95" cy="95" r="16" fill={MOTION_PALETTE.purpleSoft} stroke={MOTION_PALETTE.purple} strokeWidth="2" />
    </svg>
  );
}

export function MorphingBarsEffect({ cycle }) {
  return (
    <div style={{ height: 170, display: "flex", alignItems: "center", gap: 15 }}>
      {Array.from({ length: 8 }, (_, index) => {
        const wave = (Math.sin((cycle * Math.PI * 2) + (index * 0.72)) + 1) / 2;
        return <div key={index} style={{ width: 18, height: 34 + (wave * 112), borderRadius: 999, backgroundColor: index === 6 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint }} />;
      })}
    </div>
  );
}

export function WaveformLoaderEffect({ cycle }) {
  return (
    <div style={{ width: 520, height: 170, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
      {Array.from({ length: 24 }, (_, index) => {
        const wave = Math.abs(Math.sin((cycle * Math.PI * 2) + (index * 0.35)));
        const envelope = Math.sin((Math.PI * (index + 1)) / 25);
        return <div key={index} style={{ width: 7, height: 14 + (wave * envelope * 116), borderRadius: 999, backgroundColor: index > 17 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint, opacity: 0.6 + (wave * 0.4) }} />;
      })}
    </div>
  );
}

export function ShapeShiftGridEffect({ cycle }) {
  const phase = cycle * Math.PI * 2;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 34px)", gridTemplateRows: "repeat(4, 34px)", gap: 12 }}>
      {Array.from({ length: 24 }, (_, index) => {
        const x = index % 6;
        const y = Math.floor(index / 6);
        const wave = (Math.sin(phase + ((x + y) * 0.75)) + 1) / 2;
        return <div key={index} style={{ width: 34, height: 34, borderRadius: `${8 + (wave * 9)}px`, backgroundColor: index === 17 ? MOTION_PALETTE.purple : MOTION_PALETTE.mint, opacity: 0.3 + (wave * 0.7), scale: 0.55 + (wave * 0.45) }} />;
      })}
    </div>
  );
}
