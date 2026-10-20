import React from 'react';
import {clamp} from '../explainer-revision/model.mjs';
import {FULL_SEMANTIC_SCENE_IDS} from './model.mjs';
import {Text,Glass,Arrow,Note,Topic,Query,Input,Answer,Records,WriteTimeline} from '../explainer-revision/root.jsx';

export const SEMANTIC_SCENES=new Set(FULL_SEMANTIC_SCENE_IDS);
const C={ink:'#14211D',muted:'#53685E',accent:'#17795D',warning:'#91613F'};

// Sentence boundaries come from measured PCM. These bounded intra-sentence
// phases are editorial motion, not claims of word-level forced alignment.
export function semanticSceneState({scene,current,frame}){
  if(!Number.isFinite(frame)||!Number.isInteger(current.startFrame)||!Number.isInteger(current.endFrame)||current.endFrame<=current.startFrame)throw new Error('Invalid semantic timing');
  // IDs identify records; they do not encode editorial timing. The validated
  // scene order is the phase contract, so renaming a segment cannot retime it.
  const n=Array.isArray(scene.segments)?scene.segments.findIndex(segment=>segment.id===current.id)+1:0;
  if(n<1||scene.segments.filter(segment=>segment.id===current.id).length!==1)throw new Error('Invalid semantic segment');
  const p=clamp((frame-current.startFrame)/(current.endFrame-current.startFrame));
  const state={n,p};
  if(scene.id==='F18'){
    state.memoryTransfer=n<2?0:n>2?1:clamp(p/0.72);
    state.memoryArrived=state.memoryTransfer===1;
    state.otherInputs=n>=3;
  }
  if(scene.id==='F26'){
    state.queryProgress=n<2?0:n>2?1:p;
    state.showPolicy=n>=4;
  }
  if(scene.id==='F28')state.compressionProgress=n===1?p*0.36:n===2?0.38+p*0.30:1;
  if(scene.id==='F29')state.answerVisual=n===1?'answer-fact':n===2?'answer-limit':'answer-next';
  if(scene.id==='F30')state.recordLongTerm=n>=2;
  if(scene.id==='F32')state.writeSteps={syncStep:n===1?0:n===2?1:n===3?(p<0.25?1:p<0.7?2:3):3,asyncStep:0};
  if(scene.id==='F33')state.writeSteps={syncStep:3,asyncStep:n===1?0:n===2?1:n===3?2:n===4?(p<0.65?2:3):3};
  if(scene.id==='F41'){
    state.fallback=n>=3;
    state.memoryFailed=n>=4||(n===3&&p>=0.26);
    state.businessMissing=n>=5;
    state.businessProgress=n<4||n>=5?0:clamp(p/0.7);
    state.businessReady=n===4&&state.businessProgress===1;
  }
  return state;
}

function ContextConcept({n}){
  return <>
    <Glass x={120} y={340} w={540} h={355} emphasis>
      <Text x={36} y={35} w={468} size={40} weight={550}>本轮要解决的任务</Text>
      <Text x={36} y={130} w={468} size={34}>这笔订单能退吗？</Text>
      <Text x={36} y={237} w={468} size={29} color={C.muted}>先确定这一轮需要什么</Text>
    </Glass>
    {n>=2&&<>
      <Arrow points={[[672,518],[830,518]]}/>
      <Text x={680} y={421} w={144} size={27} color={C.accent} style={{textAlign:'center'}}>选择与组织</Text>
      <Glass x={845} y={340} w={945} h={355} emphasis>
        <Text x={38} y={32} w={869} size={39} weight={550}>本轮模型输入</Text>
        <Text x={38} y={135} w={869} size={35}>任务 + 规则 + 资料 + 工具结果</Text>
        <Text x={38} y={248} w={869} size={29} color={C.muted}>不是把整个运行环境都塞进来</Text>
      </Glass>
    </>}
    <Note>{n>=3?'上下文窗口限制容量；容量大，不代表信息选得对。':'上下文不只等于聊天记录，而是这一次判断所需的信息。'}</Note>
  </>;
}

