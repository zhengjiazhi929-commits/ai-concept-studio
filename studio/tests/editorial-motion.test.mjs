import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EDITORIAL_MOTION_VERSION,
  compileEditorialMotionPlan,
  resolveEditorialMotionFrame,
  validateEditorialMotionPlan,
} from '../src/shared/editorial-motion.mjs';

const narration = '展示来源。复制偏好。送入窗口。到达以后才纳入。只改本轮。退出本轮。停用旧记录。';
const object = (id, patch = {}) => ({
  id, kind: 'page', label: '简短中文', detail: '', x: 120, y: 420,
  width: 300, height: 160, scopeId: 'session-a', sourceId: null,
  initiallyVisible: false, ...patch,
});
const event = (id, cue, atFrame, op, objectId, patch = {}) => ({
  id, cue, atFrame, durationFrames: 0, op, objectId,
  targetId: null, value: null, requires: [], ...patch,
});
const fixture = () => ({
  version: EDITORIAL_MOTION_VERSION,
  canvas: { width: 1920, height: 1080 },
  objects: [
    object('source', { initiallyVisible: true, scopeMode: 'shared', value: '简短中文' }),
    object('input', { kind: 'window', label: '本轮输入', x: 720, y: 300, width: 1040, height: 560,
      initiallyVisible: true, scopeId: 'session-b' }),
    object('copy', { sourceId: 'source', scopeId: 'session-b' }),
  ],
  events: [
    event('copy-event', '复制偏好', 20, 'copy', 'source', { targetId: 'copy' }),
    event('transfer-event', '送入窗口', 40, 'transfer', 'copy', {
      targetId: 'input', durationFrames: 20, value: { x: 780, y: 480 }, requires: ['copy-event'],
    }),
    event('arrive-event', '到达以后才纳入', 60, 'arrive', 'copy', {
      targetId: 'input', requires: ['transfer-event'],
    }),
  ],
});
const validate = (plan) => validateEditorialMotionPlan(plan, { narration, durationInFrames: 180 });
const state = (plan, frame, id) => resolveEditorialMotionFrame(plan, frame).objects.find((item) => item.id === id);

test('copy, transit and arrival are different states and never move the source', () => {
  const plan = fixture();
  assert.deepEqual(validate(plan), { valid: true, errors: [] });
  const untouched = JSON.stringify(plan);
  assert.equal(state(plan, 19, 'copy').visible, false);
  assert.equal(state(plan, 20, 'copy').information.status, 'copied');
  assert.equal(state(plan, 50, 'copy').information.status, 'in-transit');
  assert.equal(state(plan, 59, 'copy').information.containerId, null);
  assert.equal(state(plan, 60, 'copy').information.status, 'included');
  assert.equal(state(plan, 60, 'copy').information.containerId, 'input');
  assert.deepEqual([state(plan, 100, 'source').x, state(plan, 100, 'source').y], [120, 420]);
  assert.equal(state(plan, 100, 'source').information.value, '简短中文');
  assert.equal(JSON.stringify(plan), untouched);
});

test('all intermediate positions and connector segments use orthogonal paths', () => {
  const plan = fixture();
  for (let frame = 40; frame <= 60; frame += 1) {
    const resolved = resolveEditorialMotionFrame(plan, frame);
    const current = state(plan, frame, 'copy');
    assert.ok(current.y === 420 || current.x === 780);
    for (const connection of resolved.connections) {
      for (let index = 1; index < connection.points.length; index += 1) {
        const a = connection.points[index - 1];
        const b = connection.points[index];
        assert.ok(a.x === b.x || a.y === b.y);
      }
    }
  }
});

test('arrival cannot precede completion, omit transfer, or name a different container', () => {
  for (const mutate of [
    (p) => { p.events[2].atFrame = 59; },
    (p) => { p.events.splice(1, 1); p.events[1].requires = []; },
    (p) => { p.events[2].targetId = 'source'; },
  ]) {
    const plan = fixture(); mutate(plan);
    assert.equal(validate(plan).valid, false);
  }
});

test('only declared copies may travel and copying cannot mutate or lose source identity', () => {
  for (const mutate of [
    (p) => { p.events[1].objectId = 'source'; },
    (p) => { p.objects[2].sourceId = 'input'; },
    (p) => { p.objects[2].label = '其他偏好'; },
    (p) => { p.objects[2].initiallyVisible = true; },
  ]) {
    const plan = fixture(); mutate(plan);
    assert.equal(validate(plan).valid, false);
  }
});

