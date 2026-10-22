import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalJsonDocumentContentSha256} from '../src/shared/durable-json-store.mjs';
import {cueFrameForNarration, EDITORIAL_TIMING_POLICY} from '../src/shared/editorial-timing.mjs';
import {compileEditorialAudioVisualTiming} from '../src/shared/editorial-av-timing.mjs';
import {applyEditorialPacingRevision, editorialPacingMotionPlanSha256}
  from '../src/shared/editorial-av-pacing.mjs';
import {validateEditorialAvReviewPlan} from '../src/server/production/editorial-av-review-core.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
function fixture() {
  const texts = ['先看原件。', '把资料复制到窗口。', '原件仍然保留。', '现在说明副本。', '最后隐藏原件。'];
  const narration = texts.join('');
  const make = (id, cue, op, objectId, patch = {}) => ({id, cue, op, objectId,
    atFrame: cueFrameForNarration(narration, cue, EDITORIAL_TIMING_POLICY),
    durationFrames: 0, targetId: null, value: null, requires: [], ...patch});
  const copyFrame = cueFrameForNarration(narration, '把资料复制到窗口', EDITORIAL_TIMING_POLICY);
  const source = {id: 'source', kind: 'page', label: '来源资料', detail: '', x: 140, y: 530,
    width: 420, height: 190, scopeId: 's', sourceId: null, initiallyVisible: false};
  const motionPlan = {version: 'editorial-motion-v1', canvas: {width: 1920, height: 1080},
    objects: [source, {...source, id: 'copy', sourceId: 'source'},
      {...source, id: 'window', kind: 'window', label: '模型窗口', x: 1050, y: 330,
        width: 720, height: 530, initiallyVisible: true}],
    events: [make('show', '先看原件', 'reveal', 'source'),
      make('copy', '把资料复制到窗口', 'copy', 'source', {targetId: 'copy'}),
      make('move', '把资料复制到窗口', 'transfer', 'copy', {atFrame: copyFrame + 3,
        durationFrames: 24, targetId: 'window', value: {x: 1130, y: 620}, requires: ['copy']}),
      make('arrive', '把资料复制到窗口', 'arrive', 'copy', {atFrame: copyFrame + 27,
        targetId: 'window', requires: ['move']}),
      make('hide', '最后隐藏原件', 'retire', 'source')]};
  let cursor = 0;
  const segments = texts.map((text, i) => {
    const startSample = cursor;
    cursor += 72000;
    return {id: `segment-${i}`, sceneId: 'A', unitId: 'A:p1', text, textSha256: sha(text),
      sampleCount: 72000, startSample, endSample: cursor, pauseAfterSamples: 0, nextSample: cursor};
  });
  const voiceTiming = {schemaVersion: 'editorial-voice-timing-v1', sampleRate: 24000,
    alignmentMethod: 'synthesis-segment-sample-boundaries-v1', captionDurationIssues: [],
    sourceTextSha256: sha(narration), segments, totalSamples: cursor, durationSeconds: cursor / 24000,
    scenes: [{id: 'A', startSample: 0, endSample: cursor}],
    units: [{id: 'A:p1', sceneId: 'A', startSample: 0, endSample: cursor}],
    captions: segments.map(s => ({text: s.text, startMs: s.startSample / 24, endMs: s.endSample / 24,
      timestampMs: null, confidence: null}))};
  const episode = {id: 'synthetic-pacing', scenes: [{id: 'A', title: '来源和副本', narration,
    unitIds: ['A:p1'], startFrame: 0, endFrame: 600, start: 0, end: 20, motionPlan}], subtitles: [],
    render: {fps: 30, width: 1920, height: 1080, durationSeconds: 20}, approvals: {final: {status: 'pending'}}};
  const pacing = {schemaVersion: 'editorial-av-pacing-v1', scenes: [{sceneId: 'A',
    sourceMotionPlanSha256: canonicalJsonDocumentContentSha256(motionPlan),
    retime: [{eventId: 'hide', cue: '最后隐藏原件', anchor: 'segment-start', offsetFrames: 15}],
    focus: [{id: 'focus-source', objectId: 'source', cue: '原件仍然保留', anchor: 'cue-start', offsetFrames: 0},
      {id: 'focus-copy', objectId: 'copy', cue: '现在说明副本', anchor: 'segment-start', offsetFrames: 0}],
    constraints: [{afterEventId: 'arrive', beforeEventId: 'hide', minFrames: 30}]}]};
  return {episode, voiceTiming, pacing};
}

