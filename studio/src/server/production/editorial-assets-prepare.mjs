import {workspaceRoot} from "../../shared/paths.mjs";
import {readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent} from "../../shared/store.mjs";
import {readReviewConfig} from "../reviews/coordinator.mjs";
import {createEditorialAssetsPrepareService} from "./editorial-assets-prepare-core.mjs";

const service = createEditorialAssetsPrepareService({workspaceRoot, readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig});
export function previewEditorialAssetsPreparation(input) {
  if (arguments.length !== 1) throw new TypeError("Editorial assets preview does not accept overrides");
  return service.previewEditorialAssetsPreparation(input);
}
export function prepareEditorialAssets(request, options = {}) {
  if (arguments.length > 2) throw new TypeError("Editorial assets preparation does not accept overrides");
  return service.prepareEditorialAssets(request, options);
}
