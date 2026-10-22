import {chapterProgress} from '../explainer-revision/model.mjs';

// Labels are a readable chapter directory, not a scale for elapsed time. Only
// the separate track is duration weighted. Keep the existing 20px type size.
export const FULL_CHAPTER_NAVIGATION=Object.freeze({
  version:'independent-labels-duration-timeline-v2',width:1920,height:1080,
  left:108,right:1812,labelTop:991,labelHeight:58,labelGap:24,
  fontSize:20,lineHeight:29,trackTop:1057,trackHeight:5,boundaryHeight:9,minimumGap:8
});

export function fullChapterNavigation(chapters,frame){
  if(!Array.isArray(chapters)||chapters.length!==4||!Number.isSafeInteger(frame)||frame<0){
    throw new Error('full-chapter-navigation-invalid');
  }
  const ids=new Set();let end=0;
  for(const chapter of chapters){
    if(typeof chapter.id!=='string'||!chapter.id||ids.has(chapter.id)
      ||typeof chapter.label!=='string'||!chapter.label.trim()||[...chapter.label].length>40
      ||/[\p{Cc}]/u.test(chapter.label)||chapter.startFrame!==end
      ||!Number.isSafeInteger(chapter.endFrame)||chapter.endFrame<=end){
      throw new Error('full-chapter-navigation-invalid');
    }
    ids.add(chapter.id);end=chapter.endFrame;
  }
  if(frame>end)throw new Error('full-chapter-navigation-invalid');
  const p=FULL_CHAPTER_NAVIGATION,w=(p.right-p.left-(chapters.length-1)*p.labelGap)/chapters.length;
  const currentId=(chapters.find(c=>frame<c.endFrame)??chapters.at(-1)).id;
  let x=p.left;
  const tracks=chapterProgress(chapters,frame).map(c=>{const width=c.widthFraction*(p.right-p.left);
    const track={...c,x,w:width};x+=width;return track;});
  return {currentId,labels:chapters.map((c,i)=>({id:c.id,label:c.label,x:p.left+i*(w+p.labelGap),
    y:p.labelTop,w,h:p.labelHeight,current:c.id===currentId})),tracks};
}
