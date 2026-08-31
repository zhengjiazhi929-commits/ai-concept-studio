import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";

import * as chunkedRenderer from "../scripts/render-agent-skill-long-review-wide-v004-chunked.mjs";

import {
  CHUNKED_LONG_REVIEW_SCHEMAS,
  CHUNKED_REMOTION_TIMEOUT_MS,
  CHUNKED_V004_CONTRACT,
  attemptScopedPartPath,
  assertResumableRunManifest,
  buildChunkRanges,
  buildConcatFfmpegArgs,
  buildMuxFfmpegArgs,
  confirmLongReviewPublicationDurability,
  evaluateChunkProbe,
  evaluateConcatenatedProbe,
  evaluateFinalProbe,
  isChunkResumeEligible,
  inspectLongReviewPublication,
  parseCliArguments,
  renderAgentSkillLongReviewWideV004Chunked,
  reportPublishedLongReviewPublication,
  sha256Text,
  stableStringify,
  usageText,
} from "../scripts/render-agent-skill-long-review-wide-v004-chunked.mjs";

test("分段渲染为 composition 与 media 共用显式 Remotion 超时预算", async () => {
  assert.equal(CHUNKED_REMOTION_TIMEOUT_MS, 180_000);
  assert.equal(
    CHUNKED_V004_CONTRACT.remotionTimeoutMs,
    CHUNKED_REMOTION_TIMEOUT_MS,
  );
  assert.equal(CHUNKED_V004_CONTRACT.fontAssetDelivery, "bundled-resource");
  assert.equal(
    CHUNKED_V004_CONTRACT.fontReadiness,
    "remotion-document-fonts-ready",
  );
  const source = await readFile(
    resolve(
      import.meta.dirname,
      "..",
      "scripts",
      "render-agent-skill-long-review-wide-v004-chunked.mjs",
    ),
    "utf8",
  );
  assert.equal(
    (source.match(
      /timeoutInMilliseconds: CHUNKED_REMOTION_TIMEOUT_MS/gu,
    ) ?? []).length,
    2,
    "selectComposition 与 renderMedia 必须使用同一个显式 Remotion 超时预算",
  );
  assert.doesNotMatch(source, /inlineBundledFontsWebpackOverride/u);
  assert.doesNotMatch(source, /type:\s*["']asset\/inline["']/u);
});

function publicationManifest(runFingerprint = "a".repeat(64)) {
  return {
    schemaVersion: CHUNKED_LONG_REVIEW_SCHEMAS.finalManifest,
    runFingerprint,
    contract: {
      jobId: CHUNKED_V004_CONTRACT.jobId,
      candidateVersion: CHUNKED_V004_CONTRACT.candidateVersion,
      episodeId: CHUNKED_V004_CONTRACT.episodeId,
      compositionId: CHUNKED_V004_CONTRACT.compositionId,
    },
  };
}

async function addPendingMarkerFromReceipt(finalDirectory, {removeReceipt = false} = {}) {
  const receiptPath = resolve(finalDirectory, "publication-durable-receipt.json");
  const pendingPath = resolve(finalDirectory, "publication-durability-unknown.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  await writeFile(
    pendingPath,
    `${JSON.stringify({...receipt, kind: "durability_unknown"}, null, 2)}\n`,
    {encoding: "utf8", flag: "wx"},
  );
  if (removeReceipt) await unlink(receiptPath);
  return {pendingPath, receiptPath};
}

async function createPublicationFixture({
  root,
  bytes = Buffer.from("validated-media-fixture"),
  runFingerprint = "a".repeat(64),
  attemptToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  receipt = true,
  pending = false,
}) {
  const finalDirectory = resolve(root, "formal-v004");
  const outputPath = resolve(finalDirectory, "review-10m.mp4");
  const manifestPath = resolve(finalDirectory, "review-manifest.json");
  await mkdir(finalDirectory, {recursive: false});
  const manifest = publicationManifest(runFingerprint);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const integrity = {bytes: bytes.length, sha256: sha256Text(bytes)};
  await Promise.all([
    writeFile(outputPath, bytes),
    writeFile(manifestPath, manifestBytes),
  ]);
  const jobBinding = {
    finalManifestSchemaVersion: manifest.schemaVersion,
    runFingerprint: manifest.runFingerprint,
    jobId: manifest.contract.jobId,
    candidateVersion: manifest.contract.candidateVersion,
    episodeId: manifest.contract.episodeId,
    compositionId: manifest.contract.compositionId,
  };
  const identity = {
    attemptToken,
    output: {
      fileName: "review-10m.mp4",
      ...integrity,
    },
    manifest: {
      fileName: "review-manifest.json",
      sha256: sha256Text(manifestBytes),
    },
    jobBinding,
    jobBindingSha256: sha256Text(stableStringify(jobBinding)),
  };
  const marker = (kind) => ({
    schemaVersion: CHUNKED_LONG_REVIEW_SCHEMAS.publicationState,
    kind,
    ...identity,
    recordedAt: "2026-08-31T10:00:00.000Z",
  });
  if (receipt) {
    await writeFile(
      resolve(finalDirectory, CHUNKED_LONG_REVIEW_SCHEMAS.publicationReceiptFileName),
      `${JSON.stringify(marker("durable_receipt"), null, 2)}\n`,
    );
  }
  if (pending) {
    await writeFile(
      resolve(finalDirectory, CHUNKED_LONG_REVIEW_SCHEMAS.publicationPendingFileName),
      `${JSON.stringify(marker("durability_unknown"), null, 2)}\n`,
    );
  }
  return {finalDirectory, outputPath, manifestPath, integrity, manifest, bytes};
}

test("attempt 路径隔离且 direct import 没有根外删除能力", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "long-render-attempt-parts-"));
  const firstToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const secondToken = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const stablePath = resolve(root, "chunk-00.part.mp4");
  const firstPart = attemptScopedPartPath(stablePath, firstToken);
  const secondPart = attemptScopedPartPath(stablePath, secondToken);
  const outsideFile = resolve(root, `outside.attempt-${firstToken}.txt`);
  const outsideDirectory = resolve(root, `outside-dir.attempt-${firstToken}`);
  const outsideChild = resolve(outsideDirectory, "must-survive.txt");
  try {
    assert.notEqual(firstPart, secondPart);
    assert.match(firstPart, /\.attempt-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\.mp4$/u);
    assert.match(secondPart, /\.attempt-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb\.mp4$/u);
    assert.equal(chunkedRenderer.registerActivePart, undefined);
    assert.equal(chunkedRenderer.cleanupActiveParts, undefined);
    await mkdir(outsideDirectory);
    await Promise.all([
      writeFile(outsideFile, "outside-file", "utf8"),
      writeFile(outsideChild, "outside-directory", "utf8"),
    ]);
    const attack = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          "import * as renderer from './scripts/render-agent-skill-long-review-wide-v004-chunked.mjs';",
          `const token = ${JSON.stringify(firstToken)};`,
          `const targets = ${JSON.stringify([outsideFile, outsideDirectory])};`,
          "if (typeof renderer.registerActivePart === 'function' && typeof renderer.cleanupActiveParts === 'function') {",
          "  for (const target of targets) renderer.registerActivePart(target, token);",
          "  await renderer.cleanupActiveParts(token);",
          "}",
        ].join("\n"),
      ],
      {cwd: resolve(import.meta.dirname, ".."), encoding: "utf8"},
    );
    assert.equal(attack.status, 0, attack.stderr);
    assert.equal(await readFile(outsideFile, "utf8"), "outside-file");
    assert.equal(await readFile(outsideChild, "utf8"), "outside-directory");
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("chunk worker 只写 attempt part，稳定 chunk 与 metadata 由持锁 parent 发布", async () => {
  const source = await readFile(
    resolve(
      import.meta.dirname,
      "..",
      "scripts",
      "render-agent-skill-long-review-wide-v004-chunked.mjs",
    ),
    "utf8",
  );
  const workerStart = source.indexOf("async function renderChunkWorker(options)");
  const workerEnd = source.indexOf("function concatEscape", workerStart);
  assert.ok(workerStart >= 0 && workerEnd > workerStart);
  const workerSource = source.slice(workerStart, workerEnd);
  assert.match(workerSource, /bindLongReviewRenderWorkerToParent/u);
  assert.match(workerSource, /const attemptCapability = activateAttempt\(attemptToken\)/u);
  assert.match(workerSource, /await cleanupActiveParts\(attemptCapability\)/u);
  assert.match(workerSource, /deactivateAttempt\(attemptCapability\)/u);
  assert.doesNotMatch(workerSource, /paths\.(?:output|metadata)\b/u);
  assert.doesNotMatch(workerSource, /rename\s*\(/u);
  assert.doesNotMatch(workerSource, /writeJsonAtomically\s*\(/u);

  const parentStart = source.indexOf("async function runChunkWorker(");
  const parentEnd = source.indexOf("async function renderChunkWorker", parentStart);
  const parentSource = source.slice(parentStart, parentEnd);
  assert.match(parentSource, /jobLock\.publishAttemptPair/u);
  assert.match(parentSource, /jobLock\.assertOwned\(\)/u);

  const rendererStart = source.indexOf(
    "export async function renderAgentSkillLongReviewWideV004Chunked",
  );
  const rendererEnd = source.indexOf("async function main()", rendererStart);
  const rendererSource = source.slice(rendererStart, rendererEnd);
  assert.match(
    rendererSource,
    /publicationDirectory:\s*CHUNKS_DIRECTORY/u,
  );
  assert.match(rendererSource, /const attemptCapability = activateAttempt\(attemptToken\)/u);
  assert.match(rendererSource, /await cleanupActiveParts\(attemptCapability\)/u);
  assert.match(rendererSource, /deactivateAttempt\(attemptCapability\)/u);

  const cleanupStart = source.indexOf("async function assertSafeAttemptPartParent");
  const cleanupEnd = source.indexOf("async function terminate", cleanupStart);
  const cleanupSource = source.slice(cleanupStart, cleanupEnd);
  assert.match(cleanupSource, /assertAttemptPartPath\(filePath, attemptToken\)/u);
  assert.match(cleanupSource, /isSymbolicLink\(\)/u);
  assert.match(cleanupSource, /activeAttemptCapability !== capability/u);
});

function validProbe({frames = 900, seconds = 30, withAudio = false} = {}) {
  const streams = [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
      codec_long_name: "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
      profile: "High",
      codec_tag_string: "avc1",
      codec_tag: "0x31637661",
      width: 1920,
      height: 1080,
      coded_width: 1920,
      coded_height: 1080,
      has_b_frames: 2,
      pix_fmt: "yuv420p",
      level: 40,
      color_range: "tv",
      color_space: "bt709",
      color_transfer: "bt709",
      color_primaries: "bt709",
      chroma_location: "left",
      field_order: "progressive",
      refs: 1,
      is_avc: "true",
      nal_length_size: "4",
      bits_per_raw_sample: "8",
      r_frame_rate: "30/1",
      avg_frame_rate: "30/1",
      time_base: "1/15360",
      duration: String(seconds),
      nb_frames: String(frames),
      nb_read_frames: String(frames),
    },
  ];
  if (withAudio) {
    streams.push({
      index: 1,
      codec_type: "audio",
      codec_name: "aac",
      sample_rate: "48000",
    });
  }
  return {
    format: {format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: String(seconds)},
    streams,
  };
}

test("default ranges are 20 absolute inclusive 900-frame chunks", () => {
  const ranges = buildChunkRanges();
  assert.equal(ranges.length, 20);
  assert.deepEqual(ranges[0], {
    index: 0,
    start: 0,
    end: 899,
    frameCount: 900,
    durationSeconds: 30,
  });
  assert.deepEqual(ranges.at(-1), {
    index: 19,
    start: 17_100,
    end: 17_999,
    frameCount: 900,
    durationSeconds: 30,
  });
  for (let index = 1; index < ranges.length; index += 1) {
    assert.equal(ranges[index - 1].end + 1, ranges[index].start);
  }
});

test("900 frame CLI mode creates 20 exact 30-second chunks and records pause", () => {
  const options = parseCliArguments([
    "--chunk-frames",
    "900",
    "--inter-chunk-pause-ms=2500",
  ]);
  assert.equal(options.chunkFrames, 900);
  assert.equal(options.interChunkPauseMs, 2_500);
  const ranges = buildChunkRanges({chunkFrames: options.chunkFrames});
  assert.equal(ranges.length, 20);
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges[0].end, 899);
  assert.equal(ranges[0].durationSeconds, 30);
  assert.equal(ranges.at(-1).start, 17_100);
  assert.equal(ranges.at(-1).end, 17_999);
  assert.throws(() => buildChunkRanges({chunkFrames: 1_001}), /must divide/u);
  assert.match(usageText(), /taskpolicy -b nice -n 20/u);
});

