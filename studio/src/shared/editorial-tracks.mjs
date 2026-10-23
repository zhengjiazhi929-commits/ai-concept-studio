// Text-free process geometry. It never connects labelled categories, writes
// business state, accepts SVG, or infers an executed/successful business result.
const fail = code => {throw new Error(`motion-track-${code}`);};
const need = (value,code) => {if(!value)fail(code);};
const integer = (value,min,max) => Number.isSafeInteger(value) && value>=min && value<=max;
const text = value => typeof value==='string' && value.trim().length>0 && value.length<=2000
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
function closed(value,keys) {
  need(value && typeof value==='object' && !Array.isArray(value)
    && [null,Object.prototype].includes(Object.getPrototypeOf(value)),'data');
  need(Reflect.ownKeys(value).length===keys.length && keys.every(key=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    return descriptor?.enumerable && Object.hasOwn(descriptor,'value');
  }),'fields');
}
function list(value,min,max) {
  need(Array.isArray(value) && Object.getPrototypeOf(value)===Array.prototype
    && value.length>=min && value.length<=max && Reflect.ownKeys(value).length===value.length+1,'array');
  for(let index=0;index<value.length;index++){
    const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
    need(descriptor?.enumerable && Object.hasOwn(descriptor,'value'),'array');
  }
}

export function normalizeEditorialTracks(tracks,{narration,durationInFrames,safeRect}) {
  list(tracks,0,4);
  const ids=new Set();
  return tracks.map(track=>{
    closed(track,['id','states']);
    need(typeof track.id==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/u.test(track.id)
      && !ids.has(track.id),'identity');ids.add(track.id);
    list(track.states,1,128);
    let previousStart=-1,previousEnd=0,previousCue=0;
    const states=track.states.map(state=>{
      closed(state,['cue','atFrame','durationFrames','points','highlightStop']);
      need(text(state.cue) && integer(state.atFrame,0,108000) && integer(state.durationFrames,0,90)
        && state.atFrame>previousStart && state.atFrame>=previousEnd,'time');
      if(durationInFrames!==undefined) need(state.atFrame+state.durationFrames<durationInFrames,'outside-shot');
      if(narration!==undefined){
        const position=narration.indexOf(state.cue,previousCue);
        need(position>=0,'cue-order');previousCue=position;
      }
      list(state.points,0,12);
      need(state.points.length===0 || state.points.length>=2,'points');
      need(state.highlightStop===null || integer(state.highlightStop,0,state.points.length-1),'highlight');
      if(state.points.length===0) need(state.durationFrames===0 && state.highlightStop===null,'retire');
      const points=state.points.map((point,index)=>{
        closed(point,['x','y']);
        // The inset contains the line and highlighted stop, not only its centre.
        need(integer(point.x,safeRect.x+8,safeRect.x+safeRect.width-8)
          && integer(point.y,safeRect.y+8,safeRect.y+safeRect.height-8),'safe-area');
        if(index){const prior=state.points[index-1];
          need((point.x===prior.x)!==(point.y===prior.y),'orthogonal');}
        return {...point};
      });
      previousStart=state.atFrame;previousEnd=state.atFrame+state.durationFrames;
      return {...state,points};
    });
    need(states.some(state=>state.points.length>0),'empty');
    return {id:track.id,states};
  });
}

export function resolveEditorialTracks(tracks,frame) {
  return tracks.flatMap(track=>{
    const state=track.states.findLast(item=>item.atFrame<=frame);
    if(!state || state.points.length===0)return [];
    const progress=state.durationFrames===0?1:Math.min(1,Math.max(0,(frame-state.atFrame)/state.durationFrames));
    const lengths=state.points.map((point,index)=>index===0?0:
      Math.abs(point.x-state.points[index-1].x)+Math.abs(point.y-state.points[index-1].y));
    const length=lengths.reduce((sum,value)=>sum+value,0);
    const highlightDistance=state.highlightStop===null?Infinity:lengths.slice(0,state.highlightStop+1).reduce((sum,value)=>sum+value,0);
    const highlightPoint=highlightDistance<=progress*length?{...state.points[state.highlightStop]}:null;
    const path=state.points.map((point,index)=>index===0?`M ${point.x} ${point.y}`:
      point.x===state.points[index-1].x?`V ${point.y}`:`H ${point.x}`).join(' ');
    return [{id:track.id,path,points:state.points.map(point=>({...point})),progress,highlightPoint}];
  });
}
