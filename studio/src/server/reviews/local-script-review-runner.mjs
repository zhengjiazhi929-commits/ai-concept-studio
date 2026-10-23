// Internal Kernel runner factory. Production dependencies are sealed in orchestrator.
import {randomUUID} from 'node:crypto';
import {canonicalJsonDocumentContentSha256 as digest} from '../../shared/durable-json-store.mjs';
import {ensureAgentArchitecture} from '../../shared/agent-contracts.mjs';
import {validateLocalScriptReviewRequest, localScriptReviewCapabilitySpec, localScriptReviewError} from '../../shared/local-script-review-request.mjs';
import {loadLocalScriptReviewBinding, assertLocalScriptReviewRequestMatches} from './local-script-review-binding.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';
import {acquireEpisodeOperation, claimPersistedEpisodeOperation, releasePersistedEpisodeOperation} from '../control/episode-operation-lock.mjs';

export function createLocalScriptReviewRunner(dependencies) {
  const {workspaceRoot, readEpisode, writeEpisode, appendEvent, readReviewConfig,
    readImplementationFingerprint, reviewCandidateOutput, routeReviewRevision} = dependencies;
  if (typeof workspaceRoot !== 'string' || [readEpisode, writeEpisode, appendEvent, readReviewConfig,
    readImplementationFingerprint, reviewCandidateOutput, routeReviewRevision].some(fn => typeof fn !== 'function')) {
    throw new TypeError('Incomplete local script review runner dependencies');
  }

  return async function runLocalScriptReview(rawRequest, options = {}) {
    const request = validateLocalScriptReviewRequest(rawRequest);
    if (!options || typeof options !== 'object' || ![null, Object.prototype].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some(key => key !== 'sideEffectGrant' || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value'))) {
      throw localScriptReviewError('local_script_review_options_invalid');
    }
    const authorized = Object.freeze({sideEffectGrant: options.sideEffectGrant});
    const guard = () => requireSideEffectGrant(authorized, localScriptReviewCapabilitySpec(request), 'review:script');
    guard();
    const release = acquireEpisodeOperation(request.episodeId, 'review-recheck:script');
    const operationId = `operation:local-script-review:${request.episodeId}:${randomUUID()}`;
    let checking = null;
    let committed = false;
    let source;
    const stateCommits = [];
    const captureCommit = () => {
      const status = dependencies.readEpisodeCommitStatus?.(request.episodeId);
      if (status) stateCommits.push(structuredClone(status));
    };
    const bind = async episode => {
      const [reviewConfig, implementationFingerprint] = await Promise.all([readReviewConfig(), readImplementationFingerprint()]);
      const binding = await loadLocalScriptReviewBinding(episode, {workspaceRoot, reviewConfig, implementationFingerprint});
      assertLocalScriptReviewRequestMatches(request, binding);
      return {binding, reviewConfig};
    };
    try {
      source = await readEpisode(request.episodeId);
      const {binding, reviewConfig} = await bind(source);
      const step = source.pipeline.find(item => item.gate === 'script');
      const output = {status: 'waiting_approval', message: step.message || '讲稿候选等待审批',
        artifacts: [...(step.artifacts ?? [])], findings: [...(step.findings ?? [])],
        requiresApproval: 'script', requiresHuman: false, patch: {}};
      checking = ensureAgentArchitecture(source);
      claimPersistedEpisodeOperation(checking, {id: operationId, kind: 'review-recheck:script'});
      checking.reviews.script = {...checking.reviews.script, status: 'checking', artifactVersion: request.scriptVersion};
      checking.updatedAt = new Date().toISOString();
      guard();
      await writeEpisode(checking);
      captureCommit();
      // Treat the successfully written checking state as the only state we own.
      const checkingHash = digest(checking);
      guard();
      await appendEvent({type: 'review.recheck_started', episodeId: request.episodeId, agentId: step.agent,
        gate: 'script', operationId, requestHash: digest(request), actor: request.actor,
        message: '本地零费用确定性讲稿审核开始'});
      guard();
      const evaluated = await reviewCandidateOutput({sourceEpisode: source, candidateEpisode: checking,
        agentId: step.agent, output}, {config: reviewConfig, expectedReviewProfile: reviewConfig.stages.script.version});
      // Re-read actual evidence and rule/implementation bindings after the await.
      // No callbacks, providers or arbitrary reviewer options enter this path.
      await bind(source);
      const current = await readEpisode(request.episodeId);
      if (digest(current) !== checkingHash) throw localScriptReviewError('local_script_review_conflict');
      let episode = evaluated.episode;
      const index = episode.pipeline.findIndex(item => item.gate === 'script');
      const now = new Date().toISOString();
      episode.pipeline[index] = {...episode.pipeline[index], status: evaluated.output.status,
        message: evaluated.output.message, artifacts: evaluated.output.artifacts ?? [],
        findings: evaluated.output.findings ?? [], requiresApproval: evaluated.output.requiresApproval ?? null,
        requiresHuman: evaluated.output.requiresHuman ?? false, lastRunAt: now, finishedAt: now, lastError: null};
      episode = routeReviewRevision(episode, step.agent, evaluated.review);
      episode.history.push({at: now, type: 'review-recheck', agentId: step.agent, gate: 'script',
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
          gate: 'script', operationId, requestHash: digest(request), actor: request.actor,
          status: evaluated.review.report.decision, reviewReportId: evaluated.review.report.id,
          message: '本地确定性审核结束，人工批准保持独立'});
      } catch (error) {
        // The Episode history/report is durable. Never disguise that as rollback
        // or re-run this stale request merely because the audit append failed.
        audit = {status: 'pending', errorCode: error?.code === 'side_effect_capability_expired'
          ? error.code : 'local_script_review_audit_failed'};
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
            current.reviews.script = structuredClone(source.reviews.script);
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
