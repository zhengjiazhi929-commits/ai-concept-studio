import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { createStudioServer } from "../src/server/app.mjs";
import { approvalValidForGate } from "../src/server/control/policy-engine.mjs";
import {
  GOLDEN_IMPORT_AUDIT_EVENT_ID,
  importGoldenSample
} from "../src/server/importer.mjs";
import { appendAuditRecord } from "../src/shared/audit-log.mjs";
import { inspectFileIntegrity } from "../src/shared/integrity.mjs";
import { validateEpisode } from "../src/shared/schema.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";
import { readFixtureEpisode } from "./episode-fixture.mjs";

const OPERATOR_TOKEN = "importer-test-operator-token-at-least-32-bytes";
const CAPABILITY_SECRET = "importer-test-capability-secret-at-least-32-bytes";

function syntheticFileRecord(suffixes = {}) {
  return async (path) => {
    const fileName = path.split("/").at(-1);
    const defaultBody = path.endsWith(".png")
      ? `tracked-asset:${fileName}`
      : `tracked-source:${path}`;
    const body = Buffer.from(suffixes[path] ?? defaultBody, "utf8");
    return {
      path,
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex")
    };
  };
}

function syntheticConfig() {
  return {
    render: {
      previewWidth: 1080,
      previewHeight: 1920,
      previewFps: 30,
      previewDurationSeconds: 36,
      compositionId: "GoldenEpisode"
    }
  };
}

