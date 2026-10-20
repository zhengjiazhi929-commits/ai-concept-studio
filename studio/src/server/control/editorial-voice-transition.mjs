import {validateEpisode, PIPELINE_DEFINITIONS} from "../../shared/schema.mjs";
import {approvalValidForGate} from "./policy-engine.mjs";
import {invalidateReviewForGate, nextAssetBundleRevision, resetApprovalForVersion} from "../../shared/workflow.mjs";
import {validateEditorialVoiceReceipt, buildEditorialVoiceRecord} from "../../shared/editorial-voice-contract.mjs";

export function editorialVoiceError(code) {
  return Object.assign(new Error("本地旁白登记与当前来源、文件或审批状态不匹配"), {code, statusCode: 409});
}
export function assertEditorialFirstVoiceRegistration(episode) {
  const ids = episode.pipeline?.map(step => step.id) ?? [];
  const voiceIndex = ids.indexOf("voice"); const voice = episode.pipeline?.[voiceIndex];
  if (!validateEpisode(episode).valid || episode.control?.reviewEnabled !== true
    || new Set(ids).size !== ids.length || voiceIndex < 0 || ids.length !== PIPELINE_DEFINITIONS.length
    || PIPELINE_DEFINITIONS.some((definition, index) => episode.pipeline[index]?.id !== definition.id
      || episode.pipeline[index]?.agent !== definition.agent)
    || episode.control?.activeOperation || episode.control?.stopRequested || episode.pipeline.some(step => step.status === "running")
    || !["research", "script", "storyboard"].every(gate => approvalValidForGate(episode, gate)
      && episode.pipeline.find(step => step.id === gate)?.status === "complete")
    || episode.pipeline.find(step => step.id === "assets")?.status !== "complete"
    || episode.production?.editorialMaterialization?.schemaVersion !== "editorial-materialization-receipt-v1"
    || episode.production.editorialMaterialization.episodeId !== episode.id || episode.production?.editorialVoice
    || voice?.agent !== "voice-agent" || voice.status !== "ready" || voice.requiresApproval || voice.requiresHuman
    || episode.pipeline.slice(voiceIndex + 1).some(step => step.status !== "pending" || step.requiresApproval || step.requiresHuman)
    || episode.voice?.status !== "unconfigured" || episode.voice?.mode || episode.voice?.audioPath || episode.voice?.publicPath || episode.voice?.version
    || episode.approvals?.assets?.status !== "pending" || episode.approvals.assets.artifactHash
    || episode.approvals?.final?.status !== "pending" || episode.approvals.final.artifactHash
    || episode.render?.outputPath || episode.render?.version || episode.render?.renderedAt || episode.qa?.reportPath || episode.qa?.version) {
    throw editorialVoiceError("editorial_voice_transition_invalid");
  }
  return voiceIndex;
}

export function registerEditorialVoiceTransition(sourceEpisode, {receipt: input}) {
  const voiceIndex = assertEditorialFirstVoiceRegistration(sourceEpisode);
  const receipt = validateEditorialVoiceReceipt(input);
  if (receipt.episodeId !== sourceEpisode.id
    || receipt.source.materializationManifestSha256 !== sourceEpisode.production.editorialMaterialization.manifestSha256) {
    throw editorialVoiceError("editorial_voice_source_changed");
  }
  const episode = structuredClone(sourceEpisode);
  const revision = nextAssetBundleRevision(episode);
  episode.production = {...episode.production, editorialVoice: receipt, assetBundleRevision: revision};
  episode.voice = buildEditorialVoiceRecord(receipt);
  episode.approvals.assets = resetApprovalForVersion(episode.approvals.assets, revision);
  episode.approvals.final = resetApprovalForVersion(episode.approvals.final, episode.render?.version ?? null);
  invalidateReviewForGate(episode, "assets"); invalidateReviewForGate(episode, "final");
  episode.pipeline[voiceIndex] = {...episode.pipeline[voiceIndex], status: "ready", progress: 0,
    requiresHuman: false, requiresApproval: null, finishedAt: null, lastError: null, findings: [],
    message: "本地完整旁白与实测短句字幕已登记；等待声音审核，未批准素材与声音 Gate",
    artifacts: [receipt.audio.path, receipt.captions.path, receipt.timing.path, receipt.manifest.path]};
  for (let index = voiceIndex + 1; index < episode.pipeline.length; index++) {
    episode.pipeline[index] = {...episode.pipeline[index], status: "pending", progress: 0,
      requiresHuman: false, requiresApproval: null, message: "等待声音验收与独立动画校时集成"};
  }
  episode.render = {...episode.render, status: "stale", progress: 0};
  episode.qa = {...episode.qa, status: "stale", checkedAt: receipt.registeredAt};
  episode.status = "in_production"; episode.updatedAt = receipt.registeredAt;
  episode.history = [...episode.history, {at: receipt.registeredAt, type: "editorial-voice-registered",
    operationId: receipt.operationId, candidateSha256: receipt.candidateSha256, actor: receipt.request.actor,
    message: episode.pipeline[voiceIndex].message, paidCalls: 0, estimatedCostUsd: 0}];
  if (!validateEpisode(episode).valid) throw editorialVoiceError("editorial_voice_episode_invalid");
  return episode;
}
