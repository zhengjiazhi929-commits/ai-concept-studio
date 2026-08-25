import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ensureAgentArchitecture } from "../src/shared/agent-contracts.mjs";
import {
  appendAuditEvent,
  readAuditEvents
} from "../src/shared/audit-log.mjs";
import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import {
  studioOutputRoot,
  studioRoot,
  workspaceRoot
} from "../src/shared/paths.mjs";
import { writeVersionedJson } from "../src/shared/versioned-json-store.mjs";
import { transitionControlMode } from "../src/server/control/controlled-dispatch.mjs";
import {
  adjudicateProviderResultCommit,
  PROVIDER_RESULT_RETRY_CONFIRMATION
} from "../src/server/control/provider-result-recovery.mjs";
import { assertCurrentAssetBundleIntegrity } from
  "../src/server/production/asset-bundle-integrity.mjs";
import {
  recoverPendingUploadTransactions,
  stageExclusiveVersionedUpload
} from
  "../src/server/production/upload-transaction.mjs";

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCase(id, businessRisk, exercise) {
  const startedAt = Date.now();
  try {
    const evidence = await exercise();
    return {
      id,
      businessRisk,
      passed: true,
      elapsedMs: Date.now() - startedAt,
      evidence
    };
  } catch (error) {
    return {
      id,
      businessRisk,
      passed: false,
      elapsedMs: Date.now() - startedAt,
      errorCode: error?.code ?? null,
      error: error?.message ?? String(error)
    };
  }
}

async function fixtureEpisode() {
  const value = JSON.parse(await readFile(
    resolve(studioRoot, "tests", "fixtures", "episodes", "golden-001.json"),
    "utf8"
  ));
  return ensureAgentArchitecture(value);
}

function nextVoiceFileName(files) {
  const highest = files.reduce((current, file) => {
    const match = /^voice-v(\d{3})\.wav$/u.exec(file);
    return Math.max(current, match ? Number(match[1]) : 0);
  }, 0);
  return "voice-v" + String(highest + 1).padStart(3, "0") + ".wav";
}

