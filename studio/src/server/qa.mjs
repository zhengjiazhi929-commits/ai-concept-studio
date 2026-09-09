import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  unlink
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

import { getVideoMetadata, RenderInternals } from "@remotion/renderer";

import { inspectFileIntegrity, isSha256 } from "../shared/integrity.mjs";
import { episodeOutputDirectory, workspaceRoot } from "../shared/paths.mjs";
import { evaluateProductionQuality } from "./production/quality.mjs";

const executeFile = promisify(execFile);

export const RENDERED_MEDIA_QA_POLICY = Object.freeze({
  schemaVersion: "rendered-media-machine-qa-v1",
  maximumAvDurationDeltaSeconds: 0.35,
  minimumAudioChannels: 1,
  maximumAudioChannels: 2,
  minimumAudioPeakDb: -50,
  audioAnalysisSampleRate: 8000,
  audioAnalysisWindowSeconds: 1,
  minimumAudibleWindowFraction: 0.1,
  maximumConsecutiveSilentSeconds: 30,
  representativeFrameCount: 7,
  representativeFrameWidth: 64,
  representativeFrameHeight: 36,
  maximumBlackLuma: 4,
  minimumNonBlackMeanLuma: 8,
  maximumBlackPixelRatio: 0.98,
  minimumChangingPairFraction: 0.2,
  minimumMeanAbsoluteFrameDelta: 0.5,
  commandTimeoutMs: 30 * 60 * 1_000
});

function check(id, label, passed, actual, expected, ownerAgentId = "render-agent") {
  return { id, label, passed, actual, expected, ownerAgentId };
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rationalToNumber(value) {
  if (typeof value !== "string") return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function normalizeProcessText(value) {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return String(value ?? "");
}

function mediaToolEnvironment(executable) {
  const executableDirectory = dirname(executable);
  return {
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    ...(process.platform === "darwin"
      ? { DYLD_LIBRARY_PATH: executableDirectory }
      : {})
  };
}

async function runBundledMediaTool(type, args, options = {}, commandOptions = {}) {
  if (typeof options.runMediaTool === "function") {
    return options.runMediaTool(type, args, { ...options, ...commandOptions });
  }
  const getExecutablePath = options.getExecutablePath ?? RenderInternals.getExecutablePath;
  const executable = getExecutablePath({
    type,
    indent: false,
    logLevel: "error",
    binariesDirectory: options.binariesDirectory ?? null
  });
  return (options.execFile ?? executeFile)(executable, args, {
    cwd: dirname(executable),
    timeout: options.timeoutMs ?? RENDERED_MEDIA_QA_POLICY.commandTimeoutMs,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    encoding: commandOptions.binaryOutput ? null : "utf8",
    env: mediaToolEnvironment(executable)
  });
}

function representativeFrameNumbers(frameCount, sampleCount) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) return [];
  const count = Math.max(1, Math.min(sampleCount, frameCount));
  if (count === 1) return [0];
  return [...new Set(Array.from({ length: count }, (_, index) => Math.max(
    0,
    Math.min(frameCount - 1, Math.round((index * (frameCount - 1)) / (count - 1)))
  )))];
}

export function buildRepresentativeFrameDecodeArgs({
  videoPath,
  frameNumbers,
  outputPaths,
  width = RENDERED_MEDIA_QA_POLICY.representativeFrameWidth,
  height = RENDERED_MEDIA_QA_POLICY.representativeFrameHeight
}) {
  if (!Array.isArray(frameNumbers) || frameNumbers.length === 0) {
    throw new Error("代表帧编号不能为空");
  }
  if (frameNumbers.some((frame) => !Number.isSafeInteger(frame) || frame < 0)) {
    throw new Error("代表帧编号必须是非负安全整数");
  }
  if (!Array.isArray(outputPaths) || outputPaths.length !== frameNumbers.length) {
    throw new Error("代表帧输出路径必须与帧编号一一对应");
  }
  const sourceLabels = frameNumbers.map((_, index) => `[source-${index}]`).join("");
  const filters = [`[0:v:0]split=${frameNumbers.length}${sourceLabels}`];
  for (const [index, frame] of frameNumbers.entries()) {
    filters.push(
      `[source-${index}]trim=start_frame=${frame}:end_frame=${frame + 1},` +
      `scale=${width}:${height}:flags=area,format=gray[frame-${index}]`
    );
  }
  const args = [
    "-nostdin",
    "-hide_banner",
    "-v", "error",
    "-filter_complex_threads", "1",
    "-n",
    "-i", videoPath,
    "-filter_complex", filters.join(";")
  ];
  for (const [index, outputPath] of outputPaths.entries()) {
    args.push(
      "-map", `[frame-${index}]`,
      "-frames:v", "1",
      "-c:v", "png",
      outputPath
    );
  }
  return args;
}

