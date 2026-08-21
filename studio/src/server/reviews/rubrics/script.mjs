import { evaluateProductionQuality } from "../../production/quality.mjs";
import { fromQualityChecks } from "../checks.mjs";

export function reviewScriptArtifact(episode) {
  return fromQualityChecks(evaluateProductionQuality(episode, { stage: "script" }).checks);
}
