export const AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS = 600;
export const AGENT_SKILL_LONG_REVIEW_FPS = 30;
export const AGENT_SKILL_LONG_REVIEW_FRAME_COUNT =
  AGENT_SKILL_LONG_REVIEW_DURATION_SECONDS * AGENT_SKILL_LONG_REVIEW_FPS;
export const AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES = 9;
export const AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES = 18;
export const AGENT_SKILL_LONG_REVIEW_EDGE_DELAY_FRAMES = 3;
export const AGENT_SKILL_LONG_REVIEW_EDGE_DRAW_FRAMES = 14;
export const AGENT_SKILL_LONG_REVIEW_ARROW_FADE_FRAMES = 4;

const frameAt = (second) => Math.round(second * AGENT_SKILL_LONG_REVIEW_FPS);
const freezeList = (items) => Object.freeze(items.map((item) => Object.freeze(item)));

export const AGENT_SKILL_LONG_REVIEW_CHAPTERS = freezeList([
  { id: "prompt", label: "Prompt", startSecond: 0, endSecond: 98, startFrame: 0, endFrame: frameAt(98) },
  { id: "definition", label: "定义", startSecond: 98, endSecond: 166, startFrame: frameAt(98), endFrame: frameAt(166) },
  { id: "comparison", label: "对比", startSecond: 166, endSecond: 234, startFrame: frameAt(166), endFrame: frameAt(234) },
  { id: "loading", label: "加载", startSecond: 234, endSecond: 302, startFrame: frameAt(234), endFrame: frameAt(302) },
  { id: "division", label: "分工", startSecond: 302, endSecond: 370, startFrame: frameAt(302), endFrame: frameAt(370) },
  { id: "decision", label: "判断", startSecond: 370, endSecond: 438, startFrame: frameAt(370), endFrame: frameAt(438) },
  { id: "governance", label: "治理", startSecond: 438, endSecond: 506, startFrame: frameAt(438), endFrame: frameAt(506) },
  { id: "product", label: "产品", startSecond: 506, endSecond: 600, startFrame: frameAt(506), endFrame: frameAt(600) }
]);

const sceneTimes = Object.freeze([
  ["S01", 0, 30], ["S02", 30, 64], ["S03", 64, 98], ["S04", 98, 132],
  ["S05", 132, 166], ["S06", 166, 200], ["S07", 200, 234], ["S08", 234, 268],
  ["S09", 268, 302], ["S10", 302, 336], ["S11", 336, 370], ["S12", 370, 404],
  ["S13", 404, 438], ["S14", 438, 472], ["S15", 472, 506], ["S16", 506, 540],
  ["S17", 540, 574], ["S18", 574, 600]
]);

function chapterAtSecond(second) {
  return AGENT_SKILL_LONG_REVIEW_CHAPTERS.find(
    (chapter) => second >= chapter.startSecond && second < chapter.endSecond
  ) ?? AGENT_SKILL_LONG_REVIEW_CHAPTERS.at(-1);
}

function node(id, x, y, width, height, label, detail, accent = "mint", options = {}) {
  return Object.freeze({ id, x, y, width, height, label, detail, accent, ...options });
}

function edge(id, from, to, path, accent = "mint", options = {}) {
  return Object.freeze({ id, from, to, path, accent, ...options });
}

function stage(id, atSecond, label, nodeIds = [], edgeIds = [], options = {}) {
  return Object.freeze({
    id,
    atSecond,
    startFrame: frameAt(atSecond),
    label,
    nodeIds: Object.freeze([...nodeIds]),
    edgeIds: Object.freeze([...edgeIds]),
    activeNodeIds: Object.freeze([...(options.activeNodeIds ?? nodeIds)]),
    activeEdgeIds: Object.freeze([...(options.activeEdgeIds ?? edgeIds)])
  });
}

function sceneSpec({
  id,
  kind,
  title,
  deck,
  material = null,
  nodes = [],
  edges = [],
  groups = [],
  stages
}) {
  const timing = sceneTimes.find(([sceneId]) => sceneId === id);
  if (!timing) throw new Error(`缺少 ${id} 的正式时间范围`);
  const [, startSecond, endSecond] = timing;
  const lastStage = stages.at(-1);
  const holdStartFrame = Math.min(
    frameAt(endSecond) - 1,
    lastStage.startFrame + Math.max(
      AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES,
      AGENT_SKILL_LONG_REVIEW_EDGE_DELAY_FRAMES +
        AGENT_SKILL_LONG_REVIEW_EDGE_DRAW_FRAMES +
        AGENT_SKILL_LONG_REVIEW_ARROW_FADE_FRAMES
    )
  );
  const chapter = chapterAtSecond(startSecond);
  return Object.freeze({
    id,
    kind,
    title,
    deck,
    material,
    chapterId: chapter.id,
    chapterLabel: chapter.label,
    startSecond,
    endSecond,
    startFrame: frameAt(startSecond),
    endFrame: frameAt(endSecond),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    groups: Object.freeze(groups.map((group) => Object.freeze({ ...group, nodeIds: Object.freeze([...group.nodeIds]) }))),
    stages: Object.freeze(stages),
    stageCount: stages.length,
    holdStartFrame
  });
}

const material = (version) =>
  `episodes/agent-skill-20260806/materials/material-v${String(version).padStart(3, "0")}.png`;

