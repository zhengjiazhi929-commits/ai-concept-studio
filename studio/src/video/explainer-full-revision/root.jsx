import React,{useRef} from 'react';
import {AbsoluteFill,Composition,useCurrentFrame,Audio,staticFile} from 'remotion';
import {VIDEO_SANS_FONT_FAMILY} from '../font-system.mjs';
import {VisualSystemV1AiWatermark} from '../components/visual-system-v1/ai-watermark.jsx';
import {clamp,orthogonalPoints} from '../explainer-revision/model.mjs';
import {fullSceneState,layoutScene,progressGeometry,fullSurfaceStyle,sourceReadState,pointOnOrthogonalPath} from './model.mjs';
import {SemanticScene} from './semantic-scenes.jsx';
import {FullTextFitGuard} from './text-fit-guard.jsx';

const C={ink:'#14211D',muted:'#53685E',accent:'#17795D',paper:'#F0F6F2',border:'#89AF9D'};
function Text({x,y,w,size=34,weight=450,color=C.ink,children,style={}}){
  return <div data-full-text style={{position:'absolute',left:x,top:y,width:w,fontSize:size,fontWeight:weight,lineHeight:1.4,color,whiteSpace:'pre-line',overflowWrap:'break-word',...style}}>{children}</div>;
}
function Surface({box,active=false,children,style={}}){
  return <div data-full-card style={{...fullSurfaceStyle(box,active),position:'absolute',left:box.x,top:box.y,width:box.w,height:box.h,padding:0,
    borderRadius:26,outline:`${active?2:1.5}px solid ${active?'#4D927A':C.border}`,outlineOffset:-1,...style}}>{children}</div>;
}
function Connection({points,amount=1}){
  const [x,y]=points.at(-1),[px,py]=points.at(-2),angle=x>px?0:x<px?180:y>py?90:-90;
  return <svg aria-hidden style={{position:'absolute',inset:0,width:1920,height:1080,pointerEvents:'none'}}>
    <polyline data-full-connection points={orthogonalPoints(points)} fill="none" stroke={C.accent} strokeWidth={3} strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1-amount}/>
    {amount===1&&<path d="M -12 -6 L 0 0 L -12 6 Z" transform={`translate(${x} ${y}) rotate(${angle})`} fill={C.accent}/>}</svg>;
}
function SourceWindow({scene,current,frame,connections}){
  // These are information objects and an input window, not decorative prefix icons.
  const read=sourceReadState(scene,current,frame);
  const selected=scene.items.slice(0,read.deliveredCount);
  return <>
    <Surface box={{x:1110,y:338,w:678,h:410}} active>
      <Text x={34} y={28} w={610} size={34} weight={550}>本轮模型输入</Text>
      <div style={{position:'absolute',left:0,right:0,top:90,borderTop:'1.5px solid #9AB7A8'}}/>
      {selected.map((item,i)=><Text key={i} x={34} y={112+i*48} w={610} size={28} color={i===current.focusIndex?C.accent:C.muted}>{item.title}</Text>)}
    </Surface>
    <Text x={826} y={292} w={245} size={25} color={C.accent} style={{textAlign:'center'}}>按需读取 · 保留来源</Text>
    {connections.filter(e=>e.toIndex>=read.deliveredCount&&e.toIndex<read.pendingCount).map(edge=>{
      const [x,y]=pointOnOrthogonalPath(edge.points,read.progress);
      return <div key={edge.toIndex} aria-hidden style={{position:'absolute',left:x-12,top:y-9,width:24,height:18,border:`2px solid ${C.accent}`,borderRadius:4,background:'#D4EBDD',opacity:0.9}}/>;
    })}
  </>;
}
export function SceneArt({scene,current,frame}){
  const semantic=SemanticScene({scene,current,frame});
  if(semantic!==null)return semantic;
  const displayScene=scene.id==='F22'?{...scene,layout:'compare'}:scene;
  const {boxes,connections,text}=layoutScene(displayScene),row=['input','record','answer','tests'].includes(displayScene.layout);
  const selected=scene.items.slice(0,current.revealCount);
  const source=displayScene.layout==='sources';
  const reads=source?sourceReadState(scene,current,frame):null;
  return <>
    {scene.layout==='topic'&&<>
      <Text x={120} y={300} w={1660} size={66} weight={550}>把「这一轮输入」和「可复用的历史」分清</Text>
      <Text x={124} y={416} w={1620} size={38} color={C.muted}>先讲概念，再走完一个 AI 客服案例。</Text>
    </>}
    {row&&<>
      <div aria-hidden style={{position:'absolute',left:120,top:282,width:1680,height:568,border:'1.5px solid #91B5A3',borderRadius:30,background:'rgba(239,248,242,.5)'}}/>
      <Text x={152} y={293} w={1520} size={24} color={C.accent}>{({input:'输入窗口 · 只纳入本轮所需信息',record:'状态记录 · 保留范围与来源',answer:'客服答复 · 事实 / 边界 / 下一步',tests:'验收设计 · 以下是待执行用例'})[scene.layout]}</Text>
    </>}
    {connections.filter(e=>e.toIndex<(source?reads.pendingCount:current.revealCount)).map((edge,i)=><Connection key={i} points={edge.points} amount={source?(edge.toIndex<reads.deliveredCount?1:reads.progress):edge.toIndex===current.focusIndex?clamp((frame-current.startFrame)/18):1}/>)}
    {selected.map((item,i)=>{
      const box=boxes[i],active=current.focusIndex===i;
      const compact=row||source,outline=scene.layout==='outline'||scene.layout==='topic';
      const typography=text[i],titleSize=typography.title.size,bodySize=typography.body.size;
      return <Surface key={`${scene.id}-${i}`} box={box} active={active}>
        {compact?<>
          <Text {...typography.title} weight={550} style={{lineHeight:typography.title.lineHeight}}>{item.title}</Text>
          <Text {...typography.body} color={C.muted} style={{lineHeight:typography.body.lineHeight}}>{item.body}</Text>
        </>:<div style={{position:'absolute',left:28,right:28,top:26}}>
          {outline&&<div data-full-text style={{fontSize:24,lineHeight:1.4,color:C.accent,marginBottom:18}}>0{i+1}</div>}
          <div data-full-text style={{fontSize:titleSize,fontWeight:550,lineHeight:1.35,overflowWrap:'break-word'}}>{item.title}</div>
          <div data-full-text style={{fontSize:bodySize,color:C.muted,lineHeight:1.45,whiteSpace:'pre-line',marginTop:24,overflowWrap:'break-word'}}>{item.body}</div>
        </div>}
      </Surface>;
    })}
    {source&&<SourceWindow {...{scene,current,frame,connections}}/>}
    <Text x={120} y={869} w={1680} size={25} color={C.muted}>{scene.note}</Text>
  </>;
}
export function ExplainerFullRevision({plan,timing,audioSrc}){
  const contentRef=useRef(null);
  const frame=useCurrentFrame(),{scene,current,caption}=fullSceneState(timing,frame);
  const progress=progressGeometry(timing.chapters,frame);
  return <AbsoluteFill ref={contentRef} data-full-scene={scene.id} data-full-focus={current.focusIndex} data-full-reveal={current.revealCount}
    style={{background:C.paper,color:C.ink,fontFamily:VIDEO_SANS_FONT_FAMILY,backgroundImage:'radial-gradient(ellipse at 85% 10%,rgba(67,184,145,.08),transparent 48%)'}}>
    <Text x={108} y={59} w={1510} size={25} color={C.accent} weight={500}>AI 直通车 · 上下文工程与 Agent 记忆</Text>
    <Text x={108} y={117} w={1540} size={60} weight={550} style={{letterSpacing:'-.025em',lineHeight:1.25}}>{scene.title}</Text>
    <SceneArt {...{scene,current,frame}}/>
    <Text x={120} y={928} w={1680} size={38} weight={500} style={{textAlign:'center'}}>{caption}</Text>
    <div aria-label="全片章节进度">
      {progress.map(c=><div key={c.id} data-chapter-progress={c.id} style={{position:'absolute',left:c.x,top:1010,width:c.w}}>
        <div data-chapter-label style={{fontSize:20,lineHeight:'29px',marginBottom:8,fontWeight:500,whiteSpace:'nowrap',color:c.id===current.chapterId?C.accent:C.muted}}>{c.label}</div>
        <div data-chapter-track style={{height:5,background:'#CDDFD5',borderRadius:4}}><div data-chapter-fill style={{height:5,width:`${c.amount*100}%`,background:C.accent,borderRadius:4}}/></div>
      </div>)}
    </div>
    <VisualSystemV1AiWatermark profile="approved-v013-stable-footprint" motionCadence="continuous"/>
    <FullTextFitGuard key={`${scene.id}:${frame}`} frame={frame} contentRef={contentRef}/>
    {audioSrc&&<Audio src={staticFile(audioSrc)}/>}
  </AbsoluteFill>;
}
export function ExplainerFullRevisionRoot(){
  return <Composition id="ExplainerFullRevision" component={ExplainerFullRevision} width={1920} height={1080} fps={30} durationInFrames={27000}
    calculateMetadata={({props})=>({durationInFrames:props.timing.durationInFrames})}/>;
}
