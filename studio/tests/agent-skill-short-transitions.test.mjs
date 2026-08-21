import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { studioRoot } from "../src/shared/paths.mjs";
import {
  AGENT_SKILL_SHORT_DIAGRAM_BOUNDARIES,
  AGENT_SKILL_SHORT_DIAGRAM_CROSSFADE_FRAMES,
  AGENT_SKILL_SHORT_DURATION_SECONDS,
  AGENT_SKILL_SHORT_FPS,
  AGENT_SKILL_SHORT_S04_HIGHLIGHT_ARROW_FADE_FRAMES,
  AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES,
  AGENT_SKILL_SHORT_S04_HIGHLIGHT_ENTER_FRAMES,
  AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES,
  agentSkillShortDiagramStateAt,
  agentSkillShortDiagramLayersAt,
  agentSkillShortS04HighlightStateAt,
  agentSkillShortSceneAt,
  buildAgentSkillShortDiagramMotionPolicy
} from "../src/video/agent-skill-short-plan.mjs";

const secondsAtFrame = (frame) => frame / AGENT_SKILL_SHORT_FPS;

test("两处技术图边界仅在切点之后执行九帧无回弹交叉淡化", () => {
  assert.equal(AGENT_SKILL_SHORT_DURATION_SECONDS, 60);
  assert.equal(AGENT_SKILL_SHORT_DIAGRAM_CROSSFADE_FRAMES, 9);
  assert.deepEqual(
    AGENT_SKILL_SHORT_DIAGRAM_BOUNDARIES.map((item) => item.id),
    ["architecture-to-weekly-report", "flow-to-comparison"]
  );

  for (const boundary of AGENT_SKILL_SHORT_DIAGRAM_BOUNDARIES) {
    const boundaryFrame = Math.ceil(boundary.atSecond * AGENT_SKILL_SHORT_FPS - 1e-7);
    const before = agentSkillShortDiagramLayersAt(secondsAtFrame(boundaryFrame - 1));
    assert.deepEqual(before, [{ diagramId: boundary.outgoingDiagramId, opacity: 1 }]);

    let previousOutgoing = 1;
    let previousIncoming = 0;
    for (let offset = 0; offset <= AGENT_SKILL_SHORT_DIAGRAM_CROSSFADE_FRAMES; offset += 1) {
      const layers = agentSkillShortDiagramLayersAt(secondsAtFrame(boundaryFrame + offset));
      assert.equal(layers.length, 2);
      assert.equal(layers[0].diagramId, boundary.outgoingDiagramId);
      assert.equal(layers[1].diagramId, boundary.incomingDiagramId);
      assert.ok(Math.abs(layers[0].opacity + layers[1].opacity - 1) < 1e-12);
      assert.ok(layers[0].opacity <= previousOutgoing);
      assert.ok(layers[1].opacity >= previousIncoming);
      if (offset > 0) {
        assert.ok(layers[0].opacity < previousOutgoing);
        assert.ok(layers[1].opacity > previousIncoming);
      }
      previousOutgoing = layers[0].opacity;
      previousIncoming = layers[1].opacity;
    }
    assert.equal(previousOutgoing, 0);
    assert.equal(previousIncoming, 1);

    const after = agentSkillShortDiagramLayersAt(secondsAtFrame(
      boundaryFrame + AGENT_SKILL_SHORT_DIAGRAM_CROSSFADE_FRAMES + 1
    ));
    assert.deepEqual(after, [{ diagramId: boundary.incomingDiagramId, opacity: 1 }]);
  }
});

test("交叉淡化不提前下一张图，也不改变原场景和六十秒时轴", () => {
  const architectureBoundary = AGENT_SKILL_SHORT_DIAGRAM_BOUNDARIES[0];
  const flowBoundary = AGENT_SKILL_SHORT_DIAGRAM_BOUNDARIES[1];
  assert.equal(agentSkillShortSceneAt(architectureBoundary.atSecond - 0.001).id, "S04");
  assert.equal(agentSkillShortSceneAt(architectureBoundary.atSecond).id, "S05");
  assert.equal(agentSkillShortSceneAt(flowBoundary.atSecond - 0.001).id, "S07");
  assert.equal(agentSkillShortSceneAt(flowBoundary.atSecond).id, "S08");
  assert.equal(agentSkillShortSceneAt(59.999).id, "S09");
});

