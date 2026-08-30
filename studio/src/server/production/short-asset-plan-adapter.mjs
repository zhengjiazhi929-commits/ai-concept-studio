import { integrityHash } from "../../shared/integrity.mjs";
import {
  TECHNICAL_DIAGRAM_CONTRACT_VERSION,
  TECHNICAL_DIAGRAM_FORBIDDEN_PRIMITIVES,
  TECHNICAL_DIAGRAM_LOCAL_SEMANTIC_LAYER,
  TECHNICAL_DIAGRAM_REQUIRED_PRIMITIVES,
  TECHNICAL_DIAGRAM_SEMANTIC_LAYER,
  TECHNICAL_DIAGRAM_STYLE,
  progressiveTechnicalFlowPromptDirective
} from "../../shared/technical-diagram-contract.mjs";
import {
  AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS,
  buildAgentSkillShortDiagramMotionPolicy
} from "../../video/agent-skill-short-plan.mjs";
import { approvalValidForGate } from "../control/policy-engine.mjs";

export const APPROVED_STORYBOARD_SHORT_ASSET_ADAPTER_VERSION =
  "approved-storyboard-short-asset-plan-adapter-v10";

export { TECHNICAL_DIAGRAM_CONTRACT_VERSION };

export const SHORT_ASSET_PLAN_STRATEGIES = Object.freeze({
  LOCAL_ONLY: "local-only",
  HYBRID_API_SELECTIVE: "hybrid-api-selective"
});

export const HYBRID_GENERATION_PROFILES = Object.freeze({
  OPENAI_LEGACY: "openai-gpt-image-2-sora-2-v1",
  AIHUBMIX_VOLCENGINE_SEEDANCE_2_5_720P:
    "aihubmix-gpt-image-2-volcengine-seedance-2.5-720p-v1",
  AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P:
    "aihubmix-gemini-3-pro-image-volcengine-seedance-2.5-720p-v1"
});

export const SUPPORTED_HYBRID_GENERATION_PROFILES = Object.freeze(
  new Set(Object.values(HYBRID_GENERATION_PROFILES))
);

const OPENAI_PRICING_SOURCE = "https://developers.openai.com/api/docs/pricing";
const OPENAI_IMAGE_GUIDE_SOURCE =
  "https://developers.openai.com/api/docs/guides/image-generation";
const PRICING_CHECKED_AT = "2026-08-13T00:00:00+08:00";
const AIHUBMIX_MODEL_SOURCE = "https://aihubmix.com/model/gpt-image-2";
const AIHUBMIX_IMAGE_API_SOURCE = "https://docs.aihubmix.com/en/api/Image-Gen";
const AIHUBMIX_GEMINI_3_PRO_IMAGE_MODEL_SOURCE =
  "https://aihubmix.com/model/gemini-3-pro-image";
const AIHUBMIX_GEMINI_GUIDE_SOURCE =
  "https://docs.aihubmix.com/en/api/Gemini-Guides";
const GOOGLE_GEMINI_IMAGE_GUIDE_SOURCE =
  "https://ai.google.dev/gemini-api/docs/image-generation";
const VOLCENGINE_PRICING_SOURCE =
  "https://www.volcengine.com/docs/82379/1544106?lang=zh";
const VOLCENGINE_VIDEO_API_SOURCE =
  "https://www.volcengine.com/docs/82379/1520757?lang=zh";
const VOLCENGINE_SEEDANCE_2_5_TUTORIAL_SOURCE =
  "https://www.volcengine.com/docs/82379/2607688?lang=zh";
const PROVIDER_PRICING_CHECKED_AT = "2026-08-14T01:30:00+08:00";
const SEEDANCE_2_5_ESTIMATED_COMPLETION_TOKENS = 172800;
const SEEDANCE_2_5_ESTIMATED_COST_CNY = 12.096;
const SEEDANCE_2_5_MAXIMUM_COST_CNY = 13;
const CNY_PER_USD_BUDGET_GUARD_RATE = 6.5;
const LOCAL_METHOD = Object.freeze({
  kind: "local-code-animation",
  executor: "render.local",
  externalProvider: null,
  externalModel: null,
  notes: "使用仓库内矢量组件和代码动画制作，不上传内容，不调用外部推理服务。"
});

const ZERO_API_COST = Object.freeze({
  currency: "USD",
  unitCount: 0,
  unitPriceUsd: 0,
  maximumCostUsd: 0,
  pricingStatus: "not-applicable",
  pricingSource: "",
  pricingCheckedAt: null
});

function localDiagram(
  id,
  purpose,
  sceneIds,
  sourceRequirement,
  { assetType = "technical-diagram", visualContract = null } = {}
) {
  return {
    id,
    assetType,
    purpose,
    sceneIds,
    sourceRequirement,
    rightsRequirement:
      "项目原创本地矢量与代码动画；只承接已批准分镜，不复制第三方界面、品牌素材或库存素材。",
    required: true,
    productionMethod: { ...LOCAL_METHOD },
    ...(visualContract ? { visualContract } : {}),
    estimatedCost: { ...ZERO_API_COST }
  };
}

