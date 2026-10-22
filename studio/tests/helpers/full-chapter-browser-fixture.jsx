import React from 'react';
import {flushSync} from 'react-dom';
import {VIDEO_SANS_FONT_FAMILY} from '../../src/video/font-system.mjs';
import {FullChapterProgress} from '../../src/video/explainer-full-revision/chapter-progress.jsx';
import {FullTextFitGuard} from '../../src/video/explainer-full-revision/text-fit-guard.jsx';
import {assertFullChapterDomFit} from '../../src/video/explainer-full-revision/chapter-progress-guard.mjs';
import {fullChapterBrowserFixtures as fixtures} from './full-chapter-browser-fixture-data.mjs';

export function installFullChapterProof({root,node,contentRef,settleGuard,clearGuard}){
  const draw=(name,frame)=>flushSync(()=>root.render(<div style={{position:'relative',width:1920,height:1080,
    fontFamily:VIDEO_SANS_FONT_FAMILY,color:'#14211D',background:'#F0F6F2'}}>
    <div style={{position:'absolute',left:120,top:100,fontSize:58,fontWeight:550}}>章节目录与实际时长 · 合成边界验证</div>
    <div data-full-text-role="caption" style={{position:'absolute',left:120,top:928,width:1680,fontSize:38,fontWeight:500,lineHeight:1.4,textAlign:'center'}}>
      字幕保持原有位置，章节名称完整展示，目录与进度线分别说明当前内容和真实播放位置。
    </div>
    <FullChapterProgress chapters={fixtures[name].chapters} frame={frame}/>
    <FullTextFitGuard frame={frame} contentRef={contentRef} checkChapterProgress/>
  </div>));
  const inspect=()=>{
    const actual=assertFullChapterDomFit(node);
    return {...actual,currentId:node.querySelector('[aria-current="step"]').closest('[data-chapter-label-slot]').getAttribute('data-chapter-label-slot'),
      fontSizes:[...node.querySelectorAll('[data-chapter-label]')].map(n=>getComputedStyle(n).fontSize),
      fillAmounts:[...node.querySelectorAll('[data-chapter-fill]')].map(n=>parseFloat(n.style.width)/100)};
  };
  window.showChapterCase=async(name,frame=fixtures[name].frames[0])=>{
    clearGuard();draw(name,frame);await settleGuard();
    if(window.remotion_cancelledError||window.remotion_delayRenderHandles.length)throw new Error(`Chapter guard rejected ${name}/${frame}: ${window.remotion_cancelledError}`);
    return {frame,...inspect()};
  };
  return async()=>{
    const results={};
    for(const [name,fixture] of Object.entries(fixtures)){
      results[name]=[];
      for(const frame of fixture.frames)results[name].push(await window.showChapterCase(name,frame));
    }
    // The same production guard must work in a scaled Studio preview.
    node.style.transform='scale(0.5)';
    const scaled=await window.showChapterCase('chinese40');
    node.style.transform='';
    const sentinels={
      overflow:()=>{node.querySelector('[data-chapter-label]').style.whiteSpace='nowrap';node.querySelector('[data-chapter-label]').textContent='W'.repeat(80);},
      collision:()=>{node.querySelectorAll('[data-chapter-label-slot]')[1].style.left='108px';},
      outsideCanvas:()=>{node.querySelectorAll('[data-chapter-label-slot]')[3].style.left='1900px';},
      caption:()=>{node.querySelector('[data-full-text-role="caption"]').style.top='1000px';},
      track:()=>{node.querySelector('[data-chapter-progress]').style.top='1048px';},
      boundary:()=>{node.querySelector('[data-chapter-boundary]').style.left='0px';},
      hidden:()=>{node.querySelector('[data-chapter-label]').style.overflow='hidden';},
      missing:()=>{node.querySelector('[data-full-chapter-nav]').remove();}
    },rejected={};
    for(const [name,mutate] of Object.entries(sentinels)){
      clearGuard();draw('typical',100);mutate();await settleGuard();
      const error=String(window.remotion_cancelledError);
      if(!error.includes('full-chapter-dom-'))throw new Error(`Real mounted chapter guard missed ${name}`);
      clearGuard();rejected[name]={error,handlesAfterUnmount:window.remotion_delayRenderHandles.length};
    }
    return {fontLoaded:document.fonts.check('20px "Noto Sans SC Variable"'),results,scaled,sentinels:rejected};
  };
}
