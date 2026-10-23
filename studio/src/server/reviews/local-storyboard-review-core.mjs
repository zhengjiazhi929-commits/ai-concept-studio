// Internal factory for synthetic temporary-root tests. Production uses the sealed wrapper.
import {validateLocalStoryboardReviewPreview, validateLocalStoryboardReviewRequest,
  localStoryboardReviewCapabilitySpec, localStoryboardReviewError} from '../../shared/local-storyboard-review-request.mjs';
import {loadLocalStoryboardReviewBinding, assertLocalStoryboardReviewRequestMatches} from './local-storyboard-review-binding.mjs';
import {requireSideEffectGrant} from '../security/side-effect-capability.mjs';

export function createLocalStoryboardReviewService(dependencies) {
  const {workspaceRoot, readEpisode, readReviewConfig, readImplementationFingerprint, recheckGateReview} = dependencies;
  if (!workspaceRoot || [readEpisode, readReviewConfig, readImplementationFingerprint, recheckGateReview]
    .some(fn => typeof fn !== 'function')) throw new TypeError('Incomplete local storyboard review dependencies');

  async function load(rawInput) {
    const input = validateLocalStoryboardReviewPreview(rawInput);
    const episode = await readEpisode(input.episodeId);
    if (episode?.id !== input.episodeId) throw localStoryboardReviewError('local_storyboard_review_episode_invalid');
    const [reviewConfig, implementationFingerprint] = await Promise.all([readReviewConfig(), readImplementationFingerprint()]);
    const binding = await loadLocalStoryboardReviewBinding(episode, {workspaceRoot, reviewConfig, implementationFingerprint});
    return {episode, binding};
  }

  async function previewLocalStoryboardReview(input) {
    const {episode, binding} = await load(input);
    return {...binding, title: episode.production.storyboardDraft.content.title, reviewMode: 'deterministic',
      humanApproved: false, paidCalls: 0, estimatedCostUsd: 0};
  }

  async function executeLocalStoryboardReview(rawRequest, options = {}) {
    const request = Object.freeze(validateLocalStoryboardReviewRequest(rawRequest));
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(options)) ||
      Reflect.ownKeys(options).some(key => {
        const descriptor = Object.getOwnPropertyDescriptor(options, key);
        return key !== 'sideEffectGrant' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
      })) throw localStoryboardReviewError('local_storyboard_review_options_invalid');
    const checked = Object.freeze({sideEffectGrant: options.sideEffectGrant});
    const guard = () => requireSideEffectGrant(checked, localStoryboardReviewCapabilitySpec(request), 'review:storyboard');
    guard();
    const {binding} = await load({episodeId: request.episodeId});
    assertLocalStoryboardReviewRequestMatches(request, binding);
    guard();
    // The Kernel takes the physical lock, rereads the binding, and owns CAS/recovery.
    return recheckGateReview(request.episodeId, 'storyboard', Object.freeze({localStoryboardReviewRequest: request, ...checked}));
  }

  return Object.freeze({previewLocalStoryboardReview, executeLocalStoryboardReview});
}