function externalGenerationItem({
  id,
  assetType,
  purpose,
  sceneIds,
  sourceRequirement,
  kind,
  executor,
  model,
  providerId = "openai",
  unitCount,
  unitPriceUsd,
  maximumCostUsd,
  estimatedCost = null,
  pricingSource = null,
  pricingCheckedAt = PRICING_CHECKED_AT,
  notes,
  visualContract = null
}) {
  return {
    id,
    assetType,
    purpose,
    sceneIds,
    sourceRequirement,
    rightsRequirement:
      "仅生成原创技术图解或概念视觉；禁止第三方品牌、Logo、人物肖像、受保护角色、真实产品界面和可识别库存素材。保留提示词、请求记录、模型与输出摘要，生成结果仍须人工相似性与合规复核。",
    required: true,
    productionMethod: {
      kind,
      executor,
      externalProvider: providerId,
      externalModel: model,
      notes
    },
    ...(visualContract ? { visualContract } : {}),
    estimatedCost: estimatedCost ?? {
      currency: "USD",
      unitCount,
      unitPriceUsd,
      maximumCostUsd,
      pricingStatus: "confirmed",
      pricingSource: pricingSource ?? (kind === "external-image-generation"
        ? `${OPENAI_PRICING_SOURCE} ; ${OPENAI_IMAGE_GUIDE_SOURCE}`
        : OPENAI_PRICING_SOURCE),
      pricingCheckedAt
    }
  };
}

function externalCall({
  id,
  model,
  providerId = "openai",
  purpose,
  sceneIds,
  maximumCostUsd,
  pricingSource = OPENAI_PRICING_SOURCE,
  pricingCheckedAt = PRICING_CHECKED_AT,
  endpoint,
  prompt,
  outputSpec,
  billing = null,
  requestParameters = null,
  executionPreflight = null,
  visualContract = null
}) {
  return {
    id,
    providerId,
    model,
    purpose,
    sceneIds,
    estimatedCalls: 1,
    maximumCostUsd,
    pricingSource,
    pricingCheckedAt,
    endpoint,
    prompt,
    outputSpec,
    ...(billing ? { billing } : {}),
    ...(requestParameters ? { requestParameters } : {}),
    ...(executionPreflight ? { executionPreflight } : {}),
    ...(visualContract ? { visualContract } : {})
  };
}

function approvedSceneRequirements(episode, sceneIds) {
  const requested = new Set(sceneIds);
  const requirements = [...new Set((episode.scenes ?? [])
    .filter((scene) => requested.has(scene.id))
    .map((scene) => String(scene.assetHint ?? "").trim())
    .filter(Boolean))];
  if (requirements.length === 0) {
    throw new Error(`技术图合同缺少批准分镜要求：${sceneIds.join(", ")}`);
  }
  return requirements;
}

function technicalVisualContract({
  episode,
  kind,
  readingDirection,
  sceneIds,
  nodes,
  edges,
  motionPolicy = null,
  semanticLayer = TECHNICAL_DIAGRAM_SEMANTIC_LAYER
}) {
  return {
    schemaVersion: TECHNICAL_DIAGRAM_CONTRACT_VERSION,
    kind,
    style: TECHNICAL_DIAGRAM_STYLE,
    readingDirection,
    semanticLayer,
    sourceSceneIds: [...sceneIds],
    sourceRequirements: approvedSceneRequirements(episode, sceneIds),
    nodes: nodes.map((node) => ({ ...node })),
    edges: edges.map((edge) => ({ ...edge, directed: true })),
    motionPolicy: motionPolicy ? structuredClone(motionPolicy) : null,
    requiredPrimitives: [...TECHNICAL_DIAGRAM_REQUIRED_PRIMITIVES],
    forbiddenPrimitives: [...TECHNICAL_DIAGRAM_FORBIDDEN_PRIMITIVES]
  };
}

function contractFromDiagramSpec(episode, diagramId, options = {}) {
  const spec = AGENT_SKILL_SHORT_TECHNICAL_DIAGRAMS[diagramId];
  if (!spec) throw new Error(`未知本地技术图：${diagramId}`);
  return technicalVisualContract({
    episode,
    kind: spec.kind,
    readingDirection: diagramId === "architecture" ? "top-to-bottom" : "left-to-right",
    sceneIds: [...spec.sceneIds],
    nodes: spec.nodes.map(({ id, label, role }) => ({ id, label, role })),
    edges: spec.edges.map(({ id, from, to, relation }) => ({ id, from, to, relation })),
    motionPolicy: options.includeMotion
      ? buildAgentSkillShortDiagramMotionPolicy(
          diagramId,
          options.durationSeconds ?? spec.durationSeconds
        )
      : null,
    semanticLayer: options.semanticLayer ?? TECHNICAL_DIAGRAM_SEMANTIC_LAYER
  });
}

function technicalContracts(episode, options = {}) {
  const local = options.local === true;
  const contractOptions = local
    ? { includeMotion: true, semanticLayer: TECHNICAL_DIAGRAM_LOCAL_SEMANTIC_LAYER }
    : {};
  return {
    architecture: contractFromDiagramSpec(episode, "architecture", contractOptions),
    weeklyReport: contractFromDiagramSpec(episode, "weeklyReport", contractOptions),
    flow: contractFromDiagramSpec(episode, "flow", local
      ? contractOptions
      : { includeMotion: true, durationSeconds: 8 }),
    comparison: contractFromDiagramSpec(episode, "comparison", contractOptions)
  };
}

