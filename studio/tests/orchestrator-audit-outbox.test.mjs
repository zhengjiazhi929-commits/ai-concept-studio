import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  recoverInterruptedRuns,
  replayPendingWorkerAuditEvents,
  runAgent
} from "../src/server/orchestrator.mjs";
import { getAgent } from "../src/server/agents/registry.mjs";
import { deliverWorkerAuditOutbox, enqueueWorkerAuditEvents } from
  "../src/server/control/worker-audit-outbox.mjs";
import { writeVersionedJson } from "../src/shared/versioned-json-store.mjs";
import {
  fixtureAssetFileDependencies,
  readFixtureEpisode,
  readPacedFixtureEpisode
} from "./episode-fixture.mjs";

function memoryStore(initialEpisode, appendEvent) {
  let stored = structuredClone(initialEpisode);
  return {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (episode) => {
      stored = structuredClone(episode);
    },
    appendEvent,
    get episode() {
      return structuredClone(stored);
    }
  };
}

test("机器审核审计暂时失败时保留成功 Worker 状态并可幂等补写", async () => {
  const source = await readPacedFixtureEpisode();
  const fixtureFiles = fixtureAssetFileDependencies(source);
  const delivered = new Map();
  let reviewAuditAttempts = 0;
  let workerRuns = 0;
  let reviewAuditAvailable = false;
  const voiceAgent = getAgent("voice-agent");
  const store = memoryStore(source, async (event) => {
    if (event.type === "review.completed") {
      reviewAuditAttempts += 1;
      if (!reviewAuditAvailable) {
        const error = new Error("synthetic review audit unavailable");
        error.code = "synthetic_review_audit_unavailable";
        throw error;
      }
    }
    if (!delivered.has(event.idempotencyKey)) {
      delivered.set(event.idempotencyKey, structuredClone(event));
    }
    return structuredClone(event);
  });

  const result = await runAgent(source.id, "voice-agent", {
    ...store,
    agent: {
      async run(episode, context) {
        workerRuns += 1;
        return voiceAgent.run(episode, context);
      }
    },
    review: fixtureFiles
  });

  assert.equal(result.output.status, "waiting_approval");
  assert.equal(
    store.episode.pipeline.find((step) => step.agent === "voice-agent").status,
    "waiting_approval"
  );
  assert.equal(workerRuns, 1);
  assert.equal(store.episode.control.activeOperation, null);
  assert.equal(
    store.episode.history.filter((entry) => (
      entry.type === "agent-run" && entry.agentId === "voice-agent"
    )).at(-1).status,
    "waiting_approval"
  );
  assert.equal(
    [...delivered.values()].some((event) => event.type === "agent.failed"),
    false
  );
  assert.equal(result.auditDelivery.pendingCount, 2);
  assert.deepEqual(
    store.episode.system.workerAuditOutbox.map((marker) => marker.event.type),
    ["review.completed", "agent.finished"]
  );

  const failedAttempts = reviewAuditAttempts;
  reviewAuditAvailable = true;
  const replayed = await replayPendingWorkerAuditEvents(source.id, store);
  assert.equal(replayed.pendingCount, 0);
  assert.equal(store.episode.system.workerAuditOutbox.length, 0);
  assert.equal(reviewAuditAttempts, failedAttempts + 1);
  assert.equal(
    [...delivered.values()].filter((event) => event.type === "review.completed").length,
    1
  );
  assert.equal(
    [...delivered.values()].filter((event) => event.type === "agent.finished").length,
    1
  );
  const deliveredCount = delivered.size;
  const secondReplay = await replayPendingWorkerAuditEvents(source.id, store);
  assert.equal(secondReplay.deliveredCount, 0);
  assert.equal(secondReplay.pendingCount, 0);
  assert.equal(delivered.size, deliveredCount);
  assert.equal(workerRuns, 1);
});

test("审计回执与 outbox 不一致时保持 pending 且不伪造 delivered", async () => {
  const source = await readFixtureEpisode();
  const operationId = "operation:worker:golden-001:voice-agent:test";
  const eventId = `${operationId}:audit:1`;
  const queued = enqueueWorkerAuditEvents(source, [{
    eventId,
    idempotencyKey: eventId,
    type: "agent.finished",
    episodeId: source.id,
    agentId: "voice-agent",
    status: "waiting_approval",
    message: "等待素材与声音审批"
  }], {
    operationId,
    now: new Date("2026-08-31T10:00:00.000Z")
  });
  let validReceipt = false;
  const store = memoryStore(queued, async (event) => ({
    ...structuredClone(event),
    message: validReceipt ? event.message : "mismatched receipt"
  }));

  const blocked = await replayPendingWorkerAuditEvents(source.id, {
    ...store,
    requireAuditReceipt: true,
    now: new Date("2026-08-31T10:01:00.000Z")
  });
  assert.equal(blocked.pendingCount, 1);
  assert.equal(blocked.error.code, "worker_audit_receipt_invalid");
  assert.equal(store.episode.system.workerAuditOutbox.length, 1);
  assert.equal(store.episode.system.workerAuditDelivery.status, "pending");

  validReceipt = true;
  const delivered = await replayPendingWorkerAuditEvents(source.id, {
    ...store,
    requireAuditReceipt: true,
    now: new Date("2026-08-31T10:02:00.000Z")
  });
  assert.equal(delivered.pendingCount, 0);
  assert.equal(delivered.error, null);
  assert.equal(store.episode.system.workerAuditOutbox.length, 0);
});

