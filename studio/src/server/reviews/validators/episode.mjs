import { validateEpisode } from "../../../shared/schema.mjs";
import { reviewCheck } from "../checks.mjs";

export function validateEpisodeForReview(episode) {
  const validation = validateEpisode(episode);
  if (validation.valid) {
    return [reviewCheck("episode-contract", "Episode 数据合同", true)];
  }
  return validation.errors.map((error, index) =>
    reviewCheck(`episode-contract-${index + 1}`, "Episode 数据合同", false, {
      actual: error,
      expected: "符合系统 Schema",
      message: error
    })
  );
}