function technicalPrompts(contracts) {
  const approvedArchitecture = contracts.architecture.sourceRequirements.join(" | ");
  const approvedFlow = contracts.flow.sourceRequirements.join(" | ");
  const approvedComparison = contracts.comparison.sourceRequirements.join(" | ");
  return {
    architecture:
      `Create a clean vertical AI research-paper-style system architecture diagram, not an editorial illustration or decorative concept art. Approved storyboard requirements: ${approvedArchitecture}. Use five stable unlabeled flat rectangular modules with consistent borders: a top process-knowledge module guiding a central Agent module; from the Agent, one directed branch reaches an executable Tool action module, while a second directed branch passes through a clearly bounded MCP protocol module to an external-capability module. Use visible arrowheads, orthogonal connectors, explicit group boundaries and an unambiguous top-to-bottom reading order. Keep module interiors empty for precise local Chinese labels and progressive highlights. Plain warm off-white background, graphite strokes with restrained mint and orange state accents, almost no texture and no ornamental depth. No text, letters, numbers, logos, brands, people, product UI, screenshots, code, watermarks, abstract blobs, cloud metaphors, gears, rings, waves, decorative particles, ornamental gradients, or extra metaphorical objects.`,
    flow:
      `Create an eight-second vertical AI research-paper-style technical process animation that teaches operating logic through progressive construction, not an abstract data-stream clip. Approved storyboard requirements: ${approvedFlow}. Begin from a clean minimal canvas with no complete diagram visible. Follow this exact timeline: ${progressiveTechnicalFlowPromptDirective(contracts.flow)}. The six unlabeled rectangular concepts are Agent request, database query Tool, document write Tool, MCP protocol bridge, external capability and returned result. Add at most one new module per reveal phase, draw each approved directed connector only after both endpoint modules exist, and keep every earlier module and connector visible. Do not show the complete architecture in the first frame, do not reveal multiple modules at once, and do not substitute moving light packets, glow or decorative motion for the required step-by-step build. Use visible arrowheads, orthogonal paths, stable geometry, a fixed camera and a left-to-right reading order so each causal step remains legible. Keep module interiors empty for precise local Chinese labels. Plain warm off-white background, graphite lines and restrained mint/orange state highlights. No text, letters, numbers, logos, brands, people, product UI, screenshots, code, dashboards, watermarks, abstract blobs, clouds, gears, rings, waves, floating particles, dramatic sci-fi effects, decorative camera drift, or invented results. The generated audio will be discarded.`,
    comparison:
      `Create a clean vertical AI research-paper-style comparison diagram, not a decorative split background. Approved storyboard requirements: ${approvedComparison}. Build two equal peer columns with stable unlabeled rectangular modules and directed connectors. The left column shows an executable Tool action followed by a clearly empty dashed slot for missing method, sequence and acceptance criteria. The right column shows connected method and sequence modules followed by a clearly empty dashed slot for the missing execution channel. Keep both columns equal in hierarchy, use explicit group boundaries and leave module interiors empty for precise local Chinese labels. Plain warm off-white background, graphite strokes with restrained mint and orange state accents, almost no texture. No text, letters, numbers, logos, brands, people, product UI, screenshots, code, watermarks, abstract blobs, cloud metaphors, gears, rings, waves, warning symbols, ornamental gradients, or extra metaphorical objects.`
  };
}

