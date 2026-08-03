import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

export const studioRoot = resolve(currentDirectory, "..", "..");
export const workspaceRoot = resolve(studioRoot, "..");
export const dataRoot = resolve(studioRoot, "data");
export const episodesDataRoot = resolve(dataRoot, "episodes");
export const logsRoot = resolve(dataRoot, "logs");
export const publicRoot = resolve(studioRoot, "public");
export const webRoot = resolve(studioRoot, "src", "web");
export const videoRoot = resolve(studioRoot, "src", "video");
export const studioOutputRoot = resolve(workspaceRoot, "outputs", "studio");
export const configPath = resolve(studioRoot, "config", "studio.json");
export const trendRadarConfigPath = resolve(studioRoot, "config", "trend-radar.json");
export const trendSourcesConfigPath = resolve(studioRoot, "config", "trend-sources.json");
export const conceptTaxonomyPath = resolve(studioRoot, "config", "concept-taxonomy.json");
export const trendsDataRoot = resolve(dataRoot, "trends");
export const trendSnapshotsRoot = resolve(trendsDataRoot, "snapshots");
export const trendRunsRoot = resolve(trendsDataRoot, "runs");
export const trendSignalsPath = resolve(trendsDataRoot, "signals.json");
export const trendLatestRunPath = resolve(trendsDataRoot, "latest.json");
export const trendSelectionPath = resolve(trendsDataRoot, "selection.json");
export const collectorConfigPath = resolve(studioRoot, "config", "collector.json");
export const collectorDataRoot = resolve(dataRoot, "collector");
export const collectorRunsRoot = resolve(collectorDataRoot, "runs");
export const collectorInboxRoot = resolve(collectorDataRoot, "inbox");
export const collectorLatestRunPath = resolve(collectorDataRoot, "latest.json");
export const collectorSourceHealthPath = resolve(collectorDataRoot, "source-health.json");
export const collectorAssistTaskPath = resolve(collectorDataRoot, "assist-task.json");

export function episodeDataDirectory(episodeId) {
  return ensureInside(episodesDataRoot, resolve(episodesDataRoot, episodeId));
}

export function episodeDataPath(episodeId) {
  return resolve(episodeDataDirectory(episodeId), "episode.json");
}

export function episodePublicDirectory(episodeId) {
  return ensureInside(publicRoot, resolve(publicRoot, "episodes", episodeId));
}

export function episodeOutputDirectory(episodeId) {
  return ensureInside(studioOutputRoot, resolve(studioOutputRoot, episodeId));
}

export function ensureInside(root, target) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  if (
    normalizedTarget !== normalizedRoot &&
    !normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
  ) {
    throw new Error(`Path escapes allowed root: ${normalizedTarget}`);
  }
  return normalizedTarget;
}
