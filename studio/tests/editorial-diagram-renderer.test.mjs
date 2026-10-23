import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {validateEditorialMotionPlan, resolveEditorialMotionFrame} from '../src/shared/editorial-motion.mjs';
import {EDITORIAL_ILLUSTRATIONS} from '../src/shared/editorial-illustration-contract.mjs';
import {editorialMotionRendererFixture} from './editorial-motion-renderer-fixture.mjs';
import {editorialDiagramSmokeFixture} from './editorial-diagram-smoke-fixture.mjs';

// All scenes, words and timing below are synthetic. SSR/geometry is not pixel QA.
const entry = fileURLToPath(new URL('../src/video/editorial-motion-preview.jsx', import.meta.url));
const built = await build({entryPoints: [entry], bundle: true, write: false, format: 'cjs',
  platform: 'node', packages: 'external', logLevel: 'silent'});
const module = {exports: {}};
const require = createRequire(entry);
let frame = 0;
const rendererRequire = name => name === 'remotion' ? {
  AbsoluteFill: props => React.createElement('div', props), Img: 'img', staticFile: path => path,
  useCurrentFrame: () => frame, useVideoConfig: () => ({width: 1920, height: 1080, fps: 30, durationInFrames: 900})
} : require(name);
vm.runInThisContext(`(function(module,exports,require){\n${built.outputFiles[0].text}\n})`)(module, module.exports, rendererRequire);
const {buildEditorialMotionRenderModel: renderModel, compileEditorialMotionRenderEpisode: compile,
  EditorialMotionArtwork, EditorialMotionPreview, EditorialChapterNavigation} = module.exports;
const model = (episode, at) => renderModel(episode, at, 30);
const chapterError = error => error?.code === 'editorial_chapter_contract_invalid' || /chapter/u.test(error?.message ?? '');
const art = value => renderToStaticMarkup(React.createElement(EditorialMotionArtwork, {model: value}));
const markup = (episode, at) => {
  frame = at;
  return renderToStaticMarkup(React.createElement(EditorialMotionPreview, {episode}));
};
const object = (id, x, patch = {}) => ({id, kind: 'illustration', illustration: 'gate', label: '待确认',
  detail: '先核对条件', x, y: 390, width: 460, height: 390, scopeId: 'synthetic', sourceId: null,
  initiallyVisible: false, ...patch});
const event = (id, cue, atFrame, op, objectId, patch = {}) => ({id, cue, atFrame, durationFrames: 0,
  op, objectId, targetId: null, value: null, requires: [], ...patch});
const episodeFor = (objects, events = [], patch = {}) => ({id: 'synthetic-diagram-renderer',
  scenes: [{id: 'D01', title: '合成机制演示', narration: '展示入口。展示资料。建立关系。核对条件。隐藏资料。',
    startFrame: 0, endFrame: 150, motionPlan: {version: 'editorial-motion-v1',
      canvas: {width: 1920, height: 1080}, objects, events}}], subtitles: [], ...patch});
function diagramFixture(route = 'direct') {
  return episodeFor([object('gate', 180), object('archive', 1190, {illustration: 'archive', label: '来源记录', detail: ''})], [
    event('gate-in', '展示入口', 0, 'reveal', 'gate'),
    event('archive-in', '展示资料', 30, 'reveal', 'archive'),
    event('link', '建立关系', 40, 'connect', 'gate', {targetId: 'archive', durationFrames: 18, value: {route}}),
    event('conditions', '核对条件', 70, 'present', 'gate', {value: {label: '允许通过', detail: '仅演示条件变化', variant: 'open'}}),
    event('archive-out', '隐藏资料', 100, 'retire', 'archive')
  ]);
}