function openAiHybridEnhancements(episode) {
  const imageModel = "gpt-image-2-2026-04-21";
  const videoModel = "sora-2";
  const contracts = technicalContracts(episode);
  const prompts = technicalPrompts(contracts);
  const items = [
    externalGenerationItem({
      id: "generated-architecture-depth-plate",
      assetType: "generated-image",
      purpose:
        "为 S01–S04 生成论文式 Skill、Agent、Tool、MCP 与外部能力结构图；生成图负责节点、分组和有向连线，本地代码叠加精确标签与逐层动画。",
      sceneIds: ["S01", "S02", "S03", "S04"],
      sourceRequirement:
        "只承接批准分镜中的三层架构关系；生成图不得自行添加文字、图标含义、品牌或新比喻。",
      kind: "external-image-generation",
      executor: "openai.images",
      model: imageModel,
      unitCount: 1,
      unitPriceUsd: 0.041,
      maximumCostUsd: 0.06,
      notes:
        "生成 1024x1536 medium PNG 无文字技术架构图；模型必须画出获批节点、分组和有向连线，中文标签与逐步高亮由本地代码完成。",
      visualContract: contracts.architecture
    }),
    externalGenerationItem({
      id: "generated-mcp-data-flow-clip",
      assetType: "generated-video",
      purpose:
        "为 S06–S07 生成 8 秒论文式技术流程动画，从空白起点逐步建立 Agent 请求、数据库查询、文档写入、MCP 连接、外部能力与结果返回。",
      sceneIds: ["S06", "S07"],
      sourceRequirement:
        "严格按获批顺序逐步表现 Agent 请求、数据库查询、文档写入、MCP 发现调用、外部能力与结果返回；不得首帧展示完整架构，不得生成虚构产品界面、字段、结果数字或新的系统能力。",
      kind: "external-video-generation",
      executor: "openai.videos",
      model: videoModel,
      unitCount: 8,
      unitPriceUsd: 0.1,
      maximumCostUsd: 0.8,
      notes:
        "生成 720x1280、8 秒竖屏技术流程片段；丢弃模型音轨，严格按阶段一次新增一个节点并保留前序结构，准确标签与字幕由本地代码叠加。",
      visualContract: contracts.flow
    }),
    externalGenerationItem({
      id: "generated-capability-boundary-plate",
      assetType: "generated-image",
      purpose:
        "为 S08–S09 生成论文式双列能力边界对照图，清楚表现只有 Tool 与只有 Skill 时各自拥有和缺失的环节。",
      sceneIds: ["S08", "S09"],
      sourceRequirement:
        "只表现获批的双列能力边界、已有环节和缺失槽位；结论和文字必须来自批准脚本并由本地代码呈现。",
      kind: "external-image-generation",
      executor: "openai.images",
      model: imageModel,
      unitCount: 1,
      unitPriceUsd: 0.041,
      maximumCostUsd: 0.06,
      notes:
        "生成 1024x1536 medium PNG 无文字技术对照图；模型负责同级模块、缺口槽位和连线，中文标签由本地代码叠加。",
      visualContract: contracts.comparison
    })
  ];
  const calls = [
    externalCall({
      id: "openai-image-architecture-v2",
      model: imageModel,
      purpose: "生成三层关系的无文字论文式技术架构图",
      sceneIds: ["S01", "S02", "S03", "S04"],
      maximumCostUsd: 0.06,
      endpoint: "/v1/images/generations",
      prompt: prompts.architecture,
      outputSpec: "1 PNG, 1024x1536, quality=medium, opaque background",
      visualContract: contracts.architecture
    }),
    externalCall({
      id: "openai-video-mcp-flow-v3",
      model: videoModel,
      purpose: "生成 MCP 外部能力连接的技术流程动画",
      sceneIds: ["S06", "S07"],
      maximumCostUsd: 0.8,
      endpoint: "/v1/videos",
      prompt: prompts.flow,
      outputSpec: "1 MP4, 720x1280 portrait, 8 seconds; generated audio discarded",
      visualContract: contracts.flow
    }),
    externalCall({
      id: "openai-image-boundary-v2",
      model: imageModel,
      purpose: "生成能力边界对照的无文字技术对照图",
      sceneIds: ["S08", "S09"],
      maximumCostUsd: 0.06,
      endpoint: "/v1/images/generations",
      prompt: prompts.comparison,
      outputSpec: "1 PNG, 1024x1536, quality=medium, opaque background",
      visualContract: contracts.comparison
    })
  ];
  return { items, calls };
}

