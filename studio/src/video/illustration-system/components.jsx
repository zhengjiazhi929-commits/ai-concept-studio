import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { VisualSystemV1AiWatermark } from "../components/visual-system-v1/ai-watermark.jsx";
import { VISUAL_SYSTEM_V1 } from "../components/visual-system-v1/tokens.mjs";
import { VIDEO_SANS_FONT_FAMILY } from "../font-system.mjs";
import { illustrationExample, ILLUSTRATION_STYLE } from "./catalog.mjs";
import { illustrationFrameState } from "./scene-state.mjs";
import { ILLUSTRATION_GEOMETRY } from "./geometry.mjs";

const C = VISUAL_SYSTEM_V1.palette;
const border = VISUAL_SYSTEM_V1.surfaceBorder.informationCard.restingColor;
const S = ILLUSTRATION_STYLE;

export function ObjectLabel({ x, y, children, size = S.labelSize, color = C.ink, anchor = "start", weight = 600 }) {
  return <text x={x} y={y} fontSize={size} fill={color} stroke="none" textAnchor={anchor} fontWeight={weight}>{children}</text>;
}

// These are semantic objects, not icons prefixed to information-card copy.
export function DocumentObject({ x, y, width = 320, height = 120, title, active = false, children }) {
  const fold = 24;
  return <g transform={`translate(${x} ${y})`} data-illustration-object="document">
    <path d={`M 0 12 Q 0 0 12 0 H ${width - fold} L ${width} ${fold} V ${height - 12} Q ${width} ${height} ${width - 12} ${height} H 12 Q 0 ${height} 0 ${height - 12} Z`}
      fill={active ? C.mintSoft : C.paperWarm} stroke={active ? C.mintDeep : border} strokeWidth={S.strokeWidth} />
    <path d={`M ${width - fold} 0 V ${fold} H ${width}`} fill="none" stroke={active ? C.mintDeep : border} strokeWidth={2} />
    {title && <ObjectLabel x={28} y={50}>{title}</ObjectLabel>}
    {children ?? <g stroke={active ? C.mint : C.lineStrong} strokeWidth={5} strokeLinecap="round">
      <path d={`M 30 77 H ${width - 70}`} /><path d={`M 30 94 H ${width - 135}`} />
    </g>}
  </g>;
}

export function OrthogonalConnector({ points, active = false, label, labelX, labelY }) {
  for (let index = 1; index < points.length; index += 1) {
    if (points[index][0] !== points[index - 1][0] && points[index][1] !== points[index - 1][1]) throw new Error("Diagonal illustration connector");
  }
  const [endX, endY] = points.at(-1);
  const [fromX, fromY] = points.at(-2);
  const angle = Math.atan2(endY - fromY, endX - fromX) * 180 / Math.PI;
  const color = active ? C.mintDeep : border;
  return <g fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round">
    <polyline points={points.map((point) => point.join(",")).join(" ")} />
    <path d="M -13 -7 L 0 0 L -13 7" transform={`translate(${endX} ${endY}) rotate(${angle})`} strokeLinecap="round" />
    {label && <ObjectLabel x={labelX} y={labelY} size={26} color={color} anchor="middle" weight={500}>{label}</ObjectLabel>}
  </g>;
}

export function ContextObject({ x, y, width, height, title, children }) {
  return <g transform={`translate(${x} ${y})`} data-illustration-object="context">
    <rect width={width} height={height} rx={S.cornerRadius} fill={C.paperWarm} stroke={border} strokeWidth={S.strokeWidth} />
    <path d={`M 0 76 H ${width}`} stroke={border} strokeWidth={2} />
    <ObjectLabel x={28} y={49}>{title}</ObjectLabel>
    {children}
  </g>;
}

export function DataPacket({ x, y, text, width = 176 }) {
  return <g transform={`translate(${x - width / 2} ${y - 32})`} data-illustration-object="packet">
    <rect width={width} height={64} rx={12} fill={C.mintSoft} stroke={C.mintDeep} strokeWidth={3} />
    <ObjectLabel x={width / 2} y={42} size={30} anchor="middle" color={C.mintDeep}>{text}</ObjectLabel>
  </g>;
}