test("chunk validation requires exact frames, duration, codec, dimensions and no audio", () => {
  const range = buildChunkRanges()[0];
  const valid = evaluateChunkProbe(validProbe(), range);
  assert.equal(valid.valid, true);
  assert.equal(valid.media.frameCount, 900);
  assert.equal(valid.media.audioStreamCount, 0);

  const audio = evaluateChunkProbe(validProbe({withAudio: true}), range);
  assert.equal(audio.valid, false);
  assert.equal(audio.checks.noAudio, false);

  const short = evaluateChunkProbe(validProbe({frames: 899}), range);
  assert.equal(short.valid, false);
  assert.equal(short.checks.exactFrames, false);

  const differentCodec = structuredClone(validProbe());
  differentCodec.streams[0].profile = "Main";
  const mismatch = evaluateChunkProbe(
    differentCodec,
    range,
    valid.media.codecMetadata,
  );
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.checks.sameCodecMetadata, false);
});

test("concat and final predicates require exactly 18000 frames/600s and final AAC 48k", () => {
  const videoOnly = validProbe({frames: 18_000, seconds: 600});
  const concatenated = evaluateConcatenatedProbe(videoOnly);
  assert.equal(concatenated.valid, true);
  const final = evaluateFinalProbe(
    validProbe({frames: 18_000, seconds: 600, withAudio: true}),
    concatenated.media.codecMetadata,
  );
  assert.equal(final.valid, true);
  const wrongRate = validProbe({frames: 18_000, seconds: 600, withAudio: true});
  wrongRate.streams[1].sample_rate = "44100";
  const invalidFinal = evaluateFinalProbe(
    wrongRate,
    concatenated.media.codecMetadata,
  );
  assert.equal(invalidFinal.valid, false);
  assert.equal(invalidFinal.checks.audio48k, false);
});

