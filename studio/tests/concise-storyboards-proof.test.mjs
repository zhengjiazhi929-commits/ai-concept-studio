import test from 'node:test';
import assert from 'node:assert/strict';
import {integrityHash} from '../src/shared/integrity.mjs';
import {CONCISE_BOARDS} from '../src/video/concise-storyboards/plan.mjs';
import {assertConciseComposition,buildConciseManifest,buildConciseGallery} from '../scripts/render-concise-storyboard-proof.mjs';

function fixture(){
  const files=[{path:'synthetic.mjs',bytes:12,sha256:integrityHash('source')},
    {path:'studio/src/shared/screen-editorial-policy.mjs',bytes:12,sha256:integrityHash('policy')}];
  return {source:{gitHead:'a'.repeat(40),files,visualSourceHash:integrityHash(files)},runtime:{node:'fixture'},generatedAt:'2026-10-14T00:00:00Z',
    stills:CONCISE_BOARDS.flatMap(board=>[0,1,2].map(frame=>({id:board.id,compositionId:board.compositionId,frame,path:`${board.id}-${frame}.png`,
      bytes:100,sha256:integrityHash(`${board.id}/${frame}`),pixels:{width:1920,height:1080,pixelSha256:integrityHash(`pixels/${board.id}/${frame}`)},
      watermark:{presencePassed:true,mintPixels:900,minimumMintPixels:504}})))};
}
test('concise proof binds exactly nine stills and cannot claim approval, video or real business data',()=>{
  const manifest=buildConciseManifest(fixture());
  assert.equal(manifest.stills.length,9);assert.equal(manifest.caseData,'authored-synthetic-teaching-case');
  for(const key of ['userAccepted','productionApproved','finalAccepted','videoGenerated','formalEpisodeStateTouched','authorizesPublication'])assert.equal(manifest[key],false);
  const {candidateHash,...payload}=manifest;assert.equal(candidateHash,integrityHash(payload));
});
test('missing or tampered PNG, logo, composition and source evidence fails closed',()=>{
  for(const mutate of [x=>x.stills.pop(),x=>x.stills.reverse(),x=>x.stills[0].compositionId='wrong',x=>x.stills[0].pixels.width=960,
    x=>x.source.visualSourceHash='b'.repeat(64),x=>delete x.stills[0].watermark,x=>x.stills[1].sha256=x.stills[0].sha256,
    x=>{x.source.files.pop();x.source.visualSourceHash=integrityHash(x.source.files);}]){
    const f=fixture();mutate(f);assert.throws(()=>buildConciseManifest(f));
  }
  const good={id:CONCISE_BOARDS[0].compositionId,width:1920,height:1080,fps:30,durationInFrames:3};
  assert.doesNotThrow(()=>assertConciseComposition(good,good.id));
  assert.throws(()=>assertConciseComposition({...good,durationInFrames:90},good.id));
});
test('gallery carries explanations and synthetic-case boundaries outside nine image surfaces',()=>{
  const html=buildConciseGallery(buildConciseManifest(fixture()));
  assert.equal((html.match(/<figure /gu)??[]).length,9);
  for(const board of CONCISE_BOARDS)for(const phase of board.phases)assert.ok(html.includes(phase.explanation));
  assert.match(html,/虚构教学案例/u);assert.match(html,/未生成视频/u);assert.doesNotMatch(html,/<video|https?:\/\//u);
});
