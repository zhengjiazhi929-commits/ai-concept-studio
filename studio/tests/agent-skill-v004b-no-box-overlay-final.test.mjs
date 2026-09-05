import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import test from "node:test";

import {
  V004B_FINAL_CONTRACT,
  V004B_FINAL_PATHS,
  V004B_FINAL_SCHEMA_VERSION,
  V004B_OVERLAY_SCHEMA_VERSION,
  buildAudioDecodeFfmpegArgs,
  buildAudioMuxFfmpegArgs,
  buildChunkRanges,
  buildConcatFfmpegArgs,
  buildConcatList,
  buildOverlayChunkFfmpegArgs,
  buildVideoDecodeFfmpegArgs,
  assertRequiredOverlayFiltersText,
  assertFormalInputLayout,
  assertFormalOutputLayout,
  evaluateChunkProbe,
  evaluateConcatProbe,
  evaluateFinalProbe,
  evaluateRenderBaseProbe,
  parseCliArguments,
  resolveMediaTool,
  sha256Text,
  stableStringify,
  validateOverlayManifest,
  validateOverlayAssets,
  validateRenderBaseBinding,
} from "../scripts/build-agent-skill-v004b-no-box-final.mjs";


test("字幕合成在长视频预检前拒绝缺少 setpts/overlay 的裁剪 FFmpeg", () => {
  assert.equal(
    assertRequiredOverlayFiltersText(
      " .. setpts            V->V       Set PTS\n TS overlay           VV->V      Overlay video\n",
    ),
    true,
  );
  assert.throws(
    () => assertRequiredOverlayFiltersText(" .. asetpts           A->A\n"),
    /setpts, overlay.*完整系统 FFmpeg/u,
  );
});


test("Homebrew 样式媒体工具链接先解析到版本化普通文件", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "v004b-media-tool-link-"));
  try {
    const target = resolve(directory, "ffmpeg-real");
    const linkPath = resolve(directory, "ffmpeg");
    await writeFile(target, "fixture");
    await symlink("ffmpeg-real", linkPath);
    const tool = await resolveMediaTool("ffmpeg", linkPath);
    assert.equal(tool.path, await realpath(target));
    assert.equal(tool.directory, await realpath(directory));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});


function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}


function videoStream({frames = 900, audio = false} = {}) {
  const streams = [
    {
      index: 0,
      codec_type: "video",
      codec_name: "h264",
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
      field_order: "progressive",
      is_avc: "true",
      nal_length_size: "4",
      bits_per_raw_sample: "8",
      r_frame_rate: "30/1",
      avg_frame_rate: "30/1",
      time_base: "1/90000",
      duration: String(frames / 30),
      nb_frames: String(frames),
      nb_read_frames: String(frames),
    },
  ];
  if (audio) {
    streams.push({
      index: 1,
      codec_type: "audio",
      codec_name: "aac",
      sample_rate: "48000",
      channels: 1,
      channel_layout: "mono",
      duration: String(frames / 30),
    });
  }
  return {
    streams,
    format: {
      format_name: "mov,mp4,m4a,3gp,3g2,mj2",
      duration: String(frames / 30),
      size: "12345",
    },
  };
}


