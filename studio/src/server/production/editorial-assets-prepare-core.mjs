// Internal synthetic-store factory; the production wrapper fixes dependencies.
import {resolve} from "node:path";
import {canonicalJsonDocumentContentSha256 as digest, jsonDocumentContentSha256,
  writeImmutableJsonDocument} from "../../shared/durable-json-store.mjs";
import {integrityHash} from "../../shared/integrity.mjs";
import {validateEpisode} from "../../shared/schema.mjs";
import {validateEditorialAssetsPreparePreview, validateEditorialAssetsPrepareRequest,
  editorialAssetsPrepareCapabilitySpec, EDITORIAL_ASSETS_PREPARE_OPERATION} from "../../shared/editorial-assets-prepare-request.mjs";
import {requireSideEffectGrant} from "../security/side-effect-capability.mjs";
import {acquireEpisodeOperation} from "../control/episode-operation-lock.mjs";
import {assertEditorialAssetsFirstPreparation, prepareEditorialAssetsStep,
  editorialAssetsError} from "../control/editorial-assets-transition.mjs";
import {loadApprovedStoryboardBinding} from "./approved-storyboard-binding.mjs";
import {inspectEditorialCodeImplementation} from "./editorial-code-implementation.mjs";
import {buildEditorialAssetPlan} from "./editorial-asset-plan.mjs";
import {readLocalStoryboardJson} from "./local-storyboard-candidate.mjs";
import {buildAssetExecutionCheckpoint, inspectAssetExecutionCandidate, assetExecutionApprovalValid} from "../reviews/asset-execution-checkpoint.mjs";

const KIND = "editorial-assets-zero-call-preparation-v1";
const byteLength = value => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);
const same = (left, right) => digest(left ?? null) === digest(right ?? null);

