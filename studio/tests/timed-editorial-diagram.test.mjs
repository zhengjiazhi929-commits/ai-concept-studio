import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedStoryboardFixture} from './approved-storyboard-fixture.mjs';
import {compileTimedEditorialContent, inspectTimedEditorialEpisode} from '../src/server/production/timed-editorial-content.mjs';
import {EDITORIAL_TIMING_POLICY, cueFrameForNarration} from '../src/shared/editorial-timing.mjs';
import {compileEditorialMotionRenderEpisode, buildEditorialMotionRenderModel} from '../src/video/editorial-motion-render-model.mjs';

// Only the tracked synthetic approved chain and its temporary data root are used.
// In-memory derived Episodes below test inspection, not formal import or approval.
const fps = EDITORIAL_TIMING_POLICY.fps;
const points = [{x: 900, y: 650}, {x: 1200, y: 650}, {x: 1200, y: 780}];
const invalid = {code: 'timed_editorial_contract_invalid'};

function withTracks(content) {
  const result = structuredClone(content);
  const narration = result.shots[1].narration;
  const cueFrame = cueFrameForNarration(narration, '接下来检查', EDITORIAL_TIMING_POLICY);
  const retireFrame = cueFrameForNarration(narration, '最后验证', EDITORIAL_TIMING_POLICY);
  const track = {id: 'synthetic-process', states: [
    {cue: '接下来检查', atFrame: cueFrame + 10, durationFrames: 18, points: structuredClone(points), highlightStop: 2},
    {cue: '最后验证', atFrame: retireFrame, durationFrames: 0, points: [], highlightStop: null}
  ]};
  result.executionPlan.motionPlans[1].plan.tracks = [track];
  return {content: result, cueFrame, retireFrame};
}

function sampleFrames(compiled) {
  const frames = new Set(compiled.subtitles.map(cue => cue.startFrame));
  for (const scene of compiled.scenes) {
    frames.add(scene.startFrame); frames.add(scene.endFrame - 1);
    const transitions = [...scene.motionPlan.events, ...(scene.motionPlan.tracks ?? []).flatMap(track => track.states)];
    for (const transition of transitions) {
      const start = scene.startFrame + transition.atFrame;
      const end = start + transition.durationFrames;
      for (const frame of [start - 1, start, Math.floor((start + end) / 2), end - 1, end, end + 1]) {
        if (frame >= scene.startFrame && frame < scene.endFrame) frames.add(frame);
      }
    }
  }
  return frames;
}

function inspectedEpisode(base, content, compiled) {
  const episode = structuredClone(base);
  episode.production.storyboardDraft.content = structuredClone(content);
  episode.scenes = structuredClone(compiled.scenes);
  episode.subtitles = structuredClone(compiled.subtitles);
  episode.render = {...episode.render, compositionId: 'ConceptPreview', width: 1920, height: 1080,
    fps, durationSeconds: compiled.durationSeconds};
  return episode;
}