for (const illustration of Object.keys(EDITORIAL_ILLUSTRATIONS)) {
  test(`${illustration} renders as its own bounded figure above independent readable copy`, () => {
    const episode = episodeFor([object('figure', 600, {illustration, initiallyVisible: true})]);
    const value = model(episode, 0), item = value.objects[0], html = art(value);
    assert.match(html, new RegExp(`data-editorial-shape="${illustration}"`, 'u'));
    assert.match(html, /viewBox="0 0 460 180"/u);
    assert.ok(item.title.y >= 180);
    assert.ok(item.body.y >= item.title.y + item.title.height);
    assert.ok(item.body.y + item.body.height <= item.height - item.padding);
    assert.equal(item.title.fontSize, 44);
    assert.doesNotMatch(html, /data-card-icon|data-glass-card|<text\b|✓|✔|animation:|transition:/u);
  });
}

test('presentation changes no geometry or business state and future labels never appear before their cue', () => {
  const episode = diagramFixture(), plan = episode.scenes[0].motionPlan;
  const original = structuredClone(episode);
  const before = model(episode, 69).objects.find(item => item.id === 'gate');
  const after = model(episode, 70).objects.find(item => item.id === 'gate');
  assert.deepEqual([after.id, after.x, after.y, after.width, after.height], [before.id, before.x, before.y, before.width, before.height]);
  assert.deepEqual(resolveEditorialMotionFrame(plan, 69).objects[0].information,
    resolveEditorialMotionFrame(plan, 70).objects[0].information);
  assert.equal(after.title.text, '允许通过');
  assert.equal(after.status, 'idle'); assert.equal(after.checkStatus, null);
  assert.doesNotMatch(art(model(episode, 69)), /允许通过|仅演示条件变化/u);
  assert.match(art(model(episode, 70)), /允许通过/u);
  assert.equal(model(episode, 29).objects.some(item => item.id === 'archive'), false);
  assert.deepEqual(episode, original);
});

test('monitor quantity variants draw exactly five or twenty units without inventing a number label',()=>{
  for(const [variant,count] of [['five',5],['twenty',20]]){
    const episode=episodeFor([object('quantity',600,{illustration:'monitor',label:'',detail:'',initiallyVisible:true})],
      [event('quantity-cue','展示入口',30,'present','quantity',{value:{label:'',detail:'',variant}})]);
    assert.equal((art(model(episode,29)).match(/data-editorial-monitor-unit=/gu)??[]).length,0);
    const value=model(episode,30),html=art(value);
    assert.equal((html.match(/data-editorial-monitor-unit=/gu)??[]).length,count);
    assert.equal(value.objects[0].title.text,'');assert.equal(value.objects[0].stateText.text,'');
  }
});

test('authored illustration variants change the standalone drawing without adding completion symbols', () => {
  for (const [illustration, variant] of [['gate', 'open'], ['archive', 'selected'], ['modules', 'combined'],
    ['trace', 'selected'], ['meter', 'over']]) {
    const episode = diagramFixture();
    episode.scenes[0].motionPlan.objects[0].illustration = illustration;
    episode.scenes[0].motionPlan.events[3].value = {label: '待确认', detail: '先核对条件', variant};
    const figure = html => html.match(/<section\b[^>]*data-editorial-object-id="gate"[\s\S]*?<\/section>/u)?.[0];
    const before = figure(art(model(episode, 69))), after = figure(art(model(episode, 70)));
    assert.ok(before && after);
    assert.notEqual(after, before, illustration);
    assert.doesNotMatch(after, /✓|✔|data-card-icon/u);
    if (illustration === 'gate') assert.match(after, /x="58" y="8" width="10" height="72"/u);
  }
});

test('presented labels remain escaped text and geometry changes require an explicit bounded box', () => {
  const episode = diagramFixture();
  episode.scenes[0].motionPlan.events[3].value = {label: '<b>合成</b>', detail: '<script>0</script>', variant: 'open',
    box: {x: 200, y: 390, width: 500, height: 390}};
  const item = model(episode, 70).objects.find(value => value.id === 'gate');
  assert.deepEqual([item.x, item.y, item.width, item.height], [200, 390, 500, 390]);
  const html = art(model(episode, 70));
  assert.match(html, /&lt;b&gt;合成&lt;\/b&gt;/u);
  assert.match(html, /&lt;script&gt;0&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<b>|<script>|dangerouslySetInnerHTML/u);
  episode.scenes[0].motionPlan.events[3].value.box.x = 10;
  assert.throws(() => model(episode, 70));
});

