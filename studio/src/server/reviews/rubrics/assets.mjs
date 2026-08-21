import { evaluateProductionQuality } from "../../production/quality.mjs";
import { fromQualityChecks } from "../checks.mjs";

export function reviewAssetsArtifact(episode) {
  return fromQualityChecks(evaluateProductionQuality(episode, { stage: "voice" }).checks);
}
