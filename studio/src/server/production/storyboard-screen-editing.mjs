import {assertScreenEditorialFrames,closedScreenRecord,requireScreenEditing,screenEditorialError}
  from '../../shared/screen-editorial-policy.mjs';
import {cueFrameAtNarrationPosition,EDITORIAL_TIMING_POLICY} from '../../shared/editorial-timing.mjs';
import {buildEditorialMotionRenderModel} from '../../video/editorial-motion-render-model.mjs';
import {productionSemanticRelationLabelRequired} from '../../video/production-semantic-preview.mjs';

const element=(id,objectId,role,text)=>({id,objectId,role,text});
const fail=(code,location)=>{throw screenEditorialError(code,location);};
function boundFrames(frames,entry,evidenceRefs,location){
  assertScreenEditorialFrames({frames,exceptions:entry.exceptions,evidenceRefs,location});
}

export function assertGeneratedStoryboardScreenEditing(draft,{required=false}={}){
  const ids=draft.scenes.map((scene,i)=>scene.id??`S${String(i+1).padStart(2,'0')}`);
  const policy=requireScreenEditing(draft.screenEditing,ids,{required});
  if(!policy)return {applicable:false,scope:'historical-unversioned'};
  draft.scenes.forEach((scene,i)=>{
    const entry=policy.scenes[i];
    if(entry.panels!==null)fail('screen_editorial_unimplemented_visibility',`${entry.id}.panels`);
    const visible=[];
    const add=(id,objectId,role,text,startFrame=0)=>{if(text)visible.push({element:element(id,objectId,role,text),startFrame});};
    if(scene.visualPlan){
      const plan=scene.visualPlan,timing=plan.timing;
      add('scene:kicker','scene','label',scene.kicker,timing.headlineStartFrame);
      add('scene:title','scene','heading',scene.title??scene.visualIntent?.takeaway??'',timing.headlineStartFrame);
      add('scene:statement','scene','detail',scene.statement??scene.visualIntent?.takeaway??scene.subtitle??'',timing.supportingCopyStartFrame);
      for(const entity of plan.semanticElements)add(`entity:${entity.id}`,`entity:${entity.id}`,'label',entity.label,timing.graphicStartFrame);
      for(const relation of plan.semanticRelations)if(productionSemanticRelationLabelRequired(relation.type))
        add(`relation:${relation.id}`,'relations','label',relation.label,timing.detailCopyStartFrame);
    }else{
      // Legacy frame types still have real screen copy: title-scene subtitle is
      // a main-area subheading, not merely the excluded caption track.
      add('scene:title','scene','heading',scene.title);
      if(scene.type==='title'){
        add('scene:kicker','scene','label',scene.kicker||'AI 概念拆解');
        add('scene:subtitle','scene','detail',scene.subtitle);
      }else if(scene.type==='evidence')add('scene:label','scene','label',scene.label);
      else{
        add('scene:statement','scene','detail',scene.statement);
        if(scene.type==='summary')add('scene:kicker','scene','label',scene.kicker);
      }
    }
    const duration=scene.durationSeconds??(scene.end-scene.start);
    const end=Math.round(duration*30);
    const starts=[...new Set([0,...visible.map(value=>value.startFrame).filter(start=>start>0&&start<end),end])].sort((a,b)=>a-b);
    boundFrames(starts.slice(0,-1).map((startFrame,j)=>({startFrame,endFrame:starts[j+1],fps:30,
      elements:visible.filter(value=>value.startFrame<=startFrame).map(value=>value.element)})),entry,
      scene.visualIntent?.evidenceRefs??[],`scenes.${entry.id}`);
  });
  return {applicable:true,passed:true,scope:'screen-copy-and-concurrency'};
}

// Cue-only plans have no implemented renderer. Their declared panels are
// inspected as editorial intent; existing unmeasured/unimplemented gates stay red.
export function assertCueStoryboardScreenEditing(content,{required=false}={}){
  const policy=requireScreenEditing(content.screenEditing,content.shots.map(shot=>shot.id),{required});
  if(!policy)return {applicable:false,scope:'historical-unversioned'};
  content.shots.forEach((shot,i)=>{
    const entry=policy.scenes[i],panels=entry.panels;
    if(!Array.isArray(panels)||panels.length!==shot.beats.length)fail('screen_editorial_cue_binding',shot.id);
    let position=-1;
    const starts=panels.map((panel,j)=>{
      closedScreenRecord(panel,['cue','elements'],`${shot.id}.panels[${j}]`);
      if(panel.cue!==shot.beats[j].cue||!Array.isArray(panel.elements)||panel.elements.length===0)
        fail('screen_editorial_cue_binding',shot.id);
      // Match the source validator's ordered position, including when a prior
      // different cue has skipped an earlier occurrence of the current word.
      const next=shot.narration.indexOf(panel.cue,position+1);
      if(next<=position)fail('screen_editorial_cue_binding',shot.id);
      position=next;
      return cueFrameAtNarrationPosition(shot.narration,position,EDITORIAL_TIMING_POLICY);
    });
    const end=cueFrameAtNarrationPosition(shot.narration,shot.narration.length,EDITORIAL_TIMING_POLICY);
    const frames=[];
    if(starts[0]>0)frames.push({startFrame:0,endFrame:starts[0],fps:30,
      elements:[element('scene:title','scene','heading',shot.title)]});
    panels.forEach((panel,j)=>frames.push({startFrame:starts[j],endFrame:starts[j+1]??end,fps:30,
      elements:[element('scene:title','scene','heading',shot.title),...panel.elements]}));
    boundFrames(frames,entry,shot.evidenceRefs,`shots.${shot.id}`);
  });
  return {applicable:true,passed:true,scope:'cue-plan-only',audioAligned:false,executionImplemented:false};
}

export function assertTimedStoryboardScreenEditing(content,compiled,renderInput,{required=false}={}){
  const policy=requireScreenEditing(content.screenEditing,compiled.scenes.map(scene=>scene.id),{required});
  if(!policy)return {applicable:false,scope:'historical-unversioned'};
  compiled.scenes.forEach((scene,i)=>{
    const entry=policy.scenes[i];
    if(entry.panels!==null)fail('screen_editorial_unimplemented_visibility',`${entry.id}.panels`);
    const duration=scene.endFrame-scene.startFrame;
    const boundaries=new Set([0,duration]);
    for(const event of scene.motionPlan.events){
      for(const point of [event.atFrame,event.atFrame+event.durationFrames]){
        for(const frame of [point-1,point,point+1])if(frame>=0&&frame<duration)boundaries.add(frame);
      }
    }
    const ordered=[...boundaries].sort((a,b)=>a-b);
    const frames=ordered.slice(0,-1).map((frame,j)=>{
      // Use the actual render model: effective override value and state labels
      // count, hidden/retired objects do not. A short declared summary cannot hide prose.
      const model=buildEditorialMotionRenderModel(renderInput,scene.startFrame+frame,30);
      const elements=[element('scene:title','scene','heading',model.title.text)];
      for(const object of model.objects){
        for(const [field,role] of [['title','label'],['body','detail'],['stateText','label']]){
          if(object[field].text)elements.push(element(`${object.id}:${field}`,object.id,role,object[field].text));
        }
      }
      return {startFrame:frame,endFrame:ordered[j+1],fps:30,elements};
    });
    boundFrames(frames,entry,scene.evidenceRefs,`scenes.${scene.id}`);
  });
  return {applicable:true,passed:true,scope:'render-bound-screen-copy-and-concurrency'};
}