test('task-local A results cannot enter B but explicitly shared preferences can', () => {
  const plan = fixture();
  plan.objects[0].scopeMode = 'local';
  assert.equal(validate(plan).valid, false);
  plan.objects[0].scopeMode = 'shared';
  assert.equal(validate(plan).valid, true);
});

test('temporary English override changes the included copy, not the Chinese source', () => {
  const plan = fixture();
  plan.events.push(event('english', '只改本轮', 80, 'temporary-override', 'copy', { value: '本次英文' }));
  assert.equal(validate(plan).valid, true);
  assert.equal(state(plan, 79, 'copy').information.value, '简短中文');
  assert.equal(state(plan, 80, 'copy').information.value, '本次英文');
  assert.equal(state(plan, 80, 'source').information.value, '简短中文');
  plan.events[3].objectId = 'source';
  assert.equal(validate(plan).valid, false);
});

test('new session reset retires copies and clears checks without erasing the source', () => {
  const plan = fixture();
  plan.events.push(event('english', '只改本轮', 80, 'temporary-override', 'copy', { value: '本次英文' }));
  plan.events.push(event('reset', '退出本轮', 100, 'reset-scope', null,
    { value: { scopeId: 'session-b', keepIds: ['input'] } }));
  assert.equal(validate(plan).valid, true);
  const copy = state(plan, 100, 'copy');
  assert.equal(copy.visible, false);
  assert.equal(copy.information.containerId, null);
  assert.equal(copy.information.value, '简短中文');
  assert.equal(copy.information.checkStatus, null);
  assert.equal(state(plan, 100, 'source').visible, true);
  assert.equal(state(plan, 100, 'source').information.value, '简短中文');
});

test('recall invalidation retains source contents and blocks new copies', () => {
  const plan = fixture();
  plan.events.push(event('invalidate', '停用旧记录', 100, 'invalidate', 'source'));
  assert.equal(validate(plan).valid, true);
  assert.equal(state(plan, 100, 'source').information.recallActive, false);
  assert.equal(state(plan, 100, 'source').information.value, '简短中文');
  plan.events.push(event('copy-after-invalidate', '停用旧记录', 110, 'copy', 'source', { targetId: 'copy' }));
  assert.equal(validate(plan).valid, false);
});

test('independent candidate examples do not inherit accepted checks or saved state', () => {
  const plan = fixture();
  plan.objects[1].kind = 'store';
  plan.objects[0].scopeId = 'allowed';
  plan.objects[2].scopeId = 'allowed';
  plan.objects[1].scopeId = 'allowed';
  plan.objects.push(object('failed-source', { scopeId: 'failed', initiallyVisible: false }));
  plan.objects.push(object('failed-copy', { scopeId: 'failed', sourceId: 'failed-source' }));
  plan.objects.push(object('preference-source', { scopeId: 'preference', initiallyVisible: false }));
  plan.objects.push(object('preference-copy', { scopeId: 'preference', sourceId: 'preference-source' }));
  plan.events.push(event('pass', '到达以后才纳入', 65, 'check', 'copy', { value: 'passed' }));
  plan.events.push(event('save', '到达以后才纳入', 70, 'save', 'copy', { targetId: 'input' }));
  plan.events.push(event('reset-allowed', '只改本轮', 80, 'reset-scope', null,
    { value: { scopeId: 'allowed', keepIds: [] } }));
  plan.events.push(event('show-failed', '退出本轮', 90, 'reveal', 'failed-source'));
  plan.events.push(event('copy-failed', '退出本轮', 91, 'copy', 'failed-source', { targetId: 'failed-copy' }));
  plan.events.push(event('reject-failed', '退出本轮', 92, 'check', 'failed-copy', { value: 'rejected' }));
  plan.events.push(event('reset-failed', '退出本轮', 95, 'reset-scope', null,
    { value: { scopeId: 'failed', keepIds: [] } }));
  plan.events.push(event('show-preference', '停用旧记录', 100, 'reveal', 'preference-source'));
  plan.events.push(event('copy-preference', '停用旧记录', 101, 'copy', 'preference-source', { targetId: 'preference-copy' }));
  assert.equal(validate(plan).valid, true);
  assert.equal(state(plan, 102, 'copy').information.status, 'stored');
  assert.equal(state(plan, 92, 'failed-copy').information.checkStatus, 'rejected');
  assert.equal(state(plan, 92, 'failed-copy').information.status, 'copied');
  assert.equal(state(plan, 102, 'failed-copy').visible, false);
  assert.equal(state(plan, 102, 'preference-copy').information.checkStatus, null);
  assert.equal(state(plan, 102, 'preference-copy').information.status, 'copied');
});

