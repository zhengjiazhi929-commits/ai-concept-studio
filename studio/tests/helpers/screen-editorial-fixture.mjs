import {emptyScreenEditing} from '../../src/shared/screen-editorial-policy.mjs';

// Explicit new synthetic candidates, never a migration of approved fixtures.
export function attachSyntheticScreenEditing(candidate){
  const content=candidate.content;
  if(content.executionPlan){
    content.screenEditing=emptyScreenEditing(content.executionPlan.sceneGroups.map(scene=>scene.id));
  }else{
    content.screenEditing=emptyScreenEditing(content.shots.map(shot=>shot.id));
    content.screenEditing.scenes.forEach((scene,i)=>{
      scene.panels=content.shots[i].beats.map(beat=>({cue:beat.cue,elements:[
        {id:'operation',objectId:'operation',role:'label',text:'核对来源'},
        {id:'result',objectId:'result',role:'detail',text:'保留原始记录'}
      ]}));
    });
  }
  return candidate;
}
