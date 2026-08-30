import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createStudioServer } from "../src/server/app.mjs";
import {
  adjudicateProviderResultCommit,
  PROVIDER_RESULT_COMMIT_CONFIRMATION,
  PROVIDER_RESULT_RETRY_CONFIRMATION
} from "../src/server/control/provider-result-recovery.mjs";
import { currentGateArtifactHash, currentGateVersion } from
  "../src/shared/workflow.mjs";
import { readFixtureEpisode } from "./episode-fixture.mjs";

const reservationId = "route-result-commit-unknown:attempt:1";
const OPERATOR_TOKEN = "provider-recovery-operator-token-at-least-32-bytes";
const CAPABILITY_SECRET = "provider-recovery-capability-secret-at-least-32-bytes";

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

function commitUnknownEpisode() {
  return readFixtureEpisode().then((source) => {
    const episode = structuredClone(source);
    const step = episode.pipeline.find((item) => item.agent === "script-agent");
    step.status = "failed";
    step.lastError = "provider_result_commit_unknown";
    step.requiresHuman = true;
    step.uncommittedProviderResultIds = [reservationId];
    episode.history.push({
      at: "2026-08-25T01:00:00.000Z",
      type: "agent-recovered",
      agentId: "script-agent",
      failureCode: "provider_result_commit_unknown",
      reservationIds: [reservationId],
      requiresHumanAdded: true
    });
    return episode;
  });
}

function memoryStore(initial) {
  let stored = structuredClone(initial);
  let writes = 0;
  const events = [];
  return {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (next) => {
      writes += 1;
      stored = structuredClone(next);
      stored.control.stateVersion += 1;
    },
    appendEvent: async (event) => events.push(structuredClone(event)),
    get episode() {
      return structuredClone(stored);
    },
    get writes() {
      return writes;
    },
    events
  };
}

function retryInput(episode, overrides = {}) {
  return {
    target: "script-agent",
    decision: "retry_authorized",
    confirmation: PROVIDER_RESULT_RETRY_CONFIRMATION,
    expectedStateVersion: episode.control.stateVersion,
    reservationIds: [reservationId],
    note: "已核对本地没有可复用产物",
    ...overrides
  };
}

