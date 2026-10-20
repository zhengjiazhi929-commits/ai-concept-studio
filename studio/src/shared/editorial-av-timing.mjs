import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {EDITORIAL_TIMING_POLICY, cueFrameForNarration} from './editorial-timing.mjs';
import {validateEditorialMotionPlan} from './editorial-motion.mjs';
import {applyEditorialPacingRevision} from './editorial-av-pacing.mjs';
import {compileEditorialMotionRenderEpisode, buildEditorialMotionRenderModel}
  from '../video/editorial-motion-render-model.mjs';

const fps = 30;
const sampleRate = 24000;
const sha = value => createHash('sha256').update(value).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}$/u.test(value);
const frameAt = sample => Math.ceil(sample * fps / sampleRate);
function requireValue(condition, code = 'editorial_av_timing_invalid') {
  if (!condition) throw Object.assign(new Error('音画审核候选无法由原分镜和实测短句边界安全复算'), {code});
}
const flatNarration = value => value.replace(/\r\n/gu, '\n').replace(/\n\n/gu, '');
const equals = isDeepStrictEqual;

// Only intra-segment motion is an editorial estimate. These are the existing
// estimate policy's integer ticks, NOT measured word times. Audio is never moved.
function estimatedTicks(value) {
  return value.replace(/[\s，。！？；：、“”‘’（）《》…—,.!?;:'"()\[\]{}-]/gu, '').length * 100
    + (value.match(/[，、：；,;:]/gu)?.length ?? 0) * 77
    + (value.match(/[。！？.!?]/gu)?.length ?? 0) * 176;
}

function inspectSource(episode, timing) {
  requireValue(episode?.render?.fps === fps && episode.render.width === 1920
    && episode.render.height === 1080 && Array.isArray(episode.scenes)
    && episode.scenes.length > 0 && episode.scenes.length <= 64);
  requireValue(['editorial-voice-timing-v1', 'editorial-voice-retake-timing-v1'].includes(timing?.schemaVersion)
    && timing.alignmentMethod === 'synthesis-segment-sample-boundaries-v1'
    && timing.sampleRate === sampleRate && Array.isArray(timing.segments)
    && timing.segments.length > 0 && timing.segments.length <= 4096
    && Array.isArray(timing.captionDurationIssues) && timing.captionDurationIssues.length === 0);
  const sourceScenes = new Set(), sourceUnits = new Set(), originalUnits = [];
  let sourceText = '';
  for (const scene of episode.scenes) {
    requireValue(identifier(scene.id) && !sourceScenes.has(scene.id)
      && typeof scene.narration === 'string' && scene.narration.length > 0
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(scene.narration)
      && Array.isArray(scene.unitIds) && scene.unitIds.length > 0
      && integer(scene.startFrame) && integer(scene.endFrame) && scene.endFrame > scene.startFrame);
    sourceScenes.add(scene.id);
    const paragraphs = scene.narration.replace(/\r\n/gu, '\n').split('\n\n');
    requireValue(paragraphs.length === scene.unitIds.length && paragraphs.every(x => x.length > 0 && !/[\r\n]/u.test(x)));
    for (const [index, id] of scene.unitIds.entries()) {
      requireValue(identifier(id) && !sourceUnits.has(id));
      sourceUnits.add(id);
      originalUnits.push({id, sceneId: scene.id, text: paragraphs[index]});
    }
    sourceText += paragraphs.join('');
    requireValue(validateEditorialMotionPlan(scene.motionPlan,
      {narration: scene.narration, durationInFrames: scene.endFrame - scene.startFrame}).valid,
    'editorial_av_source_motion_invalid');
  }
  requireValue(timing.sourceTextSha256 === sha(sourceText), 'editorial_av_source_text_mismatch');
  let cursor = 0;
  const segmentIds = new Set(), scenes = [], units = [], captions = [], texts = new Map();
  for (const [index, segment] of timing.segments.entries()) {
    const next = timing.segments[index + 1];
    requireValue(identifier(segment.id) && !segmentIds.has(segment.id)
      && sourceScenes.has(segment.sceneId) && sourceUnits.has(segment.unitId)
      && typeof segment.text === 'string' && segment.text.length > 0 && !/[\r\n]/u.test(segment.text)
      && segment.textSha256 === sha(segment.text) && integer(segment.sampleCount)
      && segment.sampleCount >= sampleRate * 1.8 && segment.sampleCount <= sampleRate * 5.5
      && segment.startSample === cursor && segment.endSample === cursor + segment.sampleCount);
    segmentIds.add(segment.id);
    const pause = !next ? 0 : next.sceneId !== segment.sceneId ? 4800
      : next.unitId !== segment.unitId ? 2880 : 0;
    requireValue(segment.pauseAfterSamples === pause && segment.nextSample === segment.endSample + pause);
    cursor = segment.nextSample;
    if (scenes.at(-1)?.id !== segment.sceneId) scenes.push({id: segment.sceneId,
      startSample: segment.startSample, endSample: cursor});
    else scenes.at(-1).endSample = cursor;
    if (units.at(-1)?.id !== segment.unitId) units.push({id: segment.unitId, sceneId: segment.sceneId,
      startSample: segment.startSample, endSample: cursor});
    else {
      requireValue(units.at(-1).sceneId === segment.sceneId);
      units.at(-1).endSample = cursor;
    }
    texts.set(segment.unitId, (texts.get(segment.unitId) ?? '') + segment.text);
    captions.push({text: segment.text, startMs: segment.startSample * 1000 / sampleRate,
      endMs: segment.endSample * 1000 / sampleRate, timestampMs: null, confidence: null});
  }
  requireValue(integer(cursor) && cursor <= sampleRate * 3600 && timing.totalSamples === cursor
    && timing.durationSeconds === cursor / sampleRate && equals(timing.scenes, scenes)
    && equals(timing.units, units) && equals(timing.captions, captions)
    && equals(scenes.map(x => x.id), episode.scenes.map(x => x.id))
    && equals(units.map(x => ({id: x.id, sceneId: x.sceneId})),
      originalUnits.map(x => ({id: x.id, sceneId: x.sceneId})))
    && originalUnits.every(unit => texts.get(unit.id) === unit.text)
    && timing.segments.map(x => x.text).join('') === sourceText,
  'editorial_av_source_boundary_mismatch');
}

/** Pure review projection. It neither commits Episode state nor grants a Gate. */
export function compileEditorialAudioVisualTiming({episode, voiceTiming, pacing}) {
  inspectSource(episode, voiceTiming);
  let candidate = structuredClone(episode);
  let eventBindings = [];
  candidate.scenes = episode.scenes.map((source, index) => {
    const measuredScene = voiceTiming.scenes[index];
    const narration = flatNarration(source.narration);
    let position = 0;
    const segments = voiceTiming.segments.filter(x => x.sceneId === source.id).map(segment => {
      const startCharacter = position;
      position += segment.text.length;
      return {...segment, startCharacter, endCharacter: position};
    });
    const startFrame = frameAt(measuredScene.startSample), endFrame = frameAt(measuredScene.endSample);
    const motionPlan = structuredClone(source.motionPlan);
    let previousFrame = -1;
    motionPlan.events = source.motionPlan.events.map(event => {
      const cuePosition = narration.indexOf(event.cue);
      requireValue(cuePosition >= 0 && narration.indexOf(event.cue, cuePosition + 1) === -1,
        'editorial_av_cue_missing_or_ambiguous');
      const segment = segments.find(x => cuePosition >= x.startCharacter && cuePosition < x.endCharacter);
      requireValue(segment && cuePosition + event.cue.length <= segment.endCharacter,
        'editorial_av_cue_spans_segments');
      const prefixTicks = estimatedTicks(narration.slice(segment.startCharacter, cuePosition));
      const segmentTicks = estimatedTicks(segment.text);
      requireValue(segmentTicks > 0 && prefixTicks < segmentTicks);
      const originalCueFrame = cueFrameForNarration(source.narration, event.cue, EDITORIAL_TIMING_POLICY);
      const causalDelayFrames = event.atFrame - originalCueFrame;
      requireValue(integer(causalDelayFrames) && causalDelayFrames <= 90,
        'editorial_av_causal_delay_invalid');
      const anchorSampleEstimate = segment.startSample + segment.sampleCount * prefixTicks / segmentTicks;
      const anchorFrame = Math.ceil(anchorSampleEstimate * fps / sampleRate);
      const atFrame = anchorFrame - startFrame + causalDelayFrames;
      requireValue(atFrame >= previousFrame && atFrame + event.durationFrames < endFrame - startFrame,
        'editorial_av_motion_collision_or_overflow');
      previousFrame = atFrame;
      eventBindings.push({sceneId: source.id, eventId: event.id, cue: event.cue,
        segmentId: segment.id, unitId: segment.unitId,
        sourceAtFrame: event.atFrame, atFrame, globalFrame: startFrame + atFrame,
        durationFrames: event.durationFrames, causalDelayFrames,
        measuredSegmentStartSample: segment.startSample, measuredSegmentEndSample: segment.endSample,
        placement: prefixTicks === 0 ? 'measured-segment-start' : 'editorial-estimate-within-segment'});
      return {...event, atFrame};
    });
    const inspection = validateEditorialMotionPlan(motionPlan,
      {narration: source.narration, durationInFrames: endFrame - startFrame});
    requireValue(inspection.valid && !inspection.warnings?.length, 'editorial_av_retimed_motion_invalid');
    return {...structuredClone(source), motionPlan, startFrame, endFrame,
      start: startFrame / fps, end: endFrame / fps};
  });
  candidate.subtitles = voiceTiming.segments.map(segment => ({sceneId: segment.sceneId,
    startFrame: frameAt(segment.startSample), endFrame: frameAt(segment.endSample),
    start: frameAt(segment.startSample) / fps, end: frameAt(segment.endSample) / fps, text: segment.text}));
  const durationInFrames = frameAt(voiceTiming.totalSamples);
  candidate.render = {...candidate.render, durationSeconds: durationInFrames / fps};
  let pacingRevision;
  if (pacing !== undefined) {
    const revised = applyEditorialPacingRevision({episode: candidate, voiceTiming, pacing, sourceEpisode: episode});
    candidate = revised.episode;
    pacingRevision = revised.revision;
    const bindingKey = (sceneId, eventId) => JSON.stringify([sceneId, eventId]);
    const bindings = new Map(eventBindings.map(binding => [bindingKey(binding.sceneId, binding.eventId), binding]));
    for (const binding of pacingRevision.bindings) {
      bindings.set(bindingKey(binding.sceneId, binding.eventId), {...binding, pacingRevised: true});
    }
    eventBindings = candidate.scenes.flatMap(scene => scene.motionPlan.events.map(event => bindings.get(bindingKey(scene.id, event.id))));
  }
  const compiled = compileEditorialMotionRenderEpisode(candidate, fps);
  const samples = new Set();
  for (const scene of candidate.scenes) {
    samples.add(scene.startFrame); samples.add(scene.endFrame - 1);
    for (const event of scene.motionPlan.events) {
      const start = scene.startFrame + event.atFrame;
      const end = start + event.durationFrames;
      for (let frame = start - 1; frame <= end + 1; frame++) {
        if (frame >= scene.startFrame && frame < scene.endFrame) samples.add(frame);
      }
    }
  }
  for (const caption of candidate.subtitles) {
    samples.add(caption.startFrame); samples.add(caption.endFrame - 1);
  }
  for (const frame of samples) {
    try { buildEditorialMotionRenderModel(compiled, frame, fps); }
    catch (cause) { throw Object.assign(new Error(`音画候选第 ${frame} 帧几何校验失败`, {cause}),
      {code: 'editorial_av_geometry_invalid', frame}); }
  }
  return {episode: candidate, timing: {schemaVersion: 'editorial-av-review-timing-v1', fps, sampleRate,
    totalSamples: voiceTiming.totalSamples, durationInFrames, durationSeconds: durationInFrames / fps,
    audioDurationSeconds: voiceTiming.durationSeconds, alignmentMethod: voiceTiming.alignmentMethod,
    motionPlacementMethod: 'editorial-estimate-within-measured-segment-v1', wordAligned: false,
    humanVisualAccepted: false, renderReadyForRelease: false, eventBindings, geometrySampleCount: samples.size,
    ...(pacingRevision ? {pacingRevision} : {})}};
}

/** Whole scenes, or an explicit whole-unit trim within the first/last scene. */
export function buildEditorialAudioVisualClipRanges({episode, voiceTiming, clipSpecs}) {
  requireValue(episode?.render?.fps === fps && Array.isArray(clipSpecs)
    && clipSpecs.length >= 1 && clipSpecs.length <= 3 && Array.isArray(voiceTiming?.scenes)
    && voiceTiming.sampleRate === sampleRate, 'editorial_av_clip_spec_invalid');
  const ids = new Set(), ranges = [];
  for (const spec of clipSpecs) {
    requireValue(spec && Object.keys(spec).every(key => ['id', 'sceneIds', 'startUnitId', 'endUnitId'].includes(key))
      && typeof spec.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(spec.id)
      && !ids.has(spec.id) && Array.isArray(spec.sceneIds) && spec.sceneIds.length > 0,
    'editorial_av_clip_spec_invalid');
    ids.add(spec.id);
    const indexes = spec.sceneIds.map(id => episode.scenes.findIndex(scene => scene.id === id));
    requireValue(indexes.every((value, index) => value >= 0 && (!index || value === indexes[index - 1] + 1)),
      'editorial_av_clip_noncontiguous');
    const first = episode.scenes[indexes[0]], last = episode.scenes[indexes.at(-1)];
    const startUnitId = spec.startUnitId ?? first.unitIds[0];
    const endUnitId = spec.endUnitId ?? last.unitIds.at(-1);
    requireValue(first.unitIds.includes(startUnitId) && last.unitIds.includes(endUnitId),
      'editorial_av_clip_unit_invalid');
    const startUnit = voiceTiming.units.find(unit => unit.id === startUnitId && unit.sceneId === first.id);
    const endUnit = voiceTiming.units.find(unit => unit.id === endUnitId && unit.sceneId === last.id);
    requireValue(startUnit && endUnit && endUnit.endSample > startUnit.startSample,
      'editorial_av_clip_unit_invalid');
    for (const index of indexes) {
      const scene = episode.scenes[index], measured = voiceTiming.scenes[index];
      requireValue(measured?.id === scene.id && scene.startFrame === frameAt(measured.startSample)
        && scene.endFrame === frameAt(measured.endSample), 'editorial_av_clip_timing_mismatch');
    }
    // Interior unit trims can include <1 frame of preceding silence, preserving
    // the first phoneme. Whole scenes stay ceil-aligned to avoid prior-scene flash.
    const interiorUnit = startUnitId !== first.unitIds[0];
    const fromFrame = interiorUnit ? Math.floor(startUnit.startSample * fps / sampleRate)
      : frameAt(startUnit.startSample);
    const toFrameExclusive = frameAt(endUnit.endSample);
    requireValue(fromFrame >= first.startFrame && toFrameExclusive <= last.endFrame
      && toFrameExclusive > fromFrame, 'editorial_av_clip_timing_mismatch');
    const range = {id: spec.id, sceneIds: [...spec.sceneIds], startUnitId, endUnitId,
      fromFrame, toFrameExclusive, durationInFrames: toFrameExclusive - fromFrame,
      startSample: startUnit.startSample, endSample: endUnit.endSample,
      startSeconds: fromFrame / fps, endSeconds: toFrameExclusive / fps,
      sampleTimeStartSeconds: startUnit.startSample / sampleRate,
      sampleTimeEndSeconds: endUnit.endSample / sampleRate};
    requireValue(ranges.every(other => range.toFrameExclusive <= other.fromFrame
      || range.fromFrame >= other.toFrameExclusive), 'editorial_av_clip_overlap');
    ranges.push(range);
  }
  requireValue(ranges.reduce((sum, range) => sum + range.durationInFrames, 0) <= fps * 150,
    'editorial_av_clip_review_duration_limit');
  return ranges;
}
