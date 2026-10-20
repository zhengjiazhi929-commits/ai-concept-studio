import {workspaceRoot} from '../../shared/paths.mjs';
import {readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent} from '../../shared/store.mjs';
import {readReviewConfig} from '../reviews/coordinator.mjs';
import {createApprovedStoryboardCompletionService} from './approved-storyboard-completion-core.mjs';

const service=createApprovedStoryboardCompletionService({workspaceRoot,readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent,readReviewConfig});
export function previewApprovedStoryboardCompletion(input) {
  if(arguments.length!==1) throw new TypeError('Approved storyboard preview does not accept overrides');
  return service.previewApprovedStoryboardCompletion(input);
}
export function completeApprovedStoryboard(request,options={}) {
  if(arguments.length>2) throw new TypeError('Approved storyboard completion does not accept overrides');
  return service.completeApprovedStoryboard(request,options);
}
