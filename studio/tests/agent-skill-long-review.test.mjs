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
  EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS,
  EDITORIAL_NARRATIVE_TREATMENTS,
  EDITORIAL_OPEN_SURFACE_PURPOSES,
  EDITORIAL_SHAPE_GRAMMAR_VERSION,
  EDITORIAL_VISUAL_POLICY,
  editorialSurfaceCohortKey,
  validateEditorialScene
} from "../src/shared/editorial-visual-policy.mjs";
import {
  TECHNICAL_ARTIFACT_PROFILE_POLICY,
  technicalArtifactLayout
} from "../src/shared/technical-artifact-profile.mjs";
import {
  AGENT_SKILL_LONG_REVIEW_CHAPTERS,
  AGENT_SKILL_LONG_REVIEW_CONNECTED_ENTRY_MODE,
  AGENT_SKILL_LONG_REVIEW_CONNECTOR_TONES,
  AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES,
  AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS,
  AGENT_SKILL_LONG_REVIEW_EDGE_DELAY_FRAMES,
  AGENT_SKILL_LONG_REVIEW_EDGE_DRAW_FRAMES,
  AGENT_SKILL_LONG_REVIEW_EDITORIAL_REVIEW,
  AGENT_SKILL_LONG_REVIEW_FLOW_LAYOUT_PROFILES,
  AGENT_SKILL_LONG_REVIEW_FPS,
  AGENT_SKILL_LONG_REVIEW_FRAME_COUNT,
  AGENT_SKILL_LONG_REVIEW_ICON_LAYOUT_POLICY,
  AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES,
  AGENT_SKILL_LONG_REVIEW_ORPHAN_SUBTITLE_RULES,
  AGENT_SKILL_LONG_REVIEW_REVEAL_SCHEDULE_REVIEW,
  AGENT_SKILL_LONG_REVIEW_SCENE_START_FRAMES,
  AGENT_SKILL_LONG_REVIEW_SCENE_SPECS,
  AGENT_SKILL_LONG_REVIEW_SHAPE_GRAMMAR_CUE,
  AGENT_SKILL_LONG_REVIEW_STAGE_CAPTION_PHASE_FRAMES,
  AGENT_SKILL_LONG_REVIEW_STAGE_DENSITY_POLICY,
  AGENT_SKILL_LONG_REVIEW_TITLE_PREROLL_FRAMES,
  longReviewDiagramStateAtFrame,
  longReviewDisplaySubtitles,
  longReviewLayoutAtFrame,
  longReviewProgressAtFrame,
  longReviewSceneAtFrame,
  longReviewSceneLayersAtFrame,
  longReviewSemanticGroupProgress,
  longReviewSemanticEdgeRevealFrame,
  longReviewSemanticNodeRevealFrame,
  longReviewSemanticNodeVisibleFrame,
  longReviewStageCaptionLayout,
  longReviewStageCaptionStateAtFrame,
  longReviewSubtitleGateAtFrame,
  longReviewVisibleEdgeIdsAtStage,
  longReviewVisibleNodeIdsAtStage,
  longReviewVisualSceneCopy,
  validateAgentSkillLongReviewEpisode
} from "../src/video/agent-skill-long-review-plan.mjs";
import {
  longReviewBoundaryContrastRoute,
  longReviewResolvedSemanticGroupBounds,
  longReviewSemanticRelationType
} from "../src/video/agent-skill-long-review-contrast.mjs";
import {
  visualSystemV1ChapterRevealAtFrame,
  visualSystemV1TextMotionAtFrame
} from "../src/video/components/visual-system-v1/motion.mjs";
import { agentSkillLongReviewEpisodeFixture } from
  "./agent-skill-long-review.fixture.mjs";

const PLAN_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review-plan.mjs");
const COMPONENT_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review.jsx");
const CONTRAST_GEOMETRY_PATH = resolve(
  studioRoot,
  "src",
  "video",
  "agent-skill-long-review-contrast.mjs"
);
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

function rectanglesOverlap(left, right) {
  const leftRight = left.right ?? left.x + left.width;
  const leftBottom = left.bottom ?? left.y + left.height;
  const rightRight = right.right ?? right.x + right.width;
  const rightBottom = right.bottom ?? right.y + right.height;
  return left.x < rightRight && leftRight > right.x && left.y < rightBottom && leftBottom > right.y;
}

function orthogonalSegmentIntersectsRect(start, end, rectangle) {
  const right = rectangle.right ?? rectangle.x + rectangle.width;
  const bottom = rectangle.bottom ?? rectangle.y + rectangle.height;
  if (start.x === end.x) {
    const minimumY = Math.min(start.y, end.y);
    const maximumY = Math.max(start.y, end.y);
    return start.x >= rectangle.x && start.x <= right && maximumY >= rectangle.y && minimumY <= bottom;
  }
  if (start.y === end.y) {
    const minimumX = Math.min(start.x, end.x);
    const maximumX = Math.max(start.x, end.x);
    return start.y >= rectangle.y && start.y <= bottom && maximumX >= rectangle.x && minimumX <= right;
  }
  return true;
}

function pointOnGeometryBoundary(point, geometry, tolerance = 0.001) {
  const onVertical = Math.abs(point.x - geometry.left) <= tolerance ||
    Math.abs(point.x - geometry.right) <= tolerance;
  const onHorizontal = Math.abs(point.y - geometry.top) <= tolerance ||
    Math.abs(point.y - geometry.bottom) <= tolerance;
  const insideX = point.x >= geometry.left - tolerance && point.x <= geometry.right + tolerance;
  const insideY = point.y >= geometry.top - tolerance && point.y <= geometry.bottom + tolerance;
  return insideX && insideY && (onVertical || onHorizontal);
}

