import {workspaceRoot} from '../../shared/paths.mjs';
import {readEpisode} from '../../shared/store.mjs';
import {recheckGateReview} from '../orchestrator.mjs';
import {readCurrentEvaluationRuntimeBindings} from '../control/evaluation-suite.mjs';
import {readReviewConfig} from './coordinator.mjs';
import {createLocalScriptReviewService} from './local-script-review-core.mjs';

const service = createLocalScriptReviewService({workspaceRoot, readEpisode, recheckGateReview, readReviewConfig,
  readImplementationFingerprint: async () => (await readCurrentEvaluationRuntimeBindings()).implementation});

export function previewLocalScriptReview(input) {
  if (arguments.length !== 1) throw new TypeError('Local script review preview does not accept overrides');
  return service.previewLocalScriptReview(input);
}

export function executeLocalScriptReview(request, options = {}) {
  if (arguments.length > 2) throw new TypeError('Local script review does not accept overrides');
  return service.executeLocalScriptReview(request, options);
}
