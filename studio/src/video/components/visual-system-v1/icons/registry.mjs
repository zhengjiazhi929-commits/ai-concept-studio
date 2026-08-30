import {
  AI_TECH_ICON_CONCEPT_KINDS,
  AI_TECH_ICON_CONTRACT_VERSION,
  AI_TECH_ICON_POLICY,
  AI_TECH_ICON_REGISTRY_APPROVAL,
  AI_TECH_ICON_REGISTRY_VERSION,
  assertAiTechIconConceptKind
} from "../../../../shared/ai-tech-icon-contract.mjs";
import { AI_TECH_ICON_GEOMETRY, aiTechIconGeometry } from "./geometry.mjs";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const AI_TECH_ICON_CATEGORIES = deepFreeze([
  { id: "content-input", label: "内容与输入" },
  { id: "data-knowledge", label: "数据与知识" },
  { id: "agent-runtime", label: "Agent 与运行时" },
  { id: "governance-state", label: "治理与状态" }
]);

const categoryIds = new Set(AI_TECH_ICON_CATEGORIES.map((category) => category.id));

const stateTokens = Object.freeze({
  neutral: Object.freeze({ primary: "text-primary", secondary: "accent-primary", surface: "surface" }),
  active: Object.freeze({ primary: "accent-primary", secondary: "text-primary", surface: "surface-muted" }),
  success: Object.freeze({ primary: "state-success", secondary: "state-success", surface: "surface" }),
  warning: Object.freeze({ primary: "state-warning", secondary: "state-warning", surface: "surface" }),
  error: Object.freeze({ primary: "state-error", secondary: "state-error", surface: "surface" }),
  human: Object.freeze({ primary: "accent-secondary", secondary: "text-primary", surface: "surface" })
});

function entry({
  conceptKind,
  canonicalIconId,
  category,
  labelZh,
  labelEn,
  defaultStateRole = "neutral",
  renderKind = "geometry",
  sourceType = "original-local-vector",
  contribution
}) {
  assertAiTechIconConceptKind(conceptKind);
  if (!categoryIds.has(category)) throw new TypeError(`未知 AI 技术图标分类：${category}`);
  if (!stateTokens[defaultStateRole]) throw new TypeError(`未知默认状态：${defaultStateRole}`);
  if (!["geometry", "status-mark"].includes(renderKind)) {
    throw new TypeError(`未知 AI 技术图标渲染类型：${renderKind}`);
  }
  return deepFreeze({
    contractVersion: AI_TECH_ICON_CONTRACT_VERSION,
    registryVersion: AI_TECH_ICON_REGISTRY_VERSION,
    status: AI_TECH_ICON_REGISTRY_APPROVAL.status,
    approval: AI_TECH_ICON_REGISTRY_APPROVAL,
    sourceType,
    conceptKind,
    canonicalIconId,
    category,
    labelZh,
    labelEn,
    defaultStateRole,
    allowedStateRoles: defaultStateRole === "neutral"
      ? ["neutral", "active"]
      : [defaultStateRole],
    contribution,
    viewBox: AI_TECH_ICON_POLICY.viewBox,
    tokenRoles: stateTokens[defaultStateRole],
    renderKind,
    geometry: renderKind === "geometry" ? aiTechIconGeometry(canonicalIconId) : null
  });
}

