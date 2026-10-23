// Bounded data-only motion. Source data, context membership and screen geometry
// are deliberately separate; no callbacks, expressions or executable strings.
import {validEditorialIllustration} from './editorial-illustration-contract.mjs';
import {normalizeEditorialTracks,resolveEditorialTracks} from './editorial-tracks.mjs';
export const EDITORIAL_MOTION_VERSION = 'editorial-motion-v1';
export const EDITORIAL_MOTION_SAFE_RECT = Object.freeze({ x: 96, y: 300, width: 1728, height: 580 });
const compiledPlans = new WeakMap();

const KINDS = new Set(['card', 'page', 'window', 'store', 'tray', 'region', 'label', 'illustration']);
const OPS = new Set(['reveal', 'retire', 'focus', 'copy', 'summarize', 'transfer', 'arrive',
  'check', 'save', 'reset-scope', 'temporary-override', 'invalidate', 'present', 'connect', 'reposition']);
const CONTAINERS = new Set(['window', 'store', 'tray']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/;
const fail = (code) => { throw new Error(code); };
const check = (condition, code) => { if (!condition) fail(code); };
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value, empty = false) => typeof value === 'string'
  && value.length <= 2000 && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const id = (value) => typeof value === 'string' && ID.test(value);
const summaryText = (summaryFields) => `目标：${summaryFields.goal}\n约束：${summaryFields.constraints}\n未解决问题：${summaryFields.openQuestions}`;

function dataTree(value, seen = new Set(), budget = { left: 20000 }) {
  check(--budget.left >= 0, 'motion-data-limit');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') { check(Number.isFinite(value), 'motion-nonfinite'); return; }
  check(typeof value === 'object', 'motion-data-only');
  check(!seen.has(value), 'motion-cyclic-data');
  const prototype = Object.getPrototypeOf(value);
  check(Array.isArray(value) ? prototype === Array.prototype : prototype === Object.prototype || prototype === null,
    'motion-plain-data');
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    check(typeof key === 'string', 'motion-symbol-field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    check(Object.hasOwn(descriptor, 'value'), 'motion-accessor-field');
    if (Array.isArray(value) && key === 'length') continue;
    check(descriptor.enumerable, 'motion-hidden-field');
    dataTree(descriptor.value, seen, budget);
  }
  if (Array.isArray(value)) {
    check(Object.keys(value).length === value.length, 'motion-sparse-array');
    check(Object.keys(value).every((key, index) => key === String(index)), 'motion-array-fields');
  }
  seen.delete(value);
}

export function assertEditorialRenderData(value) {
  dataTree(value,new Set(),{left:250000});
}

function fields(value, required, optional = []) {
  check(value && !Array.isArray(value) && typeof value === 'object', 'motion-object-required');
  const allowed = new Set([...required, ...optional]);
  check(Object.keys(value).every((key) => allowed.has(key)) && required.every((key) => Object.hasOwn(value, key)),
    'motion-closed-fields');
}

function lineCount(value, size, width) {
  return value.split('\n').reduce((sum, line) => {
    const units = [...line].reduce((total, char) => total + (/[^\u0000-\u007f]/u.test(char) ? 1 : 0.6), 0);
    return sum + Math.max(1, Math.ceil(units * size / width));
  }, 0);
}

function textFits(object, effectiveValue = null) {
  const card = object.kind === 'card';
  const padding = card ? 46 : 22;
  const titleSize = card ? 48 : 44;
  const bodySize = card ? 36 : 32;
  const width = object.width - padding * 2;
  check(width >= titleSize, 'motion-text-width');
  const detail = effectiveValue !== null && effectiveValue !== object.label ? effectiveValue : object.detail;
  const height = padding * 2 + (object.kind === 'illustration' ? 170 : 0) + (object.label?lineCount(object.label, titleSize, width) * titleSize * 1.3:0)
    + (detail ? 8 + lineCount(detail, bodySize, width) * bodySize * 1.4 : 0);
  check(height <= object.height, 'motion-text-overflow');
}

function inside(child, parent, position = child) {
  const headerHeight = 22 + lineCount(parent.label, 44, parent.width - 44) * 44 * 1.3
    + (parent.detail ? 8 + lineCount(parent.detail, 32, parent.width - 44) * 32 * 1.4 : 0) + 24;
  return position.x >= parent.x + 24 && position.y >= parent.y + Math.max(96, headerHeight)
    && position.x + child.width <= parent.x + parent.width - 24
    && position.y + child.height <= parent.y + parent.height - 24;
}

