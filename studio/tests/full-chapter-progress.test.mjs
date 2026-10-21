import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fullChapterNavigation,FULL_CHAPTER_NAVIGATION as P} from '../src/video/explainer-full-revision/chapter-progress.mjs';
import {fullChapterBrowserFixtures as fixtures} from './helpers/full-chapter-browser-fixture-data.mjs';

test('full chapter labels are independent from duration-weighted tracks and never forced to nowrap',async()=>{
  const root=await readFile(new URL('../src/video/explainer-full-revision/root.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(root,/data-chapter-label[^\n]*whiteSpace:'nowrap'/u,
    'a short chapter must not force its complete label into a narrow single line');
});

test('readable label slots are independent of duration but track widths and fill retain actual elapsed time',()=>{
  for(const fixture of Object.values(fixtures))for(const frame of fixture.frames){
    const original=structuredClone(fixture.chapters),layout=fullChapterNavigation(fixture.chapters,frame);
    assert.deepEqual(fixture.chapters,original);
    assert.equal(layout.currentId,fixture.chapters.find(c=>frame<c.endFrame).id);
    assert.equal(new Set(layout.labels.map(label=>label.w)).size,1);
    for(const [i,label] of layout.labels.entries()){
      assert.equal(label.label,fixture.chapters[i].label);assert.equal(label.w,408);
      assert.equal(label.y,P.labelTop);assert.equal(label.h,58);
      if(i)assert.ok(label.x>=layout.labels[i-1].x+layout.labels[i-1].w+24);
    }
    const total=fixture.chapters.at(-1).endFrame;
    for(const [i,track] of layout.tracks.entries()){
      const chapter=fixture.chapters[i];assert.ok(Math.abs(track.w/1704-(chapter.endFrame-chapter.startFrame)/total)<1e-12);
      assert.ok(Math.abs(track.x-(108+chapter.startFrame/total*1704))<1e-10);
      if(i)assert.ok(Math.abs(track.x-layout.tracks[i-1].x-layout.tracks[i-1].w)<1e-10);
      assert.equal(track.amount,Math.max(0,Math.min(1,(frame-chapter.startFrame)/(chapter.endFrame-chapter.startFrame))));
    }
  }
});

test('invalid chapter identity/order/text and out-of-range frames fail before markup',()=>{
  for(const mutate of [c=>c.pop(),c=>c[1].id=c[0].id,c=>c[2].startFrame++,c=>c[0].label='',
    c=>c[0].label='中'.repeat(41),c=>c[0].label='two\nlines',c=>c[0].endFrame=0]){
    const chapters=structuredClone(fixtures.typical.chapters);mutate(chapters);
    assert.throws(()=>fullChapterNavigation(chapters,0));
  }
  for(const frame of [-1,NaN,Infinity,1.5,10801])assert.throws(()=>fullChapterNavigation(fixtures.typical.chapters,frame));
});

test('complete label markup preserves 40 characters and never clips, ellipsizes or shrinks them',async()=>{
  const entry=fileURLToPath(new URL('../src/video/explainer-full-revision/chapter-progress.jsx',import.meta.url));
  const built=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',packages:'external'});
  const module={exports:{}};
  vm.runInThisContext(`(function(module,exports,require){\n${built.outputFiles[0].text}\n})`)(module,module.exports,createRequire(entry));
  for(const fixture of Object.values(fixtures)){
    const html=renderToStaticMarkup(React.createElement(module.exports.FullChapterProgress,{chapters:fixture.chapters,frame:fixture.frames[3]}));
    assert.equal((html.match(/data-chapter-label-slot=/gu)??[]).length,4);
    assert.equal((html.match(/aria-current="step"/gu)??[]).length,1);
    assert.equal((html.match(/data-chapter-boundary=/gu)??[]).length,3);
    assert.equal((html.match(/data-chapter-timeline=/gu)??[]).length,1);
    assert.equal((html.match(/font-size:20px/gu)??[]).length,4);
    assert.doesNotMatch(html,/text-overflow|overflow:(?:hidden|clip)|white-space:nowrap|scale\(/u);
    for(const chapter of fixture.chapters)assert.ok(html.includes(chapter.label));
  }
});

test('every rendered full frame runs both card and chapter guards after fonts are ready',async()=>{
  const [root,guard]=await Promise.all(['root.jsx','text-fit-guard.jsx'].map(file=>readFile(new URL(`../src/video/explainer-full-revision/${file}`,import.meta.url),'utf8')));
  assert.match(root,/<FullTextFitGuard[^\n]+checkChapterProgress/u);
  assert.match(root,/<Text domRole="caption" x=\{120\} y=\{928\}/u);
  assert.match(guard,/document\.fonts\.ready/u);assert.match(guard,/if\(checkChapterProgress\)assertFullChapterDomFit\(contentRef.current\)/u);
});
