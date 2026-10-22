// Internal factory: tests provide synthetic temporary stores. The production
// wrapper fixes dependencies; a request cannot supply callbacks or a model.
import { resolve } from "node:path";
import { canonicalJsonDocumentContentSha256 as digest, jsonDocumentContentSha256, writeImmutableJsonDocument }
  from "../../shared/durable-json-store.mjs";
import { currentGateArtifactHash, prepareGateForHumanReview } from "../../shared/workflow.mjs";
import { validateEpisode } from "../../shared/schema.mjs";
import { acquireEpisodeOperation } from "../control/episode-operation-lock.mjs";
import { requireSideEffectGrant } from "../security/side-effect-capability.mjs";
import { loadApprovedScriptBinding } from "./approved-script-binding.mjs";
import { localStoryboardCapabilitySpec, validateLocalStoryboardPreview, validateLocalStoryboardRequest }
  from "../../shared/local-storyboard-import-request.mjs";
import { localStoryboardError, readLocalStoryboardJson, validateLocalStoryboardCandidate } from "./local-storyboard-candidate.mjs";
import { compileTimedEditorialContent, inspectTimedEditorialEpisode, TIMED_EDITORIAL_CANDIDATE_KIND,
  TIMED_EDITORIAL_KIND } from "./timed-editorial-content.mjs";
import {requireScreenEditing} from '../../shared/screen-editorial-policy.mjs';

const inputPrefixes = ["outputs/", "studio/data/production/inbox/"];
const productionPrefixes = ["studio/data/production/episodes/"];
const byteLength = value => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);
const readiness = candidate => candidate.kind === TIMED_EDITORIAL_CANDIDATE_KIND
  ? {phase: "timed-editorial", storyboardKind: TIMED_EDITORIAL_KIND,
    timingStatus: "editorial-estimate", executionStatus: "implemented-contract"}
  : {phase: "editorial", storyboardKind: "editorial-cue-plan-v1",
    timingStatus: "unmeasured", executionStatus: "implementation-required"};

