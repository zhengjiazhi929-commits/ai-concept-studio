import React from 'react';
import {DocumentObject,DatabaseObject,ObjectLabel,OrthogonalConnector} from '../illustration-system/components.jsx';
import {VISUAL_SYSTEM_V1} from '../components/visual-system-v1/tokens.mjs';
import {VIDEO_SANS_FONT_FAMILY} from '../font-system.mjs';
import {frostedCardStyle} from '../glass-card-preview/material.mjs';
import {conciseStoryboardState} from './plan.mjs';

const C=VISUAL_SYSTEM_V1.palette;
const tones={ink:C.ink,accent:C.mintDeep,muted:'#65716C'};
const border=VISUAL_SYSTEM_V1.surfaceBorder.informationCard.restingColor;
function Paper({rect,active=false,children}){
  return <DocumentObject {...rect} active={active}>{children??<path d={`M 28 ${rect.height-40} H ${rect.width-55}`} stroke={active?C.mint:border} opacity={0.6} strokeWidth={3}/>}</DocumentObject>;
}
function WindowSurface({rect,emphasis}){
  return <div data-concise-window-outline="complete" style={{...frostedCardStyle({width:rect.width,minHeight:rect.height,emphasis}),
    position:'absolute',left:rect.x,top:rect.y,height:rect.height,padding:0}}/>;
}
export function ConciseArtwork({id,phase}){
  const state=conciseStoryboardState(id,phase);
  return <div data-concise-scene={id} style={{position:'absolute',inset:0}}>
    {state.window&&<WindowSurface rect={state.window} emphasis={phase===2}/>}
    <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{position:'absolute',inset:0,fontFamily:VIDEO_SANS_FONT_FAMILY}}>
      {state.window&&<path d={`M ${state.window.x+24} ${state.window.y+98} H ${state.window.x+state.window.width-24}`} stroke={border} opacity={0.38} strokeWidth={2}/>}
      {id==='context'&&<>
        {state.sources.map(source=><g key={source.id} data-concise-source={source.id}><Paper rect={source.rect} active={source.active}/></g>)}
        {phase===2&&[0,1,2].map(index=><path key={index} d={`M 1106 ${520+index*124} H 1734`} stroke={C.mint} opacity={0.25} strokeWidth={2}/>)}
      </>}
      {id==='memory'&&<>
        <g data-concise-source="retained-memory"><DatabaseObject {...state.source.rect} records={[]}/></g>
        <path d="M 186 665 H 554" stroke={border} opacity={0.35} strokeWidth={2}/>
        {state.copy&&<g data-concise-memory-copy={state.arrived?'arrived':'in-transit'}>
          <Paper rect={state.copy.rect} active><g/></Paper>
        </g>}
      </>}
      {id==='order'&&<>
        <g data-concise-source="historical-snapshot"><Paper rect={state.old}/></g>
        <Paper rect={state.receipt} active={state.queryReturned}><path d="M 28 105 H 450" stroke={border} opacity={0.45} strokeWidth={2}/></Paper>
        <DatabaseObject {...state.database} records={[]}/>
        {state.queryReturned&&<rect x={1346} y={548} width={388} height={137} rx={12} fill={C.mintSoft} stroke={C.mintDeep} strokeWidth={2}/>}
      </>}
      {state.connections.map((edge,index)=>edge.arrow?<OrthogonalConnector key={index} points={edge.points} active={!edge.muted}/>
        :<polyline key={index} points={edge.points.map(point=>point.join(',')).join(' ')} fill="none" stroke={C.mintDeep} strokeWidth={3} strokeLinejoin="round"/>)}
      {state.labelNodes.map(node=><ObjectLabel key={node.id} x={node.x} y={node.y} size={node.size} color={tones[node.tone]} anchor={node.anchor} weight={node.weight}>{node.text}</ObjectLabel>)}
    </svg>
  </div>;
}