test('save requires an included, checked copy and cannot upgrade it into a rule', () => {
  const plan = fixture();
  plan.objects[1].kind = 'store';
  plan.events.push(event('save', '只改本轮', 80, 'save', 'copy', { targetId: 'input' }));
  assert.equal(validate(plan).valid, false);
  plan.events.splice(3, 0, event('pass', '只改本轮', 70, 'check', 'copy', { value: 'passed' }));
  assert.equal(validate(plan).valid, true);
  plan.events[4].value = 'business-rule';
  assert.equal(validate(plan).valid, false);
});

test('events must be ordered, bounded, dependency-complete and tied to real narration', () => {
  for (const mutate of [
    (p) => { p.events[1].atFrame = 10; },
    (p) => { p.events[2].atFrame = 180; },
    (p) => { p.events[1].durationFrames = 150; },
    (p) => { p.events[1].cue = '不存在的口播'; },
    (p) => { p.events[1].requires = ['missing']; },
    (p) => { p.events[0].requires = ['transfer-event']; },
    (p) => { p.events[0].cue = '停用旧记录'; },
  ]) {
    const plan = fixture(); mutate(plan);
    assert.equal(validate(plan).valid, false);
  }
});

test('layout rejects off-canvas objects, insufficient text room and header collisions', () => {
  for (const mutate of [
    (p) => { p.objects[0].x = -1; },
    (p) => { p.objects[0].width = 2000; },
    (p) => { p.objects[0].label = '非常长的完整中文卡片标题不能缩字号或者裁掉文字'; p.objects[0].height = 80; },
    (p) => { p.events[1].value.y = 125; },
    (p) => { p.events[1].value.x = 1500; },
  ]) {
    const plan = fixture(); mutate(plan);
    assert.equal(validate(plan).valid, false);
  }
});

test('closed declarative schema rejects arbitrary code, unknown keys and accessor fields', () => {
  const unknown = fixture(); unknown.events[0].op = 'eval';
  assert.equal(validate(unknown).valid, false);
  const injected = fixture(); injected.events[0].script = 'doAnything()';
  assert.equal(validate(injected).valid, false);
  const accessor = fixture();
  Object.defineProperty(accessor.objects[0], 'label', { get() { throw new Error('must not execute'); }, enumerable: true });
  assert.equal(validate(accessor).valid, false);
});

test('reveal, focus and retire do not leak future objects or leave focused hidden labels', () => {
  const plan = fixture();
  plan.events = [event('show', '展示来源', 10, 'reveal', 'copy')];
  assert.equal(validate(plan).valid, false);
  plan.objects.push(object('note', { kind: 'label', label: '仅本轮', y: 650 }));
  plan.events = [event('show', '展示来源', 10, 'reveal', 'note'),
    event('focus', '展示来源', 11, 'focus', 'note'),
    event('hide', '复制偏好', 20, 'retire', 'note')];
  assert.equal(validate(plan).valid, true);
  assert.equal(state(plan, 9, 'note').visible, false);
  assert.equal(resolveEditorialMotionFrame(plan, 11).focusId, 'note');
  assert.equal(resolveEditorialMotionFrame(plan, 20).focusId, null);
});

test('resolver rejects malformed plans and frames rather than inventing fallback states', () => {
  assert.throws(() => resolveEditorialMotionFrame({ version: 'unknown' }, 1));
  for (const frame of [-1, NaN, Infinity, 1.5]) assert.throws(() => resolveEditorialMotionFrame(fixture(), frame));
});

test('a saved record can be read next session with its real lineage, not an invented root', () => {
  const plan = fixture();
  plan.objects[1].kind = 'store';
  plan.objects[1].x = 500; plan.objects[1].width = 560;
  plan.events[1].value.x = 550;
  plan.objects[2].scopeMode = 'shared';
  plan.objects.push(object('next-input', { kind: 'window', label: '下次输入', x: 1150, y: 300,
    width: 650, height: 560, initiallyVisible: false, scopeId: 'session-c' }));
  plan.objects.push(object('next-copy', { sourceId: 'copy', scopeId: 'session-c' }));
  plan.events.push(event('pass', '到达以后才纳入', 65, 'check', 'copy', { value: 'passed' }));
  plan.events.push(event('save', '到达以后才纳入', 70, 'save', 'copy', { targetId: 'input' }));
  plan.events.push(event('next', '只改本轮', 80, 'reveal', 'next-input'));
  plan.events.push(event('read-saved', '只改本轮', 81, 'copy', 'copy', { targetId: 'next-copy' }));
  plan.events.push(event('next-transfer', '退出本轮', 90, 'transfer', 'next-copy', {
    targetId: 'next-input', durationFrames: 20, value: { x: 1200, y: 480 },
  }));
  plan.events.push(event('next-arrive', '停用旧记录', 110, 'arrive', 'next-copy', { targetId: 'next-input' }));
  assert.equal(validate(plan).valid, true);
  assert.equal(state(plan, 110, 'copy').information.status, 'stored');
  assert.equal(state(plan, 110, 'next-copy').sourceId, 'copy');
  assert.equal(state(plan, 110, 'next-copy').information.status, 'included');
  plan.events = plan.events.filter((item) => item.id !== 'save');
  assert.equal(validate(plan).valid, false);
});

