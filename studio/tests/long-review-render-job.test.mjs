import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, relative, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  LONG_REVIEW_RENDER_JOB_SCHEMA_VERSION,
  LONG_REVIEW_RENDER_JOB_LOCK_FILE,
  acquireLongReviewRenderJobLock,
  assertLongReviewRenderJobFilesystemSafety,
  isUnsupportedLongReviewDirectorySyncError,
  syncLongReviewRenderDirectory,
  syncLongReviewRenderFile,
  captureContentAwareGitIdentity,
  longReviewSourceInputs,
  parseLongReviewRenderCliArguments,
  validateLongReviewRenderJob
} from "../src/server/production/long-render-job.mjs";

const execFileAsync = promisify(execFile);

const LONG_RENDER_JOB_MODULE_URL = new URL(
  "../src/server/production/long-render-job.mjs",
  import.meta.url
).href;
const PARENT_CRASH_FIXTURE = resolve(
  import.meta.dirname,
  "helpers",
  "long-review-parent-crash-fixture.mjs"
);

async function readJsonLine(stream, timeoutMs = 10_000) {
  return new Promise((resolveLine, rejectLine) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      cleanup();
      rejectLine(new Error("timed out waiting for fixture JSON line"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      stream.off("data", handleData);
      stream.off("error", handleError);
      stream.off("end", handleEnd);
    };
    const handleError = (error) => {
      cleanup();
      rejectLine(error);
    };
    const handleEnd = () => {
      cleanup();
      rejectLine(new Error("fixture stdout ended before JSON line"));
    };
    const handleData = (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      cleanup();
      try {
        resolveLine(JSON.parse(buffer.slice(0, newline)));
      } catch (error) {
        rejectLine(error);
      }
    };
    stream.on("data", handleData);
    stream.once("error", handleError);
    stream.once("end", handleEnd);
  });
}

async function waitForProcessExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  return false;
}

function jobFixture(overrides = {}) {
  return {
    schemaVersion: LONG_REVIEW_RENDER_JOB_SCHEMA_VERSION,
    jobId: "agent-skill-current-v008",
    episodeId: "agent-skill-current",
    candidateVersion: 8,
    compositionId: "AgentSkillLongReview",
    width: 1920,
    height: 1080,
    fps: 30,
    durationInFrames: 18_000,
    paths: {
      entryPoint: "studio/src/video/agent-skill-long-review-index.jsx",
      episode: "studio/data/episodes/agent-skill-current/episode.json",
      voice: "studio/public/episodes/agent-skill-current/voice-review.wav",
      finalDirectory:
        "outputs/studio/agent-skill-current/review-candidates/full-video-current-v008",
      workDirectory:
        "outputs/studio/agent-skill-current/review-candidates/.full-video-current-v008-work"
    },
    protectedArtifacts: [],
    temporaryVoice: true,
    temporaryVoiceIsFinalHumanRecording: false,
    ...overrides
  };
}

test("通用长片 CLI 强制显式 job，并默认 20x30 秒与 5 秒片间暂停", () => {
  assert.deepEqual(
    parseLongReviewRenderCliArguments([
      "--job-config",
      "studio/config/render-jobs/current.json"
    ]),
    {
      help: false,
      jobConfigPath: "studio/config/render-jobs/current.json",
      chunkFrames: 900,
      interChunkPauseMs: 5_000
    }
  );
  assert.throws(() => parseLongReviewRenderCliArguments([]), /--job-config/u);
  assert.equal(parseLongReviewRenderCliArguments(["--help"]).help, true);
});

test("workDirectory SQLite 锁拒绝第二进程并在 owner 释放后允许续跑", async () => {
  const workDirectory = await mkdtemp(resolve(tmpdir(), "long-render-lock-"));
  const firstToken = "11111111-1111-4111-8111-111111111111";
  const secondToken = "22222222-2222-4222-8222-222222222222";
  let firstLock = null;

  const runChild = async (expectedResult) => {
    const childScript = `
      const {acquireLongReviewRenderJobLock} = await import(${JSON.stringify(LONG_RENDER_JOB_MODULE_URL)});
      let result;
      try {
        const lock = await acquireLongReviewRenderJobLock(${JSON.stringify(workDirectory)}, {
          jobId: "fixture-v001",
          token: ${JSON.stringify(secondToken)},
          lockTimeoutMs: 100,
          lockRetryDelayMs: 10
        });
        lock.assertOwned();
        lock.release();
        result = "acquired";
      } catch (error) {
        result = error?.code ?? "unknown_error";
      }
      if (result !== ${JSON.stringify(expectedResult)}) {
        throw new Error(\`expected ${expectedResult}, received \${result}\`);
      }
      process.stdout.write(result);
    `;
    return execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", childScript],
      { encoding: "utf8" }
    );
  };

  try {
    firstLock = await acquireLongReviewRenderJobLock(workDirectory, {
      jobId: "fixture-v001",
      token: firstToken
    });
    assert.equal(firstLock.token, firstToken);
    assert.equal(basename(firstLock.databasePath), LONG_REVIEW_RENDER_JOB_LOCK_FILE);
    assert.equal(Object.isFrozen(firstLock), true);
    assert.equal(firstLock.assertOwned(), true);

    const blocked = await runChild("long_review_render_job_locked");
    assert.equal(blocked.stdout, "long_review_render_job_locked");

    assert.equal(firstLock.release(), true);
    firstLock = null;
    const acquired = await runChild("acquired");
    assert.equal(acquired.stdout, "acquired");
  } finally {
    firstLock?.release();
    await rm(workDirectory, { recursive: true, force: true });
  }
});

