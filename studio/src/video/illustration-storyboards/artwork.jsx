import React from "react";
import { VIDEO_SANS_FONT_FAMILY } from "../font-system.mjs";
import { STORYBOARD_STYLE as S, storyboardState, orthogonalPath } from "./plan.mjs";

export function Label({ x, y, children, size = S.labelSize, color = S.ink, weight = 500, anchor = "start" }) {
  return <text data-illustration-label="true" x={x} y={y} fontSize={size} fontWeight={weight}
    fontFamily={VIDEO_SANS_FONT_FAMILY} fill={color} stroke="none" textAnchor={anchor}>{children}</text>;
}

function Definitions() {
  return <defs>
    <linearGradient id="paper-surface" x1="0" y1="0" x2="0" y2="1">
      <stop stopColor="#FFFFFF" /><stop offset="1" stopColor="#ECF6F0" />
    </linearGradient>
    <linearGradient id="selected-surface" x1="0" y1="0" x2="0" y2="1">
      <stop stopColor="#F4FCF8" /><stop offset="1" stopColor="#D8EFE3" />
    </linearGradient>
    <filter id="object-shadow" x="-15%" y="-15%" width="140%" height="150%">
      <feDropShadow dx="0" dy="12" stdDeviation="13" floodColor="#234B3E" floodOpacity="0.07" />
    </filter>
  </defs>;
}

export function Connection({ points, active = false }) {
  const path = orthogonalPath(points);
  const [x, y] = points.at(-1), [px, py] = points.at(-2);
  const head = x > px ? `${x},${y} ${x - 14},${y - 7} ${x - 14},${y + 7}` :
    x < px ? `${x},${y} ${x + 14},${y - 7} ${x + 14},${y + 7}` :
    y > py ? `${x},${y} ${x - 7},${y - 14} ${x + 7},${y - 14}` :
    `${x},${y} ${x - 7},${y + 14} ${x + 7},${y + 14}`;
  return <g data-illustration-connection="orthogonal" data-active={String(active)}>
    <path d={path} fill="none" stroke={active ? S.accent : S.border} strokeWidth={active ? 4 : 2.5} strokeLinejoin="round" />
    <polygon points={head} fill={active ? S.accent : S.border} />
  </g>;
}

export function Paper({ rect, active = false, objectId, children }) {
  const { x, y, width: w, height: h } = rect;
  const fold = 28;
  return <g data-illustration-object="document" data-object-id={objectId} transform={`translate(${x} ${y})`}>
    <path data-object-outline="paper" d={`M 14 0 H ${w - fold} L ${w} ${fold} V ${h - 14} Q ${w} ${h} ${w - 14} ${h} H 14 Q 0 ${h} 0 ${h - 14} V 14 Q 0 0 14 0 Z`}
      fill={active ? "url(#selected-surface)" : "url(#paper-surface)"} stroke={active ? S.accent : S.border}
      strokeWidth={3} filter="url(#object-shadow)" />
    <path d={`M ${w - fold} 0 V ${fold} H ${w}`} fill={active ? "#BDE4D1" : "#E4EFE9"}
      stroke={active ? S.accent : S.border} strokeWidth={2} />
    {children}
  </g>;
}

export function WindowObject({ rect, title, children, objectId = "window" }) {
  const { x, y, width: w, height: h } = rect;
  return <g data-illustration-object="window" data-object-id={objectId} transform={`translate(${x} ${y})`}>
    <rect data-object-outline="window" width={w} height={h} rx={24} fill="url(#paper-surface)"
      stroke={S.border} strokeWidth={3} filter="url(#object-shadow)" />
    <path d={`M 0 88 H ${w}`} stroke={S.border} strokeWidth={2} />
    {[30, 48, 66].map((cx) => <circle key={cx} cx={cx} cy={44} r={4} fill={S.border} />)}
    <Label x={92} y={60} size={40}>{title}</Label>
    {children}
  </g>;
}

function ContentCopy({ copy }) {
  return <Paper rect={copy.rect} active objectId="report-copy">
    <Label x={30} y={49} size={28} color={S.accent}>完整内容 · 副本</Label>
    <Label x={30} y={113} weight={550}>{copy.title}</Label>
    <path d={`M 30 143 H ${copy.rect.width - 30}`} stroke="#93BEAA" strokeWidth={2} />
    <Label x={30} y={201} size={32}>执行步骤</Label>
    <Label x={30} y={267} size={32}>验收标准</Label>
    {[189, 255].map((y) => <path key={y} d={`M 204 ${y} H ${copy.rect.width - 34}`}
      stroke="#86B69F" strokeWidth={6} strokeLinecap="round" />)}
  </Paper>;
}

