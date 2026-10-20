import { workspaceRoot } from "../../shared/paths.mjs";
import { readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent } from "../../shared/store.mjs";
import { readReviewConfig } from "../reviews/coordinator.mjs";
import { createLocalStoryboardImportService } from "./local-storyboard-import-core.mjs";

const service = createLocalStoryboardImportService({ workspaceRoot, readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent, readReviewConfig });
export function previewLocalStoryboard(input) {
  if (arguments.length !== 1) throw new TypeError("Local storyboard preview does not accept overrides");
  return service.previewLocalStoryboard(input);
}
export function importLocalStoryboard(request, options = {}) {
  if (arguments.length > 2) throw new TypeError("Local storyboard import does not accept overrides");
  return service.importLocalStoryboard(request, options);
}