test("direct import 不暴露低层发布原语，持锁发布能力绑定真实 workDirectory", async () => {
  const lockDirectory = await mkdtemp(resolve(tmpdir(), "long-render-branded-lock-"));
  const outsideDirectory = await mkdtemp(resolve(tmpdir(), "long-render-outside-"));
  const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const videoPartPath = resolve(
    outsideDirectory,
    `chunk-00.part.attempt-${token}.mp4`
  );
  const metadataPartPath = resolve(
    outsideDirectory,
    `chunk-00.metadata.part.attempt-${token}.json`
  );
  const videoPath = resolve(outsideDirectory, "chunk-00.mp4");
  const metadataPath = resolve(outsideDirectory, "chunk-00.metadata.json");
  let lock = null;

  try {
    const productionModule = await import(LONG_RENDER_JOB_MODULE_URL);
    assert.equal(productionModule.publishLongReviewRenderAttemptPair, undefined);
    const fakeLock = { token, assertOwned: () => true };
    assert.equal(fakeLock.publishAttemptPair, undefined);

    lock = await acquireLongReviewRenderJobLock(lockDirectory, {
      jobId: "direct-import-attack-fixture",
      token
    });
    await Promise.all([
      writeFile(videoPartPath, "outside-video", { flag: "wx" }),
      writeFile(metadataPartPath, "outside-metadata", { flag: "wx" })
    ]);
    await assert.rejects(
      lock.publishAttemptPair({
        attemptToken: token,
        videoPartPath,
        videoPath,
        metadataPartPath,
        metadataPath
      }),
      { code: "long_review_render_publish_path_mismatch" }
    );
    await assert.rejects(readFile(videoPath), { code: "ENOENT" });
    await assert.rejects(readFile(metadataPath), { code: "ENOENT" });
    assert.equal(await readFile(videoPartPath, "utf8"), "outside-video");
    assert.equal(await readFile(metadataPartPath, "utf8"), "outside-metadata");
  } finally {
    lock?.release();
    await Promise.all([
      rm(lockDirectory, { recursive: true, force: true }),
      rm(outsideDirectory, { recursive: true, force: true })
    ]);
  }
});

