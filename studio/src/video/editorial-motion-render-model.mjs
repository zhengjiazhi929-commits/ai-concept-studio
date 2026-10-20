import {resolveEditorialMotionFrame,compileEditorialMotionPlan,EDITORIAL_MOTION_SAFE_RECT} from '../shared/editorial-motion.mjs';
import {visualSystemV1EstimateContentTextWidthPx} from './components/visual-system-v1/content-layout.mjs';
import {frostedCardStyle} from './glass-card-preview/material.mjs';

const stage={left:EDITORIAL_MOTION_SAFE_RECT.x,top:EDITORIAL_MOTION_SAFE_RECT.y,right:EDITORIAL_MOTION_SAFE_RECT.x+EDITORIAL_MOTION_SAFE_RECT.width,bottom:EDITORIAL_MOTION_SAFE_RECT.y+EDITORIAL_MOTION_SAFE_RECT.height};
const compiledEpisodes=new WeakMap();
const containers=new Set(['window','store']);
const fail=code=>{throw new Error(`editorial-renderer-${code}`);};

// This deterministic width estimate rejects overflow before drawing. It is a
// structural preflight, not a claim that browser pixels/fonts were inspected.
function textBlock(text,{width,fontSize,fontWeight,maxHeight,lineHeight=1.3}) {
  if(typeof text!=='string' || !Number.isFinite(width) || width<=0 || !Number.isFinite(maxHeight) || maxHeight<0) fail('text-contract');
  if(!text) return {text,lines:[],width,height:0,fontSize,fontWeight,lineHeight};
  const fits=value=>visualSystemV1EstimateContentTextWidthPx(value,{fontSizePx:fontSize})<=width-8;
  const lines=[];let line='';
  const tokens=text.match(/\n|[A-Za-z0-9][A-Za-z0-9/_.:+-]*|[^\S\n]+|./gu)??[];
  for(const token of tokens) {
    if(token==='\n') {lines.push(line);line='';continue;}
    if(!fits(token)) fail('text-width');
    if(line && !fits(line+token)) {lines.push(line.trimEnd());line=token.trimStart();}
    else line+=token;
  }
  lines.push(line.trimEnd());
  const height=lines.length*fontSize*lineHeight;
  if(height>maxHeight) fail('text-overflow');
  return {text,lines,width,height,fontSize,fontWeight,lineHeight};
}

function stateLabel(information,containerKind,sourceId,transformation) {
  if(information.status==='invalidated') return '已停用，不再召回';
  if(information.status==='stored') return '已保存';
  if(information.checkStatus==='rejected') return '核对未通过';
  if(information.checkStatus==='passed' && transformation==='summary') return '核对通过';
  if(information.status==='included' && containerKind==='store') {
    if(information.checkStatus==='passed') return '核对通过，待保存';
    return sourceId===null?'存储记录':'已放入记录区';
  }
  if(information.checkStatus==='passed') return information.status==='included'?'已纳入 · 核对通过':'核对通过';
  return {copied:'已复制',summarized:'关键字段已保留','in-transit':'传送中，尚未纳入',arrived:'已到达，等待纳入',included:'已纳入本轮'}[information.status]??'';
}