export function createLocalStoryboardImportService(dependencies) {
  const { workspaceRoot: root, readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig } = dependencies;
  if (!root || [readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig].some(fn => typeof fn !== "function")) {
    throw new TypeError("Incomplete local storyboard dependencies");
  }

  async function load(raw) {
    const input = validateLocalStoryboardPreview(raw);
    const episode = await readEpisode(input.episodeId);
    if (episode.id !== input.episodeId || !validateEpisode(episode).valid) throw localStoryboardError("local_storyboard_episode_invalid");
    if (episode.control?.activeOperation || episode.control?.stopRequested || episode.pipeline.some(step => step.status === "running")) {
      throw localStoryboardError("local_storyboard_episode_busy");
    }
    if (episode.pipeline.find(step => step.id === "script")?.status !== "complete" ||
      !episode.pipeline.find(step => step.id === "storyboard")) throw localStoryboardError("local_storyboard_script_not_complete");
    const config = await readReviewConfig();
    const binding = await loadApprovedScriptBinding({ workspaceRoot: root, episode, reviewConfig: config });
    const file = await readLocalStoryboardJson(root, input.candidatePath, inputPrefixes);
    validateLocalStoryboardCandidate(file.value, { episodeId: episode.id, script: binding.script, sourceScript: binding.sourceScript });
    return { episode, binding, candidate: file.value, candidateSha256: file.sha256,
      snapshotHash: digest({ episode, reviewConfig: config, candidateSha256: file.sha256 }) };
  }

  async function previewLocalStoryboard(input) {
    const value = await load(input);
    return { episodeId: value.episode.id, candidatePath: input.candidatePath, candidateSha256: value.candidateSha256,
      snapshotHash: value.snapshotHash, title: value.candidate.content.title, shotCount: value.candidate.content.shots.length,
      currentStoryboardVersion: value.episode.production?.storyboardDraft?.version ?? 0, sourceScript: value.binding.sourceScript,
      ...readiness(value.candidate),
      humanApproved: false, paidCalls: 0, estimatedCostUsd: 0 };
  }

  async function audit(episodeId, entry, guard) {
    try {
      guard();
      await appendEvent({ type: "storyboard.local-imported", episodeId, agentId: "storyboard-agent",
        idempotencyKey: `local-storyboard:${episodeId}:${entry.importId}`, actor: entry.importedBy,
        artifactPath: entry.artifactPath, message: `本地编辑分镜 v${entry.version} 已登记；不代表已配音、可渲染或人工批准` });
      return { status: "committed", errorCode: null };
    } catch (error) { return { status: "pending", errorCode: error?.code === "side_effect_capability_expired" ? error.code : "local_storyboard_audit_pending" }; }
  }

  async function verifyRegistered(existing, previous, candidate) {
    if (existing.importId !== previous.importId || digest(existing.content) !== digest(candidate.content)) {
      throw localStoryboardError("local_storyboard_superseded");
    }
    if (Object.keys(previous).some(key => digest(existing[key] ?? null) !== digest(previous[key] ?? null))) {
      throw localStoryboardError("local_storyboard_artifact_changed");
    }
    const artifact = await readLocalStoryboardJson(root, previous.artifactPath, productionPrefixes, 4 * 1024 * 1024);
    const manifest = await readLocalStoryboardJson(root, previous.manifestPath, productionPrefixes, 4 * 1024 * 1024);
    if (artifact.sha256 !== previous.sha256 || artifact.bytes !== previous.bytes || digest(artifact.value) !== digest(candidate.content) ||
      manifest.sha256 !== previous.manifestSha256 || manifest.bytes !== previous.manifestBytes ||
      manifest.value.importId !== previous.importId || manifest.value.artifactPath !== previous.artifactPath ||
      manifest.value.artifactSha256 !== previous.sha256 || digest(manifest.value.candidate) !== digest(candidate)) {
      throw localStoryboardError("local_storyboard_artifact_changed");
    }
  }

  async function importLocalStoryboard(rawRequest, options = {}) {
    const request = validateLocalStoryboardRequest(rawRequest);
    if (!options || typeof options !== "object" || Array.isArray(options) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        return key !== "sideEffectGrant" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value");
      })) throw localStoryboardError("local_storyboard_options_invalid");
    const checkedOptions = Object.freeze({sideEffectGrant: options.sideEffectGrant});
    const guard = () => requireSideEffectGrant(checkedOptions, localStoryboardCapabilitySpec(request), "storyboard:import-local");
    const grant = guard();
    if (grant.maxCalls !== 0 || grant.maxCostUsd !== 0 ||
      digest([...grant.scopes].sort()) !== digest(["filesystem.write", "state.write"])) {
      throw localStoryboardError("local_storyboard_nonzero_authority");
    }
    const release = acquireEpisodeOperation(request.episodeId, "storyboard:import-local");
    try {
      const value = await load({ episodeId: request.episodeId, candidatePath: request.candidatePath });
      if (value.candidateSha256 !== request.candidateSha256) throw localStoryboardError("local_storyboard_candidate_changed");
      const existing = value.episode.production?.storyboardDraft;
      const previous = existing?.versions?.find(entry => entry.candidateSha256 === request.candidateSha256);
      if (previous) {
        await verifyRegistered(existing, previous, value.candidate);
        if (value.candidate.kind === TIMED_EDITORIAL_CANDIDATE_KIND && !inspectTimedEditorialEpisode(value.episode).valid) {
          throw localStoryboardError("local_storyboard_compiled_timeline_changed");
        }
        guard();
        const outcome = await audit(request.episodeId, previous, guard);
        return { status: outcome.status === "pending" ? "committed_with_warning" : "already_committed",
          episodeId: request.episodeId, version: existing.version, artifactPath: existing.artifactPath,
          manifestPath: existing.manifestPath, audit: outcome };
      }
      // Legacy registered artifacts may replay exactly, but never authorize a
      // new unversioned submission. load() already validates any supplied policy.
      const content=value.candidate.content;
      requireScreenEditing(content.screenEditing,
        content.executionPlan?content.executionPlan.sceneGroups.map(scene=>scene.id):content.shots.map(shot=>shot.id),
        {required:true});
      if (value.snapshotHash !== request.snapshotHash) throw localStoryboardError("local_storyboard_snapshot_changed");
      const version = Math.max(existing?.version ?? 0, ...(existing?.versions ?? []).map(entry => entry.version)) + 1;
      const importId = digest(request);
      const directory = `studio/data/production/episodes/${request.episodeId}/local-storyboard/${importId}`;
      const artifactPath = `${directory}/storyboard-v${String(version).padStart(3, "0")}.json`;
      const manifestPath = `${directory}/import.json`;
      const artifactSha256 = jsonDocumentContentSha256(value.candidate.content);
      const previousTimeline = { scenes: value.episode.scenes, subtitles: value.episode.subtitles,
        durationSeconds: value.episode.render?.durationSeconds ?? null };
      const manifest = { schemaVersion: 1, kind: "codex-local-storyboard-import", importId, request, version,
        artifactPath, artifactSha256, candidate: value.candidate, sourceScript: value.binding.sourceScript,
        sourceResearch: value.binding.sourceResearch, previousTimeline };
      guard(); await writeImmutableJsonDocument(resolve(root, artifactPath), value.candidate.content, { storeRoot: root });
      guard(); await writeImmutableJsonDocument(resolve(root, manifestPath), manifest, { storeRoot: root });
      // A crash/CAS conflict may leave immutable unregistered artifacts. Never
      // infer authoritative state from their existence or overwrite them.
      const current = await load({ episodeId: request.episodeId, candidatePath: request.candidatePath });
      if (current.snapshotHash !== request.snapshotHash) throw localStoryboardError("local_storyboard_snapshot_changed");
      const entry = { version, artifactPath, sha256: artifactSha256, bytes: byteLength(value.candidate.content),
        generatedAt: new Date().toISOString(), generationKind: "codex-local-storyboard-import",
        screenEditorialRequired: true,
        ...readiness(value.candidate),
        importId, importedBy: request.actor, candidateSha256: request.candidateSha256,
        sourceScript: structuredClone(value.binding.sourceScript), sourceResearch: structuredClone(value.binding.sourceResearch),
        manifestPath, manifestSha256: jsonDocumentContentSha256(manifest), manifestBytes: byteLength(manifest) };
      const versions = structuredClone(existing?.versions ?? []);
      if (existing && !versions.some(item => item.version === existing.version)) {
        const { versions: ignored, ...legacy } = existing;
        versions.push({ ...structuredClone(legacy), timelineSnapshot: structuredClone(previousTimeline) });
      }
      let next = structuredClone(current.episode);
      if (value.candidate.kind === TIMED_EDITORIAL_CANDIDATE_KIND) {
        const compiled = compileTimedEditorialContent(value.candidate.content);
        next.scenes = compiled.scenes; next.subtitles = compiled.subtitles;
        next.render = {...next.render, durationSeconds: compiled.durationSeconds,
          width: 1920, height: 1080, fps: value.candidate.content.executionPlan.timingPolicy.fps,
          compositionId: "ConceptPreview"};
      } else {
        // Cue-only drafts retain no invented time; the old timeline is archived.
        next.scenes = []; next.subtitles = [];
        next.render = { ...next.render, durationSeconds: null };
      }
      next.production = { ...next.production, storyboardDraft: { ...entry, needsRevision: false,
        content: structuredClone(value.candidate.content), versions: [...versions, entry] } };
      next = prepareGateForHumanReview(next, { gate: "storyboard", now: entry.generatedAt,
        reason: `本地分镜 v${version} 入库，${readiness(value.candidate).timingStatus}；${request.reason}` }).episode;
      const step = next.pipeline.find(item => item.id === "storyboard");
      step.artifacts = [artifactPath, manifestPath]; step.findings = []; step.finishedAt = null; step.progress = 1;
      const validation = validateEpisode(next);
      if (!validation.valid) {
        const error = localStoryboardError("local_storyboard_episode_invalid");
        error.issues = validation.errors;
        throw error;
      }
      guard(); await writeEpisode(next);
      const commit = readEpisodeCommitStatus(request.episodeId);
      const outcome = await audit(request.episodeId, entry, guard);
      return { status: outcome.status === "pending" || commit?.warningCount > 0 || commit?.commitStatus === "committed_with_warnings"
        ? "committed_with_warning" : "committed", episodeId: request.episodeId, version, artifactPath, manifestPath,
      artifactHash: currentGateArtifactHash(next, "storyboard"), humanApproved: false, reviewStatus: "not_started",
      ...readiness(value.candidate), audit: outcome, commit };
    } finally { release(); }
  }
  return Object.freeze({ previewLocalStoryboard, importLocalStoryboard });
}