test("持锁发布显式绑定 workDirectory 的固定 chunks 子目录", async () => {
  const workDirectory = await mkdtemp(resolve(tmpdir(), "long-render-nested-publish-"));
  const chunksDirectory = resolve(workDirectory, "chunks");
  const siblingDirectory = resolve(workDirectory, "chunks-sibling");
  const token = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  let lock = null;

  try {
    lock = await acquireLongReviewRenderJobLock(workDirectory, {
      jobId: "nested-publication-fixture",
      token,
      publicationDirectory: chunksDirectory
    });
    assert.equal(lock.publicationDirectory, chunksDirectory);
    const videoPartPath = resolve(
      chunksDirectory,
      `chunk-00.part.attempt-${token}.mp4`
    );
    const metadataPartPath = resolve(
      chunksDirectory,
      `chunk-00.metadata.part.attempt-${token}.json`
    );
    const videoPath = resolve(chunksDirectory, "chunk-00.mp4");
    const metadataPath = resolve(chunksDirectory, "chunk-00.metadata.json");
    await Promise.all([
      writeFile(videoPartPath, "nested-video", {flag: "wx"}),
      writeFile(metadataPartPath, "nested-metadata", {flag: "wx"})
    ]);
    const publication = await lock.publishAttemptPair({
      attemptToken: token,
      videoPartPath,
      videoPath,
      metadataPartPath,
      metadataPath
    });
    assert.deepEqual(publication.durability, {
      durable: true,
      protocol: "file-and-directory-fsync-v1"
    });
    assert.equal(await readFile(videoPath, "utf8"), "nested-video");
    assert.equal(await readFile(metadataPath, "utf8"), "nested-metadata");
    await assert.rejects(readFile(videoPartPath), {code: "ENOENT"});
    await assert.rejects(readFile(metadataPartPath), {code: "ENOENT"});

    await mkdir(siblingDirectory);
    const siblingVideoPartPath = resolve(
      siblingDirectory,
      `chunk-01.part.attempt-${token}.mp4`
    );
    const siblingMetadataPartPath = resolve(
      siblingDirectory,
      `chunk-01.metadata.part.attempt-${token}.json`
    );
    await Promise.all([
      writeFile(siblingVideoPartPath, "sibling-video", {flag: "wx"}),
      writeFile(siblingMetadataPartPath, "sibling-metadata", {flag: "wx"})
    ]);
    await assert.rejects(
      lock.publishAttemptPair({
        attemptToken: token,
        videoPartPath: siblingVideoPartPath,
        videoPath: resolve(siblingDirectory, "chunk-01.mp4"),
        metadataPartPath: siblingMetadataPartPath,
        metadataPath: resolve(siblingDirectory, "chunk-01.metadata.json")
      }),
      {code: "long_review_render_publish_path_mismatch"}
    );
  } finally {
    lock?.release();
    await rm(workDirectory, {recursive: true, force: true});
  }
});

test("publicationDirectory 拒绝 symlink 并在目录被替换后使 owner 失效", async () => {
  const symlinkRoot = await mkdtemp(resolve(tmpdir(), "long-render-publish-symlink-"));
  const outsideDirectory = await mkdtemp(resolve(tmpdir(), "long-render-publish-outside-"));
  const replacementRoot = await mkdtemp(resolve(tmpdir(), "long-render-publish-replace-"));
  const token = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  let lock = null;

  try {
    await assert.rejects(
      acquireLongReviewRenderJobLock(symlinkRoot, {
        jobId: "nested-publication-fixture",
        token,
        publicationDirectory: resolve(symlinkRoot, "chunks", "nested")
      }),
      {code: "long_review_render_job_lock_path_unsafe"}
    );
    await assert.rejects(
      acquireLongReviewRenderJobLock(symlinkRoot, {
        jobId: "prefix-collision-publication-fixture",
        token,
        publicationDirectory: resolve(`${symlinkRoot}-escape`, "chunks")
      }),
      {code: "long_review_render_job_lock_path_unsafe"}
    );

    const linkedChunks = resolve(symlinkRoot, "chunks");
    await symlink(outsideDirectory, linkedChunks, "dir");
    await assert.rejects(
      acquireLongReviewRenderJobLock(symlinkRoot, {
        jobId: "symlink-publication-fixture",
        token,
        publicationDirectory: linkedChunks
      }),
      {code: "long_review_render_job_lock_path_unsafe"}
    );

    const chunksDirectory = resolve(replacementRoot, "chunks");
    const retiredDirectory = resolve(replacementRoot, "retired-chunks");
    lock = await acquireLongReviewRenderJobLock(replacementRoot, {
      jobId: "replacement-publication-fixture",
      token,
      publicationDirectory: chunksDirectory
    });
    await rename(chunksDirectory, retiredDirectory);
    await mkdir(chunksDirectory);
    const videoPartPath = resolve(
      chunksDirectory,
      `chunk-00.part.attempt-${token}.mp4`
    );
    const metadataPartPath = resolve(
      chunksDirectory,
      `chunk-00.metadata.part.attempt-${token}.json`
    );
    await Promise.all([
      writeFile(videoPartPath, "replacement-video", {flag: "wx"}),
      writeFile(metadataPartPath, "replacement-metadata", {flag: "wx"})
    ]);
    await assert.rejects(
      lock.publishAttemptPair({
        attemptToken: token,
        videoPartPath,
        videoPath: resolve(chunksDirectory, "chunk-00.mp4"),
        metadataPartPath,
        metadataPath: resolve(chunksDirectory, "chunk-00.metadata.json")
      }),
      {code: "long_review_render_job_lock_lost"}
    );
  } finally {
    lock?.release();
    await Promise.all([
      rm(symlinkRoot, {recursive: true, force: true}),
      rm(outsideDirectory, {recursive: true, force: true}),
      rm(replacementRoot, {recursive: true, force: true})
    ]);
  }
});

