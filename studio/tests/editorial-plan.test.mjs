import assert from "node:assert/strict";
import test from "node:test";
import { illustrationExample, ILLUSTRATION_STYLE } from "../src/video/illustration-system/catalog.mjs";
import { illustrationFrameState } from "../src/video/illustration-system/scene-state.mjs";
import { validateIllustrationSequence } from "../src/shared/illustration-system-contract.mjs";
import { EDITORIAL_PLAN, editorialFrameState } from "../src/video/illustration-system/editorial-plan.mjs";

const state = editorialFrameState;
const rect = ({ x, y, width, height }) => ({ x, y, width, height });
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test("editorial candidate binds independent 20 second timing and never grants acceptance", () => {
  assert.equal(EDITORIAL_PLAN.id, "EditorialSelectLoad");
  assert.equal(EDITORIAL_PLAN.compositionId, "EditorialSelectLoad");
  assert.deepEqual([EDITORIAL_PLAN.width, EDITORIAL_PLAN.height, EDITORIAL_PLAN.fps, EDITORIAL_PLAN.durationInFrames],
    [1920, 1080, 30, 600]);
  assert.equal(EDITORIAL_PLAN.audio, "none");
  for (const value of [EDITORIAL_PLAN, EDITORIAL_PLAN.definition]) {
    assert.equal(value.status, "candidate");
    for (const key of ["productionApproved", "userAccepted", "finalAccepted"]) assert.equal(value[key], false);
  }
});

test("the new definition preserves select-load claims and copy with its own reveal and transfer", () => {
  const source = illustrationExample("select-load");
  assert.equal(EDITORIAL_PLAN.exampleId, source.id);
  assert.deepEqual(EDITORIAL_PLAN.copy, source.copy);
  assert.equal(EDITORIAL_PLAN.title, source.definition.title);
  assert.equal(EDITORIAL_PLAN.subtitle, source.subtitle);
  assert.equal(EDITORIAL_PLAN.definition.explanationGoal, source.definition.explanationGoal);
  assert.deepEqual(EDITORIAL_PLAN.definition.claimIds, ["selected-content-only"]);
  assert.deepEqual(EDITORIAL_PLAN.definition.objects, source.definition.objects);
  assert.equal(EDITORIAL_PLAN.definition.durationInFrames, 600);
  assert.equal(EDITORIAL_PLAN.definition.fps, 30);
  assert.deepEqual(EDITORIAL_PLAN.definition.actions.map(({ id, fromFrame, toFrame }) => [id, fromFrame, toFrame]),
    [["match", 90, 150], ["load", 210, 420], ["expand", 255, 300], ["loaded", 420, 600]]);
  assert.equal(validateIllustrationSequence(EDITORIAL_PLAN.definition).valid, true);
});

test("paper geometry, safe bounds and fixed type sizes are explicit", () => {
  const g = EDITORIAL_PLAN.geometry;
  assert.deepEqual(g.safeArea, { x: 90, y: 300, width: 1740, height: 560 });
  assert.deepEqual(g.sourceInitialRects, [170, 750, 1330].map((x) => ({ x, y: 420, width: 420, height: 280 })));
  assert.deepEqual(g.sourceFinalRects, [355, 525, 695].map((y) => ({ x: 140, y, width: 430, height: 125 })));
  assert.deepEqual(g.context, { x: 1140, y: 325, width: 640, height: 485 });
  assert.deepEqual(g.contextContent, { x: 1170, y: 430, width: 580, height: 340 });
  assert.deepEqual(g.packetStart, { x: 176, y: 525, width: 430, height: 125 });
  assert.deepEqual(g.packetReading, { x: 660, y: 450, width: 430, height: 280 });
  assert.deepEqual(g.packetLoaded, { x: 1245, y: 450, width: 430, height: 280 });
  assert.deepEqual(EDITORIAL_PLAN.typography, { title: 44, secondary: 28, detailTitle: 44 });
});

test("every frame is deterministic, finite, immutable JSON data", () => {
  for (let frame = 0; frame < 600; frame += 1) {
    const actual = state(frame);
    assert.deepEqual(actual, state(frame));
    assert.deepEqual(actual, JSON.parse(JSON.stringify(actual)));
    for (const paper of [...actual.sources, actual.packet]) {
      assert.ok(Object.values(rect(paper)).every(Number.isFinite));
      assert.ok(paper.width > 0 && paper.height > 0);
    }
    for (const key of ["selectedAmount", "reflowProgress", "expansion", "stepsAmount", "qaAmount"]) {
      assert.ok(Number.isFinite(actual[key]) && actual[key] >= 0 && actual[key] <= 1);
    }
    assert.equal(Object.isFrozen(actual), true);
  }
});