export const AGENT_SKILL_LONG_REVIEW_SCENE_SPECS = Object.freeze([
  sceneSpec({
    id: "S01", kind: "title", title: "Agent Skill 到底是什么？", deck: "从重复复制到可维护的能力单元",
    nodes: [
      node("prompt-a", 18, 126, 124, 82, "提示词 A", "背景 + 步骤", "blue"),
      node("prompt-b", 18, 238, 124, 82, "提示词 B", "数据口径", "purple"),
      node("prompt-c", 18, 350, 124, 82, "提示词 C", "交付格式", "orange"),
      node("skill-unit", 320, 224, 142, 142, "Agent Skill", "触发 · 执行\n验收 · 版本", "mint")
    ],
    edges: [
      edge("a-to-skill", "prompt-a", "skill-unit", "M 142 167 H 226 V 268 H 320", "blue"),
      edge("b-to-skill", "prompt-b", "skill-unit", "M 142 279 H 320", "purple"),
      edge("c-to-skill", "prompt-c", "skill-unit", "M 142 391 H 226 V 322 H 320", "orange")
    ],
    stages: [
      stage("repeat", 0, "同一套方法被反复复制", ["prompt-a"]),
      stage("fragment", 14.082, "经验散落为不同版本", ["prompt-b", "prompt-c"]),
      stage("package", 28.163, "把方法收束成可发现、可维护的 Skill", ["skill-unit"], ["a-to-skill", "b-to-skill", "c-to-skill"])
    ]
  }),
  sceneSpec({
    id: "S02", kind: "native-evidence", title: "为什么长 Prompt 不是答案", deck: "批准证据转译：经验如何在协作里分叉", material: material(1),
    nodes: [
      node("task", 154, 12, 172, 70, "竞品分析", "同一个团队任务", "blue"),
      node("base", 142, 116, 196, 78, "聊天中的长 Prompt", "背景 · 步骤 · 注意事项", "purple"),
      node("version-a", 8, 254, 140, 86, "同事 A", "继续补执行步骤", "blue"),
      node("version-b", 170, 254, 140, 86, "同事 B", "继续补数据口径", "purple"),
      node("version-c", 332, 254, 140, 86, "同事 C", "继续补交付格式", "orange"),
      node("drift", 106, 430, 268, 88, "版本持续分叉", "不可发现 · 不可复用 · 不可维护", "orange", { dashed: true })
    ],
    edges: [
      edge("task-base", "task", "base", "M 240 82 V 116", "blue"),
      edge("base-a", "base", "version-a", "M 184 194 V 224 H 78 V 254", "blue"),
      edge("base-b", "base", "version-b", "M 240 194 V 254", "purple"),
      edge("base-c", "base", "version-c", "M 296 194 V 224 H 402 V 254", "orange"),
      edge("a-drift", "version-a", "drift", "M 78 340 V 386 H 178 V 430", "orange", { relation: "warning" }),
      edge("b-drift", "version-b", "drift", "M 240 340 V 430", "orange", { relation: "warning" }),
      edge("c-drift", "version-c", "drift", "M 402 340 V 386 H 302 V 430", "orange", { relation: "warning" })
    ],
    stages: [
      stage("copied", 30, "背景、步骤与注意事项被反复粘贴", ["task", "base"], ["task-base"]),
      stage("longer", 36.159, "文字变长，却没有形成过程单元", [], [], { activeNodeIds: ["base"] }),
      stage("missing-boundary", 41.826, "缺少可发现、可复用、可维护的边界", ["drift"], [], { activeNodeIds: ["drift"] }),
      stage("method-gap", 47, "真正缺少的是可以沉淀的方法边界", [], [], { activeNodeIds: ["base", "drift"] }),
      stage("collaboration", 52.667, "多人协作开始产生不同版本", ["version-a"], ["base-a"]),
      stage("fragmented", 58.58, "步骤、口径和格式最终分散在三份版本里", ["version-b", "version-c"], ["base-b", "base-c", "a-drift", "b-drift", "c-drift"])
    ]
  }),
  sceneSpec({
    id: "S03", kind: "diagram", title: "从散落版本到一个 Skill 包", deck: "触发、步骤、材料、验收被纳入同一能力边界",
    nodes: [
      node("chat", 12, 30, 138, 82, "聊天版本", "没人确定复制哪版", "orange", { dashed: true }),
      node("trigger", 190, 18, 132, 76, "触发条件", "何时命中", "blue"),
      node("steps", 190, 124, 132, 76, "执行步骤", "顺序与不可跳过项", "purple"),
      node("refs", 190, 230, 132, 76, "参考材料", "口径与事实来源", "blue"),
      node("accept", 190, 336, 132, 76, "验收方式", "什么算完成", "orange"),
      node("package", 348, 170, 120, 150, "Skill 包", "可发现\n可复用\n可维护", "mint")
    ],
    edges: [
      edge("chat-trigger", "chat", "trigger", "M 150 71 H 170 V 56 H 190", "blue"),
      edge("trigger-steps", "trigger", "steps", "M 256 94 V 124", "purple"),
      edge("steps-refs", "steps", "refs", "M 256 200 V 230", "blue"),
      edge("refs-accept", "refs", "accept", "M 256 306 V 336", "orange"),
      edge("accept-package", "accept", "package", "M 322 374 H 336 V 245 H 348", "mint")
    ],
    stages: [
      stage("versions", 64, "经验先散落在聊天版本里", ["chat"]),
      stage("trigger", 69.829, "先明确何时触发", ["trigger"], ["chat-trigger"]),
      stage("steps", 75.657, "再固定执行步骤", ["steps"], ["trigger-steps"]),
      stage("references", 81.243, "把事实口径放入参考材料", ["refs"], ["steps-refs"]),
      stage("acceptance", 86.586, "用验收方式定义完成", ["accept"], ["refs-accept"]),
      stage("package", 92.171, "最终成为可维护的 Skill 包", ["package"], ["accept-package"])
    ]
  }),
  sceneSpec({
    id: "S04", kind: "native-evidence", title: "Agent Skill 的准确定义", deck: "批准证据转译：可发现、按需加载、可组合", material: material(1),
    nodes: [
      node("discoverable", 8, 30, 140, 78, "可发现", "名称与描述", "blue"),
      node("on-demand", 170, 30, 140, 78, "按需加载", "命中后读取", "orange"),
      node("composable", 332, 30, 140, 78, "可组合", "主说明与资源", "purple"),
      node("process-pack", 140, 188, 200, 100, "过程知识包", "SKILL.md + 可选资源", "mint"),
      node("method", 64, 382, 160, 82, "扩展做事方法", "改变任务流程", "mint"),
      node("weights", 256, 382, 160, 82, "模型参数不变", "不是重新训练", "orange", { dashed: true }),
      node("description", 146, 500, 188, 70, "描述质量", "决定何时适用", "blue")
    ],
    edges: [
      edge("discover-pack", "discoverable", "process-pack", "M 78 108 V 150 H 190 V 188", "blue"),
      edge("demand-pack", "on-demand", "process-pack", "M 240 108 V 188", "orange"),
      edge("compose-pack", "composable", "process-pack", "M 402 108 V 150 H 290 V 188", "purple"),
      edge("pack-method", "process-pack", "method", "M 190 288 V 338 H 144 V 382", "mint"),
      edge("pack-weights", "process-pack", "weights", "M 290 288 V 338 H 336 V 382", "orange", { relation: "warning" }),
      edge("description-discover", "description", "discoverable", "M 146 535 H 38 V 108", "blue")
    ],
    stages: [
      stage("discover", 98, "Agent 先通过名称与描述发现过程知识", ["discoverable"]),
      stage("load", 104.09, "完整内容只在任务命中后加载", ["on-demand"]),
      stage("skill-md", 109.925, "SKILL.md 提供名称、描述和主说明", ["process-pack"], ["discover-pack", "demand-pack"]),
      stage("resources", 116.015, "scripts、references、assets 按需组合", ["composable"], ["compose-pack"]),
      stage("method", 121.851, "它扩展做事方法，而不是重新训练模型", ["method", "weights"], ["pack-method", "pack-weights"]),
      stage("description", 127.94, "描述必须让 Agent 判断何时适用", ["description"], ["description-discover"])
    ]
  }),
  sceneSpec({
    id: "S05", kind: "diagram", title: "Skill 是一个有边界的目录", deck: "主说明、脚本、参考和素材按职责展开",
    nodes: [
      node("root", 165, 20, 150, 74, "agent-skill/", "能力目录边界", "mint"),
      node("skill-md", 20, 150, 138, 86, "SKILL.md", "触发 · 步骤 · 边界", "blue"),
      node("scripts", 172, 150, 138, 86, "scripts/", "确定性动作", "orange"),
      node("references", 324, 150, 138, 86, "references/", "按需事实材料", "purple"),
      node("assets", 172, 286, 138, 86, "assets/", "复用视觉与模板", "mint"),
      node("prompt-only", 122, 430, 236, 86, "只有一段长文字", "没有触发、目录和完成标准，仍只是 Prompt", "orange", { dashed: true })
    ],
    edges: [
      edge("root-skill", "root", "skill-md", "M 240 94 V 120 H 89 V 150", "blue"),
      edge("root-scripts", "root", "scripts", "M 240 94 V 150", "orange"),
      edge("root-refs", "root", "references", "M 240 120 H 393 V 150", "purple"),
      edge("root-assets", "root", "assets", "M 240 94 V 286", "mint"),
      edge("boundary", "assets", "prompt-only", "M 240 372 V 430", "orange", { relation: "warning" })
    ],
    stages: [
      stage("root", 132, "先建立可发现的目录边界", ["root"]),
      stage("skill-md", 137.88, "命中后读取完整 SKILL.md", ["skill-md"], ["root-skill"]),
      stage("scripts", 143.759, "脚本只在需要执行时进入", ["scripts"], ["root-scripts"]),
      stage("references", 149.895, "参考资料按事实需要读取", ["references"], ["root-refs"]),
      stage("assets", 156.03, "素材与模板作为可复用资源", ["assets"], ["root-assets"]),
      stage("boundary", 162.165, "没有结构和完成标准的长文字仍不是 Skill", ["prompt-only"], ["boundary"])
    ]
  }),
  sceneSpec({
    id: "S06", kind: "native-evidence", title: "它为什么不只是 Prompt", deck: "批准证据转译：自然语言之外还有工程边界", material: material(1),
    nodes: [
      node("prompt", 18, 40, 196, 82, "自然语言说明", "可以包含 Prompt", "orange"),
      node("metadata", 266, 40, 196, 82, "触发元数据", "何时适用", "blue"),
      node("structure", 18, 170, 196, 82, "文件结构", "明确能力边界", "purple"),
      node("resources", 266, 170, 196, 82, "代码与资源", "按需进入任务", "mint"),
      node("skill", 144, 326, 192, 92, "Agent Skill", "可安装的能力单元", "mint"),
      node("affordance", 70, 478, 340, 68, "安装 · 分享 · 更新 · 审查", "工程生命周期", "blue")
    ],
    edges: [
      edge("prompt-skill", "prompt", "skill", "M 116 122 V 286 H 192 V 326", "orange"),
      edge("metadata-skill", "metadata", "skill", "M 364 122 V 286 H 288 V 326", "blue"),
      edge("structure-skill", "structure", "skill", "M 116 252 V 290 H 192 V 326", "purple"),
      edge("resources-skill", "resources", "skill", "M 364 252 V 290 H 288 V 326", "mint"),
      edge("skill-affordance", "skill", "affordance", "M 240 418 V 478", "blue")
    ],
    stages: [
      stage("prompt", 166, "Prompt 往往只服务一次交互", ["prompt"]),
      stage("metadata", 171.628, "Skill 还带触发元数据和文件结构", ["metadata", "structure"]),
      stage("resources", 177.021, "代码与资源进入可安装、可审查的边界", ["resources", "skill"], ["prompt-skill", "metadata-skill", "structure-skill", "resources-skill"]),
      stage("contains-prompt", 182.648, "Skill 可以包含 Prompt", [], [], { activeNodeIds: ["prompt", "skill"], activeEdgeIds: ["prompt-skill"] }),
      stage("not-longer", 188.276, "但 Skill 不等于更长的 Prompt", [], [], { activeNodeIds: ["prompt"], activeEdgeIds: [] }),
      stage("natural-language", 193.669, "相似之处只是核心说明仍用自然语言", ["affordance"], ["skill-affordance"], { activeNodeIds: ["prompt", "metadata", "structure", "resources"] }),
      stage("lifecycle", 199.297, "真正差异在安装、分享、更新和审查的生命周期", [], [], { activeNodeIds: ["skill", "affordance"], activeEdgeIds: ["skill-affordance"] })
    ]
  }),
  sceneSpec({
    id: "S07", kind: "diagram", title: "文字相似，生命周期不同", deck: "一次性输入与可安装能力逐项对照",
    nodes: [
      node("prompt", 18, 20, 204, 70, "Prompt", "一次性输入", "orange"),
      node("skill", 258, 20, 204, 70, "Agent Skill", "可安装能力", "mint"),
      node("paste", 18, 128, 204, 74, "临时粘贴", "每次重新复制", "orange"),
      node("version", 258, 128, 204, 74, "版本管理", "谁在用哪一版", "mint"),
      node("memory", 18, 238, 204, 74, "依赖记忆", "旧版难追踪", "orange"),
      node("govern", 258, 238, 204, 74, "权限与依赖", "资源与操作可审查", "purple"),
      node("fragile", 18, 348, 204, 74, "效果最好那段话", "无法稳定回归", "orange", { dashed: true }),
      node("regression", 258, 348, 204, 74, "评测与回退", "比较版本并恢复", "blue")
    ],
    edges: [
      edge("prompt-paste", "prompt", "paste", "M 120 90 V 128", "orange"),
      edge("skill-version", "skill", "version", "M 360 90 V 128", "mint"),
      edge("paste-memory", "paste", "memory", "M 120 202 V 238", "orange"),
      edge("version-govern", "version", "govern", "M 360 202 V 238", "purple"),
      edge("memory-fragile", "memory", "fragile", "M 120 312 V 348", "orange"),
      edge("govern-regression", "govern", "regression", "M 360 312 V 348", "blue")
    ],
    stages: [
      stage("heads", 200, "同样是自然语言，先看工程归属", ["prompt", "skill"]),
      stage("temporary", 205.159, "Prompt 常由人临时粘贴", ["paste"], ["prompt-paste"]),
      stage("versioned", 210.786, "Skill 作为文件进入版本管理", ["version"], ["skill-version"]),
      stage("memory", 216.179, "Prompt 的旧版往往只能靠记忆追踪", ["memory"], ["paste-memory"]),
      stage("governance", 221.572, "Skill 可以明确依赖与允许的操作", ["govern"], ["version-govern"]),
      stage("regression", 226.966, "代表性任务支持回归、比较与回退", ["fragile", "regression"], ["memory-fragile", "govern-regression"]),
      stage("conclusion", 232.593, "差异不在文字长短，而在完整生命周期", [], [], { activeNodeIds: ["skill", "version", "govern", "regression"] })
    ]
  }),
  sceneSpec({
    id: "S08", kind: "native-evidence", title: "渐进式加载怎样工作", deck: "批准证据转译：上下文只装当前需要的层", material: material(2),
    nodes: [
      node("metadata-slot", 12, 32, 140, 84, "名称 + 描述", "全量轻量索引", "blue"),
      node("instruction-slot", 170, 32, 140, 84, "SKILL.md", "仅命中的 Skill", "purple"),
      node("resource-slot", 328, 32, 140, 84, "必要资源", "仅当前步骤", "mint"),
      node("focus", 148, 198, 184, 84, "当前任务", "上下文焦点", "orange"),
      node("context-budget", 86, 356, 308, 100, "上下文预算", "只装当前任务需要的层", "mint"),
      node("parked", 126, 500, 228, 64, "其余材料未加载", "不占当前上下文", "orange", { dashed: true })
    ],
    edges: [
      edge("metadata-focus", "metadata-slot", "focus", "M 82 116 V 158 H 194 V 198", "blue"),
      edge("instruction-focus", "instruction-slot", "focus", "M 240 116 V 198", "purple"),
      edge("resource-focus", "resource-slot", "focus", "M 398 116 V 158 H 286 V 198", "mint"),
      edge("focus-budget", "focus", "context-budget", "M 240 282 V 356", "mint")
    ],
    stages: [
      stage("metadata", 234, "Agent 始终只看到所有 Skill 的名称与描述", ["metadata-slot"]),
      stage("route", 239.956, "少量元数据先完成任务路由", ["focus"], ["metadata-focus"]),
      stage("instruction", 245.912, "命中后才读取完整 SKILL.md", ["instruction-slot"], ["instruction-focus"]),
      stage("resources", 251.869, "脚本、参考和素材只在确实需要时加载", ["resource-slot"], ["resource-focus"]),
      stage("budget", 257.577, "专业细节被保留，但不会一次占满上下文", ["context-budget", "parked"], ["focus-budget"]),
      stage("description", 263.533, "描述写法决定误触发和漏召回", [], [], { activeNodeIds: ["metadata-slot", "focus", "context-budget"] })
    ]
  }),
  sceneSpec({
    id: "S09", kind: "diagram", title: "先路由，再加载，再执行", deck: "有限上下文只进入当前步骤真正需要的知识",
    nodes: [
      node("metadata", 166, 12, 148, 72, "名称 + 描述", "L1 · 始终可见", "blue"),
      node("router", 166, 118, 148, 72, "任务路由", "匹配当前意图", "orange"),
      node("skill-md", 166, 224, 148, 72, "SKILL.md", "L2 · 命中后", "purple"),
      node("resources", 166, 330, 148, 82, "按需资源", "scripts · references · assets", "mint"),
      node("wide", 8, 118, 126, 82, "描述过宽", "误触发", "orange", { dashed: true }),
      node("narrow", 346, 118, 126, 82, "描述过窄", "漏召回", "orange", { dashed: true }),
      node("context", 148, 466, 184, 76, "当前任务上下文", "只保留需要的知识", "mint")
    ],
    edges: [
      edge("meta-router", "metadata", "router", "M 240 84 V 118", "blue"),
      edge("wide-router", "wide", "router", "M 134 159 H 166", "orange", { relation: "warning" }),
      edge("narrow-router", "narrow", "router", "M 346 159 H 314", "orange", { relation: "warning" }),
      edge("router-skill", "router", "skill-md", "M 240 190 V 224", "purple"),
      edge("skill-resources", "skill-md", "resources", "M 240 296 V 330", "mint"),
      edge("resources-context", "resources", "context", "M 240 412 V 466", "mint")
    ],
    stages: [
      stage("metadata", 268, "少量名称和描述先进入视野", ["metadata"]),
      stage("router", 274.25, "Agent 用元数据完成路由", ["router"], ["meta-router"]),
      stage("description-risk", 280.25, "描述过宽会误触发，过窄会漏召回", ["wide", "narrow"], ["wide-router", "narrow-router"]),
      stage("instruction", 286.25, "命中后才加载主要说明", ["skill-md"], ["router-skill"]),
      stage("resources", 292.25, "低频细节继续拆到独立资源", ["resources"], ["skill-resources"]),
      stage("context", 297.75, "最终只让当前步骤需要的知识进入上下文", ["context"], ["resources-context"])
    ]
  }),
  sceneSpec({
    id: "S10", kind: "native-evidence", title: "Skill、Tool 与 MCP 的分工", deck: "批准证据转译：方法、动作与连接协议", material: material(3),
    nodes: [
      node("skill", 10, 24, 140, 88, "Skill", "怎样完成一类任务", "mint"),
      node("tool", 170, 24, 140, 88, "Tool", "执行一个动作", "blue"),
      node("mcp", 330, 24, 140, 88, "MCP", "暴露并连接能力", "purple"),
      node("agent", 170, 184, 140, 82, "Agent", "按方法作判断", "orange"),
      node("external", 330, 184, 140, 82, "外部系统", "prompts · resources\ntools", "purple"),
      node("combine", 120, 328, 240, 92, "可组合，不可互相替代", "三者解决不同层的问题", "mint"),
      node("weekly", 120, 488, 240, 70, "下一镜：同一周报任务", "把分工放回真实流程", "blue")
    ],
    edges: [
      edge("skill-agent", "skill", "agent", "M 80 112 V 150 H 220 V 184", "mint"),
      edge("agent-tool", "agent", "tool", "M 220 184 V 144 H 240 V 112", "blue"),
      edge("agent-mcp", "agent", "mcp", "M 310 225 H 330", "purple"),
      edge("mcp-external", "mcp", "external", "M 400 112 V 184", "purple"),
      edge("skill-combine", "skill", "combine", "M 80 112 V 304 H 170 V 328", "mint"),
      edge("tool-combine", "tool", "combine", "M 240 112 V 328", "blue"),
      edge("mcp-combine", "mcp", "combine", "M 400 112 V 304 H 310 V 328", "purple"),
      edge("combine-weekly", "combine", "weekly", "M 240 420 V 488", "blue")
    ],
    stages: [
      stage("skill", 302, "Skill 说明怎样完成一类任务", ["skill"]),
      stage("tool", 307.013, "Tool 提供一个可执行动作", ["tool"]),
      stage("mcp", 312.244, "MCP 标准化 prompts、resources 和 tools", ["mcp"]),
      stage("external", 317.038, "外部系统通过协议暴露和调用能力", ["external"], ["mcp-external"]),
      stage("orchestration", 321.833, "Skill 可以规定 Agent 何时调用 MCP Tool", ["agent"], ["skill-agent", "agent-tool", "agent-mcp"]),
      stage("layers", 326.846, "Skill 与 MCP 解决的不是同一层问题", ["combine"], ["skill-combine", "tool-combine", "mcp-combine"]),
      stage("weekly", 332.077, "把三者放进同一个周报任务才能看清分工", ["weekly"], ["combine-weekly"])
    ]
  }),
  sceneSpec({
    id: "S11", kind: "diagram", title: "同一个任务里的三层分工", deck: "Skill 规定方法，Tool 执行动作，MCP 连接外部能力",
    nodes: [
      node("user", 170, 8, 140, 68, "周报任务", "用户目标", "blue"),
      node("skill", 150, 108, 180, 78, "Skill / 方法", "核对指标 → 异常 → 结论", "mint"),
      node("agent", 150, 218, 180, 78, "Agent / 判断", "选择正确顺序与验收", "orange"),
      node("tool", 18, 350, 138, 82, "Tool / 动作", "查询 · 写入", "blue"),
      node("mcp", 324, 350, 138, 82, "MCP / 连接", "统一发现与调用", "purple"),
      node("external", 324, 468, 138, 76, "外部能力", "数据库 · 文档", "mint"),
      node("result", 18, 468, 138, 76, "可检查结果", "周报 + 证据", "orange")
    ],
    edges: [
      edge("user-skill", "user", "skill", "M 240 76 V 108", "blue"),
      edge("skill-agent", "skill", "agent", "M 240 186 V 218", "mint"),
      edge("agent-tool", "agent", "tool", "M 190 296 V 326 H 87 V 350", "blue"),
      edge("agent-mcp", "agent", "mcp", "M 290 296 V 326 H 393 V 350", "purple"),
      edge("mcp-external", "mcp", "external", "M 393 432 V 468", "mint"),
      edge("external-result", "external", "result", "M 324 506 H 156", "orange")
    ],
    groups: [
      { id: "method", x: 132, y: 92, width: 216, height: 220, nodeIds: ["skill", "agent"] },
      { id: "execution", x: 4, y: 334, width: 472, height: 228, nodeIds: ["tool", "mcp", "external", "result"] }
    ],
    stages: [
      stage("task", 336, "用户先提出一个周报任务", ["user"]),
      stage("method", 341.265, "Skill 固定指标、异常与结论结构", ["skill"], ["user-skill"]),
      stage("judgment", 346.529, "Agent 按方法判断下一步", ["agent"], ["skill-agent"]),
      stage("tool", 351.574, "Tool 执行数据库查询或文档写入", ["tool"], ["agent-tool"]),
      stage("mcp", 357.058, "MCP 让外部能力被统一发现和调用", ["mcp", "external"], ["agent-mcp", "mcp-external"]),
      stage("result", 362.103, "执行结果必须回到可检查的交付", ["result"], ["external-result"]),
      stage("boundary", 367.368, "只有 Tool 缺方法；只有 Skill 缺获准执行能力", [], [], { activeNodeIds: ["skill", "tool", "mcp", "result"], activeEdgeIds: ["skill-agent", "agent-tool", "agent-mcp"] })
    ]
  }),
  sceneSpec({
    id: "S12", kind: "native-evidence", title: "什么时候值得做成 Skill", deck: "批准证据转译：用真实任务寻找稳定重复区", material: material(4),
    nodes: [
      node("stable-rare", 18, 52, 204, 112, "稳定但少见", "先不固化", "blue"),
      node("candidate", 258, 52, 204, 112, "Skill 候选", "稳定 · 重复 · 可验收", "mint"),
      node("explore", 18, 206, 204, 112, "一次性探索", "目标仍在变化", "orange", { dashed: true }),
      node("repeat-unstable", 258, 206, 204, 112, "重复但不稳定", "继续观察", "orange", { dashed: true }),
      node("samples", 106, 390, 268, 86, "10–20 个真实任务", "验证输入、步骤与结果是否存在共性", "blue"),
      node("first-gate", 136, 510, 208, 64, "第一道门", "关键步骤是否稳定", "mint")
    ],
    edges: [
      edge("samples-stable", "samples", "stable-rare", "M 176 390 V 350 H 120 V 164", "blue"),
      edge("samples-candidate", "samples", "candidate", "M 304 390 V 350 H 360 V 164", "mint"),
      edge("samples-explore", "samples", "explore", "M 150 390 V 350 H 120 V 318", "orange", { relation: "warning" }),
      edge("samples-unstable", "samples", "repeat-unstable", "M 330 390 V 350 H 360 V 318", "orange", { relation: "warning" }),
      edge("samples-gate", "samples", "first-gate", "M 240 476 V 510", "mint")
    ],
    groups: [
      { id: "matrix", x: 6, y: 36, width: 468, height: 298, nodeIds: ["stable-rare", "candidate", "explore", "repeat-unstable"] }
    ],
    stages: [
      stage("candidate", 370, "稳定、重复、可验收且减少返工的流程更像 Skill", ["candidate"]),
      stage("changing", 376.634, "目标快速变化时先保留探索空间", ["explore"]),
      stage("acceptance", 383.268, "无法定义验收标准时不要急着固化", ["repeat-unstable", "stable-rare"]),
      stage("evaluate", 389.902, "先用代表性任务评测再扩大发布", ["samples"], ["samples-stable", "samples-candidate", "samples-explore", "samples-unstable"]),
      stage("samples", 396.537, "收集十到二十个真实任务观察共性", ["first-gate"], ["samples-gate"], { activeNodeIds: ["samples", "candidate"] }),
      stage("gate", 402.894, "关键步骤是否稳定是第一道门", [], [], { activeNodeIds: ["candidate", "first-gate"], activeEdgeIds: ["samples-gate"] })
    ]
  }),
  sceneSpec({
    id: "S13", kind: "diagram", title: "先验证流程，再决定是否固化", deck: "四项条件共同成立，才进入 Skill 试点",
    nodes: [
      node("samples", 154, 8, 172, 76, "真实任务样本", "10–20 个代表性任务", "blue"),
      node("stable", 18, 132, 132, 82, "稳定", "关键步骤不再频繁变化", "blue"),
      node("repeat", 174, 132, 132, 82, "重复", "同类任务真实出现", "orange"),
      node("detect", 330, 132, 132, 82, "可检测", "失败能被发现", "purple"),
      node("accept", 174, 260, 132, 82, "可验收", "共同完成标准", "mint"),
      node("pilot", 284, 410, 178, 90, "进入 Skill 试点", "触发 · 输入 · 不可跳过项 · 证据", "mint"),
      node("explore", 18, 410, 178, 90, "继续探索", "目标或标准仍不稳定", "orange", { dashed: true })
    ],
    edges: [
      edge("samples-stable", "samples", "stable", "M 205 84 V 106 H 84 V 132", "blue"),
      edge("samples-repeat", "samples", "repeat", "M 240 84 V 132", "orange"),
      edge("samples-detect", "samples", "detect", "M 275 84 V 106 H 396 V 132", "purple"),
      edge("criteria-accept", "repeat", "accept", "M 240 214 V 260", "mint"),
      edge("accept-pilot", "accept", "pilot", "M 306 301 H 340 V 410", "mint"),
      edge("accept-explore", "accept", "explore", "M 174 301 H 107 V 410", "orange", { relation: "warning" })
    ],
    stages: [
      stage("samples", 404, "从真实任务样本开始，而不是从功能想象开始", ["samples"]),
      stage("stable", 410.911, "检查关键步骤是否稳定", ["stable"], ["samples-stable"]),
      stage("repeat", 417.268, "确认同类任务是否真实重复", ["repeat"], ["samples-repeat"]),
      stage("detect", 423.626, "失败必须能被检测", ["detect"], ["samples-detect"]),
      stage("accept", 430.26, "结果要有共同验收标准", ["accept"], ["criteria-accept"]),
      stage("decision", 436.618, "四项成立则试点，否则继续探索", ["pilot", "explore"], ["accept-pilot", "accept-explore"])
    ]
  }),
  sceneSpec({
    id: "S14", kind: "native-evidence", title: "治理不是上传之后再说", deck: "批准证据转译：风险、控制和证据必须对应", material: material(5),
    nodes: [
      node("package", 160, 194, 160, 100, "Skill 包", "指令 + 代码 + 资源", "mint"),
      node("publisher", 18, 28, 154, 88, "发布前", "来源 · 代码 · 工具", "blue"),
      node("installer", 308, 28, 154, 88, "安装时", "角色 · 数据范围", "orange"),
      node("operator", 18, 368, 154, 88, "运行中", "触发 · 调用 · 失败", "purple"),
      node("reviewer", 308, 368, 154, 88, "更新后", "复评 · 停用 · 回退", "blue"),
      node("scanner", 18, 500, 184, 68, "平台扫描", "只能降低风险", "orange", { dashed: true }),
      node("owner", 278, 500, 184, 68, "组织责任人", "判断 + 证据", "mint")
    ],
    edges: [
      edge("publisher-package", "publisher", "package", "M 95 116 V 152 H 200 V 194", "blue"),
      edge("installer-package", "installer", "package", "M 385 116 V 152 H 280 V 194", "orange"),
      edge("package-operator", "package", "operator", "M 200 294 V 330 H 95 V 368", "purple"),
      edge("package-reviewer", "package", "reviewer", "M 280 294 V 330 H 385 V 368", "blue"),
      edge("scanner-owner", "scanner", "owner", "M 202 534 H 278", "orange", { relation: "warning" }),
      edge("reviewer-owner", "reviewer", "owner", "M 385 456 V 500", "mint")
    ],
    stages: [
      stage("package", 438, "Skill 可能携带指令和可执行代码", ["package"]),
      stage("publisher", 443.213, "发布前核验来源、代码与所需工具", ["publisher"], ["publisher-package"]),
      stage("installer", 448.427, "安装时按角色和数据范围授权", ["installer"], ["installer-package"]),
      stage("operator", 453.867, "运行中记录触发、调用与失败", ["operator"], ["package-operator"]),
      stage("reviewer", 459.08, "更新后重评，异常时停用和回退", ["reviewer"], ["package-reviewer"]),
      stage("scanner", 464.52, "平台扫描不能替代组织判断", ["scanner"]),
      stage("owner", 469.733, "治理必须落实到责任人和证据", ["owner"], ["scanner-owner", "reviewer-owner"])
    ]
  }),
  sceneSpec({
    id: "S15", kind: "diagram", title: "审核结论要跟着依赖一起变化", deck: "来源、权限、运行证据、变更失效和回退形成闭环",
    nodes: [
      node("source", 12, 20, 132, 74, "发布前", "来源 · 版本 · 代码", "blue"),
      node("permission", 174, 20, 132, 74, "安装时", "最小数据与工具权限", "orange"),
      node("runtime", 336, 20, 132, 74, "运行中", "触发 · 调用 · 失败", "purple"),
      node("change", 336, 176, 132, 74, "依赖变化", "脚本或外部连接更新", "orange"),
      node("invalidate", 174, 176, 132, 74, "旧审核失效", "不能沿用曾经安全", "red"),
      node("review", 12, 176, 132, 74, "重新评测", "固定样例比较新旧", "blue"),
      node("enable", 92, 354, 132, 80, "重新启用", "证据通过", "mint"),
      node("rollback", 258, 354, 132, 80, "停用 / 回退", "异常或证据不足", "orange")
    ],
    edges: [
      edge("source-permission", "source", "permission", "M 144 57 H 174", "orange"),
      edge("permission-runtime", "permission", "runtime", "M 306 57 H 336", "purple"),
      edge("runtime-change", "runtime", "change", "M 402 94 V 176", "orange"),
      edge("change-invalidate", "change", "invalidate", "M 336 213 H 306", "red"),
      edge("invalidate-review", "invalidate", "review", "M 174 213 H 144", "blue"),
      edge("review-enable", "review", "enable", "M 78 250 V 314 H 158 V 354", "mint"),
      edge("review-rollback", "review", "rollback", "M 78 250 V 300 H 324 V 354", "orange", { relation: "warning" })
    ],
    stages: [
      stage("source", 472, "发布者先说明来源、版本和最小权限", ["source"]),
      stage("permission", 477.213, "安装者按角色和数据范围授权", ["permission"], ["source-permission"]),
      stage("runtime", 482.653, "运行记录回答谁触发了什么版本", ["runtime"], ["permission-runtime"]),
      stage("change", 488.093, "脚本或外部连接变化必须被识别", ["change"], ["runtime-change"]),
      stage("invalidate", 493.533, "依赖变化自动使旧审核失效", ["invalidate"], ["change-invalidate"]),
      stage("review", 498.973, "固定样例重新比较新旧结果", ["review"], ["invalidate-review"]),
      stage("decision", 504.187, "通过才重启，否则停用或回退", ["enable", "rollback"], ["review-enable", "review-rollback"])
    ]
  }),
  sceneSpec({
    id: "S16", kind: "native-evidence", title: "真正的产品判断", deck: "批准证据转译：先过前置门，再设计采用入口", material: material(4),
    nodes: [
      node("candidate", 160, 18, 160, 76, "候选 Skill", "不要先问能不能做", "blue"),
      node("stable", 18, 140, 138, 82, "方法稳定吗？", "步骤会不会频繁变", "blue"),
      node("detect", 171, 140, 138, 82, "失败可发现吗？", "错误能否被检测", "purple"),
      node("authority", 324, 140, 138, 82, "数据与工具？", "谁能安装和执行", "orange"),
      node("version", 171, 272, 138, 82, "版本如何验证？", "比较 · 回归 · 回退", "mint"),
      node("gate", 150, 390, 180, 72, "产品化前置门", "问题必须有答案", "mint"),
      node("chaos", 18, 500, 190, 72, "只加上传入口", "更快复制一次性混乱", "orange", { dashed: true }),
      node("trusted", 272, 500, 190, 72, "可信采用路径", "可以进入下一镜", "mint")
    ],
    edges: [
      edge("candidate-stable", "candidate", "stable", "M 190 94 V 116 H 87 V 140", "blue"),
      edge("candidate-detect", "candidate", "detect", "M 240 94 V 140", "purple"),
      edge("candidate-authority", "candidate", "authority", "M 290 94 V 116 H 393 V 140", "orange"),
      edge("detect-version", "detect", "version", "M 240 222 V 272", "mint"),
      edge("stable-gate", "stable", "gate", "M 87 222 V 366 H 190 V 390", "blue"),
      edge("authority-gate", "authority", "gate", "M 393 222 V 366 H 290 V 390", "orange"),
      edge("version-gate", "version", "gate", "M 240 354 V 390", "mint"),
      edge("gate-chaos", "gate", "chaos", "M 190 462 V 480 H 113 V 500", "orange", { relation: "warning" }),
      edge("gate-trusted", "gate", "trusted", "M 290 462 V 480 H 367 V 500", "mint")
    ],
    stages: [
      stage("candidate", 506, "不要先问能不能做一个 Skill", ["candidate"]),
      stage("stability", 511.746, "先问方法是否稳定、失败能否发现", ["stable", "detect"], ["candidate-stable", "candidate-detect"]),
      stage("authority", 517.732, "再问依赖哪些数据和工具、谁能执行", ["authority"], ["candidate-authority"]),
      stage("version", 523.239, "新版本如何验证也必须有答案", ["version"], ["detect-version"]),
      stage("chaos", 528.986, "否则只会更快复制一次性混乱", ["gate", "chaos"], ["stable-gate", "authority-gate", "version-gate", "gate-chaos"]),
      stage("trusted", 534.493, "产品重点是建立可信采用路径", ["trusted"], ["gate-trusted"])
    ]
  }),
  sceneSpec({
    id: "S17", kind: "diagram", title: "建立一条可信采用路径", deck: "机器挡问题，人决定是否采用；反馈回到同一个产出 Agent",
    nodes: [
      node("understand", 150, 8, 180, 74, "看懂能力与边界", "先理解再试用", "blue"),
      node("trial", 150, 112, 180, 74, "受控试运行", "限定数据与工具", "orange"),
      node("inspect", 150, 216, 180, 74, "检查结果", "证据可复算", "purple"),
      node("revise", 12, 342, 156, 84, "反馈给同一 Agent", "修订并保留版本史", "orange"),
      node("machine", 192, 342, 132, 84, "机器审核", "结构 · 证据 · 安全", "blue"),
      node("human", 348, 342, 120, 84, "人工决定", "采用或退回", "mint")
    ],
    edges: [
      edge("understand-trial", "understand", "trial", "M 240 82 V 112", "orange"),
      edge("trial-inspect", "trial", "inspect", "M 240 186 V 216", "purple"),
      edge("inspect-revise", "inspect", "revise", "M 192 290 V 316 H 90 V 342", "orange"),
      edge("inspect-machine", "inspect", "machine", "M 240 290 V 342", "blue"),
      edge("machine-human", "machine", "human", "M 324 384 H 348", "mint"),
      edge("human-revise", "human", "revise", "M 408 426 V 472 H 90 V 426", "orange", { relation: "warning" })
    ],
    stages: [
      stage("understand", 540, "用户先看懂能力和边界", ["understand"]),
      stage("trial", 545.706, "在受控范围内试运行", ["trial"], ["understand-trial"]),
      stage("inspect", 551.413, "用可检查结果判断是否继续", ["inspect"], ["trial-inspect"]),
      stage("revise", 557.357, "明确反馈回到同一个产出 Agent 修订", ["revise"], ["inspect-revise"]),
      stage("machine", 562.825, "机器审核先挡住结构、证据和安全问题", ["machine"], ["inspect-machine"]),
      stage("human", 568.294, "最终采用或退回仍由人决定", ["human"], ["machine-human", "human-revise"])
    ]
  }),
  sceneSpec({
    id: "S18", kind: "summary", title: "先定义边界，再把方法变成 Skill", deck: "四项共同完成，才是可治理的能力资产",
    nodes: [
      node("trigger", 34, 98, 184, 86, "01 · 触发条件", "什么时候调用", "blue"),
      node("accept", 262, 98, 184, 86, "02 · 完成标准", "什么证据算完成", "orange"),
      node("permission", 34, 244, 184, 86, "03 · 权限边界", "读什么、谁能执行", "purple"),
      node("rollback", 262, 244, 184, 86, "04 · 版本回退", "失败后如何恢复", "mint"),
      node("adopt", 132, 420, 216, 94, "可治理的 Agent Skill", "可发现 · 可复用 · 可维护", "mint")
    ],
    edges: [
      edge("trigger-adopt", "trigger", "adopt", "M 126 184 V 376 H 190 V 420", "blue"),
      edge("accept-adopt", "accept", "adopt", "M 354 184 V 376 H 290 V 420", "orange"),
      edge("permission-adopt", "permission", "adopt", "M 126 330 V 382 H 190 V 420", "purple"),
      edge("rollback-adopt", "rollback", "adopt", "M 354 330 V 382 H 290 V 420", "mint")
    ],
    stages: [
      stage("trigger", 574, "先定义触发条件", ["trigger"]),
      stage("acceptance", 579.5, "再明确完成标准", ["accept"]),
      stage("permission", 585, "同时写清权限边界", ["permission"]),
      stage("rollback", 590.25, "最后准备版本回退", ["rollback", "adopt"], ["trigger-adopt", "accept-adopt", "permission-adopt", "rollback-adopt"])
    ]
  })
]);