function normalize(plan, { narration, durationInFrames } = {}) {
  dataTree(plan);
  fields(plan, ['version', 'canvas', 'objects', 'events'], ['tracks']);
  check(plan.version === EDITORIAL_MOTION_VERSION, 'motion-version');
  fields(plan.canvas, ['width', 'height']);
  check(plan.canvas.width === 1920 && plan.canvas.height === 1080, 'motion-canvas');
  check(Array.isArray(plan.objects) && plan.objects.length > 0 && plan.objects.length <= 128, 'motion-objects');
  check(Array.isArray(plan.events) && plan.events.length <= 512, 'motion-events');
  if (narration !== undefined) check(text(narration), 'motion-narration');
  if (durationInFrames !== undefined) check(integer(durationInFrames, 1, 108000), 'motion-duration');
  const objects = new Map();
  for (const object of plan.objects) {
    fields(object, ['id', 'kind', 'label', 'detail', 'x', 'y', 'width', 'height', 'scopeId', 'sourceId', 'initiallyVisible'],
      ['value', 'scopeMode', 'containerId', 'summaryFields', 'transformation', 'illustration', 'regionId']);
    check(id(object.id) && !objects.has(object.id) && KINDS.has(object.kind) && id(object.scopeId), 'motion-object-identity');
    check(object.kind === 'illustration' ? validEditorialIllustration(object.illustration)
      && object.width>=300 && object.sourceId === null && !object.containerId : !Object.hasOwn(object,'illustration'), 'motion-illustration-kind');
    check(!object.regionId || id(object.regionId), 'motion-region-id');
    check(text(object.label,['illustration','tray'].includes(object.kind)) && text(object.detail, true), 'motion-object-text');
    check(typeof object.initiallyVisible === 'boolean', 'motion-object-visibility');
    check(object.sourceId === null || id(object.sourceId), 'motion-source-id');
    check(!Object.hasOwn(object, 'scopeMode') || ['local', 'shared'].includes(object.scopeMode), 'motion-scope-mode');
    check(!Object.hasOwn(object, 'value') || text(object.value), 'motion-value');
    if (Object.hasOwn(object, 'summaryFields')) {
      fields(object.summaryFields, ['goal', 'constraints', 'openQuestions']);
      check(Object.values(object.summaryFields).every((value) => text(value) && value.length <= 160 && !value.includes('\n')),
        'motion-summary-fields');
      check(Object.values(object.summaryFields).every((value) => object.detail.includes(value)), 'motion-summary-hidden-source-fields');
      // The render model prefers a non-label value over detail. A field hidden
      // behind that visible body cannot count as preserved source information.
      const displayedBody = object.value && object.value !== object.label ? object.value : object.detail;
      check(Object.values(object.summaryFields).every((value) => displayedBody.includes(value)), 'motion-summary-hidden-source-fields');
    }
    if (Object.hasOwn(object, 'transformation')) check(object.transformation === 'summary'
      && object.sourceId !== null && object.summaryFields, 'motion-transformation');
    check(!Object.hasOwn(object, 'containerId') || object.containerId === null || id(object.containerId), 'motion-container-id');
    check(['x', 'y', 'width', 'height'].every((key) => integer(object[key], key === 'width' || key === 'height' ? 1 : 0, 8192)),
      'motion-geometry');
    check(object.x + object.width <= plan.canvas.width && object.y + object.height <= plan.canvas.height, 'motion-outside-canvas');
    check(object.x >= 96 && object.y >= 300 && object.x + object.width <= 1824 && object.y + object.height <= 880,
      'motion-outside-content-safe-area');
    textFits(object);
    objects.set(object.id, { ...object, scopeMode: object.scopeMode ?? 'local', value: object.value ?? object.label,
      containerId: object.containerId ?? null });
  }
  for (const object of objects.values()) {
    if (object.sourceId !== null) {
      const source = objects.get(object.sourceId);
      check(source && source.id !== object.id && source.kind === object.kind && !CONTAINERS.has(source.kind), 'motion-copy-source');
      check(source.transformation !== 'summary', 'motion-summary-not-persistent-source');
      const lineage = new Set([object.id]);
      let ancestor = source;
      while (ancestor) {
        check(!lineage.has(ancestor.id), 'motion-copy-lineage-cycle');
        lineage.add(ancestor.id);
        if (ancestor.sourceId === null) break;
        ancestor = objects.get(ancestor.sourceId);
        check(ancestor, 'motion-copy-lineage-source');
      }
      check(!object.initiallyVisible && object.containerId === null, 'motion-copy-must-start-hidden');
      if (object.transformation === 'summary') {
        check(source.sourceId === null && source.summaryFields && object.scopeId === source.scopeId
          && ['goal', 'constraints', 'openQuestions'].every((key) => object.summaryFields[key] === source.summaryFields[key]),
          'motion-summary-source-fields');
        check(object.detail === summaryText(source.summaryFields) && object.value === summaryText(source.summaryFields),
          'motion-summary-deterministic-content');
      } else {
        check(object.label === source.label && object.detail === source.detail && object.value === source.value,
          'motion-copy-content-identity');
      }
      check(source.scopeMode === 'shared' || source.scopeId === object.scopeId, 'motion-cross-scope-copy');
      check(source.scopeMode === 'shared' || object.scopeMode === 'local', 'motion-copy-scope-promotion');
    }
    if (object.containerId !== null) {
      const container = objects.get(object.containerId);
      check(container && CONTAINERS.has(container.kind) && container.id !== object.id && container.containerId === null,
        'motion-initial-container');
      check(inside(object, container), 'motion-initial-containment');
      check(object.scopeId === container.scopeId || object.scopeMode === 'shared', 'motion-container-scope');
    }
    if(object.regionId) check(objects.get(object.regionId)?.kind==='region' && object.regionId!==object.id,
      'motion-region-parent');
  }
  const prior = new Map();
  let previousFrame = -1;
  let previousCue = 0;
  for (const event of plan.events) {
    fields(event, ['id', 'cue', 'atFrame', 'durationFrames', 'op', 'objectId', 'targetId', 'value', 'requires']);
    check(id(event.id) && !prior.has(event.id) && OPS.has(event.op), 'motion-event-identity');
    check(text(event.cue) && integer(event.atFrame, 0, 108000) && integer(event.durationFrames, 0, 108000), 'motion-event-time');
    check(event.atFrame >= previousFrame, 'motion-events-not-monotonic');
    if (durationInFrames !== undefined) check(event.atFrame < durationInFrames
      && event.atFrame + event.durationFrames < durationInFrames, 'motion-event-outside-shot');
    if (narration !== undefined) {
      const occurrence = narration.indexOf(event.cue, previousCue);
      check(occurrence !== -1, 'motion-cue-not-in-narration-order');
      previousCue = occurrence;
    }
    check(Array.isArray(event.requires) && event.requires.length <= 32 && new Set(event.requires).size === event.requires.length,
      'motion-event-dependencies');
    for (const dependency of event.requires) check(id(dependency) && prior.has(dependency)
      && prior.get(dependency) <= event.atFrame, 'motion-unfinished-dependency');
    check(event.op === 'reset-scope' ? event.objectId === null : objects.has(event.objectId), 'motion-event-object');
    const targeted = ['copy', 'summarize', 'transfer', 'arrive', 'save', 'connect'].includes(event.op);
    check(targeted ? objects.has(event.targetId) : event.targetId === null, 'motion-event-target');
    check(['transfer','connect','reposition'].includes(event.op) ? event.durationFrames > 0 : event.durationFrames === 0, 'motion-event-duration');
    if (event.op === 'transfer') {
      fields(event.value, ['x', 'y']);
      check(integer(event.value.x, 0, 8192) && integer(event.value.y, 0, 8192), 'motion-transfer-position');
    } else if (event.op === 'reposition') {
      fields(event.value,['x','y']);
      const subject=objects.get(event.objectId);
      check(['page','label'].includes(subject.kind) && subject.sourceId===null && !subject.containerId
        && !subject.regionId && ![...objects.values()].some(item=>item.sourceId===subject.id), 'motion-reposition-root');
      check(integer(event.value.x,96,1824) && integer(event.value.y,300,880)
        && event.durationFrames<=90, 'motion-reposition-position');
    } else if (event.op === 'connect') {
      fields(event.value,['route']);
      check(['direct','return'].includes(event.value.route) && event.objectId !== event.targetId
        && event.durationFrames <= 60, 'motion-relationship-route');
    } else if (event.op === 'present') {
      fields(event.value,['label','detail','variant'],['box','regionId']);
      const subject=objects.get(event.objectId);
      check(text(event.value.label,['illustration','tray'].includes(subject.kind)) && text(event.value.detail,true)
        && (subject.kind === 'illustration' ? validEditorialIllustration(subject.illustration,event.value.variant)
          : event.value.variant === 'neutral'), 'motion-presentation-copy');
      // Presentation edits cannot rewrite a source later used by copy/save.
      check(subject.sourceId === null && subject.value === subject.label && !subject.summaryFields
        && ![...objects.values()].some(item=>item.sourceId === subject.id), 'motion-presentation-source');
      if(event.value.box){
        fields(event.value.box,['x','y','width','height']);
        check(Object.values(event.value.box).every(v=>integer(v,1,1920)), 'motion-presentation-box');
        const b=event.value.box;
        check(b.x>=96 && b.y>=300 && b.x+b.width<=1824 && b.y+b.height<=880
          && (subject.kind!=='illustration' || b.width>=300), 'motion-presentation-safe-area');
      }
      if(Object.hasOwn(event.value,'regionId')) check(event.value.regionId===null
        || objects.get(event.value.regionId)?.kind==='region' && event.value.regionId!==subject.id, 'motion-region-parent');
      textFits({...subject,...event.value.box,label:event.value.label,detail:event.value.detail});
    } else if (event.op === 'reset-scope') {
      fields(event.value, ['scopeId', 'keepIds']);
      check(id(event.value.scopeId) && [...objects.values()].some((object) => object.scopeId === event.value.scopeId), 'motion-reset-scope');
      check(Array.isArray(event.value.keepIds) && new Set(event.value.keepIds).size === event.value.keepIds.length
        && event.value.keepIds.every((key) => objects.get(key)?.scopeId === event.value.scopeId), 'motion-reset-keep');
    } else if (event.op === 'check') check(['passed', 'rejected'].includes(event.value), 'motion-check-result');
    else if (event.op === 'temporary-override') check(text(event.value), 'motion-override-value');
    else check(event.value === null, 'motion-event-value');
    prior.set(event.id, event.atFrame + event.durationFrames);
    previousFrame = event.atFrame;
  }
  const tracks=Object.hasOwn(plan,'tracks')?normalizeEditorialTracks(plan.tracks,
    {narration,durationInFrames,safeRect:EDITORIAL_MOTION_SAFE_RECT}):[];
  return { canvas: { ...plan.canvas }, objects, events: plan.events, tracks };
}

