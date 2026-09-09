import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureAgentArchitecture } from "../src/shared/agent-contracts.mjs";
import { publicRoot } from "../src/shared/paths.mjs";
import { validateEpisode } from "../src/shared/schema.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";

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

// Synthetic cue timing for tests that need the current assets duration gate.
// Preserve the tracked historical Golden fixture and its original 36s timeline.
export async function readPacedFixtureEpisode() {
  const episode = await readFixtureEpisode();
  episode.subtitles = [
    {start: 0, end: 5, text: "Agentic Coding 到底是什么？"},
    {start: 5, end: 7.5, text: "同样是写代码，"},
    {start: 7.5, end: 11, text: "为什么一种方式还没有完成任务？"},
    {start: 11, end: 13, text: "关键变化，"},
    {start: 13, end: 17, text: "是 AI 承担的工作单位变大了。"},
    {start: 17, end: 19, text: "它不仅修改文件，"},
    {start: 19, end: 23, text: "还要验证权限和业务规则。"},
    {start: 23, end: 26.5, text: "测试、状态和最终结果"},
    {start: 26.5, end: 30, text: "共同构成完成证据。"},
    {start: 30, end: 32, text: "从生成代码，"},
    {start: 32, end: 36, text: "到持续推进一个可验证任务。"}
  ];
  // This is a separate synthetic upstream-approved starting state, not a
  // migration of the historical review or evidence of a real human decision.
  const artifactHash = currentGateArtifactHash(episode, "storyboard");
  const reportId = "synthetic-paced-fixture-storyboard-v1";
  episode.approvals.storyboard = {
    ...episode.approvals.storyboard,
    note: "Synthetic test-only storyboard approval for paced subtitle fixture",
    reviewReportId: reportId,
    artifactHash
  };
  episode.reviews.storyboard = {
    ...episode.reviews.storyboard,
    artifactHash,
    rubricVersion: "synthetic-paced-fixture-storyboard-v1",
    latestReportId: reportId,
    reports: [{
      id: reportId,
      stage: "storyboard",
      decision: "pass",
      artifactVersion: 1,
      artifactHash,
      rubricVersion: "synthetic-paced-fixture-storyboard-v1",
      confidence: 1,
      blockingIssues: [],
      warnings: [],
      passedChecks: ["synthetic-test-only-upstream-state"]
    }]
  };
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
