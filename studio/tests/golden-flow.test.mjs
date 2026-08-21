import test from "node:test";
import assert from "node:assert/strict";
import { importGoldenSample } from "../src/server/importer.mjs";
import {
  approveGate,
  exactApprovalBinding,
  runAgent
} from "../src/server/orchestrator.mjs";
import { isSuccessfulQaWorkerStatus } from "../src/server/qa.mjs";
import { resetApprovalForVersion } from "../src/shared/workflow.mjs";

const RENDER_V1_SHA256 = "a".repeat(64);
const RENDER_V2_SHA256 = "b".repeat(64);

function memoryStore(initialEpisode) {
  let stored = structuredClone(initialEpisode);
  const events = [];
  return {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent: async (event) => {
      events.push(structuredClone(event));
    },
    get episode() {
      return structuredClone(stored);
    },
    events
  };
}

function versionedMemoryStore(initialEpisode) {
  let stored = structuredClone(initialEpisode);
  const events = [];
  return {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      // Make overlapping fire-and-forget progress writes deterministic in this
      // test store, while mirroring the real optimistic state-version contract.
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2));
      const expectedVersion = episode.control?.stateVersion ?? 0;
      const actualVersion = stored.control?.stateVersion ?? 0;
      if (expectedVersion !== actualVersion) {
        const error = new Error(
          `Episode 状态版本冲突：期望 ${expectedVersion}，当前 ${actualVersion}`
        );
        error.code = "state_version_conflict";
        throw error;
      }
      const next = structuredClone(episode);
      next.control.stateVersion = actualVersion + 1;
      episode.control.stateVersion = next.control.stateVersion;
      stored = next;
    },
    appendEvent: async (event) => {
      events.push(structuredClone(event));
    },
    get episode() {
      return structuredClone(stored);
    },
    events
  };
}

function workerOutput(status, message, extras = {}) {
  return {
    status,
    message,
    artifacts: [],
    findings: [],
    requiresApproval: null,
    requiresHuman: false,
    ...extras
  };
}

function approvalRequest(episode, gate, note) {
  return { ...exactApprovalBinding(episode, gate), note };
}