export function DatabaseObject({ x, y, width = 380, records, matchedIndex, highlight }) {
  const { databaseFirstRowBaseline: rowBaseline, databaseRowGap: rowGap } = ILLUSTRATION_GEOMETRY.request;
  return <g transform={`translate(${x} ${y})`} data-illustration-object="database">
    <path d={`M 0 40 V 324 C 0 377 ${width} 377 ${width} 324 V 40`} fill={C.paperWarm} stroke={border} strokeWidth={3} />
    <ellipse cx={width / 2} cy={40} rx={width / 2} ry={40} fill={C.mintSoft} stroke={border} strokeWidth={3} />
    {records.map(([key, value], index) => <g key={key}>
      {highlight && index === matchedIndex && <rect x={22} y={rowBaseline - 40 + index * rowGap} width={width - 44} height={58} rx={8} fill={C.mintSoft} stroke={C.mintDeep} strokeWidth={2} />}
      <ObjectLabel x={40} y={rowBaseline + index * rowGap} size={28} color={index === matchedIndex && highlight ? C.mintDeep : C.muted}>{key}</ObjectLabel>
      <ObjectLabel x={width / 2 + 34} y={rowBaseline + index * rowGap} size={28} anchor="middle" color={index === matchedIndex && highlight ? C.mintDeep : C.muted} weight={500}>{value}</ObjectLabel>
    </g>)}
  </g>;
}

function SelectLoad({ state, copy }) {
  const g = ILLUSTRATION_GEOMETRY.selection;
  return <>
    <ObjectLabel x={230} y={352} size={28} color={C.muted} weight={500}>材料目录</ObjectLabel>
    {copy.documents.map((title, index) => <DocumentObject key={title} x={g.sourceX} y={g.sourceY + index * g.rowGap} width={g.sourceWidth} title={title}
      active={index === copy.selectedIndex && state.selected} />)}
    <ObjectLabel x={855} y={352} anchor="middle" color={C.mintDeep}>当前任务：{copy.task}</ObjectLabel>
    <OrthogonalConnector points={[[600, 635], [1100, 635]]} active={state.packetVisible} label="只复制命中的内容" labelX={850} labelY={691} />
    <ContextObject {...g.context} title={copy.context}>
      <ObjectLabel x={28} y={374} size={26} color={state.loaded ? C.mintDeep : C.muted} weight={500}>
        {state.loaded ? "完整内容已载入" : "等待按需载入"}
      </ObjectLabel>
    </ContextObject>
    {state.packetVisible && <DocumentObject x={state.packet.x} y={state.packet.y} {...g.packet} title={copy.payload} active />}
    {state.loaded && <ObjectLabel x={1430} y={510} size={26} anchor="middle" color={C.mintDeep} weight={500}>{copy.documents[copy.selectedIndex]}</ObjectLabel>}
  </>;
}

function RequestReturn({ state, copy }) {
  const g = ILLUSTRATION_GEOMETRY.request;
  const result = copy.records[copy.matchedIndex][1];
  return <>
    <ContextObject {...g.caller} title="调用方">
      <ObjectLabel x={30} y={130} size={26} color={C.muted} weight={500}>编号</ObjectLabel>
      <ObjectLabel x={g.caller.width / 2} y={130} size={36} anchor="middle">{copy.query}</ObjectLabel>
      <path d="M 30 218 H 400" stroke={C.lineStrong} strokeWidth={2} />
      <ObjectLabel x={30} y={310} size={26} color={C.muted} weight={500}>状态</ObjectLabel>
      {!state.resultInTransit && <ObjectLabel x={g.caller.width / 2} y={310} size={32} anchor="middle" color={state.returned ? C.mintDeep : C.muted}>{state.returned ? result : "等待响应"}</ObjectLabel>}
    </ContextObject>
    <ObjectLabel x={1460} y={352} anchor="middle" size={28} color={C.muted} weight={500}>示例数据库</ObjectLabel>
    <DatabaseObject {...g.database} records={copy.records} matchedIndex={copy.matchedIndex} highlight={state.queryProgress > 0.3} />
    <OrthogonalConnector points={[[650, g.sendY], [1240, g.sendY]]} active={state.requestVisible} label="请求 → 查询条件" labelX={945} labelY={449} />
    <OrthogonalConnector points={[[1240, g.database.y + g.databaseFirstRowBaseline + copy.matchedIndex * g.databaseRowGap - 10],
      [g.returnTurnX, g.database.y + g.databaseFirstRowBaseline + copy.matchedIndex * g.databaseRowGap - 10],
      [g.returnTurnX, g.returnY], [650, g.returnY]]} active={state.resultVisible} label="结果 ← 匹配记录" labelX={945} labelY={757} />
    {state.requestVisible && <DataPacket {...state.request} text={copy.query} />}
    {state.resultInTransit && <DataPacket {...state.result} text={result} />}
    {state.queryProgress > 0 && !state.queried && <ObjectLabel x={945} y={563} size={30} color={C.mintDeep} anchor="middle">按编号匹配中</ObjectLabel>}
    {state.queried && <ObjectLabel x={945} y={563} size={30} color={C.mintDeep} anchor="middle">{state.returned ? "返回值已接收" : "找到对应记录"}</ObjectLabel>}
  </>;
}