test('pacing is pure, source-bound, semantic-only and returns honest updated timing evidence', () => {
  const input = fixture(), original = structuredClone(input);
  const baseline = compileEditorialAudioVisualTiming({...input, pacing: undefined});
  const result = compileEditorialAudioVisualTiming({...input, pacing: input.pacing});
  assert.deepEqual(input, original);
  assert.equal(editorialPacingMotionPlanSha256(input.episode.scenes[0].motionPlan),
    input.pacing.scenes[0].sourceMotionPlanSha256);
  assert.deepEqual(result.episode.subtitles, baseline.episode.subtitles);
  assert.deepEqual(result.episode.render, baseline.episode.render);
  assert.deepEqual(result.episode.scenes[0].motionPlan.objects, input.episode.scenes[0].motionPlan.objects);
  assert.equal(result.episode.scenes[0].motionPlan.events.find(e => e.id === 'hide').atFrame, 375);
  const binding = result.timing.eventBindings.find(e => e.eventId === 'hide');
  assert.equal(binding.atFrame, 375);
  assert.equal(result.timing.eventBindings.filter(e => e.sceneId === 'A').length, 7);
  assert.equal(result.timing.wordAligned, false);
  assert.equal(result.timing.pacingRevision.wordAligned, false);
  assert.equal(result.timing.pacingRevision.scenes[0].before.events.length, 5);
  assert.equal(result.timing.pacingRevision.scenes[0].after.events.length, 7);
  assert.ok(result.timing.pacingRevision.scenes[0].retentionChecks[0].stableFrames >= 30);
  assert.ok(result.timing.geometrySampleCount > baseline.timing.geometrySampleCount);
});

test('absent pacing preserves original v1 output shape and is deterministic', () => {
  const input = fixture(); delete input.pacing;
  const result = compileEditorialAudioVisualTiming(input);
  assert.equal(Object.hasOwn(result.timing, 'pacingRevision'), false);
  assert.deepEqual(result, compileEditorialAudioVisualTiming({...input, pacing: undefined}));
});

test('closed pacing schema rejects unknown, excessive, duplicate, empty and stale revisions', () => {
  for (const mutate of [
    p => {p.unexpected = true;}, p => {p.schemaVersion = 'other';}, p => {p.scenes = [];},
    p => {p.scenes = Array(4).fill(p.scenes[0]);},
    p => {p.scenes.push(structuredClone(p.scenes[0]));},
    p => {p.scenes[0].sceneId = 'missing';},
    p => {p.scenes[0].sourceMotionPlanSha256 = '0'.repeat(64);},
    p => {p.scenes[0].retime[0].atFrame = 8;},
    p => {p.scenes[0].retime[0].eventId = 'missing';},
    p => {p.scenes[0].retime.push({...p.scenes[0].retime[0]});},
    p => {p.scenes[0].focus[0].id = 'copy';},
    p => {p.scenes[0].focus[0].op = 'save';},
    p => {p.scenes[0].focus[0].requires = ['copy'];},
    p => {p.scenes[0].focus[0].objectId = 'missing';},
    p => {p.scenes[0].retime[0].anchor = 'word';},
    p => {p.scenes[0].retime[0].offsetFrames = 181;},
    p => {p.scenes[0].retime[0].offsetFrames = -1;},
    p => {p.scenes[0].retime[0].offsetFrames = 0.5;},
    p => {p.scenes[0].focus = []; p.scenes[0].retime = [];},
    p => {p.scenes[0].constraints[0].minFrames = -1;},
    p => {p.scenes[0].constraints[0].minFrames = 181;},
    p => {p.scenes[0].constraints[0].afterEventId = 'missing';},
  ]) {
    const input = fixture(); mutate(input.pacing);
    assert.throws(() => compileEditorialAudioVisualTiming(input));
  }
});

