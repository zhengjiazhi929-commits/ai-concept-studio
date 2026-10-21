import {FULL_CHAPTER_NAVIGATION as P} from './chapter-progress.mjs';

const fail=reason=>{throw new Error(`full-chapter-dom-${reason}: reflow complete labels before rendering`);};
const finiteRect=r=>r&&['left','right','top','bottom'].every(key=>Number.isFinite(r[key]))
  &&r.right>r.left&&r.bottom>r.top;
const within=(a,b,tolerance=0.5)=>a.left>=b.left-tolerance&&a.right<=b.right+tolerance
  &&a.top>=b.top-tolerance&&a.bottom<=b.bottom+tolerance;
const collides=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5
  &&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5;

// Range rectangles cover the real glyph lines, unlike the fixed-width text
// element box. Normalize a scaled Studio preview into composition coordinates.
export function assertFullChapterDomFit(root){
  const bounds=root?.getBoundingClientRect();
  if(!finiteRect(bounds))fail('missing-root');
  const sx=(bounds.right-bounds.left)/P.width,sy=(bounds.bottom-bounds.top)/P.height;
  if(Math.abs(sx-sy)>0.001)fail('nonuniform-scale');
  const normalize=r=>({left:(r.left-bounds.left)/sx,right:(r.right-bounds.left)/sx,
    top:(r.top-bounds.top)/sy,bottom:(r.bottom-bounds.top)/sy});
  const measure=node=>normalize(node.getBoundingClientRect());
  const nav=root.querySelector('[data-full-chapter-nav]');
  if(!nav||nav.getAttribute('data-full-chapter-nav')!==P.version)fail('missing-navigation');
  const slots=[...nav.querySelectorAll('[data-chapter-label-slot]')];
  const trackNodes=[...nav.querySelectorAll('[data-chapter-progress]')];
  if(slots.length!==4||trackNodes.length!==4)fail('missing-chapters');
  const labelArea={left:P.left,right:P.right,top:P.labelTop,bottom:P.labelTop+P.labelHeight};
  const trackArea={left:P.left,right:P.right,top:P.trackTop,bottom:P.trackTop+P.trackHeight};
  const labels=slots.map(slot=>{
    const node=slot.querySelector('[data-chapter-label]');
    if(!node?.textContent.trim())fail('missing-label');
    const range=root.ownerDocument.createRange();range.selectNodeContents(node);
    const lines=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(normalize);
    const box=measure(slot),textBox=measure(node);
    if(!lines.length||!finiteRect(box)||!within(box,labelArea)||!within(textBox,box)
      ||lines.some(r=>!finiteRect(r)||!within(r,box)))fail('text-overflow');
    const computed=root.ownerDocument.defaultView.getComputedStyle(node);
    if(parseFloat(computed.fontSize)!==P.fontSize||computed.textOverflow==='ellipsis'
      ||['hidden','clip'].includes(computed.overflowX)||['hidden','clip'].includes(computed.overflowY))fail('text-hidden');
    return {id:slot.getAttribute('data-chapter-label-slot'),text:node.textContent,box,lines};
  });
  if(new Set(labels.map(l=>l.id)).size!==4)fail('chapter-identity');
  const tracks=trackNodes.map((node,i)=>{
    const box=measure(node);
    if(node.getAttribute('data-chapter-progress')!==labels[i].id||!finiteRect(box)||!within(box,trackArea))fail('track-overflow');
    return {id:labels[i].id,box};
  });
  // Adjacent short chapters may have adjacent ticks. Never widen their time
  // spans to make a marker or label fit: that would falsify elapsed time.
  const boundaryNodes=[...nav.querySelectorAll('[data-chapter-boundary]')];
  if(boundaryNodes.length!==3)fail('missing-boundaries');
  const boundaries=boundaryNodes.map((node,i)=>{
    const box=measure(node),track=tracks[i+1];
    if(node.getAttribute('data-chapter-boundary')!==track.id||!finiteRect(box)
      ||!within(box,{...trackArea,bottom:P.trackTop+P.boundaryHeight})
      ||Math.abs((box.left+box.right)/2-track.box.left)>0.1)fail('boundary-overflow');
    return {id:track.id,box};
  });
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
    if(collides(labels[i].box,labels[j].box)||labels[i].lines.some(a=>labels[j].lines.some(b=>collides(a,b))))fail('label-overlap');
    if(collides(tracks[i].box,tracks[j].box))fail('track-overlap');
  }
  const caption=root.querySelector('[data-full-text-role="caption"]');
  if(!caption)fail('missing-caption-region');
  const captionBox=measure(caption);
  for(const label of labels)for(const line of label.lines){
    if(caption.textContent.trim()&&line.top-captionBox.bottom<P.minimumGap-0.5)fail('caption-overlap');
    if(tracks.some(track=>track.box.top-line.bottom<P.minimumGap-0.5))fail('track-label-overlap');
  }
  return {labels,tracks,boundaries};
}
