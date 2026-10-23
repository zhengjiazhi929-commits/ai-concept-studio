// Internal factory for synthetic temporary-root tests. Production uses the sealed wrapper.
import {validateLocalScriptReviewPreview, validateLocalScriptReviewRequest,
  localScriptReviewCapabilitySpec, localScriptReviewError} from '../../shared/local-script-review-request.mjs';
import {loadLocalScriptReviewBinding, assertLocalScriptReviewRequestMatches} from './local-script-review-binding.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';

export function createLocalScriptReviewService(dependencies) {
  const {workspaceRoot, readEpisode, readReviewConfig, readImplementationFingerprint, recheckGateReview} = dependencies;
  if (!workspaceRoot || [readEpisode, readReviewConfig, readImplementationFingerprint, recheckGateReview]
    .some(fn => typeof fn !== 'function')) throw new TypeError('Incomplete local script review dependencies');

  async function load(rawInput) {
    const input = validateLocalScriptReviewPreview(rawInput);
    const episode = await readEpisode(input.episodeId);
    if (episode?.id !== input.episodeId) throw localScriptReviewError('local_script_review_episode_invalid');
    const [reviewConfig, implementationFingerprint] = await Promise.all([readReviewConfig(), readImplementationFingerprint()]);
    const binding = await loadLocalScriptReviewBinding(episode, {workspaceRoot, reviewConfig, implementationFingerprint});
    return {episode, binding};
  }

  async function previewLocalScriptReview(input) {
    const {episode, binding} = await load(input);
    return {...binding, title: episode.production.scriptDraft.content.title, reviewMode: 'deterministic',
      humanApproved: false, paidCalls: 0, estimatedCostUsd: 0};
  }

  async function executeLocalScriptReview(rawRequest, options = {}) {
    const request = Object.freeze(validateLocalScriptReviewRequest(rawRequest));
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        return key !== 'sideEffectGrant' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
      })) throw localScriptReviewError('local_script_review_options_invalid');
    const checked = Object.freeze({sideEffectGrant: options.sideEffectGrant});
    const guard = () => requireSideEffectGrant(checked, localScriptReviewCapabilitySpec(request), 'review:script');
    guard();
    const {binding} = await load({episodeId: request.episodeId});
    assertLocalScriptReviewRequestMatches(request, binding);
    guard();
    // The Kernel takes the physical lock, rereads the binding, and owns CAS/recovery.
    return recheckGateReview(request.episodeId, 'script', Object.freeze({localScriptReviewRequest: request, ...checked}));
  }

  return Object.freeze({previewLocalScriptReview, executeLocalScriptReview});
}