test('cue anchors are unique within narration and confined to one measured short phrase', () => {
  for (const cue of ['不存在', '原件', '原件。把资料']) {
    const input = fixture(); input.pacing.scenes[0].focus[0].cue = cue;
    assert.throws(() => compileEditorialAudioVisualTiming(input));
  }
  const input = fixture();
  input.pacing.scenes[0].focus[0].cue = '仍然保留';
  const result = compileEditorialAudioVisualTiming(input);
  const binding = result.timing.eventBindings.find(e => e.eventId === 'focus-source');
  assert.equal(binding.placement, 'editorial-estimate-within-segment');
  assert.ok(binding.atFrame > 180 && binding.atFrame < 270);
});

test('state, narration order, dependency duration and scene bounds fail closed after retiming', () => {
  for (const mutate of [
    p => {p.scenes[0].focus[0].objectId = 'copy'; p.scenes[0].focus[0].cue = '先看原件';},
    p => {p.scenes[0].retime = [{eventId: 'arrive', cue: '把资料复制到窗口', anchor: 'segment-start', offsetFrames: 20}];},
    p => {p.scenes[0].retime[0].anchor = 'segment-end';},
    p => {p.scenes[0].retime[0].offsetFrames = 150;},
    p => {p.scenes[0].retime = [{eventId: 'show', cue: '先看原件', anchor: 'segment-end', offsetFrames: 30}];},
  ]) {
    const input = fixture(); mutate(input.pacing);
    assert.throws(() => compileEditorialAudioVisualTiming(input));
  }
});

test('retired sources retain an arrived visible copy for at least 30 stable frames without a user constraint', () => {
  const input = fixture(), baseline = compileEditorialAudioVisualTiming({...input, pacing: undefined});
  input.pacing.scenes[0].focus = [];
  input.pacing.scenes[0].constraints = [];
  input.pacing.scenes[0].retime = [{eventId: 'hide', cue: '把资料复制到窗口', anchor: 'segment-start', offsetFrames: 29}];
  assert.throws(() => applyEditorialPacingRevision({episode: baseline.episode, voiceTiming: input.voiceTiming,
    sourceEpisode: input.episode, pacing: input.pacing}), {code: 'editorial_av_pacing_source_retention'});
  input.pacing.scenes[0].retime[0].offsetFrames = 57;
  const result = applyEditorialPacingRevision({episode: baseline.episode, voiceTiming: input.voiceTiming,
    sourceEpisode: input.episode, pacing: input.pacing});
  assert.equal(result.revision.scenes[0].retentionChecks[0].stableFrames, 30);
});

test('constraints count from operation completion, and candidate source geometry cannot be substituted', () => {
  const input = fixture(), baseline = compileEditorialAudioVisualTiming({...input, pacing: undefined});
  input.pacing.scenes[0].constraints = [{afterEventId: 'move', beforeEventId: 'arrive', minFrames: 30}];
  assert.throws(() => compileEditorialAudioVisualTiming(input), {code: 'editorial_av_pacing_constraint_unsatisfied'});
  input.pacing.scenes[0].constraints = [];
  baseline.episode.scenes[0].motionPlan.objects[0].label = '替换文字';
  assert.throws(() => applyEditorialPacingRevision({episode: baseline.episode, voiceTiming: input.voiceTiming,
    sourceEpisode: input.episode, pacing: input.pacing}), {code: 'editorial_av_pacing_candidate_source_mismatch'});
});