for (const route of ['direct', 'return']) {
  test(`${route} relationship is frame-driven, orthogonal and cannot show its arrowhead before the shaft finishes`, () => {
    const episode = diagramFixture(route);
    assert.equal(model(episode, 39).connections.length, 0);
    const start = model(episode, 40), halfway = model(episode, 49), end = model(episode, 58);
    assert.equal(start.connections[0].progress, 0);
    assert.equal(halfway.connections[0].progress, 0.5);
    assert.equal(end.connections[0].progress, 1);
    assert.match(end.connections[0].path, /^M [\d.]+ [\d.]+(?: [HV] [\d.]+)+$/u);
    assert.equal(end.connections[0].direction, route === 'direct' ? 'right' : 'up');
    assert.match(art(halfway), /stroke-dashoffset="0.5"/u);
    assert.doesNotMatch(art(halfway), /data-editorial-arrowhead/u);
    assert.match(art(end), /data-editorial-arrowhead/u);
    assert.equal(model(episode, 100).connections.length, 0);
    assert.doesNotMatch(art(model(episode, 100)), /data-editorial-connection="link"/u);
  });
}

test('text cards never gain a prefix illustration, completion badge or missing boundary', () => {
  const card = {id: 'summary', kind: 'card', label: '边界归纳', detail: '图案单独展示', x: 120, y: 360,
    width: 650, height: 240, scopeId: 'synthetic', sourceId: null, initiallyVisible: true};
  const episode = episodeFor([card, object('figure', 1100, {illustration: 'processor', initiallyVisible: true})]);
  const html = art(model(episode, 0));
  const cardMarkup = html.match(/<section\b[^>]*data-editorial-object-id="summary"[\s\S]*?<\/section>/u)?.[0];
  assert.ok(cardMarkup);
  assert.match(cardMarkup, /data-glass-card="mint-frosted-thin-v001"/u);
  assert.match(cardMarkup, /border:1.5px solid rgba\(255,255,255,0.9\)/u);
  assert.doesNotMatch(cardMarkup, /<svg|data-editorial-shape|data-card-icon|✓|✔/u);
  assert.match(html, /data-editorial-shape="processor"/u);
});

function trayFixture() {
  const episode = editorialMotionRendererFixture();
  const plan = episode.scenes[0].motionPlan;
  Object.assign(plan.objects[0], {x: 160, y: 500, height: 320, containerId: 'tray'});
  Object.assign(plan.objects[2], {x: 160, y: 500, height: 320});
  plan.objects.unshift({id: 'tray', kind: 'tray', label: '原始资料', detail: '', x: 100, y: 310,
    width: 650, height: 560, scopeId: 'session-a', sourceId: null, initiallyVisible: true});
  plan.events[1].value.y = 500;
  return episode;
}

test('real copy leaves source paper in its tray, enters the window only on arrival and stays behind the tray front', () => {
  const episode = trayFixture();
  const before = model(episode, 19);
  assert.equal(before.objects.some(item => item.id === 'copy'), false);
  for (const at of [20, 40, 50, 59, 60, 90]) {
    const value = model(episode, at), source = value.objects.find(item => item.id === 'source');
    assert.deepEqual([source.x, source.y, source.body.text, source.containerId], [160, 500, '简短中文', 'tray']);
    assert.equal(source.stateText.text, '存储记录');
    const html = art(value);
    assert.ok(html.indexOf('data-editorial-object-id="tray"') < html.indexOf('data-editorial-object-id="source"'));
    assert.ok(html.indexOf('data-editorial-object-id="copy"') < html.indexOf('data-editorial-tray-front="tray"'));
    assert.match(html, /data-editorial-shape="tray"/u);
    assert.match(html, /data-editorial-tray-front="tray"[^>]*height="64"/u);
  }
  assert.equal(model(episode, 59).objects.find(item => item.id === 'copy').containerId, null);
  assert.equal(model(episode, 60).objects.find(item => item.id === 'copy').containerId, 'input');
  assert.equal(model(episode, 60).objects.find(item => item.id === 'copy').stateText.text, '已纳入本轮');
  assert.equal(model(episode, 90).objects.find(item => item.id === 'copy').body.text, '本次英文');
});

