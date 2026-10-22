import {EDITORIAL_MOTION_VERSION} from '../src/shared/editorial-motion.mjs';

// All narration and objects are synthetic; no production episode is a fixture.
export function editorialMotionRendererFixture() {
  const narration='保留来源。复制偏好。送入窗口。到达以后才纳入。只改本轮。';
  const base={kind:'page',label:'长期偏好',detail:'简短中文',value:'简短中文',x:120,y:485,width:360,height:225,scopeId:'session-a',sourceId:null,initiallyVisible:false};
  const event=(id,cue,atFrame,op,objectId,patch={})=>({id,cue,atFrame,durationFrames:0,op,objectId,targetId:null,value:null,requires:[],...patch});
  const motionPlan={version:EDITORIAL_MOTION_VERSION,canvas:{width:1920,height:1080},objects:[
    {id:'source',...base,initiallyVisible:true,scopeMode:'shared',value:'简短中文'},
    {id:'input',kind:'window',label:'本轮上下文',detail:'只读取需要的内容',x:930,y:310,width:850,height:560,scopeId:'session-b',sourceId:null,initiallyVisible:true},
    {id:'copy',...base,sourceId:'source',scopeId:'session-b'},
  ],events:[
    event('copy-event','复制偏好',20,'copy','source',{targetId:'copy'}),
    event('transfer-event','送入窗口',40,'transfer','copy',{targetId:'input',durationFrames:20,value:{x:980,y:485},requires:['copy-event']}),
    event('arrive-event','到达以后才纳入',60,'arrive','copy',{targetId:'input',requires:['transfer-event']}),
    event('override-event','只改本轮',90,'temporary-override','copy',{value:'本次英文'}),
  ]};
  const scene={id:'synthetic-a',title:'记忆要先读取，才能进入上下文',narration,start:0,end:6,startFrame:0,endFrame:180,motionPlan};
  return {id:'synthetic-editorial-renderer',title:'Synthetic motion preview',scenes:[scene],subtitles:[
    {start:0,end:2,startFrame:0,endFrame:60,text:'先复制需要的内容'},
    {start:2,end:6,startFrame:60,endFrame:180,text:'到达窗口后才纳入上下文'},
  ]};
}
