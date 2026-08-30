import { resolve } from "node:path";

import { workspaceRoot } from "../src/shared/paths.mjs";
import {
  createLocalOfflineVoiceService
} from "../src/server/production/local-offline-voice-core.mjs";

export function createLocalOfflineVoiceFixtureHarness({
  registration,
  priorReview,
  candidateRoot,
  candidatePaths
}) {
  return createLocalOfflineVoiceService({
    registration,
    priorReview,
    candidateRoot: resolve(workspaceRoot, candidateRoot),
    candidatePaths: {
      manifestPath: resolve(workspaceRoot, candidatePaths.manifestPath),
      wavPath: resolve(workspaceRoot, candidatePaths.wavPath)
    }
  });
}