function initial(object) {
  return { ...object, visible: object.initiallyVisible,
    information: { value: object.value, status: object.containerId ? 'included' : 'idle',
      containerId: object.containerId, recallActive: true, checkStatus: null },
    presentation: { x: object.x, y: object.y, opacity: object.initiallyVisible ? 1 : 0, inTransit: false },
    created: object.sourceId === null, persisted: false, transfer: null, move: null };
}

function run(normalized, frame, { inspect = true } = {}) {
  const states = new Map([...normalized.objects].map(([key, object]) => [key, initial(object)]));
  let focusId = null;
  const relationships = new Map();
  const retireRelationships = objectId => {
    for (const [key, relation] of relationships) {
      if (relation.fromId === objectId || relation.toId === objectId) relationships.delete(key);
    }
  };
  const warnings = new Map();
  const show = (object, visible) => { object.visible = visible; object.presentation.opacity = visible ? 1 : 0; };
  const positionAt = (transfer, atFrame) => {
    const progress = Math.max(0, Math.min(1, (atFrame - transfer.atFrame) / transfer.durationFrames));
    const dx = transfer.to.x - transfer.from.x;
    const dy = transfer.to.y - transfer.from.y;
    const distance = (Math.abs(dx) + Math.abs(dy)) * progress;
    return { x: transfer.from.x + Math.sign(dx) * Math.min(Math.abs(dx), distance),
      y: transfer.from.y + Math.sign(dy) * Math.max(0, distance - Math.abs(dx)), progress };
  };
  const advance = (atFrame) => {
    for (const object of states.values()) {
      if(object.move){
        const {x,y,progress}=positionAt(object.move,atFrame);
        object.x=x;object.y=y;object.presentation.x=x;object.presentation.y=y;
        object.presentation.inTransit=progress<1;
        if(progress===1)object.move=null;
      }
      if (!object.transfer) continue;
      const transfer = object.transfer;
      const { x, y, progress } = positionAt(transfer, atFrame);
      object.x = x;
      object.y = y;
      object.presentation.x = object.x;
      object.presentation.y = object.y;
      object.presentation.inTransit = progress < 1;
      if (progress === 1 && object.information.status === 'in-transit') object.information.status = 'arrived';
    }
  };
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
  const originContainer = (object) => states.get(object.sourceId)?.information.containerId;
  const related = (a, b) => a.sourceId === b.id || b.sourceId === a.id
    || a.information.containerId === b.id || b.information.containerId === a.id
    || a.transfer?.targetId === b.id || b.transfer?.targetId === a.id
    || ((a.information.status === 'copied' || a.presentation.inTransit) && originContainer(a) === b.id)
    || ((b.information.status === 'copied' || b.presentation.inTransit) && originContainer(b) === a.id)
    || withinRegion(a,b) || withinRegion(b,a);
  const withinRegion=(child,parent)=>{
    const visited=new Set([child.id]);let next=child.regionId;
    while(next){check(!visited.has(next),'motion-region-cycle');visited.add(next);
      if(next===parent.id)return true;next=states.get(next)?.regionId;}
    return false;
  };
  const inspectVisibility = () => {
    if (!inspect) return;
    const visible = [...states.values()].filter((object) => object.visible);
    for (const object of visible) {
      if (object.information.containerId) check(states.get(object.information.containerId)?.visible, 'motion-member-without-container');
      if(object.regionId){
        const parent=states.get(object.regionId);
        check(parent?.visible && parent.kind==='region','motion-region-hidden');
        check(!withinRegion(parent,object),'motion-region-cycle');
        check(inside(object,{...parent,...parent.presentation.copy}), 'motion-region-containment');
      }
    }
    for (let first = 0; first < visible.length; first += 1) {
      for (let second = first + 1; second < visible.length; second += 1) {
        const a = visible[first]; const b = visible[second];
        if (related(a, b) || !overlaps(a, b)) continue;
        check(!a.move && !b.move, 'motion-reposition-overlap');
        check(a.presentation.inTransit || b.presentation.inTransit, 'motion-static-object-overlap');
      }
    }
  };
  const inspectSweep = (object, untilFrame) => {
    if (!inspect) return;
    const transfer = object.transfer??object.move;
    const to = positionAt(transfer, untilFrame);
    const horizontal = { x: Math.min(object.x, to.x), y: object.y,
      width: Math.abs(to.x - object.x) + object.width, height: object.height };
    const vertical = { x: to.x, y: Math.min(object.y, to.y),
      width: object.width, height: Math.abs(to.y - object.y) + object.height };
    for (const other of states.values()) {
      if (!other.visible || other.id === object.id || related(object, other)) continue;
      if (overlaps(horizontal, other) || overlaps(vertical, other)) {
        check(!object.move, 'motion-reposition-overlap');
        const key = `${transfer.id}:${other.id}`;
        warnings.set(key, { code: 'motion-unsafe-transfer-overlap', eventId: transfer.id, objectIds: [object.id, other.id] });
      }
    }
  };
  const finishFrame = (eventIndex) => {
    const next = normalized.events[eventIndex + 1];
    const event = normalized.events[eventIndex];
    if (next?.atFrame === event.atFrame) return;
    inspectVisibility();
    const untilFrame = Math.min(frame, next ? next.atFrame - 1 : frame);
    for (const object of states.values()) {
      if (object.visible && object.presentation.inTransit) inspectSweep(object, untilFrame);
    }
  };
  inspectVisibility();
  for (let eventIndex = 0; eventIndex < normalized.events.length; eventIndex += 1) {
    const event = normalized.events[eventIndex];
    if (event.atFrame > frame) break;
    advance(event.atFrame);
    const object = states.get(event.objectId);
    const target = states.get(event.targetId);
    if (event.op === 'reset-scope') {
      const keep = new Set(event.value.keepIds);
      for (const current of states.values()) {
        if (current.scopeId !== event.value.scopeId || keep.has(current.id)) continue;
        check(!current.presentation.inTransit, 'motion-reset-during-transfer');
        if (!current.persisted && current.sourceId !== null) {
          states.set(current.id, initial(normalized.objects.get(current.id)));
        }
        states.get(current.id).transfer = null;
        show(states.get(current.id), false);
        retireRelationships(current.id);
        if (focusId === current.id) focusId = null;
      }
      finishFrame(eventIndex);
      continue;
    }
    if (event.op === 'reveal') {
      check(object.created, 'motion-reveal-uncopied'); show(object, true);
    } else if (event.op === 'retire') {
      check(!object.presentation.inTransit, 'motion-retire-during-transfer');
      object.transfer = null;
      show(object, false); if (focusId === object.id) focusId = null;
      retireRelationships(object.id);
    } else if (event.op === 'present') {
      check(object.visible && !object.presentation.inTransit, 'motion-presentation-hidden');
      object.presentation.copy={label:event.value.label,detail:event.value.detail};
      object.presentation.variant=event.value.variant;
      if(event.value.box){Object.assign(object,event.value.box);Object.assign(object.presentation,{x:object.x,y:object.y});}
      if(Object.hasOwn(event.value,'regionId'))object.regionId=event.value.regionId;
    } else if (event.op === 'connect') {
      check(object.visible && target.visible, 'motion-relationship-hidden-endpoint');
      relationships.set(`${object.id}:${target.id}`,{id:event.id,fromId:object.id,toId:target.id,
        route:event.value.route,atFrame:event.atFrame,durationFrames:event.durationFrames});
    } else if (event.op === 'reposition') {
      check(object.visible && !object.presentation.inTransit && !object.transfer && !object.move
        && !object.information.containerId && !object.regionId, 'motion-reposition-state');
      // Independent display movement has one bounded sweep. Do not claim
      // concurrent trajectory safety using another moving object's start box.
      check(![...states.values()].some(other=>other.id!==object.id && other.presentation.inTransit),
        'motion-reposition-concurrent');
      check((event.value.x===object.x)!==(event.value.y===object.y), 'motion-reposition-axis');
      check(event.value.x+object.width<=1824 && event.value.y+object.height<=880, 'motion-reposition-safe-area');
      object.move={id:event.id,atFrame:event.atFrame,durationFrames:event.durationFrames,
        from:{x:object.x,y:object.y},to:{...event.value}};
      object.presentation.inTransit=true;
    } else if (event.op === 'focus') {
      check(object.visible, 'motion-focus-hidden'); focusId = object.id;
    } else if (event.op === 'copy' || event.op === 'summarize') {
      check(object.visible && object.information.recallActive && object.information.checkStatus !== 'rejected', 'motion-copy-ineligible-source');
      check(object.sourceId === null || object.information.status === 'stored', 'motion-copy-source-not-stored');
      check(target.sourceId === object.id && !target.created, 'motion-copy-target');
      check(object.scopeMode === 'shared' || object.scopeId === target.scopeId, 'motion-cross-scope-copy');
      check(event.op === 'summarize' ? target.transformation === 'summary' : target.transformation !== 'summary',
        'motion-summary-operation-required');
      target.created = true;
      target.information.value = event.op === 'summarize' ? summaryText(object.summaryFields) : object.information.value;
      target.information.status = event.op === 'summarize' ? 'summarized' : 'copied';
      target.x = object.x; target.y = object.y;
      target.presentation.x = object.x; target.presentation.y = object.y;
      show(target, true);
    } else if (event.op === 'transfer') {
      check(![...states.values()].some(other=>other.move), 'motion-reposition-concurrent');
      check(object.sourceId !== null && object.created && object.visible && !object.transfer
        && ['copied', 'summarized'].includes(object.information.status), 'motion-transfer-needs-fresh-copy');
      check(object.information.checkStatus !== 'rejected', 'motion-transfer-rejected');
      check(target.visible && CONTAINERS.has(target.kind) && object.scopeId === target.scopeId, 'motion-transfer-container');
      check(inside(object, target, event.value), 'motion-transfer-containment');
      object.transfer = { id: event.id, atFrame: event.atFrame, durationFrames: event.durationFrames,
        from: { x: object.x, y: object.y }, to: { ...event.value }, targetId: target.id };
      object.information.status = 'in-transit';
      object.information.containerId = null;
      object.presentation.inTransit = true;
    } else if (event.op === 'arrive') {
      check(object.transfer && object.transfer.targetId === target.id && object.information.status === 'arrived'
        && !object.presentation.inTransit && inside(object, target), 'motion-arrive-before-contained');
      check(target.visible, 'motion-arrive-hidden-container');
      object.information.status = 'included';
      object.information.containerId = target.id;
    } else if (event.op === 'check') {
      check(object.sourceId !== null && object.created && object.visible && !object.presentation.inTransit
        && object.information.status !== 'stored' && object.information.checkStatus === null, 'motion-check-candidate');
      object.information.checkStatus = event.value;
    } else if (event.op === 'save') {
      check(object.sourceId !== null && object.information.status === 'included' && object.information.checkStatus === 'passed'
        && object.information.containerId === target.id && target.kind === 'store' && target.visible
        && object.transformation !== 'summary', 'motion-save-not-eligible');
      object.information.status = 'stored';
      object.persisted = true;
    } else if (event.op === 'temporary-override') {
      check(object.sourceId !== null && object.information.status === 'included'
        && states.get(object.information.containerId)?.kind === 'window' && object.visible && object.transformation !== 'summary',
        'motion-override-not-local-input');
      textFits(object, event.value);
      object.information.value = event.value;
    } else if (event.op === 'invalidate') {
      check(object.sourceId === null || object.information.status === 'stored', 'motion-invalidate-not-record');
      object.information.recallActive = false;
      object.information.status = 'invalidated';
    }
    finishFrame(eventIndex);
  }
  advance(frame);
  inspectVisibility();
  const connections = [];
  for (const relation of relationships.values()) {
    if (!states.get(relation.fromId)?.visible || !states.get(relation.toId)?.visible) continue;
    connections.push({...relation,status:'explanatory',
      progress:Math.min(1,Math.max(0,(frame-relation.atFrame)/relation.durationFrames))});
  }
  for (const object of states.values()) {
    if (!object.visible || !object.transfer || !states.get(object.sourceId)?.visible) continue;
    const transfer = object.transfer;
    if (!states.get(transfer.targetId)?.visible) continue;
    const from = { x: transfer.from.x + object.width / 2, y: transfer.from.y + object.height / 2 };
    const to = { x: transfer.to.x + object.width / 2, y: transfer.to.y + object.height / 2 };
    const points = [from, { x: to.x, y: from.y }, to].filter((point, index, all) => index === 0
      || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
    connections.push({ id: transfer.id, fromId: object.sourceId, toId: transfer.targetId, points,
      status: object.presentation.inTransit ? 'moving' : 'arrived',
      progress: Math.max(0, Math.min(1, (frame - transfer.atFrame) / transfer.durationFrames)) });
  }
  const objects = [...states.values()].map(({ created: _created, transfer: _transfer, move: _move, persisted: _persisted, ...object }) => object);
  return { frame, canvas: normalized.canvas, objects, visibleObjects: objects.filter((object) => object.visible), connections, focusId,
    tracks:resolveEditorialTracks(normalized.tracks,frame),
    ...(warnings.size ? { warnings: [...warnings.values()] } : {}) };
}

export function validateEditorialMotionPlan(plan, options = {}) {
  try {
    const normalized = normalize(plan, options);
    const lastFrame = normalized.events.reduce((maximum, event) => Math.max(maximum, event.atFrame + event.durationFrames), 0);
    const result = run(normalized, lastFrame);
    return { valid: true, errors: [], ...(result.warnings ? { warnings: result.warnings } : {}) };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error && /^motion-[a-z-]+$/u.test(error.message)
      ? error.message : 'motion-invalid-data'] };
  }
}

export function resolveEditorialMotionFrame(plan, frame) {
  check(integer(frame, 0, 108000), 'motion-frame');
  if (compiledPlans.has(plan)) return run(compiledPlans.get(plan), frame, { inspect: false });
  const normalized = normalize(plan);
  // Validate the whole event stream even when seeking an early frame. A bad
  // future operation is never silently accepted as a playable partial plan.
  run(normalized, normalized.events.reduce((maximum, event) => Math.max(maximum, event.atFrame + event.durationFrames), 0));
  return run(normalized, frame);
}

export function compileEditorialMotionPlan(plan, options = {}) {
  const normalized = normalize(plan, options);
  run(normalized, normalized.events.reduce((maximum, event) => Math.max(maximum, event.atFrame + event.durationFrames), 0));
  const snapshot = JSON.parse(JSON.stringify(plan));
  const freeze = (value) => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  freeze(snapshot);
  compiledPlans.set(snapshot, normalize(snapshot, options));
  return snapshot;
}
