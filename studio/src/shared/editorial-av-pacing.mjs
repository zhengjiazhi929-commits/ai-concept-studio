import {isDeepStrictEqual} from 'node:util';
import {canonicalJsonDocumentContentSha256} from './durable-json-store.mjs';
import {validateEditorialMotionPlan, resolveEditorialMotionFrame} from './editorial-motion.mjs';

export const editorialPacingMotionPlanSha256 = canonicalJsonDocumentContentSha256;
const digest = canonicalJsonDocumentContentSha256;
const fps = 30, sampleRate = 24000;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/u.test(value);
const flat = text => text.replace(/\r\n/gu, '\n').replace(/\n\n/gu, '');
const frameAt = sample => Math.ceil(sample * fps / sampleRate);
function need(value, code = 'editorial_av_pacing_invalid') {
  if (!value) throw Object.assign(new Error('节奏修订无法在已核验来源和实测短句内安全应用'), {code});
}
function dataOnly(value, seen = new Set(), budget = {left: 10000}, depth = 0) {
  need(--budget.left >= 0 && depth <= 16);
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { need(Number.isFinite(value)); return; }
  need(value && typeof value === 'object' && !seen.has(value));
  need(Array.isArray(value) ? Object.getPrototypeOf(value) === Array.prototype
    : [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    need(typeof key === 'string');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(Object.hasOwn(descriptor, 'value'));
    if (Array.isArray(value) && key === 'length') continue;
    need(descriptor.enumerable);
    dataOnly(descriptor.value, seen, budget, depth + 1);
  }
  if (Array.isArray(value)) need(Object.keys(value).length === value.length
    && Object.keys(value).every((key, index) => key === String(index)));
  seen.delete(value);
}
function fields(value, keys) {
  need(value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
function anchorFields(value) {
  need(typeof value.cue === 'string' && value.cue.trim().length > 0 && value.cue.length <= 2000
    && !/[\u0000-\u001f]/u.test(value.cue)
    && ['cue-start', 'segment-start', 'segment-end'].includes(value.anchor)
    && integer(value.offsetFrames, 0, 180));
}

/** Closed, data-only plan. Source existence and semantic checks happen on apply. */
export function validateEditorialPacingRevisionPlan(pacing) {
  dataOnly(pacing);
  fields(pacing, ['schemaVersion', 'scenes']);
  need(pacing.schemaVersion === 'editorial-av-pacing-v1' && Array.isArray(pacing.scenes)
    && pacing.scenes.length >= 1 && pacing.scenes.length <= 3);
  const scenes = new Set();
  let edits = 0;
  for (const scene of pacing.scenes) {
    fields(scene, ['sceneId', 'sourceMotionPlanSha256', 'retime', 'focus', 'constraints']);
    need(identifier(scene.sceneId) && !scenes.has(scene.sceneId)
      && /^[a-f0-9]{64}$/u.test(scene.sourceMotionPlanSha256)
      && Array.isArray(scene.retime) && scene.retime.length <= 32
      && Array.isArray(scene.focus) && scene.focus.length <= 12
      && Array.isArray(scene.constraints) && scene.constraints.length <= 32
      && scene.retime.length + scene.focus.length > 0);
    scenes.add(scene.sceneId);
    edits += scene.retime.length + scene.focus.length;
    const ids = new Set();
    for (const edit of scene.retime) {
      fields(edit, ['eventId', 'cue', 'anchor', 'offsetFrames']);
      need(identifier(edit.eventId) && !ids.has(edit.eventId)); ids.add(edit.eventId);
      anchorFields(edit);
    }
    for (const focus of scene.focus) {
      fields(focus, ['id', 'objectId', 'cue', 'anchor', 'offsetFrames']);
      need(identifier(focus.id) && identifier(focus.objectId) && !ids.has(focus.id)); ids.add(focus.id);
      anchorFields(focus);
    }
    const constraints = new Set();
    for (const constraint of scene.constraints) {
      fields(constraint, ['afterEventId', 'beforeEventId', 'minFrames']);
      const key = `${constraint.afterEventId}\0${constraint.beforeEventId}`;
      need(identifier(constraint.afterEventId) && identifier(constraint.beforeEventId)
        && constraint.afterEventId !== constraint.beforeEventId && integer(constraint.minFrames, 0, 180)
        && !constraints.has(key)); constraints.add(key);
    }
  }
  need(edits <= 96);
  return structuredClone(pacing);
}

// This is the original timing policy, not a claimed word-level measurement.
function ticks(text) {
  return text.replace(/[\s，。！？；：、“”‘’（）《》…—,.!?;:'"()\[\]{}-]/gu, '').length * 100
    + (text.match(/[，、：；,;:]/gu)?.length ?? 0) * 77
    + (text.match(/[。！？.!?]/gu)?.length ?? 0) * 176;
}
function anchor(scene, segments, edit) {
  const narration = flat(scene.narration), position = narration.indexOf(edit.cue);
  need(position >= 0 && narration.indexOf(edit.cue, position + 1) < 0, 'editorial_av_pacing_cue_ambiguous');
  let cursor = 0;
  const segment = segments.find(value => {
    const start = cursor; cursor += value.text.length;
    return position >= start && position < cursor;
  });
  const startCharacter = cursor - (segment?.text.length ?? 0);
  need(segment && position + edit.cue.length <= cursor, 'editorial_av_pacing_cue_spans_segments');
  const prefix = ticks(narration.slice(startCharacter, position)), total = ticks(segment.text);
  need(total > 0 && prefix < total);
  const sample = edit.anchor === 'segment-start' ? segment.startSample
    : edit.anchor === 'segment-end' ? segment.endSample
      : segment.startSample + segment.sampleCount * prefix / total;
  const placement = edit.anchor === 'segment-end' ? 'measured-segment-end'
    : edit.anchor === 'segment-start' || prefix === 0 ? 'measured-segment-start'
      : 'editorial-estimate-within-segment';
  const atFrame = frameAt(sample) - scene.startFrame + edit.offsetFrames;
  need(integer(atFrame, 0, scene.endFrame - scene.startFrame - 1), 'editorial_av_pacing_overflow');
  return {atFrame, cue: edit.cue, segmentId: segment.id, unitId: segment.unitId,
    globalFrame: scene.startFrame + atFrame, measuredSegmentStartSample: segment.startSample,
    measuredSegmentEndSample: segment.endSample, placement, anchor: edit.anchor, offsetFrames: edit.offsetFrames};
}
function withoutFrame(event) {
  const {atFrame: _frame, ...rest} = event; return rest;
}

// Only explicit source retirement is governed here. Scope resets keep their
// separate approved semantics; this revision does not redefine their policy.
function retentionChecks(plan) {
  const checks = [];
  for (const retire of plan.events.filter(event => event.op === 'retire')) {
    const priorEvents = plan.events.slice(0, plan.events.indexOf(retire));
    const priorState = resolveEditorialMotionFrame({...plan, events: priorEvents}, retire.atFrame);
    const lastReveal = priorEvents.filter(event => event.objectId === retire.objectId
      && event.op === 'reveal').at(-1)?.atFrame ?? 0;
    for (const copy of plan.objects.filter(object => object.sourceId === retire.objectId)) {
      const state = priorState.objects.find(object => object.id === copy.id);
      const creation = priorEvents.findLastIndex(event => ['copy', 'summarize'].includes(event.op) && event.targetId === copy.id);
      // A future, never-created copy or one cleared by a scope reset is not an
      // active copy lifecycle. An already visible copy must finish before its
      // original is retired, even if no arrive event has happened yet.
      if (creation < 0 || state.information.status === 'idle') continue;
      const arrive = priorEvents.slice(creation + 1).filter(event => event.op === 'arrive' && event.objectId === copy.id).at(-1);
      need(arrive || !state.visible, 'editorial_av_pacing_source_retention');
      if (!arrive) continue;
      const start = Math.max(arrive.atFrame + arrive.durationFrames, lastReveal);
      const points = [...new Set([start, retire.atFrame, ...plan.events.flatMap(event =>
        [event.atFrame, event.atFrame + event.durationFrames]).filter(frame => frame >= start && frame <= retire.atFrame)])]
        .sort((a, b) => a - b);
      let stableFrames = 0, run = 0;
      for (let index = 0; index < points.length - 1; index++) {
        const state = resolveEditorialMotionFrame(plan, points[index]);
        const source = state.objects.find(object => object.id === retire.objectId);
        const target = state.objects.find(object => object.id === copy.id);
        const stable = source.visible && target.visible && !source.presentation.inTransit
          && !target.presentation.inTransit && ['included', 'stored'].includes(target.information.status);
        run = stable ? run + points[index + 1] - points[index] : 0;
        stableFrames = Math.max(stableFrames, run);
      }
      need(stableFrames >= 30, 'editorial_av_pacing_source_retention');
      checks.push({sourceId: retire.objectId, copyId: copy.id, arriveEventId: arrive.id,
        retireEventId: retire.id, stableFrames, minimumFrames: 30});
    }
  }
  return checks;
}

/** Pure candidate-only schedule change, never a source or approval mutation. */
export function applyEditorialPacingRevision({episode, voiceTiming, pacing, sourceEpisode}) {
  const plan = validateEditorialPacingRevisionPlan(pacing);
  need(episode?.render?.fps === fps && voiceTiming?.sampleRate === sampleRate
    && Array.isArray(episode.scenes) && Array.isArray(sourceEpisode?.scenes)
    && Array.isArray(voiceTiming.segments) && Array.isArray(voiceTiming.scenes));
  const candidate = structuredClone(episode), scenes = [], bindings = [];
  for (const edit of plan.scenes) {
    const scene = candidate.scenes.find(value => value.id === edit.sceneId);
    const source = sourceEpisode.scenes.find(value => value.id === edit.sceneId);
    const measured = voiceTiming.scenes.find(value => value.id === edit.sceneId);
    need(scene && source && measured, 'editorial_av_pacing_scene_missing');
    need(digest(source.motionPlan) === edit.sourceMotionPlanSha256, 'editorial_av_pacing_source_stale');
    need(scene.narration === source.narration && scene.startFrame === frameAt(measured.startSample)
      && scene.endFrame === frameAt(measured.endSample)
      && isDeepStrictEqual({...scene.motionPlan, events: scene.motionPlan.events.map(withoutFrame)},
        {...source.motionPlan, events: source.motionPlan.events.map(withoutFrame)}),
    'editorial_av_pacing_candidate_source_mismatch');
    const segments = voiceTiming.segments.filter(value => value.sceneId === scene.id);
    need(segments.map(value => value.text).join('') === flat(scene.narration)
      && segments.every(value => integer(value.startSample, 0, Number.MAX_SAFE_INTEGER)
        && integer(value.endSample, value.startSample + 1, Number.MAX_SAFE_INTEGER)
        && value.sampleCount === value.endSample - value.startSample));
    const before = structuredClone(scene.motionPlan), existing = new Map(scene.motionPlan.events.map(event => [event.id, event]));
    const sceneBindings = [];
    for (const retime of edit.retime) {
      const event = existing.get(retime.eventId), sourceEvent = source.motionPlan.events.find(value => value.id === retime.eventId);
      need(event && sourceEvent, 'editorial_av_pacing_event_missing');
      const placement = anchor(scene, segments, retime);
      sceneBindings.push({sceneId: scene.id, eventId: event.id, sourceAtFrame: sourceEvent.atFrame,
        beforeAtFrame: event.atFrame, beforeCue: event.cue, durationFrames: event.durationFrames,
        added: false, ...placement});
      event.atFrame = placement.atFrame; event.cue = placement.cue;
    }
    for (const focus of edit.focus) {
      // The immutable renderer changes page/window/store outlines and card
      // material. Labels deliberately have no focus styling to switch.
      need(!existing.has(focus.id) && scene.motionPlan.objects.some(object => object.id === focus.objectId
        && ['page', 'window', 'store', 'card'].includes(object.kind)),
        'editorial_av_pacing_focus_invalid');
      const placement = anchor(scene, segments, focus);
      scene.motionPlan.events.push({id: focus.id, cue: focus.cue, atFrame: placement.atFrame,
        durationFrames: 0, op: 'focus', objectId: focus.objectId, targetId: null, value: null, requires: []});
      sceneBindings.push({sceneId: scene.id, eventId: focus.id, sourceAtFrame: null, beforeAtFrame: null,
        beforeCue: null, durationFrames: 0, added: true, ...placement});
    }
    scene.motionPlan.events.sort((a, b) => a.atFrame - b.atFrame);
    need(!isDeepStrictEqual(before, scene.motionPlan), 'editorial_av_pacing_no_change');
    const inspection = validateEditorialMotionPlan(scene.motionPlan,
      {narration: scene.narration, durationInFrames: scene.endFrame - scene.startFrame});
    need(inspection.valid && !inspection.warnings?.length, 'editorial_av_pacing_motion_invalid');
    for (const focus of edit.focus) {
      const index = scene.motionPlan.events.findIndex(event => event.id === focus.id);
      const event = scene.motionPlan.events[index];
      const prior = resolveEditorialMotionFrame({...scene.motionPlan, events: scene.motionPlan.events.slice(0, index)}, event.atFrame);
      const final = resolveEditorialMotionFrame(scene.motionPlan, event.atFrame);
      need(prior.focusId !== focus.objectId && final.focusId === focus.objectId,
        'editorial_av_pacing_focus_no_change');
    }
    const events = new Map(scene.motionPlan.events.map(event => [event.id, event]));
    const constraints = edit.constraints.map(constraint => {
      const after = events.get(constraint.afterEventId), beforeEvent = events.get(constraint.beforeEventId);
      need(after && beforeEvent, 'editorial_av_pacing_constraint_event_missing');
      const actualFrames = beforeEvent.atFrame - after.atFrame - after.durationFrames;
      need(actualFrames >= constraint.minFrames, 'editorial_av_pacing_constraint_unsatisfied');
      return {...constraint, actualFrames};
    });
    const retention = retentionChecks(scene.motionPlan);
    bindings.push(...sceneBindings);
    scenes.push({sceneId: scene.id, sourceMotionPlanSha256: edit.sourceMotionPlanSha256,
      beforeMotionPlanSha256: digest(before), afterMotionPlanSha256: digest(scene.motionPlan),
      before: {events: before.events}, after: {events: structuredClone(scene.motionPlan.events)},
      bindings: sceneBindings, constraints, retentionChecks: retention});
  }
  return {episode: candidate, revision: {schemaVersion: 'editorial-av-pacing-revision-v1',
    planSha256: digest(plan), wordAligned: false, humanVisualAccepted: false, sourceMutated: false,
    scenes, bindings}};
}