test("workDirectory rename/replacement 后旧 capability 失效且不能向新目录发布", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "long-render-lock-replacement-"));
  const workDirectory = resolve(root, "work");
  const retiredWorkDirectory = resolve(root, "retired-work");
  const oldToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const newToken = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const videoPartPath = resolve(
    workDirectory,
    `chunk-00.part.attempt-${oldToken}.mp4`
  );
  const metadataPartPath = resolve(
    workDirectory,
    `chunk-00.metadata.part.attempt-${oldToken}.json`
  );
  const videoPath = resolve(workDirectory, "chunk-00.mp4");
  const metadataPath = resolve(workDirectory, "chunk-00.metadata.json");
  let oldLock = null;
  let newLock = null;

  try {
    await mkdir(workDirectory);
    oldLock = await acquireLongReviewRenderJobLock(workDirectory, {
      jobId: "old-directory-owner",
      token: oldToken
    });
    await rename(workDirectory, retiredWorkDirectory);
    await mkdir(workDirectory);
    newLock = await acquireLongReviewRenderJobLock(workDirectory, {
      jobId: "replacement-directory-owner",
      token: newToken
    });
    await Promise.all([
      writeFile(videoPartPath, "replacement-video", { flag: "wx" }),
      writeFile(metadataPartPath, "replacement-metadata", { flag: "wx" })
    ]);

    assert.throws(
      () => oldLock.assertOwned(),
      { code: "long_review_render_job_lock_lost" }
    );
    assert.equal(newLock.assertOwned(), true);
    await assert.rejects(
      oldLock.publishAttemptPair({
        attemptToken: oldToken,
        videoPartPath,
        videoPath,
        metadataPartPath,
        metadataPath
      }),
      { code: "long_review_render_job_lock_lost" }
    );
    await assert.rejects(readFile(videoPath), { code: "ENOENT" });
    await assert.rejects(readFile(metadataPath), { code: "ENOENT" });
    assert.equal(await readFile(videoPartPath, "utf8"), "replacement-video");
    assert.equal(
      await readFile(metadataPartPath, "utf8"),
      "replacement-metadata"
    );
    assert.equal(newLock.assertOwned(), true);
  } finally {
    oldLock?.release();
    newLock?.release();
    await rm(root, { recursive: true, force: true });
  }
});

