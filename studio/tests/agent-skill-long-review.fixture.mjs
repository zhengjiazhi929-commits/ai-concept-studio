import { readFile } from "node:fs/promises";

const assetPlanFixtureUrl = new URL(
  "./fixtures/agent-skill-long-review/asset-plan-v001.json",
  import.meta.url
);

const LONG_REVIEW_SCENE_TIMELINE = Object.freeze([
  ["S01", 0, 30],
  ["S02", 30, 64],
  ["S03", 64, 98],
  ["S04", 98, 132],
  ["S05", 132, 166],
  ["S06", 166, 200],
  ["S07", 200, 234],
  ["S08", 234, 268],
  ["S09", 268, 302],
  ["S10", 302, 336],
  ["S11", 336, 370],
  ["S12", 370, 404],
  ["S13", 404, 438],
  ["S14", 438, 472],
  ["S15", 472, 506],
  ["S16", 506, 540],
  ["S17", 540, 574],
  ["S18", 574, 600]
]);
const evidenceSceneIds = new Set([
  "S02", "S04", "S06", "S08", "S10", "S12", "S14", "S16"
]);

const scenes = Object.freeze(LONG_REVIEW_SCENE_TIMELINE.map(
  ([id, start, end]) => Object.freeze({
    id,
    start,
    end,
    type: evidenceSceneIds.has(id) ? "evidence" : "statement"
  })
));

const trackedAssetFiles = Object.freeze([
  Object.freeze({
    path: "test-fixtures/agent-skill-long-review/admin-export.svg",
    bytes: 133,
    sha256: "652a4d872a9c6ad65bb196a02c2fe38b1aa053fbce914caf73b368851c289df4"
  }),
  Object.freeze({
    path: "test-fixtures/agent-skill-long-review/baseline-failed.svg",
    bytes: 133,
    sha256: "4a4eff73d43b3dc9fe0c8b6fac87ed31664a2b89b2c8f5bcdfc1b876c29a3077"
  }),
  Object.freeze({
    path: "test-fixtures/agent-skill-long-review/final-before-export.svg",
    bytes: 133,
    sha256: "606082a7b94d26d8a0073bb77f720f1fa6067856dac46ce24e8381bc3234569d"
  }),
  Object.freeze({
    path: "test-fixtures/agent-skill-long-review/viewer-denied.svg",
    bytes: 133,
    sha256: "001d9e1be27828132961de33ffab159911a879a1acacbbb61fc31467faac2213"
  })
]);

function subtitleTimeline() {
  let start = 0;
  return Array.from({ length: 107 }, (_, index) => {
    const end = index === 106
      ? 600
      : Number((((index + 1) * 600) / 107).toFixed(6));
    const subtitle = Object.freeze({
      start,
      end,
      text: `Immutable long-review fixture subtitle ${String(index + 1).padStart(3, "0")}`
    });
    start = end;
    return subtitle;
  });
}

const episode = Object.freeze({
  id: "agent-skill-20260806",
  scenes,
  subtitles: Object.freeze(subtitleTimeline())
});

export function agentSkillLongReviewEpisodeFixture() {
  return structuredClone(episode);
}

export async function agentSkillLongAssetBindingEpisodeFixture() {
  const fixture = agentSkillLongReviewEpisodeFixture();
  const content = JSON.parse(await readFile(assetPlanFixtureUrl, "utf8"));
  const items = content.items;
  const assets = items.map((item, index) => ({
    id: `fixture-asset-${String(index + 1).padStart(2, "0")}`,
    planItemId: item.id,
    type: "image",
    ...trackedAssetFiles[index % trackedAssetFiles.length]
  }));
  return {
    id: fixture.id,
    approvals: { storyboard: { status: "approved" } },
    production: {
      assetPlan: {
        version: 1,
        artifactPath:
          "studio/tests/fixtures/agent-skill-long-review/asset-plan-v001.json",
        needsRevision: false,
        content
      }
    },
    assets,
    scenes: fixture.scenes
  };
}
