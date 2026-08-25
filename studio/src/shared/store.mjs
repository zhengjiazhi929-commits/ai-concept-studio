import { mkdir, readFile, readdir } from "node:fs/promises";
import {
  auditLedgerPath,
  configPath,
  episodeDataDirectory,
  episodeDataPath,
  episodesDataRoot,
  logsRoot
} from "./paths.mjs";
import { validateEpisode } from "./schema.mjs";
import { ensureAgentArchitecture } from "./agent-contracts.mjs";
import { writeVersionedJson } from "./versioned-json-store.mjs";
import { appendAuditEvent, readAuditEvents } from "./audit-log.mjs";

export async function readConfig() {
  return JSON.parse(await readFile(configPath, "utf8"));
}

export async function readEpisode(episodeId) {
  const episode = ensureAgentArchitecture(
    JSON.parse(await readFile(episodeDataPath(episodeId), "utf8"))
  );
  const validation = validateEpisode(episode);
  if (!validation.valid) {
    throw new Error(`Invalid episode ${episodeId}: ${validation.errors.join("; ")}`);
  }
  return episode;
}

export async function writeEpisode(episode) {
  const normalizedEpisode = ensureAgentArchitecture(episode);
  const validation = validateEpisode(normalizedEpisode);
  if (!validation.valid) throw new Error(validation.errors.join("; "));

  const directory = episodeDataDirectory(normalizedEpisode.id);
  await mkdir(directory, { recursive: true });
  const destination = episodeDataPath(normalizedEpisode.id);
  const result = await writeVersionedJson(destination, normalizedEpisode, {
    expectedVersion: normalizedEpisode.control.stateVersion,
    getVersion: (value) => value?.control?.stateVersion ?? 0,
    setVersion: (value, version) => {
      value.control.stateVersion = version;
    }
  });
  if (episode?.control && typeof episode.control === "object") {
    episode.control.stateVersion = result.version;
  }
  return destination;
}

export async function listEpisodes() {
  await mkdir(episodesDataRoot, { recursive: true });
  const entries = await readdir(episodesDataRoot, { withFileTypes: true });
  const episodes = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      episodes.push(await readEpisode(entry.name));
    } catch {
      // A partially written or invalid episode is excluded from the dashboard.
    }
  }
  return episodes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function appendEvent(event) {
  await mkdir(logsRoot, { recursive: true });
  return appendAuditEvent(auditLedgerPath, { at: new Date().toISOString(), ...event });
}

export async function readRecentEvents(limit = 80, options = {}) {
  // The JSON ledger is the only current audit source. Any unreadable,
  // malformed, truncated, or integrity-invalid ledger must stay visible as a
  // hard failure instead of being disguised as an empty/legacy event stream.
  return readAuditEvents(options.auditPath ?? auditLedgerPath, limit);
}
