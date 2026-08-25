import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createStudioServer } from "../src/server/app.mjs";
import { recoverInterruptedEpisode } from "../src/server/orchestrator.mjs";
import { AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION } from
  "../src/server/control/budget-ledger.mjs";
import { readFixtureEpisode } from "./episode-fixture.mjs";

const OPERATOR_TOKEN = "server-test-operator-token-20260824-at-least-32-bytes";
const CAPABILITY_SECRET = "server-test-capability-secret-20260824-at-least-32-bytes";

test("本地控制台 API 和视频分段读取可用", async () => {
  const fixtureEpisode = await readFixtureEpisode();
  const outputRoot = await mkdtemp(resolve(tmpdir(), "acs-server-test-"));
  const { server } = await createStudioServer({
    recoverOnStart: false,
    operatorActor: "human:server-test",
    operatorToken: OPERATOR_TOKEN,
    allowServiceTokenMutations: true,
    capabilitySecret: CAPABILITY_SECRET,
    outputRoot,
    listEpisodes: async () => [structuredClone(fixtureEpisode)],
    readEpisode: async () => structuredClone(fixtureEpisode),
    readRecentEvents: async () => [],
    getTrendRadarState: async () => ({
      run: {
        summary: { formalCandidateCount: 5 },
        candidates: [{ id: "agent-skill" }]
      }
    }),
    getCollectorState: async () => ({
      summary: { configuredSources: 18 },
      sources: []
    }),
    getResearchState: async () => ({ selection: null, pack: null }),
    getCloudBackupStatus: async () => ({
      summary: "test fixture",
      code: { configured: false },
      media: { configured: false }
    })
  });
  const fixtureDirectory = resolve(outputRoot, ".test-fixtures");
  const fixturePath = resolve(fixtureDirectory, "range.mp4");
  await mkdir(fixtureDirectory, { recursive: true });
  await writeFile(fixturePath, Buffer.alloc(256, 0x41));

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${base}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const forbidden = await fetch(`${base}/api/import/golden`, {
      method: "POST",
      headers: { origin: "https://evil.example" }
    });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).code, "forbidden_origin");

    const tooLarge = await fetch(`${base}/api/ai/primary`, {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:4317",
        "content-type": "application/json",
        "x-operator-token": OPERATOR_TOKEN
      },
      body: JSON.stringify({ providerId: "x".repeat(1024 * 1024) })
    });
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).code, "request_too_large");

    const ai = await fetch(`${base}/api/ai/status`).then((response) => response.json());
    assert.equal(ai.providers.some((provider) => provider.id === ai.primaryProvider), true);
    assert.equal(
      typeof ai.providers.find((provider) => provider.primary).configured,
      "boolean"
    );
    assert.equal(JSON.stringify(ai).includes("sk-"), false);
    assert.equal(ai.tasks.script.profile, "creative-structured");
    assert.equal(JSON.stringify(ai).includes("apiKeyEnv"), false);

    const episodes = await fetch(`${base}/api/episodes`).then((response) => response.json());
    assert.equal(episodes.episodes.some((episode) => episode.id === "golden-001"), true);

    const episode = await fetch(`${base}/api/episodes/golden-001`).then((response) =>
      response.json()
    );
    assert.deepEqual(Object.keys(episode.episode.approvals), [
      "research",
      "script",
      "storyboard",
      "assets",
      "final"
    ]);

    const workflow = await fetch(`${base}/api/episodes/golden-001/workflow`).then((response) =>
      response.json()
    );
    assert.equal(workflow.workflow.mode, "shadow");
    assert.equal(Array.isArray(workflow.workflow.legalActions), true);

    const metrics = await fetch(`${base}/api/episodes/golden-001/agent-metrics`).then((response) =>
      response.json()
    );
    assert.equal(metrics.metrics.episodeId, "golden-001");
    assert.equal(typeof metrics.metrics.slo.healthy, "boolean");

    const visualProofReview = await fetch(
      `${base}/api/episodes/golden-001/visual-proof-review`
    ).then((response) => response.json());
    assert.equal(visualProofReview.valid, false);
    assert.equal(visualProofReview.status, "not_started");

    const trends = await fetch(`${base}/api/trends`).then((response) => response.json());
    assert.equal(trends.run.summary.formalCandidateCount, 5);
    assert.equal(trends.run.candidates[0].id, "agent-skill");

    const collector = await fetch(`${base}/api/collector`).then((response) => response.json());
    assert.equal(collector.summary.configuredSources, 18);
    assert.equal(Array.isArray(collector.sources), true);

    const research = await fetch(`${base}/api/research`).then((response) => response.json());
    assert.equal(Object.hasOwn(research, "selection"), true);
    assert.equal(Object.hasOwn(research, "pack"), true);

    const cloud = await fetch(`${base}/api/cloud`).then((response) => response.json());
    assert.equal(typeof cloud.summary, "string");
    assert.equal(typeof cloud.code.configured, "boolean");
    assert.equal(typeof cloud.media.configured, "boolean");

    const approvalModule = await fetch(`${base}/approval-review-view.mjs`);
    assert.equal(approvalModule.status, 200);
    assert.equal(
      approvalModule.headers.get("content-type"),
      "text/javascript; charset=utf-8"
    );
    assert.match(await approvalModule.text(), /renderApprovalReview/u);

    const video = await fetch(`${base}/outputs/.test-fixtures/range.mp4`, {
      headers: { range: "bytes=0-127" }
    });
    assert.equal(video.status, 206);
    assert.equal(video.headers.get("content-length"), "128");
  } finally {
    if (server.listening) {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("人工预算对账 HTTP 入口默认关闭且未授权请求零写入", async () => {
  let writes = 0;
  const { server } = await createStudioServer({
    recoverOnStart: false,
    readEpisode: async () => {
      throw new Error("默认关闭时不应读取 Episode");
    },
    writeEpisode: async () => {
      writes += 1;
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/episodes/golden-001/control/budget/reconcile-ambiguous`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-budget-reconciliation-token": "client-cannot-enable-disabled-route-000000"
        },
        body: JSON.stringify({
          reservationId: "route-disabled:attempt:1",
          usedCalls: 0,
          usedCostUsd: 0,
          confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION
        })
      }
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "operator_auth_forbidden");
    assert.equal(writes, 0);
  } finally {
    if (server.listening) {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }
});

test("本地人工预算对账 API 使用服务端身份并严格确认后解除恢复冻结", async () => {
  const source = structuredClone(await readFixtureEpisode());
  const voice = source.pipeline.find((step) => step.agent === "voice-agent");
  voice.status = "running";
  voice.requiresHuman = false;
  source.control.budget.reservations = [{
    id: "route-http-recovery:attempt:1",
    decisionId: "route-http-recovery",
    calls: 1,
    costUsd: 0.2,
    costKnown: true,
    reservedAt: "2026-08-24T03:00:00.000Z"
  }];
  source.control.budget.reservedCalls = 1;
  source.control.budget.reservedCostUsd = 0.2;
  let stored = recoverInterruptedEpisode(
    source,
    new Date("2026-08-24T03:01:00.000Z")
  ).episode;
  let writes = 0;
  const budgetReconciliationToken = "test-budget-reconciliation-token-20260824-64-bytes";
  const operatorToken = "test-budget-operator-token-20260824-at-least-32-bytes";
  const { server } = await createStudioServer({
    recoverOnStart: false,
    operatorActor: "human:trusted-server-test",
    operatorToken,
    allowServiceTokenMutations: true,
    capabilitySecret: CAPABILITY_SECRET,
    budgetReconciliationToken,
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (next) => {
      writes += 1;
      stored = structuredClone(next);
    }
  });

  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const endpoint =
      `http://127.0.0.1:${address.port}/api/episodes/golden-001/control/budget/reconcile-ambiguous`;
    const request = (body, suppliedToken = budgetReconciliationToken) => fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-operator-token": operatorToken,
        ...(suppliedToken === null
          ? {}
          : { "x-budget-reconciliation-token": suppliedToken })
      },
      body: JSON.stringify(body)
    });

    const validRequest = {
      reservationId: "route-http-recovery:attempt:1",
      usedCalls: 1,
      usedCostUsd: 0.1,
      confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION
    };
    const missingToken = await request(validRequest, null);
    assert.equal(missingToken.status, 403);
    assert.equal((await missingToken.json()).code, "budget_reconciliation_forbidden");
    assert.equal(writes, 0);

    const wrongToken = await request(validRequest, "wrong-budget-reconciliation-token-0000");
    assert.equal(wrongToken.status, 403);
    assert.equal((await wrongToken.json()).code, "budget_reconciliation_forbidden");
    assert.equal(writes, 0);

    const invalidShape = await request(null);
    assert.equal(invalidShape.status, 400);
    assert.equal(
      (await invalidShape.json()).code,
      "budget_reconciliation_input_invalid"
    );
    assert.equal(writes, 0);

    const forgedActor = await request({
      reservationId: "route-http-recovery:attempt:1",
      usedCalls: 1,
      usedCostUsd: 0.1,
      actor: "human:forged-client",
      confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION
    });
    assert.equal(forgedActor.status, 400);
    assert.equal(
      (await forgedActor.json()).code,
      "budget_reconciliation_client_actor_forbidden"
    );
    assert.equal(writes, 0);

    const clientOverrun = await request({
      reservationId: "route-http-recovery:attempt:1",
      usedCalls: 1,
      usedCostUsd: 0.1,
      overrun: false,
      confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION
    });
    assert.equal(clientOverrun.status, 400);
    assert.equal(
      (await clientOverrun.json()).code,
      "budget_reconciliation_input_invalid"
    );
    assert.equal(writes, 0);

    const missingConfirmation = await request({
      reservationId: "route-http-recovery:attempt:1",
      usedCalls: 1,
      usedCostUsd: 0.1,
      confirmation: "not-confirmed"
    });
    assert.equal(missingConfirmation.status, 400);
    assert.equal(
      (await missingConfirmation.json()).code,
      "budget_reconciliation_confirmation_required"
    );
    assert.equal(writes, 0);

    const reconciled = await request({
      reservationId: "route-http-recovery:attempt:1",
      usedCalls: 1,
      usedCostUsd: 0.1,
      confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION
    });
    assert.equal(reconciled.status, 200);
    const body = await reconciled.json();
    assert.equal(body.reconciliation.actor, "human:trusted-server-test");
    assert.equal(body.reconciliation.confirmed, true);
    assert.equal(body.reconciliation.actualOverrun, false);
    assert.deepEqual(body.reconciliation.unfrozenAgentIds, ["voice-agent"]);
    assert.equal(body.budget.reservations.length, 0);
    assert.equal(JSON.stringify(body).includes(budgetReconciliationToken), false);
    assert.equal(JSON.stringify(stored).includes(budgetReconciliationToken), false);
    assert.equal(writes, 1);
    assert.equal(
      stored.pipeline.find((step) => step.agent === "voice-agent").requiresHuman,
      false
    );

    const duplicate = await request({
      reservationId: "route-http-recovery:attempt:1",
      usedCalls: 1,
      usedCostUsd: 0.1,
      confirmation: AMBIGUOUS_PROVIDER_BUDGET_CONFIRMATION
    });
    assert.equal(duplicate.status, 409);
    assert.equal(
      (await duplicate.json()).code,
      "budget_reconciliation_already_settled"
    );
    assert.equal(writes, 1);
  } finally {
    if (server.listening) {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }
});
