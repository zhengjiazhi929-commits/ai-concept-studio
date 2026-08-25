import assert from "node:assert/strict";
import test from "node:test";

import {
  GOLDEN_M1_PROFILE_ID,
  productionProfileForEpisode,
  targetDurationForEpisode,
  validateProductionProfile
} from "../src/shared/production-profiles.mjs";

test("golden M1 使用精确 36 秒、六段脚本和六镜分镜规格", () => {
  const productionProfile = {
    id: GOLDEN_M1_PROFILE_ID,
    targetDurationSeconds: 36
  };
  const profile = productionProfileForEpisode({ productionProfile });
  assert.equal(profile.targetDurationSeconds.minimum, 36);
  assert.equal(profile.targetDurationSeconds.maximum, 36);
  assert.deepEqual(profile.scriptSections, { minimum: 6, maximum: 6 });
  assert.deepEqual(profile.storyboardScenes, { minimum: 6, maximum: 6 });
  assert.equal(targetDurationForEpisode({ productionProfile }, 60), 36);
  assert.deepEqual(validateProductionProfile(productionProfile), []);
  assert.match(
    validateProductionProfile({ ...productionProfile, targetDurationSeconds: 60 })[0],
    /must be 36/u
  );
});
