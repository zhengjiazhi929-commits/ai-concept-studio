import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  inspectFileIntegrity,
  integrityHash,
  matchesFileIntegrity
} from "../../shared/integrity.mjs";
import {
  ensureInside,
  workspaceRelativePath,
  workspaceRoot
} from "../../shared/paths.mjs";
import { appendEvent, readEpisode, writeEpisode } from "../../shared/store.mjs";
import { approvalValidForGate } from "../control/policy-engine.mjs";
import {
  HYBRID_GENERATION_PROFILES,
  SUPPORTED_HYBRID_GENERATION_PROFILES,
  derivedAssetPlanFidelity
} from "../production/short-asset-plan-adapter.mjs";
import {
  LOCAL_CODE_IMPLEMENTATION_FILES,
  LOCAL_CODE_IMPLEMENTATION_VERSION,
  inspectLocalCodeImplementation
} from "../production/local-code-implementation.mjs";
import {
  PROGRESSIVE_KNOWLEDGE_MOTION_VERSION,
  TECHNICAL_DIAGRAM_CONTRACT_VERSION,
  localTechnicalDiagramPlanReview,
  progressiveTechnicalFlowPlanReview,
  technicalDiagramContractValid
} from "../../shared/technical-diagram-contract.mjs";

export const ASSET_EXECUTION_CHECKPOINT_VERSION = 1;

const PREFLIGHT_CHECK_IDS = Object.freeze([
  "approval-binding",
  "external-call-shape",
  "zero-generation-requests",
  "aihubmix-credential-presence",
  "aihubmix-credential-authentication",
  "aihubmix-auth-probe-zero-generation",
  "aihubmix-model-metadata-probe",
  "aihubmix-model-availability",
  "aihubmix-model-lifecycle",
  "aihubmix-generation-endpoint-availability",
  "aihubmix-request-contract",
  "aihubmix-pricing",
  "ark-credential-presence",
  "seedance-model-availability",
  "seedance-request-contract",
  "seedance-pricing"
]);

const GEMINI_METADATA_ENDPOINT =
  "https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image";
const GEMINI_COUNT_TOKENS_ENDPOINT =
  "https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image:countTokens";

function timestamp(now) {
  return (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
}

function reviewCheck(id, label, passed, actual, expected, suggestedFix = "") {
  return { id, label, passed: Boolean(passed), actual, expected, suggestedFix };
}

export function assetExecutionCheckpointState(initial = {}) {
  return {
    schemaVersion: ASSET_EXECUTION_CHECKPOINT_VERSION,
    status: initial.status ?? "not_started",
    currentCandidate: initial.currentCandidate ?? null,
    machineReview: initial.machineReview ?? null,
    humanApproval: initial.humanApproval ?? null,
    history: Array.isArray(initial.history) ? initial.history : []
  };
}

function candidateHistorySnapshot(candidate) {
  if (!candidate) return null;
  return {
    version: candidate.version ?? null,
    candidateHash: candidate.candidateHash ?? null,
    artifact: structuredClone(candidate.artifact ?? null),
    planHash: candidate.planHash ?? null,
    sourceStoryboard: structuredClone(candidate.sourceStoryboard ?? null),
    localCodeImplementation: structuredClone(candidate.localCodeImplementation ?? null),
    summary: structuredClone(candidate.summary ?? null)
  };
}

function safePlanPath(value) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error("素材方案路径不能为空");
    error.code = "invalid_asset_execution_plan_path";
    throw error;
  }
  return workspaceRelativePath(value);
}

async function readStableJson(relativePath, options = {}) {
  const inspect = options.inspectFileIntegrity ?? inspectFileIntegrity;
  const readText = options.readFile ?? readFile;
  const absolutePath = ensureInside(workspaceRoot, resolve(workspaceRoot, relativePath));
  const before = await inspect(absolutePath);
  const content = await readText(absolutePath, "utf8");
  const after = await inspect(absolutePath);
  if (!matchesFileIntegrity(before, after)) {
    const error = new Error("素材方案在审核读取期间发生变化，请重新检查");
    error.code = "asset_execution_evidence_changed";
    throw error;
  }
  let document;
  try {
    document = JSON.parse(typeof content === "string" ? content : content.toString("utf8"));
  } catch {
    const error = new Error("素材方案不是有效 JSON");
    error.code = "invalid_asset_execution_plan";
    throw error;
  }
  return { document, integrity: after };
}

function finiteCost(value) {
  return Number.isFinite(value) && value >= 0;
}

function externalExecutionToolIds(plan) {
  const tools = {
    aihubmix: "aihubmix.images.generate",
    "volcengine-ark": "volcengine.video.generate"
  };
  return [...new Set((plan?.executionPolicy?.externalApiCalls ?? [])
    .map((call) => tools[call?.providerId])
    .filter(Boolean))];
}

function localCodeImplementationValid(implementation) {
  if (
    !implementation ||
    implementation.schemaVersion !== LOCAL_CODE_IMPLEMENTATION_VERSION ||
    implementation.componentId !== "AgentSkillShortExplainer" ||
    !Array.isArray(implementation.files) ||
    implementation.files.length === 0 ||
    !/^[a-f0-9]{64}$/u.test(String(implementation.sha256 ?? ""))
  ) {
    return false;
  }
  const normalizedPaths = [];
  for (const file of implementation.files) {
    if (
      typeof file?.path !== "string" ||
      !file.path.trim() ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes <= 0 ||
      !/^[a-f0-9]{64}$/u.test(String(file.sha256 ?? ""))
    ) {
      return false;
    }
    try {
      const normalizedPath = workspaceRelativePath(file.path);
      if (normalizedPath !== file.path) return false;
      normalizedPaths.push(normalizedPath);
    } catch {
      return false;
    }
  }
  const expectedPaths = LOCAL_CODE_IMPLEMENTATION_FILES.map((filePath) =>
    workspaceRelativePath(filePath)
  );
  const aggregateSha256 = createHash("sha256")
    .update(`${JSON.stringify(implementation.files, null, 2)}\n`)
    .digest("hex");
  return (
    new Set(normalizedPaths).size === normalizedPaths.length &&
    integrityHash(normalizedPaths) === integrityHash(expectedPaths) &&
    aggregateSha256 === implementation.sha256
  );
}

export function approvedAssetExecutionToolIds(episode) {
  if (!assetExecutionApprovalValid(episode)) return [];
  return externalExecutionToolIds(episode.production?.assetPlan?.content);
}

function revokeCheckpointTools(episode, checkpoint) {
  const revoked = new Set(checkpoint?.humanApproval?.authorizedToolIds ?? []);
  if (revoked.size === 0) return;
  episode.control.allowedTools = (episode.control?.allowedTools ?? [])
    .filter((toolId) => !revoked.has(toolId));
}

function billingContractValid(billing) {
  return Boolean(
    billing &&
    typeof billing === "object" &&
    /^[A-Z]{3}$/u.test(String(billing.currency ?? "")) &&
    finiteCost(billing.estimatedAmount) &&
    finiteCost(billing.maximumAmount) &&
    billing.estimatedAmount <= billing.maximumAmount &&
    typeof billing.basis === "string" && billing.basis.trim()
  );
}

function executionPreflightContractValid(preflight) {
  return Boolean(
    preflight &&
    preflight.credentialPresenceRequired === true &&
    preflight.modelAvailabilityRequired === true &&
    preflight.pricingRevalidationRequired === true &&
    preflight.noGenerationAllowed === true &&
    preflight.failClosedOnMismatch === true
  );
}

function itemCost(item) {
  return finiteCost(item?.estimatedCost?.maximumCostUsd)
    ? item.estimatedCost.maximumCostUsd
    : Number.NaN;
}

function externalCallContractValid(call) {
  return Boolean(
    call &&
    typeof call === "object" &&
    typeof call.id === "string" && call.id.trim() &&
    typeof call.providerId === "string" && call.providerId.trim() &&
    typeof call.model === "string" && call.model.trim() &&
    typeof call.purpose === "string" && call.purpose.trim() &&
    Array.isArray(call.sceneIds) && call.sceneIds.length > 0 &&
    Number.isInteger(call.estimatedCalls) && call.estimatedCalls > 0 &&
    finiteCost(call.maximumCostUsd) &&
    typeof call.pricingSource === "string" && call.pricingSource.trim() &&
    typeof call.pricingCheckedAt === "string" && call.pricingCheckedAt.trim() &&
    typeof call.endpoint === "string" && call.endpoint.trim() &&
    typeof call.prompt === "string" && call.prompt.trim() &&
    typeof call.outputSpec === "string" && call.outputSpec.trim() &&
    (!call.billing || billingContractValid(call.billing)) &&
    (!call.requestParameters || (
      typeof call.requestParameters === "object" && !Array.isArray(call.requestParameters)
    )) &&
    (!call.executionPreflight || executionPreflightContractValid(call.executionPreflight))
  );
}

