// Generic-card-only: checks the rectangles of data-full-* text, not legacy
// SemanticScene drawings, glyph ink, arrows, scene-global text or visual taste.
// Run after fonts.ready and before releasing every frame. Failure asks for a
// new layout, never clipping; structural estimates alone cannot certify a font.
export function assertFullCardDomFit(root){
  if(!root)throw new Error('full-card-dom-missing');
  const tolerance=1;
  for(const card of root.querySelectorAll('[data-full-card]')){
    const bounds=card.getBoundingClientRect();
    const text=[...card.querySelectorAll('[data-full-text]')].filter(node=>node.textContent.trim());
    const rects=text.map(node=>node.getBoundingClientRect());
    if(rects.some(r=>r.left<bounds.left-tolerance||r.right>bounds.right+tolerance
      ||r.top<bounds.top-tolerance||r.bottom>bounds.bottom+tolerance)){
      throw new Error('full-card-dom-text-overflow: widen or split the scene before rendering');
    }
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
      const a=rects[i],b=rects[j];
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>tolerance
        &&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>tolerance){
        throw new Error('full-card-dom-text-overlap: reflow the scene before rendering');
      }
    }
  }
}
