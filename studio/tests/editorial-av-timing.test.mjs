import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EDITORIAL_TIMING_POLICY, cueFrameForNarration} from '../src/shared/editorial-timing.mjs';
import {compileEditorialAudioVisualTiming, buildEditorialAudioVisualClipRanges}
  from '../src/shared/editorial-av-timing.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
function fixture({splitUnits = false, secondSampleCount = 120001} = {}) {
  const scenes = ['A', 'B', 'C'].map((id, index) => {
    const hasSplit = splitUnits && index === 0;
    const narration = hasSplit ? '展示来源。\n\n把资料复制到窗口。复制完成后说明。'
      : '展示来源。把资料复制到窗口。复制完成后说明。';
    const event = (suffix, cue, op, objectId, patch = {}) => ({id: `${id}-${suffix}`, cue,
      atFrame: cueFrameForNarration(narration, cue, EDITORIAL_TIMING_POLICY), durationFrames: 0,
      op, objectId, targetId: null, value: null, requires: [], ...patch});
    const copyFrame = cueFrameForNarration(narration, '把资料复制到窗口', EDITORIAL_TIMING_POLICY);
    const source = {id: 'source', kind: 'page', label: '来源资料', detail: '', x: 140, y: 530,
      width: 420, height: 190, scopeId: 's', sourceId: null, initiallyVisible: false};
    return {id, title: '本轮输入', narration, unitIds: hasSplit ? [`${id}:p1`, `${id}:p2`] : [`${id}:p1`], startFrame: index * 300,
      endFrame: (index + 1) * 300, start: index * 10, end: (index + 1) * 10,
      motionPlan: {version: 'editorial-motion-v1', canvas: {width: 1920, height: 1080},
        objects: [source, {...source, id: 'input', kind: 'window', label: '模型窗口', x: 1050,
          y: 330, width: 720, height: 530, initiallyVisible: true},
        {...source, id: 'copy', sourceId: 'source'}],
        events: [event('reveal', '展示来源', 'reveal', 'source'),
          event('copy', '把资料复制到窗口', 'copy', 'source', {targetId: 'copy'}),
          event('transfer', '把资料复制到窗口', 'transfer', 'copy', {atFrame: copyFrame + 3,
            durationFrames: 24, targetId: 'input', value: {x: 1130, y: 620}, requires: [`${id}-copy`]}),
          event('arrive', '把资料复制到窗口', 'arrive', 'copy', {atFrame: copyFrame + 27,
            targetId: 'input', requires: [`${id}-transfer`]}),
          event('focus', '复制完成后说明', 'focus', 'copy')]} };
  });
  const voiceTiming = {schemaVersion: 'editorial-voice-timing-v1', sampleRate: 24000,
    alignmentMethod: 'synthesis-segment-sample-boundaries-v1', captionDurationIssues: [],
    sourceTextSha256: sha(scenes.map(s => s.narration.replace(/\n/gu, '')).join(''))};
  // Deliberately construct measured boundaries independently of the estimate.
  let cursor = 0;
  voiceTiming.segments = scenes.flatMap((scene, sceneIndex) => ['展示来源。', '把资料复制到窗口。复制完成后说明。']
    .map((text, index) => {
      const sampleCount = index === 0 ? 48001 + sceneIndex : secondSampleCount + sceneIndex;
      const startSample = cursor, endSample = cursor + sampleCount;
      const pauseAfterSamples = index === 1 && sceneIndex < 2 ? 4800
        : index === 0 && scene.unitIds.length === 2 ? 2880 : 0;
      cursor = endSample + pauseAfterSamples;
      return {id: `s-${sceneIndex}-${index}`, sceneId: scene.id,
        unitId: scene.unitIds.length === 2 ? scene.unitIds[index] : scene.unitIds[0], text,
        textSha256: sha(text), sampleCount, startSample, endSample, pauseAfterSamples, nextSample: cursor};
    }));
  voiceTiming.captions = voiceTiming.segments.map(s => ({text: s.text, startMs: s.startSample / 24,
    endMs: s.endSample / 24, timestampMs: null, confidence: null}));
  voiceTiming.scenes = scenes.map(s => {
    const segments = voiceTiming.segments.filter(x => x.sceneId === s.id);
    return {id: s.id, startSample: segments[0].startSample, endSample: segments.at(-1).nextSample};
  });
  voiceTiming.units = scenes.flatMap(scene => scene.unitIds.map(id => {
    const segments = voiceTiming.segments.filter(x => x.unitId === id);
    return {id, sceneId: scene.id, startSample: segments[0].startSample, endSample: segments.at(-1).nextSample};
  }));
  voiceTiming.totalSamples = cursor;
  voiceTiming.durationSeconds = cursor / 24000;
  return {episode: {id: 'synthetic-av', scenes, subtitles: [], render: {fps: 30,
    durationSeconds: 30, compositionId: 'ConceptPreview', width: 1920, height: 1080},
  approvals: {assets: {status: 'pending'}, final: {status: 'pending'}}}, voiceTiming};
}

