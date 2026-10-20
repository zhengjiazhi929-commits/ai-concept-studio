import test from 'node:test';
import assert from 'node:assert/strict';
import {assertFullReviewMedia, fullReviewConcatList, validateFullReviewCheckpoint} from '../src/server/production/editorial-full-review-runtime.mjs';
const hash='a'.repeat(64);
const segment={id:'segment-01',fromFrame:0,toFrameExclusive:900,frameCount:900};
function probe(audio=false){return {streams:[{codec_type:'video',codec_name:'h264',profile:'High',level:40,codec_tag_string:'avc1',width:1920,height:1080,pix_fmt:'yuv420p',r_frame_rate:'30/1',avg_frame_rate:'30/1',time_base:'1/15360',start_time:'0.000000',nb_read_frames:'900',duration:'30.000000',extradata_hash:`SHA256:${hash}`},...(audio?[{codec_type:'audio',codec_name:'aac',sample_rate:'24000',channels:1,start_time:'0.000000',duration:'30.000000'}]:[])]};}
test('silent and final media contracts enforce exact native frame count and track count',()=>{
  assertFullReviewMedia(probe(),900);assertFullReviewMedia(probe(true),900,{audio:true});
  for(const alter of [p=>p.streams.push({...p.streams[0]}),p=>p.streams[0].nb_read_frames='899',p=>p.streams[0].start_time='0.03',p=>p.streams[0].pix_fmt='yuv444p',p=>p.streams[0].r_frame_rate='24/1',p=>p.streams[0].duration='29']){const p=probe();alter(p);assert.throws(()=>assertFullReviewMedia(p,900));}
});
test('audio contract rejects stereo, shifted and truncated narration',()=>{
  for(const alter of [p=>p.streams[1].channels=2,p=>p.streams[1].sample_rate='48000',p=>p.streams[1].start_time='0.1',p=>p.streams[1].duration='29.5']){const p=probe(true);alter(p);assert.throws(()=>assertFullReviewMedia(p,900,{audio:true}));}
});
test('video codec signature must match for no-reencode concatenation',()=>{
  const sig=assertFullReviewMedia(probe(),900);const p=probe();p.streams[0].extradata_hash=`SHA256:${'b'.repeat(64)}`;
  assert.throws(()=>assertFullReviewMedia(p,900,{signature:sig}));
});
test('concat list only accepts local generated filenames, not shell or protocol paths',()=>{
  const good='segment-01.12345678-1234-1234-1234-123456789abc.mp4';
  assert.equal(fullReviewConcatList([good]),`file '${good}'\n`);
  for(const bad of ['../x.mp4','/tmp/x.mp4','https://host/x.mp4',"x'\nfile y.mp4",'segment-01.mp4'])assert.throws(()=>fullReviewConcatList([bad]));
});
test('resume checkpoint is segment/request bound and cannot choose arbitrary output',()=>{
  const file={path:'segment-01.12345678-1234-1234-1234-123456789abc.mp4',bytes:100,sha256:hash};
  const c={schemaVersion:'editorial-full-review-segment-v1',requestHash:hash,segment,file,signature:assertFullReviewMedia(probe(),900),fullDecodePassed:true};
  assert.deepEqual(validateFullReviewCheckpoint(c,segment,hash),c);
  for(const alter of [v=>v.requestHash='b'.repeat(64),v=>v.segment.fromFrame=1,v=>v.file.path='../x.mp4',v=>v.file.path=v.file.path.replace('01.','02.'),v=>v.file.bytes=0,v=>v.fullDecodePassed=false,v=>v.extra=true]){const v=structuredClone(c);alter(v);assert.throws(()=>validateFullReviewCheckpoint(v,segment,hash));}
});
