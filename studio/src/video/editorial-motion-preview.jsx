import React from 'react';
import {AbsoluteFill,useCurrentFrame,useVideoConfig} from 'remotion';
import {buildEditorialMotionRenderModel,compileEditorialMotionRenderEpisode} from './editorial-motion-render-model.mjs';
export {buildEditorialMotionRenderModel,compileEditorialMotionRenderEpisode} from './editorial-motion-render-model.mjs';
import {GLASS_CARD_MATERIAL} from './glass-card-preview/material.mjs';
import {VIDEO_SANS_FONT_FAMILY} from './font-system.mjs';
import {VISUAL_SYSTEM_V1} from './components/visual-system-v1/tokens.mjs';
import {VisualSystemV1AiWatermark} from './components/visual-system-v1/ai-watermark.jsx';
import {EditorialIllustrationShape} from './editorial-illustration-shapes.jsx';

const palette={ink:'#14211D',secondary:'#53685E',accent:'#17795D',border:'#5A8A77',pale:'#E4F4EC',paper:VISUAL_SYSTEM_V1.palette.paper};
function TextBlock({block,color=palette.ink}) {
  return <div style={{position:'absolute',left:block.x??0,top:block.y??0,width:block.width,fontFamily:VIDEO_SANS_FONT_FAMILY,
    fontSize:block.fontSize,fontWeight:block.fontWeight,lineHeight:block.lineHeight,color,whiteSpace:'pre',margin:0}}>{block.lines.join('\n')}</div>;
}

function ObjectShape({object}) {
  const {width:w,height:h,kind,focus}=object;
  const stroke=focus?palette.accent:palette.border;
  if(kind==='illustration') return <EditorialIllustrationShape object={object} stroke={stroke} fill={palette.pale}/>;
  if(kind==='label' || kind==='card') return null;
  return <svg data-editorial-shape={kind} aria-hidden="true" width={w} height={h} viewBox={`0 0 ${w} ${h}`}
    style={{position:'absolute',inset:0,overflow:'visible'}}>
    {kind==='page' && <>
      <path data-object-outline="page" d={`M 18 2 H ${w-36} L ${w-2} 36 V ${h-18} Q ${w-2} ${h-2} ${w-18} ${h-2} H 18 Q 2 ${h-2} 2 ${h-18} V 18 Q 2 2 18 2 Z`}
        fill="#FCFEFD" stroke={stroke} strokeWidth={3}/>
      <path d={`M ${w-36} 3 V 36 H ${w-3}`} fill={palette.pale} stroke={stroke} strokeWidth={3} strokeLinejoin="round"/>
    </>}
    {['window','tray','region'].includes(kind) && <>
      <rect data-object-outline="window" x={2} y={2} width={w-4} height={h-4} rx={28} fill="#ECF7F1" stroke={stroke} strokeWidth={3}/>
      <path d={`M 3 ${object.headerBottom+10} H ${w-3}`} stroke={stroke} strokeWidth={2} fill="none"/>
    </>}
    {kind==='store' && <>
      <path data-object-outline="store" d={`M 2 31 V ${h-33} C 2 ${h+10} ${w-2} ${h+10} ${w-2} ${h-33} V 31 Z`}
        fill={palette.pale} stroke={stroke} strokeWidth={3}/>
      <ellipse cx={w/2} cy={31} rx={(w-4)/2} ry={28} fill="#F6FCF8" stroke={stroke} strokeWidth={3}/>
    </>}
  </svg>;
}

function MotionObject({object}) {
  const card=object.kind==='card';
  return <section data-editorial-object-id={object.id} data-motion-state={object.status} data-motion-source-id={object.sourceId??''}
    data-motion-container-id={object.containerId??''} data-motion-in-transit={String(object.inTransit)} data-motion-recall-active={String(object.recallActive)}
    data-motion-check={object.checkStatus??''} data-glass-card={card?GLASS_CARD_MATERIAL.id:undefined}
    aria-label={object.title.text} style={{...(object.cardStyle??{}),
      position:'absolute',left:object.x,top:object.y,width:object.width,height:object.height,boxSizing:'border-box',opacity:1,margin:0}}>
    <ObjectShape object={object}/>
    <TextBlock block={object.title}/>
    {object.body.text && <TextBlock block={object.body} color={palette.secondary}/>}
    {object.stateText.text && <TextBlock block={object.stateText} color={palette.accent}/>}
  </section>;
}

function Arrowhead({connection}) {
  const {x,y}=connection.tip;const n=8;const length=14;
  const points=connection.direction==='right'?`${x},${y} ${x-length},${y-n} ${x-length},${y+n}`:
    connection.direction==='left'?`${x},${y} ${x+length},${y-n} ${x+length},${y+n}`:
      connection.direction==='down'?`${x},${y} ${x-n},${y-length} ${x+n},${y-length}`:`${x},${y} ${x-n},${y+length} ${x+n},${y+length}`;
  return <polygon data-editorial-arrowhead={connection.direction} points={points} fill={palette.accent}/>;
}

