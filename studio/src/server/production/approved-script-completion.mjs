import {workspaceRoot} from '../../shared/paths.mjs';
import {readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent} from '../../shared/store.mjs';
import {readReviewConfig} from '../reviews/coordinator.mjs';
import {createApprovedScriptCompletionService} from './approved-script-completion-core.mjs';

const service=createApprovedScriptCompletionService({workspaceRoot,readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent,readReviewConfig});
export function previewApprovedScriptCompletion(input) {
  if(arguments.length!==1) throw new TypeError('Approved script preview does not accept overrides');
  return service.previewApprovedScriptCompletion(input);
}
export function completeApprovedScript(request,options={}) {
  if(arguments.length>2) throw new TypeError('Approved script completion does not accept overrides');
  return service.completeApprovedScript(request,options);
}