function fullOverlayManifest() {
  return {
    schemaVersion: V004B_OVERLAY_SCHEMA_VERSION,
    status: "full-input",
    fps: 30,
    durationSeconds: 600,
    durationInFrames: 18_000,
    timelineSha256: "b".repeat(64),
    builder: {
      scriptPath: "studio/scripts/build-agent-skill-v004b-no-box-overlays.py",
      scriptSha256: "e".repeat(64),
    },
    parameters: {
      mode: "full",
      fps: 30,
      durationSeconds: 600,
      durationInFrames: 18_000,
      reusePrefixCount: 24,
    },
    overlay: {
      width: 1480,
      height: 130,
      targetX: 220,
      targetY: 870,
      background: "transparent",
      backgroundAlpha: 0,
      fill: null,
      outline: null,
      borderWidth: 0,
      rectangle: false,
      noContainer: true,
      fontSize: 40,
      fontFamily: "Hiragino Sans GB",
      fontWeight: "W3",
    },
    assertions: {
      blankFullyTransparent: true,
      allCueFontSizesExactly40: true,
      allCueFontWeightsW3: true,
      allCueBordersAbsent: true,
      allAlphaLocalizedNearGlyphs: true,
      allCueAlphaInsideSafeArea: true,
      allCuePngsRgba1480x130: true,
      acceptedPrefixCuePngsByteExact: true,
      noOverlappingCues: true,
      noContainer: true,
    },
    acceptedPrefix: {
      manifestSha256: "f".repeat(64),
      reusePrefixCount: 24,
      allCuePngByteExact: true,
      blankPngByteExact: true,
      cuePngSha256: Array.from({length: 24}, (_, index) =>
        String(index).padStart(64, "0"),
      ),
    },
    displayCueCount: 24,
    reusedCueCount: 24,
    generatedCueCount: 0,
    displayCues: Array.from({length: 24}, (_, index) => ({index: index + 1})),
  };
}


test("正式 overlay 合同固定为 20×900 帧串行分段", () => {
  assert.deepEqual(V004B_FINAL_CONTRACT, {
    fps: 30,
    durationSeconds: 600,
    durationInFrames: 18_000,
    chunkFrames: 900,
    chunkCount: 20,
    concurrency: 1,
    width: 1920,
    height: 1080,
    overlayWidth: 1480,
    overlayHeight: 130,
    overlayX: 220,
    overlayY: 870,
    fontFamily: "Hiragino Sans GB",
    fontWeight: "W3",
    fontSize: 40,
    videoCodec: "h264",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioSampleRate: 48_000,
    audioChannels: 1,
    audioSamples: 28_800_000,
  });
  const ranges = buildChunkRanges();
  assert.equal(ranges.length, 20);
  assert.deepEqual(ranges[0], {
    index: 0,
    startFrame: 0,
    endFrameExclusive: 900,
    endFrameInclusive: 899,
    frameCount: 900,
  });
  assert.deepEqual(ranges.at(-1), {
    index: 19,
    startFrame: 17_100,
    endFrameExclusive: 18_000,
    endFrameInclusive: 17_999,
    frameCount: 900,
  });
  assert.throws(
    () => buildChunkRanges({durationInFrames: 18_001, chunkFrames: 900}),
    /整除/u,
  );
});


test("FFmpeg 合同逐段烧录 overlay、stream-copy concat，最后只编码一次音频", () => {
  const range = buildChunkRanges()[7];
  const overlayArgs = buildOverlayChunkFfmpegArgs({
    renderBase: "/frozen/base.mp4",
    framePattern: "/frozen/frames/frame-%05d.png",
    output: "/work/chunk.mp4",
    range,
  });
  assert.ok(overlayArgs.includes("-n"));
  assert.ok(overlayArgs.includes("900"));
  assert.ok(overlayArgs.includes("libx264"));
  assert.ok(overlayArgs.includes("-an"));
  assert.match(overlayArgs.join(" "), /overlay=220:870:format=auto:shortest=1/u);
  assert.doesNotMatch(overlayArgs.join(" "), / -y(?: |$)/u);

  const concatArgs = buildConcatFfmpegArgs("/work/chunks.txt", "/work/concat.mp4");
  assert.match(concatArgs.join(" "), /-f concat -safe 0/u);
  assert.match(concatArgs.join(" "), /-c:v copy/u);
  assert.ok(concatArgs.includes("-an"));
  assert.equal(
    buildConcatList(["/work/a.mp4", "/work/b.mp4"]),
    "file '/work/a.mp4'\nfile '/work/b.mp4'\n",
  );

  const muxArgs = buildAudioMuxFfmpegArgs(
    "/work/concat.mp4",
    "/frozen/voice.wav",
    "/work/final.mp4",
  );
  assert.match(muxArgs.join(" "), /-c:v copy/u);
  assert.match(
    muxArgs.join(" "),
    /apad=whole_len=28800000,atrim=end_sample=28800000/u,
  );
  assert.match(muxArgs.join(" "), /-c:a aac/u);
  assert.match(muxArgs.join(" "), /-t 600/u);
  assert.ok(buildVideoDecodeFfmpegArgs("x.mp4").includes("-xerror"));
  assert.ok(buildAudioDecodeFfmpegArgs("x.mp4").includes("-xerror"));
});


