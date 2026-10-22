import { integrityHash as hash } from "../../shared/integrity.mjs";
import { currentGateArtifactHash } from "../../shared/workflow.mjs";
import { approvalValidForGate } from "../control/policy-engine.mjs";
import { inspectTimedEditorialEpisode } from "./timed-editorial-content.mjs";
import { editorialCodeImplementationValid } from "./editorial-code-implementation.mjs";

export const EDITORIAL_ASSET_PLAN_KIND = "editorial-code-asset-plan-v1";
const sourceKeys = ["artifactVersion","artifactHash","reviewReportId","artifactPath","artifactSha256","manifestPath","manifestSha256"];
const fail = () => { throw Object.assign(new Error("素材方案必须精确绑定已批逐拍分镜和真实本地实现"), {
  code: "editorial_asset_plan_invalid", statusCode: 409
}); };

export function editorialSourceStoryboard(episode) {
  const draft = episode.production?.storyboardDraft;
  const approval = episode.approvals?.storyboard;
  return {artifactVersion: draft?.version, artifactHash: currentGateArtifactHash(episode,"storyboard"),
    reviewReportId: approval?.reviewReportId, artifactPath: draft?.artifactPath,
    artifactSha256: draft?.sha256, manifestPath: draft?.manifestPath, manifestSha256: draft?.manifestSha256};
}

export function buildEditorialAssetPlan(episode, {sourceStoryboard, implementation}) {
  if (!approvalValidForGate(episode,"storyboard") || !inspectTimedEditorialEpisode(episode).valid
    || !editorialCodeImplementationValid(implementation) || !sourceStoryboard
    || Object.keys(sourceStoryboard).sort().join("|") !== [...sourceKeys].sort().join("|")
    || hash(sourceStoryboard) !== hash(editorialSourceStoryboard(episode))) fail();
  const execution = episode.production.storyboardDraft.content.executionPlan;
  const items = episode.scenes.map(scene => ({id: `editorial-${scene.id}`, assetType: "animation",
    required: true, sceneIds: [scene.id], purpose: scene.title,
    sourceRequirement: "只使用当前批准的逐拍执行计划，不新增脚本事实、对象语义或插画比喻",
    rightsRequirement: "本地项目代码和既有品牌资源；字体许可证与文件摘要见 implementation.font",
    productionMethod: {kind: "local-code-animation", executor: "EditorialMotionPreview"},
    estimatedCost: {maximumCostUsd: 0}, outputStatus: "not-materialized",
    binding: {sceneId: scene.id, startFrame: scene.startFrame, endFrame: scene.endFrame,
      sourceShotIds: structuredClone(scene.sourceShotIds), unitIds: structuredClone(scene.unitIds),
      narrationSha256: hash(scene.narration), motionPlanSha256: hash(scene.motionPlan),
      captionSha256: hash(episode.subtitles.filter(cue => cue.sceneId === scene.id)),
      eventIds: scene.motionPlan.events.map(event => event.id),
      objectIds: scene.motionPlan.objects.map(object => object.id), implementationSha256: implementation.sha256}}));
  return {schemaVersion: 1, kind: EDITORIAL_ASSET_PLAN_KIND, episodeId: episode.id,
    sourceStoryboard: structuredClone(sourceStoryboard), executionPlanSha256: hash(execution),
    visualSystem: "approved-editorial-motion-frosted-mint-v1", implementation: structuredClone(implementation),
    items, voice: {status: "deferred", audioAligned: false, generationRequests: 0,
      reason: "当前仅准备代码素材；声音需要独立授权、生成和实测校时"},
    renderAuthorized: false, materializationStatus: "not-started", visualAcceptance: false,
    executionPolicy: {mode: "local-only", externalApiCalls: [], generationRequests: 0,
      maximumPaidCostUsd: 0, currency: "USD", pricingConfirmed: true,
      costScope: "local-source-and-resource-preparation-only", humanApprovalRequiredBeforeExecution: true,
      invalidatesOnPlanChange: true},
    risks: ["文件绑定不等于镜头已渲染或用户已验收",
      "编辑时间轴尚未与实测语音对齐", "字体文件已绑定，但浏览器字体解析与真实画面仍需后续检查"]};
}

export function inspectEditorialAssetPlan(episode, plan, {version} = {}) {
  let expected = null; let error = null;
  try { expected = buildEditorialAssetPlan(episode, {sourceStoryboard: plan?.sourceStoryboard, implementation: plan?.implementation}); }
  catch (cause) { error = cause?.code ?? "editorial_asset_plan_invalid"; }
  const check = (id,label,passed,actual,expectedValue) => ({id,label,passed:Boolean(passed),actual,expected:expectedValue});
  const passed = Boolean(expected && hash(plan) === hash(expected));
  const checks = [
    check("plan-version","素材方案绑定正整数版本",Number.isSafeInteger(version) && version > 0,version,"positive integer"),
    check("editorial-storyboard-implementation-contract","逐拍分镜与实现合同可重建",Boolean(expected),error,"valid current approved execution plan"),
    check("editorial-exact-plan-fidelity","方案所有字段均忠于确定性派生结果",passed,hash(plan ?? null),expected ? hash(expected) : null)
  ];
  const declaredCalls = Array.isArray(plan?.executionPolicy?.externalApiCalls) ? plan.executionPolicy.externalApiCalls : [];
  return {checks, passed: checks.every(item=>item.passed), summary: {
    kind: EDITORIAL_ASSET_PLAN_KIND, itemCount: plan?.items?.length ?? 0,
    requiredVisualItemCount: plan?.items?.length ?? 0, productionMethods: ["local-code-animation"],
    externalApiCallCount: declaredCalls.length, externalApiCalls: structuredClone(declaredCalls),
    maximumPaidCostUsd: plan?.executionPolicy?.maximumPaidCostUsd ?? null, currency: plan?.executionPolicy?.currency ?? null,
    billingCurrencies: [], nativeCurrencyCaps: [], budgetNormalization: null,
    costScope: plan?.executionPolicy?.costScope ?? null, pricingConfirmed: plan?.executionPolicy?.pricingConfirmed === true,
    voiceStatus: plan?.voice?.status ?? null, renderAuthorized: plan?.renderAuthorized ?? null,
    materializationStatus: plan?.materializationStatus ?? null, visualAcceptance: plan?.visualAcceptance ?? null,
    fontBrowserResolutionVerified: plan?.implementation?.font?.browserResolutionVerified ?? null}};
}