test("editorial frame input rejects negative, fractional, missing and out of range values", () => {
  for (const frame of [undefined, null, "0", false, -1, 600, 601, 1.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => state(frame), RangeError);
  }
  assert.doesNotThrow(() => state(0));
  assert.doesNotThrow(() => state(599));
});

test("title starts visible, cues wait until frame 20, and matching confirms at 150", () => {
  for (let frame = 0; frame < 600; frame += 1) {
    assert.equal(state(frame).titleVisible, true);
    assert.equal(state(frame).cueVisible, frame >= 20);
    assert.equal(state(frame).cue.length > 0, frame >= 20);
  }
  assert.equal(state(89).selected, false);
  assert.equal(state(90).selected, true);
  assert.equal(state(90).selectedAmount, 0);
  assert.equal(state(120).selectedAmount, 0.5);
  assert.equal(state(150).selectedAmount, 1);
});

test("source reflow contracts, separates rows, then slides into the left catalog", () => {
  assert.deepEqual(state(150).sources.map(rect), EDITORIAL_PLAN.geometry.sourceInitialRects);
  assert.deepEqual(state(170).sources.map(rect), [170, 750, 1330].map((x) => ({ x, y: 420, width: 430, height: 125 })));
  assert.deepEqual(state(190).sources.map(rect), [170, 750, 1330].map((x, index) =>
    ({ x, y: [355, 525, 695][index], width: 430, height: 125 })));
  assert.deepEqual(state(210).sources.map(rect), EDITORIAL_PLAN.geometry.sourceFinalRects);
  for (let frame = 210; frame < 600; frame += 1) {
    assert.deepEqual(state(frame).sources.map(rect), EDITORIAL_PLAN.geometry.sourceFinalRects);
  }
});

test("all paper sources remain retained, readable and separate for all 600 frames", () => {
  for (let frame = 0; frame < 600; frame += 1) {
    const actual = state(frame);
    assert.equal(actual.sourceRetained, true);
    assert.equal(actual.sources.length, 3);
    actual.sources.forEach((source, index) => {
      assert.equal(source.index, index);
      assert.equal(source.label, EDITORIAL_PLAN.copy.documents[index]);
      assert.equal(source.description, EDITORIAL_PLAN.sourceDescriptions[index]);
      assert.equal(source.retained, true);
      assert.equal(source.labelSize, 44);
      assert.equal(source.selected, frame >= 90 && index === 1);
      for (const other of actual.sources.slice(index + 1)) assert.equal(overlaps(source, other), false, `source collision at frame ${frame}`);
    });
  }
});

test("copy leaves the selected source horizontally before rising past unrelated sources", () => {
  assert.equal(state(209).packetVisible, false);
  assert.equal(state(210).packetVisible, true);
  assert.deepEqual(state(210).packet, EDITORIAL_PLAN.geometry.packetStart);
  assert.equal(state(210).packet.x - state(210).sources[1].x, 36);
  assert.deepEqual(state(240).packet, { x: 660, y: 525, width: 430, height: 125 });
  assert.deepEqual(state(255).packet, { x: 660, y: 450, width: 430, height: 125 });
  for (let frame = 210; frame < 600; frame += 1) {
    const actual = state(frame);
    assert.equal(actual.packetLabel, "报告整理");
    assert.equal(actual.packetVisible, true);
    assert.equal(overlaps(actual.packet, actual.sources[0]), false, `first source covered at frame ${frame}`);
    assert.equal(overlaps(actual.packet, actual.sources[2]), false, `last source covered at frame ${frame}`);
    if (overlaps(actual.packet, actual.sources[1])) assert.ok(actual.packet.x - actual.sources[1].x >= 36);
    if (frame >= 240) assert.equal(overlaps(actual.packet, actual.sources[1]), false);
  }
});

test("all visible main objects stay inside the safe area and originals never enter visible context", () => {
  const g = EDITORIAL_PLAN.geometry;
  for (let frame = 0; frame < 600; frame += 1) {
    const actual = state(frame);
    for (const source of actual.sources) assert.equal(inside(source, g.safeArea), true);
    if (actual.packetVisible) assert.equal(inside(actual.packet, g.safeArea), true);
    assert.equal(actual.contextVisible, frame >= 210);
    if (actual.contextVisible) {
      assert.equal(inside(g.context, g.safeArea), true);
      for (const source of actual.sources) assert.equal(overlaps(source, g.context), false);
    }
  }
});

