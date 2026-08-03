import { importGoldenSample } from "../src/server/importer.mjs";

const { episode, destination } = await importGoldenSample();
console.log(
  JSON.stringify(
    {
      ok: true,
      episodeId: episode.id,
      scenes: episode.scenes.length,
      assets: episode.assets.length,
      destination
    },
    null,
    2
  )
);
