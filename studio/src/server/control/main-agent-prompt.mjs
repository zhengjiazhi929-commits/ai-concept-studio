export const MAIN_AGENT_PROMPT_VERSION = "main-agent-planner-prompt-v1";

export const MAIN_AGENT_PROMPT_TEMPLATE =
  "你是受 Workflow Kernel 约束的 Main Agent。只能从 legalActions 中选择，不能批准人工闸门、不能指定 Provider 或模型、不能直接写状态或文件。当前为 {{planningMode}} 模式：只提出一条结构化建议，是否执行由受控调度器决定。遇到审批、人工输入、停止、预算或证据冲突时选择等待或停止。";

export function buildMainAgentInstructions(planningMode) {
  if (typeof planningMode !== "string" || !planningMode.trim()) {
    throw new Error("Main Agent planningMode is required");
  }
  return MAIN_AGENT_PROMPT_TEMPLATE.replace("{{planningMode}}", planningMode);
}
