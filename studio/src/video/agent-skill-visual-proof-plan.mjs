export const VISUAL_PROOF_FPS = 30;
export const VISUAL_PROOF_DURATION_SECONDS = 60;

export const VISUAL_PROOF_SHOTS = Object.freeze([
  { id: "hook", chapter: "判断", start: 0, end: 8, kind: "counter-motion" },
  { id: "prompt-repeat", chapter: "重复", start: 8, end: 18, kind: "multi-chat" },
  { id: "prompt-to-skill", chapter: "整理", start: 18, end: 30, kind: "shared-element-morph" },
  { id: "knowledge-merge", chapter: "合并", start: 30, end: 42, kind: "node-flow" },
  { id: "skill-discovery", chapter: "调用", start: 42, end: 52, kind: "agent-search" },
  { id: "team-example", chapter: "共建", start: 52, end: 60, kind: "collaboration-flow" }
]);

export const VISUAL_PROOF_CHAPTER_WEIGHTS = Object.freeze(
  VISUAL_PROOF_SHOTS.map((shot) => shot.end - shot.start)
);

export const VISUAL_PROOF_SUBTITLES = Object.freeze([
  { start: 0, end: 14.082, text: "如果一套提示词每周都要复制三遍，它应该继续留在" },
  { start: 14.082, end: 28.163, text: "聊天框里，还是变成 Agent 可以反复调用的" },
  { start: 28.163, end: 30, text: "能力？" },
  { start: 30, end: 36.159, text: "当团队反复把同一套背景、步骤和注意事项贴进对话时，" },
  { start: 36.159, end: 41.826, text: "问题已经不只是提示词写得够不够长，而是过程知识" },
  { start: 41.826, end: 47, text: "没有形成可发现、可复用、可维护的工作单元。" },
  { start: 47, end: 52.667, text: "Agent Skill 正是在这一层出现。举个" },
  { start: 52.667, end: 58.58, text: "具体场景：内容团队要做一次竞品分析，第一位同事写" },
  { start: 58.58, end: 60, text: "出二十条步骤，第二位同事补上数据口径，第三位" }
]);

export function visualProofShotAt(second) {
  return VISUAL_PROOF_SHOTS.find((shot) => second >= shot.start && second < shot.end)
    ?? VISUAL_PROOF_SHOTS.at(-1);
}

export function visualProofSubtitleAt(second) {
  return VISUAL_PROOF_SUBTITLES.find(
    (subtitle) => second >= subtitle.start && second < subtitle.end
  )?.text ?? "";
}

export function visualProofProgressAt(second) {
  if (!Number.isFinite(second)) return 0;
  return Math.min(1, Math.max(0, second / VISUAL_PROOF_DURATION_SECONDS));
}

export function nextVisualProofVersion(files) {
  const highest = files.reduce((current, file) => {
    const match = /^visual-proof-v(\d{3})(?:\.mp4|\.rendering\.mp4|-manifest\.json|-stills)$/u.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return highest + 1;
}