function externalPromptContractValid(call) {
  const prompt = String(call?.prompt ?? "");
  const lowerPrompt = prompt.toLowerCase();
  const forbidsGeneratedText = /no text|without text|无文字/iu.test(prompt);
  const forbidsBrandOrUi = /\bno\b[^.]{0,240}\b(?:logos?|brands?|product ui|screenshots?)\b|无(?:徽标|品牌|ui|界面)/iu
    .test(prompt);
  const declaresOutput = typeof call?.outputSpec === "string" && call.outputSpec.trim();
  const isVideo = /(?:\/videos(?:$|\?)|\/contents\/generations\/tasks(?:$|\?))/u
    .test(String(call?.endpoint ?? "")) || /video|视频/iu.test(
      `${call?.purpose ?? ""} ${call?.outputSpec ?? ""}`
    );
  const validDuration = !isVideo || /(?:^|\D)(?:4|8|12)\s*(?:seconds?|秒)/iu.test(call.outputSpec);
  return Boolean(
    prompt.trim() &&
    !/(?:api[_ -]?key|authorization|bearer\s+[a-z0-9_-]+)/iu.test(lowerPrompt) &&
    forbidsGeneratedText &&
    forbidsBrandOrUi &&
    declaresOutput &&
    validDuration
  );
}