function objectModel(object,focusId,allObjects) {
  const x=object.presentation.x;const y=object.presentation.y;
  const {width,height,kind}=object;
  // Validate through the same material function used by the actual drawing,
  // including its minimum dimensions; a legal semantic box alone is not enough.
  const cardStyle=kind==='card'?frostedCardStyle({width,minHeight:height,emphasis:focusId===object.id}):null;
  if(![x,y,width,height].every(Number.isFinite) || x<stage.left || y<stage.top || x+width>stage.right || y+height>stage.bottom) fail('object-safe-area');
  if(object.presentation.opacity!==1) fail('visible-object-opacity');
  const padding=kind==='card'?46:22;
  // A page fold and a store's top ellipse are geometry, not text decorations.
  const insetTop=kind==='store'?72:padding;
  const textWidth=width-padding*2-(kind==='page'?24:0);
  const title=textBlock(object.label,{width:textWidth,fontSize:kind==='card'?48:44,fontWeight:550,maxHeight:height-insetTop-padding});
  const value=object.information.value;
  if(value!==null && value!==undefined && typeof value!=='string') fail('object-value');
  const bodyText=value && value!==object.label?value:object.detail;
  const bodyTop=insetTop+title.height+(bodyText?14:0);
  const body=textBlock(bodyText,{width:textWidth,fontSize:kind==='card'?36:32,fontWeight:450,lineHeight:1.4,maxHeight:height-bodyTop-padding});
  // State text is a real layout row, never a badge floated over the content.
  const stateY=bodyText?bodyTop+body.height+12:insetTop+title.height+12;
  const containerKind=allObjects.find(item=>item.id===object.information.containerId)?.kind;
  const stateText=textBlock(stateLabel(object.information,containerKind,object.sourceId,object.transformation),{width:textWidth,fontSize:28,fontWeight:450,lineHeight:1.3,maxHeight:Math.max(0,height-stateY-padding)});
  return {id:object.id,kind,x,y,width,height,padding,cardStyle,stateText:{...stateText,x:padding,y:stateY},title:{...title,x:padding,y:insetTop},body:{...body,x:padding,y:bodyTop},
    headerBottom:Math.max(72,stateText.text?stateY+stateText.height:bodyText?bodyTop+body.height:insetTop+title.height),
    status:object.information.status,containerId:object.information.containerId,sourceId:object.sourceId,
    focus:focusId===object.id,recallActive:object.information.recallActive,checkStatus:object.information.checkStatus,
    inTransit:object.presentation.inTransit};
}

export function buildEditorialMotionConnectionModel(connection,objects) {
  const source=objects.find(object=>object.id===connection.fromId);const to=objects.find(object=>object.id===connection.toId);
  if(!source || !to) return null; // Retired endpoints have no visible relationship.
  const parent=objects.find(object=>object.id===source.containerId && containers.has(object.kind));
  const from=parent??source;
  if(from.id===to.id) return null; // Internal movement is already shown by the copy.
  const gap=12;let points;let direction;
  if(from.x+from.width+gap*2<to.x || to.x+to.width+gap*2<from.x) {
    const forward=from.x<to.x;
    const a={x:forward?from.x+from.width+gap:from.x-gap,y:from.y+from.height/2};
    const b={x:forward?to.x-gap:to.x+to.width+gap,y:to.y+to.height/2};
    const sharedTop=Math.max(from.y,to.y);const sharedBottom=Math.min(from.y+from.height,to.y+to.height);
    if(sharedBottom>sharedTop) {
      a.y=(sharedTop+sharedBottom)/2;b.y=a.y;points=[a,b];
    } else {
      const middle=(a.x+b.x)/2;points=[a,{x:middle,y:a.y},{x:middle,y:b.y},b];
    }
    direction=forward?'right':'left';
  } else if(from.y+from.height+gap*2<to.y || to.y+to.height+gap*2<from.y) {
    const forward=from.y<to.y;
    const a={x:from.x+from.width/2,y:forward?from.y+from.height+gap:from.y-gap};
    const b={x:to.x+to.width/2,y:forward?to.y-gap:to.y+to.height+gap};
    const sharedLeft=Math.max(from.x,to.x);const sharedRight=Math.min(from.x+from.width,to.x+to.width);
    if(sharedRight>sharedLeft) {
      a.x=(sharedLeft+sharedRight)/2;b.x=a.x;points=[a,b];
    } else {
      const middle=(a.y+b.y)/2;points=[a,{x:a.x,y:middle},{x:b.x,y:middle},b];
    }
    direction=forward?'down':'up';
  } else fail('connection-no-clear-corridor');
  points=points.filter((point,index,all)=>index===0 || point.x!==all[index-1].x || point.y!==all[index-1].y);
  const excluded=new Set([source.id,from.id,to.id,connection.objectId]);
  const obstacles=objects.filter(object=>!excluded.has(object.id) && !object.inTransit
    && object.containerId!==from.id && object.containerId!==to.id);
  // Include shaft/head clearance. We reject an occluded route instead of
  // silently drawing a broken relationship underneath another object's fill.
  for(let index=1;index<points.length;index++) {
    const a=points[index-1];const b=points[index];const clearance=10;
    if(obstacles.some(object=>Math.min(a.x,b.x)-clearance<object.x+object.width
      && Math.max(a.x,b.x)+clearance>object.x
      && Math.min(a.y,b.y)-clearance<object.y+object.height
      && Math.max(a.y,b.y)+clearance>object.y)) fail('connection-obstructed');
  }
  const path=points.map((point,index)=>index===0?`M ${point.x} ${point.y}`:point.x===points[index-1].x?`V ${point.y}`:`H ${point.x}`).join(' ');
  return {id:connection.id,fromId:source.id,fromBoundaryId:from.id,toId:to.id,path,direction,tip:points.at(-1),status:connection.status,progress:connection.progress};
}

