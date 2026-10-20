import React from 'react';
import {AbsoluteFill,Composition,useCurrentFrame} from 'remotion';
import {VISUAL_SYSTEM_V1} from '../components/visual-system-v1/tokens.mjs';
import {VisualSystemV1AiWatermark} from '../components/visual-system-v1/ai-watermark.jsx';
import {VIDEO_SANS_FONT_FAMILY} from '../font-system.mjs';
import {StoryboardAssetsReady} from '../illustration-storyboards/assets-ready.jsx';
import {assertConciseEditorialPlan} from './plan.mjs';
import {ConciseArtwork} from './artwork.jsx';

assertConciseEditorialPlan();
export function ConciseScene({id}){
  const phase=useCurrentFrame();
  return <AbsoluteFill style={{backgroundColor:VISUAL_SYSTEM_V1.palette.paper,color:VISUAL_SYSTEM_V1.palette.ink,
    fontFamily:VIDEO_SANS_FONT_FAMILY,backgroundImage:'radial-gradient(ellipse at 85% 8%, rgba(67,184,145,0.06), transparent 48%)'}}>
    <ConciseArtwork id={id} phase={phase}/>
    <VisualSystemV1AiWatermark profile="approved-v013-stable-footprint" motionCadence="continuous"/>
    <StoryboardAssetsReady key={`${id}-${phase}`} phase={phase}/>
  </AbsoluteFill>;
}
export function ConciseStoryboardsRoot(){
  return <>
    <Composition id="ConciseContextBoard" component={ConciseScene} width={1920} height={1080} fps={30} durationInFrames={3} defaultProps={{id:'context'}}/>
    <Composition id="ConciseMemoryBoard" component={ConciseScene} width={1920} height={1080} fps={30} durationInFrames={3} defaultProps={{id:'memory'}}/>
    <Composition id="ConciseOrderBoard" component={ConciseScene} width={1920} height={1080} fps={30} durationInFrames={3} defaultProps={{id:'order'}}/>
  </>;
}
