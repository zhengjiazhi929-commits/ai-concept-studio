import {assertScreenEditorialFrames, SCREEN_EDITORIAL_POLICY_VERSION} from '../../shared/screen-editorial-policy.mjs';

const freeze = value => {if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const CONCISE_BOARDS = freeze([
  {id:'context',compositionId:'ConciseContextBoard',title:'上下文：这一轮给模型什么',phases:[
    {label:'先明确任务',explanation:'上下文是模型在这一轮推理时实际接收到的信息。先明确当前任务，再考虑需要哪些规则、资料和工具结果；材料存在于系统中，不代表已经进入本轮输入。'},
    {label:'选择相关材料',explanation:'围绕当前问题选择相关规则和本次工具结果，不把所有资料都塞进来。这里用一个虚构退货咨询演示选择过程，真实项目还需要核对权限、来源、时效和容量。'},
    {label:'装配本轮输入',explanation:'把当前任务、相关规则与本次订单查询结果装配成本轮输入，才交给模型使用。画面中的短标签表示内容类别，而不是把真实项目所需的完整规则压缩成这几个字。'}]},
  {id:'memory',compositionId:'ConciseMemoryBoard',title:'记忆读入，才成为上下文',phases:[
    {label:'存储不等于已读',explanation:'记忆库保存可供后续使用的信息，但持久保存与当前可见是两个状态。图中已保存用户偏好，本轮上下文尚未读取它，不能假定模型已经知道。'},
    {label:'获准后复制',explanation:'在确认这条偏好与任务相关、且允许读取后，系统取出它的副本。这里用获准读取的一条用户偏好作教学示例，并不表示所有记忆都能无条件进入每轮输入。'},
    {label:'副本进入本轮',explanation:'偏好的副本进入本轮上下文，与任务、规则和工具结果共同使用；记忆库中的原件仍然保留。只有被读取并装配进来这部分记忆，才成为本轮上下文的一部分。'}]},
  {id:'order',compositionId:'ConciseOrderBoard',title:'订单状态，以本次查询为准',phases:[
    {label:'旧快照不是现在',explanation:'客服可能从历史对话或记忆中见到旧订单状态，但那只是过去的快照。订单 317、时间与状态均为虚构教学案例，不来自任何真实用户或业务系统。'},
    {label:'向系统发起查询',explanation:'回答订单现在的状态之前，按订单编号向有权访问的订单系统发起本次查询。在结果返回前，画面保持等待状态，不把记忆里的旧状态冒充实时答案。'},
    {label:'使用本次返回值',explanation:'本次查询在 10:05 返回已发货，客服使用这个返回值回答当前状态，同时保留 10:02 的旧快照作为历史。这里仅演示查询成功的路径；真实项目还要处理查询失败、权限不足与返回时效，查询不代表修改了订单。'}]}
]);

const box=(x,y,width,height)=>({x,y,width,height});
function label(nodes,id,objectId,text,x,y,{size=36,anchor='start',tone='ink',weight=500,role='label'}={}){
  nodes.push({id,objectId,text,x,y,size,anchor,tone,weight,role});
}
export function conciseStoryboardState(id,phase){
  const board=CONCISE_BOARDS.find(item=>item.id===id);
  if(!board || !Number.isInteger(phase)||phase<0||phase>2)throw new RangeError('Unknown concise storyboard pose');
  const labelNodes=[];const state={id,phase,bounds:[],connections:[],labelNodes};
  label(labelNodes,'theme','theme',board.title,108,184,{size:72,weight:550,role:'heading'});
  if(id==='context'){
    Object.assign(state,{assembled:phase===2,selectedIds:phase===0?[]:['rules','tool'],
      window:box(1060,320,720,540),task:box(140,325,810,130),
      sources:[['rules','规则',140],['material','资料',440],['tool','工具结果',740]].map(([sourceId,name,x])=>
        ({id:sourceId,name,rect:box(x,525,235,165),retained:true,active:phase>0&&sourceId!=='material'}))});
    state.bounds=[state.window,state.task,...state.sources.map(source=>source.rect)];
    label(labelNodes,'task-kind','task','当前任务',140,365,{size:30,tone:'muted'});
    label(labelNodes,'task-value','task','这笔订单能退吗？',140,429,{size:48,weight:550});
    state.sources.forEach(source=>label(labelNodes,source.id,source.id,source.name,source.rect.x+28,source.rect.y+64,
      {size:38,weight:550,tone:source.active?'accent':'ink'}));
    label(labelNodes,'window-title','window','本轮输入',1106,383,{size:38,weight:550});
    if(phase<2)label(labelNodes,'window-state','window',phase===0?'尚未组装':'已选相关材料',1420,601,{size:40,anchor:'middle',tone:'muted'});
    else ['这笔订单能退吗？','退货规则','本次订单结果'].forEach((text,i)=>label(labelNodes,`input-${i}`,'window',text,1130,503+i*124,{size:42,weight:550,tone:i?'accent':'ink'}));
    if(phase>0)state.connections=[{points:[[257.5,690],[257.5,770],[995,770]],arrow:false},
      {points:[[857.5,690],[857.5,770]],arrow:false},{points:[[995,770],[1060,770]],arrow:true}];
  }else if(id==='memory'){
    Object.assign(state,{authorized:phase>0,arrived:phase===2,
      source:{rect:box(155,395,430,377),value:'简短中文',retained:true},
      window:box(1120,330,660,520),windowContent:box(1150,432,600,384),
      copy:phase===0?null:{value:'简短中文',rect:box(phase===1?735:1320,554,260,96)}});
    state.bounds=[state.source.rect,state.window,...(state.copy?[state.copy.rect]:[])];
    label(labelNodes,'store-title','store','记忆库',370,355,{size:38,anchor:'middle',weight:550});
    label(labelNodes,'source-key','store','偏好',190,578,{size:30,tone:'muted'});
    label(labelNodes,'source-value','store',state.source.value,548,637,{size:42,anchor:'end',weight:550});
    label(labelNodes,'source-retained','store','原件保留',370,823,{size:30,anchor:'middle',tone:'muted'});
    label(labelNodes,'window-title','window','本轮上下文',1166,393,{size:38,weight:550});
    if(phase<2)label(labelNodes,'window-state','window',phase===0?'尚未读取':'等待副本',1450,607,{size:40,anchor:'middle',tone:'muted'});
    if(phase>0){
      label(labelNodes,'gate','gate','授权读取',850,480,{size:34,anchor:'middle',tone:'accent',weight:550});
      label(labelNodes,'copy','copy',state.copy.value,phase===1?865:1450,615,{size:38,anchor:'middle',tone:'accent',weight:550});
      state.connections=phase===1?[{points:[[585,602],[720,602]],arrow:true},{points:[[1010,602],[1120,602]],arrow:true}]
        :[{points:[[585,602],[1120,602]],arrow:true}];
    }
    if(phase===2)label(labelNodes,'other-inputs','window','任务·规则·工具结果',1450,764,{size:30,anchor:'middle',tone:'muted'});
  }else{
    Object.assign(state,{orderId:'317',oldSnapshot:{time:'10:02',value:'待发货',retained:true},
      querySent:phase>=1,queryReturned:phase===2,currentResult:phase===2?{time:'10:05',value:'已发货',orderId:'317'}:null,
      old:box(150,445,360,280),receipt:box(670,355,485,415),database:box(1325,395,430,377)});
    state.bounds=[state.old,state.receipt,state.database];
    label(labelNodes,'old-label','old','旧快照',182,499,{size:34,tone:'muted'});
    label(labelNodes,'old-time','old',state.oldSnapshot.time,182,569,{size:34,tone:'muted'});
    label(labelNodes,'old-value','old',state.oldSnapshot.value,182,662,{size:46,tone:'muted'});
    label(labelNodes,'order','receipt',`订单 ${state.orderId}`,710,418,{size:44,weight:550});
    label(labelNodes,'database','database','订单系统',1540,350,{size:38,anchor:'middle',weight:550});
    label(labelNodes,'result','receipt',phase===2?state.currentResult.value:phase===1?'等待返回':'待查询',710,638,{size:56,weight:550,tone:phase===2?'accent':'muted'});
    if(phase===2){
      label(labelNodes,'current-time','receipt',state.currentResult.time,710,550,{size:34,tone:'muted'});
      label(labelNodes,'database-id','database','317',1370,594,{size:32,tone:'muted'});
      label(labelNodes,'database-value','database','已发货',1698,660,{size:42,tone:'accent',anchor:'end',weight:550});
      label(labelNodes,'return-label','return','返回',1240,711,{size:28,anchor:'middle',tone:'accent'});
    }
    if(phase>0){
      label(labelNodes,'query-label','query','查询',1240,480,{size:28,anchor:'middle',tone:phase===2?'muted':'accent'});
      state.connections=[{points:[[1155,515],[1325,515]],arrow:true,muted:phase===2},
        ...(phase===2?[{points:[[1325,662],[1155,662]],arrow:true}]:[])];
    }
  }
  state.labels=labelNodes.filter(node=>node.role!=='heading').map(node=>node.text);
  state.visibleLabels=labelNodes.map(({id:labelId,objectId,role,text})=>({id:labelId,objectId,role,text}));
  return freeze(state);
}

export function assertConciseEditorialPlan(){
  const checks=CONCISE_BOARDS.map(board=>({id:board.id,...assertScreenEditorialFrames({
    frames:[0,1,2].map(phase=>({startFrame:phase,endFrame:phase+1,fps:30,elements:conciseStoryboardState(board.id,phase).visibleLabels})),
    exceptions:[],evidenceRefs:[],location:`concise-storyboards.${board.id}`})}));
  return {version:SCREEN_EDITORIAL_POLICY_VERSION,checks,humanVisualAcceptance:false};
}
