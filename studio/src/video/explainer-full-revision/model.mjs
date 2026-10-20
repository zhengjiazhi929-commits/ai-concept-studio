import {activePhrase,chapterProgress} from '../explainer-revision/model.mjs';
import {frostedCardStyle} from '../glass-card-preview/material.mjs';
import {visualSystemV1EstimateContentTextWidthPx} from '../components/visual-system-v1/content-layout.mjs';

// Existing approved typography, shared by preflight and the drawing. This is
// not a new global style: fitting scenes retain their exact prior geometry.
export const FULL_CARD_TEXT_PROFILE=Object.freeze({version:'full-card-text-v1',
  horizontalInset:28,verticalInset:26,bodyGap:24,titleLineHeight:1.35,bodyLineHeight:1.45});
const ROW_LAYOUTS=new Set(['input','record','answer','tests']);
export const FULL_SEMANTIC_SCENE_IDS=Object.freeze(['F01','F03','F18','F26','F28','F29','F30','F32','F33','F41']);
function textHeight(text,width,size,lineHeight){
  if(!text)return 0;
  const fits=value=>visualSystemV1EstimateContentTextWidthPx(value,{fontSizePx:size})<=width-8;
  const tokens=text.match(/\n|[A-Za-z0-9][A-Za-z0-9/_.:+-]*|[^\S\n]+|./gu)??[];
  let lines=1,line='';
  for(const token of tokens){
    if(token==='\n'){lines++;line='';continue;}
    for(const part of fits(token)?[token]:[...token]){
      if(!fits(part))throw new Error('full-card-text-width-unfit: split the scene');
      if(line&&!fits(line+part)){lines++;line=part.trimStart();}else line+=part;
    }
  }
  return lines*size*lineHeight;
}
export function fullCardTextGeometry(scene,box,item,{expandedColumns=false}={}){
  const source=scene.layout==='sources',row=ROW_LAYOUTS.has(scene.layout);
  const titleSize=source?31:row?32:box.w<440?36:40;
  const bodySize=source?25:row?30:box.w<440?28:32;
  let title,body;
  if(source||row){
    title={x:26,y:source?8:18,w:source?598:expandedColumns?620:380,size:titleSize,lineHeight:source?1.2:1.4};
    body={x:source?26:expandedColumns?678:438,y:source?55:19,w:source?598:expandedColumns?912:1150,size:bodySize,lineHeight:1.4};
  }else{
    const p=FULL_CARD_TEXT_PROFILE;
    const markerHeight=['outline','topic'].includes(scene.layout)?24*1.4+18:0;
    title={x:p.horizontalInset,y:p.verticalInset+markerHeight,w:box.w-p.horizontalInset*2,size:titleSize,lineHeight:p.titleLineHeight};
    body={x:p.horizontalInset,y:0,w:title.w,size:bodySize,lineHeight:p.bodyLineHeight};
  }
  title.h=textHeight(item.title,title.w,title.size,title.lineHeight);
  if(source)body.y=Math.max(body.y,title.y+title.h+8);
  if(!source&&!row)body.y=title.y+title.h+FULL_CARD_TEXT_PROFILE.bodyGap;
  body.h=textHeight(item.body,body.w,body.size,body.lineHeight);
  const requiredHeight=Math.ceil(Math.max(title.y+title.h,body.y+body.h)+(source?10:row?12:26));
  return {title,body,requiredHeight,expandedColumns,compact:source||row};
}

// Compact information rows share the accepted optical material, with their own
// explicit geometry contract; the original large-card minimum is unchanged.
export function fullSurfaceStyle(box,active=false){
  if(!box||!Number.isFinite(box.h)||box.h<64||box.h>585)throw new Error('Invalid full-film surface');
  return {...frostedCardStyle({width:box.w,minHeight:Math.max(180,box.h),emphasis:active}),minHeight:box.h,height:box.h};
}

export function fullSceneState(timing,frame){
  const scene=timing.scenes.find(s=>frame>=s.startFrame&&frame<s.endFrame)??timing.scenes.at(-1);
  if(!scene)throw new Error('Complete scene timeline required');
  const {current,caption}=activePhrase(timing.segments.filter(s=>s.sceneId===scene.id),frame);
  return {scene,current,caption};
}
export function sourceReadState(scene,current,frame){
  const reads=scene.segments.filter(s=>s.startFrame<=frame&&s.focusIndex>=0);
  const deliveredCount=reads.filter(s=>frame-s.startFrame>=24).reduce((n,s)=>Math.max(n,s.revealCount),0);
  const active=reads.at(-1);
  return {deliveredCount,pendingCount:active&&frame-active.startFrame<24?active.revealCount:deliveredCount,
    progress:active?Math.max(0,Math.min(1,(frame-active.startFrame)/24)):0};
}
export function pointOnOrthogonalPath(points,progress){
  if(points.length<2||points.some((p,i)=>i&&p[0]!==points[i-1][0]&&p[1]!==points[i-1][1]))throw new Error('Orthogonal path required');
  const lengths=points.slice(1).map((p,i)=>Math.abs(p[0]-points[i][0])+Math.abs(p[1]-points[i][1]));
  let remaining=Math.max(0,Math.min(1,progress))*lengths.reduce((a,b)=>a+b,0);
  for(let i=0;i<lengths.length;i++){
    if(remaining<=lengths[i]){const ratio=lengths[i]?remaining/lengths[i]:0;return points[i].map((p,k)=>p+(points[i+1][k]-p)*ratio);}
    remaining-=lengths[i];
  }
  return points.at(-1);
}
export function progressGeometry(chapters,frame){
  let x=108;const usable=1704-(chapters.length-1)*22;
  return chapterProgress(chapters,frame).map(c=>{const w=c.widthFraction*usable;const result={...c,x,w};x+=w+22;return result;});
}
function baseLayoutScene(scene){
  const n=scene.items.length;const connections=[];let boxes;
  if(['input','record','answer','tests'].includes(scene.layout)){
    const gap=18,h=Math.min(112,(500-gap*(n-1))/n);
    boxes=scene.items.map((_,i)=>({x:152,y:336+i*(h+gap),w:1616,h}));
  }else if(scene.layout==='sources'){
    const h=100,gap=10;
    boxes=scene.items.map((_,i)=>({x:132,y:300+i*(h+gap),w:650,h}));
    for(let i=0;i<n;i++)connections.push({toIndex:i,points:[[794,boxes[i].y+h/2],[916,boxes[i].y+h/2],[916,545],[1094,545]]});
  }else if(['flow','lifecycle'].includes(scene.layout)){
    const w=(1656-78*(n-1))/n;
    boxes=scene.items.map((_,i)=>({x:132+i*(w+78),y:408,w,h:292}));
    for(let i=1;i<n;i++)connections.push({toIndex:i,points:[[boxes[i-1].x+w+9,554],[boxes[i].x-9,554]]});
  }else if(scene.layout==='outline'||scene.layout==='topic'){
    const w=(1680-28*(n-1))/n;
    boxes=scene.items.map((_,i)=>({x:120+i*(w+28),y:scene.layout==='topic'?586:370,w,h:scene.layout==='topic'?225:345}));
  }else if(n<=3){
    const w=(1656-36*(n-1))/n;
    boxes=scene.items.map((_,i)=>({x:132+i*(w+36),y:380,w,h:352}));
  }else{
    boxes=scene.items.map((_,i)=>({x:132+(i%2)*846,y:310+Math.floor(i/2)*256,w:810,h:228}));
  }
  return {boxes,connections};
}

