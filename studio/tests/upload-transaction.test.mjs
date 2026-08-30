import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createStudioServer } from "../src/server/app.mjs";
import { saveAssetUpload } from "../src/server/production/assets.mjs";
import { saveVoiceUpload } from "../src/server/production/voice.mjs";
import {
  recoverPendingUploadTransactions,
  stageExclusiveVersionedUpload
} from
  "../src/server/production/upload-transaction.mjs";
import { readFixtureEpisode } from "./episode-fixture.mjs";

function assetUploadEpisode(source) {
  const episode = structuredClone(source);
  episode.production.assetPlan = {
    version: 1,
    needsRevision: false,
    content: {
      items: [{
        id: "transaction-test-item",
        required: true,
        assetType: "screenshot",
        sceneIds: []
      }]
    }
  };
  episode.reviewCheckpoints.assetExecution = null;
  return episode;
}

function stateConflict() {
  const error = new Error("synthetic Episode CAS conflict");
  error.code = "state_version_conflict";
  error.statusCode = 409;
  return error;
}

function pngFixture(label) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label, "utf8")
  ]);
}

function mp3Fixture(label) {
  return Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]),
    Buffer.from(label, "utf8")
  ]);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function uploadRights(kind = "asset") {
  return {
    authorOrSource: kind === "voice" ? "fixture narrator" : "fixture author",
    sourceUrl: null,
    license: "project-original-private-use",
    allowedUse: "private-internal-review",
    attributionRequirements: "none",
    privacyPortraitStatus: kind === "voice"
      ? "consent-recorded"
      : "no-identifiable-person"
  };
}

function receiptFor(event) {
  return { ...structuredClone(event), sequence: 1, hash: "fixture-receipt" };
}

async function isolatedUploadRoots(prefix) {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  const uploadRoot = resolve(root, "public");
  const markerRoot = resolve(root, "private", "pending");
  const quarantineRoot = resolve(root, "private", "quarantine");
  await Promise.all([
    mkdir(uploadRoot, { recursive: true }),
    mkdir(markerRoot, { recursive: true }),
    mkdir(quarantineRoot, { recursive: true })
  ]);
  return { root, uploadRoot, markerRoot, quarantineRoot };
}

