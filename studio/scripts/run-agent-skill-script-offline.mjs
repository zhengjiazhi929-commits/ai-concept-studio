import { recheckGateReview, runAgent } from "../src/server/orchestrator.mjs";
import { readReviewConfig } from "../src/server/reviews/coordinator.mjs";

const arguments_ = process.argv.slice(2);
const recheckRequested = arguments_.includes("--recheck");
const episodeId = arguments_.find((argument) => !argument.startsWith("--"))
  ?? "agent-skill-20260806";
if (episodeId !== "agent-skill-20260806") {
  throw new Error("这个离线夹具只允许用于 agent-skill-20260806");
}

function section(id, heading, purpose, narration, evidenceRefs, visualDirection) {
  return { id, heading, purpose, narration, evidenceRefs, visualDirection };
}

function scriptDraft(reviewFeedback) {
  const revised = Array.isArray(reviewFeedback) && reviewFeedback.length > 0;
  const durationExpanded = Array.isArray(reviewFeedback) && reviewFeedback.some(
    (issue) => issue?.code === "script-narration-density"
  );
  const sections = [
    section(
      "S01",
      "为什么长 Prompt 不是答案",
      "用常见误区建立问题",
      "当团队反复把同一套背景、步骤和注意事项贴进对话时，问题已经不只是提示词写得够不够长，而是过程知识没有形成可发现、可复用、可维护的工作单元。Agent Skill 正是在这一层出现。",
      ["source-openai-skills", "source-anthropic-skills"],
      "展示重复粘贴提示词与可复用 Skill 目录的对照"
    ),
    section(
      "S02",
      "Agent Skill 的准确定义",
      "建立概念边界",
      "Agent Skill 是可被 Agent 发现并按任务需要加载的过程知识包。最小结构是一份带名称和描述的 SKILL.md，也可以附带脚本、参考资料和资产。它扩展的是做事方法，而不是重新训练模型。",
      ["source-f36ae4007ec3", "source-cabdd0de1a74", "source-openai-skills"],
      "拆解 SKILL.md、scripts、references、assets 四层目录"
    ),
    section(
      "S03",
      "它为什么不只是 Prompt",
      "解释可复用与可治理差异",
      "Prompt 通常服务一次交互。Skill 除了自然语言指令，还带有触发元数据、文件结构、可选代码和资源，并能被安装、分享、更新和审查。因此，Skill 里面有 Prompt，但 Skill 不等于一段更长的 Prompt。",
      ["source-f36ae4007ec3", "source-openai-skills", "source-anthropic-skills"],
      "用一次性输入与可安装能力包的分层图对比"
    ),
    section(
      "S04",
      "渐进式加载怎样工作",
      "讲清上下文机制",
      "典型链路先让 Agent 看到所有 Skill 的名称和描述，用于判断是否命中任务；命中后才读取完整 SKILL.md；只有确实需要时，才继续读取脚本、参考资料或资产。这样既保留专业细节，又避免把全部材料一次塞进上下文。",
      ["source-f36ae4007ec3", "source-anthropic-skills"],
      "三层加载动画：元数据、说明、按需资源"
    ),
    section(
      "S05",
      "Skill、Tool 与 MCP 的分工",
      "消除最常见混淆",
      "Skill 主要告诉 Agent 怎样完成一类任务；Tool 提供一个可执行动作；MCP 标准化 prompts、resources 和 tools 如何被外部系统暴露和调用。一个 Skill 完全可以规定何时调用某个 MCP 工具，但两者解决的不是同一层问题。",
      ["source-cabdd0de1a74", "source-mcp-overview", "source-openai-plugins"],
      "三层架构图：过程知识、执行动作、连接协议"
    ),
    section(
      "S06",
      "什么时候值得做成 Skill",
      "给产品经理决策标准",
      "优先选择稳定、重复、可验收，而且能显著减少返工的流程。一次性探索、目标还在快速变化，或者结果无法定义验收标准的任务，不必急着固化。先用代表性任务做评测，再决定是否发布给更多人。",
      ["source-openai-skills", "source-anthropic-skills"],
      "四项判断卡片：稳定、重复、可验收、可复用"
    )
  ];

  if (revised) {
    sections.push(
      section(
        "S07",
        "治理不是上传之后再说",
        "补齐安全与生命周期闭环",
        "Skill 可以携带指令和可执行代码，因此应按软件供应链资产治理。发布前核验来源、审查代码和所需工具；安装时按角色和数据范围授权；运行中记录触发、工具调用与失败；版本更新后重新评测；出现异常时能够停用和回退。平台扫描只能降低风险，不能替代组织自己的判断。",
        [
          "source-f36ae4007ec3",
          "source-cabdd0de1a74",
          "source-openai-skills",
          "source-openai-plugins"
        ],
        "用发布前、安装时、运行中、更新后四段治理闭环"
      )
    );
  }

  sections.push(
    section(
      revised ? "S08" : "S07",
      "真正的产品判断",
      "总结可执行结论",
      "不要先问能不能做一个 Skill，而要先问：这套方法是否稳定，失败能否被发现，依赖哪些数据和工具，谁有权安装和执行，以及新版本如何验证。如果这些问题没有答案，Skill 只会把一次性的混乱复制得更快。",
      ["source-openai-skills", "source-openai-plugins", "source-mcp-overview"],
      "收束为五个上线前追问"
    )
  );

  if (durationExpanded) {
    const expansions = {
      S01: "举个具体场景：内容团队要做一次竞品分析，第一位同事写出二十条步骤，第二位同事补上数据口径，第三位同事又增加交付格式。下一次任务开始时，这些经验仍散落在聊天记录里，没人确定该复制哪一版。把它做成 Skill 的意义，是把触发条件、执行步骤、参考材料与验收方式放进同一个可维护单元，让 Agent 在真正命中任务时再调用。它解决的是团队方法如何沉淀，而不是单次回答如何显得更聪明。",
      S02: "这个定义里有三个关键词。第一是可发现：名称和描述要让 Agent 判断它何时适用。第二是按需加载：完整说明与附属资源不必始终占用上下文。第三是可组合：说明文件可以引用脚本、参考资料和素材，必要时也可以规定怎样调用外部工具。反过来说，只有一段没有触发条件、目录边界和完成标准的文字，即使很长，也仍然更像一次性提示，而不是完整 Skill。",
      S03: "两者最容易被混淆，是因为 Skill 的核心说明仍然使用自然语言。但工程差异不在文字长短，而在生命周期。普通 Prompt 往往由人临时粘贴，修改后也难以知道谁在使用旧版；Skill 则可以作为文件被版本管理，能明确依赖哪些资源、允许哪些操作，并通过代表性任务回归验证。团队因此能够审查变更、比较版本和回退，而不是依赖某个人记得那段“效果最好”的聊天文本。",
      S04: "这种加载方式也解释了为什么 Skill 的描述不能随便写。描述过宽，Agent 会在不相关任务上误触发；描述过窄，真正需要时又找不到。命中之后，说明文件还应把常用路径放在前面，把大段参考资料和低频细节拆到独立文件。这样做不是追求目录形式，而是在控制上下文成本：先用少量元数据完成路由，再把有限注意力留给当前步骤确实需要的知识。",
      S05: "可以把三者放进同一个任务看：用户要求整理一份周报，Skill 规定先核对指标定义、再检查异常、最后按固定结构写结论；数据库查询或文档写入 Tool 负责执行具体动作；MCP 则让这些外部能力以统一方式被 Agent 发现和调用。如果只有工具，Agent 可能不知道正确顺序和验收标准；如果只有 Skill，没有获准的执行能力，它也只能给建议，不能完成外部操作。",
      S06: "一个实用筛选方法是先收集十到二十个真实任务，观察输入是否相似、关键步骤是否稳定、错误是否可检测、结果是否有共同验收标准。如果每次都要重新讨论目标，说明流程还在探索期；如果失败只能靠资深人员凭感觉发现，也不适合立即自动化。适合固化的候选通常能写清楚何时触发、需要什么材料、哪些步骤绝不能跳过，以及什么证据代表任务完成。",
      S07: "治理闭环还要落实到责任人和证据。发布者需要说明来源、版本和最小权限；安装者要知道它会读取什么数据、可能调用什么工具；运行记录要能回答哪次任务触发了哪个版本、出现了什么失败；更新时则用固定样例比较新旧结果。若 Skill 引用的脚本或外部连接发生变化，应自动失效旧的审核结论，重新检查后再启用。这样才能避免“文件曾经安全”被误当成“以后一直安全”。",
      S08: "因此，产品设计的重点不是再增加一个上传入口，而是建立一条可信采用路径：用户先看懂能力和边界，在受控范围内试运行，看到可检查的结果后再扩大使用；出现问题时，系统能把明确意见交回同一个产出 Agent 修订，并保留每次版本和审核记录。机器审核负责挡住结构、证据和安全问题，最终是否采用仍由人决定。只有这条链路成立，Skill 才是可治理的能力资产，而不是更隐蔽的自动化黑箱。"
    };
    for (const item of sections) {
      item.narration = `${item.narration}${expansions[item.id] ?? ""}`;
    }
  }

  return {
    title: "Agent Skill 到底是什么？它不是 Prompt，也不是 MCP",
    thesis: "Agent Skill 的价值不是让提示词变长，而是把稳定、可验收的过程知识变成可发现、按需加载且可治理的能力单元。",
    targetDurationSeconds: 600,
    hook: "如果一套提示词每周都要复制三遍，它应该继续留在聊天框里，还是变成 Agent 可以反复调用的能力？",
    sections,
    closing: "把重复经验变成 Skill 之前，先定义触发条件、完成标准、权限边界和版本回退。",
    factCheckNotes: [
      "不同产品对 Skill 的发现、安装和运行时隔离实现不同，成片不把单一产品行为说成通用标准。",
      "产品可用范围和工作区权限可能变化，发布前需重新核对官方文档。",
      "研究论文中的社区风险比例需要单独核验样本和方法，本版脚本不引用该数字。"
    ]
  };
}