test("十分钟审阅版固定为 600 秒、30fps、18000 帧，并兼容 18 场景与 107 字幕合同", async () => {
  assert.equal(AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS, 600);
  assert.equal(AGENT_SKILL_LONG_REVIEW_FPS, 30);
  assert.equal(AGENT_SKILL_LONG_REVIEW_FRAME_COUNT, 18_000);
  assert.equal(
    AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS * AGENT_SKILL_LONG_REVIEW_FPS,
    AGENT_SKILL_LONG_REVIEW_FRAME_COUNT
  );

  const episode = agentSkillLongReviewEpisodeFixture();
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
  assert.deepEqual(
    new Set(nonDirectedRelations.map((item) => item.sceneId)),
    new Set(["S02", "S05", "S07", "S12"])
  );
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

test("长片用多种可复用图解叙事承载内容，并在 S04 一次性教清可见形状语法", async () => {
  const treatments = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.map((scene) => scene.narrativeTreatment);
  assert.ok(new Set(treatments).size >= 3);
  assert.equal(treatments.every((treatment) => EDITORIAL_NARRATIVE_TREATMENTS.includes(treatment)), true);
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    assert.equal(scene.shapeGrammarVersion, EDITORIAL_SHAPE_GRAMMAR_VERSION, scene.id);
    assert.equal(scene.editorialScene.shapeGrammarVersion, EDITORIAL_SHAPE_GRAMMAR_VERSION, scene.id);
    assert.equal(scene.editorialScene.narrativeTreatment, scene.narrativeTreatment, scene.id);
    assert.equal(
      scene.editorialScene.narrativeTreatmentRationale,
      scene.narrativeTreatmentRationale,
      scene.id
    );
    assert.equal(
      scene.editorialScene.treatmentEvidence.mechanism,
      EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS[scene.narrativeTreatment].mechanism,
      scene.id
    );
    const governedElementIds = new Set(
      [...scene.editorialScene.cards, ...scene.editorialScene.diagrams].map((item) => item.id)
    );
    const governedRelationById = new Map(
      scene.editorialScene.relations.map((item) => [item.id, item])
    );
    assert.equal(
      scene.editorialScene.treatmentEvidence.visibleElementIds.every((id) => governedElementIds.has(id)),
      true,
      scene.id
    );
    assert.equal(
      scene.editorialScene.treatmentEvidence.relationIds.every((id) => {
        const relation = governedRelationById.get(id);
        return relation != null &&
          EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS[scene.narrativeTreatment]
            .requiredRelationTypes.includes(relation.semanticType);
      }),
      true,
      scene.id
    );
    assert.equal(
      scene.editorialScene.relations.every((relation) => typeof relation.semanticType === "string"),
      true,
      scene.id
    );
    assert.ok(scene.narrativeTreatmentRationale.length >= 18, scene.id);
    for (const [nodeId, surface] of Object.entries(scene.surfacePlanById)) {
      assert.ok(
        ["complete-object", "process-anchor", "semantic-boundary"].includes(
          surface.shapeGrammarRole
        ),
        `${scene.id}/${nodeId}`
      );
      if (surface.surfaceRole === "information-card") {
        assert.equal(surface.shapeGrammarRole, "complete-object", `${scene.id}/${nodeId}`);
        assert.equal(surface.shapeGrammarVisualForm, "full-outline", `${scene.id}/${nodeId}`);
      }
    }
    for (const alternateTreatment of EDITORIAL_NARRATIVE_TREATMENTS) {
      if (alternateTreatment === scene.narrativeTreatment) continue;
      const relabeled = validateEditorialScene({
        ...scene.editorialScene,
        narrativeTreatment: alternateTreatment,
        treatmentEvidence: {
          ...scene.editorialScene.treatmentEvidence,
          mechanism: EDITORIAL_NARRATIVE_TREATMENT_MECHANISMS[alternateTreatment].mechanism
        }
      });
      assert.equal(relabeled.valid, false, `${scene.id} cannot masquerade as ${alternateTreatment}`);
    }
  }
  for (let index = 1, runLength = 1; index < treatments.length; index += 1) {
    runLength = treatments[index] === treatments[index - 1] ? runLength + 1 : 1;
    assert.ok(
      runLength <= EDITORIAL_VISUAL_POLICY.maximumConsecutiveSameNarrativeTreatment,
      `narrative run at ${index}`
    );
  }

  const packageScene = sceneById("S05");
  assert.equal(packageScene.narrativeTreatment, "package-anatomy");
  assert.deepEqual(packageScene.groups.map((group) => group.id), ["skill-package-scope"]);
  assert.equal(packageScene.groups[0].visualForm, "full-outline");
  assert.deepEqual(
    packageScene.groups[0].nodeIds,
    ["root", "skill-md", "scripts", "references", "assets"]
  );
  assert.equal(packageScene.layoutStability, "explicit-reflow");
  assert.equal(packageScene.hierarchyLayoutProfile, "progressive-package");
  assert.equal(packageScene.groups[0].boundsMode, "visible-members");
  const rootSettled = longReviewLayoutAtFrame(
    "S05",
    longReviewSemanticNodeRevealFrame("S05", "root") + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES - 1
  );
  const skillSettled = longReviewLayoutAtFrame(
    "S05",
    longReviewSemanticNodeRevealFrame("S05", "skill-md") + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES - 1
  );
  assert.deepEqual(Object.keys(rootSettled.fullGeometryById), ["root"]);
  assert.deepEqual(Object.keys(skillSettled.fullGeometryById), ["root", "skill-md"]);
  assert.equal(rootSettled.geometryById.root.y, skillSettled.geometryById.root.y);
  assert.equal(skillSettled.geometryById.root.centerX, skillSettled.geometryById["skill-md"].centerX);
  assert.deepEqual(skillSettled.connectors.find((item) => item.relationId === "root-skill").route, [
    { x: skillSettled.connectorGeometryById.root.centerX, y: skillSettled.connectorGeometryById.root.bottom },
    { x: skillSettled.connectorGeometryById["skill-md"].centerX, y: skillSettled.connectorGeometryById["skill-md"].top }
  ]);
  const scriptsStart = packageScene.stages.find((item) => item.id === "scripts").startFrame;
  const beforeScripts = longReviewLayoutAtFrame("S05", scriptsStart - 1);
  const enteringScripts = longReviewLayoutAtFrame("S05", scriptsStart);
  const midScripts = longReviewLayoutAtFrame(
    "S05",
    scriptsStart + Math.floor(AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES / 2)
  );
  const scriptsSettled = longReviewLayoutAtFrame(
    "S05",
    scriptsStart + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES - 1
  );
  assert.ok(Math.abs(enteringScripts.geometryById["skill-md"].x - beforeScripts.geometryById["skill-md"].x) < 4);
  assert.ok(midScripts.geometryById["skill-md"].x < enteringScripts.geometryById["skill-md"].x);
  assert.ok(midScripts.geometryById["skill-md"].x > scriptsSettled.geometryById["skill-md"].x);
  const completePackage = longReviewLayoutAtFrame("S05", packageScene.holdStartFrame);
  const packageRight = Math.max(...packageScene.groups[0].nodeIds.map(
    (nodeId) => completePackage.geometryById[nodeId].right
  ));
  assert.ok(completePackage.geometryById["prompt-only"].left > packageRight);
  assert.equal(packageScene.surfacePlanById["prompt-only"].shapeGrammarRole, "semantic-boundary");
  assert.equal(packageScene.surfacePlanById["prompt-only"].shapeGrammarMeaning, "exclusion");
  assert.deepEqual(
    Object.fromEntries(packageScene.layoutSamples[0].elements.map((item) => [item.id, item.primitive])),
    {
      root: "process-anchor",
      "skill-md": "directory-entry",
      scripts: "directory-entry",
      references: "directory-entry",
      assets: "directory-entry",
      "prompt-only": "diagram-output"
    }
  );
  assert.equal(
    packageScene.edges.filter((edge) => edge.semanticType === "contains").length,
    4
  );

  const runtimeScene = sceneById("S10");
  assert.equal(runtimeScene.narrativeTreatment, "runtime-resource-flow");
  assert.deepEqual(
    runtimeScene.standaloneIcons.map((icon) => [icon.anchorId, icon.participation]),
    [["tool", "graph-node"], ["mcp", "graph-node"]]
  );
  assert.equal(runtimeScene.edges.some((edge) => edge.id === "mcp-external"), true);

  const governanceScene = sceneById("S15");
  assert.equal(governanceScene.narrativeTreatment, "governance-evidence-trail");
  assert.deepEqual(
    governanceScene.layoutSamples[0].elements.slice(-2).map((item) => [item.id, item.surfaceRole]),
    [["enable", "information-card"], ["rollback", "information-card"]]
  );
  assert.equal(governanceScene.edges.some((edge) => edge.id === "change-invalidate"), true);

  const cueScene = sceneById(AGENT_SKILL_LONG_REVIEW_SHAPE_GRAMMAR_CUE.sceneId);
  assert.equal(cueScene.shapeGrammarCue, AGENT_SKILL_LONG_REVIEW_SHAPE_GRAMMAR_CUE);
  assert.equal(AGENT_SKILL_LONG_REVIEW_SHAPE_GRAMMAR_CUE.persistent, false);
  assert.deepEqual(
    AGENT_SKILL_LONG_REVIEW_SHAPE_GRAMMAR_CUE.items.map((item) => item.visualForm),
    ["full-outline", "open-node", "dashed-outline"]
  );
  assert.equal(cueScene.surfacePlanById.weights.shapeGrammarRole, "semantic-boundary");
  assert.equal(
    AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.filter((scene) => scene.shapeGrammarCue != null).length,
    1
  );
  const [component, contrastGeometry] = await Promise.all([
    readFile(COMPONENT_PATH, "utf8"),
    readFile(CONTRAST_GEOMETRY_PATH, "utf8")
  ]);
  assert.match(component, /function ShapeGrammarLegend/u);
  assert.match(component, /const SHAPE_GRAMMAR_LEGEND_FONT_SIZE_PX = 24/u);
  assert.match(component, /const SHAPE_GRAMMAR_LEGEND_MIN_HEIGHT_PX = 48/u);
  assert.match(component, /data-shape-grammar-font-size=\{SHAPE_GRAMMAR_LEGEND_FONT_SIZE_PX\}/u);
  assert.doesNotMatch(component, /fontSize:\s*14/u);
  assert.match(component, /data-shape-grammar-boundary-wrapper/u);
  assert.match(component, /data-shape-grammar-form=\{surfacePlan\?\.shapeGrammarVisualForm\}/u);
  assert.match(component, /data-narrative-treatment=\{spec\.narrativeTreatment\}/u);
  assert.match(component, /data-semantic-group-role=\{isCompleteObjectBoundary/u);
  assert.match(contrastGeometry, /layout\.fullGeometryById \?\? layout\.geometryById/u);
  assert.match(component, /data-visual-system-group-border/u);
  assert.match(component, /surfaceBorder\.semanticGroup\.widthPx/u);
  assert.doesNotMatch(component, /borderTop: isCompleteBoundary/u);
});

test("图解构建期间只保留一个降权短提示，建立前和安静终帧恢复完整字幕", async () => {
  const episode = await readFixtureEpisode();
  const opening = sceneById("S10");
  const preBuild = longReviewSubtitleGateAtFrame(episode.subtitles, opening.startFrame);
  assert.equal(preBuild.phase, "pre-build");
  assert.equal(preBuild.presentationMode, "full-sentence");
  assert.equal(preBuild.activeSubtitle.text, preBuild.activeSubtitle.sourceText);
  assert.equal(preBuild.presentationOpacity, 1);

  const activeBuild = longReviewSubtitleGateAtFrame(
    episode.subtitles,
    opening.stages.find((stage) => stage.id === "tool").startFrame + 4
  );
  assert.equal(activeBuild.presentationMode, "semantic-cue");
  assert.notEqual(activeBuild.activeSubtitle.text, activeBuild.activeSubtitle.sourceText);
  assert.ok(Array.from(activeBuild.activeSubtitle.text).length <= 16);
  assert.equal(activeBuild.presentationOpacity, 0.72);

  const denseBuild = longReviewSubtitleGateAtFrame(episode.subtitles, 17763);
  assert.equal(denseBuild.phase, "dense-build");
  assert.equal(denseBuild.presentationMode, "semantic-cue");
  assert.equal(denseBuild.activeSubtitle.text, "四项条件汇聚");

  const finalHold = longReviewSubtitleGateAtFrame(
    episode.subtitles,
    sceneById("S18").holdStartFrame
  );
  assert.equal(finalHold.phase, "final-hold");
  assert.equal(finalHold.presentationMode, "semantic-cue");
  assert.equal(finalHold.activeSubtitle.text, "四项条件汇聚");
  assert.equal(finalHold.presentationOpacity, 0.72);

  const normalizeCue = (value) => value.normalize("NFKC").replace(/\s+/gu, "").trim();
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    for (const stage of scene.stages) {
      assert.ok(Array.from(stage.cueText).length <= 16, `${scene.id}/${stage.id}`);
      assert.doesNotMatch(
        stage.cueText,
        /等\d+项/u,
        `${scene.id}/${stage.id} 不能把多对象提示降级为占位数量`
      );
      const caption = longReviewStageCaptionStateAtFrame(scene.id, stage.startFrame + 20);
      assert.ok(Array.from(caption.current.label).length <= 16, `${scene.id}/${stage.id}`);
      assert.equal(caption.current.fullLabel, stage.label, `${scene.id}/${stage.id}`);
      assert.equal(caption.current.render, stage.cuePlan.render, `${scene.id}/${stage.id}`);
      assert.equal(caption.current.origin, stage.cuePlan.origin, `${scene.id}/${stage.id}`);
      if (stage.cuePlan.render === false) {
        assert.ok(
          ["authored", "auto-node"].includes(stage.cuePlan.origin),
          `${scene.id}/${stage.id}`
        );
        assert.equal(stage.cuePlan.suppressionReason, "duplicates-visible-node");
      } else {
        const sampleFrame = Math.min(scene.endFrame - 1, stage.startFrame + 20);
        const state = longReviewDiagramStateAtFrame(scene.id, sampleFrame);
        const visibleLabels = state.renderedNodeIds.map((nodeId) =>
          normalizeCue(scene.nodes.find((node) => node.id === nodeId)?.label ?? "")
        );
        assert.equal(
          visibleLabels.includes(normalizeCue(stage.cuePlan.text)),
          false,
          `${scene.id}/${stage.id} 的可见 cue 不能逐字重复当帧节点`
        );
      }
    }
    const finalState = longReviewDiagramStateAtFrame(scene.id, scene.holdStartFrame);
    const denseFinalHold = finalState.currentVisibleNodeIds.length >=
        EDITORIAL_VISUAL_POLICY.denseDiagramVisibleNodeThreshold ||
      finalState.currentVisibleEdgeIds.length >=
        EDITORIAL_VISUAL_POLICY.denseDiagramVisibleRelationThreshold;
    if (denseFinalHold) {
      const finalStage = scene.stages[finalState.stageIndex];
      const visibleNodeLabels = finalState.currentVisibleNodeIds.map(
        (nodeId) => scene.nodes.find((node) => node.id === nodeId)?.label
      );
      assert.equal(
        visibleNodeLabels.includes(finalStage.cueText),
        false,
        `${scene.id}/${finalStage.id} 的稳定短提示不能逐字重复可见节点标题`
      );
    }
  }

  const component = await readFile(COMPONENT_PATH, "utf8");
  assert.match(component, /subtitleCaptions\(episode, subtitleGate\.activeSubtitle\)/u);
  assert.match(component, /\["semantic-cue", "hidden"\]\.includes\(subtitlePresentationMode\)/u);
  assert.match(component, /\{suppressStageCaption \? null : \(/u);
  assert.match(component, /data-stage-caption-reading-anchor/u);
  assert.match(component, /data-subtitle-shape-legend-gate=/u);
  assert.match(component, /shapeGrammarLegendActive\s*\? 0/u);
  assert.match(component, /subtitleGate\.opacity \* subtitleGate\.presentationOpacity/u);
  assert.match(component, /subtitleGate\.renderSubtitle \? \(/u);

  const s05PreBuild = longReviewSubtitleGateAtFrame(episode.subtitles, 3960);
  assert.equal(s05PreBuild.presentationMode, "full-sentence");
  assert.equal(s05PreBuild.renderSubtitle, true);
  assert.equal(longReviewStageCaptionStateAtFrame("S05", 3960).current.render, false);

  const s05NodeOwnedCueFrames = sceneById("S05").stages
    .filter((stage) => ["skill-md", "scripts", "references", "assets"].includes(stage.id))
    .flatMap((stage) => [
      stage.startFrame,
      longReviewSemanticNodeRevealFrame("S05", stage.nodeIds[0])
    ]);
  for (const frame of [
    ...s05NodeOwnedCueFrames,
    9367,
    9440,
    9503
  ]) {
    const gate = longReviewSubtitleGateAtFrame(episode.subtitles, frame);
    assert.equal(gate.presentationMode, "hidden", `duplicate cue frame ${frame}`);
    assert.equal(gate.presentationOpacity, 0, `duplicate cue frame ${frame}`);
    assert.equal(gate.renderSubtitle, false, `duplicate cue frame ${frame}`);
    assert.equal(gate.suppressionReason, "duplicates-visible-node", `duplicate cue frame ${frame}`);
    assert.equal(gate.activeSubtitle.text, gate.activeSubtitle.sourceText, `source copy frame ${frame}`);
  }
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

  assert.equal(longReviewSemanticNodeRevealFrame("S01", "prompt-b"), 141);
  assert.equal(longReviewSemanticNodeRevealFrame("S01", "prompt-c"), 282);
  assert.equal(longReviewSemanticNodeRevealFrame("S01", "skill-unit"), 845);
  assert.equal(longReviewSemanticNodeVisibleFrame("S01", "skill-unit"), 845);
  assert.equal(longReviewDiagramStateAtFrame("S01", 140).nodeProgress["prompt-b"], 0);
  assert.ok(longReviewDiagramStateAtFrame("S01", 141).nodeProgress["prompt-b"] > 0);
  assert.equal(longReviewDiagramStateAtFrame("S01", 281).nodeProgress["prompt-c"], 0);
  assert.ok(longReviewDiagramStateAtFrame("S01", 282).nodeProgress["prompt-c"] > 0);
  assert.equal(longReviewDiagramStateAtFrame("S01", 844).nodeProgress["skill-unit"], 0);
  assert.ok(longReviewDiagramStateAtFrame("S01", 845).nodeProgress["skill-unit"] > 0);
  assert.ok(
    longReviewDiagramStateAtFrame("S01", 845).nodeProgress["skill-unit"] *
      longReviewDiagramStateAtFrame("S01", 845).nodeVisibilityProgress["skill-unit"] > 0
  );

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

test("后续阶段默认先建立端点，渐进目录按边界、结构线、文字的物理顺序进入", async () => {
  assert.deepEqual(AGENT_SKILL_LONG_REVIEW_REVEAL_SCHEDULE_REVIEW, {
    valid: true,
    mode: "endpoint-first",
    stageCount: AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.reduce(
      (total, scene) => total + scene.stages.length,
      0
    ),
    relationCount: AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.reduce(
      (total, scene) => total + scene.stages.reduce(
        (stageTotal, stage) => stageTotal + stage.edgeIds.length,
        0
      ),
      0
    )
  });
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
        const packageContainmentRelation = scene.narrativeTreatment === "package-anatomy"
          ? scene.edges.find((relation) =>
              stage.edgeIds.includes(relation.id) && relation.to === nodeId &&
              (relation.semanticType ?? relation.type) === "contains"
            )
          : null;
        const packageContrastRelation = scene.narrativeTreatment === "package-anatomy"
          ? scene.edges.find((relation) =>
              stage.edgeIds.includes(relation.id) && relation.to === nodeId &&
              (relation.semanticType ?? relation.type) === "contrasts-with"
            )
          : null;
        if (packageContainmentRelation == null && packageContrastRelation == null) {
          assert.equal(
            revealFrame,
            stage.startFrame,
            `${scene.id}/${nodeId} endpoint-first schedule`
          );
        } else if (packageContrastRelation != null) {
          assert.equal(
            revealFrame,
            stage.startFrame + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES,
            `${scene.id}/${nodeId} waits for package reflow before endpoint entry`
          );
        } else {
          assert.equal(
            revealFrame,
            longReviewSemanticEdgeRevealFrame(scene.id, packageContainmentRelation.id) +
              AGENT_SKILL_LONG_REVIEW_EDGE_DRAW_FRAMES,
            `${scene.id}/${nodeId} relation-first package schedule`
          );
        }
        const beforeReveal = longReviewDiagramStateAtFrame(scene.id, revealFrame - 1);
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
        assert.ok(
          atReveal.nodeProgress[relation.from] * atReveal.nodeVisibilityProgress[relation.from] > 0,
          `${scene.id}/${edgeId} source visible when relation starts`
        );
        const packageRelationFirst = scene.narrativeTreatment === "package-anatomy" &&
          (relation.semanticType ?? relation.type) === "contains";
        if (packageRelationFirst) {
          assert.equal(
            atReveal.nodeProgress[relation.to] * atReveal.nodeVisibilityProgress[relation.to],
            0,
            `${scene.id}/${edgeId} target hidden while package relation draws`
          );
        } else {
          assert.ok(
            atReveal.nodeProgress[relation.to] * atReveal.nodeVisibilityProgress[relation.to] > 0,
            `${scene.id}/${edgeId} target visible when relation starts`
          );
        }
        const arrowFrame = revealFrame + AGENT_SKILL_LONG_REVIEW_EDGE_DRAW_FRAMES;
        const atArrow = longReviewDiagramStateAtFrame(scene.id, arrowFrame);
        assert.ok(atArrow.edgeArrowProgress[edgeId] > 0, `${scene.id}/${edgeId} arrow arrival`);
        assert.ok(
          atArrow.nodeProgress[relation.to] * atArrow.nodeVisibilityProgress[relation.to] > 0,
          `${scene.id}/${edgeId} arrow never points to blank space`
        );
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
    assert.equal(
      scene.layoutStability,
      scene.narrativeTreatment === "package-anatomy" ? "explicit-reflow" : "stable-final",
      scene.id
    );
    assert.equal(
      scene.edges.some((edge) => edge.connectorPresentation?.kind === "smooth-curve"),
      false,
      `${scene.id} declares smooth connector`
    );
    const finalLayout = longReviewLayoutAtFrame(scene.id, scene.endFrame - 1, { width, height });
    const finalRouteByRelationId = new Map(
      finalLayout.allConnectors.map((connector) => [connector.relationId, connector.route])
    );
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
        if (scene.layoutStability === "stable-final") {
          assert.deepEqual(layout.fullGeometryById, finalLayout.fullGeometryById, `${scene.id}/${stage.id} geometry drift`);
        } else {
          assert.deepEqual(
            Object.keys(layout.fullGeometryById),
            layout.state.renderedNodeIds,
            `${scene.id}/${stage.id} reflow node set`
          );
        }
        for (const connector of layout.connectors) {
          assertOrthogonalConnector(connector, `${scene.id}/${stage.id}/${frame}/${connector.relationId}`);
          if (scene.layoutStability === "stable-final") {
            assert.deepEqual(
              connector.route,
              finalRouteByRelationId.get(connector.relationId),
              `${scene.id}/${stage.id}/${frame}/${connector.relationId} route drift`
            );
          }
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

test("S18 在 592–594.5 秒完成四条件汇聚，之后进入无对号的安静终帧", async () => {
  const episode = await readFixtureEpisode();
  const summary = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((item) => item.id === "S18");
  const rollbackStage = summary.stages.find((item) => item.id === "rollback");
  const convergeStage = summary.stages.find((item) => item.id === "converge");
  assert.equal(rollbackStage.startFrame, 17708);
  assert.equal(convergeStage.startFrame, 17760);
  assert.equal(longReviewSemanticNodeRevealFrame("S18", "rollback"), 17708);
  assert.equal(longReviewSemanticNodeRevealFrame("S18", "adopt"), 17760);
  assert.equal(longReviewSemanticNodeVisibleFrame("S18", "adopt"), 17760);

  for (let frame = 17710; frame <= 17725; frame += 1) {
    const state = longReviewDiagramStateAtFrame("S18", frame);
    assert.ok(state.nodeProgress.rollback > 0, `rollback missing at reported local frame ${frame - 17700}`);
    assert.equal(
      state.nodeProgress.adopt * state.nodeVisibilityProgress.adopt,
      0,
      `adopt visible at reported local frame ${frame - 17700}`
    );
  }
  for (let frame = 17708; frame < convergeStage.startFrame; frame += 1) {
    const state = longReviewDiagramStateAtFrame("S18", frame);
    assert.ok(state.nodeProgress.rollback > 0);
    assert.equal(state.nodeProgress.adopt * state.nodeVisibilityProgress.adopt, 0);
  }
  const revealBegins = longReviewDiagramStateAtFrame("S18", convergeStage.startFrame);
  assert.equal(revealBegins.stageId, "converge");
  assert.ok(revealBegins.nodeProgress.adopt > 0);
  assert.ok(revealBegins.nodeProgress.adopt * revealBegins.nodeVisibilityProgress.adopt > 0);
  const adoptVisible = longReviewDiagramStateAtFrame("S18", 17777);
  assert.ok(adoptVisible.nodeProgress.adopt * adoptVisible.nodeVisibilityProgress.adopt > 0);

  for (const edgeId of convergeStage.edgeIds) {
    const edgeRevealFrame = longReviewSemanticEdgeRevealFrame("S18", edgeId);
    assert.equal(longReviewDiagramStateAtFrame("S18", edgeRevealFrame - 1).edgeProgress[edgeId], 0);
    assert.ok(longReviewDiagramStateAtFrame("S18", edgeRevealFrame).edgeProgress[edgeId] > 0);
    assert.equal(edgeRevealFrame, 17781);
  }
  assert.equal(summary.holdStartFrame, 17835);
  const atConvergenceStart = longReviewDiagramStateAtFrame("S18", 17760);
  const beforeQuietHold = longReviewDiagramStateAtFrame("S18", 17834);
  assert.notDeepEqual(
    {
      adopt: atConvergenceStart.nodeProgress.adopt,
      arrow: atConvergenceStart.edgeArrowProgress["rollback-adopt"]
    },
    {
      adopt: beforeQuietHold.nodeProgress.adopt,
      arrow: beforeQuietHold.edgeArrowProgress["rollback-adopt"]
    }
  );
  let previousConvergenceProgress = 0;
  for (let frame = convergeStage.startFrame; frame < summary.holdStartFrame; frame += 1) {
    const state = longReviewDiagramStateAtFrame("S18", frame);
    assert.ok(
      state.convergenceProgress > previousConvergenceProgress,
      `S18 convergence must keep moving at ${frame}`
    );
    assert.equal(state.nodeHighlightProgress.adopt, state.convergenceProgress);
    for (const edgeId of convergeStage.edgeIds) {
      assert.equal(state.edgeHighlightProgress[edgeId], state.convergenceProgress);
    }
    assert.equal(state.finalHold, false);
    previousConvergenceProgress = state.convergenceProgress;
  }
  const finalHold = longReviewDiagramStateAtFrame("S18", summary.holdStartFrame);
  assert.equal(beforeQuietHold.complete, false);
  assert.equal(finalHold.finalHold, true);
  assert.equal(finalHold.complete, true);
  assert.equal(finalHold.nodeProgress.adopt, 1);
  assert.equal(finalHold.edgeProgress["rollback-adopt"], 1);
  assert.equal(finalHold.edgeArrowProgress["rollback-adopt"], 1);
  assert.equal(finalHold.convergenceProgress, 1);
  for (let frame = summary.holdStartFrame; frame < summary.endFrame; frame += 1) {
    const state = longReviewDiagramStateAtFrame("S18", frame);
    assert.equal(state.finalHold, true, `S18 quiet hold at ${frame}`);
    assert.equal(state.convergenceProgress, 1, `S18 quiet convergence at ${frame}`);
    assert.equal(state.nodeHighlightProgress.adopt, 1, `S18 quiet node focus at ${frame}`);
    assert.equal(state.edgeHighlightProgress["rollback-adopt"], 1, `S18 quiet edge focus at ${frame}`);
  }
  const endFrame = longReviewDiagramStateAtFrame("S18", 17999);
  assert.deepEqual(
    {
      stageId: endFrame.stageId,
      nodes: endFrame.nodeProgress,
      edges: endFrame.edgeProgress,
      arrows: endFrame.edgeArrowProgress,
      visibleNodes: endFrame.currentVisibleNodeIds,
      visibleEdges: endFrame.currentVisibleEdgeIds
    },
    {
      stageId: finalHold.stageId,
      nodes: finalHold.nodeProgress,
      edges: finalHold.edgeProgress,
      arrows: finalHold.edgeArrowProgress,
      visibleNodes: finalHold.currentVisibleNodeIds,
      visibleEdges: finalHold.currentVisibleEdgeIds
    }
  );

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
    assert.equal(subtitle.activeSubtitle?.sourceText, "完成标准、权限边界和版本回退。");
    assert.equal(subtitle.activeSubtitle?.text, "完成标准、权限边界和版本回退。");
    assert.equal(subtitle.presentationMode, "hidden");
    assert.equal(subtitle.renderSubtitle, false);
  }
  const convergenceSubtitle = longReviewSubtitleGateAtFrame(episode.subtitles, 17763);
  assert.equal(convergenceSubtitle.phase, "dense-build");
  assert.equal(convergenceSubtitle.presentationMode, "semantic-cue");
  assert.equal(convergenceSubtitle.activeSubtitle.text, "四项条件汇聚");
  const quietSubtitle = longReviewSubtitleGateAtFrame(episode.subtitles, 17835);
  assert.equal(quietSubtitle.phase, "final-hold");
  assert.equal(quietSubtitle.presentationMode, "semantic-cue");
  assert.equal(quietSubtitle.activeSubtitle.text, "四项条件汇聚");

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
  const component = await readFile(COMPONENT_PATH, "utf8");
  assert.match(component, /const backdropFrame = frame >= finalScene\.holdStartFrame/u);
  assert.match(component, /<WideMovingBackdrop frameOverride=\{backdropFrame\} \/>/u);
  assert.match(component, /data-wallpaper-sample-frame=\{frame\}/u);
  const backdropStart = component.indexOf("function WideMovingBackdrop");
  const backdropEnd = component.indexOf("function normalizeNodeCopy", backdropStart);
  assert.ok(backdropStart >= 0 && backdropEnd > backdropStart);
  const backdropSource = component.slice(backdropStart, backdropEnd);
  assert.match(backdropSource, /radial-gradient/u);
  assert.match(backdropSource, /data-wallpaper-compositor-policy/u);
  assert.doesNotMatch(backdropSource, /filter\s*:/u);
  assert.doesNotMatch(backdropSource, /willChange\s*:/u);
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

test("每个镜头边界只保留一个完全不透明的信息 owner", () => {
  assert.ok(AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES > 0);
  for (const incoming of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.slice(1)) {
    const boundaryFrame = incoming.startFrame;
    const outgoing = longReviewSceneAtFrame(boundaryFrame - 1);
    for (
      let frame = boundaryFrame - AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES;
      frame <= boundaryFrame + AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES;
      frame += 1
    ) {
      const layers = longReviewSceneLayersAtFrame(frame);
      assert.equal(layers.length, 1, `single semantic owner at frame ${frame}`);
      assert.equal(layers[0].opacity, 1, `opaque scene at frame ${frame}`);
      assert.equal(layers[0].copyOpacity, 1, `opaque copy at frame ${frame}`);
      assert.equal(layers[0].diagramOpacity, 1, `opaque diagram at frame ${frame}`);
      assert.equal(layers[0].opacity * layers[0].copyOpacity, 1, `effective copy opacity ${frame}`);
      assert.equal(layers[0].opacity * layers[0].diagramOpacity, 1, `effective diagram opacity ${frame}`);
      assert.equal(layers[0].semanticHandoff, "opaque-hard-cut");
      assert.equal(layers[0].sceneId, longReviewSceneAtFrame(frame).id);
    }
    assert.equal(longReviewSceneLayersAtFrame(boundaryFrame - 1)[0].sceneId, outgoing.id);
    assert.equal(longReviewSceneLayersAtFrame(boundaryFrame)[0].sceneId, incoming.id);

    const titleStartFrame = boundaryFrame - AGENT_SKILL_LONG_REVIEW_TITLE_PREROLL_FRAMES;
    assert.equal(visualSystemV1TextMotionAtFrame(boundaryFrame, titleStartFrame).opacity, 1);
  }
});

test("首帧先完整建立大标题，章节轨道与其他小字按帧延后", async () => {
  const opening = sceneById("S01");
  const titleStartFrame = opening.startFrame - AGENT_SKILL_LONG_REVIEW_TITLE_PREROLL_FRAMES;
  assert.equal(titleStartFrame, -11);
  for (const frame of [0, 1, 11, 18, 29]) {
    assert.equal(
      visualSystemV1TextMotionAtFrame(frame, titleStartFrame).opacity,
      1,
      `opening title must already be settled at frame ${frame}`
    );
  }
  assert.equal(visualSystemV1ChapterRevealAtFrame(0, 11, 8).opacity, 0);
  assert.equal(visualSystemV1ChapterRevealAtFrame(1, 11, 8).opacity, 0);
  assert.equal(visualSystemV1ChapterRevealAtFrame(11, 11, 8).opacity, 0);
  assert.equal(visualSystemV1ChapterRevealAtFrame(18, 11, 8).opacity, 1);
  assert.equal(visualSystemV1ChapterRevealAtFrame(29, 11, 8).opacity, 1);
  assert.equal(visualSystemV1ChapterRevealAtFrame(0).opacity, 1, "other compositions remain visible by default");
  const episode = await readFixtureEpisode();
  assert.equal(longReviewSubtitleGateAtFrame(episode.subtitles, 0).opacity, 0);
  assert.ok(opening.visualPlan.timing.supportingCopyStartFrame > 0);
  assert.ok(opening.visualPlan.timing.graphicStartFrame > opening.visualPlan.timing.supportingCopyStartFrame);

  const [component, visualComponents] = await Promise.all([
    readFile(COMPONENT_PATH, "utf8"),
    readFile(VISUAL_COMPONENTS_PATH, "utf8")
  ]);
  assert.doesNotMatch(component, /spec\.startFrame === 0/u);
  assert.match(
    component,
    /const titleStartFrame = spec\.startFrame - AGENT_SKILL_LONG_REVIEW_TITLE_PREROLL_FRAMES/u
  );
  assert.match(
    component,
    /revealStartFrame=\{AGENT_SKILL_LONG_REVIEW_TITLE_PREROLL_FRAMES\}/u
  );
  assert.match(visualComponents, /visualSystemV1ChapterRevealAtFrame/u);
  assert.match(visualComponents, /opacity:\s*reveal\.opacity/u);
});

test("正式视觉标题不被旧 episode 覆盖，渐进目录边框只包住当前可见成员", async () => {
  const s05 = sceneById("S05");
  const visualCopy = longReviewVisualSceneCopy("S05", {
    title: "Agent Skill 的准确定义",
    statement: "旧 episode 说明"
  });
  assert.equal(visualCopy.title, "Skill 是一个有边界的目录");
  assert.equal(visualCopy.titleSource, "formal-visual-spec");
  assert.equal(visualCopy.episodeTitleMismatch, true);
  assert.equal(visualCopy.deck, s05.deck);

  const group = s05.groups.find((item) => item.id === "skill-package-scope");
  assert.equal(group.boundsMode, "visible-members");
  const beforeNode = longReviewDiagramStateAtFrame(
    "S05",
    longReviewSemanticNodeRevealFrame("S05", "root") - 1
  );
  const atNode = longReviewDiagramStateAtFrame(
    "S05",
    longReviewSemanticNodeRevealFrame("S05", "root")
  );
  assert.equal(longReviewSemanticGroupProgress(beforeNode, group.nodeIds), 0);
  assert.ok(longReviewSemanticGroupProgress(atNode, group.nodeIds) > 0);

  const [component, contrastGeometry] = await Promise.all([
    readFile(COMPONENT_PATH, "utf8"),
    readFile(CONTRAST_GEOMETRY_PATH, "utf8")
  ]);
  assert.match(component, /longReviewSemanticGroupProgress\(layout\.state, group\.nodeIds\)/u);
  assert.match(component, /if \(groupProgress <= 0\) return null/u);
  assert.match(contrastGeometry, /group\.boundsMode === "visible-members"/u);
  assert.match(contrastGeometry, /layout\.previousGeometryById/u);
  assert.match(contrastGeometry, /layout\.currentGeometryById/u);
  assert.match(component, /const title = visualSceneCopy\.title/u);
  assert.doesNotMatch(component, /scene\.title \?\? spec\.title/u);
  assert.match(component, /spec\.startFrame - AGENT_SKILL_LONG_REVIEW_TITLE_PREROLL_FRAMES/u);
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

test("正式长片信息卡保持纯文字，三个 AI 图标只作为真实关系节点", async () => {
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
      assert.equal(icon.ownerId, null, `${scene.id}/${icon.id}`);
      assert.equal(icon.participation, "graph-node", `${scene.id}/${icon.id}`);
    }
  }
  const standaloneIcons = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.flatMap((scene) =>
    scene.standaloneIcons.map((icon) => ({
      sceneId: scene.id,
      id: icon.id,
      anchorId: icon.anchorId,
      semanticObjectId: icon.semanticObjectId,
      ownerId: icon.ownerId,
      participation: icon.participation,
      conceptKind: icon.conceptKind,
      presentation: icon.presentation,
      layoutRole: icon.layoutRole,
      attachmentMode: icon.attachmentMode,
      autoInsert: icon.autoInsert,
      placement: icon.placement,
      caption: icon.caption,
      sizeRole: icon.sizeRole,
      maximumGapPx: icon.maximumGapPx,
      labelRevealDeltaFrames: icon.labelRevealDeltaFrames,
      delayed: icon.delayUntilFinalHold
    }))
  );
  assert.deepEqual(standaloneIcons, [
    {
      sceneId: "S10",
      id: "tool-symbol",
      anchorId: "tool",
      semanticObjectId: "tool",
      ownerId: null,
      participation: "graph-node",
      conceptKind: "tool",
      presentation: "open-diagram-symbol",
      layoutRole: "semantic-icon-node",
      attachmentMode: "independent",
      autoInsert: false,
      placement: "anchor-bounds",
      caption: null,
      sizeRole: "support",
      maximumGapPx: null,
      labelRevealDeltaFrames: 0,
      delayed: false
    },
    {
      sceneId: "S10",
      id: "mcp-symbol",
      anchorId: "mcp",
      semanticObjectId: "mcp",
      ownerId: null,
      participation: "graph-node",
      conceptKind: "mcp",
      presentation: "open-diagram-symbol",
      layoutRole: "semantic-icon-node",
      attachmentMode: "independent",
      autoInsert: false,
      placement: "anchor-bounds",
      caption: null,
      sizeRole: "support",
      maximumGapPx: null,
      labelRevealDeltaFrames: 0,
      delayed: false
    },
    {
      sceneId: "S17",
      id: "human-gate-symbol",
      anchorId: "human",
      semanticObjectId: "human",
      ownerId: null,
      participation: "graph-node",
      conceptKind: "human-approval",
      presentation: "open-diagram-symbol",
      layoutRole: "semantic-icon-node",
      attachmentMode: "independent",
      autoInsert: false,
      placement: "anchor-bounds",
      caption: null,
      sizeRole: "support",
      maximumGapPx: null,
      labelRevealDeltaFrames: 0,
      delayed: false
    },
  ]);
  assert.deepEqual(
    AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.filter((scene) => scene.layoutStability === "explicit-reflow")
      .map((scene) => scene.id),
    ["S05"]
  );

  const [component, visualComponents] = await Promise.all([
    readFile(COMPONENT_PATH, "utf8"),
    readFile(VISUAL_COMPONENTS_PATH, "utf8")
  ]);
  assert.match(component, /conceptKind="none"/u);
  assert.match(component, /<VisualSystemV1StandaloneIcon/u);
  assert.match(component, /graphIconByAnchorId\.has\(nodeId\)/u);
  assert.match(visualComponents, /VisualSystemV1AiTechIcon/u);
  assert.match(visualComponents, /data-ai-tech-icon-container="standalone"/u);
  assert.match(visualComponents, /不能嵌入图标/u);
  assert.match(visualComponents, /statusMarkVariant=\{statusMarkVariant\}/u);
  assert.doesNotMatch(visualComponents, /VisualSystemV1OpenDiagramGlyph/u);
});

test("七个 flow 镜头固定行组与方向，最终布局行内有序且全部节点不重叠", () => {
  const expectedProfiles = {
    S01: {
      rowGroups: [["prompt-a", "prompt-b", "prompt-c"], ["skill-unit"]],
      rowDirections: ["ltr", "ltr"]
    },
    S08: {
      rowGroups: [
        ["metadata-slot", "instruction-slot", "resource-slot"],
        ["focus"],
        ["context-budget", "parked"]
      ],
      rowDirections: ["ltr", "ltr", "ltr"]
    },
    S10: {
      rowGroups: [["skill", "agent", "tool"], ["mcp", "external"], ["combine", "weekly"]],
      rowDirections: ["ltr", "ltr", "ltr"]
    },
    S14: {
      rowGroups: [["publisher", "installer", "operator", "reviewer"], ["scanner", "owner"]],
      rowDirections: ["ltr", "ltr"]
    },
    S15: {
      rowGroups: [
        ["source", "permission", "runtime", "change"],
        ["invalidate", "review"],
        ["rollback", "enable"]
      ],
      rowDirections: ["ltr", "rtl", "ltr"]
    },
    S17: {
      rowGroups: [["understand", "trial", "inspect"], ["machine", "human", "revise"]],
      rowDirections: ["ltr", "rtl"]
    },
    S18: {
      rowGroups: [["trigger", "accept"], ["permission", "rollback"], ["adopt"]],
      rowDirections: ["ltr", "ltr", "ltr"]
    }
  };
  assert.deepEqual(Object.keys(AGENT_SKILL_LONG_REVIEW_FLOW_LAYOUT_PROFILES), Object.keys(expectedProfiles));

  for (const [sceneId, expected] of Object.entries(expectedProfiles)) {
    const scene = sceneById(sceneId);
    assert.equal(scene.flowLayoutProfile, AGENT_SKILL_LONG_REVIEW_FLOW_LAYOUT_PROFILES[sceneId]);
    assert.deepEqual(
      {
        rowGroups: scene.flowLayoutProfile.rowGroups,
        rowDirections: scene.flowLayoutProfile.rowDirections
      },
      expected,
      `${sceneId} flow profile`
    );
    const layout = longReviewLayoutAtFrame(sceneId, scene.holdStartFrame, {
      width: 1920,
      height: 1080
    });
    const rowCenters = [];
    for (const [rowIndex, rowIds] of expected.rowGroups.entries()) {
      const row = rowIds.map((id) => layout.fullGeometryById[id]);
      assert.equal(row.every(Boolean), true, `${sceneId}/row-${rowIndex + 1} geometry`);
      assert.equal(new Set(row.map((geometry) => geometry.y)).size, 1, `${sceneId}/row-${rowIndex + 1} y`);
      rowCenters.push(row[0].centerY);
      for (let index = 1; index < row.length; index += 1) {
        if (expected.rowDirections[rowIndex] === "ltr") {
          assert.ok(row[index - 1].centerX < row[index].centerX, `${sceneId}/row-${rowIndex + 1} ltr`);
        } else {
          assert.ok(row[index - 1].centerX > row[index].centerX, `${sceneId}/row-${rowIndex + 1} rtl`);
        }
      }
    }
    for (let rowIndex = 1; rowIndex < rowCenters.length; rowIndex += 1) {
      assert.ok(
        rowCenters[rowIndex - 1] < rowCenters[rowIndex],
        `${sceneId} row ${rowIndex} must stay above row ${rowIndex + 1}`
      );
    }
    const geometries = Object.entries(layout.fullGeometryById);
    for (let left = 0; left < geometries.length; left += 1) {
      for (let right = left + 1; right < geometries.length; right += 1) {
        assert.equal(
          rectanglesOverlap(geometries[left][1], geometries[right][1]),
          false,
          `${sceneId} overlaps ${geometries[left][0]}/${geometries[right][0]}`
        );
      }
    }
  }
});

test("十八个镜头用真实文字盒验证边框、换行与紧凑字号，不再只验证声明矩形", () => {
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    assert.equal(
      scene.textBoxMetrics.length,
      scene.nodes.length,
      `${scene.id} 的每个节点都必须具有真实文字盒证据`
    );
    for (const metrics of scene.textBoxMetrics) {
      assert.equal(metrics.fits, true, `${metrics.id} 文字盒必须完整落入节点`);
      assert.ok(metrics.availableWidthPx > 0, `${metrics.id} 可用宽度`);
      assert.ok(metrics.availableHeightPx > 0, `${metrics.id} 可用高度`);
    }
  }
  for (const sceneId of ["S01", "S08", "S10", "S14", "S15", "S17", "S18"]) {
    assert.equal(sceneById(sceneId).typographyProfile, "longform-emphasis", sceneId);
  }
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.filter(
    (candidate) => !["S01", "S08", "S10", "S14", "S15", "S17", "S18"].includes(candidate.id)
  )) {
    assert.equal(scene.typographyProfile, "standard", scene.id);
  }
});

test("S15 在 490–500 秒形成横向证据生命周期、失效复评与回退闭环", () => {
  const scene = sceneById("S15");
  assert.equal(scene.visualPlan.structure, "flow");
  assert.equal(scene.narrativeTreatment, "governance-evidence-trail");
  assert.deepEqual(
    scene.stages.map((stage) => [stage.id, stage.startFrame]),
    [
      ["source", 14160],
      ["permission", 14316],
      ["runtime", 14480],
      ["change", 14643],
      ["invalidate", 14806],
      ["review-focus", 14904],
      ["review", 14928],
      ["decision", 15126]
    ]
  );

  const changeLayout = longReviewLayoutAtFrame("S15", 14700, { width: 1920, height: 1080 });
  assert.equal(changeLayout.state.stageId, "change");
  assert.deepEqual(changeLayout.state.currentVisibleNodeIds, [
    "source", "permission", "runtime", "change"
  ]);
  assert.deepEqual(changeLayout.state.currentVisibleEdgeIds, [
    "source-permission", "permission-runtime", "runtime-change"
  ]);
  const changeGeometries = changeLayout.state.currentVisibleNodeIds.map(
    (nodeId) => changeLayout.geometryById[nodeId]
  );
  const evidenceTrailSpan = Math.max(...changeGeometries.map((item) => item.right)) -
    Math.min(...changeGeometries.map((item) => item.left));
  assert.ok(
    evidenceTrailSpan / changeLayout.safeArea.width >= 0.8,
    `S15 evidence trail only occupies ${evidenceTrailSpan}px`
  );

  const invalidationLayout = longReviewLayoutAtFrame("S15", 14890, {
    width: 1920,
    height: 1080
  });
  assert.equal(invalidationLayout.state.stageId, "invalidate");
  assert.deepEqual(invalidationLayout.state.currentVisibleNodeIds, [
    "source", "permission", "runtime", "change", "invalidate", "review"
  ]);
  assert.deepEqual(invalidationLayout.state.currentVisibleEdgeIds, [
    "source-permission",
    "permission-runtime",
    "runtime-change",
    "change-invalidate",
    "invalidate-review"
  ]);

  const closedLoopLayout = longReviewLayoutAtFrame("S15", 14999, {
    width: 1920,
    height: 1080
  });
  assert.equal(closedLoopLayout.state.stageId, "review");
  assert.deepEqual(closedLoopLayout.state.currentVisibleNodeIds, [
    "source", "change", "invalidate", "review", "enable", "rollback"
  ]);
  assert.deepEqual(closedLoopLayout.state.currentVisibleEdgeIds, [
    "change-invalidate",
    "invalidate-review",
    "review-enable",
    "review-rollback",
    "rollback-source"
  ]);
  assertRelationEndpointsVisible(
    scene,
    closedLoopLayout.state.currentVisibleNodeIds,
    closedLoopLayout.state.currentVisibleEdgeIds,
    "S15/14999"
  );
  for (const nodeId of closedLoopLayout.state.currentVisibleNodeIds) {
    assert.equal(closedLoopLayout.state.nodeVisibilityProgress[nodeId], 1, `S15/${nodeId} visible`);
  }
  for (const edgeId of closedLoopLayout.state.currentVisibleEdgeIds) {
    assert.equal(closedLoopLayout.state.edgeProgress[edgeId], 1, `S15/${edgeId} drawn`);
    assert.equal(closedLoopLayout.state.edgeArrowProgress[edgeId], 1, `S15/${edgeId} arrow`);
  }
  assert.equal(
    closedLoopLayout.connectors.some((connector) => connector.relationId === "rollback-source"),
    true
  );
  for (const connector of closedLoopLayout.connectors) {
    assertOrthogonalConnector(connector, `S15/${connector.relationId}`);
    for (const [start, end] of routeSegments(connector.route)) {
      for (const [nodeId, geometry] of Object.entries(closedLoopLayout.connectorGeometryById)) {
        if (nodeId === connector.from || nodeId === connector.to) continue;
        assert.equal(
          orthogonalSegmentIntersectsRect(start, end, geometry),
          false,
          `S15/${connector.relationId} crosses ${nodeId}`
        );
      }
    }
  }
  const invalidateGeometry = closedLoopLayout.fullConnectorGeometryById.invalidate;
  const reviewGeometry = closedLoopLayout.fullConnectorGeometryById.review;
  assert.ok(invalidateGeometry.width < closedLoopLayout.fullGeometryById.invalidate.width / 2);
  assert.ok(reviewGeometry.width < closedLoopLayout.fullGeometryById.review.width / 2);
  const invalidateReview = closedLoopLayout.allConnectors.find(
    (connector) => connector.relationId === "invalidate-review"
  );
  assert.ok(invalidateReview, "S15/invalidate-review connector");
  assert.ok(
    Math.abs(invalidateReview.route[0].x - invalidateReview.route.at(-1).x) > 300,
    "S15/invalidate-review must visibly bridge the two text groups"
  );
  assert.equal(
    pointOnGeometryBoundary(invalidateReview.route[0], invalidateGeometry),
    true,
    "S15/invalidate-review source must bind to visible text"
  );
  assert.equal(
    pointOnGeometryBoundary(invalidateReview.route.at(-1), reviewGeometry),
    true,
    "S15/invalidate-review target must bind to visible text"
  );
});

test("S10 与 S17 的三个图标替代真实关系节点，不再生成远端重复表现", async () => {
  let resolvedCount = 0;
  for (const sceneId of ["S10", "S17"]) {
    const scene = sceneById(sceneId);
    const layout = longReviewLayoutAtFrame(sceneId, scene.holdStartFrame, {
      width: 1920,
      height: 1080
    });
    for (const icon of scene.standaloneIcons) {
      assert.equal(icon.participation, "graph-node", `${sceneId}/${icon.id}`);
      assert.equal(icon.semanticObjectId, icon.anchorId, `${sceneId}/${icon.id}`);
      assert.equal(icon.ownerId, null, `${sceneId}/${icon.id}`);
      assert.equal(icon.placement, "anchor-bounds", `${sceneId}/${icon.id}`);
      assert.equal(icon.labelRevealDeltaFrames, 0, `${sceneId}/${icon.id}`);
      assert.ok(layout.fullGeometryById[icon.anchorId], `${sceneId}/${icon.id} anchor geometry`);
      assert.ok(layout.fullIconGeometryById[icon.anchorId], `${sceneId}/${icon.id} render geometry`);
      assert.ok(
        layout.fullConnectorGeometryById[icon.anchorId].width <
          layout.fullGeometryById[icon.anchorId].width,
        `${sceneId}/${icon.id} 的连线范围必须收紧到可见图标与文字`
      );
      assert.equal(
        layout.fullConnectorGeometryById[icon.anchorId].centerX,
        layout.fullGeometryById[icon.anchorId].centerX,
        `${sceneId}/${icon.id} connector centerX`
      );
      assert.equal(
        layout.fullConnectorGeometryById[icon.anchorId].centerY,
        layout.fullGeometryById[icon.anchorId].centerY,
        `${sceneId}/${icon.id} connector centerY`
      );
      assert.ok(
        layout.fullConnectorGeometryById[icon.anchorId].left >
          layout.fullIconGeometryById[icon.anchorId].left,
        `${sceneId}/${icon.id} 连线命中范围必须排除 DOM 的透明横向 padding`
      );
      assert.ok(
        layout.fullConnectorGeometryById[icon.anchorId].top >
          layout.fullIconGeometryById[icon.anchorId].top,
        `${sceneId}/${icon.id} 连线命中范围必须排除 DOM 的透明纵向 padding`
      );
      const incidentRelations = scene.edges.filter(
        (edge) => edge.from === icon.anchorId || edge.to === icon.anchorId
      );
      assert.ok(incidentRelations.length > 0, `${sceneId}/${icon.id} must join the graph`);
      resolvedCount += 1;
    }
  }
  assert.equal(resolvedCount, 3);
  const [component, visualComponents] = await Promise.all([
    readFile(COMPONENT_PATH, "utf8"),
    readFile(VISUAL_COMPONENTS_PATH, "utf8")
  ]);
  assert.match(component, /if \(graphIconByAnchorId\.has\(nodeId\)\) return null/u);
  assert.match(component, /reason: "semantic-icon-render-bounds"/u);
  assert.match(component, /semanticLayout\.iconGeometryById\[icon\.anchorId\]/u);
  assert.doesNotMatch(component, /StandaloneRailSlot/u);
  assert.match(visualComponents, /opacity: motion\.drawProgress/u);
});

test("S08 的卡片实体都有完整边框，S10 与 S17 的图标节点保持因果关系完整", () => {
  const s08 = sceneById("S08");
  const s08SampleById = new Map(s08.layoutSamples[0].elements.map((element) => [element.id, element]));
  for (const nodeId of ["metadata-slot", "instruction-slot", "resource-slot", "context-budget", "parked"]) {
    assert.equal(s08.surfacePlanById[nodeId].surfaceRole, "information-card", `S08/${nodeId}`);
    assert.equal(s08SampleById.get(nodeId).borderMode, "full-outline", `S08/${nodeId} border`);
    assert.ok(s08SampleById.get(nodeId).borderWidthPx >= 2, `S08/${nodeId} border width`);
  }
  assert.equal(s08.surfacePlanById.focus.surfaceRole, "open-canvas");
  assert.deepEqual(s08.standaloneIcons, []);
  assert.deepEqual(s08.edges.map((edge) => edge.id), [
    "metadata-focus",
    "instruction-focus",
    "resource-focus",
    "focus-budget",
    "budget-parked"
  ]);

  const s10 = sceneById("S10");
  const toolStage = s10.stages.find((stage) => stage.id === "tool");
  const mcpStage = s10.stages.find((stage) => stage.id === "mcp");
  assert.deepEqual(toolStage.visibleNodeIds, ["skill", "agent", "tool"]);
  assert.deepEqual(toolStage.visibleEdgeIds, ["skill-agent", "agent-tool"]);
  assert.deepEqual(mcpStage.visibleNodeIds, ["skill", "agent", "tool", "mcp"]);
  assert.deepEqual(mcpStage.visibleEdgeIds, ["skill-agent", "agent-tool", "agent-mcp"]);
  assert.deepEqual(
    s10.standaloneIcons.map((icon) => [icon.conceptKind, icon.anchorId, icon.participation]),
    [["tool", "tool", "graph-node"], ["mcp", "mcp", "graph-node"]]
  );

  const s17 = sceneById("S17");
  assert.equal(s17.standaloneIcons[0].anchorId, "human");
  assert.equal(s17.standaloneIcons[0].participation, "graph-node");
  assert.equal(s17.edges.some((edge) => edge.id === "machine-human"), true);
  assert.equal(s17.edges.some((edge) => edge.id === "human-revise"), true);
});

test("同阶段关系默认等待端点；渐进目录先完成边框和结构线再显示新成员", async () => {
  assert.equal(AGENT_SKILL_LONG_REVIEW_CONNECTED_ENTRY_MODE, "endpoint-first");
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    for (const stage of scene.stages) {
      for (const nodeId of stage.nodeIds) {
        const expectedVisibleFrame = longReviewSemanticNodeRevealFrame(scene.id, nodeId);
        assert.equal(
          longReviewSemanticNodeVisibleFrame(scene.id, nodeId),
          expectedVisibleFrame,
          `${scene.id}/${stage.id}/${nodeId} visible schedule`
        );
      }
      for (const edgeId of stage.edgeIds) {
        const relation = scene.edges.find((edge) => edge.id === edgeId);
        const edgeRevealFrame = longReviewSemanticEdgeRevealFrame(scene.id, edgeId);
        const beforeEdge = longReviewDiagramStateAtFrame(scene.id, edgeRevealFrame - 1);
        const atEdge = longReviewDiagramStateAtFrame(scene.id, edgeRevealFrame);
        assert.equal(beforeEdge.edgeProgress[edgeId], 0, `${scene.id}/${edgeId} no early connector`);
        assert.ok(atEdge.edgeProgress[edgeId] > 0, `${scene.id}/${edgeId} connector starts`);
        const packageRelationFirst = scene.narrativeTreatment === "package-anatomy" &&
          (relation.semanticType ?? relation.type) === "contains";
        if (packageRelationFirst) {
          assert.equal(
            (atEdge.nodeProgress[relation.from] ?? 0) *
              (atEdge.nodeVisibilityProgress[relation.from] ?? 0),
            1,
            `${scene.id}/${edgeId} parent settles before relation`
          );
          assert.equal(
            atEdge.nodeProgress[relation.to] ?? 0,
            0,
            `${scene.id}/${edgeId} target text stays hidden while relation draws`
          );
          assert.equal(
            longReviewSemanticNodeRevealFrame(scene.id, relation.to),
            edgeRevealFrame + AGENT_SKILL_LONG_REVIEW_EDGE_DRAW_FRAMES,
            `${scene.id}/${edgeId} target starts only after structural line completes`
          );
          continue;
        }
        for (const endpointId of [relation.from, relation.to]) {
          const endpointProgress = (atEdge.nodeProgress[endpointId] ?? 0) *
            (atEdge.nodeVisibilityProgress[endpointId] ?? 0);
          assert.equal(
            endpointProgress,
            1,
            `${scene.id}/${stage.id}/${edgeId}/${endpointId} endpoint must settle before connector`
          );
        }
      }
    }
  }

  const s10ToolStage = sceneById("S10").stages.find((stage) => stage.id === "tool");
  const skillAgentFrame = longReviewSemanticEdgeRevealFrame("S10", "skill-agent");
  const agentVisibleFrame = longReviewSemanticNodeVisibleFrame("S10", "agent");
  const agentToolFrame = longReviewSemanticEdgeRevealFrame("S10", "agent-tool");
  const toolVisibleFrame = longReviewSemanticNodeVisibleFrame("S10", "tool");
  assert.equal(
    skillAgentFrame,
    s10ToolStage.startFrame + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES +
      AGENT_SKILL_LONG_REVIEW_EDGE_DELAY_FRAMES
  );
  assert.equal(agentVisibleFrame, s10ToolStage.startFrame);
  assert.equal(agentToolFrame, skillAgentFrame);
  assert.equal(toolVisibleFrame, s10ToolStage.startFrame);

  assert.ok(
    longReviewSemanticEdgeRevealFrame("S08", "budget-parked") >
      longReviewSemanticNodeVisibleFrame("S08", "context-budget") +
      AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES
  );
  assert.ok(
    longReviewSemanticEdgeRevealFrame("S17", "machine-human") >
      longReviewSemanticNodeVisibleFrame("S17", "human")
  );
  assert.ok(
    longReviewSemanticEdgeRevealFrame("S17", "human-revise") >
      longReviewSemanticNodeVisibleFrame("S17", "revise")
  );

  const s05 = sceneById("S05");
  for (const [nodeId, edgeId] of [
    ["skill-md", "root-skill"],
    ["scripts", "root-scripts"],
    ["references", "root-refs"],
    ["assets", "root-assets"]
  ]) {
    const stage = s05.stages.find((item) => item.nodeIds.includes(nodeId));
    assert.equal(
      longReviewSemanticEdgeRevealFrame("S05", edgeId),
      stage.startFrame + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES +
        AGENT_SKILL_LONG_REVIEW_EDGE_DELAY_FRAMES,
      `S05/${nodeId} waits for the 18-frame outline reflow`
    );
    const nodeRevealFrame = longReviewSemanticNodeRevealFrame("S05", nodeId);
    const beforeNode = longReviewDiagramStateAtFrame("S05", nodeRevealFrame - 1);
    assert.equal(beforeNode.edgeProgress[edgeId], 1, `S05/${nodeId} relation complete before text`);
    assert.equal(beforeNode.nodeProgress[nodeId], 0, `S05/${nodeId} text not yet visible`);
  }
  const boundaryStage = s05.stages.find((item) => item.id === "boundary");
  const boundaryRelation = s05.visualPlan.semanticRelations.find((item) => item.id === "boundary");
  assert.equal(longReviewSemanticRelationType(boundaryRelation), "contrasts-with");
  const promptRevealFrame = longReviewSemanticNodeRevealFrame("S05", "prompt-only");
  assert.equal(
    promptRevealFrame,
    boundaryStage.startFrame + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES
  );
  const promptLayout = longReviewLayoutAtFrame("S05", promptRevealFrame);
  const sourceGroup = s05.groups.find((group) => group.id === "skill-package-scope");
  const promptBounds = longReviewResolvedSemanticGroupBounds(sourceGroup, promptLayout);
  assert.ok(
    promptLayout.geometryById["prompt-only"].left > promptBounds.right,
    "S05 Prompt first appears only after it is outside the settled package outline"
  );
  assert.equal(
    longReviewSemanticEdgeRevealFrame("S05", "boundary"),
    boundaryStage.startFrame + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES * 2 +
      AGENT_SKILL_LONG_REVIEW_EDGE_DELAY_FRAMES
  );
  const promptRelationStart = longReviewSemanticEdgeRevealFrame("S05", "boundary");
  const promptStateAtRelationStart = longReviewDiagramStateAtFrame("S05", promptRelationStart);
  assert.equal(promptStateAtRelationStart.nodeProgress["prompt-only"], 1);
  const promptRelationLayout = longReviewLayoutAtFrame("S05", promptRelationStart);
  const promptRelationBounds = longReviewResolvedSemanticGroupBounds(sourceGroup, promptRelationLayout);
  const promptTarget = promptRelationLayout.geometryById["prompt-only"];
  assert.deepEqual(
    longReviewBoundaryContrastRoute(s05, boundaryRelation, promptRelationLayout),
    [
      { x: promptRelationBounds.right, y: promptTarget.centerY },
      { x: promptTarget.left, y: promptTarget.centerY }
    ],
    "S05 contrast connector is restricted to the external outline-to-card gap"
  );
  const component = await readFile(COMPONENT_PATH, "utf8");
  assert.match(component, /data-connector-semantic-style/u);
  assert.match(component, /contrast-dashed/u);
  assert.match(component, /palette\.purpleDeep/u);
  assert.match(component, /longReviewBoundaryContrastRoute/u);
  assert.match(component, /strokeDasharray: boundaryContrast \? "7 6" : 1/u);
  assert.doesNotMatch(component, /semanticRelation\?\.semanticType === "contrasts-with"/u);
});

test("S14 使用精确 sequence-critical 连线 tone，长片品牌层保持quiet透明度并持续运动", async () => {
  assert.equal(sceneById("S14").connectorTone, "sequence-critical");
  assert.deepEqual(AGENT_SKILL_LONG_REVIEW_CONNECTOR_TONES["sequence-critical"], {
    strokeWidthPx: 2.6,
    markerSizePx: 7,
    restingOpacity: 0.64,
    focusedOpacity: 0.9
  });
  assert.equal(
    AGENT_SKILL_LONG_REVIEW_SCENE_SPECS
      .filter((scene) => scene.id !== "S14")
      .every((scene) => scene.connectorTone === "standard"),
    true
  );
  assert.deepEqual(
    AGENT_SKILL_LONG_REVIEW_SCENE_START_FRAMES,
    AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.map((scene) => scene.startFrame)
  );
  assert.equal(AGENT_SKILL_LONG_REVIEW_SCENE_START_FRAMES.length, 18);
  const component = await readFile(COMPONENT_PATH, "utf8");
  assert.match(
    component,
    /<VisualSystemV1WideBrandLayer[\s\S]*?tone="quiet"[\s\S]*?motionCadence="continuous"[\s\S]*?transitionFrames=\{AGENT_SKILL_LONG_REVIEW_SCENE_START_FRAMES\}[\s\S]*?\/>/u
  );
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
      assert.equal(icon.ownerId, null, `${scene.id}/${icon.id}`);
    }
  }

  const s11 = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find((scene) => scene.id === "S11");
  assert.equal(s11.visualMode, "mixed-diagram");
  assert.deepEqual(s11.groups.map(({ id, label }) => ({ id, label })), [
    { id: "method", label: "方法与判断" },
    { id: "execution", label: "动作、连接与结果" }
  ]);
  assert.equal(s11.groups.every((group) => group.visualForm === "full-outline"), true);
  assert.equal(
    s11.groups.every(
      (group) => group.semanticMeaning === "process-or-relationship-group-boundary"
    ),
    true
  );
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
  assert.equal(s17.visualMode, "open-diagram");
  assert.equal(s17.editorialScene.cards.length, 0);
  assert.equal(s17.editorialScene.diagrams.length, 6);
  assert.equal(s17.editorialScene.relations.length, 5);
  assert.equal(s17.editorialScene.relations.every((relation) => relation.surfaceBoundary == null), true);
  assert.deepEqual(
    Object.fromEntries(Object.entries(s17.surfacePlanById).map(([id, item]) => [id, {
      semanticRole: item.semanticRole,
      surfaceRole: item.surfaceRole,
      surfacePurpose: item.surfacePurpose
    }])),
    {
      understand: { semanticRole: "process-step", surfaceRole: "open-canvas", surfacePurpose: "process-anchor" },
      trial: { semanticRole: "process-step", surfaceRole: "open-canvas", surfacePurpose: "process-anchor" },
      inspect: { semanticRole: "evidence", surfaceRole: "open-canvas", surfacePurpose: "relationship-structure" },
      revise: { semanticRole: "feedback-action", surfaceRole: "open-canvas", surfacePurpose: "transition-output" },
      machine: { semanticRole: "decision", surfaceRole: "open-canvas", surfacePurpose: "relationship-structure" },
      human: { semanticRole: "decision", surfaceRole: "open-canvas", surfacePurpose: "relationship-structure" }
    }
  );
  assert.equal(
    new Set(Object.values(s17.surfacePlanById).map((item) => item.semanticGroupId)).size,
    1
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
  const reviseVisibleFrame = longReviewSemanticNodeVisibleFrame("S17", "revise");
  const feedbackEdgeRevealFrame = longReviewSemanticEdgeRevealFrame("S17", "human-revise");
  assert.equal(reviseRevealFrame, 17049);
  assert.equal(reviseVisibleFrame, 17049);
  assert.equal(feedbackEdgeRevealFrame, 17070);
  for (let frame = 16860; frame < reviseRevealFrame; frame += 1) {
    assert.equal(
      longReviewDiagramStateAtFrame("S17", frame).nodeProgress.revise,
      0,
      `反馈字段不得在最后阶段前出现：global ${frame}`
    );
  }
  assert.ok(longReviewDiagramStateAtFrame("S17", reviseRevealFrame).nodeProgress.revise > 0);
  assert.ok(longReviewDiagramStateAtFrame("S17", reviseRevealFrame).nodeVisibilityProgress.revise > 0);
  assert.equal(longReviewDiagramStateAtFrame("S17", feedbackEdgeRevealFrame - 1).edgeProgress["human-revise"], 0);
  assert.ok(longReviewDiagramStateAtFrame("S17", feedbackEdgeRevealFrame).edgeProgress["human-revise"] > 0);
  const firstFeedbackArrowFrame = Array.from(
    { length: 40 },
    (_, offset) => feedbackEdgeRevealFrame + offset
  ).find((frame) =>
    longReviewDiagramStateAtFrame("S17", frame).edgeArrowProgress["human-revise"] > 0
  );
  assert.equal(firstFeedbackArrowFrame, 17084);
  assert.equal(
    longReviewDiagramStateAtFrame("S17", firstFeedbackArrowFrame - 1).nodeVisibilityProgress.revise,
    1
  );
  const firstConnectedFeedbackState = longReviewDiagramStateAtFrame(
    "S17",
    firstFeedbackArrowFrame
  );
  assert.ok(firstConnectedFeedbackState.nodeVisibilityProgress.revise > 0);
  assert.equal(firstConnectedFeedbackState.nodeVisibilityProgress.revise, 1);
  assert.ok(firstConnectedFeedbackState.edgeArrowProgress["human-revise"] > 0);
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
  const feedbackConnector = stableS17Layout.connectors.find(
    (connector) => connector.relationId === "human-revise"
  );
  const reviseConnectorGeometry = stableS17Layout.fullConnectorGeometryById.revise;
  assertOrthogonalConnector(feedbackConnector, "S17/human-revise");
  assert.equal(feedbackConnector.route.at(-1).x, reviseConnectorGeometry.right);
  assert.equal(feedbackConnector.route.at(-1).y, reviseConnectorGeometry.centerY);
  assert.ok(
    reviseConnectorGeometry.width < stableS17Layout.fullGeometryById.revise.width,
    "反馈箭头必须命中文字可见边界，而不是宽布局 cell"
  );
  assert.equal(s17.edges.some((edge) => edge.id === "inspect-revise"), false);
  assert.equal(s17.editorialScene.cards.every((card) => card.iconPresentation === "none"), true);
  assert.match(component, /longReviewLayoutAtFrame\(spec\.id, globalFrame/u);
  assert.match(component, /data-layout-stability/u);
  assert.match(component, /state\.edgeProgress\[connector\.relationId\]/u);
  assert.doesNotMatch(component, /connector\.presentationKind === "smooth-curve"/u);
  assert.match(component, /data-connector-presentation/u);
  assert.match(component, /<polyline/u);
});

test("S16 前置条件首次出现后持续保留，分支只替换结果", () => {
  const scene = sceneById("S16");
  assert.deepEqual(scene.continuityNodeIds, ["stable", "detect", "authority", "version", "gate"]);
  const expected = {
    candidate: {
      nodes: ["candidate"],
      edges: []
    },
    stability: {
      nodes: ["candidate", "stable", "detect"],
      edges: ["candidate-stable", "candidate-detect"]
    },
    authority: {
      nodes: ["candidate", "stable", "detect", "authority"],
      edges: ["candidate-stable", "candidate-detect", "candidate-authority"]
    },
    version: {
      nodes: ["stable", "detect", "authority", "version"],
      edges: ["detect-version"]
    },
    chaos: {
      nodes: ["stable", "detect", "authority", "version", "gate", "chaos"],
      edges: ["stable-gate", "detect-gate", "authority-gate", "version-gate", "gate-chaos"]
    },
    "gate-settle": {
      nodes: ["stable", "detect", "authority", "version", "gate"],
      edges: ["stable-gate", "detect-gate", "authority-gate", "version-gate"]
    },
    trusted: {
      nodes: ["stable", "detect", "authority", "version", "gate", "trusted"],
      edges: ["stable-gate", "detect-gate", "authority-gate", "version-gate", "gate-trusted"]
    }
  };
  for (const [stageIndex, stage] of scene.stages.entries()) {
    assert.deepEqual(longReviewVisibleNodeIdsAtStage(scene.id, stageIndex), expected[stage.id].nodes);
    assert.deepEqual(longReviewVisibleEdgeIdsAtStage(scene.id, stageIndex), expected[stage.id].edges);
    const settledState = longReviewDiagramStateAtFrame(
      scene.id,
      stage.startFrame + AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES
    );
    for (const continuityNodeId of scene.continuityNodeIds) {
      const firstVisibleStageIndex = scene.stages.findIndex((candidate, index) =>
        longReviewVisibleNodeIdsAtStage(scene.id, index).includes(continuityNodeId)
      );
      if (stageIndex < firstVisibleStageIndex) continue;
      assert.ok(expected[stage.id].nodes.includes(continuityNodeId));
      assert.equal(settledState.nodeVisibilityProgress[continuityNodeId], 1);
      if (!stage.activeNodeIds.includes(continuityNodeId)) {
        assert.equal(settledState.nodeHighlightProgress[continuityNodeId], 0);
      }
    }
    const layout = longReviewLayoutAtFrame(scene.id, stage.startFrame);
    assert.deepEqual(layout.fullGeometryById, longReviewLayoutAtFrame(scene.id, scene.holdStartFrame).fullGeometryById);
    for (const connector of layout.allConnectors) assertOrthogonalConnector(connector, `S16/${stage.id}/${connector.relationId}`);
  }
  assert.deepEqual(scene.standaloneIcons, []);
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
  assert.deepEqual(at9990.state.currentVisibleNodeIds, ["skill", "tool", "mcp", "combine", "weekly"]);
  assert.deepEqual(at9990.state.currentVisibleEdgeIds, [
    "skill-combine",
    "tool-combine",
    "mcp-combine",
    "combine-weekly"
  ]);

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
    assert.equal(s14.surfacePlanById[nodeId].surfaceRole, "open-canvas", `S14/${nodeId}`);
    assert.equal(s14SampleById.get(nodeId).borderMode, "shape-outline", `S14/${nodeId} border`);
    assert.equal(s14SampleById.get(nodeId).iconPlacement, "none", `S14/${nodeId} embedded icon`);
  }
  assert.equal(s14.surfacePlanById.owner.surfaceRole, "information-card");
  assert.equal(s14SampleById.get("owner").borderMode, "full-outline");
  assert.ok(s14SampleById.get("owner").borderWidthPx >= 2);
  const s14Final = longReviewLayoutAtFrame("S14", 14159);
  assertRelationEndpointsVisible(
    s14,
    s14Final.state.currentVisibleNodeIds,
    s14Final.state.currentVisibleEdgeIds,
    "S14/final"
  );
  for (const connector of s14Final.connectors) {
    assertOrthogonalConnector(connector, `S14/final/${connector.relationId}`);
  }
  const scannerOwner = s14Final.allConnectors.find(
    (connector) => connector.relationId === "scanner-owner"
  );
  assert.ok(scannerOwner, "S14/scanner-owner connector");
  assert.ok(
    Math.abs(scannerOwner.route[0].x - scannerOwner.route.at(-1).x) > 350,
    "S14/scanner-owner must visibly bridge scanner text and owner card"
  );
  assert.equal(
    pointOnGeometryBoundary(scannerOwner.route[0], s14Final.fullConnectorGeometryById.scanner),
    true
  );
  assert.equal(
    pointOnGeometryBoundary(scannerOwner.route.at(-1), s14Final.fullConnectorGeometryById.owner),
    true
  );

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
  const triggerAdopt = layout.allConnectors.find(
    (connector) => connector.relationId === "trigger-adopt"
  );
  assert.deepEqual(triggerAdopt.route, [
    { x: 864, y: 408 },
    { x: 880, y: 408 },
    { x: 880, y: 666 }
  ]);
  assert.equal(
    triggerAdopt.route.some((point) => Math.abs(point.y - layout.fullGeometryById.trigger.top) < 10),
    false,
    "S18/trigger-adopt must not hug the trigger border"
  );
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

test("S08、S10、S12、S14 使用稳定且绑定真实节点的技术工件骨架", async () => {
  const expectedKinds = new Map([
    ["S08", "bounded-resource-artifact"],
    ["S10", "layered-runtime-map"],
    ["S12", "decision-field"],
    ["S14", "evidence-lifecycle-ledger"]
  ]);
  for (const scene of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS) {
    if (!expectedKinds.has(scene.id)) {
      assert.equal(scene.artifactProfile, null, `${scene.id} must not receive a generic decorative scaffold`);
      continue;
    }
    const profile = scene.artifactProfile;
    assert.equal(profile.kind, expectedKinds.get(scene.id));
    assert.equal(profile.schemaVersion, "technical-artifact-profile-v1");
    assert.equal(profile.revealMode, "anchor-bound");
    assert.equal(profile.decorativeIconsAllowed, false);
    assert.ok(profile.semanticPurpose.length > 0);
    assert.equal(new Set(profile.anchorNodeIds).size, profile.anchorNodeIds.length);
    const nodeIds = new Set(scene.nodes.map((node) => node.id));
    for (const anchorNodeId of profile.anchorNodeIds) assert.ok(nodeIds.has(anchorNodeId));
    for (const zone of profile.zones) {
      const futureCopy = new Set(scene.nodes.flatMap((node) => [node.label, node.detail]));
      assert.equal(futureCopy.has(zone.label), false, `${scene.id}/${zone.id} must not preload node copy`);
    }
    const holdLayout = longReviewLayoutAtFrame(scene.id, scene.holdStartFrame);
    const artifactLayout = technicalArtifactLayout({
      profile,
      safeArea: holdLayout.safeArea,
      geometryById: holdLayout.fullGeometryById
    });
    assert.equal(artifactLayout.bounds.meetsCoverage, true);
    assert.ok(
      artifactLayout.bounds.safeWidthRatio >= TECHNICAL_ARTIFACT_PROFILE_POLICY.minimumSafeWidthRatio
    );
    assert.ok(
      artifactLayout.bounds.safeHeightRatio >= TECHNICAL_ARTIFACT_PROFILE_POLICY.minimumSafeHeightRatio
    );
    for (const labelBounds of artifactLayout.labelBounds) {
      assert.ok(labelBounds.left >= 0 && labelBounds.top >= 0);
      assert.ok(labelBounds.left + labelBounds.width <= holdLayout.safeArea.width);
      assert.ok(labelBounds.top + labelBounds.height <= holdLayout.safeArea.height);
      for (const geometry of Object.values(holdLayout.fullGeometryById)) {
        const local = {
          left: geometry.left - holdLayout.safeArea.left,
          top: geometry.top - holdLayout.safeArea.top,
          right: geometry.right - holdLayout.safeArea.left,
          bottom: geometry.bottom - holdLayout.safeArea.top
        };
        const overlaps = labelBounds.left < local.right &&
          labelBounds.left + labelBounds.width > local.left &&
          labelBounds.top < local.bottom &&
          labelBounds.top + labelBounds.height > local.top;
        assert.equal(overlaps, false, `${scene.id} scaffold label must not overlap semantic copy`);
      }
    }
    for (const stage of scene.stages) {
      const layout = longReviewLayoutAtFrame(scene.id, stage.startFrame);
      const stagedArtifactLayout = technicalArtifactLayout({
        profile,
        safeArea: layout.safeArea,
        geometryById: layout.fullGeometryById
      });
      assert.deepEqual(stagedArtifactLayout, artifactLayout, `${scene.id} artifact scaffold must not reflow`);
    }
  }
  assert.equal(sceneById("S08").standaloneIcons.length, 0);
  assert.equal(sceneById("S10").standaloneIcons.length, 2);

  const component = await readFile(COMPONENT_PATH, "utf8");
  const artifactIndex = component.indexOf("<VisualSystemV1TechnicalArtifact");
  const connectorIndex = component.indexOf("<AdaptiveConnectors", artifactIndex);
  const nodeIndex = component.indexOf("semanticLayout.nodeIds.map", artifactIndex);
  assert.ok(artifactIndex >= 0 && artifactIndex < connectorIndex && connectorIndex < nodeIndex);
  assert.doesNotMatch(component, /spec\.(?:id|kind).*artifact/u);
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
  assert.match(component, /data-scene-layout=\{`\$\{spec\.layoutStability\}-visual-grammar`\}/u);
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