test("resume binds media inputs and chunk size while scheduling pause may change", () => {
  const range = buildChunkRanges()[0];
  const validation = evaluateChunkProbe(validProbe(), range);
  const integrity = {bytes: 123_456, sha256: "a".repeat(64)};
  const record = {
    schemaVersion: "agent-skill-long-review-wide-v004-chunk-v1",
    runFingerprint: "b".repeat(64),
    chunkFrames: 900,
    range,
    file: integrity,
    probeSha256: validation.probeSha256,
    codecMetadata: validation.media.codecMetadata,
  };
  const arguments_ = {
    record,
    runFingerprint: record.runFingerprint,
    range,
    integrity,
    validation,
    expectedCodecMetadata: validation.media.codecMetadata,
    chunkFrames: 900,
  };
  assert.equal(isChunkResumeEligible(arguments_), true);
  assert.equal(
    isChunkResumeEligible({...arguments_, integrity: {...integrity, bytes: 1}}),
    false,
  );
  assert.equal(
    isChunkResumeEligible({...arguments_, runFingerprint: "c".repeat(64)}),
    false,
  );
  assert.equal(
    isChunkResumeEligible({...arguments_, chunkFrames: 1_800}),
    false,
  );
  assert.equal(
    isChunkResumeEligible({...arguments_, interChunkPauseMs: 60_000}),
    true,
  );
  assert.equal(
    isChunkResumeEligible({
      ...arguments_,
      record: {...record, probeSha256: "d".repeat(64)},
    }),
    false,
  );
});

