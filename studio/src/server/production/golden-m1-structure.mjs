import { GOLDEN_M1_PROFILE_ID } from "../../shared/production-profiles.mjs";

export const GOLDEN_M1_EPISODE_ID = "golden-001";
export const GOLDEN_M1_DURATION_SECONDS = 36;

const evidenceByScene = Object.freeze({
  S02: "demo-baseline-export-failed",
  S04: "demo-viewer-denied",
  S05: "demo-admin-export-complete"
});

const claimsByScene = Object.freeze({
  S01: ["C01"],
  S02: ["C09"],
  S03: ["C01", "C03"],
  S04: ["C06"],
  S05: ["C05", "C09"],
  S06: ["C01", "C10"]
});

const goldenM1ResearchSources = Object.freeze([
  { id: "S03", label: "Introducing Codex", url: "https://openai.com/index/introducing-codex/", publisher: "OpenAI", sourceType: "official-product" },
  { id: "S04", label: "Agents — Visual Studio Code", url: "https://code.visualstudio.com/docs/agents/concepts/agents", publisher: "Microsoft", sourceType: "official-documentation" },
  { id: "S05", label: "Jules 官方文档", url: "https://jules.google/docs/", publisher: "Google", sourceType: "official-documentation" },
  { id: "S06", label: "Tools — Visual Studio Code", url: "https://code.visualstudio.com/docs/copilot/concepts/tools", publisher: "Microsoft", sourceType: "official-documentation" },
  { id: "S07", label: "管理 Copilot coding agent sessions", url: "https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents", publisher: "GitHub", sourceType: "official-documentation" },
  { id: "S08", label: "Claude Code sandboxing", url: "https://www.anthropic.com/engineering/claude-code-sandboxing", publisher: "Anthropic", sourceType: "official-engineering" },
  { id: "S09", label: "VS Code Checkpoints", url: "https://code.visualstudio.com/docs/chat/chat-checkpoints", publisher: "Microsoft", sourceType: "official-documentation" },
  { id: "S10", label: "SWE-bench", url: "https://github.com/SWE-bench/SWE-bench", publisher: "SWE-bench", sourceType: "official-benchmark" },
  { id: "S12", label: "Terminal-Bench", url: "https://www.tbench.ai/news/announcement", publisher: "Terminal-Bench", sourceType: "official-benchmark" },
  { id: "S13", label: "Demystifying evals for AI agents", url: "https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents", publisher: "Anthropic", sourceType: "official-engineering" },
  { id: "S14", label: "Separating signal from noise in coding evaluations", url: "https://openai.com/index/separating-signal-from-noise-coding-evaluations/", publisher: "OpenAI", sourceType: "official-research" },
  { id: "S15", label: "Harness engineering", url: "https://openai.com/index/harness-engineering/", publisher: "OpenAI", sourceType: "official-engineering" }
]);

const goldenM1ResearchClaims = Object.freeze([
  {
    id: "C01",
    text: "Agentic Coding 不只返回代码文本，而是围绕目标在开发环境中读取、行动、验证并依据反馈修正。",
    category: "cross-source-definition",
    support: "high",
    sourceIds: ["S03", "S04", "S05", "S06"],
    boundary: "作为本片工作定义，不宣称是行业唯一标准。"
  },
  {
    id: "C03",
    text: "Agent loop 可概括为理解当前状态、采取行动、获取环境反馈、验证并继续迭代。",
    category: "mechanism",
    support: "high",
    sourceIds: ["S04", "S06"],
    boundary: "不声称所有产品使用同一固定步骤。"
  },
  {
    id: "C05",
    text: "部分主流 Coding Agent 能把多文件改动、测试结果、日志或 PR 作为交付证据。",
    category: "product-fact",
    support: "high",
    sourceIds: ["S03", "S05", "S07"],
    boundary: "只表述为部分产品能力。"
  },
  {
    id: "C06",
    text: "更高自治需要与沙箱、权限、日志、审批和回滚等控制机制配套。",
    category: "product-safety-synthesis",
    support: "high",
    sourceIds: ["S07", "S08", "S09"],
    boundary: "控制机制降低风险，但不能保证绝对安全。"
  },
  {
    id: "C09",
    text: "测试通过是重要反馈，但不等于需求正确、测试覆盖充分或可以安全上线。",
    category: "engineering-boundary",
    support: "high",
    sourceIds: ["S10", "S14", "S15"],
    boundary: "测试结果必须与需求、覆盖和发布判断分开。"
  },
  {
    id: "C10",
    text: "Agent 能力应按模型、harness、工具和环境的组合评估，不能只看底层模型榜单。",
    category: "evaluation-synthesis",
    support: "high",
    sourceIds: ["S10", "S12", "S13", "S15"],
    boundary: "不同 harness 与任务环境的结果不能直接互换。"
  }
]);