async function extractRepresentativeFrames(videoPath, frameNumbers, policy, options) {
  if (typeof options.extractRepresentativeFrames === "function") {
    return options.extractRepresentativeFrames({ videoPath, frameNumbers, policy });
  }
  const directory = await mkdtemp(resolve(tmpdir(), "acs-rendered-media-frames-"));
  const outputPaths = frameNumbers.map(
    (frame) => resolve(directory, `frame-${String(frame).padStart(9, "0")}.png`)
  );
  try {
    await runBundledMediaTool("ffmpeg", buildRepresentativeFrameDecodeArgs({
      videoPath,
      frameNumbers,
      outputPaths,
      width: policy.representativeFrameWidth,
      height: policy.representativeFrameHeight
    }), options);
    return Buffer.concat(await Promise.all(outputPaths.map((outputPath) => readFile(outputPath))));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function paethPredictor(left, up, upperLeft) {
  const predictor = left + up - upperLeft;
  const leftDistance = Math.abs(predictor - left);
  const upDistance = Math.abs(predictor - up);
  const upperLeftDistance = Math.abs(predictor - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function decodeGrayPng(png) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(signature)) {
    throw new Error("代表帧不是 PNG");
  }
  let offset = 8;
  let width = null;
  let height = null;
  const compressed = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error("代表帧 PNG chunk 截断");
    const data = png.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 0 || data[12] !== 0) {
        throw new Error("代表帧 PNG 必须是 8-bit 非隔行灰度图");
      }
    }
    if (type === "IDAT") compressed.push(data);
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || compressed.length === 0) {
    throw new Error("代表帧 PNG 缺少 IHDR 或 IDAT");
  }
  const inflated = inflateSync(Buffer.concat(compressed));
  const stride = width;
  if (inflated.length !== (stride + 1) * height) {
    throw new Error("代表帧 PNG 解压尺寸不一致");
  }
  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[y * (stride + 1) + 1 + x];
      const left = x > 0 ? pixels[y * stride + x - 1] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = x > 0 && y > 0 ? pixels[(y - 1) * stride + x - 1] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paethPredictor(left, up, upperLeft);
      else throw new Error(`代表帧 PNG filter 不支持：${filter}`);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}

function decodePngSequence(data) {
  if (!Buffer.isBuffer(data)) return [];
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const frames = [];
  let offset = 0;
  while (offset < data.length) {
    if (!data.subarray(offset, offset + 8).equals(signature)) {
      throw new Error(`代表帧 PNG 流在 byte ${offset} 缺少签名`);
    }
    let cursor = offset + 8;
    while (cursor + 12 <= data.length) {
      const length = data.readUInt32BE(cursor);
      const type = data.toString("ascii", cursor + 4, cursor + 8);
      cursor += 12 + length;
      if (cursor > data.length) throw new Error("代表帧 PNG 流截断");
      if (type === "IEND") break;
    }
    frames.push(decodeGrayPng(data.subarray(offset, cursor)));
    offset = cursor;
  }
  return frames;
}