test("body sections wait for both reveal time and sufficient paper height", () => {
  let stepsFirst = null;
  let qaFirst = null;
  for (let frame = 0; frame < 600; frame += 1) {
    const actual = state(frame);
    assert.equal(actual.stepsVisible, frame > 255 && actual.packet.height >= 214);
    assert.equal(actual.qaVisible, frame > 280 && actual.packet.height >= 276);
    if (actual.stepsVisible) {
      stepsFirst ??= frame;
      assert.ok(actual.packet.height - 178 >= 36);
    }
    if (actual.qaVisible) {
      qaFirst ??= frame;
      assert.ok(actual.packet.height - 240 >= 36);
      assert.equal(actual.stepsVisible, true);
    }
    if (frame <= 255) assert.equal(actual.stepsAmount, 0);
    if (frame <= 280) assert.equal(actual.qaAmount, 0);
  }
  assert.ok(stepsFirst > 255 && stepsFirst < qaFirst && qaFirst <= 300);
  assert.equal(state(300).stepsVisible, true);
  assert.equal(state(300).qaVisible, true);
  assert.equal(state(300).stepsAmount, 1);
  assert.equal(state(300).qaAmount, 1);
});

test("expanded content has a reading hold before horizontal transfer", () => {
  assert.equal(state(255).expansion, 0);
  assert.equal(state(300).expansion, 1);
  for (let frame = 300; frame <= 330; frame += 1) assert.deepEqual(state(frame).packet, EDITORIAL_PLAN.geometry.packetReading);
  for (let frame = 330; frame <= 420; frame += 1) {
    const actual = state(frame);
    assert.equal(actual.packet.y, 450);
    assert.equal(actual.packet.width, 430);
    assert.equal(actual.packet.height, 280);
  }
});

test("loaded waits until arrival and full containment in the context content region", () => {
  assert.equal(state(419).loaded, false);
  assert.equal(state(420).loaded, true);
  assert.deepEqual(state(420).packet, EDITORIAL_PLAN.geometry.packetLoaded);
  for (let frame = 0; frame < 600; frame += 1) {
    const actual = state(frame);
    assert.equal(actual.loaded, frame >= 420);
    if (actual.loaded) {
      assert.equal(actual.contextVisible, true);
      assert.equal(actual.packetVisible, true);
      assert.equal(inside(actual.packet, EDITORIAL_PLAN.geometry.contextContent), true);
    }
  }
});

test("every paper path changes continuously without a position or size jump", () => {
  for (let frame = 1; frame < 600; frame += 1) {
    const before = state(frame - 1);
    const after = state(frame);
    after.sources.forEach((paper, index) => {
      for (const [field, maxDelta] of [["x", 90], ["y", 21], ["width", 1], ["height", 12]]) {
        assert.ok(Math.abs(paper[field] - before.sources[index][field]) < maxDelta, `${field} jump at frame ${frame}`);
      }
    });
    for (const [field, maxDelta] of [["x", 25], ["y", 8], ["width", 1], ["height", 6]]) {
      assert.ok(Math.abs(after.packet[field] - before.packet[field]) < maxDelta, `packet ${field} jump at frame ${frame}`);
    }
  }
});

test("final six seconds keep complete content and the original catalog stable for reading", () => {
  const arrived = state(420);
  assert.equal(EDITORIAL_PLAN.durationInFrames - 420, 180);
  assert.equal(arrived.stepsVisible, true);
  assert.equal(arrived.qaVisible, true);
  assert.equal(arrived.phase, 3);
  assert.match(arrived.cue, /已载入/u);
  assert.match(arrived.cue, /原材料仍保留/u);
  assert.doesNotMatch(state(419).cue, /已载入/u);
  for (let frame = 420; frame < 600; frame += 1) assert.deepEqual(state(frame), arrived);
});

test("producing the new frames leaves existing catalog and old scene timing unchanged", () => {
  const source = illustrationExample("select-load");
  const oldDefinition = structuredClone(source.definition);
  const oldCopy = structuredClone(source.copy);
  const oldFrame = structuredClone(illustrationFrameState("select-load", 240));
  for (let frame = 0; frame < 600; frame += 1) state(frame);
  assert.deepEqual(source.definition, oldDefinition);
  assert.deepEqual(source.copy, oldCopy);
  assert.equal(source.definition.durationInFrames, 360);
  assert.equal(ILLUSTRATION_STYLE.durationInFrames, 360);
  assert.equal(illustrationFrameState("select-load", 239).loaded, false);
  assert.deepEqual(illustrationFrameState("select-load", 240), oldFrame);
});

test("plan and frames are deeply frozen including approvals, geometry and source copy", () => {
  const actual = state(300);
  for (const mutate of [
    () => { EDITORIAL_PLAN.userAccepted = true; },
    () => { EDITORIAL_PLAN.definition.actions[0].toFrame = 50; },
    () => { EDITORIAL_PLAN.geometry.sourceInitialRects[0].x = 0; },
    () => { actual.sources[0].retained = false; },
    () => { actual.packet.height = 1; },
    () => { actual.copy.documents[1] = "changed"; }
  ]) assert.throws(mutate, TypeError);
  assert.deepEqual(actual, state(300));
});