test("素材上传发生 Episode CAS 冲突时删除自己发布的文件和临时文件", async () => {
  const roots = await isolatedUploadRoots("acs-asset-upload-cas-");
  const source = assetUploadEpisode(await readFixtureEpisode());
  try {
    await assert.rejects(
      saveAssetUpload(source.id, {
        fileName: "fixture.png",
        contentType: "image/png",
        planItemId: "transaction-test-item",
        source: "human-upload",
        data: pngFixture("synthetic-png-fixture"),
        rights: uploadRights()
      }, {
        readEpisode: async () => structuredClone(source),
        writeEpisode: async () => {
          throw stateConflict();
        },
        appendEvent: async () => {
          throw new Error("CAS 失败后不应记录事件");
        },
        episodePublicDirectory: (episodeId) =>
          resolve(roots.uploadRoot, "episodes", episodeId),
        inspectMedia: async () => ({ kind: "image" }),
        uploadRoot: roots.uploadRoot,
        uploadTransactionRoot: roots.markerRoot,
        actor: "human:fixture-operator"
      }),
      (error) => error.code === "state_version_conflict"
    );
    const directory = resolve(roots.uploadRoot, "episodes", source.id, "materials");
    assert.deepEqual(await readdir(directory), []);
    assert.deepEqual(await readdir(roots.markerRoot), []);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("两个并发素材上传只有 Episode CAS 胜者保留文件，败者不覆盖也不留孤儿", async () => {
  const roots = await isolatedUploadRoots("acs-asset-upload-race-");
  let stored = assetUploadEpisode(await readFixtureEpisode());
  let events = 0;
  const dependencies = {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (next) => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 15));
      if (next.control.stateVersion !== stored.control.stateVersion) throw stateConflict();
      const committed = structuredClone(next);
      committed.control.stateVersion += 1;
      next.control.stateVersion = committed.control.stateVersion;
      stored = committed;
    },
    appendEvent: async (event) => {
      events += 1;
      return receiptFor(event);
    },
    episodePublicDirectory: (episodeId) =>
      resolve(roots.uploadRoot, "episodes", episodeId),
    inspectMedia: async () => ({ kind: "image" }),
    uploadRoot: roots.uploadRoot,
    uploadTransactionRoot: roots.markerRoot,
    actor: "human:fixture-operator"
  };
  const upload = (label) => saveAssetUpload(stored.id, {
    fileName: `${label}.png`,
    contentType: "image/png",
    planItemId: "transaction-test-item",
    source: "human-upload",
    data: pngFixture(`synthetic-png-${label}`),
    rights: uploadRights()
  }, dependencies);
  try {
    const results = await Promise.allSettled([upload("first"), upload("second")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(results.find((result) => result.status === "rejected").reason.code,
      "state_version_conflict");
    const files = await readdir(
      resolve(roots.uploadRoot, "episodes", stored.id, "materials")
    );
    assert.equal(files.length, 1);
    assert.match(files[0], /^material-v\d{3}\.png$/u);
    assert.equal(files.some((file) => file.endsWith(".tmp")), false);
    assert.equal(stored.assets.some((asset) => asset.path.endsWith(files[0])), true);
    assert.equal(events, 1);
    assert.deepEqual(await readdir(roots.markerRoot), []);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("旁白上传发生 Episode CAS 冲突时同样不留下可被误认的音频版本", async () => {
  const roots = await isolatedUploadRoots("acs-voice-upload-cas-");
  const source = await readFixtureEpisode();
  try {
    await assert.rejects(
      saveVoiceUpload(source.id, {
        fileName: "fixture.mp3",
        contentType: "audio/mpeg",
        data: mp3Fixture("synthetic-mp3-fixture"),
        rights: uploadRights("voice")
      }, {
        readEpisode: async () => structuredClone(source),
        writeEpisode: async () => {
          throw stateConflict();
        },
        appendEvent: async () => {
          throw new Error("CAS 失败后不应记录事件");
        },
        episodePublicDirectory: (episodeId) =>
          resolve(roots.uploadRoot, "episodes", episodeId),
        inspectMedia: async () => ({ kind: "audio" }),
        uploadRoot: roots.uploadRoot,
        uploadTransactionRoot: roots.markerRoot,
        workspaceRelativePath: (path) => `test/${path.split("/").at(-1)}`,
        actor: "human:fixture-operator"
      }),
      (error) => error.code === "state_version_conflict"
    );
    assert.deepEqual(
      await readdir(resolve(roots.uploadRoot, "episodes", source.id)),
      []
    );
    assert.deepEqual(await readdir(roots.markerRoot), []);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("进程在 final 发布后、Episode CAS 前崩溃，启动恢复移除公开孤儿并隔离 marker", async () => {
  const roots = await isolatedUploadRoots("acs-upload-crash-recovery-");
  const source = await readFixtureEpisode();
  try {
    const staged = await stageExclusiveVersionedUpload({
      allowedRoot: roots.uploadRoot,
      directory: resolve(roots.uploadRoot, "episodes", source.id),
      data: mp3Fixture("crash-before-episode-cas"),
      nextFileName: () => "voice-v099.mp3",
      transaction: {
        markerRoot: roots.markerRoot,
        episodeId: source.id,
        kind: "voice",
        publicPathForFileName: (fileName) => `episodes/${source.id}/${fileName}`
      }
    });
    await access(staged.destination);
    assert.equal((await readdir(roots.markerRoot)).length, 1);

    const recovered = await recoverPendingUploadTransactions({
      markerRoot: roots.markerRoot,
      quarantineRoot: roots.quarantineRoot,
      allowedRoot: roots.uploadRoot,
      listEpisodes: async () => [structuredClone(source)],
      isProcessAlive: async () => false
    });
    assert.deepEqual(recovered, {
      pendingCount: 1,
      committedCount: 0,
      quarantinedCount: 1,
      removedFinalCount: 1,
      detachedMarkerCount: 0,
      quarantinedStagingCount: 0
    });
    await assert.rejects(access(staged.destination), (error) => error.code === "ENOENT");
    assert.deepEqual(await readdir(roots.markerRoot), []);
    assert.equal((await readdir(roots.quarantineRoot)).length, 1);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("Episode 已提交引用时，启动恢复只清 marker 并保留 final", async () => {
  const roots = await isolatedUploadRoots("acs-upload-committed-recovery-");
  const source = await readFixtureEpisode();
  try {
    const data = mp3Fixture("committed-before-marker-cleanup");
    const staged = await stageExclusiveVersionedUpload({
      allowedRoot: roots.uploadRoot,
      directory: resolve(roots.uploadRoot, "episodes", source.id),
      data,
      nextFileName: () => "voice-v098.mp3",
      transaction: {
        markerRoot: roots.markerRoot,
        episodeId: source.id,
        kind: "voice",
        publicPathForFileName: (fileName) => `episodes/${source.id}/${fileName}`
      }
    });
    const committed = structuredClone(source);
    committed.voice = {
      ...(committed.voice ?? {}),
      publicPath: `episodes/${source.id}/${staged.fileName}`,
      bytes: data.length,
      sha256: sha256(data)
    };
    const recovered = await recoverPendingUploadTransactions({
      markerRoot: roots.markerRoot,
      quarantineRoot: roots.quarantineRoot,
      allowedRoot: roots.uploadRoot,
      listEpisodes: async () => [committed],
      isProcessAlive: async () => false,
      appendEvent: async (event) => receiptFor(event)
    });
    assert.equal(recovered.committedCount, 1);
    assert.equal(recovered.removedFinalCount, 0);
    await access(staged.destination);
    assert.deepEqual(await readdir(roots.markerRoot), []);
    assert.deepEqual(await readdir(roots.quarantineRoot), []);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("素材上传在 Episode 提交后审计失败时保留 outbox，重试不会产生第二个版本，启动可幂等补账", async () => {
  const roots = await isolatedUploadRoots("acs-asset-audit-outbox-");
  let stored = assetUploadEpisode(await readFixtureEpisode());
  let auditAttempts = 0;
  let writes = 0;
  const data = pngFixture("audit-outbox-asset");
  const upload = {
    fileName: "audit-outbox.png",
    contentType: "image/png",
    planItemId: "transaction-test-item",
    source: "human-upload",
    data,
    rights: uploadRights()
  };
  const dependencies = {
    readEpisode: async () => structuredClone(stored),
    writeEpisode: async (next) => {
      if (next.control.stateVersion !== stored.control.stateVersion) throw stateConflict();
      const committed = structuredClone(next);
      committed.control.stateVersion += 1;
      next.control.stateVersion = committed.control.stateVersion;
      stored = committed;
      writes += 1;
    },
    appendEvent: async () => {
      auditAttempts += 1;
      throw new Error("synthetic upload audit failure");
    },
    episodePublicDirectory: (episodeId) =>
      resolve(roots.uploadRoot, "episodes", episodeId),
    inspectMedia: async () => ({ kind: "image" }),
    uploadRoot: roots.uploadRoot,
    uploadTransactionRoot: roots.markerRoot,
    actor: "human:fixture-operator"
  };
  try {
    await assert.rejects(
      saveAssetUpload(stored.id, upload, dependencies),
      /synthetic upload audit failure/u
    );
    assert.equal(writes, 1);
    assert.equal(auditAttempts, 1);
    assert.equal(stored.assets.at(-1).sha256, sha256(data));
    assert.equal((await readdir(roots.markerRoot)).length, 1);
    assert.equal((await readdir(
      resolve(roots.uploadRoot, "episodes", stored.id, "materials")
    )).length, 1);

    await assert.rejects(
      saveAssetUpload(stored.id, upload, dependencies),
      (error) => error.code === "upload_recovery_required" && error.statusCode === 503
    );
    assert.equal(writes, 1);
    assert.equal((await readdir(
      resolve(roots.uploadRoot, "episodes", stored.id, "materials")
    )).length, 1);

    const delivered = [];
    const recovered = await recoverPendingUploadTransactions({
      markerRoot: roots.markerRoot,
      quarantineRoot: roots.quarantineRoot,
      allowedRoot: roots.uploadRoot,
      listEpisodes: async () => [structuredClone(stored)],
      isProcessAlive: async () => false,
      appendEvent: async (event) => {
        delivered.push(structuredClone(event));
        return receiptFor(event);
      }
    });
    assert.equal(recovered.committedCount, 1);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].type, "asset.uploaded");
    assert.equal(delivered[0].artifact.sha256, sha256(data));
    assert.deepEqual(await readdir(roots.markerRoot), []);
    assert.equal((await readdir(
      resolve(roots.uploadRoot, "episodes", stored.id, "materials")
    )).length, 1);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("旁白上传的审计失败同样保留可恢复 outbox", async () => {
  const roots = await isolatedUploadRoots("acs-voice-audit-outbox-");
  let stored = await readFixtureEpisode();
  const data = mp3Fixture("audit-outbox-voice");
  try {
    await assert.rejects(
      saveVoiceUpload(stored.id, {
        fileName: "audit-outbox.mp3",
        contentType: "audio/mpeg",
        data,
        rights: uploadRights("voice")
      }, {
        readEpisode: async () => structuredClone(stored),
        writeEpisode: async (next) => {
          const committed = structuredClone(next);
          committed.control.stateVersion += 1;
          next.control.stateVersion = committed.control.stateVersion;
          stored = committed;
        },
        appendEvent: async () => {
          throw new Error("synthetic voice audit failure");
        },
        episodePublicDirectory: (episodeId) =>
          resolve(roots.uploadRoot, "episodes", episodeId),
        inspectMedia: async () => ({ kind: "audio" }),
        uploadRoot: roots.uploadRoot,
        uploadTransactionRoot: roots.markerRoot,
        workspaceRelativePath: (path) => `test/${path.split("/").at(-1)}`,
        actor: "human:fixture-operator"
      }),
      /synthetic voice audit failure/u
    );
    assert.equal(stored.voice.sha256, sha256(data));
    assert.equal((await readdir(roots.markerRoot)).length, 1);
    const events = [];
    const recovered = await recoverPendingUploadTransactions({
      markerRoot: roots.markerRoot,
      quarantineRoot: roots.quarantineRoot,
      allowedRoot: roots.uploadRoot,
      listEpisodes: async () => [structuredClone(stored)],
      isProcessAlive: async () => false,
      appendEvent: async (event) => {
        events.push(structuredClone(event));
        return receiptFor(event);
      }
    });
    assert.equal(recovered.committedCount, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "voice.uploaded");
    assert.deepEqual(await readdir(roots.markerRoot), []);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("启动恢复无法列出 Episode 时 fail closed，公开文件和 marker 均不改动", async () => {
  const roots = await isolatedUploadRoots("acs-upload-list-failure-");
  const source = await readFixtureEpisode();
  try {
    const staged = await stageExclusiveVersionedUpload({
      allowedRoot: roots.uploadRoot,
      directory: resolve(roots.uploadRoot, "episodes", source.id),
      data: mp3Fixture("list-unavailable"),
      nextFileName: () => "voice-v097.mp3",
      transaction: {
        markerRoot: roots.markerRoot,
        episodeId: source.id,
        kind: "voice",
        publicPathForFileName: (fileName) => `episodes/${source.id}/${fileName}`
      }
    });
    await assert.rejects(
      createStudioServer({
        readEpisode: async () => structuredClone(source),
        uploadRecovery: {
          markerRoot: roots.markerRoot,
          quarantineRoot: roots.quarantineRoot,
          allowedRoot: roots.uploadRoot,
          isProcessAlive: async () => false,
          listEpisodes: async () => {
            throw new Error("synthetic Episode listing outage");
          }
        }
      }),
      (error) => error.code === "upload_recovery_episode_list_unavailable" &&
        error.statusCode === 503
    );
    await access(staged.destination);
    assert.equal((await readdir(roots.markerRoot)).length, 1);
    assert.deepEqual(await readdir(roots.quarantineRoot), []);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("marker 前崩溃只留下私有 staging，启动恢复将其移入私有隔离区", async () => {
  const roots = await isolatedUploadRoots("acs-upload-pre-marker-crash-");
  const stagingRoot = resolve(roots.markerRoot, "..", "staging");
  try {
    await mkdir(stagingRoot, { recursive: true });
    await writeFile(
      resolve(stagingRoot, ".upload-deadbeef.tmp"),
      Buffer.from("private-staging-only", "utf8")
    );
    assert.deepEqual(await readdir(roots.uploadRoot), []);

    const recovered = await recoverPendingUploadTransactions({
      markerRoot: roots.markerRoot,
      quarantineRoot: roots.quarantineRoot,
      allowedRoot: roots.uploadRoot,
      listEpisodes: async () => {
        throw new Error("没有 marker 时不应读取 Episode");
      }
    });
    assert.equal(recovered.pendingCount, 0);
    assert.equal(recovered.quarantinedStagingCount, 1);
    assert.deepEqual(await readdir(stagingRoot), []);
    assert.equal((await readdir(roots.quarantineRoot)).length, 1);
    assert.deepEqual(await readdir(roots.uploadRoot), []);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("Episode 已引用但 final 丢失时启动 fail closed 并保留 marker", async () => {
  const roots = await isolatedUploadRoots("acs-upload-committed-missing-");
  const source = await readFixtureEpisode();
  const data = mp3Fixture("committed-final-missing");
  try {
    const staged = await stageExclusiveVersionedUpload({
      allowedRoot: roots.uploadRoot,
      directory: resolve(roots.uploadRoot, "episodes", source.id),
      data,
      nextFileName: () => "voice-v096.mp3",
      transaction: {
        markerRoot: roots.markerRoot,
        episodeId: source.id,
        kind: "voice",
        publicPathForFileName: (fileName) => `episodes/${source.id}/${fileName}`
      }
    });
    const committed = structuredClone(source);
    committed.voice = {
      ...(committed.voice ?? {}),
      publicPath: `episodes/${source.id}/${staged.fileName}`,
      bytes: data.length,
      sha256: sha256(data)
    };
    await rm(staged.destination);

    await assert.rejects(
      recoverPendingUploadTransactions({
        markerRoot: roots.markerRoot,
        quarantineRoot: roots.quarantineRoot,
        allowedRoot: roots.uploadRoot,
        listEpisodes: async () => [committed],
        isProcessAlive: async () => false
      }),
      (error) => error.code === "upload_recovery_committed_integrity_invalid" &&
        error.statusCode === 503
    );
    assert.equal((await readdir(roots.markerRoot)).length, 1);
    assert.deepEqual(await readdir(roots.quarantineRoot), []);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("Episode 已引用但 final 字节被替换时启动 fail closed 并保留 marker", async () => {
  const roots = await isolatedUploadRoots("acs-upload-committed-tampered-");
  const source = await readFixtureEpisode();
  const data = mp3Fixture("committed-final-tampered");
  try {
    const staged = await stageExclusiveVersionedUpload({
      allowedRoot: roots.uploadRoot,
      directory: resolve(roots.uploadRoot, "episodes", source.id),
      data,
      nextFileName: () => "voice-v095.mp3",
      transaction: {
        markerRoot: roots.markerRoot,
        episodeId: source.id,
        kind: "voice",
        publicPathForFileName: (fileName) => `episodes/${source.id}/${fileName}`
      }
    });
    const committed = structuredClone(source);
    committed.voice = {
      ...(committed.voice ?? {}),
      publicPath: `episodes/${source.id}/${staged.fileName}`,
      bytes: data.length,
      sha256: sha256(data)
    };
    const tampered = Buffer.from(data);
    tampered[tampered.length - 1] ^= 0xff;
    await writeFile(staged.destination, tampered);

    await assert.rejects(
      recoverPendingUploadTransactions({
        markerRoot: roots.markerRoot,
        quarantineRoot: roots.quarantineRoot,
        allowedRoot: roots.uploadRoot,
        listEpisodes: async () => [committed],
        isProcessAlive: async () => false
      }),
      (error) => error.code === "upload_recovery_committed_integrity_invalid"
    );
    await access(staged.destination);
    assert.equal((await readdir(roots.markerRoot)).length, 1);
    assert.deepEqual(await readdir(roots.quarantineRoot), []);
  } finally {
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("活跃上传持有共享锁时，另一 server 的启动恢复 fail closed 且不删除 final", async () => {
  const roots = await isolatedUploadRoots("acs-upload-active-lock-");
  const source = await readFixtureEpisode();
  let staged;
  try {
    staged = await stageExclusiveVersionedUpload({
      allowedRoot: roots.uploadRoot,
      directory: resolve(roots.uploadRoot, "episodes", source.id),
      data: mp3Fixture("active-transaction"),
      nextFileName: () => "voice-v094.mp3",
      transaction: {
        markerRoot: roots.markerRoot,
        episodeId: source.id,
        kind: "voice",
        publicPathForFileName: (fileName) => `episodes/${source.id}/${fileName}`
      }
    });
    await assert.rejects(
      recoverPendingUploadTransactions({
        markerRoot: roots.markerRoot,
        quarantineRoot: roots.quarantineRoot,
        allowedRoot: roots.uploadRoot,
        listEpisodes: async () => [structuredClone(source)]
      }),
      (error) => error.code === "upload_transaction_lock_busy" &&
        error.statusCode === 503
    );
    await access(staged.destination);
    assert.equal((await readdir(roots.markerRoot)).length, 1);
    assert.deepEqual(await readdir(roots.quarantineRoot), []);
    await staged.rollback();
    staged = null;
  } finally {
    if (staged) await staged.rollback().catch(() => undefined);
    await rm(roots.root, { recursive: true, force: true });
  }
});

test("上传事务拒绝通过目录 symlink 把文件发布到允许根之外", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "acs-upload-boundary-"));
  const outside = await mkdtemp(resolve(tmpdir(), "acs-upload-outside-"));
  try {
    await symlink(outside, resolve(root, "escape"));
    await assert.rejects(
      stageExclusiveVersionedUpload({
        allowedRoot: root,
        directory: resolve(root, "escape"),
        data: Buffer.from("must-not-escape"),
        nextFileName: () => "voice-v001.wav"
      }),
      (error) => error.code === "path_boundary_forbidden"
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
