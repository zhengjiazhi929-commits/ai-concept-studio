import { createEpisodeWriterCore } from "./episode-store-writer-core.mjs";

function hasProperty(value, property) {
  return Boolean(
    value != null &&
    (typeof value === "object" || typeof value === "function") &&
    Reflect.has(value, property)
  );
}

function assertNoCommitObserverInjection(options) {
  if (hasProperty(options, "onCommitResult")) {
    throw new TypeError(
      "production Episode write does not accept commit observer injection"
    );
  }
}

/**
 * Creates an Episode writer with process-local commit observability.
 *
 * The latest outcome map is deliberately not persisted into episode.json: a
 * post-rename warning must not trigger a second state write that could fail or
 * make a successfully committed version look rolled back. The version guard
 * also prevents a slower, older completion from replacing a newer outcome.
 */
export function createEpisodeWriter() {
  if (arguments.length !== 0) {
    throw new TypeError(
      "production Episode writer does not accept dependency injection"
    );
  }
  const writer = createEpisodeWriterCore();

  return Object.freeze({
    async writeEpisode(episode, options) {
      // This guard intentionally precedes validation, path resolution and all I/O.
      assertNoCommitObserverInjection(options);
      return writer.writeEpisode(episode);
    },
    readEpisodeCommitStatus(episodeId) {
      return writer.readEpisodeCommitStatus(episodeId);
    }
  });
}