const specById = new Map(AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.map((scene) => [scene.id, scene]));

function clampFrame(frame) {
  if (!Number.isFinite(frame)) return 0;
  return Math.max(0, Math.min(AGENT_SKILL_LONG_REVIEW_FRAME_COUNT - 1, Math.floor(frame)));
}

function smoothStep(value) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return clamped * clamped * (3 - 2 * clamped);
}

function revealProgress(frame, startFrame, durationFrames) {
  if (frame < startFrame) return 0;
  if (durationFrames <= 0) return 1;
  return smoothStep((frame - startFrame + 1) / durationFrames);
}

export function longReviewSceneAtFrame(frame) {
  const safeFrame = clampFrame(frame);
  return AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.find(
    (scene) => safeFrame >= scene.startFrame && safeFrame < scene.endFrame
  ) ?? AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.at(-1);
}

export function longReviewSceneLayersAtFrame(frame) {
  const safeFrame = clampFrame(frame);
  const current = longReviewSceneAtFrame(safeFrame);
  const index = AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.findIndex((scene) => scene.id === current.id);
  if (index <= 0) return [{ sceneId: current.id, opacity: 1, role: "current" }];
  const offset = safeFrame - current.startFrame;
  if (offset >= AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES) {
    return [{ sceneId: current.id, opacity: 1, role: "current" }];
  }
  const incomingOpacity = smoothStep(offset / Math.max(1, AGENT_SKILL_LONG_REVIEW_CROSSFADE_FRAMES - 1));
  return [
    { sceneId: AGENT_SKILL_LONG_REVIEW_SCENE_SPECS[index - 1].id, opacity: 1 - incomingOpacity, role: "outgoing" },
    { sceneId: current.id, opacity: incomingOpacity, role: "incoming" }
  ];
}