test("run manifest 重算 payload 指纹并拒绝 ranges、schema 或 immutable 字段篡改", () => {
  const fingerprintPayload = {
    contract: {schemaVersion: "fixture-contract"},
    renderConfig: {chunkFrames: 900},
    source: {sha256: "a".repeat(64)},
    git: {headSha: "b".repeat(40)},
    runtime: {node: {version: "v24.19.0"}, chrome: {version: "fixture"}},
    voice: {sha256: "c".repeat(64)},
    safety: {protectedArtifacts: []},
    inputFingerprint: "d".repeat(64),
    runtimeFingerprint: "e".repeat(64),
    bundle: {sha256: "f".repeat(64)},
    tools: {versionsSha256: "1".repeat(64)},
    ranges: buildChunkRanges()
  };
  const expected = {
    schemaVersion: CHUNKED_V004_CONTRACT.schemaVersion,
    createdAt: "2026-08-31T00:00:00.000Z",
    runFingerprint: sha256Text(stableStringify(fingerprintPayload)),
    ...fingerprintPayload,
    scheduleConfig: {interChunkPauseMs: 5_000},
    paths: {finalOutput: "fixture/review-10m.mp4"},
    codecParameters: {chunkRender: {concurrency: 1}}
  };
  assert.equal(assertResumableRunManifest(structuredClone(expected), expected).runFingerprint,
    expected.runFingerprint);

  const payloadTampered = structuredClone(expected);
  payloadTampered.ranges[0].end = 450;
  assert.throws(
    () => assertResumableRunManifest(payloadTampered, expected),
    /payload does not match/u
  );

  const selfConsistentButWrong = structuredClone(payloadTampered);
  const {
    schemaVersion: _schemaVersion,
    createdAt: _createdAt,
    runFingerprint: _runFingerprint,
    scheduleConfig: _scheduleConfig,
    paths: _paths,
    codecParameters: _codecParameters,
    ...tamperedFingerprintPayload
  } = selfConsistentButWrong;
  selfConsistentButWrong.runFingerprint = sha256Text(
    stableStringify(tamperedFingerprintPayload)
  );
  assert.throws(
    () => assertResumableRunManifest(selfConsistentButWrong, expected),
    /immutable fields/u
  );

  const wrongSchema = {...expected, schemaVersion: "other-schema"};
  assert.throws(
    () => assertResumableRunManifest(wrongSchema, expected),
    /schema does not match/u
  );
});