export function inspectAssetExecutionPlan(episode, plan, metadata = {}) {
  const items = Array.isArray(plan?.items) ? plan.items : [];
  const executionPolicy = plan?.executionPolicy ?? {};
  const externalApiCalls = Array.isArray(executionPolicy.externalApiCalls)
    ? executionPolicy.externalApiCalls
    : [];
  const sceneIds = (episode.scenes ?? []).map((scene) => scene.id);
  const sceneIdSet = new Set(sceneIds);
  const coveredScenes = new Set(
    items
      .filter((item) => item?.required && item.assetType !== "voice")
      .flatMap((item) => Array.isArray(item.sceneIds) ? item.sceneIds : [])
  );
  const unknownSceneIds = items.flatMap((item) =>
    (item?.sceneIds ?? []).filter((sceneId) => !sceneIdSet.has(sceneId))
  );
  const missingSceneIds = sceneIds.filter((sceneId) => !coveredScenes.has(sceneId));
  const invalidItems = items.filter((item) => !Boolean(
    typeof item?.id === "string" && item.id.trim() &&
    typeof item?.purpose === "string" && item.purpose.trim() &&
    Array.isArray(item?.sceneIds) && item.sceneIds.length > 0 &&
    typeof item?.sourceRequirement === "string" && item.sourceRequirement.trim() &&
    typeof item?.rightsRequirement === "string" && item.rightsRequirement.trim() &&
    typeof item?.productionMethod?.kind === "string" && item.productionMethod.kind.trim() &&
    typeof item?.productionMethod?.executor === "string" && item.productionMethod.executor.trim() &&
    finiteCost(itemCost(item))
  ));
  const unresolvedItems = items.filter((item) =>
    /(?:待确认|待补充|tbd|unknown)/iu.test(
      `${item?.sourceRequirement ?? ""} ${item?.rightsRequirement ?? ""}`
    )
  );
  const externalItems = items.filter((item) =>
    new Set(["external-image-generation", "external-video-generation"])
      .has(item?.productionMethod?.kind)
  );
  const unpricedExternalItems = externalItems.filter((item) => !Boolean(
    item?.productionMethod?.externalProvider &&
    item?.productionMethod?.externalModel &&
    item?.estimatedCost?.pricingStatus === "confirmed" &&
    item?.estimatedCost?.pricingSource?.trim() &&
    item?.estimatedCost?.pricingCheckedAt?.trim()
  ));
  const unmatchedExternalItems = externalItems.filter((item) =>
    !externalApiCalls.some((call) =>
      call?.providerId === item.productionMethod.externalProvider &&
      call?.model === item.productionMethod.externalModel &&
      (item.sceneIds ?? []).every((sceneId) => call?.sceneIds?.includes(sceneId))
    )
  );
  const unmatchedExternalCalls = externalApiCalls.filter((call) =>
    !externalItems.some((item) =>
      call?.providerId === item.productionMethod.externalProvider &&
      call?.model === item.productionMethod.externalModel &&
      (call?.sceneIds ?? []).some((sceneId) => item.sceneIds?.includes(sceneId))
    )
  );
  const planMaximum = executionPolicy.maximumPaidCostUsd;
  const itemMaximum = items.reduce((sum, item) => sum + (finiteCost(itemCost(item)) ? itemCost(item) : 0), 0);
  const callMaximum = externalApiCalls.reduce(
    (sum, call) => sum + (finiteCost(call?.maximumCostUsd) ? call.maximumCostUsd : 0),
    0
  );
  const billingCurrencies = Array.isArray(executionPolicy.billingCurrencies)
    ? executionPolicy.billingCurrencies
    : [];
  const nativeCurrencyCaps = Array.isArray(executionPolicy.nativeCurrencyCaps)
    ? executionPolicy.nativeCurrencyCaps
    : [];
  const billedCalls = externalApiCalls.filter((call) => call?.billing);
  const billingRequired = billingCurrencies.length > 0 || nativeCurrencyCaps.length > 0;
  const invalidBillingCallIds = externalApiCalls
    .filter((call) => billingRequired && !billingContractValid(call?.billing))
    .map((call) => call?.id ?? null);
  const invalidPreflightCallIds = externalApiCalls
    .filter((call) => billingRequired && !executionPreflightContractValid(call?.executionPreflight))
    .map((call) => call?.id ?? null);
  const nativeTotals = Object.fromEntries(
    billedCalls.reduce((totals, call) => {
      const currency = call.billing.currency;
      totals.set(
        currency,
        Number(((totals.get(currency) ?? 0) + call.billing.maximumAmount).toFixed(6))
      );
      return totals;
    }, new Map())
  );
  const declaredNativeCaps = Object.fromEntries(
    nativeCurrencyCaps.map((entry) => [entry?.currency, entry?.maximumAmount])
  );
  const nativeCurrencyContractPassed = !billingRequired || Boolean(
    billingCurrencies.length > 0 &&
    billingCurrencies.every((currency) => /^[A-Z]{3}$/u.test(String(currency))) &&
    new Set(billingCurrencies).size === billingCurrencies.length &&
    nativeCurrencyCaps.length === billingCurrencies.length &&
    nativeCurrencyCaps.every((entry) =>
      /^[A-Z]{3}$/u.test(String(entry?.currency ?? "")) &&
      finiteCost(entry?.maximumAmount) &&
      billingCurrencies.includes(entry.currency)
    ) &&
    invalidBillingCallIds.length === 0 &&
    invalidPreflightCallIds.length === 0 &&
    billedCalls.length === externalApiCalls.length &&
    Object.entries(nativeTotals).every(([currency, maximumAmount]) =>
      finiteCost(declaredNativeCaps[currency]) && maximumAmount <= declaredNativeCaps[currency]
    ) &&
    billingCurrencies.every((currency) => Object.hasOwn(nativeTotals, currency))
  );
  const normalization = executionPolicy.budgetNormalization;
  const guardRate = normalization?.cnyPerUsdGuardRate;
  const normalizedBillingPassed = !billingRequired || Boolean(
    normalization &&
    normalization.currency === "USD" &&
    finiteCost(normalization.maximumPaidCostUsd) &&
    normalization.maximumPaidCostUsd === planMaximum &&
    Number.isFinite(guardRate) && guardRate > 0 &&
    billedCalls.every((call) => {
      const requiredUsd = call.billing.currency === "USD"
        ? call.billing.maximumAmount
        : call.billing.currency === "CNY"
          ? call.billing.maximumAmount / guardRate
          : Number.POSITIVE_INFINITY;
      return finiteCost(call.maximumCostUsd) && call.maximumCostUsd >= requiredUsd;
    })
  );
  const storyboard = plan?.sourceStoryboard ?? {};
  const storyboardApproval = episode.approvals?.storyboard ?? {};
  const sourceBindingPassed = Boolean(
    approvalValidForGate(episode, "storyboard") &&
    storyboard.version === storyboardApproval.currentVersion &&
    storyboard.artifactHash === storyboardApproval.artifactHash &&
    storyboard.reviewReportId === storyboardApproval.reviewReportId
  );
  const fidelity = derivedAssetPlanFidelity(episode, plan);
  const technicalDiagramContractRequired =
    externalApiCalls.length > 0 && String(plan?.visualSystem ?? "").includes("技术图解");
  const invalidTechnicalDiagramCallIds = technicalDiagramContractRequired
    ? externalApiCalls
        .filter((call) => !technicalDiagramContractValid(call))
        .map((call) => call?.id ?? "unknown")
    : [];
  const progressiveMotionReview = progressiveTechnicalFlowPlanReview(plan);
  const localTechnicalDiagramReview = localTechnicalDiagramPlanReview(plan);
  const externalMethods = items.filter((item) =>
    item?.productionMethod?.externalProvider || item?.productionMethod?.externalModel
  );
  const localOnlyConsistent = executionPolicy.mode !== "local-only" || (
    externalApiCalls.length === 0 &&
    externalMethods.length === 0 &&
    planMaximum === 0 &&
    itemMaximum === 0 &&
    plan?.generationProfile === undefined &&
    executionPolicy.billingCurrencies === undefined &&
    executionPolicy.nativeCurrencyCaps === undefined &&
    executionPolicy.budgetNormalization === undefined
  );
  const mixedModeConsistent = executionPolicy.mode !== "mixed" || (
    externalApiCalls.length > 0 &&
    externalItems.length > 0 &&
    items.some((item) => item?.productionMethod?.kind === "local-code-animation") &&
    finiteCost(planMaximum) &&
    planMaximum > 0
  );
  const checks = [
    reviewCheck(
      "plan-version",
      "素材方案候选绑定正整数版本",
      Number.isInteger(metadata.version) && metadata.version > 0,
      metadata.version ?? null,
      "positive integer"
    ),
    reviewCheck(
      "storyboard-approval-binding",
      "素材方案绑定当前机器通过且人工批准的分镜",
      sourceBindingPassed,
      storyboard,
      {
        version: storyboardApproval.currentVersion ?? null,
        artifactHash: storyboardApproval.artifactHash ?? null,
        reviewReportId: storyboardApproval.reviewReportId ?? null
      },
      "由 Asset Agent 从当前批准分镜重新生成方案"
    ),
    reviewCheck(
      "storyboard-fidelity",
      "确定性素材方案忠于批准分镜和视觉规则",
      !fidelity.applicable || fidelity.passed,
      fidelity.actualPlanHash,
      fidelity.expectedPlanHash,
      "不得在 Asset Agent 临时新增比喻、脚本事实或视觉规则"
    ),
    reviewCheck(
      "scene-coverage",
      "每个分镜场景都有必需视觉素材方案覆盖",
      missingSceneIds.length === 0 && unknownSceneIds.length === 0,
      { missingSceneIds, unknownSceneIds },
      "all approved storyboard scenes covered",
      "补齐缺失镜头或移除不存在的镜头绑定"
    ),
    reviewCheck(
      "item-contract",
      "每项素材写清用途、来源、版权、制作方式和费用上限",
      items.length > 0 && invalidItems.length === 0 && unresolvedItems.length === 0,
      {
        invalidItems: invalidItems.map((item) => item?.id ?? "unknown"),
        unresolvedItems: unresolvedItems.map((item) => item?.id ?? "unknown")
      },
      "no invalid items",
      "由 Asset Agent 补齐来源、版权、执行器和费用字段"
    ),
    reviewCheck(
      "external-item-pricing",
      "生成式素材条目与外部调用登记一一对应且价格已确认",
      unpricedExternalItems.length === 0 &&
        unmatchedExternalItems.length === 0 &&
        unmatchedExternalCalls.length === 0,
      {
        unpricedExternalItems: unpricedExternalItems.map((item) => item.id),
        unmatchedExternalItems: unmatchedExternalItems.map((item) => item.id),
        unmatchedExternalCalls: unmatchedExternalCalls.map((call) => call?.id ?? "unknown")
      },
      "all external items priced and declared",
      "补齐生成条目和外部调用的 Provider、模型、价格证据与场景对应关系"
    ),
    reviewCheck(
      "external-api-contract",
      "所有外部 API 调用都显式登记 Provider、模型、范围、提示词、输出规格、价格证据与费用上限",
      externalApiCalls.every(externalCallContractValid),
      externalApiCalls.length,
      "all declared calls fully priced",
      "外部调用信息或价格未确认时禁止执行"
    ),
    reviewCheck(
      "native-currency-contract",
      "多币种调用逐币种登记原始计费、硬上限和无计费预检",
      nativeCurrencyContractPassed,
      {
        billingCurrencies,
        nativeTotals,
        declaredNativeCaps,
        invalidBillingCallIds,
        invalidPreflightCallIds
      },
      billingRequired ? "all billed calls covered by native currency caps" : "not applicable",
      "补齐每次调用的原币种费用、逐币种方案上限和 fail-closed 无生成预检"
    ),
    reviewCheck(
      "budget-normalization",
      "原币种预算使用保守汇率归一化且不突破 Workflow Kernel 美元上限",
      normalizedBillingPassed,
      {
        normalization: normalization ?? null,
        callMaximum,
        planMaximum
      },
      billingRequired ? "native caps conservatively covered by USD workflow budget" : "not applicable",
      "为人民币计费设置保守换算保护率，并同时保留原币种与美元硬上限"
    ),
    reviewCheck(
      "external-prompt-safety",
      "生成式调用提示词禁止文字、品牌和伪造界面，并声明可审核输出规格",
      externalApiCalls.every(externalPromptContractValid),
      externalApiCalls.filter((call) => !externalPromptContractValid(call)).map((call) => call.id),
      "all external prompts prohibit generated text, brands and product UI",
      "补齐无文字、无品牌、无产品界面约束及明确的尺寸、格式和时长"
    ),
    reviewCheck(
      "technical-diagram-contract",
      "技术图解外部调用绑定论文式系统图结构契约",
      !technicalDiagramContractRequired || invalidTechnicalDiagramCallIds.length === 0,
      {
        required: technicalDiagramContractRequired,
        invalidCallIds: invalidTechnicalDiagramCallIds
      },
      technicalDiagramContractRequired
        ? `every external call has a valid ${TECHNICAL_DIAGRAM_CONTRACT_VERSION}`
        : "not applicable",
      "为每个技术图解外部调用补齐与 sceneIds 精确绑定的节点、定向边、来源要求和禁用装饰元素"
    ),
    reviewCheck(
      "local-technical-diagram-contract",
      "本地代码技术图绑定论文式节点、定向边和本地语义层",
      localTechnicalDiagramReview.passed,
      localTechnicalDiagramReview,
      localTechnicalDiagramReview.required
        ? `every local technical diagram has a valid ${TECHNICAL_DIAGRAM_CONTRACT_VERSION}`
        : "not applicable",
      "为本地架构图、流程图和能力边界图补齐当前候选绑定的节点、边、scene 与渐进式时间轴"
    ),
    reviewCheck(
      "technical-diagram-motion-contract",
      "技术图按知识逻辑逐步建立节点与因果连线",
      progressiveMotionReview.passed,
      progressiveMotionReview,
      progressiveMotionReview.required
        ? `every technical diagram uses ${PROGRESSIVE_KNOWLEDGE_MOTION_VERSION}`
        : "not applicable",
      "从最小画面开始按阶段一次新增一个节点；连接只能在端点出现后激活，保留前序结构并以完整流程图停留收束"
    ),
    reviewCheck(
      "pricing-confirmation",
      "有外部调用时价格已确认，无外部调用时费用上限为 0",
      externalApiCalls.length > 0
        ? executionPolicy.pricingConfirmed === true
        : planMaximum === 0 && executionPolicy.pricingConfirmed === true,
      {
        externalApiCallCount: externalApiCalls.length,
        pricingConfirmed: executionPolicy.pricingConfirmed ?? false,
        maximumPaidCostUsd: planMaximum ?? null
      },
      externalApiCalls.length > 0 ? "confirmed pricing" : "USD 0"
    ),
    reviewCheck(
      "cost-cap",
      "条目与调用费用不超过方案总上限",
      finiteCost(planMaximum) && itemMaximum <= planMaximum && callMaximum <= planMaximum,
      { itemMaximum, callMaximum, planMaximum },
      "all subtotals <= maximumPaidCostUsd",
      "修正估算或提高明确的人工审批上限"
    ),
    reviewCheck(
      "local-only-consistency",
      "local-only 方案没有隐藏外部调用或费用",
      localOnlyConsistent,
      {
        mode: executionPolicy.mode ?? null,
        externalApiCallCount: externalApiCalls.length,
        externalMethodCount: externalMethods.length,
        maximumPaidCostUsd: planMaximum ?? null,
        generationProfile: plan?.generationProfile ?? null,
        billingCurrencies: executionPolicy.billingCurrencies ?? null,
        nativeCurrencyCaps: executionPolicy.nativeCurrencyCaps ?? null,
        budgetNormalization: executionPolicy.budgetNormalization ?? null
      },
      "local-only means no external inference and USD 0"
    ),
    reviewCheck(
      "mixed-mode-consistency",
      "mixed 方案同时包含本地精确层和已登记外部增强层",
      mixedModeConsistent,
      {
        mode: executionPolicy.mode ?? null,
        externalApiCallCount: externalApiCalls.length,
        externalItemCount: externalItems.length,
        localItemCount: items.filter(
          (item) => item?.productionMethod?.kind === "local-code-animation"
        ).length,
        maximumPaidCostUsd: planMaximum ?? null
      },
      "mixed mode requires local layers, external layers and a positive cost cap"
    ),
    reviewCheck(
      "human-approval-required",
      "任何制作执行前必须人工批准，方案变更会使批准失效",
      executionPolicy.humanApprovalRequiredBeforeExecution === true &&
        executionPolicy.invalidatesOnPlanChange === true,
      {
        humanApprovalRequiredBeforeExecution:
          executionPolicy.humanApprovalRequiredBeforeExecution ?? false,
        invalidatesOnPlanChange: executionPolicy.invalidatesOnPlanChange ?? false
      },
      { humanApprovalRequiredBeforeExecution: true, invalidatesOnPlanChange: true }
    )
  ];
  const summary = {
    itemCount: items.length,
    requiredVisualItemCount: items.filter((item) => item.required && item.assetType !== "voice").length,
    productionMethods: [...new Set(items.map((item) => item.productionMethod?.kind).filter(Boolean))],
    externalApiCallCount: externalApiCalls.length,
    externalApiCalls,
    maximumPaidCostUsd: finiteCost(planMaximum) ? planMaximum : null,
    currency: executionPolicy.currency ?? null,
    billingCurrencies: structuredClone(billingCurrencies),
    nativeCurrencyCaps: structuredClone(nativeCurrencyCaps),
    budgetNormalization: normalization ? structuredClone(normalization) : null,
    costScope: executionPolicy.costScope ?? null,
    pricingConfirmed: executionPolicy.pricingConfirmed === true
  };
  return { checks, summary, passed: checks.every((check) => check.passed) };
}