test('tray front cannot cover source text and cannot be bypassed by clipping', () => {
  const episode = trayFixture();
  Object.assign(episode.scenes[0].motionPlan.objects.find(item => item.id === 'source'), {y: 625, height: 220});
  Object.assign(episode.scenes[0].motionPlan.objects.find(item => item.id === 'copy'), {y: 625, height: 220});
  episode.scenes[0].motionPlan.events = [];
  assert.throws(() => model(episode, 0), /tray-front-text-overlap|text-overflow/u);
  assert.doesNotMatch(art(model(trayFixture(), 60)), /clipPath|text-overflow|overflow:hidden/u);
});

function regionFixture(connect = false) {
  const base = {scopeId: 'synthetic', sourceId: null, initiallyVisible: true, detail: ''};
  const objects = [
    {id: 'outer', kind: 'region', label: '运行环境', x: 120, y: 310, width: 1680, height: 560, ...base},
    {id: 'inner', kind: 'region', label: '业务流程', x: 180, y: 430, width: 900, height: 400, regionId: 'outer', ...base},
    {id: 'node', kind: 'label', label: '审批环节', x: 220, y: 550, width: 480, height: 140, regionId: 'inner', ...base},
    {id: 'result', kind: 'label', label: '结果核对', x: 1220, y: 550, width: 420, height: 140, regionId: 'outer', ...base}
  ];
  return episodeFor(objects, connect ? [event('region-link', '建立关系', 40, 'connect', 'node', {
    targetId: 'result', durationFrames: 18, value: {route: 'direct'}
  })] : []);
}

test('nested regions convey visual ownership without pretending content entered a model context', () => {
  const episode = regionFixture();
  const value = model(episode, 0), node = value.objects.find(item => item.id === 'node');
  assert.equal(node.regionId, 'inner'); assert.equal(node.containerId, null);
  assert.equal(node.status, 'idle'); assert.equal(node.stateText.text, '');
  const html = art(value);
  assert.ok(html.indexOf('data-editorial-object-id="outer"') < html.indexOf('data-editorial-object-id="inner"'));
  assert.ok(html.indexOf('data-editorial-object-id="inner"') < html.indexOf('data-editorial-object-id="node"'));
  assert.doesNotMatch(html, /已纳入本轮|已保存|data-motion-state="included"/u);
});

test('nested region relations stay above region fills and below foreground nodes', () => {
  const value = model(regionFixture(true), 58), html = art(value);
  assert.equal(value.connections.length, 1);
  const background = html.indexOf('data-editorial-object-id="inner"');
  const relation = html.indexOf('data-editorial-connection="region-link"');
  const foreground = html.indexOf('data-editorial-object-id="node"');
  assert.ok(background >= 0 && relation > background && foreground > relation);
});

test('regions fail closed on hidden, missing, cyclic or spatially invalid ownership', () => {
  for (const mutate of [
    plan => {plan.objects[1].initiallyVisible = false;},
    plan => {plan.objects[2].regionId = 'missing';},
    plan => {plan.objects[0].regionId = 'inner';},
    plan => {plan.objects[2].x = 1040;}
  ]) {
    const episode = regionFixture(); mutate(episode.scenes[0].motionPlan);
    assert.throws(() => model(episode, 0));
  }
});

