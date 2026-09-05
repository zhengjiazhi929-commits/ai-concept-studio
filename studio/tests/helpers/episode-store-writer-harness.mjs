import {
  createEpisodeWriterCore
} from "../../src/shared/episode-store-writer-core.mjs";

export function createEpisodeWriterHarness(overrides = {}, observerOptions = null) {
  return createEpisodeWriterCore({
    ...overrides,
    resolveCommitObserver: () => observerOptions?.onCommitResult
  });
}