function invalid(message) {
  const error = new Error(`golden-001 36 秒结构无效：${message}`);
  error.code = "golden_m1_structure_invalid";
  throw error;
}

export function goldenM1ProductionProfile() {
  return {
    id: GOLDEN_M1_PROFILE_ID,
    targetDurationSeconds: GOLDEN_M1_DURATION_SECONDS
  };
}

export function buildGoldenM1ResearchCandidate(sourceDocs = []) {
  const registeredSources = Array.isArray(sourceDocs) ? sourceDocs.length : 0;
  return {
    status: "ready_for_fact_approval",
    version: 1,
    versions: [],
    packPath: null,
    assistTaskPath: null,
    generationKind: "deterministic-golden-m1-fixed-evidence",
    evidenceSource: "episodes/golden-001/03-claim-ledger.md",
    readiness: {
      readyForFactApproval: registeredSources >= 2,
      verifiedSourceCount: registeredSources,
      supportedClaimCount: goldenM1ResearchClaims.length,
      reasons: registeredSources >= 2 ? [] : ["固定研究来源登记不足"]
    },
    content: {
      schemaVersion: 1,
      kind: "golden-m1-fixed-research-v1",
      evidenceCutoff: "2026-07-31",
      claims: structuredClone(goldenM1ResearchClaims),
      sources: structuredClone(goldenM1ResearchSources),
      claimRequirements: [
        "具体产品能力只用于对应产品，不外推到全部 Coding Agent",
        "测试通过不等于业务正确、安全或允许发布",
        "沙箱和人工 Gate 降低风险，但不构成绝对安全保证"
      ],
      productDecisions: ["任务授权范围", "完成定义与验收", "人工接管和可逆性"]
    },
    needsRevision: false
  };
}

export function bindGoldenM1LogicalEvidence(scenes = []) {
  if (!Array.isArray(scenes) || scenes.length !== 6) invalid("必须恰好有六个场景");
  const ids = new Set(scenes.map((scene) => scene?.id));
  for (const id of ["S01", "S02", "S03", "S04", "S05", "S06"]) {
    if (!ids.has(id)) invalid(`缺少场景 ${id}`);
  }
  return scenes.map((scene) => {
    const expectedEvidence = evidenceByScene[scene.id] ?? null;
    if (!expectedEvidence) return { ...scene };
    return { ...scene, evidenceRef: expectedEvidence };
  });
}

export function buildGoldenM1ScriptContent(scenes = [], subtitles = []) {
  const boundScenes = bindGoldenM1LogicalEvidence(scenes);
  if (!Array.isArray(subtitles) || subtitles.length !== boundScenes.length) {
    invalid("六个场景必须逐一对应六段旁白");
  }
  const sections = boundScenes.map((scene, index) => {
    const subtitle = subtitles[index];
    if (
      !subtitle
      || subtitle.start !== scene.start
      || subtitle.end !== scene.end
      || typeof subtitle.text !== "string"
      || !subtitle.text.trim()
    ) {
      invalid(`${scene.id} 的旁白与场景时间轴不一致`);
    }
    return {
      id: scene.id,
      start: scene.start,
      end: scene.end,
      narration: subtitle.text,
      evidenceRefs: [...(claimsByScene[scene.id] ?? [])]
    };
  });
  return {
    schemaVersion: 1,
    kind: "golden-m1-short-script-v1",
    targetDurationSeconds: GOLDEN_M1_DURATION_SECONDS,
    sections,
    evidenceSource: "episodes/golden-001/03-claim-ledger.md"
  };
}

export function buildGoldenM1ScriptDraft(scenes = [], subtitles = []) {
  return {
    version: 1,
    generationKind: "deterministic-golden-m1-short-script",
    referenceSource: "episodes/golden-001/07-script.md",
    content: buildGoldenM1ScriptContent(scenes, subtitles)
  };
}

export function buildGoldenM1StoryboardDraft() {
  return {
    version: 1,
    generationKind: "deterministic-golden-m1-structure",
    sourceKind: "episode-scenes-subtitles-render-v1",
    referenceSource: "episodes/golden-001/08-storyboard.md"
  };
}
