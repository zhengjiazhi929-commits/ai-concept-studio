import assert from "node:assert/strict";
import test from "node:test";
import {
  STORYBOARDS, STORYBOARD_STYLE, storyboardState, orthogonalPath, rectContains
} from "../src/video/illustration-storyboards/plan.mjs";

test("three distinct compositions expose exactly three static phases, without production approval", () => {
  assert.equal(STORYBOARDS.length, 3);
  assert.equal(new Set(STORYBOARDS.map((item) => item.layout)).size, 3);
  assert.equal(STORYBOARD_STYLE.productionApproved, false);
  assert.equal(STORYBOARD_STYLE.background, "#F2F6F3");
  for (const item of STORYBOARDS) {
    assert.equal(item.phases.length, 3);
    assert.ok(Object.isFrozen(item));
    for (let phase = 0; phase < 3; phase += 1) {
      assert.deepEqual(storyboardState(item.id, phase), storyboardState(item.id, phase));
    }
  }
});

test("loading preserves every source and only copies the matched report", () => {
  const phases = [0, 1, 2].map((phase) => storyboardState("load", phase));
  for (const state of phases) {
    assert.deepEqual(state.sources.map((item) => item.id), ["image", "report", "data"]);
    assert.ok(state.sources.every((item) => item.retained));
  }
  assert.equal(phases[0].copy, null);
  assert.equal(phases[0].loaded, false);
  assert.equal(phases[1].copy.sourceId, "report");
  assert.equal(phases[1].loaded, false);
  assert.equal(rectContains(phases[1].contextContent, phases[1].copy.rect), false);
  assert.equal(rectContains(phases[2].contextContent, phases[2].copy.rect), true);
  assert.equal(phases[2].loaded, true);
});

test("tool response follows an actual match and returns the matching data", () => {
  const sent = storyboardState("tool", 0);
  const found = storyboardState("tool", 1);
  const returned = storyboardState("tool", 2);
  assert.equal(sent.match, null);
  assert.equal(sent.response, null);
  assert.deepEqual(found.match, { id: "A17", value: "已发货" });
  assert.equal(found.response, null);
  assert.deepEqual(returned.response, found.match);
  assert.equal(returned.records.filter((row) => row.id === returned.response.id).length, 1);
});

test("routing keeps alternatives visible, selects one branch and never implies task completion", () => {
  const start = storyboardState("route", 0);
  const matched = storyboardState("route", 1);
  const dispatched = storyboardState("route", 2);
  assert.equal(start.selectedId, null);
  assert.equal(matched.selectedId, "report");
  assert.equal(matched.dispatchedTo, null);
  assert.equal(dispatched.dispatchedTo, "report");
  for (const phase of [0, 1, 2]) {
    const state = storyboardState("route", phase);
    assert.equal(state.candidates.length, 3);
    assert.equal(state.completed, false);
    assert.ok(state.candidates.filter((item) => item.active).length <= 1);
  }
});

test("connections contain horizontal and vertical segments only, with finite endpoints", () => {
  assert.equal(orthogonalPath([[0, 0], [20, 0], [20, 30]]), "M 0 0 L 20 0 L 20 30");
  for (const points of [[[0, 0], [20, 30]], [[0, 0], [0, 0]], [[0, 0]], [[0, 0], [Infinity, 0]]]) {
    assert.throws(() => orthogonalPath(points));
  }
  for (const board of STORYBOARDS) {
    for (let phase = 0; phase < 3; phase += 1) {
      for (const connection of storyboardState(board.id, phase).connections) {
        assert.doesNotThrow(() => orthogonalPath(connection.points));
      }
    }
  }
});

test("all object bounds stay within the authored artwork safe area without shrinking text", () => {
  const safe = { x: 100, y: 300, width: 1720, height: 660 };
  for (const board of STORYBOARDS) {
    for (let phase = 0; phase < 3; phase += 1) {
      const state = storyboardState(board.id, phase);
      for (const rect of state.bounds) assert.ok(rectContains(safe, rect), `${board.id}/${phase}: ${JSON.stringify(rect)}`);
    }
  }
  assert.equal(STORYBOARD_STYLE.labelSize, 44);
  assert.equal(STORYBOARD_STYLE.detailSize, 32);
});

test("invalid phases and unknown scene ids fail closed", () => {
  for (const phase of [-1, 3, 0.5, NaN, "1"]) assert.throws(() => storyboardState("load", phase));
  assert.throws(() => storyboardState("missing", 0));
});