test('measured boundaries retime scenes and captions without mutating narration, geometry or approvals', () => {
  const input = fixture(), original = structuredClone(input);
  const result = compileEditorialAudioVisualTiming(input);
  assert.deepEqual(input, original);
  assert.equal(result.timing.durationInFrames, Math.ceil(input.voiceTiming.totalSamples / 800));
  assert.equal(result.timing.motionPlacementMethod, 'editorial-estimate-within-measured-segment-v1');
  assert.equal(result.timing.wordAligned, false);
  assert.ok(result.timing.geometrySampleCount > 20);
  for (const [i, s] of result.episode.scenes.entries()) {
    assert.equal(s.startFrame, Math.ceil(input.voiceTiming.scenes[i].startSample / 800));
    assert.equal(s.endFrame, Math.ceil(input.voiceTiming.scenes[i].endSample / 800));
    assert.equal(s.narration, input.episode.scenes[i].narration);
    assert.deepEqual(s.motionPlan.objects, input.episode.scenes[i].motionPlan.objects);
    assert.equal(s.motionPlan.events[2].durationFrames, 24);
    assert.equal(s.motionPlan.events[3].atFrame - s.motionPlan.events[2].atFrame, 24);
    assert.ok(s.motionPlan.events[4].atFrame > s.motionPlan.events[3].atFrame);
  }
  assert.deepEqual(result.episode.approvals, input.episode.approvals);
  for (const [i, cue] of result.episode.subtitles.entries()) {
    assert.equal(cue.startFrame, Math.ceil(input.voiceTiming.segments[i].startSample / 800));
    assert.equal(cue.endFrame, Math.ceil(input.voiceTiming.segments[i].endSample / 800));
    assert.equal(cue.text, input.voiceTiming.segments[i].text);
  }
});

test('different cues inside one measured phrase do not collapse onto the same start frame', () => {
  const result = compileEditorialAudioVisualTiming(fixture());
  const bindings = result.timing.eventBindings.filter(x => x.sceneId === 'A');
  assert.equal(bindings[1].segmentId, bindings[4].segmentId);
  assert.equal(bindings[1].placement, 'measured-segment-start');
  assert.equal(bindings[4].placement, 'editorial-estimate-within-segment');
  assert.ok(bindings[4].atFrame > bindings[1].atFrame);
});

test('reject mismatched text, identities, units, sample lineage, captions and source hashes', () => {
  for (const mutate of [
    x => {x.voiceTiming.segments[0].text += '改';},
    x => {x.voiceTiming.sourceTextSha256 = '0'.repeat(64);},
    x => {x.voiceTiming.segments[0].textSha256 = '0'.repeat(64);},
    x => {x.voiceTiming.segments[0].sceneId = 'other';},
    x => {x.voiceTiming.segments[0].unitId = 'B:p1';},
    x => {x.voiceTiming.segments[1].startSample++;},
    x => {x.voiceTiming.segments[1].id = x.voiceTiming.segments[0].id;},
    x => {x.voiceTiming.scenes[0].endSample++;},
    x => {x.voiceTiming.units[0].id = 'other';},
    x => {x.voiceTiming.captions[0].startMs = 1;},
    x => {x.voiceTiming.totalSamples++;},
    x => {x.voiceTiming.sampleRate = 44100;},
    x => {x.episode.render.fps = 60;},
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => compileEditorialAudioVisualTiming(input));
  }
});

test('reject missing or ambiguous cues and motion collision or overflow', () => {
  for (const mutate of [
    x => {x.episode.scenes[0].motionPlan.events[0].cue = '不存在';},
    x => {x.episode.scenes[0].motionPlan.events[1].cue = '复制';},
    x => {x.episode.scenes[0].motionPlan.events[2].durationFrames = 300;},
    x => {x.episode.scenes[0].motionPlan.events[4].atFrame = 299;},
    x => {x.episode.scenes[0].motionPlan.objects[0].x = 1900;},
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => compileEditorialAudioVisualTiming(input));
  }
});

