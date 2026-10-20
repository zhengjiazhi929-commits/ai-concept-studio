import {workspaceRoot} from "../../shared/paths.mjs";
import {readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent} from "../../shared/store.mjs";
import {readReviewConfig} from "../reviews/coordinator.mjs";
import {createEditorialAssetsMaterializeService} from "./editorial-assets-materialize-core.mjs";
import {buildEditorialMaterializationBundle} from "./editorial-materialization-bundle.mjs";
import {verifyEditorialMaterializationBundle} from "./editorial-materialization-integrity.mjs";

const service = createEditorialAssetsMaterializeService({workspaceRoot, readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig,
  buildBundle: buildEditorialMaterializationBundle, verifyBundle: verifyEditorialMaterializationBundle});
export function previewEditorialAssetsMaterialization(input) {
  if (arguments.length !== 1) throw new TypeError("Editorial materialization preview does not accept overrides");
  return service.previewEditorialAssetsMaterialization(input);
}
export function materializeEditorialAssets(request, options = {}) {
  if (arguments.length > 2) throw new TypeError("Editorial materialization does not accept overrides");
  return service.materializeEditorialAssets(request, options);
}
