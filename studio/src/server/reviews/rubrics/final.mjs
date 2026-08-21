import { evaluateProductionQuality } from "../../production/quality.mjs";
import { fromQualityChecks } from "../checks.mjs";

export function reviewFinalArtifact(episode) {
  return fromQualityChecks(evaluateProductionQuality(episode, { stage: "qa" }).checks);
}