function LoadArtwork({ state }) {
  return <>
    <Label x={150} y={354} size={36} color={S.secondary}>能力目录</Label>
    {state.sources.map((item) => <Paper key={item.id} rect={item.rect} active={item.selected} objectId={`source-${item.id}`}>
      <Label x={30} y={61} weight={item.selected ? 550 : 500}>{item.title}</Label>
      <Label x={30} y={112} size={32} color={S.secondary}>{item.description}</Label>
    </Paper>)}
    <WindowObject rect={state.context} title="上下文窗口" objectId="context">
      {!state.loaded && <>
        <rect x={54} y={168} width={497} height={242} rx={12} fill="none" stroke="#8EAF9E" strokeWidth={2} strokeDasharray="8 10" />
        <Label x={302} y={279} size={36} color={S.secondary} anchor="middle">完整内容尚未载入</Label>
        <Label x={302} y={334} size={32} color={S.secondary} anchor="middle">只接收命中的那份</Label>
      </>}
    </WindowObject>
    {state.copy && <ContentCopy copy={state.copy} />}
    {state.phase === 0 && <>
      <Label x={866} y={569} anchor="middle" size={32} color={S.secondary}>当前任务</Label>
      <Label x={866} y={635} anchor="middle" size={48}>整理报告</Label>
    </>}
    {state.phase > 0 && <Label x={state.phase === 1 ? 625 : 870} y={589}
      size={state.phase === 1 ? 28 : 32} color={S.accent} anchor="middle">{state.loaded ? "仅命中内容进入" : "复制"}</Label>}
  </>;
}

function QueryPacket({ x, y, children }) {
  return <g data-illustration-object="packet">
    <rect x={x} y={y} width={250} height={84} rx={42} fill="#E0F2E9" stroke={S.accent} strokeWidth={3} />
    <Label x={x + 125} y={y + 55} size={34} anchor="middle">{children}</Label>
  </g>;
}

function ToolArtwork({ state }) {
  const { x, y, width: w, height: h } = state.database;
  return <>
    <Label x={135} y={348} size={36} color={S.secondary}>调用方</Label>
    <WindowObject rect={state.caller} title="Agent" objectId="caller">
      <Label x={38} y={165} size={36}>查询订单状态</Label>
      <Label x={38} y={238} size={56} color={S.accent}>{state.query}</Label>
      <path d="M 38 266 H 462" stroke="#AFCDBE" strokeWidth={2} />
      {state.response ? <>
        <Label x={38} y={323} size={32} color={S.secondary}>收到返回值</Label>
        <Label x={38} y={381} size={44} color={S.accent}>{`${state.response.id} · ${state.response.value}`}</Label>
      </> : <Label x={38} y={343} size={36} color={S.secondary}>等待结果返回</Label>}
    </WindowObject>
    <Label x={x + w / 2} y={338} anchor="middle" size={36} color={S.secondary}>数据工具 · 示例记录</Label>
    <g data-illustration-object="database" transform={`translate(${x} ${y})`}>
      <path data-object-outline="database" d={`M 0 42 A ${w / 2} 42 0 0 1 ${w} 42 V ${h - 42} A ${w / 2} 42 0 0 1 0 ${h - 42} Z`}
        fill="url(#paper-surface)" stroke={S.border} strokeWidth={3} filter="url(#object-shadow)" />
      <ellipse cx={w / 2} cy={42} rx={w / 2} ry={42} fill="#E9F5EE" stroke={S.border} strokeWidth={3} />
      {state.records.map((record, index) => <g key={record.id} data-record-id={record.id}
        data-matched={String(state.match?.id === record.id)}>
        {state.match?.id === record.id && <rect x={28} y={103 + index * 91} width={w - 56} height={76} rx={10} fill="#D9EFE2" />}
        <Label x={51} y={155 + index * 91} size={42}>{record.id}</Label>
        <Label x={320} y={155 + index * 91} size={42} color={state.match?.id === record.id ? S.accent : S.secondary}>{record.value}</Label>
        {index < 2 && <path d={`M 42 ${187 + index * 91} H ${w - 42}`} stroke="#C5DCCE" strokeWidth={2} />}
      </g>)}
    </g>
    {state.phase < 2 && <QueryPacket x={785} y={418}>查询 A17</QueryPacket>}
    <Label x={886} y={387} size={32} anchor="middle" color={S.secondary}>请求</Label>
    {state.phase === 2 && <>
      <Label x={887} y={728} size={36} anchor="middle" color={S.accent}>结果返回</Label>
      <Label x={x + w / 2} y={886} size={32} anchor="middle" color={S.secondary}>对应行：A17 · 已发货</Label>
    </>}
  </>;
}

