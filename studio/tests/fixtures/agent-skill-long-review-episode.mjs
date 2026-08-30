const REQUIRED_SUBTITLE_SEGMENTS = Object.freeze([
  Object.freeze({
    start: 14.082,
    end: 28.163,
    text: "聊天框里，还是变成 Agent 可以反复调用的"
  }),
  Object.freeze({ start: 28.163, end: 30, text: "能力？" }),
  Object.freeze({
    start: 193.669,
    end: 199.297,
    text: "混淆，是因为 Skill 的核心说明仍然使用自然"
  }),
  Object.freeze({ start: 199.297, end: 200, text: "语言。" }),
  Object.freeze({
    start: 226.966,
    end: 232.593,
    text: "版本和回退，而不是依赖某个人记得那段“效果最好”"
  }),
  Object.freeze({ start: 232.593, end: 234, text: "的聊天文本。" }),
  Object.freeze({ start: 402.894, end: 404, text: "关键步骤" }),
  Object.freeze({
    start: 404,
    end: 410.911,
    text: "是否稳定、错误是否可检测、结果是否有共同验收标准。"
  }),
  Object.freeze({
    start: 430.26,
    end: 436.618,
    text: "什么材料、哪些步骤绝不能跳过，以及什么证据代表"
  }),
  Object.freeze({ start: 436.618, end: 438, text: "任务完成。" }),
  Object.freeze({ start: 438, end: 444, text: "进入新的治理镜头。" }),
  Object.freeze({ start: 588, end: 592, text: "完成标准、权限边界和版本回退。" })
]);

const requiredSegmentByBounds = new Map(
  REQUIRED_SUBTITLE_SEGMENTS.map((segment) => [
    `${segment.start}:${segment.end}`,
    segment
  ])
);

function subtitleBoundaries() {
  const boundaries = new Set([0, 600]);
  for (const segment of REQUIRED_SUBTITLE_SEGMENTS) {
    boundaries.add(segment.start);
    boundaries.add(segment.end);
  }

  for (let halfSecond = 1; boundaries.size < 108 && halfSecond < 1_200; halfSecond += 1) {
    const candidate = halfSecond / 2;
    const splitsRequiredSegment = REQUIRED_SUBTITLE_SEGMENTS.some(
      (segment) => candidate > segment.start && candidate < segment.end
    );
    if (!splitsRequiredSegment) boundaries.add(candidate);
  }

  if (boundaries.size !== 108) {
    throw new Error(`长片测试夹具必须生成 108 个字幕边界，实际为 ${boundaries.size}`);
  }
  return [...boundaries].sort((left, right) => left - right);
}

function createSubtitles() {
  const boundaries = subtitleBoundaries();
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const required = requiredSegmentByBounds.get(`${start}:${end}`);
    return {
      start,
      end,
      text: required?.text ?? `连续测试字幕 ${String(index + 1).padStart(3, "0")}`
    };
  });
}

export function createAgentSkillLongReviewEpisodeFixture(sceneSpecs) {
  if (!Array.isArray(sceneSpecs) || sceneSpecs.length !== 18) {
    throw new TypeError("长片测试夹具需要 18 个场景规范");
  }
  return {
    id: "agent-skill-20260806",
    scenes: sceneSpecs.map((scene) => ({
      id: scene.id,
      start: scene.startSecond,
      end: scene.endSecond
    })),
    subtitles: createSubtitles()
  };
}
