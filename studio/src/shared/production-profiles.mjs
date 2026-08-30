export const DEFAULT_PRODUCTION_PROFILE_ID = "long-form-explainer-v1";
export const SHORT_EXPLAINER_PROFILE_ID = "short-explainer-60s-v1";
export const GOLDEN_M1_PROFILE_ID = "m1-golden-36s-v1";

const PROFILES = Object.freeze({
  [DEFAULT_PRODUCTION_PROFILE_ID]: Object.freeze({
    id: DEFAULT_PRODUCTION_PROFILE_ID,
    label: "8–12 分钟概念长片",
    targetDurationSeconds: Object.freeze({ minimum: 480, maximum: 720 }),
    scriptSections: Object.freeze({ minimum: 6, maximum: 12 }),
    storyboardScenes: Object.freeze({ minimum: 12, maximum: 24 }),
    sceneDurationSeconds: Object.freeze({ minimum: 12, maximum: 60 }),
    scriptInstruction:
      "写成 8 到 12 分钟、以 16:9 母版为主并可重构为 9:16 的结构化脚本草稿",
    storyboardInstruction:
      "转换成连续的 8 到 12 分钟 16:9 母版分镜；每个场景必须保留可独立重排为 9:16 的语义对象与关系，禁止依赖中央裁切",
    maximumScriptTokens: 6000,
    maximumStoryboardTokens: 6000
  }),
  [SHORT_EXPLAINER_PROFILE_ID]: Object.freeze({
    id: SHORT_EXPLAINER_PROFILE_ID,
    label: "60 秒派生概念样片",
    targetDurationSeconds: Object.freeze({ minimum: 60, maximum: 60 }),
    scriptSections: Object.freeze({ minimum: 2, maximum: 4 }),
    storyboardScenes: Object.freeze({ minimum: 6, maximum: 10 }),
    sceneDurationSeconds: Object.freeze({ minimum: 4, maximum: 15 }),
    scriptInstruction:
      "把派生信息中的已批准脚本段落改编为准确的 60 秒竖屏讲解；只能压缩、重排或澄清已批准内容，不得为了视觉风格发明新比喻、事实或概念关系",
    storyboardInstruction:
      "把已批准的 60 秒脚本转换为 6 到 10 个连续竖屏分镜；优先使用结构图、关系动画和过程演示，不得用未经脚本批准的比喻改变原意",
    maximumScriptTokens: 2400,
    maximumStoryboardTokens: 3600
  }),
  [GOLDEN_M1_PROFILE_ID]: Object.freeze({
    id: GOLDEN_M1_PROFILE_ID,
    label: "36 秒 M1 技术闭环样片",
    targetDurationSeconds: Object.freeze({ minimum: 36, maximum: 36 }),
    scriptSections: Object.freeze({ minimum: 6, maximum: 6 }),
    storyboardScenes: Object.freeze({ minimum: 6, maximum: 6 }),
    sceneDurationSeconds: Object.freeze({ minimum: 4, maximum: 7 }),
    scriptInstruction:
      "把固定 Agentic Coding 证据压缩为 36 秒、六段、逐段绑定证据的本地 M1 旁白，不新增事实",
    storyboardInstruction:
      "把获批的 36 秒六段旁白绑定到六个连续竖屏场景，物理素材文件留到素材 Gate 审批",
    maximumScriptTokens: 1800,
    maximumStoryboardTokens: 2400
  })
});

export const PRODUCTION_PROFILE_IDS = new Set(Object.keys(PROFILES));

export function productionProfileForEpisode(episode = {}) {
  const id = episode.productionProfile?.id ?? DEFAULT_PRODUCTION_PROFILE_ID;
  const profile = PROFILES[id];
  if (!profile) throw new Error(`未知生产规格：${id}`);
  return profile;
}

export function validateProductionProfile(value) {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["productionProfile must be an object"];
  }
  if (!PRODUCTION_PROFILE_IDS.has(value.id)) {
    return [`unknown production profile: ${String(value.id ?? "missing")}`];
  }
  const profile = PROFILES[value.id];
  if (
    !Number.isInteger(value.targetDurationSeconds) ||
    value.targetDurationSeconds < profile.targetDurationSeconds.minimum ||
    value.targetDurationSeconds > profile.targetDurationSeconds.maximum
  ) {
    return [
      `productionProfile target duration must be ${profile.targetDurationSeconds.minimum}` +
        (profile.targetDurationSeconds.minimum === profile.targetDurationSeconds.maximum
          ? ""
          : `–${profile.targetDurationSeconds.maximum}`)
    ];
  }
  return [];
}

export function targetDurationForEpisode(episode, requestedDuration) {
  const profile = productionProfileForEpisode(episode);
  const requested = Number(requestedDuration);
  if (!Number.isFinite(requested)) return profile.targetDurationSeconds.minimum;
  return Math.max(
    profile.targetDurationSeconds.minimum,
    Math.min(profile.targetDurationSeconds.maximum, requested)
  );
}
