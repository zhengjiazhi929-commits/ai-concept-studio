import assert from "node:assert/strict";
import test from "node:test";
import { ILLUSTRATION_EXAMPLES } from "../src/video/illustration-system/catalog.mjs";
import { illustrationFrameState, pointOnOrthogonalRoute, progressBetween } from "../src/video/illustration-system/scene-state.mjs";
import { ILLUSTRATION_GEOMETRY, packetInsideObject } from "../src/video/illustration-system/geometry.mjs";

test("three independent examples bind a 12 second explanation, objects and claims", () => {
  assert.equal(ILLUSTRATION_EXAMPLES.length, 3);
  for (const example of ILLUSTRATION_EXAMPLES) {
    assert.equal(example.definition.durationInFrames, 360);
    assert.equal(example.definition.fps, 30);
    assert.ok(example.definition.explanationGoal.length > 12);
    assert.ok(example.definition.actions.length >= 3);
    assert.equal(example.status, "candidate");
  }
});

test("frame state is deterministic for every rendered frame", () => {
  for (const example of ILLUSTRATION_EXAMPLES) {
    for (let frame = 0; frame < 360; frame += 1) {
      assert.deepEqual(illustrationFrameState(example.id, frame), illustrationFrameState(example.id, frame));
    }
  }
});

test("invalid frame and unknown scene fail closed", () => {
  for (const frame of [-1, 360, 1.5, NaN]) assert.throws(() => illustrationFrameState("select-load", frame));
  assert.throws(() => illustrationFrameState("missing", 0));
});

test("copy enters context before context is reported loaded", () => {
  assert.equal(illustrationFrameState("select-load", 149).loaded, false);
  assert.equal(illustrationFrameState("select-load", 239).loaded, false);
  const arrived = illustrationFrameState("select-load", 240);
  assert.equal(arrived.loaded, true);
  assert.deepEqual(arrived.packet, { x: 1290, y: 535 });
  assert.equal(arrived.sourceRetained, true);
  assert.equal(illustrationFrameState("select-load", 359).loaded, true);
});

test("query result cannot appear before query completion or return before arrival", () => {
  assert.equal(illustrationFrameState("request-return", 139).queried, false);
  assert.equal(illustrationFrameState("request-return", 179).resultVisible, false);
  assert.equal(illustrationFrameState("request-return", 180).resultVisible, true);
  assert.equal(illustrationFrameState("request-return", 269).returned, false);
  assert.equal(illustrationFrameState("request-return", 270).returned, true);
});

test("restore follows comparison and changes the actual displayed value", () => {
  assert.equal(illustrationFrameState("validate-restore", 74).errorLocated, false);
  assert.equal(illustrationFrameState("validate-restore", 90).errorLocated, true);
  assert.equal(illustrationFrameState("validate-restore", 239).currentValue, "跳过验收");
  const restored = illustrationFrameState("validate-restore", 240);
  assert.equal(restored.currentValue, "保留验收");
  assert.equal(restored.restored, true);
  assert.equal(restored.sourceValue, "保留验收");
});

test("route motion remains orthogonal, continuous, clamped and rejects diagonals", () => {
  const route = [[100, 300], [600, 300], [600, 500], [900, 500]];
  for (let frame = 1; frame <= 300; frame += 1) {
    const before = pointOnOrthogonalRoute(route, (frame - 1) / 300);
    const after = pointOnOrthogonalRoute(route, frame / 300);
    assert.ok(Math.hypot(after.x - before.x, after.y - before.y) <= 3.34);
  }
  assert.deepEqual(pointOnOrthogonalRoute(route, -1), { x: 100, y: 300 });
  assert.deepEqual(pointOnOrthogonalRoute(route, 2), { x: 900, y: 500 });
  assert.throws(() => pointOnOrthogonalRoute([[0, 0], [10, 10]], 0.5));
});

test("timing helper holds before and after each action", () => {
  assert.equal(progressBetween(0, 30, 60), 0);
  assert.equal(progressBetween(45, 30, 60), 0.5);
  assert.equal(progressBetween(90, 30, 60), 1);
  assert.throws(() => progressBetween(30, 60, 30));
});

test("packets completely enter their receiving objects before disappearing", () => {
  const g = ILLUSTRATION_GEOMETRY;
  assert.equal(packetInsideObject(illustrationFrameState("request-return", 119).request, g.request.packet, g.request.database), true);
  assert.equal(packetInsideObject(illustrationFrameState("request-return", 269).result, g.request.packet, g.request.caller), true);
  assert.equal(packetInsideObject(illustrationFrameState("validate-restore", 239).patch, g.restore.packet, g.restore.current), true);
  const loaded = illustrationFrameState("select-load", 240).packet;
  assert.equal(packetInsideObject({ x: loaded.x + g.selection.packet.width / 2, y: loaded.y + g.selection.packet.height / 2 },
    g.selection.packet, g.selection.context), true);
});

test("another query, duration and layout do not inherit demo timing or claims", () => {
  const example = structuredClone(ILLUSTRATION_EXAMPLES.find((item) => item.id === "request-return"));
  example.copy.query = "B28";
  example.copy.records[1][0] = "B28";
  example.definition.actions.find((item) => item.id === "lookup").toFrame = 210;
  example.definition.actions.find((item) => item.id === "return").fromFrame = 210;
  example.definition.actions.find((item) => item.id === "return").toFrame = 300;
  const layout = structuredClone(ILLUSTRATION_GEOMETRY);
  layout.request.database.x = 1320;
  assert.match(illustrationFrameState(example, 80, layout).cue, /B28/u);
  assert.equal(illustrationFrameState(example, 190, layout).queried, false);
  assert.equal(illustrationFrameState(example, 190, layout).phase, 1);
  assert.doesNotMatch(illustrationFrameState(example, 190, layout).cue, /匹配成功/u);
  assert.equal(illustrationFrameState(example, 210, layout).resultVisible, true);
  assert.equal(packetInsideObject(illustrationFrameState(example, 119, layout).request, layout.request.packet, layout.request.database), true);
  assert.equal(illustrationFrameState(example, 299, layout).returned, false);
  assert.equal(illustrationFrameState(example, 300, layout).returned, true);
});

test("selection and restore cues follow reusable example content", () => {
  const selection = structuredClone(ILLUSTRATION_EXAMPLES[0]);
  selection.copy.selectedIndex = 2;
  selection.copy.documents[2] = "搜索总结";
  assert.match(illustrationFrameState(selection, 90).cue, /搜索总结/u);
  const restoration = structuredClone(ILLUSTRATION_EXAMPLES[2]);
  restoration.copy.source = "仅允许读取";
  restoration.copy.invalid = "允许写入";
  assert.match(illustrationFrameState(restoration, 100).cue, /允许写入/u);
  assert.match(illustrationFrameState(restoration, 300).cue, /仅允许读取/u);
});
