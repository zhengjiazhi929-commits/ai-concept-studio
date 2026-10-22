import React from 'react';
import {AbsoluteFill, Composition, useCurrentFrame} from 'remotion';
import {VIDEO_SANS_FONT_FAMILY} from '../font-system.mjs';
import {VisualSystemV1AiWatermark} from '../components/visual-system-v1/ai-watermark.jsx';
import {frostedCardStyle} from '../glass-card-preview/material.mjs';
import {activePhrase, chapterProgress, clamp, orthogonalPoints, queryMechanismState,
  compressionMechanismState, fallbackMechanismState, writeTimelineState,
  writeTimelineConnections} from './model.mjs';

const C={ink:'#14211D',muted:'#53685E',accent:'#17795D',border:'#6A9782',pale:'#E4F4EC',paper:'#F0F6F2',warning:'#91613F'};
const titles={
  topic:'上下文工程与 Agent 记忆',outline:'这期视频，从四个问题讲起',context:'上下文工程：组织这一次输入',sources:'来源不同，进入同一轮判断',memory:'记忆：保留以后可能用到的信息',
  scope:'记忆类型，先分清两个维度',types:'再看：记住的内容是什么', 'type-examples':'事实、经历、做法，各有职责','two-dimensions':'同一条记忆，可以同时有两个标签',
  'authorized-read':'保存，不等于已经进入上下文',relationship:'记忆只是上下文的来源之一',case:'从一个完整问题开始','case-policy':'示例数据，不代表真实商家规则',request:'用户的问题与约束',constraint:'当前授权：咨询，不代操作',access:'先确认权限，再查询订单',
  'fresh-query':'旧事实必须让位于新证据',policy:'用新状态匹配适用政策','model-input':'这才是实际送给模型的输入',compression:'压缩冗余，不压掉限制',
  'answer-fact':'给用户一个有依据的答复','answer-limit':'不把建议说成执行成功','answer-next':'答复完整，下一步等待确认',
  'session-record':'只记录实际发生的事情','memory-record':'稳定偏好可复用，业务事实需更新',
  'write-compare':'同一请求，两种写入时序','sync-write':'同步：写入成功，再承诺完成','async-receipt':'异步：先回应，不假报保存成功','async-write':'新记录可用，必须等写入完成',
  'test-outline':'用输入、预期和证据验收','test-freshness':'测试一：旧事实能否被新证据替换','test-access':'测试二：越权请求应在读取前拒绝','test-unavailable':'测试三：不可用，不等于查到了', 'test-evidence':'调用守边界，答复有依据'
};
export function Text({x,y,w=1500,size=34,color=C.ink,weight=450,children,style={}}){
  return <div style={{position:'absolute',left:x,top:y,width:w,fontSize:size,fontWeight:weight,lineHeight:1.45,color,whiteSpace:'pre-line',...style}}>{children}</div>;
}
export function Glass({x,y,w,h,emphasis=false,children,style={}}){
  return <div data-explainer-card="frosted" style={{...frostedCardStyle({width:w,minHeight:h,emphasis}),position:'absolute',left:x,top:y,height:h,padding:0,borderRadius:28,
    // Keep the approved optical surface; the thin structural rim stays visible in video.
    outline:`1.5px solid ${emphasis?'#4D927A':'#9AB7A8'}`,outlineOffset:-1,...style}}>{children}</div>;
}
export function Arrow({points,muted=false,progress=1}){
  const [x,y]=points.at(-1),[px,py]=points.at(-2);const angle=x>px?0:x<px?180:y>py?90:-90;
  return <svg style={{position:'absolute',inset:0,width:1920,height:1080,overflow:'visible'}} aria-hidden="true">
    <polyline points={orthogonalPoints(points)} fill="none" stroke={muted?'#A2BEB0':C.accent} strokeWidth={3} strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1-progress}/>
    {progress>=0.99&&<path d="M -12 -6 L 0 0 L -12 6 Z" transform={`translate(${x} ${y}) rotate(${angle})`} fill={muted?'#A2BEB0':C.accent}/>}</svg>;
}
export function Note({children,y=810}){return <Text x={120} y={y} size={28} color={C.muted}>{children}</Text>;}
export function Topic({outline=false}){
  return <>
    {!outline&&<><Text x={120} y={300} w={1680} size={64} weight={550}>把「这一轮输入」和「可复用的历史」分清</Text>
      <Text x={124} y={452} size={40} color={C.muted}>从概念出发，走完一个 AI 客服案例。</Text></>}
    {['概念','类型','关系','客服实践'].map((t,i)=><Glass key={t} x={120+i*422} y={outline?350:645} w={390} h={outline?270:185}>
      <Text x={30} y={outline?32:22} w={330} size={25} color={C.accent}>0{i+1}</Text>
      <Text x={30} y={outline?78:65} w={330} size={outline?48:38} weight={550}>{t}</Text>
      {outline&&<Text x={30} y={158} w={330} size={30} color={C.muted}>{['分别解决什么问题','按什么维度分类','记忆如何进入上下文','输入、答复、记录与测试'][i]}</Text>}
    </Glass>)}
  </>;
}
export function Context({visual,progress}){
  const memory=['memory','authorized-read','relationship'].includes(visual);
  const showSources=['sources','relationship'].includes(visual);
  const read=['authorized-read','relationship'].includes(visual);
  return <>
    <Glass x={120} y={320} w={540} h={405} emphasis={memory}>
      <Text x={36} y={30} w={468} size={39} weight={550}>{memory?'已保存的记忆':'当前材料'}</Text>
      <Text x={36} y={112} w={466} size={33}>{memory?'归属：用户 U17\n获准偏好：简短中文\n用于后续沟通':'任务要求\n处理规则与资料\n实时工具结果'}</Text>
      <Text x={36} y={325} w={466} size={26} color={C.muted}>{memory?'原记录保留，不等于本轮已读取':'不同来源，不都叫“记忆”'}</Text>
    </Glass>
    <Arrow points={[[672,523],[833,523]]} progress={visual==='memory'?0:progress}/>
    <Text x={675} y={437} w={156} size={25} color={C.accent} style={{textAlign:'center'}}>{read?'授权与\n相关性检查':visual==='memory'?'尚未读取':'选择与\n组织'}</Text>
    <Glass x={845} y={320} w={945} h={405} emphasis>
      <div style={{padding:'27px 38px',borderBottom:'2px solid #A3C5B5',fontSize:37,fontWeight:550}}>本轮模型输入</div>
      {visual==='memory'?<Text x={40} y={164} w={865} size={36} color={C.muted}>保存的内容，不会自动全部进入。</Text>:
        <><Text x={40} y={115} w={865} size={34}>{showSources?'当前请求 + 规则与资料 + 新工具结果':read?'读取的偏好副本：简短中文':'为这次判断准备必要信息'}</Text>
          {(read||showSources)&&<Text x={40} y={209} w={865} size={34} color={C.accent}>{read&&showSources?'＋ 获准读取的记忆副本':'每项信息保留来源与适用边界'}</Text>}
          <Text x={40} y={313} w={865} size={28} color={C.muted}>输入有边界，不是永久存储。</Text></>}
    </Glass>
    <Note>{read?'记忆是来源之一；只有被读取并选中，才成为这次输入。':'上下文工程关注的是“这次需要什么”，不是把所有材料都塞进去。'}</Note>
  </>;
}
function MemoryTypes({visual}){
  if(visual==='scope')return <>
    <Text x={120} y={280} size={31} color={C.accent}>维度一 · 使用范围</Text>
    {[['短期','当前任务 / 会话','订单 317、查询进度、待确认事项'],['长期','后续任务 / 会话','获准保留的“简短中文”偏好']].map((a,i)=><Glass key={a[0]} x={120+i*856} y={365} w={816} h={365} emphasis={i===1}>
      <Text x={36} y={32} w={740} size={47} weight={550}>{a[0]}</Text><Text x={36} y={119} w={740} size={35}>{a[1]}</Text><Text x={36} y={223} w={740} size={31} color={C.muted}>{a[2]}</Text>
    </Glass>)}<Note>这里按使用范围区分，不按“存了几天”机械分类。</Note>
  </>;
  if(visual==='two-dimensions')return <>
    <Glass x={580} y={350} w={760} h={215} emphasis><Text x={44} y={40} w={672} size={44} weight={550}>偏好：简短中文</Text><Text x={44} y={118} w={672} size={29} color={C.muted}>用户明确允许后续沟通使用</Text></Glass>
    <Arrow points={[[755,575],[755,628],[532,628],[532,662]]}/><Arrow points={[[1160,575],[1160,628],[1375,628],[1375,662]]}/>
    <Glass x={200} y={670} w={664} h={180}><Text x={40} y={33} w={584} size={40}>使用范围：长期</Text><Text x={40} y={99} w={584} size={29} color={C.muted}>可以跨会话复用</Text></Glass>
    <Glass x={1040} y={670} w={664} h={180}><Text x={40} y={33} w={584} size={40}>内容类型：语义</Text><Text x={40} y={99} w={584} size={29} color={C.muted}>记住一个稳定偏好</Text></Glass>
  </>;
  return <><Text x={120} y={280} size={31} color={C.accent}>维度二 · 内容性质</Text>
    {[['语义','事实与偏好','“简短中文”'],['情景','具体处理经历','上次怎样核实并解释政策'],['程序性','经过审核的做法','核实订单 → 查政策 → 给建议']].map((a,i)=><Glass key={a[0]} x={120+i*572} y={370} w={530} h={360} emphasis={visual==='type-examples'}>
      <Text x={32} y={32} w={466} size={46} weight={550}>{a[0]}</Text><Text x={32} y={128} w={466} size={34}>{a[1]}</Text><Text x={32} y={223} w={466} size={31} color={C.muted}>{a[2]}</Text>
    </Glass>)}<Note>“短期 / 长期”与这三类不是一排互斥选项。</Note></>;
}
function Request({visual}){
  return <><Text x={120} y={270} size={27} color={C.accent}>虚构教学案例 · 用户 U17 · 订单 317 · 政策 P3</Text>
    <Glass x={180} y={375} w={1560} h={320} emphasis>
      <Text x={50} y={40} w={1460} size={29} color={C.muted}>用户原话</Text>
      <Text x={50} y={100} w={1460} size={56} weight={550}>317 号订单还能取消吗？</Text>
      <Text x={50} y={206} w={1460} size={43} color={visual==='constraint'?C.accent:C.ink}>先别替我操作。</Text>
    </Glass>
    <Note>{visual==='case-policy'?'演示规则：未发货可提交取消申请；已发货转售后审核，不保证通过。':'当前只授权咨询。回答问题，不等于执行取消。'}</Note>
  </>;
}
function Access({test=false,progress=1}){
  return <>
    <Glass x={120} y={350} w={450} h={300}><Text x={32} y={35} w={386} size={43} weight={550}>{test?'用户 U18':'用户 U17'}</Text><Text x={32} y={135} w={386} size={34}>请求订单 317</Text></Glass>
    <Arrow points={[[582,495],[745,495]]} progress={progress}/>
    <div style={{position:'absolute',left:762,top:335,width:380,height:330,border:`3px solid ${test?C.warning:C.accent}`,borderRadius:30,background:'#E4F0E9'}}>
      <Text x={32} y={35} w={316} size={38} weight={550}>服务端权限边界</Text><Text x={32} y={139} w={316} size={36} color={test?C.warning:C.accent}>{test?'无权读取 · 拒绝':'归属匹配 · 允许'}</Text>
      <Text x={32} y={236} w={316} size={27} color={C.muted}>店铺 / 用户 / 资源</Text>
    </div>
    {!test&&<Arrow points={[[1154,495],[1317,495]]} progress={progress}/>}
    <Glass x={1330} y={350} w={450} h={300} emphasis={!test}><Text x={32} y={35} w={386} size={43} weight={550}>{test?'受保护记录':'订单查询'}</Text><Text x={32} y={135} w={386} size={33} color={C.muted}>{test?'不返回任何内容':'只查 U17 的订单 317'}</Text></Glass>
  </>;
}
export function Query({test=false,lineProgress=1,currentNote='采用当前状态与政策 P3',note}){
  const state=queryMechanismState(lineProgress);
  return <>
    <Glass x={120} y={350} w={690} h={310} style={{opacity:state.oldOpacity}}><Text x={38} y={29} w={614} size={30} color={C.muted}>旧快照 · 10:02</Text><Text x={38} y={108} w={614} size={55} color={C.muted}>待发货</Text><Text x={38} y={224} w={614} size={30} color={C.muted}>{state.oldIsCurrent?'当前依据待更新':'已退出当前依据；保留历史'}</Text></Glass>
    <Arrow points={[[810,503],[1110,503]]} progress={state.newProgress}/><Text x={834} y={404} w={250} size={29} color={C.accent} style={{textAlign:'center'}}>本次授权查询</Text>
    <Glass x={1110} y={350} w={690} h={310} emphasis={state.newIsCurrent}>
      <Text x={38} y={29} w={614} size={30} color={C.accent}>{state.newIsCurrent?'当前依据 · 10:05':'新查询 · 等待结果'}</Text>
      {state.newProgress===0?<Text x={38} y={108} w={614} size={44} color={C.muted}>等待授权查询返回</Text>:
        <Text x={38} y={108} w={582} size={55} weight={550} style={{opacity:state.newProgress,translate:`${32*(1-state.newProgress)}px 0px`}}>已发货</Text>}
      <Text x={38} y={224} w={614} size={30}>{state.newIsCurrent?currentNote:'结果到达后，更新当前事实位'}</Text>
    </Glass>
    <Note>{note??(test?'预期：答复需售后审核，不保证取消。判据：有本次查询；没有取消执行调用。':'查询时间与来源一起保留，旧结论不继续占用当前事实位。')}</Note>
  </>;
}
export function Input({compression=false,lineProgress=1,boundedHeaders=false}){
  const state=compressionMechanismState(lineProgress);
  const rows=[['任务与约束','订单 317 能否取消；只咨询，不代操作。'],['当前证据','授权查询：10:05，已发货。'],['适用政策','虚构 P3：转售后审核，不保证通过。'],['表达与待办','简短中文；未申请，等待用户决定。']];
  if(compression)return <>
    <Text x={130} y={277} w={boundedHeaders?620:1500} size={30} color={C.muted}>压缩前</Text><Text x={1100} y={277} w={boundedHeaders?650:1500} size={30} color={C.accent}>压缩后</Text>
    {[['谢谢，你解释得很清楚。','排除闲聊','不进入本轮'],['10:02 待发货','更新依据','10:05 已发货'],['先别替我操作','保留约束','只咨询，不代操作']].map((r,i)=><React.Fragment key={r[0]}>
      <div style={{position:'absolute',left:130,top:354+i*151,width:620,borderBottom:'2px solid #A7C5B6',padding:'16px 0',fontSize:36,color:i===0?C.muted:C.ink,
        opacity:i===0?state.chatterOpacity:state.constraintSourceOpacity,textDecoration:i===0&&!state.chatterSelected?'line-through':'none'}}>{r[0]}</div>
      {i>0&&<Arrow points={[[750,401+i*151],[boundedHeaders?1076:1100,401+i*151]]} progress={i===1?state.updatedFactFlow:state.constraintFlow}/>}
      <Text x={800} y={337+i*151} w={250} size={26} color={C.accent} style={{textAlign:'center'}}>{r[1]}</Text>
      <div style={{position:'absolute',left:1100,top:354+i*151,width:650,borderBottom:'2px solid #78AD95',padding:'16px 0',fontSize:36,
        color:i===0?C.muted:C.ink}}>{i===0?(state.chatterSelected?'筛选中':r[2]):i===1?(state.updatedFactOutputVisible?r[2]:'等待新依据'):(state.constraintOutputVisible?r[2]:'保留约束，正在传入')}</div>
    </React.Fragment>)}<Note>删冗余，保留事实的新鲜度、权限和“尚未操作”的状态。</Note></>;
  return <Glass x={120} y={305} w={1680} h={525} emphasis>
    <div style={{padding:'23px 36px',fontSize:28,color:C.accent,borderBottom:'2px solid #A3C5B5'}}>本轮输入 · 只含授权范围内、与当前任务相关的材料</div>
    {rows.map((r,i)=><div key={r[0]} style={{position:'absolute',left:36,right:36,top:107+i*96,height:80,display:'grid',gridTemplateColumns:'290px 1fr',alignItems:'center',borderBottom:i<3?'1px solid #BDD1C6':'none',fontSize:34}}><span style={{color:C.muted}}>{r[0]}</span><span>{r[1]}</span></div>)}
  </Glass>;
}
export function Answer({visual}){
  const limit=visual!=='answer-fact',next=visual==='answer-next';
  return <>
    <Glass x={170} y={340} w={1580} h={445} emphasis>
      <Text x={44} y={25} w={1492} size={28} color={C.accent}>最终答复 · 依据：10:05 查询 + 虚构政策 P3</Text>
      <Text x={44} y={106} w={1492} size={46} weight={500}>订单已发货，需转售后审核。</Text>
      {limit&&<Text x={44} y={211} w={1492} size={43}>不能保证取消，也没有替你操作。</Text>}
      {next&&<Text x={44} y={317} w={1492} size={42} color={C.accent}>需要我说明申请步骤吗？</Text>}
    </Glass><Note>答复已完成 ≠ 业务已取消。询问下一步，不触发业务操作。</Note>
  </>;
}
export function Records({longTerm,showLongTerm=true}){
  return <>
    <Glass x={120} y={320} w={814} h={485} emphasis={!longTerm}>
      <Text x={36} y={31} w={742} size={42} weight={550}>会话记录 · 当前进度</Text>
      <Text x={36} y={125} w={742} size={33}>{'订单：317\n10:05 查询：已发货\n依据：政策 P3\n已答复；尚未操作，等待确认'}</Text>
      <Text x={36} y={390} w={742} size={28} color={C.accent}>不记录“取消成功”</Text>
    </Glass>
    {showLongTerm&&<Glass x={974} y={320} w={814} h={485} emphasis={longTerm}>
      <Text x={36} y={31} w={742} size={42} weight={550}>长期记忆 · 既有获准记录</Text>
      <Text x={36} y={125} w={742} size={33}>{'归属：U17\n偏好：简短中文\n来源：用户明确允许\n范围：仅限该用户后续沟通'}</Text>
      <Text x={36} y={390} w={742} size={28} color={C.accent}>沿用，不重复建；订单下次重查</Text>
    </Glass>}
  </>;
}
export function WriteTimeline({visual,lineProgress,requestText='同一个请求：“以后改成详细回复，并保存。”',stateOverride}){
  const {syncStep,asyncStep}=stateOverride??writeTimelineState(visual,lineProgress);
  return <>
    <Text x={120} y={263} size={30} color={C.accent}>{requestText}</Text>
    {[['同步',syncStep,[syncStep?'核验完成':'等待核验',syncStep>=2?'写入成功':'等待写入',syncStep>=3?'回复：已更正':'等待结果回执']],
      ['异步',asyncStep,[asyncStep?'回执：长期待保存':'等待请求回执',asyncStep>=3?'后台写入成功':asyncStep===2?'后台核验与写入中':'等待后台处理',asyncStep>=3?'新长期记录可用':'尚无新长期记录']]].map(([label,count,steps],r)=>{
      return <React.Fragment key={label}>
        <Text x={120} y={415+r*243} w={180} size={44} weight={550}>{label}</Text>
        {writeTimelineConnections(r).map((points,i)=><Arrow key={i} points={points} muted={count<i+2}/>)}
        {steps.map((s,i)=><div key={s} style={{position:'absolute',left:348+i*496,top:386+r*243,width:448,height:154,background:i<count?C.pale:C.paper,border:`2px solid ${i<count?C.accent:'#9CBBA9'}`,borderRadius:22,padding:'31px 26px',boxSizing:'border-box',fontSize:34,lineHeight:1.35,color:i<count?C.ink:C.muted}}>{s}</div>)}
      </React.Fragment>;
    })}
    <Note y={830}>两条线只比较先后，不表示实测耗时。后台失败时必须明确“未保存”。</Note>
  </>;
}
export function TestScene({visual,lineProgress=1}){
  const fallback=fallbackMechanismState(lineProgress);
  if(['test-outline','test-evidence'].includes(visual))return <>
    <Text x={120} y={272} size={29} color={C.accent}>三个待执行的教学用例 · 不是已通过的测试报告</Text>
    {[['01','旧事实','输入：旧待发货 + 新已发货','预期：采用新状态与政策'],['02','跨用户','输入：U18 请求 U17 记录','预期：在读取前拒绝'],['03','服务不可用','输入：记忆服务不可用','预期：不捏造召回或偏好']].map((a,i)=><Glass key={a[0]} x={120+i*572} y={365} w={530} h={347}>
      <Text x={30} y={28} w={470} size={27} color={C.accent}>{a[0]} · 待执行</Text><Text x={30} y={83} w={470} size={41} weight={550}>{a[1]}</Text>
      <Text x={30} y={174} w={470} size={29}>{a[2]}</Text><Text x={30} y={253} w={470} size={29}>{a[3]}</Text>
    </Glass>)}<Note>验收证据：调用轨迹是否守住授权范围；最终答复是否引用了有效依据。</Note>
  </>;
  if(visual==='test-freshness')return <><Query test lineProgress={lineProgress}/><Text x={120} y={266} size={28} color={C.accent}>输入：同一订单的新旧状态相反 · 待执行</Text></>;
  if(visual==='test-access')return <><Access test/><Text x={120} y={266} size={28} color={C.accent}>输入：把主体切换为无权访问的 U18 · 待执行</Text><Note>预期：拒绝。判据：没有受保护数据读取或返回；答复不泄露 U17 的信息。</Note></>;
  return <>
    <Text x={120} y={266} size={28} color={C.accent}>输入：记忆服务不可用；订单与政策仍可用 · 待执行</Text>
    {[['记忆服务',fallback.memoryStatus==='unavailable'?'不可用':'模拟读取中','记忆路径不提供偏好'],['订单与政策','仍在授权范围内可用','业务查询路径保持可用']].map((a,i)=><Glass key={a[0]} x={120+i*856} y={350} w={816} h={332} emphasis={i===1}>
      <Text x={36} y={30} w={744} size={40} weight={550}>{a[0]}</Text><Text x={36} y={124} w={744} size={38} color={i===0?C.warning:C.accent}>{a[1]}</Text><Text x={36} y={241} w={744} size={31}>{a[2]}</Text>
    </Glass>)}
    <svg style={{position:'absolute',inset:0,width:1920,height:1080}} aria-hidden="true">
      <path d="M 528 682 V 706" fill="none" stroke={C.warning} strokeWidth={3} pathLength={1} strokeDasharray="1" strokeDashoffset={1-fallback.failureProgress}/>
      {fallback.memoryStatus==='unavailable'&&<path d="M 516 707 H 540" stroke={C.warning} strokeWidth={3}/>}
    </svg>
    <Arrow points={[[1384,682],[1384,715]]} progress={fallback.businessProgress}/>
    <Text x={120} y={728} w={816} size={30} color={C.warning}>{fallback.memoryStatus==='unavailable'?'unavailable：不猜测偏好':'等待故障返回'}</Text>
    <Text x={976} y={728} w={816} size={30} color={C.accent}>{fallback.businessOutputReady?'用订单与政策形成有依据的答复':'继续在授权范围内查询'}</Text>
    <Note>必要业务依据也缺失时：追问或停止结论，不能无条件硬答。</Note>
  </>;
}
function Artwork({visual,progress,lineProgress}){
  if(visual==='topic'||visual==='outline')return <Topic outline={visual==='outline'}/>;
  if(['context','sources','memory','authorized-read','relationship'].includes(visual))return <Context {...{visual,progress}}/>;
  if(['scope','types','type-examples','two-dimensions'].includes(visual))return <MemoryTypes visual={visual}/>;
  if(['case','case-policy','request','constraint'].includes(visual))return <Request visual={visual}/>;
  if(visual==='access')return <><Access progress={progress}/><Note>读取由服务端授权，不由模型自称“我有权限”。</Note></>;
  if(visual==='fresh-query')return <Query lineProgress={lineProgress}/>;
  if(visual==='policy')return <><Glass x={260} y={345} w={1400} h={390} emphasis><Text x={42} y={32} w={1316} size={29} color={C.accent}>虚构政策 P3 · 已发货分支</Text><Text x={42} y={132} w={1316} size={55} weight={550}>已发货 → 售后审核</Text><Text x={42} y={262} w={1316} size={39}>不保证取消成功；尚未提交申请。</Text></Glass><Note>不再使用“未发货可提交取消申请”的旧路径。</Note></>;
  if(visual==='model-input'||visual==='compression')return <Input compression={visual==='compression'} lineProgress={lineProgress}/>;
  if(visual.startsWith('answer-'))return <Answer visual={visual}/>;
  if(visual==='session-record'||visual==='memory-record')return <Records longTerm={visual==='memory-record'}/>;
  if(['write-compare','sync-write','async-receipt','async-write'].includes(visual))return <WriteTimeline {...{visual,lineProgress}}/>;
  if(visual.startsWith('test-'))return <TestScene visual={visual} lineProgress={lineProgress}/>;
  throw new Error(`Unsupported narration visual: ${visual}`);
}
export function ExplainerRevision({plan,timing}){
  const frame=useCurrentFrame();const {current,caption}=activePhrase(timing.segments,frame);
  const progress=clamp((frame-current.startFrame)/18);
  const lineProgress=clamp((frame-current.startFrame)/(current.endFrame-current.startFrame));
  const chapters=chapterProgress(timing.chapters,frame);
  return <AbsoluteFill data-explainer-visual={current.visual} style={{background:C.paper,color:C.ink,fontFamily:VIDEO_SANS_FONT_FAMILY,
    backgroundImage:'radial-gradient(ellipse at 85% 10%, rgba(67,184,145,0.08), transparent 48%)'}}>
    <Text x={108} y={59} size={25} color={C.accent} weight={500}>AI 直通车 · 上下文工程与 Agent 记忆</Text>
    <Text x={108} y={117} w={1540} size={64} weight={550} style={{letterSpacing:'-0.025em',lineHeight:1.25}}>{titles[current.visual]}</Text>
    <Artwork visual={current.visual} progress={progress} lineProgress={lineProgress}/>
    <Text x={120} y={918} w={1680} size={38} weight={500} style={{textAlign:'center'}}>{caption}</Text>
    <div aria-label="关键片段章节进度" style={{position:'absolute',left:108,right:108,top:1010,display:'flex',gap:22}}>
      {chapters.map((c,i)=><div key={c.id} data-chapter-progress={c.id} style={{flexGrow:c.durationFrames,flexBasis:0,minWidth:0}}>
        <div data-chapter-label style={{fontSize:20,color:c.id===current.chapterId?C.accent:C.muted,fontWeight:500,marginBottom:8,lineHeight:'29px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.label??plan.chapters[i]?.label}</div>
        <div data-chapter-track style={{height:5,background:'#CDDFD5',borderRadius:4}}><div data-chapter-fill style={{height:5,width:`${c.amount*100}%`,background:C.accent,borderRadius:4}}/></div>
      </div>)}
    </div>
    <VisualSystemV1AiWatermark profile="approved-v013-stable-footprint" motionCadence="continuous"/>
  </AbsoluteFill>;
}
export function ExplainerRevisionRoot(){
  return <Composition id="ExplainerRevision" component={ExplainerRevision} width={1920} height={1080} fps={30} durationInFrames={4500}
    calculateMetadata={({props})=>({durationInFrames:props.timing.durationInFrames})}/>;
}