export function VersionDocument({ x, title, copy, value, emphasized, restored, scanProgress = null }) {
  return <DocumentObject x={x} y={410} width={450} height={410} title={title} active={restored}>
    <path d="M 28 78 H 420" stroke={border} strokeWidth={2} />
    {scanProgress !== null && <rect data-illustration-scan="behind-copy" x={22} y={95 + Math.max(0, Math.min(1, scanProgress)) * 170}
      width={406} height={48} rx={8} fill={C.purpleSoft} stroke="none" opacity={0.7} />}
    {[copy.before, value, copy.after].map((line, index) => <g key={index}>
      {index === 1 && emphasized && <rect x={22} y={162} width={406} height={65} rx={8} fill={restored ? C.mintSoft : C.purpleSoft}
        stroke={restored ? C.mintDeep : C.purpleDeep} strokeWidth={2} />}
      <ObjectLabel x={35} y={136 + index * 71} size={25} color={C.muted} weight={500}>{String(index + 1).padStart(2, "0")}</ObjectLabel>
      <ObjectLabel x={98} y={136 + index * 71} size={32} color={index === 1 && emphasized ? (restored ? C.mintDeep : C.purpleDeep) : C.ink} weight={500}>{line}</ObjectLabel>
    </g>)}
  </DocumentObject>;
}

function ValidateRestore({ state, copy }) {
  return <>
    <ObjectLabel x={490} y={352} anchor="middle" size={28} color={C.muted} weight={500}>恢复来源始终保留</ObjectLabel>
    <ObjectLabel x={1420} y={352} anchor="middle" size={28} color={state.restored ? C.mintDeep : C.muted} weight={500}>
      {state.restored ? "当前内容已恢复" : "校验当前内容"}
    </ObjectLabel>
    <VersionDocument x={265} title="已知可用版本" copy={copy} value={state.sourceValue} scanProgress={state.comparing ? state.compareProgress : null} />
    <VersionDocument x={1195} title="当前版本" copy={copy} value={state.currentValue} emphasized={state.errorLocated} restored={state.restored}
      scanProgress={state.comparing ? state.compareProgress : null} />
    {state.errorLocated && !state.restored && <>
      <ObjectLabel x={955} y={493} size={30} color={C.purpleDeep} anchor="middle">定位到第 02 项</ObjectLabel>
      <ObjectLabel x={955} y={537} size={26} color={C.muted} anchor="middle" weight={500}>缺少验收环节</ObjectLabel>
    </>}
    {state.errorLocated && <OrthogonalConnector points={[[740, 780], [1165, 780]]} active={state.phase >= 2}
      label={state.restored ? "恢复完成" : "从已知版本恢复"} labelX={955} labelY={735} />}
    {state.patchVisible && <DataPacket {...state.patch} width={198} text={copy.source} />}
    {state.restored && <ObjectLabel x={955} y={493} size={30} color={C.mintDeep} anchor="middle">内容已恢复一致</ObjectLabel>}
  </>;
}

export function IllustrationScene({ exampleId }) {
  const frame = useCurrentFrame();
  const example = illustrationExample(exampleId);
  const state = illustrationFrameState(exampleId, frame);
  const scenes = { "select-load": SelectLoad, "request-return": RequestReturn, "validate-restore": ValidateRestore };
  const Content = scenes[exampleId];
  return <AbsoluteFill style={{ backgroundColor: C.paper, fontFamily: VIDEO_SANS_FONT_FAMILY, color: C.ink }}>
    <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ fontFamily: VIDEO_SANS_FONT_FAMILY }}>
      <ObjectLabel x={120} y={89} size={23} color={C.mintDeep} weight={500}>动画插画系统 / 动作样片 · 待确认</ObjectLabel>
      <ObjectLabel x={120} y={188} size={S.titleSize} weight={600}>{example.definition.title}</ObjectLabel>
      <ObjectLabel x={123} y={255} size={30} color={C.muted} weight={500}>{example.subtitle}</ObjectLabel>
      <Content state={state} copy={example.copy} />
      <ObjectLabel x={960} y={937} size={34} anchor="middle" weight={500}>{state.cue}</ObjectLabel>
      <ObjectLabel x={120} y={1025} size={21} color={C.muted} weight={500}>示意数据 · 无旁白 · 非成片验收</ObjectLabel>
      {[0, 1, 2, 3].map((phase) => <rect key={phase} x={1540 + phase * 52} y={1008} width={38} height={5} rx={2.5} fill={state.phase >= phase ? C.mintDeep : C.lineStrong} />)}
    </svg>
    <VisualSystemV1AiWatermark motionCadence="continuous" />
  </AbsoluteFill>;
}