test('formal execution-plan chapters drive unequal progress, timed reveal and global watermark/caption continuity', () => {
  const episode = episodeFor([{id: 'note', kind: 'label', label: '合成内容', detail: '', x: 600, y: 500,
    width: 500, height: 160, scopeId: 'synthetic', sourceId: null, initiallyVisible: true}]);
  episode.scenes[0].narration = '先讲概念。再讲应用。';
  episode.scenes[0].endFrame = 300;
  const second = structuredClone(episode.scenes[0]);
  Object.assign(second, {id: 'D02', narration: '应用演示。', startFrame: 300, endFrame: 900});
  episode.scenes.push(second);
  episode.production = {storyboardDraft: {content: {executionPlan: {chapterPlan: {
    version: 'editorial-chapters-v1', chapters: [
      {id: 'concept', label: '概念', sceneIds: ['D01'], reveal: {sceneId: 'D01', cue: '先讲概念。'}},
      {id: 'practice', label: '应用', sceneIds: ['D02'], reveal: {sceneId: 'D01', cue: '再讲应用。'}}
    ]
  }}}}};
  episode.subtitles = [{startFrame: 300, endFrame: 900, text: '这是合成字幕'}];
  const compiled = compile(episode, 30), reveal = compiled.editorialChapters.chapters[1].revealFrame;
  assert.equal(model(episode, reveal - 1).chapters.chapters[1].visible, false);
  assert.equal(model(episode, reveal).chapters.chapters[1].visible, true);
  assert.match(markup(episode, reveal - 1), /data-chapter-id="practice"[^>]*visibility:hidden/u);
  assert.match(markup(episode, reveal), /data-chapter-id="practice"[^>]*visibility:visible/u);
  const value = model(episode, 600);
  assert.deepEqual(value.chapters.chapters.map(item => item.widthFraction), [1 / 3, 2 / 3]);
  assert.deepEqual(value.chapters.chapters.map(item => item.progress), [1, 0.5]);
  assert.equal(value.chapters.audioAligned, false);
  assert.ok(model(episode, 899).chapters.chapters[1].progress < 1);
  const html = markup(episode, 601);
  assert.match(html, /data-editorial-chapters="editorial-chapters-v1"/u);
  assert.match(html, /data-timing-assurance="editorial-estimate"/u);
  assert.match(html, /data-ai-watermark-motion-cadence="continuous"/u);
  assert.match(html, /data-ai-watermark-raster-frame="1"/u);
  assert.match(html, /data-editorial-subtitle="plain-text"/u);
  assert.doesNotMatch(html, /data-editorial-subtitle[^>]*(?:background|border:)/u);
});

