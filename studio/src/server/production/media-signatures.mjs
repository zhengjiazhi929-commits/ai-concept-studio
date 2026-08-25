import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { RenderInternals } from "@remotion/renderer";

const execute = promisify(execFile);

function startsWithBytes(data, bytes) {
  return Buffer.isBuffer(data)
    && data.length >= bytes.length
    && bytes.every((value, index) => data[index] === value);
}

function asciiAt(data, value, offset = 0) {
  return Buffer.isBuffer(data)
    && data.length >= offset + value.length
    && data.toString("ascii", offset, offset + value.length) === value;
}

export function supportedMediaSignature(data, extension) {
  const normalized = String(extension ?? "").toLowerCase();
  if (normalized === ".png") {
    return startsWithBytes(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (normalized === ".jpg" || normalized === ".jpeg") {
    return startsWithBytes(data, [0xff, 0xd8, 0xff]);
  }
  if (normalized === ".webp") {
    return asciiAt(data, "RIFF") && asciiAt(data, "WEBP", 8);
  }
  if (normalized === ".mp4" || normalized === ".mov" || normalized === ".m4a") {
    return asciiAt(data, "ftyp", 4);
  }
  if (normalized === ".wav") {
    return asciiAt(data, "RIFF") && asciiAt(data, "WAVE", 8);
  }
  if (normalized === ".ogg") {
    return asciiAt(data, "OggS");
  }
  if (normalized === ".mp3") {
    return asciiAt(data, "ID3")
      || (data?.[0] === 0xff && (data?.[1] & 0xe0) === 0xe0);
  }
  if (normalized === ".aac") {
    return data?.[0] === 0xff && (data?.[1] & 0xf6) === 0xf0;
  }
  return false;
}

export function assertSupportedMediaSignature(data, extension) {
  if (supportedMediaSignature(data, extension)) return;
  const error = new Error("上传文件内容与声明的媒体格式不一致");
  error.code = "media_signature_invalid";
  error.statusCode = 400;
  throw error;
}

function mediaValidationError(message, causeCode = null) {
  const error = new Error(message);
  error.code = "media_content_invalid";
  error.statusCode = 400;
  if (causeCode) error.causeCode = causeCode;
  return error;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function expectedKind(extension) {
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return "image";
  if ([".mp4", ".mov"].includes(extension)) return "video";
  return "audio";
}

function inspectProbe(probe, extension, bytes) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  if (streams.length === 0 || streams.length > 4) {
    throw mediaValidationError("媒体轨道数量无效或超过上限");
  }
  if (streams.some((stream) => !["video", "audio"].includes(stream.codec_type))) {
    throw mediaValidationError("上传媒体包含不允许的数据、附件或字幕轨道");
  }
  const kind = expectedKind(extension);
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const durationSeconds = finitePositive(probe?.format?.duration)
    ?? finitePositive(streams.find((stream) => finitePositive(stream.duration))?.duration);

  if (kind === "image") {
    const expectedCodecs = new Map([
      [".png", "png"],
      [".jpg", "mjpeg"],
      [".jpeg", "mjpeg"],
      [".webp", "webp"]
    ]);
    const stream = videoStreams[0];
    const width = Number(stream?.width);
    const height = Number(stream?.height);
    if (
      videoStreams.length !== 1
      || audioStreams.length !== 0
      || stream?.codec_name !== expectedCodecs.get(extension)
      || !Number.isInteger(width)
      || !Number.isInteger(height)
      || width < 1
      || height < 1
      || width > 8_192
      || height > 8_192
      || width * height > 40_000_000
      || bytes > 20 * 1024 * 1024
    ) {
      throw mediaValidationError("图片编码、尺寸、像素数或文件大小不符合安全边界");
    }
    return { kind, width, height, codec: stream.codec_name, durationSeconds: null };
  }

  if (kind === "video") {
    const stream = videoStreams[0];
    const width = Number(stream?.width);
    const height = Number(stream?.height);
    const allowedCodecs = new Set(["h264", "hevc", "prores", "vp8", "vp9", "av1"]);
    if (
      videoStreams.length !== 1
      || audioStreams.length > 2
      || !allowedCodecs.has(stream?.codec_name)
      || !Number.isInteger(width)
      || !Number.isInteger(height)
      || width < 1
      || height < 1
      || width > 4_096
      || height > 4_096
      || width * height > 17_000_000
      || durationSeconds === null
      || durationSeconds > 600
      || bytes > 64 * 1024 * 1024
    ) {
      throw mediaValidationError("视频编码、尺寸、时长、轨道或文件大小不符合安全边界");
    }
    return { kind, width, height, codec: stream.codec_name, durationSeconds };
  }

  const stream = audioStreams[0];
  const sampleRate = Number(stream?.sample_rate);
  const channels = Number(stream?.channels);
  if (
    videoStreams.length !== 0
    || audioStreams.length < 1
    || audioStreams.length > 2
    || !Number.isInteger(sampleRate)
    || sampleRate < 8_000
    || sampleRate > 96_000
    || !Number.isInteger(channels)
    || channels < 1
    || channels > 2
    || durationSeconds === null
    || durationSeconds > 600
    || bytes > 32 * 1024 * 1024
  ) {
    throw mediaValidationError("音频采样、声道、时长、轨道或文件大小不符合安全边界");
  }
  return {
    kind,
    codec: stream.codec_name,
    sampleRate,
    channels,
    durationSeconds
  };
}

async function runMediaTool(type, args, options = {}) {
  const executable = (options.getExecutablePath ?? RenderInternals.getExecutablePath)({
    type,
    indent: false,
    logLevel: "error",
    binariesDirectory: options.binariesDirectory ?? null
  });
  const executableDirectory = dirname(executable);
  return (options.execFile ?? execute)(executable, args, {
    cwd: executableDirectory,
    timeout: options.timeoutMs ?? 10_000,
    maxBuffer: 1024 * 1024,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C",
      LC_ALL: "C",
      ...(process.platform === "darwin"
        ? { DYLD_LIBRARY_PATH: executableDirectory }
        : {})
    }
  });
}

export async function inspectSupportedMedia(data, extension, options = {}) {
  const normalized = String(extension ?? "").toLowerCase();
  assertSupportedMediaSignature(data, normalized);
  const directory = await mkdtemp(resolve(tmpdir(), "acs-media-inspection-"));
  const inputPath = resolve(directory, `input${normalized}`);
  try {
    await writeFile(inputPath, data, { flag: "wx" });
    let probe;
    try {
      const result = await runMediaTool("ffprobe", [
        "-v", "error",
        "-probesize", "5000000",
        "-analyzeduration", "5000000",
        "-show_entries",
        "format=duration,format_name,size:stream=index,codec_type,codec_name,width,height,sample_rate,channels,duration",
        "-of", "json",
        inputPath
      ], options);
      probe = JSON.parse(result.stdout);
    } catch (error) {
      throw mediaValidationError("媒体无法由受限本地解析器读取", error?.code ?? "probe_failed");
    }
    const inspection = inspectProbe(probe, normalized, data.length);
    const decodeArgs = inspection.kind === "audio"
      ? ["-nostdin", "-v", "error", "-threads", "1", "-i", inputPath,
        "-map", "0:a:0", "-t", "1", "-f", "null", "-"]
      : ["-nostdin", "-v", "error", "-threads", "1", "-i", inputPath,
        "-map", "0:v:0", "-frames:v", "1", "-f", "null", "-"];
    try {
      await runMediaTool("ffmpeg", decodeArgs, options);
    } catch (error) {
      throw mediaValidationError("媒体首个受限片段无法安全解码", error?.code ?? "decode_failed");
    }
    return { ...inspection, bytes: data.length, decoder: "remotion-bundled-ffmpeg" };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
