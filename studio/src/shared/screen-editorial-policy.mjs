// Editorial selection precedes geometric fitting. These bounded checks never
// rewrite narration, truncate copy, shrink fonts or enlarge a card.
export const SCREEN_EDITORIAL_POLICY_VERSION = 'screen-editorial-policy-v1';
export const SCREEN_EDITORIAL_LIMITS = Object.freeze({heading:32,label:24,detail:48,
  maximumVisibleElements:6,maximumVisibleCharacters:120,
  readingCharacters:180,readingTotalCharacters:220,readingVisibleElements:3});

const closedSchema = properties => ({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const string = {type:'string',minLength:1};
export const SCREEN_EDITORIAL_PLAN_SCHEMA = closedSchema({
  version:{type:'string',enum:[SCREEN_EDITORIAL_POLICY_VERSION]},
  scenes:{type:'array',minItems:1,maxItems:64,items:closedSchema({id:string,
    // Executed renderers, not model-declared schedules, own actual visibility.
    panels:{type:'null'},
    exceptions:{type:'array',maxItems:1,items:closedSchema({elementId:string,
      kind:{type:'string',enum:['quotation','code','formula','data']},reason:string,sourceRef:string})}
  })}
});

export function screenEditorialError(code, location, actual = null) {
  return Object.assign(new Error('屏显信息过密：保留关键词、拆成逐步揭示，或用关系/状态图解释；不要截断、缩字或自动扩大卡片'),
    {code,location,actual,statusCode:409});
}
const requireValue = (value,code,location,actual) => {if(!value)throw screenEditorialError(code,location,actual);};
export function closedScreenRecord(value,keys,location) {
  requireValue(value && typeof value==='object' && !Array.isArray(value)
    && [null,Object.prototype].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length===keys.length && keys.every(key=>{
      const d=Object.getOwnPropertyDescriptor(value,key);return d?.enumerable && Object.hasOwn(d,'value');
    }),'screen_editorial_schema',location);
}
const text = value => typeof value==='string' && value.trim().length>0 && value.length<=2000
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
export const screenTextLength = value => [...value.replace(/\s/gu,'')].reduce((n,c)=>n+(/[\x00-\x7f]/u.test(c)?6:10),0)/10;

export function requireScreenEditing(plan,sceneIds,{required=false}={}) {
  if(plan===undefined && !required)return null;
  if(plan===undefined)throw screenEditorialError('screen_editorial_policy_required','screenEditing');
  closedScreenRecord(plan,['version','scenes'],'screenEditing');
  requireValue(plan.version===SCREEN_EDITORIAL_POLICY_VERSION,'screen_editorial_version','screenEditing.version');
  requireValue(Array.isArray(plan.scenes) && plan.scenes.length===sceneIds.length
    && plan.scenes.length>0 && plan.scenes.length<=64,'screen_editorial_scene_binding','screenEditing.scenes');
  plan.scenes.forEach((scene,index)=>{
    closedScreenRecord(scene,['id','panels','exceptions'],`screenEditing.scenes[${index}]`);
    requireValue(scene.id===sceneIds[index] && sceneIds.indexOf(scene.id)===index,
      'screen_editorial_scene_binding',`screenEditing.scenes[${index}].id`);
  });
  return plan;
}

export function emptyScreenEditing(sceneIds) {
  return {version:SCREEN_EDITORIAL_POLICY_VERSION,scenes:sceneIds.map(id=>({id,panels:null,exceptions:[]}))};
}

// frames contain complete, renderer-derived visible sets at every text/visibility
// change. Narration and caption tracks are intentionally absent from this input.
export function assertScreenEditorialFrames({frames,exceptions=[],evidenceRefs=[],location='screen'}) {
  requireValue(Array.isArray(frames)&&frames.length>0&&frames.length<=4096,'screen_editorial_frames',location);
  requireValue(Array.isArray(exceptions)&&exceptions.length<=1,'screen_editorial_exception',location);
  const exception=exceptions[0];
  if(exception){
    closedScreenRecord(exception,['elementId','kind','reason','sourceRef'],`${location}.exceptions`);
    requireValue(text(exception.elementId)&&['quotation','code','formula','data'].includes(exception.kind)
      &&text(exception.reason)&&screenTextLength(exception.reason)>=12&&text(exception.sourceRef)
      &&(evidenceRefs.includes(exception.sourceRef)||(exception.kind!=='quotation'&&exception.sourceRef==='illustrative-example')),
    'screen_editorial_exception',`${location}.exceptions`);
  }
  let seenException=false,readingRun=0,previousEnd=0,previousText=null;
  const finishReadingRun=()=>{
    if(previousText!==null)requireValue(readingRun>=Math.max(3,screenTextLength(previousText)/12),
      'screen_editorial_reading_beat',`${location}.exceptions`,{readingRun,readingSize:screenTextLength(previousText)});
  };
  for(const [index,frame] of frames.entries()){
    const at=`${location}.frames[${index}]`;
    requireValue(Number.isSafeInteger(frame.startFrame)&&Number.isSafeInteger(frame.endFrame)
      &&frame.startFrame===previousEnd&&frame.endFrame>frame.startFrame&&frame.endFrame<=108000
      &&frame.fps===30&&Array.isArray(frame.elements),'screen_editorial_frames',at);
    previousEnd=frame.endFrame;
    const ids=new Set();let total=0;const objects=new Set();let reading=null;
    for(const element of frame.elements){
      closedScreenRecord(element,['id','objectId','role','text'],at);
      requireValue(text(element.id)&&text(element.objectId)&&!ids.has(element.id)
        &&['heading','label','detail'].includes(element.role)&&text(element.text),'screen_editorial_element',at);
      ids.add(element.id);objects.add(element.objectId);
      const size=screenTextLength(element.text);total+=Math.round(size*10);
      const isReading=element.id===exception?.elementId;
      if(isReading){
        requireValue(element.role==='detail'&&size<=SCREEN_EDITORIAL_LIMITS.readingCharacters,
          'screen_editorial_reading_limit',`${at}.${element.id}`,size);
        reading=element.text;seenException=true;
      }else requireValue(size<=SCREEN_EDITORIAL_LIMITS[element.role],'screen_editorial_text_dense',`${at}.${element.id}`,size);
    }
    const limits=reading?{count:SCREEN_EDITORIAL_LIMITS.readingVisibleElements,total:SCREEN_EDITORIAL_LIMITS.readingTotalCharacters}
      :{count:SCREEN_EDITORIAL_LIMITS.maximumVisibleElements,total:SCREEN_EDITORIAL_LIMITS.maximumVisibleCharacters};
    requireValue(objects.size<=limits.count,'screen_editorial_concurrency',at,objects.size);
    requireValue(total<=limits.total*10,'screen_editorial_total_dense',at,total/10);
    if(reading!==previousText){finishReadingRun();readingRun=0;}
    if(reading!==null)readingRun+=(frame.endFrame-frame.startFrame)/frame.fps;
    previousText=reading;
  }
  finishReadingRun();
  if(exception)requireValue(seenException,'screen_editorial_reading_beat',`${location}.exceptions`);
  return {passed:true,scope:'screen-copy-and-concurrency',humanVisualAcceptance:false};
}

export function screenEditorialPromptDirective() {
  return `必须输出 ${SCREEN_EDITORIAL_POLICY_VERSION} 的 screenEditing，逐场 id 为 S01、S02…，panels=null，exceptions 默认空。`+
    '旁白与字幕保留完整知识，屏显只保留关键词、短结论及必要限定；关系、顺序、对照优先用已有语义对象表达，不逐字复制口播。'+
    '每拍围绕一个主判断/焦点；未完成、待授权、过期、不保证成功等事实限定不得因精简丢失。以下数值是本版可回归的默认编辑预算，不是普适阅读规律。'+
    '普通标题最多32、标签24、说明48个等效字，同屏总量120、最多6组对象；ASCII按0.6、中文按1估计。'+
    '超过时先精简、拆拍或选择关系/状态图，不截断、缩字、自动扩大卡片。未实现逐拍隐藏时按所有元素同时可见计算，不能虚报可见集合。'+
    '代码/公式/数据或证据原文确有必要时，逐场最多一个明确 elementId 的阅读特例，附 kind、至少12字理由和来源 sourceRef，仍限180字、同屏220字/3组并留阅读时间；不是一律豁免。';
}
