import { approvalValidForGate } from "../control/policy-engine.mjs";
import {
  VISUAL_EXPRESSION_CONTRACT_VERSION,
  VISUAL_EXPRESSION_STYLE_PROFILE_ID,
  createVisualExpressionIntent
} from "../../shared/visual-expression-contract.mjs";

export const APPROVED_SCRIPT_SHORT_STORYBOARD_ADAPTER_VERSION =
  "approved-script-short-storyboard-adapter-v5";

export const SHORT_STORYBOARD_VISUAL_RULES = Object.freeze([
  "全片以关系动画、结构图和过程演示为主，禁止用连续大字卡片代替概念解释。",
  "同层级元素使用统一的简约扁平样式；液态玻璃只用于少量强调层，不用于底部进度条。",
  "底部使用全宽低矮矩形文字进度条，分段宽度按场景实际时长，不显示当前阶段特殊标记，右上角不显示进度数字。",
  "字幕尽量单行、小字号、贴齐左右与底部，背景透明且不得使用黑色底板。",
  "画面不显示左上角小字、来源行或重复元数据；所有卡片文字必须完整可见。",
  "技术运行逻辑必须用节点和有向连线逐步推导；已出现的主路径持续保留，旁支保持中性，转场不得让主路径提前重置或单帧跳变。"
]);

const subtitleSegmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
const leadingClosingPunctuation = /^[，。！？；：、）》】,.!?;:)\]]/u;
const trailingOpeningPunctuation = /[（《【(\[]$/u;
const trailingSemanticConnector = /(?:、|以及|或者|和|与|及|或)\s*$/u;

function textLength(value) {
  return Array.from(String(value ?? "")).length;
}

function compactLength(value) {
  return String(value ?? "")
    .replace(/[\s，。！？；：、“”‘’（）《》…—,.!?;:'"()\[\]{}-]/gu, "")
    .length;
}

function sentenceSegments(value) {
  return String(value ?? "")
    .match(/[^。！？；]+[。！？；]?/gu)
    ?.map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function splitNearMiddle(value) {
  const source = String(value ?? "");
  const midpoint = source.length / 2;
  const boundaries = [...subtitleSegmenter.segment(source)]
    .map((item) => item.index)
    .filter((index) => {
      if (index <= 0 || index >= source.length) return false;
      return !leadingClosingPunctuation.test(source.slice(index).trimStart())
        && !trailingOpeningPunctuation.test(source.slice(0, index).trimEnd());
    });
  if (boundaries.length === 0) return null;
  const boundary = boundaries.reduce(
    (best, candidate) => Math.abs(candidate - midpoint) < Math.abs(best - midpoint)
      ? candidate
      : best,
    boundaries[0]
  );
  const left = source.slice(0, boundary);
  const right = source.slice(boundary);
  return left.trim() && right.trim() ? [left, right] : null;
}

function fitSceneCount(sourceSegments, minimum = 6, maximum = 10) {
  const segments = [...sourceSegments];
  while (segments.length > maximum) {
    let mergeIndex = 0;
    let smallestPair = Number.POSITIVE_INFINITY;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const pairLength = textLength(segments[index]) + textLength(segments[index + 1]);
      if (pairLength < smallestPair) {
        mergeIndex = index;
        smallestPair = pairLength;
      }
    }
    segments.splice(mergeIndex, 2, `${segments[mergeIndex]}${segments[mergeIndex + 1]}`);
  }
  while (segments.length < minimum) {
    const candidates = segments
      .map((segment, index) => ({ index, segment, length: textLength(segment) }))
      .sort((left, right) => right.length - left.length);
    const candidate = candidates.find((item) => splitNearMiddle(item.segment));
    if (!candidate) break;
    segments.splice(candidate.index, 1, ...splitNearMiddle(candidate.segment));
  }
  if (segments.length < minimum || segments.length > maximum) {
    throw new Error(`批准脚本无法稳定拆分为 ${minimum}–${maximum} 个连续场景`);
  }
  return segments;
}

function normalizeBoundaryWhitespace(chunks) {
  const normalized = [];
  for (const sourceChunk of chunks) {
    let chunk = sourceChunk;
    const leadingWhitespace = /^\s+/u.exec(chunk)?.[0] ?? "";
    if (leadingWhitespace && normalized.length > 0) {
      normalized[normalized.length - 1] += leadingWhitespace;
      chunk = chunk.slice(leadingWhitespace.length);
    }
    if (chunk) normalized.push(chunk);
  }
  return normalized;
}

function mergeBriefTail(chunks, maximumCompactCharacters = 28) {
  if (chunks.length < 2) return chunks;
  const tail = chunks.at(-1);
  const previous = chunks.at(-2);
  if (
    compactLength(tail) < 5 &&
    compactLength(previous) + compactLength(tail) <= maximumCompactCharacters
  ) {
    return [...chunks.slice(0, -2), `${previous}${tail}`];
  }
  return chunks;
}

function rebalanceBriefTail(chunks, maximumCompactCharacters = 28) {
  if (chunks.length < 2) return chunks;
  const tail = chunks.at(-1);
  const previous = chunks.at(-2);
  if (
    compactLength(tail) > 5 ||
    compactLength(previous) + compactLength(tail) <= maximumCompactCharacters
  ) {
    return chunks;
  }

  const semanticBoundaries = [...previous.matchAll(/[，：、,:]/gu)]
    .map((match) => (match.index ?? 0) + match[0].length)
    .reverse();
  for (const boundary of semanticBoundaries) {
    const left = previous.slice(0, boundary);
    const movedClause = previous.slice(boundary);
    const rebalancedTail = `${movedClause}${tail}`;
    if (
      left.trim() &&
      movedClause.trim() &&
      compactLength(left) <= maximumCompactCharacters &&
      compactLength(rebalancedTail) <= maximumCompactCharacters
    ) {
      return [...chunks.slice(0, -2), left, rebalancedTail];
    }
  }
  return chunks;
}

function splitSubtitleText(value, maximumCharacters = 28) {
  const source = String(value ?? "");
  const tokens = [...subtitleSegmenter.segment(source)].map((item) => item.segment);
  const chunks = [];
  let current = "";
  for (const token of tokens) {
    const closingPunctuation = leadingClosingPunctuation.test(token.trimStart());
    if (
      current &&
      !closingPunctuation &&
      !trailingSemanticConnector.test(current) &&
      textLength(current) + textLength(token) > maximumCharacters
    ) {
      if (current.trim()) chunks.push(current);
      current = token;
      continue;
    }
    current += token;
  }
  if (current.trim()) chunks.push(current);
  const normalized = normalizeBoundaryWhitespace(chunks);
  return mergeBriefTail(
    rebalanceBriefTail(normalized, maximumCharacters),
    maximumCharacters
  );
}

function sceneType(index, sceneCount) {
  if (index === 0) return "title";
  if (index === sceneCount - 1) return "summary";
  return index % 2 === 1 ? "evidence" : "statement";
}

function sceneCopy(segment, index, sceneCount, script) {
  if (index === 0) {
    return { title: script.title, statement: script.thesis };
  }
  if (segment.includes("周报")) {
    return {
      title: "周报任务",
      statement: "核对指标定义 → 检查异常 → 固定结构写结论"
    };
  }
  if (segment.includes("数据库") || segment.includes("文档写入")) {
    return { title: "Tool 执行动作", statement: "数据库查询 / 文档写入" };
  }
  if (segment.includes("只有工具")) {
    return { title: "只有 Tool", statement: "正确顺序和验收标准" };
  }
  if (segment.includes("只有 Skill")) {
    return { title: "只有 Skill", statement: "没有获准的执行能力" };
  }
  if (segment.includes("Skill") && segment.includes("MCP")) {
    return { title: "Skill 与 MCP", statement: "不是同一层问题" };
  }
  if (segment.includes("MCP")) {
    return { title: "MCP 连接协议", statement: "统一发现和调用" };
  }
  if (segment.includes("Tool") || segment.includes("工具")) {
    return { title: "Tool 执行动作", statement: "执行动作" };
  }
  if (segment.includes("Skill")) {
    return { title: "Skill 过程知识", statement: "过程知识" };
  }
  return {
    title: index === sceneCount - 1 ? "职责边界" : script.title,
    statement: script.thesis
  };
}

function animationDirection(segment, approvedDirection) {
  const common = "以关系和过程动画为主，不用大字卡片代替说明";
  if (segment.includes("周报")) {
    return `${approvedDirection}；周报任务依次流经核对指标定义、检查异常、固定结构写结论；${common}`;
  }
  if (segment.includes("数据库") || segment.includes("文档写入")) {
    return `${approvedDirection}；数据库查询与文档写入动作节点依次响应；${common}`;
  }
  if (segment.includes("只有工具")) {
    return `${approvedDirection}；保留 Tool 层并显出正确顺序和验收标准缺失；${common}`;
  }
  if (segment.includes("只有 Skill")) {
    return `${approvedDirection}；保留 Skill 层并显出执行能力未获准、外部操作未完成；${common}`;
  }
  if (segment.includes("Skill") && segment.includes("MCP")) {
    return `${approvedDirection}；在同一完整架构图上按 Skill 规则 → Agent 判断 → MCP 调用 → 外部能力四段累计高亮，每段新增节点与有向连线并持续保留前序高亮；Tool 与 agent-invokes-tool 只作中性旁支；场景末尾保持完整主路径，并随下一场景平滑交叉淡出；${common}`;
  }
  if (segment.includes("MCP")) {
    return `${approvedDirection}；外部能力通过 MCP 连接线被 Agent 发现和调用；${common}`;
  }
  if (segment.includes("Tool") || segment.includes("工具")) {
    return `${approvedDirection}；高亮执行动作层并展示动作触发；${common}`;
  }
  return `${approvedDirection}；高亮过程知识层并展示任务步骤展开；${common}`;
}

function semanticParts(value) {
  return String(value ?? "")
    .split(/\s*(?:→|\/|、|；)\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function visualNeedForScene(segment, index, sceneCount) {
  if (index === 0 || index === sceneCount - 1) return "none";
  if (/周报|先.+再|再.+最后|依次|顺序/u.test(segment)) return "sequence";
  if (/不是同一层|只有工具|只有\s*Skill/u.test(segment)) return "comparison";
  if (/MCP/u.test(segment) && /发现|调用|连接|外部能力/u.test(segment)) return "relationship";
  if (/数据库|文档写入/u.test(segment)) return "relationship";
  return "concept-anchor";
}

function visualIntentForScene(segment, index, sceneCount, copy) {
  const informationNeed = visualNeedForScene(segment, index, sceneCount);
  const claimId = `scene-claim-${String(index + 1).padStart(2, "0")}`;
  const claim = {
    id: claimId,
    text: segment,
    visualRequired: informationNeed !== "none",
    evidenceRefs: []
  };
  const base = {
    question: informationNeed === "none"
      ? "这一场要让观众先记住哪个核心判断？"
      : `怎样让观众一眼理解“${copy.title}”的${
        informationNeed === "sequence" ? "先后顺序" :
        informationNeed === "comparison" ? "关键差异" :
        informationNeed === "relationship" ? "作用关系" : "核心概念"
      }？`,
    takeaway: copy.statement || copy.title,
    role: "explanation",
    objective: informationNeed === "none"
      ? (index === 0 ? "orient" : "summarize")
      : informationNeed === "comparison" ? "compare" : "explain",
    informationNeed,
    contribution: {
      none: "none",
      sequence: "show-order",
      comparison: "show-difference",
      relationship: "explain-relationship",
      "concept-anchor": "anchor-concept"
    }[informationNeed],
    contributionRationale: informationNeed === "none"
      ? "这是单一判断，清晰大标题比补一张装饰图更直接。"
      : {
          sequence: "删掉关系图后，口播中的先后步骤会退化成并列文字。",
          comparison: "删掉对照结构后，观众无法快速定位两侧共同维度与差异。",
          relationship: "删掉关系图后，观众看不清对象之间怎样连接和产生作用。",
          "concept-anchor": "简约概念锚点帮助观众把抽象名词与当前主张绑定，但不能替代文字。"
        }[informationNeed],
    relationKind: {
      none: "none",
      sequence: "sequence",
      comparison: "comparison",
      relationship: "dependency",
      "concept-anchor": "none"
    }[informationNeed],
    compositionProfile: ["none", "concept-anchor"].includes(informationNeed)
      ? "text-first"
      : "relation-first",
    claims: [claim],
    evidenceRefs: [],
    mustNotShow: [
      "没有叙事作用的人物",
      "装饰箭头",
      "用具体物体隐喻替代真实关系",
      "卡片矩阵堆满整屏"
    ]
  };
  if (informationNeed === "none") {
    return createVisualExpressionIntent({ ...base, entities: [], relations: [] }, {
      sceneId: `S${String(index + 1).padStart(2, "0")}`
    });
  }

  let labels = semanticParts(copy.statement);
  if (informationNeed === "comparison") {
    if (/只有工具/u.test(segment)) labels = ["已有 Tool", "缺少顺序与验收"];
    else if (/只有\s*Skill/u.test(segment)) labels = ["已有 Skill", "缺少执行能力"];
    else labels = semanticParts(copy.title.replace(/与/u, "→"));
  }
  if (informationNeed === "relationship" && /MCP/u.test(segment)) {
    labels = ["Agent", "MCP 外部能力"];
  }
  if (labels.length < 2 && ["sequence", "comparison", "relationship"].includes(informationNeed)) {
    labels = [copy.title, copy.statement].filter(Boolean);
  }
  if (informationNeed === "concept-anchor") labels = [copy.title];
  labels = [...new Set(labels)].slice(0, 4);
  const entities = labels.map((label, entityIndex) => ({
    id: `entity-${entityIndex + 1}`,
    label,
    semanticRole: informationNeed === "sequence"
      ? (entityIndex === labels.length - 1 ? "result" : "step")
      : "concept",
    importance: "primary",
    claimIds: [claimId]
  }));
  const relationPairs = informationNeed === "concept-anchor"
    ? []
    : informationNeed === "sequence"
      ? entities.slice(0, -1).map((entity, relationIndex) => [entity, entities[relationIndex + 1]])
      : [[entities[0], entities[1]]];
  const relations = relationPairs.map(([from, to], relationIndex) => ({
    id: `relation-${relationIndex + 1}`,
    from: from.id,
    to: to.id,
    type: informationNeed === "sequence"
      ? "then"
      : informationNeed === "comparison" ? "compares" : "depends-on",
    label: informationNeed === "sequence"
      ? "然后"
      : informationNeed === "comparison" ? "差异" : "连接并调用",
    directed: informationNeed !== "comparison",
    claimIds: [claimId]
  }));
  return createVisualExpressionIntent({ ...base, entities, relations }, {
    sceneId: `S${String(index + 1).padStart(2, "0")}`
  });
}

function rawSceneDuration(segment, narrationLength) {
  const proportional = (60 * Math.max(1, compactLength(segment))) / Math.max(1, narrationLength);
  return Number(Math.max(4, Math.min(15, proportional)).toFixed(3));
}

export function approvedScriptNarrationText(script) {
  return [
    script?.hook,
    ...((script?.sections ?? []).map((section) => section?.narration)),
    script?.closing
  ].map((value) => String(value ?? "")).filter(Boolean).join("");
}

function approvedScriptIdentity(episode) {
  if (episode.derivation?.kind !== "approved-script-section-v1") {
    throw new Error("只有绑定批准源脚本的派生 Episode 才能使用确定性分镜适配器");
  }
  if (!approvalValidForGate(episode, "script")) {
    throw new Error("当前脚本没有有效的机器审核与人工批准绑定");
  }
  const scriptDraft = episode.production?.scriptDraft;
  if (!scriptDraft?.content || typeof scriptDraft.content !== "object") {
    throw new Error("派生 Episode 缺少已批准的结构化脚本");
  }
  return {
    script: scriptDraft.content,
    version: episode.approvals.script.currentVersion,
    artifactHash: episode.approvals.script.artifactHash,
    reviewReportId: episode.approvals.script.reviewReportId
  };
}

export function adaptApprovedScriptToShortStoryboard(episode) {
  const identity = approvedScriptIdentity(episode);
  const narration = approvedScriptNarrationText(identity.script);
  const segments = fitSceneCount(sentenceSegments(narration));
  if (segments.join("") !== narration) {
    throw new Error("分镜拆分没有完整保留已批准脚本旁白");
  }
  const approvedDirections = [
    ...new Set(
      (identity.script.sections ?? [])
        .map((section) => String(section?.visualDirection ?? "").trim())
        .filter(Boolean)
    )
  ];
  if (approvedDirections.length === 0) {
    throw new Error("已批准脚本缺少视觉方向，不能生成分镜");
  }
  const approvedDirection = approvedDirections.join("；");
  const narrationLength = compactLength(narration);
  const scenes = segments.map((segment, index) => {
    const subtitleLines = splitSubtitleText(segment).map((text) => ({
      text,
      weight: Math.max(1, compactLength(text))
    }));
    const copy = sceneCopy(segment, index, segments.length, identity.script);
    return {
      type: sceneType(index, segments.length),
      durationSeconds: rawSceneDuration(segment, narrationLength),
      kicker: "",
      title: copy.title,
      statement: copy.statement,
      subtitle: subtitleLines[0]?.text ?? "",
      label: "",
      assetHint: animationDirection(segment, approvedDirection),
      visualIntent: visualIntentForScene(segment, index, segments.length, copy),
      subtitleLines
    };
  });
  return {
    visualContractVersion: VISUAL_EXPRESSION_CONTRACT_VERSION,
    visualStyleProfileId: VISUAL_EXPRESSION_STYLE_PROFILE_ID,
    targetDurationSeconds: 60,
    scenes,
    assetChecklist: [
      "三层架构图本地矢量动画：过程知识、执行动作、连接协议",
      "周报任务流程本地矢量动画：核对指标定义、检查异常、固定结构写结论",
      "Tool 动作动画：数据库查询、文档写入",
      "MCP 连接动画：外部能力被 Agent 发现和调用",
      "9:16 安全区、透明字幕层与按实际时长分段的底部矩形文字进度条"
    ],
    visualRules: [...SHORT_STORYBOARD_VISUAL_RULES],
    sourceScript: {
      version: identity.version,
      artifactHash: identity.artifactHash,
      reviewReportId: identity.reviewReportId
    }
  };
}

export function derivedStoryboardFidelity(episode) {
  if (episode.derivation?.kind !== "approved-script-section-v1") {
    return { applicable: false, passed: true };
  }
  let expected;
  try {
    expected = adaptApprovedScriptToShortStoryboard(episode);
  } catch (error) {
    return {
      applicable: true,
      passed: false,
      bindingPassed: false,
      sceneCopyIssues: ["approved-script"],
      subtitlePassed: false,
      visualRulesPassed: false,
      visualIntentPassed: false,
      visualStyleProfilePassed: false,
      displayChromePassed: false,
      error: error.message
    };
  }
  const storyboardDraft = episode.production?.storyboardDraft;
  const visualExpressionRequired =
    storyboardDraft?.visualContractVersion === VISUAL_EXPRESSION_CONTRACT_VERSION;
  const visualStyleProfilePassed = !visualExpressionRequired ||
    storyboardDraft?.visualStyleProfileId === expected.visualStyleProfileId;
  const bindingPassed = Boolean(
    storyboardDraft?.generationKind === "deterministic-approved-script-storyboard-adapter" &&
    storyboardDraft?.sourceScriptVersion === expected.sourceScript.version &&
    storyboardDraft?.sourceScriptArtifactHash === expected.sourceScript.artifactHash &&
    storyboardDraft?.sourceScriptReviewReportId === expected.sourceScript.reviewReportId &&
    storyboardDraft?.sourceSnapshotHash === episode.derivation.sourceSnapshotHash
  );
  const actualScenes = episode.scenes ?? [];
  const currentArtifactIsLatest =
    (storyboardDraft?.versions?.at(-1)?.version ?? storyboardDraft?.version) ===
    storyboardDraft?.version;
  const sceneFields = [
    "type",
    "kicker",
    "title",
    "statement",
    "subtitle",
    "label",
    "assetHint"
  ];
  const sceneCopyIssues = [];
  let visualIntentPassed = true;
  if (actualScenes.length !== expected.scenes.length) {
    sceneCopyIssues.push("scene-count");
  }
  for (let index = 0; index < Math.min(actualScenes.length, expected.scenes.length); index += 1) {
    for (const field of sceneFields) {
      if (actualScenes[index]?.[field] !== expected.scenes[index]?.[field]) {
        sceneCopyIssues.push(`scenes[${index}].${field}`);
      }
    }
    if (
      visualExpressionRequired &&
      JSON.stringify(actualScenes[index]?.visualIntent ?? null) !==
      JSON.stringify(expected.scenes[index]?.visualIntent ?? null)
    ) {
      visualIntentPassed = false;
      sceneCopyIssues.push(`scenes[${index}].visualIntent`);
    }
  }
  const actualNarration = (episode.subtitles ?? []).map((subtitle) => subtitle.text).join("");
  const subtitlePassed = actualNarration === approvedScriptNarrationText(
    episode.production?.scriptDraft?.content
  );
  const visualRulesPassed = JSON.stringify(storyboardDraft?.visualRules ?? []) ===
    JSON.stringify(SHORT_STORYBOARD_VISUAL_RULES);
  const displayChromePassed = actualScenes.every((scene) =>
    scene.kicker === "" &&
    scene.label === "" &&
    ![scene.title, scene.statement, scene.subtitle].some((value) =>
      String(value ?? "").includes("来源")
    )
  );
  return {
    applicable: true,
    passed:
      bindingPassed &&
      currentArtifactIsLatest &&
      sceneCopyIssues.length === 0 &&
      subtitlePassed &&
      visualRulesPassed &&
      visualIntentPassed &&
      visualStyleProfilePassed &&
      displayChromePassed,
    bindingPassed,
    currentArtifactIsLatest,
    sceneCopyIssues,
    subtitlePassed,
    visualRulesPassed,
    visualIntentPassed,
    visualStyleProfilePassed,
    displayChromePassed,
    error: ""
  };
}
