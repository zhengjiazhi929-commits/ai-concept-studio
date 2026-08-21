import { evaluateProductionQuality } from "../../production/quality.mjs";
import { fromQualityChecks } from "../checks.mjs";

export function reviewStoryboardArtifact(episode) {
  return fromQualityChecks(evaluateProductionQuality(episode, { stage: "storyboard" }).checks);
}
