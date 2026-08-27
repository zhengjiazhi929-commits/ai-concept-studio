import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { studioRoot } from "../src/shared/paths.mjs";
import { createAgentSkillLongReviewEpisodeFixture } from "./fixtures/agent-skill-long-review-episode.mjs";
import {
  VISUAL_EXPRESSION_REVIEW_CANDIDATE_STYLE_PROFILE_ID,
  validateVisualExpressionPlan
} from "../src/shared/visual-expression-contract.mjs";
import {
  EDITORIAL_CARD_SURFACE_PURPOSES,
  EDITORIAL_ICON_PRESENTATIONS,
  EDITORIAL_OPEN_SURFACE_PURPOSES,
  editorialSurfaceCohortKey
} from "../src/shared/editorial-visual-policy.mjs";
import {
  AGENT_SKILL_LONG_REVIEW_CHAPTERS,
  AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES,
  AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS,
  AGENT_SKILL_LONG_REVIEW_EDITORIAL_REVIEW,
  AGENT_SKILL_LONG_REVIEW_FPS,
  AGENT_SKILL_LONG_REVIEW_FRAME_COUNT,
  AGENT_SKILL_LONG_REVIEW_ICON_LAYOUT_POLICY,
  AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES,
  AGENT_SKILL_LONG_REVIEW_ORPHAN_SUBTITLE_RULES,
  AGENT_SKILL_LONG_REVIEW_SCENE_SPECS,
  AGENT_SKILL_LONG_REVIEW_STAGE_CAPTION_PHASE_FRAMES,
  AGENT_SKILL_LONG_REVIEW_STAGE_DENSITY_POLICY,
  longReviewDiagramStateAtFrame,
  longReviewDisplaySubtitles,
  longReviewLayoutAtFrame,
  longReviewProgressAtFrame,
  longReviewSceneAtFrame,
  longReviewSceneLayersAtFrame,
  longReviewSemanticEdgeRevealFrame,
  longReviewSemanticNodeRevealFrame,
  longReviewStageCaptionLayout,
  longReviewStageCaptionStateAtFrame,
  longReviewSubtitleGateAtFrame,
  longReviewVisibleEdgeIdsAtStage,
  longReviewVisibleNodeIdsAtStage,
  validateAgentSkillLongReviewEpisode
} from "../src/video/agent-skill-long-review-plan.mjs";

const PLAN_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review-plan.mjs");
const COMPONENT_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review.jsx");
const VISUAL_COMPONENTS_PATH = resolve(
  studioRoot,
  "src",
  "video",
  "components",
  "visual-system-v1",
  "components.jsx"
);
const VISUAL_MOTION_PATH = resolve(
  studioRoot,
  "src",
  "video",
  "components",
  "visual-system-v1",
  "motion.mjs"
);
const INDEX_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review-index.jsx");
const ROOT_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review-root.jsx");
const RENDER_PATH = resolve(studioRoot, "scripts", "render-agent-skill-long-review.mjs");
const PRODUCTION_ROOT_PATH = resolve(studioRoot, "src", "video", "root.jsx");
const PRODUCTION_PREVIEW_PATH = resolve(studioRoot, "src", "video", "episode-preview.jsx");

async function readFixtureEpisode() {
  return createAgentSkillLongReviewEpisodeFixture(AGENT_SKILL_LONG_REVIEW_SCENE_SPECS);
}

function assertMonotonic(values, label) {
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(
      values[index] + 1e-12 >= values[index - 1],
      `${label} must not decrease at sample ${index}: ${values[index - 1]} -> ${values[index]}`
    );
  }
}

function sceneById(sceneId) {
  const scene = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((item) => item.id === sceneId);
  assert.ok(scene, `missing scene ${sceneId}`);
  return scene;
}

function routeSegments(route) {
  return route.slice(1).map((point, index) => [route[index], point]);
}

function assertOrthogonalConnector(connector, label = connector.relationId) {
  assert.equal(connector.presentationKind, "orthogonal", `${label} presentation`);
  assert.ok(connector.route.length >= 2, `${label} route`);
  for (const [start, end] of routeSegments(connector.route)) {
    assert.ok(
      start.x === end.x || start.y === end.y,
      `${label} contains diagonal segment ${JSON.stringify([start, end])}`
    );
  }
}

function assertRelationEndpointsVisible(scene, nodeIds, edgeIds, label) {
  const visibleNodes = new Set(nodeIds);
  const relations = new Map(scene.edges.map((edge) => [edge.id, edge]));
  const incidentNodes = new Set();
  for (const edgeId of edgeIds) {
    const relation = relations.get(edgeId);
    assert.ok(relation, `${label} unknown relation ${edgeId}`);
    assert.ok(visibleNodes.has(relation.from), `${label}/${edgeId} source hidden`);
    assert.ok(visibleNodes.has(relation.to), `${label}/${edgeId} target hidden`);
    incidentNodes.add(relation.from);
    incidentNodes.add(relation.to);
  }
  return incidentNodes;
}

