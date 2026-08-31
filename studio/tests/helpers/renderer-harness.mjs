import {
  bundleVideoProjectForRenderCore,
  createRendererService,
  createVideoBundleSnapshotCore
} from "../../src/server/renderer-core.mjs";
import {
  finalizeDeterministicLayoutSampleSet,
  nextRenderFileName,
  prepareDeterministicLayoutSamples
} from "../../src/server/renderer.mjs";

export function createRendererHarness(dependencies) {
  return createRendererService({
    dependencies,
    nextRenderFileName,
    prepareDeterministicLayoutSamples,
    finalizeDeterministicLayoutSampleSet
  });
}

export function bundleVideoProjectForRenderHarness(options, dependencies) {
  return bundleVideoProjectForRenderCore(options, dependencies);
}

export function createVideoBundleSnapshotHarness(options, dependencies) {
  return createVideoBundleSnapshotCore(options, dependencies);
}
