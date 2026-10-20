export const VISUALS = Object.freeze(['topic','outline','context','sources','memory','scope','types',
  'type-examples','two-dimensions','authorized-read','relationship','case','case-policy','request',
  'constraint','access','fresh-query','policy','model-input','compression','answer-fact','answer-limit',
  'answer-next','session-record','memory-record','write-compare','sync-write','async-receipt',
  'async-write','test-outline','test-freshness','test-access','test-unavailable','test-evidence']);

export const SAFE_AREAS = Object.freeze({
  heading:{left:108,top:64,right:1650,bottom:240},
  content:{left:108,top:280,right:1812,bottom:865},
  caption:{left:120,top:916,right:1800,bottom:982},
  progress:{left:108,top:1010,right:1812,bottom:1065},
  logo:{left:1700,top:25,right:1890,bottom:220}
});
export const clamp = value => Math.max(0,Math.min(1,value));
export function activePhrase(segments,frame) {
  if(!segments?.length || !Number.isFinite(frame))throw new Error('Narration timeline required');
  const current=segments.find(s=>frame>=s.startFrame&&frame<s.endFrame)
    ?? [...segments].reverse().find(s=>frame>=s.startFrame) ?? segments[0];
  return {current,caption:frame>=current.startFrame&&frame<current.endFrame?(current.text??''):''};
}
export function chapterProgress(chapters,frame) {
  if(!Array.isArray(chapters)||chapters.length===0||chapters.some(c=>
    !c||!Number.isSafeInteger(c.startFrame)||!Number.isSafeInteger(c.endFrame)||
    c.startFrame<0||c.endFrame<=c.startFrame))throw new Error('Positive chapter durations required');
  const totalFrames=chapters.reduce((sum,c)=>sum+c.endFrame-c.startFrame,0);
  if(!Number.isSafeInteger(totalFrames))throw new Error('Invalid total chapter duration');
  return chapters.map(c=>{
    const durationFrames=c.endFrame-c.startFrame;
    return {...c,durationFrames,widthFraction:durationFrames/totalFrames,
      amount:clamp((frame-c.startFrame)/durationFrames)};
  });
}
export function orthogonalPoints(points) {
  if(points.length<2||points.some(p=>p.length!==2||!p.every(Number.isFinite)) ||
    points.some((p,i)=>i&&p[0]!==points[i-1][0]&&p[1]!==points[i-1][1]))throw new Error('Only orthogonal connections');
  return points.map(p=>p.join(',')).join(' ');
}

function phraseProgress(value) {
  if(!Number.isFinite(value))throw new TypeError('Phrase progress must be finite');
  return clamp(value);
}
function phaseProgress(progress,from,to) {
  const amount=clamp((progress-from)/(to-from));
  return amount*amount*(3-2*amount);
}
export function queryMechanismState(lineProgress) {
  const p=phraseProgress(lineProgress);
  const newProgress=phaseProgress(p,0.52,0.70);
  const newIsCurrent=newProgress===1;
  return {newProgress,newIsCurrent,oldIsCurrent:!newIsCurrent,
    oldOpacity:1-0.5*phaseProgress(p,0.70,0.82)};
}
export function compressionMechanismState(lineProgress) {
  const p=phraseProgress(lineProgress);
  const removal=phaseProgress(p,0.08,0.36);
  const updatedFactFlow=phaseProgress(p,0.26,0.52);
  const constraintFlow=phaseProgress(p,0.38,0.66);
  return {chatterSelected:removal<1,chatterOpacity:1-0.68*removal,
    updatedFactFlow,constraintFlow,constraintSourceOpacity:1,
    updatedFactOutputVisible:updatedFactFlow===1,constraintOutputVisible:constraintFlow===1};
}
export function fallbackMechanismState(lineProgress) {
  const p=phraseProgress(lineProgress);
  const failureProgress=phaseProgress(p,0.06,0.26);
  const businessProgress=phaseProgress(p,0.30,0.66);
  return {failureProgress,businessProgress,memoryStatus:failureProgress===1?'unavailable':'requesting',
    memoryDelivered:false,scopeRelaxed:false,businessOutputReady:businessProgress===1};
}
export function writeTimelineState(visual,lineProgress) {
  const phase=['write-compare','sync-write','async-receipt','async-write'].indexOf(visual);
  if(phase<0)throw new TypeError('Unknown write visual');
  const p=phraseProgress(lineProgress);
  return {
    syncStep:phase>1?3:phase===1?(p<0.25?1:p<0.66?2:3):0,
    asyncStep:phase<2?0:phase===2?(p<0.2?0:1):(p<0.55?2:3)
  };
}
export function writeTimelineConnections(row) {
  if(row!==0&&row!==1)throw new RangeError('Unknown timeline row');
  const y=471+row*243;
  return [[[796,y],[844,y]],[[1292,y],[1340,y]]];
}