test('no-op retimes, no-op focus and non-data shapes are rejected without invoking accessors', () => {
  const input = fixture();
  input.pacing.scenes[0].retime[0].offsetFrames = 0;
  input.pacing.scenes[0].focus = [];
  assert.throws(() => compileEditorialAudioVisualTiming(input), {code: 'editorial_av_pacing_no_change'});
  const duplicate = fixture();
  duplicate.pacing.scenes[0].focus.push({id: 'repeat-focus', objectId: 'copy', cue: '最后隐藏原件',
    anchor: 'segment-start', offsetFrames: 0});
  assert.throws(() => compileEditorialAudioVisualTiming(duplicate), {code: 'editorial_av_pacing_focus_no_change'});
  let called = false;
  for (const mutate of [
    p => Object.defineProperty(p, 'schemaVersion', {get() {called = true; return 'editorial-av-pacing-v1';}}),
    p => {p.scenes.extra = true;}, p => {delete p.scenes[0];},
    p => {p.scenes[0].focus[0].offsetFrames = Infinity;},
    p => {p.scenes[0].retime[0].cue = p;},
  ]) {
    const malformed = fixture(); mutate(malformed.pacing);
    assert.throws(() => compileEditorialAudioVisualTiming(malformed));
  }
  assert.equal(called, false);
});

test('causal zero or one-frame constraints are allowed without lowering built-in source retention', () => {
  const input = fixture();
  input.pacing.scenes[0].constraints.push({afterEventId: 'move', beforeEventId: 'arrive', minFrames: 0},
    {afterEventId: 'arrive', beforeEventId: 'focus-source', minFrames: 1});
  const result = compileEditorialAudioVisualTiming(input);
  assert.equal(result.timing.pacingRevision.scenes[0].constraints[1].actualFrames, 0);
  assert.equal(result.timing.pacingRevision.scenes[0].retentionChecks[0].minimumFrames, 30);
});

test('source cannot retire while its visible copy is still in transit or not yet included', () => {
  for (const offsetFrames of [1, 10, 26]) {
    const input = fixture();
    input.pacing.scenes[0].focus = [];
    input.pacing.scenes[0].constraints = [];
    input.pacing.scenes[0].retime = [{eventId: 'hide', cue: '把资料复制到窗口', anchor: 'segment-start', offsetFrames}];
    assert.throws(() => compileEditorialAudioVisualTiming(input), {code: 'editorial_av_pacing_source_retention'});
  }
});

test('unknown non-enumerable fields cannot disappear during closed-plan cloning', () => {
  const input = fixture();
  Object.defineProperty(input.pacing.scenes[0], 'hiddenChange', {value: true, enumerable: false});
  assert.throws(() => compileEditorialAudioVisualTiming(input), {code: 'editorial_av_pacing_invalid'});
});

test('production v2 plan validation integrates with the pure compiler on synthetic data', () => {
  const input = fixture();
  const plan = validateEditorialAvReviewPlan({schemaVersion: 'editorial-av-review-plan-v2',
    clips: [{id: 'test-clip', sceneIds: ['A']}], pacing: input.pacing});
  const result = compileEditorialAudioVisualTiming({...input, pacing: plan.pacing});
  assert.equal(result.timing.pacingRevision.scenes[0].after.events.length, 7);
  assert.equal(result.timing.pacingRevision.planSha256, canonicalJsonDocumentContentSha256(plan.pacing));
});

test('new focus must target a rendered shape, not a label with no visual focus response', () => {
  const input = fixture();
  input.episode.scenes[0].motionPlan.objects.push({id: 'caption-label', kind: 'label', label: '来源说明',
    detail: '', x: 140, y: 320, width: 420, height: 190, scopeId: 's', sourceId: null, initiallyVisible: true});
  input.pacing.scenes[0].sourceMotionPlanSha256 = editorialPacingMotionPlanSha256(input.episode.scenes[0].motionPlan);
  input.pacing.scenes[0].focus[0].objectId = 'caption-label';
  assert.throws(() => compileEditorialAudioVisualTiming(input), {code: 'editorial_av_pacing_focus_invalid'});
});