test("启动恢复会自动重放 pending Worker 审计而不重跑 Worker", async () => {
  const source = await readFixtureEpisode();
  const operationId = "operation:worker:golden-001:voice-agent:startup-replay";
  const eventId = `${operationId}:audit:1`;
  const queued = enqueueWorkerAuditEvents(source, [{
    eventId,
    idempotencyKey: eventId,
    type: "agent.finished",
    episodeId: source.id,
    agentId: "voice-agent",
    status: "waiting_approval",
    message: "等待素材与声音审批"
  }], {
    operationId,
    now: new Date("2026-08-31T11:00:00.000Z")
  });
  const delivered = [];
  const store = memoryStore(queued, async (event) => {
    delivered.push(structuredClone(event));
    return structuredClone(event);
  });

  const recovered = await recoverInterruptedRuns({
    now: new Date("2026-08-31T11:01:00.000Z"),
    listEpisodes: async () => [store.episode],
    writeEpisode: store.writeEpisode,
    appendEvent: store.appendEvent,
    requireAuditReceipt: true,
    access: async () => {}
  });

  assert.equal(delivered.filter((event) => event.type === "agent.finished").length, 1);
  assert.equal(store.episode.system.workerAuditOutbox.length, 0);
  assert.equal(recovered.length, 1);
  assert.deepEqual(recovered[0].workerAuditDelivery, {
    deliveredCount: 1,
    pendingCount: 0,
    error: null
  });
});

test("真实 state_version_conflict 后刷新最新 Episode，禁止用旧快照继续恢复", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "worker-audit-cas-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = resolve(directory, "episode.json");
  const source = await readFixtureEpisode();
  const operationId = "operation:worker:golden-001:voice-agent:cas";
  const eventId = `${operationId}:audit:1`;
  const queued = enqueueWorkerAuditEvents(source, [{
    eventId,
    idempotencyKey: eventId,
    type: "agent.finished",
    episodeId: source.id,
    agentId: "voice-agent",
    status: "waiting_approval",
    message: "等待素材与声音审批"
  }], {
    operationId,
    now: new Date("2026-08-31T12:00:00.000Z")
  });
  await writeFile(statePath, `${JSON.stringify(queued, null, 2)}\n`, "utf8");

  const readState = async () => JSON.parse(await readFile(statePath, "utf8"));
  const writeState = async (episode) => {
    const result = await writeVersionedJson(statePath, episode, {
      expectedVersion: episode.control.stateVersion,
      getVersion: (value) => value?.control?.stateVersion ?? 0,
      setVersion: (value, version) => {
        value.control.stateVersion = version;
      },
      retryDelayMs: 2,
      lockTimeoutMs: 1_000
    });
    episode.control.stateVersion = result.version;
  };
  let forceConflict = true;
  const appendEvent = async (event) => {
    if (forceConflict) {
      forceConflict = false;
      const concurrent = await readState();
      concurrent.history.push({
        at: "2026-08-31T12:00:01.000Z",
        type: "concurrent-update",
        message: "模拟另一进程提交"
      });
      await writeState(concurrent);
    }
    return structuredClone(event);
  };

  const conflicted = await deliverWorkerAuditOutbox(await readState(), {
    appendEvent,
    writeEpisode: writeState,
    readEpisode: readState,
    requireReceipt: true,
    now: new Date("2026-08-31T12:00:02.000Z")
  });
  assert.equal(conflicted.error.code, "worker_audit_ack_persist_failed");
  assert.equal(conflicted.safeToContinue, true);
  assert.equal(conflicted.pendingCount, 1);
  assert.equal(conflicted.episode.control.stateVersion, 1);
  assert.equal(
    conflicted.episode.history.some((entry) => entry.type === "concurrent-update"),
    true
  );

  const replayed = await deliverWorkerAuditOutbox(conflicted.episode, {
    appendEvent,
    writeEpisode: writeState,
    readEpisode: readState,
    requireReceipt: true,
    now: new Date("2026-08-31T12:00:03.000Z")
  });
  assert.equal(replayed.error, null);
  assert.equal(replayed.pendingCount, 0);
  assert.equal(replayed.episode.control.stateVersion, 2);
  assert.equal((await readState()).system.workerAuditOutbox.length, 0);
});