export const AI_TECH_ICON_REGISTRY = deepFreeze([
  entry({ conceptKind: "prompt", canonicalIconId: "prompt-bubble", category: "content-input", labelZh: "提示词", labelEn: "Prompt", contribution: "标记自然语言指令或提示词输入" }),
  entry({ conceptKind: "document", canonicalIconId: "document-sheet", category: "content-input", labelZh: "文档", labelEn: "Document", contribution: "标记文档、说明或结构化文本产物" }),
  entry({ conceptKind: "image", canonicalIconId: "image-frame", category: "content-input", labelZh: "图像", labelEn: "Image", contribution: "标记图像输入、视觉素材或视觉输出" }),
  entry({ conceptKind: "audio", canonicalIconId: "audio-wave", category: "content-input", labelZh: "音频", labelEn: "Audio", contribution: "标记语音、音频输入或音频处理" }),
  entry({ conceptKind: "video", canonicalIconId: "video-player", category: "content-input", labelZh: "视频", labelEn: "Video", contribution: "标记视频输入、生成或播放结果" }),
  entry({ conceptKind: "table-data", canonicalIconId: "table-grid", category: "content-input", labelZh: "表格数据", labelEn: "Table data", contribution: "标记表格、行列数据和结构化记录" }),
  entry({ conceptKind: "database", canonicalIconId: "database-stack", category: "data-knowledge", labelZh: "数据库", labelEn: "Database", contribution: "标记持久化数据源或查询目标" }),
  entry({ conceptKind: "knowledge-base", canonicalIconId: "knowledge-books", category: "data-knowledge", labelZh: "知识库", labelEn: "Knowledge base", contribution: "标记经过组织、可检索的知识集合" }),
  entry({ conceptKind: "search-retrieval", canonicalIconId: "retrieval-search", category: "data-knowledge", labelZh: "搜索检索", labelEn: "Search and retrieval", contribution: "标记查询、召回和检索动作" }),
  entry({ conceptKind: "vector-embedding", canonicalIconId: "vector-points", category: "data-knowledge", labelZh: "向量嵌入", labelEn: "Vector embedding", contribution: "标记向量关系、相似度或嵌入空间" }),
  entry({ conceptKind: "context-window", canonicalIconId: "context-window", category: "data-knowledge", labelZh: "上下文窗口", labelEn: "Context window", contribution: "标记模型当前可读取的上下文范围" }),
  entry({ conceptKind: "memory", canonicalIconId: "memory-chip", category: "data-knowledge", labelZh: "记忆", labelEn: "Memory", contribution: "标记 Agent 的短期或长期记忆存储" }),
  entry({ conceptKind: "ai-model", canonicalIconId: "model-layers", category: "agent-runtime", labelZh: "AI 模型", labelEn: "AI model", contribution: "标记模型推理层，不使用人物或机器人" }),
  entry({ conceptKind: "agent", canonicalIconId: "agent-node", category: "agent-runtime", labelZh: "Agent", labelEn: "Agent", contribution: "标记负责协调上下游能力的执行节点" }),
  entry({ conceptKind: "tool", canonicalIconId: "tool-wrench", category: "agent-runtime", labelZh: "工具", labelEn: "Tool", contribution: "标记可执行动作或外部能力" }),
  entry({ conceptKind: "api", canonicalIconId: "api-brackets", category: "agent-runtime", labelZh: "API", labelEn: "API", contribution: "标记程序接口和请求边界" }),
  entry({ conceptKind: "mcp", canonicalIconId: "mcp-bridge", category: "agent-runtime", labelZh: "MCP", labelEn: "MCP", contribution: "标记模型上下文协议连接，不等同于普通 API" }),
  entry({ conceptKind: "workflow", canonicalIconId: "workflow-nodes", category: "agent-runtime", labelZh: "工作流", labelEn: "Workflow", contribution: "标记有顺序和依赖的执行流程" }),
  entry({ conceptKind: "routing", canonicalIconId: "routing-branch", category: "agent-runtime", labelZh: "路由", labelEn: "Routing", contribution: "标记一次输入经判断进入不同结果" }),
  entry({ conceptKind: "parallel-execution", canonicalIconId: "parallel-lanes", category: "agent-runtime", labelZh: "并行执行", labelEn: "Parallel execution", contribution: "标记多个任务在同一阶段并行推进" }),
  entry({ conceptKind: "retry", canonicalIconId: "retry-cycle", category: "agent-runtime", labelZh: "重试", labelEn: "Retry", contribution: "标记受控重试而非无边界循环" }),
  entry({ conceptKind: "verified-success", canonicalIconId: "verified-status-mark", category: "governance-state", labelZh: "验证通过", labelEn: "Verified success", defaultStateRole: "success", renderKind: "status-mark", sourceType: "shared-visual-system-status-component", contribution: "只在可验证条件全部通过后显示，并统一复用共享方形状态对号" }),
  entry({ conceptKind: "warning", canonicalIconId: "warning-triangle", category: "governance-state", labelZh: "警告", labelEn: "Warning", defaultStateRole: "warning", contribution: "标记需要注意但尚未失败的状态" }),
  entry({ conceptKind: "failure", canonicalIconId: "failure-cross", category: "governance-state", labelZh: "失败", labelEn: "Failure", defaultStateRole: "error", contribution: "标记已经失败或被阻断的状态" }),
  entry({ conceptKind: "human-approval", canonicalIconId: "human-approval-gate", category: "governance-state", labelZh: "人工确认", labelEn: "Human approval", defaultStateRole: "human", contribution: "用非人物的选项面板标记人工决定 Gate，不绘制头像、机器人或另一套对号" }),
  entry({ conceptKind: "permission", canonicalIconId: "permission-lock", category: "governance-state", labelZh: "权限", labelEn: "Permission", contribution: "标记访问权限和执行边界" }),
  entry({ conceptKind: "audit-log", canonicalIconId: "audit-clipboard", category: "governance-state", labelZh: "审计日志", labelEn: "Audit log", contribution: "标记可追溯检查或审计记录" }),
  entry({ conceptKind: "version-history", canonicalIconId: "version-history", category: "governance-state", labelZh: "版本历史", labelEn: "Version history", contribution: "标记版本演进、回退或历史记录" })
]);