test("probe 门禁拒绝缺帧、音轨策略错误和非 48k mono AAC", () => {
  const chunkRange = buildChunkRanges()[0];
  const chunk = videoStream();
  const chunkValidation = evaluateChunkProbe(chunk, chunkRange);
  assert.equal(chunkValidation.valid, true, JSON.stringify(chunkValidation.checks));
  const wrongFrames = videoStream({frames: 899});
  assert.equal(evaluateChunkProbe(wrongFrames, chunkRange).checks.exactFrames, false);
  assert.equal(evaluateChunkProbe(videoStream({audio: true}), chunkRange).checks.audioPolicy, false);

  const base = evaluateRenderBaseProbe(videoStream({frames: 18_000, audio: true}));
  assert.equal(base.valid, true, JSON.stringify(base.checks));
  assert.equal(
    evaluateRenderBaseProbe(videoStream({frames: 18_000})).checks.exactlyOneAudio,
    false,
  );
  const authoritativeReadCount = videoStream({frames: 18_000, audio: true});
  authoritativeReadCount.streams[0].nb_frames = "17999";
  assert.equal(evaluateRenderBaseProbe(authoritativeReadCount).valid, true);
  const concat = evaluateConcatProbe(videoStream({frames: 18_000}));
  assert.equal(concat.valid, true, JSON.stringify(concat.checks));
  const finalProbe = videoStream({frames: 18_000, audio: true});
  const final = evaluateFinalProbe(finalProbe);
  assert.equal(final.valid, true, JSON.stringify(final.checks));
  finalProbe.streams[1].sample_rate = "44100";
  assert.equal(evaluateFinalProbe(finalProbe).checks.audio48k, false);
});


test("overlay manifest 必须是 600 秒、40px W3、透明无框且 byte-exact 复用前24图", () => {
  const manifest = fullOverlayManifest();
  assert.equal(
    validateOverlayManifest(manifest, "b".repeat(64), {
      expectedAcceptedPrefixManifestSha256: "f".repeat(64),
      expectedBuilderSha256: "e".repeat(64),
    }),
    manifest,
  );
  assert.throws(
    () => validateOverlayManifest({...manifest, durationInFrames: 2940}, "b".repeat(64)),
    /完整 600 秒/u,
  );
  assert.throws(
    () => validateOverlayManifest(
      {...manifest, overlay: {...manifest.overlay, rectangle: true}},
      "b".repeat(64),
    ),
    /rectangle/u,
  );
  assert.throws(
    () => validateOverlayManifest(
      {
        ...manifest,
        acceptedPrefix: {...manifest.acceptedPrefix, allCuePngByteExact: false},
      },
      "b".repeat(64),
    ),
    /前 24/u,
  );
  assert.throws(
    () =>
      validateOverlayManifest(manifest, "b".repeat(64), {
        expectedAcceptedPrefixManifestSha256: "a".repeat(64),
      }),
    /前 24/u,
  );
  const timelineCues = Array.from({length: 24}, (_, position) => ({
    index: position + 1,
    text: `字幕 ${position + 1}`,
    start: position,
    end: position + 0.5,
    startFrame: position * 30,
    endFrameExclusive: position * 30 + 15,
  }));
  const timelineBoundManifest = {
    ...manifest,
    displayCues: timelineCues.map((cue) => ({...cue})),
  };
  assert.equal(
    validateOverlayManifest(timelineBoundManifest, "b".repeat(64), {
      timeline: {displayCues: timelineCues},
      expectedAcceptedPrefixManifestSha256: "f".repeat(64),
      expectedBuilderSha256: "e".repeat(64),
    }),
    timelineBoundManifest,
  );
  timelineBoundManifest.displayCues[7].text = "漂移字幕";
  assert.throws(
    () =>
      validateOverlayManifest(timelineBoundManifest, "b".repeat(64), {
        timeline: {displayCues: timelineCues},
      }),
    /偏离 full timeline/u,
  );
});