export function EditorialMotionArtwork({model}) {
  const background=object=>['region','window','store','tray'].includes(object.kind);
  return <div data-editorial-motion-artwork={model.sceneId} data-local-frame={model.localFrame} style={{position:'absolute',inset:0}}>
    {model.objects.filter(background).map(object=><MotionObject key={object.id} object={object}/>)}
    <svg width={1920} height={1080} viewBox="0 0 1920 1080" aria-hidden="true" style={{position:'absolute',inset:0,overflow:'visible'}}>
      {(model.tracks??[]).map(track=><g key={`track:${track.id}`} data-editorial-track={track.id}>
        <path d={track.path} fill="none" stroke={palette.border} strokeWidth={3} strokeLinejoin="round"
          pathLength={1} strokeDasharray={1} strokeDashoffset={1-track.progress}/>
        {track.highlightPoint && <circle data-editorial-track-highlight={track.id}
          cx={track.highlightPoint.x} cy={track.highlightPoint.y} r={6} fill={palette.accent} stroke="none"/>}
      </g>)}
      {model.connections.map(connection=><g key={connection.id} data-editorial-connection={connection.id}>
        <path d={connection.path} fill="none" stroke={palette.accent} strokeWidth={3} strokeLinejoin="round"
          pathLength={1} strokeDasharray={1} strokeDashoffset={connection.status==='explanatory'?1-connection.progress:0}/>
        {(connection.status!=='explanatory' || connection.progress>=1) && <Arrowhead connection={connection}/>}
      </g>)}
    </svg>
    {model.objects.filter(object=>!background(object)).map(object=><MotionObject key={object.id} object={object}/>)}
    {model.objects.filter(object=>object.kind==='tray').map(object=><svg key={`front:${object.id}`} data-editorial-tray-front={object.id}
      width={object.width} height={64} viewBox={`0 0 ${object.width} 64`}
      style={{position:'absolute',left:object.x,top:object.y+object.height-64}}>
      <path d={`M 2 2 H ${object.width*.3} V 18 H ${object.width*.7} V 2 H ${object.width-2} V 38 Q ${object.width-2} 62 ${object.width-26} 62 H 26 Q 2 62 2 38 Z`}
        fill={palette.pale} stroke={palette.border} strokeWidth={3}/>
    </svg>)}
  </div>;
}

export function EditorialChapterNavigation({chapters}) {
  if(!chapters) return null;
  return <nav aria-label="章节进度" data-editorial-chapters={chapters.version} data-timing-assurance="editorial-estimate"
    style={{position:'absolute',left:96,top:1020,width:1728,height:43}}>
    {/* Label slots are a readable directory, not a duration scale. Even six
        slots leave over 274px for the contract's eight 24px characters. */}
    <div data-editorial-chapter-labels="true"
      style={{display:'grid',gridTemplateColumns:`repeat(${chapters.chapters.length}, minmax(0, 1fr))`,gap:16,height:30}}>
      {chapters.chapters.map(chapter=><div key={chapter.id} data-chapter-id={chapter.id}
        style={{minWidth:0,height:30,fontSize:24,fontWeight:450,lineHeight:'30px',whiteSpace:'nowrap',
          color:palette.secondary,visibility:chapter.visible?'visible':'hidden'}}>{chapter.label}</div>)}
    </div>
    <div data-editorial-chapter-tracks="true" aria-hidden="true"
      style={{position:'absolute',left:0,top:38,width:1728,height:5,display:'flex',gap:16}}>
      {chapters.chapters.map(chapter=><div key={chapter.id} data-chapter-track-id={chapter.id}
        style={{flex:chapter.widthFraction,minWidth:0,height:5,background:'#C9DDD2',borderRadius:3,
          visibility:chapter.visible?'visible':'hidden'}}>
        <div style={{height:5,width:`${chapter.progress*100}%`,background:palette.accent,borderRadius:3}}/>
      </div>)}
    </div>
  </nav>;
}

export function EditorialMotionPreview({episode}) {
  const frame=useCurrentFrame();const {fps,width,height}=useVideoConfig();
  if(width!==1920 || height!==1080) throw new Error('editorial-renderer-canvas-reflow-required');
  const compiled=React.useMemo(()=>compileEditorialMotionRenderEpisode(episode,fps),[episode,fps]);
  const model=buildEditorialMotionRenderModel(compiled,frame,fps);
  return <AbsoluteFill data-editorial-motion-preview={model.sceneId} data-preview-assurance={model.assurance}
    style={{backgroundColor:palette.paper,color:palette.ink,fontFamily:VIDEO_SANS_FONT_FAMILY,
      backgroundImage:'radial-gradient(ellipse at 85% 8%, rgba(67,184,145,0.06), transparent 48%)'}}>
    <div data-editorial-title="true" style={{position:'absolute',left:108,top:76}}><TextBlock block={model.title}/></div>
    <EditorialMotionArtwork model={model}/>
    <EditorialChapterNavigation chapters={model.chapters}/>
    {model.caption && <div data-editorial-subtitle="plain-text" style={{position:'absolute',left:120,top:934,width:1680,textAlign:'center'}}>
      <TextBlock block={model.caption}/>
    </div>}
    {/* Kept outside scene-local time so every clip/body frame uses the same cycle. */}
    <VisualSystemV1AiWatermark profile="approved-v013-stable-footprint" motionCadence="continuous"/>
  </AbsoluteFill>;
}