test("S04 在完整架构上按 Skill、Agent、MCP、外部能力逐帧累计高亮", () => {
  assert.equal(AGENT_SKILL_SHORT_S04_HIGHLIGHT_ENTER_FRAMES, 18);
  assert.equal(AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES, 14);
  assert.equal(AGENT_SKILL_SHORT_S04_HIGHLIGHT_ARROW_FADE_FRAMES, 4);
  assert.deepEqual(
    AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES.map((stage) => stage.id),
    ["skill-rule", "agent-decision", "mcp-call", "external-capability"]
  );
  const contract = buildAgentSkillShortDiagramMotionPolicy("architecture")
    .emphasisPolicy;
  assert.deepEqual(
    contract.stages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      startFrameOffset: stage.startFrameOffset,
      nodeIds: stage.highlightNodeIds,
      edgeIds: stage.highlightEdgeIds
    })),
    AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES.map((stage) => ({
      id: stage.id,
      label: stage.label,
      startFrameOffset: stage.startFrameOffset,
      nodeIds: [...stage.nodeIds],
      edgeIds: [...stage.edgeIds]
    }))
  );
  assert.deepEqual(contract.neutralElements, {
    treatment: "base-style-throughout",
    nodeIds: ["tool-action"],
    edgeIds: ["agent-invokes-tool"]
  });
  assert.deepEqual(contract.transition, {
    nodeEnterFrames: AGENT_SKILL_SHORT_S04_HIGHLIGHT_ENTER_FRAMES,
    edgeDrawFrames: AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES,
    arrowheadFadeFrames: AGENT_SKILL_SHORT_S04_HIGHLIGHT_ARROW_FADE_FRAMES,
    easing: "ease-in-out-smoothstep",
    bounce: false
  });
  assert.deepEqual(contract.endBehavior, {
    mode: "hold-then-crossfade",
    holdStartFrameOffset: 132,
    crossfadeStartFrameOffset: 241,
    crossfadeDurationFrames: AGENT_SKILL_SHORT_DIAGRAM_CROSSFADE_FRAMES,
    outgoingDiagramId: "architecture",
    incomingDiagramId: "weeklyReport",
    retainHighlightThroughCrossfade: true,
    easing: "ease-in-out-smoothstep",
    bounce: false
  });

  const stageFrames = AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES.map((stage) =>
    agentSkillShortS04HighlightStateAt(0).s04StartFrame + stage.startFrameOffset
  );
  assert.deepEqual(stageFrames, [523, 559, 595, 637]);

  const before = agentSkillShortS04HighlightStateAt(secondsAtFrame(522));
  assert.equal(before.currentStageId, null);
  assert.equal(Object.values(before.nodeHighlightProgress).every((value) => value === 0), true);
  assert.equal(Object.values(before.edgeHighlightProgress).every((value) => value === 0), true);

  for (const [stageIndex, stage] of AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES.entries()) {
    const stageFrame = stageFrames[stageIndex];
    const nodeId = stage.nodeIds[0];
    const nodeValues = Array.from(
      { length: AGENT_SKILL_SHORT_S04_HIGHLIGHT_ENTER_FRAMES + 1 },
      (_, offset) => agentSkillShortS04HighlightStateAt(
        secondsAtFrame(stageFrame + offset)
      ).nodeHighlightProgress[nodeId]
    );
    assert.equal(nodeValues[0], 0);
    assert.equal(nodeValues.at(-1), 1);
    for (let index = 1; index < nodeValues.length - 1; index += 1) {
      assert.ok(nodeValues[index] > nodeValues[index - 1]);
      assert.ok(nodeValues[index] > 0 && nodeValues[index] < 1);
    }

    const stateAtStageStart = agentSkillShortS04HighlightStateAt(
      secondsAtFrame(stageFrame)
    );
    assert.equal(stateAtStageStart.currentStageId, stage.id);
    for (const previousStage of AGENT_SKILL_SHORT_S04_HIGHLIGHT_STAGES.slice(0, stageIndex)) {
      assert.equal(stateAtStageStart.nodeHighlightProgress[previousStage.nodeIds[0]], 1);
      for (const edgeId of previousStage.edgeIds) {
        assert.equal(stateAtStageStart.edgeHighlightProgress[edgeId], 1);
        assert.equal(stateAtStageStart.edgeHighlightArrowProgress[edgeId], 1);
      }
    }

    for (const edgeId of stage.edgeIds) {
      const stateAtOffset = (offset) => agentSkillShortS04HighlightStateAt(
        secondsAtFrame(stageFrame + offset)
      );
      assert.equal(stateAtOffset(0).edgeHighlightProgress[edgeId], 0);
      assert.equal(
        stateAtOffset(AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES)
          .edgeHighlightProgress[edgeId],
        1
      );
      assert.equal(
        stateAtOffset(AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES)
          .edgeHighlightArrowProgress[edgeId],
        0
      );
      assert.equal(
        stateAtOffset(
          AGENT_SKILL_SHORT_S04_HIGHLIGHT_EDGE_DRAW_FRAMES +
            AGENT_SKILL_SHORT_S04_HIGHLIGHT_ARROW_FADE_FRAMES
        ).edgeHighlightArrowProgress[edgeId],
        1
      );
    }
  }

  const fullHold = agentSkillShortDiagramStateAt("architecture", secondsAtFrame(679));
  const finalS04Frame = agentSkillShortDiagramStateAt("architecture", secondsAtFrame(763));
  const firstCrossfadeFrame = agentSkillShortDiagramStateAt("architecture", secondsAtFrame(764));
  for (const state of [fullHold, finalS04Frame, firstCrossfadeFrame]) {
    assert.equal(Object.values(state.nodeProgress).every((value) => value === 1), true);
    assert.equal(Object.values(state.edgeProgress).every((value) => value === 1), true);
    for (const nodeId of ["skill-knowledge", "agent", "mcp-protocol", "external-capability"]) {
      assert.equal(state.nodeHighlightProgress[nodeId], 1);
    }
    for (const edgeId of [
      "skill-guides-agent",
      "agent-uses-mcp",
      "mcp-connects-capability"
    ]) {
      assert.equal(state.edgeHighlightProgress[edgeId], 1);
      assert.equal(state.edgeHighlightArrowProgress[edgeId], 1);
    }
    assert.equal(state.nodeHighlightProgress["tool-action"], 0);
    assert.equal(state.edgeHighlightProgress["agent-invokes-tool"], 0);
  }
  assert.equal(fullHold.highlightActive, true);
  assert.equal(finalS04Frame.highlightActive, true);
  assert.equal(firstCrossfadeFrame.highlightActive, false);
  assert.equal(firstCrossfadeFrame.highlightComplete, true);
});

test("原版 Remotion 组件逐帧使用计划层，不引入 CSS 动画或 HyperFrames", async () => {
  const component = await readFile(
    resolve(studioRoot, "src", "video", "agent-skill-short.jsx"),
    "utf8"
  );
  assert.match(component, /agentSkillShortDiagramLayersAt\(currentSecond\)/u);
  assert.match(component, /opacity=\{layer\.opacity\}/u);
  assert.match(component, /state\.nodeHighlightProgress/u);
  assert.match(component, /state\.edgeHighlightProgress/u);
  assert.match(component, /state\.edgeHighlightArrowProgress/u);
  assert.match(component, /data-highlight-stage=\{state\.highlightStageId/u);
  assert.doesNotMatch(component, /transition:\s*["'`]/u);
  assert.doesNotMatch(component, /\banimation(?:Name)?\s*:/u);
  assert.doesNotMatch(component, /\bspring\s*\(/u);
  assert.doesNotMatch(component, /HyperFrames|hyperframes|gsap/u);
});