let generationCalls = 0;
const receivedFeedback = [];
const aiClient = {
  async generateStructured(taskId, request) {
    if (taskId !== "script") throw new Error(`离线脚本夹具不支持任务：${taskId}`);
    generationCalls += 1;
    const input = JSON.parse(request.input);
    receivedFeedback.push(structuredClone(input.reviewFeedback));
    return {
      provider: "offline-fixture",
      model: "agent-skill-script-fixture-v1",
      responseId: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      value: scriptDraft(input.reviewFeedback),
      attempts: []
    };
  }
};

const reviewConfig = await readReviewConfig();
reviewConfig.stages.script.semanticReview = true;
const semanticReviewer = async ({ context }) => {
  const draft = context.artifact?.content;
  const hasGovernanceLoop = draft?.sections?.some(
    (item) => item.heading === "治理不是上传之后再说"
  );
  const common = {
    stage: "script",
    artifactVersion: context.artifact?.version,
    rubricVersion: "script-v2",
    confidence: 0.97,
    warnings: [],
    passedChecks: ["claim-grounding", "concept-boundary", "product-decision"]
  };
  if (hasGovernanceLoop) {
    return { ...common, decision: "pass", blockingIssues: [] };
  }
  return {
    ...common,
    decision: "revise",
    blockingIssues: [
      {
        code: "MISSING_GOVERNANCE_LOOP",
        evidence: "脚本提到 Skill 可复用，但没有形成发布、权限、审计、更新和回退的完整治理闭环。",
        location: "script.sections",
        suggestedFix: "由 Script Agent 增加一节完整生命周期治理，并明确平台扫描不能替代组织审查。"
      }
    ]
  };
};