test("启动重放无法刷新 CAS 冲突后的最新状态时，只延后该 Episode 而不写旧快照", async () => {
  const source = await readFixtureEpisode();
  const operationId = "operation:worker:golden-001:voice-agent:startup-cas";
  const eventId = `${operationId}:audit:1`;
  const queued = enqueueWorkerAuditEvents(source, [{
    eventId,
    idempotencyKey: eventId,
    type: "agent.finished",
    episodeId: source.id,
    agentId: "voice-agent",
    status: "waiting_approval",
    message: "等待素材与声音审批"
  }], { operationId, now: new Date("2026-08-31T13:00:00.000Z") });
  let writeAttempts = 0;
  const recovered = await recoverInterruptedRuns({
    now: new Date("2026-08-31T13:01:00.000Z"),
    listEpisodes: async () => [structuredClone(queued)],
    writeEpisode: async () => {
      writeAttempts += 1;
      const error = new Error("synthetic CAS conflict");
      error.code = "state_version_conflict";
      throw error;
    },
    appendEvent: async (event) => structuredClone(event),
    requireAuditReceipt: true,
    access: async () => {}
  });
  assert.equal(writeAttempts, 1, "不能在 ACK CAS 失败后再次写入同一旧快照");
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].recoveryDeferred, true);
  assert.equal(
    recovered[0].workerAuditDelivery.error.code,
    "worker_audit_ack_persist_failed"
  );
});

function autoRevisionFixture(source) {
  const episode = structuredClone(source);
  episode.thesis = "";
  episode.pipeline.find((step) => step.agent === "script-agent").status = "ready";
  return episode;
}

function revisionCandidate() {
  return {
    status: "waiting_approval",
    message: "脚本候选等待审批",
    artifacts: [],
    findings: [],
    requiresApproval: "script",
    requiresHuman: false,
    patch: {}
  };
}

test("自动修改在审计 ACK 冲突且无法刷新时 fail closed，不会重跑 Worker", async () => {
  let stored = autoRevisionFixture(await readFixtureEpisode());
  let workerRuns = 0;
  let failRefreshOnce = false;
  const readEpisode = async () => {
    if (failRefreshOnce) {
      failRefreshOnce = false;
      throw new Error("synthetic refresh unavailable");
    }
    return structuredClone(stored);
  };
  const writeEpisode = async (episode) => {
    const storedPending = stored.system?.workerAuditOutbox?.length ?? 0;
    const nextPending = episode.system?.workerAuditOutbox?.length ?? 0;
    if (storedPending > 0 && nextPending === 0) {
      failRefreshOnce = true;
      const error = new Error("synthetic ACK CAS conflict");
      error.code = "state_version_conflict";
      throw error;
    }
    stored = structuredClone(episode);
  };

  await assert.rejects(
    () => runAgent(stored.id, "script-agent", {
      readEpisode,
      writeEpisode,
      appendEvent: async (event) => structuredClone(event),
      agent: {
        async run() {
          workerRuns += 1;
          return revisionCandidate();
        }
      },
      limits: { maxAttempts: 2, maxRevisionRounds: 1 }
    }),
    (error) => error?.code === "worker_audit_continuation_unsafe"
  );

  assert.equal(workerRuns, 1);
  assert.equal(
    stored.pipeline.find((step) => step.agent === "script-agent").status,
    "failed"
  );
  assert.equal(stored.control.activeOperation, null);
});

test("自动修改刷新到别的持久化操作后不覆盖新状态也不伪造失败审计", async () => {
  let stored = autoRevisionFixture(await readFixtureEpisode());
  let workerRuns = 0;
  const events = [];
  const replacementOperation = {
    id: "operation:worker:golden-001:script-agent:replacement",
    kind: "worker:script-agent",
    startedAt: "2026-08-31T14:00:00.000Z"
  };
  const writeEpisode = async (episode) => {
    const storedPending = stored.system?.workerAuditOutbox?.length ?? 0;
    const nextPending = episode.system?.workerAuditOutbox?.length ?? 0;
    if (storedPending > 0 && nextPending === 0) {
      const concurrent = structuredClone(stored);
      concurrent.control.activeOperation = replacementOperation;
      concurrent.pipeline.find((step) => step.agent === "script-agent").status = "ready";
      concurrent.history.push({
        at: "2026-08-31T14:00:00.000Z",
        type: "replacement-operation",
        message: "另一进程已接管"
      });
      stored = concurrent;
      const error = new Error("synthetic ACK CAS conflict");
      error.code = "state_version_conflict";
      throw error;
    }
    stored = structuredClone(episode);
  };

  await assert.rejects(
    () => runAgent(stored.id, "script-agent", {
      readEpisode: async () => structuredClone(stored),
      writeEpisode,
      appendEvent: async (event) => {
        events.push(structuredClone(event));
        return structuredClone(event);
      },
      agent: {
        async run() {
          workerRuns += 1;
          return revisionCandidate();
        }
      },
      limits: { maxAttempts: 2, maxRevisionRounds: 1 }
    }),
    (error) => error?.code === "worker_operation_superseded"
  );

  assert.equal(workerRuns, 1);
  assert.deepEqual(stored.control.activeOperation, replacementOperation);
  assert.equal(
    stored.pipeline.find((step) => step.agent === "script-agent").status,
    "ready"
  );
  assert.equal(events.some((event) => event.type === "agent.failed"), false);
  assert.equal(
    stored.history.some((entry) => entry.type === "replacement-operation"),
    true
  );
});