function frameMetrics(encodedFrames, frameNumbers, policy) {
  const decoded = decodePngSequence(encodedFrames);
  const frameSize = policy.representativeFrameWidth * policy.representativeFrameHeight;
  if (decoded.length !== frameNumbers.length || decoded.some(
    (frame) => frame.width !== policy.representativeFrameWidth
      || frame.height !== policy.representativeFrameHeight
  )) {
    return {
      decodedFrameCount: decoded.length,
      expectedFrameCount: frameNumbers.length,
      exactFrameCount: false,
      samples: [],
      changingPairFraction: 0,
      allSamplesNonBlack: false,
      hasVisualChange: false
    };
  }

  const frames = frameNumbers.map((frame, index) => {
    const pixels = decoded[index].pixels;
    let sum = 0;
    let maximum = 0;
    for (const value of pixels) {
      sum += value;
      maximum = Math.max(maximum, value);
    }
    return {
      frame,
      meanLuma: sum / pixels.length,
      maximumLuma: maximum,
      blackPixelRatio: [...pixels].filter((value) => value <= policy.maximumBlackLuma).length
        / pixels.length,
      sha256: createHash("sha256").update(pixels).digest("hex"),
      pixels
    };
  });

  const pairDeltas = [];
  for (let index = 1; index < frames.length; index += 1) {
    let absoluteDelta = 0;
    for (let pixel = 0; pixel < frameSize; pixel += 1) {
      absoluteDelta += Math.abs(frames[index].pixels[pixel] - frames[index - 1].pixels[pixel]);
    }
    pairDeltas.push(absoluteDelta / frameSize);
  }
  const changingPairs = pairDeltas.filter(
    (delta) => delta >= policy.minimumMeanAbsoluteFrameDelta
  ).length;
  const changingPairFraction = pairDeltas.length === 0 ? 0 : changingPairs / pairDeltas.length;
  return {
    decodedFrameCount: frames.length,
    expectedFrameCount: frameNumbers.length,
    exactFrameCount: true,
    samples: frames.map(({ pixels: _pixels, ...sample }) => sample),
    pairMeanAbsoluteDeltas: pairDeltas,
    changingPairFraction,
    allSamplesNonBlack: frames.every((frame) => frame.meanLuma >= policy.minimumNonBlackMeanLuma
      && frame.blackPixelRatio <= policy.maximumBlackPixelRatio),
    hasVisualChange: changingPairFraction >= policy.minimumChangingPairFraction
  };
}