export async function inspectAssetExecutionCandidate(episode, input, options = {}) {
  const planPath = safePlanPath(input?.artifactPath ?? episode.production?.assetPlan?.artifactPath);
  const evidence = await readStableJson(planPath, options);
  if (evidence.document.episodeId !== episode.id) {
    const error = new Error("素材方案没有绑定当前 Episode");
    error.code = "asset_execution_episode_mismatch";
    throw error;
  }
  const plan = evidence.document.plan ?? evidence.document.content ?? evidence.document;
  const version = Number(input?.version ?? episode.production?.assetPlan?.version);
  const inspected = inspectAssetExecutionPlan(episode, plan, { version });
  const localCodeRequired = (plan?.items ?? []).some(
    (item) => item?.productionMethod?.kind === "local-code-animation"
  );
  let localCodeImplementation = null;
  let localCodeImplementationError = null;
  if (localCodeRequired) {
    const inspectImplementation =
      options.inspectLocalCodeImplementation ?? inspectLocalCodeImplementation;
    const implementationOptions = {
      ...(options.localCodeImplementationOptions ?? {})
    };
    if (options.readLocalCodeImplementationFile) {
      implementationOptions.readFile = options.readLocalCodeImplementationFile;
    }
    try {
      localCodeImplementation = await inspectImplementation(implementationOptions);
    } catch (error) {
      localCodeImplementationError = error?.code ?? "local_code_implementation_inspection_failed";
    }
  }
  inspected.checks.unshift(
    reviewCheck(
      "local-code-implementation-binding",
      "本地代码素材候选绑定当前实现文件摘要",
      !localCodeRequired || localCodeImplementationValid(localCodeImplementation),
      {
        required: localCodeRequired,
        implementation: localCodeImplementation,
        error: localCodeImplementationError
      },
      localCodeRequired
        ? `${LOCAL_CODE_IMPLEMENTATION_VERSION} with safe file hashes`
        : "not applicable",
      "重新读取本地视频组件、时间轴与字幕实现，机器审核通过后再人工批准"
    )
  );
  const currentPlanPath = safePlanPath(episode.production?.assetPlan?.artifactPath);
  inspected.checks.unshift(
    reviewCheck(
      "current-plan-binding",
      "候选文件和版本绑定当前 Episode 素材方案",
      currentPlanPath === planPath && episode.production?.assetPlan?.version === version,
      { path: planPath, version },
      { path: currentPlanPath, version: episode.production?.assetPlan?.version ?? null },
      "只能审核和批准当前 Asset Agent 候选"
    )
  );
  inspected.checks.unshift(
    reviewCheck(
      "current-content-binding",
      "Episode 中的当前素材方案内容与候选文件完全一致",
      integrityHash(episode.production?.assetPlan?.content) === integrityHash(plan),
      integrityHash(episode.production?.assetPlan?.content),
      integrityHash(plan),
      "重新登记当前候选文件，禁止只替换 Episode 内存内容"
    )
  );
  inspected.passed = inspected.checks.every((check) => check.passed);
  const candidate = {
    episodeId: episode.id,
    version,
    artifact: { path: planPath, ...evidence.integrity },
    planHash: integrityHash(plan),
    sourceStoryboard: structuredClone(plan.sourceStoryboard ?? null),
    localCodeImplementation: localCodeRequired
      ? structuredClone(localCodeImplementation)
      : null,
    summary: inspected.summary
  };
  candidate.candidateHash = integrityHash(candidate);
  return { ...inspected, plan, candidate };
}

export async function buildAssetExecutionCheckpoint(episode, input = {}, options = {}) {
  const inspected = await inspectAssetExecutionCandidate(episode, input, options);
  const previous = assetExecutionCheckpointState(episode.reviewCheckpoints?.assetExecution);
  if (
    previous.status === "approved" &&
    previous.currentCandidate?.candidateHash === inspected.candidate.candidateHash &&
    inspected.passed
  ) {
    return { checkpoint: previous, inspected, unchanged: true };
  }
  const at = timestamp(options.now);
  const reviewId = `asset-execution-review-v${String(inspected.candidate.version).padStart(3, "0")}-${at.replaceAll(/[:.]/gu, "-")}`;
  const machineReview = {
    id: reviewId,
    status: inspected.passed ? "passed" : "blocked",
    checkedAt: at,
    candidateHash: inspected.candidate.candidateHash,
    checks: inspected.checks
  };
  const checkpoint = {
    schemaVersion: ASSET_EXECUTION_CHECKPOINT_VERSION,
    status: inspected.passed ? "waiting_approval" : "blocked",
    currentCandidate: inspected.candidate,
    machineReview,
    humanApproval: null,
    history: [
      ...previous.history,
      ...(previous.currentCandidate?.candidateHash
        && previous.currentCandidate.candidateHash !== inspected.candidate.candidateHash
        ? [{
            type: "candidate-superseded",
            at,
            candidate: candidateHistorySnapshot(previous.currentCandidate),
            supersededByVersion: inspected.candidate.version,
            supersededByCandidateHash: inspected.candidate.candidateHash
          }]
        : []),
      {
        type: "machine-review",
        at,
        version: inspected.candidate.version,
        candidateHash: inspected.candidate.candidateHash,
        reviewId,
        status: machineReview.status
      }
    ]
  };
  return { checkpoint, inspected, unchanged: false };
}

export async function reviewAssetExecutionCandidate(episodeId, input = {}, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  const result = await buildAssetExecutionCheckpoint(sourceEpisode, input, options);
  if (result.unchanged) {
    return { episode: sourceEpisode, checkpoint: result.checkpoint, unchanged: true };
  }
  const episode = structuredClone(sourceEpisode);
  episode.reviewCheckpoints = {
    ...(episode.reviewCheckpoints ?? {}),
    assetExecution: result.checkpoint
  };
  episode.updatedAt = timestamp(options.now);
  episode.history = [
    ...(episode.history ?? []),
    {
      at: episode.updatedAt,
      type: "asset-execution-machine-review",
      status: result.checkpoint.machineReview.status,
      version: result.checkpoint.currentCandidate.version,
      candidateHash: result.checkpoint.currentCandidate.candidateHash,
      message: result.inspected.passed
        ? `素材执行方案 v${result.checkpoint.currentCandidate.version} 机器检查通过，等待人工审批`
        : `素材执行方案 v${result.checkpoint.currentCandidate.version} 机器检查未通过，退回 Asset Agent`
    }
  ];
  await writeState(episode);
  await recordEvent({
    type: "asset-execution.reviewed",
    episodeId,
    version: result.checkpoint.currentCandidate.version,
    candidateHash: result.checkpoint.currentCandidate.candidateHash,
    status: result.checkpoint.machineReview.status,
    idempotencyKey:
      `asset-execution.reviewed:${episodeId}:${result.checkpoint.currentCandidate.candidateHash}`
  });
  return { episode, checkpoint: result.checkpoint, unchanged: false };
}

async function reinspectCheckpointCandidate(episode, checkpoint, options = {}) {
  return inspectAssetExecutionCandidate(episode, {
    artifactPath: checkpoint.currentCandidate?.artifact?.path,
    version: checkpoint.currentCandidate?.version
  }, options);
}