test("十分钟审阅版固定为 600 秒、30fps、18000 帧，并兼容 18 场景与 107 字幕合同", async () => {
  assert.equal(AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS, 600);
  assert.equal(AGENT_SKILL_LONG_REVIEW_FPS, 30);
  assert.equal(AGENT_SKILL_LONG_REVIEW_FRAME_COUNT, 18_000);
  assert.equal(
    AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS * AGENT_SKILL_LONG_REVIEW_FPS,
    AGENT_SKILL_LONG_REVIEW_FRAME_COUNT
  );

  const episode = await readFixtureEpisode();
  assert.equal(episode.id, "agent-skill-20260806");
  assert.equal(episode.scenes.length, 18);
  assert.equal(episode.subtitles.length, 107);
  assert.deepEqual(
    episode.scenes.map((scene) => scene.id),
    Array.from({ length: 18 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`)
  );
  assert.equal(episode.scenes[0].start, 0);
  assert.equal(episode.scenes.at(-1).end, 600);
  assert.equal(episode.subtitles[0].start, 0);
  assert.equal(episode.subtitles.at(-1).end, 600);
  assert.equal(validateAgentSkillLongReviewEpisode(episode), true);
});

test("18 个镜头先声明通用视觉语义，再由结构决定箭头、风格和标题时序", async () => {
  const review = validateVisualExpressionPlan(
    { scenes: AGENT_SKILL_LONG_REVIEW_SCENE_SPECS },
    {
      requireResolvedPlans: true,
      requireLayoutSamples: true,
      styleProfileId: VISUAL_EXPRESSION_REVIEW_CANDIDATE_STYLE_PROFILE_ID
    }
  );
  assert.equal(review.passed, true, JSON.stringify(review.issues, null, 2));
  for (const spec of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    assert.deepEqual(
      spec.visualPlan.semanticElements.map((item) => item.id),
      spec.nodes.map((item) => item.id)
    );
    assert.deepEqual(
      spec.visualPlan.semanticRelations.map((item) => item.id),
      spec.edges.map((item) => item.id)
    );
    assert.equal(spec.visualPlan.styleProfileId, "visual-system-v1");
    assert.equal(
      spec.visualPlan.compositionProfile,
      ["S01", "S18"].includes(spec.id) ? "text-first" : "relation-first"
    );
    assert.ok(spec.visualIntent.contributionRationale.length >= 18);
  }
  const nonDirectedRelations = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.flatMap((spec) =>
    spec.visualPlan.semanticRelations
      .filter((relation) => relation.directed === false)
      .map((relation) => ({ sceneId: spec.id, relation }))
  );
  assert.ok(nonDirectedRelations.length > 0);
  assert.deepEqual(new Set(nonDirectedRelations.map((item) => item.sceneId)), new Set(["S05"]));
  for (const spec of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    const relationById = new Map(spec.visualPlan.semanticRelations.map((relation) => [relation.id, relation]));
    for (const edge of spec.edges) {
      const relation = relationById.get(edge.id);
      assert.equal(typeof relation?.directed, "boolean", `${spec.id}/${edge.id} direction`);
      assert.equal(relation.directed, edge.directed, `${spec.id}/${edge.id} direction drift`);
      assert.equal(relation.type, edge.semanticType, `${spec.id}/${edge.id} semantic type drift`);
      assert.equal(relation.label, edge.semanticLabel, `${spec.id}/${edge.id} semantic label drift`);
    }
  }

  const opening = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS[0];
  assert.equal(opening.visualPlan.timing.supportingCopyStartFrame, 18);
  assert.equal(opening.visualPlan.timing.graphicStartFrame, 28);
  assert.equal(opening.visualPlan.timing.detailCopyStartFrame, 42);
  assert.equal(longReviewDiagramStateAtFrame("S01", 27).nodeProgress["prompt-a"], 0);
  assert.ok(longReviewDiagramStateAtFrame("S01", 28).nodeProgress["prompt-a"] > 0);

  const component = await readFile(COMPONENT_PATH, "utf8");
  assert.match(component, /semanticRelations\.get\(connector\.relationId\)\?\.directed/u);
  assert.match(component, /data-semantic-relation-id/u);
  assert.match(component, /visualPlan\.timing\.supportingCopyStartFrame/u);
  assert.match(component, /longReviewSubtitleGateAtFrame/u);
});

test("长片显示层合并五个孤立尾词，同时保持 107 条合同夹具源字幕不变", async () => {
  const episode = await readFixtureEpisode();
  const sourceSnapshot = JSON.stringify(episode.subtitles);
  const displaySubtitles = longReviewDisplaySubtitles(episode.subtitles);

  assert.equal(displaySubtitles.length, 102);
  assert.equal(JSON.stringify(episode.subtitles), sourceSnapshot, "display mapping must not mutate Episode subtitles");
  assert.equal(displaySubtitles[0].start, 0);
  assert.equal(displaySubtitles.at(-1).end, 600);
  for (let index = 1; index < displaySubtitles.length; index += 1) {
    assert.equal(displaySubtitles[index - 1].end, displaySubtitles[index].start);
  }

  const mergedSubtitles = [
    { start: 14.082, end: 30, text: "聊天框里，还是变成 Agent 可以反复调用的能力？" },
    { start: 193.669, end: 200, text: "混淆，是因为 Skill 的核心说明仍然使用自然语言。" },
    { start: 226.966, end: 234, text: "版本和回退，而不是依赖某个人记得那段“效果最好”的聊天文本。" },
    { start: 402.894, end: 410.911, text: "关键步骤是否稳定、错误是否可检测、结果是否有共同验收标准。" },
    { start: 430.26, end: 438, text: "什么材料、哪些步骤绝不能跳过，以及什么证据代表任务完成。" }
  ];
  assert.deepEqual(
    displaySubtitles.filter((subtitle) =>
      mergedSubtitles.some((expected) =>
        subtitle.start === expected.start && subtitle.end === expected.end
      )
    ),
    mergedSubtitles
  );
  assert.equal(
    displaySubtitles.filter((subtitle) =>
      !mergedSubtitles.some((expected) =>
        subtitle.start === expected.start && subtitle.end === expected.end
      )
    ).every((subtitle) => episode.subtitles.some((source) =>
      source.start === subtitle.start && source.end === subtitle.end && source.text === subtitle.text
    )),
    true
  );
  assert.equal(
    displaySubtitles.some((subtitle) =>
      AGENT_SKILL_LONG_REVIEW_ORPHAN_SUBTITLE_RULES.some((rule) =>
        subtitle.start === rule.start && subtitle.end === rule.end && subtitle.text === rule.text
      )
    ),
    false
  );
  assert.deepEqual(
    mergedSubtitles.map(({ text }) => text),
    [
      "聊天框里，还是变成 Agent 可以反复调用的能力？",
      "混淆，是因为 Skill 的核心说明仍然使用自然语言。",
      "版本和回退，而不是依赖某个人记得那段“效果最好”的聊天文本。",
      "关键步骤是否稳定、错误是否可检测、结果是否有共同验收标准。",
      "什么材料、哪些步骤绝不能跳过，以及什么证据代表任务完成。"
    ]
  );
});

test("S01 前十四秒分三次增加信息，十四秒后汇总，二十八秒才收束为 Skill", () => {
  const scene = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((item) => item.id === "S01");
  assert.deepEqual(
    scene.stages.map(({ id, startFrame }) => ({ id, startFrame })),
    [
      { id: "copy-one", startFrame: 0 },
      { id: "copy-two", startFrame: 141 },
      { id: "copy-three", startFrame: 282 },
      { id: "fragment", startFrame: 422 },
      { id: "package", startFrame: 845 }
    ]
  );
  assert.deepEqual(scene.stages.map(({ nodeIds }) => [...nodeIds]), [
    ["prompt-a"],
    ["prompt-b"],
    ["prompt-c"],
    [],
    ["skill-unit"]
  ]);
  assert.deepEqual([...scene.stages[3].activeNodeIds], ["prompt-a", "prompt-b", "prompt-c"]);

  assert.equal(longReviewSemanticNodeRevealFrame("S01", "prompt-b"), 159);
  assert.equal(longReviewSemanticNodeRevealFrame("S01", "prompt-c"), 300);
  assert.equal(longReviewSemanticNodeRevealFrame("S01", "skill-unit"), 863);
  assert.equal(longReviewDiagramStateAtFrame("S01", 158).nodeProgress["prompt-b"], 0);
  assert.ok(longReviewDiagramStateAtFrame("S01", 159).nodeProgress["prompt-b"] > 0);
  assert.equal(longReviewDiagramStateAtFrame("S01", 299).nodeProgress["prompt-c"], 0);
  assert.ok(longReviewDiagramStateAtFrame("S01", 300).nodeProgress["prompt-c"] > 0);
  assert.equal(longReviewDiagramStateAtFrame("S01", 862).nodeProgress["skill-unit"], 0);
  assert.ok(longReviewDiagramStateAtFrame("S01", 863).nodeProgress["skill-unit"] > 0);

  let longestSingleCardRun = 0;
  let currentSingleCardRun = 0;
  for (let frame = 0; frame < 422; frame += 1) {
    const state = longReviewDiagramStateAtFrame("S01", frame);
    const visiblePromptCount = ["prompt-a", "prompt-b", "prompt-c"]
      .filter((nodeId) => state.nodeProgress[nodeId] > 0)
      .length;
    currentSingleCardRun = visiblePromptCount === 1 ? currentSingleCardRun + 1 : 0;
    longestSingleCardRun = Math.max(longestSingleCardRun, currentSingleCardRun);
  }
  assert.ok(
    longestSingleCardRun <=
      5 * AGENT_SKILL_LONG_REVIEW_FPS + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES
  );
  const atTenSeconds = longReviewDiagramStateAtFrame("S01", 10 * AGENT_SKILL_LONG_REVIEW_FPS);
  assert.equal(atTenSeconds.nodeProgress["prompt-a"], 1);
  assert.equal(atTenSeconds.nodeProgress["prompt-b"], 1);
  assert.ok(atTenSeconds.nodeProgress["prompt-c"] > 0);
  const atElevenSeconds = longReviewDiagramStateAtFrame("S01", 11 * AGENT_SKILL_LONG_REVIEW_FPS);
  assert.deepEqual(
    ["prompt-a", "prompt-b", "prompt-c"].map((nodeId) => atElevenSeconds.nodeProgress[nodeId]),
    [1, 1, 1]
  );
  assert.equal(atTenSeconds.nodeProgress["skill-unit"], 0);
});

test("S18 用关系语法承载五项收束，不回退为旧卡片矩阵", async () => {
  const summary = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((item) => item.id === "S18");
  assert.equal(summary.nodes.length, 5);
  assert.equal(summary.visualPlan.structure, "flow");
  assert.equal(summary.visualPlan.compositionProfile, "text-first");
  assert.equal(
    summary.layoutSamples[0].elements.every((element) => element.primitive === "flow-step"),
    true
  );
  assert.equal(
    summary.layoutSamples[0].elements.every((element) => element.fontSizePx >= 28),
    true
  );

  const [component, visualComponents] = await Promise.all([
    readFile(COMPONENT_PATH, "utf8"),
    readFile(VISUAL_COMPONENTS_PATH, "utf8")
  ]);
  assert.match(component, /VisualSystemV1SemanticNode/u);
  assert.match(component, /primitive=\{semanticLayout\.primitiveById\[node\.id\]\}/u);
  assert.doesNotMatch(component, /VisualSystemV1FlatNode/u);
  assert.match(visualComponents, /const labelFontSize = informationCard/u);
  assert.match(visualComponents, /whiteSpace: informationCard \? "nowrap"/u);
});

test("后续阶段先完成稳定布局的显隐交接，再显示新节点并按物理因果绘制关系", async () => {
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    const firstSeenNodes = new Set();
    for (const [stageIndex, stage] of scene.stages.entries()) {
      for (const nodeId of stage.nodeIds) {
        if (firstSeenNodes.has(nodeId)) continue;
        firstSeenNodes.add(nodeId);
        const revealFrame = longReviewSemanticNodeRevealFrame(scene.id, nodeId);
        if (stageIndex === 0) {
          assert.ok(revealFrame >= stage.startFrame, `${scene.id}/${nodeId} first-stage reveal`);
          continue;
        }
        assert.equal(
          revealFrame,
          stage.startFrame + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES,
          `${scene.id}/${nodeId} must wait for stage visibility handoff`
        );
        const beforeReveal = longReviewDiagramStateAtFrame(scene.id, revealFrame - 1);
        assert.equal(beforeReveal.stageTransitionProgress, 1);
        assert.equal(beforeReveal.nodeProgress[nodeId], 0);
        assert.ok(longReviewDiagramStateAtFrame(scene.id, revealFrame).nodeProgress[nodeId] > 0);
      }
      for (const edgeId of stage.edgeIds) {
        const relation = scene.edges.find((item) => item.id === edgeId);
        const revealFrame = longReviewSemanticEdgeRevealFrame(scene.id, edgeId);
        const beforeReveal = longReviewDiagramStateAtFrame(scene.id, revealFrame - 1);
        const atReveal = longReviewDiagramStateAtFrame(scene.id, revealFrame);
        assert.equal(beforeReveal.edgeProgress[edgeId], 0);
        assert.ok(atReveal.edgeProgress[edgeId] > 0);
        assert.ok(atReveal.nodeProgress[relation.from] > 0, `${scene.id}/${edgeId} source visible`);
        assert.ok(atReveal.nodeProgress[relation.to] > 0, `${scene.id}/${edgeId} target visible`);
      }
    }
  }

  const component = await readFile(COMPONENT_PATH, "utf8");
  assert.match(component, /longReviewSemanticNodeRevealFrame\(spec\.id, node\.id\)/u);
  assert.match(component, /startFrame=\{revealFrame\}/u);
  assert.doesNotMatch(component, /function firstRevealFrame/u);
});

test("阶段说明在所有帧都先退后进，同一位置最多显示一句", () => {
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    for (let frame = scene.startFrame; frame < scene.endFrame; frame += 1) {
      const caption = longReviewStageCaptionStateAtFrame(scene.id, frame);
      const previousOpacity = caption.previous?.opacity ?? 0;
      const currentOpacity = caption.current.opacity;
      assert.ok(previousOpacity >= 0 && previousOpacity <= 1);
      assert.ok(currentOpacity >= 0 && currentOpacity <= 1);
      assert.equal(
        previousOpacity > 0 && currentOpacity > 0,
        false,
        `${scene.id} stage caption overlap at frame ${frame}`
      );
    }
    for (const stage of scene.stages.slice(1)) {
      const start = stage.startFrame;
      const midpoint = start + AGENT_SKILL_LONG_REVIEW_STAGE_CAPTION_PHASE_FRAMES - 1;
      const incomingStart = start + AGENT_SKILL_LONG_REVIEW_STAGE_CAPTION_PHASE_FRAMES;
      const settled = start + AGENT_SKILL_LONG_REVIEW_STAGE_CAPTION_PHASE_FRAMES * 2 - 1;
      const atStart = longReviewStageCaptionStateAtFrame(scene.id, start);
      const atMidpoint = longReviewStageCaptionStateAtFrame(scene.id, midpoint);
      const atIncoming = longReviewStageCaptionStateAtFrame(scene.id, incomingStart);
      const atSettled = longReviewStageCaptionStateAtFrame(scene.id, settled);
      assert.ok(atStart.previous.opacity > 0);
      assert.equal(atStart.current.opacity, 0);
      assert.equal(atMidpoint.previous.opacity, 0);
      assert.equal(atMidpoint.current.opacity, 0);
      assert.equal(atIncoming.previous.opacity, 0);
      assert.ok(atIncoming.current.opacity > 0);
      assert.equal(atSettled.current.opacity, 1);
    }
  }
});

test("运行时连接线把阶段说明作为保留带，且十八场每个阶段都只输出横竖折线", async () => {
  const width = 1920;
  const height = 1080;
  const captionBand = longReviewStageCaptionLayout(width, height);
  const protectedBottom = captionBand.bottom + captionBand.connectorClearance;
  assert.equal(captionBand.top, 298);
  assert.equal(captionBand.bottom, 332);
  assert.equal(protectedBottom, 340);

  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    assert.equal(scene.layoutStability, "stable-final", scene.id);
    assert.equal(
      scene.edges.some((edge) => edge.connectorPresentation?.kind === "smooth-curve"),
      false,
      `${scene.id} declares smooth connector`
    );
    const finalLayout = longReviewLayoutAtFrame(scene.id, scene.endFrame - 1, { width, height });
    for (const connector of finalLayout.allConnectors) {
      assertOrthogonalConnector(connector, `${scene.id}/final/${connector.relationId}`);
      const relation = scene.edges.find((edge) => edge.id === connector.relationId);
      assert.equal(connector.arrowhead, relation.directed, `${scene.id}/${connector.relationId} arrowhead`);
    }
    for (const [stageIndex, stage] of scene.stages.entries()) {
      const sampleFrames = [
        stage.startFrame,
        Math.min(scene.endFrame - 1, stage.startFrame + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES),
        Math.min(scene.endFrame - 1, (scene.stages[stageIndex + 1]?.startFrame ?? scene.endFrame) - 1)
      ];
      for (const frame of new Set(sampleFrames)) {
        const layout = longReviewLayoutAtFrame(scene.id, frame, { width, height });
        assert.deepEqual(layout.fullGeometryById, finalLayout.fullGeometryById, `${scene.id}/${stage.id} geometry drift`);
        for (const connector of layout.connectors) {
          assertOrthogonalConnector(connector, `${scene.id}/${stage.id}/${frame}/${connector.relationId}`);
          const relation = scene.edges.find((edge) => edge.id === connector.relationId);
          assert.equal(connector.arrowhead, relation.directed, `${scene.id}/${connector.relationId} arrowhead`);
        }
      }
    }
  }

  for (const sceneId of ["S09", "S10", "S16"]) {
    const scene = sceneById(sceneId);
    for (const stage of scene.stages) {
      const layout = longReviewLayoutAtFrame(sceneId, stage.startFrame, { width, height });
      for (const connector of layout.connectors) {
        for (const point of connector.route) {
          assert.ok(
            point.y >= protectedBottom - 1e-7,
            `${sceneId}/${stage.id}/${connector.relationId} intrudes into stage caption reserve at y=${point.y}`
          );
        }
      }
    }
  }

  const component = await readFile(COMPONENT_PATH, "utf8");
  assert.match(component, /longReviewLayoutAtFrame\(spec\.id, globalFrame/u);
  assert.match(component, /longReviewStageCaptionLayout\(width, height\)/u);
  assert.match(component, /<polyline/u);
  assert.doesNotMatch(component, /presentationKind === "smooth-curve"/u);
});

test("S18 关键窗口隐藏04与最终卡直至显隐交接完成，标题和字幕保持", async () => {
  const episode = await readFixtureEpisode();
  const summary = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((item) => item.id === "S18");
  const rollbackStage = summary.stages.find((item) => item.id === "rollback");
  assert.equal(rollbackStage.startFrame, 17708);
  assert.equal(longReviewSemanticNodeRevealFrame("S18", "rollback"), 17726);
  assert.equal(longReviewSemanticNodeRevealFrame("S18", "adopt"), 17726);

  for (let frame = 17710; frame <= 17720; frame += 1) {
    const state = longReviewDiagramStateAtFrame("S18", frame);
    assert.equal(state.nodeProgress.rollback, 0, `rollback visible at reported local frame ${frame - 17700}`);
    assert.equal(state.nodeProgress.adopt, 0, `adopt visible at reported local frame ${frame - 17700}`);
  }
  for (let frame = 17718; frame <= 17728; frame += 1) {
    const state = longReviewDiagramStateAtFrame("S18", frame);
    if (frame < 17726) {
      assert.equal(state.nodeProgress.rollback, 0);
      assert.equal(state.nodeProgress.adopt, 0);
    } else {
      assert.equal(state.stageTransitionProgress, 1);
    }
  }
  const visibilityHandoffComplete = longReviewDiagramStateAtFrame("S18", 17725);
  assert.equal(visibilityHandoffComplete.stageTransitionProgress, 1);
  assert.equal(visibilityHandoffComplete.nodeProgress.rollback, 0);
  assert.equal(visibilityHandoffComplete.nodeProgress.adopt, 0);
  const revealBegins = longReviewDiagramStateAtFrame("S18", 17726);
  assert.ok(revealBegins.nodeProgress.rollback > 0);
  assert.ok(revealBegins.nodeProgress.adopt > 0);

  for (const edgeId of rollbackStage.edgeIds) {
    const edgeRevealFrame = longReviewSemanticEdgeRevealFrame("S18", edgeId);
    assert.ok(edgeRevealFrame >= 17729);
    assert.equal(longReviewDiagramStateAtFrame("S18", edgeRevealFrame - 1).edgeProgress[edgeId], 0);
    assert.ok(longReviewDiagramStateAtFrame("S18", edgeRevealFrame).edgeProgress[edgeId] > 0);
  }
  assert.equal(summary.holdStartFrame, 17747);
  const finalHold = longReviewDiagramStateAtFrame("S18", summary.holdStartFrame);
  assert.equal(finalHold.finalHold, true);
  assert.equal(finalHold.nodeProgress.adopt, 1);
  assert.equal(finalHold.edgeProgress["rollback-adopt"], 1);
  assert.equal(finalHold.edgeArrowProgress["rollback-adopt"], 1);

  for (const frame of [17710, 17718, 17720, 17726, 17728]) {
    const scene = longReviewSceneAtFrame(frame);
    const layers = longReviewSceneLayersAtFrame(frame);
    const subtitle = longReviewSubtitleGateAtFrame(episode.subtitles, frame);
    assert.equal(scene.id, "S18");
    assert.equal(scene.title, "先定义边界，再把方法变成 Skill");
    assert.equal(layers.length, 1);
    assert.equal(layers[0].sceneId, "S18");
    assert.equal(layers[0].copyOpacity, 1);
    assert.equal(subtitle.opacity, 1);
    assert.equal(subtitle.activeSubtitle?.text, "完成标准、权限边界和版本回退。");
  }

  const forbiddenStatusBadges = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.flatMap((scene) =>
    scene.standaloneIcons
      .filter((icon) =>
        icon.conceptKind === "verified-success" ||
        icon.statusMarkVariant === "celebrate" ||
        icon.id === "adopt-success"
      )
      .map((icon) => `${scene.id}/${icon.id}/${icon.conceptKind}/${icon.statusMarkVariant}`)
  );
  assert.deepEqual(forbiddenStatusBadges, []);
});

test("审阅计划用八章和十八个镜头连续覆盖完整时轴", () => {
  assert.equal(AGENT_SKILL_LONG_REVIEW_CHAPTERS.length, 8);
  assert.equal(AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.length, 18);
  assert.equal(AGENT_SKILL_LONG_REVIEW_CHAPTERS[0].startFrame, 0);
  assert.equal(AGENT_SKILL_LONG_REVIEW_CHAPTERS.at(-1).endFrame, 18_000);
  assert.equal(AGENT_SKILL_LONG_REVIEW_SCENE_SPECS[0].startFrame, 0);
  assert.equal(AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.at(-1).endFrame, 18_000);

  for (const [index, chapter] of AGENT_SKILL_LONG_REVIEW_CHAPTERS.entries()) {
    assert.ok(chapter.endFrame > chapter.startFrame);
    if (index > 0) {
      assert.equal(chapter.startFrame, AGENT_SKILL_LONG_REVIEW_CHAPTERS[index - 1].endFrame);
    }
  }
  for (const [index, scene] of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.entries()) {
    assert.equal(scene.id, `S${String(index + 1).padStart(2, "0")}`);
    assert.ok(scene.endFrame > scene.startFrame);
    if (index > 0) {
      assert.equal(scene.startFrame, AGENT_SKILL_LONG_REVIEW_SCENE_SPECS[index - 1].endFrame);
    }
    assert.equal(longReviewSceneAtFrame(scene.startFrame).id, scene.id);
    assert.equal(longReviewSceneAtFrame(scene.endFrame - 1).id, scene.id);
  }
});

test("所有分步图的动画进度单调完成，阶段窗口按当前语义切换", () => {
  const stagedScenes = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.filter(
    (scene) => Number(scene.stageCount ?? scene.stages?.length ?? 0) > 0
  );
  assert.equal(stagedScenes.length, 18, "十八个镜头都必须有贯穿时长的分步状态");

  for (const scene of stagedScenes) {
    const stageCount = Number(scene.stageCount ?? scene.stages.length);
    const progressByKind = {
      nodeProgress: new Map(),
      edgeProgress: new Map(),
      edgeArrowProgress: new Map()
    };
    const stageIndexes = [];
    let firstFinalHoldFrame = null;
    for (let frame = scene.startFrame; frame < scene.endFrame; frame += 1) {
      const state = longReviewDiagramStateAtFrame(scene.id, frame);
      assert.ok(state, `${scene.id} must expose diagram state`);
      assert.ok(Number.isInteger(state.stageIndex));
      assert.ok(state.stageIndex >= 0 && state.stageIndex < stageCount);
      stageIndexes.push(state.stageIndex);
      if (state.finalHold && firstFinalHoldFrame === null) firstFinalHoldFrame = frame;
      for (const [kind, progressMap] of Object.entries(progressByKind)) {
        for (const [id, progress] of Object.entries(state[kind] ?? {})) {
          assert.ok(progress >= 0 && progress <= 1, `${scene.id} ${kind}.${id} out of range`);
          if (!progressMap.has(id)) progressMap.set(id, []);
          progressMap.get(id).push(progress);
        }
      }
    }
    assertMonotonic(stageIndexes, `${scene.id} stageIndex`);
    for (const [kind, progressMap] of Object.entries(progressByKind)) {
      for (const [id, values] of progressMap.entries()) {
        assertMonotonic(values, `${scene.id} ${kind}.${id}`);
        assert.equal(values.at(-1), 1, `${scene.id} ${kind}.${id} must finish revealed`);
      }
    }

    const finalState = longReviewDiagramStateAtFrame(scene.id, scene.endFrame - 1);
    assert.equal(finalState.finalHold, true);
    assert.equal(finalState.stageIndex, stageCount - 1);
    assert.ok(firstFinalHoldFrame !== null, `${scene.id} must expose a final hold interval`);
    const holdStart = longReviewDiagramStateAtFrame(scene.id, firstFinalHoldFrame);
    for (const kind of Object.keys(progressByKind)) {
      assert.deepEqual(holdStart[kind], finalState[kind], `${scene.id} ${kind} changed during hold`);
    }
  }
});

test("每个镜头边界保持画面守恒交叉淡化，文字按先退后进交接且不会重叠", () => {
  assert.ok(AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES > 0);
  const copyHandoffFrame = Math.floor((AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES - 1) / 2);
  for (const incoming of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.slice(1)) {
    const boundaryFrame = incoming.startFrame;
    const outgoing = longReviewSceneAtFrame(boundaryFrame - 1);
    for (
      let frame = boundaryFrame - AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES;
      frame <= boundaryFrame + AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES;
      frame += 1
    ) {
      const layers = longReviewSceneLayersAtFrame(frame);
      assert.ok(layers.length >= 1 && layers.length <= 2);
      const opacitySum = layers.reduce((sum, layer) => sum + layer.opacity, 0);
      assert.ok(Math.abs(opacitySum - 1) < 1e-12, `opacity sum at frame ${frame}`);
      assert.ok(layers.some((layer) => layer.opacity > 0), `blank frame ${frame}`);
      assert.equal(layers.every((layer) => layer.opacity >= 0 && layer.opacity <= 1), true);
      assert.equal(layers.every((layer) => layer.copyOpacity >= 0 && layer.copyOpacity <= 1), true);
      assert.equal(layers.every((layer) => layer.diagramOpacity >= 0 && layer.diagramOpacity <= 1), true);
      assert.ok(
        layers.filter((layer) => layer.opacity * layer.copyOpacity > 1e-12).length <= 1,
        `copy overlap at frame ${frame}`
      );
      assert.ok(
        layers.filter((layer) => layer.opacity * layer.diagramOpacity > 1e-12).length <= 1,
        `diagram overlap at frame ${frame}`
      );
    }
    const atBoundary = longReviewSceneLayersAtFrame(boundaryFrame);
    assert.ok(atBoundary.some((layer) => layer.sceneId === outgoing.id));
    assert.ok(atBoundary.some((layer) => layer.sceneId === incoming.id));
    assert.equal(atBoundary.find((layer) => layer.role === "outgoing").copyOpacity, 1);
    assert.equal(atBoundary.find((layer) => layer.role === "incoming").copyOpacity, 0);
    assert.equal(atBoundary.find((layer) => layer.role === "outgoing").diagramOpacity, 1);

    const atCopyHandoff = longReviewSceneLayersAtFrame(boundaryFrame + copyHandoffFrame);
    assert.equal(atCopyHandoff.every((layer) => layer.copyOpacity === 0), true);
    assert.equal(atCopyHandoff.find((layer) => layer.role === "outgoing").diagramOpacity, 0);

    const afterCrossfade = longReviewSceneLayersAtFrame(
      boundaryFrame + AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES - 1
    );
    assert.equal(afterCrossfade.find((layer) => layer.role === "outgoing").copyOpacity, 0);
    assert.equal(afterCrossfade.find((layer) => layer.role === "incoming").copyOpacity, 1);
  }
});

test("跨场景字幕保持连续，其余场景仍由大标题领先建立", async () => {
  const episode = await readFixtureEpisode();
  const beforeBoundary = longReviewSubtitleGateAtFrame(episode.subtitles, Math.round(403.9 * 30));
  const atBoundary = longReviewSubtitleGateAtFrame(episode.subtitles, 404 * 30);
  const afterBoundary = longReviewSubtitleGateAtFrame(episode.subtitles, Math.round(404.5 * 30));
  assert.equal(beforeBoundary.opacity, 1);
  assert.equal(atBoundary.mode, "carry-over");
  assert.equal(atBoundary.opacity, 1);
  assert.equal(afterBoundary.mode, "carry-over");
  assert.equal(afterBoundary.opacity, 1);

  const newSceneSubtitle = longReviewSubtitleGateAtFrame(episode.subtitles, 438 * 30);
  assert.equal(newSceneSubtitle.mode, "scene-title-first");
  assert.equal(newSceneSubtitle.opacity, 0);
  const afterTitleLead = longReviewSubtitleGateAtFrame(episode.subtitles, 438 * 30 + 18);
  assert.ok(afterTitleLead.opacity > 0);
});

test("正式长片信息卡保持纯文字，典型 AI 图标只能作为卡片外独立演示", async () => {
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    for (const node of scene.nodes) {
      assert.equal(node.conceptKind, undefined, `${scene.id}/${node.id} embeds conceptKind`);
      assert.equal(node.iconPurpose, undefined, `${scene.id}/${node.id} embeds iconPurpose`);
      assert.equal(node.statusMarkVariant, undefined, `${scene.id}/${node.id} embeds status mark`);
      assert.equal(node.statusMarkDelayUntilFinalHold, undefined, `${scene.id}/${node.id} embeds delayed mark`);
    }
    for (const card of scene.editorialScene.cards) {
      assert.equal(card.conceptKind, "none", `${scene.id}/${card.id}`);
      assert.equal(card.iconPresentation, "none", `${scene.id}/${card.id}`);
    }
    for (const icon of scene.editorialScene.icons) {
      assert.ok(EDITORIAL_ICON_PRESENTATIONS.includes(icon.presentation), `${scene.id}/${icon.id}`);
      assert.equal(typeof icon.anchorId, "string", `${scene.id}/${icon.id}`);
      assert.equal(icon.ownerId, undefined, `${scene.id}/${icon.id}`);
    }
  }
  const standaloneIcons = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.flatMap((scene) =>
    scene.standaloneIcons.map((icon) => ({
      sceneId: scene.id,
      id: icon.id,
      anchorId: icon.anchorId,
      conceptKind: icon.conceptKind,
      presentation: icon.presentation,
      layoutRole: icon.layoutRole,
      attachmentMode: icon.attachmentMode,
      autoInsert: icon.autoInsert,
      delayed: icon.delayUntilFinalHold
    }))
  );
  assert.deepEqual(standaloneIcons, [
    {
      sceneId: "S08",
      id: "context-window-symbol",
      anchorId: "context-budget",
      conceptKind: "context-window",
      presentation: "open-diagram-symbol",
      layoutRole: "open-diagram-object",
      attachmentMode: "independent",
      autoInsert: false,
      delayed: false
    },
    {
      sceneId: "S10",
      id: "tool-symbol",
      anchorId: "tool",
      conceptKind: "tool",
      presentation: "open-diagram-symbol",
      layoutRole: "open-diagram-object",
      attachmentMode: "independent",
      autoInsert: false,
      delayed: false
    },
    {
      sceneId: "S10",
      id: "mcp-symbol",
      anchorId: "mcp",
      conceptKind: "mcp",
      presentation: "open-diagram-symbol",
      layoutRole: "open-diagram-object",
      attachmentMode: "independent",
      autoInsert: false,
      delayed: false
    },
    {
      sceneId: "S17",
      id: "human-gate-symbol",
      anchorId: "human",
      conceptKind: "human-approval",
      presentation: "open-diagram-symbol",
      layoutRole: "open-diagram-object",
      attachmentMode: "independent",
      autoInsert: false,
      delayed: false
    },
  ]);
  assert.equal(
    AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.every((scene) => scene.layoutStability === "stable-final"),
    true
  );

  const [component, visualComponents] = await Promise.all([
    readFile(COMPONENT_PATH, "utf8"),
    readFile(VISUAL_COMPONENTS_PATH, "utf8")
  ]);
  assert.match(component, /conceptKind="none"/u);
  assert.match(component, /<VisualSystemV1StandaloneIcon/u);
  assert.match(visualComponents, /VisualSystemV1AiTechIcon/u);
  assert.match(visualComponents, /data-ai-tech-icon-container="standalone"/u);
  assert.match(visualComponents, /不能嵌入图标/u);
  assert.match(visualComponents, /statusMarkVariant=\{statusMarkVariant\}/u);
  assert.doesNotMatch(visualComponents, /VisualSystemV1OpenDiagramGlyph/u);
});

test("完整长片用内容驱动宽度、纯文字卡片和开放图解打破连续卡片模板", async () => {
  assert.equal(AGENT_SKILL_LONG_REVIEW_EDITORIAL_REVIEW.valid, true);
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    assert.equal(scene.editorialReview.valid, true, scene.id);
    assert.ok(["card-led", "open-diagram", "mixed-diagram"].includes(scene.visualMode));
    for (const card of scene.editorialScene.cards) {
      assert.equal(card.surfaceRole, "information-card", `${scene.id}/${card.id}`);
      assert.ok(EDITORIAL_CARD_SURFACE_PURPOSES.includes(card.surfacePurpose));
      assert.equal(card.titleLayout.lineCount, 1, `${scene.id}/${card.id}`);
      assert.equal(card.titleLayout.whiteSpace, "nowrap", `${scene.id}/${card.id}`);
      assert.ok(
        card.titleLayout.finalAvailableTextWidthPx >= card.titleLayout.measuredTextWidthPx,
        `${scene.id}/${card.id}`
      );
      assert.equal(card.conceptKind, "none", `${scene.id}/${card.id}`);
      assert.equal(card.iconPresentation, "none", `${scene.id}/${card.id}`);
      assert.deepEqual(card.border, { mode: "full-outline", widthPx: 3 });
    }
    for (const diagram of scene.editorialScene.diagrams) {
      assert.equal(diagram.surfaceRole, "open-canvas", `${scene.id}/${diagram.id}`);
      assert.ok(EDITORIAL_OPEN_SURFACE_PURPOSES.includes(diagram.surfacePurpose));
    }
    const cohortSurfaceRoles = new Map();
    for (const item of [...scene.editorialScene.cards, ...scene.editorialScene.diagrams]) {
      const key = editorialSurfaceCohortKey(item);
      const roles = cohortSurfaceRoles.get(key) ?? new Set();
      roles.add(item.surfaceRole);
      cohortSurfaceRoles.set(key, roles);
    }
    assert.equal(
      [...cohortSurfaceRoles.values()].every((roles) => roles.size === 1),
      true,
      `${scene.id} mixes surfaces inside a semantic hierarchy cohort`
    );
    assert.ok(scene.editorialScene.icons.length <= 2, scene.id);
    for (const icon of scene.editorialScene.icons) {
      assert.ok(EDITORIAL_ICON_PRESENTATIONS.includes(icon.presentation), `${scene.id}/${icon.id}`);
      assert.equal(typeof icon.anchorId, "string", `${scene.id}/${icon.id}`);
      assert.equal(icon.ownerId, undefined, `${scene.id}/${icon.id}`);
    }
  }

  const s11 = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((scene) => scene.id === "S11");
  assert.equal(s11.visualMode, "mixed-diagram");
  assert.deepEqual(s11.groups.map(({ id, label }) => ({ id, label })), [
    { id: "method", label: "方法与判断" },
    { id: "execution", label: "动作、连接与结果" }
  ]);
  assert.equal(new Set(s11.layoutSamples[0].elements.map((element) => element.bounds.y)).size, 2);
  assert.deepEqual(
    Object.fromEntries(s11.layoutSamples[0].elements.map((element) => [element.id, element.surfaceRole])),
    {
      user: "open-canvas",
      skill: "open-canvas",
      agent: "open-canvas",
      tool: "information-card",
      mcp: "information-card",
      external: "open-canvas",
      result: "information-card"
    }
  );

  const [component, visualComponents] = await Promise.all([
    readFile(COMPONENT_PATH, "utf8"),
    readFile(VISUAL_COMPONENTS_PATH, "utf8")
  ]);
  assert.match(component, /AdaptiveSemanticGroups/u);
  assert.match(component, /data-editorial-visual-mode/u);
  assert.doesNotMatch(visualComponents, /VisualSystemV1OpenDiagramGlyph/u);
  assert.match(visualComponents, /data-visual-system-surface-role/u);
  assert.match(visualComponents, /data-editorial-surface-purpose/u);
  assert.match(visualComponents, /data-visual-hierarchy-level/u);

  const s17 = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((scene) => scene.id === "S17");
  assert.deepEqual(
    Object.fromEntries(Object.entries(s17.surfacePlanById).map(([id, item]) => [id, {
      semanticRole: item.semanticRole,
      surfaceRole: item.surfaceRole,
      surfacePurpose: item.surfacePurpose
    }])),
    {
      understand: { semanticRole: "process-step", surfaceRole: "open-canvas", surfacePurpose: "process-anchor" },
      trial: { semanticRole: "process-step", surfaceRole: "open-canvas", surfacePurpose: "process-anchor" },
      inspect: { semanticRole: "evidence", surfaceRole: "information-card", surfacePurpose: "focus-result" },
      revise: { semanticRole: "feedback-action", surfaceRole: "open-canvas", surfacePurpose: "transition-output" },
      machine: { semanticRole: "decision", surfaceRole: "information-card", surfacePurpose: "decision-boundary" },
      human: { semanticRole: "decision", surfaceRole: "information-card", surfacePurpose: "decision-boundary" }
    }
  );
  assert.deepEqual(s17.edges.map((edge) => edge.id), [
    "understand-trial",
    "trial-inspect",
    "inspect-machine",
    "machine-human",
    "human-revise"
  ]);
  assert.deepEqual(
    s17.stages.map(({ id, startFrame, nodeIds, edgeIds }) => ({ id, startFrame, nodeIds, edgeIds })),
    [
      { id: "understand", startFrame: 16200, nodeIds: ["understand"], edgeIds: [] },
      { id: "trial", startFrame: 16371, nodeIds: ["trial"], edgeIds: ["understand-trial"] },
      { id: "inspect", startFrame: 16542, nodeIds: ["inspect"], edgeIds: ["trial-inspect"] },
      { id: "machine", startFrame: 16721, nodeIds: ["machine"], edgeIds: ["inspect-machine"] },
      { id: "human", startFrame: 16885, nodeIds: ["human"], edgeIds: ["machine-human"] },
      { id: "revise", startFrame: 17049, nodeIds: ["revise"], edgeIds: ["human-revise"] }
    ]
  );
  const reviseRevealFrame = longReviewSemanticNodeRevealFrame("S17", "revise");
  const feedbackEdgeRevealFrame = longReviewSemanticEdgeRevealFrame("S17", "human-revise");
  assert.equal(reviseRevealFrame, 17067);
  assert.equal(feedbackEdgeRevealFrame, 17070);
  for (let frame = 16860; frame < reviseRevealFrame; frame += 1) {
    assert.equal(
      longReviewDiagramStateAtFrame("S17", frame).nodeProgress.revise,
      0,
      `反馈字段不得在最后阶段前出现：global ${frame}`
    );
  }
  assert.ok(longReviewDiagramStateAtFrame("S17", reviseRevealFrame).nodeProgress.revise > 0);
  assert.equal(longReviewDiagramStateAtFrame("S17", feedbackEdgeRevealFrame - 1).edgeProgress["human-revise"], 0);
  assert.ok(longReviewDiagramStateAtFrame("S17", feedbackEdgeRevealFrame).edgeProgress["human-revise"] > 0);
  assert.equal(longReviewDiagramStateAtFrame("S17", 17087).edgeArrowProgress["human-revise"], 1);
  assert.equal(longReviewDiagramStateAtFrame("S17", 17087).finalHold, false);
  assert.equal(s17.holdStartFrame, 17088);
  assert.equal(longReviewDiagramStateAtFrame("S17", 17088).finalHold, true);
  assert.equal(longReviewDiagramStateAtFrame("S17", 17048).stageId, "human");
  assert.equal(longReviewDiagramStateAtFrame("S17", 17049).stageId, "revise");
  assert.equal(s17.edges.every((edge) => edge.connectorPresentation == null), true);
  const stableS17Layout = longReviewLayoutAtFrame("S17", 17087);
  const inspectMachineConnector = stableS17Layout.connectors.find(
    (connector) => connector.relationId === "inspect-machine"
  );
  assertOrthogonalConnector(inspectMachineConnector, "S17/inspect-machine");
  assert.equal(inspectMachineConnector.arrowhead, true);
  assert.equal(s17.edges.some((edge) => edge.id === "inspect-revise"), false);
  assert.equal(s17.editorialScene.cards.every((card) => card.iconPresentation === "none"), true);
  assert.match(component, /longReviewLayoutAtFrame\(spec\.id, globalFrame/u);
  assert.match(component, /data-layout-stability/u);
  assert.match(component, /state\.edgeProgress\[connector\.relationId\]/u);
  assert.doesNotMatch(component, /connector\.presentationKind === "smooth-curve"/u);
  assert.match(component, /data-connector-presentation/u);
  assert.match(component, /<polyline/u);
});

test("阶段可见集合只保留当前要表达的对象，关系端点与实际连接线始终一致", () => {
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    for (const [stageIndex, stage] of scene.stages.entries()) {
      const expectedNodeIds = longReviewVisibleNodeIdsAtStage(scene.id, stageIndex);
      const expectedEdgeIds = longReviewVisibleEdgeIdsAtStage(scene.id, stageIndex);
      const previousNodeIds = stageIndex > 0
        ? longReviewVisibleNodeIdsAtStage(scene.id, stageIndex - 1)
        : [];
      const previousEdgeIds = stageIndex > 0
        ? longReviewVisibleEdgeIdsAtStage(scene.id, stageIndex - 1)
        : [];
      assert.ok(
        expectedNodeIds.length <= AGENT_SKILL_LONG_REVIEW_STAGE_DENSITY_POLICY.maximumVisibleNodes,
        `${scene.id}/${stage.id} visible node density`
      );
      assert.ok(
        expectedEdgeIds.length <= AGENT_SKILL_LONG_REVIEW_STAGE_DENSITY_POLICY.maximumVisibleEdges,
        `${scene.id}/${stage.id} visible edge density`
      );
      assert.ok(
        new Set([...previousNodeIds, ...expectedNodeIds]).size <=
          AGENT_SKILL_LONG_REVIEW_STAGE_DENSITY_POLICY.maximumTransitionNodes,
        `${scene.id}/${stage.id} transition node density`
      );
      assert.ok(
        new Set([...previousEdgeIds, ...expectedEdgeIds]).size <=
          AGENT_SKILL_LONG_REVIEW_STAGE_DENSITY_POLICY.maximumTransitionEdges,
        `${scene.id}/${stage.id} transition edge density`
      );
      const frame = Math.min(
        scene.endFrame - 1,
        stage.startFrame + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES
      );
      const layout = longReviewLayoutAtFrame(scene.id, frame);
      assert.deepEqual(layout.state.currentVisibleNodeIds, expectedNodeIds, `${scene.id}/${stage.id} nodes`);
      assert.deepEqual(layout.state.currentVisibleEdgeIds, expectedEdgeIds, `${scene.id}/${stage.id} edges`);
      assertRelationEndpointsVisible(scene, expectedNodeIds, expectedEdgeIds, `${scene.id}/${stage.id}`);
      assertRelationEndpointsVisible(
        scene,
        layout.state.renderedNodeIds,
        layout.state.renderedEdgeIds,
        `${scene.id}/${stage.id}/rendered`
      );
      assert.deepEqual(
        new Set(layout.connectors.map((connector) => connector.relationId)),
        new Set(layout.state.renderedEdgeIds),
        `${scene.id}/${stage.id} connector set`
      );
      for (const edgeId of expectedEdgeIds) {
        assert.equal(layout.state.edgeVisibilityProgress[edgeId], 1, `${scene.id}/${stage.id}/${edgeId}`);
      }
      for (const edgeId of layout.state.renderedEdgeIds.filter((edgeId) => !expectedEdgeIds.includes(edgeId))) {
        assert.equal(layout.state.edgeVisibilityProgress[edgeId], 0, `${scene.id}/${stage.id}/${edgeId} stale edge`);
      }
    }
  }
});

test("已报告的关键问题帧保持语义清楚、卡片有完整边框且没有斜线", () => {
  const at1350 = longReviewLayoutAtFrame("S02", 1350);
  assert.deepEqual(at1350.state.currentVisibleNodeIds, ["task", "base"]);
  assert.deepEqual(at1350.state.currentVisibleEdgeIds, ["task-base"]);
  assert.equal(at1350.state.currentVisibleNodeIds.includes("drift"), false);

  const at3900 = longReviewLayoutAtFrame("S04", 3900);
  assert.deepEqual(at3900.state.currentVisibleNodeIds, ["discoverable", "description"]);
  assert.deepEqual(at3900.state.currentVisibleEdgeIds, ["description-discover"]);
  assert.equal(
    sceneById("S04").edges.find((edge) => edge.id === "description-discover").directed,
    true
  );

  const s05 = sceneById("S05");
  const at4890 = longReviewLayoutAtFrame("S05", 4890);
  assert.deepEqual(at4890.state.currentVisibleNodeIds, [
    "root",
    "skill-md",
    "scripts",
    "references",
    "assets",
    "prompt-only"
  ]);
  assert.equal(
    at4890.state.currentVisibleNodeIds.every(
      (nodeId) => s05.surfacePlanById[nodeId].surfaceRole === "open-canvas"
    ),
    true
  );
  assert.equal(s05.edges.every((edge) => edge.directed === false), true);

  const s06 = sceneById("S06");
  for (let frame = 5190; frame <= 5370; frame += 15) {
    const layout = longReviewLayoutAtFrame("S06", frame);
    const incidentNodes = assertRelationEndpointsVisible(
      s06,
      layout.state.currentVisibleNodeIds,
      layout.state.currentVisibleEdgeIds,
      `S06/${frame}`
    );
    assert.equal(
      layout.state.currentVisibleNodeIds.every((nodeId) => incidentNodes.has(nodeId)),
      true,
      `S06/${frame} contains an unexplained isolated object`
    );
  }

  const at9990 = longReviewLayoutAtFrame("S10", 9990);
  assert.deepEqual(at9990.state.currentVisibleNodeIds, ["combine", "weekly"]);
  assert.deepEqual(at9990.state.currentVisibleEdgeIds, ["combine-weekly"]);

  const s14 = sceneById("S14");
  const at13920 = longReviewLayoutAtFrame("S14", 13920);
  assert.deepEqual(at13920.state.currentVisibleNodeIds, [
    "publisher",
    "installer",
    "operator",
    "reviewer",
    "scanner"
  ]);
  const s14SampleById = new Map(s14.layoutSamples[0].elements.map((element) => [element.id, element]));
  for (const nodeId of at13920.state.currentVisibleNodeIds) {
    assert.equal(s14.surfacePlanById[nodeId].surfaceRole, "information-card", `S14/${nodeId}`);
    assert.equal(s14SampleById.get(nodeId).borderMode, "full-outline", `S14/${nodeId} border`);
    assert.ok(s14SampleById.get(nodeId).borderWidthPx >= 2, `S14/${nodeId} border width`);
    assert.equal(s14SampleById.get(nodeId).iconPlacement, "none", `S14/${nodeId} embedded icon`);
  }

  for (const [frame, sceneId] of [[3900, "S04"], [4890, "S05"], [9990, "S10"], [13920, "S14"]]) {
    for (const connector of longReviewLayoutAtFrame(sceneId, frame).connectors) {
      assertOrthogonalConnector(connector, `${sceneId}/${frame}/${connector.relationId}`);
    }
  }
});

test("S18 最终保持帧不再挂载对号附属徽章，正式长片禁用 verified-success 与 celebrate", () => {
  const scene = sceneById("S18");
  const layout = longReviewLayoutAtFrame("S18", 17999);
  assert.equal(layout.state.finalHold, true);
  assert.deepEqual(AGENT_SKILL_LONG_REVIEW_ICON_LAYOUT_POLICY, {
    openDiagramSymbolsSupported: true,
    dedicatedIconFocusSupported: false,
    verifiedSuccessMode: "omitted"
  });
  assert.equal(
    scene.standaloneIcons.some((icon) =>
      icon.id === "adopt-success" ||
      icon.conceptKind === "verified-success" ||
      icon.statusMarkVariant === "celebrate"
    ),
    false
  );
  assert.equal(
    AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.some((candidate) =>
      candidate.standaloneIcons.some((icon) =>
        icon.conceptKind === "verified-success" || icon.statusMarkVariant === "celebrate"
      )
    ),
    false
  );
  for (const relation of scene.edges.filter((edge) => edge.directed)) {
    const connector = layout.allConnectors.find((item) => item.relationId === relation.id);
    assertOrthogonalConnector(connector, `S18/${relation.id}`);
    assert.equal(connector.arrowhead, true, `S18/${relation.id} arrowhead`);
    assert.equal(layout.state.edgeArrowProgress[relation.id], 1, `S18/${relation.id} arrow reveal`);
  }
});

test("场景标题、说明、阶段文字和语义节点正文都接入独立文字透明度", async () => {
  const [component, visualComponents] = await Promise.all([
    readFile(COMPONENT_PATH, "utf8"),
    readFile(VISUAL_COMPONENTS_PATH, "utf8")
  ]);
  assert.equal((component.match(/opacity: layer\.copyOpacity/gu) ?? []).length, 2);
  assert.match(component, /contentOpacity=\{copyOpacity\}/u);
  assert.match(
    component,
    /<StageCaption caption=\{stageCaption\} copyOpacity=\{copyOpacity \* detailOpacity\} \/>/u
  );
  assert.match(visualComponents, /contentOpacity = 1/u);
  assert.ok((visualComponents.match(/opacity: normalizedContentOpacity/gu) ?? []).length >= 3);
});

test("节点焦点连续交接，八个证据镜头使用稳定最终布局的语义节点图", async () => {
  const scene = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((item) => item.id === "S11");
  const methodStage = scene.stages.find((item) => item.id === "method");
  const userProgress = [];
  const skillProgress = [];
  for (let frame = methodStage.startFrame; frame < methodStage.startFrame + 18; frame += 1) {
    const state = longReviewDiagramStateAtFrame("S11", frame);
    userProgress.push(state.nodeHighlightProgress.user);
    skillProgress.push(state.nodeHighlightProgress.skill);
    assert.ok(Math.abs(state.nodeHighlightProgress.user + state.nodeHighlightProgress.skill - 1) < 1e-12);
  }
  assertMonotonic(skillProgress, "S11 incoming focus");
  assertMonotonic([...userProgress].reverse(), "S11 outgoing focus");

  const nativeEvidenceIds = ["S02", "S04", "S06", "S08", "S10", "S12", "S14", "S16"];
  const nativeEvidenceScenes = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.filter(
    (item) => item.kind === "native-evidence"
  );
  assert.deepEqual(nativeEvidenceScenes.map((item) => item.id), nativeEvidenceIds);
  for (const spec of nativeEvidenceScenes) {
    assert.match(spec.material, /^episodes\/agent-skill-20260806\/materials\/material-v\d{3}\.png$/u);
    assert.equal(spec.visualIntent.role, "evidence");
    assert.deepEqual(spec.visualIntent.evidenceRefs, [spec.material]);
    assert.ok(spec.nodes.length >= 6, `${spec.id} must contain a native node system`);
    assert.ok(spec.edges.length >= 4, `${spec.id} must contain native relationships`);
    const nodeIds = new Set(spec.nodes.map((item) => item.id));
    const edgeIds = new Set(spec.edges.map((item) => item.id));
    assert.equal(nodeIds.size, spec.nodes.length, `${spec.id} node ids must be unique`);
    assert.equal(edgeIds.size, spec.edges.length, `${spec.id} edge ids must be unique`);
    for (const item of spec.edges) {
      assert.ok(nodeIds.has(item.from), `${spec.id}.${item.id} missing from node`);
      assert.ok(nodeIds.has(item.to), `${spec.id}.${item.id} missing to node`);
    }
    const revealedNodeIds = new Set();
    for (const item of spec.stages) {
      for (const id of item.nodeIds) {
        assert.ok(nodeIds.has(id), `${spec.id}.${item.id} unknown node ${id}`);
        revealedNodeIds.add(id);
      }
      for (const id of item.edgeIds) {
        assert.ok(edgeIds.has(id), `${spec.id}.${item.id} unknown edge ${id}`);
        const relation = spec.edges.find((edge) => edge.id === id);
        assert.ok(revealedNodeIds.has(relation.from), `${spec.id}.${id} starts before ${relation.from}`);
        assert.ok(revealedNodeIds.has(relation.to), `${spec.id}.${id} starts before ${relation.to}`);
      }
    }
  }

  const component = await readFile(COMPONENT_PATH, "utf8");
  assert.match(component, /VisualSystemV1SemanticNode/u);
  assert.match(component, /data-scene-layout="stable-final-visual-grammar"/u);
  assert.match(component, /data-visual-system-connectors="orthogonal-semantic-graph"/u);
  assert.match(component, /data-visual-system-content="open-canvas"/u);
  assert.match(component, /data-same-level-surfaces="semantic-hierarchy-consistent"/u);
  assert.doesNotMatch(component, /spec\.kind === "native-evidence"/u);
  assert.doesNotMatch(component, /function EvidenceSourceChip|data-evidence-source/u);
  assert.doesNotMatch(component, /function EvidencePanel|<Img\b|staticFile\(spec\.material\)|objectFit:\s*"cover"/u);
  assert.doesNotMatch(component, /currentStageProgress|continuousStage|translateY\(\$\{translateY/u);
});

test("审阅版总进度连续，底部按章节时长分段并用 scale 驱动", async () => {
  assert.equal(longReviewProgressAtFrame(-1), 0);
  assert.equal(longReviewProgressAtFrame(0), 0);
  assert.equal(longReviewProgressAtFrame(9_000), 0.5);
  assert.equal(longReviewProgressAtFrame(18_000), 1);
  assert.equal(longReviewProgressAtFrame(18_001), 1);

  const [component, visualComponents] = await Promise.all([
    readFile(COMPONENT_PATH, "utf8"),
    readFile(VISUAL_COMPONENTS_PATH, "utf8")
  ]);
  assert.match(component, /VisualSystemV1ChapterProgress/u);
  assert.match(visualComponents, /gridTemplateColumns:\s*columns/u);
  assert.match(visualComponents, /scale:\s*`\$\{segment\.progress\} 1`/u);
  assert.match(visualComponents, /transformOrigin:\s*"left center"/u);
  assert.doesNotMatch(visualComponents, /width:\s*(?:progress|progressPixels)/u);
});

test("审阅动画由逐帧状态与 Remotion spring 驱动，不使用 CSS 动画或 TransitionSeries", async () => {
  const [plan, component, visualMotion] = await Promise.all([
    readFile(PLAN_PATH, "utf8"),
    readFile(COMPONENT_PATH, "utf8"),
    readFile(VISUAL_MOTION_PATH, "utf8")
  ]);
  const source = `${plan}\n${component}\n${visualMotion}`;
  assert.match(component, /useCurrentFrame\(\)/u);
  assert.match(component, /longReviewSceneLayersAtFrame\(frame\)/u);
  assert.match(component, /VisualSystemV1SemanticNode/u);
  assert.match(visualMotion, /\bspring\s*\(/u);
  assert.doesNotMatch(component, /panProgress|continuousStage|currentStageProgress/u);
  assert.doesNotMatch(source, /\bTransitionSeries\b/u);
  assert.doesNotMatch(source, /transition:\s*["'`]/u);
  assert.doesNotMatch(source, /\banimation(?:Name)?\s*:/u);
  assert.doesNotMatch(source, /@keyframes|gsap|HyperFrames|hyperframes/u);
});

test("长片升级保持独立 review-only 入口，不接管正式 Composition 或 Episode 预览", async () => {
  const [index, reviewRoot, renderer, productionRoot, productionPreview] = await Promise.all([
    readFile(INDEX_PATH, "utf8"),
    readFile(ROOT_PATH, "utf8"),
    readFile(RENDER_PATH, "utf8"),
    readFile(PRODUCTION_ROOT_PATH, "utf8"),
    readFile(PRODUCTION_PREVIEW_PATH, "utf8")
  ]);
  assert.match(index, /registerRoot\(AgentSkillLongReviewRoot\)/u);
  assert.match(reviewRoot, /id="AgentSkillLongReview"/u);
  assert.match(reviewRoot, /durationInFrames=\{AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS \* AGENT_SKILL_LONG_REVIEW_FPS\}/u);
  assert.doesNotMatch(productionRoot, /AgentSkillLongReview|agent-skill-long-review/u);
  assert.doesNotMatch(productionPreview, /AgentSkillLongReview|agent-skill-long-review/u);
  assert.doesNotMatch(`${index}\n${reviewRoot}`, /writeEpisode|saveEpisode|updateEpisode|episode\.json/u);
  assert.match(renderer, /kind:\s*"unregistered-review-candidate"/u);
  assert.match(renderer, /registered:\s*false/u);
  assert.match(renderer, /candidateDirectoryName:\s*"full-video-current-visual-upgrade-v003"/u);
  assert.match(renderer, /candidateVersion:\s*3/u);
  assert.match(renderer, /assertV3ReviewInputsChanged\(reviewInputsBefore\)/u);
  assert.match(renderer, /unregistered-review-v001-video/u);
  assert.match(renderer, /unregistered-review-v001-manifest/u);
  assert.match(renderer, /unregistered-review-v001-qa-summary/u);
  assert.match(renderer, /unregistered-review-v002-video/u);
  assert.match(renderer, /unregistered-review-v002-manifest/u);
  assert.match(renderer, /unregistered-review-v002-qa-summary/u);
  assert.match(renderer, /FORMAL_OUTPUTS_THAT_MUST_STAY_ABSENT/u);
  assert.match(renderer, /preview-v006\.mp4/u);
  assert.doesNotMatch(renderer, /writeEpisode|saveEpisode|updateEpisode/u);
});
