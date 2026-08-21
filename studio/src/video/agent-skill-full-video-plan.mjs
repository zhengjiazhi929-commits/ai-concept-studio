export const AGENT_SKILL_FULL_VIDEO_DURATION_SECONDS = 600;
export const AGENT_SKILL_FULL_VIDEO_PROGRESS_WIDTH = 540;

export const AGENT_SKILL_EVIDENCE_SOURCE = Object.freeze({
  width: 1080,
  height: 1920,
  contentTop: 150,
  contentBottom: 1650,
  viewportWidth: 484
});

// The opening and closing scenes belong to their adjacent editorial chapters.
// This keeps the labels readable while every segment still reflects real timeline time.
export const AGENT_SKILL_FULL_VIDEO_CHAPTERS = Object.freeze([
  { id: "prompt", label: "Prompt", start: 0, end: 98 },
  { id: "definition", label: "定义", start: 98, end: 166 },
  { id: "comparison", label: "对比", start: 166, end: 234 },
  { id: "loading", label: "加载", start: 234, end: 302 },
  { id: "division", label: "分工", start: 302, end: 370 },
  { id: "decision", label: "判断", start: 370, end: 438 },
  { id: "governance", label: "治理", start: 438, end: 506 },
  { id: "product", label: "产品", start: 506, end: 600 }
]);

export const AGENT_SKILL_FULL_VIDEO_CHAPTER_WEIGHTS = Object.freeze(
  AGENT_SKILL_FULL_VIDEO_CHAPTERS.map((chapter) => chapter.end - chapter.start)
);

export const AGENT_SKILL_EXPLANATION_KINDS = Object.freeze({
  S03: "repeat-vs-skill",
  S05: "skill-directory",
  S07: "lifecycle-comparison",
  S09: "progressive-loading",
  S11: "skill-tool-mcp",
  S13: "decision-criteria",
  S15: "governance-loop",
  S17: "launch-checklist"
});

export function agentSkillFullVideoChapterAt(second) {
  return AGENT_SKILL_FULL_VIDEO_CHAPTERS.find(
    (chapter) => second >= chapter.start && second < chapter.end
  ) ?? AGENT_SKILL_FULL_VIDEO_CHAPTERS.at(-1);
}

export function agentSkillFullVideoProgressAt(second) {
  if (!Number.isFinite(second)) return 0;
  return Math.min(1, Math.max(0, second / AGENT_SKILL_FULL_VIDEO_DURATION_SECONDS));
}

export function agentSkillFullVideoProgressPixelsAt(
  second,
  width = AGENT_SKILL_FULL_VIDEO_PROGRESS_WIDTH
) {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.round(agentSkillFullVideoProgressAt(second) * width);
}

export function agentSkillEvidenceViewportGeometry(
  viewportWidth = AGENT_SKILL_EVIDENCE_SOURCE.viewportWidth
) {
  const safeWidth = Number.isFinite(viewportWidth) && viewportWidth > 0
    ? viewportWidth
    : AGENT_SKILL_EVIDENCE_SOURCE.viewportWidth;
  const scale = safeWidth / AGENT_SKILL_EVIDENCE_SOURCE.width;
  return Object.freeze({
    scale,
    viewportWidth: safeWidth,
    viewportHeight:
      (AGENT_SKILL_EVIDENCE_SOURCE.contentBottom - AGENT_SKILL_EVIDENCE_SOURCE.contentTop) * scale,
    imageHeight: AGENT_SKILL_EVIDENCE_SOURCE.height * scale,
    imageOffsetY: AGENT_SKILL_EVIDENCE_SOURCE.contentTop * scale,
    visibleSourceTop: AGENT_SKILL_EVIDENCE_SOURCE.contentTop,
    visibleSourceBottom: AGENT_SKILL_EVIDENCE_SOURCE.contentBottom
  });
}

export function activeDiagramItemIndex(localFrame, durationInFrames, itemCount) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return 0;
  if (!Number.isFinite(localFrame) || !Number.isFinite(durationInFrames) || durationInFrames <= 0) {
    return 0;
  }
  const progress = Math.min(0.999999, Math.max(0, localFrame / durationInFrames));
  return Math.min(itemCount - 1, Math.floor(progress * itemCount));
}
