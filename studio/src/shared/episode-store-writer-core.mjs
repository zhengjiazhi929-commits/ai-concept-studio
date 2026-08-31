// Internal implementation. Production callers must use episode-store-writer.mjs.
import { mkdir } from "node:fs/promises";
import { episodeDataDirectory, episodeDataPath } from "./paths.mjs";
import { validateEpisode } from "./schema.mjs";
import { ensureAgentArchitecture } from "./agent-contracts.mjs";
import { redactSensitiveText, safeErrorMessage } from "./redaction.mjs";
import { writeVersionedJson } from "./versioned-json-store.mjs";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableClone(value) {
  return deepFreeze(structuredClone(value));
}

function observedErrorMessage(error, fallback) {
  try {
    return safeErrorMessage(error, fallback);
  } catch {
    return fallback;
  }
}

function normalizedCommitWarning(warning) {
  return {
    stage: redactSensitiveText(warning?.stage ?? "unknown", 80),
    code: redactSensitiveText(warning?.code ?? "state_commit_warning", 120),
    message: redactSensitiveText(warning?.message ?? "Episode commit warning", 240)
  };
}

function commitSnapshot(episodeId, result, observedAt) {
  const commitWarnings = Array.isArray(result?.commitWarnings)
    ? result.commitWarnings.map(normalizedCommitWarning)
    : [];
  return immutableClone({
    schemaVersion: 1,
    episodeId,
    stateVersion: result.version,
    commitStatus: result.commitStatus ?? (
      commitWarnings.length > 0 ? "committed_with_warnings" : "committed"
    ),
    warningCount: commitWarnings.length,
    commitWarnings,
    observedAt
  });
}

/**
 * Internal service factory. Dependency and observer injection are intentionally
 * available only to the test harness; production imports the sealed wrapper.
 */
export function createEpisodeWriterCore(overrides = {}) {
  const makeDirectory = overrides.mkdir ?? mkdir;
  const directoryForEpisode = overrides.episodeDataDirectory ?? episodeDataDirectory;
  const pathForEpisode = overrides.episodeDataPath ?? episodeDataPath;
  const writeVersioned = overrides.writeVersionedJson ?? writeVersionedJson;
  const now = overrides.now ?? (() => new Date().toISOString());
  const resolveCommitObserver = overrides.resolveCommitObserver;
  const latestCommitByEpisodeId = new Map();

  function rememberCommit(snapshot) {
    const current = latestCommitByEpisodeId.get(snapshot.episodeId);
    if (current && current.stateVersion > snapshot.stateVersion) return current;
    latestCommitByEpisodeId.set(snapshot.episodeId, snapshot);
    return snapshot;
  }

  function readEpisodeCommitStatus(episodeId) {
    const snapshot = latestCommitByEpisodeId.get(episodeId);
    return snapshot ? immutableClone(snapshot) : null;
  }

  async function writeEpisode(episode) {
    const normalizedEpisode = ensureAgentArchitecture(episode);
    const validation = validateEpisode(normalizedEpisode);
    if (!validation.valid) throw new Error(validation.errors.join("; "));

    const directory = directoryForEpisode(normalizedEpisode.id);
    await makeDirectory(directory, { recursive: true });
    const destination = pathForEpisode(normalizedEpisode.id);
    const result = await writeVersioned(destination, normalizedEpisode, {
      expectedVersion: normalizedEpisode.control.stateVersion,
      getVersion: (value) => value?.control?.stateVersion ?? 0,
      setVersion: (value, version) => {
        value.control.stateVersion = version;
      }
    });
    let propagation = null;
    try {
      if (episode?.control && typeof episode.control === "object") {
        episode.control.stateVersion = result.version;
      }
    } catch (error) {
      propagation = {
        status: "failed",
        warnings: [{
          code: "episode_state_version_update_failed",
          message: observedErrorMessage(
            error,
            "Caller Episode state version update failed"
          )
        }]
      };
    }

    const baseSnapshot = commitSnapshot(normalizedEpisode.id, result, now());
    const snapshot = propagation
      ? immutableClone({ ...baseSnapshot, propagation })
      : baseSnapshot;
    rememberCommit(snapshot);
    try {
      const observer = typeof resolveCommitObserver === "function"
        ? resolveCommitObserver()
        : null;
      if (typeof observer === "function") {
        await observer(immutableClone(snapshot));
      }
    } catch (error) {
      rememberCommit(immutableClone({
        ...snapshot,
        observer: {
          status: "failed",
          warnings: [{
            code: "episode_commit_observer_failed",
            message: observedErrorMessage(error, "Episode commit observer failed")
          }]
        }
      }));
    }

    return destination;
  }

  return Object.freeze({ writeEpisode, readEpisodeCommitStatus });
}
