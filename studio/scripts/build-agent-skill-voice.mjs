import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { wavDurationSeconds } from "../src/server/production/voice.mjs";
import { readEpisode } from "../src/shared/store.mjs";

const execute = promisify(execFile);
const episodeId = process.argv[2] ?? "agent-skill-20260806";
if (episodeId !== "agent-skill-20260806") {
  throw new Error("这个离线旁白夹具只允许用于 agent-skill-20260806");
}

const episode = await readEpisode(episodeId);
const script = episode.production?.scriptDraft?.content;
if (!script?.hook || !Array.isArray(script.sections) || !script.closing) {
  throw new Error("缺少已经批准的结构化脚本");
}

const narrationParts = [
  script.hook,
  ...script.sections.map((section) => `${section.heading}。\n${section.narration}`),
  script.closing
];
const narration = narrationParts.join("\n\n[[slnc 2500]]\n\n");
const targetDurationSeconds = Number(script.targetDurationSeconds ?? episode.render?.durationSeconds);
if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0) {
  throw new Error("脚本缺少有效目标时长");
}

const voice = "Tingting";
const outputDirectory = resolve("data/fixtures/agent-skill-voice");
const outputPath = resolve(outputDirectory, "agent-skill-offline-v001.wav");
const manifestPath = resolve(outputDirectory, "agent-skill-offline-v001.json");
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "agent-skill-voice-"));
await mkdir(outputDirectory, { recursive: true });

let rate = 210;
let selected = null;
const attempts = [];

try {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const aiffPath = resolve(temporaryDirectory, `voice-${attempt}.aiff`);
    const wavPath = resolve(temporaryDirectory, `voice-${attempt}.wav`);
    await execute("/usr/bin/say", [
      "-v",
      voice,
      "-r",
      String(rate),
      "-o",
      aiffPath,
      narration
    ]);
    await execute("/usr/bin/afconvert", [
      "-f",
      "WAVE",
      "-d",
      "LEI16@22050",
      "-c",
      "1",
      aiffPath,
      wavPath
    ]);
    const durationSeconds = wavDurationSeconds(await readFile(wavPath));
    const differenceRatio = Math.abs(durationSeconds - targetDurationSeconds) / targetDurationSeconds;
    attempts.push({ attempt, rate, durationSeconds, differenceRatio });
    selected = { wavPath, rate, durationSeconds, differenceRatio };
    if (differenceRatio <= 0.02) break;
    rate = Math.max(80, Math.min(720, Math.round(rate * durationSeconds / targetDurationSeconds)));
  }

  if (!selected || selected.differenceRatio > 0.05) {
    throw new Error(`本机旁白无法校准到目标时长的 5% 范围内：${JSON.stringify(attempts)}`);
  }
  await rm(outputPath, { force: true });
  await rename(selected.wavPath, outputPath);
  await writeFile(manifestPath, JSON.stringify({
    kind: "offline-local-system-voice",
    episodeId,
    voice,
    targetDurationSeconds,
    durationSeconds: selected.durationSeconds,
    rate: selected.rate,
    usage: "仅用于本地离线流程验证；正式发布前必须替换为人工确认且已获授权的声音",
    attempts
  }, null, 2));
  console.log(JSON.stringify({
    outputPath,
    manifestPath,
    targetDurationSeconds,
    durationSeconds: selected.durationSeconds,
    rate: selected.rate,
    differenceRatio: selected.differenceRatio,
    attempts
  }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
