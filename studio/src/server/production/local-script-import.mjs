import {workspaceRoot} from '../../shared/paths.mjs';
import {readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent} from '../../shared/store.mjs';
import {readReviewConfig} from '../reviews/coordinator.mjs';
import {createLocalScriptImportService} from './local-script-import-core.mjs';

const service=createLocalScriptImportService({workspaceRoot,readEpisode,writeEpisode,readEpisodeCommitStatus,appendEvent,readReviewConfig});
export function previewLocalScript(input) {
  if(arguments.length!==1) throw new TypeError('Local script preview does not accept overrides');
  return service.previewLocalScript(input);
}
export function importLocalScript(request,options={}) {
  if(arguments.length>2) throw new TypeError('Local script import does not accept overrides');
  return service.importLocalScript(request,options);
}
