import {approvalValidForGate} from "./policy-engine.mjs";
import {assertWorkerRunAllowed} from "./workflow-kernel.mjs";
import {validateEpisode} from "../../shared/schema.mjs";
import {validateWorkerMutation} from "../../shared/agent-contracts.mjs";
import {nextAssetBundleRevision, resetApprovalForVersion} from "../../shared/workflow.mjs";
import {integrityHash} from "../../shared/integrity.mjs";

export function editorialAssetsError(code) {
  return Object.assign(new Error("编辑素材准备与当前批准、实现或流转状态不再匹配"), {code, statusCode: 409});
}

// Kernel-owned first-preparation transition. Revisions/materialization use a
// separate explicit flow; this boundary cannot replace existing accepted work.
export function assertEditorialAssetsFirstPreparation(episode) {
  const index = episode.pipeline?.findIndex(step => step.id === "assets");
  const step = episode.pipeline?.[index];
  const downstream = episode.pipeline?.slice(index + 1) ?? [];
  if (!validateEpisode(episode).valid || episode.control?.activeOperation || episode.control?.stopRequested
    || episode.pipeline.some(s => s.status === "running")
    || !["research", "script", "storyboard"].every(gate => approvalValidForGate(episode, gate)
      && episode.pipeline.find(s => s.id === gate)?.status === "complete")
    || step?.agent !== "asset-agent" || step.status !== "ready" || step.requiresHuman
    || step.requiresApproval || !downstream.length || downstream.some(s => s.status !== "pending" || s.requiresHuman || s.requiresApproval)
    || episode.production?.assetPlan || episode.production?.voicePlan || episode.production?.materialsVersion
    || episode.production?.assetBundleRevision || episode.assets?.length
    || ![null, undefined, "not_started"].includes(episode.reviewCheckpoints?.assetExecution?.status)
    || episode.approvals?.assets?.status !== "pending" || episode.approvals?.assets?.artifactHash
    || episode.approvals?.final?.status !== "pending" || episode.approvals?.final?.artifactHash
    || episode.voice?.audioPath || episode.voice?.publicPath || episode.voice?.version || episode.voice?.status === "ready"
    || episode.render?.outputPath || episode.render?.version || episode.render?.renderedAt
    || episode.qa?.reportPath || episode.qa?.version) throw editorialAssetsError("editorial_assets_transition_invalid");
  assertWorkerRunAllowed(episode, "asset-agent");
  return index;
}

export function prepareEditorialAssetsStep(sourceEpisode, {entry, plan, checkpoint, now}) {
  const index = assertEditorialAssetsFirstPreparation(sourceEpisode);
  if (!entry || entry.version !== 1 || !["blocked", "waiting_approval"].includes(checkpoint?.status)
    || checkpoint.humanApproval !== null || checkpoint.currentCandidate?.version !== entry.version
    || checkpoint.currentCandidate?.planHash !== integrityHash(plan)
    || checkpoint.currentCandidate?.artifact?.path !== entry.artifactPath
    || !Number.isFinite(Date.parse(now))) throw editorialAssetsError("editorial_assets_transition_invalid");
  const passed = checkpoint.machineReview?.status === "passed";
  if (passed !== (checkpoint.status === "waiting_approval")) throw editorialAssetsError("editorial_assets_transition_invalid");
  const revision = nextAssetBundleRevision(sourceEpisode);
  const patch = {production: {assetBundleRevision: revision, assetPlan: {...structuredClone(entry),
    content: structuredClone(plan), needsRevision: !passed, versions: [structuredClone(entry)]}},
  approvals: {assets: resetApprovalForVersion(sourceEpisode.approvals.assets, revision)},
  reviewCheckpoints: {assetExecution: structuredClone(checkpoint)}};
  const mutation = validateWorkerMutation(sourceEpisode, "asset-agent", {status: "blocked",
    message: "编辑素材方案等待独立执行审批", requiresApproval: null, requiresHuman: passed,
    artifacts: [entry.artifactPath, entry.manifestPath], findings: [], patch});
  if (!mutation.valid) throw editorialAssetsError("editorial_assets_transition_scope_invalid");
  const episode = structuredClone(sourceEpisode);
  episode.production = {...episode.production, ...patch.production};
  episode.approvals = {...episode.approvals, ...patch.approvals};
  episode.reviewCheckpoints = {...episode.reviewCheckpoints, ...patch.reviewCheckpoints};
  episode.pipeline[index] = {...episode.pipeline[index], status: "blocked", progress: 0,
    requiresHuman: passed, requiresApproval: null, finishedAt: null, lastError: null,
    message: passed ? "素材方案机器检查通过，等待独立人工批准；尚未制作、配音或渲染" : "素材方案机器检查未通过，未进入制作",
    artifacts: [entry.artifactPath, entry.manifestPath], findings: structuredClone(checkpoint.machineReview.checks)};
  episode.updatedAt = now;
  episode.history = [...episode.history, {at: now, type: "editorial-assets-prepared", version: entry.version,
    operationId: entry.operationId, candidateHash: checkpoint.currentCandidate.candidateHash,
    message: episode.pipeline[index].message, paidCalls: 0, estimatedCostUsd: 0}];
  if (!validateEpisode(episode).valid) throw editorialAssetsError("editorial_assets_episode_invalid");
  return episode;
}