export function longReviewDiagramStateAtFrame(sceneId, frame) {
  const spec = specById.get(sceneId);
  if (!spec) throw new Error(`未知长片审阅镜头：${sceneId}`);
  const safeFrame = Math.max(spec.startFrame, Math.min(spec.endFrame - 1, Math.floor(Number(frame) || 0)));
  const itemProgress = spec.stages.map((item) =>
    revealProgress(safeFrame, item.startFrame, AGENT_SKILL_LONG_REVIEW_NODE_ENTER_FRAMES)
  );
  const nodeProgress = Object.fromEntries(spec.nodes.map((item) => [item.id, 0]));
  const edgeProgress = Object.fromEntries(spec.edges.map((item) => [item.id, 0]));
  const edgeArrowProgress = Object.fromEntries(spec.edges.map((item) => [item.id, 0]));
  let stageIndex = 0;
  for (const [index, item] of spec.stages.entries()) {
    if (safeFrame >= item.startFrame) stageIndex = index;
    const nodeReveal = itemProgress[index];
    const lineReveal = revealProgress(
      safeFrame,
      item.startFrame + AGENT_SKILL_LONG_REVIEW_EDGE_DELAY_FRAMES,
      AGENT_SKILL_LONG_REVIEW_EDGE_DRAW_FRAMES
    );
    const arrowReveal = revealProgress(
      safeFrame,
      item.startFrame + AGENT_SKILL_LONG_REVIEW_EDGE_DELAY_FRAMES + AGENT_SKILL_LONG_REVIEW_EDGE_DRAW_FRAMES,
      AGENT_SKILL_LONG_REVIEW_ARROW_FADE_FRAMES
    );
    for (const id of item.nodeIds) nodeProgress[id] = Math.max(nodeProgress[id] ?? 0, nodeReveal);
    for (const id of item.edgeIds) {
      edgeProgress[id] = Math.max(edgeProgress[id] ?? 0, lineReveal);
      edgeArrowProgress[id] = Math.max(edgeArrowProgress[id] ?? 0, arrowReveal);
    }
  }
  const currentStage = spec.stages[stageIndex];
  const previousStage = stageIndex > 0 ? spec.stages[stageIndex - 1] : null;
  const stageTransitionProgress = itemProgress[stageIndex] ?? 1;
  const nodeHighlightProgress = Object.fromEntries(spec.nodes.map((item) => [item.id, 0]));
  const edgeHighlightProgress = Object.fromEntries(spec.edges.map((item) => [item.id, 0]));
  if (previousStage) {
    for (const id of previousStage.activeNodeIds) {
      nodeHighlightProgress[id] = Math.max(nodeHighlightProgress[id] ?? 0, 1 - stageTransitionProgress);
    }
    for (const id of previousStage.activeEdgeIds) {
      edgeHighlightProgress[id] = Math.max(edgeHighlightProgress[id] ?? 0, 1 - stageTransitionProgress);
    }
  }
  for (const id of currentStage.activeNodeIds) {
    nodeHighlightProgress[id] = Math.max(nodeHighlightProgress[id] ?? 0, stageTransitionProgress);
  }
  for (const id of currentStage.activeEdgeIds) {
    edgeHighlightProgress[id] = Math.max(edgeHighlightProgress[id] ?? 0, stageTransitionProgress);
  }
  const complete = itemProgress.every((progress) => progress === 1);
  return {
    sceneId,
    stageIndex,
    stageId: currentStage.id,
    stageLabel: currentStage.label,
    itemProgress,
    nodeProgress,
    edgeProgress,
    edgeArrowProgress,
    nodeHighlightProgress,
    edgeHighlightProgress,
    activeNodeIds: currentStage.activeNodeIds,
    activeEdgeIds: currentStage.activeEdgeIds,
    previousStageId: previousStage?.id ?? null,
    previousStageLabel: previousStage?.label ?? null,
    stageTransitionProgress,
    complete,
    hold: safeFrame >= spec.holdStartFrame,
    finalHold: safeFrame >= spec.holdStartFrame
  };
}