const byConceptKind = new Map(AI_TECH_ICON_REGISTRY.map((definition) => [definition.conceptKind, definition]));
const byCanonicalId = new Map(AI_TECH_ICON_REGISTRY.map((definition) => [definition.canonicalIconId, definition]));

if (AI_TECH_ICON_REGISTRY.length !== AI_TECH_ICON_CONCEPT_KINDS.length) {
  throw new Error("AI 技术图标注册数量与 conceptKind 合同不一致");
}
if (byConceptKind.size !== AI_TECH_ICON_REGISTRY.length || byCanonicalId.size !== AI_TECH_ICON_REGISTRY.length) {
  throw new Error("AI 技术图标 conceptKind 或 canonicalIconId 重复");
}
for (const conceptKind of AI_TECH_ICON_CONCEPT_KINDS) {
  if (!byConceptKind.has(conceptKind)) throw new Error(`AI 技术图标缺少稳定映射：${conceptKind}`);
}
const geometryEntries = AI_TECH_ICON_REGISTRY.filter(
  (definition) => definition.renderKind === "geometry"
);
if (Object.keys(AI_TECH_ICON_GEOMETRY).length !== geometryEntries.length) {
  throw new Error("AI 技术图标几何数量与几何渲染注册项不一致");
}
for (const definition of AI_TECH_ICON_REGISTRY) {
  if (definition.renderKind === "geometry" && definition.geometry == null) {
    throw new Error(`AI 技术图标缺少几何：${definition.conceptKind}`);
  }
  if (definition.renderKind === "status-mark" && definition.geometry !== null) {
    throw new Error(`共享状态对号不得注册第二套几何：${definition.conceptKind}`);
  }
}

export function aiTechIconDefinition(conceptKind, { allowNone = false } = {}) {
  const checked = assertAiTechIconConceptKind(conceptKind, { allowNone });
  if (checked == null) return null;
  return byConceptKind.get(checked);
}

export function aiTechIconDefinitionById(canonicalIconId) {
  const definition = byCanonicalId.get(canonicalIconId);
  if (!definition) throw new TypeError(`未注册的 canonicalIconId：${String(canonicalIconId)}`);
  return definition;
}

export function aiTechIconIdForConcept(conceptKind, options) {
  return aiTechIconDefinition(conceptKind, options)?.canonicalIconId ?? null;
}

export function aiTechIconTokenRolesForState(stateRole) {
  const tokens = stateTokens[stateRole];
  if (!tokens) throw new TypeError(`未知 AI 技术图标状态 token：${String(stateRole)}`);
  return tokens;
}
