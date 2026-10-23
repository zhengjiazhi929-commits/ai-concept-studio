import React from 'react';

// Standalone objects, never badges before card copy. All silhouette bounds fit
// the reserved 170px drawing area; copy is laid out below by the render model.
export function EditorialIllustrationShape({object,stroke,fill}) {
  const x=object.width/2-120,y=12;
  const selected=object.variant==='selected';
  return <svg aria-hidden="true" data-editorial-shape={object.illustration} width={object.width} height={180}
    viewBox={`0 0 ${object.width} 180`} style={{position:'absolute',left:0,top:0}}>
    <g transform={`translate(${x} ${y})`} fill={fill} stroke={stroke} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round">
      {object.illustration==='processor' && <>
        <rect x={40} y={22} width={160} height={112} rx={20}/>
        <rect x={79} y={48} width={82} height={60} rx={8} fill={object.focus||object.variant==='working'?'#C5EAD9':'#FCFEFD'}/>
        {[57,99].map(v=><React.Fragment key={v}><path d={`M 15 ${v} H 40 M 200 ${v} H 225`}/></React.Fragment>)}
      </>}
      {object.illustration==='gate' && <>
        <path d="M 30 144 H 210"/>
        <rect x={48} y={50} width={24} height={94} rx={5}/>
        <rect x={168} y={50} width={24} height={94} rx={5}/>
        {/* Pending is an undecided checkpoint, not an already closed gate.
            Open is vertical; never a diagonal arm or a completion tick. */}
        {object.variant==='neutral'
          ? <path data-editorial-gate-pending="true" d="M 120 28 V 132" fill="none" strokeDasharray="5 7"/>
          : <rect x={58} y={object.variant==='open'?8:60} width={object.variant==='open'?10:118} height={object.variant==='open'?72:12} rx={4}
            fill={stroke}/>}
      </>}
      {object.illustration==='archive' && <>
        <rect x={55} y={15} width={125} height={103} rx={8} fill="#FCFEFD"/>
        <rect x={70} y={27} width={125} height={99} rx={8} fill={selected?'#D0EDE0':'#FCFEFD'}/>
        <path d="M 90 49 H 167 M 90 66 H 151"/>
        {/* Tray front is after pages: paper is actually inside, not floating. */}
        <path d="M 25 79 H 66 L 76 98 H 164 L 174 79 H 215 V 143 H 25 Z"/>
        <path d="M 97 120 H 143"/>
      </>}
      {object.illustration==='monitor' && !['five','twenty'].includes(object.variant) && <>
        <rect x={25} y={12} width={190} height={118} rx={10}/>
        <rect x={36} y={24} width={168} height={89} rx={4} fill="#FCFEFD"/>
        <path d="M 120 130 V 151 M 80 153 H 160"/>
      </>}
      {object.illustration==='monitor' && ['five','twenty'].includes(object.variant) &&
        Array.from({length:object.variant==='twenty'?20:5},(_,i)=><g key={i} data-editorial-monitor-unit={i+1}
          transform={`translate(${i%5*48} ${Math.floor(i/5)*38+4})`}>
          <rect x={3} y={2} width={36} height={24} rx={3} fill="#FCFEFD" strokeWidth={2}/>
          <path d="M 21 26 V 32 M 12 33 H 30" strokeWidth={2}/>
        </g>)}
      {object.illustration==='parcel' && <>
        <rect x={35} y={24} width={170} height={122} rx={10}/>
        <path d="M 35 55 H 205 M 108 24 V 146 M 132 24 V 146"/>
        <path d="M 58 114 H 86 M 58 126 H 77"/>
      </>}
      {object.illustration==='deadline' && <>
        <path d="M 20 101 H 220 M 140 48 V 137" fill="none"/>
        {[20,60,100,180,220].map(v=><path key={v} d={`M ${v} 95 V 108`}/>)}
        {object.variant==='over' && <circle cx={195} cy={101} r={10} fill={stroke}/>}
      </>}
      {object.illustration==='modules' && <>
        {object.variant==='combined' && <rect x={15} y={12} width={210} height={132} rx={16} fill="none"/>}
        {[30,100,170].map((v,i)=><rect key={v} x={v} y={object.variant==='separate'?34+i*12:52} width={40} height={55} rx={8}/>)}
      </>}
      {object.illustration==='trace' && <>
        <path d="M 40 38 H 120 V 116 H 200" fill="none"/>
        {[{x:18,y:18},{x:98,y:55},{x:178,y:96}].map((p,i)=><rect key={i} {...p} width={44} height={40} rx={7}
          fill={selected&&i===1?stroke:'#FCFEFD'}/>)}
      </>}
      {object.illustration==='meter' && <>
        <rect x={20} y={58} width={200} height={38} rx={7} fill="#FCFEFD"/>
        <rect x={25} y={63} width={object.variant==='over'?185:object.variant==='within'?130:65} height={28} rx={4}
          fill={object.variant==='over'?'#CF8A58':'#67B293'} stroke="none"/>
        <path d="M 180 38 V 116"/>
      </>}
    </g>
  </svg>;
}
