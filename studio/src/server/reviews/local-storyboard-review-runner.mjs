// Internal Kernel runner factory. Production dependencies are sealed in orchestrator.
import {randomUUID} from 'node:crypto';
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {ensureAgentArchitecture} from '../../shared/agent-contracts.mjs';
import {validateLocalStoryboardReviewRequest, localStoryboardReviewCapabilitySpec, localStoryboardReviewError} from '../../shared/local-storyboard-review-request.mjs';
import {loadLocalStoryboardReviewBinding, assertLocalStoryboardReviewRequestMatches} from './local-storyboard-review-binding.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';
import {acquireEpisodeOperation, claimPersistedEpisodeOperation, releasePersistedEpisodeOperation} from '../control/episode-operation-lock.mjs';

export function createLocalStoryboardReviewRunner(dependencies) {
  const {workspaceRoot, readEpisode, writeEpisode, appendEvent, readReviewConfig,
    readImplementationFingerprint, reviewCandidateOutput, routeReviewRevision} = dependencies;
  if (typeof workspaceRoot !== 'string' || [readEpisode, writeEpisode, appendEvent, readReviewConfig,
    readImplementationFingerprint, reviewCandidateOutput, routeReviewRevision].some(fn => typeof fn !== 'function')) {
    throw new TypeError('Incomplete local storyboard review runner dependencies');
  }

  return async function runLocalStoryboardReview(rawRequest, options = {}) {
    const request = validateLocalStoryboardReviewRequest(rawRequest);
    if (!options || typeof options !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        return key !== 'sideEffectGrant' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
      })) {
      throw localStoryboardReviewError('local_storyboard_review_options_invalid');
    }
    const authorized = Object.freeze({sideEffectGrant: options.sideEffectGrant});
    const guard = () => requireSideEffectGrant(authorized, localStoryboardReviewCapabilitySpec(request), 'review:storyboard');
    guard();
    const release = acquireEpisodeOperation(request.episodeId, 'review-recheck:storyboard');
    const operationId = `operation:local-storyboard-review:${request.episodeId}:${randomUUID()}`;
    let checking = null;
    let committed = false;
    let source;
    const stateCommits = [];
    const captureCommit = () => {
      try {
        const status = dependencies.readEpisodeCommitStatus?.(request.episodeId);
        if (status) stateCommits.push(structuredClone(status));
      } catch {
        // The write already resolved. A metadata observer cannot turn a durable
        // result into an apparent rollback or invite replay of the old request.
        stateCommits.push({commitStatus: 'committed_with_warnings', warningCount: 1,
          inspection: {status: 'unavailable', errorCode: 'local_storyboard_review_commit_status_failed'}});
      }
    };
    const bind = async episode => {
      const [reviewConfig, implementationFingerprint] = await Promise.all([readReviewConfig(), readImplementationFingerprint()]);
      const binding = await loadLocalStoryboardReviewBinding(episode, {workspaceRoot, reviewConfig, implementationFingerprint});
      assertLocalStoryboardReviewRequestMatches(request, binding);
      return {binding, reviewConfig};
    };
    try {
      source = await readEpisode(request.episodeId);
      const {binding, reviewConfig} = await bind(source);
      const step = source.pipeline.find(item => item.gate === 'storyboard');
      const output = {status: 'waiting_approval', message: step.message || '分镜候选等待审批',
        artifacts: [...(step.artifacts ?? [])], findings: [...(step.findings ?? [])],
        requiresApproval: 'storyboard', requiresHuman: false, patch: {}};
      checking = ensureAgentArchitecture(source);
      claimPersistedEpisodeOperation(checking, {id: operationId, kind: 'review-recheck:storyboard'});
      checking.reviews.storyboard = {...checking.reviews.storyboard, status: 'checking', artifactVersion: request.storyboardVersion};
      checking.updatedAt = new Date().toISOString();
      guard();
      await writeEpisode(checking);
      captureCommit();
      // Treat the successfully written checking state as the only state we own.
      const checkingHash = digest(checking);
      guard();
      await appendEvent({type: 'review.recheck_started', episodeId: request.episodeId, agentId: step.agent,
        gate: 'storyboard', operationId, requestHash: digest(request), actor: request.actor,
        message: '本地零费用确定性分镜审核开始'});
      guard();
      const evaluated = await reviewCandidateOutput({sourceEpisode: source, candidateEpisode: checking,
        agentId: step.agent, output}, {config: reviewConfig, expectedReviewProfile: reviewConfig.stages.storyboard.version});
      // Re-read actual evidence and rule/implementation bindings after the await.
      // No callbacks, providers or arbitrary reviewer options enter this path.
      await bind(source);
      const current = await readEpisode(request.episodeId);
      if (digest(current) !== checkingHash) throw localStoryboardReviewError('local_storyboard_review_conflict');
      let episode = evaluated.episode;
      const index = episode.pipeline.findIndex(item => item.gate === 'storyboard');
      const now = new Date().toISOString();
      episode.pipeline[index] = {...episode.pipeline[index], status: evaluated.output.status,
        message: evaluated.output.message, artifacts: evaluated.output.artifacts ?? [],
        findings: evaluated.output.findings ?? [], requiresApproval: evaluated.output.requiresApproval ?? null,
        requiresHuman: evaluated.output.requiresHuman ?? false, lastRunAt: now, finishedAt: now, lastError: null};
      episode = routeReviewRevision(episode, step.agent, evaluated.review);
      episode.history.push({at: now, type: 'review-recheck', agentId: step.agent, gate: 'storyboard',
        status: evaluated.review.report.decision, message: evaluated.output.message,
        reviewReportId: evaluated.review.report.id, operationId, actor: request.actor, reason: request.reason,
        requestHash: digest(request), snapshotHash: request.snapshotHash,
        implementationFingerprint: binding.implementationFingerprint});
      releasePersistedEpisodeOperation(episode, operationId);
      episode.updatedAt = now;
      guard();
      await writeEpisode(episode);
      committed = true;
      captureCommit();
      let audit = {status: 'committed'};
      try {
        guard();
        await appendEvent({type: 'review.recheck_completed', episodeId: request.episodeId, agentId: step.agent,
          gate: 'storyboard', operationId, requestHash: digest(request), actor: request.actor,
          status: evaluated.review.report.decision, reviewReportId: evaluated.review.report.id,
          message: '本地确定性审核结束，人工批准保持独立'});
      } catch (error) {
        // The Episode history/report is durable. Never disguise that as rollback
        // or re-run this stale request merely because the audit append failed.
        audit = {status: 'pending', errorCode: error?.code === 'side_effect_capability_expired'
          ? error.code : 'local_storyboard_review_audit_failed'};
      }
      const stateWarning = stateCommits.some(value => value.warningCount > 0 ||
        value.commitStatus === 'committed_with_warnings' || value.observer?.status === 'failed' || value.propagation?.status === 'failed');
      return {...evaluated, episode, commitStatus: audit.status === 'committed' && !stateWarning
        ? 'committed' : 'committed_with_warning', audit, stateCommits};
    } catch (error) {
      if (!committed && checking) {
        try {
          guard();
          const current = await readEpisode(request.episodeId);
          // Only unwind our own unchanged checkpoint. A concurrent stop, approval
          // or new operation must never be overwritten during error recovery.
          if (current.control?.activeOperation?.id === operationId && digest(current) === digest(checking)) {
            current.reviews.storyboard = structuredClone(source.reviews.storyboard);
            releasePersistedEpisodeOperation(current, operationId);
            current.updatedAt = new Date().toISOString();
            guard();
            await writeEpisode(current);
          }
        } catch {
          // Expiry/CAS failure leaves an explicit persisted operation for normal
          // Kernel recovery; it does not authorize a fresh write or auto-retry.
        }
      }
      throw error;
    } finally {
      release();
    }
  };
}
