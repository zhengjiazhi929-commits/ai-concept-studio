import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { studioRoot } from "../src/shared/paths.mjs";
import {
  AGENT_SKILL_LONG_REVIEW_CHAPTERS,
  AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES,
  AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS,
  AGENT_SKILL_LONG_REVIEW_FPS,
  AGENT_SKILL_LONG_REVIEW_FRAME_COUNT,
  AGENT_SKILL_LONG_REVIEW_SCENE_SPECS,
  longReviewDiagramStateAtFrame,
  longReviewProgressAtFrame,
  longReviewSceneAtFrame,
  longReviewSceneLayersAtFrame,
  validateAgentSkillLongReviewEpisode
} from "../src/video/agent-skill-long-review-plan.mjs";

const EPISODE_PATH = resolve(
  studioRoot,
  "data",
  "episodes",
  "agent-skill-20260806",
  "episode.json"
);
const PLAN_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review-plan.mjs");
const COMPONENT_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review.jsx");
const INDEX_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review-index.jsx");
const ROOT_PATH = resolve(studioRoot, "src", "video", "agent-skill-long-review-root.jsx");
const RENDER_PATH = resolve(studioRoot, "scripts", "render-agent-skill-long-review.mjs");
const PRODUCTION_ROOT_PATH = resolve(studioRoot, "src", "video", "root.jsx");
const PRODUCTION_PREVIEW_PATH = resolve(studioRoot, "src", "video", "episode-preview.jsx");

async function readFixtureEpisode() {
  return JSON.parse(await readFile(EPISODE_PATH, "utf8"));
}

function assertMonotonic(values, label) {
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(
      values[index] + 1e-12 >= values[index - 1],
      `${label} must not decrease at sample ${index}: ${values[index - 1]} -> ${values[index]}`
    );
  }
}

test("十分钟审阅版固定为 600 秒、30fps、18000 帧，并保留正式 Episode 的 18 场景与 107 字幕", async () => {
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

test("所有分步图逐帧累计显示并在结尾保留完整图", () => {
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

test("每个镜头边界使用守恒交叉淡化，任一帧都不会闪空", () => {
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
      assert.ok(layers.length >= 1 && layers.length <= 2);
      const opacitySum = layers.reduce((sum, layer) => sum + layer.opacity, 0);
      assert.ok(Math.abs(opacitySum - 1) < 1e-12, `opacity sum at frame ${frame}`);
      assert.ok(layers.some((layer) => layer.opacity > 0), `blank frame ${frame}`);
      assert.equal(layers.every((layer) => layer.opacity >= 0 && layer.opacity <= 1), true);
    }
    const atBoundary = longReviewSceneLayersAtFrame(boundaryFrame);
    assert.ok(atBoundary.some((layer) => layer.sceneId === outgoing.id));
    assert.ok(atBoundary.some((layer) => layer.sceneId === incoming.id));
  }
});

test("节点焦点在固定窗口内连续交接，八个证据镜头全部改为原生图", async () => {
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
  assert.match(component, /function EvidenceSourceChip/u);
  assert.match(component, /data-evidence-source/u);
  assert.match(component, /spec\.kind === "native-evidence"/u);
  assert.doesNotMatch(component, /function EvidencePanel|<Img\b|staticFile\(spec\.material\)|objectFit:\s*"cover"/u);
  assert.doesNotMatch(component, /currentStageProgress|continuousStage|translateY\(\$\{translateY/u);
});

test("审阅版进度连续且组件只用 scaleX 驱动", async () => {
  assert.equal(longReviewProgressAtFrame(-1), 0);
  assert.equal(longReviewProgressAtFrame(0), 0);
  assert.equal(longReviewProgressAtFrame(9_000), 0.5);
  assert.equal(longReviewProgressAtFrame(18_000), 1);
  assert.equal(longReviewProgressAtFrame(18_001), 1);

  const component = await readFile(COMPONENT_PATH, "utf8");
  assert.match(component, /scaleX\(\$\{progress/u);
  assert.match(component, /transformOrigin:\s*["']left/u);
  assert.doesNotMatch(component, /width:\s*(?:progress|progressPixels)/u);
});

test("审阅动画完全由逐帧状态驱动，不使用 spring、CSS 动画或 TransitionSeries", async () => {
  const [plan, component] = await Promise.all([
    readFile(PLAN_PATH, "utf8"),
    readFile(COMPONENT_PATH, "utf8")
  ]);
  const source = `${plan}\n${component}`;
  assert.match(component, /useCurrentFrame\(\)/u);
  assert.match(component, /longReviewSceneLayersAtFrame\(frame\)/u);
  assert.match(component, /function EvidenceSourceChip/u);
  assert.doesNotMatch(component, /panProgress|continuousStage|currentStageProgress/u);
  assert.doesNotMatch(source, /\bspring\s*\(/u);
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