function missingEpisode() {
  const error = new Error("synthetic missing Episode");
  error.code = "ENOENT";
  return error;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

test("persist:false Golden seed 保留候选版本但不伪造三道批准或旧 trusted exception", async () => {
  const { episode } = await importGoldenSample({
    persist: false,
    readConfig: async () => syntheticConfig(),
    fileRecord: syntheticFileRecord()
  });

  for (const gate of ["research", "script", "storyboard"]) {
    assert.equal(episode.approvals[gate].status, "pending");
    assert.equal(episode.approvals[gate].artifactHash, null);
    assert.equal(episode.approvals[gate].reviewReportId, null);
    assert.equal(episode.approvals[gate].currentVersion, 1);
    assert.equal(approvalValidForGate(episode, gate), false);
  }
  assert.deepEqual(episode.approvalHistory, []);
  assert.equal(episode.system.trustedFixture, false);
  assert.equal(episode.system.fixedInput, true);
  assert.notEqual(episode.system.importedBy, "golden-sample-importer-v0.1");
  assert.equal(episode.research.version, 1);
  assert.equal(episode.research.generationKind,
    "deterministic-golden-m1-fixed-evidence");
  assert.equal(episode.research.readiness.readyForFactApproval, true);
  assert.deepEqual(
    episode.pipeline.filter((step) => step.status === "complete").map((step) => step.id),
    ["trend"]
  );
  assert.equal(episode.pipeline.find((step) => step.id === "research").status,
    "waiting_approval");
  assert.equal(episode.pipeline.find((step) => step.id === "research").requiresApproval,
    "research");
  for (const stepId of ["script", "storyboard", "assets", "voice", "render", "qa"]) {
    assert.equal(episode.pipeline.find((step) => step.id === stepId).status, "pending");
  }
  assert.deepEqual(
    episode.scenes.filter((scene) => scene.evidenceRef).map((scene) => scene.evidenceRef),
    [
      "demo-baseline-export-failed",
      "demo-viewer-denied",
      "demo-admin-export-complete"
    ]
  );
  assert.deepEqual(episode.productionProfile, {
    id: "m1-golden-36s-v1",
    targetDurationSeconds: 36
  });
  assert.equal(episode.production.scriptDraft.content.sections.length, 6);
  assert.equal(episode.production.scriptDraft.content.sections[5].end, 36);
  assert.equal(episode.production.scriptDraft.artifactPath, undefined);
  assert.equal(episode.production.storyboardDraft.artifactPath, undefined);
  assert.equal(episode.system.importAuditOutbox.status, "pending");
  assert.equal(episode.system.importAuditOutbox.eventId, GOLDEN_IMPORT_AUDIT_EVENT_ID);
  assert.deepEqual(validateEpisode(episode), { valid: true, errors: [] });
});

test("Gate hash 绑定 36 秒短脚本与六镜结构，长版 Markdown 仅是历史来源", async () => {
  const baseline = (await importGoldenSample({
    persist: false,
    readConfig: async () => syntheticConfig(),
    fileRecord: syntheticFileRecord()
  })).episode;
  const historicalSourcesChanged = (await importGoldenSample({
    persist: false,
    readConfig: async () => syntheticConfig(),
    fileRecord: syntheticFileRecord({
      "episodes/golden-001/07-script.md": "changed historical long script",
      "episodes/golden-001/08-storyboard.md": "changed historical long storyboard"
    })
  })).episode;
  const shortScriptChanged = structuredClone(baseline);
  shortScriptChanged.production.scriptDraft.content.sections[0].narration += "（修订）";
  const storyboardChanged = structuredClone(baseline);
  storyboardChanged.scenes[2].title = "工作单位发生了变化";

  assert.equal(baseline.production.scriptDraft.referenceSource,
    "episodes/golden-001/07-script.md");
  assert.equal(baseline.production.storyboardDraft.referenceSource,
    "episodes/golden-001/08-storyboard.md");
  assert.equal(baseline.production.scriptDraft.bytes, undefined);
  assert.equal(baseline.production.scriptDraft.sha256, undefined);
  assert.equal(baseline.production.storyboardDraft.bytes, undefined);
  assert.equal(baseline.production.storyboardDraft.sha256, undefined);
  assert.equal(
    currentGateArtifactHash(baseline, "script"),
    currentGateArtifactHash(historicalSourcesChanged, "script")
  );
  assert.equal(
    currentGateArtifactHash(baseline, "storyboard"),
    currentGateArtifactHash(historicalSourcesChanged, "storyboard")
  );
  assert.notEqual(
    currentGateArtifactHash(baseline, "script"),
    currentGateArtifactHash(shortScriptChanged, "script")
  );
  assert.equal(
    currentGateArtifactHash(baseline, "storyboard"),
    currentGateArtifactHash(shortScriptChanged, "storyboard")
  );
  assert.notEqual(
    currentGateArtifactHash(baseline, "storyboard"),
    currentGateArtifactHash(storyboardChanged, "storyboard")
  );
});

test("公开素材缺失或与 tracked source 不一致时 fail closed 且不写 Episode/Event", async (t) => {
  const root = "/synthetic/golden-seed-workspace";
  const publicDirectory = resolve(root, "studio/public/episodes/golden-001");
  const publicAsset = "studio/public/episodes/golden-001/demo-baseline-export-failed.png";

  for (const scenario of [
    {
      name: "missing",
      code: "golden_seed_public_asset_missing",
      fileRecord: async (path) => {
        if (path === publicAsset) {
          const error = new Error("synthetic public asset missing");
          error.code = "ENOENT";
          throw error;
        }
        return syntheticFileRecord()(path);
      }
    },
    {
      name: "mismatch",
      code: "golden_seed_public_asset_mismatch",
      fileRecord: syntheticFileRecord({ [publicAsset]: "tampered-public-bytes" })
    }
  ]) {
    await t.test(scenario.name, async () => {
      let writes = 0;
      let events = 0;
      await assert.rejects(
        importGoldenSample({
          workspaceRoot: root,
          readEpisode: async () => {
            throw missingEpisode();
          },
          readConfig: async () => syntheticConfig(),
          episodePublicDirectory: () => publicDirectory,
          fileRecord: scenario.fileRecord,
          writeEpisode: async () => {
            writes += 1;
          },
          appendEvent: async () => {
            events += 1;
          }
        }),
        (error) => error.code === scenario.code && error.statusCode === 409
      );
      assert.equal(writes, 0);
      assert.equal(events, 0);
    });
  }
});

test("默认文件校验拒绝 workspace 内的 symlink 素材且不写状态", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "acs-importer-symlink-"));
  const captures = resolve(
    root,
    "episodes/golden-001/production/captures/screen-selects"
  );
  const publicDirectory = resolve(root, "studio/public/episodes/golden-001");
  let writes = 0;
  try {
    await mkdir(captures, { recursive: true });
    await mkdir(publicDirectory, { recursive: true });
    await writeFile(resolve(captures, "actual.png"), "tracked bytes");
    await symlink("actual.png", resolve(captures, "demo-baseline-export-failed.png"));
    await writeFile(
      resolve(publicDirectory, "demo-baseline-export-failed.png"),
      "tracked bytes"
    );

    await assert.rejects(
      importGoldenSample({
        persist: false,
        workspaceRoot: root,
        readConfig: async () => syntheticConfig(),
        episodePublicDirectory: () => publicDirectory,
        writeEpisode: async () => {
          writes += 1;
        }
      }),
      (error) => error.code === "golden_seed_source_asset_invalid" &&
        error.statusCode === 409
    );
    assert.equal(writes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("默认文件校验发现摘要读取期间的文件替换并 fail closed", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "acs-importer-toctou-"));
  const captures = resolve(
    root,
    "episodes/golden-001/production/captures/screen-selects"
  );
  const publicDirectory = resolve(root, "studio/public/episodes/golden-001");
  const source = resolve(captures, "demo-baseline-export-failed.png");
  let inspections = 0;
  try {
    await mkdir(captures, { recursive: true });
    await mkdir(publicDirectory, { recursive: true });
    await writeFile(source, "tracked bytes");
    await writeFile(
      resolve(publicDirectory, "demo-baseline-export-failed.png"),
      "tracked bytes"
    );

    await assert.rejects(
      importGoldenSample({
        persist: false,
        workspaceRoot: root,
        readConfig: async () => syntheticConfig(),
        episodePublicDirectory: () => publicDirectory,
        inspectFileIntegrity: async (path) => {
          const integrity = await inspectFileIntegrity(path);
          inspections += 1;
          if (inspections === 1) await writeFile(path, "replacement bytes");
          return integrity;
        }
      }),
      (error) => error.code === "golden_seed_source_asset_invalid" &&
        error.statusCode === 409
    );
    assert.equal(inspections, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Episode 初次状态写失败时不伪造导入成功审计事件", async () => {
  const root = "/synthetic/golden-seed-write-failure";
  let eventCalls = 0;
  await assert.rejects(
    importGoldenSample({
      workspaceRoot: root,
      readEpisode: async () => {
        throw missingEpisode();
      },
      readConfig: async () => syntheticConfig(),
      episodePublicDirectory: () => resolve(
        root,
        "studio/public/episodes/golden-001"
      ),
      fileRecord: syntheticFileRecord(),
      writeEpisode: async () => {
        throw new Error("synthetic Episode state write failure");
      },
      appendEvent: async () => {
        eventCalls += 1;
      }
    }),
    /synthetic Episode state write failure/u
  );
  assert.equal(eventCalls, 0);
});

test("审计回执与稳定 outbox 不一致时不会伪造 delivered 状态", async () => {
  const root = "/synthetic/golden-seed-forged-receipt";
  let stored = null;
  let writes = 0;
  await assert.rejects(
    importGoldenSample({
      workspaceRoot: root,
      readEpisode: async () => {
        if (!stored) throw missingEpisode();
        return structuredClone(stored);
      },
      readConfig: async () => syntheticConfig(),
      episodePublicDirectory: () => resolve(
        root,
        "studio/public/episodes/golden-001"
      ),
      fileRecord: syntheticFileRecord(),
      writeEpisode: async (episode) => {
        writes += 1;
        stored = structuredClone(episode);
        stored.control.stateVersion += 1;
        episode.control.stateVersion = stored.control.stateVersion;
      },
      appendEvent: async (event) => ({ ...event, actor: "human:forged-receipt" })
    }),
    (error) => error.code === "golden_seed_audit_receipt_invalid" &&
      error.statusCode === 500
  );
  assert.equal(writes, 1);
  assert.equal(stored.system.importAuditOutbox.status, "pending");
});

test("pending import audit outbox 在 append 失败后可幂等恢复且不重复事件", async (t) => {
  for (const failurePoint of ["before-ledger-write", "after-ledger-write"]) {
    await t.test(failurePoint, async () => {
      const root = `/synthetic/golden-seed-audit-${failurePoint}`;
      let stored = null;
      let writes = 0;
      let appendCalls = 0;
      let ledger = { stateVersion: 0, records: [] };
      const dependencies = {
        workspaceRoot: root,
        readEpisode: async () => {
          if (!stored) throw missingEpisode();
          return structuredClone(stored);
        },
        readConfig: async () => syntheticConfig(),
        episodePublicDirectory: () => resolve(
          root,
          "studio/public/episodes/golden-001"
        ),
        fileRecord: syntheticFileRecord(),
        writeEpisode: async (episode) => {
          writes += 1;
          stored = structuredClone(episode);
          stored.control.stateVersion += 1;
          episode.control.stateVersion = stored.control.stateVersion;
          return resolve(root, "studio/data/episodes/golden-001/episode.json");
        },
        appendEvent: async (event) => {
          appendCalls += 1;
          if (appendCalls === 1 && failurePoint === "before-ledger-write") {
            throw new Error("synthetic audit append failure");
          }
          const appended = appendAuditRecord(ledger, event);
          ledger = appended.ledger;
          if (appendCalls === 1 && failurePoint === "after-ledger-write") {
            throw new Error("synthetic audit append failure");
          }
          return appended.record;
        }
      };

      await assert.rejects(
        importGoldenSample(dependencies),
        /synthetic audit append failure/u
      );
      assert.equal(writes, 1);
      assert.equal(stored.system.importAuditOutbox.status, "pending");
      assert.equal(
        ledger.records.length,
        failurePoint === "after-ledger-write" ? 1 : 0
      );

      await assert.rejects(
        importGoldenSample(dependencies),
        (error) => error.code === "golden_episode_already_exists" &&
          error.statusCode === 409
      );
      assert.equal(writes, 2);
      assert.equal(stored.system.importAuditOutbox.status, "delivered");
      assert.equal(ledger.records.length, 1);
      assert.equal(ledger.records[0].eventId, GOLDEN_IMPORT_AUDIT_EVENT_ID);
      assert.equal(ledger.records[0].idempotencyKey, GOLDEN_IMPORT_AUDIT_EVENT_ID);
      assert.equal(ledger.records[0].type, "episode.imported");

      const callsAfterRecovery = { writes, appendCalls };
      await assert.rejects(
        importGoldenSample(dependencies),
        (error) => error.code === "golden_episode_already_exists" &&
          error.statusCode === 409
      );
      assert.deepEqual({ writes, appendCalls }, callsAfterRecovery);
      assert.equal(ledger.records.length, 1);
    });
  }
});

test("被篡改的 import audit outbox 不会触发伪造事件或状态写入", async () => {
  const seeded = (await importGoldenSample({
    persist: false,
    readConfig: async () => syntheticConfig(),
    fileRecord: syntheticFileRecord()
  })).episode;
  seeded.system.importAuditOutbox.actor = "human:forged-audit-actor";
  let writes = 0;
  let events = 0;
  await assert.rejects(
    importGoldenSample({
      readEpisode: async () => structuredClone(seeded),
      writeEpisode: async () => {
        writes += 1;
      },
      appendEvent: async () => {
        events += 1;
      }
    }),
    (error) => error.code === "golden_seed_audit_outbox_invalid" &&
      error.statusCode === 409
  );
  assert.equal(writes, 0);
  assert.equal(events, 0);
});

test("已有 Golden Episode 时即使请求 reset 也 409，且零配置、复制、写入和事件", async () => {
  const existing = await readFixtureEpisode();
  const existingBefore = structuredClone(existing);
  const calls = {
    readConfig: 0,
    mkdir: 0,
    copyFile: 0,
    fileRecord: 0,
    writeEpisode: 0,
    appendEvent: 0
  };
  await assert.rejects(
    importGoldenSample({
      reset: true,
      readEpisode: async () => existing,
      readConfig: async () => {
        calls.readConfig += 1;
        return {};
      },
      mkdir: async () => {
        calls.mkdir += 1;
      },
      copyFile: async () => {
        calls.copyFile += 1;
      },
      fileRecord: async () => {
        calls.fileRecord += 1;
        return null;
      },
      writeEpisode: async () => {
        calls.writeEpisode += 1;
      },
      appendEvent: async () => {
        calls.appendEvent += 1;
      }
    }),
    (error) => error.code === "golden_episode_already_exists" &&
      error.statusCode === 409
  );
  assert.deepEqual(calls, {
    readConfig: 0,
    mkdir: 0,
    copyFile: 0,
    fileRecord: 0,
    writeEpisode: 0,
    appendEvent: 0
  });
  assert.deepEqual(existing, existingBefore);
});

test("HTTP Golden seed 无鉴权时零调用，短期 session 成功后仍停在 research Gate", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "acs-importer-http-"));
  let importedEpisode = null;
  let importerCalls = 0;
  const events = [];
  const created = await createStudioServer({
    recoverOnStart: false,
    operatorActor: "human:golden-seed-reviewer",
    operatorToken: OPERATOR_TOKEN,
    capabilitySecret: CAPABILITY_SECRET,
    readEpisode: async () => structuredClone(importedEpisode ?? await readFixtureEpisode()),
    importGoldenSample: async (routeOptions) => {
      importerCalls += 1;
      return importGoldenSample({
        ...routeOptions,
        readConfig: async () => syntheticConfig(),
        fileRecord: syntheticFileRecord(),
        readEpisode: async () => {
          if (importedEpisode) return structuredClone(importedEpisode);
          throw missingEpisode();
        },
        writeEpisode: async (episode) => {
          importedEpisode = structuredClone(episode);
          importedEpisode.control.stateVersion += 1;
          episode.control.stateVersion = importedEpisode.control.stateVersion;
          return resolve(temporaryRoot, "episode.json");
        },
        appendEvent: async (event) => {
          events.push(structuredClone(event));
          return structuredClone(event);
        },
        episodePublicDirectory: (episodeId) =>
          resolve(temporaryRoot, "public", "episodes", episodeId)
      });
    }
  });
  const { server, config, operatorUnlockCode } = created;
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const origin = `http://127.0.0.1:${config.port}`;

    const unauthenticated = await fetch(`${base}/api/import/golden`, {
      method: "POST",
      headers: { origin }
    });
    assert.equal(unauthenticated.status, 403);
    assert.equal(importerCalls, 0);

    const unlocked = await fetch(`${base}/api/operator/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ unlockCode: operatorUnlockCode })
    });
    assert.equal(unlocked.status, 201);
    const sessionCookie = /acs_operator_session=([^;,]+)/u.exec(
      unlocked.headers.get("set-cookie") ?? ""
    )?.[1];
    const session = await unlocked.json();
    const seeded = await fetch(`${base}/api/import/golden`, {
      method: "POST",
      headers: {
        origin,
        cookie: `acs_operator_session=${sessionCookie}`,
        "x-operator-csrf": session.csrfToken
      }
    });
    assert.equal(seeded.status, 201);
    const body = await seeded.json();
    assert.equal(body.episode.approvals.research.status, "pending");
    assert.equal(body.episode.approvals.script.status, "pending");
    assert.equal(body.episode.approvals.storyboard.status, "pending");
    assert.equal(body.episode.pipeline.find((step) => step.id === "research").status,
      "waiting_approval");
    assert.equal(importerCalls, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].actor, "human:golden-seed-reviewer");
    assert.equal(events[0].eventId, GOLDEN_IMPORT_AUDIT_EVENT_ID);
    assert.equal(events[0].idempotencyKey, GOLDEN_IMPORT_AUDIT_EVENT_ID);
    assert.equal(body.episode.system.importAuditOutbox.status, "delivered");

    const stateVersionBeforeRepeat = importedEpisode.control.stateVersion;
    const repeated = await fetch(`${base}/api/import/golden`, {
      method: "POST",
      headers: {
        origin,
        cookie: `acs_operator_session=${sessionCookie}`,
        "x-operator-csrf": session.csrfToken
      }
    });
    assert.equal(repeated.status, 409);
    assert.equal((await repeated.json()).code, "golden_episode_already_exists");
    assert.equal(events.length, 1);
    assert.equal(importedEpisode.control.stateVersion, stateVersionBeforeRepeat);
  } finally {
    await closeServer(server);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
