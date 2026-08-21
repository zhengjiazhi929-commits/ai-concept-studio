import test from "node:test";
import assert from "node:assert/strict";
import {
  voiceExtension,
  voiceStepAfterUpload,
  wavDurationSeconds
} from "../src/server/production/voice.mjs";

function pcmWav(durationSeconds, sampleRate = 8000) {
  const dataSize = durationSeconds * sampleRate;
  const buffer = Buffer.alloc(44 + dataSize, 128);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test("旁白上传只接受可播放的音频格式", () => {
  assert.equal(voiceExtension("audio/mpeg", "recording.bin"), ".mp3");
  assert.equal(voiceExtension("application/octet-stream", "voice.M4A"), ".m4a");
  assert.equal(voiceExtension("application/octet-stream", "notes.txt"), null);
});

test("旁白上传后先交回旁白 Agent 和机器审核，不能直接进入人工审批", () => {
  const ready = voiceStepAfterUpload({
    id: "voice",
    requiresApproval: "assets",
    requiresHuman: true
  }, true);
  assert.equal(ready.status, "ready");
  assert.equal(ready.requiresApproval, null);
  assert.equal(ready.requiresHuman, false);

  const pending = voiceStepAfterUpload({
    id: "voice",
    requiresApproval: "assets",
    requiresHuman: true
  }, false);
  assert.equal(pending.status, "pending");
  assert.equal(pending.requiresApproval, null);
  assert.equal(pending.requiresHuman, false);
});

test("WAV 旁白必须能从真实数据块读取时长，伪造或截断文件会被拒绝", () => {
  assert.equal(wavDurationSeconds(pcmWav(3)), 3);
  assert.throws(() => wavDurationSeconds(Buffer.from("not-a-wave")), /WAV 文件/u);
  const truncated = pcmWav(2).subarray(0, 100);
  assert.throws(() => wavDurationSeconds(truncated), /超出文件范围/u);
});
