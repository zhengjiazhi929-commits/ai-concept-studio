import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { studioRoot } from "../src/shared/paths.mjs";
import {
  AGENT_SKILL_EXPLANATION_KINDS,
  AGENT_SKILL_EVIDENCE_SOURCE,
  AGENT_SKILL_FULL_VIDEO_CHAPTERS,
  AGENT_SKILL_FULL_VIDEO_CHAPTER_WEIGHTS,
  AGENT_SKILL_FULL_VIDEO_DURATION_SECONDS,
  activeDiagramItemIndex,
  agentSkillEvidenceViewportGeometry,
  agentSkillFullVideoChapterAt,
  agentSkillFullVideoProgressAt,
  agentSkillFullVideoProgressPixelsAt
} from "../src/video/agent-skill-full-video-plan.mjs";

test("完整成片按八个真实内容章节连续覆盖 600 秒，宽度不做均分", () => {
  assert.equal(AGENT_SKILL_FULL_VIDEO_DURATION_SECONDS, 600);
  assert.equal(AGENT_SKILL_FULL_VIDEO_CHAPTERS.length, 8);
  assert.equal(AGENT_SKILL_FULL_VIDEO_CHAPTERS[0].start, 0);
  assert.equal(AGENT_SKILL_FULL_VIDEO_CHAPTERS.at(-1).end, 600);
  for (const [index, chapter] of AGENT_SKILL_FULL_VIDEO_CHAPTERS.entries()) {
    assert.ok(chapter.end > chapter.start);
    if (index > 0) assert.equal(chapter.start, AGENT_SKILL_FULL_VIDEO_CHAPTERS[index - 1].end);
  }
  assert.deepEqual(AGENT_SKILL_FULL_VIDEO_CHAPTER_WEIGHTS, [98, 68, 68, 68, 68, 68, 68, 94]);
  assert.equal(new Set(AGENT_SKILL_FULL_VIDEO_CHAPTER_WEIGHTS).size > 1, true);
  assert.equal(
    AGENT_SKILL_FULL_VIDEO_CHAPTER_WEIGHTS.reduce((total, duration) => total + duration, 0),
    600
  );
  assert.equal(agentSkillFullVideoChapterAt(0).id, "prompt");
  assert.equal(agentSkillFullVideoChapterAt(599.9).id, "product");
});

test("完整成片进度使用稳定整数像素，边界值安全钳制", () => {
  assert.equal(agentSkillFullVideoProgressAt(-1), 0);
  assert.equal(agentSkillFullVideoProgressAt(300), 0.5);
  assert.equal(agentSkillFullVideoProgressAt(600), 1);
  assert.equal(agentSkillFullVideoProgressAt(Number.NaN), 0);
  assert.equal(agentSkillFullVideoProgressPixelsAt(300), 270);
  assert.equal(agentSkillFullVideoProgressPixelsAt(600), 540);
  assert.equal(agentSkillFullVideoProgressPixelsAt(300, Number.NaN), 0);
});

test("八个解释场景都有独立信息图，活动项贯穿整个镜头而非只在开场闪动", () => {
  assert.deepEqual(Object.keys(AGENT_SKILL_EXPLANATION_KINDS), [
    "S03", "S05", "S07", "S09", "S11", "S13", "S15", "S17"
  ]);
  assert.equal(new Set(Object.values(AGENT_SKILL_EXPLANATION_KINDS)).size, 8);
  assert.equal(activeDiagramItemIndex(0, 340, 4), 0);
  assert.equal(activeDiagramItemIndex(170, 340, 4), 2);
  assert.equal(activeDiagramItemIndex(339, 340, 4), 3);
});

test("证据素材按受控窗口完整展示五张卡片，同时裁掉素材内角标和来源栏", () => {
  const geometry = agentSkillEvidenceViewportGeometry();
  assert.equal(AGENT_SKILL_EVIDENCE_SOURCE.width, 1080);
  assert.equal(AGENT_SKILL_EVIDENCE_SOURCE.height, 1920);
  assert.equal(geometry.viewportWidth, 484);
  assert.equal(geometry.visibleSourceTop, 150);
  assert.equal(geometry.visibleSourceBottom, 1650);
  assert.ok(geometry.viewportHeight > 670 && geometry.viewportHeight < 674);
  assert.ok(geometry.imageOffsetY > 67 && geometry.imageOffsetY < 68);
  assert.ok(geometry.visibleSourceTop > 136, "素材内 AGENT SKILL 角标应位于窗口上方");
  assert.ok(geometry.visibleSourceBottom >= 1610, "第五张卡片底部必须完整进入窗口");
  assert.ok(geometry.visibleSourceBottom < 1718, "素材内来源说明应位于窗口下方");
});

