import { reviewResearchArtifact } from "./research.mjs";
import { reviewScriptArtifact } from "./script.mjs";
import { reviewStoryboardArtifact } from "./storyboard.mjs";
import { reviewAssetsArtifact } from "./assets.mjs";
import { reviewFinalArtifact } from "./final.mjs";

const reviewers = {
  research: reviewResearchArtifact,
  script: reviewScriptArtifact,
  storyboard: reviewStoryboardArtifact,
  assets: reviewAssetsArtifact,
  final: reviewFinalArtifact
};

export function runStageRubric(stage, episode) {
  const reviewer = reviewers[stage];
  if (!reviewer) throw new Error(`没有审核规则：${stage}`);
  return reviewer(episode);
}