export async function approveAssetExecutionCandidate(episodeId, input = {}, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  const previous = assetExecutionCheckpointState(sourceEpisode.reviewCheckpoints?.assetExecution);
  if (!previous.currentCandidate || !previous.machineReview) {
    const error = new Error("当前没有经过机器检查的素材执行方案");
    error.code = "asset_execution_review_missing";
    error.statusCode = 409;
    throw error;
  }
  const candidateHash = String(input.candidateHash ?? "");
  const machineReviewId = String(input.machineReviewId ?? "");
  if (
    !candidateHash
    || !machineReviewId
    || candidateHash !== previous.currentCandidate.candidateHash
    || machineReviewId !== previous.machineReview.id
  ) {
    const error = new Error("人工审批没有精确绑定当前素材执行方案和机器审核报告");
    error.code = "asset_execution_review_conflict";
    error.statusCode = 409;
    throw error;
  }
  const inspected = await reinspectCheckpointCandidate(sourceEpisode, previous, options);
  if (
    !inspected.passed ||
    inspected.candidate.candidateHash !== candidateHash ||
    previous.machineReview.status !== "passed" ||
    previous.machineReview.candidateHash !== candidateHash
  ) {
    const error = new Error("素材执行方案已变化或机器检查未通过，必须重新审核");
    error.code = "asset_execution_review_stale";
    error.statusCode = 409;
    throw error;
  }
  if (previous.status === "approved" && previous.humanApproval?.candidateHash === candidateHash) {
    const authorizedToolIds = externalExecutionToolIds(inspected.plan);
    const alreadySynchronized =
      integrityHash(previous.humanApproval.authorizedToolIds ?? []) ===
        integrityHash(authorizedToolIds) &&
      authorizedToolIds.every((toolId) => sourceEpisode.control.allowedTools.includes(toolId));
    if (alreadySynchronized) {
      return { episode: sourceEpisode, checkpoint: previous, unchanged: true };
    }
    const episode = structuredClone(sourceEpisode);
    const checkpoint = {
      ...previous,
      humanApproval: {
        ...previous.humanApproval,
        authorizedToolIds
      }
    };
    episode.reviewCheckpoints = {
      ...(episode.reviewCheckpoints ?? {}),
      assetExecution: checkpoint
    };
    episode.control.allowedTools = [
      ...new Set([...(episode.control.allowedTools ?? []), ...authorizedToolIds])
    ];
    episode.updatedAt = timestamp(options.now);
    await writeState(episode);
    await recordEvent({
      type: "asset-execution.tools_authorized",
      episodeId,
      version: inspected.candidate.version,
      candidateHash,
      authorizedToolIds,
      idempotencyKey: `asset-execution.tools_authorized:${episodeId}:${candidateHash}`
    });
    return { episode, checkpoint, unchanged: false, reconciledTools: true };
  }
  if (previous.status !== "waiting_approval") {
    const error = new Error("素材执行方案当前不在等待人工审批状态");
    error.code = "asset_execution_not_waiting_approval";
    error.statusCode = 409;
    throw error;
  }
  const at = timestamp(options.now);
  const note = String(input.note ?? "").trim();
  const actor = typeof options.actor === "string" ? options.actor.slice(0, 128) : null;
  const authorizedToolIds = externalExecutionToolIds(inspected.plan);
  const humanApproval = {
    decision: "approved",
    at,
    note,
    version: inspected.candidate.version,
    candidateHash,
    machineReviewId: previous.machineReview.id,
    maximumPaidCostUsd: inspected.candidate.summary.maximumPaidCostUsd,
    billingCurrencies: structuredClone(inspected.candidate.summary.billingCurrencies ?? []),
    nativeCurrencyCaps: structuredClone(inspected.candidate.summary.nativeCurrencyCaps ?? []),
    externalApiCallCount: inspected.candidate.summary.externalApiCallCount,
    authorizedToolIds,
    ...(actor ? { actor } : {})
  };
  const checkpoint = {
    ...previous,
    status: "approved",
    currentCandidate: inspected.candidate,
    humanApproval,
    history: [
      ...previous.history,
      {
        type: "human-approval",
        at,
        version: inspected.candidate.version,
        candidateHash,
        machineReviewId: previous.machineReview.id,
        decision: "approved",
        note,
        ...(actor ? { actor } : {})
      }
    ]
  };
  const episode = structuredClone(sourceEpisode);
  episode.reviewCheckpoints = { ...(episode.reviewCheckpoints ?? {}), assetExecution: checkpoint };
  episode.control.allowedTools = [
    ...new Set([...(episode.control.allowedTools ?? []), ...authorizedToolIds])
  ];
  const assetIndex = episode.pipeline.findIndex((step) => step.agent === "asset-agent");
  if (assetIndex >= 0 && episode.pipeline[assetIndex].status === "blocked") {
    episode.pipeline[assetIndex] = {
      ...episode.pipeline[assetIndex],
      status: "ready",
      message: "素材执行方案已获人工批准，可以继续本地素材制作与登记",
      requiresHuman: false
    };
  }
  episode.updatedAt = at;
  episode.history = [
    ...(episode.history ?? []),
    {
      at,
      type: "asset-execution-human-approval",
      status: "approved",
      version: inspected.candidate.version,
      candidateHash,
      ...(actor ? { actor } : {}),
      message: note || `人工操作者已批准素材执行方案 v${inspected.candidate.version}`
    }
  ];
  await writeState(episode);
  await recordEvent({
    type: "asset-execution.approved",
    episodeId,
    version: inspected.candidate.version,
    candidateHash,
    actor,
    maximumPaidCostUsd: inspected.candidate.summary.maximumPaidCostUsd,
    nativeCurrencyCaps: structuredClone(inspected.candidate.summary.nativeCurrencyCaps ?? []),
    externalApiCallCount: inspected.candidate.summary.externalApiCallCount,
    idempotencyKey: `asset-execution.approved:${episodeId}:${candidateHash}`
  });
  return { episode, checkpoint, unchanged: false };
}

function assetExecutionPreflightReportValid(report, episode) {
  const credentialVerification = report?.credentialVerification?.aihubmix;
  const checkIds = Array.isArray(report?.checks)
    ? report.checks.map((item) => item?.id)
    : [];
  const requiresGeminiProbe = (episode?.production?.assetPlan?.content
    ?.executionPolicy?.externalApiCalls ?? []).some((call) =>
      call?.endpoint ===
        "https://aihubmix.com/gemini/v1beta/models/gemini-3-pro-image:generateContent"
    );
  const checkedAtTime = Date.parse(report?.checkedAt ?? "");
  const validResponseHash = /^[a-f0-9]{64}$/u.test(
    String(credentialVerification?.responseHash ?? "")
  );
  const modelsGetPassed = Boolean(
    credentialVerification?.probeKind === "models.get" &&
    credentialVerification?.method === "GET" &&
    credentialVerification?.endpoint === GEMINI_METADATA_ENDPOINT &&
    credentialVerification?.expectedModelId === "gemini-3-pro-image" &&
    credentialVerification?.responseModelId === "gemini-3-pro-image" &&
    credentialVerification?.authenticated === true &&
    credentialVerification?.httpStatus === 200 &&
    credentialVerification?.modelMatched === true &&
    credentialVerification?.modelEndpointBound === true &&
    credentialVerification?.supportsGenerateContent === true &&
    credentialVerification?.supportedGenerationMethods?.includes("generateContent") &&
    credentialVerification?.metadataRequestCount === 1 &&
    validResponseHash
  );
  const countTokensPassed = Boolean(
    credentialVerification?.probeKind === "countTokens" &&
    credentialVerification?.method === "POST" &&
    credentialVerification?.endpoint === GEMINI_COUNT_TOKENS_ENDPOINT &&
    credentialVerification?.expectedModelId === "gemini-3-pro-image" &&
    credentialVerification?.authenticated === true &&
    credentialVerification?.httpStatus === 200 &&
    credentialVerification?.modelEndpointBound === true &&
    Number.isInteger(credentialVerification?.totalTokens) &&
    credentialVerification.totalTokens > 0 &&
    credentialVerification?.metadataRequestCount === 2 &&
    credentialVerification?.primaryAttempt?.method === "GET" &&
    credentialVerification?.primaryAttempt?.endpoint === GEMINI_METADATA_ENDPOINT &&
    new Set([404, 405]).has(credentialVerification?.primaryAttempt?.httpStatus) &&
    credentialVerification?.primaryAttempt?.status === "unavailable" &&
    validResponseHash
  );
  if (
    !report ||
    report.schemaVersion !== 4 ||
    typeof report.preflightRunId !== "string" ||
    !report.preflightRunId.trim() ||
    report.preflightRunId.length > 160 ||
    !new Set(["passed", "blocked"]).has(report.status) ||
    !new Set([null, "input_required", "revision_required"])
      .has(report.blockerDisposition ?? null) ||
    !Array.isArray(report.checks) ||
    checkIds.length !== PREFLIGHT_CHECK_IDS.length ||
    checkIds.some((id, index) => id !== PREFLIGHT_CHECK_IDS[index]) ||
    new Set(checkIds).size !== PREFLIGHT_CHECK_IDS.length ||
    !report.checks.every((check) =>
      typeof check?.id === "string" &&
      typeof check?.label === "string" &&
      typeof check?.passed === "boolean"
    ) ||
    !Array.isArray(report.failureSummary) ||
    !report.failureSummary.every((item) =>
      typeof item === "string" && item.length <= 2000
    ) ||
    !Number.isFinite(checkedAtTime) ||
    report.generationRequestCount !== 0 ||
    !Number.isInteger(report.metadataRequestCount) ||
    report.metadataRequestCount < 0 ||
    !credentialVerification ||
    !new Set([null, "models.get", "countTokens"])
      .has(credentialVerification.probeKind ?? null) ||
    !new Set([
      null,
      "missing",
      "passed",
      "rejected",
      "unavailable",
      "ambiguous",
      "transient"
    ]).has(credentialVerification.status ?? null) ||
    credentialVerification.generationRequestCount !== 0 ||
    !Number.isInteger(credentialVerification.metadataRequestCount) ||
    credentialVerification.metadataRequestCount < 0 ||
    report.metadataRequestCount !== credentialVerification.metadataRequestCount ||
    !Array.isArray(credentialVerification.supportedGenerationMethods) ||
    !credentialVerification.supportedGenerationMethods.every((method) =>
      typeof method === "string" && method.length <= 120
    ) ||
    (credentialVerification.status === "passed" && !(
      credentialVerification.authScheme === "x-goog-api-key" &&
      (modelsGetPassed || countTokensPassed)
    )) ||
    (credentialVerification.status === "rejected" && !(
      credentialVerification.authScheme === "x-goog-api-key" &&
      credentialVerification.authenticated === false &&
      new Set([401, 403]).has(credentialVerification.httpStatus) &&
      (
        (
          credentialVerification.probeKind === "models.get" &&
          credentialVerification.method === "GET" &&
          credentialVerification.endpoint === GEMINI_METADATA_ENDPOINT &&
          credentialVerification.metadataRequestCount === 1
        ) || (
          credentialVerification.probeKind === "countTokens" &&
          credentialVerification.method === "POST" &&
          credentialVerification.endpoint === GEMINI_COUNT_TOKENS_ENDPOINT &&
          credentialVerification.metadataRequestCount === 2 &&
          credentialVerification.primaryAttempt?.method === "GET" &&
          credentialVerification.primaryAttempt?.endpoint === GEMINI_METADATA_ENDPOINT &&
          new Set([404, 405]).has(
            credentialVerification.primaryAttempt?.httpStatus
          )
        )
      )
    )) ||
    (report.status === "passed" && requiresGeminiProbe &&
      credentialVerification.status !== "passed") ||
    !/^[a-f0-9]{64}$/u.test(String(report.reportHash ?? ""))
  ) {
    return false;
  }
  const body = structuredClone(report);
  delete body.reportHash;
  return integrityHash(body) === report.reportHash && (
    report.status === "passed"
      ? report.blockerDisposition === null && report.checks.every((check) => check.passed)
      : new Set(["input_required", "revision_required"])
        .has(report.blockerDisposition) && report.checks.some((check) => !check.passed)
  );
}

