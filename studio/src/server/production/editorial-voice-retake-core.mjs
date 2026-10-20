// Internal protocol. Its adapters are injected only by synthetic tests; the
// production wrapper fixes all roots, source verification and subprocess IO.
import {canonicalJsonDocumentContentSha256 as digest} from "../../shared/durable-json-store.mjs";
import {buildEditorialVoiceRetakePlan} from "../../shared/editorial-voice-retakes.mjs";
import {validateEditorialVoiceRetakePreview, validateEditorialVoiceRetakeRequest, editorialVoiceRetakeInput,
  editorialVoiceRetakeCapabilitySpec, EDITORIAL_VOICE_RETAKE_OPERATION} from "../../shared/editorial-voice-retake-request.mjs";
import {assertEditorialFirstVoiceRegistration} from "../control/editorial-voice-transition.mjs";
import {acquireEpisodeOperation} from "../control/episode-operation-lock.mjs";
import {requireSideEffectGrant} from "../security/side-effect-capability.mjs";

const same = (a, b) => digest(a ?? null) === digest(b ?? null);
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function fail(code) {throw Object.assign(new Error("局部重合成与原音频、修复方案或当前状态不匹配"), {code, statusCode: 409});}
function exactGrant(request, options) {
  const claims = requireSideEffectGrant(options, editorialVoiceRetakeCapabilitySpec(request), EDITORIAL_VOICE_RETAKE_OPERATION);
  if (claims.maxCalls !== 0 || claims.maxCostUsd !== 0 || !same([...claims.scopes].sort(), ["filesystem.write", "local-inference"])) {
    fail("editorial_voice_retake_capability_not_zero");
  }
  return claims;
}
export function createEditorialVoiceRetakeService(dependencies) {
  const {workspaceRoot, readEpisode, readReviewConfig, inspectBase, readRepairPlan,
    prepareDriver, generateCandidate, verifyCandidate} = dependencies;
  if (!workspaceRoot || [readEpisode, readReviewConfig, inspectBase, readRepairPlan, prepareDriver,
    generateCandidate, verifyCandidate].some(fn => typeof fn !== "function")) throw new TypeError("Incomplete retake dependencies");
  async function load(rawInput) {
    const input = validateEditorialVoiceRetakePreview(rawInput);
    const episode = await readEpisode(input.episodeId); const config = await readReviewConfig();
    if (episode?.id !== input.episodeId) fail("editorial_voice_retake_episode_invalid");
    assertEditorialFirstVoiceRegistration(episode);
    const base = await inspectBase({workspaceRoot, episode, reviewConfig: config,
      baseCandidatePath: input.baseCandidatePath, baseCandidateSha256: input.baseCandidateSha256});
    const repair = await readRepairPlan({workspaceRoot, path: input.repairPlanPath});
    if (base.candidateSha256 !== input.baseCandidateSha256 || !sha(base.implementationHash)
      || repair.record?.path !== input.repairPlanPath || repair.record.sha256 !== input.repairPlanSha256
      || !Number.isSafeInteger(repair.record.bytes) || repair.record.bytes < 1
      || !same(repair.value?.baseCandidate, {path: input.baseCandidatePath, sha256: input.baseCandidateSha256})) {
      fail("editorial_voice_retake_input_changed");
    }
    const retakePlan = buildEditorialVoiceRetakePlan(base.basePlan, base.timing, repair.value);
    const driverRequest = await prepareDriver({workspaceRoot, base, repairPlan: repair.value, retakePlan});
    const source = base.source; const implementationHash = base.implementationHash;
    if (!source || ![source.scriptBindingHash, source.storyboardBindingHash, source.materializationManifestSha256].every(sha)
      || source.materializationManifestSha256 !== episode.production.editorialMaterialization.manifestSha256) {
      fail("editorial_voice_retake_source_invalid");
    }
    if (!same(episode, await readEpisode(input.episodeId)) || !same(config, await readReviewConfig())) {
      fail("editorial_voice_retake_snapshot_changed");
    }
    const sourceHash = digest(source);
    const snapshotHash = digest({episode, config, input, source, implementationHash, repair: repair.record, driverRequest});
    return {input, episode, config, base, repair, retakePlan, driverRequest, source, sourceHash, implementationHash, snapshotHash};
  }
  async function previewEditorialVoiceRetake(input) {
    const value = await load(input);
    return {...value.input, snapshotHash: value.snapshotHash, implementationHash: value.implementationHash,
      sourceHash: value.sourceHash, source: value.source, voiceId: value.retakePlan.voiceId, speed: value.retakePlan.speed,
      retakeParentCount: value.retakePlan.parents.filter(parent => parent.mode === "retake").length,
      reuseParentCount: value.retakePlan.parents.filter(parent => parent.mode === "reuse").length,
      partCount: value.retakePlan.parents.reduce((count, parent) => count + parent.parts.length, 0),
      paidCalls: 0, estimatedCostUsd: 0, registered: false, rendered: false};
  }
  async function retakeEditorialVoice(rawRequest, options = {}) {
    const request = validateEditorialVoiceRetakeRequest(rawRequest);
    if (!options || typeof options !== "object" || Array.isArray(options)
      || ![null, Object.prototype].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).some(key => {
        const d = Object.getOwnPropertyDescriptor(options, key);
        return key !== "sideEffectGrant" || !d.enumerable || !Object.hasOwn(d, "value");
      })) fail("editorial_voice_retake_options_invalid");
    exactGrant(request, options);
    const release = acquireEpisodeOperation(request.episodeId, EDITORIAL_VOICE_RETAKE_OPERATION);
    try {
      const input = editorialVoiceRetakeInput(request); const preview = await load(input);
      if (preview.snapshotHash !== request.snapshotHash || preview.sourceHash !== request.sourceHash
        || preview.implementationHash !== request.implementationHash) fail("editorial_voice_retake_snapshot_changed");
      exactGrant(request, options);
      const candidate = await generateCandidate({workspaceRoot, preview, request, sideEffectGrant: options.sideEffectGrant});
      const after = await load(input);
      if (after.snapshotHash !== request.snapshotHash) fail("editorial_voice_retake_snapshot_changed");
      const verified = await verifyCandidate({workspaceRoot, episode: after.episode, reviewConfig: after.config,
        candidatePath: candidate.candidatePath});
      if (verified.candidateSha256 !== candidate.candidateSha256 || !same(verified.source, preview.source)
        || verified.implementationHash !== preview.implementationHash) fail("editorial_voice_retake_output_changed");
      if (!same(after.episode, await readEpisode(request.episodeId)) || !same(after.config, await readReviewConfig())) {
        fail("editorial_voice_retake_snapshot_changed");
      }
      exactGrant(request, options);
      return {...candidate, paidCalls: 0, estimatedCostUsd: 0, registered: false, rendered: false,
        renderReady: false, humanVoiceAccepted: false};
    } finally {release();}
  }
  return Object.freeze({previewEditorialVoiceRetake, retakeEditorialVoice});
}
