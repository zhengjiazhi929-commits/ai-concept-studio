import test from "node:test";
import assert from "node:assert/strict";
import {
  link,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

import { validateEpisode } from "../src/shared/schema.mjs";
import { integrityHash } from "../src/shared/integrity.mjs";
import { currentGateArtifactHash } from "../src/shared/workflow.mjs";
import {
  LOCAL_TTS_MODEL,
  LOCAL_TTS_VOICES
} from "../src/video/agent-skill-local-tts-plan.mjs";
import {
  LOCAL_OFFLINE_TTS_V002_REGISTRATION,
  LOCAL_OFFLINE_TTS_REBIND_INSPECTION,
  assertNoSymlinkRegularFile,
  inspectLocalOfflineTtsCandidate as inspectProductionLocalOfflineTtsCandidate,
  inspectPcmWav,
  inspectRegisteredLocalOfflineTtsRebindCandidate as
    inspectProductionRegisteredLocalOfflineTtsRebindCandidate,
  registerApprovedLocalOfflineTts as registerProductionApprovedLocalOfflineTts,
  verifyRegisteredLocalOfflineVoiceForAssets as
    verifyProductionRegisteredLocalOfflineVoiceForAssets
} from "../src/server/production/local-offline-voice.mjs";
import { validateAssetsForReview } from "../src/server/reviews/validators/assets.mjs";
import {
  assetExecutionApprovalRecordValid,
  assetExecutionApprovalValid
} from
  "../src/server/reviews/asset-execution-checkpoint.mjs";
import { approvalValidForGate } from "../src/server/control/policy-engine.mjs";
import { adaptApprovedStoryboardToShortAssetPlan } from
  "../src/server/production/short-asset-plan-adapter.mjs";
import { studioRoot, workspaceRoot } from "../src/shared/paths.mjs";
import {
  LOCAL_OFFLINE_VOICE_FIXTURE_ROOT,
  createDeterministicPcmTestWav,
  createLocalOfflineVoiceFixture
} from "./local-offline-voice.fixture.mjs";
import { createLocalOfflineVoiceFixtureHarness } from
  "./local-offline-voice.fixture-harness.mjs";

const voiceFixture = createLocalOfflineVoiceFixture(
  LOCAL_OFFLINE_TTS_V002_REGISTRATION
);
const fixtureVoiceService = createLocalOfflineVoiceFixtureHarness({
  registration: voiceFixture.registration,
  priorReview: voiceFixture.priorReview,
  candidateRoot: LOCAL_OFFLINE_VOICE_FIXTURE_ROOT,
  candidatePaths: voiceFixture.candidateRelativePaths
});
const {
  inspectLocalOfflineTtsCandidate,
  inspectRegisteredLocalOfflineTtsRebindCandidate,
  registerApprovedLocalOfflineTts,
  verifyRegisteredLocalOfflineVoiceForAssets
} = fixtureVoiceService;
const episodeId = voiceFixture.registration.episodeId;
const historicStoryboardBinding = voiceFixture.storyboardBinding;
const isolatedEpisodeTemplate = structuredClone(voiceFixture.episode);
let currentRebindEpisodeTemplate = null;

function isolatedEpisode() {
  return structuredClone(isolatedEpisodeTemplate);
}

function currentRebindEpisode() {
  assert.ok(currentRebindEpisodeTemplate, "rebind fixture must be initialized");
  return structuredClone(currentRebindEpisodeTemplate);
}

const fixtureRuntimeRoot = process.env.AI_CONCEPT_STUDIO_KOKORO_ROOT?.trim()
  ? resolve(process.env.AI_CONCEPT_STUDIO_KOKORO_ROOT)
  : resolve(homedir(), ".cache", "ai-concept-studio", "kokoro312");
const fixtureRuntimePaths = Object.freeze({
  model: resolve(fixtureRuntimeRoot, "model-v1.1-zh", LOCAL_TTS_MODEL.fileName),
  config: resolve(fixtureRuntimeRoot, "model-v1.1-zh", "config.json"),
  voice: resolve(fixtureRuntimeRoot, "model-v1.1-zh", "voices", "zm_010.pt")
});

function pinnedRuntimeKind(path) {
  const absolutePath = resolve(path);
  return Object.entries(fixtureRuntimePaths).find(([, allowedPath]) =>
    absolutePath === allowedPath)?.[0] ?? null;
}

function isPinnedRuntimePath(path) {
  return pinnedRuntimeKind(path) !== null;
}

function fixtureAccessError(operation, path) {
  const error = new Error(
    `Test fixture ${operation} denied unlisted path: ${resolve(path)}`
  );
  error.code = "test_fixture_path_not_allowed";
  return error;
}

function pathInsideRoot(path, root) {
  const pathFromRoot = relative(resolve(root), resolve(path));
  return pathFromRoot === ""
    || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

async function sourceModuleFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceModuleFiles(path);
    return entry.isFile() && /\.(?:mjs|js)$/u.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

function withReportedFileSize(base, targetPath, bytes, targetReadCounter) {
  const absoluteTarget = resolve(targetPath);
  return {
    ...base,
    lstat: async (path) => {
      const file = await base.lstat(path);
      return resolve(path) === absoluteTarget ? { ...file, size: bytes } : file;
    },
    realpath: base.realpath,
    readFile: async (path) => {
      if (resolve(path) === absoluteTarget) targetReadCounter.count += 1;
      return base.readFile(path);
    }
  };
}

function recordFixtureAccess(context, operation, path, source, allowed) {
  context.accessLog.push({
    operation,
    path: resolve(path),
    source,
    allowed
  });
}

function resolveFixtureAccess(path, operation, context) {
  const absolutePath = resolve(path);
  const data = fixtureBuffer(absolutePath);
  if (data !== null) {
    recordFixtureAccess(context, operation, absolutePath, "immutable-fixture", true);
    return { absolutePath, data, source: "immutable-fixture" };
  }
  const temporaryRoot = context.temporaryRoots.find((root) =>
    pathInsideRoot(absolutePath, root));
  if (temporaryRoot) {
    recordFixtureAccess(context, operation, absolutePath, "test-temporary", true);
    return { absolutePath, data: null, source: "test-temporary" };
  }
  recordFixtureAccess(context, operation, absolutePath, "unlisted", false);
  throw fixtureAccessError(operation, absolutePath);
}

function fakeRuntimeIntegrity(path) {
  const kind = pinnedRuntimeKind(path);
  if (kind === "model") {
    return { bytes: 100, sha256: LOCAL_TTS_MODEL.sha256 };
  }
  if (kind === "config") {
    return { bytes: 101, sha256: LOCAL_TTS_MODEL.configSha256 };
  }
  if (kind === "voice") {
    return {
      bytes: 102,
      sha256: LOCAL_TTS_VOICES.find(({ id }) => id === "zm_010").sha256
    };
  }
  throw fixtureAccessError("inspectFileIntegrity", path);
}

function fixtureBuffer(path) {
  const absolutePath = resolve(path);
  for (const [relativePath, data] of voiceFixture.files) {
    if (resolve(workspaceRoot, relativePath) === absolutePath) return data;
  }
  return null;
}

function createFixtureAccessContext({ temporaryRoots = [], accessLog = [] } = {}) {
  return {
    temporaryRoots: temporaryRoots.map((root) => resolve(root)),
    accessLog
  };
}

async function fixtureReadFile(path, context = createFixtureAccessContext()) {
  const access = resolveFixtureAccess(path, "readFile", context);
  return access.source === "immutable-fixture"
    ? Buffer.from(access.data)
    : readFile(access.absolutePath);
}

function storyboardVisualBindingReadFile({
  sourceVisualContractVersion,
  currentVisualContractVersion,
  sourceVisualStyleProfileId,
  currentVisualStyleProfileId
}) {
  return async (path) => {
    const data = await fixtureReadFile(path);
    const source = path.endsWith("storyboard-draft-v003.json");
    const current = path.endsWith("storyboard-draft-v004.json");
    if (!source && !current) return data;

    const artifact = JSON.parse(data.toString("utf8"));
    artifact.draft.visualContractVersion = source
      ? sourceVisualContractVersion
      : currentVisualContractVersion;
    artifact.draft.visualStyleProfileId = source
      ? sourceVisualStyleProfileId
      : currentVisualStyleProfileId;

    const mutated = Buffer.from(JSON.stringify(artifact), "utf8");
    assert.ok(mutated.length <= data.length);
    return Buffer.concat([
      mutated,
      Buffer.alloc(data.length - mutated.length, 0x20)
    ]);
  };
}

async function fixtureLstat(path, context = createFixtureAccessContext()) {
  const access = resolveFixtureAccess(path, "lstat", context);
  if (access.source === "immutable-fixture") {
    return {
      size: access.data.length,
      nlink: 1,
      isFile: () => true,
      isSymbolicLink: () => false
    };
  }
  return lstat(access.absolutePath);
}

async function fixtureRealpath(path, context = createFixtureAccessContext()) {
  const access = resolveFixtureAccess(path, "realpath", context);
  return access.source === "immutable-fixture"
    ? access.absolutePath
    : realpath(access.absolutePath);
}

function immutableFixtureOptions(context = createFixtureAccessContext()) {
  return {
    readFile: (path) => fixtureReadFile(path, context)
  };
}

function verifierOptions(extra = {}) {
  const {
    temporaryRoots = [],
    fixtureAccessLog = [],
    ...overrides
  } = extra;
  const context = createFixtureAccessContext({
    temporaryRoots,
    accessLog: fixtureAccessLog
  });
  return {
    ...immutableFixtureOptions(context),
    episode: isolatedEpisode(),
    readEpisode: async () => {
      throw new Error("candidate inspector 测试不得回退读取 live Episode");
    },
    lstat: async (path) => {
      if (isPinnedRuntimePath(path)) {
        recordFixtureAccess(context, "lstat", path, "runtime-mock", true);
        return {
          size: fakeRuntimeIntegrity(path).bytes,
          nlink: 1,
          isFile: () => true,
          isSymbolicLink: () => false
        };
      }
      return fixtureLstat(path, context);
    },
    realpath: async (path) => {
      if (isPinnedRuntimePath(path)) {
        recordFixtureAccess(context, "realpath", path, "runtime-mock", true);
        return resolve(path);
      }
      return fixtureRealpath(path, context);
    },
    inspectFileIntegrity: async (path) => {
      try {
        const integrity = fakeRuntimeIntegrity(path);
        recordFixtureAccess(context, "inspectFileIntegrity", path, "runtime-mock", true);
        return integrity;
      } catch (error) {
        recordFixtureAccess(context, "inspectFileIntegrity", path, "unlisted", false);
        throw error;
      }
    },
    validateAssetExecutionApproval: () => true,
    verifyLocalOfflineVoice: verifyRegisteredLocalOfflineVoiceForAssets,
    ...overrides,
    fixtureAccessLog
  };
}

function registeredRuntimeIntegrity(path, episode) {
  const kind = pinnedRuntimeKind(path);
  if (kind === "model") {
    return {
      bytes: episode.voice.provenance.model.bytes,
      sha256: LOCAL_TTS_MODEL.sha256
    };
  }
  if (kind === "config") {
    return {
      bytes: episode.voice.provenance.model.configBytes,
      sha256: LOCAL_TTS_MODEL.configSha256
    };
  }
  if (kind === "voice") {
    return {
      bytes: episode.voice.provenance.voice.packageBytes,
      sha256: LOCAL_TTS_VOICES.find(({ id }) => id === "zm_010").sha256
    };
  }
  throw fixtureAccessError("inspectFileIntegrity", path);
}

function rebindVerifierOptions(extra = {}) {
  const {
    episode: suppliedEpisode,
    temporaryRoots = [],
    fixtureAccessLog = [],
    ...overrides
  } = extra;
  const episode = suppliedEpisode ?? currentRebindEpisode();
  const context = createFixtureAccessContext({
    temporaryRoots,
    accessLog: fixtureAccessLog
  });
  return {
    ...immutableFixtureOptions(context),
    episode,
    readEpisode: async () => {
      throw new Error("rebind inspector 测试不得回退读取 live Episode");
    },
    lstat: async (path) => {
      if (isPinnedRuntimePath(path)) {
        recordFixtureAccess(context, "lstat", path, "runtime-mock", true);
        return {
          size: registeredRuntimeIntegrity(path, episode).bytes,
          nlink: 1,
          isFile: () => true,
          isSymbolicLink: () => false
        };
      }
      return fixtureLstat(path, context);
    },
    realpath: async (path) => {
      if (isPinnedRuntimePath(path)) {
        recordFixtureAccess(context, "realpath", path, "runtime-mock", true);
        return resolve(path);
      }
      return fixtureRealpath(path, context);
    },
    inspectFileIntegrity: async (path) => {
      try {
        const integrity = registeredRuntimeIntegrity(path, episode);
        recordFixtureAccess(context, "inspectFileIntegrity", path, "runtime-mock", true);
        return integrity;
      } catch (error) {
        recordFixtureAccess(context, "inspectFileIntegrity", path, "unlisted", false);
        throw error;
      }
    },
    validateAssetExecutionApproval: () => true,
    verifyLocalOfflineVoice: verifyRegisteredLocalOfflineVoiceForAssets,
    ...overrides,
    episode,
    fixtureAccessLog
  };
}

function fakeStore(source, appendEvent = async () => undefined) {
  let episode = structuredClone(source);
  const writes = [];
  return {
    readEpisode: async () => structuredClone(episode),
    writeEpisode: async (next) => {
      episode = structuredClone(next);
      writes.push(structuredClone(next));
    },
    appendEvent,
    get episode() {
      return structuredClone(episode);
    },
    writes
  };
}

function ledgerSnapshot(episode) {
  return {
    budget: structuredClone(episode.control.budget),
    ai: structuredClone(episode.production.ai),
    routingHistory: structuredClone(episode.routingHistory),
    dispatchHistory: structuredClone(episode.dispatchHistory),
    assetExecution: structuredClone(episode.reviewCheckpoints.assetExecution)
  };
}

function withApprovedLocalOnlyAssetCandidate(source, version = 10) {
  const episode = structuredClone(source);
  episode.production.assetPlanDirection = {
    strategy: "local-only",
    selectedBy: "human"
  };
  const content = adaptApprovedStoryboardToShortAssetPlan(episode);
  const artifactPath = `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/carry-forward/asset-plan-v${String(
    version
  ).padStart(3, "0")}.json`;
  const planHash = integrityHash(content);
  const candidateHash = integrityHash({
    episodeId: episode.id,
    version,
    artifactPath,
    planHash,
    purpose: "local-offline-voice-carry-forward-test"
  });
  const machineReviewId = `asset-execution-review-v${String(version).padStart(3, "0")}-test`;
  const approvedAt = "2026-08-15T12:00:00.000Z";
  episode.production.assetPlan = {
    version,
    artifactPath,
    content,
    needsRevision: false
  };
  const previousHistory = episode.reviewCheckpoints.assetExecution.history ?? [];
  episode.reviewCheckpoints.assetExecution = {
    schemaVersion: 1,
    status: "approved",
    currentCandidate: {
      episodeId: episode.id,
      version,
      artifact: {
        path: artifactPath,
        bytes: 1,
        sha256: "a".repeat(64)
      },
      planHash,
      candidateHash
    },
    machineReview: {
      id: machineReviewId,
      status: "passed",
      checkedAt: approvedAt,
      candidateHash,
      checks: []
    },
    humanApproval: {
      decision: "approved",
      at: approvedAt,
      note: "测试：批准新的本地零调用视觉候选",
      version,
      candidateHash,
      machineReviewId,
      maximumPaidCostUsd: 0,
      externalApiCallCount: 0,
      authorizedToolIds: []
    },
    history: [
      ...previousHistory,
      {
        type: "machine-review",
        at: approvedAt,
        version,
        candidateHash,
        reviewId: machineReviewId,
        status: "passed"
      },
      {
        type: "human-approval",
        at: approvedAt,
        version,
        candidateHash,
        machineReviewId,
        decision: "approved",
        note: "测试：批准新的本地零调用视觉候选"
      }
    ]
  };
  return episode;
}

function rebindAssetPlanHash(episode, purpose) {
  const checkpoint = episode.reviewCheckpoints.assetExecution;
  const planHash = integrityHash(episode.production.assetPlan.content);
  const candidateHash = integrityHash({
    version: checkpoint.currentCandidate.version,
    planHash,
    purpose
  });
  checkpoint.currentCandidate.planHash = planHash;
  checkpoint.currentCandidate.candidateHash = candidateHash;
  checkpoint.machineReview.candidateHash = candidateHash;
  checkpoint.humanApproval.candidateHash = candidateHash;
}

async function buildCurrentRebindEpisodeTemplate() {
  const directory = await mkdtemp(resolve(studioRoot, ".test-local-tts-fixture-register-"));
  const store = fakeStore(isolatedEpisode());
  const options = verifierOptions({
    ...store,
    temporaryRoots: [directory],
    episodePublicDirectory: () => directory,
    now: new Date("2026-08-14T12:00:00.000Z")
  });
  try {
    const inspected = await inspectLocalOfflineTtsCandidate(episodeId, options);
    const result = await registerApprovedLocalOfflineTts(
      episodeId,
      inspected.registrationRequest,
      options
    );
    const registered = structuredClone(result.episode);
    const registeredRelativePath =
      `studio/public/episodes/${episodeId}/voice-v001.wav`;
    registered.voice.audioPath = registeredRelativePath;
    registered.voice.publicPath = `episodes/${episodeId}/voice-v001.wav`;
    voiceFixture.files.set(
      registeredRelativePath,
      voiceFixture.files.get(voiceFixture.candidateRelativePaths.wavPath)
    );
    return voiceFixture.createRebindEpisode(registered).episode;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

currentRebindEpisodeTemplate = await buildCurrentRebindEpisodeTemplate();

test("生产 v002 登记固定到人工批准的精确候选与哈希", () => {
  assert.deepEqual(
    {
      episodeId: LOCAL_OFFLINE_TTS_V002_REGISTRATION.episodeId,
      candidateId: LOCAL_OFFLINE_TTS_V002_REGISTRATION.candidateId,
      candidateVersion: LOCAL_OFFLINE_TTS_V002_REGISTRATION.candidateVersion,
      manifestFileName: LOCAL_OFFLINE_TTS_V002_REGISTRATION.manifestFileName,
      manifestSha256: LOCAL_OFFLINE_TTS_V002_REGISTRATION.manifestSha256,
      wavFileName: LOCAL_OFFLINE_TTS_V002_REGISTRATION.wavFileName,
      wavSha256: LOCAL_OFFLINE_TTS_V002_REGISTRATION.wavSha256,
      confirmation: LOCAL_OFFLINE_TTS_V002_REGISTRATION.confirmation
    },
    {
      episodeId: "agent-skill-tool-mcp-60s-20260813",
      candidateId: "agent-skill-short-local-tts-zm_010-v002",
      candidateVersion: 2,
      manifestFileName: "short-local-tts-zm_010-v002-manifest.json",
      manifestSha256:
        "683a56a0c555740447f1ab56a32d1bc082200ad5ca419e26185bb0a584aa4bfe",
      wavFileName: "short-local-tts-zm_010-v002.wav",
      wavSha256:
        "ee8374cd36dfe0503ebf8f6332595c024264ab79c52abd4302d24e232d89d612",
      confirmation: "register-approved-local-offline-tts-v002"
    }
  );
});

test("生产 wrapper 固定到正式 outputs 根且不会回退读取测试候选", async () => {
  const inspectedPaths = [];
  const options = {
    episode: isolatedEpisode(),
    validateAssetExecutionApproval: () => true,
    lstat: async (path) => {
      inspectedPaths.push(resolve(path));
      throw new Error("production path probe");
    }
  };
  await assert.rejects(
    inspectProductionLocalOfflineTtsCandidate(episodeId, options),
    (error) => error.code === "local_tts_candidate_file_invalid"
  );
  assert.equal(inspectedPaths.length, 2);
  assert.equal(inspectedPaths.every((path) => path.includes(
    `/outputs/studio/${episodeId}/`
  )), true);
  assert.equal(inspectedPaths.some((path) => path.includes(
    LOCAL_OFFLINE_VOICE_FIXTURE_ROOT
  )), false);
});

test("生产 wrapper 在任何 I/O 前拒绝候选、批准和根目录策略覆盖", async () => {
  const productionExports = await import(
    "../src/server/production/local-offline-voice.mjs"
  );
  assert.equal("createLocalOfflineVoiceService" in productionExports, false);
  const [appSource, assetValidatorSource] = await Promise.all([
    readFile(resolve(studioRoot, "src/server/app.mjs"), "utf8"),
    readFile(
      resolve(studioRoot, "src/server/reviews/validators/assets.mjs"),
      "utf8"
    )
  ]);
  for (const source of [appSource, assetValidatorSource]) {
    assert.match(source, /production\/local-offline-voice\.mjs/u);
    assert.doesNotMatch(source, /local-offline-voice-core\.mjs/u);
  }
  const wrapperPath = resolve(
    studioRoot,
    "src/server/production/local-offline-voice.mjs"
  );
  const forbiddenCoreImports = [];
  for (const modulePath of await sourceModuleFiles(resolve(studioRoot, "src"))) {
    if (modulePath === wrapperPath) continue;
    const source = await readFile(modulePath, "utf8");
    if (
      /(?:\bfrom\s*|\bimport\s*\()\s*["'][^"']*local-offline-voice-core\.mjs["']/u
        .test(source)
    ) {
      forbiddenCoreImports.push(relative(studioRoot, modulePath));
    }
  }
  assert.deepEqual(
    forbiddenCoreImports,
    [],
    "生产源码只能由 local-offline-voice.mjs wrapper 导入 core"
  );
  let ioCalls = 0;
  const ioProbe = async () => {
    ioCalls += 1;
    throw new Error("production wrapper must reject before I/O");
  };
  for (const overrideKey of [
    "registration",
    "priorReview",
    "candidatePaths",
    "candidateRoot"
  ]) {
    const options = {
      [overrideKey]: {},
      readEpisode: ioProbe,
      readFile: ioProbe,
      lstat: ioProbe,
      realpath: ioProbe
    };
    for (const invoke of [
      () => inspectProductionLocalOfflineTtsCandidate(episodeId, options),
      () => inspectProductionRegisteredLocalOfflineTtsRebindCandidate(
        episodeId,
        options
      ),
      () => verifyProductionRegisteredLocalOfflineVoiceForAssets({}, options),
      () => registerProductionApprovedLocalOfflineTts(episodeId, {}, options)
    ]) {
      await assert.rejects(
        async () => invoke(),
        (error) => error.code === "local_tts_policy_override_forbidden"
      );
    }
  }
  assert.equal(ioCalls, 0);
});

test("fixture harness 构造后也不允许单次调用替换固定策略", async () => {
  for (const overrideKey of [
    "registration",
    "priorReview",
    "candidatePaths",
    "candidateRoot"
  ]) {
    await assert.rejects(
      async () => inspectLocalOfflineTtsCandidate(
        episodeId,
        { [overrideKey]: {} }
      ),
      (error) => error.code === "local_tts_policy_override_forbidden"
    );
  }
});

test("不可变夹具不读取 live Episode、outputs 或 production 文件", () => {
  const paths = [
    ...voiceFixture.files.keys(),
    voiceFixture.candidateRelativePaths.manifestPath,
    voiceFixture.candidateRelativePaths.wavPath
  ];
  assert.equal(paths.every((path) => path.startsWith(
    `${LOCAL_OFFLINE_VOICE_FIXTURE_ROOT}/`
  ) || path === `studio/public/episodes/${episodeId}/voice-v001.wav`), true);
  assert.equal(paths.some((path) => path.startsWith("outputs/")), false);
  assert.equal(paths.some((path) => path.startsWith("studio/data/production/")), false);
  assert.equal(paths.some((path) => path.startsWith("studio/data/episodes/")), false);
});

test("夹具文件代理只允许不可变 fixture、运行时 mock 和逐测试临时目录", async () => {
  const fixtureAccessLog = [];
  const options = verifierOptions({ fixtureAccessLog });
  await inspectLocalOfflineTtsCandidate(episodeId, options);
  assert.equal(fixtureAccessLog.some(({ source }) => source === "immutable-fixture"), true);
  assert.equal(fixtureAccessLog.some(({ source }) => source === "runtime-mock"), true);
  assert.equal(fixtureAccessLog.every(({ allowed }) => allowed), true);
  assert.equal(fixtureAccessLog.some(({ path }) =>
    path.includes("/outputs/")
    || path.includes("/studio/data/production/")
    || path.endsWith("/episode.json")), false);

  const forbidden = resolve(
    workspaceRoot,
    "studio/data/production/episodes/live-only/episode.json"
  );
  for (const operation of ["readFile", "lstat", "realpath"]) {
    await assert.rejects(
      options[operation](forbidden),
      (error) => error.code === "test_fixture_path_not_allowed"
    );
  }
  assert.deepEqual(
    fixtureAccessLog.filter(({ allowed }) => !allowed).map(({ operation }) => operation),
    ["readFile", "lstat", "realpath"]
  );

  const directory = await mkdtemp(resolve(tmpdir(), "local-tts-allowlist-"));
  try {
    const temporaryFile = resolve(directory, "explicitly-allowed.txt");
    await writeFile(temporaryFile, "temporary fixture");
    const temporaryAccessLog = [];
    const temporaryOptions = verifierOptions({
      temporaryRoots: [directory],
      fixtureAccessLog: temporaryAccessLog
    });
    assert.equal((await temporaryOptions.readFile(temporaryFile)).toString("utf8"),
      "temporary fixture");
    assert.equal((await temporaryOptions.lstat(temporaryFile)).isFile(), true);
    assert.equal(await temporaryOptions.realpath(temporaryFile), await realpath(temporaryFile));
    assert.equal(temporaryAccessLog.every(({ source, allowed }) =>
      source === "test-temporary" && allowed), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("候选大小上限在 readFile 前拒绝超大 manifest 与 WAV", async () => {
  const targets = [
    {
      path: resolve(
        workspaceRoot,
        voiceFixture.candidateRelativePaths.manifestPath
      ),
      bytes: 1_048_577
    },
    {
      path: resolve(workspaceRoot, voiceFixture.candidateRelativePaths.wavPath),
      bytes: 2_945_537
    }
  ];
  for (const target of targets) {
    const base = verifierOptions();
    let readCalls = 0;
    const options = verifierOptions({
      lstat: async (path) => {
        const file = await base.lstat(path);
        return resolve(path) === target.path
          ? { ...file, size: target.bytes }
          : file;
      },
      realpath: base.realpath,
      readFile: async (path) => {
        readCalls += 1;
        return base.readFile(path);
      }
    });
    await assert.rejects(
      inspectLocalOfflineTtsCandidate(episodeId, options),
      (error) => error.code === "local_tts_candidate_file_too_large"
    );
    assert.equal(readCalls, 0);
  }
});

test("旁白关联 JSON、审阅媒体和已登记 WAV 均在 readFile 前执行大小门禁", async () => {
  const candidateWavBytes = voiceFixture.files.get(
    voiceFixture.candidateRelativePaths.wavPath
  ).length;
  const registeredVoicePath = resolve(
    workspaceRoot,
    `studio/public/episodes/${episodeId}/voice-v001.wav`
  );
  const assetsGateEpisode = currentRebindEpisode();
  const originalSourceEpisode = isolatedEpisode();
  assetsGateEpisode.scenes = structuredClone(originalSourceEpisode.scenes);
  assetsGateEpisode.subtitles = structuredClone(originalSourceEpisode.subtitles);
  assetsGateEpisode.production.storyboardDraft = structuredClone(
    originalSourceEpisode.production.storyboardDraft
  );
  assetsGateEpisode.reviews.storyboard = structuredClone(
    originalSourceEpisode.reviews.storyboard
  );
  assetsGateEpisode.approvals.storyboard = structuredClone(
    originalSourceEpisode.approvals.storyboard
  );
  const cases = [
    {
      label: "初始 voice plan 硬上限",
      targetPath: resolve(
        workspaceRoot,
        voiceFixture.episode.production.voicePlan.artifactPath
      ),
      bytes: 1_048_577,
      expectedCode: "local_tts_artifact_file_too_large",
      base: () => verifierOptions(),
      invoke: (options) => inspectLocalOfflineTtsCandidate(episodeId, options)
    },
    {
      label: "已绑定 voice plan 精确字节数",
      targetPath: resolve(
        workspaceRoot,
        voiceFixture.episode.production.voicePlan.artifactPath
      ),
      bytes: voiceFixture.files.get(
        voiceFixture.episode.production.voicePlan.artifactPath
      ).length + 1,
      expectedCode: "local_tts_artifact_size_mismatch",
      base: () => rebindVerifierOptions(),
      invoke: (options) => inspectRegisteredLocalOfflineTtsRebindCandidate(
        episodeId,
        options
      )
    },
    {
      label: "通用 Storyboard JSON 硬上限",
      targetPath: resolve(workspaceRoot, historicStoryboardBinding.artifactPath),
      bytes: 8 * 1_048_576 + 1,
      expectedCode: "local_tts_artifact_file_too_large",
      base: () => rebindVerifierOptions(),
      invoke: (options) => inspectRegisteredLocalOfflineTtsRebindCandidate(
        episodeId,
        options
      )
    },
    {
      label: "prior-review manifest 硬上限",
      targetPath: resolve(workspaceRoot, voiceFixture.priorReview.manifestPath),
      bytes: 8 * 1_048_576 + 1,
      expectedCode: "local_tts_artifact_file_too_large",
      base: () => rebindVerifierOptions(),
      invoke: (options) => inspectRegisteredLocalOfflineTtsRebindCandidate(
        episodeId,
        options
      )
    },
    {
      label: "prior-review media 精确字节数",
      targetPath: resolve(workspaceRoot, voiceFixture.priorReview.mediaPath),
      bytes: voiceFixture.priorReview.mediaBytes + 1,
      expectedCode: "local_tts_artifact_size_mismatch",
      base: () => rebindVerifierOptions(),
      invoke: (options) => inspectRegisteredLocalOfflineTtsRebindCandidate(
        episodeId,
        options
      )
    },
    {
      label: "重绑定来源 registered WAV 精确字节数",
      targetPath: registeredVoicePath,
      bytes: candidateWavBytes + 1,
      expectedCode: "local_tts_artifact_size_mismatch",
      base: () => rebindVerifierOptions(),
      invoke: (options) => inspectRegisteredLocalOfflineTtsRebindCandidate(
        episodeId,
        options
      )
    },
    {
      label: "Assets Gate registered WAV 精确字节数",
      targetPath: registeredVoicePath,
      bytes: candidateWavBytes + 1,
      expectedCode: "local_tts_artifact_size_mismatch",
      base: () => rebindVerifierOptions({ episode: assetsGateEpisode }),
      invoke: (options) => verifyRegisteredLocalOfflineVoiceForAssets(
        assetsGateEpisode,
        options
      )
    }
  ];

  for (const testCase of cases) {
    const targetReadCounter = { count: 0 };
    const options = withReportedFileSize(
      testCase.base(),
      testCase.targetPath,
      testCase.bytes,
      targetReadCounter
    );
    await assert.rejects(
      testCase.invoke(options),
      (error) => error.code === testCase.expectedCode,
      testCase.label
    );
    assert.equal(
      targetReadCounter.count,
      0,
      `${testCase.label} 必须在读取目标文件前拒绝`
    );
  }
});

test("PCM 时间覆盖门禁拒绝全静音、稀疏脉冲和超长静音段", () => {
  const syntheticTone = createDeterministicPcmTestWav();
  assert.equal(inspectPcmWav(syntheticTone).durationSeconds, 60);
  for (const invalidWav of [
    createDeterministicPcmTestWav({ amplitude: 0 }),
    createDeterministicPcmTestWav({
      amplitude: 32_767,
      activeRangesSeconds: [[0, 0.06]]
    }),
    createDeterministicPcmTestWav({
      activeRangesSeconds: [
        [0, 2],
        [6, 8],
        [12, 13],
        [18, 19],
        [24, 25],
        [30, 31],
        [36, 37],
        [42, 43],
        [48, 49],
        [54, 55]
      ]
    }),
    createDeterministicPcmTestWav({
      activeRangesSeconds: [[0, 20], [40, 60]]
    })
  ]) {
    assert.throws(
      () => inspectPcmWav(invalidWav),
      (error) => error.code === "local_tts_wav_energy_invalid"
    );
  }
});

test("登记前夹具固定到历史 Storyboard v3 与本地零调用素材 v9", () => {
  const episode = isolatedEpisode();
  assert.equal(episode.production.storyboardDraft.version, 3);
  assert.equal(
    currentGateArtifactHash(episode, "storyboard"),
    historicStoryboardBinding.artifactHash
  );
  assert.equal(approvalValidForGate(episode, "storyboard"), true);
  assert.equal(episode.production.assetPlan.version, 9);
  assert.equal(episode.reviewCheckpoints.assetExecution.status, "approved");
  assert.equal(episode.reviewCheckpoints.assetExecution.machineReview.status, "passed");
  assert.equal(
    episode.reviewCheckpoints.assetExecution.humanApproval.decision,
    "approved"
  );
  assert.equal(assetExecutionApprovalRecordValid(episode), true);
  assert.equal(
    episode.reviewCheckpoints.assetExecution.history.some((entry) => entry.version > 9),
    false
  );
});

test("只读机器验证返回可复算 candidateHash、完整 machineVerification 与精确登记请求", async () => {
  const first = await inspectLocalOfflineTtsCandidate(episodeId, verifierOptions());
  const second = await inspectLocalOfflineTtsCandidate(episodeId, verifierOptions());
  assert.equal(first.candidateHash, second.candidateHash);
  assert.equal(first.machineVerification.id, first.machineVerificationId);
  assert.equal(first.machineVerification.status, "passed");
  assert.equal(first.machineVerification.candidateHash, first.candidateHash);
  assert.match(first.machineVerification.verificationHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(first.registrationRequest, {
    candidateId: first.candidateId,
    manifestSha256: first.manifestSha256,
    candidateHash: first.candidateHash,
    machineVerificationId: first.machineVerificationId,
    machineVerificationHash: first.machineVerification.verificationHash,
    confirmation: LOCAL_OFFLINE_TTS_V002_REGISTRATION.confirmation
  });
  assert.equal(first.audio.durationSeconds, 60);
  assert.equal(first.audio.sampleRate, 24000);
  assert.equal(first.audio.channels, 1);
  assert.equal(first.audio.bitsPerSample, 16);
  assert.equal(first.checks.includes("pcm-wav-energy-floor"), true);
});

test("已登记 voice-v001 可只读形成 v3/v9 来源到 v4/v13 使用范围的零调用重绑定候选", async () => {
  const inspectedEpisode = currentRebindEpisode();
  const inspectedEpisodeHash = integrityHash(inspectedEpisode);
  const first = await inspectRegisteredLocalOfflineTtsRebindCandidate(
    episodeId,
    rebindVerifierOptions({ episode: inspectedEpisode })
  );
  const second = await inspectRegisteredLocalOfflineTtsRebindCandidate(
    episodeId,
    rebindVerifierOptions()
  );

  assert.equal(first.candidateHash, second.candidateHash);
  assert.equal(first.machineVerificationId, second.machineVerificationId);
  assert.equal(first.machineVerification.status, "passed");
  assert.equal(first.machineVerification.candidateHash, first.candidateHash);
  assert.equal(first.machineVerification.checks.length, 10);
  assert.equal(first.machineVerification.checks.every((check) => check.passed), true);
  assert.equal(first.registrationImplemented, false);
  assert.equal(first.liveStateModified, false);
  assert.equal(first.dossier.status, "ready_for_human_review");
  assert.equal(first.dossier.playablePreview.path,
    `studio/public/episodes/${episodeId}/voice-v001.wav`);
  assert.equal(first.dossier.sourceGeneration.bindings.storyboard.version, 3);
  assert.equal(first.dossier.sourceGeneration.bindings.assetExecution.version, 9);
  assert.equal(first.dossier.currentUseBinding.storyboard.version, 4);
  assert.equal(first.dossier.currentUseBinding.assetExecution.version, 13);
  assert.equal(first.dossier.comparison.sameRegisteredWav, true);
  assert.equal(first.dossier.comparison.sameNarration, true);
  assert.equal(first.dossier.comparison.sameNineSceneSegmentPlan, true);
  assert.equal(first.dossier.comparison.sameNonSubtitleStoryboardContent, true);
  assert.equal(first.dossier.comparison.subtitleLayoutChanged, true);
  assert.deepEqual(first.dossier.comparison.subtitleChangedSceneIds, ["S03"]);
  assert.equal(first.dossier.comparison.wavByteIdentical, true);
  assert.equal(first.dossier.comparison.narrationUnchanged, true);
  assert.equal(first.dossier.comparison.sceneTimingUnchanged, true);
  assert.equal(first.dossier.comparison.segmentPlanUnchanged, true);
  assert.equal(first.dossier.comparison.onlySubtitleBoundaryChanged, true);
  assert.equal(first.dossier.comparison.audioRegenerationRequired, false);
  assert.deepEqual(first.dossier.comparison.subtitleDelta, {
    changedSceneIds: ["S03"],
    scenes: [{
      sceneId: "S03",
      before: [
        {
          start: 8.708,
          end: 13.707,
          text: "MCP 标准化 prompts、resources 和 "
        },
        {
          start: 13.707,
          end: 17.402,
          text: "tools 如何被外部系统暴露和调用。"
        }
      ],
      after: [
        {
          start: 8.708,
          end: 14.794,
          text: "MCP 标准化 prompts、resources 和 tools "
        },
        {
          start: 14.794,
          end: 17.402,
          text: "如何被外部系统暴露和调用。"
        }
      ]
    }]
  });
  assert.deepEqual(first.dossier.comparison.syncCaveat, {
    strictAlignmentStatus: "not-verified",
    evidenceBasis: "render-plan-boundary-not-acoustic-word-alignment",
    audioSecondPhraseStartsAtSecond: 11.883,
    sourceSubtitleBoundarySecond: 13.707,
    currentSubtitleBoundarySecond: 14.794,
    sourceToCurrentBoundaryShiftSeconds: 1.087,
    audioToCurrentSubtitleBoundaryDeltaSeconds: 2.911,
    disclosure:
      "WAV、逐字旁白和九镜语音方案未变；字幕显示断句已变化，但这不代表逐词或逐音同步已经通过。"
  });
  assert.equal(
    first.dossier.comparison.sourceSubtitlesSha256,
    "3b1e61f04ee69b7399922e3a25c3b6595cb5ce2ab4e586c7654bee2f87b2b57f"
  );
  assert.equal(
    first.dossier.comparison.currentSubtitlesSha256,
    "f48c19a488a383aa55c882f0e43f5c0c3d140769b91ea8c2c185fddab973a462"
  );
  assert.equal(
    first.dossier.priorReviewEvidence.media.sourceVoiceSha256,
    voiceFixture.registration.wavSha256
  );
  assert.equal(first.dossier.priorReviewEvidence.media.storyboardVersion, 4);
  assert.equal(first.dossier.humanApproval, null);
  assert.equal(first.humanApproval, null);
  assert.equal(first.humanDecisionBinding.status, "pending");
  assert.equal(first.humanDecisionBinding.candidateHash, first.candidateHash);
  assert.equal(first.humanDecisionBinding.registrationImplemented, false);
  assert.deepEqual(first.dossier.apiAndCost, {
    mode: "local-read-only-rebind-inspection",
    networkCalls: 0,
    externalApiCalls: 0,
    externalInferenceCalls: 0,
    maximumPaidCostUsd: 0
  });
  assert.equal(
    first.registrationRequest.confirmation,
    LOCAL_OFFLINE_TTS_REBIND_INSPECTION.confirmation
  );
  assert.equal(first.registrationRequest.nonExecutablePreview, true);
  assert.equal(first.registrationRequest.registrationImplemented, false);
  assert.equal(first.registrationRequest.candidateHash, first.candidateHash);
  assert.equal(
    first.registrationRequest.machineVerificationHash,
    first.machineVerification.verificationHash
  );
  assert.equal(first.registrationRequest.sourceVoiceVersion, 1);
  assert.equal(first.registrationRequest.currentStoryboardVersion, 4);
  assert.equal(first.registrationRequest.currentAssetExecutionVersion, 13);
  assert.equal(integrityHash(inspectedEpisode), inspectedEpisodeHash,
    "只读重绑定候选不得修改注入的历史 Episode 快照");
});

test("重绑定候选对 WAV、授权、上游批准、字幕语义和零调用账本漂移 fail closed", async () => {
  const staleStoryboard = currentRebindEpisode();
  staleStoryboard.approvals.storyboard.status = "pending";
  await assert.rejects(
    inspectRegisteredLocalOfflineTtsRebindCandidate(
      episodeId,
      rebindVerifierOptions({ episode: staleStoryboard })
    ),
    (error) => error.code === "local_tts_source_approval_stale"
  );

  const changedNarration = currentRebindEpisode();
  changedNarration.subtitles[2].text = `${changedNarration.subtitles[2].text}篡改`;
  await assert.rejects(
    inspectRegisteredLocalOfflineTtsRebindCandidate(
      episodeId,
      rebindVerifierOptions({ episode: changedNarration })
    ),
    (error) => error.code === "local_tts_source_approval_stale"
  );

  const tamperedAuthorization = currentRebindEpisode();
  tamperedAuthorization.voice.authorization.candidateHash = "f".repeat(64);
  await assert.rejects(
    inspectRegisteredLocalOfflineTtsRebindCandidate(
      episodeId,
      rebindVerifierOptions({ episode: tamperedAuthorization })
    ),
    (error) => error.code === "local_tts_registered_provenance_invalid"
      || error.code === "local_tts_registered_authorization_invalid"
  );

  const nonZeroLedger = currentRebindEpisode();
  nonZeroLedger.control.budget.usedCalls = 1;
  await assert.rejects(
    inspectRegisteredLocalOfflineTtsRebindCandidate(
      episodeId,
      rebindVerifierOptions({ episode: nonZeroLedger })
    ),
    (error) => error.code === "local_tts_zero_call_ledger_invalid"
  );

  const dispatched = currentRebindEpisode();
  dispatched.dispatchHistory.push({
    id: "test-dispatch",
    workerId: "voice-agent",
    at: "2026-08-18T00:00:00.000Z"
  });
  await assert.rejects(
    inspectRegisteredLocalOfflineTtsRebindCandidate(
      episodeId,
      rebindVerifierOptions({ episode: dispatched })
    ),
    (error) => error.code === "local_tts_zero_call_ledger_invalid"
  );

  const sourceBindingTampered = currentRebindEpisode();
  sourceBindingTampered.voice.provenance.sourceBindings.storyboard.artifactHash =
    "e".repeat(64);
  await assert.rejects(
    inspectRegisteredLocalOfflineTtsRebindCandidate(
      episodeId,
      rebindVerifierOptions({ episode: sourceBindingTampered })
    ),
    (error) => error.code === "local_tts_source_stage_approval_invalid"
  );

  await assert.rejects(
    inspectRegisteredLocalOfflineTtsRebindCandidate(
      episodeId,
      rebindVerifierOptions({
        readFile: async (path) => {
          const data = await fixtureReadFile(path);
          if (!path.endsWith("voice-v001.wav")) return data;
          const tampered = Buffer.from(data);
          tampered[100] ^= 1;
          return tampered;
        }
      })
    ),
    /voice-v001 与原始 WAV 哈希不一致/u
  );
});

test("旁白重绑定在 visualContractVersion 漂移时 fail closed", async () => {
  await assert.rejects(
    inspectRegisteredLocalOfflineTtsRebindCandidate(
      episodeId,
      rebindVerifierOptions({
        readFile: storyboardVisualBindingReadFile({
          sourceVisualContractVersion: "visual-expression-contract-v1",
          currentVisualContractVersion: "visual-expression-contract-v2",
          sourceVisualStyleProfileId: "desktop-light-window-editorial-v3",
          currentVisualStyleProfileId: "desktop-light-window-editorial-v3"
        })
      })
    ),
    (error) => error.code === "local_tts_candidate_invalid"
      && error.message ===
        "Storyboard 除字幕布局外还有内容变化，不能零调用复用原始旁白"
  );
});

test("旁白重绑定在 visualStyleProfileId 漂移时 fail closed", async () => {
  await assert.rejects(
    inspectRegisteredLocalOfflineTtsRebindCandidate(
      episodeId,
      rebindVerifierOptions({
        readFile: storyboardVisualBindingReadFile({
          sourceVisualContractVersion: "visual-expression-contract-v1",
          currentVisualContractVersion: "visual-expression-contract-v1",
          sourceVisualStyleProfileId: "desktop-light-window-editorial-v3",
          currentVisualStyleProfileId: "desktop-light-window-editorial-v4"
        })
      })
    ),
    (error) => error.code === "local_tts_candidate_invalid"
      && error.message ===
        "Storyboard 除字幕布局外还有内容变化，不能零调用复用原始旁白"
  );
});

test("候选、运行时和正式公共文件必须是单链接普通文件", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "local-tts-symlink-"));
  try {
    const target = resolve(directory, "target.wav");
    const hardlink = resolve(directory, "hardlink.wav");
    const alias = resolve(directory, "alias.wav");
    await writeFile(target, "test");
    await link(target, hardlink);
    await assert.rejects(
      assertNoSymlinkRegularFile(target, directory),
      (error) => error.code === "local_tts_candidate_symlink_rejected"
    );
    await symlink(target, alias);
    await assert.rejects(
      assertNoSymlinkRegularFile(alias, directory),
      (error) => error.code === "local_tts_candidate_symlink_rejected"
    );
    await assert.rejects(
      inspectLocalOfflineTtsCandidate(episodeId, verifierOptions({
        lstat: async (path) => path.endsWith(
          LOCAL_OFFLINE_TTS_V002_REGISTRATION.manifestFileName
        )
          ? {
              size: 1,
              nlink: 1,
              isFile: () => false,
              isSymbolicLink: () => true
            }
          : verifierOptions().lstat(path)
      })),
      (error) => error.code === "local_tts_candidate_symlink_rejected"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("正式登记只接受 inspect 返回的精确哈希，不接受客户端 actor、时间或路径", async () => {
  const inspected = await inspectLocalOfflineTtsCandidate(episodeId, verifierOptions());
  const store = fakeStore(isolatedEpisode());
  const options = verifierOptions(store);
  for (const extra of [
    { approvedBy: "someone" },
    { approvedAt: "2026-08-14T00:00:00.000Z" },
    { path: "/tmp/voice.wav" }
  ]) {
    await assert.rejects(
      registerApprovedLocalOfflineTts(episodeId, {
        ...inspected.registrationRequest,
        ...extra
      }),
      (error) => error.code === "local_tts_registration_scope_invalid"
    );
  }
  for (const [field, value, expectedCode] of [
    ["candidateHash", "0".repeat(64), "local_tts_candidate_verification_conflict"],
    ["machineVerificationId", "1".repeat(64), "local_tts_candidate_verification_conflict"],
    ["machineVerificationHash", "2".repeat(64), "local_tts_candidate_verification_conflict"],
    ["manifestSha256", "3".repeat(64), "local_tts_candidate_conflict"]
  ]) {
    await assert.rejects(
      registerApprovedLocalOfflineTts(episodeId, {
        ...inspected.registrationRequest,
        [field]: value
      }, options),
      (error) => error.code === expectedCode
    );
  }
  assert.equal(store.writes.length, 0);
});

test("候选单字节变化、脚本审批失效或素材批准漂移都会在复制前拒绝", async () => {
  const source = isolatedEpisode();
  const inspected = await inspectLocalOfflineTtsCandidate(episodeId, verifierOptions());
  for (const fileName of [
    LOCAL_OFFLINE_TTS_V002_REGISTRATION.manifestFileName,
    LOCAL_OFFLINE_TTS_V002_REGISTRATION.wavFileName
  ]) {
    const store = fakeStore(source);
    const options = verifierOptions({
      ...store,
      readFile: async (path) => {
        const data = await fixtureReadFile(path);
        if (!path.endsWith(fileName)) return data;
        const tampered = Buffer.from(data);
        tampered[Math.min(100, tampered.length - 1)] ^= 1;
        return tampered;
      }
    });
    await assert.rejects(
      registerApprovedLocalOfflineTts(episodeId, inspected.registrationRequest, options),
      /哈希不匹配/u
    );
    assert.equal(store.writes.length, 0);
  }

  const staleScript = structuredClone(source);
  staleScript.approvals.script.status = "pending";
  await assert.rejects(
    inspectLocalOfflineTtsCandidate(episodeId, verifierOptions({ episode: staleScript })),
    (error) => error.code === "local_tts_source_approval_stale"
  );
  const staleStoryboard = structuredClone(source);
  staleStoryboard.approvals.storyboard.status = "pending";
  await assert.rejects(
    inspectLocalOfflineTtsCandidate(episodeId, verifierOptions({ episode: staleStoryboard })),
    (error) => error.code === "local_tts_source_approval_stale"
  );
  const staleAsset = structuredClone(source);
  staleAsset.reviewCheckpoints.assetExecution.humanApproval.candidateHash = "0".repeat(64);
  await assert.rejects(
    inspectLocalOfflineTtsCandidate(episodeId, verifierOptions({ episode: staleAsset })),
    (error) => error.code === "local_tts_asset_approval_stale"
  );
});

test("目标版本竞态已存在时不覆盖原文件，并清理临时文件与操作锁", async () => {
  const source = isolatedEpisode();
  const inspected = await inspectLocalOfflineTtsCandidate(episodeId, verifierOptions());
  const directory = await mkdtemp(resolve(studioRoot, ".test-local-tts-existing-"));
  const destination = resolve(directory, "voice-v001.wav");
  const original = Buffer.from("pre-existing-do-not-overwrite");
  await writeFile(destination, original, { flag: "wx" });
  const store = fakeStore(source);
  const options = verifierOptions({
    ...store,
    temporaryRoots: [directory],
    episodePublicDirectory: () => directory,
    readdir: async () => []
  });
  try {
    await assert.rejects(
      registerApprovedLocalOfflineTts(episodeId, inspected.registrationRequest, options),
      (error) => error.code === "EEXIST"
    );
    assert.deepEqual(await readFile(destination), original);
    await assert.rejects(
      lstat(`${destination}.registering`),
      (error) => error.code === "ENOENT"
    );
    assert.equal(store.episode.control.activeOperation, null);
    assert.equal(store.episode.voice.status, "unconfigured");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("复制后复验或最终 Episode 写入失败都会删除新 WAV 并释放操作锁", async () => {
  const source = isolatedEpisode();
  const inspected = await inspectLocalOfflineTtsCandidate(episodeId, verifierOptions());
  for (const failure of ["copy-verification", "final-write"]) {
    const directory = await mkdtemp(resolve(studioRoot, `.test-local-tts-${failure}-`));
    let state = structuredClone(source);
    const options = verifierOptions({
      temporaryRoots: [directory],
      episodePublicDirectory: () => directory,
      readEpisode: async () => structuredClone(state),
      writeEpisode: async (next) => {
        if (failure === "final-write" && next.voice?.mode === "local-offline-tts") {
          throw new Error("test final write failed");
        }
        state = structuredClone(next);
      },
      appendEvent: async () => undefined,
      readFile: async (path) => {
        const data = await fixtureReadFile(path, createFixtureAccessContext({
          temporaryRoots: [directory]
        }));
        if (failure !== "copy-verification" || !path.startsWith(`${directory}/`)) return data;
        const tampered = Buffer.from(data);
        tampered[100] ^= 1;
        return tampered;
      }
    });
    try {
      await assert.rejects(
        registerApprovedLocalOfflineTts(episodeId, inspected.registrationRequest, options),
        failure === "copy-verification" ? /复制后的文件复验失败/u : /test final write failed/u
      );
      assert.deepEqual(await readdir(directory), []);
      assert.equal(state.control.activeOperation, null);
      assert.equal(state.voice.status, "unconfigured");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("v002 版本化登记、复制后复验、授权绑定与 Assets Gate happy path 全部通过", async () => {
  const source = isolatedEpisode();
  const beforeLedger = ledgerSnapshot(source);
  const inspected = await inspectLocalOfflineTtsCandidate(episodeId, verifierOptions());
  const directory = await mkdtemp(resolve(studioRoot, ".test-local-tts-public-"));
  const events = new Map();
  const store = fakeStore(source, async (event) => {
    if (!events.has(event.idempotencyKey)) events.set(event.idempotencyKey, structuredClone(event));
  });
  const options = verifierOptions({
    ...store,
    temporaryRoots: [directory],
    episodePublicDirectory: () => directory,
    now: new Date("2026-08-14T12:00:00.000Z")
  });
  try {
    const result = await registerApprovedLocalOfflineTts(
      episodeId,
      inspected.registrationRequest,
      options
    );
    assert.equal(result.unchanged, false);
    assert.equal(result.episode.voice.mode, "local-offline-tts");
    assert.equal(result.episode.voice.status, "ready");
    assert.equal(result.episode.voice.provenance.candidateHash, inspected.candidateHash);
    assert.deepEqual(
      result.episode.voice.provenance.machineVerification,
      inspected.machineVerification
    );
    assert.deepEqual(
      result.episode.voice.provenance.humanSelection,
      result.episode.voice.authorization
    );
    assert.equal(result.episode.voice.authorization.approvedBy, "Zhengjiazhi");
    assert.equal(result.episode.voice.authorization.approvedAt, "2026-08-14T12:00:00.000Z");
    assert.equal(result.episode.voice.authorization.candidateHash, inspected.candidateHash);
    assert.equal(
      result.episode.voice.authorization.machineVerificationHash,
      inspected.machineVerification.verificationHash
    );
    assert.match(result.episode.voice.authorization.verificationId, /^[a-f0-9]{64}$/u);
    assert.equal(result.episode.approvals.assets.status, "pending");
    assert.equal(result.episode.approvals.final.status, "pending");
    assert.equal(result.episode.reviews.assets.status, "not_started");
    assert.equal(result.episode.reviews.final.status, "not_started");
    assert.equal(
      result.episode.pipeline.find((step) => step.agent === "voice-agent").status,
      "ready"
    );
    assert.deepEqual(ledgerSnapshot(result.episode), beforeLedger);
    assert.equal(events.size, 1);

    const registered = await verifyRegisteredLocalOfflineVoiceForAssets(result.episode, options);
    assert.equal(registered.candidateHash, inspected.candidateHash);
    assert.equal(registered.machineVerificationHash, inspected.machineVerification.verificationHash);
    const publicFile = await lstat(registered.path);
    assert.equal(publicFile.isSymbolicLink(), false);
    assert.equal(publicFile.nlink, 1);
    assert.equal(publicFile.size, 2_880_044);

    const assetsChecks = await validateAssetsForReview(result.episode, options);
    const localChecks = assetsChecks.filter((check) => check.code.startsWith(
      "voice-local-offline-"
    ));
    assert.equal(localChecks.length, 3);
    assert.equal(localChecks.every((check) => check.passed), true);

    const schemaEpisode = structuredClone(result.episode);
    const fileName = schemaEpisode.voice.publicPath.split("/").at(-1);
    schemaEpisode.voice.audioPath = `studio/public/episodes/${episodeId}/${fileName}`;
    assert.deepEqual(validateEpisode(schemaEpisode), { valid: true, errors: [] });

    const idempotent = await registerApprovedLocalOfflineTts(
      episodeId,
      inspected.registrationRequest,
      options
    );
    assert.equal(idempotent.unchanged, true);
    assert.equal(events.size, 1);

    const dispatched = structuredClone(result.episode);
    dispatched.dispatchHistory.push({
      id: "dispatch:test:voice-agent",
      agentId: "voice-agent",
      status: "running",
      at: "2026-08-14T12:00:01.000Z"
    });
    const afterDispatch = await verifyRegisteredLocalOfflineVoiceForAssets(dispatched, options);
    assert.equal(afterDispatch.candidateHash, inspected.candidateHash);

    const carried = withApprovedLocalOnlyAssetCandidate(dispatched);
    assert.equal(assetExecutionApprovalValid(carried), true);
    const carriedReview = await verifyRegisteredLocalOfflineVoiceForAssets(
      carried,
      verifierOptions({
        ...options,
        validateAssetExecutionApproval: undefined
      })
    );
    assert.equal(carriedReview.candidateHash, inspected.candidateHash);
    assert.equal(carriedReview.reusedAcrossAssetExecutionCandidate, true);
    assert.equal(carriedReview.sourceAssetExecution.version, 9);
    assert.equal(carriedReview.currentAssetExecution.version, 10);
    assert.equal(carriedReview.reuseAttestation.reused, true);
    const {
      verificationHash: reuseVerificationHash,
      ...reuseAttestationPayload
    } = carriedReview.reuseAttestation;
    assert.equal(
      reuseVerificationHash,
      integrityHash(reuseAttestationPayload)
    );
    const carriedAssetsChecks = await validateAssetsForReview(
      carried,
      verifierOptions({
        ...options,
        validateAssetExecutionApproval: undefined
      })
    );
    const carriedVoiceCheck = carriedAssetsChecks.find(
      (check) => check.code === "voice-local-offline-provenance"
    );
    assert.equal(carriedVoiceCheck.passed, true);
    assert.equal(carriedVoiceCheck.actual.reuseAttestation.reused, true);
    assert.equal(
      carriedVoiceCheck.actual.reuseAttestation.verificationHash,
      reuseVerificationHash
    );

    const unsafeCarry = structuredClone(carried);
    unsafeCarry.production.assetPlan.content.items[0]
      .productionMethod.externalProvider = "forbidden-provider";
    rebindAssetPlanHash(unsafeCarry, "unsafe-provider");
    await assert.rejects(
      verifyRegisteredLocalOfflineVoiceForAssets(
        unsafeCarry,
        verifierOptions({
          ...options,
          validateAssetExecutionApproval: undefined
        })
      ),
      (error) => error.code === "local_tts_asset_reuse_scope_invalid"
    );

    const staleCarryScript = structuredClone(carried);
    staleCarryScript.approvals.script.status = "pending";
    await assert.rejects(
      verifyRegisteredLocalOfflineVoiceForAssets(
        staleCarryScript,
        verifierOptions({
          ...options,
          validateAssetExecutionApproval: undefined
        })
      ),
      (error) => error.code === "local_tts_source_approval_stale"
    );

    const alteredSourceBinding = structuredClone(carried);
    alteredSourceBinding.voice.provenance.sourceBindings.assetExecution.planHash = "f".repeat(64);
    await assert.rejects(
      verifyRegisteredLocalOfflineVoiceForAssets(
        alteredSourceBinding,
        verifierOptions({
          ...options,
          validateAssetExecutionApproval: undefined
        })
      ),
      /原始素材执行候选绑定不匹配/u
    );

    for (const mutateProviderLedger of [
      (episode) => { episode.control.budget.usedCalls = 1; },
      (episode) => { episode.production.ai.requestCount = 1; },
      (episode) => { episode.routingHistory.push({ id: "provider-route:test" }); }
    ]) {
      const providerDrift = structuredClone(dispatched);
      mutateProviderLedger(providerDrift);
      await assert.rejects(
        verifyRegisteredLocalOfflineVoiceForAssets(providerDrift, options),
        (error) => error.code === "local_tts_zero_call_ledger_invalid"
      );
    }

    const tampered = structuredClone(result.episode);
    tampered.voice.authorization.candidateHash = "f".repeat(64);
    await assert.rejects(
      verifyRegisteredLocalOfflineVoiceForAssets(tampered, options),
      (error) => error.code === "local_tts_registered_provenance_invalid"
        || error.code === "local_tts_registered_authorization_invalid"
    );
    const failedChecks = await validateAssetsForReview(tampered, options);
    assert.equal(
      failedChecks.filter((check) => check.code.startsWith("voice-local-offline-"))
        .every((check) => !check.passed),
      true
    );

    const assetsHash = currentGateArtifactHash(result.episode, "assets");
    const changed = structuredClone(result.episode);
    changed.voice.provenance.candidateHash = "a".repeat(64);
    assert.notEqual(currentGateArtifactHash(changed, "assets"), assetsHash);
    changed.voice.provenance.candidateHash = result.episode.voice.provenance.candidateHash;
    changed.voice.authorization.machineVerificationId = "b".repeat(64);
    assert.notEqual(currentGateArtifactHash(changed, "assets"), assetsHash);
    changed.voice.authorization.machineVerificationId =
      result.episode.voice.authorization.machineVerificationId;
    changed.voice.verification.verificationHash = "c".repeat(64);
    assert.notEqual(currentGateArtifactHash(changed, "assets"), assetsHash);
    changed.voice.verification.verificationHash =
      result.episode.voice.verification.verificationHash;
    changed.voice.sampleRate = 48_000;
    assert.notEqual(currentGateArtifactHash(changed, "assets"), assetsHash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("状态已提交但审计事件暂时失败时，重试会幂等补写事件", async () => {
  const source = isolatedEpisode();
  const inspected = await inspectLocalOfflineTtsCandidate(episodeId, verifierOptions());
  const directory = await mkdtemp(resolve(studioRoot, ".test-local-tts-event-"));
  let eventAttempts = 0;
  const events = new Map();
  const store = fakeStore(source, async (event) => {
    eventAttempts += 1;
    if (eventAttempts === 1) throw new Error("test audit unavailable");
    if (!events.has(event.idempotencyKey)) events.set(event.idempotencyKey, structuredClone(event));
  });
  const options = verifierOptions({
    ...store,
    temporaryRoots: [directory],
    episodePublicDirectory: () => directory,
    now: new Date("2026-08-14T12:01:00.000Z")
  });
  try {
    await assert.rejects(
      registerApprovedLocalOfflineTts(episodeId, inspected.registrationRequest, options),
      /test audit unavailable/u
    );
    assert.equal(store.episode.voice.mode, "local-offline-tts");
    const retry = await registerApprovedLocalOfflineTts(
      episodeId,
      inspected.registrationRequest,
      options
    );
    assert.equal(retry.unchanged, true);
    assert.equal(eventAttempts, 2);
    assert.equal(events.size, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
