// Internal factory for synthetic-store tests. The production wrapper seals all
// storage dependencies and always uses the real local bundle implementation.
import {canonicalJsonDocumentContentSha256 as digest} from "../../shared/durable-json-store.mjs";
import {validateEpisode} from "../../shared/schema.mjs";
import {validateEditorialAssetsMaterializePreview, validateEditorialAssetsMaterializeRequest,
  editorialAssetsMaterializeCapabilitySpec, EDITORIAL_ASSETS_MATERIALIZE_OPERATION} from "../../shared/editorial-assets-materialize-request.mjs";
import {requireSideEffectGrant} from "../security/side-effect-capability.mjs";
import {acquireEpisodeOperation} from "../control/episode-operation-lock.mjs";
import {assertEditorialFirstMaterialization, completeEditorialMaterializationStep,
  editorialMaterializationError} from "../control/editorial-materialization-transition.mjs";
import {assetExecutionApprovalValid} from "../reviews/asset-execution-checkpoint.mjs";
import {createEditorialAssetsPrepareService} from "./editorial-assets-prepare-core.mjs";
import {buildEditorialMaterializationBundle} from "./editorial-materialization-bundle.mjs";
import {verifyEditorialMaterializationBundle} from "./editorial-materialization-integrity.mjs";

const same = (a, b) => digest(a ?? null) === digest(b ?? null);
export function createEditorialAssetsMaterializeService(dependencies) {
  const {workspaceRoot: root, readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig} = dependencies;
  if (!root || [readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig].some(fn => typeof fn !== "function")) {
    throw new TypeError("Incomplete editorial materialization dependencies");
  }
  const buildBundle = dependencies.buildBundle ?? buildEditorialMaterializationBundle;
  const verifyBundle = dependencies.verifyBundle ?? verifyEditorialMaterializationBundle;
  if (typeof buildBundle !== "function" || typeof verifyBundle !== "function") throw new TypeError("Invalid internal bundle adapter");
  const preparation = createEditorialAssetsPrepareService(dependencies);
  async function load(input) {
    const {episodeId} = validateEditorialAssetsMaterializePreview(input);
    const episode = await readEpisode(episodeId); const config = await readReviewConfig();
    if (episode?.id !== episodeId || !validateEpisode(episode).valid) throw editorialMaterializationError("editorial_materialization_episode_invalid");
    if (episode.control?.activeOperation || episode.control?.stopRequested || episode.pipeline.some(item => item.status === "running")) {
      throw editorialMaterializationError("editorial_materialization_episode_busy");
    }
    // This re-opens the original research/script/storyboard files, prepared
    // artifact and receipt, current code closure, font files and Logo frames.
    const prepared = await preparation.previewEditorialAssetsPreparation({episodeId});
    const checkpoint = episode.reviewCheckpoints?.assetExecution;
    const human = checkpoint?.humanApproval;
    if (prepared.preparationState !== "already_prepared" || !prepared.humanApproved || !assetExecutionApprovalValid(episode)
      || typeof human?.actor !== "string" || !/^human:[^\s\p{Cc}]{1,120}$/u.test(human.actor)
      || !Number.isFinite(Date.parse(human.at)) || human.maximumPaidCostUsd !== 0 || human.externalApiCallCount !== 0
      || human.authorizedToolIds?.length || checkpoint.currentCandidate.candidateHash !== episode.production.assetPlan.candidateHash
      || checkpoint.machineReview.status !== "passed") throw editorialMaterializationError("editorial_materialization_approval_required");
    // Bracket the expensive file inspection with actual state/config reads.
    // A mid-read approval or content update is not an approval of these bytes.
    if (!same(episode, await readEpisode(episodeId)) || !same(config, await readReviewConfig())) {
      throw editorialMaterializationError("editorial_materialization_snapshot_changed");
    }
    return {episode, prepared, snapshotHash: digest({episode, config, preparedSnapshotHash: prepared.snapshotHash}),
      candidateHash: checkpoint.currentCandidate.candidateHash, machineReviewId: checkpoint.machineReview.id,
      implementationHash: prepared.implementationHash};
  }
  function assertRequestBinding(value, request) {
    if (request.candidateHash !== value.candidateHash || request.machineReviewId !== value.machineReviewId
      || request.implementationHash !== value.implementationHash) throw editorialMaterializationError("editorial_materialization_binding_changed");
  }
  async function registered(value, request) {
    const receipt = value.episode.production?.editorialMaterialization;
    const pipeline = value.episode.pipeline;
    const assetStep = pipeline.find(item => item.id === "assets");
    if (!receipt || receipt.operationId !== digest(request) || !same(receipt.request, request)) {
      throw editorialMaterializationError("editorial_materialization_conflict");
    }
    if (new Set(pipeline.map(item => item.id)).size !== pipeline.length
      || assetStep?.agent !== "asset-agent" || assetStep.status !== "complete") {
      throw editorialMaterializationError("editorial_materialization_registration_changed");
    }
    const verified = await verifyBundle({workspaceRoot: root, episode: value.episode,
      receipt, requireCurrentImplementation: true});
    if (!same(verified.receipt, receipt) || !same(verified.assetRecords, value.episode.assets)) {
      throw editorialMaterializationError("editorial_materialization_registration_changed");
    }
    return verified;
  }
  async function previewEditorialAssetsMaterialization(input) {
    const value = await load(input);
    let receipt = null;
    if (value.episode.production?.editorialMaterialization) {
      const request = validateEditorialAssetsMaterializeRequest(value.episode.production.editorialMaterialization.request);
      assertRequestBinding(value, request); receipt = (await registered(value, request)).receipt;
    } else assertEditorialFirstMaterialization(value.episode);
    return {episodeId: value.episode.id, snapshotHash: value.snapshotHash, candidateHash: value.candidateHash,
      machineReviewId: value.machineReviewId, implementationHash: value.implementationHash,
      assetPlanVersion: value.episode.production.assetPlan.version, itemCount: value.episode.production.assetPlan.content.items.length,
      materializationState: receipt ? "already_materialized" : "not_started", receipt,
      humanApproved: true, paidCalls: 0, estimatedCostUsd: 0, rendered: false, voiceStatus: "deferred", visualAcceptance: false};
  }
  async function audit(receipt, options) {
    try {
      requireSideEffectGrant(options, editorialAssetsMaterializeCapabilitySpec(receipt.request), EDITORIAL_ASSETS_MATERIALIZE_OPERATION);
      await appendEvent({type: "assets.editorial-materialized", episodeId: receipt.episodeId, agentId: "asset-agent",
        actor: receipt.request.actor, version: receipt.version, operationId: receipt.operationId,
        idempotencyKey: `editorial-materialization:${receipt.operationId}`, candidateHash: receipt.candidateHash,
        manifestPath: receipt.manifestPath, paidCalls: 0, estimatedCostUsd: 0,
        message: "本地动画包文件已核验；未配音、未正式渲染、未视觉验收"});
      return {status: "committed", errorCode: null};
    } catch { return {status: "pending", errorCode: "editorial_materialization_audit_pending"}; }
  }
  const response = (receipt, status, outcome, commit = null) => ({status, episodeId: receipt.episodeId, version: receipt.version,
    manifestPath: receipt.manifestPath, bundlePath: receipt.bundlePath, inputPropsPath: receipt.inputPropsPath,
    candidateHash: receipt.candidateHash, paidCalls: 0, estimatedCostUsd: 0, rendered: false,
    voiceStatus: "deferred", visualAcceptance: false, audit: outcome, commit});
  async function materializeEditorialAssets(rawRequest, options = {}) {
    const request = validateEditorialAssetsMaterializeRequest(rawRequest);
    if (!options || typeof options !== "object" || Array.isArray(options)
      || ![null, Object.prototype].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        return key !== "sideEffectGrant" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value");
      })) throw editorialMaterializationError("editorial_materialization_options_invalid");
    const grant = requireSideEffectGrant(options, editorialAssetsMaterializeCapabilitySpec(request), EDITORIAL_ASSETS_MATERIALIZE_OPERATION);
    if (grant.maxCalls !== 0 || grant.maxCostUsd !== 0 || !same([...grant.scopes].sort(), ["filesystem.write", "state.write"])) {
      throw editorialMaterializationError("editorial_materialization_capability_not_zero");
    }
    const release = acquireEpisodeOperation(request.episodeId, EDITORIAL_ASSETS_MATERIALIZE_OPERATION);
    try {
      const value = await load({episodeId: request.episodeId}); assertRequestBinding(value, request);
      if (value.episode.production?.editorialMaterialization) {
        const verified = await registered(value, request); const outcome = await audit(verified.receipt, options);
        return response(verified.receipt, outcome.status === "pending" ? "committed_with_warning" : "already_committed", outcome);
      }
      assertEditorialFirstMaterialization(value.episode);
      if (value.snapshotHash !== request.snapshotHash) throw editorialMaterializationError("editorial_materialization_snapshot_changed");
      const built = await buildBundle({workspaceRoot: root, episode: value.episode,
        operationId: digest(request), request, sideEffectGrant: options.sideEffectGrant});
      const current = await load({episodeId: request.episodeId}); assertRequestBinding(current, request);
      if (current.snapshotHash !== request.snapshotHash) throw editorialMaterializationError("editorial_materialization_snapshot_changed");
      // Verify every newly written bundle/resource/manifest byte after the last
      // upstream inspection, immediately before a single version-bound commit.
      const verified = await verifyBundle({workspaceRoot: root, episode: current.episode,
        receipt: built.receipt, requireCurrentImplementation: true});
      if (!same(built.receipt, verified.receipt) || !same(built.assetRecords, verified.assetRecords)) {
        throw editorialMaterializationError("editorial_materialization_output_changed");
      }
      const next = completeEditorialMaterializationStep(current.episode, {receipt: verified.receipt,
        assetRecords: verified.assetRecords, now: new Date().toISOString()});
      requireSideEffectGrant(options, editorialAssetsMaterializeCapabilitySpec(request), EDITORIAL_ASSETS_MATERIALIZE_OPERATION);
      await writeEpisode(next);
      const commit = readEpisodeCommitStatus(request.episodeId); const outcome = await audit(verified.receipt, options);
      return response(verified.receipt, outcome.status === "pending" || commit?.warningCount > 0 || commit?.commitStatus === "committed_with_warnings"
        ? "committed_with_warning" : "committed", outcome, commit);
    } finally { release(); }
  }
  return Object.freeze({previewEditorialAssetsMaterialization, materializeEditorialAssets});
}