export function createEditorialAssetsPrepareService(dependencies) {
  const {workspaceRoot: root, readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig} = dependencies;
  if (!root || [readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig].some(fn => typeof fn !== "function")) {
    throw new TypeError("Incomplete editorial assets preparation dependencies");
  }
  async function load(raw) {
    const {episodeId} = validateEditorialAssetsPreparePreview(raw);
    const episode = await readEpisode(episodeId);
    if (episode?.id !== episodeId || !validateEpisode(episode).valid) throw editorialAssetsError("editorial_assets_episode_invalid");
    if (episode.control?.activeOperation || episode.control?.stopRequested || episode.pipeline.some(s => s.status === "running")) {
      throw editorialAssetsError("editorial_assets_episode_busy");
    }
    const reviewConfig = await readReviewConfig();
    const binding = await loadApprovedStoryboardBinding({workspaceRoot: root, episode, reviewConfig});
    if (episode.pipeline.find(s => s.id === "storyboard")?.status !== "complete") throw editorialAssetsError("editorial_assets_storyboard_not_complete");
    const implementation = await inspectEditorialCodeImplementation({workspaceRoot: root});
    const plan = buildEditorialAssetPlan(episode, {sourceStoryboard: binding.sourceStoryboard, implementation});
    const planHash = integrityHash(plan);
    return {episode, reviewConfig, ...binding, implementation, plan, planHash,
      snapshotHash: digest({episode, reviewConfig, bindingHash: binding.bindingHash, planHash, implementationHash: implementation.sha256})};
  }
  async function previewEditorialAssetsPreparation(input) {
    const value = await load(input);
    if (!value.episode.production?.assetPlan) assertEditorialAssetsFirstPreparation(value.episode);
    else if (value.episode.production.assetPlan.generationKind !== KIND) throw editorialAssetsError("editorial_assets_existing_plan");
    else await verifyRegistered(value, validateEditorialAssetsPrepareRequest(value.episode.production.assetPlan.request));
    return {episodeId: value.episode.id, snapshotHash: value.snapshotHash, planHash: value.planHash,
      implementationHash: value.implementation.sha256, sourceStoryboard: value.sourceStoryboard,
      itemCount: value.plan.items.length, currentVersion: value.episode.production?.assetPlan?.version ?? 0,
      preparationState: value.episode.production?.assetPlan ? "already_prepared" : "not_started",
      voiceStatus: "deferred", rendered: false, humanApproved: assetExecutionApprovalValid(value.episode), paidCalls: 0, estimatedCostUsd: 0};
  }
  function assertRequestBinding(value, request) {
    if (request.planHash !== value.planHash || request.implementationHash !== value.implementation.sha256) {
      throw editorialAssetsError("editorial_assets_binding_changed");
    }
  }
  async function audit(entry, guard) {
    try {
      guard();
      await appendEvent({type: "assets.editorial-prepared", episodeId: entry.request.episodeId,
        agentId: "asset-agent", actor: entry.request.actor, version: entry.version,
        idempotencyKey: `editorial-assets:${entry.operationId}`, candidateHash: entry.candidateHash,
        artifactPath: entry.artifactPath, paidCalls: 0, estimatedCostUsd: 0,
        message: "确定性素材方案已登记；等待独立执行审批，尚未制作、配音或渲染"});
      return {status: "committed", errorCode: null};
    } catch (error) { return {status: "pending", errorCode: error?.code === "side_effect_capability_expired" ? error.code : "editorial_assets_audit_pending"}; }
  }
  async function verifyRegistered(value, request) {
    const current = value.episode.production?.assetPlan;
    const operationId = digest(request);
    const entry = current?.versions?.find(item => item.operationId === operationId);
    if (!current || current.generationKind !== KIND || current.operationId !== operationId || !entry
      || current.versions.length !== 1 || current.version !== 1 || !same(current.request, request)
      || entry.bindingHash !== value.bindingHash || entry.planHash !== value.planHash
      || entry.implementationHash !== value.implementation.sha256 || !same(current.content, value.plan)
      || !Object.keys(entry).every(key => same(entry[key], current[key]))) throw editorialAssetsError("editorial_assets_preparation_conflict");
    const prefix = `studio/data/production/episodes/${request.episodeId}/editorial-assets/${operationId}/`;
    if (entry.artifactPath !== `${prefix}asset-plan-v001.json` || entry.manifestPath !== `${prefix}prepare.json`) {
      throw editorialAssetsError("editorial_assets_artifact_changed");
    }
    const artifact = await readLocalStoryboardJson(root, entry.artifactPath, [prefix], 4 * 1024 * 1024);
    const manifest = await readLocalStoryboardJson(root, entry.manifestPath, [prefix], 4 * 1024 * 1024);
    const expectedArtifact = {schemaVersion: 1, kind: KIND, episodeId: request.episodeId, plan: value.plan};
    if (artifact.sha256 !== entry.sha256 || artifact.bytes !== entry.bytes || !same(artifact.value, expectedArtifact)
      || manifest.sha256 !== entry.manifestSha256 || manifest.bytes !== entry.manifestBytes
      || !same(manifest.value, manifestContent(value, request, entry.artifactPath, entry.sha256))) {
      throw editorialAssetsError("editorial_assets_artifact_changed");
    }
    const checkpoint = value.episode.reviewCheckpoints?.assetExecution;
    const inspected = await inspectAssetExecutionCandidate(value.episode, {artifactPath: entry.artifactPath, version: 1},
      {workspaceRoot: root, reviewConfig: value.reviewConfig});
    if (checkpoint?.currentCandidate?.candidateHash !== entry.candidateHash || inspected.candidate.candidateHash !== entry.candidateHash
      || digest(checkpoint.machineReview) !== entry.machineReviewHash
      || !["waiting_approval", "approved", "blocked"].includes(checkpoint.status)
      || current.needsRevision !== (checkpoint.machineReview.status !== "passed")
      || inspected.passed !== (checkpoint.machineReview.status === "passed")) {
      throw editorialAssetsError("editorial_assets_checkpoint_changed");
    }
    const expectedEntry = {version: 1, generationKind: KIND, operationId, request, artifactPath: entry.artifactPath,
      sha256: artifact.sha256, bytes: artifact.bytes, manifestPath: entry.manifestPath,
      manifestSha256: manifest.sha256, manifestBytes: manifest.bytes, sourceStoryboard: value.sourceStoryboard,
      sourceScript: value.sourceScript, sourceResearch: value.sourceResearch, bindingHash: value.bindingHash,
      planHash: value.planHash, implementationHash: value.implementation.sha256,
      candidateHash: inspected.candidate.candidateHash, machineReviewHash: digest(checkpoint.machineReview),
      preparedAt: entry.preparedAt, preparedBy: request.actor, paidCalls: 0, estimatedCostUsd: 0};
    if (typeof entry.preparedAt !== "string" || !Number.isFinite(Date.parse(entry.preparedAt))
      || new Date(entry.preparedAt).toISOString() !== entry.preparedAt || !same(entry, expectedEntry)
      || !same(current, {...expectedEntry, content: value.plan, needsRevision: checkpoint.machineReview.status !== "passed", versions: [expectedEntry]})) {
      throw editorialAssetsError("editorial_assets_receipt_changed");
    }
    return entry;
  }
  function manifestContent(value, request, artifactPath, sha256) {
    return {schemaVersion: 1, kind: KIND, operationId: digest(request), request, version: 1,
      artifactPath, artifactSha256: sha256, planHash: value.planHash,
      implementationHash: value.implementation.sha256, sourceStoryboard: value.sourceStoryboard,
      sourceScript: value.sourceScript, sourceResearch: value.sourceResearch, bindingHash: value.bindingHash,
      paidCalls: 0, estimatedCostUsd: 0, rendered: false, voiceStatus: "deferred"};
  }
  async function prepareEditorialAssets(rawRequest, options = {}) {
    const request = validateEditorialAssetsPrepareRequest(rawRequest);
    if (!options || typeof options !== "object" || Array.isArray(options)
      || ![null, Object.prototype].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).some(key => {
        const d = Object.getOwnPropertyDescriptor(options, key);
        return key !== "sideEffectGrant" || !d.enumerable || !Object.hasOwn(d, "value");
      })) throw editorialAssetsError("editorial_assets_options_invalid");
    const checkedOptions = Object.freeze({sideEffectGrant: options.sideEffectGrant});
    const guard = () => requireSideEffectGrant(checkedOptions, editorialAssetsPrepareCapabilitySpec(request), EDITORIAL_ASSETS_PREPARE_OPERATION);
    const grant = guard();
    if (grant.maxCalls !== 0 || grant.maxCostUsd !== 0 || !same([...grant.scopes].sort(), ["filesystem.write", "state.write"])) {
      throw editorialAssetsError("editorial_assets_capability_not_zero");
    }
    const release = acquireEpisodeOperation(request.episodeId, EDITORIAL_ASSETS_PREPARE_OPERATION);
    try {
      const value = await load({episodeId: request.episodeId});
      assertRequestBinding(value, request);
      if (value.episode.production?.assetPlan) {
        const entry = await verifyRegistered(value, request);
        guard();
        const outcome = await audit(entry, guard);
        return {status: outcome.status === "pending" ? "committed_with_warning" : "already_committed",
          episodeId: request.episodeId, version: 1, artifactPath: entry.artifactPath, manifestPath: entry.manifestPath,
          candidateHash: entry.candidateHash, paidCalls: 0, estimatedCostUsd: 0, audit: outcome};
      }
      assertEditorialAssetsFirstPreparation(value.episode);
      if (value.snapshotHash !== request.snapshotHash) throw editorialAssetsError("editorial_assets_snapshot_changed");
      const operationId = digest(request);
      const directory = `studio/data/production/episodes/${request.episodeId}/editorial-assets/${operationId}`;
      const artifactPath = `${directory}/asset-plan-v001.json`; const manifestPath = `${directory}/prepare.json`;
      const artifact = {schemaVersion: 1, kind: KIND, episodeId: request.episodeId, plan: value.plan};
      const sha256 = jsonDocumentContentSha256(artifact);
      const manifest = manifestContent(value, request, artifactPath, sha256);
      guard(); await writeImmutableJsonDocument(resolve(root, artifactPath), artifact, {storeRoot: root});
      guard(); await writeImmutableJsonDocument(resolve(root, manifestPath), manifest, {storeRoot: root});
      const candidateEpisode = structuredClone(value.episode);
      candidateEpisode.production.assetPlan = {version: 1, artifactPath, content: value.plan};
      const review = await buildAssetExecutionCheckpoint(candidateEpisode, {artifactPath, version: 1},
        {workspaceRoot: root, reviewConfig: value.reviewConfig});
      // Re-read all state, approved artifacts, current configuration and actual
      // implementation/resource files before the single CAS commit.
      const current = await load({episodeId: request.episodeId});
      assertRequestBinding(current, request);
      if (current.snapshotHash !== request.snapshotHash) throw editorialAssetsError("editorial_assets_snapshot_changed");
      // The checkpoint read predates the final source/resource inspection. A
      // swapped new artifact or manifest must not be registered by that CAS.
      const prefix = `${directory}/`;
      const finalArtifact = await readLocalStoryboardJson(root, artifactPath, [prefix], 4 * 1024 * 1024);
      const finalManifest = await readLocalStoryboardJson(root, manifestPath, [prefix], 4 * 1024 * 1024);
      if (finalArtifact.sha256 !== sha256 || finalArtifact.bytes !== byteLength(artifact) || !same(finalArtifact.value, artifact)
        || finalManifest.sha256 !== jsonDocumentContentSha256(manifest) || finalManifest.bytes !== byteLength(manifest)
        || !same(finalManifest.value, manifest)) throw editorialAssetsError("editorial_assets_artifact_changed");
      const now = new Date().toISOString();
      const entry = {version: 1, generationKind: KIND, operationId, request, artifactPath, sha256,
        bytes: byteLength(artifact), manifestPath, manifestSha256: jsonDocumentContentSha256(manifest), manifestBytes: byteLength(manifest),
        sourceStoryboard: value.sourceStoryboard, sourceScript: value.sourceScript, sourceResearch: value.sourceResearch,
        bindingHash: value.bindingHash, planHash: value.planHash, implementationHash: value.implementation.sha256,
        candidateHash: review.checkpoint.currentCandidate.candidateHash, machineReviewHash: digest(review.checkpoint.machineReview),
        preparedAt: now, preparedBy: request.actor, paidCalls: 0, estimatedCostUsd: 0};
      const next = prepareEditorialAssetsStep(current.episode, {entry, plan: value.plan, checkpoint: review.checkpoint, now});
      guard(); await writeEpisode(next);
      const commit = readEpisodeCommitStatus(request.episodeId); const outcome = await audit(entry, guard);
      return {status: outcome.status === "pending" || commit?.warningCount > 0 || commit?.commitStatus === "committed_with_warnings"
        ? "committed_with_warning" : "committed", episodeId: request.episodeId, version: 1, artifactPath, manifestPath,
      candidateHash: entry.candidateHash, checkpointStatus: review.checkpoint.status, machineStatus: review.checkpoint.machineReview.status,
      humanApproved: false, paidCalls: 0, estimatedCostUsd: 0, rendered: false, voiceStatus: "deferred", audit: outcome, commit};
    } finally { release(); }
  }
  return Object.freeze({previewEditorialAssetsPreparation, prepareEditorialAssets});
}