export async function runRemediationRollbackRehearsal(options = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "studio-remediation-rollback-"));
  const cases = [];
  try {
    cases.push(await runCase(
      "state-cas-preserves-winner",
      "过期进程不能覆盖较新的 Episode",
      async () => {
        const destination = resolve(temporaryRoot, "cas", "episode.json");
        const versionOptions = {
          getVersion: (value) => value?.stateVersion ?? 0,
          setVersion: (value, version) => {
            value.stateVersion = version;
          }
        };
        await writeVersionedJson(destination, { id: "winner", stateVersion: 0 }, {
          ...versionOptions,
          expectedVersion: 0
        });
        let conflictCode = null;
        try {
          await writeVersionedJson(destination, { id: "stale", stateVersion: 0 }, {
            ...versionOptions,
            expectedVersion: 0
          });
        } catch (error) {
          conflictCode = error?.code ?? null;
        }
        const persisted = JSON.parse(await readFile(destination, "utf8"));
        assert(conflictCode === "state_version_conflict", "过期写入没有收到 CAS 冲突");
        assert(persisted.id === "winner" && persisted.stateVersion === 1,
          "CAS 冲突后胜者状态被改写");
        return { conflictCode, persistedId: persisted.id, stateVersion: persisted.stateVersion };
      }
    ));

    cases.push(await runCase(
      "shadow-fallback-cancels-pending-dispatch",
      "紧急回退必须收回执行开关并取消尚未执行的派发",
      async () => {
        const episode = await fixtureEpisode();
        episode.control.mode = "assisted";
        episode.control.mainAgentEnabled = true;
        episode.control.modelRouterEnabled = true;
        episode.control.fixedFallbackEnabled = true;
        episode.control.pendingDispatch = {
          id: "dispatch-rollback-001",
          status: "awaiting_confirmation",
          planId: "plan-rollback-001",
          plan: { workerId: "script-agent" }
        };
        const result = transitionControlMode(episode, "shadow", {
          now: new Date("2026-08-25T04:00:00.000Z")
        });
        assert(result.changed === true, "回退没有产生状态变更");
        assert(result.episode.control.mode === "shadow", "控制模式没有回到 shadow");
        assert(result.episode.control.mainAgentEnabled === false,
          "Main Agent 执行开关没有收回");
        assert(result.episode.control.modelRouterEnabled === false,
          "Model Router 执行开关没有收回");
        assert(result.episode.control.pendingDispatch === null, "待派发动作没有取消");
        assert(result.episode.control.fixedFallbackEnabled === true,
          "fixed fallback 被错误关闭");
        return {
          mode: result.episode.control.mode,
          fixedFallbackEnabled: result.episode.control.fixedFallbackEnabled,
          cancelledDispatchStatus: result.episode.dispatchHistory.at(-1)?.status ?? null
        };
      }
    ));

    cases.push(await runCase(
      "provider-unknown-requires-explicit-retry-adjudication",
      "Provider 结算不明不能静默重试或冒充已提交",
      async () => {
        let stored = await fixtureEpisode();
        const reservationId = "rollback-provider-reservation-001";
        const step = stored.pipeline.find((item) => item.agent === "script-agent");
        step.status = "failed";
        step.lastError = "provider_result_commit_unknown";
        step.requiresHuman = true;
        step.uncommittedProviderResultIds = [reservationId];
        stored.approvals.script.status = "pending";
        stored.approvals.script.at = null;
        stored.history.push({
          at: "2026-08-25T04:01:00.000Z",
          type: "agent-recovered",
          agentId: "script-agent",
          failureCode: "provider_result_commit_unknown",
          reservationIds: [reservationId],
          requiresHumanAdded: true
        });
        const initialGateStatus = stored.approvals.script.status;
        const stateVersion = stored.control.stateVersion;
        const events = [];
        const result = await adjudicateProviderResultCommit(stored.id, {
          target: "script-agent",
          decision: "retry_authorized",
          confirmation: PROVIDER_RESULT_RETRY_CONFIRMATION,
          expectedStateVersion: stateVersion,
          reservationIds: [reservationId],
          note: "离线回滚演练确认本地没有可复用提交"
        }, {
          actor: "human:rollback-rehearsal",
          now: new Date("2026-08-25T04:02:00.000Z"),
          readEpisode: async () => structuredClone(stored),
          writeEpisode: async (next) => {
            stored = structuredClone(next);
            stored.control.stateVersion += 1;
          },
          appendEvent: async (event) => events.push(structuredClone(event))
        });
        const recovered = stored.pipeline.find((item) => item.agent === "script-agent");
        assert(result.unchanged === false, "首次裁决被错误视为重复请求");
        assert(recovered.providerResultAdjudication?.decision === "retry_authorized",
          "未记录精确 retry 裁决");
        assert(recovered.requiresHuman === false && recovered.lastError === null,
          "提交不明冻结没有按裁决解除");
        assert(stored.approvals.script.status === initialGateStatus,
          "恢复裁决越权修改了人工 Gate");
        assert(events.length === 1, "恢复裁决缺少审计事件");
        return {
          adjudicationDecision: recovered.providerResultAdjudication.decision,
          gateStatusBefore: initialGateStatus,
          gateStatusAfter: stored.approvals.script.status,
          eventCount: events.length
        };
      }
    ));

    cases.push(await runCase(
      "asset-drift-blocks-render",
      "审核后的素材字节变化必须在渲染前被阻断",
      async () => {
        const assetPath = resolve(temporaryRoot, "asset-integrity", "asset.bin");
        await mkdir(resolve(assetPath, ".."), { recursive: true });
        const initial = Buffer.from("approved-asset-bytes", "utf8");
        await writeFile(assetPath, initial);
        const episode = await fixtureEpisode();
        episode.assets = [{
          id: "rollback-asset",
          path: "episodes/rollback/asset.bin",
          bytes: initial.length,
          sha256: sha256(initial)
        }];
        episode.previewMode = "visual-proof";
        const inspect = async () => inspectFileIntegrity(assetPath);
        const binding = await assertCurrentAssetBundleIntegrity(episode, {
          inspectFileIntegrity: inspect
        });
        await writeFile(assetPath, Buffer.from("tampered-asset-bytes", "utf8"));
        let driftCode = null;
        try {
          await assertCurrentAssetBundleIntegrity(episode, {
            inspectFileIntegrity: inspect
          });
        } catch (error) {
          driftCode = error?.code ?? null;
        }
        assert(driftCode === "asset_bundle_integrity_mismatch",
          "素材变化没有在渲染前被阻断");
        return {
          originalBindingHash: binding.bindingHash,
          driftCode,
          renderStarted: false
        };
      }
    ));

    cases.push(await runCase(
      "concurrent-upload-rollback-removes-only-own-files",
      "并发上传不能覆盖，事务失败后不能留下孤儿文件",
      async () => {
        const directory = resolve(temporaryRoot, "uploads");
        const [first, second] = await Promise.all([
          stageExclusiveVersionedUpload({
            allowedRoot: temporaryRoot,
            directory,
            data: Buffer.from("voice-one"),
            nextFileName: nextVoiceFileName
          }),
          stageExclusiveVersionedUpload({
            allowedRoot: temporaryRoot,
            directory,
            data: Buffer.from("voice-two"),
            nextFileName: nextVoiceFileName
          })
        ]);
        assert(first.fileName !== second.fileName, "并发上传覆盖了同一版本");
        await Promise.all([access(first.destination), access(second.destination)]);
        const rollbacks = await Promise.all([first.rollback(), second.rollback()]);
        const remaining = await readdir(directory);
        assert(rollbacks.every(Boolean), "事务回滚没有删除自己的已发布文件");
        assert(remaining.length === 0, "上传回滚后存在孤儿或临时文件");
        return {
          versions: [first.fileName, second.fileName].sort(),
          rollbacks,
          remainingFiles: remaining
        };
      }
    ));

    cases.push(await runCase(
      "upload-crash-before-episode-cas-is-quarantined-on-restart",
      "文件公开后、Episode 提交前崩溃不能留下网页可见孤儿",
      async () => {
        const episode = await fixtureEpisode();
        const uploadRoot = resolve(temporaryRoot, "upload-crash", "public");
        const markerRoot = resolve(temporaryRoot, "upload-crash", "private", "pending");
        const quarantineRoot = resolve(
          temporaryRoot,
          "upload-crash",
          "private",
          "quarantine"
        );
        const staged = await stageExclusiveVersionedUpload({
          allowedRoot: uploadRoot,
          directory: resolve(uploadRoot, "episodes", episode.id),
          data: Buffer.from("crash-window-voice-bytes"),
          nextFileName: () => "voice-v099.wav",
          transaction: {
            markerRoot,
            episodeId: episode.id,
            kind: "voice",
            publicPathForFileName: (fileName) =>
              `episodes/${episode.id}/${fileName}`
          }
        });
        await access(staged.destination);
        const recovered = await recoverPendingUploadTransactions({
          markerRoot,
          quarantineRoot,
          allowedRoot: uploadRoot,
          listEpisodes: async () => [episode],
          isProcessAlive: async () => false
        });
        let finalExists = true;
        try {
          await access(staged.destination);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
          finalExists = false;
        }
        const pendingFiles = await readdir(markerRoot);
        const quarantinedFiles = await readdir(quarantineRoot);
        assert(finalExists === false, "重启恢复后公开孤儿仍然可见");
        assert(pendingFiles.length === 0, "已裁决 marker 仍留在 pending");
        assert(quarantinedFiles.length === 1, "崩溃 marker 没有进入私有隔离区");
        return {
          finalExists,
          removedFinalCount: recovered.removedFinalCount,
          pendingMarkerCount: pendingFiles.length,
          quarantinedMarkerCount: quarantinedFiles.length
        };
      }
    ));

    cases.push(await runCase(
      "audit-tamper-fails-closed",
      "审计证据被改写后，读取和追加都必须停止",
      async () => {
        const ledgerPath = resolve(temporaryRoot, "audit", "ledger.json");
        await appendAuditEvent(ledgerPath, {
          type: "rollback.started",
          actor: "system",
          idempotencyKey: "rollback-started"
        });
        await appendAuditEvent(ledgerPath, {
          type: "rollback.completed",
          actor: "system",
          idempotencyKey: "rollback-completed"
        });
        const tampered = JSON.parse(await readFile(ledgerPath, "utf8"));
        tampered.records[0].type = "rollback.tampered";
        await writeFile(ledgerPath, JSON.stringify(tampered, null, 2) + "\n");
        let readCode = null;
        let appendCode = null;
        try {
          await readAuditEvents(ledgerPath);
        } catch (error) {
          readCode = error?.code ?? null;
        }
        try {
          await appendAuditEvent(ledgerPath, { type: "must-not-append" });
        } catch (error) {
          appendCode = error?.code ?? null;
        }
        assert(readCode === "audit_integrity_invalid", "篡改账本仍可读取");
        assert(appendCode === "audit_integrity_invalid", "篡改账本仍可追加");
        return { readCode, appendCode, appendSucceeded: false };
      }
    ));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const failed = cases.filter((item) => !item.passed);
  return {
    schemaVersion: 1,
    id: "remediation-rollback-rehearsal",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      externalCalls: 0,
      paidApiCalls: 0,
      liveEpisodeReads: 0,
      liveEpisodeWrites: 0,
      fixture: "studio/tests/fixtures/episodes/golden-001.json"
    },
    status: failed.length === 0 ? "passed" : "failed",
    summary: {
      passed: failed.length === 0,
      passedCount: cases.length - failed.length,
      failedCount: failed.length,
      failedCaseIds: failed.map((item) => item.id)
    },
    cases
  };
}

function nextReportVersion(files) {
  return files.reduce((highest, file) => {
    const match = /^rollback-rehearsal-v(\d{3})\.json$/u.exec(file);
    return Math.max(highest, match ? Number(match[1]) : 0);
  }, 0) + 1;
}

export async function writeRemediationRollbackRehearsal(options = {}) {
  const report = await runRemediationRollbackRehearsal(options);
  const outputDirectory = resolve(studioOutputRoot, "remediation");
  await mkdir(outputDirectory, { recursive: true });
  const version = String(nextReportVersion(await readdir(outputDirectory))).padStart(3, "0");
  const reportPath = resolve(outputDirectory, "rollback-rehearsal-v" + version + ".json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx"
  });
  return {
    report,
    reportPath: relative(workspaceRoot, reportPath).replaceAll("\\", "/")
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await writeRemediationRollbackRehearsal();
  console.log(JSON.stringify(result, null, 2));
  if (!result.report.summary.passed) process.exitCode = 1;
}
