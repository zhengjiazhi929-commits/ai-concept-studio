import {workspaceRoot} from '../../shared/paths.mjs';
import {readEpisode} from '../../shared/store.mjs';
import {runAgent} from '../orchestrator.mjs';
import {readReviewConfig} from '../reviews/coordinator.mjs';
import {readResearchConfig} from './store.mjs';
import {importResearchEvidenceBatch} from './agent.mjs';
import {createLocalResearchService} from './local-research-core.mjs';

const service=createLocalResearchService({workspaceRoot,readEpisode,runAgent,readReviewConfig,readResearchConfig,importResearchEvidenceBatch});
export function previewLocalResearch(input) {
  if(arguments.length!==1) throw new TypeError('Local research preview does not accept overrides');
  return service.previewLocalResearch(input);
}
export function executeLocalResearch(request,options={}) {
  if(arguments.length>2) throw new TypeError('Local research does not accept overrides');
  return service.executeLocalResearch(request,options);
}
