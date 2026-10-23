import {editorialMotionRendererFixture} from './editorial-motion-renderer-fixture.mjs';

// Immutable synthetic source: no live Episode, user artifact or external asset.
export const EDITORIAL_DIAGRAM_SMOKE_FRAMES = Object.freeze([0, 58, 199, 240]);
export function editorialDiagramSmokeFixture() {
  const source = editorialMotionRendererFixture();
  const second = source.scenes[0];
  // The 6/114-second split has the same short-chapter ratio as 30/570, without
  // rendering a long movie: the smoke still captures only four fixed frames.
  Object.assign(second, {id: 'copy-demo', title: '资料保留原件，只把副本送入窗口', start: 6, end: 120,
    startFrame: 180, endFrame: 3600});
  Object.assign(second.motionPlan.objects[0], {x: 160, y: 500, height: 320, containerId: 'tray'});
  Object.assign(second.motionPlan.objects[2], {x: 160, y: 500, height: 320});
  second.motionPlan.objects.unshift({id: 'tray', kind: 'tray', label: '原始资料', detail: '',
    x: 100, y: 310, width: 650, height: 560, scopeId: 'session-a', sourceId: null, initiallyVisible: true});
  second.motionPlan.events[1].value.y = 500;
  const base = {scopeId: 'synthetic-diagram', sourceId: null, initiallyVisible: true, detail: ''};
  const first = {id: 'region-demo', title: '合成机制示意：区域内的关系也要清楚', start: 0, end: 6,
    startFrame: 0, endFrame: 180, narration: '先看图案。再看复制。建立关系。', motionPlan: {
      version: 'editorial-motion-v1', canvas: {width: 1920, height: 1080}, objects: [
        {id: 'region', kind: 'region', label: '运行范围', x: 120, y: 310, width: 1680, height: 560, ...base},
        {id: 'gate', kind: 'illustration', illustration: 'gate', label: '条件入口', x: 200, y: 460,
          width: 460, height: 350, regionId: 'region', ...base},
        {id: 'processor', kind: 'illustration', illustration: 'processor', label: '处理步骤', x: 1180, y: 460,
          width: 460, height: 350, regionId: 'region', ...base}
      ], events: [{id: 'relation', cue: '建立关系', atFrame: 40, durationFrames: 18, op: 'connect',
        objectId: 'gate', targetId: 'processor', value: {route: 'direct'}, requires: []}]
    }};
  return {id: 'synthetic-editorial-diagram-pixel-smoke', title: 'Synthetic diagrams only',
    render: {compositionId: 'ConceptPreview', width: 1920, height: 1080, fps: 30, durationSeconds: 120},
    scenes: [first, second], subtitles: [
      {startFrame: 0, endFrame: 180, text: '图形和关系必须共同表达含义'},
      {startFrame: 180, endFrame: 240, text: '原件保留，副本准备送入'},
      {startFrame: 240, endFrame: 3600, text: '到达窗口以后才纳入上下文'}
    ], production: {storyboardDraft: {content: {executionPlan: {chapterPlan: {
      version: 'editorial-chapters-v1', chapters: [
        {id: 'figures', label: '概念定义基本边界', sceneIds: ['region-demo'], reveal: {sceneId: 'region-demo', cue: '先看图案。'}},
        {id: 'copy', label: '复制', sceneIds: ['copy-demo'], reveal: {sceneId: 'region-demo', cue: '再看复制。'}}
      ]
    }}}}}};
}
