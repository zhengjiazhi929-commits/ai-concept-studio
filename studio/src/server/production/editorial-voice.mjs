import {workspaceRoot} from "../../shared/paths.mjs";
import {readEpisode, writeEpisode, readEpisodeCommitStatus, appendEvent} from "../../shared/store.mjs";
import {readReviewConfig} from "../reviews/coordinator.mjs";
import {createEditorialVoiceService} from "./editorial-voice-core.mjs";
import {inspectEditorialVoiceCandidate, materializeEditorialVoiceCandidate, verifyRegisteredEditorialVoice}
  from "./editorial-voice-integrity.mjs";

const service = createEditorialVoiceService({workspaceRoot, readEpisode, writeEpisode, readEpisodeCommitStatus,
  appendEvent, readReviewConfig, inspectCandidate: inspectEditorialVoiceCandidate,
  materializeCandidate: materializeEditorialVoiceCandidate, verifyRegistered: verifyRegisteredEditorialVoice});
export function previewEditorialVoiceRegistration(input) {
  if (arguments.length !== 1) throw new TypeError("Editorial voice preview does not accept overrides");
  return service.previewEditorialVoiceRegistration(input);
}
export function registerEditorialVoice(request, options = {}) {
  if (arguments.length > 2) throw new TypeError("Editorial voice registration does not accept overrides");
  return service.registerEditorialVoice(request, options);
}
