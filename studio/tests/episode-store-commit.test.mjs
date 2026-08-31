import test from "node:test";
import assert from "node:assert/strict";
import { createEpisodeWriter } from "../src/shared/episode-store-writer.mjs";
import { readFixtureEpisode } from "./episode-fixture.mjs";
import {
  createEpisodeWriterHarness
} from "./helpers/episode-store-writer-harness.mjs";

function testWriter(
  writeVersionedJson,
  observerOptions = null,
  now = () => "2026-08-31T12:00:00.000Z"
) {
  return createEpisodeWriterHarness({
    mkdir: async () => undefined,
    episodeDataDirectory: (episodeId) => `/isolated/${episodeId}`,
    episodeDataPath: (episodeId) => `/isolated/${episodeId}/episode.json`,
    writeVersionedJson,
    now
  }, observerOptions);
}

test("正式 Episode writer 直接导入时在任何 I/O 前拒绝 observer 注入", async () => {
  const writer = createEpisodeWriter();
  let episodeReads = 0;
  let observerGetterReads = 0;
  const episode = Object.defineProperty({}, "id", {
    get() {
      episodeReads += 1;
      return "must-not-be-read";
    }
  });
  const options = Object.defineProperty({}, "onCommitResult", {
    get() {
      observerGetterReads += 1;
      return async () => undefined;
    }
  });

  await assert.rejects(
    writer.writeEpisode(episode, options),
    /does not accept commit observer injection/u
  );
  assert.equal(episodeReads, 0);
  assert.equal(observerGetterReads, 0);
  assert.throws(
    () => createEpisodeWriter({ mkdir: async () => undefined }),
    /does not accept dependency injection/u
  );
});

test("writeEpisode 保持字符串返回值并传播不可变的 committed_with_warnings", async () => {
  const episode = await readFixtureEpisode();
  const observed = [];
  const writer = testWriter(async (destination, value, options) => {
    const next = structuredClone(value);
    options.setVersion(next, 4);
    return {
      destination,
      value: next,
      version: 4,
      commitStatus: "committed_with_warnings",
      commitWarnings: [{
        stage: "directory_sync",
        code: "EIO",
        message: "token=should-not-leak directory sync failed"
      }]
    };
  }, {
    onCommitResult: async (snapshot) => observed.push(snapshot)
  });

  const destination = await writer.writeEpisode(episode);

  assert.equal(destination, "/isolated/golden-001/episode.json");
  assert.equal(episode.control.stateVersion, 4);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].commitStatus, "committed_with_warnings");
  assert.equal(observed[0].warningCount, 1);
  assert.equal(observed[0].commitWarnings[0].stage, "directory_sync");
  assert.doesNotMatch(observed[0].commitWarnings[0].message, /should-not-leak/u);
  assert.equal(Object.isFrozen(observed[0]), true);
  assert.equal(Object.isFrozen(observed[0].commitWarnings), true);
  assert.equal(Object.isFrozen(observed[0].commitWarnings[0]), true);

  const firstRead = writer.readEpisodeCommitStatus("golden-001");
  assert.deepEqual(firstRead, observed[0]);
  assert.notEqual(firstRead, observed[0]);
  assert.throws(() => {
    firstRead.commitWarnings[0].code = "mutated";
  }, TypeError);
  assert.equal(
    writer.readEpisodeCommitStatus("golden-001").commitWarnings[0].code,
    "EIO"
  );
});

test("commit observer 失败不会把已提交 Episode 转为失败", async () => {
  const episode = await readFixtureEpisode();
  const writer = testWriter(async (destination, value) => ({
    destination,
    value,
    version: 7,
    commitStatus: "committed",
    commitWarnings: []
  }), {
    onCommitResult: async () => {
      const error = new Error("secret=observer-token observer unavailable");
      error.code = "observer_down";
      throw error;
    }
  });

  const destination = await writer.writeEpisode(episode);

  assert.equal(destination, "/isolated/golden-001/episode.json");
  assert.equal(episode.control.stateVersion, 7);
  const status = writer.readEpisodeCommitStatus("golden-001");
  assert.equal(status.commitStatus, "committed");
  assert.equal(status.warningCount, 0);
  assert.equal(status.observer.status, "failed");
  assert.equal(status.observer.warnings[0].code, "episode_commit_observer_failed");
  assert.doesNotMatch(status.observer.warnings[0].message, /observer-token/u);
});

test("commit observer getter 抛错也不会掩盖已提交成功", async () => {
  const episode = await readFixtureEpisode();
  const options = Object.defineProperty({}, "onCommitResult", {
    get() {
      throw new Error("observer getter failed");
    }
  });
  const writer = testWriter(async (destination, value) => ({
    destination,
    value,
    version: 8,
    commitStatus: "committed",
    commitWarnings: []
  }), options);

  await assert.doesNotReject(writer.writeEpisode(episode));
  const status = writer.readEpisodeCommitStatus("golden-001");
  assert.equal(status.stateVersion, 8);
  assert.equal(status.commitStatus, "committed");
  assert.equal(status.observer.status, "failed");
});

test("调用方 Episode 不可变时提交仍成功且传播失败可观察", async () => {
  const episode = await readFixtureEpisode();
  Object.freeze(episode.control);
  const writer = testWriter(async (destination, value) => ({
    destination,
    value,
    version: 9,
    commitStatus: "committed",
    commitWarnings: []
  }));

  await assert.doesNotReject(writer.writeEpisode(episode));
  const status = writer.readEpisodeCommitStatus("golden-001");
  assert.equal(status.stateVersion, 9);
  assert.equal(status.commitStatus, "committed");
  assert.equal(status.propagation.status, "failed");
  assert.equal(
    status.propagation.warnings[0].code,
    "episode_state_version_update_failed"
  );
});

test("较慢的旧版本完成不会覆盖较新的 Episode commit 状态", async () => {
  let releaseOlder;
  const olderPending = new Promise((resolve) => {
    releaseOlder = resolve;
  });
  const writer = testWriter(async (destination, value) => {
    if (value.control.stateVersion === 3) await olderPending;
    const version = value.control.stateVersion + 1;
    return {
      destination,
      value,
      version,
      commitStatus: version === 4 ? "committed_with_warnings" : "committed",
      commitWarnings: version === 4
        ? [{ stage: "lock_release", code: "stale-warning", message: "older" }]
        : []
    };
  });
  const olderEpisode = await readFixtureEpisode();
  olderEpisode.control.stateVersion = 3;
  const newerEpisode = structuredClone(olderEpisode);
  newerEpisode.control.stateVersion = 4;

  const olderWrite = writer.writeEpisode(olderEpisode);
  await writer.writeEpisode(newerEpisode);
  releaseOlder();
  await olderWrite;

  const status = writer.readEpisodeCommitStatus("golden-001");
  assert.equal(status.stateVersion, 5);
  assert.equal(status.commitStatus, "committed");
  assert.equal(status.warningCount, 0);
});