test("Provider 结果裁决缺少服务端人工身份或 scoped Capability 时零读取零写入", async () => {
  let reads = 0;
  let writes = 0;
  const dependencies = {
    requireSideEffectCapability: true,
    readEpisode: async () => {
      reads += 1;
      return commitUnknownEpisode();
    },
    writeEpisode: async () => {
      writes += 1;
    }
  };
  const episode = await commitUnknownEpisode();
  await assert.rejects(
    adjudicateProviderResultCommit(episode.id, retryInput(episode), dependencies),
    (error) => error.code === "provider_result_adjudication_forbidden" &&
      error.statusCode === 403
  );
  await assert.rejects(
    adjudicateProviderResultCommit(episode.id, retryInput(episode), {
      ...dependencies,
      actor: "human:recovery-reviewer"
    }),
    (error) => error.code === "side_effect_capability_missing" &&
      error.statusCode === 403
  );
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test("人工明确确认本地结果不可复用后，只解除该 Worker 的提交不明冻结", async () => {
  const source = await commitUnknownEpisode();
  const store = memoryStore(source);
  const result = await adjudicateProviderResultCommit(
    source.id,
    retryInput(source),
    {
      ...store,
      actor: "human:recovery-reviewer",
      now: new Date("2026-08-25T01:01:00.000Z")
    }
  );
  assert.equal(result.unchanged, false);
  const step = store.episode.pipeline.find((item) => item.agent === "script-agent");
  assert.equal(step.status, "failed");
  assert.equal(step.requiresHuman, false);
  assert.equal(step.lastError, null);
  assert.equal(Object.hasOwn(step, "uncommittedProviderResultIds"), false);
  assert.equal(step.providerResultAdjudication.decision, "retry_authorized");
  assert.equal(store.episode.control.budget.overrun, source.control.budget.overrun);
  assert.equal(store.episode.history.at(-1).actor, "human:recovery-reviewer");
  assert.equal(store.writes, 1);
  assert.equal(store.events.length, 1);

  const repeated = await adjudicateProviderResultCommit(
    source.id,
    retryInput(source),
    { ...store, actor: "human:recovery-reviewer" }
  );
  assert.equal(repeated.unchanged, true);
  assert.equal(store.writes, 1);
  assert.equal(store.events.length, 2);
  assert.deepEqual(store.events[1], store.events[0]);
  assert.equal(
    store.events[0].idempotencyKey,
    `${result.adjudication.id}:audit`
  );
});

test("Provider 裁决在状态提交后审计首写失败，重试以同一幂等事件补达", async () => {
  const source = await commitUnknownEpisode();
  const store = memoryStore(source);
  const attemptedEvents = [];
  let failAudit = true;
  const dependencies = {
    ...store,
    actor: "human:recovery-reviewer",
    now: new Date("2026-08-25T01:01:30.000Z"),
    appendEvent: async (event) => {
      attemptedEvents.push(structuredClone(event));
      if (failAudit) {
        const error = new Error("synthetic audit append failure");
        error.code = "synthetic_audit_failure";
        throw error;
      }
    }
  };

  await assert.rejects(
    adjudicateProviderResultCommit(source.id, retryInput(source), dependencies),
    (error) => error.code === "synthetic_audit_failure"
  );
  assert.equal(store.writes, 1);
  assert.equal(store.episode.history.filter(
    (entry) => entry.type === "provider-result-adjudicated"
  ).length, 1);

  failAudit = false;
  const retried = await adjudicateProviderResultCommit(
    source.id,
    retryInput(source),
    dependencies
  );
  assert.equal(retried.unchanged, true);
  assert.equal(store.writes, 1);
  assert.equal(attemptedEvents.length, 2);
  assert.deepEqual(attemptedEvents[1], attemptedEvents[0]);
  assert.equal(
    attemptedEvents[0].idempotencyKey,
    `${retried.adjudication.id}:audit`
  );
});

test("确认本地提交只能绑定当前版本、哈希和已通过的机器审核，且不会代替人工 Gate", async () => {
  const source = await commitUnknownEpisode();
  source.approvals.script.status = "pending";
  source.approvals.script.currentVersion = currentGateVersion(source, "script");
  const artifactHash = currentGateArtifactHash(source, "script");
  const reviewReportId = "review-script-v1-provider-recovery";
  source.reviews.script = {
    ...source.reviews.script,
    status: "passed",
    artifactVersion: currentGateVersion(source, "script"),
    artifactHash,
    latestReportId: reviewReportId,
    reports: [{
      id: reviewReportId,
      decision: "pass",
      artifactVersion: currentGateVersion(source, "script"),
      artifactHash
    }]
  };
  const store = memoryStore(source);
  const input = {
    target: "script-agent",
    decision: "commit_confirmed",
    confirmation: PROVIDER_RESULT_COMMIT_CONFIRMATION,
    expectedStateVersion: source.control.stateVersion,
    reservationIds: [reservationId],
    artifactVersion: currentGateVersion(source, "script"),
    artifactHash,
    reviewReportId,
    note: "已核对本地草稿和机器审核报告"
  };
  await assert.rejects(
    adjudicateProviderResultCommit(source.id, {
      ...input,
      artifactHash: "f".repeat(64)
    }, { ...store, actor: "human:recovery-reviewer" }),
    (error) => error.code === "provider_result_commit_binding_conflict" &&
      error.statusCode === 409
  );
  assert.equal(store.writes, 0);

  await adjudicateProviderResultCommit(source.id, input, {
    ...store,
    actor: "human:recovery-reviewer"
  });
  const step = store.episode.pipeline.find((item) => item.agent === "script-agent");
  assert.equal(step.status, "waiting_approval");
  assert.equal(step.requiresApproval, "script");
  assert.equal(step.requiresHuman, false);
  assert.equal(store.episode.approvals.script.status, "pending");
  assert.equal(store.episode.control.budget.overrun, source.control.budget.overrun);
});

test("Provider 结果裁决拒绝过期 stateVersion、错误 reservation 和错误确认语", async () => {
  const source = await commitUnknownEpisode();
  const store = memoryStore(source);
  for (const [overrides, code] of [
    [{ expectedStateVersion: source.control.stateVersion + 1 },
      "provider_result_adjudication_state_conflict"],
    [{ reservationIds: ["another-reservation"] },
      "provider_result_adjudication_not_pending"],
    [{ confirmation: "yes" },
      "provider_result_adjudication_confirmation_required"]
  ]) {
    await assert.rejects(
      adjudicateProviderResultCommit(
        source.id,
        retryInput(source, overrides),
        { ...store, actor: "human:recovery-reviewer" }
      ),
      (error) => error.code === code
    );
  }
  assert.equal(store.writes, 0);
});

test("Main Agent 规划提交不明只能显式授权新规划，且恢复原先的预算冻结状态", async () => {
  const source = await readFixtureEpisode();
  source.control.currentPlan = {
    id: "plan-golden-001-v9",
    version: 9,
    status: "failed",
    errorCode: "provider_result_commit_unknown",
    requiresHuman: true,
    uncommittedProviderResultIds: [reservationId]
  };
  source.planHistory.push(structuredClone(source.control.currentPlan));
  source.control.budget.overrun = true;
  source.history.push({
    at: "2026-08-25T01:02:00.000Z",
    type: "provider-result-commit-unknown",
    status: "blocked",
    agentId: "main-agent",
    failureCode: "provider_result_commit_unknown",
    reservationIds: [reservationId],
    previousBudgetOverrun: false
  });
  const store = memoryStore(source);
  await adjudicateProviderResultCommit(source.id, {
    ...retryInput(source),
    target: "main-agent"
  }, { ...store, actor: "human:recovery-reviewer" });
  assert.equal(store.episode.control.currentPlan.requiresHuman, false);
  assert.equal(
    Object.hasOwn(store.episode.control.currentPlan, "uncommittedProviderResultIds"),
    false
  );
  assert.equal(store.episode.control.budget.overrun, false);
  assert.equal(store.episode.planHistory.at(-1).retryAuthorizedBy,
    "human:recovery-reviewer");

  const stillFrozen = await readFixtureEpisode();
  stillFrozen.control.currentPlan = structuredClone(source.control.currentPlan);
  stillFrozen.planHistory.push(structuredClone(source.control.currentPlan));
  stillFrozen.control.budget.overrun = true;
  stillFrozen.history.push({
    ...source.history.at(-1),
    previousBudgetOverrun: true
  });
  const frozenStore = memoryStore(stillFrozen);
  await adjudicateProviderResultCommit(stillFrozen.id, {
    ...retryInput(stillFrozen),
    target: "main-agent"
  }, { ...frozenStore, actor: "human:recovery-reviewer" });
  assert.equal(frozenStore.episode.control.budget.overrun, true);
});

test("Provider 结果 HTTP 裁决强制使用短期 operator session 与 CSRF，长期 token 不能绕过", async () => {
  let stored = await commitUnknownEpisode();
  let reads = 0;
  let writes = 0;
  const created = await createStudioServer({
    recoverOnStart: false,
    operatorActor: "human:provider-recovery-reviewer",
    operatorToken: OPERATOR_TOKEN,
    capabilitySecret: CAPABILITY_SECRET,
    readEpisode: async () => {
      reads += 1;
      return structuredClone(stored);
    },
    writeEpisode: async (next) => {
      writes += 1;
      const committed = structuredClone(next);
      committed.control.stateVersion += 1;
      next.control.stateVersion = committed.control.stateVersion;
      stored = committed;
    },
    appendEvent: async () => {}
  });
  const { server, config, operatorUnlockCode } = created;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const endpoint =
      `${base}/api/episodes/${stored.id}/control/provider-results/adjudicate`;
    const body = retryInput(stored);

    const longToken = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-operator-token": OPERATOR_TOKEN
      },
      body: JSON.stringify(body)
    });
    assert.equal(longToken.status, 403);
    assert.equal((await longToken.json()).code, "operator_auth_forbidden");
    assert.equal(reads, 0);
    assert.equal(writes, 0);

    const unlocked = await fetch(`${base}/api/operator/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: `http://127.0.0.1:${config.port}`
      },
      body: JSON.stringify({ unlockCode: operatorUnlockCode })
    });
    assert.equal(unlocked.status, 201);
    const setCookie = unlocked.headers.get("set-cookie") ?? "";
    const sessionCookie = /acs_operator_session=([^;,]+)/u.exec(setCookie)?.[1];
    const session = await unlocked.json();

    const missingCsrf = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `acs_operator_session=${sessionCookie}`
      },
      body: JSON.stringify(body)
    });
    assert.equal(missingCsrf.status, 403);
    assert.equal((await missingCsrf.json()).code, "operator_session_csrf_forbidden");
    assert.equal(reads, 0);
    assert.equal(writes, 0);

    const adjudicated = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `acs_operator_session=${sessionCookie}`,
        "x-operator-csrf": session.csrfToken
      },
      body: JSON.stringify(body)
    });
    assert.equal(adjudicated.status, 200);
    const response = await adjudicated.json();
    assert.equal(response.adjudication.actor, "human:provider-recovery-reviewer");
    assert.equal(response.adjudication.decision, "retry_authorized");
    assert.equal(reads, 1);
    assert.equal(writes, 1);
    assert.equal(
      stored.pipeline.find((item) => item.agent === "script-agent").requiresHuman,
      false
    );
    assert.equal(JSON.stringify(stored).includes(OPERATOR_TOKEN), false);
    assert.equal(JSON.stringify(stored).includes(CAPABILITY_SECRET), false);
  } finally {
    await closeServer(server);
  }
});
