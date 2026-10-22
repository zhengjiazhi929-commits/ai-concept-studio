import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import '../../src/video/load-video-fonts.jsx';
import {VIDEO_SANS_FONT_FAMILY} from '../../src/video/font-system.mjs';
import {SceneArt} from '../../src/video/explainer-full-revision/root.jsx';
import {FullTextFitGuard} from '../../src/video/explainer-full-revision/text-fit-guard.jsx';
import {fullCardBrowserFixtures as fixtures} from './full-card-browser-fixture-data.mjs';
import {installFullChapterProof} from './full-chapter-browser-fixture.jsx';

const node=document.getElementById('content'),root=createRoot(node),contentRef={current:node};
let proofFrame=100;
const settleGuard=async()=>{
  await document.fonts.ready;
  await new Promise(resolve=>setTimeout(resolve,0));
};
// Remotion's real cancelRender records the error and throws. The negative
// lifecycle cases intentionally exercise that path, without mocking the guard.
window.addEventListener('unhandledrejection',event=>{
  if(/^full-(?:card|chapter)-dom-/u.test(String(event.reason?.message)))event.preventDefault();
});
function clearGuard(){
  flushSync(()=>root.render(null));
  if(window.remotion_delayRenderHandles.length)throw new Error('Card guard leaked a render handle');
  window.remotion_cancelledError=undefined;
}
window.showCardCase=async(name)=>{
  const scene={id:'synthetic-card-proof',title:'合成排版验证',note:'合成数据 · 待视觉确认，不代表当前成片已修改',segments:[],...fixtures[name]};
  const current={revealCount:4,focusIndex:3,startFrame:0,endFrame:100};
  flushSync(()=>root.render(<div style={{position:'relative',width:1920,height:1080,fontFamily:VIDEO_SANS_FONT_FAMILY,color:'#14211D',background:'#F0F6F2'}}>
    <div style={{position:'absolute',left:120,top:100,fontSize:58,fontWeight:550}}>{name==='short'?'短文案：保持原有卡片':name==='long'?'长文案：拓宽后按顺序连接':'长文案：先拓宽标题区，再增加行高'}</div>
    <SceneArt scene={scene} current={current} frame={100}/>
    <FullTextFitGuard frame={proofFrame++} contentRef={contentRef}/>
  </div>));
  await settleGuard();
  if(window.remotion_cancelledError)throw new Error(window.remotion_cancelledError);
  return [...node.querySelectorAll('[data-full-card]')].map(card=>{
    const rect=card.getBoundingClientRect();
    return {text:card.textContent,x:rect.x,y:rect.y,width:rect.width,height:rect.height,
      titleFontSize:getComputedStyle(card.querySelector('[data-full-text]')).fontSize,
      bodyFontSize:getComputedStyle(card.querySelectorAll('[data-full-text]')[1]).fontSize};
  });
};
async function checkGuardLifecycle(kind){
  clearGuard();
  const source=kind==='source-arrival';
  const firstFrame=source?23:100,nextFrame=firstFrame+1;
  const scene={id:'synthetic-guard-lifecycle',note:'合成检查',
    ...(source?{layout:'sources',items:[{title:'读取资料',body:'合成来源'}]}:fixtures.short),
    segments:[{id:'source-start',startFrame:0,endFrame:200,focusIndex:0,revealCount:1}]};
  const current={id:'before',revealCount:source?1:4,focusIndex:0,startFrame:0,endFrame:200};
  const draw=(frame,id)=>flushSync(()=>root.render(<div style={{position:'relative',width:1920,height:1080,fontFamily:VIDEO_SANS_FONT_FAMILY}}>
    <SceneArt scene={scene} current={{...current,id}} frame={frame}/>
    <FullTextFitGuard frame={frame} contentRef={contentRef}/>
  </div>));
  draw(firstFrame,'before');
  await settleGuard();
  if(window.remotion_cancelledError||window.remotion_delayRenderHandles.length)throw new Error('Initial real guard did not validate the fitting frame');
  const beforeCount=source?node.querySelectorAll('[data-full-card]').item(1).querySelectorAll('[data-full-text]').length:0;
  draw(nextFrame,source?'before':'new-segment-same-reveal');
  const card=source?node.querySelectorAll('[data-full-card]').item(1):node.querySelector('[data-full-card]');
  const texts=card.querySelectorAll('[data-full-text]');
  if(source&&(beforeCount!==1||texts.length!==2))throw new Error('Source fixture must add its title exactly at frame 24');
  const overflowText=texts.item(source?1:0);
  if(getComputedStyle(overflowText).position==='static')overflowText.style.position='relative';
  overflowText.style.top='1000px';
  if(overflowText.getBoundingClientRect().top<=card.getBoundingClientRect().bottom)throw new Error('Lifecycle sentinel did not create real DOM overflow');
  await settleGuard();
  const rejected=String(window.remotion_cancelledError).includes('full-card-dom-text-overflow');
  clearGuard();
  return {frames:[firstFrame,nextFrame],overflowRejected:rejected,handlesAfterUnmount:window.remotion_delayRenderHandles.length};
}
window.auditCardProof=(async()=>{
  const results={};
  for(const name of Object.keys(fixtures))results[name]=await window.showCardCase(name);
  const guardLifecycle={sameRevealSegment:await checkGuardLifecycle('same-reveal-segment'),
    sourceArrival:await checkGuardLifecycle('source-arrival')};
  const missed=Object.entries(guardLifecycle).filter(([,result])=>!result.overflowRejected).map(([name])=>name);
  if(missed.length)throw new Error(`Real mounted guard missed ${missed.join(', ')} at unchanged reveal count`);
  const chapterNavigation=await installFullChapterProof({root,node,contentRef,settleGuard,clearGuard})();
  await window.showCardCase('short');
  return {scope:'generic-card-only',fontLoaded:document.fonts.check('40px "Noto Sans SC Variable"'),results,
    overflowSentinelRejected:true,guardLifecycle,chapterNavigation};
})();
