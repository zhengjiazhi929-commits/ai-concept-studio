export const WORKER_MANIFEST_VERSION = "worker-manifests-v1";

export const WORKER_MANIFESTS = Object.freeze({
  "trend-agent": {
    gate: null,
    approvalResetGate: null,
    patchFields: [],
    productionFields: [],
    allowedTools: ["trend.read"],
    maxAttempts: 1
  },
  "research-agent": {
    gate: "research",
    approvalResetGate: "research",
    patchFields: ["research", "approvals", "sourceDocs"],
    productionFields: [],
    allowedTools: ["research.read", "artifact.write"],
    maxAttempts: 2
  },
  "script-agent": {
    gate: "script",
    approvalResetGate: "script",
    patchFields: ["production", "approvals", "routingHistory", "control"],
    productionFields: ["ai", "scriptDraft", "quality"],
    allowedTools: ["artifact.read", "artifact.write"],
    maxAttempts: 2
  },
  "storyboard-agent": {
    gate: "storyboard",
    approvalResetGate: "storyboard",
    patchFields: ["production", "approvals", "routingHistory", "control", "scenes", "subtitles", "render"],
    productionFields: ["ai", "storyboardDraft", "quality"],
    allowedTools: ["artifact.read", "artifact.write"],
    maxAttempts: 2
  },
  "asset-agent": {
    gate: null,
    approvalResetGate: "assets",
    patchFields: ["production", "approvals", "routingHistory", "control", "assets", "scenes", "reviewCheckpoints"],
    productionFields: ["ai", "assetPlan", "assetPlanDirection", "assetBundleRevision"],
    allowedTools: [
      "artifact.read",
      "artifact.write",
      "render.local",
      "aihubmix.images.generate",
      "volcengine.video.generate"
    ],
    maxAttempts: 2
  },
  "voice-agent": {
    gate: "assets",
    approvalResetGate: null,
    patchFields: ["production"],
    productionFields: ["voicePlan", "quality"],
    allowedTools: ["artifact.read", "media.inspect"],
    maxAttempts: 1
  },
  "render-agent": {
    gate: null,
    approvalResetGate: "final",
    patchFields: ["render", "qa", "approvals"],
    productionFields: [],
    allowedTools: ["render.local"],
    maxAttempts: 1
  },
  "qa-agent": {
    gate: "final",
    approvalResetGate: null,
    patchFields: ["qa"],
    productionFields: [],
    allowedTools: ["media.inspect"],
    maxAttempts: 1
  }
});

export function workerManifest(workerId) {
  return WORKER_MANIFESTS[workerId] ?? null;
}
