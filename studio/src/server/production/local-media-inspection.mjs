import { wavDurationSeconds } from "./voice.mjs";

function invalid(message) {
  const error = new Error(message);
  error.code = "local_pcm_wav_invalid";
  throw error;
}

export function inspectPcm16MonoWav(data, options = {}) {
  const durationSeconds = wavDurationSeconds(data);
  let format = null;
  let pcmStart = null;
  let pcmBytes = null;
  for (let offset = 12; offset + 8 <= data.length;) {
    const chunkId = data.toString("ascii", offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkSize;
    if (end > data.length) invalid("WAV 数据块越界");
    if (chunkId === "fmt ") {
      if (chunkSize < 16) invalid("WAV fmt 数据块无效");
      format = {
        audioFormat: data.readUInt16LE(start),
        channels: data.readUInt16LE(start + 2),
        sampleRate: data.readUInt32LE(start + 4),
        byteRate: data.readUInt32LE(start + 8),
        blockAlign: data.readUInt16LE(start + 12),
        bitsPerSample: data.readUInt16LE(start + 14)
      };
    }
    if (chunkId === "data") {
      pcmStart = start;
      pcmBytes = chunkSize;
    }
    offset = end + (chunkSize % 2);
  }
  const expectedSampleRate = options.sampleRate ?? 24_000;
  if (
    format?.audioFormat !== 1
    || format.channels !== 1
    || format.sampleRate !== expectedSampleRate
    || format.bitsPerSample !== 16
    || format.blockAlign !== 2
    || format.byteRate !== expectedSampleRate * 2
    || !Number.isSafeInteger(pcmStart)
    || !Number.isSafeInteger(pcmBytes)
    || pcmBytes <= 0
    || pcmBytes % 2 !== 0
  ) {
    invalid(`旁白必须为 ${expectedSampleRate} Hz、单声道、PCM 16-bit WAV`);
  }
  if (
    Number.isFinite(options.durationSeconds)
    && Math.abs(durationSeconds - options.durationSeconds) > (options.durationTolerance ?? 0.01)
  ) {
    invalid(`WAV 时长 ${durationSeconds}s 与 ${options.durationSeconds}s 不一致`);
  }

  const samplesPerWindow = expectedSampleRate;
  const windowCount = Math.ceil(pcmBytes / 2 / samplesPerWindow);
  const windows = Array.from({ length: windowCount }, () => ({ count: 0, sumSquares: 0, peak: 0 }));
  let peakAmplitude = 0;
  let sumSquares = 0;
  let sampleCount = 0;
  for (let offset = pcmStart; offset < pcmStart + pcmBytes; offset += 2) {
    const sample = data.readInt16LE(offset);
    const amplitude = Math.abs(sample);
    peakAmplitude = Math.max(peakAmplitude, amplitude);
    sumSquares += sample * sample;
    const window = windows[Math.floor(sampleCount / samplesPerWindow)];
    window.count += 1;
    window.sumSquares += sample * sample;
    window.peak = Math.max(window.peak, amplitude);
    sampleCount += 1;
  }
  const rootMeanSquareAmplitude = Math.sqrt(sumSquares / sampleCount);
  const active = windows.map((window) => (
    Math.sqrt(window.sumSquares / window.count) >= (options.activeWindowRms ?? 96)
    && window.peak >= (options.activeWindowPeak ?? 384)
  ));
  const activeWindowCount = active.filter(Boolean).length;
  const activeWindowRatio = activeWindowCount / active.length;
  let longestInactiveWindowRun = 0;
  let currentInactiveWindowRun = 0;
  for (const isActive of active) {
    currentInactiveWindowRun = isActive ? 0 : currentInactiveWindowRun + 1;
    longestInactiveWindowRun = Math.max(longestInactiveWindowRun, currentInactiveWindowRun);
  }
  if (
    peakAmplitude < (options.minimumPeak ?? 512)
    || rootMeanSquareAmplitude < (options.minimumRms ?? 32)
    || activeWindowRatio < (options.minimumActiveWindowRatio ?? 0.35)
    || longestInactiveWindowRun > (options.maximumInactiveWindowRun ?? 4)
  ) {
    const error = new Error("旁白 PCM 能量或时间覆盖不足");
    error.code = "local_pcm_wav_energy_invalid";
    throw error;
  }
  return {
    ...format,
    durationSeconds,
    pcmBytes,
    peakAmplitude,
    rootMeanSquareAmplitude: Number(rootMeanSquareAmplitude.toFixed(3)),
    activeWindowCount,
    windowCount,
    activeWindowRatio: Number(activeWindowRatio.toFixed(6)),
    longestInactiveWindowRun
  };
}