test('synthetic timed diagrams preserve narrated track timing, geometry samples and full Episode chapter binding', async t => {
  const fixture = await approvedStoryboardFixture(t);
  const before = structuredClone(fixture.candidate.content);
  const baseline = compileTimedEditorialContent(before);
  const {content, cueFrame, retireFrame} = withTracks(before);
  const original = structuredClone(content);
  const compiled = compileTimedEditorialContent(content);
  const renderInput = compileEditorialMotionRenderEpisode(compiled, fps);
  const scene = compiled.scenes[1];
  const at = localFrame => buildEditorialMotionRenderModel(renderInput, scene.startFrame + localFrame, fps);
  const firstState = content.executionPlan.motionPlans[1].plan.tracks[0].states[0];

  await t.test('normal tracks compile without mutating content, narration, subtitles or business state', () => {
    assert.deepEqual(content, original);
    assert.deepEqual(fixture.candidate.content, before);
    assert.equal(compiled.timingStatus, 'editorial-estimate');
    assert.equal(compiled.audioAligned, false);
    assert.deepEqual(compiled.subtitles, baseline.subtitles);
    assert.deepEqual(compiled.scenes.map(item => item.narration), baseline.scenes.map(item => item.narration));
    assert.deepEqual(compiled.scenes[1].motionPlan.tracks, content.executionPlan.motionPlans[1].plan.tracks);
    assert.deepEqual(at(firstState.atFrame - 1).objects, at(firstState.atFrame + 18).objects);
    assert.equal(at(firstState.atFrame + 18).connections.length, 0);
  });

  for (const [name, mutate] of [
    ['missing spoken cue', state => {state.cue = '这句不在合成原文中';}],
    ['one frame before its cue', state => {state.atFrame = cueFrame - 1;}],
    ['ninety-one frames after its cue', state => {state.atFrame = cueFrame + 91;}]
  ]) {
    await t.test(`timed compiler rejects track ${name}`, () => {
      const changed = structuredClone(content);
      mutate(changed.executionPlan.motionPlans[1].plan.tracks[0].states[0]);
      assert.throws(() => compileTimedEditorialContent(changed), invalid);
    });
  }

  await t.test('the exact cue and permitted ninety-frame boundary are accepted', () => {
    for (const offset of [0, 90]) {
      const changed = structuredClone(content);
      changed.executionPlan.motionPlans[1].plan.tracks[0].states[0].atFrame = cueFrame + offset;
      assert.ok(cueFrame + offset + firstState.durationFrames < retireFrame);
      assert.ok(compileTimedEditorialContent(changed).geometrySampleCount > 0);
    }
  });

  await t.test('visible track starts, halfway geometry, highlight arrival and retirement are sampled', () => {
    const expected = sampleFrames(compiled);
    const previous = sampleFrames(baseline);
    assert.equal(compiled.geometrySampleCount, expected.size);
    assert.ok(expected.size > previous.size);
    const boundaries = [firstState.atFrame - 1, firstState.atFrame, firstState.atFrame + 9,
      firstState.atFrame + 17, firstState.atFrame + 18, firstState.atFrame + 19,
      retireFrame - 1, retireFrame, retireFrame + 1];
    for (const local of boundaries) assert.ok(expected.has(scene.startFrame + local), String(local));
    assert.ok(boundaries.some(local => !previous.has(scene.startFrame + local)));
    assert.deepEqual(at(firstState.atFrame - 1).tracks, []);
    assert.equal(at(firstState.atFrame).tracks[0].progress, 0);
    assert.equal(at(firstState.atFrame + 9).tracks[0].progress, 0.5);
    assert.equal(at(firstState.atFrame + 9).tracks[0].highlightPoint, null);
    const arrived = at(firstState.atFrame + 18).tracks[0];
    assert.equal(arrived.progress, 1);
    assert.deepEqual(arrived.highlightPoint, points[2]);
    assert.match(arrived.path, /^M 900 650 H 1200 V 780$/u);
    assert.equal(at(retireFrame - 1).tracks.length, 1);
    assert.deepEqual(at(retireFrame).tracks, []);
  });

  await t.test('full Episode inspection rejects compiled track drift against its authored content', () => {
    const episode = inspectedEpisode(fixture.episode, content, compiled);
    assert.equal(inspectTimedEditorialEpisode(episode).valid, true);
    episode.scenes[1].motionPlan.tracks[0].states[0].highlightStop = 1;
    assert.equal(inspectTimedEditorialEpisode(episode).valid, false);
  });

  await t.test('full Episode chapter binding rejects a valid but different top-level navigation plan', () => {
    const chapterContent = structuredClone(content);
    const chapterPlan = {version: 'editorial-chapters-v1', chapters: [
      {id: 'first', label: '概念', sceneIds: compiled.scenes.slice(0, 6).map(item => item.id),
        reveal: {sceneId: compiled.scenes[0].id, cue: compiled.scenes[0].narration.slice(0, 4)}},
      {id: 'second', label: '应用', sceneIds: compiled.scenes.slice(6).map(item => item.id),
        reveal: {sceneId: compiled.scenes[6].id, cue: compiled.scenes[6].narration.slice(0, 4)}}
    ]};
    chapterContent.executionPlan.chapterPlan = chapterPlan;
    const chapterCompiled = compileTimedEditorialContent(chapterContent);
    const episode = inspectedEpisode(fixture.episode, chapterContent, chapterCompiled);
    assert.equal(inspectTimedEditorialEpisode(episode).valid, true);
    episode.editorialChapterPlan = structuredClone(chapterPlan);
    assert.equal(inspectTimedEditorialEpisode(episode).valid, true);
    episode.editorialChapterPlan.chapters[0].label = '不同';
    const unbound = structuredClone(episode);
    delete unbound.production.storyboardDraft;
    assert.equal(compileEditorialMotionRenderEpisode(unbound, fps).editorialChapters.chapters[0].label, '不同');
    assert.equal(inspectTimedEditorialEpisode(episode).valid, false);
    delete episode.editorialChapterPlan;
    episode.editorialChapters = structuredClone(compileEditorialMotionRenderEpisode(episode, fps).editorialChapters);
    assert.equal(inspectTimedEditorialEpisode(episode).valid, false);
  });
});