export async function beginAssetExecutionPreflight(
  episodeId,
  input = {},
  options = {}
) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  const checkpoint = assetExecutionCheckpointState(
    sourceEpisode.reviewCheckpoints?.assetExecution
  );
  const candidateHash = String(input.candidateHash ?? "");
  if (
    !assetExecutionApprovalValid(sourceEpisode) ||
    !candidateHash ||
    candidateHash !== checkpoint.currentCandidate?.candidateHash
  ) {
    const error = new Error("零生成预检没有绑定当前已批准候选");
    error.code = "asset_execution_preflight_candidate_conflict";
    throw error;
  }
  const activeRun = sourceEpisode.production?.assetExecutionPreflightRun;
  if (
    activeRun?.status === "checking" &&
    activeRun.candidateHash === candidateHash &&
    activeRun.version === checkpoint.currentCandidate.version
  ) {
    return {
      episode: sourceEpisode,
      checkpoint,
      run: structuredClone(activeRun),
      unchanged: true
    };
  }
  const episode = structuredClone(sourceEpisode);
  revokeCheckpointTools(episode, checkpoint);
  const at = timestamp(options.now);
  const run = {
    schemaVersion: 1,
    runId: options.runId ?? `asset-preflight:${episodeId}:${randomUUID()}`,
    status: "checking",
    candidateHash,
    version: checkpoint.currentCandidate.version,
    startedAt: at,
    completedAt: null,
    reportHash: null,
    generationRequestCount: 0
  };
  if (typeof run.runId !== "string" || !run.runId.trim() || run.runId.length > 160) {
    const error = new Error("零生成预检轮次 ID 无效");
    error.code = "asset_execution_preflight_run_invalid";
    throw error;
  }
  episode.production = {
    ...(episode.production ?? {}),
    assetExecutionPreflight: null,
    assetExecutionPreflightRun: run
  };
  const assetIndex = episode.pipeline.findIndex((step) => step.agent === "asset-agent");
  if (assetIndex >= 0) {
    episode.pipeline[assetIndex] = {
      ...episode.pipeline[assetIndex],
      status: "blocked",
      progress: 0,
      message: "正在运行只读模型元数据鉴权与零生成预检",
      requiresApproval: null,
      requiresHuman: false,
      finishedAt: null,
      lastError: null
    };
  }
  episode.updatedAt = at;
  episode.history = [
    ...(episode.history ?? []),
    {
      at,
      type: "asset-execution-preflight-started",
      status: "checking",
      runId: run.runId,
      version: checkpoint.currentCandidate.version,
      candidateHash,
      message: "旧预检已失效并暂停生成工具，开始零生成鉴权"
    }
  ];
  await writeState(episode);
  await recordEvent({
    type: "asset-execution.preflight_started",
    episodeId,
    version: checkpoint.currentCandidate.version,
    candidateHash,
    runId: run.runId,
    generationRequestCount: 0,
    idempotencyKey: `asset-execution.preflight_started:${episodeId}:${run.runId}`
  });
  return { episode, checkpoint, run, unchanged: false };
}

export async function recordAssetExecutionPreflight(
  episodeId,
  report,
  options = {}
) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  const previous = assetExecutionCheckpointState(sourceEpisode.reviewCheckpoints?.assetExecution);
  if (!assetExecutionPreflightReportValid(report, sourceEpisode)) {
    const error = new Error("素材执行预检报告无效或包含生成请求");
    error.code = "asset_execution_preflight_invalid";
    throw error;
  }
  if (
    !assetExecutionApprovalValid(sourceEpisode) ||
    report.candidateHash !== previous.currentCandidate?.candidateHash ||
    report.version !== previous.currentCandidate?.version
  ) {
    const error = new Error("素材执行预检没有绑定当前已批准候选");
    error.code = "asset_execution_preflight_candidate_conflict";
    throw error;
  }
  const activeRun = sourceEpisode.production?.assetExecutionPreflightRun;
  if (
    sourceEpisode.production?.assetExecutionPreflight?.reportHash === report.reportHash &&
    activeRun?.status === "completed" &&
    activeRun.runId === report.preflightRunId &&
    activeRun.reportHash === report.reportHash
  ) {
    return {
      episode: sourceEpisode,
      checkpoint: previous,
      report: structuredClone(report),
      unchanged: true
    };
  }
  if (
    activeRun?.status !== "checking" ||
    activeRun.runId !== report.preflightRunId ||
    activeRun.candidateHash !== report.candidateHash ||
    activeRun.version !== report.version ||
    activeRun.generationRequestCount !== 0
  ) {
    const error = new Error("零生成预检报告没有绑定当前正在执行的预检轮次");
    error.code = "asset_execution_preflight_run_conflict";
    throw error;
  }
  const at = timestamp(options.now ?? report.checkedAt);
  const passed = report.status === "passed";
  const inputRequired = !passed && report.blockerDisposition === "input_required";
  const checkpoint = {
    ...previous,
    status: passed || inputRequired ? "approved" : "blocked",
    history: [
      ...previous.history,
      {
        type: "execution-preflight",
        at,
        runId: report.preflightRunId,
        version: previous.currentCandidate.version,
        candidateHash: previous.currentCandidate.candidateHash,
        reportHash: report.reportHash,
        status: report.status,
        blockerDisposition: report.blockerDisposition,
        generationRequestCount: 0
      }
    ]
  };
  const episode = structuredClone(sourceEpisode);
  episode.reviewCheckpoints = {
    ...(episode.reviewCheckpoints ?? {}),
    assetExecution: checkpoint
  };
  episode.production = {
    ...(episode.production ?? {}),
    assetExecutionPreflight: structuredClone(report),
    assetExecutionPreflightRun: {
      ...activeRun,
      status: "completed",
      completedAt: at,
      reportHash: report.reportHash,
      disposition: report.blockerDisposition
    }
  };
  const assetIndex = episode.pipeline.findIndex((step) => step.agent === "asset-agent");
  if (passed) {
    episode.control.allowedTools = [
      ...new Set([
        ...(episode.control?.allowedTools ?? []),
        ...externalExecutionToolIds(episode.production?.assetPlan?.content)
      ])
    ];
    if (episode.production?.feedback?.assetExecution?.source === "execution-preflight") {
      delete episode.production.feedback.assetExecution;
    }
  }
  if (
    passed &&
    assetIndex >= 0 &&
    episode.pipeline[assetIndex].status !== "complete"
  ) {
    episode.pipeline[assetIndex] = {
      ...episode.pipeline[assetIndex],
      status: "ready",
      progress: 0,
      message: "素材执行零生成预检已通过，可以继续受控素材制作",
      requiresApproval: null,
      requiresHuman: false,
      finishedAt: null,
      lastError: null
    };
  }
  if (inputRequired) {
    revokeCheckpointTools(episode, previous);
    const feedback = report.failureSummary.join("；") || "素材执行预检等待凭据配置";
    episode.production.assetPlan = {
      ...(episode.production?.assetPlan ?? {}),
      needsRevision: false
    };
    if (assetIndex >= 0) {
      episode.pipeline[assetIndex] = {
        ...episode.pipeline[assetIndex],
        status: "blocked",
        progress: 0,
        message: `素材方案保持批准，等待人工配置：${feedback}`,
        requiresApproval: null,
        requiresHuman: true,
        finishedAt: at,
        lastError: null
      };
    }
    for (let index = assetIndex + 1; index < episode.pipeline.length; index += 1) {
      episode.pipeline[index] = {
        ...episode.pipeline[index],
        status: "pending",
        progress: 0,
        requiresApproval: null,
        requiresHuman: false,
        message: "等待素材执行凭据配置与零生成预检通过"
      };
    }
  } else if (!passed) {
    const feedback = report.failureSummary.join("；") || "素材执行零生成预检未通过";
    revokeCheckpointTools(episode, previous);
    episode.production.assetPlan = {
      ...(episode.production?.assetPlan ?? {}),
      needsRevision: true
    };
    episode.production.feedback = {
      ...(episode.production?.feedback ?? {}),
      assetExecution: {
        text: feedback,
        source: "execution-preflight",
        at,
        version: previous.currentCandidate.version,
        candidateHash: previous.currentCandidate.candidateHash,
        reportHash: report.reportHash
      }
    };
    if (assetIndex >= 0) {
      episode.pipeline[assetIndex] = {
        ...episode.pipeline[assetIndex],
        status: "ready",
        progress: 0,
        message: `零生成预检未通过，退回 Asset Agent：${feedback}`,
        requiresApproval: null,
        requiresHuman: false,
        finishedAt: null,
        lastError: null
      };
    }
    for (let index = assetIndex + 1; index < episode.pipeline.length; index += 1) {
      episode.pipeline[index] = {
        ...episode.pipeline[index],
        status: "pending",
        progress: 0,
        requiresApproval: null,
        requiresHuman: false,
        message: "等待 Asset Agent 根据零生成预检结果生成新方案"
      };
    }
    episode.approvals.assets = {
      ...(episode.approvals.assets ?? {}),
      status: "pending",
      at: null,
      note: "",
      feedback: "",
      provenance: null,
      reviewReportId: null,
      artifactHash: null
    };
    episode.render = { ...(episode.render ?? {}), status: "stale", progress: 0 };
    episode.qa = { ...(episode.qa ?? {}), status: "stale", checkedAt: at };
    episode.status = "in_production";
  }
  episode.updatedAt = at;
  episode.history = [
    ...(episode.history ?? []),
    {
      at,
      type: "asset-execution-preflight",
      status: report.status,
      runId: report.preflightRunId,
      version: previous.currentCandidate.version,
      candidateHash: previous.currentCandidate.candidateHash,
      reportHash: report.reportHash,
      blockerDisposition: report.blockerDisposition,
      message: passed
        ? "素材执行零生成预检通过"
        : inputRequired
          ? "素材执行零生成预检等待人工配置，已保留当前批准方案"
          : "素材执行零生成预检未通过，已直接退回 Asset Agent"
    }
  ];
  await writeState(episode);
  await recordEvent({
    type: passed
      ? "asset-execution.preflight_passed"
      : inputRequired
        ? "asset-execution.preflight_input_required"
        : "asset-execution.preflight_failed",
    episodeId,
    version: previous.currentCandidate.version,
    candidateHash: previous.currentCandidate.candidateHash,
    runId: report.preflightRunId,
    reportHash: report.reportHash,
    blockerDisposition: report.blockerDisposition,
    generationRequestCount: 0,
    idempotencyKey:
      `asset-execution.preflight:${episodeId}:${previous.currentCandidate.candidateHash}:${report.reportHash}`
  });
  return { episode, checkpoint, report: structuredClone(report), unchanged: false };
}