export function longReviewProgressAtFrame(frame) {
  if (!Number.isFinite(frame)) return 0;
  return Math.min(1, Math.max(0, frame / AGENT_SKILL_LONG_REVIEW_FRAME_COUNT));
}

export function validateAgentSkillLongReviewEpisode(episode) {
  if (episode?.id !== "agent-skill-20260806") return false;
  if (!Array.isArray(episode.scenes) || episode.scenes.length !== 18) return false;
  if (!Array.isArray(episode.subtitles) || episode.subtitles.length !== 107) return false;
  for (const [index, spec] of AGENT_SKILL_LONG_REVIEW_SCENE_SPECS.entries()) {
    const actual = episode.scenes[index];
    if (
      actual?.id !== spec.id ||
      actual?.start !== spec.startSecond ||
      actual?.end !== spec.endSecond
    ) return false;
  }
  if (episode.subtitles[0]?.start !== 0 || episode.subtitles.at(-1)?.end !== 600) return false;
  for (const [index, subtitle] of episode.subtitles.entries()) {
    if (!Number.isFinite(subtitle.start) || !Number.isFinite(subtitle.end) || subtitle.end <= subtitle.start) return false;
    if (index > 0 && subtitle.start !== episode.subtitles[index - 1].end) return false;
  }
  return true;
}