function aihubmixVolcengineEnhancements(profile, episode) {
  const usesGeminiProImage = profile ===
    HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P;
  const imageModel = usesGeminiProImage
    ? "gemini-3-pro-image"
    : "gpt-image-2";
  const videoModel = "doubao-seedance-2-5-260628";
  const contracts = technicalContracts(episode);
  const prompts = technicalPrompts(contracts);
  const imagePricingSource = usesGeminiProImage
    ? `${AIHUBMIX_GEMINI_3_PRO_IMAGE_MODEL_SOURCE} ; ${AIHUBMIX_GEMINI_GUIDE_SOURCE} ; ${GOOGLE_GEMINI_IMAGE_GUIDE_SOURCE}`
    : `${AIHUBMIX_MODEL_SOURCE} ; ${AIHUBMIX_IMAGE_API_SOURCE} ; ${OPENAI_IMAGE_GUIDE_SOURCE}`;
  const videoPricingSource =
    `${VOLCENGINE_PRICING_SOURCE} ; ${VOLCENGINE_VIDEO_API_SOURCE} ; ${VOLCENGINE_SEEDANCE_2_5_TUTORIAL_SOURCE}`;
  const imageBilling = Object.freeze(usesGeminiProImage
    ? {
        currency: "USD",
        estimatedAmount: 0.134,
        maximumAmount: 0.15,
        basis:
          "AIHubMix Gemini 3 Pro Image lists approximately USD 0.134 per 1K or 2K image; USD 0.15 is the per-image hard cap"
      }
    : {
        currency: "USD",
        estimatedAmount: 0.041,
        maximumAmount: 0.06,
        basis:
          "GPT Image 2 medium 1024x1536 output estimate USD 0.041; prompt text tokens remain inside the USD 0.06 hard cap"
      });
  const imageUnitPriceUsd = usesGeminiProImage ? 0.134 : 0.041;
  const imageMaximumCostUsd = usesGeminiProImage ? 0.15 : 0.06;
  const imageEndpoint = usesGeminiProImage
    ? "https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image:generateContent"
    : "https://aihubmix.com/v1/images/generations";
  const imageOutputSpec = usesGeminiProImage
    ? "1 PNG, 2K, 9:16 portrait, response modalities IMAGE only"
    : "1 PNG, 1024x1536, quality=medium, background=opaque";
  const imageRequestParameters = (prompt) => usesGeminiProImage
    ? {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: "9:16",
            imageSize: "2K"
          }
        }
      }
    : {
        model: imageModel,
        n: 1,
        size: "1024x1536",
        quality: "medium",
        background: "opaque",
        output_format: "png"
      };
  const videoBilling = Object.freeze({
    currency: "CNY",
    estimatedAmount: SEEDANCE_2_5_ESTIMATED_COST_CNY,
    maximumAmount: SEEDANCE_2_5_MAXIMUM_COST_CNY,
    estimatedUnits: SEEDANCE_2_5_ESTIMATED_COMPLETION_TOKENS,
    unit: "completion_token",
    unitPrice: 70,
    unitPriceBasis: 1000000,
    basis: "CNY 70 per 1,000,000 completion tokens for 720p without video input",
    formula:
      "8s * 1280 * 720 * 24fps / 1024 = 172800 completion tokens; 172800 * CNY 70 / 1000000 = CNY 12.096",
    normalizedMaximumCostUsd: 2,
    normalizationPolicy:
      `conservative workflow budget envelope at no less than ${CNY_PER_USD_BUDGET_GUARD_RATE} CNY per USD`
  });
  const commonPreflight = Object.freeze({
    credentialPresenceRequired: true,
    modelAvailabilityRequired: true,
    pricingRevalidationRequired: true,
    noGenerationAllowed: true,
    failClosedOnMismatch: true
  });
  const imagePromptArchitecture = prompts.architecture;
  const videoPrompt = prompts.flow;
  const imagePromptBoundary = prompts.comparison;
  const items = [
    externalGenerationItem({
      id: "generated-architecture-depth-plate",
      assetType: "generated-image",
      purpose:
        "为 S01–S04 生成论文式 Skill、Agent、Tool、MCP 与外部能力结构图；生成图负责节点、分组和有向连线，本地代码叠加精确标签与逐层动画。",
      sceneIds: ["S01", "S02", "S03", "S04"],
      sourceRequirement:
        "只承接批准分镜中的三层架构关系；生成图不得自行添加文字、图标含义、品牌或新比喻。",
      kind: "external-image-generation",
      executor: "aihubmix.images",
      providerId: "aihubmix",
      model: imageModel,
      estimatedCost: {
        currency: "USD",
        unitCount: 1,
        unitPriceUsd: imageUnitPriceUsd,
        maximumCostUsd: imageMaximumCostUsd,
        pricingStatus: "confirmed",
        pricingSource: imagePricingSource,
        pricingCheckedAt: PROVIDER_PRICING_CHECKED_AT
      },
      notes: usesGeminiProImage
        ? "经 AIHubMix Gemini 3 Pro Image 生成 2K、9:16 PNG 无文字技术架构图；模型必须画出获批节点、分组和有向连线，中文标签与逐步高亮由本地代码完成。"
        : "经 AIHubMix 生成 1024x1536 medium PNG 无文字技术架构图；请求超时至少 10 分钟。模型负责结构，本地代码负责准确标签。",
      visualContract: contracts.architecture
    }),
    externalGenerationItem({
      id: "generated-mcp-data-flow-clip",
      assetType: "generated-video",
      purpose:
        "为 S06–S07 生成 8 秒论文式技术流程动画，从空白起点逐步建立 Agent 请求、数据库查询、文档写入、MCP 连接、外部能力与结果返回。",
      sceneIds: ["S06", "S07"],
      sourceRequirement:
        "严格按获批顺序逐步表现 Agent 请求、数据库查询、文档写入、MCP 发现调用、外部能力与结果返回；不得首帧展示完整架构，不得生成虚构产品界面、字段、结果数字或新的系统能力。",
      kind: "external-video-generation",
      executor: "volcengine.contents.generations.tasks",
      providerId: "volcengine-ark",
      model: videoModel,
      estimatedCost: {
        currency: "CNY",
        unitCount: SEEDANCE_2_5_ESTIMATED_COMPLETION_TOKENS,
        unitPriceCnyPerMillion: 70,
        estimatedCostCny: SEEDANCE_2_5_ESTIMATED_COST_CNY,
        maximumCostCny: SEEDANCE_2_5_MAXIMUM_COST_CNY,
        maximumCostUsd: 2,
        pricingStatus: "confirmed",
        pricingSource: videoPricingSource,
        pricingCheckedAt: PROVIDER_PRICING_CHECKED_AT
      },
      notes:
        "使用火山方舟 Seedance 2.5 生成 720x1280、8 秒、24fps 竖屏无声技术流程片段；严格按阶段一次新增一个节点并保留前序结构，模型或价格预检不一致即停止，不自动降级。",
      visualContract: contracts.flow
    }),
    externalGenerationItem({
      id: "generated-capability-boundary-plate",
      assetType: "generated-image",
      purpose:
        "为 S08–S09 生成论文式双列能力边界对照图，清楚表现只有 Tool 与只有 Skill 时各自拥有和缺失的环节。",
      sceneIds: ["S08", "S09"],
      sourceRequirement:
        "只表现获批的双列能力边界、已有环节和缺失槽位；结论和文字必须来自批准脚本并由本地代码呈现。",
      kind: "external-image-generation",
      executor: "aihubmix.images",
      providerId: "aihubmix",
      model: imageModel,
      estimatedCost: {
        currency: "USD",
        unitCount: 1,
        unitPriceUsd: imageUnitPriceUsd,
        maximumCostUsd: imageMaximumCostUsd,
        pricingStatus: "confirmed",
        pricingSource: imagePricingSource,
        pricingCheckedAt: PROVIDER_PRICING_CHECKED_AT
      },
      notes: usesGeminiProImage
        ? "经 AIHubMix Gemini 3 Pro Image 生成 2K、9:16 PNG 无文字技术对照图；模型负责同级模块、缺口槽位和连线，中文标签由本地代码叠加。"
        : "经 AIHubMix 生成 1024x1536 medium PNG 无文字技术对照图；模型负责结构，本地代码负责准确标签。",
      visualContract: contracts.comparison
    })
  ];
  const calls = [
    externalCall({
      id: usesGeminiProImage
        ? "aihubmix-gemini-pro-image-architecture-v2"
        : "aihubmix-image-architecture-v2",
      providerId: "aihubmix",
      model: imageModel,
      purpose: "生成三层关系的无文字论文式技术架构图",
      sceneIds: ["S01", "S02", "S03", "S04"],
      maximumCostUsd: imageMaximumCostUsd,
      pricingSource: imagePricingSource,
      pricingCheckedAt: PROVIDER_PRICING_CHECKED_AT,
      endpoint: imageEndpoint,
      prompt: imagePromptArchitecture,
      outputSpec: imageOutputSpec,
      billing: imageBilling,
      requestParameters: imageRequestParameters(imagePromptArchitecture),
      executionPreflight: commonPreflight,
      visualContract: contracts.architecture
    }),
    externalCall({
      id: "volcengine-seedance-video-mcp-flow-v3",
      providerId: "volcengine-ark",
      model: videoModel,
      purpose: "生成 MCP 外部能力连接的论文式技术流程动画",
      sceneIds: ["S06", "S07"],
      maximumCostUsd: 2,
      pricingSource: videoPricingSource,
      pricingCheckedAt: PROVIDER_PRICING_CHECKED_AT,
      endpoint: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
      prompt: videoPrompt,
      outputSpec:
        "1 MP4, 720x1280 portrait, 24fps, 8 seconds, no generated audio; estimated 172800 completion tokens",
      billing: videoBilling,
      requestParameters: {
        model: videoModel,
        content: [{
          type: "text",
          text: videoPrompt
        }],
        generate_audio: false,
        ratio: "9:16",
        resolution: "720p",
        duration: 8,
        watermark: false
      },
      executionPreflight: commonPreflight,
      visualContract: contracts.flow
    }),
    externalCall({
      id: usesGeminiProImage
        ? "aihubmix-gemini-pro-image-boundary-v2"
        : "aihubmix-image-boundary-v2",
      providerId: "aihubmix",
      model: imageModel,
      purpose: "生成能力边界的无文字论文式技术对照图",
      sceneIds: ["S08", "S09"],
      maximumCostUsd: imageMaximumCostUsd,
      pricingSource: imagePricingSource,
      pricingCheckedAt: PROVIDER_PRICING_CHECKED_AT,
      endpoint: imageEndpoint,
      prompt: imagePromptBoundary,
      outputSpec: imageOutputSpec,
      billing: imageBilling,
      requestParameters: imageRequestParameters(imagePromptBoundary),
      executionPreflight: commonPreflight,
      visualContract: contracts.comparison
    })
  ];
  return { items, calls };
}

