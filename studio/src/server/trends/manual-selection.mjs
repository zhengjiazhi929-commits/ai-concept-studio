import { readdir } from "node:fs/promises";
import { trendsDataRoot, episodesDataRoot } from "../../shared/paths.mjs";
import { readEpisode, writeEpisode } from "../../shared/store.mjs";
import { createManualSelectionService } from "./manual-selection-core.mjs";

async function listEpisodesStrict(allowMissingEpisodeId) {
  let entries;
  try {entries = await readdir(episodesDataRoot, {withFileTypes: true});}
  catch (error) {if (error.code === "ENOENT") return []; throw error;}
  // Do not silently skip an invalid Episode and then produce a duplicate concept.
  return (await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    try {return await readEpisode(entry.name);} catch (error) {
      // Only an already verified prepared decision may resume its own empty directory.
      if (entry.name === allowMissingEpisodeId && error.code === "ENOENT") return null;
      throw error;
    }
  }))).filter(Boolean);
}

const service = createManualSelectionService({trendsRoot: trendsDataRoot, readEpisode, writeEpisode, listEpisodes: listEpisodesStrict});

export function previewManualTopic(candidateId) {
  if (arguments.length !== 1) throw new TypeError("manual topic preview does not accept production dependency overrides");
  return service.previewManualTopic(candidateId);
}

export function approveManualTopic(request, options = {}) {
  if (!options || typeof options !== "object" || Object.keys(options).some((key) => key !== "sideEffectGrant")) {
    throw new TypeError("manual topic selection accepts only its dedicated grant");
  }
  return service.approveManualTopic(request, options);
}