function PictureObject({ rect }) {
  const { x, y, width: w, height: h } = rect;
  return <g data-illustration-object="image" transform={`translate(${x} ${y})`}>
    <rect data-object-outline="image" width={w} height={h} rx={14} fill="#EDF5F0" stroke={S.border} strokeWidth={3} />
    <circle cx={w - 68} cy={37} r={15} fill="#B8DACA" />
    <path d={`M 22 ${h - 20} L 96 35 L 164 ${h - 20} Z`} fill="#C8E1D3" />
    <path d={`M 126 ${h - 20} L 218 53 L ${w - 22} ${h - 20} Z`} fill="#AACFBB" />
  </g>;
}

function ChartObject({ rect }) {
  const { x, y, width: w, height: h } = rect;
  return <g data-illustration-object="chart" transform={`translate(${x} ${y})`}>
    {[0, 1, 2].map((index) => <path key={index} d={`M 24 ${14 + index * 40} H ${w - 12}`} stroke="#C9DDCF" strokeWidth={2} />)}
    {[47, 84, 111, 68].map((height, index) => <rect key={index} x={48 + index * 69} y={h - height}
      width={38} height={height} rx={4} fill="#B3D8C4" stroke={S.border} strokeWidth={2} />)}
    <path d={`M 24 0 V ${h} H ${w - 12}`} fill="none" stroke={S.border} strokeWidth={3} />
  </g>;
}

function RouteArtwork({ state }) {
  return <>
    <Paper rect={state.task} objectId="task">
      <Label x={32} y={53} size={32} color={S.secondary}>当前任务</Label>
      <Label x={32} y={126} size={48} weight={550}>整理报告</Label>
      <path d="M 32 168 H 353 M 32 205 H 270" stroke="#BCD4C7" strokeWidth={7} strokeLinecap="round" />
    </Paper>
    <Label x={925} y={418} size={32} color={S.secondary} anchor="middle">名称 + 描述</Label>
    <g data-illustration-object="router" transform={`translate(${state.router.x} ${state.router.y})`}>
      <rect data-object-outline="router" width={270} height={300} rx={32} fill="url(#paper-surface)" stroke={S.border} strokeWidth={3} filter="url(#object-shadow)" />
      <path d="M 22 150 H 130 V 55 H 248 M 130 150 V 245 H 248" fill="none" stroke="#9ABEAB" strokeWidth={4} />
      <path data-router-primary-track="true" d="M 22 150 H 248" fill="none" stroke={state.selectedId ? S.accent : "#9ABEAB"} strokeWidth={state.selectedId ? 7 : 4} />
      <circle cx={130} cy={150} r={16} fill={state.selectedId ? S.accent : "#D9E9E0"} stroke={S.border} strokeWidth={2} />
      {[55, 150, 245].map((cy, index) => <circle key={cy} cx={248} cy={cy} r={8}
        fill={index === 1 && state.selectedId ? S.accent : "#D9E9E0"} stroke={S.border} strokeWidth={2} />)}
    </g>
    <Label x={925} y={827} size={44} anchor="middle">路由匹配</Label>
    <Label x={925} y={881} size={32} color={S.secondary} anchor="middle">依据任务选择能力</Label>
    {state.candidates.map((item) => <g key={item.id} data-route-candidate={item.id} data-active={String(item.active)}>
      {item.id === "image" ? <PictureObject rect={item.rect} /> : item.id === "data" ? <ChartObject rect={item.rect} /> :
        <Paper rect={item.rect} active={item.active} objectId="report-target">
          <Label x={26} y={55} size={40} weight={550}>{item.title}</Label>
          <Label x={26} y={103} size={32} color={item.active ? S.accent : S.secondary}>
            {state.dispatchedTo ? "已接收任务" : "适用：报告任务"}
          </Label>
        </Paper>}
      <Label x={item.rect.x + item.rect.width / 2} y={item.rect.y + item.rect.height + 49}
        size={item.id === "report" ? 32 : 40} color={item.active ? S.accent : S.secondary} anchor="middle">
        {item.id !== "report" ? item.title : state.dispatchedTo ? "等待执行，不是已完成" : item.active ? "与当前任务匹配" : "候选能力"}
      </Label>
    </g>)}
  </>;
}

export function StoryboardArtwork({ id, phase }) {
  const state = storyboardState(id, phase);
  return <svg data-storyboard={id} data-phase={phase} width={1920} height={1080} viewBox="0 0 1920 1080"
    style={{ position: "absolute", inset: 0 }}>
    <Definitions />
    {state.connections.map((connection, index) => <Connection key={index} {...connection} />)}
    {id === "load" ? <LoadArtwork state={state} /> : id === "tool" ? <ToolArtwork state={state} /> : <RouteArtwork state={state} />}
  </svg>;
}
