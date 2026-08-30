import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureAgentArchitecture } from "../src/shared/agent-contracts.mjs";
import { publicRoot } from "../src/shared/paths.mjs";
import { validateEpisode } from "../src/shared/schema.mjs";

const fixtures = Object.freeze({
  "golden-001": new URL("./fixtures/episodes/golden-001.json", import.meta.url)
});

export async function readFixtureEpisode(episodeId = "golden-001") {
  const fixtureUrl = fixtures[episodeId];
  if (!fixtureUrl) throw new Error(`Unknown episode fixture: ${episodeId}`);

  const episode = ensureAgentArchitecture(
    JSON.parse(await readFile(fixtureUrl, "utf8"))
  );
  const validation = validateEpisode(episode);
  if (!validation.valid) {
    throw new Error(
      `Invalid episode fixture ${episodeId}: ${validation.errors.join("; ")}`
    );
  }
  return episode;
}

function fixtureFileError(path) {
  const error = new Error(`Unregistered fixture asset file: ${path}`);
  error.code = "ENOENT";
  return error;
}

export function fixtureAssetFileDependencies(episode, options = {}) {
  const root = options.publicRoot ?? publicRoot;
  const records = new Map((episode.assets ?? []).map((asset) => [
    resolve(root, asset.path),
    { bytes: asset.bytes, sha256: asset.sha256 }
  ]));
  const recordFor = (path) => {
    const record = records.get(resolve(path));
    if (!record) throw fixtureFileError(path);
    return record;
  };
  return Object.freeze({
    access: async (path) => {
      recordFor(path);
    },
    inspectFileIntegrity: async (path) => structuredClone(recordFor(path))
  });
}