function MemoryRead({memoryTransfer,memoryArrived,otherInputs}){
  return <>
    <Glass x={120} y={325} w={540} h={418} emphasis>
      <Text x={36} y={30} w={468} size={40} weight={550}>外部记忆库</Text>
      <Text x={36} y={133} w={468} size={34}>{'用户明确允许保留\n偏好：简短中文'}</Text>
      <Text x={36} y={325} w={468} size={28} color={C.muted}>原记录始终保留在库中</Text>
    </Glass>
    <Arrow points={[[672,523],[833,523]]} progress={memoryTransfer}/>
    <Text x={675} y={430} w={156} size={25} color={C.accent} style={{textAlign:'center'}}>{memoryTransfer===0?'尚未读取':'授权与\n相关性检查'}</Text>
    {memoryTransfer>0&&memoryTransfer<1&&<div aria-hidden style={{position:'absolute',left:672+147*memoryTransfer,top:512,width:22,height:22,border:'2px solid #17795D',borderRadius:4,background:'#D4EBDD'}}/>}
    <Glass x={845} y={325} w={945} h={418} emphasis={memoryArrived}>
      <Text x={38} y={30} w={869} size={40} weight={550}>本轮上下文</Text>
      <div style={{position:'absolute',left:0,right:0,top:98,borderTop:'2px solid #A3C5B5'}}/>
      <Text x={38} y={137} w={869} size={34} color={memoryArrived?C.accent:C.muted}>{memoryArrived?'获准读取的偏好副本：简短中文':'已保存，不等于本轮已经读取'}</Text>
      {otherInputs&&<Text x={38} y={230} w={869} size={33}>＋ 规则、会话、资料与新工具结果</Text>}
      <Text x={38} y={337} w={869} size={28} color={C.muted}>当前输入不是整个永久记忆库</Text>
    </Glass>
    <Note>记忆只是来源之一；副本通过授权读取后，才进入本轮输入。</Note>
  </>;
}

function FallbackBranches({memoryFailed,businessProgress,businessReady,businessMissing}){
  return <>
    <Text x={120} y={272} size={28} color={C.accent}>待执行用例 · 记忆支路故障，不扩大业务访问权限</Text>
    <Glass x={120} y={350} w={816} h={332}>
      <Text x={36} y={30} w={744} size={40} weight={550}>记忆服务</Text>
      <Text x={36} y={122} w={744} size={38} color={C.warning}>{memoryFailed?'不可用':'模拟读取中'}</Text>
      <Text x={36} y={238} w={744} size={30}>不编造偏好，不把故障说成“没有历史”</Text>
    </Glass>
    <Glass x={976} y={350} w={816} h={332} emphasis={!businessMissing}>
      <Text x={36} y={30} w={744} size={40} weight={550}>订单与政策证据</Text>
      <Text x={36} y={122} w={744} size={36} color={businessMissing?C.warning:C.accent}>{businessMissing?'必要依据也缺失':'继续遵守原有授权范围'}</Text>
      <Text x={36} y={238} w={744} size={30}>{businessMissing?'不拿缺失的材料支撑确定结论':'只有本轮有效查询，才能作为依据'}</Text>
    </Glass>
    <svg aria-hidden style={{position:'absolute',inset:0,width:1920,height:1080}}>
      {memoryFailed&&<path d="M 528 682 V 707 M 516 707 H 540" fill="none" stroke={C.warning} strokeWidth={3}/>}
      {businessMissing&&<path d="M 1384 682 V 707 M 1372 707 H 1396" fill="none" stroke={C.warning} strokeWidth={3}/>}
    </svg>
    {!businessMissing&&<Arrow points={[[1384,682],[1384,717]]} progress={businessProgress}/>}
    <Text x={120} y={734} w={816} size={30} color={C.warning}>{memoryFailed?'记忆支路停止，不提供偏好':'等待故障返回'}</Text>
    <Text x={976} y={734} w={816} size={30} color={businessMissing?C.warning:C.accent}>{businessMissing?'追问，或停止下结论':businessReady?'有效证据可用于本轮答复':'继续核对本轮有效证据'}</Text>
    <Note y={831}>核对调用是否守住范围，再核对答复依据；不是测试已经通过。</Note>
  </>;
}

// Deliberately hook-free so the caller can fall back when this returns null.
export function SemanticScene({scene,current,frame}){
  if(!SEMANTIC_SCENES.has(scene.id))return null;
  const state=semanticSceneState({scene,current,frame});
  if(scene.id==='F01')return <Topic/>;
  if(scene.id==='F03')return <ContextConcept n={state.n}/>;
  if(scene.id==='F18')return <MemoryRead {...state}/>;
  if(scene.id==='F26')return <>
    <Query lineProgress={state.queryProgress} currentNote={state.showPolicy?'演示政策 P3：转售后审核':'采用本轮查询状态'}
      note={state.showPolicy?'演示政策 P3：已发货需售后审核，不保证取消成功。':'新结果到达后才替换过期依据；旧快照保留为历史。'}/>
  </>;
  if(scene.id==='F28')return <Input compression boundedHeaders lineProgress={state.compressionProgress}/>;
  if(scene.id==='F29')return <Answer visual={state.answerVisual}/>;
  if(scene.id==='F30')return <Records longTerm={state.recordLongTerm} showLongTerm={state.recordLongTerm}/>;
  if(scene.id==='F32'||scene.id==='F33')return <WriteTimeline visual="write-compare" lineProgress={state.p} stateOverride={state.writeSteps}
    requestText="同一个请求：“以后请更简短，并保存为长期偏好。”"/>;
  if(scene.id==='F41'&&state.fallback)return <FallbackBranches {...state}/>;
  return null;
}