function frameRange(value,fps) {
  const start=Object.hasOwn(value,'startFrame')?value.startFrame:Math.round(value.start*fps);
  const end=Object.hasOwn(value,'endFrame')?value.endFrame:Math.round(value.end*fps);
  if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 || end<=start) fail('timeline-range');
  return {start,end};
}

// A frozen per-episode snapshot is reusable across frame seeks. Raw mutable
// episode objects are never memoized: source edits must not reuse stale plans.
export function compileEditorialMotionRenderEpisode(episode,fps) {
  if(!episode || !Array.isArray(episode.scenes) || !episode.scenes.length || !Number.isFinite(fps) || fps<=0) fail('input');
  const snapshot=structuredClone(episode);
  for(const scene of snapshot.scenes) {
    const range=frameRange(scene,fps);
    scene.motionPlan=compileEditorialMotionPlan(scene.motionPlan,{narration:scene.narration,durationInFrames:range.end-range.start});
  }
  const freeze=value=>{if(value && typeof value==='object') {Object.values(value).forEach(freeze);Object.freeze(value);}};
  freeze(snapshot);compiledEpisodes.set(snapshot,fps);return snapshot;
}

export function buildEditorialMotionRenderModel(episode,frame,fps) {
  if(!episode || !Array.isArray(episode.scenes) || !episode.scenes.length || !Number.isSafeInteger(frame) || frame<0 || !Number.isFinite(fps) || fps<=0) fail('input');
  if(compiledEpisodes.has(episode) && compiledEpisodes.get(episode)!==fps) fail('compiled-fps');
  const snapshot=compiledEpisodes.has(episode)?episode:compileEditorialMotionRenderEpisode(episode,fps);
  const matches=snapshot.scenes.map(scene=>({scene,range:frameRange(scene,fps)})).filter(({range})=>frame>=range.start && frame<range.end);
  if(matches.length!==1) fail('active-scene');
  const {scene,range}=matches[0];const localFrame=frame-range.start;
  const plan=scene.motionPlan;
  if(plan?.canvas?.width!==1920 || plan?.canvas?.height!==1080) fail('canvas-reflow-required');
  const resolved=resolveEditorialMotionFrame(plan,localFrame);
  const objects=resolved.visibleObjects.map(object=>objectModel(object,resolved.focusId,resolved.objects));
  // Draw every parent background before every foreground object. Membership is
  // never inferred from screen position; it comes only from the state resolver.
  objects.sort((a,b)=>Number(!containers.has(a.kind))-Number(!containers.has(b.kind)));
  for(const child of objects.filter(object=>object.containerId)) {
    const parent=objects.find(object=>object.id===child.containerId);
    if(!parent || child.x<parent.x+24 || child.y<parent.y+parent.headerBottom+16 || child.x+child.width>parent.x+parent.width-24 || child.y+child.height>parent.y+parent.height-24) fail('container-text-overlap');
  }
  const connections=resolved.connections.map(connection=>buildEditorialMotionConnectionModel({...connection,
    objectId:plan.events.find(event=>event.id===connection.id)?.objectId},objects)).filter(Boolean);
  const title=textBlock(scene.title,{width:1520,fontSize:72,fontWeight:550,lineHeight:1.2,maxHeight:178});
  const captions=(snapshot.subtitles??[]).map(cue=>({cue,range:frameRange(cue,fps)})).filter(({range:cueRange})=>frame>=cueRange.start && frame<cueRange.end);
  if(captions.length>1) fail('caption-overlap');
  const current=captions[0];
  // Normalize the app's frame-based cues to Caption fields without inventing
  // transcription confidence or measured alignment for an estimated timeline.
  const caption=current?{...textBlock(current.cue.text,{width:1680,fontSize:44,fontWeight:450,lineHeight:1.35,maxHeight:66}),
    startMs:current.range.start/fps*1000,endMs:current.range.end/fps*1000,timestampMs:null,confidence:null}:null;
  return {sceneId:scene.id,frame,localFrame,canvas:{width:1920,height:1080},title,caption,objects,connections,
    assurance:'deterministic-semantic-geometry-only-not-pixel-acceptance'};
}