function hybridEnhancements(profile, episode) {
  if (profile === HYBRID_GENERATION_PROFILES.OPENAI_LEGACY) {
    return openAiHybridEnhancements(episode);
  }
  if (new Set([
    HYBRID_GENERATION_PROFILES.AIHUBMIX_VOLCENGINE_SEEDANCE_2_5_720P,
    HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P
  ]).has(profile)) {
    return aihubmixVolcengineEnhancements(profile, episode);
  }
  throw new Error(`不支持的混合生成配置：${profile}`);
}

export function approvedStoryboardIdentity(episode) {
  if (!approvalValidForGate(episode, "storyboard")) {
    throw new Error("当前分镜没有有效的机器审核与人工批准绑定");
  }
  const approval = episode.approvals.storyboard;
  return {
    version: approval.currentVersion,
    artifactHash: approval.artifactHash,
    reviewReportId: approval.reviewReportId
  };
}

function assertSupportedDerivedEpisode(episode) {
  if (episode.derivation?.kind !== "approved-script-section-v1") {
    throw new Error("只有绑定批准源脚本的派生 Episode 才能使用确定性素材方案适配器");
  }
  if ((episode.scenes ?? []).length === 0) {
    throw new Error("已批准分镜没有场景，不能建立素材方案");
  }
}

