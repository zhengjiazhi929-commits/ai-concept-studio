import { adaptApprovedStoryboardToShortAssetPlan } from
  "../src/server/production/short-asset-plan-adapter.mjs";

const VERIFIED_AT = "2026-08-14T00:30:00.000Z";

function declarationFor(call) {
  return {
    schemaVersion: 1,
    authorOrSource: `Synthetic test fixture for ${call.providerId}`,
    sourceUrl: `https://example.invalid/test-rights/${encodeURIComponent(call.id)}`,
    license: "synthetic-test-fixture-internal-use-only",
    allowedUse: "Automated repository tests only; no publication or redistribution",
    attributionRequirements: "No attribution required for synthetic test bytes",
    privacyPortraitStatus: "synthetic-no-real-person",
    verifiedBy: "human:test-fixture-rights-reviewer",
    verifiedAt: VERIFIED_AT
  };
}

export function attachSyntheticExternalRights(episode) {
  const preview = adaptApprovedStoryboardToShortAssetPlan(episode);
  const calls = preview.executionPolicy?.externalApiCalls ?? [];
  episode.production.assetPlanDirection = {
    ...episode.production.assetPlanDirection,
    externalRightsDeclarations: Object.fromEntries(
      calls.map((call) => [call.id, declarationFor(call)])
    )
  };
  return episode;
}

export function adaptStoryboardWithSyntheticExternalRights(episode) {
  attachSyntheticExternalRights(episode);
  return adaptApprovedStoryboardToShortAssetPlan(episode);
}