export async function rejectAssetExecutionCandidate(episodeId, input = {}, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  const previous = assetExecutionCheckpointState(sourceEpisode.reviewCheckpoints?.assetExecution);
  const candidateHash = String(input.candidateHash ?? "");
  const feedback = String(input.feedback ?? "").trim();
  if (!previous.currentCandidate || candidateHash !== previous.currentCandidate.candidateHash) {
    const error = new Error("人工驳回没有精确绑定当前素材执行方案和机器审核报告");
    error.code = "asset_execution_review_conflict";
    error.statusCode = 409;
    throw error;
  }
  const machineReviewId = String(input.machineReviewId ?? "");
  if (
    !machineReviewId
    || machineReviewId !== previous.machineReview?.id
    || previous.machineReview?.candidateHash !== candidateHash
  ) {
    const error = new Error("人工驳回没有精确绑定当前素材执行方案和机器审核报告");
    error.code = "asset_execution_review_conflict";
    error.statusCode = 409;
    throw error;
  }
  if (!feedback) {
    const error = new Error("驳回素材执行方案时必须填写修改意见");
    error.code = "asset_execution_feedback_required";
    throw error;
  }
  if (!new Set(["waiting_approval", "approved"]).has(previous.status)) {
    const error = new Error("当前素材执行方案不能进入人工驳回");
    error.code = "asset_execution_not_reviewable";
    error.statusCode = 409;
    throw error;
  }
  const at = timestamp(options.now);
  const actor = typeof options.actor === "string" ? options.actor.slice(0, 128) : null;
  const checkpoint = {
    ...previous,
    status: "rejected",
    humanApproval: {
      decision: "rejected",
      at,
      note: feedback,
      version: previous.currentCandidate.version,
      candidateHash,
      machineReviewId: previous.machineReview?.id ?? null,
      ...(actor ? { actor } : {})
    },
    history: [
      ...previous.history,
      {
        type: "human-approval",
        at,
        version: previous.currentCandidate.version,
        candidateHash,
        machineReviewId: previous.machineReview?.id ?? null,
        decision: "rejected",
        note: feedback,
        ...(actor ? { actor } : {})
      }
    ]
  };
  const episode = structuredClone(sourceEpisode);
  episode.reviewCheckpoints = { ...(episode.reviewCheckpoints ?? {}), assetExecution: checkpoint };
  revokeCheckpointTools(episode, previous);
  episode.production = {
    ...(episode.production ?? {}),
    assetPlan: { ...(episode.production?.assetPlan ?? {}), needsRevision: true },
    feedback: {
      ...(episode.production?.feedback ?? {}),
      assetExecution: {
        text: feedback,
        at,
        version: previous.currentCandidate.version,
        candidateHash
      }
    }
  };
  const assetIndex = episode.pipeline.findIndex((step) => step.agent === "asset-agent");
  if (assetIndex >= 0) {
    episode.pipeline[assetIndex] = {
      ...episode.pipeline[assetIndex],
      status: "ready",
      message: `素材执行方案已退回 Asset Agent：${feedback}`,
      requiresHuman: false
    };
  }
  for (let index = assetIndex + 1; index < episode.pipeline.length; index += 1) {
    episode.pipeline[index] = {
      ...episode.pipeline[index],
      status: "pending",
      progress: 0,
      requiresApproval: null,
      requiresHuman: false,
      message: "等待 Asset Agent 根据人工意见生成新方案"
    };
  }
  episode.updatedAt = at;
  episode.history = [
    ...(episode.history ?? []),
    {
      at,
      type: "asset-execution-human-rejection",
      status: "rejected",
      version: previous.currentCandidate.version,
      candidateHash,
      ...(actor ? { actor } : {}),
      message: feedback
    }
  ];
  await writeState(episode);
  await recordEvent({
    type: "asset-execution.rejected",
    episodeId,
    version: previous.currentCandidate.version,
    candidateHash,
    actor,
    message: feedback,
    idempotencyKey: `asset-execution.rejected:${episodeId}:${candidateHash}:${integrityHash(feedback)}`
  });
  return { episode, checkpoint, unchanged: false };
}

export async function reviseAssetExecutionStrategy(episodeId, input = {}, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const writeState = options.writeEpisode ?? writeEpisode;
  const recordEvent = options.appendEvent ?? appendEvent;
  const sourceEpisode = await readState(episodeId);
  const previous = assetExecutionCheckpointState(sourceEpisode.reviewCheckpoints?.assetExecution);
  const strategy = String(input.strategy ?? "").trim();
  const feedback = String(input.feedback ?? "").trim();
  if (!new Set(["local-only", "hybrid-api-selective"]).has(strategy)) {
    const error = new Error("不支持的素材执行策略");
    error.code = "asset_execution_strategy_invalid";
    throw error;
  }
  const requestedProfile = String(input.generationProfile ?? "").trim();
  const generationProfile = strategy === "hybrid-api-selective"
    ? requestedProfile || sourceEpisode.production?.assetPlanDirection?.generationProfile ||
      HYBRID_GENERATION_PROFILES.OPENAI_LEGACY
    : null;
  if (generationProfile && !SUPPORTED_HYBRID_GENERATION_PROFILES.has(generationProfile)) {
    const error = new Error("不支持的混合生成 Provider 与模型配置");
    error.code = "asset_execution_generation_profile_invalid";
    throw error;
  }
  if (!feedback) {
    const error = new Error("修改素材执行策略时必须记录人工目标");
    error.code = "asset_execution_feedback_required";
    throw error;
  }
  if (!sourceEpisode.production?.assetPlan?.artifactPath || !previous.currentCandidate) {
    const error = new Error("当前没有可修订的素材执行方案");
    error.code = "asset_execution_review_missing";
    throw error;
  }
  const candidateHash = String(input.candidateHash ?? previous.currentCandidate.candidateHash);
  if (candidateHash !== previous.currentCandidate.candidateHash) {
    const error = new Error("策略修订没有绑定当前素材执行方案哈希");
    error.code = "asset_execution_candidate_conflict";
    throw error;
  }
  const at = timestamp(options.now);
  const checkpoint = {
    ...previous,
    status: "rejected",
    humanApproval: {
      decision: "rejected",
      at,
      note: feedback,
      version: previous.currentCandidate.version,
      candidateHash,
      machineReviewId: previous.machineReview?.id ?? null
    },
    history: [
      ...previous.history,
      {
        type: "human-approval",
        at,
        version: previous.currentCandidate.version,
        candidateHash,
        machineReviewId: previous.machineReview?.id ?? null,
        decision: "rejected",
        note: feedback
      },
      {
        type: "strategy-selection",
        at,
        version: previous.currentCandidate.version,
        candidateHash,
        strategy,
        ...(generationProfile ? { generationProfile } : {}),
        note: feedback
      }
    ]
  };
  const episode = structuredClone(sourceEpisode);
  episode.reviewCheckpoints = { ...(episode.reviewCheckpoints ?? {}), assetExecution: checkpoint };
  revokeCheckpointTools(episode, previous);
  episode.production = {
    ...(episode.production ?? {}),
    assetPlan: {
      ...(episode.production?.assetPlan ?? {}),
      content: null,
      needsRevision: true
    },
    assetExecutionPreflight: null,
    assetExecutionPreflightRun: null,
    assetPlanDirection: {
      strategy,
      ...(generationProfile ? { generationProfile } : {}),
      selectedAt: at,
      selectedBy: "human",
      sourceCandidateHash: candidateHash,
      feedback
    },
    feedback: {
      ...(episode.production?.feedback ?? {}),
      assetExecution: {
        text: feedback,
        at,
        version: previous.currentCandidate.version,
        candidateHash,
        strategy,
        ...(generationProfile ? { generationProfile } : {})
      }
    }
  };
  const assetIndex = episode.pipeline.findIndex((step) => step.agent === "asset-agent");
  if (assetIndex >= 0) {
    episode.pipeline[assetIndex] = {
      ...episode.pipeline[assetIndex],
      status: "ready",
      progress: 0,
      message: `根据人工选择生成新的 ${generationProfile ?? strategy} 素材执行方案`,
      requiresApproval: null,
      requiresHuman: false,
      finishedAt: null,
      lastError: null
    };
  }
  for (let index = assetIndex + 1; index < episode.pipeline.length; index += 1) {
    episode.pipeline[index] = {
      ...episode.pipeline[index],
      status: "pending",
      progress: 0,
      requiresApproval: null,
      requiresHuman: false,
      message: "等待新的素材执行方案获得机器审核与人工批准"
    };
  }
  episode.approvals.assets = {
    ...(episode.approvals.assets ?? {}),
    status: "pending",
    at: null,
    note: "",
    feedback: "",
    provenance: null,
    reviewReportId: null,
    artifactHash: null
  };
  episode.render = { ...(episode.render ?? {}), status: "stale", progress: 0 };
  episode.qa = { ...(episode.qa ?? {}), status: "stale", checkedAt: at };
  episode.status = "in_production";
  episode.updatedAt = at;
  episode.history = [
    ...(episode.history ?? []),
    {
      at,
      type: "asset-execution-strategy-selection",
      status: "revision_requested",
      version: previous.currentCandidate.version,
      candidateHash,
      strategy,
      ...(generationProfile ? { generationProfile } : {}),
      message: feedback
    }
  ];
  await writeState(episode);
  await recordEvent({
    type: "asset-execution.strategy_selected",
    episodeId,
    version: previous.currentCandidate.version,
    candidateHash,
    strategy,
    ...(generationProfile ? { generationProfile } : {}),
    message: feedback,
    idempotencyKey:
      `asset-execution.strategy_selected:${episodeId}:${candidateHash}:${strategy}:${generationProfile ?? "none"}`
  });
  return { episode, checkpoint, unchanged: false };
}