test('retiming refuses a valid source action chain that cannot fit shorter measured speech', () => {
  const collision = fixture({secondSampleCount: 43200});
  const events = collision.episode.scenes[0].motionPlan.events;
  events[2].durationFrames = 40;
  events[3].atFrame = events[2].atFrame + 40;
  assert.throws(() => compileEditorialAudioVisualTiming(collision),
    {code: 'editorial_av_motion_collision_or_overflow'});
  const overflow = fixture({secondSampleCount: 43200});
  // The original ten-second scene permits this bounded delay; the measured
  // scene is shorter, so the compiler must reject instead of extending audio.
  overflow.episode.scenes[0].motionPlan.events.at(-1).atFrame += 90;
  assert.throws(() => compileEditorialAudioVisualTiming(overflow),
    {code: 'editorial_av_motion_collision_or_overflow'});
});

test('clip ranges bind contiguous whole scenes to source samples and frame-quantized boundaries', () => {
  const input = fixture(), result = compileEditorialAudioVisualTiming(input);
  const clipSpecs = [{id: 'clip-01', sceneIds: ['A']}, {id: 'clip-02', sceneIds: ['B', 'C']}];
  const clips = buildEditorialAudioVisualClipRanges({episode: result.episode,
    voiceTiming: input.voiceTiming, clipSpecs});
  assert.equal(clips[0].fromFrame, 0);
  assert.equal(clips[0].toFrameExclusive, result.episode.scenes[0].endFrame);
  assert.equal(clips[1].endSample, input.voiceTiming.totalSamples);
  assert.equal(clips[1].startSeconds, clips[1].fromFrame / 30);
  assert.ok(clips.every(c => Math.abs(c.startSeconds - c.sampleTimeStartSeconds) < 1 / 30));
  for (const invalid of [[], [{id: 'x', sceneIds: ['A', 'C']}], [{id: 'x', sceneIds: ['D']}],
    [{id: 'x', sceneIds: ['A']}, {id: 'x', sceneIds: ['B']}],
    [{id: 'x', sceneIds: ['A', 'B']}, {id: 'y', sceneIds: ['B']}],
    [{id: '../escape', sceneIds: ['A']}]]) {
    assert.throws(() => buildEditorialAudioVisualClipRanges({episode: result.episode,
      voiceTiming: input.voiceTiming, clipSpecs: invalid}));
  }
});

test('interior unit trims preserve the first speech samples without borrowing a prior scene frame', () => {
  const input = fixture({splitUnits: true}), result = compileEditorialAudioVisualTiming(input);
  const clips = buildEditorialAudioVisualClipRanges({episode: result.episode, voiceTiming: input.voiceTiming,
    clipSpecs: [{id: 'trimmed', sceneIds: ['A'], startUnitId: 'A:p2'}]});
  assert.equal(clips[0].startSample, input.voiceTiming.units[1].startSample);
  assert.equal(clips[0].fromFrame, Math.floor(clips[0].startSample / 800));
  assert.ok(clips[0].startSeconds <= clips[0].sampleTimeStartSeconds);
  assert.ok(clips[0].sampleTimeStartSeconds - clips[0].startSeconds < 1 / 30);
  for (const spec of [{id: 'bad', sceneIds: ['A'], startUnitId: 'B:p1'},
    {id: 'bad', sceneIds: ['A'], startUnitId: 'A:p2', endUnitId: 'A:p1'},
    {id: 'bad', sceneIds: ['A'], unexpected: true}]) {
    assert.throws(() => buildEditorialAudioVisualClipRanges({episode: result.episode,
      voiceTiming: input.voiceTiming, clipSpecs: [spec]}));
  }
});

test('review selection rejects more than three clips and over 150 seconds', () => {
  const input = fixture(), result = compileEditorialAudioVisualTiming(input);
  assert.throws(() => buildEditorialAudioVisualClipRanges({episode: result.episode,
    voiceTiming: input.voiceTiming, clipSpecs: ['A', 'B', 'C', 'A'].map((id, i) =>
      ({id: `clip-${i}`, sceneIds: [id]}))}));
  // A synthetic already-retimed 151-second scene tests the independent preview cap.
  const measured = structuredClone(input.voiceTiming);
  const projected = structuredClone(result.episode);
  projected.scenes = [{...projected.scenes[0], endFrame: 4530, end: 151}];
  measured.scenes = [{id: 'A', startSample: 0, endSample: 151 * 24000}];
  measured.units = [{id: 'A:p1', sceneId: 'A', startSample: 0, endSample: 151 * 24000}];
  assert.throws(() => buildEditorialAudioVisualClipRanges({episode: projected, voiceTiming: measured,
    clipSpecs: [{id: 'too-long', sceneIds: ['A']}]}), {code: 'editorial_av_clip_review_duration_limit'});
});
