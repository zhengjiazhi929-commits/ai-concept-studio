import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CONCISE_BOARDS,conciseStoryboardState,assertConciseEditorialPlan} from '../src/video/concise-storyboards/plan.mjs';
const entry=fileURLToPath(new URL('../src/video/concise-storyboards/artwork.jsx',import.meta.url));
const compiled=await build({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',packages:'external'});
const module={exports:{}};
vm.runInThisContext(`(function(module,exports,require){\n${compiled.outputFiles[0].text}\n})`)(module,module.exports,createRequire(entry));
test('all actual screen text is same-source visible-label data checked by editorial policy',()=>{
  assert.equal(assertConciseEditorialPlan().checks.length,3);
  for(const board of CONCISE_BOARDS)for(const phase of [0,1,2]){
    const markup=renderToStaticMarkup(React.createElement(module.exports.ConciseArtwork,{id:board.id,phase}));
    const actual=[...markup.matchAll(/<text\b[^>]*>([^<]*)<\/text>/gu)].map(match=>match[1]).sort();
    const expected=conciseStoryboardState(board.id,phase).visibleLabels.map(item=>item.text).sort();
    assert.deepEqual(actual,expected);assert.doesNotMatch(markup,/<p\b|<foreignObject\b|<image\b/u);
    assert.ok(markup.includes('data-concise-scene='));
    assert.doesNotMatch(markup,/✓|✔|clipPath|text-overflow|font-weight="[7-9]00"/u);
    for(const [,tag] of markup.matchAll(/<text\b([^>]*)>/gu))assert.match(tag,/stroke="none"/u);
  }
});
test('rendered objects preserve sources, hide future results, and use complete window outlines',()=>{
  const render=(id,phase)=>renderToStaticMarkup(React.createElement(module.exports.ConciseArtwork,{id,phase}));
  for(const phase of [0,1,2]){
    assert.match(render('context',phase),/data-concise-source="rules"/u);
    assert.match(render('context',phase),/data-concise-window-outline="complete"/u);
    assert.match(render('memory',phase),/data-concise-source="retained-memory"/u);
    assert.equal(render('memory',phase).includes('data-concise-memory-copy='),phase>0);
    assert.match(render('order',phase),/data-concise-source="historical-snapshot"/u);
    assert.equal(render('order',phase).includes('已发货'),phase===2);
  }
});
test('static root keeps the existing local font, top watermark and decode readiness in every pose',async()=>{
  const [root,index]=await Promise.all([readFile(new URL('../src/video/concise-storyboards/root.jsx',import.meta.url),'utf8'),
    readFile(new URL('../src/video/concise-storyboards/index.jsx',import.meta.url),'utf8')]);
  assert.match(index,/import '\.\.\/load-video-fonts\.jsx'/u);
  assert.match(root,/profile="approved-v013-stable-footprint"/u);assert.match(root,/motionCadence="continuous"/u);
  assert.match(root,/<StoryboardAssetsReady key=/u);assert.equal((root.match(/durationInFrames=\{3\}/gu)??[]).length,3);
  assert.doesNotMatch(root,/Math\.random|Date\.now|setInterval|setTimeout|animation:|transition:|<p\b/u);
});
test('memory copy remains a folded document before and after arrival',()=>{
  for(const phase of [1,2]){
    const markup=renderToStaticMarkup(React.createElement(module.exports.ConciseArtwork,{id:'memory',phase}));
    assert.match(markup,/data-concise-memory-copy="(?:arrived|in-transit)"><g[^>]*data-illustration-object="document"/u);
  }
});
