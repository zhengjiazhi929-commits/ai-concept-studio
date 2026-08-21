import { runAgent } from "../src/server/orchestrator.mjs";

const episodeId = process.argv[2] ?? "agent-skill-20260806";
if (episodeId !== "agent-skill-20260806") {
  throw new Error("这个离线夹具只允许用于 agent-skill-20260806");
}

function diagram(id, purpose, sceneIds, sourceRequirement, rightsRequirement) {
  return {
    id,
    assetType: "diagram",
    purpose,
    sceneIds,
    sourceRequirement,
    rightsRequirement,
    required: true
  };
}

function assetPlan(reviewFeedback) {
  const revised = Array.isArray(reviewFeedback) && reviewFeedback.length > 0;
  const explicitRights = "项目原创图解；仅使用已批准研究结论；不得复制官方页面视觉资产";
  return {
    visualSystem: "9:16 浅色技术图解；深蓝标题、紫色强调、橙色证据标记；所有文字位于竖屏安全区",
    items: [
      diagram(
        "skill-anatomy",
        "解释长 Prompt 与可维护 Skill 的差异，并拆解 SKILL.md、scripts、references、assets",
        ["S02", "S04", "S06"],
        "依据 source-openai-skills、source-anthropic-skills 与 Agent Skills 规范制作原创示意",
        revised ? explicitRights : "版权边界待确认"
      ),
      diagram(
        "progressive-loading",
        "展示元数据、完整说明、按需资源三层渐进式加载",
        ["S08"],
        "依据 Agent Skills 规范与 Anthropic 官方说明制作原创流程图",
        explicitRights
      ),
      diagram(
        "skill-tool-mcp",
        "区分过程知识、执行动作与连接协议",
        ["S10"],
        "依据 MCP 官方规范、OpenAI Plugins 说明与已批准脚本制作原创分层图",
        explicitRights
      ),
      diagram(
        "skill-decision",
        "呈现何时值得固化 Skill 以及上线前五个判断问题",
        ["S12", "S16"],
        "依据已批准脚本中的稳定、重复、可验收、可复用标准制作原创决策卡",
        explicitRights
      ),
      diagram(
        "skill-governance",
        "呈现发布、授权、运行审计、更新、停用与回退闭环",
        ["S14"],
        "依据官方安全说明与已批准脚本制作原创生命周期图",
        explicitRights
      ),
      {
        id: "voice-narration",
        assetType: "voice",
        purpose: "覆盖全部 600 秒分镜的中文旁白",
        sceneIds: Array.from({ length: 18 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`),
        sourceRequirement: "只朗读已批准脚本，不补充新事实",
        rightsRequirement: "使用本机系统中文音色生成，仅用于离线流程测试，不作为正式发布音色",
        required: true
      }
    ],
    voiceDirection: {
      tone: "克制、清晰、解释型，不模仿任何真实人物",
      pacing: "目标 600 秒，保持自然停顿并与字幕时间轴对齐",
      pronunciationNotes: ["Agent Skill", "Prompt", "Tool", "MCP", "SKILL.md"]
    },
    risks: [
      revised
        ? "所有图解均需保留来源说明且不得伪装成官方产品截图"
        : "skill-anatomy 的版权边界尚未明确，素材总审前必须修订",
      "本机系统音色只用于离线验证，正式发布前必须重新选择获授权声音"
    ]
  };
}

let generationCalls = 0;
let receivedFeedback = null;
const aiClient = {
  async generateStructured(taskId, request) {
    if (taskId !== "assets") throw new Error(`离线素材夹具不支持任务：${taskId}`);
    generationCalls += 1;
    const input = JSON.parse(request.input);
    receivedFeedback = structuredClone(input.reviewFeedback);
    return {
      provider: "offline-fixture",
      model: "agent-skill-assets-fixture-v1",
      responseId: null,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      value: assetPlan(input.reviewFeedback),
      attempts: []
    };
  }
};

const result = await runAgent(episodeId, "asset-agent", {
  aiClient,
  limits: { maxAttempts: 1, maxRevisionRounds: 0 }
});

console.log(JSON.stringify({
  episodeId,
  generationCalls,
  receivedFeedback,
  output: {
    status: result.output.status,
    message: result.output.message,
    artifacts: result.output.artifacts,
    findings: result.output.findings
  },
  assetPlan: {
    version: result.episode.production?.assetPlan?.version,
    artifactPath: result.episode.production?.assetPlan?.artifactPath,
    requiredItems: result.episode.production?.assetPlan?.content?.items
      ?.filter((item) => item.required)
      .map((item) => item.id)
  }
}, null, 2));
