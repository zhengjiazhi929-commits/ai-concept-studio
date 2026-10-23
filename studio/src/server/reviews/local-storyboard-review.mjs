import {workspaceRoot} from '../../shared/paths.mjs';
import {readEpisode} from '../../shared/store.mjs';
import {recheckGateReview} from '../orchestrator.mjs';
import {readCurrentEvaluationRuntimeBindings} from '../control/evaluation-suite.mjs';
import {readReviewConfig} from './coordinator.mjs';
import {createLocalStoryboardReviewService} from './local-storyboard-review-core.mjs';

const service = createLocalStoryboardReviewService({workspaceRoot, readEpisode, recheckGateReview, readReviewConfig,
  readImplementationFingerprint: async () => (await readCurrentEvaluationRuntimeBindings()).implementation});

export function previewLocalStoryboardReview(input) {
  if (arguments.length !== 1) throw new TypeError('Local storyboard review preview does not accept overrides');
  return service.previewLocalStoryboardReview(input);
}

export function executeLocalStoryboardReview(request, options = {}) {
  if (arguments.length > 2) throw new TypeError('Local storyboard review does not accept overrides');
  return service.executeLocalStoryboardReview(request, options);
}
