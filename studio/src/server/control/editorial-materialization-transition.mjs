import {approvalValidForGate} from "./policy-engine.mjs";
import {assertWorkerRunAllowed} from "./workflow-kernel.mjs";
import {validateEpisode} from "../../shared/schema.mjs";
import {validateWorkerMutation} from "../../shared/agent-contracts.mjs";
import {assetExecutionApprovalValid} from "../reviews/asset-execution-checkpoint.mjs";

export function editorialMaterializationError(code) {
  return Object.assign(new Error("本地素材物化与当前批准、文件或流转状态不匹配"), {code, statusCode: 409});
}

export function assertEditorialFirstMaterialization(episode) {
  const index = episode.pipeline?.findIndex(step => step.id === "assets");
  const step = episode.pipeline?.[index];
  const downstream = episode.pipeline?.slice(index + 1) ?? [];
  const ids = episode.pipeline?.map(item => item.id) ?? [];
  if (!validateEpisode(episode).valid || new Set(ids).size !== ids.length
    || episode.control?.activeOperation || episode.control?.stopRequested
    || episode.pipeline.some(item => item.status === "running")
    || !["research", "script", "storyboard"].every(gate => approvalValidForGate(episode, gate)
      && episode.pipeline.find(item => item.id === gate)?.status === "complete")
    || !assetExecutionApprovalValid(episode) || episode.production?.assetPlan?.needsRevision
    || episode.production?.assetPlan?.content?.kind !== "editorial-code-asset-plan-v1"
    || step?.agent !== "asset-agent" || step.status !== "ready" || step.requiresHuman || step.requiresApproval
    || downstream[0]?.id !== "voice" || downstream[0]?.agent !== "voice-agent"
    || downstream.some(item => item.status !== "pending" || item.requiresHuman || item.requiresApproval)
    || episode.production?.editorialMaterialization || episode.production?.voicePlan || episode.production?.materialsVersion
    || episode.assets?.length || episode.approvals?.assets?.status !== "pending" || episode.approvals?.assets?.artifactHash
    || episode.approvals?.final?.status !== "pending" || episode.approvals?.final?.artifactHash
    || episode.voice?.audioPath || episode.voice?.publicPath || episode.voice?.version || episode.voice?.status === "ready"
    || episode.render?.outputPath || episode.render?.version || episode.render?.renderedAt
    || episode.qa?.reportPath || episode.qa?.version) throw editorialMaterializationError("editorial_materialization_transition_invalid");
  assertWorkerRunAllowed(episode, "asset-agent");
  return index;
}

export function completeEditorialMaterializationStep(sourceEpisode, {receipt, assetRecords, now}) {
  const index = assertEditorialFirstMaterialization(sourceEpisode);
  const checkpoint = sourceEpisode.reviewCheckpoints.assetExecution;
  if (receipt?.schemaVersion !== "editorial-materialization-receipt-v1" || receipt.episodeId !== sourceEpisode.id
    || receipt.version !== 1 || receipt.assetPlanVersion !== sourceEpisode.production.assetPlan.version
    || receipt.candidateHash !== checkpoint.currentCandidate.candidateHash || receipt.machineReviewId !== checkpoint.machineReview.id
    || receipt.implementationSha256 !== sourceEpisode.production.assetPlan.implementationHash
    || receipt.rendered !== false || receipt.voiceStatus !== "deferred"
    || receipt.externalApiCalls !== 0 || receipt.maximumPaidCostUsd !== 0
    || !Array.isArray(assetRecords) || assetRecords.length !== sourceEpisode.production.assetPlan.content.items.length
    || !Number.isFinite(Date.parse(now))) throw editorialMaterializationError("editorial_materialization_transition_invalid");
  const patch = {production: {editorialMaterialization: structuredClone(receipt)}, assets: structuredClone(assetRecords)};
  const mutation = validateWorkerMutation(sourceEpisode, "asset-agent", {status: "complete", message: "本地编辑素材已制作，尚未配音或视觉验收",
    requiresApproval: null, requiresHuman: false, artifacts: [receipt.manifestPath, receipt.inputPropsPath], findings: [], patch});
  if (!mutation.valid) throw editorialMaterializationError("editorial_materialization_transition_scope_invalid");
  const episode = structuredClone(sourceEpisode);
  episode.production = {...episode.production, ...patch.production}; episode.assets = patch.assets;
  episode.pipeline[index] = {...episode.pipeline[index], status: "complete", progress: 100,
    requiresHuman: false, requiresApproval: null, finishedAt: now, lastError: null,
    message: "本地动画包已制作并核验文件；未配音、未正式渲染、未视觉验收",
    artifacts: [receipt.manifestPath, receipt.inputPropsPath], findings: []};
  episode.pipeline[index + 1] = {...episode.pipeline[index + 1], status: "ready", progress: 0,
    message: "可规划声音阶段；未生成声音，须另行授权", requiresHuman: false, requiresApproval: null};
  episode.updatedAt = now;
  episode.history = [...episode.history, {at: now, type: "editorial-assets-materialized", version: receipt.version,
    operationId: receipt.operationId, candidateHash: receipt.candidateHash,
    message: episode.pipeline[index].message, paidCalls: 0, estimatedCostUsd: 0}];
  if (!validateEpisode(episode).valid) throw editorialMaterializationError("editorial_materialization_episode_invalid");
  return episode;
}
