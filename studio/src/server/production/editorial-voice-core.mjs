// Internal protocol with injectable synthetic-store dependencies. Production
// callers use the sealed wrapper, never these adapters or constructor options.
import {canonicalJsonDocumentContentSha256 as digest} from "../../shared/durable-json-store.mjs";
import {validateEpisode} from "../../shared/schema.mjs";
import {validateEditorialVoiceRegisterPreview, validateEditorialVoiceRegisterRequest,
  editorialVoiceRegisterCapabilitySpec, EDITORIAL_VOICE_REGISTER_OPERATION} from "../../shared/editorial-voice-register-request.mjs";
import {validateEditorialVoiceReceipt, editorialVoiceRegistrationValid} from "../../shared/editorial-voice-contract.mjs";
import {requireSideEffectGrant} from "../security/side-effect-capability.mjs";
import {acquireEpisodeOperation} from "../control/episode-operation-lock.mjs";
import {assertEditorialFirstVoiceRegistration, registerEditorialVoiceTransition, editorialVoiceError}
  from "../control/editorial-voice-transition.mjs";

const same = (a, b) => digest(a ?? null) === digest(b ?? null);
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

export function createEditorialVoiceService(dependencies) {
  const {workspaceRoot, readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig,
    inspectCandidate, materializeCandidate, verifyRegistered} = dependencies;
  if (!workspaceRoot || [readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig,
    inspectCandidate, materializeCandidate, verifyRegistered].some(fn => typeof fn !== "function")) {
    throw new TypeError("Incomplete editorial voice dependencies");
  }
  async function load(input) {
    const {episodeId, candidatePath} = validateEditorialVoiceRegisterPreview(input);
    const episode = await readEpisode(episodeId); const config = await readReviewConfig();
    if (episode?.id !== episodeId || !validateEpisode(episode).valid) throw editorialVoiceError("editorial_voice_episode_invalid");
    if (episode.control?.activeOperation || episode.control?.stopRequested || episode.pipeline.some(step => step.status === "running")) {
      throw editorialVoiceError("editorial_voice_episode_busy");
    }
    if (!episode.production?.editorialVoice) assertEditorialFirstVoiceRegistration(episode);
    const candidate = await inspectCandidate({workspaceRoot, episode, reviewConfig: config, candidatePath});
    if (!sha(candidate?.candidateSha256) || !sha(candidate?.implementationHash)
      || !candidate.source || ![candidate.source.scriptBindingHash, candidate.source.storyboardBindingHash,
        candidate.source.materializationManifestSha256].every(sha)
      || candidate.source.materializationManifestSha256 !== episode.production?.editorialMaterialization?.manifestSha256) {
      throw editorialVoiceError("editorial_voice_candidate_invalid");
    }
    // Close async source inspection against concurrent updates of either state
    // or config. The final durable write still has its own cross-process CAS.
    if (!same(episode, await readEpisode(episodeId)) || !same(config, await readReviewConfig())) {
      throw editorialVoiceError("editorial_voice_snapshot_changed");
    }
    return {episode, config, candidate, candidatePath, snapshotHash: digest({episode, config,
      candidateSha256: candidate.candidateSha256, source: candidate.source, implementationHash: candidate.implementationHash})};
  }
  function assertRequestBinding(value, request) {
    if (request.candidatePath !== value.candidatePath || request.episodeId !== value.episode.id
      || request.candidateSha256 !== value.candidate.candidateSha256 || request.implementationHash !== value.candidate.implementationHash) {
      throw editorialVoiceError("editorial_voice_binding_changed");
    }
  }
  function assertReceiptBinding(value, request, input) {
    const receipt = validateEditorialVoiceReceipt(input);
    if (!same(receipt.request, request) || receipt.episodeId !== value.episode.id
      || receipt.candidateSha256 !== value.candidate.candidateSha256 || !same(receipt.source, value.candidate.source)) {
      throw editorialVoiceError("editorial_voice_receipt_changed");
    }
    return receipt;
  }
  async function registered(value, request) {
    const receipt = value.episode.production?.editorialVoice;
    if (!receipt || !same(receipt.request, request) || receipt.operationId !== digest(request)) {
      throw editorialVoiceError("editorial_voice_conflict");
    }
    assertReceiptBinding(value, request, receipt);
    if (!editorialVoiceRegistrationValid(value.episode, receipt)) throw editorialVoiceError("editorial_voice_registration_changed");
    const verified = await verifyRegistered({workspaceRoot, episode: value.episode, receipt, reviewConfig: value.config});
    if (!same(verified, receipt)) throw editorialVoiceError("editorial_voice_registration_changed");
    if (!same(value.episode, await readEpisode(request.episodeId)) || !same(value.config, await readReviewConfig())) {
      throw editorialVoiceError("editorial_voice_snapshot_changed");
    }
    return receipt;
  }
  async function previewEditorialVoiceRegistration(input) {
    const value = await load(input); let receipt = null;
    if (value.episode.production?.editorialVoice) {
      const request = validateEditorialVoiceRegisterRequest(value.episode.production.editorialVoice.request);
      assertRequestBinding(value, request); receipt = await registered(value, request);
    }
    return {episodeId: value.episode.id, candidatePath: value.candidatePath,
      candidateSha256: value.candidate.candidateSha256, implementationHash: value.candidate.implementationHash,
      source: structuredClone(value.candidate.source), snapshotHash: value.snapshotHash,
      registrationState: receipt ? "already_registered" : "not_started", receipt,
      captionAligned: true, alignmentMethod: "synthesis-segment-sample-boundaries-v1", motionAligned: false,
      renderReady: false, humanVoiceAccepted: false, paidCalls: 0, estimatedCostUsd: 0};
  }
  async function audit(receipt, options) {
    try {
      requireSideEffectGrant(options, editorialVoiceRegisterCapabilitySpec(receipt.request), EDITORIAL_VOICE_REGISTER_OPERATION);
      await appendEvent({type: "voice.editorial-registered", episodeId: receipt.episodeId, agentId: "voice-agent",
        actor: receipt.request.actor, operationId: receipt.operationId, candidateSha256: receipt.candidateSha256,
        manifestPath: receipt.manifest.path, idempotencyKey: `editorial-voice:${receipt.operationId}`,
        message: "本地完整旁白及短句字幕已登记；未声音验收、未动画校时、未渲染", paidCalls: 0, estimatedCostUsd: 0});
      return {status: "committed", errorCode: null};
    } catch { return {status: "pending", errorCode: "editorial_voice_audit_pending"}; }
  }
  const response = (receipt, status, outcome, commit = null) => ({status, episodeId: receipt.episodeId,
    receipt, audioPath: receipt.audio.path, captionsPath: receipt.captions.path, timingPath: receipt.timing.path,
    captionAligned: true, alignmentMethod: receipt.alignmentMethod, motionAligned: false, renderReady: false,
    humanVoiceAccepted: false, paidCalls: 0, estimatedCostUsd: 0, audit: outcome, commit});
  async function registerEditorialVoice(rawRequest, options = {}) {
    const request = validateEditorialVoiceRegisterRequest(rawRequest);
    if (!options || typeof options !== "object" || Array.isArray(options)
      || ![null, Object.prototype].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).some(key => {
        const d = Object.getOwnPropertyDescriptor(options, key);
        return key !== "sideEffectGrant" || !d.enumerable || !Object.hasOwn(d, "value");
      })) throw editorialVoiceError("editorial_voice_options_invalid");
    const grant = requireSideEffectGrant(options, editorialVoiceRegisterCapabilitySpec(request), EDITORIAL_VOICE_REGISTER_OPERATION);
    if (grant.maxCalls !== 0 || grant.maxCostUsd !== 0 || !same([...grant.scopes].sort(), ["filesystem.write", "state.write"])) {
      throw editorialVoiceError("editorial_voice_capability_not_zero");
    }
    const release = acquireEpisodeOperation(request.episodeId, EDITORIAL_VOICE_REGISTER_OPERATION);
    try {
      const input = {episodeId: request.episodeId, candidatePath: request.candidatePath};
      const value = await load(input); assertRequestBinding(value, request);
      if (value.episode.production?.editorialVoice) {
        const receipt = await registered(value, request); const outcome = await audit(receipt, options);
        return response(receipt, outcome.status === "pending" ? "committed_with_warning" : "already_committed", outcome);
      }
      if (value.snapshotHash !== request.snapshotHash) throw editorialVoiceError("editorial_voice_snapshot_changed");
      const built = assertReceiptBinding(value, request, await materializeCandidate({workspaceRoot, episode: value.episode,
        candidate: value.candidate, request, sideEffectGrant: options.sideEffectGrant}));
      const current = await load(input); assertRequestBinding(current, request);
      if (current.snapshotHash !== request.snapshotHash) throw editorialVoiceError("editorial_voice_snapshot_changed");
      const verified = assertReceiptBinding(current, request, await verifyRegistered({workspaceRoot, episode: current.episode,
        receipt: built, reviewConfig: current.config}));
      if (!same(built, verified)) throw editorialVoiceError("editorial_voice_output_changed");
      if (!same(current.episode, await readEpisode(request.episodeId)) || !same(current.config, await readReviewConfig())) {
        throw editorialVoiceError("editorial_voice_snapshot_changed");
      }
      const next = registerEditorialVoiceTransition(current.episode, {receipt: verified});
      // Grant expiry during byte verification must not enter the durable CAS.
      requireSideEffectGrant(options, editorialVoiceRegisterCapabilitySpec(request), EDITORIAL_VOICE_REGISTER_OPERATION);
      await writeEpisode(next);
      const commit = readEpisodeCommitStatus(request.episodeId); const outcome = await audit(verified, options);
      return response(verified, outcome.status === "pending" || commit?.warningCount > 0 || commit?.commitStatus === "committed_with_warnings"
        ? "committed_with_warning" : "committed", outcome, commit);
    } finally { release(); }
  }
  return Object.freeze({previewEditorialVoiceRegistration, registerEditorialVoice});
}