const reviewOptions = {
  config: reviewConfig,
  semanticReviewer,
  semanticReviewerId: "offline-agent-skill-script-reviewer-v1",
  semanticReviewerKind: "test-double"
};

const recheck = recheckRequested
  ? await recheckGateReview(episodeId, "script", { review: reviewOptions })
  : null;
const result = recheck?.review?.report.decision === "pass"
  ? null
  : await runAgent(episodeId, "script-agent", {
      aiClient,
      limits: { maxAttempts: 2, maxRevisionRounds: 1 },
      review: reviewOptions
    });

console.log(JSON.stringify({
  episodeId,
  recheck: recheck ? {
    decision: recheck.review?.report.decision,
    reportId: recheck.review?.report.id,
    rubricVersion: recheck.review?.report.rubricVersion,
    blockingIssues: recheck.review?.report.blockingIssues
  } : null,
  generationCalls,
  firstCallFeedback: receivedFeedback[0],
  revisionFeedback: receivedFeedback[1],
  output: result ? {
    status: result.output.status,
    message: result.output.message,
    requiresApproval: result.output.requiresApproval
  } : null,
  review: result ? {
    decision: result.review?.report.decision,
    reportId: result.review?.report.id,
    reviewMode: result.review?.report.reviewMode,
    semanticReviewerId: result.review?.report.semanticReviewerId,
    semanticReviewerKind: result.review?.report.semanticReviewerKind,
    artifactVersion: result.review?.report.artifactVersion,
    blockingIssues: result.review?.report.blockingIssues,
    warnings: result.review?.report.warnings
  } : null
}, null, 2));