test("完整成片只对 Agent Skill Episode 启用 v014 视觉迁移且保留通用预览", async () => {
  const [preview, fullVideo] = await Promise.all([
    readFile(resolve(studioRoot, "src", "video", "episode-preview.jsx"), "utf8"),
    readFile(resolve(studioRoot, "src", "video", "agent-skill-full-video.jsx"), "utf8")
  ]);
  assert.match(preview, /episode\.id === "agent-skill-20260806"/u);
  assert.match(preview, /<AgentSkillFullVideo episode=\{episode\} \/>/u);
  assert.match(preview, /<GenericEpisodePreview episode=\{episode\} \/>/u);
  for (const componentName of [
    "RepeatVsSkillDiagram",
    "SkillDirectoryDiagram",
    "LifecycleComparisonDiagram",
    "ProgressiveLoadingDiagram",
    "SkillToolMcpDiagram",
    "DecisionCriteriaDiagram",
    "GovernanceLoopDiagram",
    "LaunchChecklistDiagram"
  ]) {
    assert.match(fullVideo, new RegExp(`function ${componentName}\\b`, "u"));
  }
});

test("完整成片采用无黑底字幕、平直时长进度条，并移除顶部条、角标、来源行与右侧序号", async () => {
  const fullVideo = await readFile(
    resolve(studioRoot, "src", "video", "agent-skill-full-video.jsx"),
    "utf8"
  );
  const progressStart = fullVideo.indexOf("function FullVideoChapterProgress");
  const progressEnd = fullVideo.indexOf("export function AgentSkillFullVideo", progressStart);
  assert.ok(progressStart > 0 && progressEnd > progressStart);
  const progress = fullVideo.slice(progressStart, progressEnd);
  assert.match(fullVideo, /variant="outline"/u);
  assert.match(fullVideo, /bottom=\{82\}/u);
  assert.match(fullVideo, /horizontalInset=\{8\}/u);
  assert.match(fullVideo, /fontSize=\{20\}/u);
  assert.doesNotMatch(fullVideo, /AGENT SKILL · AI CONCEPT STUDIO/u);
  assert.doesNotMatch(fullVideo, /function SourceLabel\b|来源：/u);
  assert.match(progress, /agentSkillFullVideoProgressPixelsAt\(currentSecond\)/u);
  assert.match(progress, /gridTemplateColumns:\s*FULL_VIDEO_CHAPTER_GRID/u);
  assert.match(progress, /left:\s*0/u);
  assert.match(progress, /right:\s*0/u);
  assert.match(progress, /bottom:\s*0/u);
  assert.match(progress, /height:\s*36/u);
  assert.doesNotMatch(progress, /borderRadius|backdropFilter|WebkitBackdropFilter/u);
  assert.doesNotMatch(progress, /linear-gradient|radial-gradient/u);
  assert.doesNotMatch(fullVideo, /ProgressStrip|sceneIndex \+ 1|padStart/u);
});

test("同级内容统一使用白底扁平卡片，证据窗口不再 cover 或放大裁切", async () => {
  const fullVideo = await readFile(
    resolve(studioRoot, "src", "video", "agent-skill-full-video.jsx"),
    "utf8"
  );
  const cardStart = fullVideo.indexOf("function DiagramCard");
  const cardEnd = fullVideo.indexOf("function AnimatedList", cardStart);
  const evidenceStart = fullVideo.indexOf("function EvidenceScene");
  const evidenceEnd = fullVideo.indexOf("function StatementScene", evidenceStart);
  assert.ok(cardStart > 0 && cardEnd > cardStart);
  assert.ok(evidenceStart > 0 && evidenceEnd > evidenceStart);
  const card = fullVideo.slice(cardStart, cardEnd);
  const evidence = fullVideo.slice(evidenceStart, evidenceEnd);
  assert.match(fullVideo, /const flatPanel = \{/u);
  assert.match(fullVideo, /background: "#FFFFFF"/u);
  assert.match(card, /\.\.\.flatPanel/u);
  assert.doesNotMatch(card, /active|accent/u);
  assert.match(evidence, /agentSkillEvidenceViewportGeometry\(\)/u);
  assert.match(evidence, /translateY\(-\$\{geometry\.imageOffsetY\}px\)/u);
  assert.doesNotMatch(evidence, /objectFit|objectPosition|scale\(/u);
  assert.doesNotMatch(fullVideo, /glassPanel|backdropFilter|WebkitBackdropFilter/u);
});

test("完整候选渲染与抽帧脚本明确使用本地代码路径，不包含付费或生成式调用", async () => {
  const stills = await readFile(
    resolve(studioRoot, "scripts", "render-agent-skill-full-video-stills.mjs"),
    "utf8"
  );
  assert.match(stills, /agent-skill-20260806/u);
  assert.match(stills, /ConceptPreview/u);
  assert.match(stills, /paidApiCalls:\s*0/u);
  assert.match(stills, /generatedImageCalls:\s*0/u);
  assert.match(stills, /generatedVideoCalls:\s*0/u);
  assert.match(stills, /`full-video-v\$\{String\(candidateVersion\)\.padStart\(3, "0"\)\}-design-qa`/u);
  assert.doesNotMatch(stills, /writeEpisode|fetch\(/u);
});