test('thirty-second chapter labels have independent equal-width slots while the 570-second track stays proportional', () => {
  const episode = episodeFor([{id: 'note', kind: 'label', label: '合成内容', detail: '', x: 600, y: 500,
    width: 500, height: 160, scopeId: 'synthetic', sourceId: null, initiallyVisible: true}]);
  Object.assign(episode.scenes[0], {narration: '先讲概念。', endFrame: 900});
  const second = structuredClone(episode.scenes[0]);
  Object.assign(second, {id: 'D02', narration: '再讲应用。', startFrame: 900, endFrame: 18000});
  episode.scenes.push(second);
  episode.editorialChapterPlan = {version: 'editorial-chapters-v1', chapters: [
    {id: 'concept', label: '概念定义基本边界', sceneIds: ['D01'], reveal: {sceneId: 'D01', cue: '先讲概念。'}},
    {id: 'practice', label: '应用', sceneIds: ['D02'], reveal: {sceneId: 'D02', cue: '再讲应用。'}}
  ]};
  const value = model(episode, 900), html = markup(episode, 900);
  assert.deepEqual(value.chapters.chapters.map(item => item.widthFraction), [0.05, 0.95]);
  assert.match(html, /data-editorial-chapter-labels="true"[^>]*grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/u);
  const label = html.match(/<div\b[^>]*data-chapter-id="concept"[^>]*>概念定义基本边界<\/div>/u)?.[0];
  assert.ok(label, 'all eight characters remain in one independent label slot');
  assert.match(label, /font-size:24px/u);
  assert.match(label, /line-height:30px/u);
  assert.match(label, /white-space:nowrap/u);
  assert.doesNotMatch(label, /flex:0\.05|overflow:hidden|text-overflow|scale\(/u);
  assert.match(html, /data-chapter-track-id="concept"[^>]*flex:0\.05/u);
  assert.match(html, /data-chapter-track-id="practice"[^>]*flex:0\.95/u);
});

test('two through six chapter labels fit one fixed-height row without truncation or smaller type', () => {
  for (let count = 2; count <= 6; count += 1) {
    const chapters = {version: 'editorial-chapters-v1', chapters: Array.from({length: count}, (_, index) => ({
      id: `part-${index}`, label: `概念定义基本边${index}`, visible: true, widthFraction: 1 / count, progress: 0
    }))};
    const html = renderToStaticMarkup(React.createElement(EditorialChapterNavigation, {chapters}));
    assert.ok((1728 - (count - 1) * 16) / count >= 8 * 24);
    assert.match(html, new RegExp(`grid-template-columns:repeat\\(${count}, minmax\\(0, 1fr\\)\\)`, 'u'));
    assert.equal((html.match(/line-height:30px/gu) ?? []).length, count);
    assert.equal((html.match(/white-space:nowrap/gu) ?? []).length, count);
    assert.match(html, /data-editorial-chapter-tracks="true"[^>]*top:38px[^>]*height:5px/u);
    assert.ok(1020 + 38 + 5 <= 1080);
    assert.doesNotMatch(html, /text-overflow|overflow:hidden|font-size:(?:1\d|2[0-3])px/u);
  }
});

for (const [name, value] of [['null', null], ['false', false], ['zero', 0], ['empty string', '']]) {
  test(`present malformed production chapter plan (${name}) cannot silently remove navigation`, () => {
    const episode = editorialDiagramSmokeFixture();
    assert.equal(compile(episode, 30).editorialChapters.chapters.length, 2);
    episode.production.storyboardDraft.content.executionPlan.chapterPlan = value;
    assert.throws(() => compile(episode, 30), chapterError);
  });
  test(`present malformed top-level chapter plan (${name}) cannot fall back to bound production navigation`, () => {
    const episode = editorialDiagramSmokeFixture();
    episode.editorialChapterPlan = value;
    assert.throws(() => compile(episode, 30), chapterError);
  });
}

test('render chapter copies must equal the bound production plan, not override it', () => {
  const episode = editorialDiagramSmokeFixture();
  const bound = episode.production.storyboardDraft.content.executionPlan.chapterPlan;
  episode.editorialChapterPlan = structuredClone(bound);
  assert.deepEqual(compile(episode, 30).editorialChapters.chapters.map(chapter => chapter.label), ['概念定义基本边界', '复制']);
  episode.editorialChapterPlan.chapters[0].label = '伪造';
  // Both plans are individually valid: rejection must come from binding mismatch.
  const unbound = structuredClone(episode);
  delete unbound.production.storyboardDraft;
  assert.equal(compile(unbound, 30).editorialChapters.chapters[0].label, '伪造');
  assert.throws(() => compile(episode, 30), chapterError);
});

test('legacy omission of chapter plans remains valid while malformed presence is not omission', () => {
  const episode = editorialDiagramSmokeFixture();
  delete episode.production.storyboardDraft.content.executionPlan.chapterPlan;
  assert.equal(model(episode, 0).chapters, null);
});

test('an existing formal draft without a chapter plan cannot gain navigation from an injected top-level plan', () => {
  const episode = editorialDiagramSmokeFixture();
  episode.editorialChapterPlan = structuredClone(episode.production.storyboardDraft.content.executionPlan.chapterPlan);
  delete episode.production.storyboardDraft.content.executionPlan.chapterPlan;
  assert.throws(() => compile(episode, 30), chapterError);
  delete episode.production.storyboardDraft.content.executionPlan;
  assert.throws(() => compile(episode, 30), chapterError);
  episode.production.storyboardDraft = null;
  assert.throws(() => compile(episode, 30), chapterError);
  delete episode.production.storyboardDraft;
  assert.deepEqual(compile(episode, 30).editorialChapters.chapters.map(chapter => chapter.label), ['概念定义基本边界', '复制']);
});

test('unbound caller-supplied compiled chapters cannot inject navigation without authored cue provenance', () => {
  const episode = editorialDiagramSmokeFixture();
  episode.editorialChapters = structuredClone(compile(episode, 30).editorialChapters);
  episode.editorialChapters.chapters[0].label = '伪造';
  delete episode.production.storyboardDraft.content.executionPlan.chapterPlan;
  // Either explicit rejection or discarding untrusted derived data is safe.
  let rendered;
  try { rendered = model(episode, 0); }
  catch (error) { assert.ok(chapterError(error)); return; }
  assert.equal(rendered.chapters, null);
});

test('screen-density inspection samples chapter reveal boundaries even with no nearby motion events', async () => {
  const {compileEditorialMotionRenderEpisode: compilePure, buildEditorialMotionRenderModel: modelPure} =
    await import('../src/video/editorial-motion-render-model.mjs');
  const {emptyScreenEditing, screenTextLength} = await import('../src/shared/screen-editorial-policy.mjs');
  const {assertTimedStoryboardScreenEditing} = await import('../src/server/production/storyboard-screen-editing.mjs');
  const episode = episodeFor([{id: 'text', kind: 'label', label: '标'.repeat(24), detail: '说'.repeat(48),
    x: 120, y: 330, width: 1680, height: 500, scopeId: 'synthetic', sourceId: null, initiallyVisible: true}]);
  Object.assign(episode.scenes[0], {title: '题'.repeat(32), narration: '先看第一章。随后揭示第二章。', endFrame: 300});
  const second = structuredClone(episode.scenes[0]);
  Object.assign(second, {id: 'D02', title: '合成归纳', narration: '核对第二章。', startFrame: 300, endFrame: 600});
  Object.assign(second.motionPlan.objects[0], {label: '核对', detail: ''});
  episode.scenes.push(second);
  episode.production = {storyboardDraft: {content: {executionPlan: {chapterPlan: {
    version: 'editorial-chapters-v1', chapters: [
      {id: 'first', label: '概念一二三四五六', sceneIds: ['D01'], reveal: {sceneId: 'D01', cue: '先看第一章。'}},
      {id: 'second', label: '应用一二三四五六', sceneIds: ['D02'], reveal: {sceneId: 'D01', cue: '随后揭示第二章。'}}
    ]
  }}}}};
  const compiled = compilePure(episode, 30);
  const reveal = compiled.editorialChapters.chapters[1].revealFrame;
  assert.ok(reveal > 0 && reveal < 299);
  assert.equal(compiled.scenes[0].motionPlan.events.length, 0);
  const count = at => {
    const current = modelPure(compiled, at, 30);
    return [current.title.text, ...current.objects.flatMap(item => [item.title.text, item.body.text, item.stateText.text]),
      current.chapters.chapters.filter(item => item.visible).map(item => item.label).join(' · ')]
      .reduce((total, text) => total + screenTextLength(text), 0);
  };
  assert.equal(count(reveal - 1), 112);
  assert.equal(count(reveal), 121);
  const content = {screenEditing: emptyScreenEditing(compiled.scenes.map(scene => scene.id))};
  assert.throws(() => assertTimedStoryboardScreenEditing(content, compiled, compiled),
    {code: 'screen_editorial_total_dense'});
});

test('timed-content compiler rejects every present falsy chapter plan on otherwise valid tracked synthetic content', async t => {
  const {approvedStoryboardFixture} = await import('./approved-storyboard-fixture.mjs');
  const {compileTimedEditorialContent} = await import('../src/server/production/timed-editorial-content.mjs');
  const fixture = await approvedStoryboardFixture(t);
  const content = fixture.candidate.content;
  assert.ok(compileTimedEditorialContent(content).scenes.length >= 12);
  for (const [name, value] of [['null', null], ['false', false], ['zero', 0], ['empty string', '']]) {
    await t.test(`chapterPlan ${name} is rejected rather than dropped`, () => {
      const mutated = structuredClone(content);
      mutated.executionPlan.chapterPlan = value;
      assert.throws(() => compileTimedEditorialContent(mutated));
    });
  }
});

test('plain-data motion fields reject hidden payloads without invoking accessors', () => {
  let reads = 0;
  for (const mutate of [
    plan => Object.defineProperty(plan.objects[0], 'illustration', {enumerable: true, get() {reads += 1; return 'gate';}}),
    plan => Object.defineProperty(plan.objects[0], 'hiddenPayload', {value: 'unsupported'}),
    plan => {plan.objects[0][Symbol('payload')] = 'unsupported';},
    plan => {plan.events[3].value.onComplete = 'unsupported';}
  ]) {
    const plan = diagramFixture().scenes[0].motionPlan; mutate(plan);
    assert.equal(validateEditorialMotionPlan(plan).valid, false);
  }
  assert.equal(reads, 0);
});

test('render compilation rejects accessors before cloning rather than executing input code', () => {
  let reads = 0;
  const episode = diagramFixture();
  Object.defineProperty(episode.scenes[0].motionPlan.objects[0], 'illustration', {
    enumerable: true, get() {reads += 1; return 'gate';}
  });
  assert.throws(() => compile(episode, 30));
  assert.equal(reads, 0);
});

test('diagram pixel smoke is locked to synthetic fixtures and cannot accept live paths or data overrides', async () => {
  const {parseEditorialDiagramSmokeArguments: parse, runCiEditorialDiagramSmoke: run} =
    await import('../scripts/ci-editorial-diagram-smoke.mjs');
  assert.deepEqual(parse([]), {keepFrames: false});
  assert.deepEqual(parse(['--keep-frames']), {keepFrames: true});
  for (const args of [['--episode', 'live'], ['--input', 'episode.json'], ['--public-dir', '/tmp'],
    ['--keep-frames', '--keep-frames'], ['--frames', '0'], null, {}]) assert.throws(() => parse(args));
  let reads = 0;
  const accessor = Object.defineProperty({}, 'keepFrames', {enumerable: true, get() {reads += 1; return true;}});
  for (const options of [accessor, {episode: {}}, {publicDirectory: '/tmp'}, {keepFrames: 'yes'},
    Object.create({keepFrames: true}), {[Symbol('override')]: true}]) await assert.rejects(run(options));
  assert.equal(reads, 0);
});

test('pixel smoke fixture covers relation visibility and real copy arrival using the production pure model', async () => {
  const {EDITORIAL_DIAGRAM_SMOKE_FRAMES: frames, editorialDiagramSmokeFixture: fixture} =
    await import('./editorial-diagram-smoke-fixture.mjs');
  assert.deepEqual(frames, [0, 58, 199, 240]);
  const episode = fixture(), snapshot = compile(episode, 30);
  assert.equal(episode.id, 'synthetic-editorial-diagram-pixel-smoke');
  assert.equal(model(snapshot, 0).connections.length, 0);
  assert.equal(model(snapshot, 58).connections[0].progress, 1);
  assert.equal(model(snapshot, 199).objects.some(item => item.id === 'copy'), false);
  assert.equal(model(snapshot, 240).objects.find(item => item.id === 'copy').containerId, 'input');
  assert.deepEqual(model(snapshot, 240).chapters.chapters.map(item => item.widthFraction), [0.05, 0.95]);
});
