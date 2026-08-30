import test from "node:test";
import assert from "node:assert/strict";
import {
  approveGate,
  exactApprovalBinding,
  runAgent
} from "../src/server/orchestrator.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";
import { assertCurrentAssetBundleIntegrity } from
  "../src/server/production/asset-bundle-integrity.mjs";
import {
  fixtureAssetFileDependencies,
  readFixtureEpisode
} from "./episode-fixture.mjs";

function approvalReadyEpisode(source) {
  const episode = structuredClone(source);
  episode.control.reviewEnabled = false;
  const step = episode.pipeline.find((item) => item.agent === "voice-agent");
  step.status = "waiting_approval";
  step.requiresApproval = "assets";
  episode.approvals.assets.status = "pending";
  episode.reviews.assets.latestReportId = "review-assets-byte-binding-v1";
  return episode;
}

test("素材人工批准在当前字节与登记哈希不一致时零状态写入", async () => {
  const source = approvalReadyEpisode(await readFixtureEpisode());
  const fixtureFiles = fixtureAssetFileDependencies(source);
  let writes = 0;
  const changedAssetPath = source.assets[0].path;
  await assert.rejects(
    approveGate(source.id, "assets", {
      ...exactApprovalBinding(source, "assets"),
      note: "不得批准变化后的素材"
    }, {
      readEpisode: async () => structuredClone(source),
      writeEpisode: async () => {
        writes += 1;
      },
      appendEvent: async () => {},
      inspectFileIntegrity: async (path) => {
        const actual = await fixtureFiles.inspectFileIntegrity(path);
        return String(path).endsWith(changedAssetPath)
          ? { ...actual, sha256: "f".repeat(64) }
          : actual;
      }
    }),
    (error) => error.code === "asset_bundle_integrity_mismatch" &&
      error.statusCode === 409
  );
  assert.equal(writes, 0);
});

test("素材批准记录绑定实际字节摘要，渲染前再次发现漂移会在 Worker 启动前关闭", async () => {
  let stored = approvalReadyEpisode(await readFixtureEpisode());
  const fixtureFiles = fixtureAssetFileDependencies(stored);
  const store = {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (next) => {
      stored = structuredClone(next);
    },
    appendEvent: async () => {}
  };
  await approveGate(stored.id, "assets", {
    ...exactApprovalBinding(stored, "assets"),
    note: "批准与当前字节完全一致的素材"
  }, { ...store, inspectFileIntegrity: fixtureFiles.inspectFileIntegrity });
  assert.equal(stored.approvals.assets.status, "approved");
  assert.equal(
    stored.approvals.assets.integrityBinding.artifactHash,
    currentGateArtifactHash(stored, "assets")
  );
  assert.equal(stored.approvals.assets.integrityBinding.assets.length, stored.assets.length);

  const renderStep = stored.pipeline.find((item) => item.agent === "render-agent");
  renderStep.status = "ready";
  let writes = 0;
  let workerRuns = 0;
  await assert.rejects(
    runAgent(stored.id, "render-agent", {
      readEpisode: async () => structuredClone(stored),
      writeEpisode: async () => {
        writes += 1;
      },
      appendEvent: async () => {},
      inspectFileIntegrity: async (path) => {
        const actual = await fixtureFiles.inspectFileIntegrity(path);
        return { ...actual, bytes: actual.bytes + 1 };
      },
      agent: {
        async run() {
          workerRuns += 1;
          throw new Error("不应启动渲染");
        }
      }
    }),
    (error) => error.code === "asset_bundle_integrity_mismatch"
  );
  assert.equal(writes, 0);
  assert.equal(workerRuns, 0);
});

test("visual-proof Episode 一旦登记 ready 旁白也必须复核真实字节", async () => {
  const source = await readFixtureEpisode();
  const fixtureFiles = fixtureAssetFileDependencies(source);
  source.previewMode = "visual-proof";
  source.voice = {
    ...source.voice,
    status: "ready",
    audioPath: "outputs/studio/golden-001/voice.wav",
    version: 1,
    bytes: 10,
    sha256: "a".repeat(64)
  };

  await assert.rejects(
    assertCurrentAssetBundleIntegrity(source, {
      inspectFileIntegrity: async (path) => (
        String(path).endsWith("voice.wav")
          ? { bytes: 10, sha256: "b".repeat(64) }
          : fixtureFiles.inspectFileIntegrity(path)
      )
    }),
    (error) => error.code === "asset_bundle_integrity_mismatch"
  );
});