export function layoutScene(scene){
  let {boxes,connections}=baseLayoutScene(scene);
  let expandedColumns=false;
  let text=boxes.map((box,i)=>fullCardTextGeometry(scene,box,scene.items[i]));
  if(text.some((value,i)=>value.requiredHeight>boxes[i].h)){
    if(ROW_LAYOUTS.has(scene.layout)){
      // Give a long title a wider column before changing type or losing words.
      expandedColumns=true;
      text=boxes.map((box,i)=>fullCardTextGeometry(scene,box,scene.items[i],{expandedColumns}));
      const h=Math.max(boxes[0].h,...text.map(value=>value.requiredHeight));
      boxes=boxes.map((box,i)=>({...box,y:336+i*(h+18),h}));
    }else if(scene.layout==='sources'){
      // Sources are a single vertical list, not the comparison grid. Keep the
      // input window fixed and reconnect every resized source to its anchor.
      const h=Math.max(boxes[0].h,...text.map(value=>value.requiredHeight));
      boxes=boxes.map((box,i)=>({...box,y:300+i*(h+10),h}));
      connections=boxes.map((box,i)=>({toIndex:i,points:[
        [box.x+box.w+12,box.y+box.h/2],[916,box.y+box.h/2],[916,545],[1094,545]
      ]}));
    }else{
      const h=Math.max(boxes[0].h,...text.map(value=>value.requiredHeight));
      const stacked=boxes.some(box=>box.y!==boxes[0].y);
      boxes=boxes.map((box,i)=>({...box,h,y:stacked?280+Math.floor(i/2)*(h+28):box.y}));
      if(boxes.some(box=>box.y+box.h>860)&&['flow','lifecycle'].includes(scene.layout)&&boxes.length===4){
        // Widen into two ordered rows. A snake route keeps all three causal
        // arrows visible without a diagonal or a line through another card.
        boxes=scene.items.map((_,i)=>({x:132+(i===1||i===2?867:0),y:i<2?280:590,w:789,h:270}));
        text=boxes.map((box,i)=>fullCardTextGeometry(scene,box,scene.items[i]));
      }
    }
    text=boxes.map((box,i)=>fullCardTextGeometry(scene,box,scene.items[i],{expandedColumns}));
    if(boxes.some((box,i)=>box.y+box.h>860||text[i].requiredHeight>box.h)){
      throw new Error('full-card-text-layout-unfit: split the scene; content is never clipped or shrunk');
    }
    if(['flow','lifecycle'].includes(scene.layout)){
      connections=boxes.slice(1).map((to,i)=>{
        const from=boxes[i];let points;
        if(from.y===to.y){const right=to.x>from.x;
          points=[[right?from.x+from.w+9:from.x-9,from.y+from.h/2],
            [right?to.x-9:to.x+to.w+9,to.y+to.h/2]];
        }else points=[[from.x+from.w/2,from.y+from.h+9],[to.x+to.w/2,to.y-9]];
        return {toIndex:i+1,points};
      });
    }
  }
  return {boxes,connections,text};
}

export function preflightFullRevisionText(plan){
  const layouts=plan.scenes.filter(scene=>!FULL_SEMANTIC_SCENE_IDS.includes(scene.id)).map(scene=>{
    const displayScene=scene.id==='F22'?{...scene,layout:'compare'}:scene;
    const layout=layoutScene(displayScene);
    return {sceneId:scene.id,boxes:layout.boxes,requiredHeights:layout.text.map(text=>text.requiredHeight)};
  });
  return {profile:FULL_CARD_TEXT_PROFILE.version,scope:'generic-card-only',layouts,
    excludedSemanticSceneIds:plan.scenes.filter(scene=>FULL_SEMANTIC_SCENE_IDS.includes(scene.id)).map(scene=>scene.id),
    assurance:'generic-card-only: structural-estimate; render also requires real-font DOM containment; legacy semantic drawings and scene-global text are not certified'};
}