test('copy lineage rejects cycles and included copies cannot masquerade as stored records', () => {
  const plan = fixture();
  plan.objects[0].sourceId = 'copy'; plan.objects[0].initiallyVisible = false;
  assert.equal(validate(plan).valid, false);
});

test('compiled plans are immutable snapshots reusable across frame seeks', () => {
  const plan = fixture();
  const compiled = compileEditorialMotionPlan(plan, { narration, durationInFrames: 180 });
  assert.notEqual(compiled, plan);
  assert.ok(Object.isFrozen(compiled.objects[0]) && Object.isFrozen(compiled.events[1].value));
  plan.events[0].op = 'eval';
  assert.equal(state(compiled, 60, 'copy').information.status, 'included');
  assert.equal(state(compiled, 1, 'copy').visible, false);
  assert.throws(() => resolveEditorialMotionFrame(plan, 60));
});

test('the version-bound content safe area protects the title, logo and subtitle zones', () => {
  for (const mutate of [
    (p) => { p.canvas.width = 2000; },
    (p) => { p.objects[0].x = 95; },
    (p) => { p.objects[0].y = 299; },
    (p) => { p.objects[0].y = 750; },
    (p) => { p.objects[0].x = 1600; },
  ]) {
    const plan = fixture(); mutate(plan);
    assert.equal(validate(plan).valid, false);
  }
});

test('unrelated static visible objects cannot obscure one another', () => {
  const plan = fixture();
  plan.objects.push(object('other', { initiallyVisible: true }));
  assert.equal(validate(plan).valid, false);
  plan.objects[3].initiallyVisible = false;
  assert.equal(validate(plan).valid, true);
  plan.events.push(event('late-collision', '停用旧记录', 100, 'reveal', 'other'));
  assert.equal(validate(plan).valid, false);
});

test('transfer sweep warnings consider unrelated visible objects, not retired objects', () => {
  const plan = fixture();
  plan.objects.push(object('obstacle', { x: 450, width: 220, initiallyVisible: true }));
  const result = validate(plan);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.code === 'motion-unsafe-transfer-overlap'
    && warning.objectIds.includes('obstacle')));
  plan.events.unshift(event('retire-obstacle', '展示来源', 1, 'retire', 'obstacle'));
  assert.deepEqual(validate(plan), { valid: true, errors: [] });
});

test('local result scope cannot be laundered through a shared saved-copy declaration', () => {
  const plan = fixture();
  plan.objects[0].scopeMode = 'local';
  plan.objects[0].scopeId = 'session-b';
  plan.objects[2].scopeMode = 'shared';
  assert.equal(validate(plan).valid, false);
});

test('saved-record invalidation survives a scene reset without resurrecting the record', () => {
  const plan = fixture();
  plan.objects[1].kind = 'store';
  plan.events.push(event('pass', '到达以后才纳入', 65, 'check', 'copy', { value: 'passed' }));
  plan.events.push(event('save', '到达以后才纳入', 70, 'save', 'copy', { targetId: 'input' }));
  plan.events.push(event('disable', '只改本轮', 80, 'invalidate', 'copy'));
  plan.events.push(event('reset', '退出本轮', 90, 'reset-scope', null,
    { value: { scopeId: 'session-b', keepIds: [] } }));
  assert.equal(validate(plan).valid, true);
  assert.equal(state(plan, 100, 'copy').information.recallActive, false);
  assert.equal(state(plan, 100, 'copy').information.status, 'invalidated');
});

