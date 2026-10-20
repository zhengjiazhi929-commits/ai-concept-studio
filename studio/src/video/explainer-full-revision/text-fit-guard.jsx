import React,{useLayoutEffect,useState} from 'react';
import {delayRender,continueRender,cancelRender} from 'remotion';
import {assertFullCardDomFit} from './text-fit-guard.mjs';

// The frame is a validation boundary even when the narration segment or the
// reveal count stays unchanged (source delivery changes DOM after 24 frames).
export function FullTextFitGuard({contentRef,frame}){
  return <FrameTextFitGuard key={frame} contentRef={contentRef}/>;
}
function FrameTextFitGuard({contentRef}){
  const [handle]=useState(()=>delayRender('Validate generic-card text after local fonts load'));
  useLayoutEffect(()=>{
    let live=true;
    Promise.resolve(document.fonts.ready).then(()=>{
      if(!live)return;
      assertFullCardDomFit(contentRef.current);
      continueRender(handle);
    }).catch(error=>{if(live)cancelRender(error);});
    return ()=>{live=false;continueRender(handle);};
  },[contentRef,handle]);
  return null;
}