test("overlay 资源门禁逐帧绑定18000个只读链接并拒绝可写 cue", async () => {
  const overlayDirectory = await mkdtemp(resolve(tmpdir(), "v004b-overlay-assets-"));
  const frameDirectory = resolve(overlayDirectory, "frames");
  const manifestPath = resolve(
    overlayDirectory,
    "overlay-manifest-v004b-no-box.json",
  );
  try {
    await mkdir(frameDirectory);
    const blankPath = resolve(overlayDirectory, "blank.png");
    await writeFile(blankPath, Buffer.from("transparent-blank-fixture"));
    const blankIntegrity = {
      sha256: sha256(Buffer.from("transparent-blank-fixture")),
    };
    const records = [];
    const owners = Array(18_000).fill(null);
    const imagePaths = [];
    for (let index = 1; index <= 24; index += 1) {
      const imageFile = `cue-${String(index).padStart(3, "0")}.png`;
      const imagePath = resolve(overlayDirectory, imageFile);
      const contents = Buffer.from(`accepted-cue-${index}`);
      await writeFile(imagePath, contents);
      imagePaths.push(imagePath);
      owners[index - 1] = index;
      records.push({
        index,
        text: `字幕 ${index}`,
        start: (index - 1) / 30,
        end: index / 30,
        startFrame: index - 1,
        endFrameExclusive: index,
        fontSize: 40,
        fontWeight: "W3",
        imageFile,
        imageSha256: sha256(contents),
        provenance: "byte-exact-accepted-v004b-proof",
        borderAlphaMax: 0,
        alphaCoverageRatio: 0.03,
        insideCaptionSafeArea: true,
      });
    }
    for (let batchStart = 0; batchStart < 18_000; batchStart += 500) {
      await Promise.all(
        Array.from(
          {length: Math.min(500, 18_000 - batchStart)},
          (_, offset) => {
            const frame = batchStart + offset;
            const owner = owners[frame];
            const target = owner === null ? "../blank.png" : `../${records[owner - 1].imageFile}`;
            return symlink(
              target,
              resolve(frameDirectory, `frame-${String(frame).padStart(5, "0")}.png`),
            );
          },
        ),
      );
    }
    const manifest = {
      ...fullOverlayManifest(),
      blankImageFile: "blank.png",
      blankImageSha256: blankIntegrity.sha256,
      frameDirectory: "frames",
      frameOwnerSha256: sha256Text(stableStringify(owners)),
      displayCues: records,
      acceptedPrefix: {
        ...fullOverlayManifest().acceptedPrefix,
        cuePngSha256: records.map((record) => record.imageSha256),
      },
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await Promise.all([
      chmod(blankPath, 0o444),
      chmod(manifestPath, 0o444),
      ...imagePaths.map((path) => chmod(path, 0o444)),
    ]);
    await chmod(frameDirectory, 0o555);
    await chmod(overlayDirectory, 0o555);
    const validated = await validateOverlayAssets(manifestPath, manifest);
    assert.equal(validated.frameDirectory, frameDirectory);

    await chmod(overlayDirectory, 0o755);
    await chmod(imagePaths[7], 0o644);
    await chmod(overlayDirectory, 0o555);
    await assert.rejects(
      validateOverlayAssets(manifestPath, manifest),
      /必须在合成前冻结为只读/u,
    );
  } finally {
    await chmod(overlayDirectory, 0o755).catch(() => {});
    await chmod(frameDirectory, 0o755).catch(() => {});
    await rm(overlayDirectory, {recursive: true, force: true});
  }
});


test("render-base 必须由 manifest SHA、媒体哈希和 durable receipt 三方绑定", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "v004b-render-base-binding-"));
  try {
    const renderBase = resolve(directory, "review-10m.mp4");
    const manifestPath = resolve(directory, "review-manifest.json");
    const receiptPath = resolve(directory, "publication-durable-receipt.json");
    const mediaBytes = Buffer.from("render-base-fixture");
    await writeFile(renderBase, mediaBytes);
    const mediaIntegrity = {bytes: mediaBytes.length, sha256: sha256(mediaBytes)};
    const manifest = {
      schemaVersion: "agent-skill-long-review-chunked-final-v1",
      reviewStatus: "render-base-requires-external-subtitle-overlay",
      runFingerprint: "a".repeat(64),
      renderJob: {
        jobId: "agent-skill-20260806-current-visual-upgrade-render-base-v014",
        candidateVersion: 14,
      },
      contract: {
        artifactRole: "render-base",
        formalCandidate: false,
        visualSource: "v013@980c4f4be9c1f0bccdcd546873fa1a877c98aac8",
        voice: "v004-full",
        subtitleStyle: "v004b-no-box",
        subtitleDelivery: "external-overlay-required",
        burnInSubtitle: false,
        episodeId: "agent-skill-20260806",
        compositionId: "AgentSkillLongReview",
      },
      finalMedia: {
        file: {path: "review-10m.mp4", ...mediaIntegrity},
        decoding: {
          videoDecodedWithoutError: true,
          audioDecodedWithoutError: true,
        },
      },
      publication: {atomicDirectoryRename: true},
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(manifestPath, manifestBytes);
    const jobBinding = {
      finalManifestSchemaVersion: manifest.schemaVersion,
      runFingerprint: manifest.runFingerprint,
      jobId: manifest.renderJob.jobId,
      candidateVersion: manifest.renderJob.candidateVersion,
      episodeId: manifest.contract.episodeId,
      compositionId: manifest.contract.compositionId,
    };
    const receipt = {
      schemaVersion: "agent-skill-long-review-publication-state-v1",
      kind: "durable_receipt",
      attemptToken: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      output: {fileName: "review-10m.mp4", ...mediaIntegrity},
      manifest: {
        fileName: "review-manifest.json",
        sha256: sha256(manifestBytes),
      },
      jobBinding,
      jobBindingSha256: sha256Text(stableStringify(jobBinding)),
      recordedAt: "2026-09-02T00:00:00.000Z",
    };
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    const result = await validateRenderBaseBinding({
      renderBase,
      manifestPath,
      receiptPath,
      expectedManifestSha256: sha256(manifestBytes),
    });
    assert.equal(result.baseIntegrity.sha256, mediaIntegrity.sha256);

    receipt.output.sha256 = "f".repeat(64);
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await assert.rejects(
      validateRenderBaseBinding({
        renderBase,
        manifestPath,
        receiptPath,
        expectedManifestSha256: sha256(manifestBytes),
      }),
      /一致绑定/u,
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});


test("CLI 要求所有冻结输入哈希，且源码不提供覆盖式 FFmpeg 或单次10分钟overlay编码", async () => {
  const options = parseCliArguments([
    "--render-base=/base.mp4",
    "--render-base-manifest=/base.json",
    "--render-base-receipt=/receipt.json",
    `--expected-render-base-manifest-sha256=${"a".repeat(64)}`,
    "--overlay-manifest=/overlay.json",
    `--expected-overlay-manifest-sha256=${"b".repeat(64)}`,
    `--expected-accepted-prefix-manifest-sha256=${"e".repeat(64)}`,
    "--timeline=/timeline.json",
    `--expected-timeline-sha256=${"c".repeat(64)}`,
    "--voice=/voice.wav",
    `--expected-voice-sha256=${"d".repeat(64)}`,
    "--work-directory=/work",
    "--output-directory=/candidate",
    "--dry-run",
  ]);
  assert.equal(options.dryRun, true);
  assert.equal(options.chunkFrames, 900);
  assert.equal(options.durationInFrames, 18_000);
  assert.equal(options.durationSeconds, 600);
  assert.equal(options.expectedAcceptedPrefixManifestSha256, "e".repeat(64));
  assert.deepEqual(
    assertFormalOutputLayout({
      workDirectory: V004B_FINAL_PATHS.workDirectory,
      outputDirectory: V004B_FINAL_PATHS.outputDirectory,
    }),
    {
      workDirectory: V004B_FINAL_PATHS.workDirectory,
      outputDirectory: V004B_FINAL_PATHS.outputDirectory,
    },
  );
  assert.throws(
    () =>
      assertFormalOutputLayout({
        workDirectory: "/work",
        outputDirectory: "/candidate",
      }),
    /独立固定/u,
  );
  const fixedInputs = {
    renderBase: resolve(V004B_FINAL_PATHS.renderBaseDirectory, "review-10m.mp4"),
    renderBaseManifest: resolve(
      V004B_FINAL_PATHS.renderBaseDirectory,
      "review-manifest.json",
    ),
    renderBaseReceipt: resolve(
      V004B_FINAL_PATHS.renderBaseDirectory,
      "publication-durable-receipt.json",
    ),
    overlayManifest: resolve(
      V004B_FINAL_PATHS.overlayDirectory,
      "overlay-manifest-v004b-no-box.json",
    ),
    timeline: V004B_FINAL_PATHS.timeline,
    voice: V004B_FINAL_PATHS.voice,
  };
  assert.equal(assertFormalInputLayout(fixedInputs), true);
  assert.throws(
    () => assertFormalInputLayout({...fixedInputs, voice: "/tmp/not-v004.wav"}),
    /输入路径合同不匹配/u,
  );
  const source = await readFile(
    new URL("../scripts/build-agent-skill-v004b-no-box-final.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /["']-y["']/u);
  assert.match(source, /for \(const range of ranges\)/u);
  assert.match(source, /concurrency: 1/u);
  assert.match(source, /COPYFILE_EXCL/u);
  assert.match(source, /acquireLongReviewRenderJobLock/u);
  assert.match(source, /syncLongReviewRenderFile/u);
  assert.match(source, /rename\(publicationPart, outputDirectory\)/u);
  assert.match(source, /artifactRole: "formal-candidate"/u);
  assert.match(source, /formalCandidate: true/u);
  assert.match(source, /humanVisualApproval: false/u);
  assert.match(source, /singleTenMinuteOverlayEncode: false/u);
  assert.equal(V004B_FINAL_SCHEMA_VERSION.endsWith("-v1"), true);
});


test("Python builder 固定 W3/40px/透明安全区并逐字节复制 accepted 前24 PNG", async () => {
  const source = await readFile(
    new URL("../scripts/build-agent-skill-v004b-no-box-overlays.py", import.meta.url),
    "utf8",
  );
  assert.match(source, /FONT_WEIGHT = "W3"/u);
  assert.match(source, /FONT_SIZE = 40/u);
  assert.match(source, /REUSED_PREFIX_COUNT = 24/u);
  assert.match(
    source,
    /studio\/data\/render-inputs\/full-v004b-attempt-001/u,
  );
  assert.match(source, /v004b-no-box-overlay-input-v001/u);
  assert.match(source, /shutil\.copyfile\(source_image_path, output_image\)/u);
  assert.match(source, /acceptedPrefixCuePngsByteExact/u);
  assert.match(source, /allCueAlphaInsideSafeArea/u);
  assert.match(source, /"backgroundAlpha": 0/u);
  assert.match(source, /"borderWidth": 0/u);
  assert.match(source, /"rectangle": False/u);
  assert.match(source, /output_directory\.exists\(\)/u);
  assert.doesNotMatch(source, /rounded_rectangle|ImageDraw\.rectangle/u);
});