test('sweep audit uses each visibility interval, including mid-transfer reveal and early retirement', () => {
  const midway = fixture();
  midway.objects.push(object('obstacle', { x: 450, width: 220 }));
  midway.events.splice(2, 0, event('reveal-obstacle', '送入窗口', 50, 'reveal', 'obstacle'));
  assert.ok(validate(midway).warnings?.some((warning) => warning.objectIds.includes('obstacle')));
  const alreadyPassed = fixture();
  alreadyPassed.objects.push(object('obstacle', { x: 450, width: 220 }));
  alreadyPassed.events.splice(2, 0, event('reveal-obstacle', '送入窗口', 58, 'reveal', 'obstacle'));
  assert.deepEqual(validate(alreadyPassed), { valid: true, errors: [] });
  const retiredBeforeContact = fixture();
  retiredBeforeContact.objects.push(object('obstacle', { x: 450, width: 220, initiallyVisible: true }));
  retiredBeforeContact.events.splice(2, 0, event('retire-obstacle', '送入窗口', 41, 'retire', 'obstacle'));
  assert.deepEqual(validate(retiredBeforeContact), { valid: true, errors: [] });
});

function summaryFixture() {
  const plan = fixture();
  const summaryFields = { goal: '查订单', constraints: '先核实', openQuestions: '运费未明' };
  const summary = '目标：查订单\n约束：先核实\n未解决问题：运费未明';
  Object.assign(plan.objects[0], { label: '长历史', detail: '查订单，先核实，运费未明，保留此前对话。',
    value: '查订单，先核实，运费未明，保留此前对话。', summaryFields, width: 500, height: 340, scopeId: 'session-b' });
  Object.assign(plan.objects[2], { label: '摘要', detail: summary, value: summary,
    summaryFields: { ...summaryFields }, transformation: 'summary', width: 500, height: 350 });
  plan.objects[2].x = 120;
  plan.events[0].op = 'summarize';
  return plan;
}

test('bounded summary preserves the displayed goal, constraints and open questions without changing history', () => {
  const plan = summaryFixture();
  const original = JSON.stringify(plan.objects[0]);
  assert.equal(validate(plan).valid, true);
  assert.equal(state(plan, 20, 'copy').information.status, 'summarized');
  assert.equal(state(plan, 60, 'copy').information.value, '目标：查订单\n约束：先核实\n未解决问题：运费未明');
  assert.equal(JSON.stringify(plan.objects[0]), original);
  assert.equal(state(plan, 60, 'source').information.value, plan.objects[0].value);
});

test('summary cannot omit or rewrite fields, hide original values, use copy, or bypass through override', () => {
  for (const mutate of [
    (p) => { delete p.objects[2].summaryFields.openQuestions; },
    (p) => { p.objects[2].summaryFields.constraints = '不用核实'; },
    (p) => { p.objects[0].detail = '原文内容'; },
    (p) => { p.objects[2].value = '删掉约束的摘要'; },
    (p) => { p.objects[2].transformation = 'free-rewrite'; },
    (p) => { p.objects[2].scopeId = 'other-session'; },
    (p) => { p.events[0].op = 'copy'; },
    (p) => { p.events.push(event('override-summary', '只改本轮', 100, 'temporary-override', 'copy', { value: '省略问题' })); },
  ]) {
    const plan = summaryFixture(); mutate(plan);
    assert.equal(validate(plan).valid, false);
  }
});

test('summary scope cannot be laundered through storage and a second unmarked copy', () => {
  const plan = summaryFixture();
  plan.objects[1].kind = 'store';
  plan.events.push(event('pass-summary', '只改本轮', 80, 'check', 'copy', { value: 'passed' }));
  plan.events.push(event('save-summary', '只改本轮', 90, 'save', 'copy', { targetId: 'input' }));
  assert.equal(validate(plan).valid, false);
});

test('summary fields cannot hide in detail when an unrelated value is the rendered source body', () => {
  for (const value of ['原始内容并未展示这些字段', '查订单，先核实']) {
    const plan = summaryFixture();
    plan.objects[0].value = value;
    assert.equal(validate(plan).valid, false);
    assert.throws(() => compileEditorialMotionPlan(plan, { narration, durationInFrames: 180 }));
  }
});

test('summary source uses detail when value is absent or equal to its label, matching the renderer', () => {
  for (const useLabel of [false, true]) {
    const plan = summaryFixture();
    if (useLabel) plan.objects[0].value = plan.objects[0].label;
    else delete plan.objects[0].value;
    assert.equal(validate(plan).valid, true);
    assert.equal(state(plan, 60, 'copy').information.value, '目标：查订单\n约束：先核实\n未解决问题：运费未明');
  }
});