test("ffmpeg contracts use concat stream copy and exact 48k/28800000-sample AAC mux", () => {
  const concat = buildConcatFfmpegArgs("list.txt", "video.part.mp4").join(" ");
  assert.match(concat, /-f concat/u);
  assert.match(concat, /-c:v copy/u);
  assert.match(concat, /-an/u);
  const mux = buildMuxFfmpegArgs(
    "video.mp4",
    "voice.wav",
    "review.part.mp4",
  ).join(" ");
  assert.match(
    mux,
    /aresample=48000,apad=whole_len=28800000,atrim=end_sample=28800000,asetpts=N\/SR\/TB/u,
  );
  assert.match(mux, /-c:v copy/u);
  assert.match(mux, /-c:a aac/u);
  assert.match(mux, /-b:a 192k/u);
  assert.match(mux, /-movflags \+faststart/u);
  assert.match(mux, /-t 600/u);
});

test("low-level publisher is private so direct imports cannot publish arbitrary bytes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004-direct-publish-attack-"));
  const finalDirectory = resolve(root, "formal-v004");
  try {
    assert.equal(chunkedRenderer.publishValidatedOutputAtomically, undefined);
    const maliciousPublish = chunkedRenderer.publishValidatedOutputAtomically;
    assert.throws(
      () => maliciousPublish({
        stagedVideoPath: resolve(root, "malicious.mp4"),
        finalDirectory,
        stagingDirectory: resolve(root, "staging"),
        manifest: publicationManifest(),
        expectedIntegrity: {bytes: 1, sha256: "0".repeat(64)},
      }),
      TypeError,
    );
    await assert.rejects(readFile(resolve(finalDirectory, "review-10m.mp4")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("direct-import confirm rejects zero-fsync injection and only real fsync may recover unknown", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004-publication-recovery-"));
  const finalDirectory = resolve(root, "formal-v004");
  const attemptToken = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const bytes = Buffer.from("post-rename-durability-fixture");

  try {
    const publication = await createPublicationFixture({
      root,
      bytes,
      runFingerprint: "b".repeat(64),
      attemptToken,
    });
    assert.deepEqual(await readFile(publication.outputPath), bytes);
    await addPendingMarkerFromReceipt(finalDirectory, {removeReceipt: true});

    const unknown = await inspectLongReviewPublication(finalDirectory);
    assert.equal(unknown.valid, true);
    assert.equal(unknown.recoverable, true);
    assert.equal(unknown.pendingValid, true);
    assert.equal(unknown.durableReceiptValid, false);

    await assert.rejects(
      confirmLongReviewPublicationDurability(finalDirectory, {
        syncFile: async () => undefined,
        syncDirectory: async () => undefined,
      }),
      (error) => error instanceof TypeError && /dependency injection/u.test(error.message),
    );
    const stillUnknown = await inspectLongReviewPublication(finalDirectory);
    assert.equal(stillUnknown.pendingValid, true);
    assert.equal(stillUnknown.durableReceiptValid, false);
    const reportAttempt = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          "import {reportPublishedLongReviewPublication} from './scripts/render-agent-skill-long-review-wide-v004-chunked.mjs';",
          `await reportPublishedLongReviewPublication(${JSON.stringify(finalDirectory)});`,
        ].join("\n"),
      ],
      {cwd: resolve(import.meta.dirname, ".."), encoding: "utf8"},
    );
    assert.equal(reportAttempt.status, 1);
    assert.doesNotMatch(reportAttempt.stdout, /published/u);
    assert.match(
      reportAttempt.stderr,
      /long_review_publication_durability_unknown/u,
    );

    const confirmed = await confirmLongReviewPublicationDurability(finalDirectory);
    assert.equal(confirmed.commitStatus, "committed");
    assert.equal(confirmed.durability.durable, true);
    const recovered = await inspectLongReviewPublication(finalDirectory);
    assert.equal(recovered.valid, true);
    assert.equal(recovered.pendingValid, false);
    assert.equal(recovered.durableReceiptValid, true);
    assert.deepEqual(await readFile(recovered.outputPath), bytes);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("direct-import report rejects a forged durable boolean and prints no published claim", () => {
  const script = [
    "import {reportPublishedLongReviewPublication} from './scripts/render-agent-skill-long-review-wide-v004-chunked.mjs';",
    "await reportPublishedLongReviewPublication({",
    "  finalDirectory: '/tmp/committed-long-review-v008',",
    "  outputPath: '/tmp/committed-long-review-v008/review-10m.mp4',",
    "  integrity: {bytes: 42, sha256: 'a'.repeat(64)},",
    "  durability: {durable: true, status: 'durable'}",
    "});",
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {cwd: resolve(import.meta.dirname, ".."), encoding: "utf8"},
  );
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.doesNotMatch(result.stdout, /published/u);
  assert.match(result.stderr, /exactly one final-directory path/u);
});

test("report re-inspects a positive receipt before printing published", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004-report-positive-receipt-"));
  const finalDirectory = resolve(root, "formal-v004");
  const bytes = Buffer.from("report-positive-receipt-fixture");
  try {
    await createPublicationFixture({
      root,
      bytes,
      runFingerprint: "f".repeat(64),
      attemptToken: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });
    const script = [
      "import {reportPublishedLongReviewPublication} from './scripts/render-agent-skill-long-review-wide-v004-chunked.mjs';",
      `await reportPublishedLongReviewPublication(${JSON.stringify(finalDirectory)});`,
    ].join("\n");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      {cwd: resolve(import.meta.dirname, ".."), encoding: "utf8"},
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^published /u);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("external receipt, pending and manifest symlinks fail closed for report and confirm", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004-publication-symlink-attack-"));
  try {
    for (const attack of ["receipt", "pending", "manifest"]) {
      const caseRoot = resolve(root, attack);
      await mkdir(caseRoot);
      const fixture = await createPublicationFixture({
        root: caseRoot,
        receipt: attack !== "pending",
        pending: attack === "pending",
      });
      const attackedPath = attack === "receipt"
        ? resolve(
            fixture.finalDirectory,
            CHUNKED_LONG_REVIEW_SCHEMAS.publicationReceiptFileName,
          )
        : attack === "pending"
          ? resolve(
              fixture.finalDirectory,
              CHUNKED_LONG_REVIEW_SCHEMAS.publicationPendingFileName,
            )
          : fixture.manifestPath;
      const externalPath = resolve(caseRoot, `external-${attack}.json`);
      const contents = await readFile(attackedPath);
      await writeFile(externalPath, contents);
      await unlink(attackedPath);
      await symlink(externalPath, attackedPath);

      const inspection = await inspectLongReviewPublication(fixture.finalDirectory);
      assert.equal(inspection.valid, false);
      assert.match(inspection.error?.message ?? "", /regular, non-symlink/u);
      await assert.rejects(
        confirmLongReviewPublicationDurability(fixture.finalDirectory),
        /Cannot confirm invalid/u,
      );
      const reportAttempt = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          [
            "import {reportPublishedLongReviewPublication} from './scripts/render-agent-skill-long-review-wide-v004-chunked.mjs';",
            `await reportPublishedLongReviewPublication(${JSON.stringify(fixture.finalDirectory)});`,
          ].join("\n"),
        ],
        {cwd: resolve(import.meta.dirname, ".."), encoding: "utf8"},
      );
      assert.equal(reportAttempt.status, 1);
      assert.doesNotMatch(reportAttempt.stdout, /published/u);
      assert.match(
        reportAttempt.stderr,
        /long_review_publication_durability_unknown/u,
      );
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("media integrity drift invalidates the receipt and cannot be reported or confirmed", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004-publication-integrity-drift-"));
  try {
    const fixture = await createPublicationFixture({root});
    await writeFile(fixture.outputPath, "tampered-media", "utf8");
    const inspection = await inspectLongReviewPublication(fixture.finalDirectory);
    assert.equal(inspection.valid, false);
    assert.equal(inspection.durableReceiptValid, false);
    await assert.rejects(
      confirmLongReviewPublicationDurability(fixture.finalDirectory),
      /Cannot confirm invalid/u,
    );
    const reportAttempt = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          "import {reportPublishedLongReviewPublication} from './scripts/render-agent-skill-long-review-wide-v004-chunked.mjs';",
          `await reportPublishedLongReviewPublication(${JSON.stringify(fixture.finalDirectory)});`,
        ].join("\n"),
      ],
      {cwd: resolve(import.meta.dirname, ".."), encoding: "utf8"},
    );
    assert.equal(reportAttempt.status, 1);
    assert.doesNotMatch(reportAttempt.stdout, /published/u);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("positive durable receipt 不依赖 unknown marker 缺席，清理失败后仍可恢复确认", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "v004-publication-receipt-"));
  const finalDirectory = resolve(root, "formal-v004");
  const attemptToken = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const bytes = Buffer.from("positive-receipt-fixture");

  try {
    const publication = await createPublicationFixture({
      root,
      bytes,
      runFingerprint: "d".repeat(64),
      attemptToken,
    });
    await addPendingMarkerFromReceipt(finalDirectory);
    const withBothMarkers = await inspectLongReviewPublication(finalDirectory);
    assert.equal(withBothMarkers.valid, true);
    assert.equal(withBothMarkers.pendingValid, true);
    assert.equal(withBothMarkers.durableReceiptValid, true);
    assert.deepEqual(await readFile(withBothMarkers.outputPath), bytes);

    const confirmed = await confirmLongReviewPublicationDurability(finalDirectory);
    assert.equal(confirmed.durability.durable, true);
    const recovered = await inspectLongReviewPublication(finalDirectory);
    assert.equal(recovered.pendingValid, false);
    assert.equal(recovered.durableReceiptValid, true);
    await writeFile(
      recovered.manifestPath,
      `${JSON.stringify({
        ...publicationManifest("d".repeat(64)),
        contract: {
          ...publicationManifest("d".repeat(64)).contract,
          jobId: "different-job",
        },
      }, null, 2)}\n`,
      "utf8",
    );
    const tampered = await inspectLongReviewPublication(finalDirectory);
    assert.equal(tampered.valid, false);
    await assert.rejects(
      confirmLongReviewPublicationDurability(finalDirectory),
      /Cannot confirm invalid/u,
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("top-level renderer rejects job-lock injection before touching the work directory", async () => {
  await assert.rejects(
    renderAgentSkillLongReviewWideV004Chunked({jobLockOptions: {}}),
    (error) => error instanceof TypeError && /dependency injection/u.test(error.message),
  );
});

test("contract remains fixed at 1920x1080, 30fps, 18000 frames and low-memory render settings", () => {
  assert.deepEqual(
    {
      width: CHUNKED_V004_CONTRACT.width,
      height: CHUNKED_V004_CONTRACT.height,
      fps: CHUNKED_V004_CONTRACT.fps,
      durationInFrames: CHUNKED_V004_CONTRACT.durationInFrames,
      codec: CHUNKED_V004_CONTRACT.codec,
      pixelFormat: CHUNKED_V004_CONTRACT.pixelFormat,
      concurrency: CHUNKED_V004_CONTRACT.concurrency,
      muted: CHUNKED_V004_CONTRACT.muted,
      enforceAudioTrack: CHUNKED_V004_CONTRACT.enforceAudioTrack,
    },
    {
      width: 1920,
      height: 1080,
      fps: 30,
      durationInFrames: 18_000,
      codec: "h264",
      pixelFormat: "yuv420p",
      concurrency: 1,
      muted: true,
      enforceAudioTrack: false,
    },
  );
  assert.equal(
    sha256Text(stableStringify({chunkFrames: 900, interChunkPauseMs: 2500})),
    sha256Text(stableStringify({interChunkPauseMs: 2500, chunkFrames: 900})),
  );
});