test("Golden 离线导入可经过素材与最终闸门完成整期流程", async () => {
  const imported = await importGoldenSample({ persist: false });
  assert.equal(imported.destination, null);
  assert.equal(imported.episode.production.materialsVersion, 1);
  assert.equal(imported.episode.approvals.assets.currentVersion, 1);

  const store = memoryStore(imported.episode);
  const firstVoice = await runAgent("golden-001", "voice-agent", store);
  assert.equal(firstVoice.output.status, "waiting_approval");
  assert.equal(firstVoice.review.report.decision, "pass");
  assert.equal(firstVoice.review.report.artifactVersion, 1);

  await approveGate(
    "golden-001",
    "assets",
    approvalRequest(store.episode, "assets", "离线回归批准素材"),
    store
  );
  assert.equal(store.episode.approvals.assets.status, "approved");
  assert.equal(store.episode.pipeline.find((step) => step.id === "voice").status, "ready");

  const approvedVoice = await runAgent("golden-001", "voice-agent", store);
  assert.equal(approvedVoice.output.status, "complete");
  assert.equal(store.episode.pipeline.find((step) => step.id === "render").status, "ready");

  const rendered = await runAgent("golden-001", "render-agent", {
    ...store,
    agent: {
      run: async (episode) => workerOutput("complete", "离线假渲染完成", {
        artifacts: ["outputs/studio/golden-001/preview-v001.mp4"],
        patch: {
          render: {
            ...episode.render,
            status: "complete",
            progress: 1,
            version: 1,
            outputPath: "outputs/studio/golden-001/preview-v001.mp4",
            bytes: 60_001,
            sha256: RENDER_V1_SHA256
          },
          qa: { status: "pending", reportPath: null, checkedAt: null, checks: [] },
          approvals: {
            final: resetApprovalForVersion(episode.approvals.final, 1)
          }
        }
      })
    }
  });
  assert.equal(rendered.output.status, "complete");
  assert.equal(store.episode.pipeline.find((step) => step.id === "qa").status, "ready");

  const checked = await runAgent("golden-001", "qa-agent", {
    ...store,
    agent: {
      run: async () => workerOutput("waiting_approval", "离线 QA 通过，等待最终审批", {
        requiresApproval: "final",
        artifacts: ["outputs/studio/golden-001/preview-qa-v001.json"],
        patch: {
          qa: {
            status: "passed",
            reportPath: "outputs/studio/golden-001/preview-qa-v001.json",
            checkedAt: "2026-08-06T00:00:00.000Z",
            checks: [
              { id: "render-bytes", passed: true, actual: 60_001, expected: 60_001 },
              {
                id: "render-sha256",
                passed: true,
                actual: RENDER_V1_SHA256,
                expected: RENDER_V1_SHA256
              }
            ]
          }
        }
      })
    }
  });
  assert.equal(checked.output.status, "waiting_approval");
  assert.equal(checked.review.report.decision, "pass");
  assert.equal(isSuccessfulQaWorkerStatus(checked.output.status), true);

  const rerendered = await runAgent("golden-001", "render-agent", {
    ...store,
    agent: {
      run: async (episode) => workerOutput("complete", "离线修订版渲染完成", {
        artifacts: ["outputs/studio/golden-001/preview-v002.mp4"],
        patch: {
          render: {
            ...episode.render,
            status: "complete",
            progress: 1,
            version: 2,
            outputPath: "outputs/studio/golden-001/preview-v002.mp4",
            bytes: 60_002,
            sha256: RENDER_V2_SHA256
          },
          qa: { status: "pending", reportPath: null, checkedAt: null, checks: [] },
          approvals: {
            final: resetApprovalForVersion(episode.approvals.final, 2)
          }
        }
      })
    }
  });
  const qaAfterRerender = store.episode.pipeline.find((step) => step.id === "qa");
  assert.equal(rerendered.output.status, "complete");
  assert.equal(qaAfterRerender.status, "ready");
  assert.deepEqual(qaAfterRerender.artifacts, []);
  assert.deepEqual(qaAfterRerender.findings, []);
  assert.equal(store.episode.qa.quality, null);
  assert.equal(store.episode.approvals.final.currentVersion, 2);
  assert.equal(store.episode.reviews.final.status, "not_started");

  const rechecked = await runAgent("golden-001", "qa-agent", {
    ...store,
    agent: {
      run: async () => workerOutput("waiting_approval", "离线 v2 QA 通过，等待最终审批", {
        requiresApproval: "final",
        artifacts: ["outputs/studio/golden-001/preview-qa-v002.json"],
        patch: {
          qa: {
            status: "passed",
            reportPath: "outputs/studio/golden-001/preview-qa-v002.json",
            checkedAt: "2026-08-06T00:01:00.000Z",
            checks: [
              { id: "render-bytes", passed: true, actual: 60_002, expected: 60_002 },
              {
                id: "render-sha256",
                passed: true,
                actual: RENDER_V2_SHA256,
                expected: RENDER_V2_SHA256
              }
            ]
          }
        }
      })
    }
  });
  assert.equal(rechecked.review.report.artifactVersion, 2);

  await assert.rejects(
    approveGate("golden-001", "final", approvalRequest(
      store.episode,
      "final",
      "不应批准被替换的成片"
    ), {
      ...store,
      inspectFileIntegrity: async () => ({ bytes: 60_002, sha256: "c".repeat(64) })
    }),
    (error) => error.code === "render_integrity_mismatch"
  );
  assert.equal(store.episode.approvals.final.status, "pending");

  await approveGate("golden-001", "final", approvalRequest(
    store.episode,
    "final",
    "离线回归批准成片"
  ), {
    ...store,
    inspectFileIntegrity: async () => ({ bytes: 60_002, sha256: RENDER_V2_SHA256 })
  });
  assert.equal(store.episode.status, "approved");
  assert.equal(store.episode.approvals.final.status, "approved");
  assert.deepEqual(
    store.episode.pipeline.map((step) => step.status),
    Array(store.episode.pipeline.length).fill("complete")
  );
  assert.equal(store.events.some((event) => event.type === "approval.granted"), true);
});

test("QA 命令将等待最终审批视为成功，但不会把失败误报为成功", () => {
  assert.equal(isSuccessfulQaWorkerStatus("waiting_approval"), true);
  assert.equal(isSuccessfulQaWorkerStatus("complete"), true);
  assert.equal(isSuccessfulQaWorkerStatus("failed"), false);
  assert.equal(isSuccessfulQaWorkerStatus("blocked"), false);
});

test("编排器串行落账未等待的进度回调，避免与 Worker 最终状态发生版本竞争", async () => {
  const imported = await importGoldenSample({ persist: false });
  const store = versionedMemoryStore(imported.episode);
  await runAgent("golden-001", "voice-agent", store);
  await approveGate(
    "golden-001",
    "assets",
    approvalRequest(store.episode, "assets", "离线回归批准素材"),
    store
  );
  await runAgent("golden-001", "voice-agent", store);

  const result = await runAgent("golden-001", "render-agent", {
    ...store,
    agent: {
      async run(episode, context) {
        void context.onProgress(0.25, "渲染 25%");
        void context.onProgress(0.5, "渲染 50%");
        void context.onProgress(1, "渲染 100%");
        return workerOutput("complete", "离线假渲染完成", {
          artifacts: ["outputs/studio/golden-001/preview-v001.mp4"],
          patch: {
            render: {
              ...episode.render,
              status: "complete",
              progress: 1,
              version: 1,
              outputPath: "outputs/studio/golden-001/preview-v001.mp4"
            },
            qa: { status: "pending", reportPath: null, checkedAt: null, checks: [] },
            approvals: {
              final: resetApprovalForVersion(episode.approvals.final, 1)
            }
          }
        });
      }
    }
  });

  assert.equal(result.output.status, "complete");
  assert.equal(store.episode.render.status, "complete");
  assert.equal(store.episode.pipeline.find((step) => step.id === "render").status, "complete");
  assert.equal(store.episode.pipeline.find((step) => step.id === "qa").status, "ready");
  assert.equal(store.episode.control.activeOperation, null);
});