function inspectPcmS16Wav(wav, policy) {
  if (!Buffer.isBuffer(wav) || wav.length < 44
    || wav.toString("ascii", 0, 4) !== "RIFF"
    || wav.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let format = null;
  let pcm = null;
  while (offset + 8 <= wav.length) {
    const type = wav.toString("ascii", offset, offset + 4);
    const declaredLength = wav.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const availableLength = Math.max(0, wav.length - dataStart);
    const actualLength = Math.min(declaredLength, availableLength);
    if (type === "fmt " && actualLength >= 16) {
      format = {
        encoding: wav.readUInt16LE(dataStart),
        channels: wav.readUInt16LE(dataStart + 2),
        sampleRate: wav.readUInt32LE(dataStart + 4),
        bitsPerSample: wav.readUInt16LE(dataStart + 14)
      };
    }
    if (type === "data") {
      pcm = wav.subarray(dataStart, dataStart + actualLength);
      break;
    }
    offset = dataStart + actualLength + (actualLength % 2);
  }
  if (!pcm || pcm.length < 2 || format?.encoding !== 1 || format.channels !== 1
    || format.bitsPerSample !== 16 || format.sampleRate !== policy.audioAnalysisSampleRate) {
    return null;
  }
  const sampleCount = Math.floor(pcm.length / 2);
  const windowSampleCount = Math.max(
    1,
    Math.round(format.sampleRate * policy.audioAnalysisWindowSeconds)
  );
  let maximum = 0;
  const windowPeaks = [];
  for (let sampleStart = 0; sampleStart < sampleCount; sampleStart += windowSampleCount) {
    let windowMaximum = 0;
    const sampleEnd = Math.min(sampleCount, sampleStart + windowSampleCount);
    for (let sample = sampleStart; sample < sampleEnd; sample += 1) {
      windowMaximum = Math.max(windowMaximum, Math.abs(pcm.readInt16LE(sample * 2)));
    }
    maximum = Math.max(maximum, windowMaximum);
    windowPeaks.push(windowMaximum === 0
      ? Number.NEGATIVE_INFINITY
      : 20 * Math.log10(windowMaximum / 32767));
  }
  const audibleWindows = windowPeaks.map((peak) => peak >= policy.minimumAudioPeakDb);
  let maximumConsecutiveSilentWindows = 0;
  let activeSilentWindows = 0;
  for (const audible of audibleWindows) {
    activeSilentWindows = audible ? 0 : activeSilentWindows + 1;
    maximumConsecutiveSilentWindows = Math.max(
      maximumConsecutiveSilentWindows,
      activeSilentWindows
    );
  }
  const audibleWindowCount = audibleWindows.filter(Boolean).length;
  return {
    sampleRate: format.sampleRate,
    decodedSampleCount: sampleCount,
    decodedDurationSeconds: sampleCount / format.sampleRate,
    peakVolumeDb: maximum === 0
      ? Number.NEGATIVE_INFINITY
      : 20 * Math.log10(maximum / 32767),
    windowSeconds: policy.audioAnalysisWindowSeconds,
    windowCount: windowPeaks.length,
    audibleWindowCount,
    audibleWindowFraction: windowPeaks.length === 0 ? 0 : audibleWindowCount / windowPeaks.length,
    maximumConsecutiveSilentSeconds:
      maximumConsecutiveSilentWindows * policy.audioAnalysisWindowSeconds
  };
}

function failedCommandEvidence(error) {
  return {
    passed: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

export async function inspectRenderedMedia(videoPath, options = {}) {
  const policy = { ...RENDERED_MEDIA_QA_POLICY, ...(options.policy ?? {}) };
  const probeArgs = [
    "-v", "error",
    "-count_frames",
    "-show_entries",
    "format=duration,format_name,start_time:" +
      "stream=index,codec_type,codec_name,width,height,pix_fmt,avg_frame_rate," +
      "duration,nb_read_frames,sample_rate,channels,channel_layout",
    "-of", "json",
    videoPath
  ];
  let probe;
  try {
    const result = await runBundledMediaTool("ffprobe", probeArgs, options);
    probe = JSON.parse(normalizeProcessText(result.stdout));
  } catch (error) {
    return {
      schemaVersion: policy.schemaVersion,
      policy,
      machineOnly: true,
      manualPlaybackRequired: true,
      probe: failedCommandEvidence(error),
      fullDecode: { passed: false, skipped: true, reason: "probe_failed" },
      audio: { present: false, notSilent: false, skipped: true, reason: "probe_failed" },
      representativeFrames: { passed: false, skipped: true, reason: "probe_failed" }
    };
  }

  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const videoStream = videoStreams[0] ?? null;
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const audioStream = audioStreams[0] ?? null;
  const formatDurationSeconds = finiteNumber(probe.format?.duration);
  const videoDurationSeconds = finiteNumber(videoStream?.duration) ?? formatDurationSeconds;
  const declaredAudioDurationSeconds = finiteNumber(audioStream?.duration);
  const decodedVideoFrames = finiteNumber(videoStream?.nb_read_frames);
  const fps = rationalToNumber(videoStream?.avg_frame_rate);
  const derivedFrameCount = decodedVideoFrames !== null
    ? Math.round(decodedVideoFrames)
    : (videoDurationSeconds !== null && fps !== null
      ? Math.max(1, Math.round(videoDurationSeconds * fps))
      : 0);

  let fullDecode;
  try {
    await runBundledMediaTool("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-v", "error",
      "-xerror",
      "-err_detect", "explode",
      "-i", videoPath,
      "-map", "0:v",
      "-map", "0:a?",
      "-c:v", "rawvideo",
      "-c:a", "pcm_s16le",
      "-f", "null",
      "-"
    ], options);
    fullDecode = { passed: true, decodedVideoFrames };
  } catch (error) {
    fullDecode = failedCommandEvidence(error);
  }

  let decodedAudioInspection = null;
  let volumeInspection = audioStream ? { passed: false } : { passed: false, skipped: true };
  if (audioStream) {
    try {
      const result = await runBundledMediaTool("ffmpeg", [
        "-nostdin",
        "-hide_banner",
        "-v", "error",
        "-i", videoPath,
        "-map", "0:a:0",
        "-vn",
        "-ac", "1",
        "-ar", String(policy.audioAnalysisSampleRate),
        "-c:a", "pcm_s16le",
        "-f", "wav",
        "pipe:1"
      ], options, { binaryOutput: true });
      decodedAudioInspection = inspectPcmS16Wav(result.stdout, policy);
      const measuredPeakVolumeDb = decodedAudioInspection?.peakVolumeDb ?? null;
      const peakVolumeDb = measuredPeakVolumeDb === Number.NEGATIVE_INFINITY
        ? "-inf"
        : measuredPeakVolumeDb;
      const coveragePassed = decodedAudioInspection !== null
        && decodedAudioInspection.audibleWindowCount > 0
        && decodedAudioInspection.audibleWindowFraction >= policy.minimumAudibleWindowFraction
        && decodedAudioInspection.maximumConsecutiveSilentSeconds
          <= policy.maximumConsecutiveSilentSeconds;
      volumeInspection = {
        passed: measuredPeakVolumeDb !== null
          && measuredPeakVolumeDb >= policy.minimumAudioPeakDb
          && coveragePassed,
        peakVolumeDb,
        minimumPeakVolumeDb: policy.minimumAudioPeakDb,
        minimumAudibleWindowFraction: policy.minimumAudibleWindowFraction,
        maximumConsecutiveSilentSecondsAllowed: policy.maximumConsecutiveSilentSeconds,
        method: "full-audio-decode-pcm-s16le-mono-window-coverage",
        ...(decodedAudioInspection
          ? {
              ...decodedAudioInspection,
              peakVolumeDb
            }
          : {})
      };
    } catch (error) {
      volumeInspection = failedCommandEvidence(error);
    }
  }

  const frameNumbers = representativeFrameNumbers(
    derivedFrameCount,
    policy.representativeFrameCount
  );
  let representativeFrames;
  if (frameNumbers.length === 0) {
    representativeFrames = {
      passed: false,
      reason: "video_frame_count_unavailable",
      frameNumbers
    };
  } else {
    try {
      const encodedFrames = await extractRepresentativeFrames(
        videoPath,
        frameNumbers,
        policy,
        options
      );
      const metrics = frameMetrics(encodedFrames, frameNumbers, policy);
      representativeFrames = {
        passed: metrics.exactFrameCount && metrics.allSamplesNonBlack && metrics.hasVisualChange,
        frameNumbers,
        ...metrics
      };
    } catch (error) {
      representativeFrames = {
        ...failedCommandEvidence(error),
        frameNumbers
      };
    }
  }

  const channels = finiteNumber(audioStream?.channels);
  const audioDurationSeconds = decodedAudioInspection?.decodedDurationSeconds ?? null;
  const audioDurationSource = decodedAudioInspection ? "decoded_pcm_samples" : null;
  const avDurationDeltaSeconds = audioDurationSeconds !== null && videoDurationSeconds !== null
    ? Math.abs(audioDurationSeconds - videoDurationSeconds)
    : null;
  return {
    schemaVersion: policy.schemaVersion,
    policy,
    machineOnly: true,
    manualPlaybackRequired: true,
    statement: "机器 QA 不能替代人工连续 1× 观看最终 MP4。",
    probe: {
      passed: videoStreams.length === 1,
      format: probe.format ?? null,
      streams,
      normalized: {
        formatDurationSeconds,
        videoDurationSeconds,
        audioDurationSeconds,
        audioDurationSource,
        declaredAudioDurationSeconds,
        avDurationDeltaSeconds,
        decodedVideoFrames,
        fps,
        videoStreamCount: videoStreams.length,
        audioStreamCount: audioStreams.length,
        channels
      }
    },
    fullDecode,
    audio: {
      present: audioStreams.length > 0,
      singleTrack: audioStreams.length === 1,
      streamCount: audioStreams.length,
      durationSeconds: audioDurationSeconds,
      durationSource: audioDurationSource,
      durationValid: audioDurationSeconds !== null && audioDurationSeconds > 0,
      channels,
      channelsValid: channels !== null
        && channels >= policy.minimumAudioChannels
        && channels <= policy.maximumAudioChannels,
      avDurationDeltaSeconds,
      avDurationAligned: avDurationDeltaSeconds !== null
        && avDurationDeltaSeconds <= policy.maximumAvDurationDeltaSeconds,
      notSilent: volumeInspection.passed === true,
      volumeInspection
    },
    representativeFrames
  };
}

export function renderedMediaTechnicalChecks(media) {
  const policy = media.policy ?? RENDERED_MEDIA_QA_POLICY;
  return [
    check("video-track", "恰好一个视频轨", media.probe?.normalized?.videoStreamCount === 1,
      media.probe?.normalized?.videoStreamCount ?? 0, "1"),
    check("full-media-decode", "完整音视频可解码", media.fullDecode?.passed === true,
      media.fullDecode, "full decode succeeds"),
    check("audio-track", "恰好一个音轨", media.audio?.singleTrack === true,
      media.audio?.streamCount ?? 0, "1"),
    check("audio-duration", "音轨时长有效", media.audio?.durationValid === true,
      media.audio?.durationSeconds ?? null, "> 0 seconds"),
    check("audio-channels", "音轨声道有效", media.audio?.channelsValid === true,
      media.audio?.channels ?? null,
      `${policy.minimumAudioChannels}-${policy.maximumAudioChannels}`),
    check("audio-not-silent", "音轨未低于静音阈值", media.audio?.notSilent === true,
      media.audio?.volumeInspection ?? null,
      `peak >= ${policy.minimumAudioPeakDb} dB, audible windows >= ` +
        `${policy.minimumAudibleWindowFraction}, max silence <= ` +
        `${policy.maximumConsecutiveSilentSeconds}s`),
    check("av-duration-aligned", "音视频时长对齐", media.audio?.avDurationAligned === true,
      media.audio?.avDurationDeltaSeconds ?? null,
      `<= ${policy.maximumAvDurationDeltaSeconds} seconds`),
    check("representative-frames-non-black", "代表帧非全黑",
      media.representativeFrames?.allSamplesNonBlack === true,
      media.representativeFrames?.samples?.map((sample) => ({
        frame: sample.frame,
        meanLuma: sample.meanLuma,
        maximumLuma: sample.maximumLuma,
        blackPixelRatio: sample.blackPixelRatio
      })) ?? [],
      `mean >= ${policy.minimumNonBlackMeanLuma} and black-area <= ${policy.maximumBlackPixelRatio}`),
    check("representative-frames-change", "代表帧未整体冻结",
      media.representativeFrames?.hasVisualChange === true,
      media.representativeFrames?.changingPairFraction ?? 0,
      `>= ${policy.minimumChangingPairFraction} changing pairs`)
  ];
}

export function isSuccessfulQaWorkerStatus(status) {
  return status === "waiting_approval" || status === "complete";
}

export function renderIntegrityChecks(episode, actual) {
  const expectedBytes = episode.render?.bytes ?? null;
  const expectedSha256 = episode.render?.sha256 ?? null;
  return [
    check(
      "render-bytes",
      "成片字节数与渲染记录一致",
      Number.isSafeInteger(expectedBytes) && expectedBytes === actual.bytes,
      actual.bytes,
      expectedBytes
    ),
    check(
      "render-sha256",
      "成片 SHA-256 与渲染记录一致",
      isSha256(expectedSha256) && expectedSha256 === actual.sha256,
      actual.sha256,
      expectedSha256
    )
  ];
}

export function nextQaReportFileName(files, renderVersion) {
  const baseName = `preview-qa-v${renderVersion}.json`;
  let highestRevision = files.includes(baseName) ? 1 : 0;
  const revisionPattern = new RegExp(
    `^preview-qa-v${renderVersion}-r(\\d{3})\\.json$`,
    "u"
  );
  for (const file of files) {
    const match = revisionPattern.exec(file);
    if (match) highestRevision = Math.max(highestRevision, Number(match[1]));
  }
  return highestRevision === 0
    ? baseName
    : `preview-qa-v${renderVersion}-r${String(highestRevision + 1).padStart(3, "0")}.json`;
}

export async function publishQaReport({
  outputDirectory,
  renderVersion,
  report,
  attemptId = randomUUID(),
  maximumNameAttempts = 100
}) {
  const temporaryPath = resolve(outputDirectory, `.preview-qa-${attemptId}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    for (let attempt = 0; attempt < maximumNameAttempts; attempt += 1) {
      const reportPath = resolve(
        outputDirectory,
        nextQaReportFileName(await readdir(outputDirectory), renderVersion)
      );
      try {
        await link(temporaryPath, reportPath);
        return reportPath;
      } catch (error) {
        if (error?.code === "EEXIST") continue;
        throw error;
      }
    }
    throw new Error("并发 QA 报告过多，无法分配无覆盖版本号");
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

export async function runPreviewQa(episode, options = {}) {
  if (!episode.render.outputPath) throw new Error("没有可检查的预览视频");
  const absolutePath = resolve(workspaceRoot, episode.render.outputPath);
  const getMetadata = options.getVideoMetadata ?? getVideoMetadata;
  const inspectIntegrity = options.inspectFileIntegrity ?? inspectFileIntegrity;
  const inspectMedia = options.inspectRenderedMedia ?? inspectRenderedMedia;
  const evaluateQuality = options.evaluateProductionQuality ?? evaluateProductionQuality;
  const integrityBefore = await inspectIntegrity(absolutePath);
  const [metadata, mediaEvidence] = await Promise.all([
    getMetadata(absolutePath, { logLevel: "warn" }),
    inspectMedia(absolutePath, options.mediaInspectionOptions)
  ]);
  const integrity = await inspectIntegrity(absolutePath);
  if (JSON.stringify(integrity) !== JSON.stringify(integrityBefore)) {
    throw new Error("预览 MP4 在 QA 读取期间发生变化；拒绝发布混合来源证据");
  }

  const machineMediaChecks = renderedMediaTechnicalChecks(mediaEvidence);
  const technicalChecks = [
    check("width", "竖屏宽度", metadata.width === episode.render.width, metadata.width, episode.render.width),
    check(
      "height",
      "竖屏高度",
      metadata.height === episode.render.height,
      metadata.height,
      episode.render.height
    ),
    check(
      "fps",
      "帧率",
      Math.abs(metadata.fps - episode.render.fps) < 0.1,
      metadata.fps,
      episode.render.fps
    ),
    check(
      "duration",
      "时长",
      Math.abs(metadata.durationInSeconds - episode.render.durationSeconds) < 0.35,
      metadata.durationInSeconds,
      episode.render.durationSeconds
    ),
    check("codec", "视频编码", metadata.codec === "h264", metadata.codec, "h264"),
    check("pixel-format", "像素格式", metadata.pixelFormat === "yuv420p", metadata.pixelFormat, "yuv420p"),
    check("file-size", "文件有效", integrity.bytes > 50_000, integrity.bytes, "> 50000 bytes"),
    ...renderIntegrityChecks(episode, integrity),
    ...machineMediaChecks,
    check(
      "scenes",
      "场景完整",
      episode.scenes.length >= 6,
      episode.scenes.length,
      ">= 6",
      "storyboard-agent"
    )
  ];

  const quality = evaluateQuality(episode, { stage: "qa" });
  const checks = [...technicalChecks, ...quality.checks];
  const passed = technicalChecks.every((item) => item.passed) && quality.passed;
  const outputDirectory = episodeOutputDirectory(episode.id);
  await mkdir(outputDirectory, { recursive: true });
  const renderVersion = /preview-v(\d{3})\.mp4$/u.exec(episode.render.outputPath)?.[1] ?? "latest";
  const report = {
    episodeId: episode.id,
    checkedAt: (options.now ?? (() => new Date()))().toISOString(),
    passed,
    approvalState: "machine_qa_only_manual_1x_playback_required",
    summary: passed
      ? `机器技术与内容 QA 通过，质量 ${quality.score} 分（${quality.grade}）；仍需人工连续 1× 观看最终 MP4`
      : `机器 QA 未通过：${technicalChecks.filter((item) => !item.passed).length} 项技术问题，${quality.errors.length} 项内容问题`,
    manualReview: {
      required: true,
      status: "pending",
      playback: "uninterrupted_1x_final_mp4",
      statement: "机器检查、抽帧和联系表均不能替代人工连续 1× 观看。"
    },
    video: {
      path: episode.render.outputPath,
      bytes: integrity.bytes,
      sha256: integrity.sha256,
      metadata,
      mediaEvidence
    },
    checks,
    technicalChecks,
    quality
  };
  const publishReport = options.publishQaReport ?? publishQaReport;
  const reportPath = await publishReport({
    outputDirectory,
    renderVersion,
    report
  });

  return {
    ...report,
    reportPath,
    relativeReportPath: relative(workspaceRoot, reportPath).replaceAll("\\", "/")
  };
}