export async function verifyAssetExecutionApproval(episodeId, options = {}) {
  const readState = options.readEpisode ?? readEpisode;
  const episode = await readState(episodeId);
  const checkpoint = assetExecutionCheckpointState(episode.reviewCheckpoints?.assetExecution);
  if (!checkpoint.currentCandidate) {
    return {
      valid: false,
      status: "not_started",
      checkpoint,
      checks: [reviewCheck("candidate", "素材执行方案已登记", false, null, "registered")]
    };
  }
  let inspected;
  try {
    inspected = await reinspectCheckpointCandidate(episode, checkpoint, options);
  } catch (error) {
    return {
      valid: false,
      status: "stale",
      checkpoint,
      checks: [
        reviewCheck(
          "evidence-readable",
          "素材执行方案审批证据仍可读取",
          false,
          error?.code ?? "evidence_error",
          "readable"
        )
      ]
    };
  }
  const checks = [
    ...inspected.checks,
    reviewCheck(
      "candidate-hash",
      "当前方案仍匹配机器审核候选哈希",
      inspected.candidate.candidateHash === checkpoint.currentCandidate.candidateHash &&
        checkpoint.machineReview?.candidateHash === checkpoint.currentCandidate.candidateHash,
      inspected.candidate.candidateHash,
      checkpoint.currentCandidate.candidateHash
    ),
    reviewCheck(
      "human-approval",
      "人工审批绑定当前候选与机器审核",
      checkpoint.status === "approved" &&
        checkpoint.machineReview?.status === "passed" &&
        checkpoint.humanApproval?.decision === "approved" &&
        checkpoint.humanApproval?.candidateHash === checkpoint.currentCandidate.candidateHash &&
        checkpoint.humanApproval?.machineReviewId === checkpoint.machineReview?.id,
      checkpoint.humanApproval?.decision ?? null,
      "approved"
    )
  ];
  return {
    valid: checks.every((check) => check.passed),
    status: checkpoint.status,
    checkpoint,
    checks
  };
}

export function assetExecutionApprovalRecordValid(episode) {
  const checkpoint = assetExecutionCheckpointState(episode.reviewCheckpoints?.assetExecution);
  const currentPlan = episode.production?.assetPlan;
  const requiredToolIds = externalExecutionToolIds(currentPlan?.content);
  return Boolean(
    checkpoint.status === "approved" &&
    checkpoint.machineReview?.status === "passed" &&
    checkpoint.currentCandidate?.candidateHash &&
    checkpoint.machineReview.candidateHash === checkpoint.currentCandidate.candidateHash &&
    checkpoint.humanApproval?.decision === "approved" &&
    checkpoint.humanApproval.candidateHash === checkpoint.currentCandidate.candidateHash &&
    checkpoint.humanApproval.machineReviewId === checkpoint.machineReview.id &&
    integrityHash(checkpoint.humanApproval.authorizedToolIds ?? []) ===
      integrityHash(requiredToolIds) &&
    currentPlan?.version === checkpoint.currentCandidate.version &&
    workspaceRelativePath(currentPlan?.artifactPath) === checkpoint.currentCandidate.artifact?.path &&
    integrityHash(currentPlan?.content) === checkpoint.currentCandidate.planHash
  );
}

export function assetExecutionApprovalValid(episode) {
  if (!assetExecutionApprovalRecordValid(episode)) return false;
  const currentPlan = episode.production?.assetPlan;
  const currentCalls = currentPlan?.content?.executionPolicy?.externalApiCalls ?? [];
  const technicalContractsCurrent = !String(currentPlan?.content?.visualSystem ?? "")
    .includes("技术图解") || currentCalls.every(technicalDiagramContractValid);
  const progressiveMotionCurrent = progressiveTechnicalFlowPlanReview(
    currentPlan?.content
  ).passed;
  return technicalContractsCurrent && progressiveMotionCurrent;
}

export function assetExecutionApprovalRequired(episode) {
  return Boolean(
    episode.production?.assetPlan?.content?.executionPolicy
    || episode.reviewCheckpoints?.assetExecution
  );
}

export function assetExecutionPreflightValid(episode) {
  const checkpoint = assetExecutionCheckpointState(episode.reviewCheckpoints?.assetExecution);
  const report = episode.production?.assetExecutionPreflight;
  const run = episode.production?.assetExecutionPreflightRun;
  return Boolean(
    assetExecutionApprovalValid(episode) &&
    assetExecutionPreflightReportValid(report, episode) &&
    report.status === "passed" &&
    report.candidateHash === checkpoint.currentCandidate?.candidateHash &&
    report.version === checkpoint.currentCandidate?.version &&
    report.generationRequestCount === 0 &&
    run?.status === "completed" &&
    run.runId === report.preflightRunId &&
    run.candidateHash === report.candidateHash &&
    run.version === report.version &&
    run.generationRequestCount === 0 &&
    run.reportHash === report.reportHash
  );
}

export function assertAssetExecutionAuthorized(episode, request = {}) {
  if (!assetExecutionApprovalValid(episode)) {
    const error = new Error("素材执行方案尚未获得与当前候选绑定的机器审核和人工批准");
    error.code = "asset_execution_approval_required";
    throw error;
  }
  const plan = episode.production.assetPlan.content;
  const item = plan.items.find((candidate) => candidate.id === request.itemId);
  if (!item) {
    const error = new Error("请求执行的素材不在已批准方案中");
    error.code = "asset_execution_item_not_approved";
    throw error;
  }
  if (request.external !== true) {
    if (
      item.productionMethod?.executor !== request.executor ||
      item.productionMethod?.externalProvider ||
      item.productionMethod?.externalModel
    ) {
      const error = new Error("本地素材执行器或制作方式不在已批准范围内");
      error.code = "asset_execution_method_not_approved";
      throw error;
    }
    return { authorized: true, item: structuredClone(item), externalCall: null };
  }
  const externalCall = plan.executionPolicy.externalApiCalls.find(
    (call) => call.id === request.callId
  );
  if (externalCall?.executionPreflight && !assetExecutionPreflightValid(episode)) {
    const error = new Error("外部素材调用尚未通过与当前候选绑定的零生成预检");
    error.code = "asset_execution_preflight_required";
    throw error;
  }
  const billingAuthorized = !externalCall?.billing || Boolean(
    request.billingCurrency === externalCall.billing.currency &&
    finiteCost(request.maximumCost) &&
    request.maximumCost <= externalCall.billing.maximumAmount
  );
  const requestParametersAuthorized = integrityHash(request.requestParameters ?? null) ===
    integrityHash(externalCall?.requestParameters ?? null);
  if (
    !externalCall ||
    externalCall.providerId !== request.providerId ||
    externalCall.model !== request.model ||
    !finiteCost(request.maximumCostUsd) ||
    request.maximumCostUsd > externalCall.maximumCostUsd ||
    !billingAuthorized ||
    !requestParametersAuthorized ||
    item.productionMethod?.externalProvider !== request.providerId ||
    item.productionMethod?.externalModel !== request.model ||
    externalCall.endpoint !== request.endpoint ||
    externalCall.prompt !== request.prompt ||
    externalCall.outputSpec !== request.outputSpec
  ) {
    const error = new Error("外部素材调用超出已批准的 Provider、模型、条目或费用范围");
    error.code = "asset_execution_scope_exceeded";
    throw error;
  }
  return {
    authorized: true,
    item: structuredClone(item),
    externalCall: structuredClone(externalCall)
  };
}
