import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";

import { wavDurationSeconds } from "../src/server/production/voice.mjs";
import { studioOutputRoot, workspaceRoot } from "../src/shared/paths.mjs";
import {
  NATURAL_VOICE_NAME,
  NATURAL_VOICE_PROOF_DURATION_SECONDS,
  NATURAL_VOICE_SEGMENTS,
  nextNaturalVoiceProofVersion
} from "../src/video/agent-skill-natural-voice-plan.mjs";

const execute = promisify(execFile);
const episodeId = "agent-skill-20260806";
const outputDirectory = resolve(studioOutputRoot, episodeId);
await mkdir(outputDirectory, { recursive: true });
const version = nextNaturalVoiceProofVersion(await readdir(outputDirectory));
const versionLabel = String(version).padStart(3, "0");
const outputPath = resolve(outputDirectory, `natural-voice-proof-v${versionLabel}.wav`);
const temporaryOutputPath = resolve(outputDirectory, `natural-voice-proof-v${versionLabel}.rendering.wav`);
const manifestPath = resolve(outputDirectory, `natural-voice-proof-v${versionLabel}-manifest.json`);
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "agent-skill-natural-voice-"));
const sampleRate = 44100;

function pcmWav(data, rate) {
  const dataSize = data.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  data.copy(buffer, 44);
  return buffer;
}

function pcmSilence(durationSeconds, rate) {
  return Buffer.alloc(Math.round(durationSeconds * rate) * 2);
}

function pcmData(wav) {
  for (let offset = 12; offset + 8 <= wav.length;) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > wav.length) throw new Error("WAV 数据块超出文件范围");
    if (chunkId === "data") return wav.subarray(chunkStart, chunkEnd);
    offset = chunkEnd + (chunkSize % 2);
  }
  throw new Error("WAV 缺少 data 数据块");
}

try {
  const renderedSegments = [];
  const pcmParts = [];
  for (const [index, segment] of NATURAL_VOICE_SEGMENTS.entries()) {
    const aiffPath = resolve(temporaryDirectory, `segment-${index + 1}.aiff`);
    const wavPath = resolve(temporaryDirectory, `segment-${index + 1}.wav`);
    await execute("/usr/bin/say", [
      "-v", NATURAL_VOICE_NAME,
      "-r", String(segment.rate),
      "-o", aiffPath,
      segment.text
    ]);
    await execute("/usr/bin/afconvert", [
      "-f", "WAVE",
      "-d", `LEI16@${sampleRate}`,
      "-c", "1",
      aiffPath,
      wavPath
    ]);
    const wavData = await readFile(wavPath);
    const durationSeconds = wavDurationSeconds(wavData);
    const slotDurationSeconds = segment.end - segment.start;
    if (durationSeconds > slotDurationSeconds + 0.15) {
      throw new Error(`${segment.id} 旁白 ${durationSeconds}s 超出 ${slotDurationSeconds}s 画面段落`);
    }
    const trailingSilenceSeconds = Math.max(0, slotDurationSeconds - durationSeconds);
    renderedSegments.push({ ...segment, durationSeconds, trailingSilenceSeconds });
    pcmParts.push(pcmData(wavData));
    if (trailingSilenceSeconds > 0.001) pcmParts.push(pcmSilence(trailingSilenceSeconds, sampleRate));
  }

  await writeFile(temporaryOutputPath, pcmWav(Buffer.concat(pcmParts), sampleRate));
  const outputData = await readFile(temporaryOutputPath);
  const durationSeconds = wavDurationSeconds(outputData);
  if (Math.abs(durationSeconds - NATURAL_VOICE_PROOF_DURATION_SECONDS) > 0.05) {
    throw new Error(`试听旁白时长 ${durationSeconds}s 不等于 60s`);
  }
  await rename(temporaryOutputPath, outputPath);
  const manifest = {
    schemaVersion: 1,
    id: `agent-skill-natural-voice-proof-v${versionLabel}`,
    episodeId,
    generatedAt: new Date().toISOString(),
    voice: NATURAL_VOICE_NAME,
    direction: "温和年轻男声，知识类创作者自然讲解",
    durationSeconds,
    sampleRate,
    channels: 1,
    outputPath: relative(workspaceRoot, outputPath).replaceAll("\\", "/"),
    bytes: outputData.length,
    sha256: createHash("sha256").update(outputData).digest("hex"),
    segments: renderedSegments,
    generation: { mode: "local-macos-system-voice", paidApiCalls: 0, externalNetworkCalls: 0 },
    usage: "仅用于 60 秒声音方向人工试听；未写入 Episode，未替换已审批旁白"
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
  await rm(temporaryOutputPath, { force: true }).catch(() => undefined);
}
