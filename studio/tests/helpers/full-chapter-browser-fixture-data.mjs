// Synthetic typography/timing cases, independent of any Episode or voice file.
const ids=['concept','types','relationship','practice'];
const short=['01 · 概念','02 · 类型','03 · 关系','04 · 实践'];
const detailed=['01 · 什么是上下文工程','02 · Agent 记忆有哪些类型','03 · 上下文工程与记忆的关系','04 · 真实项目中的落地做法'];
function fixture(durations,labels){
  let cursor=0;
  const chapters=durations.map((duration,i)=>{const startFrame=cursor;cursor+=duration;
    return {id:ids[i],label:labels[i],startFrame,endFrame:cursor};});
  const frames=[...new Set([0,...chapters.slice(1).flatMap(c=>[c.startFrame-1,c.startFrame,c.startFrame+1]),cursor-1])]
    .filter(frame=>frame>=0&&frame<cursor).sort((a,b)=>a-b);
  return {chapters,frames};
}
export const fullChapterBrowserFixtures=Object.freeze({
  typical:fixture([2700,2700,2700,2700],short),
  unequal:fixture([3600,3600,1800,10800],detailed),
  tiny:fixture([12,12,12,19764],detailed),
  tinyEnd:fixture([19797,1,1,1],detailed),
  chinese40:fixture([3600,3600,1800,10800],['章','节','中','文'].map(c=>c.repeat(40))),
  english40:fixture([3600,3600,1800,10800],['W','M','W','M'].map(c=>c.repeat(40)))
});