test("parent SIGKILL 后 orphan worker 不发布稳定文件且 successor 可安全接管", async () => {
  const workDirectory = await mkdtemp(resolve(tmpdir(), "long-render-parent-crash-"));
  const oldToken = "33333333-3333-4333-8333-333333333333";
  const successorToken = "44444444-4444-4444-8444-444444444444";
  const stableVideoPath = resolve(workDirectory, "chunk-00.mp4");
  const stableMetadataPath = resolve(workDirectory, "chunk-00.metadata.json");
  const oldVideoPartPath = resolve(
    workDirectory,
    `chunk-00.part.attempt-${oldToken}.mp4`
  );
  const oldMetadataPartPath = resolve(
    workDirectory,
    `chunk-00.metadata.part.attempt-${oldToken}.json`
  );
  const successorVideoPartPath = resolve(
    workDirectory,
    `chunk-00.part.attempt-${successorToken}.mp4`
  );
  const successorMetadataPartPath = resolve(
    workDirectory,
    `chunk-00.metadata.part.attempt-${successorToken}.json`
  );
  let parent = null;
  let workerPid = null;
  let successorLock = null;

  try {
    parent = spawn(
      process.execPath,
      [
        PARENT_CRASH_FIXTURE,
        "parent",
        LONG_RENDER_JOB_MODULE_URL,
        workDirectory,
        oldToken,
        oldVideoPartPath,
        oldMetadataPartPath
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let parentStderr = "";
    parent.stderr.on("data", (chunk) => {
      parentStderr += chunk.toString("utf8");
    });
    const ready = await readJsonLine(parent.stdout);
    workerPid = ready.workerPid;
    assert.equal(ready.parentPid, parent.pid);
    assert.doesNotThrow(() => process.kill(workerPid, 0));

    const parentExit = once(parent, "exit");
    process.kill(parent.pid, "SIGKILL");
    const [exitCode, signal] = await parentExit;
    assert.equal(exitCode, null, parentStderr);
    assert.equal(signal, "SIGKILL", parentStderr);
    assert.equal(await waitForProcessExit(workerPid), true);

    await assert.rejects(readFile(stableVideoPath), { code: "ENOENT" });
    await assert.rejects(readFile(stableMetadataPath), { code: "ENOENT" });
    assert.equal(await readFile(oldVideoPartPath, "utf8"), "orphan-attempt-video");
    assert.equal(
      await readFile(oldMetadataPartPath, "utf8"),
      "orphan-attempt-metadata"
    );

    successorLock = await acquireLongReviewRenderJobLock(workDirectory, {
      jobId: "parent-crash-fixture",
      token: successorToken,
      lockTimeoutMs: 1_000
    });
    await assert.rejects(
      successorLock.publishAttemptPair({
        attemptToken: oldToken,
        videoPartPath: oldVideoPartPath,
        videoPath: stableVideoPath,
        metadataPartPath: oldMetadataPartPath,
        metadataPath: stableMetadataPath
      }),
      { code: "long_review_render_publish_owner_mismatch" }
    );
    await Promise.all([
      writeFile(successorVideoPartPath, "successor-video", { flag: "wx" }),
      writeFile(successorMetadataPartPath, "successor-metadata", { flag: "wx" })
    ]);
    const publication = await successorLock.publishAttemptPair({
      attemptToken: successorToken,
      videoPartPath: successorVideoPartPath,
      videoPath: stableVideoPath,
      metadataPartPath: successorMetadataPartPath,
      metadataPath: stableMetadataPath
    });
    assert.deepEqual(publication.durability, {
      durable: true,
      protocol: "file-and-directory-fsync-v1"
    });
    assert.equal(await readFile(stableVideoPath, "utf8"), "successor-video");
    assert.equal(await readFile(stableMetadataPath, "utf8"), "successor-metadata");
    await assert.rejects(readFile(successorVideoPartPath), { code: "ENOENT" });
    await assert.rejects(readFile(successorMetadataPartPath), { code: "ENOENT" });
  } finally {
    successorLock?.release();
    if (parent && parent.exitCode === null && parent.signalCode === null) {
      parent.kill("SIGKILL");
    }
    if (workerPid && !(await waitForProcessExit(workerPid, 100))) {
      try {
        process.kill(workerPid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await rm(workDirectory, { recursive: true, force: true });
  }
});

test("durable publication 分类不将 EIO 伪装为不支持，且公开 sync 固定真实 fsync", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "long-render-durability-"));
  const filePath = resolve(root, "fixture.bin");
  await writeFile(filePath, "durability-fixture", "utf8");

  try {
    assert.equal(isUnsupportedLongReviewDirectorySyncError({ code: "EINVAL" }), true);
    assert.equal(isUnsupportedLongReviewDirectorySyncError({ code: "ENOTSUP" }), true);
    assert.equal(isUnsupportedLongReviewDirectorySyncError({ code: "EIO" }), false);
    assert.equal(
      isUnsupportedLongReviewDirectorySyncError({ code: "EPERM" }, "linux"),
      false
    );
    assert.equal(
      isUnsupportedLongReviewDirectorySyncError({ code: "EPERM" }, "win32"),
      true
    );

    await assert.rejects(
      syncLongReviewRenderDirectory(root, {openDirectory: async () => null}),
      /does not accept dependency injection/u
    );
    await assert.rejects(
      syncLongReviewRenderFile(filePath, {openFile: async () => null}),
      /does not accept dependency injection/u
    );

    assert.deepEqual(await syncLongReviewRenderFile(filePath), {
      path: filePath,
      durable: true
    });
    assert.deepEqual(await syncLongReviewRenderDirectory(root), {
      path: root,
      durable: true
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("仓库提供的版本化 render-job 示例与当前 schema 一致", async () => {
  const example = JSON.parse(await readFile(
    resolve(process.cwd(), "config", "long-review-render-job.example.json"),
    "utf8"
  ));
  const validated = validateLongReviewRenderJob(example, {
    workspaceRoot: resolve(process.cwd(), "..")
  });
  assert.equal(validated.schemaVersion, LONG_REVIEW_RENDER_JOB_SCHEMA_VERSION);
  assert.equal(validated.candidateVersion, 1);
  assert.equal(validated.temporaryVoice, true);
  assert.equal(validated.temporaryVoiceIsFinalHumanRecording, false);

  const configDirectory = resolve(process.cwd(), "config", "render-jobs");
  const configFiles = (await readdir(configDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  assert.deepEqual(configFiles, [
    "full-video-current-visual-upgrade-v008.json",
    "full-video-current-visual-upgrade-v009.json",
    "full-video-current-visual-upgrade-v010.json",
    "full-video-current-visual-upgrade-v011.json",
    "full-video-current-visual-upgrade-v012.json"
  ]);
  const jobs = await Promise.all(configFiles.map(async (name) =>
    validateLongReviewRenderJob(
      JSON.parse(await readFile(resolve(configDirectory, name), "utf8")),
      {workspaceRoot: resolve(process.cwd(), "..")}
    )
  ));
  assert.deepEqual(jobs.map((job) => job.candidateVersion), [8, 9, 10, 11, 12]);
  for (const job of jobs) {
    assert.equal(job.schemaVersion, LONG_REVIEW_RENDER_JOB_SCHEMA_VERSION);
    assert.equal(job.temporaryVoice, true);
    assert.equal(job.temporaryVoiceIsFinalHumanRecording, false);
  }
});

test("通用入口只接受版本化 job，不再把 v004 当当前候选", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/render-agent-skill-long-review-chunked.mjs", "--help"],
    { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" }
  );
  assert.match(stdout, /--job-config/u);
  assert.match(stdout, /default: 900/u);
  assert.match(stdout, /default: 5000/u);
  assert.doesNotMatch(stdout, /v004 review candidate/iu);
});

test("通用长片入口在渲染前拒绝覆盖已存在的最终目录", async () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const episodeId = `render-no-overwrite-${suffix}`;
  const configDirectory = await mkdtemp(resolve(process.cwd(), "config", "render-no-overwrite-"));
  const configPath = resolve(configDirectory, "job.json");
  const episodeDirectory = resolve(process.cwd(), "data", "episodes", episodeId);
  const publicEpisodeDirectory = resolve(process.cwd(), "public", "episodes", episodeId);
  const outputRoot = resolve(process.cwd(), "..", "outputs", "studio", episodeId);
  const dynamicJob = jobFixture({
    jobId: `${episodeId}-v008`,
    episodeId,
    paths: {
      ...jobFixture().paths,
      episode: `studio/data/episodes/${episodeId}/episode.json`,
      voice: `studio/public/episodes/${episodeId}/voice-review.wav`,
      finalDirectory:
        `outputs/studio/${episodeId}/review-candidates/full-video-current-v008`,
      workDirectory:
        `outputs/studio/${episodeId}/review-candidates/.full-video-current-v008-work`
    }
  });
  const finalDirectory = resolve(process.cwd(), "..", dynamicJob.paths.finalDirectory);
  const sentinelPath = resolve(finalDirectory, "preserve.txt");
  try {
    await Promise.all([
      mkdir(episodeDirectory, {recursive: true}),
      mkdir(publicEpisodeDirectory, {recursive: true}),
      mkdir(finalDirectory, {recursive: true})
    ]);
    await Promise.all([
      writeFile(resolve(episodeDirectory, "episode.json"), "{}\n", "utf8"),
      writeFile(resolve(publicEpisodeDirectory, "voice-review.wav"), "voice\n", "utf8"),
      writeFile(configPath, `${JSON.stringify(dynamicJob, null, 2)}\n`, "utf8"),
      writeFile(sentinelPath, "preserve\n", "utf8")
    ]);
    const jobConfigArgument = relative(resolve(process.cwd(), ".."), configPath)
      .replaceAll("\\", "/");
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [
          "scripts/render-agent-skill-long-review-chunked.mjs",
          "--job-config",
          jobConfigArgument
        ],
        {cwd: process.cwd(), encoding: "utf8"}
      ),
      (error) => {
        assert.match(error.stderr, /already exists; refusing to overwrite/u);
        return true;
      }
    );
    assert.equal(await readFile(sentinelPath, "utf8"), "preserve\n");
  } finally {
    await Promise.all([
      rm(configDirectory, {recursive: true, force: true}),
      rm(episodeDirectory, {recursive: true, force: true}),
      rm(publicEpisodeDirectory, {recursive: true, force: true}),
      rm(outputRoot, {recursive: true, force: true})
    ]);
  }
});

test("版本化 job 决定输入与不可覆盖输出，不再绑定固定 v004 路径", () => {
  const workspaceRoot = "/workspace/project";
  const first = validateLongReviewRenderJob(jobFixture(), { workspaceRoot });
  const second = validateLongReviewRenderJob(
    jobFixture({
      jobId: "agent-skill-current-v009",
      candidateVersion: 9,
      paths: {
        ...jobFixture().paths,
        finalDirectory:
          "outputs/studio/agent-skill-current/review-candidates/full-video-current-v009",
        workDirectory:
          "outputs/studio/agent-skill-current/review-candidates/.full-video-current-v009-work"
      }
    }),
    { workspaceRoot }
  );

  assert.equal(first.candidateVersion, 8);
  assert.equal(second.candidateVersion, 9);
  assert.notEqual(first.resolvedPaths.finalDirectory, second.resolvedPaths.finalDirectory);
  assert.match(first.resolvedPaths.episode, /agent-skill-current\/episode\.json$/u);
  assert.throws(
    () => validateLongReviewRenderJob(jobFixture({
      paths: { ...jobFixture().paths, voice: "/tmp/outside.wav" }
    }), { workspaceRoot }),
    /relative workspace path/u
  );
  assert.throws(
    () => validateLongReviewRenderJob(jobFixture({
      paths: { ...jobFixture().paths, finalDirectory: "../outside" }
    }), { workspaceRoot }),
    /relative workspace path/u
  );
  assert.throws(
    () => validateLongReviewRenderJob(jobFixture({
      paths: {
        ...jobFixture().paths,
        finalDirectory: "outputs/studio/agent-skill-current/review-candidates"
      }
    }), { workspaceRoot }),
    /direct child/u
  );
  assert.throws(
    () => validateLongReviewRenderJob(jobFixture({
      paths: {
        ...jobFixture().paths,
        workDirectory:
          "outputs/studio/agent-skill-current/review-candidates/full-video-current-v008/work"
      }
    }), { workspaceRoot }),
    /direct child/u
  );
  assert.throws(
    () => validateLongReviewRenderJob(jobFixture({
      jobId: "agent-skill-current-v999"
    }), { workspaceRoot }),
    /candidate version token v008/u
  );
  assert.throws(
    () => validateLongReviewRenderJob(jobFixture({
      paths: {
        ...jobFixture().paths,
        finalDirectory:
          "outputs/studio/agent-skill-current/review-candidates/full-video-current-v123"
      }
    }), { workspaceRoot }),
    /candidate version token v008/u
  );
  assert.throws(
    () => validateLongReviewRenderJob(jobFixture({
      paths: {
        ...jobFixture().paths,
        workDirectory:
          "outputs/studio/agent-skill-current/review-candidates/.unrelated-v008-work"
      }
    }), { workspaceRoot }),
    /version-matched sibling/u
  );
});

test("版本化 job 拒绝任一祖先目录符号链接到工作区外", async () => {
  const workspaceRoot = await mkdtemp(resolve(tmpdir(), "long-render-path-safety-"));
  const outsideRoot = await mkdtemp(resolve(tmpdir(), "long-render-outside-"));
  const job = jobFixture();
  const configPath = resolve(workspaceRoot, "studio/config/render-jobs/current.json");
  try {
    await Promise.all([
      mkdir(resolve(workspaceRoot, "studio/src/video"), { recursive: true }),
      mkdir(resolve(workspaceRoot, "studio/data/episodes/agent-skill-current"), {
        recursive: true
      }),
      mkdir(resolve(workspaceRoot, "studio/public/episodes/agent-skill-current"), {
        recursive: true
      }),
      mkdir(resolve(workspaceRoot, "studio/config/render-jobs"), { recursive: true })
    ]);
    await Promise.all([
      writeFile(resolve(workspaceRoot, job.paths.entryPoint), "export {};\n", "utf8"),
      writeFile(resolve(workspaceRoot, job.paths.episode), "{}\n", "utf8"),
      writeFile(resolve(workspaceRoot, job.paths.voice), "voice\n", "utf8"),
      writeFile(configPath, `${JSON.stringify(job)}\n`, "utf8")
    ]);
    await symlink(outsideRoot, resolve(workspaceRoot, "outputs"));
    const validated = validateLongReviewRenderJob(job, { workspaceRoot });
    await assert.rejects(
      assertLongReviewRenderJobFilesystemSafety(validated, {
        workspaceRoot,
        jobConfigPath: configPath
      }),
      /must not contain symlink path components/u
    );
  } finally {
    await Promise.all([
      rm(workspaceRoot, { recursive: true, force: true }),
      rm(outsideRoot, { recursive: true, force: true })
    ]);
  }
});

test("分段渲染核心从显式 job 解析候选版本与目录", async () => {
  const configDirectory = await mkdtemp(resolve(process.cwd(), "config", "render-job-test-"));
  const configPath = resolve(configDirectory, "job.json");
  const episodeId = `render-job-test-${process.pid}`;
  const episodeDirectory = resolve(process.cwd(), "data", "episodes", episodeId);
  const publicEpisodeDirectory = resolve(process.cwd(), "public", "episodes", episodeId);
  const dynamicJob = jobFixture({
    jobId: `${episodeId}-v008`,
    episodeId,
    paths: {
      ...jobFixture().paths,
      episode: `studio/data/episodes/${episodeId}/episode.json`,
      voice: `studio/public/episodes/${episodeId}/voice-review.wav`,
      finalDirectory:
        `outputs/studio/${episodeId}/review-candidates/full-video-current-v008`,
      workDirectory:
        `outputs/studio/${episodeId}/review-candidates/.full-video-current-v008-work`
    }
  });
  try {
    await Promise.all([
      mkdir(episodeDirectory, { recursive: true }),
      mkdir(publicEpisodeDirectory, { recursive: true })
    ]);
    await Promise.all([
      writeFile(resolve(episodeDirectory, "episode.json"), "{}\n", "utf8"),
      writeFile(resolve(publicEpisodeDirectory, "voice-review.wav"), "voice\n", "utf8"),
      writeFile(configPath, `${JSON.stringify(dynamicJob, null, 2)}\n`, "utf8")
    ]);
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          "const m = await import('./scripts/render-agent-skill-long-review-wide-v004-chunked.mjs');",
          "process.stdout.write(JSON.stringify({contract:m.CHUNKED_V004_CONTRACT,paths:m.CHUNKED_V004_PATHS,schemas:m.CHUNKED_LONG_REVIEW_SCHEMAS}));"
        ].join("\n")
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          AI_CONCEPT_STUDIO_LONG_REVIEW_RENDER_JOB: configPath
        }
      }
    );
    const loaded = JSON.parse(stdout);
    assert.equal(loaded.contract.candidateVersion, 8);
    assert.equal(loaded.contract.defaultChunkFrames, 900);
    assert.equal(loaded.contract.defaultInterChunkPauseMs, 5_000);
    assert.match(loaded.paths.finalDirectory, /full-video-current-v008$/u);
    assert.match(loaded.paths.voicePath, /voice-review\.wav$/u);
    assert.deepEqual(loaded.schemas, {
      chunk: "agent-skill-long-review-chunk-v1",
      finalManifest: "agent-skill-long-review-chunked-final-v1",
      concat: "agent-skill-long-review-concat-v1",
      finalMedia: "agent-skill-long-review-final-media-v1",
      publicationState: "agent-skill-long-review-publication-state-v1",
      publicationPendingFileName: "publication-durability-unknown.json",
      publicationReceiptFileName: "publication-durable-receipt.json",
      publicationPartPrefix: ".long-review-publication"
    });
  } finally {
    await Promise.all([
      rm(configDirectory, { recursive: true, force: true }),
      rm(episodeDirectory, { recursive: true, force: true }),
      rm(publicEpisodeDirectory, { recursive: true, force: true })
    ]);
  }
});

test("来源冻结覆盖完整 src、public、配置、job 与 episode", () => {
  const workspaceRoot = "/workspace/project";
  const validated = validateLongReviewRenderJob(jobFixture(), { workspaceRoot });
  const inputs = longReviewSourceInputs(validated, {
    workspaceRoot,
    scriptPath: "/workspace/project/studio/scripts/render-agent-skill-long-review-chunked.mjs",
    jobConfigPath: "/workspace/project/studio/config/render-jobs/current.json"
  });

  assert.deepEqual(inputs, [
    "/workspace/project/studio/scripts/render-agent-skill-long-review-chunked.mjs",
    "/workspace/project/studio/config/render-jobs/current.json",
    "/workspace/project/studio/src",
    "/workspace/project/studio/public",
    "/workspace/project/.node-version",
    "/workspace/project/studio/package.json",
    "/workspace/project/studio/pnpm-lock.yaml",
    "/workspace/project/studio/config/visual-system.json",
    "/workspace/project/studio/data/episodes/agent-skill-current/episode.json"
  ]);
});

test("Git 身份绑定 tracked diff 与 untracked 文件真实内容，而非仅文件名状态", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "long-render-git-"));
  try {
    await execFileAsync("git", ["init", "-q"], { cwd: root });
    await execFileAsync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
    await execFileAsync("git", ["config", "user.name", "Fixture"], { cwd: root });
    await writeFile(resolve(root, "tracked.txt"), "base\n", "utf8");
    await execFileAsync("git", ["add", "tracked.txt"], { cwd: root });
    await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: root });
    await writeFile(resolve(root, "tracked.txt"), "first\n", "utf8");
    await writeFile(resolve(root, "untracked.txt"), "alpha\n", "utf8");
    const first = await captureContentAwareGitIdentity({ workspaceRoot: root });

    await writeFile(resolve(root, "tracked.txt"), "other\n", "utf8");
    await writeFile(resolve(root, "untracked.txt"), "bravo\n", "utf8");
    const second = await captureContentAwareGitIdentity({ workspaceRoot: root });

    assert.notEqual(first.trackedDiffSha256, second.trackedDiffSha256);
    assert.notEqual(first.untracked.sha256, second.untracked.sha256);
    assert.equal(first.statusSha256, second.statusSha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
