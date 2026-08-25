import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendAuditEvent,
  readAuditEvents,
  validateAuditLedger
} from "../src/shared/audit-log.mjs";
import {
  createProviderHealthManager,
  loadPersistentProviderHealthManager
} from "../src/server/control/provider-health.mjs";
import { WORKER_MANIFESTS } from "../src/shared/worker-manifests.mjs";
import { agents } from "../src/server/agents/registry.mjs";
import { validatePlanAgainstPolicy } from "../src/server/control/policy-engine.mjs";
import { ensureAgentArchitecture } from "../src/shared/agent-contracts.mjs";
import { readModelRoutingConfig } from "../src/server/control/model-router.mjs";

test("Provider 熔断区分错误类型，并在冷却后只进入 half-open 探测态", async () => {
  const manager = createProviderHealthManager({
    failureThreshold: 2,
    baseCooldownMs: 1000,
    now: new Date("2026-08-06T05:00:00.000Z")
  });
  await manager.recordFailure("primary", { status: 500 }, { errorCode: "server" });
  assert.equal(manager.snapshot().primary.state, "degraded");
  await manager.recordFailure("primary", { status: 500 }, { errorCode: "server" });
  assert.equal(manager.snapshot().primary.state, "unavailable");
  assert.equal(
    manager.snapshot(new Date("2026-08-06T05:00:02.000Z")).primary.state,
    "half-open"
  );
  await manager.recordFailure("locked", { status: 401 }, { errorCode: "invalid_api_key" });
  assert.equal(manager.snapshot().locked.state, "unavailable");
  assert.equal(manager.snapshot().locked.lastErrorClass, "authentication");
});

test("Provider 健康状态可持久化，重建管理器后不会把故障忘掉", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-health-"));
  const path = join(directory, "provider-health.json");
  try {
    const first = await loadPersistentProviderHealthManager({ path, failureThreshold: 1 });
    await first.recordFailure("primary", { status: 429 }, { errorCode: "rate_limited" });
    const second = await loadPersistentProviderHealthManager({ path, failureThreshold: 1 });
    assert.equal(second.snapshot().primary.state, "unavailable");
    assert.equal(second.snapshot().primary.lastErrorClass, "rate-limit");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("审计事件使用哈希链和幂等键，篡改与重复写入都可识别", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-audit-"));
  const path = join(directory, "audit.json");
  try {
    const first = await appendAuditEvent(path, {
      type: "agent.started",
      episodeId: "episode-1",
      idempotencyKey: "episode-1:plan-1:start"
    });
    const duplicate = await appendAuditEvent(path, {
      type: "agent.started",
      episodeId: "episode-1",
      idempotencyKey: "episode-1:plan-1:start"
    });
    assert.equal(duplicate.eventId, first.eventId);
    await appendAuditEvent(path, {
      type: "agent.completed",
      episodeId: "episode-1",
      idempotencyKey: "episode-1:plan-1:complete",
      provider: { apiKey: "opaque-synthetic-credential" }
    });
    const ledger = JSON.parse(await readFile(path, "utf8"));
    assert.equal(ledger.records.length, 2);
    assert.equal(ledger.records[1].provider.apiKey, "[REDACTED]");
    assert.equal(JSON.stringify(ledger).includes("opaque-synthetic-credential"), false);
    assert.equal(validateAuditLedger(ledger).valid, true);
    ledger.records[0].type = "approval.granted";
    assert.equal(validateAuditLedger(ledger).valid, false);
    await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    await assert.rejects(
      readAuditEvents(path),
      (error) => error.code === "audit_integrity_invalid"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("声明式 Worker Manifest 覆盖全部 Worker，并限制工具和重试上限", () => {
  assert.deepEqual(Object.keys(WORKER_MANIFESTS).sort(), Object.keys(agents).sort());
  const episode = ensureAgentArchitecture({
    id: "manifest-policy",
    approvals: { research: { status: "approved" } },
    pipeline: [{
      id: "script",
      agent: "script-agent",
      label: "脚本",
      status: "ready",
      gate: "script"
    }],
    control: { allowedTools: ["artifact.read"] }
  });
  const validation = validatePlanAgainstPolicy(episode, {
    action: "run_worker",
    workerId: "script-agent",
    taskProfile: "creative-structured",
    reason: "test",
    acceptanceCriteria: ["test"],
    reviewProfile: "script-v2",
    toolIds: ["render.local"],
    estimatedCalls: 1,
    estimatedCostUsd: 0,
    limits: { maxAttempts: 3, maxRevisionRounds: 0 },
    fallbackAction: "stop"
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("worker tool is not allowed by manifest: render.local"));
  assert.ok(validation.errors.includes("worker attempt limit exceeds manifest: 3"));
});

test("版本化路由配置通过 Schema 校验并产生可追踪哈希", async () => {
  const config = await readModelRoutingConfig();
  assert.equal(config.registry.version, "model-registry-v1");
  assert.equal(config.policy.version, "routing-policy-v1");
  assert.match(config.registryIntegrity.hash, /^[a-f0-9]{64}$/u);
  assert.match(config.policyIntegrity.hash, /^[a-f0-9]{64}$/u);
});
