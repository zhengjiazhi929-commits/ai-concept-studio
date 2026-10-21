import React from 'react';
import {VIDEO_SANS_FONT_FAMILY} from '../font-system.mjs';
import {FULL_CHAPTER_NAVIGATION as P,fullChapterNavigation} from './chapter-progress.mjs';

export function FullChapterProgress({chapters,frame}){
  const {labels,tracks,currentId}=fullChapterNavigation(chapters,frame);
  return <div data-full-chapter-nav={P.version} aria-label="章节目录说明当前内容；下方连续时间线按真实时长展示总进度"
    style={{fontFamily:VIDEO_SANS_FONT_FAMILY}}>
    {labels.map(c=><div key={c.id} data-chapter-label-slot={c.id}
      style={{position:'absolute',left:c.x,top:c.y,width:c.w,height:c.h,display:'flex',alignItems:'flex-end'}}>
      <div data-chapter-label aria-current={c.current?'step':undefined}
        style={{width:'100%',fontSize:P.fontSize,lineHeight:`${P.lineHeight}px`,fontWeight:500,
          whiteSpace:'normal',overflowWrap:'anywhere',color:c.current?'#17795D':'#53685E'}}>{c.label}</div>
    </div>)}
    <div data-chapter-timeline aria-hidden style={{position:'absolute',left:P.left,top:P.trackTop,
      width:P.right-P.left,height:P.trackHeight,background:'#CDDFD5',borderRadius:4}}/>
    {tracks.map((c,i)=><div key={c.id} data-chapter-progress={c.id} data-current-chapter={c.id===currentId} aria-hidden
      style={{position:'absolute',left:c.x,top:P.trackTop,width:c.w,height:P.trackHeight}}>
      <div data-chapter-track style={{height:P.trackHeight}}>
        <div data-chapter-fill style={{height:P.trackHeight,width:`${c.amount*100}%`,background:'#17795D',
          borderRadius:i===0?'4px 0 0 4px':i===3&&c.amount===1?'0 4px 4px 0':0}}/>
      </div>
    </div>)}
    {tracks.slice(1).map(c=><div key={c.id} data-chapter-boundary={c.id} aria-hidden
      style={{position:'absolute',left:c.x-0.5,top:P.trackTop,width:1,height:P.boundaryHeight,background:'#759D8A'}}/>)}
  </div>;
}