export function adaptApprovedStoryboardToShortAssetPlan(episode) {
  assertSupportedDerivedEpisode(episode);
  const sourceStoryboard = approvedStoryboardIdentity(episode);
  const sceneIds = episode.scenes.map((scene) => scene.id);
  const requiredSceneIds = new Set(sceneIds);
  const localContracts = technicalContracts(episode, { local: true });
  const localItems = [
    localDiagram(
      "skill-tool-mcp-layers",
      "用论文式系统架构图逐步解释 Skill 如何指导 Agent，以及 Agent 如何分别调用 Tool、通过 MCP 连接外部能力。",
      ["S01", "S02", "S03", "S04"],
      "逐镜承接已批准分镜 S01–S04 的标题、关系和动画提示。",
      { visualContract: localContracts.architecture }
    ),
    localDiagram(
      "weekly-report-process",
      "把周报任务拆成核对指标定义、检查异常、按固定结构写结论的连续流程动画。",
      ["S05"],
      "逐镜承接已批准分镜 S05 的周报步骤与验收顺序。",
      { visualContract: localContracts.weeklyReport }
    ),
    localDiagram(
      "tool-and-mcp-actions",
      "展示数据库查询、文档写入 Tool 被触发，以及外部能力通过 MCP 被发现和调用。",
      ["S06", "S07"],
      "逐镜承接已批准分镜 S06–S07 的动作节点与连接关系。",
      { visualContract: localContracts.flow }
    ),
    localDiagram(
      "capability-boundary-contrast",
      "用同级简约卡片对照只有 Tool 与只有 Skill 时分别缺失的顺序、验收标准和执行能力。",
      ["S08", "S09"],
      "逐镜承接已批准分镜 S08–S09 的能力边界，不新增比喻或事实。",
      { visualContract: localContracts.comparison }
    ),
    localDiagram(
      "subtitle-and-progress-chrome",
      "实现透明小字号字幕与按实际场景时长分段的底部全宽矩形文字进度条。",
      sceneIds,
      "完整继承已批准分镜的字幕、进度条、安全区和显示层规则。",
      { assetType: "ui-overlay" }
    ),
    {
      id: "voice-narration",
      assetType: "voice",
      purpose: "覆盖 60 秒批准脚本的自然中文旁白；声音制作由 Voice Agent 单独处理和审核。",
      sceneIds,
      sourceRequirement: "只朗读已批准脚本和字幕，不补充新事实，不模仿真实人物。",
      rightsRequirement:
        "优先本人录音或明确授权的自然音色；本方案不授权任何外部付费声音合成或克隆调用。",
      required: true,
      productionMethod: {
        kind: "deferred-voice-agent",
        executor: "voice-agent",
        externalProvider: null,
        externalModel: null,
        notes: "进入 Voice Agent 后另行登记来源、授权与试听文件。"
      },
      estimatedCost: { ...ZERO_API_COST }
    }
  ];
  const direction = episode.production?.assetPlanDirection ?? {};
  const strategy = direction.strategy
    ?? SHORT_ASSET_PLAN_STRATEGIES.LOCAL_ONLY;
  if (!Object.values(SHORT_ASSET_PLAN_STRATEGIES).includes(strategy)) {
    throw new Error(`不支持的短片素材策略：${strategy}`);
  }
  const generationProfile = strategy === SHORT_ASSET_PLAN_STRATEGIES.HYBRID_API_SELECTIVE
    ? direction.generationProfile ?? HYBRID_GENERATION_PROFILES.OPENAI_LEGACY
    : null;
  if (generationProfile && !SUPPORTED_HYBRID_GENERATION_PROFILES.has(generationProfile)) {
    throw new Error(`不支持的短片生成配置：${generationProfile}`);
  }
  const usesAihubmixVolcengine = new Set([
    HYBRID_GENERATION_PROFILES.AIHUBMIX_VOLCENGINE_SEEDANCE_2_5_720P,
    HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P
  ]).has(generationProfile);
  const usesGeminiProImage = generationProfile ===
    HYBRID_GENERATION_PROFILES.AIHUBMIX_GEMINI_3_PRO_IMAGE_VOLCENGINE_SEEDANCE_2_5_720P;
  const imageNativeCapUsd = usesGeminiProImage ? 0.3 : 0.12;
  const normalizedMaximumPaidCostUsd = usesGeminiProImage ? 2.35 : 2.25;
  const enhancements = strategy === SHORT_ASSET_PLAN_STRATEGIES.HYBRID_API_SELECTIVE
    ? hybridEnhancements(generationProfile, episode)
    : { items: [], calls: [] };
  const registeredExternalRights = direction.externalRightsDeclarations;
  const externalCalls = enhancements.calls.map((call) => {
    const declaration = registeredExternalRights &&
      typeof registeredExternalRights === "object" &&
      !Array.isArray(registeredExternalRights)
      ? registeredExternalRights[call.id]
      : null;
    return declaration
      ? { ...call, rightsDeclaration: structuredClone(declaration) }
      : call;
  });
  const items = [...localItems, ...enhancements.items];
  const coveredScenes = new Set(
    items
      .filter((item) => item.required && item.assetType !== "voice")
      .flatMap((item) => item.sceneIds)
  );
  const missingSceneIds = [...requiredSceneIds].filter((sceneId) => !coveredScenes.has(sceneId));
  if (missingSceneIds.length > 0) {
    throw new Error(`确定性素材方案没有覆盖分镜：${missingSceneIds.join(", ")}`);
  }
  const visualRules = [...(episode.production?.storyboardDraft?.visualRules ?? [])];
  const visualContractVersion =
    episode.production?.storyboardDraft?.visualContractVersion ?? null;
  const visualStyleProfileId =
    episode.production?.storyboardDraft?.visualStyleProfileId ?? null;
  if (visualRules.length === 0) {
    throw new Error("已批准分镜缺少视觉规则，不能建立素材方案");
  }
  return {
    visualSystem:
      "9:16 高级简约语义驱动技术图解；按比较、流程、层级、分支和证据选择结构，不把所有内容做成卡片；同级元素统一，液态玻璃只作少量强调。",
    visualRules,
    ...(visualContractVersion ? { visualContractVersion } : {}),
    ...(visualStyleProfileId ? { visualStyleProfileId } : {}),
    sourceStoryboard,
    ...(usesAihubmixVolcengine ? { generationProfile } : {}),
    items,
    voiceDirection: {
      tone: "自然、克制、有呼吸感的中文讲解，避免播报腔和明显 AI 腔。",
      pacing: "严格对齐 60 秒批准字幕，优先保持短句自然停顿。",
      pronunciationNotes: ["Skill", "Tool", "MCP", "prompts", "resources", "Agent"]
    },
    executionPolicy: {
      mode: strategy === SHORT_ASSET_PLAN_STRATEGIES.HYBRID_API_SELECTIVE
        ? "mixed"
        : "local-only",
      costScope: "external-api-only",
      externalApiCalls: externalCalls,
      maximumPaidCostUsd: strategy === SHORT_ASSET_PLAN_STRATEGIES.HYBRID_API_SELECTIVE
        ? usesAihubmixVolcengine ? normalizedMaximumPaidCostUsd : 1
        : 0,
      currency: "USD",
      ...(usesAihubmixVolcengine
        ? {
            billingCurrencies: ["USD", "CNY"],
            nativeCurrencyCaps: [
              { currency: "USD", maximumAmount: imageNativeCapUsd },
              { currency: "CNY", maximumAmount: SEEDANCE_2_5_MAXIMUM_COST_CNY }
            ],
            budgetNormalization: {
              currency: "USD",
              maximumPaidCostUsd: normalizedMaximumPaidCostUsd,
              cnyPerUsdGuardRate: CNY_PER_USD_BUDGET_GUARD_RATE,
              policy: `CNY 13 video cap is normalized to USD 2.00 using a conservative 6.5 CNY/USD guard rate; two image caps add USD ${imageNativeCapUsd.toFixed(2)}; USD ${normalizedMaximumPaidCostUsd.toFixed(2)} remains the workflow hard ceiling`
            }
          }
        : {}),
      pricingConfirmed: true,
      humanApprovalRequiredBeforeExecution: true,
      invalidatesOnPlanChange: true
    },
    risks: [
      strategy === SHORT_ASSET_PLAN_STRATEGIES.HYBRID_API_SELECTIVE
        ? usesAihubmixVolcengine
          ? `本候选原币种硬上限为 AIHubMix 生图合计 USD ${imageNativeCapUsd.toFixed(2)}、火山方舟生视频 CNY 13；Workflow Kernel 使用 USD ${normalizedMaximumPaidCostUsd.toFixed(2)} 的保守归一化总上限。任一原币种或归一化上限超出都必须停止。`
          : "1 美元是本候选的外部 API 硬上限；价格证据绑定 2026-08-13 的 OpenAI 官方文档，实际执行前仍须确认模型可用性和价格未变化。"
        : "本方案的 0 美元仅指外部 API 费用，不包含人工制作时间或本地算力成本。",
      strategy === SHORT_ASSET_PLAN_STRATEGIES.HYBRID_API_SELECTIVE
        ? "生成图和生成视频必须提供与批准分镜绑定的无文字技术图结构、稳定节点和有向关系；技术流程视频必须从最小状态按阶段一次新增一个节点、保留前序结构并以完整图停留收束，不能用首帧完整架构或循环光点冒充推导；准确标签和字幕由本地代码完成，生成结果不得反向修改脚本或分镜。"
        : "全部技术结构、中文标签、正交有向连线和逐步显现时间轴均由本地代码实现；四项论文式技术图必须绑定本地语义合同与渐进式运动合同。若后续改用生图、生视频或付费声音 API，必须生成新素材方案并重新人工批准。",
      ...(usesAihubmixVolcengine
        ? [
            ...(usesGeminiProImage
              ? [
                  "AIHubMix Gemini 3 Pro Image 使用稳定 GA 模型、IMAGE-only、2K 与 9:16 请求；两张图按约 USD 0.134/张估算并分别绑定 USD 0.15、合计 USD 0.30 硬上限。"
                ]
              : []),
            "Seedance 2.5 当前官方可调用模型标识为 doubao-seedance-2-5-260628，且只支持 480p/720p。本方案固定 720p、8 秒、9:16；执行前只能做无生成、无计费的凭据/模型/价格预检，任何不可用或价格漂移都使授权失效，不能自动回退到 2.0 或其他模型。",
            "火山方舟视频估算为 172800 completion tokens、CNY 12.096，审批上限向上留到 CNY 13；成功生成后以 usage.completion_tokens 复核实际费用。"
          ]
        : []),
      "任何图解不得新增脚本比喻、伪造产品界面或把概念示意冒充真实证据。",
      "所有生成结果必须先经过素材完整性、视觉一致性、文字污染、品牌与相似性检查；不合格结果不能进入渲染。"
    ]
  };
}

export function derivedAssetPlanFidelity(episode, plan) {
  if (episode.derivation?.kind !== "approved-script-section-v1") {
    return { applicable: false, passed: true, expectedPlanHash: null, actualPlanHash: null };
  }
  try {
    const expected = adaptApprovedStoryboardToShortAssetPlan(episode);
    const expectedPlanHash = integrityHash(expected);
    const actualPlanHash = integrityHash(plan);
    return {
      applicable: true,
      passed: expectedPlanHash === actualPlanHash,
      expectedPlanHash,
      actualPlanHash
    };
  } catch (error) {
    return {
      applicable: true,
      passed: false,
      expectedPlanHash: null,
      actualPlanHash: integrityHash(plan),
      error: error.message
    };
  }
}
